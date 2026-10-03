/**
 * Woodcutting Guild (OSRS Wiki): level 60 Woodcutting to go through the entrance gates, and an
 * invisible +7 Woodcutting boost to the cut chance anywhere inside.
 */
const GUILD_LEVEL = 60;
const INVISIBLE_BOOST = 7;

// OSRS Wiki map outline of the guild grounds.
const GUILD_OUTLINE = [
  [1565, 3499], [1563, 3497], [1563, 3478], [1564, 3477], [1582, 3477], [1587, 3472], [1595, 3472],
  [1596, 3473], [1596, 3480], [1601, 3485], [1601, 3497], [1607, 3497], [1607, 3492], [1612, 3487],
  [1617, 3487], [1623, 3493], [1632, 3493], [1633, 3492], [1633, 3490], [1634, 3489], [1648, 3489],
  [1656, 3497], [1656, 3502], [1657, 3502], [1658, 3503], [1658, 3507], [1655, 3510], [1655, 3516],
  [1654, 3517], [1633, 3517], [1631, 3519], [1624, 3519], [1621, 3516], [1612, 3516], [1610, 3514],
  [1608, 3514], [1607, 3513], [1607, 3511], [1604, 3511], [1604, 3506], [1607, 3506], [1607, 3501],
  [1601, 3501], [1601, 3503], [1600, 3504], [1582, 3504], [1577, 3499],
];

let core = null;
let guildBoundary = null;
let gateIds = new Set();

function isInGuild(player) {
  return !!guildBoundary && guildBoundary.inside(player.getLocation());
}

function invisibleBoost(player) {
  return isInGuild(player) ? INVISIBLE_BOOST : 0;
}

// Leaving is always allowed; only players outside the grounds are checked.
function guardGuildGate(request) {
  if (!gateIds.has(request.objectId) || isInGuild(request.player)) {
    return;
  }
  const level = request.player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
  if (level >= GUILD_LEVEL) {
    return;
  }
  request.player.sendMessage(`You need a Woodcutting level of ${GUILD_LEVEL} to enter the Woodcutting Guild.`);
  request.handled = true;
}

function attach(api) {
  core = api.core;
  guildBoundary = new core.PolygonalBoundary(GUILD_OUTLINE);
  gateIds = new Set([core.ObjectIdentifiers.GATE_182, core.ObjectIdentifiers.GATE_183]);
  api.onCustomEvent("door:toggle", guardGuildGate);
}

module.exports = { attach, isInGuild, invisibleBoost };
