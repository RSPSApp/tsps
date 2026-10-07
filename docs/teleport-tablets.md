# Teleport tablets

Breaking a teleport tablet (a spell tablet such as Varrock teleport, Teleport to house, or Teleport to boat) uses the `TELE_TAB` teleport type (`server/src/main/typescript/elvarg/game/model/teleportation/TeleportType.ts`). The tablet plugins are `server/plugins/combat/SpellTeleports.plugin.js` and `server/plugins/skills/sailing/BoatTeleport.plugin.js`.

## What OSRS sends

Facts from a live OSRS capture (rsprox) of a player breaking a Varrock teleport tablet (inventory slot 14). Tick 0 is the tick of the click (`if_buttonx` on `inventory:items`, op 2):

| Tick | Sent |
| --- | --- |
| 0 | varbit `busy` (12393) = 1; animation `poh_smash_magic_tablet` (4069) with delay 16; `synth_sound` 965 with delay 15 |
| 2 | spotanim `poh_absorb_tablet_magic` (678); animation `poh_absorb_tablet_teleport` (4071); the tablet leaves its inventory slot |
| 4 | varbit `busy` = 0; the teleport (to 3212, 3423); animation reset (-1) |
| 5 | animation reset (-1) again |

There is no teleport sound of the player's own: a `sound_area` 200 on tick 1 of the capture is at another tile (a nearby player's teleport).

## Implementation

- `TELE_TAB` plays 4069 (delay 16) on the click with sound 965 (delay 15), then 4071 and spotanim 678 as its middle step, lands with the reset animation and resets again the tick after.
- `TeleportTypeOptions` carries what only some teleports do: their own sound instead of the spell teleport sound, the `busy` varbit, and the repeated end animation.
- `TeleportHandler.teleport` takes an `onMiddle` callback; the tablet plugins use it to remove the tablet on tick 2. The usual checks (Wilderness level, teleblock, busy) still run before anything happens, so a refused tablet is never used up.
- `TeleportTask` runs its steps 0 and 1 both on the click's tick (once when submitted, once in that tick's task pass), so step n falls on tick n - 1. `TELE_TAB`'s start tick is 5 so that it lands on tick 4; other teleport types are unchanged until a capture of them shows their timing.
- Every teleport type frees the player on the landing tick (movement, untargetable, click delay), as the capture's `busy` = 0 on tick 4 shows; it used to hold them two more ticks. The release comes before the arrival callback, so a plugin can still hold the player there (boarding a boat, entering a house).
- `server/tests/teleport-tablets.test.cjs` runs a tablet teleport through the real task manager and checks each tick against the table above.

## Not yet checked

The landing tile: the capture landed one tile from our fixed Varrock teleport destination (3213, 3424). OSRS may pick a random tile around the destination; one capture can't tell.
