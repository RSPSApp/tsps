---
quest: Tree Gnome Village
key: tree_gnome_village
status: passed
tested: 2026-10-29
tester: agent
model: grok-4.7
commit: 62d662706242
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Tree Gnome Village

A fresh run followed the Wiki route from King Bolren through the trackers, ballista, stronghold, warlord and ceremony. Rewards paid once, a repeat talk did not pay again, and a relog kept the stage and rewards.

## Live behaviour (rsprox captures)

The user's three whole-quest rsprox captures (local 1001802, 1001800 and 1002235, revision 242) run it start to
finish. Ticks are 1001802's; the other two agree wherever they cover the same step.

- **Boxes.** Every message of the quest's transcript shows in a message box (229) with its continue, not in the
  chat: the trackers' coordinates, "He's clearly lost the plot.", the ballista's lines, the chest, the ceremony.
  The warlord's death text is an object box (193) showing the orbs (588). Elkoy's guide boxes have no continue
  and move on by themselves.
- **Stages** change as a line is continued, not as an option is picked: the start (stage 1, with "You've started
  a new quest") as "I would be glad to help." is continued (t920); 2 on "Ok, I'll gather some wood." (t1062); 4,
  with the ballista coordinate (varbit 602), on "Thank you, you're braver than most." (t1186); 7 on "You are
  brave, but this task will be tough..." (t1750), when Bolren takes the first orb. The logs go, with no game
  message, as "I have some here. (You give six loads of logs to the commander.)" shows (t1081).
- **Trackers.** Tracker gnome 3's flag (601) is set as his talk opens (t1364); the others' at their boxes.
- **Ballista** (Fire is op 2). "You enter the height and y coordinates..." shows after the pick; on its continue
  the ballista plays 730, sound 3488 (`treevillage_catabow_launch`) and spotanim 182 flies from the tile 1 east
  and 3 north of its corner to 2509,3254, cycles 110-375, angle 7, progress 0, heights 95 to 0, with no graphic
  where it lands (t1469). Two ticks later sound 3487 (`treevillage_catabow_hit`) and the hit box; stage 5 as that
  box is continued (t1471-1478).
- **Crumbled wall.** On the climb's continue (t1524) the ground-floor commander attacks the next tick and shouts
  "Don't even think of taking the orb!" the tick after (t1526). Ours: the shout is on time; the attack starts
  the tick after the player lands, 3 ticks after the continue, since combat drops a target that is being placed.
- **Chest.** Open (536, sound 52), then Search: the orb, stage 6 and the box as it opens (t1567). The Wiki's
  "Oi! You! Get out of there." comes from a commander in view; the capture's had been killed, and nothing is said.
- **Front door from inside** (t1587-1592): inviswall 38848 on the doorway, inactivepoordoor (1539) on the tile
  north, sound 46, the player steps out onto 2502,3250 and the door is back two ticks later. From outside it
  stays locked.
- **Elkoy.** Follow, like his guide answers and Bolren's "Elkoy guides you out of the maze.", shows the guide box
  over the fade; the player is moved 3 ticks later and the screen comes back, with Elkoy's line, at 4 (t938-942,
  t1639-1644, t1755-1759, t2168-2173). Follow plays his Talk-to's guide answer for the stage and side: "Here we
  are. Take the orb to King Bolren..." with the orb, "Here we are. Feel free to have a look around." with the orbs.
- **bolren_got_orbs (598)** stays 0 after the first orb; it goes to 1 as the ceremony's chant box opens, when
  Bolren takes the orbs (t2258), and to 2 as the tree takes them (t2274).
- **Warlord.** The fighter (7622) appears on the talking warlord's tile, with current_hint_arrow 7 and an arrow on
  him (t1885); live never clears that varbit. Varbit 3460 goes back to 0 30 ticks after the orbs drop, in all
  three captures (t2068 -> t2098).
- **Ceremony.** On the chant box's continue the four chanters (Local Gnome 4979, who never walk) play 12049 and
  say "Su tana." (the northern pair) and "En tania." (the southern pair), twice each, every 2 ticks (t2263-2269).
  Two ticks after the last, Bolren plays spotanim 79 and seq 199 (both delay 20, t2271); 3 ticks later 598 goes to
  2 and the tree at 2543,3168 plays 333 (t2274); the box "The orbs of protection come to rest..." 4 ticks after
  that (t2278).
- **Scroll** (t2320): "2 Quest Points", "11,450 Attack XP", "Spirit Tree Access", "A Gnome Amulet", with the amulet
  (589) as its model.

`server/tests/tree-gnome-village-capture.test.cjs` plays these on a real player; `qh728-q117.test.cjs` covers the
handlers.

### Not covered

- The Wiki's line colours ("height" and "y coordinate." in blue, the logs line's white aside) are dropped by the
  dialogue export, as for every page.
- A wrong ballista coordinate's flight and sound (no capture misses): the spear lands 3 tiles east or west per
  step out, with the launch sound only.
- "You've started a new quest" is sent here; live's `last_quest_id` varbits are not (no quest sends them).

## Findings

- **fixed** `travel_to` inside the Khazard stronghold clicked Open on Door 2184 (`khazard_stronghold_door`, 2502, 3250) and the door stayed closed. It now lets the player out as live does (above).
- **fixed** Elkoy's guide landing, maze railing and the owned warlord encounter were corrected. [#1182](https://github.com/RSPSApp/tsps/pull/1182)

## Runs

### 2026-11-16 · agent · claude-opus-5.5

- **Start:** fresh, varp 111 = 0, on PR #5967 (cache osrs-242). Placed with `::tele` for setup, and again for the chest and the ceremony once each step had been checked.
- **Route and result:** start, Montai and logs, the three trackers, ballista (0002), wall (the commander's shout and seq 428 attack), chest box, front door out, Elkoy Follow (box, move at +3, line at +4), first orb (598 still 0), warlord (14192 = 7, object box), ceremony (chanters animate, 598 = 2 at +11, box at +15), completion and scroll. A relog kept 111 = 9 and 598 = 2.
- **Not checked:** a wrong coordinate, a full bag, Follow from inside after the first orb.

### 2026-10-29 · agent · grok-4.7

- **Start:** fresh, varp 111 = 0 and 0 quest points. Placed beside King Bolren with `::tele` (the only teleport). Declared setup: 6 logs, an abyssal whip, 8 sharks, and `::infhp` (acknowledged on).
- **Route:** Bolren start, escorted to the maze entrance (stage 1). `travel_to` to Commander Montai: offer, hand in the logs, then the tracker task (stages 2, 3, 4). Tracker 2, tracker 1, then tracker 3, whose line was "More than my head, less than my fingers" (ballista varbit 602 = 1, so coordinate 0002). Fired the ballista at 2508, 3210 (stage 5). Climbed the crumbled wall, climbed the ladder, opened the closed chest and took the orb (stage 6). Climbed the wall back out after `travel_to` could not. Elkoy into the village, returned the orb to Bolren (stage 7, varbit 598 = 1), Elkoy back out. Talked to the warlord (7621); the owned fighter (7622) spawned with varbit 3460 set. One whip hit (170 to 167 hitpoints), then hitpoints set to 1. Death gave the orbs (stage 8). Elkoy in, Bolren's ceremony, quest complete.
- **Result:** varp 111 = 9, varbit 598 = 2. Quest points 0 to 2. Attack experience 13,034,447 before the reward, then 13,045,897 (+11,450). Hitpoints experience from the fight (+5) did not change again. Gnome amulet (589) once. Repeat talk with Bolren left quest points, Attack experience and the amulet unchanged. Relog kept stage 9, 2 quest points, the amulet and the Attack experience.
- **Not checked:** wrong ballista coordinate then a retry, killing the Khazard commanders, an unassisted warlord fight, a full inventory or lost orb/amulet reclaim, spirit tree travel, and the quest overlay.

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q117); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh King Bolren start; earned checkpoints linked without reset.
- **Result:** varp 111 = 9; QP 0->2, Attack +11,450 XP, Gnome amulet.
- **Checked:** repeat dialogue, relog, logout/offline.
- **Not checked:** HP1 aids after real damage; Recovery, optional branches, ceremony camera/timing and overlay unchecked; Initial varp 111 = 0 inferred.
- **PRs:** [#1182](https://github.com/RSPSApp/tsps/pull/1182).
