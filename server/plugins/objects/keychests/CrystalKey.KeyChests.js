"use strict";

/**
 * The crystal key, the moon key and the enhanced crystal key:
 *
 * - The loop and tooth halves used on each other make a crystal key (rsprox captures: sound
 *   2127 and "You join the two halves of the key together."); the moon key's halves make a moon
 *   key with the same line (Wiki: Moon key).
 * - The Prifddinas singing bowl (CrystalSinging.plugin.js owns its menu, with this recipe) offers the enhanced crystal key: a crystal key
 *   and 10 crystal shards, 80 Smithing and Crafting (boostable), 500 XP in each (Wiki). The
 *   menu, the messages, the animation and sound 8 are the captured singing bowl's.
 */
const Data = require("./Data.KeyChests");

const JOIN_SOUND = 2127;
const SING_SOUND = 8;
const NO_MATERIALS = "You do not have all of the required materials and requirements to make anything.";
const LEVEL_TOO_LOW = "You need to be at least level {level} Crafting and Smithing to create anything through crystal singing.";

let core = null;

function init(api) {
  core = api.core;
}

/**
 * The key-half pairs, by cache gameval: both share the names "Loop half of key" and "Tooth half
 * of key". The crystal key's join sound is captured; the moon key's join isn't, so it plays none
 * (its line is the Wiki's).
 */
const KEY_HALVES = Object.freeze([
  { halves: ["keyhalf1", "keyhalf2"], key: "crystal_key", sound: JOIN_SOUND },
  { halves: ["varlamore_key_half_1", "varlamore_key_half_2"], key: "varlamore_key", sound: null },
]);

/** The noted halves share the names, so only the halves themselves join, each with its own pair. */
function joinHalves({ player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot }) {
  const objId = (name) => core.CacheDefinitions.getObjId(name);
  const pair = KEY_HALVES.find(({ halves }) => {
    const ids = halves.map(objId);
    return usedItemId !== usedWithItemId && ids.includes(usedItemId) && ids.includes(usedWithItemId);
  });
  if (!pair) return false;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(Math.max(usedItemSlot, usedWithItemSlot), 1, false);
  inventory.deleteAtSlot(Math.min(usedItemSlot, usedWithItemSlot), 1, false);
  inventory.adds(objId(pair.key), 1);
  if (pair.sound != null) player.getPacketSender().sendSound(pair.sound, 1, 0);
  player.sendMessage("You join the two halves of the key together.");
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text), new EndDialogue(1)));
}

/** How many keys the player's materials make. */
function affordable(player, recipe) {
  const inventory = player.getInventory();
  return Math.min(...recipe.needs.map(({ itemId, amount }) => Math.floor(inventory.getAmount(itemId) / amount)));
}

function meetsLevels(player, recipe) {
  const skills = player.getSkillManager();
  return [core.Skill.SMITHING, core.Skill.CRAFTING].every((skill) => skills.getCurrentLevel(skill) >= recipe.level);
}

/** Sing-crystal: falls through on the other bowls (the Gauntlet's, Eyes of Glouphrie's). */
function singCrystal({ player, objectId }) {
  const recipe = Data.get().enhancedKey;
  if (objectId !== recipe.bowlId) return false;
  if (affordable(player, recipe) === 0) return statement(player, NO_MATERIALS);
  if (!meetsLevels(player, recipe)) return statement(player, LEVEL_TOO_LOW.replace("{level}", recipe.level));
  player.getPacketSender().sendCreationMenu(new core.CreationMenu("How many would you like to make?", [recipe.productId], {
    execute: (_, amount) => sing(player, amount),
  }));
}

/** Makes the keys at once, as the bowl does. */
function sing(player, amount) {
  const recipe = Data.get().enhancedKey;
  const made = Math.min(Math.max(1, amount), affordable(player, recipe));
  if (made === 0 || !meetsLevels(player, recipe)) return;
  const inventory = player.getInventory();
  for (const { itemId, amount: need } of recipe.needs) inventory.delete(itemId, need * made);
  inventory.adds(recipe.productId, made);
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("prif_crystal_singing")));
  player.getPacketSender().sendSound(SING_SOUND, 1, 0);
  const skills = player.getSkillManager();
  skills.addExperiences(core.Skill.SMITHING, recipe.xp * made);
  skills.addExperiences(core.Skill.CRAFTING, recipe.xp * made);
}

function attach(api) {
  api.onItemOnItem("Loop half of key", "Tooth half of key", joinHalves);
}

module.exports = { init, attach, joinHalves, singCrystal, sing };
