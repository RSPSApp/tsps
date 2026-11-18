# Camdozaal activities

The activity plugin owns shard storage, Ramarno's Exchange, deposit crushing,
net fishing, fish preparation/offering and the timed vault. Below Ice Mountain
continues to own its quest, entrance and Ramarno introduction; Defender of Varrock
and Desert Treasure II retain their separate quest interactions.

## Inhabitants, golems and the altar

Source: an RSProx recording of 2026-11-17 (revision 242.1), a visit to the ruins
after Below Ice Mountain and Desert Treasure II: Ramarno's conversation and
Exchange, Helena, Prescott, the forge, three Flawed Golem fights and the altar.

**Spawns** (`npc-spawns.json`):
- Helena and Prescott are the cache multinpcs `dt2_camdozaal_archaeologist_1/2`
  (3579/6149) at the dig site, centred on their captured roaming boxes (Helena
  2969-2973, 5796-5800; Prescott 2971-2975, 5793-5797), radius 2. Varbit 15126
  (Desert Treasure II's Whisperer chapter, sent on login) shows them from 2 to 48,
  so they appear once Ramarno has pointed the player to them and stay after the
  chapter. DT2 no longer spawns its own private Prescott.
- Ramarno never moves in the capture; both of his spawns have radius 0.
- All 27 golem rubble rows have radius 0: rubble never moves (it wandered before).

**Golems** (`plugins/npcs/CamdozaalGolems.plugin.js`). Every rubble can be awakened:
Flawed, Mind and Body golems on any world, Chaos golems on members worlds. Awaken
plays `ancient_guardian_awaken` (8944); 4 ticks later the same NPC slot becomes the
golem, with its own hitpoints, and attacks the player who woke it. It dies with
`ancient_guardian_death` (8943) and the rubble is back on its tile 29 ticks after
the death (capture: death 400, rubble 429; measured the same here). Only one golem
per player. A golem whose player walks more than 16 tiles away, leaves the ruins or
logs out disintegrates: it dies with no killer, so nothing drops, and respawns as rubble.

**Ramarno** (`camdozaal/Ramarno.Camdozaal.js`) plays the Wiki transcript variants for
items used on him and supplies their effects by step id: shards go into the forge
(amount prompt), then the Exchange opens; head, handle and guard plus 1,500 shards
make the mace; pieces smelt for 100 shards, the mace and the Imcando hammer for 500,
the broken hammer for 350, each optionally straight into the forge; 1,250 shards
repair the broken hammer; relics, deposits and the redberry pie (taken) get his lines.
"Yes please." in Talk-to opens the Exchange, as captured. Helena's post-quest
condition is answered by the same introduction check as the forge.

**Pickaxe barrels** (`camdozaal/Barrels.Camdozaal.js`): the five cache barrels
(`camdozaal_pickaxe_barrel`, Take-pickaxe) give a bronze pickaxe with the reach
animation (832) and an item box, "You take a pickaxe from the barrel.", as captured;
with any pickaxe Mining knows in the inventory (the Wiki's condition) they answer
"You already have a pickaxe. Best leave these ones here in case someone else needs
one." They never run out. The full-inventory wording is not captured.

**Preparation Tables** (`camdozaal/Fish.Camdozaal.js`), the two at 2935,5774 and
2935,5769 (Wiki: Preparation Table, Guppy): Prepare-fish, or a raw fish on a table,
needs a knife and the (boostable) Cooking level of the fish (7/20/33/46, catfish
members-only), giving 12/23/31/43 XP or a ruined fish. No-ruin levels and the
Preparation buff are under the probability estimates below.

A second RSProx recording (2026-11-17 19:59, one raw tetra prepared and then offered,
the player standing still) gives the presentation and first-fish timing:
- **Table:** nothing plays on the click; 3 ticks later the fish is done with
  `human_cooking` (896), synth 1261 and the spam-filter line "You successfully prepare
  the Tetra." (the prepared item's name).
- **Altar:** 1 tick after the click, `human_bone_sacrifice` (3705), synth 958, the
  Prayer XP and the fish gone, plus a map graphic on the player's tile: the fish's
  own `camdozaal_fish_offering_<fish>` (1849 for the tetra), height 100, delay 0,
  which draws the fish rising in purple light (the Wiki's offering gif; seen in a
  headless client capture). There is no message.
- Later fish follow the Wiki's intervals, 4 ticks at the table and 3 at the altar
  (one fish was recorded, so these are not captured). The Wiki's 2-tick first action
  disagrees with the recording; the recording is used.

Not captured: the ruin line ("You accidentally ruin the Tetra.") and the low-level
refusal are TSPS wording.

**Captured wording.** Exchange refusal "You cannot afford that buff at this time."
with synth 2277, a purchase synth 4974. Forge Fuel and Empty ask "How many Barronite
shards would you like to deposit/withdraw?<br>N stored." and answer "You stored N
Barronite shards in the Sacred Forge." / "You have N Barronite shards left in the
Sacred Forge."; Check says "You currently have N Barronite shards stored"; Fuel with
none carried says "You have no Barronite shards to deposit." The altar and both
tables say "You have no suitable fish to prepare." with nothing to use.

**Not captured** (kept as estimates or cache-named): the walk-away distance; the
F2P refusal for Chaos rubble; Empty with nothing stored. Only the tetra's graphic
was recorded; the guppy, cavefish and catfish use their cache-named counterparts
(1847, 1848, 1850).

**Known differences.** Live Prescott's conversation opens with the player's
"Hello there.", which the generated transcript lacks. Live menus drop the topic just
asked (Ramarno's "Tell me more about..." list); the transcript engine shows the full
list. Both come from generated data or the shared engine and are left for there.

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

Deposit rolls use the Wiki's published overall marginals directly: head 1/200,
each of five relics 1/350, and members-only broken Imcando hammer 1/300, scaled
by the declared Luck/Boost rare multiplier. Large shards retain a 1/20 marginal;
small shards take the remainder. One cumulative roll selects the outcome before
any shard quantity roll. The quoted conditional **1/15 when not receiving shards**
does not normalize with these approximate overall marginals and is retained as a
source note, not the implemented selection rule. The earlier implementation
prioritized that conditional wording and yielded 27/19600 (about 1/726) for the
hammer; maintainer review requested the published overall 1/300 anchor instead.
Boundary tests check the declared cumulative intervals and F2P exclusion, not
measured retail distributions. Prior completed runs exercised the earlier model;
the changed reward model was exercised by the later run described below.

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

At tested revision `1bc96319083ec7b8388cf2b2a596022fa54e68c5`, the supported
Linux run exercised the requested direct deposit marginals and canonical plugin
description. Its overall provider outcome was **ERROR70**, because the full
world-configuration documentation test found four unrelated stale entries.
The actual separate-process results were:

| File | Passed / total | Exit |
| --- | --- | --- |
| `camdozaal-native.test.cjs` | 27 / 27 | 0 |
| `fishing.test.cjs` | 16 / 16 | 0 |
| `cooking.test.cjs` | 53 / 53 | 0 |
| `world-config-docs.test.cjs` | 3 / 4 | 1 |

The existing canonical `yarn world-config-docs` command exited 0, emitted the exact
committed Camdozaal row, then the executor restored the original document bytes
before tests and content seals. The full documentation assertion then failed on
DisplayName sessionMinutes and DorgeshuunGuides, StorageItems and ClanWars
descriptions. Their source metadata and the committed document outside the
Camdozaal row are byte-identical to the branch base; this is source-qualified
pre-existing documentation drift, not a newly executed baseline. Only the
Camdozaal row is included in this PR, as requested by review. The 96 activity/related
passes plus 3 documentation passes and 1 failure are from one run; they are not
a completed 100-test green result.

Actual build/test commands, run from `server` after dependency/cache setup:

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/camdozaal-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/fishing.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/cooking.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/world-config-docs.test.cjs
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
run's per-file passing results.

Final source/compiled/cache seals remained unchanged (8,447 original source files,
28 cache files), no stage timed out, and no child process group remained. The
provider reported terminal ERROR70 after the documentation failure. This is process-group plus platform-terminal
closure, not an independent census of escaped/setsid descendants or Windows proof.
Checkpoint placement at vault pedestals/barriers tests ordinary interactions and
one sampled legal layout, not natural maze traversal or every layout combination.
No rendered-client, audio, raw-socket or complete quest-traversal proof is claimed.

The earlier completed 25/16/53 run at `fb3a5e24` remains genuine historical
94-test evidence. A later source trace found that the existing members golem Area
shadowed the new public Boost Area, a path those 25 native cases did not cover.
Ready was withdrawn while that ownership path was corrected. The new 27/16/53
run at `10ab60dd` is a separate historical completed 96-test result. Its added cases buy Boost through the
ordinary Exchange, assert the real members Area owner, seed expiry deadlines and
use World/AreaManager processing to check all warnings/countdown exactly once.
They also awaken mapped golem rubble and verify original slot/id/owner/HP restoration
on actual AreaManager departure. Seeded deadlines are boundary tests, not naturally
elapsed minutes; the unchanged F2P fallback is source preservation, not a separate
executed F2P-world claim. Earlier results are not expanded retroactively.

Maintainer review then requested the direct 1/300 member hammer marginal and plugin
description/catalog row. The later `1bc96319` run re-executed all 27/16/53 cases
with that changed model, and verified the canonical generator row. The original
96-test run remains evidence for its earlier source and model; the later provider
error and 3/4 documentation result remain explicit.
