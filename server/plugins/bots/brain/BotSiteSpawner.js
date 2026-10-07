"use strict";

const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { attachBrain } = require("./attachBrain");

const SPAWN_ATTEMPTS = 16;

/**
 * Spawns the data-driven sites (bot-activities.json "sites") as brain-driven
 * bots. On by default; BOT_SITES=0 disables them for a bots-free world.
 */
function startBotSites(options = {}) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  if ((process.env.BOT_SITES ?? "1") === "0") {
    return null;
  }
  if (!runtime || !registry || !Array.isArray(registry.sites) || registry.sites.length === 0) {
    return null;
  }
  const RegionManager = api?.getRegionManager?.() ?? null;

  function spawn(site, index) {
    const anchor = site.anchor ?? null;
    if (!anchor || !registry.hasRoom(site.activity.id)) {
      return false;
    }
    RegionManager?.loadMapFiles?.(anchor.x, anchor.y);
    const radius = Math.max(0, Math.min(24, Number(site.spawnRadius ?? 6)));
    let location = null;
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS && !location; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 1 + Math.floor(Math.random() * Math.max(1, radius));
      const candidate = new Location(
        anchor.x + Math.round(Math.cos(angle) * distance),
        anchor.y + Math.round(Math.sin(angle) * distance),
        anchor.z ?? 0
      );
      if (!RegionManager || !RegionManager.blocked(candidate, null)) {
        location = candidate;
      }
    }
    if (!location) {
      location = new Location(anchor.x, anchor.y, anchor.z ?? 0);
    }

    const bot = runtime.spawnPvpBot(location, { mode: site.activity.mode });
    if (!bot) {
      return false;
    }
    return attachBrain({
      runtime,
      registry,
      world,
      bot,
      activity: site.activity,
      home: anchor,
      resetMovementState,
    });
  }

  function start() {
    let spawned = 0;
    for (const site of registry.sites) {
      const count = Math.max(0, Math.floor(Number(site.count ?? 0)));
      let siteSpawned = 0;
      for (let index = 0; index < count; index++) {
        if (spawn(site, index)) {
          siteSpawned++;
        }
      }
      spawned += siteSpawned;
      botApi?.log?.("bot_site_spawned", {
        site: site.id,
        activity: site.activity.id,
        requested: count,
        spawned: siteSpawned,
      });
    }
    if (spawned > 0) {
      botApi?.log?.("bot_sites_started", { spawned });
    }
  }

  if (typeof api?.onServerStartup === "function") {
    api.onServerStartup(() => setTimeout(start, 1000));
  }
  return { start };
}

module.exports = {
  startBotSites,
};
