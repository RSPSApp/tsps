/**
 * Dwarf multicannon: what the units share - the plugin api, the two cannon kinds, the placed
 * cannons, saving them on their owner, and the vars the client reads.
 */
const Data = require("./Data.DwarfCannon");

const STATE_ATTRIBUTE = "dwarf-cannon:state";
const LOST_ATTRIBUTE = "dwarf-cannon:lost";
const LOAD_X_ATTRIBUTE = "dwarf-cannon:load-x";

let api = null;
let core = null;
/** Each kind's parts (base, stand, barrels, furnace), its locs per stage, broken loc and animations. */
const KINDS = {};
/** Placed cannons by owner username. */
const cannons = new Map();

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  const Items = core.ItemIdentifiers;
  const Objects = core.ObjectIdentifiers;
  Object.assign(KINDS, {
    plain: {
      parts: [Items.CANNON_BASE, Items.CANNON_STAND, Items.CANNON_BARRELS, Items.CANNON_FURNACE],
      locs: [Objects.CANNON_BASE, Objects.CANNON_STAND, Objects.CANNON_BARRELS, Objects.DWARF_MULTICANNON],
      broken: Objects.BROKEN_MULTICANNON_2,
      // mcannon_<dir>_fire / mcannon_<dir>_turn, N first (captured).
      fire: 506,
      turn: 514,
    },
    ornament: {
      parts: [Items.CANNON_BASE_OR_, Items.CANNON_STAND_OR_, Items.CANNON_BARRELS_OR_, Items.CANNON_FURNACE_OR_],
      locs: [Objects.CANNON_BASE_2, Objects.CANNON_STAND_2, Objects.CANNON_BARRELS_2, Objects.DWARF_MULTICANNON_7],
      broken: Objects.BROKEN_MULTICANNON_3,
      // Not captured: the cache's matching runs of eight, N first as for the plain cannon.
      fire: 9230,
      turn: 9239,
    },
  });
}

/** Runs `action` `ticks` ticks from now. */
function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, null, false);
    }

    execute() {
      this.stop();
      action();
    }
  })());
}

/** The cannon kind whose parts include `itemId`, if any. */
function kindOfPart(itemId) {
  return Object.keys(KINDS).find((kind) => KINDS[kind].parts.includes(itemId)) ?? null;
}

const usernameOf = (player) => player.getUsername();
const cannonOf = (player) => cannons.get(usernameOf(player)) ?? null;

/** The cannon whose loc `object` is, if any. */
function cannonAt(object) {
  const at = object.getLocation?.() ?? object;
  for (const cannon of cannons.values()) {
    if (cannon.sw.getX() === at.getX() && cannon.sw.getY() === at.getY() && cannon.sw.getZ() === at.getZ()) return cannon;
  }
  return null;
}

/** `(z << 28) | (x << 14) | y`, as ownedmcannon holds it. */
function packCoord(location) {
  return (location.getZ() << 28) | (location.getX() << 14) | location.getY();
}

function balls(cannon) {
  return cannon.steel + cannon.granite;
}

/** Saves the cannon on its owner so a logout (or a lost cannon) keeps track of it. */
function save(cannon) {
  const player = cannon.player;
  if (!player) return;
  player.setAttribute(STATE_ATTRIBUTE, {
    kind: cannon.kind, x: cannon.sw.getX(), y: cannon.sw.getY(), z: cannon.sw.getZ(),
    stage: cannon.stage, steel: cannon.steel, granite: cannon.granite,
  });
}

/** The vars the client reads for the owner's cannon (captured). */
function sendVars(cannon) {
  const player = cannon.player;
  if (!player) return;
  const sender = player.getPacketSender();
  const at = packCoord(cannon.sw);
  const values = [
    ["varp", Data.VARP.OWNED, at],
    ["varp", Data.VARP.OWNED_TEMP, at],
    ["varbit", Data.VARBIT.WORLD, 1],
    ["varbit", Data.VARBIT.SETUP_TIME, cannon.setupTime],
    ["varp", Data.VARP.STAGE, cannon.stage],
    ["varp", Data.VARP.BALLS, balls(cannon)],
  ];
  // Only what changed, as the capture shows them (a login re-sends them all).
  const sent = cannon.sent ?? (cannon.sent = new Map());
  for (const [type, id, value] of values) {
    if (sent.get(`${type}${id}`) === value) continue;
    sent.set(`${type}${id}`, value);
    if (type === "varp") sender.sendConfig(id, value);
    else sender.sendVarbit(id, value);
  }
}

/** Every var again, for a player logging back in to their cannon. */
function resendVars(cannon) {
  cannon.sent = null;
  sendVars(cannon);
  if (cannon.firing) cannon.player?.getPacketSender().sendConfig(Data.VARP.FIRING, Data.FIRING_FLAG);
}

/** Picked up or gone: the vars as the capture leaves them (ownedmcannon keeps the player's tile). */
function clearVars(player) {
  const sender = player.getPacketSender();
  sender.sendConfig(Data.VARP.OWNED, packCoord(player.getLocation())).sendConfig(Data.VARP.OWNED_TEMP, -1);
  sender.sendVarbit(Data.VARBIT.WORLD, 0).sendVarbit(Data.VARBIT.SETUP_TIME, 0);
  sender.sendConfig(Data.VARP.BALLS, 0).sendConfig(Data.VARP.STAGE, 0).sendConfig(Data.VARP.FIRING, 0);
}

/** Players near the cannon, who see its animations. */
function viewers(cannon) {
  return [...core.World.getPlayers()].filter((p) => p && p.getLocation().getZ() === cannon.sw.getZ()
    && p.getLocation().isWithinDistance(cannon.centre, 15));
}

function areaSound(at, soundId) {
  core.Sounds.playAreaSound({ soundId, x: at.getX(), y: at.getY(), level: at.getZ(), radius: 10 });
}

function animate(cannon, animationId) {
  const animation = new core.Animation(animationId);
  for (const viewer of viewers(cannon)) viewer.getPacketSender().sendObjectAnimation(cannon.object, animation);
}

/** Replaces the cannon's loc (a part added, broken, repaired). */
function setLoc(cannon, id) {
  if (cannon.object) core.ObjectManager.deregister(cannon.object, true);
  cannon.object = new core.GameObject(id, cannon.sw.clone(), 10, 0, null);
  core.ObjectManager.register(cannon.object, true);
}

function removeLoc(cannon) {
  if (cannon.object) core.ObjectManager.deregister(cannon.object, true);
  cannon.object = null;
}

/** Takes the cannon out of the world (picked up or lost); its task stops on its next tick. */
function forget(cannon) {
  removeLoc(cannon);
  cannon.gone = true;
  cannons.delete(cannon.owner);
}

module.exports = {
  init, later, kindOfPart, cannonOf, cannonAt, packCoord, balls, save, sendVars, resendVars, clearVars, viewers,
  areaSound, animate, setLoc, removeLoc, forget, KINDS, cannons, STATE_ATTRIBUTE, LOST_ATTRIBUTE, LOAD_X_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
};
