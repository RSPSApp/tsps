---
quest: Temple of the Eye
key: temple_of_the_eye
status: in-progress
tested: 2026-11-01
tester: agent MCP
model: Claude Opus 5.5
commit: fix/1814-gotr-audit
cache: osrs-241_2026-10-20
start: fresh account, Rune Mysteries and Enter the Abyss completed by command, master skills
travel: ::tele between steps (declared); every interaction a real click
---

# Temple of the Eye

Audited against RSProx 1693 (rev 226, a full playthrough, tick refs below), the pinned Quest Helper
and the Wiki for issue [#1814](https://github.com/RSPSApp/tsps/issues/1814).

The temple's scenes run on the cache's own template squares, the ones Quest Helper's tiles and the
captured cameras name: the untouched temple (2368-2431,5632-5695) for stages 95-110 and 120, the
vision at 2400,5738, and the tutorial's temple (2432-2495,5696-5759). Live copies them into an
instance; here they're unreachable real map with owner-only NPCs and locs.

## Findings

Fixed for #1814:

- A second Mage of Zamorak (the quest spawned 2580 beside the world's 3229).
- Using the amulet or incantation on an NPC opened its menu instead of the amulet talk.
- Persten stood on a basement bed from stage 60. She's at the oasis until 85, then 3105,9570 (11458).
- Traiborn's answer is typed (capture 4376, a count dialog); wrong numbers keep the riddle.
- The vision, the rift and the closing scenes pointed the camera at template coordinates while the
  player stood in the minigame's temple: a blue void with Persten's chathead. Speakers now use the
  captured heads (11451, 11452, 11455).
- Two Great Guardians and the minigame's Tamara and Cordelia in the tutorial.
- Barrier, tile, opened Guardians, rift guardians and their fight, hint arrows, ground chisel and
  pickaxe. Mining repeats, the workbench takes a tick an essence, altars craft all essence at once.
- 4,210 Runecraft XP in the captured parts, not per click. The talisman is used up, and the quest's
  items stay behind at the end.
- The chant's op-less portal (43767) outlived its scene and covered the basement's Enter portal
  (43765, tote above 90), which nothing handled either.

Known gaps:

- Other players on the same step are visible (shared map, not an instance).
- The tutorial's fight is staged, and the beam's map anims aren't sent.
- `npc-dialogues.json`: Persten's "Yes." teleport menu has an empty branch (a jump the parser left
  behind). The quest handles the choice itself; the dumper should be fixed upstream.
- Stage 25 is set on teleport here; capture 3994 sets it just before the teleport prompt.

## Runs

- **2026-11-01, MCP (partial natural run):** stage 0 to 130 by real clicks, travel by `::tele`. The
  amulet talk, the wrong and right riddle answers, the declined incantation, the vision and rift
  scenes (actors and tiles), every tutorial step, 4,210 + 5,000 Runecraft XP once, and the basement
  portal into the lobby. Not checked: relog mid-scene.
- **2026-11-01, real web client:** vision (Stone of Jas, silhouette heads, Persten's return), rift
  scene with creatures and Persten falling, the Great Guardian rising, tutorial barrier, walking
  rift guardians, HUD, closing scene, completion scroll, and "Enter Portal" on the basement portal.
  Screenshots only, so timing and sound weren't judged.

Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) other; PRs: [#1175](https://github.com/RSPSApp/tsps/pull/1175).
