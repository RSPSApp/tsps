/**
 * Justine's stuff for the Last Shopper Standing (interface 645), as captured:
 * - Justine's Trade opens it (the generic shop 1449 bound to her in shops.json gives way); with
 *   no win yet she first explains the win requirement for tradeable rewards;
 * - the stock and prices arrive as an inventory (422: each slot's count is its price), the points
 *   on varp 261 and the wins on varp 262, which the client draws the list from;
 * - the confirm button's sub is the slot; set rewards ask "How many sets of 50 would you like?
 *   (0 - 13)", and a purchase takes the points (varp 261 13 -> 12), adds the items, plays sound
 *   2304 and reopens the shop.
 * Wiki: tradeable rewards need a win. Inferred: a single reward is bought one at a time.
 */
const Common = require("./Common.LastManStanding");

const SHOP_ID = 1449;
const OP1 = 1 << 1;
/** The most of one item a stack holds. */
const MAX_STACK = 2147483647;
const JUSTINE_HEAD = "br_reward_shopkeeper";
const COLLECTION_LOG_CATEGORY = "Last Man Standing";

function wins(player) {
  return Common.number(player, Common.ATTRIBUTES.wins);
}

function stockOf() {
  return Common.data.shop.stock;
}

function sendStock(player) {
  const { shop } = Common.data;
  const items = stockOf().map((entry) => (entry ? { id: Common.objId(entry[0]), amount: entry[1] } : null));
  player.getPacketSender().sendInventory(Common.core.CacheDefinitions.getInventoryId(shop.inventory), items.length, items);
  Common.varp(player, shop.pointsVarp, Common.points(player));
  Common.varp(player, shop.winsVarp, wins(player));
}

function open(player) {
  const sender = player.getPacketSender();
  sendStock(player);
  sender.sendInterfaceScript(2524, [-1, -1]);
  sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.interfaceId("br_reward_shop"), 0);
  sender.sendInterfaceFlagsRange(Common.component("br_reward_shop:confirm"), 0, stockOf().length - 1, OP1);
}

/** Justine's Trade: the recorded shop, after her line for a player with no win. */
function canShop(event) {
  if (event.shopId !== SHOP_ID || !event.player) return;
  event.allow = false;
  const player = event.player;
  if (wins(player) > 0) {
    open(player);
    return;
  }
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder();
  chain.add(new NpcDialogue(0, Common.npcId(JUSTINE_HEAD), Common.message("needWin"), "Justine"));
  chain.add(new ActionDialogue(1, { execute: () => { player.getDialogueManager().reset(); open(player); } }));
  player.getDialogueManager().startDialogues(chain);
}

function buy(player, entry, count) {
  const [name, price, set = 1] = entry;
  const id = Common.objId(name);
  const cost = price * count;
  if (count <= 0 || id == null || Common.points(player) < cost) return;
  const amount = count * set;
  const inventory = player.getInventory();
  const stackable = Common.core.ItemDefinition.forId(id)?.isStackable() === true;
  // A stack takes the whole purchase or none of it: points are only taken if it all fits.
  const room = stackable
    ? amount <= MAX_STACK - inventory.getAmount(id) && (inventory.contains(id) || inventory.getFreeSlots() > 0)
    : inventory.getFreeSlots() >= amount;
  if (!room) {
    player.sendMessage(Common.message("noRoom"));
    return;
  }
  Common.add(player, Common.POINTS_ATTRIBUTE, -cost);
  if (stackable) inventory.add(new Common.core.Item(id, amount), false);
  else for (let i = 0; i < amount; i++) inventory.add(new Common.core.Item(id, 1), false);
  inventory.refreshItems();
  Common.api.emitCustomEvent("collection-log:obtain", { player, itemId: id, amount, category: COLLECTION_LOG_CATEGORY });
  player.getPacketSender().sendSound(Common.data.sounds.bought, 100, 0);
}

function confirm({ player, slot }) {
  const entry = stockOf()[slot];
  if (!entry) return true;
  const [name, price, set] = entry;
  const id = Common.objId(name);
  if (wins(player) <= 0 && Common.core.ItemDefinition.forId(id)?.isTradeable() === true) {
    player.sendMessage(Common.message("tradeableNeedsWin"));
    return true;
  }
  const max = Math.floor(Common.points(player) / price);
  if (max < 1) return true;
  if (!set) {
    buy(player, entry, 1);
    open(player);
    return true;
  }
  player.setEnteredAmountAction({
    execute: (amount) => {
      buy(player, entry, Math.min(max, Math.max(0, Math.floor(Number(amount) || 0))));
      open(player);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(Common.message("sets", { set, max }));
  return true;
}

function attachRewards(api) {
  api.onCanShop(canShop);
  api.onInterfaceActionButton(Common.component("br_reward_shop:confirm"), confirm);
}

module.exports = { attachRewards, open, confirm, buy, canShop, SHOP_ID };
