---
quest: Holy Grail
key: holy_grail
status: passed-with-issues
tested: 2026-11-02
tester: agent
model: claude-opus-5-5
commit: 575920213
cache: osrs-241_2026-10-20
start: checkpoint
travel: travel_to
---

# Holy Grail

The whole quest was played on this server along the OSRS Wiki / Quest Helper route, from King
Arthur's start to handing him the Grail, with a repeat talk and a relog after. No rsprox recording
of the quest exists, so the wiki transcript, Quest Helper and the cache are the references. Two
transcript menus are still shaped wrong by the dialogue dump (see Findings).

## Findings

- **open** Galahad's "I seek an item from the realm of the Fisher King." is not in his first menu:
  the dump keeps it in a condition step after the menu, so it only appears after the "I'm on a quest
  to find the Holy Grail!" > "Well, I'd better be going then." branch. A dumper fix in
  osrsreboxed-db (fold a guarded single option into the menu before it).
- **open** Sir Percival's "Your father wishes to speak to you." is unreachable: the wiki transcript
  indents the whistle conditions between his two options. Also a dumper fix.
- **open** King Arthur's "Start the Holy Grail quest?" prompt shows as a plain "Select an option"
  menu (the dump gives the prompt to an empty choice).
- **open** The fairy ring BJR is not gated on quest progress; the OSRS refusal message is unknown.
- **open** `travel_to` can't route through the Grail castles' inner doors (both realms) or to
  their first floors; the doors and stairs work when clicked.
- **fixed** Galahad gave a magic whistle with the napkin; the two whistles are now on the Draynor
  Manor table, seen only while carrying the napkin, topped up on entering the room.
- **fixed** Merlin's workshop door (loc 24) and the Draynor whistle-room door (loc 22) never opened.
- **fixed** The whistle worked across most of north-west Karamja and always went to the withered
  realm. It now works under the tower north of the gold rocks (Quest Helper's zone) and goes to the
  restored realm once Percival is king.
- **fixed** The Black Knight Titan's bridge was opened for everyone and he could not be talked to
  (his page is not in the dialogue index). He now challenges on Talk-to, regenerates unless
  Excalibur is wielded for the killing blow, and a valid kill carries the player past him.
- **fixed** The Grail bell was a public world spawn; the fisherman's "Any idea how to get into the
  castle?" now leaves one for the player by the bricks, one at a time.
- **fixed** Stage 8 was set on opening the Fisher King's dialogue; it is set on "You don't look too
  well." now.
- **fixed** Stage 9 handed out the Grail with the whistle, and King Arthur completed the quest
  without it. The Grail is taken from the restored castle's top floor, King Arthur needs it, and
  completion no longer adds a second one.
- **fixed** The restored-castle Grail spawn never respawned after its first pickup (respawn 0).
- **fixed** The High Priest, Galahad, Merlin, the knights and King Arthur played Holy Grail lines
  outside the quest; restored-realm peasants, maidens, King Percival and the post-quest Arthur,
  Merlin and Sir Percival use their own pages.
- **fixed** Opening the sacks no longer needs only the stage: the feather must be carried. The
  feather's "somewhere nearby", "at the sacks" and dungeon messages follow the transcript.
- **fixed** The transcript's boxed lines show as boxes (Titan, bell, sacks, whistle hand-over, the
  napkin and tea), King Arthur's feather as an item box, and Galahad pours the cup of tea.

## Runs

### 2026-11-02 · agent · claude-opus-5-5 · natural route

- **Start:** checkpoint, not fresh: a new account given Merlin's Crystal (`::quest merlin's crystal
  complete`), `::master` stats, Excalibur, lobsters, then coins and two law and two water runes for
  travel. Placed in Camelot with `::tele`. Baseline: varp 5 = 0, varp 101 = 6, Prayer and Defence
  13,034,431 XP.
- **Route:** King Arthur "Tell me of this quest." > "Yes." (varp 5: 2); Merlin upstairs (3); bank
  Excalibur at Seers'; monk of Entrana to the High Priest and the crone (4); Galahad (napkin, cup of
  tea); Draynor Manor top floor, two whistles from the table; Home Teleport out (the front doors
  won't open from inside); Excalibur from the Draynor bank; Port Sarim and Captain Barnaby to the
  tower north-west of Brimhaven; whistle to 2793,4724 (music Emotion); Titan with a bronze sword
  regenerated to 142, then with Excalibur "Well done!" and carried to 2790,4722 (7); fisherman,
  bell, "Somehow you are now inside the castle."; the Fisher King (8); whistle back, King Arthur's
  feather; feather pointed east from Camelot and "at the sacks" in the house; sacks prodded, then
  opened; Percival took one whistle (9); Ardougne Teleport and Barnaby back to the tower; whistle to
  the restored realm at 2665,4724 (music Miles Away); peasant, Grail from the top floor, King
  Percival; whistle out, King Arthur (10).
- **Result:** varp 5 = 10, quest points 6 → 8, Prayer +11,000 XP, Defence +15,300 XP, the Grail
  kept. Repeat talk to King Arthur gives his post-quest line; a relog keeps stage 10, 8 quest points
  and the Grail.
- **Not checked:** the Grail respawn after the fix (the run picked it up before the change), the
  "greedy" box in game (covered by the unit test), Merlin's post-quest line, the fairy ring route,
  the in-progress journal text.
