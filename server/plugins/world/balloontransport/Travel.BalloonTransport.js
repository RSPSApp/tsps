/**
 * Flying the balloons after Enlightened Journey (Wiki: Balloon_transport_system; the
 * assistants' transcripts):
 * - Fly on Auguste or an assistant, Use on a station's basket, or "Yes." to an assistant's
 *   "Do you want to use the balloon?" opens the balloon map (zep_balloon_map);
 * - a trip to an opened station costs one log of its type ("You need 1 [type] logs to make this
 *   trip.") and needs its Firemaking level; to Entrana the player is searched first, and no
 *   weapons or armour may be worn;
 * - from Entrana a station not yet opened is opened by flying the balloon controls there with
 *   10 of its logs (3 magic), for 2,000 Firemaking XP (Controls.BalloonTransport.js; rsprox
 *   226/01702 boards with "You board the balloon."); from anywhere else it is refused;
 * - no more than 40kg carried, the log aside, and no pet out (the quest's lines);
 * - the flight as recorded (rsprox 3225, rev 232; balloon-transport.json `flight`): the jingle,
 *   the map again with the balloon flying the route, the teleport to the recorded landing tile
 *   with "You board the balloon and fly to [place].", then the fade; the player held still; one
 *   at a time; a logout mid-flight lands them, a death ends it where they are. The same station
 *   is "You're already there!".
 * Opened routes are saved, and their baskets and assistants shown from the zep_multi_* varbits.
 * A trip's logs may come from the log storage (Storage.BalloonTransport.js) instead.
 */
const Common = require("./Common.BalloonTransport");
const Storage = require("./Storage.BalloonTransport");
const Controls = require("./Controls.BalloonTransport");

const OPEN_MAP_TARGET = "Balloon transport system";
const BALLOONISTS = ["Auguste", "Assistant Stan", "Assistant Brock", "Assistant Serf", "Assistant Marrow", "Assistant Le Smith", "Assistant Lori"];
const BASKET = "Basket";
const ENTRANA = "entrana";
const WORN_CONTRABAND = ["HEAD_SLOT", "WEAPON_SLOT", "BODY_SLOT", "SHIELD_SLOT", "LEG_SLOT"];
const GRAMS_PER_KG = 1000;
/** The Pets plugin's follower, readable by other plugins. */
const PET_ATTRIBUTE = "pets:current";

/** Players with the map open -> { from, npcId }. */
const openMaps = new WeakMap();
/** Players mid-flight -> their flight. */
const flights = new WeakMap();
/** Arrival payloads created only by a passenger flight that completed its landing. */
const passengerArrivals = new WeakSet();

function flying(player) {
  return flights.has(player) || Controls.inFlight(player);
}

function isPassengerArrival(event) {
  return passengerArrivals.has(event);
}

function say(player, npcId, text, then = null) {
  const { DialogueChainBuilder, NpcDialogue, StatementDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder();
  chain.add(npcId ? new NpcDialogue(0, npcId, text) : new StatementDialogue(0, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function fill(text, values) {
  return text.replace(/\[(\w+)\]/g, (whole, key) => (values[key] !== undefined ? String(values[key]) : whole));
}

function firemaking(player) {
  return player.getSkillManager().getMaxLevel(Common.core.Skill.FIREMAKING);
}

/** Carried and worn weight in kg, one log of the fare aside. */
function weightKg(player, station) {
  let grams = 0;
  for (const item of [...player.getInventory().getItems(), ...player.getEquipment().getItems()]) {
    if (!item || item.getId() <= 0 || item.getAmount() <= 0) continue;
    grams += (Number(item.getDefinition().getWeight()) || 0) * (item.getDefinition().isStackable?.() ? 1 : item.getAmount());
  }
  const log = Common.core.ItemDefinition.forId(Common.ids.objs[station.log]);
  grams -= Number(log?.getWeight?.()) || 0;
  return grams / GRAMS_PER_KG;
}

function hasPet(player) {
  return player.getAttribute?.(PET_ATTRIBUTE)?.isRegistered?.() === true;
}

function wearsContraband(player) {
  const { Equipment } = Common.core;
  const equipment = player.getEquipment();
  return WORN_CONTRABAND.some((slot) => (equipment.get(Equipment[slot])?.getId?.() ?? -1) > 0);
}

/** The balloon map, from the station the player is at - one that is open to them. */
function openMap(player, from, npcId = null) {
  if (flying(player) || !Common.questComplete(player) || !from || !Common.opened(player, from)) return false;
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendInterface(Common.ids.map);
  openMaps.set(player, { from, npcId });
  return true;
}

/** Fly on Auguste or an assistant (the speaker is the NPC as the player sees it). */
function flyNpc({ player, npc, npcId }) {
  if (!Common.questComplete(player)) return false;
  return openMap(player, Common.stationAt(npc?.getLocation?.() ?? player.getLocation()), npcId ?? npc?.getId?.() ?? null);
}

/** Use on a station's basket: travel at once (the 2018 change), not the assistant's talk. */
function useBasket({ player, location }) {
  if (!Common.questComplete(player)) return false;
  const at = location ? Common.tile([location.x, location.y]) : player.getLocation();
  const station = Common.stationAt(at);
  if (!station) return false;
  return openMap(player, station);
}

/** "(open_interface Balloon transport system)" in an assistant's talk. */
function onAction(event) {
  if (event.action !== "open_interface" || event.target !== OPEN_MAP_TARGET) return;
  event.handled = true;
  event.end = true;
  const { player, npc, npcId } = event;
  // The conversation closes its window as it ends; the map opens on the next tick.
  Common.later(1, () => openMap(player, Common.stationAt(npc?.getLocation?.() ?? player.getLocation()), npcId ?? null));
}

function chooseDestination(event) {
  if (event.groupId !== Common.ids.map) return;
  const pending = openMaps.get(event.player);
  const to = Common.ids.buttons.get(event.childId);
  if (!pending || !to) return;
  event.handled = true;
  openMaps.delete(event.player);
  event.player.getPacketSender().sendInterfaceRemoval();
  travel(event.player, pending.from, to, pending.npcId);
}

/** The checks for a trip, then the flight (opening the route first from Entrana). */
function travel(player, from, to, npcId = null) {
  if (flying(player) || !from) return false;
  const { messages, unlockXp } = Common.data;
  if (from.key === to.key) {
    say(player, null, messages.alreadyThere);
    return false;
  }
  const opening = !Common.opened(player, to);
  if (opening && from.key !== ENTRANA) {
    say(player, npcId, messages.locked);
    return false;
  }
  if (firemaking(player) < to.level) {
    say(player, npcId, fill(messages.level, { level: to.level }));
    return false;
  }
  const cost = opening ? to.unlockLogs : 1;
  if (!Storage.canPay(player, to, cost)) {
    const type = to.logName ?? "normal";
    say(player, npcId, opening ? fill(messages.unlockLogs, { count: cost, type }) : fill(messages.needLog, { type }));
    return false;
  }
  const refusal = () => {
    if (!Storage.canPay(player, to, cost)) return opening ? fill(messages.unlockLogs, { count: cost, type: to.logName ?? "normal" }) : fill(messages.needLog, { type: to.logName ?? "normal" });
    if (hasPet(player)) return messages.pet;
    if (weightKg(player, to) > Common.data.maxWeightKg) return messages.weight;
    return null;
  };
  const before = refusal();
  if (before) {
    say(player, npcId, before);
    return false;
  }
  const arrived = opening ? () => {
    Common.openRoute(player, to);
    player.getSkillManager().addExperience(Common.core.Skill.FIREMAKING, unlockXp, false);
    player.sendMessage(fill(messages.unlocked, { place: to.label }));
  } : null;
  // The logs' source may be asked for: the trip is checked again once it's chosen, and the
  // player must still be at the station they started from.
  const startedAt = Common.stationAt(player.getLocation());
  // Opening a route flies the balloon controls where its screens are known.
  const controls = opening && Controls.hasRoute(to);
  const go = () => Storage.chooseSource(player, to, cost, (source) => {
    if (Common.stationAt(player.getLocation()) !== startedAt) return;
    const after = refusal();
    if (after) return say(player, npcId, after);
    const started = controls ? Controls.takeOff(player, to, cost, source) : fly(player, to, cost, arrived, source);
    if (!started && !flying(player)) say(player, npcId, refusal() ?? fill(messages.needLog, { type: to.logName ?? "normal" }));
  });
  if (controls) return say(player, null, messages.boardControls, go);
  if (to.key !== ENTRANA) return go();
  // Entrana: searched first (the assistants' transcript); the trip is checked again after it.
  say(player, npcId, messages.entranaSearch, () => {
    player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, messages.searched);
    if (wearsContraband(player)) return say(player, npcId, messages.entranaRefused);
    const after = refusal();
    if (after) return say(player, npcId, after);
    go();
  });
  return true;
}

/** The map again, flying the route: markers hidden, the balloon playing its journey (recorded). */
function showJourney(player, from, to) {
  const { flight } = Common.data;
  const { ids } = Common;
  const sender = player.getPacketSender();
  sender.sendInterface(ids.map);
  sender.sendInterfaceDisplayState(ids.closeButton, true);
  for (const marker of ids.markers) sender.sendInterfaceRawModel(marker, flight.markerModel);
  sender.sendInterfaceRawModel(ids.balloon, flight.balloonModel);
  const journey = from ? ids.journeys.get(`${from.key}>${to.key}`) : undefined;
  if (journey !== undefined) sender.sendInterfaceAnimation(ids.balloon, journey);
  sender.sendSong(flight.song);
}

/**
 * The flight (balloon-transport.json `flight`): the logs taken from the inventory or the log
 * storage, the jingle, the fade overlay and the map flying the route at once; the teleport at
 * `teleportAt`; the map closed and the fade run at `closeAt`; the overlay gone at
 * `overlayCloseAt`. `arrived` runs as they land (a route opened).
 */
function fly(player, to, logs, arrived = null, source = Storage.INVENTORY) {
  if (flying(player)) return false;
  const { flight: timing, messages } = Common.data;
  const movement = player.getMovementQueue?.();
  const originStation = Common.stationAt(player.getLocation());
  if (!originStation) return false;
  const origin = {
    station: originStation.key,
    isPublic: typeof player.getPrivateArea === "function" && player.getPrivateArea() === null,
  };
  if (!Storage.pay(player, to, logs, source)) return false;
  const from = player.getLocation();
  const departed = { x: from.getX(), y: from.getY(), z: from.getZ() };
  movement?.setBlockMovement?.(true);
  movement?.reset?.();
  player.getPacketSender().sendJingle(timing.jingle, timing.jingleLength);
  Storage.tellPaid(player, to, source);
  Common.fade(player, timing.fadeStart);
  showJourney(player, originStation, to);
  const flight = { done: false };
  flights.set(player, flight);
  const finish = () => {
    if (flight.done) return;
    flight.done = true;
    flights.delete(player);
    movement?.setBlockMovement?.(false);
  };
  const validFlight = () => {
    const at = player.getLocation();
    const moved = at.getX() !== departed.x || at.getY() !== departed.y || at.getZ() !== departed.z;
    return player.isDyingReturn?.() !== true && player.getHitpoints?.() > 0 && !moved
      && !(to.key === ENTRANA && wearsContraband(player));
  };
  flight.land = (logout = false) => {
    if (flight.done) return;
    if (!validFlight()) return flight.abort();
    player.moveTo(Common.tile(to.land));
    player.sendMessage(fill(messages.boarded, { place: to.place }));
    arrived?.();
    finish();
    const event = { player, station: to.key, origin, opensRoute: false, logout };
    passengerArrivals.add(event);
    Common.api.emitCustomEvent("balloon-transport:passenger-arrival", event);
  };
  /** No flight after all: the logs back, the player where they are. */
  flight.abort = () => {
    if (flight.done) return;
    Storage.refund(player, to, logs, source);
    player.getPacketSender().sendInterfaceRemoval();
    Common.closeFade(player);
    finish();
  };
  Common.later(timing.teleportAt, () => {
    if (flight.done) return;
    if (!validFlight()) return flight.abort();
    flight.land();
    // The map and fade belong to this flight: a newer one, or something the player opened since
    // landing, is left alone.
    Common.later(timing.closeAt - timing.teleportAt, () => {
      if (flying(player) || !player.isRegistered?.()) return;
      if (player.getInterfaceId?.() === Common.ids.map) player.getPacketSender().sendInterfaceRemoval();
      Common.fade(player, timing.fadeEnd);
      Common.later(timing.overlayCloseAt - timing.closeAt, () => {
        if (!flying(player)) Common.closeFade(player);
      });
    });
  });
  return true;
}

/** Logging out mid-flight lands the player (the save is at the destination). */
function logout({ player }) {
  openMaps.delete(player);
  flights.get(player)?.land(true);
}

function login({ player }) {
  Common.sendRoutes(player);
}

/** Any close of the map: its pick is gone. */
function mapClosed({ player, interfaceId }) {
  if (interfaceId === Common.ids.map) openMaps.delete(player);
}

function attach(api) {
  api.persistAttribute(Common.ROUTES_ATTRIBUTE, 0);
  api.onNpcsInteraction(BALLOONISTS, { Fly: flyNpc });
  api.onObjectInteraction(BASKET, { Use: useBasket });
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onInterfaceActionClick(chooseDestination);
  api.onCustomEvent("interface:closed", mapClosed);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
}

module.exports = {
  attach, openMap, flyNpc, useBasket, onAction, chooseDestination, travel, fly, logout, login, flying, weightKg, isPassengerArrival,
};
