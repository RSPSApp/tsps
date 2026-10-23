# NPC drops

## Local Wiki audit and repair, 23 October 2026

The audit inspected all 1,112 generated tables, 3,092 generated NPC mappings (3,201 after historical overrides), nine generated shared tables and one historical shared override. No NPC referenced an unknown table. Wiki comparisons covered shared seed/herb rules, pinball, representative early-game drops, boss variants and beginner casket rewards. This is structural verification plus targeted Wiki comparison; it does not certify every OSRS drop.

The repaired export contains 3,089 NPC mappings; loading historical overrides yields 3,198 usable mappings. Explicit post-quest Wiki table declarations exclude the quest variants of Amoxliatl and Vorkath from normal boss loot. Regression coverage also preserves regular variants on mixed encounter pages.

Repairs regenerate canonical cached Wiki inputs through `../osrsreboxed-db`; generated tables are imported without output patches. The source caches have no per-page retrieval timestamps, so the generation date does not mean every page was refreshed that day. Two complete generations from the same inputs must match byte-for-byte.

- 113 pre-roll entries in 65 tables lacked their execution denominator, preventing those rare drops. The exporter now preserves it. Exclusive outcomes share one weighted pre-roll draw, preserving each slot's probability.
-The general seed table now preserves six categories and their source thresholds 485/728/850/947/995. The server selects a category using the defeated NPC's combat level before rolling that category's items. Previously only the first category was reachable.
-Multi-herb access now carries source-backed batch probabilities or a known fixed roll count. Each herb is rolled independently. Unknown batch distributions remain explicitly unresolved rather than guessed.
-Nothing entries retain their independent/pre-roll flags. The seven previously overfull pools overflowed only through trailing Nothing rows; this audit did not establish lost-item bias from that particular defect alone.
-The visiting Flippa uses cache NPC 6744, which exposes Talk-to and Dismiss. The room NPC 5427 has different actions. Pinball rewards now use 3/10 sapphire, 3/10 emerald, 3/10 ruby and 1/10 diamond, with the documented noted quantities.

### Remaining accuracy limits

The regenerated data still contains 165 assumed rarity rows and 12 quantity expressions without an executable numeric quantity. Five multi-herb distributions remain unresolved: hydra, colossal hydra, bloodthirsty hydra, butterfly ray and eagle ray. Those unresolved herb accesses do not award guessed replacements.

Thirty NPC IDs have alternative tables while the generic runtime currently chooses the first. Some location, quest, diary and account conditions are recorded in notes rather than executable rules; 230 original rows included quest requirement notes. Existing gameplay plugins own some such conditions, but ownership has not been proved for every row. Giant-key Wilderness doubling and Hill Giant location-specific variants require further work.

Current Wiki comparison found stale/assumed energy-potion entries on Goblin and standard human tables, including Man/Woman. Those cached-source rows were not silently replaced with invented probabilities. Correctness work remains for these source refreshes and conditional rules; do not describe all drop tables as exact current OSRS.

Sources: [Drop table](https://oldschool.runescape.wiki/w/Drop_table), [Aberrant spectre](https://oldschool.runescape.wiki/w/Aberrant_spectre), [Chaos druid](https://oldschool.runescape.wiki/w/Chaos_druid), [Skeletal Wyvern](https://oldschool.runescape.wiki/w/Skeletal_wyvern), [Pinball](https://oldschool.runescape.wiki/w/Pinball), [Flippa dialogue](https://oldschool.runescape.wiki/w/Transcript:Flippa), [Goblin](https://oldschool.runescape.wiki/w/Goblin), [Energy potion](https://oldschool.runescape.wiki/w/Energy_potion).

`server/plugins/npcs/NpcDrops.plugin.js` rolls an NPC's drops from three files in `server/data/definitions/`:

| File | What | Made by |
| --- | --- | --- |
| `npc-drops.json` | every drop table, and which NPC ids roll which tables | generated |
| `npc-drop-subtables.json` | the shared tables (rare drop table, gems, herbs, seeds, talismans…) | generated |
| `npc-drop-overrides.json` | hand edits on top of the two | by hand |

Corrections that need logic (Zulrah's two rolls, the Mad Angel's supply batch, Skotizo's shard roll, Amoxliatl's two rolls with one frozen tear roll, the animated bronze armour, the brimstone and Larran's keys taken off every table because `Keys.Slayer.js` drops them) stay in code, in `applyWikiCorrections`.

Loot that depends on where or what the NPC was rather than its table is added by other plugins on `npc-drops:add` { player, npc, npcId, drops }, emitted straight after the roll and before `npc-drops:roll` (so the Collection Log and Ironman rules see it): the Catacombs of Kourend's totem pieces and shards, and Skotizo's totem table ([skotizo.md](skotizo.md)).

Tertiary drops can be made likelier per kill on `npc-drops:tertiary-chance` { player, npc, npcId, rules }, emitted once per kill before the tertiary rolls (only when the table has any): a listener pushes `{ pattern, multiplier }`, and each entry whose name matches is that many times as likely. An imbued ring of wealth adds ×2 for clue scrolls in the Wilderness; Mortimer's clue tasks add theirs ([slayer.md](slayer.md)).

## Regenerating

The two generated files come from the OSRS Wiki's drop tables, through osrsreboxed-db:

```sh
cd ../osrsreboxed-db
python -m scripts.drops.update          # writes docs/drops-json/
cp docs/drops-json/npc-drops.json ../tsps/server/data/definitions/npc-drops.json
cp docs/drops-json/subtables.json ../tsps/server/data/definitions/npc-drop-subtables.json
```

- **Never edit generated files by hand or add a downstream repair override.** Fix the canonical source/parser/exporter in `../osrsreboxed-db`, add a regression check, regenerate twice from identical inputs and compare before importing. The override file described below is existing historical configuration, not the repair workflow.
- **The drop dumper reads monster pages** already fetched by the monster updater (`scripts.monsters.update`), and takes NPC ids from osrsreboxed-db's monster database. A monster that's new since the last monster update gets no table until that runs.
- **Noted drops:** the dump marks entries the Wiki shows as "(noted)" (`noted: true`), which needs osrsreboxed-db's `fix/drops-noted` branch until it's merged.

## The overrides

`npc-drop-overrides.json` is applied when the drops load. Where the dump already has an NPC or a shared table, the dump's wins, so an override the dumper catches up with becomes a no-op. `tests/npc-drop-overrides.test.cjs` fails when an override is no longer needed, so it can be removed.

| Section | Does | Now |
| --- | --- | --- |
| `removeNpcs` | NPC ids that drop nothing themselves | the Ents (6594, 7234, 9474): their trunk gives the loot |
| `addNpcs` | NPC ids mapped to a table the dumper doesn't map them to | 110 variants and versions (Phosani's Nightmare, the Nightmare, Ghast, Kalphite Guardian, Slagilith…), added by hand in September |
| `tables.<id>.addEntries` / `addTertiary` | entries added to a table | the Abyssal Sire's pet, the Abyssal orphan |
| `tables.<id>.removeSections` | sections of a table left out of every roll | Yama's Contract section (what his contracts reward, not a normal kill) |
| `subtables` | shared tables the dumper doesn't export | the uncommon seed table (Obor, Bryophyta) |

## The 2026-10-07 refresh

The generated files were replaced by osrsreboxed-db's 2026-10-07 dump, with the earlier hand edits moved into the overrides. Loading both the old and the new files and comparing every NPC's tables showed:
- **The same 3,201 NPCs** have drops, and the shared tables are identical.
- **One NPC changed:** the Sailing manta ray (15221) rolled both the monster and the Sailing manta ray tables on every kill. It now rolls only the Sailing one.
- **Noted drops: 120 → 3,068.** Everything the Wiki marks noted now drops noted, not just the hand-picked lists (Corp's resource drops were one). The Kalphite Queen's and the Mad Angel's noted lists in code are now redundant but harmless.
