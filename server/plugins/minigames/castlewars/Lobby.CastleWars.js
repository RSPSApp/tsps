"use strict";

/**
 * Castle Wars lobby: the team portals (Guthix balances the teams), the lobby bank chest, and the
 * portals back out of the waiting rooms and the game. In development a real player joining seeds
 * bots so a game can start; production worlds leave that off (world.json pluginConfig
 * "CastleWars:seedBots").
 */

const FoodPlugin = require("../../items/Food.plugin");
const { createBotPlayer } = require("../../bots/behaviours/spawn/BotPlayerFactory");
const { ATTR_SKIP_PERSISTENCE } = require("../../bots/runtime/BotPersistenceConstants");
const { ShopManager } = require("../../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

const CASTLE_WARS_TICKET_EXCHANGE_SHOP = 1432;
const SEED_BOTS_CONFIG_KEY = "CastleWars:seedBots";

const FOOD_ITEM_IDS = Array.isArray(FoodPlugin.FOOD_ITEM_IDS) ? FoodPlugin.FOOD_ITEM_IDS : [];

let api;
let game;
let core;
let data;
let botSerial = 0;

function moveToWaitingRoom(player, teamId) {
  game.setTeamId(player, teamId);
  player.sendMessage(`You have been added to the ${game.getTeamData(teamId).name} team.`);
  player.smartMove(game.getTeamData(teamId).waitingRoom, 8);
}

function spawnCastleWarsBot(teamId) {
  const username = `CWBot${++botSerial}`;
  const bot = createBotPlayer(username, data.LOBBY_TELEPORT, { api, loadPersistence: false, saveRandomizedAppearance: false });
  if (!bot) {
    return;
  }
  bot.setPlayerBot(true);
  bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  bot.setAttribute(game.BOT_KEY, true);
  api.emitPlayerLogin({ player: bot, username });
  moveToWaitingRoom(bot, teamId);
}

function seedCastleWarsBots(teamId) {
  const opposingTeam = game.opposingTeam(teamId);
  spawnCastleWarsBot(teamId);
  spawnCastleWarsBot(opposingTeam);
  spawnCastleWarsBot(opposingTeam);
}

/** Dev-only bot seeding: off unless world.json turns it on, so production lobbies are players only. */
function seedsBots(registry = api) {
  return registry.getPluginConfig(SEED_BOTS_CONFIG_KEY, false) === true;
}

/** The team a joiner lands on, or null when the requested team is already the bigger one. */
function chooseTeam(sizes, requestedTeam) {
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  const other = (team) => (team === SARADOMIN ? ZAMORAK : SARADOMIN);
  if (requestedTeam == null) {
    return sizes[ZAMORAK] > sizes[SARADOMIN] ? SARADOMIN : ZAMORAK;
  }
  return sizes[requestedTeam] > sizes[other(requestedTeam)] ? null : requestedTeam;
}

function joinWaitingRoom(player, requestedTeam) {
  const phase = game.getPhase();
  if (phase === game.PHASE.ACTIVE || phase === game.PHASE.ENDING) {
    player.sendMessage("There's already a Castle Wars game running. Please wait.");
    return;
  }
  const { HEAD_SLOT, CAPE_SLOT } = core.Equipment;
  if (player.getEquipment().getSlot(HEAD_SLOT) > 0 || player.getEquipment().getSlot(CAPE_SLOT) > 0) {
    player.sendMessage("You can't wear hats, capes, or helms in Castle Wars.");
    return;
  }
  if (FOOD_ITEM_IDS.length > 0 && player.getInventory().containsAny(FOOD_ITEM_IDS)) {
    player.sendMessage("You may not bring your own consumables inside Castle Wars.");
    return;
  }

  const teamId = chooseTeam(game.queueCounts(), requestedTeam);
  if (!teamId) {
    const team = game.getTeamData(requestedTeam).name;
    const other = game.getTeamData(game.opposingTeam(requestedTeam)).name;
    player.sendMessage(`The ${team} team is full, try ${other}.`);
    return;
  }

  moveToWaitingRoom(player, teamId);
  if (player.isPlayerBot() !== true && seedsBots()) {
    seedCastleWarsBots(teamId);
  }
}

function handleLobbyObject(player, object, clickType) {
  const id = object.getId();
  if (id === core.ObjectIdentifiers.BANK_CHEST_2) {
    if (clickType === 1) {
      player.getBank(player.getCurrentBankTab()).open();
    } else {
      player.sendMessage("The Grand Exchange is not available here.");
    }
    return true;
  }
  if (id in data.LOBBY_TEAMS) {
    joinWaitingRoom(player, data.LOBBY_TEAMS[id]);
    return true;
  }
  return false;
}

function useCastleWarsPortal(event) {
  const { player, object, clickType } = event;
  const location = object.getLocation();
  const id = object.getId();
  const inWaitingRoom = Object.values(data.TEAM_DATA).some((team) => team.waitingBounds.some((boundary) => boundary.inside(location)));
  let handled = false;
  if (data.LOBBY_BOUNDS.some((boundary) => boundary.inside(location))) {
    handled = handleLobbyObject(player, object, clickType);
  } else if (inWaitingRoom && data.WAITING_EXIT_IDS.has(id)) {
    game.returnToLobby(player);
    handled = true;
  } else if (game.inGameBounds(location) && data.GAME_EXIT_IDS.has(id)) {
    game.returnToLobby(player, "The Castle Wars game has ended for you.");
    handled = true;
  }
  if (handled) {
    event.handled = true;
  }
}

module.exports = function attachCastleWarsLobby(registry, castleWars) {
  api = registry;
  game = castleWars;
  core = registry.core;
  data = castleWars.data;
  registry.onObjectInteraction(useCastleWarsPortal);
  registry.onNpcInteraction("Lanthus", { Trade: ({ player }) => ShopManager.open(player, CASTLE_WARS_TICKET_EXCHANGE_SHOP) });
};

module.exports._test = { chooseTeam, seedsBots, SEED_BOTS_CONFIG_KEY, FOOD_ITEM_IDS };
