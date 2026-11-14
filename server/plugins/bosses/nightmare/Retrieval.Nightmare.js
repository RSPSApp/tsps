/**
 * Item retrieval (Wiki): a death in The Nightmare's dream leaves what the player would drop with
 * Shura, in Phosani's with Sister Senga (whose message is as captured), returned for a flat 60,000
 * coins. Collect, or "Do you have any of my items?" in their transcripts, hands it back; an unsafe
 * death anywhere else first loses it.
 */
const Common = require("./Common.Nightmare");
const Dream = require("./Dream.Nightmare");

const COINS = 995;
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

/** A death in a dream: what would drop stays with its keeper. Elsewhere, an unsafe death loses it. */
function hold(event) {
  const { player, item } = event;
  const dream = Dream.dreamOf(player);
  if (!dream) {
    const held = heldItems(player);
    if (event.shouldDropItems && held) {
      player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, null);
      player.sendMessage(Common.data.retrieval.lost.replace("[holder]", HOLDERS[held.holder]));
    }
    return;
  }
  if (!event.dropEligible) return;
  const holder = dream.phosani ? "senga" : "shura";
  const held = heldItems(player) ?? { holder, items: [] };
  held.holder = holder;
  held.items.push([item.getId(), item.getAmount(), metaOf(item)]);
  // A new death's items are not paid for: the fee is due again, as with a gravestone's merge.
  held.paid = false;
  held.announce = true;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  event.handled = true;
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

/** The fee, then everything that fits. */
function collect(player, holder) {
  const held = heldItems(player);
  if (!held || held.holder !== holder) return false;
  const { retrieval } = Common.data;
  const inventory = player.getInventory();
  const name = HOLDERS[holder];
  if (!held.paid) {
    if (inventory.getAmount(COINS) < retrieval.fee) {
      player.sendMessage(retrieval.noFee.replace("[fee]", retrieval.fee.toLocaleString("en-GB")));
      return true;
    }
    inventory.delete(COINS, retrieval.fee);
    held.paid = true;
  }
  const { Item } = Common.core;
  const left = [];
  for (const [id, amount, meta = null] of held.items) {
    // An item with meta (charges, degradation) goes back as itself, stacking only onto the same meta.
    const copy = (n) => (meta == null ? new Item(id, n) : new Item(id, n, JSON.parse(JSON.stringify(meta))));
    // Only what fits moves (free slots, or a stack's cap): the rest stays here.
    const moved = inventory.getAddableAmount(copy(amount));
    if (moved > 0) inventory.add(copy(moved), false);
    if (moved < amount) left.push([id, amount - moved, meta]);
  }
  inventory.refreshItems?.();
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, left.length > 0 ? { holder, items: left, paid: true } : null);
  player.sendMessage((left.length > 0 ? retrieval.partial : retrieval.collected).replace("[holder]", name));
  return true;
}

function collectOption({ player, definition }) {
  const holder = holderOf(definition?.getName?.());
  if (!holder) return false;
  if (!collect(player, holder)) {
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

/** "...'s Item Retrieval Service": we hand the items back there and then. */
function openService(request) {
  if (request.action !== "open_interface" || !/Item Retrieval Service/.test(request.target ?? "")) return;
  const holder = /^Shura/.test(request.target) ? "shura" : /^Sister Senga/.test(request.target) ? "senga" : null;
  if (!holder) return;
  request.handled = true;
  request.player.getPacketSender().sendInterfaceRemoval();
  collect(request.player, holder);
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
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  api.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
  api.persistAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  api.onPlayerDeathItemDrop(hold);
  api.onNpcsInteraction(["Shura", "Sister Senga"], { Collect: collectOption });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", openService);
}

module.exports = { attachRetrieval, announce, retrievalItems, wipeForGroupIronman };
