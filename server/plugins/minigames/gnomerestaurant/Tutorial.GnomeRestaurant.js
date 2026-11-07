"use strict";

// Tutor progress follows the imported dialogue hand-ins; ordinary cuisine
// preparation remains available independently of this training.
const ALUFT_ATTRIBUTE = "gnome-restaurant:tutorial-aluft";
const BLURBERRY_ATTRIBUTE = "gnome-restaurant:tutorial-blurberry";
const AWARDS_ATTRIBUTE = "gnome-restaurant:tutorial-awards";
const COMPLETE = 6;

const TUTORS = {
  "Aluft Gianne snr.": {
    attribute: ALUFT_ATTRIBUTE,
    variants: ["standard-dialogue-before-completing-gnome-restaurant-training",
      "standard-dialogue-speaking-a-2nd-time", "standard-dialogue-toad-crunchy-task-dialogue",
      "standard-dialogue-chocolate-chip-crunchy-task-dialogue", "standard-dialogue-toad-batta-task-dialogue",
      "standard-dialogue-cheese-and-tomato-batta-task-dialogue", "standard-dialogue-subsequent-dialogue"],
  },
  Blurberry: {
    attribute: BLURBERRY_ATTRIBUTE,
    variants: ["standard-dialogue", "standard-dialogue-speaking-a-2nd-time",
      "standard-dialogue-fruit-blast-task-dialogue", "standard-dialogue-pineapple-punch-task-dialogue",
      "standard-dialogue-wizard-blizzard-task-dialogue", "standard-dialogue-short-green-guy-dialogue",
      "standard-dialogue-subsequent-dialogue"],
  },
};

const HAND_INS = {
  qQh71z: [ALUFT_ATTRIBUTE, 2, "toad_crunchies"], weBBbR: [ALUFT_ATTRIBUTE, 3, "chocchip_crunchies"],
  "6fok3u": [ALUFT_ATTRIBUTE, 4, "toad_batta"], "MJcf0-": [ALUFT_ATTRIBUTE, 5, "cheese+tom_batta"],
  "0S3BSj": [BLURBERRY_ATTRIBUTE, 2, "fruit_blast"], "PZC-Rl": [BLURBERRY_ATTRIBUTE, 3, "pineapple_punch"],
  Y0jIHD: [BLURBERRY_ATTRIBUTE, 4, "wizard_blizzard"], EJWVqG: [BLURBERRY_ATTRIBUTE, 5, "sgg"],
};
const NEXT_GIFT = { qQh71z: "31MVvm", weBBbR: "AMbVk6", "6fok3u": "hwbvze",
  "0S3BSj": "SXr54y", "PZC-Rl": "BxpU82", Y0jIHD: "pQSldM" };

// The action IDs and item descriptions are the imported tutor transcripts.
// Reusable spice and tools are not consumed by later recipe preparation.
const GRANTS = {
  H4Ocf4: [ALUFT_ATTRIBUTE, 0, 1, [["giannes_cook_book", 1]]],
  Cnwtxg: [ALUFT_ATTRIBUTE, 1, 2, [["toads_legs", 2], ["gnome_spice", 1], ["equa_leaves", 1], ["gianne_dough", 1], ["crunchy_tray", 1]]],
  "31MVvm": [ALUFT_ATTRIBUTE, 3, 3, [["chocolate_bar", 2], ["chocolate_dust", 1], ["gianne_dough", 1]]],
  AMbVk6: [ALUFT_ATTRIBUTE, 4, 4, [["cheese", 1], ["gianne_dough", 1], ["equa_leaves", 1], ["toads_legs", 1], ["gnome_spice", 1]]],
  hwbvze: [ALUFT_ATTRIBUTE, 5, 5, [["gianne_dough", 1], ["gnome_spice", 1], ["cheese", 1], ["tomato", 1], ["equa_leaves", 1]]],
  aKMNsT: [BLURBERRY_ATTRIBUTE, 0, 1, [["cocktail_guide", 1]]],
  z_7vVa: [BLURBERRY_ATTRIBUTE, 1, 2, [["lemon", 2], ["orange", 1], ["pineapple", 1], ["cocktail_shaker", 1], ["cocktail_glass_empty", 1], ["knife", 1]]],
  SXr54y: [BLURBERRY_ATTRIBUTE, 3, 3, [["pineapple", 3], ["orange", 2], ["lemon", 1], ["lime", 1]]],
  BxpU82: [BLURBERRY_ATTRIBUTE, 4, 4, [["vodka", 2], ["gin", 1], ["lemon", 1], ["pineapple", 1], ["lime", 2], ["orange", 1]]],
  pQSldM: [BLURBERRY_ATTRIBUTE, 5, 5, [["vodka", 1], ["lime", 4], ["equa_leaves", 1]]],
  HhGEdw: [ALUFT_ATTRIBUTE, 6, 6, [["cert_gianne_dough", 100]]],
};
// Stable persisted bits: never derive them from the order of a future object.
const GRANT_BITS = { H4Ocf4: 1, Cnwtxg: 2, "31MVvm": 4, AMbVk6: 8, hwbvze: 16,
  aKMNsT: 32, z_7vVa: 64, SXr54y: 128, BxpU82: 256, pQSldM: 512, HhGEdw: 1024 };

const CONDITIONS = {
  ydCQPC: ["missing", "toad_crunchies"], DnIaI0: ["premade", "premade_toad_crunchies", "toad_crunchies"],
  EYA5Zs: ["has", "crunchy_tray"], R2DmNx: ["missing", "crunchy_tray"], X7fp2V: ["has", "toad_crunchies"],
  s0zi_s: ["premade", "premade_chocchip_crunchies", "chocchip_crunchies"], rDPAcf: ["has", "crunchy_tray"],
  OhJipk: ["missing", "crunchy_tray"], P8VCri: ["has", "chocchip_crunchies"],
  FTFGnQ: ["premade", "premade_toad_batta", "toad_batta"], stkTxI: ["missing", "batta_tin"],
  ZSFM08: ["has", "batta_tin"], JFy62X: ["has", "toad_batta"],
  fLjyAV: ["premade", "premade_cheese+tom_batta", "cheese+tom_batta"], "D-Zpnd": ["missing", "batta_tin"],
  Cty31a: ["has", "batta_tin"], d8pw_l: ["has", "cheese+tom_batta"],
  dvwewI: ["premade", "premade_fruit_blast", "fruit_blast"], exB3Ce: ["missing", "cocktail_shaker"],
  ZKoWGH: ["has", "cocktail_shaker"], BRF250: ["has", "fruit_blast"],
  "8EaRbM": ["premade", "premade_pineapple_punch", "pineapple_punch"], _VODUw: ["missing", "cocktail_shaker"],
  TgvlZK: ["has", "cocktail_shaker"], NWuCLe: ["has", "pineapple_punch"],
  zZzM84: ["premade", "premade_wizard_blizzard", "wizard_blizzard"], "9op5XO": ["missing", "cocktail_shaker"],
  k245cv: ["has", "cocktail_shaker"], dFeWBd: ["has", "wizard_blizzard"],
  yjdZlU: ["premade", "premade_sgg", "sgg"], "6vkL0y": ["missing", "cocktail_shaker"],
  "1SE4J4": ["has", "cocktail_shaker"], Ac2xxD: ["has", "sgg"],
};
const OTHER_TUTOR = {
  GyJXLr: [BLURBERRY_ATTRIBUTE, false], YLpCLl: [BLURBERRY_ATTRIBUTE, false], BOqil4: [BLURBERRY_ATTRIBUTE, true], cjly2s: [BLURBERRY_ATTRIBUTE, true],
  "9vOHCQ": [ALUFT_ATTRIBUTE, false], "9E76xR": [ALUFT_ATTRIBUTE, false], Fu59SC: [ALUFT_ATTRIBUTE, true], "89F6g6": [ALUFT_ATTRIBUTE, true],
};
const STAGE_FOOD = {
  [ALUFT_ATTRIBUTE]: [null, null, "toad_crunchies", "chocchip_crunchies", "toad_batta", "cheese+tom_batta"],
  [BLURBERRY_ATTRIBUTE]: [null, null, "fruit_blast", "pineapple_punch", "wizard_blizzard", "sgg"],
};
const TOOLS = new Set(["crunchy_tray", "batta_tin", "cocktail_shaker"]);

let core;
function stage(player, key) { return Math.max(0, Math.min(COMPLETE, Number(player.getAttribute(key)) || 0)); }
function completed(player) { return stage(player, ALUFT_ATTRIBUTE) === COMPLETE && stage(player, BLURBERRY_ATTRIBUTE) === COMPLETE; }
function tutorName(event) { return event.definition?.getName?.() ?? event.npc?.getCurrentDefinition?.()?.getName?.(); }
function obj(name) {
  const value = core.CacheDefinitions.getObjId(name);
  if (!Number.isInteger(value)) throw new Error(`[GnomeRestaurant] unknown tutorial item ${name}`);
  return value;
}
function has(player, name) { return player.getInventory().getAmount(obj(name)) > 0; }
function eligibleFoodSlot(player, name) {
  const id = obj(name);
  return player.getInventory().getItems().findIndex((item) => item?.getId() === id && item.getAmount() > 0
    && !item.isPresetItem() && !item.isUntradeable() && !item.isUnbankable());
}

function selectVariant(event) {
  const tutor = TUTORS[tutorName(event)];
  return tutor ? tutor.variants[stage(event.player, tutor.attribute)] : null;
}

function answerCondition(event) {
  const tutor = TUTORS[tutorName(event)];
  if (!tutor) return null;
  const other = OTHER_TUTOR[event.stepId];
  if (other) return (stage(event.player, other[0]) === COMPLETE) === other[1];
  const spec = CONDITIONS[event.stepId];
  if (!spec) return null;
  // The transcript chooser picks the first true sibling: tool availability
  // must not mask the finished-product branch when the tool was returned.
  const food = STAGE_FOOD[tutor.attribute][stage(event.player, tutor.attribute)];
  if (TOOLS.has(spec[1]) && food && eligibleFoodSlot(event.player, food) >= 0) return false;
  if (spec[0] === "has") return spec[1] === food ? eligibleFoodSlot(event.player, food) >= 0 : has(event.player, spec[1]);
  if (spec[0] === "missing") return spec[1] === food ? eligibleFoodSlot(event.player, food) < 0 : !has(event.player, spec[1]);
  return has(event.player, spec[1]) && eligibleFoodSlot(event.player, spec[2]) < 0;
}

// Preflight the entire handout. Distinct entries are consolidated before checking
// stackability and space, so no partial reward is given on a full inventory.
function planGrant(player, entries, additionalSlots = 0) {
  const inventory = player.getInventory(), totals = new Map();
  for (const [name, amount] of entries) {
    const id = obj(name);
    totals.set(id, (totals.get(id) ?? 0) + amount);
  }
  let slots = 0;
  for (const [id, amount] of totals) {
    const item = new core.Item(id, amount);
    if (item.getDefinition().isStackable()) {
      const matching = inventory.getItems().some((held) => held?.getId() === id && held.getAmount() > 0
        && JSON.stringify(held.getMeta() ?? null) === JSON.stringify(item.getMeta() ?? null));
      if (!matching) slots++;
      else if (inventory.getAddableAmount(item) < amount) return null;
    } else slots += amount;
  }
  return inventory.getFreeSlots() + additionalSlots >= slots ? totals : null;
}
function grant(player, totals) {
  const inventory = player.getInventory();
  for (const [id, amount] of totals) inventory.addItem(new core.Item(id, amount));
}

function stopAction(event) {
  event.handled = true;
  event.end = true;
}

function tutorAction(event) {
  const tutor = TUTORS[tutorName(event)];
  if (!tutor) return;
  const { player, stepId } = event;
  if (player.isRegistered?.() === false || player.getHitpoints?.() <= 0) return stopAction(event);
  const handIn = HAND_INS[stepId];
  if (handIn) {
    const [key, expected, item] = handIn;
    const slot = eligibleFoodSlot(player, item);
    if (key !== tutor.attribute || stage(player, key) !== expected || slot < 0) return stopAction(event);
    const itemId = obj(item), inventory = player.getInventory();
    // A product must actually occupy one slot before we count it as freed.
    if (new core.Item(itemId, 1).getDefinition().isStackable()) return stopAction(event);
    const giftId = NEXT_GIFT[stepId], gift = giftId ? GRANTS[giftId] : null;
    const bit = giftId ? GRANT_BITS[giftId] : 0, flags = Number(player.getAttribute(AWARDS_ATTRIBUTE)) || 0;
    if (gift && (gift[0] !== key || gift[1] !== expected + 1)) throw new Error("[GnomeRestaurant] inconsistent tutorial handout");
    if (gift && (flags & bit) !== 0) return stopAction(event);
    const planned = gift ? planGrant(player, gift[3], 1) : null;
    if (gift && !planned) { player.sendMessage("You need more inventory space."); return stopAction(event); }
    inventory.deleteAtSlot(slot, 1);
    // Deliver the next transcript handout now so a later close/full inventory
    // cannot consume the hand-in while permanently losing its promised gift.
    if (gift) { grant(player, planned); player.setAttribute(AWARDS_ATTRIBUTE, flags | bit); }
    player.setAttribute(key, expected + 1);
    return;
  }
  const replacement = { rhbPSr: [ALUFT_ATTRIBUTE, "crunchy_tray"], "eTJJl-": [ALUFT_ATTRIBUTE, "batta_tin"], MMn0kc: [BLURBERRY_ATTRIBUTE, "cocktail_shaker"] }[stepId];
  if (replacement) {
    if (replacement[0] !== tutor.attribute || has(player, replacement[1])) return stopAction(event);
    const planned = planGrant(player, [[replacement[1], 1]]);
    if (!planned) { player.sendMessage("You need more inventory space."); return stopAction(event); }
    grant(player, planned);
    event.handled = true;
    return;
  }
  const gift = GRANTS[stepId];
  if (!gift) return;
  const [key, expected, next, entries] = gift;
  const flags = Number(player.getAttribute(AWARDS_ATTRIBUTE)) || 0, bit = GRANT_BITS[stepId];
  if (key !== tutor.attribute || stage(player, key) !== expected) return stopAction(event);
  if ((flags & bit) !== 0) { event.handled = true; return; }
  const planned = planGrant(player, entries);
  if (!planned) { player.sendMessage("You need more inventory space."); return stopAction(event); }
  grant(player, planned);
  player.setAttribute(AWARDS_ATTRIBUTE, flags | bit);
  player.setAttribute(key, next);
  event.handled = true;
}

function attach(api) {
  core = api.core;
  api.persistAttribute(ALUFT_ATTRIBUTE, 0);
  api.persistAttribute(BLURBERRY_ATTRIBUTE, 0);
  api.persistAttribute(AWARDS_ATTRIBUTE, 0);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", tutorAction);
}

module.exports = Object.assign(attach, { completed });
