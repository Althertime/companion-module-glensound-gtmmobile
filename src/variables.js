'use strict'

function UpdateVariables(self) {
	const defs = [
		{ variableId: 'mute_state', name: 'Mute state (muted / unmuted / unknown)' },
	]
	for (let k = 2; k <= 14; k++) {
		defs.push({ variableId: `channel_${k}_volume`, name: `Channel ${k} volume` })
	}
	self.setVariableDefinitions(defs)

	const vals = { mute_state: 'unknown' }
	for (let k = 2; k <= 14; k++) vals[`channel_${k}_volume`] = 'unknown'
	self.setVariableValues(vals)
}

module.exports = { UpdateVariables }
