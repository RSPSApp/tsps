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
mjolnirs across the route. The last treasure consumes the key and completes the route.

Inventory planning checks the whole reward batch, stack limits and the space freed
by the final key before committing anything. A failed capacity check preserves the
key, rewards, progress and previous distance comparison. The silver merchant's
500-coin replacement rechecks eligibility at payment, including completion and
missing earned-ring recovery. Ring entitlement comes from completed One Small Favour
or an actually successful early ring grant, never stale stored-key contents.

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

Implemented source `2fa8100a884e85dce2ac974c4a630fb5418b7895` passed **37/37**
on Linux x64, Node **22.17.0**, with cache `osrs-242_2026-11-03` (OpenRS2 2757).
The run built the server and used these literal test arguments from `server/`,
without a name filter:

```sh
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/steel-key-ring-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/qh728-q071.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/making-history-dron-wrong-answers.test.cjs
```

The native fixture passed 18/18, parent-quest source-contract controls 18/18 and
the Dron dialogue regression 1/1, with no failures, skips, cancellations or todos.
All nine stages exited zero; source (8783 files), compiled output (749) and cache
(28) seals remained unchanged. Named stage process groups had no reported timeout
or leftover group; the provider independently reached COMPLETED without retry.
These boundaries do not establish global process absence or escaped-descendant closure.

The fixture supplies quest completion, items and positions, then exercises actual
ClientConnection/World item packets, cache definitions, inventory and JSON hydration
with login hooks. One generated fixed-first permutation traverses all eleven sites,
checking exact reward deltas, all three mjolnirs, once-only rewards, final key removal,
wire state, capacity/stack-limit retries, resets and physical-versus-stored ownership.
Merchant conditions and paid grants are invoked directly as existing producers.
The synthetic competing Dig handler verifies dispatch coexistence; it does not
establish a native Zombie Head retrieval route. This is not every permutation,
natural travel, a complete parent-quest or merchant conversation, network login,
or rendered-client verification. The 18 parent-quest controls are source-contract
checks, not 18 full gameplay routes.

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
