/**
 * The popout panel's buttons (popout, 728): XP tracker, loot tools and hiscores. The gameframe
 * mounts the panel with op1 on its buttons (ClientProtocol encodeGameframeBootstrap); a click sets
 * `popout_open` to the panel's enum 4067 row, opens that panel in popout:container and runs
 * toplevel_setup_popout (5354), which redraws the buttons with that one as "Close".
 *
 * rsprox captures, each click and its packets:
 * - sub 0, XP tracker: popout_open 1, xptracker opened with tracker_border 0-24 op6, 5354
 *   (rsprox_transcripts/227/02148.txt:3282-3291).
 * - sub 1, loot tools: popout_open 2, loottools opened with op1 on ground_items_top and
 *   dropdown_content and TARGET on each loot row's slots 9, 11 .. 107 and 3, 5354
 *   (241/911590.txt:3346-4390, 237/04116.txt:3221).
 * - sub 2, hiscores: popout_open 3, hiscores opened, 5354 (227/02137.txt:6008-6022, 21 more).
 *
 * Desktop draws the buttons as popout:buttons 0-2; the mobile toplevel as popout:osm_buttons,
 * where each button is the even child before its icon (toplevel_osm_setup_popout_buttons).
 * No capture closes a panel: Close (the op on the open panel's button) sets popout_open 0 and
 * empties the container, as the cache's layout scripts read it.
 */

const POPOUT_OPEN_VARBIT = "popout_open";
const CONTAINER = "popout:container";
const BUTTONS = "popout:buttons";
const OSM_BUTTONS = "popout:osm_buttons";
/** toplevel_setup_popout: lays the panel and its buttons out again. */
const TOPLEVEL_SETUP_POPOUT_SCRIPT = 5354;
const OVERLAY = 1;
const OP1 = 1 << 1;
const OP6 = 1 << 6;
const TARGET = 1 << 21;
const LOOT_ROWS = 10;
const LOOT_FIRST_SLOT = 9;
const LOOT_LAST_SLOT = 107;
const LOOT_HEADER_SLOT = 3;

/** Enum 4067's rows in order (popout_open value = index + 1). */
const PANELS = [
  { name: "xptracker", events: xpTrackerEvents },
  { name: "loottools", events: lootToolsEvents },
  { name: "hiscores", events: noEvents },
];

let cache;
/** Interface ids by gameval name: the cache lookup walks every interface. */
const interfaceIds = new Map();

function interfaceId(name) {
  if (!interfaceIds.has(name)) interfaceIds.set(name, cache.getInterfaceId(name));
  return interfaceIds.get(name);
}

function xpTrackerEvents() {
  return [["xptracker:tracker_border", 0, 24, OP6]];
}

function lootToolsEvents() {
  const events = [
    ["loottools:ground_items_top", 0, 0, OP1],
    ["loottools:dropdown_content", 0, 4, OP1],
  ];
  for (const kind of ["source", "drop"]) {
    for (let row = 0; row < LOOT_ROWS; row++) {
      const name = `loottools:loottracker_display_${kind}_${row}`;
      for (let slot = LOOT_FIRST_SLOT; slot <= LOOT_LAST_SLOT; slot += 2) events.push([name, slot, slot, TARGET]);
      events.push([name, LOOT_HEADER_SLOT, LOOT_HEADER_SLOT, TARGET]);
    }
  }
  return events;
}

function noEvents() {
  return [];
}

/** The panel index a click names, or -1. */
function panelIndex(buttonId, slot) {
  if (!Number.isInteger(slot)) return -1;
  if (buttonId === cache.getComponentId(BUTTONS)) return slot < PANELS.length ? slot : -1;
  if (buttonId === cache.getComponentId(OSM_BUTTONS) && slot % 2 === 0) {
    return slot / 2 < PANELS.length ? slot / 2 : -1;
  }
  return -1;
}

function clickButton(event) {
  if (event.handled || event.groupId !== interfaceId("popout")) return;
  const panel = panelIndex(event.buttonId, event.slot);
  if (panel < 0) return;
  event.handled = true;
  const sender = event.player.getPacketSender();
  const varbit = cache.getVarbitId(POPOUT_OPEN_VARBIT);
  const container = cache.getComponentId(CONTAINER);
  const value = panel + 1;
  if (sender.getVarbit(varbit) === value) {
    sender.sendVarbit(varbit, 0);
    sender.closeSubInterface(container);
  } else {
    const { name, events } = PANELS[panel];
    sender.sendVarbit(varbit, value);
    sender.sendSubInterface(container, interfaceId(name), OVERLAY);
    for (const [component, from, to, flags] of events()) {
      sender.sendInterfaceFlagsRange(cache.getComponentId(component), from, to, flags);
    }
  }
  sender.sendClientScript(TOPLEVEL_SETUP_POPOUT_SCRIPT);
}

function attachCore(api) {
  cache = api.core.CacheDefinitions;
}

module.exports = {
  name: "PopoutPanel",
  description: "Popout panel buttons (mobile): open and close the XP tracker, loot tools and hiscores in the panel.",
  register(api) {
    attachCore(api);
    api.onInterfaceActionClick(clickButton);
  },
};
