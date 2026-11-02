// Wiki mechanics and RSProx 4005/4045; current-cache widgets and transforms: docs/canoes.md.
const { stations } = require("../data/canoes.json");
// shortcut: Lumbridge/Ferox/pond arrivals use checked cache-bank tiles; replace with captured landings when available.
const { createQuestScenes } = require("../../quests/QuestScenes");
const TYPES = [
  { id: 1, button: 20, level: 12, xp: 30, name: "log" },
  { id: 2, button: 18, level: 27, xp: 60, name: "dugout" },
  { id: 3, button: 12, level: 42, xp: 90, name: "stable dugout" },
  { id: 4, button: 11, level: 57, xp: 150, name: "waka" },
];
const SHAPE_INTERFACE = 416;
const MAP_LUM = 953;
const MAP_DOUGNE = 952;
const MAIN_MODAL = (161 << 16) | 16;
const OP1 = 1 << 1;
const CANOE_ATTRIBUTE = "canoes:canoe";
const MENU_ATTRIBUTE = "canoes:menu";
const AXE_ATTRIBUTE = "canoes:stored-axe";
const RETURN_ATTRIBUTE = "canoes:return";
const ASSISTANTS = ["Barfy Bill", "Tarquin", "Sigurd", "Hari", "Marten", "Lara", "Porkai", "Pete", "Amergin", "Kaiquir"];
const SHAPE_CHANCES = [[32, 100], [48, 150], [64, 200], [72, 225], [80, 250], [96, 300], [112, 350], [112, 350]];
const CHOP_CHANCES = [[70, 200], [96, 296], [144, 360], [128, 496]];
// shortcut: the Wiki only charts bronze through black tree rolls; higher axes fell the tree on their first attempt.
/** Ticks from the Chop-down click to the first swing (rsprox 4005: the swing 3 ticks after the click lands). */
const CHOP_DELAY_TICKS = 3;
const TREE_FALL_SOUND = 2734;
/** The ride (rsprox 4005, every ride): the river loop, played on rowing start, and the ride's camera variables. */
const RIDE_SOUND = 2728;
const RIDE_SOUND_LOOPS = 16;
const RIDE_VARBITS = ["fov_clamp", "draw_distance_max_override"];
const RIDE_TILE = [1817, 4515];
/** Rowing faces west (face_angle 512). */
const RIDE_FACE = [1816, 4515];
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
/**
 * The river scenery drifting past (rsprox 4005): each steps one tile north per tick, ignoring the map, to
 * `endY`; one tick after reaching it it is deleted and, `respawn.delay` ticks later, comes back at
 * `respawn.at` to drift again. scenery_2 stops at 4523 and stays for the rest of the ride.
 */
const RIDE_SCENERY = [
  { name: "canoeing_bullrush", at: [1820, 4516], endY: 4522, respawn: { at: [1820, 4501], delay: 3 } },
  { name: "canoeing_bullrush_leaf", at: [1819, 4516], endY: 4522, respawn: { at: [1819, 4505], delay: 3 } },
  { name: "canoeing_scenery_1", at: [1822, 4516], endY: 4522, respawn: { at: [1821, 4500], delay: 0 } },
  { name: "canoeing_scenery_2", at: [1821, 4503], endY: 4523 },
];
const jobs = new WeakMap();
let core;
let api;
let scenes;

function setVar(player, name, value) {
  player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(name), value);
}

function state(player, station) {
  return player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(station.state));
}

function stationOf(object) {
  const at = object.getLocation();
  return stations.find((s) => s.tree && s.tree[0] === at.getX() && s.tree[1] === at.getY() && at.getZ() === 0);
}

function near(player, station) {
  const at = player.getLocation();
  return at.getZ() === 0 && Math.max(Math.abs(at.getX() - station.tree[0]), Math.abs(at.getY() - station.tree[1])) <= 8;
}

function level(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
}

function axeFor(player) {
  const request = { player, axe: null };
  api.emitCustomEvent("woodcutting:axe", request);
  const stored = { player, itemId: player.getAttribute(AXE_ATTRIBUTE)?.id, axe: null };
  if (stored.itemId) api.emitCustomEvent("woodcutting:axe", stored);
  if (stored.axe && (!request.axe || stored.axe.tier > request.axe.tier)) return stored.axe;
  return request.axe;
}

function chance(level, [low, high]) {
  const l = Math.max(1, Math.min(99, level));
  return Math.min(1, (1 + Math.floor(low * (99 - l) / 98) + Math.floor(high * (l - 1) / 98)) / 256);
}

function usable(player, station) {
  if (!station || jobs.has(player)) return false;
  if (station.river === 1 && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members world to use the River Dougne canoes.");
    return false;
  }
  return near(player, station);
}

function requireAxe(player) {
  const axe = axeFor(player);
  if (!axe) player.sendMessage("You need an axe which you have the required Woodcutting level to use to be able to chop down this tree.");
  return axe;
}

function clearCanoe(player) {
  const old = player.getAttribute(CANOE_ATTRIBUTE);
  if (old) setVar(player, old.state, 0);
  player.setAttribute(CANOE_ATTRIBUTE, null);
  setVar(player, "canoe_type", 0);
  setVar(player, "canoe_avoid_if", 0);
}

function closeMenu(player) {
  player.setAttribute(MENU_ATTRIBUTE, null);
  player.setInterfaceId(-1);
  player.getPacketSender().closeSubInterface(MAIN_MODAL).sendInterfaceScript(2158);
}

function openMenu(player, station, group, buttons) {
  player.setAttribute(MENU_ATTRIBUTE, { station, group });
  player.getPacketSender().sendInterfaceScript(2524, [-1, -1]);
  player.setInterfaceId(group);
  player.getPacketSender().sendSubInterface(MAIN_MODAL, group, 0);
  for (const button of buttons) player.getPacketSender().sendInterfaceFlagsRange((group << 16) | button, 0, 0, OP1);
}

function finishJob(player, job) {
  if (!job || jobs.get(player) !== job) return;
  jobs.delete(player);
  core.TaskManager.cancelTasks(job);
  if (!scenes.get(player) && player.getAttribute(RETURN_ATTRIBUTE)) {
    player.setAttribute(RETURN_ATTRIBUTE, null);
    scenes.closeFade(player);
  }
  setVar(player, "canoe_avoid_if", 0);
  player.getMovementQueue().setBlockMovement(false);
  player.performAnimation(new core.Animation(-1));
}

function later(player, ticks, run) {
  const job = jobs.get(player);
  core.TaskManager.submit(new core.CountdownTask(job, ticks, () => {
    if (jobs.get(player) !== job) return;
    if (!player.isRegistered() || player.getHitpoints() <= 0) { finishJob(player, job); return; }
    run(job);
  }));
}

function startJob(player) {
  const job = {};
  jobs.set(player, job);
  player.getMovementQueue().reset().setBlockMovement(true);
  return job;
}

function chop({ player, object }) {
  const station = stationOf(object);
  if (!usable(player, station)) return false;
  if (level(player) < 12) {
    player.sendMessage("You must have at least level 12 woodcutting to start making canoes.");
    return;
  }
  if (!requireAxe(player)) return;
  clearCanoe(player);
  player.setAttribute(CANOE_ATTRIBUTE, station);
  setVar(player, "canoe_river", station.river);
  setVar(player, "canoe_startfrom", station.id);
  startJob(player);
  function attempt() {
    const axe = requireAxe(player);
    if (!axe || !near(player, station)) { finishJob(player, jobs.get(player)); return; }
    player.performAnimation(new core.Animation(axe.animationId));
    later(player, 1, () => {
      if (!near(player, station) || level(player) < 12 || !requireAxe(player)) { finishJob(player, jobs.get(player)); return; }
      if (Math.random() >= (axe.tier >= CHOP_CHANCES.length ? 1 : chance(level(player), CHOP_CHANCES[axe.tier]))) {
        later(player, 3, attempt);
        return;
      }
      player.performAnimation(new core.Animation(-1));
      setVar(player, station.state, 9);
      player.getPacketSender().sendSound(TREE_FALL_SOUND, 1, 0);
      player.getPacketSender().sendObjectAnimation(object, new core.Animation(core.CacheDefinitions.getSeqId("canoeing_station_animations")));
      later(player, 1, (job) => {
        setVar(player, station.state, 10);
        finishJob(player, job);
      });
    });
  }
  later(player, CHOP_DELAY_TICKS, attempt);
}

function shape({ player, object }) {
  const station = stationOf(object);
  if (!usable(player, station)) return false;
  if (state(player, station) !== 10 || !requireAxe(player)) return;
  openMenu(player, station, SHAPE_INTERFACE, [...TYPES.map((t) => t.button), 9]);
}

function carve(player, station, type) {
  if (state(player, station) !== 10 || level(player) < type.level || !requireAxe(player)) return;
  setVar(player, "canoe_type", type.id);
  setVar(player, "canoe_avoid_if", 1);
  startJob(player);
  function attempt() {
    const axe = requireAxe(player);
    if (!axe || !near(player, station) || level(player) < type.level) {
      setVar(player, "canoe_avoid_if", 0);
      finishJob(player, jobs.get(player));
      return;
    }
    const animation = core.CacheDefinitions.getSeqName(axe.animationId)?.replace("woodcutting", "canoeing_carve");
    player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(animation)));
    later(player, 4, (job) => {
      if (!near(player, station) || level(player) < type.level || !requireAxe(player)) { finishJob(player, job); return; }
      if (Math.random() >= chance(level(player), SHAPE_CHANCES[axe.tier])) { attempt(); return; }
      setVar(player, station.state, type.id);
      setVar(player, "canoe_avoid_if", 0);
      player.getSkillManager().addExperience(core.Skill.WOODCUTTING, type.xp);
      if (station.id === 4 && type.id === 4) api.emitCustomEvent("diary:task", { player, diary: "varrock", task: "make-a-waka-canoe-near-edgeville" });
      finishJob(player, job);
    });
  }
  attempt();
}

function float({ player, object }) {
  const station = stationOf(object);
  if (!usable(player, station)) return false;
  const type = TYPES.find((t) => t.id === state(player, station));
  if (!type) return;
  startJob(player);
  setVar(player, station.state, type.id + 4);
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("canoeing_pushing_into_water")));
  player.getPacketSender().sendObjectAnimation(object, new core.Animation(core.CacheDefinitions.getSeqId("canoeing_station_animations")));
  later(player, 2, (job) => {
    setVar(player, station.state, type.id + 10);
    finishJob(player, job);
  });
}

function canTravel(from, to, type) {
  return from.river === to.river && from.id !== to.id &&
    (type.id === 4 || (to.id !== 0 && to.id !== 5 && Math.abs(from.id - to.id) <= type.id));
}

function paddle({ player, object }) {
  const station = stationOf(object);
  if (!usable(player, station)) return false;
  if (!TYPES.some((t) => state(player, station) === t.id + 10)) return;
  openMenu(player, station, station.river ? MAP_DOUGNE : MAP_LUM, station.river ? [7, 12, 17, 22, 27] : [7, 12, 17, 22, 27, 28]);
}

function sceneEnded(player, scene, logout) {
  for (const name of RIDE_VARBITS) setVar(player, name, 0);
  const back = player.getAttribute(RETURN_ATTRIBUTE);
  if (back) player.moveTo(new core.Location(...back));
  player.setAttribute(RETURN_ATTRIBUTE, null);
  scenes.closeFade(player);
  finishJob(player, jobs.get(player));
  if (logout) clearCanoe(player);
}

function arrive(player, from, to, type) {
  player.setAttribute(RETURN_ATTRIBUTE, null);
  scenes.end(player, false);
  player.moveTo(new core.Location(...to.landing, 0));
  clearCanoe(player);
  player.sendMessage(`You arrive at ${to.name}.<br>Your canoe sinks into the water after the hard journey.`);
  const sinkId = core.CacheDefinitions.getLocId(`canoeing_${["log", "dugout", "catamaran", "waka"][type.id - 1]}_sinking`);
  const [x, y, face] = to.sink;
  const sinking = new core.GameObject(sinkId, new core.Location(x, y, 0), 10, face);
  player.getPacketSender().sendObject(sinking);
  core.TaskManager.submit(new core.CountdownTask({}, 3, () => {
    if (player.isRegistered()) player.getPacketSender().sendObjectRemoval(sinking);
  }));
  if (from.id === 1 && to.id === 4 && type.id === 4) api.emitCustomEvent("diary:task", { player, diary: "lumbridge-draynor", task: "travel-from-lumbridge-to-edgeville-on-a-waka-can" });
}

/** One drifting piece of river scenery; see RIDE_SCENERY. */
function drift(scene, piece, [x, y]) {
  if (scenes.get(scene.owner) !== scene) return;
  const npc = scenes.actor(scene, core.CacheDefinitions.getNpcId(piece.name), [x, y, 0]);
  if (!npc) return;
  npc.setFlag(IGNORE_CLIPPING_FLAG, true);
  npc.getMovementQueue().addSteps(new core.Location(x, piece.endY, 0));
  if (!piece.respawn) return;
  scenes.later(scene, piece.endY - y + 1, () => {
    scenes.removeActor(scene, npc);
    if (piece.respawn.delay > 0) scenes.later(scene, piece.respawn.delay, () => drift(scene, piece, piece.respawn.at));
    else drift(scene, piece, piece.respawn.at);
  });
}

function travel(player, from, to, type) {
  if (!usable(player, from) || !canTravel(from, to, type) || state(player, from) !== type.id + 10) return;
  startJob(player);
  const at = player.getLocation();
  player.setAttribute(RETURN_ATTRIBUTE, [at.getX(), at.getY(), at.getZ()]);
  scenes.fade(player, true);
  later(player, 2, () => {
    const scene = scenes.open(player, "canoe", [[1792, 1855, 4480, 4543, 0]]);
    player.moveTo(new core.Location(...RIDE_TILE, 0));
    scenes.controls(player, true, true);
    for (const name of RIDE_VARBITS) setVar(player, name, 1);
    player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("canoeing_rowing")));
    scenes.face(player, RIDE_FACE);
    scenes.camera(player, [1812, 4515, 255], [1817, 4515, 255], { rate: 100, rate2: 100 });
    player.getPacketSender().sendSoundEffect(RIDE_SOUND, RIDE_SOUND_LOOPS, 0, 255);
    for (const piece of RIDE_SCENERY) drift(scene, piece, piece.at);
    scenes.later(scene, 1, () => scenes.fade(player, false));
    scenes.later(scene, 22, () => scenes.fade(player, true));
    scenes.later(scene, 26, () => arrive(player, from, to, type));
  });
}

function select({ player, buttonId, groupId = buttonId >>> 16, childId = buttonId & 0xffff, opId = 1 }) {
  const menu = player.getAttribute(MENU_ATTRIBUTE);
  if (!menu || menu.group !== groupId || player.getInterfaceId() !== groupId || opId !== 1) return;
  if (!usable(player, menu.station)) { closeMenu(player); return; }
  if (childId === (groupId === SHAPE_INTERFACE ? 9 : 5)) { closeMenu(player); return; }
  if (groupId === SHAPE_INTERFACE) {
    const type = TYPES.find((t) => t.button === childId);
    if (type) { closeMenu(player); carve(player, menu.station, type); }
    return;
  }
  const buttons = groupId === MAP_LUM ? [7, 12, 17, 22, 27, 28] : [7, 12, 17, 22, 27];
  const to = stations.filter((s) => s.river === menu.station.river)[buttons.indexOf(childId)];
  const type = TYPES.find((t) => state(player, menu.station) === t.id + 10);
  if (!to || !type || !canTravel(menu.station, to, type)) return;
  closeMenu(player);
  if (to.id === 0) {
    api.sendMultiChatboxPrompt(player, "Travel into the Wilderness? This is a one-way trip.", ["Yes, take me into the Wilderness.", () => travel(player, menu.station, to, type), "No, stay here.", () => {}]);
  } else travel(player, menu.station, to, type);
}

function menuClosed({ player, interfaceId }) {
  if (player.getAttribute(MENU_ATTRIBUTE)?.group === interfaceId) player.setAttribute(MENU_ATTRIBUTE, null);
}

function restore({ player }) {
  const back = player.getAttribute(RETURN_ATTRIBUTE);
  if (back) { player.moveTo(new core.Location(...back)); player.setAttribute(RETURN_ATTRIBUTE, null); }
}

function logout({ player }) {
  if (scenes.get(player)) scenes.end(player, true);
  finishJob(player, jobs.get(player));
  player.setAttribute(MENU_ATTRIBUTE, null);
  clearCanoe(player);
}

function speak(player, npc, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.NpcDialogue(0, npc.getId(), text)));
}

function storeAxe({ player, npc }) {
  const stored = player.getAttribute(AXE_ATTRIBUTE);
  if (stored) {
    if (player.getInventory().isFull()) { player.sendMessage("You need some free inventory space to take your axe back."); return; }
    player.getInventory().add(new core.Item(stored.id, 1, stored.meta), true);
    player.setAttribute(AXE_ATTRIBUTE, null);
    speak(player, npc, "Here's your axe.");
    return;
  }
  const axe = axeFor(player);
  if (!axe) { speak(player, npc, "You do not have an axe which you have the Woodcutting level to use, so I can't hold onto it for you."); return; }
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex((item) => item?.getId() === axe.id);
  const item = slot >= 0 ? inventory.getItems()[slot] : player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  const saved = { id: item.getId(), meta: core.Item.cloneMeta(item.getMeta()) };
  if (slot >= 0) inventory.deleteAtSlot(slot);
  else {
    player.getEquipment().deleteAtSlot(core.Equipment.WEAPON_SLOT);
    player.getEquipment().refreshItems();
    core.WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    api.emitCustomEvent("equipment:changed", { player });
  }
  player.setAttribute(AXE_ATTRIBUTE, saved);
  speak(player, npc, "I'll hold onto that axe for you.");
}

function dialogueCondition(event) {
  if (!ASSISTANTS.includes(event.definition?.getName())) return;
  const match = event.text?.match(/(?:has |With )(\d+)-(\d+) Woodcutting:/i);
  if (match) return level(event.player) >= Number(match[1]) && level(event.player) <= Number(match[2]);
}

/** canoes:stored-axe { player, stored }: whether the player has an axe stored with a canoe station assistant. */
function answerStoredAxe(request) {
  if (request?.player) request.stored = !!request.player.getAttribute(AXE_ATTRIBUTE)?.id;
}

function attach(pluginApi) {
  core = pluginApi.core;
  api = pluginApi;
  scenes = createQuestScenes(api, { onEnd: sceneEnded });
  api.persistAttribute(AXE_ATTRIBUTE, null);
  api.persistAttribute(RETURN_ATTRIBUTE, null);
  api.onObjectInteraction("Canoe Station", { "Chop-down": chop, "Shape-Canoe": shape, "Float Log": float, "Float Canoe": float, "Paddle Log": paddle, "Paddle Canoe": paddle });
  api.onNpcsInteraction(ASSISTANTS, { "Store-axe": storeAxe });
  api.onNpcDialogueCondition(dialogueCondition);
  api.onInterfaceActionClick(select);
  api.onCustomEvent("interface:closed", menuClosed);
  api.onCustomEvent("canoes:stored-axe", answerStoredAxe);
  api.onPlayerLogin(restore);
  api.onPlayerLogout(logout);
}

module.exports = attach;
module.exports._test = { stations, TYPES, RIDE_SCENERY, RIDE_FACE, CHOP_DELAY_TICKS, chance, canTravel, chop, shape, carve, float, paddle, select, logout, restore, state, axeFor, storeAxe, answerStoredAxe };
