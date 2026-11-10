# Music progress

Track titles, song archive IDs, unlock-varp banks/bits, and automatically unlocked tracks come from cache DB table 44. Track rows without an unlock slot (or a parent row with a slot) are variants and do not count toward the cape requirement. Rows that share a slot are counted once.

On a successful song packet or an authoritative region change, the Music plugin persists the track's canonical unlock slot and updates its complete native varp bitfield. A successful song packet also sets native current-track varp 3883 to the track's DB-table row ID, then runs cache script 3936 to refresh the Music tab's `Playing:` field. The same script runs when Music actions are bootstrapped after login or the welcome-screen Play button. Login restores unlock bitfields and tracks marked automatically unlocked by the cache. The Music sidebar uses native widget group 239, whose player-side jukebox reads those same unlock varps and only permits playback for unlocked entries.

Olaf the Bard sells the Music cape and hood for 99,000 coins after every non-holiday unlock slot is complete. The cape's Air Guitar emote flag is permanently granted on purchase. Using the cape requires the non-holiday tracks to remain complete; its teleport leads to Falo. Trimming additionally requires every cache-listed music unlock slot, every quest, and every Achievement Diary tier. Holiday status is determined by matching cache track titles against the current OSRS Wiki holiday-track list.

Track unlocks send a message once: "You have unlocked a new music track: <col=ff3045>Name" on a transparent chatbox, `<col=e00a19>` on an opaque one (varbit 4608), with no closing tag or full stop. No jingle is played: live sends only the unlock varp and the message. Across the 988 unlock messages in the rsprox recordings (revs 224-239, e.g. 224/01437), the few ticks that also carry a jingle owe it to something else, such as a League task notification; 234/03275 shows the colour switch when transparency is turned on. Cape requirements include every native slot, whatever unlocks it.

## Quest, minigame and event unlocks

The cache's unlock hints (DB table 44, column 2: "in Varrock.", "during the Dragon Slayer II quest.",
"after completing the While Guthix Sleeps and Dragon Slayer II quests.", "during a Christmas event.")
say where each track plays. Area tracks unlock from the music area under the player, boss and
minigame tracks from their own plugins' `music:unlock-track` events.

## Music areas

Music follows the Wiki's music maps tile by tile. `data/definitions/music-areas.json` is generated
by `scripts/import-music-areas.mjs` from the `music` and `map` buckets behind Template:Music track
map: every current polygon is a music area, played by each track whose map holds it, and a tile
belongs to the smallest polygon covering its centre. Polygons with the same tracks are one area.
The file lists the areas, then per plane and 64x64 region the area of every tile, as `id*count`
runs row by row from the region's south-west corner (`-` is no area). `Music.tracksAt(x, y, plane)`
decodes a region the first time it is asked and returns the area's track list, one list per area. A
floor with no area of its own plays the ground floor's; an instance plays the cache-map tile its
chunk copies (`Music.instanceSourceTile`, through the chunk's rotation); a player on a boat deck
plays the sea under it. `MAP_PAGES` in the import reads the Wiki music map pages whose tracks hold
no map of their own (the Ardent Ocean's, for All Aboard and Set Sail), resolving its
`{{Map polygon|…}}` islands as holes. `UNMAPPED_AREAS` adds the areas no Wiki map draws, under the
Wiki's own: the Wilderness bosses' lairs and the Escape Caves ("A Dangerous Game", as captured), each
Tombs of Amascut path's puzzle room (its Test of track, which the Wiki's track pages place in that
path) and the Sorceress's Garden's centre, the fountain between its four seasonal gardens. Impulses
is painted over Zanaris around its crop circle, the server's only one (ours: within 3 tiles; live
plays it beside any active crop circle).
A private area's `getMusicTrack` hook names its track instead: a player-owned house, whose rooms
sit at allocated tiles outside every map area, plays Home Sweet Home ("inside a Player-owned house.").

Regenerate with `yarn build` then `node scripts/import-music-areas.mjs`; `--check` reports whether
both files (Modern and Classic) still match. Both read the Wiki response cached outside the repo
(`<tmpdir>/tsps-wiki-music`, or `--cache <dir>`) and fetch it, in four paged requests, only when
the cache is missing or with `--refresh`, so neither runs in CI. The tests cover the import's rules
on small made-up maps and the generated file's own consistency.
`tests/fixtures/music-unmapped-tracks.json` lists the cache tracks whose hint names a place but that
no music area plays: only Rhapsody, which the clan hall piano plays and unlocks itself;
`tests/music.test.cjs` fails when that list changes.

## Area shuffle

In Area mode the session starts a random track of the area on entering it, and keeps the playing
track when the player moves on to another area that plays it too; moving within an area changes
nothing, and neither does a tile with no area (a gap between two), which keeps the last one. A track plays for its cache length (DB table 44, column 3, in ticks) plus one tick. Then
the server sends track 147 (silence) with fade-out speed 20 and sets the current-track varp 3883 to
-1; two ticks later it starts another of the area's tracks, picked at random but never the one
that just ended, with zero fades. An area with one track plays it again. Entering an area unlocks
all its tracks at once, in Area, Manual and Shuffle mode alike: the one that starts (in Manual and
Shuffle mode, one picked the same way) first, then the rest by name. Checked on live: Lumbridge,
Draynor, Al Kharid, the land north of its mine and Varrock each unlocked their whole Wiki list on
entry, and the Lumbridge track played on right up to the Al Kharid gate. Ours: a song a plugin sends (a boss fight, a minigame) takes over until the next area
change, and the area track sent again from its start, as the volume restart does, plays its full
length from then. A plugin handing the music back after its own (`Music.areaTrackAt`) picks one of
the area's tracks the same way.

As captured (rsprox, 1,857 track ends in Area mode): the gap is two ticks in all but a few that
an area change cut short. Tracks started after a gap end exactly length + 1 ticks later (1,482 of
1,551); tracks started by an area change (with the 60-cycle fade-in) end at length + 1 or length + 3
about equally, and the server uses + 1. In the 33 multi-track areas seen, none of 247 picks
repeated the track that had just ended (e.g. 237/04001, Yanille's Big Chords and Magic Dance
alternating). Across 12 Area-mode recordings (641 track starts, the player's tile at each), the
tile's Wiki area lists the track that started 462 times; most of the rest are starts on tiles the
Wiki maps no area for, a Ferox Enclave playlist and a quest's own music.

Quest tracks are the live floor: live unlocks each the first time it plays, somewhere inside the
quest, and a quest plugin that knows the moment emits `music:unlock-track` there (Below Ice Mountain,
Meat and Greet). `QuestUnlocks.Music.js` reads every quest-naming hint, and on `quest:completed` the
Music plugin unlocks the tracks whose hint names that quest, once every quest the hint needs is
complete ("and": all; "or": either; asked through `quest:is-complete` by name). At login the same
runs silently for quests completed before this existed, before the unlock varps are restored. A
hint's name may be the registered one, "<name> Quest" (Observatory, Waterfall, Legends'), the first
of a numbered pair ("Monkey Madness" is Monkey Madness I), or a cache spelling listed in
`CACHE_QUEST_NAMES` ("Digsite" is The Dig Site). `tests/music.test.cjs` lists the hinted quests the
server has not got (While Guthix Sleeps, The Blood Moon Rises, Song of the Elves, A Night at the
Theatre, Garden of Death, and the General's Shadow and Lair of Tarn Razorlor miniquests): their tracks
stay locked until those arrive.

Holiday-event tracks ("during a Christmas event.", 15 slots) have no event plugins to unlock them yet;
`data/music-holiday-tracks.json` keeps them out of the music cape requirement.

## Classic areas

All Settings' "Music area type" (varbit 12233, 0 Modern, 1 Classic) picks the map. Modern is
`music-areas.json`; Classic is `music-areas-classic.json`, built by the same import from the Wiki's
historic music maps, the ones a track page captions "Location before 2026 and in Classic mode"
(`map.is_historic` in the `map` bucket, `bucket=hist` on the page). A track plays in Classic mode
where its historic maps put it, and where its current maps put it when those overlap none of its
historic ones: areas added since, which Classic mode plays too (ours: the Wiki keeps only the
historic maps of reworked areas). A track with no historic map plays as in Modern mode. Classic
areas are mostly 64x64 squares with one track each, as the setting's own text says. There is no
capture of Classic mode; the Wiki is the only source. `Music.tracksAt(x, y, plane, classic)`
reads either map; plugins that hand the music back (`Music.areaTrackAt`) use Modern.

## Music settings

The settings are varbits of varp 19 (`musicloop`), which also holds bits the server owns (Music
cape flags 4670-4672 and 8371, the farming tab 4776, the Trawler camera 4814, a Zeah fairy ring
4885). The cache's All Settings structs give each one's text and default:

| Varbit | Setting | Server |
| --- | --- | --- |
| 4137 `music_enableloop` | "Play the last track if no other is available", on by default (live sends 1 at every login) | When a track ends and the area (or Shuffle) has no other track to play, it restarts only when on; off, the music stops. |
| 10078 `music_unlock_text_toggle` | "Music unlock message", shown when 0 | The unlock still happens, without the chat line. |
| 12233 `music_area_mode` | "Music area type": Modern, Classic | Above. |
| 19734 `use_previous_music_mode_on_login` | "Default to area music mode on login", on when 0 | Login resets Shuffle or Single to Area unless the player turned it off. |
| 19737 `use_shuffle_mode_on_manual_music_selection` | "Music mode to use when manually selecting music tracks": Single, Shuffle | A track picked from the list in Area mode switches to that mode; Shuffle and Single stay. |
| 19732, 19733 | Text shadow, which tracks the list shows | The client's own; saved only. |

The client's scripts write the checkboxes (and the playlist, bits 14-17) into varp 19 themselves
and transmit it; `Player.setAudioSetting` saves only the setting bits (`Music.SETTINGS_MASK`), and
the Music plugin sends the varp back with the server's bits as last sent. All Settings' dropdowns
reach the server instead (`settings:option-chosen`), and the Music plugin sets the varbit.

## Shuffle mode

As captured (rsprox 236/03934, 236/03935): the Area, Shuffle and Single buttons send "You are now
using the area music mode." (shuffle, single) and the mode; switching to Shuffle lets the playing
track finish. Skip Track, in Shuffle mode only, starts another track at once with the default
fades. A Shuffle track ends as an area track does (silence with fade-out speed 20, then the next
two ticks later with zero fades, as captured on a playlist), and the next is a random unlocked,
released track other than the one that ended (`music:shuffle-track`). Shuffle ignores music areas,
though entering one still unlocks its tracks. Ours: a Single track switched to Shuffle gets its
full length from then, and Shuffle with nothing playing (at login) starts a track at once.

Not covered yet: playlists (the dropdown, adding and removing tracks, the playlist varps from
5239), "Play the default track when entering an area" (the Wiki's areas name no default track) and
"Update music when changing playlists".

## Jingles and fades

As captured (rsprox revs 236-239, 1,584 jingles): a region change sends the track with the
MidiSongV2 defaults 0/60/60/0 (fade-out delay and speed, fade-in delay and speed, in 20 ms client
cycles), and every jingle is preceded on the same tick by the current track with all four fades 0.
No song packet follows most jingles: the client cuts the track, plays the jingle and resumes the
track itself when the jingle ends; a song packet that arrives meanwhile is the track to resume.
`PacketSender.sendSong(id, fades?)` sends the defaults, and `sendJingle(id)` sends the session's
current track (`PlayerSession.getCurrentMusicTrack()`) with zero fades before the jingle. The jingle
packet's 24-bit length field is left as the old callers pass it; the client no longer reads it.

When the music volume varp (168) rises from 0, live sends track 147 (silence) with zero fades on that
tick and the area track with zero fades on the next (17 captured sessions), so the track starts over;
`restartMusicAfterVolumeRaised` in `Music.plugin.js` does the same from the `audio:setting-changed`
event that `Player.applyAudioSettingFromClient` announces. Dropping the volume to 0 sends nothing; the
client keeps the track it was asked for while silent and starts it when volume comes back.
