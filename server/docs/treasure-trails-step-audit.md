# Treasure Trails clue-step audit

Audit date: 2026-11-04. The catalogue below covers 908 cluehelper rows from the active cache and applies the runtime's `rollable` rules. This counts clue rows available to the trail generator; master includes alternative cryptic parts and helper rows, so its ratio is not a player-facing completion percentage.

| Tier | Rollable rows / cache rows |
| --- | ---: |
| Easy | 166 / 166 |
| Medium | 167 / 167 |
| Hard | 186 / 186 |
| Elite | 124 / 124 |
| Master | 97 / 265 |

Easy, medium, and hard have no cache rows suppressed by the current runtime checks. Elite is now complete after adding the content-backed kills described below. Master three-part cryptic trails have all 30 part candidates in the pool. Viggora's is drawn only for a player who has reached him in Curse of the Empty Lord (see below). Watson's row stays out, and that is a correct exclusion (see "Correct exclusions" below).

Elite Sherlock has all 25 task rows wired.

Master Sherlock has all 26 actionable task rows wired. The cache includes one additional internal helper row for combining the three cryptic parts, which is handled by the trail runtime rather than assigned as a Sherlock task.

## Fixes in this audit

- Elite pyre clues can roll. Burning a pyre ship with mangled bones now spawns the ferocious barbarian spirit; it is removed after 300 ticks if it survives. The wiki confirms that the clue requires burning mangled bones and killing the spirit. [Elite pyre clue](https://oldschool.runescape.wiki/w/Clue_scroll_%28elite%29_-_Surround_my_bones_in_fire%2C_ontop_the_wooden_pyre), [Ferocious barbarian spirit](https://oldschool.runescape.wiki/w/Ferocious_barbarian_spirit).
- The Frost Nagua from *The Heart of Darkness* and Shellbane Gryphon from its private cave count as available kill targets because their quest and boss plugins spawn them.
- Master Sherlock's Fiyr cremation challenge now listens to the existing `shades-of-mortton:cremated` event and checks for Fiyr remains.
- Sacred eels can now be dissected with a knife at 72 Cooking, with the documented 3–9 scale bands and 100 base XP plus 3 XP per scale. This action emits a clue-specific event. [Sacred eel](https://oldschool.runescape.wiki/w/Sacred_eel).
- Empty light orbs can now be completed with cave goblin wire at 87 Crafting for 104 XP. The action emits a clue-specific event, accepted only at the Dorgesh-Kaan bank tiles. [Empty light orb](https://oldschool.runescape.wiki/w/Empty_light_orb).

The RSProx recordings reviewed for this audit corroborate clue and Sherlock scroll transitions (recordings 1034–1036, 1057, and 1063–1067). The available recordings did not capture the pyre-spirit, sacred-eel dissection, or light-orb combination actions, so those action rules use the linked OSRS Wiki pages and do not add guessed animations or action messages.

## Master follow-up (2026-11-05)

- Kill a reanimated abyssal: Master Reanimation already raises the reanimated abyssal (`ArceuusItemSpells`, npc 7038) from an ensouled abyssal head, so the task now counts the player's kill of it. [Reanimated abyssal](https://oldschool.runescape.wiki/w/Reanimated_abyssal).
- Kill a Fiyr shade inside Mort'ton's shade catacombs: the world already spawns ten Fiyr Shadows (1285) in the catacombs, and Shades of Mort'ton raises each into its Fiyr Shade (1286) as the same NPC. The task counts a kill of either id inside the catacombs' map square (3456-3519, 9664-9727, plane 0), so a Temple Trekking shade does not count. [Fiyr Shade](https://oldschool.runescape.wiki/w/Fiyr_shade).
- Piles: the Wiki's only extra condition is the Resource Area entry fee, which the gate now charges (`ResourceArea.plugin.js`). His part rolls again. [Piles](https://oldschool.runescape.wiki/w/Piles).
- Lovada: her Lovakengj spawn at 1485,3834 used 6786, which the current cache makes a hidden Varlamore `vmq1` guard. `sync-npc-spawns.ts --repair-identities` (from the original infobox lines added to `tests/fixtures/npc-spawn-identity-wiki.json`) moved it to 12701, the cache's and the Wiki's Lovada, and her part rolls. A second row named Lovada at 1632,3678 (id 6787, also a `vmq1` form) has no Wiki or cache evidence and is left unchanged. [Lovada](https://oldschool.runescape.wiki/w/Lovada).
- Create a Barrows teleport tablet: the tablet is made at the Arceuus lectern in the Ouditor's house (loc 28802, enum 2628), not a house lectern, which is why no house lectern enum lists it. #2548 added that lectern to `Lectern.Construction.js`; this task counts its `construction:tablet-made` event for a Barrows teleport. Its Study refusals, rune message, border varbit and own Create-last now follow rsprox 235/03899 and the Wiki. [Barrows teleport (tablet)](https://oldschool.runescape.wiki/w/Barrows_teleport_(tablet)), [Lectern (Arceuus)](https://oldschool.runescape.wiki/w/Lectern_(Arceuus)).
- Mix a ranging mix: the recipe is one of Herblore's barbarian mixes. It is learned through Barbarian Training's Herblore section. Otto Godblessed teaches rod fishing (the rod under his bed and a leaping fish), then asks for an attack mix, and handing it over unlocks every mix (`plugins/npcs/BarbarianTraining.plugin.js`, `docs/herblore.md`). The task counts `herblore:made` with the ranging mix(2). [Ranging mix](https://oldschool.runescape.wiki/w/Ranging_mix_%281%29), [Barbarian Training](https://oldschool.runescape.wiki/w/Barbarian_Training).

- Viggora: Curse of the Empty Lord is now on the server (`plugins/quests/quests/CurseOfTheEmptyLord.Quest.js`, with its transcript imported from osrsreboxed-db), and the ring of visibility shows the ghosts (`plugins/items/RingOfVisibility.plugin.js`). The Wiki's requirement is the miniquest up to the point where the player talks to Viggora, plus a ghostspeak amulet (or Morytania legs 2+) and a ring of visibility (or ring of shadows). His part is drawn only for a player whose miniquest stage has reached him (asked through `curse-of-the-empty-lord:viggora`). It is handed over only with the cache outfit worn, and only by the Viggora at the player's own sequence spot: the cache's clue-helper script maps `secret_ghost_randomiser` 1/2/3 to his Rogues' Castle, Slayer Tower and Edgeville Dungeon targets. The torn-part Talk-to hook now also accepts the ghosts' cache spelling `Talk-To`. [Viggora](https://oldschool.runescape.wiki/w/Viggora).

## Correct exclusions

- Watson's cryptic row ("Buried beneath the ground, who knows where it's found. Lucky for you, a man called Watson…") is the Twisted League copy of Jorral's hot/cold starter: in that league Watson handed out the strange device because Jorral was out of reach. On a main-game world the row is never given, so it is not a gap. Watson's main-game role, trading one clue of each lower tier for a master clue, is implemented in `Watson.TreasureTrails.js`. [Watson](https://oldschool.runescape.wiki/w/Watson).
- The targetless "Combine the torn clue scroll parts" Sherlock row is the three-part step's own helper, handled by the trail runtime.

## Still unsupported

### Elite Sherlock challenge scrolls

Every elite task is now assignable. Scoring a goal in Skullball is wired to Werewolf Skullball (`plugins/areas/WerewolfSkullball.plugin.js`), which emits `skullball:goal` for each goal the player's ball crosses in order. [Werewolf Skullball](https://oldschool.runescape.wiki/w/Werewolf_Skullball).

Fixing a magical lamp in Dorgesh-Kaan is wired to the broken lamps (`plugins/areas/DorgeshKaanLamps.plugin.js`): each player has ten broken lamps of the city's 64, and fixing one with a light orb emits `dorgesh-kaan-lamps:fixed`. Making a light orb does not complete this separate repair task. [Lamp (Dorgesh-Kaan)](https://oldschool.runescape.wiki/w/Lamp_(Dorgesh-Kaan)).

Mining nickel and stealing from a chest in Ardougne Castle are wired now that their actions exist: nickel rocks emit `mining:success` with the nickel ore, and the Ardougne Castle chests emit `thieving:success` with method `chest`. [Sherlock/Elite](https://oldschool.runescape.wiki/w/Sherlock/Elite).

### Master three-part cryptic parts

None: every part can be drawn.

## Verification

`npm run build --prefix server` passes. A direct active-cache catalogue inspection confirms the row counts above and confirms that no elite rows are suppressed. The test suites were not run.

Master follow-up (2026-11-05): an active-cache catalogue load gives 96 rollable master rows and 29 parts; `tests/treasure-trails-master.test.cjs` covers the two new tasks (inside and outside their area) and Piles' and Lovada's torn parts, and the spawn sync's repair was run twice from the fixture with no change on the second run.

Ranging mix follow-up (2026-11-05): `tests/barbarian-training.test.cjs` covers Otto's topics, the bed, the catch, the unlock and the mix; `tests/treasure-trails-master.test.cjs` now covers the ranging mix task with the other master tasks. Live on a slot server, a rolled master clue on this step completed with a made ranging mix, and Sherlock gave the next clue.

Viggora (2026-11-05): `tests/treasure-trails-master.test.cjs` checks the pool has 30 parts and that Viggora is never drawn before the miniquest reaches him, but is drawn after. It also checks his part is handed over only with the outfit, at the player's own spot and with the cache's `Talk-To` option. `tests/curse-of-the-empty-lord.test.cjs` covers the miniquest's three sequences. On a slot-39 QA server, the headless player was refused at the wrong-sequence Viggora and without ghostspeak, and was handed the torn part at their own spot with the outfit.
