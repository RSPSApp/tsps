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
configuration is **melee-only Last Team Standing, First to X kills or timed Most kills on Plateau, Sylvan Glade, Forsaken Quarry, Clan Cup Arena, Soggy Swamp, Classic, Lumbridge Castle, Falador Park, Wasteland, Turrets, Northleach Quell, Ghastly Swamp or Gridlock**;
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
special attacks Allowed/No Staff of the Dead/Disabled. The original restriction delivery offered food and
drinks values 0/1, prayer values 0/1/2, and special-attack values 0/2. The Staff-only
value 1 was deferred then; the bounded follow-up below adds it. Melee stays
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
Sylvan Glade and Forsaken Quarry. Ghastly Swamp (7) is a separate arena with the
shared fight-start hazard described below. Existing melee modes, restrictions, Ignore 5, safe deaths and membership
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


## Clan Cup Arena

Clan Cup Arena (5, native row slot 15) joins the four delivered layouts through
the same selected-layout negotiation, modes, restrictions, Ignore 5, safe-death,
viewing and membership paths. The Wiki lists it as a free-to-play arena adapted
from the 2013 Clan Cup; objective modes are still outside this implementation.

The bounded template is region 12621, source 3136..3199 / 4928..4991, with source
planes 0/1 mapped to matching instance planes and source 2/3 unmapped. Full source
inspection returned 2,649 raw locs (1,795 on plane 0 and 854 on plane 1). Both jail
Exit portals and all six active orbs have raw plane 1 and settings [1,2]: normal
bridge rules lower them to owned effective-plane-0 objects and collision. The
bounded footprint is not a claim about retail arena extent.

West/east placement is an explicit TSPS choice qualified against that source:
battle landings (3150,4960,0) / (3185,4960,0), jails (3141,4957,0) /
(3194,4957,0), and a vertical greyrock preparation wall at x=3167,
y=4936..4983, type 10 face 1. Five existing walk-blocked cells receive no overlay;
43 tiles use native spawn/clipping registration. Existing layouts retain their
exact Y-line, face-0 placement and registration/removal defaults. Preparation is
still 200 ticks. Offline source graphs distinguish the 2,092-tile battle component
from west/east waiting areas of 430/422 tiles; native processed movement, actual
barrier registration and exact 4,096-mask restoration are separate checks.

West waiting-area orbs are (3140,4961), (3157,4932), (3157,4987); east orbs are
(3195,4961), (3178,4932), (3178,4987). All use greyrock model 9755. Every active
owned copy uses the existing jailed-member and ordinary approach rules; no
single-coordinate orb shortcut or new retail side policy is inferred. Exit
portals are (3140,4952) / (3195,4952), sharing the darkrock gameval with Plateau
and Quarry. Forfeit portals share the small-purple gameval at (3144,4936) /
(3191,4936). Actual selected private-template identity is required, not just IDs.

The selected stalagmite at (3146,4973) blocks walking and projectiles; selected
bones at (3146,4944) block walking while allowing a ray across them. These are
bounded source properties needing native obstacle and open controls, not a
blanket arena line-of-sight or ranged-combat claim. Sources and limits are the
pinned Wiki/cache references above. Exact placement, team assignment and wall
axis/face are TSPS choices, not recorded retail spawns or timing. Native tests
retain disclosed combat/Forfeit checkpoints, pre-rolled damage and inert
transport; no rendered-client/full-session/natural-RNG equivalence is claimed.

## Classic

Classic (11, native arena slot 33) uses the existing melee modes, restrictions,
Ignore 5, safe-death and viewing routes alongside the five delivered layouts.
The pinned Clan Wars Wiki lists Classic in the free-to-play section. Objective
modes, other arenas, modern clans and ranged/ammunition parity remain outside
this implementation.

The selected copy is rectangular: source 3392..3455 / 4672..4799, regions 13641
and 13642, eight by sixteen chunks. Source planes 0/1 map to matching instance
planes; 2/3 remain unmapped. A separate read-only inspection returned all 1,683
raw locs (866 and 817 respectively), all on raw plane 0, with full settings/clips
and actual owned interactive copies. Its 141 checks were 140 retained controls
plus one source inspection, not Classic gameplay proof. This bounded footprint
is a TSPS choice qualified against source geometry, not a retail arena extent.

The TSPS south/north battle landings are (3423,4690,0) / (3423,4787,0), and jail
landings are (3448,4727,0) / (3448,4744,0). Source graphs identify a 5,766-tile
battle component and two separate 100-tile jails. A darkrock preparation line
at y=4735, x=3393..3445 skips two terrain-blocked cells and registers 51 native
1x1, type-10, face-0 walls. The directional/projectile edge at (3445,4735) keeps
its 0x140a mask; removal must restore all 8,192 plane-0 masks exactly. Ordinary
processed movement is separate from the source graph. The shared Match copy
uses selected width/height with each old dimension falling back to size; all
five old literal configurations, square defaults and Clan Cup axis/face remain
unchanged, as do native registration, removal and preparation lifetime.

Actual active darkrock orbs are (3450,4720), face 0, and (3450,4751), face 2,
using model 9752. Jail Exit portals are (3450,4734) / (3450,4737). All are raw
plane 0 with settings [0,0] and owned effective plane 0. The existing policy
requires a jailed member and the exact owned template object. Same IDs in other
matches and unregistered lookalikes do not establish ownership. Both Forfeit
copies use the same darkrock-south gameval, at (3421,4681), face 0, and
(3423,4789), face 2. Both are 4x2: ordinary approach uses the actual footprint
perimeter, not anchor-only adjacency. Suitable source approaches include
(3423,4683) and (3423,4788); the two open tiles immediately west of the south
portal are isolated and are not used as ordinary approach evidence.

Selected Tree 14693 at (3410,4686), face 3, has a 2x2 footprint that blocks
walking and projectiles. Selected Stone Pile 14731 at (3425,4730), face 2, is
1x1 and blocks walking while allowing a ray. Adjacent open endpoints and an
independent open control support bounded native movement/ray checks; names
alone do not establish arena-wide line of sight. Placement, jail assignment,
barrier and copied dimensions remain TSPS choices. Validation retains supplied
combat/Forfeit checkpoints, pre-rolled melee damage and inert transport; no
rendered-client, full-login, natural-RNG or retail spawn/timing claim is made.


## Lumbridge Castle

The native arena row 12 (slot 36) selects Lumbridge Castle alongside the previous
six layouts. This bounded template copies region 13643, source 3392..3455 /
4800..4863, planes 0 and 1; planes 2/3 remain unmapped. Returned plane-1 settings
have no bridge bits. Staircase copies are on effective plane 1, with no ground-floor
Climb action. Ground-floor gameplay and sealed main/rear entrances follow the
existing source clipping, not a new permission to use upper floors.

The following are explicit TSPS placements qualified against the source, not retail
spawns or extent claims: south/north landings (3417,4810,0)/(3417,4843,0), jails
(3436,4822,0)/(3436,4831,0). Greyrock preparation barriers use type 10, face 0,
y=4826, x=3407..3437, skipping two already-solid tiles. The remaining 29 native
barriers separate the starts; removing them must preserve the complete original
4096-tile collision grid. Existing dimensions, preparation lifetime, native object
registration/removal and the other six configurations are unchanged.

Each gatehouse jail contains an owned greyrock viewing orb (26743, model 9755)
and swamp Exit portal (26740). Actual south/north orbs are at (3436,4823) /
(3436,4830), Exit portals at (3437,4820) / (3437,4833). Smallwood Forfeit portals
7819/7820 at (3417,4809)/(3417,4844) have 2x1 footprints. Their native owned
identity and footprint approaches matter; matching an ID elsewhere grants no action.

The [pinned Wiki description](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
allows ground-floor water sources, cooking and regular trees; the Oak remains
behind invisible barriers. Actual interior source copies include Sink 14868,
Range 26181, Fountains 879 and two reachable regular Trees 1278. These use the
canonical WaterSources, Cooking and Woodcutting plugins, including actionless
water item-use, real supplies and normal NoFood/NoDrinks consumption restrictions.
The Oak's 3x3 footprint has directional clipping on every cardinal approach;
walkable corner tiles do not establish native object reach. Other copied scenery
is not assumed usable merely from its name.

Canonical Woodcutting and Cooking resolve untouched lazy template trees/ranges
as well as spawned and world objects, while honoring an area's removed or
replaced shape slots. This
keeps a depleted original unavailable until its actual respawn rather than reading
it straight back from the immutable template index.

Canonical tree depletion keeps private-area identity on its stump and respawn.
The delayed Woodcutting respawn task now stops before object lookup or mutation
when the original private area is destroyed. World and living-private-area respawns
retain their existing path. This prevents a stale tree from being registered after
a match ends, without disabling ordinary chopping or changing global object tasks.

Existing fixtures cover ordinary arena offers, full mask restoration, actual object
and movement routes, internal doors versus actionless seals, ground-floor refusal,
canonical resource outputs/cancellation/respawn and private teardown, safe-death
metadata, viewing, delayed return, both Forfeit footprints and prior-layout controls.
Coverage descriptions are source intent; observed outcomes and failure history belong
to the PR evidence. Supplied setup, controlled RNG, native listener versus decoded
packet boundaries, inert transport and unrendered client/session limits remain explicit.


## Falador Park

Falador Park (arena 13, native slot 39) supports the same melee modes, restrictions,
late entry, Ignore 5 and safe deaths alongside the seven existing layouts. The
[pinned Wiki](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
describes sealed park entrances, two holding cells and choppable regular trees.
The bounded copy uses regions 13898 and 14154, source 3456..3583 / 4736..4799,
sixteen by eight chunks, mapping source planes 0/1 to matching instance planes;
source 2/3 remain unmapped. The adjacent eastern region supplies real wall/window
clipping at x=3520, closing the old single-region observation edge. This is a
bounded TSPS copy, not a retail arena extent or allowed-floor claim.

Explicit TSPS west/east landings are (3472,4759)/(3512,4759), with holding cells
(3461,4760)/(3469,4745). Elfwood preparation barriers use type 10 face 1 at x=3496,
y=4743..4767, skipping two blocked tiles. The 23 real walls partition the starts;
removal must restore all 8192 original ground collision masks before deliberate
resource or door mutations. The existing match lifetime and old configurations
are unchanged.

Both cells have active elfwood viewing orbs 26745 (model 9754) and Exit portals
26739; inactive 26746 copies are distinct. Both Forfeit locs are 7819: (3469,4763)
face 1 rotates its footprint to 1x2, while (3482,4749) face 0 is 2x1. Both are west
of the preparation partition; no symmetric preparation exit placement is promised.
After removal the connected park provides ordinary approaches for both teams.
Selected private-template identity is required for every match action.

Four regular Trees at (3474,4766), (3478,4766), (3482,4766) and (3486,4766) have
park cardinal approaches. They retain canonical Woodcutting log outputs, depletion,
stumps and respawn, including the inherited destroyed-private-area task guard.
Other copied Trees and Oaks are not assumed usable by name or corner adjacency.
The actual Close door at (3515,4755) retains canonical Door Close/Open behavior.
Ground Staircase 24079 and Furnace 24009 are in a separate source component;
Range 26181 is in another isolated room. An actual upper Climb-down copy exists.
Their presence does not grant park access, and no Lumbridge ground-floor policy
or new blanket climb restriction is imposed. Source seals and actual native
object reach govern access; no object is manually registered to manufacture use.

Existing fixtures must establish native offers, both safe deaths and owned orb/Exit
routes, rotated Forfeit approaches, full barrier identity/restoration and the same
short queued crossing before/after removal, canonical Door mutation with seals,
park refusal of isolated/upper props, four actual Tree outputs and lifecycle
isolation, modes/restrictions and eight-layout controls. These are coverage intent;
actual outcomes, commands and failure history belong to the PR evidence. Source
floods, supplied combat/checkpoints, controlled RNG, native listener versus decoded
packet paths and unrendered/inert transport limits remain separately attributed.

## Wasteland

Wasteland (arena 0, native slot 0) uses the existing melee Last Team Standing,
First to X and timed modes, restrictions, Ignore 5 and safe deaths. Explicit
selection of zero is valid; a fresh negotiation still defaults to Plateau (1).
The pinned Clan Wars Wiki revision 15379109 has conflicting wording: its arena
row says single combat near portals, while its dated 26 June 2014 Changes entry
says the whole map is multi-way and trees were added. Update:Midsummer_Event
revision 14354395 corroborates the dated change. This implementation follows
that whole-map multi intent using the existing shared area policy; it adds no
single-combat zones or new combat rules.

The bounded TSPS copy maps source regions 13134/13135 from (3264,4992), 8 by 16
chunks, source planes 0/1. Source 2/3 are unmapped, not a retail allowed-floor
policy. Returned ground collision has one 5,193-tile main component and two
separate 54-tile jail components, all strictly inside the acquired rectangle.
That supports this finite copy, not a retail arena extent. Landings (3296,5010)
and (3296,5100), and jails (3317,5053)/(3317,5058), are TSPS choices.
The preparation row at Y5055 covers X3268..3315, skipping blocked X3268.
Its 47 temporary darkrock walls must preserve the source wall flags at the
jail-side endpoint and restore all native clips when removed.

Actual cache-backed active orbs use the existing darkrock model 9752. Jail Exit
portals and the distinct south/north Forfeit portals retain their owned native
identities and full rotated footprints. The 134 returned named Tree objects
have no cache actions; their names and the update's mention of trees do not
establish choppable resources. Their source collision and scenery are retained.
No action injection, manual private-tree registration, resource disabling or
Woodcutting change is introduced. Tree/Mushroom obstacle examples distinguish
walking from projectile rays; this does not establish ranged-combat parity.

Existing native and Rules fixtures cover deliberate slot-zero offers and
reset/reselection, both jail/orb/Exit paths, both Forfeit footprints, complete
barrier restoration and causal movement, native walk/ray distinctions, truthful
unavailable resource actions with a separate canonical actionful-tree control,
instance reuse, modes, restrictions and melee multi controls. At tested revision
`093c21f7c1bca1ffb54f26e9768cfe2711f63d7a`, all 254 checks passed: 176 native,
18 Rules, 6 camera-shake, 1 WASD and 53 Cooking. These results apply to that tested
tree, not the entire later merged tree; commands and failure history are recorded
in [PR #4879](https://github.com/RSPSApp/tsps/pull/4879).
Supplied checkpoints and handler inputs do not prove natural traversal, login,
client rendering, retail timing or the remaining content in issue #153.


## Turrets

Turrets (arena 4, native slot 12) uses the existing melee modes, restrictions,
Ignore 5 and safe deaths. Fresh negotiations still default to Plateau (1), and
explicit Wasteland (0) remains valid. The [pinned Clan Wars Wiki](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
describes ascendable turrets; this slice does not add ranged combat.

The bounded TSPS copy maps regions 12622/12623 from (3136,4992), eight by sixteen
chunks, with raw source planes 0/1. All four source planes were inspected; 2/3
have no returned locs and remain unmapped as a bounded-copy choice, not a retail
floor policy. Bridge settings lower the raised terrain and its objects onto
effective plane 0. No staircase, ladder or climb action occurs in the acquired
source. The main 4,523-tile component includes fourteen connected bridge subsets
(twelve of 38 tiles and two of 94). Their source routes use ordinary walking;
no climb objects, destinations or ClimbLinks changes are manufactured. Source
collision does not establish rendered elevation or natural player traversal.

Landings (3160,5010)/(3160,5100), jails (3167,5004)/(3168,5105), and the 48
brownstone preparation barriers at Y5055, X3144..3191 are explicit TSPS choices.
The temporary row separates the main component into 2,214 and 2,261 tiles.
Source direction flags at both endpoints and the middle must survive, and all
8,192 ground masks must be restored before intentional mutations.

The two outer holding components each contain 1,275 observed tiles and reach
the observation's X edges. They are not proven source-closed retail jails.
This implementation uses the ordinary bounded template boundary, without
changing source clips. Main/holding separation, containment and ordinary
refusal at the copy boundary are required controls. This is not a retail extent
or a claim that the complete outer source components were acquired.

Actual active brownstone orbs 26747 use model 9751; inactive 26748 copies are
distinct. Owned darkrock Exit portals are at (3167,5005)/(3168,5106). Forfeit
portals 26732 at (3166,5016), face 2, and 26731 at (3166,5094), face 0, retain
their distinct native 4x2 footprints and rotated access masks. No matching ID
in another area or a fabricated object confers match actions.

The returned source contains no actionful trees, cookers or water resources;
none are manually registered or given invented actions. Actual old-castle walls
include both projectile-blocking and projectile-passable movement barriers.
Walking and native projectile rays remain separate controls.

Existing native and Rules fixtures exercise deliberate offers and confirmation,
ordinary walk-in and return through all fourteen raised terrain routes, native
melee access on side and both central structures, staging bypass refusals, real
deaths and owned orb/Exit paths, both Forfeit footprints, full mask restoration,
restrictions and reused-instance isolation. This describes the implemented fixture
coverage; observed outcomes, commands and failure history accompany the PR. Supplied setup,
source graphs, native handlers and decoded inputs do not prove rendered height,
login, retail timing, natural RNG or the remaining content in issue #153.


## Northleach Quell

Northleach Quell (arena 8, native slot 24) uses the existing melee modes,
restrictions, Ignore 5 and safe deaths. Plateau (1) remains the fresh offer default;
explicit Wasteland (0) remains supported. The [pinned Clan Wars Wiki](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
describes snowy boats and broken wood, and explicitly says its snowy dead trees
can be chopped for logs. Membership in the chooser metadata does not introduce a
new membership-world enforcement policy.

The bounded TSPS copy maps region 13644 from (3392,4864), eight by eight chunks,
plane 0. All four raw planes were inspected; all 1,837 returned locs are on raw
plane 0. Empty returned upper clips/settings do not establish playable upper
floors or a retail floor ban. Ordinary source collision gives one 1,653-tile main
component and two separate 18-tile holding components, all inside the observation
boundary. This graph describes the source, not an executed player route or a
rendered scene.

Landings (3406,4880)/(3445,4915), jails (3420,4899)/(3427,4899), and the four
greyrock preparation barriers at Y4895, X3406 and X3438..3440 are TSPS choices.
The row scans X3392..3455 and skips native blocked cells, splitting main into
767 south and 882 north tiles during preparation. A nonblocking type-22 floor
loc 19848 at (3406,4895) coexists with the type-10 barrier; its exact identity and
all source clipping must survive removal. This is not a claim of no raw overlap.
All 4,096 native ground masks and settings must be restored before resource
mutations, with ordinary crossing refusal during preparation and identical
crossing targets reachable after the canonical start.

Owned active greyrock orbs 26743 use model 9755 at (3421,4901)/(3426,4901).
Owned elfwood Exit portals are at (3420,4897)/(3427,4897). Both Forfeit portals
are darkrock-n 26728, at (3397,4869), face 0, and (3449,4921), face 2. Their
4x2 footprints and rotated access masks remain authoritative; the shared ID does
not confer ownership or make a fabricated/foreign object usable. Real deaths,
ordinary jail approaches, containment, camera/view-close restoration and actual
Exit deadlines require native controls for both sides.

Four actual snowy dead trees 1291 have Chop down actions: (3411,4890), type 11,
face 0; (3412,4889), type 11, face 2; (3448,4886), type 10, face 0; and
(3449,4885), type 10, face 3. Their main-component approaches use ordinary
walking. The existing canonical Woodcutting producer gives logs and 25 base XP,
resolves model 23908 to snowy stump 23054, and respawns the original with its
private ownership, type and face after 59..98 ticks. No private trees or stump
replacements are manually injected. The actionless Tree 14695 is a distinct
negative. Both debris Ladder 26317 copies have null actions; no climb links,
guessed destinations or artificial resource actions are added. Boat/debris
movement and projectile blocking remain distinct from the source torch and
skeleton's projectile-passable movement blocking.

Existing native and Rules fixtures exercise all four ordinary tree approaches and
native harvest/stump/respawn, active chopping cancellation on walking or real
death, walking cancellation followed by Forfeit, stale/foreign refusal, destruction
while depleted followed by actual slot reuse, concurrent-match/world preservation,
full clipping and mapped-settings restoration, real holding/orb/Exit and both
Forfeit paths, ordinary melee and obstacle detours, existing layouts and shared
restrictions. This describes implemented coverage; observed outcomes and failure
history accompany the PR. The XP control checks 25 base XP against the actual
world rate with an allowed multiplier-one gate, unlocked and uncapped XP.
Supplied setup/RNG, source graphs, decoded inputs and native handlers do not
establish rendered geometry, login transport, retail timing or all of issue #153.


## Ghastly Swamp

Ghastly Swamp (arena 7, native slot 21) adds the fight-start ghast hazard to the
existing safe melee modes and restrictions. Plateau (1) remains the default and
explicit Wasteland (0) remains supported. The [Clan Wars Wiki](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
describes ghasts after fighting begins. The [pinned Ghast page](https://oldschool.runescape.wiki/w/Ghast?oldid=15368042)
identifies the level-109 form as NPC 5626 and says it also appears in Clan Wars,
where it awards no drops or Prayer XP. The canonical monster row is marked
incomplete and dated 2025-10-18; this is not new capture or retail timing proof.

The bounded copy deliberately reuses the inspected Soggy source: region 13645,
origin (3392,4928), eight by eight chunks, mapped planes 0/1. All 844 retained raw
locs are on raw plane 0. Plane 1 has blocked settings/clips throughout; planes 2/3
remain unmapped. These are bounded choices, not a separate retail map-id, extent
or floor-policy claim. Source geometry gives a 2,032-tile main component and two
isolated 19-tile holdings. Landings (3409,4934)/(3439,4985), holdings
(3396,4932)/(3451,4987), and row Y4959 X3395..3452 are TSPS placements. The row
skips the existing blocked tree at X3397, creating 57 swamp barriers and a
959/1,016 split. Thirteen nonblocking type-22 Soil copies coexist with the row;
their exact identities and full source masks/settings must survive removal.

Owned swamp orbs 26749 use model 9753; inactive 26750 copies remain distinct.
Owned Exit portals 26740 are at (3393,4933)/(3454,4986). Forfeit portals 26735/26736
at (3407,4931)/(3437,4987) retain faces 0/2, 4x2 footprints and native access masks.
The source Trees and Roots have null actions. No climb, harvest or resource
actions are manufactured from scenery names.

Exactly two shared ghasts start at (3410,4936)/(3438,4983) after the canonical
200-tick preparation; none exist in staging and killed ghasts are not replaced.
Population, positions, initial-only lifetime and the impact/food rules below are
explicit bounded TSPS choices. Both spawns and canonical definitions must be
ready before combat starts; failure cancels the match and cleans partial spawns.
These are shared NPCs, not personal owner-only actors. Shared definitions and
world spawns are unchanged. Normal NPC turns/size-2 pursuit and melee own attack
scheduling: the published base speed is eight ticks, Crush/max hit eight with
normal accuracy and mitigation. No extra timer or manual damage scheduler is added.

A positive, mitigated, marked ordinary melee impact from a current owned ghast
rots one convertible inventory item instead of taking that impact's HP. Zero,
missed, fully mitigated, reflected, origin-tagged, poison and unmarked/scripted
hits do not convert food. With no convertible item, canonical HP damage proceeds.
This does not assert the generic Mort Myre 30%/70% roll, 1..3 damage, quest pouch
or diary defenses, the quest's unsourced 12..30 cadence, or retail rot parity.
Known stale owned impacts after source retirement or victim ineligibility cause
neither HP damage nor food changes; world and foreign sources remain unaffected.
Ordinary walking within a match keeps canonical pursuit and pending-hit behavior.

Conversion scans inventory slots in ascending order. Only positive real items
whose canonical cache actions include Eat and exclude Drink are candidates;
notes, placeholders and Rotten food itself are excluded. It does not ask whether
the player may consume the food. NoFood prevents eating but does not prevent
carried food spoiling; NoDrinks does not make potions eligible. Partial food is
one current physical item. An amount-one candidate becomes one Rotten food in
the same slot, retaining deep-cloned metadata and ownership/preset flags, even
with a full inventory. A larger stack loses exactly one unit and places one
metadata-preserving Rotten food in the lowest empty slot; if no slot exists,
that stack is skipped for a later convertible item, otherwise HP damage proceeds.
There is no whole-stack collapse, ground drop, storage fallback or protection
without actual spoilage. Containers only qualify if the carried item itself has
Eat; nested storage and containers or inedible produce without Eat are outside
this slice. Pineapple follows its actual cache action even if eating it whole is
refused. Complete generic-ghast container/produce parity is not claimed. Spoiled
food is not restored on safe death, leave or match cleanup.

Players can fight owned hazards under the same melee/NoSpecials restrictions.
Killing a ghast does not score a team kill or remove a player fighter. A ghast
killing a player uses canonical safe-death elimination, holding, deadline and
mode-specific Ignore5 consequences, without guessed opposing-player kill credit.
Exact current and retired NPC ownership suppresses default drops and per-instance
respawn; no shared definition or global NPC-5626 reward rule is changed.

The existing game and Rules fixtures include native size-2 approaches and eight-tick turns,
exact hit provenance and mitigation/food branches, all inventory policies,
NoFood/NoDrinks, both real player deaths/holdings/view/Exit/Forfeit paths,
readiness failure, queued additions/hits/deaths/removals and actual freed-slot
reuse with concurrent-match/world controls. All 4,096 native ground masks and
mapped settings are compared before intentional resource mutations, with full
upper-plane preservation, both ends and center staging crossings, current owned
barrier identities and all Soil copies. These describe the written fixture assertions; runtime outcomes remain unobserved
until the exact source runs. Source/decoded/native-handler proof
is distinct from rendering, natural RNG, login, retail timing and full issue #153.

Queued NPCs remain attached but unindexed until their actual world slot is assigned.
The normal area process and match tick reconcile that initial registration once.
If World consumes an admitted addition but refuses registration, the next owned
match tick cancels the battle and removes both hazards without retrying or
requeuing. The fixture separately supplies registration refusals to exercise this
failure path; that control is distinct from the ordinary successful NPC turns.

The fixture loads canonical NPC definitions and registers the actual NpcDrops,
Prayer, Bonecrusher and Nature Spirit consumers. An owned ghast death is compared
with world-5626 bones reaching the real charged Bonecrusher/Prayer route and a
canonical pouch-revealed quest ghast advancing its own quest identity. The quest
control supplies its stage and item-on-NPC event; it does not claim native quest
traversal. Native cadence tests run NPC turns, player combat/movement and ordinary
aggression without forced rolls. Supplied PendingHit/HitDamage and scoped force-roll
controls cover exact inventory and stale/provenance edges, not natural timing.

Source-derived suite counts are 259 game cases (228 inherited plus 31 Ghastly),
21 Rules, six shake, one WASD and 53 Cooking including nested cases: 340 expected,
not observed here. The inherited fixture helpers now also admit/remove real NPC
queues, and Q's explicitly selected engine cases additionally process native NPC
and player combat turns, local NPC visibility and update resets. Other cases keep
their previous player tick path. Former native-slot-21 refusal samples use the
unsupported child slot 22; their existing valid unsupported arena rows remain.
Former numeric-arena-7 Rules refusals use malformed 7.5, and a new case positively
covers all twelve layouts. The original paired baseline bound the identical two
then-final fixture blobs to unchanged production. Its actual offer-absence failures
and unreached assertions were independently classified before fixed selection.

The original baseline on `8be20022` passed 228 inherited game cases and failed
all 31 new cases at the ordinary arena-7 offer (expected 7, actual default 1);
all Ghastly behavior and later suites were unreached. Its two fixture blobs match
the original fixed `61c6df1d`, which ended OOMKilled during the game suite without
literal case verdicts or a final source/dist/cache closure. Returned movement,
barrier and readiness markers do not establish completed case passes.

A fixture correction fixes the NPC Attack byte order and asserts the actual decoded
NPC slot before dispatch. Exact entity-reference assertions now use boolean checks
with bounded scalar diagnostics, preserving identity requirements without asking
Node to inspect cyclic world/cache graphs on failure. The invalid original frame
is source-confirmed; the OOM's precise allocation cause remains untraced. The
original offer-absence evidence is upstream of these changes and is retained;
it does not claim execution of the corrected fixture bytes. Any corrected fixed
subject requires its own independent exact admission and original execution.

The corrected `9eb8a02b` run completed the game suite with 256 passes and three
fixture failures; later suites were unreached. Its source, compiled output and
cache post-run content checks passed. The failures were an expectation that stopped
hazard history was absent after the empty-roster start transition, and two literal
`false` expectations where never-registered NPCs canonically return `undefined`.
The next fixture correction keeps an explicit last-staging-tick no-spawn check,
then verifies both stopped initial NPCs are absent from actual World slots, add and
remove queues, the area index and attached entities after cleanup and 120 ticks.
Never-registered checks use canonical falsey semantics with the same concrete
absence checks. It changes no production behavior or hazard requirement. These
failed runs and the upstream original baseline remain distinct evidence; no full
340-test result is established by their partial results.

## Gridlock

Gridlock (arena 9, native slot 27) uses the existing supported melee modes,
restrictions, Ignore 5 and safe deaths. Plateau remains the default and explicit
Wasteland remains valid. The [pinned Clan Wars Wiki](https://oldschool.runescape.wiki/w/Clan_Wars?oldid=15379109)
and revision-242 chooser describe a huge four-way multi-mountain map suited to
King of the Hill, rangers and mages. This slice does not introduce objective modes,
four teams, ranged/magic combat or a new membership-world enforcement policy.

The bounded copy uses source origin (3456,4800), sixteen by sixteen chunks, plane
0, from regions 13899/13900/14155/14156. All four raw planes were inspected: all
1,911 raw locs and actual owned copies are on plane 0. The upper settings/clips
were empty in that observation, which establishes neither playable upper floors
nor a retail floor ban. Planes 1/2/3 remain unmapped as a bounded copy choice.
No stairs, resource actions or bridge transitions were found; mountain wording
does not manufacture a climb route. Terrain height and rendering parity are not
established by these source facts.

Native directional and solid masks give a 13,317-tile main component and isolated
31-tile lower and 24-tile upper holdings, all inside the source observation's
boundary. Landings (3465,4829)/(3575,4899) and jails (3519,4861)/(3519,4865) are
TSPS choices. The preparation cut scans X3519 at Y4802..4858 and Y4868..4925,
skipping blocked tiles. Its 106 darkrock barriers split the main component into
6,549 west and 6,662 east tiles. The holdings are left unchanged; no synthetic
jail blocking is added. Twenty-two nonblocking type-22 floor locs coincide with
the row and retain their exact identities and underlying collision on removal.

Both active darkrock viewing orbs 26741 use model 9752, at (3519,4859)/(3519,4867).
The two Exit portals 26738 at (3519,4863)/(3519,4864) share a gameval but remain
distinct owned objects in distinct holdings. Existing exact instance ownership
and native interaction routes apply; fake and foreign objects gain no authority.
Forfeits 26732/26731 at (3459,4827)/(3579,4897) have faces 1/3: their canonical
4x2 definitions rotate to 2x4 footprints, with access mask 30 admitting the east
and west edges respectively. Portal labels do not override those actual sides.

The other source objects have no usable actions. Null-action dug-up floor locs,
walls, torches and skeletons gain no harvesting or climb handlers. Ordinary native
walking uses the real directional walls and rotated solid footprints; projectile
blocking remains distinct, including projectile-passable skeletons and blocking
torches. A 128-tile copy can require successive ordinary movement targets within
the centered native route-search window; a distant click is not a teleport or
proof of an extreme-to-extreme path.

The existing game and Rules fixtures cover negotiation, all supported modes,
supplies, six identical staging/combat crossing targets, full 16,384 native ground
masks/settings and coexistent floor identities, both real deaths/holding bounds,
view-close and owned Exit deadlines, both side-correct Forfeits, ownership and
instance cleanup/reuse. These describe required assertions; actual outcomes and
failed attempts belong to the exact tested revision reported with the PR. The
source-only qualification's 312 checks do not prove implemented Gridlock gameplay
or transfer Ghastly Swamp's results. All twelve earlier layouts, including its
shared ghast hazard, remain distinct controls. No rendered scene, login, natural
RNG, retail placement/timing or complete issue #153 resolution is claimed.

The completed fixture adds 29 game cases and one Rules case. Its inherited
259-game/21-Rules/six-shake/one-WASD/56-Cooking controls plus these additions give
373 expected reported tests, not observed outcomes here. Former unsupported
native-slot-27 samples now use malformed child 28; numeric-arena-9 negative
samples use malformed 9.5. Existing other refusals remain. The new ordinary player
melee cases and concurrent Ghastly control use the inherited native-turn helper;
other cases retain their previous tick path. Obstacle observers delegate every
real movement call and record steps including the input's first processing ticks.

Natural melee uses real turns and unforced rolls. Separate safe-death/Ignore5
and delayed-death controls supply settled combat tiles and pre-rolled lethal hits;
timed-expiry checks advance to the real deadline. The world Tree positive is
explicitly seeded with controlled log success, not natural resource acquisition
inside Gridlock. Removed live-scene barriers may retain canonical removal markers;
destruction must purge them before slot reuse. None of these controls is a retail
placement, timing, probability, rendering or full-quest claim.

The original paired baseline `18aed5d3` passed all 259 inherited game cases and
failed all 29 Gridlock cases at the absent arena-9/native-27 offer (expected 9,
actual default 1). Every subsequent Gridlock behavior and later suite was
unreached. Its fixtures matched the original fixed `66c9f5e7`, which completed
288 game cases with 286 passes and two fixture TypeErrors: the floor and obstacle
checks called `.some()` on canonical nullable interaction lists. Both runs kept
complete unchanged source, compiled-output and cache post-run content seals.

The focused fixture correction treats null interaction lists as no actions,
preserving the exact no-nonnull-action requirement and every remaining identity,
geometry, footprint, movement and restoration assertion. It changes no production
behavior or canonical definition initialization. The first failed case had not
reached its remaining floor/wall lookup, native OR, flood and restoration checks;
the second had not reached torch/skeleton/directional-wall obstacle checks. Later
Rules/shake/WASD/Cooking were unreached in that failed fixed run. Original baseline
offer-absence evidence is upstream of both corrections and remains bounded causal
evidence; it does not establish corrected-baseline fixture byte identity or
execution. Failed actuals remain separate from any later corrected result.

## No Staff of the Dead and the existing Magic Disabled term

The native special-attacks dropdown now accepts 0 (Allowed), 1 (No Staff of the
Dead) and 2 (Disabled). Offer changes invalidate agreement, and confirmation names
the selected term. Magic remains fixed to Disabled (4). The [Staff of the Dead
page, revision 15361545](https://oldschool.runescape.wiki/w/Staff_of_the_Dead?oldid=15361545)
records that Clan Wars rules forbidding Magic also prevent Power of Death.
The individually sourced [Toxic staff](https://oldschool.runescape.wiki/w/Toxic_Staff_of_the_Dead?oldid=15363039),
[Staff of Light](https://oldschool.runescape.wiki/w/Staff_of_Light?oldid=15364807)
and [Staff of Balance](https://oldschool.runescape.wiki/w/Staff_of_Balance?oldid=15299804)
share that special. Their four canonical producers are therefore refused under
both 0 and 1 by Magic Disabled; 2 still refuses all specials. Option 1 is redundant
for Power of Death in this supported configuration. This does not define which
variants the No Staff label alone excludes in an unimplemented Magic-enabled match.

Power of Death is an instant utility special: it starts on the button press,
without a target attack going through the arena's melee policy. The existing
restriction event now carries the optional ID of the actual resolved special.
This distinguishes a staff's weapon button from the same player's real Rondache
shield button or offhand orb operation. A staff in the weapon slot does not block
an unrelated shield utility. The core change only passes that generic identity;
Clan Wars owns the four-ID policy. Existing one-argument event queries and the
Champions Challenge consumer keep their behavior. Missing optional context does
not invent a selected identity; actual native activation supplies it. Other
utility and ordinary melee specials retain their existing requirements under 0/1,
and ordinary magical combat remains refused. There is no blanket MAGIC-utility veto.

This is an activation-only restriction. As an explicit TSPS lifecycle choice,
protection earned outside a match keeps its original deadline and shared removal
behavior across entry, return, death, finish and exit. Clan Wars does not reset,
suspend, refund, refresh, snapshot or restore it. A normal 200-tick preparation
outlasts the already-running 100-tick effect; a late entrant can still have time
left. That carry policy is not a claim about retail entry parity. The canonical
producer still halves positive melee damage while one of its registered staves
is held, expires after 100 ticks, clears on a positive hit without one or on a
rejuvenation pool, and refreshes without stacking when legitimately used outside.
A pending impact uses the existing modifier's current clock and equipment.

Native utility activation does not remain prearmed. Real weapon swaps reset the
armed state; genuine ordinary melee prearm remains allowed under 0/1 and the
existing Disabled entry policy clears it under 2 without spending energy. The
shared staff definitions/effect producer, Match lifecycle and all thirteen layouts
are preserved. Uncharged, noted and placeholder items are not invented special
producers. Existing resolved LMS aliases are classified by their actual selected
special ID; this does not add aliases or repair the shared producer's separate
four-item mitigation set, or promise full LMS effect parity.

The required verification distinguishes authoritative option-1 absence from the
separate old option-0 Magic Disabled utility path. It covers actual four-producer
native vetoes before payment/effect, real staff-plus-shield selection, other
utility/melee/world positives, legacy consumers and the explicitly attributed
carry policy. Fixtures and runtime results must be reviewed at their exact heads;
this section makes no standalone native execution claim. No ranged/ammunition,
ordinary magic, objective mode, modern-clan or full-#153 completion follows.
