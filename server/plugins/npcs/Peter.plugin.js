"use strict";

/**
 * Peter at the Fossil Island Museum Camp turns fossil drops off and on (Wiki transcript
 * "Peter", rsprox captures rec 3040 rev 231): "Talk about fossils." and the "Toggle Fossils"
 * option play the page's own branches, and his confirming line flips the player's
 * fossil_drop_rare_blocked (rare fossils) or fossil_drop_blocked (small, medium and large)
 * varbit. Fossil sources ask "fossil-island:fossil-drop" before they hand a fossil over.
 */

const PAGE = "Peter";
const TOGGLE_VARIANT = "context-menu-toggle-fossils-option";
const RARE_ATTRIBUTE = "fossil-island:rare-fossils-blocked";
const NORMAL_ATTRIBUTE = "fossil-island:fossils-blocked";
const FLAGS = {
  rare: { attribute: RARE_ATTRIBUTE, varbit: "fossil_drop_rare_blocked" },
  normal: { attribute: NORMAL_ATTRIBUTE, varbit: "fossil_drop_blocked" },
};

/** Transcript condition ids -> [flag, true when the flag is blocked]. */
const CONDITIONS = new Map([
  ["h7oPQC", ["rare", false]], ["PxbFTf", ["rare", true]],
  ["vyf_MS", ["normal", false]], ["ECueIP", ["normal", true]],
  ["fOP2Dx", ["rare", false]], ["qyfunx", ["rare", true]],
  ["vGxEpp", ["normal", false]], ["KF02ub", ["normal", true]],
]);

/**
 * Peter's confirming lines: the varbit changes as he says them (rec 3040 ticks 2634, 2968,
 * 3801, 3840, 3891), after the player's own "Yes I'm sure." line.
 */
const CONFIRMATIONS = new Map([
  ["So be it, I'll spread the word, rare fossils won't drop for you anymore. Come back to me if you change your mind.", ["rare", true]],
  ["Of course you are! I'll get the word out and you'll start to see rare fossils drop again.", ["rare", false]],
  ["Fine... I'll spread the word, you won't see fossils dropped on the island anymore... Come back to me if you change your mind.", ["normal", true]],
  ["Of course you are! I'll get the word out and you'll start to see fossils drop again.", ["normal", false]],
  ["That has been done, rare fossils won't drop for you anymore. Come back to me if you change your mind.", ["rare", true]],
  ["Excellent, you'll start to see rare fossils showing up on the island again.", ["rare", false]],
  ["Fine, regular fossils won't drop for you anymore. Come back to me if you change your mind", ["normal", true]],
  ["Great! You'll start to see fossils showing up on the island again.", ["normal", false]],
]);

let core = null;

function isPeter(npcId) {
  return npcId === core.NpcIdentifiers.PETER;
}

function blocked(player, flag) {
  return player.getAttribute(FLAGS[flag].attribute) === true;
}

function sendFlag(player, flag) {
  const id = core.CacheDefinitions.getVarbitId(FLAGS[flag].varbit);
  if (id != null) player.getPacketSender().sendVarbit(id, blocked(player, flag) ? 1 : 0);
}

function setFlag(player, flag, value) {
  player.setAttribute(FLAGS[flag].attribute, value);
  sendFlag(player, flag);
}

function toggleFossils(api, event) {
  const request = {
    player: event.player, npc: event.npc, npcId: event.npcId ?? event.npc?.getId?.(),
    variant: { page: PAGE, variant: TOGGLE_VARIANT }, exact: true, handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function answerCondition({ player, npcId, stepId }) {
  if (!isPeter(npcId) || !CONDITIONS.has(stepId)) return null;
  const [flag, whenBlocked] = CONDITIONS.get(stepId);
  return blocked(player, flag) === whenBlocked;
}

function confirmLine(request) {
  if (!isPeter(request.npcId) || typeof request.step?.npc !== "string") return;
  const change = CONFIRMATIONS.get(request.step.npc);
  if (!change) return;
  const [flag, value] = change;
  const before = request.before;
  request.before = () => {
    before?.();
    setFlag(request.player, flag, value);
  };
}

/** Rare toggle: the rare fossil; normal toggle: the small, medium and large ones. */
function fossilDrop(event) {
  if (event.blocked || !event.player) return;
  const I = core.ItemIdentifiers;
  if (event.itemId === I.UNIDENTIFIED_RARE_FOSSIL) event.blocked = blocked(event.player, "rare");
  else if ([I.UNIDENTIFIED_SMALL_FOSSIL, I.UNIDENTIFIED_MEDIUM_FOSSIL, I.UNIDENTIFIED_LARGE_FOSSIL].includes(event.itemId)) {
    event.blocked = blocked(event.player, "normal");
  }
}

function syncVarbits({ player }) {
  sendFlag(player, "rare");
  sendFlag(player, "normal");
}

function persist(api) {
  api.persistAttribute(RARE_ATTRIBUTE, false);
  api.persistAttribute(NORMAL_ATTRIBUTE, false);
}

function init(api) {
  core = api.core;
}

module.exports = {
  name: "Peter",
  description: "Peter at the Fossil Island Museum Camp turns rare or normal fossil drops off and on for the player, through his fossils talk and the Toggle Fossils option.",
  members: true,
  register(api) {
    init(api);
    persist(api);
    api.onNpcInteraction("Peter", { "Toggle Fossils": toggleFossils.bind(null, api) });
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:line", confirmLine);
    api.onCustomEvent("fossil-island:fossil-drop", fossilDrop);
    api.onPlayerLogin(syncVarbits);
  },
  _test: { RARE_ATTRIBUTE, NORMAL_ATTRIBUTE },
};
