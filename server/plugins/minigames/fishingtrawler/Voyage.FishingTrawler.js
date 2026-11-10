"use strict";

/**
 * One trawl (Wiki: Fishing Trawler; tick timings from a normal-world capture of a full trip on
 * the official Trawler world), on the trawler at sea - one at a time per world:
 * - every 5 ticks the hull is back to 6-11 of its 16 spots leaking (patched ones among them),
 *   with no message; open leaks let water in until it is bailed out;
 * - a Kraken tentacle every 75 ticks, port then starboard: tentacle_* 2 as it appears, 3 for
 *   five ticks from its fifth tick ("The Kraken has ripped the net!", the net torn), then 2 until
 *   it is chopped off or sinks back. Its rail goes to 1 three ticks in and breaks (2, fixable)
 *   12-17 ticks after that;
 * - the net also rips now and then ("The net has ripped!"), and catches nothing while torn; an
 *   attacking tentacle slows the catch;
 * - the water reaching the top sinks the trawler; otherwise it comes back after five minutes;
 * - each player's share is the boat's catch per player at the start, up to 50% more for a full
 *   meter (trawler_overlay's own scale: x1 at 100 contribution, x1.5 at 255).
 * The HUD is trawler_overlay, drawn by the client from varp 391; the leaks, rails and tentacles
 * are varbit-driven locs and NPCs.
 */

const Shared = require("./Shared.FishingTrawler");

const SIDES = ["port", "starboard"];

const ELITE_DIARY_FISH = 1.5;

class Voyage {
  constructor(players, random = Math.random) {
    this.random = random;
    this.crew = new Set(players);
    this.crewAtStart = Math.max(1, players.length);
    this.contribution = new Map(players.map((player) => [player, 0]));
    this.stats = new Map(players.map((player) => [player, { nets: 0, leaks: 0, bailed: 0, tentacles: 0 }]));
    this.tickCount = 0;
    this.water = 0;
    this.leaks = new Array(16).fill(Shared.DATA.values.hull.default);
    this.netRipped = false;
    this.tentacles = { port: idleTentacle(), starboard: idleTentacle() };
    this.rails = { port: Shared.DATA.values.rail.intact, starboard: Shared.DATA.values.rail.intact };
    this.nextSide = "port";
    this.catch = 0;
    this.ended = false;
    this.result = null;
  }

  // --- The crew

  crewList() {
    return [...this.crew].filter((player) => player.isRegistered?.() !== false);
  }

  /** Adds contribution; crossing 50 tells the player they've earned a share (captured). */
  addPoints(player, points, stat) {
    if (!this.contribution.has(player)) return;
    const { max, rewardMinimum } = Shared.DATA.points;
    const before = this.contribution.get(player);
    const after = Math.min(max, before + points);
    this.contribution.set(player, after);
    if (stat) this.stats.get(player)[stat] += 1;
    if (before < rewardMinimum && after >= rewardMinimum) player.sendMessage(Shared.message("earned"));
  }

  leave(player) {
    this.crew.delete(player);
  }

  // --- A tick at sea

  tick() {
    if (this.ended) return;
    this.tickCount += 1;
    const t = Shared.DATA.timing;
    const crew = this.crewList().length;
    if (this.tickCount % t.leakEvery === 0) this.springLeaks();
    this.water = Math.min(100, this.water + this.openLeaks() * t.waterPerLeakTick);
    if (!this.netRipped && this.random() < t.netRipChancePerTick + t.netRipChancePerPlayer * crew) this.ripNet("netRipped");
    this.tickTentacles();
    this.tickCatch();
    if (this.water >= 100) {
      this.end("sunk");
      return;
    }
    if (this.tickCount >= t.trawlTicks) this.end("returned");
  }

  openLeaks() {
    return this.leaks.filter((state) => state === Shared.DATA.values.hull.leak).length;
  }

  /**
   * Every 5 ticks the hull is back to 6-11 leaking spots at once (the capture: 6-11 of the 16 at
   * 2 on each batch, patched ones among them); live sends no message.
   */
  springLeaks() {
    const { leakBatchMin, leakBatchMax } = Shared.DATA.timing;
    const { leak } = Shared.DATA.values.hull;
    const target = leakBatchMin + Math.floor(this.random() * (leakBatchMax - leakBatchMin + 1));
    const spots = this.leaks.flatMap((state, index) => (state === leak ? [] : [index]));
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const sprung = spots.slice(0, Math.max(0, target - this.openLeaks()));
    for (const index of sprung) this.leaks[index] = leak;
    return sprung.length;
  }

  ripNet(message) {
    if (this.netRipped) return;
    this.netRipped = true;
    this.tell(Shared.message(message));
  }

  tickTentacles() {
    const t = Shared.DATA.timing;
    const v = Shared.DATA.values;
    const active = SIDES.some((side) => this.tentacles[side].state !== v.tentacle.none);
    if (!active && this.tickCount % t.tentacleEvery === 0) {
      const side = this.nextSide;
      this.nextSide = side === "port" ? "starboard" : "port";
      const breaksIn = t.railDamagedAt + t.railBreakMin + Math.floor(this.random() * (t.railBreakMax - t.railBreakMin + 1));
      this.tentacles[side] = { state: v.tentacle.attacking, since: this.tickCount, chops: 0, breaksIn };
      this.tell(Shared.message("kraken"));
    }
    for (const side of SIDES) {
      const tentacle = this.tentacles[side];
      if (tentacle.state === v.tentacle.none) continue;
      const age = this.tickCount - tentacle.since;
      if (age === t.tentacleRipAt) {
        tentacle.state = v.tentacle.sweeping;
        this.ripNet("krakenRipped");
      } else if (age === t.tentacleRipAt + t.tentacleSweepTicks) {
        tentacle.state = v.tentacle.attacking;
      }
      if (age === t.railDamagedAt && this.rails[side] === v.rail.intact) this.rails[side] = v.rail.damaged;
      if (age === tentacle.breaksIn && this.rails[side] === v.rail.damaged) this.rails[side] = v.rail.broken;
      if (age >= t.tentacleLifetime) this.retreat(side);
    }
  }

  /** The tentacle sinks back; a rail it had only damaged comes back whole. */
  retreat(side) {
    this.tentacles[side] = idleTentacle();
    if (this.rails[side] === Shared.DATA.values.rail.damaged) this.rails[side] = Shared.DATA.values.rail.intact;
  }

  krakenAttacking() {
    return SIDES.some((side) => this.tentacles[side].state !== Shared.DATA.values.tentacle.none);
  }

  /** Fish per player at the start: none while the net is torn, slowed by a tentacle. */
  tickCatch() {
    if (this.netRipped) return;
    const c = Shared.DATA.catch;
    const crewFactor = Math.max(c.crewFloor, 1 - c.crewFalloff * (this.crewAtStart - 1));
    this.catch += c.basePerTick * crewFactor * (this.krakenAttacking() ? c.krakenRate : 1);
  }

  // --- What the crew does (Actions.FishingTrawler.js checks items and skills first)

  patch(player, index) {
    const { hull } = Shared.DATA.values;
    if (this.leaks[index] !== hull.leak) return false;
    this.leaks[index] = hull.patched;
    this.addPoints(player, Shared.DATA.points.patch, "leaks");
    return true;
  }

  bail(player) {
    if (this.water <= 0) return false;
    this.water = Math.max(0, this.water - Shared.DATA.timing.bailWater);
    this.addPoints(player, Shared.DATA.points.bail, "bailed");
    return true;
  }

  mendNet(player) {
    if (!this.netRipped) return false;
    this.netRipped = false;
    this.addPoints(player, Shared.DATA.points.net, "nets");
    return true;
  }

  /** One successful chop; enough of them drive the tentacle off. Only while it's choppable (2). */
  chop(player, side) {
    const tentacle = this.tentacles[side];
    if (tentacle.state !== Shared.DATA.values.tentacle.attacking) return null;
    tentacle.chops += 1;
    this.addPoints(player, Shared.DATA.points.chop, "tentacles");
    if (tentacle.chops >= Shared.DATA.timing.tentacleChops) {
      this.retreat(side);
      return "drove";
    }
    return "hit";
  }

  fixRail(player, side) {
    if (this.rails[side] !== Shared.DATA.values.rail.broken) return false;
    this.rails[side] = Shared.DATA.values.rail.intact;
    this.addPoints(player, Shared.DATA.points.rail, "tentacles");
    return true;
  }

  // --- The end

  /**
   * A player's fish from the catch: x1 at 100 contribution, rising to x1.5 at 255, and half as many again with the elite
   * Ardougne Diary (Wiki, Fishing Trawler: "Completing the elite Ardougne Diary yields 50% more fish, and a full
   * contribution meter also yields an additional 50% more fish"). The Wiki doesn't say how the two combine: multiplied
   * here, rounded down once.
   */
  shareFor(player) {
    const c = Shared.DATA.catch;
    const points = this.contribution.get(player) ?? 0;
    const meter = Math.min(1, Math.max(0, (points - c.meterLow) / (c.meterHigh - c.meterLow)));
    const diary = { player, diary: "ardougne", tier: "elite", complete: false };
    Shared.api().emitCustomEvent?.("diary:is-complete", diary);
    return Math.floor(this.catch * (1 + c.meterBonus * meter) * (diary.complete === true ? ELITE_DIARY_FISH : 1));
  }

  /** The captured end-of-trip lines: the contribution, then what the player did. */
  summaryFor(player) {
    const points = this.contribution.get(player) ?? 0;
    const s = this.stats.get(player) ?? { nets: 0, leaks: 0, bailed: 0, tentacles: 0 };
    const lines = [];
    if (points >= Shared.DATA.points.rewardMinimum) lines.push(Shared.message("contributed", { points, max: Shared.DATA.points.max }));
    lines.push(Shared.message("summary", s));
    return lines;
  }

  end(result) {
    if (this.ended) return;
    this.ended = true;
    this.result = result;
  }

  tell(text) {
    for (const player of this.crewList()) player.sendMessage(text);
  }

  /** trawler_timeinfo: 5 from the start, 4 from 27 ticks in, then one less every 100 (captured). */
  minutesLeft() {
    const t = Shared.DATA.timing;
    const start = Math.round(t.trawlTicks / 100);
    const passed = Math.max(0, Math.ceil((this.tickCount - t.timerFirstDrop + 1) / 100));
    return Math.max(0, start - passed);
  }

  // --- The HUD and the boat as each player sees it

  /** Every varbit the crew's client draws from, sent where it changed. */
  sync(player) {
    const v = Shared.ids().varbits;
    const set = (varbit, value) => Shared.setVarbit(player, varbit, value);
    set(v.water, Math.min(100, Math.round(this.water)));
    set(v.netRipped, this.netRipped ? 1 : 0);
    set(v.minutes, this.minutesLeft());
    set(v.catch, Math.min(4095, Math.floor(this.catch)));
    set(v.contribution, this.contribution.get(player) ?? 0);
    this.leaks.forEach((state, index) => set(v.hull[index], state));
    set(v.tentaclePort, this.tentacles.port.state);
    set(v.tentacleStarboard, this.tentacles.starboard.state);
    set(v.railPort, this.rails.port);
    set(v.railStarboard, this.rails.starboard);
  }
}

function idleTentacle() {
  return { state: Shared.DATA.values.tentacle.none, since: 0, chops: 0, breaksIn: 0 };
}

/** Every trawler varbit back to how the boat looks in port. */
function clearHud(player) {
  const v = Shared.ids().varbits;
  for (const varbit of [v.water, v.netRipped, v.minutes, v.catch, v.contribution, v.tentaclePort, v.tentacleStarboard, v.railPort, v.railStarboard, v.status, ...v.hull]) {
    Shared.setVarbit(player, varbit, 0);
  }
}

module.exports = { Voyage, SIDES, clearHud };
