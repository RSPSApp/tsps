# Chaos druids

The level 13 druids in the Edgeville Dungeon's Wilderness part, the Chaos Druid Tower, Taverley Dungeon,
Slepe and the Yanille Agility Dungeon (`server/plugins/npcs/ChaosDruid.plugin.js`, tests in
`server/tests/chaos-druid.test.cjs`).

## Sources

- **The Wiki** ([Chaos druid](https://oldschool.runescape.wiki/w/Chaos_druid)): "They attack with their
  fists and make use of a spell that appears to be a combination of the Confuse and Bind spells, binding
  their target very briefly if successful." Max hit 2 (melee), attack speed 4.
- **rsprox capture** (rev 243, Edgeville Dungeon, ticks 172-387): 35 punches and 33 casts on two players.

## The punch

`human_unarmedpunch` (422), with its hit on the same tick. The druid blocks with `human_unarmed_def` (425)
and dies with `human_death` (836).

The NPC's observed animations list both the punch and the cast (`human_castentangle`, 710), and both
names read as an attack. The NPC loader used to take the first in the list, so the druid punched with the
cast. A melee NPC now takes its melee animation and a magic one its cast (`NpcDefinitionLoader.byStyleFit`).
That also changed the attack animation of 14 other NPCs without a hand-made or captured attack:

| NPC | Was | Now |
| --- | --- | --- |
| Druid (3258) | `human_castentangle` | `human_unarmedpunch` |
| Jungle Demon (1443, 6382) | `demon_casting` | `demon_attack` |
| Killerwatt (469) | `killerwatt_biped_cast` | `killerwatt_biped_attack` |
| Mutant tarn (6477) | `lotr_tarn_mutant_summon_spell` | `lotr_tarn_razorlor_mutant_attack` |
| Shaeded Beast (8709), magic | `lotr_tarn_razorlor_mutant_attack` | `lotr_tarn_mutant_summon_spell` |
| The In Search of the Myreque vampyres (3711, 3721, 3724) | `myq3_vampire_teleport_spell_casting` | `myq3_neck_bite` |
| 4306 (no monster entry) | `human_casting` | `human_throw` |
| Brutal green, red and Mithril dragons (2918, 7274, 8087, 8089) | `brut_dragon_casting` | `dragon_firebreath_all_attack` |

The dragons' plugin plays its own animations, so their change does not show in game.

## The cast

| | Live |
| --- | --- |
| The druid | `human_castentangle` (710), `entangle_casting` (177) at height 92, area sound `bind_cast` (101) |
| The projectile | `entangle_travel` (178): starttime 75, endtime 46 + 10 a tile (56, 66 and 76 recorded), angle 16, progress 64, heights 180 to 0 |
| On a hit | `bind_impact` (181) on the player, slot 2, height 124, and area sound `bind_impact` (99), both delayed to the endtime |
| On a splash | `failedspell_impact` (85) and `spellfail` (227) the same way |
| Damage | None: no hitsplat |

A landed cast:
- on the cast's tick, lowers Attack by floor(5%) + 1 (81 to 76) with "You feel weakened.". The second landed
  cast, with Attack still at 76, drained nothing and said nothing, as Confuse;
- says "The holding effect is beginning to fade." 6 ticks after the cast (both recorded casts), here only if
  the hold took.

The player plays no animation on a cast: it is a magic attack, not a blocked swing.

Ours: the hold. The Wiki says the spell binds "very briefly", and neither landed cast shows the player held
(they moved again as soon as they clicked), so it is one tick, landing with the projectile, floor(endtime / 30)
ticks after the cast. Bind's own 8 ticks don't apply.

The drain is StandardCurses' Confuse; the druid sets its amount and line (`magic:curse-rule`). The hold is a
`bind` freeze (`CombatFactory.freezeTicks`), so the freeze immunity that follows it applies.

## Which attack

29 of the 35 recorded casts were from the next tile; the rest were from 2-3 tiles, where a punch can't
reach.

Ours (no source gives these):
- a druid casts or punches at even odds, the recorded split, wherever it stands. A cast reaches up to 10 tiles
  (the generic NPC cast range); a picked punch walks it in first;
- out of a fight it has melee reach, so it hunts and aggros as a melee monster (3 and 8 tiles).
