/**
 * The Ancient Prison's reclaim chests (the entry room's and the safe room's).
 *
 * Wiki ("Nex/Strategies"): what a death in Nex's chamber would drop goes to the chests; reclaiming
 * it costs 100,000 coins; dying again before reclaiming loses it for good. The items kept on death
 * stay with the player as usual. Captured: the empty chest's message box. Ours: the death message,
 * the warning at the barrier, the fee from coins carried, and that everything must fit.
 */
const Common = require("./Common.Nex");

const FEE = 100000;
const COINS = 995;

/** player -> the process cycle of their last death in a chamber. */
let deathCycle = new WeakMap();

function stored(player) {
  const items = player.getAttribute(Common.RECLAIM_ATTRIBUTE);
  return Array.isArray(items) ? items : [];
}

function hasItems(player) {
  return stored(player).length > 0;
}

function inChamber(player, location) {
  const Chamber = require("./Chamber.Nex");
  const Instance = require("./Instance.Nex");
  const instance = Instance.instanceOf(player);
  if (instance) return instance.inChamber(location);
  return Chamber.arena.inChamber(location);
}

/** A death in a chamber: what would hit the floor goes to the chest instead. */
function keepDroppedItem(event) {
  const { player, item } = event;
  if (!event.shouldDropItems || !event.dropEligible) return;
  if (!inChamber(player, event.location ?? player.getLocation())) return;
  const cycle = Common.core.World.getProcessCycle();
  let items = stored(player);
  if (deathCycle.get(player) !== cycle) {
    // A new death: whatever the chest still held from the last one is gone.
    deathCycle.set(player, cycle);
    items = [];
  }
  player.setAttribute(Common.RECLAIM_ATTRIBUTE, [...items, [item.getId(), item.getAmount()]]);
  event.suppressDefaultDrop = true;
}

/** The death itself: counted for the scoreboard and the fight, and the chest's message. */
function died({ player }) {
  if (!require("./Chamber.Nex").fightFor(player) && deathCycle.get(player) !== Common.core.World.getProcessCycle()) return;
  require("./Chamber.Nex").recordDeath();
  player.setAttribute(Common.DEATHS_ATTRIBUTE, Common.count(player, Common.DEATHS_ATTRIBUTE) + 1);
  if (deathCycle.get(player) === Common.core.World.getProcessCycle() && hasItems(player)) {
    player.sendMessage("<col=ef1020>A magical chest has retrieved some of your items. You can collect them from it in the Ancient Prison.</col>");
  }
}

function slotsNeeded(player, items) {
  const { ItemDefinition } = Common.core;
  const inventory = player.getInventory();
  const counted = new Set();
  let slots = 0;
  for (const [id] of items) {
    const stackable = ItemDefinition.forId(id)?.isStackable?.();
    if (stackable && (inventory.contains(id) || counted.has(id))) continue;
    counted.add(id);
    slots++;
  }
  return slots;
}

function reclaim(player) {
  player.getPacketSender().sendInterfaceRemoval();
  const items = stored(player);
  if (items.length === 0) return;
  const inventory = player.getInventory();
  if (inventory.getAmount(COINS) < FEE) {
    player.sendMessage("You need 100,000 coins to reclaim your items.");
    return;
  }
  const needed = slotsNeeded(player, items) - (inventory.getAmount(COINS) === FEE ? 1 : 0);
  if (inventory.getFreeSlots() < needed) {
    player.sendMessage(`You need ${needed} free inventory spaces to reclaim your items.`);
    return;
  }
  inventory.delete(COINS, FEE);
  for (const [id, amount] of items) inventory.adds(id, amount);
  player.setAttribute(Common.RECLAIM_ATTRIBUTE, []);
  player.sendMessage("You reclaim your items from the chest.");
}

function claim({ player }) {
  if (!hasItems(player)) {
    Common.statement(player, "The chest seems to be empty. If it did have any of your items, but<br>you died before collecting them, they'll now be lost.");
    return true;
  }
  Common.api.sendMultiChatboxPrompt(player, "Pay 100,000 coins to reclaim your items?",
    "Yes.", () => reclaim(player),
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function attachReclaim(api) {
  api.persistAttribute(Common.RECLAIM_ATTRIBUTE, []);
  api.onPlayerDeathItemDrop(keepDroppedItem);
  api.onPlayerDeath(died);
  api.onObjectFirstClick(Common.data.objects.chest, claim);
}

module.exports = { attachReclaim, hasItems, keepDroppedItem, claim, reclaim, FEE, _reset: () => { deathCycle = new WeakMap(); } };
