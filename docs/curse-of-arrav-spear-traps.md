# Uzer Mastaba spear traps (The Curse of Arrav)

Two trap corridors guard the alcoves before the mastaba levers. Each is 2x2 tiles, with four
"Odd markings" locs (`coa_mastaba_spear_trap_1`..`4`, ids 50207-50210) around it:

| Corridor | Tiles | Markings (yarn dump:loc) |
| --- | --- | --- |
| South | x 3891-3892, y 4552-4553 | 3891/3892,4553 (trap_1/2, rot 3); 3891/3892,4551 (trap_4, rot 1) |
| North | x 3891-3892, y 4598-4599 | 3892/3891,4597 (trap_1/2, rot 1); 3891/3892,4599 (trap_3, rot 3) |

Code: `server/plugins/quests/coa/SpearTraps.CurseOfArrav.js`, wired from
`CurseOfArrav.Quest.js`. Test: `server/tests/curse-of-arrav-spear-traps.test.cjs`.

## Behaviour

From the rsprox captures (recording 3168, rev 232, ticks 6658-6984, south corridor):

- **Search, success:** "You find a trap, but you successfully manage to disable it.", synth 2387.
  The player then walks (walk pace, even with run on) straight across the corridor on their own
  row to the tile beyond it (3890 <-> 3893), and the trap doesn't go off.
- **Search, failure:** "You find a trap! You try to disable it, but fail to do so.", synth 4978.
  No damage, and the player stays where they are.
- **Disabling covers only that crossing.** A later plain walk onto the corridor set it off.
- **Set off:** the tick after the player steps onto the corridor: "You accidentally set off a
  trap!", the player says "Ouch!", all four markings of that corridor play `speartrap_release`
  (459), and synth 1394 plays. One tick later comes the hit (19 in the capture). It goes off once
  each time the player steps on.

From the OSRS Wiki (Odd markings (Uzer Mastaba)): the search needs 62 Thieving and gives no XP.
An undisabled trap deals "up to 19 damage".

## Ours

No source gives these:

- The disable chance: half the searches work at 62 Thieving, rising to all of them at 99.
- A search below 62 Thieving always fails, with the recorded failure line.
- The hit is rolled from 1 to 19.
- The north corridor's rows are taken from its markings' footprints; it has no capture.
