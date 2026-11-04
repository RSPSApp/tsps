---
quest: Fairytale II - Cure a Queen
key: fairytale_ii_cure_a_queen
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Fairytale II - Cure a Queen

No native playthrough recorded; natural completion pending.

## Findings

### Certificate and Rune temple sign documents

RSProx recording [424](https://rsprox.net/download/424), revision 232, records
certificate Read opening native group 423 (tick 16448), Study opening 424 (16453),
and the Rune temple sign opening 425 (18355). Script 2524 precedes each mount:
Read/sign use `[-1, -1]`; Study uses `[4269835, 100]` and the recorded turn-over
message. Repeated Read/Study at 16589/16659 confirms the same mapping.

Active cache 241 retains those groups, their document models 16050/16051/16067,
and the certificate/sign's fairy fonts 647/648. The plugin opens these cache
documents without replacing their text. Native inventory, map-object and
IF_CLOSE regressions cover opening, replacement, closing/reopening, retained
certificate, study/sign flags and completed-account access. The client cache-VM
check decodes the server script/mount packets and verifies models, text/fonts
and modal arguments; it is not a GPU render or live playthrough.

The recording starts on an already-completed account. Study's existing immediate
stage 30/study-flag commit and the existing sign prerequisites are preserved;
this evidence does not establish their fresh-account packet timing. The Wiki's
[Surprise! section](https://oldschool.runescape.wiki/w/Fairytale_II_-_Cure_a_Queen#Surprise!)
independently describes Study revealing the back and reading the sign.

The first-entry room scene remains unimplemented in [#2162](https://github.com/RSPSApp/tsps/issues/2162).
Its existing 2339 marker is unchanged: no active-cache reader establishes a
camera track, and recording 424 does not show the first-entry scene.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q037); PRs: [#1120](https://github.com/RSPSApp/tsps/pull/1120).
