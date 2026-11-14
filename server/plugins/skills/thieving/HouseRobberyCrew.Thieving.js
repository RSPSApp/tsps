/**
 * Oriana's crew, for Stealing valuables: the street urchins' house information (Lucia, Oli,
 * Rufus, Ava) and Oriana's trade-in of valuables. The words are the generated transcripts
 * (npc-dialogues.json: the Wiki's, with osrsreboxed-db's capture corrections); this module
 * picks their variants, answers their conditions and does what they describe. Values are in
 * plugins/skills/data/house-robbery.json; the house state comes from HouseRobbery.Thieving.js
 * ("house-robbery:state").
 *
 * rsprox captures: 1102 (below 50 Thieving, Oriana's first meeting and trade-in), 1105 (Lucia's
 * first talk and a paid lookup, the pointer arrow), 1104 (trade-in), 1098 (Oli's stew).
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "house-robbery.json"), "utf8"));
/** Oriana has been met (varbit stranger_met): her multinpc shows "Oriana" with Trade-in. */
const MET_ATTRIBUTE = "house-robbery:met-oriana";
/** Oriana has made her offer for valuables ("after stealing valuables for the first time"). */
const OFFERED_ATTRIBUTE = "house-robbery:oriana-offered";
/** An urchin has told the player about the crew (their first talk). */
const URCHIN_INTRO_ATTRIBUTE = "house-robbery:urchin-intro";
/** The player's free first lookup is used. */
const FREE_INFO_ATTRIBUTE = "house-robbery:free-info-used";
/** The house last told (varbit last_checked: 1 Lavinia, 2 Victor, 3 Caius). */
const LAST_CHECKED_ATTRIBUTE = "house-robbery:last-checked";
const { LIFETIME_ATTRIBUTE } = require("./HouseRobbery.Thieving");
const WITHOUT_THIEVING = "standard-dialogue-without-50-thieving";
const URCHIN_INITIAL = "standard-dialogue-initial-dialogue";
const ORIANA_INITIAL = "standard-dialogue-initial-dialogue";
const ORIANA_OFFER = "standard-dialogue-after-stealing-valuables-for-the-first-time";
const ORIANA_TRADE = "standard-dialogue-if-trading-valuables-to-oriana-after-starting";
const ORIANA_NOTHING = "standard-dialogue-if-trading-in-nothing-to-oriana";
const OLI_STEW = "giving-oli-a-bowl-of-stew";
const HINT_ARROW_SHOWN = 6;

let core;
let pluginApi;
/** Player -> the count they entered for Oriana, while her trade-in plays. */
const pendingTrade = new WeakMap();
/** Player -> the house an urchin is telling them about, for the conversation's placeholders. */
const told = new WeakMap();
/** Player -> last_checked as it was when the urchin's intel conditions began. */
const intel = new WeakMap();

function npcId(name) {
  return core.CacheDefinitions.getNpcId(name);
}

function urchinIds() {
  return new Set(DATA.npcs.urchins.map(npcId));
}

/** Oriana's content ids: her multinpc and both of its children (Dodgy Character, Oriana). */
function orianaIds() {
  return new Set(["varlamore_dodgy_character", "varlamore_dodgy_character_met", DATA.npcs.oriana].map(npcId));
}

function itemId(name) {
  return core.CacheDefinitions.getObjId(DATA.items[name]);
}

function baseThieving(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.THIEVING);
}

function setVarbit(player, name, value) {
  const id = core.CacheDefinitions.getVarbitId(DATA.varbits[name]);
  if (id !== null) player.getPacketSender().sendVarbit(id, value);
}

function met(player) {
  return player.getAttribute(MET_ATTRIBUTE) === true;
}

function gladiator(player) {
  const request = { player, rank: DATA.trade.gladiatorRank, reached: false };
  pluginApi.emitCustomEvent("colosseum:has-rank", request);
  return request.reached === true;
}

function houseState() {
  const request = { house: null, status: null };
  pluginApi.emitCustomEvent("house-robbery:state", request);
  return request;
}

function holding(player, name) {
  return player.getInventory().getAmount(itemId(name));
}

// ---------------------------------------------------------------- variants

/** rsprox 1102: below 50 base Thieving both the urchins and Oriana turn the player away (base, not boosted). */
function chooseVariant(event) {
  const { player, npcId: id } = event;
  const urchin = urchinIds().has(id);
  const oriana = orianaIds().has(id);
  if (!urchin && !oriana) return null;
  if (baseThieving(player) < DATA.level) return WITHOUT_THIEVING;
  if (urchin) return player.getAttribute(URCHIN_INTRO_ATTRIBUTE) === true ? null : URCHIN_INITIAL;
  if (!met(player)) return ORIANA_INITIAL;
  if (player.getAttribute(OFFERED_ATTRIBUTE) !== true && (Number(player.getAttribute(LIFETIME_ATTRIBUTE)) || 0) > 0) return ORIANA_OFFER;
  return null;
}

// ---------------------------------------------------------------- conditions

/** The house the urchins talk about: the vacant one, or the next to go. */
function target(player) {
  const state = houseState();
  if (state.house) told.set(player, state.house);
  return state;
}

/** The transcripts' prose conditions, by their text (the same on all four urchins' pages). */
function answerCondition(event) {
  const { player, npcId: id, text } = event;
  if (typeof text !== "string" || (!urchinIds().has(id) && !orianaIds().has(id))) return null;
  const keys = holding(player, "key");
  const valuables = holding(player, "valuable");
  const firstTime = player.getAttribute(FREE_INFO_ATTRIBUTE) !== true;
  const free = firstTime || gladiator(player);
  if (text.startsWith("If the player has not spoken to the \"Dodgy Character\"")) return !met(player);
  if (text.startsWith("If the player has already spoken to Oriana")) return met(player);
  if (text.startsWith("If the player doesn't have any house keys")) return keys <= 0;
  if (text.startsWith("If the player has at least one house key but less than 15")) return keys > 0 && !free && valuables < DATA.info.cost;
  const state = target(player);
  if (text.includes("but there is no house available")) return keys > 0 && (free || valuables >= DATA.info.cost) && state.status !== "vacant" && state.status !== "leaving-soon";
  if (text.includes("and a house is or will soon be available")) return keys > 0 && (free || valuables >= DATA.info.cost) && (state.status === "vacant" || state.status === "leaving-soon");
  if (text.startsWith("If it is the player's first time asking")) {
    if (!firstTime) return false;
    player.setAttribute(FREE_INFO_ATTRIBUTE, true);
    return true;
  }
  const house = state.house;
  // The three intel conditions are siblings, so they read one snapshot of what the player was last told,
  // taken at the first of them: naming the house can't make the next one true as well.
  if (text.startsWith("If the homeowner is about to leave")) {
    intel.set(player, Number(player.getAttribute(LAST_CHECKED_ATTRIBUTE)) || 0);
    return state.status === "leaving-soon";
  }
  const lastChecked = intel.get(player) ?? (Number(player.getAttribute(LAST_CHECKED_ATTRIBUTE)) || 0);
  if (text.startsWith("If this is the first time the player is receiving intel")) {
    if (!house || state.status !== "vacant" || lastChecked === house.lastChecked) return false;
    tellHouse(player, house);
    return true;
  }
  // (The runtime can ask this one twice; the snapshot answers both the same.)
  if (text.startsWith("If the player has already received intel")) return Boolean(house) && state.status === "vacant" && lastChecked === house.lastChecked;
  // "If Caius's house is available for thieving:" (and "If Caius or Victor's house ...")
  const available = /^If (?:\[\[)?(.+?)(?:\]\])?'s house is available for thieving/.exec(text.replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1"));
  if (available) return Boolean(house) && available[1].split(/ or /).some((name) => name.trim().startsWith(house.name));
  if (text.includes("Gladiator rank")) return text.includes("has not reached") ? !gladiator(player) : gladiator(player);
  if (text.startsWith("If the player has house keys")) return keys > 0;
  return null;
}

/** Captures (1105): last_checked is the house's number once the urchin names it. */
function tellHouse(player, house) {
  player.setAttribute(LAST_CHECKED_ATTRIBUTE, house.lastChecked);
  setVarbit(player, "lastChecked", house.lastChecked);
}

// ---------------------------------------------------------------- lines, choices, actions

/** "[Caius/Lavinia/Victor]" and "[his/her]" are the house being told; "[rank]" the player's Glory title. */
function fillLine(request) {
  if (!urchinIds().has(request.npcId) && !orianaIds().has(request.npcId)) return;
  if (typeof request.text !== "string") return;
  const house = told.get(request.player) ?? houseState().house;
  if (house) {
    // rsprox 1105: the name is red in the line.
    request.text = request.text.replaceAll("[Caius/Lavinia/Victor]", `<col=990000>${house.name}</col>`).replaceAll("[his/her]", house.pronoun);
  }
  if (request.text.includes("[rank]")) request.text = request.text.replaceAll("[rank]", DATA.trade.gladiatorRank);
}

function onChoice(choice) {
  const { player, npcId: id, option } = choice;
  if (!urchinIds().has(id)) return;
  if (option === "Yes." || option === "Yes, don't ask me again.") {
    if (!gladiator(player)) player.getInventory().delete(itemId("valuable"), Math.min(DATA.info.cost, holding(player, "valuable")));
    const state = houseState();
    if (state.house && state.status !== "vacant") tellHouse(player, state.house);
    return;
  }
  if (option === "Yes please.") {
    const house = told.get(player) ?? houseState().house;
    if (!house) return;
    // rsprox 1105: the arrow over the owner's outside door tile, height 100.
    player.getPacketSender().clearHintArrow();
    player.getPacketSender().sendPositionalHint(new core.Location(house.outside[0], house.outside[1], 0), 2, DATA.info.hintHeight, 0);
    setVarbit(player, "hintArrow", HINT_ARROW_SHOWN);
  }
}

function onAction(action) {
  const { player, npcId: id, step } = action;
  if (!urchinIds().has(id) && !orianaIds().has(id)) return;
  if (step?.type === "message" && /^You need .*50 Thieving/.test(String(action.text ?? ""))) {
    // rsprox 1102: a message box, the level in red.
    action.text = DATA.messages.level;
    action.box = { statement: true };
    return;
  }
  if (step?.type === "message" && String(action.text ?? "").startsWith("Oriana shakes your hand")) {
    action.box = { statement: true };
    return;
  }
  if (step?.type === "message" && String(action.text ?? "").startsWith("You give the stew to Oli")) {
    action.box = { items: [core.ItemIdentifiers.STEW] };
    return;
  }
  if (step?.type === "message" && String(action.text ?? "").startsWith("You hand in")) {
    const done = pendingTrade.get(player);
    pendingTrade.delete(player);
    if (!done) return;
    action.text = DATA.messages.traded.replace("{count}", done.count.toLocaleString("en-US")).replace("{coins}", done.coins.toLocaleString("en-US"));
    action.box = { items: [core.ItemIdentifiers.COINS, itemId("valuable")] };
    return;
  }
  if (step?.type === "input" && orianaIds().has(id)) {
    const pending = pendingTrade.get(player);
    if (pending && !pending.done) {
      trade(player, pending);
      action.handled = true;
      return;
    }
    action.handled = true;
    action.end = true;
    askCount(player, action.npc, id);
  }
}

/**
 * What a conversation leaves behind, set as its line plays: the urchins' introduction, Oriana's name and Trade-in
 * from the line where she gives it (rsprox 1102: stranger_met 0 -> 1), and her one-time offer.
 */
function onLine(request) {
  const { player, npcId: id, text } = request;
  if (typeof text !== "string") return;
  if (urchinIds().has(id) && text.startsWith("What are you doing out here on your own")) player.setAttribute(URCHIN_INTRO_ATTRIBUTE, true);
  if (!orianaIds().has(id)) return;
  if (!met(player) && text.startsWith("The name's Oriana")) {
    player.setAttribute(MET_ATTRIBUTE, true);
    setVarbit(player, "strangerMet", 1);
  }
  if (text.startsWith("Managed to steal anything yet?")) player.setAttribute(OFFERED_ATTRIBUTE, true);
}

// ---------------------------------------------------------------- Oriana's trade-in

function price(player) {
  return gladiator(player) ? DATA.trade.gladiatorPrice : DATA.trade.price;
}

/** Captures (1102, 1104, 1105): "How many valuables would you like to hand in? (0 - N)". */
function askCount(player, npc, id) {
  const held = holding(player, "valuable");
  if (held <= 0) {
    pluginApi.emitCustomEvent("npc-dialogue:start", { player, npc, npcId: id, variant: ORIANA_NOTHING });
    return;
  }
  player.setEnteredAmountAction({
    execute: (amount) => {
      const count = Math.min(Math.max(0, Math.floor(Number(amount)) || 0), holding(player, "valuable"));
      if (count <= 0) return;
      // Ours (no capture): a part of the stack with no room for the coins is refused before anything changes hands.
      if (!coinsFit(player, count, count * price(player))) {
        player.getInventory().full();
        return;
      }
      pendingTrade.set(player, { count, coins: count * price(player), done: false });
      pluginApi.emitCustomEvent("npc-dialogue:start", { player, npc, npcId: id, variant: ORIANA_TRADE });
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(DATA.messages.tradePrompt.replace("{count}", String(held)));
}

/** Whether the coins fit: on the coin stack, in a free slot, or in the valuables' slot once all of them go. */
function coinsFit(player, count, coins) {
  const inventory = player.getInventory();
  if (count >= holding(player, "valuable")) return true;
  return inventory.getAddableAmount(new core.Item(core.ItemIdentifiers.COINS, coins)) >= coins;
}

function trade(player, pending) {
  const count = Math.min(pending.count, holding(player, "valuable"));
  pending.count = count;
  pending.coins = count * price(player);
  pending.done = true;
  player.getInventory().delete(itemId("valuable"), count);
  player.getInventory().adds(core.ItemIdentifiers.COINS, pending.coins);
}

/** Trade-in (op4) and valuables used on her both go straight to the count. */
function tradeIn(event) {
  const { player, npc } = event;
  const id = event.npcId ?? npc.getContentId?.(player) ?? npc.getId();
  if (!orianaIds().has(id)) return false;
  if (baseThieving(player) < DATA.level || !met(player)) return false;
  askCount(player, npc, id);
  return true;
}

function valuablesOnOriana(event) {
  if (event.handled || event.itemId !== itemId("valuable") || !orianaIds().has(event.npcId)) return;
  event.handled = true;
  if (!tradeIn({ player: event.player, npc: event.target, npcId: event.npcId })) event.player.sendMessage("Nothing interesting happens.");
}

// ---------------------------------------------------------------- the urchins' Check and Oli's stew

/**
 * Check (op3): below 50 Thieving the House Robbery box (rsprox 1102). Ours: otherwise the information part of the
 * urchin's talk, without the greeting (no capture of Check at 50+).
 */
function check(event) {
  const { player, npc } = event;
  const id = event.npcId;
  if (!urchinIds().has(id)) return false;
  if (baseThieving(player) < DATA.level) {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, DATA.messages.level)));
    return true;
  }
  pluginApi.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId: id, variant: "standard-dialogue-subsequent-dialogue",
    select: (steps) => steps.find((step) => step.type === "choice")?.options?.find((option) => option.text === "I could do with some information on houses.")?.steps ?? steps,
  });
  return true;
}

/** rsprox 1098: the stew goes, and Oli's lines follow its item box. */
function stewOnOli(event) {
  if (event.handled || event.itemId !== core.ItemIdentifiers.STEW || event.npcId !== npcId("varlamore_thieving_house_urchin_d")) return;
  event.handled = true;
  event.player.getInventory().delete(core.ItemIdentifiers.STEW, 1);
  pluginApi.emitCustomEvent("npc-dialogue:start", { player: event.player, npc: event.target, npcId: event.npcId, variant: OLI_STEW });
}

function onLogin({ player }) {
  if (met(player)) setVarbit(player, "strangerMet", 1);
  const lastChecked = Number(player.getAttribute(LAST_CHECKED_ATTRIBUTE)) || 0;
  if (lastChecked > 0) setVarbit(player, "lastChecked", lastChecked);
}

function register(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(MET_ATTRIBUTE, false);
  api.persistAttribute(OFFERED_ATTRIBUTE, false);
  api.persistAttribute(URCHIN_INTRO_ATTRIBUTE, false);
  api.persistAttribute(FREE_INFO_ATTRIBUTE, false);
  api.persistAttribute(LAST_CHECKED_ATTRIBUTE, 0);
  api.onNpcDialogueVariant(chooseVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", fillLine);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onNpcInteraction("Oriana", { "Trade-in": tradeIn });
  api.onNpcsInteraction(["Lucia", "Oli", "Rufus", "Ava"], { Check: check });
  api.onItemOnNpc(valuablesOnOriana);
  api.onItemOnNpc(stewOnOli);
  api.onPlayerLogin(onLogin);
}

module.exports = register;
module.exports._test = {
  chooseVariant, answerCondition, fillLine, onChoice, onAction, onLine, tradeIn, check, stewOnOli, valuablesOnOriana, pendingTrade,
  MET_ATTRIBUTE, FREE_INFO_ATTRIBUTE, LAST_CHECKED_ATTRIBUTE, URCHIN_INTRO_ATTRIBUTE, OFFERED_ATTRIBUTE,
};
