"use strict";

/**
 * Where the real players are, and what AI bots do about it:
 * - watched(bot): is a real player within `watchTiles`? A bot nobody is near makes no model
 *   calls of its own (AiBotMind), so a quiet world costs nothing.
 * - With `logoutWhenEmptyMinutes`, AI bots log out once the world has had no real player for
 *   that long, and log back in a few at a time when someone arrives.
 * Bots log in one every SPAWN_GAP_MS, at startup too, so thirty never arrive in one tick.
 */
const SPAWN_GAP_MS = 1500;
const MAX_SPAWN_TRIES = 10;

class AiBotPresence {
  /**
   * spawn(index) -> "spawned" | "online" | "retry" | "failed"; logOut(bot) logs one bot out.
   */
  constructor({ core, config, minds, spawn, logOut, log = () => {} }) {
    this.core = core;
    this.config = config;
    this.minds = minds;
    this.spawn = spawn;
    this.logOut = logOut;
    this.log = log;
    this.real = [];
    this.queue = [];
    this.nextSpawnAt = 0;
    this.parked = false;
    this.emptySince = null;
  }

  get logoutAfterMs() {
    return Math.max(0, Number(this.config.logoutWhenEmptyMinutes) || 0) * 60000;
  }

  /** Where every real (non-bot) player is, taken once a tick. */
  refresh() {
    const real = [];
    for (const player of this.core.World.getPlayers()) {
      if (!player || player.isPlayerBot?.() === true || player.isRegistered?.() === false) continue;
      const at = player.getLocation();
      real.push({ x: at.getX(), y: at.getY(), z: at.getZ() });
    }
    this.real = real;
  }

  watched(bot) {
    const at = bot.getLocation();
    const range = this.config.watchTiles;
    return this.real.some(
      (player) => player.z === at.getZ() && Math.max(Math.abs(player.x - at.getX()), Math.abs(player.y - at.getY())) <= range
    );
  }

  /** Server startup: log the bots in, unless they wait for the first real player. */
  start(nowMs = Date.now()) {
    this.refresh();
    if (this.logoutAfterMs > 0 && this.real.length === 0) {
      this.parked = true;
      this.log("ai_bots_waiting_for_players", {});
      return;
    }
    this.queueAll(nowMs);
  }

  queueAll(nowMs) {
    this.queue = Array.from({ length: this.config.count }, (_, index) => ({ index, tries: 0 }));
    this.nextSpawnAt = nowMs;
  }

  tick(nowMs = Date.now()) {
    this.refresh();
    if (this.logoutAfterMs > 0) {
      if (this.real.length > 0) {
        this.emptySince = null;
        if (this.parked) this.unpark(nowMs);
      } else {
        this.emptySince ??= nowMs;
        if (!this.parked && nowMs - this.emptySince >= this.logoutAfterMs) this.park();
      }
    }
    if (!this.parked && this.queue.length > 0 && nowMs >= this.nextSpawnAt) {
      this.nextSpawnAt = nowMs + SPAWN_GAP_MS;
      const job = this.queue.shift();
      const result = this.spawn(job.index);
      // Still logging out from a park: try again a little later.
      if (result === "retry" && ++job.tries < MAX_SPAWN_TRIES) this.queue.push(job);
    }
  }

  park() {
    this.parked = true;
    this.queue = [];
    this.log("ai_bots_parked", { online: this.minds.size });
    for (const mind of [...this.minds.values()]) {
      this.logOut(mind.bot);
    }
  }

  unpark(nowMs) {
    this.parked = false;
    this.log("ai_bots_unparked", {});
    this.queueAll(nowMs);
  }
}

module.exports = { AiBotPresence, SPAWN_GAP_MS };
