/**
 * What the Cooking units share: the foods, doughs, recipes and wines
 * (plugins/skills/data/cooking.json, by cache gameval), the level and cape checks, message and
 * varbit helpers, and a keyed step runner a click or walk cancels. See docs/cooking.md.
 */
const DATA = require("../data/cooking.json");

let api = null;
let core = null;
let cookablesByRaw = null;
let recipesByIngredient = null;
let recipesByProduct = null;
let doughs = null;
let wines = null;

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
}

function gameval(kind, name) {
  const { CacheDefinitions } = core;
  const lookup = { obj: CacheDefinitions.getObjId, seq: CacheDefinitions.getSeqId, spotanim: CacheDefinitions.getSpotanimId }[kind];
  const id = lookup.call(CacheDefinitions, name);
  if (!Number.isInteger(id)) throw new Error(`[Cooking] unknown ${kind} gameval ${name}`);
  return id;
}

/** An obj gameval name, or a numeric item id for items the cache names ambiguously. */
const obj = (nameOrId) => typeof nameOrId === "number" ? nameOrId : gameval("obj", nameOrId);
const ingredient = (entry) => Array.isArray(entry)
  ? { id: obj(entry[0]), count: entry[1] }
  : { id: obj(entry), count: 1 };

function index() {
  if (cookablesByRaw) return;
  cookablesByRaw = new Map();
  for (const row of DATA.cookables) {
    if (!cookablesByRaw.has(obj(row.raw))) {
      cookablesByRaw.set(obj(row.raw), { ...row, raw: obj(row.raw), cooked: obj(row.cooked), burnt: obj(row.burnt) });
    }
  }
  recipesByIngredient = new Map();
  recipesByProduct = new Map();
  for (const row of DATA.recipes) {
    const recipe = {
      ...row,
      productId: obj(row.product),
      ingredients: row.ingredients.map(ingredient),
      returns: (row.returns ?? []).map(ingredient),
      xp: row.xp ?? 0,
      timing: row.timing ?? [1, 2],
    };
    recipesByProduct.set(recipe.productId, recipe);
    for (const { id } of recipe.ingredients) {
      if (!recipesByIngredient.has(id)) recipesByIngredient.set(id, []);
      recipesByIngredient.get(id).push(recipe);
    }
  }
  const [flour, pot] = DATA.doughs.flour;
  doughs = {
    flourId: obj(flour),
    potId: obj(pot),
    waters: DATA.doughs.waters.map(([water, empty]) => ({ id: obj(water), emptyId: obj(empty) })),
    products: DATA.doughs.products.map((row) => ({ ...row, productId: obj(row.product) })),
  };
  wines = DATA.wines.map((row) => ({
    ...row, grapesId: obj(row.grapes), unfermentedId: obj(row.unfermented), wineId: obj(row.wine), badId: obj(row.bad),
  }));
}

/** Every food a fire or range cooks, by its raw item ({ raw, cooked, burnt, level, xp, stopBurn, ... }); none before init. */
function cookables() {
  if (!core) return new Map();
  index();
  return cookablesByRaw;
}

/** The recipe these two items make, in data order (lowest level first), or null. */
function recipeWith(firstId, secondId) {
  index();
  return (recipesByIngredient.get(firstId) ?? []).find((recipe) =>
    recipe.ingredients.some(({ id }) => id === secondId) && firstId !== secondId) ?? null;
}

/** The item-on-item recipe that makes `productId`, or null. */
function recipeForProduct(productId) {
  index();
  return recipesByProduct.get(productId) ?? null;
}

/** Flour, the waters it mixes with and the doughs they make ({ flourId, potId, waters, products }). */
function doughData() {
  index();
  return doughs;
}

/** The wines ({ grapesId, unfermentedId, wineId, badId, level, xp, chance }). */
function wineData() {
  index();
  return wines;
}

/** The Cooking level the skill checks: the current level, raised by content ("skills:level-boost", a league relic's invisible +12). */
function level(player) {
  const request = { player, skill: core.Skill.COOKING, boost: 0 };
  api?.emitCustomEvent("skills:level-boost", request);
  return player.getSkillManager().getCurrentLevel(core.Skill.COOKING) + Math.max(0, request.boost | 0);
}

/** How many items one cycle makes ("skills:actions-per-cycle", a league relic's all at once); 1 unless content says more. */
function actionsPerCycle(player, kind) {
  const request = { player, skill: core.Skill.COOKING, kind, actions: 1 };
  api?.emitCustomEvent("skills:actions-per-cycle", request);
  return Math.max(1, request.actions | 0);
}

/** Wiki: a worn Cooking cape (or max cape) never burns food, and supersedes the gauntlets. */
function wearsCookingCape(player) {
  const request = { player, skill: "COOKING", result: false };
  api?.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

/** "a shark", "an anglerfish", "some shrimps", "the giant krill". */
function withArticle(name, article) {
  return `${article ?? (/^[aeiou]/i.test(name) ? "an" : "a")} ${name}`;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function mesbox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function sendVarbit(player, name, value) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, value);
}

/** Every knife a knife-on-item cut accepts (the cache's plain "Knife" objs). */
const KNIFE_NAMES = ["KNIFE", "KNIFE_2", "KNIFE_3", "KNIFE_4", "KNIFE_5"];

function knives() {
  return new Set(KNIFE_NAMES.map((name) => core.ItemIds[name]).filter(Number.isInteger));
}

function addXp(player, xp) {
  if (xp > 0) player.getSkillManager().addExperiences(core.Skill.COOKING, xp);
}

/**
 * Runs `step(tick)` every tick, as a task keyed to the player so a walk or a click cancels it.
 * Clicks are handled in the player's turn, after the cycle's tasks have run, so tick 1 is the
 * cycle after the click: something captured `n` ticks after the click happens on tick `n`.
 * `step` returns false to stop.
 */
function run(player, step) {
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || step(++tick) === false) this.stop();
    }
  })());
}

module.exports = {
  init, gameval, cookables, recipeWith, recipeForProduct, doughData, wineData, level, actionsPerCycle, wearsCookingCape, withArticle,
  spam, mesbox, sendVarbit, knives, addXp, run,
  get api() { return api; },
  get core() { return core; },
};
