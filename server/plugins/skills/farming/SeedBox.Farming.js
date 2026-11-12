const core = require("./Core.Farming");

/**
 * The seed box's contents window (Check/Take on the box), from rsprox captures 1022, 3906, 4222, 4293 and 4295 (rev 235/238):
 * the box's six slots open as `hosidius_seedbox` over `seed_box` with "Withdraw 1/3/4/X/All" on ops 1-5, an examine on
 * op 10 and drag-to-reorder; Close prints "The seed box contains:" and one "N x Seed." line per kind, or "The seed box is
 * empty." for an empty box. The `busy` varbit is 1 while it is open.
 *
 * The box is six fixed slots: a new kind goes into the first free slot, a kind taken out in full leaves its slot free, and
 * dragging one slot onto another swaps them. Check, Close, Empty and using the box on a patch all follow that slot order.
 */
const STORED_META = "farming:stored";
/** The item id in each slot, -1 for a free one. A box saved without it lists its kinds by item id. */
const SLOTS_META = "farming:slots";
const SLOTS = 6;
const AMOUNTS = [1, 3, 4];
const OP_X = 4;
const OP_ALL = 5;
const OP_EXAMINE = 10;
const MAX_AMOUNT = 2147483647;
const DEPTH1 = 1 << 17;
const DRAG_TARGET = 1 << 20;
const OP_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 10) | DEPTH1 | DRAG_TARGET;
const INTERFACE_INV_INIT = 149;
/** interface_inv_init's drag argument: 1 lets the slots be dragged. */
const DRAGGABLE = 1;
const SESSIONS = new WeakMap();
const group = () => core.CacheDefinitions.getInterfaceId("hosidius_seedbox");
const uid = name => core.CacheDefinitions.getComponentId(name);
const nameOf = id => core.CacheDefinitions.getItem(id).name;

/** The six slots in order, each [id, count] or null when free. */
function slotsOf(box) {
    const stored = box.getMetaValue(STORED_META) ?? {}, order = box.getMetaValue(SLOTS_META);
    const slots = new Array(SLOTS).fill(null), placed = new Set();
    (Array.isArray(order) ? order : []).slice(0, SLOTS).forEach((id, slot) => {
        if (stored[id] > 0 && !placed.has(+id)) { slots[slot] = [+id, stored[id]]; placed.add(+id); }
    });
    const rest = Object.entries(stored).map(([id, count]) => [+id, count])
        .filter(([id, count]) => count > 0 && !placed.has(id)).sort((a, b) => a[0] - b[0]);
    for (const entry of rest) {
        const free = slots.indexOf(null);
        if (free < 0) break;
        slots[free] = entry;
    }
    return slots;
}
/** The stored kinds in slot order. */
const entriesOf = box => slotsOf(box).filter(Boolean);
/** Saves the slot order after the contents changed: new kinds take the first free slots, emptied kinds free theirs. */
function arrange(box, slots = slotsOf(box)) {
    const order = slots.map(entry => entry?.[0] ?? -1);
    while (order.length && order.at(-1) === -1) order.pop();
    box.setMetaValue(SLOTS_META, order.length ? order : undefined);
}
/** Takes `amount` of `id` out of the box. */
function take(box, id, amount) {
    const stored = box.getMetaValue(STORED_META) ?? {};
    stored[id] = (stored[id] ?? 0) - amount;
    if (!(stored[id] > 0)) delete stored[id];
    box.setMetaValue(STORED_META, stored);
    arrange(box);
}
function current(player) {
    const session = SESSIONS.get(player);
    if (!session || player.getInterfaceId() !== group() || !player.getPacketSender().isSubInterfaceOpen(group())) return null;
    return player.getInventory().forSlot(session.slot) === session.box ? session : null;
}
function sync(player, box) {
    player.getPacketSender().sendInventory(core.CacheDefinitions.getInventoryId("seed_box"), SLOTS,
        slotsOf(box).map(entry => entry && { id: entry[0], amount: entry[1] }));
}
function open(player, box) {
    const slot = player.getInventory().getItems().indexOf(box);
    if (slot < 0 || (player.busy() && !current(player))) return;
    SESSIONS.set(player, { box, slot });
    sync(player, box);
    const sender = player.getPacketSender(), layer = uid("hosidius_seedbox:seed_layer");
    sender.sendVarbit(core.CacheDefinitions.getVarbitId("busy"), 1);
    player.setInterfaceId(group());
    sender.sendSubInterface(uid("toplevel_osrs_stretch:sidemodal"), group(), 0);
    sender.sendInterfaceFlagsRange(layer, 0, SLOTS - 1, OP_FLAGS);
    sender.sendInterfaceScript(INTERFACE_INV_INIT, [layer, core.CacheDefinitions.getInventoryId("seed_box"), 2, 3, DRAGGABLE, -1,
        ...AMOUNTS.map(n => `Withdraw ${n}`), "Withdraw X", "Withdraw All"]);
}
/** Closed by any route (its Close button, Esc, walking away): the contents are listed, then the window is gone. */
function spam(player, text) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}
function closed({ player, interfaceId }) {
    const session = SESSIONS.get(player);
    if (!session || interfaceId !== group()) return;
    SESSIONS.delete(player);
    player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId("busy"), 0);
    // Spam, as every recorded close lists them (e.g. "The seed box contains:", "8 x Poison ivy seed.");
    // an empty box says so instead (rsprox 238/04222.txt:43801, tick 2538).
    const slots = entriesOf(session.box);
    if (slots.length === 0) {
        spam(player, "The seed box is empty.");
        return;
    }
    spam(player, "The seed box contains:");
    for (const [id, count] of slots) spam(player, `${count} x ${nameOf(id)}.`);
}
function withdraw(player, session, id, requested) {
    const stored = session.box.getMetaValue(STORED_META) ?? {}, inventory = player.getInventory();
    if (!(stored[id] > 0) || current(player) !== session) return;
    const item = new core.Item(id, Math.min(stored[id], requested));
    const amount = Math.min(item.getAmount(), inventory.getAddableAmount(item));
    if (amount <= 0) { inventory.full(); return; }
    inventory.add(item.setAmount(amount), false);
    take(session.box, id, amount);
    spam(player, `Emptied ${amount} x ${nameOf(id)} to your inventory.`);
    inventory.refreshItems();
    sync(player, session.box);
}
function prompt(player, session, id) {
    const action = { acceptsZero: false, execute(amount) {
        if (current(player) !== session || player.getEnteredAmountAction() !== action) return;
        player.setEnteredAmountAction(null);
        if (Number.isSafeInteger(amount) && amount > 0) withdraw(player, session, id, Math.min(MAX_AMOUNT, amount));
    } };
    player.setEnteredAmountAction(action);
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}
function click(event) {
    const { player, buttonId } = event;
    if (event.handled || buttonId >>> 16 !== group()) return;
    event.handled = true;
    const session = current(player), op = event.opId ?? event.action;
    if (!session || !Number.isInteger(op)) return;
    if (buttonId === uid("hosidius_seedbox:close_button")) {
        if (op === 1) player.getPacketSender().sendInterfaceRemoval();
        return;
    }
    if (buttonId !== uid("hosidius_seedbox:seed_layer")) return;
    const entry = slotsOf(session.box)[event.slot];
    if (!entry || (event.itemId !== undefined && event.itemId !== entry[0])) return;
    player.setEnteredAmountAction(null);
    if (op === OP_EXAMINE) player.sendMessage(core.CacheDefinitions.getItem(entry[0]).examine ?? "");
    else if (op === OP_X) prompt(player, session, entry[0]);
    else if (op === OP_ALL) withdraw(player, session, entry[0], MAX_AMOUNT);
    else if (op >= 1 && op <= AMOUNTS.length) withdraw(player, session, entry[0], AMOUNTS[op - 1]);
}
/**
 * A slot dragged onto another in the open window swaps the two; the box's inventory update names both slots.
 * Ours: a drop on a free slot moves the kind there.
 */
function drag(event) {
    const { player, packet } = event, layer = uid("hosidius_seedbox:seed_layer");
    if (event.handled || packet?.sourceWidgetId !== layer || packet?.targetWidgetId !== layer) return;
    event.handled = true;
    const session = current(player);
    if (!session) return;
    const from = Number(packet.sourceSlot), to = Number(packet.targetSlot), slots = slotsOf(session.box);
    if (Number.isInteger(from) && Number.isInteger(to) && from !== to && slots[from] && to >= 0 && to < SLOTS) {
        [slots[from], slots[to]] = [slots[to], slots[from]];
        arrange(session.box, slots);
    }
    sync(player, session.box);
}
function logout({ player }) { SESSIONS.delete(player); }
Object.assign(module.exports, { open, click, closed, drag, logout, slotsOf, entriesOf, arrange, take });
