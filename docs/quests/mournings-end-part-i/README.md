---
quest: Mourning's End Part I
key: mournings_end_part_i
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Mourning's End Part I

Deferred on 2026-10-23 as long/complex; no native playthrough recorded.

## Findings

- **fixed (handler and test level, not played in game)** Oronwen takes the silk and bear fur item by item. Using
  silk or bear fur on her while the ripped trousers wait now keeps the item and starts the Wiki transcript's
  "Using necessary items on Oronwen" variant (the test records the start; the lines are not played) so she says what she still needs; the last item brings the
  mourner trousers back. The transcript gives the silk box and the four "still needs" lines; the bear fur's own
  message, the refusal of a third silk or second fur, and the trousers returning at the last item are our wording
  and rules (inference). No rsprox capture was found (text searches for "bear fur", "I need two pieces of silk"
  and "Oronwen" returned nothing on 2026-11-11). Her Talk-to menu's own lines still say "I need bear fur and two pieces of
  silk" whatever was handed over, but its "I have all I need" hand-over credits what she already holds and
  takes only what she still wants. Test: `server/tests/qh728-q078.test.cjs` (handler-level, the transcript start
  is recorded, not played).

## Aim and Fire

Not scripted, as no capture shows how it aims. Loading the fixed device also says it can be used directly on a sheep of that colour. That line is our wording, not live's, and goes when Aim and Fire is done.

The fixed device's ammo follows the Wiki's Fixed device page, with these lines of our own wording, none seen in a capture:

- The loaded colour is saved with the player and sent as varbit 804 at login. Varbit 804 is 1 for any colour, as the colour-to-value map is unknown.
- Only one toad is held ("Only one toad may be placed in the device at a time"). A second is refused and kept: "The device already holds a toad."
- A toad whose sheep is already dyed is refused and kept, as it could never be fired and would block the other colours: "That colour of sheep is already dyed, so the device won't take that toad."
- "The device can only be wielded when filled with ammo." An empty device is refused: "The device can only be wielded when it holds a toad." This applies only at the fixed-device stage (7), where our plugin can load it; at stage 8 and later it isn't enforced.
- The Empty option isn't scripted, so a loaded toad can't be taken out.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) deferred (q078); PRs: [#1145](https://github.com/RSPSApp/tsps/pull/1145).
