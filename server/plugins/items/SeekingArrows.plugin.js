/** Wiki: Seeking dragon arrow raises successful bow hits to at least three; special minima do not stack. */
let core;

function seekingMinimum(event) {
  const { attacker, damage, accurate } = event;
  if (!accurate || !attacker?.isPlayer?.() || event.combatType !== core.CombatType.RANGED) return;
  const player = attacker.getAsPlayer();
  if (player.isSpecialActivated()) return;
  const ammunition = player.getCombat().getAmmunition();
  if (ammunition === core.Ammunition.SEEKING_DRAGON_ARROW) damage.setDamage(Math.max(3, damage.getDamage()));
}

module.exports = {
  name: "SeekingArrows",
  members: true,
  register(api) {
    core = api.core;
    api.onCombatHitDamage(seekingMinimum);
  },
};
