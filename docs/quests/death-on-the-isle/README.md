---
quest: Death on the Isle
key: death_on_the_isle
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: eaeda7f9f
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# Death on the Isle

Capture/source audit of archive recording **1695** (revision 226.1, main world). The recording has
its own start and completion messages. A full native route was not replayed in this pass; the
finale fight varbit was added to the login mirror and unit-tested.

## Findings

- **fixed** `doti_final_fight` (varbit 11258) was set during the staged finale but never restored
  on login. Capture 1695 leaves it at **6** after completion, and Quest Helper keys
  `naiatliDowned` on `DOTI_FINAL_FIGHT >= 6`. `syncVarbits` now re-sends the persisted
  `death-on-the-isle:final-fight` value.
- Covered by `server/tests/p2p-varlamore-group-2-parity.test.cjs`.

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 1695](https://rsprox.net/download/1695), revision 226.1, world 367,
  `rsprox-1695.bin` size 2,503,774, SHA-256
  `12A97E68C11480256C828A63B780A04CCDD676066D11F901046D8DD1192DFA80`.
  Start `RunClientScript` at tick 5882, line 95871; stage first set at tick 5884, line 95896.
  Completion message at tick 7030, line 124690. Relied on lines ~95870-124730.
- **Wire:** varbit 11210 `doti` in varp 4401 bits 0-6. Captured stages:
  `2, 4, 6, 8, 10, 12, 14, 15, 16, 18, 19, 20, 21, 22, 24, 26, 27, 28, 30, 32, 33, 34, 36, 38,
  40, 42, 45, 49, 50`.
- **Auxiliary bits at completion (capture):** met/pickpocket/investigated/questioned/clue flags
  all `1`, `adala_fight_outcome=1`, mask assignment `1`, final fight **6**, backstage clues and
  chats `1`, final-accusation intro `1`, accusations `0`.
- **Rewards observed by the fixture:** 2 quest points, 10,000 Thieving, 7,500 Agility and 5,000
  Crafting XP, no duplicate on repeat completion. The fixture's final-fight bit stayed 0 because
  the command path did not play the staged finale; the unit test covers the natural attribute=6
  login.
- **Not checked:** a full native playthrough, the villa/theatre scenes, Adala's real fight, the
  backstage clue chain, the staged finale, held-gear return, visuals and audio/jingle parity.
  The earlier live 0→50 run recorded in `docs/p2p-varlamore-group-2-parity.md` is not revalidated
  here.
- **Quest Helper:** bridge unavailable; pinned source
  `06da90f982518a093f2fe1c9cfac5547fa7053d3` uses `DOTI_FINAL_FIGHT >= 6` for the downed state.
