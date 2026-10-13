/**
 * Corpse Flowers, as captured: she leaves, comes back at the centre two ticks later, and three ticks
 * after that splits the arena with a cross of flowers through (3872, 9951). One quadrant, the one
 * between two lines of white petals, is safe; the other lines are red berries. Ticks from her
 * segment animation: the flowers planted on 1, the message and their growth on 3, ready on 4,
 * opening on 8 and active from 9 to 29, when they wither.
 *
 * While they're open, anyone in a quadrant a berry line borders is hit by flies from each such
 * line every tick, up to 20, and she heals twice that; their attacks on her heal her instead
 * (Wiki). Phosani's comes with a run of her claws nine ticks after the segment animation.
 */
const Common = require("./Common.Nightmare");

const QUADRANTS = { ne: ["north", "east"], nw: ["north", "west"], se: ["south", "east"], sw: ["south", "west"] };

/** The cross's tiles: each arm, from the centre out, and the centre itself. */
function crossTiles() {
  const [cx, cy] = Common.data.flowers.cross;
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const arms = { north: [], south: [], east: [], west: [] };
  for (let y = cy + 1; y <= maxY; y++) arms.north.push([cx, y]);
  for (let y = cy - 1; y >= minY; y--) arms.south.push([cx, y]);
  for (let x = cx + 1; x <= maxX; x++) arms.east.push([x, cy]);
  for (let x = cx - 1; x >= minX; x--) arms.west.push([x, cy]);
  return arms;
}

function start(fight) {
  const { flowers } = Common.data;
  const boss = fight.boss;
  const players = fight.players();
  boss.performAnimation(Common.animation(flowers.leaveAnim));
  boss.getMovementQueue().setBlockMovement(true).reset();
  for (const player of players) Common.sounds(player, flowers.leaveSounds);
  const safe = Common.pick(Object.keys(QUADRANTS));
  fight.flowers = { safe, active: false, locs: [], segmentAt: fight.tick + flowers.returnTicks + flowers.segmentTicks };
  fight.at(flowers.returnTicks, () => {
    if (!fight.flowers) return;
    boss.moveTo(fight.dream.tile(Common.data.arena.centre));
    boss.performAnimation(Common.animation(flowers.returnAnim));
    for (const player of fight.players()) Common.sounds(player, [flowers.returnSound]);
  });
  fight.at(flowers.returnTicks + flowers.segmentTicks, () => segment(fight));
  const chainAt = 9;
  if (fight.phosani) {
    const { chain } = Common.data.claws;
    fight.at(flowers.returnTicks + flowers.segmentTicks + chainAt, () => fight.flowers && require("./Claws.Nightmare").chain(fight));
    return flowers.returnTicks + flowers.segmentTicks + chainAt + chain.every * chain.count + 6;
  }
  return flowers.returnTicks + flowers.segmentTicks + Common.data.specials.after.flowers;
}

function segment(fight) {
  const state = fight.flowers;
  if (!state || fight.stopped) return;
  const { flowers } = Common.data;
  fight.boss.performAnimation(Common.animation(flowers.anim));
  fight.boss.getMovementQueue().setBlockMovement(false);
  for (const player of fight.players()) Common.sounds(player, flowers.sounds);
  const arms = crossTiles();
  const safeArms = new Set(QUADRANTS[state.safe]);
  const tiles = [{ tile: Common.data.flowers.cross, safe: true }];
  for (const [arm, list] of Object.entries(arms)) for (const tile of list) tiles.push({ tile, safe: safeArms.has(arm), arm });
  state.arms = arms;
  state.safeArms = safeArms;
  fight.at(flowers.initialTicks, () => place(fight, tiles, 0));
  fight.at(flowers.messageTicks, () => {
    if (fight.flowers !== state) return;
    for (const player of fight.players()) player.sendMessage(flowers.message);
    animate(fight, "spawn");
  });
  fight.at(flowers.readyTicks, () => place(fight, tiles, 1));
  fight.at(flowers.activeTicks, () => {
    if (fight.flowers !== state) return;
    animate(fight, "active");
    for (const player of fight.players()) Common.sounds(player, [flowers.activeSound]);
  });
  fight.at(flowers.activeTicks + 1, () => {
    if (fight.flowers !== state) return;
    place(fight, tiles, 2);
    state.active = true;
  });
  fight.at(flowers.endTicks, () => {
    if (fight.flowers !== state) return;
    state.active = false;
    animate(fight, "despawn");
  });
  fight.at(flowers.endTicks + 1, () => {
    if (fight.flowers === state) clear(fight);
  });
}

function place(fight, tiles, stage) {
  const state = fight.flowers;
  if (!state) return;
  const { GameObject, ObjectManager } = Common.core;
  const { locs } = Common.data.flowers;
  for (const object of state.locs) ObjectManager.deregister(object, false);
  state.locs = tiles.map(({ tile: [x, y], safe }) => {
    const object = new GameObject((safe ? locs.safe : locs.unsafe)[stage], fight.dream.tile([x, y]), 10, 0, fight.dream.area);
    object.__flowerSafe = safe;
    ObjectManager.register(object, true);
    return object;
  });
}

function animate(fight, which) {
  const state = fight.flowers;
  if (!state) return;
  const { anims } = Common.data.flowers;
  for (const player of fight.players()) {
    const sender = player.getPacketSender();
    for (const object of state.locs) sender.sendObjectAnimation(object, Common.animation((object.__flowerSafe ? anims.safe : anims.unsafe)[which]));
  }
}

/** The quadrant a player stands in, or null on the cross. */
function quadrantOf(fight, player) {
  const [cx, cy] = Common.data.flowers.cross;
  const [x, y] = fight.dream.arenaTile(player.getLocation());
  if (x === cx || y === cy) return null;
  return (y > cy ? "n" : "s") + (x > cx ? "e" : "w");
}

/** The berry lines bordering where the player stands. */
function berryArms(fight, player) {
  const state = fight.flowers;
  const quadrant = quadrantOf(fight, player);
  if (!state?.active || !quadrant) return [];
  return QUADRANTS[quadrant].filter((arm) => !state.safeArms.has(arm));
}

/** Flies from each berry line at a player on its side, every tick; she heals twice the damage. */
function processPlayer(fight, player) {
  const state = fight.flowers;
  if (!state?.active) return;
  const arms = berryArms(fight, player);
  if (arms.length === 0) return;
  const { flowers } = Common.data;
  const [px, py] = fight.dream.arenaTile(player.getLocation());
  for (const arm of arms) {
    const line = state.arms[arm];
    const near = line.reduce((best, tile) => (Math.abs(tile[0] - px) + Math.abs(tile[1] - py) < Math.abs(best[0] - px) + Math.abs(best[1] - py) ? tile : best));
    const along = line.indexOf(near);
    const from = line[Math.max(0, Math.min(line.length - 1, along + Common.randomInt(-2, 2)))];
    Common.projectile(fight.dream.area, fight.dream.tile(from), player, flowers.flies);
    const amount = Common.randomInt(1, flowers.maxHit);
    fight.at(1, () => {
      if (!player.isRegistered()) return;
      Common.damage(player, amount);
      fight.healShield(amount * 2);
    });
  }
}

/** A hit on her from a quadrant the berries border heals her instead (Wiki). */
function healsInstead(fight, player, hit) {
  if (berryArms(fight, player).length === 0) return false;
  const amount = hit.getTotalDamage();
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
  fight.healShield(amount);
  return true;
}

function process() {}

function clear(fight) {
  const state = fight.flowers;
  if (!state) return;
  const { ObjectManager } = Common.core;
  for (const object of state.locs) ObjectManager.deregister(object, false);
  fight.flowers = null;
  fight.boss?.getMovementQueue?.().setBlockMovement(false);
}

module.exports = { start, process, processPlayer, healsInstead, clear };
