/**
 * Cooking on fires, ranges and ovens, as rsprox captures show it (recordings 269, 564, 1087, 1098,
 * 1102, 1718, 1723, 1858, 3270, 4103, 4283): more than one raw item opens the skillmulti menu;
 * the first food cooks 2 ticks after the choice, the second 3 ticks after that and the rest every
 * 4. Fires and a house's firepits and ovens play human_firecooking, other ranges and ovens
 * human_cooking. Lines go to the spam channel; refusals are message boxes. The foods, with their
 * levels, XP and burn levels, are plugins/skills/data/cooking.json. A sinew meat on a range also
 * offers Sinew (cooking.json `sinew`, recordings 89 and 1749). See docs/cooking.md.
 */
const Common = require("./Common.Cooking");
const { pauseForLevelUp, actionInterval } = require("../SkillActions");

/** Ticks from the choice (or the arrival) to the first food, then to the second, then each after. */
const FIRST_COOK_TICKS = 2;
const SECOND_COOK_TICKS = 3;
const COOK_INTERVAL_TICKS = 4;
/**
 * Ticks from a manual re-use of raw karambwan while it is already cooking to the next food.
 * The Wiki's 1-tick Cooking method re-opens the cooking dialogue on the tick a karambwan is
 * cooked, so the next one follows a tick later instead of restarting the first-food delay.
 * The Wiki documents this method for raw karambwan; other foods keep their queued timing.
 */
const KARAMBWAN_RECLICK_TICKS = 1;
const ONE_TYPE_TITLE = "How many would you like to cook?";
const MANY_TYPES_TITLE = "What would you like to cook?";
/** clientscript skillmulti_setup's first argument on every captured cooking menu. */
const COOK_MENU_MODE = 6;
const NOTHING_TO_COOK_MESSAGE = "You haven't got anything to cook.";
const CANNOT_COOK_MESSAGE = "You can't cook that.";
/** Wiki (Karambwanji): a quest-only food outside its quest. */
const NOT_USEFUL_MESSAGE = "You don't feel that would be useful now.";
/** One more for each food cooked in a row; a burn sets it back to 0 (rsprox captures). */
const SUCCESS_COUNT_VARBIT = "cooking_success_count";
const SUCCESS_COUNT_ATTRIBUTE = "cooking:success-count";
/** Set while the cook loop waits for its first food (rsprox captures). */
const BUSY_VARBIT = "busy";

/**
 * Wiki (Burnt chicken: https://oldschool.runescape.wiki/w/Burnt_chicken): cooked meat and
 * chicken can be burnt on purpose. Keep them apart from the raw-food cookables.
 */
const DELIBERATE_BURN = { name: "meat", level: 1, xp: 0, stopBurn: 1, deliberate: true, message: "You deliberately burn the nicely cooked meat." };

function deliberateBurnFor(itemId) {
  const { ItemIds } = Common.core;
  if (itemId === ItemIds.COOKED_MEAT) {
    return { ...DELIBERATE_BURN, raw: ItemIds.COOKED_MEAT, cooked: ItemIds.BURNT_MEAT, burnt: ItemIds.BURNT_MEAT };
  }
  if (itemId === ItemIds.COOKED_CHICKEN) {
    return { ...DELIBERATE_BURN, name: "chicken", message: "You deliberately burn the nicely cooked chicken.",
      raw: ItemIds.COOKED_CHICKEN, cooked: ItemIds.BURNT_CHICKEN, burnt: ItemIds.BURNT_CHICKEN };
  }
  return undefined;
}

// Free worlds cannot use members-only raw food, including through a range's Cook option, nor make
// sinew (Wiki Sinew: members only) from the free-to-play raw beef.
function availableOnWorld(cookable) {
  return Common.core.WorldDefinition.isMembersWorld()
    || (!cookable.gnomeTutorial && cookable.members !== true
      && Common.core.CacheDefinitions.getItem(cookable.raw)?.isMembers !== true);
}

/**
 * The cookables with each meat's sinew added after them all, on a range only (rsprox captures 89 and
 * 1749: raw beef on the Lumbridge range offers "What would you like to cook?|Cooked meat|Sinew",
 * even for one piece). Where Sinew goes among other foods is ours: no capture mixes them.
 */
function withSinew(cookables, onFire) {
  if (onFire) return cookables;
  const sinews = cookables.map((cookable) => Common.sinewFor(cookable.raw)).filter((sinew) => sinew && availableOnWorld(sinew));
  return sinews.length ? [...cookables, ...sinews] : cookables;
}

function cookableFor(itemId) {
  const cookable = Common.cookables().get(itemId) ?? deliberateBurnFor(itemId);
  return cookable && !cookable.facility && availableOnWorld(cookable) ? cookable : undefined;
}

// Wiki: cooking a raw karambwan yields a poison karambwan until Tinsay teaches
// proper preparation after Tai Bwo Wannai Trio (post-quest Cooking training).
const KARAMBWAN_TAUGHT_ATTRIBUTE = "quest.tai_bwo_wannai_trio.tinsay";
const KARAMBWAN_TAUGHT_VALUE = 8;

function untrainedKarambwan(player, cookable) {
  return cookable.raw === Common.core.ItemIds.RAW_KARAMBWAN
    && (Number(player.getAttribute?.(KARAMBWAN_TAUGHT_ATTRIBUTE)) || 0) < KARAMBWAN_TAUGHT_VALUE;
}

function cookedResult(player, cookable) {
  const { ItemIds } = Common.core;
  if (!untrainedKarambwan(player, cookable)) return cookable;
  return { ...cookable, cooked: ItemIds.POISON_KARAMBWAN, xp: 80, message: "You cook the karambwan. It looks very dodgy." };
}

function withArticle(cookable) {
  return Common.withArticle(cookable.name, cookable.article);
}

function successMessage(cookable) {
  return cookable.message ?? `You successfully cook ${withArticle(cookable)}.`;
}

function burnMessage(cookable) {
  return cookable.burnMessage ?? `You accidentally burn the ${cookable.name}.`;
}

// Fires and a house's firepits cook with human_firecooking, and so do the house's ovens and
// ranges (rsprox captures 269: "Firepit with hook" and "Small oven"). Every other range and
// oven, such as the main-game "Range" and "Oven", cooks with human_cooking.
const FIRE_OBJECT_NAMES = new Set(["Fire", "Forester's Campfire", "Firepit", "Firepit with hook", "Firepit with pot"]);
const HOUSE_RANGE_NAMES = new Set(["Small oven", "Large oven", "Steel range", "Fancy range"]);
// The cache spells the clay ovens two ways: "Clay oven" in Hosidius (the kitchen and the mess) and
// on Neitiznot, "Clay Oven" in Nardah.
const RANGE_OBJECT_NAMES = new Set(["Cooking range", "Range", "Stove", "Oven", "Clay oven", "Clay Oven"]);
const COOKABLE_OBJECT_NAMES = new Set([...RANGE_OBJECT_NAMES, ...HOUSE_RANGE_NAMES, ...FIRE_OBJECT_NAMES]);

function cookAnimationFor(name) {
  const seq = FIRE_OBJECT_NAMES.has(name) || HOUSE_RANGE_NAMES.has(name) ? "human_firecooking" : "human_cooking";
  return new Common.core.Animation(Common.gameval("seq", seq));
}

/**
 * Wiki (Hosidius Kitchen): its two ranges add 12 to a food's low and high values, or 25 with the
 * elite Kourend & Kebos Diary. They are clay ovens; the one in the mess next door has no bonus.
 */
const HOSIDIUS_KITCHEN = { minX: 1674, maxX: 1684, minY: 3616, maxY: 3626 };
const HOSIDIUS_BONUS = 12;
const HOSIDIUS_ELITE_BONUS = 25;
/** Wiki (Hosidius Kitchen): the two ranges need the easy Kourend & Kebos Diary. The line is ours. */
const HOSIDIUS_DIARY_MESSAGE = "You need to complete the easy Kourend & Kebos Diary to use these ranges.";
/** Levels the stop-burn search tries; past this a food is treated as never stopping. */
const HIGHEST_STOP_LEVEL = 200;

function wearsCookingGauntlets(player) {
  const { Equipment, ItemIds } = Common.core;
  return player.getEquipment?.()?.getItems?.()[Equipment.HANDS_SLOT]?.getId?.() === ItemIds.COOKING_GAUNTLETS;
}

function isHosidiusKitchen(objectId, location) {
  if (objectId !== Common.core.ObjectIdentifiers.CLAY_OVEN_3 || !location) return false;
  const x = location.getX(), y = location.getY();
  return location.getZ() === 0 && x >= HOSIDIUS_KITCHEN.minX && x <= HOSIDIUS_KITCHEN.maxX
    && y >= HOSIDIUS_KITCHEN.minY && y <= HOSIDIUS_KITCHEN.maxY;
}

/** Whether the player has completed a tier of the Kourend & Kebos Diary ("diary:is-complete"). */
function diaryComplete(player, tier) {
  const request = { player, diary: "kourend", tier, complete: false };
  Common.api?.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** Whether this object is a range or oven rather than a fire (by its cache name); false without one. */
function onRange(objectId) {
  if (objectId === undefined) return false;
  const name = Common.core.CacheDefinitions.getObject(objectId)?.name;
  return !!name && !FIRE_OBJECT_NAMES.has(name);
}

/** The cooker kind a session gives; without one, the object's ("range" when there is no object either). */
function cookerKind(cooker, objectId) {
  if (cooker) return cooker;
  return objectId !== undefined && !onRange(objectId) && Common.core.CacheDefinitions.getObject(objectId) ? "fire" : "range";
}

function hosidiusBonus(player, objectId, location) {
  if (!isHosidiusKitchen(objectId, location)) return 0;
  return diaryComplete(player, "elite") ? HOSIDIUS_ELITE_BONUS : HOSIDIUS_BONUS;
}

/**
 * The [low, high] values this food cooks with here (Wiki charts): worn cooking gauntlets for the
 * foods they help, the Lumbridge Castle range for the foods it helps, else the fire's or the
 * range's, plus the Hosidius Kitchen's bonus. Null for a food without Wiki values.
 */
function chanceValues(player, cookable, objectId, cooker, location) {
  const chance = cookable.chance;
  if (!chance) return null;
  cooker = cookerKind(cooker, objectId);
  let values;
  if (chance.gauntlets && wearsCookingGauntlets(player)) values = chance.gauntlets;
  else if (chance.lumbridge && objectId === Common.core.ObjectIdentifiers.COOKING_RANGE) values = chance.lumbridge;
  else values = cooker === "fire" ? chance.fire ?? chance.range : chance.range ?? chance.fire;
  const bonus = cooker === "fire" ? 0 : hosidiusBonus(player, objectId, location);
  return [values[0] + bonus, values[1] + bonus];
}

/** The level this food stops burning at here (Infinity: not by HIGHEST_STOP_LEVEL). */
function stopBurnLevel(player, cookable, objectId, cooker, location) {
  const values = chanceValues(player, cookable, objectId, cooker, location);
  if (!values) {
    return objectId === Common.core.ObjectIdentifiers.COOKING_RANGE && cookable.lumbridgeStopBurn !== undefined
      ? cookable.lumbridgeStopBurn : cookable.stopBurn;
  }
  for (let level = 1; level <= HIGHEST_STOP_LEVEL; level++) {
    if (Common.successChance(values[0], values[1], level) >= 1) return level;
  }
  return Infinity;
}

/**
 * The chance of cooking this food here at the player's Cooking level, boosts included and with
 * no cap at 99. A food without Wiki values falls back to a straight line from 58% at its level
 * to 100% at its `stopBurn`.
 */
function successChance(player, cookable, objectId, cooker, location) {
  if (Common.wearsCookingCape(player)) return 1;
  const level = Common.level(player);
  const values = chanceValues(player, cookable, objectId, cooker, location);
  if (values) return Common.successChance(values[0], values[1], level);
  const stopBurn = stopBurnLevel(player, cookable, objectId, cooker, location);
  if (level >= stopBurn || stopBurn <= cookable.level) return 1;
  const burnChance = 42 - ((level - cookable.level) * 42) / (stopBurn - cookable.level);
  return 1 - burnChance / 100;
}

/** The roll, as before: a roll at or above the burn chance cooks the food (a roll of 0 burns anything that can burn). */
function isSuccess(player, cookable, objectId, cooker, location, random = Math.random) {
  return random() >= 1 - successChance(player, cookable, objectId, cooker, location);
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
  if (!availableOnWorld(cookable)) {
    player.sendMessage("To use this item please login to a members' world.");
    return false;
  }
  if (cookable.gnomeTutorial && FIRE_OBJECT_NAMES.has(object.getDefinition().getName())) {
    Common.mesbox(player, CANNOT_COOK_MESSAGE);
    return false;
  }
  if (isHosidiusKitchen(object.getId(), object.getLocation?.()) && !diaryComplete(player, "easy")) {
    Common.mesbox(player, HOSIDIUS_DIARY_MESSAGE);
    return false;
  }
  if (object.getId() === Common.core.ObjectIdentifiers.COOKING_RANGE) {
    const request = { player, key: "cooks_assistant", complete: null };
    Common.api.emitCustomEvent("quest:is-complete", request);
    if (request.complete !== true) {
      player.sendMessage("You need to complete Cook's Assistant to use this range.");
      return false;
    }
  }
  const requiredLevel = untrainedKarambwan(player, cookable) ? 1 : cookable.level;
  if (Common.level(player) < requiredLevel) {
    Common.mesbox(player, `You need a Cooking level of ${requiredLevel} to cook ${withArticle(cookable)}.`);
    return false;
  }
  if (!duringQuestMet(player, cookable)) {
    // Wiki (Karambwanji): raw karambwanji cook only during Tai Bwo Wannai Trio.
    player.sendMessage(NOT_USEFUL_MESSAGE);
    return false;
  }
  if (!rumoursMet(player, cookable)) {
    // Wiki (Hunter meat): the better meats need Hunters' Rumours; the line is ours, the Wiki has none.
    Common.mesbox(player, `You need to have completed ${cookable.rumours} Hunters' Rumours to cook ${withArticle(cookable)}.`);
    return false;
  }
  return true;
}

/** The Wiki's quest gate: a `duringQuest` food cooks only while that quest is under way. */
function duringQuestMet(player, cookable) {
  return !cookable.duringQuest || questInProgress(player, cookable.duringQuest);
}

/** The Wiki's Hunters' Rumours gate: 25 for graahk, kyatt and pyre fox, 50 for the antelopes and dashing kebbit. */
function rumoursMet(player, cookable) {
  return !cookable.rumours || rumoursCompleted(player) >= cookable.rumours;
}

/**
 * Whether the player may cook this food on a fire or range, without messages: not food for one
 * facility (the Camdozaal preparation table), a members' world, the Cooking level and the quest
 * and rumour gates. Bots pick their food with it; canCook adds the
 * cooker's own checks and tells a player why not.
 */
function canCookFood(player, cookable) {
  const requiredLevel = untrainedKarambwan(player, cookable) ? 1 : cookable.level;
  return !cookable.facility && availableOnWorld(cookable) && Common.level(player) >= requiredLevel
    && duringQuestMet(player, cookable) && rumoursMet(player, cookable);
}

/** Whether the quest is started and not yet complete. */
function questInProgress(player, key) {
  const started = { player, key, started: false };
  Common.api.emitCustomEvent("quest:is-started", started);
  const complete = { player, key, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", complete);
  return started.started === true && complete.complete !== true;
}

/** How many Hunters' Rumours the player has finished ("hunter:rumours-completed"). */
function rumoursCompleted(player) {
  const request = { player, completed: 0 };
  Common.api.emitCustomEvent("hunter:rumours-completed", request);
  return Number(request.completed) || 0;
}

/**
 * Cooks `amount` of the food (all of it by default), the first FIRST_COOK_TICKS after this tick.
 * Re-using raw karambwan while it cooks (the Wiki's 1-tick method) makes the next one due
 * KARAMBWAN_RECLICK_TICKS later instead of restarting the first-food delay. Clicks are handled
 * after the tick's tasks, so the cooking task has already run this tick.
 */
function validSelectedInput(player, cookable, selected) {
  const item = selected?.item;
  return Number.isInteger(selected?.slot) && player.getInventory().getItems()[selected.slot] === item
    && item?.getId() === cookable.raw && item.getAmount() === 1
    && !item.isPresetItem() && !item.isUntradeable() && !item.isUnbankable();
}

function startCooking(player, object, cookable, sessions = activeSessions, amount = Infinity, selected = null, alternates = []) {
  if (!canCook(player, object, cookable)) return false;
  if (selected && !validSelectedInput(player, cookable, selected)) return false;
  if (!player.getInventory().contains(cookable.raw)) {
    return false;
  }

  const previous = sessions.get(player);
  const reusing = !!previous && previous.cookable.raw === cookable.raw
    && cookable.raw === Common.core.ItemIds.RAW_KARAMBWAN;
  stopCooking(player, false);
  ensureCookTask();
  sessions.set(player, {
    cookable, selected, alternates,
    animation: cookAnimationFor(object.getDefinition().getName()),
    cooker: FIRE_OBJECT_NAMES.has(object.getDefinition().getName()) ? "fire" : "range",
    objectId: object.getId(),
    objectType: object.getType(),
    objectFace: object.getFace(),
    location: object.getLocation().clone(),
    privateArea: object.getPrivateArea(),
    // Repeated clicks must not shorten the initial captured first-food delay.
    nextCookTick: reusing && previous.cooked === 0 ? previous.nextCookTick
      : (cookingTask?.cycle ?? 0) + (reusing
        ? KARAMBWAN_RECLICK_TICKS
        : (cookable.firstCookTicks ?? FIRST_COOK_TICKS)),
    cooked: reusing ? previous.cooked : 0,
    remaining: amount,
  });
  if (!reusing || previous.cooked === 0) Common.sendVarbit(player, BUSY_VARBIT, 1);

  return true;
}

/** The raw foods in the inventory this cooker takes, once each, in inventory order. */
function carriedCookables(player, onFire) {
  const found = new Map();
  for (const item of player.getInventory().getItems()) {
    if (!item || Common.core.ItemDefinition.forId(item.getId()).isNoted()) continue;
    const cookable = Common.cookables().get(item.getId());
    if (cookable && !cookable.facility && availableOnWorld(cookable)
      && !(cookable.rangeOnly && onFire) && !found.has(cookable.raw)) found.set(cookable.raw, cookable);
  }
  return withSinew([...found.values()], onFire);
}

/**
 * The cook menu (rsprox captures): one food is "How many would you like to cook?" showing the raw
 * item, several are "What would you like to cook?" showing what they cook into. The most it
 * offers is the most carried of one food. One raw item on its own cooks without a menu.
 */
function offerCook(player, object, cookables, singleClick = false, selected = null) {
  const inventory = player.getInventory();
  if (cookables.length === 1) {
    const [cookable] = cookables;
    if (!canCook(player, object, cookable)) return;
    const carried = inventory.getAmount(cookable.raw);
    if (carried <= 1) {
      if (startCooking(player, object, cookable, activeSessions, 1, selected) && singleClick && cookable.firstCookTicks === undefined) {
        // Wiki Cooking#2-tick_cooking: left-clicking a range with one raw item cooks without delay.
        cookStep(player, activeSessions.get(player), cookingTask.cycle);
        stopCooking(player, false);
      }
      return;
    }
    openCookMenu(player, ONE_TYPE_TITLE, [cookable.raw], carried, (id, amount) => {
      startCooking(player, object, cookable, activeSessions, amount, selected);
    });
    return;
  }
  // One meat with its Sinew entry: the range's refusals (Cook's Assistant, members) come before the
  // menu, as they did for that meat alone before Sinew was offered.
  if (new Set(cookables.map((cookable) => cookable.raw)).size === 1 && !canCook(player, object, cookables[0])) return;
  // Keyed by what this player gets (a karambwan is poison until Tinsay's training), valued by the recipes:
  // one entry cooks every raw with that product (raw beef, then raw rat meat), in inventory order.
  const byProduct = new Map();
  for (const cookable of cookables) {
    const product = cookedResult(player, cookable).cooked;
    if (!byProduct.has(product)) byProduct.set(product, []);
    byProduct.get(product).push(cookable);
  }
  const most = Math.max(...[...byProduct.values()].map((group) =>
    group.reduce((total, cookable) => total + inventory.getAmount(cookable.raw), 0)));
  openCookMenu(player, MANY_TYPES_TITLE, [...byProduct.keys()], most, (id, amount) => {
    const [cookable, ...alternates] = byProduct.get(id) ?? [];
    // Wiki Sinew ("Make-all is 0, 3, then 4 ticks") and rsprox captures 89 and 1749: the first
    // sinew is dried on the tick the choice is handled.
    if (cookable && startCooking(player, object, cookable, activeSessions, amount, null, alternates) && cookable.sinew) {
      // The menu can be answered after walking away; cookTick's own checks apply to this step too.
      const session = activeSessions.get(player);
      if (isMoving(player) || !atCooker(player, session)) {
        stopCooking(player);
        return;
      }
      cookStep(player, session, cookingTask.cycle);
      if (activeSessions.get(player)?.remaining <= 0) stopCooking(player, false);
    }
  });
}

function openCookMenu(player, title, items, most, choose) {
  const { CreationMenu } = Common.core;
  player.getPacketSender().sendCreationMenu(new CreationMenu(title, items, { execute: choose },
    { mode: COOK_MENU_MODE, maxAmount: most, lastAmount: most }));
}

/** The active cooker can be unchanged scenery lazily copied into a template. */
function currentCooker(session) {
  const { MapObjects, ObjectManager, World } = Common.core;
  const { objectId, location, privateArea } = session;
  if (privateArea?.isDestroyed()) return null;
  const matches = (object) => object && object.getId() === objectId
    && object.getPrivateArea() === privateArea && object.getLocation().equals(location)
    && object.getType() === session.objectType && object.getFace() === session.objectFace;
  const current = MapObjects.get(objectId, location, privateArea)
    ?? ObjectManager.objectsAt(location).find(matches);
  if (current) return matches(current) ? current : null;
  if (!privateArea?.usesTemplateMap()) return null;
  const cooker = privateArea.resolveObject(objectId, location);
  if (!matches(cooker)) return null;
  const sameSlot = (object) => object.getPrivateArea() === privateArea
    && object.getType() === session.objectType && object.getLocation().equals(location);
  if (privateArea.getObjects().some(sameSlot)
    || ObjectManager.objectsAt(location).some(sameSlot)
    || World.getRemovedObjects().some(sameSlot)) return null;
  return cooker;
}

function isMoving(player) {
  const movement = player.getMovementQueue();
  return movement.size() > 0 || movement.isMovings?.() || player.getForceMovement() != null;
}

/** Whether the session's cooker is still there and within reach. */
function atCooker(player, session) {
  const object = currentCooker(session);
  return Boolean(object && object.isWithinInteractionDistance(player.getLocation()));
}

/** One step of the cook loop for every cooking player, once a tick. */
function cookTick(task) {
  task.cycle++;
  for (const [player, session] of activeSessions) {
    if (!player || !player.isRegistered()) {
      activeSessions.delete(player);
      continue;
    }
    // Dying before the first food is cooked must still clear busy, as stopping any other way does.
    if (player.getHitpoints() <= 0) {
      stopCooking(player, false);
      continue;
    }

    // Global tasks precede player turns; the last step may have drained the route.
    if (isMoving(player)) {
      stopCooking(player);
      continue;
    }
    if (session.levelUpPaused) continue;

    if (session.remaining <= 0 || !carriedRaw(player, session)) {
      stopCooking(player);
      continue;
    }

    if (!atCooker(player, session)) {
      stopCooking(player);
      continue;
    }

    if (task.cycle < session.nextCookTick) {
      continue;
    }
    cookStep(player, session, task.cycle);
  }
}

/** Whether a raw is left to cook, moving on to the menu entry's next raw with the same product once one runs out. */
function carriedRaw(player, session) {
  const inventory = player.getInventory();
  if (inventory.contains(session.cookable.raw)) return true;
  const next = session.alternates?.find((cookable) => inventory.contains(cookable.raw) && canCookFood(player, cookable));
  if (!next) return false;
  session.cookable = next;
  return true;
}

function cookStep(player, session, cycle) {
  const { Sound, Sounds } = Common.core;
  // Content may cook faster ("skills:action-interval", a league relic's 2-tick pace).
  const pace = session.cooked === 0 ? SECOND_COOK_TICKS : COOK_INTERVAL_TICKS;
  session.nextCookTick = cycle + actionInterval(Common.api, player, Common.core.Skill.COOKING, "cook", pace);
  if (session.cooked === 0) Common.sendVarbit(player, BUSY_VARBIT, 0);
  session.cooked++;
  session.remaining--;
  Sounds.sendSound(player, Sound.COOKING_COOK);
  player.performAnimation(session.animation);

  // Content may cook several in the one cycle ("skills:actions-per-cycle", a league relic's all at once), but
  // never past the amount chosen: the first is already counted above, each further one is counted here.
  const actions = Math.min(Common.actionsPerCycle(player, "cook"), session.remaining + 1);
  for (let done = 0; done < actions && carriedRaw(player, session); done++) {
    if (done > 0) session.remaining--;
    if (cookOne(player, session) === false) { stopCooking(player); break; }
  }
}

function cookOne(player, session) {
  const { Item, Skill } = Common.core;
  const cookable = cookedResult(player, session.cookable);
  const inventory = player.getInventory();
  if (!availableOnWorld(cookable)) return false;
  if (cookable.deliberate) {
    inventory.deleteNumber(session.cookable.raw, 1);
    player.getInventory().addItem(new Item(cookable.cooked, 1));
    Common.spam(player, successMessage(cookable));
    return;
  }
  if (session.selected && !validSelectedInput(player, session.cookable, session.selected)) return false;
  const rawSlot = cookable.gnomeTutorial ? (session.selected?.slot ?? inventory.getItems().findIndex((item) =>
    item?.getId() === session.cookable.raw && item.getAmount() === 1
      && !item.isPresetItem() && !item.isUntradeable() && !item.isUnbankable())) : -1;
  if (cookable.gnomeTutorial && rawSlot < 0) { player.sendMessage("Preset items cannot be used for this."); return false; }
  const rawItem = cookable.gnomeTutorial ? inventory.getItems()[rawSlot]
    : inventory.getItems().find((item) => item?.getId() === session.cookable.raw);
  const rawRestore = rawItem?.clone ? rawItem.clone().setAmount(1) : new Item(session.cookable.raw, 1);
  if (cookable.gnomeTutorial) {
    // Success may return the tray/tin as a second nonstackable item. Reserve
    // that slot before the roll or any mutation; burns retain the burnt item.
    if (rawItem.getDefinition().isStackable() || new Item(cookable.cooked, 1).getDefinition().isStackable()
      || (cookable.returnItem !== undefined && new Item(cookable.returnItem, 1).getDefinition().isStackable())) return false;
    if (cookable.returnItem !== undefined && inventory.getFreeSlots() < 1) { inventory.full(); return false; }
  } else {
    // A cake tin comes back as well as the cake: room for it before anything changes.
    if (cookable.returnItem !== undefined && inventory.getFreeSlots() < 1) { inventory.full(); return false; }
    inventory.deleteNumber(session.cookable.raw, 1);
  }
  const burnRequest = {
    player,
    rawId: session.cookable.raw,
    itemId: cookable.cooked,
    burn: !isSuccess(player, session.cookable, session.objectId, session.cooker, session.location),
  };
  Common.api.emitCustomEvent("cooking:burn", burnRequest);
  if (cookable.gnomeTutorial) {
    // The burn hook may run other content: revalidate the selected input and
    // the reserved capacity before consuming anything.
    if (inventory.getItems()[rawSlot] !== rawItem || rawItem.getId() !== session.cookable.raw
      || rawItem.getAmount() !== 1 || rawItem.isPresetItem() || rawItem.isUntradeable() || rawItem.isUnbankable()
      || (cookable.returnItem !== undefined && inventory.getFreeSlots() < 1)) return false;
    inventory.deleteAtSlot(rawSlot, 1);
    session.selected = null;
  }
  if (!burnRequest.burn) {
    const output = new Item(cookable.cooked, 1);
    if (typeof inventory.getAddableAmount === "function" && inventory.getAddableAmount(output) === 0) {
      inventory.addItem(rawRestore);
      return;
    }
    const before = inventory.getAmount(cookable.cooked);
    inventory.addItem(output);
    const amount = Math.max(0, inventory.getAmount(cookable.cooked) - before);
    if (amount === 0) {
      inventory.addItem(rawRestore);
      return;
    }
    if (cookable.returnItem !== undefined) inventory.addItem(new Item(cookable.returnItem, 1));
    Common.spam(player, successMessage(cookable));
    // Sinew leaves cooking_success_count alone (rsprox captures 89, 1749 send no change).
    if (!cookable.sinew) countCook(player, false);
    if (amount > 0) {
      const location = session.location.clone();
      Common.api.emitCustomEvent("items:obtained", {
        player,
        itemId: cookable.cooked,
        rawId: cookable.raw,
        amount,
        source: "cooking",
        location,
      });
    }
    Common.api.emitCustomEvent("cooking:success", {
      player,
      skill: Skill.COOKING,
      rawId: cookable.raw,
      itemId: cookable.cooked,
      amount,
      location: session.location.clone(),
      objectId: session.objectId,
      objectLocation: session.location,
    });
    Common.addXp(player, cookable.xp);
    Common.api.emitCustomEvent("skills:produced", { player, skill: Skill.COOKING, itemId: cookable.cooked, amount: 1, xp: cookable.xp, kind: "cook" });
  } else if (cookable.failsWithoutBurning) {
    // Wiki (Drunk dragon): "sometimes no experience is gained" until 38 Cooking, but "you will always
    // receive a finished drunk dragon": the item, no XP, no burn line (none is recorded for it).
    player.getInventory().addItem(new Item(session.cookable.burnt, 1));
    countCook(player, false);
  } else {
    player.getInventory().addItem(new Item(session.cookable.burnt, 1));
    if (cookable.returnOnBurn && cookable.returnItem !== undefined) inventory.addItem(new Item(cookable.returnItem, 1));
    // "cooking:burnt" { player, rawId, itemId }: the food burnt (a league's "Burn Some Food").
    Common.api.emitCustomEvent("cooking:burnt", { player, rawId: session.cookable.raw, itemId: session.cookable.burnt });
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
  const selected = cookable.gnomeTutorial ? { item: event.item, slot: event.itemSlot } : null;
  if (selected && !validSelectedInput(event.player, cookable, selected)) return;
  offerCook(event.player, event.object, withSinew([cookable], FIRE_OBJECT_NAMES.has(definition.getName())), false, selected);
}

/** Anything else used on a cooker, when no other content takes it (rsprox captures 269, 1718). */
function refuseCook(event) {
  if (!isCooker(event.object.getDefinition())) return;
  event.handled = true;
  Common.mesbox(event.player, CANNOT_COOK_MESSAGE);
}

function handleCookClick(event) {
  const onFire = FIRE_OBJECT_NAMES.has(event.object.getDefinition().getName());
  const cookables = carriedCookables(event.player, onFire);
  if (cookables.length === 0) {
    Common.mesbox(event.player, NOTHING_TO_COOK_MESSAGE);
    return;
  }
  offerCook(event.player, event.object, cookables, true);
}

/** "cooking:cooked": what request.rawId cooks into and the XP, for content that cooks as it gathers (a league relic). */
function answerCooked(request) {
  const cookable = Common.cookables().get(request.rawId);
  if (cookable && !cookable.facility) {
    request.cookedId = cookable.cooked;
    request.xp = cookable.xp;
  }
}

/** "cooking:raw-xp": the Cooking XP for cooking request.rawId, e.g. for the infernal harpoon. */
function answerRawXp(request) {
  const cookable = Common.cookables().get(request.rawId);
  if (cookable && !cookable.facility) {
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
  api.onObjectInteraction("Fire", { Cook: handleCookClick });
  api.onObjectInteraction("Range", { Cook: handleCookClick });
  api.onObjectInteraction("Cooking range", { Cook: handleCookClick });
  api.onObjectInteraction("Stove", { Cook: handleCookClick });
  api.onObjectInteraction("Oven", { Cook: handleCookClick });
  api.onObjectInteraction("Clay oven", { Cook: handleCookClick });
  api.onObjectInteraction("Clay Oven", { Cook: handleCookClick });
  api.onObjectInteraction("Small oven", { Cook: handleCookClick });
  api.onObjectInteraction("Large oven", { Cook: handleCookClick });
  api.onObjectInteraction("Steel range", { Cook: handleCookClick });
  api.onObjectInteraction("Fancy range", { Cook: handleCookClick });
  api.onCustomEvent("cooking:raw-xp", answerRawXp);
  api.onCustomEvent("cooking:cooked", answerCooked);
}

module.exports = Object.assign(attachCookers, {
  isCookingActive, isCooker, canCookFood, COOKABLE_OBJECT_NAMES, FIRE_OBJECT_NAMES,
  _test: {
    startCooking, offerCook, cookOne, isSuccess, successChance, stopBurnLevel, successMessage, burnMessage, cookAnimationFor,
    cookableFor, canCook, activeSessions, handleCook, handleCookClick,
  },
});
