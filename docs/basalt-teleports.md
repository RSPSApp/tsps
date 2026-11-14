# Basalt teleports

Icy basalt's Weiss option (op2) teleports to Weiss once Making Friends with My Arm is complete.
Stony basalt teleports to the Troll Stronghold entrance or, with 73 Agility and the hard
Fremennik Diary, its roof.
The plugin is `server/plugins/items/BasaltTeleports.plugin.js`; the test is
`server/tests/basalt-teleports.test.cjs`.

## What OSRS sends

From rsprox captures of the inventory op on `weiss_teleport_basalt` (rsprox.net recordings 1633,
312, 3154, 1694; rev 226-232, all agree). Tick 0 is the click:

| Tick | Sent |
| --- | --- |
| 0 | sequence `my2arm_fire_teleport_human` (8172); spotanim `my2arm_flame_teleport_weiss` (1628), delay 10; `sound_area` 2596, range 10, at the player's tile; one basalt leaves the inventory |
| 4 | the teleport, to (2846, 3940, 0) in every recording; sequence -1 |
| 5 | sequence -1 again |

There is no `busy` varbit, unlike the scrolls and tablets (docs/teleport-tablets.md).

## Rules

- The Wiki (Icy basalt): it "may only be used after finishing Making Friends with My Arm", and
  using it at the destination says "You are already here. You don't want to burn to ashes then
  reconstitute, just to travel to the same place do you?". The destination square on the Wiki
  is radius 2 around (2846, 3938); standing in it gives that line and uses nothing.
- The usual teleport checks (`TeleportHandler.checkReqs`, Wilderness level 20, teleblock) and
  `TeleportHandler.confirm` run before the basalt is used.
- Ours: the line for a player without the quest ("You need to complete Making Friends with My
  Arm to use this."); neither the captures nor the Wiki give it.

## Stony basalt

The rev 242 cache gives it four options: "Troll Stronghold" (the left-click), "Troll Stronghold
entrance", "Troll Stronghold roof" and "Toggle" (Wiki: added 17 December 2025).

- **Captured** (rsprox.net rec 1631, rev 226, tick 577): the same teleport as icy basalt, with
  spotanim `my2arm_flame_teleport_spot` (1617), delay 10, sequence `my2arm_fire_teleport_human`,
  one basalt used on the click, the landing on tick 4 at (2838, 3693, 0). That tile is the top
  of the 73 Agility Troll Stronghold rocks (`skills/data/agility-shortcuts.json`), the roof: in
  rev 226 the left-click went to the roof whenever the player could.
- **Wiki (Stony basalt):** the entrance square is radius 2 around (2845, 3694), the roof square
  radius 2 around (2837, 3695). The roof needs 73 Agility, which may be boosted, and a player
  drained below a 73 base still lands there; and the hard Fremennik Diary. Toggle sets which of
  the two the left-click takes; before it, the left-click took the roof when the player
  qualified, otherwise the entrance. The sound is `fire_lit` (2596). Standing in a destination
  square gives the "already here" line.
- **Cache:** the toggle is varbit 19649 `my2arm_stronghold_tele_toggle` (bit 30 of
  `my2arm_perm_1`). It is saved as a player attribute and sent at login.
- **Ours:** the entrance landing tile (the Wiki square's centre, no capture lands there); 0 as
  the roof setting; the Toggle lines ("Your stony basalt will now take you to the Troll
  Stronghold entrance." / "... roof when possible."); the roof option's refusal ("You need 73
  Agility and the hard Fremennik Diary to teleport to the Troll Stronghold roof."). The
  left-click set to the roof falls back to the entrance without a message.

