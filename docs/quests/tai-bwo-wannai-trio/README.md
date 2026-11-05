---
quest: Tai Bwo Wannai Trio
key: tai_bwo_wannai_trio
status: in-progress
tested: 2026-11-05
tester: agent
model: DeepSeek V4.1 Flash
commit: 4f630dec1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Tai Bwo Wannai Trio

Capture/source audit of archive recording **75** (revision 227, Leagues V). The recording has the
quest's own start and completion messages. A full native route was not replayed; the stage wire
and the capture's absence of auxiliary varbits were checked, with no change needed.

## Findings

- **not a bug** The durable stage is the raw varp 320, and capture 75 walks `1 -> 2 -> 3 -> 4 -> 5
  -> 6` exactly as the plugin does (start dialogue 1/2, accepted 3, brothers 4, reward 5,
  complete 6). No sibling varbit on varp 320 changes in the capture.
- **not checked** A full playthrough, the three brother tasks, the karambwan vessel, the Tiadeche
  keys, the fight and the reward pacing.

## Runs

### 2026-11-05 — capture/source audit

- **Capture:** [RSProx 75](https://rsprox.net/download/75), revision 227, Leagues V.
- **Wire:** varp 320: `1` at tick 3073, `2` at 3101, `3` at 3103, `4` at 5007, `5` at 5053 and
  `6` at 5054 (lines 54240-90175).
- **Not checked:** dialogue variants and the Jungle Potion prerequisite were not re-run.
