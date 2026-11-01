/**
 * Where pact points and resets come from (data `start`, Wiki Demonic_Pacts_League/Demonic_Pacts):
 * a new character's tutorial point and two free resets, a point for each pact task completed
 * (LeagueTasks' `league:task-completed`, after the task's own line, as captured: the earned varp,
 * then the green line), and a reset for the Hueycoatl's kill credit. Every login resends the tree's
 * varps and varbits. Other plugins ask `league:pacts` { player } and `league:pact-effect`
 * { player, effect } (an effect varbit's gameval name -> value).
 */
const Common = require("./Common.LeaguePacts");

function joined({ player, league }) {
  if (Number(league) !== Common.data.league) return;
  const { start } = Common.data;
  player.setAttribute(Common.POINTS_ATTRIBUTE, start.points);
  player.setAttribute(Common.RESETS_ATTRIBUTE, start.resets);
  player.setAttribute(Common.REWARDS_ATTRIBUTE, { ...Common.rewards(player), freeReset: true });
}

function login({ player, league }) {
  if (Number(league) === Common.data.league) Common.sendState(player);
}

/** One pact point: the earned varp, then the captured line with the points left to spend. */
function grantPoint(player) {
  player.setAttribute(Common.POINTS_ATTRIBUTE, Common.earned(player) + 1);
  player.getPacketSender().sendConfig(Common.ids.varps.earned, Common.earned(player));
  player.sendMessage(Common.message("earned", { count: Common.spendable(player) }));
}

function taskCompleted({ player, league, pactTask }) {
  if (pactTask !== true || Number(league) !== Common.data.league) return;
  grantPoint(player);
}

/** The Hueycoatl's kill credit, once: a reset point (237/01167: the varbit, the resets, the line). */
function hueycoatlCredit(player) {
  if (!player || !Common.isPacts(player) || Common.rewards(player).hueycoatl) return;
  player.setAttribute(Common.REWARDS_ATTRIBUTE, { ...Common.rewards(player), hueycoatl: true });
  player.setAttribute(Common.RESETS_ATTRIBUTE, Common.resets(player) + 1);
  const sender = player.getPacketSender();
  sender.sendVarbit(Common.ids.varbits.hueycoatlReset, 1);
  sender.sendVarbit(Common.ids.varbits.resets, Common.resets(player));
  player.sendMessage(Common.message("hueycoatlReset"));
}

function npcName(npc) {
  return npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? null;
}

function npcDeath({ killer, npc }) {
  if (npcName(npc) === Common.data.hueycoatl) hueycoatlCredit(killer);
}

/** `combat-achievements:kill` { player, monster }: the credit the Hueycoatl's own plugin gives each player. */
function creditedKill({ player, monster }) {
  if (monster === Common.data.hueycoatl) hueycoatlCredit(player);
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
  api.onNpcDeath(npcDeath);
  api.onCustomEvent("combat-achievements:kill", creditedKill);
  api.onCustomEvent("league:pacts", answerPacts);
  api.onCustomEvent("league:pact-effect", answerEffect);
};

Object.assign(module.exports, { grantPoint, hueycoatlCredit });
