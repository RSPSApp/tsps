---
quest: Pirate's Treasure
key: pirates_treasure
status: passed
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Pirate's Treasure

Community-reported completion accepted for scheduling (skip full manual replay). No issue reported.

## Findings

None recorded.

## Runs

### 2026-11-02 · agent · capture audit

- **Source:** rsprox database recordings 4287 (rev 239) and 465 (rev 233), plus the OSRS Wiki.
- **Result:** the captured crate wording was applied: packing a banana is a message box with animation 832 and sound 2739; filling the crate to ten says "You fill the crate with bananas."; an empty crate says "The crate is completely empty."; Luthas pays with "Luthas hands you 30 coins."; and crate actions before asking for employment give "Why would I want to do that?". The apron and stock-room door behaviour already matched. The customs officer's `[Charm]` free-passage option now needs a Ring of Charos(a) worn.
- **Checked:** `node tests/f2p-coastal-parity.test.cjs` (26 pass, including the new crate/payment and Charm cases).
- **Not checked:** no live client replay; the rum stash/search messages and Wydin's stock-room crate have no capture.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
