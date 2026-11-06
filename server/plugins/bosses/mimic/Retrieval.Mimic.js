/** Mimic item retrieval. Strange Casket and Item Retrieval Service (OSRS Wiki): a 90,000 coin
 * fee, payable with stored coins, and loss of the stored lot on another unsafe death. The existing
 * shared 602/525 service uses the cache's Mimic states 17/18. Torfinn supplies the project
 * partial-withdrawal precedent; the precise sequence and payment-source priority are unverified. */
const Lair = require("./Lair.Mimic");
const StorageDeaths = require("../../items/storage/Events.StorageItems");
const Fees = require("../../world/gravestones/Fees.Gravestones");

const ATTR = "mimic:retrieval";
const OWNER = "mimic";
const MAX_STACK = 2147483647;
const FEE = 90000;
const INV = 525;
const SLOTS = 120;
const IF1 = { unpaid: 17, paid: 18, empty: -1 };
const MAIN_MODAL_OPEN = 2524;
const PAID_SCRIPT = 3478;
const MODAL = 0;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const MESSAGE = { cannotPay: "You do not have enough coins to retrieve your items." };

let api = null;
let core = null;
const COMPONENT = {};
const VARP = {};

function held(player) {
  const value = player.getAttribute?.(ATTR);
  return Array.isArray(value?.items) && value.items.some((entry) => entry && entry.amount > 0) ? value : null;
}

function setHeld(player, value) {
  player.setAttribute(ATTR, value && value.items.some((entry) => entry && entry.amount > 0) ? value : null);
  api.emitCustomEvent("persistence:save", { player, reason: "mimic-retrieval" });
}

/** Lost items as stacks, meta kept: two of a potion stay one entry of two, as recorded; at most 2^31-1 a stack. */
function records(items) {
  const out = [];
  for (const item of items) {
    const meta = item.getMeta?.() ?? null;
    const record = { id: item.getId(), amount: item.getAmount() };
    if (meta) record.meta = JSON.parse(JSON.stringify(meta));
    const same = out.find((r) => r.id === record.id && r.amount < MAX_STACK && JSON.stringify(r.meta ?? null) === JSON.stringify(record.meta ?? null));
    if (same) {
      const moved = Math.min(record.amount, MAX_STACK - same.amount);
      same.amount += moved;
      record.amount -= moved;
    }
    if (record.amount > 0) out.push(record);
  }
  return out;
}

/** The death-drop event is only emitted for an unsafe death, even when nothing was lost. */
function deathDrops(event) {
  const { player } = event;
  const session = Lair.sessionOf(player.getArea?.());
  if (held(player)) setHeld(player, null);
  if (!session || session.owner !== player) return;
  // The storage plugin runs later; move lost container contents along with their owner item.
  StorageDeaths.deathDrops(event);
  const lost = records([...event.items, ...event.untradeables]);
  event.items.length = 0;
  event.untradeables.length = 0;
  setHeld(player, { items: lost, paid: false });
}

// ---------------------------------------------------------------- the interface

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(COMPONENT.items >>> 16);
}

function guideValue(entries) {
  return entries.reduce((sum, { id, amount }) => sum + Math.max(0, core.ItemDefinition.forId(id).getGrandExchangeValue?.() ?? 0) * amount, 0);
}

function summary(entries) {
  const present = entries.filter(Boolean);
  const count = `Stack count: <col=ffffff>${present.length}</col><br>Guide value: <col=ffffff>${guideValue(present).toLocaleString("en-GB")}</col>`;
  return present.length > 0 ? `${count} (approximately)` : count;
}

function sendContents(player, lot) {
  const entries = lot?.items ?? [];
  const sender = player.getPacketSender();
  sender.sendInventory(INV, SLOTS, entries);
  sender.sendString(summary(entries), COMPONENT.info);
}

function open(player) {
  const lot = held(player);
  if (!lot) return false;
  const state = { player, coffer: 0 };
  api.emitCustomEvent("gravestones:state", state);
  const mode = { player, mode: null };
  api.emitCustomEvent("ironman:mode", mode);
  if (held(player) !== lot) return false;
  // The interface is shared (the Theatre of Blood's chest): whichever opened it answers its clicks.
  player.__retrievalOwner = OWNER;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP.if3, 0); // This service has no Bank-All handler.
  sender.sendConfig(VARP.if2, mode.mode === "ultimate" ? 0 : Math.max(0, state.coffer || 0));
  sender.sendConfig(VARP.if1, lot.paid ? IF1.paid : IF1.unpaid);
  sender.sendInventory(INV, SLOTS, lot.items);
  sender.sendInterfaceScript(MAIN_MODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, COMPONENT.items >>> 16, MODAL);
  // Discard-All is not implemented; do not show an action this service cannot honor.
  sender.sendInterfaceDisplayState(COMPONENT.discard, true);
  sender.sendInterfaceDisplayState(COMPONENT.discardGfx, true);
  sender.sendInterfaceFlagsRange(COMPONENT.items, 0, SLOTS - 1, EVENTS);
  sender.sendString(summary(lot.items), COMPONENT.info);
}

/**
 * The coffer pays first, including a partial balance; the shared fee service then chooses an
 * inventory or bank balance covering the rest, with stored coins as the last fallback. UIMs use
 * only carried or stored coins. The priority of the non-coffer sources is a TSPS choice.
 */
function pay(player, lot) {
  const state = { player, coffer: 0, ironman: null };
  api.emitCustomEvent("gravestones:state", state);
  const mode = { player, mode: null };
  api.emitCustomEvent("ironman:mode", mode);
  const active = () => held(player) === lot && !lot.paid && player.__retrievalOwner === OWNER && isOpen(player);
  if (!active()) return false;
  const ultimate = mode.mode === "ultimate";
  const coffer = ultimate ? 0 : Math.min(FEE, Math.max(0, state.coffer || 0));
  const remainder = FEE - coffer;
  const coins = core.ItemIdentifiers.COINS;
  const tab = ultimate ? null : core.Bank.getTabForItem(player, coins);
  const bank = tab == null || tab < 0 ? null : player.getBank(tab);
  const inventory = player.getInventory();
  const heldCoins = () => lot.items.filter((entry) => entry && entry.id === coins).reduce((sum, entry) => sum + entry.amount, 0);
  const hasExternal = inventory.getAmount(coins) >= remainder || (bank && bank.getAmount(coins) >= remainder);
  if (remainder > 0 && !hasExternal && heldCoins() < remainder) {
    player.sendMessage(MESSAGE.cannotPay);
    return false;
  }
  const debits = [];
  const messages = [];
  let paymentFailed = false;
  const undo = () => {
    while (debits.length > 0) {
      const debit = debits.pop();
      if (debit.source === "coffer") {
        const refund = { player, amount: debit.amount, ok: false };
        api.emitCustomEvent("gravestones:coffer-adjust", refund);
        if (!refund.ok) throw new Error("Mimic retrieval could not restore a coffer payment");
      }
      else {
        const container = debit.source === "bank" ? bank : inventory;
        const before = container.getAmount(coins);
        container.add(new core.Item(coins, debit.amount), false);
        if (container.getAmount(coins) - before !== debit.amount) throw new Error("Mimic retrieval could not restore a coin payment");
        container.refreshItems();
      }
    }
  };
  const sharedPay = (amount) => {
    const beforeState = { player, coffer: 0 };
    api.emitCustomEvent("gravestones:state", beforeState);
    if (!active()) return null;
    const before = { coffer: beforeState.coffer, inventory: inventory.getAmount(coins), bank: bank?.getAmount(coins) ?? 0 };
    const request = { player, amount, office: false, source: null, message: null };
    api.emitCustomEvent("gravestones:pay-fee", request);
    if (request.source) {
      const afterState = { player, coffer: 0 };
      api.emitCustomEvent("gravestones:state", afterState);
      const after = { coffer: afterState.coffer, inventory: inventory.getAmount(coins), bank: bank?.getAmount(coins) ?? 0 };
      const taken = before[request.source] - after[request.source];
      if (taken > 0) debits.push({ source: request.source, amount: taken });
      if (taken !== amount) { paymentFailed = true; undo(); return null; }
      if (request.message) messages.push(request.message);
    }
    return request.source;
  };
  if (coffer > 0 && (!active() || sharedPay(coffer) !== "coffer")) {
    undo();
    return false;
  }
  if (!active()) { undo(); return false; }
  let external = false;
  if (remainder > 0 && ultimate && inventory.getAmount(coins) >= remainder) {
    const original = inventory.getItems().map(item => item?.clone?.() ?? item);
    const before = inventory.getAmount(coins);
    inventory.deleteNumber(coins, remainder);
    external = before - inventory.getAmount(coins) === remainder;
    if (!external) {
      original.forEach((item, slot) => inventory.setItem(slot, item));
      undo();
      return false;
    }
    if (external) {
      debits.push({ source: "inventory", amount: remainder });
      messages.push(Fees.paymentMessage("inventory", remainder));
      inventory.refreshItems();
    }
  } else if (remainder > 0 && !ultimate) {
    external = !!sharedPay(remainder);
  }
  if (paymentFailed || !active() || (remainder > 0 && !external && heldCoins() < remainder)) {
    undo();
    return false;
  }
  const next = { ...lot, items: lot.items.map((entry) => entry ? { ...entry } : null), paid: true };
  if (remainder > 0 && !external) {
    let due = remainder;
    for (const entry of next.items) {
      if (!entry || entry.id !== coins || due <= 0) continue;
      const taken = Math.min(entry.amount, due);
      entry.amount -= taken;
      due -= taken;
    }
    if (due !== 0) { undo(); return false; }
    next.items = next.items.map((entry) => entry && entry.amount > 0 ? entry : null);
    messages.push(`Payment has been taken from your stored items: ${remainder.toLocaleString("en-GB")} x Coins`);
  }
  setHeld(player, next);
  for (const message of messages) player.sendMessage(message);
  const after = { player, coffer: 0 };
  api.emitCustomEvent("gravestones:state", after);
  const empty = !next.items.some(entry => entry && entry.amount > 0);
  if ((held(player) !== next && !(empty && !held(player))) || player.__retrievalOwner !== OWNER || !isOpen(player)) return true;
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.if1, held(player) ? IF1.paid : IF1.empty);
  sendContents(player, next);
  sender.sendConfig(VARP.if2, ultimate ? 0 : Math.max(0, after.coffer || 0));
  sender.sendInterfaceScript(PAID_SCRIPT, [FEE, ultimate ? 0 : Math.max(0, after.coffer || 0)]);
  return true;
}

/** Moves as much of `entry` as fits; returns whether any moved. */
function takeEntry(player, entry) {
  const inventory = player.getInventory();
  const item = new core.Item(entry.id, entry.amount, entry.meta ?? null);
  const count = Math.min(entry.amount, inventory.getAddableAmount(item));
  if (count <= 0) return false;
  inventory.add(new core.Item(entry.id, count, entry.meta ?? null), false);
  entry.amount -= count;
  return true;
}

function finishTaking(player, lot) {
  player.getInventory().refreshItems?.();
  // Preserve slot identity across queued client clicks, including same-id items with different metadata.
  lot.items = lot.items.map((entry) => entry && entry.amount > 0 ? entry : null);
  setHeld(player, lot);
  if (!held(player)) player.getPacketSender().sendConfig(VARP.if1, IF1.empty);
  sendContents(player, lot);
}

function takeAll(player, lot) {
  for (const entry of lot.items) if (entry) takeEntry(player, entry);
  finishTaking(player, lot);
}

function button({ player }) {
  if (player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return false;
  const lot = held(player);
  if (!lot) return false;
  if (!lot.paid) pay(player, lot);
  else takeAll(player, lot);
}

function clickItem(event) {
  const { player } = event;
  if (player.__retrievalOwner !== OWNER) return false;
  if (!isOpen(player)) return false;
  const lot = held(player);
  const entry = lot?.items[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry || (event.itemId != null && event.itemId > 0 && event.itemId !== entry.id)) return;
  const op = event.opId ?? event.action;
  if (op === EXAMINE_OP) {
    player.sendMessage(core.ItemDefinition.forId(entry.id).getExamine());
    return;
  }
  if (op !== TAKE_OP) return;
  if (!lot.paid) {
    pay(player, lot);
    return;
  }
  takeEntry(player, entry);
  finishTaking(player, lot);
}

/** Generic read-only view for clue capacity and other retrieval consumers. */
function retrievalItems(request) {
  for (const entry of held(request.player)?.items ?? []) if (entry) request.items.push({ itemId: entry.id, amount: entry.amount });
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const { CacheDefinitions } = core;
  COMPONENT.items = CacheDefinitions.getComponentId("gravestone_retrieval:items");
  COMPONENT.button = CacheDefinitions.getComponentId("gravestone_retrieval:button");
  COMPONENT.discard = CacheDefinitions.getComponentId("gravestone_retrieval:discard");
  COMPONENT.discardGfx = CacheDefinitions.getComponentId("gravestone_retrieval:discard_gfx");
  COMPONENT.info = CacheDefinitions.getComponentId("gravestone_retrieval:info");
  COMPONENT.mainModal = CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
  VARP.if1 = CacheDefinitions.getVarpId("if1");
  VARP.if2 = CacheDefinitions.getVarpId("if2");
  VARP.if3 = CacheDefinitions.getVarpId("if3");
  pluginApi.persistAttribute(ATTR);
  pluginApi.onPlayerDeathDrops(deathDrops);
  pluginApi.onInterfaceActionButton(COMPONENT.button, button);
  pluginApi.onInterfaceActionButton(COMPONENT.items, clickItem);
  pluginApi.onCustomEvent("item-retrieval:items", retrievalItems);
}

module.exports = { attach, held, open, button, clickItem, deathDrops, summary, FEE, ATTR };
