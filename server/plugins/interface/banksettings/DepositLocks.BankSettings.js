/**
 * Deposit locks (Wiki: Bank, "Deposit lock settings"; added 22 January 2025): inventory slots the
 * bank's Deposit inventory leaves alone. The locks are per slot, not per item.
 *
 * Recordings and cache:
 * - bankmain:locks is "Deposit Lock Settings" (script 1272). rsprox_transcripts/228/02249.txt tick 215
 *   and 229/02520.txt tick 1275 (that revision's bankmain 12:65, with the popup at 12:126; the bank's
 *   components are renumbered since): if_button1 on it, then if_opensub bank_side_locks into the
 *   bank's popup, if_setevents on its slots 0-27 (OP1) and script 7784 (bank_side_locks_init) with
 *   the popup, in that order. 228 sends trigger_ondialogabort first: an open chatbox prompt is aborted.
 * - The deposit box's bank_depositbox:lock_menu opens the same editor into bank_depositbox:popup, in the
 *   same order: rsprox_transcripts/241/900096.txt tick 669 (if_buttonx op 1, opensub, slots OP1, 7784),
 *   closed by resume_p_countdialog count=0 then if_closesub at tick 671; 228/02249.txt tick 285 (that
 *   revision's 192:33, popup 192:39) aborts an open Enter amount prompt first and closes at tick 288.
 * - The editor's scripts flip the varbits in the client and send the click (bank_side_locks_opslot,
 *   _ignorelocks_op, _extraoptions_op). Only the slots get events; ignorelocks and extraoptions
 *   transmit op 1 from the cache (transmitop=1), so nothing else is sent for them. Done has no op:
 *   it runs script 614, which answers resume_countdialog "0", and the server closes the editor
 *   (resume_p_countdialog count=0 then if_closesub, 228/02249.txt tick 218, 229/02520.txt tick 1320).
 * - The server keeps its own copy, saves it and sends it back on login: bank_side_slot_overview, a
 *   bit per slot; bank_side_slot_ignoreinvlocks, which turns the locks off (1); bank_side_slot_showop,
 *   the inventory's Lock-slot / Unlock-slot op (op 10, bankside_drawitem; 239/900004.txt tick 21
 *   unlocks an empty slot with it). With the locks off, slots and the extra op don't change.
 * - Deposit inventory skips a locked slot unless the locks are off (bank_side_locked_slot). Only
 *   the inventory is locked (script 7794: inv 93), and only the whole-inventory deposit ("the bank's
 *   standard Deposit options will avoid depositing items from the locked slots"); an item's own
 *   Deposit ops still bank it, and so does a scripted deposit that must empty the inventory
 *   (Bank.depositItems' emptyAll, Peer the Seer's spell).
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
const INVENTORY_SLOTS = 28;

let api;
let core;
let ids;
/** Players with the editor open over the bank or deposit box -> { done, host } (the seed vault opens its own, and handles it). */
const editing = new WeakMap();

function lookup() {
  if (ids) return ids;
  const { CacheDefinitions } = core;
  const component = (name) => CacheDefinitions.getComponentId(name);
  const depositBox = CacheDefinitions.getInterfaceId("bank_depositbox");
  ids = {
    hosts: [
      { open: component("bankmain:locks"), popup: component("bankmain:popup"), isOpen: (player) => core.Bank.isOpen(player) },
      {
        open: component("bank_depositbox:lock_menu"),
        popup: component("bank_depositbox:popup"),
        isOpen: (player) => player.getInterfaceId?.() === depositBox,
      },
    ],
    editor: CacheDefinitions.getInterfaceId("bank_side_locks"),
    slots: component("bank_side_locks:slots"),
    ignore: component("bank_side_locks:ignorelocks"),
    extra: component("bank_side_locks:extraoptions"),
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

function openEditor(player, host) {
  const known = lookup();
  const sender = player.getPacketSender();
  sender.abortInputPrompt();
  sender.sendSubInterface(host.popup, known.editor, 0);
  sender.sendInterfaceFlagsRange(known.slots, 0, INVENTORY_SLOTS - 1, 1 << 1);
  sender.sendClientScript(EDITOR_SCRIPT, host.popup);
  // Done answers the count prompt with 0; an aborted prompt takes the editor down too.
  const done = { acceptsZero: true, execute: () => closeEditor(player, done), cancel: () => closeEditor(player, done) };
  editing.set(player, { done, host });
  player.setEnteredAmountAction(done);
}

function closeEditor(player, done) {
  const open = editing.get(player);
  if (open?.done !== done) return;
  editing.delete(player);
  if (player.getEnteredAmountAction?.() === done) player.setEnteredAmountAction(null);
  player.getPacketSender().closeSubInterface(open.host.popup);
}

function editorOpen(player) {
  const open = editing.get(player);
  if (!open) return false;
  if (open.host.isOpen(player) && player.getPacketSender().isSubInterfaceOpen?.(lookup().editor) === true) return true;
  // Closed with the bank or deposit box: its Done answer goes too.
  editing.delete(player);
  if (player.getEnteredAmountAction?.() === open.done) player.setEnteredAmountAction(null);
  return false;
}

/** "player:widget-action": the bank's and deposit box's editor buttons, the editor's clicks, and the inventory's Lock-slot op. */
function widgetAction(event) {
  const { player, packet } = event;
  if (!player || !packet) return;
  const known = lookup();
  const host = known.hosts.find((candidate) => candidate.open === packet.widgetId);
  if (host) {
    if (packet.buttonNum !== OPEN_OP || !host.isOpen(player)) return;
    event.handled = true;
    openEditor(player, host);
    return;
  }
  if (packet.groupId === known.editor && editorOpen(player)) {
    event.handled = true;
    if (packet.buttonNum !== 1) return;
    const current = settings(player);
    if (packet.widgetId === known.slots) toggleSlot(player, packet.slot);
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
  const { player, container, slot, bulk, emptyAll } = event;
  if (!bulk || emptyAll || !player || container !== player.getInventory?.()) return;
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
