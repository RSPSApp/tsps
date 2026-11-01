# NPC drops

`server/plugins/npcs/NpcDrops.plugin.js` rolls an NPC's drops from three files in `server/data/definitions/`:

| File | What | Made by |
| --- | --- | --- |
| `npc-drops.json` | every drop table, and which NPC ids roll which tables | generated |
| `npc-drop-subtables.json` | the shared tables (rare drop table, gems, herbs, seeds, talismans…) | generated |
| `npc-drop-overrides.json` | hand edits on top of the two | by hand |

Corrections that need logic (Zulrah's two rolls, the Mad Angel's supply batch, Skotizo's shard roll, Amoxliatl's two rolls with one frozen tear roll, the animated bronze armour, the brimstone and Larran's keys taken off every table because `Keys.Slayer.js` drops them) stay in code, in `applyWikiCorrections`.

Loot that depends on where or what the NPC was rather than its table is added by other plugins on `npc-drops:add` { player, npc, npcId, drops }, emitted straight after the roll and before `npc-drops:roll` (so the Collection Log and Ironman rules see it): the Catacombs of Kourend's totem pieces and shards, and Skotizo's totem table ([skotizo.md](skotizo.md)).

Tertiary drops can be made likelier per kill on `npc-drops:tertiary-chance` { player, npc, npcId, rules }, emitted once per kill before the tertiary rolls (only when the table has any): a listener pushes `{ pattern, multiplier }`, and each entry whose name matches is that many times as likely. An imbued ring of wealth adds ×2 for clue scrolls in the Wilderness; Mortimer's clue tasks add theirs ([slayer.md](slayer.md)).

Any entry can be made likelier per kill on `npc-drops:chance` { player, npc, npcId, source, rules }, emitted once per roll before anything is rolled: a listener pushes `{ pattern, multiplier }` as above (`pattern` needs only a `test(name)`), and every entry whose name matches - pre-roll, main roll, separate rolls, tertiary - is that many times as likely. `source` is the NPC's name, or what a `npc-drops:roll-table` request passed as `source` (a chest has no NPC). In the weighted rolls the entry's weight is multiplied and the pool grows by what was added, so w/N becomes mw/(N + (m-1)w) and the other entries keep their weights (1/512 at 5x is 5/516); the boss rare multiplier below still stays out of the weighted rolls. A league's boosted drops answer this ([server/docs/leagues.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/leagues.md)); rollers outside NpcDrops (superior Slayer monsters' uniques, Treasure Trails caskets) ask the same shape as `drops:chance` { player, source, rules }.

A boss's rare drops can be made likelier world-wide with `pluginConfig` `"NpcDrops:bossRareMultiplier"` ([world-configuration.md](world-configuration.md)). Tables of NPCs the cache marks as bosses (param 1361) get `boss: true` on load, and their pre-roll, separate and tertiary entries rarer than 1/100 roll that many times likelier, on top of any tertiary multiplier. The main weighted roll is left alone. Raid and other reward chests roll their own loot and are not affected.

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

`npc-drop-overrides.json` is applied when the drops load. Where the dump already has an NPC or a shared table, the dump's wins, so an override the dumper catches up with becomes a no-op. `tests/npc-drop-overrides.test.cjs` fails when an override is no longer needed, so it can be removed.

| Section | Does | Now |
| --- | --- | --- |
| `removeNpcs` | NPC ids that drop nothing themselves | the Ents (6594, 7234, 9474): their trunk gives the loot |
| `addNpcs` | NPC ids mapped to a table the dumper doesn't map them to | 110 variants and versions (Phosani's Nightmare, the Nightmare, Ghast, Kalphite Guardian, Slagilith…), added by hand in September |
| `tables.<id>.addEntries` / `addTertiary` | entries added to a table | the Abyssal Sire's pet, the Abyssal orphan |
| `tables.<id>.removeSections` | sections of a table left out of every roll | Yama's Contract section (what his contracts reward, not a normal kill) |
| `subtables` | shared tables the dumper doesn't export | the uncommon seed table (Obor, Bryophyta) |

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
