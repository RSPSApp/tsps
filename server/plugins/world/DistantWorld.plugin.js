const CHANNEL = 'distant-world';
const MAX_RADIUS = 1024;
const MAX_SPAWNS = 1024;
const PAGE_SIZE = 32;
const DEFAULT_WANDER_RADIUS = 5;
const MAX_VISIBLE_MAPS = 1024;
const REQUEST_INTERVAL_MS = 750;
const requests = new WeakMap();
const catalogs = new WeakMap();

function keyFor(id, p) { return `${id}:${p.getX()}:${p.getY()}:${p.getZ()}`; }
function publicWorld(core, player) {
  return !player.getPrivateArea() && player.getArea()?.countsAsMainWorld?.() !== false
    && !core.BoatManager?.getBoatAboard(player);
}
function index(core) {
  const definitions = core.NpcSpawnDefinition.all();
  let result = catalogs.get(definitions);
  if (result) return result;
  result = new Map();
  for (const definition of definitions.slice(0, 100000)) {
    const p = definition.getPosition();
    if (!Number.isInteger(definition.getId()) || definition.getId() < 0 || definition.getId() > 2147483647) continue;
    if (!Number.isInteger(p.getX()) || p.getX() < 0 || p.getX() > 16383
      || !Number.isInteger(p.getY()) || p.getY() < 0 || p.getY() > 16383
      || !Number.isInteger(p.getZ()) || p.getZ() < 0 || p.getZ() > 3) continue;
    const region = `${p.getZ()}:${p.getX() >> 6}:${p.getY() >> 6}`;
    let rows = result.get(region);
    if (!rows) result.set(region, rows = []);
    rows.push(definition);
  }
  catalogs.set(definitions, result);
  return result;
}
function visibleType(core, player, id) {
  const base = core.CacheDefinitions.getNpc(id);
  if (!base) return null;
  return base.transforms ? core.CacheDefinitions.resolveNpc(id, player.getPacketSender()) : base;
}
function localMatches(core, player, key) {
  return player.getLocalNpcs().filter(npc => npc && npc.isRegistered() && npc.isVisible()
    && !npc.isOwnerOnly() && !npc.getOwner() && !npc.getPrivateArea()
    && npc.getArea()?.countsAsMainWorld?.() !== false
    && core.World.getNpcs().get(npc.getIndex()) === npc
    && keyFor(npc.getId(), npc.getSpawnPosition()) === key);
}
function respond(api, player, data) {
  player.getSession().sendClientPacket(api.core.encodePluginMessage(CHANNEL, data));
}
function receive(api, event) {
  if (event.channel !== CHANNEL || event.handled || !event.player) return;
  event.handled = true;
  const { player, data } = event;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  if (!Number.isSafeInteger(data.request) || data.request < 0 || !['catalog', 'resolve'].includes(data.type)) return;
  if (data.maps !== undefined && (!Array.isArray(data.maps) || data.maps.length > MAX_VISIBLE_MAPS
    || data.maps.some(id => !Number.isInteger(id) || id < 0 || id > 65535))) return;
  const state = requests.get(player) ?? { catalog: -Infinity, resolve: -Infinity, allowed: new Set() };
  const now = Date.now();
  if (now - state[data.type] < REQUEST_INTERVAL_MS) return;
  state[data.type] = now;
  requests.set(player, state);
  if (!publicWorld(api.core, player)) {
    state.allowed.clear();
    respond(api, player, { type: 'catalog', request: data.request, spawns: [], links: [], viewDistance: player.getNpcViewDistance(), supported: false });
    return;
  }
  if (data.type === 'resolve') {
    if (typeof data.key !== 'string' || !state.allowed.has(data.key)) return;
    const candidates = localMatches(api.core, player, data.key);
    respond(api, player, { type: 'resolved', request: data.request, key: data.key,
      index: candidates.length === 1 ? candidates[0].getIndex() : -1,
      typeId: candidates.length === 1 ? candidates[0].getContentId(player) : -1 });
    return;
  }
  const radius = Math.max(32, Math.min(MAX_RADIUS, Number.isFinite(data.radius) ? Math.trunc(data.radius) : 256));
  const origin = player.getLocation(), x = origin.getX(), y = origin.getY(), plane = origin.getZ();
  const preferred = new Set(data.maps ?? []);
  const regions = index(api.core), candidates = [];
  for (let rx = (x - radius) >> 6; rx <= (x + radius) >> 6; rx++) {
    for (let ry = (y - radius) >> 6; ry <= (y + radius) >> 6; ry++) {
      for (const definition of regions.get(`${plane}:${rx}:${ry}`) ?? []) {
        const p = definition.getPosition();
        const distance = Math.max(Math.abs(p.getX() - x), Math.abs(p.getY() - y));
        if (distance <= radius) candidates.push({ definition, distance, preferred: preferred.has(((p.getX() >> 6) << 8) | (p.getY() >> 6)) });
      }
    }
  }
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.distance - b.distance);
  const spawns = [], seen = new Set();
  let truncated = false;
  for (const { definition } of candidates) {
    if (spawns.length >= MAX_SPAWNS) { truncated = true; break; }
    const p = definition.getPosition(), key = keyFor(definition.getId(), p);
    if (seen.has(key)) continue;
    seen.add(key);
    let type;
    try { type = visibleType(api.core, player, definition.getId()); } catch { continue; }
    if (!type || type.id < 0 || !type.name || type.name.toLowerCase() === 'null'
      || (Array.isArray(type.modelIds) && type.modelIds.length === 0)) continue;
    const facing = definition.getFacing?.();
    const rotation = facing ? Math.round(Math.atan2(-facing.getX(), -facing.getY()) * 1024 / Math.PI) & 2047 : 0;
    spawns.push({ key, typeId: type.id ?? definition.getId(), x: p.getX(), y: p.getY(), plane,
      radius: Math.max(0, Math.min(32, definition.getRadius() ?? DEFAULT_WANDER_RADIUS)), rotation,
      name: String(type.name).replace(/<[^>]*>/g, '').slice(0, 80) });
  }
  state.allowed = new Set(spawns.map(spawn => spawn.key));
  const localByKey = new Map();
  for (const npc of player.getLocalNpcs()) {
    if (!npc || !npc.isRegistered() || !npc.isVisible() || npc.getOwner() || npc.isOwnerOnly() || npc.getPrivateArea()
      || npc.getArea()?.countsAsMainWorld?.() === false || api.core.World.getNpcs().get(npc.getIndex()) !== npc) continue;
    const key = keyFor(npc.getId(), npc.getSpawnPosition());
    if (state.allowed.has(key)) localByKey.set(key, localByKey.has(key) ? null : npc.getIndex());
  }
  const parts = Math.max(1, Math.ceil(spawns.length / PAGE_SIZE));
  for (let part = 0; part < parts; part++) {
    const page = spawns.slice(part * PAGE_SIZE, (part + 1) * PAGE_SIZE);
    const links = page.flatMap(spawn => {
      const index = localByKey.get(spawn.key);
      return Number.isInteger(index) ? [{ key: spawn.key, index }] : [];
    });
    respond(api, player, { type: 'catalog', request: data.request, part, parts, spawns: page, links,
      x, y, plane, viewDistance: player.getNpcViewDistance(), supported: true, truncated });
  }
}
function forget({ player }) { requests.delete(player); }

module.exports = {
  name: 'DistantWorld',
  category: '@ Ghost Plugins @',
  description: 'Public static spawn previews for the optional Distant World client plugin. Never widens NPC synchronization or simulation.',
  register(api) {
    api.onCustomEvent('network:plugin-message', receive.bind(null, api));
    api.onPlayerLogout(forget);
    api.onPlayerDisconnect(forget);
  },
  _test: { receive, forget, keyFor, MAX_RADIUS, MAX_SPAWNS },
};
