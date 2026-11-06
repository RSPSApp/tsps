// PK Skull Prevention (Settings > Controls): a player with the setting on cannot attack a
// player in a way that would skull them. Captured refusal (rsprox recording 4171):
// "You cannot attack this target as it would result in you getting skulled."
const SKULL_PREVENTION_VARBIT = 13131; // cache: skull_prevent_enabled
const SKULL_PREVENTION_MESSAGE = "You cannot attack this target as it would result in you getting skulled.";

let pluginApi = null;

function blockSkullAttack(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !target?.isPlayer?.()) return;
  if (!attacker.getPacketSender().getVarbit(SKULL_PREVENTION_VARBIT)) return;
  if (!pluginApi.core.CombatFactory.wouldSkull(attacker, target)) return;
  event.allow = false;
  // Only the attack the player chose says why; area-attack bystander checks
  // (canAttackSecondaryTarget, which passes no method) skip them silently, once per click as live.
  if (event.method) attacker.getPacketSender().sendMessage(SKULL_PREVENTION_MESSAGE);
}

module.exports = {
  name: "SkullPrevention",
  _test: { blockSkullAttack },
  register(api) {
    pluginApi = api;
    api.onCanAttack(blockSkullAttack);
  },
};
