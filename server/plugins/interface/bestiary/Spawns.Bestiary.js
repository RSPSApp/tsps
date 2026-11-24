const MAX_SOURCE_ROWS = 100000;
const MAX_CANDIDATES = 4096;
const MAX_PINS = 256;
const MAX_WORLD_TILE = 16383;

function point(location) {
  if (!location) return null;
  const x = location.getX(), y = location.getY(), plane = location.getZ();
  return Number.isInteger(x) && x >= 0 && x <= MAX_WORLD_TILE
    && Number.isInteger(y) && y >= 0 && y <= MAX_WORLD_TILE
    && Number.isInteger(plane) && plane >= 0 && plane <= 3 ? { x, y, plane } : null;
}
function knownSpawns(core, player, npcId) {
  const ids = new Set(Array.isArray(npcId) ? npcId : [npcId]);
  const points = new Map();
  let limited = false;
  function add(location) {
    const p = point(location);
    if (!p) return;
    const key = `${p.x}:${p.y}:${p.plane}`;
    if (points.has(key)) return;
    if (points.size >= MAX_CANDIDATES) { limited = true; return; }
    points.set(key, p);
  }
  const definitions = core.NpcSpawnDefinition.all();
  for (let i = 0; i < Math.min(definitions.length, MAX_SOURCE_ROWS); i++) {
    const spawn = definitions[i], id = spawn.getId();
    const cached = core.CacheDefinitions.getNpc(id);
    if (!ids.has(id) && !cached.transforms?.some(id => ids.has(id))) continue;
    // A transform parent is a location only for the player's resolved variant.
    const visibleId = cached.transforms ? core.CacheDefinitions.resolveNpc(id, player.getPacketSender())?.id : id;
    if (ids.has(visibleId)) add(spawn.getPosition());
  }
  if (definitions.length > MAX_SOURCE_ROWS) limited = true;
  let visited = 0;
  for (const npc of core.World.getNpcs()) {
    if (++visited > MAX_SOURCE_ROWS) { limited = true; break; }
    if (!npc || !npc.isRegistered() || !npc.isVisible() || npc.getOwner() || npc.isOwnerOnly()
      || npc.getPrivateArea() || npc.getArea()?.countsAsMainWorld?.() === false
      || !ids.has(npc.getContentId(player))) continue;
    add(npc.getSpawnPosition());
  }
  const here = point(player.getLocation());
  const distance = p => here ? Math.hypot(p.x - here.x, p.y - here.y) + (p.plane === here.plane ? 0 : 100000) : 0;
  const all = [...points.values()].sort((a, b) => distance(a) - distance(b) || a.plane - b.plane || a.x - b.x || a.y - b.y);
  return { points: all.slice(0, MAX_PINS), limited: limited || all.length > MAX_PINS };
}
module.exports = { knownSpawns, point, MAX_PINS, MAX_CANDIDATES, MAX_SOURCE_ROWS };
