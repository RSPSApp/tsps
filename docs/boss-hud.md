# The boss HUD

The `BossHud` plugin (`server/plugins/interface/BossHud.plugin.js`) sends the boss health HUD, interface 303 `hpbar_hud`, for every boss that shows it: the Mad Angel, the Doom of Mokhaiotl, the Gemstone Crab and the Tombs of Amascut bosses.

## How it works

The client mounts 303 at login (`encodeGameframeBootstrap`). Its own scripts draw the bar from:

| What | Id |
| --- | --- |
| The NPC | varp 1683 `hpbar_hud_npc` |
| Current and maximum | varbits 6099 `hpbar_hud_hp` and 6100 `hpbar_hud_basehp` |
| Boss mode | varbit 12401 `hpbar_hud_boss` |
| The bar's colours | 303:13, :14 and :15 (usually 25600, 576 and 800) |

The plugin sets those and runs the scripts: 2376 `hp_hud_open`, the fades 2887 (in) and 2889 (out), 2102 to redraw new colours, and 2249 to empty the container.

## The events

A boss emits these per player, through `api.emitCustomEvent`. Each one sends only what changed.

| Event | Payload | What it does |
| --- | --- | --- |
| `boss-hud:show` | `player, npcId, current, maximum, colours?` | The values, the colours, 2376, then a fade in from 254 |
| `boss-hud:update` | `player, npcId?, current?, maximum?, colours?, force?` | Any of them; new colours are redrawn |
| `boss-hud:fade` | `player, fadeIn` | A fade in (from 255) or out (from 0) |
| `boss-hud:hide` | `player, fade = true, afterTicks = 4` | Fades out; `afterTicks` later, clears the values and hides `hp` |
| `boss-hud:reset` | `player` | Hides `hp` and empties the container |

- **Why the fade in from 254:** a finished fade-out leaves the bar's parts at transparency 255, and 2887 does nothing when told to start from the transparency they already have.
- **A pending hide** is cancelled by a show before it.
- **A hide with `afterTicks: 0`** clears the values at once. With a fade, `hp` stays shown so the fade can finish (the Doom's kill); without one, it is hidden too.

## Testing

`tests/boss-hud.test.cjs` checks each event against the captures. The Doom, Gemstone Crab and Tombs of Amascut tests route their custom events to the plugin.
