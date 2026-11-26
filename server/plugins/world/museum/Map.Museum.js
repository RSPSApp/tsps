"use strict";

/**
 * The Varrock Museum wall maps (vm_museum_wallmounted_map_01/02/03, "Map"): Look-at opens the
 * museum map, vm_museum_map (527). From rsprox captures 1757 (ticks 10075-10088), 1723 (ticks
 * 14929-14969), local 1000153 (ticks 1995-2022) and local 1000808 (ticks 593-601); see
 * docs/varrock-museum.md.
 *
 * On the tick the player arrives live sends: busy 1, vm_display_case_ponder (6383), the four
 * floor layers (basement hidden, Dig Site shown, timeline floors hidden, on every floor the map
 * was read from), "Empty<br>display" on each exhibit the player hasn't filled yet,
 * toplevel_mainmodal_open [12632226, 150] and the modal. The stairs buttons switch floors on the
 * next tick (hide Dig Site, first floor, second floor, basement, the target shown). Closing it
 * sends busy 0, sequence -1 and the Kudos HUD again.
 */

const INTERFACE_NAME = "vm_museum_map";
const WALL_MAPS = ["vm_museum_wallmounted_map_01", "vm_museum_wallmounted_map_02", "vm_museum_wallmounted_map_03"];
const LOOK_AT = "Look-at";
const EMPTY_TEXT = "Empty<br>display";
const PONDER_SEQUENCE = "vm_display_case_ponder";
const BUSY_VARBIT = "busy";
const SCRIPT_MAINMODAL_OPEN = 2524; // toplevel_mainmodal_open
const MAINMODAL_OPEN_ARGS = [12632226, 150];

/** The floor layers, in live's open order, and the order a floor switch hides them in. */
const LAYERS = Object.freeze({
  basement: "vm_museum_map:vm_level_basement_layer",
  digSite: "vm_museum_map:vm_lvl_0",
  timeline: "vm_museum_map:vm_lvl_1",
  upper: "vm_museum_map:vm_lvl_2",
});
const OPEN_ORDER = ["basement", "digSite", "timeline", "upper"];
const SWITCH_ORDER = ["digSite", "timeline", "upper", "basement"];

/** Each stairs button (cache actions "Stairs to ... exhibit") and the floor it shows. */
const STAIRS = Object.freeze({
  "vm_museum_map:lvl0_level_down_1_1": "basement",
  "vm_museum_map:lvl0_level_down_1": "basement",
  "vm_museum_map:lvl0_level_up_1": "timeline",
  "vm_museum_map:lvl0_level_up": "timeline",
  "vm_museum_map:lvl1_level_down_1": "digSite",
  "vm_museum_map:lvl1_level_down": "digSite",
  "vm_museum_map:lvl1_level_up_1": "upper",
  "vm_museum_map:lvl1_level_up": "upper",
  "vm_museum_map:lvl2_level_down": "timeline",
  "vm_museum_map:lvl2_level_down_1": "timeline",
  "vm_museum_map:basement_level_up_1": "digSite",
  "vm_museum_map:basement_level_up_1_1": "digSite",
});
const CLOSE_BUTTON = "vm_museum_map:vm_map_close";

/**
 * The exhibits live can mark empty, in live's send order, with the varbit that fills each. All
 * four recordings fit it: an exhibit is empty exactly when its varbit is 0. The terracotta
 * statue is the other way round: The Golem's statuette taken from its case
 * (golem_retrieved_statuette 1, recording 1000808). The other exhibits (pottery, the Shield of
 * Arrav, Silverlight, the runes, the glider, the Ardougne map, the king's painting) were never
 * marked empty, even at varbit 0 (1723, 1757), so they aren't here.
 */
const EXHIBITS = Object.freeze([
  ["vm_saranthium_coin_exhibit", "vm_digsite_coin_sara"],
  ["vm_senntisten_coin_exhibit", "vm_digsite_coin_senn"],
  ["vm_saradomin_symbol_ancient_exhibit", "vm_digsite_symbol_anc"],
  ["vm_saradomin_symbol_old_exhibit", "vm_digsite_symbol_old"],
  ["vm_tablet_exhibit", "vm_digsite_tablet"],
  ["vm_talisman_exhibit", "vm_digsite_talisman"],
  ["vm_staff_of_armadyll", "vm_staff_of_armadyl"],
  ["vm_seven_knights_helms", "vm_salveknights"],
  ["vm_observatory", "vm_observatory"],
  ["vm_terracotta_statue", "golem_retrieved_statuette", true],
  ["vm_robert_the_strong", "vm_robert"],
  ["vm_surok_tomb", "vm_surok"],
  ["vm_excalibur", "vm_excalibur"],
]);

let api = null;
let ids = null;
let showHud = () => {};
/** Players with the museum map open. */
const reading = new WeakSet();

function gameval(lookup, kind, name) {
  const id = lookup(name);
  if (!Number.isInteger(id)) throw new Error(`[museum] unknown ${kind} gameval ${name}`);
  return id;
}

function resolveIds() {
  if (ids) return ids;
  const defs = api.core.CacheDefinitions;
  const component = (name) => gameval((value) => defs.getComponentId(value), "component", name);
  const varbit = (name) => gameval((value) => defs.getVarbitId(value), "varbit", name);
  ids = {
    interfaceId: gameval((value) => defs.getInterfaceId(value), "interface", INTERFACE_NAME),
    wallMaps: new Set(WALL_MAPS.map((name) => gameval((value) => defs.getLocId(value), "loc", name))),
    sequence: gameval((value) => defs.getSeqId(value), "seq", PONDER_SEQUENCE),
    busy: varbit(BUSY_VARBIT),
    layers: Object.fromEntries(Object.entries(LAYERS).map(([floor, name]) => [floor, component(name)])),
    stairs: new Map(Object.entries(STAIRS).map(([name, floor]) => [component(name), floor])),
    close: component(CLOSE_BUTTON),
    exhibits: EXHIBITS.map(([name, varbitName, emptyWhenSet]) => ({
      component: component(`${INTERFACE_NAME}:${name}`),
      varbit: varbit(varbitName),
      emptyWhenSet: emptyWhenSet === true,
    })),
  };
  return ids;
}

function isEmpty(player, exhibit) {
  const filled = player.getPacketSender().getVarbit(exhibit.varbit) > 0;
  return exhibit.emptyWhenSet ? filled : !filled;
}

function showFloor(player, floor, order) {
  const sender = player.getPacketSender();
  for (const layer of order) sender.sendInterfaceDisplayState(ids.layers[layer], layer !== floor);
}

function open(player) {
  resolveIds();
  const sender = player.getPacketSender();
  sender.sendVarbit(ids.busy, 1);
  player.performAnimation(new api.core.Animation(ids.sequence));
  showFloor(player, "digSite", OPEN_ORDER);
  for (const exhibit of ids.exhibits) {
    if (isEmpty(player, exhibit)) sender.sendString(EMPTY_TEXT, exhibit.component);
  }
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, MAINMODAL_OPEN_ARGS);
  sender.sendInterface(ids.interfaceId);
  reading.add(player);
}

function lookAt({ player, objectId }) {
  if (!resolveIds().wallMaps.has(objectId)) return false;
  open(player);
  return true;
}

function stairs({ player, buttonId }) {
  const floor = resolveIds().stairs.get(buttonId);
  if (!floor || !reading.has(player)) return false;
  // rsprox 1757 tick 10085 -> 10086, local 1000153 tick 2005: the floor shows on the next tick.
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
    }

    execute() {
      this.stop();
      if (reading.has(player)) showFloor(player, floor, SWITCH_ORDER);
    }
  })());
  return true;
}

function close({ player }) {
  if (!reading.has(player)) return false;
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

/** Closed by any route (the Close button, walking off, another click): rsprox 1757 tick 10082. */
function closed({ player, interfaceId }) {
  if (!ids || interfaceId !== ids.interfaceId || !reading.delete(player)) return;
  player.getPacketSender().sendVarbit(ids.busy, 0);
  player.performAnimation(new api.core.Animation(-1));
  showHud(player);
}

/** `hud(player)` re-sends the Kudos HUD for a player who has it, as live does on close. */
function attachMuseumMap(pluginApi, hud) {
  api = pluginApi;
  if (typeof hud === "function") showHud = hud;
  pluginApi.onObjectInteraction("Map", { [LOOK_AT]: lookAt });
  const defs = pluginApi.core.CacheDefinitions;
  for (const name of [...Object.keys(STAIRS), CLOSE_BUTTON]) {
    const uid = gameval((value) => defs.getComponentId(value), "component", name);
    pluginApi.onInterfaceActionButton(uid, name === CLOSE_BUTTON ? close : stairs);
  }
  pluginApi.onCustomEvent("interface:closed", closed);
}

module.exports = attachMuseumMap;
Object.assign(module.exports, { EXHIBITS, STAIRS, EMPTY_TEXT, _test: { lookAt, stairs, close, closed, reset: () => { ids = null; } } });
