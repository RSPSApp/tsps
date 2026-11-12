const core = require("./Core.Farming");

/**
 * The seed box's contents window (Check/Take on the box), from rsprox captures 1022, 3906, 4222, 4293 and 4295 (rev 235/238):
 * the box's six slots open as `hosidius_seedbox` over `seed_box` with "Withdraw 1/3/4/X/All" on ops 1-5 and an
 * examine on op 10; Close prints "The seed box contains:" and one "N x Seed." line per kind, or "The seed box is empty." for an
 * empty box. The `busy` varbit is 1 while it is open.
 */
const STORED_META = "farming:stored";
const SLOTS = 6;
const AMOUNTS = [1, 3, 4];
const OP_X = 4;
const OP_ALL = 5;
const OP_EXAMINE = 10;
const MAX_AMOUNT = 2147483647;
const OP_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 10);
const INTERFACE_INV_INIT = 149;
const SESSIONS = new WeakMap();
const group = () => core.CacheDefinitions.getInterfaceId("hosidius_seedbox");
const uid = name => core.CacheDefinitions.getComponentId(name);
const nameOf = id => core.CacheDefinitions.getItem(id).name;

/** The stored kinds in slot order (ours: ascending item id; the captures do not show how the live box orders them). */
function slotsOf(box) {
    return Object.entries(box.getMetaValue(STORED_META) ?? {})
        .map(([id, count]) => [+id, count]).filter(([, count]) => count > 0).sort((a, b) => a[0] - b[0]).slice(0, SLOTS);
}
function current(player) {
    const session = SESSIONS.get(player);
    if (!session || player.getInterfaceId() !== group() || !player.getPacketSender().isSubInterfaceOpen(group())) return null;
    return player.getInventory().forSlot(session.slot) === session.box ? session : null;
}
function sync(player, box) {
    player.getPacketSender().sendInventory(core.CacheDefinitions.getInventoryId("seed_box"), SLOTS,
        slotsOf(box).map(([id, amount]) => ({ id, amount })));
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
    sender.sendInterfaceScript(INTERFACE_INV_INIT, [layer, core.CacheDefinitions.getInventoryId("seed_box"), 2, 3, 0, -1,
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
    const slots = slotsOf(session.box);
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
    stored[id] -= amount;
    if (!stored[id]) delete stored[id];
    session.box.setMetaValue(STORED_META, stored);
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
function logout({ player }) { SESSIONS.delete(player); }
Object.assign(module.exports, { open, click, closed, logout });
