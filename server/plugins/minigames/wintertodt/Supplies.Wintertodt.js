"use strict";

/**
 * Everything gathered and made inside the prison: bruma roots, kindling, bruma herbs, the
 * crates by the doors and rejuvenation potions.
 *
 * Captures: chopping says "You swing your axe at the roots." and gives a root every 3 ticks
 * ("You get a bruma root."); fletching is anim 1248, a kindling every 4 ticks ("You carefully
 * fletch the root into a bundle of kindling."), refused in the safe area ("Your hands are too
 * cold to fletch here - move closer to the braziers."); "You take a knife from the crate."
 * Wiki: roots give 0.3x Woodcutting level XP, kindling 0.6x Fletching, a potion 0.1x Herblore;
 * herbs no longer give Farming XP; a dose of rejuvenation potion restores 30% warmth; potions
 * can only be made "within the influence of the Bruma tree"; the hammer, knife, axe and
 * tinderbox crates give one only while you have none; Brew'ma makes every potion you can.
 * Near-Reality: the crate messages besides the knife's, the herb picking anim (2282), the potion
 * message, and roots, kindling, herbs and potions shattering when dropped.
 */

const Shared = require("./WintertodtShared");
const Round = require("./WintertodtRound");
const Warmth = require("./WintertodtWarmth");
const Woodcutting = require("../../skills/Woodcutting.plugin");

const CHOP_TICKS = 3;
const FLETCH_TICKS = 4;
const PICK_TICKS = 3;
const MIX_TICKS = 2;
const DRINK_DELAY = 3;
const XP = { ROOT: 0.3, KINDLING: 0.6, POTION: 0.1 };

function newItem(id, amount = 1) {
  const { Item } = Shared.core();
  return new Item(id, amount);
}

function slotOf(player, id) {
  return player.getInventory().getItems().findIndex((item) => item?.getId?.() === id);
}

function isFull(player) {
  return player.getInventory().getFreeSlots() <= 0;
}

function give(player, id, amount = 1) {
  player.getInventory().adds(id, amount);
  player.getInventory().refreshItems();
}

// ------------------------------------------------------------------ roots

/** Wiki: better levels and axes cut faster; at 99 with a dragon axe every try succeeds. */
function chopChance(player, axe) {
  return Math.min(1, 0.55 + Shared.level(player, "WOODCUTTING") * 0.004 + axe.speed);
}

function chop(event) {
  const { player } = event;
  if (!Round.isActive()) {
    player.sendMessage("There's no use for bruma roots at this time.");
    return true;
  }
  const axe = Woodcutting.findBestUsableAxe(player);
  if (!axe) {
    player.sendMessage("You do not have an axe which you have the woodcutting level to use.");
    return true;
  }
  if (isFull(player)) {
    player.sendMessage("Your inventory is too full to hold any more roots.");
    return true;
  }
  player.sendMessage("You swing your axe at the roots.");
  Shared.startAction(player, "chop", (ticks) => {
    if (!Round.isActive()) return false;
    if (ticks % CHOP_TICKS !== 0) return true;
    Shared.animate(player, axe.animationId);
    if (Math.random() >= chopChance(player, axe)) return true;
    give(player, Shared.ITEM.BRUMA_ROOT);
    player.sendMessage("You get a bruma root.");
    Shared.addXp(player, "WOODCUTTING", XP.ROOT * Shared.level(player, "WOODCUTTING"));
    if (!isFull(player)) return true;
    player.sendMessage("Your inventory is too full to hold any more roots.");
    return false;
  });
  Shared.animate(player, axe.animationId);
  return true;
}

// ------------------------------------------------------------------ kindling

function fletchOne(player) {
  const slot = slotOf(player, Shared.ITEM.BRUMA_ROOT);
  if (slot < 0 || !player.getInventory().contains(Shared.ITEM.KNIFE)) return false;
  player.getInventory().setItem(slot, newItem(Shared.ITEM.BRUMA_KINDLING)).refreshItems();
  player.sendMessage("You carefully fletch the root into a bundle of kindling.");
  Shared.addXp(player, "FLETCHING", XP.KINDLING * Shared.level(player, "FLETCHING"));
  return true;
}

function fletch(event) {
  const { player } = event;
  if (Shared.inSafeArea(player.getLocation())) {
    player.sendMessage("Your hands are too cold to fletch here - move closer to the braziers.");
    return true;
  }
  Shared.startAction(player, "fletch", (ticks) => {
    if (ticks % FLETCH_TICKS !== FLETCH_TICKS - 1) return true;
    if (!fletchOne(player)) return false;
    if (slotOf(player, Shared.ITEM.BRUMA_ROOT) < 0) return false;
    Shared.animate(player, Shared.ANIM.FLETCH);
    return true;
  });
  Shared.animate(player, Shared.ANIM.FLETCH);
  return true;
}

// ------------------------------------------------------------------ herbs

function pick(event) {
  const { player } = event;
  if (!Round.isActive()) {
    player.sendMessage("There's no need to do that at this time.");
    return true;
  }
  if (isFull(player)) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  Shared.startAction(player, "pick", (ticks) => {
    if (ticks % PICK_TICKS !== 0) return true;
    give(player, Shared.ITEM.BRUMA_HERB);
    if (isFull(player)) return false;
    Shared.animate(player, Shared.ANIM.PICK);
    return true;
  });
  Shared.animate(player, Shared.ANIM.PICK);
  return true;
}

// ------------------------------------------------------------------ crates

const CRATE_TOOLS = {
  "Take-hammer": { name: "hammer", give: Shared.ITEM.HAMMER, has: [Shared.ITEM.HAMMER] },
  "Take-knife": { name: "knife", give: Shared.ITEM.KNIFE, has: [Shared.ITEM.KNIFE] },
  "Take-tinderbox": { name: "tinderbox", give: Shared.ITEM.TINDERBOX, has: [Shared.ITEM.TINDERBOX] },
  "Take-axe": { name: "axe", give: Shared.ITEM.BRONZE_AXE, has: null },
};

function article(name) {
  return /^[aeiou]/.test(name) ? "an" : "a";
}

function takeTool(event, option) {
  const { player } = event;
  const tool = CRATE_TOOLS[option];
  const has = tool.has ? tool.has.some((id) => Shared.hasItem(player, id)) : Woodcutting.findBestUsableAxe(player) != null
    || Woodcutting.AXES.some((axe) => Shared.hasItem(player, axe.id));
  if (has) {
    player.sendMessage(`You already have ${article(tool.name)} ${tool.name}.`);
    return true;
  }
  if (isFull(player)) {
    player.sendMessage(`You need space in your inventory to take ${article(tool.name)} ${tool.name}.`);
    return true;
  }
  give(player, tool.give);
  player.sendMessage(`You take ${article(tool.name)} ${tool.name} from the crate.`);
  return true;
}

function takeConcoctions(event, amount) {
  const { player } = event;
  const free = player.getInventory().getFreeSlots();
  if (free <= 0) {
    player.sendMessage("You need space in your inventory to take an unfinished potion.");
    return true;
  }
  const count = Math.min(amount, free);
  for (let i = 0; i < count; i++) give(player, Shared.ITEM.REJUVENATION_UNF);
  player.sendMessage(count > 1 ? "You take the unfinished potions from the crate." : "You take an unfinished potion from the crate.");
  return true;
}

const crateActions = {
  ...Object.fromEntries(Object.keys(CRATE_TOOLS).map((option) => [option, (event) => takeTool(event, option)])),
  "Take-concoction": (event) => takeConcoctions(event, 1),
  "Take-concoctions": (event) => takeConcoctions(event, 1),
  "Take-5 concoctions": (event) => takeConcoctions(event, 5),
  "Take-10 concoctions": (event) => takeConcoctions(event, 10),
};

// ------------------------------------------------------------------ potions

function mixOne(player) {
  const unf = slotOf(player, Shared.ITEM.REJUVENATION_UNF);
  const herb = slotOf(player, Shared.ITEM.BRUMA_HERB);
  if (unf < 0 || herb < 0) return false;
  player.getInventory().setItem(unf, newItem(Shared.ITEM.REJUVENATION_4));
  player.getInventory().setItem(herb, newItem(-1, 0));
  player.getInventory().refreshItems();
  player.sendMessage("You combine the bruma herb into the unfinished potion.");
  Shared.addXp(player, "HERBLORE", XP.POTION * Shared.level(player, "HERBLORE"));
  return true;
}

function mix(event) {
  const { player } = event;
  if (!Round.inPrison(player)) {
    player.sendMessage("You can only do that within the influence of the Bruma tree.");
    return true;
  }
  if (!mixOne(player)) return true;
  Shared.startAction(player, "mix", (ticks) => ticks % MIX_TICKS !== 0 || mixOne(player));
  return true;
}

function npcName(npc) {
  const id = npc?.getNpcTransformationId?.() > 0 ? npc.getNpcTransformationId() : npc?.getId?.();
  return Shared.core().CacheDefinitions.getNpc(id)?.name ?? null;
}

/** Brew'ma mixes every pair at once. */
function brewma(event) {
  if (npcName(event.target) !== Shared.NPC.BREWMA) return;
  if (event.itemId !== Shared.ITEM.BRUMA_HERB && event.itemId !== Shared.ITEM.REJUVENATION_UNF) return;
  event.handled = true;
  let made = 0;
  while (mixOne(event.player)) made++;
  if (made === 0) event.player.sendMessage("You need both a bruma herb and an unfinished potion.");
}

function nextDose(id) {
  const index = Shared.POTIONS.indexOf(id);
  return index >= 0 && index < Shared.POTIONS.length - 1 ? Shared.POTIONS[index + 1] : -1;
}

function drink(event) {
  const { player, slot, itemId } = event;
  const now = Round._round.ticks;
  if (player.__wintertodtDrankAt != null && now - player.__wintertodtDrankAt < DRINK_DELAY && now >= player.__wintertodtDrankAt) return true;
  player.__wintertodtDrankAt = now;
  const next = nextDose(itemId);
  player.getInventory().setItem(slot, newItem(next, next > 0 ? 1 : 0)).refreshItems();
  Shared.animate(player, Shared.ANIM.DRINK);
  Warmth.restore(player, Warmth.POTION_RESTORE);
  player.sendMessage("You drink some of your rejuvenation potion.");
  return true;
}

/** Takes one dose from the potion with the fewest left (Wiki); false with none. */
function useDose(player) {
  for (const id of [...Shared.POTIONS].reverse()) {
    const slot = slotOf(player, id);
    if (slot < 0) continue;
    const next = nextDose(id);
    player.getInventory().setItem(slot, newItem(next, next > 0 ? 1 : 0)).refreshItems();
    return true;
  }
  return false;
}

/** Wiki: food healing 4 or more restores 35% warmth in the prison. */
function ateFood({ player, itemId, heal }) {
  if (Round.inPrison(player)) Warmth.ateFood(player, itemId, heal);
}

// ------------------------------------------------------------------ drops

const SHATTER = new Map([
  [Shared.ITEM.BRUMA_ROOT, "The root shatters as it hits the floor."],
  [Shared.ITEM.BRUMA_KINDLING, "The kindling shatters as it hits the floor."],
  [Shared.ITEM.BRUMA_HERB, "The herb shatters as it hits the floor."],
  [Shared.ITEM.REJUVENATION_UNF, "The vial shatters as it hits the floor."],
  ...Shared.POTIONS.map((id) => [id, "The potion shatters as it hits the floor."]),
]);

function shatter(event) {
  const message = SHATTER.get(event.itemId);
  if (!message) return;
  event.player.getInventory().setItem(event.slot, newItem(-1, 0)).refreshItems();
  event.player.sendMessage(message);
  event.dropToGround = false;
  event.handled = true;
}

module.exports = function registerWintertodtSupplies(api) {
  api.onObjectInteraction(Shared.OBJECT.ROOTS, { Chop: chop });
  api.onObjectInteraction(Shared.OBJECT.SPROUTING_ROOTS, { Pick: pick });
  api.onObjectInteraction(Shared.OBJECT.CRATE, crateActions);
  api.onItemOnItem("Knife", "Bruma root", fletch);
  api.onItemOnItem("Bruma herb", "Rejuvenation potion (unf)", mix);
  for (let dose = 1; dose <= 4; dose++) api.onItemAction(`Rejuvenation potion (${dose})`, { Drink: drink });
  api.onItemOnNpc(brewma);
  api.onItemDropPolicy(shatter);
  api.onCustomEvent("food:eaten", ateFood);
};

module.exports.useDose = useDose;
module.exports.npcName = npcName;
module.exports.chop = chop;
module.exports.fletch = fletch;
module.exports.mix = mix;
module.exports.drink = drink;
module.exports.crateActions = crateActions;
module.exports.chopChance = chopChance;
