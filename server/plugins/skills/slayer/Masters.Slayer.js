"use strict";

/**
 * Slayer masters: the Assignment option and the masters' Wiki transcripts (played by
 * NpcDialogues). The transcripts' conditions ("If the player already has an assignment:") and
 * stage directions (combat checking, the task tip, Turael's replacement) are answered here;
 * Tasks.Slayer.js does the assigning.
 *
 * A master is recognised by its resolved cache name (Data.masterForNpcName), so multinpc
 * forms (Nieve -> Steve, Duradel -> Kuradal) work without id lists.
 *
 * Mortimer offers a choice of tasks (Choice.Slayer.js) where the others assign: Assignment
 * opens it straight away (as live does), and so does his transcript's "Slayer Task Choice"
 * step. Transcripts can't wait on an interface, so after the pick the rest of that branch is
 * played again from the step after the interface (the line for the task's modifier, then the
 * tips/cancel menu). While a choice waits, the other masters refuse (Wiki).
 *
 * Where content offers a choice of tasks instead of the assignment (Offer.Slayer.js, a league
 * relic), each assignment path (Assignment, the transcript's assignment step, Turael's
 * replacement, a remote assignment) ends the talk and shows that choice.
 *
 * A new task is followed by the same menu at every master but Mortimer: "Got any tips for me?",
 * "Can I cancel that task? (30 Points)" (only while the player can pay for it) and "Okay,
 * great!" (Konar adds "Where is that area?" and closes with her own line). Talk-to's "I need another assignment." with no task plays that assignment for every
 * master the same way, as the transcripts' own branches differ (some hold only the line, some
 * no menu). There the master first says "Excellent, you're doing great." (not Konar or
 * Krystilia, whose lines have their own form); Assignment gives only the task line.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");
const Choice = require("./Choice.Slayer");
const Offer = require("./Offer.Slayer");
const Rewards = require("./Rewards.Slayer");

/** Set when the player accepts Turael's offer to replace a task he wouldn't give. */
const REPLACE_ATTRIBUTE = "slayer:replace-offered";
/** Set when the player asks Mortimer to cancel the task he just gave (the Wiki has no text after it). */
const CANCEL_ATTRIBUTE = "slayer:cancel-asked";
const CANCEL_OPTION = "Can I cancel that task? (100 Points)";
const ASSIGNMENT_OPTION = "I need another assignment.";
/** Turael's transcript holds his assignment menu in the variant for later visits. */
const ASSIGNMENT_VARIANT = "standard-dialogue-subsequent-visits-to-turael";
const CHOICE_WAITING = "Hmm... It appears as though Mortimer has provided you with a task choice, you must go to them in order to pick.";
/** Ours: the Wiki has no line for the Slayer XP modifier. */
const XP_MODIFIER_LINE = "Your new task is to kill [amount] [task monster]. Creatures on this task will award increased Slayer experience.";
const PRAISE = "Excellent, you're doing great.";
const TIPS_OPTION = "Got any tips for me?";
const CANCEL_TASK_OPTION = "Can I cancel that task? (30 Points)";
const OKAY_OPTION = "Okay, great!";
const GOOD_LUCK = "Good luck! Don't forget to come back when you need a new assignment.";
/** Konar's menu also asks where the area is, and she closes with her own line (Wiki transcript). */
const AREA_OPTION = "Where is that area?";
const KONAR_GOOD_LUCK = "Once the balance has been served, return to me.";
const TASK_CANCELLED = "Your task has been cancelled.";
/** Krystilia's tip ends with this (Wiki transcript). */
const WILDERNESS_TIP = "You've got to do the task in the Wilderness.";
/** The menu's cancel option, played by action() (not a transcript action). */
const CANCEL_ACTION = "slayer_cancel_task";
const { MORTIMER, MODIFIER } = Data;

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
  if (waitingElsewhere(player, master)) return CHOICE_WAITING;
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

/** Whether another master's choice of tasks is waiting for the player. */
function waitingElsewhere(player, master) {
  return Choice.pending(player) && State.varbit(player, "slayer_choose_rolled_master") !== master.id;
}

/**
 * Whether content offers this player a choice of tasks from this master now: no task, no other
 * master's choice waiting, the master's levels met (Offer.Slayer.js).
 */
function offersChoice(player, master) {
  if (Tasks.current(player) || waitingElsewhere(player, master) || !Tasks.meetsMaster(player, master)) return false;
  return Offer.offerFor(player, master) != null;
}

/** Shows that choice once the talk has closed (closing it closes every interface, the menu included). */
function offerLater(player, master, npcId) {
  queueMicrotask(() => Offer.open(player, master, npcId));
}

/** Mortimer's task choice, or his line when he has none to offer. */
function offerChoice(player, master, definition, npcId) {
  if (!Tasks.meetsMaster(player, master)) {
    say(player, definition, tooWeak(master));
    return;
  }
  if (!Choice.open(player, master, npcId)) {
    say(player, definition, `${master.names[0]} was unable to give you a Slayer task. Please try again later.`);
  }
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
  if (master.id === MORTIMER && !Tasks.current(event.player)) {
    offerChoice(event.player, master, event.definition, event.definition.getId());
    return;
  }
  if (!assignmentTalk(event.player, master) && offersChoice(event.player, master)) {
    Offer.open(event.player, master, event.definition.getId());
    return;
  }
  if (assignmentTalk(event.player, master) && playAssignmentBranch(event)) return;
  if (!Tasks.current(event.player) && playSteps(event.player, master, event.npc, event.definition.getId(), assignmentSteps(event.player, master, false))) return;
  say(event.player, event.definition, assignmentLine(event.player, master));
}

/**
 * The master's answer to an assignment asked for with no task held, as transcript steps: the
 * task line and the menu after it, or the refusal. Null when content offers a choice of tasks
 * instead (the caller shows it once the talk has closed).
 */
function assignmentSteps(player, master, praise) {
  const end = { type: "end" };
  if (waitingElsewhere(player, master)) return [{ npc: CHOICE_WAITING }, end];
  if (!Tasks.meetsMaster(player, master)) return [{ npc: tooWeak(master) }, end];
  if (offersChoice(player, master)) return null;
  const result = Tasks.assign(player, master);
  if (!result.line) return [{ npc: result.refused }, end];
  return [{ npc: praise ? `${PRAISE} ${result.line}` : result.line }, afterTaskMenu(player, master)];
}

/** Whether this master's Talk-to assignment starts with the praise (Konar and Krystilia word theirs apart). */
function praises(master) {
  return !master.locations && master.wilderness !== true;
}

/** "Okay, great!" and the master's closing line. */
function okaySteps(master) {
  return [{ player: OKAY_OPTION }, { npc: master.locations ? KONAR_GOOD_LUCK : GOOD_LUCK }, { type: "end" }];
}

/** The menu after a new task; cancelling is offered only while the player can pay for it. */
function afterTaskMenu(player, master) {
  const tip = { type: "action", action: "slayer_task_tip", target: master.names[0] };
  const tips = [
    { player: TIPS_OPTION },
    tip,
    ...(master.wilderness === true ? [{ npc: WILDERNESS_TIP }] : []),
    { player: "Great, thanks!" },
    { type: "end" },
  ];
  const options = [{ text: TIPS_OPTION, steps: tips }];
  if (State.varbit(player, "slayer_points") >= Rewards.cancelPrice(player)) {
    // Konar's transcript has the player ask; at the other masters the master answers the option.
    const ask = master.locations ? [{ player: "Can I cancel that task?" }] : [];
    options.push({ text: CANCEL_TASK_OPTION, steps: [...ask, { type: "action", action: CANCEL_ACTION, target: master.names[0] }] });
  }
  if (master.locations) options.push({ text: AREA_OPTION, steps: [{ player: AREA_OPTION }, tip, ...okaySteps(master)] });
  options.push({ text: OKAY_OPTION, steps: okaySteps(master) });
  return { type: "choice", options };
}

/**
 * Plays steps through the dialogue engine as this master's talk (menus and stage directions
 * work as in the transcripts); a null `steps` shows the offered choice of tasks instead.
 */
function playSteps(player, master, npc, npcId, steps) {
  if (!steps) {
    Offer.open(player, master, npcId);
    return true;
  }
  const request = { player, npc, npcId, select: () => steps, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

/**
 * Where Assignment says more than the task line, as the transcript's "I need another
 * assignment." branch does (rsprox captures): Turael and Aya on a task, with their short
 * "You're still hunting ..., you have N to go." and the offer to replace a task they wouldn't
 * give (1445, 2965), and Krystilia's warning before the first Wilderness task (3279, 3434).
 */
function assignmentTalk(player, master) {
  const task = Tasks.current(player);
  if (task) return master.replacesTasks === true;
  return master.wilderness === true && State.varbit(player, "slayer_wilderness_tasks_completed") === 0
    && !waitingElsewhere(player, master) && Tasks.meetsMaster(player, master);
}

/** Plays that branch of the master's transcript, without the player asking. */
function playAssignmentBranch(event) {
  const request = {
    player: event.player,
    npc: event.npc,
    npcId: event.definition.getId(),
    variant: ASSIGNMENT_VARIANT,
    select: (steps) => findOption(steps, ASSIGNMENT_OPTION)?.steps?.filter((step, index) => index > 0 || !step.player),
    handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/** "slayer:assignment": the transcript's assignment step; fills in the master's line. */
function assignmentEvent(request) {
  const master = Data.masterForNpcName(request.npcName) ?? Data.masterForNpcName(request.master);
  if (!master) return;
  const task = Tasks.current(request.player);
  if (task) return;
  if (waitingElsewhere(request.player, master)) {
    request.line = CHOICE_WAITING;
    return;
  }
  if (!Tasks.meetsMaster(request.player, master)) {
    request.line = tooWeak(master);
    return;
  }
  // A remote assignment or a quest's: no line, the choice follows.
  if (offersChoice(request.player, master)) {
    offerLater(request.player, master, request.npcId ?? request.definitionId ?? null);
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
  // Mortimer: his introduction, the modifier of the task just picked, his task count.
  [/^If this is the first time talking to Mortimer:/, ({ player }) => State.varbit(player, "mortimer_introduction") === 0],
  [/^If the player has talked to Mortimer before:/, ({ player }) => State.varbit(player, "mortimer_introduction") === 1],
  [/^If the task selected has a quantity modifier:/, ({ task }) => task?.modifier?.id === MODIFIER.QUANTITY],
  [/^If the task selected has a Slayer Point modifier:/, ({ task }) => task?.modifier?.id === MODIFIER.POINTS],
  [/^If the task selected has a clue scroll modifier:/, ({ task }) => task?.modifier?.id === MODIFIER.CLUES],
  [/^If the task selected has a superior unique chance modifier:/, ({ task }) => task?.modifier?.id === MODIFIER.SUPERIOR_UNIQUES],
  [/^If the task selected has a Slayer experience modifier:/, ({ task }) => task?.modifier?.id === MODIFIER.XP],
  [/^Less than 25 tasks completed:/, ({ player }) => mortimerTasks(player) < 25],
  [/^25-39 tasks completed:/, ({ player }) => mortimerTasks(player) >= 25 && mortimerTasks(player) < 40],
  [/^40-49 tasks completed:/, ({ player }) => mortimerTasks(player) >= 40 && mortimerTasks(player) < 50],
  [/^50\+ tasks completed:/, ({ player }) => mortimerTasks(player) >= 50],
];

function mortimerTasks(player) {
  return State.varp(player, "slayer_mortimer_tasks_completed");
}

function answerCondition(event) {
  const master = masterFor(event.definition);
  if (!master) return null;
  const context = { player: event.player, master, task: Tasks.current(event.player) };
  for (const [pattern, answer] of CONDITIONS) {
    if (pattern.test(event.text)) return answer(context);
  }
  return null;
}

/** Fills the transcripts' blanks ("[amount]", "[task monster]", "[task streak amount]", Mortimer's "[X]"). */
function fillLine(request) {
  if (!/\[(amount|number|task monster|monster|task streak amount|X)\]/.test(request.text ?? "")) return;
  const master = masterFor(request.definition);
  if (!master) return;
  const task = Tasks.current(request.player);
  const streak = State.varbit(request.player, "slayer_tasks_completed");
  // Turael's offer names both streaks (rsprox: "standard task streak of 1 ... Wilderness task streak of 13").
  const wildernessStreak = State.varbit(request.player, "slayer_wilderness_tasks_completed");
  request.text = request.text
    .replace(/Wilderness task streak of \[task streak amount\]/g, `Wilderness task streak of ${wildernessStreak}`)
    .replace(/\[task streak amount\]/g, String(streak))
    .replace(/\[X\]/g, String(mortimerTasks(request.player)))
    .replace(/\[(amount|number)\]/g, String(task?.count ?? 0))
    .replace(/\[(task monster|monster)\]/g, Tasks.taskName(task?.task));
}

/**
 * Mortimer's line for the task just picked: "[number]" is the modifier's value and the monster
 * keeps its capital letters (rsprox captures: "Your new task is to kill 183 Aberrant Spectres.").
 */
function chosenLine(task, text) {
  return text
    .replace(/\[amount\]/g, String(task.count))
    .replace(/\[number\]/g, String(task.modifier?.value ?? 0))
    .replace(/\[task monster\]/g, task.task?.displayName ?? "");
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
  if (master.id === MORTIMER && mortimerAction(request, master)) return;
  if (request.action === "slayer_assignment" && !Tasks.current(player)) {
    request.handled = true;
    const steps = assignmentSteps(player, master, praises(master) && text.startsWith(PRAISE));
    if (steps) request.steps = steps;
    else {
      request.end = true;
      offerLater(player, master, request.npcId ?? request.definition.getId());
    }
    return;
  }
  if (request.action === CANCEL_ACTION) {
    const cancel = { player, quiet: true, cancelled: false };
    api.emitCustomEvent("slayer:cancel-task", cancel);
    request.handled = true;
    request.steps = cancel.cancelled ? [{ npc: TASK_CANCELLED }, ...okaySteps(master)] : [{ type: "end" }];
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
    const line = replaceTask(player, master);
    if (line) request.steps = [{ npc: line }];
    else {
      request.end = true;
      offerLater(player, master, request.npcId ?? request.definition.getId());
    }
  }
}

/**
 * Mortimer's stage directions: the task choice (ends the talk; the pick plays the rest), the
 * line for the picked task, the Slayer XP modifier's line and cancelling (the Wiki has neither).
 */
function mortimerAction(request, master) {
  const { player, step } = request;
  if (request.action === "open_interface" && request.target === "Slayer Task Choice") {
    request.handled = true;
    request.end = true;
    const npcId = request.npcId ?? request.definition.getId();
    queueMicrotask(() => offerChoice(player, master, request.definition, npcId));
    return true;
  }
  const task = Tasks.current(player);
  if (request.action === "slayer_assignment" && task) {
    request.handled = true;
    request.steps = [{ npc: chosenLine(task, String(request.text ?? "")) }];
    return true;
  }
  if (step?.type !== "missing") return false;
  if (player.getAttribute(CANCEL_ATTRIBUTE)) {
    player.setAttribute(CANCEL_ATTRIBUTE, null);
    request.handled = true;
    request.end = true;
    queueMicrotask(() => api.emitCustomEvent("slayer:cancel-task", { player }));
    return true;
  }
  if (task?.modifier?.id === MODIFIER.XP) {
    request.handled = true;
    request.steps = [{ npc: chosenLine(task, XP_MODIFIER_LINE) }];
    return true;
  }
  return false;
}

/**
 * After a pick (Choice.Slayer.js): Mortimer's transcript from the step after the task choice,
 * or just the task's line if the transcript can't be played.
 */
function taskChosen({ player, master, npcId }) {
  const definition = npcId != null ? core.NpcDefinition.forId(npcId) : null;
  const request = { player, npcId, variant: "standard-dialogue", select: afterTaskChoice, handled: false };
  if (definition) api.emitCustomEvent("npc-dialogue:start", request);
  if (request.handled) return;
  const task = Tasks.current(player);
  if (task) player.sendMessage(`Your new task is to kill ${task.count} ${task.task?.displayName ?? ""}.`);
}

/**
 * The steps after "Slayer Task Choice" in the "I need another assignment." branch. Their
 * "continue" jumps lead to the rewards menu in the Wiki's export, while live goes on to the
 * tips/cancel menu, so they are left out.
 */
function afterTaskChoice(steps) {
  const option = findOption(steps, "I need another assignment.");
  const branch = option?.steps?.find((step) => step.type === "condition" && /doesn't have an assignment yet/.test(step.text));
  const at = branch?.steps?.findIndex((step) => step.action === "open_interface") ?? -1;
  if (at < 0) return null;
  return branch.steps.slice(at + 1).map((step) => (step.type === "condition"
    ? { ...step, steps: (step.steps ?? []).filter((inner) => inner.type !== "jump") }
    : step));
}

function findOption(steps, text) {
  for (const step of steps ?? []) {
    for (const option of step.options ?? []) {
      if (option.text === text) return option;
      const deeper = findOption(option.steps, text);
      if (deeper) return deeper;
    }
    const nested = findOption(step.steps, text);
    if (nested) return nested;
  }
  return null;
}

/** Turael/Aya replace a task from another master's list; the standard streak resets (Wiki). */
function replaceTask(player, master) {
  Tasks.clear(player);
  State.setVarbit(player, "slayer_tasks_completed", 0);
  // Null when content offers a choice instead (the caller shows it).
  if (offersChoice(player, master)) return null;
  const result = Tasks.assign(player, master);
  return result.line ?? result.refused;
}

function choice(event) {
  const master = masterFor(event.definition);
  if (master?.id === MORTIMER) {
    // His introduction ends at the first menu; the next talk is the short greeting.
    if (State.varbit(event.player, "mortimer_introduction") === 0) State.setVarbit(event.player, "mortimer_introduction", 1);
    event.player.setAttribute(CANCEL_ATTRIBUTE, event.option === CANCEL_OPTION ? true : null);
    return;
  }
  if (master && event.option === ASSIGNMENT_OPTION && talkToAssignment(event, master)) return;
  if (!master?.replacesTasks) return;
  const offered = event.option === "Yes, please." && Tasks.current(event.player) != null;
  event.player.setAttribute(REPLACE_ATTRIBUTE, offered ? master.id : null);
}

/**
 * Talk-to's "I need another assignment." with no task: the player's line, then the assignment
 * (action() answers its step). Krystilia's warning before a first Wilderness task stays her
 * transcript's.
 */
function talkToAssignment(event, master) {
  const { player } = event;
  if (Tasks.current(player)) return false;
  if (master.wilderness === true && State.varbit(player, "slayer_wilderness_tasks_completed") === 0) return false;
  const steps = [
    { player: ASSIGNMENT_OPTION },
    { type: "action", action: "slayer_assignment", target: master.names[0], text: praises(master) ? PRAISE : "" },
  ];
  if (!playSteps(player, master, event.npc, event.npcId ?? event.definition.getId(), steps)) return false;
  event.end = true;
  return true;
}

/** Steve's Slayer-master form plays his master's talk; the wyvern-cave Steve keeps his own. */
const STEVE_MASTER_VARIANT = "standard-dialogue-slayer-master";

function dialogueVariant({ npcId, definition }) {
  const id = definition?.getId?.() ?? npcId;
  if (id == null || id !== core.CacheDefinitions.getNpcId("slayer_master_steve")) return null;
  return STEVE_MASTER_VARIANT;
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
  pluginApi.onNpcDialogueVariant?.(dialogueVariant);
  pluginApi.onCustomEvent("slayer:assignment", assignmentEvent);
  pluginApi.onCustomEvent("slayer:task-tip", taskTipEvent);
  pluginApi.onCustomEvent("npc-dialogue:line", fillLine);
  pluginApi.onCustomEvent("npc-dialogue:action", action);
  pluginApi.onCustomEvent("npc-dialogue:choice", choice);
  pluginApi.onCustomEvent("slayer:task-chosen", taskChosen);
}

module.exports = {
  init,
  attach,
  assignmentLine,
  answerCondition,
  dialogueVariant,
  replaceTask,
};
