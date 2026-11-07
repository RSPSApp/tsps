# Bolt enchanting

The Crossbow Bolt Enchantments spell (https://oldschool.runescape.wiki/w/Enchant_Crossbow_Bolt) turns
gem-tipped bolts into their enchanted form, ten a cast. The effects of the enchanted bolts are
[enchanted-bolts.md](enchanted-bolts.md). The plugin is `server/plugins/skills/BoltEnchanting.plugin.js`
(unit `boltenchanting/Cast.BoltEnchanting.js`) and its table is `server/plugins/skills/data/bolt-enchanting.json`.
It needs the standard spellbook and is members-only.

Sources: the Wiki page above for levels, runes and XP, and rsprox captures for everything else. The
captures are recordings 89, 239 and 1749 (revision 227) for the menu and casts, and
recording 1102 (revision 237, a Leagues world) for the empty-hands answer. Item ids come from the
cache by constant name.

## What it does

- **The spell:** the cache's spell is `Crossbow Bolt Enchantments`, `magic_spellbook:xbows_enchant`
  (218:13, option "View"), Magic level 4 with no runes of its own. The runes belong to each gem.
- **No bolts:** clicking it with none carried says "You have no bolts to enchant." (recording 1102).
- **The menu:** otherwise the skillmulti menu opens, clientscript 2046 with mode 3, the title
  "How many sets of bolts to enchant?", the enchanted bolts as the items (labelled "Ruby bolts (e)")
  and a most of 10 sets (recordings 89, 239, 1749). A set is one cast.
- **The casts:** the first is cast when the amount is chosen, the second 2 ticks later and the rest
  every 3 ticks (recording 89: 1604, 1606, 1609, 1612; the same gaps in 239 and 1749), until the sets
  are done, the bolts run out or the runes do.
- **Each cast:** takes up to ten bolts of the kind (the last cast of a stack takes what is left: 14, 4,
  then none in recording 89), pays the gem's runes, gives the gem's base Magic XP (recording 239: 59 for
  ruby), plays animation 4462 with graphic 759 and sound 2921, and says "The magic of the runes coaxes
  out the true nature of the gem tips." The enchanted bolts join their stack.
- **Kinds:** plain and dragon bolts of every gem, and the Diamond and Onyx ascension bolts. Topaz bolts
  belong to the Red Topaz spell.

| Magic | Gem | Runes per cast | Base XP |
| ---: | --- | --- | ---: |
| 4 | Opal | 2 Air, 1 Cosmic | 9 |
| 7 | Sapphire | 1 Water, 1 Cosmic, 1 Mind | 17.5 |
| 14 | Jade | 2 Earth, 1 Cosmic | 19 |
| 24 | Pearl | 2 Water, 1 Cosmic | 29.5 |
| 27 | Emerald | 3 Air, 1 Cosmic, 1 Nature | 37 |
| 29 | Red Topaz | 2 Fire, 1 Cosmic | 33 |
| 49 | Ruby | 5 Fire, 1 Blood, 1 Cosmic | 59 |
| 57 | Diamond | 10 Earth, 1 Cosmic, 2 Law | 67 |
| 68 | Dragonstone | 15 Earth, 1 Cosmic, 1 Soul | 78 |
| 87 | Onyx | 20 Fire, 1 Cosmic, 1 Death | 97 |

The table is the Wiki's. The menu lists only the kinds carried and within the player's Magic level
(Wiki: "At Magic level 4, only Opal bolts can be enchanted").

## Ours, not captured

- Carrying bolts but too low a level for all of them says "You need a Magic level of N to cast this
  spell." for the lowest, the engine's own wording.
- With a full inventory a cast that has no room for the new enchanted stack is refused with "You don't
  have enough inventory space."
- The menu lists every kind carried; the captures only ever show one kind at a time.
- Walking or acting does not stop a running enchant (Wiki: casting "does not interrupt skilling").

## Checks

`server/tests/bolt-enchanting.test.cjs` covers the empty-hands answer, the menu shape, the level
filter, the cast timing (0, 2, 5), the last partial cast, the missing-runes refusal and the Wiki table
for every gem.
