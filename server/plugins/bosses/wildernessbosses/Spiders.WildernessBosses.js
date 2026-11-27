/**
 * Venenatis and Spindel (https://oldschool.runescape.wiki/w/Venenatis/Strategies,
 * https://oldschool.runescape.wiki/w/Spindel/Strategies), as captured
 * (docs/wilderness-bosses.md):
 *
 * - Every attack takes a slot in a cycle of 16. Next to a player she bites (npc_venenatis_melee_01).
 *   From farther away she uses ranged spits in the first eight slots and magic webs in the last eight.
 *   The shots fly 25 + 2 per tile cycles and land with their impact (fx_venenatis_ranged/magic_impact).
 * - Every fourth attack, bites included, starts a two-tile-per-tick run on that tick. The next
 *   attack follows floor(distance / 2) + 2 ticks later (rsprox 235/3376, 3377, 3364, 3366, 3372).
 * - The first attack of each cycle calls two more spiderlings. While any live, her attacks hit through
 *   protection prayers. Each spiderling's resolved bite drains a Prayer point.
 * - The eleventh attack also throws a sticky web at the player's tile (fx_venenatis_web,
 *   4 ticks in the air): it spreads into a 7x7 web (its corners cut) for 39 ticks. Each tick a
 *   player stands in it costs 3 hitpoints, 3 Prayer and 10% run energy: "You feel yourself drained
 *   by the webs!"
 */
const Common = require("./Common.WildernessBosses");
const Caves = require("./Caves.WildernessBosses");

const SPIDERS = Object.freeze({
  6610: Object.freeze({ key: "venenatis", spiderling: 12000, melee: 21, ranged: 35, magic: 30 }),
  11998: Object.freeze({ key: "spindel", spiderling: 12001, melee: 14, ranged: 31, magic: 24 }),
});

const ANIMATION = Object.freeze({ ranged: 9989, magic: 9990, melee: 9991, spawn: 9993 });
const SHOT = Object.freeze({
  ranged: Object.freeze({ projectile: 2356, impact: 2357, impactHeight: 30, endHeight: 90 }),
  magic: Object.freeze({ projectile: 2358, impact: 2359, impactHeight: 90, endHeight: 124 }),
});
const SHOT_SHAPE = Object.freeze({ start: 25, perTile: 2, startHeight: 150, angle: 14, progress: 48 });
const WEB_SHOT = Object.freeze({ projectile: 2360, impact: 2361, start: 0, end: 120, startHeight: 150, endHeight: 0, angle: 30, progress: 0 });
const WEB_LANDS_TICKS = 4;
const WEB_LIFETIME_TICKS = 39;
const WEB_LOC = Object.freeze({ centre: 47084, edge: 47085, corner: 47086 });
const WEB_DRAIN = Object.freeze({ damage: 3, prayer: 3, runEnergy: 10 });
const WEB_MESSAGE = "You feel yourself drained by the webs!";
const SPIDERLING_MESSAGE = "You feel yourself drained by the spiderling.";

const SPEED = 4;
const FIRST_ATTACK_TICKS = 7;
const CYCLE = 16;
const RANGED_ATTACKS = 8;
const WEB_AT = RANGED_ATTACKS + 2;
const MOVE_EVERY = 4;
const RUN_STEPS = 2;
const MAX_RUN_DISTANCE = 13;
const MOVE_BOX = Object.freeze({ minDx: -6, maxDx: 7, minDy: -7, maxDy: 8 });
const SPIDERLINGS = 2;
const SPIDERLING_RANGE = 6;
const SPIDERLING_DEATH_DELAY = 5;

/**
 * The web as captured around the tile it lands on: [dx, dy, loc, rotation]. A 5x5 of centre
 * pieces with corner pieces at its corners, and three edge pieces along each side.
 */
const WEB_PATTERN = Object.freeze([
  [-1, -3, "edge", 1], [0, -3, "edge", 1], [1, -3, "edge", 1],
  [-2, -2, "corner", 1], [-1, -2, "centre", 0], [0, -2, "centre", 0], [1, -2, "centre", 0], [2, -2, "corner", 0],
  [-2, -1, "centre", 0], [-1, -1, "centre", 0], [0, -1, "centre", 0], [1, -1, "centre", 0], [2, -1, "centre", 0],
  [-2, 0, "centre", 0], [-1, 0, "centre", 0], [0, 0, "centre", 0], [1, 0, "centre", 0], [2, 0, "centre", 0],
  [-2, 1, "centre", 0], [-1, 1, "centre", 0], [0, 1, "centre", 0], [1, 1, "centre", 0], [2, 1, "centre", 0],
  [-2, 2, "corner", 2], [-1, 2, "centre", 0], [0, 2, "centre", 0], [1, 2, "centre", 0], [2, 2, "corner", 3],
  [-1, 3, "edge", 3], [0, 3, "edge", 3], [1, 3, "edge", 3],
  [3, -1, "edge", 0], [3, 0, "edge", 0], [3, 1, "edge", 0],
  [-3, -1, "edge", 2], [-3, 0, "edge", 2], [-3, 1, "edge", 2],
]);

const CYCLE_ATTRIBUTE = "wilderness-bosses:spider-cycle";

let api = null;
let core = null;
let PrayerHandler = null;
/** boss npc -> { spiderlings: NPC[] } */
const broods = new WeakMap();
/** lair key -> Map("x,y" -> { object, until }) of web tiles */
const webs = new Map();
/** player -> lair key whose web drained them last tick (one message a visit) */
const caught = new WeakMap();
/** boss npc -> active run task */
const runs = new Map();

function spiderOf(npc) {
  return SPIDERS[npc?.getRealId?.()] ?? null;
}

function broodOf(npc) {
  let brood = broods.get(npc);
  if (!brood) {
    brood = { spiderlings: [] };
    broods.set(npc, brood);
  }
  const pending = core.World.getAddNPCQueue();
  brood.spiderlings = brood.spiderlings.filter((spiderling) =>
    spiderling.getHitpoints() > 0 && (spiderling.isRegistered() || pending.includes(spiderling)));
  return brood;
}

/** Where her shots leave from, as captured: two tiles in from her south-west corner. */
function centre(npc) {
  const base = npc.getLocation();
  return { x: base.getX() + 2, y: base.getY() + 2, z: base.getZ() };
}

function prayerBlocks(player, prayer, npc) {
  return PrayerHandler.isActivated(player, prayer) && broodOf(npc).spiderlings.length === 0;
}

// ------------------------------------------------------------------ attacks

function shoot(npc, method, spider, target, kind) {
  const shot = SHOT[kind];
  const from = centre(npc);
  const at = target.getLocation();
  const distance = Math.max(Math.abs(at.getX() - from.x), Math.abs(at.getY() - from.y));
  const end = SHOT_SHAPE.start + SHOT_SHAPE.perTile * distance;
  npc.performAnimation(new core.Animation(kind === "ranged" ? ANIMATION.ranged : ANIMATION.magic));
  new core.Projectile(new core.Location(from.x, from.y, from.z), at, target, shot.projectile, SHOT_SHAPE.start, end,
    SHOT_SHAPE.startHeight, shot.endHeight, null)
    .withSource(npc).withAngle(SHOT_SHAPE.angle).withProgress(SHOT_SHAPE.progress).sendProjectile();
  target.performGraphic(new core.Graphic(shot.impact, end, shot.impactHeight));
  const prayer = kind === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MAGIC;
  const damage = prayerBlocks(target, prayer, npc) ? 0 : Common.randomBetween(0, spider[kind]);
  // Splat on the first tick at or after the shot lands; floor - 1 hit before it (#1862).
  Common.bossHit(npc, method, target, damage, shotHitTicks(end));
}

function shotHitTicks(end) {
  return core.Projectile.ticksToLand(end);
}

function bite(npc, method, spider, target) {
  npc.performAnimation(new core.Animation(ANIMATION.melee));
  const damage = prayerBlocks(target, PrayerHandler.PROTECT_FROM_MELEE, npc) ? 0 : Common.randomBetween(0, spider.melee);
  Common.bossHit(npc, method, target, damage, 0);
}

function moveDelay(distance) {
  return Math.floor(distance / RUN_STEPS) + 2;
}

function runDistance(from, to) {
  return Math.max(Math.abs(to.getX() - from.getX()), Math.abs(to.getY() - from.getY()));
}

function openFootprint(tile, size) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!Common.open(tile.getX() + x, tile.getY() + y, tile.getZ())) return false;
    }
  }
  return true;
}

function canRunTo(queue, from, to) {
  // Check the same diagonal-first steps addFirstStep queues. An open landing tile alone
  // does not tell us whether a 4x4 NPC can reach it along that line.
  while (!from.equals(to)) {
    const next = from.transform(Math.sign(to.getX() - from.getX()), Math.sign(to.getY() - from.getY()));
    if (!queue.canWalkTo(next, from)) return false;
    from = next;
  }
  return true;
}

/** Destination estimate: sample an open footprint in the observed box around her spawn. */
function runDestination(npc, from, queue) {
  const spawn = npc.getSpawnPosition();
  if (from.getZ() !== spawn.getZ()) return null;
  const { minDx, maxDx, minDy, maxDy } = MOVE_BOX;
  for (let tries = 0; tries < 10; tries++) {
    const tile = spawn.transform(Common.randomBetween(minDx, maxDx), Common.randomBetween(minDy, maxDy));
    const distance = runDistance(from, tile);
    if (distance < 1 || distance > MAX_RUN_DISTANCE || !openFootprint(tile, npc.getSize())) continue;
    if (canRunTo(queue, from, tile)) return tile;
  }
  return null;
}

function endRun(npc) {
  const run = runs.get(npc);
  if (!run) return;
  run.stop();
  runs.delete(npc);
  npc.setScriptedMovement(false);
  npc.getMovementQueue().reset();
}

function runOnAttack(npc, target) {
  const queue = npc.getMovementQueue();
  if (!queue.getMobility().canMove()) return;
  const origin = npc.getLocation();
  const destination = runDestination(npc, origin, queue);
  if (!destination) return;
  const distance = runDistance(origin, destination);
  queue.addFirstStep(destination);
  // Combat attacks after the NPC's normal movement pass. Process these first steps now so
  // the attack still uses the old tile and its animation is sent with this tick's movement.
  queue.process();
  if (!Common.alive(npc) || !Common.alive(target) || !queue.didMoveThisCycle()) {
    queue.reset();
    return;
  }
  if (queue.isStepBlocked()) {
    queue.reset();
    npc.getCombat().setAttackDelay(moveDelay(runDistance(origin, npc.getLocation())));
    return;
  }
  npc.getCombat().setAttackDelay(moveDelay(distance));
  if (queue.size() === 0) return;

  // While the remaining steps run, combat would otherwise clear or replace the queue.
  npc.setScriptedMovement(true);
  const started = core.World.getProcessCycle();
  const run = new (class extends core.Task {
    constructor() {
      super(1);
      this.target = target;
    }

    execute() {
      if (!Common.alive(npc) || !Common.alive(target) || queue.size() === 0) {
        endRun(npc);
        return;
      }
      const elapsed = core.World.getProcessCycle() - started;
      if (queue.isStepBlocked() || !queue.getMobility().canMove() || elapsed >= Math.ceil(distance / RUN_STEPS)) {
        const ran = runDistance(origin, npc.getLocation());
        npc.getCombat().setAttackDelay(moveDelay(ran) - elapsed);
        endRun(npc);
      }
    }
  })();
  runs.set(npc, run);
  core.TaskManager.submit(run);
}

function beforeTargetDeath({ player, preventDeath }) {
  if (preventDeath) return;
  for (const [npc, run] of runs) {
    if (run.target === player) endRun(npc);
  }
}

// ------------------------------------------------------------------ spiderlings

/** Each call adds a pair. Their choice of open tiles is an estimate (docs/wilderness-bosses.md). */
function callSpiderlings(npc, spider, target) {
  const brood = broodOf(npc);
  const from = centre(npc);
  const tiles = [];
  for (let x = from.x - SPIDERLING_RANGE; x <= from.x + SPIDERLING_RANGE; x++) {
    for (let y = from.y - SPIDERLING_RANGE; y <= from.y + SPIDERLING_RANGE; y++) {
      if (Common.edgeDistance(npc, x, y) >= 1 && Common.open(x, y, from.z)) tiles.push([x, y]);
    }
  }
  for (let i = 0; i < SPIDERLINGS && tiles.length > 0; i++) {
    const [[x, y]] = tiles.splice(Common.randomBetween(0, tiles.length - 1), 1);
    // The plugin spawn API registers the NPC before this attack tick's client update.
    const spiderling = api.spawnNpc({ id: spider.spiderling, x, y, z: from.z, wanderRadius: 20 });
    if (!spiderling) continue;
    spiderling.__skipDefaultRespawn = true;
    spiderling.__wildernessBoss = npc;
    spiderling.setMultiCombat(true);
    brood.spiderlings.push(spiderling);
    Common.engage(spiderling, target);
  }
}

/** Death dismisses the surviving brood with its animations. An abandoned fight removes it directly. */
function dismissBrood(spiderlings, die) {
  const pending = core.World.getAddNPCQueue();
  for (const spiderling of spiderlings) {
    const queued = pending.indexOf(spiderling);
    if (queued !== -1) pending.splice(queued, 1);
    else if (Common.alive(spiderling)) {
      if (die) spiderling.setHitpoints(0);
      else core.World.getRemoveNPCQueue().push(spiderling);
    }
  }
}

/** A spiderling's bite drains a Prayer point, whatever it hits. */
function spiderlingBite({ attacker, target }) {
  if (!attacker?.isNpc?.() || !attacker.__wildernessBoss || !spiderOf(attacker.__wildernessBoss)) return;
  if (!target?.isPlayer?.()) return;
  const skills = target.getSkillManager();
  const prayer = skills.getCurrentLevel(core.Skill.PRAYER);
  if (prayer > 0) skills.setCurrentLevel(core.Skill.PRAYER, prayer - 1, true);
  target.getPacketSender().sendTypedMessage(core.ChatType.SPAM, SPIDERLING_MESSAGE);
}

// ------------------------------------------------------------------ webs

function websOf(key) {
  let map = webs.get(key);
  if (!map) {
    map = new Map();
    webs.set(key, map);
  }
  return map;
}

function throwWeb(npc, spider, target) {
  const from = centre(npc);
  const land = target.getLocation().clone();
  new core.Projectile(new core.Location(from.x, from.y, from.z), land, null, WEB_SHOT.projectile, WEB_SHOT.start, WEB_SHOT.end,
    WEB_SHOT.startHeight, WEB_SHOT.endHeight, null)
    .withSource(npc).withAngle(WEB_SHOT.angle).withProgress(WEB_SHOT.progress).sendProjectile();
  for (const player of Caves.playersIn(spider.key)) {
    player.getPacketSender().sendGlobalGraphic(core.Graphic.delayed(WEB_SHOT.impact, WEB_SHOT.end), land);
  }
  Common.later(WEB_LANDS_TICKS, () => spreadWeb(spider, land));
}

function spreadWeb(spider, land) {
  const map = websOf(spider.key);
  const until = core.World.getProcessCycle() + WEB_LIFETIME_TICKS;
  for (const [dx, dy, piece, rotation] of WEB_PATTERN) {
    const x = land.getX() + dx;
    const y = land.getY() + dy;
    if (!Common.open(x, y, land.getZ())) continue;
    const key = `${x},${y}`;
    const old = map.get(key);
    if (old) api.getObjectManager().deregister(old.object, true);
    const object = new core.GameObject(WEB_LOC[piece], new core.Location(x, y, land.getZ()), 10, rotation, null);
    api.getObjectManager().register(object, true);
    const web = { object, until };
    map.set(key, web);
    Common.later(WEB_LIFETIME_TICKS, () => {
      if (map.get(key) !== web) return;
      map.delete(key);
      api.getObjectManager().deregister(object, true);
    });
  }
}

/** Per tick, for each player in her lair: the web's drain while they stand in it. */
function playerTick(player, lair) {
  const location = player.getLocation();
  const web = websOf(lair.key).get(`${location.getX()},${location.getY()}`);
  if (!web) {
    caught.delete(player);
    return;
  }
  if (caught.get(player) !== lair.key) {
    caught.set(player, lair.key);
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, WEB_MESSAGE);
  }
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(WEB_DRAIN.damage, core.HitMask.RED)]);
  const skills = player.getSkillManager();
  const prayer = skills.getCurrentLevel(core.Skill.PRAYER);
  if (prayer > 0) skills.setCurrentLevel(core.Skill.PRAYER, Math.max(0, prayer - WEB_DRAIN.prayer), true);
  player.setRunEnergy(player.getRunEnergy() - WEB_DRAIN.runEnergy);
  player.getPacketSender().sendRunEnergy();
}

function clearWebs(key) {
  const map = websOf(key);
  for (const web of map.values()) api.getObjectManager().deregister(web.object, true);
  map.clear();
}

// ------------------------------------------------------------------ the combat method

function combatClass() {
  const { CombatMethod, CombatType } = core;
  return class SpiderCombat extends CombatMethod {
    start(character, target) {
      const npc = character.getAsNpc();
      const spider = spiderOf(npc);
      this.npc = npc;
      if (!spider || !target?.isPlayer?.()) return;
      npc.setPositionToFace(target.getLocation());
      character.getCombat().setAttackDelay(SPEED);
      const at = target.getLocation();
      const adjacent = Common.edgeDistance(npc, at.getX(), at.getY()) === 1;
      const cycle = Number(npc.getAttribute(CYCLE_ATTRIBUTE)) || 0;
      npc.setAttribute(CYCLE_ATTRIBUTE, (cycle + 1) % CYCLE);
      if (adjacent) bite(npc, this, spider, target);
      else shoot(npc, this, spider, target, cycle < RANGED_ATTACKS ? "ranged" : "magic");
      if (cycle === 0) callSpiderlings(npc, spider, target);
      if (cycle === WEB_AT) throwWeb(npc, spider, target);
      if (cycle % MOVE_EVERY === MOVE_EVERY - 1 && Common.alive(npc) && Common.alive(target)) runOnAttack(npc, target);
    }

    onCombatEnded(character) {
      endRun(character.getAsNpc());
    }

    hits() {
      return [];
    }

    attackDistance() {
      return 10;
    }

    type() {
      const npc = this.npc;
      const target = npc?.getCombat?.().getTarget?.() ?? null;
      if (npc && target && Common.edgeDistance(npc, target.getLocation().getX(), target.getLocation().getY()) === 1) return CombatType.MELEE;
      return CombatType.RANGED;
    }
  };
}

/** An abandoned fight (Caves): the spiderlings and webs go, and the cycle starts over. */
function reset(npc) {
  const spider = spiderOf(npc);
  if (!spider) return;
  dismissBrood(broodOf(npc).spiderlings, false);
  broods.delete(npc);
  clearWebs(spider.key);
  npc.setAttribute(CYCLE_ATTRIBUTE, 0);
  endRun(npc);
}

function spawned(npc) {
  const spider = spiderOf(npc);
  if (!spider) return;
  npc.setAttribute(CYCLE_ATTRIBUTE, 0);
  endRun(npc);
  npc.setMovementSteps(RUN_STEPS);
  npc.setFlag("combat:no-regen");
  npc.performAnimation(new core.Animation(ANIMATION.spawn));
  npc.getCombat().setAttackDelay(FIRST_ATTACK_TICKS);
  clearWebs(spider.key);
}

function beforeDeath({ npc, preventDeath }) {
  const spider = spiderOf(npc);
  if (!spider || preventDeath) return;
  endRun(npc);
  const spiderlings = broodOf(npc).spiderlings;
  // Their death animations most often start five ticks after hers (rsprox 235/3376).
  if (spiderlings.length > 0) Common.later(SPIDERLING_DEATH_DELAY, () => dismissBrood(spiderlings, true));
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.registerNpcCombatMethodProvider(Object.keys(SPIDERS).map(Number), combatClass(), { singleton: false });
  pluginApi.onNpcBeforeDeath(beforeDeath);
  pluginApi.onPlayerBeforeDeath(beforeTargetDeath);
  pluginApi.onCombatHitResolved(spiderlingBite);
  for (const spider of Object.values(SPIDERS)) Common.FIGHTS.set(spider.key, { spawned, reset, playerTick });
}

module.exports = { attach, _test: { SPIDERS, WEB_PATTERN, SHOT_SHAPE, shotHitTicks } };
