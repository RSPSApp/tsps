/**
 * The fight in Skotizo's lair, as captured (rsprox recordings 3323, 3329) with the Wiki's rules
 * (https://oldschool.runescape.wiki/w/Skotizo, /w/Awakened_Altar, /w/Reanimated_demon_spawn,
 * /w/Dark_Ankou):
 * - Skotizo attacks every 6 ticks: a stab next to the player (demon_update_attack_lesser, landing
 *   the same tick) or, at any range, a hellfire burst (demon_casting): projectile 1242 from tick
 *   30, the impact graphic on the player as it lands, the hit on the first tick at or after
 *   it (ceil(end / 30) ticks after the cast). He prefers melee in reach (Wiki) and never steps in to use it.
 * - The four altars each wait 50-129 ticks (chosen again each time), then wake if asleep and
 *   off their minute's cooldown. Each awake altar takes 25% off the damage Skotizo takes, up to
 *   100% (15%, up to 60%, with Arclight or Emberlight, which put an altar back to sleep in one
 *   hit). The HUD shows which are awake (script 1313, west/east/south/north).
 * - With two thirds of his hitpoints gone he chants "Gar mulno ful taglo!" and three reanimated
 *   demon spawns rise near the player (smoke and sound 1930 each); he may chant again once all
 *   three are dead.
 * - While an altar is awake a timer may bring one dark ankou.
 */
const Common = require("./Common.Skotizo");

const SIDES = ["w", "e", "s", "n"];
const SLOT_IMPACT = 1;
const INACTIVE = 0;
const ACTIVE = 1;
/** Altars are fixtures: they never hit back or step off their tile. */
const NO_RETALIATE_FLAG = "combat:no-retaliate";

let MeleeStyle = null;
let MagicStyle = null;

function styles() {
  const { CombatMethod, CombatType } = Common.core;
  const style = (type) => new (class extends CombatMethod {
    type() {
      return type;
    }
    hits() {
      return [];
    }
  })();
  MeleeStyle ??= style(CombatType.MELEE);
  MagicStyle ??= style(CombatType.MAGIC);
}

class Fight {
  constructor(session) {
    this.session = session;
    this.player = session.player;
    this.boss = null;
    this.altars = new Map();
    this.minions = new Set();
    this.ankou = null;
    this.ankouTimer = -1;
    this.summoned = false;
    this.tick = 0;
    this.hudOpen = false;
    this.stopped = false;
    this.stats = { damageTaken: 0, startTick: -1 };
    this.task = null;
  }

  get core() {
    return Common.core;
  }

  // ------------------------------------------------------------------ setting up

  setUp() {
    styles();
    this.spawnBoss();
    for (const side of SIDES) this.spawnAltar(side);
    this.startTicking();
  }

  spawnNpc(id, [x, y], extra = {}) {
    const at = this.session.tile([x, y, 0]);
    const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, ...extra });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__skotizoLair = this.session;
    this.session.area.add(npc);
    return npc;
  }

  spawnBoss() {
    const size = Common.core.CacheDefinitions.getNpc(Common.DATA.npcs.boss)?.size ?? 5;
    const tile = this.session.randomTile(size) ?? [Common.DATA.arena.minX + 2, Common.DATA.arena.minY + 2];
    this.boss = this.spawnNpc(Common.DATA.npcs.boss, tile);
    this.boss?.setPositionToFace(this.player.getLocation());
  }

  /** A sleeping altar: the NPC the awake one becomes, and the loc it stands in. */
  spawnAltar(side) {
    const config = Common.DATA.altars[side];
    const npc = this.spawnNpc(config.closed, config.tile);
    npc?.setFlag(NO_RETALIATE_FLAG, true);
    npc?.getMovementQueue().setBlockMovement(true).reset();
    const altar = { side, config, npc, awake: false, timer: Common.randomInt(...Common.DATA.awakenedAltars.timerTicks), cooldownUntil: -1, loc: null };
    this.placeAltarLoc(altar, Common.DATA.locs.altarClosed);
    this.altars.set(side, altar);
  }

  placeAltarLoc(altar, id) {
    const { GameObject, ObjectManager } = this.core;
    if (altar.loc) ObjectManager.deregister(altar.loc, true);
    altar.loc = new GameObject(id, this.session.tile([...altar.config.tile, 0]), 10, altar.config.rotation, this.session.area);
    ObjectManager.register(altar.loc, true);
  }

  startTicking() {
    const { Task, TaskManager } = this.core;
    const fight = this;
    this.task = new (class extends Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        if (fight.stopped || fight.session.ended) {
          this.stop();
          return;
        }
        fight.process();
      }
    })();
    TaskManager.submit(this.task);
  }

  /** The HUD and the fight proper, two ticks after the fade comes back (as captured). */
  openHud() {
    if (this.stopped) return;
    this.player.getPacketSender().sendSubInterface(Common.OVERLAY_HUD_UID, Common.DATA.hud.interface, 1);
    this.hudOpen = true;
    this.sendHud();
    Common.playMusic(this.player);
    if (this.boss && this.boss.getHitpoints() > 0) this.boss.getCombat().attack(this.player);
  }

  sendHud() {
    if (!this.hudOpen) return;
    const flags = SIDES.map((side) => (this.altars.get(side)?.awake ? ACTIVE : INACTIVE));
    this.player.getPacketSender().sendClientScript(Common.DATA.hud.script, ...flags);
  }

  closeHud() {
    if (!this.hudOpen) return;
    this.hudOpen = false;
    if (this.player.isRegistered()) this.player.getPacketSender().closeSubInterface(Common.OVERLAY_HUD_UID);
  }

  // ------------------------------------------------------------------ every tick

  process() {
    this.tick++;
    if (!this.boss || this.boss.getHitpoints() <= 0) return;
    // The engine counts an NPC nobody has hit for a while out of combat and regenerates it a
    // tenth of its hitpoints a tick; Skotizo stays in the fight, on the player, while it lasts.
    const combat = this.boss.getCombat();
    combat.getLastAttack().reset();
    if (this.hudOpen && !combat.getTarget() && this.session.inArena(this.player.getLocation())) combat.attack(this.player);
    this.processAltars();
    this.processAnkou();
    for (const minion of [...this.minions]) {
      if (!minion.isRegistered?.() || minion.getHitpoints() <= 0) this.minions.delete(minion);
    }
  }

  /** Each altar's own timer: when it runs out, an asleep altar off cooldown wakes; it starts again. */
  processAltars() {
    for (const altar of this.altars.values()) {
      if (--altar.timer > 0) continue;
      altar.timer = Common.randomInt(...Common.DATA.awakenedAltars.timerTicks);
      if (!altar.awake && this.tick >= altar.cooldownUntil) this.wake(altar);
    }
  }

  wake(altar) {
    if (!altar.npc) return;
    altar.awake = true;
    altar.npc.setNpcTransformationId(altar.config.open);
    const hitpoints = Common.core.CacheDefinitions.getNpc(altar.config.open)?.hitpoints ?? 100;
    altar.npc.setMaxHitpoints(hitpoints);
    altar.npc.setHitpoints(hitpoints);
    this.placeAltarLoc(altar, Common.DATA.locs.altarOpen);
    this.sendHud();
  }

  /** Back to sleep (hit to nothing, or the fight's over), on its minute's cooldown. */
  sleep(altar) {
    if (!altar.awake || !altar.npc) return;
    altar.awake = false;
    altar.cooldownUntil = this.tick + Common.DATA.awakenedAltars.cooldownTicks;
    altar.npc.getCombat().reset();
    altar.npc.setNpcTransformationId(-1);
    altar.npc.setMaxHitpoints(-1);
    altar.npc.setHitpoints(altar.npc.getMaxHitpoints());
    this.placeAltarLoc(altar, Common.DATA.locs.altarClosed);
    if (this.player.getCombat().getTarget?.() === altar.npc) this.player.getCombat().reset();
    this.sendHud();
  }

  awakeCount() {
    let count = 0;
    for (const altar of this.altars.values()) if (altar.awake) count++;
    return count;
  }

  altarOf(npc) {
    for (const altar of this.altars.values()) if (altar.npc === npc) return altar;
    return null;
  }

  /** The share of a hit on Skotizo the awake altars take away, by the player's weapon. */
  reductionPercent(attacker) {
    const awake = this.awakeCount();
    if (awake === 0) return 0;
    const rules = Common.DATA.awakenedAltars;
    const light = attacker?.isPlayer?.() && rules.lightWeapons.includes(Common.weaponName(attacker.getAsPlayer()));
    return light ? Math.min(rules.lightReductionCap, awake * rules.lightReductionPercent) : Math.min(100, awake * rules.reductionPercent);
  }

  processAnkou() {
    if (this.ankou && (!this.ankou.isRegistered?.() || this.ankou.getHitpoints() <= 0)) this.ankou = null;
    if (this.ankou || this.awakeCount() === 0) {
      this.ankouTimer = -1;
      return;
    }
    if (this.ankouTimer < 0) {
      this.ankouTimer = Common.randomInt(...Common.DATA.ankou.timerTicks);
      return;
    }
    if (--this.ankouTimer > 0) return;
    this.ankouTimer = -1;
    const tile = this.session.randomTile(1);
    if (!tile) return;
    this.ankou = this.spawnNpc(Common.DATA.npcs.ankou, tile);
    this.ankou?.getCombat().attack(this.player);
  }

  // ------------------------------------------------------------------ Skotizo's turn

  /** The combat engine's turn: the chant, a stab in reach, or a hellfire burst. */
  attack(target) {
    if (this.stopped || !target?.isPlayer?.()) return [];
    if (this.wantsToSummon()) {
      this.summon();
      return [];
    }
    const inReach = this.inMeleeReach(target);
    if (inReach && Math.random() < Common.DATA.combat.meleeChance) return this.melee(target);
    return this.magic(target);
  }

  wantsToSummon() {
    const { minions } = Common.DATA;
    if (this.boss.getHitpoints() > minions.summonAtHitpoints || this.minions.size > 0) return false;
    return !this.summoned || Math.random() < minions.resummonChance;
  }

  inMeleeReach(target) {
    const boss = this.boss.getLocation();
    const size = this.boss.getSize?.() ?? 5;
    const at = target.getLocation();
    const dx = at.getX() < boss.getX() ? boss.getX() - at.getX() : Math.max(0, at.getX() - (boss.getX() + size - 1));
    const dy = at.getY() < boss.getY() ? boss.getY() - at.getY() : Math.max(0, at.getY() - (boss.getY() + size - 1));
    return at.getZ() === boss.getZ() && ((dx === 1 && dy === 0) || (dx === 0 && dy === 1));
  }

  melee(target) {
    const { Animation, PendingHit } = this.core;
    const { melee } = Common.DATA.combat;
    this.boss.performAnimation(new Animation(melee.anim));
    target.getPacketSender().sendSoundEffect(melee.sound, 1, melee.soundDelay, 0);
    return [new PendingHit(this.boss, target, MeleeStyle, 0)];
  }

  centre() {
    const at = this.boss.getLocation();
    const half = Math.floor((this.boss.getSize?.() ?? 5) / 2);
    return new this.core.Location(at.getX() + half, at.getY() + half, at.getZ());
  }

  magic(target) {
    const { Animation, Graphic, PendingHit, Projectile } = this.core;
    const { magic } = Common.DATA.combat;
    const from = this.centre();
    const to = target.getLocation();
    const distance = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
    const endCycle = Math.max(magic.minEndCycle, magic.startCycle + distance * magic.cyclesPerTile);
    this.boss.performAnimation(new Animation(magic.anim));
    new Projectile(from, to, target, magic.projectile, magic.startCycle, endCycle, magic.startHeight, magic.endHeight, this.session.area)
      .withAngle(magic.angle).withProgress(magic.slope).sendProjectile();
    target.performGraphicInSlot(SLOT_IMPACT, new Graphic(magic.impact, endCycle));
    const sender = target.getPacketSender();
    sender.sendAreaSound(magic.castSound, from.getX(), from.getY(), from.getZ(), 1, 0, 10);
    sender.sendAreaSound(magic.impactSound, to.getX(), to.getY(), to.getZ(), 1, endCycle, 10);
    // The first tick at or after the burst lands; floor() splatted before it arrived (#1862).
    return [new PendingHit(this.boss, target, MagicStyle, Projectile.ticksToLand(endCycle))];
  }

  /** Three spawns on open tiles near the player, each in a puff of smoke (as captured). */
  summon() {
    const { Graphic } = this.core;
    const { minions } = Common.DATA;
    this.summoned = true;
    this.boss.forceChat(minions.chant);
    const near = this.session.worldTile(this.player.getLocation());
    const sender = this.player.getPacketSender();
    const boss = this.boss.getLocation();
    for (let i = 0; i < minions.count; i++) {
      const tile = this.session.randomTile(1, near, minions.spawnRadius);
      if (!tile) continue;
      const minion = this.spawnNpc(Common.DATA.npcs.minion, tile);
      if (!minion) continue;
      this.minions.add(minion);
      sender.sendGraphic(new Graphic(minions.spawnGraphic), minion.getLocation());
      sender.sendAreaSound(minions.spawnSound, boss.getX(), boss.getY(), boss.getZ(), 1, 0, 5);
      minion.getCombat().attack(this.player);
    }
  }

  // ------------------------------------------------------------------ the end

  /** Skotizo is down: the altars sleep, the HUD goes, his helpers fade a few ticks later. */
  bossDied() {
    for (const altar of this.altars.values()) this.sleep(altar);
    this.sendHud();
    this.closeHud();
    this.stop();
    const leftovers = [...this.minions, this.ankou].filter(Boolean);
    this.minions.clear();
    this.ankou = null;
    Common.later(Common.DATA.minions.despawnTicks, () => {
      for (const npc of leftovers) {
        if (npc.isRegistered?.() && npc.getHitpoints() > 0) Common.api.removeNpc(npc);
      }
    });
  }

  stop() {
    this.stopped = true;
  }
}

// ------------------------------------------------------------------ hooks

/** Skotizo's combat: every attack slot is the fight's to fill. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class SkotizoCombat extends CombatMethod {
    start() {}

    hits(npc, target) {
      const fight = npc.__skotizoLair?.fight;
      return fight ? fight.attack(target) : [];
    }

    attackSpeed() {
      return Common.DATA.combat.speed;
    }

    attackDistance() {
      return Common.DATA.combat.magic.distance;
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

const fightOf = (npc) => npc?.__skotizoLair?.fight ?? null;
const isLightWeapon = (player) => Common.DATA.awakenedAltars.lightWeapons.includes(Common.weaponName(player));

/** Arclight and Emberlight always land on an awake altar. */
function hitRoll(roll) {
  const fight = fightOf(roll.target);
  if (!fight || !roll.attacker?.isPlayer?.()) return;
  const altar = fight.altarOf(roll.target);
  if (altar?.awake && isLightWeapon(roll.attacker.getAsPlayer())) roll.forceAccurate = true;
}

/**
 * The awake altars' share comes off the max hit before the roll: the engine caps a roll at the
 * target's hitpoints, so scaling the capped hit afterwards would leave Skotizo unkillable at low
 * hitpoints. A roll is uniform from 0 to the max, so a scaled max is a scaled hit.
 */
function altarMaxHit(entity, maxHit) {
  const target = entity?.isPlayer?.() ? entity.getCombat?.()?.getTarget?.() : null;
  const fight = fightOf(target);
  if (!fight || target !== fight.boss) return maxHit;
  const percent = fight.reductionPercent(entity);
  return percent > 0 ? Math.floor((maxHit * (100 - percent)) / 100) : maxHit;
}

/** Arclight and Emberlight put an awake altar out in one hit. */
function hitModify({ npc, hit }) {
  const fight = fightOf(npc);
  const attacker = hit?.getAttacker?.();
  if (!fight || !attacker?.isPlayer?.()) return;
  const altar = fight.altarOf(npc);
  if (altar?.awake && isLightWeapon(attacker.getAsPlayer()) && hit.getHits().length > 0) {
    const [first, ...rest] = hit.getHits();
    first.setDamage(npc.getHitpoints());
    for (const damage of rest) damage.setDamage(0);
    hit.setTotalDamage(npc.getHitpoints());
  }
}

/** An altar hit to nothing goes back to sleep rather than dying. */
function altarBeforeDeath(event) {
  const fight = fightOf(event.npc);
  const altar = fight?.altarOf(event.npc);
  if (!altar) return;
  event.preventDeath = true;
  event.npc.setHitpoints(1);
  fight.sleep(altar);
}

function attachFight(api) {
  api.registerNpcCombatMethodProvider(Common.DATA.npcs.boss, combatClass());
  api.onCombatHitRoll(hitRoll);
  api.registerMeleeHitModifier(altarMaxHit);
  api.registerRangedHitModifier(altarMaxHit);
  api.registerMagicHitModifier(altarMaxHit);
  api.onNpcHitModify(hitModify);
  api.onNpcBeforeDeath(altarBeforeDeath);
}

module.exports = { attachFight, Fight, SIDES };
module.exports._test = { altarMaxHit };
