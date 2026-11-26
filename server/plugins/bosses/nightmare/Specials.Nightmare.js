/**
 * Her specials, as captured. The Nightmare's go by phase (Wiki): husks and flowers, then her curse
 * and parasites, then spores and her surge, strictly alternating, 7-9 of her turns apart with
 * usually one set of claws among them (startPhase). Phosani's phase forms follow a fixed cycle and
 * each uses its set of three in a fixed order (Common.data.specials.phosaniCycle, phosaniOrder),
 * 1-5 standard attacks apart, her claws among them; her flowers and spores come with a run of
 * claws. In her desperation phase she claws on and on.
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
 * Phosani's phase forms (captured, every fight at revisions 234-237): consecutive steps of one
 * cycle, 9416 -> 11153 -> 9418 -> 9417 -> 9416, from a random start. Set ids are her forms'.
 */
function phosaniSets() {
  const cycle = Common.data.specials.phosaniCycle;
  const start = Common.randomInt(0, cycle.length - 1);
  return [0, 1, 2].map((i) => cycle[(start + i) % cycle.length]);
}

/** Turns of her own (standard attacks and claws) before the next phase special, The Nightmare's way. */
function normalCycle() {
  const { cycle } = Common.data.specials;
  const turns = Common.randomInt(...cycle.turns) - 1;
  const roll = Math.random();
  const claws = roll < cycle.noClaws ? 0 : roll < cycle.noClaws + cycle.twoClaws ? 2 : 1;
  const slots = Array(turns).fill("attack");
  for (const index of Common.shuffled([...slots.keys()]).slice(0, claws)) slots[index] = "claws";
  return [...slots, "phase"];
}

/**
 * The Nightmare's turns (rsprox, 77 fights): a phase's first special after 1-6 standard attacks;
 * from then on 7-9 turns from one phase special to the next, one of them usually her claws.
 * Phosani's (unchanged): 1-5 standard attacks between specials.
 */
function startPhase(fight) {
  const { specials } = Common.data;
  const forms = specials.phosaniOrder[String(fight.sets?.[fight.phase - 1])];
  fight.specials = {
    untilSpecial: Common.randomInt(...specials.gap),
    lastPhaseSpecial: null,
    order: forms ? { list: forms, next: Common.randomInt(0, forms.length - 1) } : null,
    turns: [],
  };
  if (fight.phosani) return;
  const first = Common.randomInt(...specials.cycle.first);
  const lead = Array(first).fill("attack");
  if (Math.random() < 0.5) fight.specials.turns = [...lead, "phase"];
  else fight.specials.turns = [...lead, "claws", ...Array(Common.randomInt(0, 4)).fill("attack"), "phase"];
}

/** The Nightmare's pair strictly alternates; Phosani's form names a fixed order (captured). */
function nextPhaseSpecial(fight) {
  const state = fight.specials;
  if (state.order) {
    const name = state.order.list[state.order.next];
    state.order.next = (state.order.next + 1) % state.order.list.length;
    return name;
  }
  const pair = Common.data.specials.normal[String(fight.phase)];
  const options = pair.filter((name) => name !== state.lastPhaseSpecial);
  return Common.pick(options.length > 0 ? options : pair);
}

function blocked(fight) {
  return fight.frozen.size > 0 || fight.flowers || fight.surging;
}

/** The next turn's special, or null for a standard attack. */
function nextTurn(fight) {
  const state = fight.specials;
  if (fight.phosani) {
    if (--state.untilSpecial > 0 || blocked(fight)) return null;
    state.untilSpecial = Common.randomInt(...Common.data.specials.gap) + 1;
    return Math.random() < 0.35 ? "claws" : nextPhaseSpecial(fight);
  }
  if (state.turns.length === 0) state.turns = normalCycle();
  const turn = state.turns[0];
  if (turn === "attack") {
    state.turns.shift();
    return null;
  }
  if (blocked(fight)) return null;
  state.turns.shift();
  return turn === "claws" ? "claws" : nextPhaseSpecial(fight);
}

/** Her turn: a special if one is due (its hold in ticks), otherwise null. */
function maybeSpecial(fight, target) {
  if (fight.stage === "desperate") return Claws.chain(fight, true);
  if (!fight.specials) return null;
  const name = nextTurn(fight);
  if (!name) return null;
  if (name !== "claws") fight.specials.lastPhaseSpecial = name;
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

/** Clear interrupted specials, preserving the spores through a totem charge. */
function interrupt(fight, { keepSpores = false, keepCurse = false } = {}) {
  Claws.clear(fight);
  Flowers.clear(fight);
  if (!keepSpores) {
    Spores.clear(fight);
    fight.drowsy.clear();
  }
  Husks.clear(fight);
  Parasites.clear(fight);
  Surge.clear(fight);
  if (!keepCurse) for (const player of [...fight.curse.keys()]) liftCurse(fight, player, false);
}

function blastSpores(fight) {
  Spores.burstAll(fight);
  fight.drowsy.clear();
}

function playerLeft(fight, player) {
  liftCurse(fight, player, false);
  endDrowsy(fight, player, false);
  Spores.playerLeft(fight, player);
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
      fight.curse.set(player, { actions: spec.actions, ending: false });
    }
  });
}

/**
 * One of her turns (a standard attack or a special): five after her curse, it wears off five ticks
 * later (captured: 35 ticks after her animation, more than 80 times; 564 3032 and 1148 4756 count a
 * special as the fifth).
 */
function actionTaken(fight) {
  for (const [player, state] of fight.curse) {
    if (state.ending || --state.actions > 0) continue;
    state.ending = true;
    fight.at(Common.data.curse.endTicks, () => liftCurse(fight, player, true));
  }
}

/** The totems' blast ends her curse with its message as it lands (rsprox 1875 21216-21219). */
function curseEndsAtBlast(fight) {
  const players = [...fight.curse.keys()];
  if (players.length === 0) return;
  fight.at(Common.data.curse.blastTicks, () => {
    for (const player of players) liftCurse(fight, player, true);
  });
}

/** What a protection prayer stops for this player: shuffled while cursed. */
function blockedBy(fight, player, prayer) {
  if (!fight.curse.has(player)) return prayer;
  const map = fight.phosani ? Common.data.curse.phosani : Common.data.curse.normal;
  return map[prayer] ?? prayer;
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
  const { spores, varps } = Common.data;
  const previous = fight.drowsy.get(player);
  fight.drowsy.set(player, { ...previous, until: fight.tick + spores.drowsyTicks, nextYawn: fight.tick + 2 });
  // A second infection has its own line (rsprox 1764 11483, 1875 16483, 1148 6333 and more).
  player.sendMessage(previous ? spores.reinfected : spores.infected);
  // Run goes off with every infection, even when it already is (varp 173 = 0 each time, captured).
  if (player.isRunningReturn?.()) player.setRunning(false);
  player.getPacketSender().sendConfig(varps.run, 0);
}

function processDrowsy(fight, player) {
  const state = fight.drowsy.get(player);
  if (!state) return;
  const { spores, varps } = Common.data;
  // Still too drowsy on the tick it wears off (rsprox 1764 11508, 564 3117: refused, then worn off).
  if (player.isRunningReturn?.()) {
    player.setRunning(false);
    player.getPacketSender().sendConfig(varps.run, 0);
    player.sendMessage(spores.tooDrowsy);
  }
  if (fight.tick >= state.until) {
    endDrowsy(fight, player, true);
    return;
  }
  if (fight.tick >= state.nextYawn) {
    state.nextYawn = fight.tick + spores.yawnEvery;
    player.forceChat(spores.yawn);
    if (fight.phosani) {
      const { Skill } = Common.core;
      const skills = player.getSkillManager();
      const prayer = skills.getCurrentLevel(Skill.PRAYER);
      const { base, per } = spores.phosaniPrayerDrain;
      skills.setCurrentLevel(Skill.PRAYER, Math.max(0, prayer - (base + Math.floor(prayer / per))), true);
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
  require("./CombatAchievements.Nightmare").sporesSlowed(fight, player);
}

function attachSpecials(api) {
  api.onPlayerDealtDamage(slowDrowsy);
}

module.exports = {
  attachSpecials, phosaniSets, startPhase, maybeSpecial, process, processPlayer, interrupt, blastSpores, playerLeft, desperation,
  heldFlowers, curse, blockedBy, actionTaken, curseEndsAtBlast, makeDrowsy, drowsyDelay,
};
