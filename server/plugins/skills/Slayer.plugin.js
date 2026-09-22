const fs = require("fs");
const path = require("path");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { EndDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");

const SLAYER_MASTERS = Object.freeze(Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(
    path.join(GameConstants.DEFINITIONS_DIRECTORY, "slayer-tasks.json"),
    "utf8"
  ))).map(([id, master]) => [id, { ...master, id: Number(id) }])
));

const TASK_ATTRIBUTE = "slayer:task";
const POINTS_ATTRIBUTE = "slayer:points";
const STREAK_ATTRIBUTE = "slayer:streak";

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

// ponytail: reward tables and quest/unlock state stay out until the Slayer
// points/streak tables are exported; assignment still tracks both as attributes.
function wrapMaster(masterData) {
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

/** Only a plain snapshot is persisted; the wrappers are rebuilt from the dump. */
function setActiveTask(player, activeTask) {
  player.setAttribute(TASK_ATTRIBUTE, activeTask
    ? {
        masterId: activeTask.getMaster().id,
        slug: activeTask.getTask().slug,
        remaining: activeTask.getRemaining(),
      }
    : null);
}

function getActiveTask(player) {
  const saved = player.getAttribute(TASK_ATTRIBUTE);
  if (!saved || !Number.isInteger(saved.masterId) || typeof saved.slug !== "string") {
    return null;
  }
  const masterData = SLAYER_MASTERS[String(saved.masterId)];
  const taskData = masterData?.tasks.find((task) => task.slug === saved.slug);
  if (!taskData) {
    return null;
  }
  return wrapActiveTask(
    wrapMaster({ id: masterData.id, name: masterData.name, basePoints: 0, consecutiveTaskPoints: [] }),
    wrapTask(taskData),
    saved.remaining
  );
}

function getPoints(player) {
  const points = player.getAttribute(POINTS_ATTRIBUTE);
  return Number.isFinite(points) ? points : 0;
}

function getStreak(player) {
  const streak = player.getAttribute(STREAK_ATTRIBUTE);
  return Number.isFinite(streak) ? streak : 0;
}

function assignTask(player, masterData) {
  const activeTask = getActiveTask(player);
  if (activeTask) {
    return `You're still hunting ${activeTask.getTask().toString()}; you have ${activeTask.getRemaining()} to go. Come back when you've finished your task.`;
  }

  const slayerLevel = player.getSkillManager().getMaxLevel(Skill.SLAYER);
  const possibleTasks = masterData.tasks.filter((task) => slayerLevel >= task.slayer_level);
  if (possibleTasks.length === 0) {
    return `${masterData.name} was unable to give you a Slayer task. Please try again later.`;
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
  setActiveTask(player, wrapActiveTask(
    wrapMaster({ id: masterData.id, name: masterData.name, basePoints: 0, consecutiveTaskPoints: [] }),
    wrapTask(selected),
    remaining
  ));
  return `Your new task is to kill ${remaining} ${selected.name.toLowerCase()}.`;
}

/** Match a master by the slugged name, then spawn id, transformed id, display name. */
function masterForNpc({ master, npcId, definitionId, npcName }) {
  const named = master
    ? Object.values(SLAYER_MASTERS).find(
        (candidate) => candidate.dialogue === master || candidate.name === master
      )
    : undefined;
  return named
    ?? SLAYER_MASTERS[String(npcId)]
    ?? SLAYER_MASTERS[String(definitionId)]
    ?? Object.values(SLAYER_MASTERS).find(
        (candidate) => candidate.name === npcName || candidate.dialogue === npcName
      )
    ?? null;
}

/** The line to show for an assignment from this NPC, or null when it assigns nothing. */
function assignTaskForNpc(player, npc) {
  const master = masterForNpc(npc ?? {});
  return master ? assignTask(player, master) : null;
}

/** The line to show for the active task's location, or false when there is no task. */
function taskTip(player) {
  const task = getActiveTask(player);
  if (!task) return false;
  const hint = task.getTask().getHint();
  return hint
    ? `You should be able to find your task at ${hint}.`
    : "You're on a Slayer task; check your task list for the details.";
}

function onNpcKilled(player, npc) {
  const task = getActiveTask(player);
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
    setActiveTask(player, task);
    return;
  }

  let rewardPoints = task.getMaster().getBasePoints();
  const streak = getStreak(player) + 1;
  player.setAttribute(STREAK_ATTRIBUTE, streak);

  for (const [requiredTasks, bonusPoints] of task.getMaster().getConsecutiveTaskPoints()) {
    if (streak % requiredTasks === 0) {
      rewardPoints = bonusPoints;
      break;
    }
  }

  player.setAttribute(POINTS_ATTRIBUTE, getPoints(player) + rewardPoints);
  player.sendMessage(
    `You have succesfully completed ${streak} slayer tasks in a row.`
  );
  player.sendMessage(
    `You earned ${rewardPoints} Slayer ${
      rewardPoints === 1 ? "point" : "points"
    }, your new total is now ${getPoints(player)}.`
  );
  setActiveTask(player, null);
}

function assignFromNpcEvent(event) {
  const line = assignTaskForNpc(event.player, event);
  if (line) event.line = line;
}

function taskTipEvent(event) {
  const line = taskTip(event.player);
  if (line) event.line = line;
}

// Show a line in the NPC's chatbox rather than a game message.
function sayAsNpc(player, npcId, text) {
  const dialogue = new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1)
  );
  player.getDialogueManager().startDialogues(dialogue);
}

// The "Assignment" right-click, caught by click slot so transformed forms whose
// cache definition drops the label (Nieve) still work. A labelled slot must say
// "Assignment"; the NPC is matched against the master dump inside the handler.
function assignFromNpcClick(event) {
  if (event.clickType !== 3) return;
  const label = event.definition?.getActions?.()?.[event.clickType - 1];
  if (label && label !== "Assignment") return;
  const message = assignTaskForNpc(event.player, {
    npcId: event.npcId,
    definitionId: event.definition?.getId?.(),
    npcName: event.definition?.getName?.(),
  });
  if (!message) return;
  event.handled = true;
  sayAsNpc(event.player, event.definition?.getId?.() ?? event.npcId, message);
}

module.exports = {
  name: "Slayer",
  // Exported for tests/slayer-assign.test.cjs; nothing else reads them.
  assignTask,
  assignTaskForNpc,
  getActiveTask,
  taskTip,
  register(api) {
    api.persistAttribute(TASK_ATTRIBUTE);
    api.persistAttribute(POINTS_ATTRIBUTE);
    api.persistAttribute(STREAK_ATTRIBUTE);

    // Cross-plugin events: the dialogue emitter fills in the line it should speak.
    api.onCustomEvent("slayer:assignment", assignFromNpcEvent);
    api.onCustomEvent("slayer:task-tip", taskTipEvent);

    // The "Assignment" click (slot 3) on any NPC; the master check lives in the
    // handler rather than the NPC's name or the option label.
    api.onNpcInteraction(assignFromNpcClick);

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
