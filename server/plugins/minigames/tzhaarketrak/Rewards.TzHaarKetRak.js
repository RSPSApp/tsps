/**
 * After a challenge (Wiki: TzHaar-Ket-Rak's_Challenges, Transcript:TzHaar-Ket-Rak; the lines and
 * their order are rsprox recordings, data/tzhaar-ket-rak.json):
 * - the last Jad's death counts the completion on the challenge's varp and prints the count, the
 *   duration and, the first time, the next challenge unlocked (or the Inferno it needs); the first
 *   sixth unlocks the JalRek-Jad metamorphosis (Pets.plugin.js reads the flag);
 * - back outside, the TokKul (inventory, or the floor when it can't hold it), and the tick after
 *   TzHaar-Ket-Rak's transcript line - "Now, a new challenge awaits." only when one was unlocked;
 * - a failure prints how long the player survived and how many Jads fell. Any kills pay the
 *   TokKul of the challenge with that many Jads, with "Not bad for a JalYt."; none get
 *   "Failure..." (no line to a player who logged out);
 * - Combat Achievements: the tasks the completion meets, by name. Its kill-count tasks ("Complete
 *   TzHaar-Ket-Rak's second challenge.") name a challenge, not a count, so no count is reported:
 *   Data.CombatAchievements would read each as "once". Completions, best times and deaths are kept for the scoreboard
 *   (Scoreboard.TzHaarKetRak.js).
 */
const Common = require("./Common.TzHaarKetRak");
const Dialogue = require("./Dialogue.TzHaarKetRak");
const Scoreboard = require("./Scoreboard.TzHaarKetRak");

const SECONDS_PER_TICK = 0.6;
const STYLES = ["MELEE", "RANGED", "MAGIC"];

function give(player, itemId, amount) {
  const { core } = Common;
  const inventory = player.getInventory();
  if (inventory.contains(itemId) || inventory.getFreeSlots() > 0) {
    inventory.adds(itemId, amount);
    return;
  }
  core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), player.getLocation().clone(), null);
}

/** The Elite Karamja Diary doubles the TokKul (Wiki: Karamja Diary). */
function tokkulFor(player, amount) {
  const request = { player, amount };
  Common.api.emitCustomEvent("diary:tokkul", request);
  return request.amount;
}

function sendCounts(player) {
  const sender = player.getPacketSender();
  for (let challenge = 1; challenge <= Common.SIX; challenge++) {
    sender.sendConfig(Common.ids.varps[`c${challenge}`], Common.completions(player, challenge));
  }
  sender.sendVarbit(Common.ids.varbits.transmog, player.getAttribute(Common.PET_UNLOCK_ATTRIBUTE) === true ? 1 : 0);
}

function bestTimes(player) {
  const times = player.getAttribute(Common.BEST_TIMES_ATTRIBUTE);
  return times && typeof times === "object" ? { ...times } : {};
}

/** The tasks a completion meets (Wiki task list; times in game ticks). */
function tasksFor(player, challenge) {
  const { ca } = Common.data;
  const n = String(challenge.number);
  const tasks = [];
  if (ca.killCount[n]) tasks.push(ca.killCount[n]);
  const speed = ca.speed[n];
  if (speed && challenge.elapsedTicks() * SECONDS_PER_TICK < speed[1]) tasks.push(speed[0]);
  if (ca.meleeOnly[n] && !challenge.nonMelee) tasks.push(ca.meleeOnly[n]);
  if (ca.emptyInventory[n] && challenge.emptyInventory) tasks.push(ca.emptyInventory[n]);
  if (ca.multiStyle[n]) {
    // Each Jad damaged with one style only, and every Jad a different one.
    const styles = [...challenge.styles.values()];
    const single = styles.length === challenge.number && styles.every((set) => set.size === 1);
    const distinct = new Set(styles.map((set) => [...set][0]));
    if (single && distinct.size === challenge.number && [...distinct].every((style) => STYLES.includes(style))) tasks.push(ca.multiStyle[n]);
  }
  if (challenge.number === Common.SIX && Number(player.getAttribute(Common.LAST_COMPLETED_ATTRIBUTE)) === Common.SIX - 1) {
    tasks.push(ca.backToBack);
  }
  return tasks;
}

/** The last Jad down: the completion counted and its lines, the reward kept for the way out. */
function lastJadDown(player, challenge) {
  const { api, data } = Common;
  const number = challenge.number;
  const tasks = tasksFor(player, challenge);
  const firstSixth = number === Common.SIX && player.getAttribute(Common.PET_UNLOCK_ATTRIBUTE) !== true;
  const count = Common.completions(player, number) + 1;
  player.setAttribute(Common.completionsAttribute(number), count);
  if (firstSixth) player.setAttribute(Common.PET_UNLOCK_ATTRIBUTE, true);
  player.setAttribute(Common.LAST_COMPLETED_ATTRIBUTE, number);
  const times = bestTimes(player);
  const ticks = challenge.elapsedTicks();
  const best = !(Number(times[number]) > 0) || ticks < Number(times[number]);
  if (best) {
    times[number] = ticks;
    player.setAttribute(Common.BEST_TIMES_ATTRIBUTE, times);
    api.emitCustomEvent("boss:personal-best", { player, boss: `TzHaar-Ket-Rak's ${data.ordinals[number - 1]} Challenge`, ticks });
  }
  Scoreboard.completed(number, ticks);
  sendCounts(player);
  const ordinal = data.ordinals[number - 1];
  const time = Common.formatTicks(ticks);
  player.sendMessage(Common.message("completionCount", { ordinal, count }));
  player.sendMessage(best ? Common.message("durationBest", { time })
    : Common.message("duration", { time, best: Common.formatTicks(Number(times[number])) }));
  let unlocked = false;
  if (count === 1 && number < Common.SIX) {
    const next = data.ordinals[number];
    unlocked = number + 1 < data.infernoChallenge || Common.defeatedZuk(player);
    player.sendMessage(Common.message(unlocked ? "unlocked" : "needInferno", { next }));
  }
  const variant = number !== Common.SIX ? Dialogue.VARIANT.completed
    : firstSixth ? Dialogue.VARIANT.sixthFirst : Dialogue.VARIANT.sixthAgain;
  challenge.result = { tokkul: tokkulFor(player, data.rewards[number - 1]), unlocked, variant };
  // After the challenge's own lines, and once the reward is safe.
  for (const task of tasks) api.emitCustomEvent("combat-achievements:complete", { player, task });
}

/** Back outside after a completion: the TokKul, and his line the tick after. */
function completed(player, challenge, { logout = false } = {}) {
  const { tokkul, unlocked, variant } = challenge.result;
  give(player, Common.ids.objs.tokkul, tokkul);
  if (logout) return;
  Common.later(1, () => {
    if (player.isRegistered?.() !== false) Dialogue.say(player, variant, { challenge: challenge.number, tokkul, unlocked });
  });
}

/** How long the player lasted and the Jads killed; any kills pay that many Jads' challenge. */
function failed(player, challenge, { logout = false, died = false } = {}) {
  const { data } = Common;
  player.setAttribute(Common.LAST_COMPLETED_ATTRIBUTE, 0);
  // A death once the Jads are in counts; one during the fade in, before they arrive, doesn't.
  if (died && challenge.startTick !== -1) Scoreboard.died(player, challenge.number);
  const kills = challenge.kills;
  if (challenge.startTick !== -1) {
    const values = { time: Common.formatTicks(challenge.elapsedTicks()), end: died ? data.messages.perishing : "." };
    if (kills > 0) {
      player.sendMessage(Common.message("survivedKilled", {
        ...values, count: Common.NUMBER_WORDS[kills], jads: kills === 1 ? "JalTok-Jad" : "JalTok-Jads",
      }));
    } else {
      player.sendMessage(Common.message(challenge.number === 1 ? "survivedNone" : "survivedNoneMulti", values));
    }
  }
  if (kills > 0) {
    const tokkul = tokkulFor(player, data.rewards[kills - 1]);
    give(player, Common.ids.objs.tokkul, tokkul);
    if (!logout) {
      Dialogue.say(player, Dialogue.VARIANT.completed, { challenge: challenge.number, tokkul, npcLine: data.messages.notBad });
    }
  } else if (!logout) {
    Dialogue.say(player, Dialogue.VARIANT.failed, { challenge: challenge.number });
  }
}

function refused(player, number, reason) {
  Dialogue.say(player, Dialogue.VARIANT[reason], { challenge: number });
}

function onLogin({ player }) {
  sendCounts(player);
}

function attach(api) {
  for (let challenge = 1; challenge <= Common.SIX; challenge++) api.persistAttribute(Common.completionsAttribute(challenge), 0);
  api.persistAttribute(Common.PET_UNLOCK_ATTRIBUTE, false);
  api.persistAttribute(Common.BEST_TIMES_ATTRIBUTE, {});
  api.persistAttribute(Common.LAST_COMPLETED_ATTRIBUTE, 0);
  api.onPlayerLogin(onLogin);
}

module.exports = { attach, lastJadDown, completed, failed, refused, tasksFor, give };
