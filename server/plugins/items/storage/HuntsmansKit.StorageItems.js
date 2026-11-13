/** Huntsman's kit: docs/storage-items.md. Native 871/872, inventory 855 (cache 242).
 * Slots stay put when emptied: recorded 1206/1207, revision 238.1. Contents survive death;
 * stored equipment must be withdrawn before use. This store deliberately does not use the
 * packed/FIFO/death-emptying policies of other storage families.
 */
const Storage = require("./Common.StorageItems");
const DATA = require("../data/huntsmans-kit.json");
const NAME = "Huntsman's kit";
const CONTENTS_ATTRIBUTE = "storage-items:huntsmans-kit";
const QUANTITY_ATTRIBUTE = "storage-items:huntsmans-kit-quantity";
const CAPACITY = 32;
const INVENTORY = 855;
const MAIN = 871, SIDE = 872, GRID = 11;
const MAIN_TARGET = (161 << 16) | 16, SIDE_TARGET = (161 << 16) | 74;
const QUANTITY_VARBIT = 11795;
const QUANTITY_BUTTONS = new Map([[4, 0], [5, 1], [6, 3], [7, 2]]);
const AMOUNTS = new Map([[0, 1], [1, 5], [2, 0x7fffffff]]);
// TSPS's signed-int inventory representation bound, not a claimed retail per-item limit.
const MAX_AMOUNT = 0x7fffffff;
const SLOT_FLAGS = 0b111110 | (1 << 10) | (1 << 17) | (1 << 20);
const sessions = new WeakMap();
const versions = new WeakMap();
let eligible = null;
function ids() {
  if (!eligible) eligible = new Set(DATA.gamevals.map(name => Storage.core.CacheDefinitions.getObjId(name)).filter(Number.isInteger));
  return eligible;
}
function kitId() { return Storage.core.ItemIdentifiers.HUNTSMANS_KIT; }
function carried(player) { return player.getInventory().getValidItems().some(item => item.getId() === kitId() && item.getAmount() > 0); }
function contents(player) {
  const saved = player.getAttribute(CONTENTS_ATTRIBUTE);
  return Array.from({ length: CAPACITY }, (_, slot) => {
    const row = Array.isArray(saved) ? saved[slot] : null;
    return Array.isArray(row) && Number.isInteger(row[0]) && ids().has(row[0]) && Number.isInteger(row[1]) && row[1] > 0 && row[1] <= MAX_AMOUNT
      ? { id: row[0], amount: row[1] } : null;
  });
}
function sendContents(player) { player.getPacketSender().sendInventory(INVENTORY, CAPACITY, contents(player), MAIN); }
function update(player, slots) {
  player.setAttribute(CONTENTS_ATTRIBUTE, slots.some(Boolean) ? slots.map(item => item ? [item.id, item.amount] : null) : []);
  versions.set(player, (versions.get(player) ?? 0) + 1);
  if (isOpen(player)) sendContents(player);
}
function isOpen(player) {
  const session = sessions.get(player);
  return !!session && player.getInterfaceId() === MAIN && session.kit.getId() === kitId() && session.kit.getAmount() > 0
    && player.getInventory().getValidItems().includes(session.kit)
    && player.getPacketSender().getSubInterfaceAt(MAIN_TARGET) === session.mount;
}
function mode(player) {
  const value = player.getAttribute(QUANTITY_ATTRIBUTE) ?? 0;
  return AMOUNTS.has(value) || value === 3 ? value : 0;
}
function view({ player, item }) {
  if (!carried(player)) return;
  player.getPacketSender().sendInterfaceRemoval();
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(917, [-1, -1]);
  sender.sendInterface(MAIN);
  sender.sendSubInterface(SIDE_TARGET, SIDE, 3);
  sessions.set(player, { kit: item, mount: sender.getSubInterfaceAt(MAIN_TARGET) });
  sendContents(player);
  sender.sendInterfaceFlagsRange((MAIN << 16) | GRID, 0, CAPACITY - 1, SLOT_FLAGS);
  sender.sendInterfaceFlagsRange(SIDE << 16, 0, 27, SLOT_FLAGS);
  sender.sendVarbit(QUANTITY_VARBIT, mode(player));
}
function plain(item) {
  return item && item.getAmount() > 0 && !item.isPresetItem() && !Object.keys(item.getMeta() ?? {}).length;
}
function deposit(player, item, requested) {
  if (!carried(player) || !plain(item) || !player.getInventory().getValidItems().includes(item)) return;
  const id = item.getId();
  if (!ids().has(id)) {
    player.sendMessage(id === kitId() ? "The Huntsman's Kit cannot hold itself! How weird would that be?" : "Your huntsman's kit cannot hold that item.");
    return;
  }
  const slots = contents(player);
  let slot = slots.findIndex(entry => entry?.id === id);
  if (slot < 0) slot = slots.findIndex(entry => entry === null);
  if (slot < 0) { player.sendMessage("Your huntsman's kit is full."); return; }
  // 5/X/All also cover unstackable items across physical inventory slots. Only plain
  // copies join the store: same-ID metadata/preset neighbours keep their properties.
  const matching = player.getInventory().getValidItems().filter(entry => entry.getId() === id && plain(entry));
  const available = matching.reduce((sum, entry) => sum + entry.getAmount(), 0);
  const amount = Math.min(requested, available, MAX_AMOUNT - (slots[slot]?.amount ?? 0));
  if (!Number.isInteger(amount) || amount <= 0) return;
  slots[slot] = { id, amount: (slots[slot]?.amount ?? 0) + amount };
  let left = amount;
  for (const entry of matching) {
    const take = Math.min(left, entry.getAmount());
    player.getInventory().deleteAtSlot(player.getInventory().getItems().indexOf(entry), take);
    left -= take;
    if (left === 0) break;
  }
  update(player, slots);
  player.getInventory().refreshItems();
}
function withdraw(player, slot, requested) {
  if (!carried(player)) return;
  const slots = contents(player), item = slots[slot];
  if (!item) return;
  const amount = Math.min(requested, item.amount, Storage.inventoryRoom(player, item.id));
  if (!(amount > 0)) { player.getInventory().full(); return; }
  player.getInventory().add(new Storage.core.Item(item.id, amount), true);
  item.amount -= amount;
  if (item.amount === 0) slots[slot] = null;
  update(player, slots);
}
function fill({ player }) {
  if (!carried(player)) return;
  for (const item of [...player.getInventory().getValidItems()]) if (ids().has(item.getId())) deposit(player, item, MAX_AMOUNT);
}
function empty({ player }) {
  if (!carried(player)) return;
  for (let slot = CAPACITY - 1; slot >= 0; slot--) if (contents(player)[slot]) withdraw(player, slot, MAX_AMOUNT);
}
function click(event) {
  const { player, groupId, childId, action, slot, itemId } = event;
  if (groupId !== MAIN && groupId !== SIDE) return;
  event.handled = true;
  if (!isOpen(player)) return;
  if (groupId === MAIN && childId !== GRID) {
    if (action !== 1) return;
    if (QUANTITY_BUTTONS.has(childId)) {
      const value = QUANTITY_BUTTONS.get(childId);
      player.setAttribute(QUANTITY_ATTRIBUTE, value);
      player.getPacketSender().sendVarbit(QUANTITY_VARBIT, value);
    } else if (childId === 8) fill({ player });
    else if (childId === 9) empty({ player });
    return;
  }
  if ((groupId === MAIN && childId !== GRID) || (groupId === SIDE && childId !== 0) || !Number.isInteger(slot)) return;
  const item = groupId === MAIN ? contents(player)[slot] : player.getInventory().getItems()[slot];
  const id = groupId === MAIN ? item?.id : item?.getId();
  if (!(id > 0) || id !== itemId) return;
  if (action === 10) { player.sendMessage(Storage.core.ItemDefinition.forId(id).getExamine()); return; }
  const selected = action === 1 ? mode(player) : [0, 1, 3, 2][action - 2];
  if (selected === undefined) return;
  const session = sessions.get(player), version = versions.get(player) ?? 0;
  const move = amount => {
    if (!isOpen(player) || sessions.get(player) !== session || (versions.get(player) ?? 0) !== version || !Number.isInteger(amount) || amount <= 0) return;
    if (groupId === MAIN) withdraw(player, slot, amount);
    else if (player.getInventory().getItems()[slot] === item) deposit(player, item, amount);
  };
  if (selected === 3) {
    player.setEnteredAmountAction({ execute: move });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  } else move(AMOUNTS.get(selected));
}
function drag(event) {
  const { player, packet } = event;
  const grid = (MAIN << 16) | GRID;
  const side = SIDE << 16;
  const sideDrag = packet?.sourceWidgetId === side && packet?.targetWidgetId === side;
  if (!sideDrag && (packet?.sourceWidgetId !== grid || packet?.targetWidgetId !== grid)) return;
  event.handled = true;
  if (!isOpen(player)) return;
  const { sourceSlot: from, targetSlot: to } = packet;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= CAPACITY || to < 0 || to >= CAPACITY || from === to) return;
  if (sideDrag) {
    if (from >= 28 || to >= 28) return;
    player.getInventory().swap(from, to).refreshItems();
    return;
  }
  const slots = contents(player);
  if (!slots[from]) return;
  [slots[from], slots[to]] = [slots[to], slots[from]];
  update(player, slots);
}
function destroyPrompt(event) {
  if (event.item.getId() !== kitId()) return;
  event.warning = contents(event.player).some(Boolean)
    ? "Your Huntsman's Kit contains items. If you destroy it, they'll be lost. The kit may also be hard to replace."
    : "Your Huntsman's Kit is currently empty, but it can be hard to replace.";
}
function destroyed({ player, itemId }) {
  if (itemId !== kitId()) return;
  update(player, []);
  sessions.delete(player);
}
function answerContents(event) {
  if (event.item?.getId() !== kitId()) return;
  event.contents.push(...contents(event.player).filter(Boolean));
  event.handled = true;
}
module.exports = api => {
  api.persistAttribute(CONTENTS_ATTRIBUTE, []);
  api.persistAttribute(QUANTITY_ATTRIBUTE, 0);
  api.onItemAction(NAME, { View: view, Fill: fill, Empty: empty });
  api.onInterfaceActionClick(click);
  api.onCustomEvent("player:widget-action", drag);
  api.onCustomEvent("storage:contents", answerContents);
  api.onCustomEvent("destroy-item:prompt", destroyPrompt);
  api.onCustomEvent("destroy-item:destroyed", destroyed);
};
Object.assign(module.exports, { CONTENTS_ATTRIBUTE, QUANTITY_ATTRIBUTE, CAPACITY, INVENTORY, MAIN, SIDE, ids });
