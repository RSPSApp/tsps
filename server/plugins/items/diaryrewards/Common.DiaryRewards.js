/**
 * Diary reward items: what the units share - data/diary-rewards.json resolved to ids once, the
 * daily allowances (with the cache varbit each one counts in), and the teleport casts.
 */
const DATA = require("../data/diary-rewards.json");

let api;
let core;

/** OSRS resets daily limits at 00:00 UTC. */
const DAILY_ATTRIBUTE = "diary-rewards:daily";
/** Clap, then the cast two ticks later (rsprox captures: Karamja gloves 4). */
const CLAP_SEQ = "emote_clap";
const CLAP_MESSAGE = "You clap your hands and the world changes...";
const CLAP_CAST_DELAY_TICKS = 2;
/** The cast's animation and graphic start 30 client cycles late after a clap. */
const CLAP_CAST_CLIENT_DELAY = 30;
/** Cast to arrival, in ticks; the reset is sent again the tick after landing (captures). */
const CAST_TICKS = 3;

/** obj id -> { family, tier } (tier 0-3, easy to elite). */
const TIER_BY_ITEM = new Map();
const CASTS = new Map();
/** limit key -> varbit id or null. */
const LIMIT_VARBITS = new Map();

function objId(name) {
  const id = core.CacheDefinitions.getObjId(name);
  if (!Number.isInteger(id)) throw new Error(`[diary-rewards] unknown obj gameval ${name}`);
  return id;
}

function gamevalId(kind, name) {
  const id = kind === "seq" ? core.CacheDefinitions.getSeqId(name)
    : kind === "spotanim" ? core.CacheDefinitions.getSpotanimId(name)
      : core.CacheDefinitions.getVarbitId(name);
  if (!Number.isInteger(id)) throw new Error(`[diary-rewards] unknown ${kind} gameval ${name}`);
  return id;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  TIER_BY_ITEM.clear();
  for (const family of DATA.families) {
    family.objs.forEach((name, tier) => TIER_BY_ITEM.set(objId(name), { family, tier }));
  }
  CASTS.clear();
  for (const [key, cast] of Object.entries(DATA.casts)) CASTS.set(key, teleportType(cast));
  LIMIT_VARBITS.clear();
  for (const [key, limit] of Object.entries(DATA.limits)) {
    LIMIT_VARBITS.set(key, limit.varbit ? gamevalId("varbit", limit.varbit) : null);
  }
}

function teleportType(cast) {
  const { TeleportType, Animation, Graphic, GraphicHeight, Priority } = core;
  const delay = cast.clap ? CLAP_CAST_CLIENT_DELAY : 0;
  const animation = new Animation(gamevalId("seq", cast.seq), delay);
  animation.priority = Priority.HIGH;
  const graphic = new Graphic(gamevalId("spotanim", cast.spotanim), delay, GraphicHeight.HIGH);
  return new TeleportType(CAST_TICKS, animation, null, Animation.DEFAULT_RESET_ANIMATION, graphic, null, null,
    { busy: true, repeatEndAnimation: true });
}

/** Every tier's item name, for name-based hooks: `[{ name, tier }]`. */
function tierNames(objs) {
  return objs.map((obj, tier) => ({ name: core.CacheDefinitions.getItem(objId(obj))?.name, tier }))
    .filter(({ name }) => typeof name === "string");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Today's uses of a daily allowance. */
function dailyUses(player, key) {
  const state = player.getAttribute(DAILY_ATTRIBUTE);
  if (!state || state.day !== today()) return 0;
  return Number(state.counts?.[key]) || 0;
}

function useDaily(player, key) {
  const state = player.getAttribute(DAILY_ATTRIBUTE);
  const fresh = !state || state.day !== today();
  const counts = fresh ? {} : { ...state.counts };
  counts[key] = (Number(counts[key]) || 0) + 1;
  player.setAttribute(DAILY_ATTRIBUTE, { day: today(), counts });
  return counts[key];
}

/** Sends a counter varbit, capped at what its bits hold (the elite tiers keep counting). */
function sendCount(player, varbitId, count) {
  if (!Number.isInteger(varbitId)) return;
  const bit = core.CacheDefinitions.getVarbit(varbitId);
  const max = bit ? (2 ** (bit.endBit - bit.startBit + 1)) - 1 : count;
  player.getPacketSender().sendVarbit(varbitId, Math.min(count, max));
}

/** A free tile within `radius` of the destination, as OSRS scatters these teleports. */
function landingTile(destination) {
  const [x, y, z] = destination.tile;
  const radius = destination.radius ?? 0;
  const centre = new core.Location(x, y, z);
  for (let attempt = 0; attempt < 16 && radius > 0; attempt++) {
    const dx = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const dy = Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const tile = new core.Location(x + dx, y + dy, z);
    if (!core.RegionManager.blocked(tile, null)) return tile;
  }
  return centre;
}

/** The cast to a destination key; false when the usual teleport checks refuse it. */
function teleport(player, destinationKey, onArrival) {
  const destination = DATA.destinations[destinationKey];
  if (!destination) return false;
  const tile = landingTile(destination);
  if (!core.TeleportHandler.checkReqs(player, tile)) return false;
  core.TeleportHandler.confirm(player, tile, () => cast(player, destination, tile, onArrival));
  return true;
}

function cast(player, destination, tile, onArrival) {
  const type = CASTS.get(destination.cast);
  if (!DATA.casts[destination.cast]?.clap) {
    core.TeleportHandler.teleport(player, tile, type, false, onArrival);
    return;
  }
  player.getMovementQueue().setBlockMovement(true).reset();
  player.performAnimation(new core.Animation(gamevalId("seq", CLAP_SEQ), core.Priority.HIGH));
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, CLAP_MESSAGE);
  later(player, CLAP_CAST_DELAY_TICKS, () => core.TeleportHandler.teleport(player, tile, type, false, onArrival));
}

function later(owner, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, owner ?? undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

/** Sends every allowance's counter varbit that has a use today. */
function syncCounters(player) {
  for (const [key, varbitId] of LIMIT_VARBITS) {
    const used = dailyUses(player, key);
    if (used > 0) sendCount(player, varbitId, used);
  }
}

module.exports = {
  init, DATA, DAILY_ATTRIBUTE, TIER_BY_ITEM, LIMIT_VARBITS, objId, gamevalId, tierNames, today, dailyUses,
  useDaily, sendCount, landingTile, teleport, syncCounters,
  get api() { return api; },
  get core() { return core; },
};
