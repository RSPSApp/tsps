# Goading potion

`server/plugins/items/GoadingPotion.plugin.js` (members only). The doses are drunk through the
shared potion path in `Potions.plugin.js` (registered with the `potions:register` event); the
plugin owns the timer, the aggression pulse and the ways it ends. Test:
`server/tests/goading-potion.test.cjs`.

## Sources

- [OSRS Wiki: Goading potion](https://oldschool.runescape.wiki/w/Goading_potion): the effect, the
  9x9 area with line of sight, the 6-tick cycle starting one tick after the drink, single-way
  combat, the Slayer level condition, six minutes per dose, and cancelling by tea or teleport.
- rsprox recordings 821 (rev 234), 3402 and 3414 (rev 235), 4056, 4066, 4069, 4073, 4092, 4094,
  4099 and 4101 (rev 237), 4242 (rev 238): messages, the timer varbit and the cancellations.

## What the captures show

- Drinking: the `human_eat` animation, sound 2401, "You drink some of your goading potion.", then
  "You have N doses of potion left." (or "You have finished your potion."), and
  `goading_potion_timer` goes from 0 to 100 on the same tick.
- The timer drops one every six ticks (a gap of 6 between every step in recording 821), so a dose
  lasts 600 ticks. At 3 the red line "Your Goading potion has almost run out!" arrives, at 0 "The
  effects of your Goading potion have worn off."
- Drinking while it runs sets it straight back to 100 (32 to 100 in recording 821).
- A teleport sets the varbit to 0 and sends the worn-off line on the tick of the teleport (the Crystal
  of echoes recall in recording 821, a teleport crystal in 4092, and teleports in 4094, 4099, 4101, 3414). Drinking
  a cup of tea does the same on the tick of the drink ("You drink the tea." comes first;
  recording 4101).

## What the plugin does

- Timer: the cycle the dose was drunk on is kept on the player; the varbit is derived from the
  ticks since (100 minus a step per six). Nothing else is stored.
- Aggression: from one tick after the drink, then every six ticks, each monster in the player's
  local NPC list within four tiles (a 9x9 area) that can be attacked, has a combat level, is not in
  combat, is in view of the player (`RegionManager.canProjectileAttackTarget`) and has a Slayer
  requirement the player's current Slayer level meets, runs the ordinary `CombatFactory.canAttack`
  check and attacks the player. In single-way combat the first one does and the loop stops.
- Ending: `teleport:landed` and `food:eaten` (any "Cup of tea") end it with the worn-off line.

## Limits

- The timer is not kept over a logout and nothing is persisted: no capture shows what live OSRS does.
- Death clears the potion silently; no capture shows a line.
- Only the ordinary "Cup of tea" (and its older id) cancels it. The Wiki says "a cup of tea" and
  only that one has a recording.
- Monsters already on their way to another target are left alone; the Wiki's "already targeting
  another player" is covered by `canAttack`'s single-way lock only.
- Potions in general do not send "You drink some of your ... potion." or the doses-left line in
  this server; the goading potion sends its own, the rest is not touched here.
