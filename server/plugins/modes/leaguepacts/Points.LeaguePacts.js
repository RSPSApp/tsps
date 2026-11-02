/**
 * Where pact points and resets come from (data `start` and `resetTasks`; Wiki
 * Demonic_Pacts_League/Demonic_Pacts; recordings 237/01098, 01158, 04052, 238/01219):
 *
 * - A new character has no point and the two free resets (both flagged: talent_free_reset_1, _2).
 * - Every pact task (the catalog's `pactTask`, 79 of them; LeagueTasks' `league:task-completed`,
 *   after the task's own line) adds a point: the earned varp, then the green line with the points
 *   left to spend ("Demonic Pact" for the first point earned, as 237/01098 shows, plural after).
 *   The tutorial's two points are two of them, Open the Leagues Menu and Complete the Leagues
 *   Tutorial, as recorded. The Wiki's 44 come from the tasks a character can reach (three regions,
 *   Varlamore, Karamja and the general ones); 40 can be spent (Common.spendable).
 * - A reset task (data `resetTasks`) adds a reset after its point: talent_resets_available and the
 *   "Full Pact reset" line (237/01158, Defeat 3 unique Echo Bosses). The Hueycoatl's first kill is
 *   one (Wiki, 23 April 2026; it also sets talent_huey_pact_reset), and three come from echo bosses
 *   (Wiki): ours, the 1, 2 and 3 unique-echo-boss tasks. Each reset task pays once.
 *
 * Every login resends the tree's varps and varbits (Common.sendState). Other plugins ask
 * `league:pacts` { player } and `league:pact-effect` { player, effect } (an effect varbit's
 * gameval name -> value).
 *
 * Not here: live's one-off grants for tasks done before the 23 April change (the
 * talent_extra_retro_* flags, 237/01167): a character here earns those points from the tasks.
 */
const Common = require("./Common.LeaguePacts");

function joined({ player, league }) {
  if (Number(league) !== Common.data.league) return;
  const { start } = Common.data;
  player.setAttribute(Common.POINTS_ATTRIBUTE, start.points);
  player.setAttribute(Common.RESETS_ATTRIBUTE, start.resets);
  player.setAttribute(Common.REWARDS_ATTRIBUTE, { ...Common.rewards(player), freeReset: true, secondFreeReset: true });
}

function login({ player, league }) {
  Common.forgetLeague(player);
  if (Number(league) === Common.data.league) Common.sendState(player);
}

/** One pact point: the earned varp, then the captured line with the points left to spend. */
function grantPoint(player) {
  const earned = Common.earned(player) + 1;
  player.setAttribute(Common.POINTS_ATTRIBUTE, earned);
  player.getPacketSender().sendConfig(Common.ids.varps.earned, earned);
  player.sendMessage(Common.message(earned === 1 ? "firstEarned" : "earned", { count: Common.spendable(player) }));
}

/** One reset from a reset task, once a task: the resets varbit, then the captured line. */
function grantReset(player, taskId) {
  const given = Common.rewards(player);
  const done = Array.isArray(given.resetTasks) ? given.resetTasks : [];
  const hueycoatl = taskId === Common.data.resetTasks.hueycoatl;
  // A character credited for the Hueycoatl before its reset was the task's has had that reset.
  if (done.includes(taskId) || (hueycoatl && given.hueycoatl)) return;
  player.setAttribute(Common.REWARDS_ATTRIBUTE, { ...given, resetTasks: [...done, taskId], ...(hueycoatl ? { hueycoatl: true } : {}) });
  player.setAttribute(Common.RESETS_ATTRIBUTE, Common.resets(player) + 1);
  const sender = player.getPacketSender();
  if (hueycoatl) sender.sendVarbit(Common.ids.varbits.hueycoatlReset, 1);
  sender.sendVarbit(Common.ids.varbits.resets, Common.resets(player));
  player.sendMessage(Common.message("resetEarned", { count: Common.resets(player) }));
}

function taskCompleted({ player, league, id, pactTask }) {
  if (Number(league) !== Common.data.league) return;
  if (pactTask === true) grantPoint(player);
  if (Common.data.resetTasks.tasks.includes(id)) grantReset(player, id);
}

/** `league:pacts` { player } -> pacts (node indices), earned, spendable, resets. */
function answerPacts(query) {
  if (!query?.player || !Common.isPacts(query.player)) return;
  query.pacts = Common.pacts(query.player);
  query.earned = Common.earned(query.player);
  query.spendable = Common.spendable(query.player);
  query.resets = Common.resets(query.player);
}

/** `league:pact-effect` { player, effect } -> value: what the character's pacts give that effect. */
function answerEffect(query) {
  if (!query?.player || typeof query.effect !== "string") return;
  query.value = Common.effect(query.player, query.effect);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.PACTS_ATTRIBUTE, []);
  api.persistAttribute(Common.POINTS_ATTRIBUTE, 0);
  api.persistAttribute(Common.RESETS_ATTRIBUTE, 0);
  api.persistAttribute(Common.REWARDS_ATTRIBUTE, {});
  api.onCustomEvent("league:joined", joined);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("league:task-completed", taskCompleted);
  api.onCustomEvent("league:pacts", answerPacts);
  api.onCustomEvent("league:pact-effect", answerEffect);
};

Object.assign(module.exports, { grantPoint, grantReset });
