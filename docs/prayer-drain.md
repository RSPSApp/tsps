# Prayer drain

Prayer points are drained by `PrayerHandler.processDrain` (`server/src/main/typescript/elvarg/game/content/PrayerHandler.ts`),
once per tick while a prayer is on. Tests: `server/tests/prayer-drain.test.cjs`.

## Sources

- **The OSRS Wiki, [Prayer](https://oldschool.runescape.wiki/w/Prayer):** every prayer has a drain
  effect; each tick the effects of the active prayers are added to a counter, and a point is lost
  each time the counter reaches the drain resistance, `60 + 2 * prayer bonus`. Examples from the
  page: Thick Skin (1) costs a point every 36 seconds and Protect from Melee (12) every 3 seconds
  at 0 bonus.
- **rsprox recordings** ([rsprox.net database](https://rsprox.net/database)): recordings 1764 and
  1852 (rev 227) and 4152 (rev 238) show Prayer drop to 0 on one tick and the prayers switched
  off, with the message below, on the next. Recordings 1224, 1232 and 4134 (rev 238) carry the
  same message with the prayers switched off.

## What the server does

- The drain effects are the Wiki's whole numbers (`PrayerData.drainEffect`): Thick Skin, Burst of
  Strength, Clarity of Thought, Sharp Eye, Mystic Will and Rapid Restore 1; Rapid Heal, Protect
  Item and Preserve 2; Retribution 3; Redemption and the tier 2 combat prayers 6; Smite 18; the
  tier 3 combat prayers, the three Protect prayers and Chivalry 12; Piety, Rigour and Augury 24. Before, the
  numbers were per-minute rates scaled by 0.6, which drained the first-tier prayers three times as
  fast (Thick Skin took a point every 12 seconds), Chivalry almost twice as fast, and Rapid
  Restore, Rapid Heal, Protect Item, Preserve, Smite, Piety, Rigour and Augury slightly off.
- A prayer switched on is not charged on its own tick (1-tick flicking stays free).
- When Prayer is 0 at the start of the next drain tick, every prayer is switched off and the
  player gets "You have run out of prayer points, you can recharge at an altar." Whatever
  took the points to 0 (drain, Smite) leads to the same shutdown. The old text was "You have run out
  of Prayer points!", sent on the same tick, with an extra copy of the switch-off sound on
  top of the per-prayer ones; the recordings have only the per-prayer sounds.

## Resetting the counter

The Wiki's [Prayer](https://oldschool.runescape.wiki/w/Prayer) page says the prayer fraction (the
drain counter) "can be reset through a rejuvenation pool, the Falador shield prayer recharge, or
dying", and that drinking a Prayer potion does not reset it. The
[Falador shield 4](https://oldschool.runescape.wiki/w/Falador_shield_4) page dates the recharge
reset to April 2023. So `FaladorShield.DiaryRewards.js` (only on a recharge that spends a charge,
not at full Prayer or with no charge left) and `RejuvenationPool.plugin.js` (the pools that restore
Prayer) call `player.setPrayerPointDrain(0)`; Prayer potions leave it alone. Before, the counter
carried over, so the next point went early. Checked in game with Thick Skin on: with the counter at
about 40, a recharge moved the next point from about 10 ticks away to a full 60 ticks away. Test:
`server/tests/diary-rewards.test.cjs`. Dying already clears it, as the prayers are switched off.

## Not covered

- Redemption (`CombatFactory.handleRedemption`) still switches the prayers off at once with its
  own message; no recording was checked for it.
- The "You have been disabled and can no longer use protection prayers." texts of the prayer
  block (`PrayerHandler.canUse`, `CombatFactory`) differ from the recorded "You've been injured and
  can't use protection prayers!".
