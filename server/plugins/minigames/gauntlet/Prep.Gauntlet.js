"use strict";

/**
 * Preparing in the maze: gathering, the start room's stations (tool storage, water pump,
 * range, singing bowl, recipe books) and making Egniol potions.
 *
 * Wiki: the tool storage gives back the sceptre, axe, pickaxe, harpoon and pestle and mortar.
 * Vials are filled at the water pump or a fishing spot; a grym leaf in a water-filled vial makes
 * a grym potion (unf); the pestle and mortar grinds 10 shards into 10 dust; 10 dust in the
 * potion makes an Egniol potion (3) for 10 Herblore XP. Raw paddlefish cook into paddlefish
 * for 15 Cooking XP, succeeding with the Wiki's chart (Paddlefish: low 155, high 368, rising
 * past 99 like other cooking); the one-a-tick pace of the pump and range is Near-Reality's, as
 * the Wiki does not give it. The range's first fish, its sound, its spam-channel
 * line, the cooking_success_count it moves and its empty-handed message box are from rsprox
 * captures (recordings 1158, 3276, 3285).
 */

const Shared = require("./Shared.Gauntlet");
const Cooking = require("../../skills/cooking/Common.Cooking");
const Run = require("./RunState.Gauntlet");
const Items = require("./Items.Gauntlet");
const Resources = require("./Resources.Gauntlet");
const Rewards = require("./Rewards.Gauntlet");

/** The Gauntlet's own full-inventory line (takeTools). */
const NO_ROOM_TEXT = "You don't have enough inventory space.";
const ANIMATION = { FILL: 827, COOK: 896, GRIND: 364, MIX: 363 };
/** synth_sound 2577 with each cooked fish (rsprox captures). */
const COOK_SOUND = 2577;
/** The first fish is two ticks after the player reaches the range (rsprox captures). */
const FIRST_COOK_TICKS = 2;
/** Wiki (Paddlefish): the range's low and high values out of 256. */
const PADDLEFISH_CHANCE = [155, 368];
/** A weapon made at this tier is attuned (0 basic, 2 perfected). */
const ATTUNED_TIER = 1;
const TOOL_NAMES = [["sceptre", "a sceptre"], ["axe", "an axe"], ["pickaxe", "a pickaxe"], ["harpoon", "a harpoon"], ["pestle", "a pestle and mortar"]];
const RECIPE_BOOK_INTERFACE = 640;
const MAIN_MODAL_UID = (161 << 16) | 16;
const EGNIOL_TEXT = [
  "Those hoping to survive the Gauntlet will need to take advantage of the Grym roots found within the dungeon.",
  "The leaves that grow on these roots can be used to create Egniol potions, which are able to restore both energy and divinity.",
  "Fill a vial with water. Add a Grym leaf to the vial. Crush ten crystal shards. Add the crystal dust to the vial.",
];

function itemsOf(run) {
  return Items.itemsFor(run.mode);
}

function has(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id);
}

function count(player, id) {
  return player.getInventory().getAmount(id);
}

function animate(player, id) {
  player.performAnimation(new (Shared.core().Animation)(id));
}

// ------------------------------------------------------------------ gathering

function gatherFrom(event) {
  const run = Run.runInside(event.player);
  if (!run) return false;
  return Resources.gather(run, event.player, event.object);
}

// ------------------------------------------------------------------ tool storage

function takeTools(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  const missing = TOOL_NAMES.filter(([key]) => !has(player, items[key]));
  if (missing.length === 0) {
    Shared.statement(player, "You do not need anything available here.");
    return true;
  }
  const give = (tools) => () => {
    for (const [key] of tools) {
      if (player.getInventory().getFreeSlots() <= 0) {
        player.sendMessage(NO_ROOM_TEXT);
        break;
      }
      player.getInventory().adds(items[key], 1);
    }
    player.getInventory().refreshItems();
  };
  const pairs = [];
  if (missing.length > 1) pairs.push("Take everything.", give(missing));
  for (const tool of missing.slice(0, 5 - pairs.length / 2)) pairs.push(`Take ${tool[1]}.`, give([tool]));
  Shared.options(player, "What would you like to take?", ...pairs);
  return true;
}

// ------------------------------------------------------------------ water and cooking

/** One item at a time, a tick apart, until none are left or the player moves. */
function repeatEachTick(player, step) {
  const origin = player.getLocation();
  Resources.stopGathering(player);
  const go = () => step() !== false;
  if (!go()) return;
  player.__gauntletGathering = Shared.repeat(player, 1, () => {
    if (!player.getLocation().equals(origin) || !Run.runInside(player)) return false;
    return go();
  });
}

function fillVials(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  if (!player.getInventory().contains(items.vial)) {
    player.sendMessage("You have no vials to fill.");
    return true;
  }
  repeatEachTick(player, () => {
    if (!player.getInventory().contains(items.vial)) return false;
    animate(player, ANIMATION.FILL);
    player.getInventory().delete(items.vial, 1);
    player.getInventory().adds(items.waterVial, 1);
    player.getInventory().refreshItems();
    player.sendMessage("You fill a crystal vial with water.");
    return true;
  });
  return true;
}

function fillVialsAt(event) {
  const run = Run.runInside(event.player);
  if (!run || event.itemId !== itemsOf(run).vial) return false;
  return fillVials(event);
}

function cook(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  if (!player.getInventory().contains(items.rawPaddlefish)) {
    Shared.statement(player, "You haven't got anything to cook.");
    return true;
  }
  const { Skill, ChatType } = Shared.core();
  let wait = FIRST_COOK_TICKS;
  repeatEachTick(player, () => {
    if (!player.getInventory().contains(items.rawPaddlefish)) return false;
    if (wait-- > 0) return true;
    animate(player, ANIMATION.COOK);
    player.getPacketSender().sendSound(COOK_SOUND, 1, 0);
    const level = player.getSkillManager().getCurrentLevel(Skill.COOKING);
    const burnt = run.random() < 1 - Cooking.successChance(PADDLEFISH_CHANCE[0], PADDLEFISH_CHANCE[1], level);
    player.getInventory().delete(items.rawPaddlefish, 1);
    player.getInventory().adds(burnt ? items.burntPaddlefish : items.paddlefish, 1);
    player.getInventory().refreshItems();
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, burnt ? "You accidentally burn the paddlefish." : "You successfully cook a paddlefish.");
    Shared.api().emitCustomEvent("cooking:count", { player, burnt });
    run.addPoints(Rewards.POINTS.cook);
    if (!burnt) player.getSkillManager().addExperiences(Skill.COOKING, 15);
    return true;
  });
  return true;
}

function cookOn(event) {
  const run = Run.runInside(event.player);
  if (!run || event.itemId !== itemsOf(run).rawPaddlefish) return false;
  return cook(event);
}

// ------------------------------------------------------------------ the singing bowl

function singCrystal(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  openBowl(player, run);
  return true;
}

function openBowl(player, run) {
  const { CreationMenu } = Shared.core();
  const recipes = Items.bowlRecipes(run.mode, (id) => has(player, id));
  player.getPacketSender().sendCreationMenu(new CreationMenu("What would you like to make?",
    recipes.map((recipe) => recipe.id), {
      execute: (id, amount) => sing(player, run, recipes.find((recipe) => recipe.id === id), amount),
    }));
}

/** Makes up to `amount` of a recipe (gear one at a time); each takes its materials and shards. */
function sing(player, run, recipe, amount) {
  if (!recipe || Run.runInside(player) !== run) return;
  const { Skill, Item } = Shared.core();
  const items = itemsOf(run);
  const times = recipe.gear ? 1 : Math.max(1, amount);
  let made = 0;
  let changedSlot = -1;
  let noRoom = false;
  for (; made < times; made++) {
    const affordable = count(player, items.shards) >= recipe.shards
      && recipe.needs.every(([id, need]) => count(player, id) + (equipmentSlotOf(player, id) >= 0 ? 1 : 0) >= need);
    if (!affordable) break;
    if (!roomFor(player, recipe, items)) {
      noRoom = true;
      break;
    }
    // An upgraded piece that is worn is upgraded where it is.
    let wornSlot = -1;
    for (const [id, need] of recipe.needs) {
      const slot = equipmentSlotOf(player, id);
      if (slot >= 0 && count(player, id) < need) {
        player.getEquipment().setItem(slot, new Item(-1, 0));
        wornSlot = slot;
      } else {
        player.getInventory().delete(id, need);
      }
    }
    if (recipe.shards > 0) player.getInventory().delete(items.shards, recipe.shards);
    if (wornSlot >= 0) {
      player.getEquipment().setItem(wornSlot, new Item(recipe.id, 1));
      changedSlot = wornSlot;
    } else {
      player.getInventory().adds(recipe.id, 1);
    }
    if (recipe.xp > 0) {
      player.getSkillManager().addExperiences(Skill.CRAFTING, recipe.xp);
      player.getSkillManager().addExperiences(Skill.SMITHING, recipe.xp);
    }
    if (recipe.gear) run.addPoints(Rewards.POINTS.tiers[recipe.tier]);
    if (recipe.kind === "armour") run.made.armour++;
    if (recipe.kind === "weapon" && recipe.tier === ATTUNED_TIER) run.made.attunedWeapons++;
    else if (recipe.id === items.comboFish) run.addPoints(Rewards.POINTS.comboFish);
  }
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  if (made === 0) {
    if (noRoom) player.sendMessage(NO_ROOM_TEXT);
    else Shared.statement(player, "You do not have the materials required to make that.");
    return;
  }
  if (changedSlot >= 0) refreshGear(player, changedSlot);
  player.sendMessage("With the help of the crystal bowl, you sing a beautiful song and shape the crystals.");
}

/** Whether one more of `recipe` has somewhere to go: a free slot, the worn piece it upgrades, or a slot its inputs free. */
function roomFor(player, recipe, items) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() > 0) return true;
  const { ItemDefinition } = Shared.core();
  const stackable = (id) => ItemDefinition.forId(id)?.isStackable?.() === true;
  if (stackable(recipe.id) && inventory.contains(recipe.id)) return true;
  if (recipe.shards > 0 && count(player, items.shards) === recipe.shards) return true;
  return recipe.needs.some(([id, need]) => {
    if (equipmentSlotOf(player, id) >= 0 && count(player, id) < need) return true;
    return count(player, id) >= need && (!stackable(id) || count(player, id) === need);
  });
}

function equipmentSlotOf(player, id) {
  return player.getEquipment().getItems().findIndex((item) => item?.getId?.() === id);
}

/** Bonuses, looks (and the weapon interface for a weapon) after worn gear changed in place. */
function refreshGear(player, slot) {
  const { WeaponInterfaceManager, Flag, Equipment } = Shared.core();
  if (slot === Equipment.WEAPON_SLOT) WeaponInterfaceManager.assign(player);
  Shared.api().getBonusManager().update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function readRecipes(event) {
  if (!Run.runInside(event.player)) return false;
  event.player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, RECIPE_BOOK_INTERFACE, 0);
  return true;
}

function readEgniol(event) {
  if (!Run.runInside(event.player)) return false;
  for (const line of EGNIOL_TEXT) event.player.sendMessage(line);
  return true;
}

// ------------------------------------------------------------------ Egniol potions

function addLeaf(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(items.grymLeaf) || !ids.includes(items.waterVial)) return false;
  player.getInventory().delete(items.grymLeaf, 1);
  player.getInventory().delete(items.waterVial, 1);
  player.getInventory().adds(items.grymPotion, 1);
  player.getInventory().refreshItems();
  animate(player, ANIMATION.MIX);
  player.sendMessage("You put the grym leaf into the vial.");
  return true;
}

function grindShards(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(items.pestle) || !ids.includes(items.shards)) return false;
  if (count(player, items.shards) < Items.DUST_PER_POTION) {
    player.sendMessage(`You need at least ${Items.DUST_PER_POTION} shards to make anything useful.`);
    return true;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0 && !inventory.contains(items.dust) && count(player, items.shards) !== Items.DUST_PER_POTION) {
    player.sendMessage(NO_ROOM_TEXT);
    return true;
  }
  inventory.delete(items.shards, Items.DUST_PER_POTION);
  inventory.adds(items.dust, Items.DUST_PER_POTION);
  player.getInventory().refreshItems();
  animate(player, ANIMATION.GRIND);
  player.sendMessage("You grind the shards into dust.");
  return true;
}

function finishPotion(event) {
  const { player } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  const items = itemsOf(run);
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(items.dust) || !ids.includes(items.grymPotion)) return false;
  if (count(player, items.dust) < Items.DUST_PER_POTION) {
    player.sendMessage(`You need ${Items.DUST_PER_POTION} crystal dust to finish the potion.`);
    return true;
  }
  player.getInventory().delete(items.dust, Items.DUST_PER_POTION);
  player.getInventory().delete(items.grymPotion, 1);
  player.getInventory().adds(items.egniol3, 1);
  run.made.egniol++;
  player.getInventory().refreshItems();
  animate(player, ANIMATION.MIX);
  player.getSkillManager().addExperiences(Shared.core().Skill.HERBLORE, 10);
  player.sendMessage("You add the crystal dust to the vial and make an Egniol potion.");
  return true;
}

function emptyVial(event) {
  const { player, itemId, slot } = event;
  const run = Run.runInside(player);
  if (!run) return false;
  player.getInventory().deleteAtSlot(slot, 1);
  player.getInventory().adds(itemsOf(run).vial, 1);
  player.getInventory().refreshItems();
  player.sendMessage(itemId === Items.SHARED.waterVial ? "You empty the vial." : "You empty the vial's contents.");
  return true;
}

module.exports = function registerGauntletPrep(api) {
  Shared.bind(api);
  for (const [name, option] of [
    ["Crystal Deposit", "Mine"], ["Corrupt Deposit", "Mine"],
    ["Phren Roots", "Chop"], ["Corrupt Phren Roots", "Chop"],
    ["Fishing Spot", "Fish"], ["Corrupt Fishing Spot", "Fish"],
    ["Grym Root", "Pick"], ["Corrupt Grym Root", "Pick"],
    ["Linum Tirinum", "Pick"], ["Corrupt Linum Tirinum", "Pick"],
  ]) {
    api.onObjectInteraction(name, { [option]: gatherFrom });
  }
  api.onObjectInteraction("Tool Storage", { Take: takeTools });
  api.onObjectInteraction("Water Pump", { "Fill-from": fillVials });
  api.onObjectInteraction("Range", { Cook: cook });
  api.onObjectInteraction("Singing Bowl", { "Sing-crystal": singCrystal });
  api.onObjectInteraction("Crystal Singing Recipes", { Read: readRecipes });
  api.onObjectInteraction("Egniol Potions", { Read: readEgniol });
  api.onItemOnObject("Vial", "Water Pump", fillVialsAt);
  api.onItemOnObject("Vial", "Fishing Spot", fillVialsAt);
  api.onItemOnObject("Vial", "Corrupt Fishing Spot", fillVialsAt);
  api.onItemOnObject("Raw paddlefish", "Range", cookOn);
  api.onItemOnItem("Grym leaf", "Water-filled vial", addLeaf);
  api.onItemOnItem("Pestle and mortar", "Crystal shards", grindShards);
  api.onItemOnItem("Pestle and mortar", "Corrupted shards", grindShards);
  api.onItemOnItem("Crystal dust", "Grym potion (unf)", finishPotion);
  api.onItemOnItem("Corrupted dust", "Grym potion (unf)", finishPotion);
  api.onItemAction("Water-filled vial", { Empty: emptyVial });
  api.onItemAction("Grym potion (unf)", { Empty: emptyVial });
};
