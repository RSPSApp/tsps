"use strict";

/**
 * Mage Arena II's three followers (https://oldschool.runescape.wiki/w/Mage_Arena_II): Justiciar
 * Zachariah (Saradomin), Derwen (Guthix) and Porazdir (Zamorak), summoned by the Enchanted symbol
 * for the player who found them. Only what the Wiki or the live run (rsprox_transcripts/235/03344.txt)
 * gives is built.
 *
 * As the live run shows them:
 * - Each appears at its own location, inside the Wiki map's 5-tile circle round its spawn point
 *   (measured from its 3x3 centre: the Justiciar's 3 and Derwen's 5 tiles from points 15 and 17),
 *   11-12 tiles from the player: the Justiciar as his spawning form (5977, sequence 7964), 7858 two
 *   ticks later; Derwen as 7513 (sequence 7844), 7859 three ticks later. Area sound 1930 there.
 *   Porazdir's arrival wasn't seen (he came into view later, already walking), so he simply
 *   appears as 7860; cache id 7515 is probably his spawning form, unconfirmed.
 * - Each then goes for the player: Derwen cast as he arrived; the Justiciar walked up and cast
 *   unprovoked. The Wiki says "the follower will appear and attack you", though its infoboxes list
 *   only Derwen as aggressive; the run and the Mage Arena II page agree, so all three attack.
 * - Each casts every 6 ticks: the Justiciar 7962 with spot animation 1518 (height 128) and sound
 *   1659; Derwen 7849, 1511 (height 96), 1653 and "You feel weakened.", Defence down 1 + 5% (197 to
 *   187); Porazdir 7841, 78, 1655 and "You feel your magical powers weaken.", Magic down the same
 *   (195 to 185). A splash shows 85 (height 124) with 1656 (the Justiciar) or 227. The hit lands a
 *   tick after the cast.
 * - Derwen's 2nd attack, then every 6th (ticks 5836 and 5872 of a fight from 5830), is projectile
 *   1512 to a tile between him and the player, 2-4 tiles from them; an energy ball
 *   (ma2_guthix_healer 7514) appears there floor(end / 30) ticks later (end 106: 3, end 86: 2).
 *   One fired 1513 at Derwen 10 ticks after appearing (the other was killed first). Wiki: each
 *   heals him for 5 "every few seconds" and has 20 Hitpoints. Inferred: the target tile (a step of
 *   up to 4 toward him on each axis; matches the second summon, not the first), the heal landing
 *   with its projectile and repeating every 10 ticks, and no cap on balls (the run had one at a time).
 * - Their remains drop for the killer only, with "Untradeable drop: <name>" (npc-drops.json's
 *   always-drop rows).
 *
 * Wiki: only a follower's own god spell hurts it (not its energy balls); god-spell max hits 43,
 * the Justiciar's 26; remains can't be banked and are always lost on death.
 *
 * Also from the Wiki, with no rate, timing or visuals in either source (the run's 20 attacks show
 * none of them), so those are TSPS choices, marked below:
 * - melee beside the target (not diagonally), max 16 (the Justiciar's 43): TSPS half the time;
 * - Ice Barrage, "can be dodged by stepping off the square": the spell's own max 30, 32-tick
 *   freeze and impact graphic; accuracy and Protect from Magic apply ("Protection prayers reduce
 *   the accuracy and strength of their attacks"), a splash freezes nothing;
 * - Tele Block, lasting "a minute if Protect from Magic is used, rather than two minutes" (read as 2
 *   minutes without: an interpretation), fading when the follower dies; it rolls magic accuracy
 *   (TSPS: the Wiki doesn't say);
 * - Porazdir's energy ball through prayer, "upwards of 30", none from 12 tiles away, with "Porazdir
 *   fires a ball of energy directly linked to his power!"; TSPS: up to 30 beside him falling to
 *   none at 12 tiles, rolled between half that and it;
 * - the Justiciar's shock wave at the player's tile: still there, they're dragged into melee (TSPS:
 *   the nearest free tile beside him) and bound, his sword swinging every 3 ticks.
 * TSPS: one attack in five is one of these specials (on Derwen's turns that aren't his recorded
 * summons), each lands 2 ticks after it's cast (the dodge window), the bind lasts 8 ticks, and they
 * play the follower's attack animation (the energy ball its recorded cast). A dying follower's
 * pending specials don't land.
 *
 * Not built: a despawn timer ("if the followers are not slain quick enough, they will despawn",
 * no time given). A follower goes when it
 * dies, when its owner logs out or dies (Wiki: "If you're killed, you'll have to kill the follower
 * again"), when the symbol's locations rotate ("the creatures have moved locations"), and, a TSPS
 * choice, when its owner leaves the Wilderness, which frees its spawn point for other players.
 */
const MageArenaII = require("./MageArenaII.MageArena");

const SPAWN_SOUND = 1930;
const SPLASH_GRAPHIC = 85;
const SPLASH_HEIGHT = 124;
const ATTACK_SPEED = 6;
const SPAWN_RADIUS = 5;
/** A follower's 3x3 centre is one tile in from its south-west tile. */
const CENTRE_OFFSET = 1;
const FOLLOWER_SIZE = 3;
/** Derwen's 2nd attack and every 6th after it summon an energy ball (235/03344). */
const SUMMON_FIRST = 2;
const SUMMON_EVERY = 6;
const HEALER_HEAL = 5;
const HEAL_INTERVAL_TICKS = 10;
/** How often a follower checks that its owner is still in the Wilderness. */
const WATCH_INTERVAL_TICKS = 5;
/** The Wilderness above ground (the underground half starts at y 9920). */
const UNDERGROUND_Y = 9920;
const untradeableDrop = (name) => `<col=ef1020>Untradeable drop: ${name}</col>`;
// The Wiki's specials. TSPS choices: the chance, the 2-tick landing and the 8-tick bind.
const SPECIAL_CHANCE = 5;
const SPECIAL_LAND_TICKS = 2;
const SHOCK_WAVE_BIND_TICKS = 8;
/** Wiki: the sword attacks every 3 ticks while the player is bound. */
const BOUND_ATTACK_SPEED = 3;
/** Wiki (Ice Barrage): max hit 30, a 20-second (32-tick) freeze. */
const BARRAGE_MAX_HIT = 30;
const BARRAGE_FREEZE_TICKS = 32;
/** Wiki: "upwards of 30", none 12 or more tiles away. */
const ENERGY_BALL_MAX = 30;
const ENERGY_BALL_RANGE = 12;
const ENERGY_BALL_MESSAGE = "Porazdir fires a ball of energy directly linked to his power!";
/** Wiki: 2 minutes, 1 with Protect from Magic. */
const TELE_BLOCK_SECONDS = 120;
const TELE_BLOCK_PROTECTED_SECONDS = 60;

/** Each follower's recorded arrival and god-spell attack. */
const COMBAT = Object.freeze({
  saradomin: {
    spawnAnim: 7964, spawnTicks: 2, special: "shockWave", meleeMaxHit: 43,
    magic: { anim: 7962, gfx: 1518, height: 128, sound: 1659, splashSound: 1656, maxHit: 26 },
  },
  guthix: {
    spawnAnim: 7844, spawnTicks: 3, special: null, meleeMaxHit: 16,
    summon: { projectile: 1512, start: 30, base: 46, perTile: 10, startHeight: 100, endHeight: 20 },
    heal: { projectile: 1513, start: 0, end: 106, angle: 20, startHeight: 10, endHeight: 220 },
    magic: { anim: 7849, gfx: 1511, height: 96, sound: 1653, splashSound: 227, maxHit: 43, drain: "DEFENCE", message: "You feel weakened." },
  },
  zamorak: {
    spawnAnim: null, spawnTicks: 0, special: "energyBall", meleeMaxHit: 16,
    magic: { anim: 7841, gfx: 78, height: 0, sound: 1655, splashSound: 227, maxHit: 43, drain: "MAGIC", message: "You feel your magical powers weaken." },
  },
});

let api;
let core;
/** npc -> { player, follower, combat, attacks, healers, bound, teleBlockUntil } */
const active = new Map();

function later(ticks, action) {
  const { Task } = core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function every(ticks, action) {
  const { Task } = core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })());
}

function graphic(id, height = 0, delay = 0) {
  const gfx = new core.Graphic(id);
  gfx.height = height;
  gfx.delay = delay;
  return gfx;
}

function sound(source, id, delay = 0) {
  core.Sounds.sendSound(source, new core.Sound(id, 1, delay, 0));
}

function now() {
  return core.World.getProcessCycle?.() ?? 0;
}

/** Tiles from the npc's footprint to the target, 0 when adjacent. */
function edgeDistance(npc, target) {
  const a = npc.getLocation();
  const b = target.getLocation();
  const size = npc.size?.() ?? FOLLOWER_SIZE;
  const dx = Math.max(a.getX() - b.getX(), 0, b.getX() - (a.getX() + size - 1));
  const dy = Math.max(a.getY() - b.getY(), 0, b.getY() - (a.getY() + size - 1));
  return Math.max(dx, dy) - 1;
}

/** A copy of where a mobile stands now. */
function tileOf(mobile) {
  const at = mobile.getLocation();
  return new core.Location(at.getX(), at.getY(), at.getZ());
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
}

/** Still fighting: in the world and not in its death animation. */
function alive(npc) {
  return npc.isRegistered() && npc.getHitpoints() > 0;
}

/** Beside the follower's footprint on a side, not a corner (NPCs don't melee diagonally). */
function besideSide(npc, target) {
  const a = npc.getLocation();
  const b = target.getLocation();
  const size = npc.size?.() ?? FOLLOWER_SIZE;
  const inX = b.getX() >= a.getX() && b.getX() < a.getX() + size;
  const inY = b.getY() >= a.getY() && b.getY() < a.getY() + size;
  return edgeDistance(npc, target) === 0 && (inX || inY);
}

function stateOf(npc) {
  return npc ? active.get(npc) ?? null : null;
}

/** The player's live follower of this god; one taken out of the world by something else is forgotten. */
function followerOfPlayer(player, follower) {
  for (const [npc, state] of active) {
    if (state.player !== player || state.follower !== follower) continue;
    if (npc.isRegistered() || core.World.getAddNPCQueue().includes(npc)) return state;
    dismiss(npc, state);
  }
  return null;
}

/** A free 3x3 footprint whose centre is within the map's 5-tile circle round the spawn point. */
function spawnTile([px, py], random = Math.random) {
  const region = api.getRegionManager();
  const free = (x, y) => {
    for (let ox = 0; ox < FOLLOWER_SIZE; ox++) {
      for (let oy = 0; oy < FOLLOWER_SIZE; oy++) {
        if (region.blocked(new core.Location(x + ox, y + oy, 0), null)) return false;
      }
    }
    return true;
  };
  const tiles = [];
  for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
    for (let dy = -SPAWN_RADIUS; dy <= SPAWN_RADIUS; dy++) {
      const x = px + dx - CENTRE_OFFSET;
      const y = py + dy - CENTRE_OFFSET;
      if (dx * dx + dy * dy <= SPAWN_RADIUS * SPAWN_RADIUS && free(x, y)) tiles.push([x, y]);
    }
  }
  if (!tiles.length) return null;
  const [x, y] = tiles[Math.floor(random() * tiles.length)];
  return new core.Location(x, y, 0);
}

/**
 * The symbol at "visibly shaking": the follower appears at its own spawn tile ([x, y], chosen with
 * spawnTile when the locations rotated). One per spawn point at a time (Wiki: someone else's
 * follower there must despawn first), one of each per player.
 */
function summon(player, follower, pointIndex, [x, y]) {
  if (followerOfPlayer(player, follower)) return null;
  const npc = api.spawnNpc({
    id: follower.npcId, x, y, z: 0,
    owner: player, wanderRadius: 0, unique: `mage-arena-ii:point:${pointIndex}`,
  });
  if (!npc) return null;
  const combat = COMBAT[follower.key];
  active.set(npc, { player, follower, combat, attacks: 0, healers: new Set(), bound: false, teleBlockUntil: 0 });
  every(WATCH_INTERVAL_TICKS, () => watch(npc));
  sound(npc, SPAWN_SOUND);
  if (follower.spawningId != null) npc.setNpcTransformationId(follower.spawningId);
  if (combat.spawnAnim != null) npc.performAnimation(new core.Animation(combat.spawnAnim));
  later(Math.max(1, combat.spawnTicks), () => {
    if (!npc.isRegistered()) return;
    if (follower.spawningId != null) npc.setNpcTransformationId(-1);
    if (player.isRegistered()) npc.getCombat().attack(player);
  });
  return npc;
}

function ownerInWilderness(player) {
  const at = player.getLocation();
  return player.isRegistered() && core.Wilderness.isInLocation(at) && at.getY() < UNDERGROUND_Y;
}

/**
 * A follower goes once its owner has left the Wilderness, so its spawn point (one follower each,
 * for every player) is free again. TSPS choice: the Wiki only says they "will despawn" if not
 * slain quickly, with no time. Stops once the follower is gone or dying (followerDied).
 */
function watch(npc) {
  const state = stateOf(npc);
  if (!state || !npc.isRegistered() || npc.getHitpoints() <= 0) return false;
  if (ownerInWilderness(state.player)) return true;
  dismiss(npc, state);
  return false;
}

function dismiss(npc, state) {
  active.delete(npc);
  release(state);
  if (npc.isRegistered()) api.removeNpc(npc);
}

/** Its energy balls go with it, and its Tele Block fades (Wiki), if it's still running: a later one (a PKer's) stays. */
function release(state) {
  for (const healer of state.healers) {
    if (healer.isRegistered()) api.removeNpc(healer);
  }
  state.healers.clear();
  if (now() < state.teleBlockUntil && core.TeleBlock.isBlocked(state.player)) core.TeleBlock.remove(state.player);
  state.teleBlockUntil = 0;
}

function drain(target, skillName) {
  const skill = core.Skill[skillName];
  const skills = target.getSkillManager();
  const level = skills.getCurrentLevel(skill);
  skills.setCurrentLevel(skill, Math.max(0, level - (1 + Math.floor(level * 0.05))), true);
}

/** The tile Derwen's ball aims at: 2-4 tiles from the player toward him (inferred; see the header). */
function ballTile(npc, target) {
  const from = target.getLocation();
  const centre = core.Projectile.centreOf(npc);
  const dx = Math.sign(centre.getX() - from.getX());
  const dy = Math.sign(centre.getY() - from.getY());
  const steps = core.Misc.randomInclusive(2, 4);
  return new core.Location(from.getX() + dx * steps, from.getY() + dy * steps, from.getZ());
}

/** Derwen's energy ball: 1512 to the tile, the ball there as it lands, healing him while both live. */
function summonHealer(npc, target, state) {
  const spec = state.combat.summon;
  npc.performAnimation(new core.Animation(state.combat.magic.anim));
  const tile = ballTile(npc, target);
  const start = core.Projectile.centreOf(npc);
  const end = spec.base + spec.perTile * start.getDistance(tile);
  new core.Projectile(start, tile, null, spec.projectile, spec.start, end, spec.startHeight, spec.endHeight, null).sendProjectile();
  later(landingTicks(end), () => {
    if (!stateOf(npc) || !npc.isRegistered()) return;
    const ball = api.spawnNpc({ id: core.NpcIdentifiers.COL_FF9040_ENERGY_BALL_COL, x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: state.player, wanderRadius: 0 });
    if (!ball) return;
    state.healers.add(ball);
    every(HEAL_INTERVAL_TICKS, () => heal(npc, ball, state));
  });
}

/** The ball's 1513 at Derwen; the heal lands with it. */
function heal(npc, ball, state) {
  const alive = () => ball.isRegistered() && ball.getHitpoints() > 0 && stateOf(npc) && npc.isRegistered() && npc.getHitpoints() > 0;
  if (!alive()) {
    state.healers.delete(ball);
    return false;
  }
  const spec = state.combat.heal;
  new core.Projectile(core.Projectile.centreOf(ball), core.Projectile.centreOf(npc), npc, spec.projectile, spec.start, spec.end, spec.startHeight, spec.endHeight, null)
    .withAngle(spec.angle).sendProjectile();
  later(landingTicks(spec.end), () => {
    if (alive()) npc.heal(HEALER_HEAL);
  });
  return true;
}

/** Ticks until a projectile ending at `end` client cycles lands, as recorded: 106 -> 3, 86 -> 2. */
function landingTicks(end) {
  return Math.max(1, Math.floor(end / 30));
}

// ---- The Wiki's specials (their timing is TSPS's; see the header) ----

/** A magic hit from the follower with accuracy and protection prayers, as its own casts have. */
function magicHit(npc, target, maxHit) {
  const { PendingHit, CombatFactory } = core;
  const method = new (createCombatMethod())();
  method.attack = { style: "MAGIC", spec: { maxHit } };
  const hit = new PendingHit(npc, target, method, { delay: 0 });
  CombatFactory.applyStyleDamage(hit, maxHit);
  return hit;
}

/** The nearest free tile on a side of the follower, toward the player, or null. */
function dragTile(npc, target) {
  const at = npc.getLocation();
  const size = npc.size?.() ?? FOLLOWER_SIZE;
  const region = api.getRegionManager();
  const from = target.getLocation();
  const sides = [];
  for (let i = 0; i < size; i++) {
    sides.push([at.getX() + i, at.getY() - 1], [at.getX() + i, at.getY() + size], [at.getX() - 1, at.getY() + i], [at.getX() + size, at.getY() + i]);
  }
  const free = sides.map(([x, y]) => new core.Location(x, y, at.getZ()))
    .filter((tile) => !region.blocked(tile, null) && core.Wilderness.isInLocation(tile));
  free.sort((p, q) => p.getDistance(from) - q.getDistance(from));
  return free[0] ?? null;
}

/** Ice Barrage at the tile the player stood on: dodged by leaving it (Wiki). */
function iceBarrage(npc, target) {
  const spell = core.CombatSpells.ICE_BARRAGE.getSpell();
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  const aimed = tileOf(target);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !alive(npc) || !target.isRegistered() || !sameTile(target.getLocation(), aimed)) return;
    const hit = magicHit(npc, target, BARRAGE_MAX_HIT);
    target.getCombat().getHitQueue().addPendingHit(hit, core.World.getProcessCycle());
    if (!hit.isAccurate()) {
      target.performGraphic(graphic(SPLASH_GRAPHIC, SPLASH_HEIGHT));
      return;
    }
    const end = spell.endGraphic?.();
    if (end) target.performGraphic(end);
    // The red freeze line comes from the freeze itself (kind "ice"), as for the real spell.
    core.CombatFactory.freezeTicks(target, BARRAGE_FREEZE_TICKS, null, npc, "ice");
  });
}

/** Tele Block: 2 minutes, 1 with Protect from Magic (Wiki), fading when the follower dies. */
function teleBlock(npc, target, state) {
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !alive(npc) || !target.isRegistered() || core.TeleBlock.isBlocked(target)) return;
    if (!magicHit(npc, target, 0).isAccurate()) {
      target.performGraphic(graphic(SPLASH_GRAPHIC, SPLASH_HEIGHT));
      return;
    }
    const protectedFromMagic = core.PrayerHandler.isActivated(target, core.PrayerHandler.PROTECT_FROM_MAGIC);
    const seconds = protectedFromMagic ? TELE_BLOCK_PROTECTED_SECONDS : TELE_BLOCK_SECONDS;
    core.TeleBlock.apply(target, npc.getDefinition().getName(), seconds);
    state.teleBlockUntil = now() + core.Misc.getTicks(seconds);
  });
}

/** Porazdir's energy ball: through prayer, up to 30 up close and nothing from 12 tiles (Wiki). */
function energyBall(npc, target) {
  npc.performAnimation(new core.Animation(COMBAT.zamorak.magic.anim));
  target.sendMessage(ENERGY_BALL_MESSAGE);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !alive(npc) || !target.isRegistered()) return;
    // Tiles from his footprint: 1 beside him, where it does the most.
    const distance = edgeDistance(npc, target) + 1;
    if (distance >= ENERGY_BALL_RANGE) return;
    const cap = Math.round(ENERGY_BALL_MAX * (ENERGY_BALL_RANGE - distance) / (ENERGY_BALL_RANGE - 1));
    const damage = core.Misc.randomInclusive(Math.floor(cap / 2), cap);
    target.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
  });
}

/** The Justiciar's shock wave at the player's tile: still there, they're pulled beside him and bound (Wiki). */
function shockWave(npc, target, state) {
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  const aimed = tileOf(target);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !alive(npc) || !target.isRegistered() || !sameTile(target.getLocation(), aimed)) return;
    const tile = dragTile(npc, target);
    if (!tile) return;
    target.moveTo(tile);
    core.CombatFactory.freezeTicks(target, SHOCK_WAVE_BIND_TICKS, null, npc, "bind");
    // A freeze can be refused (still immune after the last one): no bind, no fast sword.
    if (!target.getTimers().has(core.TimerKey.FREEZE)) return;
    state.bound = true;
    later(SHOCK_WAVE_BIND_TICKS, () => { state.bound = false; });
  });
}

const SPECIALS = { shockWave, energyBall };

function magicAttack(npc, state) {
  const spec = state.combat.magic;
  npc.performAnimation(new core.Animation(spec.anim));
  return { style: "MAGIC", spec };
}

/** Melee only beside the target, on a side (bound, always; otherwise TSPS half the time), else the god spell. */
function meleeOrMagic(npc, target, state) {
  const adjacent = besideSide(npc, target);
  if (adjacent && (state.bound || core.Misc.randomInclusive(0, 1) === 0)) {
    npc.performAnimation(new core.Animation(npc.getAttackAnim()));
    return { style: "MELEE", maxHit: state.combat.meleeMaxHit };
  }
  return magicAttack(npc, state);
}

/**
 * This attack: Derwen's recorded summon on its turn; otherwise, while not bound, a Wiki special one
 * time in five (TSPS); otherwise melee beside the target or the god spell.
 */
function chooseAttack(npc, target, state) {
  state.attacks++;
  if (state.combat.summon && state.attacks >= SUMMON_FIRST && (state.attacks - SUMMON_FIRST) % SUMMON_EVERY === 0) {
    summonHealer(npc, target, state);
    return null;
  }
  if (!state.bound && core.Misc.randomInclusive(1, SPECIAL_CHANCE) === 1) {
    const options = ["barrage"];
    if (!core.TeleBlock.isBlocked(target)) options.push("teleBlock");
    if (state.combat.special) options.push(state.combat.special);
    const pick = options[core.Misc.randomInclusive(0, options.length - 1)];
    if (pick === "barrage") iceBarrage(npc, target);
    else if (pick === "teleBlock") teleBlock(npc, target, state);
    else SPECIALS[pick](npc, target, state);
    return null;
  }
  return meleeOrMagic(npc, target, state);
}

function createCombatMethod() {
  const { CombatMethod, CombatType, CombatFactory, PendingHit } = core;
  return class FollowerCombat extends CombatMethod {
    constructor() {
      super();
      this.attack = null;
    }

    type() {
      return CombatType[this.attack?.style ?? "MAGIC"];
    }

    attackDistance() {
      return 10;
    }

    attackSpeed(npc) {
      // The fast sword only for a bound player still beside him.
      const state = stateOf(npc);
      const target = npc.getCombat?.()?.getTarget?.();
      return state?.bound && target && besideSide(npc, target) ? BOUND_ATTACK_SPEED : ATTACK_SPEED;
    }

    start(npc, target) {
      const state = stateOf(npc);
      this.attack = state ? chooseAttack(npc, target, state) : null;
    }

    hits(npc, target) {
      const attack = this.attack;
      if (!attack) return [];
      const hit = new PendingHit(npc, target, this, 1);
      CombatFactory.applyStyleDamage(hit, attack.style === "MELEE" ? attack.maxHit : attack.spec.maxHit);
      if (attack.style === "MAGIC") {
        const { spec } = attack;
        const landed = hit.isAccurate();
        target.performGraphic(landed ? graphic(spec.gfx, spec.height, 30) : graphic(SPLASH_GRAPHIC, SPLASH_HEIGHT, 30));
        sound(target, landed ? spec.sound : spec.splashSound, 30);
      }
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const spec = this.attack?.spec;
      const target = hit.getTarget();
      if (!spec?.drain || !hit.isAccurate() || !target?.isPlayer?.()) return;
      drain(target, spec.drain);
      target.sendMessage(spec.message);
    }
  };
}

// ---- Hooks ----

/** Only its own god spell hurts a follower (Wiki). */
function godSpellOnly({ npc, hit }) {
  const state = stateOf(npc);
  if (!state) return;
  if (hit.getSpell?.()?.spellId?.() !== state.follower.spellId) hit.setTotalDamage(0);
}

/** Its remains only for an owner who doesn't already carry them; the drop is announced as live. */
function remainsDrop({ player, npc, drops }) {
  const state = stateOf(npc);
  if (!state) return;
  const { follower } = state;
  const index = drops.findIndex((drop) => drop.itemId === follower.remainsId);
  if (index < 0) return;
  if (MageArenaII.carries(player, follower)) {
    drops.splice(index, 1);
    return;
  }
  player.sendMessage(untradeableDrop(core.ItemDefinition.forId(follower.remainsId).getName()));
}

/**
 * Its death: the drop handlers run on this same event, possibly after this unit, and need the
 * follower's state to gate its remains, so it's forgotten a tick later. The death task takes the
 * npc out of the world.
 */
function followerDied({ npc }) {
  const state = stateOf(npc);
  if (!state) return;
  release(state);
  later(1, () => active.delete(npc));
}

/**
 * Its owner logged out or died, or the locations moved: their followers go. One already dying is
 * left to its death (followerDied), so its remains still drop.
 */
function dismissFor(player) {
  for (const [npc, state] of [...active]) {
    if (state.player === player && npc.getHitpoints() > 0) dismiss(npc, state);
  }
}

function ownerLeft({ player }) {
  dismissFor(player);
}

/** Every player death (onPlayerDeath can be claimed first, as Death's office does a first grave). */
function ownerDefeated({ victim }) {
  if (victim?.isPlayer?.()) dismissFor(victim);
}

function isRemains(item) {
  return MageArenaII.followerByRemains(item?.getId?.()) !== null;
}

/** Remains can't be banked (Wiki); no refusal message is recorded, so none is sent. */
function refuseBank(event) {
  if (isRemains(event.item)) event.allow = false;
}

function loseOnDeath(event) {
  if (isRemains(event.item)) event.keep = false;
}

function remainsDestroyPrompt(prompt) {
  const follower = MageArenaII.followerByRemains(prompt.item?.getId?.());
  if (!follower) return;
  const beings = { saradomin: "Saradominist Justiciar", guthix: "Guthixian Ent", zamorak: "Zamorakian Demon" };
  prompt.warning = `You will have to locate and defeat the ${beings[follower.key]} again.`;
}

module.exports = function registerFollowers(pluginApi) {
  api = pluginApi;
  core = api.core;
  const method = createCombatMethod();
  for (const follower of MageArenaII.getFollowers()) api.registerNpcCombatMethodProvider(follower.npcId, method, { singleton: false });
  api.onNpcHitModify(godSpellOnly);
  api.onCustomEvent("npc-drops:roll", remainsDrop);
  api.onNpcDeath(followerDied);
  api.onPlayerLogout(ownerLeft);
  api.onPlayerDisconnect(ownerLeft);
  api.onPlayerDefeated(ownerDefeated);
  api.onCanBankItem(refuseBank);
  api.onShouldKeepItemOnDeath(loseOnDeath);
  api.onCustomEvent("destroy-item:prompt", remainsDestroyPrompt);
};

Object.assign(module.exports, {
  summon,
  spawnTile,
  dismissFor,
  _test: {
    COMBAT, SPAWN_RADIUS, active, stateOf, summon, watch, dismiss, dismissFor, followerDied, chooseAttack, createCombatMethod, ballTile, landingTicks,
    edgeDistance, besideSide, dragTile, meleeOrMagic, shockWave, teleBlock, iceBarrage, energyBall,
    godSpellOnly, remainsDrop, refuseBank, loseOnDeath, remainsDestroyPrompt, drain,
  },
});
