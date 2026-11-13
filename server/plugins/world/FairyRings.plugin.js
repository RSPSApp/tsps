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
 * - Confirm, "Last-destination" and "Zanaris" play the fairy teleport. AJQ (Dorgesh-Kaan
 *   cave) first warns a player without a light source (interface 578).
 * - Zanaris' two one-way exit rings ("Use") play the same teleport with no staff or quest
 *   check (Wiki: Fairy ring (Zanaris)): the one by the shed's arrival tile to the Lumbridge
 *   Swamp shed, the market's to behind Al Kharid bank.
 *
 * Quest-owned permission and special routes use custom queries; with quests disabled,
 * the network remains available to staff-wielding players.
 */
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Direction } = require("../../src/main/typescript/elvarg/game/model/Direction");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

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
const LOG_FAVOURITE_OP = 2;
/**
 * fairyring_fave_1..10: each favourite slot is 64 + the code's index (its dial letters and a set
 * flag), 0 when empty. fairyrings_favourite_opvis has one bit per filled slot.
 */
const FAVOURITE_VARBITS = Array.from({ length: MAX_FAVOURITES }, (_, slot) => 20240 + slot);
const FAVOURITE_SET = 64;
const FAVOURITE_OPVIS_VARBIT = 20239;
/** The dials turning to a code picked from the travel log. */
const USE_CODE_SOUND = 2871;

const FLOWERS_GRAPHIC = 569;
const VANISH_ANIMATION = 3265;
const VANISH_DELAY = 30;
const APPEAR_ANIMATION = 3266;
const TELEPORT_SOUND = 1098;

const LAST_CODE_ATTRIBUTE = "fairy-rings:last";
const USED_CODES_ATTRIBUTE = "fairy-rings:used";
const FAVOURITES_ATTRIBUTE = "fairy-rings:favourites";

/**
 * Zanaris' one-way exit rings by loc id. Lumbridge Swamp: rsprox capture 3173 (rev 232), the
 * fairy teleport to (3201,3169). Al Kharid: no capture; the landing tile is RuneLite's
 * transport data (plugins/agent/data/transports.json).
 */
let exitRings = new Map();
function loadExitRings(ids) {
  return new Map([
    [ids.FAIRY_RING_3, { code: null, destination: new Location(3201, 3169, 0) }], // fairy_mushroom_ring
    [ids.FAIRY_RING_2, { code: null, destination: new Location(3260, 3171, 0) }], // fairy_mushroom_ring3
  ]);
}

let core = null;
let pluginApi;
/** Players whose dials or warning close because they are going: busy stays set (as captured). */
const going = new WeakSet();
/** The ring each player configured, which Confirm steps onto. */
const configuredRing = new WeakMap();
/** code -> { code, destination, destinationId, index, logText, logComponent, starComponent } */
let rings = new Map();
let ringsByComponent = new Map();
const pendingTeleports = new WeakMap();

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

/** "fairy-rings:destinations" { list }: every combination with a destination, as { code, name, location } (a league relic's fairy mushroom). */
function destinationsEvent(request) {
  if (!Array.isArray(request?.list)) return;
  for (const ring of rings.values()) {
    if (!ring.destination) continue;
    const name = String(ring.logText).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    request.list.push({ code: ring.code, name, location: ring.destination });
  }
}

function codeList(player, attribute) {
  return String(player.getAttribute(attribute) ?? "").split(",").filter((code) => rings.has(code));
}

/** Wiki (Fairy ring): "If the elite Lumbridge & Draynor Diary is completed, no staff of either kind is needed." */
function eliteLumbridgeDiary(player) {
  const request = { player, diary: "lumbridge", tier: "elite", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function wieldsFairyMagic(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
  return weapon === core.ItemIdentifiers.DRAMEN_STAFF || weapon === core.ItemIdentifiers.LUNAR_STAFF || eliteLumbridgeDiary(player);
}

function questAllows(player) {
  const request = { player, allowed: true };
  pluginApi.emitCustomEvent("fairy-rings:access", request);
  return request.allowed === true;
}

/**
 * Codes whose destination needs a quest done (Wiki, Fairy ring: AJQ "Completion of Death to the Dorgeshuun is
 * required", BJS "Requires completion of the Regicide quest", CIP "...The Fremennik Trials quest", CLR "...the Monkey
 * Madness I quest", DLS "...the In Search of the Myreque quest"). The message is TSPS wording: the Wiki quotes none.
 */
const CODE_QUESTS = new Map([
  ["AJQ", { key: "death_to_the_dorgeshuun", name: "Death to the Dorgeshuun" }],
  ["BJS", { key: "regicide", name: "Regicide" }],
  ["CIP", { key: "fremennik_trials", name: "The Fremennik Trials" }],
  ["CLR", { key: "monkey_madness_i", name: "Monkey Madness I" }],
  ["DLS", { key: "in_search_of_the_myreque", name: "In Search of the Myreque" }],
]);

/** Set by the first quetzal flight to Civitas illa Fortis (plugins/world/quetzals/Primio.Quetzals.js). */
const VARLAMORE_VISITED_VARBIT = "varlamore_visited";
/** rsprox_transcripts/226/01695.txt:8854 (AJP before the first flight). */
const VARLAMORE_REFUSAL = "You can't use the fairy ring to go there until you have visited Varlamore.";

/**
 * Every locked code: a quest done, a quest stage reached, or Varlamore visited. Wiki (Fairy ring): AIS, AJP and CKQ
 * "Requires having travelled to Civitas illa Fortis via Regulus Cento"; AKP is "Unlocked by entering the Necropolis
 * in the beginning of Beneath Cursed Sands"; BJR and BLQ need "partial completion" of Holy Grail and Land of the
 * Goblins. The stages are TSPS choices (the Wiki names none): Beneath Cursed Sands' entry to the Necropolis (14), Land
 * of the Goblins' arrival in Yu'biusk (52) and Holy Grail from speaking to the crone (4), when the Fisher Realm opens.
 * Their messages are TSPS wording in the recorded Varlamore line's style.
 */
const CODE_LOCKS = new Map([
  ...[...CODE_QUESTS].map(([code, quest]) => [code, {
    complete: quest.key, message: `You need to complete ${quest.name} to travel there.`,
  }]),
  ...["AIS", "AJP", "CKQ"].map((code) => [code, { varbit: VARLAMORE_VISITED_VARBIT, message: VARLAMORE_REFUSAL }]),
  ["AKP", { stage: { key: "beneath_cursed_sands", min: 14 },
    message: "You can't use the fairy ring to go there until you have visited the Necropolis." }],
  ["BLQ", { stage: { key: "land_of_the_goblins", min: 52 },
    message: "You can't use the fairy ring to go there until you have visited Yu'biusk." }],
  ["BJR", { stage: { key: "holy_grail", min: 4 },
    message: "You can't use the fairy ring to go there until you have visited the Fisher King's realm." }],
]);

/** The refusal for a code the player hasn't unlocked, or null. */
function codeLockRefusal(player, code) {
  const lock = CODE_LOCKS.get(code);
  if (!lock) return null;
  if (lock.complete) {
    const query = { player, key: lock.complete, complete: false };
    pluginApi.emitCustomEvent("quest:is-complete", query);
    return query.complete === true ? null : lock.message;
  }
  if (lock.stage) {
    const query = { player, key: lock.stage.key, stage: undefined };
    pluginApi.emitCustomEvent("quest:get-stage", query);
    return Number(query.stage) >= lock.stage.min ? null : lock.message;
  }
  const id = core.CacheDefinitions.getVarbitId(lock.varbit);
  return id != null && player.getPacketSender().getVarbit(id) > 0 ? null : lock.message;
}

/** Content can resolve a code differently without changing the cache's ordinary destination. */
function resolveRing(player, ring, origin) {
  if (!ring) return null;
  const request = { player, code: ring.code, destination: ring.destination, origin };
  pluginApi.emitCustomEvent("fairy-rings:destination", request);
  return request.destination ? { ...ring, destination: request.destination } : null;
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

/**
 * The 10 favourite slots, in order, "" where empty. A removed favourite leaves its slot empty and
 * the next one added fills the first empty slot.
 */
function favouriteSlots(player) {
  const saved = String(player.getAttribute(FAVOURITES_ATTRIBUTE) ?? "").split(",");
  const slots = Array.from({ length: MAX_FAVOURITES }, (_, slot) => (rings.has(saved[slot]) ? saved[slot] : ""));
  return slots.map((code, slot) => (code && slots.indexOf(code) === slot ? code : ""));
}

function saveFavourites(player, slots) {
  player.setAttribute(FAVOURITES_ATTRIBUTE, slots.join(",").replace(/,+$/, ""));
}

/** A code as the travel log and its messages write it: "A K R". */
function spacedCode(code) {
  return code.split("").join(" ");
}

function sendFavouriteVarbits(player, slots = favouriteSlots(player)) {
  const sender = player.getPacketSender();
  let filled = 0;
  slots.forEach((code, slot) => {
    const ring = rings.get(code);
    sender.sendVarbit(FAVOURITE_VARBITS[slot], ring ? FAVOURITE_SET + ring.index : 0);
    if (ring) filled |= 1 << slot;
  });
  sender.sendVarbit(FAVOURITE_OPVIS_VARBIT, filled);
}

function sendFavourites(player, slots) {
  const sender = player.getPacketSender();
  slots.forEach((code, slot) => {
    const ring = rings.get(code);
    sender.sendString(ring?.logText ?? "", (LOG_INTERFACE << 16) | (FAVOURITE_TEXT + slot));
    sender.sendString(ring ? spacedCode(ring.code) : "", (LOG_INTERFACE << 16) | (FAVOURITE_CODE_TEXT + slot));
  });
}

/** The used codes, less the favourites (shown in their own slots instead), the hideout and the favourites. */
function sendTravelLog(player) {
  const sender = player.getPacketSender();
  const slots = favouriteSlots(player);
  const used = new Set(codeList(player, USED_CODES_ATTRIBUTE));
  for (const ring of rings.values()) {
    if (ring.logComponent <= 0) continue;
    const shown = used.has(ring.code) && !slots.includes(ring.code);
    sender.sendString(shown ? ring.logText : "", (LOG_INTERFACE << 16) | ring.logComponent);
  }
  sender.sendString(HIDEOUT_TEXT, (LOG_INTERFACE << 16) | HIDEOUT_COMPONENT);
  sendFavourites(player, slots);
}

/** The modal background, the dials on the main modal and the travel log beside them. */
function openDialInterfaces(player) {
  player.getPacketSender()
    .sendClientScript(MODAL_BACKGROUND_SCRIPT, ...MODAL_BACKGROUND)
    .sendInterface(DIALS_INTERFACE)
    .sendSubInterface(SIDE_MODAL, LOG_INTERFACE, 3);
}

/**
 * After a favourite is added or removed: the log's text again, both interfaces reopened (the log
 * lays its rows out as it opens) and its search box closed.
 */
function refreshTravelLog(player) {
  sendTravelLog(player);
  openDialInterfaces(player);
  player.getPacketSender().sendClientScript(MESLAYER_CLOSE_SCRIPT, SEARCH_MESLAYER);
}

/** "Use code": the dials turn to the code. */
function useCode(player, code) {
  player.getPacketSender().sendSoundEffect(USE_CODE_SOUND, 1, 0, 1);
  setDials(player, code);
}

function ringTile(location) {
  return location ? new Location(location.x, location.y, location.z) : null;
}

function locationSnapshot(player) {
  const location = player.getLocation?.();
  if (!location) return null;
  return new Location(location.getX(), location.getY(), location.getZ());
}

function sameTile(left, right) {
  return left && right && left.getX() === right.getX() && left.getY() === right.getY() && left.getZ() === right.getZ();
}

function cancelPendingTeleport(player, pending = pendingTeleports.get(player)) {
  if (!pending) return false;
  pending.cancelled = true;
  if (pendingTeleports.get(player) !== pending) return false;
  pendingTeleports.delete(player);
  return true;
}

/** OSRS sets busy the tick after the dials open (not on a dial click). */
function openDial({ player, location }) {
  if (!player || !canUse(player)) return;
  configuredRing.set(player, ringTile(location));
  setDials(player, "");
  sendTravelLog(player);
  openDialInterfaces(player);
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

/** The last destination, as OSRS sends it: the ring's "Last-destination" goes there. */
function sendLastDestination(player, ring) {
  player.getPacketSender()
    .sendConfig(DESTINATION_VARP, ring.destinationId)
    .sendVarbit(LAST_LOCATION_VARBIT, ring.index)
    .sendVarbit(LAST_LOCATION_OP_VARBIT, LAST_LOCATION_OP_VISIBLE + ring.index);
}

function rememberUse(player, ring) {
  if (!ring.code) return;
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
/**
 * Wiki (Fairy ring): a code "that has no corresponding fairy ring or is a fairy ring the player is already located
 * in" teleports nowhere, the player "exclaiming 'Wow, fairy magic sure is useful, I hardly moved at all!'". Recorded
 * (rsprox_transcripts/227/00075.txt:76640-76680, 227/00555.txt:57192): the teleport onto the ring's arrival tile with
 * the appear animation, then on the next tick that line as the player's chathead (chatneu1, 588).
 */
const HARDLY_MOVED = "Wow, fairy magic sure is useful, I hardly moved at all!";
const HARDLY_MOVED_EXPRESSION = 588;

function fairyTeleport(player, ring, from, fromClick) {
  const sender = player.getPacketSender();
  const onRing = !from || from.equals(player.getLocation());
  const origin = locationSnapshot(player);
  const privateArea = player.getPrivateArea?.() ?? null;
  const teleportSerial = player.getTeleportSerial?.();
  if (!onRing) stepOntoRing(player, from);
  const expectedTile = locationSnapshot(player);
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
  const pending = { cancelled: false };
  cancelPendingTeleport(player);
  pendingTeleports.set(player, pending);
  const stillValid = () => !pending.cancelled && pendingTeleports.get(player) === pending &&
    (pending.landed || (player.isRegistered() && player.getHitpoints?.() > 0 && !player.isDyingReturn?.() &&
      player.getTeleportSerial?.() === teleportSerial &&
      (player.getPrivateArea?.() ?? null) === privateArea && sameTile(locationSnapshot(player), expectedTile)));
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      tick++;
      if (!stillValid()) {
        const ownsPending = cancelPendingTeleport(player, pending);
        if (ownsPending && player.isRegistered()) sender.sendVarbit(BUSY_VARBIT, 0);
        this.stop();
        return;
      }
      if (tick === delay) vanish();
      if (tick === delay + 3) {
        if (sameRing) {
          if (!sameTile(locationSnapshot(player), ring.destination)) player.moveTo(ring.destination);
          pending.landed = true;
          if (!ring.invalid && !ring.refusal) rememberUse(player, ring);
        } else {
          const teleportFrom = locationSnapshot(player);
          const fromInstance = privateArea != null;
          player.moveTo(ring.destination);
          const landed = player.getLocation?.();
          const arrived = landed && landed.getX() === ring.destination.getX() &&
            landed.getY() === ring.destination.getY() && landed.getZ() === ring.destination.getZ() &&
            teleportFrom && !sameTile(landed, teleportFrom) &&
            player.getTeleportSerial?.() === (teleportSerial === undefined ? undefined : teleportSerial + 1) &&
            (player.getPrivateArea?.() ?? null) === privateArea && player.getHitpoints?.() > 0 &&
            !player.isDyingReturn?.() && player.isRegistered();
          if (!arrived) {
            const ownsPending = cancelPendingTeleport(player, pending);
            if (ownsPending && player.isRegistered()) sender.sendVarbit(BUSY_VARBIT, 0);
            this.stop();
            return;
          }
          pending.landed = true;
          // Emit arrival only after the player reaches the requested tile.
          core.PluginManager?.emitCustomEvent?.("teleport:landed", {
            player, from: origin, fromInstance, to: landed, source: "fairy-ring", code: ring.code,
          });
          rememberUse(player, ring);
        }
        if (!ring.refusal) {
          pluginApi.emitCustomEvent("fairy-rings:travelled", { player, code: ring.code, destination: player.getLocation() });
        }
        player.performAnimation(new core.Animation(APPEAR_ANIMATION));
      }
      if (tick === delay + 4) {
        sender.sendVarbit(BUSY_VARBIT, 0);
        player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
        cancelPendingTeleport(player, pending);
        this.stop();
        if (ring.refusal) {
          refusalBox(player, ring.refusal);
        } else if (sameRing) {
          player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
            .add(new core.PlayerDialogue(0, HARDLY_MOVED, HARDLY_MOVED_EXPRESSION)));
        }
      }
    }
  })());
}

/** The refusal's mesbox, logged as a mesbox chat line too (as recorded). */
function refusalBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** The ring at a configured tile: the one whose arrival tile is on or beside it. */
function ringAt(from) {
  return from ? [...rings.values()].find((candidate) => candidate.destination?.getDistance(from) <= 1) ?? null : null;
}

/**
 * A locked code (rsprox_transcripts/226/01695.txt:8805-8865, AJP before the first visit to Varlamore): the code
 * becomes the last destination, the fairy teleport plays back onto the player's own ring and, on arrival, a mesbox
 * says why. Nothing goes in the travel log. A ring with no arrival tile of its own in the cache (the withered Fisher
 * Realm's) lands on the ring's tile. Returns false when the teleport checks stop it.
 */
function refuseLockedCode(player, ring, from, fromClick, message) {
  const back = ringAt(from)?.destination ?? from ?? null;
  if (!core.TeleportHandler.checkReqs(player, back ?? locationSnapshot(player), 20)) return false;
  sendLastDestination(player, ring);
  player.setAttribute(LAST_CODE_ATTRIBUTE, ring.code);
  if (!back) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    refusalBox(player, message);
    return true;
  }
  fairyTeleport(player, { ...ring, destination: back, refusal: message }, from, fromClick);
  return true;
}

function playerDied({ player }) {
  if (!player) return;
  const pending = pendingTeleports.get(player);
  if (cancelPendingTeleport(player, pending) && player.isRegistered()) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
  }
}

/** A light source keeps AJQ's dark-cave warning away. */
function hasLightSource(player) {
  const lit = (item) => {
    const name = item?.getId?.() > 0 ? core.ItemDefinition.forId(item.getId())?.getName?.() ?? "" : "";
    return /^lit |\(lit\)$|^bullseye lantern|^kandarin headgear [2-4]/i.test(name);
  };
  // The Firemaking cape (and max capes) light from the inventory too: asked of the Skillcapes plugin.
  const cape = { player, skill: "FIREMAKING", inventory: true, result: false };
  core.PluginManager.emitCustomEvent("skillcape:has-perk", cape);
  return cape.result === true || [...player.getInventory().getItems(), ...player.getEquipment().getItems()].some(lit);
}

function confirmDial(player) {
  if (!canUse(player)) return;
  const ring = resolveRing(player, rings.get(codeFromDials(player)), configuredRing.get(player));
  if (!ring?.destination) {
    pluginApi.emitCustomEvent("fairy-rings:invalid", { player, code: codeFromDials(player) });
    // The ring being used, as its own destination: the same "hardly moved" outcome (Wiki).
    const from = configuredRing.get(player);
    const here = ringAt(from);
    if (!here) {
      player.sendMessage("The fairy ring combination is not a valid destination.");
      return;
    }
    closeDials(player, true);
    if (!core.TeleportHandler.checkReqs(player, here.destination, 20)) {
      player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
      return;
    }
    fairyTeleport(player, { ...here, invalid: true }, from, true);
    return;
  }
  // The open dials count as busy for the teleport checks, so they close first.
  closeDials(player, true);
  const sender = player.getPacketSender();
  const locked = codeLockRefusal(player, ring.code);
  if (locked) {
    if (!refuseLockedCode(player, ring, configuredRing.get(player), true, locked)) sender.sendVarbit(BUSY_VARBIT, 0);
    return;
  }
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

/**
 * Travel log clicks: use a code, add or remove a favourite. The text rows have op1 "Use code" and
 * op2 "Add Favourite"/"Remove Favourite" (rev 241 fairyrings_log); the stars have only the favourite
 * op. Decided from the op: IF_BUTTON packets carry no menu text.
 */
function logAction(player, childId, op) {
  const slots = favouriteSlots(player);
  const favouriteSlot = childId >= FAVOURITE_TEXT && childId < FAVOURITE_TEXT + MAX_FAVOURITES
    ? childId - FAVOURITE_TEXT
    : FAVOURITE_STARS.indexOf(childId);
  if (favouriteSlot >= 0) {
    if (!slots[favouriteSlot]) return;
    if (op === LOG_FAVOURITE_OP || FAVOURITE_STARS.includes(childId)) {
      slots[favouriteSlot] = "";
      saveFavourites(player, slots);
      sendFavouriteVarbits(player, slots);
      refreshTravelLog(player);
    } else {
      useCode(player, slots[favouriteSlot]);
    }
    return;
  }
  if (childId === HIDEOUT_COMPONENT) {
    useCode(player, HIDEOUT_CODE);
    return;
  }
  const ring = ringsByComponent.get(childId);
  if (!ring) return;
  const adding = op === LOG_FAVOURITE_OP || childId === ring.starComponent;
  if (!adding) {
    useCode(player, ring.code);
    return;
  }
  if (slots.includes(ring.code)) return;
  const free = slots.indexOf("");
  if (free < 0) {
    // Ours: the line when all 10 slots are full.
    player.sendMessage("You can't have more than 10 favourite fairy ring codes.");
    return;
  }
  slots[free] = ring.code;
  saveFavourites(player, slots);
  player.sendMessage(`Added ${spacedCode(ring.code)} to your favourites.`);
  sendFavouriteVarbits(player, slots);
  refreshTravelLog(player);
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
    logAction(player, childId, event.action ?? event.opId);
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
  const ring = resolveRing(player, rings.get(String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? "")), ringTile(location));
  if (!ring?.destination) {
    player.sendMessage("You haven't used the fairy ring teleportation system yet.");
    return;
  }
  const locked = codeLockRefusal(player, ring.code);
  if (locked) {
    refuseLockedCode(player, ring, ringTile(location), false, locked);
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

/** "Use" on a Zanaris exit ring: the fairy teleport out, needing neither staff nor quest. */
function useExitRing({ player, objectId, location }) {
  const ring = exitRings.get(objectId);
  if (!player || !ring) return;
  if (!core.TeleportHandler.checkReqs(player, ring.destination, 20)) return;
  fairyTeleport(player, ring, ringTile(location), false);
}

/**
 * The ring's "Favourites" picks a favourite from its sub-menu; chosen without one (the option
 * itself), it only says so.
 */
function favouritesOption({ player }) {
  if (!player) return;
  player.sendMessage("You will need to select a favourite from the sub-menu.");
}

/** At login: the last destination and the favourite slots. */
function sendLastOnLogin({ player }) {
  const ring = rings.get(String(player.getAttribute(LAST_CODE_ATTRIBUTE) ?? ""));
  if (ring) sendLastDestination(player, ring);
  const slots = favouriteSlots(player);
  if (slots.some(Boolean)) sendFavouriteVarbits(player, slots);
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  rings = loadRings();
  exitRings = loadExitRings(core.ObjectIdentifiers);
  ringsByComponent = new Map();
  for (const ring of rings.values()) {
    if (ring.logComponent > 0) ringsByComponent.set(ring.logComponent, ring);
    if (ring.starComponent > 0) ringsByComponent.set(ring.starComponent, ring);
  }
}

/** Monsters cannot attack a player standing in the centre of a fairy ring (Wiki: Fairy ring). */
function protectRingCentre(event) {
  const { attacker, target } = event ?? {};
  if (!attacker?.isNpc?.() || !target?.isPlayer?.()) return;
  const location = target.getLocation?.();
  if (!location) return;
  if ([...rings.values()].some((ring) => ring.destination?.equals?.(location))) event.allow = false;
}

/** The rings' options, as the cache names them (op 3 is a plain "Last-destination", not a multiloc). */
function ringOptions() {
  return {
    Zanaris: zanaris, Configure: openDial, "Last-destination": lastDestination, Favourites: favouritesOption, Use: useExitRing,
  };
}

module.exports = {
  name: "FairyRings",
  description: "Fairy rings: the three-dial interface for all 64 codes, travel log with favourites, last-destination, quest-gated rings and the Zanaris exit rings.",
  members: true,
  _test: {
    loadRings,
    codeFromDials,
    setDials,
    canUse,
    openDial,
    confirmDial,
    lastDestination,
    useExitRing,
    interfaceAction,
    interfaceClosed,
    hasLightSource,
    playerDied,
    ringOptions,
    sendLastOnLogin,
    rings: () => rings,
    FAVOURITE_VARBITS,
    FAVOURITE_OPVIS_VARBIT,
    USE_CODE_SOUND,
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
    api.onCanAttack(protectRingCentre);
    api.onObjectInteraction("Fairy ring", ringOptions());
    api.onInterfaceActionClick(interfaceAction);
    api.onCustomEvent("interface:closed", interfaceClosed);
    api.onPlayerDeath?.(playerDied);
    api.onCustomEvent("fairy-rings:configure", openDial);
    api.onCustomEvent("fairy-rings:zanaris", zanaris);
    api.onCustomEvent("fairy-rings:last-destination", lastDestination);
    api.onCustomEvent("fairy-rings:destinations", destinationsEvent);
    api.onPlayerLogin(sendLastOnLogin);
    api.log("registered", { rings: rings.size });
  },
};
