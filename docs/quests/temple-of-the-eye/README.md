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

For #1858, queued Continues could reach the incantation's overhead chant before its newly spawned
cast entered native NPC sync, closing the dialogue while leaving stage 90 and cutscene controls
active. The scene now holds for one sync tick before starting its unchanged transcript.

Holding Space through the chant still froze the scene: "Alright, with me!" stays in the chatbox
while the chant waits on its timer, and a Continue on it ended the chain under that timer. Native
Continues no longer advance a step that moves itself on (an overhead line, a held line, `Scenes.hold`),
which covers every transcript cutscene, not just this one.

For #1906, the temple scenes are real private instances instead of the shared cache template squares.
The untouched temple, the Stone of Jas vision and the tutorial's arena each get their own
`TemplatedInstanceArea`, so the vision is the stone in a void and no copy can see another. Nothing
stands on the template map any more, so the quest, the vision, the tutorial and the minigame cannot
see one another, and random events (which skip private areas) cannot interrupt the scenes. The camera
and every owner-only NPC/loc are mapped through the active copy. Switching to the vision, to the
tutorial and back for the closing scene, relog recovery, and the altar trips now enter the correct
copy; `::tele`/logout during them recovers at the matching start tile.

- Persten calling the player back ends the vision on that line: the player returns to the temple
  markings and the camera resets instead of staying in the vision.
- The tutorial's first Felix explanation is tracked separately from its short repeat, so a save
  parked on his step hears the weak-cell explanation once rather than "take one to Tamara".
- The exploration apprentices' repeat keys map to their real transcript variants; Felix's
  `<name>-again` shortcut does not exist, which used to fall through to the generic shop page.
- Tutorial arrows sit over the middle of multi-tile locs (the large guardian remains, the piles,
  the workbench, the cell tables); after Felix explains the workbench the arrow moves there.
- At the Mind-altar step, Tamara replaces a weak cell the player never made as well as a lost
  catalytic stone, so skipping the uncharged cell no longer softlocks the barrier.
- Persten is pulled into the rift on the "dragged into the rift" action, and the creatures appear
  when the transcript says they do.

For #1978, the vision plays its opening like capture 1693 (ticks 4609-4633). The chatbox is held
on arrival; 11 ticks later the player walks seven tiles south to the Mysterious Stone (2400,5731)
while the camera slowly pans to it (2403,5728), and the voices start 24 ticks after arrival. Before,
the voices started at once, the player never moved, and the pan ran on "And with you, Zachariah",
which carried the camera away from the player. Live returns the player to the temple on "Jas!"
(level 1 of the vision's build area); here it is still on Persten's "[player name]?".

Known gaps:

- Other players on the same step are visible (shared map, not an instance).
- The tutorial's fight is staged, and the beam's map anims aren't sent.
- `npc-dialogues.json`: Persten's "Yes." teleport menu has an empty branch (a jump the parser left
  behind). The quest handles the choice itself; the dumper should be fixed upstream.
- Stage 25 is set on teleport here; capture 3994 sets it just before the teleport prompt.
- No capture loses tutorial items, so recovery is ours: the rock and workbench reopen for lost
  essence at the Mind altar's step, and Tamara replaces stones or a medium cell (with our wording).

## Runs

- **2026-11-03, #1978 vision walk, real web client + MCP:** stage 100 by command, the three
  apprentices and Persten by real clicks, chatbox Continues clicked in the browser client. Before
  the fix the player stood at 2400,5738 while the camera panned to the stone on the second voice
  line. After it, the player waits 10 ticks, walks 2400,5738 to 2400,5731 one tile a tick and is
  beside the stone in frame when "Saradomin be with you." opens on tick 24; every voice line, the
  return to the temple and the rift transcript continued. The reported freeze did not reproduce
  on main before the fix: Continue clicks on the real link advanced the vision (missed clicks just
  above the link look like a freeze). The rest of the quest was not replayed.
- **2026-11-02, #1906 instances and tutorial fixes:** offline native checkpoints take the quest
  from stage 90 through the temple instance, the vision return, the tutorial instance, the third
  power-up back in the temple and the tower exit; the Felix repeat, weak-cell replacement and
  workbench-arrow regressions are covered by
  `tests/temple-of-the-eye-named-dispatch.test.cjs`. Web-client screenshots of stage 100 and
  stage 115 show the private temple and tutorial copies with no other copy in view. The vision,
  rift, closing-scene camera tracks and the in-client arrow positions were not re-captured.
- **2026-11-02, offline native checkpoint (stage 85), held Space:** the same harness sends a
  Continue on the open chatbox every tick the chant waits. Stage 100, four chants, one portal and
  restored controls; with the guard removed it stays at stage 90. In the web client (browser pane),
  key-repeated Space didn't freeze it even without the guard: the client sends one Continue per
  chatbox until that widget is rebuilt, so the window the report hit wasn't reached live.
- **2026-11-02, offline native checkpoints (stages 85 and 90):** real Player, ClientConnection,
  quest/dialogue dispatch, NPC spawning and local sync. Paced and same-tick queued Continues reach
  stage 100; the four actors chant, the portal opens, and controls return. Bank/dialogue replacement
  releases the old controls and leaves stage 90 retryable; a new private scene keeps its controls.
  Logout cancels the deferred start. This is not a fresh quest or live browser playthrough.

- **2026-11-01, MCP (partial natural run):** stage 0 to 130 by real clicks, travel by `::tele`. The
  amulet talk, the wrong and right riddle answers, the declined incantation, the vision and rift
  scenes (actors and tiles), every tutorial step, 4,210 + 5,000 Runecraft XP once, and the basement
  portal into the lobby. Not checked: relog mid-scene.
- **2026-11-01, real web client:** vision (Stone of Jas, silhouette heads, Persten's return), rift
  scene with creatures and Persten falling, the Great Guardian rising, tutorial barrier, walking
  rift guardians, HUD, closing scene, completion scroll, and "Enter Portal" on the basement portal.
  Screenshots only, so timing and sound weren't judged.

Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) other; PRs: [#1175](https://github.com/RSPSApp/tsps/pull/1175).
