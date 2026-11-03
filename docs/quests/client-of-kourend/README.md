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
