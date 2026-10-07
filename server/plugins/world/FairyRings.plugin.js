/**
 * Fairy rings (https://oldschool.runescape.wiki/w/Fairy_ring), as in an OSRS capture
 * (docs/fairy-rings.md). Everything about the 64 dial combinations comes from the cache's
 * fairy ring table (db table 89): the code, the destination, the values OSRS sends for the last
 * destination, and the travel log's components and text.
 *
 * - The dials (interface 398) are varbits 3985/3986/3987; each value 0-3 is a letter in the
 *   dial's anticlockwise order (A D C B, I L K J, P S R Q). The rotate buttons turn them.
 * - The travel log (interface 381, beside the dials) shows the codes the player has used, the
 *   Fairy Queen's Hideout and up to 10 favourites.
 * - Confirm, "Last-destination (XYZ)" and "Zanaris" play the fairy teleport. AJQ (Dorgesh-Kaan
 *   cave) first warns a player without a light source (interface 578).
 *
 * ponytail: Fairytale II - Cure a Queen is not implemented, so the quest check passes when the
 * quest is not registered rather than blocking every player.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Direction } = require("../../src/main/typescript/elvarg/game/model/Direction");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const QuestRuntime = require("../quests/QuestRuntime");

const DIALS_INTERFACE = 398;
const LOG_INTERFACE = 381;
const WARNING_INTERFACE = 578;
const SIDE_MODAL = (161 << 16) | 74;
/** toplevel_mainmodal_background: the dim backdrop over the whole game view, as captured. */
const MODAL_BACKGROUND_SCRIPT = 917;
const MODAL_BACKGROUND = [4212288, 50];
/** toplevel_mainmodal_open, sent (as captured) before the warning replaces the dials. */
const MODAL_OPEN_SCRIPT = 2524;
/** meslayer_close: closes the chatbox input if it is in mode 28, the travel log's search. */
const MESLAYER_CLOSE_SCRIPT = 101;
const SEARCH_MESLAYER = 28;
const FAIRY_RING_TABLE = 89;

const DIAL_VARBITS = [3985, 3986, 3987];
/** Each dial's letters by varbit value: the dials count anticlockwise. */
const DIAL_LETTERS = [["A", "D", "C", "B"], ["I", "L", "K", "J"], ["P", "S", "R", "Q"]];
/** Rotate buttons: component -> [dial, step]. */
const DIAL_BUTTONS = new Map([[19, [0, 1]], [20, [0, -1]], [21, [1, 1]], [22, [1, -1]], [23, [2, 1]], [24, [2, -1]]]);
const CONFIRM_CHILD_ID = 26;
const CLOSE_CHILD_ID = 27;

const BUSY_VARBIT = 12393;
const DESTINATION_VARP = 817;
const LAST_LOCATION_VARBIT = 5374;
const LAST_LOCATION_OP_VARBIT = 20251;
const LAST_LOCATION_OP_VISIBLE = 64;

const DARK_WARNING_VARBIT = 3865;
const DARK_WARNING_CODE = "AJQ";
const WARNING_YES = 17;
const WARNING_NO = 18;
const WARNING_DONT_ASK = 20;

const HIDEOUT_COMPONENT = 140;
const HIDEOUT_CODE = "AIR";
const HIDEOUT_TEXT = "<col=ffffff>AIR</col> DLR DJQ AJS<br><col=ff981f>Fairy Queen's Hideout</col>";
const FAVOURITE_TEXT = 141;
const FAVOURITE_CODE_TEXT = 151;
/** The favourites' remove stars; component 166 is not one. */
const FAVOURITE_STARS = [161, 162, 163, 164, 165, 167, 168, 169, 170, 171];
const MAX_FAVOURITES = 10;

const FLOWERS_GRAPHIC = 569;
const VANISH_ANIMATION = 3265;
const VANISH_DELAY = 30;
const APPEAR_ANIMATION = 3266;
const TELEPORT_SOUND = 1098;

const LAST_CODE_ATTRIBUTE = "fairy-rings:last";
const USED_CODES_ATTRIBUTE = "fairy-rings:used";
const FAVOURITES_ATTRIBUTE = "fairy-rings:favourites";
const FAIRYQUEST_NAME = "Fairytale II - Cure a Queen";

let core = null;
/** Players whose dials or warning close because they are going: busy stays set (as captured). */
const going = new WeakSet();
/** The ring each player configured, which Confirm steps onto. */
const configuredRing = new WeakMap();
/** code -> { code, destination, destinationId, index, logText, logComponent, starComponent } */
let rings = new Map();
let ringsByComponent = new Map();

function unpackCoord(packed) {
  return { x: (packed >> 14) & 0x3fff, y: packed & 0x3fff, z: packed >>> 28 };
}

/** The fairy ring table; a combination with no destination has a placeholder coordinate. */
function loadRings() {
  const byCode = new Map();
  for (const row of CacheDefinitions.getDbTableRows(FAIRY_RING_TABLE)) {
    const column = (n) => row.columns.get(n)?.[0];
    const code = String(column(3) ?? "").replace(/\s+/g, "");
    const { x, y, z } = unpackCoord(column(2) ?? 0);
    const reachable = x > 100 && y > 100;
    byCode.set(code, {
      code,
      destination: reachable ? new Location(x, y, z) : null,
      destinationId: column(0),
      index: column(1),
      logText: column(8) ?? "",
      logComponent: (column(4) ?? -1) & 0xffff,
      starComponent: (column(5) ?? -1) & 0xffff,
    });
  }
  return byCode;
}

function codeList(player, attribute) {
  return String(player.getAttribute(attribute) ?? "").split(",").filter((code) => rings.has(code));
}

function wieldsFairyMagic(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
  return weapon === core.ItemIdentifiers.DRAMEN_STAFF || weapon === core.ItemIdentifiers.LUNAR_STAFF;
}

function questAllows(player) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === FAIRYQUEST_NAME);
  return quest ? quest.isComplete(player) : true;
}

function canUse(player) {
  if (!wieldsFairyMagic(player)) {
    player.sendMessage("The fairy ring only works for those who wield fairy magic.");
    return false;
  }
  if (!questAllows(player)) {
    player.sendMessage("You need to have started Fairytale II - Cure a Queen to use the fairy rings.");
    return false;
  }
  return true;
}

function codeFromDials(player) {
  const sender = player.getPacketSender();
  return DIAL_VARBITS.map((varbit, dial) => DIAL_LETTERS[dial][sender.getVarbit(varbit) & 3]).join("");
}

function setDials(player, code) {
  const sender = player.getPacketSender();
  DIAL_VARBITS.forEach((varbit, dial) => {
    const value = DIAL_LETTERS[dial].indexOf(code?.[dial] ?? "");
    sender.sendVarbit(varbit, value >= 0 ? value : 0);
  });
}

function sendFavourites(player) {
  const sender = player.getPacketSender();
  const favourites = codeList(player, FAVOURITES_ATTRIBUTE);
  for (let slot = 0; slot < MAX_FAVOURITES; slot++) {
    const ring = rings.get(favourites[slot]);
    sender.sendString(ring?.logText ?? "", (LOG_INTERFACE << 16) | (FAVOURITE_TEXT + slot));
    sender.sendString(ring?.code ?? "", (LOG_INTERFACE << 16) | (FAVOURITE_CODE_TEXT + slot));
  }
}

function sendTravelLog(player) {
  const sender = player.getPacketSender();
  const used = new Set(codeList(player, USED_CODES_ATTRIBUTE));
  for (const ring of rings.values()) {
    if (ring.logComponent <= 0) continue;
    sender.sendString(used.has(ring.code) ? ring.logText : "", (LOG_INTERFACE << 16) | ring.logComponent);
  }
  sender.sendString(HIDEOUT_TEXT, (LOG_INTERFACE << 16) | HIDEOUT_COMPONENT);
  sendFavourites(player);
}

function ringTile(location) {
  return location ? new Location(location.x, location.y, location.z) : null;
}

/** OSRS sets busy the tick after the dials open (not on a dial click). */
function openDial({ player, location }) {
  if (!player || !canUse(player)) return;
  configuredRing.set(player, ringTile(location));
  setDials(player, "");
  sendTravelLog(player);
  player.getPacketSender()
    .sendClientScript(MODAL_BACKGROUND_SCRIPT, ...MODAL_BACKGROUND)
    .sendInterface(DIALS_INTERFACE)
    .sendSubInterface(SIDE_MODAL, LOG_INTERFACE, 3);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      this.stop();
      if (player.getInterfaceId?.() === DIALS_INTERFACE) player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
    }
  })());
}

function closeDials(player, teleporting = false) {
  if (teleporting) going.add(player);
  player.getPacketSender().closeSubInterface(SIDE_MODAL);
  player.getPacketSender().sendInterfaceRemoval();
  going.delete(player);
}

/** The last destination, as OSRS sends it: the ring's "Last-destination (XYZ)" follows it. */
function sendLastDestination(player, ring) {
  player.getPacketSender()
    .sendConfig(DESTINATION_VARP, ring.destinationId)
    .sendVarbit(LAST_LOCATION_VARBIT, ring.index)
    .sendVarbit(LAST_LOCATION_OP_VARBIT, LAST_LOCATION_OP_VISIBLE + ring.index);
}

function rememberUse(player, ring) {
  const used = codeList(player, USED_CODES_ATTRIBUTE);
  if (!used.includes(ring.code)) player.setAttribute(USED_CODES_ATTRIBUTE, [...used, ring.code].join(","));
}

/**
 * A walk step onto the ring's tile. The ring is solid to the movement queue, but OSRS walks the
 * player onto it, so the step bypasses collision (as agility's forced walks do).
 */
function stepOntoRing(player, ring) {
  const at = player.getLocation();
  const dx = Math.sign(ring.getX() - at.getX());
  const dy = Math.sign(ring.getY() - at.getY());
  player.getMovementQueue().reset();
  player.setLocation(new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
  player.setWalkingDirection(Direction.fromDeltas(dx, dy));
  player.getMovementQueue().handleRegionChange();
}

/**
 * The fairy teleport, from the ring at `from`. A player not on the ring's tile steps onto it
 * first, and the flowers appear a tick later; on it, at once. The player arrives 3 ticks after
 * the flowers and is free a tick after that. `fromClick`: called while handling an interface
 * click (between ticks), so the task's first run is on this tick rather than the next.
 */
function fairyTeleport(player, ring, from, fromClick) {
  const sender = player.getPacketSender();
  const onRing = !from || from.equals(player.getLocation());
  if (!onRing) stepOntoRing(player, from);
  const delay = onRing ? 0 : 1;
  const sameRing = ring.destination.getDistance(from ?? player.getLocation()) <= 1;
  const vanish = () => {
    sender.sendVarbit(BUSY_VARBIT, 1);
    player.performGraphic(new core.Graphic(FLOWERS_GRAPHIC));
    player.performAnimation(new core.Animation(VANISH_ANIMATION, VANISH_DELAY));
    sender.sendSoundEffect(TELEPORT_SOUND, 1, 0, 1);
  };
  if (delay === 0) vanish();
  // A ring's option runs on the player's turn, after this tick's tasks: the first run is tick 1.
  let tick = fromClick ? -1 : 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === delay) vanish();
      if (tick === delay + 3) {
        if (!sameRing) {
          player.moveTo(ring.destination);
          rememberUse(player, ring);
        }
        player.performAnimation(new core.Animation(APPEAR_ANIMATION));
      }
      if (tick === delay + 4) {
        sender.sendVarbit(BUSY_VARBIT, 0);
        player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        this.stop();
      }
    }
  })());
}

/** A light source keeps AJQ's dark-cave warning away. */
function hasLightSource(player) {
  const lit = (item) => {
    const name = item?.getId?.() > 0 ? core.ItemDefinition.forId(item.getId())?.getName?.() ?? "" : "";
    return /^lit |\(lit\)$|^bullseye lantern|^kandarin headgear [2-4]|^firemaking cape|^max cape/i.test(name);
  };
  return [...player.getInventory().getItems(), ...player.getEquipment().getItems()].some(lit);
}

function confirmDial(player) {
  const ring = rings.get(codeFromDials(player));
  if (!ring?.destination) {
    player.sendMessage("The fairy ring combination is not a valid destination.");
    return;
  }
  // The open dials count as busy for the teleport checks, so they close first.
  closeDials(player, true);
  const sender = player.getPacketSender();
  if (!core.TeleportHandler.checkReqs(player, ring.destination, 20)) {
    sender.sendVarbit(BUSY_VARBIT, 0);
    return;
  }
  sendLastDestination(player, ring);
  player.setAttribute(LAST_CODE_ATTRIBUTE, ring.code);
  if (ring.code === DARK_WARNING_CODE && !hasLightSource(player)) {
    const asked = sender.getVarbit(DARK_WARNING_VARBIT);
    if (asked !== 2) {
      sender.sendVarbit(DARK_WARNING_VARBIT, 1)
        .sendVarbit(BUSY_VARBIT, 1)
        .sendClientScript(MODAL_OPEN_SCRIPT, -1, -1)
        .sendInterface(WARNING_INTERFACE);
      return;
    }
  }
  fairyTeleport(player, ring, configuredRing.get(player), true);
}

/** Travel log clicks: use a code, add or remove a favourite. */
function logAction(player, childId, option) {
  const favourites = codeList(player, FAVOURITES_ATTRIBUTE);
  const favouriteSlot = childId >= FAVOURITE_TEXT && childId < FAVOURITE_TEXT + MAX_FAVOURITES
    ? childId - FAVOURITE_TEXT
    : FAVOURITE_STARS.indexOf(childId);
  if (favouriteSlot >= 0) {
    if (/remove/i.test(option ?? "") || FAVOURITE_STARS.includes(childId)) {
      favourites.splice(favouriteSlot, 1);
      player.setAttribute(FAVOURITES_ATTRIBUTE, favourites.join(","));
      sendFavourites(player);
    } else if (favourites[favouriteSlot]) {
      setDials(player, favourites[favouriteSlot]);
    }
    return;
  }
  if (childId === HIDEOUT_COMPONENT) {
    setDials(player, HIDEOUT_CODE);
    return;
  }
  const ring = ringsByComponent.get(childId);
  if (!ring) return;
  const adding = /favourite/i.test(option ?? "") || childId === ring.starComponent;
  if (!adding) {
    setDials(player, ring.code);
    return;
  }
  if (favourites.includes(ring.code)) return;
  if (favourites.length >= MAX_FAVOURITES) {
    player.sendMessage("You can't have more than 10 favourite fairy ring codes.");
    return;
  }
  player.setAttribute(FAVOURITES_ATTRIBUTE, [...favourites, ring.code].join(","));
  sendFavourites(player);
}

function interfaceAction(event) {
  const { player, groupId, childId } = event;
  const sender = player.getPacketSender();
  if (groupId === DIALS_INTERFACE) {
    event.handled = true;
    const button = DIAL_BUTTONS.get(childId);
    if (button) {
      const [dial, step] = button;
      sender.sendVarbit(DIAL_VARBITS[dial], (sender.getVarbit(DIAL_VARBITS[dial]) + step) & 3);
    } else if (childId === CONFIRM_CHILD_ID) {
      confirmDial(player);
    } else if (childId === CLOSE_CHILD_ID) {
      closeDials(player);
    }
  } else if (groupId === LOG_INTERFACE) {
    event.handled = true;
    logAction(player, childId, event.option);
  } else if (groupId === WARNING_INTERFACE) {
    event.handled = true;
    if (childId === WARNING_DONT_ASK) {
      sender.sendVarbit(DARK_WARNING_VARBIT, sender.getVarbit(DARK_WARNING_VARBIT) === 2 ? 1 : 2);
      return;
    }
    if (childId !== WARNING_YES && childId !== WARNING_NO) return;
    if (childId === WARNING_YES) going.add(player);
    sender.sendInterfaceRemoval();
    going.delete(player);
    if (childId === WARNING_YES) fairyTeleport(player, rings.get(DARK_WARNING_CODE), configuredRing.get(player), true);
    else sender.sendVarbit(BUSY_VARBIT, 0);
  }
}

/**
 * Closing the dials, by any route, closes the travel log and its search box in the chatbox (as
 * OSRS does on Confirm). Closing them or the warning without going clears busy.
 */
function interfaceClosed({ player, interfaceId }) {
  if (interfaceId !== DIALS_INTERFACE && interfaceId !== WARNING_INTERFACE) return;
  const sender = player.getPacketSender();
  if (interfaceId === DIALS_INTERFACE) {
    sender.closeSubInterface(SIDE_MODAL);
    sender.sendClientScript(MESLAYER_CLOSE_SCRIPT, SEARCH_MESLAYER);
  }
  if (!going.has(player)) sender.sendVarbit(BUSY_VARBIT, 0);
}

function lastDestination({ player, location }) {
  if (!player || !canUse(player)) return;
  const ring = rings.get(String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? ""));
  if (!ring?.destination) {
    player.sendMessage("You haven't used the fairy ring teleportation system yet.");
    return;
  }
  if (!core.TeleportHandler.checkReqs(player, ring.destination, 20)) return;
  fairyTeleport(player, ring, ringTile(location), false);
}

function zanaris({ player, location }) {
  if (!player || !canUse(player)) return;
  const ring = rings.get("BKS");
  if (!core.TeleportHandler.checkReqs(player, ring.destination, 20)) return;
  fairyTeleport(player, ring, ringTile(location), false);
}

function sendLastOnLogin({ player }) {
  const ring = rings.get(String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? ""));
  if (ring) sendLastDestination(player, ring);
}

function attach(api) {
  core = api.core;
  rings = loadRings();
  ringsByComponent = new Map();
  for (const ring of rings.values()) {
    if (ring.logComponent > 0) ringsByComponent.set(ring.logComponent, ring);
    if (ring.starComponent > 0) ringsByComponent.set(ring.starComponent, ring);
  }
}

/** Every ring's options: Zanaris, Configure and "Last-destination (XYZ)" for each code. */
function ringOptions() {
  const options = { Zanaris: zanaris, Configure: openDial };
  for (const code of rings.keys()) options[`Last-destination (${code})`] = lastDestination;
  return options;
}

module.exports = {
  name: "FairyRings",
  members: true,
  _test: {
    loadRings,
    codeFromDials,
    setDials,
    canUse,
    openDial,
    confirmDial,
    lastDestination,
    interfaceAction,
    interfaceClosed,
    hasLightSource,
    rings: () => rings,
    DIAL_VARBITS,
    DIAL_LETTERS,
    LAST_CODE_ATTRIBUTE,
    USED_CODES_ATTRIBUTE,
    FAVOURITES_ATTRIBUTE,
  },
  register(api) {
    attach(api);
    api.persistAttribute(LAST_CODE_ATTRIBUTE);
    api.persistAttribute(USED_CODES_ATTRIBUTE);
    api.persistAttribute(FAVOURITES_ATTRIBUTE);
    api.onObjectInteraction("Fairy ring", ringOptions());
    api.onInterfaceActionClick(interfaceAction);
    api.onCustomEvent("interface:closed", interfaceClosed);
    api.onPlayerLogin(sendLastOnLogin);
    api.log("registered", { rings: rings.size });
  },
};
