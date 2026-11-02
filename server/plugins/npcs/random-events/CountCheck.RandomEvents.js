"use strict";

// Count Check (random event): talking reports his account check and hands out a lamp when the
// player passes. Lines and order from the Wiki's Count Check transcript and recordings 4053,
// 1148 (fail line, then "I must be leaving now." when talked to again). OSRS requires a Jagex
// Account and a Bank PIN; every account on this server counts as a Jagex account, the Bank PIN
// plugin answers for the PIN. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const PASSED = "Ahahahaha! I, Count Check, have checked your account.<br>You have a Jagex Account, and you have set a Bank PIN,<br>so you pass my checks! Enjoy your prize.";
const FAILED = "Ahahahaha! I, Count Check, have checked your account.<br>You do not have a Bank PIN, so you fail my checks!<br>Talk to a banker to set a PIN before we meet again.";
const EXPRESSION = 612; // 4053 tick 2014.
const WAVE = 863, BOW = 858;

function hasPin(api, player) {
  const query = { player, set: false };
  api.emitCustomEvent("bank-pin:status", query);
  return query.set;
}

function definition(api) {
  return {
    id: api.core.NpcIdentifiers.COUNT_CHECK_2,
    underwaterId: api.core.NpcIdentifiers.COUNT_CHECK_3,
    kind: "countcheck",
    linger: true,
    greet: name => `Ahahahaha, ${name}!`,
    nags: [name => `Please let me check you, ${name}!`, name => `I have come to check you, ${name}...`],
    goodbye: "Ahahahaha, ONE more person ignored me...",
    overheadAnimation: WAVE,
    leaveAnimation: BOW,
    otherPlayerLine: owner => `I came to check ${owner.getUsername()}, not you.`,
    leavingLine: () => "I must be leaving now.",
    talk(active, { serve, leave }) {
      const player = active.player, npcId = active.npc.getId();
      const passed = hasPin(api, player);
      if (passed ? !serve(active, [api.core.ItemIdentifiers.LAMP]) : !leave(active)) return;
      Flow.chat(api, { player, npcId, lines: [{ text: passed ? PASSED : FAILED, expression: EXPRESSION }] });
    },
  };
}

module.exports = function attach(api, Events) {
  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition(api)));
};
