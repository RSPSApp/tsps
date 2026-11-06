---
quest: Dragon Slayer I
key: dragon_slayer_i
status: passed-with-issues
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Dragon Slayer I

Community-reported completion accepted for scheduling (skip full manual replay). Retained caveat: Some optional dialogue was incomplete or missing; completion was possible.

## Findings

- **open** Some optional dialogue was incomplete or missing; completion was possible. [#1257](https://github.com/RSPSApp/tsps/pull/1257)

## Runs

### 2026-11-06 · agent · rev-242 capture review

- **Source:** user-supplied RSProx capture `20261106T101002-5ab63b4.bin` (revision 242, SHA-256 `7ab95f95…fd1b`,
  a fresh run from the Guildmaster to the Oziach hand-in), transcribed with upstream `blurite/rsprox`
  (`osrs-242`). The raw log is kept out of Git. Tick numbers below are that capture's.
- **Matched the plugin already:** the varp 176 wire sequence 0,1,2,3,6,7,8,9,10; plank varbits 1835-1837;
  instruction varbits 3742-3746; offering varbits 3747-3750; 1832, 3741, 18306; locs 25115, 25154, 25161,
  2606; Crandor rocks 53234/53236 at 84 Agility (already a captured shortcut, rsprox 362).
- **Dialogue:** every capture line was checked against the imported transcript. The Dragon Slayer I page
  differed in four places, fixed in the producer, not by hand (RSPSApp/osrsreboxed-db#50):
  - "with each of them" and Klarense's merged "Of course! How does 2,000 coins sound?..."
  - "Well, you're braver than I!"
  - the Guildmaster's full-inventory reply, "Ask me about Melzar's map piece again when you have enough free
    inventory space for the key." It returns to his follow-up menu (tick 1146) and gives no key.

  The import is producer master `39ee9b5bc5`, which main already imports, plus that correction. Only the
  `Dragon Slayer I` record differs, and `npc-dialogue-index.json`, `dialogue-types.json` and
  `event-dialogues.json` are byte-identical.

  The Duke used to play his own page, which words five of the captured lines differently. He now plays
  this page's variant, which matches all of them (ticks 2790-2811). The key and shield hand-overs are item
  boxes, as live shows them (ticks 1756, 2808).
- **Messages:** "You use the key and the door opens." on Melzar's door (tick 2070); "You climb over the low
  wall." on the spam channel at every crossing (3488, 3493, 3547); "You found a secret door..." on the first
  crossing only (3520). The rocks' refusal below 84 is the agility_climb item box (tick 3375). It is shortcut
  data (`levelMessage`) played by the shared Agility runner; the quest no longer has its own rocks handler.
- **Melzar's Maze:** "The Maze" (365) plays on the three floors through a quest `Area`; the map's region
  track there is Emperor, and the basement's region already plays 365. The bounds (x 2921-2940, y 3238-3259
  and 9638-9659) are approximated from placements, not read from a cache boundary.
- **Melzar the Mad** (ticks 2584-2609):
  - He attacks every 4 ticks with Fire Strike, Curse or Weaken (cast animations, projectiles and cycles as
    captured), or kicks (423) when beside the player. He used to only melee.
  - His four overhead lines come from the transcript on a 1/3 roll each tick in combat (6 lines in 18 ticks;
    silent out of combat).
  - He respawns 29 ticks after removal.
  - The capture has no cabbage of any kind, so none is added.
- **Map chests** (ticks 1421-1435, 2693-2709): Open first, with the Oracle chest's lid inscription and then
  the open chest. Search gives "You find a map piece in the chest." in an item box as it shuts. Close shuts it.
- **Voyage and lair** (ticks 3158-3440):
  - On the ship the player stands at 2066,5516 and faces each speaker, the fire, the fly-past and the land.
  - In the intro the player waits out of shot. Elvarg faces west, seven footsteps sound and she walks five
    tiles. The entrance lands on 2833,9658.
- **Elvarg** (ticks 3445-3627):
  - The breath lands at 60 + 10 cycles a tile from her centre. The hit lands at max(3, floor(arrival / 30))
    ticks.
  - She may breathe from the tick after the jump in starts.
  - After the player climbs back out she stands down and watches from the lair's west edge.
  - The head cut walks the player to the tile west of her head, facing it, with sounds 3744/3745 and the
    silence track.
- **Live check** (own MCP port 39821; Windows holds 49821 under WSL2; checkpoint accounts set with `::quest`
  and `::tele`, not a fresh run):
  - The rocks at 1 Agility show the item box once, and at 84 climb both ways.
  - The Guildmaster with a full pack gives the reply and returns to the menu; with room, the key is given in
    its item box.
  - The Duke's shield conversation matches the capture line for line and gives the shield in its item box.

  The chests, Melzar's fight, the voyage and lair, Elvarg and the head cut were checked by the targeted
  tests only (`f2p-adventure-parity`, `qh-f2p-dragon-parity`, `elvarg-parity`, `elvarg-under`, `agility`,
  `crandor-secret-wall`).
- **Not verified:**
  - The rocks' climb from the top and the top rock's refusal: only the bottom rock was clicked.
  - Melzar's line and kick odds: from 6 lines and 4 attacks beside the player. His max hit stays the Wiki's
    5, since nothing landed.
  - Elvarg's melee and breath when the player is adjacent or under her; her wander and acquisition range.
  - How long she would wait at the wall (ours: until the player walks off).
  - Head-cut pacing from start tiles other than the captured one.
  - The chests' replies with no map to find.
  - Wrong-colour maze doors (#410), which the capture doesn't exercise.
- **Still different from live:**
  - "Eye of the Storm" (track 360) is missing from the rev241 music data until a cache bump.
  - After a Guildmaster answer, live shows a menu of the remaining questions plus "What kind of ship do I
    need?", "How can I protect myself from the dragon's breath?" and "Okay, I'll get going!" (ticks 1146,
    1756). The transcript's "other options" jump replays the previous map-piece menu instead. This predates
    this change and is a dialogue-runtime matter.

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Skipped:** No rsprox database capture covers the quest route. The archive has journal
  text, Oziach's clue-scroll dialogue, post-quest Crandor visits and unrelated Melzar
  sightings, but no captured start, voyage, maze, Elvarg fight or hand-in. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1112](https://github.com/RSPSApp/tsps/pull/1112).
