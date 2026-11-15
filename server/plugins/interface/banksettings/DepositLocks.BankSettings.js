/**
 * Deposit locks (Wiki: Bank, "Deposit lock settings"; added 22 January 2025): inventory slots the
 * bank's Deposit inventory leaves alone. The locks are per slot, not per item.
 *
 * From the cache (no recording opens the editor from the bank):
 * - bankmain:locks is "Deposit Lock Settings" (script 1272). Its op opens the bank_side_locks
 *   editor in the bank's popup, built by script 7784 (bank_side_locks_init), as the seed vault's
 *   lock_menu opens it in its own popup.
 * - The editor's scripts flip the varbits in the client and send the click (bank_side_locks_opslot,
 *   _ignorelocks_op, _extraoptions_op). The server keeps its own copy, saves it and sends it back on
 *   login: bank_side_slot_overview, a bit per slot; bank_side_slot_ignoreinvlocks, which turns
 *   the locks off (1); bank_side_slot_showop, the inventory's Lock-slot / Unlock-slot op (op 10,
 *   bankside_drawitem). With the locks off, slots and the extra op don't change.
 * - Deposit inventory skips a locked slot unless the locks are off (bank_side_locked_slot). Only
 *   the inventory is locked (script 7794: inv 93), and only the whole-inventory deposit ("the bank's
 *   standard Deposit options will avoid depositing items from the locked slots"); an item's own
 *   Deposit ops still bank it.
 *
 * The seed vault draws the same varbits, so it reads and writes these settings through
 * "bank:deposit-locks" { player, settings } (filled with { locks, ignoreLocks, showLockOps }) and
 * "bank:set-deposit-locks" { player, locks?, ignoreLocks?, showLockOps? }.
 */
const LOCKS_ATTRIBUTE = "bank-settings:deposit-locks";
const IGNORE_LOCKS_ATTRIBUTE = "bank-settings:deposit-locks-off";
const SHOW_OPS_ATTRIBUTE = "bank-settings:deposit-lock-ops";
const SLOT_MASK = (1 << 28) - 1;
const OPEN_OP = 1;
const LOCK_OP = 10;
const EDITOR_SCRIPT = 7784;
/** The editor's clickable children. */
const EDITOR_BUTTONS = ["ignorelocks", "extraoptions", "done"];
const INVENTORY_SLOTS = 28;

let api;
let core;
let ids;
/** Players with the editor open over the bank (the seed vault opens its own, and handles it). */
const editing = new WeakSet();

function lookup() {
  if (ids) return ids;
  const { CacheDefinitions } = core;
  const component = (name) => CacheDefinitions.getComponentId(name);
  ids = {
    open: component("bankmain:locks"),
    popup: component("bankmain:popup"),
    editor: CacheDefinitions.getInterfaceId("bank_side_locks"),
    slots: component("bank_side_locks:slots"),
    ignore: component("bank_side_locks:ignorelocks"),
    extra: component("bank_side_locks:extraoptions"),
    done: component("bank_side_locks:done"),
    buttons: EDITOR_BUTTONS.map((name) => component(`bank_side_locks:${name}`)),
    varbits: {
      locks: CacheDefinitions.getVarbitId("bank_side_slot_overview"),
      ignoreLocks: CacheDefinitions.getVarbitId("bank_side_slot_ignoreinvlocks"),
      showLockOps: CacheDefinitions.getVarbitId("bank_side_slot_showop"),
    },
  };
  return ids;
}

function settings(player) {
  const locks = Number(player.getAttribute(LOCKS_ATTRIBUTE)) | 0;
  return {
    locks: locks & SLOT_MASK,
    ignoreLocks: player.getAttribute(IGNORE_LOCKS_ATTRIBUTE) === 1,
    showLockOps: player.getAttribute(SHOW_OPS_ATTRIBUTE) === 1,
  };
}

function send(player) {
  const { varbits } = lookup();
  const current = settings(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.locks, current.locks);
  sender.sendVarbit(varbits.ignoreLocks, current.ignoreLocks ? 1 : 0);
  sender.sendVarbit(varbits.showLockOps, current.showLockOps ? 1 : 0);
}

/** Saves what changed and sends all three back, as the client already shows them. */
function update(player, { locks, ignoreLocks, showLockOps }) {
  if (Number.isInteger(locks)) player.setAttribute(LOCKS_ATTRIBUTE, locks & SLOT_MASK);
  if (typeof ignoreLocks === "boolean") player.setAttribute(IGNORE_LOCKS_ATTRIBUTE, ignoreLocks ? 1 : 0);
  if (typeof showLockOps === "boolean") player.setAttribute(SHOW_OPS_ATTRIBUTE, showLockOps ? 1 : 0);
  send(player);
}

function locked(player, slot) {
  const current = settings(player);
  return !current.ignoreLocks && Number.isInteger(slot) && slot >= 0 && slot < INVENTORY_SLOTS && (current.locks & (1 << slot)) !== 0;
}

/** The slot's lock flipped, unless the locks are off. */
function toggleSlot(player, slot) {
  const current = settings(player);
  if (current.ignoreLocks || !Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SLOTS) return;
  update(player, { locks: current.locks ^ (1 << slot) });
}

function openEditor(player) {
  const known = lookup();
  const sender = player.getPacketSender();
  editing.add(player);
  sender.sendSubInterface(known.popup, known.editor, 0);
  sender.sendClientScript(EDITOR_SCRIPT, known.popup);
  sender.sendInterfaceFlagsRange(known.slots, 0, INVENTORY_SLOTS - 1, 1 << 1);
  for (const button of known.buttons) sender.sendInterfaceFlagsRange(button, -1, -1, 1 << 1);
}

function editorOpen(player) {
  if (!editing.has(player)) return false;
  if (core.Bank.isOpen(player) && player.getPacketSender().isSubInterfaceOpen?.(lookup().editor) === true) return true;
  editing.delete(player);
  return false;
}

/** "player:widget-action": the editor's button and clicks, and the inventory's Lock-slot op. */
function widgetAction(event) {
  const { player, packet } = event;
  if (!player || !packet) return;
  const known = lookup();
  if (packet.widgetId === known.open) {
    if (packet.buttonNum !== OPEN_OP || !core.Bank.isOpen(player)) return;
    event.handled = true;
    openEditor(player);
    return;
  }
  if (packet.groupId === known.editor && editorOpen(player)) {
    event.handled = true;
    if (packet.buttonNum !== 1) return;
    const current = settings(player);
    if (packet.widgetId === known.done) {
      editing.delete(player);
      player.getPacketSender().closeSubInterface(known.popup);
    }
    else if (packet.widgetId === known.slots) toggleSlot(player, packet.slot);
    else if (packet.widgetId === known.ignore) update(player, { ignoreLocks: !current.ignoreLocks });
    else if (packet.widgetId === known.extra && !current.ignoreLocks) update(player, { showLockOps: !current.showLockOps });
    return;
  }
  // bankside_drawitem gives op 10 to Lock-slot / Unlock-slot (empty locked slots too) while the op is shown.
  if (packet.groupId === core.Bank.SIDE_INTERFACE_ID && packet.childId === core.Bank.SIDE_ITEMS_CHILD
    && packet.buttonNum === LOCK_OP && Number.isInteger(packet.slot)) {
    const current = settings(player);
    if (current.ignoreLocks || !current.showLockOps || !core.Bank.isOpen(player)) return;
    event.handled = true;
    toggleSlot(player, packet.slot);
  }
}

/** Deposit inventory (and the deposit box's) leaves locked slots; one-slot deposits don't ask. */
function keepLockedSlots(event) {
  const { player, container, slot, bulk } = event;
  if (!bulk || !player || container !== player.getInventory?.()) return;
  if (locked(player, slot)) event.allow = false;
}

function answerSettings(request) {
  if (request?.player) request.settings = settings(request.player);
}

function setSettings(request) {
  if (!request?.player) return;
  update(request.player, request);
  request.handled = true;
}

function restore({ player }) {
  send(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(LOCKS_ATTRIBUTE, 0);
  api.persistAttribute(IGNORE_LOCKS_ATTRIBUTE, 0);
  api.persistAttribute(SHOW_OPS_ATTRIBUTE, 0);
  api.onPlayerLogin(restore);
  api.onCustomEvent("player:widget-action", widgetAction);
  api.onCanBankItem(keepLockedSlots);
  api.onCustomEvent("bank:deposit-locks", answerSettings);
  api.onCustomEvent("bank:set-deposit-locks", setSettings);
}

module.exports = { attach, settings, update, locked, widgetAction, keepLockedSlots, LOCKS_ATTRIBUTE, IGNORE_LOCKS_ATTRIBUTE, SHOW_OPS_ATTRIBUTE };
