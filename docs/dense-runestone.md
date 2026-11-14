# Dense runestones (Arceuus essence mine)

`server/plugins/skills/mining/DenseRunestone.Mining.js`, attached by the Mining plugin.

## Sources

- rsprox captures (rsprox.net index): 1669 (rev 226: a run to depletion with the medium
  Kourend & Kebos Diary, the respawn, Check on the depleted pillar, a full inventory), 1670
  (no tools), 1672 and 3899 (rev 235: both pillars, more respawns).
- Wiki: Dense runestone, Dense essence block, Kourend & Kebos Diary.

## The pillars

The map places two cache multilocs east of the Dark Altar: `arceuus_runestone_base_1` (8981,
1762,3856) on varbit `arceuus_runestone_1` (4927) and `arceuus_runestone_base_2` (10796,
1762,3844) on `arceuus_runestone_2` (4928). Value 0 shows the Dense runestone (8975, Chip), 1 the
Depleted runestone (8976, Check). `arceuus_runestones` (4929) names the depleted pillar (1 or 2,
0 for none). Depletion is per player (Wiki), so it lives only in the player's varbits and is not
saved.

## Chipping (rec 1669 from tick 6)

- Needs 38 Mining, 38 Crafting, a pickaxe and a chisel (Wiki). The pickaxe tier doesn't change
  the speed (Wiki).
- The swing (the pickaxe's mining animation) the tick after arrival, `arceuus_chisel_essence`
  (7201) 3 ticks later, and on the 9th tick a block, sound 3600, 12 Mining XP and 8 Crafting XP;
  the swing starts again the same tick. Blocks come every 9 ticks (ticks 16, 25, 34, 43).
- Medium Kourend & Kebos Diary: a 5% chance of two blocks (Wiki), with the spam line "You mined
  an extra block of essence thanks to your completion of the Kourend & Kebos Medium Diary." and
  no extra XP (rec 1669 ticks 25 and 34: one XP drop of 12/8).
- After each block the pillar stays with the Wiki's chance by Mining level (85.5% at 38-42 up to
  90.2% at 97-99). Otherwise it depletes on that block's tick: the pillar's varbit and
  `arceuus_runestones`, the reset animation, the block, sound 3600, `add_overlaytimer_loc` (5474)
  with the multiloc, shape 10, timer 1, the respawn ticks and colour 16765184, then sound 2661.
- The respawn ticks in the captures' timers are 25, 26, 28, 29 and 29, and the varbits clear
  when they run out (rec 1669 ticks 43-69, rec 3899 ticks 5283-5308, 5316-5342, 5410-5439).
  One respawn does not: rec 1669's depletion at tick 130 sends a 29-tick timer but the varbits
  clear at tick 171, 41 ticks later. We clear on the timer, as every other recorded respawn does.

## Refusals

- No pickaxe or no chisel: sound 2277 and objectbox_double with `bronze_pickaxe` and `chisel`,
  "You need a pickaxe and chisel to chip anything off this." (rec 1670 tick 13).
- A full inventory: sound 2277 and a message box, "You don't have space to chip anything off."
  (rec 1669 tick 209).
- Check on a depleted pillar: sound 2661 and a message box, "The runestone has been mined to
  depletion." (rec 1669 ticks 151 and 157).

## Ours

- The line for chipping under 38 Mining or Crafting: no capture or Wiki text.
- Only one pillar is out at a time: `arceuus_runestones` holds one pillar and no capture shows
  both out, so depleting one brings the other back if it was still out.
- A level-up pop-up holds chipping until Continue (as every Mining session does); then the swing
  starts again and the next block is 9 ticks on. The levels, chisel and a usable pickaxe are
  re-checked every tick, so a boost wearing off below 38 stops it.
- Filling the inventory mid-run gives the full-inventory box when the next block is due.
- Not modelled: the Wiki's re-randomised depletion on re-entering the mine, and its chance at
  higher Mining of a 2-tick skilling delay in place of 3 (no formula).
