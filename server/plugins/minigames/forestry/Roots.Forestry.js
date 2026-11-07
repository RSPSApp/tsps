/**
 * Rising Roots, as recorded (rsprox 227/01850 t7914-8120; forestry.json `roots`):
 * - six roots rise within four tiles of the tree, each at a random rotation with its rise sound
 *   (sound_area 7002, range 4) on its tile;
 * - waves come every 21-29 ticks; 7 ticks before one, 2-4 roots sink (their despawn anim and
 *   sound_area 7007, range 2), the last wave's anima root always among them; the wave deletes
 *   just those and raises as many, one anima-infused from the second wave on, so six stand;
 * - at 199 ticks every root sinks, and they go 7 ticks later; chopping carries on until then;
 * - Chop down: "You swing your axe at the roots." with the axe anim, the anim again 2 ticks on
 *   and every 4 after, a bark award the tick after each; the root stays until the event takes it.
 * Wiki: normal roots give 2-3 bark (Woodcutting 15-40) or 3-4 (41+), anima roots 8-10 or 11-13;
 * 0.55 x the Woodcutting level in XP a normal root, 1.2 x an anima one.
 * Inferred: an award a chop at a willow's chance (live never failed one, perhaps a Leagues effect).
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");
const Woodcutting = require("../../skills/Woodcutting.plugin");

const R = () => Common.data.roots;
/** Root events now on the map, until their last roots are gone. */
const events = new Set();
/** Players chopping a root -> { event, root, axe, next, bark: { at, event, kind } | null, from }. */
const sessions = new Map();

let cycle = 0;

function rootTiles(event) {
  const { range } = R();
  const { site } = event;
  const [x0, y0, z] = [site.location.getX(), site.location.getY(), site.location.getZ()];
  const taken = [...event.roots].map((root) => root.object.getLocation());
  const tiles = [];
  for (let x = x0 - range; x < x0 + site.size + range; x++) {
    for (let y = y0 - range; y < y0 + site.size + range; y++) {
      const tile = new Common.core.Location(x, y, z);
      if (Common.walkable(x, y, z) && !taken.some((at) => at.equals(tile))) tiles.push(tile);
    }
  }
  return tiles;
}

function start(site) {
  const event = { site, roots: new Set(), elapsed: 0, waves: 0, nextWave: 0, sinking: [], over: false };
  if (rootTiles(event).length < R().first) return null;
  events.add(event);
  rise(event, R().first, false);
  scheduleWave(event);
  Common.every(() => tick(event));
  return event;
}

/** `count` new roots rise, one anima-infused when `anima`. */
function rise(event, count, anima) {
  const { locs, seqs, sounds, soundRange } = R();
  const tiles = rootTiles(event);
  for (let i = 0; i < count && tiles.length; i++) {
    const at = tiles.splice(Common.randomInt(0, tiles.length - 1), 1)[0];
    const kind = anima && i === 0 ? "anima" : "normal";
    const object = Common.placeLoc(locs[kind], at, Common.randomInt(0, 3));
    Common.locAnim(object, seqs.spawn);
    Common.areaSound(at, sounds.rise, soundRange.rise);
    event.roots.add({ object, kind, sinking: false });
  }
  event.waves++;
}

function scheduleWave(event) {
  event.nextWave = event.elapsed + Common.randomInt(...R().waveTicks);
}

function sink(root) {
  const { seqs, sounds, soundRange } = R();
  root.sinking = true;
  Common.locAnim(root.object, seqs.despawn);
  Common.areaSound(root.object.getLocation(), sounds.sink, soundRange.sink);
}

/** 2-4 roots sink ahead of the wave: the anima one first, the rest at random. */
function sinkSome(event) {
  const standing = [...event.roots].filter((root) => !root.sinking);
  const count = Math.min(standing.length, Common.randomInt(...R().wave));
  const chosen = standing.filter((root) => root.kind === "anima").slice(0, count);
  const rest = standing.filter((root) => root.kind !== "anima");
  while (chosen.length < count && rest.length) chosen.push(rest.splice(Common.randomInt(0, rest.length - 1), 1)[0]);
  chosen.forEach(sink);
  event.sinking = chosen;
}

/** The sunk roots go, and as many rise in their place. */
function wave(event) {
  const gone = event.sinking;
  event.sinking = [];
  for (const root of gone) remove(event, root);
  rise(event, gone.length, true);
  scheduleWave(event);
}

function remove(event, root) {
  event.roots.delete(root);
  Common.removeLoc(root.object);
}

function tick(event) {
  event.elapsed++;
  const { lifeTicks, sinkTicks } = R();
  if (event.over) {
    if (event.elapsed < lifeTicks + sinkTicks) return true;
    for (const root of [...event.roots]) remove(event, root);
    events.delete(event);
    return false;
  }
  if (event.elapsed >= lifeTicks) {
    end(event);
    return true;
  }
  if (event.nextWave < lifeTicks) {
    if (event.elapsed === event.nextWave - sinkTicks) sinkSome(event);
    if (event.elapsed === event.nextWave) wave(event);
  }
  return true;
}

/** Every root sinks; they stay choppable until they go, `sinkTicks` later. */
function end(event) {
  event.over = true;
  for (const root of event.roots) if (!root.sinking) sink(root);
  Spawns.ended(event);
}

function rootAt(object) {
  for (const event of events) {
    for (const root of event.roots) {
      if (root.object.getLocation().equals(object.getLocation())) return { event, root };
    }
  }
  return null;
}

function chop({ player, object }) {
  const found = rootAt(object);
  if (!found) return false;
  const axe = Woodcutting.findBestUsableAxe(player);
  if (!axe) {
    player.sendMessage(Common.message("noAxe"));
    return true;
  }
  Woodcutting.stopWoodcutting?.(player);
  Common.spam(player, Common.message("swingRoots"));
  player.setPositionToFace?.(object.getLocation());
  player.performAnimation(new Common.core.Animation(axe.animationId));
  // Moving on from another root keeps its rhythm (rsprox 227/01850 t7941, t7945).
  const held = sessions.get(player);
  const next = held ? held.next : cycle + R().chopFirst;
  sessions.set(player, { ...found, axe, next, bark: held?.bark ?? null, from: player.getLocation().clone() });
  return true;
}

let willow = null;

function cutChance(player, axe) {
  willow ??= Woodcutting.TREES.find((tree) => tree.objectNames.includes("Willow tree"));
  return Woodcutting.calculateCutChance(Common.level(player, "WOODCUTTING"), willow, axe);
}

/** The bark band for the player's level; a boost past 99 stays in the top band. */
function rootReward(player, kind) {
  const level = Common.level(player, "WOODCUTTING");
  const bands = R().bark[kind];
  const [, low, high] = bands.find(([upTo]) => level <= upTo) ?? bands[bands.length - 1];
  return Common.randomInt(low, high);
}

function award(player, { event, kind }) {
  if (!Spawns.eligible(event, player)) {
    Common.xp(player, "WOODCUTTING", 1);
    return;
  }
  Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * R().xpPerLevel[kind]);
  Common.bark(player, rootReward(player, kind));
}

/** The axe anim every four ticks while the root stands and the player stays put; bark the tick after a good chop. */
function chopTick() {
  cycle++;
  for (const [player, session] of sessions) {
    if (session.bark?.at === cycle) {
      award(player, session.bark);
      session.bark = null;
    }
    if (!player.isRegistered?.() || !session.event.roots.has(session.root) || !player.getLocation().equals(session.from)) {
      sessions.delete(player);
      continue;
    }
    if (cycle < session.next) continue;
    session.next = cycle + R().chopTicks;
    // The axe is looked up again each swing, as tree chopping does: a dropped or banked axe ends the chop.
    const axe = Woodcutting.findBestUsableAxe(player);
    if (!axe) {
      player.sendMessage(Common.message("noAxe"));
      sessions.delete(player);
      continue;
    }
    session.axe = axe;
    player.performAnimation(new Common.core.Animation(session.axe.animationId));
    if (Math.random() >= cutChance(player, session.axe)) continue;
    session.bark = { at: cycle + R().barkDelay, event: session.event, kind: session.root.kind };
  }
}

function forget({ player }) {
  sessions.delete(player);
}

/** Starting on a tree ends a root chop. */
function choppingTree(request) {
  if (request.allow) sessions.delete(request.player);
}

function attachRoots(api) {
  Spawns.registerEvent("roots", { start });
  api.onObjectInteraction("Tree roots", { "Chop down": chop });
  api.onObjectInteraction("Anima-infused Tree roots", { "Chop down": chop });
  api.onPlayerLogout(forget);
  api.onCustomEvent("woodcutting:validate-tree", choppingTree);
  Common.every(chopTick);
}

module.exports = { attachRoots, start, chop, chopTick, events, sessions };
