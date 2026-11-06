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

- **Source:** user-supplied RSProx capture `20261106T101002-5ab63b4.bin` (revision 242, fresh run from the
  Guildmaster to the Oziach hand-in), transcribed with upstream `blurite/rsprox` (`osrs-242`; the local
  clone only reaches 241). Raw log kept out of Git.
- **Matches the plugin:** varp 176 wire sequence 0,1,2,3,6,7,8,9,10 (plank varbits 1835-1837 set on
  repairs, cleared on the Crandor crash); instruction varbits 3742-3746, offering varbits 3747-3750,
  1832, 3741, 18306; ids 25115 (Magic door), 25154 (ruin entrance), 25161 (low wall), 2606 (secret door).
  Spoken dialogue matched the wiki-derived `npc-dialogues.json` except four lines (see Dialogue import);
  `[lad/lass]` is a placeholder the runtime resolves, not a defect.
- **Changed:** "You use the key and the door opens." at Melzar's door; "You climb over the low wall.";
  "You found a secret door..." on the first secret-door click; Crandor rocks 53234 / 53236 (bottom
  2832,3248, top 2832,3251). Below 84 Agility they open the item message box (item 6517, as the capture
  shows) with the refusal text; at 84 they cross with no XP.
- **Live check (stage 9 checkpoint accounts, `::quest` + `::tele`, own MCP port 39821 because Windows holds
  49821 under WSL2):** Melzar message, low-wall message (plus the existing fire burn), secret-door message
  on the first click only, and the rocks refusal as an item dialogue at 1 Agility all fired; at 84 the bottom
  rock moved the player to y=3252 and the top rock back to y=3247. Not a fresh run.
- **Also changed (second pass):**
  - Melzar's Maze plays "The Maze" (track 365) on all three floors via a quest `Area`. The map's region
    track there is Emperor (138); the capture switches to 365 on opening the door. The bounds
    (x 2921-2940, y 3238-3259, floors 0-2) are approximated from door, ladder and exit-door placements,
    not read from a cache boundary. Live: entering unlocked The Maze on a fresh account.
  - Guildmaster with a full inventory: after "...so I can give you this key to Melzar's Maze." he says "Ask me
    about Melzar's map piece again when you have enough free inventory space for the key." and no key is given
    (the old behaviour showed "The Guildmaster hands you a key" with no key). The branch is dialogue data now
    (condition `dragon-slayer-i:melzar-key-no-space`); the plugin only answers "free inventory space".
- **Music findings:** Null and Void is the Mage Training Arena area track (the player teleported through it),
  The Shadow and Attack 2 already unlock from Crandor regions, and "Eye of the Storm" (voyage, track 360) is
  absent from the 241 music data, so it stays pending a cache bump.
- **Dialogue import:** four wiki lines differ from the capture ("with each of them", "braver than I", Klarense's
  merged "Of course! How does 2,000 coins sound?...", and the full-inventory reply). They are fixed in the
  producer, not by hand: [RSPSApp/osrsreboxed-db#50](https://github.com/RSPSApp/osrsreboxed-db/pull/50)
  (draft; head `6043939b7d`) adds a reviewed `Dragon Slayer I` correction plus an `insert` change type. The
  imported `npc-dialogues.json` is that change on top of producer `57247b9872`, the commit this repo already
  imports: exactly one record (`Dragon Slayer I`) differs, and `npc-dialogue-index.json`,
  `dialogue-types.json` and `event-dialogues.json` stay byte-identical. Producer master is 25 records ahead
  and is not imported here. Live: the Guildmaster, Klarense (purchase still sets 176=3) and the full-inventory
  reply play from the new data.
- **Not verified:** the rocks' success animation and landing tiles (the capture only shows the refusal; the
  Wiki lists 0 XP). The bottom rock could not be tested at low level because the beach moss giants keep the
  player in combat; the top rock exercises the same handler. The 30 coin boarding message belongs to the
  charter-ship code and is untouched.

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Skipped:** No rsprox database capture covers the quest route. The archive has journal
  text, Oziach's clue-scroll dialogue, post-quest Crandor visits and unrelated Melzar
  sightings, but no captured start, voyage, maze, Elvarg fight or hand-in. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1112](https://github.com/RSPSApp/tsps/pull/1112).
