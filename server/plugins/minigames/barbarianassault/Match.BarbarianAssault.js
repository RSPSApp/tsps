"use strict";

const data = require("./Data.BarbarianAssault");
const Points = require("./Points.BarbarianAssault");
const Items = require("./Items.BarbarianAssault");

const PHASE = Object.freeze({
  STARTING: "starting",
  WAVE: "wave",
  INTERMISSION: "intermission",
  ENDING: "ending",
});

const activeMatches = new Set();
const matchByPlayer = new WeakMap();
let matchSerial = 0;
let core = null;

function boundary(bounds) {
  return new core.Boundary(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.z);
}

function location(tile) {
  return new core.Location(tile.x, tile.y, tile.z ?? 0);
}

function distance(a, b) {
  return a?.getDistance?.(b) ?? Infinity;
}

function randomOf(values, random = Math.random) {
  return values[Math.floor(random() * values.length)];
}

function ticks(seconds) {
  return Math.max(1, Math.ceil(seconds / 0.6));
}

/**
 * One Barbarian Assault game. The match owns its area, NPCs, timers, cannon,
 * trap objects and every per-player role state; nothing here survives finish().
 */
class BarbarianAssaultMatch {
  constructor(api, team, onFinished) {
    this.api = api;
    this.core = api.core;
    this.id = ++matchSerial;
    this.onFinished = onFinished;
    this.team = new Map(team); // player -> role
    this.players = new Map();
    this.phase = PHASE.STARTING;
    this.wave = 1;
    this.arena = data.ARENA.normal;
    this.npcs = new Set();
    this.npcMeta = new Map();
    this.reserve = { fighter: 0, ranger: 0, healer: 0, runner: 0 };
    this.spawnedWave = false;
    this.ended = false;
    this.lastCycle = -1;
    this.elapsedTicks = 0;
    this.waveStartTick = 0;
    this.callTick = 0;
    this.calls = {};
    this.cannon = { red: 0, green: 0, blue: 0, omega: 0 };
    this.groundItems = new Set();
    this.groundBait = new Map();
    this.objectSwaps = [];
    this.traps = [];
    this.queen = null;
    this.queenSpawned = false;
    this.queenHits = 0;
    this.queenNextEgg = 0;
    this.queenNextSpawn = 0;
    this.waveAwarded = false;
    this.intermissionTask = null;
    this.intermissionKey = `barbarian-assault:intermission:${this.id}`;
    this.hudSent = new Map();
    this.area = new MatchArea(this);
    this.areaClass = this.area.constructor;

    for (const [player, role] of this.team) {
      this.players.set(player, this.createPlayerState(player, role));
    }
    activeMatches.add(this);
    for (const player of this.players.keys()) matchByPlayer.set(player, this);
  }

  createPlayerState(player, role) {
    return {
      player,
      role,
      calls: { required: null, heard: null, called: false },
      medic: false,
      stats: {
        fightersKilled: 0,
        rangersKilled: 0,
        wrongAttacks: 0,
        eggsCollected: 0,
        eggsExploded: 0,
        runnersKilled: 0,
        runnersEscaped: 0,
        healersKilled: 0,
        hpReplenished: 0,
        wrongPoisons: 0,
      },
      bag: { red: 0, green: 0, blue: 0 },
      sent: new Map(),
    };
  }

  start() {
    if (this.ended) return;
    this.phase = PHASE.WAVE;
    for (const player of this.players.keys()) this.moveIntoArena(player);
    this.beginWave();
  }

  moveIntoArena(player) {
    const current = player.getArea?.();
    if (current && current !== this.area) {
      current.leave?.(player, false);
      if (player.getArea?.() === current) player.setArea?.(null);
    }
    if (player.getArea?.() !== this.area) {
      this.area.enter(player);
      if (player.getArea?.() !== this.area) player.setArea?.(this.area);
    }
    const spawn = this.arena.spawn;
    const offset = [...this.players.keys()].indexOf(player);
    player.moveTo(location({ x: spawn.x + (offset % 3) - 1, y: spawn.y + Math.floor(offset / 3) - 1, z: spawn.z }));
  }

  onPlayerEnter(player) {
    const state = this.players.get(player);
    if (!state || this.ended) return;
    player.setAttribute("barbarian-assault:match", this);
    Items.openRoleHud(player, state.role);
    Items.setHudPartner(player, state.role);
    this.updateHud(player, true);
  }

  onPlayerLeave(player, logout) {
    player.setAttribute("barbarian-assault:match", null);
    Items.closeHud(player);
    if (this.ended) return;
    if (this.players.has(player)) {
      Items.clear(player);
      this.players.delete(player);
      this.team.delete(player);
      matchByPlayer.delete(player);
      this.abort("A team member left the arena. The wave is lost.");
    }
  }

  abort(reason) {
    this.finish(false, reason);
  }

  beginWave() {
    this.spawnedWave = false;
    this.waveAwarded = false;
    this.spawnWave();
    this.spawnedWave = true;
  }

  spawnWave() {
    if (this.ended) return;
    this.arena = this.wave === 10 ? data.ARENA.queen : data.ARENA.normal;
    this.waveStartTick = this.elapsedTicks;
    this.callTick = 0;
    this.cannon = { red: 0, green: 0, blue: 0, omega: 0 };
    this.reserve = { fighter: 0, ranger: 0, healer: 0, runner: 0 };
    this.queen = null;
    this.queenSpawned = false;
    this.queenHits = 0;
    this.queenNextEgg = 0;
    this.queenNextSpawn = 0;
    this.clearGroundItems();
    this.clearBait();
    this.setupTraps();
    this.phase = PHASE.WAVE;

    for (const player of this.players.keys()) {
      const state = this.players.get(player);
      state.stats = this.createPlayerState(player, state.role).stats;
      state.bag = { red: 0, green: 0, blue: 0 };
      state.medic = false;
      Items.clear(player);
      for (const [itemId, amount] of Items.roleItems(player, state.role)) Items.give(player, itemId, amount);
      this.moveIntoArena(player);
      Items.openRoleHud(player, this.players.get(player).role);
      this.updateHud(player, true);
      player.sendMessage(`Wave ${this.wave} of ${data.WAVES.length - 1}.`);
    }

    const wave = data.WAVES[this.wave];
    for (const type of ["fighter", "ranger", "healer", "runner"]) {
      const info = wave[type];
      for (let i = 0; i < info.initial; i++) this.spawnPenance(type, info.hp);
      this.reserve[type] = info.reserve;
    }
    this.chooseCalls(true);
    if (this.wave === 10) this.queenNextEgg = this.elapsedTicks + data.QUEEN_EGG_TICKS;
  }

  chooseCalls(force = false) {
    for (const role of data.ROLES) {
      const state = this.playersForRole(role)[0];
      if (!state) continue;
      state.calls.required = randomOf(data.CALL_OPTIONS[role]);
      state.calls.called = false;
      this.calls[role] = state.calls;
    }
    if (force) {
      for (const role of data.ROLES) {
        const state = this.playersForRole(role)[0];
        if (!state) continue;
        state.calls.heard = this.calls[data.PARTNER[role]]?.required ?? state.calls.required;
        state.calls.called = true;
      }
    }
    // A duplicated role shares the same call: every player of the role sees it.
    for (const role of data.ROLES) {
      const first = this.playersForRole(role)[0];
      if (!first) continue;
      for (const state of this.playersForRole(role)) state.calls = first.calls;
    }
    for (const player of this.players.keys()) this.updateHud(player, true);
  }

  playersForRole(role) {
    const players = [];
    for (const [player, state] of this.players) if (state.role === role) players.push(state);
    return players;
  }

  call(player, called) {
    const state = this.players.get(player);
    if (!state || this.phase !== PHASE.WAVE) return false;
    const role = state.role;
    const partner = data.PARTNER[role];
    state.calls.called = called === state.calls.required;
    if (this.calls[partner]) this.calls[partner].heard = called;
    for (const other of this.playersForRole(role)) other.calls = state.calls;
    this.updateHud(player, true);
    if (state.calls.called) player.sendMessage(`You call ${data.CALL_LABEL[called] ?? called}.`);
    else player.sendMessage(`You call ${data.CALL_LABEL[called] ?? called}. That was not the call your partner needed.`);
    return true;
  }

  medic(player) {
    const state = this.players.get(player);
    if (!state || this.phase !== PHASE.WAVE) return false;
    state.medic = true;
    player.sendMessage("You call for a medic.");
    this.updateHud(player, true);
    return true;
  }

  spawnPenance(type, hp, tile = null) {
    const ids = data.PENANCE_IDS[type];
    const id = ids[Math.min(this.wave, 9) - 1] ?? ids[0];
    const spawnTile = tile ?? randomOf(this.arena.caves);
    const npc = this.spawnNpc(id, spawnTile);
    npc.__baType = type;
    npc.__baWave = this.wave;
    npc.__baNextAction = this.elapsedTicks;
    npc.__baPoison = null;
    npc.__baStunUntil = 0;
    npc.__baLastAttacker = null;
    npc.canWalkThroughNPCs = () => true;
    npc.getMovementCoordinator?.().setRadius?.(0);
    if (type === "runner") {
      npc.setFlag?.("combat:no-retaliate");
      npc.__baHome = tile instanceof this.core.Location ? tile : location(tile ?? spawnTile);
    }
    this.applyPenanceStats(npc, type, hp);
    this.npcMeta.set(npc, { type, hp });
    return npc;
  }

  spawnNpc(id, tile) {
    const npc = this.core.NPC.create(id, location(tile));
    npc.__skipDefaultRespawn = true;
    this.area.enter(npc);
    this.npcs.add(npc);
    this.core.World.getAddNPCQueue().push(npc);
    return npc;
  }

  applyPenanceStats(npc, type, hp) {
    const definition = npc.getDefinition();
    const combat = Math.max(1, 20 + this.wave * 6 + (type === "runner" ? 0 : 5));
    definition.combatLevel = combat;
    const stats = definition.getStats();
    for (let i = 0; i < 3; i++) stats[i] = Math.max(1, combat - 10);
    definition.setMaxHitpoints(Math.max(1, hp));
    npc.setHitpoints(Math.max(1, hp));
  }

  setupTraps() {
    this.traps = this.arena.traps.map((tile) => ({
      location: location(tile),
      charges: 2,
      object: null,
    }));
    for (const trap of this.traps) trap.object = this.placeObject(data.OBJECT.RUNNER_TRAP_2, trap.location);
  }

  /** Swaps every map object on a tile for one match-owned object, remembering the originals. */
  placeObject(id, at) {
    const originals = [];
    for (const object of this.core.World.getObjects()) {
      if (object.getLocation().equals(at)) originals.push(object);
    }
    for (const original of originals) this.core.ObjectManager.deregister(original, false);
    const shape = originals[0];
    const object = new this.core.GameObject(id, at.clone(), shape?.getType?.() ?? 22, shape?.getFace?.() ?? 0, this.area);
    this.core.ObjectManager.register(object, true);
    this.objectSwaps.push([originals, object]);
    return object;
  }

  restoreObjects() {
    for (const object of [...this.core.World.getObjects()]) {
      if (object.getPrivateArea?.() === this.area) {
        this.core.ObjectManager.deregister(object, false);
        this.area.detach?.(object);
      }
    }
    for (const [originals] of this.objectSwaps.splice(0).reverse()) {
      for (const original of originals ?? []) this.core.ObjectManager.register(original, true);
    }
  }

  clearGroundItems() {
    for (const item of [...this.core.World.getItems()]) {
      if (item.getPrivateArea?.() === this.area) {
        try { this.core.ItemOnGroundManager.deregister(item); } catch { /* already gone */ }
      }
    }
    for (const item of this.groundItems) {
      try { this.core.ItemOnGroundManager.deregister(item); } catch { /* already gone */ }
    }
    this.groundItems.clear();
  }

  clearBait() {
    for (const bait of this.groundBait.values()) {
      try { this.core.ItemOnGroundManager.deregister(bait.groundItem); } catch { /* already gone */ }
    }
    this.groundBait.clear();
  }

  addGroundItem(player, itemId, at) {
    const item = new this.core.Item(itemId, 1);
    const ground = this.core.ItemOnGroundManager.registerLocation(player, item, at.clone(), this.area);
    if (ground) this.groundItems.add(ground);
    return ground;
  }

  dropEgg(npc) {
    const call = randomOf([data.CALL.RED, data.CALL.GREEN, data.CALL.BLUE]);
    this.addGroundItem([...this.players.keys()][0], data.EGG_ITEM[call], npc.getLocation());
  }

  processOnce() {
    if (this.ended) return;
    const cycle = this.core.World.getProcessCycle();
    if (cycle === this.lastCycle) return;
    this.lastCycle = cycle;
    this.elapsedTicks++;

    if (this.phase === PHASE.WAVE) {
      this.processCalls();
      this.processPenance();
      this.processQueen();
      this.updateAllHud();
      if (this.wave < 10 || this.queenSpawned) this.checkWaveComplete();
    } else if (this.phase === PHASE.INTERMISSION) {
      this.updateIntermission();
    }
  }

  processCalls() {
    if (this.elapsedTicks - this.waveStartTick >= data.CALL_CHANGE_TICKS
      && this.elapsedTicks - this.callTick >= data.CALL_CHANGE_TICKS) {
      this.callTick = this.elapsedTicks;
      this.chooseCalls(false);
      for (const player of this.players.keys()) player.sendMessage("The calls have changed.");
    }
  }

  processPenance() {
    for (const npc of [...this.npcs]) {
      if (!this.npcs.has(npc) || npc.getHitpoints() <= 0 || this.isStunned(npc)) continue;
      const meta = this.npcMeta.get(npc);
      if (!meta) continue;
      if (meta.type === "runner") this.processRunner(npc);
      else if (meta.type === "healer") this.processHealer(npc);
      else if (meta.type === "queen") this.processQueenNpc(npc);
      else this.processFighterOrRanger(npc, meta.type);
      this.processPoison(npc);
    }
  }

  processFighterOrRanger(npc, type) {
    const target = this.nearestPlayer(npc.getLocation());
    if (!target) return;
    if (distance(npc.getLocation(), target.getLocation()) > (type === "ranger" ? 7 : 1)) {
      this.route(npc, target.getLocation());
      return;
    }
    if (npc.getCombat?.().getTarget?.() !== target) npc.getCombat?.().attack?.(target);
  }

  processHealer(npc) {
    const runner = this.nearestNpc(npc.getLocation(), (other) => other.__baType === "runner" && other.getHitpoints() < this.maxHitpoints(other));
    if (runner && this.elapsedTicks >= (npc.__baNextAction ?? 0)) {
      const at = runner.getLocation();
      if (distance(npc.getLocation(), at) > 3) this.route(npc, at);
      else {
        npc.__baNextAction = this.elapsedTicks + 10;
        npc.setMobileInteraction?.(runner);
        npc.performGraphic?.(new this.core.Graphic(654));
        runner.heal(5);
      }
      return;
    }
    this.processFighterOrRanger(npc, "fighter");
  }

  processRunner(npc) {
    const bait = this.nearestBait(npc.getLocation());
    if (bait) {
      if (distance(npc.getLocation(), bait.location) > 1) {
        this.route(npc, bait.location);
        return;
      }
      this.eatBait(npc, bait);
      return;
    }
    const lure = location(this.arena.lureCave);
    if (distance(npc.getLocation(), lure) <= 1) {
      this.runnerEscaped(npc);
      return;
    }
    this.route(npc, lure);
  }

  nearestBait(at) {
    let best = null;
    let bestDistance = 8;
    for (const bait of this.groundBait.values()) {
      const current = distance(at, bait.location);
      if (current <= 1 || current < bestDistance) {
        best = bait;
        bestDistance = current;
      }
    }
    return best;
  }

  eatBait(npc, bait) {
    this.removeBait(bait);
    if (!bait.good) {
      npc.forceChat?.("Blughhhh.");
      npc.__baRetreatUntil = this.elapsedTicks + 6;
      this.route(npc, npc.__baHome ?? location(this.arena.caves[0]));
      return;
    }
    npc.forceChat?.("Chomp, chomp.");
    const trap = this.trapNear(npc.getLocation());
    if (trap && trap.charges > 0) {
      trap.charges--;
      this.refreshTrap(trap);
      this.killNpc(npc, this.playersForRole(data.ROLE.DEFENDER)[0]?.player ?? null);
      return;
    }
    npc.__baNextAction = this.elapsedTicks + 3;
  }

  removeBait(bait) {
    this.groundBait.delete(`${bait.location.getX()},${bait.location.getY()},${bait.location.getZ()}`);
    try { this.core.ItemOnGroundManager.deregister(bait.groundItem); } catch { /* already gone */ }
    this.groundItems.delete(bait.groundItem);
  }

  trapNear(at) {
    return this.traps.find((trap) => distance(at, trap.location) <= 1) ?? null;
  }

  refreshTrap(trap) {
    const id = trap.charges >= 2 ? data.OBJECT.RUNNER_TRAP_2 : trap.charges === 1 ? data.OBJECT.RUNNER_TRAP_1 : data.OBJECT.RUNNER_TRAP_0;
    if (trap.object) this.core.ObjectManager.deregister(trap.object, false);
    trap.object = new this.core.GameObject(id, trap.location.clone(), 22, 0, this.area);
    this.core.ObjectManager.register(trap.object, true);
  }

  runnerEscaped(npc) {
    const state = this.playersForRole(data.ROLE.DEFENDER)[0];
    if (state) state.stats.runnersEscaped++;
    for (const player of this.players.keys()) player.sendMessage("A Penance Runner escaped through the cave!");
    this.removeNpc(npc);
    const info = data.WAVES[this.wave].runner;
    this.spawnPenance("runner", info.hp);
  }

  processQueenNpc(npc) {
    npc.__baNextAction = npc.__baNextAction ?? 0;
    if (this.elapsedTicks < npc.__baNextAction) return;
    npc.__baNextAction = this.elapsedTicks + 6;
    const players = [...this.players.keys()].filter((player) => player.getHitpoints() > 0);
    if (players.length === 0) return;
    npc.performAnimation?.(new this.core.Animation(npc.getAttackAnim?.() >= 0 ? npc.getAttackAnim() : 3911));
    for (const player of players) {
      const damage = 1 + Math.floor(Math.random() * 13);
      player.getCombat().getHitQueue().addPendingDamage([new this.core.HitDamage(damage, this.core.HitMask.RED)]);
    }
  }

  processQueen() {
    if (this.wave !== 10 || this.ended) return;
    const normalAlive = [...this.npcs].some((npc) => npc.__baType && npc.getHitpoints() > 0);
    if (!this.queenSpawned && (this.elapsedTicks - this.waveStartTick >= data.QUEEN_SPAWN_TICKS || !normalAlive)) {
      this.spawnQueen();
    }
    if (!this.queen || this.queen.getHitpoints() <= 0) return;
    if (this.elapsedTicks >= this.queenNextEgg) {
      this.queenNextEgg = this.elapsedTicks + data.QUEEN_EGG_TICKS;
      this.addGroundItem([...this.players.keys()][0], data.ITEM.YELLOW_EGG, location(this.arena.trapdoor ?? this.queen.getLocation()));
    }
    if (this.queenSpawned && this.elapsedTicks >= this.queenNextSpawn) {
      this.queenNextSpawn = this.elapsedTicks + 25;
      if ([...this.npcs].filter((npc) => npc.__baType === "queenspawn" && npc.getHitpoints() > 0).length < 4) {
        const spawn = this.spawnPenance("fighter", 30, this.arena.caves[0]);
        spawn.__baType = "queenspawn";
        spawn.setNpcTransformationId?.(data.NPC.QUEEN_SPAWN);
        this.npcMeta.set(spawn, { type: "queenspawn", hp: 30 });
      }
    }
  }

  spawnQueen() {
    if (this.queenSpawned) return;
    this.queenSpawned = true;
    const queen = this.spawnNpc(data.NPC.QUEEN, this.arena.trapdoor ?? this.arena.spawn);
    queen.__baType = "queen";
    queen.__baNextAction = this.elapsedTicks + 6;
    this.applyPenanceStats(queen, "queen", 250);
    this.queen = queen;
    this.npcMeta.set(queen, { type: "queen", hp: 250 });
    for (const player of this.players.keys()) player.sendMessage("The Penance Queen has appeared!");
  }

  isStunned(npc) {
    return (npc.__baStunUntil ?? 0) > this.elapsedTicks;
  }

  processPoison(npc) {
    const poison = npc.__baPoison;
    if (!poison || this.elapsedTicks < poison.next) return;
    poison.next = this.elapsedTicks + 5;
    poison.ticks--;
    const damage = Math.max(1, poison.damage);
    poison.damage = Math.max(1, poison.damage - 1);
    this.damageNpc(npc, damage, null);
    if (poison.ticks <= 0) npc.__baPoison = null;
  }

  maxHitpoints(npc) {
    return npc.getDefinition?.().getHitpoints?.() ?? npc.getHitpoints();
  }

  nearestPlayer(at) {
    let best = null;
    let bestDistance = Infinity;
    for (const player of this.players.keys()) {
      if (player.getHitpoints() <= 0) continue;
      const current = distance(at, player.getLocation());
      if (current < bestDistance) {
        best = player;
        bestDistance = current;
      }
    }
    return best;
  }

  nearestNpc(at, predicate) {
    let best = null;
    let bestDistance = Infinity;
    for (const npc of this.npcs) {
      if (npc.getHitpoints() <= 0 || !predicate(npc)) continue;
      const current = distance(at, npc.getLocation());
      if (current < bestDistance) {
        best = npc;
        bestDistance = current;
      }
    }
    return best;
  }

  route(npc, at) {
    const movement = npc.getMovementQueue?.();
    if (movement?.lastDestX === at.getX() && movement?.lastDestY === at.getY() && (movement.size?.() > 0 || movement.isMovings?.())) return;
    this.core.PathFinder.calculateWalkRoute(npc, at.getX(), at.getY());
  }

  damageNpc(npc, amount, player) {
    if (!this.npcs.has(npc) || npc.getHitpoints() <= 0) return;
    if (player) npc.__baLastAttacker = player;
    npc.setHitpoints(Math.max(0, npc.getHitpoints() - amount));
    if (npc.getHitpoints() <= 0) {
      if (npc === this.queen) this.queenDied();
      else this.killNpc(npc, player);
    }
  }

  killNpc(npc, player) {
    if (!this.npcs.has(npc)) return;
    const meta = this.npcMeta.get(npc);
    this.removeNpc(npc);
    if (!meta) return;
    if (meta.type === "queen") return this.queenDied();
    if (meta.type === "queenspawn") return;
    const killer = player ?? npc.__baLastAttacker;
    const state = killer && this.players.get(killer);
    if (meta.type === "fighter" && state) state.stats.fightersKilled++;
    else if (meta.type === "ranger" && state) state.stats.rangersKilled++;
    else if (meta.type === "healer" && state) state.stats.healersKilled++;
    else if (meta.type === "runner" && state) state.stats.runnersKilled++;
    this.dropEgg(npc);
    if (this.reserve[meta.type] > 0) {
      this.reserve[meta.type]--;
      const info = data.WAVES[this.wave][meta.type];
      this.spawnPenance(meta.type, info.hp);
    }
  }

  removeNpc(npc) {
    this.npcs.delete(npc);
    this.npcMeta.delete(npc);
    npc.getCombat?.().reset?.();
    npc.getMovementQueue?.().reset?.();
    npc.setVisible?.(false);
    const addQueue = this.core.World.getAddNPCQueue();
    const removeQueue = this.core.World.getRemoveNPCQueue();
    for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
    if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
    this.area.detach?.(npc);
  }

  handleNpcDeath(npc) {
    if (!this.npcs.has(npc)) return;
    const meta = this.npcMeta.get(npc);
    if (meta?.type === "queen") return this.queenDied();
    this.killNpc(npc, npc.__baLastAttacker);
  }

  queenDied() {
    if (!this.queenSpawned || this.ended) return;
    if (this.queen) this.removeNpc(this.queen);
    this.queen = null;
    this.queenSpawned = true;
    for (const player of this.players.keys()) {
      this.api.emitCustomEvent("barbarian-assault:queen-kill", { player });
      player.sendMessage("The Penance Queen is dead!");
    }
    this.completeWave(true);
  }

  handleCanAttack(player, target, method = null) {
    if (this.ended || this.phase !== PHASE.WAVE) return true;
    const meta = this.npcMeta.get(target);
    if (!meta) return true;
    if (meta.type === "queen") {
      player.sendMessage("The Penance Queen can only be harmed by omega eggs.");
      return false;
    }
    if (meta.type === "fighter" || meta.type === "ranger") {
      const state = this.players.get(player);
      if (state?.role !== data.ROLE.ATTACKER) return true;
      if (this.isStunned(target)) return false;
      const expected = this.calls[data.ROLE.ATTACKER]?.heard;
      const style = Items.attackStyle(player, method);
      if (expected && style !== expected) {
        if (this.elapsedTicks - (state.lastWrongTick ?? -100) >= 4) {
          state.lastWrongTick = this.elapsedTicks;
          state.stats.wrongAttacks++;
          player.getCombat().getHitQueue().addPendingDamage([new this.core.HitDamage(2, this.core.HitMask.RED)]);
          player.sendMessage(`You used the wrong attack style. The ${data.CALL_LABEL[expected]} style is called.`);
        }
        return false;
      }
    }
    return true;
  }

  handleDamage(player, target, damage) {
    if (!this.npcs.has(target) || damage <= 0) return;
    target.__baLastAttacker = player;
  }

  handleGroundItem(event) {
    if (this.ended || !this.groundItems.has(event.groundItem)) return false;
    const state = this.players.get(event.player);
    if (!state) return false;
    if (data.EGG_CALL[event.groundItemId]) return this.pickEgg(event, state);
    if (event.groundItemId === data.ITEM.YELLOW_EGG) return this.pickYellowEgg(event, state);
    if (data.BAIT_CALL[event.groundItemId]) {
      // Bait is scenery for the runners; it is not picked back up.
      event.handled = true;
      return true;
    }
    return false;
  }

  pickYellowEgg(event, state) {
    if (state.role !== data.ROLE.COLLECTOR) {
      event.player.sendMessage("Only the collector can pick up the queen's eggs.");
      event.handled = true;
      return true;
    }
    try { this.core.ItemOnGroundManager.deregister(event.groundItem); } catch { /* gone */ }
    this.groundItems.delete(event.groundItem);
    if (!Items.give(event.player, data.ITEM.YELLOW_EGG, 1)) event.player.sendMessage("You have no room for the egg.");
    else event.player.sendMessage("You collect a yellow egg.");
    event.handled = true;
    return true;
  }

  emptyBag(player) {
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.COLLECTOR) return false;
    for (const call of [data.CALL.RED, data.CALL.GREEN, data.CALL.BLUE]) {
      while (state.bag[call] > 0) {
        if (!Items.give(player, data.EGG_ITEM[call], 1)) {
          player.sendMessage("You have no room to empty the bag.");
          return true;
        }
        state.bag[call]--;
      }
    }
    player.sendMessage("You empty the collection bag.");
    return true;
  }

  lookInBag(player) {
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.COLLECTOR) return false;
    const counts = [data.CALL.RED, data.CALL.GREEN, data.CALL.BLUE]
      .map((call) => `${state.bag[call]} ${call}`)
      .join(", ");
    player.sendMessage(`Your collection bag holds ${counts}.`);
    return true;
  }

  pickEgg(event, state) {
    if (state.role !== data.ROLE.COLLECTOR) {
      event.player.sendMessage("Only the collector can pick up the eggs.");
      event.handled = true;
      return true;
    }
    const call = data.EGG_CALL[event.groundItemId];
    const wanted = this.calls[data.ROLE.COLLECTOR]?.heard;
    try { this.core.ItemOnGroundManager.deregister(event.groundItem); } catch { /* gone */ }
    this.groundItems.delete(event.groundItem);
    if (call !== wanted) {
      state.stats.eggsExploded++;
      event.player.getCombat().getHitQueue().addPendingDamage([new this.core.HitDamage(5, this.core.HitMask.RED)]);
      event.player.sendMessage("The egg explodes in your hands! You were told to collect a different colour.");
      event.handled = true;
      return true;
    }
    state.stats.eggsCollected++;
    const bag = state.bag;
    const bagTotal = bag.red + bag.green + bag.blue;
    if (bagTotal < Items.collectorCapacity(event.player)) bag[call]++;
    else if (!Items.give(event.player, event.groundItemId, 1)) {
      event.player.sendMessage("You have no room for that egg.");
      event.handled = true;
      return true;
    }
    event.player.sendMessage(`You collect a ${call} egg.`);
    event.handled = true;
    return true;
  }

  handleItemOnNpc(player, npc, itemId) {
    if (this.ended || !this.npcs.has(npc)) return false;
    const meta = this.npcMeta.get(npc);
    if (!meta || meta.type !== "healer" || !data.POISON_CALL[itemId]) return false;
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.HEALER) return false;
    if (player.getInventory().getAmount(itemId) <= 0) return false;
    player.getInventory().delete(itemId, 1);
    const expected = this.calls[data.ROLE.HEALER]?.heard;
    if (data.POISON_CALL[itemId] !== expected) {
      state.stats.wrongPoisons++;
      player.sendMessage("That's the wrong type of poisoned food to use! Penalty!");
      return true;
    }
    npc.__baPoison = { ticks: 5, next: this.elapsedTicks + 5, damage: 4 };
    this.damageNpc(npc, 4, player);
    player.sendMessage("You poison the Penance Healer.");
    return true;
  }

  handleItemOnPlayer(player, target, itemId) {
    if (this.ended || !this.players.has(player) || !this.players.has(target)) return false;
    if (data.EGG_TRANSFER[itemId]) return this.transferEgg(player, target, itemId);
    if (!data.HEALING_VIALS.includes(itemId)) return false;
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.HEALER) return false;
    const dose = data.HEALING_VIALS.indexOf(itemId);
    if (dose < 0) return false;
    const amount = Items.healAmount(player);
    const before = target.getHitpoints();
    target.heal(amount);
    target.setPoisonDamage?.(0);
    target.setRunEnergy?.(Math.min(100, (target.getRunEnergy?.() ?? 0) + 20 + dose * 5));
    const targetState = this.players.get(target);
    if (targetState) targetState.medic = false;
    state.stats.hpReplenished += Math.max(0, target.getHitpoints() - before);
    player.getInventory().delete(itemId, 1);
    const next = dose + 1 < data.HEALING_VIALS.length ? data.HEALING_VIALS[dose + 1] : data.ITEM.HEALING_VIAL_EMPTY;
    Items.give(player, next, 1);
    player.sendMessage(`You heal ${target.getUsername?.() ?? "your teammate"}.`);
    return true;
  }

  /**
   * Hands a Queen egg to the next role in the chain. The egg keeps its arena
   * ownership with whoever is holding it, so finish()/leave cleanup removes it
   * from the current holder rather than the collector who first picked it up.
   */
  transferEgg(player, target, itemId) {
    const transfer = data.EGG_TRANSFER[itemId];
    const state = this.players.get(player);
    const targetState = this.players.get(target);
    if (!transfer || !state || !targetState) return false;
    if (state.role !== transfer.from) {
      player.sendMessage(`Only the ${data.ROLE_LABEL[transfer.from]} can pass that egg on.`);
      return true;
    }
    if (targetState.role !== transfer.to) {
      player.sendMessage(`Give the ${data.EGG_LABEL[itemId]} egg to the ${data.ROLE_LABEL[transfer.to]}.`);
      return true;
    }
    if (!Items.transfer(player, target, itemId, 1)) {
      if ((player.getInventory().getAmount(itemId) ?? 0) <= 0) return false;
      target.sendMessage("You have no room for that egg.");
      return true;
    }
    player.sendMessage(`You hand the ${data.EGG_LABEL[itemId]} egg to ${target.getUsername?.() ?? "your teammate"}.`);
    target.sendMessage(`${player.getUsername?.() ?? "Your teammate"} hands you the ${data.EGG_LABEL[itemId]} egg.`);
    return true;
  }

  handleItemOnItem(player, usedItemId, targetItemId) {
    if (this.ended || !this.players.has(player)) return false;
    if (this.players.get(player).role !== data.ROLE.ATTACKER) return false;
    const inventory = player.getInventory();
    const spikesOnEgg = (usedItemId === data.ITEM.SPIKES && targetItemId === data.ITEM.POISONED_EGG)
      || (usedItemId === data.ITEM.POISONED_EGG && targetItemId === data.ITEM.SPIKES);
    if (spikesOnEgg) {
      if (inventory.getAmount(data.ITEM.SPIKES) <= 0 || inventory.getAmount(data.ITEM.POISONED_EGG) <= 0) return false;
      inventory.delete(data.ITEM.SPIKES, 1);
      inventory.delete(data.ITEM.POISONED_EGG, 1);
      Items.give(player, data.ITEM.SPIKED_POISONED_EGG, 1);
      player.sendMessage("You attach the spikes to the poisoned egg.");
      return true;
    }
    return false;
  }

  handleItemOnObject(player, itemId, objectId) {
    if (this.ended || !this.players.has(player)) return false;
    const role = this.players.get(player).role;
    if (itemId === data.ITEM.YELLOW_EGG && data.OBJECT.POISON_CRATER.includes(objectId)) {
      if (role !== data.ROLE.HEALER) return false;
      return this.transformEgg(player, data.ITEM.YELLOW_EGG, data.ITEM.POISONED_EGG, "You dip the egg in the poison crater.");
    }
    if (itemId === data.ITEM.SPIKED_POISONED_EGG && data.OBJECT.LAVA_CRATER.includes(objectId)) {
      if (role !== data.ROLE.DEFENDER) return false;
      return this.transformEgg(player, data.ITEM.SPIKED_POISONED_EGG, data.ITEM.OMEGA_EGG, "You dip the egg in the lava crater. It forms an omega egg.");
    }
    if (itemId === data.ITEM.OMEGA_EGG && data.OBJECT.EGG_HOPPER.includes(objectId)) {
      if (role !== data.ROLE.COLLECTOR) return false;
      if (this.cannon.omega >= 5) {
        player.sendMessage("The hopper is full of omega eggs.");
        return true;
      }
      player.getInventory().delete(data.ITEM.OMEGA_EGG, 1);
      this.cannon.omega++;
      player.sendMessage("You load an omega egg into the hopper.");
      return true;
    }
    if (itemId === data.ITEM.HEALING_VIAL_EMPTY && objectId === data.OBJECT.HEALER_SPRING) {
      if (role !== data.ROLE.HEALER) return false;
      player.getInventory().delete(data.ITEM.HEALING_VIAL_EMPTY, 1);
      Items.give(player, data.ITEM.HEALING_VIAL_4, 1);
      player.sendMessage("You fill the healing vial.");
      return true;
    }
    return false;
  }

  transformEgg(player, from, to, message) {
    if (player.getInventory().getAmount(from) <= 0) return false;
    player.getInventory().delete(from, 1);
    Items.give(player, to, 1);
    player.sendMessage(message);
    return true;
  }

  handleObject(player, object, clickType) {
    if (this.ended || !this.players.has(player)) return false;
    const state = this.players.get(player);
    if (!state) return false;
    const id = object.getId();
    if (data.OBJECT.ATTACKER_MACHINE === id) return this.attackerMachine(player, object, clickType);
    if (data.OBJECT.DEFENDER_MACHINE === id) return this.defenderMachine(player, object, clickType);
    if (data.OBJECT.HEALER_MACHINE === id) return this.healerMachine(player, object, clickType);
    if (data.OBJECT.COLLECTOR_CONVERTER === id) return this.convertEggs(player);
    if (data.OBJECT.EGG_HOPPER.includes(id)) return this.loadCannon(player);
    if (data.OBJECT.EGG_LAUNCHER.includes(id)) return this.fireCannon(player);
    if (id === data.OBJECT.HEALER_SPRING) return this.useSpring(player);
    if (id === data.OBJECT.HORN_OF_GLORY) return this.call(player, state.calls.required);
    if (data.OBJECT.PETRIFIED_MUSHROOM.includes(id)) {
      if (state.role !== data.ROLE.ATTACKER) return false;
      if (player.getInventory().getAmount(data.ITEM.SPIKES) >= 8) {
        player.sendMessage("You already have enough spikes.");
        return true;
      }
      Items.give(player, data.ITEM.SPIKES, 1);
      player.sendMessage("You take some spikes from the mushroom.");
      return true;
    }
    if (data.OBJECT.POISON_CRATER.includes(id)) {
      if (state.role !== data.ROLE.HEALER) return false;
      return this.transformEgg(player, data.ITEM.YELLOW_EGG, data.ITEM.POISONED_EGG, "You dip the egg in the poison crater.");
    }
    if (data.OBJECT.LAVA_CRATER.includes(id)) {
      if (state.role !== data.ROLE.DEFENDER) return false;
      return this.transformEgg(player, data.ITEM.SPIKED_POISONED_EGG, data.ITEM.OMEGA_EGG, "You dip the egg in the lava crater. It forms an omega egg.");
    }
    const trap = this.traps.find((entry) => entry.object === object || entry.location.equals(object.getLocation()));
    if (trap) return this.fixTrap(player, trap);
    return false;
  }

  attackerMachine(player, object, clickType) {
    if (this.players.get(player).role !== data.ROLE.ATTACKER) return false;
    const options = object.getDefinition?.().getActions?.() ?? [];
    const option = options[clickType - 1] ?? "";
    if (option === "Take-Arrows") {
      for (const arrow of data.ARROWS) Items.give(player, arrow, 100);
      player.sendMessage("You take some arrows.");
      return true;
    }
    if (option === "Take-Runes") {
      for (const rune of [554, 555, 556, 557, 558, 560, 562, 565, 21880]) Items.give(player, rune, 500);
      player.sendMessage("You take some runes.");
      return true;
    }
    return false;
  }

  defenderMachine(player, object, clickType) {
    if (this.players.get(player).role !== data.ROLE.DEFENDER) return false;
    const options = object.getDefinition?.().getActions?.() ?? [];
    const option = options[clickType - 1] ?? "";
    const all = { "Take-Crackers": data.ITEM.CRACKERS, "Take-Tofu": data.ITEM.TOFU, "Take-Worms": data.ITEM.WORMS };
    if (option === "Stock-Up") {
      for (const item of Object.values(all)) Items.give(player, item, 8);
      player.sendMessage("You stock up on bait.");
      return true;
    }
    if (all[option]) {
      Items.give(player, all[option], 8);
      player.sendMessage("You take some bait.");
      return true;
    }
    return false;
  }

  healerMachine(player, object, clickType) {
    if (this.players.get(player).role !== data.ROLE.HEALER) return false;
    const options = object.getDefinition?.().getActions?.() ?? [];
    const option = options[clickType - 1] ?? "";
    const all = { "Take-Vial": data.ITEM.HEALING_VIAL_EMPTY, "Take-Tofu": data.ITEM.POISONED_TOFU, "Take-Worms": data.ITEM.POISONED_WORMS, "Take-Meat": data.ITEM.POISONED_MEAT };
    if (option === "Stock-Up") {
      Items.give(player, data.ITEM.HEALING_VIAL_EMPTY, 1);
      for (const item of [data.ITEM.POISONED_TOFU, data.ITEM.POISONED_WORMS, data.ITEM.POISONED_MEAT]) Items.give(player, item, 8);
      player.sendMessage("You stock up on healing supplies.");
      return true;
    }
    if (all[option]) {
      Items.give(player, all[option], 8);
      player.sendMessage("You take some supplies.");
      return true;
    }
    return false;
  }

  useSpring(player) {
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.HEALER) {
      player.sendMessage("Only the healer can use the spring.");
      return true;
    }
    const empty = player.getInventory().getAmount(data.ITEM.HEALING_VIAL_EMPTY);
    if (empty > 0) {
      player.getInventory().delete(data.ITEM.HEALING_VIAL_EMPTY, 1);
      Items.give(player, data.ITEM.HEALING_VIAL_4, 1);
      player.sendMessage("You fill the healing vial.");
      return true;
    }
    player.heal(Items.healAmount(player));
    player.setPoisonDamage?.(0);
    player.setRunEnergy?.(Math.min(100, (player.getRunEnergy?.() ?? 0) + 20));
    player.sendMessage("You drink from the spring.");
    return true;
  }

  convertEggs(player) {
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.COLLECTOR) return false;
    const chance = [0.25, 0.25, 0.4, 0.6, 0.85][Points.level(player, data.ROLE.COLLECTOR) - 1] ?? 0.25;
    let converted = 0;
    for (const [from, to] of [[data.CALL.GREEN, data.CALL.RED], [data.CALL.RED, data.CALL.GREEN], [data.CALL.BLUE, data.CALL.GREEN]]) {
      while (state.bag[from] > 0 && Math.random() <= chance) {
        state.bag[from]--;
        state.bag[to]++;
        converted++;
      }
    }
    player.sendMessage(converted > 0 ? `You convert ${converted} egg${converted === 1 ? "" : "s"}.` : "Nothing is converted.");
    return true;
  }

  loadCannon(player) {
    const state = this.players.get(player);
    if (!state || state.role !== data.ROLE.COLLECTOR) {
      player.sendMessage("Only the collector can load the hopper.");
      return true;
    }
    let loaded = 0;
    for (const call of [data.CALL.RED, data.CALL.GREEN, data.CALL.BLUE]) {
      const itemId = data.EGG_ITEM[call];
      while (this.cannon[call] < 5 && state.bag[call] > 0) {
        state.bag[call]--;
        this.cannon[call]++;
        loaded++;
      }
      while (this.cannon[call] < 5 && player.getInventory().getAmount(itemId) > 0) {
        player.getInventory().delete(itemId, 1);
        this.cannon[call]++;
        loaded++;
      }
    }
    player.sendMessage(loaded > 0 ? `You load ${loaded} egg${loaded === 1 ? "" : "s"} into the hopper.` : "You have no eggs to load.");
    return true;
  }

  fireCannon(player) {
    if (this.cannon.omega > 0 && this.queenSpawned && this.queen && this.queen.getHitpoints() > 0) {
      this.cannon.omega--;
      this.queenHits++;
      this.damageNpc(this.queen, 30 + Math.floor(Math.random() * 10), player);
      player.sendMessage("You fire an omega egg at the Penance Queen.");
      if (this.queenHits >= data.QUEEN_HITS) this.queenDied();
      return true;
    }
    const call = [data.CALL.RED, data.CALL.GREEN, data.CALL.BLUE].find((colour) => this.cannon[colour] > 0);
    if (!call) {
      player.sendMessage(this.queenSpawned ? "The cannon needs omega eggs to harm the queen." : "The cannon is empty.");
      return true;
    }
    const target = this.cannonTarget();
    if (!target) {
      player.sendMessage("There is nothing to fire at.");
      return true;
    }
    this.cannon[call]--;
    this.applyEggEffect(call, target, player);
    return true;
  }

  cannonTarget() {
    const meta = (npc) => this.npcMeta.get(npc)?.type;
    const at = this.queen?.getLocation?.()
      ?? [...this.players.keys()][0]?.getLocation?.()
      ?? location(this.arena.spawn);
    return this.nearestNpc(at, (npc) => meta(npc) === "runner")
      ?? this.nearestNpc(at, (npc) => meta(npc) === "healer")
      ?? this.nearestNpc(at, (npc) => ["fighter", "ranger", "queenspawn"].includes(meta(npc)));
  }

  applyEggEffect(call, target, player) {
    if (call === data.CALL.RED) {
      this.damageNpc(target, 3, player);
      if (Math.random() < 0.5) {
        for (const npc of this.npcs) {
          if (npc !== target && npc.getHitpoints() > 0 && distance(npc.getLocation(), target.getLocation()) <= 3) this.damageNpc(npc, 1, player);
        }
      }
      player.sendMessage("The red egg explodes.");
    } else if (call === data.CALL.GREEN) {
      this.damageNpc(target, 1, player);
      target.__baPoison = { ticks: 5, next: this.elapsedTicks + 5, damage: 1 };
      player.sendMessage("The green egg poisons the Penance.");
    } else {
      target.__baStunUntil = this.elapsedTicks + 10;
      player.sendMessage("The blue egg stuns the Penance.");
    }
  }

  fixTrap(player, trap) {
    if (this.players.get(player).role !== data.ROLE.DEFENDER) return false;
    if (trap.charges >= 2) {
      player.sendMessage("The trap is already fully repaired.");
      return true;
    }
    const inventory = player.getInventory();
    const hammer = this.core.ItemIdentifiers.HAMMER ?? 2347;
    const logs = this.core.ItemIdentifiers.LOGS ?? 1511;
    if (!inventory.contains?.(hammer) || !inventory.contains?.(logs)) {
      player.sendMessage("You need a hammer and some logs to repair the trap.");
      return true;
    }
    inventory.delete(hammer, 1);
    inventory.delete(logs, 1);
    trap.charges = 2;
    this.refreshTrap(trap);
    player.sendMessage("You repair the runner trap.");
    return true;
  }

  handleBaitDrop(player, itemId) {
    const state = this.players.get(player);
    if (this.ended || !state || state.role !== data.ROLE.DEFENDER || !data.BAIT_CALL[itemId]) return false;
    if (player.getInventory().getAmount(itemId) <= 0) return false;
    const at = player.getLocation().clone();
    const key = `${at.getX()},${at.getY()},${at.getZ()}`;
    if (this.groundBait.has(key)) {
      player.sendMessage("There is already bait here.");
      return true;
    }
    player.getInventory().delete(itemId, 1);
    const good = this.calls[data.ROLE.DEFENDER]?.heard === data.BAIT_CALL[itemId];
    const groundItem = this.addGroundItem(player, itemId, at);
    this.groundBait.set(key, { itemId, good, groundItem, location: at });
    player.sendMessage(good ? "You drop the called bait." : "You drop bait that is not currently called.");
    return true;
  }

  updateAllHud() {
    for (const player of this.players.keys()) this.updateHud(player);
  }

  updateHud(player, force = false) {
    const state = this.players.get(player);
    if (!state || this.ended) return;
    const calls = state.calls;
    const role = state.role;
    const send = (key, value, action) => {
      if (!force && state.sent.get(key) === value) return;
      state.sent.set(key, value);
      action();
    };
    send("wave", this.wave, () => Items.setHudText(player, role, "wave", `Wave ${this.wave}`));
    send("hear", calls.heard, () => Items.setHudText(player, role, "hear", data.CALL_LABEL[calls.heard] ?? "-"));
    send("shout", calls.required, () => Items.setHudText(player, role, "shout", data.CALL_LABEL[calls.required] ?? "-"));
    send("partner", data.PARTNER[role], () => Items.setHudPartner(player, role));
    if (role === data.ROLE.HEALER) {
      const others = [...this.players.values()].filter((entry) => entry.player !== player).slice(0, 4);
      for (let i = 0; i < 4; i++) {
        const entry = others[i];
        const label = entry ? entry.player.getUsername?.() ?? "Player" : "-";
        const hp = entry ? `${Math.max(0, entry.player.getHitpoints())}/${entry.player.getSkillManager?.().getMaxLevel?.(this.core.Skill.HITPOINTS) ?? 0}` : "-";
        send(`heal-name-${i}`, label, () => player.getPacketSender().sendString(label, (data.ROLE_INTERFACE[role] << 16) | (17 + i * 4)));
        send(`heal-hp-${i}`, hp, () => player.getPacketSender().sendString(`HP ${hp}`, (data.ROLE_INTERFACE[role] << 16) | (18 + i * 4)));
        const medic = entry?.medic ? 2 : 0;
        send(`heal-medic-${i}`, medic, () => player.getPacketSender().sendInterfaceDisplayState((data.ROLE_INTERFACE[role] << 16) | (19 + i * 4), !!entry?.medic));
      }
    }
  }

  checkWaveComplete() {
    if (this.phase !== PHASE.WAVE || this.waveAwarded) return;
    if (this.wave === 10) {
      return this.queenSpawned && !this.queen && this.queenHits >= data.QUEEN_HITS ? this.completeWave(true) : undefined;
    }
    const alive = [...this.npcs].some((npc) => npc.__baType && npc.getHitpoints() > 0);
    if (!alive && Object.values(this.reserve).every((count) => count === 0)) this.completeWave(true);
  }

  completeWave(won) {
    if (this.waveAwarded || this.ended) return;
    this.waveAwarded = true;
    if (!won) return this.finish(false, "The wave was lost.");
    const rewards = this.scoreWave();
    for (const [player, state] of this.players) {
      const reward = rewards.get(player) ?? 0;
      if (this.wave >= 10) {
        const gains = Points.awardQueen(player, state.role);
        const others = data.ROLES.filter((role) => role !== state.role).map((role) => `${data.ROLE_LABEL[role]} +${gains[role] ?? 0}`).join(", ");
        player.sendMessage(`Queen bonus: ${data.ROLE_LABEL[state.role]} +${gains[state.role] ?? 0}; ${others}.`);
      } else if (reward > 0) {
        const award = { player, minigame: "barbarian-assault", points: reward };
        this.api.emitCustomEvent("minigame:points", award);
        Points.award(player, state.role, award.points);
      }
      player.sendMessage(`Wave ${this.wave} complete. You receive ${Math.max(0, reward)} Honour Points in the ${data.ROLE_LABEL[state.role]} role.`);
      state.bag = { red: 0, green: 0, blue: 0 };
      state.medic = false;
      Items.clear(player);
      Items.closeHud(player);
      this.closeTimer(player);
    }
    if (this.wave >= 10) return this.finish(true, "The Penance Queen has been defeated!");
    this.phase = PHASE.INTERMISSION;
    this.clearGroundItems();
    this.clearBait();
    this.cleanupNpcs();
    this.restoreObjects();
    this.intermissionTask = new this.core.CountdownTask(this.intermissionKey, ticks(data.INTERMISSION_SECONDS), () => {
      this.intermissionTask = null;
      if (this.ended) return;
      this.wave++;
      this.beginWave();
    });
    this.core.TaskManager.submit(this.intermissionTask);
    for (const player of this.players.keys()) {
      this.openTimer(player);
      this.updateIntermission();
    }
  }

  scoreWave() {
    const rewards = new Map();
    if (this.wave >= 10) {
      for (const [player, state] of this.players) rewards.set(player, 80);
      return rewards;
    }
    const team = { escaped: 0, wrongAttacks: 0, wrongPoisons: 0 };
    for (const state of this.players.values()) {
      team.escaped += state.stats.runnersEscaped;
      team.wrongAttacks += state.stats.wrongAttacks;
      team.wrongPoisons += state.stats.wrongPoisons;
    }
    const teamPenalty = -Math.min(10, team.escaped * 3)
      - Math.min(10, Math.max(0, team.wrongAttacks - 1))
      - Math.min(10, Math.floor(team.wrongPoisons / 4));
    for (const [player, state] of this.players) {
      let rolePoints = 0;
      switch (state.role) {
        case data.ROLE.ATTACKER:
          rolePoints = Math.max(0, state.stats.rangersKilled - 1) + Math.max(0, state.stats.fightersKilled - 1);
          break;
        case data.ROLE.COLLECTOR:
          rolePoints = Math.floor(Math.min(60, Math.max(0, state.stats.eggsCollected - state.stats.eggsExploded)) / 4.35);
          break;
        case data.ROLE.DEFENDER:
          // Escapes are -3 for the team and doubled for the defender (Wiki).
          rolePoints = Math.floor(state.stats.runnersKilled * 1.8) - Math.min(10, state.stats.runnersEscaped * 3);
          break;
        case data.ROLE.HEALER:
          rolePoints = Math.floor(state.stats.healersKilled * 0.7)
            + Math.floor(Math.min(28, state.stats.hpReplenished / 18));
          break;
        default:
          break;
      }
      let total = Math.max(0, rolePoints + teamPenalty);
      if (this.hasKandarinHard(player)) total = Math.floor(total * 1.1);
      rewards.set(player, total);
    }
    return rewards;
  }

  hasKandarinHard(player) {
    const rewards = player.getAttribute?.("achievement-diaries:rewards") ?? {};
    return Array.isArray(rewards.kandarin) && rewards.kandarin.includes("hard");
  }

  openTimer(player) {
    player.getPacketSender().sendSubInterface(data.OVERLAY_HUD_UID, data.TIMER_INTERFACE, 1);
  }

  closeTimer(player) {
    try { player.getPacketSender().closeSubInterface(data.OVERLAY_HUD_UID); } catch { /* no session */ }
  }

  updateIntermission() {
    if (!this.intermissionTask) return;
    const seconds = Math.max(0, Math.ceil((this.intermissionTask.getRemainingTicks?.() ?? 0) * 0.6));
    for (const player of this.players.keys()) {
      try { player.getPacketSender().sendString(String(seconds), (data.TIMER_INTERFACE << 16) | 4); } catch { /* no session */ }
    }
  }

  finish(won, reason) {
    if (this.ended) return;
    this.ended = true;
    this.phase = PHASE.ENDING;
    if (this.intermissionTask?.isRunning?.()) this.intermissionTask.stop();
    this.core.TaskManager.cancelTasks(this.intermissionKey);
    this.intermissionTask = null;

    for (const [player, state] of this.players) {
      if (reason) player.sendMessage(reason);
      if (won && this.wave >= 10 && state.role) {
        // The role reward was already paid in scoreWave; this is the completion line.
      }
      player.setAttribute("barbarian-assault:match", null);
      Items.clear(player);
      Items.stripRoleItems(player);
      Items.closeHud(player);
      this.closeTimer(player);
      player.getCombat?.().reset?.();
      player.setPoisonDamage?.(0);
      try {
        this.area.leave(player, false);
      } catch { /* already left */ }
      if (player.getArea?.() === this.area) player.setArea?.(null);
      player.moveTo(location({ ...data.SURFACE_RETURN }));
    }
    this.cleanupNpcs();
    this.restoreObjects();
    this.clearGroundItems();
    this.clearBait();
    const finished = [...this.players.keys()];
    this.players.clear();
    this.team.clear();
    for (const player of finished) matchByPlayer.delete(player);
    activeMatches.delete(this);
    try { this.area.destroy(); } catch { /* already destroyed */ }
    this.onFinished?.(this);
  }

  cleanupNpcs() {
    for (const npc of [...this.npcs]) this.removeNpc(npc);
    this.npcs.clear();
    this.npcMeta.clear();
  }
}

class MatchArea extends (require("../../../src/main/typescript/elvarg/game/model/areas/impl/PrivateArea").PrivateArea) {
  constructor(match) {
    super([boundary(data.ARENA.normal.bounds), boundary(data.ARENA.queen.bounds)]);
    this.match = match;
  }

  getName() { return this.match?.arena?.name ?? "Barbarian Assault"; }
  allowSummonPet() { return false; }

  /** Arena supplies must not leave the match through a teammate trade. */
  canTrade() { return false; }

  postEnter(mobile) {
    super.postEnter(mobile);
    if (mobile.isPlayer?.()) this.match.onPlayerEnter(mobile.getAsPlayer());
  }

  postLeave(mobile, logout) {
    if (mobile.isPlayer?.()) this.match.onPlayerLeave(mobile.getAsPlayer(), logout);
    super.postLeave(mobile, logout);
  }

  process(mobile) {
    this.match.processOnce();
    if (mobile.isPlayer?.()) this.match.updateHud(mobile.getAsPlayer());
  }
}

function matchFor(player) {
  return matchByPlayer.get(player) ?? null;
}

function attachCombat(api) {
  core = api.core;
  if (typeof api.registerNpcCombatMethodProvider !== "function" || typeof core.CombatMethod !== "function") return;
  class RangedPenanceMethod extends core.CombatMethod {
    type() { return core.CombatType.RANGED; }
    attackDistance() { return 7; }
    hits(character, target) { return [new core.PendingHit(character, target, this, 1)]; }
    start(character, target) {
      const animation = character.getAttackAnim?.();
      if (animation >= 0) character.performAnimation(new core.Animation(animation));
    }
  }
  api.registerNpcCombatMethodProvider?.(data.PENANCE_IDS.ranger, RangedPenanceMethod, { singleton: false });
}

module.exports = {
  attachCombat,
  BarbarianAssaultMatch,
  MatchArea,
  PHASE,
  activeMatches,
  matchFor,
  createMatch(api, team, onFinished) {
    core = api.core;
    const match = new BarbarianAssaultMatch(api, team, onFinished);
    try {
      match.start();
    } catch (error) {
      console.error("[barbarian-assault] match start failed", error);
      match.finish(false, "The game could not start. You are returned to the outpost.");
      throw error;
    }
    return match;
  },
};
