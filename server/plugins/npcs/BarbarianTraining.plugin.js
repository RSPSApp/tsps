"use strict";

/**
 * Barbarian Training's rod fishing and Herblore sections (Wiki: Barbarian Training).
 *
 * Otto Godblessed teaches rod fishing first: the rod is under his bed, and a leaping fish caught
 * with it completes the section once Otto hears of it. Herblore comes after rod fishing. Otto
 * asks for an attack mix (an attack potion(2) with roe), and handing it over completes the
 * section, which unlocks every barbarian mix (the recipes with an `unlock` in
 * skills/data/herblore.json, answered here through "herblore:unlocked").
 *
 * Words: the Wiki transcript (npc-dialogues.json, page "Barbarian Training"), read through
 * NpcDialogues' "npc-dialogue:start" `select`. The bed's object boxes, the mix's message box and
 * the farewell are from rsprox recording 1533. The section stages are the cache's varbits
 * brut_fishing_r and brut_herb_potion (Quest Helper: 1 tasked, 2 done, 3 told Otto).
 *
 * Otto's agricultural topic stays Farming's: choosing it hands the Talk-to over to
 * skills/farming/Services.Farming's own Otto menu. The other sections (firemaking, harpoon
 * fishing, spears and hastae) have no topic here yet.
 */

const STATE_ATTRIBUTE = "barbarian-training";
/** Cache varbits (osrs-dumps varbit.sym): brut_fishing_r 3758, brut_herb_potion 3761. */
const VARBITS = { fishingRod: 3758, herblore: 3761 };
const TASKED = 1;
const DONE = 2;
const TOLD = 3;

const OTTO = "Otto Godblessed";
const BED = "Barbarian bed";
const TRANSCRIPT = {
  first: "starting-off-after-speaking-to-him-once",
  again: "starting-off-after-speaking-to-him-once-talking-to-otto-again-without-doing-as-he-asks",
  fishing: "fishing",
  herblore: "herblore",
  herbloreAgain: "herblore-speaking-to-otto-again-without-an-attack-mix",
  herbloreDone: "herblore-speaking-to-otto-with-an-attack-mix",
};
const TOPIC = {
  rod: "What can I learn about the use of a fishing rod?",
  rodDone: "I've fished with a barbarian rod!",
  herblore: "What was that secret knowledge of herblore we talked of?",
  herbloreDone: "I've made a barbarian potion!",
  farming: "How can I use my strength in the ways of agriculture?",
  leave: "I'd better get going.",
};
const GREETING = "Good day to you, hearty warrior! May the spirits guide you.";
const MORE = "I seek more knowledge.";
const NO_MORE = "I have no more questions at this time.";
/** rsprox recording 1533, after "I have no more questions at this time.". */
const FAREWELL = "In that case, farewell.";
/** rsprox recording 1533: a mesbox after the attack mix, the game message after the farming tasks. */
const LEARNED = "You feel you have learned more of barbarian ways. Otto might wish to talk to you more.";
/** rsprox recording 1533, Search on brut_barbarian_bed. */
const ROD_TAKEN = "You find a heavy fishing rod under the bed and take it.";
const ROD_NO_SPACE = "You find a heavy fishing rod under the bed, but don't have space for it.";
const ROD_ALREADY = "You already have a heavy fishing rod.";

let api;
let core;

function state(player) {
  const saved = player.getAttribute(STATE_ATTRIBUTE);
  const current = saved && typeof saved === "object" ? saved : {};
  current.fishingRod = stage(current.fishingRod);
  current.herblore = stage(current.herblore);
  if (saved !== current) player.setAttribute(STATE_ATTRIBUTE, current);
  return current;
}

function stage(value) {
  return Number.isInteger(value) && value >= 0 && value <= TOLD ? value : 0;
}

function sync(player) {
  const current = state(player);
  const sender = player.getPacketSender();
  for (const [section, varbit] of Object.entries(VARBITS)) sender.sendVarbit(varbit, current[section]);
}

function loggedIn({ player }) {
  sync(player);
}

function setStage(player, section, value) {
  state(player)[section] = value;
  player.getPacketSender().sendVarbit(VARBITS[section], value);
}

/** "herblore:unlocked": the attack mix once Otto has asked for it, every mix once he has it. */
function answerUnlock(request) {
  if (!request?.player || typeof request.unlock !== "string") return;
  const [key, when] = request.unlock.split(":");
  if (key !== "barbarian_herblore") return;
  const herblore = state(request.player).herblore;
  request.allowed = when === "started" ? herblore >= TASKED : herblore === TOLD;
}

// ---------------------------------------------------------------- transcript

/** The spoken steps of one choice in a variant of Otto's transcript, up to its next choice. */
function topicLines(player, npc, npcId, variant, optionText) {
  let found = null;
  api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant, exact: true, handled: false,
    select: (steps) => { found = steps; return []; } });
  const menu = (found ?? []).find((step) => step?.type === "choice");
  const option = menu?.options?.find((entry) => entry.text === optionText);
  const lines = [];
  for (const step of option?.steps ?? []) {
    if (step?.type === "choice" || step?.type === "jump") break;
    if (typeof step?.player === "string") lines.push({ player: step.player });
    else if (step?.type === "line" && typeof step.text === "string") lines.push({ npc: step.text });
  }
  return lines;
}

function addLine(chain, index, line, player, npcId) {
  const text = String(line.player ?? line.npc).replace(/\[player name\]/gi, player.getUsername?.() ?? "");
  chain.add(line.player != null ? new core.PlayerDialogue(index, text) : new core.NpcDialogue(index, npcId, text));
}

/**
 * Plays `lines`, then `next` if given, else closes. The engine's ActionDialogue does not move the
 * chain on, so an action only ever ends a chain, and it opens whatever comes next.
 */
function play(player, npcId, lines, next = null) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach((line, index) => addLine(chain, index, line, player, npcId));
  chain.add(new core.ActionDialogue(lines.length, { execute: () => {
    if (next) next();
    else player.getPacketSender().sendInterfaceRemoval();
  } }));
  player.getDialogueManager().startDialogues(chain);
}

function ask(player, options) {
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.OptionDialogue(0, { executeOption: (option) => options[Number(option) - 1]?.[1]?.() },
    ...options.map(([text]) => text)));
  player.getDialogueManager().startDialogues(chain);
}

// ---------------------------------------------------------------- Otto

function near(player, npc) {
  return !npc?.getLocation || player.getLocation().isWithinDistance(npc.getLocation(), 5);
}

/** Preset, untradeable and unbankable copies keep their restrictions, as in Herblore's mixing. */
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** The inventory slot of an attack mix(2) Otto may take, or -1. */
function attackMixSlot(player) {
  return player.getInventory().getItems().findIndex((item) =>
    item?.getId() === core.ItemIdentifiers.ATTACK_MIX_2_ && item.getAmount() > 0 && !restricted(item));
}

function holdsAttackMix(player) {
  return attackMixSlot(player) >= 0;
}

/** The topics Otto offers for what the player has done so far. */
function topics(player, talk) {
  const current = state(player);
  const list = [];
  if (current.fishingRod === DONE) list.push([TOPIC.rodDone, () => rodDone(player, talk)]);
  else if (current.fishingRod < DONE) list.push([TOPIC.rod, () => rodLesson(player, talk)]);
  if (current.fishingRod === TOLD && current.herblore < TOLD) {
    if (current.herblore === DONE && holdsAttackMix(player)) list.push([TOPIC.herbloreDone, () => herbloreDone(player, talk)]);
    else list.push([TOPIC.herblore, () => herbloreLesson(player, talk)]);
  }
  list.push([TOPIC.farming, () => {
    player.getPacketSender().sendInterfaceRemoval();
    // Farming's modules need the server core when loaded, so this is required on first use.
    require("../skills/farming/Services.Farming").farmingNpc(talk.event);
  }]);
  list.push([TOPIC.leave, () => play(player, talk.npcId, [{ player: TOPIC.leave }])]);
  return list;
}

function menu(player, talk) {
  if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
  ask(player, topics(player, talk));
}

/** "I seek more knowledge." goes back to the topics; the other says goodbye. */
function afterTopic(player, talk) {
  ask(player, [
    [MORE, () => menu(player, talk)],
    [NO_MORE, () => play(player, talk.npcId, [{ player: NO_MORE }, { npc: FAREWELL }])],
  ]);
}

/**
 * The topic's transcript lines; `onReply`, if given, runs as Otto starts to answer. False, with
 * the chatbox closed, when Otto has wandered off.
 */
function lesson(player, talk, variant, option, onReply = null) {
  if (!near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return false; }
  const found = topicLines(player, talk.npc, talk.npcId, variant, option);
  const lines = found.length ? found : [{ player: option }];
  const after = () => afterTopic(player, talk);
  if (!onReply) { play(player, talk.npcId, lines, after); return true; }
  play(player, talk.npcId, lines.slice(0, 1), () => {
    onReply();
    play(player, talk.npcId, lines.slice(1), after);
  });
  return true;
}

function rodLesson(player, talk) {
  const tasked = state(player).fishingRod === TASKED;
  if (lesson(player, talk, tasked ? TRANSCRIPT.again : TRANSCRIPT.first, TOPIC.rod) && !tasked) setStage(player, "fishingRod", TASKED);
}

function rodDone(player, talk) {
  if (lesson(player, talk, TRANSCRIPT.fishing, TOPIC.rodDone)) setStage(player, "fishingRod", TOLD);
}

function herbloreLesson(player, talk) {
  const asked = state(player).herblore >= TASKED;
  if (lesson(player, talk, asked ? TRANSCRIPT.herbloreAgain : TRANSCRIPT.herblore, TOPIC.herblore) && !asked) setStage(player, "herblore", TASKED);
}

/** rsprox recording 1533: the mix goes, and the section completes, as Otto thanks the player. */
function herbloreDone(player, talk) {
  lesson(player, talk, TRANSCRIPT.herbloreDone, TOPIC.herbloreDone, () => {
    const slot = attackMixSlot(player);
    if (state(player).herblore !== DONE || slot < 0) return;
    player.getInventory().deleteAtSlot(slot, 1, false);
    player.getInventory().refreshItems();
    setStage(player, "herblore", TOLD);
  });
}

function talkToOtto(event) {
  if (event.handled) return;
  const definition = event.definition ?? event.npc?.getCurrentDefinition?.(event.player);
  if (definition?.getName?.() !== OTTO || definition.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  event.handled = true;
  const { player } = event;
  const talk = { event, npc: event.npc, npcId: event.npcId ?? definition.getId?.() ?? core.NpcIdentifiers.OTTO_GODBLESSED };
  play(player, talk.npcId, [{ npc: GREETING }], () => menu(player, talk));
}

// ---------------------------------------------------------------- the bed, the catch and the mix

function itemBox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, core.ItemIdentifiers.BARBARIAN_ROD, text)).add(new core.EndDialogue(1)));
}

function takeRod(player) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) { itemBox(player, ROD_NO_SPACE); return; }
  inventory.adds(core.ItemIdentifiers.BARBARIAN_ROD, 1);
  itemBox(player, ROD_TAKEN);
}

function searchBed(event) {
  const { player } = event;
  if (!player.getInventory().contains(core.ItemIdentifiers.BARBARIAN_ROD)) { takeRod(player); return; }
  const chain = new core.DialogueChainBuilder();
  const options = new core.OptionDialogue(0, { executeOption: (option) => {
    if (Number(option) === 1) takeRod(player);
    else player.getPacketSender().sendInterfaceRemoval();
  } }, "Take another.", "Don't take any more.");
  options.setTitle?.(ROD_ALREADY);
  chain.add(options);
  player.getDialogueManager().startDialogues(chain);
}

function caughtFish({ player, itemId } = {}) {
  if (!player || state(player).fishingRod !== TASKED) return;
  const { LEAPING_TROUT, LEAPING_SALMON, LEAPING_STURGEON } = core.ItemIdentifiers;
  if (![LEAPING_TROUT, LEAPING_SALMON, LEAPING_STURGEON].includes(itemId)) return;
  setStage(player, "fishingRod", DONE);
  player.sendMessage(LEARNED);
}

function madePotion({ player, itemId } = {}) {
  if (!player || itemId !== core.ItemIdentifiers.ATTACK_MIX_2_ || state(player).herblore !== TASKED) return;
  setStage(player, "herblore", DONE);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, LEARNED)).add(new core.EndDialogue(1)));
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(STATE_ATTRIBUTE, {});
  api.onPlayerLogin(loggedIn);
  api.onBeforeNpcInteraction(talkToOtto);
  api.onObjectInteraction(BED, { Search: searchBed });
  api.onCustomEvent("fishing:success", caughtFish);
  api.onCustomEvent("herblore:made", madePotion);
  api.onCustomEvent("herblore:unlocked", answerUnlock);
}

module.exports = {
  name: "BarbarianTraining",
  members: true,
  // TreasureTrails first: its before-hook answers clue steps that send the player to Otto (the
  // medium anagram and hard cipher), which this Talk-to must not take over.
  dependsOn: ["NpcDialogues", "Farming", "TreasureTrails"],
  register: attach,
  _test: { STATE_ATTRIBUTE, VARBITS, TOPIC, LEARNED, ROD_TAKEN, ROD_NO_SPACE, state, topics, topicLines, answerUnlock, talkToOtto,
    searchBed, caughtFish, madePotion, setStage },
};
