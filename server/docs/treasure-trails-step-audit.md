# Treasure Trails clue-step audit

Audit date: 2026-11-04. The catalogue below covers 908 cluehelper rows from the active cache and applies the runtime's `rollable` rules. This counts clue rows available to the trail generator; master includes alternative cryptic parts and helper rows, so its ratio is not a player-facing completion percentage.

| Tier | Rollable rows / cache rows |
| --- | ---: |
| Easy | 166 / 166 |
| Medium | 167 / 167 |
| Hard | 186 / 186 |
| Elite | 124 / 124 |
| Master | 94 / 265 |

Easy, medium, and hard have no cache rows suppressed by the current runtime checks. Elite is now complete after adding the content-backed kills described below. Master three-part cryptic trails have 27 safe part candidates. Four other candidate rows remain excluded: Piles depends on the Resource Area entry fee, Viggora depends on the absent Curse of the Empty Lord quest, Watson belongs to the alternate Twisted League clue flow, and the current Lovada cache spawn resolves to other NPC definitions rather than Lovada.

Elite Sherlock has 21 of 25 task rows wired; its four unsupported tasks are listed below. Master Sherlock has 22 of 26 actionable task rows wired; the four unsupported tasks are also listed below. The cache includes one additional internal helper row for combining the three cryptic parts, which is handled by the trail runtime rather than assigned as a Sherlock task.

## Fixes in this audit

- Elite pyre clues can roll. Burning a pyre ship with mangled bones now spawns the ferocious barbarian spirit; it is removed after 300 ticks if it survives. The wiki confirms that the clue requires burning mangled bones and killing the spirit. [Elite pyre clue](https://oldschool.runescape.wiki/w/Clue_scroll_%28elite%29_-_Surround_my_bones_in_fire%2C_ontop_the_wooden_pyre), [Ferocious barbarian spirit](https://oldschool.runescape.wiki/w/Ferocious_barbarian_spirit).
- The Frost Nagua from *The Heart of Darkness* and Shellbane Gryphon from its private cave count as available kill targets because their quest and boss plugins spawn them.
- Master Sherlock's Fiyr cremation challenge now listens to the existing `shades-of-mortton:cremated` event and checks for Fiyr remains.
- Sacred eels can now be dissected with a knife at 72 Cooking, with the documented 3–9 scale bands and 100 base XP plus 3 XP per scale. This action emits a clue-specific event. [Sacred eel](https://oldschool.runescape.wiki/w/Sacred_eel).
- Empty light orbs can now be completed with cave goblin wire at 87 Crafting for 104 XP. The action emits a clue-specific event, accepted only at the Dorgesh-Kaan bank tiles. [Empty light orb](https://oldschool.runescape.wiki/w/Empty_light_orb).

The RSProx recordings reviewed for this audit corroborate clue and Sherlock scroll transitions (recordings 1034–1036, 1057, and 1063–1067). The available recordings did not capture the pyre-spirit, sacred-eel dissection, or light-orb combination actions, so those action rules use the linked OSRS Wiki pages and do not add guessed animations or action messages.

## Still unsupported

### Elite Sherlock challenge scrolls

These tasks remain excluded from assignment because the server does not implement the underlying action: fix a magical lamp in Dorgesh-Kaan, mine nickel, score a goal in Skullball, and steal from a chest in Ardougne Castle. Making a light orb does not complete the separate magical-lamp repair task.

### Master clue tasks

- Create a Barrows teleport tablet: the active cache defines the item, but none of the lectern enums supplied to the client offers it. The current lectern interface is driven by those enums, so there is no selectable route to make it until the cache enum or client interface is extended. [Barrows Teleport](https://oldschool.runescape.wiki/w/Barrows_teleport).
- Mix a ranging mix: the recipe is absent, and the Barbarian Herblore training unlock is not implemented. Keep it unassigned until both the recipe and its unlock are represented. [Ranging mix](https://oldschool.runescape.wiki/w/Ranging_mix_%281%29).
- Kill a reanimated abyssal: the Master Reanimation spell that creates the NPC is not implemented. [Reanimated abyssal](https://oldschool.runescape.wiki/w/Reanimated_abyssal).
- Kill a Fiyr shade inside Mort'ton's shade catacombs: the Catacombs plugin does not spawn Fiyr Shades. Adding guessed spawns would make this task appear supported without a verified encounter. [Fiyr Shade](https://oldschool.runescape.wiki/w/Fiyr_shade).

## Verification

`npm run build --prefix server` passes. A direct active-cache catalogue inspection confirms the row counts above and confirms that no elite rows are suppressed. The test suites were not run.
