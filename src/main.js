'use strict'

const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const { UpdateActions, CMD_MUTE, CMD_UNMUTE } = require('./actions')
const { UpdateFeedbacks } = require('./feedbacks')
const { UpdateVariables } = require('./variables')
const dgram = require('dgram')

// ─── GlenSound Protocol ────────────────────────────────────────────────────

const GS_MAGIC = Buffer.from('4753204374726c00', 'hex')
const CONTROLLER_ID = Buffer.from([0x6c, 0x80, 0x7b, 0xa2])

// Status multicast (from Wireshark: GlenSound Controller on Windows)
const STATUS_MULTICAST_GROUP = '239.254.50.123'
const STATUS_MULTICAST_PORT  = 6111

// Mute state: offset 0x81 in Status packet
// 0x01 = unmuted, 0x00 = muted
const MUTE_OFFSET = 0x81

// Channel volume report:
// Device sends Report type=8 on multicast after GetReport
// Channel volume at payload offset = knob + 45  (knob 1-13)
// where payload starts at offset 16 (GS header) of the Report packet
// Formula verified: knob 9 → offset 54 = 0x36, value 0=0%, 100=100%
const REPORT_TYPE_VOLUME = 8
const CHANNEL_VOLUME_OFFSET = (knob) => knob * 2 + 52   // offset in full packet
// Formula: param1 = knob+14, offset = param1*2+24 = knob*2+52
// Verified: knob 2 → offset 56 (0x38), knob 9 → offset 70 (0x46)

// Generation indices in Status packet (offset 20 = start of generations array)
const GEN_MUTE_OFFSET   = 0x1a  // offset 26: mute/button state generation
const GEN_VOLUME_OFFSET = 0x1c  // offset 28: mixer volume generation

function buildPacket(opcode, payload) {
	const size = 16 + (payload ? payload.length : 0)
	const b = Buffer.alloc(size)
	GS_MAGIC.copy(b, 0)
	b.writeUInt16LE(size, 8)
	b[10] = opcode
	b[11] = 0x00
	CONTROLLER_ID.copy(b, 12)
	if (payload) payload.copy(b, 16)
	return b
}

// GetStatus — triggers Status response from device
const PKT_GET_STATUS = buildPacket(2)

// GetReport type=8 (mixer volume report)
const PKT_GET_REPORT_VOLUME = buildPacket(11, Buffer.from([REPORT_TYPE_VOLUME, 0x00, 0x00, 0x00]))


// Auto-detect which local network interface is in the same subnet as the device
function findInterfaceForDevice(deviceIp) {
	const os = require('os')
	const deviceParts = deviceIp.split('.').map(Number)
	for (const addrs of Object.values(os.networkInterfaces())) {
		for (const addr of addrs) {
			if (addr.family !== 'IPv4' || addr.internal) continue
			const localParts = addr.address.split('.').map(Number)
			const maskParts  = addr.netmask.split('.').map(Number)
			const sameSubnet = maskParts.every((m, i) => (localParts[i] & m) === (deviceParts[i] & m))
			if (sameSubnet) return addr.address
		}
	}
	return undefined
}

// ─── Module ────────────────────────────────────────────────────────────────

class GlenSoundGTMMobile extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.muteState      = null           // true=muted, false=unmuted, null=unknown
		this.channelVolumes = new Array(14).fill(null)  // index 1-13, null=unknown
		this.lastGenMute    = -1
		this.lastGenVolume  = -1
		this.udpCmd         = null
		this.udpStatus      = null
		this.pollTimer      = null
	}

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		this.updateActions()
		this.updateFeedbacks()
		this.updateVariables()
		this.start()
	}

	async destroy() {
		this.closeSockets()
	}

	async configUpdated(config) {
		this.config = config
		this.closeSockets()
		this.muteState = null
		this.channelVolumes = new Array(14).fill(null)
		this.lastGenMute = -1
		this.lastGenVolume = -1
		this.start()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Device IP address',
				width: 6,
				regex: Regex.IP,
				default: '192.168.1.100',
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'UDP command port',
				width: 3,
				regex: Regex.PORT,
				default: '41161',
			},
			{
				type: 'textinput',
				id: 'multicastInterface',
				label: 'Multicast interface IP (leave blank = auto)',
				width: 6,
				default: '',
				tooltip: 'Leave blank for auto-detection (recommended). The module will automatically find the correct interface based on the device IP. Only set manually if auto-detection fails.',
			},
		]
	}

	updateActions()   { UpdateActions(this) }
	updateFeedbacks() { UpdateFeedbacks(this) }
	updateVariables() { UpdateVariables(this) }

	// ── Start ─────────────────────────────────────────────────────────────────

	start() {
		if (!this.config?.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No device IP configured')
			return
		}

		// Command socket
		try {
			this.udpCmd = dgram.createSocket('udp4')
			this.udpCmd.on('error', (err) => this.log('error', `Cmd socket: ${err.message}`))
			this.udpCmd.bind(0, () => this.log('debug', `Cmd socket on port ${this.udpCmd.address().port}`))
		} catch (err) {
			this.log('error', `Failed to create cmd socket: ${err.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
			return
		}

		// Status multicast socket
		try {
			this.udpStatus = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			this.udpStatus.on('error', (err) => this.log('error', `Status socket: ${err.message}`))
			this.udpStatus.on('message', (msg, rinfo) => this.onStatusMessage(msg, rinfo))

			this.udpStatus.bind(STATUS_MULTICAST_PORT, STATUS_MULTICAST_GROUP, () => {
				const configured = this.config?.multicastInterface
				const iface = configured || findInterfaceForDevice(this.config.host)
				if (!configured && iface) this.log('info', `Auto-detected multicast interface: ${iface}`)
				if (!configured && !iface) this.log('warn', 'Could not auto-detect multicast interface — trying without (may fail with multiple NICs)')
				try {
					this.udpStatus.addMembership(STATUS_MULTICAST_GROUP, iface)
					this.log('info', `Joined status multicast ${STATUS_MULTICAST_GROUP}:${STATUS_MULTICAST_PORT}`)
					this.updateStatus(InstanceStatus.Ok)
					// Request initial state immediately
					this.sendCmd(PKT_GET_STATUS)
					this.sendCmd(PKT_GET_REPORT_VOLUME)
					// Poll GetStatus every 500ms so physical button presses are reflected
					this.pollTimer = setInterval(() => this.sendCmd(PKT_GET_STATUS), 500)

				} catch (err) {
					this.log('error', `Multicast join failed: ${err.message}`)
					this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
				}
			})
		} catch (err) {
			this.log('error', `Failed to create status socket: ${err.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
		}
	}

	closeSockets() {
		if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
		if (this.udpCmd) {
			try { this.udpCmd.close() } catch (_) {}
			this.udpCmd = null
		}
		if (this.udpStatus) {
			try {
				this.udpStatus.dropMembership(STATUS_MULTICAST_GROUP)
				this.udpStatus.close()
			} catch (_) {}
			this.udpStatus = null
		}
	}

	// ── Send ──────────────────────────────────────────────────────────────────

	sendCmd(pkt) {
		const host = this.config?.host
		const port = parseInt(this.config?.port) || 41161
		if (!host || !this.udpCmd) return
		this.udpCmd.send(pkt, 0, pkt.length, port, host, (err) => {
			if (err) this.log('error', `Send error: ${err.message}`)
		})
	}

	sendMute()   { this.sendCmd(CMD_MUTE);   this.log('debug', 'Sent MUTE') }
	sendUnmute() { this.sendCmd(CMD_UNMUTE); this.log('debug', 'Sent UNMUTE') }
	sendToggle() { this.muteState === false ? this.sendMute() : this.sendUnmute() }

	// ── Parse Status multicast ────────────────────────────────────────────────

	onStatusMessage(msg, rinfo) {
		// GTM Mobile sends Status multicast from port 41162
		if (rinfo.port !== 41162) return
		if (rinfo.address !== this.config?.host) return
		if (msg.length < 16 || !msg.slice(0, 8).equals(GS_MAGIC)) return

		const opcode = msg[10]

		if (opcode === 1) {
			this.onStatus(msg)
		} else if (opcode === 10) {
			this.onReport(msg)
		}
	}

	onStatus(msg) {
		if (msg.length <= MUTE_OFFSET) return

		// ── Mute state ──
		const muteVal = msg[MUTE_OFFSET]
		const newMute = muteVal === 0x00  // 0=muted, 1=unmuted
		if (newMute !== this.muteState) {
			this.muteState = newMute
			this.log('info', `Mute → ${newMute ? 'MUTED' : 'UNMUTED'}`)
			this.setVariableValues({ mute_state: newMute ? 'muted' : 'unmuted' })
			this.checkFeedbacks('mute_state')
		}

		// ── Volume generation — request report when it changes ──
		if (msg.length > GEN_VOLUME_OFFSET) {
			const genVol = msg[GEN_VOLUME_OFFSET]
			if (genVol !== this.lastGenVolume) {
				this.lastGenVolume = genVol
				this.log('debug', `Volume generation changed (${genVol}), requesting report`)
				this.sendCmd(PKT_GET_REPORT_VOLUME)
			}
		}
	}

	onReport(msg) {
		if (msg.length < 20) return
		const reportType = msg[16]
		if (reportType !== REPORT_TYPE_VOLUME) return

		this.log('debug', `Volume report received, len=${msg.length}`)

		// Read volume for each channel (knob 1-13)
		// offset in packet = knob + 61 = 16(GS header) + knob + 45
		let changed = false
		for (let knob = 2; knob <= 14; knob++) {
			const offset = CHANNEL_VOLUME_OFFSET(knob)
			if (offset >= msg.length) continue
			const vol = msg[offset]  // 0 or 100
			if (vol !== this.channelVolumes[knob]) {
				this.channelVolumes[knob] = vol
				this.log('debug', `Channel ${knob} volume = ${vol}%`)
				changed = true
			}
		}

		if (changed) {
			// Update variables
			const vars = {}
			for (let k = 1; k <= 13; k++) {
				vars[`channel_${k}_volume`] = this.channelVolumes[k] !== null
					? `${this.channelVolumes[k]}%`
					: 'unknown'
			}
			this.setVariableValues(vars)
			this.checkFeedbacks('channel_volume')
		}
	}
}

runEntrypoint(GlenSoundGTMMobile, [])
