// Fighting from a boat's deck with ordinary weapons (Wiki: Boat combat): a player aboard can
// attack sea creatures with ranged and magic, measured from where the boat is on the sea (core's
// CombatPosition), but not with melee, and nothing ashore. Core leaves any fight across a deck to
// content, so this says yes to those and nothing else. Only from the player's own boat: a creature
// fights back by attacking that boat (Creatures.SeaCombat.js), which another ship's deck isn't.
// A global hook, as the rule spans two areas (a deck and the sea); its first checks are the cheap
// ones, so attacks elsewhere pass through at once.
const common = require("./Common.SeaCombat");

const CANT_REACH = "I can't reach that!";

function canAttack(event) {
  const { attacker, target, method } = event;
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !common.creatureOf(target)) return;
  const { CombatPosition, CombatType, Sailing } = common.core();
  if (!CombatPosition.acrossDeck(attacker, target) || !Sailing.instanceAboard(attacker)) return;
  if (method?.type?.() === CombatType.MELEE) {
    event.allow = false;
    event.message = CANT_REACH;
    return;
  }
  event.allow = true;
}

function attach(api) {
  common.init(api);
  api.onCanAttack(canAttack);
}

module.exports = attach;
module.exports.canAttack = canAttack;
