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

function newState() {
  return {
    hoppers: Object.fromEntries(Object.keys(Common.BREW_REQUIRED).map((k) => [k, 0])),
    boilers: [
      { logs: 0, lit: false, burnTicks: 0 },
      { logs: 0, lit: false, burnTicks: 0 },
      { logs: 0, lit: false, burnTicks: 0 }
    ],
    kettle: 0,
    brewing: 0,
    cooldown: 0,
    bottle: null,
    bottleAge: 0,
    score: 0,
  };
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

  tick() {
    if (this.over) return;
    this.elapsed++;

    if (this.elapsed >= Common.GAME_DURATION) {
      this.end();
      return;
    }

    for (const team of Common.TEAMS) {
      const state = this.stateOf(team);

      for (const boiler of state.boilers) {
        if (boiler.lit) {
          boiler.burnTicks++;
          if (boiler.burnTicks >= Common.BOILER_BURN_TICKS) {
            boiler.logs = Math.max(0, boiler.logs - 1);
            boiler.burnTicks = 0;
            if (boiler.logs <= 0) {
              boiler.lit = false;
            }
          }
        }
      }

      if (state.brewing > 0) {
        state.brewing--;
        if (state.brewing <= 0) {
          this.completeBrew(team);
          state.cooldown = Common.BREW_COOLDOWN;
        }
      } else if (state.cooldown > 0) {
        state.cooldown--;
      } else if (!state.bottle && this.canBrew(team)) {
        this.consumeForBrew(team);
        state.brewing = Common.BREW_TIME_TICKS;
      }

      if (state.bottle) {
        state.bottleAge++;
        if (state.bottleAge >= Common.BOTTLE_LIFETIME) {
          try { Common.core.ItemOnGroundManager.deregister(state.bottle); } catch { /* ignore */ }
          this.ground.delete(state.bottle);
          state.bottle = null;
          state.bottleAge = 0;
        }
      }
    }

    for (const [key, entry] of this.monkeys.entries()) {
      if (!entry.npc && this.elapsed >= entry.respawnAt) {
        const tile = Common.MONKEY_SPAWNS.find(t => t.join(",") === key) || Common.MONKEY_SPAWNS[0];
        this.spawnMonkey(tile);
      }
    }
  }

  end() {
    this.over = true;
    current = null;
    for (const groundItem of this.ground) {
      try { Common.core.ItemOnGroundManager.deregister(groundItem); } catch { /* ignore */ }
    }
    this.ground.clear();
    for (const npc of this.npcs) {
      Common.core.World.getRemoveNPCQueue().push(npc);
    }
    this.npcs.clear();

    const redScore = this.states.red.score;
    const blueScore = this.states.blue.score;

    for (const player of this.teams.keys()) {
      const team = this.teamOf(player);
      const won = (team === "red" && redScore > blueScore) || (team === "blue" && blueScore > redScore);
      const reward = won ? 4 : (redScore === blueScore ? 2 : 1);
      
      const [x, y, z] = Common.LOBBY_SPAWN;
      player.moveTo(new Common.core.Location(x, y, z));
      
      if (typeof player.getPacketSender?.()?.sendMessage === "function") {
        player.getPacketSender().sendMessage(`The game has ended! Red: ${redScore}, Blue: ${blueScore}. You earned ${reward} Pieces of Eight.`);
      }
      
      const inv = player.getInventory();
      if (inv) {
        inv.addItem(new Common.core.Item(Common.PIECES_OF_EIGHT, reward));
      }
    }
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

  deposit(player, kind, amount = 1) {
    const team = this.teamOf(player);
    if (!team || !(kind in Common.BREW_REQUIRED)) return false;
    const state = this.stateOf(team);
    state.hoppers[kind] += amount;
    this.addContribution(player, amount);
    return true;
  }

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
    if (boiler.logs <= 0 || boiler.lit) {
      return true;
    }
    boiler.burnTicks = 0;
    boiler.lit = true;
    player.getSkillManager().addExperiences(Common.core.Skill.FIREMAKING, 100);
    return true;
  }

  addFlowers(player, colour, amount = 1) {
    const team = this.teamOf(player);
    if (!team || colour !== team) {
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
    const npc = Common.core.NPC.create(Common.core.NpcIdentifiers?.MONKEY_3 || 1817, Common.toLocation(tile));
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
    this.addContribution(player, 1);
    return true;
  }
}

module.exports = { Game, gameItems, itemIds, getCurrent: () => current };