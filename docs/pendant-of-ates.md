# Pendant of Ates

The pendant is a Varlamore neck-slot teleport item dropped by frost nagua and Amoxliatl, charged with frozen tears. It lives in `server/plugins/items/PendantOfAtes.plugin.js`; the regression tests are `server/tests/pendant-of-ates.test.cjs`.

## What the Wiki says (and the plugin does)

Sources: the Wiki pages Pendant of Ates, Frozen tear and Statue (Ates).

- **Charging:** a frozen tear is one charge, up to 1,000. The pendant is inert until charged (item ids `pendant_of_ates_empty` / `pendant_of_ates`), and a pendant's charges belong to that item: several charged pendants do not share them and do not stack. They are kept as item metadata (`pendant-of-ates:charges`), the way the Giantsoul amulet does.
- **Uncharge** returns the tears and leaves the inert pendant. **Dismantle** (inert only) gives 100 frozen tears.
- **Teleports:** six destinations, each only after the player has activated the statue of Ates there. Each teleport costs one charge.
- **Statues:** Darkfrost, Twilight Temple, Ralos' Rise, Kastori and Nemus Retreat have no requirement. The Aldarin statue needs the icon from Death on the Isle; that quest already owns it and sends its varbit, so the pendant only reads it.

## From the cache

- The charged pendant's Rub option carries the six destinations as sub-operations (`Darkfrost`, `Twilight Temple`, `Ralos' Rise`, `North Aldarin`, `Kastori`, `Nemus Retreat`); worn, they are the item params 451-456, with Check at 457 (one past the sixth).
- Each statue is a multiloc on a `pendant_of_ates_*_found` varbit: darkfrost 11175, twilight 11176, ralos 11177, aldarin 11178, tlati (Kastori) 16752, auburn (Nemus Retreat) 16757. Setting the varbit swaps the inactive statue for the active one on the client; the click arrives with the multiloc's parent id, so the plugin reads the inactive statue from the object's definition.
- The varbits are not saved with the player, so the plugin saves a bitmask of activated statues (`pendant-of-ates:statues`) and sends the varbits at login.
- Worn options run past the fifth click. The named item-action hooks used to accept clicks 1-5 only, so Kastori, Nemus Retreat and Check could not be hooked by name when worn; they now take up to 10 for the equipment interface.

## Not verified

- No recording in the rsprox index shows the pendant being used (it only appears in the drop message and in bank listings), so the **messages are this server's own**: the charging, Check, Uncharge, Dismantle, locked-statue, activation and out-of-charges lines.
- The teleport's animation and graphic are the standard jewellery teleport; no capture shows whether the pendant has its own.
- **Landing tiles** are the Wiki's map pins for each statue, except Twilight Temple, whose pin is the statue's own tile, so the landing is the tile south of it. The pins of the other five are next to their statues in the cache's map; whether live OSRS lands on exactly these tiles is not confirmed.
- Charges are spent as the teleport starts, not on arrival.

## Not built

- The bank's change-charges option (Wiki, 12 March 2025).
- Plain Rub (without picking a destination): the cache gives the option a submenu, so the client always sends a destination.
- Wilderness behaviour beyond the standard level-20 teleport limit.
