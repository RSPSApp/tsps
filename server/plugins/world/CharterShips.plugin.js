/**
 * Charter ships (https://oldschool.runescape.wiki/w/Charter_ship), as live OSRS runs them in
 * rsprox recordings 230/350, 234/3276, 235/960, 235/3426, 235/3834, 237/1098, 237/1103 and
 * 237/1105:
 *
 * - Trader Stan and his crew are multi-NPCs on varbit chartering_previous_destination: Talk-to,
 *   Trade, Charter, and once a trip has been made "Charter-to <the last destination>" (op5).
 * - Charter opens the map (sailing_menu) in the main modal with its destination list
 *   (chartering_menu_side) in the side modal. Their client scripts draw one marker and one list
 *   row per row of cache table chartering_destinations, so a click comes back as
 *   sailing_menu:content sub 2k+1 or chartering_menu_side:list_content sub 2k for row k.
 *   The scripts hide the player's current port (the row whose inzone box holds them) and every
 *   destination script 9104 rules out; `available` is that script.
 * - Choosing a port asks "Sail to X for N coins?" unless the warning is off
 *   (settings_warning_confirmation_charter_ships); without the fare it says what it costs and
 *   offers only Choose again / Cancel. The trip takes the coins, closes the map, plays jingle
 *   171 and fades out; the minimap goes a tick later, the player lands on the ship's deck (the
 *   row's port_coord) on the third tick, the screen fades back in on the fourth and the overlay
 *   closes on the sixth. The gangplank (Ladders) takes them ashore.
 * - A voyage is cut short by any teleport but its own landing, by logout and by death; a dying
 *   passenger stays where they fell and keeps the death's movement lock.
 *
 * Fares are not in the cache (chartering_costs is empty): data/charter-ships.json is the Wiki's
 * directed fare table. A worn ring of charos(a) and Cabin Fever each halve a fare; the table's
 * Mos Le'Harmless fares already include Cabin Fever. The rum and bedsheet refusals are the
 * Trader Crewmember and Trader Stan transcripts' own lines.
 */
const fs = require("fs");
const path = require("path");

const TABLE = "chartering_destinations";
const ROW_PREFIX = "chartering_destination_";
const MAP_INTERFACE = "sailing_menu";
const MAP_MARKERS = "sailing_menu:content";
const SIDE_INTERFACE = "chartering_menu_side";
const SIDE_LIST = "chartering_menu_side:list_content";
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const SIDE_MODAL_TYPE = 3;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const MODAL_BACKGROUND_SCRIPT = 917;
const MODAL_BACKGROUND = [-1, -1];
/** Interface event flags: op1 on every marker and list slot, two per table row. */
const OP1_FLAGS = 1 << 1;
const SLOTS_PER_ROW = 2;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const SAIL_JINGLE = 171;
const MINIMAP_OFF = 2;
const MINIMAP_TICKS = 1;
const LAND_TICKS = 3;
const FADE_IN_TICKS = 4;
const CLOSE_OVERLAY_TICKS = 6;

const PREVIOUS_DESTINATION_VARBIT = "chartering_previous_destination";
const CONFIRM_WARNING_VARBIT = "settings_warning_confirmation_charter_ships";
const SAILING_CONTENT_VARBIT = "content_restrict_sailing_serverside";
const MINIMAP_STATE_VARBIT = "minimap_state";
const BUSY_VARBIT = "busy";
const PREVIOUS_DESTINATION_ATTRIBUTE = "charter-ships:previous-destination";
const SKIP_CONFIRMATION_ATTRIBUTE = "charter-ships:skip-confirmation";

const CABIN_FEVER = "cabin_fever";
const TRADING_POST_SHOP_ID = 1354; // shops.json "Trader Stan's Trading Post"
const TRADERS = ["Trader Crewmember", "Trader crewmember", "Trader Stan"];
const CHARTER_TO = "Charter-to ";
const CURRENT_PORT_VARIANT = "right-click-charter-to-current-location";
const RUM_OBJS = ["karamja_rum", "tbwt_banana_in_karamja_rum", "tbwt_sliced_banana_in_karamja_rum"];
const BEDSHEET_OBJ = "ahoy_bedsheet";
const ECTO_BEDSHEET_OBJ = "ahoy_bedsheetgreen";

/**
 * Client script 9104 (port, destination) by row: what the destination needs, and the ports it
 * can't be reached from. Tempestus and Barracuda HQ are never offered; Crandor only during
 * Dragon Slayer I, where the crew refuse it.
 */
const RULES = {
  portsarim: { notFrom: ["musapoint", "pandemonium", "piscarilius", "landsend"] },
  mosleharmless: { needs: [{ varp: "fever_quest", min: 140 }, { varp: "priestperil", min: 61 }], notFrom: ["portphasmatys"] },
  musapoint: { notFrom: ["portsarim", "pandemonium"] },
  portphasmatys: { needs: [{ varp: "priestperil", min: 61 }], notFrom: ["mosleharmless"] },
  shipyard: { needs: [{ varp: "mm_main", min: 2 }, { varp: "grandtree", min: 160 }] },
  porttyras: { needs: [{ varp: "regicide_quest", min: 15 }] },
  prifddinas: { needs: [{ varbit: "sote", min: 200 }] },
  piscarilius: { needs: [{ varbit: "zeah_playerhasvisited", min: 1 }], notFrom: ["portsarim", "landsend"] },
  landsend: { needs: [{ varbit: "zeah_playerhasvisited", min: 1 }], notFrom: ["portsarim", "piscarilius"] },
  fortis: { needs: [{ varbit: "varlamore_visited", min: 1 }] },
  aldarin: { needs: [{ varbit: "varlamore_visited", min: 1 }], notFrom: ["sunsetcoast"] },
  sunsetcoast: { needs: [{ varbit: "varlamore_visited", min: 1 }], notFrom: ["aldarin"] },
  tempestus: { never: true },
  crandor: { needs: [{ varp: "dragonquest", min: 2, max: 9 }] },
  pandemonium: { needs: [{ varbit: "sailing_intro", min: 16 }], notFrom: ["portsarim", "musapoint"] },
  summer_shore: { needs: [{ varbit: "tt", min: 12 }] },
  red_rock: { needs: [{ varbit: "trr", min: 12 }] },
  barracuda_hq: { never: true },
  deepfin_point: { needs: [{ varbit: "deepfin_point_visited", min: 1 }] },
  port_roberts: { needs: [{ varbit: "port_roberts_visited", min: 1 }] },
};
const CRANDOR = "crandor";

let core = null;
let pluginApi = null;
let rows = null;
let fareData = null;
/** Each player's voyage under way ({ landing }); a second trip waits until it ends. */
const voyages = new WeakMap();
/** The trader each player is chartering with ({ npc, npcId }), for their lines. */
const traders = new WeakMap();

function loadFares() {
  const file = path.join(__dirname, "data", "charter-ships.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return { fares: data.fares ?? {}, cabinFeverIncluded: new Set(data.cabinFeverIncluded ?? []) };
}

function fares() {
  fareData ??= loadFares();
  return fareData;
}

function coord(packed) {
  return { x: (packed >>> 14) & 0x3fff, y: packed & 0x3fff, z: (packed >>> 28) & 0x3 };
}

/** The table's rows in row order, as the client scripts walk them. */
function destinations() {
  if (rows) return rows;
  const { CacheDefinitions } = core;
  const table = CacheDefinitions.getDbTableId(TABLE);
  const column = (name) => CacheDefinitions.getDbColumn(table, name);
  const [id, name, inlineName, port, zone, restricted] = [
    column(`${ROW_PREFIX}id`), column(`${ROW_PREFIX}name`), column(`${ROW_PREFIX}inline_name`),
    column(`${ROW_PREFIX}port_coord`), column(`${ROW_PREFIX}inzone`), column("restricted_content"),
  ];
  rows = CacheDefinitions.getDbTableRows(table).map((row, index) => {
    const [low, high] = row.column(zone).map((value) => coord(Number(value)));
    return {
      index,
      slug: String(CacheDefinitions.getDbRowName(row.id) ?? "").slice(ROW_PREFIX.length),
      id: row.int(id),
      name: row.string(name),
      inlineName: row.string(inlineName) || row.string(name),
      deck: row.int(port) ? coord(row.int(port)) : null,
      zone: low && high && (low.x || high.x) ? { low, high } : null,
      restricted: row.int(restricted) === 1,
    };
  });
  return rows;
}

function rowBySlug(slug) {
  return destinations().find((row) => row.slug === slug) ?? null;
}

function varbit(player, name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  return id == null ? 0 : player.getPacketSender().getVarbit(id);
}

function setVarbit(player, name, value) {
  const id = core.CacheDefinitions.getVarbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

function varp(player, name) {
  const id = core.CacheDefinitions.getVarpId(name);
  return id == null ? 0 : player.getPacketSender().getVarp(id);
}

/** Client script 7334: the port whose zone holds the tile, or null. */
function portAt(location) {
  if (!location?.getX) return null;
  const [x, y, z] = [location.getX(), location.getY(), location.getZ?.() ?? 0];
  return destinations().find(({ zone }) => zone && z === zone.low.z
    && x >= zone.low.x && x <= zone.high.x && y >= zone.low.y && y <= zone.high.y) ?? null;
}

function meets(player, need) {
  const value = need.varp ? varp(player, need.varp) : varbit(player, need.varbit);
  return value >= need.min && (need.max == null || value <= need.max);
}

/** Client script 9104: whether the map offers `destination` from `port`. */
function available(player, port, destination) {
  if (!destination) return false;
  if ((port?.restricted || destination.restricted) && varbit(player, SAILING_CONTENT_VARBIT) !== 1) return false;
  const rule = RULES[destination.slug] ?? {};
  if (rule.never) return false;
  if (port && rule.notFrom?.includes(port.slug)) return false;
  return (rule.needs ?? []).every((need) => meets(player, need));
}

function wearingCharosRing(player) {
  const ringId = Number(player.getEquipment?.()?.get?.(core.Equipment.RING_SLOT)?.getId?.() ?? -1);
  return ringId === core.ItemIdentifiers.RING_OF_CHAROS_A_;
}

function questComplete(player, key) {
  const request = { player, key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** The Wiki fare from one port to another, before discounts; null without a route. */
function fareBetween(from, to) {
  const fare = fares().fares[`${from}|${to}`];
  return Number.isFinite(fare) ? fare : null;
}

/** Wiki: a ring of charos(a) or Cabin Fever halves the fare, both quarter it. */
function fareFor(player, port, destination) {
  const base = port && destination ? fareBetween(port.name, destination.name) : null;
  if (base == null) return null;
  let multiplier = 1;
  if (wearingCharosRing(player)) multiplier /= 2;
  const included = fares().cabinFeverIncluded;
  if (!included.has(port.name) && !included.has(destination.name) && questComplete(player, CABIN_FEVER)) multiplier /= 2;
  return Math.floor(base * multiplier);
}

function formatCoins(amount) {
  return amount.toLocaleString("en-US");
}

function hasAny(player, names) {
  const inventory = player.getInventory();
  return names.some((name) => {
    const id = core.CacheDefinitions.getObjId(name);
    return id != null && inventory.contains(id);
  });
}

/** What a refusal condition in the traders' transcripts is about, by its prose. */
function refusalCarried(player, text) {
  const value = String(text).toLowerCase();
  if (value.includes("does not have")) return null;
  if (value.includes("ectoplasm")) return hasAny(player, [ECTO_BEDSHEET_OBJ]);
  if (value.includes("bedsheet")) return hasAny(player, [BEDSHEET_OBJ]);
  if (value.includes("rum")) return hasAny(player, RUM_OBJS);
  return null;
}

function carriesRefused(player) {
  return hasAny(player, [...RUM_OBJS, BEDSHEET_OBJ, ECTO_BEDSHEET_OBJ]);
}

/** The first condition in the steps (depth first) whose test passes. */
function findCondition(steps, test) {
  for (const step of steps ?? []) {
    if (step?.type === "condition" && test(step)) return step;
    for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
      const found = findCondition(nested, test);
      if (found) return found;
    }
  }
  return null;
}

/** The trader as this player sees them: the multi-NPC's variant carries the name and lines. */
function traderOf(event) {
  return { npc: event.npc ?? null, npcId: event.definition?.getId?.() ?? event.npcId ?? event.npc?.getId?.() };
}

/** Plays the trader's lines from the transcript condition `test` picks; false if none played. */
function playCondition(player, trader, test) {
  const request = {
    player,
    npc: trader?.npc ?? null,
    npcId: trader?.npcId,
    select: (steps) => findCondition(steps, test)?.steps ?? [],
    handled: false,
  };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

/** Rum or a bedsheet stops a charter with the trader's own refusal. */
function refuseCargo(player, trader) {
  if (!carriesRefused(player)) return false;
  return playCondition(player, trader, (step) => refusalCarried(player, step.text) === true);
}

function sendFade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function mapInterface() {
  return core.CacheDefinitions.getInterfaceId(MAP_INTERFACE);
}

function openMap(player) {
  if (voyages.has(player)) return;
  const sender = player.getPacketSender();
  // The server has Sailing, so the six Sailing ports are on the map.
  setVarbit(player, SAILING_CONTENT_VARBIT, 1);
  const markers = core.CacheDefinitions.getComponentId(MAP_MARKERS);
  const list = core.CacheDefinitions.getComponentId(SIDE_LIST);
  const last = destinations().length * SLOTS_PER_ROW - 1;
  sender.sendClientScript(MODAL_BACKGROUND_SCRIPT, ...MODAL_BACKGROUND);
  sender.sendInterface(mapInterface());
  sender.sendSubInterface(SIDE_MODAL, core.CacheDefinitions.getInterfaceId(SIDE_INTERFACE), SIDE_MODAL_TYPE);
  sender.sendInterfaceFlagsRange(markers, 0, last, OP1_FLAGS);
  sender.sendInterfaceFlagsRange(list, 0, last, OP1_FLAGS);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      this.stop();
      if (player.getInterfaceId?.() === mapInterface()) setVarbit(player, BUSY_VARBIT, 1);
    }
  })());
}

function closeMap(player) {
  player.getPacketSender().closeSubInterface(SIDE_MODAL);
  player.getPacketSender().sendInterfaceRemoval();
}

function setPreviousDestination(player, destination) {
  player.setAttribute(PREVIOUS_DESTINATION_ATTRIBUTE, destination.id);
  setVarbit(player, PREVIOUS_DESTINATION_VARBIT, destination.id);
}

function dying(player) {
  return player.isDyingReturn?.() === true;
}

/**
 * Ends a voyage that did not arrive: the minimap and screen come back, and the voyage's lock is
 * freed - unless the passenger is dying, whose lock belongs to their death.
 */
function cancelVoyage(player) {
  if (!voyages.delete(player)) return;
  setVarbit(player, MINIMAP_STATE_VARBIT, 0);
  setVarbit(player, BUSY_VARBIT, 0);
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  if (!dying(player)) player.getMovementQueue().setBlockMovement(false);
}

/** Any teleport but the voyage's own landing ends it, wherever it sends the passenger. */
function voyageInterrupted(mobile) {
  const voyage = mobile.isPlayer?.() ? voyages.get(mobile) : undefined;
  if (voyage && !voyage.landing) cancelVoyage(mobile);
}

/**
 * The captured trip: pay, fade out, land on the deck on the third tick, fade back in. Its ticks
 * act only while the voyage is still the player's own and they are alive and logged in.
 */
function sail(player, destination, fare) {
  if (voyages.has(player)) return;
  const inventory = player.getInventory();
  if (inventory.getAmount(core.ItemIdentifiers.COINS) < fare) {
    offerFare(player, destination, fare);
    return;
  }
  const voyage = { landing: false, from: portAt(player.getLocation()) };
  voyages.set(player, voyage);
  setPreviousDestination(player, destination);
  inventory.deleteNumber(core.ItemIdentifiers.COINS, fare);
  inventory.refreshItems?.();
  const sender = player.getPacketSender();
  sender.sendTypedMessage(core.ChatType.SPAM, `You pay ${formatCoins(fare)} coins and sail to ${destination.inlineName}.`);
  sender.sendJingle(SAIL_JINGLE, 0);
  sendFade(player, true);
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      if (voyages.get(player) !== voyage) {
        this.stop();
        return;
      }
      if (!player.isRegistered()) {
        voyages.delete(player);
        this.stop();
        return;
      }
      if (dying(player)) {
        cancelVoyage(player);
        this.stop();
        return;
      }
      tick++;
      if (tick === MINIMAP_TICKS) {
        setVarbit(player, MINIMAP_STATE_VARBIT, MINIMAP_OFF);
        setVarbit(player, BUSY_VARBIT, 1);
      }
      if (tick === LAND_TICKS) {
        voyage.landing = true;
        player.moveTo(new core.Location(destination.deck.x, destination.deck.y, destination.deck.z));
        voyage.landing = false;
        pluginApi.emitCustomEvent("charter-ships:arrived", { player, from: voyage.from, to: destination });
      }
      if (tick === FADE_IN_TICKS) {
        setVarbit(player, MINIMAP_STATE_VARBIT, 0);
        setVarbit(player, BUSY_VARBIT, 0);
        movement.setBlockMovement(false);
        sendFade(player, false);
      }
      if (tick >= CLOSE_OVERLAY_TICKS) {
        sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
        voyages.delete(player);
        this.stop();
      }
    }

    /** Stopped from outside while still under way, the voyage is cancelled, not landed. */
    stop() {
      if (voyages.get(player) === voyage) cancelVoyage(player);
      super.stop();
    }
  })());
}

function skipConfirmation(player) {
  return player.getAttribute(SKIP_CONFIRMATION_ATTRIBUTE) === true;
}

/** Live's prompts: the fare question, or (short of coins) just what it costs. */
function offerFare(player, destination, fare) {
  const cancel = () => setVarbit(player, BUSY_VARBIT, 0);
  const chooseAgain = () => openMap(player);
  if (player.getInventory().getAmount(core.ItemIdentifiers.COINS) < fare) {
    pluginApi.sendMultiChatboxPrompt(player, `Sailing to ${destination.name} costs ${formatCoins(fare)} coins.`,
      "Choose again", chooseAgain,
      "Cancel", cancel);
    return;
  }
  if (skipConfirmation(player)) {
    sail(player, destination, fare);
    return;
  }
  pluginApi.sendMultiChatboxPrompt(player, `Sail to ${destination.name} for ${formatCoins(fare)} coins?`,
    "Yes.", () => sail(player, destination, fare),
    "Choose again.", chooseAgain,
    "Yes, and don't ask again.", () => {
      player.setAttribute(SKIP_CONFIRMATION_ATTRIBUTE, true);
      setVarbit(player, CONFIRM_WARNING_VARBIT, 1);
      sail(player, destination, fare);
    },
    "Cancel.", cancel);
}

/** A destination picked on the map or list, or by Charter-to. */
function choose(player, destination) {
  if (voyages.has(player) || !destination) return false;
  const trader = traders.get(player) ?? null;
  const port = portAt(player.getLocation()) ?? portAt(trader?.npc?.getLocation?.());
  if (destination === port || !available(player, port, destination)) return false;
  if (destination.slug === CRANDOR) {
    closeMap(player);
    playCondition(player, trader, (step) => /crandor/i.test(step.text ?? ""));
    return true;
  }
  const fare = fareFor(player, port, destination);
  if (fare == null) return false;
  closeMap(player);
  offerFare(player, destination, fare);
  return true;
}

/** Charter: the map, unless the player carries rum or a bedsheet. */
function charter(event) {
  const { player } = event;
  const trader = traderOf(event);
  if (refuseCargo(player, trader)) return true;
  traders.set(player, trader);
  openMap(player);
  return true;
}

/** Charter-to <port>: straight to the last destination; at that port the crew ask why. */
function charterToLast(event) {
  const { player, definition, clickType } = event;
  const label = definition?.getActions?.()?.[clickType - 1];
  if (!TRADERS.includes(definition?.getName?.()) || !String(label ?? "").startsWith(CHARTER_TO)) return;
  event.handled = true;
  const trader = traderOf(event);
  if (refuseCargo(player, trader)) return;
  traders.set(player, trader);
  const previous = Number(player.getAttribute(PREVIOUS_DESTINATION_ATTRIBUTE) ?? 0);
  const destination = destinations().find((row) => row.id === previous && row.id !== 0);
  if (destination && destination === portAt(player.getLocation())) {
    const request = { player, npc: trader.npc, npcId: trader.npcId, variant: CURRENT_PORT_VARIANT, exact: true, handled: false };
    pluginApi.emitCustomEvent("npc-dialogue:start", request);
    if (request.handled) return;
  }
  if (!choose(player, destination)) openMap(player);
}

/** A marker on the map (sub 2k+1) or a row of the list (sub 2k) for table row k. */
function chooseOnMap(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const component = ((event.groupId ?? (buttonId >>> 16)) << 16) | (event.childId ?? (buttonId & 0xffff));
  const markers = core.CacheDefinitions.getComponentId(MAP_MARKERS);
  const list = core.CacheDefinitions.getComponentId(SIDE_LIST);
  if (component !== markers && component !== list) return;
  event.handled = true;
  const { player } = event;
  if (player.getInterfaceId() !== mapInterface()) return;
  const destination = destinations()[Math.floor(Number(event.slot ?? -1) / SLOTS_PER_ROW)];
  choose(player, destination);
}

/** Closing the map closes its list and frees the player. */
function mapClosed({ player, interfaceId }) {
  if (interfaceId !== mapInterface()) return;
  player.getPacketSender().closeSubInterface(SIDE_MODAL);
  if (!voyages.has(player)) setVarbit(player, BUSY_VARBIT, 0);
}

/** Talk-to's "Charter ship" step (crew) or charter map step (Trader Stan) opens the map. */
function transcriptOpensMap(event) {
  if (!TRADERS.includes(event.definition?.getName?.())) return;
  const opens = (event.action === "open_interface" && event.target === "Charter ship") || /charter map/i.test(event.text ?? "");
  if (!opens) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  traders.set(player, traderOf(event));
  // The conversation closes the chatbox as it ends, so the map opens the tick after.
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      this.stop();
      // A newer main modal owns this target; do not replace it with the old map.
      if (player.isRegistered() && !player.getPacketSender().getSubInterfaceAt(MAIN_MODAL)) openMap(player);
    }
  })());
}

/** Talk-to's prose conditions: what the player carries; the map itself handles Crandor. */
function answerTranscriptCondition({ player, definition, text }) {
  if (!TRADERS.includes(definition?.getName?.())) return null;
  const value = String(text).toLowerCase();
  if (value.includes("does not have")) return !carriesRefused(player);
  if (value.includes("crandor")) return false;
  return refusalCarried(player, text);
}

/** shops.json binds only some of the cache's crewmember variants; every one of them trades. */
function openTradingPost({ player }) {
  return core.ShopManager.open(player, TRADING_POST_SHOP_ID);
}

function restore({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  setVarbit(player, PREVIOUS_DESTINATION_VARBIT, Number(player.getAttribute(PREVIOUS_DESTINATION_ATTRIBUTE) ?? 0));
  if (skipConfirmation(player)) setVarbit(player, CONFIRM_WARNING_VARBIT, 1);
}

function start(api) {
  core = api.core;
  pluginApi = api;
}

module.exports = {
  name: "CharterShips",
  members: true,
  _test: {
    destinations, portAt, available, fareBetween, fareFor, choose, sail, offerFare, openMap,
    charter, charterToLast, chooseOnMap, mapClosed, transcriptOpensMap, answerTranscriptCondition,
    reset: () => { rows = null; fareData = null; },
    PREVIOUS_DESTINATION_ATTRIBUTE, SKIP_CONFIRMATION_ATTRIBUTE,
  },
  register(api) {
    start(api);
    api.persistAttribute(PREVIOUS_DESTINATION_ATTRIBUTE, 0);
    api.persistAttribute(SKIP_CONFIRMATION_ATTRIBUTE, false);
    api.onPlayerLogin(restore);
    api.core.Mobile.onBeforeTeleport(voyageInterrupted);
    api.onNpcsInteraction(TRADERS, { Charter: charter, Trade: openTradingPost });
    api.onNpcInteraction(charterToLast);
    api.onInterfaceActionClick(chooseOnMap);
    api.onCustomEvent("interface:closed", mapClosed);
    api.onCustomEvent("npc-dialogue:action", transcriptOpensMap);
    api.onNpcDialogueCondition(answerTranscriptCondition);
  },
};
