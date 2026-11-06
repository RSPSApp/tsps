# Skulling

How a player gets a PK skull and how long it lasts. The attack rules are
`CombatFactory.handleSkull` (called when an attack against a player is queued), the countdown is
`Player.processSkullTimer`, and the item skulls are `plugins/items/CapeOfSkulls.plugin.js` and
`plugins/npcs/revenants/Avarice.Revenants.js`.

## Facts

From the Wiki: [Skull (status)](https://oldschool.runescape.wiki/w/Skull_(status)),
[Amulet of avarice](https://oldschool.runescape.wiki/w/Amulet_of_avarice) and
[Cape of skulls](https://oldschool.runescape.wiki/w/Cape_of_skulls).

- **Attacking a player** unprovoked in the Wilderness skulls the attacker for 30 minutes. The
  attacked player can fight back without being skulled.
- **Already skulled:** attacking a player again restarts the 30 minutes ("If a player ...
  initiates combat with another player, the skull timer will reset"; since 9 December 2021 the
  skull "cannot disappear during PvP combat"). The skull keeps its colour. **Ours:** a skull
  with longer left is never shortened by this, or by the items below.
- **Running out:** the skull icon goes from over the player's head on the tick the timer reaches
  zero.
- **Amulet of avarice:** worn, it keeps the player skulled; the skull lasts until 20 minutes
  after it comes off. Its effects apply whatever the skull's source.
- **Cape of skulls:** putting it on skulls the player for the next 20 minutes. The skull wears
  off after those 20 minutes even while the cape stays on; putting it on again, or hopping
  worlds with it on, skulls the player again. Putting it on asks first ("Attempting to equip
  the cape gives a warning"); the cape goes on and skulls only on "Yes", and "No" changes
  nothing.
- **Abyss:** a skull from entering the Abyss lasts 10 minutes after leaving it, and entering again
  restarts it.
- **PK Skull Prevention:** the `settings_side:skull_prevention` toggle (setting 206, varbit
  `skull_prevent_enabled` 13131) blocks an attack that would skull the player with
  "You cannot attack this target as it would result in you getting skulled." (rsprox recording
  4171). It does not block attacking while already skulled, or retaliating against a player
  already in combat with them.

## Not done

- **Abyss skull:** `Runecrafting.plugin.js` skulls for 10 minutes from entering the Abyss rather
  than from leaving it, and replaces a longer skull with those 10 minutes. Left for after
  PR #1068, which reworks that plugin.
- **Equip warnings:** the Wiki says the amulet of avarice and the cape of skulls warn before they
  are put on, but not what the warning says. The cape's warning uses our own wording, and the
  amulet has none yet.
