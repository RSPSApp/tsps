/**
 * Shared by the Tutorial Island units: the step data (plugins/areas/data/tutorial-island.json),
 * the player's progress and the helpers every unit uses.
 *
 * Progress is the OSRS `tutorial` varp (281) value itself: 2 at the Gielinor Guide, 30 once the
 * Survival Expert has handed over the net, ... 680 before the Home Teleport and 1000 when done.
 * Every value, the text shown for it and its arrow come from a recorded run (docs/tutorial-island.md).
 */
const fs = require("fs");
const path = require("path");

const PROGRESS_ATTRIBUTE = "tutorial-island:progress";
/** Saved once the tutorial's 25 bank coins have been given, by the booth or the starter kit. */
const BANK_COINS_ATTRIBUTE = "tutorial-island:bank-coins-given";
const BANK_COINS = 25;

/**
 * The tutorial's 25 coins in the bank, once. They topped the first bank tab back up to 25 on every booth click and
 * again with the starter kit, so moving them to another tab (or withdrawing them) and clicking again gave more.
 */
function giveBankCoins(player) {
  if (player.getAttribute(BANK_COINS_ATTRIBUTE) === true) return;
  player.setAttribute(BANK_COINS_ATTRIBUTE, true);
  player.getBank(0).adds(core.ItemIdentifiers.COINS, BANK_COINS);
}
/** The past-experience answer: "new", "returning" or "experienced". */
const EXPERIENCE_ATTRIBUTE = "tutorial-island:experience";
/** Before the varp values: a 0..53 stage index of our own. Read once at login and migrated. */
const LEGACY_STAGE_ATTRIBUTE = "tutorial.island.stage";

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "tutorial-island.json"), "utf8"));

/** Step values by name: STEP.FISH === 40. */
const STEP = Object.freeze(Object.fromEntries(data.steps.map((step) => [step.name, step.value])));
const STEPS = new Map(data.steps.map((step) => [step.value, step]));
const ORDER = data.steps.map((step) => step.value);

/** Legacy stage index -> step value (the step whose text that stage showed). */
const LEGACY_STAGES = [
  2, 2, 2, 3, 10, 20, 30, 40, 50, 60, 70, 80, 90, 120, 130, 140, 150, 160, 170, 200, 220, 230, 250, 260,
  300, 320, 330, 340, 360, 370, 390, 400, 405, 410, 430, 450, 470, 500, 510, 520, 530, 531, 540, 550, 560,
  610, 620, 620, 630, 650, 650, 671, 680, 1000,
];

/**
 * Tutorial NPC ids, including the island's duplicate secondary ids. Interaction events carry the
 * id an NPC resolves to (NPC.getContentId): the Ironman tutor is spawned as 7942 and shows as 7941.
 */
const IDS = Object.freeze({
  GIELINOR_GUIDE: [3308, 9476],
  SURVIVAL_EXPERT: [8503, 9477],
  MASTER_CHEF: [3305],
  QUEST_GUIDE: [3312, 9480],
  MINING_INSTRUCTOR: [3311, 9481],
  COMBAT_INSTRUCTOR: [3307, 9482],
  MAGIC_INSTRUCTOR: [3309, 9487],
  ACCOUNT_GUIDE: [3310],
  BROTHER_BRACE: [3319, 9485],
  IRONMAN_TUTOR: [7941, 7942, 9486],
  RAT: 3313,
  CHICKEN: 3316,
  FISHING_SPOT: 3317,
});

const NPCS = new Set(Object.values(IDS).filter(Array.isArray).flat());

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** League characters have their own onboarding, even before LeagueMode's login hook runs. */
function appliesTo(player) {
  return player?.getProfile?.() !== "league";
}

/** Progress, migrating a legacy stage index the first time it is read. -1 when not participating. */
function progress(player) {
  if (!appliesTo(player)) return -1;
  const value = Number(player.getAttribute(PROGRESS_ATTRIBUTE));
  if (Number.isFinite(value)) return value | 0;
  const legacy = Number(player.getAttribute(LEGACY_STAGE_ATTRIBUTE));
  if (!Number.isFinite(legacy)) return -1;
  const migrated = LEGACY_STAGES[Math.max(0, Math.min(LEGACY_STAGES.length - 1, legacy | 0))];
  player.setAttribute(PROGRESS_ATTRIBUTE, migrated);
  player.setAttribute(LEGACY_STAGE_ATTRIBUTE, null);
  return migrated;
}

function isActive(player) {
  const value = progress(player);
  return value >= STEP.PAST_EXPERIENCE && value < STEP.COMPLETED;
}

/** Listeners for step changes (the interface unit redraws the step). */
const stepListeners = [];

function onStep(listener) {
  stepListeners.push(listener);
}

function setProgress(player, value) {
  const finishing = (value | 0) === STEP.COMPLETED && isActive(player);
  player.setAttribute(PROGRESS_ATTRIBUTE, value | 0);
  for (const listener of stepListeners) listener(player, value | 0);
  // Other plugins undo what they set up for the island (the spellbook's level filter).
  if (finishing) api.emitCustomEvent("tutorial:completed", { player });
}

/** Moves on to `value` unless the player is already there or further. */
function advance(player, value) {
  if (!isActive(player) || progress(player) >= value) return false;
  setProgress(player, value);
  return true;
}

/** Moves on to `to` only from `from` (a step that one action completes). */
function advanceFrom(player, from, to) {
  if (progress(player) !== from) return false;
  setProgress(player, to);
  return true;
}

function step(value) {
  return STEPS.get(value);
}

function inTutorial(position) {
  if (!position) return false;
  const x = position.x ?? position.getX?.();
  const y = position.y ?? position.getY?.();
  const z = position.z ?? position.getZ?.() ?? 0;
  if ((z | 0) !== 0) return false;
  if (x < 3060 || x > 3165) return false;
  return (y >= 3060 && y <= 3165) || (y >= 9400 && y <= 9620);
}

function atTutorial(player) {
  return inTutorial(player.getLocation());
}

function hasItem(player, itemId) {
  return player.getInventory().getAmount(itemId) > 0 || player.getEquipment().getAmount(itemId) > 0;
}

function worn(player, itemId) {
  return player.getEquipment().getAmount(itemId) > 0;
}

/** "[he/she]" in the captured texts, by the player's appearance. */
function pronoun(player, text) {
  const male = player.getAppearance?.()?.isMale?.() !== false;
  return String(text).replace(/\[he\/she\]/g, male ? "he" : "she");
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** Plays boxes one after another in the chatbox: { item } / { items: [a, b] } / { npc } / plain text. */
function showBoxes(player, boxes, then) {
  const {
    DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, StatementDialogue,
    NpcDialogue, ActionDialogue,
  } = core;
  const chain = new DialogueChainBuilder();
  let index = 0;
  for (const box of boxes) {
    const text = pronoun(player, box.text);
    if (box.items) chain.add(new DoubleItemStatementDialogue(index++, box.items[0], box.items[1], text));
    else if (box.item !== undefined) chain.add(new ItemStatementDialogue(index++, box.item, text));
    else if (box.npc !== undefined) chain.add(new NpcDialogue(index++, box.npc, text));
    else chain.add(new StatementDialogue(index++, text));
  }
  if (then) chain.add(new ActionDialogue(index++, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

module.exports = {
  init, data, STEP, ORDER, IDS, NPCS, PROGRESS_ATTRIBUTE, LEGACY_STAGE_ATTRIBUTE, EXPERIENCE_ATTRIBUTE, BANK_COINS_ATTRIBUTE, giveBankCoins,
  appliesTo, progress, isActive, setProgress, advance, advanceFrom, onStep, step,
  inTutorial, atTutorial, hasItem, worn, pronoun, later, showBoxes,
  get api() { return api; },
  get core() { return core; },
};
