"use strict";

/**
 * The Competition Judge of the Ranging Guild's shooting range. His transcript starts a round
 * for 200 coins and hands over 10 bronze arrows, refuses the under-40 Ranged the guild asks
 * for, answers "How am I doing so far?" and pays out the finishing dialogue once.
 * (Transcript: Competition Judge; the 81-89 score tier is undocumented and reads as "Not bad".)
 */

const Session = require("./Session.ArcheryCompetition");

const RULES_LINES = [
  "The rules are very simple:",
  "You're given 10 shots at the targets, for each hit you will receive points. At the end you'll be awarded 1 ticket for every 10 points.",
];
const NO_MONEY_LINE = "Oops, I don't have enough coins on me...";
const COME_BACK_LINE = "Never mind, come back when you've got enough.";

let api;
let core;
let judgeId;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  judgeId = core.NpcIdentifiers.COMPETITION_JUDGE;
}

/** One chain of [kind, text] pages, then an optional option menu of [text, action] pairs. */
function show(player, steps, menu) {
  const chain = new core.DialogueChainBuilder();
  let index = 0;
  for (const [kind, text] of steps) {
    if (kind === "player") chain.add(new core.PlayerDialogue(index, text));
    else if (kind === "statement") chain.add(new core.StatementDialogue(index, text));
    else chain.add(new core.NpcDialogue(index, judgeId, text));
    index++;
  }
  if (menu) {
    chain.add(new core.OptionDialogue(index, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const entry = menu[Number(option)];
        if (entry) entry[1]();
      },
    }, ...menu.map(([text]) => text)));
  }
  player.getDialogueManager().startDialogues(chain);
}

function talkTo({ player }) {
  if (Session.level(player) < Session.RANGED_LEVEL) {
    show(player, [["npc", "Sorry, you need a Ranged level of 40 to take part in the archery competition."]]);
    return;
  }
  const session = Session.sessionOf(player);
  if (session && session.finished) {
    finishing(player, session);
    return;
  }
  if (session) {
    talkingAgain(player);
    return;
  }
  standard(player);
}

/** Not mid-round: the offer, the rules or leave. The greeting remembers a past visit. */
function standard(player) {
  const first = !Session.hasPlayed(player);
  Session.markPlayed(player);
  show(player, [["npc", first
    ? "Hello there, would you like to take part in the archery competition? It only costs 200 coins to enter."
    : "Hello again, do you need reminding of the rules?"]], [
    ["Sure, I'll give it a go.", () => accept(player)],
    ["What are the rules?", () => standardRules(player)],
    ["No thanks.", () => show(player, [["player", "No thanks."]])],
  ]);
}

function standardRules(player) {
  show(player, [
    ["player", "What are the rules?"],
    ["npc", RULES_LINES[0]],
    ["npc", RULES_LINES[1]],
    ["npc", "The tickets can be exchanged for goods from our stores. Do you want to give it a go? Only 200 coins."],
  ], [
    ["Sure, I'll give it a go.", () => accept(player)],
    ["No thanks.", () => show(player, [["player", "No thanks."]])],
  ]);
}

function talkingAgain(player) {
  show(player, [["npc", "Hello again, do you need reminding of the rules?"]], [
    ["Yes please.", () => recallRules(player)],
    ["No thanks, I've got it.", () => show(player, [["player", "No thanks, I've got it."], ["npc", "Glad to hear it, good luck!"]])],
    ["How am I doing so far?", () => scoreCheck(player)],
  ]);
}

function recallRules(player) {
  show(player, [
    ["player", "Yes please."],
    ["npc", RULES_LINES[0]],
    ["npc", RULES_LINES[1]],
    ["npc", "The tickets can be exchanged for goods from our stores. Good luck!"],
  ]);
}

function scoreCheck(player) {
  const score = Session.sessionOf(player)?.score ?? 0;
  show(player, [
    ["player", "How am I doing so far?"],
    ["npc", `So far your score is: ${score}. ${Session.scoreMessage(score)}`],
  ]);
}

/** Accepting an offer, first time or replay: pay only when the round can actually start. */
function accept(player) {
  if (!Session.canStart(player)) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() === 0 && !inventory.contains(core.ItemIdentifiers.BRONZE_ARROW)) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    show(player, [
      ["player", "Sure, I'll give it a go."],
      ["npc", "Great! That will be 200 coins then please."],
      ["player", NO_MONEY_LINE],
      ["npc", COME_BACK_LINE],
    ]);
    return;
  }
  show(player, [
    ["player", "Sure, I'll give it a go."],
    ["npc", "Great! That will be 200 coins then please."],
    ["statement", "You pay the judge and he gives you 10 bronze arrows."],
  ]);
  Session.startRound(player);
}

function finishing(player, session) {
  Session.claimTickets(player);
  show(player, [[
    "npc",
    `Well done. Your score is: ${session.score}. For that score you will receive ${Session.ticketsFor(session.score)} Archery tickets. Would you like to try again for another 200 coins?`,
  ]], [
    ["Sure, I'll give it a go.", () => accept(player)],
    ["No thanks.", () => show(player, [["player", "No thanks."]])],
  ]);
}

module.exports = function registerJudge(pluginApi) {
  init(pluginApi);
  api.onNpcInteraction("Competition Judge", { "Talk-to": talkTo });
};

Object.assign(module.exports, { _test: { init, talkTo, accept } });
