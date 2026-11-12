---
quest: Wanted!
key: wanted
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Wanted!

No native playthrough recorded; natural completion pending. The scan scenes and the finale are aligned
with the user's whole-quest RSProx capture "Wanted!" (revision 242.1, recorded 2026-11-12; one run
that accepted Sir Amik's squireship). Tick numbers below are that recording's. Bug thread: issue #4198.

## Capture facts the plugin relies on

### Quest varbit (1051 `wanted_main`) and helpers

| Value | When (tick) |
| --- | --- |
| 1 | "Yes." to "Start the Wanted! quest?" (282) |
| 2 | Player's "I guess... I don't really like blindly following orders though..." (296) |
| 3 | Player's "Okaaaay...." (321) |
| 5 | Tiffy's "Go and speak to Amik again..." after the squireship (737; the decline branch is uncaptured) |
| 6 | Amik's "Very well then; In the name of King Valence..." (871) |
| 7 | Tiffy's "Well old boy, we will need to equip you..." (977) |
| 8 | The CommOrb is made (1008) |
| 9 | Savant's "Wow, that's some good thinking..." at the end of the mage's deal (2053); the essence goes and 1056 = 2 with "I have your essences right here, take them." (2030) |
| 10 | Solus dies (4299) |
| 11 | The hat is handed to Sir Amik (4479) |

`wanted_joke_option` (1052) = 1 with "As you wish, from this day forth you are my Squire!" (639), and Amik's
"squiring" lines (Asgarnian Ale) follow at once and on every later visit. `wanted_commorb_intel` (1053),
`wanted_daquarius_hint` (1055, 1 then 2 on the Black Knight kill), `wanted_lord_d_exposition` (1058),
`wanted_zammy_mage_hint` (1056) as the plugin already sent them. `wanted_black_knight_dead` (1057) = 1
when Solus's summoned knight dies (4012).

### The CommOrb

- Scan before the hunt: "There is nothing nearby to scan." with no animation (1038, 2085).
- Scan during the hunt: seq 2721, spotanim 454 (height 92), area sound 1900 (range 5); found or not.
  A wrong place answers two ticks later with one of Savant's ten failing-scan lines.
- After Solus: the scan plays, then "You have nothing to scan for..." (4329). Contact after completion:
  "Your Comm Orb remains dark." (4542).
- Entering Canifis (the player on 3457,3484 at 2328, 3455 at 2327) starts Savant's call a tick later
  (2329); mission 1 (1065) is set on "So I should try a scan here in Canifis?" (2409).

### Scenes (ticks from the Scan click)

Common: at +2 the cutscene starts (`cutscene_status`, minimap 2, npc/obj ops hidden, `fov_clamp`,
`draw_distance_max_override`, areasounds 56/1, side tabs closed), Solus (`wanted_solusN`, 4938 + the
destination's mission id) appears facing the player, the camera looks at him (height 100, rates 100/100).
Every line is held (no "Click here to continue"), six or seven ticks apart; only the last continues.

| Stop | Captured at | Solus tile | Events | Varbits | Item box |
| --- | --- | --- | --- | --- | --- |
| 1 Canifis | 2449 | 3489,3478 | +22 seq 714; +29 gone, camera reset | +29 | +83 grey toy horsey (2526) |
| 2 (Draynor Market) | 2685 | 3082,3249 | +36 spotanim 345; +50 spotanim 343 + seq 1818, sound 199; +51 player seq 1816 + spotanim 342, sound 200; +54 player on 2756,3479 (Camelot) | +121 | +97 blue cape |
| 3 Champions' Guild | 2901 | 3194,3361 | +16 seq 1979, projectile 390, sound 183; +17 gone | +39 | +60 eye patch |
| 4 (Brimhaven pub) | 3240 | 2797,3162 | +49 player spotanim 78 (delay 20), Solus seq 811, sound 1655; +50 player seq 2724 and a 59 hit (69 HP to 10); +55 player on 2971,3338 | +145 | +145 bone spear |
| 5 Dorgesh-Kaan mine | 3634 | 3316,9612 (the "Woman", 6264) | +38 player seq 1156 + spotanim 245, sound 2727; +40 becomes 4941; +48 walks off to 3302,9618; +65 gone | +156 | +156 Greenman's ale |
| 6 (Yanille pub) | 3949 | 2550,3082 | +23 seq 2720; +25 cutscene ends, "Solus" line continues; a tick after the continue the knight (4959) on 2553,3081 says "Solus commands you die now!" with smokepuff 86, sound 1930 and a hint arrow, and attacks | knight's death | knight's death: 20 noted pure essence (7937) |

### Finale (ticks from Aubury's Curse, 4144)

+1 fade out; +4 instance (live: the mine rotated a quarter), player 2910,4830, Solus (4930) 2900,4821
facing south, "rune essence" track; +6 camera at 2900,4821 h10 from 2908,4828 h450 (232/100); +7 fade in;
+8 "There he is!" and the camera to 2897,4817 h300 (3/3); Solus's taunts are overheads ("Argh! I am so
sick of your" / "interference!" +27/+32, ...); +47 the player steps 2911,4830, 2911,4831, then 2896,4816
to 2898,4818; +69 fifteen White Rangers (4961); +81 Ice Barrage (seq 1979, sound 171, spotanim 369 and
sound 168 on each ranger) and their bones (the player's own); +82 70 hits, +83 deaths, +85 gone; +87 the
cutscene ends; +116 "YOU DIE NOW!", Solus becomes 4962 and attacks. His death (4297): +2 the hat, varbits
and "Now that Solus is defeated..."; +13 fade out; +17 back where the Curse was cast (3252,3401); +22 fade
in; +23 "VERY well done, ..." continues.

## Not covered

- Uncaptured destinations put Solus a tile west of the player and the knight two east, one south (ours).
- The Flames of Zamorak damage: 85% of current HP rounded up, never fatal, fitted to the one sample
  (the Wiki: "a high percentage of your current Hitpoints", it "will not kill you").
- The finale instance is not rotated; live's is.
- The decline branch at Sir Amik and the commorb "Buy One" path were not in this run.

## Findings

None recorded.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q123); PRs: [#1186](https://github.com/RSPSApp/tsps/pull/1186).
