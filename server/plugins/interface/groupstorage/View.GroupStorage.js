"use strict";

/**
 * The cache's group storage interface (osrs-dumps rev 242, shared_bank_init / shared_bank_side_init):
 * `shared_bank` in the main modal draws the storage from inv `inv_group_temp`, `shared_bank_side`
 * in the side modal draws the backpack from `inv_player_temp`. Both are the session's working
 * copies, sent before the interfaces open because their onLoad scripts size themselves from them.
 *
 * shared_bank_init reads, once, as it opens:
 * - %if1 (varp 261): the wealth a member may still take, shown with a coin icon; -1 hides it (no
 *   wealth-transfer caps here);
 * - %if2: 0 "View only", 1 "Deposit only", 2 the full storage (Session.ACCESS);
 * - %if3: how many slots it draws (Store.CAPACITY);
 * - %if4: 1 gives main_bank a "Back to bank" op, when opened from the bank's Group Storage
 *   button (bankmain:gim_storage); 0 from the chests, which have no way back.
 * `gim_shared_bank_hasedited` (varbit 4602) turns the close button into "Save and Close", whose op
 * comes to the server; plain "Close" closes in the client. Quantity, note and insert mode are the
 * bank's own varbits, so the two share them.
 */

const Store = require("./Store.GroupStorage");

/** Items: ops 1-10 (bits 1-10), drag depth 1 and drag target, as the bank's slots. */
const STORAGE_SLOT_FLAGS = 0x7fe | (1 << 17) | (1 << 20);
/** Side panel: Deposit ops 1-7 and Examine (op 10), drag depth 1 and drag target. */
const SIDE_SLOT_FLAGS = 0xfe | (1 << 10) | (1 << 17) | (1 << 20);
const INVENTORY_SIZE = 28;
/** Bank.open's first script: shows the backpack's bank mode before the panels open. */
const BANK_SIDE_SCRIPT = 917;
const SIDE_MODAL_TYPE = 3;
/** shared_bank_drawcap: redraws the wealth limit or "Deposit only" while the storage is open. */
const DRAWCAP_SCRIPT = 5266;

let core;

function init(pluginApi) {
  core = pluginApi.core;
}

const defs = () => core.CacheDefinitions;
const group = (name) => defs().getInterfaceId(name);
const uid = (name) => defs().getComponentId(name);
const varp = (name) => defs().getVarpId(name);
const varbit = (name) => defs().getVarbitId(name);
const inventory = (name) => defs().getInventoryId(name);

const MAIN = () => group("shared_bank");
const SIDE = () => group("shared_bank_side");

function isOpen(player) {
  const sender = player.getPacketSender();
  return player.getInterfaceId() === MAIN() && (sender.isSubInterfaceOpen?.(MAIN()) ?? true);
}

/** The bank settings the interface shares, as the bank sends them. */
function settingVarbits(player) {
  return {
    [varbit("bank_withdrawnotes")]: player.withdrawAsNote() ? 1 : 0,
    [varbit("bank_insertmode")]: player.insertModeReturn() ? 1 : 0,
    [varbit("bank_quantity_type")]: player.getBankQuantityMode(),
    [varbit("bank_requestedquantity")]: player.getBankCustomQuantity(),
  };
}

/** Sends both working copies and whether there is anything to save. */
function refresh(player, session) {
  const sender = player.getPacketSender();
  sender.sendInventory(inventory("inv_group_temp"), Store.CAPACITY, session.storage, MAIN());
  sender.sendInventory(inventory("inv_player_temp"), INVENTORY_SIZE,
    session.inventory.map((item) => (item ? { id: item.getId(), amount: item.getAmount() } : null)), SIDE());
  sender.sendVarbit(varbit("gim_shared_bank_hasedited"), session.edited ? 1 : 0);
}

function open(player, session) {
  const sender = player.getPacketSender();
  const varps = {
    [varp("if1")]: session.limit ?? -1, [varp("if2")]: session.access, [varp("if3")]: Store.CAPACITY,
    [varp("if4")]: session.fromBank ? 1 : 0,
  };
  const varbits = { ...settingVarbits(player), [varbit("gim_shared_bank_hasedited")]: 0 };
  for (const [id, value] of Object.entries(varps)) sender.sendConfig(Number(id), value);
  for (const [id, value] of Object.entries(varbits)) sender.sendVarbit(Number(id), value);
  refresh(player, session);
  player.setEnteredAmountAction(null);
  sender.sendInterfaceScript(BANK_SIDE_SCRIPT, [-1, -2])
    .sendSubInterface(uid("toplevel_osrs_stretch:mainmodal"), MAIN(), 0, { varps, varbits })
    .sendSubInterface(uid("toplevel_osrs_stretch:sidemodal"), SIDE(), SIDE_MODAL_TYPE, { varps, varbits })
    .sendInterfaceFlagsRange(uid("shared_bank:items"), 0, Store.CAPACITY - 1, STORAGE_SLOT_FLAGS)
    .sendInterfaceFlagsRange(uid("shared_bank_side:items"), 0, INVENTORY_SIZE - 1, SIDE_SLOT_FLAGS);
  player.setInterfaceId(MAIN());
}

/** shared_bank_drawcap (cs 5266) on shared_bank:universe's text and coin icon: the limit now. */
function sendLimit(player, session) {
  player.getPacketSender().sendClientScript(DRAWCAP_SCRIPT, uid("shared_bank:universe"), 0, 1, session.limit ?? -1, session.access);
}

/** Tells the client the access level changed (a member started leaving with it open). */
function sendAccess(player, session) {
  player.getPacketSender().sendConfig(varp("if2"), session.access);
  sendLimit(player, session);
}

function close(player) {
  if (player.getInterfaceId() === MAIN()) player.getPacketSender().sendInterfaceRemoval();
}

module.exports = {
  STORAGE_SLOT_FLAGS, SIDE_SLOT_FLAGS, INVENTORY_SIZE, init, MAIN, SIDE, uid, varbit, isOpen, settingVarbits,
  refresh, open, sendLimit, sendAccess, close,
};
