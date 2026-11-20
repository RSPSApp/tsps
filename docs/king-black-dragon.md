# King Black Dragon

## The way into the lair

The lair is reached through a small poison spider room under the Lava Maze, as the Wiki describes
it ([King Black Dragon Lair](https://oldschool.runescape.wiki/w/King_Black_Dragon_Lair): "The ladder
leads to an area with poison spiders, and a lever which will teleport the player to the King Black
Dragon's lair"; [Lava Maze Dungeon](https://oldschool.runescape.wiki/w/Lava_Maze_Dungeon)):

| Loc | Where | Option | Lands on |
| --- | --- | --- | --- |
| `wildymirrorladdertop1` (18987) | Lava Maze, 3017,3849 | Climb-down | 3069,10255 (spider room) |
| `wildymirrorladder1` (18988) | spider room, 3069,10256 | Climb-up | 3016,3849 (Lava Maze) |
| `dragonkinginlever` (1816) | spider room, 3067,10253 | Pull | 2271,4680 (lair) |
| `dragonkingoutlever` (1817) | lair, 2271,4680 | Pull | 3067,10254 (beside the spider room's lever) |

The landing tiles are the ones the [Shortest Path](https://github.com/Skretzo/shortest-path) plugin's
transports record for these locs (`server/plugins/agent/data/transports.json`). The rsprox capture
database has no recording of 1816, 1817 or 18988 (searched 2026-11-20). The ladders climb as every
ladder does (`ladders:climbDown`/`ladders:climbUp`). Both levers teleport through `lever:teleport`,
the standard teleport cast, which a video of the route shows
([YouTube](https://www.youtube.com/watch?v=qyq6mFpM91Q)). It shows no chat lines, so the levers send
none. As with every Wilderness lever, a teleblocked player cannot pull the spider room's lever
(Wiki); the teleport's own checks refuse it.

The easy Wilderness Diary's "Enter the King Black Dragon's lair." is credited when the spider room's
lever lands the player in the lair, not on the ladder.

Not implemented: the spider room lever's Commune option (how many players are in the lair) and its
Private option (a private lair for 50,000 coins, Wiki).

## The Leagues VI Echo placeholder

A league character carrying the echo orb is asked at the spider room's lever, the lair's own
entrance; "No." pulls it as without the orb. "Yes." pulls it too, with the same teleport, and the
private lair is made when the teleport lands (should that fail, the player is put back beside the
lever). Its Echo branch spawns the normal King Black Dragon in an isolated private lair, with the
same `KingBlackDragonCombatMethod`. EchoBosses gives that
instance the Wiki Echo profile (840 HP, Attack/Strength/Defence 300, Magic 252, four-tick attacks)
and the cache's Echo model, name and level (its leagues_echo_bosses row). Normal definitions are not
modified ([echo-bosses.md](echo-bosses.md)).

The normal melee/dragonfire selection, 65/50 unprotected breath tables, antifire
tiers, ice/poison/shock effects and protection messages are retained intentionally.
The Wiki omits an Echo breath maximum applicable to these reused attacks; no new
cap is invented. Echo-specific mechanics are not implemented (docs/echo-bosses.md).

Its normal loot drops as from a normal kill; completion emits one Echo event for the
Echo equipment roll and progression.
No normal KC/achievement callback is added here. The lair does not respawn another
boss in the same encounter. Leaving, death, logout and shutdown destroy the private
actors and clear pending damage. Disconnected players recover beside the spider room's lever.

Source: [Echo King Black Dragon](https://oldschool.runescape.wiki/w/King_Black_Dragon_(Echo)).
