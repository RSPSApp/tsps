// A boat's anchor at sea (docs/sailing.md):
// - Drop: "You drop the anchor, bringing the boat to a stop.", the drop animation on the player
//   and the anchor, and 4 ticks later the lowered anchor. Dropped from the helm, the helmsman lets
//   go of it first (Helm.plugin.js), so the sails come down.
// - Raise: "You raise the anchor, allowing the boat to move.", the pull animations, and 3 ticks
//   later the raised anchor.
// - While it's down the boat doesn't move, whatever the sails. 10 ticks after the sails are set,
//   once a login: "Trying to move the boat? Don't forget to weigh anchor!" and
//   sailing_boat_anchor_reminder 1.
// The anchor stays down with the boat. Ours: once a login for the reminder, and the 3x8 anchor's
// drop playing the 2x5's player animation, as the cache has no large one.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { animateDeckLoc, setVarbit } = require("./SailingContent.Sailing");
const { ANCHOR_LOWERED } = require("./BoatFacilities.Sailing");

/** Each anchor's raised and lowered locs and its animations (cache seq names). */
const ANCHORS = [
  { raised: 59687, lowered: ANCHOR_LOWERED[59687], playerDrop: 13310, playerPull: 13318, drop: 13311, pull: 13312 },
  { raised: 59689, lowered: ANCHOR_LOWERED[59689], playerDrop: 13310, playerPull: 13317, drop: 13315, pull: 13316 },
];
/** The speed limit that holds an anchored boat (Boat.speedLimits). */
const ANCHOR_LIMIT = "anchor";
const LOWERED_TICKS = 4;
const RAISED_TICKS = 3;
const REMINDER_TICKS = 10;
const VARBIT_REMINDER = 19119;
const REMINDED_ATTRIBUTE = "sailing:anchor-reminded";

const DROPPED = "You drop the anchor, bringing the boat to a stop.";
const RAISED = "You raise the anchor, allowing the boat to move.";
const REMINDER = "Trying to move the boat? Don't forget to weigh anchor!";

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

function anchorKind(id) {
  return ANCHORS.find((anchor) => anchor.raised === id || anchor.lowered === id);
}

/** The player's own boat they're aboard and its saved state, or undefined. */
function ownBoat(player) {
  const boat = Sailing.instanceAboard(player);
  const owned = boat && Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** The anchor's deck loc at a clicked tile. */
function deckAnchor(boat, location) {
  const x = location.x - boat.deckBaseX;
  const y = location.y - boat.deckBaseY;
  return BoatManager.getSpec(boat)?.locs.find((loc) => loc.x === x && loc.y === y && loc.shape === 10 && anchorKind(loc.id));
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
  later(player, ticks, () => {
    if (Sailing.instanceAboard(player) !== boat) return;
    const current = BoatManager.getSpec(boat)?.locs.find((candidate) => candidate.x === loc.x && candidate.y === loc.y && candidate.shape === loc.shape);
    if (current && anchorKind(current.id)) BoatManager.setDeckLoc(boat, { ...current, id });
  });
}

function drop(player, aboard, loc, kind) {
  aboard.owned.anchorDown = true;
  holdBoat(aboard.boat, true);
  player.sendMessage(DROPPED);
  player.performAnimation(new Animation(kind.playerDrop));
  animateDeckLoc(player, aboard.boat, loc, kind.drop);
  swapLoc(player, aboard.boat, loc, kind.lowered, LOWERED_TICKS);
}

function raise(player, aboard, loc, kind) {
  aboard.owned.anchorDown = false;
  holdBoat(aboard.boat, false);
  player.sendMessage(RAISED);
  player.performAnimation(new Animation(kind.playerPull));
  animateDeckLoc(player, aboard.boat, loc, kind.pull);
  swapLoc(player, aboard.boat, loc, kind.raised, RAISED_TICKS);
}

function onAnchor(event) {
  const kind = anchorKind(event.objectId ?? event.definition?.getId?.());
  if (!kind || event.clickType !== 1) return;
  const aboard = ownBoat(event.player);
  const loc = aboard && deckAnchor(aboard.boat, event.location);
  if (!loc) return;
  event.handled = true;
  if (aboard.owned.anchorDown) raise(event.player, aboard, loc, kind);
  else drop(event.player, aboard, loc, kind);
}

/** Setting sail with the anchor down: once a login, the reminder 10 ticks later. */
function remindToWeigh({ player, boat, mode }) {
  if (mode === "stop" || player.getAttribute?.(REMINDED_ATTRIBUTE)) return;
  const aboard = ownBoat(player);
  if (!aboard || aboard.boat !== boat || !aboard.owned.anchorDown) return;
  later(player, REMINDER_TICKS, () => {
    const now = ownBoat(player);
    if (!now?.owned.anchorDown || now.boat !== boat || player.getAttribute?.(REMINDED_ATTRIBUTE)) return;
    if (boat.moveMode === BoatMoveMode.Stopped) return;
    player.setAttribute?.(REMINDED_ATTRIBUTE, true);
    player.sendMessage(REMINDER);
    setVarbit(player, VARBIT_REMINDER, 1);
  });
}

/** Aboard a boat left at anchor: it stays where it is. */
function onBoarded({ boat, owned }) {
  if (boat?.speedLimits) holdBoat(boat, owned?.anchorDown === true);
}

module.exports = {
  name: "SailingAnchor",
  description: "A boat's anchor: dropping it stops the boat and holds it still until it's raised.",
  members: true,
  ANCHORS,
  register(api) {
    api.onObjectInteraction(onAnchor);
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:sail-mode-changed", remindToWeigh);
  },
};
