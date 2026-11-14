# Surge potion

`server/plugins/items/SurgePotion.plugin.js`, registered with the Potions plugin (`potions:register`)
so it shares the dose chain, drink animation, sound, lines and the three-tick potion delay.

## Behaviour

Sources: the [OSRS Wiki](https://oldschool.runescape.wiki/w/Surge_potion) and rsprox captures
(rsprox.net recording 4098, revision 237; ticks below are that recording's).

- **Drink** (t1290 click, t1291 response): special attack energy +25% (`sa_energy` 250 -> 500), the
  usual drink animation (`human_eat`) and sound 2401, spotanim `vfx_surge_potion_01` at height 100 and
  synth 6182. The lines are the standard spam ones: "You drink some of your surge potion." and
  "You have # doses of potion left.".
- **Timer**: varbit `surge_potion_timer` goes to 50 on the drink's tick and drops by one every ten
  ticks (t1301 49, t1311 48 ...), reaching 0 500 ticks later (t1791), when the game message
  `<col=ff3045>You now feel capable of drinking another dose of surge potion</col>.` is sent.
- **Early dose** (t1299-1783): refused, nothing drunk:
  "You are still full of adrenaline. You'll be able to drink in <wait>." The wait comes from the timer
  value `v`: `v >= 5` gives `round(v / 10)` minutes, rounded half up ("1 minute" singular); below
  that, `v * 6` seconds. Recorded pairs: 50/45 "5 minutes", 44/35 "4 minutes", 34/25 "3 minutes",
  24/15 "2 minutes", 14/5 "1 minute", 4 "24 seconds", 3 "18", 2 "12", 1 "6 seconds".
  The wait is checked before the energy: from t1508 the energy is back at 100% and the refusals are
  still the adrenaline line.
- **Full energy, no wait** (t907, t1255): "Drinking this would have no effect.", nothing drunk.
- **Resets**: drinking from a house pool (t3422 click, t3425 timer 50 -> 1, t3426 0 and the ready line)
  and the Ferox Enclave free-for-all portal (t4307 exit, t4312 14 -> 1, t4313 0 and the line). Death
  takes the same path (Wiki: dying resets it, but not in the Chambers of Xeric, Theatre of Blood or
  Tombs of Amascut).

## Ours

- A death's reset uses the recorded pool/portal reset (1, then 0 and the line); no capture shows
  a death.
- The wait is saved as ticks left and only counts down while logged in.

## Not done

- The timer pausing between waves in the Colosseum and Inferno, between Theatre of Blood rooms and
  between Doom of Mokhaiotl delve levels, and its reset on entering or leaving a raid or the
  Colosseum (Wiki).
- The PvP-area rules from the 29 May 2025 update (six-tick delay, no restore after moving more than
  15 tiles away).
