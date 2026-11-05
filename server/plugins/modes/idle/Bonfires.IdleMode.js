/**
 * Bonfires (plugins/modes/data/idle-mode.json "production" "bonfires"): fires that never go out,
 * where idle players burn logs by feeding them, as at a bonfire, instead of lighting fire after
 * fire. Each is an ordinary fire (`object`, a cache ObjectIdentifiers name) placed at its tile when
 * the server starts. Logs used on it tend it as Firemaking tends any fire: fed, it becomes a
 * Forester's Campfire, which several players can feed at once. When a bonfire's fire, or the
 * campfire it became, would burn out, it burns on (`firemaking:burns-out`). Idle production then
 * feeds it from the bank like any fire.
 */
const Common = require("./Common.IdleMode");

const FIRE_SHAPE = 10;

function config() {
  return Common.data.production.bonfires;
}

function tiles() {
  return (config()?.tiles ?? []).map(([x, y, z = 0]) => ({ x, y, z }));
}

/** Whether a location is a bonfire's tile. */
function isBonfire(location) {
  return tiles().some(({ x, y, z }) => location?.getX?.() === x && location.getY() === y && location.getZ() === z);
}

/** On startup: a fire at each bonfire's tile. */
function place() {
  const id = Common.core.ObjectIdentifiers?.[config()?.object];
  if (!Number.isInteger(id)) return;
  const { GameObject, Location, ObjectManager } = Common.core;
  for (const { x, y, z } of tiles()) ObjectManager.register(new GameObject(id, new Location(x, y, z), FIRE_SHAPE, 0, null), true);
}

/** `firemaking:burns-out`: a bonfire burns on. */
function burnsOut(event) {
  if (!event.keep && isBonfire(event.location)) event.keep = true;
}

module.exports = function attach(api) {
  api.onServerStartup(place);
  api.onCustomEvent("firemaking:burns-out", burnsOut);
};

module.exports.isBonfire = isBonfire;
module.exports.place = place;
module.exports.handlers = { burnsOut };
