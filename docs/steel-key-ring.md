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

The frozen shared decoded export of historical RSProx recording **3792**, revision
**235.1**, is **53,593,160 bytes / 381,359 LF-terminated physical lines**, SHA-256
`5371f4a98594793c6916ad1fdc41fc4b9c9c44b3800eec3248d5a090e9cf3f57`.
In that exact export, lines **370633–370659** show inventory op 2 on ring 4446 at
**tick 14812**, then interface 127, Brass key/name component 10, description 11,
models, script 861 `[983,-1,1590,6]` and component 1 children 0–2 at **tick 14813**;
the interface closes at **tick 14816** (line 370681). These ticks and packet fields
are the stable event locators. This establishes a populated Check-keys interface,
not the complete storage/loss contract or current-revision proof.

The maintainer reports another decoded export, `rsprox_transcripts/235/03792.txt`,
with **467,320 lines**, SHA-256
`4b5632309326de5d6f9f5d7c63af2bcdba495dcff3613ce69a9156bcbdc48627`,
and the same events at **456816–456850**. That is an externally reported alternate
export, not the bytes inspected here; the original line/hash pair must not be
applied to it. Capture date and decoder build are unknown for these exports.

The inspected shared export of recording **1702**, revision **226.1**, is
**24,281,417 bytes / 179,520 LF-terminated physical lines**, SHA-256
`523b81e49a7d8850977ce4a8245bad200d792e06ec3e812d12a92b99959f4caa`.
At **ticks 1635–1650**, script 861 identifies the selected key while name/description
updates record these pairs (physical lines are specific to this export):

| Key ID | UI name | UI description | Lines |
| --- | --- | --- | --- |
| 983 | Brass key | Allows access to Edgeville dungeon. | 26956–26957 |
| 1590 | Dusty key | Opens door in Taverley dungeon. | 27032–27033 |
| 2887 | Battered key | Elemental workshop key. | 27062–27063 |
| 1542 | Maze key | Allows access to Melzar's maze. | 27085–27086 |
| 4077 | Crystal mine key | Crystal mine key. | 27107–27108 |
| 6792 | Key | Key to the Spirits of the Elid cave. | 27135–27136 |
| 6754 | Key | Key to find hidden treasure! | 27158–27159 |

The ancestral key's highlighted model is **10216** (line 27134); the other six
observed keys use **5623**. The interface uses those recorded overrides while
add/remove chat keeps each cache item's name. This is decoded presentation evidence,
not proof of rendering on the active client.

The [pinned revision 242 interface](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/interface/favour_keyring.if3)
and [script 861](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/script/%5Bclientscript%2Cscript861%5D.cs2)
name the count component and implement native selection/removal. Scripts 862/864 send
RESUME_PAUSEBUTTON on the hidden buttons; they do not send a direct Remove widget op.
The implementation uses the cache's item models and named components. Descriptions for the six unobserved keys, insertion ordering, empty-state wording and
refusal wording remain TSPS presentation choices, not claimed verbatim retail observations.
The unobserved keys retain the existing highlight default; their retail highlights are unproved.

Existing access owners are integrated narrowly: brass/dusty doors, Elemental Workshop's
wall, Phoenix weapon store, Melzar's Maze, Haunted Mine, Spirits of the Elid, Tourist Trap's
camp gate and Shilo's carved doors. Existing new/shiny/wrought-key content has no equivalent
physical-key access predicate to replace; this change does not invent missing doors or the
Enchanted Key miniquest. Each of these thirteen keys can still be stored and removed.
Making History's existing silver-merchant replacement checks ownership of a stored key
with a genuine carried or banked ring at both the dialogue offer and purchase commit;
the canonical ring-specific conversation is enabled. Bank search results and stale
contents without a ring are not ownership. Its existing Feel/Dig/chest operations
still require the physical Enchanted key: remove it from the ring first. This does
not implement the separate Enchanted Key miniquest. Velrak, the slashed-book recovery
and ancestral ground respawn also recognize stored ownership; their existing rules
for physical bank copies are unchanged. Brass and weapon-store door messages prefer
a carried physical key when both forms are present.

The original nine cases in `tests/steel-key-ring-native.test.cjs` exercise decoded
inventory/use/pause-button inputs through ClientConnection and World, with supplied
quest completion, materials and placement. They cover empty/nonempty state, all thirteen
keys, conservation/refusals, stale callbacks, JSON save/load, drop loss/banked duplicates,
death item processing and the brass/weapon-store routes. Two additional cases invoke
existing merchant condition/action and free-recovery producers with supplied quest
states; these are not complete dialogue or decoded-packet route tests. The fixture
does not establish natural quest traversal or client rendering.

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


## Maintainer correction verification

Review [5881707962](https://github.com/RSPSApp/tsps/pull/4786#pullrequestreview-5881707962)
identified the ambiguous decoded-export citation, recorded interface text and the
Making History paid-replacement side effect. Correction source
`b8899ce3c37ef1fd4150065d85eacacfca565b37` contains the fixes described above, including
the free-recovery and physical-message-priority nits. The same Linux/Node/Yarn/native
and cache preparation, build and ensure-cache commands above were used again. This
focused run did not regenerate documentation or replay the old baseline/Tourist suites.
Its literal test command arguments were:

```sh
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/steel-key-ring-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/taverley-dungeon.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/making-history-dron-wrong-answers.test.cjs
```

The run completed on 2026-11-12 at **21:07:23.317 UTC**: native fixture **11/11**,
existing Taverley **6/6**, existing Making History Dron **1/1**, all exit 0. The two
new producer matrices check carried/banked stored ownership, absent/physical/banked
physical keys, search/zero placeholders, stale contents, delayed purchase ownership,
coin/key conservation, refusal guards, and recovery after actual loss. The original
cases also check the seven recorded UI pairs/highlights, cache-named chat and physical
message priority. This is eighteen checks across three scopes, not eighteen full native
routes or a complete merchant/quest playthrough.

All **8512 original source paths**, compiled output and **28 cache files** retained
their identities (`sealsValid=true`, `sealsUnchanged=true`, no declared output).
The raw output has no engine/plugin-hook errors; normal SQLite experimental warnings,
a slow-task diagnostic and expected Pets drop logs remain. Process-group and terminal
receipts do not prove the absence of escaped descendants. The earlier failed and
qualified runs remain disclosed in the PR; this correction does not make them green.
A later update to this authored document adds the result record only; it does not
change the tested production/native fixture or the exact generated configuration doc.
