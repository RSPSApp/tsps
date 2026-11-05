/**
 * Trouble Brewing's waiting rooms and countdown (Wiki): San Fan signs the blue team, Fancy Dan
 * the red team and Honest Jimmy the smaller one; each side needs one player. Entry needs Cabin
 * Fever, 40 Cooking, no items, nothing on the head and no follower. The player waits in the real
 * waiting room until both sides are ready, then a 30 second countdown starts the game.
 */
const Common = require("./Common.TroubleBrewing");
const Game = require("./Game.TroubleBrewing");

const MIN_COOKING = 40;
const QUEST_KEY = "cabin_fever";
// Cache revision 241 clientscript 1598's exact combined condition line.
const QUEST_AND_COOKING_LINE = "You must have completed Cabin Fever and got a Cooking level of 40 to play Trouble Brewing.";
// Talk-to/join-team transcript lines (data/definitions/npc-dialogues.json): San Fan and Fancy
// Dan under "I would like to join your crew.", Honest Jimmy under the right-click join variant.
const FOLLOWER_LINE = "You cannot take your follower into the game.";
const REFUSALS = Object.freeze({
  "San Fan": {
    helmet: "Well, for a start off, come and see me when you don't have that thing on your head.",
    items: "Hah, think that I'm going to assign you the easy tasks eh?",
  },
  "Fancy Dan": {
    helmet: "However, I don't let anyone on the team if they are wearing a hat or a helmet.",
    items: "Well, I'll be glad to have you aboard, but you will need to go and store all of your gear first.",
  },
  "Honest Jimmy": {
    helmet: "Sorry, no hats allowed. Shove it in the deposit box if you want to play.",
    items: "Might want to dump that stuff yer holdin'.",
  },
});
const queues = { red: new Set(), blue: new Set() };
let countdown = null;

function questComplete(player, key) {
  const request = { player, key, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function refusal(player, npc = "Honest Jimmy") {
  const lines = REFUSALS[npc];
  if (!questComplete(player, QUEST_KEY) ||
      player.getSkillManager().getCurrentLevel(Common.core.Skill.COOKING) < MIN_COOKING) {
    return QUEST_AND_COOKING_LINE;
  }
  const head = player.getEquipment().get(Common.core.Equipment.HEAD_SLOT);
  if (head && head.getId() > 0) return lines.helmet;
  if (player.getInventory().getValidItems?.().length > 0) return lines.items;
  if (player.getAttribute?.("pets:current")) return FOLLOWER_LINE;
  return null;
}

function join(player, team, npc) {
  if (Game.gameOf(player) || inQueue(player)) return true;
  if (team === "auto") team = queues.blue.size <= queues.red.size ? "blue" : "red";
  const refused = refusal(player, npc);
  if (refused) {
    player.sendMessage(refused);
    return true;
  }
  player.moveTo(Common.toLocation(Common.WAITING[team].spawn));
  queues[team].add(player);
  return true;
}

const joinBlue = ({ player }) => join(player, "blue", "San Fan");
const joinRed = ({ player }) => join(player, "red", "Fancy Dan");
const joinAuto = ({ player }) => join(player, "auto", "Honest Jimmy");

function inQueue(player) {
  return Common.TEAMS.some((team) => queues[team].has(player));
}

function leaveWaiting(player) {
  for (const team of Common.TEAMS) queues[team].delete(player);
  player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
}

function forget({ player }) {
  if (inQueue(player)) player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
  for (const team of Common.TEAMS) queues[team].delete(player);
}

function ready() {
  return queues.red.size > 0 && queues.blue.size > 0;
}

function start() {
  const players = { red: new Set(queues.red), blue: new Set(queues.blue) };
  if (!ready()) return;
  for (const team of Common.TEAMS) queues[team].clear();
  countdown = null;
  Game.startNew(players);
}

function tick() {
  if (Game.current) return true;
  if (!ready()) {
    countdown = null;
    return true;
  }
  if (countdown === null) {
    countdown = Common.START_COUNTDOWN;
  }
  countdown--;
  if (countdown <= 0) start();
  return true;
}

const joinActions = (fn) => ({ "Talk-To": fn, "Talk-to": fn, "Join-Crew": fn });

function attachLobby(api) {
  api.onNpcInteraction("San Fan", joinActions(joinBlue));
  api.onNpcInteraction("Fancy Dan", joinActions(joinRed));
  api.onNpcInteraction("Honest Jimmy", joinActions(joinAuto));
  api.onPlayerLogout(forget);
  Common.every(tick);
}

module.exports = { attachLobby, join, leaveWaiting, refusal, queues, tick, ready, inQueue, start };
