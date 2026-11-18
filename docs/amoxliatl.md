# Amoxliatl

Amoxliatl (https://oldschool.runescape.wiki/w/Amoxliatl), the post-quest boss beneath the Ruins of Tapoyauik, solo, built from rsprox captures (https://rsprox.net/database, recordings 1147 and 1695), the OSRS Wiki (Amoxliatl, Amoxliatl/Strategies) and the cache. It is one plugin, `server/plugins/bosses/Amoxliatl.plugin.js`, with one unit per part in `server/plugins/bosses/amoxliatl/` and its data in `plugins/bosses/data/amoxliatl.json`.

Recording 1147 is a post-quest kill on a Leagues VI world (rev 237): it gives the way in and out, her timing and the kill, but its damage is the Leagues'. Recording 1695 (rev 226, a main world) is the quest's fight (`amoxliatl_quest`, 400 hitpoints), with the same attacks, and the only capture of Unstable Ice. The Heart of Darkness's own fight stays the quest plugin's, at the frozen door; outside her chamber she makes only her plain attack (11530 and the magic hit), with none of the chamber's mechanics.

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

She attacks 4 ticks after rising, then every 8 ticks (both captures), following the player to melee distance: the Wiki's "drag" works because she walks after the player before she can attack again.

### Standard attack

`amoxliatl_attack` (11530) and a magic hit of up to 22 on the same tick (captured: the player's block on that tick); Protect from Magic blocks it. The ice spikes (map animation 2942) are drawn on the floor around the player as captured: of the tiles within 6 of the player, their own about 3 in 4, the next ring about 2 in 3, the rest about 1 in 4 (counted over 13 attacks, 18-50 tiles each). Each is one 150-cycle animation (seq 11543): a short warning, then the spike rising through ticks 2-3. 3 ticks after the attack they hit a player who was still on one of their tiles the tick before: typeless 10 and 6 in the two captured cases (1147, ticks 352 and 360), 6-10 here as the Wiki gives the pools. Every player who had stepped off by then took nothing (the other 11 attacks), the Wiki's "step back two tiles after she starts a standard attack".

3 ticks after the attack an icy pool (54279, a random rotation) forms on the tile the player stood on when she attacked (captured), with sound 9726 from the middle of the platform (always 1365,4511, both captures). Standing on a pool deals 6-10 typeless damage a tick (Wiki). Pools stay until she dies: on the killing blow each one goes with a puff (map animation 2938, captured).

### Specials

After every 2-4 standard attacks (Wiki) she uses a special: the first at random, then in turn (both captures: four standard attacks, a special, three, the other). With the player on the 3-wide path to her platform (x 1372 and east) she has no room for Unstable Ice and uses Icicle Crash (Wiki).

**Icicle Crash** (captured): every prayer off with "`<col=ff3045>Amoxliatl disables your prayers and launches an icicle attack!</col>`", `amoxliatl_point` (11531), and an icicle (projectile 2936, cycles 50-150, heights 448 to 0) homing on the player. 5 ticks later it lands (spot 2935, sound 9720) for up to 34 magic damage; Protect from Magic on by then negates it (Wiki).

**Unstable Ice** (captured, recording 1695): `amoxliatl_summon` (11533), "`<col=00ffff>Amoxliatl forms some unstable ice blocks around you.`" (spam), and a throw (projectile 2936, cycles 50-90) at each block's tile with the impact drawn there on landing. 3 ticks later the blocks (13688, "Unstable ice") stand there (11536, sound 9713). The Wiki gives 1-4 blocks near the player; they land on free floor within 4 tiles, never on the player, her or the path.

- Only melee hurts them, and a melee hit on one is a max hit that ignores the weapon's delay and leaves one of a tick (Wiki). They have 10 hitpoints (cache), so every hit breaks one: as captured, the hit shows 10, it bursts (11035, sound 9721), and a tick later it is gone with an icy pool on its tile.
- Any left 15 ticks after forming shatter (Wiki): each bursts, heals her 16-25, and leaves icy pools in the 3x3 around it. No capture shows a shatter.

### The kill

As captured: her death (11532) and the pools going on the killing blow; 2 ticks later (`deathTicks`) "Your Amoxliatl kill count is: N." (varp 4403), "Fight duration: m:ss.cc" (timed from her rising, so the capture's 0:24.00 kill was 40 ticks), and the loot on her middle tile. The HUD fades 4 ticks after that. She rises again 29 ticks later (Wiki: respawn) for as long as the player stays.

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

- Her respawn shows the same rise and line as the first spawn; no capture has a respawn.
- The spikes' spread is our model of the captured tiles, not a known rule; their damage range (6-10) is the pools' from the Wiki, the captures showing 10 and 6.
- The shatter (Wiki only, as above) and its 15 ticks counted from the blocks forming.
- Where the blocks land within 4 tiles (the capture: 2-4 tiles from the player).
- The capture's Exit prompt opened with the player a few tiles from the blockage; here the player walks up to it first.
- The multiway indicator comes on with the move in (tick 2), not with the fade back (tick 4).

## Not in yet

- Freeze immunity (Wiki: immune to freezes).
- The quest's fight in her chamber (`amoxliatl_quest`, her `amoxliatl_quest_inactive` turn and the banishment): the quest plugin keeps its own.

## Testing

`node --test tests/amoxliatl.test.cjs tests/amoxliatl-scoreboard.test.cjs`

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
