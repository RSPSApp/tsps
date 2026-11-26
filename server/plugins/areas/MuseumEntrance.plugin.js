/** The cleaning-area gate's Museum guard transcript and per-login admission. */
const { startTranscript } = require("../quests/QuestRuntime");
const ENTER_STEP = "AFy65N";
const PAGE = "Museum guard";
const admitted = new WeakSet();
const pending = new WeakMap();
let api, core, gateId;

function completed(player) {
  const request = { player, key: "the_dig_site", complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function atDoor(player, y) {
  const at = player.getLocation();
  return at.getX() === 3261 && at.getY() === y && at.getZ() === 0 && !player.getPrivateArea();
}

function play(player, variant) {
  startTranscript(api, player, core.NpcIdentifiers.MUSEUM_GUARD, PAGE, variant);
}

function enter(player, object) {
  const request = { player, object, handled: false };
  api.emitCustomEvent("door:open", request);
  if (!request.handled) return;
  // Only a completed crossing suppresses the first-admission prompt for this login.
  const task = new core.Task(2, player);
  task.execute = () => {
    task.stop();
    if (player.isRegistered() && atDoor(player, 3446)) admitted.add(player);
  };
  core.TaskManager.submit(task);
}

function useGate(event) {
  const { player, object, objectId } = event;
  const at = object?.getLocation();
  if (event.handled || objectId !== gateId || at?.getX() !== 3261 || ![3446, 3447].includes(at.getY()) || at.getZ() !== 0) return;
  pending.delete(player);
  if (atDoor(player, 3446)) return; // Leaving the cleaning area is free.
  event.handled = true;
  if (!atDoor(player, 3447)) return;
  if (!core.WorldDefinition.isMembersWorld()) { play(player, "standard-free-to-play-dialogue"); return; }
  if (!completed(player)) { play(player, "museum-gate-dialogue-before-completing-the-dig-site"); return; }
  if (admitted.has(player)) { enter(player, object); return; }
  pending.set(player, object);
  play(player, "museum-gate-first-dialogue-after-login-with-the-dig-site-completed");
}

function accept(event) {
  if (event.handled || event.npcId !== core.NpcIdentifiers.MUSEUM_GUARD || event.stepId !== ENTER_STEP) return;
  const { player } = event, object = pending.get(player);
  pending.delete(player);
  event.handled = true;
  if (object && atDoor(player, 3447) && core.WorldDefinition.isMembersWorld() && completed(player)) enter(player, object);
}

function logout({ player }) { admitted.delete(player); pending.delete(player); }

module.exports = {
  name: "MuseumEntrance",
  description: "Guards entry to the Varrock Museum cleaning area, including on free worlds.",
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    gateId = core.CacheDefinitions.getLocId("vm_barrier_guard_gate");
    api.onCustomEvent("door:toggle", useGate);
    api.onCustomEvent("npc-dialogue:action", accept);
    api.onPlayerLogout(logout);
  },
};
