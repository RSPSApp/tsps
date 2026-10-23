# Reward table provenance

`reward-tables.json` is the complete, unmodified output of
`python -m scripts.drops.update` from the canonical osrsreboxed-db exporter at
commit `08b40d3e`. Its SHA256 is
`1738067712a74559967873322e030a9730ebd9b20be1000f0ed7c28a68027774`.
Two exports from the same cached inputs matched byte for byte; ordinary NPC,
subtable and unresolved-item exports did not change.

Source: Old School RuneScape Wiki contributors, including
[The Mimic](https://oldschool.runescape.wiki/w/The_Mimic), CC BY-NC-SA 3.0.
Tables have no NPC bindings. They require explicit domain consumers; quest and
contract rewards must never be treated as ordinary monster drops.

The Mimic elite and master variants each contain31 resolved rows. Other reward
variants and explicitly reported unparsed pages are retained as exporter output;
their presence does not mean their content is implemented. Never hand-edit this
file: repair the canonical source/parser, regenerate twice and review the import.
