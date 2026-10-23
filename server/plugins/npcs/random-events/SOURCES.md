# Random events

[Pinball](https://oldschool.runescape.wiki/w/Pinball) gives five noted sapphires,
emeralds or rubies at 3/10 each, or two noted diamonds at 1/10.
[Flippa's transcript](https://oldschool.runescape.wiki/w/Transcript:Flippa) supplies
the yes/no invitation. In cache revision 241 the invitation is NPC 6744 (`FLIPPA_2`),
with `Talk-to` and `Dismiss`; NPC 5427 (`FLIPPA`) is the two-tile room variant
with only `Talk-To`, whose spelling does not match the invitation action hook.

This plugin adapts existing implementations rather than inventing event control flow.
Full upstream notices are retained in [LICENSES.txt](LICENSES.txt).

* [Void RandomEvents.kt](https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/activity/event/random/RandomEvents.kt): initial cooldown, eligibility and re-arm before spawn attempt.
* [Void InPlaceRandomEvent.kt](https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/activity/event/random/InPlaceRandomEvent.kt): owned follower, reminder/lifetime and orphan cleanup.
* [Void SandwichLady.kt](https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/activity/event/random/sandwich_lady/SandwichLady.kt): ownership, requested food, tray selection and clearing state before serving.
* [Void RandomEventGift.kt](https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/activity/event/random/RandomEventGift.kt): lamp skill selection, ten times base level XP and consuming its slot. Local chatbox prompts provide selection/confirmation; XP uses existing world/account restrictions.
* [Void Certer.kt](https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/activity/event/random/certer/Certer.kt): three distinct shuffled choices, owner checks, correct reward and ending a wrong answer without reward. OSRS interface 184 replaces RS3's interface/enums, and OSRS gifts replace RS3 reward bags.
* [LostCity Genie](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/scripts/general/macro_event_genie.rs2) and [Drunken Dwarf](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/scripts/general/macro_event_drunken_dwarf.rs2): owner/non-owner reward flow, lamp and kebab/beer reward data.
* [LostCity macro_events.rs2](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/scripts/macro_events.rs2): adjacent traversable spawn square.
* [LostCity Mysterious Old Man](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/scripts/general/macro_event_mysterious_old_man.rs2): direct-gift follower/ownership flow. Current OSRS gift data uses the shared Rick/Certer table; historical forced teleports are omitted.
* [LostCity triffid](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/scripts/general/macro_event_triffid.rs2) and [NPC config](https://github.com/LostCityRS/Content/blob/d188d6a6921c6cdc2309962c1bc2bac94fd2d6d3/scripts/macro%20events/configs/antimacro.npc): stationary growth animation, owner-only picking, immature refusal and 45-tick maturity. Current OSRS has dismissal and no hostile stage.

These clean local checkouts were inspected alongside the listed OpenRune and Project
Gielinor repository trees, which contained no reusable implementations of these events.
Void is RS3 and LostCity is historical RuneScape: current OSRS behaviour wins.
[Sandwich lady](https://oldschool.runescape.wiki/w/Sandwich_lady) supplies the seven
OSRS choices, 1/64 stale baguette chance when baguette is offered, and harmless
wrong choices; RS3 gift bags/doughnuts and historical attacks/teleports are omitted.
[Genie](https://oldschool.runescape.wiki/w/Genie) supplies the lamp and dismissal;
[Drunken Dwarf transcript](https://oldschool.runescape.wiki/w/Transcript:Drunken_Dwarf)
supports other players seeing/talking to the NPC with owner-only rewards.
[Scaled XP](https://oldschool.runescape.wiki/w/Module:ScaledExperience/doc) confirms
ten times skill level. Sandwich foods follow the Wiki food pages, including
[baguette](https://oldschool.runescape.wiki/w/Baguette) and
[meat pie](https://oldschool.runescape.wiki/w/Meat_pie).

Cache 237 verified NPCs 326/5510/322 and their Talk-to/Dismiss actions, lamp 2528 Rub,
and reward Eat actions. `yarn dump:widget 297` and `yarn dump:cs2 1358`/`2267`
confirm sandwich tray root/title2/selectors6–12 and model angle initialization.

The [Random events Wiki page](https://oldschool.runescape.wiki/w/Random_events) records
Mod Ash's timing details: pick a real-time due timestamp 60–120 minutes after the last
event, check every five minutes of in-game time, and if it became due offline, move it
forward by 10–70 minutes. The next timestamp is persisted as `random-events:next-at`;
the due check stays armed while busy and is re-armed before a spawn attempt. Event
definitions are selected uniformly after filtering; teleporting events are excluded in
PvP Wilderness, and transformed players are ineligible. Ignored events expire after
one minute; an event's dismissal or completion does not reset its timer. A due event
stalled by a busy action remains pending and is attempted when that action clears. The
18-second attention reminder has no published interval and remains an implementation detail.

Combat is not a blanket scheduler veto. This interprets the Wiki's
[Trivia](https://oldschool.runescape.wiki/w/Random_events#Trivia), which describes the
post-2014 events as independent of the player's activity, alongside Spawn mechanics'
location/transformation exclusions and interface/Make-X stalls. The Wiki does not state
a separate combat eligibility rule; no packet capture verifies that edge case. Spawning
an invitation never teleports the player: `Teleports.begin` runs only after accepting
the event's dialogue. A regression covers a Mime invitation with combat target, attacker
and combat-following set, including ignoring and declining it without movement.

Normal-world rsprox captures 3147/rev232 and 2483 show an emote-unlock interface and
initial Count Check placement only; they provide no spawn-timing evidence.

The Wiki also lists many no-event zones and says old Hunter areas block teleporting
events. Managed `Area` instances are conservatively treated as unavailable, except the
Wilderness where only non-teleporting events remain eligible. This avoids spawning in
unclassified managed boss/minigame/bank areas but also suppresses events in safe managed
areas. The server exposes no shared zone metadata for ordinary banks or old Hunter
areas, so their exact boundaries and exceptions remain unimplemented pending reliable
coordinates or flags.
No events spawn while the `random-events:enabled` world config is false; active events
still expire.

Rewards require inventory capacity and retain the event on failure. Stackable gifts
can join an existing stack; Jekyll's exchange frees its exact herb slot. State clears
before adding items, callbacks check server ownership and the lamp's exact slot/item,
and logout/disconnect/death invalidate pending rewards. Expiry/distance/instance
changes remove followers. All 24 cache skills are selectable via existing prompts;
blocked/maxed XP retains the lamp. No native reward interface 240 reconstruction,
dependencies or core feature hooks are needed.

Owners can test with `::randevt [id]`, bypassing the natural cooldown and scheduler
enable flag. Omit the index for a random event. The zero-based indices are:
0 Genie, 1 Sandwich Lady, 2 Drunken Dwarf, 3 Rick Turpentine, 4 Certers,
5 Mysterious Old Man, 6 Dr Jekyll, 7 Strange Plant. F2P only exposes indices 0–5.
The command replaces your previous event using its normal cleanup, and retains
eligibility, traversable spawning, ownership, expiry and reward checks. Its
description is registered for command search.

Verify after build: `node --test tests/random-events.test.cjs tests/food-effects.test.cjs`.
These tests exercise real plugin registration with controlled lifecycle/collision/
inventory adapters, plus the real Inventory reward path. From `client/`, run
`yarn tsx tests/widget-loader.test.ts` to check the plugin's actual selection flags
against the current cache decoder/menu builder. These do not replace a live-client
visual check of tray rendering.

## Rick Turpentine, Dr Jekyll and Certers

[Rick Turpentine](https://oldschool.runescape.wiki/w/Rick_Turpentine),
[Certer](https://oldschool.runescape.wiki/w/Certer) and
[Dr Jekyll](https://oldschool.runescape.wiki/w/Dr_Jekyll) supply current OSRS behaviour.
Direct Wiki reads were blocked; the current Wiki text was inspected through
[Rick's mirror](https://osrsindex.com/wiki/rick-turpentine?site=osrs_wiki),
[Certer's mirror](https://osrsindex.com/wiki/certer?site=osrs_wiki) and
[Jekyll's mirror](https://osrsindex.com/wiki/dr-jekyll?site=osrs_wiki).
The local NPC dialogue dataset independently confirms Jekyll's herb/potion pairs.
No reusable Rick/Jekyll implementation was found in the listed local reference
sources, so their handlers adapt the established owner/gift lifecycle.

Rick and Certers share the Wiki's estimated 150-entry weighted reward table:
coins, kebab, spinach roll, four uncut gems, cosmic talisman and key halves.
Key halves become 640 coins in F2P. Rewards are rolled once, retained across
inventory failures, and cannot be rerolled by reopening dialogue/interface.
[Spinach roll](https://oldschool.runescape.wiki/w/Spinach_roll) heals two;
RuneLite's local `ItemStatChanges.java` confirms this food value.

Jekyll is a separate `members: true` plugin. It contributes its spawn definition
through the generic `random-events:definitions` custom event during startup;
F2P excludes Jekyll; the final event counts are listed below. The fourteen clean,
unnoted herb exchanges follow the Wiki, including torstol → stamina(4), and
the no-herb/refusal reward is strength(2). Huasca is not accepted. Each talk
rechecks inventory so banking can change the requested herb, while callbacks
validate the active event, current prompt and exact captured herb slot/item.
There is no obsolete Mr Hyde punishment.

Cache 237 verifies NPCs 375/307/5436–5438 with Talk-to/Dismiss and rewards with
their normal Eat/Drink actions. `yarn dump:widget 184` verifies Certer model7,
texts1–3 and selectors8–10 (option1). Cache quiz-presentation items 6189/6191–6198
have the expected model/angles/zoom. RuneLite's generated `ItemID.java` gives
their food/weapon/armour/tool/jewellery categories, and the historical
[presentation-item list](https://runescape.wiki/w/Hex_edit_detected) identifies
fish, sword, battleaxe, helmet, shield, shears, spade, ring and necklace.
Both fish models have the same answer; one is used to keep nine distinct choices.
The question stays fixed when reopened; incorrect answers end the event without
reward, and expiry/dismissal/lifecycle cleanup close an owned open interface.
Both Certer and Sandwich selectors have cache flags2 and use option1;
opening either interface enables that option with flags2 on the exact selectors.
The dump script now reads cache 237's four-byte model ID, matching the client;
its old two-byte decoder shifted the actions/flags and incorrectly suggested option2.
Other packet options are rejected by the handlers.
The Certer brothers share one event weight.

Tests cover all fourteen herb exchanges, F2P exclusion/key replacement, correct
and incorrect answers, packet option/owner/interface checks, full inventory,
stacked coins, stale prompts, banking changes and duplicate reward prevention.
Native Certer/tray appearance still needs a live-client visual check.

## Mysterious Old Man and Strange Plant

The direct-gift [Mysterious Old Man](https://oldschool.runescape.wiki/w/Mysterious_Old_Man)
event now shares the owned gift/retry/dismissal flow. The current
[random-events Wiki mirror](https://osrsindex.com/wiki/random-events?site=osrs_wiki)
confirms direct gifts remain available on members worlds since November 2023;
Rick's Wiki reward references also confirm the shared table/key substitutions.
This does not implement his separate Maze or Mime invitations.
RuneLite's generated `NpcID.java` distinguishes `MACRO_MYSTERIOUS_OLD_MAN` 6750
from underwater 6751, maze 6752, mime 6753 and the unrelated static 6742 NPC.
Cache 237 confirms 6750 has Talk-to/Dismiss.

[Strange Plant](https://oldschool.runescape.wiki/w/Strange_plant), read through its
[Wiki mirror](https://osrsindex.com/wiki/strange-plant?site=osrs_wiki), supplies
members-only spawning, growth before picking, one fruit, optional dismissal and
the private three-hour ground reward when inventory is full. The plant stays
at its spawn square and never follows, speaks or attacks. LostCity's 45-tick
growth timer is the timing reference (27 seconds); the current Wiki does not
specify exact maturity timing. Cache 237 confirms NPC323 Pick/Dismiss and
idle349; `yarn dump:seq 348` confirms the growth animation, whose frame lengths
sum to 25.6 seconds. The shared lifecycle removes the plant on reward, dismissal,
expiry, distance or player cleanup; the historical post-pick animation delay is
not reproduced.

[Strange Fruit](https://oldschool.runescape.wiki/w/Strange_fruit), read through its
[Wiki mirror](https://osrsindex.com/wiki/strange-fruit?site=osrs_wiki), supplies
item464 Eat, +30 run energy, poison/venom cure, about 18 seconds of protection
against standard poison/venom reapplication, and no Hitpoints restoration.
It uses canonical Food data and the same run-energy/cure helpers as Potions;
the standard immunity timer covers reapplication but does not stop custom
poison-like damage. Existing longer protection is retained. Zero-heal food
preserves already-overhealed HP. The dropped fruit uses the existing floor-item
clock with a negative initial tick, expires after 18,000 server ticks, and never
becomes public; tests exercise its real `ItemOnGround.process()` lifecycle.

The scheduler now selects among eight events on members worlds and six on F2P.
Tests cover growth boundaries, owner checks, exactly-once gifts/fruit, full
inventory ground visibility/lifetime, dismissal and lifecycle cleanup, F2P
exclusion, and actual fruit consumption with cooldown, slot and effect checks.
Live-client appearance remains unverified.

## The remaining events

The second batch implements all of the wiki's remaining random events: Beekeeper,
Capt' Arnav's Chest, Count Check, Drill Demon, Evil Bob (island), Prison Pete,
Evil twin, Freaky Forester, Gravedigger, Kiss the frog, Maze, Mime, Pillory,
Pinball, Quiz Master and Surprise Exam. Behaviour comes from the current OSRS
Wiki pages and transcripts (old-school.runescape.wiki `Random events` and each
event page), read directly; where a transcript sentence is reproduced, the wiki
is the source. No new upstream code was copied, so LICENSES.txt is unchanged.

Event control flow reuses the first batch's owner/follower/expiry lifecycle. An
accepting dialogue starts a **session** (`Teleports.RandomEvents.js`): the return tile is
remembered, the player is moved to the event area, the invitation NPC is removed
without a reward, and a `RandomEventArea` per destination ends the session when
the player leaves by any route (teleport, death, command). Teleports inside a
session are refused; the return tile is persisted before moving, logout restores it
before save, and crash recovery restores the exact tile (Lumbridge is only the fallback
when no return tile was saved). Event areas, scenery and the
static NPCs (Mime, Sergeant Damien, the forester and pheasants, Evil Bob, the
servant, Prison Pete, the graves, maze and pinball props, the beehive field, the
quiz room, the exam classroom and the pillory cages) already ship in the world
and cache data; each module spawns only its dynamic pieces (signs are the map's
own posts, swapped between the four exercise ids; balloons, Leo, Molly, Flippa,
the beekeeper and the event NPCs are owner-scoped).

Where the cache ships the real interface and its components transmit, that
interface is used: Capt' Arnav's combination lock (26, varbit-free model swaps
and arrow/confirm ops), the Beekeeper hive (420, part slots drawn with the
example's raw models and the Confirm button), the Mime emote buttons (188,
enabled with flags because the cache's onLoad builds their ops), the Pillory
lock (27, key models, the three key buttons and the lock/flash components), the
Surprise Exam pattern (103) and cards (559) interfaces, the Prison Pete lever
panel (273), and the Evil twin claw controls (277). The Maze's reward HUD is
varp 531, as the cache's script 956 reads. Quiz Master's cache interface (191)
has no item components, so the three items of "Odd One Out" are shown on a
server-defined interface (`registerCustomInterface`, group 30012) whose model
components are set with the macro quiz items 6189-6198; clicks are ordinary
widget ops.

Rewards follow each wiki page: outfit pieces are granted in the page's order and
skipped when `Teleports.owns` finds them in inventory, equipment or bank; once
the set is complete the event pays the fallback (flax/coins for the beekeeper,
lamps elsewhere). Coins use the genuine item, the Prison Pete/maze/pillory gem
and rune rewards use the noted cert ids so they stack. Lamps and the Book of
Knowledge share the existing xpreward interface (10 x and 15 x level). Mystery
boxes roll 1/256 stale baguette, then the F2P or members prize table; the
members clue-scroll and rare-drop slots are represented by their common
outcomes. Deliberate deviations, all noted here: Count Check passes because this
server has no bank PIN feature and every account is effectively a Jagex account;
Drill Demon's post-outfit exercise emotes are not modelled (the lamp is paid);
Beekeeper placement is driven from the chatbox options while interface 420
mirrors the parts, because the client cannot transmit the cache's drag; Mime
counts four correct copies without resetting on a mistake, as the wiki does not
describe a reset; the Evil twin claw position is reported in chat rather than by
a moving claw model; the King's return from Frogland uses a spawned royal.

`::randevt [id]` now lists all 24 events on members worlds and 22 on F2P (Dr
Jekyll and the Strange Plant are members-only). The zero-based order is: 0 Genie, 1 Sandwich Lady,
2 Drunken Dwarf, 3 Rick Turpentine, 4 Certers, 5 Mysterious Old Man, 6 Dr
Jekyll, 7 Count Check, 8 Kiss the frog, 9 Capt' Arnav, 10 Beekeeper, 11 Quiz
Master, 12 Drill Demon, 13 Freaky Forester, 14 Gravedigger, 15 Pinball, 16 Evil
Bob, 17 Prison Pete, 18 Evil twin, 19 Maze, 20 Mime, 21 Pillory, 22 Surprise
Exam, 23 Strange Plant. F2P omits Jekyll, so its indices shift down by one after
index 5. The command still bypasses the cooldown and enabled flag but requires the
player to be outside restricted actions and areas, including private instances and
Tutorial Island.

Verify after build: `node --test tests/random-events.test.cjs`. The 54 tests
cover every new event's registration, dialogues, interfaces, mechanisms, reward
progression, owner checks, wrong-answer paths, expiry and cleanup, plus the
Mystery box and Book of Knowledge reward paths. From `client/`, `yarn tsx
tests/widget-loader.test.ts` still checks the first batch's selectors against
the current cache. Live-client appearance of the new interfaces remains to be
checked visually.
