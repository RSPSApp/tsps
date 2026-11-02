/**
 * What the Quetzal Transport System's units share: the cache's landing sites (dbtable 64),
 * plugins/world/data/quetzals.json with its gameval names resolved, the quetzal varps (saved as
 * one snapshot and sent again on login), which sites a player can fly to, fades and timers.
 */
const fs = require("fs");
const path = require("path");

const SITE_TABLE = 64;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const MAIN_MODAL = (161 << 16) | 16;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const MINIMAP_STATE_VARBIT = "minimap_state";
const BUSY_VARBIT = "busy";
const MINIMAP_OFF = 2;
const SCRIPT_MAINMODAL_OPEN = 2524;
const OPEN_SOUND = 8413;
/** Interface event flags: op1 on every site slot. */
const OP1_FLAGS = 1 << 1;

const VARPS_ATTRIBUTE = "quetzals:varps";
/** The site varbits live in quetzals_1-3; quetzals_unlocked holds a bit per built site. */
const PERSISTED_VARPS = ["quetzals_1", "quetzals_2", "quetzals_3", "quetzals_unlocked"];
const VARLAMORE_VISITED = "varlamore_visited";
const FIRST_TRIP_STATE = "vmq2_first_travel";
// These share their parent varp with Twilight's Promise; save only the travel bits.
const PERSISTED_VARBITS = [VARLAMORE_VISITED, FIRST_TRIP_STATE];
const UNLOCKED_VARP = "quetzals_unlocked";
const BASE_APPEARANCE = "quetzal_base_appearance";
const LAST_DESTINATION = "quetzal_last_destination";
/** Each site's varbit, by the table's site id. */
const SITE_VARBITS = {
  1: "quetzal_fortis",
  2: "quetzal_teomat",
  3: "quetzal_sunsetcoast",
  4: "quetzal_hunterguild",
  5: "quetzal_camtorum",
  6: "quetzal_colossalwyrm",
  7: "quetzal_outerfortis",
  8: "quetzal_colosseum",
  9: "quetzal_aldarin",
  10: "quetzal_quetzacalligorge",
  11: "quetzal_salvageroverlook",
  12: "quetzal_talteklan",
  13: "quetzal_auburnvalley",
  14: "quetzal_kastori",
};
/** Client script 5015 only reads quetzals_unlocked for site ids up to 30. */
const MAX_BUILT_BIT = 30;

let api = null;
let core = null;
let data = null;
let sites = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "quetzals.json"), "utf8"));
  sites = null;
}

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function varbit(player, name) {
  const id = varbitId(name);
  return id == null ? 0 : player.getPacketSender().getVarbit(id);
}

function varp(player, name) {
  const id = core.CacheDefinitions.getVarpId(name);
  return id == null ? 0 : player.getPacketSender().getVarp(id);
}

function obj(name) {
  return core.CacheDefinitions.getObjId(name);
}

/** The table's landing sites in row order: { id, name, x, y, z, autoUnlocked }. */
function landingSites() {
  if (sites) return sites;
  const { CacheDefinitions } = core;
  const column = (name, fallback) => CacheDefinitions.getDbColumn(SITE_TABLE, name) ?? fallback;
  const [idColumn, nameColumn, coordColumn, autoColumn] = [column("id", 0), column("name", 1), column("coord", 2), column("auto_unlocked", 6)];
  sites = CacheDefinitions.getDbTableRows(SITE_TABLE).map((row) => {
    const coord = Number(row.columns.get(coordColumn)?.[0]) | 0;
    return {
      id: Number(row.columns.get(idColumn)?.[0]),
      name: String(row.columns.get(nameColumn)?.[0] ?? ""),
      x: (coord >>> 14) & 0x3fff,
      y: coord & 0x3fff,
      z: (coord >>> 28) & 0x3,
      autoUnlocked: Number(row.columns.get(autoColumn)?.[0]) === 1,
    };
  });
  return sites;
}

function siteById(id) {
  return landingSites().find((site) => site.id === id) ?? null;
}

function save(player) {
  const sender = player.getPacketSender();
  const snapshot = {};
  for (const name of PERSISTED_VARPS) {
    const id = core.CacheDefinitions.getVarpId(name);
    const value = id == null ? 0 : sender.getVarp(id);
    if (value !== 0) snapshot[id] = value;
  }
  for (const name of PERSISTED_VARBITS) {
    const id = varbitId(name);
    const value = id == null ? 0 : sender.getVarbit(id);
    if (value !== 0) (snapshot.varbits ??= {})[id] = value;
  }
  player.setAttribute(VARPS_ATTRIBUTE, Object.keys(snapshot).length ? snapshot : null);
}

function setVarbits(player, values) {
  const sender = player.getPacketSender();
  for (const [name, value] of Object.entries(values)) {
    const id = varbitId(name);
    if (id != null) sender.sendVarbit(id, value);
  }
  save(player);
}

function restore({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  const snapshot = player.getAttribute(VARPS_ATTRIBUTE);
  if (!snapshot || typeof snapshot !== "object") return;
  const sender = player.getPacketSender();
  for (const [id, value] of Object.entries(snapshot)) {
    if (Number.isInteger(value)) sender.sendConfig(Number(id), value);
  }
  for (const name of PERSISTED_VARBITS) {
    const id = varbitId(name);
    const value = snapshot.varbits?.[id];
    if (id != null && Number.isInteger(value)) sender.sendVarbit(id, value);
  }
}

/** Whether a site has been built: its bit in quetzals_unlocked (client script 5015). */
function siteBuilt(player, site) {
  return site.id <= MAX_BUILT_BIT && ((varp(player, UNLOCKED_VARP) >>> site.id) & 1) === 1;
}

/** Sets a built site's bit, the way client script 5016 does, and saves it. */
function markBuilt(player, site) {
  const id = core.CacheDefinitions.getVarpId(UNLOCKED_VARP);
  if (id == null || site.id > MAX_BUILT_BIT) return;
  const sender = player.getPacketSender();
  sender.sendConfig(id, sender.getVarp(id) | (1 << site.id));
  save(player);
}

/** Client script 5015: a site comes with the system or has been built. */
function siteUsable(player, site) {
  return !!site && (site.autoUnlocked || siteBuilt(player, site));
}

/** Renu is the player's once she has been fed (Twilight's Promise sets her appearance). */
function renuUnlocked(player) {
  return varbit(player, BASE_APPEARANCE) > 0;
}

function fade(player, out, cycles) {
  const args = out ? [0, 255, 0, 0, cycles] : [0, 0, 0, 255, cycles];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function minimap(player, off) {
  setVarbit(player, MINIMAP_STATE_VARBIT, off ? MINIMAP_OFF : 0);
}

function setVarbit(player, name, value) {
  const id = varbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

function busy(player, on) {
  setVarbit(player, BUSY_VARBIT, on ? 1 : 0);
}

/** Runs `action` once, `ticks` game ticks from now, while the player is still logged in. */
function later(player, ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered()) action();
    }
  })());
}

/** Each player's running timeline. Only it may hold or release the player's movement. */
const timelines = new WeakMap();

function tileOf(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY(), location.getZ()];
}

/**
 * Runs `steps` ({ tick: action }) from the next tick on, holding the player still until the
 * last one. A logout ends it where the player stands. A death, a move its own steps didn't make
 * (a respawn, another teleport) or a newer timeline ends it before its next step; `onCancel`
 * then undoes what it holds, but only while it is still the player's timeline. `onEnd` runs
 * however it ends.
 */
function timeline(player, steps, { onEnd, onCancel } = {}) {
  const { Task, TaskManager } = core;
  const last = Math.max(...Object.keys(steps).map(Number));
  const movement = player.getMovementQueue();
  let anchor = tileOf(player);
  let tick = 0;
  const task = new (class extends Task {
    constructor() {
      super(1, player, false);
      this.ended = false;
      this.cancelled = false;
    }

    execute() {
      if (timelines.get(player) !== this || !player.isRegistered()) {
        this.stop();
        return;
      }
      if (player.isDyingReturn?.() === true || tileOf(player).some((value, index) => value !== anchor[index])) {
        this.cancel();
        return;
      }
      tick++;
      steps[tick]?.();
      anchor = tileOf(player);
      if (tick >= last) this.stop();
    }

    cancel() {
      this.cancelled = true;
      this.stop();
    }

    stop() {
      if (!this.ended) {
        this.ended = true;
        if (timelines.get(player) === this) {
          timelines.delete(player);
          movement.setBlockMovement(false);
          if (this.cancelled) onCancel?.();
        }
        onEnd?.();
      }
      super.stop();
    }
  })();
  const previous = timelines.get(player);
  timelines.set(player, task);
  previous?.stop();
  movement.setBlockMovement(true).reset();
  TaskManager.submit(task);
}

/** Ends the player's running timeline, as a death does (onPlayerDeath, before the respawn). */
function endTimeline({ player }) {
  timelines.get(player)?.cancel();
}

/** An interface's group id and its site icons component (`<name>:icons`, slot = table row). */
function menu(name) {
  const { CacheDefinitions } = core;
  return { group: CacheDefinitions.getInterfaceId(name), icons: CacheDefinitions.getComponentId(`${name}:icons`) };
}

/**
 * Opens a site map (quetzal_menu for Renu, quetzalwhistle_menu for the whistle) as captured:
 * script 2524, the map in the main modal, sound 8413 and op1 on every site icon.
 */
function openMenu(player, name) {
  const { group, icons } = menu(name);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(group);
  sender.sendSubInterface(MAIN_MODAL, group, 0);
  sender.sendSound(OPEN_SOUND, 1, 0);
  sender.sendInterfaceFlagsRange(icons, 0, landingSites().length - 1, OP1_FLAGS);
}

/** The site a click on `name`'s icons picked, or undefined when the click is elsewhere. */
function clickedSite(event, name) {
  const { group, icons } = menu(name);
  const buttonId = Number(event.buttonId ?? 0);
  const component = ((event.groupId ?? (buttonId >>> 16)) << 16) | (event.childId ?? (buttonId & 0xffff));
  if (component !== icons) return undefined;
  event.handled = true;
  if (event.player.getInterfaceId() !== group) return null;
  return landingSites()[event.slot ?? -1] ?? null;
}

function closeMenu(player) {
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  player.setInterfaceId(-1);
}

/** A message box, as the transcripts' {{tbox}} lines and the captured mesbox are. */
function box(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core;
  const chain = new DialogueChainBuilder();
  chain.add(new StatementDialogue(0, text));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function questComplete(player, key) {
  const request = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

module.exports = {
  init, varbitId, varbit, varp, obj, landingSites, siteById, save, setVarbits, setVarbit, restore,
  siteBuilt, markBuilt, siteUsable, renuUnlocked, fade, minimap, busy, later, timeline, endTimeline, box, message,
  questComplete, menu, openMenu, clickedSite, closeMenu,
  VARPS_ATTRIBUTE, SITE_VARBITS, BASE_APPEARANCE, LAST_DESTINATION, MAIN_MODAL, OVERLAY_ATMOSPHERE_UID,
  VARLAMORE_VISITED, FIRST_TRIP_STATE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
