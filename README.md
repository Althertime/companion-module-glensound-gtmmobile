# companion-module-glensound-gtmmobile

[Bitfocus Companion](https://bitfocus.io/companion) module for the **GlenSound GTM Mobile** — a Dante-enabled intercom microphone unit.

Controls mute/unmute and internal mixer channel volumes via UDP, with real-time feedback from the device.

---

## Features

- ✅ **Mute / Unmute / Toggle** microphone
- ✅ **Set mixer channel volume** to 0%, 100%, or any value, with toggle
- ✅ **Real-time feedback** — button colors reflect the actual device state
  - Mute state (muted / unmuted)
  - Mixer channel volume (0% / 100%)
- ✅ **Physical button support** — feedback reflects physical button presses on the device
- ✅ **Multiple devices** — add one instance per device, each with its own IP
- ✅ **Auto-detection of network interface** — no manual configuration needed in most setups
- ✅ **Connection monitoring** — detects device going offline within 3 seconds

---

## Requirements

- Bitfocus Companion 4.x
- GlenSound GTM Mobile connected to a Dante network
- The Companion machine must be on the same Dante network as the device

---

## Installation

### Developer mode (local)

1. Clone or download this repository into your Companion developer modules folder
2. Run `yarn` in the module folder
3. In Companion: **Settings → Developer module path** → point to the parent folder
4. Add a new connection → search for **GlenSound GTM Mobile**

### Submitting to Bitfocus

See the [Companion module development guide](https://companion.free/for-developers/module-development/) for instructions on submitting to the official module library.

---

## Configuration

| Field | Description |
|---|---|
| **Device IP address** | IP address of the GTM Mobile |
| **UDP command port** | Command port on the device (default: `41161`) |
| **Multicast interface IP** | Leave blank for auto-detection (recommended). Set manually only if auto-detection fails — use the IP of your network interface on the Dante network. |

> **Auto-detection:** The module automatically finds the correct network interface by comparing the device IP with the subnet of each local interface. This works correctly even with multiple network cards (e.g. one for internet, one for Dante).

---

## Actions

### Mute control

| Action | Description |
|---|---|
| **Mute microphone** | Sets button mode to AlwaysOFF — mic is muted, physical button press is disabled |
| **Unmute microphone** | Sets button mode to AlwaysON — mic is active, physical button press is disabled |
| **Toggle mute** | Toggles between muted and unmuted based on current device state |

> **Note:** Mute/Unmute actions lock the physical button on the device. If you want the physical button to remain functional, use the device in *Latching* mode and only use **Toggle mute**.

### Mixer channel volume

| Action | Description |
|---|---|
| **Set mixer channel to 100%** | Sets the selected channel to full volume |
| **Set mixer channel to 0%** | Silences the selected channel |
| **Toggle mixer channel volume (0% ↔ 100%)** | Toggles between 0% and 100% based on current state |
| **Set mixer channel volume** | Sets the channel to a specific value (0–100) |

**Available mixer channels:**

| Channel | Label |
|---|---|
| 2 | Game |
| 3 | Player 1 |
| 4 | Player 2 |
| 5 | Player 3 |
| 6 | Player 4 |
| 7 | Player 5 |
| 8 | Player 6 |
| 9 | Coach |
| 10 | Referee |
| 11 | Extra 1 |
| 12 | Extra 2 (stereo) |
| 13 | Extra 3 (stereo) |
| 14 | Extra 4 (stereo) |

> Channel 1 (USB/physical input) is not controllable via UDP.

---

## Feedbacks

### Mute state

Changes the button appearance based on the microphone mute state received from the device.

| Option | Values |
|---|---|
| Trigger when device is | Muted / Unmuted |

Default style: red background when muted.

### Mixer channel volume state

Changes the button appearance based on a mixer channel's current volume.

| Option | Values |
|---|---|
| Mixer channel | 2–14 |
| Trigger when channel is at | 100% / 0% |

Default style: green background when at 100%.

---

## Variables

| Variable | Values |
|---|---|
| `$(glensound-gtmmobile:mute_state)` | `muted` / `unmuted` / `unknown` |
| `$(glensound-gtmmobile:channel_2_volume)` | `0%` / `100%` / `unknown` |
| `$(glensound-gtmmobile:channel_3_volume)` | … |
| … | … |
| `$(glensound-gtmmobile:channel_14_volume)` | `0%` / `100%` / `unknown` |

---

## Protocol notes

The GTM Mobile uses the **GlenSound UDP control protocol** on port `41161`.

- **Commands** are sent as unicast UDP to the device IP on port `41161`
- **Feedback** is received via multicast UDP on `239.254.50.123:6111` — the device broadcasts GlenSound Status packets there at ~10 Hz
- The module polls `GetStatus` every 500ms to ensure physical button presses are reflected in Companion even without GlenSound Controller running
- If no response is received from the device for 3 seconds, the connection status changes to **Connection Failure** and variables reset to `unknown`. Status recovers automatically when the device comes back online
- Mute state is read directly from the Status packet (offset `0x81`: `0x00` = muted, `0x01` = unmuted)
- Mixer channel volumes are read from Report type 8, requested when the volume generation counter changes in the Status packet

---

## Multiple devices

Each GTM Mobile requires its own Companion connection instance with its own device IP. All instances share the same multicast group (`239.254.50.123:6111`) but filter packets by source IP, so there is no interference between instances.

Tested with 2 devices simultaneously. Designed to scale to large deployments (80+ devices).

---

## License

MIT — see [LICENSE](LICENSE)
