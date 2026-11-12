# NPC drops

`server/plugins/npcs/NpcDrops.plugin.js` rolls an NPC's drops from three files in `server/data/definitions/`:

| File | What | Made by |
| --- | --- | --- |
| `npc-drops.json` | every drop table, and which NPC ids roll which tables | generated |
| `npc-drop-subtables.json` | the shared tables (rare drop table, gems, herbs, seeds, talismans…) | generated |
| `npc-drop-overrides.json` | hand edits on top of the two | by hand |

Corrections that need logic (Zulrah's two rolls, the Mad Angel's supply batch, Skotizo's shard roll, Amoxliatl's two rolls with one frozen tear roll, the animated bronze armour, the brimstone and Larran's keys taken off every table because `Keys.Slayer.js` drops them) stay in code, in `applyWikiCorrections`.

Loot that depends on where or what the NPC was rather than its table is added by other plugins on `npc-drops:add` { player, npc, npcId, drops }, emitted straight after the roll and before `npc-drops:roll` (so the Collection Log and Ironman rules see it): the Catacombs of Kourend's totem pieces and shards, and Skotizo's totem table ([skotizo.md](skotizo.md)).

Rows the Wiki limits to a place ("Only dropped in Ruins of Tapoyauik", "only dropped by giants not on the Giants' Plateau"; nine places from the Iorwerth Dungeon to Karamja) are read from the row's note and roll only when the NPC stands in that place's boxes in `plugins/npcs/data/drop-locations.json`; elsewhere the row is an empty slot, so the other rows keep their published rates. A test fails when a note names a place with no boxes.

Tertiary drops can be made likelier per kill on `npc-drops:tertiary-chance` { player, npc, npcId, rules }, emitted once per kill before the tertiary rolls (only when the table has any): a listener pushes `{ pattern, multiplier }`, and each entry whose name matches is that many times as likely. An imbued ring of wealth adds ×2 for clue scrolls in the Wilderness; Mortimer's clue tasks add theirs ([slayer.md](slayer.md)).

Any entry can be made likelier per kill on `npc-drops:chance` { player, npc, npcId, source, rules }, emitted once per roll before anything is rolled: a listener pushes `{ pattern, multiplier }` as above (`pattern` needs only a `test(name)`), and every entry whose name matches - pre-roll, main roll, separate rolls, tertiary - is that many times as likely. `source` is the NPC's name, or what a `npc-drops:roll-table` request passed as `source` (a chest has no NPC). In the weighted rolls the entry's weight is multiplied and the pool grows by what was added, so w/N becomes mw/(N + (m-1)w) and the other entries keep their weights (1/512 at 5x is 5/516); the boss rare multiplier below rolls those entries on their own instead. A league's boosted drops answer this ([server/docs/leagues.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/leagues.md)); rollers outside NpcDrops (superior Slayer monsters' uniques, Treasure Trails caskets) ask the same shape as `drops:chance` { player, source, rules }.

A boss's uniques can be made likelier world-wide with `pluginConfig` `"NpcDrops:bossRareMultiplier"` ([world-configuration.md](world-configuration.md)). Tables of NPCs the cache marks as bosses (param 1361), plus the bosses `npc-drop-overrides.json` lists under `bossNpcs`, get `boss: true` on load. An eligible row must be an individual item rarer than 1/10, and either be in a unique section or appear in the cache's boss collection-log tab (which includes rings, pets, jars and visages even when their drop sections are not called "Uniques"). Rarity or pre-roll placement alone never qualifies a row: ordinary supplies, equipment, clue scrolls and shared drop tables keep their rates. The cache lookup is independent of whether the Collection Log plugin is enabled. Eligible rows roll that many times likelier, on top of any tertiary multiplier. Pre-roll, separate and tertiary rows are rolled as before; a unique on the main weighted roll is rolled separately at its boosted chance, so ordinary main loot keeps its exact rate. Raid and other reward chests roll their own loot and are not affected.

## Regenerating

The two generated files come from the OSRS Wiki's drop tables, through osrsreboxed-db:

```sh
cd ../osrsreboxed-db
python -m scripts.drops.update          # writes docs/drops-json/
cp docs/drops-json/npc-drops.json ../tsps/server/data/definitions/npc-drops.json
cp docs/drops-json/subtables.json ../tsps/server/data/definitions/npc-drop-subtables.json
```

- **Never edit generated files or repair them through an override:** fix the canonical source/parser, add a regression, regenerate twice, and import exact output. Generated conflicts are resolved by regeneration.
- **The drop dumper reads monster pages** already fetched by the monster updater (`scripts.monsters.update`), and takes NPC ids from osrsreboxed-db's monster database. A monster that's new since the last monster update gets no table until that runs.
- **Noted drops:** the dump marks entries the Wiki shows as "(noted)" (`noted: true`), which needs osrsreboxed-db's `fix/drops-noted` branch until it's merged.

## God Wars variant loot

The four generals use `gwdRareDrop`, `gwdGem` and nested `gwdMegaRare`, exported from their own Wiki source page. Their 128-slot variant tables have no empty outcomes and do not respond to ring of wealth. The main accesses preserve the source 8/127 and 2/127 chances.

All main uniques and supplies are one exclusive loot outcome. Exact source fractions use a common pool of 1,524 integer subslots (127×12): armour 1/381, hilt 1/508 and shard 1/762 rates remain exact, and unique-table Coins 1.25/127 are preserved. The ordinary coin remainders are 330/336/396/480 over 1,524 for Zilyana/Graardor/K'ril/Kree; adding the exact nested variant coin routes reproduces displayed inclusive rates 31.2/31.7/36.7/43.7 over 127. The earlier local 29/30/34/42 remainder model was incorrect because it omitted unique probabilities and rounded fractional coins.

Imported output is from [canonical God Wars #15](https://github.com/RSPSApp/osrsreboxed-db/pull/15), built on canonical #14; this branch also retains the safe import/reward ownership from TSPS #882. Full NPC mapping and non-God-Wars data are unchanged. The generated hashes are `cecdb21e757007a75893b721ae9a81d283ba62c6cc409cfe808dd9af8120068f` (NPCs) and `70cfdff188712ed9321f6bfaed89de16e352b81ac7ffb2cb0dffbc13fa8203f3` (subtables).

The existing drop-import preservation suite checks every variant slot with and without wealth, exact pool weights and supply bundles, and the real roller's single unique outcome. Guaranteed/tertiary loot, Nex pairs, quest-only empty mappings and the Mimic/Feud reward paths retain their previous ownership.

Verification for this import: TypeScript build and 26 focused integration tests pass. The full server suite has 4,945 passes and two unrelated browser/network environment failures; the complete affected files pass 44/44 outside the sandbox, including the ephemeral localhost connection the sandbox denied. Those results are disclosed separately from a green full-suite run.

## The overrides

`npc-drop-overrides.json` is applied when the drops load. Where the dump already has a shared table, the dump's wins, so an override the dumper catches up with becomes a no-op. An `addNpcs` entry for an NPC the dump already maps appends the tables it names that the dump does not, keeping the dump's own first table as the default; an entry that adds nothing is dead weight. `tests/npc-drop-overrides.test.cjs` fails when an override is no longer needed, so it can be removed.

| Section | Does | Now |
| --- | --- | --- |
| `removeNpcs` | NPC ids that drop nothing themselves | the Ents (6594, 7234, 9474): their trunk gives the loot |
| `addNpcs` | NPC ids mapped to a table the dumper doesn't map them to, or given the extra tables it misses | 110 variants and versions (Phosani's Nightmare, the Nightmare, Ghast, Kalphite Guardian, Slagilith…), added by hand in September; the five Chaos Temple zombie pirates, whose page's `dropversion=Diary` table the dumper exports but does not map |
| `tables.<id>.addEntries` / `addTertiary` | entries added to a table | the Abyssal Sire's pet, the Abyssal orphan |
| `tables.<id>.removeSections` | sections of a table left out of every roll | Yama's Contract section (what his contracts reward, not a normal kill) |
| `subtables` | shared tables the dumper doesn't export | none: the uncommon seed table is in the dump since #1952 |

## A world's own edits

The browser host's **Content > NPC Drops** tab saves to `npc-drops-custom.json`, the same way spawn edits go to `npc-spawns-custom.json`. It holds only that world's changes, isn't in the repo, and is applied before the overrides, so tsps's own fixes keep reaching a world that has edited its drops. "Revert drops to default" removes the NPC's tables from it.

| Key | Does |
| --- | --- |
| `tables.<id>.setEntries` | dump row rates (`weight`, `out_of`) and `quantity` changed, keyed `field:index` |
| `tables.<id>.removeEntries` | dump rows removed, by `{ field, index }` |
| `tables.<id>.addEntries` / `addTertiary` | rows added |

Rows are addressed by their position in the dump, so regenerating `npc-drops.json` can move a world's edits onto different rows. `hits()` only rolls whole-number `out_of` values, so independent rows keep whole-number rates; main rows may use fractional weights.

`quantity` is `[min, max]`, whole numbers from 1, with `min` equal to `max` for a fixed amount; anything else is ignored and the row keeps its quantity. It replaces the row's conditional amounts (`quantity_alternatives`), such as more ashes at a preferred location, so the edited amount applies on every kill. Non-stackable items land as one ground item each, so a large quantity on an unnoted item floods the tile.

## The 2026-10-07 refresh

The generated files were replaced by osrsreboxed-db's 2026-10-07 dump, with the earlier hand edits moved into the overrides. Loading both the old and the new files and comparing every NPC's tables showed:
- **The same 3,201 NPCs** have drops, and the shared tables are identical.
- **One NPC changed:** the Sailing manta ray (15221) rolled both the monster and the Sailing manta ray tables on every kill. It now rolls only the Sailing one.
- **Noted drops: 120 → 3,068.** Everything the Wiki marks noted now drops noted, not just the hand-picked lists (Corp's resource drops were one). The Kalphite Queen's and the Mad Angel's noted lists in code are now redundant but harmless.

## Goblin energy potions (#1706)

Goblins dropped energy potions on about a third of kills. osrsreboxed-db had cached the Goblin page mid-way through the 19 August 2026 drop-table change, with its energy potions as "Common" and no rate, so each became an independent 1/8 roll (three on table 1, two on table 2). The current page has Energy potion(3) and Energy potion(4) at 3/128 each on table 1 and Energy potion(2) at 13/128 on table 2, all inside the 128 pool.

Imported from osrsreboxed-db [`c70ad220e7`](https://github.com/Bandit-HaxUnit/osrsreboxed-db/commit/c70ad220e7) (branch `fix/goblin-drop-rarities`, built on `2fe648dd71`, the export imported before), which re-fetches the page and regenerates; the same fix for master is [RSPSApp/osrsreboxed-db#27](https://github.com/RSPSApp/osrsreboxed-db/pull/27). Only `goblin_drop_table1` and `goblin_drop_table2` change, apart from `meta.generated`; `npc-drop-subtables.json` is byte-identical, and two runs match. The dumper now warns when several rows of one section have only a word rarity; six other tables trip it (the corrupted Gauntlet monsters, the elite Black Knight, Molanisk's energy potions, Nex) and are left for a check against their pages.

## Main-table roll counts (#1791)

The Wiki's `DropsLine` and shared-table templates carry `rolls` separately from each row's chance. The dumper discarded it, leaving Crushing hands with one normal loot roll rather than three. [The parser/export fix](https://github.com/RSPSApp/osrsreboxed-db/pull/28) preserves a uniform main-table count, excluding guaranteed and tertiary drops. Mixed-count tables keep their previous behavior because a table-wide count would repeat one-off rows.

This import is the entire output of pinned producer [`fbd9fa4e1af5cf55fa7f62589f2ff69917e8ebd7`](https://github.com/RSPSApp/osrsreboxed-db/commit/fbd9fa4e1af5cf55fa7f62589f2ff69917e8ebd7): the same source fixes backported onto `c70ad220e7`, whose unmodified generation is byte-identical to the previous TSPS import. Using current dumper master would also change 281 unrelated tables and NPC mappings; those changes are outside this import. No source inputs or generated output were patched.

Two full generations with `SOURCE_DATE_EPOCH=1793491200 python3 -m scripts.drops.update --out <directory>` match byte for byte. The timestamp input pins `meta.generated` to 2026-11-01 UTC, making the same command reproducible on later build days; without it the dumper retains its current-date default. The imported `npc-drops.json` SHA-256 is `4d9d5e05824d39e755e55643b9c5e13c9c8aa8c9278937b85233b9a0c0fb5974`. Subtables (`011008df793196844a7eb29464ecae50ecd8801dda5f5a30fb46f250c833a689`) and unresolved items (`e40dbeb02cea7ed1513c931cd169679861a494f73372f57954e7bd980bba62ef`) are unchanged.

Only 17 `rolls` fields change: 13 superior tables gain three rolls; Vorkath and Zulrah's two rolls already match their runtime corrections; the Ent table remains unmapped because its trunk owns the loot; scavenger beasts now get their two normal rolls plus bones directly from the table, replacing the CoX extra-roll hook. Native death tests cover Crushing hand loot and 550 Slayer XP on and off task, and the scavenger count. Rare superior uniques remain chance-based; the reported absence of superior loot remains unreproduced. The native path also grants 550 Slayer XP, with no XP behavior change in this fix.

## The uncommon seed table (#1952)

Lizardmen killed six times in a row dropped only bones. Nothing was wrong with the roller: the dumper had no mapping for `{{UncommonSeedDropTableInfo}}` / `{{UncommonSeedDropLines}}` and dropped the row without a warning, so the level 53 and 62 lizardmen and the brute lost their 15/87, 15/78 and 15/67 seed rolls and the empty part of the pool grew by 15 slots (bones only on 82% of level 53 kills instead of the Wiki's 64%). 54 monster tables use that template: moss giants, ice giants, ogres, trolls, Bryophyta and more. [The dumper fix](https://github.com/RSPSApp/osrsreboxed-db/pull/33) exports it as the shared table `uncommonSeed`, from the Drop table page, which retires the hand-made `subtables.uncommonSeed` override (Obor and Bryophyta's lairs keep using it by name). An uncommon seed access never suppresses a page's own listed seeds: `{{UncommonSeedDropLines}}` is that pool's listing, so rows beside it belong to other pools (the manta ray keeps its rare and tree-herb seed rolls, with its Yew, Magic and Redwood tree seeds).

Restoring the roll overfilled pools whose rows give a members-world rate ("decreased to X in [[members]] worlds", "decreases to X on a [[members]] world", with `altrarity=X`): the dumper kept the free-to-play rate. The dump describes members worlds, so those 19 rows now roll the alternate rate, and the moss giant, ice warrior, skeleton, zombie, White Knight and wizard pools fill exactly 128 slots again.

This import is the entire output of pinned producer [`682d17b97d05a2cb8b8e546fb45b7867dbab1af0`](https://github.com/BeefBeefs/osrsreboxed-db/commit/682d17b97d05a2cb8b8e546fb45b7867dbab1af0) (branch `fix/1952-uncommon-seed-table-pinned`): the same fix backported onto `fbd9fa4e`, whose unmodified generation reproduces the previous import byte for byte (`4d9d5e05…`, `011008df…`, `e40dbeb0…`). Exactly 66 tables change, plus the new `uncommonSeed` shared table and its name in `meta.shared_tables`; NPC mappings and every other table are unchanged. Two generations with `SOURCE_DATE_EPOCH=1793491200` match byte for byte: `npc-drops.json` `b30a24b7606d388edfe5c5249c5c0e0d733aa876d0fdbb9b1073523f2510186a`, subtables `a2a90b4467e86ad34afbe3788eda588ab1137a0f98d7a5a589cf0883b6684b12`, unresolved items unchanged.

The general seed table (`seed`) is exported as six combat-level categories (see "Ordered rewards, Forgotten Four and source categories" below); until then it was a flat list whose first eight allotment seeds already filled its 1,008 slots, so its herb, flower, bush and special seeds never dropped.

### Shared named-footnote repair

Pinned producer [b618aec953fb](https://github.com/RSPSApp/osrsreboxed-db/commit/b618aec953fbbdb1e661d4ed5228647ae2196baf) extends the import's `682d17b9` source with shared HTML, Refn and NamedRef drop-note resolution and a regression check. Explicitly referenced location notes apply to every referencing row, including all Karamja trading-stick rows and both Hill Giant weapon variants.

Regenerated with `SOURCE_DATE_EPOCH=1793491200 python3 -m scripts.drops.update --out <output>` twice from unchanged pinned inputs. The unmodified pinned producer exactly reproduces the prior imported hashes; repaired outputs are byte-identical across runs. Imported `npc-drops.json` SHA-256: `8dc7ed00369a7afef0410a64d3fead9a0779d84e1ea2edab3ed19a9796fc48d8`. Subtables remain `a2a90b4467e86ad34afbe3788eda588ab1137a0f98d7a5a589cf0883b6684b12`. No generated output was edited manually.

The shared-reference repair restores 214 note differences across 110 tables, including previously missing quest notes. NPC mappings, table IDs, rates, quantities, bonuses, roll counts and ordered-drop contracts are unchanged. These are source-attached notes recovered by the shared parser, rather than location-specific overrides.

## Warriors' Guild Cyclops (#4402)

The upstairs and basement Cyclops shared one `cyclops` table, so the Dragon defender's base row dropped upstairs too. The Wiki names the NPC variant "Warriors' Guild Rooftop" but its drops "Warriors' Guild Top Floor", and the dumper didn't match the two labels. [osrsreboxed-db#73](https://github.com/RSPSApp/osrsreboxed-db/pull/73) (`3266dfa45`, `_heading_matches_drop_version`) treats them as equivalent, so each room gets its own table.

This import is the entire output of pinned producer [`d0bec67f5d422d41e5190210613b17202748c0d6`](https://github.com/RSPSApp/osrsreboxed-db/commit/d0bec67f5d422d41e5190210613b17202748c0d6): the same change backported onto `368fd8764`, whose unmodified generation reproduces the previous import byte for byte. It was generated twice with `SOURCE_DATE_EPOCH=1793491200 python3 -m scripts.drops.update --out <output>`, with identical output both times (#4530). Imported `npc-drops.json` SHA-256: `d408f558f2d5bb549c7211fa3a45df9569a3e31d86b075933ddbb155b8bd115f`. Subtables remain `a2a90b4467e86ad34afbe3788eda588ab1137a0f98d7a5a589cf0883b6684b12`. No generated output was edited manually.

Only the Cyclops changed:
- The shared `cyclops` table is replaced by `cyclops_drop_table_warriors_guild_basement` and `cyclops_drop_table_warriors_guild_top_floor`, so `meta.table_count` goes from 1,105 to 1,106.
- The twelve Cyclops NPCs (2137-2142 and 2463-2468) now map to their room's table.

Every variant keeps one guaranteed Big bones row. The Dragon defender base row is only on the basement table. The guild's own defender progression still decides which defender drops.

A full re-import of osrsreboxed-db master was deliberately left out. nharrison93 reported that it changes 452 tables and fails 7 checks; those numbers haven't been re-run here.

## Ordered rewards, Forgotten Four and source categories

Imported from the output of producer branch `d1-on-d0bec` ([RSPSApp/osrsreboxed-db#75](https://github.com/RSPSApp/osrsreboxed-db/pull/75), based on the previous pin branch `codex/4402-split-cyclops-drops-pinned`; the data is commit [`396d094fdc`](https://github.com/autismoyah-hub/osrsreboxed-db/commit/396d094fdc8d693fe3ee779bfdffcb22c7d9c3e3) and the branch head `06bde8fe5b` only adds a docstring; update this link when #75 lands), which is `d0bec67f5d4` (the previous pin) plus the producer's ordered-reward export (`f40c729fd9`), its tests for included unique templates and source variants (`91f43cd461`; its source is already in `368fd8764d`), the Zalcano death rune test (`017a847806`), a fix that keeps `quantitynotes` footnotes out of a row's notes, and a regeneration of the producer's own `docs/drops-json`. An unmodified `d0bec67f5d4` regeneration reproduces the previous `npc-drops.json` byte for byte (SHA-256 `d408f558f2d5…`). Two generations of the new branch with `SOURCE_DATE_EPOCH=1793491200` match byte for byte. `npc-drops.json` SHA-256 `174d4a6f2abf3c41559e1b8d0a058754921b8d8a653e86196946c528c4d18681`; subtables `719e91adadfea92ee8d0dac8b66bfdb38b50104804a91bac059096783b8877ef`; unresolved items unchanged. The 1,106 tables, 3,086 NPC mappings, the Cyclops split and `rolls` are unchanged.

What changes (280 of 1,106 tables):
- **Forgotten Four** (`duke_sucellus`, `the_leviathan`, `the_whisperer`, `vardorvis`): their uniques move into an ordered `reward_chain` (state domain `forgotten_four`), read by `OrderedRewards.NpcDrops.js`; the flat `entries` keep the 24-25 remaining rows and `main_max_roll` goes 100 to 78.
- **`separate_roll` on `nothing` rows** of `bloodthirsty_spectre`, `dust_devil_drop_table_regular`/`_wilderness`, `tribesman`, `tribeswoman`, `tz_haar_hur`, `tz_haar_ket_drop_table149`/`_221` and `tz_haar_mej` (9 rows, none with an item).
- **Notes**: 132 rows in 88 tables (prose kept beside typed requirements, junk `|name=..|group=d}` fragments removed, 11 rows gain a free-to-play rate note) and 164 `tertiary` rows in 151 tables.
- **Roll counts and unresolved counts**: 29 shared-table access rows (all `shared_table: "herb"`) carry `roll_count_weights`, the Wiki's `rolls` for that row as relative weights (aberrant spectre: 1, 2 or 3 herbs at 11/26, 11/26, 4/26). Once the access hits, `NpcDrops` rolls the shared table that many times (`RollCounts.NpcDrops.js`; the weights are not multiplied by the access chance again). 16 of those rows were `shared_table: ""` before and dropped nothing; 13 already had `herb` and rolled it once. Expected herbs per kill now match the Wiki's roll counts (aberrant and abhorrent spectres about 1.05, deviant 0.85, chaos druid 0.45, king kurask 0.44). Five rows (`hydra`, `colossal_hydra`, `bloodthirsty_hydra`, `eagle_ray`, `butterfly_ray`) carry `unresolved_roll_count` and no weights: the Wiki's count is not stated, so they roll once. **Known producer gap, not fixed here:** the repugnant spectre's Wiki rows are all `rolls=3`, but the export carries no `rolls` for `repugnant_spectre` or `bloodthirsty_repugnant_spectre`, so those kills still give about 0.85 herbs rather than about three times that.
- **Typed quest requirements**: 217 unchanged, 7 renamed to real quest keys (`quest_lunardiplomacy`, `quest_observatoryquest`, `quest_undergroundpass`, `quest_thebloodmoonrises`, `quest_watchtower`) and 26 no longer typed. The producer names a quest only if its title is a quest transcript page, so Frozen Door and Hopespear's Will (miniquests, 16 + 5 rows), the Sir Amik Varze subquest (Dragon token) and delve levels are prose now. Only Rag and Bone Man, Lunar Diplomacy and Recipe for Disaster answer `npc-drops:quest-item`; Lunar's key constant follows the rename and the Dragon token is gated by item id in `NpcDrops.plugin.js`, so both still reach their handlers.
- **General seed table**: `subtables.seed` is `entries: []` plus `combat_level_multiplier: 10` and six categories. The Wiki's rule: roll `random(CombatLevel * 10)`; below 485 rolls the allotment seeds (8 rows, /1008), 485-727 hops and others (7, /1000), 728-849 flowers (5, /1000), 850-946 bushes (6, /1000), 947-994 herbs (14, /1000) and 995 or more the special seeds (4, /1100). The rows are the old flat list's 44 rows, split. `NpcDrops.plugin.js` keeps each category as its own pool and picks one with the killed NPC's combat level (`SeedCategories.NpcDrops.js`); the random upper bound is exclusive, and an NPC with no known combat level rolls the lowest category. The Wiki's "5 coins on free-to-play worlds" replacement of the seed roll is **not** applied: the plugin has no free-to-play world concept, so every seed roll behaves as on a members world.
- **Rules not applied, as before this import:** the Wiki's free-to-play replacements (5 coins for the general seed roll and for the uncommon seed table's roll, 10 coins for the herb roll) and the blood quartz's scaling between kill 0 and 300 (the producer marks it unresolved; the base rate applies until 300 recorded kills and the endpoint rate after).
- **Goblin tables**: `goblin_drop_table1` and `goblin_drop_table2` change only in the Goblin skull tertiary row's notes (a prose note "Goblin skulls are only dropped during Rag and Bone Man I." is kept beside the unchanged typed requirement). Their rows, rates and the energy potion fix already on `main` are unchanged.

## Table-wide roll counts for superior Slayer monsters

Imported from the output of producer branch `d1b-table-rolls` on the pin line (`906fab9846`, `docs/drops-json` regenerated with `SOURCE_DATE_EPOCH=1793491200`; two runs identical; `npc-drops.json` SHA-256 `4d86195fcc2ba5bd4611e6decc335332b48ca8984ea9397a729285fc1ba1d7fc`, subtables unchanged). The same change is [RSPSApp/osrsreboxed-db#76](https://github.com/RSPSApp/osrsreboxed-db/pull/76) against master. A shared-table access is read from its `*DropTableInfo` template, which has no `rolls`; the page writes `rolls=3` on the sibling `*DropLines` template, so the producer exported no table `rolls` for pages that repeat every row three times. It now takes an access's count from the sibling template. Only the `rolls` key changes, on 21 tables: 20 with `rolls: 3` (abhorrent, repugnant and the other superior Slayer monsters, `nechryarch` and `nechryarch_2` included) and `bloodthirst_rockslug` with 9. The rockslug page says it "would have provided 9 rolls" had it been possible to kill; it is an unused variant with no spawn, so the 9 never fires. `mutated_tortoise` stays unrepeated on this pin because the pinned page cache gives its gem access no `rolls` (master's newer cache does).

What it changes in game: one kill of a superior with `rolls: 3` rolls its table (including the herb, seed and gem accesses; not the guaranteed or tertiary rows) three times, e.g. the repugnant spectre's herbs go from about 0.85 to 2.55 per kill, gems and rare seeds from 0.25 and 0.125 to 0.75 and 0.375. The Wiki's superior page says a superior always rolls three additional items, of which only one may come from the superior unique table; `Superiors.Slayer.js` rolls the unique tables separately, so a kill can get slightly more than the Wiki's three when the unique replaces one of them.

League: the Bloodthirsty relic text ("Six rolls on their normal counterpart's drop table (excluding unique superior table)", nine for a bloodthirsty variant; Trailblazer Reloaded League/Relics, revision 15173899, 2026-04-12) is read as the kill's total. `Bloodthirsty.LeagueRelics.js` therefore adds `max(0, total - own)` rolls on the normal counterpart's table, where `own` is the superior's own table rolls (`npc-drops:table-rolls`, 1 when the table has none). A superior with `rolls: 3` gets 3 extra (variant 6); one without gets 5 (variant 8), where it used to get 6 and 9 on top of its single own roll (7 and 10 in all).

