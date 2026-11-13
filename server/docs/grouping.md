# Grouping: player groups

`plugins/interface/Grouping.plugin.js` (units in `plugins/interface/grouping/`) gives players
groups: a leader and members who form, join and leave them, kept across logins and restarts, with
`grouping:*` events for co-op content. It also runs the Grouping tab's activity chat-channels
(below). The tab's mounting and teleports stay with `SideChannels.plugin.js` and
`MinigameTeleports.plugin.js`.

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

## Group Ironman groups

A Group Ironman group needs no command: the Group Ironman plugin runs it from the cache's own
interfaces (`server/docs/group-ironman.md`), and its members are told how there, not with
`::group` (an invitation is live's chat line, not "Type ::group to answer").

A group formed by a Group Ironman (the Ironman plugin's `ironman:mode` is `group`,
`group-hardcore` or `group-unranked`) is a Group Ironman group for good (`ironman` in the
store). These rules follow the Wiki's Group Ironman Mode page; `grouping/Kinds.Grouping.js`,
`Leaving.Grouping.js`, `Leadership.Grouping.js` and `Names.Grouping.js` hold them. The Group
Ironman plugin adds its own on top (`server/docs/group-ironman.md`).

The leaving, step-down and no-disband rules start once the group is **formed**: until then
`grouping:leaving-period` answers `period: false` and the group works like any other (members
leave and are removed at once, the lead passes at once, the leader may disband it).

| Rule | Value | Source |
| --- | --- | --- |
| Who can be in one | only Group Ironmen, and a Group Ironman only in one: "Only Group Ironmen can join a Group Ironman group." / "A Group Ironman can only join a Group Ironman group." *(ours)*, checked at the invitation and again at the accept. The Find tab lists only players of the group's kind | Wiki (only fresh Group Ironman accounts join one) |
| Changing mode | refused into or out of Group Ironman while in any group: "Leave your group first." *(ours)* | ours |
| Leaving, or being removed | the member stays listed as leaving for 7 days, saved. They can still trade with the group and deposit into its storage, but can't withdraw, join another group or lead. Then they are out | Wiki |
| Changing their mind | `::group stay`, or the panel's Stay button, during the 7 days; a removed member can't | Wiki ("7-day grace period to change their mind"; removed members get 7 days "to settle their affairs") |
| A leaving leader | hands the lead at once to the longest-serving member who isn't leaving | ours, after the Wiki's succession |
| The last member not leaving | leaving ends the group, leavers too | Wiki (a group with no members left ends) |
| A group of one | doesn't end when its leader stays logged out; it keeps its storage | ours |
| Stepping down | `::group promote <name>` names a successor who isn't leaving; they lead after 7 days, `::group cancel` (or the panel's Keep lead) calls it off | Wiki (against hijacking) |
| An inactive leader | after 30 days away the lead goes to the longest-serving member who isn't leaving | Wiki |
| A leader's logout | hands nothing on (the 100-tick grace is for other groups) | Wiki (the 30-day rule) |
| Taking back a removal | `::group unkick <name>`, or the panel's Keep them, during the 7 days | ours, after the Wiki's grace |
| Disbanding | refused: "A Group Ironman group can't be disbanded. It ends when its last member leaves." *(ours)* | Wiki |
| The group's name | `::group name <name>`, the leader, or through Tony: at most 12 characters, letters, numbers and spaces *(ours)*, not another group's or a clan's ("That name is taken.", asked with `clans:name-taken`) | Wiki |
| Ending a group | any group (disband, last leave, a solo member accepting another invitation) first asks `grouping:can-end`; group storage refuses while it holds items: "Empty the group storage first." | ours (the user's choice) |

Leaving periods that have run out are settled every 100 ticks from server start, and at every
login. A member settled while away is told "You are no longer in a group." when they next log in.

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

## Chat-channels

Live capture (rev 242, the user's RSProx session of the Grouping tab):

- Mounting the tab sends op 1 on `grouping:teleport` (76:32) and `grouping:hop_button` (76:26) for
  slots 0-30. Each button is the dynamic child at the chosen activity's index (client varc 64,
  script 435), so a click's slot is the activity (enum 848). `SideChannels` sends both.
- Script 435 offers "Switch <world>" (and shows "Suggested world:") whenever enum 850 gives the
  chosen activity a world, and for Castle Wars uses world 383 unless varc 103 (`PLAYERMEMBER`, set
  by live's `playermember` script 828 as the social tab mounts) says members. A server has one
  world, so every login sends the client enum 850 with no world for any activity (an
  `enumOverrides` dataset from the sender `grouping-tab`; the client keeps each sender's enum
  overrides apart, so a league's aren't cleared) and runs script 828 with the world's members flag.
  On a free-to-play world Castle Wars still suggests 383; RuneLite through the gateway gets no
  enum overrides and still shows the button.
- Teleport on an activity with no teleport (Tombs of Amascut, Shooting Stars), and with no activity
  chosen (slot 0, the user's live screenshot), answers "That activity doesn't have a teleport." The
  Wiki's table lists which have none (Theatre of Blood, Tombs of Amascut, Dagannoth Kings, God Wars,
  ...). A slot past the activities has no button to click and gets nothing.
- Join (client script 437) leaves the current channel, then sends an ordinary chat-channel join
  with the enum 849 name ("osrs star cc"). The server answers "Attempting to join
  chat-channel...", then "Now talking in chat-channel Stars", and the channel's owner is
  "osrs star cc", its name "Stars", kick rank General, every member Unranked and from any world.
  Leave sends an empty name and gets "You have left the channel."

No player owns these channels here, so they run as **system channels** in `FriendsChatManager`:
registered under a key ("osrs star cc"; keys compare as names do, since the cache writes them with
no-break spaces and a typed name has ordinary ones, while the owner name stays the cache's string
for the tab's own Join/Leave check), winning over any account of that name, with no Owner rank,
optionally admitting only some players, and rejoined at login by their key. Other plugins reach
them through `friends-chat:system-channel` `{ key, channel }`, and `friends-chat:joined`
`{ player, channelKey }` is the counterpart of `friends-chat:left`. Which activity channels exist,
and the name each shows, is the Wiki's Grouping table (`plugins/interface/data/grouping-channels.json`):
27 channels, "Osrs Ba" and so on, with Shooting Stars showing live's "Stars". Bounty Hunter,
Mastering Mixology and Sorceress's Garden have no channel on the Wiki though enum 849 names one
("osrs bounty", "osrs mmix", "osrs sgarden"), so their Join finds no such channel.

**A group's own channel**, `#group-<id>` (a key no typed name reaches), is members only, named
"Group", with the leader shown as owner. Forming or joining a group enters it when the player is in
no other channel; otherwise they are told to use `::group chat`. Its chat is ordinary Channel chat
(`/`), and its members get the client's friends-chat minimap dot. Leaving or being kicked takes the
player out, and disbanding ends the channel. When a leader joins an activity channel, members in no
channel or in the group's own follow; anyone in another channel is told where the group went, and
nobody is moved out of a channel they chose. A leader's return to an activity channel at login (the
rejoin of their last channel) brings nobody, as members may have chosen another channel meanwhile.
In the group's channel the leader holds the Owner rank and members Recruit (a system channel's
`rankOf`), which is what Chambers of Xeric reads: a group in its channel can make a CoX party at
the recruiting board, its leader leading it, with no CoX change.

## Activities and group size

A group stays at most 5. Each minigame that uses groups says how many players it takes, from its
own rules, with `grouping:activity` at startup, so Grouping keeps no table of its own. A minigame
forming a party asks `grouping:members` for the group's members online and whether the whole group
fits ("Your group has 3 players; Royal Titans takes at most 2."), and `grouping:same-group` whether
two players share a group. `::group info` lists the activities the group is too big for.

What uses it (none of this is OSRS; players without a group see no change):

| Activity | Size | With a group |
| --- | --- | --- |
| Tombs of Amascut (Grouping Obelisk) | 8 | A group leader's new party takes in the members who are in the lobby and in no party ("You have joined the party of <leader>."); the others are told to apply at the obelisk, and a member applying is accepted at once unless declined before or the party is full. |
| Theatre of Blood (notice board) | 5 | The same from Ver Sinhaza, for members who have met the Mysterious Stranger (the board calls anyone else over), joining through the leader's own Accept. |
| Fractured Archive (Grouping Board) | 8 | The same from the Archive's lobby. |
| Chambers of Xeric (recruiting board) | 100 | No change in CoX: its party is a chat-channel, and in the group's own channel the leader is Owner and members Recruit, so the group's channel makes the party. |
| Barbarian Assault | 5 | Its queue is one team, so group-mates who queue always play together. |
| Pest Control (landers) | 25 | When more wait than a lander takes, a group's waiting members board or wait together; a game always starts. |

Castle Wars and Soul Wars keep live's team rules. Live has no way to put friends or a chat-channel
on one team in their public games (Wiki: Castle Wars' portals refuse the bigger team, Soul Wars
balances by combat level), so group members pick portals and are balanced like everyone else.

Each announces its size at startup, from its own constant. A group too big for a party (more than
it takes) gets "Your group has N players; <activity> takes at most M." and fills it in group order.

## Group storage

The chests are transforms of bank locs (the Grand Exchange's is 31483), picked by varbit 13677
`bank_chest_access`: 0 a stool, 1 the Deadman chest, 2 Group storage. The Ironman plugin sets it to
2 for Group Ironman accounts, so only they see the chests. Opening one checks the store at that
click: an invitation or a saved attribute is not membership. A member's click is sent as
`grouping:storage` with their own snapshot entry (`member`, whose `leaving` says whether they can
only deposit). The storage itself is `GroupStorage.plugin.js` (`server/docs/group-storage.md`).
With no handler, the player is told "Group storage isn't available on this world."

## Events

| Event | Direction | Payload |
| --- | --- | --- |
| `grouping:changed` | emitted after every change | `{ type, profile, groupId, group, actor, target, players }`: `type` is `created`, `invited`, `joined`, `declined`, `invite-withdrawn`, `promoted`, `kicked`, `left`, `leaving`, `stayed`, `disbanded`, `online` or `offline`; `group` the snapshot after it (before it, for `disbanded`); `actor`/`target` account names; `players` every logged-in player whose view changed |
| `grouping:get` | request | `{ player }` → `group` (snapshot or null), `role`, `member` (their own entry, or null), `account` (their key, or null) |
| `grouping:same-group` | request | `{ player, other }` (other: a player or a login name) → `same`, `ironman`; a leaving member still counts |
| `grouping:can-end` | emitted before a group ends | `{ groupId, group, player, allowed, reason }`: `allowed: false` keeps it, and `reason` is said |
| `ironman:change-mode` | answered | refuses a change into or out of Group Ironman while in a group |
| `grouping:invite` | request | `{ player, target }` (a player or a typed name) → `invited` |
| `grouping:create` | request | `{ player }` → `created` (a group led by them, if they are in none) |
| `grouping:leave` | request | `{ player }` → `left` (as `::group leave`) |
| `grouping:stay` | request | `{ player }` → `stayed` (as `::group stay`) |
| `grouping:promote`, `grouping:cancel-step-down`, `grouping:unkick` | request | `{ player, target }` (cancel: `{ player }`) → `promoted` / `cancelled` / `kept`, as `::group promote`, `cancel`, `unkick` (the Group Ironman settings' rows) |
| `grouping:of-account` | request | `{ name }` → `groups`: snapshots of the groups the account is in, for an account that may be offline |
| `grouping:kick` | request | `{ player, target }` (a player or a typed name) → `kicked` (as `::group kick`) |
| `grouping:disband` | request | `{ player }` → `disbanded` (as `::group disband`) |
| `grouping:rename` | request | `{ player, name }` → `renamed` (the leader) |
| `grouping:can-join` | emitted before an invitation or a join | `{ player, inviter, groupId, group, stage, allowed, reason }`: `allowed: false` refuses with `reason` |
| `grouping:leaving-period` | emitted | `{ groupId, group, period }`: `period: false` means a Group Ironman group's members leave at once (not yet formed) |
| `grouping:open` | request | `{ player }` opens the panel |
| `grouping:storage` | emitted | `{ player, group, member, handled }` when a member opens group storage |
| `grouping:activity` | announce | `{ name, maxSize }`: how many players a minigame takes |
| `grouping:members` | request | `{ player, activity?, maxSize? }` → `groupId` (0 for none), `leader` (online, else null), `isLeader`, `members` (online, leader first; `[player]` without a group), `size` (every member), `max`, `fits`, `message` |
| `friends-chat:system-channel` | request (FriendsList) | `{ key, channel }`: runs a channel no player owns, `channel` `{ ownerName, channelName, entryRank?, talkRank?, kickRank?, admits?(player), rankOf?(player) }`, or ends it with `null` |
| `friends-chat:joined` | emitted (FriendsList) | `{ player, channelKey, rejoin }` when a player joins a chat-channel; `rejoin` is true for the return to their last channel at login |

A snapshot is `{ id, profile, cap, ironman, name, leader, members: [{ account, name, role, online, joined,
leaving, kicked }], invites: [{ account, name, expires }] }`. `leaving` is when a leaving member's
seven days end (ms), and 0 otherwise.

## Commands and panel

`::group` opens the panel: Group (members, then pending invitations; or a row to form a group),
Invites (groups that have invited you) and Find (players you can invite). Selecting a row shows
its details and up to two buttons; each button's action is worked out again from the store when
clicked. The rows are sent over the game socket per viewer, not through a public
`registerContentEndpoint` resource, because the Find list depends on who is asking.

`::group create | invite <name> | accept [name] | decline [name] | withdraw <name> |
promote <name> | kick <name> | leave | stay | disband | info` do the same by name, `::group chat`
switches to the group's own chat-channel, and a Group Ironman group's leader also has `cancel`,
`unkick <name>` and `name <group name>`.

RuneLite through the gateway can't show the panel: the gateway drops every server-defined
interface (group 30000 and up, `runelite-gateway/src/main/kotlin/gateway/down/Interfaces.kt`), as
it does `::commands` and `::teleports`. The named commands answer in chat, so they work there.

Tests: `server/tests/grouping.test.cjs`.
