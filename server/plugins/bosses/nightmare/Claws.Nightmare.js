/**
 * Grasping Claws, as captured: her animation with some 40 portals (map animation 1767) opening
 * across the arena at once, and four ticks later the claws come up through them (an area sound on
 * each) and hit anyone standing on one, or under her. The Nightmare's land up to 50, Phosani's
 * 50-65 (Wiki), and Phosani's portals gather around the player. Players her husks hold get none
 * under them (Wiki).
 *
 * Phosani's chain (captured): her start animation (delay 12), then a set of portals every 5 ticks,
 * five in all, and her finish animation; it runs with her flowers and spores and through her
 * desperation phase.
 */
const Common = require("./Common.Nightmare");

const isTotemTile = (x, y) => Common.data.npcs.totems.some(({ tile: [tx, ty] }) => x >= tx && x <= tx + 2 && y >= ty && y <= ty + 2);

function arenaTiles() {
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const tiles = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) if (!isTotemTile(x, y)) tiles.push([x, y]);
  return tiles;
}

/** The Nightmare's spread: one tile in most 3x3 blocks of the arena (about 40, as captured). */
function spreadTiles() {
  const { minX, maxX, minY, maxY } = Common.data.arena;
  const tiles = [];
  for (let bx = minX; bx <= maxX; bx += 3) {
    for (let by = minY; by <= maxY; by += 3) {
      if (Math.random() < 0.1) continue;
      const x = bx + Common.randomInt(0, Math.min(2, maxX - bx));
      const y = by + Common.randomInt(0, Math.min(2, maxY - by));
      if (!isTotemTile(x, y)) tiles.push([x, y]);
    }
  }
  return tiles;
}

/** Phosani's: thick around each player (leaving them a way out), sparse elsewhere. */
function clumpedTiles(fight) {
  const near = fight.players().map((player) => fight.dream.arenaTile(player.getLocation()));
  return arenaTiles().filter(([x, y]) => {
    const close = near.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= 2);
    return Math.random() < (close ? 0.5 : 0.12);
  });
}

function open(fight, anim, delay = 0) {
  const { claws } = Common.data;
  if (anim != null) fight.boss.performAnimation(Common.animation(anim, delay));
  const held = new Set([...fight.frozen.keys()].map((player) => fight.dream.arenaTile(player.getLocation()).join(",")));
  const tiles = (fight.phosani ? clumpedTiles(fight) : spreadTiles()).filter(([x, y]) => !held.has(`${x},${y}`));
  const players = fight.players();
  for (const [x, y] of tiles) Common.tileGraphic(players, fight.dream.tile([x, y]), claws.spot);
  for (const player of players) Common.sounds(player, claws.sounds);
  fight.claws.push({ at: fight.tick + claws.hitTicks, tiles: new Set(tiles.map((tile) => tile.join(","))) });
}

/** One set of claws (her turn's special). */
function start(fight) {
  fight.claws = fight.claws ?? [];
  open(fight, Common.data.claws.anim);
  return null;
}

/**
 * Phosani's run of claws: five sets 5 ticks apart. `again` keeps it going (her desperation phase);
 * returns the ticks she holds.
 */
function chain(fight, again = false) {
  const { chain: spec } = Common.data.claws;
  fight.claws = fight.claws ?? [];
  if (fight.clawChain) return spec.every;
  fight.clawChain = { left: spec.count, next: fight.tick, again };
  return spec.every * spec.count + 1;
}

function process(fight) {
  fight.claws = fight.claws ?? [];
  const { claws } = Common.data;
  const run = fight.clawChain;
  if (run && fight.tick >= run.next) {
    const first = run.left === claws.chain.count;
    open(fight, first ? claws.chain.start : claws.chain.idle, first ? claws.chain.startDelay : 0);
    run.left--;
    run.next = fight.tick + claws.chain.every;
    if (run.left <= 0) {
      fight.clawChain = null;
      fight.at(claws.chain.every, () => fight.boss?.isRegistered() && fight.boss.performAnimation(Common.animation(claws.chain.finish)));
      if (run.again && fight.stage === "desperate") fight.at(claws.chain.every + 1, () => fight.stage === "desperate" && chain(fight, true));
    }
  }
  const due = fight.claws.filter((set) => set.at <= fight.tick);
  if (due.length === 0) return;
  fight.claws = fight.claws.filter((set) => set.at > fight.tick);
  const players = fight.players();
  const body = require("./Attacks.Nightmare").bodyBounds(fight.boss);
  for (const set of due) {
    for (const key of set.tiles) {
      const [x, y] = key.split(",").map(Number);
      Common.areaSound(players, fight.dream.tile([x, y]), claws.hitSound);
    }
    for (const player of players) {
      const here = player.getLocation();
      const [x, y] = fight.dream.arenaTile(here);
      const under = here.getX() >= body.minX && here.getX() <= body.maxX && here.getY() >= body.minY && here.getY() <= body.maxY;
      if (!set.tiles.has(`${x},${y}`) && !under) continue;
      const amount = fight.phosani ? Common.randomInt(...claws.phosaniHit) : Common.randomInt(Math.ceil(claws.maxHit * 0.6), claws.maxHit);
      Common.damage(player, amount);
    }
  }
}

function clear(fight) {
  fight.claws = [];
  fight.clawChain = null;
}

module.exports = { start, chain, process, clear, arenaTiles, isTotemTile };
