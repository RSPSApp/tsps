---
quest: Current Affairs
key: current_affairs
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: eaeda7f9f
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Current Affairs

Capture/source audit of archive recording **3467** (revision 235.1, main world). The recording
has its own start and completion messages. A full native route was not replayed in this pass; the
completed-form mirror was fixed so a relog no longer loses the answers/correctness bits.

## Findings

- **fixed** The passing audit cleared `current-affairs:form-answers` and sent q1-q8 (18290-18297)
  as unanswered. Capture 3467 keeps the completed answers (`4957` = **16751989**, q bits
  `40309`) after completion, and Quest Helper requires q1-q8 > 0. The answers are now kept and
  re-sent on login.
- **fixed** Login never restored the eight audit-correctness bits (18298-18305); the capture
  leaves all eight at **1** after the passing audit. They are now sent from stage 30 onward.
- **fixed** `current_affairs_form_dialogue` (18284) and `current_affairs_harry_chat` (18286) were
  never mirrored. Login now sends 18284 from the form-given stage and 18286 from the signed-form
  hand-in stage, matching the capture.
- Covered by `server/tests/remaining-sailing-errands-parity.test.cjs`.

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 3467](https://rsprox.net/download/3467), revision 235.1, world 367,
  `rsprox-3467.bin` size 7,565,186, SHA-256
  `340E12B0101BA58F2E0B6FC48ECABA637A70551295834202771D50ACDD736FC3`.
  Start `RunClientScript` at tick 4014, line 147336; stage first set at tick 4029, line 147629.
  Completion message at tick 5245, line 172315. Relied on lines ~147330-172320.
- **Wire:** varbit 18282 `current_affairs` in varp 4956 bits 0-6; answers/correctness in varp
  4957. Captured stages: `5, 10, 15, 20, 25, 30, 35, 40, 45`.
- **Auxiliary bits at completion (capture):** form dialogue `1`, form given `1`, kit purchased
  `1`, audit start `1`, form 2 given `1`; q1-q8 `1,1,3,1,1,3,1,2`; correctness c1-c8 all `1`.
  A completion fixture relogged with varp 4957 = **16711680** (all eight correctness bits) and
  18284/18285/18288/18289 set; q1-q8 stayed 0 because the command path did not run the form and
  audit. With the captured answers `40309`, the same login path now reproduces the recorded
  `16751989`.
- **Rewards observed by the fixture:** 1 quest point, 1,400 Sailing XP, 1,000 Fishing XP and 25
  oak sawmill coupons, no duplicate on repeat completion. The duck/current charting route was not
  replayed.
- **Not checked:** a full native playthrough, the form questions, the audit, Catherby current
  charting, duck loss/reclaim, visuals and audio/jingle parity.
- **Quest Helper:** bridge unavailable; pinned source
  `06da90f982518a093f2fe1c9cfac5547fa7053d3` requires `CURRENT_AFFAIRS_FORM_Q1..Q8 > 0`, which is
  why retaining the answers matters.
