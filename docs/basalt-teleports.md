# Basalt teleports

Icy basalt's Weiss option (op2) teleports to Weiss once Making Friends with My Arm is complete.
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

## Not done

- Stony basalt (Troll Stronghold). Its one capture (rec 1631, rev 226) lands at (2838, 3693, 0)
  with spotanim `my2arm_flame_teleport_spot`, but the rev 242 cache gives it entrance, roof and
  Toggle options (Wiki: 17 December 2025) that no capture shows.
