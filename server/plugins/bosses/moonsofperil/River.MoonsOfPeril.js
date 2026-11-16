/**
 * Bream from Neypotzli's two river spots (docs/moons-of-peril.md), data `river`. In the rev 241
 * cache this is the shared river fishing: the spot (river_fishing_spot) is a "Fishing spot" to
 * Fish from while river_fishing_is_fishing is 0, and then it and the stream's click zones
 * (river_fishing_clickzone) are "Stream" tiles to Align-net in, which sets river_fishing_dir to
 * the zone's lane. As captured, the fish swim down the three lanes (pmoon_fish, two legs of 90
 * and 80 cycles); one that reaches the net's lane is caught - always one bream, a second on a
 * skilling roll ("You manage to catch an additional fish!"); 20 Fishing and a big fishing net
 * (Wiki). Fishing stops on walking away, a full inventory, or 30 seconds without a click.
 *
 * The same river fishing is Vampyrium's leechfin (Wiki: Leechfin, Fishing spot (river)): a spot may carry a
 * `method` whose entry in `river.methods` lays its own settings over the bream ones (level, item, gate, success
 * chart, fish rhythm). A spot without one is a bream spot, exactly as before. Cutting a leechfin and squeezing
 * its sacs are in skills/LeechfinFishing.plugin.js.
 */
const Common = require("./Common.MoonsOfPeril");

const river = () => Common.data.river;
const itemId = (name) => Common.core.ItemIdentifiers[name];

/** Per player: their spot, lane, the tick of their last click and where they stand. */
const fishers = new Map();
let task = null;
let tick = 0;
/** Fish on their way, per spot: { lane, arrives }. */
const swimming = new Map();
/** Per spot with a fish pattern: the lanes still to come in the running cycle, and when the next cycle starts. */
const rhythm = new Map();

/** A spot's settings: the bream ones, with its own `method` laid over them (leechfin). */
function methodOf(spot) {
  return spot.method ? { ...river(), ...river().methods[spot.method] } : river();
}

/** Bream's spots wait for the Moons of Peril gathering; a method names the quest that opens its own. */
function isOpen(spot, player) {
  const { gate } = methodOf(spot);
  if (!gate) return require("./Camps.MoonsOfPeril").afterGathering(player);
  const done = { player, key: gate, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", done);
  return done.complete === true;
}

/**
 * The lanes of one cycle of fish. `pattern` is [count, "same" | "different"] groups: in a "same" group
 * every fish takes one lane, in a "different" group each takes a lane other than the fish before it.
 */
function patternLanes(pattern, lanes, random = Math.random) {
  const out = [];
  const other = (not) => {
    if (lanes < 2) return 0;
    let lane;
    do lane = Math.floor(random() * lanes); while (lane === not);
    return lane;
  };
  for (const [count, kind] of pattern) {
    const shared = Math.floor(random() * lanes);
    for (let fish = 0; fish < count; fish++) out.push(kind === "same" ? shared : other(out.at(-1)));
  }
  return out;
}

function spotAt(x, y) {
  return river().spots.find((spot) => {
    const { zones } = spot;
    return (x === spot.tile[0] && y === spot.tile[1])
      || (x >= zones.x[0] && x <= zones.x[1] && y >= zones.y[0] && y <= zones.y[1]);
  }) ?? null;
}

function laneOf(spot, x, y) {
  const lane = spot.lanes.indexOf(spot.axis === "x" ? x : y);
  return lane >= 0 ? lane : 1;
}

function setFishing(player, fishing, lane = 1) {
  const { varbits } = river();
  player.getPacketSender().sendVarbit(varbits.fishing, fishing ? 1 : 0);
  if (fishing) player.getPacketSender().sendVarbit(varbits.dir, lane);
}

function stop(player) {
  if (!fishers.delete(player)) return;
  if (player.isRegistered()) {
    setFishing(player, false);
    player.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
  }
}

// ------------------------------------------------------------------ clicks

function isRiverObject(objectId) {
  const { spot, zone } = river();
  return objectId === spot || objectId === zone;
}

/** Aligning the net acts where the player stands: no walk into the stream. */
function routeInPlace(event) {
  if (!isRiverObject(event.objectId) || !fishers.has(event.player)) return;
  const here = event.player.getLocation();
  event.destination = { x: here.getX(), y: here.getY(), z: here.getZ() };
}

function onRiver(event) {
  if (!isRiverObject(event.objectId)) return;
  const { player, location } = event;
  const spot = spotAt(location.x, location.y);
  if (!spot || !isOpen(spot, player)) return;
  event.handled = true;
  const fishing = fishers.get(player);
  if (fishing) {
    align(player, fishing, laneOf(spot, location.x, location.y));
    return;
  }
  if (event.objectId !== river().spot) {
    player.sendMessage(river().notFishing);
    return;
  }
  start(player, spot);
}

function start(player, spot) {
  const s = methodOf(spot);
  const { Skill } = Common.core;
  if (player.getSkillManager().getCurrentLevel(Skill.FISHING) < s.level) {
    player.sendMessage(s.lowLevel);
    return;
  }
  if (!player.getInventory().contains(itemId(s.net))) {
    player.sendMessage(s.noNet);
    return;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage(s.fullMessage);
    return;
  }
  const lane = 1;
  fishers.set(player, { spot, lane, clicked: tick, at: player.getLocation().clone(), animAt: 0 });
  setFishing(player, true, lane);
  Common.animate(player, s.anim);
  ensureTask();
}

function align(player, fishing, lane) {
  fishing.lane = lane;
  fishing.clicked = tick;
  player.getPacketSender().sendVarbit(river().varbits.dir, lane);
}

// ------------------------------------------------------------------ the fish

function ensureTask() {
  if (task) return;
  const { Task, TaskManager } = Common.core;
  task = new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick++;
      if (fishers.size === 0) {
        task = null;
        swimming.clear();
        rhythm.clear();
        this.stop();
        return;
      }
      process();
    }
  })();
  TaskManager.submit(task);
}

function process() {
  const s = river();
  for (const [player, fishing] of [...fishers]) {
    if (!player.isRegistered() || !player.getLocation().equals(fishing.at) || tick - fishing.clicked > methodOf(fishing.spot).timeout) {
      stop(player);
      continue;
    }
    // The looping net animation, kept up.
    if (tick - fishing.animAt >= 5) {
      fishing.animAt = tick;
      Common.animate(player, methodOf(fishing.spot).anim);
    }
  }
  for (const spot of s.spots) {
    const watchers = [...fishers].filter(([, fishing]) => fishing.spot === spot).map(([player]) => player);
    if (watchers.length === 0) continue;
    if (tick % methodOf(spot).every === 0 && tick >= (rhythm.get(spot)?.resumes ?? 0)) release(spot, watchers);
    const fish = swimming.get(spot) ?? [];
    for (const swimmer of [...fish]) {
      if (swimmer.arrives > tick) continue;
      fish.splice(fish.indexOf(swimmer), 1);
      for (const player of watchers) {
        if (fishers.get(player)?.lane === swimmer.lane) catchFish(player, spot);
      }
    }
  }
}

/** A fish sets off down a random lane: its two legs as captured, seen by those fishing there. */
function release(spot, watchers) {
  const s = methodOf(spot);
  const lane = nextLane(spot, s);
  const fish = swimming.get(spot) ?? [];
  fish.push({ lane, arrives: tick + s.arrive });
  swimming.set(spot, fish);
  const along = spot.axis === "x" ? [spot.lanes[lane], spot.tile[1]] : [spot.tile[0], spot.lanes[lane]];
  const points = spot.path.map(([dx, dy]) => new Common.core.Location(along[0] + dx, along[1] + dy, 0));
  const legs = [[points[0], points[1], s.legs[0]], [points[1], points[2], s.legs[1]]];
  legs.forEach(([from, to, end], index) => {
    Common.later(index === 0 ? 0 : 1, () => {
      for (const player of watchers) {
        if (!player.isRegistered()) continue;
        Common.projectile(player, from, to, { id: s.fish, start: 0, end, angle: 255, progress: 0, startHeight: 0, endHeight: 0 });
      }
    });
  });
}

/** The next fish's lane: random, or from the method's pattern (a pause after each cycle). */
function nextLane(spot, s) {
  if (!s.pattern) return Common.randomInt(0, spot.lanes.length - 1);
  let state = rhythm.get(spot);
  if (!state || state.lanes.length === 0) {
    state = { lanes: patternLanes(s.pattern, spot.lanes.length), resumes: 0 };
    rhythm.set(spot, state);
  }
  const lane = state.lanes.shift();
  if (state.lanes.length === 0) state.resumes = tick + s.lull + 1; // `lull` quiet ticks, then the next cycle
  return lane;
}

/** A leechfin cast: the success chart's chance, the fish and its XP, or the slip and a little XP. */
function catchMethod(player, s) {
  const { Skill, Item } = Common.core;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage(s.fullMessage);
    stop(player);
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(Skill.FISHING);
  const [low, high] = s.rolls;
  const roll = Math.min(1, (1 + Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5)) / 256);
  if (Math.random() >= roll) {
    player.getSkillManager().addExperience(Skill.FISHING, s.failXp, true);
    player.sendMessage(s.failMessage);
    return;
  }
  player.getInventory().add(new Item(Common.core.CacheDefinitions.getObjId(s.item), 1), true);
  player.getSkillManager().addExperience(Skill.FISHING, s.xp * require("../../skills/Fishing.plugin").anglerXpMultiplier(player), true);
}

function catchFish(player, spot) {
  const s = methodOf(spot);
  if (s.item) return catchMethod(player, s);
  const { Skill, Item } = Common.core;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(s.fullMessage);
    stop(player);
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(Skill.FISHING);
  const { chance } = require("./Camps.MoonsOfPeril");
  inventory.add(new Item(itemId("RAW_BREAM"), 1), true);
  player.getSkillManager().addExperience(Skill.FISHING, s.xp, true);
  if (inventory.getFreeSlots() < 1 || Math.random() >= chance(level, s.level, s.extra)) return;
  inventory.add(new Item(itemId("RAW_BREAM"), 1), true);
  const [low, high] = s.extraXp;
  player.getSkillManager().addExperience(Skill.FISHING, Math.round(low + (high - low) * Math.max(0, Math.min(1, (level - s.level) / (99 - s.level)))), true);
  player.sendMessage(s.extraMessage);
}

/** Any walk ends the fishing. */
function onWalk({ player }) {
  stop(player);
}

function onLogout({ player }) {
  fishers.delete(player);
}

/** Cutting a fish (or any other work with it in hand) ends the fishing. */
function onInterrupt({ player }) {
  stop(player);
}

module.exports = function attachRiver(api) {
  api.onObjectRoute(routeInPlace);
  api.onObjectInteraction(onRiver);
  api.onWalkRoute(onWalk);
  api.onPlayerLogout(onLogout);
  api.onCustomEvent("river-fishing:stop", onInterrupt);
};
module.exports.patternLanes = patternLanes;
/** For tests: the unit's running state back to nothing. */
module.exports._test = {
  reset() {
    fishers.clear();
    swimming.clear();
    rhythm.clear();
    task = null;
  },
};
