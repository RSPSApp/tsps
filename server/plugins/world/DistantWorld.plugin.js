const CHANNEL = 'distant-world';
const MAX_RADIUS = 1024;
const MAX_SPAWNS = 1024;
const PAGE_SIZE = 32;
const DEFAULT_WANDER_RADIUS = 5;
const MAX_VISIBLE_MAPS = 1024;
const MAX_LOCAL_LINKS = 255;
const CATALOG_INTERVAL_MS = 2500;
const FULL_CATALOG_INTERVAL_MS = 5000;
const RESOLVE_INTERVAL_MS = 750;
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
    const id = definition.getId(), x = p.getX(), y = p.getY(), plane = p.getZ();
    if (!Number.isInteger(id) || id < 0 || id > 2147483647
      || !Number.isInteger(x) || x < 0 || x > 16383 || !Number.isInteger(y) || y < 0 || y > 16383
      || !Number.isInteger(plane) || plane < 0 || plane > 3) continue;
    const region = `${plane}:${x >> 6}:${y >> 6}`;
    let rows = result.get(region);
    if (!rows) result.set(region, rows = []);
    const facing = definition.getFacing?.();
    const rotation = facing ? Math.round(Math.atan2(-facing.getX(), -facing.getY()) * 1024 / Math.PI) & 2047 : 0;
    rows.push({ id, mapId: ((x >> 6) << 8) | (y >> 6), spawn: { key: keyFor(id, p), x, y, plane,
      radius: Math.max(0, Math.min(32, definition.getRadius() ?? DEFAULT_WANDER_RADIUS)), rotation } });
  }
  catalogs.set(definitions, result);
  return result;
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
function makeCoverage(regions, key, x, y, plane, radius) {
  const candidates = [], maps = new Set(), seen = new Set();
  const endX = x + 63, endY = y + 63;
  // Include the radius around every tile in this square. The client clips to its exact tile.
  for (let rx = (x - radius) >> 6; rx <= (endX + radius) >> 6; rx++) {
    for (let ry = (y - radius) >> 6; ry <= (endY + radius) >> 6; ry++) {
      for (const row of regions.get(`${plane}:${rx}:${ry}`) ?? []) {
        const sx = row.spawn.x, sy = row.spawn.y;
        if (Math.max(x - sx, sx - endX, y - sy, sy - endY) > radius || seen.has(row.spawn.key)) continue;
        seen.add(row.spawn.key);
        maps.add(row.mapId);
        candidates.push({ row, distance: Math.max(Math.abs(sx - x - 31.5), Math.abs(sy - y - 31.5)), spawn: undefined });
      }
    }
  }
  return { regions, key, candidates, maps, preferred: undefined, types: new Map() };
}
function prepareCoverage(state, core, x, y, plane, radius, maps) {
  const regions = index(core), key = `${plane}:${x >> 6}:${y >> 6}:${radius}`;
  if (state.coverage?.regions !== regions || state.coverage.key !== key) {
    state.coverage = makeCoverage(regions, key, x & ~63, y & ~63, plane, radius);
  }
  const coverage = state.coverage;
  const preferred = new Set(maps?.filter(map => coverage.maps.has(map)));
  if (coverage.preferred?.size !== preferred.size || [...preferred].some(map => !coverage.preferred.has(map))) {
    coverage.preferred = preferred;
    coverage.candidates.sort((a, b) =>
      Number(preferred.has(b.row.mapId)) - Number(preferred.has(a.row.mapId)) || a.distance - b.distance);
  }
  return coverage;
}
function selectSpawns(coverage, core, player) {
  const spawns = [], variants = new Map();
  for (const candidate of coverage.candidates) {
    if (spawns.length === MAX_SPAWNS) return { spawns, truncated: true };
    const { id, spawn } = candidate.row;
    if (!coverage.types.has(id)) {
      let base;
      try { base = core.CacheDefinitions.getNpc(id); } catch {}
      coverage.types.set(id, base);
    }
    let type = coverage.types.get(id);
    if (type?.transforms) {
      if (!variants.has(id)) {
        let variant;
        try { variant = core.CacheDefinitions.resolveNpc(id, player.getPacketSender()); } catch {}
        variants.set(id, variant);
      }
      type = variants.get(id);
    } else if (candidate.spawn) {
      spawns.push(candidate.spawn);
      continue;
    }
    if (!type || type.id < 0 || !type.name || type.name.toLowerCase() === 'null'
      || (Array.isArray(type.modelIds) && type.modelIds.length === 0)) continue;
    const typeId = type.id ?? id, name = String(type.name).replace(/<[^>]*>/g, '').slice(0, 80);
    if (candidate.spawn?.typeId !== typeId || candidate.spawn.name !== name) {
      candidate.spawn = { ...spawn, typeId, name };
    }
    spawns.push(candidate.spawn);
  }
  return { spawns, truncated: false };
}
function localLinks(core, player, catalog) {
  const localByKey = new Map();
  for (const npc of player.getLocalNpcs()) {
    if (!npc || !npc.isRegistered() || !npc.isVisible() || npc.getOwner() || npc.isOwnerOnly() || npc.getPrivateArea()
      || npc.getArea()?.countsAsMainWorld?.() === false || core.World.getNpcs().get(npc.getIndex()) !== npc) continue;
    const key = keyFor(npc.getId(), npc.getSpawnPosition());
    if (catalog.allowed.has(key)) localByKey.set(key, localByKey.has(key) ? null : npc.getIndex());
  }
  return new Map([...localByKey].filter(([, index]) => Number.isInteger(index) && index > 0 && index < 65535).slice(0, MAX_LOCAL_LINKS));
}
function refreshCatalog(core, player, data, state) {
  const radius = Math.max(32, Math.min(MAX_RADIUS, Number.isFinite(data.radius) ? Math.trunc(data.radius) : 256));
  const origin = player.getLocation(), x = origin.getX(), y = origin.getY(), plane = origin.getZ();
  const coverage = prepareCoverage(state, core, x, y, plane, radius, data.maps);
  const { spawns, truncated } = selectSpawns(coverage, core, player);
  const catalog = state.snapshot;
  const changed = catalog?.coverage !== coverage || catalog.truncated !== truncated || catalog.spawns.length !== spawns.length
    || spawns.some(row => {
      const previous = catalog.allowed.get(row.key);
      return previous?.typeId !== row.typeId || previous.name !== row.name;
    });
  if (!changed) return catalog;
  return { coverage, spawns, truncated, revision: ++state.revision, allowed: new Map(spawns.map(row => [row.key, row])) };
}
function sendFullCatalog(api, player, request, catalog, viewDistance) {
  const local = localLinks(api.core, player, catalog);
  const parts = Math.max(1, Math.ceil(catalog.spawns.length / PAGE_SIZE));
  for (let part = 0; part < parts; part++) {
    const page = catalog.spawns.slice(part * PAGE_SIZE, (part + 1) * PAGE_SIZE);
    const links = page.filter(spawn => local.has(spawn.key)).map(({ key }) => ({ key, index: local.get(key) }));
    respond(api, player, { type: 'catalog', request, revision: catalog.revision, part, parts, spawns: page, links,
      viewDistance, supported: true, truncated: catalog.truncated });
  }
}
function sendCatalog(api, player, data, state, now) {
  const viewDistance = player.getNpcViewDistance();
  // A client without the current revision may have missed a page. Cap these retries too.
  if (now - state.full >= FULL_CATALOG_INTERVAL_MS) {
    state.snapshot = refreshCatalog(api.core, player, data, state);
    if (data.revision !== state.snapshot.revision) {
      state.full = now;
      sendFullCatalog(api, player, data.request, state.snapshot, viewDistance);
      return;
    }
  }
  const catalog = state.snapshot;
  if (!catalog || data.revision !== catalog.revision) return;
  const links = [...localLinks(api.core, player, catalog)].map(([key, index]) => ({ key, index }));
  respond(api, player, { type: 'links', request: data.request, revision: catalog.revision, viewDistance, links });
}
function receive(api, event) {
  if (event.channel !== CHANNEL || event.handled || !event.player) return;
  event.handled = true;
  const { player, data } = event;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  if (!Number.isSafeInteger(data.request) || data.request < 0 || !['catalog', 'resolve'].includes(data.type)) return;
  if (data.revision !== undefined && (!Number.isSafeInteger(data.revision) || data.revision < 1)) return;
  if (data.maps !== undefined && (!Array.isArray(data.maps) || data.maps.length > MAX_VISIBLE_MAPS
    || data.maps.some(id => !Number.isInteger(id) || id < 0 || id > 65535))) return;
  const state = requests.get(player) ?? { catalog: -Infinity, resolve: -Infinity, full: -Infinity, revision: 0 };
  const now = Date.now();
  const interval = data.type === 'catalog' ? CATALOG_INTERVAL_MS : RESOLVE_INTERVAL_MS;
  if (now - state[data.type] < interval) return;
  state[data.type] = now;
  requests.set(player, state);
  if (!publicWorld(api.core, player)) {
    state.coverage = state.snapshot = undefined;
    if (data.type === 'catalog') {
      respond(api, player, { type: 'catalog', request: data.request, spawns: [], links: [], viewDistance: player.getNpcViewDistance(), supported: false });
    }
    return;
  }
  if (data.type === 'resolve') {
    if (typeof data.key !== 'string' || !state.snapshot?.allowed.has(data.key)) return;
    const candidates = localMatches(api.core, player, data.key);
    respond(api, player, { type: 'resolved', request: data.request, key: data.key,
      index: candidates.length === 1 ? candidates[0].getIndex() : -1,
      typeId: candidates.length === 1 ? candidates[0].getContentId(player) : -1 });
    return;
  }
  sendCatalog(api, player, data, state, now);
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
