"use strict";

/**
 * When and where stars land (Wiki, Shooting Stars): one star per world, a new one every
 * 90 +/- 15 minutes (world.json pluginConfig "ShootingStars:intervalMinutes" changes the 90), the
 * first 20-50 minutes after the server starts. A new star replaces one still standing. Its size
 * is 6-9 by the Wiki's crash chances, and its site one of the Wiki's landing sites, never the
 * last one twice in a row (stars land in members areas on free-to-play worlds too).
 *
 * Players find stars by scouting, as in OSRS. "ShootingStars:announce" (off by default) adds a
 * game message to everyone when one lands, for small worlds. ::star (owner) shows the current
 * star, or forces one down: ::star spawn [size] [here | site number].
 *
 * One task runs the whole activity: the landing countdown, the star's tick and its miners.
 */

const Common = require("./Common.ShootingStars");
const Star = require("./Star.ShootingStars");
const Mining = require("./Mining.ShootingStars");

const { DATA, world } = Common;

function randomBetween(min, max, random = Math.random) {
  return min + random() * (max - min);
}

function nextInterval(random = Math.random) {
  const jitter = DATA.intervalJitterMinutes;
  return Common.minutesToTicks(Common.intervalMinutes() + randomBetween(-jitter, jitter, random));
}

function rollSize(random = Math.random) {
  const sizes = DATA.sizes.filter((entry) => entry.crashChance > 0);
  const total = sizes.reduce((sum, entry) => sum + entry.crashChance, 0);
  let pick = random() * total;
  for (const entry of sizes) {
    pick -= entry.crashChance;
    if (pick < 0) return entry.size;
  }
  return sizes[sizes.length - 1].size;
}

/** Any site but the last one used. */
function rollSite(random = Math.random) {
  const count = DATA.sites.length;
  if (count <= 1) return 0;
  let index = Math.floor(random() * (count - 1));
  if (index >= world.lastSiteIndex && world.lastSiteIndex >= 0) index += 1;
  return index;
}

function announce(star) {
  if (Common.api.getPluginConfig(Common.ANNOUNCE_CONFIG, false) !== true) return;
  const message = `A shooting star has landed in ${star.site.region}.`;
  for (const player of Common.core.World.getPlayers()) {
    if (player && !player.isPlayerBot?.()) player.sendMessage(message);
  }
}

function landNow(siteIndex = rollSite(), size = rollSize(), site = DATA.sites[siteIndex]) {
  const star = Star.land(site, size, siteIndex);
  if (star) announce(star);
  world.ticksToLanding = nextInterval();
  return star;
}

function tick() {
  world.tick += 1;
  if (--world.ticksToLanding <= 0) landNow();
  if (world.star) Star.tick(world.star);
  Mining.tick();
}

function describe(star) {
  if (!star) return `No star has landed. The next lands in ${Math.ceil(world.ticksToLanding / Common.TICKS_PER_MINUTE)} minutes.`;
  const state = star.landingTicks > 0 ? "landing" : `size ${star.size}, ${star.percent}% mined`;
  return `Star at ${star.site.name}, ${star.site.region} (${star.x}, ${star.y}, ${star.z}): ${state}, `
    + `found by ${star.discoveredBy ?? "nobody yet"}.`;
}

/** ::star | ::star spawn [size] [here | site number] */
function starCommand({ player, parts }) {
  const args = (parts ?? []).slice(1);
  if (args[0] !== "spawn") {
    player.sendMessage(describe(world.star));
    return;
  }
  const size = Number.parseInt(args[1], 10);
  const sized = Common.sizeEntry(size) ? size : rollSize();
  const siteNumber = Number.parseInt(args[2], 10);
  let star;
  if (args[2] === "here") {
    const at = player.getLocation();
    const site = { region: "the owner's tile", name: "::star spawn here", x: at.getX() + 1, y: at.getY(), z: at.getZ() };
    star = landNow(-1, sized, site);
  } else {
    star = landNow(DATA.sites[siteNumber] ? siteNumber : rollSite(), sized);
  }
  player.sendMessage(describe(star));
}

/** The first star lands 20-50 minutes after startup; one task then runs everything. */
function startScheduler(api) {
  const [earliest, latest] = DATA.firstLandingMinutes;
  world.ticksToLanding = Common.minutesToTicks(randomBetween(earliest, latest));
  api.getTaskManager().submit(new (class ShootingStarsTask extends api.core.Task {
    constructor() { super(1); }
    execute() { tick(); }
  })());
}

module.exports = function attachLanding(api) {
  startScheduler(api);
  api.registerCommand("star", starCommand, api.core.PlayerRights.OWNER, "Show the shooting star, or land one: ::star spawn [size] [here|site]");
};

Object.assign(module.exports, { rollSize, rollSite, nextInterval, landNow, tick, describe, starCommand });
