"use strict";

/**
 * The apprentices: Felix's shop and dyes, Cordelia's pouch repairs and the chatter in the temple.
 *
 * rsprox captures (rev 241):
 * - Felix, Talk-to: "Hey, <name>. Got any abyssal pearls you want to trade?" (his transcript);
 *   Trade, and the transcript's shop, open the Omnishop at gotr_reward_shop_all (row 7142) for an
 *   account with every quest. The other rows leave out the law, death and blood talismans of the
 *   quests the player hasn't done (Troll Stronghold, Mourning's End Part II, Sins of the Father).
 * - Cordelia, Talk-to: "I was wondering if you could repair my pouches." then "It will cost you 1
 *   abyssal pearl to repair the pouches." (her transcript; 25 pearls first unlock the contact,
 *   gotr_cordelia_repair_pouch, which turns her into the variant with Repair).
 * - A dye on Felix: "You show the abyssal red dye to Felix." (Leagues capture), then the swap.
 * Felix's transcript sells him dyes for 50 pearls and lanterns for 100, and sells a lantern for
 * 1,500 pearls held in the inventory (Wiki: Abyssal pearls, Abyssal lantern).
 * The chatter is what the apprentices said in the Leagues recordings; how often is ours.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");

const SHOP_QUESTS = [["law", "troll_stronghold"], ["death", "mournings_end_part_ii"], ["blood", "sins_of_the_father"]];
const SHOP_TARGET = "Temple Supplies";
const UNLOCK_PEARLS = 25;
const REPAIR_PEARLS = 1;
const DYES = { red: "abyssal_red_dye", green: "abyssal_green_dye", blue: "abyssal_blue_dye" };
const DYE_PRICE = 50;
const LANTERN_PRICE = 100;
const LANTERN_COST = 1500;
const LANTERN = "abyssal_lantern";
/** Every abyssal lantern Felix takes: unlit, lit and the dyed ones. */
const LANTERNS = [LANTERN, "abyssal_lantern_normal", "abyssal_lantern_normal_blue", "abyssal_lantern_normal_red",
  "abyssal_lantern_normal_white", "abyssal_lantern_normal_purple", "abyssal_lantern_normal_green",
  "abyssal_lantern_oak", "abyssal_lantern_willow", "abyssal_lantern_maple", "abyssal_lantern_yew",
  "abyssal_lantern_blisterwood", "abyssal_lantern_magic", "abyssal_lantern_redwood"];

/** Felix's transcript, by step id. */
const FELIX = {
  HOLDING_DYE_OR_LANTERN: "egBoE0", HAS_LANTERN: "vIvYTP",
  SELL_DYE: { qkLWJl: "green", "32RVNN": "blue", qggrYW: "red" },
  SOLD_DYE: { "1No4Er": "green", hu6hWA: "blue", XJI400: "red" },
  SOLD_LANTERN: "POUtFr",
  NOT_ENOUGH_FOR_LANTERN: "TxWvgk", ENOUGH_FOR_LANTERN: "Ja_oUN", BUY_LANTERN: "mxgm7s",
};

/** Cordelia's transcript, by step id. */
const CORDELIA = {
  NOT_ENOUGH_TO_UNLOCK: "ppW0Jx", ENOUGH_TO_UNLOCK: "3bGUch",
  NO_PEARL: "RgKeNl", HAS_PEARL: "odnfMb",
  NOTHING_TO_REPAIR: "NhhTKU", SOMETHING_TO_REPAIR: "bapb1V",
  UNLOCK: "Q4yVuM", REPAIR: "yZnIPw",
};
const REPAIR_VARBIT = "gotr_cordelia_repair_pouch";

const CHATTER = [
  "We need to power up the Great Guardian!",
  "We need more rift guardians!",
  "Take uncharged cells with you to charge them at altars!",
  "The cells here can be used to power up barriers and rift guardians!",
  "Remember to combine guardian fragments with pure essence!",
  "Imbued essence can only be made at altars. Keep an eye out for the right altars to open!",
  "We need to protect the Great Guardian!",
  "We need shield barriers up before anything comes through that rift!",
  "Don't forget that different cells produce different rift guardians!",
  "The essence piles here contain lots of rift guardian parts.",
];
const CHATTER_TICKS = [25, 50];
const CHATTERERS = ["gotr_tamara_parent", "gotr_cordelia"];
let nextChatter = 0;

function questDone(player, key) {
  const request = { player, key, complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function npcIs(npcId, ...names) {
  return names.some((name) => Shared.npc(name) === npcId);
}

function isFelix(npcId) {
  return npcIs(npcId, "gotr_reward_trader");
}

function isCordelia(npcId) {
  return npcIs(npcId, "gotr_cordelia", "gotr_cordelia_1op", "gotr_cordelia_2ops");
}

// ------------------------------------------------------------------ Felix

/** gotr_reward_shop_<law_death_blood>: the talismans of the quests the player has done. */
function shopFor(player) {
  const done = SHOP_QUESTS.filter(([, quest]) => questDone(player, quest)).map(([name]) => name);
  if (done.length === SHOP_QUESTS.length) return "gotr_reward_shop_all";
  if (done.length === 0) return "gotr_reward_shop_none";
  return `gotr_reward_shop_${done.join("_")}`;
}

function openShop(player) {
  Shared.api().emitCustomEvent("omnishop:open", { player, shop: shopFor(player), handled: false });
}

function trade({ player, npcId }) {
  if (!isFelix(npcId)) return false;
  openShop(player);
  return true;
}

function dyeOnFelix(event) {
  const { player, itemId, target } = event;
  const dye = Object.entries(DYES).find(([, item]) => Shared.obj(item) === itemId);
  if (!dye || !isFelix(target?.getId?.())) return;
  event.handled = true;
  player.__gotrDye = dye[0];
  Shared.npcSays(player, target.getId(), "using-an-abyssal-dye-on-felix");
}

function exchangeDye(player, from, to) {
  if (Shared.count(player, DYES[from]) <= 0) return;
  player.getInventory().delete(Shared.obj(DYES[from]), 1);
  player.getInventory().adds(Shared.obj(DYES[to]), 1);
  player.getInventory().refreshItems();
}

function heldLantern(player) {
  return LANTERNS.find((lantern) => Shared.count(player, lantern) > 0) ?? null;
}

function hasDye(player) {
  return Object.values(DYES).some((dye) => Shared.count(player, dye) > 0);
}

/** Sells Felix one item for pearls; false (and nothing changes) when it's no longer held. */
function sellToFelix(player, item, price) {
  if (!item || Shared.count(player, item) <= 0) return false;
  player.getInventory().delete(Shared.obj(item), 1);
  player.getInventory().refreshItems();
  Records.addPearls(player, price);
  return true;
}

function buyLantern(player) {
  const { Item } = Shared.core();
  const fits = player.getInventory().getAddableAmount(new Item(Shared.obj(LANTERN), 1)) > 0;
  if (!fits) {
    player.getInventory().full();
    return;
  }
  if (!Records.spendPearls(player, LANTERN_COST)) return;
  player.getInventory().adds(Shared.obj(LANTERN), 1);
  player.getInventory().refreshItems();
  Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: Shared.obj(LANTERN), amount: 1 });
}

// ------------------------------------------------------------------ Cordelia

function pearls(player) {
  return Records.pearls(player);
}

function hasDecayedPouch(player) {
  return ["rcu_pouch_medium_degrade", "rcu_pouch_large_degrade", "rcu_pouch_giant_degrade", "rcu_pouch_colossal_degrade"]
    .some((pouch) => Shared.count(player, pouch) > 0);
}

function talkToCordelia({ player, npcId }) {
  if (!isCordelia(npcId)) return false;
  const unlocked = Records.setting(player, REPAIR_VARBIT) === 1;
  Shared.npcSays(player, npcId, unlocked ? "subsequent-dialogue" : "initial-dialogue");
  return true;
}

/** Repair (the unlocked variant's option): a pearl for every decayed pouch, without the talk. */
function repairOption({ player, npcId }) {
  if (!isCordelia(npcId)) return false;
  if (pearls(player) < REPAIR_PEARLS) {
    player.sendMessage("You don't have enough abyssal pearls for that.");
    return true;
  }
  if (!hasDecayedPouch(player)) {
    player.sendMessage("You don't seem to have any pouches in need of repair.");
    return true;
  }
  repair(player);
  player.sendMessage("Your pouches have been repaired.");
  return true;
}

function repair(player) {
  if (!Records.spendPearls(player, REPAIR_PEARLS)) return false;
  Shared.api().emitCustomEvent("runecrafting:repair-pouches", { player, repaired: 0 });
  return true;
}

function unlock(player) {
  if (!Records.spendPearls(player, UNLOCK_PEARLS)) return false;
  Records.setSetting(player, REPAIR_VARBIT, 1);
  return true;
}

// ------------------------------------------------------------------ transcripts

function answerCondition({ npcId, player, stepId, text }) {
  if (isCordelia(npcId)) {
    if (stepId === CORDELIA.NOT_ENOUGH_TO_UNLOCK) return pearls(player) < UNLOCK_PEARLS;
    if (stepId === CORDELIA.ENOUGH_TO_UNLOCK) return pearls(player) >= UNLOCK_PEARLS;
    if (stepId === CORDELIA.NO_PEARL) return pearls(player) < REPAIR_PEARLS;
    if (stepId === CORDELIA.HAS_PEARL) return pearls(player) >= REPAIR_PEARLS;
    if (stepId === CORDELIA.NOTHING_TO_REPAIR) return !hasDecayedPouch(player);
    if (stepId === CORDELIA.SOMETHING_TO_REPAIR) return hasDecayedPouch(player);
    return null;
  }
  if (!isFelix(npcId)) return null;
  if (stepId === FELIX.HOLDING_DYE_OR_LANTERN) return hasDye(player) || heldLantern(player) !== null;
  if (stepId === FELIX.HAS_LANTERN) return heldLantern(player) !== null;
  if (FELIX.SELL_DYE[stepId]) return Shared.count(player, DYES[FELIX.SELL_DYE[stepId]]) > 0;
  if (stepId === FELIX.NOT_ENOUGH_FOR_LANTERN) return pearls(player) < LANTERN_COST;
  if (stepId === FELIX.ENOUGH_FOR_LANTERN) return pearls(player) >= LANTERN_COST;
  const shown = /^For abyssal (\w+) dye:$/.exec(text ?? "");
  if (shown) return player.__gotrDye === shown[1];
  const held = /^If the player has abyssal (\w+) dye:$/.exec(text ?? "");
  if (held) return DYES[held[1]] ? Shared.count(player, DYES[held[1]]) > 0 : null;
  return null;
}

function dialogueAction(request) {
  const { npcId, player, stepId } = request;
  if (isCordelia(npcId)) {
    if (stepId === CORDELIA.UNLOCK && pearls(player) >= UNLOCK_PEARLS) unlock(player);
    if (stepId === CORDELIA.REPAIR && pearls(player) >= REPAIR_PEARLS) repair(player);
    return;
  }
  if (!isFelix(npcId)) return;
  if (FELIX.SOLD_DYE[stepId] || stepId === FELIX.SOLD_LANTERN) {
    const item = stepId === FELIX.SOLD_LANTERN ? heldLantern(player) : DYES[FELIX.SOLD_DYE[stepId]];
    // Dropped or banked since the choice: no sale, and no line saying there was one.
    if (!sellToFelix(player, item, stepId === FELIX.SOLD_LANTERN ? LANTERN_PRICE : DYE_PRICE)) request.handled = true;
    return;
  }
  if (stepId === FELIX.BUY_LANTERN) {
    request.handled = true;
    buyLantern(player);
    return;
  }
  if (request.action === "open_shop" && request.target === SHOP_TARGET) {
    request.handled = true;
    request.end = true;
    Shared.later(1, () => openShop(player));
    return;
  }
  const swap = /^Felix exchanges your abyssal (\w+) dye for some abyssal (\w+) dye\.$/.exec(request.text ?? "");
  if (swap) exchangeDye(player, swap[1], swap[2]);
}

// ------------------------------------------------------------------ chatter

function chatter() {
  const now = Game.clock();
  if (now < nextChatter || !Game.isRunning()) return;
  nextChatter = now + Shared.random(...CHATTER_TICKS);
  const id = Shared.npc(CHATTERERS[Shared.random(0, CHATTERERS.length - 1)]);
  for (const npc of Shared.core().World.getNpcs()) {
    if (npc && npc.getId?.() === id && Shared.inTemple(npc.getLocation())) {
      npc.forceChat(CHATTER[Shared.random(0, CHATTER.length - 1)]);
      return;
    }
  }
}

module.exports = {
  shopFor, FELIX, LANTERNS,
  attach(api) {
    api.onNpcInteraction("Apprentice Felix", { Trade: trade });
    api.onNpcInteraction("Apprentice Cordelia", { "Talk-to": talkToCordelia, Repair: repairOption });
    api.onItemOnNpc(dyeOnFelix);
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:action", dialogueAction);
    Game.on("tick", chatter);
  },
};
