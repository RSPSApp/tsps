---
quest: Fairytale II - Cure a Queen
key: fairytale_ii_cure_a_queen
status: passed-with-issues
tested: 2026-11-04
tester: Codex headless MCP
model:
commit:
cache: osrs-241-2026-10-20
start: earlier run through stage 65; continuation at stage 65 in the Fairy Queen's Hideout
travel: normal dialogue, fairy ring UI, inventory actions and combat after checkpoint setup
---

# Fairytale II - Cure a Queen

An earlier headless MCP run covered the route through stage 65. A separate
continuation played from stage 65 through the Gorak fight, potion and Queen's
awakening, and completed the quest. The first-entry Fairy Nuff room cutscene
still lacks evidence for its camera choreography, and the Queen's awakening
does not reproduce every native chathead.

## Findings

- **open** Fairy Nuff's first-entry room cutscene remains unimplemented. The Wiki
  confirms the scene, but no first-entry capture or cache client script supplies
  its camera choreography.
- **open** The Queen's awakening uses a shared transcript with one chathead;
  the native scene has dialogue from the Queen, Nuff and Very Wise.

### Certificate and Rune temple sign documents

RSProx recording [424](https://rsprox.net/download/424), revision 232, records
certificate Read opening native group 423 (tick 16448), Study opening 424 (16453),
and the Rune temple sign opening 425 (18355). Script 2524 precedes each mount:
Read/sign use `[-1, -1]`; Study uses `[4269835, 100]` and the recorded turn-over
message. Repeated Read/Study at 16589/16659 confirms the same mapping.

Active cache 241 retains those groups, their document models 16050/16051/16067,
and the certificate/sign's fairy fonts 647/648. The plugin opens these cache
documents without replacing their text. Native inventory, map-object and
IF_CLOSE regressions cover opening, replacement, closing/reopening, retained
certificate, study/sign flags and completed-account access. The client cache-VM
check decodes the server script/mount packets and verifies models, text/fonts
and modal arguments; it is not a GPU render or live playthrough.

The recording starts on an already-completed account. Study's existing immediate
stage 30/study-flag commit and the existing sign prerequisites are preserved;
this evidence does not establish their fresh-account packet timing. The Wiki's
[Surprise! section](https://oldschool.runescape.wiki/w/Fairytale_II_-_Cure_a_Queen#Surprise!)
independently describes Study revealing the back and reading the sign.

The document display fixes in [#2162](https://github.com/RSPSApp/tsps/issues/2162)
were already on the base branch. Recording 424 does not show Fairy Nuff's
first-entry room scene, and the active cache has no client script that supplies
its camera track. The Wiki confirms a short cutscene, but the scene remains
unimplemented until its choreography can be supported by a first-entry capture
or native client data.

## Start-to-finish audit findings

The Wiki quick guide route was checked against the quest source and native
event-entrypoint coverage: wait for Martin, enter Nuff's ransacked room, study
the certificate, ask the Fairy Chef, read the Cosmic Altar sign, get permission,
use the AIR/DLR/DJQ/AJS ring sequence, speak to Nuff and Very Wise, pickpocket
the Godfather, hand the Queen's secateurs to Nuff, collect a star flower and
Gorak claws, learn the potion recipe, brew it, use it on the Queen, and finish
the reward dialogue.

The audit also corrected progression issues beyond the issue comments:

- Starflowers now require the late-quest stage and Nuff's certificate, persist
  a growth timer, and cannot be harvested twice during the quest. The detailed
  [Star flower page](https://oldschool.runescape.wiki/w/Star_flower) says they
  start blooming within a minute; the quick guide says 2-5 minutes. This branch
  uses the one-minute upper bound and does not model faster growth with more
  players.
- Cosmic and Gorak plane visits, and Gorak kills, count only after the Queen's
  secateurs are handed to Nuff. The recipe stage now advances after the final
  line of Nuff's recipe dialogue. Premature brewing is refused without consuming
  the ingredients.
- NPCs cannot attack a player standing on a fairy ring destination tile, as the
  Wiki describes. A regression checks that the protection stops at adjacent
  tiles.
- The document Read/Study/sign UI remains native to cache groups 423, 424 and
  425. Tests cover repeat open, close/reopen, item persistence, and the sign's
  prerequisites.

## Evidence gaps

The local decoded RSProx corpus and available recordings 424 and 426 contain no
first-entry Fairy Nuff cutscene. The Wiki confirms that entering the ransacked
room triggers a short scene, but its camera track and duration remain unknown.
The 2339 varbit is a stage marker and no cache client script reads it as a camera
track, so the scene is left unimplemented until there is evidence to reproduce.

The Wiki gives no exact Tanglefoot Farming/Strength damage formula; that remains
an open Fairytale I parity gap.

## Verification

The continuation started at stage 65 with the account in the Fairy Queen's
Hideout. It used the certificate and sign, fairy ring controls, dialogue and
inventory actions to travel to the Cosmic and Gorak planes, kill Gorak, learn
the recipe, gather a Starflower, brew Magic essence and use it on the sleeping
Queen. The reward dialogue finished with varbit 2326=90, varbit 2335=1, and the
Magic XP lamp message.

During combat setup the account died after its weapon changed, and its items
were in the gravestone. The test was recovered with setup commands to reposition
the account and restore the needed items; quest flags had persisted. The run
then continued with normal quest actions. Targeted native event-entrypoint
coverage checks the stage handlers and recipe flow.

## Runs

### 2026-11-04 · Codex · headless MCP

- **Start:** An earlier headless run covered the quest through stage 65. This
  continuation used a test account set to stage 65 at the Fairy Queen's Hideout,
  with Fairytale I complete and test equipment supplied during setup.
- **Route:** Read the certificate and Rune temple sign; used CKP to visit the
  Cosmic plane and collect a Starflower, DIR to visit the Gorak plane and kill
  Gorak, returned to Nuff for the recipe, brewed Magic essence, then used the
  four-code ring sequence and applied the potion to the Queen's bed. Completed
  the awakening and reward dialogues.
- **Result:** Quest completed at varbit 2326=90; varbit 2335=1 and the Magic XP
  lamp reward message were observed.
- **Not checked:** The first-entry Fairy Nuff room scene's camera choreography
  and the Queen's full three-chathead awakening are still not reproduced. The
  fight recovery used test setup commands after the account died and items went
  to its gravestone.
