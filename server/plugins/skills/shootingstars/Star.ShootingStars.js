"use strict";

/**
 * The crashed star itself: landing, its layers and its end.
 *
 * Captures: the star is one loc per size (star_size_<n>_star) with an invisible star_headbar_npc
 * on its south-west tile whose headbar 1 (50 wide) shows the layer left. While anyone mines it a
 * layer drops 1% every 7 ticks (the headbar loses one pixel per 14 ticks; a layer lasts ~702
 * ticks); at 100% the loc becomes the next size down with area sound 4925, and after size 1
 * "The star disintegrates into dust." with the loc animation game_star_meteor_despawn and area
 * sound 4923, the loc going two ticks later. The landing itself is not captured: the cache's
 * star_landing_star loc carries the impact animation (game_star_meteor_impact) and stands for
 * DATA.landingTicks before the star appears.
 */

const Common = require("./Common.ShootingStars");

const { DATA, world } = Common;
const DESPAWN_DELAY_TICKS = 2;

/** Hooks the Mining unit fills in: who is mining, and stopping them. */
const miners = {
  isMined: () => false,
  playersOf: () => [],
  stopAll: () => {},
};

function core() {
  return Common.core;
}

function placeLoc(star, locId) {
  const { GameObject, ObjectManager, Location } = core();
  if (star.object) ObjectManager.deregister(star.object, true);
  star.object = new GameObject(locId, new Location(star.x, star.y, star.z), 10, 0, null);
  ObjectManager.register(star.object, true);
}

function removeLoc(star) {
  if (star.object) core().ObjectManager.deregister(star.object, true);
  star.object = null;
}

function headbarFill(percent) {
  const { width } = DATA.headbar;
  return Math.max(0, width - Math.ceil((percent * width) / 100));
}

function showHeadbar(star) {
  const fill = headbarFill(star.percent);
  if (!star.headbarNpc || fill === star.headbarFill) return;
  star.headbarFill = fill;
  star.headbarNpc.showHeadbar(DATA.headbar.id, { fill });
}

function spawnHeadbarNpc(star) {
  star.headbarNpc = Common.api.spawnNpc({ id: DATA.npcs.headbar, x: star.x, y: star.y, z: star.z, wanderRadius: 0 });
  star.headbarFill = null;
  showHeadbar(star);
}

function removeHeadbarNpc(star) {
  if (star.headbarNpc) Common.api.removeNpc(star.headbarNpc);
  star.headbarNpc = null;
}

/**
 * Starts a star landing at `site` (one of DATA.sites, at `siteIndex`, or any tile for ::star): the
 * landing loc first, the crashed star of `size` once it has stood for DATA.landingTicks. A star
 * still standing is replaced.
 */
function land(site, size, siteIndex = -1, now = Date.now()) {
  if (!site || !Common.sizeEntry(size)) return null;
  if (world.star) remove(world.star);
  const star = {
    siteIndex,
    site,
    x: site.x,
    y: site.y,
    z: site.z ?? 0,
    size,
    percent: 0,
    percentTicks: 0,
    landingTicks: DATA.landingTicks,
    landedAt: now,
    discoveredBy: null,
    object: null,
    headbarNpc: null,
    headbarFill: null,
    pokedTick: -1,
    gone: false,
  };
  world.star = star;
  if (siteIndex >= 0) world.lastSiteIndex = siteIndex;
  placeLoc(star, DATA.locs.landing);
  Common.api.emitCustomEvent("shooting-stars:landed", { star });
  return star;
}

/** The landing loc has stood long enough: the crashed star appears. */
function crash(star) {
  placeLoc(star, Common.sizeEntry(star.size).loc);
  spawnHeadbarNpc(star);
}

function isLanded(star) {
  return star != null && !star.gone && star.landingTicks <= 0;
}

function nextLayer(star) {
  const mining = miners.playersOf(star);
  miners.stopAll(star, false);
  if (star.size <= 1) {
    disintegrate(star, mining);
    return;
  }
  star.size -= 1;
  star.percent = 0;
  star.percentTicks = 0;
  placeLoc(star, Common.sizeEntry(star.size).loc);
  Common.areaSound(star, DATA.sounds.layer, 10);
  if (star.headbarNpc) {
    star.headbarNpc.removeHeadbar(DATA.headbar.id);
    star.headbarFill = null;
  }
}

function disintegrate(star, mining) {
  for (const player of new Set([...mining, ...Common.playersNear(star, 15)])) player.sendMessage("The star disintegrates into dust.");
  const animation = new (core().Animation)(DATA.anims.despawn);
  if (star.object) {
    for (const player of Common.playersNear(star, 15)) player.getPacketSender().sendObjectAnimation(star.object, animation);
  }
  Common.areaSound(star, DATA.sounds.despawn, 15);
  removeHeadbarNpc(star);
  star.gone = true;
  star.despawnTicks = DESPAWN_DELAY_TICKS;
}

/** Takes the star out of the world at once (a new star landing, or a command). */
function remove(star) {
  miners.stopAll(star, true);
  removeHeadbarNpc(star);
  removeLoc(star);
  star.gone = true;
  if (world.star === star) world.star = null;
}

/**
 * One tick of the star: the landing countdown, then the layer timer. The timer only runs while
 * someone mines (or tried to this tick: the Wiki notes it is checked before the level check).
 */
function tick(star) {
  if (star.gone) {
    if (--star.despawnTicks <= 0) {
      removeLoc(star);
      if (world.star === star) world.star = null;
    }
    return;
  }
  if (star.landingTicks > 0) {
    if (--star.landingTicks === 0) crash(star);
    return;
  }
  // A new layer's bar goes up the tick after the old one came down.
  if (star.headbarFill === null) showHeadbar(star);
  if (!miners.isMined(star) && star.pokedTick !== world.tick) return;
  if (++star.percentTicks < DATA.layerPercentTicks) return;
  star.percentTicks = 0;
  star.percent += 1;
  if (star.percent >= 100) {
    nextLayer(star);
    return;
  }
  showHeadbar(star);
}

module.exports = {
  miners,
  land,
  remove,
  tick,
  isLanded,
  nextLayer,
  headbarFill,
  showHeadbar,
};
