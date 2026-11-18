"use strict";

/**
 * The two lobby scoreboards (castlewars_scoreboard, "Scoreboard": View, View Stats).
 *
 * Wiki (Scoreboard (Castle Wars)): "Keep track of which team has the most victories." View shows
 * each team's wins, View Stats the reader's own record: "You've played X games of Castle Wars.
 * - Won: Y Lost: Z." View opens interface castlewars_score, whose cache text is "Total Wins This
 * Season!" over "Saradomin: 0" and "Zamorak: 0" (castlewars_saradomin_totalscore and
 * castlewars_zamorak_totalscore); no cache script reads the castlewars_wins / castlewars_loss /
 * castlewars_games_played varps, so the server writes both lines.
 *
 * Game.CastleWars.js tells it each real (non-bot) player's result ("castlewars:player-result")
 * and the game's winner ("castlewars:game-won", only when a real player of the leading side is
 * still in the game) when a game ends. A tie is a game played, neither won nor lost.
 * The teams' wins are kept in data/saves/castle-wars-scoreboard.json.
 */

const fs = require("node:fs");
const path = require("node:path");

const SCOREBOARD_LOC = "castlewars_scoreboard";
const INTERFACE_NAME = "castlewars_score";
const TOTAL_COMPONENT = {
  saradomin: "castlewars_saradomin_totalscore",
  zamorak: "castlewars_zamorak_totalscore",
};
const TEAM_NAME = { saradomin: "Saradomin", zamorak: "Zamorak" };

const GAMES_ATTRIBUTE = "castlewars:games-played";
const WINS_ATTRIBUTE = "castlewars:wins";
const LOSSES_ATTRIBUTE = "castlewars:losses";

let FILE = path.join(process.cwd(), "data", "saves", "castle-wars-scoreboard.json");
let world = null;
let core = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const cache = () => core.CacheDefinitions;

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = { saradomin: count(saved?.saradomin), zamorak: count(saved?.zamorak) };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[castle-wars] scoreboard could not be saved: ${error.message}`);
  }
}

function bump(player, attribute) {
  player.setAttribute(attribute, count(player.getAttribute(attribute)) + 1);
}

/** One player's game ended: `result` is "win", "loss" or "tie". */
function playerResult({ player, result }) {
  if (!player) return;
  bump(player, GAMES_ATTRIBUTE);
  if (result === "win") bump(player, WINS_ATTRIBUTE);
  else if (result === "loss") bump(player, LOSSES_ATTRIBUTE);
}

/** A game ended with `team` ahead. */
function gameWon({ team }) {
  const totals = records();
  if (!(team in totals)) return;
  totals[team]++;
  save();
}

const isBoard = (event) => event.objectId === cache().getLocId(SCOREBOARD_LOC);

function view(event) {
  if (!isBoard(event)) return false;
  const sender = event.player.getPacketSender();
  const totals = records();
  sender.sendInterface(cache().getInterfaceId(INTERFACE_NAME));
  for (const [team, component] of Object.entries(TOTAL_COMPONENT)) {
    sender.sendString(`${TEAM_NAME[team]}: ${totals[team]}`, cache().getComponentId(`${INTERFACE_NAME}:${component}`));
  }
  return true;
}

function statsText(player) {
  const games = count(player.getAttribute(GAMES_ATTRIBUTE));
  return `You've played ${games} games of Castle Wars.<br>`
    + `Won: ${count(player.getAttribute(WINS_ATTRIBUTE))} Lost: ${count(player.getAttribute(LOSSES_ATTRIBUTE))}`;
}

function viewStats(event) {
  if (!isBoard(event)) return false;
  const { DialogueChainBuilder, StatementDialogue } = core;
  event.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, statsText(event.player)),
  ));
  return true;
}

function attachScoreboard(api) {
  core = api.core;
  api.persistAttribute(GAMES_ATTRIBUTE, 0);
  api.persistAttribute(WINS_ATTRIBUTE, 0);
  api.persistAttribute(LOSSES_ATTRIBUTE, 0);
  api.onCustomEvent("castlewars:player-result", playerResult);
  api.onCustomEvent("castlewars:game-won", gameWon);
  api.onObjectInteraction("Scoreboard", { View: view, "View Stats": viewStats });
}

module.exports = {
  attachScoreboard, playerResult, gameWon, view, viewStats, statsText,
  SCOREBOARD_LOC, INTERFACE_NAME, TOTAL_COMPONENT, GAMES_ATTRIBUTE, WINS_ATTRIBUTE, LOSSES_ATTRIBUTE,
  /** Tests: read and write the teams' wins at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
