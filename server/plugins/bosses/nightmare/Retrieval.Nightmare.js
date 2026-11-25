/**
 * Item retrieval (Wiki): a death in The Nightmare's dream leaves what the player would drop with
 * Shura, in Phosani's with Sister Senga (whose message is as captured), returned for a flat 60,000
 * coins through the Item Retrieval Service interface. Collect, or "Do you have any of my items?" in
 * their transcripts, opens it. Another
 * unsafe death first loses it, in a dream too (Wiki: "Any unsafe death will delete all items left
 * inside the deathbank"): a second dream death's keeper holds only that death's items.
 */
const Common = require("./Common.Nightmare");
const Dream = require("./Dream.Nightmare");

const HOLDERS = { shura: "Shura", senga: "Sister Senga" };

const heldItems = (player) => {
  const held = player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  return held && Array.isArray(held.items) && held.items.length > 0 ? held : null;
};

function retrievalItems(request) {
  for (const [itemId, amount] of heldItems(request.player)?.items ?? []) request.items.push({itemId, amount});
}

/** An item's meta (charges, degradation) as the save keeps it, or null. */
function metaOf(item) {
  const meta = item.getMeta?.();
  return meta == null ? null : JSON.parse(JSON.stringify(meta));
}

/**
 * player -> the death (its position object, one per PlayerDeathTask.dropItems call) whose items the keeper
 * holds now, so a death's later items join its own lot and only a new death loses the old one.
 */
const heldDeath = new WeakMap();

/** An unsafe death loses what a keeper held from an earlier death. */
function loseHeld(player, death) {
  const held = heldItems(player);
  if (!held || heldDeath.get(player) === death) return;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, null);
  player.sendMessage(Common.data.retrieval.lost.replace("[holder]", HOLDERS[held.holder]));
}

/** A death in a dream: what would drop stays with its keeper, and an earlier lot is lost. Elsewhere, an unsafe death loses it. */
function hold(event) {
  const { player, item } = event;
  if (event.shouldDropItems) loseHeld(player, event.location);
  const dream = Dream.dreamOf(player);
  if (!dream) return;
  heldDeath.set(player, event.location);
  if (!event.dropEligible) return;
  const holder = dream.phosani ? "senga" : "shura";
  const held = heldItems(player) ?? { holder, items: [] };
  held.holder = holder;
  held.items.push([item.getId(), item.getAmount(), metaOf(item)]);
  held.paid = false;
  held.announce = true;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  event.handled = true;
}

/** Once per death, also when it loses nothing: an unsafe death with no items still loses the held lot. */
function deathDrops(event) {
  loseHeld(event.player, event.location);
  if (Dream.dreamOf(event.player)) heldDeath.set(event.player, event.location);
}

/** Said once the player wakes by the Pool (Dream.Nightmare). */
function announce(player) {
  const held = heldItems(player);
  if (!held?.announce) return;
  held.announce = false;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  player.sendMessage(Common.data.retrieval.held.replace("[holder]", HOLDERS[held.holder]));
}

function holderOf(npcName) {
  return npcName === "Shura" ? "shura" : npcName === "Sister Senga" ? "senga" : null;
}

// ---------------------------------------------------------------- the Item Retrieval Service (602)

/**
 * Collect opens the shared Item Retrieval Service, as captured (rsprox 1148 5366-5370, Sister
 * Senga): gravestone_retrieval (602) over inv gravestone (525), if1 27 (unpaid; Shura's 25, cache
 * enum 1753), the items' Take/Examine events and "Stack count / Guide value". Its button first pays
 * the 60,000 coins through the shared fee contract ("Death charges you 60,000 x Coins. You have
 * nothing left in Death's Coffer.", if1 28, script 3478), then takes everything that fits; what
 * doesn't fit stays, paid. The interface and flow are Torfinn's (Retrieval.Vorkath.js).
 */
const OWNER = "nightmare";
const INV = 525;
const SLOTS = 120;
const IF1 = { shura: { unpaid: 25, paid: 26 }, senga: { unpaid: 27, paid: 28 }, empty: -1 };
const PAID_SCRIPT = 3478;
const MAIN_MODAL_OPEN = 2524;
const MODAL = 0;
const TAKE_OP = 2;
const EXAMINE_OP = 10;
const EVENTS = (1 << 2) | (1 << 9) | (1 << 10);
const CANNOT_PAY = "You don't have enough coins with you or in your bank to pay the fee.";
const COMPONENT = {};
const VARP = {};

const entriesOf = (held) => (held?.items ?? []).map(([id, amount, meta = null]) => ({ id, amount, meta }));

function save(player, holder, entries, paid) {
  const items = entries.filter((entry) => entry.amount > 0).map(({ id, amount, meta }) => [id, amount, meta ?? null]);
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, items.length > 0 ? { holder, items, paid } : null);
  return items.length;
}

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen(COMPONENT.items >>> 16);
}

function guideValue(entries) {
  const { ItemDefinition } = Common.core;
  return entries.reduce((sum, { id, amount }) => sum + Math.max(0, ItemDefinition.forId(id).getGrandExchangeValue?.() ?? 0) * amount, 0);
}

function summary(entries) {
  const count = `Stack count: <col=ffffff>${entries.length}</col><br>Guide value: <col=ffffff>${guideValue(entries).toLocaleString("en-GB")}</col>`;
  return entries.length > 0 ? `${count} (approximately)` : count;
}

function sendContents(player, entries) {
  const sender = player.getPacketSender();
  sender.sendInventory(INV, SLOTS, entries);
  sender.sendString(summary(entries), COMPONENT.discard);
}

function open(player, holder) {
  const held = heldItems(player);
  if (!held || held.holder !== holder) return false;
  const entries = entriesOf(held);
  // The interface is shared (Torfinn's, the Mimic's, the Stranger's): whichever opened it answers its clicks.
  player.__retrievalOwner = OWNER;
  player.__nightmareRetrieval = holder;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendConfig(VARP.if2, 0);
  sender.sendConfig(VARP.if1, held.paid ? IF1[holder].paid : IF1[holder].unpaid);
  sender.sendInventory(INV, SLOTS, entries);
  sender.sendInterfaceScript(MAIN_MODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(COMPONENT.mainModal, COMPONENT.items >>> 16, MODAL);
  sender.sendInterfaceFlagsRange(COMPONENT.items, 0, SLOTS - 1, EVENTS);
  sender.sendString(summary(entries), COMPONENT.discard);
  return true;
}

function pay(player, holder, entries) {
  const { fee } = Common.data.retrieval;
  const request = { player, amount: fee, office: false, source: null, message: null };
  Common.api.emitCustomEvent("gravestones:pay-fee", request);
  if (!request.source) {
    player.sendMessage(CANNOT_PAY);
    return false;
  }
  if (request.message) player.sendMessage(request.message);
  save(player, holder, entries, true);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.if1, IF1[holder].paid);
  sendContents(player, entries);
  sender.sendInterfaceScript(PAID_SCRIPT, [fee, 0]);
  return true;
}

/** Moves as much of `entry` as fits (an item with meta stacks only onto the same meta). */
function takeEntry(player, entry) {
  const { Item } = Common.core;
  const copy = (n) => new Item(entry.id, n, entry.meta == null ? null : JSON.parse(JSON.stringify(entry.meta)));
  const inventory = player.getInventory();
  const count = Math.min(entry.amount, inventory.getAddableAmount(copy(entry.amount)));
  if (count <= 0) return;
  inventory.add(copy(count), false);
  entry.amount -= count;
}

function finishTaking(player, holder, entries) {
  player.getInventory().refreshItems?.();
  const left = entries.filter((entry) => entry.amount > 0);
  if (save(player, holder, left, true) === 0) player.getPacketSender().sendConfig(VARP.if1, IF1.empty);
  sendContents(player, left);
}

function activeLot(player) {
  if (player.__retrievalOwner !== OWNER || !isOpen(player)) return null;
  const holder = player.__nightmareRetrieval;
  const held = heldItems(player);
  return held && held.holder === holder ? { holder, held, entries: entriesOf(held) } : null;
}

function button({ player }) {
  if (player.__retrievalOwner !== OWNER) return false;
  const lot = activeLot(player);
  if (!lot) return;
  if (!lot.held.paid) {
    pay(player, lot.holder, lot.entries);
    return;
  }
  for (const entry of lot.entries) takeEntry(player, entry);
  finishTaking(player, lot.holder, lot.entries);
}

function clickItem(event) {
  const { player } = event;
  if (player.__retrievalOwner !== OWNER) return false;
  const lot = activeLot(player);
  const entry = lot?.entries[Number.isInteger(event.slot) ? event.slot : -1];
  if (!entry) return;
  const op = event.opId ?? event.action;
  if (op === EXAMINE_OP) {
    Common.core.examineItem(player, entry.id, entry.amount);
    return;
  }
  if (op !== TAKE_OP) return;
  if (!lot.held.paid) {
    pay(player, lot.holder, lot.entries);
    return;
  }
  takeEntry(player, entry);
  finishTaking(player, lot.holder, lot.entries);
}

function collectOption({ player, definition }) {
  const holder = holderOf(definition?.getName?.());
  if (!holder) return false;
  if (!open(player, holder)) {
    const { DialogueChainBuilder, NpcDialogue } = Common.core;
    const line = holder === "shura"
      ? "Doesn't look like it. If I did have any of your items, but you died before collecting them, they'll now be lost."
      : "Sorry, but I don't have anything for you. If I did have any of your items, but you died before collecting them, they'll now be lost.";
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, definition.getId(), line)));
  }
  return true;
}

/** Their transcripts ask whether they hold anything for the player. */
function answerCondition({ player, definition, text }) {
  const holder = holderOf(definition?.getName?.());
  if (!holder || !/items in (Shura|Sister Senga)'s collection/.test(text ?? "")) return null;
  const has = heldItems(player)?.holder === holder;
  return /has no items/.test(text) ? !has : has;
}

/** "...'s Item Retrieval Service" in their transcripts opens it. */
function openService(request) {
  if (request.action !== "open_interface" || !/Item Retrieval Service/.test(request.target ?? "")) return;
  const holder = /^Shura/.test(request.target) ? "shura" : /^Sister Senga/.test(request.target) ? "senga" : null;
  if (!holder) return;
  request.handled = true;
  if (!open(request.player, holder)) request.player.getPacketSender().sendInterfaceRemoval();
}

/**
 * "group-ironman:wipe-tradeables" { player, lost(id, amount) }: a leaver who stays a ranked Group
 * Ironman loses what Shura or Sister Senga holds that they lose (Wiki, Group Ironman Mode: "Items in an Item
 * Retrieval Service").
 */
function wipeForGroupIronman({ player, lost }) {
  const held = heldItems(player);
  if (!held || typeof lost !== "function") return;
  const left = held.items.filter(([id, amount]) => !lost(id, amount));
  if (left.length !== held.items.length) player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, left.length > 0 ? { ...held, items: left } : null);
}

function attachRetrieval(api) {
  const { CacheDefinitions } = api.core;
  COMPONENT.items = CacheDefinitions.getComponentId("gravestone_retrieval:items");
  COMPONENT.button = CacheDefinitions.getComponentId("gravestone_retrieval:button");
  COMPONENT.discard = CacheDefinitions.getComponentId("gravestone_retrieval:discard");
  COMPONENT.mainModal = CacheDefinitions.getComponentId("toplevel_osrs_stretch:mainmodal");
  VARP.if1 = CacheDefinitions.getVarpId("if1");
  VARP.if2 = CacheDefinitions.getVarpId("if2");
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  api.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
  api.persistAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  api.onPlayerDeathItemDrop(hold);
  api.onPlayerDeathDrops(deathDrops);
  api.onNpcsInteraction(["Shura", "Sister Senga"], { Collect: collectOption });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", openService);
  api.onInterfaceActionButton(COMPONENT.button, button);
  api.onInterfaceActionButton(COMPONENT.items, clickItem);
}

module.exports = { attachRetrieval, announce, retrievalItems, wipeForGroupIronman };
