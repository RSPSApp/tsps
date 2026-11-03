/**
 * The Lost Property shop (https://oldschool.runescape.wiki/w/Lost_Property_shop), run by Perdu
 * and Chris: it sells back quest, miniquest, diary and activity rewards, each only to a player
 * who has unlocked it. The stock, prices and traders are shops.json's; this plugin decides what
 * one player sees, from ./data/lost-property.json.
 *
 * - A row shows only once its unlock is met, and only while the player owns none of the item
 *   (inventory, worn or bank), except for the Wiki's exceptions list ("multiples"). Hidden
 *   rows take no slot, so they can't be bought.
 * - Only one of a row without multiples goes per purchase.
 * - The diary rows are display items; each sells the highest claimed tier of its diary's reward.
 * - Perdu buys nothing back.
 *
 * Not done: the Wiki's payment from the bank when the inventory holds too few coins, and items
 * kept in the player-owned house counting as owned.
 */
const DATA = require("./data/lost-property.json");

const SHOP_NAME = "Lost Property shop";
const DIARY_TIERS = ["elite", "hard", "medium", "easy"];

let pluginApi;
let core;
/** Stock item id -> its row, with ids resolved. */
let rows = null;

function itemId(name) {
  const id = core.ItemIdentifiers[name];
  if (typeof id !== "number") throw new Error(`lost-property.json: unknown item ${name}`);
  return id;
}

function rowsByItem() {
  if (rows) return rows;
  rows = new Map();
  for (const entry of DATA.items) {
    rows.set(itemId(entry.item), {
      ...entry,
      owned: (entry.owned ?? [entry.item]).map(itemId),
      tiers: entry.tiers?.map(itemId) ?? null,
      carrying: entry.carrying ? itemId(entry.carrying) : null,
    });
  }
  return rows;
}

function owns(player, ids) {
  const has = (container) => ids.some((id) => container?.contains?.(id));
  return has(player.getInventory()) || has(player.getEquipment()) ||
    player.getBanks().some((bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX && has(bank));
}

/** Answered by the quest runtime; a quest this server doesn't have is null, and keeps the row hidden. */
function questState(player, name, event, field) {
  const request = { player, name, [field]: null };
  pluginApi.emitCustomEvent(event, request);
  return request[field] === true;
}

/** The stock id of the highest diary tier this player claimed, or null. */
function claimedTier(player, row) {
  for (const tier of DIARY_TIERS) {
    const request = { player, diary: row.diary, tier, claimed: null };
    pluginApi.emitCustomEvent("diary:is-reward-claimed", request);
    if (request.claimed === true) return row.tiers[3 - DIARY_TIERS.indexOf(tier)];
  }
  return null;
}

function unlocked(player, row) {
  if (row.quest && !questState(player, row.quest, "quest:is-complete", "complete")) return false;
  if (row.questStarted && !questState(player, row.questStarted, "quest:is-started", "started")) return false;
  if (row.diary && claimedTier(player, row) === null) return false;
  if (row.mageArenaCape) {
    const request = { player, received: null };
    pluginApi.emitCustomEvent("mage-arena:cape-received", request);
    if (request.received !== true) return false;
  }
  if (row.logged) {
    const request = { player, itemId: row.owned[0], count: 0 };
    pluginApi.emitCustomEvent("collection-log:obtained", request);
    if (!(request.count > 0)) return false;
  }
  if (row.level && player.getSkillManager().getMaxLevel(core.Skill[row.level.skill]) < row.level.level) return false;
  if (row.carrying !== null && !player.getInventory().contains(row.carrying)) return false;
  return true;
}

function available(player, itemId) {
  const row = rowsByItem().get(itemId);
  if (!row || !player) return false;
  return unlocked(player, row) && (row.multiples === true || !owns(player, row.owned));
}

function stockVisible(event) {
  if (event.shopName !== SHOP_NAME) return;
  if (!available(event.player, event.itemId)) event.visible = false;
}

/** A diary row hands over the highest tier claimed. */
function delivery(event) {
  if (shopName(event.shopId) !== SHOP_NAME) return;
  const row = rowsByItem().get(event.itemId);
  if (row?.diary) event.deliverId = claimedTier(event.player, row) ?? event.deliverId;
}

function buyLimit(event) {
  if (shopName(event.shopId) !== SHOP_NAME) return;
  if (rowsByItem().get(event.itemId)?.multiples !== true) event.limit = Math.min(event.limit, 1);
}

function canSell(event) {
  if (event.shopName === SHOP_NAME) event.sellable = false;
}

function shopName(shopId) {
  return core.ShopDefinition.forId(shopId)?.getName?.() ?? null;
}

module.exports = {
  name: "LostProperty",
  register(api) {
    pluginApi = api;
    core = api.core;
    api.onCustomEvent("shop:stock-visible", stockVisible);
    api.onCustomEvent("shop:delivery", delivery);
    api.onCustomEvent("shop:buy-limit", buyLimit);
    api.onCustomEvent("shop:can-sell", canSell);
  },
  _test: { available, rowsByItem, claimedTier, setApi(value) { pluginApi = value; core = value.core; rows = null; } },
};
