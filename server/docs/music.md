# Music progress

Track titles, song archive IDs, unlock-varp banks/bits, and automatically unlocked tracks come from cache DB table 44. Track rows without an unlock slot (or a parent row with a slot) are variants and do not count toward the cape requirement. Rows that share a slot are counted once.

On a successful song packet or an authoritative region change, the Music plugin persists the track's canonical unlock slot and updates its complete native varp bitfield. A successful song packet also sets native current-track varp 3883 to the track's DB-table row ID, then runs cache script 3936 to refresh the Music tab's `Playing:` field. The same script runs when Music actions are bootstrapped after login or the welcome-screen Play button. Login restores unlock bitfields and tracks marked automatically unlocked by the cache. The Music sidebar uses native widget group 239, whose player-side jukebox reads those same unlock varps and only permits playback for unlocked entries.

Olaf the Bard sells the Music cape and hood for 99,000 coins after every non-holiday unlock slot is complete. The cape's Air Guitar emote flag is permanently granted on purchase. Using the cape requires the non-holiday tracks to remain complete; its teleport leads to Falo. Trimming additionally requires every cache-listed music unlock slot, every quest, and every Achievement Diary tier. Holiday status is determined by matching cache track titles against the current OSRS Wiki holiday-track list.

Track unlocks send a message once: "You have unlocked a new music track: <col=ff3045>Name" on a transparent chatbox, `<col=e00a19>` on an opaque one (varbit 4608), with no closing tag or full stop. No jingle is played: live sends only the unlock varp and the message. Across the 988 unlock messages in the rsprox recordings (revs 224-239, e.g. 224/01437), the few ticks that also carry a jingle owe it to something else, such as a League task notification; 234/03275 shows the colour switch when transparency is turned on. Cape requirements include every native slot, whatever unlocks it.

## Quest, minigame and event unlocks

The cache's unlock hints (DB table 44, column 2: "in Varrock.", "during the Dragon Slayer II quest.",
"after completing the While Guthix Sleeps and Dragon Slayer II quests.", "during a Christmas event.")
say where each track plays. Area tracks unlock from `music-data.json` region changes, boss and
minigame tracks from their own plugins' `music:unlock-track` events.

Varlamore's region entries come from the Wiki's own music-track maps (Civitas illa Fortis,
Aldarin, the Avium Savannah, the Auburn Valley, Whispering Wind and the quest/underground
areas), rasterised onto the 64x64 map regions the server selects by. The smallest area covering
a region's centre wins, so the Colosseum (782), the Twilight Temple (809) and the other small
areas keep their own track instead of the surrounding one.

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
