/**
 * One Trouble Brewing game: two teams in the real Mos Le'Harmless arena, ingredient hoppers on
 * the top floor, three boilers per base, coloured water from the enemy's flowers, rum bottles
 * rolling onto the conveyor and a 20 minute round (Wiki). Only one game runs per world, as the
 * arena is a real map; the lobby starts the next one.
 */
const Common = require("./Common.TroubleBrewing");

let current = null;

function itemIds() {
  const I = Common.core.ItemIdentifiers;
  return {
    bucket: I.BUCKET, water: I.BUCKET_OF_WATER, bowl: I.BOWL, knife: I.KNIFE,
    tinderbox: I.TINDERBOX, axe: I.BRONZE_AXE, meat: I.RAW_RAT_MEAT, logs: I.LOGS,
    redFlowers: 8938, blueFlowers: 8936, redWater: 8972, blueWater: 8974,
    sweetgrubs: 8981, scrapeyLogs: 8934, bark: 8977, bitternut: 8976,
    monkey: 8942, blueMonkey: 8943, redMonkey: 8946, rum: 8940,
    pipe: 8930, lumber: 8932, bridge: 8979, torch: I.UNLIT_TORCH,
  };
}

const ALL_ITEMS = new Set();
function gameItems() {
  if (ALL_ITEMS.size === 0) {
    const ids = itemIds();
    Object.values(ids).forEach((id) => ALL_ITEMS.add(id));
  }
  return ALL_ITEMS;
}

class Game {
  constructor(players) {
    this.members = { red: new Set(players.red ?? []), blue: new Set(players.blue ?? []) };
    this.teams = new Map();
    for (const team of Common.TEAMS) for (const player of this.members[team]) this.teams.set(player, team);
    this.states = { red: newState(), blue: newState() };
    this.contribution = new Map();
    this.elapsed = 0;
    this.over = false;
    this.starting = { red: this.members.red.size, blue: this.members.blue.size };
    this.npcs = new Set();
    this.monkeys = new Map();
    this.ground = new Set();
  }

  start() {
    current = this;
    for (const player of this.teams.keys()) this.enter(player);
    for (const tile of Common.MONKEY_SPAWNS) this.spawnMonkey(tile);
    Common.every(() => this.tick());
  }

  enter(player) {
    const team = this.teamOf(player);
    const [x, y, z] = Common.BASE[team].spawn;
    player.moveTo(new Common.core.Location(x, y, z));
    this.contribution.set(player, 0);
  }

  teamOf(player) {
    return this.teams.get(player) ?? null;
  }

  players() {
    return [...this.teams.keys()];
  }

  stateOf(team) {
    return this.states[team];
  }

  contributed(player) {
    return this.contribution.get(player) ?? 0;
  }

  addContribution(player, amount = 1) {
    if (!this.teams.has(player)) return;
    this.contribution.set(player, this.contributed(player) + amount);
  }

  /** One item into the team's matching hopper. */
  deposit(player, kind, amount = 1) {
    const team = this.teamOf(player);
    if (!team || !(kind in Common.BREW_REQUIRED)) return false;
    const state = this.stateOf(team);
    state.hoppers[kind] += amount;
    this.addContribution(player, amount);
    return true;
  }

  /** One log into one of the team's three boilers. */
  addLog(player, index, amount = 1) {
    const team = this.teamOf(player);
    if (!team) return false;
    const boiler = this.stateOf(team).boilers[index];
    if (!boiler || boiler.logs >= Common.MAX_BOILER_LOGS) {
      return true;
    }
    boiler.logs = Math.min(Common.MAX_BOILER_LOGS, boiler.logs + amount);
    return true;
  }

  lightBoiler(player, index) {
    const team = this.teamOf(player);
    if (!team) return false;
    const boiler = this.stateOf(team).boilers[index];
    if (!boiler) return false;
    if (boiler.logs <= 0) {
      return true;
    }
    if (boiler.lit) {
      return true;
    }
    boiler.burnTicks = 0;
    boiler.lit = true;
    player.getSkillManager().addExperiences(Common.core.Skill.FIREMAKING, 100);
    return true;
  }

  /** The kettle takes the player's own colour of flowers, up to ten. */
  addFlowers(player, colour, amount = 1) {
    const team = this.teamOf(player);
    if (!team) return false;
    if (colour !== team) {
      return true;
    }
    const state = this.stateOf(team);
    if (state.kettle >= Common.MAX_KETTLE_FLOWERS) {
      return true;
    }
    state.kettle = Math.min(Common.MAX_KETTLE_FLOWERS, state.kettle + amount);
    return true;
  }

  takeColouredWater(player, bowls = 1) {
    const team = this.teamOf(player);
    if (!team) return false;
    const state = this.stateOf(team);
    if (state.kettle < bowls) {
      return true;
    }
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < bowls) {
      return true;
    }
    const ids = itemIds();
    state.kettle -= bowls;
    for (let i = 0; i < bowls; i++) {
      inventory.deleteNumber(ids.bowl, 1);
      inventory.addItem(new Common.core.Item(team === "red" ? ids.redWater : ids.blueWater, 1));
    }
    return true;
  }

  canBrew(team) {
    const state = this.stateOf(team);
    if (state.brewing > 0 || state.cooldown > 0 || state.bottle) return false;
    if (!state.boilers.every((boiler) => boiler.lit && boiler.logs >= Common.MIN_BOILER_LOGS)) return false;
    return Object.entries(Common.BREW_REQUIRED).every(([kind, needed]) => state.hoppers[kind] >= needed);
  }

  consumeForBrew(team) {
    const state = this.stateOf(team);
    for (const [kind, needed] of Object.entries(Common.BREW_REQUIRED)) state.hoppers[kind] -= needed;
  }

  completeBrew(team) {
    const state = this.stateOf(team);
    const owner = [...this.members[team]][0];
    if (!owner) return;
    const [x, y, z] = Common.BASE[team].conveyor;
    const ground = Common.core.ItemOnGroundManager.registerLocation(
      owner, new Common.core.Item(itemIds().rum, 1), new Common.core.Location(x, y, z),
      owner.getPrivateArea?.() ?? null, { public: true, despawnDelay: Common.BOTTLE_LIFETIME });
    if (ground) this.ground.add(ground);
    state.bottle = ground;
    state.bottleAge = 0;
  }

  /** A player picks the bottle up and packs it: one point for the team. */
  collect(player) {
    const team = this.teamOf(player);
    if (!team) return false;
    const state = this.stateOf(team);
    if (!state.bottle) return false;
    if (this.contributed(player) <= 0) {
      return false;
    }
    try { Common.core.ItemOnGroundManager.deregister(state.bottle); } catch { /* already gone */ }
    this.ground.delete(state.bottle);
    state.bottle = null;
    state.bottleAge = 0;
    state.score++;
    return true;
  }

  spawnMonkey(tile) {
    const npc = Common.core.NPC.create(Common.core.NpcIdentifiers?.MONKEY_3 ?? 1817, Common.toLocation(tile));
    npc.__skipDefaultRespawn = true;
    npc.__troubleBrewing = this;
    Common.core.World.getAddNPCQueue().push(npc);
    this.npcs.add(npc);
    this.monkeys.set(tile.join(","), { npc, tile, respawnAt: 0 });
  }

  monkeyOf(npc) {
    for (const entry of this.monkeys.values()) if (entry.npc === npc) return entry;
    return null;
  }

  catchMonkey(player, npc) {
    const entry = this.monkeyOf(npc);
    if (!entry) return false;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      return true;
    }
    Common.core.World.getRemoveNPCQueue().push(npc);
    this.npcs.delete(npc);
    entry.npc = null;
    entry.respawnAt = this.elapsed + 10;
    inventory.addItem(new Common.core.Item(itemIds().monkey, 1));
    player.getSkillManager().addExperiences(Common.core.Skill.AGILITY, 15);
    player.getSkillManager().addExperiences(Common.core.Skill.HUNTER, 15);
    return true;
  }

  /** Move the round forward (the agent MCP's advance_time); every tick still runs normally. */
  elapse(ticks) {
    for (let i = 0; i < ticks && !this.over; i++) this.tick();
  }

  tick() {
    if (this.over) return false;
    this.elapsed++;
    const left = Common.GAME_TICKS - this.elapsed;

    for (const team of Common.TEAMS) {
      const state = this.stateOf(team);
      for (const boiler of state.boilers) {
        if (!boiler.lit || boiler.logs <= 0) continue;
        boiler.burnTicks++;
        if (boiler.burnTicks < Common.BOILER_BURN_TICKS) continue;
        boiler.burnTicks = 0;
        boiler.logs--;
        if (boiler.logs === 0) boiler.lit = false;
      }
      if (state.bottle) {
        state.bottleAge++;
        if (state.bottleAge > Common.BOTTLE_LIFETIME) {
          if (state.bottle) {
            try { Common.core.ItemOnGroundManager.deregister(state.bottle); } catch { /* gone */ }
            this.ground.delete(state.bottle);
          }
          state.bottle = null;
          state.bottleAge = 0;
          state.cooldown = 0;
        }
      }
      if (state.brewing > 0) {
        state.brewing--;
        if (state.brewing === 0) {
          this.completeBrew(team);
          state.cooldown = 57;
        }
      } else if (state.cooldown > 0) {
        state.cooldown--;
      } else if (this.canBrew(team)) {
        this.consumeForBrew(team);
        state.brewing = Common.BREW_TICKS;
      }
    }

    for (const entry of this.monkeys.values()) {
      if (entry.npc === null && this.elapsed >= entry.respawnAt) {
        const npc = Common.core.NPC.create(Common.core.NpcIdentifiers?.MONKEY_3 ?? 1817, Common.toLocation(entry.tile));
        npc.__skipDefaultRespawn = true;
        npc.__troubleBrewing = this;
        Common.core.World.getAddNPCQueue().push(npc);
        this.npcs.add(npc);
        entry.npc = npc;
      }
    }

    if (left <= 0) this.finish();
    return true;
  }

  finish() {
    if (this.over) return;
    this.over = true;
    if (current === this) current = null;
    const scores = { red: this.stateOf("red").score, blue: this.stateOf("blue").score };
    const winner = scores.red === scores.blue ? null : scores.red > scores.blue ? "red" : "blue";

    for (const player of [...this.teams.keys()]) {
      const team = this.teamOf(player);
      if (typeof player.isRegistered === "function" && !player.isRegistered()) {
        this.teams.delete(player);
        this.members[team].delete(player);
        continue;
      }
      const pieces = scores[team] * 10 + Math.min(100, this.contributed(player));
      const total = (Number(player.getAttribute(Common.PIECES_ATTRIBUTE)) || 0) + pieces;
      player.setAttribute(Common.PIECES_ATTRIBUTE, total);
      Common.api.emitCustomEvent("trouble-brewing:completed", {
        player, team, winner, score: scores[team], otherScore: scores[Common.other(team)], pieces,
      });
      clearItems(player);
      player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
      this.teams.delete(player);
      this.members[team].delete(player);
    }

    for (const ground of [...this.ground]) {
      try { Common.core.ItemOnGroundManager.deregister(ground); } catch { /* gone */ }
    }
    this.ground.clear();
    for (const npc of [...this.npcs]) {
      Common.core.World.getRemoveNPCQueue().push(npc);
    }
    this.npcs.clear();
    this.monkeys.clear();
  }

  /** Logged out or removed mid-game: no reward, but the same cleanup. */
  left(player) {
    if (!this.teams.has(player) || this.over) return;
    const team = this.teamOf(player);
    this.teams.delete(player);
    this.members[team].delete(player);
    this.contribution.delete(player);
    clearItems(player);
  }
}

function newState() {
  return {
    score: 0,
    storeLogs: Common.STORE_LOGS,
    hoppers: { bitternut: 0, sweetgrub: 0, water: 0, colour: 0, bark: 0 },
    boilers: [0, 1, 2].map(() => ({ logs: 0, lit: false, burnTicks: 0 })),
    kettle: 0,
    brewing: 0,
    cooldown: 0,
    bottle: null,
    bottleAge: 0,
  };
}

function clearItems(player) {
  const inventory = player.getInventory();
  for (const id of gameItems()) {
    const amount = inventory.getAmount(id);
    if (amount > 0) inventory.deleteNumber(id, amount);
  }
  inventory.refreshItems?.();
}

/** Every game item, for the station units. */
function items() {
  return itemIds();
}

/** The agent MCP's advance_time asks timed content to move its deadlines. */
function advanceTime({ ms, handledBy }) {
  if (!current || current.over) return;
  current.elapse(Math.max(0, Math.floor((ms ?? 0) / 600)));
  handledBy?.push("TroubleBrewing");
}

/** A bottle picked up: only its own team, and only a player who contributed, may pack it. */
function pickupRum(event) {
  if (!current) return false;
  for (const team of Common.TEAMS) {
    if (current.stateOf(team).bottle !== event.groundItem) continue;
    event.handled = true;
    if (current.teamOf(event.player) !== team) {
      return true;
    }
    current.collect(event.player);
    return true;
  }
  return false;
}

module.exports = {
  Game,
  items,
  clearItems,
  pickupRum,
  advanceTime,
  get current() { return current; },
  gameOf(player) { return current?.teams.has(player) ? current : null; },
  startNew(players) {
    const game = new Game(players);
    game.start();
    return game;
  },
};
