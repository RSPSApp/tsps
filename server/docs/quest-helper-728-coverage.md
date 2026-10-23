# Issue 728: Quest Helper quest coverage

Tracks [issue #728](https://github.com/RSPSApp/tsps/issues/728). Follow
[the full quest testing process](agents/quest-testing.md).

Quest Helper is the progression reference, pinned at
`06da90f982518a093f2fe1c9cfac5547fa7053d3` (upstream HEAD verified at kickoff).
Cache: `osrs-241_2026-10-20`. Initial server revision: `be4be8d31d83ded906bd6fd1140a719ba5e45e84`.

This inventory is a backlog, not a claim that every quest is broken. Source comparison,
regression tests, natural MCP completion and visual overlay checks are separate evidence.
No Java Quest Helper overlay is installed here. A natural completion requires the real
mandatory routes, exact reward deltas once, repeat checks, relog, offline persistence,
post-quest behaviour and applicable canonical recovery. Target quest-state/item injection
and transport/scene bypasses do not count.

Implementation began in parallel OpenCode sessions with one owner per quest/test file.
The initial free DeepSeek endpoint exhausted its quota; work later continued on the
user-approved paid DeepSeek V4.1 Flash 1017 endpoint. After that quota was exhausted, the
root selected MiniMax M3.1 Flash Free for continued source and peer work. Provider pauses
preserve the original sessions, reports, tests and changes; no paid fallback is used after
the MiniMax switch. The integration owner reviews changes, handles shared files and
generated-source fixes, freezes batches, tests and reloads. Generated JSON is never
hand-edited or repaired through copied output overrides. The PR stays draft until all
required checks are complete. Unverified cases stay explicit.

## Current checkpoint — 2026-10-23

Work now uses three parallel Codex workers: two native route workers and one source
implementation/review worker, with integration review and publication alongside them.
Each native worker may interleave two independently logged accounts. Eligible workers
handle routine setup, focused tests and checkpoint administration without waiting for
integration approval. Ordinary commodities may be supplied as declared setup aids;
mandatory quest interactions, quest items, puzzles and transports are played naturally.
MCP `plan_route` reuses the existing long-distance collision planner to identify walking
waypoints and closed doors. Internal timed dialogue actions must finish automatically.

The [native verification ledger](quest-helper-728-verification.md) is the current source
of accepted route counts: **14/128 scoped main routes**. Supplemental issue-809 evidence
is recorded separately. Source fixes and passing regression tests do not count as native
completion. The draft PR is updated in reviewed batches; historical figures below remain
checkpoints rather than current totals.

## Historical cumulative status checkpoint — 2026-10-22

The original issue scope is **128 quests**. All 128 have source reports and scoped test
files; 127 quest plugin files differ from the task baseline (q046 is test-only). Source
reports are labeled 71 `done`, 54 `partial`, and three other/nonterminal statuses; these
labels describe source work and do not certify route parity. Thirteen plugin deltas are
committed on the draft branch; the rest remain in the shared worktree for review and
integration.

Peer review is cumulative across sessions. **98/128 quests (76.6%) have at least one
final peer report** at some hash. At the current source/test/dialogue-data hashes, 55/128
(43.0%) have final reviews: four clean and 51 with findings. Another 38 have older final
reports that need focused rechecks; eight reviews are active, and 27 quests have no final
review history. A stale-hash report remains useful evidence but does not validate current
source.

Four original quests have accepted natural completion evidence across saved-checkpoint
runs: The Ascent of Arceuus, Bone Voyage, Fishing Contest and Monk's Friend. At First
Light has accepted bounded pickup evidence, not a full completion. The supplemental
Waterfall route has accepted natural evidence outside the original 128. Other native
runs remain incomplete or pending; the separate native ledger records their route,
reward, persistence and recovery limits. No visual Quest Helper overlay is installed.

Initial baseline: server build passed; 4,238 tests, 4,232 passed, six existing failures,
zero skipped. The failure names are: bot activity tier allocation; deployed bot-site
configuration; hint-arrow and packet-sender QuickPrayers import-cycle failures;
Mortimer static Wyrmscraig spawn expectation; Tumeken's shadow walk animation.

Shared foundation: actors now expose their known eight-way heading across idle ticks,
explicit facing and moving interaction targets. This supports Animal Magnetism's
north-facing magnet step without quest-specific core logic. The build and four focused
tests pass; the tests fail against the original compiled implementation. This is source
evidence, and no native quest completion is claimed. A separate six-quest source-check
batch passed 36 focused tests; independent route review remains in progress.

Canonical dialogue regeneration comes from
[osrsreboxed-db PR #9](https://github.com/RSPSApp/osrsreboxed-db/pull/9), commit
`abadb2f4a5`. All 121 dialogue regressions pass. Two fresh offline exports with real
corrections and bindings produced identical sets and bytes for 3,291 generated files;
the tracked outputs match them. The TSPS import copies the minified dialogue export
exactly; its NPC index is unchanged. Consumer compatibility and overhead playback are
separate checks in progress, so this does not certify any quest route.

The shared overhead runtime has now passed root review and 48 focused dialogue tests,
including real task/manager scheduling, actor lookup and cancellation, imported overhead
speech and ordinary chatheads. Its generic two-tick cadence is not capture-proven OSRS
timing. Frozen natural playthroughs may run alongside read-only peer reviews; their
evidence remains provisional until the review passes for the same revision.

Five quests have reached the native playthrough phase. At First Light and The Ascent of
Arceuus entered playthroughs on frozen loaded revisions. At First Light's nine focused
tests and independent source review pass. It reached stage 12, paid the exact quest
rewards once and retained them after relogging. Its two jerboa catches separately
awarded 274 Hunter XP; repairing the bed awarded 10 Crafting XP. Missing ground tools
were bought from ordinary shops, and an optional upstairs detour needed a teleport
recovery. The missing needle and hammer spawns now match the pinned helper and Wiki
tiles in hand-maintained world data; this file is not a dumper export. The fresh follow-up
confirmed a settled needle pickup and persistence after relog. The hammer remained on
the ground after two adjacent approaches; the generic pickup path is under investigation.
Post-quest history did not duplicate rewards. Remaining recovery checks keep the run
provisional. Respawn uses the Wiki's 100-tick value without a new capture.

Ascent stopped at its opening: an unscoped Sins of the Father condition handler overrode
Mori's requirements check. The reviewed fix answers only Sins' nine canonical condition
IDs, leaving foreign conditions to their own quests. Nine focused tests pass, including
real registration-order dispatch and existing Sins actions. Ascent's memoir-page and
ordered-tracking corrections pass root review and eight focused tests. These include
the actual Karuulm elevator/return dispatch; landing tiles and timing are inferred
from the helper/cache, without captures. Current-revision peer review, full-bag checks
and a new natural run remain pending. Biohazard stopped at stage 1 and logged out. Its owner has
corrected Elena/Chemist recovery, canonical receipts and Guidor's transition at the actual
revelation dialogue. A further root regression found a courier who disposed of the wrong
vial could not accept a replacement; that recovery repair is in progress. Bone Voyage
also needs a guard preventing the onboard Junior Navigator from completing the quest
before arrival. No whole quest is certified yet.

Monk's Friend completed naturally, paid its rewards once and persisted through logout and
relogin. That run exposed late normal-rune payment and unreachable named Monk variants.
The corrected source now passes independent root review and 11 focused tests, including
normal payment before the party, a full-bag drop after all twelve overhead lines, once-only
settlement before completion observers, and named Monk dialogue selection. A fresh
current-revision run completed naturally: eight law runes arrived before the party at
stage 70; twelve overhead lines then completed stage 80, awarding one quest point and
2,000 Woodcutting XP. Repeat dialogue and relog preserved exact rewards without
duplication, and final logout was confirmed. Full-bag delivery and interruption after
the item box remain untested live; a reported wait beyond twenty minutes lacks an
independent timestamp. Whole-quest certification remains provisional.

Clock Tower crossed the cellar door naturally, placed the red cog, obtained a bucket of
water from the actual well and placed a second cog upstairs, reaching varp 10 = 3.
Real-cache door replay passes 51 focused tests and did not establish a geometry defect;
the driver must wait for opening before crossing in the same script. Completion is
unproven.

Clock Tower's reviewed source checkpoint fixes cog handling, lever transforms, the shared
world-lever condition, the scoped poison trough, the white-cog ladder's surface exit and
the native completion wire. Thirteen focused tests pass. Its affected natural route still
needs validation on the edited revision.

Death on the Isle has a reviewed source checkpoint for captured uniform and party-tray
IDs, the accusation-intro bit, evidence hand-in artwork and recovery after evidence loss.
Eight focused dispatch tests pass. This is separate from a full quest parity review and
natural completion, which remain pending.

The six affected consumers outside this issue's quest list now use the regenerated node
types and IDs, preserving their message text and removing obsolete fixture-only aliases.
The final four focused suites pass 99 tests, including real transcript-runner checks for
Hazelmere's lamp handover and the Khazard barman's once-only bribe. This checks compatibility
with the import; it does not certify those six complete quest routes.

Companion dumper commit `bae28c17eb` discovers official miniquest transcripts, adds the
full His Faithful Servants page, preserves explicit inline anchors, removes only verified
navigation footers, orders terminal quest-complete actions correctly and parses quoted
speaker labels. All 143 dialogue tests pass independently; two complete fresh exports
match for 3,292 generated files. The new export is not imported while the native batch
uses the previous frozen data. Generic NPC identity extraction and Icthlarin's malformed
source structure remain under review. Consumers must use corrected canonical nodes;
skipping real dialogue or copying missing lines into quest code is not accepted.

Big Chompy Bird Hunting has a reviewed source checkpoint for the hunting route, item
capacity and recovery, scoped dialogue conditions, and cancellation of the first hunt
on logout. Its combat hook now restricts its own tracked birds and leaves other quests'
owned NPCs alone. Fourteen focused tests pass, including the real combat policy and
plugin dispatch path. Natural completion and recovery remain pending.

His Faithful Servants and Museum Kudos are supporting work discovered through mandatory
Desert Treasure II and Bone Voyage prerequisites. They are tracked separately from the
128 issue quests and tutorial below.

Museum support now has a reviewed 100-Kudos source route through five Dig Site displays
and ten Historian Minas reports. Six focused tests cover real cached transcripts, once-only
Kudos/lamps, capacity retry, saved attributes, fixed find probabilities and duplicate artefact
removal. The persisted count now mirrors to `VM_KUDOS` (varbit 3637) on awards, login and
bootstrap, preserving sibling bits in varp 1010. Tests cover the 99/100 prerequisite boundary
and replay at 0/99/100. Bone Voyage's owner is integrating the synchronous `museum:get-kudos`
contract. Natural Museum testing remains pending. The quiz, fossils, pendant teaching and other
Museum activities remain outside this bounded route; a missing Hazeel report transcript
branch remains blocked at its source.

Zogre Flesh Eaters needed no source change for the canonical dialogue import. The three
nodes the old dump marked `unavailable` — `6kbf4F`, `IOrqNS` and `YrmIgh` — are now real
message nodes with new ids: `luhaXl` ("Grish hands you some food and two potions."),
`uZirGH` ("Grish gives you a crudely crafted key.") and `_QKSlE` ("Zavistic hands you a
bottle of strange potion."). The plugin already references the new ids, every id it
references exists in the current page, and the eleven focused tests pass.

Its native run stopped at stage 3 with 25 identical "I can't reach that!" replies while
using the Dragon Inn tankard on NPC 1320 (the Dragon Inn bartender). The cause is core
reach, not the quest plugin: `MovementQueue.walkToEntity` (`MovementQueue.ts:1231,1287`)
never reached the NPC, so no plugin dispatch ran. A registered-dispatch repro confirms the
quest side is sound — the plugin's item-on-NPC handler fires for NPC 1320 with the tankard
and starts the generated variant
`investigating-b-vahn-using-the-dragon-inn-tankard-on-the-dragon-inn-bartender`, whose
message `OG1g5U` sets the tankard-shown flag. Two shared causes block the walk: NPC 1320's
spawn entry carries no `wanderRadius`, so the loader's default 5 applies
(`NpcSpawnDefinitionLoader.ts:31,123-125,151`) and `NPCMovementCoordinator.wander()` moves
the bartender up to five tiles — the raw log's observed positions
(2556,3077 / 2556,3078 / 2556,3079 / 2557,3080 / 2555,3077 / 2554,3077 / 2553,3079 /
2552,3081 / 2554,3082) all sit within that radius of the spawn (2556,3078) — and the
collision map splits the inn: the bar room is one 56-tile component (x 2549-2558,
y 3078-3083) holding both the spawn tile and the driver's tile 2553,3083, while every
counter-row tile (row 3077, e.g. 2556,3077 clipping `0x4020`, north-east corner blocked)
is an isolated two-tile pocket with no reachable neighbour, so `reachedAbsolute` fails
from every side and the entity route returns zero waypoints. Request to the shared owners:
give the Dragon Inn bartender a bounded (zero) wander radius, or derive the radius from the
cache walk sequence instead of the blanket default. The plugin is left unchanged and no
quest shim was added. The tankard step is proven by dispatch and cache repro plus
collision analysis only, not by a live interaction; natural completion stays pending.

## Quest status

“Pending” means no accepted evidence yet. Source review does not imply native completion.

| Quest | Module | Source / fixes | Regression | Natural completion / recovery |
| --- | --- | --- | --- | --- |
| Animal Magnetism | `AnimalMagnetism` | Pending | Pending | Pending |
| Another Slice of H.A.M. | `AnotherSliceOfHAM` | Pending | Pending | Pending |
| The Ascent of Arceuus | `AscentOfArceuus` | Sins scope, memoir, ordered trail and Karuulm route reviewed by root; fresh peer pending | 8 quest and 9 shared focused tests pass | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| At First Light | `AtFirstLight` | Mandatory route, hammer tools, report recovery, Fox cleanup and leaf guards reviewed; canonical ground spawns added | 9 focused tests pass; spawn JSON/uniqueness/cache placements checked | Stage 12, rewards once and relog observed; a separate south-side hammer pickup/relog contract was accepted, while the latest peer review found three interruption/recovery defects still needing source repair |
| Between a Rock... | `BetweenARock` | Pending | Pending | Pending |
| Big Chompy Bird Hunting | `BigChompyBirdHunting` | Hunting, recovery, condition scope and combat/timer fixes reviewed | 14 focused tests pass | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Biohazard | `Biohazard` | Recovery and canonical receipts corrected; premature Guidor advancement returned to owner | Scoped source evidence; correction pending | Incomplete at stage 1; logged out |
| Bone Voyage | `BoneVoyage` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Cabin Fever | `CabinFever` | Pending | Pending | Pending |
| Client of Kourend | `ClientOfKourend` | Veos ownership/travel, orb handover and wire mapping, memoir recovery fixes pushed; independent review ongoing; lamp recovery remains under investigation | 9 focused handler tests pass | Pending |
| Clock Tower | `ClockTower` | Cog handling, shared lever, trough scope, surface exit and completion wire reviewed | 13 focused tests pass | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Cold War | `ColdWar` | Pending | Pending | Pending |
| Creature of Fenkenstrain | `CreatureOfFenkenstrain` | Pending | Pending | Pending |
| The Curse of Arrav | `CurseOfArrav` | Pending | Pending | Pending |
| Darkness of Hallowvale | `DarknessOfHallowvale` | Pending | Pending | Pending |
| Death on the Isle | `DeathOnTheIsle` | Captured item IDs, accusation bit and evidence recovery checkpoint reviewed; full parity review pending | 8 focused dispatch tests pass | Pending |
| Death Plateau | `DeathPlateau` | Harold’s IOU recovery, ordered condition checks and missing-item handouts use the imported transcript; shared runner now continues explicitly true linear sibling conditions | 47 shared/runtime and quest regressions pass | Natural completion and native recovery remain pending |
| Death to the Dorgeshuun | `DeathToTheDorgeshuun` | Pending | Pending | Pending |
| The Depths of Despair | `DepthsOfDespair` | Recovery/dialogue review and cache-backed stepping-stone approach fixed | 14 focused checks pass, including normal movement to the bank | Native route paused at stepping stones; corrected threshold awaits reload |
| Desert Treasure I | `DesertTreasureI` | Pending | Pending | Pending |
| Desert Treasure II - The Fallen Empire | `DesertTreasureII` | Pending | Pending | Pending |
| Devious Minds | `DeviousMinds` | Pending | Pending | Pending |
| The Dig Site | `DigSite` | Pending | Pending | Pending |
| Dragon Slayer II | `DragonSlayerII` | Pending | Pending | Pending |
| Dream Mentor | `DreamMentor` | Pending | Pending | Pending |
| Druidic Ritual | `DruidicRitual` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Dwarf Cannon | `DwarfCannon` | Pending | Pending | Pending |
| Eadgar's Ruse | `EadgarsRuse` | Pending | Pending | Pending |
| Eagles' Peak | `EaglesPeak` | Pending | Pending | Pending |
| Elemental Workshop I | `ElementalWorkshopI` | Pending | Pending | Pending |
| Elemental Workshop II | `ElementalWorkshopII` | Pending | Pending | Pending |
| Enakhra's Lament | `EnakhrasLament` | Pending | Pending | Pending |
| Enlightened Journey | `EnlightenedJourney` | Pending | Pending | Pending |
| Ethically Acquired Antiquities | `EthicallyAcquiredAntiquities` | Pending | Pending | Pending |
| The Eyes of Glouphrie | `EyesOfGlouphrie` | Pending | Pending | Pending |
| Fairytale I - Growing Pains | `FairytaleIGrowingPains` | Pending | Pending | Pending |
| Fairytale II - Cure a Queen | `FairytaleIICureAQueen` | Pending | Pending | Pending |
| Family Crest | `FamilyCrest` | Pending | Pending | Pending |
| The Feud | `TheFeud` | Pending | Pending | Pending |
| Fight Arena | `FightArena` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Fishing Contest | `FishingContest` | Pass/trophy recovery, Morris pass ownership, scoped pass gates and post-quest dialogue | 12 scoped tests pass; current-hash peer review clean | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Forgettable Tale... | `ForgettableTale` | Pending | Pending | Pending |
| The Forsaken Tower | `ForsakenTower` | Pending | Pending | Pending |
| The Fremennik Isles | `TheFremennikIsles` | Pending | Pending | Pending |
| The Fremennik Trials | `FremennikTrials` | Pending | Pending | Pending |
| The Garden of Death | `GardenOfDeath` | Pending | Pending | Pending |
| Garden of Tranquillity | `GardenOfTranquillity` | Pending | Pending | Pending |
| Gertrude's Cat | `GertrudesCat` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Getting Ahead | `GettingAhead` | Lost-head recrafting and interrupted flour-pour recovery reviewed | 9 focused tests pass, including registered sink filling | Pending |
| Ghosts Ahoy | `GhostsAhoy` | Pending | Pending | Pending |
| The Grand Tree | `GrandTree` | Pending | Pending | Pending |
| The Great Brain Robbery | `GreatBrainRobbery` | Pending | Pending | Pending |
| Grim Tales | `GrimTales` | Pending | Pending | Pending |
| The Hand in the Sand | `HandInTheSand` | Pending | Pending | Pending |
| Hazeel Cult | `HazeelCult` | Pending | Pending | Pending |
| The Heart of Darkness | `TheHeartOfDarkness` | Pending | Pending | Pending |
| Heroes' Quest | `HeroesQuest` | Pending | Pending | Pending |
| Holy Grail | `HolyGrail` | Pending | Pending | Pending |
| Horror from the Deep | `HorrorFromTheDeep` | Pending | Pending | Pending |
| Icthlarin's Little Helper | `IcthlarinsLittleHelper` | Pending | Pending | Pending |
| In Aid of the Myreque | `InAidOfTheMyreque` | Pending | Pending | Pending |
| In Search of the Myreque | `InSearchOfTheMyreque` | Pending | Pending | Pending |
| Jungle Potion | `JunglePotion` | Bounded natural stage 9→12 route, including lost-herb re-search; no full-quest completion claim | QP, quest Herb XP and cleaning XP, repeat/relog and save snapshot verified | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| King's Ransom | `KingsRansom` | Pending | Pending | Pending |
| A Kingdom Divided | `AKingdomDivided` | Pending | Pending | Pending |
| Legends' Quest | `LegendsQuest` | Pending | Pending | Pending |
| Lost City | `LostCity` | Pending | Pending | Pending |
| The Lost Tribe | `LostTribe` | Pending | Pending | Pending |
| Lunar Diplomacy | `LunarDiplomacy` | Pending | Pending | Pending |
| Making Friends with My Arm | `MakingFriendsWithMyArm` | Pending | Pending | Pending |
| Making History | `MakingHistory` | Pending | Pending | Pending |
| Meat and Greet | `MeatAndGreet` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Merlin's Crystal | `MerlinsCrystal` | Pending | Pending | Pending |
| Monk's Friend | `MonksFriend` | Rune timing, deferred reward settlement and named Monk variants corrected and reviewed | 11 focused tests pass, including real final transcript | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Monkey Madness I | `MonkeyMadnessI` | Pending | Pending | Pending |
| Monkey Madness II | `MonkeyMadnessII` | Pending | Pending | Pending |
| Mountain Daughter | `MountainDaughter` | Pending | Pending | Pending |
| Mourning's End Part I | `MourningsEndPartI` | Pending | Pending | Pending |
| Mourning's End Part II | `MourningsEndPartII` | Pending | Pending | Pending |
| Murder Mystery | `MurderMystery` | Pending | Pending | Pending |
| My Arm's Big Adventure | `MyArmsBigAdventure` | Pending | Pending | Pending |
| Nature Spirit | `NatureSpirit` | Pending | Pending | Pending |
| A Night at the Theatre | `ANightAtTheTheatre` | Pending | Pending | Pending |
| Observatory Quest | `ObservatoryQuest` | Pending | Pending | Pending |
| Olaf's Quest | `OlafsQuest` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| One Small Favour | `OneSmallFavour` | Pending | Pending | Pending |
| Plague City | `PlagueCity` | Pending | Pending | Pending |
| A Porcine of Interest | `PorcineOfInterest` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| Priest in Peril | `PriestInPeril` | Pending | Pending | Pending |
| The Queen of Thieves | `QueenOfThieves` | Pending | Pending | Pending |
| Rag and Bone Man I | `RagAndBoneManI` | Pending | Pending | Pending |
| Rag and Bone Man II | `RagAndBoneManII` | Pending | Pending | Pending |
| Ratcatchers | `Ratcatchers` | Pending | Pending | Pending |
| Recipe for Disaster | `RecipeForDisaster` | Pending | Pending | Pending |
| Recruitment Drive | `RecruitmentDrive` | Pending | Pending | Pending |
| Regicide | `Regicide` | Pending | Pending | Pending |
| The Ribbiting Tale of a Lily Pad Labour Dispute | `RibbitingTale` | Pending | Pending | Pending |
| Roving Elves | `RovingElves` | Pending | Pending | Pending |
| A Ruff Situation | `ARuffSituation` | Pending | Pending | Pending |
| Rum Deal | `RumDeal` | Pending | Pending | Pending |
| Scorpion Catcher | `ScorpionCatcher` | Pending | Pending | Pending |
| Sea Slug | `SeaSlug` | Stage-aware wall menu, crane reach, Holgart and canonical torch/sticks recovery reviewed | 15 focused cache/handler checks pass | Pending |
| Sheep Herder | `SheepHerder` | Pending | Pending | Pending |
| Shilo Village | `ShiloVillage` | Pending | Pending | Pending |
| Sleeping Giants | `SleepingGiants` | Pending | Pending | Accepted captured main route; later edits and uncovered recovery still need rechecks ([ledger](quest-helper-728-verification.md)) |
| The Slug Menace | `SlugMenace` | Pending | Pending | Pending |
| Song of the Elves | `SongOfTheElves` | Pending | Pending | Pending |
| A Soul's Bane | `SoulsBane` | Pending | Pending | Pending |
| Swan Song | `SwanSong` | Pending | Pending | Pending |
| A Tail of Two Cats | `TailOfTwoCats` | Pending | Pending | Pending |
| Tale of the Righteous | `TaleOfTheRighteous` | Pending | Pending | Pending |
| A Taste of Hope | `TasteOfHope` | Pending | Pending | Pending |
| Tears of Guthix | `TearsOfGuthix` | Pending | Pending | Pending |
| Temple of Ikov | `TempleOfIkov` | Pending | Pending | Pending |
| The Tourist Trap | `TouristTrap` | Cache transform parents, worn disguise, lost supplies, XP interruption and saved-stage migration reviewed | 21 focused checks pass | Pending |
| Tower of Life | `TowerOfLife` | Pressure plug rule, pipe piece model/position mirroring, renewable costume pieces, the basement wire step 17 and the mind-meter threshold repaired against the cache and the Quest Helper solver | 22 focused source-contract tests pass | No native playthrough; no completion claimed |
| Tree Gnome Village | `TreeGnomeVillage` | Tracker/ballista, orb recovery, transformed NPC and post-quest amulet routes reviewed | 7 focused checks pass, including full-bag repeat receipt regression | Pending |
| Tribal Totem | `TribalTotem` | Pending | Pending | Pending |
| Troll Romance | `TrollRomance` | Pending | Pending | Pending |
| Troll Stronghold | `TrollStronghold` | Pending | Pending | Pending |
| Twilight's Promise | `TwilightPromise` | Pending | Pending | Pending |
| Underground Pass | `UndergroundPass` | Pending | Pending | Pending |
| Wanted! | `Wanted` | Pending | Pending | Pending |
| Watchtower | `Watchtower` | Pending | Pending | Pending |
| What Lies Below | `WhatLiesBelow` | Pending | Pending | Pending |
| While Guthix Sleeps | `WhileGuthixSleeps` | Pending | Pending | Pending |
| Witch's House | `WitchsHouse` | Pending | Pending | Pending |
| Zogre Flesh Eaters | `ZogreFleshEaters` | Canonical import needs no source change; the three formerly `unavailable` nodes are now real messages the plugin already references; the Dragon Inn tankard dispatch is verified against the generated page | 11 focused tests pass | Stopped at stage 3 with 25 identical "I can't reach that!" on NPC 1320; cause is core reach (wandering NPC on unreachable counter-row tiles), not the quest plugin; natural completion pending |
| Learning the Ropes | `LearningTheRopes` | Pending | Pending | Pending |

## Separate tutorial

Learning the Ropes has no helper in the pinned Quest Helper source. Review its canonical
behaviour against the Wiki/cache and test its natural tutorial route separately; do not
claim Quest Helper parity for it. Source, regression and native checks: pending.

## Supplemental Waterfall route

The user-reported raft and rope crossing is covered separately from the 128 Quest Helper
issue quests. Source and focused peer review pass for the real raft-to-island route, rope
on the crossing rock, and rope on the dead tree to reach the waterfall ledge. A resumed
native run also confirmed the ordinary River Swim sends the player downstream and leaves
quest stage, QP, XP and inventory unchanged; the same account relogged and remained saved.
At the ledge, the no-amulet door refusal was observed, so this evidence establishes the
reported crossing and cave entrance, not cave entry or whole-quest completion. The native
artifacts are `/tmp/tsps-728/native/jobs/q131-epoch3.report.json` and
`/tmp/tsps-728/native/jobs/q131-riverswim.report.json`; source-only tests do not substitute
for this route evidence.

## Evidence and limits

Worker raw logs, captures, accounts and temporary drivers stay outside Git. Accepted
source facts, reproduced bugs, focused tests and native outcomes are recorded here as
batches are reviewed. Never mark a quest fully passed while mandatory legs or required
persistence/recovery checks remain unverified.
