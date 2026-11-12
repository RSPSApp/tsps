# Steel key ring

[Steel key ring](https://oldschool.runescape.wiki/w/Steel_key_ring) documents the thirteen
eligible reusable keys, adding with Use, native Check-keys/removal, and use without removing
keys. The count belongs to that interface, rather than a hardcoded empty chat response.
The stored list is shared by the player's copies and persisted as `steel-key-ring:keys`.
Only a carried ring provides a key to an existing access check. Physical quest handovers,
trades and consuming-key mechanics continue to require physical items.

Eligibility is explicit: ancestral, battered, Shilo Village bone (605, not Ghosts Ahoy's
4272), brass, crystal-mine, dusty, enchanted, maze, metal, new, shiny, weapon store and
wrought iron keys. Duplicates and items carrying metadata are retained. Removing a key
requires inventory space and the currently open ring interface; losing a ring clears
its keys unless another copy is banked. Death keeps the ring and its contents.

The incorrect `dropable:false` legacy definition for 4446 overrode the cache's Drop.
Its canonical field is corrected in `item-gameplay.json`: this is server-owned legacy data,
explicitly **not** an osrsreboxed-db import (`rune-packs-and-stray-dogs.md`, source notes).
The existing drop warning and `item:discarded` route own confirmation and completed loss.
Generated dialogue, item alchemy, shops and other osrsreboxed outputs are unchanged.

## Evidence and boundaries

Historical RSProx recording **3792**, revision **235.1**, transcript SHA-256
`5371f4a98594793c6916ad1fdc41fc4b9c9c44b3800eec3248d5a090e9cf3f57`,
lines **370633–370659**, shows inventory op 2 on ring 4446 followed by interface 127,
Brass key/name component 10, description 11, models, script 861 `[983,-1,1590,6]`,
and pause-button events for component 1 children 0–2. This establishes a populated
Check-keys interface with a count, not the complete storage/loss contract. Capture date
and supplied decoder build are unknown; this historical interval is not current-revision proof.

The [pinned revision 242 interface](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/interface/favour_keyring.if3)
and [script 861](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/script/%5Bclientscript%2Cscript861%5D.cs2)
name the count component and implement native selection/removal. Scripts 862/864 send
RESUME_PAUSEBUTTON on the hidden buttons; they do not send a direct Remove widget op.
The implementation uses the cache's item models and named components. Key descriptions
other than the observed brass line, insertion ordering, empty-state wording and refusal
wording are TSPS presentation choices, not claimed verbatim retail observations.

Existing access owners are integrated narrowly: brass/dusty doors, Elemental Workshop's
wall, Phoenix weapon store, Melzar's Maze, Haunted Mine, Spirits of the Elid, Tourist Trap's
camp gate and Shilo's carved doors. Existing new/shiny/wrought-key content has no equivalent
physical-key access predicate to replace; this change does not invent missing doors or the
Enchanted Key miniquest. Each of these thirteen keys can still be stored and removed.

`node --test --test-concurrency=1 tests/steel-key-ring-native.test.cjs` (after the normal
server build and cache preparation) exercises decoded inventory/use/pause-button inputs
through ClientConnection and World, with supplied quest completion, materials and placement.
It checks empty/nonempty state, all thirteen keys, conservation/refusals, stale callbacks,
JSON save/load, drop loss/banked duplicates and the existing brass door. This fixture does
not establish natural quest traversal or client rendering. Runtime results are recorded
separately; source and fixture existence alone is not a passing test claim.
