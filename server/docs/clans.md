# Clans

The OSRS Clan system (`//` chat, the Your Clan tab), which is separate from the old Clan Chat, now
called the Chat-channel ([social-chat-and-following.md](social-chat-and-following.md)). This page is
the plan and the facts it relies on. All five phases are built; what could only be tested so far, or isn't possible from the evidence, is at the end.

## Evidence

| Fact | Source |
| --- | --- |
| Login order: `ClanSettingsFull`, then `clan_temp_transmit_0` (varp 3019) status 3 and home world, then `ClanChannelFull` a few ticks later, with no click | rsprox 3886 ticks 5-9, 763 tick 8 |
| Varp 3019 bits: 0-2 `clan_affinitystatus` (933), 3-5 guest status (12164), 8-17 `clan_transmit_homeworld` (12167). 89611 = status 3, guest status 1 (no clan), world 350 | 3886 tick 6; rev 241 varbit config in the [pinned dumps](https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/config/dump.varbit) |
| Status 3 is the only one that draws a clan; 1 and 3 name "No current clan" when the settings are missing | `clan_sidepanel_draw` (4397), script 4288 |
| Your Clan buttons: `701:8` Chat or Leave, `701:9` Settings | 2528 ticks 352, 378; `clans_sidepanel` |
| Leave: `ClanChannelFull(Leave)` at once, with bit 31 of varp 1378 (`clan_transmit_affined_timeout`) held for 5 ticks, which greys the button. Chat: the same timeout, and `ClanChannelFull(Join)` 3 ticks later | 2528 ticks 352-357, 378-384 |
| Channel changes are deltas: add user, delete user by index, with `updateNum` going up | 3886 ticks 337-1982 |
| Typed `//` reaches the server as `MessagePublic(type=3, clanType=0)`, and comes back as `MessageClanChannel(clanType, name, world, counter, crown, message)` | 322, 4067 |
| "To talk in your clan's channel, start each line of chat with // or /c." is type 43, once at login | 763 tick 8, 2528; absent from 3886, 322, 75 |
| Rank titles: `%varclansetting_1` bits 0-9 is rank 0's title, an index into enum 3797 (24 Recruit); the rest follow in script 4302 | script 4302, enum 3797, 3886 settings |
| Ranks: 126 owner, 125 deputy owner, 100 administrator, -1 guest, 0 and 10-124 the rest. Live clan defaults: `talkRank=-1`, `kickRank=100` | 3886, 322 |
| Five founders with 25 hours each, unique name, Clerk at the Clan Hub, 500 members, one clan per player per day | [Clan](https://oldschool.runescape.wiki/w/Clan) |

The recordings are revisions 229-235 and the cache is 241; ids here were checked against the cache's
varbit config.

## Evidence for the Clan Hub and Settings

No recording in the archive holds clan creation (interface 705 has no hits), so the flow is the cache's
scripts and the Wiki, with these filled in by us:

- The Clerk's opening options "I'd like to form a clan." and "I have some questions.": the Wiki says
  to talk to the Clerk and the transcript has no such line.
- The invite prompts ("Help X form a clan?", "Join X?") and every message from the plugin.
- Founders other than the creator start at rank 0. A former owner becomes Deputy Owner.
- Name rule beyond uniqueness: up to 20 letters, numbers, spaces, `_` and `-`.
- The hub's extent. Recruit is on slot 5, the same "Recruit" the bots already show on every player, because every other slot is taken: so the option shows everywhere and refuses away from the hub, where live only shows it there.
- The Clerk's Items option hands over a cloak and vexillum: the transcript names an interface we
  don't have.
- Hours are counted from when this ships: tsps has no saved playtime, so existing accounts start at zero.
- The successor follows the Clan page (next rank, then longest in the clan); Clan Settings differs.

Settings (690) is captured in rsprox 2778: the `4289` and `4290` rows, and buttons `690:20` Members,
`690:21` Applicants, `690:23` Permissions. Leave and Resign have no capture.

## Evidence for ranks and permissions

| Fact | Source |
| --- | --- |
| Members opens with varp 3021 = 16646144, then `IfSetEvents` on `693:19`, `20`, `11`, `13`, then scripts 4257 and 4258 with each online member's combat and total by slot | 2778, 2896, 3086 |
| A row click (`693:11`, sub = slot) mounts 289 on `693:27` and runs 4316(title, current, 0, max, canExpel, popup); `ResumePCountDialog` answers rank + 1; the popup closes and a `ClanSettingsDelta` follows | 2896 ticks 31-40, 3086 |
| The top of the range is the next rank below your own: 125 for an owner, 120 in a recording where the player is Deputy Owner | 2778, 2895 |
| "You can only edit the ranks of players whose ranks are lower than yours." | 3084 tick 188 |
| Login sends a delta of last seen (extra info bits 0-12, day less 6880) and setting 8, today | 3886 tick 664, 3086 tick 7 |
| "X has been inactive for over 90 days. The new Clan Owner is Y." comes without a 7-day wait | decoded recordings |
| Permission rows and their settings: `data/permissions.json`, written by `yarn generate:clan-permissions` from the cache's enum 3825 and what it lists, the structs, and `clan_permission_get` (script 4456). `--check` compares without writing. Stored as rank + 2 | pinned dumps; 3886 |
| Default ranks for rows with no minimum: rank 0 for notifications and coffer deposit, as 3886's clan has them; Administrator otherwise (ours) | 3886 |

More from the same recordings:

| Fact | Source |
| --- | --- |
| Column scripts 4257 and 4258 take each slot's value then a `|`, blank when offline: field N is slot N (Z-Kris is member 1 and has field 1) | 2778 ticks 49, 215; 2896 tick 21 |
| A PIN not yet entered opens under "Clan Info" before Settings | 2778, 2896, 3084, 3086 |
| Settings redraws its rows and the resign row's hide every 6 ticks while open | 2778 ticks 42, 48, 133-151 |
| For a Deputy Owner the name row says Report, and Talk and Guests send 0, not editable, though Permission access was at their rank (setting 12 = 127). No capture shows other ranks, so we treat these rows as the owner's alone | 2895, 3084 |
| Applications closes 690, mounts 293 and 663 in the chatbox with "Fetching your clan data...", and opens 699 a tick later | 2778 ticks 73-74, 2895 ticks 1428-1429 |
| "List your clan" while not inviting closes the board with a messagebox; turning inviting on closes 699 the same way. Each box also logs its line as type 115 | 2778 ticks 67, 181 |
| "No clan could be found with that name." is a messagebox with sound 2277, logged as type 115 | 76 tick 7508 |

No capture holds a permission edit, ban, kick, mute, rename or title edit. Those follow the cache's
scripts and the Wiki: `ACTIVECLANCHANNEL_KICKUSER` and friends now send `CLAN_CHANNEL_ACTION`, and
Rank Titles has the client pass varps 3023-3027 (`clan_editing_0-4`, which mirror settings 1-5) to
the server as the screen's scripts change them. All their refusals and prompts are ours. Ranks 96-104
and 124 keep their default titles: their settings have no `clan_editing` varp in the dump.

## How tsps carries it

- **Settings and channel state** use `CLAN_SETTINGS_FULL`, `CLAN_CHANNEL_FULL` and
  `CLAN_CHANNEL_DELTA`, tsps packets holding the fields the recordings show.
- **Messages** use `CHAT_MESSAGE`, as the Chat-channel does: type 41 clan chat, type 43 clan notice.
  That is `MessageClanChannel` and `MessageClanChannelSystem` in tsps's protocol.
- **Client state** is one slot per clan type, plus an active slot that `activeclansettings_find_*`
  and `activeclanchannel_find_*` select, because the cache scripts read `%varclansetting_*` and
  `activeclan*` after calling them. `find_listened` is the guest clan.

## Phases

### 1. Own a clan, chat, see Your Clan (built)

- Persistent clans in `data/saves/clans.json`, with owner and ranked members.
- The three packets above; the client's handlers fed from them, with the transmit listeners fired.
- `//` and `/c` chat through `CHAT_SENDCLAN`, delivered to everyone in the channel.
- Your Clan: name, home world, member list with ranks and worlds, Chat and Leave buttons.
- Login rejoin, leaving and rejoining the channel, remembered across logins.
- Rank 0 titled Recruit; other titles wait for phase 3.
- `::clancreate <name>` and `::clanadd <player>`, owner rank only, stay as testing shortcuts.

Not checked against live: the channel staying left across a login, rank 0 for a new member (no
source gives the default; rank 0 is common in the recordings), and the text "You are not currently
in a clan channel." for `//` outside a channel, which has no capture.

### 2. Clan Hub creation and leaving (built)

- The Clerk at the Clan Hub and the creation side panel (705): Invite in target mode, the name
  prompt, Cancel and Confirm, with five founders, 25 hours each, a unique name and one clan a day.
- `Recruit`, around the hub or with a vexillum on, for Administrators and up; the target must accept aid.
- Settings (690) with its rows, Leave Clan and Resign (7 days, undoable). An owner away 90 days is
  replaced at once. A sole owner who resigns has the clan deleted when the 7 days are up.
- The Clerk's Items option.

### 3. Settings, ranks and permissions (built)

- Members (693): ranks through the popup, expelling, the rank filters, combat and total columns.
- Permissions (706): every rank row, with Permission access and each row's minimum. Rows for guest
  rules and broadcast thresholds say they aren't available yet (phases 4 and 5).
- Bans (689): add and unban, 100 names, outsiders only. Rank Titles (695).
- Settings rows: Rename (owner, every 7 days), Talk in chat, Guests may listen.
- Talk rank and mute enforced; kick, ban and mute from the channel list.
- `ClanSettingsDelta` for ranks, members, mutes, permissions, titles and last seen.

Not verified: dragging titles and clicking popup rows in the client. Those were driven through the
packets, because the browser pane was hidden.

### 4. Guest clans (built)

- Guest Clan (702): Find with the prompt and failure line from rsprox 76 (tick 7504-7508), fetching
  then loaded (tick 7587), Chat and Leave, Info, Discard.
- `///` and `/g`: `chat_sendclan` with chat type 4, delivered as type 44. Guests hear the channel;
  members see them at rank -1 and can kick and ban them.
- Permissions: Guests may listen, and guest minimum combat, total, QP and Iron status. **QP and Iron
  status are enforced at the channel, the Ironman plugin answering `ironman:mode`.**
- Applying from Info, with Withdraw. Applicants (699) as rsprox 2778 shows: inviting flips
  `clan_i_am_recruiter` (varp 3019 bit 29), rows, stats line, accept and decline, offline accept.
- The recruitment board (700, from loc 41730/41728 "View"): clans inviting, with Size and Created days.

Ours, with no capture: the guest channel's refusals and intro, declining and its message, minimum
combat and total prompts, and button subs 2, 5 and 6 on 699 and 1 to 3 on 700.

### 5. Around the clan (part built)

Built:

- Broadcasts, in the words of rsprox's `MessageClanChannelSystem` lines, sent as type 43 to channel
  members at each Notifications rank: level-ups (with the 10s, 5s and 1s thresholds), quests, combat
  tasks, new collection log items, drops over the value threshold, joining and leaving. A PK is
  told only when the death lost items worth the PK value row or more, at the items' store value.
- Clan Hall: the hub portal (41724) into the cache's own map at 1728-1791, 5440-5503, as a private
  area per clan with Enter, Enter-member, Enter-guest and the rank check, and the exit (41617). Arrival
  tiles are ours.
- Coffer (41626, screen 696): deposit by prompt, withdraw by buttons, rank-checked, shared by
  `%varclan_3` through a new `CLAN_VAR` packet. **The side panel (697) isn't used**: nothing here
  restores the inventory tab when the modal closes.
- Every Notifications and guest value row in Permissions saves and displays.

- Interests (691): the list toggles on the server, Save stores setting 7 (rsprox 3886 has 65535), Settings
  and the board show them, and the board's filters mark wanted, unwanted or neither through varps 807 and 808.
- Outfit (694): `script4432` answers with the edited value, stored in setting 11, which the Settings
  button draws. Cloaks and vexilla take its colour: the Clerk hands out that variant, and a new motif or a login swaps what a member carries and wears. No capture shows the motif's icons on the items, so they don't appear.
- Events (703, 704): list, Edit mode, create, save, delete, rank to view, up to 10 and 30 days. The
  form's values are ours to choose: the cache's dropdown components have no script here that fills
  them, so lists are chatbox options, and date, world and duration are prompts.
- Hall settings (692): lock and player cap, enforced at the portal; the theme is saved. The Home World
  toggle saves nothing, since tsps has one world.
- Rank Titles for every rank: ranks 96-124 use varps 733, 736 and 737, shared with a quest's names.

These screens have no recording anywhere in the archive, so all of it is from the cache's scripts.

Clan Hall contents (`Contents.Clans.js`). No recording holds them, so ids are the cache's and rules the
Wiki's:

- Party chest: 783 and 266, its inventories 916 (read through `invother_getobj`, so sent as 916 + 32768) and
  92. Deposit needs setting 94; only Confirm commits, and closing returns what wasn't confirmed. The
  chest holds ids and amounts, so it refuses any item with metadata: presets and charged items. An offer is
  saved with the player and returned at login, so a restart or crash can't lose it. Wiki: what's in
  the chest is lost when the last non-guest leaves.
- Lever: 1,000 coins, setting 95. Balloons: objects 115-122 (123-130 have no Burst), gone after two minutes.
  Setting 96 and not being an Ironman decide who gets a drop. **Ours:** 16 to 64 balloons, a 50% chance, the
  whole stack dropping, and that they fill the main room.
- Coffer: the side panel 697 for deposits; Ironmen can't deposit, 50m a transaction, and a withdrawal tells
  members. **Ours:** the wording. clans.json and the player's save commit separately, so each transfer is
  journalled in the clan under a number the player's save carries with its inventory. At login, a number
  above the saved one is undone: a crash loses the transfer rather than duplicating or destroying coins.
- Piano: 698 and script 4321. Entertain sends each clicked note, from enum 3799, to the hall; Play-quietly
  doesn't; Background-music unlocks Rhapsody. **Keyboard keys play only for the player**: they stay in the
  client's script and send nothing.
- Staff: Banker, Hannibal, Raqueel, Gem and Gardener Jay Jr. **Ours:** where they stand; the Wiki gives only
  rooms. Stools and benches sit, the dummy hits with no XP, bookcases are searched. **Ours:** those lines.

Broadcasts: `boss:personal-best` (18 fights, not ToA, Tempoross or the Sepulchre), post-99 XP from
`onExperienceGained`, `diary:tier-complete`, `ironman:hardcore-death`, `loot-keys:opened`, and combat and total
level marks. **Ours:** hardcore death and loot key wording; total level every 25, as tsps's own level-up message.

Gateway (`gateway/.../down/Clans.kt`, `gateway/COVERAGE.md`): 124-128 and clan chat both ways, kick, ban and mute.
It compiles on JDK 17 and its tests decode through RSProx's 241 decoders, but **nothing has run against the
official client**. No recording shows `VarClan`, guest chat upstream, or kick, ban and mute, so those rest on
rsprot and the scripts. The gateway restarts update numbers from the last full update, because live's delta carries
the count it applies on top of and tsps's is one higher.
