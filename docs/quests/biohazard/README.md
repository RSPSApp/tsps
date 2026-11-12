---
quest: Biohazard
key: biohazard
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-242_2026-11-03
start:
travel:
---

# Biohazard

Native attempt stopped at stage 1 and logged out; no completion.

## Live capture (revision 242)

A complete run, start to finish, recorded with RSProx: `20261110T121228-5ab63b4` (revision 242.1,
world 360, SHA-256 `1c5b796f8939229ce34dbde7e604c35dee7ae412b0177a7c3733800dbd28f3df`). Ticks
below are that recording's. `Biohazard.Quest.js` follows it:

- **Boxes.** Every Wiki `{{tbox}}` line is a message box (229) or, with the Wiki's picture, an
  item box (193, or 11 for Elena's sample and broline); its `{{mes}}` lines are chat ("The pigeons
  don't want to leave.", the gas mask/gown/trapdoor refusals, the empty cupboard and crate).
- **Cupboards** (Jerico 2056/2057, Nurse Sarah 2062/2063). Open: "You open the cupboard.", then
  human_openchest (536) and cupboard_open (58) a tick later, the open loc the tick after (74-76,
  385-387). Close (op 2, "Close"): message, human_closechest (535) and the sound at once, the shut
  loc a tick later (88-89, 411-412); Jerico's sound is 58, Nurse Sarah's door_close (60). Jerico's
  Search: the bird feed box, then the feed arrives with "Mmm, bird feed!" (79-80); already held, "I
  don't need any more bird feed." (84-85).
- **Watchtower** (37328 → 35947 at stage 2, its only op "Investigate"): Investigate with the feed
  throws it, with the cage on the ground (178-181). Stage 2 → 3.
- **Pigeon cage** Open beside the watchtower (204-212): stage 3 → 4, 424 → 425, three
  biopigeon_launch (72) projectiles from the player's tile to 2560,3304 / 2561,3305 / 2559,3303
  (start 5/15/25, end 126/146/106, slope 20, progress 10, heights 64 → 500/480/520 in wire units),
  the box five ticks without a continue, then again with one. No mourner animation is sent.
- **Rope ladder** (Omart 248-264, Kilron 646-657): the throw box at T (no continue), the ladder
  (2065) replaces both Wall locs (2066, rotations 1 and 3 at 2558/2557,3267) at T+1, the player
  faces the near ladder tile at T+2, the climb box (no continue) and human_reachforladder (828) at
  T+3, the landing at T+4 (2556,3267 west, 2559,3267 east; Omart's first crossing moves stage
  4 → 5 here), the walls back with the drop box at T+6, when the helper turns north. Omart's first
  crossing continues with Kilron's welcome.
- **Gas mask** in West Ardougne: Remove and swapping in another helmet are refused with "You
  should leave your gas mask on while you're in West Ardougne." (270, 275).
- **Yard fence** (2068 at 2541,3331): "You squeeze through the fence.", regicide_tightfit (1237)
  and a 76-cycle exact move to the other tile (304, 331).
- **Cauldron** (37327 → 35945 at stage 5, op "Inspect"): with the rotten apple, the apple box and
  the player's line, stage 5 → 6 (318-324).
- **HQ front door** (2036 at 2551,3320) is the mourner behind it: after the stew "Back away
  citizen. Several mourners are ill..." (468); in the medical gown "A doctor?..." and the door
  opens after "Head on in" (480-483); later, in the gown, it just opens (593).
- **Sickest mourner** (9008): the key goes straight into the backpack with its item box (543).
  The upstairs gate with the key: "You use the key to open the gate." as it opens going in (557),
  nothing coming out (580); without it "The gate is locked. You need a key." (552).
- **Distillator crate** (2064): item box, stage 6 → 7 (574).
- **Elena**: before the crossing "Hello friend. Any luck finding my distillator?" (29); with the
  distillator she takes it as she hands out the sample and vials, stage 7 → 10 (723).
- **South-east Varrock**: the guard searches at the gate (2050/2051 at 3264,3405-3406) and the gate
  opens after "You may now pass." (944-959).
- **Guidor's door** (2032): without the priest gown Julie asks for a priest and
  biohazard_met_julie (9105) is set (1064-1071); in the gown it opens without a word (1077).
- **Completion** (1241): the cage key leaves the backpack.

Not captured, kept as the plugin's own ("Ours" in the source): Investigate without feed, the
squeeze before the crossing, the way out of south-east Varrock with a vial, Elena at stages 2-4,
West Ardougne's bounds for the gas mask, a full backpack at the first hand-out. Kilron's
"Do you know where to find the Mourner Headquarters?" option was not offered at stage 7 (631-648);
the Wiki lists it unconditionally, so it stays.

## Findings

- **fixed** Mourners inside the headquarters, outside while wearing the medical gown, and the sickest mourner upstairs (9008) used the wrong transcripts; the sickest mourner's attack actions start the fight. The back door (2036 at 2551, 3328) stays locked from both sides with its transcript, and the trapdoor (8783 at 2542, 3327) is refused only during Biohazard, so Mourning's End Part I keeps it. Ardougne castle's main staircase (15645/15648 at 2571, 3295) arrives on walkable landings both ways. [Quick guide](https://oldschool.runescape.wiki/w/Biohazard/Quick_guide). Fixed in #3796.
- **fixed** Issue #3251: the pigeon distraction, the rope ladder crossings and the fence squeeze, aligned with the capture above along with the rest of the quest's scenes.
- **open** A courier who disposed of the wrong vial could not get a replacement; repair in progress.
- **open** Premature Guidor advancement was returned to the owner.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q007); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** stage 1 (varp 68).
- **Not checked:** No reward/QP/XP proof; Later source fixes do not validate the old run.
- **PRs:** [#1098](https://github.com/RSPSApp/tsps/pull/1098).
