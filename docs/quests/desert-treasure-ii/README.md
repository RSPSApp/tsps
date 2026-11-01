---
quest: Desert Treasure II - The Fallen Empire
key: desert_treasure_ii
status: in-progress
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: ff35e7634
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Desert Treasure II - The Fallen Empire

A watched progression run reached the Leviathan chapter (stage 8, wire 54) on 2026-10-31. A
second pass (2026-11-01, no in-game run) compared the code with rsprox capture 1703 step by step
and fixed what differed, including the four chapters' free order. The Scar route to the first
shipwreck chamber is still blocked at runtime, and the Leviathan, Sucellus, Whisperer and finale
chapters have still never been played on this server.

Live evidence: rsprox capture [1703](https://rsprox.net/database) (rev 226) is a full playthrough;
[3229](https://rsprox.net/database) (rev 232) covers the Digsite steps; 3276, 3285 and 3344 are
logins after completion. rsprox.net has no other DT2 progress, and the user's 154 rev-241
recordings only log in finished accounts.

## Live contract

From 1703 and Quest Helper (`DesertTreasureII.java:518-521`). Ids are rev 241's.

- `dt2` 14862: 0-40 opening, 42 when the Frostenhorn record opens the chapters, then +2 for each
  milestone in any chapter, 86 with the fourth medallion found, 88-96 the cell and Mysterious
  Figure, 100 when Smith takes the last medallion, 102-110 the wights, 112 and 114 on the
  aftermath's leave scenes, 118 complete.
- Chapter varbits, all 0 -> 2 on the Frostenhorn tick (`dt2_catalytic_guardian` 15130 0 -> 1):

  | Chapter | Varbit | entered | boss | killed | found | done |
  | --- | --- | --- | --- | --- | --- | --- |
  | Vardorvis | `dt2_stranglewood` 15125 | 12 | 40 | 42 | 54 | 56 |
  | Leviathan | `dt2_scar` 15128 | 6 | 40 | 42 | 48 | 50 |
  | Sucellus | `dt2_ghorrock` 15127 | 6 | 62 | 64 | 68 | 70 |
  | Whisperer | `dt2_lassar` 15126 | 8 | 42 | 44 | 46 | 48 |

  Each of these columns raises `dt2` by 2. So does a pursuer meeting, one each for the first
  three medallions: the vault-door scene, then `dt2_pursuer_overworld_combat` (12300) saying
  "&lt;name&gt;! Hand over the medallion!". 1703's third meeting was the POH ambush (15176).
- `dt2_first..fourth_medallion` 15132-15135 hold chapter codes in placement order (1 Vardorvis,
  2 Whisperer, 3 Sucellus, 4 Leviathan); placing the third fills the fourth with the remaining
  chapter. The last medallion is never placed: Smith's smoke bomb takes it and sets its
  chapter's done value.
- After completion: 118/56/48/70/50, `dt2_ring_reward_given` 15138 = 1, `dt2_scoreboards` 15175
  (owned by DesertTreasureScoreboards), `dt2_reward_lamp` 15123 = 1 after the first lamp.
- Only one order (Vardorvis, Leviathan, Sucellus, Whisperer) is captured; every finished account
  in the captures shows it. The Wiki says the chapters "can be done in any order or progressed
  through concurrently", so the rules above are applied to every order: that part is inferred.

## Findings

Newest first.

- **fixed** (2026-11-01) The chapters can be done in any order, together: one open-chapters
  stage, each chapter's own varbit, `dt2` derived from the milestones above, the medallion slots,
  pursuer meetings by medallion count, and the last-medallion trial for whichever chapter is
  fourth. Saves at the old stages 8-10 move over at login.
- **fixed** (2026-11-01) The last medallion: Smith's betrayal plays at the vault door and its
  smoke bomb (lnBBaf) takes the medallion (96 -> 100). The Figure is 12301 at 3095,9260 and drops
  the medallion (94, picked up 96); the cell wakes at 3105,9247; 15159 stays 1 from 88 to 100;
  the desert entry lands at 3087,9260.
- **fixed** (2026-11-01) Completion gives `ring_of_shadows_uncharged` (28329), sets 15138, and
  the first lamp sets 15123. `dt2` reads 110 with the wights dead, 112 (THImb4), 114 (aP86Oy).
- **fixed** (2026-11-01) `dt2_lassar` 16-24 and 34, `dt2_scar` 36/38/40/44, and `dt2_ghorrock`
  60/64/66 now follow 1703.
- **fixed** (2026-11-01) Stranglewood: Kasonde's desk (objectbox_double, sound 2582), the note
  (`note` 291, its twelve lines), the potion ("You drink the potion. It tastes horrible.", 829,
  2401), the herb and berries (10094, 2581, 15136 = 2 / 15137 = 1, +2 each), the serum ("You mix
  the herb/berries into the potion.", 363, 2608), drunk straight after mixing; the first arrival
  at 1194,3452 under the "The Stranglewood" title (837); the barricade by exact move
  1193,3400 <-> 3402.
- **fixed** (2026-11-01) Opening: the start prompt and the door's message box; the rocks'
  messages, sound 3600 and "That's the rocks cleared."; the war room lands at 2784,6427 and the
  Guardian starts shielded (12337) at 2782,6432, 12336 unshielded, without invented messages.
- **not a bug** The quest Vardorvis' prayer "bypass": the Wiki says his melee "is reduced by
  roughly ~75% when Protect from Melee is active", which his combat method applies itself.
- **not a bug** The quest Vardorvis' drop: 1703's kill rolls the boss table too (150 dragon dart
  tips, kill count 1) besides the Temple key.
- **not a bug** Varbit 15100 is `dt2_stranglewood_survival_time_remaining` (the hideout defence
  timer), not the herb; the ingredients are 15136/15137 (fixed). 15110 is only set during
  Banikan's arrival scene in the war room (24 -> 26), not a follower state.
- **open** The Scar shipwreck route: the cache collision (an offline BFS over the copied
  instance) connects the growth-room door, the x=2237 corridor, the 49413 teleporter and 49418
  as live walks them, and no quest loc sits on that strip. The block happens at runtime and needs
  a live check of the instance's clipping around 2227-2237, 6417-6442.
- **open** (from 1703) Scar: burning a ship (op1 on 49423, then ejected to camp with 15258-15261
  reset), the tablets (`stoneplaque` 748, `dt2_scar` 18/26/34), the "disturb this level" puzzle
  messages, nerve endings and rifts, the shipwreck mesboxes, the electric room's safespots and
  knock-out, Persten's 10 -> 12, the entry's 2 -> 4 and landing, the passage-3 smoke overlay
  (839), and `15261` on entering 49418.
- **open** (from 1703) Ghorrock: the key chests open without the clue steps in live; the lock
  interfaces (`lockpicking` 811, `combination_lock` 809, `directional_lock` 810) and their
  messages; Malleta's 2 -> 4 and the entry on the second 49513 click; the cell hole by op1; the
  Jhallan defence (12354, five copies, timing); 15177-15179 and 15161; the vats' op1/op3/op4 and
  fermentation; the Duke's wake/kill messages, kill count and the Odd key at 3039,6451; the
  medallion objectbox; the cell note (`longscroll` 625); the third meeting in the POH.
- **open** (from 1703) The last-medallion cell lock is `lockpicking` (811) with 15124; the Figure
  fight starts when the altar dialogue ends (92), with the barriers 48781/48782 placed at
  3099,9260 and the exit 3104,9266 swapped to its noop; escape lands at 3175,2888. The wights
  start from the vault staircase 48797 (15158, 15174) and spawn together. The lamp's ring-charge
  message box.
- **open** The Stranglewood infection (HUD 836, `dt2_infection` 15099), the Strangled in the ruins
  and the hideout defence (15100-15104: timer, chests, barriers, traps).

- **open** The Scar north-west passage: from the damaged growth room only a dead-end pocket south of
  passage 49412 (2225,6421) is reachable; the shipwreck chamber entrance 49418 (2220,6402) and the blue
  teleporter (2237,6443) can't be reached, so the run stopped there.
- **open** Item Destroy prints "Drop item: &lt;id&gt;." and does nothing (Scar nerves 28446, X Marks the
  Spot treasure scroll 23067); spare Scar nerves can't be discarded. Not quest code.
- **open** The Wizards' Tower basement portal to the Temple of the Eye (43841, 3104,9574) has no handler
  ("You can't reach that!"); the run used the Minigame Teleport to Guardians of the Rift. Not quest code.
- **superseded** (2026-11-01, see above) Quest Vardorvis "bypassing" protection prayers and
  dropping a Bronze javelin: both match live.
- **partly fixed** The Stranglewood barricade 49492 (1193,3401) now crosses by live's exact move;
  it still doesn't block walking (collision, open).
- **fixed** (2026-11-01) Strangler serum drunk straight after mixing; the herb, serum and potion
  messages are live's.
- **partly fixed** The Stranglewood arrival: title overlay and landing tile as live; the infection
  HUD, Strangled and hideout defence are open (above).
- **superseded** Korbal herb "15100": that varbit is the hideout timer; the ingredients are
  15136/15137 (fixed).
- **fixed** (2026-11-01) Kasonde's desk, note and potion as live.
- **fixed** (2026-11-01) Chapters are no longer a fixed order, and the Frostenhorn record opens all
  four chapter varbits and 15130.
- **partly fixed** Opening chapter: the start prompt, door message box, rocks messages/sound and
  the Guardian's ids, tiles and messages are live's (2026-11-01). Open: the "I don't
  understand... How?" cutscene, the winch animation, the Guardian's exit/barrier locs
  (48925/48926, exit 48924 after the kill) and its block animation.
- **open** Transcript (data, not fixed here): Asgarnia Smith's last line reads "sigh*"; live is "\*sigh\*".
- **fixed** Kasonde wouldn't give the unfinished serum with a free slot: the transcript's inventory-space
  condition (szffOl) was unanswered, so its "no room" branch always played.
- **fixed** Climbing out of Kasonde's hideout landed outside his building (1187,3411), where he can't be
  reached; live lands inside at 1191,3410.
- **fixed** The Digsite rope (48919) had no Climb-up: the excavation could only be left by teleport. Now
  as live: anim 828, then 3383,3418 on the third tick.
- **fixed** The Frostenhorn record (transcript step -HvgV3) did nothing, leaving the quest stuck at wire 40.
  It now opens the record and sets 40 to 42, as live.
- **fixed** The golem search prompt was closed by its own transcript; it now opens the tick after.
- **fixed** War room, from capture 1703: altar Imbue charges all 8 cells (anim, gfx, sound, item box);
  inspecting the golem with charged cells inserts them and opens the puzzle from squares 0-7; puzzle drags
  from `cells` (35) work like a real client and any order of the identical cells powers it; the golem
  search shows "Checking..." / "Data found. Outputting now.", the stone-plaque record and varbits
  15111-15114; crate and altar use item boxes. Wrong-spell messages on the totems come from the transcript.
- **fixed** Totems attacked and chased the player, turned to face them, and the staff's follow-up attack
  spammed "That totem requires a blood burst spell or higher". They now never fight or turn, and live's
  "You empower the totem." and last-totem message box play.
- **fixed** A server restart left players logged in on a vanished instance (client stuck on "Loading -
  please wait."); DT2 now keeps the instance's exit and sends them there on login.
- **fixed** The vault plaque and statues used invented chat lines and sent no varbits: the plaque opens
  `woodplaque` (749) and the statues show live's message box; varbits 15105-15109 are sent.
- **fixed** The quest could start without His Faithful Servants (a Wiki requirement).
- **fixed** The Ancient Vault rendered as void in the middle (only plane 1 of its map was copied). Fixed in #1666.

## Runs

### 2026-10-31 · agent · claude-opus-5-5

- **Start:** the user's account Tester after `::master` and `::maxgear mage`; declared setup:
  `::quest ... complete` for Desert Treasure I, Secrets of the North, Enakhra's Lament, Temple of the Eye,
  The Garden of Death and Below Ice Mountain (His Faithful Servants left open to test the requirement),
  runes, ring of visibility, tinderbox, pestle and mortar, dragon pickaxe, facemask, Nardah and Digsite
  teleports, potions and a shark; Ancients through the Magic cape; `::tele` to the vault door. Baseline:
  QP 10, stage 0.
- **Route:** vault (Smith, plaque, statues), Digsite teleport to Terry Balando, winch, rocks, Ancient
  Guardian, totems, cells, golem puzzle and searches, Frostenhorn; Elissa; X Marks the Spot completed
  with `::quest` (declared aid: Veos only sails to Kourend after it) and Veos to Port Piscarilius; Barus,
  Kasonde's desk, note, potion, rowboat, ruins, hideout defence, herb, berries, temple, serum, Vardorvis,
  Temple key, Kasonde fight, medallion chest; Nardah teleport to the vault (Mysterious Figure), medallion
  placed. Minigame Teleport to Guardians of the Rift, Catalytic Guardian, Scar demons, Persten,
  pathfinder maze, tether, catalyst, growths and energies.
- **Aids:** a restart left Tester outside Kasonde's building (fixed bug), recovered with one
  `::tele 1191 3410`; `::infhp` for the fights (no food left); `set_npc_hitpoints` on Vardorvis (185 to 20)
  after real hits, because of the prayer-bypass stalemate.
- **Result:** stage 8 (wire 54), Vardorvis' medallion placed, Scar varbit 15128 = 16. Run stopped at the
  Scar shipwreck route.
- **Not checked:** Leviathan, Sucellus, Whisperer and the finale; rewards, repeat talk and relog at
  completion; the opening cutscene and Guardian against live (open findings).

### 2026-11-01 · agent · claude-opus-5-5 · source review, no run

- **Method:** each chapter's code compared with rsprox 1703, packet by packet (messages,
  varbits, interfaces, locs, NPC ids, tiles), ids checked against the rev-241 cache; behaviour
  only Quest Helper or the Wiki describe is marked as such. No in-game run.
- **Checks:** `node --test tests/quest-plugins.test.cjs` 414/415 (the Blood Moon Castle failure
  is on main too), `dt2-scoreboards`, `dt2-sucellus-prison`, `vardorvis-scoreboard-dispatch`
  all pass. New tests: free-order placement and slots, Smith taking the last medallion, the
  second pursuer meeting, old-stage migration, `dt2` per milestone, the Stranglewood desk to
  ingredients.

