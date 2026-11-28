---
quest: Crab Quest
key: crab_quest
status: passed-with-issues
tested: 2026-11-09
tester: agent
model: claude-opus-5-5
commit: feat/crab-quest-instance
cache: osrs-242_2026-11-03 (run on osrs-241_2026-10-20)
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
  `human_death_reverse` 7330, then the first line, with "Urrrrrgh!" and `sequence -1` on the
  same tick (ticks 5962-5963). 7330 holds its last frame for 669 ticks and blocks the
  client's movement, so that reset is what lets the player walk. `crab_put_back_in_instance` 15868 and
  `crab_net` 15888 are 1 inside it.
- **Inside it, for the owner only:** `crab_maincrab` 16469 at 3054,2637 (16470 at 3056,2637 once
  the instrument is in), one floatsam (16478 `crab_floatsam_multi` in the 241 capture; 16820 `crab_flotsam_multi` in cache 242) at 3051,2632, the shell/bass/drum multilocs on the
  practice spot, `crab_magictree_noop` 62474 until recruiting, and the shells and big net with
  `despawn=16959`: shell 1 3059,2648, 2 3044,2652, 3 3051,2634, 4 3036,2643, 5 3050,2655,
  6 3063,2642, 7 3040,2636, bad 1 3048,2645, bad 2 3055,2654, net 3061,2646.
- **Drinking again inside** shows "A second dose of drink may let you remember where you moored
  your boat and how to teleport..." and wakes the player on the beach with progress kept. The
  headache (no boat, no teleport) is the dream.
- **The floatsam:** one cast ("You cast out your net...", `human_largenet` 620 two ticks
  later), then the bowstring, barrel and plank 3/6/6 ticks apart, `crab_floatsam_hidden`
  15852 1/2/3, stage 35 to 37 on the plank, and the mesbox "There is nothing left here.".
- **The Sit coax** (ticks 6369-6381, the avium tree at 3046,2656): after the too-scared
  mesbox, the Sit emote (216:2 slot 54, `emote_sit_loop` 10061) on 3047,2655 sends the game
  message "And now, you wait...", and 12 ticks later the mesbox "A crab appears!" opens with
  a `crab_bandcrab` 16483 on the player's tile. Quest Helper sits one tile west (3046,2655),
  and at 3038,2644 and 3041,2638 (diagonal to the 1x1 palm) for the others. The Wiki says the
  magic tree's crab "will take considerably longer"; no recording has that wait.
- **The crab that comes out** (ticks 6256-6519) is added by its hiding place on the tick its
  "A crab appears!" box opens: plant 3053,2656, north-western tree 3047,2655, palms 3041,2649,
  3040,2647 and 3037,2646, and both the penguin and the crab at the northern palm on 3049,2658.
  Five of those are the player's own tile. When the box is continued, the player steps straight
  beside the crab: the first free tile west, east, south or north of it within one step, so
  west off its tile, east when a palm is west, or from a diagonal to its south. The crab is
  removed on its scutter tick, as its practice copy is added. Every narration line there is a
  mesbox ("The crab squints...", "...viciously attacks your foot.", the scutters).
- **The penguin** at the northern palm: on the continue of "Likewise!" the chatbox closes and the
  player kicks (`human_unarmedkick` 423, sound 2565 delay 10). The next tick the penguin goes,
  `crab_flyingpenguin` 4022 flies from 3049,2658 to 3049,2678 (250 cycles, angle 35) with
  `watersplash` 68 there 250 cycles later, and sound 12111. The tick after,
  `crab_kicked_penguin` 15867 is 1 and sound 2496 (delay 220). Eleven ticks after the kick the
  crab appears.
- **The shy crab:** "A crab comes out shyly.", "The crab appears to turn bright red." and "The
  crab scutters away." are mesboxes (ticks 6228, 6238, 6250). She comes out on 3045,2653, and
  the player steps from 3044,2652 to 3045,2652 as the first box is continued.
- **Recruiting (stage 47)** adds 14 locs with their own ids and rotations (palms 62470/62471/
  62472, magic tree 62473, avium trees 62475/62476, plant 62477, leafless bushes 62478). The
  scutter is a mesbox; the recruit moves to its practice tile. After the sixth,
  `crab_partial_complete` 15881 is 1 and the player says "Unless I really like talking to
  crabs...". "Wait for leaders to turn up." gives stage 50 and every `crab_bandmate_N` bit;
  the `crab_recruited_bandmate_N` bits stay as recruited (`crab_band` 2047).
- **The instrument's name and the bass loc:** "A disaster." (sub=1 of "A disaster.|A bass.|I
  don't actually know.") sets `crab_bassname` 15843 to 1 (tick 6200). `crab_bass` 15887
  (varp 5741 bits 0-7, with `crab_main_temp` 15885 and `crab_bassname_temp` 15886) is
  `crab_main` + 64 * `crab_bassname` at every stage change: 5, 10, ... 45, then 109, 111, 114,
  119, 124, 127. It dresses `crab_bass_multi_quest` 62459 beside the practising crab (cache:
  Thing 62455, Disaster 62458, Bass guitar 62456, Banjo 62457).
- **Talk-to on a band crab** (tick 6547, stage 50): the crab at 3054,2637, which joined by
  waiting, answers with the main crab's conversation and chathead (`crab_maincrab_practising`),
  starting "The whole band is complete! Thanks for your help.".
- **The dance** (stage 55) is in the dream under `cam_skybox` 61359 with the sand circles
  62479/62480 (finals 62481/62482) at 3062,2641/3062,2642 and a sand-circle frame
  (14511-14518) on each line.
- **The ceremony** (stage 60) is a second instance, 13x13 zones from 2992,2600, played on fixed
  ticks for 368 ticks; a second skybox 61907 near the end. The player wakes at 3056,2639.

## Findings

- **fixed** (issue 6670) After the first sip the player stood frozen with the camera while the
  server walked them around the dream: 7330 was never reset. It is now reset on the first
  line's tick, as live does.
- **fixed** (issue 6670) The shy crabs never came out in the dream: the Sit check compared the
  instance tile with source tiles, and accepted one exact tile. A Sit on any tile beside the
  hiding place now waits 12 ticks (Ours: 24 for the magic tree) and the crab comes out if the
  player has not left the tile; another emote or a step off the tile cancels it. Ours: an
  Investigate during the wait shows the too-scared box, which the crab's box then replaces (no
  recording covers it). "A crab appears!", "A 'crab'
  appears!" and the too-scared line are message boxes, as captured.
- **fixed** (#6819) A recruit is now shown by its hiding place while it talks, the penguin is
  kicked into the sea as captured, and the recruits' and the shy crab's narration are message
  boxes. Ours: the seven spots no recording reached add their crab on the player's tile, and
  their narration lines are message boxes like the captured ones; the western bush, whose
  conversation never says "A crab appears!", shows its crab with its first box. A crab whose
  conversation ends without a scutter (the fan crab, the scientist, a failed quiz) or is closed
  early goes back into hiding when the chat closes (Ours).

- **open** The shell collection's Unpack (seven `crab_shell_reward` 34591-34597 with their own
  op 2) is not implemented.
- **open** The band's practice rhythm (`horror_crab_attack`/`defend` every few ticks) is not
  played.
- **fixed** (issue 6916) Talk-to on a crab at practice asked "Start Crab Quest?": nothing
  handled `crab_bandcrab` 16483, so the generic dialogue played the transcript's first variant.
  A recruited crab now plays its Wiki "talking to the crab at practice" lines; one that joined
  by waiting answers with the main crab, as captured. The shy crab by the chest plays her Wiki
  conversation. Ours (Wiki-only): "present" in those lines means at practice (recruited, or
  any crab once the band is complete).
- **fixed** (issue 6916) The practising crab had no instrument: `crab_bassname` and
  `crab_bass` were never sent, so 62459 resolved to nothing.
- **fixed** Five Wiki Flotsam spawns stood on the real beach; live has none there (the floatsam is
  the dream's). They are removed and marked plugin-spawned in `npc-spawn-sync.json`.
- **fixed** The screen stayed black after the ceremony, and a logout in its first two ticks left it
  playing for the offline player.
- **fixed** The quest ran on the real beach with world-wide palms and a second bottle; it is now
  the captured instance.
- **fixed** Five shells had swapped tiles; the bad shells, the western bush, two avium trees and
  three palm ids were wrong.
- **fixed** `crab_partial_complete` was never set and "Wait for leaders to turn up." skipped
  stage 50.

## Runs

### 2026-11-28 · agent · claude-opus-5-5 (issue 6916)

- **Start:** fresh account, `::master`, Pandemonium completed, `::quest crab quest 45`, into the
  dream by the bottle (re-entered after each `::quest`, which does not rebuild it).
- **Result:** `crab_bass` 45 at stage 45, 47 and 50 after; the western-most palm crab recruited
  and, at practice, played its "The crab viciously attacks your foot." lines; at stage 50 the
  crab at 3054,2637 played "The whole band is complete! Thanks for your help." and on, as
  captured. A vision screenshot shows the instrument loc beside the practising crab.
- **Not checked:** naming the instrument in game (the hand-in needs the fished materials; the
  tests cover 109/111 and the bass/banjo values).

### 2026-11-09 · agent · claude-opus-5-5 (cache 242 check)

- **Start:** fresh account set to stage 30 with `::quest`, the big net given, placed by the bottle.
- **Result:** no Flotsam on the real beach; the bottle blacks out into the dream; the dream's
  `crab_flotsam_multi` 16820 shows as Flotsam 16819 with Net; one cast gives the bowstring, barrel
  and plank, 15852 = 3, stage 37.
- **Not checked:** the rest of the quest on 242 (the 241 run below covers it).

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
