/**
 * Clearable Tar Swamp vegetation (https://oldschool.runescape.wiki/w/Thick_vines_(Tar_Swamp),
 * https://oldschool.runescape.wiki/w/Tendrils_(Tar_Swamp),
 * https://oldschool.runescape.wiki/w/Vines_(Tar_Swamp)): "Thick vine" (30646), "Thick vines"
 * (30648) and "Tendrils" (30645 and the other choppable tendril ids) chop with any axe, while
 * "Vines" (30644, 30650) clears with a rake, opening the swamp paths south to the Deranged
 * archaeologist.
 * - Any axe works with no Woodcutting gate (Wiki: level 1, and an axe too high to wield can
 *   still be used on the plants manually); the rake likewise needs no Farming gate (level 1).
 * - One clearing gives 2 XP in the tool's skill and regrows after 29.4s (49 ticks).
 * The swing/clear messages are approximations: the Wiki lists no transcripts.
 * Decorative lookalikes without a Chop/Clear option never reach the handlers.
 */
const CHOP_NAMES = ["Thick vine", "Thick vines", "Tendrils"];
const CHOP_ACTION = "Chop";
const CLEAR_NAMES = ["Vines"];
const CLEAR_ACTION = "Clear";
/** One clearing's reward (Wiki: 2 XP either way). */
const CLEAR_XP = 2;
/** Regrowth delay (Wiki: 29.4s). */
const RESPAWN_TICKS = 49;
/** Ticks between the swing and the plants falling, so one tool swing is seen. */
const CLEAR_DELAY_TICKS = 2;
/** Farming's rake animation (Patches.Farming.js ANIM.RAKE). */
const RAKE_ANIMATION = 2273;
const NO_AXE_MESSAGE = "You don't have an axe which you can use.";
/** Farming's own missing-tool line (Patches.Farming.js requireTool). */
const NO_RAKE_MESSAGE = "You need a rake to do that.";
const ALREADY_CHOPPED_MESSAGE = "The vines have already been chopped down.";
const ALREADY_CLEARED_MESSAGE = "The vines have already been cleared.";

let api = null;
let core = null;
let helpers = null;
/** Axes best-first ({ id, animationId, ... }), as passed by the Woodcutting plugin. */
let axes = [];
const axeById = new Map();
/** The unnoted "Rake" cache id, resolved once (Farming looks tools up by name too). */
let rakeId = null;
/** Clearing keyed by loc, so a double click pays XP and schedules regrowth only once. */
const pending = new Map();

function vineKey(object) {
  const location = object.getLocation();
  return `${object.getId()}:${location.getX()},${location.getY()},${location.getZ()}`;
}

function displayName(object) {
  return object.getDefinition?.()?.getName?.()?.toLowerCase() ?? "vines";
}

/** Which clearing group a live object belongs to, by its cache name. */
function groupFor(object) {
  const name = object?.getDefinition?.()?.getName?.();
  if (!name) return null;
  if (CHOP_NAMES.includes(name)) return "chop";
  if (CLEAR_NAMES.includes(name)) return "clear";
  return null;
}

/** The live map object, or null once cleared (or never there). */
function plantAt(object) {
  if (!object) return null;
  return core.MapObjects.get(object.getId(), object.getLocation(), object.getPrivateArea()) ?? null;
}

/** Best axe held anywhere, ignoring wield levels: any axe cuts (Wiki). */
function findAnyAxe(equippedWeaponId, containsItem, axeList) {
  for (const axe of axeList) {
    if (equippedWeaponId === axe.id || containsItem(axe.id)) return axe;
  }
  return null;
}

function playerAxe(player) {
  const equipped = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  const equippedWeaponId = equipped ? equipped.getId() : -1;
  const inventory = player.getInventory();
  return findAnyAxe(equippedWeaponId, (id) => inventory.contains(id), axes);
}

function resolveRakeId() {
  if (rakeId != null) return rakeId;
  rakeId = -1;
  const counts = core.CacheDefinitions.getCounts().items;
  for (let id = 0; id < counts; id++) {
    const definition = core.CacheDefinitions.getItem(id);
    if (definition?.name?.toLowerCase() !== "rake") continue;
    if (core.ItemDefinition.forId(id)?.isNoted()) continue;
    rakeId = id;
    break;
  }
  return rakeId;
}

function hasRake(player) {
  const id = resolveRakeId();
  return id >= 0 && (player.getInventory().contains(id) || player.getEquipment().contains(id));
}

function faceObject(player, object) {
  if (typeof player.forcePositionToFace === "function") {
    player.forcePositionToFace(object.getLocation());
  } else {
    player.setPositionToFace(object.getLocation());
  }
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function regrowLater(snapshot) {
  later(snapshot.respawnTicks, () => {
    const location = new core.Location(snapshot.x, snapshot.y, snapshot.z);
    if (core.MapObjects.get(snapshot.id, location, snapshot.privateArea)) return;
    core.ObjectManager.register(
      new core.GameObject(snapshot.id, location, snapshot.type, snapshot.face, snapshot.privateArea),
      true,
    );
  });
}

function useTool(player, object, { skillKey, xp, animId, startMessage, doneMessage }) {
  const key = vineKey(object);
  if (pending.has(key)) return;
  pending.set(key, true);
  faceObject(player, object);
  player.sendMessage(startMessage);
  player.performAnimation(new core.Animation(animId));
  later(CLEAR_DELAY_TICKS, () => {
    pending.delete(key);
    if (!player.isRegistered?.() || player.getHitpoints() <= 0) return;
    const live = plantAt(object);
    if (!live) return;
    const location = live.getLocation().clone();
    const snapshot = {
      id: live.getId(),
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      type: live.getType(),
      face: live.getFace(),
      privateArea: live.getPrivateArea(),
      respawnTicks: RESPAWN_TICKS,
    };
    core.ObjectManager.deregister(live, true);
    player.getSkillManager().addExperiences(core.Skill[skillKey], xp);
    player.sendMessage(doneMessage);
    regrowLater(snapshot);
  });
}

function chopUse(player, object, axe) {
  const name = displayName(object);
  useTool(player, object, {
    skillKey: "WOODCUTTING",
    xp: CLEAR_XP * helpers.lumberjackXpMultiplier(player),
    animId: axe.animationId,
    startMessage: `You swing your axe at the ${name}.`,
    doneMessage: `You chop the ${name} down.`,
  });
}

function clearUse(player, object) {
  const name = displayName(object);
  useTool(player, object, {
    skillKey: "FARMING",
    xp: CLEAR_XP,
    animId: RAKE_ANIMATION,
    startMessage: `You rake the ${name}.`,
    doneMessage: `You clear the ${name}.`,
  });
}

function chopVegetation(event) {
  const { player, object } = event;
  if (!plantAt(object)) {
    player.sendMessage(ALREADY_CHOPPED_MESSAGE);
    event.handled = true;
    return;
  }
  const axe = playerAxe(player);
  if (!axe) {
    player.sendMessage(NO_AXE_MESSAGE);
    event.handled = true;
    return;
  }
  chopUse(player, object, axe);
  event.handled = true;
}

function clearVegetation(event) {
  const { player, object } = event;
  if (!plantAt(object)) {
    player.sendMessage(ALREADY_CLEARED_MESSAGE);
    event.handled = true;
    return;
  }
  if (!hasRake(player)) {
    player.sendMessage(NO_RAKE_MESSAGE);
    event.handled = true;
    return;
  }
  clearUse(player, object);
  event.handled = true;
}

function toolOnVegetation(event) {
  if (event.handled) return;
  const group = groupFor(event.object);
  if (!group) return;
  const { player, object } = event;
  if (group === "chop") {
    const axe = axeById.get(event.itemId);
    if (!axe) return;
    if (!plantAt(object)) {
      player.sendMessage(ALREADY_CHOPPED_MESSAGE);
      event.handled = true;
      return;
    }
    chopUse(player, object, axe);
    event.handled = true;
    return;
  }
  if (event.itemId !== resolveRakeId()) return;
  if (!plantAt(object)) {
    player.sendMessage(ALREADY_CLEARED_MESSAGE);
    event.handled = true;
    return;
  }
  clearUse(player, object);
  event.handled = true;
}

function attach(pluginApi, woodcutting) {
  api = pluginApi;
  core = pluginApi.core;
  helpers = woodcutting;
  axes = woodcutting.axesBestFirst;
  axeById.clear();
  for (const axe of axes) axeById.set(axe.id, axe);
  for (const name of CHOP_NAMES) {
    pluginApi.onObjectInteraction(name, { [CHOP_ACTION]: chopVegetation });
  }
  for (const name of CLEAR_NAMES) {
    pluginApi.onObjectInteraction(name, { [CLEAR_ACTION]: clearVegetation });
  }
  pluginApi.onItemOnObject(toolOnVegetation);
}

module.exports = {
  attach,
  chopVegetation,
  clearVegetation,
  toolOnVegetation,
  findAnyAxe,
  CHOP_NAMES,
  CLEAR_NAMES,
  CLEAR_XP,
  RESPAWN_TICKS,
  CLEAR_DELAY_TICKS,
  _test: { findAnyAxe, vineKey, groupFor, pending },
};
