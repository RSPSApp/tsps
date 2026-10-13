/**
 * Her specials, as captured: between 1 and 5 standard attacks, then a special. The Nightmare's go
 * by phase (Wiki): husks and flowers, then her curse and parasites, then spores and her surge,
 * mostly alternating with her claws. Phosani's phases each use a set of three (the phase form
 * names it, Common.data.specials.phosaniSets), every one before any again, her claws in between;
 * her flowers and spores come with a run of claws. In her desperation phase she claws on and on.
 *
 * Each special is its own unit; this one picks them, holds her for the captured ticks after, and
 * keeps the effects that outlast a special: her curse and the spores' drowsiness.
 */
const Common = require("./Common.Nightmare");
const Claws = require("./Claws.Nightmare");
const Husks = require("./Husks.Nightmare");
const Flowers = require("./Flowers.Nightmare");
const Parasites = require("./Parasites.Nightmare");
const Spores = require("./Spores.Nightmare");
const Surge = require("./Surge.Nightmare");

const UNITS = {
  claws: Claws, husks: Husks, flowers: Flowers, parasite: Parasites, spores: Spores, surge: Surge,
  curse: { start: (fight) => curse(fight) },
};

/**
 * The special sets of Phosani's three phases (Wiki): A (spores, husks) and B (flowers, parasite)
 * alternate from a random first, each with curse or surge at random. Set ids are her phase forms'.
 */
function phosaniSets() {
  const a = () => (Math.random() < 0.5 ? 2 : 4);
  const b = () => (Math.random() < 0.5 ? 3 : 1);
  const firstA = Math.random() < 0.5;
  return [0, 1, 2].map((i) => ((i % 2 === 0) === firstA ? a() : b()));
}

function startPhase(fight) {
  fight.specials = {
    untilSpecial: Common.randomInt(...Common.data.specials.gap),
    lastWasClaws: Math.random() < 0.5,
    lastPhaseSpecial: null,
    queue: [],
  };
}

function phaseSpecials(fight) {
  if (!fight.phosani) return Common.data.specials.normal[String(fight.phase)];
  return Common.data.specials.phosaniSets[String(fight.sets[fight.phase - 1])];
}

/** The next special's name, the capture's way. */
function nextSpecial(fight) {
  const state = fight.specials;
  if (fight.phosani) {
    if (Math.random() < 0.35) return "claws";
    if (state.queue.length === 0) state.queue = Common.shuffled(phaseSpecials(fight));
    return state.queue.shift();
  }
  const clawsNext = state.lastWasClaws ? Math.random() < 0.15 : Math.random() < 0.8;
  if (clawsNext) return "claws";
  const options = phaseSpecials(fight).filter((name) => name !== state.lastPhaseSpecial);
  return Common.pick(options.length > 0 ? options : phaseSpecials(fight));
}

/** Her turn: a special if one is due (its hold in ticks), otherwise null. */
function maybeSpecial(fight, target) {
  if (fight.stage === "desperate") return Claws.chain(fight, true);
  const state = fight.specials;
  if (!state || --state.untilSpecial > 0) return null;
  if (fight.frozen.size > 0 || fight.flowers || fight.surging) return null;
  state.untilSpecial = Common.randomInt(...Common.data.specials.gap) + 1;
  const name = nextSpecial(fight);
  state.lastWasClaws = name === "claws";
  if (name !== "claws") state.lastPhaseSpecial = name;
  const hold = UNITS[name].start(fight, target);
  return hold ?? Common.data.specials.after[name];
}

function process(fight) {
  Claws.process(fight);
  Flowers.process(fight);
  Spores.process(fight);
  Parasites.process(fight);
  Husks.process(fight);
  processCurses(fight);
}

function processPlayer(fight, player) {
  Flowers.processPlayer(fight, player);
  Spores.processPlayer(fight, player);
  processDrowsy(fight, player);
}

/** Everything a special left behind, when the fight moves on (a blast, her death). */
function interrupt(fight) {
  Claws.clear(fight);
  Flowers.clear(fight);
  Spores.clear(fight);
  Husks.clear(fight);
  Parasites.clear(fight);
  Surge.clear(fight);
  for (const player of [...fight.curse.keys()]) liftCurse(fight, player, false);
}

function playerLeft(fight, player) {
  liftCurse(fight, player, false);
  endDrowsy(fight, player, false);
  Husks.playerLeft(fight, player);
  Parasites.playerLeft(fight, player);
}

function desperation(fight) {
  interrupt(fight);
}

/** A hit on her from the wrong side of her flowers heals her instead (Flowers.Nightmare). */
function heldFlowers(fight, player, hit) {
  return Flowers.healsInstead(fight, player, hit);
}

// ------------------------------------------------------------------ her curse

/**
 * Her curse (captured): her animation with a pink glow over the screen, the message two ticks
 * later as the glow settles; it lasts five of her attacks. In every capture the prayer clicked is
 * the one that turns on, so what's shuffled is what each protection stops (Common.data.curse).
 */
function curse(fight) {
  const { curse: spec } = Common.data;
  fight.boss.performAnimation(Common.animation(spec.anim));
  const players = fight.players();
  for (const player of players) {
    Common.sounds(player, spec.sounds);
    const [script, ...args] = spec.glowStart;
    player.getPacketSender().sendClientScript(script, args[0], (303 << 16) | 1, ...args.slice(1));
  }
  fight.at(spec.messageTicks, () => {
    for (const player of fight.players()) {
      player.sendMessage(spec.message);
      Common.sounds(player, [spec.messageSound]);
      const [script, ...args] = spec.glowEnd;
      player.getPacketSender().sendClientScript(script, args[0], (303 << 16) | 1, ...args.slice(1));
      fight.curse.set(player, { attacks: spec.attacks });
    }
  });
}

/** What a protection prayer stops for this player: shuffled while cursed. */
function blockedBy(fight, player, prayer) {
  if (!fight.curse.has(player)) return prayer;
  const map = fight.phosani ? Common.data.curse.phosani : Common.data.curse.normal;
  return map[prayer] ?? prayer;
}

/** One of her attacks landed on a cursed player: five lift it. */
function attackLanded(fight, player) {
  const state = fight.curse.get(player);
  if (!state) return;
  if (--state.attacks <= 0) liftCurse(fight, player, true);
}

function liftCurse(fight, player, announce) {
  if (!fight.curse.delete(player) || !announce || !player.isRegistered()) return;
  player.sendMessage(Common.data.curse.end);
  Common.sounds(player, [Common.data.curse.endSound]);
}

function processCurses() {}

// ------------------------------------------------------------------ drowsy (her spores)

/** Spores: drowsy for 25 ticks - no running, slower attacks, yawning (Phosani's drain prayer). */
function makeDrowsy(fight, player) {
  if (fight.drowsy.has(player)) return;
  const { spores, varps } = Common.data;
  fight.drowsy.set(player, { until: fight.tick + spores.drowsyTicks, nextYawn: fight.tick + 2 });
  player.sendMessage(spores.infected);
  if (player.isRunningReturn?.()) {
    player.setRunning(false);
    player.getPacketSender().sendConfig(varps.run, 0);
  }
}

function processDrowsy(fight, player) {
  const state = fight.drowsy.get(player);
  if (!state) return;
  const { spores, varps } = Common.data;
  if (fight.tick >= state.until) {
    endDrowsy(fight, player, true);
    return;
  }
  if (player.isRunningReturn?.()) {
    player.setRunning(false);
    player.getPacketSender().sendConfig(varps.run, 0);
    player.sendMessage(spores.tooDrowsy);
  }
  if (fight.tick >= state.nextYawn) {
    state.nextYawn = fight.tick + spores.yawnEvery;
    player.forceChat(spores.yawn);
    if (fight.phosani) {
      const { Skill } = Common.core;
      const skills = player.getSkillManager();
      skills.setCurrentLevel(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - spores.phosaniPrayerDrain), true);
    }
  }
}

function endDrowsy(fight, player, announce) {
  if (!fight.drowsy.delete(player)) return;
  if (announce && player.isRegistered()) player.sendMessage(Common.data.spores.worn);
}

/** A drowsy player's attacks come a tick slower (two in Phosani's dream). */
function drowsyDelay(fight, player) {
  if (!fight.drowsy.has(player)) return 0;
  return fight.phosani ? Common.data.spores.phosaniAttackDelay : Common.data.spores.attackDelay;
}

/** A drowsy player's attack: the timer the engine just set waits that much longer. */
function slowDrowsy({ player }) {
  const fight = require("./Dream.Nightmare").dreamOf(player)?.fight;
  if (!fight) return;
  const extra = drowsyDelay(fight, player);
  const state = fight.drowsy.get(player);
  if (extra <= 0 || state.slowedAt === Common.core.World.getProcessCycle()) return;
  state.slowedAt = Common.core.World.getProcessCycle();
  const combat = player.getCombat();
  combat.extendAttackDelay(combat.getAttackDelay() + extra);
}

function attachSpecials(api) {
  api.onPlayerDealtDamage(slowDrowsy);
}

module.exports = {
  attachSpecials, phosaniSets, startPhase, maybeSpecial, process, processPlayer, interrupt, playerLeft, desperation,
  heldFlowers, curse, blockedBy, attackLanded, makeDrowsy, drowsyDelay,
};
