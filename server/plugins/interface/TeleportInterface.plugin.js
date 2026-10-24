/**
 * ::teleports, a free server teleport list (clicking a spell itself still enforces its rune
 * and level requirements). Destinations come from data/teleports.json and are grouped into
 * tabs; the list is searchable, and a player can keep favourites and see their last few
 * teleports. The Wilderness asks first, unless the player chose not to be asked again.
 */
const Layout = require("./teleportinterface/Layout.TeleportInterface");
const Destinations = require("./teleportinterface/Destinations.TeleportInterface");

const { GROUP_ID, MAIN_MODAL_UID, COMPONENT, uid } = Layout;
const { TAB, TAB_ORDER, TAB_LABELS } = Destinations;
const TAB_ATTRIBUTE = "teleports:tab";
const SELECTED_ATTRIBUTE = "teleports:selected";
const FAVOURITES_ATTRIBUTE = "teleports:favourites";
const RECENT_ATTRIBUTE = "teleports:recent";
const SKIP_WILDERNESS_WARNING_ATTRIBUTE = "teleports:skip-wilderness-warning";
const RECENT_LIMIT = 5;
const DATA_PART_BYTES = 40000;
const OP = { SELECT: 1, TELEPORT: 2, FAVOURITE: 3 };
const SEARCH_MAX_LENGTH = 40;
const TAB_UIDS = TAB_ORDER.map((_, index) => uid(COMPONENT.TAB_START + index));
const ROW_UIDS = Array.from({ length: Layout.ROW_SLOTS }, (_, slot) => uid(COMPONENT.ROW_LABEL_START + slot));
const INTERFACE_DEFINITION = Layout.buildInterface(TAB_ORDER.map((tab) => TAB_LABELS[tab]));

let core;
let pluginApi;

const favourites = (player) => [...(player.getAttribute(FAVOURITES_ATTRIBUTE) ?? [])];
const recent = (player) => [...(player.getAttribute(RECENT_ATTRIBUTE) ?? [])];
const isOpen = (player) => player.getInterfaceId?.() === GROUP_ID;

function selectedTab(player) {
  const tab = player.getAttribute(TAB_ATTRIBUTE);
  return TAB_ORDER.includes(tab) ? tab : TAB.ALL;
}

/** Rows in order, in parts that each fit a widget text packet with room to spare. */
function splitRows(rows) {
  const parts = [[]];
  let bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), "latin1") + 1;
    if (bytes + size > DATA_PART_BYTES && parts.at(-1).length > 0) {
      parts.push([]);
      bytes = 2;
    }
    parts.at(-1).push(row);
    bytes += size;
  }
  if (parts.length > Layout.DATA_PART_COMPONENTS.length) {
    throw new Error(`[teleports] ${rows.length} rows need ${parts.length} data parts; Layout declares ${Layout.DATA_PART_COMPONENTS.length}`);
  }
  return parts;
}

/**
 * Every destination's row (with its panel text) and each tab's layout. The client switches
 * tabs from these itself; `active` is sent only on open, so a refresh never moves the tab.
 */
function sendRows(player, active = undefined) {
  const favouriteKeys = favourites(player);
  const sender = player.getPacketSender();
  const parts = splitRows(Destinations.catalog((entry) => panelText(player, entry, favouriteKeys)));
  Layout.DATA_PART_COMPONENTS.forEach((component, index) => sender.sendString(JSON.stringify(parts[index] ?? []), uid(component)));
  const layout = { tabs: Destinations.layouts(favouriteKeys, recent(player)) };
  if (active !== undefined) layout.active = TAB_ORDER.indexOf(active);
  sender.sendString(JSON.stringify(layout), uid(COMPONENT.LAYOUT));
}

function killCountLine(player, entry) {
  if (!entry.kc) return "";
  const request = { player, monster: entry.kc };
  pluginApi.emitCustomEvent("combat-achievements:count", request);
  return `Kill count: <col=ffffff>${Number(request.total) || 0}</col>`;
}

function wildernessLine(entry) {
  const level = Destinations.wildernessLevel(entry);
  if (level <= 0) return "";
  const [x, y, z] = entry.tile;
  return `<col=ff5f5f>Level ${level} Wilderness${core.Wilderness.isMulti(x, y, z) ? ", multi-combat" : ""}</col>`;
}

/**
 * What the details panel shows for a destination. It travels with the rows, so the client
 * fills the panel the moment a row is clicked (Layout's list.select) instead of a tick later.
 */
function panelText(player, entry, favouriteKeys) {
  // The Wilderness and kill-count lines fill from the top, so a missing one leaves no gap.
  const [info = "", info2 = ""] = [wildernessLine(entry), killCountLine(player, entry)].filter(Boolean);
  return {
    title: entry.name,
    subtitle: entry.group ?? TAB_LABELS[entry.tabs[0]],
    info,
    info2,
    description: entry.description ?? "",
    favourite: favouriteKeys.includes(entry.key) ? "Unfavourite" : "Favourite",
  };
}

/** The panel before anything is selected; selecting is drawn by the client. */
function showEmptyPanel(player) {
  const sender = player.getPacketSender();
  for (const component of [COMPONENT.TELEPORT_BUTTON, COMPONENT.TELEPORT_LABEL, COMPONENT.FAVOURITE_BUTTON, COMPONENT.FAVOURITE_LABEL]) {
    sender.sendInterfaceDisplayState(uid(component), true);
  }
  sender.clearItemOnInterface(uid(COMPONENT.PANEL_ICON));
  sender.sendString("Teleports", uid(COMPONENT.PANEL_TITLE))
    .sendString("", uid(COMPONENT.PANEL_SUBTITLE))
    .sendString("", uid(COMPONENT.PANEL_WILDERNESS))
    .sendString("", uid(COMPONENT.PANEL_KILLS))
    .sendString("Select a destination to see where it goes. Right-click one to teleport straight there or keep it as a favourite.",
      uid(COMPONENT.PANEL_DESCRIPTION));
}

function open(player, query = "") {
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Server Teleports"] }],
  });
  player.setAttribute(SELECTED_ATTRIBUTE, undefined);
  const tab = query ? TAB.ALL : selectedTab(player);
  player.setAttribute(TAB_ATTRIBUTE, tab);
  sendRows(player, tab);
  player.getPacketSender().sendString(query.slice(0, SEARCH_MAX_LENGTH), uid(COMPONENT.SEARCH_INPUT));
  showEmptyPanel(player);
}

function rememberTeleport(player, entry) {
  const keys = recent(player).filter((key) => key !== entry.key);
  keys.unshift(entry.key);
  player.setAttribute(RECENT_ATTRIBUTE, keys.slice(0, RECENT_LIMIT));
}

function go(player, entry, tile) {
  const destination = Destinations.location(tile);
  if (!core.TeleportHandler.checkReqs(player, destination)) return;
  // A destination's own plugin can prepare the arrival (Count Draynor's crypt instance).
  if (entry.arrival) pluginApi.emitCustomEvent(entry.arrival, { player });
  rememberTeleport(player, entry);
  core.TeleportHandler.teleport(player, destination, core.TeleportType[entry.type], false);
}

/** Where a destination lands now: its tile, or what its owning plugin answers for a live one. */
function tileOf(player, entry) {
  if (!entry.live) return entry.tile;
  const request = { player };
  pluginApi.emitCustomEvent(entry.live, request);
  return request.tile;
}

function confirmWilderness(player, entry, tile, level) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 3) player.setAttribute(SKIP_WILDERNESS_WARNING_ATTRIBUTE, true);
        if (Number(option) === 1 || Number(option) === 3) go(player, entry, tile);
      },
    }, "Yes.", "No.", "Yes, and don't ask again.").setTitle(`Teleport into level ${level} Wilderness?`),
  ));
}

function teleport(player, entry) {
  player.getPacketSender().sendInterfaceRemoval();
  const tile = tileOf(player, entry);
  if (!tile) {
    player.getPacketSender().sendMessage(entry.unavailable ?? "You can't teleport there right now.");
    return;
  }
  const level = entry.live ? Destinations.levelAt(tile) : Destinations.wildernessLevel(entry);
  if (level > 0 && !player.getAttribute(SKIP_WILDERNESS_WARNING_ATTRIBUTE)) confirmWilderness(player, entry, tile, level);
  else go(player, entry, tile);
}

function toggleFavourite(player, entry) {
  const keys = favourites(player);
  const kept = keys.filter((key) => key !== entry.key);
  player.setAttribute(FAVOURITES_ATTRIBUTE, kept.length === keys.length ? [...keys, entry.key] : kept);
  // Fresh rows carry the new Favourite label and Saved tab; the client keeps its tab, scroll
  // and selection.
  sendRows(player);
}

/** The client has already drawn the panel; the panel's buttons act on this selection. */
function select(player, entry) {
  player.setAttribute(SELECTED_ATTRIBUTE, entry.key);
}

function openTeleports({ player, parts }) {
  if (parts[1]?.toLowerCase() === "last") {
    const entry = Destinations.byKey(recent(player)[0]);
    if (entry) teleport(player, entry);
    else player.getPacketSender().sendMessage("You haven't teleported with ::teleports yet.");
    return true;
  }
  open(player, parts.slice(1).join(" "));
  return true;
}

/** The client has already switched; this tab is where ::teleports reopens. */
function clickTab({ player, buttonId }) {
  if (!isOpen(player)) return false;
  player.setAttribute(TAB_ATTRIBUTE, TAB_ORDER[TAB_UIDS.indexOf(buttonId)]);
  return true;
}

/** A list row: its slot carries the row id the client showed there. */
function clickRow({ player, slot, opId }) {
  if (!isOpen(player)) return false;
  const entry = Destinations.byId(slot);
  if (!entry) return true;
  if (opId === OP.TELEPORT) teleport(player, entry);
  else if (opId === OP.FAVOURITE) toggleFavourite(player, entry);
  else select(player, entry);
  return true;
}

function selected(player) {
  return isOpen(player) ? Destinations.byKey(player.getAttribute(SELECTED_ATTRIBUTE)) : undefined;
}

function clickTeleportButton({ player }) {
  const entry = selected(player);
  if (entry) teleport(player, entry);
  return true;
}

function clickFavouriteButton({ player }) {
  const entry = selected(player);
  if (entry) toggleFavourite(player, entry);
  return true;
}

module.exports = {
  name: "TeleportInterface",
  register(api) {
    pluginApi = api;
    core = api.core;
    Destinations.init(api);
    api.registerCustomInterface(INTERFACE_DEFINITION);
    api.persistAttribute(FAVOURITES_ATTRIBUTE, []);
    api.persistAttribute(RECENT_ATTRIBUTE, []);
    api.persistAttribute(SKIP_WILDERNESS_WARNING_ATTRIBUTE, false);
    api.registerCommand("teleports", openTeleports, undefined, "Browse teleport destinations (optional search text, or 'last')");
    api.onInterfaceActionButton(TAB_UIDS, clickTab);
    api.onInterfaceActionButton(ROW_UIDS, clickRow);
    api.onInterfaceActionButton([uid(COMPONENT.TELEPORT_BUTTON), uid(COMPONENT.TELEPORT_LABEL)], clickTeleportButton);
    api.onInterfaceActionButton([uid(COMPONENT.FAVOURITE_BUTTON), uid(COMPONENT.FAVOURITE_LABEL)], clickFavouriteButton);
  },
  _test: {
    GROUP_ID, COMPONENT, TAB, TAB_UIDS, ROW_UIDS, OP, FAVOURITES_ATTRIBUTE, RECENT_ATTRIBUTE,
    SKIP_WILDERNESS_WARNING_ATTRIBUTE, Destinations, uid,
  },
};
