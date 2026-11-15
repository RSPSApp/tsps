# Rotten potato

The Jagex moderators' testing item (Wiki: [Rotten potato](https://oldschool.runescape.wiki/w/Rotten_potato)),
item 5733. `plugins/items/RottenPotato.plugin.js` keeps one unit per option in `plugins/items/rottenpotato/`.

## Who can use it

On live only Jagex moderators can, so here only owners and developers can. Anyone else gets
"Nothing interesting happens." from each option, and a use falls through to the normal reply.

## Menus

Live's options open right-click submenus. This cache (rev 242) gives the potato no `subops`, so the
client has nothing to draw them from. Each option's entries open as a chatbox menu instead. A
list longer than five shows four entries a page, with "More..." to turn the page.

| Option | Entry | Here |
| --- | --- | --- |
| Eat | Set all stats | Asks for a level, then sets every skill in the same tick with one message, "Setting all stats to <level>.", then "... finished cheating." Live sets one skill a tick, each with a `setstat <skill> <level>` line. Sailing, newer than the page, goes before Hitpoints. Hitpoints is at least 10. |
| | Wipe inventory | Deletes everything but the potato. |
| | Setup POH | A random handful of rooms in a random order, furnished as `::maxhouse` furnishes them (`construction:random-house`). `::restorehouse` brings the old house back. |
| | Teleport to player | Asks for a name and moves you to that player. |
| | Spawn aggressive NPC | Asks for an NPC id, spawns it beside you and has it attack you. The Wiki names the entry only. |
| Slice | Anti-macro events | Lists the RandomEvents plugin's events (`random-events:list`) and starts the chosen one on you (`random-events:start`). |
| Peel | Bank menu | Opens the bank. The Wiki names the entry only. |
| | AMEs for all! | The chosen random event on every player who can see you, you included. |
| | Teleport to RARE! | Moves you to the first discontinued holiday rare on the ground anywhere, or beside it when it lies on a table. |
| | Spawn RARE! | Drops a random discontinued holiday rare, seen by everyone, on a random tile up to 5 tiles from you, then opens the Peel menu again so you can spawn the next one. It lands only on open floor you can walk to (never trees, water, walls or fenced-off spots; flowers and other ground decoration count as floor) or on a table you can reach (`plugins/items/rottenpotato/Rares.RottenPotato.js`). |
| Mash | Keep me logged in. | Only says so: this server has no inactivity logout. Live's side effect, where the logout button stops working, isn't copied. |
| | Kick me out. | Logs you out. |
| | Kill me. | Sets hitpoints to 0, and the normal death follows. |
| | Transmogrify me... | Asks for an NPC id, as `::pnpc` does, or turns you back. Object and item forms don't exist here. |

## Uses

- **An item on the potato** deletes the whole stack: "Whee... [Item] All gone!"
- **The potato on the party chest** puts one of each colour partyhat into the Falador Party Room
  chest (`party-room:fill-chest`). No offer is recorded.
- **The potato on a player** lists that player's inventory in chat.

## Not covered

- No capture of the potato exists, so every reply text here except the Wiki's own is ours.
- Live's "pre-defined list" of transmogrifications, its aggressive NPC and its bank menu aren't
  documented, so those entries ask for an id or open the plain bank.
