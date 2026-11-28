/**
 * Rellekka's townsfolk around The Fremennik Trials, where no trial unit answers:
 *
 * - While the quest runs, those not on the council play the quest page's "not a council member" talk
 *   (rsprox 1002313 t701 Bjorn, t707 Eldgrim, t2390 Agnar; the rest the Wiki's transcript).
 * - Once it is complete, each townsperson's own page has an after-the-quest talk, and live plays it
 *   (rsprox 1002313 t7650-t8337: Eldgrim, Thora, Askeladden, Sigli, Inga, Skulgrimen, Thorvald,
 *   Sigmund, Haskell, Torfinn, Agnar, Yrsa, Peer and Swensen all greet the player by their Fremennik
 *   name). The trial units stop answering then.
 *
 * It is registered after every quest (Quests.plugin.js), so a later Fremennik quest that owns one of
 * these NPCs in its own stage window (The Fremennik Isles, Lunar Diplomacy, Olaf's Quest, The
 * Fremennik Exiles, Dragon Slayer II ...) answers first; this is only the fallback.
 */
const QuestRuntime = require("../QuestRuntime");

const QUEST_KEY = "fremennik_trials";
const QUEST_PAGE = "The Fremennik Trials";
const NOT_COUNCIL = "the-non-council-members-";
/** The Sailor's op3 version, not his Talk-to. */
const NOT_COUNCIL_EXTRA = "-travelling-to-miscellania-during-the-trials";
/** Waterbirth Island lies west of Rellekka's harbour. */
const WATERBIRTH_MAX_X = 2580;

/** Page -> its after-quest variant, or a function of the player for pages with more than one. */
const AFTER = new Map([
  // Before The Fremennik Exiles (its plugin claims him while it can start or runs; rsprox 1002313 t7551).
  ["Brundt the Chieftain", (player) => questDone(player, "the_fremennik_exiles")
    ? "standard-dialogue-after-the-fremennik-exiles" : "standard-dialogue-before-the-fremennik-exiles"],
  ["Eldgrim", "after-the-fremennik-trials"],
  ["Bjorn", "after-the-fremennik-trials"],
  ["Thora the Barkeep", "after-the-fremennik-trials"],
  ["Askeladden", (player) => onWaterbirth(player)
    ? "after-completing-the-fremennik-trials-waterbirth-island" : "after-completing-the-fremennik-trials-rellekka"],
  ["Sigli the Huntsman", "after-the-fremennik-trials"],
  ["Inga", "after-the-fremennik-trials"],
  ["Skulgrimen", "after-the-fremennik-trials"],
  ["Thorvald the Warrior", "after-the-fremennik-trials"],
  ["Sigmund The Merchant", "after-the-fremennik-trials"],
  // His after-quest "Can I come?" sails for free (Wiki rewards; rsprox 1002313 t8049-8081).
  ["Jarvald", (player) => onWaterbirth(player)
    ? "standard-dialogue-after-the-fremennik-trials-waterbirth-island" : "standard-dialogue-after-the-fremennik-trials-rellekka"],
  ["Haskell", "after-the-fremennik-trials-but-before-the-fremennik-exiles"],
  ["Torfinn", "after-the-fremennik-trials-but-before-dragon-slayer-ii"],
  ["Agnar", "after-the-fremennik-trials"],
  ["Yrsa", "after-the-fremennik-trials"],
  ["Peer the Seer", "standard-dialogue-after-the-fremennik-trials-without-a-skeletal-piece"],
  ["Swensen the Navigator", "after-the-fremennik-trials"],
  ["Olaf the Bard", "after-the-fremennik-trials"],
  ["Fish monger", "after-the-fremennik-trials"],
  ["Manni the Reveller", "after-the-fremennik-trials"],
  ["Lalli", "after-the-fremennik-trials"],
  ["Longhall Bouncer", "after-completing-the-bard-s-trial"],
]);

function questDone(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function questBegun(player, key) {
  const request = { player, key, started: false };
  api.emitCustomEvent("quest:is-started", request);
  return request.started === true || questDone(player, key);
}

function onWaterbirth(player) {
  return player.getLocation().getX() < WATERBIRTH_MAX_X;
}

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === QUEST_KEY);

function questComplete(player) {
  return Boolean(quest()?.isComplete(player));
}

function questRunning(player) {
  const q = quest();
  return Boolean(q) && q.getStage(player) >= 1 && !q.isComplete(player);
}

/**
 * From the dialogue index: NPC id -> its page among those above, and NPC id -> its "not a council
 * member" variant on the quest page.
 */
function pagesById(index) {
  const byId = new Map();
  const notCouncil = new Map();
  for (const [id, entries] of Object.entries(index ?? {})) {
    for (const entry of entries ?? []) {
      const page = String(entry.page ?? "").replace(/^Transcript:/, "");
      if (AFTER.has(page) && !byId.has(Number(id))) byId.set(Number(id), page);
      if (page !== QUEST_PAGE) continue;
      const variant = (entry.variants ?? []).find((name) => name.startsWith(NOT_COUNCIL) && !name.endsWith(NOT_COUNCIL_EXTRA));
      if (variant) notCouncil.set(Number(id), variant);
    }
  }
  return { byId, notCouncil };
}

let pageById = null;
let notCouncilById = null;

function townsfolkVariant({ npcId, player }) {
  ensurePages();
  if (!player) return null;
  if (questRunning(player)) {
    const variant = notCouncilById.get(npcId);
    return variant ? { page: QUEST_PAGE, variant } : null;
  }
  const page = pageById.get(npcId);
  if (!page || !questComplete(player)) return null;
  const variant = AFTER.get(page);
  return { page, variant: typeof variant === "function" ? variant(player) : variant };
}

// ---- what those talks ask and hand out --------------------------------------------------------------

const FLEECE_PRICE = 1000;
/** Jarvald's armour-component talk names these (Transcript:Jarvald, "Fremennik armour components"). */
const ARMOUR_COMPONENTS = ["dagannoth hide", "rock-shell chunk", "rock-shell shard", "rock-shell splinter",
  "skull piece", "ribcage piece", "fibula piece", "circular hide", "flattened hide", "stretched hide"];

let core = null;
let api = null;

/**
 * Brundt before The Fremennik Exiles (rsprox 1002313 t7551-t7563): only "Ask for a quest. | Ask about
 * anything else." until Lunar Diplomacy / Mountain Daughter are started; asking for a quest while the
 * Exiles' requirements are unmet (its plugin would have claimed him otherwise) is his "Not at the
 * moment" answer and then the requirements message box.
 */
const BRUNDT_OPTIONS = new Map([
  ["Ask about a Seal of Passage", "lunar_diplomacy"],
  ["Ask about the mountain camp.", "mountain_daughter"],
]);
const ASK_FOR_QUEST = "Ask for a quest.";
const NO_QUEST_LINE = "Do you have any quests?";
const NOT_AT_THE_MOMENT = "Not at the moment";
const EXILES_REQUIREMENTS = "You do not meet all of the requirements to start The Fremennik Exiles quest.";

function brundtMenu(notice) {
  ensurePages();
  const { player, npcId } = notice;
  if (!player || pageById.get(npcId) !== "Brundt the Chieftain" || !questComplete(player)) return;
  const options = notice.options ?? [];
  if (!options.some((option) => option.text === ASK_FOR_QUEST)) return;
  notice.options = options
    .filter((option) => !BRUNDT_OPTIONS.has(option.text) || questBegun(player, BRUNDT_OPTIONS.get(option.text)))
    .map((option) => option.text !== ASK_FOR_QUEST ? option
      : { ...option, steps: [...notQuestSteps(), { type: "message", text: EXILES_REQUIREMENTS }] });
}

/** His "Do you have any quests?" / "Not at the moment ..." from the same page's hello menu. */
function notQuestSteps() {
  const page = require("../../../data/definitions/npc-dialogues.json")["Brundt the Chieftain"];
  let found = null;
  (function walk(value) {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.text === NO_QUEST_LINE && Array.isArray(value.steps)
      && value.steps.some((step) => String(step.npc ?? step.text ?? "").startsWith(NOT_AT_THE_MOMENT))) {
      found = value.steps;
      return;
    }
    Object.values(value).forEach(walk);
  })(page);
  return found ?? [];
}

function brundtBox(action) {
  if (action.kind === "message" && action.text === EXILES_REQUIREMENTS) action.box = { statement: true };
}

const inventory = (player) => player.getInventory();
const freeSlots = (player) => inventory(player).getFreeSlots();
const holdsNamed = (player, name) => inventory(player).getValidItems().some((item) =>
  String(item.getDefinition?.()?.getName?.() ?? "").toLowerCase() === name);
const petRockKept = (player) => inventory(player).getAmount(core.ItemIdentifiers.PET_ROCK) > 0
  || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(core.ItemIdentifiers.PET_ROCK));

/** Condition text -> answer, for the pages above only. */
const CONDITIONS = new Map([
  ["If the player's inventory is full:", (player) => freeSlots(player) <= 0],
  ["If the player has inventory space but doesn't have a pet rock in their inventory, bank, or player-owned house:",
    (player) => freeSlots(player) > 0 && !petRockKept(player)],
  ["If the player has inventory space and has a pet rock in their inventory, bank, or player-owned house:",
    (player) => freeSlots(player) > 0 && petRockKept(player)],
  ["If the player has enough coins:", (player) => inventory(player).getAmount(core.ItemIdentifiers.COINS) >= FLEECE_PRICE],
  ["If the player does not have enough coins:", (player) => inventory(player).getAmount(core.ItemIdentifiers.COINS) < FLEECE_PRICE],
  ["If the player has Fremennik armour components", (player) => ARMOUR_COMPONENTS.some((name) => holdsNamed(player, name))],
]);
const HAS_ITEM = /^If the player has (?:an? )?([a-z' -]+):$/i;

function answerCondition({ player, npcId, text }) {
  ensurePages();
  if (!player || !pageById.has(npcId) || !questComplete(player)) return null;
  const value = String(text ?? "").trim();
  const known = CONDITIONS.get(value);
  if (known) return known(player);
  // Jarvald's "If the player has a skull piece:" and the like.
  const item = HAS_ITEM.exec(value)?.[1]?.toLowerCase();
  return item && ARMOUR_COMPONENTS.includes(item) ? holdsNamed(player, item) : null;
}

/** Hand-outs by step id: Askeladden's new pet rock, Lalli's fleece for 1,000 coins (Wiki: The Fremennik Trials). */
const ACTIONS = new Map([
  ["JdNEob", (player) => inventory(player).adds(core.ItemIdentifiers.PET_ROCK, 1)],
  ["8crW88", (player) => inventory(player).adds(core.ItemIdentifiers.PET_ROCK, 1)],
  ["-DoHQL", (player) => inventory(player).deleteNumber(core.ItemIdentifiers.COINS, FLEECE_PRICE)],
  ["7l2lk5", (player) => inventory(player).adds(core.ItemIdentifiers.GOLDEN_FLEECE, 1)],
]);

function handleAction(event) {
  ensurePages();
  const act = ACTIONS.get(event.stepId);
  if (!act || !event.player || !pageById.has(event.npcId) || !questComplete(event.player)) return;
  event.handled = true;
  act(event.player);
}

function ensurePages() {
  if (pageById) return;
  ({ byId: pageById, notCouncil: notCouncilById } = pagesById(require("../../../data/definitions/npc-dialogue-index.json")));
}

module.exports = function registerFremennikTrialsTownsfolk(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onNpcDialogueVariant(townsfolkVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", brundtBox);
  api.onCustomEvent("npc-dialogue:menu", brundtMenu);
};
