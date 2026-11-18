/**
 * "Your <boss> kill count is: N." for the bosses that have no plugin of their own to say it
 * (Wiki: every boss on the boss log tells the count on a kill). Their kills are counted by
 * Combat Achievements' NPC-death count; this tells the player that count, the one the boss log
 * shows. The bosses are listed in data/kill-count-messages.json.
 *
 * Plugins load in path order, so Combat Achievements (plugins/achievements/) has counted the kill
 * before this hears the death; "combat-achievements:count" reads the count without changing it.
 */
const { sendBossKillCount } = require("../interface/BossKillCount.plugin");
const { monsters: MONSTERS } = require("./data/kill-count-messages.json");

let api = null;

function npcName(npc) {
  return npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? null;
}

function tellKillCount({ npc, killer }) {
  const name = npcName(npc);
  const monster = name ? MONSTERS[name] : undefined;
  if (!monster || !killer?.isPlayer?.()) return;
  const request = { player: killer, monster, total: null };
  api.emitCustomEvent("combat-achievements:count", request);
  if (!Number.isInteger(request.total) || request.total <= 0) return;
  sendBossKillCount(killer, `Your ${name} kill count is: <col=ff0000>${request.total}</col>.`);
}

function init(pluginApi) {
  api = pluginApi;
}

module.exports = {
  name: "KillCountMessages",
  description: "Tells the kill count on a kill for bosses whose count is kept only by Combat Achievements.",
  members: true,
  tellKillCount,
  MONSTERS,
  register(pluginApi) {
    init(pluginApi);
    pluginApi.onNpcDeath(tellKillCount);
  },
};
