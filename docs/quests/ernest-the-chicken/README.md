---
quest: Ernest the Chicken
key: ernest_the_chicken
status: passed-with-issues
tested: 2026-11-02
tester: agent
model: DeepSeek V4.1 Flash
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel: travel_to
---

# Ernest the Chicken

Community completion stands. The rsprox database has no full route capture; 3209 covers the
post-quest Professor Oddenstein conversation and the basement lever puzzle, and both were
checked against it.

## Findings

- **fixed** Added Professor Oddenstein's captured post-quest chat-head animations from 3209.
- **open** The 14 January 2026 quest-journal rewrite has no capture in the archive, so the
  journal text is still the pre-rewrite wording. Needs a post-update journal capture.

## Runs

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Start:** checkpoint account with the quest completed through `::quest`, placed at
  Oddenstein with `::tele`; the quest route itself was not replayed because no database
  capture covers it.
- **Route:** Professor Oddenstein's post-quest menu and both branches; the 3209 lever and
  door varbits are covered by the existing `f2p-adventure-parity` checks.
- **Result:** the post-quest menu offered "What does the portal machine do?" and "Is this
  your house?"; the three captured replies and their chat-head animations (570, 567, 589)
  matched 3209. The lever/door bitset test still passes every recorded state.
- **Not checked:** the full quest route, the 2026 journal text, alternate full-inventory
  branches and the skeleton fight. The archive has no route capture for this quest.

### 2026-10-25 — community (thehardcorenoobs1234) — model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
