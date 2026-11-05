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
const queues = { red: new Set(), blue: new Set() };
let countdown = null;

function questComplete(player, key) {
  const request = { player, key, complete: null };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function refusal(player) {
  if (!questComplete(player, QUEST_KEY)) return "You need to have completed Cabin Fever to play Trouble Brewing.";
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.COOKING) < MIN_COOKING) {
    return `You need a Cooking level of ${MIN_COOKING} to play Trouble Brewing.`;
  }
  if (player.getInventory().getValidItems?.().length > 0) return "You need to bank your items before playing Trouble Brewing.";
  const head = player.getEquipment().get(Common.core.Equipment.HEAD_SLOT);
  if (head && head.getId() > 0) return "You need to remove your headgear before playing Trouble Brewing.";
  if (player.getAttribute?.("pets:current")) return "You need to leave your follower outside.";
  return null;
}

function join(player, team) {
  if (Game.gameOf(player) || inQueue(player)) {
    player.sendMessage("You are already waiting for a game.");
    return true;
  }
  if (team === "auto") team = queues.blue.size <= queues.red.size ? "blue" : "red";
  const refused = refusal(player);
  if (refused) {
    player.sendMessage(refused);
    return true;
  }
  player.moveTo(Common.toLocation(Common.WAITING[team].spawn));
  queues[team].add(player);
  player.sendMessage(`You sign up for the ${Common.BASE[team].name.toLowerCase()} team.`);
  player.sendMessage(queues[team].size === 1 ? "You are the first on your team. Waiting for the other team." : "Waiting for the game to begin.");
  return true;
}

const joinBlue = ({ player }) => join(player, "blue");
const joinRed = ({ player }) => join(player, "red");
const joinAuto = ({ player }) => join(player, "auto");

function inQueue(player) {
  return Common.TEAMS.some((team) => queues[team].has(player));
}

function leaveWaiting(player) {
  for (const team of Common.TEAMS) queues[team].delete(player);
  player.moveTo(Common.toLocation(Common.LOBBY_RETURN));
  player.sendMessage("You leave the waiting room.");
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
    for (const team of Common.TEAMS) {
      for (const player of queues[team]) player.sendMessage("Both teams are ready. The game begins shortly.");
    }
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
