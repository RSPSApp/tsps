"use strict";

/**
 * Gnome Restaurant, the Aluft Aloft food delivery minigame
 * (https://oldschool.runescape.wiki/w/Gnome_Restaurant).
 *
 * Gianne jnr. hands out an easy (6 minutes, coins tip) or hard (11 minutes, item tip) order:
 * a random gnome dish or cocktail and a random customer, plus an Aluft Aloft box carrying the
 * details. The dish is handed over with item-on-NPC (Delivery.GnomeRestaurant.js) within the
 * limit; the box must be held. Declining a tier locks it for 5 minutes (the wiki says 5:30,
 * the task 5:00). 12 credits earn a reward token. Only one order at a time; logout, death and
 * disconnection abandon it with no reward.
 *
 * The wiki tutorial (Aluft Gianne snr. + Blurberry recommendations) is not implemented, so
 * the gate is just the documented 29 Cooking.
 */

const DATA = require("./data/gnome-restaurant-orders.json");

const GIANNE_NAME = "Gianne jnr.";
const BOX_NAME = "Aluft Aloft box";
const TIER_EASY = "easy";
const TIER_HARD = "hard";
const MIN_COOKING = 29;
const LOCKOUT_MS = 300_000;
const CREDITS_PER_TOKEN = 12;
const MAX_CREDITS = 120;
const CREDITS_ATTRIBUTE = "gnome-restaurant:credits";
const LOCKOUTS_ATTRIBUTE = "gnome-restaurant:lockouts";
const MS_PER_MINUTE = 60_000;

const ALREADY_LINE = "You already have a delivery on the go. Check your Aluft Aloft box if you've forgotten the details.";
const REFUSAL_LINE = "I'm afraid you don't have the required cooking experience for this job. If you want to work for me you'll have to train up to level 29 Cooking.";
const NO_ORDERS_LINE = "I'm afraid I have no orders for you at the moment - come back in";
const OFFER_TITLE = "Do you want to take on an easy or a hard delivery?";
const TAKE_TITLE = "Take this order?";
const EASY_OPTION = "I think I'll warm up with an easy one.";
const HARD_OPTION = "The edge of the world is no limit for Aluft Aloft Food Deliveries!";
const CHANGED_MIND = "I've changed my mind, there's something else I need to do now.";
const TAKE_EASY = "Easy-peasy! I'll get started.";
const TAKE_HARD = "Easy-peasy! I'm on the job.";
const DECLINE_OPTION = "I don't think I can complete this one.";
const START_LINE = "You'd better get a move on then. The clock is already running!";

let api;
let core;
let BOX_ID;
let TOKEN_ID;

/** player -> { tier, itemId, itemName, npcName, deadline } */
const sessions = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  BOX_ID = core.ItemIdentifiers.ALUFT_ALOFT_BOX;
  TOKEN_ID = core.ItemIdentifiers.REWARD_TOKEN_4;
}

// --- State helpers

function sessionOf(player) {
  return sessions.get(player);
}

function boxId() {
  return BOX_ID;
}

function cookingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.COOKING);
}

function creditsOf(player) {
  return Number(player.getAttribute(CREDITS_ATTRIBUTE)) || 0;
}

function lockoutsOf(player) {
  const stored = player.getAttribute(LOCKOUTS_ATTRIBUTE);
  return stored && typeof stored === "object" ? stored : {};
}

function lockedUntil(player, tier) {
  return Number(lockoutsOf(player)[tier]) || 0;
}

function isLocked(player, tier) {
  return lockedUntil(player, tier) > Date.now();
}

function waitText(ms) {
  if (ms <= 60_000) return "less than a minute";
  if (ms < 90_000) return "a minute";
  return `${Math.ceil(ms / MS_PER_MINUTE)} minutes`;
}

function remainingText(player, ...tiers) {
  const most = Math.max(...tiers.map((tier) => lockedUntil(player, tier)));
  return waitText(Math.max(0, most - Date.now()));
}

/** The "you just refused this tier" line, with the wait still due. */
function lockedLine(player, tier) {
  if (tier === TIER_EASY) {
    return `Since you've just refused an easy job, I only have a hard job available for you at the moment. If you want to wait for another easy one - come back in ${remainingText(player, TIER_EASY)}.`;
  }
  return `Since you've just refused a hard job, I only have an easy job available for you at the moment. If you want to wait for another hard one - come back in ${remainingText(player, TIER_HARD)}.`;
}

// --- Rolling an order

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function rollOrder(tier, rng = Math.random) {
  const item = pick(DATA.items[tier], rng);
  const recipient = pick(DATA.recipients.filter((entry) => entry.tier === tier), rng);
  return { tier, itemId: item.id, itemName: item.name, npcName: recipient.name, hint: recipient.hint };
}

// --- Talking to Gianne jnr.

function npcSays(player, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  const builder = new DialogueChainBuilder();
  builder.add(new NpcDialogue(0, core.NpcIdentifiers.GIANNE_JNR_, text));
  builder.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
}

/** Gianne's lines, then a multi-chatbox choice (the client's OptionDialogue is not wired). */
function npcThenPrompt(player, lines, title, pairs) {
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = core;
  const builder = new DialogueChainBuilder();
  let index = 0;
  for (const text of lines) builder.add(new NpcDialogue(index++, core.NpcIdentifiers.GIANNE_JNR_, text));
  builder.add(new ActionDialogue(index++, {
    execute: () => api.sendMultiChatboxPrompt(player, title, ...pairs.flatMap(([text, action]) => [text, action])),
  }));
  player.getDialogueManager().startDialogues(builder);
}

/**
 * True while another plugin owns this NPC's dialogue (Path of Glouphrie's Gianne variants),
 * in which case Talk-to falls through to the transcript runtime instead of offering a job.
 */
function questOwnsDialogue(event) {
  const selection = core.PluginManager?.emitNpcDialogueVariant?.({
    player: event.player,
    npc: event.npc,
    npcId: event.npcId,
    definition: event.definition,
    pages: [],
  });
  return selection != null;
}

function talkTo(event) {
  if (questOwnsDialogue(event)) return false;
  const { player } = event;
  if (sessions.has(player)) return npcSays(player, ALREADY_LINE);
  if (cookingLevel(player) < MIN_COOKING) return npcSays(player, REFUSAL_LINE);
  const available = [TIER_EASY, TIER_HARD].filter((tier) => !isLocked(player, tier));
  if (!available.length) return npcSays(player, `${NO_ORDERS_LINE} ${remainingText(player, TIER_EASY, TIER_HARD)}.`);
  const pairs = available.map((tier) => [
    tier === TIER_EASY ? EASY_OPTION : HARD_OPTION,
    () => offerOrder(player, tier),
  ]);
  pairs.push([CHANGED_MIND, () => {}]);
  api.sendMultiChatboxPrompt(player, OFFER_TITLE, ...pairs.flatMap((pair) => pair));
}

function getEasyJob(event) {
  getJob(event, TIER_EASY);
}

function getHardJob(event) {
  getJob(event, TIER_HARD);
}

function getJob({ player }, tier) {
  if (sessions.has(player)) return npcSays(player, ALREADY_LINE);
  if (cookingLevel(player) < MIN_COOKING) return npcSays(player, REFUSAL_LINE);
  offerOrder(player, tier);
}

function offerOrder(player, tier, rng = Math.random) {
  if (sessions.has(player)) return npcSays(player, ALREADY_LINE);
  if (isLocked(player, tier)) return npcSays(player, lockedLine(player, tier));
  const order = rollOrder(tier, rng);
  npcThenPrompt(player, [`${order.npcName} wants a ${order.itemName}.`, order.hint], TAKE_TITLE, [
    [tier === TIER_EASY ? TAKE_EASY : TAKE_HARD, () => acceptOrder(player, order)],
    [DECLINE_OPTION, () => declineOrder(player, tier)],
  ]);
}

function acceptOrder(player, order) {
  if (sessions.has(player)) return npcSays(player, ALREADY_LINE);
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You need a free inventory space to carry your delivery box.");
    return;
  }
  sessions.set(player, {
    tier: order.tier,
    itemId: order.itemId,
    itemName: order.itemName,
    npcName: order.npcName,
    deadline: Date.now() + DATA.tiers[order.tier].seconds * 1000,
  });
  inventory.adds(BOX_ID, 1);
  npcSays(player, START_LINE);
}

function declineOrder(player, tier) {
  const lockouts = { ...lockoutsOf(player), [tier]: Date.now() + LOCKOUT_MS };
  player.setAttribute(LOCKOUTS_ATTRIBUTE, lockouts);
  const line = tier === TIER_EASY
    ? "Fine, your loss. If you want another easy job, come back in five minutes and maybe I'll be able to find you one."
    : "Fine, your loss. I may have an easier job for you. If you want another hard one, come back in five minutes and maybe I'll be able to find you something.";
  npcSays(player, line);
}

/** The box's Check option: the order and the time left. */
function checkBox({ player }) {
  const session = sessions.get(player);
  if (!session) {
    player.sendMessage("You have no delivery to check.");
    return;
  }
  player.sendMessage(`Your delivery box says: ${session.npcName} wants a ${session.itemName}.`);
  player.sendMessage(`You have ${waitText(session.deadline - Date.now())} left to deliver it.`);
}

// --- Time limit

function expire(player, session) {
  if (sessions.get(player) !== session) return;
  sessions.delete(player);
  const inventory = player.getInventory();
  if (inventory.contains(BOX_ID)) inventory.deleteNumber(BOX_ID, 1);
  player.sendMessage("Your delivery is too late! Go back to Aluft jnr. to get another order. You discard your delivery box as you don't need it any more.");
}

function tick() {
  const now = Date.now();
  for (const [player, session] of [...sessions]) {
    if (now >= session.deadline) expire(player, session);
  }
}

function startTimer() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1);
    }

    execute() {
      tick();
    }
  })());
}

/** agent:advance-time moves the deadline forward, then reports the order (or its expiry). */
function advanceTime(event) {
  const { player, ms } = event;
  const session = sessions.get(player);
  if (!session) return;
  session.deadline -= ms;
  event.handledBy?.push("GnomeRestaurant");
  if (Date.now() >= session.deadline) expire(player, session);
}

// --- Completing an order

/** +150 Cooking XP (the wiki's hard figure, used for both) and the tier's credits. */
function completeDelivery(player, session) {
  sessions.delete(player);
  const tier = DATA.tiers[session.tier];
  player.getSkillManager().addExperiences(core.Skill.COOKING, tier.xp);
  const awarded = awardCredits(player, tier.credits);
  return { xp: tier.xp, ...awarded };
}

function awardCredits(player, amount) {
  const before = creditsOf(player);
  const after = Math.min(MAX_CREDITS, before + amount);
  player.setAttribute(CREDITS_ATTRIBUTE, after);
  const tokens = Math.floor(after / CREDITS_PER_TOKEN) - Math.floor(before / CREDITS_PER_TOKEN);
  if (tokens > 0) player.getInventory().adds(TOKEN_ID, tokens);
  return { before, after, tokens };
}

// --- Losing the order

function abandon({ player }) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  const inventory = player.getInventory();
  if (inventory.contains(BOX_ID)) inventory.deleteNumber(BOX_ID, 1);
}

function attach(pluginApi) {
  init(pluginApi);
  api.persistAttribute(CREDITS_ATTRIBUTE);
  api.persistAttribute(LOCKOUTS_ATTRIBUTE);
  api.onNpcInteraction(GIANNE_NAME, { "Talk-to": talkTo, "Get job (easy)": getEasyJob, "Get job (hard)": getHardJob });
  api.onItemAction(BOX_NAME, { Check: checkBox });
  api.onPlayerLogout(abandon);
  api.onPlayerDisconnect(abandon);
  api.onPlayerDeath(abandon);
  api.onServerStartup(startTimer);
  api.onCustomEvent("agent:advance-time", advanceTime);
}

module.exports = attach;
Object.assign(module.exports, {
  boxId,
  sessionOf,
  expire,
  completeDelivery,
  awardCredits,
  creditsOf,
  waitText,
  _test: {
    init,
    reset: () => sessions.clear(),
    sessions,
    sessionOf,
    talkTo,
    getEasyJob,
    getHardJob,
    offerOrder,
    acceptOrder,
    declineOrder,
    checkBox,
    abandon,
    tick,
    advanceTime,
    rollOrder,
    isLocked,
    creditsOf,
    awardCredits,
    completeDelivery,
    lockoutsOf,
  },
});
