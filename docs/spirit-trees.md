# Spirit trees and Magic Mushtrees

Two travel networks where an interface picks the destination, played as live OSRS does them (the [rsprox capture database](https://rsprox.net/database), rev 224–238), with requirements from the OSRS Wiki.

## Spirit trees

`server/plugins/world/SpiritTrees.plugin.js`, with the trees in `server/plugins/world/data/spirit-trees.json`.

**Travel** on a spirit tree opens the menu interface (187) in the main modal:
- **The packets:** `toplevel_mainmodal_open`, then the menu script (217) with "Spirit Tree Locations" and the trees joined by `|`, ending with Cancel, then pause-button events on 187:3, slots 0–127.
- **Order:** the trees come in the game's order: Tree Gnome Village, Gnome Stronghold, Battlefield of Khazard, Grand Exchange, Feldip Hills, Prifddinas, Port Sarim, Etceteria, Brimhaven, Hosidius, Farming Guild, Your house, Poison Waste, Laguna Aurorae.
- **Greyed** (`<col=5f5f5f>`): trees the player can't travel to now. That's a farming patch without a grown, checked spirit tree; a missing requirement; and the house, which has no spirit tree on this server.

Closing the menu, or choosing from it, runs `chatdefault_restoreinput` (2158), as the game does; without it the chatbox can't be typed in afterwards. The Magic Mushtrees' interface does the same.

**Choosing a tree** (the slot comes back as the pause button's sub):
1. **At once:** the menu closes, "You place your hands on the dry tough bark of the spirit tree, and feel a surge of energy run through your veins." appears in an objectbox without a button, and the player reaches for the tree (animation 828).
2. **Two ticks later:** they stand by the other tree, and the box closes.

**The tree speaks** (with its chathead) instead when:
- the choice is greyed: "You cannot travel to that land at this time.";
- it's the tree the player is at: "You're already here.".

**Talk-to:** the tree says "Hello gnome friend. Where would you like to go?" (captured), then the menu opens.

**Which version of a tree shows** (the cache picks it from the player's quest progress; only the Travel version has Travel):
- **Tree Gnome Village's tree:** `bolren_got_orbs` (varbit 598) at 2. Tree Gnome Village now sends it: 1 once the first orb is back, 2 once complete, on login and whenever its stage changes (QuestRuntime's `quest:stage-changed`).
- **The Grand Exchange, Battlefield, Feldip Hills, Prifddinas and Laguna Aurorae trees:** Tree Gnome Village's varp (111) at 9.
- **The Gnome Stronghold's tree:** The Grand Tree's varp (150) at 160.
- **The Poison Waste tree:** The Path of Glouphrie's varbit (15288), which this server doesn't have, so it shows Talk-to only. Talk-to still opens the menu. It's named "Spirit Tree", like the farming patches, and is taken only at its own tile.

**Last-destination** goes straight to the last tree travelled to. The first time, the tree says "This once, you will have to tell me where you wish to go, for I do not yet know where to take you back." and the menu opens.

**Landing tiles:**
- **Captured** for Tree Gnome Village, the Gnome Stronghold, the Battlefield, the Grand Exchange, Feldip Hills, Prifddinas and Port Sarim.
- **Not captured:** Poison Waste and Laguna Aurorae land beside the tree, on a walkable tile. The other grown trees land beside their patch, as Farming placed them before.

**Requirements** (Wiki):
- **The network:** Tree Gnome Village.
- **Leaving the Gnome Stronghold's tree:** The Grand Tree.
- **Prifddinas:** Song of the Elves.
- **Poison Waste:** The Path of Glouphrie.
- **Laguna Aurorae:** Pandemonium, 58 Sailing and having moored there at least once.
- **The Farming Guild:** 85 Farming.

Legacy saves without mooring history do not prove a previous moor, even when their last dock is Laguna Aurorae. Those players need to moor again; boarding or recovering a boat does not establish the visit.

Quests this server doesn't have don't block, as elsewhere. Quest varps are sent again on login (QuestRuntime), or after a relog the client would show the trees without Travel.

**Player-grown trees:**
- **Travel on a grown tree:** Farming opens the same menu (`spirit-trees:open`).
- **Which trees are grown:** SpiritTrees asks Farming (`spirit-trees:grown`) for the spirit tree patches the player has grown and checked.

Before this, the plugin listened for "Spirit Tree", the farming patch's name. The permanent trees are named "Spirit tree", so their Travel did nothing, and the network was a chatbox list.

**Not done:**
- the house's tree.

## Magic Mushtrees

Fossil Island's Mycelium Transportation System: `server/plugins/world/MagicMushtrees.plugin.js`, with the four trees in `server/plugins/world/data/magic-mushtrees.json`.

**Use** opens `fossil_mushtrees` (608) in the main modal, with the four names written in: "<col=8f8f8f>1.</col> House on the Hill", "2. Verdant Valley", "3. Sticky Swamp", "4. Mushroom Meadow". Its buttons (608:4, 8, 12, 16) come back as pause buttons.

**Choosing one**, from the click:

| Tick | What happens |
| ---: | --- |
| 0 | The player crawls in (animation 844, sound 2266), the screen fades out, the interface closes. |
| 3 | They come out of that mushtree. |
| 4 | The screen fades back in. |
| 6 | The fade overlay closes. |

Choosing the tree the player is at: "You are already at that Magic Mushtree."

**Destinations** (captured):

| Tree | Lands at |
| --- | --- |
| House on the Hill | (3764, 3879, 1) |
| Verdant Valley | (3760, 3758) |
| Sticky Swamp | (3676, 3755) |
| Mushroom Meadow | (3676, 3871) |

**Not done:** discovering the trees by walking to them first (Wiki). The captures only have players who had all four, so what an undiscovered tree shows isn't known.
