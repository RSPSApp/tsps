# Amoxliatl

Amoxliatl (https://oldschool.runescape.wiki/w/Amoxliatl), the post-quest boss beneath the Ruins of Tapoyauik, solo, built from rsprox captures (https://rsprox.net/database, recordings 1140, 1147 and 1695), the OSRS Wiki (Amoxliatl, Amoxliatl/Strategies) and the cache. It is one plugin, `server/plugins/bosses/Amoxliatl.plugin.js`, with one unit per part in `server/plugins/bosses/amoxliatl/` and its data in `plugins/bosses/data/amoxliatl.json`.

Recordings 1140 and 1147 are from Leagues VI worlds (rev 237). R1147 gives the way in and out and the kill. The ordinary post-quest encounter in R1140 supplies the special attack messages, shatter sequence and respawn interval. Recording 1695 (rev 226, a main world) shows the quest variant (`amoxliatl_quest`, 400 hitpoints); R1140 has the same quest fight (ticks 7540-7700) before its 40 post-quest kills (7839-12675), and then Echo kills (12960 on). [R1140](https://rsprox.net/download/1140) · [R1147](https://rsprox.net/download/1147) · [R1695](https://rsprox.net/download/1695)

The Heart of Darkness's fight is in her chamber too, started by the quest plugin (`amoxliatl:quest-fight`); see [The quest's fight](#the-quests-fight). Outside her chamber she makes only her plain attack (11530 and the magic hit), with none of the chamber's mechanics.

## Layout

| File | What it owns |
| --- | --- |
| `Common.Amoxliatl.js` | The data, the saved attributes, the captured fade, sounds and map animations. |
| `Chamber.Amoxliatl.js` | Her chamber: the instance, the door in, the ice blockages out, logging out inside, her (re)spawning. |
| `Fight.Amoxliatl.js` | A fight: her rising, the attack slot, standard attacks, spikes, icy pools, Icicle Crash, the HUD. |
| `UnstableIce.Amoxliatl.js` | Unstable Ice: the throws, the blocks, melee on them, shattering. |
| `Kills.Amoxliatl.js` | The kill: the pools going, the kill count and fight duration, the loot, her respawn. |
| `CombatAchievements.Amoxliatl.js` | Her kill count for Combat Achievements and the fight's own tasks. |
| `Commands.Amoxliatl.js` | Developer commands for testing. |

## The way in

Once The Heart of Darkness is done, the door west of the frost nagua (`vmq3_ruins_door_multi`, 55355 at 1601,9630) is "Door", Pass-through: the cache turns it with varbit 11117, the quest's stage. Before then it is the Frozen door and the quest handles it. As captured, from the click:

| Tick | What |
| --- | --- |
| 0 | Busy, the fade out (script 948), the HP HUD emptied |
| 1 | The minimap off |
| 2 | Map square 5446 (8x8 chunks, plane 0, unturned) copied into the instance; the player at 1376,4511 facing west; the three ice blockages (54282) added at 1377,4510-4512; the track The Guardian of Tapoyauik (807) |
| 4 | The minimap on, not busy, the fade back in; the multiway indicator on |
| 6 | The fade overlay closed |
| 7 | She rises at 1362,4510 facing east (11527), "Euat! You are not welcome here!" overhead and in the chatbox (`npc_say`), and the boss HUD comes up in her colours (3204, 11761, 21407) |

The blockages: Exit asks "Are you sure you want to exit?" (Yes./No.); Quick-exit doesn't. Out is the same fade, landing at 1602,9631. Leaving any way (the blockages, a teleport, death, logging out) ends the chamber; a player who logs out inside, or is saved there, logs back in outside the door.

A death in the chamber ends it like any other way out, and its grave (the Gravestones plugin) is outside the door, at 1602,9631 (Wiki: "a grave outside the instance").

## The fight

She attacks 4 ticks after rising, then every 8 ticks (both captures), following the player to melee distance: the Wiki's "drag" works because she walks after the player before she can attack again. The shared NPC status data gives both forms (13685 and 13686) 100% freeze resistance. [Wiki revision 15401516](https://oldschool.runescape.wiki/w/Special:PermanentLink/15401516)

### Standard attack

`amoxliatl_attack` (11530) and a magic hit of up to 22 on the same tick (captured: the player's block on that tick); Protect from Magic blocks it. The ice spikes (map animation 2942) are drawn on the floor around the player as captured: of the tiles within 6 of the player, their own about 3 in 4, the next ring about 2 in 3, the rest about 1 in 4 (counted over 13 attacks, 18-50 tiles each). Each is one 150-cycle animation (seq 11543): a short warning, then the spike rising through ticks 2-3. 3 ticks after the attack they hit a player who was still on one of their tiles the tick before: typeless 6-16 (R1140: 92 spike hits from 6 to 16, none with the pools' sound; R1147 ticks 352 and 360: 10 and 6). Every player who had stepped off by then took nothing (the other 11 attacks), the Wiki's "step back two tiles after she starts a standard attack".

3 ticks after the attack an icy pool (54279, a random rotation) forms on the tile the player stood on when she attacked (captured), with sound 9726 from the middle of the platform (always 1365,4511, both captures). Standing on a pool deals 6-10 typeless damage a tick (Wiki; R1140's pool hits are all 6-10), each hit with sound 4464 (R1140). Pools stay until she dies: on the killing blow each one goes with a puff (map animation 2938, captured).

### Specials

After every 2-4 standard attacks (Wiki) she uses a special: the first at random, then in turn (both captures: four standard attacks, a special, three, the other). With the player on the 3-wide path to her platform (x 1372 and east) she has no room for Unstable Ice and uses Icicle Crash (Wiki). Her next attack comes 9 ticks after Icicle Crash and 7 after Unstable Ice, not her usual 8 (R1140: 38 of 38 and 40 of 40; R1695 ticks 4871-4880 and 4905-4912).

**Icicle Crash** clears active prayers before sending the game message "`<col=ff3045>Amoxliatl disables your prayers and launches an icicle attack!</col>`" (R1140 tick 7875). With no prayer active, it leaves prayer state alone and sends "`<col=ff3045>Amoxliatl launches an icicle attack!</col>`" (ticks 9718 and 9783). The message is followed by `amoxliatl_point` (11531) and an icicle (projectile 2936, cycles 50-150, heights 448 to 0) homing on the player. 5 ticks later it lands (spot 2935, sound 9720) for up to 34 magic damage; Protect from Magic on by then negates it (Wiki).

**Unstable Ice** uses `amoxliatl_summon` (11533), "`<col=00e6e6>Amoxliatl forms some unstable ice blocks around you.`" (spam, R1140 tick 7909), and a throw (projectile 2936, cycles 50-90) at each block's tile with the impact drawn there on landing. 3 ticks later the blocks (13688, "Unstable ice") stand there (11536, sound 9713). The Wiki gives 1-4 blocks near the player; they land on free floor within 5 tiles, never on the player, her or the path (R1140: 117 blocks, 9 of them 5 tiles from the player).

- Only melee hurts them, and a melee hit on one is a max hit that ignores the weapon's delay and leaves one of a tick (Wiki). They have 10 hitpoints (cache), so every hit breaks one: as captured, the hit shows 10, it bursts (11035, sound 9721), and a tick later it is gone with an icy pool on its tile.
- 2 ticks before blocks still standing would shatter she winds up (`11534`; R1140 ticks 7924, 8800 and 12433, every shatter it shows).
- Blocks still standing 14 ticks after forming burst (11035, sound 9721) and show one heal hitsplat of 16–25 per block. On that tick, icy pools fill the available platform tiles in the 3×3 square centred on each bursting block, following the Wiki, with one pool sound (9726) from the centre. The blocks disappear one tick after bursting. The Leagues VI recording R1140 shows a wider, platform-clipped diamond with a Manhattan radius of two. It added 28 pools at tick 7926 and 25 at tick 8802 after accounting for existing pools. [Wiki revision 15399415](https://oldschool.runescape.wiki/w/Special:PermanentLink/15399415)

### The kill

As captured: her death (11532) and the pools going on the killing blow; 2 ticks later (`deathTicks`) "Your Amoxliatl kill count is: N." (varp 4403), "Fight duration: m:ss.cc" (timed from her rising, so the capture's 0:24.00 kill was 40 ticks), and the loot on her middle tile. The HUD fades 4 ticks after that. While the player stays, she rises at (1362, 4510), facing east with animation 11527, 28 ticks after the kill count and 30 ticks after the death animation (R1140, kill-to-rise intervals 7945–7973 and 8058–8086).

Loot (NpcDrops, the Wiki's table): two rolls on her table and one frozen tear roll per kill (Wiki), the tears one roll of 10 (2-4 at 6, 5-10 at 3, 10-20 at 1) rather than the three separate rolls the export lists.

### Combat Achievements

Counted by event (`combat-achievements/data/monsters.json`), so the kill count and the fight duration come before any task, as captured. The plugin judges:

| Task | Rule |
| --- | --- |
| Temotli Triumph | Every hit of the player's in the chamber with the glacial temotli. |
| Amoxliatl Speed-Trialist, Speed-Chaser | A fight duration under 100 and 50 ticks. |
| Nagua Negation | No damage taken in the fight. |
| Kemo Makti | 10 kills without leaving the chamber. |
| Totally Shattered | No unstable ice shattered in the fight. |
| Without Ralos' Light | No prayer points lost in the fight. |

## The scoreboard

The Ancient tablet by her door (`amoxliatl_scoreboard` 52693, shown as `amoxliatl_scoreboard_op`
54277 "Ancient tablet": Read once The Heart of Darkness is done) opens interface
`amoxliatl_scoreboard` (878): the reader's kill count, deaths and best time, then the world's
(Wiki, Ancient tablet (Amoxliatl); the labels and the "Amoxliatl Statistics" title are the
cache's). The personal kill count and best time are the kill messages' own; a death in her chamber
counts, the quest's fight doesn't. The world's numbers are kept in
`data/saves/amoxliatl-scoreboard.json`. No recording reads it, so the number and time formats
follow the Araxxor board's recording; a missing time is the cache's default "-". Deaths are heard
through onPlayerDefeated, which every death reaches (onPlayerDeath stops at Death's Office's first
grave).

## Data fixes

- `npc-combat-defs.json`: her death 11532 and no block or attack animation (the plugin plays her attacks), the blocks with none, so the human ones never play on them.
- `monsters-complete.json`: immune to poison and venom (Wiki).
- `PacketSender.sendTypedMessage(chatType, text, from)` with `api.core.ChatType` (`SPAM` 105, `NPC_SAY` 116): game messages on the chatbox's other channels, which `sendMessage` (type 0) can't reach.

## Estimates

- Known respawn dialogue difference: R1140 shows three alternate lines on respawn (examples at ticks 7973, 8086 and 8715). TSPS uses the entrance line again on respawn.
- The spike spread models the captured tiles. Spike damage is the range R1140 shows (6-16); the Wiki gives none.
- Where the blocks land within 5 tiles (R1140: 1-5 tiles from the player, most at 2-3).
- The capture's Exit prompt opened with the player a few tiles from the blockage; here the player walks up to it first.
- The multiway indicator comes on with the move in (tick 2), not with the fade back (tick 4).

## The quest's fight

As captured twice (R1695 ticks 4831-4934, R1140 ticks 7605-7693): the same fade into her chamber, the player at 1371,4511, her track (807) unlocked and played with the move in. The guardian (`amoxliatl_quest`, 13686) is there 2 ticks later as the fade comes back, with no rise and no line, and attacks 4 ticks after that; the fight is hers in every other way, with the quest's colours on the special messages.

She doesn't die. At 0 HP (`questEnd` in `Kills.Amoxliatl.js`) she becomes `amoxliatl_quest_inactive` (13687), plays 11531 with "Zema ami miki!" overhead and as `npc_say`, her pools go with a puff, and she throws one last icicle (2936, cycles 50-90, heights 112 to 25) at the player. 3 ticks later the player teleports (4018, spot 2754) as she plays her death (11532), sound 7928 a tick after; 6 ticks after the 0 HP the player is at 1615,3211, and a tick later the quest's "Amoxliatl banishes you from Tapoyauik." No loot, kill count or best time.

## Not in yet

- The Echo's own mechanics (see below), though R1140 captures them.

## Testing

From `server/` after `yarn build` and `yarn ensure-cache`, run `node --test tests/amoxliatl.test.cjs tests/amoxliatl-scoreboard.test.cjs tests/freeze-resistance.test.cjs`.

Developer commands: `::amoxliatl` (outside her door), `::amoxliatlhp <hitpoints>`, `::amoxliatlspecial <icicle|ice>` (her next attack). `::quest heart of darkness complete` opens the door.
# Leagues VI Echo placeholder

The Echo orb's Yes branch creates a separate private chamber with the normal
Amoxliatl and her normal fight controller. EchoBosses gives that instance the Wiki
Echo profile (650 HP, Magic 240, maximum magic hit 93, eight-tick attacks) and the cache's
Echo model (her leagues_echo_bosses row). Normal and quest Amoxliatl definitions remain
unchanged ([echo-bosses.md](echo-bosses.md)). The normal spikes, icy pools, alternating
Icicle Crash/Unstable Ice, movement and protection logic remain in use. Their
normal hazard and special-hit values are intentional placeholders: this is not
an implementation of Echo-specific mechanics.

The central Echo service validates VI/orb ownership and owns the encounter identity.
Her normal loot drops as from a normal kill, and the service adds the Echo unique roll once. A completed Echo does not
respawn, award ordinary Amoxliatl kill count/personal bests, or judge normal Combat
Achievements. Departure, death, logout and shutdown cancel the fight and pending
damage. Delayed entry and spawning revalidate the session and carried orb.

Source: [Echo Amoxliatl](https://oldschool.runescape.wiki/w/Amoxliatl_(Echo)).
