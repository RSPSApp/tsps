"use strict";

/**
 * A Rogues' Den run: the doorway in, the prayer/level reset, the drained-level account the
 * wall-safe experience uses, the way out (safe, jewel, trap, logout), and the lobby restore.
 *
 * Experience follows the Wiki: 12 per level drained in each skill when the safe is cracked; a
 * failed/abandoned run pays a fraction by how far in the player was. The Wiki does not print the
 * fraction, so the three transcript cases are used: before the first pendulum nothing, past it
 * half, and in the safe room the full amount. A capture with the exact numbers would replace this.
 */
const Common = require("./Common.RoguesDen");

const IN_MAZE_ATTRIBUTE = "rogues-den:in-maze";
const RETURN_ATTRIBUTE = "rogues-den:return";
const ACCESS_ATTRIBUTE = "rogues-den:access";
const LAST_XP_ATTRIBUTE = "rogues-den:last-xp";

const runs = new Map();

const BRIAN = Common.npcIds.brian;
const VARIANTS = {
  safe: "while-inside-the-maze-interacting-with-the-wall-safes",
  caught: "while-inside-the-maze-getting-caught-by-the-rogue-guards-hit-by-the-moving-spin-blade-obstacles-or-hit-by-any-other-less-dangerous-obstacles-except-for-the-contortion-bars",
  firstPendulum: "while-inside-the-maze-hit-by-the-first-pendulum",
  jewel: "while-inside-the-maze-activating-the-mystic-jewel",
};

class Run {
  constructor(player) {
    this.player = player;
    this.startedTick = 0;
    this.drained = { THIEVING: 0, AGILITY: 0 };
    this.pastFirstPendulum = false;
    this.finishing = false;
    this.ended = false;
    this.teleporting = false;
    this.safeUsed = false;
    this.maxDistance = 0;
    this.ignoreTrapUntil = 0;
    this.moves = [];
    this.prev = player.getLocation().clone();
    this.lastMove = [0, 1];
  }

  /** Records a drain; false when the player does not have enough left and must leave. */
  drain(skill, amount) {
    const current = Common.level(this.player, skill);
    if (current - amount < 0) return false;
    Common.setLevel(this.player, skill, current - amount);
    this.drained[skill] = (this.drained[skill] ?? 0) + amount;
    return true;
  }

  zone() {
    if (Common.inSafeRoom(this.player.getLocation())) return 2;
    return this.pastFirstPendulum ? 1 : 0;
  }

  fraction() {
    return this.zone() === 2 ? 1 : this.zone() === 1 ? Common.DATA.xp.failFraction.afterFirstPendulum : 0;
  }

  xp() {
    const per = Common.DATA.xp.perLevel;
    return {
      thieving: Math.floor((this.drained.THIEVING ?? 0) * per),
      agility: Math.floor((this.drained.AGILITY ?? 0) * per),
    };
  }

  partialXp() {
    const fraction = this.fraction();
    const all = this.xp();
    return {
      thieving: Math.floor(all.thieving * fraction),
      agility: Math.floor(all.agility * fraction),
    };
  }
}

function runOf(player) {
  return runs.get(player) ?? null;
}

function start(player) {
  if (runOf(player)) return runOf(player);
  Common.scan();
  const run = new Run(player);
  runs.set(player, run);
  player.setAttribute(IN_MAZE_ATTRIBUTE, true);
  player.setAttribute(RETURN_ATTRIBUTE, true);
  Common.setLevel(player, "PRAYER", 0);
  Common.setLevel(player, "THIEVING", Common.maxLevel(player, "THIEVING"));
  Common.setLevel(player, "AGILITY", Common.maxLevel(player, "AGILITY"));
  return run;
}

function restore(player) {
  for (const skill of ["PRAYER", "THIEVING", "AGILITY"]) {
    Common.setLevel(player, skill, Common.maxLevel(player, skill));
  }
}

function removeJewel(player) {
  if (Common.hasItem(player, Common.itemIds.mysticJewel)) Common.take(player, Common.itemIds.mysticJewel, 1);
}

function startBrian(player, variant) {
  Common.api().emitCustomEvent("npc-dialogue:start", {
    player,
    npcId: BRIAN,
    variant,
    exact: true,
    handled: false,
  });
}

function rememberXp(player, numbers) {
  player.setAttribute(LAST_XP_ATTRIBUTE, numbers);
}

function lastXp(player) {
  return player.getAttribute(LAST_XP_ATTRIBUTE) ?? { thieving: 0, agility: 0 };
}

function clearXp(player) {
  player.setAttribute(LAST_XP_ATTRIBUTE, null);
}

function teleportLobby(player) {
  const [x, y, z] = Common.DATA.lobby.entryTile;
  const core = Common.core();
  player.moveTo(new core.Location(x, y, z));
}

/**
 * Ends the run. `reason` chooses the transcript Brian speaks: safe, caught, firstPendulum,
 * jewel, left or logout. Loot, when any, has already been put in the inventory.
 */
function finish(player, { reason = "left", logout = false, reward = false, silent = false } = {}) {
  const run = runOf(player);
  if (!run || run.ended) return;
  run.ended = true;
  run.finishing = true;
  runs.delete(player);

  const numbers = reward ? run.xp() : run.partialXp();
  if (numbers.thieving > 0) player.getSkillManager().addExperience(Common.core().Skill.THIEVING, numbers.thieving);
  if (numbers.agility > 0) player.getSkillManager().addExperience(Common.core().Skill.AGILITY, numbers.agility);

  restore(player);
  removeJewel(player);
  Common.resetTrapFor(player);
  player.setAttribute(IN_MAZE_ATTRIBUTE, false);
  player.setAttribute(RETURN_ATTRIBUTE, false);
  player.getMovementQueue?.().setBlockMovement?.(false);

  if (logout) return;

  const leave = !silent;
  if (leave) {
    player.getMovementQueue?.().reset?.();
    player.getMovementQueue?.().setBlockMovement?.(true);
    run.teleporting = true;
    teleportLobby(player);
    run.teleporting = false;
    const core = Common.core();
    core.TaskManager.submit(new (class extends core.Task {
      constructor() { super(1, player, false); }
      execute() {
        this.stop();
        player.getMovementQueue?.().setBlockMovement?.(false);
      }
    })());
  }

  rememberXp(player, numbers);
  if (silent) return;
  const variant = reason === "safe" ? VARIANTS.safe
    : reason === "firstPendulum" ? VARIANTS.firstPendulum
      : reason === "jewel" ? VARIANTS.jewel
        : VARIANTS.caught;
  const core = Common.core();
  Common.api().getTaskManager().submit(new (class extends core.Task {
    constructor() { super(1); }
    execute() {
      this.stop();
      if (!player.isRegistered?.()) return;
      startBrian(player, variant);
    }
  })());
}

/** A trap, blade or guard caught the player: no loot, partial experience, Brian's line. */
function caught(player, message = null) {
  const run = runOf(player);
  if (!run) return;
  if (message) player.sendMessage(message);
  finish(player, { reason: run.pastFirstPendulum ? "caught" : "firstPendulum" });
}

function safe(player) {
  const run = runOf(player);
  if (!run) return;
  run.safeUsed = true;
  finish(player, { reason: "safe", reward: true });
}

/** The tick bookkeeping the area uses: distance/progress, then the trap unit. */
function tick(player) {
  const run = runOf(player);
  if (!run || run.ended) return;
  const location = player.getLocation();
  const here = Common.keyOf(location);
  const prev = Common.keyOf(run.prev);
  const dx = location.getX() - run.prev.getX();
  const dy = location.getY() - run.prev.getY();
  const teleported = location.getZ() !== run.prev.getZ() || Math.max(Math.abs(dx), Math.abs(dy)) > 2;
  if (!teleported && (dx !== 0 || dy !== 0)) {
    run.moves.push([dx, dy]);
    if (run.moves.length > 4) run.moves.shift();
    const [sx, sy] = run.moves.reduce(([ax, ay], [mx, my]) => [ax + mx, ay + my], [0, 0]);
    run.lastMove = Math.abs(sx) >= Math.abs(sy) ? [Math.sign(sx) || 1, 0] : [0, Math.sign(sy) || 1];
    if (!run.pastFirstPendulum && (location.getY() > 5000 || location.getX() < 3035)) run.pastFirstPendulum = true;
  }
  if (teleported) run.moves = [];
  run.prev = location.clone();
  run.here = here;
  Common.rearmLeftTraps(player);
  require("./Traps.RoguesDen").tick(run, { prev, here, dx, dy, teleported });
}

function left(player, logout) {
  const run = runOf(player);
  if (!run || run.ended || run.teleporting || run.finishing) return;
  finish(player, { reason: "left", logout });
}

/** A saved mid-run player comes back in the lobby; a fresh login is not in the maze. */
function recoverOnLogin({ player }) {
  if (runOf(player)) return;
  if (player.getAttribute(RETURN_ATTRIBUTE)) {
    player.setAttribute(RETURN_ATTRIBUTE, false);
    player.setAttribute(IN_MAZE_ATTRIBUTE, false);
    restore(player);
    removeJewel(player);
    const [x, y, z] = Common.DATA.lobby.entryTile;
    const core = Common.core();
    player.moveTo(new core.Location(x, y, z));
  }
}

function endOnLogout({ player }) {
  const run = runOf(player);
  if (!run) return;
  finish(player, { reason: "logout", logout: true });
  const [x, y, z] = Common.DATA.lobby.entryTile;
  const core = Common.core();
  player.moveTo(new core.Location(x, y, z));
}

function attach(api) {
  api.persistAttribute(IN_MAZE_ATTRIBUTE, false);
  api.persistAttribute(RETURN_ATTRIBUTE, false);
  api.persistAttribute(ACCESS_ATTRIBUTE, false);
  api.persistAttribute(LAST_XP_ATTRIBUTE, null);
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerLogout?.(endOnLogout);
  api.onCustomEvent("stats:natural-restore", (request) => {
    if (runOf(request.player)) request.allowed = false;
  });
  api.onCustomEvent("stats:boost-decay", (request) => {
    if (runOf(request.player)) request.allowed = false;
  });
}

module.exports = {
  attach, runOf, start, finish, caught, safe, tick, left, restore,
  startBrian, rememberXp, lastXp, clearXp, teleportLobby,
  IN_MAZE_ATTRIBUTE, RETURN_ATTRIBUTE, ACCESS_ATTRIBUTE, LAST_XP_ATTRIBUTE, VARIANTS,
};
