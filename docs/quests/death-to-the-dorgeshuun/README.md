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
  `server/tests/dorgeshuun-optional-tour.test.cjs`. The border guard stop is reached by Talk-to on the guard only: its page opens on the player's line ("Can we come through this gate?"), so the live trigger is probably the toll gate, whose click still plays the ordinary toll dialogue here (AlKharidGate.plugin.js); that trigger is inference.
- **open** The Wiki's skill and combat tutor stops (npc ids 3216-3227: crafting, banking, cooking, woodsman,
  smithing apprentice, ranged/magic/melee combat, prayer, mining, fishing) have transcripts but no spawn in this
  world, so they cannot be reached.
- **fixed** The cellar trapdoor landed in the wall beside the ladder; it now lands on the walkable store-room tile (2568, 5185). A second Zanik stood in the cellar once the follower took over (NPC 4507 resolves through varbit 2264, now cleared after the start stage). Both wall cracks (15731 at 2569, 5190/5194) and the four lock-pick doors (15759, 23 Thieving; Open says "The door is locked.") cross to the far side of their wall edge. [Quick guide](https://oldschool.runescape.wiki/w/Death_to_the_Dorgeshuun/Quick_guide). Fixed in #3796.
- **fixed (source and test level, not played in game in this pass)** The goblin tour stop now fires by walking into the
  goblin field east of Lumbridge, as the Quick guide says ("Walk near a goblin. Zanik will talk to one"); the
  owner-only talkable goblin (11338) placed beside the player is gone. Source: Wiki Quick guide and the
  `a-tour-of-lumbridge-walking-near-the-goblins-in-the-forest` transcript. Test: `qh728-q018`.
- **fixed (source and test level, not played in game in this pass)** Zanik is brought back when the engine drops her
  follow on a plane change or a long teleport; the per-tick leash leaves another follower in varp 447 alone and does
  not drag her into an instance. Test: `qh728-q018`.
- **verified** Mistag's "Can you show me the way out of the mines?" already lands at the recorded tunnel tile
  3235,9610, with no object on it. The pre-guide-routing handler sent the same dialogue to the Lumbridge Castle
  surface at 3209,3214, the old wrong jump; the guide routing (`DorgeshuunGuides.plugin.js`) replaced it.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q018); PRs: [#1108](https://github.com/RSPSApp/tsps/pull/1108).
