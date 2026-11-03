---
quest: Scrambled!
key: scrambled
status: untested
tested:
tester:
model:
commit: 48e008a41
cache: osrs-241_2026-10-20
start:
travel:
---

# Scrambled!

Capture and source audit only; no native playthrough was recorded for this batch. Two complete
captures agree on all seventeen stage values, the start NPC, the reward scroll and the egg
jigsaw.

## Findings

Newest first.

- **fixed** Completion played the default jingle 238 and drew the real pet egg 30970 instead of
  the scroll's display item. Capture 3072 plays jingle 154 and draws `SCRAMBLED_EGG_DUMMY`
  30972; both are now set on the quest. The pet egg itself is still 30970. The scroll's egg line
  now reads "Your very own egg", as captured.
- **fixed** The completion chat line colour is now `<col=0ab0ff>`; the quest sets `completionMessageColor`.
- **note** Scrambled already sent the captured start message and its own stage ladder; no change
  was needed there.
- **unchecked** A native run of the whetstone/cart repairs, the three guardians, the egg jigsaw
  and the King's-men finale. The carousel below is capture/source only.
- **unchecked** Recovery: a partly solved jigsaw across a relog, a full bag at the pet egg, and
  an interrupted guardian fight.

## Capture evidence

- Primary archive **3072**, revision 231, `rsprox-3072.bin`, 529,441 bytes,
  sha256 `17ebfbd965e9e06b0abf791ddc3cb0fdfdad7ef647acfe0a77e189ffb352b590`.
  Packet lines 8987-40338, ticks 536-3203.
- Cross-check archive **1106**, revision 237, `rsprox-1106.bin`, 2,768,924 bytes,
  sha256 `8ffd73d988037b85023cb825e6653f2066975dbd1d7031d67c3199f17ddc8e49`.
  Ticks 4587-5757 for Scrambled (it then completes Death on the Isle in the same recording).
- Stage ladder (varbit 16758, varp 4748 bits 0-6): 2, 4, 6, 8, 10, 12, 14, 16, 18, 19, 20, 22,
  24, 26, 28, 30. Varbits 16759/16764/16765 (the three men), 16766/16769/16770 (the eggs),
  16994 (egg on the wall) and 16995 (nails) move with the steps.
- Capture route: Alan → the king → Nezketi, Kauayotl and Acatzin → the three egg guardians →
  the eggs handed in and judged → whetstone and cart repairs → the finale.
- Completion: tick 3203, jingle 154, scroll item 30972 x400, "1 Quest Point",
  "5,000 Construction XP", "5,000 Cooking XP", "5,000 Smithing XP", "Your very own egg";
  `UpdateStatV2` Cooking, Smithing and Construction.
- Cache contract: quest DB row 5191, endstate 30. `quest_helper` reports
  `{varbit 16758, varp 4748, bits 0-6}` and `agrees: true`.

## Runs

No native run yet.
