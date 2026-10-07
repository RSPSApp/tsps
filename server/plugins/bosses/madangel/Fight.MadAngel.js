/**
 * The Mad Angel's fight, as captured (docs/wyrmscraig.md) with the Wiki's rules
 * (https://oldschool.runescape.wiki/w/Mad_Angel/Strategies):
 * - "Wake" plays the waking animation; 3 ticks later the angel fights.
 * - Its standard attack is a melee swing every 6 ticks, landing 2 later: up to 31, or 5 through
 *   Protect from Melee. After three of them it uses a special, in turn: the sweep, the blast,
 *   the smite. The sweep and the smite stop its standard attacks; the blast doesn't.
 * - At 350 hitpoints it enrages at its next attack ("...!"), uses all three specials in a row
 *   (smite, blast, sweep), and from then on chains them with no standard attacks between
 *   (only during the blast), the sweeps and blasts faster, the smite striking three times.
 * - Sweep: the sword is drawn to one side; each cleave hits the quarter of the arena between
 *   the way the angel faced at the step before (towards the player) and the sword's side, then
 *   the sword stays or swaps. Out of it, beside the angel rather than behind it, the player's
 *   next hit is sure to land, for at least half their max hit.
 * - Blast: a ball thrown at a tile near the player. Standing on it bounces it back (18-22 to
 *   the angel) and the angel throws again, three throws at most; missing it blows up the whole
 *   arena. Protect from Magic halves it.
 * - Smite: struck 5 ticks in (enraged: 5, 9 and 11). Protect from Magic turned on as it lands
 *   blocks it all and makes the player's next hit a max hit; already on, it takes a quarter.
 */
const Common = require("./Common.MadAngel");

const SLOT_SPECIAL = 2;
const SLOT_BOUNCE = 11;
/** Facing a tile this far out on an axis faces that way (and the step before reads it back). */
const FACE_REACH = 5;
/** Directions as unit steps: the front the angel faces, and its right hand. */
const DIRECTIONS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
const RIGHT_OF = { N: "E", E: "S", S: "W", W: "N" };
const LEFT_OF = { N: "W", E: "N", S: "E", W: "S" };
const NEXT_ATTACK_BUFF_ATTRIBUTE = "mad-angel:next-hit";
const NO_RETALIATE_FLAG = "combat:no-retaliate";

let MeleeStyle = null;

/** The quarter of the arena between `front` and the sword's `side`: its key in the sweep shapes. */
function quarter(front, side) {
  const hand = side === "right" ? RIGHT_OF[front] : LEFT_OF[front];
  const horizontal = [front, hand].find((direction) => direction === "E" || direction === "W");
  const vertical = [front, hand].find((direction) => direction === "N" || direction === "S");
  return horizontal + vertical;
}

/** The way from the angel's centre to a tile, by its larger axis. */
function directionTo(centre, location) {
  const dx = location.getX() - centre[0];
  const dy = location.getY() - centre[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "N" : "S";
}

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

class Fight {
  constructor(session, npc) {
    this.session = session;
    this.npc = npc;
    this.player = session.player;
    this.data = Common.data;
    this.tick = 0;
    this.startTick = -1;
    this.attacks = 0;
    this.rotation = 0;
    this.enraged = false;
    this.enragePending = false;
    this.queue = [];
    this.special = null;
    this.magicPrayerBefore = false;
    this.events = [];
    this.stopped = false;
    this.hudShown = false;
  }

  get core() {
    return Common.core;
  }

  centre() {
    const at = this.npc.getLocation();
    return [at.getX() + 1, at.getY() + 1];
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + ticks, action });
  }

  // ------------------------------------------------------------------ waking and ticking

  wake() {
    const { npcs, wake, music } = this.data;
    const { Animation, Graphic } = this.core;
    this.npc.setNpcTransformationId(npcs.waking);
    this.npc.performAnimation(new Animation(wake.anim));
    this.npc.performGraphicInSlot(SLOT_SPECIAL, new Graphic(wake.spotanim));
    this.npc.faceTile(this.player.getLocation());
    this.player.getPacketSender().sendSong(music.fight);
    this.at(wake.fightAfterTicks, () => this.begin());
  }

  begin() {
    this.npc.setNpcTransformationId(-1);
    this.startTick = this.tick;
    this.showHud();
    this.npc.getCombat().attack(this.player);
  }

  /** Every tick: due events, the enrage threshold, the HUD, and the prayer the smite reads. */
  process() {
    if (this.stopped) return;
    this.tick++;
    // Its specials aren't combat-engine attacks, which would count it out of combat and
    // regenerate it (a tenth of its hitpoints a tick).
    this.npc.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) {
      if (!this.stopped) event.action();
    }
    if (this.startTick >= 0 && !this.enraged && !this.enragePending && this.npc.getHitpoints() <= this.data.specials.enrageAt) {
      this.enragePending = true;
    }
    this.updateHud();
    this.magicPrayerBefore = this.protectingFrom(this.core.PrayerHandler.PROTECT_FROM_MAGIC);
  }

  stop() {
    this.stopped = true;
    this.events = [];
    this.special = null;
  }

  protectingFrom(prayer) {
    return this.core.PrayerHandler.isActivated(this.player, prayer);
  }

  inArena(location) {
    const row = this.data.arena.rows.find(([y]) => y === this.session.worldTile(location)[1]);
    const [x] = this.session.worldTile(location);
    return !!row && x >= row[1] && x <= row[2] && location.getZ() === 0;
  }

  /** A typeless hit on the player now. */
  hitPlayer(damage) {
    const { HitDamage, HitMask } = this.core;
    this.player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  }

  // ------------------------------------------------------------------ the attack slot

  /** The combat engine's turn to attack: a standard swing, a special, the enrage, or nothing. */
  attack(target) {
    if (this.stopped || this.startTick < 0) return [];
    if (this.special?.blocksAttacks) return [];
    if (this.enragePending) {
      this.enragePending = false;
      this.enraged = true;
      this.npc.forceChat(this.data.specials.enrageText);
      this.queue = [...this.data.specials.enragedOrder];
      return [];
    }
    if (!this.special) {
      if (this.queue.length > 0) return this.startSpecial(this.queue.shift());
      if (this.attacks >= (this.enraged ? 0 : this.data.specials.afterAttacks)) {
        const order = this.enraged ? this.data.specials.enragedOrder : this.data.specials.order;
        const kind = order[this.rotation % order.length];
        this.rotation++;
        return this.startSpecial(kind);
      }
    }
    return this.melee(target);
  }

  melee(target) {
    const { Animation, PendingHit, PrayerHandler } = this.core;
    const { melee } = this.data;
    this.attacks++;
    this.npc.performAnimation(new Animation(melee.anim));
    target.getPacketSender?.()?.sendSoundEffect(melee.sound, 1, 0);
    const hit = new PendingHit(this.npc, target, MeleeStyle, melee.hitDelay);
    // Protect from Melee doesn't block it: it lowers the max hit from 31 to 5 (Wiki).
    if (PrayerHandler.isActivated(target, PrayerHandler.PROTECT_FROM_MELEE)) {
      for (const damage of hit.getHits()) damage.setDamage(Math.floor((damage.getDamage() * melee.protectedMaxHit) / melee.maxHit));
      hit.setTotalDamage(hit.getHits().reduce((sum, damage) => sum + damage.getDamage(), 0));
    }
    return [hit];
  }

  startSpecial(kind) {
    this.attacks = 0;
    if (kind === "sweep") this.startSweep();
    else if (kind === "blast") this.startBlast();
    else this.startSmite();
    return [];
  }

  endSpecial() {
    const sweep = this.special?.kind === "sweep" ? this.special : null;
    this.special = null;
    this.npc.getMovementQueue().setBlockMovement(false);
    if (sweep) {
      // Back on the player, its next swing a step after the last cleave (as captured).
      this.npc.setFlag(NO_RETALIATE_FLAG, false);
      this.npc.getCombat().attack(this.player);
      this.npc.getCombat().setAttackDelay(sweep.interval);
    }
  }

  // ------------------------------------------------------------------ sweep

  startSweep() {
    const { Animation } = this.core;
    const sweep = this.data.sweep;
    const anims = this.enraged ? sweep.enragedAnims : sweep.anims;
    const side = Math.random() < 0.5 ? "right" : "left";
    this.npc.getMovementQueue().setBlockMovement(true).reset();
    // Out of combat while it sweeps, hits included: combat would keep it turning to follow the
    // player, and the capture has it facing one way from one step to the next.
    this.npc.getCombat().reset();
    this.npc.setFlag(NO_RETALIATE_FLAG, true);
    const front = this.facePlayer();
    this.npc.performAnimation(new Animation(anims.windup[side]));
    this.special = {
      kind: "sweep", blocksAttacks: true, anims, side, front,
      cleaves: this.enraged ? sweep.enragedCleaves : sweep.cleaves,
      interval: this.enraged ? sweep.enragedCleaveTicks : sweep.cleaveTicks,
    };
    this.at(this.special.interval, () => this.cleave());
  }

  /** Faces the player along an axis; that way is the front for the next cleave. */
  facePlayer() {
    const front = directionTo(this.centre(), this.player.getLocation());
    const [dx, dy] = DIRECTIONS[front];
    const [cx, cy] = this.centre();
    // A face-coordinate turn: it keeps that facing until the next one (setPositionToFace sends
    // nothing to the client for an NPC).
    this.npc.faceTile(new this.core.Location(cx + dx * FACE_REACH, cy + dy * FACE_REACH, this.npc.getLocation().getZ()));
    return front;
  }

  cleave() {
    const special = this.special;
    if (!special || special.kind !== "sweep") return;
    const { Animation, Graphic } = this.core;
    special.cleaves--;
    const last = special.cleaves === 0;
    const nextSide = last || Math.random() < 0.5 ? special.side : (special.side === "right" ? "left" : "right");
    const anim = last ? special.anims.reset[special.side]
      : nextSide === special.side ? special.anims.stay[special.side] : special.anims.swap[special.side];
    this.npc.performAnimation(new Animation(anim));

    const key = quarter(special.front, special.side);
    const [cx, cy] = this.centre();
    const z = this.npc.getLocation().getZ();
    const dust = new Set();
    const sender = this.player.getPacketSender();
    for (const [dx, dy, delay] of this.data.sweep.shapes[key]) {
      dust.add(`${dx},${dy}`);
      sender.sendGraphic(new Graphic(this.data.sweep.dust, delay), new this.core.Location(cx + dx, cy + dy, z));
    }
    const at = this.player.getLocation();
    const offset = `${at.getX() - cx},${at.getY() - cy}`;
    if (dust.has(offset)) {
      const { maxHit, protectedFactor } = this.data.sweep;
      const roll = randomInt(0, maxHit);
      const protectedMelee = this.protectingFrom(this.core.PrayerHandler.PROTECT_FROM_MELEE);
      this.hitPlayer(protectedMelee ? Math.floor(roll * protectedFactor) : roll);
    } else if (this.besideNotBehind(special.front, special.side, at)) {
      this.player.setAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE, "accurate");
    }

    special.front = this.facePlayer();
    special.side = nextSide;
    if (last) this.endSpecial();
    else this.at(special.interval, () => this.cleave());
  }

  /** Out of the cleave on the far side from the sword, level with the angel or ahead of it. */
  besideNotBehind(front, side, location) {
    const [cx, cy] = this.centre();
    const rel = [location.getX() - cx, location.getY() - cy];
    const [fx, fy] = DIRECTIONS[front];
    const [sx, sy] = DIRECTIONS[side === "right" ? RIGHT_OF[front] : LEFT_OF[front]];
    const lateral = rel[0] * sx + rel[1] * sy;
    const forward = rel[0] * fx + rel[1] * fy;
    return lateral < -1 && forward >= -1;
  }

  // ------------------------------------------------------------------ blast

  startBlast() {
    const { Animation, Graphic } = this.core;
    const blast = this.data.blast;
    this.npc.performAnimation(new Animation(blast.anim));
    this.npc.performGraphicInSlot(SLOT_SPECIAL, new Graphic(blast.spotanim));
    this.special = { kind: "blast", blocksAttacks: false, throws: 0 };
    this.throwBall();
  }

  /** A tile in the arena one or two tiles from the player, never the one they stand on. */
  blastTarget() {
    const range = this.data.blast.targetRange;
    const at = this.player.getLocation();
    const options = [];
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tile = at.transform(dx, dy, 0);
        const [x, y] = this.session.worldTile(tile);
        const boss = this.npc.getLocation();
        const underBoss = tile.getX() >= boss.getX() && tile.getX() <= boss.getX() + 2 && tile.getY() >= boss.getY() && tile.getY() <= boss.getY() + 2;
        if (!underBoss && this.inArena(tile) && x != null && y != null) options.push(tile);
      }
    }
    return options[Math.floor(Math.random() * options.length)] ?? at;
  }

  throwBall() {
    const { Graphic, Projectile } = this.core;
    const blast = this.data.blast;
    const special = this.special;
    const target = this.blastTarget();
    const flight = this.enraged ? blast.enragedFlightCycles : blast.flightCycles;
    const [cx, cy] = this.centre();
    const from = new this.core.Location(cx, cy, this.npc.getLocation().getZ());
    new Projectile(from, target, null, blast.projectile, blast.startCycle, flight, blast.heights.high, blast.heights.low, this.session.area).withAngle(40).sendProjectile();
    this.player.getPacketSender().sendGraphic(new Graphic(blast.shadow, blast.startCycle), target);
    special.throws++;
    special.target = target;
    this.at(Math.ceil(flight / 30), () => this.land(target));
  }

  land(target) {
    const special = this.special;
    if (!special || special.kind !== "blast") return;
    const { Graphic, Projectile, HitDamage, HitMask } = this.core;
    const blast = this.data.blast;
    const sender = this.player.getPacketSender();
    if (this.player.getLocation().equals(target)) {
      this.player.performGraphicInSlot(SLOT_BOUNCE, new Graphic(blast.bounceSpotanim, 30));
      const [cx, cy] = this.centre();
      const to = new this.core.Location(cx, cy, target.getZ());
      new Projectile(target, to, null, blast.projectile, 0, 30, blast.heights.low, blast.heights.high, this.session.area).withAngle(17).sendProjectile();
      sender.sendAreaSound(blast.bounceSound, target.getX(), target.getY(), target.getZ(), 1, 0, 10);
      const damage = randomInt(blast.bounceDamage[0], blast.bounceDamage[1]);
      this.at(blast.bounceDamageTicks, () => {
        if (this.npc.getHitpoints() > 0) this.npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
      });
      if (special.throws < blast.throws) this.throwBall();
      else this.endSpecial();
      return;
    }
    // Missed: the ball blows up over the whole floor, outwards from where it fell.
    const [tx, ty] = this.session.worldTile(target);
    for (const [y, minX, maxX] of this.data.arena.rows) {
      for (let x = minX; x <= maxX; x++) {
        const delay = 2 * (Math.abs(x - tx) + Math.abs(y - ty));
        sender.sendGraphic(new Graphic(blast.explosion, delay), this.session.tile([x, y, 0]));
      }
    }
    sender.sendAreaSound(blast.explosionSound, target.getX(), target.getY(), target.getZ(), 1, 0, 10);
    if (this.inArena(this.player.getLocation())) {
      const roll = randomInt(Math.ceil(blast.explosionMaxHit / 2), blast.explosionMaxHit);
      const shielded = this.protectingFrom(this.core.PrayerHandler.PROTECT_FROM_MAGIC);
      this.hitPlayer(shielded ? Math.floor(roll * blast.protectedFactor) : roll);
    }
    this.endSpecial();
  }

  // ------------------------------------------------------------------ smite

  startSmite() {
    const { Animation, Graphic } = this.core;
    const smite = this.data.smite;
    this.npc.getMovementQueue().setBlockMovement(true).reset();
    this.npc.performAnimation(new Animation(this.enraged ? smite.enragedAnim : smite.anim));
    this.npc.performGraphicInSlot(SLOT_SPECIAL, new Graphic(this.enraged ? smite.enragedSpotanim : smite.spotanim));
    const strikes = this.enraged ? smite.enragedStrikeTicks : smite.strikeTicks;
    this.special = { kind: "smite", blocksAttacks: true, left: strikes.length };
    for (const ticks of strikes) {
      this.at(ticks, () => this.player.performGraphic(new Graphic(smite.impact)));
      this.at(ticks + 1, () => this.strike());
    }
  }

  /** The lightning lands: blocked outright by Protect from Magic turned on this tick. */
  strike() {
    const special = this.special;
    if (!special || special.kind !== "smite") return;
    const { maxHit, protectedFactor } = this.data.smite;
    const shielded = this.protectingFrom(this.core.PrayerHandler.PROTECT_FROM_MAGIC);
    if (shielded && !this.magicPrayerBefore) {
      this.hitPlayer(0);
      this.player.setAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE, "max");
    } else {
      const roll = randomInt(Math.ceil(maxHit / 2), maxHit);
      this.hitPlayer(shielded ? Math.floor(roll * protectedFactor) : roll);
    }
    special.left--;
    if (special.left <= 0) this.endSpecial();
  }

  // ------------------------------------------------------------------ the HP HUD (the BossHud plugin)

  hudValues() {
    return { player: this.player, npcId: this.data.npcs.fighting, current: Math.max(0, this.npc.getHitpoints()), maximum: this.npc.getDefinition().getHitpoints() };
  }

  showHud() {
    this.hudShown = true;
    Common.api.emitCustomEvent("boss-hud:show", this.hudValues());
  }

  updateHud() {
    if (this.hudShown) Common.api.emitCustomEvent("boss-hud:update", this.hudValues());
  }

  /** As captured after a kill: faded out, then cleared 4 ticks later. Leaving drops it at once. */
  hideHud(fade = true) {
    if (!this.hudShown) return;
    this.hudShown = false;
    Common.api.emitCustomEvent("boss-hud:hide", fade ? { player: this.player } : { player: this.player, fade: false, afterTicks: 0 });
  }
}

// ------------------------------------------------------------------ hooks

/** The angel's combat: every attack slot is the fight's to fill. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  MeleeStyle ??= new (class extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }
    hits() {
      return [];
    }
  })();
  return class MadAngelCombat extends CombatMethod {
    start() {}

    hits(npc, target) {
      const fight = npc.__madAngel?.fight;
      return fight ? fight.attack(target) : [];
    }

    attackSpeed() {
      return Common.data.melee.speed;
    }

    attackDistance() {
      return 1;
    }

    type() {
      return CombatType.MELEE;
    }
  };
}

/** Its swings roll past Protect from Melee (the fight scales them down instead). */
function angelHitRoll(roll) {
  if (roll.attacker?.__madAngel && roll.combatType === Common.core.CombatType.MELEE) roll.bypassProtectionPrayer = true;
  const buff = roll.attacker?.isPlayer?.() && roll.target?.__madAngel ? roll.attacker.getAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE) : null;
  if (!buff) return;
  roll.forceAccurate = true;
  if (buff === "max") roll.forceMaxHit = true;
}

/** A dodge's reward: the next hit lands for at least half the player's max hit; then it's spent. */
function angelHitModify({ npc, hit }) {
  if (!npc?.__madAngel) return;
  const attacker = hit?.getAttacker?.();
  const buff = attacker?.isPlayer?.() ? attacker.getAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE) : null;
  if (!buff) return;
  attacker.setAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE, null);
  if (buff !== "accurate") return;
  const { DamageFormulas } = Common.core;
  const max = DamageFormulas.sourceMaxHit(attacker, hit.getCombatType());
  const floor = Math.floor(max / 2);
  for (const damage of hit.getHits()) {
    if (damage.getDamage() < floor) damage.setDamage(floor);
  }
  hit.setTotalDamage(hit.getHits().reduce((sum, damage) => sum + damage.getDamage(), 0));
}

function attachFight(api) {
  api.registerNpcCombatMethodProvider(Common.data.npcs.fighting, combatClass());
  api.onCombatHitRoll(angelHitRoll);
  api.onNpcHitModify(angelHitModify);
}

module.exports = { attachFight, Fight, quarter, directionTo, NEXT_ATTACK_BUFF_ATTRIBUTE };
