---
quest: Crab Quest
key: crab_quest
status: passed-with-issues
tested: 2026-11-09
tester: agent
model: claude-opus-5-5
commit: feat/crab-quest-instance
cache: osrs-241_2026-10-20
start: fresh
travel: walk_to
---

# Crab Quest

A fresh account played the whole quest in the dream instance, from the bottle to "Congratulations,
you've completed a quest: Crab Quest" and the closing lines on the real beach. The shell
collection's own options and the band's practice animations are not done.

## What live does (RSProx capture, revision 241, 2026-11-03)

- **The real map** has one quest loc: the bottle, `crab_bottle_multi` 62438 at 3055,2639.
- **The dream** is a `rebuild_region` instance: 12x12 zones copied unturned from 3008,2592,
  the player kept on 3056,2639. Sip, then 2 ticks to "...and immediately black out." and the
  fade, 2 more to the instance, 5 to the fade-in with spotanim 245 (height 124), 4 to
  `human_death_reverse` 7330, then the first line. `crab_put_back_in_instance` 15868 and
  `crab_net` 15888 are 1 inside it.
- **Inside it, for the owner only:** `crab_maincrab` 16469 at 3054,2637 (16470 at 3056,2637 once
  the instrument is in), one floatsam 16478 at 3051,2632, the shell/bass/drum multilocs on the
  practice spot, `crab_magictree_noop` 62474 until recruiting, and the shells and big net with
  `despawn=16959`: shell 1 3059,2648, 2 3044,2652, 3 3051,2634, 4 3036,2643, 5 3050,2655,
  6 3063,2642, 7 3040,2636, bad 1 3048,2645, bad 2 3055,2654, net 3061,2646.
- **Drinking again inside** shows "A second dose of drink may let you remember where you moored
  your boat and how to teleport..." and wakes the player on the beach with progress kept. The
  headache (no boat, no teleport) is the dream.
- **The floatsam:** one cast ("You cast out your net...", `human_largenet` 620 two ticks
  later), then the bowstring, barrel and plank 3/6/6 ticks apart, `crab_floatsam_hidden`
  15852 1/2/3, stage 35 to 37 on the plank, and the mesbox "There is nothing left here.".
- **Recruiting (stage 47)** adds 14 locs with their own ids and rotations (palms 62470/62471/
  62472, magic tree 62473, avium trees 62475/62476, plant 62477, leafless bushes 62478). The
  scutter is a mesbox; the recruit moves to its practice tile. After the sixth,
  `crab_partial_complete` 15881 is 1 and the player says "Unless I really like talking to
  crabs...". "Wait for leaders to turn up." gives stage 50 and every `crab_bandmate_N` bit;
  the `crab_recruited_bandmate_N` bits stay as recruited (`crab_band` 2047).
- **The dance** (stage 55) is in the dream under `cam_skybox` 61359 with the sand circles
  62479/62480 (finals 62481/62482) at 3062,2641/3062,2642 and a sand-circle frame
  (14511-14518) on each line.
- **The ceremony** (stage 60) is a second instance, 13x13 zones from 2992,2600, played on fixed
  ticks for 368 ticks; a second skybox 61907 near the end. The player wakes at 3056,2639.

## Findings

- **open** The shell collection's Unpack (seven `crab_shell_reward` 34591-34597 with their own
  op 2) is not implemented.
- **open** The band's practice rhythm (`horror_crab_attack`/`defend` every few ticks) is not
  played, and a recruit is not shown at its hiding place while it talks.
- **open** Talking to a band crab at stage 50 does nothing; live plays the main crab's lines.
- **fixed** The quest ran on the real beach with world-wide palms and a second bottle; it is now
  the captured instance.
- **fixed** Five shells had swapped tiles; the bad shells, the western bush, two avium trees and
  three palm ids were wrong.
- **fixed** `crab_partial_complete` was never set and "Wait for leaders to turn up." skipped
  stage 50.

## Runs

### 2026-11-09 · agent · claude-opus-5-5

- **Start:** fresh account, `::master`, Pandemonium completed with `::quest`, placed by the
  bottle with `::tele` (the only teleport).
- **Route:** the bottle, all shells (re-entering the dream once), the floatsam, the instrument
  (named "A bass."), six recruits (penguin palm, plant, three palms, eastern bush), "Wait for
  leaders to turn up.", the dance and the ceremony.
- **Result:** stages 5/25/30/35/37/40/47/50/55/60/63 as captured; 15852 1-3, 15880 64 to 1118,
  15881 1 on the sixth, 15864 2047; reward: the shell collection, Fishing +3,000 XP and the
  Sailing XP. Relog from inside the dream and a server restart both came back on the beach.
- **Not checked:** the skybox and instance rendering on screen (web client or RuneLite), the
  sit-coax recruits in game (covered by tests), death inside the dream.
