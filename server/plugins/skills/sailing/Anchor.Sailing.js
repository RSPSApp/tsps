// A boat's anchor at sea (docs/sailing.md):
// - Drop: the player turns to it, "You drop the anchor, bringing the boat to a stop.", the drop
//   animation on the player and the anchor, and 4 ticks later the lowered anchor. Dropped from the
//   helm, the helmsman lets go of it first (Helm.Sailing.js), so the sails come down.
// - Raise: the player turns to it, "You raise the anchor, allowing the boat to move.", the pull
//   animations, and 3 ticks later the raised anchor.
// - Clicked again before its loc has changed: "That anchor is already in use!" a tick later.
// - While it's down the boat doesn't move, whatever the sails. 10 ticks after the sails are set,
//   once a login: "Trying to move the boat? Don't forget to weigh anchor!" and
//   sailing_boat_anchor_reminder 1.
// The anchor stays down with the boat. Ours: once a login for the reminder, and the 3x8 anchor's
// drop playing the 2x5's player animation, as the cache has no large one.
const { animateDeckLoc, later, setVarbit } = require("./SailingContent.Sailing");
const { ANCHOR_LOWERED } = require("./BoatFacilities.Sailing");

/** Each anchor's raised and lowered locs and its animations (cache seq names). */
const ANCHORS = [
  { raised: 59687, lowered: ANCHOR_LOWERED[59687], playerDrop: 13310, playerPull: 13318, drop: 13311, pull: 13312 },
  { raised: 59689, lowered: ANCHOR_LOWERED[59689], playerDrop: 13310, playerPull: 13317, drop: 13315, pull: 13316 },
];
/** The speed limit that holds an anchored boat (Boat.speedLimits). */
const ANCHOR_LIMIT = "anchor";
const LOC_SHAPE = 10;
const LOWERED_TICKS = 4;
const RAISED_TICKS = 3;
const IN_USE_TICKS = 1;
const REMINDER_TICKS = 10;
const VARBIT_REMINDER = 19119;
const REMINDED_ATTRIBUTE = "sailing:anchor-reminded";

const DROPPED = "You drop the anchor, bringing the boat to a stop.";
const RAISED = "You raise the anchor, allowing the boat to move.";
const IN_USE = "That anchor is already in use!";
const REMINDER = "Trying to move the boat? Don't forget to weigh anchor!";

let pluginApi = null;
/** Boats whose anchor is being dropped or raised: their loc hasn't changed yet. */
const swapping = new WeakSet();

function core() {
  return pluginApi.core;
}

function anchorKind(id) {
  return ANCHORS.find((anchor) => anchor.raised === id || anchor.lowered === id);
}

/** The player's own boat they're aboard and its saved state, or undefined. */
function ownBoat(player) {
  const boat = core().Sailing.instanceAboard(player);
  const owned = boat && core().Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** The anchor's deck loc at a clicked tile. */
function deckAnchor(boat, location) {
  const x = location.x - boat.deckBaseX;
  const y = location.y - boat.deckBaseY;
  return core().BoatManager.getSpec(boat)?.locs.find((loc) => loc.x === x && loc.y === y && loc.shape === LOC_SHAPE && anchorKind(loc.id));
}

/** Holds the boat still while the anchor is down, and lets it go once it's up. */
function holdBoat(boat, down) {
  if (down) {
    boat.speedLimits.set(ANCHOR_LIMIT, 0);
    boat.velocity = 0;
  } else {
    boat.speedLimits.delete(ANCHOR_LIMIT);
  }
}

/** Swaps the anchor's loc once its animation is done, if the player is still aboard. */
function swapLoc(player, boat, loc, id, ticks) {
  swapping.add(boat);
  later(player, ticks, () => {
    swapping.delete(boat);
    if (core().Sailing.instanceAboard(player) !== boat) return;
    const current = core().BoatManager.getSpec(boat)?.locs.find((candidate) => candidate.x === loc.x && candidate.y === loc.y && candidate.shape === loc.shape);
    if (current && anchorKind(current.id)) core().BoatManager.setDeckLoc(boat, { ...current, id });
  });
}

/**
 * The clicked anchor on the player's own boat, turning the player to it; or undefined (not
 * theirs), or null once it has said the anchor is in use.
 */
function clickedAnchor(event, down) {
  const aboard = ownBoat(event.player);
  const loc = aboard && deckAnchor(aboard.boat, event.location);
  if (!loc) return undefined;
  event.player.setPositionToFace?.(new (core().Location)(event.location.x, event.location.y, event.location.z));
  if (swapping.has(aboard.boat) || aboard.owned.anchorDown === down) {
    later(event.player, IN_USE_TICKS, () => event.player.sendMessage(IN_USE));
    return null;
  }
  return { aboard, loc, kind: anchorKind(loc.id) };
}

function dropAnchor(event) {
  const clicked = clickedAnchor(event, true);
  if (clicked === undefined) return false;
  if (!clicked) return;
  const { player } = event;
  const { aboard, loc, kind } = clicked;
  aboard.owned.anchorDown = true;
  holdBoat(aboard.boat, true);
  player.sendMessage(DROPPED);
  player.performAnimation(new (core().Animation)(kind.playerDrop));
  animateDeckLoc(player, aboard.boat, loc, kind.drop);
  swapLoc(player, aboard.boat, loc, kind.lowered, LOWERED_TICKS);
}

function raiseAnchor(event) {
  const clicked = clickedAnchor(event, false);
  if (clicked === undefined) return false;
  if (!clicked) return;
  const { player } = event;
  const { aboard, loc, kind } = clicked;
  aboard.owned.anchorDown = false;
  holdBoat(aboard.boat, false);
  player.sendMessage(RAISED);
  player.performAnimation(new (core().Animation)(kind.playerPull));
  animateDeckLoc(player, aboard.boat, loc, kind.pull);
  swapLoc(player, aboard.boat, loc, kind.raised, RAISED_TICKS);
}

/** Setting sail with the anchor down: once a login, the reminder 10 ticks later. */
function remindToWeigh({ player, boat, mode }) {
  if (mode === "stop" || player.getAttribute?.(REMINDED_ATTRIBUTE)) return;
  const aboard = ownBoat(player);
  if (!aboard || aboard.boat !== boat || !aboard.owned.anchorDown) return;
  later(player, REMINDER_TICKS, () => {
    const now = ownBoat(player);
    if (!now?.owned.anchorDown || now.boat !== boat || player.getAttribute?.(REMINDED_ATTRIBUTE)) return;
    if (boat.moveMode === core().BoatMoveMode.Stopped) return;
    player.setAttribute?.(REMINDED_ATTRIBUTE, true);
    player.sendMessage(REMINDER);
    setVarbit(player, VARBIT_REMINDER, 1);
  });
}

/** Aboard a boat left at anchor: it stays where it is, as long as it still has an anchor. */
function onBoarded({ boat, owned }) {
  if (!boat?.speedLimits) return;
  const hasAnchor = core().BoatManager.getSpec(boat)?.locs.some((loc) => loc.shape === LOC_SHAPE && anchorKind(loc.id)) === true;
  if (owned?.anchorDown && !hasAnchor) delete owned.anchorDown;
  holdBoat(boat, owned?.anchorDown === true && hasAnchor);
}

module.exports = {
  ANCHORS,
  register(api) {
    pluginApi = api;
    api.onObjectInteraction("Anchor", { Drop: dropAnchor, Raise: raiseAnchor });
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:sail-mode-changed", remindToWeigh);
  },
};
