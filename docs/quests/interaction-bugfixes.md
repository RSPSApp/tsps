# Quest interaction fixes

This change set repairs the interactions below. It does not implement every missing part of these quests or establish exact native OSRS cutscene timing.

## Evidence and scope

| Area | Repaired behavior | Evidence |
| --- | --- | --- |
| Animal Magnetism / Ava | Devices interface, purchases/upgrades, Buy-1/5/X/All and normal payment eligibility | [Ava](https://oldschool.runescape.wiki/w/Ava); revision-241 interface 67 and item definitions |
| Death to the Dorgeshuun | Walkable trapdoor arrival, cellar Zanik visibility when the follower takes over, both wall cracks and four lock-pick doors | [Quest route](https://oldschool.runescape.wiki/w/Death_to_the_Dorgeshuun/Quick_guide); cache placements/rotations and NPC 4507's varbit 2264 |
| Watchtower | Battlement/guard roles, rock-cake handover, paid outward bridge jump/free return, nightshade-gated enclave entry | [Quest route](https://oldschool.runescape.wiki/w/Watchtower/Quick_guide); existing imported transcript actions and cache locs |
| The Giant Dwarf | Coal or logs can initiate the fuel hand-in; missing/repeated fuel and an empty-machine tinderbox get feedback | [Quest route](https://oldschool.runescape.wiki/w/The_Giant_Dwarf/Quick_guide); existing machine state and transcript |
| Plague City | Locked-cell Elena uses her Plague City plea instead of falling into unrelated dialogue; talking omits the door's locked-message action | Existing imported Plague City transcript; scoped to the cellar NPC during the quest |
| Biohazard | Correct sickest/inside/outside mourner dialogue, scripted sickest-mourner attack, locked HQ back door, trapdoor refusal | [Quest route](https://oldschool.runescape.wiki/w/Biohazard/Quick_guide); existing imported transcript variants and action IDs |
| Fishing Trawler / RFD | At-sea Murphy retains the trawler dialogue and wreck action; RFD claims only the port NPC; sunk-crew shore destination is walkable land | [Murphy transcript](https://oldschool.runescape.wiki/w/Transcript:Murphy), [Fishing Trawler](https://oldschool.runescape.wiki/w/Fishing_Trawler); cache NPCs and water/collision data |
| Shared passages | Khazard stronghold Open-only door is catalogued; both Ardougne castle staircase destinations are walkable | Cache object 2184 and staircase placements; existing shared door/climb handlers |

Readable cache reference: [Joshua-F/osrs-dumps at 6e5033af6215963581a51b348f452320ff18f0f6](https://github.com/Joshua-F/osrs-dumps/tree/6e5033af6215963581a51b348f452320ff18f0f6), matching server/target.txt (osrs-241_2026-10-20). Cache IDs/layouts establish resources, not server timings. The tests check registered handlers, item conservation, quest gates, per-player visibility, map collision and destinations.

## Deliberately excluded

- The private Plague City digging/tunnel/grill/pipe/manhole/warrant-house travel implementation.
- The private Biohazard feed/pigeon visual sequence and timed wall/fence/door traversal.
- Closing #3250 or #3251: their native-capture requests remain outstanding.
- Custom XP/drop rates, reward multipliers, infinite resources/energy, bots, shop policies, broadcasts, account edits, gateway/client/launcher features and deployment tools.

The Watchtower movement additions restore functional routes; their exact official animation/tick choreography has not been packet-capture verified. These changes do not claim that the existing Watchtower enclave cutscene or other documented quest gaps are implemented. Native-capture refinements remain separate work.

## Verification

The server TypeScript build and 567 checks in these existing test files passed on upstream 1d37ea6ca93564d1901f39c5ed2765a2de50208a:

- small-conversions-preset-copies.test.cjs
- quest-plugins.test.cjs
- watchtower-ground-spawns.test.cjs
- watchtower-teleport-quest-gate.test.cjs
- climb-links.test.cjs
- qh728-q117.test.cjs
- qh728-q018.test.cjs
- biohazard-watchtower.test.cjs
- plague-city-progression.test.cjs
- fishing-trawler.test.cjs
- fishing.test.cjs

Tests ran with ordinary upstream gameplay settings and an isolated save path. No private reward-policy plugins or test-only deployment fixture overrides were used. This is not an uninterrupted full-quest native-client playthrough.
