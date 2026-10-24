/**
 * The Rewards Guardian's shop (Wiki: Rewards_Guardian_(Mage_Training_Arena),
 * Transcript:Rewards_Guardian_(Mage_Training_Arena), Template:Mage_Training_Arena_Shop_stock):
 * - Trade-with, or "Can I trade my Pizazz Points please?" in his transcript, opens the cache's own
 *   shop interface; its clientscripts lay out the stock (enum 2753) and every price in all four
 *   point types (one enum each), reading the player's points from varps 261-264;
 * - Select picks a reward (the server sets the selection varbit; the client resets the quantity to
 *   1), 1 / 5 / 10 / 28 the quantity (the fourth button's own value, client script 2930), Confirm
 *   buys it if every type of point covers it - only while the shop is open;
 * - the wands are upgrades: each needs the tier before it (enum 2759), carried or wielded, and
 *   takes it; Bones to Peaches is a one-time unlock (Magic 60); the rune pouch only for a player
 *   who has none;
 * - until the Entrance Guardian has given the player a hat, the guardian sends them to him.
 */
const Common = require("./Common.MageTrainingArena");

const { PEACHES_UNLOCKED_ATTRIBUTE } = Common;
const MAIN_MODAL = (161 << 16) | 16;
const MODAL = 0;
const SELECT_OP = 1 << 1;
const EXAMINE_OP = 1 << 2;
const NO_HAT_VARIANT = "if-entrance-guardian-hasn-t-been-spoken-to";
/** The selection varbit's "nothing selected" (client script 3262: "Select a reward"). */
const NOTHING_SELECTED = 63;

const choices = new Map();

/** The stock in the interface's order (its slots). */
function stock() {
  return [...Common.core.CacheDefinitions.getEnumValues(Common.data.shop.stockEnum).entries()]
    .sort(([a], [b]) => a - b)
    .map(([, itemId]) => Number(itemId));
}

/** An item's price in each point type. */
function price(itemId) {
  const out = {};
  for (const [type, enumId] of Object.entries(Common.data.shop.priceEnums)) {
    out[type] = Number(Common.core.CacheDefinitions.getEnumValues(enumId).get(itemId)) || 0;
  }
  return out;
}

function previousWand(itemId) {
  const value = Common.core.CacheDefinitions.getEnumValues(Common.data.shop.previousWandEnum).get(itemId);
  return value === undefined ? null : Number(value);
}

function sendPoints(player) {
  const sender = player.getPacketSender();
  for (const [type, varp] of Object.entries(Common.data.shop.pointVarps)) sender.sendConfig(varp, Common.points(player, type));
}

function open(player) {
  const { interfaces, components, varbits } = Common.ids;
  choices.set(player, { slot: -1, quantity: 1 });
  sendPoints(player);
  const sender = player.getPacketSender();
  sender.sendConfig(Common.data.shop.quantityVarp, 1);
  sender.sendVarbit(varbits.shopSelection, NOTHING_SELECTED);
  sender.sendSubInterface(MAIN_MODAL, interfaces.shop, MODAL);
  sender.sendInterfaceFlagsRange(components.shopRewards, 0, stock().length - 1, SELECT_OP | EXAMINE_OP);
}

// --- The guardian

function isRewardsGuardian(npcId) {
  return npcId === Common.ids.npcs.rewardsGuardian;
}

function variant(context) {
  if (!isRewardsGuardian(context.npcId)) return null;
  return context.player.getAttribute(Common.HAT_GIVEN_ATTRIBUTE) === true ? null : NO_HAT_VARIANT;
}

/** "Magic Training Arena Shop interface opens." in his transcript. */
function action(event) {
  if (!isRewardsGuardian(event.npcId) || event.action !== "open_interface") return;
  event.handled = true;
  open(event.player);
}

function tradeWith({ player, npc }) {
  if (!isRewardsGuardian(npc?.getId?.())) return false;
  if (player.getAttribute(Common.HAT_GIVEN_ATTRIBUTE) !== true) {
    player.sendMessage(Common.message("rewardsNoHat"));
    return true;
  }
  open(player);
  return true;
}

// --- The interface

function shopOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen?.(Common.ids.interfaces.shop) === true;
}

/** The client draws the chosen reward from the selection varbit, and resets the quantity to 1. */
function select({ player, slot }) {
  if (!shopOpen(player) || !Number.isInteger(slot) || slot < 0 || slot >= stock().length) return true;
  choices.set(player, { slot, quantity: 1 });
  player.getPacketSender().sendVarbit(Common.ids.varbits.shopSelection, slot);
  return true;
}

function quantity(amount) {
  return ({ player }) => {
    if (!shopOpen(player)) return true;
    const choice = choices.get(player) ?? { slot: -1, quantity: 1 };
    choice.quantity = amount;
    choices.set(player, choice);
    return true;
  };
}

/** How many the points (and, for a wand, the previous tiers carried) pay for. */
function affordable(player, itemId) {
  const cost = price(itemId);
  let most = Infinity;
  for (const [type, each] of Object.entries(cost)) {
    if (each > 0) most = Math.min(most, Math.floor(Common.points(player, type) / each));
  }
  return most === Infinity ? 0 : most;
}

function wandsCarried(player, wandId) {
  const { Equipment } = Common.core;
  const weapon = player.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT);
  return player.getInventory().getAmount(wandId) + (weapon?.getId?.() === wandId ? 1 : 0);
}

/** Any rune pouch: the ordinary, divine and Trouver-locked ones (Wiki: "does not already own a pouch"). */
function ownsRunePouch(player) {
  const { items } = Common.ids;
  const pouches = [items.runePouch, items.runePouchLocked, items.divinePouch, items.divinePouchLocked];
  if (pouches.some((id) => player.getInventory().contains(id))) return true;
  const searchTab = Common.core.Bank?.BANK_SEARCH_TAB_INDEX;
  return (player.getBanks?.() ?? []).some((bank, tab) => tab !== searchTab && pouches.some((id) => bank?.contains?.(id)));
}

/** Takes one of the previous wand, from the pack first, then the hand. */
function takeWand(player, wandId) {
  if (player.getInventory().contains(wandId)) {
    player.getInventory().deleteNumber(wandId, 1);
    return;
  }
  const { Equipment, Item, Flag, WeaponInterfaceManager } = Common.core;
  const equipment = player.getEquipment();
  equipment.set(Equipment.WEAPON_SLOT, new Item(-1));
  equipment.refreshItems?.();
  WeaponInterfaceManager?.assign?.(player);
  player.getUpdateFlag?.()?.flag?.(Flag?.APPEARANCE);
}

/** Buys `requested` of the stock's slot; returns how many were bought. */
function buy(player, slot, requested) {
  const itemId = stock()[slot];
  if (!Number.isInteger(itemId) || itemId < 0) {
    player.sendMessage(Common.message("shopNothingSelected"));
    return 0;
  }
  const { items } = Common.ids;
  const cost = price(itemId);
  let amount = Math.min(requested, affordable(player, itemId));
  if (amount <= 0) {
    player.sendMessage(Common.message("shopTooPoor"));
    return 0;
  }
  if (itemId === items.peachSpell) {
    if (player.getAttribute(PEACHES_UNLOCKED_ATTRIBUTE) === true) {
      player.sendMessage(Common.message("shopAlreadyUnlocked"));
      return 0;
    }
    if (player.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC) < Common.data.shop.peachesLevel) {
      player.sendMessage(Common.message("shopPeachesLevel"));
      return 0;
    }
    amount = 1;
  } else if (itemId === items.runePouch) {
    if (ownsRunePouch(player)) {
      player.sendMessage(Common.message("shopHavePouch"));
      return 0;
    }
    amount = 1;
  }
  const previous = previousWand(itemId);
  if (previous !== null) {
    amount = Math.min(amount, wandsCarried(player, previous));
    if (amount <= 0) {
      player.sendMessage(Common.message("shopNeedWand", { wand: Common.core.ItemDefinition.forId(previous).getName() }));
      return 0;
    }
  }
  const inventory = player.getInventory();
  const stackable = Common.core.ItemDefinition.forId(itemId).isStackable();
  if (itemId !== items.peachSpell) {
    // Upgrading frees each old wand's slot as the new one takes it.
    const room = stackable ? (inventory.contains(itemId) || inventory.getFreeSlots() > 0 ? amount : 0) : inventory.getFreeSlots() + (previous !== null ? Math.min(amount, inventory.getAmount(previous)) : 0);
    amount = Math.min(amount, room);
    if (amount <= 0) {
      player.sendMessage(Common.message("shopNoRoom"));
      return 0;
    }
  }
  for (const [type, each] of Object.entries(cost)) if (each > 0) Common.addPoints(player, type, -each * amount);
  if (itemId === items.peachSpell) {
    player.setAttribute(PEACHES_UNLOCKED_ATTRIBUTE, true);
    player.sendMessage(Common.message("shopUnlocked"));
  } else {
    for (let i = 0; i < amount; i++) if (previous !== null) takeWand(player, previous);
    inventory.adds(itemId, amount);
  }
  sendPoints(player);
  return amount;
}

function confirm({ player }) {
  const choice = choices.get(player);
  if (!choice || !shopOpen(player)) return true;
  buy(player, choice.slot, choice.quantity);
  return true;
}

function examine({ player, slot }) {
  const itemId = stock()[slot];
  if (!Number.isInteger(itemId)) return true;
  player.sendMessage(Common.core.ItemDefinition.forId(itemId).getExamine?.() ?? Common.core.ItemDefinition.forId(itemId).getName());
  return true;
}

/** Select (op 1) or Examine (op 2) on a reward. */
function rewardClicked(event) {
  return (event.opId ?? event.action) === 2 ? examine(event) : select(event);
}

/** ::pizazz <type> <amount>: set a type of Pizazz Points, for testing the shop. */
function setPoints({ player, parts }) {
  const type = String(parts?.[1] ?? "").toLowerCase();
  const amount = Number(parts?.[2]);
  if (!Common.POINT_TYPES.includes(type) || !Number.isInteger(amount) || amount < 0) {
    player.sendMessage(`Usage: ::pizazz <${Common.POINT_TYPES.join("|")}> <amount>`);
    return;
  }
  Common.addPoints(player, type, amount - Common.points(player, type));
  player.sendMessage(`You now have ${Common.points(player, type)} ${type} Pizazz Points.`);
}

function forget({ player }) {
  choices.delete(player);
}

function attach(api) {
  const { components } = Common.ids;
  api.onNpcDialogueVariant(variant);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onNpcInteraction("Rewards Guardian", { "Trade-with": tradeWith });
  api.onInterfaceActionButton(components.shopRewards, rewardClicked);
  api.onInterfaceActionButton(components.shopConfirm, confirm);
  api.onInterfaceActionButton(components.shopMake1, quantity(1));
  api.onInterfaceActionButton(components.shopMake5, quantity(5));
  api.onInterfaceActionButton(components.shopMake10, quantity(10));
  api.onInterfaceActionButton(components.shopMakeAll, quantity(Common.data.shop.mostAtOnce));
  api.onPlayerLogout(forget);
  api.registerCommand("pizazz", setPoints, api.core.PlayerRights.DEVELOPER, "Set Mage Training Arena points: ::pizazz <type> <amount>");
}

module.exports = {
  attach, stock, price, previousWand, open, variant, action, tradeWith, select, quantity, affordable, buy, confirm,
  rewardClicked, setPoints, choices, NO_HAT_VARIANT,
};
