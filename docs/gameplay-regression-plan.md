# Gameplay regression repair plan

1. Trace Goblin mail's cache Wear action and equipment metadata through the existing equipment guards. Add a regression showing that humanoid players cannot equip it, then repair the canonical equipment/action interpretation without an item-specific override.
2. Inspect the original Lumbridge Guide Wiki dialogue and existing quest/item recovery hooks. Test ineligible, already-owned, eligible and full-inventory players; enforce the actual Temple of the Eye recovery conditions at the owning gameplay hook.
3. Inspect Gillie Groats' original Wiki structure and dialogue parser output. Add a parser regression for the source structure, repair the canonical parser, regenerate twice to establish determinism, and import only relevant generated exports.
4. Build and run affected server/parser tests; verify native behavior only on the isolated slot6 world if feasible. Commit source/tests/generated output with source URLs and disclose regeneration differences. Do not touch the user's running world, root runtime or client.

## Diagnosis and implementation

- Goblin mail's cache entries have Wear and body slot 4 so metadata is correct. The missing rule was conditional gameplay eligibility. `GoblinMail` guards the whole armour family using cache varbit 13612 (`lotg_player_is_a_goblin`). Bootstrap and equipment changes safely unequip legacy human-form mail only when the inventory has room; a full inventory keeps the item and gives a message. The normal equipment code performs the move.
- The Guide transcript has no default. The generic fallback selected its first standard variant, which is explicitly for a lost amulet. Its unbound space condition then selected the refusal branch. A normal Guide selector now works in F2P as well; the members' GOTR unit answers its custom status event. Recovery requires Temple of the Eye completion, the actual amulet unlock (`gotr_amulet_of_the_eye_obtained`, cache varbit 13809), and absence of every amulet colour from inventory, equipment and bank. It rechecks eligibility and capacity at the handout. An inspected locket can be exchanged through the existing Wiki transcript to establish the persisted unlock; finding a locket alone (13808) does not unlock recovery.
- Gillie's original Wiki `topt` argument contains a `Player:` speaker prefix. The canonical dialogue parser now removes that explicit prefix from choice labels. The generated Gillie menu now reads "I'm fine, thanks." The same normalization lets the source compactor attach the matching player line in The Ides of Milk menu. Those are the only changed records in the imported aggregate.

## Evidence and sources

- [Goblin mail](https://oldschool.runescape.wiki/w/Goblin_mail): human-form refusal and the legitimate quest goblin transformation.
- [Amulet of the eye](https://oldschool.runescape.wiki/w/Amulet_of_the_eye), [Tarnished locket](https://oldschool.runescape.wiki/w/Tarnished_locket), and [Unlockable content](https://oldschool.runescape.wiki/w/Unlockable_content): inspect/exchange unlock, prerequisite quest and lost-item recovery.
- Original cached Wiki revisions in `osrsreboxed-db/data/dialogues/wiki-pages.json`: `Transcript:Lumbridge Guide` and `Transcript:Gillie Groats`. The repair changes the canonical parser and regenerates exports; no imported JSON was edited manually.
- Two full offline regenerations produced SHA-256 `99E1C97AF157B11CAD566C11462D1B905312D7A3ECAECEFF7FA3308320920EF9` for `npc-dialogues.json`. The 107 affected canonical parser/export/schema regressions passed.
- Server build and 282 affected server tests passed. Isolated slot6 MCP verification showed human mail Wear refused with the item still in inventory, an ineligible Guide's normal menu without a recovery offer, and Gillie's corrected three options. Root runtime, client and the user's running world were untouched.

The imported minified aggregate is byte-identical to the canonical regenerated `docs/npc-dialogues-minified.json` (SHA-256 `0E9C822A0FC79119D2824A0E750C817509267FCE7EEA659D2D3456976D7D9FB4`). Canonical parser/export commit: `3cd9479931da7b40c0078b12e90139a1757a34eb`. Native slot6 also exercised the full legitimate locket exchange, persisted flags 13809/13811, full-inventory recovery refusal, successful recovery with space, and the owned-amulet return to the normal Guide menu. Its test world and client were stopped cleanly.
