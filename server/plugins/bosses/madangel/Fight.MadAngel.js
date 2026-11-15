/**
 * The Mad Angel's fight, as captured (docs/wyrmscraig.md) with the Wiki's rules
 * (https://oldschool.runescape.wiki/w/Mad_Angel/Strategies):
 * - "Wake" plays the waking animation; 3 ticks later the angel fights, its first swing a tick on.
 * - Its standard attack is a melee swing every 6 ticks, landing 2 later: up to 31, or 5 through
 *   Protect from Melee. After three of them it uses a special, in turn: the sweep, the blast,
 *   the smite. The sweep and the smite stop its standard attacks; the blast doesn't.
 * - At 350 hitpoints it enrages at its next attack ("...!", a 4-tick turn), then chains its
 *   specials (smite, blast, sweep, ...) with standard attacks only during the blast, the sweeps
 *   and blasts faster, the smite striking three times.
 * - Sweep: the sword is drawn to one side; each cleave hits the half of the floor around the
 *   diagonal between the way the angel faced at the step before (towards the player) and the
 *   sword's side, then the sword stays or swaps. Out of it, beside the angel rather than behind
 *   it, the player's next hit is sure to land, for at least half their max hit.
 * - Blast: a ball thrown at a tile near the player. Standing on it bounces it back (18-22 to
 *   the angel) and the angel throws again, three throws at most; missing it blows up the whole
 *   arena. Protect from Magic halves it.
 * - Smite: struck 5 ticks in (enraged: 5, 9 and 11), landing a tick after each. Protect from
 *   Magic turned on in the tick it lands blocks it all and makes the player's next hit a max
 *   hit; already on, it takes a quarter.
 * - Its scripted blows (the cleaves, the explosion, the smites) land in the player's own turn,
 *   so the prayer they read includes that tick's clicks, as on live.
 */
const Common = require("./Common.MadAngel");

const SLOT_SPECIAL = 2;
/** Each bounce's graphic takes the next slot on the angel, from 11 up (as captured: 11 to 15). */
const BOUNCE_SLOTS = [11, 12, 13, 14, 15];
/** Facing a tile this far out on an axis faces that way (and the step before reads it back). */
const FACE_REACH = 5;
/** Directions as unit steps: the front the angel faces, and its right hand. */
const DIRECTIONS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
const RIGHT_OF = { N: "E", E: "S", S: "W", W: "N" };
const LEFT_OF = { N: "W", E: "N", S: "E", W: "S" };
const NEXT_ATTACK_BUFF_ATTRIBUTE = "mad-angel:next-hit";
const NO_RETALIATE_FLAG = "combat:no-retaliate";
const KEEP_FACING_FLAG = "combat:keep-facing";

let MeleeStyle = null;
/** The scripted blows in flight: PendingHit -> its kind, resolved as it lands. */
const blows = new WeakMap();

/** The half of the arena between `front` and the sword's `side`: its key ("ES", "WN", ...). */
function quarter(front, side) {
  const hand = side === "right" ? RIGHT_OF[front] : LEFT_OF[front];
  const horizontal = [front, hand].find((direction) => direction === "E" || direction === "W");
  const vertical = [front, hand].find((direction) => direction === "N" || direction === "S");
  return horizontal + vertical;
}

/**
 * The tiles a cleave covers, with the dust's delay, as captured: every arena tile on the `key`
 * diagonal's side of the line through the angel's centre (its own tiles too), the line itself
 * only at its counter-clockwise end, and the centre. The dust starts on the centre and spreads
 * out a tile every 2 cycles, from 2 under the angel.
 */
function sweepTiles(key, centre, rows) {
  const sx = key[0] === "E" ? 1 : -1;
  const sy = key[1] === "N" ? 1 : -1;
  const tiles = [];
  for (const [y, minX, maxX] of rows) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centre[0];
      const dy = y - centre[1];
      const along = sx * dx + sy * dy;
      const counterClockwise = sx * dy - sy * dx;
      const isCentre = dx === 0 && dy === 0;
      if (!isCentre && along < 0) continue;
      if (!isCentre && along === 0 && counterClockwise <= 0) continue;
      const edge = Math.max(Math.abs(dx) - 1, Math.abs(dy) - 1, 0);
      tiles.push([x, y, isCentre ? 0 : 2 + 2 * edge]);
    }
  }
  return tiles;
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
    this.npcs = session.npcs ?? Common.data.npcs;
    this.tick = 0;
    this.startTick = -1;
    this.attacks = 0;
    this.rotation = 0;
    this.bounces = 0;
    this.enraged = false;
    this.enragePending = false;
    this.special = null;
    this.magicPrayerBefore = false;
    this.events = [];
    this.dying = false;
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

  /**
   * Turns it once to face a tile's centre. The client offsets a face tile by the NPC's size (it
   * reads it as the corner the NPC would stand on), so a 3x3 is sent the tile one down-left.
   */
  faceTowards(tile) {
    const shift = Math.floor(((this.npc.getSize?.() ?? 3) - 1) / 2);
    this.npc.faceTile(new this.core.Location(tile.getX() - shift, tile.getY() - shift, tile.getZ()));
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + ticks, action });
  }

  // ------------------------------------------------------------------ waking and ticking

  wake() {
    const { wake, music } = this.data;
    const { Animation, Graphic } = this.core;
    this.npc.setNpcTransformationId(this.npcs.waking);
    this.npc.performAnimation(new Animation(wake.anim));
    this.npc.performGraphicInSlot(SLOT_SPECIAL, new Graphic(wake.spotanim));
    this.faceTowards(this.player.getLocation());
    this.player.getPacketSender().sendSong(music.fight);
    this.at(wake.fightAfterTicks, () => this.begin());
  }

  begin() {
    this.npc.setNpcTransformationId(this.npcs.fighting);
    const max = this.npc.getMaxHitpoints?.() ?? this.npc.getDefinition().getHitpoints();
    this.npc.setHitpoints(max);
    this.startTick = this.tick;
    this.showHud();
    this.npc.getCombat().attack(this.player);
    // As captured, its first swing comes the tick after it turns.
    this.npc.getCombat().setAttackDelay(this.data.wake.firstAttackTicks);
  }

  /**
   * Every tick: due events, the enrage threshold and the HUD. Once it's dying, what it had
   * started is called off; the fight's clock runs on to the kill (its duration counts the
   * death animation, as captured).
   */
  process() {
    if (this.stopped) return;
    this.tick++;
    if (!this.dying && this.startTick >= 0 && this.npc.getHitpoints() <= 0) this.die();
    if (this.dying) {
      this.updateHud();
      return;
    }
    // Its specials aren't combat-engine attacks, which would count it out of combat and
    // regenerate it (a tenth of its hitpoints a tick).
    this.npc.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) {
      if (!this.stopped && !this.dying) event.action();
    }
    if (this.startTick >= 0 && !this.enraged && !this.enragePending && this.npc.getHitpoints() <= this.data.specials.enrageAt) {
      this.enragePending = true;
    }
    this.updateHud();
  }

  /** Each tick in the player's own turn (the cathedral's area): the prayer the next smite compares. */
  samplePrayer() {
    this.magicPrayerBefore = this.protectingFrom(this.core.PrayerHandler.PROTECT_FROM_MAGIC);
  }

  die() {
    this.dying = true;
    this.events = [];
    this.special = null;
    this.npc.setFlag(KEEP_FACING_FLAG, false);
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
    const [x, y] = this.session.worldTile(location);
    const row = this.data.arena.rows.find(([rowY]) => rowY === y);
    return !!row && x >= row[1] && x <= row[2] && location.getZ() === 0;
  }

  /**
   * A scripted blow on the player, landing in their own turn this tick; `resolveBlow` rolls it.
   * It's queued at 0, not rolled as a swing: a rolled hit would run the player's incoming-damage
   * effects (a Ring of life) on damage the blow never deals.
   */
  blow(kind) {
    const { PendingHit, CombatFactory } = this.core;
    const hit = new PendingHit(this.npc, this.player, meleeStyle(),
      { delay: 0, rollAccuracy: false, experience: false, damage: 0, bypassProtectionPrayer: true });
    // resolveBlow fills this same object at impact; its Elysian/equipment reactions
    // must run on that scripted damage, not on the zero placeholder.
    hit.deferIncomingDamageUntilImpact();
    blows.set(hit, kind);
    CombatFactory.addPendingHit(hit);
  }

  /** A blow lands: its damage against the prayers the player has up now. */
  resolveBlow(hit, kind) {
    const { PROTECT_FROM_MELEE, PROTECT_FROM_MAGIC } = this.core.PrayerHandler;
    let damage;
    if (kind === "sweep") {
      const { maxHit, protectedFactor } = this.data.sweep;
      const roll = randomInt(0, maxHit);
      damage = this.protectingFrom(PROTECT_FROM_MELEE) ? Math.floor(roll * protectedFactor) : roll;
    } else if (kind === "explosion") {
      const { explosionMaxHit, protectedFactor } = this.data.blast;
      const roll = randomInt(Math.ceil(explosionMaxHit / 2), explosionMaxHit);
      damage = this.protectingFrom(PROTECT_FROM_MAGIC) ? Math.floor(roll * protectedFactor) : roll;
    } else {
      const { maxHit, protectedFactor } = this.data.smite;
      const shielded = this.protectingFrom(PROTECT_FROM_MAGIC);
      if (shielded && !this.magicPrayerBefore) {
        damage = 0;
        this.player.setAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE, "max");
      } else {
        const roll = randomInt(Math.ceil(maxHit / 2), maxHit);
        damage = shielded ? Math.floor(roll * protectedFactor) : roll;
      }
    }
    hit.setTotalDamage(damage);
  }

  // ------------------------------------------------------------------ the attack slot

  /** The combat engine's turn to attack: a standard swing, a special, the enrage, or nothing. */
  attack(target) {
    if (this.stopped || this.dying || this.startTick < 0) return [];
    // Back on the player after facing a thrown ball's tile.
    this.npc.setFlag(KEEP_FACING_FLAG, false);
    if (this.special?.blocksAttacks) return [];
    if (this.enragePending) {
      this.enragePending = false;
      this.enraged = true;
      this.rotation = 0;
      this.npc.forceChat(this.data.specials.enrageText);
      this.npc.getCombat().setAttackDelay(this.data.specials.enrageTurnTicks);
      return [];
    }
    if (!this.special && this.attacks >= (this.enraged ? 0 : this.data.specials.afterAttacks)) {
      const order = this.enraged ? this.data.specials.enragedOrder : this.data.specials.order;
      const kind = order[this.rotation % order.length];
      this.rotation++;
      if (kind !== "blast" && this.steppedThisTick()) return this.settle(kind);
      return this.startSpecial(kind);
    }
    return this.melee(target);
  }

  /** Whether the angel took a step this tick (following the player, during a blast). */
  steppedThisTick() {
    const walked = this.npc.getWalkingDirection?.();
    const ran = this.npc.getRunningDirection?.();
    return (walked?.id ?? -1) >= 0 || (ran?.id ?? -1) >= 0;
  }

  /**
   * A sweep or smite never starts on a step, as on live: the client holds a step that arrives
   * with an animation like theirs until the animation ends, and their chains of animations would
   * keep the angel drawn a tile from where it stands (its turns and dust offset with it). It
   * stands still and starts the special once the step has played.
   */
  settle(kind) {
    this.npc.getMovementQueue().setBlockMovement(true).reset();
    const settling = { kind: "settle", blocksAttacks: true };
    this.special = settling;
    this.at(this.data.specials.settleTicks, () => {
      if (this.special !== settling) return;
      this.special = null;
      this.startSpecial(kind);
    });
    return [];
  }

  melee(target) {
    const { Animation, PendingHit, PrayerHandler } = this.core;
    const { melee } = this.data;
    this.attacks++;
    this.npc.performAnimation(new Animation(melee.anim));
    target.getPacketSender?.()?.sendSoundEffect(melee.sound, 1, 0);
    const hit = new PendingHit(this.npc, target, meleeStyle(), melee.hitDelay);
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
    const sweep = this.special?.kind === "sweep";
    this.special = null;
    if (!sweep) {
      this.npc.getMovementQueue().setBlockMovement(false);
      return;
    }
    // As captured, it holds still and keeps its facing for 3 ticks after the last cleave, then
    // turns back to the player, its next swing a swing's length after that cleave (enraged too).
    const { resumeTicks } = this.data.sweep;
    this.at(resumeTicks, () => {
      this.npc.getMovementQueue().setBlockMovement(false);
      this.npc.setFlag(NO_RETALIATE_FLAG, false);
      this.npc.getCombat().attack(this.player);
      this.npc.getCombat().setAttackDelay(this.data.melee.speed - resumeTicks);
    });
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
    this.faceTowards(new this.core.Location(cx + dx * FACE_REACH, cy + dy * FACE_REACH, this.npc.getLocation().getZ()));
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

    // Worked in the cathedral's own tiles, which the arena is written in.
    const [baseX, baseY] = this.session.worldTile(this.npc.getLocation());
    const tiles = sweepTiles(quarter(special.front, special.side), [baseX + 1, baseY + 1], this.data.arena.rows);
    const sender = this.player.getPacketSender();
    for (const [x, y, delay] of tiles) {
      sender.sendGraphic(Graphic.delayed(this.data.sweep.dust, delay), this.session.tile([x, y, 0]));
    }
    // Where the player stood as it swung (the capture's hits all read the tile from before
    // the player's move that tick, which a task sees).
    const at = this.player.getLocation();
    const [px, py] = this.session.worldTile(at);
    if (at.getZ() === 0 && tiles.some(([x, y]) => x === px && y === py)) {
      this.blow("sweep");
    } else if (this.besideNotBehind(special.front, special.side, at)) {
      this.player.setAttribute(NEXT_ATTACK_BUFF_ATTRIBUTE, "accurate");
    }

    // It turns to the player with each cleave but the last, as captured.
    if (last) {
      this.endSpecial();
      return;
    }
    special.front = this.facePlayer();
    special.side = nextSide;
    this.at(special.interval, () => this.cleave());
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
    const target = this.throwBall();
    // As captured, the first throw turns it to the ball's tile until its next turn.
    this.npc.setFlag(KEEP_FACING_FLAG, true);
    this.npc.setMobileInteraction(null);
    this.faceTowards(target);
  }

  /** A tile in the arena one or two tiles from the player, never the one they stand on. */
  blastTarget() {
    const range = this.data.blast.targetRange;
    const at = this.player.getLocation();
    const boss = this.npc.getLocation();
    const options = [];
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (dx === 0 && dy === 0) continue;
        const tile = at.transform(dx, dy, 0);
        const underBoss = tile.getX() >= boss.getX() && tile.getX() <= boss.getX() + 2 && tile.getY() >= boss.getY() && tile.getY() <= boss.getY() + 2;
        if (!underBoss && this.inArena(tile)) options.push(tile);
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
    new Projectile(from, target, null, blast.projectile, blast.startCycle, flight, blast.heights.high, blast.heights.low, this.session.area)
      .withAngle(40).withProgress(0).sendProjectile();
    this.player.getPacketSender().sendGraphic(Graphic.delayed(blast.shadow, blast.startCycle), target);
    special.throws++;
    special.target = target;
    this.at(Math.ceil(flight / 30), () => this.land(target));
    return target;
  }

  land(target) {
    const special = this.special;
    if (!special || special.kind !== "blast") return;
    const { Graphic, Projectile, HitDamage, HitMask } = this.core;
    const blast = this.data.blast;
    const sender = this.player.getPacketSender();
    if (this.player.getLocation().equals(target)) {
      // Back up to the angel, whose graphic plays as it arrives.
      const slot = BOUNCE_SLOTS[this.bounces++ % BOUNCE_SLOTS.length];
      this.npc.performGraphicInSlot(slot, new Graphic(blast.bounceSpotanim, 30));
      const [cx, cy] = this.centre();
      const to = new this.core.Location(cx, cy, target.getZ());
      new Projectile(target, to, null, blast.projectile, 0, 30, blast.heights.low, blast.heights.high, this.session.area)
        .withAngle(17).withProgress(0).sendProjectile();
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
        sender.sendGraphic(Graphic.delayed(blast.explosion, delay), this.session.tile([x, y, 0]));
      }
    }
    sender.sendAreaSound(blast.explosionSound, target.getX(), target.getY(), target.getZ(), 1, 0, 10);
    if (this.inArena(this.player.getLocation())) this.blow("explosion");
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

  /**
   * The lightning lands (its prayer read as it does). The smite holds the angel's turn that
   * falls on its last strike: as captured, its next special comes a turn later.
   */
  strike() {
    const special = this.special;
    if (!special || special.kind !== "smite") return;
    this.blow("smite");
    special.left--;
    if (special.left <= 0) this.at(1, () => this.special === special && this.endSpecial());
  }

  // ------------------------------------------------------------------ the HP HUD (the BossHud plugin)

  hudValues() {
    return { player: this.player, npcId: this.npcs.fighting, current: Math.max(0, this.npc.getHitpoints()), maximum: this.npc.getMaxHitpoints?.() ?? this.npc.getDefinition().getHitpoints() };
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

function meleeStyle() {
  const { CombatMethod, CombatType } = Common.core;
  MeleeStyle ??= new (class extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }
    hits() {
      return [];
    }
  })();
  return MeleeStyle;
}

/** The angel's combat: every attack slot is the fight's to fill. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  meleeStyle();
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

/** One of its scripted blows lands on the player, after their clicks this tick. */
function angelBlowLands({ hit }) {
  const kind = blows.get(hit);
  if (!kind) return;
  blows.delete(hit);
  const fight = hit.getAttacker?.()?.__madAngel?.fight;
  if (fight) fight.resolveBlow(hit, kind);
}

function attachFight(api) {
  for (const id of new Set([Common.data.npcs.fighting, Common.data.questNpcs?.fighting].filter(Number.isInteger))) {
    api.registerNpcCombatMethodProvider(id, combatClass());
  }
  api.onCombatHitRoll(angelHitRoll);
  api.onNpcHitModify(angelHitModify);
  api.onPlayerHitModify(angelBlowLands);
}

module.exports = { attachFight, Fight, quarter, sweepTiles, directionTo, meleeStyle, NEXT_ATTACK_BUFF_ATTRIBUTE };
