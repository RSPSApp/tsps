"use strict";

/**
 * Wave 12: Sol Heredit.
 *
 * Wiki (Sol Heredit; "Fortis Colosseum/Strategies", Sol Heredit):
 * - Phases at 1350, 1125, 750, 375 and 150 HP, each announced. A transition marks 6 tiles in
 *   the 9x9 around the player (one the player's own) with a beam of light that leaves molten
 *   sand 2 ticks later, and adds a light crystal (four at most). At 150 (enraged) it is 5
 *   tiles, then one more every 3 ticks, and the crystals fire about every 7 seconds.
 * - His AOE attacks need him beside the player and deal up to 44 typeless damage to a player
 *   standing in them. He can't move for 4 ticks from one. A second Spear or Shield in a row uses
 *   the second pattern; a different attack resets it, as does a special; he opens every phase
 *   with a Spear. Spears are 7-tick attacks and Shields 6, a tick faster from 75%.
 * - Triple attack (below 90%): hits 3, 6 and 9 ticks after it starts (the last at 10 from 50%)
 *   for 15/25/35 (15/30/45 from 50%) unless Protect from Melee is on as it lands. A protection
 *   prayer already on in the 2 ticks before a hit is turned off and the hit lands.
 * - Grapple (below 75%): he calls a slot; clicking the worn item there within 4 ticks defends
 *   it, and on the last tick it is a perfect parry: the player's next attack within 5 ticks
 *   is a max hit. Otherwise up to 45 damage and the item is torn off into the inventory.
 * - Crystals patrol the arena's edge and periodically charge a beam across it, firing 3 ticks
 *   later (2 when enraged) for up to 75 to a player in its path.
 * - With Totemic, a totem heals him 75 every 7 ticks.
 * Transcript (npc-dialogues.json): every line he says.
 * RuneLite (gameval): his and the crystal's animations and graphics.
 * Offline_Scape: the attack pool and its 2-attack special cooldown, attack timings it
 * measured (triple 12/11 ticks, grapple and transitions 7), the crystals' patrols, the 25-35
 * tick laser cooldown, his landing tile and the player's. RSPS-only facts are marked there in
 * docs/fortis-colosseum.md.
 */

const Shared = require("./ColosseumShared");
const Patterns = require("./SolPatterns");
const Hazards = require("./ColosseumHazards");
const Effects = require("./ModifierEffects.Colosseum");
const DIALOGUES = require("../../../data/definitions/npc-dialogues.json")["Sol Heredit"].variants;

const SOL = 12821;
const CRYSTAL = 12824;
const LANDING = { x: 1823, y: 3108 };
const PLAYER_START = { x: 1825, y: 3103 };
const BARRICADE_LOCS = [50753, 50754, 50755, 50756, 50757, 50758];

const ANIM = {
  jump: 10876, land: 10877, spear: 10883, grapple: 10884, shield: 10885, tripleLong: 10886, tripleShort: 10887,
  crystalSpawn: 10798, crystalCharge: 10801, crystalFire: 10802,
};
const GFX = { land: 2666, tripleLong: 2667, tripleShort: 2668, beam: 2698, smoke: [2669, 2670, 2671, 2672], crystalEnd: 2697 };

const PHASES = [
  { hp: 1500, variant: "standard-dialogue-during-the-fight-start-of-fight" },
  { hp: 1350, variant: "standard-dialogue-during-the-fight-upon-reaching-1350-hitpoints" },
  { hp: 1125, variant: "standard-dialogue-during-the-fight-upon-reaching-1125-hitpoints" },
  { hp: 750, variant: "standard-dialogue-during-the-fight-upon-reaching-750-hitpoints" },
  { hp: 375, variant: "standard-dialogue-during-the-fight-upon-reaching-375-hitpoints" },
  { hp: 150, variant: "standard-dialogue-during-the-fight-upon-reaching-150-hitpoints" },
];
const ENRAGED = 5;
const AOE = { max: 44, landsAfter: 2, frozen: 4 };
const SPEED = { spear: 7, shield: 6, tripleShort: 12, tripleLong: 12, grapple: 7, transition: 7 };
const SPECIAL_COOLDOWN = 2;
const TRIPLE = { early: [15, 25, 35], late: [15, 30, 45], hitsEarly: [3, 6, 9], hitsLate: [3, 6, 10] };
const GRAPPLE = { window: 4, frozen: 5, minDamage: 20, maxDamage: 45, maxHitTicks: 5 };
const SAND = { transition: 6, enraged: 5, enragedEvery: 3, landsAfter: 2 };
const LASER = { minCooldown: 25, maxCooldown: 35, enragedCooldown: 12, charge: 3, enragedCharge: 2, length: 14, min: 60, max: 75 };

/** The slots he grapples, what he calls out and what the messages name (transcript). */
const GRAPPLES = [
  { slot: "BODY_SLOT", line: "I'LL CRUSH YOUR BODY!", part: "body" },
  { slot: "CAPE_SLOT", line: "I'LL BREAK YOUR BACK!", part: "back" },
  { slot: "HANDS_SLOT", line: "I'LL TWIST YOUR HANDS OFF!", part: "hands" },
  { slot: "LEG_SLOT", line: "I'LL BREAK YOUR LEGS!", part: "legs" },
  { slot: "FEET_SLOT", line: "I'LL CUT YOUR FEET OFF!", part: "feet" },
];

/** Crystals by the order they come: the edge they patrol and the way they fire (Offline_Scape). */
const CRYSTALS = (() => {
  const { minX, maxX, minY, maxY } = Patterns.ARENA;
  return [
    { spawn: { x: minX + 1, y: maxY }, ends: [{ x: maxX - 1, y: maxY }, { x: minX + 1, y: maxY }], fire: "S", charge: 2689, attack: 2693 },
    { spawn: { x: maxX, y: minY + 2 }, ends: [{ x: maxX, y: maxY - 1 }, { x: maxX, y: minY + 1 }], fire: "W", charge: 2690, attack: 2694 },
    { spawn: { x: minX + 1, y: minY }, ends: [{ x: maxX - 1, y: minY }, { x: minX + 1, y: minY }], fire: "N", charge: 2691, attack: 2695 },
    { spawn: { x: minX, y: minY + 1 }, ends: [{ x: minX, y: maxY - 1 }, { x: minX, y: minY + 1 }], fire: "E", charge: 2692, attack: 2696 },
  ];
})();
const CRYSTAL_STEP_TICKS = 2;
const CRYSTAL_SPAWN_LOCK = 4;

const ATTR = { ATTEMPTS: "colosseum:sol-attempts", KILLS: "colosseum:sol-kills" };

function randomInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** One line of a transcript variant, choosing among its options when it has them. */
function line(variant) {
  const step = DIALOGUES[variant]?.[0];
  if (!step) return null;
  return step.type === "random" ? pick(step.options).steps[0].npc : step.npc;
}

function gfx(id, delay = 0, height = 0) {
  const { Graphic } = Shared.core();
  return Object.assign(new Graphic(id), { delay, height });
}

function tileOf(entity) {
  return { x: entity.getLocation().getX(), y: entity.getLocation().getY() };
}

function sameTile(a, b) {
  return a.x === b.x && a.y === b.y;
}

function cycle() {
  return Shared.core().World.getProcessCycle();
}

function say(fight, text) {
  if (text) fight.npc?.forceChat(text);
}

function fightOf(npc) {
  return npc?.__colosseumRun?.solFight?.npc === npc ? npc.__colosseumRun.solFight : null;
}

// ---------------------------------------------------------------- the start

/** Wave 12 starts: Sol's greeting for this attempt, then he jumps down. */
function begin(run) {
  const player = run.player;
  run.stage = "sol";
  const attempts = (Number(player.getAttribute(ATTR.ATTEMPTS)) || 0) + 1;
  player.setAttribute(ATTR.ATTEMPTS, attempts);
  if ((Number(player.getAttribute(ATTR.KILLS)) || 0) > 0) {
    jump(run);
    return;
  }
  const variant = attempts === 1 ? "standard-dialogue-first-attempt"
    : attempts === 2 ? "standard-dialogue-second-attempt"
      : attempts === 3 ? "standard-dialogue-third-attempt"
        : "standard-dialogue-subsequent-attempts-without-defeating-heredit";
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Shared.core();
  const lines = DIALOGUES[variant].filter((step) => step.npc);
  const chain = new DialogueChainBuilder();
  lines.forEach((step, index) => chain.add(new NpcDialogue(index, SOL, step.npc)));
  chain.add(new ActionDialogue(lines.length, { execute: () => jump(run) }));
  player.getDialogueManager().startDialogues(chain);
}

/** He leaps from his seat, the gladiators close the middle off, and he lands. */
function jump(run) {
  if (run.stage !== "sol") return;
  const { Animation } = Shared.core();
  run.stage = "sol-landing";
  run.sol?.performAnimation(new Animation(ANIM.jump));
  run.player.sendMessage("Sol Heredit jumps down from his seat...");
  Shared.fadeMove(run.player, () => land(run));
}

function land(run) {
  if (run.stage !== "sol-landing") return;
  const { Animation, GameObject, ObjectManager, TimerKey } = Shared.core();
  removeSeat(run);
  run.barricade = Patterns.barricade().map(({ x, y, rotation }) => {
    const object = new GameObject(pick(BARRICADE_LOCS), Shared.loc({ x, y }), 10, rotation, run.area);
    ObjectManager.register(object, true);
    return object;
  });
  run.player.moveTo(Shared.loc(PLAYER_START));
  const npc = run.spawnEnemy({ id: SOL, ...LANDING });
  if (!npc) return;
  npc.performAnimation(new Animation(ANIM.land));
  npc.performGraphic(gfx(GFX.land));
  npc.getTimers?.().registers(TimerKey.FREEZE, 3);
  run.solFight = {
    npc, phase: 0, forced: "spear", last: null, second: false, specialCooldown: 0,
    crystals: [], laserCooldown: LASER.minCooldown, enragedSandIn: SAND.enragedEvery, grapple: null,
    maxHitUntil: -1, triple: null,
  };
  say(run.solFight, line(PHASES[0].variant));
  run.stage = "wave";
  run.waveTicks = 0;
  Hazards.waveStarted(run);
}

function removeSeat(run) {
  const { GameObject, ObjectManager } = Shared.core();
  if (run.sol) {
    run.area.detach?.(run.sol);
    Shared.api().removeNpc(run.sol);
    run.sol = null;
  }
  ObjectManager.deregister(new GameObject(Shared.OBJECT.SOL_SEAT_BLOCKER, Shared.loc(Shared.SOL_SEAT), 10, 0, run.area), true);
}

// ---------------------------------------------------------------- his attacks

function hurtIfOn(run, tiles, max) {
  const at = tileOf(run.player);
  if (tiles.some((tile) => sameTile(tile, at))) run.hurt(randomInclusive(1, max + Effects.maxHitBonus(run)), "RED", true);
}

function smoke(run, tiles, delay) {
  const sender = run.player.getPacketSender();
  for (const tile of tiles) sender.sendGraphic(gfx(pick(GFX.smoke), delay + tile.ring * 2), Shared.loc(tile));
}

/** Spear or Shield: smoke over the pattern now, damage as it lands. */
function aoe(run, fight, style) {
  const { Animation, TimerKey } = Shared.core();
  const second = fight.last === style && !fight.second;
  fight.second = second;
  fight.last = style;
  const npc = fight.npc;
  npc.performAnimation(new Animation(style === "spear" ? ANIM.spear : ANIM.shield));
  npc.getTimers?.().registers(TimerKey.FREEZE, AOE.frozen);
  const sol = tileOf(npc);
  Shared.later(run, AOE.landsAfter, () => {
    if (run.stage !== "wave" || npc.getHitpoints() <= 0) return;
    const tiles = style === "spear" ? Patterns.spear(sol, tileOf(run.player), second) : Patterns.shield(sol, second);
    smoke(run, tiles, 0);
    hurtIfOn(run, tiles, AOE.max);
  });
  const faster = fight.phase >= 2 ? 1 : 0;
  return SPEED[style] - faster;
}

/** Three blows, each blocked only by Protect from Melee switched on as it lands. */
function triple(run, fight) {
  const { Animation, PrayerHandler } = Shared.core();
  const late = fight.phase >= 3;
  fight.npc.performAnimation(new Animation(late ? ANIM.tripleLong : ANIM.tripleShort));
  fight.npc.performGraphic(gfx(late ? GFX.tripleLong : GFX.tripleShort));
  const damage = late ? TRIPLE.late : TRIPLE.early;
  const hits = late ? TRIPLE.hitsLate : TRIPLE.hitsEarly;
  const player = run.player;
  const praying = () => PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MELEE);
  hits.forEach((at, index) => {
    const state = { early: false };
    for (const before of [at - 2, at - 1]) {
      Shared.later(run, before, () => {
        if (run.stage !== "wave" || !praying()) return;
        state.early = true;
        PrayerHandler.deactivatePrayer(player, PrayerHandler.PROTECT_FROM_MELEE);
        player.sendMessage(DIALOGUES["standard-dialogue-praying-early-against-the-triple-attack"][0].text);
      });
    }
    Shared.later(run, at, () => {
      if (run.stage !== "wave" || fight.npc.getHitpoints() <= 0) return;
      if (state.early || !praying()) run.hurt(damage[index] + Effects.maxHitBonus(run), "RED", true);
    });
  });
  fight.last = null;
  return late ? SPEED.tripleLong : SPEED.tripleShort - (fight.phase >= 2 ? 1 : 0);
}

function grapple(run, fight) {
  const { Animation, Equipment, TimerKey } = Shared.core();
  const choice = pick(GRAPPLES);
  fight.grapple = { ...choice, slot: Equipment[choice.slot], started: cycle(), clicked: null, clickedAt: -1 };
  say(fight, choice.line);
  fight.npc.performAnimation(new Animation(ANIM.grapple));
  fight.npc.getTimers?.().registers(TimerKey.FREEZE, GRAPPLE.frozen);
  Shared.later(run, GRAPPLE.window, () => resolveGrapple(run, fight));
  fight.last = null;
  return SPEED.grapple;
}

function resolveGrapple(run, fight) {
  const grip = fight.grapple;
  fight.grapple = null;
  if (!grip || run.stage !== "wave" || fight.npc.getHitpoints() <= 0) return;
  const player = run.player;
  if (grip.clicked === grip.slot) {
    if (grip.clickedAt >= grip.started + GRAPPLE.window) {
      player.sendMessage(DIALOGUES["standard-dialogue-grapple-attack-perfectly-parrying-the-grapple-attack"][0].text);
      fight.maxHitUntil = cycle() + GRAPPLE.maxHitTicks;
    } else {
      player.sendMessage(`You successfully defend your ${grip.part} from Sol Heredit's grapple!`);
    }
    return;
  }
  const item = player.getEquipment?.().getItems?.()[grip.slot];
  const worn = item && item.getId() >= 0;
  const name = worn ? item.getDefinition?.()?.getName?.() ?? grip.part : grip.part;
  run.hurt(randomInclusive(GRAPPLE.minDamage, GRAPPLE.maxDamage) + Effects.maxHitBonus(run), "RED", true);
  player.sendMessage(`Sol Heredit grabs hold of your ${name} and deals massive damage!`);
  if (worn) tearOff(player, grip.slot);
}

function tearOff(player, slot) {
  const { EquipPacketListener } = require("../../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
  EquipPacketListener.unequip(player, slot);
}

/** A slot clicked while he grapples: the item stays on, and the click is his answer. */
function defend(event) {
  const run = require("./ColosseumRun").runOf(event.player);
  const grip = run?.solFight?.grapple;
  if (!grip) return;
  event.allow = false;
  if (grip.clicked != null) return;
  grip.clicked = event.slot;
  grip.clickedAt = cycle();
  if (event.slot !== grip.slot) event.player.sendMessage(DIALOGUES["standard-dialogue-grapple-attack-defending-the-wrong-body-part"][0].text);
}

/** A perfect parry: the player's next blow within 5 ticks is a max hit. */
function parried(event) {
  const fight = fightOf(event.target);
  if (!fight || event.attacker !== event.target.__colosseumRun.player) return;
  if (cycle() > fight.maxHitUntil) return;
  fight.maxHitUntil = -1;
  event.forceAccurate = true;
  event.forceMaxHit = true;
}

/** The pool he picks from: Spears and Shields, and the specials once off cooldown (Offline_Scape). */
function nextAttack(fight) {
  if (fight.forced) return fight.forced;
  const pool = ["spear", "spear", "shield", "shield"];
  if (fight.specialCooldown <= 0) {
    if (fight.phase >= 1) pool.push("triple");
    if (fight.phase >= 2) pool.push("grapple");
  }
  return pick(pool);
}

function attack(npc) {
  const fight = fightOf(npc);
  const run = npc.__colosseumRun;
  if (!fight || run.stage !== "wave") return SPEED.spear;
  const choice = nextAttack(fight);
  fight.forced = null;
  if (choice === "spear" || choice === "shield") {
    fight.specialCooldown--;
    return aoe(run, fight, choice);
  }
  fight.specialCooldown = SPECIAL_COOLDOWN;
  fight.second = false;
  return choice === "triple" ? triple(run, fight) : grapple(run, fight);
}

let MethodClass = null;

function method() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType } = Shared.core();
  MethodClass = class SolHereditMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return SPEED.spear;
    }

    attackDistance() {
      return 1;
    }

    start(npc) {
      npc.getCombat().setAttackDelay(attack(npc));
    }

    hits() {
      return [];
    }
  };
  return MethodClass;
}

// ---------------------------------------------------------------- phases, sand and crystals

function placeSand(run, tiles) {
  const sender = run.player.getPacketSender();
  for (const tile of tiles) sender.sendGraphic(gfx(GFX.beam), Shared.loc(tile));
  Shared.later(run, SAND.landsAfter, () => {
    if (run.stage !== "wave") return;
    for (const tile of tiles) Hazards.addSand(run, tile, true, "sol");
  });
}

function transition(run, fight) {
  const { TimerKey } = Shared.core();
  const at = tileOf(run.player);
  const others = fight.phase === ENRAGED ? SAND.enraged - 1 : SAND.transition - 1;
  const taken = (tile) => Hazards.hasSand(run, tile) || sameTile(tile, at);
  placeSand(run, [at, ...Patterns.sandTargets(at, others, run.random, taken)]);
  if (fight.phase < ENRAGED && fight.crystals.length < CRYSTALS.length) spawnCrystal(run, fight);
  if (fight.phase === ENRAGED) fight.laserCooldown = LASER.enragedCooldown;
  fight.npc.getTimers?.().registers(TimerKey.FREEZE, 5);
  fight.npc.getCombat().setAttackDelay(SPEED.transition);
  fight.forced = "spear";
}

function spawnCrystal(run, fight) {
  const { Animation } = Shared.core();
  const data = CRYSTALS[fight.crystals.length];
  const npc = run.spawnNpc(CRYSTAL, data.spawn);
  if (!npc) return;
  npc.setFlag?.("combat:no-retaliate");
  npc.setFlag?.(Shared.core().NPC.WALK_THROUGH_ENTITIES_FLAG);
  npc.performAnimation(new Animation(ANIM.crystalSpawn));
  run.hazards.add(npc);
  fight.crystals.push({ npc, data, end: 0, busyUntil: run.waveTicks + CRYSTAL_SPAWN_LOCK });
}

function patrol(run, crystal) {
  if (run.waveTicks < crystal.busyUntil || run.waveTicks % CRYSTAL_STEP_TICKS !== 0) return;
  const here = tileOf(crystal.npc);
  let target = crystal.data.ends[crystal.end];
  if (sameTile(here, target)) {
    crystal.end = (crystal.end + 1) % crystal.data.ends.length;
    target = crystal.data.ends[crystal.end];
  }
  const step = { x: here.x + Math.sign(target.x - here.x), y: here.y + Math.sign(target.y - here.y) };
  Shared.core().PathFinder.calculateWalkRoute(crystal.npc, step.x, step.y);
}

/** A beam across the arena from the crystal's side: charged now, fired a few ticks later. */
function fireCrystal(run, fight, crystal) {
  const { Animation } = Shared.core();
  const [dx, dy] = Patterns.DIRECTIONS[crystal.data.fire];
  const here = tileOf(crystal.npc);
  const path = [];
  for (let n = 1; n <= LASER.length && Patterns.inside(here.x + dx * n, here.y + dy * n); n++) {
    path.push({ x: here.x + dx * n, y: here.y + dy * n, ring: n - 1 });
  }
  const sender = run.player.getPacketSender();
  crystal.npc.performAnimation(new Animation(ANIM.crystalCharge));
  for (const tile of path) sender.sendGraphic(gfx(crystal.data.charge, tile.ring * 2, 128), Shared.loc(tile));
  const charge = fight.phase === ENRAGED ? LASER.enragedCharge : LASER.charge;
  crystal.busyUntil = run.waveTicks + charge + 2;
  Shared.later(run, charge, () => {
    if (run.stage !== "wave" || !crystal.npc.isRegistered()) return;
    crystal.npc.performAnimation(new Animation(ANIM.crystalFire));
    for (const tile of path) sender.sendGraphic(gfx(crystal.data.attack, tile.ring * 2, 128), Shared.loc(tile));
    const last = path.at(-1);
    if (last) sender.sendGraphic(gfx(GFX.crystalEnd, last.ring * 2, 80), Shared.loc(last));
    const at = tileOf(run.player);
    if (path.some((tile) => sameTile(tile, at))) run.hurt(randomInclusive(LASER.min, LASER.max), "RED", true);
  });
}

/** Every tick of wave 12: phase changes, enraged sand, the crystals. */
function tick(run) {
  const fight = run.solFight;
  if (!fight || run.stage !== "wave" || fight.npc.getHitpoints() <= 0) return;
  while (fight.phase + 1 < PHASES.length && fight.npc.getHitpoints() <= PHASES[fight.phase + 1].hp) {
    fight.phase++;
    say(fight, line(PHASES[fight.phase].variant));
    transition(run, fight);
  }
  if (fight.phase === ENRAGED && --fight.enragedSandIn <= 0) {
    fight.enragedSandIn = SAND.enragedEvery;
    placeSand(run, Patterns.sandTargets(tileOf(run.player), 1, run.random, (tile) => Hazards.hasSand(run, tile)));
  }
  for (const crystal of fight.crystals) patrol(run, crystal);
  if (fight.crystals.length > 0 && --fight.laserCooldown <= 0) {
    for (const crystal of fight.crystals) fireCrystal(run, fight, crystal);
    fight.laserCooldown = fight.phase === ENRAGED ? LASER.enragedCooldown
      : randomInclusive(LASER.minCooldown, LASER.maxCooldown);
  }
}

// ---------------------------------------------------------------- the end

/** He falls: his last words, and the kill counts towards how he greets you next time. */
function defeated(run) {
  const fight = run.solFight;
  if (!fight) return;
  say(fight, line("standard-dialogue-death"));
  const player = run.player;
  player.setAttribute(ATTR.KILLS, (Number(player.getAttribute(ATTR.KILLS)) || 0) + 1);
}

function playerDied(run) {
  const fight = run.solFight;
  if (fight && fight.npc.getHitpoints() > 0) say(fight, line("standard-dialogue-killing-the-player"));
}

/** The run is over: the barricade comes down. */
function cleared(run) {
  const { ObjectManager } = Shared.core();
  for (const object of run.barricade ?? []) ObjectManager.deregister(object, true);
  run.barricade = [];
  run.solFight = null;
}

module.exports = function registerSolHeredit(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR.ATTEMPTS);
  api.persistAttribute(ATTR.KILLS);
  api.registerNpcCombatMethodProvider([SOL], method(), { singleton: false });
  api.onCanUnequip(defend);
  api.onCombatHitRoll(parried);
};

module.exports.SOL = SOL;
module.exports.ATTR = ATTR;
module.exports.PHASES = PHASES;
module.exports.begin = begin;
module.exports.land = land;
module.exports.tick = tick;
module.exports.attack = attack;
module.exports.defend = defend;
module.exports.parried = parried;
module.exports.defeated = defeated;
module.exports.playerDied = playerDied;
module.exports.cleared = cleared;
module.exports.method = method;
module.exports.nextAttack = nextAttack;
