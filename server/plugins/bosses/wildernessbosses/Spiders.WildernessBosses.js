/**
 * Venenatis and Spindel (https://oldschool.runescape.wiki/w/Venenatis/Strategies,
 * https://oldschool.runescape.wiki/w/Spindel/Strategies), as captured
 * (docs/wilderness-bosses.md):
 *
 * - Next to a player she only bites (npc_venenatis_melee_01). Otherwise she works through a cycle
 *   of 8 ranged spits then 8 magic webs, every 4 ticks, moving a few tiles every fourth attack.
 *   Both fly 25 + 2 per tile cycles and land with their impact (fx_venenatis_ranged/magic_impact).
 * - The cycle's first spit calls two spiderlings; while any live she hits through protection
 *   prayers. Each spiderling's bite drains a Prayer point: "You feel yourself drained by the
 *   spiderling." They die with her.
 * - The cycle's third web also throws a sticky web at the player's tile (fx_venenatis_web,
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
const MOVE_RANGE = 3;
const SPIDERLINGS = 2;
const SPIDERLING_RANGE = 6;

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
const ATTACKS_ATTRIBUTE = "wilderness-bosses:spider-attacks";

let api = null;
let core = null;
let PrayerHandler = null;
/** boss npc -> { spiderlings: NPC[] } */
const broods = new WeakMap();
/** lair key -> Map("x,y" -> { object, until }) of web tiles */
const webs = new Map();
/** player -> lair key whose web drained them last tick (one message a visit) */
const caught = new WeakMap();

function spiderOf(npc) {
  return SPIDERS[npc?.getRealId?.()] ?? null;
}

function broodOf(npc) {
  let brood = broods.get(npc);
  if (!brood) {
    brood = { spiderlings: [] };
    broods.set(npc, brood);
  }
  brood.spiderlings = brood.spiderlings.filter(Common.alive);
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

/** A few tiles to one side, every fourth attack (Wiki). */
function shuffle(npc) {
  const base = npc.getLocation();
  for (let tries = 0; tries < 10; tries++) {
    const x = base.getX() + Common.randomBetween(-MOVE_RANGE, MOVE_RANGE);
    const y = base.getY() + Common.randomBetween(-MOVE_RANGE, MOVE_RANGE);
    if ((x === base.getX() && y === base.getY()) || !Common.open(x, y, base.getZ())) continue;
    npc.getMovementQueue().addFirstStep(new core.Location(x, y, base.getZ()));
    return;
  }
}

// ------------------------------------------------------------------ spiderlings

/** Up to two at a time: a call only tops the brood up (the Wiki gives no larger number). */
function callSpiderlings(npc, spider, target) {
  const brood = broodOf(npc);
  const from = centre(npc);
  const wanted = SPIDERLINGS - brood.spiderlings.length;
  for (let i = 0, tries = 0; i < wanted && tries < 100; tries++) {
    const x = from.x + Common.randomBetween(-SPIDERLING_RANGE, SPIDERLING_RANGE);
    const y = from.y + Common.randomBetween(-SPIDERLING_RANGE, SPIDERLING_RANGE);
    if (!Common.open(x, y, from.z) || Common.edgeDistance(npc, x, y) < 1) continue;
    const spiderling = core.NPC.create(spider.spiderling, new core.Location(x, y, from.z));
    spiderling.__skipDefaultRespawn = true;
    spiderling.__wildernessBoss = npc;
    spiderling.setMultiCombat(true);
    spiderling.getMovementCoordinator?.().setRadius?.(20);
    core.World.getAddNPCQueue().push(spiderling);
    brood.spiderlings.push(spiderling);
    Common.engage(spiderling, target);
    i++;
  }
}

/** With her, the spiderlings die; an abandoned fight just takes them away. */
function dismissBrood(npc, die = true) {
  for (const spiderling of broodOf(npc).spiderlings) {
    if (die) spiderling.setHitpoints(0);
    else core.World.getRemoveNPCQueue().push(spiderling);
  }
}

/** A spiderling's bite drains a Prayer point, whatever it hits. */
function spiderlingBite({ attacker, target }) {
  if (!attacker?.isNpc?.() || !attacker.__wildernessBoss || !spiderOf(attacker.__wildernessBoss)) return;
  if (!target?.isPlayer?.()) return;
  const skills = target.getSkillManager();
  const prayer = skills.getCurrentLevel(core.Skill.PRAYER);
  if (prayer > 0) skills.setCurrentLevel(core.Skill.PRAYER, prayer - 1, true);
  target.sendMessage(SPIDERLING_MESSAGE);
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
    player.getPacketSender().sendGlobalGraphic(new core.Graphic(WEB_SHOT.impact, WEB_SHOT.end), land);
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
    player.sendMessage(WEB_MESSAGE);
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
      if (Common.edgeDistance(npc, at.getX(), at.getY()) === 1) {
        bite(npc, this, spider, target);
        return;
      }
      const cycle = Number(npc.getAttribute(CYCLE_ATTRIBUTE)) || 0;
      npc.setAttribute(CYCLE_ATTRIBUTE, (cycle + 1) % CYCLE);
      shoot(npc, this, spider, target, cycle < RANGED_ATTACKS ? "ranged" : "magic");
      if (cycle === 0) callSpiderlings(npc, spider, target);
      if (cycle === WEB_AT) throwWeb(npc, spider, target);
      const attacks = (Number(npc.getAttribute(ATTACKS_ATTRIBUTE)) || 0) + 1;
      npc.setAttribute(ATTACKS_ATTRIBUTE, attacks);
      if (attacks % MOVE_EVERY === 0) shuffle(npc);
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
  dismissBrood(npc, false);
  clearWebs(spider.key);
  npc.setAttribute(CYCLE_ATTRIBUTE, 0);
  npc.setAttribute(ATTACKS_ATTRIBUTE, 0);
}

function spawned(npc) {
  const spider = spiderOf(npc);
  if (!spider) return;
  npc.setAttribute(CYCLE_ATTRIBUTE, 0);
  npc.setAttribute(ATTACKS_ATTRIBUTE, 0);
  npc.setFlag("combat:no-regen");
  npc.performAnimation(new core.Animation(ANIMATION.spawn));
  npc.getCombat().setAttackDelay(FIRST_ATTACK_TICKS);
  clearWebs(spider.key);
}

function beforeDeath({ npc, preventDeath }) {
  const spider = spiderOf(npc);
  if (!spider || preventDeath) return;
  dismissBrood(npc);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.registerNpcCombatMethodProvider(Object.keys(SPIDERS).map(Number), combatClass(), { singleton: false });
  pluginApi.onNpcBeforeDeath(beforeDeath);
  pluginApi.onCombatHitResolved(spiderlingBite);
  for (const spider of Object.values(SPIDERS)) Common.FIGHTS.set(spider.key, { spawned, reset, playerTick });
}

module.exports = { attach, _test: { SPIDERS, WEB_PATTERN, SHOT_SHAPE, shotHitTicks } };
