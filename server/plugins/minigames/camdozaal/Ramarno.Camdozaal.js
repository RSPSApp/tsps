"use strict";

/**
 * Ramarno's item exchanges and his Shard Exchange from conversation, and the
 * archaeologists' post-quest conditions. The conversations are the Wiki
 * transcripts in npc-dialogues.json ("Ramarno", "Helena (Ruins of Camdozaal)");
 * this module supplies their inputs, conditions and effects by step id.
 *
 * Wiki (Ramarno, Exchanging items): head, handle and guard smelt for 100 shards,
 * the mace and the Imcando hammer for 500, the broken hammer for 350; Ramarno
 * builds the mace from all three pieces and 1,500 shards, and repairs the broken
 * hammer for 1,250.
 */
const S = require("./Shared.Camdozaal");
const { startTranscript } = require("../../quests/QuestRuntime");
const { open: openExchange } = require("./Exchange.Camdozaal");

const PAGE = "Ramarno";
const SHARD = "camdozaal_barronite_shard";
const PIECES = ["barronite_mace_1", "barronite_mace_2", "barronite_mace_3"];
const RELICS = [1, 2, 3, 4, 5].map(index => `camdozaal_relic_${index}`);
const MACE_COST = 1500;
const REPAIR_COST = 1250;
/** Item gameval -> transcript variant and, where Ramarno smelts it, its shard value. */
const ITEMS = [
  { names: [SHARD], variant: "using-items-on-ramarno-barronite-shards" },
  { names: ["camdozaal_barronite_deposit"], variant: "using-items-on-ramarno-barronite-deposit" },
  { names: RELICS, variant: "using-items-on-ramarno-ancient-relics" },
  { names: PIECES, variant: "using-items-on-ramarno-barronite-mace-piece", smelt: 100 },
  { names: ["barronite_mace"], variant: "using-items-on-ramarno-barronite-mace", smelt: 500 },
  { names: ["imcando_hammer_broken"], variant: "using-items-on-ramarno-imcando-hammer-broken", smelt: 350 },
  { names: ["imcando_hammer"], variant: "using-items-on-ramarno-imcando-hammer", smelt: 500 },
  { names: ["redberry_pie"], variant: "using-items-on-ramarno-redberry-pie" },
];

// Transcript step ids (npc-dialogues.json, page "Ramarno" / "Helena (Ruins of Camdozaal)").
const SHOW_STEPS = new Set(["J-oMeN", "uEfLY8", "pkjItx", "XKzeq8", "W29WR4", "gpYpnz", "VWcigZ"]);
const DEPOSIT_INPUT = "QazbNk";
const DEPOSITED_NONE = "3GIkp1";
const DEPOSITED_SOME = "87JvKI";
const DEPOSITED_MESSAGE = "Cv8kVN";
const EXCHANGE_OPENS = new Set(["PtZ7we", "EF-caV"]);
const PIECES_MISSING = "Qo-xfD";
const PIECES_HELD = "EkXrdT";
const MACE_HANDED = "ALzEGz";
const SMELTED = new Set(["NYb33x", "QbU4QD", "f7_1Gh", "7UqJ5I"]);
const SHARDS_TO_FORGE = new Set(["Oee_GP", "LqOZ6l", "RPv_hw", "2egP7G"]);
const REPAIR_SHORT = "iuHDKV";
const REPAIR_AFFORDED = "jzgMez";
const HAMMER_GIVEN = "f9bcNy";
const HAMMER_HANDED = "ABcaQ_";
const PIE_GIVEN = "RcBgIl";
const NEVER_MET_RAMARNO = "_0F6Is";
const MET_RAMARNO = "TUwCfZ";
const MISSING_PIECE_LINE = "You need a Barronite [piece] and 1500 barronite shards.";
const SMELT_PIECE_PROMPT = "Smelt down your Barronite head for 100 Barronite shards?";

/** The item the player last used on Ramarno, and how many shards they then fed the forge. */
const shown = new WeakMap();

function itemName(id) { return S.core().ItemDefinition.forId(id).getName(); }
function rowFor(itemId) {
  return ITEMS.find(row => row.names.some(name => S.obj(name) === itemId));
}
function ramarnoPage(event) { return event.pages?.some(entry => entry.page === PAGE); }
function carried(player, id) { return player.getInventory().contains(id); }
function missingPieces(player) { return PIECES.map(S.obj).filter(id => !carried(player, id)); }
function affords(player, cost) { return S.shards(player) + S.stored(player) >= cost; }

function useItem(event) {
  const { player, itemId } = event;
  if (event.handled || event.definition?.getName?.() !== PAGE || !S.inRuins(player) || !S.unlocked(player)) return;
  const row = rowFor(itemId);
  if (!row) return;
  event.handled = true;
  shown.set(player, { itemId, smelt: row.smelt ?? 0, deposited: 0 });
  startTranscript(S.pluginApi(), player, event.npcId, PAGE, row.variant, null, event.target);
}

function answerCondition({ player, stepId }) {
  const state = shown.get(player);
  switch (stepId) {
    case DEPOSITED_NONE: return (state?.deposited ?? 0) === 0;
    case DEPOSITED_SOME: return (state?.deposited ?? 0) > 0;
    case PIECES_MISSING: return missingPieces(player).length > 0 || !affords(player, MACE_COST);
    case PIECES_HELD: return missingPieces(player).length === 0 && affords(player, MACE_COST);
    case REPAIR_SHORT: return !affords(player, REPAIR_COST);
    case REPAIR_AFFORDED: return affords(player, REPAIR_COST);
    case NEVER_MET_RAMARNO: return !S.unlocked(player);
    case MET_RAMARNO: return S.unlocked(player);
    default: return null;
  }
}

/** "[piece]" names what is missing; the smelting prompt names the piece actually shown. */
function fillLine(request) {
  if (!ramarnoPage(request) || request.text !== MISSING_PIECE_LINE) return;
  const missing = missingPieces(request.player).map(id => itemName(id).replace(/^Barronite /, ""));
  request.text = `You need a Barronite ${missing.length ? missing.join(" and a Barronite ") : "head"} and 1500 barronite shards.`;
}
function fillMenu(notice) {
  const state = shown.get(notice.player);
  if (notice.prompt !== SMELT_PIECE_PROMPT || !state) return;
  notice.prompt = `Smelt down your ${itemName(state.itemId)} for ${state.smelt} Barronite shards?`;
}

function show(event, state) {
  event.text = `You show Ramarno the ${itemName(state.itemId)}.`;
  event.box = { items: [state.itemId] };
}
function askDeposit(event, state) {
  const { player } = event;
  event.wait = resume => S.askAmount(player, event.text, count => {
    state.deposited = S.store(player, count);
    resume();
  });
}
/** The chatbox closes and the Exchange takes over; the conversation ends there. */
function exchange(event) {
  event.wait = () => openExchange({ player: event.player, npc: event.npc });
}
function handMace(event) {
  const { player } = event;
  if (missingPieces(player).length || !S.pay(player, MACE_COST)) return;
  PIECES.forEach(name => player.getInventory().deleteNumber(S.obj(name), 1));
  player.getInventory().adds(S.obj("barronite_mace"), 1);
  event.box = { items: [S.obj("barronite_mace")] };
  S.save(player);
}
function smelt(event, state) {
  const { player } = event;
  if (!carried(player, state.itemId)) return;
  player.getInventory().deleteNumber(state.itemId, 1);
  player.getInventory().adds(S.obj(SHARD), state.smelt);
  event.box = { items: [S.obj(SHARD), state.itemId] };
}
function repairHammer(event) {
  const { player } = event;
  const broken = S.obj("imcando_hammer_broken");
  if (!carried(player, broken) || !S.pay(player, REPAIR_COST)) return;
  player.getInventory().deleteNumber(broken, 1);
  player.getInventory().adds(S.obj("imcando_hammer"), 1);
  event.box = { items: [S.obj("imcando_hammer")] };
  S.save(player);
}
function givePie(event) {
  const pie = S.obj("redberry_pie");
  if (!carried(event.player, pie)) return;
  event.player.getInventory().deleteNumber(pie, 1);
  event.box = { items: [pie] };
}

function dialogueAction(event) {
  if (!ramarnoPage(event)) return;
  const state = shown.get(event.player);
  const id = event.stepId;
  if (EXCHANGE_OPENS.has(id)) return exchange(event);
  if (id === HAMMER_HANDED) return repairHammer(event);
  if (id === HAMMER_GIVEN) return void (event.handled = true);
  if (id === MACE_HANDED) return handMace(event);
  if (id === PIE_GIVEN) return givePie(event);
  if (!state) return;
  if (SHOW_STEPS.has(id)) return show(event, state);
  if (id === DEPOSIT_INPUT) return askDeposit(event, state);
  if (id === DEPOSITED_MESSAGE) return void (event.box = { items: [S.obj(SHARD)] });
  if (SMELTED.has(id)) return smelt(event, state);
  if (SHARDS_TO_FORGE.has(id)) {
    S.store(event.player, state.smelt);
    event.handled = true;
  }
}

module.exports = function attach(api) {
  api.onItemOnNpc(useItem);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onCustomEvent("npc-dialogue:line", fillLine);
  api.onCustomEvent("npc-dialogue:menu", fillMenu);
};
