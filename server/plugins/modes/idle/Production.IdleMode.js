/**
 * Idle production (plugins/modes/data/idle-mode.json "production"): Cooking, Smithing, Fletching,
 * Crafting, Herblore and Firemaking, by the skills' own flows. The last thing an idle player did by hand that
 * made something (`skills:produced`) within `rememberClickSeconds` is the target:
 *
 * - an item used on an object (raw food on a range), an item used on another (a knife on logs),
 *   or an object's option (Smelt at a furnace);
 * - the product they picked from the creation menu;
 * - the inventory they had when they did it, as the loadout (materials and tools), and where.
 *
 * When a material has run out and nothing has been made for `restartAfterSeconds` (or, mid-batch,
 * nothing for `stalledSeconds`: smelting iron fails half the time), the products go to the bank, the loadout
 * is topped up from the bank, and the same use is repeated as a click would (UseItemPacketListener,
 * emitObjectInteraction), with the same product picked from the menu, all of it (an anvil's
 * smithing interface too, which it reads as a menu through `smithing:anvil-opened`). What each
 * top-up used is counted for the offline progress, which then pays only as far as the bank's
 * materials last. Out of materials, or `maxFailedAttempts` tries in a row that make nothing, it
 * pauses and says so. One activity at a time: making something replaces the gathering or combat
 * target, and gathering or fighting replaces this one.
 *
 * Firemaking makes nothing (`firemaking:success`, a log burnt, counts as a make of none): what the
 * restocks used is what it counts. Logs used on a fire tend it (a Forester's Campfire, `sameObjects`:
 * the fire changes name as it is fed); one tender alone can't keep it lit, so when it has gone out
 * the character lights another with its tinderbox (`relight`) and feeds that. A tinderbox on logs lights one fire and steps off (a
 * `lineSkills` skill): the next follows as soon as the character stands still, and `lineTiles` from
 * where it started (or on a tile a fire is on) it walks back to a free tile there first.
 */
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");

const TARGET_ATTRIBUTE = Common.PRODUCTION_TARGET_ATTRIBUTE;
/** The object type of ground decorations (grass, flowers); most don't keep a fire off. */
const GROUND_DECORATION_TYPE = 22;
const KIND = { ITEM_OBJECT: "item-object", ITEM_ITEM: "item-item", OBJECT_OPTION: "object-option" };

/** player -> an open interface that reads as a creation menu (an anvil's smithing interface). */
const screens = new Map();
/** player -> the last use by hand: { kind, ..., loadout, at }. */
const uses = new Map();
/** player -> { lastProducedAt, lastAttemptAt, failedAttempts, paused, awaitingMenu, chainAt }. */
const states = new Map();
const tracked = new Set();
let skills = null;

function config() {
  return Common.data.production;
}

function stateOf(player) {
  let state = states.get(player);
  if (!state) states.set(player, (state = { lastProducedAt: 0, lastAttemptAt: 0, failedAttempts: 0, paused: null, awaitingMenu: false, chainAt: 0 }));
  return state;
}

function productionSkill(skill) {
  if (!skills) skills = new Set(config().skills.map((name) => Common.core.Skill[name]).filter((value) => value !== undefined));
  return skills.has(skill);
}

/** The inventory as { itemId: amount }: what the loadout is topped up to. */
function snapshot(player) {
  const counts = {};
  for (const item of player.getInventory().getItems()) {
    const itemId = item?.getId?.();
    if (Number.isInteger(itemId) && itemId >= 0 && item.getAmount() > 0) counts[itemId] = (counts[itemId] ?? 0) + item.getAmount();
  }
  return counts;
}

function remember(player, use) {
  if (!config().enabled || !Common.isIdle(player)) return;
  uses.set(player, { ...use, loadout: snapshot(player), at: Date.now() });
}

function usedOnObject(event) {
  remember(event.player, {
    kind: KIND.ITEM_OBJECT, usedItemId: event.itemId, objectName: event.object?.getDefinition?.()?.getName?.() ?? null,
    interfaceType: event.interfaceType ?? 0,
  });
}

function usedOnItem(event) {
  remember(event.player, { kind: KIND.ITEM_ITEM, usedItemId: event.usedItemId, withItemId: event.usedWithItemId });
}

function objectOption(event) {
  const definition = event.definition ?? event.object?.getDefinition?.();
  const option = event.option ?? definition?.getInteractions?.()?.[event.clickType - 1];
  if (definition?.getName?.() && option) remember(event.player, { kind: KIND.OBJECT_OPTION, objectName: definition.getName(), option });
}

/** `skills:produced`: a production skill made something; a use just before it becomes the target. */
function produced(request) {
  const { player, skill, itemId, amount } = request;
  if (!config().enabled || !Common.isIdle(player) || !productionSkill(skill)) return;
  const now = Date.now();
  const state = stateOf(player);
  state.lastProducedAt = now;
  state.failedAttempts = 0;
  if (state.paused) {
    state.paused = null;
    Common.changed(player);
  }
  const skillKey = Common.skillKey(skill);
  const use = uses.get(player);
  if (use && now - use.at <= config().rememberClickSeconds * 1000) {
    uses.delete(player);
    const location = player.getLocation();
    const { at, ...kept } = use;
    Common.setActivity(player, TARGET_ATTRIBUTE, {
      ...kept, skill: skillKey, productId: itemId, anchor: { x: location.getX(), y: location.getY(), z: location.getZ() },
    });
    tracked.add(player);
    Common.changed(player);
  }
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (target?.skill !== skillKey) return;
  // One at a time (a line of fires): the next as soon as the character has stepped off.
  if (isLine(target)) state.chainAt = now + config().tickInterval * 600;
  Offline.record(player, skillKey, [skill], amount > 0 ? { [itemId]: amount } : {}, config().maxGapSeconds);
}

/** `firemaking:success`: a log burnt is a make of nothing (the logs the restocks use are counted). */
function burnt({ player, skill, itemId }) {
  produced({ player, skill, itemId, amount: 0 });
}

/** A target made one at a time, walking on: a tinderbox on logs. */
function isLine(target) {
  return target.kind === KIND.ITEM_ITEM && (config().lineSkills ?? []).includes(target.skill);
}

/** Whether two object names are the same object to idle production (`sameObjects`). */
function sameObject(name, wanted) {
  if (name === wanted) return true;
  return (config().sameObjects ?? []).some((names) => names.includes(name) && names.includes(wanted));
}

/** The skill's verbs: ["Making", "make"], ["Burning", "burn"] (`verbs`). */
function verbs(target) {
  return config().verbs?.[target.skill] ?? ["Making", "make"];
}

/** What the character is doing: "Making iron bars", "Burning logs". */
function doing(target) {
  return `${verbs(target)[0]} ${Common.itemName(target.productId).toLowerCase()}`;
}

function optionIndex(options, option) {
  const wanted = String(option).toLowerCase();
  return (options ?? []).findIndex((entry) => typeof entry === "string" && entry.toLowerCase() === wanted) + 1;
}

/** The nearest object called `name` around the anchor (with `option`, when given). */
function findObject(player, target, option = null) {
  const { MapObjects } = Common.core;
  const { anchor } = target;
  const radius = config().searchTiles;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (let x = anchor.x - radius; x <= anchor.x + radius; x++) {
    for (let y = anchor.y - radius; y <= anchor.y + radius; y++) {
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, anchor.z)) ?? []) {
        const definition = object.getDefinition?.();
        if (!sameObject(definition?.getName?.(), target.objectName)) continue;
        if (option && optionIndex(definition.getInteractions?.(), option) === 0) continue;
        const distance = Math.max(Math.abs(here.getX() - x), Math.abs(here.getY() - y));
        if (distance < bestDistance) {
          best = object;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function slotOf(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
}

/**
 * Banks what isn't part of the loadout (the products) and tops each loadout item up from the
 * bank. Returns what the last batch used ({ itemId: amount }) and the first loadout item now
 * missing altogether (out in the bank too), or null.
 */
function restock(player, target) {
  const inventory = player.getInventory();
  const { loadout } = target;
  const extras = {};
  for (const item of inventory.getItems()) {
    const itemId = item?.getId?.();
    if (!Number.isInteger(itemId) || itemId < 0 || loadout[itemId] !== undefined) continue;
    extras[itemId] = (extras[itemId] ?? 0) + item.getAmount();
  }
  for (const [itemId, amount] of Object.entries(extras)) {
    if (Common.bank(player, Number(itemId), amount)) inventory.deleteNumber(Number(itemId), amount);
  }
  const used = {};
  let missing = null;
  const { Item } = Common.core;
  for (const [key, wanted] of Object.entries(loadout)) {
    const itemId = Number(key);
    const have = inventory.getAmount(itemId);
    if (have < wanted) used[itemId] = wanted - have;
    const room = inventory.getAddableAmount(new Item(itemId, wanted - have));
    const taken = Common.bankTake(player, itemId, Math.min(wanted - have, room));
    if (taken > 0) inventory.add(new Item(itemId, taken), true);
    if (inventory.getAmount(itemId) <= 0 && missing === null) missing = itemId;
  }
  return { used, missing };
}

/**
 * A fire fed logs that has gone out (a campfire burns 3 ticks longer a log, tended every 9): with
 * the skill's `relight` tool (a tinderbox) in the inventory, the character lights a new one with
 * the same logs, and feeds that one next.
 */
function relight(player, target) {
  const tool = Common.core.ItemIdentifiers?.[config().relight?.[target.skill]];
  const toolSlot = Number.isInteger(tool) ? slotOf(player, tool) : -1;
  const logSlot = slotOf(player, target.usedItemId);
  if (toolSlot < 0 || logSlot < 0) return false;
  Common.core.UseItemPacketListener.itemOnItem(player, toolSlot, logSlot);
  ownUse(player);
  return true;
}

/** The use just repeated is not a new one by hand: the target, and where it started, stay. */
function ownUse(player) {
  uses.delete(player);
}

/** Repeats the use as a click would; the creation menu it opens is answered on the next look. */
function repeat(player, target) {
  const { UseItemPacketListener } = Common.core;
  if (target.kind === KIND.ITEM_ITEM) {
    const use = () => {
      const used = slotOf(player, target.usedItemId);
      const withSlot = slotOf(player, target.withItemId);
      if (used < 0 || withSlot < 0) return false;
      UseItemPacketListener.itemOnItem(player, used, withSlot);
      ownUse(player);
      return true;
    };
    if (!isLine(target) || lineGoesOn(player, target)) return use();
    const start = lineStart(target);
    if (!start) return false;
    player.getMovementQueue().walkToTile(start, () => use());
    return true;
  }
  const object = findObject(player, target, target.kind === KIND.OBJECT_OPTION ? target.option : null);
  if (!object) return target.kind === KIND.ITEM_OBJECT && relight(player, target);
  const at = object.getLocation();
  if (target.kind === KIND.ITEM_OBJECT) {
    const slot = slotOf(player, target.usedItemId);
    if (slot < 0) return false;
    UseItemPacketListener.itemOnObject(player, target.interfaceType ?? 0, object.getId(), target.usedItemId, slot, at.getX(), at.getY());
    ownUse(player);
    return true;
  }
  player.getMovementQueue().walkToObject(object, {
    execute: () => {
      player.setPositionToFace(at);
      Common.act(player, () => Common.api.emitObjectInteraction({
        player, object, objectId: object.getId(), clickType: optionIndex(object.getDefinition().getInteractions(), target.option),
        location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
      }));
      ownUse(player);
    },
  });
  return true;
}

/** An object no fire can be lit on: anything but a ground decoration that doesn't block (grass). */
function blocksFire(object) {
  return object.getType?.() !== GROUND_DECORATION_TYPE || object.getDefinition?.()?.isClippedDecoration?.() === true;
}

/** Whether a tile has an object on it that keeps a fire off (a fire, a tree), as Firemaking checks. */
function taken(location) {
  const { MapObjects, ObjectManager } = Common.core;
  if ((ObjectManager?.objectsAt?.(location) ?? []).some(blocksFire)) return true;
  const objects = MapObjects.mapObjects.get(MapObjects.getHash(location.getX(), location.getY(), location.getZ())) ?? [];
  return objects.some((object) => object.getLocation().equals(location) && blocksFire(object));
}

/** A line of fires goes on from here: not too far from where it started, and on a free tile. */
function lineGoesOn(player, target) {
  const location = player.getLocation();
  return Common.chebyshev(location, target.anchor) < config().lineTiles && !taken(location);
}

/** Where a line starts again: the first tile by where it first started, row by row, free to stand and light on. */
function lineStart(target) {
  const { Location, RegionManager } = Common.core;
  const { x, y, z } = target.anchor;
  for (const dy of [0, 1, -1, 2, -2, 3, -3]) {
    const tile = new Location(x, y + dy, z);
    if (!taken(tile) && RegionManager?.blocked?.(tile, null) !== true) return tile;
  }
  return null;
}

/**
 * What to pick in a creation menu: the product when it lists products (fletching, smelting), the
 * item used when it lists what is used (cooking lists the raw food), or its only entry.
 */
function menuChoice(menu, target) {
  const items = menu.getItems();
  if (items.includes(target.productId)) return target.productId;
  if (items.includes(target.usedItemId)) return target.usedItemId;
  return items.length === 1 ? items[0] : null;
}

/**
 * The creation menu the repeated use opened: the same choice, all of it. "chose" when it did,
 * "unanswerable" when a menu it can't read is open (it is closed), null when none is open yet.
 */
function answerMenu(player, target) {
  const creation = player.getCreationMenu?.();
  const screen = screens.get(player);
  screens.delete(player);
  if (creation) {
    player.getPacketSender().closeCreationMenu();
    return choose(creation, target);
  }
  if (!screen?.isOpen()) return null;
  const answer = choose(screen, target);
  if (answer !== "chose") screen.close();
  return answer;
}

function choose(menu, target) {
  const choice = menuChoice(menu, target);
  if (choice === null) return "unanswerable";
  menu.execute(choice, config().makeAll);
  return "chose";
}

/**
 * `smithing:anvil-opened`: an anvil's smithing interface, which reads as a creation menu does,
 * for an idle player making something: answered on the next look as the menu would be.
 */
function screenOpened({ player, menu }) {
  if (player?.getAttribute?.(TARGET_ATTRIBUTE) && menu) screens.set(player, menu);
}

function pause(player, why, message) {
  const state = stateOf(player);
  state.paused = why;
  Common.changed(player);
  player.sendMessage(message);
  return "paused";
}

/** One look at a tracked player; what it did, for the tests and logs. */
function work(player, now) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (!target || !config().enabled || !Common.autoOn(player)) return "off";
  const state = stateOf(player);
  if (state.paused) return "paused";
  if (state.awaitingMenu) {
    const answer = answerMenu(player, target);
    if (answer) {
      state.awaitingMenu = false;
      return answer;
    }
  }
  const { restartAfterSeconds, stalledSeconds, retrySeconds, leashTiles, maxFailedAttempts } = config();
  // A batch still has its materials: let it run (failed tries make nothing) unless it stalls.
  const inventory = player.getInventory();
  const drained = Object.keys(target.loadout).some((itemId) => inventory.getAmount(Number(itemId)) <= 0);
  const waitSeconds = drained ? restartAfterSeconds : stalledSeconds;
  const chained = state.chainAt > 0 && now >= state.chainAt && !drained;
  if (!chained && (now - state.lastProducedAt < waitSeconds * 1000 || now - state.lastAttemptAt < retrySeconds * 1000)) return "producing";
  if (!Common.mayWork(player)) return "busy";
  const location = player.getLocation();
  if (location.getZ() !== target.anchor.z || Common.chebyshev(location, target.anchor) > leashTiles) return "away";
  state.chainAt = 0;
  const product = Common.itemName(target.productId).toLowerCase();
  if (state.lastAttemptAt > state.lastProducedAt && ++state.failedAttempts >= maxFailedAttempts) {
    const verb = verbs(target)[1];
    return pause(player, "stuck", `Idle production has paused: your character can't ${verb} ${product} here. ${verb.charAt(0).toUpperCase()}${verb.slice(1)} one by hand to restart it.`);
  }
  const { used, missing } = restock(player, target);
  Offline.consume(player, target.skill, used);
  if (missing !== null) {
    return pause(player, "out", `Idle production has paused: you're out of ${Common.itemName(missing).toLowerCase()}. Bank some more and ${verbs(target)[1]} one by hand to restart it.`);
  }
  if (!Common.mayWork(player)) return "busy";
  state.lastAttemptAt = now;
  const repeated = repeat(player, target);
  // A line's use opens no menu.
  state.awaitingMenu = repeated && !isLine(target);
  return repeated ? "repeated" : "none";
}

function tick() {
  const now = Date.now();
  for (const player of tracked) {
    if (player.isRegistered?.() === false) {
      forget(player);
      continue;
    }
    work(player, now);
  }
}

function forget(player) {
  tracked.delete(player);
  states.delete(player);
  uses.delete(player);
  screens.delete(player);
}

function login({ player }) {
  if (player.getAttribute(TARGET_ATTRIBUTE)) tracked.add(player);
}

function logout({ player }) {
  forget(player);
}

/**
 * A travel to a production site: the production target, when the site suits it, carries on
 * there (a station of the same name and skill, or anywhere for an item used on another). True
 * when it moved.
 */
function moveTo(player, site, anchor) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (!target) return false;
  const suits = site.kind === "anywhere"
    ? target.kind === KIND.ITEM_ITEM
    : target.skill === site.skill && sameObject(target.objectName, site.target);
  if (!suits) return false;
  Common.setActivity(player, TARGET_ATTRIBUTE, { ...target, anchor });
  const state = stateOf(player);
  Object.assign(state, { lastProducedAt: 0, lastAttemptAt: 0, failedAttempts: 0, paused: null, awaitingMenu: false, chainAt: 0 });
  tracked.add(player);
  Common.changed(player);
  return true;
}

/** `::idle auto on` lifts a pause. */
function unpause(player) {
  const state = stateOf(player);
  state.paused = null;
  state.failedAttempts = 0;
}

/** Why idle production is paused ("stuck", "out"), or null. */
function pausedFor(player) {
  return states.get(player)?.paused ?? null;
}

function startTask() {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class IdleProductionTask extends Task {
    constructor() { super(Math.max(1, config().tickInterval | 0)); }
    execute() { tick(); }
  })());
}

module.exports = function attach(api) {
  api.persistAttribute(TARGET_ATTRIBUTE, null);
  api.onItemOnObject(usedOnObject);
  api.onItemOnItem(usedOnItem);
  api.onBeforeObjectInteraction(objectOption);
  api.onCustomEvent("skills:produced", produced);
  api.onCustomEvent("firemaking:success", burnt);
  api.onCustomEvent("smithing:anvil-opened", screenOpened);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
};

module.exports.TARGET_ATTRIBUTE = TARGET_ATTRIBUTE;
module.exports.KIND = KIND;
module.exports.work = work;
module.exports.unpause = unpause;
module.exports.moveTo = moveTo;
module.exports.pausedFor = pausedFor;
module.exports.doing = doing;
module.exports.tracked = tracked;
