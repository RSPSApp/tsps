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
- Active revision 241 cache/map: Challenge portal at 3126,3620; Plateau template
  region 51,77, its paired dark-rock Forfeit portals and east-side jail exits.
  The selected landing and jail tiles were checked against real collision.
- No team setup, HUD, result or viewing interface appeared in the inspected local
  capture corpus. Recording 229/02489 is free-for-all footage and is not team-match evidence.
  The tracker-linked Void implementation explicitly leaves its challenge portal unimplemented.

## Player flow

Two captains or channel owners in the Clan Wars building right-click each other and
choose Challenge. Reciprocal requests open the native setup interface. The offered
configuration is **melee-only Last Team Standing or First to X kills on Plateau**; this is an explicit
supported configuration, not a claim about official default settings. The team cap and Last Team Standing / First-to-X-kills mode are negotiable. Other
combat and arena controls are hidden; timed and objective mode selections are refused and reset to the server offer.

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
A defeated fighter goes to the map's jail if the battle is still running. The team
with no fighters loses. Result screens return remaining participants to the lobby.
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

Other arenas, adjustable combat restrictions, timed/King-of-the-Hill/Oddskull
modes, modern-clan selection, spectating, exact official messages and exact team-specific
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
  mount and interrupted-save recovery. Native browser QA checks the visible negotiation,
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
applies the existing opponent-change delay. Timed and objective rows are refused.
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
