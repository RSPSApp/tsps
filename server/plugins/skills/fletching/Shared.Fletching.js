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
 * The task's first execute is the cycle after the click, so `firstTick` n is capture tick +n. The
 * recipe's animation (and its sound with `startSound`) opens the loop on the click's own tick, or
 * on `startTick` when the group sets one (null: no opening, the first batch animates).
 * Every recipe message is a spam line (rsprox captures).
 *
 * The task keeps going while the player walks, as live does, and is keyed to the player so their
 * next interaction cancels it. A carried or worn fletching knife takes a tick off every knife
 * action after the first (Wiki, Fletching knife).
 */
const DATA = require("../data/fletching.json");
const SkillActions = require("../SkillActions");

const CREATION_ALL_SENTINEL = 28;
const DEFAULT_MENU = "make";
const DEFAULT_ANIMATION = "human_fletching";

const PRESET_TEXT = "Preset items cannot be used for this.";

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
  return {
    ids: names.map((entry) => itemId(typeof entry === "string" ? entry : entry.item)),
    // The Wiki documents alternatives that work only as the used item, not the target.
    usedOnlyIds: names.filter((entry) => entry.usedOnly).map((entry) => itemId(entry.item)),
    amount,
  };
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
    startTick: recipe.startTick === undefined ? 0 : recipe.startTick,
    startSound: recipe.startSound === true,
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

function locationSnapshot(location) {
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
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
  return (recipesByPair.get(pairKey(a, b)) ?? [])
    .filter((recipe) => !recipe.materials.some((material) => material.usedOnlyIds.includes(b)));
}

/** The Fletching level the skill checks: the current level, raised by content ("skills:level-boost", a league relic's invisible +12). */
function fletchingLevel(player) {
  const request = { player, skill: core.Skill.FLETCHING, boost: 0 };
  api.emitCustomEvent("skills:level-boost", request);
  return player.getSkillManager().getCurrentLevel(core.Skill.FLETCHING) + Math.max(0, request.boost | 0);
}

/** How many batches one cycle makes ("skills:actions-per-cycle", a league relic's all at once); 1 unless content says more. */
function actionsPerCycle(player, recipe) {
  const request = { player, skill: core.Skill.FLETCHING, kind: recipe.group, actions: 1 };
  api.emitCustomEvent("skills:actions-per-cycle", request);
  return Math.max(1, request.actions | 0);
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

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem() || item.getMetaValue(Item.UNTRADEABLE_META) === true
    || item.getMetaValue(Item.UNBANKABLE_META) === true;
}

/** How many of `id` a recipe can consume: the unrestricted copies. */
function plainAmount(inventory, id) {
  if (typeof inventory.getItems !== "function") return inventory.getAmount(id);
  return inventory.getItems().reduce((total, item) =>
    (item.getId() === id && !restricted(item) ? total + item.getAmount() : total), 0);
}

/** How many of a material the player can use, a virtual source's (the spool's) included. */
function heldAmount(player, material, amountOf = plainAmount) {
  const inventory = player.getInventory();
  let total = 0;
  for (const id of material.ids) {
    total += amountOf(inventory, id);
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

/** The order a material's ids are taken in: the clicked one, then data order. */
function takeOrder(material, via) {
  const clicked = triggerAliases.get(via) ?? via;
  return material.ids.includes(clicked) ? [clicked, ...material.ids.filter((id) => id !== clicked)] : material.ids;
}

/**
 * Plans taking a recipe's materials, starting with the item the player clicked: the feather they
 * used, or the spool's bow strings when they used the spool. Other ids follow in data order. Preset
 * (and other restricted) copies are never part of the plan.
 */
function materialPlan(player, recipe, via) {
  const inventory = player.getInventory();
  const inventoryLeft = new Map();
  const virtualLeft = new Map();
  const plan = [];
  let complete = true;
  const sourceFirst = triggerAliases.has(via);
  for (const material of recipe.materials) {
    let remaining = material.amount;
    for (const id of takeOrder(material, via)) {
      const source = virtualMaterials.get(id);
      if (source && !virtualLeft.has(id)) virtualLeft.set(id, source.count(player));
      if (source && sourceFirst && remaining > 0) {
        const fromSource = Math.min(remaining, virtualLeft.get(id) ?? 0);
        if (fromSource > 0) plan.push({ itemId: id, amount: fromSource, virtual: true });
        virtualLeft.set(id, (virtualLeft.get(id) ?? 0) - fromSource);
        remaining -= fromSource;
      }
      if (!inventoryLeft.has(id)) inventoryLeft.set(id, plainAmount(inventory, id));
      const fromInventory = Math.min(remaining, inventoryLeft.get(id));
      if (fromInventory > 0) plan.push({ itemId: id, amount: fromInventory, virtual: false });
      inventoryLeft.set(id, inventoryLeft.get(id) - fromInventory);
      remaining -= fromInventory;
      if (source && !sourceFirst && remaining > 0) {
        const fromSource = Math.min(remaining, virtualLeft.get(id) ?? 0);
        if (fromSource > 0) plan.push({ itemId: id, amount: fromSource, virtual: true });
        virtualLeft.set(id, (virtualLeft.get(id) ?? 0) - fromSource);
        remaining -= fromSource;
      }
      if (remaining <= 0) break;
    }
    if (remaining > 0) complete = false;
  }
  return { inputs: plan, complete };
}

function canGrantAfterConsumption(player, outputId, amount, plan) {
  const inventory = player.getInventory();
  if (typeof inventory.getCopiedItems !== "function" || typeof core.Inventory !== "function") return true;
  const preview = new core.Inventory(player).setItems(inventory.getCopiedItems());
  for (const input of plan) {
    if (!input.virtual) takePlain(preview, input.itemId, input.amount);
  }
  const output = new core.Item(outputId, amount);
  return preview.getAddableAmount(output) >= amount;
}

/** Takes `amount` of `id` off the inventory's unrestricted copies, in slot order. */
function takePlain(inventory, id, amount) {
  let remaining = amount;
  if (typeof inventory.deleteAtSlot !== "function" || typeof inventory.getItems !== "function") {
    inventory.deleteNumber(id, remaining);
    return amount;
  }
  inventory.getItems().forEach((item, slot) => {
    if (remaining <= 0 || item.getId() !== id || restricted(item)) return;
    const taken = Math.min(remaining, item.getAmount());
    inventory.deleteAtSlot(slot, taken);
    remaining -= taken;
  });
  return amount - remaining;
}

function consumePlan(player, plan) {
  const inventory = player.getInventory();
  const inputs = [];
  for (const entry of plan) {
    if (entry.virtual) virtualMaterials.get(entry.itemId).take(player, entry.amount);
    else takePlain(inventory, entry.itemId, entry.amount);
    inputs.push({ itemId: entry.itemId, amount: entry.amount });
  }
  return inputs;
}

function formatMessage(message, amount) {
  return message.replace("{amount}", String(amount));
}

/** One batch: checks, materials out, product in, XP, animation, sound and message. */
function makeBatch(player, recipe, via, provenance = null) {
  if (fletchingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return false;
  }
  if (!hasTools(player, recipe) || batchesAvailable(player, recipe) <= 0) return false;
  const plan = materialPlan(player, recipe, via);
  if (!plan.complete) return false;
  const amount = recipe.amountMax > recipe.amount
    ? recipe.amount + Math.floor(Math.random() * (recipe.amountMax - recipe.amount + 1))
    : recipe.amount;
  // The batch must fit at its largest roll, or nothing is taken: a batch has fixed inputs, so it
  // refuses rather than making part and losing the rest of the output.
  if (!canGrantAfterConsumption(player, recipe.outputId, recipe.amountMax, plan.inputs)) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  const inputs = consumePlan(player, plan.inputs);
  player.getInventory().addItem(new core.Item(recipe.outputId, amount));
  player.performAnimation(animationOf(recipe));
  if (recipe.sound) core.Sounds.sendSound(player, recipe.sound);
  if (recipe.message) player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, formatMessage(recipe.message, amount));
  if (recipe.xp > 0) player.getSkillManager().addExperiences(core.Skill.FLETCHING, recipe.xp);
  const action = {
    inputItemIds: [...new Set(inputs.map((input) => input.itemId))],
    inputs,
    outputItemId: recipe.outputId,
    stationObjectId: null,
    location: locationSnapshot(player.getLocation()),
    ...(provenance?.startLocation ? { startLocation: provenance.startLocation } : {}),
  };
  api.emitCustomEvent("fletching:made", { player, itemId: recipe.outputId, amount, ...action });
  api.emitCustomEvent("skills:produced", { player, skill: core.Skill.FLETCHING, itemId: recipe.outputId, amount, xp: recipe.xp, kind: recipe.group, ...action });
  return true;
}

/**
 * Ticks to the next batch: the recipe's, its tool's; content may make it faster
 * ("skills:action-interval", a league relic's 2-tick pace), and a fletching knife's tick comes off
 * after that, so the two stack.
 */
function interval(player, recipe) {
  return SkillActions.actionInterval(api, player, core.Skill.FLETCHING, recipe.group, toolInterval(player, recipe), knifeSaving(player, recipe));
}

function toolInterval(player, recipe) {
  if (recipe.jewellersTicks && player.getInventory().contains(jewellersChiselId)) return recipe.jewellersTicks;
  return recipe.ticks;
}

/** A carried or worn fletching knife's one tick off a knife recipe's pace (Wiki, Fletching knife). */
function knifeSaving(player, recipe) {
  return recipe.knifeBonus && carries(player, [fletchingKnifeId]) ? 1 : 0;
}

/** The animation (and the sound, with `startSound`) that opens the loop before the first batch. */
function playOpening(player, recipe) {
  player.performAnimation(animationOf(recipe));
  if (recipe.startSound && recipe.sound) core.Sounds.sendSound(player, recipe.sound);
}

function stopFletching(player, resetAnimation = false) {
  const task = tasks.get(player);
  if (!task) return;
  tasks.delete(player);
  task.stop();
  if (resetAnimation) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
}

function pauseFletching(event) {
  SkillActions.pauseForLevelUp(event, tasks, stopFletching, (task) => task.resumeAnimation());
}

function createTask(player, recipe, batches, via, provenance) {
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

    resumeAnimation() {
      player.performAnimation(animationOf(recipe));
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
      if (this.levelUpPaused) return;
      if (++this.ticks === recipe.startTick) playOpening(player, recipe);
      if (this.ticks < this.nextTick) return;
      this.nextTick = this.ticks + interval(player, recipe);
      const actions = actionsPerCycle(player, recipe);
      for (let done = 0; done < actions; done++) {
        if (!makeBatch(player, recipe, via, provenance)) {
          stopFletching(player, done === 0);
          return;
        }
        if (--this.remaining <= 0 || batchesAvailable(player, recipe) <= 0) {
          stopFletching(player);
          return;
        }
      }
    }
  }
  return new FletchingTask();
}

/** Starts making up to `requested` batches (28 = all), the first on the recipe's first tick. */
function startFletching(player, recipe, requested, via, provenance) {
  if (fletchingLevel(player) < recipe.level) {
    player.sendMessage(`You need a Fletching level of at least ${recipe.level} to do this.`);
    return;
  }
  const available = batchesAvailable(player, recipe);
  if (available <= 0 || !Number.isInteger(requested) || requested <= 0) return;
  const batches = Math.min(requested === CREATION_ALL_SENTINEL ? available : Math.min(requested, available), recipe.maxSets);
  stopFletching(player);
  if (recipe.ticks === 0) {
    makeBatch(player, recipe, via, provenance);
    return;
  }
  const task = createTask(player, recipe, batches, via, provenance);
  tasks.set(player, task);
  api.getTaskManager().submit(task);
  if (recipe.startTick === 0) playOpening(player, recipe);
}

/** The skillmulti menu for the recipes a pair starts, each offered up to what can be made. */
function openMenu(player, choices, via, provenance) {
  stopFletching(player);
  const byOutput = new Map(choices.map((recipe) => [recipe.outputId, recipe]));
  const maxAmount = Math.max(...choices.map((recipe) => Math.min(batchesAvailable(player, recipe), recipe.maxSets)), 1);
  const { title, mode } = choices[0].menu;
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(
    formatMessage(title, choices[0].amount),
    choices.map((recipe) => recipe.outputId),
    {
      execute: (outputId, amount) => {
        const recipe = byOutput.get(outputId);
        if (recipe) startFletching(player, recipe, amount, via, provenance);
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
  if (all.length === 0) {
    if (!recipesByPair.has(pairKey(usedId, usedWithId))) return false;
    player.sendMessage("Nothing interesting happens.");
    return true;
  }
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
  if (usable.length === 0) {
    const everyCopy = (inventory, id) => inventory.getAmount(id);
    const onlyPreset = choices.some((recipe) => hasTools(player, recipe) && recipe.materials.every((material) =>
      heldAmount(player, material, everyCopy) >= material.amount));
    if (onlyPreset) player.sendMessage(PRESET_TEXT);
    return true;
  }
  const via = usedId;
  const provenance = { startLocation: locationSnapshot(player.getLocation()) };

  if (usable.length === 1) {
    const recipe = usable[0];
    if (recipe.ticks === 0 || isInstant(player, recipe)) {
      stopFletching(player);
      // The instant path (darts and bolts by default) makes as many as content asks for in the one click.
      const actions = actionsPerCycle(player, recipe);
      for (let done = 0; done < actions && batchesAvailable(player, recipe) > 0; done++) {
        if (!makeBatch(player, recipe, via, provenance)) break;
      }
      return true;
    }
    if (batchesAvailable(player, recipe) === 1) {
      startFletching(player, recipe, 1, via, provenance);
      return true;
    }
  }
  openMenu(player, usable, via, provenance);
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
  pauseFletching,
  makeBatch,
  batchesAvailable,
  registerVirtualMaterial,
  addTriggerAlias,
  unlocked,
};
