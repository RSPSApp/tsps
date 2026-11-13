/**
 * Varrock Museum Kudos.
 *
 * Routes implemented for the Bone Voyage 100-Kudos gate (OSRS Wiki: Kudos,
 * Uncleaned find, Old symbol/Display case 36; cached transcripts for Historian
 * Minas and the six museum archaeologists):
 *   - The Dig Site cleaning activity: tools rack, specimen rocks, specimen
 *     table, the five 10-Kudos display artefacts and their case transforms.
 *   - Historian Minas timeline reports: 5 Kudos per completed quest and the
 *     timeline display varbit, credited at the branch's final speech line
 *     (rsprox captures 3278, 1757, 1843; docs/varrock-museum.md). The What
 *     Lies Below report still needs the Dagon'hai history book.
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
 *   - The natural history quiz (museum/NaturalHistoryQuiz.Museum.js): 2 Kudos per
 *     display case, through AWARD_KUDOS_EVENT.
 *
 *   - The Sailing salvaging relics (museum/SalvagingRelics.Museum.js): Inspect, and handing each
 *     to Curator Haig Halen for 1 Kudos and an antique lamp, or 5,000 coins once claimed.
 *
 * Not implemented: fossil displays and ancient relics. They are separate Kudos routes and are
 * not needed for 100.
 */
"use strict";

const runtime = require("../quests/QuestRuntime");

const KUDOS_ATTRIBUTE = "museum:kudos";
const STATE_ATTRIBUTE = "museum:state";
const VARBIT_VM_KUDOS = 3637; // cache gameval vm_kudos: varp 1010, bits 0-10
const KUDOS_EVENT = "museum:get-kudos";
const AWARD_KUDOS_EVENT = "museum:award-kudos";
const HAS_KIT_EVENT = "archaeology:has-kit";
const KUDOS_CHANGED_EVENT = "museum:kudos-changed";
// rsprox 3278, 1757, 1843, 1723, 960: every vm_kudos rise (reports, display cases, the quiz,
// salvaging finds) comes with this spam message and synth sound 3653 on the same tick.
const KUDOS_MESSAGE = "You have earned Kudos with the Museum!";
const SOUND_KUDOS = 3653;

const DIG_SITE_KEY = "the_dig_site";
const WHAT_LIES_BELOW_KEY = "what_lies_below";
const TEMPLE_OF_IKOV_KEY = "temple_of_ikov";
const EMPTY_LORD_KEY = "curse_of_the_empty_lord";

const KUDOS_INFO_INTERFACE = 600; // cache gameval vm_kudos_info
const KUDOS_HUD_INTERFACE = 532; // cache gameval vm_kudos
const OVERLAY_HUD_UID = (161 << 16) | 8; // toplevel:overlay_hud
const DISPLAYS = require("./data/museum-displays.json");
const DIGSITE_INTERFACE = 528; // cache gameval vm_digsite
const TIMELINE_INTERFACE = 534; // cache gameval vm_timeline
const DISPLAY_NUMBER_COMPONENT = Object.freeze({ [DIGSITE_INTERFACE]: 16, [TIMELINE_INTERFACE]: 84 });
const DISPLAY_TEXT_COMPONENT = 2;
const DISPLAY_STUDY_SEQUENCE = 6383;
const DISPLAY_BUSY_VARBIT = 12393;
const DISPLAY_SPINNER_SCRIPT = 65;
const DISPLAY_SCREEN_SCRIPT = 2524;
/**
 * The museum's ground floor (Digsite), first and second floors (timeline) and the natural
 * history basement instance. Only players inside see the Kudos HUD (vm_kudos).
 */
// Cache241 walls23818/23826/23829 enclose the hall and north-east stair wing.
// Normal-world rsprox960 ticks1438–1442/1606–1608 keep532 off the exterior approach.
const MUSEUM_BOUNDS = [
  { minX: 3253, maxX: 3267, minY: 3442, maxY: 3455, z: 0 },
  { minX: 3265, maxX: 3267, minY: 3456, maxY: 3459, z: 0 },
  { minX: 3253, maxX: 3267, minY: 3442, maxY: 3455, z: 1 },
  { minX: 3265, maxX: 3267, minY: 3456, maxY: 3459, z: 1 },
  { minX: 3253, maxX: 3267, minY: 3442, maxY: 3455, z: 2 },
  { minX: 3265, maxX: 3267, minY: 3456, maxY: 3459, z: 2 },
  { minX: 1735, maxX: 1785, minY: 4935, maxY: 4980, z: 0 },
];

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
 * skill level from the same page and OSRS Wiki Antique lamp. Curse of the Empty Lord's report
 * is worth 10 kudos, the rest 5, and needs a complete set of ghostly robes (Wiki: Historian
 * Minas, Kudos).
 */
const LAMPS = new Map([
  [11185, { xp: 1000, minLevel: 20, quest: "merlins_crystal" }],
  [11186, { xp: 1000, minLevel: 20, quest: "shield_of_arrav" }],
  [11187, { xp: 1000, minLevel: 20, quest: "making_history" }],
  [28820, { xp: 5000, minLevel: 30, quest: "defender_of_varrock" }],
  [11188, { xp: 10000, minLevel: 50, quest: EMPTY_LORD_KEY }],
]);
const REPORT_KUDOS = new Map([[EMPTY_LORD_KEY, 10]]);
/**
 * The timeline display each report puts up, as [varbit, value] (varp 1011). From rsprox
 * captures 3278, 1757 and 1843, sent just before the report's Kudos. vm_observatory (3652) and
 * vm_surok (3660) are not captured; their cache display cases (24642, 24662) show the display
 * at 1. Priest in Peril and In Aid of the Myreque share vm_salveknights, Temple of Ikov and
 * Curse of the Empty Lord share vm_staff_of_armadyl: the later report raises it (1 -> 2).
 */
const REPORT_DISPLAY_VARBITS = new Map([
  ["demon_slayer", [[3653, 1]]], // vm_silverlight
  ["shield_of_arrav", [[3656, 1], [9679, 1]]], // vm_soa, vm_soa_vis
  ["rune_mysteries", [[3661, 1]]], // vm_runes
  ["observatory_quest", [[3652, 1]]], // vm_observatory
  ["merlins_crystal", [[3655, 1]]], // vm_excalibur
  ["grand_tree", [[3658, 1]]], // vm_glider
  ["priest_in_peril", [[3651, 1]]], // vm_salveknights
  ["in_aid_of_the_myreque", [[3651, 2]]],
  ["a_tail_of_two_cats", [[3657, 1]]], // vm_robert
  ["making_history", [[3654, 1]]], // vm_lathas
  [TEMPLE_OF_IKOV_KEY, [[3650, 1]]], // vm_staff_of_armadyl
  [EMPTY_LORD_KEY, [[3650, 2]]],
  ["hazeel_cult", [[3659, 1]]], // vm_ardy
  [WHAT_LIES_BELOW_KEY, [[3660, 1]]], // vm_surok
  ["defender_of_varrock", [[9678, 1]]], // vm_dov
]);
/** Minas's lamp hand-out line (a message box, with the same game message, in rsprox 3278/1757). */
const LAMP_MESSAGE = "You receive an old lamp.";
const GHOSTLY_ROBES = ["GHOSTLY_ROBE", "GHOSTLY_ROBE_2", "GHOSTLY_BOOTS", "GHOSTLY_HOOD", "GHOSTLY_GLOVES", "GHOSTLY_CLOAK"]; // top, bottom, boots, hood, gloves, cloak
const LAMP_BY_QUEST = new Map([...LAMPS].map(([itemId, lamp]) => [lamp.quest, { itemId, ...lamp }]));
/**
 * Curator Haig Halen's lamps for salvaged relics (Wiki: Antique lamp (salvaging)): small, medium
 * and large, for any skill at or above the lamp's level.
 */
const SALVAGE_LAMPS = new Map([
  [32871, { xp: 5000, minLevel: 30 }], // salvaging_rare_lamp_small
  [32872, { xp: 10000, minLevel: 40 }], // salvaging_rare_lamp_med
  [32873, { xp: 15000, minLevel: 50 }], // salvaging_rare_lamp_large
]);

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
/** What the last finished Minas report did with its lamp, for the lamp line that follows it. */
const lampOutcome = new WeakMap();
const LAMP = Object.freeze({ NONE: "none", GIVEN: "given", KEPT: "kept", REFUSED: "refused" });
/** Players who have reported at least one quest in the current Minas conversation. */
const reportedInConversation = new WeakSet();
/** Players whose Museum area mounted the Kudos HUD in toplevel:overlay_hud. */
const kudosHudShown = new WeakSet();
/** Players with a museum display case open (The Golem's case 30 clears its own busy varbit). */
const studyingDisplay = new WeakSet();
/** Players whose Kudos HUD Study hid, to show again when the case closes. */
const hudHiddenForStudy = new WeakSet();
/** Players reading Check Kudos (busy until it closes). */
const readingKudosInfo = new WeakSet();

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
  // rsprox 227/01723.txt:300257: the line is spam (filtered chat), not a game message.
  player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, KUDOS_MESSAGE);
  player.getPacketSender().sendSound(SOUND_KUDOS, 255, 0);
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
  const reported = new Set(reportedOf(player));
  for (const varbit of reportVarbits(REPORT_DISPLAY_VARBITS.keys())) {
    const value = reportVarbitValue(reported, varbit);
    if (value > 0) sender.sendVarbit(varbit, value);
  }
}

function reportVarbits(keys) {
  return new Set([...keys].flatMap((key) => (REPORT_DISPLAY_VARBITS.get(key) ?? []).map(([varbit]) => varbit)));
}

/** A shared display varbit shows the highest value any reported quest gives it. */
function reportVarbitValue(reported, varbit) {
  let value = 0;
  for (const key of reported) {
    for (const [id, set] of REPORT_DISPLAY_VARBITS.get(key) ?? []) {
      if (id === varbit) value = Math.max(value, set);
    }
  }
  return value;
}

function sendReportVarbits(player, key) {
  const reported = new Set(reportedOf(player));
  const sender = player.getPacketSender();
  for (const varbit of reportVarbits([key])) sender.sendVarbit(varbit, reportVarbitValue(reported, varbit));
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

/** HAS_KIT_EVENT `{ player, hasKit }`: the full kit, for other cleaning benches (Fossil Island's). */
function answerHasKit(request) {
  if (request?.player) request.hasKit = hasCleaningTools(request.player);
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

/** Every ghostly robe piece, carried or worn (Wiki: "Requires a complete set of ghostly robes"). */
function hasGhostlyRobes(player) {
  const worn = player.getEquipment();
  return GHOSTLY_ROBES.map((name) => api.core.ItemIdentifiers[name])
    .every((itemId) => has(player, itemId) || worn.getAmount(itemId) > 0);
}

function hasUnreportedMinasReport(player) {
  for (const [, key] of MINAS_QUESTS) {
    if (!isReported(player, key) && isQuestComplete(player, key)) return true;
  }
  if (!isReported(player, EMPTY_LORD_KEY) && isQuestComplete(player, EMPTY_LORD_KEY) && hasGhostlyRobes(player)) return true;
  return !isReported(player, WHAT_LIES_BELOW_KEY) && isQuestComplete(player, WHAT_LIES_BELOW_KEY);
}

function answerMinasCondition({ player, npcId, stepId }) {
  if (npcId !== NPC.HISTORIAN_MINAS) return null;
  if (stepId === MINAS_FALLBACK) {
    return !hasUnreportedMinasReport(player) && !reportedInConversation.has(player);
  }
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
  if (stepId === MINAS_CURSE) {
    return isQuestComplete(player, EMPTY_LORD_KEY) && !isReported(player, EMPTY_LORD_KEY) && hasGhostlyRobes(player);
  }
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
  const key = stepId === MINAS_WLB_BOOK ? WHAT_LIES_BELOW_KEY : stepId === MINAS_CURSE ? EMPTY_LORD_KEY : MINAS_QUESTS.get(stepId);
  if (!key || isReported(player, key) || !isQuestComplete(player, key)) return;
  const page = runtime.loadTranscripts(api)["Historian Minas"];
  const step = findStep(page?.steps, stepId);
  const finalLine = lastSpeech(step?.steps);
  if (finalLine) pendingMinas.set(player, { key, finalLine });
}

function startMinasConversation({ player, npcId }) {
  if (npcId !== NPC.HISTORIAN_MINAS) return;
  pendingMinas.delete(player);
  lampOutcome.delete(player);
  reportedInConversation.delete(player);
}

/**
 * A report pays on its branch's final speech line (rsprox 3278, 1757, 1843): a lamp report once
 * the player continues past "You're welcome!", any other just before Minas's closing display
 * line shows (after Hazeel Cult's and Temple of Ikov's narration boxes, after Demon Slayer's
 * player line).
 */
function completeMinasLine(request) {
  const { player, npcId, text } = request;
  if (npcId !== NPC.HISTORIAN_MINAS) return;
  const pending = pendingMinas.get(player);
  if (!pending || String(text ?? "").trim() !== pending.finalLine.trim()) return;
  const finish = () => finishMinasReport(player, pending);
  if (LAMP_BY_QUEST.has(pending.key)) request.after = finish;
  else request.before = finish;
}

function finishMinasReport(player, pending) {
  if (pendingMinas.get(player) !== pending) return;
  pendingMinas.delete(player);
  if (isReported(player, pending.key) || !isQuestComplete(player, pending.key)) return;
  if (pending.key === WHAT_LIES_BELOW_KEY && !has(player, ITEM.DAGONHAI_HISTORY)) return;
  if (pending.key === EMPTY_LORD_KEY && !hasGhostlyRobes(player)) return;
  const lamp = grantReportLamp(player, pending.key);
  if (lamp === LAMP.REFUSED) {
    // Ours: a full bag ends the conversation here and the report stays open for a retry.
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  lampOutcome.set(player, lamp);
  markReported(player, pending.key);
  reportedInConversation.add(player);
  sendReportVarbits(player, pending.key);
  awardKudos(player, REPORT_KUDOS.get(pending.key) ?? 5, `minas:${pending.key}`);
}

function grantReportLamp(player, questKey) {
  const lamp = LAMP_BY_QUEST.get(questKey);
  if (!lamp) return LAMP.NONE;
  if (has(player, lamp.itemId)) return LAMP.KEPT;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You need at least 1 free inventory space to receive the lamp.");
    return LAMP.REFUSED;
  }
  player.getInventory().adds(lamp.itemId, 1);
  return LAMP.GIVEN;
}

/**
 * Minas's transcript message steps are message boxes, as live sends them (rsprox 3278: the
 * Ikov, Hazeel Cult and What Lies Below narration and the lamp line are all messagebox 229).
 * The lamp line also goes to chat, and shows only when a lamp was handed over (ours: a player
 * still holding that report's lamp gets no second one and no line).
 */
function showMinasMessage(message) {
  const { player, npcId, kind, text } = message;
  if (npcId !== NPC.HISTORIAN_MINAS || kind !== "message") return;
  if (String(text ?? "").trim() === LAMP_MESSAGE) {
    const outcome = lampOutcome.get(player);
    lampOutcome.delete(player);
    message.handled = true;
    if (outcome !== LAMP.GIVEN) return;
    player.sendMessage(LAMP_MESSAGE);
  }
  message.handled = true;
  message.box = { statement: true };
}

function rubLamp(event) {
  const lamp = LAMPS.get(event.itemId) ?? SALVAGE_LAMPS.get(event.itemId);
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
  // The world's and the account's rates apply, as they do to the genie lamp; the message keeps the base.
  manager.addExperience(skill, request.lamp.xp, true);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  return `<col=0000ff>Your wish has been granted!</col><br>You have been awarded ${request.lamp.xp.toLocaleString("en-GB")} ${name} experience!`;
}

function answerGetKudos(request) {
  if (!request?.player) return;
  request.kudos = kudosOf(request.player);
}

/** AWARD_KUDOS_EVENT `{ player, amount, source }`: Kudos earned by a museum unit. */
function answerAwardKudos(request) {
  if (!request?.player || !(request.amount > 0)) return;
  request.kudos = awardKudos(request.player, request.amount, request.source);
}

/**
 * Information booth "Check Kudos": the cache's own activity list (vm_kudos_info, 600). rsprox
 * 227/01757.txt:292512-292519: busy (12393) set, script 2524 [-1, -1], then the modal.
 */
function checkKudos({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(DISPLAY_BUSY_VARBIT, 1);
  readingKudosInfo.add(player);
  sender.sendInterfaceScript(DISPLAY_SCREEN_SCRIPT, [-1, -1]);
  sender.sendInterface(KUDOS_INFO_INTERFACE);
  return true;
}

/**
 * Study on a museum display case (Digsite floor 528, timeline floor 534). The world object's
 * own model is what the interface shows, as The Golem's case 30 does (rsprox 1723 tick 14869
 * for the sibling Digsite display). Text and display number are the OSRS Wiki's.
 */
function displayText(player, entry) {
  for (const variant of entry.variants ?? []) {
    if (!isReported(player, variant.report)) continue;
    if (variant.sideAttribute !== undefined
      && Number(player.getAttribute(variant.sideAttribute)) !== variant.side) continue;
    return variant.text;
  }
  return entry.text;
}

function studyDisplay({ player, objectId, location }) {
  const entry = DISPLAYS[String(objectId)];
  if (!entry || !location || location.z !== entry.plane) return false;
  const group = entry.interface;
  const numberComponent = DISPLAY_NUMBER_COMPONENT[group];
  if (!numberComponent) return false;
  const modelUid = (group << 16) | entry.component;
  const sender = player.getPacketSender();
  sender.sendVarbit(DISPLAY_BUSY_VARBIT, 1);
  studyingDisplay.add(player);
  player.performAnimation(new api.core.Animation(DISPLAY_STUDY_SEQUENCE));
  // rsprox 227/01723.txt tick 14869: the Kudos HUD closes as the case opens, and comes back with it closing.
  if (kudosHudShown.has(player)) {
    hideKudosHud(player);
    hudHiddenForStudy.add(player);
  }
  sender.sendString(displayText(player, entry), (group << 16) | DISPLAY_TEXT_COMPONENT);
  sender.sendString(String(entry.number), (group << 16) | numberComponent);
  const modelId = api.core.CacheDefinitions.getObject(objectId)?.models?.[0]?.[0];
  if (modelId !== undefined) {
    sender.sendInterfaceRawModel(modelUid, modelId);
    sender.sendClientScript(DISPLAY_SPINNER_SCRIPT, 0, 5, 0, modelUid);
  }
  sender.sendInterfaceScript(DISPLAY_SCREEN_SCRIPT, [0, 100]);
  sender.sendInterface(group);
  return true;
}

function resetDisplayBusy({ player, interfaceId }) {
  if ((interfaceId === DIGSITE_INTERFACE || interfaceId === TIMELINE_INTERFACE)
    && studyingDisplay.delete(player)) {
    // rsprox 227/01723.txt tick 14871: busy off, sequence -1, the case closes and the HUD returns.
    player.getPacketSender().sendVarbit(DISPLAY_BUSY_VARBIT, 0);
    player.performAnimation(new api.core.Animation(-1));
    if (hudHiddenForStudy.delete(player)) showKudosHud(player);
  }
  if (interfaceId === KUDOS_INFO_INTERFACE && readingKudosInfo.delete(player)) {
    player.getPacketSender().sendVarbit(DISPLAY_BUSY_VARBIT, 0);
  }
}

function showKudosHud(player) {
  kudosHudShown.add(player);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, KUDOS_HUD_INTERFACE, 1);
  sendKudosVarbit(player);
}

function hideKudosHud(player) {
  if (!kudosHudShown.delete(player)) return;
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function createMuseumArea(core) {
  class MuseumArea extends core.Area {
    getName() {
      return "Varrock Museum";
    }

    // Crossing the boundary owns the HUD: a case closing afterwards must not bring it back outside, or add a second one.
    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      hudHiddenForStudy.delete(mobile.getAsPlayer());
      showKudosHud(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      hudHiddenForStudy.delete(mobile.getAsPlayer());
      if (!logout) hideKudosHud(mobile.getAsPlayer());
    }
  }
  return new MuseumArea(MUSEUM_BOUNDS.map((b) => new core.Boundary(b.minX, b.maxX, b.minY, b.maxY, b.z)));
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
  description: "Varrock Museum Kudos: the Dig Site cleaning activity, display cases, Historian Minas's quest timeline reports and Curator Haig Halen's salvaging relics.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.persistAttribute(KUDOS_ATTRIBUTE, 0);
    pluginApi.persistAttribute(STATE_ATTRIBUTE, null);
    pluginApi.onCustomEvent(KUDOS_EVENT, answerGetKudos);
    pluginApi.onCustomEvent(AWARD_KUDOS_EVENT, answerAwardKudos);
    pluginApi.onCustomEvent(HAS_KIT_EVENT, answerHasKit);
    pluginApi.onCustomEvent("npc-dialogue:menu", startMinasConversation);
    pluginApi.onCustomEvent("npc-dialogue:condition", recordMinasCondition);
    pluginApi.onCustomEvent("npc-dialogue:condition", recordArtefactCondition);
    pluginApi.onCustomEvent("npc-dialogue:line", completeMinasLine);
    pluginApi.onCustomEvent("npc-dialogue:action", showMinasMessage);
    pluginApi.onNpcDialogueCondition(answerMinasCondition);
    pluginApi.onNpcDialogueCondition(answerArtefactCondition);
    pluginApi.onObjectInteraction("Dig Site specimen rocks", { Take: takeFind });
    pluginApi.onObjectInteraction("Tools", { Take: takeTools });
    pluginApi.onObjectInteraction("Information booth", { "Check Kudos": checkKudos });
    pluginApi.onObjectInteraction("Display case", { Study: studyDisplay });
    pluginApi.onItemOnObject(cleanFind);
    pluginApi.onItemOnObject(placeArtefact);
    pluginApi.onItemOnNpc(showArtefact);
    pluginApi.onItemAction("Antique lamp", { Rub: rubLamp });
    pluginApi.onCustomEvent("interface:closed", resetDisplayBusy);
    pluginApi.registerArea(createMuseumArea(pluginApi.core));
    pluginApi.onPlayerLogin(handleLogin);
    pluginApi.onCustomEvent("player:bootstrap-complete", handleBootstrap);
    require("./museum/NaturalHistoryQuiz.Museum")(pluginApi);
    require("./museum/SalvagingRelics.Museum")(pluginApi);
  },
};
