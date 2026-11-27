---
quest: Eagles' Peak
key: eagles_peak
status: in-progress
tested: 2026-11-27
tester: agent
model: claude-opus-5-5
commit: d6618ab39
cache: osrs-242_2026-11-03
start: checkpoint
travel: travel_to
---

# Eagles' Peak

Rebuilt from the user's RSProx capture of the whole quest and every eagle route (EaglesPeak+AllUnlocks, revision 243.1,
eaglepeak_quest 0 -> 40 at ticks 86-2438). The saved stage is the cache's own eaglepeak_quest (2780), and the side state
is the cache's own varbits, so the client draws the camp, the cliff, both Nickolauses, the eagle door, the gold room's
levers and the silver room's footprints itself. Ticks below are that recording's.

## Findings

- **fixed** The gold room's birds and wings did not match live, and six feeders "solved" it. The birds, wings and levers now follow the capture. #6881
- **fixed** No footprints after inspecting the silver room's pedestal. They are the map's multilocs on 3099, which is now sent. #6881
- **fixed** Two eagles at the nest, and Walk-past did nothing: the plugin spawned its own eagle over the map's one. It now uses the map's one, and Walk-past walks the player through it. #6881
- **fixed** Nickolaus's ferret-offer option answered nothing: the Wiki transcript has no lines for it. osrsreboxed-db#151 adds live's.
- **open** The feathered journal's ground spawn in ground-items.json is on plane 0. Live has it on the eyrie's plane 3 (2004,4983,3). It is a legacy importer row with no export row behind it.

## Capture facts

- **Start (t83-86):** Charlie's start is live's prompt, "Start the Eagles' Peak quest?" Yes./No., in place of the transcript's two options. The stage is 5 with the start message as he answers. Under 27 Hunter (boostable, Wiki) he turns the player away.
- **Camp-site:** the camping equipment (19788), books (19787) and campfire (19785) are map multilocs on 2780, with Inspect only at 5-20.
  - Books: the bird book's box and the book at once (t238).
  - Read: at 5, the box first with the stage at 10 and the metal feather (t245), then the book (680, human_readbook) on its continue (t247). The pages are the capture's, bird models included.
- **Cliff:** the metal feather on the outcrop (19790) gives two boxes, with 15 on the first's continue (t277-280); the feather is kept. Enter: "You enter the tunnel." (filterable) and 1994,4983,3 (t284).
- **Meeting Nickolaus (t308-317):** stepping on to 2006,4973 at 15 sets eaglepeak_nickolaus_chat (3110) to 1, moves the camera (2013,4966 h825 looking at 2006,4971, then 2006,4964), walks the player to 2004,4967 and the map's Nickolaus (2023) to 2006,4961.
  - "Hello? Er... excuse me?" shows without a continue for 8 ticks; he waves and the camera comes back.
  - 3110 goes to 2 as the first menu opens (t334) and to 3 on "That's a good idea..." (t491).
- **Asyff:** 3110 goes to 4 on "I'll see what I can do." (t778) and to 5 as he makes the costumes (t818): 10 feathers, tar, dye and 50 coins for two capes and two beaks.
- **Bronze room (t1115-1170):** a copy of the map per visit, as live's rebuild_region. The tunnel sets 3113. Take-from on the net trap (19980) runs the trap sequence; 3105 is 1 five ticks on.
  - Each winch (19976-19979) sets its bit of 3100 with its line, but only once the trap is sprung.
  - The fourth winch clears 3105 and drops the trap; the stone pedestal (19984) appears two ticks later.
- **Silver room (t1211-1326):** in a copy. The pedestal sets 3099 to 1, the first rock (19458) to 2, the second (19461) to 3. The opening at 3 sets 4 and plays the kebbit's jump: camera, shake, its projanim 965 and spotanim 966, and the player stumbles back saying "Er...".
  - Threaten: "Hey, give me that!" said and in the chatbox, the stare's box, then Taunt / Try something else.
  - Taunt: the two lines, then it walks a tile a tick into the tunnel and drops the feather (owner only) with 3099 = 5.
- **Gold room (t1376-1903):** in a copy. 3089 holds gates 1-4 (1, 2, 4, 8) and mechbirds 1-5 (16-256).
  - Levers: lever1 turns wings A and C over, lever2 C, lever3 B and D, lever4 E. At 0, C and D are open.
  - A seed in a feeder calls the bird whose rail ends there: projanim 961 out or 964 back, a landing spotanim, the camera over it, and the bird moved after its flight.
  - A shut wing turns the bird back (t1621), and the feeder's other bird comes instead (t1627).
  - The reset lever outside sets 3089 to 0.
- **Eagle door:** the bronze feather sets 3106 bit 2, the gold one bit 1, the silver one 3099 = 6; the last of the three sets 20 (t1941). Open swaps the leaf for its open loc over an invisible wall for two ticks while the player steps across (t1947, t2061).
- **The eagle (1490):** without the disguise, the swipe; hits of 2 (t1994) and 0 (t2805) were recorded. With it, Walk-past is a four-tile walk through the eagle with the sidestep animations (t2002-2006).
- **Disguise:** the box on Nickolaus's talk; on its continue the spare goes and the stage is 25 (t2025). Out of the cave is 30 a tick later (t2094).
- **Ferret lesson (t2204-2259):** in a copy of the camp, with the cutscene state, minimap off and tabs shut. The trap catches a ferret; the player dismantles it for 35, the box trap and the ferret.
- **Hand-in (t2427-2442):** the ferret used on Charlie gives 40. The scroll reads "2 Quest Points", "2,500 Hunter XP", "Eagle Transport Access", "Ability to use Box Traps", with the ferret model at 76,128.

## Recorded differences (Wiki wording kept)

- Asyff's "Errr...what are you saying exactly?" (live: "Errr... what").
- The door's "...indentations in the engravings." (live: "engraving", t1194, t1936).

## Not capture-verified (Wiki or Ours)

- The silver pedestal's low-Hunter box; a rock out of order; reclaiming the silver feather; a second bronze or golden feather; a feeder whose bird is already there; the reset lever with nothing to reset. These are from Transcript:Eagles' Peak.
- Ours:
  - "The winch doesn't seem to turn any further." for a winch before the trap is sprung (the Wiki has no line).
  - The swipe's 0-2 damage range.
  - The lower door leaf's open rotation.
  - Bird2's turn-back tile.
  - The cameras of the feeders the capture did not use.
  - The kebbit coming out again on a revisit while 3099 is 4.
  - The journal at 10, 30, 35 and 40.

## Runs

### 2026-11-27 · agent · claude-opus-5-5

- **Start:** targeted tests from saved stages (`server/tests/eagles-peak-capture.test.cjs`); natural playthrough pending.
- **Not checked:** see the PR.
