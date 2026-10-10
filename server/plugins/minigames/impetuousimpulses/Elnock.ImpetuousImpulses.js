"use strict";

/**
 * Elnock Inquisitor (npc 5734) in Puro-Puro: the once-per-account equipment gift (butterfly
 * net, 7 impling jars, an impling scroll) on Talk-to, then his Wiki transcript, and the four
 * jar exchanges from Impetuous Impulses
 * (https://oldschool.runescape.wiki/w/Impetuous_Impulses#Elnock's_Exchange).
 *
 * Trade opens Elnock's Exchange (interface 540), as rsprox captures (rev 237) show: the four
 * offers are shop_frame (540:4) slots 0, 3, 6 and 9, a click sets varbit ii_elnex (3729) to
 * slot / 3 + 1, and Confirm (540:7) trades the selected one, or says "You don't have the
 * required implings in jars to trade for this.". The cache's enum 2752 lists the offers in
 * that order, each struct paying with any one of three jar stacks (3, 2 or 1 of rising
 * implings); the fourth takes one jar of any impling. His Exchange option opens his impling
 * storage (interfaces 661/681), which tsps does not have, so it is left unhandled.
 */
const GIFT_ATTRIBUTE = "impetuous-impulses:gift-claimed";

const EXCHANGE_INTERFACE = 540;
const SHOP_FRAME_UID = (EXCHANGE_INTERFACE << 16) | 4;
const CONFIRM_UID = (EXCHANGE_INTERFACE << 16) | 7;
const SELECTED_VARBIT = 3729;
const OP1 = 1 << 1;
/** Enum 2752's offers, by ii_elnex value. */
const OFFERS = Object.freeze(["repellent", "net", "generator", "jars"]);
const MISSING_JARS_MESSAGE = "You don't have the required implings in jars to trade for this.";
/** Session-only: which offer the open Exchange has selected (ii_elnex). */
const SELECTED_ATTRIBUTE = "impetuous-impulses:elnex";

let core;
let trades;
let jarIds;

function build(coreApi) {
  const I = coreApi.ItemIdentifiers;
  jarIds = [I.BABY_IMPLING_JAR, I.YOUNG_IMPLING_JAR, I.GOURMET_IMPLING_JAR, I.EARTH_IMPLING_JAR,
    I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR, I.MAGPIE_IMPLING_JAR,
    I.NINJA_IMPLING_JAR, I.DRAGON_IMPLING_JAR, I.LUCKY_IMPLING_JAR, I.CRYSTAL_IMPLING_JAR];
  trades = {
    jars: {
      give: [I.IMPLING_JAR, 3],
      message: "Elnock takes the impling and gives you three impling jars.",
    },
    // Each `pay` lists alternatives (structs 1240-1242: params 901-903 items, 907-909 counts).
    repellent: {
      pay: [[I.BABY_IMPLING_JAR, 3], [I.YOUNG_IMPLING_JAR, 2], [I.GOURMET_IMPLING_JAR, 1]],
      give: [I.IMP_REPELLENT, 1],
      message: "Elnock takes the impling jars and gives you some imp repellent.",
    },
    net: {
      pay: [[I.GOURMET_IMPLING_JAR, 3], [I.EARTH_IMPLING_JAR, 2], [I.ESSENCE_IMPLING_JAR, 1]],
      give: [I.MAGIC_BUTTERFLY_NET, 1],
      message: "Elnock takes the impling jars and gives you a magic butterfly net.",
    },
    generator: {
      pay: [[I.ESSENCE_IMPLING_JAR, 3], [I.ECLECTIC_IMPLING_JAR, 2], [I.NATURE_IMPLING_JAR, 1]],
      give: [I.JAR_GENERATOR, 1],
      message: "Elnock takes the impling jars and gives you a jar generator.",
    },
  };
}

function init(api) {
  core = api.core;
  build(core);
}

/** The first of the offer's jar stacks the player holds in full (any one jar for "jars"). */
function paymentFor(player, recipe) {
  const options = recipe.pay ?? jarIds.map((id) => [id, 1]);
  return options.find(([id, amount]) => player.getInventory().getAmount(id) >= amount) ?? null;
}

/** Preflight the whole exchange, then consume and give; never a partial trade. */
function trade(player, key) {
  const recipe = trades[key];
  if (!recipe) return false;
  const payment = paymentFor(player, recipe);
  if (!payment) {
    player.sendMessage(MISSING_JARS_MESSAGE);
    return false;
  }
  const [id, amount] = payment;
  // Filled jars do not stack: paying frees a slot per jar.
  if (player.getInventory().getFreeSlots() + amount < recipe.give[1]) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  player.getInventory().deleteNumber(id, amount);
  player.getInventory().adds(recipe.give[0], recipe.give[1]);
  player.sendMessage(recipe.message);
  return true;
}

function gift(player) {
  const I = core.ItemIdentifiers;
  if (player.getAttribute(GIFT_ATTRIBUTE)) {
    player.sendMessage("Elnock has no more equipment to spare.");
    return false;
  }
  const items = [[I.BUTTERFLY_NET, 1], [I.IMPLING_JAR, 7], [I.IMPLING_SCROLL, 1]];
  const needed = items.reduce((sum, [, amount]) => sum + amount, 0);
  if (player.getInventory().getFreeSlots() < needed) {
    player.sendMessage("You need more free inventory space for Elnock's equipment.");
    return false;
  }
  for (const [id, amount] of items) player.getInventory().adds(id, amount);
  player.setAttribute(GIFT_ATTRIBUTE, true);
  player.sendMessage("Elnock Inquisitor gives you a butterfly net, 7 impling jars and an impling scroll.");
  return true;
}

/** The gift once; after that his transcript plays. */
function talk({ player }) {
  if (player.getAttribute(GIFT_ATTRIBUTE)) return false;
  gift(player);
  return true;
}

/** Trade: Elnock's Exchange with nothing selected, as captured. */
function openExchange({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(SELECTED_VARBIT, 0);
  sender.sendInterface(EXCHANGE_INTERFACE);
  for (let slot = 0; slot < OFFERS.length * 3; slot += 3) sender.sendInterfaceFlagsRange(SHOP_FRAME_UID, slot, slot, OP1);
  sender.sendInterfaceFlagsRange(CONFIRM_UID, 9, 9, OP1);
  player.setAttribute(SELECTED_ATTRIBUTE, 0);
}

function selectOffer({ player, slot }) {
  if (!Number.isInteger(slot) || slot % 3 !== 0 || slot / 3 >= OFFERS.length) return;
  const selected = slot / 3 + 1;
  player.setAttribute(SELECTED_ATTRIBUTE, selected);
  player.getPacketSender().sendVarbit(SELECTED_VARBIT, selected);
}

function confirmOffer({ player }) {
  const key = OFFERS[(player.getAttribute(SELECTED_ATTRIBUTE) ?? 0) - 1];
  if (key) trade(player, key);
}

function registerElnock(api) {
  init(api);
  api.persistAttribute(GIFT_ATTRIBUTE);
  api.onNpcInteraction("Elnock Inquisitor", { "Talk-to": talk, Trade: openExchange });
  api.onInterfaceActionButton(SHOP_FRAME_UID, selectOffer);
  api.onInterfaceActionButton(CONFIRM_UID, confirmOffer);
}

module.exports = registerElnock;
Object.assign(module.exports, {
  init, gift, trade, GIFT_ATTRIBUTE,
  _test: { init, gift, trade, talk, openExchange, selectOffer, confirmOffer, OFFERS, SELECTED_VARBIT, MISSING_JARS_MESSAGE },
});
