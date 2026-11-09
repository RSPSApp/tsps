"use strict";

/**
 * Advisor Ghrim's side of the kingdom (Wiki transcript; Throne of Miscellania and Royal Trouble
 * pick which page plays):
 * - "How is the Kingdom faring?" reports the approval rating, offers the collection when the
 *   subjects have gathered anything, refuses while the bank lacks the space ("you will need
 *   [amount] more free spaces"), and opens the kingdom interface.
 * - The Collect option collects straight away.
 * - Before Royal Trouble, the transcript's "(Continues in / See After Royal Trouble section)"
 *   markers play that section's lines.
 * Resources go to the bank, as in OSRS; nothing is collected (and nothing lost) without room.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Transcript:Advisor_Ghrim,
 * https://oldschool.runescape.wiki/w/Advisor_Ghrim
 */

const Common = require("./Common.ManagingMiscellania");
const Interface = require("./Interface.ManagingMiscellania");

const PAGE = "Advisor Ghrim";
const AFTER_ROYAL_TROUBLE = "standard-dialogue-after-completing-royal-trouble";
/** Transcript step anchors (npc-dialogues.json, Advisor Ghrim). */
const COND = { nothingToCollect: "XLIotr", bankFull: "yRsN6h", bankHasRoom: "O7CPft" };
const ACTION = { continuesFaring: "Cv2DrM", seeManage: "a5Xk0V", resourcesCollected: "gppDQ5" };
const MANAGE_TARGET = "Managing Miscellania";
/** "Your subjects are content", which the page before Royal Trouble has already answered. */
const ENGAGED_GREETINGS = new Set(["4K1i6T", "bPoNQE"]);
const BEFORE_ROYAL_TROUBLE = "standard-dialogue-before-royal-trouble";
/** Royal Trouble's own Ghrim page lists these two questions without their answers. */
const KINGDOM_QUESTIONS = new Set(["How is the Kingdom faring?", "How do I manage the kingdom?"]);

const isGhrim = (definition) => definition?.getName?.() === PAGE || definition?.name === PAGE;

/** The gathered resources for the current points, kept until collected (one roll per collection). */
const pending = new Map();

/** What the roll depends on: the points, the workers and every choice. */
function rollKey(kingdom) {
  const { points, workers, cooked, flax, hardwoodType } = kingdom;
  return JSON.stringify({ points, workers, cooked, flax, hardwoodType });
}

function pendingFor(player, kingdom) {
  const key = rollKey(kingdom);
  const held = pending.get(player);
  if (held && held.key === key) return held.items;
  const items = Common.gather(kingdom, Math.random, Common.rules(player).outputMultiplier);
  pending.set(player, { key, items });
  return items;
}

function onLogout({ player }) {
  pending.delete(player);
}

/** Bank slots the collection needs beyond what the bank has free. */
function spaceShort(player, collected) {
  const { Bank, Item } = Common.getCore();
  let needed = 0;
  let capped = 0;
  // The tabs share one capacity, so the main tab's free slots are the bank's.
  const free = player.getBank(0).getFreeSlots();
  for (const [key, count] of collected) {
    const itemId = key === "clue" ? clueItemId(player) : key;
    if (itemId == null) continue;
    const bank = player.getBank(Bank.getTabForItem(player, itemId));
    if (!bank.contains(itemId)) needed++;
    if (bank.getAddableAmount(new Item(itemId, count)) < count) capped++;
  }
  return Math.max(0, needed - free, capped);
}

function hasNothing(player) {
  const kingdom = Common.catchUp(player);
  return !kingdom || kingdom.points <= 0;
}

/** Delivers to the bank and empties the store. False when it won't fit (nothing moves). */
function collect(player) {
  const kingdom = Common.catchUp(player);
  if (!kingdom || kingdom.points <= 0) return false;
  const collected = pendingFor(player, kingdom);
  if (spaceShort(player, collected) > 0) return false;
  const { Bank, Item } = Common.getCore();
  const lines = [];
  for (const [key, count] of collected) {
    if (key === "clue") {
      for (let i = 0; i < count; i++) deliverClue(player);
      continue;
    }
    player.getBank(Bank.getTabForItem(player, key)).add(new Item(key, count), false);
    lines.push(`${count.toLocaleString("en-GB")} x ${Common.getCore().ItemDefinition.forId(key).getName()}`);
  }
  kingdom.points = 0;
  Common.save(player, kingdom);
  pending.delete(player);
  player.sendMessage("Your subjects have delivered their resources to your bank.");
  // "miscellania:collected" { player, approval }: the collection and its approval percentage,
  // for a league's "Collect Miscellania Resources at Full Approval".
  Common.getApi().emitCustomEvent("miscellania:collected", { player, approval: Common.approvalPercent(Common.favour(player)) });
  for (const line of lines) player.sendMessage(line);
  return true;
}

/** An easy clue goes through the clue system's own capacity and scroll-box rules. */
function clueItemId(player) {
  const api = Common.getApi();
  const can = { player, tier: "easy", allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", can);
  if (can.allowed !== true) return null;
  const clue = { player, itemId: Common.items().TRAIL_CLUE_EASY_SIMPLE001, box: false };
  api.emitCustomEvent("treasure-trails:clue-item", clue);
  return clue.itemId;
}

function deliverClue(player) {
  const itemId = clueItemId(player);
  if (itemId == null) return;
  const { Bank, Item } = Common.getCore();
  const bank = player.getBank(Bank.getTabForItem(player, itemId));
  const item = new Item(itemId, 1);
  if (bank.getAddableAmount(item) >= 1) bank.add(item, false);
}

// --- Dialogue

function onDialogueCondition(event) {
  if (!isGhrim(event.definition) && event.npcId !== undefined && !isGhrimId(event.npcId)) return null;
  switch (event.stepId) {
    case COND.nothingToCollect: return hasNothing(event.player);
    case COND.bankFull: return shortFor(event.player) > 0;
    case COND.bankHasRoom: return shortFor(event.player) === 0;
    default: return null;
  }
}

function shortFor(player) {
  const kingdom = Common.catchUp(player);
  return kingdom ? spaceShort(player, pendingFor(player, kingdom)) : 0;
}

function isGhrimId(npcId) {
  return Common.getCore().NpcDefinition?.forId?.(npcId)?.getName?.() === PAGE;
}

/** "[number]%" is the approval rating; "[amount] more free space[s]" the bank shortfall. */
function onDialogueLine(request) {
  if (typeof request.text !== "string" || !isGhrimId(request.npcId)) return;
  if (request.text.includes("approval rating is [number]%")) {
    request.text = request.text.replace("[number]", String(Common.approvalPercent(Common.favour(request.player))));
  }
  if (request.text.includes("[amount] more free space[s]")) {
    const short = shortFor(request.player);
    request.text = request.text.replace("[amount] more free space[s]", `${short} more free space${short === 1 ? "" : "s"}`);
  }
}

/** One of the after-Royal-Trouble page's three questions (from the transcript export). */
function afterRoyalTroubleOption(index) {
  const page = require("../../../data/definitions/npc-dialogues.json")[PAGE];
  const steps = page?.variants?.[AFTER_ROYAL_TROUBLE] ?? [];
  const choice = steps.find((step) => step.type === "choice");
  return choice?.options?.[index]?.steps ?? [];
}

function onDialogueAction(request) {
  if (!isGhrimId(request.npcId) || !Common.ruler(request.player)) return;
  if (request.stepId === ACTION.continuesFaring) {
    request.handled = true;
    // Its first line is the question the player has just asked.
    request.steps = afterRoyalTroubleOption(0).slice(1).filter((step) => !ENGAGED_GREETINGS.has(step.id));
  } else if (request.stepId === ACTION.seeManage) {
    request.handled = true;
    request.steps = afterRoyalTroubleOption(1);
  } else if (request.stepId === ACTION.resourcesCollected) {
    request.handled = true;
    collect(request.player);
  } else if (!request.handled && request.action === "open_interface" && request.target === MANAGE_TARGET) {
    request.handled = true;
    Interface.open(request.player);
  }
}

/**
 * Royal Trouble's start page (before that quest) offers the kingdom questions with no steps, so
 * picking one ends the chat; once it has, Ghrim answers from his own page's same question.
 */
function onDialogueChoice({ player, npc, npcId, option }) {
  if (!KINGDOM_QUESTIONS.has(option) || !isGhrimId(npcId) || !Common.ruler(player)) return;
  const { Task, TaskManager } = Common.getCore();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      this.stop();
      if (player.getDialogueManager?.().isActive?.()) return;
      answerKingdomQuestion(player, npc, npcId, option);
    }
  })());
}

function answerKingdomQuestion(player, npc, npcId, option) {
  const variant = Common.royalTrouble(player) ? AFTER_ROYAL_TROUBLE : BEFORE_ROYAL_TROUBLE;
  const select = (steps) => steps.find((step) => step.type === "choice")
    ?.options?.find((entry) => entry.text === option)?.steps ?? [];
  Common.getApi().emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId, variant: { page: PAGE, variant }, select, handled: false,
  });
}

/** Collect: straight to the bank, or Ghrim's line about the space. */
function collectOption({ player }) {
  if (!Common.ruler(player)) return false;
  if (hasNothing(player)) {
    player.sendMessage("Your subjects have not yet collected anything.");
    return true;
  }
  const short = shortFor(player);
  if (short > 0) {
    player.sendMessage(`You will need ${short} more free space${short === 1 ? "" : "s"} in your bank to hold all the items your subjects have collected.`);
    return true;
  }
  collect(player);
  return true;
}

/**
 * "miscellania:collect" and "miscellania:check": Ghrim's collection, and the kingdom's approval and
 * coffers, asked from elsewhere (content that manages the kingdom remotely, a league relic's item).
 * The check's wording is ours.
 */
function collectRequest(request) {
  if (!request?.player || request.handled) return;
  request.handled = collectOption({ player: request.player }) === true;
}

function checkRequest(request) {
  if (!request?.player || request.handled) return;
  const kingdom = Common.catchUp(request.player);
  if (!kingdom) return;
  request.handled = true;
  request.player.sendMessage(`Your kingdom's approval rating is ${Common.approvalPercent(Common.favour(request.player))}%`
    + ` and its coffers hold ${kingdom.coffer.toLocaleString("en-GB")} coins.`);
}

module.exports = function registerGhrim(api) {
  Common.bind(api);
  api.onNpcDialogueCondition(onDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", onDialogueLine);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", onDialogueChoice);
  api.onNpcInteraction(PAGE, { Collect: collectOption });
  api.onCustomEvent("miscellania:collect", collectRequest);
  api.onCustomEvent("miscellania:check", checkRequest);
  api.onPlayerLogout(onLogout);
};

module.exports._test = { COND, ACTION, pending, pendingFor, spaceShort, collect, onDialogueCondition, onDialogueLine, onDialogueAction, onDialogueChoice, answerKingdomQuestion, collectOption, collectRequest, checkRequest };
