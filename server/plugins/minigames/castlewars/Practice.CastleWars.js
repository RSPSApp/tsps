"use strict";

const { planRoute } = require("../../bots/behaviours/navigation/LongRoutePlanner.PlayerBots");

let core;
let game;
const SCORER = "scorer";
const DEFENDER = "defender";
const ACTION_INTERVAL_MS = 600;
const CLEAR_REACTION_MS = 1200;
const CLEAR_TIMEOUT_MS = 8000;
const CLEAR_RETRY_MS = 6000;
const DEFENCE_INTERVAL_MS = 6000;
const DEFENCE_ENEMY_RANGE = 8;
const DEFENCE_LIGHT_TIMEOUT_MS = 3000;

function isPractice(role) {
  return role === SCORER || role === DEFENDER;
}

function gear(player, slot, id) {
  if (player.getEquipment().getSlot(slot) === id) return false;
  player.getEquipment().setItem(slot, new core.Item(id, 1));
  return true;
}

function supply(player, id, amount = 1) {
  const inventory = player.getInventory();
  if (inventory.getAmount(id) < amount) inventory.adds(id, amount - inventory.getAmount(id));
}

function tileDistance(a, b) {
  return Math.abs(a.getX() - b.getX()) + Math.abs(a.getY() - b.getY());
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
}

function sameAreaAndFloor(player, npc) {
  return npc.getLocation().getZ() === player.getLocation().getZ()
    && npc.getPrivateArea?.() === player.getPrivateArea?.();
}

function reachable(player, npc) {
  return sameTile(player.getLocation(), npc.getLocation()) || core.PathFinder.reachedEntity(player, npc);
}

function inTeamRespawn(teamId, location) {
  const bounds = teamId == null ? null : game.getTeamData?.(teamId)?.respawnBounds;
  return Boolean(bounds && bounds.inside(location));
}

function inRespawn(player, location) {
  return inTeamRespawn(game.getTeamId?.(player), location);
}

function inAnyRespawn(player, location) {
  if (inRespawn(player, location)) return true;
  const teamId = game.getTeamId?.(player);
  return inTeamRespawn(game.opposingTeam?.(teamId), location);
}

function useOnBarricade(player, npc, itemId, options = {}) {
  if (!npc || !game.isBarricade(npc) || !sameAreaAndFloor(player, npc)) return false;
  const location = player.getLocation();
  const npcLocation = npc.getLocation();
  if (inRespawn(player, location) || inAnyRespawn(player, npcLocation)) return false;
  const dx = Math.abs(npcLocation.getX() - location.getX());
  const dy = Math.abs(npcLocation.getY() - location.getY());
  const overlapping = dx === 0 && dy === 0;
  const cardinal = dx + dy === 1;
  // Overlap is only for a freshly placed barricade being lit; the native handler steps aside.
  if (!cardinal && !(overlapping && options.allowOverlap === true && itemId === core.ItemIdentifiers.TINDERBOX)) return false;
  if (!overlapping && !core.PathFinder.reachedEntity(player, npc)) return false;
  // Practice opponents keep tool supplies available for the full session.
  if (itemId === core.ItemIdentifiers.BUCKET_OF_WATER && !player.getInventory().contains(itemId)) player.getInventory().delete(core.ItemIdentifiers.BUCKET, 1);
  supply(player, itemId);
  const slot = player.getInventory().getSlotForItemId(itemId);
  if (slot < 0) return false;
  return core.PluginManager.emitItemOnNpc({ player, target: npc, definition: npc.getCurrentDefinition(player), npcId: npc.getContentId(player), targetIndex: npc.getIndex(), item: player.getInventory().getItems()[slot], itemId, slot, interfaceId: 0, handled: false });
}

function nearestBarricade(player, radius) {
  let nearest = null;
  let distance = radius + 1;
  for (const npc of core.World.getNpcs()) {
    if (!npc || !game.isBarricade(npc) || !sameAreaAndFloor(player, npc)) continue;
    const next = tileDistance(player.getLocation(), npc.getLocation());
    if (next < distance && reachable(player, npc)) { nearest = npc; distance = next; }
  }
  return nearest;
}

function goalKey(goal) {
  return goal ? `${goal[0]},${goal[1]},${goal[2]}` : "";
}

function queuedNextPosition(player) {
  const points = player.getMovementQueue?.().pointsReturn?.() ?? [];
  return points.find((point) => !sameTile(point.position, player.getLocation()))?.position ?? null;
}

/** The next tile movement is actually taking, preferring the queued path over a derived one. */
function nextRouteTile(player, goal) {
  if (!goal) return null;
  const queued = queuedNextPosition(player);
  if (queued) return queued;
  core.PathFinder.calculateWalkRoute?.(player, goal[0], goal[1]);
  return queuedNextPosition(player);
}

function intendedCardinalStep(player, next) {
  if (!next) return null;
  const location = player.getLocation();
  if (next.getZ() !== location.getZ()) return null;
  const dx = Math.sign(next.getX() - location.getX());
  const dy = Math.sign(next.getY() - location.getY());
  if (dx === 0 && dy === 0) return null;
  if (dx !== 0 && dy !== 0) {
    const movement = player.getMovementQueue();
    // Match movement's diagonal/cardinal fallbacks: only clear when none can advance.
    if ([[dx, dy], [dx, 0], [0, dy]].some(([x, y]) => movement.canWalkTo(location.transform(x, y), location))) return null;
  }
  return { x: location.getX() + dx, y: location.getY() + dy, z: location.getZ(), diagonal: dx !== 0 && dy !== 0 };
}

function barricadeBlocksNext(player, npc, next) {
  if (!next || !game.isBarricade(npc) || npc.isRegistered?.() === false || npc.getHitpoints?.() <= 0 || !sameAreaAndFloor(player, npc)) return false;
  const location = player.getLocation();
  const npcLocation = npc.getLocation();
  if (inRespawn(player, location) || inAnyRespawn(player, npcLocation)) return false;
  const step = intendedCardinalStep(player, next);
  if (!step || tileDistance(location, npcLocation) !== 1) return false;
  const blocks = step.diagonal
    ? (npcLocation.getX() === step.x && npcLocation.getY() === location.getY())
      || (npcLocation.getX() === location.getX() && npcLocation.getY() === step.y)
    : npcLocation.getX() === step.x && npcLocation.getY() === step.y;
  if (!blocks) return false;
  return core.PathFinder.reachedEntity(player, npc);
}

function barricadeBlocksGoal(player, npc, goal) {
  return barricadeBlocksNext(player, npc, nextRouteTile(player, goal));
}

function blockingBarricade(player, goal) {
  const next = nextRouteTile(player, goal);
  if (!next) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const npc of core.World.getNpcs()) {
    if (!barricadeBlocksNext(player, npc, next)) continue;
    const distance = tileDistance(player.getLocation(), npc.getLocation());
    if (distance < bestDistance) { best = npc; bestDistance = distance; }
  }
  return best;
}

function stillBlocking(player, npc, goal) {
  if (!Array.from(core.World.getNpcs()).includes(npc)) return false;
  return barricadeBlocksNext(player, npc, nextRouteTile(player, goal));
}

/** Walk around our own defences when possible instead of dismantling the team's practice course. */
function walkAroundBarricades(player, goal) {
  const location = player.getLocation();
  const blocked = new Set();
  for (const npc of core.World.getNpcs()) {
    if (game.isBarricade(npc) && sameAreaAndFloor(player, npc)) {
      const at = npc.getLocation();
      blocked.add(`${at.getX()},${at.getY()}`);
    }
  }
  const route = planRoute({
    from: { x: location.getX(), y: location.getY(), z: location.getZ() },
    to: { x: goal[0], y: goal[1], z: goal[2] },
    getFlag: (x, y, z) => game.isInsideCastle?.({ x, y, z }, game.getTeamId(player)) === false
      ? core.RegionManager.BLOCKED_TILE
      : core.RegionManager.getClipping(x, y, z, player.getPrivateArea())
        | (blocked.has(`${x},${y}`) ? core.RegionManager.BLOCKED_TILE : 0),
    maxExpansions: 4096, exactOnly: true, goalReach: blocked.has(`${goal[0]},${goal[1]}`) ? 1 : 0,
  });
  if (!route?.waypoints?.length) return false;
  const movement = player.getMovementQueue();
  movement.reset(false);
  for (const point of route.waypoints) movement.addCheckpoint(new core.Location(point.x, point.y, point.z));
  return true;
}

function scorerTools(ctx, state) {
  const player = ctx.player;
  const goal = state.practiceGoal;
  const key = goalKey(goal);
  const playerInSpawn = inRespawn(player, player.getLocation());
  let pending = state.pendingClear;
  if (pending && (playerInSpawn || pending.goalKey !== key || !stillBlocking(player, pending.npc, goal))) {
    state.pendingClear = null;
    pending = null;
  }
  if (playerInSpawn) return "failure";
  if (!pending) {
    const npc = blockingBarricade(player, goal);
    if (!npc) return "failure";
    const post = state.role === DEFENDER ? state.defenderPost : null;
    const at = npc.getLocation();
    if (post && at.getX() === post[0] && at.getY() === post[1] && at.getZ() === post[2]) return "failure";
    if (state.role === DEFENDER && npc.castleWarsTeam === game.getTeamId(player) && walkAroundBarricades(player, goal)) return "running";
    if (state.clearBackoff?.npc === npc && state.clearBackoff.goalKey === key && ctx.nowMs < state.clearBackoff.until) return "failure";
    // React to a newly selected obstruction after the same beat a player would need.
    state.pendingClear = { npc, goalKey: key, startedAt: ctx.nowMs, at: ctx.nowMs + CLEAR_REACTION_MS };
    return "running";
  }
  if (ctx.nowMs - pending.startedAt >= CLEAR_TIMEOUT_MS) {
    state.clearBackoff = { npc: pending.npc, goalKey: key, until: ctx.nowMs + CLEAR_RETRY_MS };
    state.pendingClear = null;
    return "failure";
  }
  if (ctx.nowMs < pending.at) return "running";
  const burning = pending.npc.getNpcTransformationId() !== -1;
  useOnBarricade(player, pending.npc, burning ? core.ItemIdentifiers.BUCKET_OF_WATER : core.ItemIdentifiers.EXPLOSIVE_POTION);
  pending.at = ctx.nowMs + CLEAR_REACTION_MS;
  state.nextToolAt = pending.at;
  return "running";
}

function defenderTools(ctx, state, target) {
  const player = ctx.player;
  if (inAnyRespawn(player, player.getLocation())) return "failure";
  const I = core.ItemIdentifiers;
  const npc = nearestBarricade(player, 1);
  if (npc && ctx.nowMs >= (state.nextToolAt ?? 0)) {
    const teamId = game.getTeamId?.(player);
    const own = teamId != null && npc.castleWarsTeam === teamId;
    const burning = npc.getNpcTransformationId() !== -1;
    const intruderClose = Boolean(target) && player.calculateDistance(target) <= 3;
    const overlapping = sameTile(player.getLocation(), npc.getLocation());
    // Keep a burning blockade while an intruder is on it; a quiet own barricade is saved
    // from an adjacent tile (the native handler cannot douse while standing on it).
    const item = burning
      ? own && !intruderClose && !overlapping ? I.BUCKET_OF_WATER : null
      : intruderClose ? I.TINDERBOX : null;
    if (item) {
      const used = useOnBarricade(player, npc, item, { allowOverlap: item === I.TINDERBOX });
      state.nextToolAt = ctx.nowMs + 1800;
      if (used) {
        return "running";
      }
    }
  }
  const post = state.practicePost;
  if (!post) return "failure";
  const location = player.getLocation();
  if (location.getX() !== post[0] || location.getY() !== post[1] || location.getZ() !== post[2]) return "failure";
  if (ctx.nowMs < (state.nextBarricadeAt ?? 0)) return "failure";
  const teamId = game.getTeamId?.(player);
  const limit = game.getBarricadeLimit?.();
  if (limit != null && (game.teamBarricadeCount?.(teamId) ?? 0) >= limit) return "failure";
  const inventory = player.getInventory();
  supply(player, I.BARRICADE);
  const before = inventory.getAmount(I.BARRICADE);
  const barricadeSlot = inventory.getSlotForItemId(I.BARRICADE);
  if (barricadeSlot < 0) return "failure";
  core.PluginManager.emitItemAction({ player, itemId: I.BARRICADE, item: inventory.getItems()[barricadeSlot], slot: barricadeSlot, interfaceId: 0, clickType: 1, option: "Set-up", handled: false });
  const placed = inventory.getAmount(I.BARRICADE) < before;
  state.nextBarricadeAt = ctx.nowMs + (placed ? 6000 : 1200);
  if (!placed) return "failure";
  state.nextToolAt = ctx.nowMs + ACTION_INTERVAL_MS;
  return "running";
}

function findBarricadeAt(player, location) {
  for (const npc of core.World.getNpcs()) {
    if (!npc || !game.isBarricade(npc)) continue;
    const npcLocation = npc.getLocation();
    if (npcLocation.getX() !== location.getX() || npcLocation.getY() !== location.getY()
        || npcLocation.getZ() !== location.getZ() || !sameAreaAndFloor(player, npc)) continue;
    return npc;
  }
  return null;
}

function behindTravel(player, targetLocation, travel) {
  const location = player.getLocation();
  const dx = Math.sign(travel.getX() - location.getX());
  const dy = Math.sign(travel.getY() - location.getY());
  if (dx === 0 && dy === 0) return false;
  return (targetLocation.getX() - location.getX()) * dx + (targetLocation.getY() - location.getY()) * dy < 0;
}

/**
 * A running scorer drops a defensive barricade behind a pursuer, then steps aside and lights
 * it on the next beats. New placements are throttled; finishing an already placed one is not.
 */
function scorerDefence(ctx, state, target) {
  const player = ctx.player;
  const I = core.ItemIdentifiers;
  const location = player.getLocation();
  if (inRespawn(player, location)) {
    state.scorerDefenceLight = null;
    return "failure";
  }
  const pendingLight = state.scorerDefenceLight;
  if (pendingLight) {
    const npc = pendingLight.npc;
    if (!npc || !game.isBarricade(npc) || !sameAreaAndFloor(player, npc)) {
      state.scorerDefenceLight = null;
      return "failure";
    }
    if (npc.getNpcTransformationId() !== -1) {
      state.scorerDefenceLight = null;
      return "running";
    }
    if (ctx.nowMs - pendingLight.at > DEFENCE_LIGHT_TIMEOUT_MS) {
      state.scorerDefenceLight = null;
      return "failure";
    }
    const distance = tileDistance(location, npc.getLocation());
    if (distance > 1) {
      state.scorerDefenceLight = null;
      return "failure";
    }
    if (distance === 0) return "running";
    const used = useOnBarricade(player, npc, I.TINDERBOX);
    if (!used) {
      state.scorerDefenceLight = null;
      return "failure";
    }
    if (npc.getNpcTransformationId() !== -1) state.scorerDefenceLight = null;
    return "running";
  }
  if (!target || ctx.nowMs < (state.nextDefencePlaceAt ?? 0)) return "failure";
  const goal = state.practiceGoal;
  if (!goal) return "failure";
  if (goal[2] === location.getZ() && goal[0] === location.getX() && goal[1] === location.getY()) return "failure";
  const movement = player.getMovementQueue?.();
  const travel = queuedNextPosition(player);
  if (!travel || movement?.isStepBlocked?.() || state.pendingClimb) return "failure";
  const targetLocation = target.getLocation?.();
  if (!targetLocation || targetLocation.getZ() !== location.getZ()) return "failure";
  if (Math.max(Math.abs(targetLocation.getX() - location.getX()), Math.abs(targetLocation.getY() - location.getY())) > DEFENCE_ENEMY_RANGE) return "failure";
  if (target.getPrivateArea?.() !== player.getPrivateArea?.() || !behindTravel(player, targetLocation, travel)) return "failure";
  if (state.pendingClear || blockingBarricade(player, goal)) return "failure";
  const teamId = game.getTeamId?.(player);
  const limit = game.getBarricadeLimit?.();
  if (limit != null && (game.teamBarricadeCount?.(teamId) ?? 0) >= limit) return "failure";
  const dx = Math.sign(travel.getX() - location.getX());
  const dy = Math.sign(travel.getY() - location.getY());
  const exit = [[dx, 0], [0, dy]].find(([x, y]) => (x !== 0 || y !== 0) && movement.canWalkTo(location.transform(x, y), location));
  if (!exit) return "failure";
  const inventory = player.getInventory();
  supply(player, I.BARRICADE);
  const before = inventory.getAmount(I.BARRICADE);
  const slot = inventory.getSlotForItemId(I.BARRICADE);
  if (slot < 0) return "failure";
  core.PluginManager.emitItemAction({ player, itemId: I.BARRICADE, item: inventory.getItems()[slot], slot, interfaceId: 0, clickType: 1, option: "Set-up", handled: false });
  state.nextDefencePlaceAt = ctx.nowMs + DEFENCE_INTERVAL_MS;
  if (inventory.getAmount(I.BARRICADE) >= before) return "failure";
  // Stop the route for the short place/step-off/light sequence; the next beats pause anyway.
  movement.reset(false);
  movement.walkStep(exit[0], exit[1]);
  const placed = findBarricadeAt(player, location);
  if (placed) state.scorerDefenceLight = { npc: placed, at: ctx.nowMs };
  return "running";
}

function defenderAttack(ctx, state, target) {
  if (!target) return "failure";
  const player = ctx.player;
  const spear = player.calculateDistance(target) === 1 && target.getTimers().has(core.TimerKey.FREEZE) && player.getSpecialPercentage() >= 25;
  if (gear(player, core.Equipment.WEAPON_SLOT, spear ? core.ItemIdentifiers.ZAMORAKIAN_HASTA : core.ItemIdentifiers.KODAI_WAND)) game.refreshPlayerAppearance(player, true);
  if (spear) {
    player.getCombat().setCastSpell(null);
    player.getCombat().setAutocastSpell(null);
    player.setSpecialActivated(true);
    player.getCombat().attack(target);
  } else {
    player.setSpecialActivated(false);
    const level = player.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
    const spell = [core.CombatSpells.ICE_BARRAGE, core.CombatSpells.ICE_BLITZ, core.CombatSpells.ICE_BURST, core.CombatSpells.ICE_RUSH]
      .map((entry) => entry.getSpell()).find((spell) => spell.levelRequired() <= level);
    if (!spell) { player.getCombat().attack(target); return "running"; }
    core.Autocasting.setAutocast(player, spell);
    player.getCombat().castSpellOn(target, spell);
  }
  return "running";
}

module.exports = function attachCastleWarsPractice(api, castleWars) {
  core = api.core;
  game = castleWars;
  game.practiceBots = { supply, scorerTools, scorerDefence, defenderTools, defenderAttack };
};

module.exports._test = { SCORER, DEFENDER, isPractice, nearestBarricade, useOnBarricade, barricadeBlocksGoal, blockingBarricade, scorerTools, scorerDefence, defenderTools, defenderAttack };
