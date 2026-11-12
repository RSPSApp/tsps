# Zooknock greegree exchanges

The tunnel exchange is owned by Monkey Madness I. After making the first Karamjan greegree, ask Zooknock “Can you make another monkey talisman?”, confirm Yes, then use one monkey talisman and one set of remains on him in either order. Ask again for each completed exchange. Merely carrying the ingredients does not exchange them.

| Remains | Product |
| --- | --- |
| Ordinary monkey bones or monkey corpse | Karamjan |
| Small / medium ninja monkey bones | Small / medium ninja |
| Gorilla / bearded gorilla bones | Gorilla / bearded gorilla |
| Small / large zombie monkey bones | Small / large zombie |
| Ancient monkey skull | Ancient gorilla |

The first MM1 exchange requires ordinary bones or a corpse. Noted bones are refused. Inputs stay in the inventory while offered; the hand-back checks their availability and converts exactly one selected set of remains and one talisman into one product. Other carried remains are unchanged. A completed repeat consumes its permission, including when another copy of that product is already carried.

Closing or logging out leaves an unfinished confirmed offer recoverable. Talk again once both offered items are available. If an ingredient disappears before hand-back, no product or partial charge occurs. This is the implementation's conservative conservation/recovery policy; no recording establishes exact repeat-exchange cancellation timing.

The initial MM1 scene is distinct. It retains progress after the first product is given until the canonical Chapter 3 marker; restarting it cannot charge or grant twice. Earlier saved initial handover flags represent items already consumed by the old implementation, and are preserved as credits rather than refunded as guessed physical items. A full bag can block a legacy-credit hand-back until space is made.

MM2 owns its Kruk-paw Talk-to exchange, lost-Kruk replacement and aftermath/stronghold conversations. Its existing postquest page now has explicit duplicate predicates and handout consumers for the eight normal greegree choices, m'speak amulet and 10th squad sigil. Banked or carried duplicates are refused; full inventory refusal charges no materials. These handlers are scoped to completed MM2 and the actual stronghold actor/page. No ancient-gorilla free-reclaim option is added to that page. MM1 queries that ownership before accepting paid materials. The ordinary tunnel and stronghold parent NPCs resolve separately through the player's MM2 progress. Item-use dispatch invokes all item hooks, so the handlers have explicit ownership guards; setting handled alone is insufficient.

Expected behavior comes from [Zooknock](https://oldschool.runescape.wiki/w/Zooknock), [Greegree](https://oldschool.runescape.wiki/w/Greegree), the linked individual greegree pages, [MM1 quick guide](https://oldschool.runescape.wiki/w/Monkey_Madness_I/Quick_guide#The_greegree), and [MM1 transcript](https://oldschool.runescape.wiki/w/Transcript:Monkey_Madness_I#Creating_the_monkey_gree-gree). The guide explicitly says an interrupted initial scene can restart without losing items. Cache 242 supplies IDs, including that 3184 is a note of 3183.

Historical recordings supply only narrow post-MM2 preservation observations. Recording 3342, revision 235.1, inspected transcript 91600–91860 shows Next/large-zombie selection, then item 4030 and the hand-out statement. Recording 1150, revision 237.1, inspected 460950–461400 shows Large ninja selection, then Kruk 19525 and the hand-out statement. These are not evidence of the ordinary dungeon's paid exchange, its materials, precise timing, or exhaustive postquest reclaim behavior. Capture date/decoder build are unknown; current-cache mappings are checked separately.

## Verification

Tested source: `9b3f59412ee175e8ee52d9498be2b0a7a7f78c36`, Linux x64, Node v22.17.0, cache `osrs-242_2026-11-03` / OpenRS2 2757. One corrected run passed the 51-case ordinary native fixture, the two existing diary cases and six existing hangar-puzzle cases. The latter eight use real core/cache/registered plugins with player/inventory/packet stand-ins; they are not eight additional full native cases.

After preparing the pinned dependencies/native binary and running the build/cache preparation described in the PR, the literal test commands from `server` are:

```sh
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/monkey-madness-greegrees-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/monkey-madness-ardougne-diary.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/monkey-madness-hangar-puzzle.test.cjs
```

The native fixture uses real cache definitions, registered Player/Inventory/NPCs, ClientConnection inputs, World/task phases and save/apply/login lifecycle. Placement clears through World updates before inputs; observers bind the exact resolved NPC and selected physical inventory slot. All nine tunnel input alternatives in both orders, repeated outputs, material/refusal/recovery, initial scene and MM2 ownership controls passed. Passive postquest diagnostics observed `mmr4it=false`, followed by `l9BRxu` with physical Kruk item count 1. All ten existing postquest page products, carried/later-bank duplicates and capacity recovery passed. The supplied postquest actors retain a talisman; source and primary evidence establish no material prerequisite, while those assertions specifically demonstrate no payment and preserved supplied material.

The causal baseline at `5663b46c141179607c4c7774afa349a369a5b6dd` passed 6/38 and failed 32/38, with exit 1 and overall error. The first ordinary MM2 control and four Karamjan bones/corpse orderings passed. The reporter-state case reached the ordinary NPC consumer and failed at the missing repeat-menu assertion; later conversion/no-relocation assertions were unreached, so this does not reproduce the reported teleport. Variant cases reached their material sequence but failed on unconsumed selected remains; later assertions were not all observed. Initial first-offer reservation differences are not proof of irreversible loss under the old implementation, nor proof that retail literally keeps handed items in inventory.

An initial AFTER at `f752e435d3bd9d2ab1f4e672e7786bcf7da04dd0` passed 37/38, then failed the stronghold reclaim case while waiting for a Kruk output with no chatbox group. Its exact closing branch was not logged and remains unknown; diary/hangar were unreached. Source inspection found absent canonical duplicate-condition and handout consumers. The corrected run proves their new execution; it does not retroactively identify that earlier branch. All failures remain separate from the final single 59-case run.

Source, compiled output and all 28 cache-file seals stayed unchanged, all reached child processes exited without timeout or remaining process groups, and the final platform completed. Closure is process-group plus platform-terminal evidence, not an escaped-descendant census. A separate reviewer inspected source, fixtures, inputs and actual raw results.

Quest checkpoints, materials, canonical-spawn/perimeter placement and in-memory saved-login application are supplied. There is no claim of natural quest traversal, disk-backed authentication, socket stream, rendered client/audio, measured retail cadence or a complete repository suite. Conservation/refusal feedback and unfinished-offer recovery are explicit implementation choices where the primary sources do not specify exact repeat timing.
