# NPC wander and aggression audit

Audit of `server/data/definitions/npc-spawns.json` and the core aggression code against the
OSRS Wiki and the RSProx capture archive. Branch: `audit/npc-wander`, based on `main`
(`10f92002f`), 1 November 2026.

The machine-readable results are next to this file:

- [`npc-wander-census-before.csv`](npc-wander-census-before.csv) - one row for every spawned
  NPC id in the **pre-fix** snapshot (`id`, `name`, spawn count, walk animation, actions, radius
  distribution, sources, flags).
- [`npc-wander-findings.csv`](npc-wander-findings.csv) - the 151 spawn rows changed by this
  branch, with the old radius, the new radius, confidence and evidence.

The 151 spawn rows were applied to `npc-spawns.json` in this branch, and the sync pipeline's
radius inheritance was fixed so a later Wiki batch cannot reintroduce the same default-5 split.
The analysis below describes the snapshot before those changes; the
[Applied changes](#applied-changes) section records what was done.

## Scope and method

The spawn file has **30,756 rows** for **6,405 cache NPC ids**. One row is keyed as `ELENA_2`
rather than carrying a numeric id; the loader resolves it to 4257, and the census includes it.
A row with no `wanderRadius` gets the loader's default of **5**
(`NpcSpawnDefinitionLoader.DEFAULT_WANDER_RADIUS`), so the audit treats "missing" as a radius,
not as "no wander".

Adjacent finding (not part of the wander audit): the keyed row `ELENA_2` resolved to Elena 4257
at 2592,3336, but the Wiki lists 4257 as the kidnapped Elena at 2541,9672 and the civilian at
2592,3336 as 1102 (`ELENA`). That is a spawn-identity question, not a wander range; the branch
changes the key to `ELENA`.

The counts below are the **pre-fix snapshot** the audit ran against.

| Measure | Count |
| --- | ---: |
| Spawn rows | 30,756 |
| Rows with an explicit `wanderRadius` | 4,265 |
| - explicit `0` | 2,411 |
| - explicit `1`-`4` | 1,845 |
| - explicit `5` | 7 |
| - explicit `> 5` | 2 (9 and 12) |
| Rows using the default 5 | 26,491 |
| Ids with at least one explicit radius | 2,099 |
| Ids using only the default 5 | 4,306 |
| Ids where every spawn is explicitly `0` | 844 |
| Ids with more than one effective radius | 256 |
| Ids with more than one explicit radius | 83 |
| Ids with no walk animation in the cache | 273 |
| Ids with no walk animation **and** a positive effective radius | 6 |

Three sources were used for each decision:

1. **The cache (revision 241).** `walkSeqId`/`basTypeId` say whether the NPC has a walk
   animation at all; `actions`, `size` and `combatLevel` identify props, service NPCs and
   monsters. An NPC with `walkSeqId = -1` and `basTypeId = -1` cannot walk, so a positive
   radius is always wrong.
2. **The OSRS Wiki.** The [Wander radius](https://oldschool.runescape.wiki/w/Wander_radius) and
   [Aggressiveness](https://oldschool.runescape.wiki/w/Aggressiveness) articles define the
   mechanics. Individual NPC pages and their "Changes" sections identify stationary NPCs and
   later wander-range changes. 4,353 titles were queried; 3,355 pages had content (955 were
   missing).
3. **RSProx.** 43 transcribed OSRS recordings contain **31,597 NPC add sightings** at **13,778
   distinct sites**. For each sighting the audit measured how far the NPC moved from where it
   was added, by NPC id and tile. 2,054 spawn rows sit within 2 tiles of a captured site, across
   942 ids. Captures are a sample: a clean "never moved" result is good evidence for a
   non-attackable NPC; it is not proof for a monster, whose capture may simply be a short fight.

Limits: the RSProx archive is not a whole-map census, so "no capture" is not evidence of
anything; and the Wiki does not publish a per-NPC wander radius. The recommendations therefore
carry a confidence label, and the CSV keeps the evidence for each row.

## Applied changes

- **All 151 spawn rows** in `npc-wander-findings.csv`: 21 cache-definite, 72 high-confidence,
  8 medium-high, 47 service-NPC outliers and the 3 wandering dogs. `npc-spawns.json` changes
  only those rows; the one-spawn-per-line layout is preserved.
- **`ELENA_2` -> `ELENA`** on the civilian Elena at 2592,3336 (identity, not wander).
- **`sync-npc-spawns.ts`** now uses `chooseWanderRadius()` from `npc-spawn-matching.cjs`. A
  non-attackable NPC's established explicit radius wins over the implicit default when at least
  two explicit witnesses agree; otherwise the most common effective radius is used. Regression
  tests are in `npc-spawns-sync.test.cjs`.
- **Aggression range:** `NpcDefinition` now carries a `huntRange` (default 3), and
  `NpcAggression` measures it from the NPC's current south-west tile instead of the spawn,
  using `max(huntRange, attackDistance)` and dropping the old `< combatFollowDistance` cap. The
  unit test is in `aggression-tolerance.test.cjs`.

Verification in this branch: `tsc --build`; `node --test tests/aggression-tolerance.test.cjs`
(5 pass); `node --test tests/npc-spawns-sync.test.cjs` (24 pass); the five NPC spawn, override,
refine, facing and dormant suites (46 pass); and `tests/kalphite-queen.test.cjs` (19 pass).

## Wander findings

### A. Cache says the NPC cannot walk (definite)

These six ids have no walk animation and no BAS, but every spawn uses the default radius 5. They
cannot follow a wander step. **21 spawns.**

| Id | NPC | Spawns | Current | Evidence |
| ---: | --- | ---: | ---: | --- |
| 9266 | Brundt the Chieftain | 1 | default 5 | Cache: `walkSeqId = -1`, `basTypeId = -1` |
| 9267 | Brundt the Chieftain | 1 | default 5 | Cache: `walkSeqId = -1`, `basTypeId = -1` |
| 9371 | Trader Crewmember | 16 | default 5 | Cache: no walk animation; all 16 are Wiki-added |
| 12599 | Key Master | 1 | default 5 | Cache: no walk animation |
| 14296 | Queen Zyanyi Arkan | 1 | default 5 | Cache: no walk animation |
| 15752 | Aranei scout | 1 | default 5 | Cache: no walk animation |

Recommendation: set `wanderRadius: 0`. This is also the rule `sync-npc-spawns.ts` already uses
for an NPC with `walkSeqId === -1`; these rows predate or bypass it.

### B. Documented or captured as stationary (high confidence)

These are positive-radius spawns of NPCs that the Wiki says do not move, or that stood still in
every RSProx sighting while their siblings already use 0. **72 spawns.**

| Id | NPC | Spawns | Current | Why |
| ---: | --- | ---: | ---: | --- |
| 0 | Tool Leprechaun | 25 | default 5 | [Tool Leprechaun](https://oldschool.runescape.wiki/w/Tool_Leprechaun) changes (23 May 2013): they "stand near their patches rather than wandering so far away". 20 of 45 already have 0; RSProx: 23 sightings at 11 sites, never moved. |
| 5274 | Monkey Archer | 18 | default 5 | [Wander radius](https://oldschool.runescape.wiki/w/Wander_radius): monkey archers are stationary (radius 0). They attack from platforms. 1 of 19 already has 0. |
| 3613 | Iron pickaxe (NPC) | 9 + 1 at 1 | default 5 / 1 | Abandoned Mine pickaxe props that turn into a possessed pickaxe when taken. 5 of 15 already have 0. |
| 3614 | Corpse | 9 + 1 at 1 | default 5 / 1 | [Corpse](https://oldschool.runescape.wiki/w/Corpse): lies on the Abandoned Mine floor and animates into a skeletal miner when approached. 11 of 21 already have 0. |
| 4086 | Soldier (drilling, Burthorpe) | 5 | default 5 | Drill formation (`death_ig_solider_drilling`): all 10 spawns stood still in 106 sightings across 10 sites. 5 already have 0. This is the same pattern as the Shayzien formation in [npc-spawn-captures.md](../npc-spawn-captures.md#the-shayzien-drill-formation). |
| 3142 | Gnome Coach | 1 | default 5 | [Gnome Coach](https://oldschool.runescape.wiki/w/Gnome_Coach): does not random-wander; he walks a fixed clockwise circuit of the Gnome Ball arena. A radius of 0 stops the random walk; the circuit needs a scripted route. |
| 4067 | Black Knight Titan | 1 | default 5 | [Black Knight Titan](https://oldschool.runescape.wiki/w/Black_Knight_Titan): "He does not move from his tile." Also named on the Wander radius page. |
| 11289 | Ashuelot Reis | 1 | default 5 | [Ashuelot Reis](https://oldschool.runescape.wiki/w/Ashuelot_Reis) changes (14 June 2023): no longer wanders. |
| 12993 | Molossus (Outer Fortis cabbage patch) | 1 | default 5 | [Molossus](https://oldschool.runescape.wiki/w/Molossus): the dog by the cabbage patch south-east of Civitas illa Fortis does not wander; it hangs out with Lola and Xolo. The Xolo on the next tile (1749,3049) is already 0; the Molossus at 1748,3050 is not. |

### C. Stationary by capture and role (medium-high)

| Id | NPC | Spawns | Current | Why |
| ---: | --- | ---: | ---: | --- |
| 5921 | BigRedJapan | 6 | default 5 | Rooftop player-spoof NPC. The captured site at 2657,3295 never moved in 38 sightings; 1 of 7 already has 0. The other six sites were not captured, so this is pending confirmation. |
| 3007 | Ghost guard | 2 | default 5 | Ghost guards at fixed posts. 4 of 6 already have 0; 25 sightings at 6 sites never moved. |

Recommendation for B and C: `wanderRadius: 0` (except the Gnome Coach, which needs a scripted
route before its radius can be zeroed without freezing him).

### D. Service/talk NPCs left on the default 5 (medium)

The spawn pipeline already tightens most bartenders, shopkeepers, clerks and squires from
captures. These ids still use the default 5 while other spawns carrying the same NPC name use a
smaller radius. They are the most likely Wiki-batch regressions. **47 spawns.**

| Id | NPC | Spawns | Current -> recommended | Why |
| ---: | --- | ---: | ---: | --- |
| 5730 | Master Farmer | 14 | 5 -> 3 | Two captured spawns use 3; the other 14 were Wiki-added. |
| 4671 | Male slave | 13 | 5 -> 1 | One captured spawn uses 1. |
| 8599 | Soldier | 3 | 5 -> 2 | Half the spawns already use 2. |
| 2888 | Shop keeper | 2 | 5 -> 3 | Other shop keeper ids use 2-3. |
| 7073 | Operator | 2 | 5 -> 0 | One sibling uses 0; the role is a fixed station. |
| 1319, 1320, 7911, 13345, 13928 | Bartender | 1 each | 5 -> 2 | Bartenders stay behind the bar; the captured bartenders use 1-2. |
| 1759, 1768 | Squire | 1 each | 5 -> 2 | Other squires use 1-2. |
| 2817, 2894, 7913 | Shop keeper | 1 each | 5 -> 3 | Other shop keepers use 2-3. |
| 2818 | Shop assistant | 1 | 5 -> 3 | Other shop assistants use 3-4. |
| 4255, 8968 | Clerk | 1 each | 5 -> 0 | The other clerk (10759) is 0; clerks stand behind counters. |

These are recommendations for review, not a blanket rule: a shopkeeper in a large shop may
legitimately use 3-4, and two spawns of the same NPC can differ. The captured value should win
where it exists.

### E. Should move but is pinned (medium)

| Id | NPC | Spawns | Current -> recommended | Why |
| ---: | --- | ---: | ---: | --- |
| 16398 | Chihuahua (wandering) | 1 | 0 -> 5 | [Chihuahua (wandering)](https://oldschool.runescape.wiki/w/Chihuahua_(wandering)): "roaming along the eastern shore" east of Uzer Oasis. |
| 16410 | Shiba (wandering) | 1 | 0 -> 5 | [Shiba (wandering)](https://oldschool.runescape.wiki/w/Shiba_(wandering)): "roaming in the Avium Savannah". |
| 16414 | Yorkie (wandering) | 1 | 0 -> 5 | [Yorkie (wandering)](https://oldschool.runescape.wiki/w/Yorkie_(wandering)): "roaming west of The Great Conch". |

The exact radius is not known from the captures in hand; 5 is the loader default, and the pages
describe a much larger roaming area, so these may need a larger value once captured. What is
certain is that `0` contradicts the Wiki.

### F. Mixed radii and default outliers

- **43 ids contain both an explicit 0 and a positive radius.** Some are legitimate (one static
  quest copy among many wild spawns, e.g. a single Rat or Duck). Others are the regressions
  listed above. The full list is in the pre-fix census CSV under the `mixed-zero-positive` flag
  and in the appendix.
- **245 ids have at least one default-5 spawn while their explicit spawns mostly use a smaller
  radius** (`default-outlier` in the census). That is the population the sync/refine pipeline
  should re-check; not all of them are wrong (wildlife and guard patrols genuinely vary).
- **83 ids have more than one explicit radius.** Most are wildlife (butterflies, sheep, birds)
  or NPCs whose different locations have different behaviour. The handful that stand out are
  the service NPCs in section D.
- The only explicit radii above 5 are `Ghost (Revenant Caves)` (10474) at 9 and 12; it is a
  roaming ghost with no capture evidence in hand, so no change is recommended.

## Root cause

`sync-npc-spawns.ts` used to choose a new spawn's radius with `commonRadius()`:

```ts
function commonRadius(spawns, matches) {
    const counts = new Map();
    for (const spawn of spawns) if (matches(spawn)) {
        counts.set(spawn.wanderRadius, (counts.get(spawn.wanderRadius) ?? 0) + 1);
    }
    if (counts.size === 0) return { found: false };
    return { found: true, radius: [...counts].sort((a, b) => b[1] - a[1])[0][0] };
}
```

`spawn.wanderRadius` is `undefined` when the row uses the default. `undefined` is counted as a
value, and `undefined` can win the "most common" vote. A Wiki batch added after a refine run
therefore gives its new rows no `wanderRadius` (default 5), even when the NPC's established
radius is 0 or 2. The second `refine:npc-spawns` run only *tightens* a captured walker and
never widens; it also cannot fix a spawn it never captured. The result is exactly the split
seen in Tool Leprechauns, Soldiers, Monkey Archers, Corpses and Iron pickaxes: some rows were
refined to 0, later Wiki rows kept 5.

The pipeline change applied here (`chooseWanderRadius()` in `npc-spawn-matching.cjs`):

1. It compares **effective** radii (`spawn.wanderRadius ?? DEFAULT`) and, for a non-attackable
   NPC, lets an established explicit radius win over the implicit default when at least two
   explicit witnesses agree and they are the majority of explicit rows.
2. `sync:npc-spawns` uses it for new rows; the existing default-5 rows were corrected by the
   151 data changes above.
3. `tests/npc-spawns-sync.test.cjs` covers the 0/5 split, the single-witness case, attackable
   NPCs, the name fallback and the no-walk fallback.
4. `refine:npc-spawns` remains the only source that *lowers* a radius from captures; the sync
   pass only copies an established radius, never invents a new one.

`npc-spawns.json` is the canonical spawn data owned by the TSPS sync pipeline (it is not an
osrsreboxed-db export; see [npc-spawns.md](../npc-spawns.md)), so the 151 rows are applied
directly. The `chooseWanderRadius()` change above is what stops the same split on the next Wiki
batch.

The rows were applied in confidence order: A and B first (unambiguous), then C and D, then E.
The `operator`, `Master Farmer` and `Male slave` recommendations in D remain the most
judgement-based; they are labelled medium in the CSV so a later capture can confirm them.

## Aggression audit

The Wiki's [Aggressiveness](https://oldschool.runescape.wiki/w/Aggressiveness) page separates
three ranges:

- **Attack range** - where the NPC can hit, measured from the tiles it occupies.
- **Aggression range** - `max range + attack range`, measured from the **static spawn point**,
  and it *accounts for the NPC's size*. Max range is "almost always seven tiles"
  ([Retreat](https://oldschool.runescape.wiki/w/Retreat)).
- **Hunt range** - where an aggressive NPC searches for a target; measured from the NPC's
  **current south-west tile**, and it does **not** account for size. Different monsters use
  different hunt ranges.

It also says an aggressive monster attacks a player whose combat level is at most twice the
monster's level; most Wilderness monsters ignore the level check.

### Before this branch

`NPC.isAggressiveTo`:

```ts
return player.getSkillManager().getCombatLevel() <= (this.getCurrentDefinition().getCombatLevel() * 2)
    || Wilderness.isIn(player);
```

This matches the Wiki's level rule (and the Wilderness exception) for NPCs whose `aggressive`
flag is set. Tolerance (10 minutes, two 21x21 regions, persisted across logout) also matches the
Wiki's [Tolerance](https://oldschool.runescape.wiki/w/Tolerance) page.

The old initiation check was:

```ts
public aggressionDistance(): number {
    const attackDistance = CombatFactory.getMethod(this).attackDistance(this);
    return Math.max(attackDistance, 3);
}

const distanceToPlayer = npc.getSpawnPosition().getDistance(player.getLocation());
if (distanceToPlayer < npcDefinition.getCombatFollowDistance() && distanceToPlayer <= aggressionDistance) {
    ...
}
```

The effective initiation range was:

| NPC attack style | `attackDistance` | `aggressionDistance` | Effective range (`min(<7, <=aggro)`) |
| --- | ---: | ---: | ---: |
| Melee | 1 | 3 | **3 tiles from spawn** |
| Ranged | 6 | 6 | **6 tiles from spawn** |
| Magic | 10 | 10 | **6 tiles from spawn** (capped by `< 7`) |

That did not match the Wiki:

- The Wiki's aggression range is `max range + attack range` (8 for a melee NPC, 13 for a
  6-tile ranger, 17 for a 10-tile mage), plus `size - 1`. The old code used
  `max(attackDistance, 3)` and then capped at 6, so melee NPCs under-aggroed badly and magic
  NPCs could not start a fight at 7-10 tiles even though they could cast that far.
- Size was ignored. A size-2+ NPC's occupied tiles should extend the range; the old code
  measured from the south-west tile only.
- The old code used the **spawn** position, which is the aggression-range origin, but this loop
  is doing the **hunt** (searching for a target). The Wiki's hunt range is measured from the
  NPC's current tile. An NPC that had wandered away from its spawn could not aggro a player
  standing next to it if that player was more than 3 tiles from the spawn.
- `combatFollowDistance` (default 7, KQ overrides 9) was used as a hard aggro cap *and* as the
  retreat max range. The Wiki says max range is the retreat boundary, not a cap on the hunt.
  `NpcDefinition.retreats` is never hydrated, so the retreat path is still dead for every NPC.

### After this branch

The hunt now has its own range on the NPC definition:

```ts
// NpcDefinition
private huntRange: number = 3; // from the NPC's current south-west tile
public getHuntRange(): number { return this.huntRange; }
public setHuntRange(range: number): void { this.huntRange = Math.max(1, Math.trunc(range)); }

// NpcAggression
const huntDistance = npc.getLocation().getDistance(player.getLocation());
const huntRange = Math.max(npcDefinition.getHuntRange(), method.attackDistance(npc));
if (huntDistance <= huntRange) {
    ...
}
```

| Attack style | Before | After |
| --- | --- | --- |
| Melee | 3 tiles from spawn | 3 tiles from the current tile |
| Ranged | 6 tiles from spawn | 6 tiles from the current tile |
| Magic | 6 tiles from spawn (capped by `< 7`) | 10 tiles from the current tile |

This matches the Wiki's hunt-range definition: the search starts at the NPC's current
south-west tile, not its spawn. The old 3-tile value is kept as the default because the Wiki
gives no global hunt number and the Edgeville report is about over-aggro, not under-aggro; a
ranged or magic NPC can still see as far as it can cast (`attackDistance` is a floor). `canAttack`
still enforces the real attack range, line of sight and size once combat starts. Using 3 rather
than the 7-tile retreat max range also avoids worsening the Edgeville skeleton chain in #1764.
Per-NPC overrides can call `setHuntRange()`; the default is 3. The Kalphite Queen keeps its
existing 9-tile encounter range by setting `huntRange: 9` alongside `combatFollowDistance: 9`.

A separate aggression-range formula (`max range + attack range + size - 1` from the static
spawn) is not needed for hunting and is not implemented. `combatFollowDistance` remains the
retreat/leash max range; `retreats` still needs hydrating before the retreat path can work. If a
future retaliation feature needs "can be attacked from spawn", it should compute that formula
from the spawn, not reuse the hunt range.

The hunt-range default and clamping are covered in `aggression-tolerance.test.cjs`. The full
melee/ranged/magic and size cases need a live combat harness rather than the unit test; that is
the remaining verification gap.

Data note: 10 spawned ids offer `Attack` but are absent from `monsters-complete.json`, so
`isAggressive` is false for them. Nine are nameless multinpc parents whose transformed form
carries the dump flag; the exception is `Vampyre Snail` (16344, combat 346), which is not in
the current dump. That is a dump gap, not an aggression-range bug.

## Appendix: mixed zero/positive ids

These ids contain both an explicit 0 and a positive radius. `radii` is `radius: spawns`.

| Id | NPC | Radii | Spawns |
| ---: | --- | --- | ---: |
| 2854 | Rat | `{0:1, default:652}` | 653 |
| 238 | Butterfly | `{0:1, 2:2, 3:1, 4:1, default:115}` | 120 |
| 235 | Butterfly | `{0:1, 1:1, 3:2, 4:2, default:106}` | 112 |
| 2845 | Snake | `{0:1, default:96}` | 97 |
| 1839 | Duck | `{0:1, default:92}` | 93 |
| 12771 | Moonlight moth | `{0:2, 1:16, 3:74}` | 92 |
| 1838 | Duck | `{0:1, default:84}` | 85 |
| 5553 | Black warlock | `{0:1, 4:1, default:74}` | 76 |
| 5556 | Ruby harvest | `{0:1, 4:1, default:61}` | 63 |
| 3440 | Will o' the wisp | `{0:1, 2:3, 3:2, default:47}` | 53 |
| 12881 | Guard | `{0:32, default:15}` | 47 |
| 0 | Tool Leprechaun | `{0:20, default:25}` | 45 |
| 3441 | Will o' the wisp | `{0:2, 1:2, 2:3, 3:3, 4:1, default:30}` | 41 |
| 13082 | Citizen | `{0:1, 3:2, 4:2, default:34}` | 39 |
| 4145 | Mountain goat | `{0:2, 2:9, default:19}` | 30 |
| 12968 | Capybara | `{0:21, default:9}` | 30 |
| 5241 | Bird | `{0:1, default:28}` | 29 |
| 2855 | Rat | `{0:1, default:23}` | 24 |
| 3614 | Corpse | `{0:11, 1:1, default:9}` | 21 |
| 5274 | Monkey Archer | `{0:1, default:18}` | 19 |
| 2091 | Moss giant | `{0:1, default:17}` | 18 |
| 14574 | Caique | `{0:1, 4:1, default:16}` | 18 |
| 3050 | Hobgoblin | `{0:1, default:15}` | 16 |
| 2244 | Spiritual mage | `{0:4, default:11}` | 15 |
| 3613 | Iron pickaxe | `{0:5, 1:1, default:9}` | 15 |
| 4086 | Soldier | `{0:5, default:5}` | 10 |
| 787 | Suqah | `{0:1, default:8}` | 9 |
| 5921 | BigRedJapan | `{0:1, default:6}` | 7 |
| 90 | Ghost | `{0:1, default:5}` | 6 |
| 3007 | Ghost guard | `{0:4, default:2}` | 6 |
| 249 | Red dragon | `{0:1, default:4}` | 5 |
| 2264 | Dagannoth fledgeling | `{0:2, default:3}` | 5 |
| 3719 | Vyrewatch | `{0:1, default:4}` | 5 |
| 12960 | Capybara Pup | `{0:2, default:3}` | 5 |
| 13000 | Xolo | `{0:1, 3:1, default:3}` | 5 |
| 14565 | Anteater | `{0:1, default:4}` | 5 |
| 282 | Cormorant | `{0:1, default:3}` | 4 |
| 13425 | Buffalo | `{0:1, default:3}` | 4 |
| 7073 | Operator | `{0:1, default:2}` | 3 |
| 3206 | null | `{0:1, default:1}` | 2 |
| 8368 | Abigaila | `{0:1, default:1}` | 2 |
| 13321 | Prisoner | `{0:1, 1:1}` | 2 |
| 13871 | Villa Guard | `{0:1, default:1}` | 2 |

## Reproducing

- Cache/definition join: `CachePipeline.initialize`, then read `CacheDefinitions.getNpc(id)`
  for `walkSeqId`, `basTypeId`, `size`, `actions`, `transforms` and `combatLevel`; join to
  `monsters-complete.json` for `aggressive`, `wiki_name` and `combat_level`.
- Wiki: `action=query&prop=revisions&rvslots=main` in batches of 50 titles, plus the
  `Wander radius`, `Aggressiveness`, `Retreat` and `Tolerance` articles. The specific pages
  behind each high-confidence row are linked above.
- RSProx: transcribe the archive's OSRS recordings, then for each `[add] npc=(index=..., id=...,
  coord=...)` track following `[walk] npc=(index=..., newcoord=...)` lines and record the
  Chebyshev distance from the add tile. The local corpus used here was 43 transcripts
  (`%USERPROFILE%\.rsprox\binary\*.txt`); the archive is <https://rsprox.net/database>.
