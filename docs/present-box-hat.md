# Present box hat: native style selection

The Change action on the four real Present box hat variants opens the cache's item_transmog
interface. This implements changing an already-owned hat, not an annual activity, granting
the reward, Diango reclamation or toy-box storage.

## Evidence

- [OSRS Wiki: Present box hat](https://oldschool.runescape.wiki/w/Present_box_hat): four
  styles, inventory/worn Change, the selection interface and confirmation message.
- Revision-241 dump pinned in sources.md: objects xmas24_present_hat_festive/simple/icy/
  antisanta have inventory action3 Change and worn param451 Change; all are head-slot,
  nonstackable cosmetics. Active-cache lookups validate these, rather than guessing IDs.
- item_transmog database rows4229-4232 define group25, group indices0-3, the four object
  identities and labels Festive, Simple, Icy and Anti-Santa. The plugin reads these rows
  through CacheDefinitions and named column lookups at runtime.
- item_transmog interface789: entries_clickzones contains dynamic selection children.
  Client script6857 calls proc7978 with the group; it constructs the labels/models from
  the database. Script6858 uses Select operation1 and updates local varc1110 and active
  object varp3703. The server validates the corresponding native child operation and
  mirrors the chosen object back to the client. Examine and same-style selections are no-ops.
- Local RSProx search for *present*hat* returned no matching recording. No action timing,
  recorded dialogue sequence or broader holiday parity is claimed.

## Ownership and native path

ItemActionPacketListener resolves the current inventory/equipment slot; PluginManager's
name/action dispatcher uses the active cache's inventory action or worn option param.
The generic `ItemStyles` plugin (`server/plugins/items/ItemStyles.plugin.js`, which replaced
PresentBoxHat; see `docs/holiday-reward-retrieval.md`) opens the native interface, sets its active-object varp, enables selection
children and runs the cache initializer. The interface click dispatcher passes the dynamic
child index and operation to the handler.

The transient WeakMap session retains the actual source container/slot/item, current ID,
amount and metadata snapshot. A valid choice mutates only that live item, preserving its
metadata and amount, refreshes its container and, while worn, equipment bonuses/appearance.
It also refreshes the native active-object varp and sends the Wiki's confirmation line.
No empty inventory slot, payment, duplicate item or new persistent attribute is involved.

Close, modal replacement and logout discard the session. A source moved, removed/refilled,
replaced or changed under the window is rejected. These checks depend on actual container
identity semantics: removal/refill uses a new held item, while a worn item can move into
inventory retaining its identity; the original container/slot check must reject both.
Actual Bank open/deposit/withdraw and equip/unequip paths are part of verification, not
merely synthetic setItem replacement tests.

## Verification scope

Ten focused tests currently exercise real Player, Inventory, Equipment, PacketSender,
ItemActionPacketListener, PluginManager, Bank and JSON persistence. Only network output is
captured. They cover all four selections from held/worn items, full/multiple-item inventory,
invalid operations, same-style no-op, close/replacement/logout, real container empty/refill,
real Bank round trip and actual save/hydration. Native rendering/input and independent
review evidence are recorded in the PR after those checks are complete.

Fixture hats are seeded for QA. This does not establish that players can earn or reclaim
the item in the current game; those remain separate holiday-system gaps.

Native testing also exposed a shared client lifecycle defect: a detached child's hover
callback recoloured the new selection after CC_DELETEALL. Client PR #1535 fixes that
independently. Final integration used that reviewed client with this server plugin:
native worn Change, Simple/Anti-Santa selection, actual unequip, inventory Change,
Festive/Icy selection and native Close. All selected borders stayed gold after mouse leave;
icons, equipment appearance, authoritative item IDs, varp3703 and messages agreed.
The prior Icy worn form also survived real server shutdown/restart and browser login.
These visible results depend on the separate client fix; this plugin does not work around
the hover bug by sending extra initialization packets.
