/**
 * Corruption, as the Muspah's magic attack (base 3) and shockwave (base 4) inflict it (captured;
 * Wiki "Corruption (status)"): "You have been corrupted!", varbits corruption_target_iterations 3,
 * corruption_current_iterations 1 and corruption_base_damage; ten ticks later the current
 * iteration goes up and a tick after that the prayer drain lands (base x 1, then x 2) with the
 * corruption hitsplat; after the third interval the varbits clear with "You are no longer
 * afflicted with corruption." and the last drain (base x 3). A new corruption starts it again.
 */
const Common = require("./Common.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");

/** Per player: the corruption running now. */
const running = new Map();

function setVarbits(player, { base, current, target }) {
  const { varbits } = Common.data.corruption;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.target, target);
  sender.sendVarbit(varbits.current, current);
  sender.sendVarbit(varbits.base, base);
}

function drain(player, amount) {
  const drained = Hits.drainPrayer(player, amount);
  const splat = Common.data.corruption.splat;
  player.showHitsplat(drained, { mine: splat, others: splat });
}

function step(player, state) {
  if (running.get(player) !== state || !player.isRegistered()) return;
  const { corruption } = Common.data;
  state.iteration++;
  player.getPacketSender().sendVarbit(corruption.varbits.current, state.iteration);
  const iteration = state.iteration - 1;
  const last = state.iteration > corruption.iterations;
  Common.later(1, () => {
    if (running.get(player) !== state || !player.isRegistered()) return;
    if (last) {
      running.delete(player);
      setVarbits(player, { base: 0, current: 0, target: 0 });
      Common.fightMessage(player, corruption.end);
    }
    drain(player, state.base * iteration);
  });
  if (!last) Common.later(corruption.intervalTicks, () => step(player, state));
}

/** Corrupts the player with `base` (3 from the magic attack, 4 from the shockwave). */
function corrupt(player, base) {
  const { corruption } = Common.data;
  const state = { base, iteration: 1 };
  running.set(player, state);
  Common.fightMessage(player, corruption.start);
  setVarbits(player, { base, current: 1, target: corruption.iterations });
  Common.later(corruption.intervalTicks, () => step(player, state));
}

/** Ends it without a word (death, leaving the lair). */
function cure(player) {
  if (!running.delete(player)) return;
  setVarbits(player, { base: 0, current: 0, target: 0 });
}

module.exports = { corrupt, cure, isCorrupted: (player) => running.has(player) };
