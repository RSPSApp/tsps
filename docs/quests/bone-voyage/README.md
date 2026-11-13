---
quest: Bone Voyage
key: bone_voyage
status: passed
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Bone Voyage

Dialogue/scene handoffs, canal barge, sailing instance, voyage and Junior Navigator completion played naturally. Museum Kudos were earned in the run, not supplied.

## Live behaviour (rsprox captures)

From the user's revision 242 capture `BoneVoyage-CursedVoyage` (the end of the quest, logged in at
wire 35 with the charm and potion given; ticks are the recording's):

- **Wire stages:** 5795 is 35 at login and through an aborted voyage, 50 three ticks after the
  barge reaches Fossil Island (tick 708). Quest Helper keys 30 and 35 on the same "go sail" step;
  ours writes 30 once both protections are given and 35 from the first set-off.
- **Crew:** the canal guard (7767 -> 8013/8012), the deck guard (7768), the navigators
  (7819 -> 7761/7762, 7820 -> 7763/7764), John (7821) and David (7822) are static multinpcs on
  varbit 5795; the island deck has the navigators at 3723,3784,1 / 3723,3785,1.
- **Boarding** (Talk-to, tick 116; Embark, tick 160): fade_overlay out, two ticks later "The
  barge guard helps you board the ship." and the move to 3362,3452,1, fade in a tick later,
  overlay closed at +5. **Getting off** (tick 151 / 166) is the same with "The barge guard helps
  you off the ship." to 3362,3445,0. The deck guard plays "Can I get off the barge?" mid-quest.
- **Set-off** ("I'm ready, let's go.", tick 311): a short fade (script 948, 15 cycles), the
  barge instance three ticks later at 1819,4761,1 with the Junior Navigator at 1820,4762,1, two
  message boxes ("Each member of the crew..." / "It doesn't take long..."), the fade in on the
  second's continue, then the Junior Navigator's briefing. On its last continue (tick 346)
  fossilquest_sailing (604) opens in the side modal, 603 on the HUD, script 1993 and the minimap off.
- **Controls:** script 1993 takes the bearing target (33189 + 391 x steps; 33189 is north), the
  sails (0-2, starting at 1) and the rudder graphic (0 straight, 1 left, 2 right). Right from
  straight is 2, right from left is straight; left mirrors it. Varbit 5799 is the client's own
  needle step (script 1995), not the server's. Closing the controls (talking, Abort) sets
  current_hint_arrow 7 and a hint arrow over 1818,4761,1 (height 75); operating them clears it.
- **Progress:** every 4 ticks from the set-off the bar gains 10 when the bearing is within 6
  steps of north and loses 5 outside; the step follows the sails set at the update before, full
  sails each update, lowered sails one step in three (ticks 474-698). The wind's own rule, the
  rudder's strength and when the voyage is lost are not in the capture (ours).
- **Talking to the Junior Navigator at sea** (ticks 348, 360) closes the controls and replays the
  four briefing lines, with no "Hello.".
- **Abort** (tick 414): the controls close first, "Abort the voyage?" Yes./Cancel.; Yes closes the
  overlay and fades, three ticks later "With the aid of the junior navigator, you sail back to the
  digsite..." on the canal deck 3360,3453,1 with script 1996 and the minimap on. The Lead Navigator
  then plays "My head... What happened?" and the Junior "You should talk to the lead navigator
  when you're ready to set sail."
- **Arrival** (bar full at tick 698): four ticks on the controls close and the fade starts, at +7
  the island deck 3723,3784,1 with script 1996, at +10 the quest completes. The scroll shows the
  bone charm, "1 Quest Point" and "Access to Fossil Island"; after it closes the Junior Navigator
  says the transcript's three closing lines; the note book arrives as the second is continued
  (tick 722, before "Here, take this journal..." at 723). The fade overlay stays until then (719).
- **Post-quest travel:** the island Lead Navigator's "Travel to the Digsite?" and the canal one's
  "Travel to Fossil Island?" fade, move two ticks on (3360,3453,1 / 3723,3784,1) and fade in at +8
  (ticks 784, 829). The island Junior Navigator's "Expedition camp." is the barge guard's row to
  the camp ("You row to the expedition camp...", 3724,3808,0, tick 738).

## Findings

- The transcript (osrsreboxed-db) has "unconcious" where live says "unconscious" (tick 326), and
  David's line mid-quest is "Hi, afraid I've got no time for talking right now. The lead
  navigator might be able to help you out." (tick 126), not the transcript's.
- The camp rowboat offers "Row to the barge." live (tick 748); ours lists the north of the island
  instead (FossilIslandUnderwater.plugin.js).

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q008); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** varbit 5795 = 50 (durable stage 11); QP +1, Fossil Island notebook +1; no skill XP.
- **Checked:** repeat attempt (no duplicate), relog, save history, post-quest Curator dialogue and barge to Fossil Island.
- **Not checked:** Lost-item reclaims, full-bag, interrupted voyage/conversation and overlay unchecked; Ordinary prerequisites declared as setup; Later plugin edits and uncovered recovery need rechecks.
- **PRs:** [#1099](https://github.com/RSPSApp/tsps/pull/1099).
