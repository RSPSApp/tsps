// Wave 69: TzKal-Zuk.
// Mechanics: https://oldschool.runescape.wiki/w/TzKal-Zuk
// Lines: data/definitions/npc-dialogues.json, TzHaar-Ket-Keh "the-inferno-upon-reaching-wave-69".
//
// Zuk does not move and is driven from the run's tick rather than the combat engine: every
// attack is a typeless blow at the player unless they stand behind the Ancestral Glyph, which
// sweeps between the arena walls. A Jal-Xil and Jal-Zek pair is summoned on a timer, a JalTok-Jad
// at 480 hitpoints and four Jal-MejJak at 240, after which Zuk attacks faster.
//
// The camera work of the opening cutscene is not sent: this server has no camera packets.
const run = require("./InfernoRun");

let api;
let core;
let monsters;

const ZUK_SPAWN = { x: 2268, y: 5364 };
const PLAYER_START = { x: 2271, y: 5356 };
const GLYPH_SPAWN = { x: 2270, y: 5363 };
const GLYPH_REST = { x: 2270, y: 5361 };
const GLYPH_WEST = { x: 2257, y: 5361 };
const GLYPH_EAST = { x: 2283, y: 5361 };
const GLYPH_SIZE = 3;
const GLYPH_HITPOINTS = 600;
const GLYPH_END_PAUSE_TICKS = 4;
const SHIELD_ROWS = { minY: 5356, maxY: 5358 };
const SHIELD_REACH = 2;
const RANGER_SPAWN = { x: 2275, y: 5351 };
const MAGER_SPAWN = { x: 2266, y: 5350 };
const JAD_SPAWN = { x: 2270, y: 5347 };
const JAD_HEALER_SPOTS = [{ x: 2270, y: 5352 }, { x: 2270, y: 5353 }, { x: 2272, y: 5352 }];
const ZUK_HEALER_SPOTS = [{ x: 2262, y: 5363 }, { x: 2266, y: 5363 }, { x: 2276, y: 5363 }, { x: 2280, y: 5363 }];
const FALLING_ROCKS = [{ id: 30343, x: 2273, y: 5364 }, { id: 30344, x: 2268, y: 5364 }];
// The wall beside Zuk patched up as his prison breaks (rotation 3 on the east, 1 on the west).
const WALL_PATCHES = [
  { id: 30339, x: 2275, y: 5364, rotation: 3 }, { id: 30340, x: 2267, y: 5364, rotation: 1 },
  { id: 30341, x: 2275, y: 5366, rotation: 3 }, { id: 30342, x: 2267, y: 5366, rotation: 1 },
];
// Zuk's health overlay: interface 596, whose script 739 reads his hitpoints and maximum from
// these varbits. It opens in the toplevel's overlay_hud as the fight starts.
const HUD = 596;
const OVERLAY_HUD_UID = (161 << 16) | 8;
const VARBIT_HUD_HITPOINTS = 5653;
const VARBIT_HUD_MAX = 5654;
// The minimap is dimmed while the prison breaks (2), as on other cutscenes, and back after (0).
const VARBIT_MINIMAP_STATE = 6719;
const GLYPH_OBJECT = 30338;
const GLYPH_OBJECT_ROTATION = 3;
const INTRO_TICKS = 11;
const ROCKS_FALL_TICKS = 3;
const FIRST_ATTACK_TICKS = 15;
const ATTACK_TICKS = 10;
const ENRAGED_ATTACK_TICKS = 7;
const SUMMONS_ATTACK_DELAY = 8;
const MAX_HIT = 251;
// The ranger and mager timer: 45s after the fight starts, then every 3m30s. At 600 hitpoints
// it gains 1m45s and is held until Zuk drops below 480.
const FIRST_SET_TICKS = 75;
const NEXT_SET_TICKS = 350;
const SET_DELAY_AT_600_TICKS = 175;
const TIMER_HOLD = { min: 480, max: 600 };
const JAD_AT = 480;
const HEALERS_AT = 240;
const HEALER_ACT_TICKS = 3;
const HEALER_RISE_TICKS = 3;
// Wiki (Jal-MejJak): "heal TzKal-Zuk for 15-24 hitpoints every three ticks".
const HEALER_HEAL = { min: 15, max: 24 };
const HEALER_BLAST = { min: 5, max: 10 };
const HEALER_BLASTS = 3;
const HEALER_BLAST_SPREAD = 2;
const HEALER_PROJECTILE = 660;
const ZUK_PROJECTILE = 1375;
const ZUK_SPAWN_ANIM = 7563;
const ZUK_ATTACK_ANIM = 7566;
const GLYPH_BLOCK_ANIM = 7568;
const ROCKS_FALL_ANIM = 7559;
const HEALER_SPAWN_ANIM = 2864;
const HEALER_ACT_ANIM = 2868;

function init(pluginApi, combat) {
  api = pluginApi;
  core = pluginApi.core;
  monsters = combat;
}

function begin(session) {
  const { Animation, GameObject, NpcIdentifiers: Npcs, ObjectManager } = core;
  const { player, area } = session;
  const now = run.cycle();
  player.sendMessage("A great power is starting to shake the cavern...");
  run.say(player, run.TZHAAR_KET_KEH, "No! TzKal-Zuk's prison is breaking down. There's nothing I can do for you now, JalYt!");
  player.moveTo(run.tile(PLAYER_START));
  player.getMovementQueue().setBlockMovement(true);
  // As the map has it: 6x3 at rotation 3.
  ObjectManager.deregister(new GameObject(GLYPH_OBJECT, run.tile(GLYPH_SPAWN), 10, GLYPH_OBJECT_ROTATION, area), true);
  const rocks = FALLING_ROCKS.map(({ id, x, y }) => {
    const rock = new GameObject(id, run.tile({ x, y }), 10, 3, area);
    ObjectManager.register(rock, true);
    return rock;
  });
  for (const { id, x, y, rotation } of WALL_PATCHES) {
    ObjectManager.register(new GameObject(id, run.tile({ x, y }), 10, rotation, area), true);
  }
  player.getPacketSender().sendVarbit(VARBIT_MINIMAP_STATE, 2);
  const zuk = run.spawn(session, Npcs.TZKAL_ZUK, ZUK_SPAWN);
  const glyph = run.spawn(session, Npcs.COL_00FFFF_ANCESTRAL_GLYPH_COL, GLYPH_SPAWN, { wave: false });
  zuk?.performAnimation(new Animation(ZUK_SPAWN_ANIM));
  glyph?.setHitpoints(GLYPH_HITPOINTS);
  // The glyph moves over the pit before Zuk, which the map blocks: it walks straight, as OSRS's
  // collision-free walk steps, and only where this plugin sends it.
  glyph?.setScriptedMovement(true);
  glyph?.setFlag("movement:ignore-clipping");
  // This plugin drives all three. A hit would otherwise have them retaliate through the combat
  // engine, which stops the glyph's sweep and plays its attack animation (Zuk's death).
  for (const npc of [zuk, glyph]) npc?.setFlag("combat:no-retaliate");
  if (glyph) walkGlyph(glyph, GLYPH_REST);
  session.zuk = {
    zuk,
    glyph,
    rocks,
    startAt: now + INTRO_TICKS,
    rocksFallAt: now + ROCKS_FALL_TICKS,
    started: false,
    healersSummoned: false,
    nextAttackAt: -1,
    setTimer: FIRST_SET_TICKS,
    timerDelayed: false,
    jadSummoned: false,
    healers: [],
    glyphWait: 0,
    glyphRested: false,
    hudHitpoints: -1,
    set: [],
  };
}

const alive = (npc) => npc != null && npc.getHitpoints() > 0 && npc.isRegistered();

/** Runs the fight for a tick. True once Zuk is dead. */
function tend(session) {
  const state = session.zuk;
  const { zuk, glyph } = state;
  const now = run.cycle();
  if (!zuk || zuk.getHitpoints() <= 0) {
    clearArena(session);
    return true;
  }
  // Zuk, the glyph and the healers never attack through the combat engine, so it would count
  // them out of combat and regenerate them (a tenth of their hitpoints a tick after 20 seconds).
  for (const npc of [zuk, glyph, ...state.healers]) npc?.getCombat().getLastAttack().reset();
  if (state.rocksFallAt !== -1 && now >= state.rocksFallAt) {
    state.rocksFallAt = -1;
    dropRocks(session);
  }
  if (now < state.startAt) return false;
  if (!state.started) {
    state.started = true;
    state.nextAttackAt = now + FIRST_ATTACK_TICKS;
    session.player.getMovementQueue().setBlockMovement(false);
    openHud(session.player, zuk);
  }
  updateHud(session.player, state);
  sweepGlyph(state);
  summon(session, state);
  tendHealers(session, state);
  if (now >= state.nextAttackAt) {
    state.nextAttackAt = now + (state.healersSummoned ? ENRAGED_ATTACK_TICKS : ATTACK_TICKS);
    strike(session, state);
  }
  return false;
}

function openHud(player, zuk) {
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_MINIMAP_STATE, 0);
  sender.sendVarbit(VARBIT_HUD_MAX, zuk.getDefinition().getHitpoints());
  sender.sendSubInterface(OVERLAY_HUD_UID, HUD, 1);
}

function updateHud(player, state) {
  const hitpoints = Math.max(0, state.zuk.getHitpoints());
  if (hitpoints === state.hudHitpoints) return;
  state.hudHitpoints = hitpoints;
  player.getPacketSender().sendVarbit(VARBIT_HUD_HITPOINTS, hitpoints);
}

/** The run is over (won, lost or left): the overlay and the minimap go back to normal. */
function closeHud(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_MINIMAP_STATE, 0);
  sender.closeSubInterface?.(OVERLAY_HUD_UID);
}

function dropRocks(session) {
  const animation = new core.Animation(ROCKS_FALL_ANIM);
  for (const rock of session.zuk.rocks) session.player.getPacketSender().sendObjectAnimation(rock, animation);
}

// The glyph rests a moment at each wall, then crosses to the other one.
function sweepGlyph(state) {
  const { glyph } = state;
  if (!alive(glyph) || glyph.getMovementQueue().size() > 0) return;
  if (state.glyphWait > 0) {
    state.glyphWait--;
    return;
  }
  const at = glyph.getLocation();
  const end = [GLYPH_WEST, GLYPH_EAST].find((wall) => at.getX() === wall.x && at.getY() === wall.y);
  if (end && !state.glyphRested) {
    state.glyphRested = true;
    state.glyphWait = GLYPH_END_PAUSE_TICKS;
    return;
  }
  state.glyphRested = false;
  const destination = end === GLYPH_WEST ? GLYPH_EAST
    : end === GLYPH_EAST ? GLYPH_WEST
      : core.Misc.getRandom(1) === 0 ? GLYPH_WEST : GLYPH_EAST;
  walkGlyph(glyph, destination);
}

function walkGlyph(glyph, { x, y }) {
  const movement = glyph.getMovementQueue();
  movement.reset();
  movement.addSteps(run.tile({ x, y }));
}

function shielded(player, glyph) {
  if (!alive(glyph)) return false;
  const at = player.getLocation();
  if (at.getY() < SHIELD_ROWS.minY || at.getY() > SHIELD_ROWS.maxY) return false;
  const middle = glyph.getLocation().getX() + Math.floor(GLYPH_SIZE / 2);
  return Math.abs(at.getX() - middle) <= SHIELD_REACH;
}

function strike(session, state) {
  const { Animation, HitDamage, HitMask, Projectile } = core;
  const { zuk, glyph } = state;
  const { player } = session;
  zuk.performAnimation(new Animation(ZUK_ATTACK_ANIM));
  if (shielded(player, glyph)) {
    Projectile.createProjectile(zuk, glyph, ZUK_PROJECTILE, 40, Projectile.arrivalCycles(zuk, glyph), 43, 31).sendProjectile();
    monsters.later(zuk, Projectile.arrivalTicks(zuk, glyph), () => {
      if (alive(glyph)) glyph.performAnimation(new Animation(GLYPH_BLOCK_ANIM));
    });
    return;
  }
  Projectile.createProjectile(zuk, player, ZUK_PROJECTILE, 40, Projectile.arrivalCycles(zuk, player), 43, 31).sendProjectile();
  monsters.later(zuk, Projectile.arrivalTicks(zuk, player), () => {
    if (player.getHitpoints() <= 0 || run.sessionOf(player) !== session) return;
    const damage = core.Misc.randomInclusive(0, MAX_HIT);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  });
}

function summon(session, state) {
  const Npcs = core.NpcIdentifiers;
  const { zuk } = state;
  const hitpoints = zuk.getHitpoints();
  if (!state.timerDelayed && hitpoints <= TIMER_HOLD.max) {
    state.timerDelayed = true;
    state.setTimer += SET_DELAY_AT_600_TICKS;
  }
  const held = hitpoints >= TIMER_HOLD.min && hitpoints <= TIMER_HOLD.max;
  if (!held && state.setTimer > 0) state.setTimer--;
  if (state.setTimer === 0) {
    state.setTimer = NEXT_SET_TICKS;
    // No second set while any of the last one is still up: the timer just starts again.
    if (!state.set.some(alive)) {
      state.set = [
        summonFighter(session, state, Npcs.JAL_XIL_2, RANGER_SPAWN),
        summonFighter(session, state, Npcs.JAL_ZEK_2, MAGER_SPAWN),
      ];
    }
  }
  if (!state.jadSummoned && hitpoints <= JAD_AT) {
    state.jadSummoned = true;
    const jad = summonFighter(session, state, Npcs.JALTOK_JAD_2, JAD_SPAWN);
    if (jad) run.addJad(session, jad, SUMMONS_ATTACK_DELAY, JAD_HEALER_SPOTS.length, JAD_HEALER_SPOTS);
  } else if (!state.healersSummoned && hitpoints <= HEALERS_AT) {
    state.healersSummoned = true;
    const now = run.cycle();
    for (const at of ZUK_HEALER_SPOTS) {
      const healer = run.spawn(session, Npcs.JAL_MEJJAK, at, { wave: false });
      if (!healer) continue;
      // Hit, a healer turns on the player through provoke, not the combat engine.
      healer.setFlag("combat:no-retaliate");
      healer.performAnimation(new core.Animation(HEALER_SPAWN_ANIM));
      healer.__infernoNextAct = now + HEALER_RISE_TICKS;
      state.healers.push(healer);
    }
  }
}

// Summoned fighters go for the glyph first, and for the player once it falls or they are hit.
function summonFighter(session, state, id, at) {
  const target = alive(state.glyph) ? state.glyph : session.player;
  const npc = run.spawn(session, id, at, { target });
  npc?.getCombat().setAttackDelay(SUMMONS_ATTACK_DELAY);
  return npc;
}

// Jal-MejJak heal Zuk until the player hits them, then rain fire around the player instead.
function tendHealers(session, state) {
  const { Projectile, HitDamage, HitMask } = core;
  const { zuk } = state;
  const { player } = session;
  const now = run.cycle();
  state.healers = state.healers.filter(alive);
  for (const healer of state.healers) {
    if (now < healer.__infernoNextAct) continue;
    healer.__infernoNextAct = now + HEALER_ACT_TICKS;
    healer.performAnimation(new core.Animation(HEALER_ACT_ANIM));
    if (!healer.__infernoAngry) {
      Projectile.createProjectile(healer, zuk, HEALER_PROJECTILE, 40, Projectile.arrivalCycles(healer, zuk), 43, 31).sendProjectile();
      monsters.later(healer, Projectile.arrivalTicks(healer, zuk), () => {
        if (zuk.getHitpoints() > 0) zuk.heal(core.Misc.randomInclusive(HEALER_HEAL.min, HEALER_HEAL.max));
      });
      continue;
    }
    for (const spot of blastSpots(player)) {
      new Projectile(Projectile.centreOf(healer), spot, null, HEALER_PROJECTILE, 40, Projectile.arrivalCycles(healer, spot), 43, 0, session.area)
        .sendProjectile();
      monsters.later(healer, Projectile.arrivalTicks(healer, spot), () => {
        if (player.getHitpoints() <= 0 || !player.getLocation().isWithinDistance(spot, 1)) return;
        const damage = core.Misc.randomInclusive(HEALER_BLAST.min, HEALER_BLAST.max);
        player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
      });
    }
  }
}

function blastSpots(player) {
  const at = player.getLocation();
  const spots = [];
  while (spots.length < HEALER_BLASTS) {
    const spot = at.transform(
      core.Misc.randomInclusive(-HEALER_BLAST_SPREAD, HEALER_BLAST_SPREAD),
      core.Misc.randomInclusive(-HEALER_BLAST_SPREAD, HEALER_BLAST_SPREAD),
    );
    if (!spots.some((other) => other.equals(spot))) spots.push(spot);
  }
  return spots;
}

/** A hit from the player draws a healer's fire, or turns a summoned fighter off the glyph. */
function provoke({ attacker, target }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !target.__infernoRun?.zuk) return;
  if (target.getId() === core.NpcIdentifiers.JAL_MEJJAK) {
    target.__infernoAngry = true;
  } else if (target.getCombat().getTarget() === target.__infernoRun.zuk.glyph) {
    target.getCombat().attack(attacker);
  }
}

function clearArena(session) {
  const state = session.zuk;
  for (const npc of [...session.npcs, ...state.healers, state.glyph]) {
    if (npc && npc !== state.zuk) api.removeNpc(npc);
  }
  for (const { healers } of session.jads) healers.forEach((healer) => api.removeNpc(healer));
  session.npcs.clear();
  session.jads = [];
  state.healers = [];
}

module.exports = { init, begin, tend, provoke, closeHud };
