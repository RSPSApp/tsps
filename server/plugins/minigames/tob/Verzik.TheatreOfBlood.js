"use strict";

/**
 * Wave 6: Verzik Vitur, in three phases, in each of the raid's three modes.
 *
 * Wiki (Verzik Vitur; "Theatre of Blood/Strategies", Verzik Vitur; Hard and Entry Mode pages):
 * - Anyone in the party talks to her to start (captured: 554, 1852, whoever isn't the leader too).
 *   Phase 1 (every 14 ticks): only the Dawnbringer hurts her properly - other hits are capped at
 *   10 (melee) and 3 (ranged, magic). Her blast hits anyone not behind a pillar (half through
 *   Protect from Magic); a pillar sheltering someone takes one blast instead, however many hide
 *   there, and collapses for up to 70 on anyone beside it. Hard Mode: rubble round a pillar each
 *   time it's hit (up to 35 and a stun).
 * - Phase 2 (every 4 ticks): she flies to the middle, bringing every pillar down. She slams anyone
 *   beside her (up to 50, a stun, three tiles back) and stomps anyone under her (up to 80, "always
 *   a successful hit"); throws urns at everyone's tiles (up to 44, halved by Protect from Missiles;
 *   Hard: 20% more, and a pool for 16 ticks, 9-10 damage and poison); sends a lightning ball hopping
 *   through the team, up to four hops (small hits, then 48; alone, 48 at once, 25 in insulated
 *   boots; 15-20 on her if she's in the way); and calls nylocas with a purple ball (up to 78 on
 *   its tile, then a Nylocas Athanatos healing her until a poisoned weapon makes it poison her).
 *   After every third lightning ball, a 25% chance of another call unless an Athanatos lives. At
 *   35% she calls Matomenos (two, one with one player alive), then uses a blood spell 75% of the
 *   time (Mod Ash: up to 45 round its target, halved by prayer, healing half of the total). For
 *   three seconds after the call hits on her heal her. She absorbs the Matomenos left at the next
 *   call; Hard: they also explode at whoever's near.
 * - Phase 3 (every 7 ticks): she walks. Melee hits everyone beside her for up to 63; ranged and magic
 *   up to 33 on everyone (half through prayer, worked out as they land). After four attacks a special,
 *   in turn: nylocas, webs, safe spots, a green ball. Below 20%: every 5 ticks, 34 max, a tornado
 *   after each player (half their hitpoints, at least 5, healing her for three times that; a new one
 *   16 ticks after it hits). Hard: a new target at every special; safe spots hit three times with
 *   three tiles each; the green ball kills outright with two or more players alive, unless passed
 *   on (then 89, 74 and 49 for 1, 2 and 3 passes); at 5% she heals 30% of her hitpoints, once.
 * Cache: her forms per mode, the Talk-to forms (8369 by varp 1748 -> 14795, 10847 by varp 3057 ->
 * 14797, 10830 has it itself), the arena's floor (x 3154-3182, y 4303-4322; y 4323 and her throne are
 * solid and x 3154-3182, y 4302 is a wall with the three door tiles 3167-3169).
 * Captured (1852 Hard 2868 and 7450; 3299, 554 Normal; 101 and 554 Entry; tiles from the Verzik
 * anchor with the instance offset a multiple of 8): every id, animation, projectile, sound and
 * message here; attack and phase-change timing; tiles of her, the pillars, the Matomenos, the
 * nylocas' five spawn points; the attacks' rotation; Hard's nylocas changing style every 3 ticks;
 * the door (47336 until the fight, then 33028); 26209 blocking a falling pillar's 5x5.
 * Estimates: Entry's damage beyond the Infobox's; web and rubble stuns; which player's nylocas
 * spawns where; the Hard Matomenos' explosion; the safe-spot damage on Hard (the Wiki's 80).
 * A fit from few samples: Entry's hitpoints by team (solo 101, duo 554).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

/** Her forms and minions by mode. Captured: all three modes share the pillars' 8377-8379. */
const NPC_BY_MODE = {
  normal: {
    WAITING: 8369, SPEAKER: 14795, PHASE1: 8370, TO_PHASE2: 8371, PHASE2: 8372, TO_PHASE3: 8373, PHASE3: 8374, DEAD: 8375,
    WEB: 8376, NYLOS: { melee: 8381, ranged: 8382, magic: 8383 }, ATHANATOS: 8384, MATOMENOS: 8385, TORNADO: 8386,
  },
  entry: {
    WAITING: 10830, SPEAKER: 10830, PHASE1: 10831, TO_PHASE2: 10832, PHASE2: 10833, TO_PHASE3: 10834, PHASE3: 10835, DEAD: 10836,
    WEB: 10837, NYLOS: { melee: 10841, ranged: 10842, magic: 10843 }, ATHANATOS: 10844, MATOMENOS: 10845, TORNADO: 10846,
  },
  hard: {
    WAITING: 10847, SPEAKER: 14797, PHASE1: 10848, TO_PHASE2: 10849, PHASE2: 10850, TO_PHASE3: 10851, PHASE3: 10852, DEAD: 10853,
    WEB: 10854, NYLOS: { melee: 10858, ranged: 10859, magic: 10860 }, ATHANATOS: 10861, MATOMENOS: 10862, TORNADO: 10863,
  },
};
const PILLAR_NPC = { STANDING: 8379, COLLAPSING: 8377, FADING: 8378 };
const OBJECT = {
  PILLAR: 32687, WEB: 32734, SKELETON: 32741, SKELETON_SEARCHED: 32742,
  /** The door south of the arena, open then shut for the fight; the throne as she falls. */
  DOOR_OPEN: 47336, DOOR_SHUT: 33028, THRONE_FALLING: 32737,
  /** The 5x5 a pillar blocks as it falls; a Hard Mode urn's pool. */
  RUBBLE_BLOCK: 26209, POOL: 41747,
};
const { DAWNBRINGER } = Shared.ITEM;

const ANIMATION = {
  P1_BLAST: 8109, OFF_THRONE: 8111, P2_SPAWN: 8112, P2_ATTACK: 8114, P2_BOUNCE: 8116, P2_HEAL: 8117,
  P2_DEATH: 8118, P3_SPAWN: 8119, P3_MELEE: 8123, P3_MAGIC: 8124, P3_RANGED: 8125, P3_DOTS: 8126,
  P3_WEBS: 8127, P3_DEATH: 8128, PILLAR_COLLAPSE: 8052, PILLAR_FADE: 8104, KNOCKBACK: 8043,
  ATHANATOS_SPAWN: 8079, MATOMENOS_SPAWN: 8098,
  /** As it explodes, by the style it shows. */
  NYLO_EXPLODE: { melee: 8006, ranged: 8000, magic: 7992 },
};
const GRAPHIC = {
  BLAST: 1580, BLAST_PLAYER: 1581, BLAST_PILLAR: 1582, URN: 1583, URN_LAND: 1584, LIGHTNING: 1585,
  PURPLE: 1586, ATHANATOS_HEAL: 1587, ATHANATOS_POISON: 1588, ATHANATOS_LAND: 1589, ATHANATOS_POISONED: 1590,
  ATHANATOS_BURST: 184, BLOOD: 1591, BLOOD_LAND: 1592, P3_RANGED: 1593, P3_MAGIC: 1594, DOT: 1595, DOT_BLAST: 1596,
  DOT_SAFE: 1597, GREEN_BALL: 1598, BLAST_HIT: 1600, WEB: 1601, TORNADO_HIT: 1602, STUN: 80,
  RUBBLE: 1435, RUBBLE_MARK: 1447, RUBBLE_LAND: 1436,
};
const SOUND = {
  BLAST_HIT: 3887, URN_LAND: 1021, LIGHTNING: 1715, LIGHTNING_HIT: 581, LIGHTNING_HIT_2: 1583, PURPLE: 205,
  ATHANATOS_LAND: 360, ATHANATOS_LAND_2: 684, GLOBULE: 167, POISON_BURST: 1930, POISON_BURST_2: 3423, BLOOD: 106,
  GREEN_LAND: 1418, TORNADO_HIT: 860, DEATH: 4008,
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
  /** Lightning passed on from one player to the next, or into Verzik (1852 tick 3318). */
  LIGHTNING_BOUNCE: { delay: 0, duration: -6, perTile: 18, minDuration: 30, startHeight: 24, endHeight: 24, angle: 32, progress: 0 },
  LIGHTNING_INTO_HER: { delay: 0, duration: 30, perTile: 0, startHeight: 24, endHeight: 65, angle: 32, progress: 0 },
  BLOOD: { delay: 21, duration: -3, perTile: 18, minDuration: 39, startHeight: 70, endHeight: 24, angle: 8, progress: 128 },
  PURPLE: { delay: 21, duration: -60, perTile: 60, minDuration: 159, startHeight: 70, endHeight: 1, angle: 0, progress: 64 },
  P3_RANGED: { delay: 62, duration: 0, perTile: 15, maxDuration: 117, startHeight: 100, endHeight: 25, angle: 20, progress: 100 },
  P3_MAGIC: { delay: 53, duration: 0, perTile: 15, maxDuration: 126, startHeight: 100, endHeight: 25, angle: 20, progress: 100 },
  WEB: { duration: 0, perTile: 15, startHeight: 87, endHeight: 0, angle: 15, progress: 0 },
  DOT_BLAST: { delay: 261, duration: 144, perTile: 0, startHeight: 250, endHeight: 30, angle: 50, progress: 0 },
  GREEN_BALL: { delay: 62, duration: 180, perTile: 0, startHeight: 100, endHeight: 30, angle: 20, progress: 100 },
  GREEN_PASSED: { delay: 9, duration: 180, perTile: 0, startHeight: 30, endHeight: 30, angle: 20, progress: 100 },
  RUBBLE: { delay: 0, duration: 120, perTile: 0, startHeight: 200, endHeight: 0, angle: 0, progress: 0 },
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
  [ANIMATION.P3_DEATH]: [[SOUND.DEATH, 0]],
};

const BASE = { x: 3136, y: 4288 };
const at = (x, y) => ({ x: BASE.x + x, y: BASE.y + y, z: 0 });
const THRONE = at(30, 35);
const PHASE2_TILE = at(31, 25);
const PHASE3_TILE = at(29, 23);
/** Captured: she stands at (3165, 4309) for her webs in every sample. */
const WEB_CENTRE = at(29, 21);
const PILLARS = [at(25, 18), at(37, 18), at(25, 24), at(37, 24), at(25, 30), at(37, 30)];
const PILLAR_SIZE = 3;
/** Captured: left first, right too with two players alive (3299 tick 6243; 1852 tick 7884). */
const MATOMENOS_TILES = [at(27, 26), at(35, 26)];
/** Captured over 30 calls: (3167, 4320) by far the most often; which player gets which is an estimate. */
const NYLO_TILES = [at(31, 32), at(41, 31), at(21, 27), at(40, 27), at(32, 27)];
/** Cache: the floor. */
const ARENA = { minX: 3154, maxX: 3182, minY: 4303, maxY: 4322 };
/** Captured: 47336 here until the fight, then 33028. */
const DOOR_TILES = [{ x: 3167, y: 4302, z: 0 }, { x: 3168, y: 4302, z: 0 }, { x: 3169, y: 4302, z: 0 }];

/** Wiki's hitpoints for Normal and Hard; for Entry the cache's, which a solo raid has exactly (101). */
const PHASE_HITPOINTS = { normal: [2000, 3500, 3500], entry: [300, 400, 600] };
/**
 * Entry's team multiplier. Captured: 1 solo (101), 1.9 with two (554: 570, 762). Wiki's Infobox: 4 at
 * the top (1200, 1600, 2400). Three and four players between them (estimate).
 */
const ENTRY_TEAM = { 1: 1, 2: 1.9, 3: 2.6, 4: 3.3, 5: 4 };

/**
 * Damage. Wiki for Normal. Hard: urns 20% more. Entry: the Infobox's 60, 50, 16, 16, ~34, 36 and 20;
 * the rest scaled from Normal by 16/44 (estimate).
 */
const DAMAGE = {
  normal: {
    blast: 137, collapse: 70, urn: 44, slam: 50, stomp: 80, lightning: [4, 8], lightningLast: [45, 48], insulated: 25,
    purple: 78, blood: 45, nylo: [63, 26, 8], melee: 63, ranged: 33, magic: 33, enraged: 34, heal: [9, 11], poison: [70, 75],
    webs: 40, dots: 80,
  },
  hard: {
    blast: 137, collapse: 70, urn: 53, slam: 50, stomp: 80, lightning: [4, 8], lightningLast: [45, 48], insulated: 25,
    purple: 78, blood: 45, nylo: [63, 26, 8], melee: 63, ranged: 33, magic: 33, enraged: 34, heal: [9, 11], poison: [70, 75],
    webs: 40, dots: 80,
  },
  entry: {
    blast: 60, collapse: 50, urn: 16, slam: 16, stomp: 34, lightning: [1, 3], lightningLast: [14, 16], insulated: 9,
    purple: 28, blood: 16, nylo: [23, 9, 3], melee: 36, ranged: 20, magic: 20, enraged: 20, heal: [6, 7], poison: [25, 30],
    webs: 15, dots: 29,
  },
};

const P1 = {
  every: 14, first: 19, prayer: 0.5, pillar: [40, 60], capMelee: 10, capOther: 3,
  /** Captured: a pillar falls 4 ticks after the hit that breaks it, fades at +4 and goes at +6. */
  fallsAfter: 4, fadesAfter: 4, gonePastFade: 2, block: 5, pushed: 2,
};
/** Hard: rubble at 0, 1, 3 and 4 ticks from the pillar's hit (1852 tick 2918), landing 3 ticks on. */
const RUBBLE = { waves: [[0, 5], [1, 4], [3, 4], [4, 4]], reach: 3, lands: 3, max: 35, stun: 5, markDelay: 0, landDelay: 90 };
const P2 = {
  every: 4, firstAttack: 3, healBelow: 0.35, stun: 5, knockback: 3, urnPrayer: 0.5, lightningHer: [15, 20], lightningHops: 4,
  /** Captured: the first lightning is her sixth attack, then every fifth. */
  firstLightning: 6, lightningEvery: 5,
  /** Captured: the first call came as attack 1-4. Wiki: then 25% after every third ball. */
  firstCall: [1, 4], recallEvery: 3, recallChance: 0.25,
  /** Wiki: "very high chance" of a slam with someone beside her (estimate). */
  slamChance: 0.9,
  /** Captured: Matomenos every 44 ticks, her next attack 12 after each call. */
  matomenosEvery: 44, afterMatomenos: 12,
  /** Wiki: three seconds. Mod Ash: 75%. */
  shieldTicks: 5, bloodChance: 0.75, bloodReach: 1, lightningChance: 0.5,
};
const POOL = { lasts: 13, damage: [9, 10], poison: 4 };
/** Hard: the Matomenos' explosion, a share of its hitpoints on anyone within reach (estimate). */
const MATOMENOS_BLAST = { reach: 2, share: 0.25 };
const P3 = {
  every: 7, enraged: 5, enrageBelow: 0.2, prayer: 0.5, specialEvery: 4, firstAttack: 6,
  /** Hard: once, at 5%, heals 30% (Wiki). */
  lastStandBelow: 0.05, lastStandHeal: 0.3,
  /** Wiki: another target after 10 seconds out of her reach. */
  retargetAfter: 17,
};
/** Captured (normal, hard): the fuse. Hard's nylocas have none and change style every 3 ticks. */
const NYLO = { fuse: 25, styleEvery: 3, gone: 3, order: ["melee", "ranged", "magic"] };
const ATHANATOS = { every: 4, firstAt: 2 };
/**
 * Captured: webs fly from 3 ticks after her animation, three a tick for 28 ticks, and her next
 * attack is 40 after it. Each lasts about 18 ticks from its launch (1852, 3299). Wiki: 10 hitpoints.
 */
const WEBS = { startsAfter: 3, ticks: 28, perTick: 3, next: 40, lasts: 18, freeze: 20, walkAtMost: 12, knockback: 4, knockedWithin: 3, araneaEvery: 8 };
/**
 * Captured: strikes land 14 ticks in (Hard 14, 17 and 20), the tiles shown at these ticks, and her
 * next attack 21 after (Hard 27).
 */
const DOTS = {
  strikes: { normal: [14], hard: [14, 17, 20] }, next: { normal: 21, hard: 27 }, shownAt: [0, 2, 5, 8, 11, 14, 17],
  extraFlight: { 14: 0, 17: 90, 20: 180 }, spotsPerPlayer: { normal: 1, hard: 3 },
};
/** Wiki: passes to someone beside the target; 74% at most; Hard's 89, 74 and 49. Captured: 12 ticks to her next attack. */
const GREEN = { passes: 3, near: 1, share: 0.74, next: 12, hard: { 1: 89, 2: 74, 3: 49 }, launchAfter: 0 };
const TORNADO = { min: 5, heal: 3, respawn: 16, reachesWithin: 5, atLeast: 4 };
const SPECIALS = ["nylocas", "webs", "dots", "green"];
const LINES = {
  FIRST: ["Now that was quite the show! I haven't been that entertained in a long time.", "Of course, you know I can't let you leave here alive. Time for your final performance..."],
  AGAIN: ["Back again for more? I admire your perseverance. Shall we begin?"],
  START: "Oh I'm going to enjoy this...",
};

const key = (tile) => `${tile.x},${tile.y}`;

class VerzikRoom extends Raid.Room {
  onBuild() {
    this.ids = Shared.byMode(this.raid, NPC_BY_MODE);
    this.damages = Shared.byMode(this.raid, DAMAGE);
    this.verzik = this.spawn(this.ids.WAITING, THRONE, { scale: false, scripted: true, face: Shared.facing("SOUTH") });
    this.setPhaseHitpoints(0);
    this.verzik?.getMovementQueue().setBlockMovement(true);
    this.phase = 0;
    this.pillars = [];
    for (const tile of PILLARS) {
      const object = this.placeObject(OBJECT.PILLAR, tile, 10, 0);
      const npc = this.spawn(PILLAR_NPC.STANDING, tile, { scale: false, scripted: true });
      if (npc) this.pillars.push({ npc, object, tile, falling: false });
    }
    this.doors = DOOR_TILES.map((tile) => this.placeObject(OBJECT.DOOR_OPEN, tile, 10, 0));
    this.minions = new Set();
    this.webs = new Map();
    this.pools = new Map();
    this.matomenos = [];
    this.ticks = 0;
  }

  /** Captured: arrivals walk from south of the door to (3168, 4303), where the map here starts them. */
  onArrive(player) {
    const member = this.raid.member(player);
    if (this.isStarted()) this.joinFight(member);
  }

  joinFight(member) {
    member.inFight = true;
    member.roomStats(this.key).fought = true;
  }

  /** Her hitpoints for a phase (0-2), as RaidState's scale has none for her later forms. */
  setPhaseHitpoints(phase) {
    const npc = this.verzik;
    if (!npc) return;
    const { raid } = this;
    const base = Shared.byMode(raid, PHASE_HITPOINTS)[phase];
    const share = raid.isEntry ? ENTRY_TEAM[Math.min(raid.size, Shared.MAX_PARTY_SIZE)] ?? 1 : Shared.MODES[raid.mode].hitpoints(raid.size);
    const hitpoints = Math.max(1, Math.floor(base * share));
    npc.setMaxHitpoints?.(hitpoints);
    npc.setHitpoints(hitpoints);
  }

  /** Talk-to: captured (554, 1852), any member can start her, not only the leader. */
  talk(player) {
    if (this.isStarted() || this.isCompleted()) return;
    const { completionsOf } = require("./Stats.TheatreOfBlood");
    const veteran = Object.keys(Shared.MODES).some((mode) => completionsOf(player, mode) > 0);
    const lines = veteran ? LINES.AGAIN : LINES.FIRST;
    const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      ...lines.map((line, index) => new NpcDialogue(index, this.ids.SPEAKER, line)),
      new ActionDialogue(lines.length, { execute: () => this.confirmStart(player) }),
    ));
  }

  confirmStart(player) {
    const ready = () => {
      if (this.isStarted()) return;
      this.start();
      Shared.npcSay(player, this.ids.PHASE1, LINES.START);
    };
    Shared.options(player, "Is your party ready to fight?", "Yes, let's begin.", ready, "No, don't start yet.", () => {});
  }

  onStart() {
    for (const player of this.roomPlayers()) this.joinFight(this.raid.member(player));
    this.verzik.setNpcTransformationId(this.ids.PHASE1);
    this.phase = 1;
    this.ticks = 0;
    const { ObjectManager } = Shared.core();
    for (const door of this.doors) ObjectManager.deregister(door, true);
    this.objects = this.objects.filter((object) => !this.doors.includes(object));
    this.doors = DOOR_TILES.map((tile) => this.placeObject(OBJECT.DOOR_SHUT, tile, 10, 0));
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
    this.tickPools();
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

  /** Captured: the throne falls as the room is won, and the treasure room stands 5 ticks later. */
  onComplete() {
    for (const minion of [...this.minions]) this.despawn(minion);
    this.minions.clear();
    for (const web of [...this.webs.values()]) this.removeWeb(web);
    this.clearPools();
    const exit = this.def.exit;
    if (exit) {
      const throne = this.placeObject(OBJECT.THRONE_FALLING, exit, exit.type, exit.face);
      this.later(5, () => {
        Shared.core().ObjectManager.deregister(throne, true);
        this.objects = this.objects.filter((object) => object !== throne);
        this.placeObject(exit.id, exit, exit.type, exit.face);
      });
    }
    for (const task of ["Perfect Verzik", "Pop It", "Nylo Sniper", "Harder Mode III"]) {
      if (this.raid.taskLive(task)) this.raid.completeTask(task);
    }
  }

  /** Hurts a player with one of her attacks: anything but a prayed spider-form attack fails the task. */
  hurt(player, amount, attack, mask) {
    if (amount <= 0) return;
    Shared.damage(player, amount, mask);
    this.raid.failTask("Perfect Verzik", `${Shared.displayName(player)} was hit by Verzik Vitur's ${attack}.`);
  }

  // -------------------------------------------------------------- phase 1

  tickPhase1() {
    if (this.ticks !== P1.first && (this.ticks < P1.first || (this.ticks - P1.first) % P1.every !== 0)) return;
    const { Animation } = Shared.core();
    const npc = this.verzik;
    npc.performAnimation(new Animation(ANIMATION.P1_BLAST));
    this.later(2, () => {
      const sheltering = new Set();
      for (const player of this.fighters()) {
        const pillar = this.pillarCovering(player);
        if (pillar) {
          sheltering.add(pillar);
          continue;
        }
        const ticks = Shared.projectile(this.area, npc, player, GRAPHIC.BLAST, PROJECTILE.BLAST);
        Shared.areaSound(this.area, player, SOUND.BLAST_HIT, ticks * 30);
        this.later(ticks, () => {
          if (this.phase !== 1 || !this.fighters().includes(player)) return;
          player.performGraphic(Shared.gfx(GRAPHIC.BLAST_PLAYER));
          const damage = Shared.random(0, this.damages.blast);
          this.hurt(player, Shared.isProtected(player, "magic") ? Math.floor(damage * P1.prayer) : damage, "powerful magic attack");
        });
      }
      // Captured (1852 tick 2971): one blast per pillar with someone behind it.
      for (const pillar of sheltering) this.blastPillar(pillar);
    });
  }

  blastPillar(pillar) {
    const ticks = Shared.projectile(this.area, this.verzik, pillar.npc, GRAPHIC.BLAST, PROJECTILE.BLAST_PILLAR);
    pillar.npc.performGraphic(Shared.gfx(GRAPHIC.BLAST_PILLAR, { delay: ticks * 30 }));
    this.later(ticks, () => {
      if (!this.pillars.includes(pillar)) return;
      pillar.npc.setHitpoints(Math.max(0, pillar.npc.getHitpoints() - Shared.random(...P1.pillar)));
      if (this.raid.isHard) this.dropRubble(pillar);
    });
  }

  /** Behind a pillar: it stands on the straight line from her middle to the player. */
  pillarCovering(player) {
    const tile = Shared.tileOf(player);
    const size = this.verzik.getSize?.() ?? 1;
    const from = this.verzik.getLocation();
    const fromX = from.getX() + size / 2;
    const fromY = from.getY() + size / 2;
    const toX = tile.x + 0.5;
    const toY = tile.y + 0.5;
    const steps = Math.ceil(Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)) * 4);
    for (const pillar of this.pillars) {
      for (let step = 0; step <= steps; step++) {
        const x = fromX + ((toX - fromX) * step) / steps;
        const y = fromY + ((toY - fromY) * step) / steps;
        if (x >= pillar.tile.x && x < pillar.tile.x + PILLAR_SIZE && y >= pillar.tile.y && y < pillar.tile.y + PILLAR_SIZE) return pillar;
      }
    }
    return null;
  }

  /** Hard: rubble round the pillar just hit. */
  dropRubble(pillar) {
    for (const [delay, count] of RUBBLE.waves) {
      this.later(delay, () => {
        if (this.phase !== 1) return;
        for (let i = 0; i < count; i++) this.dropRubbleAt(this.rubbleTile(pillar));
      });
    }
  }

  rubbleTile(pillar) {
    for (let tries = 0; tries < 16; tries++) {
      const tile = {
        x: Shared.random(pillar.tile.x - RUBBLE.reach, pillar.tile.x + PILLAR_SIZE - 1 + RUBBLE.reach),
        y: Shared.random(pillar.tile.y - RUBBLE.reach, pillar.tile.y + PILLAR_SIZE - 1 + RUBBLE.reach),
        z: 0,
      };
      if (inArena(tile) && Shared.floorFree(this.area, tile)) return tile;
    }
    return null;
  }

  dropRubbleAt(tile) {
    if (!tile) return;
    Shared.projectile(this.area, { x: tile.x - 1, y: tile.y - 1, z: 0 }, tile, GRAPHIC.RUBBLE, PROJECTILE.RUBBLE);
    Shared.graphicAt(this.area, GRAPHIC.RUBBLE_MARK, tile, { delay: RUBBLE.markDelay });
    Shared.graphicAt(this.area, GRAPHIC.RUBBLE_LAND, tile, { delay: RUBBLE.landDelay });
    Shared.areaSound(this.area, tile, SOUND.URN_LAND, RUBBLE.landDelay);
    this.later(RUBBLE.lands, () => {
      for (const player of this.fighters()) {
        if (key(Shared.tileOf(player)) !== key(tile)) continue;
        this.hurt(player, Shared.random(0, RUBBLE.max), "falling rubble");
        this.stun(player, RUBBLE.stun);
      }
    });
  }

  stun(player, ticks) {
    Shared.core().CombatFactory.stunTicks(player, ticks, true, { graphic: Shared.gfx(GRAPHIC.STUN, { height: 96 }) });
  }

  tickPillars() {
    for (const pillar of this.pillars) {
      if (pillar.falling || (pillar.npc.getHitpoints() > 0 && pillar.npc.isRegistered())) continue;
      pillar.falling = true;
      this.later(P1.fallsAfter, () => this.collapse(pillar));
    }
  }

  /** It comes down on anyone beside it; while it falls, its 5x5 can't be walked on. */
  collapse(pillar, closing = false) {
    if (!this.pillars.includes(pillar)) return;
    this.pillars = this.pillars.filter((entry) => entry !== pillar);
    if (!closing) this.raid.failTask("No-Pillar", "A pillar collapsed.");
    const { Animation, ObjectManager } = Shared.core();
    ObjectManager.deregister(pillar.object, true);
    this.objects = this.objects.filter((object) => object !== pillar.object);
    this.despawn(pillar.npc);
    const corner = { x: pillar.tile.x - 1, y: pillar.tile.y - 1, z: 0 };
    const rubble = this.spawn(PILLAR_NPC.COLLAPSING, corner, { scale: false, scripted: true });
    rubble?.performAnimation(new Animation(ANIMATION.PILLAR_COLLAPSE));
    for (const player of this.fighters()) {
      if (!rubble || Shared.distanceTo(rubble, player.getLocation()) > 1) continue;
      this.hurt(player, Shared.random(Math.floor(this.damages.collapse / 2), this.damages.collapse), "collapsing pillar");
      this.stun(player, P2.stun);
      this.pushOff(player, corner);
    }
    const blocks = [];
    for (let dx = 0; dx < P1.block; dx++) {
      for (let dy = 0; dy < P1.block; dy++) blocks.push(this.placeObject(OBJECT.RUBBLE_BLOCK, { x: corner.x + dx, y: corner.y + dy, z: 0 }, 10, 0));
    }
    this.later(P1.fadesAfter, () => {
      rubble?.setNpcTransformationId(PILLAR_NPC.FADING);
      rubble?.performAnimation(new Animation(ANIMATION.PILLAR_FADE));
      this.later(P1.gonePastFade, () => {
        this.despawn(rubble);
        for (const block of blocks) ObjectManager.deregister(block, true);
        this.objects = this.objects.filter((object) => !blocks.includes(object));
      });
    });
  }

  /** Wiki: pushed a few tiles away from a falling pillar. */
  pushOff(player, corner) {
    const from = Shared.tileOf(player);
    const middle = { x: corner.x + 2, y: corner.y + 2 };
    const dx = Math.sign(from.x - middle.x);
    const dy = Math.sign(from.y - middle.y) || (dx === 0 ? -1 : 0);
    const to = { x: from.x + dx * P1.pushed, y: from.y + dy * P1.pushed, z: 0 };
    if (inArena(to) && Shared.floorFree(this.area, to)) player.moveTo(Shared.loc(to));
  }

  /** Phase 1's caps; hits while she's immune; heals during the Matomenos' call. */
  modifyHit(npc, hit) {
    if (npc === this.verzik) {
      this.modifyVerzikHit(hit);
      return;
    }
    if (npc.__verzikNylo) {
      this.onlyStyle(npc, hit, npc.__verzikNylo.style);
      return;
    }
    if (npc.__athanatos) this.hitAthanatos(npc, hit);
  }

  modifyVerzikHit(hit) {
    const parts = hit.getHits?.() ?? [];
    const attacker = hit.getAttacker?.();
    if (this.phase === 1) {
      const special = hit.getCombatMethod?.()?.constructor?.name === "DawnbringerCombatMethod";
      if (special) attacker?.sendMessage?.("The spell strikes to the heart of Verzik Vitur's shield!");
      // Captured (101 tick 27065): the Dawnbringer's plain spell goes past the cap too.
      if (!special && !wielding(attacker, DAWNBRINGER)) {
        const cap = styleOf(hit) === "melee" ? P1.capMelee : P1.capOther;
        for (const part of parts) part.setDamage(Math.min(cap, part.getDamage()));
      }
    } else if (this.phase === 2 && this.shieldUntil && Shared.cycle() < this.shieldUntil) {
      // Just after calling Matomenos, hits heal her instead.
      const damage = parts.reduce((sum, part) => sum + part.getDamage(), 0);
      for (const part of parts) part.setDamage(0);
      Shared.heal(this.verzik, damage);
    } else if (this.phase === 3) {
      if (attacker?.isPlayer?.() && styleOf(hit) === "melee") {
        this.raid.failTask("Harder Mode III", `${Shared.displayName(attacker)} attacked Verzik Vitur with a melee weapon.`);
      }
      if (this.immune) {
        for (const part of parts) part.setDamage(0);
        attacker?.sendMessage?.("Verzik Vitur is currently immune!");
      }
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
    // Captured: her next form 4 ticks on, her line a tick later, in the middle 13 after the form.
    this.later(4, () => {
      npc.setNpcTransformationId(this.ids.TO_PHASE2);
      npc.performAnimation(new Animation(ANIMATION.P2_SPAWN));
      this.setPhaseHitpoints(1);
      for (const pillar of [...this.pillars]) this.collapse(pillar, true);
      if (this.raid.taskLive("No-Pillar")) this.raid.completeTask("No-Pillar");
      this.later(1, () => {
        npc.forceChat("You think you can defeat me?");
        Shared.walkStraight(npc, { x: PHASE2_TILE.x - 1, y: PHASE2_TILE.y - 1, z: 0 });
      });
      this.later(13, () => {
        npc.getMovementQueue().reset();
        npc.moveTo(Shared.loc(PHASE2_TILE));
        npc.setNpcTransformationId(this.ids.PHASE2);
        this.setPhaseHitpoints(1);
        npc.setPositionToFace(Shared.loc({ ...PHASE2_TILE, y: PHASE2_TILE.y - 5 }));
        this.ticks = 0;
        this.nextAttack = P2.firstAttack;
        this.attackCount = 0;
        this.lightnings = 0;
        this.callAt = Shared.random(...P2.firstCall);
        this.called = false;
        this.recall = false;
        this.healing = false;
        this.nextMatomenos = 0;
        this.matomenos = [];
        this.transition = false;
        this.raid.refreshHealthBars();
      });
    });
  }

  /** Wiki and captured: the Dawnbringer falls apart once her shield is gone. */
  takeDawnbringer(player) {
    if (Shared.removeDawnbringer(player)) player.sendMessage("The weapon falls apart in your hand as Verzik's shield is destroyed.");
  }

  tickPhase2() {
    const npc = this.verzik;
    if (!this.healing && npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints()) <= P2.healBelow) {
      this.healing = true;
      this.callMatomenos();
      return;
    }
    if (this.healing && this.ticks >= this.nextMatomenos) {
      this.callMatomenos();
      return;
    }
    if (this.ticks < this.nextAttack) return;
    this.nextAttack = this.ticks + P2.every;
    if (this.fighters().length === 0) return;
    this.attackCount++;
    if (this.bodySlam()) return;
    if (this.healing) {
      if (Math.random() < P2.bloodChance) this.bloodSpell();
      else if (Math.random() < P2.lightningChance) this.lightning();
      else this.urns();
      return;
    }
    if (this.attackCount >= P2.firstLightning && (this.attackCount - P2.firstLightning) % P2.lightningEvery === 0) {
      this.lightnings++;
      this.lightning();
      if (this.lightnings % P2.recallEvery === 0 && Math.random() < P2.recallChance) this.recall = true;
      return;
    }
    const firstCall = !this.called && this.attackCount >= this.callAt;
    if (firstCall || (this.recall && !this.athanatosAlive())) {
      this.called = true;
      this.recall = false;
      this.animate(ANIMATION.P2_ATTACK);
      this.purpleBall();
      this.callNylocas();
      return;
    }
    this.urns();
  }

  athanatosAlive() {
    return [...this.minions].some((minion) => minion.__athanatos);
  }

  /** A stomp on anyone under her (always) or a slam on one of those beside her (usually). */
  bodySlam() {
    const fighters = this.fighters();
    const under = fighters.filter((player) => Shared.distanceTo(this.verzik, player.getLocation()) === 0);
    const beside = fighters.filter((player) => Shared.distanceTo(this.verzik, player.getLocation()) === 1);
    const slammed = beside.length && Math.random() < P2.slamChance ? Shared.randomOf(beside) : null;
    if (!under.length && !slammed) return false;
    if (under.length) this.verzik.forceChat("There's nothing under there for you!");
    this.animate(ANIMATION.P2_BOUNCE);
    for (const player of under) this.bounce(player, this.damages.stomp);
    if (slammed) this.bounce(slammed, this.damages.slam);
    return true;
  }

  animate(id) {
    const { Animation } = Shared.core();
    this.verzik.performAnimation(new Animation(id));
    for (const [sound, delay] of ANIMATION_SOUNDS[id] ?? []) Shared.areaSound(this.area, this.verzik, sound, delay);
  }

  /** Stunned, hurt and thrown back three tiles. */
  bounce(player, max) {
    const { Animation } = Shared.core();
    this.raid.failTask("Attack, Step, Wait", `${Shared.displayName(player)} was bounced by Verzik Vitur.`);
    const centre = this.centre();
    player.getMovementQueue().reset();
    this.later(1, () => {
      this.stun(player, P2.stun);
      this.hurt(player, Shared.random(0, max), "body slam");
      const from = Shared.tileOf(player);
      const dx = Math.sign(from.x - centre.x);
      const dy = Math.sign(from.y - centre.y) || (dx === 0 ? -1 : 0);
      const to = { x: from.x + dx * P2.knockback, y: from.y + dy * P2.knockback, z: 0 };
      player.performAnimation(new Animation(ANIMATION.KNOCKBACK));
      if (inArena(to) && Shared.floorFree(this.area, to)) this.later(1, () => player.moveTo(Shared.loc(to)));
    });
  }

  /** Urns at everyone's tiles; whoever's still there is hit. Hard: each leaves a pool. */
  urns() {
    this.animate(ANIMATION.P2_ATTACK);
    for (const player of this.fighters()) {
      const tile = Shared.tileOf(player);
      const ticks = Shared.projectile(this.area, this.verzik, tile, GRAPHIC.URN, PROJECTILE.URN);
      this.later(ticks, () => {
        Shared.graphicAt(this.area, GRAPHIC.URN_LAND, tile);
        Shared.areaSound(this.area, tile, SOUND.URN_LAND);
        if (this.raid.isHard && this.phase === 2) this.placePool(tile);
        if (!this.fighters().includes(player) || key(Shared.tileOf(player)) !== key(tile)) return;
        const damage = Shared.random(0, this.damages.urn);
        this.hurt(player, Shared.isProtected(player, "ranged") ? Math.floor(damage * P2.urnPrayer) : damage, "urn");
      });
    }
  }

  placePool(tile) {
    const old = this.pools.get(key(tile));
    if (old) this.removePool(old);
    const pool = { tile, object: this.placeObject(OBJECT.POOL, tile, 10, 0), until: this.ticks + POOL.lasts };
    this.pools.set(key(tile), pool);
  }

  removePool(pool) {
    this.pools.delete(key(pool.tile));
    Shared.core().ObjectManager.deregister(pool.object, true);
    this.objects = this.objects.filter((object) => object !== pool.object);
  }

  clearPools() {
    for (const pool of [...this.pools.values()]) this.removePool(pool);
  }

  /** Wiki: standing in a pool hurts every tick and poisons. */
  tickPools() {
    if (this.pools.size === 0) return;
    const { CombatFactory } = Shared.core();
    for (const pool of [...this.pools.values()]) {
      if (this.ticks >= pool.until) this.removePool(pool);
    }
    for (const player of this.fighters()) {
      if (!this.pools.has(key(Shared.tileOf(player)))) continue;
      this.hurt(player, Shared.random(...POOL.damage), "pool of poison", "GREEN");
      CombatFactory.poisonEntity(player, POOL.poison);
    }
  }

  /** A lightning ball hopping through the team in a random order; Verzik takes it if she's in the way. */
  lightning() {
    const order = Shared.shuffle(this.fighters());
    if (order.length === 0) return;
    this.animate(ANIMATION.P2_ATTACK);
    Shared.areaSound(this.area, this.verzik, SOUND.LIGHTNING, PROJECTILE.LIGHTNING.delay);
    this.sendLightning(this.verzik, order[0], 1, order);
  }

  sendLightning(from, to, index, order) {
    const ticks = Shared.projectile(this.area, from, to, GRAPHIC.LIGHTNING, from === this.verzik ? PROJECTILE.LIGHTNING : PROJECTILE.LIGHTNING_BOUNCE);
    this.later(ticks, () => {
      if (this.phase !== 2 || this.transition || !this.fighters().includes(to)) return;
      Shared.areaSound(this.area, to, SOUND.LIGHTNING_HIT);
      Shared.areaSound(this.area, to, SOUND.LIGHTNING_HIT_2);
      const next = order.slice(index).find((player) => this.fighters().includes(player));
      if (!next || index >= P2.lightningHops) {
        const damage = Shared.random(...this.damages.lightningLast);
        this.hurt(to, wearing(to, Shared.core().ItemIdentifiers.INSULATED_BOOTS) ? Math.min(this.damages.insulated, damage) : damage, "lightning");
        return;
      }
      this.hurt(to, Shared.random(...this.damages.lightning), "lightning");
      if (this.verzikBetween(Shared.tileOf(to), Shared.tileOf(next))) {
        const into = Shared.projectile(this.area, to, this.verzik, GRAPHIC.LIGHTNING, PROJECTILE.LIGHTNING_INTO_HER);
        this.later(into, () => {
          if (this.phase === 2 && !this.transition) Shared.damage(this.verzik, Shared.random(...P2.lightningHer));
        });
        return;
      }
      this.sendLightning(to, next, order.indexOf(next) + 1, order);
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
    Shared.areaSound(this.area, this.verzik, SOUND.PURPLE, PROJECTILE.PURPLE.delay);
    this.later(ticks, () => {
      if (this.phase !== 2 || this.transition) return;
      if (this.fighters().includes(target) && key(Shared.tileOf(target)) === key(tile)) this.hurt(target, Shared.random(0, this.damages.purple), "purple ball");
      Shared.graphicAt(this.area, GRAPHIC.ATHANATOS_LAND, tile);
      Shared.areaSound(this.area, tile, SOUND.ATHANATOS_LAND);
      Shared.areaSound(this.area, tile, SOUND.ATHANATOS_LAND_2);
      const athanatos = this.spawn(this.ids.ATHANATOS, { x: tile.x - 1, y: tile.y - 1, z: 0 }, { scale: false, scripted: true });
      if (!athanatos) return;
      const { Animation } = Shared.core();
      athanatos.performAnimation(new Animation(ANIMATION.ATHANATOS_SPAWN));
      athanatos.setMobileInteraction(this.verzik);
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
        npc.performGraphic(Shared.gfx(GRAPHIC.ATHANATOS_POISONED, { height: 64 }));
      }
      return;
    }
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
    attacker.sendMessage("You can only damage the Nylocas Athanatos with poisoned weapons.");
    attacker.getCombat().reset();
  }

  /** One nylocas per player, from the room's spawn points, chasing them. */
  callNylocas() {
    this.fighters().forEach((player, index) => {
      const style = Shared.randomOf(NYLO.order);
      const nylo = this.spawn(this.ids.NYLOS[style], NYLO_TILES[index % NYLO_TILES.length], { scale: false, scripted: true });
      if (!nylo) return;
      nylo.__verzikNylo = { style, target: player, age: 0 };
      this.minions.add(nylo);
    });
  }

  /** Captured: the wrong style bounces off. */
  onlyStyle(npc, hit, style) {
    const hitStyle = styleOf(hit);
    if (!hitStyle || hitStyle === style) return;
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
    hit.getAttacker?.()?.sendMessage?.("Your attack is absorbed by the nylocas and bounced right off!");
  }

  /** Blood: on everyone round its target; prayer halves it (Mod Ash); she heals half the total. */
  bloodSpell() {
    const target = Shared.randomOf(this.fighters());
    if (!target) return;
    this.animate(ANIMATION.P2_ATTACK);
    Shared.areaSound(this.area, this.verzik, SOUND.BLOOD, PROJECTILE.BLOOD.delay);
    const ticks = Shared.projectile(this.area, this.verzik, target, GRAPHIC.BLOOD, PROJECTILE.BLOOD);
    const prayed = new Set(this.fighters().filter((player) => Shared.isProtected(player, "magic")));
    this.later(ticks, () => {
      if (this.phase !== 2 || this.transition) return;
      const centre = target.getLocation();
      let total = 0;
      for (const player of this.fighters()) {
        if (Shared.distanceTo(player, centre) > P2.bloodReach) continue;
        const damage = Shared.random(0, this.damages.blood);
        const dealt = prayed.has(player) ? Math.floor(damage / 2) : damage;
        if (dealt <= 0) continue;
        player.performGraphic(Shared.gfx(GRAPHIC.BLOOD_LAND));
        this.hurt(player, dealt, "blood spell");
        total += dealt;
      }
      Shared.heal(this.verzik, Math.floor(total / 2));
    });
  }

  /** Two Matomenos (one with a single player left); she absorbs what's left of the last ones. */
  callMatomenos() {
    this.animate(ANIMATION.P2_HEAL);
    this.shieldUntil = Shared.cycle() + P2.shieldTicks;
    this.nextMatomenos = this.ticks + P2.matomenosEvery;
    this.nextAttack = this.ticks + P2.afterMatomenos;
    for (const old of this.matomenos) {
      if (old.isRegistered() && old.getHitpoints() > 0) this.absorb(old);
      this.minions.delete(old);
      this.despawn(old);
    }
    const count = this.fighters().length > 1 ? 2 : 1;
    const { Animation } = Shared.core();
    this.matomenos = MATOMENOS_TILES.slice(0, count).map((tile) => this.spawn(this.ids.MATOMENOS, tile, { scale: !this.raid.isEntry, scripted: true })).filter(Boolean);
    for (const nylo of this.matomenos) {
      nylo.performAnimation(new Animation(ANIMATION.MATOMENOS_SPAWN));
      nylo.__matomenos = true;
      this.minions.add(nylo);
    }
  }

  /** She heals what it had left; on Hard it also blows up at whoever's near. */
  absorb(nylo) {
    const left = nylo.getHitpoints();
    Shared.heal(this.verzik, left);
    if (!this.raid.isHard) return;
    for (const player of this.fighters()) {
      if (Shared.distanceTo(nylo, player.getLocation()) <= MATOMENOS_BLAST.reach) this.hurt(player, Math.floor(left * MATOMENOS_BLAST.share), "exploding Matomenos");
    }
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
      else if (minion.__matomenos) this.tickMatomenos(minion);
    }
  }

  /** Captured: they walk at the nearest player. */
  tickMatomenos(nylo) {
    const target = this.nearestFighter(nylo);
    if (target) this.walkAt(nylo, target);
  }

  nearestFighter(actor) {
    let best = null;
    let distance = Infinity;
    for (const player of this.fighters()) {
      const away = Shared.distanceTo(actor, player.getLocation());
      if (away < distance) {
        best = player;
        distance = away;
      }
    }
    return best;
  }

  walkAt(npc, target) {
    if (Shared.frozen(npc)) return;
    const tile = Shared.tileOf(target);
    Shared.core().PathFinder.calculateWalkRoute(npc, tile.x, tile.y);
    npc.setMobileInteraction(target);
  }

  tickNylo(nylo) {
    const state = nylo.__verzikNylo;
    state.age++;
    if (this.raid.isHard && state.age % NYLO.styleEvery === 0) {
      state.style = NYLO.order[(NYLO.order.indexOf(state.style) + 1) % NYLO.order.length];
      nylo.setNpcTransformationId(this.ids.NYLOS[state.style]);
    }
    if (Shared.frozen(nylo)) {
      this.raid.failTask("Pop It", "A Nylocas was frozen.");
      return;
    }
    if (!this.fighters().includes(state.target)) state.target = this.nearestFighter(nylo);
    const target = state.target;
    const near = target && Shared.distanceTo(nylo, target.getLocation()) <= 1;
    if (near) {
      this.raid.failTask("Nylo Sniper", `${Shared.displayName(target)} got too close to a Nylocas.`);
      this.explodeNylo(nylo);
      return;
    }
    if (!this.raid.isHard && state.age >= NYLO.fuse) {
      this.explodeNylo(nylo);
      return;
    }
    if (target) this.walkAt(nylo, target);
  }

  /** Captured: the damage comes with the animation, and it's gone 3 ticks later. */
  explodeNylo(nylo) {
    const { Animation } = Shared.core();
    this.minions.delete(nylo);
    nylo.performAnimation(new Animation(ANIMATION.NYLO_EXPLODE[nylo.__verzikNylo.style]));
    nylo.getMovementQueue().reset();
    for (const player of this.fighters()) {
      const damage = this.damages.nylo[Math.max(0, Shared.distanceTo(nylo, player.getLocation()) - 1)] ?? 0;
      if (damage <= 0) continue;
      this.raid.failTask("Pop It", `${Shared.displayName(player)} was hit by one of Verzik Vitur's exploding Nylocas.`);
      this.hurt(player, damage, "exploding Nylocas");
    }
    this.later(NYLO.gone, () => {
      if (nylo.isRegistered()) this.despawn(nylo);
    });
  }

  tickAthanatos(npc) {
    const state = npc.__athanatos;
    state.age++;
    if ((state.age - ATHANATOS.firstAt) % ATHANATOS.every !== 0 || this.transition) return;
    const poisoned = state.poisoned;
    const delay = Shared.random(0, GLOBULE.maxDelay);
    const ticks = Shared.projectile(this.area, npc, this.verzik, poisoned ? GRAPHIC.ATHANATOS_POISON : GRAPHIC.ATHANATOS_HEAL,
      { ...GLOBULE, delay, duration: GLOBULE.lands - delay, perTile: 0 });
    if (poisoned) {
      this.minions.delete(npc);
      Shared.graphicAt(this.area, GRAPHIC.ATHANATOS_BURST, npc.getLocation(), { height: 10 });
      Shared.areaSound(this.area, npc, SOUND.POISON_BURST);
      Shared.areaSound(this.area, npc, SOUND.POISON_BURST_2, 20);
      this.later(ticks, () => Shared.damage(this.verzik, Shared.random(...this.damages.poison), "GREEN"));
      npc.setHitpoints(0);
      return;
    }
    Shared.areaSound(this.area, npc, SOUND.GLOBULE);
    this.later(ticks, () => Shared.heal(this.verzik, Shared.random(...this.damages.heal)));
  }

  // -------------------------------------------------------------- phase 3

  toPhase3() {
    const npc = this.verzik;
    this.transition = true;
    this.phase = 3;
    for (const old of this.matomenos ?? []) {
      this.minions.delete(old);
      this.despawn(old);
    }
    this.matomenos = [];
    for (const minion of [...this.minions]) {
      if (!minion.__athanatos) continue;
      this.minions.delete(minion);
      this.despawn(minion);
    }
    this.clearPools();
    if (this.raid.taskLive("Attack, Step, Wait")) this.raid.completeTask("Attack, Step, Wait");
    npc.getMovementQueue().reset();
    this.animate(ANIMATION.P2_DEATH);
    this.raid.refreshHealthBars();
    // Captured (101, 1852): her next form 2 ticks on, her true one 4 after, her first attack 6 after.
    this.later(2, () => {
      npc.setNpcTransformationId(this.ids.TO_PHASE3);
      npc.moveTo(Shared.loc(PHASE3_TILE));
      this.animate(ANIMATION.P3_SPAWN);
      this.later(4, () => {
        npc.setNpcTransformationId(this.ids.PHASE3);
        this.setPhaseHitpoints(2);
        npc.forceChat("Behold my true nature!");
        this.ticks = 0;
        this.attacks = 0;
        this.special = 0;
        this.nextAttack = P3.firstAttack;
        this.busyUntil = 0;
        this.awayFor = 0;
        this.immune = false;
        this.enraged = false;
        this.lastStood = false;
        this.webWalk = null;
        this.transition = false;
        npc.getMovementQueue().setBlockMovement(false);
        this.raid.refreshHealthBars();
      });
    });
  }

  tickPhase3() {
    const npc = this.verzik;
    const share = npc.getHitpoints() / Math.max(1, npc.getMaxHitpoints());
    if (this.raid.isHard && !this.lastStood && share <= P3.lastStandBelow) {
      this.lastStood = true;
      npc.forceChat("You think this is over?!");
      Shared.heal(npc, Math.floor(npc.getMaxHitpoints() * P3.lastStandHeal));
    }
    if (!this.enraged && share <= P3.enrageBelow) {
      this.enraged = true;
      this.nextAttack = Math.max(this.nextAttack, this.ticks + P3.enraged);
      npc.forceChat("I'm not finished with you just yet!");
      for (const player of this.fighters()) this.sendTornado(player);
    }
    if (this.webWalk) {
      this.tickWebWalk();
      return;
    }
    if (this.ticks < this.busyUntil) return;
    const fighters = this.fighters();
    if (fighters.length === 0) return;
    this.pickTarget(fighters);
    this.chase(this.target);
    if (this.ticks < this.nextAttack) return;
    const pace = this.enraged ? P3.enraged : P3.every;
    this.nextAttack = this.ticks + pace;
    if (this.attacks === P3.specialEvery) {
      this.attacks = 0;
      if (this.raid.isHard) this.target = Shared.randomOf(fighters.filter((player) => player !== this.target)) ?? this.target;
      const special = SPECIALS[this.special++ % SPECIALS.length];
      this[`special_${special}`]();
      // Captured: the nylocas come with an ordinary attack, one that doesn't count towards the next special.
      if (special === "nylocas") this.autoAttack(this.target);
      return;
    }
    this.attacks++;
    this.autoAttack(this.target);
  }

  /** The same target until they've been out of her reach too long, or they're gone. */
  pickTarget(fighters) {
    if (!this.target || !fighters.includes(this.target)) {
      this.target = Shared.randomOf(fighters);
      this.awayFor = 0;
    }
    if (Shared.distanceTo(this.verzik, this.target.getLocation()) <= 1) {
      this.awayFor = 0;
    } else if (++this.awayFor > P3.retargetAfter) {
      this.target = Shared.randomOf(fighters.filter((player) => player !== this.target)) ?? this.target;
      this.awayFor = 0;
    }
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
        if (Shared.distanceTo(npc, player.getLocation()) !== 1) continue;
        const hit = this.strike(npc, player, "melee", this.damages.melee, 1, { prayable: false, accurate: true });
        if (hit.getTotalDamage() > 0) this.failPerfect(player, "melee attack");
      }
      return;
    }
    const style = Math.random() < 0.5 ? "magic" : "ranged";
    const max = this.enraged ? this.damages.enraged : this.damages[style];
    this.animate(style === "magic" ? ANIMATION.P3_MAGIC : ANIMATION.P3_RANGED);
    for (const player of fighters) {
      const ticks = style === "magic"
        ? Shared.projectile(this.area, npc, player, GRAPHIC.P3_MAGIC, PROJECTILE.P3_MAGIC)
        : Shared.projectile(this.area, npc, player, GRAPHIC.P3_RANGED, PROJECTILE.P3_RANGED);
      // Wiki (2 August 2018): the damage is worked out as it lands.
      this.later(Math.max(0, ticks - 1), () => {
        if (this.phase !== 3 || !this.fighters().includes(player)) return;
        const hit = this.strike(npc, player, style, max, 1, { prayerMultiplier: P3.prayer });
        if (!Shared.isProtected(player, style) && hit.getTotalDamage() > 0) this.failPerfect(player, `${style} attack`);
      });
    }
  }

  failPerfect(player, attack) {
    this.raid.failTask("Perfect Verzik", `${Shared.displayName(player)} was hit by Verzik Vitur's ${attack}.`);
  }

  special_nylocas() {
    this.callNylocas();
  }

  /** To the middle, immune on the way; then players beside her thrown back, and webs spun at the team. */
  special_webs() {
    this.immune = true;
    this.webWalk = { started: this.ticks };
    Shared.walkStraight(this.verzik, WEB_CENTRE);
  }

  tickWebWalk() {
    const npc = this.verzik;
    const there = key(Shared.tileOf(npc)) === key(WEB_CENTRE);
    if (!there && this.ticks - this.webWalk.started < WEBS.walkAtMost) return;
    if (!there) npc.moveTo(Shared.loc(WEB_CENTRE));
    this.webWalk = null;
    this.immune = false;
    this.spinWebs();
  }

  spinWebs() {
    const npc = this.verzik;
    const { Animation } = Shared.core();
    npc.getMovementQueue().reset();
    npc.getMovementQueue().setBlockMovement(true);
    this.busyUntil = this.ticks + WEBS.next;
    this.nextAttack = this.busyUntil;
    const centre = this.centre();
    for (const player of this.fighters()) {
      if (Shared.distanceTo(npc, player.getLocation()) > WEBS.knockedWithin) continue;
      const from = Shared.tileOf(player);
      const to = { x: from.x + Math.sign(from.x - centre.x) * WEBS.knockback, y: from.y + Math.sign(from.y - centre.y) * WEBS.knockback, z: 0 };
      player.performAnimation(new Animation(ANIMATION.KNOCKBACK));
      if (inArena(to) && Shared.floorFree(this.area, to)) player.moveTo(Shared.loc(to));
    }
    this.animate(ANIMATION.P3_WEBS);
    const players = this.fighters();
    for (let i = 0; i < WEBS.ticks && players.length; i++) {
      this.later(WEBS.startsAfter + i, () => {
        const target = players[Math.floor(i / 3) % players.length];
        if (!this.fighters().includes(target)) return;
        const end = Shared.tileOf(target);
        this.shootWeb(end);
        for (let extra = 1; extra < WEBS.perTick; extra++) {
          this.shootWeb({ x: end.x + Shared.random(-3, 3), y: end.y + Shared.random(-3, 3), z: 0 });
        }
      });
    }
    this.later(WEBS.next, () => {
      npc.getMovementQueue().setBlockMovement(false);
      this.target = Shared.randomOf(this.fighters().filter((player) => player !== this.target)) ?? this.target;
    });
  }

  shootWeb(tile) {
    if (!inArena(tile) || this.webs.has(key(tile)) || !Shared.floorFree(this.area, tile) || Shared.covers(this.verzik, tile)) return;
    this.webs.set(key(tile), null);
    const ticks = Shared.projectile(this.area, this.verzik, tile, GRAPHIC.WEB, { ...PROJECTILE.WEB, delay: Shared.random(0, WEB_MAX_DELAY) });
    this.later(ticks, () => {
      if (this.phase !== 3 || this.transition) {
        this.webs.delete(key(tile));
        return;
      }
      const object = this.placeObject(OBJECT.WEB, tile, 10, Shared.random(0, 3));
      const npc = this.spawn(this.ids.WEB, tile, { scale: false, scripted: true });
      this.webs.set(key(tile), { tile, object, npc, age: ticks, stuck: new Set() });
    });
  }

  /** Stepping on a web holds the player; attacking it frees them, and it bursts when its time is up. */
  tickWebs() {
    const { TimerKey, ItemIdentifiers } = Shared.core();
    for (const web of [...this.webs.values()]) {
      if (!web) continue;
      web.age++;
      const onIt = this.fighters().filter((player) => key(Shared.tileOf(player)) === key(web.tile));
      if (!web.npc?.isRegistered() || web.npc.getHitpoints() <= 0) {
        for (const player of web.stuck) this.freeFromWeb(player, "You slash the web apart.");
        this.removeWeb(web);
        continue;
      }
      for (const player of onIt) {
        if (web.stuck.has(player)) continue;
        if (wearing(player, ItemIdentifiers.ARANEA_BOOTS) && this.ticks >= (player.__verzikAraneaAt ?? 0)) {
          player.__verzikAraneaAt = this.ticks + WEBS.araneaEvery;
          player.sendMessage("Your Aranea boots let you avoid the spider-based attack.");
          continue;
        }
        web.stuck.add(player);
        player.getMovementQueue().reset();
        player.getTimers().registers(TimerKey.FREEZE, WEBS.freeze);
        player.sendMessage("The sticky web grips your ankles.");
      }
      if (web.age < WEBS.lasts) continue;
      for (const player of web.stuck) {
        if (!this.fighters().includes(player)) continue;
        this.freeFromWeb(player, "The webs grate against your skin as they snap against your ankles.");
        this.hurt(player, Shared.random(0, this.damages.webs), "web");
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
    this.objects = this.objects.filter((object) => object !== web.object);
    this.despawn(web.npc);
  }

  /** Safe spots: one player per spot per strike; everyone else takes the blast. Hard: three strikes. */
  special_dots() {
    const npc = this.verzik;
    const mode = this.raid.isHard ? "hard" : "normal";
    const strikes = DOTS.strikes[mode];
    this.busyUntil = this.ticks + DOTS.next[mode];
    this.nextAttack = this.busyUntil;
    this.immune = true;
    npc.getMovementQueue().reset();
    this.animate(ANIMATION.P3_DOTS);
    const fighters = this.fighters();
    const spots = this.pickSpots(fighters.length * DOTS.spotsPerPlayer[mode]);
    const window = { enraged: this.enraged, hurt: false, players: fighters.length };
    this.dotsWindow = window;
    const lastStrike = strikes[strikes.length - 1];
    for (const shownAt of DOTS.shownAt) {
      if (shownAt >= lastStrike) break;
      this.later(shownAt, () => spots.forEach((spot) => Shared.graphicAt(this.area, GRAPHIC.DOT, spot)));
    }
    for (const player of fighters) {
      for (const strike of strikes) {
        Shared.projectile(this.area, npc, player, GRAPHIC.DOT_BLAST, { ...PROJECTILE.DOT_BLAST, duration: PROJECTILE.DOT_BLAST.duration + DOTS.extraFlight[strike] });
      }
    }
    for (const strike of strikes) {
      this.later(strike, () => {
        if (this.phase !== 3) return;
        this.strikeSpots(spots, window);
        if (strike !== lastStrike) return;
        this.immune = false;
        this.dotsWindow = null;
        if (window.enraged && !window.hurt && this.fighters().length >= 2) this.raid.completeTask("Team Work Makes the Dream Work");
      });
    }
  }

  pickSpots(count) {
    const spots = [];
    for (let tries = 0; tries < count * 16 && spots.length < count; tries++) {
      const tile = { x: Shared.random(ARENA.minX, ARENA.maxX), y: Shared.random(ARENA.minY, ARENA.maxY), z: 0 };
      if (!Shared.covers(this.verzik, tile) && Shared.floorFree(this.area, tile) && !spots.some((spot) => key(spot) === key(tile))) spots.push(tile);
    }
    return spots;
  }

  /** A spot holds one player and is used up by that strike; two on one spot both take it. */
  strikeSpots(spots, window) {
    const safe = new Set();
    for (const spot of [...spots]) {
      const standing = this.fighters().filter((player) => key(Shared.tileOf(player)) === key(spot));
      if (standing.length !== 1) continue;
      safe.add(standing[0]);
      spots.splice(spots.indexOf(spot), 1);
    }
    for (const player of this.fighters()) {
      if (safe.has(player)) {
        player.performGraphic(Shared.gfx(GRAPHIC.DOT_SAFE));
        player.sendMessage("The power resonating here protects you from the blast.");
      } else {
        window.hurt = true;
        player.performGraphic(Shared.gfx(GRAPHIC.BLAST_HIT, { height: 96 }));
        this.hurt(player, this.damages.dots, "power blast");
      }
    }
  }

  /** The green ball goes to whoever's beside its target, until it has been passed on enough. */
  special_green() {
    const first = Shared.randomOf(this.fighters());
    if (!first) return;
    this.busyUntil = 0;
    this.nextAttack = this.ticks + GREEN.next;
    this.animate(ANIMATION.P3_RANGED);
    first.sendMessage("<col=0a721f>Verzik Vitur fires a powerful projectile in your direction...</col>");
    this.bounceGreen(this.verzik, first, { passes: 0, visited: new Set(), lethal: this.raid.isHard && this.fighters().length >= 2 });
  }

  bounceGreen(from, target, ball) {
    const ticks = Shared.projectile(this.area, from, target, GRAPHIC.GREEN_BALL, from === this.verzik ? PROJECTILE.GREEN_BALL : PROJECTILE.GREEN_PASSED);
    this.later(ticks, () => {
      if (this.phase !== 3 || !this.fighters().includes(target)) return;
      Shared.areaSound(this.area, target, SOUND.GREEN_LAND);
      ball.visited.add(target);
      const beside = this.fighters().filter((player) => player !== target && Shared.distanceTo(player, target.getLocation()) <= GREEN.near);
      const next = beside.find((player) => !ball.visited.has(player));
      if (next && ball.passes < GREEN.passes) {
        ball.passes++;
        this.raid.completeTask("Pass It On", [target]);
        this.bounceGreen(target, next, ball);
        return;
      }
      if (ball.passes >= GREEN.passes && !ball.lethal) return;
      this.greenLands(target, ball);
      // Wiki: passed back to someone it has already been to, the sender takes it too.
      if (beside.length && ball.passes < GREEN.passes && !next) this.greenLands(beside[0], ball);
    });
  }

  greenLands(player, ball) {
    const { Skill } = Shared.core();
    player.performGraphic(Shared.gfx(GRAPHIC.BLAST_HIT, { height: 96 }));
    if (ball.lethal) {
      this.hurt(player, ball.passes === 0 ? player.getHitpoints() : GREEN.hard[ball.passes], "green ball");
      return;
    }
    const level = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
    this.hurt(player, Shared.random(1, Math.floor(level * GREEN.share)), "green ball");
  }

  /** Below 20%: a tornado after each player. */
  sendTornado(player) {
    const from = Shared.tileOf(player);
    for (let tries = 0; tries < 32; tries++) {
      const tile = { x: from.x + Shared.random(-TORNADO.reachesWithin, TORNADO.reachesWithin), y: from.y + Shared.random(-TORNADO.reachesWithin, TORNADO.reachesWithin), z: 0 };
      const distance = Math.max(Math.abs(tile.x - from.x), Math.abs(tile.y - from.y));
      if (distance < TORNADO.atLeast || !inArena(tile) || !Shared.floorFree(this.area, tile)) continue;
      const tornado = this.spawn(this.ids.TORNADO, tile, { scale: false, scripted: true });
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
      Shared.areaSound(this.area, target, SOUND.TORNADO_HIT);
      const damage = Math.max(TORNADO.min, Math.floor(target.getHitpoints() / 2));
      this.hurt(target, damage, "tornado");
      if (this.dotsWindow) this.dotsWindow.hurt = true;
      Shared.heal(this.verzik, damage * TORNADO.heal);
      target.sendMessage("Verzik Vitur saps your health and powers up!");
      this.later(TORNADO.respawn, () => {
        if (this.phase === 3 && this.isStarted() && !this.transition) this.sendTornado(target);
      });
      return;
    }
    const at = Shared.tileOf(target);
    Shared.walkStraight(tornado, at);
  }

  // -------------------------------------------------------------- the end

  /** Captured: her animation, the dead form 2 ticks on (2 tiles in), the room won 8 ticks on. */
  die() {
    const npc = this.verzik;
    this.transition = true;
    this.immune = false;
    this.webWalk = null;
    npc.getMovementQueue().reset();
    npc.getMovementQueue().setBlockMovement(true);
    for (const minion of [...this.minions]) this.despawn(minion);
    this.minions.clear();
    this.animate(ANIMATION.P3_DEATH);
    this.raid.refreshHealthBars();
    this.later(2, () => {
      const tile = Shared.tileOf(npc);
      npc.setNpcTransformationId(this.ids.DEAD);
      npc.moveTo(Shared.loc({ x: tile.x + 2, y: tile.y + 2, z: 0 }));
      this.later(6, () => {
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

/** Who's wielding, for the Dawnbringer's plain spell. */
function wielding(player, id) {
  if (!player?.isPlayer?.()) return false;
  const { Equipment } = Shared.core();
  return player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId() === id;
}

function wearing(player, id) {
  const { Equipment } = Shared.core();
  return player.getEquipment().getItems()[Equipment.FEET_SLOT]?.getId() === id;
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

/** A poisoned melee weapon, or poisoned ammunition (or thrown weapon) for ranged. */
function poisonedWeapon(player, style) {
  const { CombatPoisonData, Equipment } = Shared.core();
  const equipment = player.getEquipment();
  const weapon = equipment.getItems()[Equipment.WEAPON_SLOT];
  if (CombatPoisonData.getPoisonType(weapon)) return true;
  return style === "ranged" && !!CombatPoisonData.getPoisonType(equipment.getItems()[Equipment.AMMUNITION_SLOT]);
}

function roomOf(player) {
  if (!player?.isPlayer?.()) return null;
  const raid = Raid.raidOf(player);
  const room = raid?.room;
  return room instanceof VerzikRoom && raid.member(player).roomKey === room.key ? room : null;
}

/**
 * Talk-to on her waiting form. Taken by the NPC itself: in Normal and Hard Mode that form's own
 * name is null, and the name and option come from the form varp 1748 or 3057 picks in the client.
 */
function talkToVerzik(event) {
  const room = roomOf(event.player);
  if (!room || event.handled || event.npc !== room.verzik || room.phase !== 0) return;
  room.talk(event.player);
  event.handled = true;
}

/** The Dawnbringer's special works only on Verzik's shield. */
function allowDawnbringer(event) {
  if (event.specialId !== "dawnbringer") return;
  const room = roomOf(event.attacker);
  if (room && room.phase === 1 && event.target === room.verzik) event.allow = true;
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
  api.onBeforeNpcInteraction(talkToVerzik);
  api.onCustomEvent("combat-special:can-use", allowDawnbringer);
  Shared.onObject(api, OBJECT.SKELETON, searchSkeleton);
};

Object.assign(module.exports, { VerzikRoom, PILLARS, NPC_BY_MODE, DAWNBRINGER, poisonedWeapon });
