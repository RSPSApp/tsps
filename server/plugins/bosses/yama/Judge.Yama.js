/**
 * The phase change and the Judge of Yama (captured, with the Wiki's numbers):
 * - At his next attack after 66.6% (then 33.3%) Yama says one of his lines and slams the ground
 *   (12147, spot 3276). The flares and hazards go, the glyphs go out, the player falls (12149)
 *   and fades out, and six ticks in lands face down by the stepping stones (12152) as the Judge
 *   appears at the corridor's far end, praying Melee and Missiles.
 * - While the player crosses the stones the Judge casts every 4 ticks, sending two fire surges
 *   down the corridor a tile a tick (up to 30); a water spell puts one out with its max hit
 *   (Wiki). On the platform it throws a fireball at the
 *   player's tile every 5 ticks (about 20, or 13-18 to itself if it lands under it), and the
 *   cavern shakes on its 5th and 13th (5-7).
 * - It always takes its attackers' max hit, but prays against two styles: Missiles always, and
 *   Melee until hit by magic, then Magic until hit by melee.
 * - Its death sends the player back to the arena, in front of the throne, five ticks later.
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");
const Glyphs = require("./Glyphs.Yama");
const Flares = require("./Flares.Yama");
const Hazards = require("./Hazards.Yama");
const Attacks = require("./Attacks.Yama");
const Domain = require("./Domain.Yama");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_STATE_VARBIT = 6719;
const NO_RETALIATE_FLAG = "combat:no-retaliate";
/** How far ahead a stone can be jumped to (the rows are 2 or 3 tiles apart). */
const JUMP_ROWS = [1, 2, 3];

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** The fall out of the arena, and the landing `landTicks` later somewhere else (as captured). */
function fall(fight, landTicks, land) {
  const { transition } = Common.data;
  const { player } = fight;
  const sender = player.getPacketSender();
  player.performAnimation(new Common.core.Animation(transition.fallAnim, transition.fallAnimDelay));
  fight.at(transition.fadeTicks - transition.fallTicks, () => {
    fade(player, true);
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 2);
  });
  fight.at(landTicks, () => {
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
    land();
    player.performAnimation(new Common.core.Animation(transition.landAnim));
    player.performGraphicInSlot(transition.landSpot.slot, Hits.graphic(transition.landSpot.id, { height: transition.landSpot.height }));
    fade(player, false);
    fight.at(2, () => sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  });
}

// ------------------------------------------------------------------ the phase change

function begin(fight) {
  const { transition } = Common.data;
  const { yama, player } = fight;
  fight.state = "transition";
  yama.setUntargetable(true);
  yama.getCombat().reset();
  yama.getMovementQueue().setBlockMovement(true).reset();
  Attacks.say(fight, "transition");
  yama.performAnimation(new Common.core.Animation(transition.anim));
  yama.performGraphic(Hits.graphic(transition.spot));
  Flares.clear(fight);
  Hazards.clear(fight);
  fight.at(transition.fallTicks, () => {
    Glyphs.putAllOut(fight);
    fight.hideHud();
    fall(fight, transition.landTicks - transition.fallTicks, () => {
      player.getPacketSender().sendVarbit(transition.phaseVarbit, 1);
      player.moveTo(fight.session.tile(transition.landing));
      player.setPositionToFace(fight.session.tile([transition.landing[0], transition.landing[1] + 5, 0]));
      spawnJudge(fight);
    });
  });
  fight.judge = { npc: null, tick: 0, attacks: 0, surges: [], onPlatform: false };
}

function spawnJudge(fight) {
  const { judge } = Common.data;
  const npc = fight.session.spawn(judge.npc, judge.tile, judge.face);
  if (!npc) return;
  npc.setFlag?.(NO_RETALIATE_FLAG, true);
  npc.getMovementQueue().setBlockMovement(true);
  npc.setHeadIcon(judge.icons.meleeRanged);
  npc.__yamaJudge = fight;
  fight.judge.npc = npc;
  fight.judge.prayers = "meleeRanged";
  fight.state = "judge";
}

// ------------------------------------------------------------------ the Judge's turn

function process(fight) {
  const state = fight.judge;
  if (!state?.npc || fight.state !== "judge") return;
  state.tick++;
  const { judge } = Common.data;
  const [, py] = fight.session.worldTile(fight.player.getLocation());
  state.onPlatform = py >= judge.platformY;
  moveSurges(fight);
  if (!state.onPlatform) {
    if ((state.tick - 1) % judge.surge.everyTicks === 0) sendSurges(fight);
  } else {
    state.platformTicks = (state.platformTicks ?? -1) + 1;
    if (state.platformTicks % judge.fireball.everyTicks === 0) fireball(fight);
  }
}

function sendSurges(fight) {
  const { judge } = Common.data;
  const state = fight.judge;
  state.npc.performAnimation(new Common.core.Animation(judge.castAnim));
  const columns = [...judge.surge.columns].sort(() => Math.random() - 0.5).slice(0, 2);
  for (const x of columns) {
    const surge = fight.session.spawn(judge.surge.npc, [x, judge.surge.startY, 0], "SOUTH");
    if (!surge) continue;
    surge.setFlag?.(NO_RETALIATE_FLAG, true);
    surge.setHitpoints(judge.surge.hitpoints);
    surge.__yamaSurge = fight;
    state.surges.push({ npc: surge, x, y: judge.surge.startY });
  }
}

function moveSurges(fight) {
  const { judge } = Common.data;
  const state = fight.judge;
  const { player, session } = fight;
  const [px, py] = session.worldTile(player.getLocation());
  state.surges = state.surges.filter((surge) => {
    if (!surge.npc.isRegistered()) return false;
    if (surge.fresh !== false) {
      surge.fresh = false;
      return true;
    }
    surge.y--;
    if (surge.y < judge.surge.endY) {
      Common.api.removeNpc(surge.npc);
      return false;
    }
    surge.npc.exactMove(session.tile([surge.x, surge.y, 0]));
    if (surge.x === px && surge.y === py && !surge.hit) {
      surge.hit = true;
      Hits.damage(player, Hits.randomInt(0, judge.surge.maxHit));
      player.performGraphicInSlot(2, Hits.graphic(judge.surge.spot, { height: judge.surge.spotHeight }));
      player.getPacketSender().sendVarbit(Common.data.transition.damageVarbit, 1);
    }
    return true;
  });
}

function fireball(fight) {
  const { judge } = Common.data;
  const spec = judge.fireball;
  const state = fight.judge;
  const { player, session } = fight;
  state.attacks++;
  const target = player.getLocation().clone();
  const [tx, ty] = session.worldTile(target);
  state.npc.performAnimation(new Common.core.Animation(judge.castAnim));
  Hits.tileGraphic(player, target, spec.warnSpot, { delay: spec.warnDelay });
  Hits.projectile(fight, state.npc, target, spec.projectile);
  Hits.tileGraphic(player, target, spec.impact.id, { delay: spec.impact.delay, height: spec.impact.height });
  for (const [id, delay] of spec.sounds) Hits.sound(player, { id, delay });
  if (judge.shake.attacks.includes(state.attacks)) {
    fight.at(1, () => {
      Hits.sound(player, { id: judge.shake.sound });
      Hits.damage(player, Hits.randomInt(...judge.shake.damage));
    });
  }
  fight.at(spec.hitTicks, () => {
    if (!state.npc?.isRegistered()) return;
    const [px, py] = session.worldTile(player.getLocation());
    if (px === tx && py === ty) Hits.damage(player, Hits.randomInt(...spec.damage));
    const [jx, jy] = session.worldTile(state.npc.getLocation());
    if (tx >= jx && tx < jx + 3 && ty >= jy && ty < jy + 3) {
      const { HitDamage, HitMask } = Common.core;
      state.npc.getCombat().getHitQueue().addPendingDamage([new HitDamage(Hits.randomInt(...spec.selfDamage), HitMask.RED)]);
    }
  });
}

// ------------------------------------------------------------------ its prayers

/** Hits on the Judge always land at their max, unless it prays against them. */
function judgeHitRoll(roll) {
  if (!roll.target?.__yamaJudge || !roll.attacker?.isPlayer?.()) return;
  roll.forceAccurate = true;
  roll.forceMaxHit = true;
}

function judgeHitModify({ npc, hit }) {
  const fight = npc?.__yamaJudge;
  if (!fight?.judge) return;
  const { CombatType } = Common.core;
  const type = hit?.getCombatType?.();
  if (!hit?.getAttacker?.()?.isPlayer?.()) return;
  const prayers = fight.judge.prayers;
  const blocked = type === CombatType.RANGED
    || (type === CombatType.MELEE && prayers === "meleeRanged")
    || (type === CombatType.MAGIC && prayers === "rangedMagic");
  if (blocked) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage?.();
  }
  const next = type === CombatType.MAGIC ? "rangedMagic" : type === CombatType.MELEE ? "meleeRanged" : prayers;
  if (next !== prayers) {
    fight.judge.prayers = next;
    npc.setHeadIcon(Common.data.judge.icons[next]);
  }
}

// ------------------------------------------------------------------ the stones

/** A stepping stone: a jump to it from the row two or three tiles before it (captured). */
function jump({ player, object, objectId }) {
  const { stones } = Common.data.judge;
  const fight = player && Domain.sessionOf(player)?.fight;
  if (objectId !== stones.id || !fight || fight.state !== "judge") return false;
  if (ObstacleRunner.isBusy(player) || fight.judge.jumpQueued) return true;
  const { session } = fight;
  const [px, py] = session.worldTile(player.getLocation());
  const [sx, sy] = session.worldTile(object.getLocation());
  if (!JUMP_ROWS.includes(sy - py) || Math.abs(sx - px) > 1) {
    player.sendMessage("I can't reach that!");
    return true;
  }
  player.getMovementQueue().reset();
  const to = object.getLocation();
  // The click is handled between ticks (the player stays put, so it resolves at once). Run now,
  // the next tick's tasks would count the move's tick down and land the player before the client
  // saw the slide: a bare teleport. Started on that tick instead, the slide is sent with it and
  // the landing comes a tick later, as captured.
  fight.judge.jumpQueued = true;
  Common.later(1, () => {
    fight.judge.jumpQueued = false;
    if (fight.state !== "judge" || !player.isRegistered()) return;
    ObstacleRunner.run({ player }, [
      { move: [to.getX(), to.getY(), to.getZ()], anim: stones.anim, speed: [0, stones.cycles], ticks: 1 },
      { sound: stones.sound.id, delay: stones.sound.delay },
    ]);
  });
  return true;
}

/** A stone is jumped to from where the player stands: no walking up to it first (captured). */
function stayToJump(event) {
  if (event.objectId !== Common.data.judge.stones.id) return;
  const fight = Domain.sessionOf(event.player)?.fight;
  if (!fight || fight.state !== "judge") return;
  const at = event.player.getLocation();
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

// ------------------------------------------------------------------ its death, and back

/** From its death starting (as captured): five ticks to the fall, then the landing in front of the throne. */
function onJudgeDeath(event) {
  const fight = event.npc?.__yamaJudge;
  if (!fight || fight.stopped || fight.state !== "judge") return;
  const { judge, transition } = Common.data;
  const { player } = fight;
  Hits.sound(player, { id: judge.deathSound });
  for (const surge of fight.judge.surges) if (surge.npc.isRegistered()) Common.api.removeNpc(surge.npc);
  fight.judge.surges = [];
  fight.judge.npc = null;
  fight.state = "returning";
  player.performGraphicInSlot(2, Hits.graphic(3274, { delay: 90 }));
  fight.at(judge.returnTicks, () => {
    const sender = player.getPacketSender();
    sender.sendVarbit(transition.damageVarbit, 0);
    sender.sendVarbit(transition.phaseVarbit, 0);
    fight.yama?.moveTo(fight.session.tile(transition.yamaReturn));
  });
  fight.at(judge.returnTicks + 1, () => {
    fall(fight, 3, () => {
      player.moveTo(fight.session.tile(transition.returnTo));
      player.setPositionToFace(fight.session.tile([transition.returnTo[0], transition.returnTo[1] - 5, 0]));
      fight.nextPhase();
    });
  });
}

/** The Judge's attacks are its own turn (process); the combat engine gives it none. */
function idleCombat() {
  const { CombatMethod, CombatType } = Common.core;
  return class JudgeCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

// ------------------------------------------------------------------ putting out a fire spell

let waterSpells = null;

function castsWater(player) {
  const { CombatSpells } = Common.core;
  waterSpells ??= new Set(["WATER_STRIKE", "WATER_BOLT", "WATER_BLAST", "WATER_WAVE", "WATER_SURGE"].map((name) => CombatSpells[name]));
  return waterSpells.has(player.getCombat().getSelectedSpell?.());
}

/** Only a water spell can be used on a fire spell. */
function surgeCanAttack(event) {
  if (!event.target?.__yamaSurge || !event.attacker?.isPlayer?.()) return;
  if (castsWater(event.attacker)) return;
  event.allow = false;
  event.attacker.sendMessage(Common.data.judge.surge.waterOnly);
}

/** A water spell always lands its max hit on a fire spell (Wiki). */
function surgeHitRoll(roll) {
  if (!roll.target?.__yamaSurge || !roll.attacker?.isPlayer?.() || !castsWater(roll.attacker)) return;
  roll.forceAccurate = true;
  roll.forceMaxHit = true;
}

/** ...and puts it out once the hit shows. */
function surgeHit({ npc, hit }) {
  const fight = npc?.__yamaSurge;
  if (!fight || !hit?.getAttacker?.()?.isPlayer?.()) return;
  const surge = fight.judge?.surges.find((entry) => entry.npc === npc);
  if (!surge || surge.doused) return;
  surge.doused = true;
  Common.later(1, () => {
    if (npc.isRegistered()) Common.api.removeNpc(npc);
  });
}

function attachJudge(api) {
  api.onCanAttack(surgeCanAttack);
  api.onCombatHitRoll(surgeHitRoll);
  api.onNpcHitModify(surgeHit);
  api.registerNpcCombatMethodProvider(Common.data.judge.npc, idleCombat());
  api.onObjectInteraction("Stone", { Jump: jump });
  api.onObjectRoute(stayToJump);
  api.onCombatHitRoll(judgeHitRoll);
  api.onNpcHitModify(judgeHitModify);
  api.onNpcBeforeDeath(onJudgeDeath);
}

module.exports = { attachJudge, begin, process };
