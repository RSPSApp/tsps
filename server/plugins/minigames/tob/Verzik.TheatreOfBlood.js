"use strict";

/**
 * Wave 6: Verzik Vitur, in three phases.
 *
 * Wiki (Verzik Vitur; "Theatre of Blood/Strategies", Verzik Vitur):
 * - The leader talks to her to start. Phase 1 (2000 hitpoints, every 14 ticks): only the
 *   Dawnbringer's special attack hurts her properly - other hits are capped at 10 (melee) and 3
 *   (ranged, magic). Her blast hits anyone not behind a pillar for up to 137 (half through
 *   Protect from Magic); otherwise it hits the pillar, which collapses after several blasts for
 *   up to 70 on anyone beside it.
 * - Phase 2 (3500, every 4 ticks): she flies to the middle, bringing every pillar down. She
 *   body-slams anyone under her (a stun, up to 50); throws urns at everyone's tiles (up to 44,
 *   halved by Protect from Missiles); chains a lightning ball through the team in a random order
 *   (small hits, then 48+ on the last; she takes 15-20 if she's in the way); and calls nylocas:
 *   one per player, which chase and explode for up to 63 and can only be hurt by their own
 *   style, plus a purple ball that hits its tile for up to 78 and becomes a Nylocas Athanatos,
 *   healing her until a poisoned weapon makes it poison her instead. Below 35% she adds blood
 *   spells that heal her, and calls two Nylocas Matomenos now and then; for the first three
 *   seconds hits on her heal her, and she absorbs the ones left over at the next call.
 * - Phase 3 (3500, every 7 ticks): she walks. Her melee hits everyone beside her target for up
 *   to 63; her ranged and magic up to 33 (half through prayer). After every four attacks a
 *   special, in turn: nylocas, webs, safe spots, a green ball. Below 20% she attacks every 5
 *   ticks and sends a purple tornado after each player: half their hitpoints (at least 5),
 *   healing her for three times that.
 * Cache: her forms (8369-8375), varp 1748 giving her Talk-to (14795), the pillars (object 32687,
 * NPC 8379 with 185 hitpoints; 8377/8378 collapsing), the web (8376 with object 32734), the
 * nylocas (8381-8383), Athanatos (8384), Matomenos (8385), the tornado (8386), the skeleton
 * holding the Dawnbringer (32741, searched 32742) in Xarpus' room.
 * RuneLite (gameval): her animations (8109 phase 1 blast, 8111 off the throne, 8112-8118 phase
 * 2, 8119-8128 phase 3, 8052/8104 the pillars) and graphics (1580-1602).
 * Captured: her attack and phase-change timing, the projectiles' timing and arcs, phase 2's
 * sounds, her lines ("You think you can defeat me?", "Behold my true nature!", "I'm not
 * finished with you just yet!"). Estimates: her tiles, the pillars', the blast on a pillar
 * (40-60), the phase 2 attack
 * order (urns, every fifth a lightning ball, nylocas every fifth ball), where nylocas appear,
 * their 25-tick fuse and falloff (63/26/8), Athanatos' 50-tick life and heals (9-11 every 4
 * ticks, 70-75 poison), the blood spell's max (29), the Matomenos' tiles, the phase 3 web spin
 * (35 ticks; webs explode after 12 ticks for up to 40), the safe spots' 80 damage, the green
 * ball's bounces, the lines she says.
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");

const NPC = {
  WAITING: 8369, PHASE1: 8370,
  /** Her Talk-to form (verzik_initial_base, through varp 1748): who speaks in her dialogue. */
  SPEAKER: 14795, TO_PHASE2: 8371, PHASE2: 8372, TO_PHASE3: 8373, PHASE3: 8374, DEAD: 8375,
  WEB: 8376, PILLAR: 8379, COLLAPSING: 8377, FADING: 8378,
  NYLOS: { melee: 8381, ranged: 8382, magic: 8383 }, ATHANATOS: 8384, MATOMENOS: 8385, TORNADO: 8386,
};
const OBJECT = { PILLAR: 32687, WEB: 32734, SKELETON: 32741, SKELETON_SEARCHED: 32742 };
const { DAWNBRINGER } = Shared.ITEM;

const ANIMATION = {
  P1_BLAST: 8109, OFF_THRONE: 8111, P2_SPAWN: 8112, P2_ATTACK: 8114, P2_BOUNCE: 8116, P2_HEAL: 8117,
  P2_DEATH: 8118, P3_SPAWN: 8119, P3_MELEE: 8123, P3_MAGIC: 8124, P3_RANGED: 8125, P3_DOTS: 8126,
  P3_WEBS: 8127, P3_DEATH: 8128, PILLAR_COLLAPSE: 8052, PILLAR_FADE: 8104, KNOCKBACK: 8043,
};
const GRAPHIC = {
  BLAST: 1580, BLAST_PLAYER: 1581, BLAST_PILLAR: 1582, URN: 1583, URN_LAND: 1584, LIGHTNING: 1585,
  PURPLE: 1586, ATHANATOS_HEAL: 1587, ATHANATOS_POISON: 1588, ATHANATOS_POISONED: 1590,
  BLOOD: 1591, BLOOD_LAND: 1592, P3_RANGED: 1593, P3_MAGIC: 1594, DOT: 1595, DOT_BLAST: 1596,
  DOT_SAFE: 1597, GREEN_BALL: 1598, BLAST_HIT: 1600, WEB: 1601, TORNADO_HIT: 1602, STUN: 80,
};
/**
 * As captured: launch cycle, flight per tile, arc (angle), start offset (progress) and heights.
 * Her phase 2 projectiles land on whole ticks; their per-tile rates are fitted to that.
 */
const PROJECTILE = {
  BLAST: { delay: 20, duration: 0, perTile: 15, startHeight: 100, endHeight: 25, angle: 20, progress: 0 },
  BLAST_PILLAR: { delay: 20, duration: 0, perTile: 15, startHeight: 100, endHeight: 37, angle: 20, progress: 0 },
  URN: { delay: 21, duration: -3, perTile: 18, minDuration: 39, startHeight: 70, endHeight: 0, angle: 12, progress: 128 },
  LIGHTNING: { delay: 21, duration: -3, perTile: 18, minDuration: 39, startHeight: 70, endHeight: 24, angle: 12, progress: 128 },
  /** Lightning passed on from one player to the next. */
  LIGHTNING_BOUNCE: { delay: 0, duration: -6, perTile: 18, minDuration: 30, startHeight: 24, endHeight: 24, angle: 32, progress: 0 },
  BLOOD: { delay: 21, duration: -3, perTile: 18, minDuration: 39, startHeight: 70, endHeight: 24, angle: 8, progress: 128 },
  PURPLE: { delay: 21, duration: -60, perTile: 60, minDuration: 159, startHeight: 70, endHeight: 1, angle: 0, progress: 64 },
  P3_RANGED: { delay: 62, duration: 0, perTile: 15, maxDuration: 117, startHeight: 100, endHeight: 25, angle: 20, progress: 100 },
  P3_MAGIC: { delay: 53, duration: 0, perTile: 15, maxDuration: 126, startHeight: 100, endHeight: 25, angle: 20, progress: 100 },
  WEB: { duration: 0, perTile: 15, startHeight: 87, endHeight: 0, angle: 15, progress: 0 },
  DOT_BLAST: { delay: 261, duration: 144, perTile: 0, startHeight: 250, endHeight: 30, angle: 50, progress: 0 },
  GREEN_BALL: { delay: 62, duration: 180, perTile: 0, startHeight: 100, endHeight: 30, angle: 20, progress: 100 },
};
/** The Athanatos' globules leave 0-5 cycles in and all land 22 cycles in. */
const GLOBULE = { lands: 22, maxDelay: 5, startHeight: 5, endHeight: 70, angle: 2, progress: 0 };
/** Webs leave up to 10 cycles apart. */
const WEB_MAX_DELAY = 10;
/** As captured, per animation: [sound, delay in client cycles]. */
const ANIMATION_SOUNDS = {
  [ANIMATION.P2_ATTACK]: [[1514, 0]],
  [ANIMATION.P2_BOUNCE]: [[1514, 0], [1021, 0], [3201, 30]],
  [ANIMATION.P2_HEAL]: [[684, 0]],
};

const BASE = { x: 3136, y: 4288 };
const at = (x, y) => ({ x: BASE.x + x, y: BASE.y + y, z: 0 });
const THRONE = at(30, 35);
const PHASE2_TILE = at(31, 25);
const PHASE3_TILE = at(29, 23);
const WEB_CENTRE = at(29, 22);
const PILLARS = [at(25, 18), at(37, 18), at(25, 24), at(37, 24), at(25, 30), at(37, 30)];
const MATOMENOS_TILES = [at(38, 24), at(26, 24)];
const ARENA = { minX: 3155, maxX: 3181, minY: 4303, maxY: 4322 };
const ARRIVAL_STEPS = 5;

const P1 = { every: 14, first: 19, max: 137, prayer: 0.5, pillar: [40, 60], capMelee: 10, capOther: 3, collapse: 70 };
const P2 = {
  every: 4, healBelow: 0.35, bounceMax: 50, stun: 7, urnMax: 44, urnPrayer: 0.5, lightning: [4, 8],
  lightningLast: [45, 48], lightningVerzik: [15, 20], purpleMax: 78, bloodMax: 29, shieldTicks: 5,
  matomenosEvery: 7,
};
const P3 = { every: 7, enraged: 5, enrageBelow: 0.2, melee: 63, ranged: 33, magic: 33, prayer: 0.5, specialEvery: 4 };
const NYLO = { fuse: 25, falloff: [63, 26, 8] };
const ATHANATOS = { life: 50, every: 4, heal: [9, 11], poison: [70, 75] };
const WEBS = { spin: 35, life: 12, max: 40, freeze: 20 };
const DOTS = { ticks: 13, damage: 80 };
const GREEN = { bounces: 3, bounceMax: 15, near: 2, share: 0.74 };
const TORNADO = { min: 5, heal: 3, respawn: 15 };
const SPECIALS = ["nylocas", "webs", "dots", "green"];

const key = (tile) => `${tile.x},${tile.y}`;
const STYLE_OF_NYLO = { [NPC.NYLOS.melee]: "melee", [NPC.NYLOS.ranged]: "ranged", [NPC.NYLOS.magic]: "magic" };

class VerzikRoom extends Raid.Room {
  onBuild() {
    this.verzik = this.spawn(NPC.WAITING, THRONE, { scripted: true, face: Shared.facing("SOUTH") });
    this.verzik?.getMovementQueue().setBlockMovement(true);
    this.phase = 0;
    this.pillars = [];
    for (const tile of PILLARS) {
      const object = this.placeObject(OBJECT.PILLAR, tile, 10, 0);
      const npc = this.spawn(NPC.PILLAR, tile, { scale: false, scripted: true });
      if (npc) this.pillars.push({ npc, object, tile });
    }
    this.minions = new Set();
    this.webs = new Map();
  }

  /** Each arrival walks five steps into the room (estimate). */
  onArrive(player) {
    const member = this.raid.member(player);
    player.sendMessage("Welcome to the final fight.");
    const from = Shared.tileOf(player);
    player.getMovementQueue().reset();
    player.getMovementQueue().addSteps(Shared.loc({ ...from, y: from.y + ARRIVAL_STEPS }));
    if (this.isStarted()) this.joinFight(member);
  }

  joinFight(member) {
    member.inFight = true;
    member.roomStats(this.key).fought = true;
  }

  /** Talk-to, by the leader: the fight starts for everyone in the room. */
  talk(player) {
    if (this.isStarted() || this.isCompleted()) return;
    const raid = this.raid;
    if (!raid.party.isLeader(player)) {
      Shared.npcSay(player, NPC.SPEAKER, `Your leader ${Shared.displayName(raid.party.leader)} must speak to me, not you!`);
      return;
    }
    const { DialogueChainBuilder, NpcDialogue, EndDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new NpcDialogue(0, NPC.SPEAKER, "Now that was quite the show! I haven't been that entertained in a long time."),
      new NpcDialogue(1, NPC.SPEAKER, "Of course, you know I can't let you leave here alive. Time for your final performance..."),
      new EndDialogue(2),
    ));
    Shared.later(player, 1, () => this.confirmStart(player));
  }

  confirmStart(player) {
    const ready = () => {
      if (this.isStarted()) return;
      Shared.npcSay(player, NPC.SPEAKER, "Oh I'm going to enjoy this...");
      this.start();
    };
    const waitForDialogue = () => {
      if (player.getDialogueManager().isActive()) {
        Shared.later(player, 1, waitForDialogue);
        return;
      }
      Shared.options(player, "Is your party ready to fight?", "Yes, let's begin.", ready, "No, don't start yet.", () => {});
    };
    waitForDialogue();
  }

  onStart() {
    for (const player of this.roomPlayers()) this.joinFight(this.raid.member(player));
    this.verzik.setNpcTransformationId(NPC.PHASE1);
    this.phase = 1;
    this.ticks = 0;
    this.raid.refreshHealthBars();
  }

  healthBar() {
    const npc = this.verzik;
    if (!npc || this.phase === 0 || this.transition) return null;
    const kind = this.phase === 1 ? Shared.HEALTH_BAR.CYAN : Shared.HEALTH_BAR.REGULAR;
    return { kind, current: Math.max(0, npc.getHitpoints()), maximum: npc.getMaxHitpoints() };
  }

  tick() {
    if (!this.isStarted() || !this.verzik) return;
    this.ticks++;
    this.tickPillars();
    this.tickMinions();
    this.tickWebs();
    if (this.transition) return;
    if (this.verzik.getHitpoints() <= 0) {
      this.endPhase();
      return;
    }
    if (this.phase === 1) this.tickPhase1();
    else if (this.phase === 2) this.tickPhase2();
    else if (this.phase === 3) this.tickPhase3();
  }

  /** Her hitpoints running out ends a phase (the third ends the fight); pillars fall here. */
  holdsOn(npc) {
    return (npc === this.verzik && this.isStarted()) || this.pillars.some((pillar) => pillar.npc === npc);
  }

  endPhase() {
    if (this.phase === 1) this.toPhase2();
    else if (this.phase === 2) this.toPhase3();
    else if (this.phase === 3) this.die();
  }

  onComplete() {
    for (const minion of [...this.minions]) this.despawn(minion);
    this.minions.clear();
    for (const web of [...this.webs.values()]) this.removeWeb(web);
    const exit = this.def.exit;
    if (exit) this.placeObject(exit.id, exit, exit.type, exit.face);
    const { countCompletion } = require("./Rewards.TheatreOfBlood");
    for (const player of this.raid.players) countCompletion(player);
  }

  // -------------------------------------------------------------- phase 1

  tickPhase1() {
    if (this.ticks !== P1.first && (this.ticks < P1.first || (this.ticks - P1.first) % P1.every !== 0)) return;
    const { Animation } = Shared.core();
    const npc = this.verzik;
    npc.performAnimation(new Animation(ANIMATION.P1_BLAST));
    const hitPillars = new Map();
    this.later(2, () => {
      for (const player of this.fighters()) {
        const pillar = this.pillarCovering(player);
        if (pillar) {
          hitPillars.set(pillar, (hitPillars.get(pillar) ?? 0) + 1);
          continue;
        }
        const ticks = Shared.projectile(this.area, npc, player, GRAPHIC.BLAST, PROJECTILE.BLAST);
        this.later(ticks, () => {
          if (this.phase !== 1 || !this.fighters().includes(player)) return;
          player.performGraphic(Shared.gfx(GRAPHIC.BLAST_PLAYER));
          const damage = Shared.random(0, P1.max);
          Shared.damage(player, Shared.isProtected(player, "magic") ? Math.floor(damage * P1.prayer) : damage);
        });
      }
      // The pillar sheltering the fewest gets the blast (estimate).
      const pillar = [...hitPillars.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (!pillar) return;
      const ticks = Shared.projectile(this.area, npc, pillar.npc, GRAPHIC.BLAST, PROJECTILE.BLAST_PILLAR);
      this.later(ticks, () => {
        if (!this.pillars.includes(pillar)) return;
        pillar.npc.performGraphic(Shared.gfx(GRAPHIC.BLAST_PILLAR));
        pillar.npc.setHitpoints(Math.max(0, pillar.npc.getHitpoints() - Shared.random(...P1.pillar)));
      });
    });
  }

  /** Behind a pillar: it stands between Verzik and the player. */
  pillarCovering(player) {
    const tile = Shared.tileOf(player);
    if (Shared.lineOfSight(this.verzik, player, this.area)) return null;
    let best = null;
    for (const pillar of this.pillars) {
      const distance = Shared.distanceTo(pillar.npc, tile);
      if (distance <= 4 && (!best || distance < best.distance)) best = { pillar, distance };
    }
    return best?.pillar ?? null;
  }

  tickPillars() {
    for (const pillar of [...this.pillars]) {
      if (pillar.npc.getHitpoints() > 0 && pillar.npc.isRegistered()) continue;
      this.collapse(pillar);
    }
  }

  /** It comes down on anyone beside it. */
  collapse(pillar) {
    this.pillars = this.pillars.filter((entry) => entry !== pillar);
    const { Animation, ObjectManager } = Shared.core();
    ObjectManager.deregister(pillar.object, true);
    this.despawn(pillar.npc);
    const rubble = this.spawn(NPC.COLLAPSING, { x: pillar.tile.x - 1, y: pillar.tile.y - 1, z: 0 }, { scale: false, scripted: true });
    rubble?.performAnimation(new Animation(ANIMATION.PILLAR_COLLAPSE));
    this.later(1, () => {
      for (const player of this.fighters()) {
        if (rubble && Shared.distanceTo(rubble, player.getLocation()) > 1) continue;
        Shared.damage(player, Shared.random(Math.floor(P1.collapse / 2), P1.collapse));
        player.sendMessage("The collapsing pillar greatly harms you.");
      }
      this.later(1, () => {
        rubble?.setNpcTransformationId(NPC.FADING);
        rubble?.performAnimation(new Animation(ANIMATION.PILLAR_FADE));
        this.later(2, () => this.despawn(rubble));
      });
    });
  }

  /** Phase 1's caps: only the Dawnbringer's special hurts her properly. */
  modifyHit(npc, hit) {
    if (npc === this.verzik) {
      this.modifyVerzikHit(hit);
      return;
    }
    if (npc.__verzikNylo) {
      this.onlyStyle(npc, hit, npc.__verzikNylo.style);
      return;
    }
    if (npc.getId() === NPC.ATHANATOS) this.hitAthanatos(npc, hit);
  }

  modifyVerzikHit(hit) {
    const parts = hit.getHits?.() ?? [];
    if (this.phase === 1) {
      const dawnbringer = hit.getCombatMethod?.()?.constructor?.name === "DawnbringerCombatMethod";
      if (!dawnbringer) {
        const cap = styleOf(hit) === "melee" ? P1.capMelee : P1.capOther;
        for (const part of parts) part.setDamage(Math.min(cap, part.getDamage()));
      }
    } else if (this.phase === 2 && this.shieldUntil && Shared.cycle() < this.shieldUntil) {
      // Just after calling Matomenos, hits heal her instead.
      const damage = parts.reduce((sum, part) => sum + part.getDamage(), 0);
      for (const part of parts) part.setDamage(0);
      Shared.heal(this.verzik, damage);
    }
    hit.updateTotalDamage?.();
  }

  // -------------------------------------------------------------- phase 2

  toPhase2() {
    const { Animation } = Shared.core();
    const npc = this.verzik;
    this.transition = true;
    this.phase = 2;
    npc.performAnimation(new Animation(ANIMATION.OFF_THRONE));
    this.raid.refreshHealthBars();
    for (const player of this.roomPlayers()) this.takeDawnbringer(player);
    this.later(3, () => {
      npc.setNpcTransformationId(NPC.TO_PHASE2);
      npc.performAnimation(new Animation(ANIMATION.P2_SPAWN));
      npc.setHitpoints(npc.getMaxHitpoints());
      for (const pillar of [...this.pillars]) this.collapse(pillar);
      npc.forceChat("You think you can defeat me?");
      this.later(1, () => Shared.walkStraight(npc, { x: PHASE2_TILE.x - 1, y: PHASE2_TILE.y - 1, z: 0 }));
      this.later(14, () => {
        npc.getMovementQueue().reset();
        npc.moveTo(Shared.loc(PHASE2_TILE));
        npc.setNpcTransformationId(NPC.PHASE2);
        npc.setHitpoints(npc.getMaxHitpoints());
        npc.setPositionToFace(Shared.loc({ ...PHASE2_TILE, y: PHASE2_TILE.y - 5 }));
        this.ticks = 0;
        this.attackCounter = -1;
        this.lightnings = 0;
        this.healing = false;
        this.matomenos = [];
        this.transition = false;
        this.raid.refreshHealthBars();
      });
    });
  }

  /** The Dawnbringer falls apart once her shield is gone (our wording). */
  takeDawnbringer(player) {
    if (Shared.removeDawnbringer(player)) player.sendMessage("The weapon falls apart in your hand as Verzik's shield is destroyed.");
  }

  tickPhase2() {
    if (this.ticks % P2.every !== 0) return;
    const npc = this.verzik;
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    if (!this.healing && npc.getHitpoints() / npc.getMaxHitpoints() <= P2.healBelow) {
      this.healing = true;
      this.attackCounter = 0;
      this.callMatomenos();
      return;
    }
    const under = fighters.filter((player) => this.underVerzik(player));
    if (under.length) {
      this.bounce(under);
      return;
    }
    if (!this.healing) {
      if (this.attackCounter === 4) {
        this.attackCounter = 0;
        this.lightnings++;
        this.lightning();
      } else if (this.attackCounter === -1 || this.lightnings === 5) {
        this.lightnings = 0;
        this.attackCounter = 0;
        this.animate(ANIMATION.P2_ATTACK);
        this.purpleBall();
        this.callNylocas();
      } else {
        this.attackCounter++;
        this.urns();
      }
      return;
    }
    if (this.attackCounter > 0 && this.attackCounter % P2.matomenosEvery === 0) {
      this.callMatomenos();
    } else {
      const roll = Math.random();
      if (roll >= 0.25) this.bloodSpell();
      else if (roll >= 0.15) this.lightning();
      else this.urns();
    }
    this.attackCounter++;
  }

  underVerzik(player) {
    return Shared.distanceTo(this.verzik, player.getLocation()) <= 1;
  }

  animate(id) {
    const { Animation } = Shared.core();
    this.verzik.performAnimation(new Animation(id));
    for (const [sound, delay] of ANIMATION_SOUNDS[id] ?? []) Shared.areaSound(this.area, this.verzik, sound, delay);
  }

  /** A body slam: stunned, hurt and thrown back two tiles. */
  bounce(players) {
    if (Math.random() < 0.25) this.verzik.forceChat("There's nothing under there for you!");
    this.animate(ANIMATION.P2_BOUNCE);
    const { TimerKey, Animation } = Shared.core();
    const centre = this.centre();
    for (const player of players) {
      player.getMovementQueue().reset();
      player.getTimers().registers(TimerKey.STUN, P2.stun);
      this.later(1, () => {
        player.performGraphic(Shared.gfx(GRAPHIC.STUN, { height: 96 }));
        Shared.damage(player, Shared.random(0, P2.bounceMax));
        const from = Shared.tileOf(player);
        const dx = Math.sign(from.x - centre.x);
        const dy = Math.sign(from.y - centre.y) || (dx === 0 ? -1 : 0);
        const to = { x: from.x + dx * 2, y: from.y + dy * 2, z: 0 };
        player.performAnimation(new Animation(ANIMATION.KNOCKBACK));
        if (Shared.floorFree(this.area, to)) this.later(1, () => player.moveTo(Shared.loc(to)));
      });
    }
  }

  /** Urns at everyone's tiles; whoever's still there is hit. */
  urns() {
    this.animate(ANIMATION.P2_ATTACK);
    for (const player of this.fighters()) {
      const tile = Shared.tileOf(player);
      const ticks = Shared.projectile(this.area, this.verzik, tile, GRAPHIC.URN, PROJECTILE.URN);
      this.later(ticks, () => {
        Shared.graphicAt(this.area, GRAPHIC.URN_LAND, tile);
        if (!this.fighters().includes(player) || key(Shared.tileOf(player)) !== key(tile)) return;
        const damage = Shared.random(0, P2.urnMax);
        Shared.damage(player, Shared.isProtected(player, "ranged") ? Math.floor(damage * P2.urnPrayer) : damage);
      });
    }
  }

  /** A lightning ball through the team in a random order; Verzik takes it if she's in the way. */
  lightning() {
    const order = Shared.shuffle(this.fighters());
    if (order.length === 0) return;
    this.animate(ANIMATION.P2_ATTACK);
    this.sendLightning(this.verzik, order[0], 1, order);
  }

  sendLightning(from, to, index, order) {
    const ticks = Shared.projectile(this.area, from, to, GRAPHIC.LIGHTNING, from === this.verzik ? PROJECTILE.LIGHTNING : PROJECTILE.LIGHTNING_BOUNCE);
    this.later(ticks, () => {
      if (this.phase !== 2 || this.transition) return;
      if (to === this.verzik) {
        Shared.damage(this.verzik, Shared.random(...P2.lightningVerzik));
        return;
      }
      if (!this.fighters().includes(to)) return;
      if (index >= order.length) {
        Shared.damage(to, Shared.random(...P2.lightningLast));
        return;
      }
      Shared.damage(to, Shared.random(...P2.lightning));
      const next = order[index];
      if (this.verzikBetween(Shared.tileOf(to), Shared.tileOf(next))) this.sendLightning(to, this.verzik, index + 1, order);
      else this.sendLightning(to, next, index + 1, order);
    });
  }

  verzikBetween(a, b) {
    let { x, y } = a;
    const dx = Math.abs(b.x - x);
    const dy = Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let err = dx - dy;
    for (let steps = 0; steps < 64; steps++) {
      if (Shared.covers(this.verzik, { x, y })) return true;
      if (x === b.x && y === b.y) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return false;
  }

  /** A slow purple ball: up to 78 on its tile, then a Nylocas Athanatos. */
  purpleBall() {
    const target = Shared.randomOf(this.fighters());
    if (!target) return;
    const tile = Shared.tileOf(target);
    const ticks = Shared.projectile(this.area, this.verzik, tile, GRAPHIC.PURPLE, PROJECTILE.PURPLE);
    this.later(ticks, () => {
      if (this.phase !== 2 || this.transition) return;
      if (this.fighters().includes(target) && key(Shared.tileOf(target)) === key(tile)) Shared.damage(target, Shared.random(0, P2.purpleMax));
      const athanatos = this.spawn(NPC.ATHANATOS, { x: tile.x - 1, y: tile.y - 1, z: 0 }, { scripted: true });
      if (!athanatos) return;
      athanatos.__athanatos = { age: 0, poisoned: false };
      this.minions.add(athanatos);
    });
  }

  /** Only a poisoned weapon hurts it, and then it poisons her instead. */
  hitAthanatos(npc, hit) {
    const attacker = hit.getAttacker?.();
    if (!attacker?.isPlayer?.()) return;
    if (poisonedWeapon(attacker, styleOf(hit))) {
      if (!npc.__athanatos.poisoned) {
        npc.__athanatos.poisoned = true;
        npc.performGraphic(Shared.gfx(GRAPHIC.ATHANATOS_POISONED));
      }
      return;
    }
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
    attacker.sendMessage("You can only damage the Nylocas Athanatos with poisoned weapons.");
    attacker.getCombat().reset();
  }

  /** One nylocas per player, a few tiles from them away from Verzik, chasing them. */
  callNylocas() {
    const centre = this.centre();
    for (const player of this.fighters()) {
      const from = Shared.tileOf(player);
      const dx = Math.sign(from.x - centre.x);
      const dy = Math.sign(from.y - centre.y);
      let tile = null;
      for (let distance = 11; distance >= 2 && !tile; distance--) {
        const candidate = { x: from.x + dx * distance, y: from.y + dy * distance, z: 0 };
        if (inArena(candidate) && Shared.floorFree(this.area, candidate)) tile = candidate;
      }
      if (!tile) continue;
      const style = Shared.randomOf(["melee", "ranged", "magic"]);
      const nylo = this.spawn(NPC.NYLOS[style], tile, { scripted: true });
      if (!nylo) continue;
      nylo.__verzikNylo = { style, target: player, age: 0 };
      this.minions.add(nylo);
    }
  }

  onlyStyle(npc, hit, style) {
    const hitStyle = styleOf(hit);
    if (!hitStyle || hitStyle === style) return;
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
    hit.getAttacker?.()?.sendMessage?.(`You can only damage the ${npcName(npc)} with ${style}.`);
  }

  /** Blood: heals her for half the damage; Protect from Magic stops it. */
  bloodSpell() {
    const target = Shared.randomOf(this.fighters());
    if (!target) return;
    this.animate(ANIMATION.P2_ATTACK);
    const ticks = Shared.projectile(this.area, this.verzik, target, GRAPHIC.BLOOD, PROJECTILE.BLOOD);
    const blocked = Shared.isProtected(target, "magic");
    this.later(ticks, () => {
      if (!this.fighters().includes(target) || blocked) return;
      const damage = Shared.random(0, P2.bloodMax);
      if (damage <= 0) return;
      target.performGraphic(Shared.gfx(GRAPHIC.BLOOD_LAND));
      Shared.damage(target, damage);
      Shared.heal(this.verzik, Math.floor(damage / 2));
    });
  }

  /** Two Matomenos (one with a single player left); she absorbs what's left of the last two. */
  callMatomenos() {
    this.animate(ANIMATION.P2_HEAL);
    this.shieldUntil = Shared.cycle() + P2.shieldTicks;
    for (const old of this.matomenos) {
      if (old.isRegistered() && old.getHitpoints() > 0) Shared.heal(this.verzik, old.getHitpoints());
      this.minions.delete(old);
      this.despawn(old);
    }
    const count = this.fighters().length > 1 ? 2 : 1;
    this.matomenos = MATOMENOS_TILES.slice(0, count).map((tile) => this.spawn(NPC.MATOMENOS, tile, { scripted: true })).filter(Boolean);
  }

  // -------------------------------------------------------------- minions

  tickMinions() {
    for (const minion of [...this.minions]) {
      if (!minion.isRegistered() || minion.getHitpoints() <= 0) {
        this.minions.delete(minion);
        continue;
      }
      if (minion.__verzikNylo) this.tickNylo(minion);
      else if (minion.__athanatos) this.tickAthanatos(minion);
      else if (minion.__tornado) this.tickTornado(minion);
    }
  }

  tickNylo(nylo) {
    const state = nylo.__verzikNylo;
    state.age++;
    const target = state.target;
    const near = target && this.fighters().includes(target) && Shared.distanceTo(nylo, target.getLocation()) <= 1;
    if (near || state.age >= NYLO.fuse) {
      this.explodeNylo(nylo);
      return;
    }
    if (target && this.fighters().includes(target)) {
      const at = Shared.tileOf(target);
      Shared.core().PathFinder.calculateWalkRoute(nylo, at.x, at.y);
      nylo.setMobileInteraction(target);
    }
  }

  explodeNylo(nylo) {
    this.minions.delete(nylo);
    for (const player of this.fighters()) {
      const distance = Shared.distanceTo(nylo, player.getLocation());
      const damage = NYLO.falloff[Math.max(0, distance - 1)] ?? 0;
      if (distance < 4 && damage > 0) Shared.damage(player, damage);
    }
    nylo.setHitpoints(0);
  }

  tickAthanatos(npc) {
    const state = npc.__athanatos;
    state.age++;
    npc.setMobileInteraction(this.verzik);
    if (state.age >= ATHANATOS.life) {
      Shared.heal(this.verzik, npc.getHitpoints());
      this.minions.delete(npc);
      npc.setHitpoints(0);
      return;
    }
    if (state.age % ATHANATOS.every !== 0 || this.transition) return;
    const poisoned = state.poisoned;
    const delay = Shared.random(0, GLOBULE.maxDelay);
    const ticks = Shared.projectile(this.area, npc, this.verzik, poisoned ? GRAPHIC.ATHANATOS_POISON : GRAPHIC.ATHANATOS_HEAL,
      { ...GLOBULE, delay, duration: GLOBULE.lands - delay, perTile: 0 });
    if (poisoned) {
      this.minions.delete(npc);
      this.later(ticks, () => Shared.damage(this.verzik, Shared.random(...ATHANATOS.poison), "GREEN"));
      npc.setHitpoints(0);
      return;
    }
    this.later(ticks, () => Shared.heal(this.verzik, Shared.random(...ATHANATOS.heal)));
  }

  // -------------------------------------------------------------- phase 3

  toPhase3() {
    const npc = this.verzik;
    this.transition = true;
    this.phase = 3;
    for (const old of this.matomenos ?? []) this.despawn(old);
    this.matomenos = [];
    npc.getMovementQueue().reset();
    this.animate(ANIMATION.P2_DEATH);
    this.raid.refreshHealthBars();
    this.later(1, () => {
      npc.setNpcTransformationId(NPC.TO_PHASE3);
      this.animate(ANIMATION.P3_SPAWN);
      this.later(2, () => {
        npc.setNpcTransformationId(NPC.PHASE3);
        npc.setHitpoints(npc.getMaxHitpoints());
        npc.moveTo(Shared.loc(PHASE3_TILE));
        npc.forceChat("Behold my true nature!");
        this.ticks = 0;
        this.attacks = 0;
        this.special = 0;
        this.busyUntil = 0;
        this.enraged = false;
        this.transition = false;
        npc.getMovementQueue().setBlockMovement(false);
        this.raid.refreshHealthBars();
      });
    });
  }

  tickPhase3() {
    const npc = this.verzik;
    if (!this.enraged && npc.getHitpoints() / npc.getMaxHitpoints() <= P3.enrageBelow) {
      this.enraged = true;
      npc.forceChat("I'm not finished with you just yet!");
      for (const player of this.fighters()) this.sendTornado(player);
    }
    if (Shared.cycle() < this.busyUntil) return;
    const fighters = this.fighters();
    if (!this.target || !fighters.includes(this.target)) this.target = Shared.randomOf(fighters);
    const target = this.target;
    if (!target) return;
    this.chase(target);
    if (this.ticks % (this.enraged ? P3.enraged : P3.every) !== 0) return;
    if (this.attacks === P3.specialEvery) {
      this.attacks = 0;
      const special = SPECIALS[this.special++ % SPECIALS.length];
      this[`special_${special}`]();
      if (special !== "nylocas") return;
    }
    this.attacks++;
    this.autoAttack(target);
  }

  /** She walks after her target until it's within reach of her melee. */
  chase(target) {
    const npc = this.verzik;
    if (Shared.frozen(npc) || Shared.distanceTo(npc, target.getLocation()) <= 1) {
      npc.setMobileInteraction(target);
      return;
    }
    const at = Shared.tileOf(target);
    npc.setFlag("movement:ignore-clipping", false);
    Shared.core().PathFinder.calculateWalkRoute(npc, at.x, at.y);
    npc.setMobileInteraction(target);
  }

  autoAttack(target) {
    const npc = this.verzik;
    const fighters = this.fighters();
    const reach = Shared.distanceTo(npc, target.getLocation()) === 1;
    if (reach && Math.random() < 0.5) {
      this.animate(ANIMATION.P3_MELEE);
      for (const player of fighters) {
        if (Shared.distanceTo(player, target.getLocation()) > 1 || Shared.distanceTo(npc, player.getLocation()) !== 1) continue;
        this.strike(npc, player, "melee", P3.melee, 1, { prayerMultiplier: 0 });
      }
      return;
    }
    const style = Math.random() < 0.5 ? "magic" : "ranged";
    this.animate(style === "magic" ? ANIMATION.P3_MAGIC : ANIMATION.P3_RANGED);
    for (const player of this.fighters()) {
      const ticks = style === "magic"
        ? Shared.projectile(this.area, npc, player, GRAPHIC.P3_MAGIC, PROJECTILE.P3_MAGIC)
        : Shared.projectile(this.area, npc, player, GRAPHIC.P3_RANGED, PROJECTILE.P3_RANGED);
      this.strike(npc, player, style, P3[style], Math.max(1, ticks - 1), { prayerMultiplier: P3.prayer });
    }
  }

  special_nylocas() {
    this.callNylocas();
  }

  /** To the middle, players beside her thrown back, then webs spun at the team. */
  special_webs() {
    const npc = this.verzik;
    const { Animation } = Shared.core();
    this.busyUntil = Shared.cycle() + WEBS.spin;
    npc.setNpcTransformationId(NPC.TO_PHASE3);
    Shared.walkStraight(npc, WEB_CENTRE);
    const centre = () => this.centre();
    const spin = () => {
      npc.setNpcTransformationId(NPC.PHASE3);
      npc.getMovementQueue().setBlockMovement(true);
      for (const player of this.fighters()) {
        if (Shared.distanceTo(npc, player.getLocation()) > 3) continue;
        const from = Shared.tileOf(player);
        const c = centre();
        const to = { x: from.x + Math.sign(from.x - c.x) * 4, y: from.y + Math.sign(from.y - c.y) * 4, z: 0 };
        player.performAnimation(new Animation(ANIMATION.KNOCKBACK));
        if (inArena(to) && Shared.floorFree(this.area, to)) player.moveTo(Shared.loc(to));
      }
      this.animate(ANIMATION.P3_WEBS);
      const players = this.fighters();
      for (let i = 0; i < WEBS.spin - 10 && players.length; i++) {
        this.later(i + 3, () => {
          const target = players[Math.floor(i / 3) % players.length];
          if (!this.fighters().includes(target)) return;
          const end = Shared.tileOf(target);
          this.shootWeb(end);
          for (let extra = 0; extra < 2; extra++) {
            this.shootWeb({ x: end.x + Shared.random(-3, 3), y: end.y + Shared.random(-3, 3), z: 0 });
          }
        });
      }
      this.later(WEBS.spin - 3, () => {
        npc.getMovementQueue().setBlockMovement(false);
        this.target = Shared.randomOf(this.fighters().filter((player) => player !== this.target)) ?? this.target;
      });
    };
    this.later(3, spin);
  }

  shootWeb(tile) {
    if (!inArena(tile) || this.webs.has(key(tile)) || !Shared.floorFree(this.area, tile) || Shared.covers(this.verzik, tile)) return;
    this.webs.set(key(tile), null);
    const ticks = Shared.projectile(this.area, this.verzik, tile, GRAPHIC.WEB, { ...PROJECTILE.WEB, delay: Shared.random(0, WEB_MAX_DELAY) });
    this.later(ticks, () => {
      if (this.phase !== 3) {
        this.webs.delete(key(tile));
        return;
      }
      const object = this.placeObject(OBJECT.WEB, tile, 10, 0);
      const npc = this.spawn(NPC.WEB, tile, { scale: false, scripted: true });
      this.webs.set(key(tile), { tile, object, npc, age: 0, stuck: new Set() });
    });
  }

  /** Stepping on a web holds the player; attacking it frees them, and it bursts after 12 ticks. */
  tickWebs() {
    const { TimerKey } = Shared.core();
    for (const web of [...this.webs.values()]) {
      if (!web) continue;
      web.age++;
      const onIt = this.fighters().filter((player) => key(Shared.tileOf(player)) === key(web.tile));
      if (!web.npc?.isRegistered() || web.npc.getHitpoints() <= 0) {
        for (const player of onIt) this.freeFromWeb(player, "The web crumbles under your attack and you are released safely.");
        this.removeWeb(web);
        continue;
      }
      for (const player of onIt) {
        if (web.stuck.has(player)) continue;
        web.stuck.add(player);
        player.getMovementQueue().reset();
        player.getTimers().registers(TimerKey.FREEZE, WEBS.freeze);
        player.sendMessage("You're stuck in the web!");
      }
      if (web.age < WEBS.life) continue;
      for (const player of onIt) {
        this.freeFromWeb(player, "The web explodes and you are released.");
        Shared.damage(player, Shared.random(0, WEBS.max));
      }
      this.removeWeb(web);
    }
  }

  freeFromWeb(player, message) {
    const { TimerKey } = Shared.core();
    player.performGraphic(Shared.gfx(GRAPHIC.BLAST_HIT));
    player.getTimers().cancel(TimerKey.FREEZE);
    player.sendMessage(message);
  }

  removeWeb(web) {
    if (!web) return;
    this.webs.delete(key(web.tile));
    Shared.core().ObjectManager.deregister(web.object, true);
    this.despawn(web.npc);
  }

  /** Safe spots: one player per spot is spared; everyone else takes the blast. */
  special_dots() {
    const npc = this.verzik;
    this.busyUntil = Shared.cycle() + DOTS.ticks;
    npc.getMovementQueue().reset();
    this.animate(ANIMATION.P3_DOTS);
    const fighters = this.fighters();
    const dots = [];
    while (dots.length < fighters.length) {
      const tile = { x: Shared.random(ARENA.minX, ARENA.maxX), y: Shared.random(ARENA.minY, ARENA.maxY), z: 0 };
      if (!Shared.covers(npc, tile) && Shared.floorFree(this.area, tile) && !dots.some((dot) => key(dot) === key(tile))) dots.push(tile);
    }
    const show = () => dots.forEach((dot) => Shared.graphicAt(this.area, GRAPHIC.DOT, dot));
    show();
    this.later(5, show);
    this.later(10, show);
    this.later(9, () => {
      for (const player of this.fighters()) Shared.projectile(this.area, npc, player, GRAPHIC.DOT_BLAST, PROJECTILE.DOT_BLAST);
    });
    this.later(DOTS.ticks, () => {
      const safe = new Set();
      for (const dot of dots) {
        const player = this.fighters().find((candidate) => !safe.has(candidate) && key(Shared.tileOf(candidate)) === key(dot));
        if (player) safe.add(player);
      }
      for (const player of this.fighters()) {
        if (safe.has(player)) {
          player.performGraphic(Shared.gfx(GRAPHIC.DOT_SAFE));
          player.sendMessage("The power resonating here protects you from the blast.");
        } else {
          player.performGraphic(Shared.gfx(GRAPHIC.BLAST_HIT, { height: 96 }));
          Shared.damage(player, DOTS.damage);
        }
      }
    });
  }

  /** The green ball bounces to the nearest teammate; with nobody near, it lands hard. */
  special_green() {
    const first = Shared.randomOf(this.fighters());
    if (!first) return;
    this.animate(ANIMATION.P3_RANGED);
    this.later(2, () => this.bounceGreen(this.verzik, first, 0));
  }

  bounceGreen(from, target, bounces) {
    const ticks = Shared.projectile(this.area, from, target, GRAPHIC.GREEN_BALL, bounces === 0 ? PROJECTILE.GREEN_BALL : { delay: 9, duration: 180, perTile: 0, startHeight: 30, endHeight: 30, angle: 20, progress: 100 });
    this.later(ticks, () => {
      if (this.phase !== 3 || !this.fighters().includes(target)) return;
      let closest = null;
      let distance = Infinity;
      for (const player of this.fighters()) {
        if (player === target) continue;
        const d = Shared.distanceTo(player, target.getLocation());
        if (d < distance) {
          closest = player;
          distance = d;
        }
      }
      if (!closest || distance > GREEN.near || bounces >= GREEN.bounces) {
        target.performGraphic(Shared.gfx(GRAPHIC.BLAST_HIT, { height: 96 }));
        const { Skill } = Shared.core();
        const level = target.getSkillManager().getMaxLevel(Skill.HITPOINTS);
        Shared.damage(target, Shared.random(1, Math.floor(level * GREEN.share)));
        return;
      }
      Shared.damage(target, Shared.random(0, GREEN.bounceMax));
      this.bounceGreen(target, closest, bounces + 1);
    });
  }

  /** Below 20%: a tornado after each player. */
  sendTornado(player) {
    const from = Shared.tileOf(player);
    for (let tries = 0; tries < 32; tries++) {
      const tile = { x: from.x + Shared.random(-5, 5), y: from.y + Shared.random(-5, 5), z: 0 };
      const distance = Math.max(Math.abs(tile.x - from.x), Math.abs(tile.y - from.y));
      if (distance < 4 || !inArena(tile) || !Shared.floorFree(this.area, tile)) continue;
      const tornado = this.spawn(NPC.TORNADO, tile, { scale: false, scripted: true });
      if (!tornado) return;
      tornado.__tornado = { target: player };
      this.minions.add(tornado);
      return;
    }
  }

  tickTornado(tornado) {
    const target = tornado.__tornado.target;
    if (!this.fighters().includes(target)) {
      this.minions.delete(tornado);
      this.despawn(tornado);
      return;
    }
    if (key(Shared.tileOf(tornado)) === key(Shared.tileOf(target))) {
      this.minions.delete(tornado);
      this.despawn(tornado);
      target.performGraphic(Shared.gfx(GRAPHIC.TORNADO_HIT));
      const damage = Math.max(TORNADO.min, Math.floor(target.getHitpoints() / 2));
      Shared.damage(target, damage);
      Shared.heal(this.verzik, damage * TORNADO.heal);
      target.sendMessage("Verzik Vitur saps your health and powers up!");
      this.later(TORNADO.respawn, () => {
        if (this.phase === 3 && this.isStarted()) this.sendTornado(target);
      });
      return;
    }
    const at = Shared.tileOf(target);
    Shared.walkStraight(tornado, at);
  }

  // -------------------------------------------------------------- the end

  die() {
    const npc = this.verzik;
    this.transition = true;
    npc.getMovementQueue().reset();
    npc.getMovementQueue().setBlockMovement(true);
    for (const minion of [...this.minions]) this.despawn(minion);
    this.minions.clear();
    this.animate(ANIMATION.P3_DEATH);
    this.raid.refreshHealthBars();
    this.later(3, () => {
      npc.setNpcTransformationId(NPC.DEAD);
      this.later(5, () => {
        this.despawn(npc);
        this.verzik = null;
        this.complete();
      });
    });
  }

  centre() {
    const at = Shared.tileOf(this.verzik);
    const size = this.verzik.getSize?.() ?? 1;
    return { x: at.x + Math.floor(size / 2), y: at.y + Math.floor(size / 2) };
  }
}

function inArena(tile) {
  return tile.x >= ARENA.minX && tile.x <= ARENA.maxX && tile.y >= ARENA.minY && tile.y <= ARENA.maxY;
}

function styleOf(hit) {
  const { CombatType } = Shared.core();
  const type = hit.getCombatType?.();
  if (type === CombatType.MELEE) return "melee";
  if (type === CombatType.RANGED) return "ranged";
  if (type === CombatType.MAGIC) return "magic";
  return null;
}

function npcName(npc) {
  return npc.getCurrentDefinition?.()?.getName?.() ?? "Nylocas";
}

/** A poisoned melee weapon, or poisoned ammunition (or thrown weapon) for ranged. */
function poisonedWeapon(player, style) {
  const { CombatPoisonData, Equipment } = Shared.core();
  const equipment = player.getEquipment();
  const weapon = equipment.getItems()[Equipment.WEAPON_SLOT];
  if (CombatPoisonData.getPoisonType(weapon)) return true;
  return style === "ranged" && !!CombatPoisonData.getPoisonType(equipment.getItems()[Equipment.AMMUNITION_SLOT]);
}

function roomOf(player) {
  const raid = Raid.raidOf(player);
  const room = raid?.room;
  return room instanceof VerzikRoom && raid.member(player).roomKey === room.key ? room : null;
}

function talkToVerzik(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.talk(event.player);
  return true;
}

/** The skeleton in Xarpus' room holds the Dawnbringer once Xarpus is beaten. */
function searchSkeleton(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const xarpus = raid.room;
  if (!xarpus || xarpus.key !== "XARPUS" || !xarpus.isCompleted()) {
    player.sendMessage("You can't search this until the challenge is complete.");
    return true;
  }
  const { Item, ObjectManager } = Shared.core();
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space to take the Dawnbringer.");
    return true;
  }
  inventory.add(new Item(DAWNBRINGER, 1), false);
  inventory.refreshItems();
  const skeleton = event.object;
  if (skeleton) {
    const location = skeleton.getLocation();
    ObjectManager.deregister(skeleton, true);
    xarpus.placeObject(OBJECT.SKELETON_SEARCHED, { x: location.getX(), y: location.getY(), z: location.getZ() }, skeleton.getType(), skeleton.getFace());
  }
  Shared.statement(player, "You find the Dawnbringer; you feel a pulse of energy burst through it.");
  return true;
}

module.exports = function registerVerzik(api) {
  Shared.bind(api);
  Raid.registerRoom("VERZIK", VerzikRoom);
  api.onNpcInteraction("Verzik Vitur", { "Talk-to": talkToVerzik });
  Shared.onObject(api, OBJECT.SKELETON, searchSkeleton);
};

Object.assign(module.exports, { VerzikRoom, PILLARS, NPC, DAWNBRINGER, poisonedWeapon });
