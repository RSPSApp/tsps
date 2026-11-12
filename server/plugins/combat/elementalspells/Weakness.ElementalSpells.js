const Common = require('./Common.ElementalSpells');
function maximumHit(request) {
  if (!request.attacker?.isPlayer?.()) return;
  const percent = Common.weakness(request.target, request.spell, request.attacker);
  if (percent) request.maxHit += Math.floor(request.baseMaxHit * percent / 100);
}
function attackRoll(request) {
  if (!request.attacker?.isPlayer?.()) return;
  const percent = Common.weakness(request.target, request.spell, request.attacker);
  if (percent) request.attackRoll += Math.floor(request.baseAttackRoll * percent / 100);
}
function attach(api) {
  api.onCustomEvent('combat:magic-max-hit', maximumHit);
  api.onCustomEvent('combat:magic-attack-roll', attackRoll);
}
module.exports = { attach };
