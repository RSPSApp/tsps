/**
 * Riding the Keldagrim minecarts (Wiki: Keldagrim_minecart_system; rsprox recordings, see
 * plugins/world/data/keldagrim-minecarts.json):
 * - Keldagrim Carts' station: Ride on the front cart of a track - Ice Mountain on track 1,
 *   White Wolf Mountain on track 4 (each needs its ticket, taken as the player boards), the
 *   Grand Exchange on track 3 (free). Any other cart: "You should take the cart at the front of
 *   the queue."; the wrong ticket: "You don't have an appropriate ticket for these carts."; the
 *   fourth row's tunnel is closed. The cart rolls out along its track, the screen fades, and the
 *   player is at the destination.
 * - Ice Mountain and White Wolf Mountain: Ride needs the ticket to Keldagrim ("You must purchase
 *   a ticket..."), taken as the screen fades.
 * - The Grand Exchange trapdoor: Inspect is the conductor's call up ("Would you like to ride our
 *   minecart to Keldagrim? It's free."); "Yes please." or Travel ride it.
 * - Into Keldagrim the screen comes back on the station's track, the cart rolls in, and the player
 *   steps off beside it.
 * Riding, the player is held still, sits in a cart (the riding stance) and the client shows no
 * weapon, shield or boots (the worn items are untouched). One ride at a time. Logging out mid-ride finishes it (the save is at the
 * destination); a death ends it where the player is, with nothing more taken.
 * Any ride needs The Giant Dwarf started (the Wiki).
 * The station's carts are not in the map: they are placed here.
 */
const Common = require("./Common.KeldagrimMinecarts");

const CART_SHAPE = 10;
/** ForceMovement directions 0-3 are compass indices (PlayerSession): a raw angle 0 is index 2. */
const ANGLE_ZERO_INDEX = 2;
const TRAPDOOR_YES = "Yes please.";
const TRAPDOOR_VARIANT = "inspecting-the-trapdoor-at-the-grand-exchange";
const TRAPDOOR_WAIT_TICKS = 10;
/** How far from the trapdoor a "Yes please." still rides. */
const TRAPDOOR_REACH = 2;

/** Players mid-ride -> their ride. */
const rides = new WeakMap();
/** Players asked by the trapdoor's conductor; they ride once the talk closes. */
const trapdoorAsked = new WeakSet();
/** A rider's tile after the last glide, taken up as the next one starts (or the ride lands). */
const glidingTo = new WeakMap();
let placedCarts = [];

function riding(player) {
  return rides.has(player);
}

function tile([x, y]) {
  return new Common.core.Location(x, y, 0);
}

function cartAt([x, y], id = Common.ids.locs.hubCart) {
  const { GameObject } = Common.core;
  return new GameObject(id, tile([x, y]), CART_SHAPE, 0, null);
}

function hasTicket(player, ticket) {
  return player.getInventory().contains(Common.ids.objs[ticket]);
}

function takeTicket(player, ticket) {
  if (!ticket) return true;
  if (!hasTicket(player, ticket)) return false;
  player.getInventory().delete(Common.ids.objs[ticket], 1);
  player.getInventory().refreshItems?.();
  return true;
}

/**
 * The worn weapon, shield and boots shown empty (or back), on the model and in the worn view, and the
 * cart (the feet identity kit) with the riding stance (human_minecart_anim on every stance slot) while
 * they are hidden.
 */
function hideWorn(player, hidden) {
  const equipment = player.getEquipment();
  player.setRenderAnimations?.(hidden ? Array(7).fill(Common.ids.seqs.ridingStance) : null);
  const { ridingKits } = Common.data;
  const male = player.getAppearance?.()?.isMale?.() !== false;
  player.setDisplayedKits?.(hidden ? { [Common.core.Appearance.FEET]: male ? ridingKits.male : ridingKits.female } : null);
  if (!hidden) {
    player.setDisplayedEquipment(null);
    equipment.sendWornInventory?.();
    return;
  }
  const slots = Common.data.wornHidden;
  player.setDisplayedEquipment(Object.fromEntries(slots.map((slot) => [slot, -1])));
  const items = equipment.getItems().map((item, slot) =>
    !slots.includes(slot) && item && item.getId() > 0 && item.getAmount() > 0 ? { id: item.getId(), amount: item.getAmount() } : null);
  player.getPacketSender().sendInventory(Common.core.Equipment.WORN_INVENTORY_ID, equipment.capacity(), items);
}

/**
 * One recorded step: the glide from `from` to `to` over its client cycles. The recordings put
 * the player on the step's tile as it starts; here, as the engine's forced movement expects
 * (MagicCarpets), the glide starts from the tile the player is on and they are put on the step's
 * tile as the next one starts - every recorded glide starts on the tile the one before left the
 * player on, so the client draws the same path.
 */
function glide(player, [, onto, [fromX, fromY, startCycle, toX, toY, endCycle, angle]]) {
  const { ForceMovement, Location } = Common.core;
  settle(player);
  player.setForceMovement(new ForceMovement(
    new Location(fromX, fromY, 0),
    new Location(toX - fromX, toY - fromY),
    startCycle,
    endCycle,
    angle === 0 ? ANGLE_ZERO_INDEX : angle,
    -1,
  ));
  glidingTo.set(player, onto);
}

/** The last glide over: on its tile. */
function settle(player) {
  const onto = glidingTo.get(player);
  if (!onto) return;
  glidingTo.delete(player);
  player.setForceMovement(null);
  player.moveTo(tile(onto));
}

/** Off the glide, wherever the ride puts the player instead. */
function place(player, at) {
  glidingTo.delete(player);
  player.setForceMovement(null);
  player.moveTo(tile(at));
}

/**
 * Plays `steps` (tick -> actions) on the player's ticks from now, the player held still. `land`
 * puts a rider who logs out where the ride ends; `cleanup` runs however it ends.
 */
function run(player, steps, { last, land, cleanup }) {
  const { Task, TaskManager } = Common.core;
  const movement = player.getMovementQueue?.();
  movement?.setBlockMovement?.(true);
  movement?.reset?.();
  const ride = { tick: 0, done: false };
  rides.set(player, ride);
  const finish = () => {
    if (ride.done) return;
    ride.done = true;
    rides.delete(player);
    glidingTo.delete(player);
    player.setForceMovement?.(null);
    hideWorn(player, false);
    movement?.setBlockMovement?.(false);
    cleanup?.();
  };
  ride.fastForward = () => {
    if (ride.done) return;
    land();
    finish();
  };
  ride.abort = () => {
    Common.closeFade(player);
    finish();
  };
  const play = (tick) => (steps.get(tick) ?? []).forEach((step) => step());
  play(0);
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }
    execute() {
      if (ride.done) return this.stop();
      if (player.isRegistered?.() === false) {
        ride.fastForward();
        return this.stop();
      }
      if (player.isDyingReturn?.() === true || player.getHitpoints?.() <= 0) {
        ride.abort();
        return this.stop();
      }
      ride.tick++;
      play(ride.tick);
      if (ride.tick >= last) {
        finish();
        this.stop();
      }
    }
  })());
  return ride;
}

function addStep(steps, tick, action) {
  if (!steps.has(tick)) steps.set(tick, []);
  steps.get(tick).push(action);
}

/** Into Keldagrim from an outstation or the trapdoor: from the fade to stepping off. */
function arrive(player, ticket = null) {
  if (riding(player)) return false;
  const { arrival } = Common.data;
  const steps = new Map();
  let taken = ticket === null;
  addStep(steps, 0, () => {
    taken = takeTicket(player, ticket) || taken;
    Common.fade(player, true);
  });
  addStep(steps, arrival.landTick, () => {
    player.moveTo(tile(arrival.land));
  });
  addStep(steps, arrival.blankTick, () => hideWorn(player, true));
  addStep(steps, arrival.fadeInTick, () => Common.fade(player, false));
  for (const step of arrival.steps) addStep(steps, step[0], () => glide(player, step));
  addStep(steps, arrival.offTick, () => {
    place(player, arrival.off);
    Common.closeFade(player);
    player.getPacketSender().sendObject?.(cartAt(arrival.unridable, Common.ids.locs.unridable));
  });
  run(player, steps, {
    last: arrival.offTick,
    land: () => {
      if (!taken) takeTicket(player, ticket);
      place(player, arrival.off);
    },
  });
  return true;
}

/** Out of the station on `track`, its ticket taken as the player boards. */
function depart(player, track) {
  if (riding(player)) return false;
  if (!takeTicket(player, track.ticket)) return false;
  const front = cartAt(track.front);
  const steps = new Map();
  let cartGone = false;
  const cartBack = () => {
    if (!cartGone) return;
    cartGone = false;
    player.getPacketSender().sendObject?.(front);
  };
  addStep(steps, 0, () => {
    player.moveTo(tile(track.front));
    hideWorn(player, true);
    player.getPacketSender().sendObjectRemoval?.(front);
    cartGone = true;
  });
  for (const step of track.steps) addStep(steps, step[0], () => glide(player, step));
  addStep(steps, track.fadeTick, () => Common.fade(player, true));
  addStep(steps, track.cartBackTick, cartBack);
  addStep(steps, track.landTick, () => {
    place(player, track.to);
    hideWorn(player, false);
  });
  addStep(steps, track.fadeInTick, () => Common.fade(player, false));
  addStep(steps, track.closeTick, () => Common.closeFade(player));
  run(player, steps, {
    last: track.closeTick,
    land: () => place(player, track.to),
    cleanup: cartBack,
  });
  return true;
}

function startedGiantDwarf(player) {
  if (Common.questStarted(player, "giant_dwarf")) return true;
  player.sendMessage(Common.data.messages.giantDwarf);
  return false;
}

/** Ride on a station cart: the track is the row clicked; only its front cart leaves. */
function rideHubCart(player, location) {
  const { messages, tracks } = Common.data;
  const track = tracks.find((entry) => entry.y === location.y);
  if (!track) return false;
  if (track.closed) {
    player.sendMessage(messages.closed);
    return true;
  }
  if (location.x !== track.front[0]) {
    Common.statement(player, messages.front);
    return true;
  }
  if (track.ticket && !hasTicket(player, track.ticket)) {
    Common.statement(player, messages.wrongTicket);
    return true;
  }
  if (!startedGiantDwarf(player)) return true;
  depart(player, track);
  return true;
}

function rideOutstation(player, outstation) {
  if (!hasTicket(player, outstation.ticket)) {
    Common.statement(player, Common.data.messages.noTicket);
    return;
  }
  if (!startedGiantDwarf(player)) return;
  arrive(player, outstation.ticket);
}

function rideCart({ player, objectId, location }) {
  if (riding(player)) return true;
  const { locs } = Common.ids;
  if (objectId === locs.hubCart) return rideHubCart(player, location ?? { x: -1, y: -1 });
  const outstation = Common.data.outstations.find((entry) => locs[entry.loc] === objectId);
  if (!outstation) return false;
  rideOutstation(player, outstation);
  return true;
}

/** Inspect: the conductor below calls up (his transcript's trapdoor variant). */
function inspectTrapdoor({ player, objectId }) {
  if (objectId !== Common.ids.locs.trapdoor) return false;
  if (riding(player)) return true;
  const start = { player, npcId: Common.ids.npcs.trapdoor, variant: TRAPDOOR_VARIANT, exact: true, handled: false };
  trapdoorAsked.add(player);
  Common.api.emitCustomEvent("npc-dialogue:start", start);
  if (!start.handled) trapdoorAsked.delete(player);
  return true;
}

function travelTrapdoor({ player, objectId }) {
  if (objectId !== Common.ids.locs.trapdoor) return false;
  if (riding(player)) return true;
  if (startedGiantDwarf(player)) arrive(player);
  return true;
}

/** The trapdoor's conductor's question answered: "Yes please." rides as the talk closes. */
function onChoice({ player, npcId, option }) {
  if (npcId !== Common.ids.npcs.trapdoor || !trapdoorAsked.has(player)) return;
  trapdoorAsked.delete(player);
  if (option !== TRAPDOOR_YES || !startedGiantDwarf(player)) return;
  waitForTalk(player, TRAPDOOR_WAIT_TICKS);
}

function byTrapdoor(player) {
  const [x, y] = Common.data.trapdoor;
  const at = player.getLocation();
  return at.getZ() === 0 && Math.abs(at.getX() - x) <= TRAPDOOR_REACH && Math.abs(at.getY() - y) <= TRAPDOOR_REACH;
}

/** The player's own line still showing: the ride waits for it, by the trapdoor, a few ticks at most. */
function waitForTalk(player, left) {
  Common.later(1, () => {
    if (player.isRegistered?.() === false || riding(player) || !byTrapdoor(player)) return;
    const talking = player.getDialogueManager?.()?.getCurrent?.() != null;
    if (!talking) arrive(player);
    else if (left > 0) waitForTalk(player, left - 1);
  });
}

/** The station's carts, for everyone (the map has none). */
function placeCarts() {
  const { ObjectManager } = Common.core;
  placedCarts = Common.data.hubCarts.map((at) => cartAt(at));
  for (const cart of placedCarts) ObjectManager.register(cart, true);
}

function logout({ player }) {
  trapdoorAsked.delete(player);
  rides.get(player)?.fastForward();
}

function attach(api) {
  api.onServerStartup(placeCarts);
  api.onObjectInteraction("Train cart", { Ride: rideCart });
  api.onObjectInteraction("Trapdoor", { Inspect: inspectTrapdoor, Travel: travelTrapdoor });
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onPlayerLogout(logout);
}

module.exports = {
  attach, rideCart, inspectTrapdoor, travelTrapdoor, onChoice, arrive, depart, riding, placeCarts, logout, hideWorn,
  get placedCarts() { return placedCarts; },
};
