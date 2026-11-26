// Adds captured loc teleports (ladders, stairs, caves, holes) that tsps lacks to
// plugins/world/data/loc-teleports.json, from the capture index's loc-teleports file
// (`python3 rsprox_index.py loc-teleports --out loc-teleports.json`).
//
//   yarn build
//   yarn sync:loc-teleports --captures loc-teleports.json                    # print what it would add
//   yarn sync:loc-teleports --captures loc-teleports.json --write            # add them
//   yarn sync:loc-teleports --captures loc-teleports.json --report out.json  # every loc's outcome, as JSON
//
// Each captured loc is clicked in a headless world with every plugin loaded (from the tile the
// capture shows the player clicked from, with 99s, a multiloc set to the variant that has the
// option) to see what tsps does now. A loc is added when tsps does nothing with it, or Ladders
// takes it and goes nowhere or elsewhere; see scripts/loc-teleport-matching.cjs for the rules
// and plugins/world/data/loc-teleport-sync.json for the lasting decisions. The LocTeleports
// plugin's own hooks are ignored while probing, so entries already added stay; nothing is
// removed and a second run adds nothing.
//
// Runs on dist/: `yarn build` first. Needs the cache in server/caches (`yarn ensure-cache`).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.resolve(__dirname, "..");
const PLUGIN_DATA = path.join(SERVER, "plugins", "world", "data");
const DATA_FILE = path.join(PLUGIN_DATA, "loc-teleports.json");
const DECISIONS_FILE = path.join(PLUGIN_DATA, "loc-teleport-sync.json");
/** Trapdoors that open by swapping the loc: an open one is only on the map once opened. */
const SWAPS_FILE = path.join(PLUGIN_DATA, "loc-swaps.json");
/** The plugin that plays the entries; ignored while probing (see above). */
const OWN_PLUGIN = "LocTeleports";
/** Ticks a probe waits for the move (the slowest captured loc teleports in 9). */
const PROBE_TICKS = 15;

const { choose, keyOf, toEntry, requirementFor, dialogueFor, crossingLines } = require("./loc-teleport-matching.cjs");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function format(data) {
  return `{\n  "$comment": ${JSON.stringify(data.$comment)},\n  "locs": [\n${data.locs.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]\n}\n`;
}

/** Boots the world without the network or the tick loop: cache, plugins, map regions on demand. */
async function bootWorld() {
  process.chdir(SERVER);
  const { Server } = require("../dist/Server");
  Server.installProductionPathResolver();
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(SERVER);
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const quiet = () => {};
  const saved = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = quiet;
  try {
    PluginManager.loadFromDirectory(path.join(SERVER, "plugins"));
    PluginManager.getCoreApi().RegionManager.init();
    PluginManager.emitServerStartup({ timestamp: Date.now() });
  } finally {
    [console.log, console.info, console.debug, console.warn] = saved;
  }
  return PluginManager;
}

function createProber(PluginManager) {
  const core = PluginManager.getCoreApi();
  const { World } = require("../dist/game/World");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  const { Skill } = require("../dist/game/model/Skill");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

  // Which plugin took the click (the hook that set `handled`); this script's own plugin is skipped.
  let handledBy = null;
  let claimedBy = null;
  const executeHook = PluginManager.executeHook;
  PluginManager.executeHook = function (hook, event, label, profile) {
    if (hook.pluginName === OWN_PLUGIN) return;
    const before = event?.handled;
    executeHook.call(PluginManager, hook, event, label, profile);
    if (label === "object_interaction" && !before && event?.handled && !claimedBy) handledBy = hook.pluginName;
    // Ladders asks the content that owns a ladder first: that content, not Ladders, has it.
    if (label === "custom_event:ladders:climb" && !before && event?.handled) handledBy = claimedBy = hook.pluginName;
  };

  /** The loc's definition with an option at `op`: a multiloc's first such variant, and the var that shows it. */
  function variant(id, op) {
    const cached = CacheDefinitions.getObject(id);
    if (!cached?.transforms) {
      const definition = ObjectDefinition.forId(id);
      return definition?.getInteractions?.()?.[op - 1] ? { definition } : null;
    }
    for (let index = 0; index < cached.transforms.length - 1; index++) {
      const definition = cached.transforms[index] === -1 ? null : ObjectDefinition.forId(cached.transforms[index]);
      if (definition?.getInteractions?.()?.[op - 1]) {
        return { definition, varbit: cached.transformVarbit, varp: cached.transformVarp, value: index };
      }
    }
    return null;
  }

  /** A real player with 99s whose packets go nowhere, except the vars multilocs read. */
  function probePlayer(at) {
    const player = new Player(null);
    player.setUsername("loc-probe");
    player.setLocation(new core.Location(at[0], at[1], at[2]));
    const messages = [];
    const varbits = new Map();
    const varps = new Map();
    const sender = new Proxy({}, {
      get: (target, key) => {
        if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
        if (key === "getVarp") return (id) => varps.get(id) ?? 0;
        if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), sender);
        if (key === "sendConfig") return (id, value) => (varps.set(id, value), sender);
        if (key === "sendMessage") return (text) => (messages.push(String(text)), sender);
        return () => sender;
      },
    });
    player.getPacketSender = () => sender;
    player.sendMessage = (text) => messages.push(String(text));
    player.isRegistered = () => true;
    for (const skill of Skill.values()) {
      const level = SkillManager.getMaxAchievingLevel(skill);
      player.getSkillManager().setCurrentLevels(skill, level).setMaxLevel(skill, level)
        .setExperience(skill, SkillManager.getExperienceForLevel(level));
    }
    return { player, messages, varbits, varps };
  }

  const swaps = JSON.parse(fs.readFileSync(SWAPS_FILE, "utf8")).swaps;

  /**
   * The loc as `player` sees it placed (a multiloc hidden at their vars isn't), or - for an open
   * trapdoor, only on the map once opened - the closed one swapped for it while probing
   * (`restore` puts the closed one back).
   */
  function placedOrOpened(player, id, location) {
    const placed = MapObjects.getPrivateArea(player, id, location);
    if (placed) return { object: placed, restore: () => {} };
    for (const swap of swaps.filter((candidate) => candidate.becomes === id)) {
      const closed = MapObjects.get(swap.id, location, null);
      if (!closed) continue;
      const replace = (from, to) => {
        core.ObjectManager.deregister(from, true);
        const next = new core.GameObject(to, new core.Location(location.getX(), location.getY(), location.getZ()), from.getType(), from.getFace(), null);
        core.ObjectManager.register(next, true);
        return next;
      };
      const opened = replace(closed, id);
      return { object: opened, restore: () => replace(opened, swap.id) };
    }
    return null;
  }

  /** Clicks the loc from `from` as the listener does after the walk; where did the player end up? */
  function probe(entry, destination, from) {
    core.RegionManager.loadMapFiles(entry.x, entry.y);
    const probed = probePlayer(from);
    const found = placedOrOpened(probed.player, entry.id, new core.Location(entry.x, entry.y, from[2]));
    if (!found) return { status: "not-on-map" };
    try {
      return probeObject(entry, destination, from, found.object, probed);
    } finally {
      found.restore();
    }
  }

  function probeObject(entry, destination, from, object, { player, messages, varbits, varps }) {
    const shown = variant(object.getId(), entry.op);
    if (!shown) return { status: "op-missing" };
    if (shown.varbit !== undefined) (shown.varbit !== -1 ? varbits.set(shown.varbit, shown.value) : varps.set(shown.varp, shown.value));
    const { definition } = shown;
    player.setPositionToFace(object.getLocation());
    handledBy = claimedBy = null;
    const quiet = () => {};
    const saved = [console.log, console.info, console.debug, console.warn];
    console.log = console.info = console.debug = console.warn = quiet;
    let handled;
    try {
      handled = PluginManager.emitObjectInteraction({
        player, object, definition, objectId: object.getId(), clickType: entry.op,
        location: { x: object.getLocation().getX(), y: object.getLocation().getY(), z: object.getLocation().getZ() },
        sourceLocation: { x: from[0], y: from[1], z: from[2] }, handled: false,
      });
      for (let tick = 0; tick < PROBE_TICKS; tick++) {
        World.processCycle = (World.processCycle + 1) & 0x7fffffff;
        player.getMovementQueue().process();
        core.TaskManager.process();
      }
    } finally {
      [console.log, console.info, console.debug, console.warn] = saved;
    }
    const at = player.getLocation();
    const landed = [at.getX(), at.getY(), at.getZ()];
    const moved = landed.some((value, index) => value !== from[index]);
    const near = Math.max(Math.abs(landed[0] - destination.x), Math.abs(landed[1] - destination.y)) <= 1 && landed[2] === destination.z;
    const stayed = from[0] === destination.x && from[1] === destination.y && from[2] === destination.z;
    const status = near && (moved || stayed) ? "same" : moved ? "different" : handled ? "handled-no-move" : "nothing";
    return {
      status, landed, handledBy, message: messages[0] ?? null,
      display: definition.getName(), option: definition.getInteractions()[entry.op - 1],
    };
  }

  return { probe };
}

async function main() {
  const capturesFile = argValue("--captures");
  if (!capturesFile) throw new Error("Give the capture file with --captures <file> (rsprox_index.py loc-teleports)");
  const write = process.argv.includes("--write");
  const reportFile = argValue("--report");

  const captures = JSON.parse(fs.readFileSync(capturesFile, "utf8")).locs.filter((entry) => Number.isInteger(entry.id));
  const decisions = JSON.parse(fs.readFileSync(DECISIONS_FILE, "utf8"));
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  // A Windows checkout may have CRLF line ends (git converts them back on commit).
  if (format(data) !== fs.readFileSync(DATA_FILE, "utf8").replace(/\r\n/g, "\n")) throw new Error(`${DATA_FILE} isn't in the expected one-loc-per-line format; not touching it`);
  const existing = new Set(data.locs.map((entry) => keyOf(entry.x, entry.y, entry.z, entry.op)));

  const PluginManager = await bootWorld();
  const { probe } = createProber(PluginManager);
  const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
  const sequenceIds = new Map([...new Gamevals().namesOf(GamevalKind.SEQ)].map(([id, name]) => [name, id]));

  const added = [];
  const report = [];
  const reasons = new Map();
  for (const entry of captures) {
    if (existing.has(keyOf(entry.x, entry.y, entry.z, entry.op))) continue;
    // Labelled locs (instances, boats, agility) are left out before probing.
    const sides = (entry.labels ?? []).some((label) => label !== "special-world") || !entry.teleports ? [] : (entry.destinations ?? []).map((destination) => {
      const from = destination.from?.[0] ?? destination.teleported_from?.[0] ?? [entry.x, entry.y, entry.z];
      try {
        return { from, to: [destination.x, destination.y, destination.z], ...probe(entry, destination, from) };
      } catch (error) {
        return { from, status: "error", error: String(error?.message ?? error) };
      }
    });
    const display = sides.find((side) => side.display)?.display ?? entry.display;
    const option = sides.find((side) => side.option)?.option ?? entry.option;
    const verdict = choose(entry, sides, display, decisions);
    report.push({ name: entry.name, id: entry.id, display, option, op: entry.op, x: entry.x, y: entry.y, z: entry.z,
      recordings: entry.recordings, take: verdict.take, reason: verdict.reason ?? null, sides });
    if (!verdict.take) {
      reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
      continue;
    }
    const sequenceId = entry.sequence ? sequenceIds.get(entry.sequence) ?? null : null;
    added.push(toEntry(entry, { display, option, sequenceId, gate: requirementFor(entry, decisions), asked: dialogueFor(entry, decisions) }));
  }

  // Gates are decisions: they apply to entries already in the data too (every placement of a name).
  let gated = 0;
  const gatedLocs = data.locs.map((entry) => {
    const gate = requirementFor(entry, decisions);
    const requires = gate?.requires;
    const mesbox = gate?.mesbox;
    if (JSON.stringify(entry.requires) === JSON.stringify(requires) && entry.mesbox === mesbox) return entry;
    gated++;
    const { requires: oldRequires, mesbox: oldMesbox, recordings, ...rest } = entry;
    return { ...rest, ...(requires ? { requires } : {}), ...(mesbox ? { mesbox } : {}), recordings };
  });

  // A crossing's lines are captured data: they apply to entries already in the data too. An entry
  // whose `message` was set by hand keeps it and gets no `messages`.
  const captured = new Map(captures.map((entry) => [`${entry.name}:${keyOf(entry.x, entry.y, entry.z, entry.op)}`, entry]));
  let voiced = 0;
  const locsWithLines = gatedLocs.map((entry) => {
    const capture = captured.get(`${entry.name}:${keyOf(entry.x, entry.y, entry.z, entry.op)}`);
    const lines = capture && entry.message === undefined && !entry.sides ? crossingLines(capture) : entry.messages ?? [];
    if (JSON.stringify(entry.messages ?? []) === JSON.stringify(lines)) return entry;
    voiced++;
    const { messages: oldMessages, recordings, ...rest } = entry;
    return { ...rest, ...(lines.length ? { messages: lines } : {}), recordings };
  });

  console.log(`Captured locs: ${captures.length}; already in the data: ${existing.size}; to add: ${added.length}; gates changed on existing entries: ${gated}; messages changed on existing entries: ${voiced}`);
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  left out, ${reason}: ${count}`);
  const byKind = new Map();
  for (const entry of added) byKind.set(entry.display, (byKind.get(entry.display) ?? 0) + 1);
  console.log(`  to add by name: ${[...byKind].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(", ")}`);
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), locs: report }));
  if (!write) {
    console.log(added.length || gated || voiced ? "Dry run: add --write to write them." : "Nothing to add.");
    process.exit(0);
  }
  const locs = [...locsWithLines, ...added].sort((a, b) => a.name.localeCompare(b.name) || a.x - b.x || a.y - b.y || a.z - b.z || a.op - b.op);
  fs.writeFileSync(DATA_FILE, format({ ...data, locs }));
  console.log(`Added ${added.length} loc(s) to ${path.relative(process.cwd(), DATA_FILE)}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
