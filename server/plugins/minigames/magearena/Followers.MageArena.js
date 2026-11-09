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
 * Not built, for want of any rate, timing or visuals in either source: their melee, Ice Barrage,
 * Tele Block, Porazdir's energy ball and the Justiciar's shock wave, and a despawn timer ("if the
 * followers are not slain quick enough, they will despawn", no time given). A follower goes when it
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

/** Each follower's recorded arrival and god-spell attack. */
const COMBAT = Object.freeze({
  saradomin: {
    spawnAnim: 7964, spawnTicks: 2,
    magic: { anim: 7962, gfx: 1518, height: 128, sound: 1659, splashSound: 1656, maxHit: 26 },
  },
  guthix: {
    spawnAnim: 7844, spawnTicks: 3,
    summon: { projectile: 1512, start: 30, base: 46, perTile: 10, startHeight: 100, endHeight: 20 },
    heal: { projectile: 1513, start: 0, end: 106, angle: 20, startHeight: 10, endHeight: 220 },
    magic: { anim: 7849, gfx: 1511, height: 96, sound: 1653, splashSound: 227, maxHit: 43, drain: "DEFENCE", message: "You feel weakened." },
  },
  zamorak: {
    spawnAnim: null, spawnTicks: 0,
    magic: { anim: 7841, gfx: 78, height: 0, sound: 1655, splashSound: 227, maxHit: 43, drain: "MAGIC", message: "You feel your magical powers weaken." },
  },
});

let api;
let core;
/** npc -> { player, follower, combat, attacks, healers } */
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
  active.set(npc, { player, follower, combat, attacks: 0, healers: new Set() });
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

/** Its energy balls go with it. */
function release(state) {
  for (const healer of state.healers) {
    if (healer.isRegistered()) api.removeNpc(healer);
  }
  state.healers.clear();
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

/** This attack: Derwen's summon on its turn, otherwise the god spell. */
function chooseAttack(npc, target, state) {
  state.attacks++;
  if (state.combat.summon && state.attacks >= SUMMON_FIRST && (state.attacks - SUMMON_FIRST) % SUMMON_EVERY === 0) {
    summonHealer(npc, target, state);
    return null;
  }
  const spec = state.combat.magic;
  npc.performAnimation(new core.Animation(spec.anim));
  return { spec };
}

function createCombatMethod() {
  const { CombatMethod, CombatType, CombatFactory, PendingHit } = core;
  return class FollowerCombat extends CombatMethod {
    constructor() {
      super();
      this.attack = null;
    }

    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed() {
      return ATTACK_SPEED;
    }

    start(npc, target) {
      const state = stateOf(npc);
      this.attack = state ? chooseAttack(npc, target, state) : null;
    }

    hits(npc, target) {
      const spec = this.attack?.spec;
      if (!spec) return [];
      const hit = new PendingHit(npc, target, this, 1);
      CombatFactory.applyStyleDamage(hit, spec.maxHit);
      const landed = hit.isAccurate();
      target.performGraphic(landed ? graphic(spec.gfx, spec.height, 30) : graphic(SPLASH_GRAPHIC, SPLASH_HEIGHT, 30));
      sound(target, landed ? spec.sound : spec.splashSound, 30);
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
    godSpellOnly, remainsDrop, refuseBank, loseOnDeath, remainsDestroyPrompt, drain,
  },
});
