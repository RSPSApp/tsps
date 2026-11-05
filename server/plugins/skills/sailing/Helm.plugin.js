// The helm: taking and leaving it, the sidepanel sail buttons, and Escape. Ported from xrsps,
// which took it from rsmod's `SailingHelmActions.kt` and `BoatNavigation.kt`
// (https://github.com/rsmod/rsmod, ISC) and their live traces.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const {
  VARBIT,
  MOVE_MODE,
  HELM_STATUS,
  SIDEPANEL_GROUP,
  SIDEPANEL_FACILITIES_CHILD,
  SCRIPT_HELM_UPDATE,
  SCRIPT_SIDEBUTTON_SWITCH,
  content,
  setVarbit,
  getVarbit,
  playSound,
  animateDeckLocs,
  animateSails,
  setSailClothOps,
  isHelm,
  boatAnim,
  boatType,
  suppliedBoatProfile,
} = require("./SailingContent.Sailing");
const { windFor, canTrim, trimSails, isTrimmed, helmOperator } = require("./Trim.Helm");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const {
  INTERACTION_WORLD_DEFAULT,
  TileInteractionMode,
  EntityInteractionMode,
} = require("../../../src/main/typescript/elvarg/net/protocol/InteractionMode");

const HELM_LOCKED_IN = 3;
/** sailing_sidepanel_helm_status while a crewmate holds the helm (rsprox). */
const HELM_STATUS_CREW = 3;
/** While navigating, the helm and the helmsman replay their loop every 10 ticks (rsprox). */
const HELM_LOOP_TICKS = 10;
const SOUND_SAIL_RAISE = 10831;
const SOUND_SAIL_LOWER = 10833;

let pluginApi = null;
// Content may grant the helm of its owner-private physical ship without inventing
// a personal boat slot. The record also identifies delayed release/loop callbacks.
const suppliedHelms = new WeakMap();

const SAIL_MODES = {
  full: { varbit: MOVE_MODE.FULL, boat: BoatMoveMode.Full },
  half: { varbit: MOVE_MODE.HALF, boat: BoatMoveMode.Half },
  reverse: { varbit: MOVE_MODE.REVERSE, boat: BoatMoveMode.Reverse },
  stop: { varbit: MOVE_MODE.STOPPED, boat: BoatMoveMode.Stopped },
};

/**
 * The helm facility's three sidepanel buttons (sailing facility dbrows 8121-8123). Each shows
 * one op whose label depends on the move mode, so the action depends on both:
 *
 * | mode        | button 0     | button 1     | button 2     |
 * | 0 stopped   | Set sails    | Reverse      | Set sails    |
 * | 1 slow      | Un-set sails | Un-set sails | Raise speed  |
 * | 2 fast      | Un-set sails | Lower speed  | Raise speed  |
 * | 3 reversing | Stop boat    | Reverse      | Stop boat    |
 * | 4 moored    | Set sails    | Reverse      | Set sails    |
 */
function sailButtonTransition(slot, moveMode) {
  const atRest = moveMode === MOVE_MODE.STOPPED || moveMode === MOVE_MODE.MOORED;
  switch (slot) {
    case 0:
      return atRest ? "full" : "stop";
    case 1:
      if (atRest) return "reverse";
      if (moveMode === MOVE_MODE.FULL) return "half";
      if (moveMode === MOVE_MODE.HALF) return "stop";
      return undefined; // already reversing
    case 2:
      if (atRest) return "half";
      if (moveMode === MOVE_MODE.HALF) return "full";
      if (moveMode === MOVE_MODE.REVERSE) return "stop";
      return undefined; // already at full speed
    default:
      return undefined;
  }
}

/**
 * Plays one of the boat type's loc animations (boats.json `anims`, per hull model) on its sails
 * or helm; one not captured for this boat is skipped rather than guessed from another model.
 */
/** The sails' state for a move mode: full and half are up; stopped, moored and reversing are down. */
function sailState(moveMode) {
  if (moveMode === MOVE_MODE.FULL) return "full";
  if (moveMode === MOVE_MODE.HALF) return "half";
  return "down";
}

/** Sets the sails for whoever steers; `raiseSound` replaces the raise sound (a crewmate's, rsprox 11089). */
function setSailMode(player, boat, mode, { raiseSound = SOUND_SAIL_RAISE } = {}) {
  const previous = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  boat.moveMode = SAIL_MODES[mode].boat;
  setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, SAIL_MODES[mode].varbit);
  setVarbit(player, VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED, mode === "stop" ? 0 : 1);
  if (mode === "full" || mode === "half") windFor(boat);
  setSailClothOps(player, boat, mode !== "stop", canTrim(boat));
  animateSails(player, boat, sailState(previous), sailState(SAIL_MODES[mode].varbit));
  if (mode === "full" || mode === "half") {
    playSound(player, raiseSound);
  } else if (mode === "stop") {
    playSound(player, SOUND_SAIL_LOWER);
  }
  pluginApi?.emitCustomEvent("sailing:sail-mode-changed", { player, boat, mode });
}

/**
 * The helm's animations for the boat's size (boats.json `anims.helm`, as captured for the skiff
 * and sloop): taking it plays `active` on the helmsman and the helm loc, and every 10 ticks after
 * both replay `loop` for as long as they navigate, except while the sails are trimmed.
 */
function playHelm(player, boat, name, actor = player) {
  const helm = boatAnim(boat, "helm");
  if (!helm) return;
  if (helm.player?.[name] !== undefined) actor.performAnimation(new Animation(helm.player[name]));
  if (helm[name] !== undefined) animateDeckLocs(player, boat, isHelm, helm[name]);
}

/**
 * Taking and leaving the helm sound by the boat's size (boats.json `anims.helm.sounds`, rsprox
 * captures, rev 235): the raft's 1x3 helm 10792 and 10793 (49 recordings), the skiff's 2x5 and
 * the sloop's 3x8 helms 10807 and 10808 (210 and 35 recordings).
 */
function playHelmSound(player, boat, name) {
  const sound = boatAnim(boat, "helm")?.sounds?.[name];
  if (sound !== undefined) playSound(player, sound);
}

function loopHelm(player, boat, supplied) {
  let ticks = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      const aboard = supplied ? BoatManager.getBoatAboard(player) === boat && suppliedHelms.get(player) === supplied
        : Sailing.instanceAboard(player) === boat;
      if (boat.helmPlayerId !== player.getIndex() || !BoatManager.getSpec(boat) || !aboard) {
        if (supplied && suppliedHelms.get(player) === supplied) releaseSuppliedHelm(player, supplied);
        this.stop();
        return;
      }
      if (++ticks % HELM_LOOP_TICKS === 0 && !isTrimmed(boat)) playHelm(player, boat, "loop");
    }
  })());
}

/**
 * At the helm the helmsman faces the bow, three tiles ahead (rsprox: on the skiff's helm tile
 * 4,5 the player faces 4,2), not the wheel they clicked.
 */
function faceBow(actor) {
  const at = actor.getLocation();
  actor.setPositionToFace(new Location(at.getX(), at.getY() - 3, at.getZ()));
}

/**
 * At the helm a click on the sea steers: live sets heading as the default interaction mode and
 * walk for the boat's own world, on the tick the helm is taken (rsprox, every revision since 235),
 * and the camera follows the boat rather than the helmsman (cam_target on the boat's world entity).
 */
function steerByClicks(player, boat) {
  const previous = suppliedHelms.get(player);
  if (previous && previous.boat !== boat) releaseSuppliedHelm(player, previous);
  player.getPacketSender()
    .sendInteractionMode(INTERACTION_WORLD_DEFAULT, TileInteractionMode.Heading, EntityInteractionMode.All)
    .sendInteractionMode(boat.entityIndex, TileInteractionMode.Walk, EntityInteractionMode.All)
    .sendCameraTarget({ worldEntity: boat.entityIndex });
}

/**
 * Leaving the helm resets the boat's world and sets walk again, before the helm's varbits (live
 * sends the same set twice in a row; once does the same), and the camera goes back to the player.
 */
function walkByClicks(player, boat) {
  player.getPacketSender()
    .sendResetInteractionMode(boat.entityIndex)
    .sendInteractionMode(INTERACTION_WORLD_DEFAULT, TileInteractionMode.Walk, EntityInteractionMode.All)
    .sendCameraTarget({ player: player.getIndex() });
}

function takeHelm(player, boat, supplied) {
  if (!canUseHands(player)) return false;
  const previous = suppliedHelms.get(player);
  if (previous) releaseSuppliedHelm(player, previous);
  if (supplied) suppliedHelms.set(player, supplied);
  // A crewmate at the helm stands aside for the captain, sails as they are (rsprox).
  if (boat.helmCrew) pluginApi?.emitCustomEvent("sailing:helm-taken", { player, boat });
  boat.helmPlayerId = player.getIndex();
  boat.heading = boat.angle;
  const sender = player.getPacketSender();
  setVarbit(player, VARBIT.FACILITY_LOCKEDIN, HELM_LOCKED_IN);
  steerByClicks(player, boat);
  playHelm(player, boat, "active");
  faceBow(player);
  loopHelm(player, boat, supplied);
  sender.sendInterfaceScript(SCRIPT_SIDEBUTTON_SWITCH, [0]);
  playHelmSound(player, boat, "enter");
  if (getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE) === MOVE_MODE.STOPPED) {
    setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.MOORED);
  }
  setVarbit(player, VARBIT.SIDEPANEL_PLAYER_AT_HELM, 1);
  setVarbit(player, VARBIT.SIDEPANEL_HELM_STATUS, HELM_STATUS.NAVIGATING);
  sender.sendInterfaceScript(SCRIPT_HELM_UPDATE, ["", 0, player.getDisplayName(), 1]);
  return true;
}

/** The granting content owns its scene/stage policy; this verifies the physical ship. */
function takeSuppliedHelm(event) {
  event.accepted = false;
  const { player, boat } = event;
  if (!player?.isRegistered() || player.getHitpoints() <= 0 || player.isDying || !boat?.static || !boat.ownerOnly
    || boat.ownerPlayerId !== player.getIndex() || BoatManager.getBoat(boat.entityIndex) !== boat
    || BoatManager.getBoatAboard(player) !== boat) return;
  const current = suppliedHelms.get(player);
  if (current?.boat === boat && boat.helmPlayerId === player.getIndex()) {
    event.accepted = true;
    return; // Reapplying an earned control never starts another loop or toggles it off.
  }
  event.accepted = takeHelm(player, boat, { boat });
}

function suppliedHelmAboard(player) {
  if (!player?.isRegistered() || player.getHitpoints() <= 0 || player.isDying) return undefined;
  const control = suppliedHelms.get(player);
  const boat = control?.boat;
  return boat && BoatManager.getBoat(boat.entityIndex) === boat
    && BoatManager.getBoatAboard(player) === boat && boat.helmPlayerId === player.getIndex()
    ? boat : undefined;
}

/** A content scene may use the same accepted sail adjustment as the panel and first heading. */
function setSuppliedSails(event) {
  event.accepted = false;
  const boat = suppliedHelmAboard(event.player);
  if (!boat || !Object.hasOwn(SAIL_MODES, event.mode) || boat !== event.boat) return;
  setSailMode(event.player, boat, event.mode);
  event.accepted = true;
}

function releaseSuppliedHelm(player, control) {
  if (suppliedHelms.get(player) !== control) return false;
  suppliedHelms.delete(player);
  leaveHelm(player, control.boat);
  return true;
}

function leaveHelm(player, boat) {
  if (suppliedHelms.get(player)?.boat === boat) suppliedHelms.delete(player);
  boat.helmPlayerId = undefined;
  setVarbit(player, VARBIT.FACILITY_LOCKEDIN, 0);
  stopNavigating(player, boat);
  player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  playHelmSound(player, boat, "exit");
  setVarbit(player, VARBIT.SIDEPANEL_PLAYER_AT_HELM, 0);
}

/**
 * Nobody steers any more (the helmsman let go, or the crewmate at the helm was given another
 * job): the boat stops, its sails come down and the captain's clicks walk again.
 */
function stopNavigating(player, boat) {
  const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  boat.moveMode = BoatMoveMode.Stopped;
  boat.heading = boat.angle;
  walkByClicks(player, boat);
  const inactive = boatAnim(boat, "helm")?.inactive
    ?? (suppliedBoatProfile(boat) ? Animation.DEFAULT_RESET_ANIMATION.getId() : undefined);
  if (inactive !== undefined) animateDeckLocs(player, boat, isHelm, inactive);
  setSailClothOps(player, boat, false);
  animateSails(player, boat, sailState(moveMode), "down");
  setVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE, MOVE_MODE.STOPPED);
  setVarbit(player, VARBIT.SIDEPANEL_HELM_STATUS, HELM_STATUS.FREE);
  setVarbit(player, VARBIT.SIDEPANEL_SAIL_BUTTON_TOGGLED, 0);
  player.getPacketSender().sendInterfaceScript(SCRIPT_HELM_UPDATE, ["", 0, "", 1]);
}

/**
 * A crewmate takes the helm for the captain (rsprox, on the order): the captain's clicks on the
 * sea steer from then on, the sidepanel shows the crew at the helm, and a captain at the helm
 * lets go of it first.
 */
function crewTakesHelm(player, boat, npc) {
  if (boat.helmPlayerId === player.getIndex()) leaveHelm(player, boat);
  boat.helmCrew = npc;
  boat.heading = boat.angle;
  steerByClicks(player, boat);
  setVarbit(player, VARBIT.SIDEPANEL_HELM_STATUS, HELM_STATUS_CREW);
  player.getPacketSender().sendInterfaceScript(SCRIPT_HELM_UPDATE, ["", 0, player.getDisplayName(), 1]);
}

/**
 * The helm is navigated from its boat type's stand tile (boats.json `helmStand`, from the wheel),
 * which its animations are made for (rsprox): the raft's own helm tile, the tile south of the
 * skiff's, and south-east of the sloop's. Walk there first.
 */
function routeToHelm(event) {
  const option = event.definition?.getInteractions()?.[event.clickType - 1];
  if (event.definition?.getName() !== "Helm" || option !== "Navigate") return;
  const boat = Sailing.instanceAboard(event.player);
  if (!boat) return;
  const type = boatType(BoatManager.getSpec(boat)?.type);
  const stand = type?.helmStand;
  if (!stand) return;
  const helm = event.object.getLocation();
  const x = helm.getX() + stand.x;
  const y = helm.getY() + stand.y;
  const walkable = type.walkableDeck.some((tile) => boat.deckBaseX + tile.x === x && boat.deckBaseY + tile.y === y);
  if (!walkable) return;
  event.destination = { x, y, z: helm.getZ() };
}

/**
 * The sail cloth is used from a deck tile beside it (live turns the player to face it), the
 * nearest one to the player; walking to the loc itself would stop on its tile, out of reach.
 * Whoever is steering uses it from the helm, without walking off it.
 */
function routeToSails(event) {
  const option = event.definition?.getInteractions()?.[event.clickType - 1];
  if (event.definition?.getName() !== "Sails" || !["Trim", "Set", "Un-set"].includes(option)) return;
  const boat = Sailing.instanceAboard(event.player);
  if (!boat) return;
  const sails = event.object.getLocation();
  if (boat.helmPlayerId === event.player.getIndex()) {
    event.destination = { ...event.sourceLocation };
    return;
  }
  const walkable = (boatType(BoatManager.getSpec(boat)?.type)?.walkableDeck ?? [])
    .map((tile) => ({ x: boat.deckBaseX + tile.x, y: boat.deckBaseY + tile.y }));
  const from = event.sourceLocation;
  const beside = walkable
    .filter((tile) => Math.abs(tile.x - sails.getX()) + Math.abs(tile.y - sails.getY()) === 1)
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  if (beside) event.destination = { x: beside.x, y: beside.y, z: sails.getZ() };
}

function routeOnDeck(event) {
  leaveHelmForOtherLoc(event);
  routeToHelm(event);
  routeToSails(event);
}

/**
 * Clicking any other loc from the helm leaves it, which stops the boat (rsprox, a salvaging hook's
 * Deploy from the helm: facility_lockedin 3->0, then at_helm 1->0 and the move mode to 0). The
 * helm itself and the sail cloth (Trim is captured from the helm) keep the helmsman there.
 */
function leaveHelmForOtherLoc(event) {
  const { player } = event;
  const boat = Sailing.instanceAboard(player);
  if (!boat || boat.helmPlayerId !== player.getIndex()) return;
  const name = event.definition?.getName();
  if (name === "Helm" || name === "Sails") return;
  // The wind catcher is worked from the helm too (rsprox 907 11533).
  if (require("./WindCatcher.Helm").isCatcherLoc(event.objectId)) return;
  leaveHelm(player, boat);
}

/**
 * Another plugin's action takes the player away from the helm (a charting spot, the spyglass):
 * the same as letting go of it. `left` tells the caller whether they were at the helm, as live
 * answers a tick later then (rsprox 1009: the helm released on the click, the charting next tick).
 *
 *   api.emitCustomEvent("sailing:leave-helm", { player }) -> { left }
 */
function leaveHelmFor(event) {
  const { player } = event;
  event.left = false;
  const supplied = suppliedHelms.get(player);
  // An old scene may finish after the player has boarded/taken another helm.
  // An explicit boat never falls through to releasing that newer personal boat.
  if (event.boat) {
    if (supplied?.boat === event.boat) event.left = releaseSuppliedHelm(player, supplied);
    return;
  }
  if (supplied) {
    event.left = releaseSuppliedHelm(player, supplied);
    return;
  }
  const boat = Sailing.instanceAboard(player);
  if (!boat || boat.helmPlayerId !== player.getIndex()) return;
  leaveHelm(player, boat);
  event.left = true;
}

function toggleHelm({ player, object }) {
  const boat = Sailing.instanceAboard(player) ?? suppliedHelmAboard(player);
  if (!boat) return;
  if (boat.helmPlayerId === player.getIndex()) {
    leaveHelm(player, boat);
    // Live turns the helmsman to the wheel on the tick they let go (rsprox: face_angle 768 on the
    // sloop, 1024 on the skiff), with the helm animation's reset. Here the reset goes first and
    // the turn a tick later, so they don't spin round still holding the wheel.
    faceBow(player);
    const wheel = object?.getLocation?.();
    if (wheel) {
      TaskManager.submit(new (class extends Task {
        constructor() { super(1, player, false); }
        execute() {
          this.stop();
          if (Sailing.instanceAboard(player) === boat && boat.helmPlayerId !== player.getIndex()) player.setPositionToFace(wheel);
        }
      })());
    }
  } else if (boat.helmPlayerId === undefined) {
    takeHelm(player, boat);
  }
}

/**
 * Leaving the boat from the helm (Escape, a teleport) never calls leaveHelm; a logout is set back
 * to walk with every other logout (PlayerSession.logout).
 */
function walkAfterLeaving({ player, boat, reason, atHelm }) {
  if (atHelm && reason !== "logout") walkByClicks(player, boat);
}

/** Escape sinks the boat, so it asks first; the choice is checked again in case they left. */
function escapeBoat(api, { player }) {
  if (!Sailing.instanceAboard(player)) return;
  api.sendMultiChatboxPrompt(
    player,
    "Escape? Your boat will sink until a shipwright recovers it.",
    "Yes, abandon ship.",
    () => {
      if (!Sailing.instanceAboard(player)) return;
      Sailing.escape(player);
      player.sendMessage("Your boat sinks, and you make it back to shore.");
    },
    "No.",
    () => {},
  );
}

/** The sail row's three buttons (937:25 slots 0-2), for whoever steers: the helmsman, or the captain while a crewmate holds the helm. */
function clickSailButton(event) {
  if (event.groupId !== SIDEPANEL_GROUP || event.childId !== SIDEPANEL_FACILITIES_CHILD) return;
  if ((event.slot ?? -1) > 2) return;
  event.handled = true;
  const { player } = event;
  const boat = Sailing.instanceAboard(player) ?? suppliedHelmAboard(player);
  if (!boat || !BoatManager.steers(player, boat)) return;
  const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  const mode = sailButtonTransition(event.slot ?? -1, moveMode);
  if (mode) {
    setSailMode(player, boat, mode);
  } else if (event.slot === 2 && moveMode === MOVE_MODE.FULL) {
    player.sendMessage("The boat is already going as fast as it can.");
  }
}

/**
 * The sail cloth's Set and Un-set: the side panel's set (full sail) and un-set, for whoever is at
 * the helm, as live (rsprox); with nobody steering, the sails can't be adjusted.
 */
function adjustSails(mode) {
  return ({ player }) => {
    const boat = Sailing.instanceAboard(player) ?? suppliedHelmAboard(player);
    if (!boat) return;
    keepFacingBow(player, boat);
    const helmsman = boat.helmPlayerId === player.getIndex() ? player : helmOperator(boat)?.player;
    if (!helmsman || (Sailing.instanceAboard(helmsman) ?? suppliedHelmAboard(helmsman)) !== boat) {
      player.sendMessage("You or a crewmate must be navigating at the helm to adjust the sails.");
      return;
    }
    const moveMode = getVarbit(helmsman, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
    const set = moveMode !== MOVE_MODE.STOPPED && moveMode !== MOVE_MODE.MOORED;
    if (set !== (mode === "stop")) return;
    setSailMode(helmsman, boat, mode);
  };
}

/**
 * The helmsman using the sail cloth from the helm keeps facing the bow (rsprox: Trim's face angle
 * 0 in 315 of 319 clicks), not the cloth the click turned them to, which on the sloop is behind.
 */
function keepFacingBow(player, boat) {
  if (boat.helmPlayerId === player.getIndex()) faceBow(player);
}

/** The sail cloth's Trim: catches a gust for whoever is at the helm (Trim.Helm.js). */
function trim({ player }) {
  const boat = Sailing.instanceAboard(player);
  if (!boat) return;
  if (!canUseHands(player)) return;
  keepFacingBow(player, boat);
  const operator = helmOperator(boat);
  if (!operator || Sailing.instanceAboard(operator.player) !== boat) {
    player.sendMessage("You or a crewmate must be navigating at the helm to adjust the sails.");
    return;
  }
  // The helm's trim animation plays on whoever holds it, a crewmate too.
  if (!trimSails(operator.player, boat, { actor: operator.actor })) player.sendMessage("The sails are already catching the wind well.");
}

/** Content policies for an action that needs the clicking player's hands. */
function canUseHands(player) {
  const request = { player, allow: null };
  pluginApi.emitCustomEvent("sailing:can-use-hands", request);
  return request.allow !== false;
}

/**
 * The first heading after taking the helm (moored) raises full sail. Once the sails are lowered
 * at the helm (stopped), a heading only turns the boat (rsprox: crew-combat, the boat turning
 * twice with the sails down after the Stop button).
 */
function raiseSailForHeading(player, boat) {
  const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
  if (moveMode === MOVE_MODE.MOORED) setSailMode(player, boat, "full");
}

module.exports = {
  name: "SailingHelm",
  members: true,
  sailButtonTransition,
  sailState,
  setSailMode,
  playHelm,
  faceBow,
  stopNavigating,
  crewTakesHelm,
  HELM_LOOP_TICKS,
  register(api) {
    pluginApi = api;
    content();
    api.onObjectInteraction("Helm", {
      Navigate: toggleHelm,
      "Stop-navigating": toggleHelm,
      Escape: (event) => escapeBoat(api, event),
    });
    api.onObjectInteraction("Sails", { Trim: trim, Set: adjustSails("full"), "Un-set": adjustSails("stop") });
    api.onObjectRoute(routeOnDeck);
    api.onCustomEvent("sailing:left", walkAfterLeaving);
    api.onCustomEvent("sailing:take-helm", takeSuppliedHelm);
    api.onCustomEvent("sailing:set-supplied-sails", setSuppliedSails);
    api.onCustomEvent("sailing:leave-helm", leaveHelmFor);
    api.onInterfaceActionClick(clickSailButton);
    require("./WindCatcher.Helm").attach(api);
    BoatManager.onHeadingSet(raiseSailForHeading);
  },
};
