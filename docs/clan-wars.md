# Clan Wars: legacy-channel melee team battles

This is a bounded playable slice of the team activity in tracker #153. It does not
complete that tracker or implement every Clan Wars option. Ferox's existing white
free-for-all portal remains separate.

## Sources

- [OSRS Wiki: Clan Wars](https://oldschool.runescape.wiki/w/Clan_Wars): captain-or-higher
  legacy chat-channel challenges, negotiated terms, two minutes of preparation behind
  a separating wall, safe deaths, jail, Last Team Standing's entry cutoff and the
  maximum of 100 fighters per side.
- [OSRS Wiki: Clan Settings](https://oldschool.runescape.wiki/w/Clan_Settings): modern
  clans have an Initiate Clan Wars permission for sending and receiving challenges.
  This implementation deliberately supports the legacy chat-channel path only.
- [Revision 241 dump, pinned snapshot](https://github.com/Joshua-F/osrs-dumps/tree/6e5033af6215963581a51b348f452320ff18f0f6):
  `clanwars_setup`, `clanwars_confirm`, `clanwars_hud`, `clanwars_gameover`;
  scripts 554, 591 and 592; enum 374 (mode), 929 (arena), 2340/2341 (team cap).
  These establish client contracts, not server defaults or death policies.
- Original LTS delivery, revision 241 cache/map: Challenge portal at 3126,3620; Plateau template
  region 51,77, its paired dark-rock Forfeit portals and east-side jail exits.
  The selected landing and jail tiles were checked against real collision.
- No team setup, HUD, result or viewing interface appeared in the inspected local
  capture corpus. Recording 229/02489 is free-for-all footage and is not team-match evidence.
  The tracker-linked Void implementation explicitly leaves its challenge portal unimplemented.

## Player flow

Two captains or channel owners in the Clan Wars building right-click each other and
choose Challenge. Reciprocal requests open the native setup interface. The offered
configuration is **melee-only Last Team Standing, First to X kills or timed Most kills on Plateau, Sylvan Glade, Forsaken Quarry or Soggy Swamp**;
this is an explicit supported configuration, not a claim about official default settings.
The team cap, supported mode, bounded restrictions and departure/rejoining terms described below are negotiable. Other combat controls are hidden; unsupported arenas and
objective mode selections are refused and reset to the server offer.

Revision 241 cap indices are Uncapped, 1v1, 5v5, 10v10, 15v15, 20v20, 50v50 and
100v100. Uncapped still respects the absolute 100-fighter maximum. Both captains
accept setup, then independently accept a native confirmation listing every fixed term.
The server revalidates live player identity, location, channel, rank, offer revision and
modal ownership at acceptance. The cache's three-second confirmation delay and
five-second opponent-change delay also have server checks, rounded up to game ticks.

Both chat-channels are notified. Members use Enter or Join on the purple portal and
confirm the agreed terms. For Last Team Standing, the 200-tick preparation period starts when both captains
finish confirming, not when the first player enters. At its end the wall is removed,
combat starts and further entry is refused. Team, instance, staging and jail boundaries
are checked through the production combat policy. Ranged and magical attack methods
are refused. Prayers, food, drinks and melee special attacks use their existing systems;
powered staves and Vesta's blighted longsword are not enabled by these terms.

Death keeps the real inventory and equipment, including metadata. No kit or item
snapshot is reconstructed. Food, drink and weapon charges are consumed normally.
A defeated fighter goes to the map's jail if the battle is still running. In Last
Team Standing's Kill-all setting, the team with no fighters loses. The negotiated
Ignore-5 variant described below ends at five or fewer. Result screens return remaining participants to the lobby.
There are no stakes, prizes, blood-money rewards, Elo changes or ordinary PvP streak
changes. The existing PvP statistics/reward query is vetoed throughout a match death,
including when the battle finishes before the death callback completes.

Presets are refused while participating or awaiting a safe death callback. Normal
logout removes match ownership and saves the lobby position. An interrupted save has
a persistent participation marker; its next login returns to the lobby before the
initial scene without reconstructing or discarding carried items.

The purple portal shares the existing white-portal saved XP preference through
`clan-wars:xp-setting`. The Ferox unit owns that key and its prompt; the team plugin
only queries it when considering XP inside its own match.

## Unrecorded choices and remaining scope

The wording, challenge-building rectangle, landing/wall placement, no-show cancellation,
withdrawal/disconnect elimination and simultaneous-empty cancellation are implementation
choices where no exact team recording was available. Both-empty ends without a winner;
there is no guessed reward or penalty. Cache collision verifies separation and reachability,
but does not establish official server placement or cleanup policy.

Other arenas, the remaining combat restrictions, King-of-the-Hill/Oddskull
modes, modern-clan selection, outside/lobby spectating, exact official messages and exact team-specific
ammunition/skull/charge restoration behavior remain outside this slice. The melee-only
restriction avoids introducing an unverified ammunition-return implementation. No dangerous
or item-loss variant is imported from older RuneScape reference servers.

## Production path and focused verification

- Native OPPLAYER4 -> pre-walk `player:option-route` -> real movement callback ->
  `Negotiation.ClanWars`; current channel/rank comes from `friends-chat:channel`.
- Native setup/confirmation IF_BUTTON1 -> current interface and offer checks -> match.
- Real purple portal object dispatch -> native join confirmation -> private template area.
- Combat -> `CombatFactory.canAttackByPolicy` -> the instance's team/stage/method policy.
- `PlayerDeathTask` -> `player:dying`, safe-drop query, defeated observers and respawn:
  a separate pending-death owner survives result/instance cleanup.
- Focused tests use actual players, channels, native packets, cache objects, instances,
  combat policy, inventory/preset producers, death tasks and save codecs. Independent
  collision checks verify preparation separation, combat connectivity and jail isolation.
- Regressions retain stale portal-confirmation ownership, the HUD's actual toplevel
  mount and interrupted-save recovery. The original LTS delivery
  used native browser QA for the visible negotiation,
  portal, countdown, combat and win/loss flow. Exact live OSRS timing/presentation parity
  is not claimed from these checks.


## First-to-X-kills battles

The kill-target extension uses [Wiki Clan Wars revision 15379109](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
for targets, late entry, death-to-jail and unrestricted rejoining. Revision 242's
[pinned enum dump](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/config/dump.enum)
confirms modes 1–8 and enum 376 targets: 25, 50, 100, 200, 500, 1,000, 5,000 and
10,000 kills. Enum 2337 describes fixed leaving-channel rule 0 as counting toward
the opposing team's kills; enum 2339 describes rejoining rule 0 as unrestricted.
The earlier revision-241 references above describe the original LTS delivery;
the extension checks its contracts against the active revision 242 cache.

The native setup scrollbox creates each clickable mode row at subchild `3 * mode`
(script 576). Every native mode row transmits so the server can reset an unsupported optimistic
client selection. Both confirmation stages list the
chosen target. A mode change preserves the cap, invalidates both acceptances and
applies the existing opponent-change delay. Objective rows are refused; timed modes are described below.
The existing HUD consumes the chosen `clanwars_wincondition` and `clanwars_kills_1/2`
through script 595, showing the target and both scores.

Preparation is unchanged. During combat, channel members can still use the purple
portal to join, subject to the agreed cap. A defeated fighter retains their roster
slot through the production safe-death callback and goes to their team's existing
jail. Using that jail's Portal / Exit returns them to their team's landing, without
an additional timer or item reconstruction. Jailed and dying players cannot fight.
They retain a cap slot so another entrant cannot crowd out their unrestricted
return. The native Portal / Exit control and landing choice are implementation
choices supporting the Wiki's return-to-battle rule; exact retail placement and
presentation were not established from a team-match recording.

An opposing participant identified by the real death task's captured damage owner
scores one kill; the sourced target immediately ends the match. Unattributed,
self and same-team deaths award no inferred kill. A living fighter leaving the
channel gives the opposing team one kill under the fixed counts-as-death rule;
a fighter already dying or jailed cannot be counted twice. Exact retail credit
for unattributed deaths and logout ordering is unrecorded. Forfeit and disconnect
remove participation through the existing lifecycle. Empty rosters end the match,
while a temporarily empty set of living fighters does not turn this mode into LTS.
This withdrawal/no-show policy is an explicit cleanup inference. Final-kill cleanup
retains pending-death safety through the callback, clears channel reservations and
HUD state, and allows a fresh second match.

Focused native tests seed scene placement and pre-rolled melee damage, then use
real negotiation packets, attack input, hit queues, death tasks, actual cache
portals and instance ownership. They are deterministic server-path evidence;
these supplied inputs do not establish natural combat RNG or a rendered client
playthrough. Runtime results and independent acceptance are reported with the PR.


## Timed Most-kills battles

[Wiki Clan Wars revision 15379109](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
says the team with the most kills for the selected duration wins and fighters may
enter at any time. The primary [Clan Wars Game Modes & More update, revision 11842615](https://oldschool.runescape.wiki/w/Update:Clan_Wars_Game_Modes_%26_More?oldid=11842615)
describes mutually selected timed deathmatch, won by the most kills in the set period.
The same pinned revision-242 enum dump above maps modes 16–20 through enum 1119 to
5, 10, 20, 60 and 120 minutes. These are 500, 1,000, 2,000, 6,000 and 12,000 server
ticks at the engine's 600ms processing cycle.

The native mode rows and both confirmation stages select the duration while
preserving the fighter cap and fixed melee terms. Preparation retains the full
selected duration. Combat time starts when the preparation wall is removed.
The existing safe-death, jail Exit, late entry and cap reservation rules apply.
Return is unrestricted under rejoining rule 0; the negotiated delay and
leaving-channel choices are described below. Having no living fighters temporarily does not
end a respawning battle. The earlier explicit empty-roster withdrawal/no-show
cleanup policy also remains; this is not evidence of exact retail forfeit behavior.

At the deadline the higher authoritative kill score wins. Equal scores end without
a winner using script 592's neutral “Game Over!” presentation. Exact tie and callback
ordering are unrecorded implementation policies: scoring occurs at the death task's
first `player:dying` callback, and callbacks at or after the deadline add no score,
even if the lethal hit occurred beforehand. The deadline also blocks further
combat, entry and jail return, and is resolved before a channel-leave penalty.
Queued deaths remain safe across result and instance cleanup, using the shared
pending-death owner before match membership is removed.

Revision-242 script 595 shows scores when enum 1119 is nonzero. Timer varbit
`clanwars_timeremaining` has bits 0–14, sufficient for the 12,000-tick maximum.
Script 213 pauses the display while the preparation countdown is positive and
converts each server tick to 30 client cycles; script 744 formats 50 cycles per
second. Scripts 213/743 resynchronize and count down the native timer. Scores use
the existing 16-bit varbits 4290/4291: script 595 displays “Lots!” at 65,535, so only
the outbound HUD saturates there. Full server scores determine the winner. Cleanup
clears the timer and scores; a following untimed match starts with zero timer.

The existing fixture covers all five native mode selections, preparation and timer
units, a complete 500-tick five-minute battle with real melee hit/death tasks,
respawn/portal return, late entry, unequal and tied results, cleanup and a second
untimed battle. Exact-deadline and large-score checks use explicit clock/score
checkpoints; they do not claim 65,536 naturally earned kills or retail event ordering.
Outgoing native-script argument observations pass through the real packet sender
and do not establish rendered-client presentation. Runtime outcomes and independent
acceptance belong to the PR evidence, not these coverage descriptions.


## Viewing orbs for jailed members

[Viewing orb (Clan Wars), Wiki revision 15201300](https://oldschool.runescape.wiki/w/Viewing_orb_(Clan_Wars)?oldid=15201300)
describes Use from post-death waiting areas. Its Plateau anchors are 3323,4956
and 3323,4963. The pinned revision-242 cache identifies the active orb as LOC
`clanwars_viewing_start_darkrock` (26741), Use, model 9752. Admission resolves the
actual object in this match's template; a matching name elsewhere grants no view.
This does not add a lobby selector or let outsiders watch arbitrary teams.

The native interface is `clanwars_view` (93), with centre, southwest, southeast,
northwest and northeast controls (components 4–8), and Close (component 3).
Scripts 562–567 supply the selected orb's presentation; script 29 sends IF_CLOSE.
They do not supply server camera coordinates. The centre and quarter-map points
are explicitly chosen within the mapped private Plateau, not claimed as exact
retail camera placement or rates. The viewer moves to the selected view point
while remaining a jailed nonfighter, hidden, untargetable and movement-blocked.
The existing private-area player-sync filter and a temporary wide view radius
keep this battle visible without exposing other instances.

Closing the native interface restores the saved jail position, appearance
visibility, fixed-view-distance configuration, movement and targetability guards,
and supported server camera mode. Known follow and untimed target modes are snapshotted;
a timed target glide or other in-flight camera scene is refused without changing it because its actual
client interpolation/yaw/pitch is not observable or resumable by this server.
Additive shakes and the scripted pitch-unlock constraint do not change that base
camera mode, so ending them cannot strand an otherwise normal player outside
viewing. Ending either modifier also cannot release a genuinely controlled shot.
The reset on leaving viewing clears additive shake/pitch modifiers; they are not
part of the saved base-mode contract.
The close, replacement-modal, jail-return, removal, death and match-finish routes
relinquish viewing ownership before resetting anything, so reentrant cleanup
cannot close a replacement interface. Death-task movement/targetability locks
remain owned by the death task, and nonfighter deaths earn no extra kill.
Visibility is ephemeral, not a saved item/appearance change or NPC disguise.

The existing Clan Wars fixture gains real bound session flushes and production
visibility-bucket/local-player updates for viewer cases, following the established
quest-scene-return-state fixture. It uses actual mapped orb Use, native View and
IF_CLOSE packets, outgoing camera packets and both appearance producers, with
cache invalidation, two observers, a separate match and restoration controls.
Jail adjacency, lethal HP and an overlapping-coordinate visibility checkpoint are
supplied setup. The transport is inert and no rendered-client or natural walking,
combat RNG, login or camera-angle parity claim follows from these checks. Actual
runtime outcomes and independent acceptance belong to the PR evidence.


## Negotiated melee restrictions

Wiki Clan Wars revision 15379109 and the pinned revision-242 cache agree on food
and drinks Allowed/Disabled, prayers All allowed/No overhead icons/Disabled, and
special attacks Allowed/No Staff of the Dead/Disabled. This slice offers food and
drinks values 0/1, prayer values 0/1/2, and special-attack values 0/2. The Staff-only
value 1 remains deferred and is refused/reset to the server offer. Melee stays
allowed, ranged stays disabled and magical combat stays disabled; no ammunition,
charge or item restoration rule is added.

The native setup uses interface 91's food/drinks/prayer/specialattacks containers
23–26 and dropdowns 38–41. Their label/tooltips come from enum pairs 921/922,
923/924, 919/920 and 925/926 respectively. Script 2877 creates a highlight child 0
and one option child per value at index + 1. Script 2878 calls 573 to update the
client's optimistic varbit; unsupported values therefore transmit too and are
reset. Changing any agreed term preserves all other terms, clears both acceptances
and applies the existing opponent-change delay. Both captain confirmation and
member entry confirmation show the complete frozen offer.

Restrictions apply from entry, including preparation and jail, until removal.
This participant-wide boundary is an implementation policy where no relevant team
recording supplies exact staging/jail exceptions. Food and potion producers keep
ownership of effects, timers, dose/leftover items and metadata; a refusal occurs
before those mutate. No Food follows the existing canonical Food and food-permission
potion classification, including healing drinks that already request food permission.
Food-owned Drink items are also covered by No Drinks. Thus No Food alone, No Drinks
alone and both together refuse those Food-owned drinks; No Drinks alone permits
ordinary Eat items. This is an explicit TSPS classification boundary, not a claim
that every drink's retail classification has been recorded. Passive nonconsumables
are not newly classified as food, so the existing phoenix-necklace behavior remains.
The separate Dwarven rock cake producer remains unchanged too: it is never consumed,
heals nothing and queues self-damage rather than using Food's consumption permission.
Its Eat/Guzzle action label alone does not expand the supported food classification;
this preserves the existing implementation and makes no retail exception claim.

Normal and quick-prayer activation use the existing prayer permission path.
Overheads are identified by the prayer definition's head icon; No overheads keeps
non-overhead boosts, while No Prayer refuses all activation. Forbidden prayers
already active before entry are cleared, because the activation path returns early
for an active prayer. Similarly, a pre-armed special is disarmed on entry/rejoin;
normal and instant utility activations use the existing special permission hook,
and the arena also refuses an armed special when specials are disabled. No points,
special energy or consumed items are reconstructed on exit.

The existing native fixture covers the four setup controls, no-op and stale input,
all-term preservation, acceptance delays and both confirmations; native inventory
Eat/Drink/Wield, normal and quick-prayer setup/toggle, queued-special activation and
an instant utility special. It also checks pre-active entry, refusal resource and
metadata preservation, both consumption backends, cleanup/outsider allowances and
a real core nonlethal-damage callback for passive-item preservation. Supplied
levels, placement and that damage are explicit setup; no full login, natural RNG,
rendered client or exact retail classification/timing claim follows. Runtime
outcomes and independent acceptance belong to the PR evidence.


## Negotiated departure and rejoining terms

[Wiki Clan Wars revision 15379109](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
lists Leaving channel as Counts as death / No penalty and Rejoining as Unrestricted /
60 sec delay. The same pinned revision-242 dump has those labels and tooltips in
enums 2336/2337 and 2338/2339. Setup interface 91 uses containers 28/29 and dropdowns
42/44. The shared scripts create option subchildren at value + 1; script 573 sets
the corresponding optimistic varbits. Both terms offer values 0/1, preserve all
other negotiated terms and appear on both captain and member confirmations.

No penalty suppresses the existing living-fighter channel-departure kill credit.
It still removes participation and frees its cap slot. Ordinary departure is not
a real combat kill under that option; a genuine queued death whose task captured
an opposing participant still scores once when its dying callback arrives, even
if the channel-departure event removed membership first. The pending owner keeps
the victim's side, prior fighter eligibility and whether the score was already
resolved. Counts as death resolves that score before a departure kill can finish
the match, preventing a later callback from counting twice. The actual death
task's captured killer supplies credit; the cleared damage map is not recomputed.

This new retained credit applies to channel departure. Generic forfeit and
disconnect-hook safety backups keep their existing score outcome; no additional
disconnect credit is inferred. Real channel logout notifications retain channel
departure semantics. A jailed or already-dying participant cannot incur a second
departure death. Empty-roster withdrawal cleanup remains the existing explicit
implementation policy, so No penalty does not guarantee a continuing match when
the last member leaves. Existing deadline and same-team/unattributed credit rules
also remain.

With the delay selected, the completed death callback starts a 100-tick deadline:
60 seconds at the engine's 600ms cycle. Choosing that callback, rather than the
lethal hit or first animation tick, is an explicit TSPS policy. Wiki/cache provide
the duration but no recording establishes its exact retail phase origin or reset
semantics. The canonical account bigint from `Player.getLongUsername()` identifies
the deadline within that match, independent of display name or replacement player
object. Both the jail Exit and native lobby confirmation check the same deadline.
It survives channel departure, forfeit or logout and failed return attempts, and
does not restart or shorten when entry is refused. A fresh completed death starts
a fresh deadline. First admission and living nondeath departure do not create one.
No item, energy, charge or metadata snapshot is restored to enforce this rule.

The return is refused before the deadline and permitted at it, subject to the
existing mode, channel, health, busy, area and cap checks. Jailed fighters retain
their cap slot. Last Team Standing still closes entry and return when combat
starts; the delay option does not reopen it. Timed expiry still takes precedence.
The LTS confirmation explicitly says that the selected 60-second delay cannot
reopen entry after combat begins, addressing the wording note from PR #4671.
Viewing relinquishes ownership through the existing return route, and successful
return applies the agreed prayer/special preparation. Finish clears all account
deadlines; a late completed death callback cannot repopulate a closed game or
carry a deadline into a second match. Safe-item and pending-death owners retain
their existing lifetime.

The existing fixture adds the two native choices with mixed negotiated terms,
the production extended social channel packet, actual hit queues/death tasks and
native jail Exit assertions at guard ticks 99 and 100. It checks No penalty
versus counted departures, a real queued lethal hit followed by channel leave
before the first dying callback, six item/amount/metadata survivors, lobby bypass
refusal, failed-attempt deadline preservation, empty-roster cleanup and a second
match after a queued death finishes late. A replacement-player identity checkpoint
is supplied setup, not a full session relog. Existing disconnect/forfeit handler
controls retain their score expectations. The supply confirmation also describes
only permitted supplies, including explicitly disabled food and drinks together,
addressing the wording note from PR #4665. Exact retail phase timing, client
rendering, natural combat RNG and a full login/logout traversal remain unproven;
actual runtime results belong to the PR evidence.


## Last Team Standing: Ignore 5

Wiki Clan Wars revision 15379109 and pinned revision-242 enums 927/928 describe
Stragglers as Kill 'em all (value 0, lose with no fighters) or Ignore 5 (value 1,
lose with five or fewer). Interface 91 uses container 13, frame 14 and scrollbox
15. Scripts 576/581 create option rectangles at subchild `3 * value`, so its
native rows are 0/3, unlike the small dropdowns' `value + 1`. Script 579 calls
573 to change the optimistic stragglers varbit. Both rows transmit and refusals
resynchronize the authoritative offer.

This delivery supports Ignore 5 only in Last Team Standing on the existing melee
Plateau route. That is a bounded implementation scope, not a claim that retail
restricts the setting to this mode. Selecting Ignore 5 in a respawning mode, or
switching from an Ignore-5 offer to a respawning mode, is refused without changing
the offer revision or acceptance state. Captains can choose Kill 'em all before
switching mode. Valid changes preserve every other term, clear acceptance, keep
the usual change delay, and reach both captain and member confirmations.

No stragglers check ends a match during preparation. On each active match tick,
including the first combat tick after the wall falls, one paired snapshot counts
the two sides' fighters. Kill-all uses zero as before; Ignore-5 uses five. Exactly
one side at or below the limit loses to the other; if both are at or below it, the
battle ends without a winner. The neutral result for both-low teams, the first
combat evaluation for already-small teams and this callback/tick sampling are
explicit TSPS policies without a team recording establishing exact retail phase
ordering. There is no invented minimum roster or cap restriction: a selected
1v1 or 5v5 Ignore-5 battle can therefore reach that neutral result at combat start.

Jailed, viewing and dying participants are not fighters. The existing No-penalty
channel-leave term does not award a departure kill, but removal still reduces the
LTS fighter count. Respawning modes retain their existing member-roster cleanup:
jailed and pending-death members retain their roster slots, and a temporary lack
of living fighters does not apply this LTS threshold. No kill-target credit,
reward, item reconstruction or new combat method is added by the variant.

The threshold uses the existing whole-match finish path, including channel
reservations, HUD values, viewing ownership, task and instance cleanup. Pending
safe deaths retain their own item/bone/reward protection until the final callback;
that callback returns to the lobby and cannot recreate an ended-match deadline.
The related mode-aware confirmation change states that an LTS rejoining delay
cannot reopen combat entry, preserving the original wording-note custody from
PR #4671 without changing timer or eligibility behavior.

The existing fixture adds ordinary native 0/3 negotiation and mixed-term
confirmation, bidirectional unsupported-combination refusal with actual sender
resynchronization observations, and concurrent native portal/confirmation
batches. Twelve sequential fixture joins would exceed the real 200-tick
preparation, so enrollment uses real pending entry and confirmation packets in
parallel, with roster/fighter/area checks before combat; it does not seed match
membership, extend preparation or rewind the clock. It compares real six-versus-six
death to five under both settings, checks both-small native caps, paired real
lethal hits, No-penalty departure, safe metadata across finish/late callbacks and
a second match. A seven-versus-seven case first creates an actual jailed viewing
owner, then reaches the threshold and checks camera and instance cleanup.
Supplied levels, scene placement and pre-rolled damage remain explicit setup;
client rendering, natural combat RNG and exact retail phase timing are not
established. Actual runtime outcomes belong to the PR evidence.


## Sylvan Glade alongside Plateau

The arena scrollbox offers Plateau (1) and Sylvan Glade (2). Changing the arena
invalidates both setup acceptances, and the confirmation names the selected map.
Other arena rows are refused and reset to the agreed server offer. Both layouts use
the existing melee modes, restrictions, safe deaths and membership rules.

Sylvan copies revision-242 region 13646, source rectangle 3392..3455 / 4992..5055,
with source planes 0 and 1 mapped to corresponding instance planes. This rectangle
is our bounded template footprint, not a claim about official arena extents. Raw
plane-1 jail locs sit above bridge tiles: their terrain settings are [1, 2], so the
normal template bridge rules place their owned objects and collision on effective
plane 0. Copying only source plane 0 would omit those jail objects. Planes 2 and 3
are not mapped.

These exact player placements are implementation choices checked against that map,
not recorded retail spawns: south/north landings are (3424,5000,0) and
(3424,5048,0); jails are (3423,5020,0) and (3424,5027,0). The preparation wall uses
elfwood barriers at y=5023, x=3396..3419 and 3428..3451. Its row and type-10 face-0
placement are our choices. Solid mapped trees already close some tiles; those tiles
receive no temporary overlay, preserving their collision when barriers disappear.
Plateau retains its original 52 barrier registrations.

The mapped south/north jail orbs are (3423,5022) / (3424,5025), with Exit portals
at (3424,5017) / (3423,5029), all effective plane 0. Native viewing uses the elfwood
orb model 9754. Both jail exit and Forfeit handlers require the selected layout's
actual owned instance object. Copied trees retain walking and projectile obstruction;
this does not enable ranged combat.

Sources: [Wiki Clan Wars revision 15379109](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109),
[viewing orb revision 15201300](https://oldschool.runescape.wiki/w/Viewing_orb_(Clan_Wars)?oldid=15201300),
[prison portal revision 15201299](https://oldschool.runescape.wiki/w/Portal_(Clan_Wars)?oldid=15201299),
and [cache-242 definitions and interfaces](https://github.com/Joshua-F/osrs-dumps/tree/853150e3f75e1463391b470f98caf5d3bf796339).
Raw cache loc planes and bridge-aware template settings were inspected separately;
source inspection does not establish rendered-client behavior or retail spawn/timing equivalence.


## Forsaken Quarry

The same native arena scrollbox also offers Forsaken Quarry (3). The immutable
layout table selects its map, landings, jails, barriers, viewing model and owned
exit identities; existing melee modes, restrictions, safe-death metadata and
membership rules remain the same. Other arenas are refused and resynchronized.

The bounded template is region 13647, source 3392..3455 / 5056..5119, with planes
0 and 1 copied to corresponding instance planes. Four active orb/jail-portal
objects have terrain settings [4,1], no bridge bit, and owned effective-plane-0
copies. Source planes 2/3 are not mapped; this footprint is not a retail extent claim.

These are explicit TSPS placement choices qualified against the active map:
south/north landings (3424,5066,0) / (3424,5109,0), south/north jails
(3428,5085,0) / (3419,5090,0), and type-10 face-0 preparation barriers at y=5087,
x=3396..3415 and 3432..3451. The jail-border columns are included to close a
source-geometry bypass. Sixteen already-solid rock tiles receive no temporary
overlay; the remaining 24 barriers use native spawn registration, as the clip grid
has already been materialized by solid-tile checks. The normal 200-tick preparation
and empty-staging lifetime are unchanged.

South/north jail orbs are (3429,5086) / (3418,5089), using model 9755; jail exits
are (3424,5087) / (3423,5088). Quarry's jail portals share the Plateau gameval, so
a correct ID alone is insufficient: the actual object must belong to the selected
match's private template. Forfeit portals are (3422,5062) / (3422,5112).

The Wiki and revision-242 enum930 describe small rocks that do not block line of
sight. Returned active-cache Rockslide definitions 11426/11427/11428 are 2x2 and
block walking while allowing projectiles. In particular the rock at (3402,5073)
occupies walk-blocked tiles with no projectile-tile bit, between open left/right
tiles. Native verification must distinguish walking obstruction from the ray
across it; this map property does not enable ranged combat.

Sources and limits are the pinned Wiki/cache references above. Native tests use
ordinary decoded movement/object input and existing actor/death-task fixtures;
exact spawn/barrier coordinates are our choices, not recorded retail positions.


## Soggy Swamp

The native arena scrollbox offers Soggy Swamp (6, row slot 18) alongside Plateau,
Sylvan Glade and Forsaken Quarry. Ghastly Swamp (7) is a separate, unsupported
arena. Existing melee modes, restrictions, Ignore 5, safe deaths and membership
rules use the same selected-layout consumers.

The bounded revision-242 template is region 13645, source 3392..3455 / 4928..4991,
with planes 0 and 1 copied to corresponding instance planes; source 2/3 remain
unmapped. All 844 returned raw locs are plane 0. The four active orb/jail-portal
targets have settings [0,1], no bridge bit and owned effective-plane-0 copies.
This inspection footprint is not a retail arena extent.

Exact placements are TSPS choices qualified against the map: south/north battle
landings (3409,4934,0) / (3439,4985,0), southwest/northeast jails
(3396,4932,0) / (3451,4987,0), and type-10 face-0 preparation barriers at y=4959,
x=3395..3452. One already-solid tree at (3397,4959) receives no overlay; the other
57 tiles use the existing native spawn/clipping path. Preparation stays 200 ticks.
Source collision graphs place both landings in one 2032-tile component and the
jails in separate 19-tile components. Native movement and exact collision
restoration are verified separately from those source graphs.

South/north jail orbs are (3397,4929) / (3450,4990), with model 9753; jail Exit
portals are (3393,4933) / (3454,4986). Forfeit portals are (3407,4931) /
(3437,4987), with source dimensions 4x2 and faces 0/2. Actual selected private-area
object identity is required for every interaction.

The map has roots, rotten trees and mossy rocks. The selected tree at (3398,4946)
is a 1x1 walking/projectile obstacle; the selected roots at (3398,4977) occupy 3x3
walking/projectile-blocked tiles. These bounded cache properties need native
walking/ray checks with open controls; they do not enable ranged combat or assert
blanket line-of-sight properties for every swamp object.

Sources and limits are the pinned Wiki/cache references above. Landings, jail
assignment and wall placement are TSPS choices, not recorded retail positions.
Native fixtures disclose supplied levels/combat positions/pre-rolled damage and
inert transport; they do not establish rendered-client, full-session, natural-RNG
or retail timing equivalence.
