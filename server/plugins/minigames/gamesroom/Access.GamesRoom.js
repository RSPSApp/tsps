let api;
let core;
let rank;
const { GAMES } = require('./Games.GamesRoom');
const EXPERIENCED_RANK = 1500;

// Current Wiki: experienced rooms require 1500 in the corresponding game.
// The room rectangles and castle/basement endpoints are corroborated by the
// pinned LostCity stairs.rs2 and this project's transport data. The active cache
// confirms the stairs at both ends. Deterministic existing transport landings
// are used; historical randomized landing offsets are not live-capture evidence.
// https://oldschool.runescape.wiki/w/Burthorpe_Games_Room
// https://github.com/LostCityRS/Content/blob/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/ladders%2Bstairs/scripts/stairs.rs2
function at(object, x, y, z) {
  const location = object?.getLocation();
  return location && location.getX() === x && location.getY() === y && location.getZ() === z;
}

function named(object, name) {
  return object?.getId() === core.CacheDefinitions.getLocId(name);
}

function refuse(event, game, action) {
  if (rank(event.player, game) >= EXPERIENCED_RANK) return false;
  event.handled = true;
  const title = GAMES[game].title;
  event.player.getPacketSender().sendMessage(`You need a ${title} rank of at least 1500 to ${action}.`);
  return true;
}

function climb(event) {
  if (event.handled || !event.object || !event.player) return;
  const object = event.object;
  if (named(object, 'board_game_stairs_grey_all') && at(object, 2899, 3566, 0)) {
    event.handled = true;
    api.emitCustomEvent('ladders:climbDown', { player: event.player, destination: new core.Location(2205, 4933, 1) });
    return;
  }
  if (named(object, 'board_game_stairs_grey_base2') && at(object, 2205, 4935, 1)) {
    event.handled = true;
    api.emitCustomEvent('ladders:climbUp', { player: event.player, destination: new core.Location(2899, 3564, 0) });
    return;
  }
  if (named(object, 'boardgames_draughts_ladderup_experienced') && at(object, 2199, 4936, 0)) {
    refuse(event, 'draughts', 'climb this ladder');
  } else if (named(object, 'boardgames_runelink_ladderup_experienced') && at(object, 2216, 4936, 0)) {
    refuse(event, 'runelink', 'climb this ladder');
  } else if (named(object, 'boardgames_runeversi_ladderup_experienced') && at(object, 2231, 4951, 0)) {
    refuse(event, 'runeversi', 'climb this ladder');
  } else if (named(object, 'boardgames_runesquares_ladderup_experienced') && at(object, 2184, 4951, 0)) {
    refuse(event, 'runesquares', 'climb this ladder');
  }
}

function door(event) {
  if (event.handled || !event.object || !event.player) return;
  const object = event.object;
  // The west RuneSquares room opens east, rather than north like Draughts.
  if (named(object, 'boardgames_runesquares_door_experienced') && at(object, 2191, 4950, 1)) {
    if (event.player.getLocation().getX() > 2191) refuse(event, 'runesquares', 'pass through this door');
    return;
  }
  // Runeversi's experienced room opens to the west, unlike the south rooms.
  if (named(object, 'boardgames_runeversi_door_experienced') && at(object, 2224, 4950, 1)) {
    if (event.player.getLocation().getX() < 2224) refuse(event, 'runeversi', 'pass through this door');
    return;
  }
  // A player may always leave the experienced challenge room to its north.
  if (event.player.getLocation().getY() <= object.getLocation().getY()) return;
  if (named(object, 'boardgames_draughts_door_experienced') && at(object, 2198, 4943, 1)) {
    refuse(event, 'draughts', 'pass through this door');
  } else if (named(object, 'boardgames_runelink_door_experienced') && at(object, 2217, 4943, 1)) {
    refuse(event, 'runelink', 'pass through this door');
  }
}

function gameRoom(game, plane = 0) {
  // Active-cache east-room interior; deterministic return tile is not captured.
  if (game === 'runeversi' && [0, 1].includes(plane)) return new core.Location(2228, 4948, plane);
  // Actual cache room carpet; exact OSRS finish tile is not captured.
  if (game === 'runesquares' && [0, 1].includes(plane)) return new core.Location(2188, 4948, plane);
  if (!['draughts', 'runelink'].includes(game) || ![0, 1].includes(plane)) return null;
  return new core.Location(game === 'draughts' ? 2196 : 2219, 4940, plane);
}

function roomGame(location) {
  if (location && [0, 1].includes(location.getZ()) && location.getX() >= 2224 && location.getX() <= 2231
      && location.getY() >= 4944 && location.getY() <= 4951) return 'runeversi';
  if (location && [0, 1].includes(location.getZ()) && location.getX() >= 2184 && location.getX() <= 2191 &&
      location.getY() >= 4944 && location.getY() <= 4951) return 'runesquares';
  if (!location || ![0, 1].includes(location.getZ()) || location.getY() < 4936 || location.getY() > 4943) return null;
  if (location.getX() >= 2192 && location.getX() <= 2199) return 'draughts';
  if (location.getX() >= 2216 && location.getX() <= 2223) return 'runelink';
  return null;
}

function enforce(player) {
  const location = player.getLocation();
  if (location.getZ() !== 1) return false;
  const game = roomGame(location);
  if (!game || rank(player, game) >= EXPERIENCED_RANK) return false;
  player.getMovementQueue().reset();
  player.moveTo(game === 'runesquares' ? new core.Location(2192, 4950, 1)
    : game === 'runeversi' ? new core.Location(2223, 4950, 1)
    : new core.Location(game === 'draughts' ? 2198 : 2217, 4944, 1));
  player.getPacketSender().sendMessage(`You need a ${GAMES[game].title} rank of at least 1500 to enter this room.`);
  return true;
}

function attach(pluginApi, services) {
  api = pluginApi;
  core = api.core;
  rank = services.rank;
  api.onCustomEvent('ladders:climb', climb);
  api.onCustomEvent('door:toggle', door);
}

module.exports = { attach, gameRoom, roomGame, enforce };
