# Clans

The OSRS Clan system (`//` chat, the Your Clan tab), which is separate from the old Clan Chat, now
called the Chat-channel ([social-chat-and-following.md](social-chat-and-following.md)). This page is
the plan and the facts it relies on. Phases 1 and 2 are built; the rest is not.

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
- The hub's extent, and the Recruit option's slot (6).
- The Clerk's Items option hands over a cloak and vexillum: the transcript names an interface we
  don't have.
- Hours are counted from when this ships: tsps has no saved playtime, so existing accounts start at zero.
- The successor follows the Clan page (next rank, then longest in the clan); Clan Settings differs.

Settings (690) is captured in rsprox 2778: the `4289` and `4290` rows, and buttons `690:20` Members,
`690:21` Applicants, `690:23` Permissions. Leave and Resign have no capture.

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
- Settings (690) with its rows, Leave Clan and Resign (7 days, undoable). An owner away 90 days
  starts resigning. A clan with nobody left is deleted when the 7 days are up.
- The Clerk's Items option. The other Settings rows and buttons say they aren't available yet.

### 3. Settings, ranks and permissions

- Clan Settings interfaces: `clans_members` (693), `clans_permissions` (706), `clans_ranktitles` (695),
  `clans_banned` (689), `clans_applicants` (699), `clans_board` (700), and `clans_info`'s editable rows.
- `ClanSettingsDelta`, which live sends for changes (3886 tick 664). Phase 1 resends the full packet.
- Talk, kick and ban rank enforcement; `ACTIVECLANCHANNEL_KICKUSER`,
  `AFFINEDCLANSETTINGS_ADDBANNED_FROMCHANNEL`, `AFFINEDCLANSETTINGS_SETMUTED_FROMCHANNEL`, which are
  empty on the client today. Refusal texts have no capture yet.

### 4. Guest clans

- `///` and `/g`, chat type 44 and 46, interface 702, `find_listened`, the guest rules (Guests may
  listen, minimum levels), Find.

### 5. Around the clan

- Broadcasts through `MessageClanChannelSystem` with their Notifications thresholds.
- Clan Hall, coffer, events, recruitment board, cloak and vexillum.
- Gateway: map the three packets and type 41 and 43 in `gateway/`, whose `COVERAGE.md` drops clans.
