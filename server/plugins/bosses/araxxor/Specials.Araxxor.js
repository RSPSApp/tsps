/**
 * Araxxor's three specials and the per-tick fight engine (acid pools, the
 * rolling acid ball, chasing drip pools).
 *
 * The special replaces every seventh attack and turns on the first egg's colour (Wiki:
 * every six standards, first at attack 7). As captured:
 *  - Acidic: the boss rears (11476, sound 9488) and two ticks later the 3x3 ball (13676) lands
 *    centred on the player's tile from the cast, for 14-18 venom to a player under it. It then
 *    rolls away from her middle, gliding two tiles a tick (exact_move, 11491) and pooling the
 *    tiles it leaves, until the next step is blocked: then it throws six blobs, bursts (11492)
 *    and goes;
 *  - Mirrorback: the boss sprays acid (11478) onto nine tiles around the player, each blob
 *    landing (and pooling) by its distance from her;
 *  - Ruptura: the boss leaks (11477) a blob onto the player that lands four ticks later; they
 *    drip venom (graphic 1626) for seven ticks, pooling every tile they step through.
 *
 * Pools (object 54148, shape 10) are the damage field: standing in acid deals a flat 4-5
 * venom a tick. They stay until the fight ends.
 */
const Shared = require("./Shared.Araxxor");
const Minions = require("./Minions.Araxxor");
const CombatAchievements = require("./CombatAchievements.Araxxor");

const SPECIAL_ANIMATION = Object.freeze({ ball: 11476, splatter: 11478, drip: 11477 });
const BALL_ANIMATION = 11491;
const BALL_BURST_ANIMATION = 11492;

const WALKABLE_MASK = 0x1280100;

let api = null;
let core = null;
let CombatFactory = null;

/** Live fights by boss NPC: pools, the ball and the dripping players. */
const fights = new Map();

function later(ticks, target, execFunc) {
  class DelayedTask extends core.Task {
    constructor() {
      super(Math.max(1, ticks), target, false);
    }

    execute() {
      this.stop();
      execFunc();
    }
  }
  core.TaskManager.submit(new DelayedTask());
}

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

function getFight(npc) {
  let fight = fights.get(npc);
  if (!fight) {
    fight = {
      pools: new Map(),
      ball: null,
      drips: [],
    };
    fights.set(npc, fight);
  }
  return fight;
}

function isWalkable(x, y) {
  return (core.RegionManager.getClipping(x, y, 0, null) & WALKABLE_MASK) === 0;
}

/**
 * One acid pool on the boss's private area. The fight tracks them by tile so the damage
 * tick can ask "is anyone standing in acid", and death clears them all.
 */
function spawnPool(npc, x, y) {
  const fight = getFight(npc);
  const key = Shared.tileKey(x, y);
  if (fight.pools.has(key)) return fight.pools.get(key);
  const area = npc.getPrivateArea?.() ?? null;
  if (area?.isDestroyed?.() === true) return null;
  const object = new core.GameObject(Shared.ACID_POOL_OBJECT, new core.Location(x, y, 0), 10, 0, area);
  core.ObjectManager.register(object, true);
  area?.add?.(object);
  fight.pools.set(key, object);
  return object;
}

/** Starts the Wiki hatch count: first egg after 3 standards, then every 6. Never
 * resets an in-progress fight (a stale cleanup rebuilding mid-battle). */
function initFight(npc) {
  const fight = getFight(npc);
  if (npc?.getAttribute?.(Shared.ATTR_STANDARDS) == null) npc.setAttribute(Shared.ATTR_STANDARDS, 0);
  if (npc?.getAttribute?.(Shared.ATTR_NEXT_HATCH) == null) npc.setAttribute(Shared.ATTR_NEXT_HATCH, Shared.FIRST_HATCH_STANDARDS);
  return fight;
}

/** Counts one non-special attack; hatches the next egg when its standard is due.
 * Overdamaged eggs despawn inside hatchNext, and the threshold still advances a
 * full interval, so the next egg waits another six standards (Wiki). */
function checkStandardHatch(npc) {
  if (!npc) return;
  const standards = (npc.getAttribute?.(Shared.ATTR_STANDARDS) ?? 0) + 1;
  npc.setAttribute(Shared.ATTR_STANDARDS, standards);
  const next = npc.getAttribute?.(Shared.ATTR_NEXT_HATCH) ?? Shared.FIRST_HATCH_STANDARDS;
  if (standards >= next) {
    npc.setAttribute(Shared.ATTR_NEXT_HATCH, next + Shared.HATCH_INTERVAL_STANDARDS);
    later(Shared.HATCH_DELAY_TICKS, npc, () => Minions.hatchNext(npc));
  }
}

function startSpecial(npc, target) {
  const kind = npc.getAttribute?.(Shared.ATTR_SPECIAL);
  if (!kind) return;
  npc.performAnimation(new core.Animation(SPECIAL_ANIMATION[kind] ?? SPECIAL_ANIMATION.ball));
  if (kind === "ball") {
    const pos = target?.getLocation?.();
    if (!pos) return;
    // Captured: the ball lands on the tile the player stood on at the cast.
    const landing = { x: pos.getX(), y: pos.getY() };
    Shared.playCaptured(target.isPlayer?.() ? target.getAsPlayer() : null, Shared.SOUND.ball);
    later(2, target, () => {
      // A corpse keeps 1 HP so players can walk to it: never start a ball off one.
      if (alive(npc) && npc.getAttribute?.(Shared.ATTR_DYING) !== true) startBall(npc, target, landing);
    });
  } else if (kind === "splatter") {
    const pos = target?.getLocation?.();
    if (!pos) return;
    // Sprayed outward along the boss-to-player line (Wiki: random, in their direction).
    const centre = core.Projectile.centreOf(npc);
    const direction = { x: pos.getX() - centre.getX(), y: pos.getY() - centre.getY() };
    const tiles = Shared.splatterTiles(pos.getX(), pos.getY(), isWalkable, direction);
    throwBlobs(npc, centre, tiles, Shared.PROJECTILE.spray);
  } else if (kind === "drip") {
    startDrip(npc, target);
  }
}

/**
 * A blob for every tile from `from`, each landing by its own distance: the splash graphic and
 * sound go out with the throw, delayed to the arrival, and the pool grows on the tick it lands.
 */
function throwBlobs(npc, from, tiles, shape) {
  const areaDestroyed = () => npc.getPrivateArea?.()?.isDestroyed?.() === true;
  const session = npc.getAttribute?.(Shared.ATTR_ENCOUNTER) ?? null;
  const viewer = session?.player ?? session?.fighter ?? null;
  const sender = viewer?.getPacketSender?.() ?? null;
  const z = npc.getLocation().getZ();
  for (const [x, y] of tiles) {
    const at = new core.Location(x, y, z);
    const end = Shared.projectileEnd(shape, from.getDistance(at));
    new core.Projectile(from, at, null, shape.id, shape.start, end, shape.startHeight, shape.endHeight, npc.getPrivateArea())
      .withAngle(shape.angle).withProgress(shape.progress).sendProjectile();
    if (sender) {
      const impact = new core.Graphic(Shared.ACID_SPLAT_GFX);
      impact.height = 0;
      // Set directly: Graphic's overloads read a delay of 0/50/100 as a height.
      impact.delay = end;
      sender.sendGlobalGraphic(impact, at);
      sender.sendAreaSound(Shared.ACID_SPLAT_SOUND, x, y, z, 1, end, 2, 0);
    }
    later(Shared.landingTicks(end), npc, () => {
      // Blobs still in the air when she dies land on nothing: the fight's pools are gone.
      if (areaDestroyed() || !fights.has(npc) || npc.getAttribute?.(Shared.ATTR_DYING) === true) return;
      // Wiki: the splatter damages before the pool forms. Anyone standing on a landing
      // tile takes the impact; the boss herself never does (captures + venom immunity).
      for (const player of npc.getPlayersWithinDistance?.(25) ?? []) {
        if (!alive(player)) continue;
        const pos = player.getLocation();
        if (pos.getX() !== x || pos.getY() !== y) continue;
        player.getCombat().getHitQueue().addPendingDamage([Shared.venomHit(core, Shared.SPLAT_IMPACT_DAMAGE)]);
        CombatAchievements.avoidableDamage(player, Shared.SPLAT_IMPACT_DAMAGE);
        envenom(player);
      }
      spawnPool(npc, x, y);
    });
  }
}

/** Venom once, so an active venom keeps escalating. */
function envenom(player) {
  if (player.isVenomed?.() !== true) {
    CombatFactory?.poisonEntity?.(player, 6, 2);
  }
}

/**
 * The rolling acid ball (captured): the 3x3 ball lands centred on `landing`, the player's tile
 * at the cast, for 14-18 venom to a player under it, then rolls away from Araxxor's middle.
 */
function startBall(npc, target, landing) {
  const fight = getFight(npc);
  if (fight.ball && alive(fight.ball)) return;
  const area = npc.getPrivateArea?.() ?? null;
  if (area?.isDestroyed?.() === true) return;
  const centre = core.Projectile.centreOf(npc);
  const dx = Math.sign(landing.x - centre.getX());
  const dy = Math.sign(landing.y - centre.getY());
  if (dx === 0 && dy === 0) return;
  const offset = (Shared.BALL_SIZE - 1) >> 1;
  const z = npc.getLocation().getZ();
  const ball = core.NPC.create(Shared.BALL_ID, new core.Location(landing.x - offset, landing.y - offset, z));
  ball.__skipDefaultRespawn = true;
  // The cache has no hitpoints for 13676 (-1); the tracker's alive() needs a positive one.
  ball.setHitpoints?.(1);
  ball.setFlag?.(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  ball.performAnimation(new core.Animation(BALL_ANIMATION));
  area?.add?.(ball);
  core.World.getAddNPCQueue().push(ball);
  fight.ball = ball;
  fight.ballDirection = { x: dx, y: dy };
  fight.ballMoves = 0;
  fight.ballBursting = false;
  // Captured: whoever stood under the ball as it landed takes the hit on the next tick,
  // even after running out.
  const under = (npc.getPlayersWithinDistance?.(25) ?? []).filter((player) => {
    const pos = player.getLocation();
    return Math.abs(pos.getX() - landing.x) <= offset && Math.abs(pos.getY() - landing.y) <= offset;
  });
  later(1, ball, () => {
    if (area?.isDestroyed?.() === true) return;
    for (const player of under) {
      if (!alive(player)) continue;
      const damage = Shared.randomBetween(Shared.BALL_DAMAGE_MIN, Shared.BALL_DAMAGE_MAX);
      player.getCombat().getHitQueue().addPendingDamage([Shared.venomHit(core, damage)]);
      CombatAchievements.avoidableDamage(player, damage);
      envenom(player);
    }
  });
}

/** Whether the ball's middle can take its next two-tile step. */
function ballCanStep(x, y, dx, dy) {
  for (let step = 1; step <= Shared.BALL_STEP_TILES; step++) {
    if (!isWalkable(x + dx * step, y + dy * step)) return false;
  }
  return true;
}

/**
 * One tick of the ball (captured): every tick from the one it appears it glides two tiles
 * (a teleport with an exact_move over the whole tick, facing the way it rolls), pooling the
 * middle of where it set off and the tile behind that. When the next jump would be blocked it
 * throws six blobs instead, bursts the tick after and goes the one after that.
 */
function tickBall(npc, fight) {
  const ball = fight.ball;
  if (!ball) return;
  if (!ball.isRegistered?.() || (npc.getPrivateArea?.() ?? null)?.isDestroyed?.() === true) {
    if (!core.World.getAddNPCQueue().includes(ball)) fight.ball = null;
    return;
  }
  if (fight.ballBursting) {
    ball.performAnimation(new core.Animation(BALL_BURST_ANIMATION));
    later(1, ball, () => core.World.getRemoveNPCQueue().push(ball));
    fight.ball = null;
    return;
  }
  const { x: dx, y: dy } = fight.ballDirection;
  const middle = core.Projectile.centreOf(ball);
  if (fight.ballMoves > 0) {
    spawnPool(npc, middle.getX(), middle.getY());
    spawnPool(npc, middle.getX() - dx, middle.getY() - dy);
  }
  if (!ballCanStep(middle.getX(), middle.getY(), dx, dy)) {
    fight.ballBursting = true;
    const tiles = Shared.splatterTiles(
      middle.getX(), middle.getY(), isWalkable, null, Shared.BALL_BURST_COUNT, Shared.BALL_BURST_SPREAD,
    );
    throwBlobs(npc, middle, tiles, Shared.PROJECTILE.ballBurst);
    return;
  }
  const step = Shared.BALL_STEP_TILES;
  ball.exactMove(ball.getLocation().transform(dx * step, dy * step));
  ball.performAnimation(new core.Animation(BALL_ANIMATION));
  fight.ballMoves += 1;
}

/**
 * The acid leak (captured): a blob lands on the player four ticks after the cast; they drip
 * venom (graphic 1626) for seven ticks, and from the next tick every tile they stood on or
 * ran through the tick before gets a pool.
 */
function startDrip(npc, target) {
  const pos = target?.getLocation?.();
  if (!pos || !target.isPlayer?.()) return;
  const shape = Shared.PROJECTILE.drip;
  new core.Projectile(
    core.Projectile.centreOf(npc), pos, target, shape.id, shape.start, shape.end,
    shape.startHeight, shape.endHeight, npc.getPrivateArea(),
  ).withSource(npc).withAngle(shape.angle).withProgress(shape.progress).sendProjectile();
  const fight = getFight(npc);
  const player = target.getAsPlayer();
  later(Shared.landingTicks(shape.end), target, () => {
    if (!alive(npc) || npc.getAttribute?.(Shared.ATTR_DYING) === true
      || (npc.getPrivateArea?.() ?? null)?.isDestroyed?.() === true || !alive(player)) return;
    player.sendMessage(Shared.DRIP_MESSAGE);
    const now = core.World.getProcessCycle();
    fight.drips.push({ player, from: now, until: now + Shared.DRIP_TICKS, last: null, passed: null });
    dripTick(npc, fight.drips[fight.drips.length - 1], now);
  });
}

/** The tile between two positions a run step apart, or null for a walk or standing still. */
function runMidpoint(from, to) {
  if (!from || !to) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) return null;
  return { x: from.x + Math.sign(dx), y: from.y + Math.sign(dy) };
}

function dripTick(npc, drip, now) {
  const graphic = new core.Graphic(Shared.DRIP_GFX);
  // Captured in graphic slot 2, so it plays over whatever else is on the player.
  if (typeof drip.player.performGraphicInSlot === "function") drip.player.performGraphicInSlot(2, graphic);
  else drip.player.performGraphic(graphic);
  if (now > drip.from && drip.last) {
    spawnPool(npc, drip.last.x, drip.last.y);
    if (drip.passed) spawnPool(npc, drip.passed.x, drip.passed.y);
  }
  const pos = drip.player.getLocation();
  const current = { x: pos.getX(), y: pos.getY() };
  drip.passed = runMidpoint(drip.last, current);
  drip.last = current;
}

function tickDrips(npc, fight) {
  if (fight.drips.length === 0) return;
  const now = core.World.getProcessCycle();
  for (let index = fight.drips.length - 1; index >= 0; index--) {
    const drip = fight.drips[index];
    if (now >= drip.until || !alive(drip.player)) {
      fight.drips.splice(index, 1);
      continue;
    }
    if (now > drip.from) dripTick(npc, drip, now);
  }
}

/** Captured: acid deals a flat 4-5 venom every tick a player stands in it. */
function tickPools(npc, fight, players) {
  for (const player of players) {
    if (!alive(player)) continue;
    const pos = player.getLocation();
    if (!fight.pools.has(Shared.tileKey(pos.getX(), pos.getY()))) continue;
    const damage = Shared.poolDamage();
    player.getCombat().getHitQueue().addPendingDamage([Shared.venomHit(core, damage)]);
    CombatAchievements.avoidableDamage(player, damage);
    // The pools inflict venom too (Wiki).
    envenom(player);
  }
}

function tick() {
  for (const [npc, fight] of fights) {
    // A freshly spawned boss sits in the add queue for a tick before it registers: that is
    // not a dead fight, and cleaning up here would drop its hatch clock.
    if (!alive(npc)) {
      if (!core.World.getAddNPCQueue().includes(npc)) {
        endFight(npc);
      }
      continue;
    }
    // A live encounter must never regenerate (the engine heals an NPC that has
    // not attacked for 20 s; Zulrah, Mad Angel and the Doom do the same).
    npc.getCombat?.().getLastAttack?.().reset?.();
    const players = npc.getPlayersWithinDistance(25);
    const session = npc.getAttribute?.(Shared.ATTR_ENCOUNTER) ?? null;
    if (session) Minions.ensureTargets(session);
    if (session) Minions.pinEggs(session);
    tickBall(npc, fight);
    tickDrips(npc, fight);
    tickPools(npc, fight, players);
  }
}

/**
 * A dying Acidic araxyte explodes (graphic 2926) and splashes 13 blobs within four tiles of
 * it (captured), each pooling where it lands.
 */
function acidicAraxyteDied({ npc }) {
  if (npc?.getId?.() !== Shared.MINION_ID.acidic) return;
  const session = npc.getAttribute?.(Shared.ATTR_ENCOUNTER) ?? null;
  const boss = session?.npc ?? null;
  if (!boss || !alive(boss) || boss.getAttribute?.(Shared.ATTR_DYING) === true) return;
  npc.performGraphic(new core.Graphic(Shared.ACIDIC_EXPLOSION_GFX));
  const middle = core.Projectile.centreOf(npc);
  const tiles = Shared.splatterTiles(
    middle.getX(), middle.getY(), isWalkable, null, Shared.ACIDIC_DEATH_SPLATTER_COUNT, Shared.ACIDIC_DEATH_SPREAD,
  );
  throwBlobs(boss, middle, tiles, Shared.PROJECTILE.acidicDeath);
}

function endFight(npc) {
  const fight = fights.get(npc);
  if (!fight) return;
  for (const object of fight.pools.values()) {
    core.ObjectManager.deregister(object, true);
  }
  fight.pools.clear();
  fight.drips.length = 0;
  if (fight.ball?.isRegistered?.()) {
    core.World.getRemoveNPCQueue().push(fight.ball);
  }
  fight.ball = null;
  fights.delete(npc);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  CombatFactory = pluginApi.getCombatFactory();
  pluginApi.onNpcDeath(acidicAraxyteDied);
  class EngineTask extends core.Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      tick();
    }
  }
  core.TaskManager.submit(new EngineTask());
}

module.exports = {
  attach,
  initFight,
  checkStandardHatch,
  startSpecial,
  startBall,
  startDrip,
  acidicAraxyteDied,
  throwBlobs,
  spawnPool,
  tick,
  tickBall,
  tickDrips,
  tickPools,
  endFight,
  fights,
  _test: { SPECIAL_ANIMATION },
};
