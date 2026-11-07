# Imbued heart and saturated heart

`server/plugins/items/ImbuedHeart.plugin.js` (Invigorate for both hearts), with the clocks and varbits in
`imbuedheart/Timers.ImbuedHeart.js` and the upgrade in `imbuedheart/Saturate.ImbuedHeart.js`. The boost
itself is an ordinary temporary one (`ConsumableEffects.boostSkill`); Potions' minute-by-minute decay asks
the `stats:boost-held` custom event which skills to leave alone.

## Behaviour

Sources: OSRS Wiki [Imbued heart](https://oldschool.runescape.wiki/w/Imbued_heart) and
[Saturated heart](https://oldschool.runescape.wiki/w/Saturated_heart), and the rsprox captures below.

| | Imbued heart | Saturated heart |
| --- | --- | --- |
| Magic boost | 1 + 10% of the base level, rounded down | 4 + 10% of the base level, rounded down |
| Wait | 7 minutes | 5 minutes |
| Boost | decays a level a minute like a potion's | held for the 5 minutes, then ends |

- The heart is never used up. The wait is per player and shared by both hearts, however many are carried.
  It survives logging out and is reset by death.
- The saturated heart is made by using 150,000 ancient essence on an imbued heart. The Wiki recipe needs
  Magic 1 and pays 500 Magic experience.

## Captures (rsprox)

- **Saturated heart Invigorate** (recordings 472, 475, 476, 1696, 1702, 1703): spotanim
  `imbued_heart_impact02`, synth 6847, varbits `imbued_heart_timer` 0->50, `saturated_heart_base` 0->112
  (the boosted level of a 99) and `saturated_heart_time` 0->500.
- **Clocks:** `imbued_heart_timer` drops one every ten ticks (70 after an imbued heart in 1763; 50 after a
  saturated one); `saturated_heart_time` drops one every tick (1702, 1774). The boosted level stays put
  throughout (238/04152).
- **Running out** (238/04152, 1696, 1703, 472, 475, 476): `imbued_heart_timer` and `saturated_heart_time`
  reach 0 on the same tick with "Your saturated heart has regained its magical power." then "The effects of
  the saturated heart have worn off."; `saturated_heart_base` goes to 0 and the Magic level is the base
  level again. Revision 238 colours both lines `ff3045`. The imbued heart's matching line, "Your imbued
  heart has regained its magical power.", is seen once (1763, Leagues).
- **Upgrading** (1767, 1774; both Leagues): with too little essence an item box shows the imbued heart and
  "You'll need 150,000 ancient essence to saturate your imbued heart."; otherwise a message box warns "Do you
  wish to use 150,000 ancient essence to saturate your imbued heart? This process is non-reversible.", then
  "Do you wish to saturate your imbued heart?" with "Yes." / "No.". On Yes the essence is spent, the heart
  changes in its inventory slot, ground graphic `imbued_heart_impact03` and synth 6654 play, and an item
  box says "You use 150,000 ancient essence to saturate your imbued heart, turning it into a saturated heart."

## Not covered

- The Leagues capture's experience figure for the upgrade is not comparable (Leagues rates); the 500 comes
  from the Wiki.
- Whether the upgrade carries over a running wait is not shown by any capture; the wait stays.
- The Ferox Enclave pool resetting the wait is not part of this change.
