# GlenSound GTM Mobile

Control and monitor the GlenSound GTM Mobile intercom microphone unit via UDP over a Dante network.

## Setup

1. Enter the **Device IP address** of your GTM Mobile
2. Leave **UDP command port** at `41161` (default)
3. Leave **Multicast interface IP** blank — the module will automatically detect the correct network interface based on the device IP

If feedback does not work and you have multiple network cards, set the **Multicast interface IP** to the IP address of the network interface connected to the Dante network (e.g. `172.22.44.66`).

## Mute actions

- **Mute microphone** — mutes the mic and locks the physical button (AlwaysOFF mode)
- **Unmute microphone** — unmutes the mic and locks the physical button (AlwaysON mode)
- **Toggle mute** — toggles between muted and unmuted

> If you want the physical button on the device to remain usable, configure the device in *Latching* mode in GlenSound Controller and use **Toggle mute** from Companion.

## Mixer channel volume actions

Select a mixer channel (2–14) and set its volume to 0%, 100%, or toggle between them.

Channel mapping:

| Channel | Label |
|---|---|
| 2 | Game |
| 3–8 | Player 1–6 |
| 9 | Coach |
| 10 | Referee |
| 11 | Extra 1 |
| 12–14 | Extra 2–4 (stereo) |

## Feedbacks

- **Microphone mute state** — button changes color based on muted/unmuted state
- **Mixer channel volume state** — button changes color when a channel is at 0% or 100%

## Variables

- `mute_state` — current mute state (`muted` / `unmuted` / `unknown`)
- `channel_2_volume` through `channel_14_volume` — current volume of each mixer channel

## Multiple devices

Add one connection per GTM Mobile. Each connection monitors only its own device — there is no interference between multiple instances.
