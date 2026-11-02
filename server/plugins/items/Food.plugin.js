/**
 * Eating. What each food does is plugins/items/data/food.json, keyed by the item's cache name
 * so every id with that name eats the same way; the format is in docs/food.md.
 *
 * Wiki (Food, Food/Fast foods): eating adds 3 ticks to the attack timer (2 for combo foods)
 * and blocks the next bite for the food's eat delay, 3 ticks unless it is a fast food. Combo
 * foods have their own timer, so one can follow ordinary food (and a potion) in the same tick.
 * The messages and the food-eaten counter (varp tracking_food_eaten) follow rsprox recordings.
 */
const DATA = require("./data/food.json");
const {
  restoreRunEnergy,
  curePoisonAndVenom,
  curePoison,
  boostSkill,
  lowerSkillByMax,
  restoreSkillToBaseWithFormula,
} = require("./ConsumableEffects");

const EAT_OPTION = "Eat";
const EAT_ANIMATION = 829; // human_eat
// Ticks eating adds to the attack timer; combo foods add 2 (Wiki: Food).
const ATTACK_DELAY = 3;
const COMBO_ATTACK_DELAY = 2;
const EAT_DELAY = 3;
const COMBO_DELAY = 3;
const HEAL_MESSAGE = "It heals some health.";
/** tracking_food_eaten: every bite counts (rsprox recordings). */
const VARP_FOOD_EATEN = 4518;
const FOOD_EATEN_ATTRIBUTE = "food:eaten";

/** Each eatable name -> its food and which bite it is (0 for the first). */
const FOODS_BY_NAME = new Map();
for (const food of DATA.foods) {
  const names = Array.isArray(food.bites) ? food.bites : [food.name];
  names.forEach((name, bite) => FOODS_BY_NAME.set(name, { food, bite }));
}

let pluginApi;
let core;
/** Cache item ids by name, for leftovers and same-name bites; built on first use. */
let idsByName;
/** Each player's pending second hunter-meat heal: a newer meat replaces it. */
const pendingSecondHeals = new WeakMap();

function init(api) {
  pluginApi = api;
  core = api.core;
}

/** An item's name, or undefined for a note, a placeholder or no item at all. */
function itemName(itemId) {
  if (!core?.CacheDefinitions.hasItem(itemId)) return undefined;
  const definition = core.CacheDefinitions.getItem(itemId);
  return definition && definition.noteTemplate < 0 && definition.placeholderTemplate < 0 ? definition.name : undefined;
}

/** The food an item is and which bite, or undefined. */
function foodBite(itemId) {
  const entry = FOODS_BY_NAME.get(itemName(itemId));
  if (!entry || typeof entry.food.bites !== "number") return entry;
  // Bites that share one name: its ids, lowest first, are the bites in order.
  const bite = idsFor(entry.food.name).indexOf(itemId);
  return bite < 0 ? undefined : { food: entry.food, bite };
}

function idsFor(name) {
  if (!idsByName) {
    const wanted = new Set(FOODS_BY_NAME.keys());
    for (const food of DATA.foods) if (food.leaves) wanted.add(food.leaves);
    idsByName = new Map();
    const { items } = core.CacheDefinitions.getCounts();
    for (let id = 0; id < items; id++) {
      const name = itemName(id);
      if (!wanted.has(name)) continue;
      if (!idsByName.has(name)) idsByName.set(name, []);
      idsByName.get(name).push(id);
    }
  }
  return idsByName.get(name) ?? [];
}

function isFoodItem(itemId) {
  return Number.isInteger(itemId) && itemId > 0 && foodBite(itemId) !== undefined;
}

function isComboFoodItem(itemId) {
  return foodBite(itemId)?.food.combo === true;
}

/** Every item id that is food. */
function foodItemIds() {
  return [...FOODS_BY_NAME.keys()].flatMap(idsFor);
}

/** What the bite leaves in its slot: the next bite, the dish, or nothing. */
function leftover(food, bite) {
  const count = Array.isArray(food.bites) ? food.bites.length : food.bites ?? 1;
  if (bite + 1 < count) {
    if (Array.isArray(food.bites)) return idsFor(food.bites[bite + 1])[0];
    return idsFor(food.name)[bite + 1];
  }
  return food.leaves ? idsFor(food.leaves)[0] : undefined;
}

function eatDelay(food, bite) {
  if (Array.isArray(food.eatDelay)) return food.eatDelay[bite] ?? EAT_DELAY;
  return food.eatDelay ?? EAT_DELAY;
}

/** A skill named in the data ("farming"). */
function skill(name) {
  return core.Skill[name.toUpperCase()];
}

/**
 * Wiki: Anglerfish heals by the eater's Hitpoints level, at most 22. The level they levelled up
 * to, not the health left in it: a low-HP 99 still gets the 99 heal.
 */
function getAnglerfishHeal(hitpointsLevel) {
  let c = 2;
  if (hitpointsLevel >= 25) c = 4;
  if (hitpointsLevel >= 50) c = 6;
  if (hitpointsLevel >= 75) c = 8;
  if (hitpointsLevel >= 93) c = 13;
  return Math.min(22, Math.floor(hitpointsLevel / 10 + c));
}

/**
 * Wiki: anglerfish cannot overheal while its eater is in combat in a PvP
 * area, with either a player or an NPC; everywhere else the heal may raise
 * Hitpoints above the base maximum.
 */
function canAnglerfishOverheal(player) {
  if (!core.Wilderness.isPvpArea(player?.getLocation?.())) {
    return true;
  }
  const combat = player.getCombat?.();
  return combat?.getTarget?.() == null && combat?.getAttacker?.() == null;
}

/**
 * The heal of a bite, from the data: a number, a { min, max } roll, { flat, percent } of
 * Hitpoints level, or `lowestOf`. `levels` (skill name -> base level) feeds `lowestOf`: the lowest of each
 * skill's level divided by its number, rounded as `round` says (the Neypotzli foods).
 */
function healAmount(heal, maxHp, random = Math.random, levels = () => 0) {
  if (typeof heal === "number") return heal;
  if (!heal) return 0;
  if (heal.min !== undefined) return heal.min + Math.floor(random() * (heal.max - heal.min + 1));
  if (heal.lowestOf) {
    const lowest = Math.min(...Object.entries(heal.lowestOf).map(([name, divisor]) => levels(name) / divisor));
    return heal.round === "nearest" ? Math.round(lowest) : Math.floor(lowest);
  }
  return (heal.flat ?? 0) + Math.floor((maxHp * (heal.percent ?? 0)) / 100);
}

/** A player's base level by skill name, for `lowestOf` heals. */
function baseLevels(player) {
  return (name) => player.getSkillManager().getMaxLevel(skill(name));
}

function healBy(player, amount, overheal = 0) {
  if (!(amount > 0)) return 0;
  const skills = player.getSkillManager();
  const current = skills.getCurrentLevel(core.Skill.HITPOINTS);
  const cap = Math.max(current, skills.getMaxLevel(core.Skill.HITPOINTS) + overheal);
  const next = Math.min(current + amount, cap);
  player.setHitpoints(next);
  return next - current;
}

function applyStats(player, effect) {
  for (const [name, amount] of Object.entries(effect.boost ?? {})) boostSkill(player, skill(name), amount, 0);
  for (const [name, amount] of Object.entries(effect.drain ?? {})) lowerSkillByMax(player, skill(name), amount, 0, 1);
  for (const [name, amount] of Object.entries(effect.restore ?? {})) {
    restoreSkillToBaseWithFormula(player, skill(name), typeof amount === "number" ? amount : amount.flat ?? 0,
      typeof amount === "number" ? 0 : amount.percent ?? 0);
  }
  if (effect.runEnergy) restoreRunEnergy(player, effect.runEnergy);
  if (effect.stamina) pluginApi.emitCustomEvent("potions:apply-stamina", { player, energy: 20 });
  if (effect.cureVenom) curePoisonAndVenom(player);
  else if (effect.curePoison) curePoison(player);
}

/** Wiki (Kebab): a random skill but Hitpoints, never drained below 1 nor when 2 or lower. */
function drainRandomSkill(player, amount, random) {
  const skills = core.Skill.values().filter((s) => s !== core.Skill.HITPOINTS);
  const target = skills[Math.floor(random() * skills.length)];
  if (player.getSkillManager().getCurrentLevel(target) <= 2) return undefined;
  lowerSkillByMax(player, target, amount, 0, 1);
  return target;
}

/** One outcome of a food with an effect table (kebabs), by weight. */
function rollOutcome(outcomes, random) {
  const total = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  let roll = random() * total;
  return outcomes.find((outcome) => (roll -= outcome.weight) < 0) ?? outcomes[outcomes.length - 1];
}

/** The second heal of a hunter meat, 7 ticks on; eating another one first replaces it. */
function scheduleSecondHeal(player, then) {
  const token = {};
  pendingSecondHeals.set(player, token);
  core.TaskManager.submit(new core.CountdownTask(player, then.ticks, () => {
    if (pendingSecondHeals.get(player) !== token || player.getHitpoints() <= 0) return;
    pendingSecondHeals.delete(player);
    healBy(player, then.heal);
    applyStats(player, then);
  }));
}

function countBite(player) {
  const eaten = (player.getAttribute(FOOD_EATEN_ATTRIBUTE) ?? 0) + 1;
  player.setAttribute(FOOD_EATEN_ATTRIBUTE, eaten);
  player.getPacketSender().sendConfig(VARP_FOOD_EATEN, eaten);
}

function sendFoodEaten({ player }) {
  const eaten = player.getAttribute(FOOD_EATEN_ATTRIBUTE);
  if (eaten > 0) player.getPacketSender().sendConfig(VARP_FOOD_EATEN, eaten);
}

/** Waits on the eat or combo timer; refuses where food can't be eaten. True when it may go ahead. */
function mayEat(player, itemId, food) {
  if (pluginApi.emitCanEat(player, itemId) === false) {
    player.sendMessage("You cannot eat here.");
    return false;
  }
  if (food.area) {
    const request = { player, area: food.area, inside: false };
    pluginApi.emitCustomEvent("food:area", request);
    if (!request.inside) {
      player.sendMessage("You cannot eat these supplies here.");
      return false;
    }
  }
  const timers = player.getTimers();
  if (timers.has(core.TimerKey.STUN)) {
    player.sendMessage("You're currently stunned!");
    return false;
  }
  if (timers.has(food.combo ? core.TimerKey.KARAMBWAN : core.TimerKey.FOOD)) return false;
  if (food.wildernessOnly) {
    const location = player.getLocation();
    if (core.Wilderness.levelAt(location.getX(), location.getY()) <= 0) {
      player.sendMessage(`The ${itemName(itemId).toLowerCase()} can be eaten only in the Wilderness.`);
      return false;
    }
  }
  return true;
}

function startTimers(player, food, bite) {
  const timers = player.getTimers();
  timers.extendOrRegister(core.TimerKey.FOOD, eatDelay(food, bite));
  player.getCombat().delayAttack(food.combo ? COMBO_ATTACK_DELAY : ATTACK_DELAY);
  if (food.combo) {
    timers.registers(core.TimerKey.KARAMBWAN, COMBO_DELAY);
    timers.registers(core.TimerKey.POTION, COMBO_DELAY);
  }
}

/** Heals and applies the food's effects; returns the messages to show after the eat message. */
function applyFood(player, food, random = Math.random) {
  const skills = player.getSkillManager();
  const maxHp = skills.getMaxLevel(core.Skill.HITPOINTS);
  const after = [];
  if (food.outcomes) {
    const outcome = rollOutcome(food.outcomes, random);
    healBy(player, healAmount(outcome.heal, maxHp, random, baseLevels(player)));
    applyStats(player, outcome);
    const drained = outcome.drainRandom ? drainRandomSkill(player, outcome.drainRandom, random) : undefined;
    if (outcome.message) after.push(outcome.message);
    if (outcome.drainMessage && (drained || outcome.drain)) {
      after.push(outcome.drainMessage.replace("{skill}", drained?.getName?.() ?? ""));
    }
    return after;
  }
  let healed;
  if (food.special === "anglerfish") {
    const amount = getAnglerfishHeal(maxHp);
    healed = healBy(player, amount, canAnglerfishOverheal(player) ? amount : 0);
  } else {
    healed = healBy(player, healAmount(food.heal, maxHp, random, baseLevels(player)));
  }
  applyStats(player, food);
  if (food.poisonImmunity) {
    const immunity = player.getCombat().getPoisonImmunityTimer();
    immunity.protectBriefly(food.poisonImmunity, food.cureVenom === true);
  }
  if (food.then) scheduleSecondHeal(player, food.then);
  const healMessage = food.healMessage === undefined ? HEAL_MESSAGE : food.healMessage;
  if (healed > 0 && healMessage) after.push(healMessage);
  if (food.afterMessage) after.push(food.afterMessage);
  return after;
}

function eatMessage(food, bite, itemId) {
  if (Array.isArray(food.messages)) return food.messages[bite];
  return food.message ?? `You eat the ${itemName(itemId).toLowerCase()}.`;
}

function eat(event) {
  const { player, itemId, slot, clickType } = event;
  const found = foodBite(itemId);
  if (!found || core.CacheDefinitions.getItem(itemId).inventoryActions[clickType - 1] !== (found.food.option ?? EAT_OPTION)) return;
  event.handled = true;
  const { food, bite } = found;
  if (food.refuse) {
    player.sendMessage(food.refuse);
    return;
  }
  const inventory = player.getInventory();
  if (slot < 0 || slot >= inventory.capacity() || inventory.getItems()[slot]?.getId?.() !== itemId) return;
  if (!mayEat(player, itemId, food)) return;

  startTimers(player, food, bite);
  player.getPacketSender().sendInterfaceRemoval();
  player.getSkillManager().stopSkillable();
  core.Sounds.sendSound(player, core.Sound.FOOD_EAT);
  player.performAnimation(new core.Animation(EAT_ANIMATION));

  const message = eatMessage(food, bite, itemId);
  const meta = inventory.getItems()[slot]?.getMeta();
  inventory.deleteAtSlot(slot, 1, false);
  const next = leftover(food, bite);
  if (next !== undefined) inventory.setItem(slot, new core.Item(next, 1));
  inventory.refreshItems();

  const hitpointsBefore = player.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
  const after = applyFood(player, food);
  player.sendMessage(message);
  for (const line of after) player.sendMessage(line);
  countBite(player);
  const heal = player.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS) - hitpointsBefore;
  pluginApi.emitCustomEvent("food:eaten", { player, itemId, heal, meta });
}

module.exports = {
  name: "Food",
  ATTACK_DELAY,
  COMBO_ATTACK_DELAY,
  isFoodItem,
  isComboFoodItem,
  foodItemIds,
  _test: {
    getAnglerfishHeal, canAnglerfishOverheal, healAmount, rollOutcome, foodBite, leftover, eatDelay, applyFood,
    FOOD_EATEN_ATTRIBUTE,
  },
  register(api) {
    init(api);
    api.persistAttribute(FOOD_EATEN_ATTRIBUTE);
    api.onPlayerLogin(sendFoodEaten);
    api.onItemAction(eat);
  },
};
