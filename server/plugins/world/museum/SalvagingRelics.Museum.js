/**
 * The eight Sailing salvaging relics (Wiki: Antique lamp (salvaging)) and Curator Haig Halen.
 *
 * Inspect shows the relic beside its examine text and "You get the feeling that an item this old
 * belongs in a museum.", with the same line in chat.
 *
 * Using a relic on Haig, or his "I found a strange relic while salvaging..." option (offered only
 * while one is carried), plays the relic's section of his transcript: the player's line, "You show
 * the <relic> to Curator Haig Halen." beside the relic, then either the first-time offer (1 Kudos
 * and the relic's antique lamp, then the inscription he reads) or, once that relic is claimed, the
 * repeat offer of 5,000 coins. Saying no keeps the relic. Each relic's claimed flag is its own bit
 * of `salvaging_rare_all_claimed`.
 *
 * Lamps: the locket, mouldy block and dull knife give the small lamp (5,000 xp), the compass,
 * coin and sextant the medium (10,000 xp), the mirror and doll the large (15,000 xp).
 *
 * The transcript's menus are rebuilt per relic: its first-time and repeat menus follow each other
 * under two conditions, and the repeat menu's "No." is "(Same as above)". The menu prompt names
 * the relic being traded.
 *
 * Ours: with several relics carried, Talk-to shows the first of them in item order. The lines
 * after all eight are handed in are not played.
 */
"use strict";

const runtime = require("../../quests/QuestRuntime");

const CLAIMED_ATTRIBUTE = "museum:salvaging-relics";
const AWARD_KUDOS_EVENT = "museum:award-kudos";
const PAGE = "Curator Haig Halen";
const RELIC_OPTION = "I found a strange relic while salvaging...";
const RELIC_CONDITION = "If the player has a salvaging relic on them:";
const SHOW_PREFIX = "You show the ";
const HAND_PREFIX = "You hand Curator Haig Halen the ";
const INSPECT_SUFFIX = "You get the feeling that an item this old belongs in a museum.";
const KUDOS_PER_RELIC = 1;
const REPEAT_COINS = 5000;
const COINS = 995;

/** Relic names as the cache has them (each its own item), for the Inspect hooks. */
const RELIC_NAMES = Object.freeze([
  "Rusty locket", "Mouldy block", "Dull knife", "Broken compass",
  "Rusty coin", "Broken sextant", "Mouldy doll", "Smashed mirror",
]);
/** Gameval stem of each relic (obj salvaging_rare_<stem>, varbit salvaging_rare_<stem>_claimed) and its lamp. */
const RELIC_TABLE = Object.freeze([
  ["rusty_locket", "salvaging_rare_lamp_small"],
  ["mouldy_block", "salvaging_rare_lamp_small"],
  ["dull_knife", "salvaging_rare_lamp_small"],
  ["broken_compass", "salvaging_rare_lamp_med"],
  ["rusty_coin", "salvaging_rare_lamp_med"],
  ["broken_sextant", "salvaging_rare_lamp_med"],
  ["mouldy_doll", "salvaging_rare_lamp_large"],
  ["smashed_mirror", "salvaging_rare_lamp_large"],
]);

let api = null;
let core = null;
let ids = null;
/** Player -> the relic their current Haig conversation is about. */
const handingIn = new WeakMap();

function gameval(lookup, kind, name) {
  const id = lookup(name);
  if (!Number.isInteger(id)) throw new Error(`[museum] unknown ${kind} gameval ${name}`);
  return id;
}

function resolveIds() {
  const defs = core.CacheDefinitions;
  const obj = (name) => gameval((value) => defs.getObjId(value), "obj", name);
  const varbit = (name) => gameval((value) => defs.getVarbitId(value), "varbit", name);
  const allClaimed = varbit("salvaging_rare_all_claimed");
  const relics = RELIC_TABLE.map(([stem, lamp]) => {
    const itemId = obj(`salvaging_rare_${stem}`);
    const claimedVarbit = varbit(`salvaging_rare_${stem}_claimed`);
    return {
      itemId,
      lampId: obj(lamp),
      claimedVarbit,
      // Its bit in salvaging_rare_all_claimed, which covers every relic's flag.
      bit: 1 << (defs.getVarbit(claimedVarbit).startBit - defs.getVarbit(allClaimed).startBit),
      name: core.ItemDefinition.forId(itemId).getName().toLowerCase(),
      variant: `turning-in-shipwreck-salvaging-relics-${stem.replace(/_/g, "-")}`,
    };
  });
  return {
    curator: gameval((value) => defs.getNpcId(value), "npc", "curator"),
    allClaimed,
    relics: new Map(relics.map((relic) => [relic.itemId, relic])),
  };
}

function claimedOf(player) {
  return Number(player.getAttribute(CLAIMED_ATTRIBUTE)) || 0;
}

function isClaimed(player, relic) {
  return (claimedOf(player) & relic.bit) !== 0;
}

function sendClaimed({ player }) {
  player.getPacketSender().sendVarbit(ids.allClaimed, claimedOf(player));
}

function carriedRelic(player) {
  const inventory = player.getInventory();
  for (const relic of ids.relics.values()) {
    if (inventory.getAmount(relic.itemId) > 0) return relic;
  }
  return null;
}

const sendMesboxCopy = (player, text) =>
  player.getPacketSender().sendTypedMessage(core.ChatType.MESBOX, String(text).replace(/<br>/g, " "));

function inspectRelic(event) {
  const { player, itemId } = event;
  if (!ids.relics.has(itemId)) return false;
  const text = `${core.ItemDefinition.forId(itemId).getExamine()} ${INSPECT_SUFFIX}`;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, itemId, core.ChatTextLayout.wrap(text).join("<br>"))));
  sendMesboxCopy(player, text);
  return true;
}

function findRelicOption(steps) {
  for (const step of steps ?? []) {
    const option = (step.options ?? []).find((entry) => entry.text === RELIC_OPTION);
    if (option) return option;
    const nested = findRelicOption(step.steps);
    if (nested) return nested;
  }
  return null;
}

/** A menu step naming the relic being traded, with `no` as its "No." option's steps. */
function relicMenu(choice, relic, no) {
  return {
    ...choice,
    prompt: String(choice.prompt ?? "").replace(/^Trade the .+? in for/, `Trade the ${relic.name} in for`),
    options: choice.options.map((option) => option.text === "No." ? { ...option, steps: no } : option),
  };
}

/**
 * The relic section's steps for this player: the opening line and "You show" box, then the
 * first-time offer and menu, or the repeat offer and menu once the relic is claimed.
 */
function handInSteps(raw, relic, claimed) {
  const option = findRelicOption(raw);
  if (!option) return null;
  const steps = JSON.parse(JSON.stringify(option.steps));
  const conditions = steps.filter((step) => step.type === "condition");
  const choices = steps.filter((step) => step.type === "choice");
  if (conditions.length !== 2 || choices.length !== 2) return null;
  const opening = steps.slice(0, steps.indexOf(conditions[0]));
  const keep = choices[0].options.find((entry) => entry.text === "No.")?.steps ?? [{ type: "end" }];
  const [condition, choice] = claimed ? [conditions[1], choices[1]] : [conditions[0], choices[0]];
  return [...opening, ...(condition.steps ?? []), relicMenu(choice, relic, keep)];
}

function startHandIn(player, relic, npc = null) {
  const claimed = isClaimed(player, relic);
  handingIn.set(player, relic);
  return runtime.startTranscript(api, player, ids.curator, PAGE, relic.variant,
    (raw) => handInSteps(raw, relic, claimed), npc);
}

function useRelicOnCurator(event) {
  const { player, itemId } = event;
  const npcId = event.npcId ?? event.target?.getId?.();
  const relic = ids.relics.get(itemId);
  if (npcId !== ids.curator || !relic) return;
  event.handled = true;
  startHandIn(player, relic, event.target ?? null);
}

function answerRelicCondition({ player, npcId, text }) {
  if (npcId !== ids.curator || text !== RELIC_CONDITION) return null;
  return carriedRelic(player) !== null;
}

function chooseRelicOption(choice) {
  const { player, npcId, option } = choice;
  if (npcId !== ids.curator || option !== RELIC_OPTION) return;
  const relic = carriedRelic(player);
  if (!relic) return;
  choice.end = true;
  startHandIn(player, relic, choice.npc ?? null);
}

/** Takes the relic and pays for it: a claimed flag, 1 Kudos and its lamp, or 5,000 coins. */
function tradeRelic(player, relic, forLamp) {
  const inventory = player.getInventory();
  if (inventory.getAmount(relic.itemId) < 1) return false;
  inventory.delete(relic.itemId, 1);
  if (forLamp) {
    const claimed = claimedOf(player) | relic.bit;
    player.setAttribute(CLAIMED_ATTRIBUTE, claimed);
    player.getPacketSender().sendVarbit(ids.allClaimed, claimed);
    api.emitCustomEvent(AWARD_KUDOS_EVENT, { player, amount: KUDOS_PER_RELIC, source: `salvaging-relic:${relic.itemId}` });
    runtime.giveReward(player, relic.lampId, 1);
  } else {
    runtime.giveReward(player, COINS, REPEAT_COINS);
  }
  return true;
}

/** "You show ..." and "You hand ..." are object boxes beside the relic, with a chat copy. */
function relicMessage(message) {
  const { player, npcId, kind } = message;
  if (npcId !== ids.curator || kind !== "message") return;
  const relic = handingIn.get(player);
  const text = String(message.text ?? "");
  if (!relic || !(text.startsWith(SHOW_PREFIX) || text.startsWith(HAND_PREFIX))) return;
  message.handled = true;
  if (text.startsWith(HAND_PREFIX)) {
    handingIn.delete(player);
    // A relic dropped or banked while the menu was open: nothing to hand over.
    if (!tradeRelic(player, relic, !isClaimed(player, relic) && text.includes("lamp"))) {
      message.end = true;
      return;
    }
  }
  sendMesboxCopy(player, text);
  message.box = { items: [relic.itemId] };
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = resolveIds();
  pluginApi.persistAttribute(CLAIMED_ATTRIBUTE, 0);
  for (const name of RELIC_NAMES) pluginApi.onItemAction(name, { Inspect: inspectRelic });
  pluginApi.onItemOnNpc(useRelicOnCurator);
  pluginApi.onNpcDialogueCondition(answerRelicCondition);
  pluginApi.onCustomEvent("npc-dialogue:choice", chooseRelicOption);
  pluginApi.onCustomEvent("npc-dialogue:action", relicMessage);
  pluginApi.onPlayerLogin(sendClaimed);
  pluginApi.onCustomEvent("player:bootstrap-complete", sendClaimed);
};
