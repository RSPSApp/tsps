"use strict";

/**
 * Barbarian funeral pyres (Wiki: Funeral pyre (Barbarian); Barbarian Training "Pyre ships").
 *
 * The cache places the "Pyre site" (25286) around the lake by Otto's Grotto. Its Construct
 * option carves the site; the state locs are 25263/25264 (carved log), 25265 (pyre boat),
 * 25266 (pyre boat with bones), 25267 (lit) and 25293 (floating). The Wiki's sequence is:
 * an axe and logs build the ship, bones go on it, then a tinderbox or bow lights it. Magic
 * logs need 85 Crafting and 85 Firemaking (75.9 Crafting, 303.8 Firemaking experience).
 *
 * The diary task credits when chewed bones are placed on a magic-log pyre boat. The item
 * reward from the peaceful spirit is not modelled here.
 */

const PYRE_SITE = 25286;
const CARVED_LOG = 25264;
const PYRE_BOAT = 25265;
const PYRE_BOAT_BONES = 25266;
const PYRE_LIT = 25267;
const PYRE_FLOATING = 25293;

const CHEWED_BONES = 11338;
const MANGLED_BONES = 11337;
const TINDERBOX = 590;

/** Wiki Table/Pyre ships: logs -> { craft, firemaking, craftXp, firemakingXp }. */
const PYRE_LOGS = new Map([
  [1511, { craft: 11, firemaking: 11, craftXp: 10, firemakingXp: 40 }], // logs
  [1521, { craft: 25, firemaking: 25, craftXp: 15, firemakingXp: 60 }], // oak
  [1519, { craft: 40, firemaking: 40, craftXp: 22.5, firemakingXp: 90 }], // willow
  [6333, { craft: 45, firemaking: 45, craftXp: 26.2, firemakingXp: 105 }], // teak
  [10810, { craft: 52, firemaking: 52, craftXp: 31.2, firemakingXp: 125 }], // arctic pine
  [1517, { craft: 55, firemaking: 55, craftXp: 33.7, firemakingXp: 135 }], // maple
  [6332, { craft: 60, firemaking: 60, craftXp: 39.3, firemakingXp: 157.5 }], // mahogany
  [1515, { craft: 70, firemaking: 70, craftXp: 50.6, firemakingXp: 202.5 }], // yew
  [1513, { craft: 85, firemaking: 85, craftXp: 75.9, firemakingXp: 303.8 }], // magic
  [19672, { craft: 95, firemaking: 95, craftXp: 87, firemakingXp: 350 }], // redwood
]);

const NON_FIREMAKING_BOWS = new Set([
  "twisted bow", "cursed goblin bow", "dark bow", "crystal bow", "ogre bow",
  "rain bow", "starter bow", "signed oak bow",
]);

let api;
let core;
/** Tile key -> { player, logsId, bonesId, object }. */
const pyres = new Map();

const tileKey = (object) => `${object.getLocation().getX()},${object.getLocation().getY()},${object.getLocation().getZ()}`;

function itemName(itemId) {
  try {
    return String(core.ItemDefinition.forId(itemId)?.getName?.() ?? "");
  } catch {
    return "";
  }
}

function isAxe(itemId) {
  const name = itemName(itemId).toLowerCase();
  return name.endsWith("axe") && !name.includes("pickaxe") && !name.includes("battleaxe")
    && !name.includes("thrownaxe") && !name.includes("halberd");
}

function isBow(itemId) {
  const name = itemName(itemId).toLowerCase();
  return name.endsWith("bow") && !name.includes("crossbow") && !NON_FIREMAKING_BOWS.has(name);
}

function hasAxe(inventory) {
  return inventory.getItems().some((item) => item && isAxe(item.getId()));
}

function carriedLog(inventory) {
  for (const [id] of PYRE_LOGS) {
    if (inventory.contains(id)) return id;
  }
  return null;
}

function swap(object, id) {
  const next = new core.GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
  core.ObjectManager.register(next, true);
  return next;
}

function near(object, player) {
  return object.isWithinInteractionDistance(player.getLocation());
}

function construct(event) {
  const { player, object } = event;
  if (!player || !object || object.getId() !== PYRE_SITE) return false;
  return buildPyre(player, object, carriedLog(player.getInventory()));
}

/** Wiki: use logs on the pyre site to pick which logs the pyre is built from. */
function itemOnSite(event) {
  const { player, object, objectId, itemId } = event;
  if (!player || !object || objectId !== PYRE_SITE || !PYRE_LOGS.has(itemId)) return false;
  event.handled = true;
  return buildPyre(player, object, itemId);
}

function buildPyre(player, object, logsId) {
  if (!near(object, player)) return true;
  const key = tileKey(object);
  if (pyres.has(key)) {
    player.sendMessage("There is already a pyre here.");
    return true;
  }
  const inventory = player.getInventory();
  if (!hasAxe(inventory)) {
    player.sendMessage("You need an axe to carve the pyre.");
    return true;
  }
  if (logsId == null || !inventory.contains(logsId)) {
    player.sendMessage("You need some logs to build the pyre.");
    return true;
  }
  const row = PYRE_LOGS.get(logsId);
  if (player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING) < row.craft) {
    player.sendMessage(`You need a Crafting level of at least ${row.craft} to build that pyre.`);
    return true;
  }
  inventory.deleteNumber(logsId, 1);
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, row.craftXp);
  const next = swap(object, PYRE_BOAT);
  pyres.set(key, { player, logsId, bonesId: null, object: next });
  player.sendMessage("You place the logs on the pyre.");
  return true;
}

function itemOnPyre(event) {
  const { player, objectId, itemId } = event;
  const object = event.object;
  if (!object || !player) return false;
  const use = pyres.get(tileKey(object));
  if (!use) return false;
  if (use.player !== player) {
    player.sendMessage("This pyre belongs to someone else.");
    event.handled = true;
    return true;
  }
  if (!near(object, player)) return false;

  if (objectId === PYRE_BOAT) {
    if (itemId !== CHEWED_BONES && itemId !== MANGLED_BONES) return false;
    if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < PYRE_LOGS.get(use.logsId).firemaking) {
      player.sendMessage(`You need a Firemaking level of at least ${PYRE_LOGS.get(use.logsId).firemaking} to light that pyre.`);
      event.handled = true;
      return true;
    }
    player.getInventory().deleteNumber(itemId, 1);
    use.bonesId = itemId;
    use.object = swap(object, PYRE_BOAT_BONES);
    player.sendMessage("You place the bones on the pyre.");
    if (use.logsId === 1513 && itemId === CHEWED_BONES) {
      api.emitCustomEvent("barbarian-pyre:built", { player, logsId: use.logsId, bonesId: itemId });
    }
    event.handled = true;
    return true;
  }

  if (objectId === PYRE_BOAT_BONES) {
    if (itemId !== TINDERBOX && !isBow(itemId)) return false;
    if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < PYRE_LOGS.get(use.logsId).firemaking) {
      player.sendMessage(`You need a Firemaking level of at least ${PYRE_LOGS.get(use.logsId).firemaking} to light that pyre.`);
      event.handled = true;
      return true;
    }
    const row = PYRE_LOGS.get(use.logsId);
    player.getSkillManager().addExperiences(core.Skill.FIREMAKING, row.firemakingXp);
    use.object = swap(object, PYRE_LIT);
    player.sendMessage("You light the pyre.");
    event.handled = true;
    core.TaskManager.submit(new (class extends core.Task {
      constructor() { super(6); }
      execute() {
        this.stop();
        const current = pyres.get(tileKey(object));
        if (current) {
          swap(use.object, PYRE_FLOATING);
          pyres.delete(tileKey(object));
        }
      }
    })());
    return true;
  }

  return false;
}

function attach(registry) {
  api = registry;
  core = registry.core;
  registry.onObjectInteraction("Pyre site", { Construct: construct });
  registry.onItemOnObject(itemOnSite, { noted: false });
  registry.onItemOnObject(itemOnPyre, { noted: false });
}

module.exports = {
  name: "BarbarianPyres",
  members: true,
  register: attach,
  _test: { PYRE_SITE, PYRE_BOAT, PYRE_BOAT_BONES, PYRE_LIT, PYRE_LOGS, construct, itemOnSite, itemOnPyre, pyres, isAxe, isBow },
};
