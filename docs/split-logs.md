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
- Each cycle rechecks the current level and usable axe; replacing the interaction or performing an
  emote stops the batch. The exact interruption and requirement-loss responses are not captured.

## Making the shield

Rec 3027 tick 9355 (the shield choice, amount 4) makes one shield 2 ticks after the choice, then
another 3 ticks later, the second while the first is still carried. Each one sends
`You make a Neitiznot shield.` (spam), `human_woodcrafting_hammer`, synth sound 2101 and
34 Crafting XP. The selected quantity is limited by the carried recipe materials: two arctic pine
logs, one bronze nail and one rope per shield, with a hammer and current Woodcutting level 56.
Carrying an earlier shield does not prevent another. The quest owns the recipe through
`woodcutting:stump-shield`; both stump recipes share one interruptible task. Walking, an emote,
a blocking interface, disconnect or a new stump selection stops the pending batch. Each output
keeps the existing `fremennik-isles:shield-made` diary event. Completed outputs and XP save
normally; a pending batch does not resume on login.

The existing quest-stage 17 gate is retained. The recording establishes batching and XP, not
the exact earliest quest unlock; that stage question remains outside this fix. Requirement-loss
and interruption responses are not recorded. Wiki: [Neitiznot shield](https://oldschool.runescape.wiki/w/Neitiznot_shield)
gives the recipe, level, 34 Crafting XP and three-tick rate. The pinned rev241 dump and active
cache identify `human_woodcrafting_hammer` as sequence 5754; sound 2101 is the recorded synth.
