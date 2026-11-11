# Item submenus

Some inventory options open a submenu: Xeric's talisman's Rub lists its five destinations,
Kharedst's memoirs and the Book of the Dead list their five pages under Reminisce, and Drakan's
medallion lists its four under Teleport. Picking an entry goes straight there; the bare option
still asks where.

## How a click arrives

- The cache holds the entries as the item's `subops`, one list per inventory option. Worn
  submenus are item params instead: the first entry at 661 + op, later ones at 2066 + op + 8n.
- The client sends `IF_SUBOP` with the entry's 0-based index. `ClientProtocol` adds one, so a
  plugin sees `event.subOpId` 1-based.
- `PluginManager.emitItemAction` resolves the label and sets `event.subOption` ("Xeric's
  Glade"), for every item, inventory or worn. Plugins match on it.

## From rsprox captures

- **Xeric's talisman:** Rub > entry teleports at once, with no menu and no message: rec 726
  (rev 231) subop 2 landed at Xeric's Inferno, rec 3942 (rev 236) subop 4 at Xeric's Honour. The
  Xeric animation and spotanim start on the click; the move is 3 ticks later.
- **Book of the Dead:** Reminisce > entry teleports to that page's city: rec 363 (rev 231) subops
  1-4 to Piscarilius, Shayzien, Lovakengj and Arceuus; rec 3150 (rev 232) subop 0 to Hosidius.
- **Drakan's medallion:** Teleport > entry teleports there: rec 4266 and 4288 (rev 239) subop 0
  to Ver Sinhaza (3649, 3230), rec 4288 subop 1 to Darkmeyer (3592, 3337), rec 4269 subop 3 to
  Castle Drakan (3166, 7711). A locked entry says "You haven't unlocked that teleport yet."
  (rec 4288, subop 2, Slepe) and nothing else.

## Not covered

- Live's bare talisman Rub opens the `menu` modal titled "The talisman has N charges." with a
  Nowhere entry (recs 726, 1657); ours is the chatbox prompt.
- Landing tiles vary between visits in the captures (Inferno (1506, 3819), Honour (1256, 3562)
  and (1257, 3564), Lookout (1582, 3530)); the plugin lands on one tile each.
- A locked Xeric's Honour entry, or a memoirs page not yet added, does nothing here, as the worn
  option does; no capture shows live's reply.
- Drakan's medallion's Slepe tile (3166, 7711) is the captured Castle Drakan landing; no capture
  shows a Slepe teleport.
- Camulet (Rub > Enakhra's Temple / Entrance) and the Giantsoul amulet (Rub > lair) have the
  same kind of submenu and still open their menus from an entry.
