---
quest: King's Ransom
key: kings_ransom
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# King's Ransom

No native playthrough recorded; natural completion pending.

## Findings

- **fixed (source and test level, not played in game)** The grail riddle's box selection. The table
  used to play the riddle lines and a "Box 1..9" chatbox prompt; it now opens the cache's interface 390
  (`kr_jewellery_boxes`). CS2 171 draws "Show riddle" / "Hide riddle" and the riddle text; components 9-17
  are the nine boxes (their x positions rise from 23 to 433, so component 8 + n is the nth from the left);
  only the eighth (component 16) has a click script (CS2 67), which is the Wiki's "second last box counting
  from left to right". A wrong box still plays the trap line and teleports to the cave north of Ardougne
  Monastery. Test: `server/tests/kings-ransom-grail-boxes.test.cjs`. No rsprox capture of the interface
  was found (searches for the interface's text returned nothing on 2026-11-11), so that the server runs
  script 171 when Show riddle is clicked, and which side the client starts on, are inference.
- **open** The lock-picking interface 588 is still not driven: the cell door plays the success message
  directly. Its feedback widgets have no cache script and no capture was found.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q064); PRs: [#1136](https://github.com/RSPSApp/tsps/pull/1136).
