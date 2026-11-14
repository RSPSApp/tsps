/**
 * The Morytania boats between Burgh de Rott, Meiyerditch, the Icyene Graveyard and Slepe, once
 * Sins of the Father is complete, as rsprox 231/392 (ticks 5337-8060) and 239/4266 (tick 786)
 * play them (plugins/world/data/ferries.json "morytania", docs/morytania-boats.md):
 *
 * - Board on a dock's boat asks "Where would you like to go?" with the other three docks, always
 *   in the order Burgh de Rott, Meiyerditch, Icyene Graveyard, Slepe.
 * - The pick starts the dock's morytania-* fade route: fade out with an empty message box, song
 *   147 and jingle 137; the line "You board the boat and sail to <dock>." and the minimap off a
 *   tick later; the landing on the tenth tick; the fade back in on the twelfth.
 * - Meiyerditch's boat (sang_boat_edge_jump) is boarded from the rock beside it: on the pick's
 *   tick the player jumps onto the boat tile (human_steppingstonejump, sound 2461, 239/4266 tick
 *   788), and the trip starts on the second. Arrivals land on the boat; Jump-onto on the rock
 *   (sang_boat_jump_rock) jumps back with "You jump onto the rocky wall.".
 *
 * Before the quest is complete the docks stay with Darkness of Hallowvale's and Sins of the
 * Father's own crossings.
 */
const Common = require("./Common.Ferries");
const Voyages = require("./Voyages.Ferries");

/** ForceMovement directions (PlayerSession: 0 north, 1 east, 2 south, 3 west). */
const NORTH = 0;
const SOUTH = 2;

const settings = () => Common.data.morytania;
/** Players between a Meiyerditch pick and the trip (the jump onto the boat). */
const boarding = new WeakSet();

function sameTile(location, [x, y, z]) {
  return location.getX() === x && location.getY() === y && location.getZ() === z;
}

function dockFor(event) {
  const gameval = Common.locGameval(event.objectId);
  return settings().docks.find((dock) => dock.loc === gameval) ?? null;
}

/** The slide from the player's tile onto `to`, as live's exactmove: the move this tick, the glide over the given cycles. */
function jump(player, to, direction, { animationDelay, soundDelay, speeds }) {
  const { ForceMovement, Location, Animation, CacheDefinitions } = Common.core;
  const { animation, sound } = settings().jump;
  const from = player.getLocation().clone();
  const slide = new ForceMovement(from, new Location(to[0] - from.getX(), to[1] - from.getY()), speeds[0], speeds[1],
    direction, CacheDefinitions.getSeqId(animation));
  player.moveTo(new Location(to[0], to[1], to[2]));
  player.performAnimation(new Animation(CacheDefinitions.getSeqId(animation), animationDelay));
  player.setForceMovement(slide);
  player.getPacketSender().sendSoundEffect(sound, 1, soundDelay);
  Common.later(player, 1, () => {
    if (player.getForceMovement() === slide) player.setForceMovement(null);
  });
}

/** Meiyerditch: onto the boat first, unless the player is already on it, then the trip. */
function sail(player, dock, from) {
  if (Common.travelling(player) || boarding.has(player)) return;
  const departure = settings().jump;
  const { boat, depart } = departure;
  if (from.loc !== "sang_boat_edge_jump" || sameTile(player.getLocation(), boat)) {
    Voyages.travel(player, dock.route);
    return;
  }
  const movement = player.getMovementQueue();
  movement.reset();
  movement.setBlockMovement(true);
  boarding.add(player);
  jump(player, boat, SOUTH, departure);
  Common.later(player, depart, () => {
    boarding.delete(player);
    movement.setBlockMovement(false);
    Voyages.travel(player, dock.route);
  });
}

function board(event) {
  const { player } = event;
  if (!player) return;
  const label = event.definition?.getInteractions?.()?.[event.clickType - 1];
  if (label !== "Board") return;
  const from = dockFor(event);
  if (!from || !Common.passes(player, settings().gate)) return;
  event.handled = true;
  if (Common.travelling(player) || boarding.has(player)) return;
  const pairs = [];
  for (const dock of settings().docks) {
    if (dock === from) continue;
    pairs.push(dock.option, () => sail(player, dock, from));
  }
  Common.api.sendMultiChatboxPrompt(player, settings().title, ...pairs);
}

/** Jump-onto on the rock beside Meiyerditch's boat: from the boat tile back onto the rock. */
function jumpToRock(event) {
  const { player } = event;
  const rock = settings().rock;
  if (!player || Common.locGameval(event.objectId) !== rock.loc) return;
  // Already on the rock (rsprox 231/393 tick 298).
  if (sameTile(player.getLocation(), rock.to)) {
    event.handled = true;
    player.sendMessage(rock.standing);
    return;
  }
  if (!sameTile(player.getLocation(), rock.from)) return;
  event.handled = true;
  if (Common.travelling(player) || boarding.has(player)) return;
  player.getMovementQueue().reset();
  jump(player, rock.to, NORTH, rock);
  Common.later(player, rock.messageAt, () => player.sendMessage(rock.message));
}

/**
 * The boat and the rock are two tiles apart with no path between them: each is used from the
 * other's tile where the player stands (231/392 tick 7213 from the boat, 7216 from the rock).
 */
function route(event) {
  const { player } = event;
  if (!player) return;
  const gameval = Common.locGameval(event.objectId);
  const { boat } = settings().jump;
  const rock = settings().rock;
  const here = player.getLocation();
  const fromRock = gameval === "sang_boat_edge_jump" && sameTile(here, rock.to);
  const fromBoat = gameval === rock.loc && sameTile(here, boat);
  if (fromRock || fromBoat) event.destination = { x: here.getX(), y: here.getY(), z: here.getZ() };
}

function attach(api) {
  api.onObjectRoute(route);
  api.onObjectInteraction(board);
  api.onObjectInteraction(jumpToRock);
}

module.exports = { attach, board, jumpToRock, route };
