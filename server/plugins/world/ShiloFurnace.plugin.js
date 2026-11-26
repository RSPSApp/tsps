/**
 * Yohnus' furnace in Shilo Village: 20 coins a use, paid from a coffer of up to 40,000 coins, and
 * free after the elite Karamja Diary (OSRS Wiki: Yohnus, Furnace, Shilo Village (location)).
 *
 * The lit furnace (zqfurnace_lit, the multiloc zqfurnace once Shilo Village is done) and Yohnus
 * both have Coffer. Its menu, the deposit prompt and the fee prompts are as rsprox captures have
 * them (rev 227 recordings 1749, local 1000217, 1000230, 1000262, 1000334, 1000359, 1000412;
 * rev 231 recording 3030); docs/shilo-furnace.md has the details.
 *
 * Every Smelt click and every item used on the furnace asks for the fee first, before Smithing,
 * Crafting or anything else takes the click. Once paid, the click runs again for the furnace's
 * own content.
 */
const COFFER_ATTRIBUTE = "shilo-furnace:coffer";
const DONT_ASK_ATTRIBUTE = "shilo-furnace:dont-ask";

const FEE = 20;
/** Wiki (Yohnus): "The maximum amount the coffer can hold is 40,000 coins." */
const COFFER_MAX = 40000;
/** synth 2115, with every deposit (recordings 1749 t+10, local 1000217, 1000359). */
const COINS_SOUND = 2115;

const EMPTY_TITLE = "Your coffer is empty.";
const EMPTIED_MESSAGE = "<col=ff0000>Your coffer is empty. You must top it up before you can use the furnace again.";
/** Wiki transcript: "Attempting to use the furnace without coins in the coffer". */
const NO_COINS_LINE = "Sorry Bwana - I charge a fee of 20 coins to use my furnace.";
const ELITE_DEPOSIT_MESSAGE = "You have earned the Elite Karamja reward, so you no longer need to pay to use this furnace.";
const ALREADY_EMPTY_MESSAGE = "It's already empty.";

let api;
let core;
let litFurnaceId = null;
let yohnusId = null;
/** Players whose next furnace click is the paid one, run again past the fee. */
const paid = new WeakSet();

const format = (amount) => amount.toLocaleString("en-US");
const coinsOf = (player) => player.getInventory().getAmount(core.ItemIdentifiers.COINS);
const cofferOf = (player) => Number(player.getAttribute(COFFER_ATTRIBUTE)) || 0;

function setCoffer(player, amount) {
  player.setAttribute(COFFER_ATTRIBUTE, amount);
}

function resolveIds() {
  litFurnaceId = core.CacheDefinitions.getLocId("zqfurnace_lit");
  yohnusId = core.CacheDefinitions.getNpcId("shilofurnaceowner");
}

function eliteFree(player) {
  const request = { player, diary: "karamja", tier: "elite", complete: null };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** The furnace as this player sees it: the lit child of the zqfurnace multiloc. */
function isShiloFurnace(event) {
  if (litFurnaceId == null) return false;
  const definition = event.definition ?? core.ObjectDefinition.forPlayer(event.objectId, event.player);
  return definition?.id === litFurnaceId;
}

// --- The fee.

/**
 * Smelt on the furnace. The paid click passes; any other asks for the fee and, once paid, runs the
 * click again for Smithing, Crafting and the rest.
 */
function gateSmelt(event) {
  if (String(event.option).toLowerCase() !== "smelt" || !isShiloFurnace(event)) return;
  if (paid.delete(event.player)) return;
  event.handled = true;
  requireFee(event.player, true, () => rerun(event.player, () => api.emitObjectInteraction({ ...event, handled: false })));
}

/** An item used on the furnace: the fee first, whatever the item (seaweed too, local 1000359 t+0). */
function gateItem(event) {
  if (!isShiloFurnace(event)) return;
  if (paid.delete(event.player)) return;
  event.handled = true;
  requireFee(event.player, false, () => {
    const handled = rerun(event.player, () => api.emitItemOnObject({ ...event, handled: false }));
    if (!handled) event.player.sendMessage("Nothing interesting happens.");
  });
}

function rerun(player, emit) {
  paid.add(player);
  try {
    return emit();
  } finally {
    paid.delete(player);
  }
}

/**
 * Asks for or takes the fee, then calls `proceed`. With coins in the coffer it asks "Pay 20 coins
 * to use the furnace." unless the player chose "don't ask again"; then a Smelt click names what is
 * left and an item use says nothing (local 1000334 t+17, 1000412 t+949). An empty coffer offers
 * one use or as many as the coins carried and the coffer's room allow (local 1000217, 1000359).
 */
function requireFee(player, smelt, proceed) {
  if (eliteFree(player)) {
    proceed();
    return;
  }
  const coffer = cofferOf(player);
  if (coffer < FEE) {
    offerTopUp(player, proceed);
    return;
  }
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) {
    charge(player, smelt);
    proceed();
    return;
  }
  api.sendMultiChatboxPrompt(player, `Furnace coffer: ${format(coffer)} coins`,
    "Pay 20 coins to use the furnace.", () => payAndProceed(player, false, proceed),
    "Pay 20 coins and don't ask again.", () => payAndProceed(player, true, proceed),
    "Cancel.", () => closeChatbox(player));
}

function payAndProceed(player, dontAsk, proceed) {
  closeChatbox(player);
  if (cofferOf(player) < FEE) return;
  if (dontAsk) player.setAttribute(DONT_ASK_ATTRIBUTE, true);
  charge(player, false);
  proceed();
}

function offerTopUp(player, proceed) {
  const uses = Math.min(Math.floor(coinsOf(player) / FEE), Math.floor((COFFER_MAX - cofferOf(player)) / FEE));
  if (uses < 1) {
    yohnusSays(player, NO_COINS_LINE);
    return;
  }
  const choices = ["Add one use: 20 coins", () => topUpAndProceed(player, 1, proceed)];
  // Ours: with coins for one use only, live's second line is unrecorded; it is left out.
  if (uses > 1) choices.push(`Add ${format(uses)} uses: ${format(uses * FEE)} coins`, () => topUpAndProceed(player, uses, proceed));
  choices.push("Cancel", () => closeChatbox(player));
  api.sendMultiChatboxPrompt(player, EMPTY_TITLE, ...choices);
}

function topUpAndProceed(player, uses, proceed) {
  closeChatbox(player);
  if (!deposit(player, uses * FEE)) return;
  charge(player, false);
  proceed();
}

/**
 * Takes one use's fee from the coffer. Emptied, it says so in red (local 1000359 t+14); a Smelt
 * click in "don't ask again" otherwise names what is left (local 1000262 t+4, 1000334 t+3).
 */
function charge(player, smelt) {
  const left = cofferOf(player) - FEE;
  setCoffer(player, left);
  if (left < FEE) player.sendMessage(EMPTIED_MESSAGE);
  else if (smelt) player.sendMessage(`Your coffer contains ${format(left)} coins, enough for ${Math.floor(left / FEE)} more furnace uses.`);
}

/** Moves whole uses' worth of coins, up to the coffer's room, into the coffer. */
function deposit(player, amount) {
  const room = COFFER_MAX - cofferOf(player);
  const count = Math.floor(Math.min(amount, coinsOf(player), room) / FEE) * FEE;
  if (count < FEE) return false;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, count);
  setCoffer(player, cofferOf(player) + count);
  player.getPacketSender().sendSound(COINS_SOUND, 1, 0);
  return true;
}

// --- The coffer menu, on the furnace and on Yohnus.

function openCoffer({ player }) {
  const elite = eliteFree(player);
  api.sendMultiChatboxPrompt(player, `Furnace coffer: ${format(cofferOf(player))} coins`,
    elite ? "<str>Deposit coins</str>" : "Deposit coins", () => (elite ? refuseDeposit(player) : askDeposit(player)),
    "Empty coffer", () => emptyCoffer(player),
    "Cancel", () => closeChatbox(player));
}

function cofferOnFurnace(event) {
  if (!isShiloFurnace(event)) return false;
  openCoffer(event);
}

function cofferOnYohnus(event) {
  if (yohnusId == null || event.npc?.getId?.() !== yohnusId) return false;
  openCoffer(event);
}

/** "How much do you wish to deposit? (20 - 40,000 coins)" (recording 1749 t+5): the coffer's room. */
function askDeposit(player) {
  closeChatbox(player);
  const room = COFFER_MAX - cofferOf(player);
  if (room < FEE) {
    // Ours: a full coffer's answer is unrecorded; the menu shows it full.
    openCoffer({ player });
    return;
  }
  player.setEnteredAmountAction({ execute: (amount) => depositAndReopen(player, Math.floor(Number(amount))) });
  player.getPacketSender().sendEnterAmountPrompt(`How much do you wish to deposit? (20 - ${format(room)} coins)`);
}

/** The amount is rounded down to whole uses (Wiki transcript); the menu then reopens (1749 t+10). */
function depositAndReopen(player, amount) {
  if (!(amount > 0)) return;
  if (deposit(player, amount)) openCoffer({ player });
}

function refuseDeposit(player) {
  closeChatbox(player);
  player.sendMessage(ELITE_DEPOSIT_MESSAGE);
}

/** Wiki transcript: all of it comes out, "You withdraw [number] coins."; empty, "It's already empty." */
function emptyCoffer(player) {
  closeChatbox(player);
  const coffer = cofferOf(player);
  if (coffer <= 0) {
    player.sendMessage(ALREADY_EMPTY_MESSAGE);
    return;
  }
  const count = player.getInventory().getAddableAmount(new core.Item(core.ItemIdentifiers.COINS, coffer));
  if (count <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  setCoffer(player, coffer - count);
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.COINS, count));
  player.sendMessage(`You withdraw ${format(count)} coins.`);
}

// --- Helpers.

function closeChatbox(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function yohnusSays(player, text) {
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, yohnusId, text)));
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "ShiloFurnace",
  description: "Yohnus' furnace in Shilo Village: 20 coins a use from a coffer of up to 40,000 coins, free after the elite Karamja Diary.",
  members: true,
  _test: { attach, resolveIds, gateSmelt, gateItem, openCoffer, askDeposit, depositAndReopen, emptyCoffer, COFFER_ATTRIBUTE, DONT_ASK_ATTRIBUTE },
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.persistAttribute(COFFER_ATTRIBUTE, 0);
    pluginApi.persistAttribute(DONT_ASK_ATTRIBUTE, false);
    pluginApi.onServerStartup(resolveIds);
    pluginApi.onBeforeObjectInteraction(gateSmelt);
    pluginApi.onItemOnObject(gateItem, { before: true });
    pluginApi.onObjectInteraction("Furnace", { Coffer: cofferOnFurnace });
    pluginApi.onNpcInteraction("Yohnus", { Coffer: cofferOnYohnus });
  },
};
