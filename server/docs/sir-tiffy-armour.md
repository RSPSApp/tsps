# Sir Tiffy armour access

After Recruitment Drive, talk to Sir Tiffy Cashien in Falador Park and choose
**Can I buy some armour?**. The existing Initiate Temple Knight Armoury sells
an initiate sallet for 6,000 coins, hauberk for 10,000 and cuisse for 8,000.
Stock, prices and the Recruitment Drive shop gate remain existing data/runtime behavior.

Quest-specific dialogue retains priority: Wanted jobs and active quest topics,
Slug Menace mission/Commorb topics and completed-quest Proselyte access, and the
Devious Minds hand-in. Existing armour and Something else choices return through
canonical dialogue branches rather than opening a shop directly.

## Reproduce the checks

Observed platform: Linux x64/glibc, Node **22.17.0**, image
`node@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0`.
Use verified Yarn **4.12.0**, immutable dependencies with scripts skipped, and
node-datachannel **0.32.1** with its validated Linux x64 native binary and shared
libraries. The public [dependency/native preparation recipe](https://github.com/RSPSApp/tsps/pull/4732)
uses the same pinned Yarn/native inputs as these runs. Its shell download recipe
is equivalent reproduction preparation; the actual executor downloaded and
validated the inputs with Node. It is not a claim we ran the shell recipe.

From `server`, these are the actual build/cache arguments used in both runs.
Network access to OpenRS2 is needed for cache preparation. `server/target.txt`
selects `osrs-242_2026-11-03`; retained actual cache metadata identified **2757**,
with all 28 files sealed. Check that `caches/osrs-242_2026-11-03/info.json` reports
id2757 before comparing results; another cache is not the validated input.

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=4096 node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/ensure-cache.ts
```

Actual test arguments at `10825bda10c8429d0b8afa0a84cbca24b4187469` (each file
runs in its own process; the later qh123 failure stopped that run):

```sh
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/sir-tiffy-armour-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/wanted-commorb-full-inventory.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q123.test.cjs
```

Actual test arguments at `a23525102c27349bc75c6a26cb4497e917c07c65` (five files,
separate processes; the final broad file failed):

```sh
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q123.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q106.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q022.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/quest-shops.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/quest-plugins.test.cjs
```

The observed executor also set `DISABLE_PLAYER_BOTS=1`,
`NODE_DISABLE_COMPILE_CACHE=1`, `CI=1`, `LANG=C.UTF-8`, `TZ=UTC`,
`YARN_ENABLE_SCRIPTS=false` and `npm_config_ignore_scripts=true`. For equivalent
shell reproduction, export those settings before preparation/build/tests. The
native fixture itself disables player bots. Commands above are matched to their
historical sources, not a claim that the documentation-only head was executed.

The native fixture uses registered World actors and decoded in-memory
ClientConnection inputs, with supplied quest states, prerequisites, materials and
nearby placement. It checks actual active shop/interface, all three paid purchases,
exact coin/item/depleted-stock changes at the real purchase event, natural restock,
repeat purchase, insufficient funds/full inventory conservation, precompletion
access refusal, one-time Recruitment Drive reward and shared quest ownership.
It does not prove natural full-quest traversal, socket transport, client rendering
or retail timing. Other files use mixed/core/cache/source-contract harnesses.

## Observed results and limits

At `10825bda10c8429d0b8afa0a84cbca24b4187469`, native **14/14** and Wanted
inventory **2/2** passed. That run ended ERROR70 because the old qh123 harness
failed 2/14; four later files were unreached. Its dropped before-hook and obsolete
Mage-menu assumptions were repaired without changing Mage production code.

At `a23525102c27349bc75c6a26cb4497e917c07c65`, the five complete files returned:
qh123 **14/14**, qh106 **23/23**, qh022 **15/15**, quest-shops **9/9**, and
quest-plugins **435/453**. The run ended **ERROR70**, with 18 broad-suite failures.
Production and the native/Wanted inventory fixtures are byte-identical to 10825;
the earlier native evidence is reused, not a second native run or one green suite.

The broad failures are DT2 Whisperer case140 (stand-in player lacks
`getDialogueManager`) and 17 RFD journal cases437–453 failing their first expected
journal/overview-interface assertion. Later assertions in those cases were
unreached. The exact RFD mechanism is unproven. Those tests/providers and associated
journal runtime are unchanged from base `1b3135a3d2a8a07058f3efba8fce89539caaacd1`;
source review establishes independence from the guarded Tiffy changes. This is
source-qualified inheritance, not our executed base comparison. An external
[maintainer report on the same base](https://github.com/RSPSApp/tsps/pull/4732#pullrequestreview-5878790970)
separately reported the same 435/453 distribution.

The meaningful BEFORE at `173c8bcef26ee65d368a07c2ea465e762d01df4d` reached
ordinary NPC admission/greeting but no armour menu, and the Wanted-eligible menu
contained only jobs/goodbye. It ended 5/14 PASS, ERROR70; failed purchase/refusal
tails were unreached. Earlier BEFORE002 ended 1/14 with 13 actor-setup failures,
not a gameplay baseline. Intermediate verification005 ended qh123 13/14,
ERROR70, before the fixture selected the actual Solus menu; payment/reconnect
assertions there were unreached. Subsequent passes do not rewrite those failures.

Behavior sources: [Initiate Temple Knight Armoury](https://oldschool.runescape.wiki/w/Initiate_Temple_Knight_Armoury)
and [Sir Tiffy Cashien](https://oldschool.runescape.wiki/w/Sir_Tiffy_Cashien),
existing canonical dialogue/stock and actual cache IDs/prices. No generated JSON
was modified. The three-piece scope does not add unrelated quest content.
