# Split logs (Neitiznot woodcutting stump)

The woodcutting stump in Neitiznot (loc `iznot_shield_stump`, 21305) splits arctic pine logs into
split logs and makes the Neitiznot shield. Code:
`server/plugins/skills/woodcutting/SplitLogs.Woodcutting.js`; the shield itself stays with The
Fremennik Isles (`woodcutting:stump-shield`).

## rsprox captures

rsprox.net recording 3027 (rev 231), ticks 8906-11229, four Cut-wood clicks:

- With arctic pine logs carried, Cut-wood opens skillmulti mode 0, "How many do you wish to
  make?", with "Neitiznot shield" then "Arctic pine split log", up to the number of logs.
- Without arctic pine logs: `Only arctic pine may be cut here.` (game message), no menu.
- Choosing the split log (tick 10540): two ticks later, then every 3 ticks, one log becomes a split
  log in the same inventory slot, each with `You split some arctic pine logs.` (spam), the axe's
  woodcrafting sequence (a dragon axe: `human_woodcrafting_axe_dragon`), synth sound 2101 and
  5 Woodcutting XP.
- Choosing the shield without the parts (tick 10499): `You need 2 arctic pine logs, a bronze nail
  and some rope to make a Neitiznot shield.`

## Wiki

Split log: level 56 Woodcutting (boostable), 5 XP per log with the lumberjack outfit bonus, 3 ticks
per log, an axe and the woodcutting stump.

## Ours

- The level and no-axe refusals: not captured, so their wording is ours.
- Axes other than the dragon axe play the cache's `human_woodcrafting_axe_*` (felling axes:
  `human_woodcrafting_*_2h_axe`) sequence of the same axe; only the dragon axe's is recorded.
