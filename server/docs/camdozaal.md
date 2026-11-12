# Camdozaal activities

The activity plugin owns shard storage, Ramarno's Exchange, deposit crushing,
net fishing, fish preparation/offering and the timed vault. Below Ice Mountain
continues to own its quest, entrance and Ramarno introduction; Defender of Varrock
and Desert Treasure II retain their separate quest interactions.

## Rules and sources

Primary Wiki raw pages inspected for this work:

- [Sacred Forge](https://oldschool.runescape.wiki/w/Sacred_Forge?action=raw):
  carried shards enter personal storage without being consumed; Check/Empty.
- [Barronite deposit](https://oldschool.runescape.wiki/w/Barronite_deposit?action=raw):
  hammer, 14 Smithing, 30 XP; rewards determined when opened; duplicate relics
  allowed; broken Imcando hammer restricted to members. The page quotes Ash's
  conditional **1/15 when not receiving shards**; its overall rates are approximate.
- [Ramarno's Shard Exchange](https://oldschool.runescape.wiki/w/Ramarno%27s_Shard_Exchange?action=raw)
  and the individual charm pages: four 2,500-shard permanent buffs, 3,000-shard
  Luck, and 1,000-shard one-hour Boost. Boost expires in wall-clock time, including
  while logged out. The five/two/one-minute and expiry warnings use the published text.
- [Fishing spot (Camdozaal)](https://oldschool.runescape.wiki/w/Fishing_spot_(Camdozaal)?action=raw),
  raw guppy/cavefish/tetra/catfish, Preparation Table, and Altar (Camdozaal):
  nets, levels, XP, knife, preparation-only facilities, offerings and membership.
- [Camdozaal Vault](https://oldschool.runescape.wiki/w/Camdozaal_Vault?action=raw):
  750 **stored** shards, immediate 60-second timer, fixed-position changing-colour
  barriers, 1–5 simple/2–3 elaborate/all three ornate boxes, return to entrance,
  teleport refusal, energy restoration only on success, and loss only of this run's loot.
- [Simple](https://oldschool.runescape.wiki/w/Simple_lockbox?action=raw),
  [Elaborate](https://oldschool.runescape.wiki/w/Elaborate_lockbox?action=raw),
  [Ornate](https://oldschool.runescape.wiki/w/Ornate_lockbox?action=raw) lockboxes:
  quantities, notedness, roll counts and gear tables. Plugin-local data preserves
  the table rows. Simple/elaborate use the prose 2/50 and 4/50 gear gates and
  conditional standard weights (their standard row weights already sum to 50).
  Subsequent gear hits are conditioned on standard rewards. Ornate uses 6/50 gear
  and 44 standard weight. This resolves the source table inconsistency as a stated
  interpretation; it is not a measured reconstruction of retail's implementation.

Current cache 242 gamevals establish IDs, options, widgets and morphs. The accepted
native baseline observed the forge at 2956,5810 and its operational part at
2957,5811; vault door 2969,5824, face 2; and the fixed barrier/pedestal placements.
The neighbouring entry/exit floor tiles and barrier side mapping are implementation
choices requiring native checks, not facts established by the baseline placements.
Barrier varbits select the legal open morph in each cache group; uniform selection
within each group is an estimate.

Historical decoded RSProx recording 1636, revision 226.1, source SHA-256
`2c943b54a61a69ef5460cc0251f1b47987039b8a0642741fbfb59c29c726787c`,
lines 46217–46318, was inspected. It shows Ramarno's introductory discussion of
barronite, the vault and forge, plus dialogue packet order. It does not demonstrate
payment, loot, a vault route, current widget rendering or success probabilities.
The supplied decoder build is unknown. Capture 3432's inspected candidate context
provided no additional Camdozaal rule; that does not establish absence of behavior.

## Explicit probability estimates

The Wiki does not publish complete fishing success charts or the intermediate
preparation curve. Fishing uses an estimated interpolated chart; preparation uses
an estimated curve with the published no-ruin level boundaries. Nominal Fishing,
Mining and Preparation +10%, plus Boost +5%, are interpreted as percentage points.
Defence applies five invisible effective Defence levels against the ruins' golems;
Boost's additional 5% roll factor is estimated. No displayed skill level changes.
Luck uses the published inverse-denominator example (500 becomes 475); combining
Luck and Boost as a ten-percent denominator reduction is an explicit inference.
Fishing's three-shard common outcome uses an estimated 1/5 replacement weight;
the handle uses the published 1/512 base chance. Big-net catches reach the existing
clue-bottle producer with an estimated 100,000 base (the Wiki lists bottle tiers but
no complete base-rate chart); this is independent of the unknown Heron pet base.
Below each published no-ruin level, preparation retains at least a 1/256 ruin
chance, so the estimated additive curve cannot guarantee guppies at level 34/35
when the permanent buff's published boundary is 36.

Deposit rates are incomplete approximate observations, not an exhaustive normalized
table. Let `K = 1/200 + 5/350`. The implementation anchors the head and each relic's
marginal to those published estimates, scales them for Luck, and sets the member
nonshard pool to `K / (1 - 1/15)` before the conditional hammer roll. This preserves
that quoted conditional rule and avoids inflating head/relic rates by normalizing
an arbitrary five-percent pool. The resulting unbuffed member hammer marginal is
**27/19600, about 1/726**, materially below the separate quoted **about 1/300**.
That disagreement remains disclosed; no unlisted nonshard rewards are invented to
fill the missing mass. Large shards retain approximately 1/20 overall probability;
small shards take the remainder. Boundary tests verify this declared model, not
exact retail probabilities.

## Conservation and lifecycle

Crushing exchanges one nonstackable deposit for one reward before awarding 30 XP.
A full bag can receive a duplicate/new relic in the freed slot; an overflowing
existing shard stack refuses without consuming material or awarding XP. Exchange
payment uses carried shards first and then stored shards, while vault admission
uses stored shards alone. Permanent purchases cannot charge twice.

The vault uses an ordinary private Area over the cache map. Its per-player morphs,
loot and timer remain separate. New loot uses the cache's temporary lockbox IDs;
success converts it into permanent boxes, and failure removes only temporary IDs.
Overflow from opening a box follows the existing inventory `forceAdd` floor path.
Opening any carried box inside the vault is refused.

Cleanup does not choose a death/quest destination. Timeout and door exit deliberately
return to the entrance; logout still inside saves that entrance. An established
external destination survives AreaManager departure. The existing death-bones event
removes temporary loot before the native kept/dropped-item snapshot, and the died
event clears run state without changing death/drop/respawn authority. A persisted
return marker recovers interrupted saves on login. Boost deadlines are persisted
without extending them on login. The pre-existing members golem Area owns the
public ruins first; it publishes enter/process/leave events to the Boost module.
The standalone activity Area keeps the same direct processing as a free-to-play
fallback, preserving the golem Area's original departure restoration.

## Verification scope

The accepted test-only baseline at `58d49067896bab993448f6f9088b1e9e7390c43c`
ran against cache 242: geometry passed, and decoded ordinary shard-on-forge input
reached the intended storage assertion, failing with stored 0 rather than 1,000.
Its source/dist/cache seals were unchanged. This is meaningful feature absence,
not a green suite. Seeded completed quest/materials and reachable perimeter placement
are explicit; it does not prove natural quest traversal, raw socket input or rendering.

At tested revision `10ab60ddba8ce9166bde2c9c48cc7da2a11dc9ec`, the correction
supported Linux run completed with separate clean processes:

| File | Passed / total | Exit |
| --- | --- | --- |
| `camdozaal-native.test.cjs` | 27 / 27 | 0 |
| `fishing.test.cjs` | 16 / 16 | 0 |
| `cooking.test.cjs` | 53 / 53 | 0 |

Actual build/test commands, run from `server` after dependency/cache setup:

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/camdozaal-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/fishing.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/cooking.test.cjs
```

The Camdozaal suite includes decoded ordinary item/object/NPC/widget inputs,
carried/stored conservation, prices/repeat refusal, actual delayed activities,
all seven selected barrier groups in both directions, process99/process100
vault deadline, failure/success loot custody, actual death and external relocation,
native save/restore, real accuracy-formula and clue-bottle producers, inventory/floor
overflow, and the three existing quest authorities. Probability seams and reward
selection controls test the declared model, not retail distribution measurements.
The generic fishing/cooking suites contain both doubles and native portions;
their 69 cases are not all additional end-to-end native cases.

Two earlier AFTER attempts remain failed evidence. The first was 21/25: named-forge
target setup failed, two cases failed through the same unobserved Exchange helper,
and a null closed-barrier option list raised a fixture error. The second was 24/25:
forge operations, purchases and seven barrier groups passed, while a Talk-to page
assertion failed without identifying its loop branch in raw output. Subsequent
source qualification corrected an inconsistent workshop/introduction checkpoint;
it does not retroactively identify that failed branch. Both attempts stopped before
the generic suites. Their failures are retained rather than merged into the final
run's 96 passing results.

Final source/compiled/cache seals remained unchanged (8,447 original source files,
28 cache files), no stage timed out, and no child process group remained. The
provider reported terminal completion. This is process-group plus platform-terminal
closure, not an independent census of escaped/setsid descendants or Windows proof.
Checkpoint placement at vault pedestals/barriers tests ordinary interactions and
one sampled legal layout, not natural maze traversal or every layout combination.
No rendered-client, audio, raw-socket or complete quest-traversal proof is claimed.

The earlier completed 25/16/53 run at `fb3a5e24` remains genuine historical
94-test evidence. A later source trace found that the existing members golem Area
shadowed the new public Boost Area, a path those 25 native cases did not cover.
Ready was withdrawn while that ownership path was corrected. The new 27/16/53
run is a separate completed 96-test result. Its added cases buy Boost through the
ordinary Exchange, assert the real members Area owner, seed expiry deadlines and
use World/AreaManager processing to check all warnings/countdown exactly once.
They also awaken mapped golem rubble and verify original slot/id/owner/HP restoration
on actual AreaManager departure. Seeded deadlines are boundary tests, not naturally
elapsed minutes; the unchanged F2P fallback is source preservation, not a separate
executed F2P-world claim. Earlier results are not expanded retroactively.
