"use strict";

/**
 * Elnock Inquisitor (npc 5734) in Puro-Puro: the once-per-account equipment gift (butterfly
 * net, 7 impling jars, an impling scroll) on Talk-to, then his Wiki transcript, and the four
 * jar exchanges from Impetuous Impulses
 * (https://oldschool.runescape.wiki/w/Impetuous_Impulses#Elnock's_Exchange).
 *
 * Trade opens Elnock's Exchange (interface 540), as rsprox captures (rev 237) show: the four
 * offers are shop_frame (540:4) slots 0, 3, 6 and 9, a click sets varbit ii_elnex (3729) to
 * slot / 3 + 1, and Confirm (540:7) trades the selected one, or says "You don't have the
 * required implings in jars to trade for this.". The cache's enum 2752 lists the offers in
 * that order, each struct paying with any one of three jar stacks (3, 2 or 1 of rising
 * implings); the fourth takes one jar of any impling. His Exchange option opens his impling
 * storage (interfaces 661/681), which tsps does not have, so it is left unhandled.
 *
 * His "Can you tell me about the wheat?" branch is the Strength XP toggle players were opted out
 * of on 1 March 2023: it offers to turn XP off when it is on, and on when it is off. The branch's
 * lines and conditions are already in the transcript, so this plugin only answers the two
 * conditions and sets the flag the wheat reads
 * (https://oldschool.runescape.wiki/w/Elnock_Inquisitor).
 */
const Wheat = require("./Wheat.ImpetuousImpulses");

const GIFT_ATTRIBUTE = "impetuous-impulses:gift-claimed";

/** Elnock Inquisitor. Conditions and actions are keyed by id rather than by name. */
const ELNOCK_NPC_ID = 5734;

/**
 * His two transcripts. The wheat branch, the jar exchange dialogue and equipment storage only
 * exist in the "after learning" one, so nothing reaches them until the player has been told how
 * to catch implings — which is what the variant names describe and why this plugin answers the
 * variant question at all.
 */
const BEFORE_LEARNING = "standard-dialogue-before-learning-how-to-catch-implings-from-elnock";
const AFTER_LEARNING = "standard-dialogue-after-learning-how-to-catch-implings-from-elnock";
/** Persisted: the player has asked him how to catch implings. */
const TAUGHT_ATTRIBUTE = "impetuous-impulses:taught";
const TEACH_OPTION = "Can I catch these implings";
/** The wheat branch's two outcome steps; the source spells "Strengh" and these must match it. */
const WHEAT_XP_OFF_STEP = "0SHgjt";
const WHEAT_XP_ON_STEP = "tkBmXQ";
const WHEAT_ON_CONDITION = "If the player turned Strengh XP on for pushing wheat:";
const WHEAT_OFF_CONDITION = "If the player turned Strengh XP off for pushing wheat:";
const SCROLL_CONDITION = "If the player has an Impling scroll in their inventory:";
/** The "Yes, please" outcome of his scroll offer, and the line the transcript attaches to it. */
const SCROLL_STEP = "ttn9iM";
const SCROLL_MESSAGE = "Elnock gives you a scroll. If you check it whilst in the maze, you will see " +
  "how many of each impling you have captured.";
/**
 * The export turned the bare prompt line "Turn wheat Strengh XP ON?" into a textless `unavailable`
 * marker, which ends playback by default. Handling it here is what lets the Yes/No that follows
 * play — the alternative would be teaching the shared dialogue engine to skip every such marker,
 * and 816 of them exist, most of which really do hide missing content.
 */
const PROMPT_GAP_STEP = "-azHS5";

const EXCHANGE_INTERFACE = 540;
const SHOP_FRAME_UID = (EXCHANGE_INTERFACE << 16) | 4;
const CONFIRM_UID = (EXCHANGE_INTERFACE << 16) | 7;
const SELECTED_VARBIT = 3729;
const OP1 = 1 << 1;
/** Enum 2752's offers, by ii_elnex value. */
const OFFERS = Object.freeze(["repellent", "net", "generator", "jars"]);
const MISSING_JARS_MESSAGE = "You don't have the required implings in jars to trade for this.";
/** Session-only: which offer the open Exchange has selected (ii_elnex). */
const SELECTED_ATTRIBUTE = "impetuous-impulses:elnex";

let core;
let trades;
let jarIds;

function build(coreApi) {
  const I = coreApi.ItemIdentifiers;
  jarIds = [I.BABY_IMPLING_JAR, I.YOUNG_IMPLING_JAR, I.GOURMET_IMPLING_JAR, I.EARTH_IMPLING_JAR,
    I.ESSENCE_IMPLING_JAR, I.ECLECTIC_IMPLING_JAR, I.NATURE_IMPLING_JAR, I.MAGPIE_IMPLING_JAR,
    I.NINJA_IMPLING_JAR, I.DRAGON_IMPLING_JAR, I.LUCKY_IMPLING_JAR, I.CRYSTAL_IMPLING_JAR];
  trades = {
    jars: {
      give: [I.IMPLING_JAR, 3],
      message: "Elnock takes the impling and gives you three impling jars.",
    },
    // Each `pay` lists alternatives (structs 1240-1242: params 901-903 items, 907-909 counts).
    repellent: {
      pay: [[I.BABY_IMPLING_JAR, 3], [I.YOUNG_IMPLING_JAR, 2], [I.GOURMET_IMPLING_JAR, 1]],
      give: [I.IMP_REPELLENT, 1],
      message: "Elnock takes the impling jars and gives you some imp repellent.",
    },
    net: {
      pay: [[I.GOURMET_IMPLING_JAR, 3], [I.EARTH_IMPLING_JAR, 2], [I.ESSENCE_IMPLING_JAR, 1]],
      give: [I.MAGIC_BUTTERFLY_NET, 1],
      message: "Elnock takes the impling jars and gives you a magic butterfly net.",
    },
    generator: {
      pay: [[I.ESSENCE_IMPLING_JAR, 3], [I.ECLECTIC_IMPLING_JAR, 2], [I.NATURE_IMPLING_JAR, 1]],
      give: [I.JAR_GENERATOR, 1],
      message: "Elnock takes the impling jars and gives you a jar generator.",
    },
  };
}

function init(api) {
  core = api.core;
  build(core);
}

/** The first of the offer's jar stacks the player holds in full (any one jar for "jars"). */
function paymentFor(player, recipe) {
  const options = recipe.pay ?? jarIds.map((id) => [id, 1]);
  return options.find(([id, amount]) => player.getInventory().getAmount(id) >= amount) ?? null;
}

/** Preflight the whole exchange, then consume and give; never a partial trade. */
function trade(player, key) {
  const recipe = trades[key];
  if (!recipe) return false;
  const payment = paymentFor(player, recipe);
  if (!payment) {
    player.sendMessage(MISSING_JARS_MESSAGE);
    return false;
  }
  const [id, amount] = payment;
  // Filled jars do not stack: paying frees a slot per jar.
  if (player.getInventory().getFreeSlots() + amount < recipe.give[1]) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  player.getInventory().deleteNumber(id, amount);
  player.getInventory().adds(recipe.give[0], recipe.give[1]);
  player.sendMessage(recipe.message);
  return true;
}

function gift(player) {
  const I = core.ItemIdentifiers;
  if (player.getAttribute(GIFT_ATTRIBUTE)) {
    player.sendMessage("Elnock has no more equipment to spare.");
    return false;
  }
  const items = [[I.BUTTERFLY_NET, 1], [I.IMPLING_JAR, 7], [I.IMPLING_SCROLL, 1]];
  const needed = items.reduce((sum, [, amount]) => sum + amount, 0);
  if (player.getInventory().getFreeSlots() < needed) {
    player.sendMessage("You need more free inventory space for Elnock's equipment.");
    return false;
  }
  for (const [id, amount] of items) player.getInventory().adds(id, amount);
  player.setAttribute(GIFT_ATTRIBUTE, true);
  player.sendMessage("Elnock Inquisitor gives you a butterfly net, 7 impling jars and an impling scroll.");
  return true;
}

/** The gift once; after that his transcript plays. */
function talk({ player }) {
  if (player.getAttribute(GIFT_ATTRIBUTE)) return false;
  gift(player);
  return true;
}

/** Trade: Elnock's Exchange with nothing selected, as captured. */
function openExchange({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(SELECTED_VARBIT, 0);
  sender.sendInterface(EXCHANGE_INTERFACE);
  for (let slot = 0; slot < OFFERS.length * 3; slot += 3) sender.sendInterfaceFlagsRange(SHOP_FRAME_UID, slot, slot, OP1);
  sender.sendInterfaceFlagsRange(CONFIRM_UID, 9, 9, OP1);
  player.setAttribute(SELECTED_ATTRIBUTE, 0);
}

function selectOffer({ player, slot }) {
  if (!Number.isInteger(slot) || slot % 3 !== 0 || slot / 3 >= OFFERS.length) return;
  const selected = slot / 3 + 1;
  player.setAttribute(SELECTED_ATTRIBUTE, selected);
  player.getPacketSender().sendVarbit(SELECTED_VARBIT, selected);
}

function confirmOffer({ player }) {
  const key = OFFERS[(player.getAttribute(SELECTED_ATTRIBUTE) ?? 0) - 1];
  if (key) trade(player, key);
}

const taught = (player) => player.getAttribute(TAUGHT_ATTRIBUTE) === true;

/** Until he has explained how to catch implings, "before learning" is the only transcript there is. */
function variant({ player, npcId }) {
  if (npcId !== ELNOCK_NPC_ID) return null;
  return taught(player) ? AFTER_LEARNING : BEFORE_LEARNING;
}

/** Asking how to catch them is the point the "after learning" text becomes the one he plays. */
function onChoice({ player, npcId, option }) {
  if (npcId !== ELNOCK_NPC_ID || taught(player)) return;
  if (String(option ?? "").startsWith(TEACH_OPTION)) player.setAttribute(TAUGHT_ATTRIBUTE, true);
}

/** Answers the wheat branch, which offers to turn XP off when it is on and on when it is off. */
function wheatCondition({ player, npcId, text }) {
  if (npcId !== ELNOCK_NPC_ID) return null;
  if (text === WHEAT_ON_CONDITION) return Wheat.xpEnabled(player);
  if (text === WHEAT_OFF_CONDITION) return !Wheat.xpEnabled(player);
  // The transcript reads "If the player has an Impling scroll in their inventory:" but its steps are
  // what he says to someone who does NOT have one, so the branch runs on the opposite answer: with
  // the scroll in hand the step is skipped and his six-option menu follows. Leaving it unanswered
  // offers the scroll every time and ends the conversation there.
  if (text === SCROLL_CONDITION) return !player.getInventory().containsNumber(core.ItemIdentifiers.IMPLING_SCROLL);
  return null;
}

const HANDLED_STEPS = new Set([WHEAT_XP_OFF_STEP, WHEAT_XP_ON_STEP, SCROLL_STEP, PROMPT_GAP_STEP]);

/** Confirming either wheat outcome sets the toggle; the scroll and the prompt gap are handled too. */
function wheatAction(event) {
  if (event.npcId !== ELNOCK_NPC_ID || !HANDLED_STEPS.has(event.stepId)) return;
  if (event.stepId === WHEAT_XP_OFF_STEP) Wheat.setXpEnabled(event.player, false);
  else if (event.stepId === WHEAT_XP_ON_STEP) Wheat.setXpEnabled(event.player, true);
  else if (event.stepId === SCROLL_STEP) giveScroll(event.player);
  // PROMPT_GAP_STEP needs no work of its own: marking it handled is the whole fix, because a
  // handled action carries on with the rest of the branch instead of ending it.
  event.handled = true;
}

/** His scroll offer only narrates that he handed one over; the item itself is this. */
function giveScroll(player) {
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You need more free inventory space for the impling scroll.");
    return;
  }
  player.getInventory().adds(core.ItemIdentifiers.IMPLING_SCROLL, 1);
  // Handled steps stop the engine sending their own line, so the narration is ours to send. That
  // also keeps it honest in the no-room case, where the transcript's line would claim a scroll.
  player.sendMessage(SCROLL_MESSAGE);
}

function registerElnock(api) {
  init(api);
  api.persistAttribute(GIFT_ATTRIBUTE);
  api.persistAttribute(TAUGHT_ATTRIBUTE, false);
  api.onNpcDialogueVariant(variant);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onNpcDialogueCondition(wheatCondition);
  api.onCustomEvent("npc-dialogue:action", wheatAction);
  api.onNpcInteraction("Elnock Inquisitor", { "Talk-to": talk, Trade: openExchange });
  api.onInterfaceActionButton(SHOP_FRAME_UID, selectOffer);
  api.onInterfaceActionButton(CONFIRM_UID, confirmOffer);
}

module.exports = registerElnock;
Object.assign(module.exports, {
  init, gift, trade, GIFT_ATTRIBUTE,
  wheatCondition, wheatAction, variant, onChoice,
  _test: {
    init, gift, trade, talk, openExchange, selectOffer, confirmOffer, OFFERS, SELECTED_VARBIT,
    MISSING_JARS_MESSAGE, wheatCondition, wheatAction, ELNOCK_NPC_ID,
    WHEAT_ON_CONDITION, WHEAT_OFF_CONDITION, WHEAT_XP_ON_STEP, WHEAT_XP_OFF_STEP,
    variant, onChoice, taught, TAUGHT_ATTRIBUTE, BEFORE_LEARNING, AFTER_LEARNING, TEACH_OPTION,
    SCROLL_CONDITION, SCROLL_STEP, SCROLL_MESSAGE, PROMPT_GAP_STEP, giveScroll, HANDLED_STEPS,
  },
});
