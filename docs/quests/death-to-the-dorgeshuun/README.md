---
quest: Death to the Dorgeshuun
key: death_to_the_dorgeshuun
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Death to the Dorgeshuun

No native playthrough recorded; natural completion pending.

## Findings

- **fixed (source and test level, not played in game)** Optional Lumbridge tour stops. Fred the Farmer, the
  candle seller and the Al Kharid border guards (npcs 4287, 4288) now play their Wiki transcript pages once
  Zanik follows the player, like Millie, Father Urhney and Gee/Donie; they give no tour progress. Source: the
  Wiki "Death to the Dorgeshuun" transcript (no rsprox capture of the tour was found; a text search for
  "Zanik of the Dorgeshuun" hit only a Land of the Goblins capture). Test:
  `server/tests/dorgeshuun-optional-tour.test.cjs`; the candle seller's closing menu is not exercised.
- **open** The Wiki's skill and combat tutor stops (npc ids 3216-3227: crafting, banking, cooking, woodsman,
  smithing apprentice, ranged/magic/melee combat, prayer, mining, fishing) have transcripts but no spawn in this
  world, so they cannot be reached.
- **fixed** The cellar trapdoor landed in the wall beside the ladder; it now lands on the walkable store-room tile (2568, 5185). A second Zanik stood in the cellar once the follower took over (NPC 4507 resolves through varbit 2264, now cleared after the start stage). Both wall cracks (15731 at 2569, 5190/5194) and the four lock-pick doors (15759, 23 Thieving; Open says "The door is locked.") cross to the far side of their wall edge. [Quick guide](https://oldschool.runescape.wiki/w/Death_to_the_Dorgeshuun/Quick_guide). Fixed in #3796.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q018); PRs: [#1108](https://github.com/RSPSApp/tsps/pull/1108).
