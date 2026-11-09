"use strict";

/**
 * Mage Arena II's three followers (https://oldschool.runescape.wiki/w/Mage_Arena_II): Justiciar
 * Zachariah (Saradomin), Derwen (Guthix) and Porazdir (Zamorak), summoned by the Enchanted symbol
 * for the player who found them.
 *
 * As a live run shows them (rsprox_transcripts/235/03344.txt):
 * - The Justiciar appears as his spawning form (5977, sequence 7964) and becomes 7858 two ticks
 *   later; Derwen as 7513 (sequence 7844), 7859 three ticks later; Porazdir as himself. Area sound
 *   1930 as each arrives.
 * - Each casts every 6 ticks: the Justiciar 7962 with spot animation 1518 (height 128) and sound
 *   1659; Derwen 7849, 1511 (height 96), 1653 and "You feel weakened."; Porazdir 7841, 78, 1655
 *   and "You feel your magical powers weaken.". A splash shows 85 with 1656 (the Justiciar) or 227.
 * - Derwen's projectile 1512 lands where an energy ball (ma2_guthix_healer 7514) appears 3 ticks
 *   later.
 * - Their remains drop 3 ticks after the death sequence, for the killer only, with "Untradeable
 *   drop: <name>" (npc-drops.json's always-drop rows).
 *
 * From the Wiki, with no visuals recorded for them: only their own god spell hurts them; melee
 * when adjacent (16, the Justiciar 43); god-spell max hits 43 (the Justiciar 26); Derwen's
 * spell drains Defence and Porazdir's Magic by 1 + 5%; Ice Barrage, dodged by leaving the tile;
 * Tele Block, 2 minutes or 1 with Protect from Magic, lifted when the follower dies; Porazdir's
 * energy ball through prayer, up to 30 and none from 12 tiles; Derwen's energy balls (20
 * Hitpoints) heal him 5 every few seconds; the Justiciar's shock wave at the player's tile drags
 * them into melee and binds them while his sword swings every 3 ticks.
 *
 * Remains can't be banked and are always lost on death (Wiki).
 *
 * TSPS choices (no source): a follower leaves if not killed within 5 minutes, or when its owner
 * leaves the Wilderness, logs out or is 20+ tiles away; one special attack in five.
 */
const MageArenaII = require("./MageArenaII.MageArena");

const SPAWN_SOUND = 1930;
const SPLASH_GRAPHIC = 85;
const ATTACK_SPEED = 6;
const BOUND_ATTACK_SPEED = 3;
const SPECIAL_CHANCE = 5;
const LIFETIME_TICKS = 500;
const LEASH_DISTANCE = 20;
const WATCH_INTERVAL_TICKS = 5;
const FOLLOWER_SIZE = 3;
const MAX_HEALERS = 2;
const HEALER_HEAL = 5;
const HEAL_INTERVAL_TICKS = 4;
const HEALER_SPAWN_TICKS = 3;
const BARRAGE_MAX_HIT = 30;
const BARRAGE_FREEZE_TICKS = 32;
const ENERGY_BALL_MAX = 30;
const ENERGY_BALL_RANGE = 12;
const SHOCK_WAVE_BIND_TICKS = 8;
const TELE_BLOCK_SECONDS = 120;
const TELE_BLOCK_PROTECTED_SECONDS = 60;
const SPECIAL_LAND_TICKS = 2;
const UNBANKABLE = "You can't bank that.";
const ENERGY_BALL_MESSAGE = "Porazdir fires a ball of energy directly linked to his power!";
const untradeableDrop = (name) => `<col=ef1020>Untradeable drop: ${name}</col>`;

/** Each follower's recorded god-spell attack and its own special. */
const COMBAT = Object.freeze({
  saradomin: {
    spawnAnim: 7964, spawnTicks: 2, special: "shockWave",
    magic: { anim: 7962, gfx: 1518, height: 128, sound: 1659, splashSound: 1656, maxHit: 26 },
    meleeMaxHit: 43,
  },
  guthix: {
    spawnAnim: 7844, spawnTicks: 3, special: "healer", healerProjectile: 1512, healProjectile: 1513,
    magic: { anim: 7849, gfx: 1511, height: 96, sound: 1653, splashSound: 227, maxHit: 43, drain: "DEFENCE", message: "You feel weakened." },
    meleeMaxHit: 16,
  },
  zamorak: {
    spawnAnim: null, spawnTicks: 2, special: "energyBall",
    magic: { anim: 7841, gfx: 78, height: 0, sound: 1655, splashSound: 227, maxHit: 43, drain: "MAGIC", message: "You feel your magical powers weaken." },
    meleeMaxHit: 16,
  },
});

let api;
let core;
/** npc -> { player, follower, combat, spawnedAt, bound, teleBlockUntil, healers } */
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

function stateOf(npc) {
  return npc ? active.get(npc) ?? null : null;
}

function followerOfPlayer(player, follower) {
  for (const state of active.values()) {
    if (state.player === player && state.follower === follower) return state;
  }
  return null;
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

/** A free 3x3 footprint a couple of tiles from the player. */
function spawnTile(player) {
  const origin = player.getLocation();
  const region = api.getRegionManager();
  const offsets = [[2, 0], [-4, 0], [0, 2], [0, -4], [2, 2], [-4, -4], [2, -4], [-4, 2]];
  for (const [dx, dy] of offsets) {
    const x = origin.getX() + dx;
    const y = origin.getY() + dy;
    let free = true;
    for (let ox = 0; ox < FOLLOWER_SIZE && free; ox++) {
      for (let oy = 0; oy < FOLLOWER_SIZE && free; oy++) {
        if (region.blocked(new core.Location(x + ox, y + oy, origin.getZ()), null)) free = false;
      }
    }
    if (free) return new core.Location(x, y, origin.getZ());
  }
  return null;
}

/**
 * The symbol at "visibly shaking": the follower appears beside its finder and attacks. One per
 * spawn point at a time (Wiki: someone else's follower there must despawn first), one of each per player.
 */
function summon(player, follower, pointIndex) {
  if (followerOfPlayer(player, follower)) return null;
  const tile = spawnTile(player);
  if (!tile) return null;
  const npc = api.spawnNpc({
    id: follower.npcId, x: tile.getX(), y: tile.getY(), z: tile.getZ(),
    owner: player, wanderRadius: 0, unique: `mage-arena-ii:point:${pointIndex}`,
  });
  if (!npc) return null;
  const combat = COMBAT[follower.key];
  const state = { player, follower, combat, spawnedAt: now(), bound: false, teleBlockUntil: 0, healers: new Set() };
  active.set(npc, state);
  sound(npc, SPAWN_SOUND);
  if (follower.spawningId != null) npc.setNpcTransformationId(follower.spawningId);
  if (combat.spawnAnim != null) npc.performAnimation(new core.Animation(combat.spawnAnim));
  later(combat.spawnTicks, () => {
    if (!npc.isRegistered()) return;
    if (follower.spawningId != null) npc.setNpcTransformationId(-1);
    if (player.isRegistered()) npc.getCombat().attack(player);
  });
  every(WATCH_INTERVAL_TICKS, () => watch(npc));
  return npc;
}

/** Leaves when its owner is gone, out of the Wilderness or far off, or it lived too long. */
function watch(npc) {
  const state = stateOf(npc);
  if (!state) return false;
  if (!npc.isRegistered()) {
    // Taken out of the world by something else: forget it, or it blocks summoning it again.
    active.delete(npc);
    release(state);
    return false;
  }
  // A dying follower is the death task's (followerDied).
  if (npc.getHitpoints() <= 0) return false;
  const { player } = state;
  const gone = !player.isRegistered() || player.getHitpoints() <= 0 ||
    !core.Wilderness.isInLocation(player.getLocation()) ||
    npc.getLocation().getDistance(player.getLocation()) > LEASH_DISTANCE ||
    now() - state.spawnedAt > LIFETIME_TICKS;
  if (!gone) return true;
  dismiss(npc, state);
  return false;
}

/** Its energy balls go, and its Tele Block lifts (Wiki: "fades when the follower dies"). */
function release(state) {
  for (const healer of state.healers) {
    if (healer.isRegistered()) api.removeNpc(healer);
  }
  state.healers.clear();
  // Only its own block, still running: a later one (a PKer's) stays.
  if (now() < state.teleBlockUntil && core.TeleBlock.isBlocked(state.player)) core.TeleBlock.remove(state.player);
  state.teleBlockUntil = 0;
}

function dismiss(npc, state) {
  active.delete(npc);
  release(state);
  if (npc.isRegistered()) api.removeNpc(npc);
}

// ---- Specials ----

function drain(target, skillName) {
  const skill = core.Skill[skillName];
  const skills = target.getSkillManager();
  const level = skills.getCurrentLevel(skill);
  skills.setCurrentLevel(skill, Math.max(0, level - (1 + Math.floor(level * 0.05))), true);
}

/** Ice Barrage at the tile the player stood on: dodged by leaving it (Wiki). */
function iceBarrage(npc, target) {
  const spell = core.CombatSpells.ICE_BARRAGE.getSpell();
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  const aimed = tileOf(target);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !target.isRegistered() || !sameTile(target.getLocation(), aimed)) return;
    const end = spell.endGraphic?.();
    if (end) target.performGraphic(end);
    const damage = core.Misc.randomInclusive(0, BARRAGE_MAX_HIT);
    target.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    core.CombatFactory.freezeTicks(target, BARRAGE_FREEZE_TICKS, "You have been frozen!", npc, "ice");
  });
}

/** Tele Block: 2 minutes, 1 with Protect from Magic (Wiki), lifted when the follower dies. */
function teleBlock(npc, target, state) {
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !target.isRegistered() || core.TeleBlock.isBlocked(target)) return;
    const protectedFromMagic = core.PrayerHandler.isActivated(target, core.PrayerHandler.PROTECT_FROM_MAGIC);
    const seconds = protectedFromMagic ? TELE_BLOCK_PROTECTED_SECONDS : TELE_BLOCK_SECONDS;
    core.TeleBlock.apply(target, npc.getDefinition().getName(), seconds);
    state.teleBlockUntil = now() + core.Misc.getTicks(seconds);
  });
}

/** Porazdir's energy ball: through prayer, 30 up close and nothing from 12 tiles (Wiki). */
function energyBall(npc, target) {
  npc.performAnimation(new core.Animation(COMBAT.zamorak.magic.anim));
  target.sendMessage(ENERGY_BALL_MESSAGE);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !target.isRegistered()) return;
    const distance = edgeDistance(npc, target) + 1;
    if (distance >= ENERGY_BALL_RANGE) return;
    const cap = Math.round(ENERGY_BALL_MAX * (ENERGY_BALL_RANGE - distance) / ENERGY_BALL_RANGE);
    const damage = core.Misc.randomInclusive(Math.floor(cap / 2), cap);
    target.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
  });
}

/** Derwen's energy ball: 1512 to a tile beside him, a healer there 3 ticks later (235/03344). */
function healer(npc, target, state) {
  if (state.healers.size >= MAX_HEALERS) return meleeOrMagic(npc, target, state);
  npc.performAnimation(new core.Animation(COMBAT.guthix.magic.anim));
  const at = npc.getLocation();
  const tile = new core.Location(at.getX() + core.Misc.randomInclusive(-3, 5), at.getY() + core.Misc.randomInclusive(-3, 5), at.getZ());
  new core.Projectile(core.Projectile.centreOf(npc), tile, null, state.combat.healerProjectile, 30, 86, 100, 20, null).sendProjectile();
  later(HEALER_SPAWN_TICKS, () => {
    if (!stateOf(npc) || !npc.isRegistered()) return;
    const ball = api.spawnNpc({ id: core.NpcIdentifiers.COL_FF9040_ENERGY_BALL_COL, x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: state.player, wanderRadius: 0 });
    if (!ball) return;
    state.healers.add(ball);
    every(HEAL_INTERVAL_TICKS, () => {
      if (!ball.isRegistered() || ball.getHitpoints() <= 0 || !stateOf(npc) || !npc.isRegistered() || npc.getHitpoints() <= 0) {
        state.healers.delete(ball);
        return false;
      }
      new core.Projectile(core.Projectile.centreOf(ball), core.Projectile.centreOf(npc), npc, state.combat.healProjectile, 0, 106, 10, 220, null).sendProjectile();
      npc.heal(HEALER_HEAL);
      return true;
    });
  });
  return null;
}

/** The Justiciar's shock wave at the player's tile: still there, they're pulled beside him and bound (Wiki). */
function shockWave(npc, target, state) {
  npc.performAnimation(new core.Animation(npc.getAttackAnim()));
  const aimed = tileOf(target);
  later(SPECIAL_LAND_TICKS, () => {
    if (!stateOf(npc) || !target.isRegistered() || !sameTile(target.getLocation(), aimed)) return;
    const at = npc.getLocation();
    target.moveTo(new core.Location(at.getX() + 1, at.getY() - 1, at.getZ()));
    core.CombatFactory.freezeTicks(target, SHOCK_WAVE_BIND_TICKS, null, npc);
    // A freeze can be refused (still immune after the last one): no bind, no fast sword.
    if (!target.getTimers().has(core.TimerKey.FREEZE)) return;
    state.bound = true;
    later(SHOCK_WAVE_BIND_TICKS, () => { state.bound = false; });
  });
}

const SPECIALS = { shockWave, healer, energyBall };

// ---- Combat ----

function magicAttack(npc, target, state) {
  const spec = state.combat.magic;
  npc.performAnimation(new core.Animation(spec.anim));
  return { style: "MAGIC", spec };
}

function meleeOrMagic(npc, target, state) {
  const adjacent = edgeDistance(npc, target) <= 0;
  if (adjacent && (state.bound || core.Misc.randomInclusive(0, 1) === 0)) {
    npc.performAnimation(new core.Animation(npc.getAttackAnim()));
    return { style: "MELEE", maxHit: state.combat.meleeMaxHit };
  }
  return magicAttack(npc, target, state);
}

/** One attack: a special one time in five while not bound, else melee beside the target or the god spell. */
function chooseAttack(npc, target, state) {
  if (!state.bound && core.Misc.randomInclusive(1, SPECIAL_CHANCE) === 1) {
    const options = ["barrage", state.combat.special];
    if (!core.TeleBlock.isBlocked(target)) options.push("teleBlock");
    const pick = options[core.Misc.randomInclusive(0, options.length - 1)];
    if (pick === "barrage") return iceBarrage(npc, target), null;
    if (pick === "teleBlock") return teleBlock(npc, target, state), null;
    return SPECIALS[pick](npc, target, state);
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
      return stateOf(npc)?.bound ? BOUND_ATTACK_SPEED : ATTACK_SPEED;
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
        target.performGraphic(graphic(landed ? spec.gfx : SPLASH_GRAPHIC, spec.height, 30));
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
 * follower's state to gate its remains, so it's forgotten a tick later. The death
 * task takes the npc out of the world.
 */
function followerDied({ npc }) {
  const state = stateOf(npc);
  if (!state) return;
  release(state);
  later(1, () => active.delete(npc));
}

function ownerLeft({ player }) {
  for (const [npc, state] of [...active]) {
    if (state.player === player) dismiss(npc, state);
  }
}

function isRemains(item) {
  return MageArenaII.followerByRemains(item?.getId?.()) !== null;
}

function refuseBank(event) {
  if (!isRemains(event.item)) return;
  event.allow = false;
  if (!event.quiet) event.player.sendMessage(UNBANKABLE);
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
  api.onCanBankItem(refuseBank);
  api.onShouldKeepItemOnDeath(loseOnDeath);
  api.onCustomEvent("destroy-item:prompt", remainsDestroyPrompt);
};

Object.assign(module.exports, {
  summon,
  _test: {
    COMBAT, LIFETIME_TICKS, active, stateOf, summon, watch, dismiss, followerDied, edgeDistance, chooseAttack, createCombatMethod,
    godSpellOnly, remainsDrop, refuseBank, loseOnDeath, remainsDestroyPrompt, drain, shockWave, teleBlock, meleeOrMagic,
  },
});
