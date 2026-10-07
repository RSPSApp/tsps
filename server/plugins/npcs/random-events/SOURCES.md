# Random events

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

The original OSRS scheduling formula is unpublished. This first batch uses Void's
60–120 minute cooldown, three-minute lifetime and 18-second reminders. Busy/combat,
bots, instances, duels and Tutorial Island are excluded. Tutorial's bounds are copied
from the existing TutorialIsland plugin. Managed areas are conservatively excluded
except ordinary PvP ground; full activity-specific eligibility is deferred. No events
spawn while the `random-events:enabled` config is false; existing events still expire.

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
Live-client appearance remains unverified. Quiz Master and his mystery-box loot
table, Maze and Mime remain separate future content batches.
