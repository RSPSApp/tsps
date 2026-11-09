/**
 * The Darkfrost camp: Taala and the scoreboard.
 *
 * Taala's lines are the Wiki transcript's (data/definitions/npc-dialogues.json, captured
 * word for word in rsprox 3274): the first talk explains the fight and, at "But I'm sure you'll
 * figure it out!", sets huey_intro (11413), which opens the chain; later talks are the
 * subsequent dialogue. Her conditions are Perilous Moons and a combat level of 85 (a lower one
 * gets the recommendation message instead of the tips, and may still climb, Wiki).
 *
 * The scoreboard (huey_scoreboard) opens interface 884 with the title "The Hueycoatl -
 * Statistics", the player's kill count, deaths and best time, and the world's (captured).
 */
const Shared = require("./Shared.Hueycoatl");
const Area = require("./Area.Hueycoatl");
const Kills = require("./Kills.Hueycoatl");

const INITIAL = "standard-dialogue-initial-dialogue";
const SUBSEQUENT = "standard-dialogue-subsequent-dialogue";
const INTRO_LINE = "But I'm sure you'll figure it out!";
const RECOMMENDATION = "To face the Hueycoatl, it's recommended";
const RECOMMENDED_COMBAT = 85;
const PERILOUS_MOONS = "perilous_moons";
const SCOREBOARD_INTERFACE = 884;
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

const SCOREBOARD = Object.freeze({ title: 6, pkc: 9, pd: 11, pbt: 13, gkc: 15, gd: 17, gbt: 19 });
const SCOREBOARD_TITLE = "The Hueycoatl - Statistics";

let api = null;

function introduced(player) {
  return player.getAttribute(Area.TAALA_INTRO_ATTRIBUTE) === true;
}

function setIntroduced(player) {
  player.setAttribute(Area.TAALA_INTRO_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(Shared.VARBIT.INTRO, 1);
}

function taalaVariant({ player, npcId }) {
  if (npcId !== Shared.NPC.TAALA) return null;
  return introduced(player) ? SUBSEQUENT : INITIAL;
}

function taalaCondition({ player, npcId, text }) {
  if (npcId !== Shared.NPC.TAALA) return null;
  if (/Perilous Moons/.test(text)) {
    const request = { player, key: PERILOUS_MOONS, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    const complete = request.complete === true;
    return /has not completed/.test(text) ? !complete : complete;
  }
  const level = player.getSkillManager().getCombatLevel();
  if (/combat level below 85/.test(text)) return level < RECOMMENDED_COMBAT;
  if (/combat level above 85/.test(text)) return level >= RECOMMENDED_COMBAT;
  return null;
}

/** Her last tip (or the recommendation) opens the chain. */
function taalaLine(request) {
  if (request.npcId !== Shared.NPC.TAALA || !String(request.text).startsWith(INTRO_LINE)) return;
  const { player } = request;
  const previous = request.after;
  request.after = () => {
    previous?.();
    setIntroduced(player);
  };
}

function taalaMessage(request) {
  if (request.npcId !== Shared.NPC.TAALA || !String(request.text ?? "").startsWith(RECOMMENDATION)) return;
  setIntroduced(request.player);
}

const number = (value) => Math.max(0, value).toLocaleString("en-US");
const best = (ticks) => (ticks > 0 ? Shared.formatTicks(ticks) : "-");

function readScoreboard({ player }) {
  const uid = (component) => (SCOREBOARD_INTERFACE << 16) | component;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(SCOREBOARD_INTERFACE);
  sender.sendString(SCOREBOARD_TITLE, uid(SCOREBOARD.title));
  sender.sendString(number(Shared.counter(player, Shared.KILLS_ATTRIBUTE)), uid(SCOREBOARD.pkc));
  sender.sendString(number(Shared.counter(player, Shared.DEATHS_ATTRIBUTE)), uid(SCOREBOARD.pd));
  sender.sendString(best(Shared.counter(player, Shared.BEST_TICKS_ATTRIBUTE)), uid(SCOREBOARD.pbt));
  sender.sendString(number(Kills.world.kills), uid(SCOREBOARD.gkc));
  sender.sendString(number(Area.world.deaths), uid(SCOREBOARD.gd));
  sender.sendString(best(Kills.world.best), uid(SCOREBOARD.gbt));
  return true;
}

function scoreboard(event) {
  if (event.objectId !== Shared.LOC.SCOREBOARD) return false;
  return readScoreboard(event);
}

function attach(pluginApi) {
  api = pluginApi;
  pluginApi.onNpcDialogueVariant(taalaVariant);
  pluginApi.onNpcDialogueCondition(taalaCondition);
  pluginApi.onCustomEvent("npc-dialogue:line", taalaLine);
  pluginApi.onCustomEvent("npc-dialogue:action", taalaMessage);
  pluginApi.onObjectInteraction("Scoreboard", { Read: scoreboard });
}

module.exports = { attach, _test: { taalaVariant, taalaCondition } };
