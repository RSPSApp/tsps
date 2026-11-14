# Necklace of faith

Plugin: `server/plugins/items/NecklaceOfFaith.plugin.js`. Sources: the OSRS Wiki page
<https://oldschool.runescape.wiki/w/Necklace_of_faith> and rsprox captures (rsprox.net
recording 3167, revision 232, ticks 192-193, the only indexed activation).

## Behaviour

- Damage that leaves the wearer alive below 20% of their maximum Hitpoints (19 or less at 99)
  restores 25% of their Prayer level, rounded down, to their prayer points (capped at the level)
  and destroys the necklace (Wiki). A hit that takes the wearer from above 20% straight to 0 does
  nothing.
- Any damage counts: in recording 3167 the hit was the locator orb's self-damage (29 to 19 of 99).
  It runs on `combat:damage-applied`, which `Mobile.decrementHealth` emits once HP is taken.
- Same tick as the hit (recording 3167, tick 193): the game message
  "Your necklace of faith restores some prayer, but is destroyed in the process.", the worn
  amulet slot (slot 2) emptied, and the new Prayer level. No graphic or sound of its own.
- Redemption is checked after the damage lands (`HitQueue` -> `CombatFactory.handleRedemption`),
  so with Redemption active the necklace fires first and Redemption then drains the restored
  points, as the Wiki says.

## Not verified

In recording 3167 Prayer went from 0 to 24 at Prayer level 87; 25% of 87 is 21. One activation
can't tell a different percentage from a flat bonus, so the Wiki's 25% stays until a second
activation at another Prayer level is recorded. Being already below 20% when the necklace is put
on and then taking a hit fires it here (ours; not captured).
