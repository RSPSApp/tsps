"use strict";

/**
 * Castle Wars lobby: the team portals (Guthix balances the teams), the lobby bank chest, and the
 * portals back out of the waiting rooms and the game. In development a real player joining seeds
 * bots so a game can start; production worlds leave that off (world.json pluginConfig
 * "CastleWars:seedBots").
 */

const FoodPlugin = require("../../items/Food.plugin");
const { createBotPlayer } = require("../../bots/behaviours/spawn/PlayerFactory.PlayerBots");
const { ATTR_SKIP_PERSISTENCE } = require("../../bots/runtime/PersistenceConstants.PlayerBots");
const { ShopManager } = require("../../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

const CASTLE_WARS_TICKET_EXCHANGE_SHOP = 1432;
const SEED_BOTS_CONFIG_KEY = "CastleWars:seedBots";
const BOT_ROLE_ATTRIBUTE = "castlewars:bot-role";
const BOT_TIER_ATTRIBUTE = "castlewars:bot-tier";
const PRACTICE_MAXED_ATTRIBUTE = "castlewars:practice-maxed";
const BOTS_PER_TEAM = 30;
// The lobby prompt's bot choices; the label is what the player clicks, the value the tier
// Bots.CastleWars pins each spawned bot's loadout and combat level band to.
const { TIER_OPTIONS: BOT_TIER_OPTIONS } = require("../../bots/behaviours/pvp/PvpTierLoadouts.PlayerBots");
// One entry per bot slot: attackers, flag runners, stand guards, one keeper per gate, two
// battlement archers, two battlement mages and one catapult crew, per team.
const BOT_ROLE_MIX = Object.freeze([
  ...Array(12).fill("attacker"),
  ...Array(6).fill("flag"),
  ...Array(5).fill("guard"),
  "doorman",
  "side-doorman",
  ...Array(2).fill("archer"),
  ...Array(2).fill("mage"),
  "catapult",
]);


let api;
let game;
let core;
let data;
let botSerial = 0;

function moveToWaitingRoom(player, teamId) {
  game.setTeamId(player, teamId);
  player.sendMessage(`You have been added to the ${game.getTeamData(teamId).name} team.`);
  if (player.isPlayerBot?.() === true) {
    // Straight into the room: a bot still walking when the countdown ends misses the start
    // move and then squats the waiting room for the whole match, blocking the next prompt.
    player.moveTo(game.getTeamData(teamId).waitingRoom);
    return;
  }
  player.smartMove(game.getTeamData(teamId).waitingRoom, 8);
}

function spawnCastleWarsBot(teamId, role = "attacker", username = `CWBot${++botSerial}`, tier = null, maxed = false) {
  const bot = createBotPlayer(username, data.LOBBY_TELEPORT, { api, loadPersistence: false, saveRandomizedAppearance: false });
  if (!bot) {
    return;
  }
  bot.setPlayerBot(true);
  bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  bot.setAttribute(game.BOT_KEY, true);
  bot.setAttribute(BOT_ROLE_ATTRIBUTE, role);
  if (tier) {
    bot.setAttribute(BOT_TIER_ATTRIBUTE, tier);
  }
  if (maxed) bot.setAttribute(PRACTICE_MAXED_ATTRIBUTE, true);
  api.emitPlayerLogin({ player: bot, username });
  moveToWaitingRoom(bot, teamId);
}

/** Stable names per team slot, so a repeated populate skips bots that are already in. */
function castleWarsBotUsername(teamId, index) {
  return `CWBot${teamId === data.TEAM.SARADOMIN ? "S" : "Z"}${index}`;
}

function populateCastleWarsBots(teamId, tier, maxed = false) {
  const opposingTeam = game.opposingTeam(teamId);
  const settings = game.settings ?? { teamSize: BOTS_PER_TEAM, opponent: "mixed" };
  if (settings.opponent === "none") return;
  const ownRole = settings.opponent === "scorer" ? "defender" : settings.opponent === "defender" ? "scorer" : null;
  for (let index = 0; index < settings.teamSize; index++) {
    const role = BOT_ROLE_MIX[index % BOT_ROLE_MIX.length];
    // The joining human occupies one slot in practice teams.
    if (index > 0) spawnCastleWarsBot(teamId, ownRole ?? role, castleWarsBotUsername(teamId, index), tier, maxed);
    spawnCastleWarsBot(opposingTeam, settings.opponent === "mixed" ? role : settings.opponent, castleWarsBotUsername(opposingTeam, index), tier, maxed);
  }
}

function seedCastleWarsBots(teamId) {
  const opposingTeam = game.opposingTeam(teamId);
  spawnCastleWarsBot(teamId, "attacker");
  spawnCastleWarsBot(opposingTeam, "guard");
  spawnCastleWarsBot(opposingTeam, "flag");
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

const MESBOX_CHAT = 115;
const ENTRY_REFUSED = "Some items are stopping you from entering the Castle Wars waiting area. See the chat for details.";

/**
 * One reason per attempt in chat, then a message box pointing at it (rsprox 3233, rev 232:
 * "You can't wear capes in the arena." is checked before non-combat items).
 */
function refuseEntry(player, reason) {
  player.sendMessage(reason);
  player.getPacketSender().sendTypedMessage(MESBOX_CHAT, ENTRY_REFUSED);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, ENTRY_REFUSED)));
}

function joinWaitingRoom(player, requestedTeam, botTier = undefined, portalGod = requestedTeam ?? "guthix", maxed = false) {
  const phase = game.getPhase();
  if (phase === game.PHASE.ACTIVE || phase === game.PHASE.ENDING) {
    player.sendMessage("There's already a Castle Wars game running. Please wait.");
    return;
  }
  if (player.getEquipment().getSlot(core.Equipment.CAPE_SLOT) > 0) {
    refuseEntry(player, "You can't wear capes in the arena.");
    return;
  }
  if (player.getInventory().getItems().some((item) => FoodPlugin.isFoodItem(item?.getId?.()))) {
    // RSPS-only wording; the capture only shows the cape and non-combat item refusals.
    refuseEntry(player, "You may not bring your own consumables inside Castle Wars.");
    return;
  }

  const counts = game.queueCounts();
  const teamId = chooseTeam(counts, requestedTeam);
  if (!teamId) {
    const team = game.getTeamData(requestedTeam).name;
    const other = game.getTeamData(game.opposingTeam(requestedTeam)).name;
    player.sendMessage(`The ${team} team is full, try ${other}.`);
    return;
  }
  if (counts[teamId] >= (game.settings?.teamSize ?? Infinity)) {
    player.sendMessage("That Castle Wars team is full.");
    return;
  }

  const isBot = player.isPlayerBot() === true;
  const lobbyEmpty = counts[data.TEAM.SARADOMIN] === 0 && counts[data.TEAM.ZAMORAK] === 0;
  // The empty-lobby prompt replaces the dev seeding path, and returning after it means the
  // config seeding below can never double up on bots. The chosen tier sets the spawned
  // bots' combat level band and gear; None leaves the game player-only.
  if (!isBot && lobbyEmpty && !seedsBots()) {
    if (botTier !== undefined) {
      if (botTier !== null) populateCastleWarsBots(teamId, botTier, maxed);
      game.prepareWaitingForm?.(player, portalGod);
      moveToWaitingRoom(player, teamId);
      return;
    }
    const options = BOT_TIER_OPTIONS.flatMap(([label, tier]) => [
      label,
      () => joinWaitingRoom(player, requestedTeam, tier, portalGod),
    ]);
    api.sendMultiChatboxPrompt(
      player,
      "The Castle Wars lobby is empty. Which bots should populate the game?",
      ...options,
      "None",
      () => joinWaitingRoom(player, requestedTeam, null, portalGod),
      "Practice settings (Lanthus)",
      () => require("./Settings.CastleWars").openSettings({ player, requestedTeam, portalGod })
    );
    return;
  }

  if (!isBot) game.prepareWaitingForm?.(player, portalGod);
  moveToWaitingRoom(player, teamId);
  if (!isBot && seedsBots()) {
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
  game.BOT_ROLE_KEY = BOT_ROLE_ATTRIBUTE;
  game.BOT_TIER_KEY = BOT_TIER_ATTRIBUTE;
  game.PRACTICE_MAXED_KEY = PRACTICE_MAXED_ATTRIBUTE;
  game.joinFromLobby = joinWaitingRoom;
  registry.onObjectInteraction(useCastleWarsPortal);
  registry.onNpcInteraction("Lanthus", { Trade: ({ player }) => ShopManager.open(player, CASTLE_WARS_TICKET_EXCHANGE_SHOP) });
};

module.exports._test = { chooseTeam, seedsBots, SEED_BOTS_CONFIG_KEY, BOT_TIER_OPTIONS };
