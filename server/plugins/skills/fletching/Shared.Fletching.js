/**
 * What the Fletching units share: the recipes from data/fletching.json resolved to ids, the
 * item pairs that start them, the make-many menu and the task that makes one batch every few
 * ticks.
 *
 * A recipe starts from one pair of items: its tool on its first material (a knife on logs, a
 * chisel on a gem), or its first material on its second (a bow string on an unstrung bow). Every
 * recipe a pair starts goes in one skillmulti menu, as live does for a knife on logs; a pair with
 * one recipe and only one batch to make skips the menu (rsprox captures 1749: a crossbow string
 * on the only unstrung crossbow strings it on the next tick).
 *
 * The task keeps going while the player walks, as live does, and is keyed to the player so their
 * next interaction cancels it. A carried or worn fletching knife takes a tick off every knife
 * action after the first (Wiki, Fletching knife).
 */
const DATA = require("../data/fletching.json");

const CREATION_ALL_SENTINEL = 28;
const DEFAULT_MENU = "make";
const DEFAULT_ANIMATION = "human_fletching";

let api = null;
let core = null;
let recipes = [];
/** "<lower id>:<higher id>" -> recipes started by that pair, in data order. */
const recipesByPair = new Map();
/** Item id -> { count(player), take(player, amount) }: materials held somewhere else. */
const virtualMaterials = new Map();
/** Item id -> the material id it stands in for when used (a bow string spool for a bow string). */
const triggerAliases = new Map();
/** Player -> their running task. */
const tasks = new Map();
let toolIds = {};
let fletchingKnifeId = null;
let jewellersChiselId = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  toolIds = Object.fromEntries(Object.entries(DATA.tools).map(([name, items]) => [name, items.map(itemId)]));
  fletchingKnifeId = itemId("FLETCHING_KNIFE");
  jewellersChiselId = itemId("JEWELLERS_CHISEL");
  recipes = DATA.recipes.map(resolveRecipe);
  indexRecipes();
}

function getApi() {
  return api;
}

function getCore() {
  return core;
}

function getRecipes() {
  return recipes;
}

function itemId(name) {
  const id = core.ItemIdentifiers[name];
  if (!Number.isInteger(id)) throw new Error(`Fletching: no item named ${name}`);
  return id;
}

/** Animation and varbit names resolve on first use: the cache loads after plugins register. */
function seq(name) {
  const id = core.CacheDefinitions.getSeqId(name);
  if (id == null) throw new Error(`Fletching: no animation named ${name}`);
  return new core.Animation(id);
}

function animationOf(recipe) {
  recipe.animation ??= seq(recipe.animationName);
  return recipe.animation;
}

function varbitId(name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (id == null) throw new Error(`Fletching: no varbit named ${name}`);
  return id;
}

function sound(name) {
  const value = core.Sound[name];
  if (!(value instanceof core.Sound)) throw new Error(`Fletching: no sound named ${name}`);
  return value;
}

function resolveMaterial([name, amount]) {
  const names = DATA.alternatives[name] ?? [name];
  return { ids: names.map(itemId), amount };
}

/** The recipe with its group's defaults filled in and every name turned into an id. */
function resolveRecipe(entry) {
  const group = DATA.groups[entry.group] ?? {};
  const recipe = { ...group, ...entry };
  const menu = DATA.menus[recipe.menu ?? DEFAULT_MENU];
  const ticks = recipe.ticks ?? 2;
  return {
    group: recipe.group,
    outputId: itemId(recipe.output),
    amount: recipe.amount ?? 1,
    amountMax: recipe.amountMax ?? recipe.amount ?? 1,
    level: recipe.level,
    xp: recipe.xp,
    ticks,
    firstTick: recipe.firstTick ?? 1,
    jewellersTicks: recipe.jewellersTicks ?? null,
    knifeBonus: recipe.knifeBonus === true,
    tool: recipe.tool ?? null,
    held: (recipe.held ?? []).map((name) => ({ name, ids: toolIds[name] })),
    materials: recipe.materials.map(resolveMaterial),
    animationName: recipe.animation ?? DEFAULT_ANIMATION,
    animation: null,
    sound: recipe.sound ? sound(recipe.sound) : null,
    message: recipe.message ?? null,
    missingTool: recipe.missingTool ?? null,
    instantVarbit: recipe.instantVarbit ?? null,
    maxSets: recipe.maxSets ?? CREATION_ALL_SENTINEL,
    quest: recipe.quest ? { key: recipe.quest[0], state: recipe.quest[1] } : null,
    unlock: recipe.unlock ?? null,
    menu,
  };
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function addPair(a, b, recipe) {
  const key = pairKey(a, b);
  if (!recipesByPair.has(key)) recipesByPair.set(key, []);
  const list = recipesByPair.get(key);
  if (!list.includes(recipe)) list.push(recipe);
}

/** The pairs that start each recipe. */
function triggerPairs(recipe) {
  const pairs = [];
  if (recipe.tool) {
    for (const tool of toolIds[recipe.tool]) {
      for (const base of recipe.materials[0].ids) pairs.push([tool, base]);
    }
    return pairs;
  }
  for (const a of recipe.materials[0].ids) {
    for (const b of recipe.materials[1].ids) pairs.push([a, b]);
  }
  return pairs;
}

function indexRecipes() {
  recipesByPair.clear();
  for (const recipe of recipes) {
    for (const [a, b] of triggerPairs(recipe)) addPair(a, b, recipe);
  }
}

/** Lets another item start the recipes of a material it stands in for. */
function addTriggerAlias(aliasId, materialId) {
  triggerAliases.set(aliasId, materialId);
  for (const recipe of recipes) {
    for (const [a, b] of triggerPairs(recipe)) {
      if (a === materialId) addPair(aliasId, b, recipe);
      if (b === materialId) addPair(a, aliasId, recipe);
    }
  }
}

function registerVirtualMaterial(materialId, source) {
  virtualMaterials.set(materialId, source);
}

function recipesFor(a, b) {
  return recipesByPair.get(pairKey(a, b)) ?? [];
}

function fletchingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.FLETCHING);
}

function carries(player, ids) {
  return ids.some((id) => player.getInventory().contains(id) || player.getEquipment().contains(id));
}

function questState(player, quest) {
  const request = { player, key: quest.key, started: false, complete: false };
  api.emitCustomEvent(quest.state === "complete" ? "quest:is-complete" : "quest:is-started", request);
  return quest.state === "complete" ? request.complete === true : request.started === true;
}

function hasSlayerUnlock(player, name) {
  const request = { player, name, unlocked: false };
  api.emitCustomEvent("slayer:has-unlock", request);
  return request.unlocked === true;
}

/** Quest and Slayer unlocks the recipe needs (the Wiki's recipe notes). */
function unlocked(player, recipe) {
  if (recipe.quest && !questState(player, recipe.quest)) return false;
  if (recipe.unlock && !hasSlayerUnlock(player, recipe.unlock)) return false;
  return true;
}

/** How many of a material the player can use, a virtual source's (the spool's) included. */
function heldAmount(player, material) {
  const inventory = player.getInventory();
  let total = 0;
  for (const id of material.ids) {
    total += inventory.getAmount(id);
    const source = virtualMaterials.get(id);
    if (source) total += source.count(player);
  }
  return total;
}

function batchesAvailable(player, recipe) {
  let batches = Number.MAX_SAFE_INTEGER;
  for (const material of recipe.materials) {
    batches = Math.min(batches, Math.floor(heldAmount(player, material) / material.amount));
  }
  return batches === Number.MAX_SAFE_INTEGER ? 0 : batches;
}

function hasTools(player, recipe) {
  if (recipe.tool && !carries(player, toolIds[recipe.tool])) return false;
  return recipe.held.every((tool) => carries(player, tool.ids));
}

/**
 * Takes `amount` of a material, starting with the item the player clicked: the feather they used,
 * or the spool's bow strings when they used the spool. Other ids follow in data order.
 */
function takeMaterial(player, material, amount, via) {
  const inventory = player.getInventory();
  const clicked = triggerAliases.get(via) ?? via;
  const order = material.ids.includes(clicked) ? [clicked, ...material.ids.filter((id) => id !== clicked)] : material.ids;
  const sourceFirst = triggerAliases.has(via);
  let remaining = amount;
  for (const id of order) {
    const source = virtualMaterials.get(id);
    if (source && sourceFirst) remaining -= source.take(player, remaining);
    const fromInventory = Math.min(remaining, inventory.getAmount(id));
    if (fromInventory > 0) {
      inventory.deleteNumber(id, fromInventory);
      remaining -= fromInventory;
    }
    if (source && !sourceFirst && remaining > 0) remaining -= source.take(player, remaining);
    if (remaining <= 0) return;
  }
}

/** Whether the product fits once the materials are taken. */
function fits(player, recipe) {
  const inventory = player.getInventory();
  const stackable = core.ItemDefinition.forId(recipe.outputId).isStackable();
  if (stackable && inventory.contains(recipe.outputId)) return true;
  if (inventory.getFreeSlots() > 0) return true;
  return recipe.materials.some((material) => material.ids.some((id) => {
    if (!inventory.contains(id)) return false;
    return !core.ItemDefinition.forId(id).isStackable() || inventory.getAmount(id) <= material.amount;
  }));
}

function formatMessage(message, amount) {
  return message.replace("{amount}", String(amount));
}

/** One batch: checks, materials out, product in, XP, animation, sound and message. */
function makeBatch(player, recipe, via) {
  if (fletchingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return false;
  }
  if (!hasTools(player, recipe) || batchesAvailable(player, recipe) <= 0) return false;
  if (!fits(player, recipe)) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }

  for (const material of recipe.materials) takeMaterial(player, material, material.amount, via);
  const amount = recipe.amountMax > recipe.amount
    ? recipe.amount + Math.floor(Math.random() * (recipe.amountMax - recipe.amount + 1))
    : recipe.amount;
  player.getInventory().addItem(new core.Item(recipe.outputId, amount));
  player.performAnimation(animationOf(recipe));
  if (recipe.sound) core.Sounds.sendSound(player, recipe.sound);
  if (recipe.message) player.sendMessage(formatMessage(recipe.message, amount));
  if (recipe.xp > 0) player.getSkillManager().addExperiences(core.Skill.FLETCHING, recipe.xp);
  api.emitCustomEvent("fletching:made", { player, itemId: recipe.outputId, amount });
  return true;
}

function interval(player, recipe) {
  if (recipe.jewellersTicks && player.getInventory().contains(jewellersChiselId)) return recipe.jewellersTicks;
  if (recipe.knifeBonus && carries(player, [fletchingKnifeId])) return recipe.ticks - 1;
  return recipe.ticks;
}

function stopFletching(player, resetAnimation = false) {
  const task = tasks.get(player);
  if (!task) return;
  tasks.delete(player);
  task.stop();
  if (resetAnimation) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
}

function createTask(player, recipe, batches, via) {
  class FletchingTask extends core.Task {
    constructor() {
      super(1, player.getIndex(), false);
      this.ticks = 0;
      this.nextTick = recipe.firstTick;
      this.remaining = batches;
    }

    stop() {
      super.stop();
      if (tasks.get(player) === this) tasks.delete(player);
    }

    execute() {
      if (!player.isRegistered?.() || player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      if (player.getForceMovement() != null) {
        stopFletching(player, true);
        return;
      }
      if (++this.ticks < this.nextTick) return;
      this.nextTick = this.ticks + interval(player, recipe);
      if (!makeBatch(player, recipe, via)) {
        stopFletching(player, true);
        return;
      }
      if (--this.remaining <= 0 || batchesAvailable(player, recipe) <= 0) stopFletching(player);
    }
  }
  return new FletchingTask();
}

/** Starts making up to `requested` batches (28 = all), the first on the recipe's first tick. */
function startFletching(player, recipe, requested, via) {
  if (fletchingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return;
  }
  const available = batchesAvailable(player, recipe);
  if (available <= 0 || !Number.isInteger(requested) || requested <= 0) return;
  const batches = Math.min(requested === CREATION_ALL_SENTINEL ? available : Math.min(requested, available), recipe.maxSets);
  stopFletching(player);
  if (recipe.ticks === 0) {
    makeBatch(player, recipe, via);
    return;
  }
  const task = createTask(player, recipe, batches, via);
  tasks.set(player, task);
  api.getTaskManager().submit(task);
  player.performAnimation(animationOf(recipe));
}

/** The skillmulti menu for the recipes a pair starts, each offered up to what can be made. */
function openMenu(player, choices, via) {
  stopFletching(player);
  const byOutput = new Map(choices.map((recipe) => [recipe.outputId, recipe]));
  const maxAmount = Math.max(...choices.map((recipe) => Math.min(batchesAvailable(player, recipe), recipe.maxSets)), 1);
  const { title, mode } = choices[0].menu;
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(
    title,
    choices.map((recipe) => recipe.outputId),
    {
      execute: (outputId, amount) => {
        const recipe = byOutput.get(outputId);
        if (recipe) startFletching(player, recipe, amount, via);
      },
    },
    { maxAmount: Math.min(maxAmount, CREATION_ALL_SENTINEL), ...(mode != null ? { mode } : {}) }
  ));
}

/**
 * Darts and bolts: one set per click while the "Make-X for darts and bolts" setting is off (its
 * varbit 0), as every rsprox capture shows (96, 1757, 3280).
 */
function isInstant(player, recipe) {
  return recipe.instantVarbit != null && player.getPacketSender().getVarbit(varbitId(recipe.instantVarbit)) === 0;
}

function missingToolMessage(recipe) {
  if (recipe.missingTool) return recipe.missingTool;
  const tool = recipe.held.find(Boolean)?.name ?? recipe.tool;
  return `You'll need a ${tool} to do that.`;
}

/**
 * Item on item: the recipes the pair starts. Returns true when Fletching took the click. A
 * recipe whose quest or Slayer unlock is missing is left out, as live leaves it out of the menu.
 */
function handlePair(player, usedId, usedWithId) {
  const all = recipesFor(usedId, usedWithId);
  if (all.length === 0) return false;
  const choices = all.filter((recipe) => unlocked(player, recipe));
  if (choices.length === 0) {
    player.sendMessage("Nothing interesting happens.");
    return true;
  }
  const missing = choices.find((recipe) => !hasTools(player, recipe));
  if (missing && choices.every((recipe) => !hasTools(player, recipe))) {
    player.sendMessage(missingToolMessage(missing));
    return true;
  }
  const usable = choices.filter((recipe) => hasTools(player, recipe) && batchesAvailable(player, recipe) > 0);
  // An empty spool on an unstrung bow does nothing at all, not even "Nothing interesting happens."
  if (usable.length === 0) return true;
  const via = usedId;

  if (usable.length === 1) {
    const recipe = usable[0];
    if (recipe.ticks === 0 || isInstant(player, recipe)) {
      stopFletching(player);
      makeBatch(player, recipe, via);
      return true;
    }
    if (batchesAvailable(player, recipe) === 1) {
      startFletching(player, recipe, 1, via);
      return true;
    }
  }
  openMenu(player, usable, via);
  return true;
}

module.exports = {
  init,
  getApi,
  getCore,
  getRecipes,
  itemId,
  varbitId,
  animationOf,
  recipesFor,
  handlePair,
  stopFletching,
  makeBatch,
  batchesAvailable,
  registerVirtualMaterial,
  addTriggerAlias,
  unlocked,
};
