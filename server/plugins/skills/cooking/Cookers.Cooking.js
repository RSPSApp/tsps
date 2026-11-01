/**
 * Cooking on fires, ranges and ovens, as rsprox captures show it (recordings 269, 564, 1087, 1098,
 * 1102, 1718, 1723, 1858, 3270, 4103, 4283): more than one raw item opens the skillmulti menu;
 * the first food cooks 2 ticks after the choice, the second 3 ticks after that and the rest every
 * 4. Fires and a house's firepits and ovens play human_firecooking, other ranges and ovens
 * human_cooking. Lines go to the spam channel; refusals are message boxes. The foods, with their
 * levels, XP and burn levels, are plugins/skills/data/cooking.json. See docs/cooking.md.
 */
const Common = require("./Common.Cooking");
const { pauseForLevelUp } = require("../SkillActions");

/** Ticks from the choice (or the arrival) to the first food, then to the second, then each after. */
const FIRST_COOK_TICKS = 2;
const SECOND_COOK_TICKS = 3;
const COOK_INTERVAL_TICKS = 4;
const ONE_TYPE_TITLE = "How many would you like to cook?";
const MANY_TYPES_TITLE = "What would you like to cook?";
/** clientscript skillmulti_setup's first argument on every captured cooking menu. */
const COOK_MENU_MODE = 6;
const NOTHING_TO_COOK_MESSAGE = "You haven't got anything to cook.";
const CANNOT_COOK_MESSAGE = "You can't cook that.";
/** One more for each food cooked in a row; a burn sets it back to 0 (rsprox captures). */
const SUCCESS_COUNT_VARBIT = "cooking_success_count";
const SUCCESS_COUNT_ATTRIBUTE = "cooking:success-count";
/** Set while the cook loop waits for its first food (rsprox captures). */
const BUSY_VARBIT = "busy";

/**
 * Wiki (Cooked meat): unlike other food it can be burnt on purpose on a fire or range, for no
 * XP. Kept apart from the cookables so content that cooks raw food leaves it alone.
 */
const DELIBERATE_BURN = { name: "meat", level: 1, xp: 0, stopBurn: 1, deliberate: true, message: "You deliberately burn the nicely cooked meat." };

function deliberateBurnFor(itemId) {
  const { ItemIds } = Common.core;
  if (itemId !== ItemIds.COOKED_MEAT) return undefined;
  return { ...DELIBERATE_BURN, raw: ItemIds.COOKED_MEAT, cooked: ItemIds.BURNT_MEAT, burnt: ItemIds.BURNT_MEAT };
}

function cookableFor(itemId) {
  return Common.cookables().get(itemId) ?? deliberateBurnFor(itemId);
}

// Wiki: cooking a raw karambwan yields a poison karambwan until Tinsay teaches
// proper preparation after Tai Bwo Wannai Trio (post-quest Cooking training).
const KARAMBWAN_TAUGHT_ATTRIBUTE = "quest.tai_bwo_wannai_trio.tinsay";
const KARAMBWAN_TAUGHT_VALUE = 8;

function cookedResult(player, cookable) {
  const { ItemIds } = Common.core;
  if (cookable.raw !== ItemIds.RAW_KARAMBWAN) return cookable;
  if ((Number(player.getAttribute?.(KARAMBWAN_TAUGHT_ATTRIBUTE)) || 0) >= KARAMBWAN_TAUGHT_VALUE) {
    return cookable;
  }
  return { ...cookable, cooked: ItemIds.POISON_KARAMBWAN, xp: 80, message: "You cook the karambwan. It looks very dodgy." };
}

function withArticle(cookable) {
  return Common.withArticle(cookable.name, cookable.article);
}

function successMessage(cookable) {
  return cookable.message ?? `You successfully cook ${withArticle(cookable)}.`;
}

function burnMessage(cookable) {
  return `You accidentally burn the ${cookable.name}.`;
}

// Fires and a house's firepits cook with human_firecooking, and so do the house's ovens and
// ranges (rsprox captures 269: "Firepit with hook" and "Small oven"). Every other range and
// oven, such as the main-game "Range" and "Oven", cooks with human_cooking.
const FIRE_OBJECT_NAMES = new Set(["Fire", "Forester's Campfire", "Firepit", "Firepit with hook", "Firepit with pot"]);
const HOUSE_RANGE_NAMES = new Set(["Small oven", "Large oven", "Steel range", "Fancy range"]);
const RANGE_OBJECT_NAMES = new Set(["Cooking range", "Range", "Stove", "Oven"]);
const COOKABLE_OBJECT_NAMES = new Set([...RANGE_OBJECT_NAMES, ...HOUSE_RANGE_NAMES, ...FIRE_OBJECT_NAMES]);

function cookAnimationFor(name) {
  const seq = FIRE_OBJECT_NAMES.has(name) || HOUSE_RANGE_NAMES.has(name) ? "human_firecooking" : "human_cooking";
  return new Common.core.Animation(Common.gameval("seq", seq));
}

/**
 * Wiki: cooking gauntlets only affect lobster, swordfish, kyatt, monkfish,
 * shark and anglerfish, lowering the level at which they stop burning.
 */
const GAUNTLETS_STOP_BURN = new Map([
  ["raw_lobster", 64],
  ["raw_swordfish", 80],
  ["hunting_kyatt_meat", 80],
  ["raw_monkfish", 86],
  ["raw_shark", 89],
  ["raw_anglerfish", 93],
]);

function gauntletsStopBurn(rawId) {
  for (const [name, level] of GAUNTLETS_STOP_BURN) {
    if (Common.core.CacheDefinitions.getObjId(name) === rawId) return level;
  }
  return undefined;
}

function stopBurnLevel(player, cookable, objectId) {
  const { Equipment, ItemIds, ObjectIdentifiers } = Common.core;
  if (objectId !== undefined && objectId === ObjectIdentifiers.COOKING_RANGE && cookable.lumbridgeStopBurn !== undefined) {
    return cookable.lumbridgeStopBurn;
  }
  const hands = player.getEquipment?.()?.getItems?.()[Equipment.HANDS_SLOT]?.getId?.();
  if (hands !== ItemIds.COOKING_GAUNTLETS) {
    return cookable.stopBurn;
  }
  return gauntletsStopBurn(cookable.raw) ?? cookable.stopBurn;
}

function isSuccess(player, cookable, objectId) {
  const cookingLevel = Common.level(player);
  if (Common.wearsCookingCape(player)) {
    return true;
  }
  const stopBurn = stopBurnLevel(player, cookable, objectId);
  if (cookingLevel >= stopBurn) {
    return true;
  }
  if (stopBurn <= cookable.level) {
    return true;
  }

  const burnBonus = 3;
  let burnChance = 45.0 - burnBonus;
  const burnDec = burnChance / (stopBurn - cookable.level);
  burnChance -= (cookingLevel - cookable.level) * burnDec;
  const roll = Math.random() * 100.0;
  return burnChance <= roll;
}

const activeSessions = new Map();
let cookingTask = null;

function stopCooking(player, resetAnimation = true) {
  const session = activeSessions.get(player);
  if (!session) {
    return;
  }
  activeSessions.delete(player);
  if (session.cooked === 0) Common.sendVarbit(player, BUSY_VARBIT, 0);
  if (resetAnimation) {
    player.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
  }
}

/** cooking_success_count: up one for a cooked food, back to 0 on a burn (rsprox captures 1098, 1102, 4103). */
function countCook(player, burnt) {
  const count = burnt ? 0 : (Number(player.getAttribute(SUCCESS_COUNT_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(SUCCESS_COUNT_ATTRIBUTE, count);
  Common.sendVarbit(player, SUCCESS_COUNT_VARBIT, count);
}

/** "cooking:count" `{ player, burnt }`: a cook made elsewhere (the Gauntlet's range) moves the same count. */
function countCookEvent(event) {
  if (event?.player) countCook(event.player, event.burnt === true);
}

function sendSuccessCount({ player }) {
  const count = Number(player.getAttribute(SUCCESS_COUNT_ATTRIBUTE)) || 0;
  if (count > 0) Common.sendVarbit(player, SUCCESS_COUNT_VARBIT, count);
}

/** Whether the player may cook this here; says why not in a message box. */
function canCook(player, object, cookable) {
  if (object.getId() === Common.core.ObjectIdentifiers.COOKING_RANGE) {
    const request = { player, key: "cooks_assistant", complete: null };
    Common.api.emitCustomEvent("quest:is-complete", request);
    if (request.complete !== true) {
      player.sendMessage("You need to complete Cook's Assistant to use this range.");
      return false;
    }
  }
  if (Common.level(player) < cookable.level) {
    Common.mesbox(player, `You need a Cooking level of ${cookable.level} to cook ${withArticle(cookable)}.`);
    return false;
  }
  return true;
}

/**
 * Cooks `amount` of the food (all of it by default), the first FIRST_COOK_TICKS after this tick.
 * Clicks are handled after the tick's tasks, so the cooking task has already run this tick.
 */
function startCooking(player, object, cookable, sessions = activeSessions, amount = Infinity) {
  if (!canCook(player, object, cookable)) return false;
  if (!player.getInventory().contains(cookable.raw)) {
    return false;
  }

  stopCooking(player, false);
  ensureCookTask();
  sessions.set(player, {
    cookable,
    animation: cookAnimationFor(object.getDefinition().getName()),
    objectId: object.getId(),
    location: object.getLocation().clone(),
    privateArea: object.getPrivateArea(),
    nextCookTick: (cookingTask?.cycle ?? 0) + FIRST_COOK_TICKS,
    cooked: 0,
    remaining: amount,
  });
  Common.sendVarbit(player, BUSY_VARBIT, 1);

  return true;
}

/** The raw foods in the inventory this cooker takes, once each, in inventory order. */
function carriedCookables(player, onFire) {
  const found = new Map();
  for (const item of player.getInventory().getItems()) {
    if (!item || Common.core.ItemDefinition.forId(item.getId()).isNoted()) continue;
    const cookable = Common.cookables().get(item.getId());
    if (cookable && !(cookable.rangeOnly && onFire) && !found.has(cookable.raw)) found.set(cookable.raw, cookable);
  }
  return [...found.values()];
}

/**
 * The cook menu (rsprox captures): one food is "How many would you like to cook?" showing the raw
 * item, several are "What would you like to cook?" showing what they cook into. The most it
 * offers is the most carried of one food. One raw item on its own cooks without a menu.
 */
function offerCook(player, object, cookables) {
  const inventory = player.getInventory();
  if (cookables.length === 1) {
    const [cookable] = cookables;
    if (!canCook(player, object, cookable)) return;
    const carried = inventory.getAmount(cookable.raw);
    if (carried <= 1) {
      startCooking(player, object, cookable, activeSessions, 1);
      return;
    }
    openCookMenu(player, ONE_TYPE_TITLE, [cookable.raw], carried, (id, amount) => {
      startCooking(player, object, cookable, activeSessions, amount);
    });
    return;
  }
  // Keyed by what this player gets (a karambwan is poison until Tinsay's training), valued by the recipe.
  const byProduct = new Map();
  for (const cookable of cookables) {
    const product = cookedResult(player, cookable).cooked;
    if (!byProduct.has(product)) byProduct.set(product, cookable);
  }
  const most = Math.max(...cookables.map((cookable) => inventory.getAmount(cookable.raw)));
  openCookMenu(player, MANY_TYPES_TITLE, [...byProduct.keys()], most, (id, amount) => {
    const cookable = byProduct.get(id);
    if (cookable) startCooking(player, object, cookable, activeSessions, amount);
  });
}

function openCookMenu(player, title, items, most, choose) {
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(title, items, { execute: choose },
    { mode: COOK_MENU_MODE, maxAmount: most, lastAmount: most }));
}

/** One step of the cook loop for every cooking player, once a tick. */
function cookTick(task) {
  task.cycle++;
  const { MapObjects, Sound, Sounds } = Common.core;

  for (const [player, session] of activeSessions) {
    if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
      activeSessions.delete(player);
      continue;
    }

    if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
      stopCooking(player);
      continue;
    }
    if (session.levelUpPaused) continue;

    if (session.remaining <= 0 || !player.getInventory().contains(session.cookable.raw)) {
      stopCooking(player);
      continue;
    }

    const object = MapObjects.get(session.objectId, session.location, session.privateArea);
    if (!object || !object.isWithinInteractionDistance(player.getLocation())) {
      stopCooking(player);
      continue;
    }

    if (task.cycle < session.nextCookTick) {
      continue;
    }
    session.nextCookTick = task.cycle + (session.cooked === 0 ? SECOND_COOK_TICKS : COOK_INTERVAL_TICKS);
    if (session.cooked === 0) Common.sendVarbit(player, BUSY_VARBIT, 0);
    session.cooked++;
    session.remaining--;
    Sounds.sendSound(player, Sound.COOKING_COOK);
    player.performAnimation(session.animation);

    // Content may cook several in the one cycle ("skills:actions-per-cycle", a league relic's all at once).
    const actions = Common.actionsPerCycle(player, "cook");
    for (let done = 0; done < actions && player.getInventory().contains(session.cookable.raw); done++) {
      cookOne(player, session);
    }
  }
}

function cookOne(player, session) {
  const { Item, Skill } = Common.core;
  const cookable = cookedResult(player, session.cookable);
  player.getInventory().deleteNumber(session.cookable.raw, 1);
  if (cookable.deliberate) {
    player.getInventory().addItem(new Item(cookable.cooked, 1));
    Common.spam(player, successMessage(cookable));
    return;
  }
  const burnRequest = {
    player,
    rawId: session.cookable.raw,
    itemId: cookable.cooked,
    burn: !isSuccess(player, session.cookable, session.objectId),
  };
  Common.api.emitCustomEvent("cooking:burn", burnRequest);
  if (!burnRequest.burn) {
    player.getInventory().addItem(new Item(cookable.cooked, 1));
    Common.spam(player, successMessage(cookable));
    countCook(player, false);
    Common.api.emitCustomEvent("cooking:success", { player, skill: Skill.COOKING, itemId: cookable.cooked });
    Common.addXp(player, cookable.xp);
    Common.api.emitCustomEvent("skills:produced", { player, skill: Skill.COOKING, itemId: cookable.cooked, amount: 1, xp: cookable.xp, kind: "cook" });
  } else {
    player.getInventory().addItem(new Item(session.cookable.burnt, 1));
    Common.spam(player, burnMessage(cookable));
    countCook(player, true);
  }
}

function isCookingActive(player) {
  return activeSessions.has(player);
}

/** A cooker this use or click reaches: a fire, or a range or oven with a Cook option. */
function isCooker(definition) {
  const actions = definition.getInteractions() ?? [];
  // A Forester's Campfire has no Cook action; food is used on it directly.
  return COOKABLE_OBJECT_NAMES.has(definition.getName())
    && (!actions.some(Boolean) || actions.includes("Cook") || FIRE_OBJECT_NAMES.has(definition.getName()));
}

function handleCook(event) {
  const definition = event.object.getDefinition();
  if (!isCooker(definition)) return;

  const cookable = cookableFor(event.itemId);
  if (!cookable || (cookable.rangeOnly && FIRE_OBJECT_NAMES.has(definition.getName()))) {
    return;
  }

  event.handled = true;
  offerCook(event.player, event.object, [cookable]);
}

/** Anything else used on a cooker, when no other content takes it (rsprox captures 269, 1718). */
function refuseCook(event) {
  if (!isCooker(event.object.getDefinition())) return;
  event.handled = true;
  Common.mesbox(event.player, CANNOT_COOK_MESSAGE);
}

function handleRangeCook(event) {
  const cookables = carriedCookables(event.player, false);
  if (cookables.length === 0) {
    Common.mesbox(event.player, NOTHING_TO_COOK_MESSAGE);
    return;
  }
  offerCook(event.player, event.object, cookables);
}

/** "cooking:cooked": what request.rawId cooks into and the XP, for content that cooks as it gathers (a league relic). */
function answerCooked(request) {
  const cookable = Common.cookables().get(request.rawId);
  if (cookable) {
    request.cookedId = cookable.cooked;
    request.xp = cookable.xp;
  }
}

/** "cooking:raw-xp": the Cooking XP for cooking request.rawId, e.g. for the infernal harpoon. */
function answerRawXp(request) {
  const cookable = Common.cookables().get(request.rawId);
  if (cookable) {
    request.xp = cookable.xp;
  }
}

function pauseCooking(event) {
  pauseForLevelUp(event, activeSessions, (player) => stopCooking(player, false));
}

function stopOnDisconnect({ player }) {
  stopCooking(player, false);
}

/** The one task that steps every cooking player, submitted with the first cook. */
function ensureCookTask() {
  if (cookingTask) return;
  const { Task } = Common.core;
  cookingTask = new (class extends Task {
    constructor() { super(1); this.cycle = 0; }
    execute() { cookTick(this); }
  })();
  Common.api.getTaskManager().submit(cookingTask);
}

function attachCookers(api) {
  Common.init(api);

  api.persistAttribute(SUCCESS_COUNT_ATTRIBUTE, 0);
  api.onPlayerLogin(sendSuccessCount);
  api.onPlayerDisconnect(stopOnDisconnect);
  api.onCustomEvent("level-up:popup-opened", pauseCooking);
  api.onCustomEvent("cooking:count", countCookEvent);

  api.onItemOnObject(handleCook, { noted: false });
  api.onItemOnObject(refuseCook, { noted: false, fallback: true });
  api.onObjectInteraction("Range", { Cook: handleRangeCook });
  api.onObjectInteraction("Cooking range", { Cook: handleRangeCook });
  api.onObjectInteraction("Stove", { Cook: handleRangeCook });
  api.onObjectInteraction("Oven", { Cook: handleRangeCook });
  api.onObjectInteraction("Small oven", { Cook: handleRangeCook });
  api.onObjectInteraction("Large oven", { Cook: handleRangeCook });
  api.onObjectInteraction("Steel range", { Cook: handleRangeCook });
  api.onObjectInteraction("Fancy range", { Cook: handleRangeCook });
  api.onCustomEvent("cooking:raw-xp", answerRawXp);
  api.onCustomEvent("cooking:cooked", answerCooked);
}

module.exports = Object.assign(attachCookers, {
  isCookingActive, COOKABLE_OBJECT_NAMES, FIRE_OBJECT_NAMES,
  _test: {
    startCooking, offerCook, isSuccess, stopBurnLevel, successMessage, burnMessage, cookAnimationFor, cookableFor,
    GAUNTLETS_STOP_BURN, activeSessions,
  },
});
