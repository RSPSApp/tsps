/**
 * Desert heat (docs/desert-heat.md): https://oldschool.runescape.wiki/w/Desert_heat
 *
 * In the Kharidian Desert, outside its towns, a timer runs from the tick a player steps into the
 * heat. When it runs out the heat strikes and the timer starts again: a Desert amulet 4 shrugs it
 * off, a charged circlet of water spends a charge, a waterskin gives a drink, a choc-ice is eaten,
 * and otherwise the player takes 1-10 damage. Leaving the heat (or logging out) drops the timer.
 *
 * Captures (rsprox): the timer is 150 ticks less the armour worn, plus heat-resistant clothing,
 * and is sent as varbit buff_bar_desert_heat_timer_iteration when it starts. A strike that falls
 * while a dialogue or interface is open waits for it to close, then lands on that tick.
 *
 * The desert is too big and overlaps too many other areas (quest zones, the Agility Pyramid) to
 * be an Area of its own: players are followed per map square, and one task visits only them.
 */
const DATA = require("./data/desert-heat.json");

/** buff_bar_desert_heat_timer_iteration: the timer's length in ticks, sent when it starts. */
const HEAT_INTERVAL_VARBIT = 13137;
const DRINK_ANIMATION = 829; // human_eat
const DRINK_SOUND = 2401;
const CHOC_ICE_HEAL = 7;
const MIN_DAMAGE = 1;
const MAX_DAMAGE = 10;
const TICK_MS = 600;
const PROTECT_EVENT = "desert-heat:protect";

const NO_WATERSKIN_MESSAGE = "You should get a waterskin for any travelling in the desert.";
const THIRST_MESSAGE = "You start dying of thirst while you're in the desert.";
const DRINK_MESSAGE = "You take a drink of water.";
const CHOC_ICE_MESSAGE = "You eat a choc ice.";

let core;
let pluginApi;
/** Waterskin ids by doses left, 0 to 4. */
let WATERSKINS = [];
let ARMOUR = [];
let RESISTANT = new Map();
let HEAT_SQUARES = new Set();

/** Players standing in a map square that holds some heat. */
const nearHeat = new Set();
/** Each heated player's ticks left until the heat strikes; 0 means it is waiting to land. */
const timers = new Map();
/** The interval last sent in the varbit, so an unchanged one isn't sent again. */
const sentInterval = new Map();

function squareKey(x, y) {
  return `${x >> 6},${y >> 6}`;
}

function defineData() {
  const { Equipment, ItemIdentifiers: Items } = core;
  WATERSKINS = [Items.WATERSKIN_0_, Items.WATERSKIN_1_, Items.WATERSKIN_2_, Items.WATERSKIN_3_, Items.WATERSKIN_4_];
  ARMOUR = DATA.armour.slots.map((entry) => ({ ...entry, index: Equipment[entry.slot] }));
  RESISTANT = new Map(Object.entries(DATA.resistant.items));
  HEAT_SQUARES = new Set();
  for (const [minX, maxX, minY, maxY] of DATA.heat.boxes) {
    for (let x = minX >> 6; x <= maxX >> 6; x++) {
      for (let y = minY >> 6; y <= maxY >> 6; y++) HEAT_SQUARES.add(`${x},${y}`);
    }
  }
}

function inBox(box, x, y) {
  return x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3];
}

/** Whether the heat reaches this tile: inside the desert's boxes, outside its towns. */
function inHeat(location) {
  const x = location.getX();
  const y = location.getY();
  const plane = location.getZ();
  if (!DATA.heat.boxes.some((box) => inBox(box, x, y) && plane >= box[4] && plane <= box[5])) return false;
  return plane !== 0 || !Object.values(DATA.towns.boxes).some((box) => inBox(box, x, y));
}

/**
 * Captures (rsprox): every worn item of an armour category takes its slot's ticks off the base
 * 150; heat-resistant clothing adds its own instead.
 */
function heatInterval(player) {
  const worn = player.getEquipment().getItems();
  let ticks = DATA.baseTicks;
  for (const { index, category, ticks: penalty } of ARMOUR) {
    const id = worn[index]?.getId?.() ?? -1;
    if (id <= 0) continue;
    const bonus = RESISTANT.get(core.ItemDefinition.forId(id).getName());
    if (bonus !== undefined) ticks += bonus;
    else if (core.CacheDefinitions.getItem(id)?.category === category) ticks -= penalty;
  }
  return ticks;
}

function startTimer(player) {
  const interval = heatInterval(player);
  timers.set(player, interval);
  if (sentInterval.get(player) !== interval) {
    sentInterval.set(player, interval);
    player.getPacketSender().sendVarbit(HEAT_INTERVAL_VARBIT, interval);
  }
}

/** Wiki: the heat holds off while a dialogue box is open; captures show interfaces do too. */
function busy(player) {
  return player.busy() || player.getDialogueManager().isActive() || player.getPacketSender().hasInterruptibleInterface();
}

function spam(player, message) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, message);
}

function drinkAnimation(player) {
  player.performAnimation(new core.Animation(DRINK_ANIMATION));
}

/** Captures (rsprox): the emptiest waterskin that still holds water is drunk from first. */
function drinkWaterskin(player) {
  const inventory = player.getInventory();
  for (let doses = 1; doses < WATERSKINS.length; doses++) {
    const slot = inventory.getSlotForItemId(WATERSKINS[doses]);
    if (slot < 0) continue;
    inventory.setItem(slot, new core.Item(WATERSKINS[doses - 1], 1)).refreshItems();
    spam(player, DRINK_MESSAGE);
    drinkAnimation(player);
    player.getPacketSender().sendSoundEffect(DRINK_SOUND, 1, 0);
    return true;
  }
  return false;
}

/** Wiki: waterskins come first; a choc-ice is eaten, healing 7, when there are none. */
function eatChocIce(player) {
  const inventory = player.getInventory();
  const chocIce = core.ItemIdentifiers.CHOC_ICE;
  if (!inventory.contains(chocIce)) return false;
  inventory.deleteNumber(chocIce, 1);
  const skills = player.getSkillManager();
  const current = skills.getCurrentLevel(core.Skill.HITPOINTS);
  player.setHitpoints(Math.max(current, Math.min(current + CHOC_ICE_HEAL, skills.getMaxLevel(core.Skill.HITPOINTS))));
  spam(player, CHOC_ICE_MESSAGE);
  drinkAnimation(player);
  return true;
}

function thirst(player) {
  player.sendMessage(NO_WATERSKIN_MESSAGE);
  spam(player, THIRST_MESSAGE);
  const damage = MIN_DAMAGE + Math.floor(Math.random() * (MAX_DAMAGE - MIN_DAMAGE + 1));
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
}

function strike(player) {
  if (player.getEquipment().contains(core.ItemIdentifiers.DESERT_AMULET_4)) return;
  const request = { player, protected: false };
  pluginApi.emitCustomEvent(PROTECT_EVENT, request);
  if (request.protected || drinkWaterskin(player) || eatChocIce(player)) return;
  thirst(player);
}

function heatTick() {
  for (const player of nearHeat) {
    if (!player.isRegistered() || !inHeat(player.getLocation())) {
      timers.delete(player);
      continue;
    }
    const left = timers.get(player);
    if (left === undefined) {
      startTimer(player);
      continue;
    }
    if (left > 1) {
      timers.set(player, left - 1);
      continue;
    }
    timers.set(player, 0);
    if (busy(player) || player.getHitpoints() <= 0) continue;
    strike(player);
    startTimer(player);
  }
}

function startTicking() {
  class DesertHeatTask extends core.Task { execute() { heatTick(); } }
  core.TaskManager.submit(new DesertHeatTask(1));
}

function followHeat(player) {
  const location = player.getLocation();
  if (HEAT_SQUARES.has(squareKey(location.getX(), location.getY()))) {
    nearHeat.add(player);
  } else {
    nearHeat.delete(player);
    timers.delete(player);
  }
}

function mapSquareChanged({ player }) {
  followHeat(player);
}

function login({ player }) {
  followHeat(player);
}

function logout({ player }) {
  nearHeat.delete(player);
  timers.delete(player);
  sentInterval.delete(player);
}

/** Test hook (agent MCP advance_time): brings the next strike `ms` closer. */
function advanceTime(event) {
  const left = timers.get(event.player);
  if (left === undefined) return;
  timers.set(event.player, Math.max(1, left - Math.floor(event.ms / TICK_MS)));
  event.handledBy.push("DesertHeat");
}

module.exports = {
  name: "DesertHeat",
  description: "Kharidian Desert heat: a timer that hurts players outside the towns unless a waterskin, Desert amulet 4, circlet of water or choc-ice helps.",
  members: true,
  PROTECT_EVENT,
  _test: { inHeat, heatInterval, drinkWaterskin, heatTick, timers, nearHeat },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onServerStartup(defineData);
    api.onServerStartup(startTicking);
    api.onPlayerLogin(login);
    api.onPlayerMapSquareChange(mapSquareChanged);
    api.onPlayerLogout(logout);
    api.onCustomEvent("agent:advance-time", advanceTime);
  },
};
