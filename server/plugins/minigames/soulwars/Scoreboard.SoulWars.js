"use strict";

/**
 * The lobby scoreboard (soul_wars_scoreboard, "Scoreboard": View), interface soul_wars_stats.
 *
 * Wiki (Scoreboard (Soul Wars)): "See your scores here." It shows stats from the reader's own
 * games and the minigame's global ones: games played, players killed and Avatars killed. The
 * interface's only text is soul_wars_stats:scroll_text, which no cache script fills, so the
 * server writes it. The reader's lines are the game's own lifetime counters (Stats.SoulWars.js:
 * soul_wars_total_games / _wins / _kills / _deaths; a game counts for the player on entry).
 * The world's are counted per game and added when it ends, saved once then: a game counts when
 * each side started with a real (non-bot) player, with its enemy players killed
 * (Death.SoulWars.js; a bot killing a bot is not counted) and its Avatars killed
 * (Avatars.SoulWars.js). They are kept in data/saves/soul-wars-scoreboard.json.
 */

const fs = require("node:fs");
const path = require("node:path");
const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");

const SCOREBOARD_LOC = "soul_wars_scoreboard";
const INTERFACE_NAME = "soul_wars_stats";
const TEXT_COMPONENT = "soul_wars_stats:scroll_text";

let FILE = path.join(process.cwd(), "data", "saves", "soul-wars-scoreboard.json");
let world = null;

const count = (value) => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const number = (value) => count(value).toLocaleString("en-US");

function records() {
  if (world) return world;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    saved = null;
  }
  world = { games: count(saved?.games), playersKilled: count(saved?.playersKilled), avatarsKilled: count(saved?.avatarsKilled) };
  return world;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(records()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (error) {
    console.warn(`[soul-wars] scoreboard could not be saved: ${error.message}`);
  }
}

/** Per game: the kills and Avatar kills it has seen, and whether it counts for the world. */
const tallies = new WeakMap();

const real = (player) => player?.isPlayerBot?.() !== true;

/** A game began: it counts for the world when each side starts with a real (non-bot) player. */
function gameStarted(game) {
  const realOn = (team) => [...(game.members?.[team] ?? [])].some(real);
  tallies.set(game, { counts: realOn("blue") && realOn("red"), playersKilled: 0, avatarsKilled: 0 });
}

/** `killer` killed `victim`, an enemy, in `game` (Death.SoulWars.js). Bots killing bots don't count. */
function playerKilled(game, killer, victim) {
  const tally = tallies.get(game);
  if (tally && (real(killer) || real(victim))) tally.playersKilled++;
}

/** An Avatar killed in `game` (Avatars.SoulWars.js). */
function avatarKilled(game) {
  const tally = tallies.get(game);
  if (tally) tally.avatarsKilled++;
}

/** A game ended: what it counted joins the world's records, saved once. */
function gameEnded(game) {
  const tally = tallies.get(game);
  tallies.delete(game);
  if (!tally?.counts) return;
  const totals = records();
  totals.games++;
  totals.playersKilled += tally.playersKilled;
  totals.avatarsKilled += tally.avatarsKilled;
  save();
}

function text(player) {
  const totals = records();
  return [
    "Your Soul Wars statistics",
    `Games played: ${number(Common.getVarp(player, "total_games"))}`,
    `Games won: ${number(Common.getVarp(player, "total_wins"))}`,
    `Players killed: ${number(Common.getVarp(player, "total_kills"))}`,
    `Deaths: ${number(Common.getVarp(player, "total_deaths"))}`,
    "",
    "Global statistics",
    `Games played: ${number(totals.games)}`,
    `Players killed: ${number(totals.playersKilled)}`,
    `Avatars killed: ${number(totals.avatarsKilled)}`,
  ].join("<br>");
}

function view(event) {
  if (event.objectId !== Common.core.CacheDefinitions.getLocId(SCOREBOARD_LOC)) return false;
  const sender = event.player.getPacketSender();
  sender.sendInterface(Common.core.CacheDefinitions.getInterfaceId(INTERFACE_NAME));
  sender.sendString(text(event.player), Common.component(TEXT_COMPONENT));
  return true;
}

function attachScoreboard(api) {
  Match.onStart(gameStarted);
  Match.onEnd(gameEnded);
  api.onObjectInteraction("Scoreboard", { View: view });
}

module.exports = {
  attachScoreboard, gameStarted, playerKilled, avatarKilled, gameEnded, view, text,
  SCOREBOARD_LOC, INTERFACE_NAME, TEXT_COMPONENT,
  /** Tests: read and write the world's records at `file` instead, from scratch. */
  _useFile(file) { FILE = file; world = null; },
};
