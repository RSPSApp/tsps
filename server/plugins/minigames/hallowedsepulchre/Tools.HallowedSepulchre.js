/**
 * The Mysterious Stranger's tool storage (Wiki: "Exchange" opens it; at most 1 Hallowed grapple,
 * focus, symbol, hammer and ring, and at most 1000 Hallowed tokens). Rev 227 recording 1862: opnpc5
 * opens hallowed_tools (666) as the main modal and hallowed_tool_side (632) as the side modal,
 * after script 917 [-1, -1], with OP1 on the four quantity buttons. The client draws both from
 * the hallowed_storage_* varbits ([proc,hallowed_tools_getstored]) and the inventory, and keeps the
 * selected quantity in farming_tools_selectedquantity (enum_342 shares it with the leprechaun).
 */
const Common = require("./Common.HallowedSepulchre");

const STORED_ATTRIBUTE = "hallowed:stored-tools";
const MAX_AMOUNT = 2147483647;
const MAINMODAL_BACKGROUND = 917;
/** enum_342 (unnamed in the cache): each tool's storage cap, read by both interfaces' scripts. */
const TOOL_CAPS_ENUM = 342;
const QUANTITY_BUTTONS = ["quantity_1", "quantity_5", "quantity_all", "quantity_x"];
/** Cache component name, data.items key, the hallowed_storage_* varbit and its cap (enum_342). */
const ROWS = ["token", "grapple", "focus", "symbol", "hammer", "ring"];
const sessions = new WeakMap();

const cache = () => Common.core.CacheDefinitions;
const uid = (name) => cache().getComponentId(name);
const group = (name) => cache().getInterfaceId(name);
const itemOf = (row) => Common.data.items[row];

/** enum_342: the most the Stranger keeps of each tool. */
function capOf(row) {
  for (const [id, cap] of cache().getEnumValues(TOOL_CAPS_ENUM)) if (id === itemOf(row)) return cap;
  return 0;
}

function stored(player) {
  const value = player.getAttribute(STORED_ATTRIBUTE);
  return value && typeof value === "object" ? value : {};
}

function storedAmount(player, row) {
  const amount = Number(stored(player)[row] ?? 0);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function setStored(player, row, amount) {
  const next = { ...stored(player) };
  if (amount > 0) next[row] = amount;
  else delete next[row];
  player.setAttribute(STORED_ATTRIBUTE, next);
}

function sync(player) {
  const sender = player.getPacketSender();
  for (const row of ROWS) sender.sendVarbit(cache().getVarbitId(`hallowed_storage_${row}`), storedAmount(player, row));
}

function near(player, npc) {
  return player.getHitpoints() > 0 && player.getStatus() === Common.core.PlayerStatus.NONE
    && !player.isNeedsPlacement() && !player.isTeleportingReturn() && !player.getForceMovement()
    && player.getLocation().isWithinDistance(npc.getLocation(), 5);
}

function current(player) {
  const session = sessions.get(player), sender = player.getPacketSender();
  return session && near(player, session.npc) && player.getInterfaceId() === group("hallowed_tools")
    && sender.isSubInterfaceOpen(group("hallowed_tools")) && sender.isSubInterfaceOpen(group("hallowed_tool_side")) ? session : null;
}

/** The lobby's Stranger (the Theatre of Blood has another Mysterious Stranger). */
const STRANGER_NAMES = ["hallowed_lobby_npc", "hallowed_lobby_npc_1op", "hallowed_lobby_npc_3op"];

function isStranger(npc) {
  const id = npc?.getId?.();
  return STRANGER_NAMES.some((name) => cache().getNpcId(name) === id);
}

/** Exchange on the Mysterious Stranger. */
function open({ player, npc }) {
  if (!isStranger(npc)) return false;
  if (!near(player, npc) || player.busy() && !current(player)) return true;
  sessions.set(player, { npc, selected: 0, amount: 0 });
  sync(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(cache().getVarbitId("farming_tools_selectedquantity"), 0);
  sender.sendInterfaceScript(MAINMODAL_BACKGROUND, [-1, -1]);
  player.setInterfaceId(group("hallowed_tools"));
  sender.sendInterface(group("hallowed_tools"));
  sender.sendSubInterface(uid("toplevel_osrs_stretch:sidemodal"), group("hallowed_tool_side"), 0);
  for (const name of QUANTITY_BUTTONS) sender.sendInterfaceFlagsRange(uid(`hallowed_tools:${name}`), -1, -1, 1 << 1);
  return true;
}

/** False once the inventory has no room, so Withdraw stops there with one full message. */
function withdraw(player, row, requested) {
  const inventory = player.getInventory();
  const item = new Common.core.Item(itemOf(row), Math.min(storedAmount(player, row), requested));
  if (item.getAmount() <= 0) return true;
  const amount = Math.min(item.getAmount(), inventory.getAddableAmount(item));
  if (amount <= 0) {
    inventory.full();
    return false;
  }
  inventory.add(item.setAmount(amount), true);
  setStored(player, row, storedAmount(player, row) - amount);
  sync(player);
  return true;
}

function deposit(player, row, requested) {
  const inventory = player.getInventory();
  const room = capOf(row) - storedAmount(player, row);
  const amount = Math.min(inventory.getAmount(itemOf(row)), requested, room);
  if (amount <= 0) return;
  inventory.delete(itemOf(row), amount);
  setStored(player, row, storedAmount(player, row) + amount);
  sync(player);
}

function prompt(player, session, done) {
  const action = { acceptsZero: true, execute(amount) {
    if (current(player) !== session || player.getEnteredAmountAction() !== action) return;
    player.setEnteredAmountAction(null);
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    done(Math.min(MAX_AMOUNT, amount));
  } };
  player.setEnteredAmountAction(action);
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to transfer?");
}

/** The selected quantity's op order, as [proc,hallowed_tools_main_update] / _side_update set them. */
function modeFor(session, op) {
  return [[0, 1, 3, 2], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2]][session.selected][op - 1];
}

function click(event) {
  const { player, buttonId } = event;
  const main = buttonId >>> 16 === group("hallowed_tools"), side = buttonId >>> 16 === group("hallowed_tool_side");
  if ((!main && !side) || event.handled) return;
  event.handled = true;
  const session = current(player);
  if (!session) return;
  const pin = { player, feature: "hallowed-tools", resume: () => click({ ...event, handled: false }) };
  Common.api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
  const op = event.opId ?? event.action;
  if (!Number.isInteger(op) || op < 1 || op > 10) return;
  if (main) {
    const selected = QUANTITY_BUTTONS.findIndex((name) => buttonId === uid(`hallowed_tools:${name}`));
    if (selected >= 0) {
      if (op !== 1) return;
      // QUANTITY_BUTTONS is 1, 5, All, X; the varbit counts 0 = 1, 1 = 5, 2 = All, 3 = X.
      session.selected = selected;
      player.getPacketSender().sendVarbit(cache().getVarbitId("farming_tools_selectedquantity"), selected);
      if (selected === 3) prompt(player, session, (amount) => { session.amount = amount; });
      return;
    }
  }
  const all = main ? uid("hallowed_tools:withdrawal_all") : uid("hallowed_tool_side:store_all");
  if (buttonId === all) {
    if (op !== 1) return;
    for (const row of ROWS) {
      if (main && !withdraw(player, row, MAX_AMOUNT)) break;
      if (!main) deposit(player, row, MAX_AMOUNT);
    }
    return;
  }
  const row = ROWS.find((name) => buttonId === uid((main ? "hallowed_tools:" : "hallowed_tool_side:") + name));
  if (!row) return;
  if (op === 10) {
    const examine = cache().getItem(itemOf(row)).examine;
    if (examine) player.sendMessage(examine);
    return;
  }
  if (op > 4) return;
  const single = capOf(row) <= 1;
  if (single && op !== 1) return;
  const mode = single ? 0 : modeFor(session, op);
  const transfer = (amount) => (main ? withdraw : deposit)(player, row, amount);
  if (mode === 3 && !session.amount) prompt(player, session, transfer);
  else transfer([1, 5, MAX_AMOUNT, session.amount][mode]);
}

function syncOnLogin({ player }) {
  sync(player);
}

function logout({ player }) {
  sessions.delete(player);
}

function attachTools(api) {
  api.persistAttribute(STORED_ATTRIBUTE, {});
  api.onNpcsInteraction(["Mysterious Stranger"], { Exchange: open });
  api.onInterfaceActionClick(click);
  api.onPlayerLogin(syncOnLogin);
  api.onPlayerLogout(logout);
}

module.exports = { attachTools, STORED_ATTRIBUTE, isStranger };
