# Special attack energy restoration

Special attack energy comes back 10% at a time on a restore timer (`RestoreSpecialAttackTask`,
started by `CombatSpecial.ensureRestoreTask`). The Lightbearer's rules are in
`server/plugins/items/Lightbearer.plugin.js`.

## Rules

| Situation | Behaviour | Source |
| --- | --- | --- |
| Normal rate | 10% every 50 ticks (30 seconds) | [Wiki: Special attacks](https://oldschool.runescape.wiki/w/Special_attacks) |
| Lightbearer worn | 10% every 25 ticks (15 seconds) | [Wiki: Lightbearer](https://oldschool.runescape.wiki/w/Lightbearer) |
| Logging out | The timer restarts: the first 10% after login takes the full 50 ticks | Wiki: Special attacks; rsprox captures (below) |
| Putting the Lightbearer on | The timer restarts at 25 ticks only when more than 25 are left ("only if natural regeneration is below half"); otherwise it keeps running | Wiki: Lightbearer |
| Taking the Lightbearer off | The timer always restarts at 50 ticks | Wiki: Lightbearer; rsprox captures (below) |

The restore timer is therefore not saved with the player.

## Captures

rsprox captures send the client script `spec_regen_timer` (4721) with `[period, start tick]`
whenever the timer starts, which shows where the server restarts it:

- **Login** (recordings 3861, 3868, 3961, 3962, 1139, 3992, 3994, 4052, 4096, 4101, 4123, 4136,
  4269, 4272; rev 235-239, normal worlds): the player logs in below full energy, the server
  sends `spec_regen_timer [50, <login tick>]`, and the first +10% comes 49-50 ticks after login.
  No time carries over from before the logout.
- **Lightbearer** (recordings 101, 553, 554, 582, 1833, 1837, 1852; rev 227, all Leagues worlds):
  taking the ring off sends `spec_regen_timer [50, <this tick>]` every time, even with 1-11 ticks
  left on the old timer (553, 554, 582, 1833, 1837). Putting it on sends `[25, <this tick>]`. Every
  recorded equip but one happened at full energy, when no restore was due. The one below full
  energy (1833) came 1 tick into the timer, where the Wiki's rule also restarts it. These
  recordings can't show the "keeps running when 25 or fewer are left" case; that rule comes
  from the Wiki alone.

## The orb's restore ring

`spec_regen_timer` (4721) `[period, start tick]` stores the start tick (the `map_clock` value,
varp 3079) in varc 474 and the period in varc 987, then draws a ring on the special attack orb
that fills over the period (scripts 4723/4724). The ring is hidden at full energy and when
`orbs_disabled` (varbit 4084) is set; script 6060 redraws it from varc 474 and `map_clock`
whenever energy changes. `RestoreSpecialAttackTask` sends it each time a period begins:

| When | Sent | rsprox captures (the user's) |
| --- | --- | --- |
| Energy spent from full | `[50, <this tick>]` (25 with the Lightbearer): the timer starts now | doom-wave1-5 ticks 62 and 400 |
| Energy spent below full | nothing: the running period carries on | doom-wave1-5 ticks 99 and 176 |
| A restore, the one that fills the bar included | `[50, <this tick>]` | doom-wave1-5 ticks 87, 112, 338 |
| The respawn tick | `[50, <this tick>]`: the timer starts over, energy is not restored | yama-first-time-fighting-and-second-time tick 317 |

`PlayerDeathTask` restarts the restore timer on the respawn tick for that reason. A period
carried over (a timer restarted with fewer ticks than the period) is dated back by the
ticks already run, so the redraw lines up.

## Not implemented

- Live sends `spec_regen_timer` every period even at full energy (recording 4258; yama ticks
  50-300 above), so its timer runs from login. This server's timer only runs below full energy.
  The ring is hidden at full energy and spending from full restarts the timer live too, so no
  restore or ring timing differs. At login live also sends `health_regen_timer` (4716,
  `[100, tick]` every 100 ticks: the Hitpoints orb's ring) and `spec_regen_orbs_synch` (4722);
  neither is sent here.
- Doom of Mokhaiotl restarts the timer between delve levels (doom-wave1-5: a period starts at
  ticks 143 and 288, after the descent, with no restore). Not modelled.
