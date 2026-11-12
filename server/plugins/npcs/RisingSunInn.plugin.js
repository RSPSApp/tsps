/**
 * Emily stands behind the Rising Sun Inn bar. The counter blocks both the approach
 * tile and projectile line from the public side, so Talk-to needs the nearest
 * reachable side of the counter as its interaction range.
 */
const EMILY = 1315;
const PUBLIC_SIDE_X = 2955;
const EMILY_WANDER_BOUNDS = { minX: 2952, maxX: 2956, minY: 3371, maxY: 3375 };

function routeEmilyTalk(event) {
  if (event.npcId !== EMILY || event.clickType !== 1) return;
  const { player, location } = event;
  const playerLocation = player?.getLocation?.();
  if (playerLocation?.getZ() !== 0 || playerLocation.getX() < PUBLIC_SIDE_X) return;
  if (location?.z !== 0 || location.x < EMILY_WANDER_BOUNDS.minX || location.x > EMILY_WANDER_BOUNDS.maxX
    || location.y < EMILY_WANDER_BOUNDS.minY || location.y > EMILY_WANDER_BOUNDS.maxY) return;
  event.range = 2;
  event.ignoreProjectileClip = true;
}

module.exports = {
  name: "RisingSunInn",
  description: "Lets players talk to Emily across the Rising Sun Inn bar.",
  register(api) {
    api.onNpcRoute(routeEmilyTalk);
  },
};
