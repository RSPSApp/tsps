/**
 * Fishing spots move. Wiki (Fishing spots): "they move to a nearby location after a hidden timer
 * expires. Most spots take a minimum of 250 ticks (2.5 minutes) and a maximum of 530 ticks (5.3
 * minutes) to move", sacred and infernal eel spots 100-300 ticks and anglerfish spots 8-830
 * (`moveTicks` on their tools); spots whose tool is `stationary`, or that move themselves (`spot`:
 * the minnow platform), never move here.
 *
 * Where a spot can go comes from rsprox captures (data/definitions/fishing-spot-sites.json,
 * rsprox_fishing_spots.py in osrs-captures): each site is the set of tiles live spots were seen on.
 * A spot jumps (a teleport, never a walk) to a random tile of its site that is neither its own nor
 * held by another fishing spot: 268 of 268 Lumbridge Swamp jumps did so (local 1001517, 1001439,
 * 1001502 and others), with sound 2601 (range 5) at the tile it left. A spot on no captured site
 * stays where it is, and Fishing.plugin keeps its random session stop for it.
 *
 * A session on the spot ends when it moves (Fishing.plugin's spot-tile check), with no message or
 * animation reset, as captured.
 */
const SITES = require("../../../data/definitions/fishing-spot-sites.json").sites;

/** Wiki (Fishing spots): most spots move after 250 to 530 ticks. */
const DEFAULT_MOVE_TICKS = Object.freeze([250, 530]);
/** rsprox captures: a sound at the old tile on the tick a spot moves (sound_area 2601, range 5). */
const MOVE_SOUND = 2601;
const MOVE_SOUND_RANGE = 5;
/** New spots (spawned after boot, an edited map) are picked up this often. */
const SCAN_TICKS = 100;

let api = null;
let toolsOf = () => [];
const tracked = new Map();      // npc -> { site, moveTicks, due }
const known = new Set();        // every fishing spot NPC seen, tracked or not, for tile occupancy
let tick = 0;
let nextScan = 0;

const tileKey = (x, y, z) => `${x},${y},${z}`;

/** Sites by id and tile, and by tile alone (sites of several spot types share tiles). */
const sitesById = new Map();
const sitesByTile = new Map();
for (const site of SITES) {
  for (const [x, y] of site.tiles) {
    sitesById.set(`${site.id}:${tileKey(x, y, site.plane)}`, site);
    const list = sitesByTile.get(tileKey(x, y, site.plane)) ?? [];
    list.push(site);
    sitesByTile.set(tileKey(x, y, site.plane), list);
  }
}

/**
 * The captured site a spot stands on: its own spot type's first; else the best recorded site on
 * that tile, since our spawn ids don't always match live's.
 */
function siteFor(npcId, x, y, z) {
  const own = sitesById.get(`${npcId}:${tileKey(x, y, z)}`);
  if (own) return own;
  const shared = sitesByTile.get(tileKey(x, y, z));
  if (!shared) return null;
  return shared.reduce((best, site) => (site.jumps > best.jumps ? site : best));
}

function isFishingSpot(npc, names) {
  const name = npc.getDefinition?.()?.getName?.();
  return name != null && names.includes(name);
}

/** [min, max] ticks between moves for a spot's tools, or null when it never moves here. */
function moveTicksFor(tools) {
  if (tools.length === 0 || tools.some((tool) => tool.stationary || tool.spot)) return null;
  return tools.find((tool) => tool.moveTicks)?.moveTicks ?? DEFAULT_MOVE_TICKS;
}

function rollDue([min, max], random = Math.random) {
  return tick + min + Math.floor(random() * (max - min + 1));
}

/** Start tracking a spot: its first move anywhere in its range, so boot doesn't line them up. */
function track(npc, names, random = Math.random) {
  if (known.has(npc) || !isFishingSpot(npc, names)) return;
  known.add(npc);
  if (npc.getPrivateArea?.()) return;
  const at = npc.getLocation();
  const site = siteFor(npc.getId(), at.getX(), at.getY(), at.getZ());
  if (!site) return;
  const moveTicks = moveTicksFor(toolsOf(npc));
  if (!moveTicks) return;
  tracked.set(npc, { site, moveTicks, due: rollDue(moveTicks, random) });
}

function scan(names) {
  for (const npc of api.getWorld().getNpcs()) {
    if (npc) track(npc, names);
  }
  for (const npc of known) {
    if (npc.isRegistered && !npc.isRegistered()) {
      known.delete(npc);
      tracked.delete(npc);
    }
  }
}

/** Tiles of `site` a spot could move to: not its own, and no fishing spot standing there. */
function freeTiles(npc, site) {
  const taken = new Set();
  for (const other of known) {
    const at = other.getLocation();
    if (at.getZ() === site.plane) taken.add(tileKey(at.getX(), at.getY(), at.getZ()));
  }
  return site.tiles.filter(([x, y]) => !taken.has(tileKey(x, y, site.plane)));
}

/** Move one spot now. False when every tile of its site is held. */
function moveSpot(npc, random = Math.random) {
  const state = tracked.get(npc);
  if (!state) return false;
  state.due = rollDue(state.moveTicks, random);
  const free = freeTiles(npc, state.site);
  if (free.length === 0) return false;
  const from = npc.getLocation();
  const [x, y] = free[Math.floor(random() * free.length)];
  api.core.Sounds.playAreaSound({
    soundId: MOVE_SOUND, x: from.getX(), y: from.getY(), level: from.getZ(), radius: MOVE_SOUND_RANGE, source: npc,
  });
  npc.moveTo(new api.core.Location(x, y, from.getZ()));
  api.emitCustomEvent("fishing:spot-moved", { npc, from, to: npc.getLocation() });
  return true;
}

function processSpots(names) {
  tick++;
  if (tick >= nextScan) {
    scan(names);
    // Spawns join the world over the first ticks: look every tick until they're in, then now and then.
    nextScan = tick + (known.size === 0 && tick < SCAN_TICKS ? 1 : SCAN_TICKS);
  }
  for (const [npc, state] of tracked) {
    if (tick >= state.due) moveSpot(npc);
  }
}

/** True when this spot moves on its own timer (so a session on it needs no random stop). */
function isRelocating(npc) {
  return tracked.has(npc);
}

/** agent:advance-time: bring every spot's move `ms` closer. */
function advanceTime(event) {
  const ticks = Math.floor((event.ms ?? 0) / 600);
  if (ticks <= 0 || tracked.size === 0) return;
  for (const state of tracked.values()) state.due -= ticks;
  event.handledBy?.push?.("Fishing spot movement");
}

/**
 * spotTools(npc): the FishingTools of a spot's options, from Fishing.plugin.
 * names: the NPC names that are fishing spots.
 */
function attach(pluginApi, { spotTools, names }) {
  api = pluginApi;
  toolsOf = spotTools;
  api.getTaskManager().submit(new (class extends api.core.Task {
    constructor() { super(1); }
    execute() { processSpots(names); }
  })());
  api.onCustomEvent("agent:advance-time", advanceTime);
}

/** Tests: forget every tracked spot. */
function reset() {
  tracked.clear();
  known.clear();
  tick = 0;
  nextScan = 0;
}

module.exports = {
  attach, isRelocating, moveSpot, siteFor, moveTicksFor, freeTiles, track, processSpots, advanceTime, reset,
  SITES, DEFAULT_MOVE_TICKS, MOVE_SOUND, MOVE_SOUND_RANGE,
};
