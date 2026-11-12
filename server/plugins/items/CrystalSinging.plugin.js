"use strict";

/**
 * Crystal singing at the Prifddinas singing bowl (issue 3776; docs/crystal-singing.md).
 *
 * Sing-crystal, or a seed (or the crystal key) used on the bowl, opens the make menu for the recipes
 * the player has the materials for. Singing takes the materials at once, plays animation 'prif_crystal_singing'
 * and sound 8, awards Smithing and Crafting XP equally, and five ticks later says the song message
 * (rsprox captures 1134, 1159 and 1162; no materials is the captured statement, captures 310 and 819).
 *
 * Every recipe's materials, shards, levels and XP are the rsprox captures' or the Wiki's
 * (Crystal_Singing_Recipes, the product pages); `source` on each row says which.
 *
 * Crystal armour keeps its own menu (CrystalArmour.plugin.js) and the celestial signet its own
 * (CelestialRing.ShootingStars.js); the enhanced crystal key joins this menu from KeyChests' data.
 */
const SONG_OF_THE_ELVES = "song_of_the_elves";
const SINGING_SEQUENCE = "prif_crystal_singing";
const SINGING_SOUND = 8;
const SONG_DELAY_TICKS = 5;
const SING_ATTRIBUTE = "crystal-singing:singing";
const NO_MATERIALS = "You do not have all of the required materials and requirements to make anything.";
const LEVEL_TOO_LOW = "You need to be at least level {level} Crafting and Smithing to create anything through crystal singing.";
const SONG = "With the help of the crystal bowl, you sing a beautiful song and shape the crystals.";
const SHARD_NAME = "CRYSTAL_SHARD";

/** The Prifddinas bowls (capture 819; both are this loc). The Gauntlet's has its own, the others have no capture of their menu. */
const BOWL_LOC = "prif_singing_bowl";

/** The Crystal Singing Recipes book (loc 37344, Read). Interface 'prif_recipes' (181) lays out and fills every entry itself (onLoad cs2 2924). */
const RECIPES_BOOK = "Crystal Singing Recipes";
const RECIPES_INTERFACE = 181;
/** Locs 35978 and 36075 share the name and belong to the Gauntlet (Prep.Gauntlet.js), so the hook is keyed by name but only takes this one. */
const RECIPES_LOC = 37344;

/**
 * item names are ItemIdentifiers keys. `quest` recipes also need Song of the Elves (Wiki: crystal
 * equipment pages), `diary` ones the Hard Western Provinces Diary. `source`: capture ids where one shows the whole song, else the Wiki page.
 */
const RECIPES = [
  { product: "ETERNAL_TELEPORT_CRYSTAL", needs: [["ENHANCED_CRYSTAL_TELEPORT_SEED", 1]], shards: 100, level: 80, xp: 5000, source: "capture 312; Wiki Eternal_teleport_crystal" },
  { product: "BLADE_OF_SAELDOR", needs: [["ENHANCED_CRYSTAL_WEAPON_SEED", 1]], shards: 100, level: 82, xp: 5000, quest: true, source: "capture 1159; Wiki Blade_of_Saeldor" },
  { product: "BOW_OF_FAERDHINEN", needs: [["ENHANCED_CRYSTAL_WEAPON_SEED", 1]], shards: 100, level: 82, xp: 5000, quest: true, source: "capture 1159; Wiki Bow_of_Faerdhinen" },
  { product: "CRYSTAL_BOW_3", needs: [["CRYSTAL_WEAPON_SEED", 1]], shards: 40, level: 78, xp: 2000, quest: true, source: "captures 819, 1134; Wiki Crystal_bow" },
  { product: "CRYSTAL_HALBERD_3", needs: [["CRYSTAL_WEAPON_SEED", 1]], shards: 40, level: 78, xp: 2000, quest: true, diary: true, source: "cache prif_recipes (cs2 2924); Wiki Crystal_halberd, Crystal_singing" },
  { product: "CRYSTAL_SHIELD_3", needs: [["CRYSTAL_WEAPON_SEED", 1]], shards: 40, level: 78, xp: 2000, quest: true, source: "capture 1162; Wiki Crystal_shield" },
  { product: "CRYSTAL_AXE", needs: [["CRYSTAL_TOOL_SEED", 1], ["DRAGON_AXE", 1]], shards: 120, level: 76, xp: 6000, quest: true, source: "Wiki Crystal_axe" },
  { product: "CRYSTAL_PICKAXE", needs: [["CRYSTAL_TOOL_SEED", 1], ["DRAGON_PICKAXE", 1]], shards: 120, level: 76, xp: 6000, quest: true, source: "Wiki Crystal_pickaxe" },
  { product: "CRYSTAL_HARPOON", needs: [["CRYSTAL_TOOL_SEED", 1], ["DRAGON_HARPOON", 1]], shards: 120, level: 76, xp: 6000, quest: true, source: "Wiki Crystal_harpoon" },
  { product: "CRYSTAL_FELLING_AXE", needs: [["CRYSTAL_TOOL_SEED", 1], ["DRAGON_FELLING_AXE", 1]], shards: 120, level: 76, xp: 6000, quest: true, source: "Wiki Crystal_felling_axe, Crystal_singing" },
];

let core = null;
let api = null;
let recipes = null;

/** The recipes with their item names resolved to ids, and the enhanced crystal key from KeyChests' data. */
function resolve() {
  if (recipes) return recipes;
  const ids = core.ItemIdentifiers;
  const shard = ids[SHARD_NAME];
  recipes = RECIPES.map((row) => ({
    ...row,
    productId: ids[row.product],
    needs: [...row.needs.map(([name, amount]) => ({ itemId: ids[name], amount })), { itemId: shard, amount: row.shards }],
  }));
  const key = require("../objects/keychests/Data.KeyChests").get().enhancedKey;
  recipes.push({ product: "ENHANCED_CRYSTAL_KEY", productId: key.productId, needs: key.needs, level: key.level, xp: key.xp, quest: false, source: "key-chests.json" });
  return recipes;
}

/** The Hard Western Provinces Diary, which the crystal halberd recipe needs (Wiki: Crystal_halberd). */
function westernHardDiaryComplete(player) {
  const request = { player, diary: "western", tier: "hard", complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function songOfTheElvesComplete(player) {
  const request = { player, key: SONG_OF_THE_ELVES, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text), new EndDialogue(1)));
}

/** How many of the recipe the player's inventory makes (0 when a requirement beyond materials is missing). */
function maxMade(player, recipe) {
  if (recipe.quest && !songOfTheElvesComplete(player)) return 0;
  if (recipe.diary && !westernHardDiaryComplete(player)) return 0;
  const inventory = player.getInventory();
  return Math.min(...recipe.needs.map(({ itemId, amount }) => Math.floor(inventory.getAmount(itemId) / amount)));
}

function meetsLevel(player, recipe) {
  const skills = player.getSkillManager();
  return [core.Skill.SMITHING, core.Skill.CRAFTING].every((skill) => skills.getCurrentLevel(skill) >= recipe.level);
}

/** `only`: the recipes using this item, for an item used on the bowl; omitted for Sing-crystal. */
function open(player, only) {
  if (player.getAttribute(SING_ATTRIBUTE)) return;
  const candidates = resolve().filter((recipe) => !only || recipe.needs.some((need) => need.itemId === only));
  const makeable = candidates.filter((recipe) => maxMade(player, recipe) > 0);
  if (makeable.length === 0) return statement(player, NO_MATERIALS);
  const ready = makeable.filter((recipe) => meetsLevel(player, recipe));
  if (ready.length === 0) {
    return statement(player, LEVEL_TOO_LOW.replace("{level}", Math.min(...makeable.map((recipe) => recipe.level))));
  }
  player.getPacketSender().sendCreationMenu(new core.CreationMenu("How many would you like to make?", ready.map((recipe) => recipe.productId), {
    execute: (itemId, amount) => sing(player, itemId, amount),
  }, { maxAmount: Math.max(...ready.map((recipe) => maxMade(player, recipe))) }));
}

/** Takes the materials and gives the products at once, then the song message after SONG_DELAY_TICKS. */
function sing(player, productId, amount) {
  const recipe = resolve().find((candidate) => candidate.productId === productId);
  if (!recipe || player.getAttribute(SING_ATTRIBUTE)) return false;
  const made = Math.min(Math.max(1, Math.floor(Number(amount) || 1)), maxMade(player, recipe));
  if (made <= 0 || !meetsLevel(player, recipe)) return false;
  const inventory = player.getInventory();
  for (const { itemId, amount: need } of recipe.needs) inventory.delete(itemId, need * made);
  for (let index = 0; index < made; index++) inventory.adds(productId, 1);
  inventory.refreshItems();
  const sequence = core.CacheDefinitions?.getSeqId?.(SINGING_SEQUENCE);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  player.getPacketSender().sendSound(SINGING_SOUND, 1, 0);
  const skills = player.getSkillManager();
  skills.addExperiences(core.Skill.SMITHING, recipe.xp * made);
  skills.addExperiences(core.Skill.CRAFTING, recipe.xp * made);
  player.setAttribute(SING_ATTRIBUTE, true);
  core.TaskManager.submit(new (class SongTask extends core.Task {
    constructor() { super(SONG_DELAY_TICKS, player, false); }
    execute() {
      this.stop();
      player.setAttribute(SING_ATTRIBUTE, false);
      player.sendMessage(SONG);
      statement(player, SONG);
    }
  })());
  return true;
}

function readRecipes({ player, objectId }) {
  if (objectId !== RECIPES_LOC) return false;
  player.getPacketSender().sendInterface(RECIPES_INTERFACE);
}

function isBowl(objectId) {
  return objectId === core.CacheDefinitions.getLocId(BOWL_LOC);
}

function singCrystal({ player, objectId }) {
  if (!isBowl(objectId)) return false;
  open(player);
}

/** An input item used on the bowl opens the menu of what it goes into. */
function useOnBowl({ player, itemId, objectId }) {
  if (!isBowl(objectId)) return false;
  open(player, itemId);
}

/** The names of every item the recipes use, for hooking item-on-bowl. */
function inputNames() {
  const ids = new Set([core.CacheDefinitions.getObjId("crystal_key")]);
  for (const row of RECIPES) for (const [name] of row.needs) ids.add(core.ItemIdentifiers[name]);
  return [...new Set([...ids].map((id) => core.ItemDefinition.forId(id).getName()))];
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  recipes = null;
}

module.exports = {
  name: "CrystalSinging",
  description: "Crystal singing at the Prifddinas singing bowl: turns crystal seeds and shards into crystal tools, weapons and teleport crystals for Smithing and Crafting XP.",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
    api.onObjectInteraction("Singing bowl", { "Sing-crystal": singCrystal });
    api.onObjectInteraction(RECIPES_BOOK, { Read: readRecipes });
    for (const name of inputNames()) api.onItemOnObject(name, "Singing bowl", useOnBowl, { noted: false });
  },
  _test: { RECIPES, resolve, open, sing, singCrystal, useOnBowl, readRecipes, maxMade, meetsLevel, inputNames, attach, NO_MATERIALS, SONG },
};
