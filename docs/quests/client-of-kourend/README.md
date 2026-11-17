---
quest: Client of Kourend
key: client_of_kourend
status: passed
tested: 2026-10-23
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Client of Kourend

All five houses, the Munty door, orb collection and Dark Altar were played naturally and Veos completed the quest. Rewards were paid once and held through relog.

## Findings

- **fixed** The Munty door needed a cache-pair fix before the natural route could pass it.
- **open** Destroyed unused-lamp recovery remains under investigation.

## Revision 242 capture parity (#5157)

From the user's whole-quest rsprox captures: local 1001998 and 1002104 (revision 242.1) and
1001445 (revision 241, with X Marks the Spot before it). Ticks are 1001998's unless noted.

- **veos_progress (varbit 5619):** 1 at the start (348), 2 with the fifth owner's notes (1320), 3
  with "Well, I don't necessarily believe I have much of a choice!" (1498), 4 and the orb with "My
  client requires... another simple task." (1509), 5 at the shatter (1795), 6 with Veos's "ARGH!"
  (2093), 7 at completion (2127; the quest dbrow's `endstate`), 8 and 9 as each antique lamp is
  used (2140, 2150). The saved stages stay 1-5; 3 is the saved `client-of-kourend:task-offered`
  on stage 2 and the lamps are `client-of-kourend:lamps-used`.
- **Boxes** (the Wiki's `pic`/`pic2` agree): the scroll handed over in an objectbox with the
  scroll (348); the quill, every city's notes, the quill burning and "Veos removes the items..."
  in objectbox_double with scroll and quill (401, 477, 1304, 1468); the fifth city's whisper in a
  messagebox and also in chat with `<br>'Return to Veos...'` (1320); the orb refusal in an
  objectbox with the orb (1001445 tick 5054).
- **Store owners:** after the city's first answer the city's two-question menu shows again
  (Leenz 451-468, Horace 632-646, Jennifer 850-865, Munty 1058-1071, Regath 1259-1289), so the
  page's `{{tact|previous}}` there plays as `{{tact|other}}` (osrsreboxed-db capture source).
- **Quill burning (1304):** the player's animation 4341 (urn_search_bit) and overhead "ARGH!" come
  with the box.
- **Orb (1793-1795):** Activate plays 2721 (wanted_crystal_ball_scan), spotanim 454 at height 92 and
  sound 1900; two ticks later the orb shatters into broken glass 1469 in an objectbox, with the
  player's overhead "Argh!", sound 2127 and the whisper in chat (1002104: 3991/3993). The whisper's
  box follows with the quote in `<col=000080>` (1001445 tick 5269).
- **Possession (2093-2121):** Veos's "ARGH!" plays 4341 on Veos for this player only
  (npc_anim_specific); the next line plays spotanim 560 and 3170 on him. "Veos' Client" speaks
  with veos_controlled's head (2850) in `<col=000080>`, re-opened on each wrapped line.
- **Rewards (2127):** the scroll lists "1 Quest Point", "2 Antique Lamps", "Kourend Castle
  Teleport", "Kharedst's Memoirs" with the quill as its model. A lamp ends in a messagebox
  "<col=0000ff>Your wish has been granted!</col><br>You have been awarded 500 Slayer experience!".
- **Journal:** live's text for every state, from 1001445 (ticks 3798-5478).
- **Port Sarim Veos (12148):** 1/3 before a trip to Kourend, 2/4 after (veos_visible_travel*,
  with the Port Piscarilius and Land's End options). 1001445 logs in visited with 4 and has 2 after
  X Marks the Spot; 1001998 and 1002104 log in with 2.

Recorded differences kept as the Wiki has them: Veos's first menu reads "Could you give me some
advice on Kourend?" (live "Could you tell me more about Kourend?"), his answer "I do..." (live
"I do."), Munty's "What is there to do in Lovakenj?" (live "Lovakengj"), and live's fifth Veos
option "Nothing, thanks." is not on the page.

## Veos travel regression (#2095)

The quest's shared travel option was empty because the NPC transcript has different Port Sarim and Piscarilius versions with the same label. The source exporter now uses validated page/variant/option anchors to the original Piscarilius conversation, and resolves its differently labelled Land's End and Stay references against the original Sarim replies. No dialogue text is authored in TSPS or copied into a source override. Only the Veos and Client of Kourend records change in the regenerated import.

Source fix: [osrsreboxed-db PR #36](https://github.com/RSPSApp/osrsreboxed-db/pull/36), stacked on #35 and #34, whose output is already imported. Two offline exports match across all 3,378 generated/audit files. The imported aggregate SHA256 is `0003e24294d701da272569a4edfb2f4ba599fc42fed94f5ede173073062a894e`; the dialogue index is unchanged.

Ordinary quest travel hands the chosen route to Ferries' existing voyage and marks Kourend visited only after an accepted handoff. Ferries owns Veos's membership refusal even with Quests disabled. Offline native tests cover both ports at every durable stage 0–5, Land's End, Stay, the free-world refusal, no fare, preserved quest progress and a rejected handoff. Cache variants 8630/10724 offer Talk-to, Port Piscarilius and Land's End; the Port Sarim return is tested through Talk-to's menu, without inventing a direct cache action. These checks start no gameplay server; no new live playthrough was performed.

## Runs

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q010); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: linked fresh stage-0 route continued across a server restart.
- **Result:** durable stage 5; varbit 5619 = 9, varp 1566 = 4041; QP 1->2, memoirs x1, two lamps; orb consumed.
- **Checked:** repeat (Veos lost-reward option), relog, logout/offline.
- **Not checked:** Destroyed unused-lamp recovery, other recovery and overlay unchecked; A hung driver was replaced reusing the same actor (no reset).
- **PRs:** [#1101](https://github.com/RSPSApp/tsps/pull/1101).
