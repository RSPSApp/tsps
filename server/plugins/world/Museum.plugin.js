/**
 * Varrock Museum Kudos.
 *
 * Routes implemented for the Bone Voyage 100-Kudos gate (OSRS Wiki: Kudos,
 * Uncleaned find, Old symbol/Display case 36; cached transcripts for Historian
 * Minas and the six museum archaeologists):
 *   - The Dig Site cleaning activity: tools rack, specimen rocks, specimen
 *     table, the five 10-Kudos display artefacts and their case transforms.
 *   - Historian Minas timeline reports: 5 Kudos per completed quest, credited
 *     only after the player continues past the chosen branch's final speech
 *     line. The What Lies Below report still needs the Dagon'hai history book.
 *
 * Ids are from the cache: loc 24535/24556-24559, display transforms
 * 12137/12138/12139/12234/15484 (varbits 3646/3645/3649/3647/3648), items
 * 11175-11183/11195, NPC 1902 (Minas) and 1903-1908 (archaeologists).
 *
 * The cache's "using-items-on-..." variants for all four unique artefacts
 * collapse to the same wiki "(Same as above)" jewellery branch, so the real
 * item assessments are played from the same page's standard-dialogue item
 * conditions. No dialogue text is copied here.
 *
 * Not implemented: the natural history quiz, fossil displays, ancient relics
 * and salvaging. They are separate Kudos routes and are not needed for 100.
 */
"use strict";

const runtime = require("../quests/QuestRuntime");

const KUDOS_ATTRIBUTE = "museum:kudos";
const STATE_ATTRIBUTE = "museum:state";
const VARBIT_VM_KUDOS = 3637; // cache gameval vm_kudos: varp 1010, bits 0-10
const KUDOS_EVENT = "museum:get-kudos";
const KUDOS_CHANGED_EVENT = "museum:kudos-changed";

const DIG_SITE_KEY = "the_dig_site";
const WHAT_LIES_BELOW_KEY = "what_lies_below";
const TEMPLE_OF_IKOV_KEY = "temple_of_ikov";

const NPC = Object.freeze({
  HISTORIAN_MINAS: 1902,
  ARCHAEOLOGISTS: new Set([1903, 1904, 1905, 1906, 1907, 1908]),
});

const ARCHAEOLOGIST_PAGES = new Map([
  [1903, "Barnabus Hurma"],
  [1904, "Marius Giste"],
  [1905, "Caden Azro"],
  [1906, "Thias Leacke"],
  [1907, "Sinco Doar"],
  [1908, "Tinse Torpe"],
]);

const ITEM = Object.freeze({
  UNCLEANED_FIND: 11175,
  ARROWHEADS: 11176,
  JEWELLERY: 11177,
  POTTERY: 11178,
  OLD_COIN: 11179,
  ANCIENT_COIN: 11180,
  ANCIENT_SYMBOL: 11181,
  OLD_SYMBOL: 11182,
  OLD_CHIPPED_VASE: 11183,
  CLEAN_NECKLACE: 11195,
  BROKEN_ARROW: 687,
  BROKEN_GLASS: 690,
  IRON_DAGGER: 1203,
  UNCUT_JADE: 1627,
  BONES: 526,
  COINS: 995,
  DAGONHAI_HISTORY: 11001,
  TROWEL: 676,
  ROCK_PICK: 675,
  SPECIMEN_BRUSH: 670,
  LEATHER_GLOVES: new Set([1059, 1060]),
  LEATHER_BOOTS: new Set([1061, 1062, 6893]),
});

const OBJECT = Object.freeze({
  TOOLS: 24535,
  SPECIMEN_TABLE: 24556,
  SPECIMEN_ROCKS: new Set([24557, 24558, 24559]),
});

const ARTEFACTS = new Map([
  [ITEM.OLD_SYMBOL, {
    name: "old symbol", caseNumber: 36, varbit: 3646, x: 3262, y: 3448,
    objectIds: new Set([12137, 24550, 24539]),
  }],
  [ITEM.ANCIENT_SYMBOL, {
    name: "ancient symbol", caseNumber: 37, varbit: 3645, x: 3262, y: 3450,
    objectIds: new Set([12138, 24550, 24540]),
  }],
  [ITEM.POTTERY, {
    name: "pottery", caseNumber: 22, varbit: 3649, x: 3259, y: 3452,
    objectIds: new Set([12139, 24543, 24542]),
  }],
  [ITEM.ANCIENT_COIN, {
    name: "ancient coin", caseNumber: 44, varbit: 3647, x: 3259, y: 3450,
    objectIds: new Set([12234, 24550, 24548]),
  }],
  [ITEM.OLD_COIN, {
    name: "old coin", caseNumber: 45, varbit: 3648, x: 3259, y: 3448,
    objectIds: new Set([15484, 24550, 24549]),
  }],
]);

const CASE_BY_TILE = new Map([...ARTEFACTS].map(([itemId, entry]) => [`${entry.x},${entry.y}`, itemId]));
const UNIQUE_DISPLAY_ARTEFACTS = new Set([ITEM.OLD_SYMBOL, ITEM.ANCIENT_SYMBOL, ITEM.OLD_COIN, ITEM.ANCIENT_COIN]);

/**
 * 2x the Wiki's /51 cleaning table, so every probability is an integer.
 * Unique entries are fixed slots: a held/displayed unique is replaced by the
 * unremarkable category at the same weight, never filtered and renormalised.
 */
const CLEANING_UNIQUES = [
  { itemId: ITEM.OLD_SYMBOL, weight: 6 },
  { itemId: ITEM.ANCIENT_SYMBOL, weight: 6 },
  { itemId: ITEM.OLD_COIN, weight: 6 },
  { itemId: ITEM.ANCIENT_COIN, weight: 6 },
  { itemId: ITEM.CLEAN_NECKLACE, weight: 2 },
];
const CLEANING_COMMONS = [
  { itemId: ITEM.POTTERY, weight: 19 },
  { itemId: ITEM.JEWELLERY, weight: 19 },
  { itemId: ITEM.OLD_CHIPPED_VASE, weight: 19 },
  { itemId: ITEM.ARROWHEADS, weight: 19 },
];
const CLEANING_TOTAL_WEIGHT = 102; // 2 * 51
/** Conditional unremarkable weights (Wiki /459 is the unconditional 117/459 = 13/51). */
const UNREMARKABLE_TABLE = [
  { itemId: ITEM.BROKEN_ARROW, weight: 26 },
  { itemId: ITEM.BROKEN_GLASS, weight: 26 },
  { itemId: ITEM.IRON_DAGGER, weight: 26 },
  { itemId: ITEM.UNCUT_JADE, weight: 13 },
  { itemId: ITEM.BONES, weight: 13 },
  { itemId: ITEM.COINS, weight: 13, amount: 5 },
];
const UNREMARKABLE_TOTAL_WEIGHT = 117;

const ASSESSMENT_ORDER = [
  ITEM.CLEAN_NECKLACE,
  ITEM.OLD_COIN,
  ITEM.ANCIENT_COIN,
  ITEM.ANCIENT_SYMBOL,
  ITEM.OLD_SYMBOL,
  ITEM.POTTERY,
  ITEM.ARROWHEADS,
  ITEM.JEWELLERY,
  ITEM.OLD_CHIPPED_VASE,
];

const ASSESSMENT_OUTER = new Map([
  ["if the player has a clean necklace", ITEM.CLEAN_NECKLACE],
  ["if the player has an old coin,", ITEM.OLD_COIN],
  ["if the player has an ancient coin,", ITEM.ANCIENT_COIN],
  ["if the player has an ancient symbol,", ITEM.ANCIENT_SYMBOL],
  ["if the player has an old symbol,", ITEM.OLD_SYMBOL],
  ["if the player has a piece of pottery,", ITEM.POTTERY],
  ["if the player has arrowheads,", ITEM.ARROWHEADS],
  ["if the player has a piece of jewellery,", ITEM.JEWELLERY],
  ["if the player has an old chipped vase,", ITEM.OLD_CHIPPED_VASE],
]);

const ASSESSMENT_INNER = new Map([
  ["clean necklace", ITEM.CLEAN_NECKLACE],
  ["old coin", ITEM.OLD_COIN],
  ["ancient coin", ITEM.ANCIENT_COIN],
  ["ancient symbol", ITEM.ANCIENT_SYMBOL],
  ["old symbol", ITEM.OLD_SYMBOL],
  ["pottery", ITEM.POTTERY],
  ["arrowheads", ITEM.ARROWHEADS],
  ["jewellery", ITEM.JEWELLERY],
  ["old chipped vase", ITEM.OLD_CHIPPED_VASE],
]);

const MINAS_QUESTS = new Map([
  ["S57fCr", "demon_slayer"],
  ["QqHvp-", "shield_of_arrav"],
  ["oGD9-i", "rune_mysteries"],
  ["GpIr8R", "observatory_quest"],
  ["RaNFxc", "merlins_crystal"],
  ["EZzFyt", "grand_tree"],
  ["3q8-VQ", "priest_in_peril"],
  ["dHMXRQ", "in_aid_of_the_myreque"],
  ["Yq_0tv", "a_tail_of_two_cats"],
  ["4Ij9Rt", "making_history"],
  ["SJoct1", TEMPLE_OF_IKOV_KEY],
  ["9_Sehd", "hazeel_cult"],
  ["jeha67", "defender_of_varrock"],
]);
const MINAS_FALLBACK = "wVA1Ww";
const MINAS_WLB_OUTER = "IqnOid";
const MINAS_WLB_NO_BOOK = "rwZB6h";
const MINAS_WLB_BOOK = "owQpNk";
const MINAS_TEMPLE_GUARDIANS = "-rp2hA";
const MINAS_TEMPLE_LUCIEN = "VwYHY3";
const MINAS_CURSE = "0sSqOl";

/**
 * Historian Minas lamps (OSRS Wiki Antique lamp (Varrock Museum) switch:
 * 11185 Merlin's Crystal, 11186 Shield of Arrav, 11187 Making History,
 * 28820 Defender of Varrock; 11188 is Curse of the Empty Lord). XP/minimum
 * skill level from the same page and OSRS Wiki Antique lamp.
 */
const LAMPS = new Map([
  [11185, { xp: 1000, minLevel: 20, quest: "merlins_crystal" }],
  [11186, { xp: 1000, minLevel: 20, quest: "shield_of_arrav" }],
  [11187, { xp: 1000, minLevel: 20, quest: "making_history" }],
  [28820, { xp: 5000, minLevel: 30, quest: "defender_of_varrock" }],
]);
const LAMP_BY_QUEST = new Map([...LAMPS].map(([itemId, lamp]) => [lamp.quest, { itemId, ...lamp }]));

const TOOL_ITEMS = [
  [ITEM.TROWEL, "trowel"],
  [ITEM.ROCK_PICK, "rock pick"],
  [ITEM.SPECIMEN_BRUSH, "specimen brush"],
  [1059, "leather gloves"],
  [1061, "leather boots"],
];

let api = null;
const pendingMinas = new WeakMap();
const pendingLamp = new WeakMap();

const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

function kudosOf(player) {
  return Number(player.getAttribute(KUDOS_ATTRIBUTE)) || 0;
}

function stateOf(player) {
  const raw = player.getAttribute(STATE_ATTRIBUTE);
  return raw && typeof raw === "object" ? raw : {};
}

function writeState(player, state) {
  player.setAttribute(STATE_ATTRIBUTE, state);
}

function digOf(player) {
  const state = stateOf(player);
  return state.dig && typeof state.dig === "object" ? state.dig : {};
}

function reportedOf(player) {
  const state = stateOf(player);
  return Array.isArray(state.minas) ? state.minas : [];
}

function isReported(player, key) {
  return reportedOf(player).includes(key);
}

function markReported(player, key) {
  const state = stateOf(player);
  writeState(player, { ...state, minas: [...new Set([...reportedOf(player), key])] });
}

function isDisplayed(player, itemId) {
  return Array.isArray(digOf(player).displayed) && digOf(player).displayed.includes(itemId);
}

function isShown(player, itemId) {
  return Array.isArray(digOf(player).shown) && digOf(player).shown.includes(itemId);
}

function updateDig(player, key, itemId) {
  const state = stateOf(player);
  const dig = state.dig && typeof state.dig === "object" ? state.dig : {};
  const current = Array.isArray(dig[key]) ? dig[key] : [];
  writeState(player, { ...state, dig: { ...dig, [key]: [...new Set([...current, itemId])] } });
}

function sendKudosVarbit(player) {
  const value = Math.max(0, Math.min(2047, Math.floor(kudosOf(player))));
  player.getPacketSender().sendVarbit(VARBIT_VM_KUDOS, value);
}

function awardKudos(player, amount, source) {
  const next = kudosOf(player) + amount;
  player.setAttribute(KUDOS_ATTRIBUTE, next);
  sendKudosVarbit(player);
  api.emitCustomEvent(KUDOS_CHANGED_EVENT, { player, kudos: next, amount, source });
  return next;
}

function isQuestComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function syncDisplayVarbits(player) {
  const sender = player.getPacketSender();
  for (const [itemId, entry] of ARTEFACTS) {
    if (isDisplayed(player, itemId)) sender.sendVarbit(entry.varbit, 1);
  }
}

function takeFind({ player, objectId }) {
  if (!OBJECT.SPECIMEN_ROCKS.has(objectId)) return false;
  if (!isQuestComplete(player, DIG_SITE_KEY)) {
    player.sendMessage("You need to have completed The Dig Site to clean finds here.");
    return true;
  }
  if (player.getInventory().isFull()) {
    player.sendMessage("You have no space in your inventory.");
    return true;
  }
  player.getInventory().adds(ITEM.UNCLEANED_FIND, 1);
  return true;
}

function takeTools({ player, objectId }) {
  if (objectId !== OBJECT.TOOLS) return false;
  const missing = TOOL_ITEMS.filter(([itemId]) => !has(player, itemId));
  if (!missing.length) {
    player.sendMessage("You already have the tools.");
    return true;
  }
  if (player.getInventory().getFreeSlots() < missing.length) {
    player.sendMessage("You have no space in your inventory.");
    return true;
  }
  for (const [itemId] of missing) player.getInventory().adds(itemId, 1);
  player.sendMessage("You take the tools from the rack.");
  return true;
}

function hasCleaningTools(player) {
  const equipment = player.getEquipment()?.getItems?.() ?? [];
  const worn = (ids) => equipment.some((item) => ids.has(item?.getId?.()));
  return has(player, ITEM.TROWEL) && has(player, ITEM.ROCK_PICK) && has(player, ITEM.SPECIMEN_BRUSH)
    && worn(ITEM.LEATHER_GLOVES) && worn(ITEM.LEATHER_BOOTS);
}

function cleanFind(event) {
  const { player, itemId, objectId } = event;
  if (objectId !== OBJECT.SPECIMEN_TABLE || itemId !== ITEM.UNCLEANED_FIND) return;
  event.handled = true;
  if (!isQuestComplete(player, DIG_SITE_KEY)) {
    player.sendMessage("You need to have completed The Dig Site to clean finds here.");
    return;
  }
  if (!hasCleaningTools(player)) {
    player.sendMessage("You need a trowel, rock pick, specimen brush, leather gloves and leather boots to clean finds.");
    return;
  }
  player.getInventory().delete(ITEM.UNCLEANED_FIND, 1);
  if (Math.random() < 0.14) {
    player.sendMessage("The find crumbles to dust in your hands - oops! Better not let the professionals see that one!");
    return;
  }
  const rolls = [];
  for (const entry of CLEANING_UNIQUES) {
    const suppressed = isDisplayed(player, entry.itemId) || has(player, entry.itemId);
    rolls.push(suppressed ? { unremarkable: true, weight: entry.weight } : entry);
  }
  rolls.push(...CLEANING_COMMONS);
  let roll = Math.random() * CLEANING_TOTAL_WEIGHT, picked = rolls[rolls.length - 1];
  for (const entry of rolls) {
    roll -= entry.weight;
    if (roll < 0) { picked = entry; break; }
  }
  if (!picked) return;
  if (picked.unremarkable) {
    let inner = Math.random() * UNREMARKABLE_TOTAL_WEIGHT;
    picked = UNREMARKABLE_TABLE[UNREMARKABLE_TABLE.length - 1];
    for (const entry of UNREMARKABLE_TABLE) {
      inner -= entry.weight;
      if (inner < 0) { picked = entry; break; }
    }
    player.getInventory().adds(picked.itemId, picked.amount ?? 1);
    player.sendMessage(picked.amount
      ? `You find ${picked.amount} coins.`
      : "You find something unremarkable.");
    return;
  }
  player.getInventory().adds(picked.itemId, 1);
  const name = [...ARTEFACTS.entries()].find(([id]) => id === picked.itemId)?.[1]?.name;
  player.sendMessage(name ? `You find ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}.` : "You find something interesting.");
}

function selectInteresting(steps) {
  for (const step of steps ?? []) {
    for (const option of step.options ?? []) {
      if (String(option.text ?? "").toLowerCase().includes("i found something interesting")) {
        return option.steps;
      }
    }
    const nested = selectInteresting(step.steps);
    if (nested) return nested;
  }
  return null;
}

function showArtefact(event) {
  const { player, itemId, npcId } = event;
  const page = ARCHAEOLOGIST_PAGES.get(npcId);
  if (!page || !ARTEFACTS.has(itemId)) return;
  event.handled = true;
  runtime.startTranscript(api, player, npcId, page, "standard-dialogue", selectInteresting);
}

function outerItem(text) {
  const lower = String(text ?? "").toLowerCase();
  for (const [prefix, itemId] of ASSESSMENT_OUTER) {
    if (lower.startsWith(prefix)) return itemId;
  }
  return null;
}

function innerItem(text) {
  const lower = String(text ?? "").toLowerCase();
  for (const [name, itemId] of ASSESSMENT_INNER) {
    if (lower.includes(name)) return itemId;
  }
  return null;
}

function answerArtefactCondition({ player, npcId, text }) {
  if (!NPC.ARCHAEOLOGISTS.has(npcId)) return null;
  const lower = String(text ?? "").toLowerCase();
  if (lower.startsWith("if the player doesn't have any of the above")) {
    return ASSESSMENT_ORDER.every((itemId) => !has(player, itemId));
  }
  const outer = outerItem(text);
  if (outer !== null) {
    if (!has(player, outer)) return false;
    const index = ASSESSMENT_ORDER.indexOf(outer);
    return !ASSESSMENT_ORDER.slice(0, index).some((itemId) => has(player, itemId));
  }
  if (lower.includes("for the first time")) {
    const itemId = innerItem(text);
    return itemId !== null && has(player, itemId) && !isShown(player, itemId) && !isDisplayed(player, itemId);
  }
  if (lower.includes("after being told")) {
    const itemId = innerItem(text);
    return itemId !== null && has(player, itemId) && isShown(player, itemId) && !isDisplayed(player, itemId);
  }
  if (lower.includes("after putting it in a display case")) {
    const itemId = innerItem(text);
    return itemId !== null && has(player, itemId) && isDisplayed(player, itemId);
  }
  return null;
}

function recordArtefactCondition({ player, npcId, text }) {
  if (!NPC.ARCHAEOLOGISTS.has(npcId)) return;
  if (!String(text ?? "").toLowerCase().includes("for the first time")) return;
  const itemId = innerItem(text);
  if (itemId !== null && ARTEFACTS.has(itemId)) updateDig(player, "shown", itemId);
}

function placeArtefact(event) {
  const { player, itemId, objectId, location } = event;
  const artefact = ARTEFACTS.get(itemId);
  if (!artefact || !location || !artefact.objectIds.has(objectId)) return;
  if (CASE_BY_TILE.get(`${location.x},${location.y}`) !== itemId) return;
  event.handled = true;
  if (!has(player, itemId)) return;
  if (isDisplayed(player, itemId)) {
    player.sendMessage("You've already shown one of those. You can pop this one in the finds crate over in the corner.");
    return;
  }
  const inventory = player.getInventory();
  if (UNIQUE_DISPLAY_ARTEFACTS.has(itemId)) {
    const carried = inventory.getAmount(itemId);
    if (carried > 0) inventory.deleteNumber(itemId, carried);
    for (const bank of player.getBanks?.() ?? []) {
      const stored = bank?.getAmount?.(itemId) ?? 0;
      if (stored > 0) bank.deleteNumber(itemId, stored);
    }
  } else {
    inventory.delete(itemId, 1);
  }
  updateDig(player, "displayed", itemId);
  player.getPacketSender().sendVarbit(artefact.varbit, 1);
  awardKudos(player, 10, `display:${artefact.name}`);
  player.sendMessage(`You place the ${artefact.name} in display case ${artefact.caseNumber}.`);
}

function hasUnreportedMinasReport(player) {
  for (const [, key] of MINAS_QUESTS) {
    if (!isReported(player, key) && isQuestComplete(player, key)) return true;
  }
  return !isReported(player, WHAT_LIES_BELOW_KEY) && isQuestComplete(player, WHAT_LIES_BELOW_KEY);
}

function answerMinasCondition({ player, npcId, stepId }) {
  if (npcId !== NPC.HISTORIAN_MINAS) return null;
  if (stepId === MINAS_FALLBACK) return !hasUnreportedMinasReport(player);
  if (stepId === MINAS_WLB_OUTER) {
    return isQuestComplete(player, WHAT_LIES_BELOW_KEY) && !isReported(player, WHAT_LIES_BELOW_KEY);
  }
  if (stepId === MINAS_WLB_NO_BOOK) {
    return isQuestComplete(player, WHAT_LIES_BELOW_KEY) && !isReported(player, WHAT_LIES_BELOW_KEY)
      && !has(player, ITEM.DAGONHAI_HISTORY);
  }
  if (stepId === MINAS_WLB_BOOK) {
    return isQuestComplete(player, WHAT_LIES_BELOW_KEY) && !isReported(player, WHAT_LIES_BELOW_KEY)
      && has(player, ITEM.DAGONHAI_HISTORY);
  }
  if (stepId === MINAS_CURSE) return false;
  if (stepId === MINAS_TEMPLE_GUARDIANS) {
    return isQuestComplete(player, TEMPLE_OF_IKOV_KEY)
      && Number(player.getAttribute("quest.temple_of_ikov.side")) === 1;
  }
  if (stepId === MINAS_TEMPLE_LUCIEN) {
    return isQuestComplete(player, TEMPLE_OF_IKOV_KEY)
      && Number(player.getAttribute("quest.temple_of_ikov.side")) === 2;
  }
  const key = MINAS_QUESTS.get(stepId);
  if (!key) return null;
  return !isReported(player, key) && isQuestComplete(player, key);
}

function findStep(steps, stepId) {
  for (const step of steps ?? []) {
    if (step.id === stepId) return step;
    const nested = findStep(step.steps, stepId);
    if (nested) return nested;
    for (const option of step.options ?? []) {
      const inOption = findStep(option.steps, stepId);
      if (inOption) return inOption;
    }
  }
  return null;
}

function lastSpeech(steps) {
  let last = null;
  for (const step of steps ?? []) {
    if (typeof step.player === "string") last = step.player;
    else if (typeof step.npc === "string") last = step.npc;
    else if (step.type === "line" && typeof step.text === "string") last = step.text;
    const nested = lastSpeech(step.steps);
    if (nested !== null) last = nested;
    for (const option of step.options ?? []) {
      const inOption = lastSpeech(option.steps);
      if (inOption !== null) last = inOption;
    }
  }
  return last;
}

function recordMinasCondition({ player, npcId, stepId }) {
  if (npcId !== NPC.HISTORIAN_MINAS) return;
  const key = stepId === MINAS_WLB_BOOK ? WHAT_LIES_BELOW_KEY : MINAS_QUESTS.get(stepId);
  if (!key || isReported(player, key) || !isQuestComplete(player, key)) return;
  const page = runtime.loadTranscripts(api)["Historian Minas"];
  const step = findStep(page?.steps, stepId);
  const finalLine = lastSpeech(step?.steps);
  if (finalLine) pendingMinas.set(player, { key, finalLine });
}

function startMinasConversation({ player, npcId }) {
  if (npcId === NPC.HISTORIAN_MINAS) pendingMinas.delete(player);
}

function completeMinasLine(request) {
  const { player, npcId, text } = request;
  if (npcId !== NPC.HISTORIAN_MINAS) return;
  const pending = pendingMinas.get(player);
  if (!pending || String(text ?? "").trim() !== pending.finalLine.trim()) return;
  request.after = () => {
    if (pendingMinas.get(player) !== pending) return;
    pendingMinas.delete(player);
    if (isReported(player, pending.key) || !isQuestComplete(player, pending.key)) return;
    if (pending.key === WHAT_LIES_BELOW_KEY && !has(player, ITEM.DAGONHAI_HISTORY)) return;
    if (!grantReportLamp(player, pending.key)) return;
    markReported(player, pending.key);
    awardKudos(player, 5, `minas:${pending.key}`);
  };
}

function grantReportLamp(player, questKey) {
  const lamp = LAMP_BY_QUEST.get(questKey);
  if (!lamp) return true;
  if (has(player, lamp.itemId)) return true;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You need at least 1 free inventory space to receive the lamp.");
    return false;
  }
  player.getInventory().adds(lamp.itemId, 1);
  return true;
}

function rubLamp(event) {
  const lamp = LAMPS.get(event.itemId);
  if (!lamp) return false;
  const { player, item, slot } = event;
  if (player.getInventory().get(slot) !== item) return true;
  const request = { item, slot, lamp };
  pendingLamp.set(player, request);
  api.emitCustomEvent("xpreward:open", {
    player,
    minLevel: lamp.minLevel,
    title: "Choose the stat you wish to be advanced!",
    onConfirm: (skill, name) => grantLampExperience(player, request, skill, name),
  });
  return true;
}

function grantLampExperience(player, request, skill, name = skill.getName()) {
  if (pendingLamp.get(player) !== request) return null;
  pendingLamp.delete(player);
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item) return null;
  const manager = player.getSkillManager();
  if (manager.getMaxLevel(skill) < request.lamp.minLevel) {
    player.sendMessage(`You need at least level ${request.lamp.minLevel} in ${name} to use this lamp.`);
    return null;
  }
  const before = manager.getExperience(skill);
  manager.addExperience(skill, request.lamp.xp, false);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  return `<col=0000ff>Your wish has been granted!</col> You have been awarded ${request.lamp.xp.toLocaleString("en-GB")} ${name} experience!`;
}

function answerGetKudos(request) {
  if (!request?.player) return;
  request.kudos = kudosOf(request.player);
}

function handleLogin({ player }) {
  syncDisplayVarbits(player);
  sendKudosVarbit(player);
}

function handleBootstrap({ player }) {
  sendKudosVarbit(player);
}

module.exports = {
  name: "Museum",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.persistAttribute(KUDOS_ATTRIBUTE, 0);
    pluginApi.persistAttribute(STATE_ATTRIBUTE, null);
    pluginApi.onCustomEvent(KUDOS_EVENT, answerGetKudos);
    pluginApi.onCustomEvent("npc-dialogue:menu", startMinasConversation);
    pluginApi.onCustomEvent("npc-dialogue:condition", recordMinasCondition);
    pluginApi.onCustomEvent("npc-dialogue:condition", recordArtefactCondition);
    pluginApi.onCustomEvent("npc-dialogue:line", completeMinasLine);
    pluginApi.onNpcDialogueCondition(answerMinasCondition);
    pluginApi.onNpcDialogueCondition(answerArtefactCondition);
    pluginApi.onObjectInteraction("Dig Site specimen rocks", { Take: takeFind });
    pluginApi.onObjectInteraction("Tools", { Take: takeTools });
    pluginApi.onItemOnObject(cleanFind);
    pluginApi.onItemOnObject(placeArtefact);
    pluginApi.onItemOnNpc(showArtefact);
    pluginApi.onItemAction("Antique lamp", { Rub: rubLamp });
    pluginApi.onPlayerLogin(handleLogin);
    pluginApi.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  },
};
