/**
 * Pickable scenery (Wheat, Potato, Onion, Cabbage, Sweetcorn, Flax, Nettles), from
 * data/definitions/pickables.json.
 *
 * As in rsprox captures of picking potatoes and wheat: the pick animation (827) plays on the tick
 * the player is beside the plant; a tick later come the message, the item, sound 2581 and, when
 * the plant depletes, its removal for everyone (or its "empty" version), until it respawns.
 * Matched by object name + "Pick", so decorative variants without the option fall through.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");

const PICK_ANIMATION = new Animation(827);
const NETTLE_DAMAGE_MAX = 2;
const PICKABLES = JSON.parse(
  fs.readFileSync(path.join(GameConstants.DEFINITIONS_DIRECTORY, "pickables.json"), "utf8"),
).pickables;
const PICKABLE_BY_NAME = new Map(PICKABLES.map((pickable) => [pickable.name, pickable]));

/** Plants picked bare that have not respawned yet, so nobody picks the same one twice. */
const picked = new Set();

let TaskManager;

function plantKey(object) {
  const at = object.getLocation();
  return `${at.getX()},${at.getY()},${at.getZ()}`;
}

function respawnTicks(pickable, random = Math.random) {
  const ticks = pickable.respawnTicks;
  return Array.isArray(ticks) ? ticks[0] + Math.floor(random() * (ticks[1] - ticks[0] + 1)) : ticks;
}

/** Wiki (Nettles): any gloves do, except beekeeper's gloves. */
function wearsGloves(player) {
  const id = player.getEquipment().get(Equipment.HANDS_SLOT)?.getId?.() ?? -1;
  if (id <= 0) return false;
  const name = String(ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase();
  return !name.startsWith("beekeeper");
}

/** Removes the plant for everyone (or swaps in its empty version) until it respawns. */
function deplete(object, pickable, random = Math.random) {
  const key = plantKey(object);
  picked.add(key);
  const emptyId = pickable.empty?.[object.getId()];
  const empty = emptyId === undefined ? null
    : new GameObject(emptyId, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea());
  ObjectManager.deregister(object, true);
  if (empty) ObjectManager.register(empty, true);
  // The respawn counts from the pick's first tick; the removal comes a tick after it.
  TaskManager.submit(new RespawnTask(Math.max(1, respawnTicks(pickable, random) - 1), object, empty, key));
}

class RespawnTask extends Task {
  constructor(ticks, object, empty, key) {
    super(ticks);
    this.object = object;
    this.empty = empty;
    this.key = key;
  }

  execute() {
    if (this.empty) ObjectManager.deregister(this.empty, true);
    ObjectManager.register(this.object, true);
    picked.delete(this.key);
    this.stop();
  }
}

/** The pick's second tick: what the plant gives, and whether it goes. */
class PickTask extends Task {
  constructor(player, object, pickable) {
    // Not keyed to the player: a new click must not lose a pick already under way.
    super(1);
    this.player = player;
    this.object = object;
    this.pickable = pickable;
  }

  execute() {
    this.stop();
    const { player, object, pickable } = this;
    if (!player.isRegistered()) {
      picked.delete(plantKey(object));
      return;
    }
    if (pickable.needsGloves && !wearsGloves(player)) {
      picked.delete(plantKey(object));
      player.sendMessage("You have been stung by the nettles!");
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1 + Math.floor(Math.random() * NETTLE_DAMAGE_MAX), HitMask.RED)]);
      return;
    }
    player.getInventory().adds(pickable.item, 1);
    player.sendMessage(pickable.message);
    Sounds.sendSound(player, Sound.PICK);
    if (Math.random() < pickable.deplete) deplete(object, pickable);
    else picked.delete(plantKey(object));
  }
}

function pick(event) {
  const { player, object } = event;
  const pickable = PICKABLE_BY_NAME.get(event.definition?.getName?.() ?? object?.getDefinition?.()?.getName?.());
  if (!pickable || !object) return false;
  const key = plantKey(object);
  if (picked.has(key)) return true;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("Your inventory is too full to hold any more.");
    return true;
  }
  picked.add(key);
  player.setPositionToFace(object.getLocation());
  player.performAnimation(PICK_ANIMATION);
  TaskManager.submit(new PickTask(player, object, pickable));
  return true;
}

module.exports = {
  name: "Pickable",
  register(api) {
    TaskManager = api.getTaskManager();
    for (const pickable of PICKABLES) {
      api.onObjectInteraction(pickable.name, { Pick: pick, pick: pick, "pick-flax": pick });
    }
  },
};

module.exports._test = { pick, deplete, respawnTicks, wearsGloves, picked, PICKABLES };
