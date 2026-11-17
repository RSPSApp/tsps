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
- **fixed (issue #6003)** The Camelot castle grounds gate (`kr_camelot_metalgateclosedl/r` 26081/26082
  at 2757-2758,3482) is a pass-through gate, from capture242/911979 ticks
  16536-16541, 17415-17419 and 17539-17543. Open puts inviswall
  38848 (rotation 1) on both gate tiles and the nameless open leaves on the tiles north (26083 rotation 0 at
  2757,3483, 26084 rotation 2 at 2758,3483) with sound 69 (`grate_open`), the player steps across that
  tick, and the closed leaves are back two ticks later, from either side. It used to open like a plain
  double gate and stay open on those nameless leaves, which a client shows no menu for ("Close null" with
  debug ids on). Morgan's hold still sends a held player back to the cell first (`door:toggle`). Test:
  `server/tests/camelot-gate.test.cjs`.
  The timing follow-up opts only Camelot Open into a generic pre-movement object-operation phase:
  after reaching the gate, its opening and one ordinary walking step now share the next world cycle,
  without reprocessing movement or adding a delayed opening. The route remains subject to actual
  busy/death/placement state, teleport identity, target and private-area validity. Item/spell routes,
  explicit destination/approach overrides and other gates retain their existing timing. Queued native
  input through real World turns verifies both directions, restoration, energy, cancellation and
  temporary clipping ownership; this does not claim that other pass-through gates match every capture.
- **open** The lock-picking interface 588 is still not driven: the cell door plays the success message
  directly. Its feedback widgets have no cache script and no capture was found.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q064); PRs: [#1136](https://github.com/RSPSApp/tsps/pull/1136).
