# The Enchanted Key

After [Making History](https://oldschool.runescape.wiki/w/Making_History), the physical
[enchanted key](https://oldschool.runescape.wiki/w/Enchanted_key_(miniquest)) leads to
eleven treasures. Rellekka comes first; the remaining ten sites are shuffled once.
The saved route and found count survive JSON save/load and replacement of a lost key.
Corrupt progressed routes fail closed rather than being rerolled.

Feel reports Chebyshev distance and whether the player has moved closer or farther
since the previous Feel. That comparison resets on treasure discovery and login.
Digging requires the physical key, ground level and a position within four squares
of the current target, including diagonals. A key stored in the steel key ring must
be removed before use. Each site awards its full item batch once, including the three
mjolnirs across the route. The last treasure consumes the key, completes the route,
and opens the native key objectbox with its dissolution message and continuation.

Inventory planning checks the whole reward batch, stack limits and the space freed
by the final key before committing anything. A failed capacity check preserves the
key, rewards, progress and previous distance comparison. The silver merchant's
500-coin replacement rechecks completion, key ownership, space and coins at payment.
Losing an earned steel key ring does not block buying a replacement enchanted key;
a key still owned in a carried or banked ring does block duplicate replacement.

## Sources and identifiers

The Wiki supplies site coordinates, order, distance bands and the dig radius.
The inspected decoded recording **1702**, revision **226.1**, is **24,281,417 bytes**,
SHA-256 `523b81e49a7d8850977ce4a8245bad200d792e06ec3e812d12a92b99959f4caa`.
Independent inventory replay supports all eleven reward multisets, the physical
noted awards 441/448/7937 and final key removal. The observed site-associated masks
come from unsigned extraction of backing varp 604 bits 21–31; other bits are preserved.
Runtime assertions on the selected revision-242 cache verify varbit 1391 as
`[604,21,31]`, varbit 13717 as `[3403,8,9]`, and canonical note/unNote/stackability
for 440→441, 447→448 and 7936→7937. This is runtime assertion evidence, not an
independently published cache dump.

Five observed Feel sound policies are implemented with one loop and zero delay:
cold 1198, burning 1197, warm 1202, steaming 1201 and freezing 1199.
**Hot, very hot and very cold tones remain silent:** their category assignments
were not established by the inspected evidence. No generated osrsreboxed data changes.

## Verification

Corrected executable source `36fb91045229fa62a2b3bc62496ba293c197f811` passed
**65/65** on Linux x64, Node **22.17.0**, Yarn **4.12.0**, with cache
`osrs-242_2026-11-03` (OpenRS2 **2757**). The supplied setup uses the Linux x64
`node-datachannel` **0.32.1** native release; its archive SHA-256 is
`1a31d28a7aec9c1538cb96b76260d062399715b4dcea0ff3a0ebd6f58df5e391`.
Install the repository's server dependencies and matching native shared libraries
before building. The run used an immutable dependency install, checked the native
binary and its library/load results, built the server, and checked the pinned cache.
From `server/`, the build/cache commands and literal test invocations were:

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=4096 node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/ensure-cache.ts
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/steel-key-ring-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q071.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/making-history-dron-wrong-answers.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/spade-dig-nothing-found.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q094.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/quest-rewards-full-inventory.test.cjs
```

Each test file ran in a fresh Node process, without a name filter. Observed results:

| File | Passed / tests | Layer |
| --- | --- | --- |
| `steel-key-ring-native.test.cjs` | 18 / 18 | Native key/ring inputs and producers |
| `qh728-q071.test.cjs` | 18 / 18 | Making History source contracts |
| `making-history-dron-wrong-answers.test.cjs` | 1 / 1 | Dron dialogue regression |
| `spade-dig-nothing-found.test.cjs` | 2 / 2 | Native Spade dispatch/fallback |
| `qh728-q094.test.cjs` | 21 / 21 | Recipe for Disaster contracts; OSF prerequisite registration and player doubles |
| `quest-rewards-full-inventory.test.cjs` | 5 / 5 | Real-engine quest reward capacity |

All six TAP summaries reported zero failures, skips, cancellations and todos.
All twelve named stages exited zero without a reported timeout or leftover process
group. The provider separately reached **COMPLETED**, retry **0**. Source (8,784
files), compiled output (749 files) and all 28 cache seals remained unchanged.
The retained whole actual input SHA map contains 5,689 entries and matches the
pinned manifest. These are content and named-process-group checks; they do not
establish global process absence or escaped-descendant closure. The runtime's
`TESTS_PASS_AWAIT_SANDBOX_TERMINAL` line remains unchanged; the separate terminal
receipt supplies the provider result.

The native fixture supplies quest completion, items and positions, then exercises
actual ClientConnection/World item packets, cache definitions, inventory and JSON
hydration with login hooks. One generated fixed-first permutation visits all eleven
sites, checking exact reward deltas, the three mjolnirs, once-only rewards, final key
removal, native objectbox item/text/Continue packets and ordinary continuation,
wire state, capacity/stack-limit retries, resets and physical-versus-stored ownership.
It also exercises actual One Small Favour reward and early-ring producers, lost-ring
replacement, payment and persisted-receipt cases. Merchant conditions and paid grants
are invoked directly as existing producers. The synthetic competing Dig handler
checks dispatch coexistence, not native Zombie Head retrieval.

This does not cover every permutation, natural travel, a complete parent quest or
merchant conversation, durable disk login, rendered clients or Windows equivalence.
The 18 Making History and 21 Recipe for Disaster checks are contracts, not 39 full
quest routes or 21 native One Small Favour routes.

### Causal correction baseline

The same corrected native fixture on original production source
`7176521d07eab1becbff7d69c1b1635238c37bf4` ran all 18 checks: **15 passed, 3 failed**,
with zero skips or cancellations. The intended failures were ordinary dissolution
chat instead of the final objectbox, refusal to replace a key after losing an earned
ring, and replacement blocked after loading an early-ring receipt. Preconditions and
the preceding controls passed. Assertions after each failed target were unreached;
the final-box continuation/post-loop checks, later purchase/debit/relogin checks and
later early-receipt inventory branch were not observations from that baseline.
Build, cache, unchanged content seals and seven named process-group checks passed.
Provider **ERROR70**, retry **0**, and the strict nonzero/unclassified payload result
remain preserved. The corrected 65/65 result does not erase that failure history.

### Earlier feature evidence

The original feature source `2fa8100a884e85dce2ac974c4a630fb5418b7895` passed
37/37 (18 native key/ring, 18 Making History contracts and one Dron regression).
That run applies to its original source, before these PR-review corrections.

The fixture-only baseline `3cd9d845dabda02e5fb4f5e33d29f6ee32841401` actually ran
18 tests: **11 passed, 7 failed, 0 skipped**, exiting nonzero (provider ERROR70).
All eleven existing controls passed; the first new test reached its intended
completed-quest, physical-key Feel assertion and received no message instead of
steaming feedback. The intended isolation failed: Node 22.17 recursively matches
parent test names, and the reviewed negative filter matched its implicit `<root>`.
Six additional feature-dependent tests therefore ran and failed. This supports
bounded absence of the postquest Feel feature; it is not a clean one-failure baseline.
Cache/note and full-route assertions after that first assertion were unreached there.
The baseline result and filter remain unchanged; no count-correction rerun was made.
