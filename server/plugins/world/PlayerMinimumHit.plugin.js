// OSRS Project Rebalance, 29 May 2024:
// https://secure.runescape.com/m=news/project-rebalance-combat-changes?oldschool=1
// World plugins load after mode/skill roll modifiers; defences are applied after this hook.
function minimumPlayerHit(event) {
  if (event.attacker.isPlayer() && event.damage === 0 && event.maximum > 0) {
    event.damage = 1;
  }
}

module.exports = {
  name: "PlayerMinimumHit",
  register(api) {
    api.onCustomEvent("combat:hit-rolled", minimumPlayerHit);
  },
};
