"use strict";

/**
 * The Wintertodt's snow, bolts and impacts: short-lived locs, projectiles and graphics shown to
 * everyone in the prison. Values are the captures' (projectile heights there are already x4).
 */

const Shared = require("./WintertodtShared");

/** Who sees the effects: every player in the prison. Set by the round. */
let viewers = () => [];

function setViewers(provider) {
  viewers = provider;
}

/** A loc for `ticks` ticks; one already on its tile (same layer) is replaced and comes back. */
function tempLoc(id, tile, rotation, ticks) {
  const { GameObject, ObjectManager, World } = Shared.core();
  const object = new GameObject(id, Shared.loc(tile), 10, rotation, null);
  ObjectManager.register(object, true);
  Shared.later(object, ticks, () => {
    ObjectManager.deregister(object, true);
    // A runtime loc has no base-map counterpart to keep hidden on region reloads.
    const removed = World.getRemovedObjects();
    const index = removed.indexOf(object);
    if (index !== -1) removed.splice(index, 1);
  });
  return object;
}

/** Snowfall over a tile, at a random turn as in the captures. */
function snowfall(tile, ticks) {
  return tempLoc(Shared.OBJECT.SNOWFALL, tile, Math.floor(Math.random() * 4), ticks);
}

function projectile(from, to, id, { delay = 0, end = 90, startHeight = 0, endHeight = 50, slope = 64 } = {}) {
  const start = Shared.loc(from);
  const target = Shared.loc(to);
  for (const player of viewers()) {
    player.getPacketSender().sendProjectile(start, target, 0, end, id, startHeight / 4, endHeight / 4, null, delay, slope, 0);
  }
}

function graphic(id, tile, { delay = 0, height = 0 } = {}) {
  const location = Shared.loc(tile);
  for (const player of viewers()) {
    player.getPacketSender().sendGraphic({ id, delay, height }, location);
  }
}

/** The bolt the storm throws at whatever it attacks, landing in `end` client cycles. */
function stormBolt(to, end) {
  projectile(Shared.STORM_SOURCE, to, Shared.PROJECTILE.STORM_BOLT, { end });
}

module.exports = { setViewers, tempLoc, snowfall, projectile, graphic, stormBolt };
