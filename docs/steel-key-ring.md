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

Drop remains owned by the cache's inventory action. The legacy `item-gameplay.json`
row says `dropable:false`, but the current loader does not import that property, so it
already drops correctly. The existing warning and `item:discarded` route own confirmation
and completed loss. No legacy item data or generated osrsreboxed output is changed.

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

## Reproducing the verification

The validated runtime was Linux x64/glibc, Node **v22.17.0** in `node@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0`. Preparation used the packageManager-pinned Yarn **4.12.0**, `install --immutable --mode=skip-build`, and the [node-datachannel 0.32.1 NAPI-v8 Linux-x64 archive](https://github.com/murat-dogan/node-datachannel/releases/download/v0.32.1/node-datachannel-v0.32.1-napi-v8-linux-x64.tar.gz): archive SHA-256 `1a31d28a7aec9c1538cb96b76260d062399715b4dcea0ff3a0ebd6f58df5e391`, exact member `build/Release/node_datachannel.node`, binary SHA-256 `98ad24d9b992a7974628b339ce81dfe159ca8d255459da5531dfcd7be659af06`. Native `ldd`/load checks passed. The [public preparation recipe in PR #4732](https://github.com/RSPSApp/tsps/pull/4732) supplies equivalent shell download/hash/extraction steps, requiring `curl`, `tar`, `sha256sum`, `ldd` and network access to Yarn/GitHub/OpenRS2. Those shell preparation instructions are equivalent reproduction steps, not this executor's literal command history.

Cache target: `osrs-242_2026-11-03`, OpenRS2 2757; all 28 cache files were checked.
After the preparation above, these were the actual command arguments from `server/`:

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=4096 node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/ensure-cache.ts
node node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/world-config-docs.ts
node node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/world-config-docs.ts
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/steel-key-ring-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/world-config-docs.test.cjs
```

At source `c1bd369b5e7da21208e7f767dd2924c7bf275fee`, the corrected native fixture passed 9/9 and the configuration checks passed 4/4. Both document generations matched; the exact generated document SHA-256 is `8058a78dd940172c4a08fecd88eeb4caef8912ede336d7b735091c98c4e3e92f`. Only that declared generated document changed during the run; all other source, compiled output and cache identities were preserved. These are separate native and documentation checks, not a full repository suite. The PR retains the earlier failed/diagnostically qualified runs and the unrelated Tourist Trap fixture failures.
