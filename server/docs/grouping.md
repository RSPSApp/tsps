# Grouping: player groups

`plugins/interface/Grouping.plugin.js` (units in `plugins/interface/grouping/`) gives players
groups: a leader and members who form, join and leave them, kept across logins and restarts, with
`grouping:*` events for co-op content. The Grouping tab's own activity list and minigame teleports
are separate and unchanged (`SideChannels.plugin.js`, `MinigameTeleports.plugin.js`).

## Sources

- **OSRS Wiki, [Grouping](https://oldschool.runescape.wiki/w/Grouping)** (revision of 5 October
  2026): the tab is a finder of activity chat channels with minigame teleports. Those channels
  have no leader, ranks, invitations or cap, so the page gives no numbers for a group.
- **OSRS Wiki, [Group Ironman Mode](https://oldschool.runescape.wiki/w/Group_Ironman_Mode)** (the
  target of "Group storage"): the game's groups with a leader. A group is 2 to 5 players, the
  leader inviting up to four more; the only roles named are leader and member; leadership goes to
  the longest-serving member (the earlier joiner on a tie); a group whose last member leaves ends.
  Group storage is for members only. This is what the groups here follow.
- **Live captures** (the user's RSProx recordings, rev 230): the Grouping tab (interface 76) opens
  with only its teleport list (`grouping:teleport`, 76:30, op 1). OSRS has no party interface to
  copy, so the panel is a server-defined interface (group 30020).
- **Cache:** "Group storage" is locs 43487-43499 (gameval `group_storage_ge`, `_lumbridge`,
  `_falador`, ... `_neitiznot`), each with the one option "Open".

## Rules

| Rule | Value | Source |
| --- | --- | --- |
| Group size | 5 (leader + 4) | Wiki, Group Ironman Mode |
| Roles | `leader`, `member` | Wiki, Group Ironman Mode |
| Who invites, withdraws, promotes, kicks, disbands | the leader | Wiki, Group Ironman Mode |
| Invitation lifetime | 2 minutes, or until either side logs out | ours: the Wiki gives none |
| Wait between invitations | 2 seconds (`SecondsTimer`, as trade requests) | ours, after `Trading.ts` |
| Leader leaves | the longest-serving member leads, preferring one online | Wiki (inactive leader rule) |
| Leader logs out | their invitations lapse at once; after a 100-tick (one minute) grace, if still away, the lead passes to the longest-serving member online (with none, the leader keeps it) and a group of one ends | ours |
| Member logs out | keeps their place, shown offline | ours |

- **Cap:** checked when an invitation is sent and again, as one step with the add, when it is
  accepted, so invitations can outnumber the places left and the last accept is refused with
  "That group is full."
- **Repeated and crossed invitations:** inviting someone already invited renews the one
  invitation. Inviting someone whose group has invited you, while you are alone or in no group,
  accepts their invitation, so two players inviting each other end up in one group. Accepting one
  invitation withdraws every other invitation to that player.
- **Privacy:** an invitation needs the invitee to be logged in to the same kind of character
  (main, league, hardcore), shown to the inviter by their private chat setting, and not ignoring
  the inviter. Every one of those refusals reads "That player can't be invited right now.", the
  same as for a player who doesn't exist, so it never tells which. Inviting a player on your own
  ignore list is refused plainly. An ignore added by either side after the invitation voids it.
- **The Find tab** lists only players an invitation could reach (same rules), and not players
  already in a group of two or more, nearest first, at most 100.

## Identity and persistence

- A member is their account's encoded name (`FriendsChatManager`'s `accountName`, the value
  `PlayerRelations` keys friends and ignores by): case, underscores and display-name changes never
  make a second entry. Typed names go through `DisplayNames.resolve`, so a display name or a
  login name still shown both work.
- The groups are saved whole to `data/saves/groups.json` (`TSPS_GROUPS_FILE` overrides it) on
  every change, with each member's join time and how they spell their login name. Invitations and
  who is online are memory only.
- The leader's grace is what lets a role survive a relog and a restart: a restart logs everyone
  out, and the server stops before any grace runs out.
- Each player's save also holds `grouping:group` (the group id, 0 for none) and `grouping:role`
  (`leader`, `member` or ""). The store is the authority: a login reads it first, corrects the
  attributes and says "You are no longer in a group." to someone removed while away.

## Group storage

The chests are transforms of bank locs (the Grand Exchange's is 31483), picked by varbit 13677
`bank_chest_access`: 0 a stool, 1 the Deadman chest, 2 Group storage. Nothing on this server sets
it to 2 yet, so nobody sees one until Group Ironman does. Opening one checks the store at that click: an invitation or a saved
attribute is not membership. A member's click is sent as `grouping:storage`; the storage itself
(Group Ironman's shared bank) is not on this server, so with no handler the player is told
"Group storage isn't available on this world."

## Events

| Event | Direction | Payload |
| --- | --- | --- |
| `grouping:changed` | emitted after every change | `{ type, profile, groupId, group, actor, target, players }`: `type` is `created`, `invited`, `joined`, `declined`, `invite-withdrawn`, `promoted`, `kicked`, `left`, `disbanded`, `online` or `offline`; `group` the snapshot after it (before it, for `disbanded`); `actor`/`target` account names; `players` every logged-in player whose view changed |
| `grouping:get` | request | `{ player }` → `group` (snapshot or null), `role` |
| `grouping:invite` | request | `{ player, target }` (a player or a typed name) → `invited` |
| `grouping:open` | request | `{ player }` opens the panel |
| `grouping:storage` | emitted | `{ player, group, handled }` when a member opens group storage |

A snapshot is `{ id, profile, cap, leader, members: [{ account, name, role, online, joined }],
invites: [{ account, name, expires }] }`.

## Commands and panel

`::group` opens the panel: Group (members, then pending invitations; or a row to form a group),
Invites (groups that have invited you) and Find (players you can invite). Selecting a row shows
its details and up to two buttons; each button's action is worked out again from the store when
clicked. The rows are sent over the game socket per viewer, not through a public
`registerContentEndpoint` resource, because the Find list depends on who is asking.

`::group create | invite <name> | accept [name] | decline [name] | withdraw <name> |
promote <name> | kick <name> | leave | disband | info` do the same by name.

RuneLite through the gateway can't show the panel: the gateway drops every server-defined
interface (group 30000 and up, `runelite-gateway/src/main/kotlin/gateway/down/Interfaces.kt`), as
it does `::commands` and `::teleports`. The named commands answer in chat, so they work there.

Tests: `server/tests/grouping.test.cjs`.
