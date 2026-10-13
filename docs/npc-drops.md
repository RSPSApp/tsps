# NPC drops

`server/plugins/npcs/NpcDrops.plugin.js` rolls an NPC's drops from three files in `server/data/definitions/`:

| File | What | Made by |
| --- | --- | --- |
| `npc-drops.json` | every drop table, and which NPC ids roll which tables | generated |
| `npc-drop-subtables.json` | the shared tables (rare drop table, gems, herbs, seeds, talismans…) | generated |
| `npc-drop-overrides.json` | hand edits on top of the two | by hand |

Corrections that need logic (Zulrah's two rolls, the Mad Angel's supply batch, the animated bronze armour) stay in code, in `applyWikiCorrections`.

## Regenerating

The two generated files come from the OSRS Wiki's drop tables, through osrsreboxed-db:

```sh
cd ../osrsreboxed-db
python -m scripts.drops.update          # writes docs/drops-json/
cp docs/drops-json/npc-drops.json ../tsps/server/data/definitions/npc-drops.json
cp docs/drops-json/subtables.json ../tsps/server/data/definitions/npc-drop-subtables.json
```

- **Never edit the generated files by hand:** the next dump overwrites them. Put the change in `npc-drop-overrides.json` instead.
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
