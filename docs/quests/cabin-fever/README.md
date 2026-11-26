---
quest: Cabin Fever
key: cabin_fever
status: passed-with-issues
tested: 2026-11-20
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Cabin Fever

The quest follows the user's RSProx capture `CabinFever` (revision 242.1, a whole run of the
quest, SHA-256 `bc530d37…f7c09` of the `.bin`) and the OSRS Wiki. A headless run reached varp
655 = 140 with live's battle sequence, messages and quest-varp steps. The battle is still a
static map, not live's instance; the end scene is live's cutscene in a copy of The Other Inn.

## Live capture facts

Ticks are the capture's. The Wiki wins on wording it states; the capture decides what the
Wiki leaves out.

- **Quest varp 655** moves 10 when an objective's own action finishes, and Bill moves the next
  10 when he is told: 30→40 when the barrel blows (976), 50→60 three ticks after the last
  waterproofed hole (1193→1196), 70→80 when the tenth plunder is stored (1667), 90→100 when the new barrel is on
  (1785), and 110→120 on the canister hit (1917). Bill's talks give 50, 70, 90, 110 and 130.
  The completion is 140 (2302). Bill on the port ship is NPC 4013, a multi-NPC on varp 655:
  4011 from 10 to 139 and 4016 at 140.
- **Arrival** (601-609): "Let's go Cap'n!" gives 20, then 30 and `fever_cannon` (1741) = 1.
  Nothing else is set. The player lands at 1815,4833 on the deck, and the tinderbox lies in the
  hold at 1814,4825.
- **Lockers:** Open plays `human_openchest` (536) and `cupboard_open` (58). The locker turns into
  its open loc (11247, 11249: Search, Close), and Search opens the IF1 modal
  `quest_fever_repair_locker` (502) or `quest_fever_gun_locker` (501). Each press gives one
  item: a coil of rope, a hammer, 10 tacks, 2 repair planks (7148, refused at 6 with "You already
  have enough Repair Planks."; the Wiki says the other supplies stop at what is needed too), a load of swamp paste, some fuse, a Ramrod, a canister round
  (7149) or a cannon ball. While sinking the ship the canister button answers "You do not need
  a canister round right now." (1997).
- **Net and swing:** Climb plays `human_reachforladder` (828); two ticks later comes "You climb
  up the net." and the yardarm. Rope on the hoisted sail: the rope is used, `fever_swing`
  (1740, or 1764 back) = 1, with `fever_rope_tie` (3132) and `cf_tierope` (1439). The message
  "You attach a rope to the sails." comes 4 ticks on, then the jump (827, `cf_jumpdown` 1428).
  At 7 the player is on the deck beside the mast (1816,4832; 1823,4833 on the way back) and the
  swing rope (11311) hangs there. They walk round the mast to the rope, one tile a tick:
  1815,4832, 1814,4831, 1814,4830, 1814,4829, 1815,4829, a tick's pause, 1816,4829 and 1816,4830
  (ticks 862-869, 1450-1457); back, 1822,4833 and 1822,4834 (995-996, 1629-1630). They slide to
  the rope 10 ticks after the drop (3 on the way back) and swing across 2 ticks after that (3 on
  the way back; 3130,
  `cf_swingacross_sucess` 1438, the rope loc playing `fever_rope_swing` 3123). After 3 more ticks: "The rope falls off the mast! ...". Two of
  the six swings fell at Agility 73: anim 3131, `cf_swingacross_fail` (1421), run energy 0, a
  swim (772, `watersplash`, `cf_swim`), then out onto the other ship.
- **Fuse** (891-901, 966-976): the fuse goes in the barrel (`fever_gunpowder_barrel` 1756 = 2,
  832, `cf_attach_fuse`). The player is walked east to lay it, `fever_fuse_1` (1761) at +6 and
  `fever_fuse_2` (1762) at +10 (locs 11241, 11242). A tinderbox on the fuse plays 827 and
  `cf_strike`. Two ticks on comes "You light the fuse..."; the fuse goes out end first with three
  `fuse_light` sounds, `fever_fuse_light` (546) along it, `fever_barrel_fuse_light` (545) and an
  `explosion` (547) at the barrel. At +6: 1756 = 1, "...and destroy the barrel and the
  cannon.", 1749 = 1 and varp 40.
- **Hull:** "Fill" nails planks (3137, `cf_hammer`); "Waterproof" smears paste (832,
  `cf_smear_paste`).
- **Plunder:** the chest gives 3, the crate 2 and the barrel 1. Each refills on its own timer:
  barrel 100 ticks, crate 200, chest 300 (1284-1690). The Wiki agrees: the barrel is fastest and
  the chest slowest. Before the plunder stage the chest and barrel answer "I don't have time to
  search that." An empty storage counts as "This chest is empty." (1395).
- **Cannon** (11213 on 1741: 0 Cannon Inspect/Empty-Out, 1 and 2 Broken Cannon Repair, 3
  Fire!):
  - Repair puts 1741 to 2. The broken barrel (7146) goes into the inventory and "You remove the
    broken cannon barrel." follows. Two ticks later the new barrel goes on (1741 = 0, varp 100).
  - Loading: powder (832, `cf_pour_gunpowder`). Ramrod (3136, `cf_ramrod`); the same shove also
    cleans the barrel. Canister (3133 + `cf_roll_canister`, then the message and 3135 a tick on)
    or cannon ball (3134 + `cf_loadcannon`). Fuse sets 1741 = 3 and leaves `fever_cannon_fuse`
    alone.
  - Firing: the load is emptied and `fever_cannon_clean` (1746) = 1 until the ramrod clears it.
    It plays 832, the area sound `cf_cannonfire` (radius 10), `fever_cannon_blast` (542) at
    1818,4833, and the shrapnel (544) or ball (543) flight.
  - A canister lands 2 ticks on: "You hit them!", varp 120, the explosion (547) and
    `cf_cannonhit`, then the 52 hitsplat on the pirate. One hit is the objective.
  - A cannonball lands a tick on with "You put a hole in the hull!" / "You put another hole in
    the hull!". The third hit goes straight into "Ye've done it lad! They're sunk now!".
  - Hits roll on Ranged: the Wiki's "Cannon (Cabin Fever)" gives 6% at level 1 to 94% at 99, the
    same for cannonballs and canisters (JagexAsh, 24 January 2023). Live's four shots at Ranged 67
    all hit; a run with misses (#6500's five balls) is what the roll expects.
- **Return-Home** (Bill 4014 op 3, 1050-1087): "No, I need to go back now." fades to black and
  lands the player on the port ship at 3714,3497. The port Bill's "Let's go Cap'n!" fades back
  to 1815,4833, and Bill greets them with the stage's returning line.
- **End cutscene** (2124-2307), played by `plugins/quests/cabinfever/Scenes.CabinFever.js`:
  - 2124 and 2127: Bill's two deck lines, held (no "Click here to continue"); the player is held.
  - 2130: fade out. 2133: the cutscene (cutscene_status, minimap off, NPC/loc/obj ops hidden,
    `fov_clamp`, `draw_distance_max_override`, the area-sound overrides, the side tabs closed) in
    a copy of The Other Inn (`rebuild_region`, 5 x 5 chunks from 3656,2976), the player on
    3665,2980.
  - 2136: Bill (4012, `fever_cutscene_teach`) on 3665,2982 and Mama (4021) on 3663,2982 face each
    other; the camera at 3664,2979 (height 290) looks at 3664,2983 (160), rates 232/232. 2140: fade
    in.
  - 2143-2293: the transcript's 23 lines, every one held, each also said overhead in parts three
    ticks apart. 2182: the camera to 3668,2983 (310; rates 12/1) looking at 3664,2980 (20; 17/1).
    2186-2189: Mama walks south to 3663,2978 and faces west; 2191: Bill faces the player.
  - 2224, with "Here, have this book.": the Book o' Piracy and `fever_given_book` (1763) = 1.
  - 2299: fade out. 2302: the real map at 3665,2980, facing west, the camera reset. 2307: the
    cutscene ends (tabs back, fade in).
- **Completion** (2310-2312): varp 140 and the battle's varbits clear (1746, 1749-1752,
  1756-1760); `fever_given_book` (1763) stays. Claiming the gold later sets `fever_gold` (1765).
- **After the quest** (2475-2700): the island's pirates speak their "with Book o' Piracy" lines
  with the book in the inventory, not worn: 4023 (`fever_pirate_island_01`) "What's a landlubber
  like ye doin' here?" (the Wiki's pirate 1), 4027 pirate 5, 4028 pirate 6, 4031 pirate 9. The
  Wiki: "players must be carrying this book in their inventory to understand what other pirates
  are saying." Bill on the Mos Le'Harmless ship (4016, 2528-2600) opens with "I suppose ye'll be
  wantin' a lift while yer here, right lad?" and offers "Can I have that gold now?" as the first
  of his three options.

## Findings

- **fixed** (#6500) The rope swing dropped the player on the rope's tile and waited there; live
  drops them beside the mast and walks them round it.
- **fixed** (#6500) The end scene played as click-through dialogue on the ship; it is now live's
  cutscene in The Other Inn.
- **fixed** (#6500) Mos Le'Harmless's pirates and traders (all but Mama) spoke pirate-speak with
  the Book o' Piracy in the inventory.
- **open** Bill's post-quest claim plays "Can I have that gold now?" straight away; live puts it
  in his "lift" menu. The transcript has it as its own section, so this needs a dialogue-dump
  change (osrsreboxed-db).
- **open** The battle is the static map at 1813-1827,4824-4842, not live's instance, so other
  players can see the ship's NPCs. The per-player varbits and owned locs (open lockers, the swing
  rope) keep each player's ship apart.
- **open** The port-ship Bill is still swapped to 4014 so the server sees Talk-to; 4014 also
  shows Return-Home at the port, which does nothing there.
- **known difference** The capture words some lines differently from the Wiki, and the Wiki's
  wording is kept: "You nail the Planks over the the hole!", "You attach the new barrel to the
  cannon." (live: "...cannon base."), "You have plunder to deposit." (live: "You have no plunder
  to deposit."), the fall as two messages, and the player's "Yes, I am a man of my word." after
  the start prompt (live: "Yes, I keep my word.").
- **fixed** Varp 655 skipped live's objective-done steps (40, 60, 80, 100, 120). After a relog
  it fell back to the step before them.
- **fixed** The lockers handed out the whole stage kit at once; they now open, then show their
  item interfaces, and each press gives one item (buttons answer only while the modal is open;
  rope stops at four, hammer at one, tacks and paste at what the open holes need).
- **fixed** `fever_cannon_clean` was held the other way up. It was also set on arrival and on
  repair, and the fuse set `fever_cannon_fuse`. Old saves are flipped once at login.
- **fixed** Three canister hits were required; live and the Wiki's guide take one.
- **fixed** Bill's Return-Home and the sail back were not wired.
- **fixed** The enemy hold chest is reachable (#4182).

## Runs

### 2026-11-20 · agent · claude-opus-5-5

- **Start:** fresh account, `::master` and `::quest` for Pirate's Treasure, Rum Deal and Priest
  in Peril, placed at the Green Ghost with `::tele` (the only teleport). A tinderbox was given
  with `::item`, because the first floor pickup was interrupted by the next action.
- **Route:**
  - The pub start, then the gangplank with `travel_to` and "Let's go Cap'n!".
  - Locker presses, the net, a swing, the fuse laid and lit (varp 40), the swing back, then
    Bill (50).
  - Return-Home to the port and back.
  - A relog, the three holes (60), Bill (70), a swing with a fall, the hold's plunder, waiting
    for the barrel refill, and a relog for the chest.
  - The swing back, Count (empty) and Store (80), Bill (90), the barrel swap (100) and Bill
    (110).
  - One canister hit (120), Bill (130), four cannonballs with a miss, and the end scene.
- **Result:** varp 655 = 140 at 3665,2980. The Book o' Piracy is in the inventory, the battle
  varbits are cleared, and 1763 = 1.
- **Not checked:** the tinderbox floor pickup in game (the focused test covers it), the
  10,000-coin claim, the post-quest lifts and teleporting out of the battle.
- **Focused tests:** `node --test tests/qh728-q009.test.cjs`: 21/21.

Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) (q009); PR [#6312](https://github.com/RSPSApp/tsps/pull/6312), dialogue dump [osrsreboxed-db#129](https://github.com/RSPSApp/osrsreboxed-db/pull/129).
