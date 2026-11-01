# Clans

The OSRS Clan system (`//` chat, the Your Clan tab), which is separate from the old Clan Chat, now
called the Chat-channel ([social-chat-and-following.md](social-chat-and-following.md)). This page is
the plan and the facts it relies on. Phase 1 is built; the rest is not.

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
- **Stand-in for creation:** `::clancreate <name>` and `::clanadd <player>`, owner rank only. No
  player can make a clan until phase 2.

Not checked against live: the channel staying left across a login, rank 0 for a new member (no
source gives the default; rank 0 is common in the recordings), and the text "You are not currently
in a clan channel." for `//` outside a channel, which has no capture.

### 2. Clan Hub creation and leaving

- Clerk at the Clan Hub, the creation side panel (705): invite four founders, the 25-hour check,
  name rules, one clan per day.
- `Recruit` and accepting an invite; leaving the clan, with its confirm.
- Resigning and ownership transfer. **The Wiki pages disagree on the successor**, so it needs a capture.
- Settings button (`701:9`), which only says it is unavailable in phase 1.

### 3. Settings, ranks and permissions

- Clan Settings interfaces: `clans_members`, `clans_permissions`, `clans_ranktitles`,
  `clans_banned`, `clans_info`.
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
