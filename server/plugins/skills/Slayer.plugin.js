const fs = require("fs");
const path = require("path");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");

const SLAYER_MASTERS = Object.freeze(JSON.parse(fs.readFileSync(
  path.join(GameConstants.DEFINITIONS_DIRECTORY, "slayer-tasks.json"),
  "utf8"
)));

function initializePlayerSlayerState(player) {
  if (typeof player.getSlayerPoints === "function" && !Number.isFinite(player.getSlayerPoints())) {
    player.setSlayerPoints(0);
  }
  if (typeof player.getConsecutiveTasks === "function" && !Number.isFinite(player.getConsecutiveTasks())) {
    player.setConsecutiveTasks(0);
  }
}

function wrapTask(taskData) {
  return {
    ...taskData,
    name: taskData.name.toLowerCase(),
    min: taskData.quantity[0],
    max: taskData.quantity[1],
    slayerLevel: taskData.slayer_level,
    weight: taskData.weight,
    npcNames: taskData.npc_names,
    getHint() {
      return this.locations?.[0] ?? "";
    },
    getNpcNames() {
      return this.npcNames;
    },
    toString() {
      return this.name;
    },
  };
}

function wrapMaster(masterData) {
  // ponytail: task assignment only; reward tables and quest/unlock state stay out
  // until the server has those player-state hooks.
  return {
    ...masterData,
    getBasePoints() {
      return this.basePoints;
    },
    getConsecutiveTaskPoints() {
      return this.consecutiveTaskPoints;
    },
  };
}

function wrapActiveTask(master, task, remaining) {
  return {
    master,
    task,
    remaining,
    getMaster() {
      return this.master;
    },
    getTask() {
      return this.task;
    },
    getRemaining() {
      return this.remaining;
    },
    setRemaining(value) {
      this.remaining = value;
    },
  };
}

function assignTask(player, masterData) {
  if (player.getSlayerTask()) {
    player
      .getPacketSender()
      .sendInterfaceRemoval()
      .sendMessage("You already have a Slayer task.");
    return false;
  }

  const slayerLevel = player.getSkillManager().getMaxLevel(Skill.SLAYER);
  const possibleTasks = masterData.tasks.filter((task) => slayerLevel >= task.slayer_level);
  if (possibleTasks.length === 0) {
    player
      .getPacketSender()
      .sendInterfaceRemoval()
      .sendMessage(
        `${masterData.name} was unable to give you a Slayer task. Please try again later.`
      );
    return false;
  }

  let roll = Misc.getRandom(
    possibleTasks.reduce((sum, task) => sum + task.weight, 0) - 1
  );
  let selected = possibleTasks[possibleTasks.length - 1];
  for (const task of possibleTasks) {
    if (roll < task.weight) {
      selected = task;
      break;
    }
    roll -= task.weight;
  }

  const remaining = Misc.randomInclusive(selected.quantity[0], selected.quantity[1]);
  player.setSlayerTask(wrapActiveTask(
    wrapMaster({ name: masterData.name, basePoints: 0, consecutiveTaskPoints: [] }),
    wrapTask(selected),
    remaining
  ));
  return true;
}

function onNpcKilled(player, npc) {
  const task = player.getSlayerTask();
  if (!task) {
    return;
  }

  const npcName = npc?.getDefinition?.()?.getName?.();
  if (!npcName) {
    return;
  }
  const normalized = npcName.toLowerCase();
  const isTaskNpc = task
    .getTask()
    .getNpcNames()
    .some((name) => name === normalized);
  if (!isTaskNpc) {
    return;
  }

  player
    .getSkillManager()
    .addExperiences(Skill.SLAYER, npc.getDefinition().getHitpoints());
  task.setRemaining(task.getRemaining() - 1);

  if (task.getRemaining() > 0) {
    return;
  }

  let rewardPoints = task.getMaster().getBasePoints();
  player.setConsecutiveTasks(player.getConsecutiveTasks() + 1);

  for (const [requiredTasks, bonusPoints] of task.getMaster().getConsecutiveTaskPoints()) {
    if (player.getConsecutiveTasks() % requiredTasks === 0) {
      rewardPoints = bonusPoints;
      break;
    }
  }

  player.setSlayerPoints(player.getSlayerPoints() + rewardPoints);
  player.sendMessage(
    `You have succesfully completed @dre@${player.getConsecutiveTasks()}@bla@ slayer tasks in a row.`
  );
  player.sendMessage(
    `You earned @dre@${rewardPoints}@bla@ Slayer ${
      rewardPoints === 1 ? "point" : "points"
    }, your new total is now @dre@${player.getSlayerPoints()}.`
  );
  player.setSlayerTask(null);
}

module.exports = {
  name: "Slayer",
  register(api) {
    api.onPlayerLogin(({ player }) => {
      initializePlayerSlayerState(player);
    });

    api.onAnyNpcInteraction({
      Assignment: (event) => {
        const master = SLAYER_MASTERS[String(event.npcId)];
        if (!master) return false;
        assignTask(event.player, master);
        return true;
      },
    });

    api.onNpcDeath(({ killer, npc }) => {
      if (!killer || !killer.isPlayer?.()) {
        return;
      }
      onNpcKilled(killer, npc);
    });

    api.log("registered", {
      masters: new Set(Object.values(SLAYER_MASTERS).map((master) => master.name)).size,
      tasks: new Set(Object.values(SLAYER_MASTERS).flatMap((master) => master.tasks.map((task) => task.slug))).size,
    });
  },
};
