/**
 * Dom Onion's Reward Shop, the rewards chest's Search (rsprox 234/03279 [19576]-[19584]; the cache's
 * scripts 248, 302-306 and 275; nightmare-zone.json `rewards`):
 * - the chest opens nzone_rewards (206) with inv 464 (Resources and Benefits, count = points) and
 *   inv 108 (imbue prices, count = points / 1000); the client draws the tabs and the points (varp
 *   nzone_rewardpoints) itself;
 * - Resources (enum 709, sub = 2 x index) and Benefits (enum 814, sub = 3 x index): Buy-1, Buy-5,
 *   Buy-10, Buy-50, Buy-X, Examine; Benefits go into the barrels (Potions.NightmareZone), up to 255
 *   doses; herb boxes 15 a day, not for ironmen (Wiki);
 * - Upgrades: the imbuable items carried (enum 815, sub = 2 x the backpack slot): Imbue swaps the
 *   item for its imbued form for its price (a recoloured slayer helmet costs the helmet's), or says
 *   "<item>: This item costs N points to imbue." when the points fall short (recorded with none).
 * Not recorded: a purchase, an imbue with the points for it, and every line but the price one.
 */
const Common = require("./Common.NightmareZone");
const Potions = require("./Potions.NightmareZone");

const OPS_1_TO_5_AND_10 = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 10);
const OP1_AND_10 = (1 << 1) | (1 << 10);
const CHEST = "nzone_lobby_chest";
const HERB_BOX_DAY_ATTRIBUTE = "nightmare-zone:herb-box-day";
const HERB_BOX_COUNT_ATTRIBUTE = "nightmare-zone:herb-boxes";

const rewards = () => Common.data.rewards;
const enumOf = (name) => Common.core.CacheDefinitions.getEnumValues(rewards().enums[name]);
const uid = (name) => Common.component(`${rewards().interface}:${name}`);
const today = () => Math.floor(Date.now() / 86_400_000);

/** The client's oc_uncert: a note's plain item. */
function uncert(id) {
  const item = Common.core.CacheDefinitions.getItem(id);
  return item && item.noteTemplate !== -1 && item.note > 0 ? item.note : id;
}

/** Script 275's price for an imbue: the item's own, or the slayer helmet's for its recolours. */
function imbuePrice(id) {
  const thousands = rewards().imbueThousands;
  if (thousands[id] != null) return thousands[id] * 1000;
  const item = Common.core.CacheDefinitions.getItem(id);
  if (item?.params?.get?.(rewards().slayerHelmParam) === 1 || item?.params?.[rewards().slayerHelmParam] === 1) {
    return thousands[rewards().slayerHelm] * 1000;
  }
  return null;
}

function stock() {
  const items = [];
  for (const [id, price] of Object.entries(rewards().resourcePrices)) items.push({ id: Number(id), amount: price });
  for (const [id, price] of Object.entries(rewards().benefitPrices)) items.push({ id: Number(id), amount: price });
  return items;
}

function imbueStock() {
  return Object.entries(rewards().imbueThousands).map(([id, thousands]) => ({ id: Number(id), amount: thousands }));
}

/** Recorded [19576]: the invs, the modal, the panes' ops and the side panel on the inventory. */
function open({ player }) {
  const sender = player.getPacketSender();
  const { stockInv, imbueInv, openScript, sideScript } = rewards();
  const goods = stock();
  const imbues = imbueStock();
  sender.sendInventory(stockInv, goods.length, goods);
  sender.sendInventory(imbueInv, imbues.length, imbues);
  sender.sendInterfaceScript(openScript, [-1, -1]);
  sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.core.CacheDefinitions.getInterfaceId(rewards().interface), 0);
  sender.sendInterfaceFlagsRange(uid("resources"), 0, 25, OPS_1_TO_5_AND_10);
  sender.sendInterfaceFlagsRange(uid("benefits"), 0, 10, OPS_1_TO_5_AND_10);
  sender.sendInterfaceFlagsRange(uid("upgrades"), 0, 55, OP1_AND_10);
  sender.sendInterfaceScript(sideScript, [3]);
  return true;
}

// ---------------------------------------------------------------- buying

function spend(player, points) {
  if (Common.points(player) < points) {
    player.sendMessage(Common.message("notEnoughPoints"));
    return false;
  }
  Common.addPoints(player, -points);
  return true;
}

function examine(player, id) {
  player.sendMessage(Common.core.ItemDefinition.forId(id)?.getExamine?.() ?? Common.core.CacheDefinitions.getItem(id)?.name ?? "");
}

/** A Resources or Benefits click: how many the op buys, or the X prompt. */
function buyOp(player, opId, buy) {
  const count = rewards().buyOps[String(opId)];
  if (count) return buy(count);
  if (opId === rewards().buyXOp) {
    player.setEnteredAmountAction?.({ execute: (amount) => buy(Math.max(0, Math.floor(Number(amount) || 0))) });
    player.getPacketSender().sendEnterAmountPrompt(Common.message("buyX"));
  }
  return true;
}

function herbBoxesLeft(player) {
  if (Number(player.getAttribute(HERB_BOX_DAY_ATTRIBUTE)) !== today()) {
    player.setAttribute(HERB_BOX_DAY_ATTRIBUTE, today());
    player.setAttribute(HERB_BOX_COUNT_ATTRIBUTE, 0);
  }
  return rewards().herbBoxesPerDay - (Number(player.getAttribute(HERB_BOX_COUNT_ATTRIBUTE)) || 0);
}

function buyResource(player, id, count) {
  const plain = uncert(id);
  const price = rewards().resourcePrices[String(plain)];
  if (price == null || count <= 0) return true;
  if (plain === rewards().herbBox) {
    if (isIronman(player)) {
      player.sendMessage(Common.message("herbBoxIronman"));
      return true;
    }
    const left = herbBoxesLeft(player);
    if (left <= 0) {
      player.sendMessage(Common.message("herbBoxLimit", { limit: rewards().herbBoxesPerDay }));
      return true;
    }
    count = Math.min(count, left);
  }
  const inventory = player.getInventory();
  const stacks = id !== plain || Common.core.ItemDefinition.forId(id)?.isStackable?.() === true;
  const room = stacks ? (inventory.getAmount(id) > 0 || inventory.getFreeSlots() > 0) : inventory.getFreeSlots() > 0;
  if (!room) {
    player.sendMessage(Common.message("noRoom"));
    return true;
  }
  if (!stacks) count = Math.min(count, inventory.getFreeSlots());
  if (!spend(player, price * count)) return true;
  if (stacks) inventory.add(new Common.core.Item(id, count));
  else for (let i = 0; i < count; i++) inventory.add(new Common.core.Item(id, 1));
  inventory.refreshItems?.();
  if (plain === rewards().herbBox) player.setAttribute(HERB_BOX_COUNT_ATTRIBUTE, (Number(player.getAttribute(HERB_BOX_COUNT_ATTRIBUTE)) || 0) + count);
  return true;
}

/** Benefits are doses for the barrels, not items. */
function buyBenefit(player, id, count) {
  const price = rewards().benefitPrices[String(id)];
  const potion = Common.data.potions[rewards().benefitPotions[String(id)]];
  if (price == null || !potion || count <= 0) return true;
  const room = Common.data.potions.barrelCap - Potions.stored(player, potion);
  if (room <= 0) {
    player.sendMessage(Common.message("barrelFull"));
    return true;
  }
  const doses = Math.min(count, room);
  if (!spend(player, price * doses)) return true;
  Potions.setStored(player, potion, Potions.stored(player, potion) + doses);
  return true;
}

function resources({ player, slot, opId }) {
  const id = enumOf("resources").get(Math.floor(slot / 2));
  if (id == null || slot % 2 !== 0) return true;
  if (opId === rewards().examineOp) return examine(player, uncert(id)), true;
  return buyOp(player, opId, (count) => buyResource(player, id, count));
}

function benefits({ player, slot, opId }) {
  const id = enumOf("benefits").get(Math.floor(slot / 3));
  if (id == null || slot % 3 !== 0) return true;
  if (opId === rewards().examineOp) return examine(player, id), true;
  return buyOp(player, opId, (count) => buyBenefit(player, id, count));
}

// ---------------------------------------------------------------- imbuing

/** Imbue: the backpack slot is sub / 2 (script 306); the item becomes its enum 815 form. */
function upgrades({ player, slot, opId }) {
  const at = Math.floor(slot / 2);
  const inventory = player.getInventory();
  const item = inventory.getItems()[at];
  const id = item?.getId?.();
  const imbued = id == null ? null : enumOf("imbues").get(id);
  if (imbued == null) return true;
  if (opId === rewards().examineOp) return examine(player, id), true;
  const name = Common.core.CacheDefinitions.getItem(id)?.name ?? "item";
  const price = imbuePrice(id);
  if (price == null) return true;
  if (Common.points(player) < price) {
    player.sendMessage(Common.message("imbuePrice", { name, points: Common.commas(price) }));
    return true;
  }
  Common.addPoints(player, -price);
  // The item keeps what it carries (a ring of suffering's charges, a preset's restriction).
  const meta = item.getMeta?.();
  inventory.setItem(at, new Common.core.Item(imbued, 1, meta ? { ...meta } : null));
  inventory.refreshItems?.();
  Common.api.emitCustomEvent("nightmare-zone:imbued", { player, baseItemId: id, imbuedItemId: imbued });
  player.sendMessage(Common.message("imbued", { name }));
  return true;
}

function isIronman(player) {
  const query = { player, mode: "none" };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

/** The chest's Search, for Nightmare Zone's own chest. */
function search(event) {
  if (event.object?.getId?.() !== Common.core.CacheDefinitions.getLocId(CHEST)) return false;
  return open(event);
}

function attachRewards(api) {
  api.persistAttribute(HERB_BOX_DAY_ATTRIBUTE, 0);
  api.persistAttribute(HERB_BOX_COUNT_ATTRIBUTE, 0);
  api.onObjectInteraction("Rewards chest", { Search: search });
  api.onInterfaceActionButton(uid("resources"), resources);
  api.onInterfaceActionButton(uid("benefits"), benefits);
  api.onInterfaceActionButton(uid("upgrades"), upgrades);
}

module.exports = { attachRewards, open, search, resources, benefits, upgrades, imbuePrice, uncert };
