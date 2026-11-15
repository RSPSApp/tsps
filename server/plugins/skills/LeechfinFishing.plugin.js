"use strict";

/**
 * Leechfin (Vampyrium, The Blood Moon Rises; https://oldschool.runescape.wiki/w/Leechfin and /Blood_sac): what is done
 * with the fish once the river spots (plugins/bosses/moonsofperil/River.MoonsOfPeril.js, method "leechfin") land it.
 *
 * - Cutting (Wiki): a knife or a fletching knife on a leechfin cuts it, 20 Cooking XP and a 1/3 chance of a blood sac
 *   each; cutting ends any river fishing, and once begun the player's leechfins are cut one a tick (the Wiki: "once
 *   per tick, which cannot be sped up"). Walking, logging out or having none left ends it.
 * - Squeezing (Wiki: Blood sac): 50 blood sacs and an empty vial make a vial of blood (the tradeable one, id 22446,
 *   cache vial_blood). Without a vial a warning is given and continuing "squeezes a sac, it empties onto the floor".
 *
 * Not in the Wiki, so ours: the warning's wording, what squeezing fewer than 50 sacs with a vial says, and that cutting
 * stops when the player starts another action by walking.
 */
const CUT_XP = 20;
const SAC_CHANCE = 1 / 3;
const SACS_PER_VIAL = 50;
const FLOOR_MESSAGE = "You squeeze a sac. It empties onto the floor.";
const WARNING = "You have no empty vial to catch the blood. Squeeze a sac anyway?";
const TOO_FEW = "You need 50 blood sacs to fill a vial.";

let core;
let pluginApi;
let ids;
/** Players cutting leechfin, to the task that cuts for them. */
const cutters = new Map();

function itemIds() {
  const { CacheDefinitions } = core;
  const named = (name) => {
    const id = CacheDefinitions.getObjId(name);
    if (!Number.isInteger(id)) throw new Error(`LeechfinFishing: the cache has no item "${name}"`);
    return id;
  };
  return {
    leechfin: named("leechfin"),
    sac: named("blood_sac"),
    vial: named("vial_empty"),
    blood: named("vial_blood"),
    knives: [named("knife"), named("fletching_knife")],
  };
}

function stopCutting(player) {
  const task = cutters.get(player);
  cutters.delete(player);
  task?.stop?.();
}

/** Cuts one leechfin: it goes, 20 Cooking XP and, a third of the time, a blood sac. */
function cutOne(player) {
  const inventory = player.getInventory();
  if (!inventory.contains(ids.leechfin)) return false;
  inventory.delete(ids.leechfin, 1);
  player.getSkillManager().addExperience(core.Skill.COOKING, CUT_XP, true);
  if (Math.random() < SAC_CHANCE) inventory.add(new core.Item(ids.sac, 1), true);
  return true;
}

function startCutting(player) {
  // Cutting ends any fishing in the river (Wiki).
  pluginApi.emitCustomEvent("river-fishing:stop", { player });
  stopCutting(player);
  if (!cutOne(player)) return;
  const { Task, TaskManager } = core;
  const task = new (class extends Task {
    constructor() {
      super(1, player, false);
    }
    execute() {
      if (!player.isRegistered() || cutters.get(player) !== this || !cutOne(player)) {
        stopCutting(player);
        this.stop();
      }
    }
  })();
  cutters.set(player, task);
  TaskManager.submit(task);
}

function onItemOnItem(event) {
  const { player } = event;
  const pair = [event.usedItemId, event.usedWithItemId];
  if (!pair.includes(ids.leechfin) || !pair.some((id) => ids.knives.includes(id))) return;
  event.handled = true;
  startCutting(player);
}

function squeeze(player) {
  const inventory = player.getInventory();
  if (inventory.contains(ids.vial)) {
    if (inventory.getAmount(ids.sac) < SACS_PER_VIAL) {
      player.sendMessage(TOO_FEW);
      return;
    }
    inventory.delete(ids.sac, SACS_PER_VIAL);
    inventory.delete(ids.vial, 1);
    inventory.add(new core.Item(ids.blood, 1), true);
    return;
  }
  // No vial: the warning, then the sac is spent.
  pluginApi.sendMultiChatboxPrompt(player, WARNING,
    "Yes.", () => {
      if (inventory.getAmount(ids.sac) > 0) inventory.delete(ids.sac, 1);
      player.sendMessage(FLOOR_MESSAGE);
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
}

module.exports = {
  name: "LeechfinFishing",
  description: "Cutting leechfin for Cooking XP and blood sacs, and squeezing 50 blood sacs into a vial of blood.",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    ids = itemIds();
    api.onItemOnItem(onItemOnItem);
    api.onItemAction("Blood sac", { Squeeze: ({ player }) => { squeeze(player); return true; } });
    api.onWalkRoute(({ player }) => stopCutting(player));
    api.onPlayerLogout(({ player }) => stopCutting(player));
  },
};
