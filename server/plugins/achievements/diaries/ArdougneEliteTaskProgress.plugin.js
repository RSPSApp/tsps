const MANTA_TASK = "catch-a-manta-ray-in-the-fishing-trawler-and-coo";
const CROSSBOW_TASK = "make-a-rune-crossbow-yourself-from-scratch-withi";
const STAGE_EVENT = "ardougne-elite:task-stage";
const QUERY_EVENT = "ardougne-elite:task-stage-query";
const CLEAR_EVENT = "ardougne-elite:task-stage-clear";
const TASKS = new Set([MANTA_TASK, CROSSBOW_TASK]);

// These objectives need only session state. Do not save an unfinished sequence.
const progressByPlayer = new WeakMap();

function activePlayer(player) {
  return player && typeof player === "object" && player.isRegistered?.() === true;
}

/** Records an accepted step. Callers must emit only after the step changed game state. */
function recordStage({ player, task, stage } = {}) {
  if (!activePlayer(player) || !TASKS.has(task) || typeof stage !== "string" || stage.trim().length === 0) return;

  const current = progressByPlayer.get(player);
  if (current?.task === task && current.stage === stage) return;
  progressByPlayer.set(player, { diary: "ardougne", task, stage });
}

function resetForOtherTask({ player, diary, task } = {}) {
  if (!activePlayer(player)) return;
  const progress = progressByPlayer.get(player);
  if (progress && (progress.diary !== diary || progress.task !== task)) progressByPlayer.delete(player);
}

function completedTask(event) {
  const { player, diary, task } = event ?? {};
  if (!activePlayer(player)) return;
  const progress = progressByPlayer.get(player);
  if (progress && (progress.diary !== diary || progress.task !== task || (diary === "ardougne" && TASKS.has(task)))) {
    progressByPlayer.delete(player);
  }
}

function progressedTask(event) {
  resetForOtherTask(event);
}

/** A synchronous query returns only the requested player's requested task stage. */
function queryStage(request = {}) {
  const { player, task } = request;
  const progress = activePlayer(player) && TASKS.has(task) ? progressByPlayer.get(player) : null;
  request.result = progress?.task === task ? { stage: progress.stage } : null;
}

/** A task can clear its own stage, but cannot clear the other task's progress. */
function clearStage({ player, task } = {}) {
  if (!activePlayer(player) || !TASKS.has(task)) return;
  if (progressByPlayer.get(player)?.task === task) progressByPlayer.delete(player);
}

// The Wiki describes the manta/cooking and rune-crossbow objectives but does not document
// logout behavior. Resetting on logout/disconnect is an inference from their multi-step nature.
function clearPlayer({ player } = {}) {
  if (player && typeof player === "object") progressByPlayer.delete(player);
}

function registerStageEvent(event) {
  recordStage(event);
}

function registerCompletedTask(event) {
  completedTask(event);
}

function registerStageQuery(request) {
  queryStage(request);
}

function registerStageClear(request) {
  clearStage(request);
}

function registerLogout(event) {
  clearPlayer(event);
}

module.exports = {
  name: "ArdougneEliteTaskProgress",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent(STAGE_EVENT, registerStageEvent);
    api.onCustomEvent(QUERY_EVENT, registerStageQuery);
    api.onCustomEvent(CLEAR_EVENT, registerStageClear);
    api.onCustomEvent("diary:task-completed", registerCompletedTask);
    api.onCustomEvent("diary:task-progressed", progressedTask);
    api.onPlayerLogout(registerLogout);
    api.onPlayerDisconnect(registerLogout);
  },
  _test: { MANTA_TASK, CROSSBOW_TASK, STAGE_EVENT, QUERY_EVENT, CLEAR_EVENT, queryStage, clearStage, recordStage, completedTask, progressedTask, clearPlayer },
};
