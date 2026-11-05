"use strict";

const HEAT = require("../../areas/data/desert-heat.json");

const HUMIDIFY_TASK = "refill-your-waterskins-in-the-desert-using-lunar";
const ICE_BARRAGE_TASK = "cast-ice-barrage-against-a-foe-in-the-desert";

let api = null;
let core = null;
const pendingHumidify = new WeakMap();

function inBox(box, x, y) {
  return x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3];
}

function inDesert(location) {
  if (!location) return false;
  const x = location.getX();
  const y = location.getY();
  const plane = location.getZ();
  if (!HEAT.heat.boxes.some((box) => inBox(box, x, y) && plane >= box[4] && plane <= box[5])) return false;
  return plane !== 0 || !Object.values(HEAT.towns.boxes).some((box) => inBox(box, x, y));
}

function waterskinVessel(player, containers) {
  const ids = [
    core.ItemIdentifiers.WATERSKIN_0_,
    core.ItemIdentifiers.WATERSKIN_1_,
    core.ItemIdentifiers.WATERSKIN_2_,
    core.ItemIdentifiers.WATERSKIN_3_,
  ];
  return ids.some((id) => containers.has(id) && player.getInventory().contains(id));
}

function onWaterContainers(event) {
  const player = event.player;
  if (!player || !inDesert(player.getLocation()) || !waterskinVessel(player, event.containers)) return;
  pendingHumidify.set(player, core.World.getProcessCycle());
}

function onHumidified(event) {
  const player = event.player;
  if (!player) return;
  const tick = pendingHumidify.get(player);
  pendingHumidify.delete(player);
  if (tick !== core.World.getProcessCycle() || !inDesert(player.getLocation())) return;
  api.emitCustomEvent("diary:task", { player, diary: "desert", task: HUMIDIFY_TASK });
}

function onCombatHitResolved(event) {
  const { attacker, target, hit } = event;
  if (!attacker?.isPlayer?.() || !target) return;
  if (hit?.getSpell?.()?.spellId?.() !== core.CombatSpells.ICE_BARRAGE.spellId()) return;
  if (hit.isAccurate?.() !== true) return;
  const at = attacker.getLocation();
  const foe = target.getLocation();
  if (!inDesert(at) || !inDesert(foe)) return;
  api.emitCustomEvent("diary:task", { player: attacker, diary: "desert", task: ICE_BARRAGE_TASK });
}

module.exports = {
  name: "DesertFinishAchievementDiaries",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("magic:water-containers", onWaterContainers);
    api.onCustomEvent("magic:humidified", onHumidified);
    api.onCombatHitResolved(onCombatHitResolved);
  },
  _test: { inDesert, onWaterContainers, onHumidified, onCombatHitResolved, HUMIDIFY_TASK, ICE_BARRAGE_TASK },
};
