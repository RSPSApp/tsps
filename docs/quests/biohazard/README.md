---
quest: Biohazard
key: biohazard
status: in-progress
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Biohazard

Native attempt stopped at stage 1 and logged out; no completion.

## Findings

- **fixed** Mourners inside the headquarters, outside while wearing the medical gown, and the sickest mourner upstairs (9008) used the wrong transcripts; the sickest mourner's attack actions start the fight. The back door (2036 at 2551, 3328) stays locked from both sides with its transcript, and the trapdoor (8783 at 2542, 3327) is refused only during Biohazard, so Mourning's End Part I keeps it. Ardougne castle's main staircase (15645/15648 at 2571, 3295) arrives on walkable landings both ways. [Quick guide](https://oldschool.runescape.wiki/w/Biohazard/Quick_guide). Fixed in #3796.
- **fixed** Issue [#3976](https://github.com/RSPSApp/tsps/issues/3976) (a Biohazard playthrough). No rsprox capture covers Biohazard (rsprox.net index and the user's own recordings searched for its locs, NPCs and messages), so the fixes below rest on the cache, the [Wiki](https://oldschool.runescape.wiki/w/Transcript:Biohazard), captures of same-family locs and LostCity Content's 2004 `quest_biohazard.rs2` (a reference, not OSRS):
  - Rope ladder: Omart drops the player on 2556,3267 and Kilron on 2559,3267, the tiles beside the wall (bioladderwall 2066 at 2557/2558,3267). The Wiki's Kilron map and LostCity's `biohazard_climb_ladder` destinations agree; the old landing 2554,3266 was two tiles west.
  - Pigeon cage: three `biopigeon_launch` (spotanim 72) projectiles from the player to 2559,3303 / 2560,3304 / 2561,3305, delays 25/15/5, heights 16 to 130, flight length 21/31/41 plus 20 cycles a tile (LostCity; no OSRS capture).
  - Fence `mournerstewfence` (2068 at 2541,3331, east edge): a forced walk (human_walk_f, 76 cycles) between 2541 and 2542, as captured fence squeezes do (rsprox recording 362 ticks 2794/2962: teleport to the start tile and exactmove in the same tick, delay2 76). It used to teleport the player, two tiles from inside.
  - Doors `mournerstewdoor` (2036, front 2551,3320) and `mournerstewdoorup` (2034, 2547,3325 upstairs) are pass-through doors with actionless `...open` leaves (2037/2035): same models and naming as `wydindoor`, whose rsprox capture (recording 465 ticks 6468, 7182) shows INVISWALL on the door tile, the open leaf on the tile past the blocked edge turned a quarter, sound 62, shut two ticks later. Doors.plugin had no open pair for them, so both stayed shut.
  - Cage gate `mournerquaters_gatel/_gater` (2058/2060 at 2551,3326/3325 upstairs): pass-through with open leaves 2059/2061, modelled on the captured Mort Myre two-leaf gate (Ours: no capture of this gate). Open with the key, or the key used on it, shows the imported "You use the key to open the gate." (KKqqBk); leaving the cage needs no key.
  - Teleporting with the plague sample and vials does not break them: the [Wiki](https://oldschool.runescape.wiki/w/Biohazard#Changes) records that change on 25 July 2019, so nothing was added.
  - Ardougne Castle's main staircase (15645/15648 at 2571,3295): Song of the Elves claimed it for everyone, from any tile, with landings 2575,3293 on both floors. It now uses the shared climb-links pair (used from 2571,3298, landing on 2571,3294 upstairs, matching the RuneLite Shortest Path transports).
  - The staircase beside it (35791 `ardougne_prison_entry` at 2569,3295, 2x3, so it covers 2570,3297) is a cache placement, Song of the Elves' "go downstairs" prison entrance; it stays.
- **open** #3976 also reports that "Do you know where to find the Mourner Headquarters?" takes too much room. The text is the Wiki transcript's: Kilron's second menu option (`infiltrating-the-mourner-hq-talking-to-kilron`) and the player's line "Thanks Kilron. Do you know where to find the Mourner Headquarters?" after Omart's crossing (`getting-started-talking-to-omart-after-freeing-the-birds`), both from npc-dialogues.json. Neither is over-long for its interface on paper; needs an in-game look before any change.
- **open** A courier who disposed of the wrong vial could not get a replacement; repair in progress.
- **open** Premature Guidor advancement was returned to the owner.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q007); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Result:** stage 1 (varp 68).
- **Not checked:** No reward/QP/XP proof; Later source fixes do not validate the old run.
- **PRs:** [#1098](https://github.com/RSPSApp/tsps/pull/1098).
