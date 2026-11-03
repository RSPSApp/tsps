---
quest: X Marks the Spot
key: x_marks_the_spot
status: passed
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: ee56b90ad (working tree)
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# X Marks the Spot

Fresh stage-0 run along the captured F2P route to completion, including every clue dig,
the orb reading, the casket hand-in and the reward flags. One login bug was found and fixed.

## Findings

- **fixed** Login re-sent varbit 8063 and cleared the sibling reward bit 8065; a completed
  account logged in with the coin reward unset. Login now restores 8065 with 8066 and 8258.
  Regression: `X Marks login restores the captured coin, lamp and clue-box reward flags`.
- **verified** The earlier report that Veos could not take the player to Kourend after
  completion did not reproduce: post-quest Veos offers `Can you take me somewhere?` and took
  the player to Port Piscarilius, setting `zeah_playerhasvisited` (4897) to 1.
  [#1257](https://github.com/RSPSApp/tsps/issues/1257)

## Runs

### 2026-11-03 · agent · DeepSeek V4.1 Flash

- **Source:** working tree on `ee56b90ad`; the only quest change in the run is the login
  reward-flag restore above. Capture route: issue #600 F2P archive
  `20260815T221841-59bcb26.bin` (rev 240, 15 August 2026), as summarised in
  [f2p-coastal-parity.md](../../f2p-coastal-parity.md#x-marks-the-spot).
- **Start:** fresh account, stage 0, placed in The Sheared Ram with `::tele` before the first
  interaction. Ordinary supplies: one spade (`item 952 1`).
- **Route:** Veos start menu (native Yes/No) → `cluequest` 1 on accepting, 2 on the scroll
  line → read scroll 203, dig 3230,3210 → scroll 23068 → read map 267, dig 3203,3212 → orb
  23069, `Feel` at that tile returned cold 95 with 8064=95 → dig 3108,3264 → scroll 23070 →
  dig 3077,3260 → casket 23071 and its whisper → `travel_to` Port Sarim, hand the casket to
  Veos (8063=7) → completion (8063=8).
- **Result:** Quest points 1→2; 200 coins, antique lamp 23072 and beginner scroll box 24361;
  flags 8065=1, 8066=0, 8258=1; Lumbridge visibility 12151=0 and Port Sarim 12148=1;
  Veos id changed 8484→10723. Relog preserved stage 8, the three reward items and
  8065/8258 (after the fix). Post-quest Veos travel worked.
- **Not checked:** Live close of the completion scroll (the MCP `close_interface` does not
  reproduce the client's scroll-close event; the existing scroll-close regression covers the
  follow-up dialogue). Orb bands other than cold 95 and full-bag clue-box pending were not
  re-run live. Free-to-play-world travel refusal, lamp XP and alternate hint branches were
  not checked.
