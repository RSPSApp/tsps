/**
 * Ascension crossbows (Wiki: Ascension crossbows): a 3-tick (2 on Rapid), range 6 crossbow that
 * fires only ascension bolts and their gem-tipped variants. It has no special attack or passive.
 * Ammo, range and speed are in RangedData.ts, WeaponProfile.ts and the cache (item param 14).
 *
 * The animation alternates between the two crossbows on every shot, and remembers the side across
 * targets (Mod Hend, cited on the Wiki): tfa_human_ascension_crossbow_fire_left/right, and the
 * _pvn pair against NPCs. WeaponProfile.ts plays the left; the right replaces it on every other shot.
 */
const LAST_SIDE_RIGHT_ATTRIBUTE = "ascension-crossbows:last-side-right";
/** Cache seqs: tfa_human_ascension_crossbow_fire_right and fire_right_pvn. */
const FIRE_RIGHT_ANIMATION = 15115;
const FIRE_RIGHT_NPC_ANIMATION = 15116;

let core;
let method = null;

function createMethod() {
  return new (class AscensionCrossbowsCombatMethod extends core.RangedCombatMethod {
    start(character, target) {
      super.start(character, target);
      const player = character.getAsPlayer();
      const right = player.getAttribute(LAST_SIDE_RIGHT_ATTRIBUTE) !== true;
      player.setAttribute(LAST_SIDE_RIGHT_ATTRIBUTE, right);
      if (right) {
        player.performAnimation(new core.Animation(target.isNpc() ? FIRE_RIGHT_NPC_ANIMATION : FIRE_RIGHT_ANIMATION));
      }
    }
  })();
}

function resolveCrossbows(attacker) {
  if (!attacker?.isPlayer?.()) return null;
  const weapon = attacker.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  if (Number(weapon?.getId?.()) !== core.ItemIdentifiers.ASCENSION_CROSSBOWS) return null;
  return (method ??= createMethod());
}

module.exports = {
  name: "AscensionCrossbows",
  description: "Ascension crossbows: fires ascension bolts and alternates the left and right firing animations on every shot.",
  members: true,
  register(api) {
    core = api.core;
    api.registerCombatMethodResolver({ resolve: resolveCrossbows });
  },
  _test: { resolveCrossbows, LAST_SIDE_RIGHT_ATTRIBUTE },
};
