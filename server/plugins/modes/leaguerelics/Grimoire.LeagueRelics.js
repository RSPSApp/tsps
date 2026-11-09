/**
 * Grimoire (https://oldschool.runescape.wiki/w/Grimoire_(Raging_Echoes_League)), Raging Echoes'
 * tier 7 relic: every spell's area, quest or diary requirement is lifted (`magic:spell-unlocked`:
 * here, the Mage Arena's god spells outside the arena without their 100 casts). The Prayer level
 * itself still counts (Wiki), and this server gates no prayer by quest. Not here: the Arcane
 * grimoire's spellbook swap (the item's own plugin, Leagues polish).
 *
 * Demonic Pacts' Grimoire (tier 6) is the same, and also unlocks every prayer whatever its quest
 * or unlock (`prayer:unlocks-bypass`, for the effect's `prayersLeagues`); its Arcane grimoire comes
 * from the cache's relic struct.
 */
const Common = require("./Common.LeagueRelics");

let effect;

function unlocked(request) {
  if (Common.effectActive(request.player, effect)) request.unlocked = true;
}

function prayersUnlocked(request) {
  if (effect.prayersLeagues?.includes(Common.leagueOf(request.player)) && Common.effectActive(request.player, effect)) request.bypass = true;
}

/**
 * Choosing the relic (or a relic reset) changes what the prayer book may show: live sends the
 * Knight Waves state and the three scroll flags with the relic's message (capture 237/01107).
 */
function syncPrayerBook({ player, relic }) {
  if (relic !== undefined && ![effect.key, ...(effect.aliases ?? [])].includes(relic)) return;
  if (!effect.prayersLeagues?.includes(Common.leagueOf(player))) return;
  Common.api.emitCustomEvent("prayer:sync-unlocks", { player });
}

module.exports = function attach(api) {
  effect = Common.data.effects.grimoire;
  api.onCustomEvent("magic:spell-unlocked", unlocked);
  api.onCustomEvent("prayer:unlocks-bypass", prayersUnlocked);
  api.onCustomEvent("league:relic-unlocked", syncPrayerBook);
  api.onCustomEvent("league:relics-reset", syncPrayerBook);
};
