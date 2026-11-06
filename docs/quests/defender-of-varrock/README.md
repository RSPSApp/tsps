---
quest: Defender of Varrock
key: defender_of_varrock
status: in-progress
tested: 2026-11-05
tester: agent
model: DeepSeek V4.1 Flash
commit: 4f630dec1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Defender of Varrock

Capture/source audit of archive recording **1636** (revision 226.1). The recording has its own
start and completion messages, so the quest section is a real run. A full native route was not
replayed in this pass; the census book was wired to the captured interface and page counter and
unit-tested.

## Findings

- **fixed** The Varrock Census (object 50116) set `dov_read_census` and advanced the quest but
  never opened the book interface or published `dov_censuspage`. Capture 1636 opens interface
  **245** on the object click (tick 3625, line 54959), then its "Next page" button
  (component 9) walks `dov_censuspage` 1-5 at ticks 3628-3630, lines 55026-55077. The plugin now
  opens group 245, sends `dov_read_census`, and handles the next-page button; the page is
  persisted and restored on login.
- Covered by `server/tests/remaining-varrock-keldagrim-parity.test.cjs`.

## Runs

### 2026-11-05 — capture/source audit

- **Capture:** [RSProx 1636](https://rsprox.net/download/1636), revision 226.1. The census object
  click is `OpLocV1(id=50116, x=3918, z=4969, op=1)` at tick 3623, line 54939; the book opens at
  line 54959 and the five page clicks are `If3Button(interfaceId=245, componentId=9, op=1)` at
  ticks 3627-3630.
- **Wire:** varbit 9655 `dov` in varp 4093 bits 0-8: `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24,
  26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56`. The six hunting-trail bits
  (9659-9664) set during the trail and clear at stage 18. `dov_read_census` (9668) is 1 from the
  book opening; `dov_censuspage` (9667) is 1-5.
- **Not checked:** a full native playthrough, the palace library scrolls, the candidate
  conversations, the forge dream and invasion vision, the final cutscene, rewards and relog.
