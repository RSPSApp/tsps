---
quest: Learning the Ropes
key: learning_the_ropes
status: passed-with-issues
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Learning the Ropes

Fresh tutorial account reached completion naturally and kept it after relog. Supplemental and not accepted as a full route.

## Findings

None recorded.

## Runs

### 2026-11-02 · agent · capture audit

- **Source:** rsprox database recording 826 (rev 234) and the OSRS Wiki.
- **Result:** the completed journal now matches the captured 39-line Tutorial Island narrative; the quest was renamed Learning the Ropes on 11 February 2026. Completion at tutorial step 671 and the stage following varp 281 to 1000 were already correct.
- **Checked:** `node tests/qh728-q129.test.cjs` (7 pass, including the new journal case).
- **Not checked:** no in-progress journal capture and no live replay.

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) supplemental (q129); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** varp 281 = 1000; QP +1.
- **Checked:** relog (completion and 25-coin bank balance kept).
- **Not checked:** Lumbridge destination and optional repeat dialogue unverified; Pinned Quest Helper has no route for it; Overlay unchecked.
- **PRs:** [#1137](https://github.com/RSPSApp/tsps/pull/1137).
