// Collision-aware placement shared by the AdminCommands panel-spawn event.
// Uses ordinary collision even while the actor has noclip enabled.
const MAX_BATCH = 20;
const RADIUS = 10;
const ROUTE_RADIUS = RADIUS * 2;
const DIRECTIONS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
function fail(message) { throw new Error(message); }
function inside(core, area, x, y, z) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1 || x > 16383 || y > 16383) return false;
  if (!core.RegionManager.getRegion(x, y)) return false;
  const tile = new core.Location(x, y, z);
  const boundaries = area?.getBoundaries?.();
  return !boundaries?.length || boundaries.some(boundary => boundary.inside(tile));
}
function fits(core, area, x, y, z, size) {
  for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) {
    if (!inside(core, area, x + dx, y + dy, z)) return false;
    const tile = new core.Location(x + dx, y + dy, z);
    if (core.RegionManager.blocked(tile, area) || core.World.isPlayerBlockingNpcOnTile(tile,1,area)) return false;
    // A large creature must not straddle an internal wall between clear tiles.
    if (dx && !core.RegionManager.canMovestart(new core.Location(x + dx - 1, y + dy, z), tile, 1, 1, area)) return false;
    if (dy && !core.RegionManager.canMovestart(new core.Location(x + dx, y + dy - 1, z), tile, 1, 1, area)) return false;
  }
  return true;
}
function overlaps(first, second, size) {
  return first.getX() < second.getX() + size && first.getX() + size > second.getX()
    && first.getY() < second.getY() + size && first.getY() + size > second.getY();
}
function reachableTiles(core, origin, area) {
  const x = origin.getX(), y = origin.getY(), z = origin.getZ();
  const reachable = new Set([`${x},${y}`]), queue = [origin];
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index];
    for (const [dx,dy] of DIRECTIONS) {
      const nextX = tile.getX()+dx, nextY = tile.getY()+dy, key = `${nextX},${nextY}`;
      if (reachable.has(key) || Math.max(Math.abs(nextX-x),Math.abs(nextY-y)) > ROUTE_RADIUS
        || !inside(core,area,nextX,nextY,z)) continue;
      const next = new core.Location(nextX,nextY,z);
      if (core.RegionManager.blocked(next,area) || core.World.isPlayerBlockingNpcOnTile(next,1,area)
        || !core.RegionManager.canMovestart(tile,next,1,1,area)) continue;
      if (dx && dy && (core.World.isPlayerBlockingNpcOnTile(new core.Location(nextX,tile.getY(),z),1,area)
        || core.World.isPlayerBlockingNpcOnTile(new core.Location(tile.getX(),nextY,z),1,area))) continue;
      reachable.add(key); queue.push(next);
    }
  }
  return reachable;
}
function planLocations(core, actor, { size = 1, count, random = false, randomSource = Math.random }) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) fail(`Choose a count from 1 to ${MAX_BATCH}.`);
  if (!Number.isInteger(size) || size < 1 || size > RADIUS * 2 + 1) fail('This creature is too large to fit within the spawn area.');
  if (!random && count !== 1) fail('Spawn 1 under me creates exactly one spawn. Use Spawn X for a batch.');
  const origin = actor.getLocation().clone(), area = actor.getPrivateArea();
  if (area?.isDestroyed?.()) fail('This instance has closed. Leave it before spawning.');
  const x = origin.getX(), y = origin.getY(), z = origin.getZ();
  if (!Number.isInteger(z) || z < 0 || z > 3) fail('This plane is unavailable for spawning.');
  if (!random) {
    if (!fits(core, area, x, y, z, size)) fail('There is not enough clear space under you for this spawn. Move to an open tile.');
    return [origin];
  }
  // One bounded flood uses the same native step checks as ordinary walking.
  // Re-running a full route search for every unreachable candidate can stall a tick.
  const reachable = reachableTiles(core, origin, area), candidates = [];
  for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    if (reachable.has(`${x+dx},${y+dy}`) && fits(core, area, x + dx, y + dy, z, size)) candidates.push(new core.Location(x + dx, y + dy, z));
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const next = Math.max(0, Math.min(i, Math.floor(randomSource() * (i + 1))));
    [candidates[i], candidates[next]] = [candidates[next], candidates[i]];
  }
  const locations = [];
  for (const tile of candidates) {
    if (locations.some(other => overlaps(other, tile, size))) continue;
    locations.push(tile);
    if (locations.length === count) return locations;
  }
  fail(`Found only ${locations.length} safe, reachable spawn tiles within ${RADIUS} tiles of you. Choose a smaller count or move to an open area.`);
}
module.exports = { MAX_BATCH, RADIUS, planLocations };
