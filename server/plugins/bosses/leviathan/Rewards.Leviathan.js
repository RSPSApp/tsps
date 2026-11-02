const Common = require('./Common.Leviathan');
const { own } = require('./Fight.Leviathan');
const Records = require('./Records.Leviathan');
const MONSTER = Common.MONSTER;
const BOSS_NAME = 'Leviathan';
function current(npc, player = null) {
  const f = own(npc);
  return f && f.boss === npc && f.over && !f.stopped && !f.session.ended && f.session.fight === f &&
    npc.getHitpoints() === 0 && (!player || f.player === player) ? f : null;
}
function context(event) {
  const fight = current(event.npc, event.player);
  if (fight && event.context) event.context.perfectKill = fight.perfect;
}
function location(event) {
  const fight = current(event.npc, event.player);
  if (fight) event.location = fight.session.tile(Common.data.arena.loot);
}
function died({ npc, killer }) {
  const fight = current(npc, killer);
  if (!fight || fight.rewarded || killer !== fight.player) return;
  fight.rewarded = true;
  const { player, session, awakened } = fight;
  const key = awakened ? Common.AWAKENED_KILLS_ATTRIBUTE : Common.KILLS_ATTRIBUTE;
  const kills = awakened ? Common.count(player, key) + 1 : Math.max(fight.normalKillsAtStart + 1, Common.normalKills(player));
  const announce = count => player.sendMessage(`Your ${awakened ? 'awakened ' : ''}Leviathan kill count is: <col=ff0000>${count}</col>.`);
  // The generic combat-achievement NPC-death hook owns kill-count achievements.
  announce(kills);
  player.setAttribute(key, kills);
  player.getPacketSender().sendConfig(Common.ids.varps[awakened ? 'awakenedKills' : 'kills'], kills);
  const bestKey = awakened ? Common.AWAKENED_BEST_ATTRIBUTE : Common.BEST_ATTRIBUTE;
  const previous = Common.count(player, bestKey), ticks = fight.finishedTicks;
  if (!previous || ticks < previous) player.setAttribute(bestKey, ticks);
  if (!previous || ticks < previous) Common.api.emitCustomEvent('boss:personal-best', { player, boss: `${awakened ? 'Awakened ' : ''}${BOSS_NAME}`, ticks });
  Records.won(fight);
  player.sendMessage(`Fight duration: ${(ticks * 0.6).toFixed(1)} seconds${!previous || ticks < previous ? ' (new personal best)' : ''}.`);
  const complete = task => Common.api.emitCustomEvent('combat-achievements:complete', { player, task });
  if (awakened) complete('Leviathan Sleeper');
  else {
    if (fight.unconventional.eligible && fight.unconventional.fired) complete('Unconventional');
    if (fight.perfect && ++session.perfectKills >= 5) complete('Perfect Leviathan');
    if (fight.stuns <= 1) complete('Serpentine Solo');
    if (!fight.onSlayerTask) for (const [name, seconds] of [['Trialist', 110], ['Chaser', 85], ['Runner', 70]])
      if (ticks * 0.6 < seconds) complete(`Leviathan Speed-${name}`);
  }
  session.scheduleRespawn?.(fight);
}
function counts(request) { const count = Common.count(request.player, Common.KILLS_ATTRIBUTE); if (count) request.counts[MONSTER] = Math.max(count, Number(request.counts[MONSTER]) || 0); }
function best(request) {
  if (request.monster !== MONSTER) return;
  const own = Common.count(request.player, Common.BEST_ATTRIBUTE);
  if (own > 0) request.best = request.best > 0 ? Math.min(request.best, own) : own;
}
function login({ player }) {
  const kills = Common.normalKills(player);
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.kills, kills);
  player.getPacketSender().sendConfig(Common.ids.varps.awakenedKills, Common.count(player, Common.AWAKENED_KILLS_ATTRIBUTE));
}
function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_BEST_ATTRIBUTE, 0);
  api.onNpcDeath(died);
  api.onPlayerLogin(login);
  api.onCustomEvent('npc-drops:context', context);
  api.onCustomEvent('npc-drops:location', location);
  api.onCustomEvent('combat-achievements:kill-count', counts);
  api.onCustomEvent('combat-achievements:personal-best', best);
}
module.exports = { attach };
