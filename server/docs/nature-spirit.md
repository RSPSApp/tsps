# Nature Spirit: Bloom and grotto fixes

The quest lives in `plugins/quests/quests/NatureSpirit.Quest.js`. Its route and native input
checks are in `tests/qh728-q082.test.cjs`; the native growth/rendering regression is in
`client/tests/loc-animation-submission.test.ts`.

Sources:

- [Wiki walkthrough](https://oldschool.runescape.wiki/w/Nature_Spirit) and
  [fungus gathering](https://oldschool.runescape.wiki/w/Money_making_guide/Collecting_mort_myre_fungi):
  nearby plants, 1–6 Prayer per sickle cast, the ritual and finished altar.
- [Quest Helper at 06da90f982518a093f2fe1c9cfac5547fa7053d3](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/naturespirit/NatureSpirit.java):
  item interactions, stages, inner-grotto Search and actor placement.
- [RSProx 1635](https://rsprox.net/download/1635), revision 226: 71 nearby Bloom animations.
  At ticks 1114–1115, sequence 1100 has delay 10, player graphic 264 delay 30/height 200,
  and tile graphic 263 delay 15/height 150 spreads over eight adjacent tiles. Only some plants
  grow. Tracking known unbloomed locs through ticks 1090–2000 gives 145/214 successful logs
  and 19/26 branches. The implementation's independent **2/3 success chance is an inference**
  from these observations, not a published exact formula.
- [RSProx 1698](https://rsprox.net/download/1698), revision 226: eight local casts at ticks
  7908, 7923, 7930, 7947, 7955, 7962, 7971 and 7986 each send synth 1493, loops 35, delay 0.

The active `osrs-241_2026-10-20` cache confirms these animation/graphic ids. The Bloom animation
lasts 64 client cycles (three game ticks); the pouch effect's sequence lasts 18 cycles
(one game tick). Those durations provide the action delays; an exact server pouch cooldown
has not been captured. The old grotto/exit are on plane 0, and the finished grotto with
altar 3521 and exit 3526 is at the same coordinates on plane 1. Completion, later entry and
old completed saves use plane 1. Its altar restores Prayer to the base level plus two.

Plant sequences 1096–1098 finish after holding their last growth frame. The cache's unanimated
models are the grown plants. The client now bakes and submits that base pose after a one-shot
loc sequence ends, rather than returning to its first growth frame. Both smoothing settings
and the shared renderer draw ranges are checked against the real cache.

Filliman stays a ghost until his transformation line is continued; the green actor/head then
owns subsequent lines. Search inside the grotto can start that conversation. Revealed ghasts
retain their source positions, can move and engage their owner, and their invisible sources
stop applying an additional food-rot attack. Pouch use covers all four invisible ghast ids.

Remaining: the transformation presentation uses the quest's Bloom effect and a short held
line. Its full live camera/cinematic sequence still needs a recording; this change does not
claim exact cutscene fidelity. No generated dialogue/data files are modified.
