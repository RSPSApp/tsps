/**
 * The Edgeville Dungeon's diary tasks: the obstacle pipe (Varrock hard), a Slayer task from
 * Vannaka (Varrock medium) and an Earth warrior in its Wilderness part (Wilderness easy).
 */
const Common = require("./Common.EdgevilleDungeon");

const task = (player, { diary, task: key }) => Common.api.emitCustomEvent("diary:task", { player, diary, task: key });

/** Varrock hard: the obstacle pipe between the dungeon and the Varrock Sewers. */
function pipeSqueezed({ player, objectId, location }) {
  const pipe = Common.data.diary.pipe;
  if (objectId === pipe.object && location?.y === pipe.y && location.x >= pipe.minX && location.x <= pipe.maxX) task(player, pipe);
}

/** Varrock medium: a Slayer task from Vannaka. */
function taskAssigned({ player, master }) {
  const vannaka = Common.data.diary.vannaka;
  if (master === vannaka.master) task(player, vannaka);
}

/** Wilderness easy: an Earth warrior in the dungeon's Wilderness part. */
function npcKilled({ killer, npc }) {
  const warrior = Common.data.diary.earthWarrior;
  if (!killer?.isPlayer?.() || npc?.getDefinition?.()?.getName?.() !== warrior.name) return;
  const at = npc.getLocation();
  const { minX, maxX, minY, maxY } = warrior.area;
  if (at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY) task(killer, warrior);
}

function attach(api) {
  api.onNpcDeath(npcKilled);
  api.onCustomEvent("agility:obstacle", pipeSqueezed);
  api.onCustomEvent("slayer:task-assigned", taskAssigned);
}

module.exports = attach;
Object.assign(module.exports, { pipeSqueezed, taskAssigned, npcKilled });
