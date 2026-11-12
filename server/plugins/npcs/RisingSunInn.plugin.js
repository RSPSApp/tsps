/**
 * Emily stands behind the Rising Sun Inn bar. The counter blocks both the approach
 * tile and projectile line from the public side, so Talk-to needs the nearest
 * reachable side of the counter as its interaction range.
 */
const EMILY = 1315;

function routeEmilyTalk(event) {
  if (event.npcId !== EMILY || event.clickType !== 1) return;
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
