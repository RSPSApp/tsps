"use strict";

/**
 * Simon Templeton buys the artefacts (OSRS Wiki: Simon Templeton): talking to him with any in
 * the pack, noted or not, plays "with-pyramid-plunder-artefacts-in-inventory" and he takes the
 * lot; using one (unnoted) artefact on him sells just that one. The transcript's "(Simon takes
 * ...)" step takes them and its "coins" step pays: ivory comb 50, pottery scarab 75, pottery
 * statuette 100, stone seal 150, stone scarab 175, stone statuette 200, gold seal 750, golden
 * scarab 1,000, golden statuette 1,250. His sceptre lines stay with the transcript.
 *
 * Agility Pyramid tops: 10,000 coins each (Wiki: Agility Pyramid), all at once, through his
 * transcript's top lines. Meeting him names him and offers the job, and the first top sold
 * finishes it: agility_pyramid_simon_named, _job and _job_done, sent as they change and at login
 * (rsprox 1757, 2932). The transcript's sell lines show in a message box, as captured.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Transcript:Simon_Templeton
 */

const Common = require("./Common.PyramidPlunder");

const VARIANT = {
  carrying: "with-pyramid-plunder-artefacts-in-inventory",
  usedOne: "using-items-on-him-any-pyramid-plunder-artefact",
  firstTalk: "before-selling-any-pyramid-tops-initial-dialogue",
  talkAgain: "before-selling-any-pyramid-tops-subsequent-dialogue",
  afterSelling: "after-selling-at-least-one-pyramid-top",
  usedTop: "using-items-on-him-pyramid-top",
  usedBeforeTalking: "using-items-on-him-any-pyramid-plunder-artefact-if-the-player-hasn-t-talked-to-him-before",
};
/** Transcript steps: he takes the artefacts, then pays. */
const TAKE_ALL = new Set(["Kn2FnM", "9B09eW"]);
const TAKE_ONE = "0egJhg";
const PAY = new Set(["7vfUYS", "wb91_I", "dFDQfD"]);
/** Transcript conditions on how many pyramid tops the player carries. */
const TOPS_NONE = new Set(["zXAwBg", "-mixJS"]);
const TOPS_ONE = new Set(["mPKGhu", "DW3JPR"]);
const TOPS_MANY = new Set(["aJi_9W", "D8hzoV"]);
/** Transcript message steps where he takes every pyramid top and pays for them. */
const SELL_TOPS = new Set(["xCY7EK", "0iaVVb", "MoWeP6"]);
const PYRAMID_TOP_COINS = 10000;
const MAX_COIN_STACK = 0x7fffffff;

/** How far the player is with Simon: never met, met and offered the job, sold him a top. */
const SIMON_STAGE_ATTRIBUTE = "agility-pyramid:simon-stage";
const STAGE = Object.freeze({ NEW: 0, OFFERED: 1, SOLD: 2 });

/** player -> coins owed by the step that took the artefacts, paid at the coins step. */
const owed = new Map();
/** player -> the artefact item id used on him, until his one-at-a-time offer is answered. */
const offered = new Map();

const isSimon = (npcId) => npcId === Common.ids().simon;

function artefactKey(itemId) {
  const { artefacts, noted } = Common.ids().item;
  for (const key of Object.keys(artefacts)) {
    if (artefacts[key] === itemId || noted[key] === itemId) return key;
  }
  return null;
}

/** Every artefact in the pack, noted or not: [itemId, amount, coins each]. */
function carried(player) {
  const inventory = player.getInventory();
  const out = [];
  const { artefacts, noted } = Common.ids().item;
  for (const [key, artefact] of Object.entries(Common.DATA.artefacts)) {
    for (const id of [artefacts[key], noted[key]]) {
      if (!id) continue;
      const amount = inventory.getAmount(id);
      if (amount > 0) out.push([id, amount, artefact.coins]);
    }
  }
  return out;
}

function topsCarried(player) {
  return player.getInventory().getAmount(Common.ids().item.pyramidTop);
}

function simonStage(player) {
  return player.getAttribute(SIMON_STAGE_ATTRIBUTE) ?? STAGE.NEW;
}

function sendSimonVarbits(player) {
  const stage = simonStage(player);
  const { simonNamed, simonJob, simonJobDone } = Common.ids().varbit;
  const sender = player.getPacketSender();
  sender.sendVarbit(simonNamed, stage >= STAGE.OFFERED ? 1 : 0);
  sender.sendVarbit(simonJob, stage >= STAGE.OFFERED ? 1 : 0);
  sender.sendVarbit(simonJobDone, stage >= STAGE.SOLD ? 1 : 0);
}

function advanceStage(player, stage) {
  if (simonStage(player) >= stage) return;
  player.setAttribute(SIMON_STAGE_ATTRIBUTE, stage);
  sendSimonVarbits(player);
}

function syncOnLogin({ player }) {
  if (simonStage(player) > STAGE.NEW) sendSimonVarbits(player);
}

/**
 * Talk-to: the carrying lines when there's anything to sell; otherwise his introduction the
 * first time, then the pyramid top lines for before and after the first sale.
 */
function onDialogueVariant(context) {
  if (!isSimon(context.npcId)) return null;
  if (carried(context.player).length > 0) return VARIANT.carrying;
  const stage = simonStage(context.player);
  if (stage === STAGE.NEW) {
    advanceStage(context.player, STAGE.OFFERED);
    return VARIANT.firstTalk;
  }
  return stage === STAGE.SOLD ? VARIANT.afterSelling : VARIANT.talkAgain;
}

function onDialogueCondition(event) {
  if (!isSimon(event.npcId)) return null;
  const tops = topsCarried(event.player);
  if (TOPS_NONE.has(event.stepId)) return tops === 0;
  if (TOPS_ONE.has(event.stepId)) return tops === 1;
  if (TOPS_MANY.has(event.stepId)) return tops > 1;
  return null;
}

function talk({ player, npcId }) {
  if (isSimon(npcId)) offered.delete(player);
}

function forget({ player }) {
  owed.delete(player);
  offered.delete(player);
}

function takeAll(player) {
  const inventory = player.getInventory();
  const items = carried(player);
  const coins = items.reduce((total, [, amount, each]) => total + amount * each, 0);
  if (coins > MAX_COIN_STACK || (coins > 0 && !paymentFits(inventory, items.length, coins))) return false;
  for (const [id, amount] of items) inventory.deleteNumber(id, amount);
  owed.set(player, (owed.get(player) ?? 0) + coins);
  if (coins > 0) Common.getApi().emitCustomEvent("pyramid-plunder:artefacts-sold", { player });
  return true;
}

function takeOne(player) {
  const itemId = offered.get(player);
  offered.delete(player);
  const key = itemId === undefined ? null : artefactKey(itemId);
  const inventory = player.getInventory();
  if (!key || inventory.getAmount(itemId) <= 0) return true;
  const coins = Common.DATA.artefacts[key].coins;
  if (!paymentFits(inventory, 1, coins)) return false;
  inventory.deleteNumber(itemId, 1);
  owed.set(player, (owed.get(player) ?? 0) + coins);
  Common.getApi().emitCustomEvent("pyramid-plunder:artefacts-sold", { player });
  return true;
}

function pay(request) {
  const player = request.player;
  const coins = owed.get(player) ?? 0;
  owed.delete(player);
  request.handled = true;
  if (coins <= 0) return;
  player.getInventory().addItem(new (Common.getCore().Item)(Common.ids().item.coins, coins));
  player.sendMessage(`Simon hands you ${coins.toLocaleString("en-GB")} coins.`);
}

/**
 * Whether the whole payment fits: an existing coin stack must take all of it, and a new stack
 * can use a slot the sold items leave behind.
 */
function paymentFits(inventory, soldItems, coins) {
  const coinsId = Common.ids().item.coins;
  if (inventory.getAmount(coinsId) > 0) {
    return inventory.getAddableAmount(new (Common.getCore().Item)(coinsId, coins)) === coins;
  }
  return soldItems > 0 || inventory.getFreeSlots() > 0;
}

/**
 * Every pyramid top for 10,000 coins each, told in a message box; none left ends the chat, and
 * so does a payment the inventory cannot hold, leaving the tops untouched.
 */
function sellTops(request) {
  const player = request.player;
  const tops = topsCarried(player);
  request.handled = true;
  if (tops <= 0) {
    request.end = true;
    return;
  }
  const coins = tops * PYRAMID_TOP_COINS;
  if (!paymentFits(player.getInventory(), tops, coins)) {
    request.end = true;
    player.sendMessage("You do not have enough room to carry all of those coins.");
    return;
  }
  player.getInventory().deleteNumber(Common.ids().item.pyramidTop, tops);
  player.getInventory().addItem(new (Common.getCore().Item)(Common.ids().item.coins, coins));
  advanceStage(player, STAGE.SOLD);
  request.text = `You hand over the artefact(s) and Simon hands you ${coins} coins.`;
  request.box = { statement: true };
}

function onDialogueAction(request) {
  if (!isSimon(request.npcId)) return;
  if (SELL_TOPS.has(request.stepId)) {
    sellTops(request);
  } else if (TAKE_ALL.has(request.stepId) || request.stepId === TAKE_ONE) {
    request.handled = true;
    const taken = TAKE_ALL.has(request.stepId) ? takeAll(request.player) : takeOne(request.player);
    if (!taken) {
      request.end = true;
      request.player.sendMessage("You do not have enough room to carry all of those coins.");
    }
  } else if (PAY.has(request.stepId)) {
    pay(request);
  }
}

function startVariant(event, variant) {
  event.handled = true;
  Common.getApi().emitCustomEvent("npc-dialogue:start", {
    player: event.player, npc: event.target, npcId: event.npcId, variant, handled: false,
  });
}

/**
 * A pyramid top used on him sells them all, once he has explained the job (before that he asks
 * for a chat first, rsprox 1757); an unnoted artefact gets his one-at-a-time offer.
 */
function onItemOnNpc(event) {
  if (event.handled || !isSimon(event.npcId)) return;
  if (event.itemId === Common.ids().item.pyramidTop) {
    startVariant(event, simonStage(event.player) === STAGE.NEW ? VARIANT.usedBeforeTalking : VARIANT.usedTop);
    return;
  }
  const key = artefactKey(event.itemId);
  if (!key || Common.ids().item.artefacts[key] !== event.itemId) return;
  offered.set(event.player, event.itemId);
  startVariant(event, VARIANT.usedOne);
}

module.exports = function registerSimon(api) {
  Common.bind(api);
  api.onBeforeNpcInteraction(talk);
  api.persistAttribute(SIMON_STAGE_ATTRIBUTE, STAGE.NEW);
  api.onNpcDialogueVariant(onDialogueVariant);
  api.onNpcDialogueCondition(onDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onItemOnNpc(onItemOnNpc);
  api.onPlayerLogin(syncOnLogin);
  api.onPlayerLogout(forget);
  api.onPlayerDisconnect(forget);
};

module.exports._test = {
  VARIANT, TAKE_ALL, TAKE_ONE, PAY, owed, offered, artefactKey, carried, onDialogueVariant,
  takeAll, takeOne, pay, onDialogueAction, onItemOnNpc, forget, onDialogueCondition, sellTops,
  SIMON_STAGE_ATTRIBUTE, STAGE,
};
