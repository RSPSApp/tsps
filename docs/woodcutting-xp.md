# Woodcutting XP bonuses

## Seers' Village maples (Kandarin Diary, medium)

OSRS Wiki ([Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting),
[Maple tree](https://oldschool.runescape.wiki/w/Maple_tree),
[Kandarin Diary](https://oldschool.runescape.wiki/w/Kandarin_Diary)): after the medium tier, the
maples in Seers' Village give 10% extra experience, 110 Woodcutting XP per log instead of 100, and
the bonus stacks with the Lumberjack outfit.

- `Woodcutting.plugin.js` gives the maple entry a `diaryXp` reward: when the chopped tree stands in
  the Seers' Village box (the same one the Kandarin diary tasks use) and `diary:is-complete`
  answers true for `kandarin` / `medium`, the log pays 110 XP before the Lumberjack multiplier.
- Maples elsewhere, and players without the tier, still pay 100.
- Where the Wiki does not say whether the outfit multiplies the 110 or adds to the 10%, the outfit
  multiplier is applied to the 110 (a difference of at most a quarter of an XP per log).
- Coverage: `server/tests/woodcutting-diary-xp.test.cjs`.
