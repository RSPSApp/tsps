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

- **Source:** user-supplied RSProx capture `20261106T101002-5ab63b4.bin` (revision 242.1, a fresh run from the
  Guildmaster to the Oziach hand-in), SHA-256 `7ab95f958f587c8a1ff61bc3762aae4a2c1fea95d2b52212ef553115b0a5fd1b`.
  It was transcribed with upstream `blurite/rsprox` `master` at `f1081e91839fee9af02d090ade82dfc47e234120`
  (`TranscribeCommandKt`, filter set `archive`, instanced coordinates translated to source tiles). The raw log
  is kept out of Git because it carries account details. Redacted excerpts of the cited tick ranges, with the
  decoder settings and the redaction script, are in
  [this gist](https://gist.github.com/Bandit-HaxUnit/f07570da5ee93ced5e21e83fd7770123). Tick numbers below are
  that capture's.
- **Matched the plugin already:** the varp 176 wire sequence 0,1,2,3,6,7,8,9,10; plank varbits 1835-1837;
  instruction varbits 3742-3746; offering varbits 3747-3750; 1832, 3741, 18306; locs 25115, 25154, 25161,
  2606; Crandor rocks 53234/53236 at 84 Agility (already a captured shortcut, rsprox 362).
- **Dialogue:** every capture line was checked against the imported transcript. The Dragon Slayer I page
  differed in four places, fixed in the producer, not by hand (RSPSApp/osrsreboxed-db#50):
  - "with each of them" and Klarense's merged "Of course! How does 2,000 coins sound?..."
  - "Well, you're braver than I!"
  - the Guildmaster's full-inventory reply, "Ask me about Melzar's map piece again when you have enough free
    inventory space for the key." It returns to his follow-up menu (tick 1146) and gives no key.

  The import is producer master `7ff2a7f2ed` (with the Prince Ali Rescue correction), which main already imports, plus that correction: osrsreboxed-db#50 at `0166af04b6`. Only the
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
  - He respawns 30 ticks after removal, the Wiki's figure (sources.md: on behaviour the Wiki wins). The
    capture shows 29 (removed tick 2609, back at 2638).
  - Each spell's hit and effect land with its own projectile (3 ticks for Curse from one tile, its captured
    90-cycle flight), not on the generic NPC spell timing.
  - **Not from OSRS** (server/AGENTS.md rule 10): which attack he picks, the stat gating and the cabbage
    spell come from another server's script, LostCity's 2004 (revision 274) `melzar_the_mad.rs2`, which
    says its tables are "based off of 200 or so attacks". Nothing on OSRS confirms them yet.
    - Beside the player, on a 0-127 roll: Weaken under 20, Curse under 40, Fire Strike under 60, the cabbage
      under 80, else a kick. Weaken is skipped if the player's Strength is already lowered, and Curse if
      their Defence is.
    - At range: Weaken under 8, Fire Strike under 16, the cabbage under 24, else he walks in and rolls again
      beside the player. LostCity's Zap (24-31, seen only when he auto-retaliates) is left out.
    - The cabbage spell:
      - cast animation 710 (`human_castentangle`) and graphic 177 (`entangle_casting`);
      - he deals no damage, the player stops attacking him, and his next attack is 5 ticks away;
      - a tick later a cabbage (1965) appears for 100 ticks on a tile 1-7 from him that he could walk to,
        with smoke (graphic 86, `smokepuff`).

      "Could walk to" is a walk outward from his tile that no wall or closed door crosses, so the cabbage
      stays in his room (the Wiki: "a random spot in the room"). It stands in for LostCity's line-of-walk
      test and is a little wider, since any path inside the square counts, not only a straight line.
    - The names were checked against the revision 241 cache.
    - The capture fits these tables: 5 attacks and no cabbage, which happens about 43% of the time at 20/128.
      So does the Wiki, which names the cabbage spell.
- **Map chests** (ticks 1421-1435, 2693-2709): Open first, with the Oracle chest's lid inscription and then
  the open chest. Search gives "You find a map piece in the chest." in an item box as it shuts. Close shuts it.
- **Voyage and lair** (ticks 3158-3440):
  - On the ship the player stands at 2066,5516 and faces each speaker, the fire, the fly-past and the land.
  - During the fly-past the player hops to plane 2 on the same tile and back the next tick (ticks 3270-3271),
    which takes Ned and Jenkins out of view and back. The crash lands the player at 2849,3238 (tick 3339),
    where they stay until released.
  - In the intro the player waits out of shot. Elvarg faces west, seven footsteps sound and she walks five
    tiles. The entrance lands on 2833,9658.
- **Elvarg** (ticks 3445-3627):
  - The breath lands at 60 + 10 cycles a tile from her centre. The hit lands at max(3, floor(arrival / 30))
    ticks.
  - She may breathe from the tick after the jump in starts.
  - After the player climbs back out she stands down and watches from the lair's west edge.
  - The head cut walks the player to the tile west of her head, facing it, with sounds 3744/3745 and the
    silence track.
- **From the user's RuneLite test (second pass):**
  - **Doors:** the Champions' Guild door (ticks 969-973) and Melzar's front, colour and exit doors (ticks
    2070-2688) are pass-through doors. Open puts the invisible blocker on the doorway and the door's open
    leaf beside it (sound 46 for the guild, 62 for the maze); the player walks across and the door shuts two
    ticks later. Before this, the guild door swung and stayed open, and the maze slid the player through a
    closed door. A maze key is spent as its door opens. A door without its key says "This door is securely
    locked." The Guildmaster greets players as they come in (tick 971).
  - **The Guildmaster's follow-up menus** after each answer are the captured ones (ticks 1141-1756), through
    an `options` hook on NpcDialogues' menu notice. Before this, the player was stuck in the three map-piece
    questions.
  - **Study on the map pieces** shows the piece's transcript line in an item box (ticks 2942-2948).
  - **The Lady Lumbridge's ladder** goes down into the hold (3048,9640,1; tick 2917), where the hole is and
    where Quest Helper's repair step looks. It used to go to the dock under the ship.
  - **Elvarg's fire** lands on the player: the captured heights were passed unscaled, and the projectile
    encoder multiplies heights by 4.
  - **Quest Helper in the maze:** its `melzarsMaze` zone covers plane 0 only. On the upper floors it shows
    the Melzar steps only once the player holds the other two map pieces and has asked all five questions.
    This is Quest Helper's own logic, and the same on live. The landing after the rat-room ladder matches
    the capture (2927,3256,1).
  - **"Can I have a quest?" ending the first time:** not reproduced through the agent MCP on a fresh account
    with 32 Quest Points (the level warning, then the start menu).
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
  - Melzar's line odds: from 6 lines in 18 ticks. His attack odds, stat gating and cabbage spell are
    LostCity's (above), not seen on OSRS. Nothing landed, so his max
    hit is the Wiki's 5: the spells are capped at it, and the kick uses his monster definition's max hit
    (also 5).
  - Elvarg's melee and breath when the player is adjacent or under her; her wander and acquisition range.
  - How long she would wait at the wall (ours: until the player walks off).
  - Head-cut pacing from start tiles other than the captured one.
  - The chests' replies with no map to find.
  - Wrong-colour maze doors (#410), which the capture doesn't exercise.
- **Still different from live:**
  - "Eye of the Storm" (track 360) is missing from the rev241 music data until a cache bump.

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Skipped:** No rsprox database capture covers the quest route. The archive has journal
  text, Oziach's clue-scroll dialogue, post-quest Crandor visits and unrelated Melzar
  sightings, but no captured start, voyage, maze, Elvarg fight or hand-in. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1112](https://github.com/RSPSApp/tsps/pull/1112).
