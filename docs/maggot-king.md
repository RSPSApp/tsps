# Maggot King encounter

The quest-gated Darkwood trees open a solo copy of the actual Maggot King's lair. Its 1500HP boss starts ranged, alternates ranged and magic around screeches, introduces larvae and melee as its health falls, and finishes in melee. Only the owner can attack its boss or larvae. Leaving, logout, death, instance destruction and server shutdown stop the encounter; a kill stops its effects and permits a fresh spawn in the same room.

This change implements combat and recovery. The separate corpse-choice/reward chain, upstream generated drop repair, collection-log/Combat Achievement reconciliation, fire-spell burn stacks and optional bile-immunity equipment combinations remain separate work. No generated definitions or drop tables are patched here. Native NPC death/damage attribution remains authoritative; the plugin records the owner's kill count for the displayed counter and the first-five-kill grave discount.

Until corpse-choice rewards are implemented, actors spawned by this encounter suppress the generic NPC death-loot roll. This prevents premature Take-eggs tertiary loot behind the bone wall. Suppression follows the original actor after death/session cleanup; unrelated NPCs with the same ID retain ordinary drops. This does not implement either corpse reward option.

## Rules and source

Primary Wiki revisions read for this encounter:

- [Maggot King, revision15383453](https://oldschool.runescape.wiki/w/Maggot_King?oldid=15383453), raw SHA256 `8ef4a85190a8e8bca9c696699de49c552154777c81d8a741c5188036bea941e3`.
- [Strategies, revision15398168](https://oldschool.runescape.wiki/w/Maggot_King/Strategies?oldid=15398168), raw SHA256 `b5f4f9667d73511df33c68e26c7894677f657735d8a574dff9e8f35a29ee9cea`.
- [Lair, revision15252788](https://oldschool.runescape.wiki/w/Maggot_King%27s_lair?oldid=15252788), raw SHA256 `b62d516056c067ee9a3bf231e1ef5d5c480dbb4771639fc1d155bd8dfb95a629`.
- [8 July2026 update, revision15256817](https://oldschool.runescape.wiki/w/Update:The_Blood_Moon_Rises_Tweaks_%26_Fixes?oldid=15256817), raw SHA256 `199b67ce151ae8c973fabfcb34e710333f2f1c429f4cb0abf7e6267d9b9388a8`: ammunition fired at the boss must land in the player arena.

The source supports 4–8 attacks per rotation, ranged/magic maximum46 blocked by the corresponding prayer, three impact bile tiles, screech pulses15–25 for active protection prayers, temporarily100Defence then restoration to200, carrion25/fragment10 maxima, accelerating attacks after the first screech, larvae eating carrion/healing actual player damage, and head slams55/35 with a fresh-click melee punish. The HP thresholds1250/980/305/299 are approximate source values. The newer Strategies' specific ordinary-bow cooldown overwrite rule takes precedence over the supplemental larvae page's conflicting “no delay” wording.

Cache242 assets are pinned in Joshua-F/osrs-dumps commit `853150e3f75e1463391b470f98caf5d3bf796339`: NPC15742/15743; bile/carrion/head loc33423–33426; ranged/magic/screech/slam sequences13933/13934/13922/13925; larva flight13914; named Maggot projectile/spot effects1792/3793/3796–3801. The yellow spit reuses the unrecoloured acid-spit asset1555; warning shadows reuse the cache's90-cycle debris shadow1446. Asset identity does not prove live server timing.

## Geometry and implementation tuning

The old template at y7832 was wrong. Native cache2757/242 evidence identifies fifteen columns x2904..2918 and four rows y8033..8036, separated from the body by seventeen walking-blocking, projectile-open Bones on y8037. The template now starts2888,8032. Source regions/terrain and the native copied map agree; this is not an observed retail body-root measurement.

Body postures are implementation choices: far y8040, close y8038, roots selected only where the full5x5body fits clear native northern tiles, nearest the owner's column. It walks to a clear posture before extending the head. The independent3x4head projection stays within player-floor columns, including the lateral edges; its neck offset at extreme columns is an inference. Melee reach is admitted only for the owner, current boss, close phase, floor and nearby lateral columns, with native projectile LOS retained. A current session-owned head's Strike routes to native combat. A fresh NPC/head click in the extension tick bypasses the previous deadline once while preserving it; only the first hitsplat receives the damage bonus and the first crush roll receives the reduction.

No static escape Cave exists in the correct copied cache region. The instance therefore owns a dynamic recovery Cave61994 at2919,8033, face1, beside the eastern floor, approached from the west. That placement is a server recovery policy, not claimed retail placement. The returned player arrives2322,7370 beside the existing Vampyrium return portal; the grave is placed outside the Darkwood entrance, with the documented first-five-kill discount.

Unmeasured details are explicit tuning: uniform4–8 selection,6ticks before/5after the first screech, two-tick spit flight, three carrion piles with three-tick warnings and two adjacent fragments a tick later, a five-tick screech transition, three-tick larva airborne window, one-tile-per-tick horizontal traversal, and a minimum two-tick melee windup extended until the body arrives. Poisonous bile's unspecified minor damage uses2–4, matching the separately documented sticky range. These are not capture-derived exact retail RNG/cadences. Relevant corpus candidates were searched; the inspected historical name hit4276/rev239.1 is clan chatter, not a fight recording or proof of global absence.

## Verification

Accepted native BEFORE source `6395abd2a685138e9c68f11742932e4acb80759a` preserved both causal failures: wrong production map after quest/solo/bystander controls, and generic melee animation422 instead of ranged13933 after ordinary NPC Attack, actual ammo consumption and eight native world turns. A separate native correct-map case passed. Three legacy hybrid cases passed; the new native file had one pass/two intended failures. This was formalERROR70, never whole-workload green. Later entry-arrival assertions were unreached. No baseline replay is required.

Verification uses the existing remote Linux build/cache/test route. Local checks cover syntax and patch integrity. Exact tested revisions, observed outcomes and retained failures are reported in the PR evidence; source review alone does not establish a passing run. No local heavy build, browser or rendered-client proof is claimed.

Intended supported commands, from `server` after the reviewed build/cache setup:

```
node --test tests/maggot-king.test.cjs
node --test tests/shared-poison-counter.test.cjs
node --test tests/maggot-king-combat.test.cjs
```

The native fixture uses real cache/Player/World/registered hooks and ordinary NPC Attack input. Quest completion, equipment and standing are supplied. Targeted HP/hazard checkpoints are marked. The complete boss-health traversal keeps1500HP unseeded and drives native Attack and ordinary walking away from live larvae through death/retry, with player invulnerability supplied for survival; separate prayer/floor/larva cases use ordinary99HP actors. This does not claim a natural quest, unaided full-fight survival, sockets, rendering, exact retail timings, every gear variant or the queued corpse reward chain.
