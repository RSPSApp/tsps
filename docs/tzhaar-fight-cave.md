# TzHaar Fight Cave

`server/plugins/minigames/TzhaarFightCaves.plugin.js` runs the cave; its Elite Karamja Diary
resurrection is `tzhaar/Resurrection.TzhaarFightCaves.js`. Rules come from the OSRS Wiki
(<https://oldschool.runescape.wiki/w/TzHaar_Fight_Cave>, <https://oldschool.runescape.wiki/w/Karamja_Diary>,
<https://oldschool.runescape.wiki/w/TzTok-Jad>). The recordings predate the sections on entering and the
diary (rev 235), which are Wiki only.

## Monsters

- **Waves** are the Wiki's list. Wave 31 is one Ket-Zek and wave 32 one Ket-Zek and a Tz-Kih, as all 5 runs in
  recording 551 show.
- **They keep the player.** A monster that can't get to the player stands still and walks on when it can, in
  recording 551: a Tz-Kih stood 20 ticks at 2384,5095 with the player at 2384,5075, unclicked. It's the
  `combat:keep-target` flag. The Wiki has no rule for this.
- **Yt-HurKot heal Jad only while beside him and not fighting.** All 21 heals in recordings 83 and 551 came with a
  healer beside him facing him, none from one facing the player, over 29 healer-ticks of a healer facing the player
  within 5 tiles of Jad. One run shows those 29, with the healers moving. The Wiki reads otherwise, "They can still
  heal if within the trigger range and in combat with the player"; this goes with the recordings.
- **A healer lets go** of a player 10 or more tiles off, 9 or more ticks after it was last hit, and goes back to Jad.
  Wiki: "If the player is too far from the Yt-HurKot after attacking them, they will quickly lose aggression and
  re-target Jad". Both numbers are ours, from two recorded cases at 10 and 12 tiles, 9 and 10 ticks after the hit.
- **Not built:** healers healing each other. In recording 83 a healer facing the player heals another healer, not Jad.

## Entering and leaving

- There is no wait before going back in. The Wiki's 12 August 2026 entry (Update: Summer Sweep Up -
  Agility & Chambers of Xeric Changes): "You can now re-enter the Fight Caves immediately after
  leaving, with no cooldown." Recording 3889 (rev 235) shows the wait this replaces ("you were in
  cave only a moment ago. You wait a minute or so before going in again.").
- Leaving a run in any way clears a TzTok-Jad Slayer task, with the message "You no longer have a
  slayer task as you left the fight cave." and without resetting the streak (Wiki: TzTok-Jad,
  Slayer; TzHaar Fight Cave, 13 August 2015). The cave sends `slayer:leave-task-area`, which
  `Tasks.Slayer.js` answers.
- The TzRek-Jad pet is 1/100 from a Jad killed on a Slayer task, 1/200 otherwise (Wiki: TzTok-Jad,
  drops). The cave answers `npc-drops:tertiary-chance` by asking `slayer:on-task`.

## Elite Karamja Diary

- **Double TokKul** from the Fight Cave, the Inferno and TzHaar-Ket-Rak's Challenges. Each pays
  through `diary:tokkul { player, amount }`, which `AchievementDiaries.plugin.js` doubles once the
  Karamja elite tier is complete. The amount is doubled wherever it is paid: a finished run, a run
  ended early or lost, and a challenge's partial reward. The text of the Ket-Rak and Inferno lines
  shows the amount actually paid; the Wiki does not say whether live shows the base or the doubled
  figure there.
- **Resurrection.** Once a day (UTC), on reaching 0 hitpoints in the cave, a player who has the
  elite tier carries on with full hitpoints and all stats restored instead of dying. The Wiki's
  5 March 2015 changelog entry adds "if you already own a fire cape"; the current Death and Karamja
  Diary text name only the diary, so no fire cape is required here. Pending hits and poison are
  dropped. The day is saved per player (`tzhaar:fight-cave-resurrected-on`). No message or
  animation is recorded for it, so none is sent.

## Not covered

- The fire cape exchange's extra 1/200 pet roll at TzHaar-Mej-Jal.
- Leaving the cave by a teleport or command does not clear a Jad task (only the exit, a death and
  finishing do).
- The diary journal does not show whether the day's resurrection is used (the Wiki mentions it).
- Hardcore Group Ironman life loss on a death that the resurrection avoids.
