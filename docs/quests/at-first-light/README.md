---
quest: At First Light
key: at_first_light
status: in-progress
tested: 2026-11-28
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# At First Light

Aligned with a whole run of the quest on live, the user's RSProx capture `AtFirstLight.bin`
(revision 243, SHA-256 `924537d4…6463aa7e`, `afl` 0 → 12), on top of the earlier rework against
rsprox.net 1695 (revision 226). Ticks below are the capture's. The test is
`server/tests/at-first-light-capture.test.cjs`; the dialogue changes are RSPSApp/osrsreboxed-db
(capture-sources for "At First Light").

## Capture facts

- **Progress:** varbit 9835 `afl` (varp 4151 bits 0-4) 0 → 12, each set as the line that moves it
  appears: 1 on Yes (181), 2 Verity's "If anyone did..." (267), 3 Wolf's "He's very easy to
  distract" (299), 4 Wolf's pyre fox line (416), 5 Fox's "Don't forget..." (580), 6 the poultice
  handed over (717), 7 Fox's "Well, it's your lucky day!" (746), 8 the sample to Atza (984), 9 the
  trimmed fur (1037), 10 Fox's report (1117), 11 the bed repaired (1251), 12 Apatura's last line
  continued (1320).
- **Sibling varbits on varp 4151:** `afl_mastermet` 9841 is set at the *first meeting* with Apatura,
  before the quest, as her "Well, I'm Apatura..." shows (123); `afl_mousetaken` 9843 with Wolf's
  mouse (303); `afl_catdistract` 9839 on the wound mouse used on Kiko (364); `afl_bedcheck` 9837 on
  the bed checked (371); `afl_sampletaken` 9842 (754); `afl_wolf_dialogue` 9995 (bit 14) as the
  player's first line to Wolf about Fox shows (860); `afl_housetrapped` 9840 1 on Atza's "It's all in
  that pile" (999) and 2 on "All done!" (1028); `afl_report` 9836 on the report handed to Verity
  (1217); `afl_bedrepair` 9838 with the repair (1251).
- **Apatura before the quest:** the first meeting is "Oh, you're a new face..." (120-123); once met,
  "Nilsal, hunter." / "Nilsal, Apatura." (140, 146, 170). After "What do you do here?" the menu comes
  back without it: "Can I help you with anything? / I'd better be off." (135). After the quest her
  plain menu "What do you do here? / I'd better be off." (1329); her page's rumour milestones (50,
  100, 150 Hunters' Rumours) are answered from the rumours completed.
- **Fox** is two world NPCs: `afl_hunter_fox_multi` (13400) at 1623,2982, facing south and still,
  shown as 12932 at stages 4-10 (cache transforms by `afl`), and `afl_hunter_fox_normal` (13422) by
  the Hunter Guild, shown as 13426 from stage 11 (seen at 1549,3045 at 1476). The head each line
  sends is 13400 / 13422; the client resolves them to the same models.
- **Fox's menu:** "I think I've got them both." with both leaves held gives "Yay, Fox will be
  pleased..." / "..." / "He's very mean... tie them up with the cute little jerb tail." (692-699; the
  jerboa tail was held too, one sample); without them the Wiki's answer (593-594).
- **Wolf after the poultice,** never having told her about Fox (`afl_wolf_dialogue` 0): the player's
  single line "I've found Fox... but he's doing okay. He's got me doing a few things for him whilst he
  recuperates." and Wolf's "Ha! Now that's the Fox I know..." (860-861). The Wiki's "How's the Fox
  situation?" is the talk after that.
- **Wording:** "Well, actually" (Verity, 259), "Well, then I guess" (player to Wolf, 296), "Well,
  it's your lucky day! Take this sample" (746), "Well, as much as I resent" (Kiko, 1253).
- **Kiko:** every Pet plays `human_pickupfloor` (827) on the player as his line shows (326, 343, 385,
  872, 1242). The bed (50878 at 1552,9460, the client's id) before the mouse: Kiko's "Do you mind?
  I'm trying to sleep here." (335); checked again at stage 7: a message box, not a game message (871).
- **Bushes** (50876 at 1618,2979, 50877 at 1673,2992; Pick only at stage 5): `picking_low_short`
  (10094) on arrival, `pick` (2581, delay 15) a tick later, the leaf in an item box two ticks after
  the animation (603-606). With a full inventory the leaf goes to the ground (Wiki).
- **The poultice** (tail on a leaf): `human_grind` (10097) and `grind` (2608, delay 25) with the item
  box (712).
- **Atza:** `tol_homonculus_crying` (3424) with her "Oh... Fox usually helps me with my chores"
  (992). The pile (52976 at 1697,3063) builds (`human_poh_build` 3676 and `poh_build_wood` 938, both
  delay 10) on the click and after each of the player's two lines; the chatbox closes and Atza
  answers two ticks after each build (1012-1028).
- **The bed repair** (jerboa tail on 50878): `afl_bedrepair` and `afl` 11, then the message box,
  `human_crafting` (10794), `stiching` (2591) and 10 Crafting XP on one tick (1251).
- **Journal:** nine views (186, 276, 317, 426, 600, 764, 1004, 1063, 1133), sent as live wrote each
  line (`journalAsSent`). A finished section is struck through in shorter words; at stage 9 the
  Atza section is replaced, not struck. Ours: stage 0, 6, the report/bed states after 10, and 11-12.
- **Completion:** "Congratulations, you've completed a quest", the quest complete jingle, the scroll
  with the trimmed fur, 1 quest point, 4,500 Hunter, 800 Construction and 500 Herblore XP (1320).
  The unlock (Master tier rumours, Wolf) is `skills/hunter/Rumours.Hunter.js`.
- **Hunter Guild stairs** (51641 down at 1556,3048 → 1558,9451; 51642 up at 1557,9448 →
  1558,3047) with their fade: `plugins/world/data/loc-teleports.json`.
- **Quest items' Destroy:** each item's Wiki `destroy` text (no capture destroys them).

## Findings

- **fixed** Apatura greeted every pre-quest talk as a first meeting and ended the talk after "What
  do you do here?"; `afl_mastermet` was only set at the quest start.
- **fixed** Fox was spawned per player as 12932 and the guild's Fox as the always-visible 13426;
  both are now live's multinpcs.
- **fixed** Fox's both-leaves answer, Wolf's first talk after the poultice and `afl_wolf_dialogue`
  were missing; four lines lacked live's comma.
- **fixed** Every chathead used one expression; the capture's expressions are in
  `plugins/quests/data/chathead-animations.json`.
- **fixed** Kiko's Pet animation, the pick, grind, build, stitching and crying sounds, the pile's
  two-tick builds, the stage-7 bed check box and the journal text.
- **fixed** A full inventory refused a leaf with an invented message; the Wiki drops it.
- **fixed** Post-quest Apatura played her 50-rumours note branch for everyone.
- **open** Latest peer review (before this rework) found three interruption/recovery defects
  needing source repair; re-checked in the 2026-11-28 sweep.

## Runs

### 2026-11-28 · agent · claude-opus-5-5

- **Source:** the rev 243 capture rework (feat/quest-at-first-light). Playthrough and sweep results
  are in the PR.

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q004); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** varbit 9835 = 12; QP +1, Hunter +4,774, Construction +800, Herblore +500, Crafting +10.
- **Checked:** relog, post-quest history (no duplicate), hammer pickup from south tile + relog.
- **Not checked:** Route used a noncanonical ::teleports recovery; Second post-quest history choice not selected; Not accepted as a full natural route.
- **PRs:** [#1094](https://github.com/RSPSApp/tsps/pull/1094).
