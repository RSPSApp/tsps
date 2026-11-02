/**
 * A Sepulchre run, from climbing down the lobby stairs to leaving, as recorded (rsprox 1862 and
 * 3299):
 *
 * - Each floor is an instance copied from its 96x96 source area, with one of its recorded
 *   layouts (a start tile and the varbits that show which skill obstacles are out).
 * - The timer is in game ticks: 202 on floor 1 and 200 more at each floor; it runs every tick,
 *   stops on the floor's last obstacle (the platform or gate) and, at 1, the floor is sealed.
 * - The floor stairs credit the floor (completion count, time, personal best, Agility XP) and
 *   take the player down; an obelisk's Exit credits a finished floor and returns to the lobby.
 */
const Common = require("./Common.HallowedSepulchre");
const Traps = require("./Traps.HallowedSepulchre");

const CHUNK = 8;
const SIZE_CHUNKS = 12;
const PLANES = [0, 1, 2, 3];

/** Per player: their run while it lasts. */
const runs = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class SepulchreFloor extends TemplatedInstanceArea {
    constructor(run, floor) {
      super(SIZE_CHUNKS, SIZE_CHUNKS);
      this.run = run;
      this.floor = floor;
      this.origin = floor.source;
      this.spawned = [];
      for (const plane of PLANES) {
        this.copySquare(SIZE_CHUNKS, floor.source[0] / CHUNK, floor.source[1] / CHUNK, plane, 0, 0, plane, 0);
      }
    }

    getName() {
      return "Hallowed Sepulchre";
    }

    allowSummonPet() {
      return false;
    }

    /** The instance's copy of a template tile. */
    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    /** The template tile an instance tile copies. */
    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    process(mobile) {
      if (mobile.isPlayer?.() && this.run?.player === mobile) this.run.tick(this);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const npc of this.spawned) {
        npc.__skipDefaultRespawn = true;
        if (npc.isRegistered?.()) Common.api.removeNpc(npc);
      }
      this.spawned = [];
      super.destroy();
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.run?.player === mobile) this.run.left(this, logout);
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Run {
  constructor(player) {
    this.player = player;
    this.floor = null;
    this.variant = null;
    this.area = null;
    this.remaining = 0;
    this.spent = 0;
    this.floorSpent = 0;
    this.running = false;
    this.paused = false;
    this.expired = false;
    this.expiring = false;
    this.moving = false;
    this.ended = false;
    this.generation = 0;
    this.looted = new Set();
    this.xpEarned = new Map();
    this.states = {};
    this.transitioning = false;
    this.busyUntil = 0;
    this.ticks = 0;
  }

  /** Starts an obstacle that takes `ticks`, unless one is still going (a second click). */
  act(ticks) {
    if (this.transitioning || this.ticks < this.busyUntil || Traps.holding(this)) return false;
    this.busyUntil = this.ticks + ticks;
    return true;
  }

  /** Runs `action` later unless the run has moved on (or ended) since. */
  schedule(ticks, action) {
    const generation = this.generation;
    Common.later(ticks, () => {
      if (this.ended || generation !== this.generation || !this.player.isRegistered?.()) return;
      action();
    });
  }

  get floorNumber() {
    return this.floor?.floor ?? 0;
  }

  // ------------------------------------------------------------------ floors

  /**
   * Down to floor `number`, as live from the fade: +1 minimap off, +3 into the floor at its start
   * tile (live: the centre at +2), +4 the floor's varbits, line, music and fade in, +6 the timer
   * HUD, +7 the timer's first tick.
   */
  descend(number) {
    const floor = Common.data.floors.find((entry) => entry.floor === number);
    const variant = Common.randomOf(floor.variants);
    const { player } = this;
    this.running = false;
    this.generation++;
    this.schedule(1, () => Common.minimap(player, true));
    this.schedule(3, () => {
      if (!this.stillHere()) {
        this.finish();
        return;
      }
      this.move(floor, variant);
    });
    this.schedule(4, () => {
      const first = this.floorNumber === 1;
      for (const name of Common.data.stateVarbits) Common.varbit(player, name, 0);
      for (const [name, value] of Object.entries(variant.varbits)) Common.varbit(player, name, value);
      Common.varbit(player, "hallowed_block_climbover", 0);
      Common.varbit(player, "hallowed_current_floor_looted", 0);
      Common.varbit(player, "hallowed_current_floor_looted_b", 0);
      this.remaining = first ? Common.data.timer.start : this.remaining + Common.data.timer.perFloor;
      this.floorSpent = 0;
      this.paused = false;
      this.expired = false;
      this.expiring = false;
      this.transitioning = false;
      this.looted.clear();
      this.states = {};
      this.xpEarned.clear();
      Common.varbit(player, "hallowed_time_remaining", this.remaining);
      this.setBarriers(false);
      this.lastLanding = variant.start;
      Traps.build(this);
      player.sendMessage(Common.message(first ? "venture" : "ventureFurther"));
      Common.song(player, "inside");
      Common.minimap(player, false);
      Common.fade(player, false);
    });
    // Recorded: the HUD two ticks after the floor starts, the first tick off the timer the next
    // (tasks run before players each tick, so the timer's first tick is the one it is set on).
    this.schedule(6, () => {
      Common.closeFade(player);
      Common.openHud(player);
    });
    this.schedule(7, () => {
      this.running = true;
    });
  }

  /** Whether the player is still where the descent began (not teleported away meanwhile). */
  stillHere() {
    const area = this.player.getArea?.();
    if (this.area) return area === this.area;
    const [x, y] = Common.data.lobby.exitTile;
    const here = this.player.getLocation();
    return here.getZ() === 0 && Math.abs(here.getX() - x) <= 20 && Math.abs(here.getY() - y) <= 20;
  }

  /** Into a fresh instance of `floor` at its start tile; the last floor's instance goes. */
  move(floor, variant) {
    const previous = this.area;
    Traps.clear(this);
    this.player.getMovementQueue?.().setBlockMovement?.(false);
    const area = new (areaClass())(this, floor);
    this.moving = true;
    area.enter(this.player);
    this.player.moveTo(area.at(variant.start));
    this.moving = false;
    this.area = area;
    this.floor = floor;
    this.variant = variant;
    // A fresh instance has the cache's solid barriers.
    this.barriersActive = true;
    this.player.setAttribute(Common.data.attributes.return, true);
    if (previous && !previous.isDestroyed()) previous.destroy();
  }

  // ------------------------------------------------------------------ timer

  tick(area) {
    if (area !== this.area || this.ended) return;
    this.ticks++;
    Traps.tick(this);
    if (this.expiring) {
      this.expiring = false;
      this.expire();
      return;
    }
    if (!this.running || this.paused || this.expired) return;
    if (this.remaining <= 1) return;
    const { player } = this;
    this.remaining--;
    this.spent++;
    this.floorSpent++;
    Common.varbit(player, "hallowed_time_remaining", this.remaining);
    Common.varbit(player, "hallowed_time_spent", this.spent);
    Common.varbit(player, "hallowed_current_floor_time_spent", this.floorSpent);
    player.getPacketSender().sendClientScript(Common.data.scripts.timerUpdate, this.remaining);
    const warning = Common.data.timer.warnings[String(this.remaining)];
    if (warning) player.sendMessage(Common.message("timeWarning", { time: warning }));
    // Recorded: the timer stops at 1 and the floor is sealed the tick after.
    if (this.remaining === 1) {
      this.expiring = true;
      Common.closeHud(player);
    }
  }

  expire() {
    this.expired = true;
    this.running = false;
    this.setBarriers(true);
    this.player.sendMessage(Common.message(this.floorNumber === 5 ? "barrier" : "doorCloses"));
  }

  /** The floor 5 barriers by the Grand Hallowed Coffin: walked through until the timer runs out. */
  setBarriers(active) {
    if (this.floorNumber !== 5 || !this.area || this.barriersActive === active) return;
    const { RegionManager } = Common.core;
    const { id, tiles } = Common.data.finalBarriers;
    for (const tile of tiles) {
      const barrier = this.area.getTemplateObjects(this.area.at(tile)).find((object) => object.getId() === id);
      if (!barrier) continue;
      if (active) RegionManager.addObjectClipping(barrier);
      else RegionManager.removeObjectClipping(barrier);
    }
    this.barriersActive = active;
  }

  /** The floor's last obstacle: the timer stops (script 3443) and the way on opens. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    Common.varbit(this.player, "hallowed_block_climbover", 1);
    this.player.getPacketSender().sendClientScript(Common.data.scripts.timerPause, this.remaining);
  }

  /** The Wiki's token: one more minute, while the timer still runs. */
  addTime(ticks) {
    this.remaining += ticks;
    Common.varbit(this.player, "hallowed_time_remaining", this.remaining);
    this.player.getPacketSender().sendClientScript(Common.data.scripts.timerUpdate, this.remaining);
  }

  // ------------------------------------------------------------------ crediting

  /** The floor's completion lines and XP; `timed` adds the time and personal best lines. */
  credit(timed) {
    const { player } = this;
    const number = this.floorNumber;
    const completions = Common.record(player, "completions");
    completions[number] = (completions[number] ?? 0) + 1;
    player.setAttribute(Common.data.attributes.completions, completions);
    player.sendMessage(Common.message("completed", { floor: number, count: completions[number] }));
    // "hallowed-sepulchre:floor-completed" { player, floor }: a floor done (a league's "Complete floor 3").
    Common.api?.emitCustomEvent?.("hallowed-sepulchre:floor-completed", { player, floor: number });
    if (timed) {
      const pbs = Common.record(player, "pbs");
      const time = this.floorSpent;
      const best = pbs[number];
      if (best == null || time < best) {
        pbs[number] = time;
        player.setAttribute(Common.data.attributes.pbs, pbs);
        const varbit = Common.data.pbVarbits[String(number)];
        if (varbit) player.getPacketSender().sendVarbit(varbit, time);
        player.sendMessage(Common.message("floorTimePb", { floor: number, time: Common.formatTime(time) }));
      } else {
        player.sendMessage(Common.message("floorTime", { floor: number, time: Common.formatTime(time), pb: Common.formatTime(best) }));
      }
    }
    this.floorSpent = 0;
    Common.varbit(player, "hallowed_current_floor_time_spent", 0);
    Common.xp(player, "AGILITY", this.floor.xp);
  }

  /** Floor stairs: credit the floor, then down to the next one. */
  completeFloor() {
    if (this.ended) return;
    const { player } = this;
    this.transitioning = true;
    this.running = false;
    this.credit(true);
    Common.closeHud(player);
    Common.fade(player, true);
    Common.song(player, "silence");
    Common.jingle(player, "floorComplete");
    this.descend(this.floorNumber + 1);
  }

  // ------------------------------------------------------------------ leaving

  /**
   * Back to the lobby, as live after the obelisk's Exit: the floor credited if it was finished,
   * the fade, +1 minimap off, +2 the reset and the lobby, +3 the fade in and the lobby music.
   */
  leave(credit) {
    if (this.ended || (this.transitioning && this.leaving)) return;
    const { player } = this;
    this.transitioning = true;
    this.leaving = true;
    this.running = false;
    this.generation++;
    if (credit) this.credit(false);
    Common.closeHud(player);
    Common.fade(player, true);
    Common.song(player, "silence");
    if (credit) Common.jingle(player, "floorComplete");
    this.schedule(1, () => Common.minimap(player, true));
    this.schedule(2, () => {
      this.toLobby(Common.data.lobby.exitTile);
      player.sendMessage(Common.message("exited"));
    });
    this.schedule(3, () => {
      Common.minimap(player, false);
      Common.fade(player, false);
      Common.song(player, "lobby");
    });
    this.schedule(5, () => Common.closeFade(player));
  }

  /** Puts the player in the lobby and ends the run. */
  toLobby(tile) {
    this.moving = true;
    this.player.moveTo(Common.toLocation(tile));
    this.moving = false;
    this.finish();
  }

  /** Clears the run and its varbits; the player is already wherever they end up. */
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    this.generation++;
    runs.delete(this.player);
    const { player } = this;
    player.setAttribute(Common.data.attributes.return, null);
    Traps.clear(this);
    player.getMovementQueue?.().setBlockMovement?.(false);
    for (const name of Common.data.runVarbits) Common.varbit(player, name, 0);
    Common.closeHud(player);
    Common.closeFade(player);
    Common.minimap(player, false);
    const area = this.area;
    this.area = null;
    if (area && !area.isDestroyed()) area.destroy();
  }

  /**
   * The player left a floor's instance. Our own moves say so first; anything else (a teleport,
   * death, logging out) ends the run.
   */
  left(area, logout) {
    if (this.moving || area !== this.area || this.ended) return;
    if (logout) this.player.setLocation(Common.toLocation(Common.data.lobby.exitTile));
    this.area = null;
    this.finish();
  }
}

function runOf(player) {
  return runs.get(player) ?? null;
}

/**
 * A new run from the lobby stairs: recorded, the fade 2 ticks after arriving (or at once, after
 * the entry box's menu), floor 1 from there.
 */
function start(player, delay = 2) {
  runOf(player)?.finish();
  const run = new Run(player);
  runs.set(player, run);
  const go = () => {
    Common.fade(player, true);
    run.descend(1);
  };
  if (delay > 0) run.schedule(delay, go);
  else go();
  return run;
}

/** Logging out before the first floor's instance (the entry's first ticks) ends the run too. */
function endOnLogout({ player }) {
  const run = runOf(player);
  if (run && !run.area) run.finish();
}

/** A player saved mid-run (the server stopped) comes back in the lobby. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.data.attributes.return) || runOf(player)) return;
  player.setAttribute(Common.data.attributes.return, null);
  player.moveTo(Common.toLocation(Common.data.lobby.exitTile));
}

function attachRun(api) {
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerLogout?.(endOnLogout);
}

module.exports = { attachRun, runOf, start, Run };
