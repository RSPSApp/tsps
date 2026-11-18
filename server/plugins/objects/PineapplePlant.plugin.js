"use strict";

/**
 * Karamja's wild pineapple plants (locs pineapple_plant 1408, _four 1409, _three 1410, _two 1411,
 * _one 1412; every stage has Pick). As captured (rsprox.net 552, 1102 and local 1000195, 1000359,
 * 1000412, revs 227 and 237): Pick gives, the tick after the arrival, synth 2581, "You pick a
 * pineapple." (spam), +1 pineapple, and the plant one stage down (pineapple_plant -> _four). The
 * recordings show plants climbing back up a stage at a time (1102: _two -> _three -> _four).
 * Emits "world:picked" { player, itemId, plant } as Pickable does (a league's "Pick a Pineapple on
 * Karamja").
 *
 * The last pineapple leaves `pineapple_plant_no_pineapples` (1413), placed bare on these tiles in
 * recordings 75, 549, 1104, 1710 and 1851 (1851 tick 17595: all five Karamja plants bare); it has no
 * Pick. In 1710 a bare plant at 2760,3157 went straight back to the full one (1413 at tick 6301,
 * 1408 at 6334).
 *
 * Ours (nothing times the regrowth): a bare plant is full again REGROW_TICKS after its last pick; a
 * part-picked one grows back a stage every REGROW_TICKS; a full pack gets Pickable's "Your
 * inventory is too full to hold any more.".
 */
const STAGES = [1408, 1409, 1410, 1411, 1412];
const BARE = 1413;
const PICK_TICKS = 1;
const PICK_SOUND = 2581;
const REGROW_TICKS = 100;
const PICKED = "You pick a pineapple.";
const FULL = "Your inventory is too full to hold any more.";

let api = null;
/** Plant tile -> { stage (index into STAGES, or STAGES.length when bare), object, base, task }. */
const plants = new Map();

function key(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

function place(entry, stage) {
  const { core } = api;
  if (entry.object) core.ObjectManager.deregister(entry.object, true);
  entry.stage = stage;
  const { base } = entry;
  const id = stage >= STAGES.length ? BARE : STAGES[stage];
  entry.object = new core.GameObject(id, base.getLocation().clone(), base.getType(), base.getFace(), base.getPrivateArea());
  core.ObjectManager.register(entry.object, true);
}

/** One stage back every REGROW_TICKS until full, then the cache's own plant again. */
function regrow(tile, entry) {
  const { core } = api;
  entry.task = new core.CountdownTask(entry, REGROW_TICKS, () => {
    // A bare plant comes back full (1710); a part-picked one a stage at a time (1102).
    const back = entry.stage >= STAGES.length ? 0 : entry.stage - 1;
    if (back <= 0) {
      if (entry.object) core.ObjectManager.deregister(entry.object, true);
      core.ObjectManager.register(entry.base, true);
      plants.delete(tile);
      return;
    }
    place(entry, back);
    regrow(tile, entry);
  });
  core.TaskManager.submit(entry.task);
}

function pick({ player, object }) {
  const { core } = api;
  const stage = STAGES.indexOf(object?.getId?.());
  if (stage < 0) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(FULL);
    return true;
  }
  const tile = key(object.getLocation());
  player.setPositionToFace(object.getLocation());
  core.TaskManager.submit(new core.CountdownTask(player, PICK_TICKS, () => {
    const entry = plants.get(tile) ?? { stage: 0, object, base: object, task: null };
    // Someone else's pick got there first: this stage is gone.
    if (entry.stage !== stage || (entry.object ?? null) !== object || !player.isRegistered()) return;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL);
      return;
    }
    player.getPacketSender().sendSoundEffect(PICK_SOUND, 1, 0);
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, PICKED);
    player.getInventory().adds(core.ItemIdentifiers.PINEAPPLE, 1);
    api.emitCustomEvent("world:picked", { player, itemId: core.ItemIdentifiers.PINEAPPLE, plant: "Pineapple Plant" });
    if (!plants.has(tile)) plants.set(tile, entry);
    else if (entry.task) entry.task.stop();
    place(entry, stage + 1);
    regrow(tile, entry);
  }));
  return true;
}

module.exports = {
  name: "PineapplePlant",
  description: "Lets players pick Karamja's wild pineapple plants, a stage at a time, as captured; picked plants grow back a stage at a time.",
  members: true,
  _test: { pick, plants, STAGES, PICKED, FULL, REGROW_TICKS },
  register(pluginApi) {
    api = pluginApi;
    api.onObjectInteraction("Pineapple Plant", { Pick: pick });
  },
};
