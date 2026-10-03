// The shipwrecks at sea. The cache map places every wreck sunk; at each site some are raised
// (their "Inspect" loc), and a wreck someone salvages sinks again once its time is up, while
// another of the site's sunken wrecks rises (OSRS Wiki, Shipwreck salvaging). Sites, their
// wrecks and each type's timings are in sailing-salvage.json (docs/sailing-osrs-reference.md).
const { GameObject } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { ObjectManager } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/ObjectManager");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { content } = require("./sailingContent");

const LOC_SHAPE = 10;
const SECONDS_PER_TICK = 0.6;

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

function raise(wreck) {
  wreck.raised = true;
  wreck.sinksAt = undefined;
  place(wreck, wreckType(wreck.type).active);
}

/** Sinks a wreck and raises another of its site's sunken ones. */
function sink(wreck, random = Math.random) {
  wreck.raised = false;
  wreck.sinksAt = undefined;
  wreck.generation++;
  place(wreck, wreckType(wreck.type).sunken);
  const sunken = wrecks.filter((other) => other.site === wreck.site && !other.raised && other !== wreck);
  if (sunken.length) raise(sunken[Math.floor(random() * sunken.length)]);
}

function onTick() {
  tick++;
  for (const wreck of wrecks) {
    if (wreck.raised && wreck.sinksAt !== undefined && tick >= wreck.sinksAt) sink(wreck);
  }
}

/** Raises each site's share of wrecks and starts the timer that sinks salvaged ones. */
function start(random = Math.random) {
  wrecks = content().salvage.sites.flatMap((site, index) =>
    site.wrecks.map((spot) => ({ ...spot, site: index, type: site.type, raised: false, sinksAt: undefined, generation: 0 })));
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
  let nearest;
  let nearestDistance = Infinity;
  for (const wreck of wrecks) {
    if (!wreck.raised || wreck.z !== level) continue;
    const distance = distanceTo(wreck, x, y);
    if (distance <= range && distance < nearestDistance) {
      nearest = wreck;
      nearestDistance = distance;
    }
  }
  return nearest;
}

module.exports = { start, sink, startDespawn, raisedWreckNear, distanceTo, wreckType, all: () => wrecks, onTick };
