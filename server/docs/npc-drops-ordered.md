# Ordered reward contracts

`NpcDrops` accepts optional source-generated `reward_chain` and `tertiary_groups` fields. Existing flat tables keep their current behavior. An ordered chain chooses one outcome from the first successful access and replaces that kill's main resources. Guaranteed drops and independent tertiary rewards still resolve. Exclusive tertiary groups choose at most one outcome using the existing tertiary modifiers and boss rarity setting.

`OrderedRewards.NpcDrops.js` interprets the generic contract. `ForgottenFourRewards.plugin.js` supplies the Forgotten Four persistence domain through custom events. `forgotten-four:loot-state` stores state per player and canonical table ID. A cyclic three-hit outcome grants one ring, then two rings, then its final item and resets. First-receipt flags govern tablet eligibility. Historic receipts are not inferred from inventory.

Chance rules (`npc-drops:chance`) reach a stage two ways: a rule naming the stage's key scales the stage (an awakened Vardorvis's `tradeable_uniques`, 3x), and a rule naming its rows' items (a league's boosted drops) scales the stage by the rows' boosts averaged over their weights and picks each row by its boosted weight. So a stage whose rows are all boosted is that many times as likely with its rows' shares unchanged, and one boosted row of several raises the stage by that row's share only.

The selector validates state before rolling and defers persistence until the complete outcome resolves. Missing providers and corrupt saved state fail closed. A source-described quartz endpoint uses 1/50 at 300 recorded kills before first receipt and 1/200 after receipt. Before 300 it uses the documented 1/200 base; the intermediate scaling curve remains unresolved. Tablet uses its documented 1/25 base; its pre-receipt scaling is unresolved. The provider queries `combat-achievements:count` by source Wiki page name. Normal NPC death hooks record Combat Achievements before the NPC drop hook, so this recorded count includes the current kill; the provider adds no offset.

Canonical authoring remains in [RSPSApp/osrsreboxed-db](https://github.com/RSPSApp/osrsreboxed-db). This runtime PR does not import or hand-edit generated data. Its standalone tests use generic consumer-contract fixtures and real Player instances; they require no Duke encounter helper or new source artifact. Import canonical DT2 exports only after the source change and its quantity/God Wars/pre-roll dependencies are reviewed, using the complete reproducible export. The source export explicitly retains published rarity provenance, and infers the guaranteed residual resource pool from 78 published relative slots with `weight_basis: conditional_pool`.

Sources: [Jagex's DT2 tweaks and drop rates](https://secure.runescape.com/m=news/desert-treasure-ii---tweaks-and-drop-rates?oldschool=1), plus the canonical cached Wiki overviews for Duke Sucellus, The Leviathan, The Whisperer and Vardorvis. Known endpoint execution does not assert an unknown interpolation or parity for other unverified encounter mechanics.

Validation: build the server, then run `node --test tests/dt2-ordered-rewards.test.cjs tests/*drop*.test.cjs`. The standalone suite covers the actual roller, cyclic progress, table isolation, serialization into another Player, first receipts, endpoint boundaries, exclusive clues, independent pets, supply bundles and failure atomicity. Canonical four-boss integration also passed separately on the installation work branch with the twice-regenerated source artifact.

Ordered access rates use `NpcDrops:bossRareMultiplier` under the same rules as flat
pre-rolls: only boss tables and effective access chances rarer than 1/100 are boosted.
The selected source endpoint is checked after scaling, so a common endpoint stays
unboosted. Grouped tertiary rewards combine the boss and per-kill tertiary modifiers.
If boosts push an exclusive group above 100%, it awards exactly one outcome in
proportion to the adjusted chances; malformed source groups whose base exceeds 100%
still fail closed. Conditional quantities and handled-item filtering retain the
ordinary kill context on both new paths.

Deterministic actual-roller regressions compare flat, ordered and grouped 1/200
accesses, non-boss exclusions, the strict 1/100 boundary, source scaling endpoints,
combined modifiers, saturation and one-outcome exclusivity.
