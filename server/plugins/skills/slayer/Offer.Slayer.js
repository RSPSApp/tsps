"use strict";

/**
 * A choice of tasks with a kill count the player picks, where content offers one in place of a
 * master's assignment (Demonic Pacts' Culling Spree relic, Wiki: Culling_Spree_(Demonic_Pacts_League)).
 *
 * `slayer:task-offer` { player, master, wilderness, choices: 0, amount: null, boss: false, bossAllowed: null }
 * (`wilderness`: Krystilia, whose kills count only in the Wilderness) is asked whenever a master (not Mortimer, who has his own choice: Choice.Slayer.js) would
 * assign. An answer sets `choices` (how many tasks), `amount` ({ min, max }: the kill count the
 * player types), and with `boss` one of the choices is a boss task where the master could assign
 * one (its "Boss" row eligible, so Like a Boss bought), the boss even odds among those the
 * player has the levels for and `bossAllowed(task)` lets through (the relic: in an unlocked area).
 * The other choices are the master's eligible tasks by weight, none twice, never the Boss row.
 *
 * The roll is kept (OFFER_ATTRIBUTE) until a task is assigned (picked, or got any other way), so closing the menu, cancelling the
 * count or talking again offers the same tasks; another master rolls his own. Picking asks for the
 * count; one outside the range assigns nothing and says so. The task is then set as the master
 * would set it (Tasks.assignPicked: Konar's area, streaks, boss task) and the master says its line.
 *
 * Ours: no Leagues VI recording shows the relic's choice. The cache keeps it in Mortimer's
 * varbits (slayer_choose_task_*, on varp slayer_league_relic_culling_spree), but today's
 * slayer_task_choice interface is Mortimer's: it reads his rows for each task's amounts and
 * icon (and errors on a task he lacks, the boss task among them). So the choice is a chatbox menu,
 * the count an amount prompt, and the menu title, prompt and range line are our words.
 */
const Data = require("./Data.Slayer");
const Tasks = require("./Tasks.Slayer");

/** The offered tasks: [{ master, task, boss }] (master and slayer_task ids, boss id or 0); [] for none. */
const OFFER_ATTRIBUTE = "slayer:offered-tasks";
/** The NPC the player talked to, for the line after the pick (not saved). */
const NPC_ATTRIBUTE = "slayer:offer-npc";
const MENU_TITLE = "Choose a Slayer task";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** The offer content makes for this master, or null when it makes none. */
function offerFor(player, master) {
  if (!player || !master || master.id === Data.MORTIMER) return null;
  const request = { player, master: master.id, wilderness: master.wilderness === true, choices: 0, amount: null, boss: false, bossAllowed: null };
  api.emitCustomEvent("slayer:task-offer", request);
  const { min, max } = request.amount ?? {};
  if (!(request.choices > 0) || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return null;
  return request;
}

/** The tasks offered: `choices` of them, one a boss where the offer asks and one can be had. */
function roll(player, master, offer, random = Math.random) {
  const blocked = Tasks.blockedTaskIds(player, master);
  const eligible = master.tasks.filter((entry) => Tasks.eligible(player, master, entry, blocked));
  const pool = eligible.filter((entry) => entry.task.id !== Data.BOSS_TASK_ID);
  const rolled = [];
  const bossRow = offer.boss && eligible.find((entry) => entry.task.id === Data.BOSS_TASK_ID);
  const bossId = bossRow ? Tasks.rollBoss(player, random, offer.bossAllowed) : 0;
  while (rolled.length < offer.choices - (bossId ? 1 : 0) && pool.length > 0) {
    const entry = Tasks.weightedPick(pool, random);
    pool.splice(pool.indexOf(entry), 1);
    rolled.push({ master: master.id, task: entry.task.id, boss: 0 });
  }
  if (bossId) rolled.push({ master: master.id, task: Data.BOSS_TASK_ID, boss: bossId });
  return rolled;
}

function stored(player) {
  const value = player.getAttribute(OFFER_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
}

function clear(player) {
  player.setAttribute(OFFER_ATTRIBUTE, []);
}

/** The master's row for an offered choice, while the player could still get it; else null. */
function entryFor(player, master, choice, blocked = Tasks.blockedTaskIds(player, master)) {
  if (!choice || choice.master !== master.id) return null;
  const entry = master.tasks.find((row) => row.task.id === choice.task);
  if (!entry || !Tasks.eligible(player, master, entry, blocked)) return null;
  if (choice.boss && !Data.get().bosses.has(choice.boss)) return null;
  return entry;
}

/** The waiting offer for this master if every choice still stands, else a new roll (saved). */
function current(player, master, offer, random) {
  const waiting = stored(player);
  const blocked = Tasks.blockedTaskIds(player, master);
  if (waiting.length > 0 && waiting.every((choice) => entryFor(player, master, choice, blocked))) return waiting;
  const rolled = roll(player, master, offer, random);
  player.setAttribute(OFFER_ATTRIBUTE, rolled);
  return rolled;
}

/** A choice's name in the menu: the boss's or the task's, as the masters' lines name them. */
function label(choice) {
  const data = Data.get();
  const task = choice.boss ? data.bosses.get(choice.boss) : data.taskById.get(choice.task);
  return task?.displayName ?? "";
}

/**
 * Offers the tasks instead of the master's assignment, when content makes an offer. Returns false
 * when there is none (the master assigns as usual); true once handled, the menu shown or the
 * master's refusal said.
 */
function open(player, master, npcId = null, random = Math.random) {
  const offer = offerFor(player, master);
  if (!offer) return false;
  player.setAttribute(NPC_ATTRIBUTE, npcId);
  const choices = current(player, master, offer, random);
  if (choices.length === 0) {
    clear(player);
    say(player, `${master.names[0]} was unable to give you a Slayer task. Please try again later.`);
    return true;
  }
  const options = choices.flatMap((choice) => [label(choice), () => pick(player, master, choice)]);
  api.sendMultiChatboxPrompt(player, MENU_TITLE, ...options);
  return true;
}

/** A menu pick: ask how many, then set the task (or say why not). */
function pick(player, master, choice) {
  const offer = offerFor(player, master);
  if (!offer || Tasks.current(player) || !stored(player).includes(choice) || !entryFor(player, master, choice)) return;
  const { min, max } = offer.amount;
  // acceptsZero/acceptsNegative: 0 or less is out of range and says so, which the client's amount packet would otherwise drop.
  player.setEnteredAmountAction({ acceptsZero: true, acceptsNegative: true, execute: (count) => chosenAmount(player, master, choice, count) });
  player.getPacketSender().sendEnterAmountPrompt(`How many would you like to slay? (${min}-${max})`);
}

function chosenAmount(player, master, choice, count) {
  const offer = offerFor(player, master);
  if (!offer || Tasks.current(player) || !stored(player).includes(choice)) return;
  const entry = entryFor(player, master, choice);
  if (!entry) return;
  const { min, max } = offer.amount;
  const amount = Math.floor(Number(count));
  if (!Number.isInteger(amount) || amount < min || amount > max) {
    player.sendMessage(`You must choose an amount between ${min} and ${max}.`);
    return;
  }
  clear(player);
  say(player, Tasks.assignPicked(player, master, entry, choice.boss, amount));
}

/** The master's line from the NPC the player talked to, or as a message when there was none (a remote task). */
function say(player, text) {
  const npcId = player.getAttribute(NPC_ATTRIBUTE);
  const definition = npcId != null ? core.NpcDefinition.forId(npcId) : null;
  if (!definition) {
    player.sendMessage(text);
    return;
  }
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, definition.getId(), text), new EndDialogue(1)));
}

/** Any task assigned (an offered pick, Mortimer's choice, a quest's) spends the waiting offer. */
function taskAssigned({ player }) {
  if (player) clear(player);
}

function attach(pluginApi) {
  pluginApi.persistAttribute(OFFER_ATTRIBUTE, []);
  pluginApi.onCustomEvent("slayer:task-assigned", taskAssigned);
}

module.exports = { init, attach, OFFER_ATTRIBUTE, offerFor, roll, open, pick, chosenAmount, stored, clear };
