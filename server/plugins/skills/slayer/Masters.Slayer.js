"use strict";

/**
 * Slayer masters: the Assignment option and the masters' Wiki transcripts (played by
 * NpcDialogues). The transcripts' conditions ("If the player already has an assignment:") and
 * stage directions (combat checking, the task tip, Turael's replacement) are answered here;
 * Tasks.Slayer.js does the assigning.
 *
 * A master is recognised by its resolved cache name (Data.masterForNpcName), so multinpc
 * forms (Nieve -> Steve, Duradel -> Kuradal) work without id lists.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

/** Set when the player accepts Turael's offer to replace a task he wouldn't give. */
const REPLACE_ATTRIBUTE = "slayer:replace-offered";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function masterFor(definition) {
  const name = definition?.getName?.();
  return name ? Data.masterForNpcName(name) : null;
}

/** Whether the current task is on this master's list (Turael's replacement offer). */
function onMastersList(master, task) {
  return master.tasks.some((entry) => entry.task.id === task.taskId);
}

/** The line a master says to "I need another assignment." (or the Assignment option). */
function assignmentLine(player, master) {
  const task = Tasks.current(player);
  if (task) return Tasks.stillHunting(player, task);
  if (!Tasks.meetsMaster(player, master)) return tooWeak(master);
  const result = Tasks.assign(player, master);
  return result.line ?? result.refused;
}

/** Ours: the Wiki has no line for a player below a master's requirements. */
function tooWeak(master) {
  const needs = [];
  if (master.combat > 0) needs.push(`a combat level of ${master.combat}`);
  if (master.slayer > 1) needs.push(`a Slayer level of ${master.slayer}`);
  return `You're not yet experienced enough for my tasks. Come back when you have ${needs.join(" and ")}.`;
}

function say(player, definition, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  const chain = new DialogueChainBuilder().add(new NpcDialogue(0, definition.getId(), text), new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

/**
 * The Assignment option (op3). Caught by click slot, so forms whose definition drops the label
 * still work; a labelled slot must say "Assignment".
 */
function assignmentClick(event) {
  if (event.clickType !== 3) return;
  const label = event.definition?.getActions?.()?.[event.clickType - 1];
  if (label && label !== "Assignment") return;
  const master = masterFor(event.definition);
  if (!master) return;
  event.handled = true;
  say(event.player, event.definition, assignmentLine(event.player, master));
}

/** "slayer:assignment": the transcript's assignment step; fills in the master's line. */
function assignmentEvent(request) {
  const master = Data.masterForNpcName(request.npcName) ?? Data.masterForNpcName(request.master);
  if (!master) return;
  const task = Tasks.current(request.player);
  if (task) return;
  if (!Tasks.meetsMaster(request.player, master)) {
    request.line = tooWeak(master);
    return;
  }
  const result = Tasks.assign(request.player, master);
  request.line = result.line ?? result.refused;
}

/** "slayer:task-tip": where to find the task (Konar: the area's hint). */
function taskTipEvent(request) {
  const task = Tasks.current(request.player);
  if (!task) return;
  if (task.area?.hint) {
    request.line = task.area.hint;
    return;
  }
  const area = task.task ? firstAreaHint(task.taskId) : null;
  request.line = area ?? `You'll find ${Tasks.taskName(task.task)} in many places; your enchanted gem can tell you how many are left.`;
}

/** The first area hint any master gives for this task (only Konar's rows have areas). */
function firstAreaHint(taskId) {
  for (const master of Data.get().masters.values()) {
    for (const entry of master.tasks) {
      if (entry.task.id !== taskId || entry.areaRows.length === 0) continue;
      const area = Data.get().areas.get(entry.areaRows[0]);
      if (area?.hint) return area.hint;
    }
  }
  return null;
}

// --- Transcript conditions and stage directions

const CONDITIONS = [
  [/^If the player doesn't have an assignment yet:/, ({ task }) => task == null],
  [/^If the player already has an assignment:/, ({ task }) => task != null],
  [/^If the player already has an assignment, and they have become ineligible/, () => false],
  [/^If the player has a high combat level:/, () => false],
  [/^If the player has disabled combat checking:/, ({ player }) => State.varbit(player, "combat_level_reqs_disabled") === 1],
  [/^If the player has enabled combat checking:/, ({ player }) => State.varbit(player, "combat_level_reqs_disabled") !== 1],
  [/^If the assignment isn't on \w+'s task list:/, ({ task, master }) => task != null && !onMastersList(master, task)],
  [/^If the assignment is on \w+'s task list:/, ({ task, master }) => task != null && onMastersList(master, task)],
  [/^If the player already has an assignment from Krystilia:/, ({ task, master }) => task != null && task.masterId === master.id],
  [/^If the player already has an assignment from another slayer master:/, ({ task, master }) => task != null && task.masterId !== master.id],
  [/^If the player has not received a Wilderness assignment before and does not have a current assignment:/,
    ({ player, task }) => task == null && State.varbit(player, "slayer_wilderness_tasks_completed") === 0],
];

function answerCondition(event) {
  const master = masterFor(event.definition);
  if (!master) return null;
  const context = { player: event.player, master, task: Tasks.current(event.player) };
  for (const [pattern, answer] of CONDITIONS) {
    if (pattern.test(event.text)) return answer(context);
  }
  return null;
}

/** Fills the transcripts' blanks ("[amount]", "[task monster]", "[task streak amount]"). */
function fillLine(request) {
  if (!/\[(amount|number|task monster|monster|task streak amount)\]/.test(request.text ?? "")) return;
  const master = masterFor(request.definition);
  if (!master) return;
  const task = Tasks.current(request.player);
  const streak = State.varbit(request.player, "slayer_tasks_completed");
  request.text = request.text
    .replace(/\[task streak amount\]/g, String(streak))
    .replace(/\[(amount|number)\]/g, String(task?.count ?? 0))
    .replace(/\[(task monster|monster)\]/g, Tasks.taskName(task?.task));
}

function setCombatChecks(player, on) {
  State.setVarbit(player, "combat_level_reqs_disabled", on ? 0 : 1);
}

function action(request) {
  const master = masterFor(request.definition);
  if (!master) return;
  const { player, step } = request;
  const text = String(request.text ?? "");
  if (/will now take the player's combat level into account/.test(text)) {
    setCombatChecks(player, true);
    request.handled = true;
    request.steps = [];
    return;
  }
  if (/will no longer take the player's combat level into account/.test(text)) {
    setCombatChecks(player, false);
    request.handled = true;
    request.steps = [];
    return;
  }
  if (request.action === "open_shop" && request.target === "Slayer Rewards") {
    // End the talk first: closing it closes every interface, the Rewards one included.
    request.handled = true;
    request.end = true;
    queueMicrotask(() => api.emitCustomEvent("slayer:open-rewards", { player, master: master.id }));
    return;
  }
  if (/provides the correspond\w* (Slayer )?(area|task tip)|provides the correspoding area/.test(text)) {
    const tip = { player, master: master.id, line: null };
    taskTipEvent(tip);
    request.handled = true;
    request.steps = tip.line ? [{ npc: tip.line }] : [];
    return;
  }
  // Turael's "Yes, please." to replacing a task he wouldn't give (the Wiki has no text after it).
  if (step?.type === "missing" && player.getAttribute(REPLACE_ATTRIBUTE) === master.id) {
    player.setAttribute(REPLACE_ATTRIBUTE, null);
    request.handled = true;
    request.steps = [{ npc: replaceTask(player, master) }];
  }
}

/** Turael/Aya replace a task from another master's list; the standard streak resets (Wiki). */
function replaceTask(player, master) {
  Tasks.clear(player);
  State.setVarbit(player, "slayer_tasks_completed", 0);
  const result = Tasks.assign(player, master);
  return result.line ?? result.refused;
}

function choice(event) {
  const master = masterFor(event.definition);
  if (!master?.replacesTasks) return;
  const offered = event.option === "Yes, please." && Tasks.current(event.player) != null;
  event.player.setAttribute(REPLACE_ATTRIBUTE, offered ? master.id : null);
}

const EQUIPMENT_SHOP = "Slayer Equipment (shop)";

/** Trade (op4): the equipment shop, for forms the shops.json binding misses (Nieve 1455). */
function trade(event) {
  if (!masterFor(event.definition)) return false;
  const shops = core.ShopDefinition.all().filter((shop) => shop.getName() === EQUIPMENT_SHOP);
  if (shops.length !== 1) return false;
  core.ShopManager.open(event.player, shops[0].getId(), true);
  return true;
}

/** Rewards (op5): the rewards interface (Rewards.Slayer.js). */
function rewards(event) {
  const master = masterFor(event.definition);
  if (!master) return false;
  api.emitCustomEvent("slayer:open-rewards", { player: event.player, master: master.id });
  return true;
}

function attach(pluginApi) {
  pluginApi.onAnyNpcInteraction({ Trade: trade, Rewards: rewards });
  pluginApi.onNpcInteraction(assignmentClick);
  pluginApi.onNpcDialogueCondition(answerCondition);
  pluginApi.onCustomEvent("slayer:assignment", assignmentEvent);
  pluginApi.onCustomEvent("slayer:task-tip", taskTipEvent);
  pluginApi.onCustomEvent("npc-dialogue:line", fillLine);
  pluginApi.onCustomEvent("npc-dialogue:action", action);
  pluginApi.onCustomEvent("npc-dialogue:choice", choice);
}

module.exports = {
  init,
  attach,
  assignmentLine,
  answerCondition,
  replaceTask,
};
