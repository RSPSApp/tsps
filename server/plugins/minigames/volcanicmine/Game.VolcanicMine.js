/**
 * A Volcanic Mine game, as recorded (rsprox 1858):
 *
 * - One game a world. The first player down makes it: an instance of the mine (3776-3839 x
 *   10112-10239, every plane) and a 51-tick dormant lobby. Anyone who comes down then joins; once
 *   the volcano awakens Pete turns newcomers away until the game is over.
 * - 1000 ticks to play: the time on the HUD every 6 ticks, the vents' gas every 10, the mine's
 *   stability every 25. At 50 left "The volcano is going to erupt soon!" drops stability to 5; at 0
 *   the volcano erupts and kills anyone still inside (Wiki). At 0 stability the mine collapses.
 * - The exit ladder pays: Mining XP for the game's points and the points for Pete's shop.
 */
const Common = require("./Common.VolcanicMine");

const CHUNK = 8;
const VENTS = ["A", "B", "C"];

let current = null;
let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class VolcanicMineArea extends TemplatedInstanceArea {
    constructor(game) {
      const { source, widthChunks, heightChunks } = Common.data.instance;
      super(widthChunks, heightChunks);
      this.game = game;
      this.origin = source;
      this.spawned = [];
      for (const plane of [0, 1, 2, 3]) {
        for (let cx = 0; cx < widthChunks; cx++) {
          for (let cy = 0; cy < heightChunks; cy++) {
            this.setChunk(plane, cx, cy, { sourceChunkX: source[0] / CHUNK + cx, sourceChunkY: source[1] / CHUNK + cy, sourcePlane: plane, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "Volcanic Mine";
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return true;
    }

    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) this.game?.left(mobile, logout);
      super.postLeave(mobile, logout);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const npc of this.spawned) {
        npc.__skipDefaultRespawn = true;
        Common.api.removeNpc(npc);
      }
      this.spawned = [];
      super.destroy();
    }
  };
  return AreaClass;
}

class Game {
  constructor() {
    this.area = new (areaClass())(this);
    this.players = new Set();
    this.phase = "lobby";
    this.ticks = 0;
    this.remaining = Common.data.timing.lobby - 1;
    this.stability = Common.data.stability.start;
    this.gas = {};
    this.known = {};
    for (const vent of VENTS) {
      this.gas[vent] = Common.randomInt(...Common.data.gas.start);
      this.known[vent] = false;
    }
    this.blocked = 0;
    this.points = new Map();
    this.capPoints = new Map();
    this.leaving = new Set();
    this.ended = false;
    this.collapsing = false;
    this.warned = false;
    this.rocks = new Map();
    this.boulder = null;
    /** Locs placed over the cache map, by "x,y,z,type". */
    this.placed = new Map();
    /** Each player's current action (clearing, mining): a new one ends the old. */
    this.actions = new Map();
    const { Task, TaskManager } = Common.core;
    const game = this;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        if (game.ended) {
          this.stop();
          return;
        }
        game.tick();
      }
    })());
  }

  // ------------------------------------------------------------------ players

  /** Into the dormant lobby, as recorded in one tick: the vessel, the lines, the instance, the music, the HUD. */
  join(player) {
    const { data } = Common;
    this.players.add(player);
    this.points.set(player, 0);
    this.capPoints.set(player, 0);
    player.getInventory().adds(data.items.vessel, 1);
    player.setAttribute("volcanic-mine:vessel", true);
    player.setAttribute("volcanic-mine:throws", data.water.throws);
    player.sendMessage(Common.message("vessel"));
    player.sendMessage(Common.message("dormant"));
    if (!player.getAttribute(data.attributes.visited)) {
      player.setAttribute(data.attributes.visited, true);
      Common.varbit(player, "visited", 1);
    }
    this.moving = true;
    this.area.enter(player);
    player.moveTo(this.area.at(data.tiles.start));
    this.moving = false;
    player.setAttribute(data.attributes.return, true);
    Common.song(player, "mine");
    Common.openHud(player);
    Common.varbit(player, "time", this.remaining);
    Common.varbit(player, "progress", this.phase === "lobby" ? 1 : 2);
    Common.varbit(player, "stability", this.stability);
    Common.varbit(player, "points", 0);
    Common.later(1, () => {
      if (!this.players.has(player)) return;
      for (const p of this.players) Common.varbit(p, "players", this.players.size);
      for (const vent of VENTS) this.sendVent(player, vent);
      Common.varbit(player, "chambers", this.blocked);
    });
  }

  addPoints(player, amount, cap = false) {
    if (!this.players.has(player) || amount <= 0) return;
    if (cap) {
      const used = this.capPoints.get(player) ?? 0;
      amount = Math.min(amount, Common.data.points.capCap - used);
      if (amount <= 0) return;
      this.capPoints.set(player, used + amount);
    }
    const points = (this.points.get(player) ?? 0) + amount;
    this.points.set(player, points);
    Common.varbit(player, "points", points);
  }

  /** The exit ladder (recorded): the HUD reset, Pete's line, out to the entrance, the reward. */
  exit(player) {
    if (!this.players.has(player) || this.leaving.has(player)) return;
    if (this.collapsing || (this.phase !== "running" && this.phase !== "lobby")) return;
    this.leaving.add(player);
    const { data } = Common;
    Common.animate(player, "ladder");
    Common.later(1, () => {
      // A collapse, the eruption or a death since the click keeps them in.
      const still = this.phase === "running" || this.phase === "lobby";
      if (!this.players.has(player) || this.collapsing || this.ended || !still || (player.getHitpoints?.() ?? 1) <= 0) {
        this.leaving.delete(player);
        return;
      }
      const points = this.points.get(player) ?? 0;
      this.remove(player);
      this.moving = true;
      player.moveTo(Common.toLocation(data.tiles.out));
      this.moving = false;
      Common.song(player, "outside");
      const reward = Math.round((points * Common.maxLevel(player, "MINING")) / data.xp.rewardDivisor);
      Common.xp(player, "MINING", reward);
      const attribute = data.attributes.shopPoints;
      const award = { player, minigame: "volcanic-mine", points };
      Common.api.emitCustomEvent("minigame:points", award);
      player.setAttribute(attribute, Math.min(data.points.balanceCap, (Number(player.getAttribute(attribute)) || 0) + award.points));
      Common.chat(player, [["npc", Common.message("reward")]]);
      this.leaving.delete(player);
    });
  }

  /** Out of the game (any way): the HUD and the game's items go; the points are kept only by `exit`. */
  remove(player) {
    if (!this.players.delete(player)) return;
    const { data } = Common;
    this.points.delete(player);
    this.capPoints.delete(player);
    player.setAttribute(data.attributes.return, null);
    player.setAttribute("volcanic-mine:throws", null);
    for (const name of ["chambers", "players", "stability", "ventA", "ventB", "ventC", "progress", "points"]) Common.varbit(player, name, 0);
    Common.closeHud(player);
    removeGameItems(player);
    for (const p of this.players) Common.varbit(p, "players", this.players.size);
    this.actions.delete(player);
    if (this.players.size === 0) this.end();
  }

  /** The player left the instance some other way (a teleport, death, logging out): no reward. */
  left(player, logout) {
    if (this.moving || !this.players.has(player)) return;
    if (logout) player.setLocation(Common.toLocation(Common.data.tiles.out));
    this.remove(player);
  }

  // ------------------------------------------------------------------ the mine

  sendVent(player, vent) {
    Common.varbit(player, `vent${vent}`, this.known[vent] ? this.gas[vent] : Common.data.unknownGas);
  }

  reveal(vent) {
    this.known[vent] = true;
    for (const player of this.players) this.sendVent(player, vent);
  }

  setBlocked(chamber, blocked) {
    const { bit } = Common.data.chambers[chamber];
    this.blocked = blocked ? this.blocked | bit : this.blocked & ~bit;
    for (const player of this.players) Common.varbit(player, "chambers", this.blocked);
  }

  isBlocked(chamber) {
    return (this.blocked & Common.data.chambers[chamber].bit) !== 0;
  }

  /**
   * A loc in the instance, swapped for `id` (a chamber, a rock, a lava crust). The cache map's own
   * loc of the same type on the tile stops blocking (a crust over lava is walkable); putting the
   * cache's own loc back blocks again.
   */
  setLoc(id, tile, type = 10, face = 0) {
    const { GameObject, ObjectManager, RegionManager } = Common.core;
    const at = this.area.at(tile);
    const template = this.area.getTemplateObjects(at).find((o) => o.getType() === type);
    const key = `${Common.key(...tile)},${type}`;
    if (template && !this.placed.has(key)) RegionManager.removeObjectClipping(template);
    const object = new GameObject(id, at, type, face, this.area);
    ObjectManager.register(object, true);
    this.placed.set(key, object);
    return object;
  }

  /** Takes a placed loc out of the instance; the cache map's locs under it block again. */
  removeLoc(object) {
    if (!object) return;
    const { ObjectManager, RegionManager, CacheDefinitions, World } = Common.core;
    ObjectManager.deregister(object, true);
    // A placed loc isn't the map's: the engine's removed-object list (kept to re-hide map locs)
    // would otherwise unclip its whole footprint again when the next loc goes on its tile.
    const removed = World.getRemovedObjects?.();
    if (removed) {
      const index = removed.indexOf(object);
      if (index >= 0) removed.splice(index, 1);
    }
    const tile = this.area.templateOf(object.getLocation());
    for (const [key, placed] of this.placed) if (placed === object) this.placed.delete(key);
    const definition = CacheDefinitions.getObject?.(object.getId());
    const width = Math.max(1, definition?.sizeX ?? 1);
    const length = Math.max(1, definition?.sizeY ?? 1);
    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < length; dy++) {
        const spot = [tile[0] + dx, tile[1] + dy, tile[2]];
        for (const template of this.area.getTemplateObjects(this.area.at(spot))) {
          if (this.placed.has(`${Common.key(...spot)},${template.getType()}`)) continue;
          RegionManager.addObjectClipping(template);
        }
      }
    }
  }

  /** Starts a player's action; `current(token)` is false once another action starts. */
  act(player) {
    const token = {};
    this.actions.set(player, token);
    return (check) => this.actions.get(player) === check;
  }

  // ------------------------------------------------------------------ the clock

  tick() {
    this.ticks++;
    const { timing } = Common.data;
    if (this.phase === "lobby") {
      this.remaining = Math.max(0, this.remaining - 1);
      if (this.ticks === 1 || this.ticks % timing.timeEvery === 0) this.sendAll("time", this.remaining);
      if (this.ticks >= timing.lobby) this.start();
      return;
    }
    if (this.phase !== "running") return;
    this.remaining = Math.max(0, this.remaining - 1);
    const since = this.ticks - this.startedAt;
    if (this.ticks % timing.timeEvery === 0) this.sendAll("time", this.remaining);
    if (since % timing.ventEvery === 0) this.driftVents();
    if (since === timing.shift) this.shiftGas();
    if (!this.collapsing && this.phase === "running") for (const hook of tickHooks) hook(this, since);
    if (!this.warned && since % timing.stabilityEvery === 0) this.updateStability();
    if (!this.warned && this.remaining <= timing.warning) this.warn();
    if (this.remaining <= 0) this.erupt();
  }

  sendAll(name, value) {
    for (const player of this.players) Common.varbit(player, name, value);
  }

  /** The volcano awakens (recorded): the line, chambers set out, 1000 ticks on the clock. */
  start() {
    const { data } = Common;
    this.phase = "running";
    this.startedAt = this.ticks;
    this.remaining = data.timing.game;
    // Recorded starts had one chamber blocked, or none.
    const chambers = Object.keys(data.chambers);
    const pick = Common.randomInt(0, chambers.length);
    for (const [index, name] of chambers.entries()) {
      const blocked = index === pick;
      this.setBlocked(name, blocked);
      const { tile } = data.chambers[name];
      if (!blocked) this.setLoc(data.locs.chamberOpen, tile);
    }
    for (const player of this.players) {
      player.sendMessage(Common.message("awakens"));
      Common.varbit(player, "progress", 2);
      Common.varbit(player, "time", this.remaining);
      Common.sound(player, "awaken");
    }
    for (const hook of startHooks) hook(this);
  }

  driftVents() {
    const { gas } = Common.data;
    for (const vent of VENTS) {
      const change = this.isBlocked(vent) ? Common.randomInt(...gas.blockedRise) : -Common.randomInt(...gas.openFall);
      this.gas[vent] = Math.max(0, Math.min(100, this.gas[vent] + change));
      for (const player of this.players) this.sendVent(player, vent);
    }
  }

  /** Wiki: after 5 minutes the mine shifts and every chamber's gas re-randomises. */
  shiftGas() {
    for (const player of this.players) player.sendMessage(Common.message("shift"));
    for (const vent of VENTS) {
      this.gas[vent] = Common.randomInt(...Common.data.gas.start);
      this.known[vent] = false;
      for (const player of this.players) this.sendVent(player, vent);
    }
  }

  updateStability() {
    const { band, inBand, safe, perStep, maxFall } = Common.data.stability;
    let change = 0;
    for (const vent of VENTS) {
      const gas = this.gas[vent];
      if (gas >= band[0] && gas <= band[1]) change += inBand;
      else if (gas < safe[0] || gas > safe[1]) {
        change -= Math.min(maxFall, Math.ceil((gas < safe[0] ? safe[0] - gas : gas - safe[1]) / perStep));
      }
    }
    for (const hook of stabilityHooks) change += hook(this) ?? 0;
    this.setStability(this.stability + Math.round(change));
  }

  setStability(value) {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    if (next !== this.stability) {
      this.stability = next;
      this.sendAll("stability", next);
    }
    if (next === 0 && !this.collapsing) this.collapse();
  }

  warn() {
    this.warned = true;
    for (const player of this.players) {
      player.sendMessage(Common.message("eruptSoon"));
      Common.varbit(player, "progress", 3);
    }
    this.setStability(5);
  }

  /** Recorded (1858 T2697): the collapse line, the explosions, then death for everyone inside. */
  collapse() {
    this.collapsing = true;
    const { Graphic } = Common.core;
    for (const player of this.players) {
      player.sendMessage(Common.message("collapse"));
      const here = player.getLocation();
      for (let i = 0; i < 6; i++) {
        const tile = new Common.core.Location(here.getX() + Common.randomInt(-2, 2), here.getY() + Common.randomInt(-2, 2), here.getZ());
        player.getPacketSender().sendGraphic(new Graphic(Common.data.graphics.explosion, 0, 0), tile);
      }
    }
    Common.later(Common.data.timing.collapseDeath, () => this.killAll());
  }

  /** Wiki: when the timer runs out the volcano erupts and kills anyone still inside. */
  erupt() {
    this.phase = "over";
    for (const player of this.players) player.sendMessage(Common.message("erupted"));
    this.killAll();
    // Anyone the eruption didn't kill (an admin) is put out with nothing.
    Common.later(5, () => {
      for (const player of [...this.players]) {
        this.remove(player);
        player.moveTo(Common.toLocation(Common.data.tiles.out));
      }
      this.end();
    });
  }

  killAll() {
    for (const player of [...this.players]) Common.hurt(player, player.getHitpoints?.() ?? 99);
    if (this.players.size === 0) this.end();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.phase = "over";
    if (current === this) current = null;
    for (const hook of endHooks) hook(this);
    const { ObjectManager } = Common.core;
    for (const object of this.placed.values()) ObjectManager.deregister(object, false);
    this.placed.clear();
    Common.later(5, () => {
      if (!this.area.isDestroyed()) this.area.destroy();
    });
  }
}

/** The game's own items: the vessel Pete gave, the large rocks, the fragments (also worn). */
function removeGameItems(player) {
  const { data } = Common;
  const inventory = player.getInventory();
  const ids = [data.items.rock, ...Object.values(data.items.fragments)];
  for (const id of ids) {
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.delete(id, amount);
  }
  if (player.getAttribute("volcanic-mine:vessel")) {
    player.setAttribute("volcanic-mine:vessel", null);
    if (inventory.getAmount(data.items.vessel) > 0) inventory.delete(data.items.vessel, 1);
    else {
      const equipment = player.getEquipment?.();
      const slot = Common.core.Equipment?.WEAPON_SLOT;
      if (equipment && slot != null && equipment.getItems()[slot]?.getId?.() === data.items.vessel) {
        equipment.setItem(slot, new Common.core.Item(-1, 0));
        equipment.refreshItems?.();
      }
    }
  }
}

/** Recorded: on a death in the mine the vessel, rocks and fragments are gone, not in the grave. */
function beforeDeath(event) {
  if (gameOf(event.player)) removeGameItems(event.player);
}

const startHooks = [];
const stabilityHooks = [];
const tickHooks = [];
const endHooks = [];

function gameOf(player) {
  return current && current.players.has(player) ? current : null;
}

/** The game a player coming down joins: the lobby's, or a new one; null while one is running. */
function joinable() {
  if (current && (current.ended || current.area.isDestroyed())) current = null;
  if (current && current.phase === "lobby") return current;
  if (current && !current.ended && current.players.size > 0) return null;
  current = new Game();
  return current;
}

/** A player saved mid-game (the server stopped) is back at the entrance. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.data.attributes.return) || gameOf(player)) return;
  player.setAttribute(Common.data.attributes.return, null);
  player.moveTo(Common.toLocation(Common.data.tiles.out));
}

function attachGame(api) {
  api.onPlayerLogin(recoverOnLogin);
  api.onPlayerBeforeDeath?.(beforeDeath);
}

module.exports = {
  attachGame, gameOf, joinable, Game, VENTS,
  onStart: (hook) => startHooks.push(hook),
  onStability: (hook) => stabilityHooks.push(hook),
  onTick: (hook) => tickHooks.push(hook),
  onEnd: (hook) => endHooks.push(hook),
  get current() {
    return current;
  },
  reset() {
    current = null;
  },
};
