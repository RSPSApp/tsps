# King Black Dragon and the Leagues VI Echo placeholder

The Lava Maze ladder's orb prompt keeps ordinary entry unchanged. Its Echo branch
spawns the normal King Black Dragon in an isolated private lair, with the same
`KingBlackDragonCombatMethod`. EchoBosses gives that instance the Wiki Echo profile
(840 HP, Attack/Strength/Defence 300, Magic 252, four-tick attacks) and the cache's Echo
model, name and level (its leagues_echo_bosses row). Normal definitions are not modified
([echo-bosses.md](echo-bosses.md)).

The normal melee/dragonfire selection, 65/50 unprotected breath tables, antifire
tiers, ice/poison/shock effects and protection messages are retained intentionally.
The Wiki omits an Echo breath maximum applicable to these reused attacks; no new
cap is invented. Echo-specific mechanics are not implemented (docs/echo-bosses.md).

Its normal loot drops as from a normal kill; completion emits one Echo event for the
Echo equipment roll and progression.
No normal KC/achievement callback is added here. The lair does not respawn another
boss in the same encounter. Leaving, death, logout and shutdown destroy the private
actors and clear pending damage. Disconnected players recover outside the ladder.

Source: [Echo King Black Dragon](https://oldschool.runescape.wiki/w/King_Black_Dragon_(Echo)).
