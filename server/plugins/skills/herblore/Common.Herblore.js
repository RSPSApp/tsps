/**
 * What the Herblore units share: the herbs and recipes (plugins/skills/data/herblore.json, by
 * cache gameval), the skill and quest checks, the captured animation, sounds and message types,
 * and a keyed step runner a click or walk cancels. See docs/herblore.md.
 */
const DATA = require("../data/herblore.json");

/** human_herbing_vial: mixing, every step (rsprox captures). */
const MIX_ANIMATION = "human_herbing_vial";
/** The mixing sound with every step (rsprox captures; Sound.POTION_MIX's 2611 is not it). */
const MIX_SOUND = 2608;

/**
 * The cache's own skill guide sentence (dbrow skill_feature_herblore_overview_0); live's
 * message for Herblore before Druidic Ritual has no capture.
 */
const DRUIDIC_RITUAL_MESSAGE = "You must complete the Druidic Ritual quest to unlock the Herblore skill.";

let api = null;
let core = null;
let herbsByGrimy = null;
let recipesByIngredient = null;
let unfinishedByHerb = null;
let grindsByItem = null;

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
}

function gameval(kind, name) {
  const { CacheDefinitions } = core;
  const id = kind === "obj" ? CacheDefinitions.getObjId(name) : CacheDefinitions.getSeqId(name);
  if (!Number.isInteger(id)) throw new Error(`[Herblore] unknown ${kind} gameval ${name}`);
  return id;
}

const items = (list) => (list ?? []).map(([name, count]) => ({ id: gameval("obj", name), count }));

function index() {
  if (herbsByGrimy) return;
  herbsByGrimy = new Map();
  for (const herb of DATA.herbs) {
    herbsByGrimy.set(gameval("obj", herb.grimy), { ...herb, grimyId: gameval("obj", herb.grimy), cleanId: gameval("obj", herb.clean) });
  }
  recipesByIngredient = new Map();
  unfinishedByHerb = new Map();
  grindsByItem = new Map();
  for (const row of DATA.grinding) {
    grindsByItem.set(gameval("obj", row.item), { ...row, itemId: gameval("obj", row.item), productId: gameval("obj", row.product), amount: row.amount ?? [1, 1] });
  }
  const vialOfWater = gameval("obj", "vial_water");
  for (const row of DATA.recipes) {
    const recipe = { ...row, productId: gameval("obj", row.product), ingredients: items(row.ingredients), returns: items(row.returns) };
    for (const { id } of recipe.ingredients) {
      if (!recipesByIngredient.has(id)) recipesByIngredient.set(id, []);
      recipesByIngredient.get(id).push(recipe);
    }
    const herb = recipe.ingredients.find(({ id }) => id !== vialOfWater);
    if (recipe.ingredients.length === 2 && herb && recipe.ingredients.some(({ id }) => id === vialOfWater)) {
      unfinishedByHerb.set(herb.id, recipe);
    }
  }
}

/** The grimy herb's row ({ grimyId, cleanId, level, xp }), or null. */
function herbFor(grimyId) {
  index();
  return herbsByGrimy.get(grimyId) ?? null;
}

/** What a pestle and mortar grinds the item into ({ itemId, productId, amount, message }), or null. */
function grindFor(itemId) {
  index();
  return grindsByItem.get(itemId) ?? null;
}

/** Every recipe that takes both items, in data order (lowest level first). */
function recipesWith(firstId, secondId) {
  index();
  return (recipesByIngredient.get(firstId) ?? []).filter((recipe) =>
    recipe.ingredients.some(({ id }) => id === secondId) && (firstId !== secondId
      || recipe.ingredients.find(({ id }) => id === firstId).count >= 2));
}

/** A recipe can refuse its last (secondary) ingredient used again on its product. */
function repeatMessage(firstId, secondId) {
  index();
  for (const [ingredientId, productId] of [[firstId, secondId], [secondId, firstId]]) {
    const recipe = (recipesByIngredient.get(ingredientId) ?? []).find((candidate) =>
      candidate.productId === productId && candidate.repeatMessage
      && candidate.ingredients[candidate.ingredients.length - 1].id === ingredientId);
    if (recipe) return recipe.repeatMessage;
  }
  return null;
}

/** "herblore:clean" `{ grimyId, clean, level }`: clean herb and its required Herblore level. */
function answerClean(request) {
  const herb = herbFor(request?.grimyId);
  if (herb) { request.clean = herb.cleanId; request.level = herb.level; }
}

/** "herblore:unfinished" `{ herbId, potion }`: the unfinished potion a clean herb makes (Zahur). */
function answerUnfinished(request) {
  index();
  const recipe = unfinishedByHerb.get(request?.herbId);
  if (recipe) request.potion = recipe.productId;
}

/** The Herblore level the skill checks: the current level, raised by content ("skills:level-boost", a league relic's invisible +12). */
function level(player) {
  const request = { player, skill: core.Skill.HERBLORE, boost: 0 };
  api.emitCustomEvent("skills:level-boost", request);
  return player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) + Math.max(0, request.boost | 0);
}

/** How many potions (or herbs) one cycle makes ("skills:actions-per-cycle", a league relic's all at once); 1 unless content says more. */
function actionsPerCycle(player, kind, recipe = null) {
  const request = { player, skill: core.Skill.HERBLORE, kind, recipe, actions: 1 };
  api.emitCustomEvent("skills:actions-per-cycle", request);
  return Math.max(1, request.actions | 0);
}

/**
 * Whether a quest is done, or started for a "key:started" requirement. A world without the
 * quest system (no answer) does not lock Herblore away.
 */
function questDone(player, requirement) {
  const [key, state] = requirement.split(":");
  const request = { player, key, complete: null, started: null };
  api.emitCustomEvent(state === "started" ? "quest:is-started" : "quest:is-complete", request);
  const answer = state === "started" ? request.started : request.complete;
  return answer !== false;
}

/**
 * Whether content outside the quest system has taught a recipe's `unlock` ("herblore:unlocked"
 * { player, unlock, allowed }: Barbarian Training answers "barbarian_herblore", or
 * "barbarian_herblore:started" for the attack mix Otto asks for). No answer does not lock it.
 */
function unlocked(player, unlock) {
  const request = { player, unlock, allowed: null };
  api.emitCustomEvent("herblore:unlocked", request);
  return request.allowed !== false;
}

/** The player's stage in a quest (`quest:get-stage`), or null when no quest answers. */
function questStage(player, key) {
  const request = { player, key, stage: null };
  api.emitCustomEvent("quest:get-stage", request);
  return typeof request.stage === "number" ? request.stage : null;
}

/** Herblore needs Druidic Ritual; says so and returns false without it. */
function canUseHerblore(player) {
  if (questDone(player, "druidic_ritual")) return true;
  player.sendMessage(DRUIDIC_RITUAL_MESSAGE);
  return false;
}

function wearsHerbloreCape(player) {
  const request = { player, skill: "HERBLORE", result: false };
  api.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function mesbox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function animate(player, seq) {
  player.performAnimation(new core.Animation(gameval("seq", seq)));
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 1, 0);
}

function addXp(player, xp) {
  if (xp > 0) player.getSkillManager().addExperiences(core.Skill.HERBLORE, xp);
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

/** "herblore:herbs": every herb Herblore knows ({ grimyId, cleanId, level, xp }), for content that finds herbs (a league relic). */
function answerHerbs(request) {
  if (!request) return;
  index();
  request.herbs = [...herbsByGrimy.values()].map(({ grimyId, cleanId, level, xp }) => ({ grimyId, cleanId, level, xp }));
}

module.exports = {
  MIX_ANIMATION, MIX_SOUND,
  init, gameval, herbFor, grindFor, recipesWith, repeatMessage, answerClean, answerUnfinished, answerHerbs, level, actionsPerCycle, questDone, unlocked, questStage, canUseHerblore,
  wearsHerbloreCape, spam, mesbox, animate, sound, addXp, run,
  get api() { return api; },
  get core() { return core; },
};
