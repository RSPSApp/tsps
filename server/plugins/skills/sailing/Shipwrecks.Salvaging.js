// The shipwrecks at sea. The cache map places every wreck sunk; at each site some are raised
// (their "Inspect" loc), and a wreck someone salvages sinks again once its time is up, while
// another of the site's sunken wrecks rises (OSRS Wiki, Shipwreck salvaging). Sites, their
// wrecks and each type's timings are in sailing-salvage.json (docs/sailing-osrs-reference.md).
// A wreck sinks with its type's sinking animation, the next one rises a tick later with its
// rising one, and each settles into its idle two ticks after its transition.
const { GameObject } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { World } = require("../../../src/main/typescript/elvarg/game/World");
const { content } = require("./SailingContent.Sailing");

const LOC_SHAPE = 10;
const SECONDS_PER_TICK = 0.6;
/** Ticks from a wreck's sinking until another rises. */
const RISE_DELAY = 1;
/** Ticks from a sinking or rising animation until the wreck's idle one. */
const SETTLE_DELAY = 2;

/** Every wreck spot: its site, type, where it is, and whether it's raised and until when. */
let wrecks = [];
let tick = 0;

function wreckType(type) {
  return content().salvage.wrecks[type];
}

function place(wreck, locId) {
  ObjectManager.register(
    new GameObject(locId, new Location(wreck.x, wreck.y, wreck.z), LOC_SHAPE, wreck.rotation, null), true);
}

/** Plays a loc animation on a wreck for every player who sees its tile. */
function animate(wreck, seq) {
  if (seq === undefined) return;
  const drawn = new GameObject(wreck.raised ? wreckType(wreck.type).active : wreckType(wreck.type).sunken,
    new Location(wreck.x, wreck.y, wreck.z), LOC_SHAPE, wreck.rotation, null);
  World.forEachNetworkPlayer((viewer) => {
    const area = viewer.getPrivateArea?.();
    if (area && !area.countsAsMainWorld?.()) return;
    if (!viewer.getSession?.()?.isTileInScene?.(wreck.x, wreck.y, wreck.z)) return;
    viewer.getPacketSender().sendObjectAnimation(drawn, new Animation(seq));
  });
}

/** Swaps a wreck to its other form, with its transition and, two ticks on, its idle. */
function transition(wreck, raised) {
  const type = wreckType(wreck.type);
  wreck.raised = raised;
  place(wreck, raised ? type.active : type.sunken);
  animate(wreck, raised ? type.seqs?.rise : type.seqs?.sink);
  wreck.settlesAt = tick + SETTLE_DELAY;
}

function raise(wreck) {
  wreck.raised = true;
  wreck.sinksAt = undefined;
  wreck.risesAt = undefined;
  place(wreck, wreckType(wreck.type).active);
}

/**
 * Sinks a wreck; a tick later another of its site's sunken wrecks rises. Ours: a site with no
 * other sunken wreck raises the same one again.
 */
function sink(wreck, random = Math.random) {
  wreck.sinksAt = undefined;
  wreck.generation++;
  transition(wreck, false);
  const waiting = (other) => other.site === wreck.site && !other.raised && other.risesAt === undefined;
  const others = wrecks.filter((other) => other !== wreck && waiting(other));
  const sunken = others.length ? others : [wreck];
  sunken[Math.floor(random() * sunken.length)].risesAt = tick + RISE_DELAY;
}

function onTick() {
  tick++;
  for (const wreck of wrecks) {
    if (!wreck.raised && wreck.risesAt !== undefined && tick >= wreck.risesAt) {
      wreck.risesAt = undefined;
      transition(wreck, true);
    } else if (wreck.raised && wreck.sinksAt !== undefined && tick >= wreck.sinksAt) {
      sink(wreck);
    } else if (wreck.settlesAt !== undefined && tick >= wreck.settlesAt) {
      wreck.settlesAt = undefined;
      const seqs = wreckType(wreck.type).seqs;
      animate(wreck, wreck.raised ? seqs?.idle : seqs?.sunkenIdle);
    }
  }
}

/** Raises each site's share of wrecks and starts the timer that sinks salvaged ones. */
function start(random = Math.random) {
  wrecks = content().salvage.sites.flatMap((site, index) =>
    site.wrecks.map((spot) => ({ ...spot, site: index, type: site.type, raised: false, sinksAt: undefined, risesAt: undefined, settlesAt: undefined, generation: 0 })));
  content().salvage.sites.forEach((site, index) => {
    const spots = wrecks.filter((wreck) => wreck.site === index);
    for (let raised = 0; raised < Math.min(site.active, spots.length); raised++) {
      const sunken = spots.filter((wreck) => !wreck.raised);
      raise(sunken[Math.floor(random() * sunken.length)]);
    }
  });
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { onTick(); }
  })());
}

/** The first salvage starts a wreck's despawn timer (the wreck type's duration). */
function startDespawn(wreck) {
  if (wreck.sinksAt !== undefined) return;
  wreck.sinksAt = tick + Math.round(wreckType(wreck.type).despawnSeconds / SECONDS_PER_TICK);
}

/** Tiles from a world tile to the nearest tile of a wreck's footprint. */
function distanceTo(wreck, x, y) {
  const loc = CacheDefinitions.getObject(wreckType(wreck.type).active);
  const turned = (wreck.rotation & 1) === 1;
  const width = (turned ? loc?.sizeY : loc?.sizeX) ?? 1;
  const length = (turned ? loc?.sizeX : loc?.sizeY) ?? 1;
  const dx = Math.max(wreck.x - x, 0, x - (wreck.x + width - 1));
  const dy = Math.max(wreck.y - y, 0, y - (wreck.y + length - 1));
  return Math.max(dx, dy);
}

/** The nearest raised wreck within `range` tiles of a world tile, or undefined. */
function raisedWreckNear(x, y, level, range) {
  return wreckNear(x, y, level, range, true);
}

/** The nearest sunken (plundered) wreck within `range` tiles of a world tile, or undefined. */
function sunkenWreckNear(x, y, level, range) {
  return wreckNear(x, y, level, range, false);
}

function wreckNear(x, y, level, range, raised) {
  let nearest;
  let nearestDistance = Infinity;
  for (const wreck of wrecks) {
    if (wreck.raised !== raised || wreck.z !== level) continue;
    const distance = distanceTo(wreck, x, y);
    if (distance <= range && distance < nearestDistance) {
      nearest = wreck;
      nearestDistance = distance;
    }
  }
  return nearest;
}

module.exports = { start, sink, startDespawn, raisedWreckNear, sunkenWreckNear, distanceTo, wreckType, all: () => wrecks, onTick,
  /** The wreck spot whose raised loc is at a world tile, or undefined. */
  raisedWreckAt: (x, y, level) => wrecks.find((wreck) => wreck.raised && wreck.x === x && wreck.y === y && wreck.z === level) };
