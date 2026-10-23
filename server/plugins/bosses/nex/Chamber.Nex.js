/**
 * The public chamber behind the Ancient Barrier: one per world, on the real map.
 *
 * - The barrier is a multiloc on varbit 13184 (captured): 1 outside it (Pass (normal), Pass
 *   (private), Peek), 2 inside with no fight and 3 during one (no options). While a fight is on,
 *   the barrier's tile holds its busy version (42968), as captured from the prison.
 * - Pass (normal): into the chamber while no fight is on (captured refusal otherwise); a player whose
 *   items wait in a reclaim chest is asked first. Nex appears 54 ticks after the first player is in
 *   and again 37 ticks after each kill while anyone is there (the captured private fight's timing).
 * - Peek: how many are inside and the phase she is in (captured).
 * - The chamber's Area: multi-combat, part of the God Wars Dungeon (the essence overlay stays), and
 *   the rules on her mages (immune until called).
 * Private fights are Instance.Nex.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.Nex");
const Fight = require("./Fight.Nex");

/** The scoreboard's world totals, kept as the Doom's are: plugins have no world store. */
const SCOREBOARD_FILE = path.join(process.cwd(), "data", "saves", "nex-scoreboard.json");

const state = {
  fight: null,
  spawnAt: null,
  /** World totals for the scoreboard (public and private fights), saved across restarts. */
  kills: 0,
  deaths: 0,
  bestTicks: 0,
};

function loadScoreboard() {
  try {
    const saved = JSON.parse(fs.readFileSync(SCOREBOARD_FILE, "utf8"));
    for (const key of ["kills", "deaths", "bestTicks"]) state[key] = Math.max(0, Math.trunc(Number(saved[key]) || 0));
  } catch {
    // No file yet, or unreadable: start from zero.
  }
}

function saveScoreboard() {
  try {
    fs.mkdirSync(path.dirname(SCOREBOARD_FILE), { recursive: true });
    fs.writeFileSync(SCOREBOARD_FILE, JSON.stringify({ kills: state.kills, deaths: state.deaths, bestTicks: state.bestTicks }, null, 2));
  } catch (error) {
    console.warn("[nex] could not save the scoreboard", error?.message ?? error);
  }
}

/** A kill in any chamber, for the world totals. */
function recordKill(ticks) {
  state.kills++;
  if (ticks > 0 && (state.bestTicks === 0 || ticks < state.bestTicks)) state.bestTicks = ticks;
  saveScoreboard();
}

let chamberArea = null;

/** The public chamber as a fight's arena: real tiles, the players in it. */
const arena = {
  area: null,
  tile: (tile) => Common.toLocation(tile),
  real: (location) => [location.getX(), location.getY()],
  inChamber: (location) => Common.inBox(Common.data.chamber.box, location) && location.getZ() === 0,
  players: () => chamberPlayers(),
  spawn(id, tile) {
    return this.spawnAt(id, Common.toLocation(tile));
  },
  spawnAt(id, location) {
    const npc = Common.api.spawnNpc({ id, x: location.getX(), y: location.getY(), z: location.getZ(), wanderRadius: 0 });
    if (npc) npc.__skipDefaultRespawn = true;
    return npc;
  },
  ended(fight, killed) {
    if (state.fight !== fight) return;
    state.fight = null;
    if (killed) recordKill(fight.endTick - fight.startedTick());
    setBusy(false);
    if (chamberPlayers().length > 0) scheduleSpawn(Common.data.chamber.respawnTicks);
  },
};

/** Players standing in the public chamber, alive. */
function chamberPlayers() {
  if (!chamberArea) return [];
  return chamberArea.getPlayers().filter((player) => player.isRegistered() && player.getHitpoints() > 0 && !player.getPrivateArea());
}

function fight() {
  return state.fight;
}

/** The fight in the player's chamber, public or private. */
function fightFor(player) {
  const instance = require("./Instance.Nex").instanceOf(player);
  if (instance) return instance.fight;
  return chamberArea?.hasMember(player) ? state.fight : null;
}

// ------------------------------------------------------------------ the barrier

function barrierValue(player) {
  const { barrierStates } = Common.data;
  if (require("./Instance.Nex").instanceOf(player)) return null;
  if (!chamberArea?.hasMember(player)) return barrierStates.prison;
  return state.fight ? barrierStates.fighting : barrierStates.idle;
}

function sendBarrier(player) {
  const value = barrierValue(player);
  if (value != null) player.getPacketSender().sendVarbit(Common.data.varbits.barrier, value);
}

function broadcastBarrier() {
  for (const player of chamberArea?.getPlayers() ?? []) sendBarrier(player);
}

/** The barrier's tile shows its busy version while a fight is on. */
function setBusy(busy) {
  const { GameObject, MapObjects, ObjectManager } = Common.core;
  const { objects, chamber } = Common.data;
  const at = Common.toLocation(chamber.barrierTile);
  const current = MapObjects.get(busy ? objects.barrier : objects.barrierBusy, at, null);
  if (current) {
    const face = current.getFace?.() ?? 3;
    ObjectManager.deregister(current, false);
    ObjectManager.register(new GameObject(busy ? objects.barrierBusy : objects.barrier, at, 10, face, null), true);
  }
  broadcastBarrier();
}

// ------------------------------------------------------------------ the spawn

function scheduleSpawn(ticks) {
  if (state.fight || state.spawnAt) return;
  const at = {};
  state.spawnAt = at;
  Common.later(ticks, () => {
    if (state.spawnAt !== at) return;
    state.spawnAt = null;
    if (state.fight || chamberPlayers().length === 0) return;
    startFight();
  });
}

function startFight() {
  state.spawnAt = null;
  state.fight = Fight.open(arena);
  if (state.fight.stopped) {
    state.fight = null;
    return null;
  }
  setBusy(true);
  return state.fight;
}

// ------------------------------------------------------------------ the barrier's options

/** Pass / Pass (normal): into the public chamber; from inside, only the altar leads out. */
function pass({ player }) {
  const texts = Common.data.prisonTexts;
  if (chamberArea?.hasMember(player) || require("./Instance.Nex").instanceOf(player)) {
    Common.statement(player, texts.exitOnlyAltar);
    return true;
  }
  if (state.fight) {
    Common.statement(player, texts.inProgress);
    return true;
  }
  if (require("./Reclaim.Nex").hasItems(player)) {
    Common.api.sendMultiChatboxPrompt(player, "A nearby chest has some of your items. Do you still wish to proceed?",
      "Yes.", () => enter(player),
      "No.", () => player.getPacketSender().sendInterfaceRemoval());
    return true;
  }
  enter(player);
  return true;
}

function enter(player) {
  player.getPacketSender().sendInterfaceRemoval();
  if (state.fight) {
    Common.statement(player, Common.data.prisonTexts.inProgress);
    return;
  }
  Common.fadeMove(player, Common.toLocation(Common.data.chamber.entry));
}

/** Peek, as captured: "There are 2 adventurers on the other side of the barrier.<br>Nex is imbued with smoke." */
function peek({ player }) {
  const texts = Common.data.prisonTexts;
  const count = chamberPlayers().length;
  let text = texts.peek
    .replace("[are]", count === 1 ? "is" : "are")
    .replace("[n]", String(count))
    .replace("[adventurers]", count === 1 ? "adventurer" : "adventurers");
  const phase = state.fight?.phaseName?.();
  if (phase) text += texts.peekPhase.replace("[phase]", phase);
  Common.statement(player, text);
  return true;
}

// ------------------------------------------------------------------ the Area

/** Shared by the public chamber and private ones: her mages can't be attacked until called. */
function canAttackIn(attacker, target) {
  if (!attacker?.isPlayer?.()) return null;
  const fight = Fight.fightOf(target);
  if (!fight?.isImmuneMage(target)) return null;
  attacker.getAsPlayer().sendMessage(Common.data.fight.mageImmune.replace("[name]", target.getCurrentDefinition().getName()));
  return false;
}

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { Area, Boundary } = Common.core;
  AreaClass = class NexChamber extends Area {
    constructor() {
      const { box } = Common.data.chamber;
      super([new Boundary(box.minX, box.maxX, box.minY, box.maxY, box.z)]);
      this.isGodWarsArea = true;
    }

    getName() {
      return "Nex's chamber";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      require("../godwars/Dungeon.GodWars").openOverlay(player);
      sendBarrier(player);
      if (!state.fight) scheduleSpawn(Common.data.chamber.firstSpawnTicks);
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      state.fight?.playerLeft(player);
      if (logout) player.setLocation(Common.toLocation(Common.data.prison.entryRoom));
      else sendBarrier(player);
      if (chamberPlayers().filter((other) => other !== player).length === 0 && !state.fight) state.spawnAt = null;
    }

    canAttack(attacker, target) {
      return canAttackIn(attacker, target);
    }
  };
  return AreaClass;
}

function passPrivate(event) {
  return require("./Instance.Nex").passPrivate(event);
}

function recordDeath() {
  state.deaths++;
  saveScoreboard();
}

function attachChamber(api) {
  loadScoreboard();
  chamberArea = new (areaClass())();
  api.registerArea(chamberArea);
  // The placed loc is the multiloc (named "null"); its "Ancient Barrier" forms share the op slots:
  // 1 Pass / Pass (normal), 2 Pass (private), 3 Peek.
  const { barrier, barrierBusy } = Common.data.objects;
  api.onObjectFirstClick([barrier, barrierBusy], pass);
  api.onObjectSecondClick([barrier, barrierBusy], passPrivate);
  api.onObjectThirdClick([barrier, barrierBusy], peek);
}

module.exports = {
  attachChamber, arena, fight, fightFor, startFight, scheduleSpawn, sendBarrier, chamberPlayers, canAttackIn, recordDeath, recordKill, pass, peek,
  get state() { return state; },
};
