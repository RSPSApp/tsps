---
quest: A Night at the Theatre
key: a_night_at_the_theatre
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: e21c6b5f1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# A Night at the Theatre

Capture/source audit of archive recordings **101** (revision 227, Leagues V) and **1695**
(revision 226.1). Both contain the quest's own start and completion messages, so each is a real
run rather than a completed login. A full native route was not replayed in this pass:
Theatre of Blood, the Hespori fight and the crypt were not played. One login/reward-flag fix
was made and unit-tested.

## Findings

- **fixed** The quest published `tobquest_given_acid` (12974) from its login hook only, and
  never published or restored `tobquest_done_tob` (12972). Capture 101 sets 12972 on the
  Theatre completion at tick 27338 and 12974 when Daer Krand hands over the acid at tick
  24272; capture 1695 already carries 12972 on login because that account had cleared
  Theatre before. Both bits are now published on `player:bootstrap-complete` (after the login
  bootstrap can clobber shared varps) and 12972 is also sent as soon as `tob:completed`
  arrives.
- **accepted difference** The plugin keeps a durable start stage of 10 and sends it as native
  10. The capture accepts the quest at native **2** and walks 2, 4, 6, 8 during the first
  conversation before holding 10. Stages 2-8 are transient dialogue steps; the plugin's
  post-conversation wire value 10 is the same value the capture holds once the conversation
  ends. No change made.
- **accepted difference** The plugin's durable mid-conversation stages 31, 33, 35 and 41 are
  values the native grid never holds; `varbitValue` rounds them up to 32, 34, 36 and 42. The
  capture only contains even values in 2-86.
- **not modelled** Capture 101 also sets `tobquest_used_notice_board` (6573, bit 26) and
  `tobquest_stranger_op` (12973, bit 16) on the Theatre entry, and `tobquest_bonus_lamps`
  (14610, bits 19-20) after the lamps. They are UI/session flags with no gameplay effect in
  this server and are left alone; this is an unchecked visual difference, not a claimed match.
- Covered by `server/tests/qh728-q083.test.cjs` (new bootstrap/raid-completion case).

## Runs

### 2026-11-03 — capture/source audit

- **Capture:** [RSProx 101](https://rsprox.net/download/101), revision 227, Leagues V,
  `rsprox-101.bin` size 9,262,945, SHA-256
  `4C6BA8BDEF146CFE63A2CDF645A1F31BED50B69F510EBC65803A2C599A40413D`.
  Start message line 555715 (tick 22616); completion message line 664696 (tick 27498);
  reward scroll lines 664717-664728. Relied on ticks 22616-27541.
- **Capture:** [RSProx 1695](https://rsprox.net/download/1695), revision 226.1,
  `rsprox-1695.bin` size 2,503,774, SHA-256
  `12A97E68C11480256C828A63B780A04CCDD676066D11F901046D8DD1192DFA80`.
  Start message line 165310 (tick 9616); completion line 191726 (tick 11112). Relied on ticks
  9385-11142.
- **Wire:** varbit 12276 `tobquest` in varp 3055 bits 8-14; cache DB row 104 completes at
  **86**. Captured stage sequence (both runs): `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, ...,
  84, 86`, i.e. the native even grid. 1695 holds 12972 from login; 101 sets it at 27338.
- **Rewards:** 2 Quest Points and 4 Antique Lamps (scroll `2 Quest Points`, `4 Antique
  Lamps`). Capture 101 used three lamps (`lamps` bits 6-7 = 3) and set the bonus-lamp bit;
  1695 shows the same lamp and bonus-lamp state.
- **Not checked:** a full native playthrough (crypt, Vyrewatch key, Ranis' head, spider cave,
  Daer Krand, Hespori, Theatre of Blood), lamp rub/reclaim on a live account, relog after the
  fix, full-bag behaviour, post-quest Stranger dialogue and crystal shop, visual/cutscene and
  jingle parity, Quest Helper overlay.
