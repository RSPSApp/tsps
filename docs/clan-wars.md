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
configuration is **melee-only Last Team Standing, First to X kills or timed Most kills on Plateau**;
this is an explicit supported configuration, not a claim about official default settings.
The team cap and supported mode are negotiable. Other combat and arena controls are hidden;
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
Team Standing, the team with no fighters loses. Result screens return remaining participants to the lobby.
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

Other arenas, adjustable combat restrictions, King-of-the-Hill/Oddskull
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
The existing safe-death, jail Exit, unrestricted return, late entry, cap reservation
and leaving-channel rules apply. Having no living fighters temporarily does not
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
