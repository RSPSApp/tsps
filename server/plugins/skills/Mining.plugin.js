const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ItemIds, ObjectIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const DEPLETED_ROCK_ID = 2704;
const MINING_ANIMATION_INTERVAL_TICKS = 4;
let miningTick = 0;

const PICKAXES = [
  { id: ItemIds.BRONZE_PICKAXE, requiredLevel: 1, speed: 0.03, attemptIntervalTicks: 8, animation: new Animation(625) },
  { id: ItemIds.IRON_PICKAXE, requiredLevel: 1, speed: 0.05, attemptIntervalTicks: 7, animation: new Animation(626) },
  { id: ItemIds.STEEL_PICKAXE, requiredLevel: 6, speed: 0.09, attemptIntervalTicks: 6, animation: new Animation(627) },
  { id: ItemIds.BLACK_PICKAXE, requiredLevel: 11, speed: 0.11, attemptIntervalTicks: 5, animation: new Animation(627) },
  { id: ItemIds.MITHRIL_PICKAXE, requiredLevel: 21, speed: 0.13, attemptIntervalTicks: 5, animation: new Animation(628) },
  { id: ItemIds.ADAMANT_PICKAXE, requiredLevel: 31, speed: 0.16, attemptIntervalTicks: 4, animation: new Animation(629) },
  { id: ItemIds.RUNE_PICKAXE, requiredLevel: 41, speed: 0.2, attemptIntervalTicks: 3, animation: new Animation(624) },
  { id: ItemIds.DRAGON_PICKAXE, requiredLevel: 61, speed: 0.25, attemptIntervalTicks: 3, animation: new Animation(624) },
];

const PICKAXES_DESC = [...PICKAXES].sort((a, b) => b.requiredLevel - a.requiredLevel);

const ROCKS = [
  { objectName: "Clay rocks", objectIds: [9711, 9712, 9713, 15503, 15504, 15505], level: 1, xp: 5, oreId: ItemIds.CLAY, petBase: 741600, cycles: 11, respawnTicks: 2 },
  { objectName: "Copper rocks", objectIds: [7453,7484], level: 1, xp: 18, oreId: ItemIds.COPPER_ORE, petBase: 741600, cycles: 12, respawnTicks: 4 },
  { objectName: "Tin rocks", objectIds: [7485, 7486], level: 1, xp: 8, oreId: ItemIds.TIN_ORE, petBase: 741600, cycles: 12, respawnTicks: 4 },
  { objectName: "Iron rocks", objectIds: [7455, 7488], level: 15, xp: 35, oreId: ItemIds.IRON_ORE, petBase: 741600, cycles: 13, respawnTicks: 5 },
  { objectName: "Silver rocks", objectIds: [7457], level: 20, xp: 40, oreId: ItemIds.SILVER_ORE, petBase: 741600, cycles: 14, respawnTicks: 7 },
  { objectName: "Coal rocks", objectIds: [7456], level: 30, xp: 50, oreId: ItemIds.COAL, petBase: 290640, cycles: 15, respawnTicks: 7 },
  { objectName: "Gold rocks", objectIds: [7491, 9720, 9721, 9722, 11951, 11183, 11184, 11185, 2099], level: 40, xp: 65, oreId: ItemIds.GOLD_ORE, petBase: 296640, cycles: 15, respawnTicks: 10 },
  { objectName: "Mithril rocks", objectIds: [7492, 7459], level: 50, xp: 80, oreId: ItemIds.MITHRIL_ORE, petBase: 148320, cycles: 17, respawnTicks: 11 },
  { objectName: "Adamantite rocks", objectIds: [7460], level: 70, xp: 95, oreId: ItemIds.ADAMANTITE_ORE, petBase: 59328, cycles: 18, respawnTicks: 14 },
  { objectName: "Runite rocks", objectIds: [14859, 4860, 2106, 2107, 7461], level: 85, xp: 125, oreId: ItemIds.RUNITE_ORE, petBase: 42377, cycles: 23, respawnTicks: 45 },
];

// The essence mine rocks are infinite and have no level requirement.
const ESSENCE_ROCKS = [
  { objectName: "Rune Essence", objectIds: [ObjectIds.RUNE_ESSENCE_3], level: 1, xp: 5, oreId: ItemIds.PURE_ESSENCE, cycles: 1, respawnTicks: 0, infinite: true, oreMessage: "You get some essence." },
  { objectName: "Rune essence", objectIds: [ObjectIds.RUNE_ESSENCE, ObjectIds.RUNE_ESSENCE_2], level: 1, xp: 5, oreId: ItemIds.PURE_ESSENCE, cycles: 1, respawnTicks: 0, infinite: true, oreMessage: "You get some essence." },
];

const ALL_ROCKS = [...ROCKS, ...ESSENCE_ROCKS];

const ROCK_BY_NAME = new Map(ALL_ROCKS.map((rock) => [rock.objectName, rock]));
let activeSessions;
const ACTIVE_MINERS = new Set();

class RockRespawnTask extends Task {
  constructor(delayTicks, originalRockObject, depletedObject) {
    super(Math.max(1, delayTicks));
    this.originalRockObject = originalRockObject;
    this.depletedObject = depletedObject;
  }

  execute() {
    const existingDepleted = MapObjects.get(
      this.depletedObject.getId(),
      this.depletedObject.getLocation(),
      this.depletedObject.getPrivateArea()
    );
    if (existingDepleted) {
      ObjectManager.deregister(existingDepleted, true);
    }
    ObjectManager.register(this.originalRockObject, true);
    this.stop();
  }
}

function getMiningLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.MINING);
}

function findBestPickaxe(player) {
  const miningLevel = getMiningLevel(player);
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT];
  const weaponId = weapon ? weapon.getId() : -1;

  for (const pickaxe of PICKAXES_DESC) {
    if (miningLevel < pickaxe.requiredLevel) {
      continue;
    }
    if (weaponId === pickaxe.id || player.getInventory().contains(pickaxe.id)) {
      return pickaxe;
    }
  }
  return null;
}

function cyclesRequired(player, rock, pickaxe) {
  let cycles = rock.cycles + Math.floor(Math.random() * 5);
  cycles -= getMiningLevel(player) * 0.1;
  cycles -= cycles * pickaxe.speed;
  const tickBudget = Math.max(3, Math.floor(cycles));
  return Math.max(1, Math.ceil(tickBudget / pickaxe.attemptIntervalTicks));
}

function stopMining(activeSessions, player, resetAnim = true) {
  if (!activeSessions.has(player)) {
    return;
  }
  activeSessions.delete(player);
  ACTIVE_MINERS.delete(player);
  if (resetAnim) {
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  }
}

function depleteRock(rockObject, rock) {
  const depleted = new GameObject(
    DEPLETED_ROCK_ID,
    rockObject.getLocation().clone(),
    rockObject.getType(),
    rockObject.getFace(),
    rockObject.getPrivateArea()
  );
  ObjectManager.deregister(rockObject, true);
  ObjectManager.register(depleted, true);
  TaskManager.submit(new RockRespawnTask(rock.respawnTicks, rockObject, depleted));
}

function startMining(player, rockObject, rock, activeSessions) {
  const pickaxe = findBestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You don't have a pickaxe which you can use.");
    return false;
  }

  const miningLevel = getMiningLevel(player);
  if (miningLevel < pickaxe.requiredLevel) {
    player.sendMessage("You don't have a pickaxe which you have the required Mining level to use.");
    return false;
  }
  if (miningLevel < rock.level) {
    player.sendMessage(`You need a Mining level of at least ${rock.level} to mine this rock.`);
    return false;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    return false;
  }

  stopMining(activeSessions, player, false);
  activeSessions.set(player, {
    rock,
    pickaxe,
    objectId: rockObject.getId(),
    location: rockObject.getLocation().clone(),
    privateArea: rockObject.getPrivateArea(),
    cyclesUntilOre: cyclesRequired(player, rock, pickaxe),
    nextAnimationTick: miningTick + MINING_ANIMATION_INTERVAL_TICKS,
    nextOreAttemptTick: miningTick + pickaxe.attemptIntervalTicks,
    attemptIntervalTicks: pickaxe.attemptIntervalTicks,
  });
  ACTIVE_MINERS.add(player);

  player.sendMessage("You swing your pickaxe at the rock..");

  player.performAnimation(pickaxe.animation);
  return true;
}

class MiningTask extends Task {
  constructor(activeSessions) {
    super(1);
    this.activeSessions = activeSessions;
    this.cycle = 0;
  }

  execute() {
    this.cycle++;
    miningTick = this.cycle;
    for (const [player, state] of this.activeSessions) {
      if (!player || !player.isRegistered() || player.getHitpoints() <= 0) {
        this.activeSessions.delete(player);
        continue;
      }
      if (player.getMovementQueue().size() > 0 || player.getForceMovement() != null) {
        stopMining(this.activeSessions, player);
        continue;
      }

      const rockObject = MapObjects.get(
        state.objectId,
        state.location,
        state.privateArea
      );
      if (!rockObject) {
        stopMining(this.activeSessions, player);
        continue;
      }

      if (!player.getLocation().isWithinInteractionDistance(rockObject.getLocation())) {
        stopMining(this.activeSessions, player);
        continue;
      }

      const pickaxe = findBestPickaxe(player);
      if (!pickaxe || getMiningLevel(player) < state.rock.level) {
        stopMining(this.activeSessions, player);
        continue;
      }

      state.pickaxe = pickaxe;
      state.attemptIntervalTicks = pickaxe.attemptIntervalTicks;

      if (player.getInventory().isFull()) {
        player.getInventory().full();
        stopMining(this.activeSessions, player);
        continue;
      }

      if (this.cycle >= state.nextAnimationTick) {
        player.performAnimation(state.pickaxe.animation);
        state.nextAnimationTick = this.cycle + MINING_ANIMATION_INTERVAL_TICKS;
      }

      if (this.cycle < state.nextOreAttemptTick) {
        continue;
      }
      state.nextOreAttemptTick = this.cycle + state.attemptIntervalTicks;

      state.cyclesUntilOre--;
      if (state.cyclesUntilOre > 0) {
        continue;
      }

      player.getInventory().adds(state.rock.oreId, 1);
      player.sendMessage(state.rock.oreMessage ?? "You get some ores.");
      player.getSkillManager().addExperiences(Skill.MINING, state.rock.xp);
      pluginApi.emitCustomEvent("mining:success", { player, skill: Skill.MINING, petBase: state.rock.petBase });
      if (state.rock.infinite) {
        if (player.getInventory().isFull()) {
          player.getInventory().full();
          stopMining(this.activeSessions, player);
          continue;
        }
        state.cyclesUntilOre = cyclesRequired(player, state.rock, pickaxe);
        continue;
      }
      depleteRock(rockObject, state.rock);
      stopMining(this.activeSessions, player);
    }
  }
}

let TaskManager;
let ObjectManager;
let pluginApi;

function handleMine(event) {
  const rock = ROCK_BY_NAME.get(event.definition.getName());
  if (!rock) {
    return;
  }

  const started = startMining(event.player, event.object, rock, activeSessions);
  if (started) {
    event.handled = true;
  }
}

module.exports = {
  name: "Mining",
  PICKAXES,
  PICKAXES_DESC,
  ROCKS,
  findBestPickaxe,
  isMiningActive(player) {
    return ACTIVE_MINERS.has(player);
  },
  register(api) {
    pluginApi = api;
    TaskManager = api.getTaskManager();
    ObjectManager = api.getObjectManager();
    activeSessions = new Map();
    TaskManager.submit(new MiningTask(activeSessions));

    api.onPlayerDisconnect(({ player }) => {
      stopMining(activeSessions, player, false);
    });
    api.onPlayerLevelUp(({ player }) => {
      stopMining(activeSessions, player, false);
    });

    for (const rock of ALL_ROCKS) {
      api.onObjectInteraction(rock.objectName, { Mine: handleMine });
    }

    api.log("registered", {
      rocks: ROCKS.length,
      essenceRocks: ESSENCE_ROCKS.length,
      pickaxes: PICKAXES.length,
    });
  },
};
