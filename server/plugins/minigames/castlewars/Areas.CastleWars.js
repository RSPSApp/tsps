"use strict";

/**
 * Castle Wars areas - the lobby, the two waiting rooms and the game itself - and the rules that
 * hold inside them: team colours stay on, no friendly fire, no teleporting out, deaths respawn
 * in the team's start room, and anyone logging in inside is sent back to the lobby stripped of
 * game items.
 */

let game;
let core;
let data;

function playerOf(character) {
  return character.getAsPlayer?.() ?? null;
}

function defineAreas() {
  class CastleWarsLobbyArea extends core.Area {
    constructor() {
      super(data.LOBBY_BOUNDS);
    }

    getName() {
      return "Castle Wars Lobby";
    }
  }

  class CastleWarsWaitingArea extends core.Area {
    constructor(teamId) {
      super(game.getTeamData(teamId).waitingBounds);
      this.teamId = teamId;
    }

    getName() {
      return `${game.getTeamData(this.teamId).name} waiting room`;
    }

    postEnter(character) {
      const player = playerOf(character);
      if (!player) {
        return;
      }
      if (player.isPlayerBot?.() === true && game.releaseSeededBots()) {
        return;
      }
      game.setTeamId(player, this.teamId);
      game.equipTeamColours(player, this.teamId);
      player.getPacketSender().sendSubInterface(data.OVERLAY_HUD_UID, data.WAITING_ROOM_INTERFACE, 1);
      game.beginStartCountdown();
      const secondsLeft = game.startSecondsLeft();
      player.sendMessage(secondsLeft > 0 ? `Next game begins in ${secondsLeft} seconds.` : "Waiting for players to join the other team.");
    }

    postLeave(character, logout) {
      const player = playerOf(character);
      if (!player) {
        return;
      }
      if (logout) {
        if (player.getAttribute(game.BOT_KEY) === true) {
          return;
        }
        game.returnToLobby(player);
      }
      if (player.getAttribute(game.TRANSITION_KEY) === true) {
        return;
      }
      game.clearCastleWarsItems(player);
      player.resetAttributes();
      game.setTeamId(player, null);
      game.closeOverlay(player);
      if (player.isPlayerBot?.() !== true) {
        game.releaseSeededBots();
      }
      game.checkStartCountdown();
    }

    process(character) {
      const player = playerOf(character);
      if (player) {
        game.setVar(player, data.TIMER_VARP, game.startSecondsLeft());
      }
    }
  }

  class CastleWarsGameArea extends core.Area {
    constructor() {
      super(data.GAME_BOUNDS);
    }

    getName() {
      return "Castle Wars";
    }

    postEnter(character) {
      const player = playerOf(character);
      if (!player) {
        return;
      }
      if (game.getPhase() !== game.PHASE.ACTIVE || !game.getTeamId(player)) {
        game.returnToLobby(player);
        return;
      }
      player.setAttribute(game.TRANSITION_KEY, false);
      player.getPacketSender().sendSubInterface(data.OVERLAY_HUD_UID, data.STATUS_OVERLAY_INTERFACE[game.getTeamId(player)], 1);
      player.getPacketSender().sendPlayerOption(data.ATTACK_OPTION_SLOT, "Attack", true);
    }

    postLeave(character, logout) {
      const player = playerOf(character);
      if (!player) {
        return;
      }
      player.getPacketSender().sendPlayerOption(data.ATTACK_OPTION_SLOT, "", false);
      game.closeOverlay(player);
      player.getPacketSender().sendEntityHintRemoval(true);
      game.clearCastleWarsItems(player);
      game.clearBraceletEffect(player);
      if (logout) {
        game.returnToLobby(player);
      }
      game.setTeamId(player, null);
      if (player.isPlayerBot?.() !== true) {
        game.releaseSeededBots();
      }
      game.checkTeamsRemain();
    }

    process(character) {
      const player = playerOf(character);
      const teamId = player ? game.getTeamId(player) : null;
      if (!teamId) {
        return;
      }
      sendGameVars(player, teamId);
      ejectIdlersFromSpawn(player, teamId);
      for (const processor of game.inGameProcessors) {
        processor(player);
      }
    }

    canAttack(attacker, target) {
      return friendlyFireVerdict(attacker, target);
    }

    canTeleport(player) {
      player.sendMessage("You can't leave just like that!");
      return false;
    }
  }

  const { SARADOMIN, ZAMORAK } = data.TEAM;
  return {
    lobbyArea: new CastleWarsLobbyArea(),
    waitingAreas: { [SARADOMIN]: new CastleWarsWaitingArea(SARADOMIN), [ZAMORAK]: new CastleWarsWaitingArea(ZAMORAK) },
    gameArea: new CastleWarsGameArea(),
  };
}

function sendGameVars(player, teamId) {
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  for (const team of [SARADOMIN, ZAMORAK]) {
    game.setVar(player, data.SCORE_VARBIT[team], game.score[team], true);
    game.setVar(player, data.FLAG_VARBIT[team], game.flagStatus[team], true);
  }
  for (const varbit of Object.values(data.TEAM_VARBIT)) {
    game.setVar(player, varbit, game.getTeamVar(teamId, varbit), true);
  }
  game.setVar(player, data.TIMER_VARP, game.gameMinutesLeft());
}

function formatTicks(ticks) {
  const totalSeconds = Math.max(0, Math.floor((ticks | 0) * 0.6));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ejectIdlersFromSpawn(player, teamId) {
  const inSpawn = game.getTeamData(teamId).respawnBounds.inside(player.getLocation());
  let idleTicks = player.getAttribute(game.IDLE_TICKS_KEY) | 0;
  player.getPacketSender().sendString(
    inSpawn ? `You have ${formatTicks(idleTicks)} to leave the respawn room.` : "",
    data.EJECT_TEXT_UID[teamId]
  );
  if (!inSpawn || player.isPlayerBot?.() === true) {
    return;
  }
  if (idleTicks > 0) {
    player.setAttribute(game.IDLE_TICKS_KEY, --idleTicks);
  }
  if (idleTicks <= 0) {
    player.sendMessage("You idled too long in the respawn room.");
    game.returnToLobby(player);
  }
}

function registerAreas(api) {
  const areas = defineAreas();
  Object.assign(game, areas, {
    castleWarsAreas: new Set([areas.gameArea, ...Object.values(areas.waitingAreas)]),
    // Per-tick work for players in the game, added by the other unit files; the game area
    // runs it, so nobody outside Castle Wars pays for it.
    inGameProcessors: [],
  });
  for (const area of [areas.lobbyArea, ...Object.values(areas.waitingAreas), areas.gameArea]) {
    api.registerArea(area);
  }
}

function setUpCastle() {
  for (const [id, [x, y, z], face] of data.ALTAR_SPAWNS) {
    core.ObjectManager.register(new core.GameObject(id, new core.Location(x, y, z), 10, face, null), true);
  }
  game.resetMatchState();
}

function restoreLoginInsideCastleWars({ player }) {
  const location = player.getLocation();
  if (![...game.castleWarsAreas].some((area) => game.AreaManager.inside(location, area))) {
    return;
  }
  game.clearCastleWarsItems(player);
  game.setTeamId(player, null);
  game.returnToLobby(player);
}

function protectTeamColours(event) {
  if (!game.castleWarsAreas.has(event.player?.getArea?.()) || !data.TEAM_COLOUR_SLOTS.has(event.slot)) {
    return;
  }
  event.player.sendMessage("You can't remove your team's colours.");
  event.allow = false;
}

/** Inside the game only the other team is fair game; null leaves anyone else to other rules. */
function friendlyFireVerdict(attackerMobile, targetMobile) {
  const attacker = attackerMobile?.getAsPlayer?.();
  const target = targetMobile?.getAsPlayer?.();
  if (attacker?.getArea?.() !== game.gameArea || target?.getArea?.() !== game.gameArea) {
    return null;
  }
  if (game.getTeamId(attacker) === game.getTeamId(target)) {
    attacker.sendMessage("You can't attack your own team in Castle Wars.");
    return false;
  }
  return true;
}

function respawnInStartRoom(event) {
  const { player } = event;
  const teamId = player?.getArea?.() === game.gameArea ? game.getTeamId(player) : null;
  if (!teamId) {
    return;
  }
  game.dropCarriedFlag(player);
  game.resetIdleTicks(player);
  player.smartMoves(game.getTeamData(teamId).respawnBounds);
  event.handled = true;
}

/** Game items vanish on death instead of dropping; a carried banner falls as the flag. */
function keepGameItemsOffTheFloor(event) {
  const player = event?.player;
  const itemId = event?.item?.getId?.();
  if (!player || !itemId || !game.castleWarsAreas.has(player.getArea()) || !data.DEATH_REMOVE_ITEM_IDS.has(itemId)) {
    return;
  }
  const { SARADOMIN_BANNER, ZAMORAK_BANNER } = core.ItemIdentifiers;
  if (itemId === SARADOMIN_BANNER || itemId === ZAMORAK_BANNER) {
    game.dropCarriedFlag(player);
  }
  event.handled = true;
}

module.exports = function attachCastleWarsAreas(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  registerAreas(api);
  api.onServerStartup(setUpCastle);
  api.onPlayerLogin(restoreLoginInsideCastleWars);
  api.onCanEquip(protectTeamColours);
  api.onCanUnequip(protectTeamColours);
  api.onPlayerDeath(respawnInStartRoom);
  api.onPlayerDeathItemDrop(keepGameItemsOffTheFloor);
};
