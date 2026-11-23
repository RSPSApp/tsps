# Creature Creation

Creature Creation is the solo activity unlocked by completing Tower of Life. Use two different,
unnoted ingredients on an altar's Symbol of life, or left-click Activate while carrying the
required ingredients to have the altar take them from the inventory. Ingredients stay primed on
the player's save until activation. Each activation creates the corresponding owner-only NPC;
the NPC uses its canonical combat definition and normal drop table. At each altar, one live
creature per player is allowed. The Wiki describes one creation per activation but does not state
whether a player may keep multiple creatures from the same altar alive; there are no matching
rsprox captures, so this implementation keeps the altar primed and blocks another activation
until that player's existing creature dies. A player can still use other altars.

| Altar | Recipe | Guaranteed ingredient drop |
| --- | --- | --- |
| North-east, Newtroost | Eye of newt + feather | 4–10 eye of newt |
| North-west, Unicow | Cowhide + unicorn horn | 2–4 unicorn horns |
| South-west, Swordchick | Raw swordfish + raw chicken | 10–40 feathers |
| South-east, Spidine | Red spiders' eggs + raw sardine | 3–6 red spiders' eggs |
| West, Frogeel | Raw cave eel + giant frog legs | 5–10 raw cave eels |
| East, Jubster | Raw jubbly + raw lobster | 3–7 raw jubbly |

The Ardougne easy diary notes Raw jubbly from Jubsters and Raw cave eel from Frogeels. The medium
diary also notes Eye of newt from Newtroosts, Unicorn horns from Unicows, and Red spiders' eggs
from Spidines. Swordchicks have no ingredient drop to note. The existing drop pipeline supplies
bones and the possible satchel/flask drops as defined by each canonical table.

The plugin attaches hooks during registration, then registers its persistent altar state and
dungeon area during server startup. It removes living owned creatures when the owner leaves the
dungeon, logs out, dies, or the server shuts down; death clears the altar's active-creature guard.
Activation also forgets a creature removed without dying, freeing that altar; creatures still
queued for registration retain their guard until registered or their queued spawn is cancelled.

Sources: [OSRS Wiki: Creature Creation](https://oldschool.runescape.wiki/w/Creature_Creation),
[Symbol of life](https://oldschool.runescape.wiki/w/Symbol_of_life),
[Tower of Life](https://oldschool.runescape.wiki/w/Tower_of_Life), and the checked revision 241
cache loc placements for `Symbol of life` (21893), verified with `yarn dump:loc`:

No matching rsprox submissions were available for the altar loc or creature NPC ids, so the Wiki
supplies activity and drop behaviour while the cache supplies ids and altar placements.

| Altar | Creature | Loc tile |
| --- | --- | --- |
| North-east | Newtroost | 3058, 4410, 0 |
| North-west | Unicow | 3018, 4410, 0 |
| South-west | Swordchick | 3012, 4380, 0 |
| South-east | Spidine | 3066, 4380, 0 |
| West | Frogeel | 3034, 4361, 0 |
| East | Jubster | 3043, 4361, 0 |
