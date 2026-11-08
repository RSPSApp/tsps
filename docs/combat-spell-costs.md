# Combat spell costs

Levels, XP, base maximum hits and rune costs of the Standard, Ancient and Arceuus combat and
curse spells live in `server/src/main/typescript/elvarg/game/content/combat/magic/CombatSpells.ts`.
`server/tests/spell-rune-costs.test.cjs` holds the whole table and compares every spell with it.

## Sources

OSRS Wiki pages read for this table:

- [Standard spellbook](https://oldschool.runescape.wiki/w/Standard_spellbook), and the pages of
  [Fire Strike](https://oldschool.runescape.wiki/w/Fire_Strike),
  [Claws of Guthix](https://oldschool.runescape.wiki/w/Claws_of_Guthix),
  [Flames of Zamorak](https://oldschool.runescape.wiki/w/Flames_of_Zamorak),
  [Stun](https://oldschool.runescape.wiki/w/Stun),
  [Bind](https://oldschool.runescape.wiki/w/Bind) and [Snare](https://oldschool.runescape.wiki/w/Snare)
- [Ancient Magicks](https://oldschool.runescape.wiki/w/Ancient_Magicks), and the pages of
  [Ice Rush](https://oldschool.runescape.wiki/w/Ice_Rush) and
  [Smoke Burst](https://oldschool.runescape.wiki/w/Smoke_Burst)
- [Arceuus spellbook](https://oldschool.runescape.wiki/w/Arceuus_spellbook) and
  [Inferior Demonbane](https://oldschool.runescape.wiki/w/Inferior_Demonbane)

No rsprox recording turned up for these spells (the index has no spellbook component for them), so the Wiki is the only source here.

## What was wrong

| Spell | Before | Wiki |
| --- | --- | --- |
| Fire Strike | 1 air, 1 mind, 3 fire | 2 air, 1 mind, 3 fire |
| Claws of Guthix | 4 air, 2 blood, 2 fire | 4 air, 2 blood, 1 fire |
| Flames of Zamorak | 4 air, 2 blood, 2 fire | 1 air, 2 blood, 4 fire |
| Stun | 12 earth, 12 water, 1 air | 12 earth, 12 water, 1 soul |
| Inferior Demonbane | 3 fire, 1 soul | 3 fire, 1 chaos |
| Ice Rush | max hit 18 | max hit 16 |
| Smoke Burst | max hit 13 | max hit 17 |

Bind and Snare award 31 and 61 XP on a hit (30 and 60 on a splash), as the Wiki pages say, so the
table keeps the hit values.
