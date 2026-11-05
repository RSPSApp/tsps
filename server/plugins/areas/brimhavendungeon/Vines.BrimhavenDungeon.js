/**
 * The Brimhaven Dungeon's five vines (karam_dungeon_vineblocking1-5), Chop-down, as rsprox
 * recordings (227/90, 91, 552; 234/3275) and the OSRS Wiki (Vines (Brimhaven Dungeon)) have them:
 *
 * - Going deeper (from the vine's outer side) needs an axe and the vine's Woodcutting level
 *   (10, 27, 22, 34, 34). On the tick after arriving: "You try to chop through the vines." and
 *   the axe's swing; a roll every 2 ticks after that, at the Wiki's cut chance for the axe; the
 *   swing again 2 ticks after the first and every 4 after that.
 * - Success: "You hack your way through the vines.", the vine goes for everyone, the player
 *   walks through to the far side, and the vine is back a tick later. No XP.
 * - Going back towards the entrance needs no axe or level (Wiki): it is cut by hand at the
 *   first roll.
 * - Data (tiles, levels, cut chances): plugins/areas/data/brimhaven-dungeon.json.
 */
const data = require("../data/brimhaven-dungeon.json");

const VINES = "Vines";
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const TRY_MESSAGE = "You try to chop through the vines.";
const SUCCESS_MESSAGE = "You hack your way through the vines.";
const NO_AXE_MESSAGE = "You don't have an axe which you can use.";
/** A roll every 2 ticks; the swing repeats every 4, from 2 ticks after the first. */
const ROLL_TICKS = 2;
const SWING_TICKS = 4;
/** The vine is back the tick after it was cut. */
const REGROW_TICKS = 1;
/** Long enough to walk the two steps through at walking pace. */
const PASS_TICKS = 2;

let core = null;
let pluginApi = null;
const tileKey = (x, y, z) => `${x},${y},${z}`;
/** "x,y,z" -> vine entry. */
const vinesByTile = new Map(data.vines.map((vine) => [tileKey(...vine.at), vine]));
/** Each player's latest pass through a vine, which alone may end their clipping exemption. */
const passes = new WeakMap();

const sameTile = (location, [x, y, z]) => location.getX() === x && location.getY() === y && location.getZ() === z;

/** The data entry for a clicked vine: its own loc at its own tile. */
function vineFor(event) {
  const location = event.object?.getLocation?.();
  if (!location) return null;
  const vine = vinesByTile.get(tileKey(location.getX(), location.getY(), location.getZ()));
  return vine && core.CacheDefinitions.getLocNames().get(event.objectId) === vine.loc ? vine : null;
}

/** Every axe id the player holds or wields, best usable first, as Woodcutting judges them. */
function bestAxe(player) {
  const excluded = new Set(data.excludedAxes.map((name) => core.CacheDefinitions.getObjId(name)));
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  const held = [weapon, ...player.getInventory().getItems()]
    .map((item) => item?.getId?.() ?? -1)
    .filter((id) => id > 0 && !excluded.has(id));
  let best = null;
  for (const itemId of new Set(held)) {
    const request = { player, itemId, axe: null };
    pluginApi.emitCustomEvent("woodcutting:axe", request);
    if (request.axe && (!best || request.axe.tier > best.tier)) best = request.axe;
  }
  return best;
}

function woodcuttingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
}

/** The Wiki's vine cut chance: (1 + floor(low * (99 - L) / 98) + floor(high * (L - 1) / 98)) / 256. */
function cutChance(level, axe) {
  const [low, high] = data.cutChance[Math.min(axe.tier, data.cutChance.length - 1)];
  const successes = 1 + Math.floor((low * (99 - level)) / 98) + Math.floor((high * (level - 1)) / 98);
  return Math.min(1, successes / 256);
}

/** The live vine at its tile, or null while it is cut. */
function liveVine(vine) {
  return core.MapObjects.get(core.CacheDefinitions.getLocId(vine.loc), new core.Location(...vine.at), null) ?? null;
}

function regrow(vine, snapshot) {
  if (liveVine(vine)) return;
  core.ObjectManager.register(new core.GameObject(snapshot.id, new core.Location(...vine.at), snapshot.type, snapshot.face, null), true);
}

/** Walks the player through the vine's tile to the far side; only the latest pass clears the flag. */
function walkThrough(player, vine, to) {
  const pass = {};
  passes.set(player, pass);
  player.setFlag(IGNORE_CLIPPING_FLAG, true);
  const movement = player.getMovementQueue();
  movement.addSteps(new core.Location(...vine.at));
  movement.addSteps(new core.Location(...to));
  core.TaskManager.submit(new core.CountdownTask(pass, PASS_TICKS, () => {
    if (passes.get(player) !== pass) return;
    passes.delete(player);
    player.removeFlag(IGNORE_CLIPPING_FLAG);
  }));
}

/** The vine falls: gone for everyone for a tick, the player through it. */
function hackThrough(player, vine, object, to, inward) {
  player.sendMessage(SUCCESS_MESSAGE);
  player.performAnimation(new core.Animation(-1));
  const snapshot = { id: object.getId(), type: object.getType(), face: object.getFace() };
  core.ObjectManager.deregister(object, true);
  core.TaskManager.submit(new core.CountdownTask(vine, REGROW_TICKS, () => regrow(vine, snapshot)));
  walkThrough(player, vine, to);
  pluginApi.emitCustomEvent("brimhaven-dungeon:vines-cut", { player, vine: vine.loc, inward });
}

/**
 * The rolls, keyed to the player's index so walking off, combat or a new action stops them.
 * `axe` is null when cutting by hand on the way out, which never fails.
 */
function chopping(player, vine, object, axe, to, inward) {
  const start = player.getLocation().clone();
  let ticks = 0;
  return new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      ticks++;
      const live = liveVine(vine);
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(start) || live !== object) {
        this.stop();
        return;
      }
      if (axe && ticks % SWING_TICKS === ROLL_TICKS) player.performAnimation(new core.Animation(axe.animationId));
      if (ticks % ROLL_TICKS !== 0) return;
      if (axe && Math.random() >= cutChance(woodcuttingLevel(player), axe)) return;
      this.stop();
      hackThrough(player, vine, object, to, inward);
    }
  })();
}

function chopDown(event) {
  const vine = vineFor(event);
  if (!vine) return false;
  const { player } = event;
  // The vine standing now: the clicked one may have been cut and regrown since the click.
  const object = liveVine(vine);
  if (!object) return true;
  const at = player.getLocation();
  const inward = sameTile(at, vine.outer);
  if (!inward && !sameTile(at, vine.inner)) return true;
  let axe = null;
  if (inward) {
    axe = bestAxe(player);
    if (!axe) {
      player.sendMessage(NO_AXE_MESSAGE);
      return true;
    }
    if (woodcuttingLevel(player) < vine.level) {
      player.sendMessage(`You need a Woodcutting level of ${vine.level} to chop through these vines.`);
      return true;
    }
  }
  core.TaskManager.cancelTasks(player.getIndex());
  player.setPositionToFace(object.getLocation());
  player.sendMessage(TRY_MESSAGE);
  if (axe) player.performAnimation(new core.Animation(axe.animationId));
  core.TaskManager.submit(chopping(player, vine, object, axe, inward ? vine.inner : vine.outer, inward));
  return true;
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.onObjectInteraction(VINES, { "Chop-down": chopDown });
}

module.exports = { attach, chopDown, cutChance, bestAxe, IGNORE_CLIPPING_FLAG };
