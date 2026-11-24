const path = require("path");
const { createObjectSpawnStore, createNpcSpawnStore } = require("./EditSpawnStore.AgentMcp");
const { sizesOf } = require("./EditSizes.AgentMcp");

// Map-editing tools for the agent MCP server: search the object (loc) cache, describe
// definitions, and place/remove live objects.
//
// Placements use data/definitions/object-spawns.json by default, or a map layer when
// the world already overrides that file. They survive restarts and show up in the
// ?edit map editor after a sync. Bulk building lives in EditBuild.AgentMcp.js.
module.exports = function registerEditTools(ctx) {
  const { core, tool, z } = ctx;
  const { GameObject, ObjectManager, Location, ObjectDefinition, CacheDefinitions, World, MapObjects } = core;

  // Overridable for tests; the server resolves it against its own working directory.
  const spawnsFile = () =>
    process.env.AGENT_MCP_SPAWNS_FILE ??
    path.resolve(process.cwd(), "data/definitions/object-spawns.json");
  const npcSpawnsFile = () =>
    process.env.AGENT_MCP_NPC_SPAWNS_FILE ??
    path.resolve(process.cwd(), "data/definitions/npc-spawns.json");

  const objectStore = () => createObjectSpawnStore(spawnsFile());
  const npcStore = () => createNpcSpawnStore(npcSpawnsFile());
  const readSpawns = () => objectStore().read();
  const writeSpawns = (spawns) => objectStore().write(spawns);
  const readNpcSpawnsFile = () => npcStore().read();
  const writeNpcSpawnsFile = (spawns) => npcStore().write(spawns);

  const sameTile = (entry, x, y, z) =>
    entry?.position?.x === x && entry?.position?.y === y && entry?.position?.z === z;

  const objectCount = () => CacheDefinitions.getCounts().objects;

  const checkBounds = (id, x, y, z, type, face) => {
    if (!Number.isInteger(id) || id < 0 || id >= objectCount()) {
      throw new Error(`Unknown object id ${id}; search_objects finds valid ids`);
    }
    for (const [name, value] of [["x", x], ["y", y]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    if (!Number.isInteger(z) || z < 0 || z > 3) throw new Error(`Plane z=${z} is outside 0-3`);
    if (!Number.isInteger(type) || type < 0 || type > 22) {
      throw new Error(`Type ${type} is outside 0-22 (10 is a normal standing object)`);
    }
    if (!Number.isInteger(face) || face < 0 || face > 3) {
      throw new Error(`Face ${face} is outside 0-3`);
    }
  };

  const rectSchema = {
    x1: z.number().int().describe("Rectangle corner x"),
    y1: z.number().int().describe("Rectangle corner y"),
    x2: z.number().int().describe("Opposite corner x"),
    y2: z.number().int().describe("Opposite corner y"),
  };

  const normalizeRect = (x1, y1, x2, y2) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (const [name, value] of [["x1", minX], ["x2", maxX], ["y1", minY], ["y2", maxY]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    const tiles = (maxX - minX + 1) * (maxY - minY + 1);
    if (tiles > 4096) throw new Error(`Rectangle covers ${tiles} tiles; split it under 4096`);
    return { minX, maxX, minY, maxY };
  };

  tool(
    "search_objects",
    "Find placeable objects (locs) by name: walls, doors, trees, furniture, decorations. Matches substrings case-insensitively; a numeric query matches ids by prefix. Returns up to `limit` {id, name} pairs for place_object.",
    { query: z.string().min(1).describe("Name fragment (e.g. \"marble wall\") or id prefix"), limit: z.number().int().min(1).max(50).default(20) },
    ({ query, limit }) => {
      const trimmed = query.trim().toLowerCase();
      const byId = Number(trimmed);
      const results = [];
      const total = objectCount();
      for (let id = 0; id < total; id++) {
        let entry;
        try {
          entry = CacheDefinitions.getObject(id);
        } catch {
          continue;
        }
        const name = entry?.name;
        if (!name || name === "null") continue;
        if (Number.isInteger(byId) && byId >= 0) {
          if (id !== byId && !String(id).startsWith(trimmed)) continue;
        } else if (!name.toLowerCase().includes(trimmed)) {
          continue;
        }
        results.push({ id, name });
        if (results.length >= limit) break;
      }
      return { query, count: results.length, results };
    }
  );

  tool(
    "describe_object",
    "Object definition details for placing well: footprint (sizeX/sizeY), whether it blocks movement (solid) or projectiles, whether it is interactive and its options, and its model size per shape (width, depth, height, top; 128 units to a tile).",
    { id: z.number().int().min(0).describe("Object id from search_objects") },
    ({ id }) => {
      if (id >= objectCount()) throw new Error(`Unknown object id ${id}`);
      const definition = ObjectDefinition.forId(id);
      if (!definition) throw new Error(`No definition for object id ${id}`);
      return {
        id,
        name: definition.getName(),
        sizeX: definition.getSizeX(),
        sizeY: definition.getSizeY(),
        solid: definition.isSolid(),
        blocksProjectiles: definition.isImpenetrable(),
        interactive: definition.hasActions(),
        options: definition.getInteractions() ?? [],
        // Model size per shape, 128 units to a tile (loc-sizes.json); null if not measured.
        sizes: sizesOf(id),
      };
    }
  );

  tool(
    "place_object",
    "Place one object live in the world: every online player (and the ?edit map editor after a sync) sees it at once. Saves to the tracked object-spawns.json by default, or to a new layer if this world already has a saved layer for object spawns. type 10 is a normal standing object; face 0-3 rotates it. For more than a handful of tiles use place_objects or build_shape instead.",
    {
      id: z.number().int().min(0).describe("Object id from search_objects"),
      x: z.number().int().describe("World tile x"),
      y: z.number().int().describe("World tile y"),
      z: z.number().int().min(0).max(3).default(0).describe("Plane, 0 is ground level"),
      type: z.number().int().min(0).max(22).default(10),
      face: z.number().int().min(0).max(3).default(0),
    },
    ({ id, x, y, z = 0, type = 10, face = 0 }) => {
      checkBounds(id, x, y, z, type, face);
      const definition = ObjectDefinition.forId(id);
      if (!definition) throw new Error(`No definition for object id ${id}`);
      ObjectManager.register(new GameObject(id, new Location(x, y, z), type, face, null), true);
      const spawns = readSpawns();
      // A razed tile keeps a removal marker for this object; clear it, or the marker
      // deletes the new placement on the next load.
      objectStore().dropRemoval(spawns, id, x, y, z, type);
      // Registering replaced whatever stood in this tile's slot; drop its entry too.
      const replaced = objectStore().dropReplaced(spawns, id, x, y, z, type, face);
      const already = objectStore().find(spawns, id, x, y, z, type, face) !== undefined;
      if (!already) {
        spawns.push({ id, position: { x, y, z }, type, face, source: "agent-mcp" });
      }
      writeSpawns(spawns);
      return { placed: { id, name: definition.getName(), x, y, z, type, face }, persisted: !already, replaced };
    }
  );

  tool(
    "remove_object",
    "Remove live object(s) on a tile and persist the removal, so they stay gone after a restart. Without `type` every object on the tile is removed.",
    {
      x: z.number().int().describe("World tile x"),
      y: z.number().int().describe("World tile y"),
      z: z.number().int().min(0).max(3).default(0),
      type: z.number().int().min(0).max(22).optional().describe("Only remove this object type"),
    },
    ({ x, y, z = 0, type }) => {
      if (!Number.isInteger(x) || x < 0 || x > 16383 || !Number.isInteger(y) || y < 0 || y > 16383) {
        throw new Error(`Tile ${x},${y} is outside the world (0-16383)`);
      }
      if (!Number.isInteger(z) || z < 0 || z > 3) throw new Error(`Plane z=${z} is outside 0-3`);
      const at = new Location(x, y, z);
      const matches = ObjectManager.objectsAt(at).filter((object) => type === undefined || object.getType() === type);
      if (matches.length === 0) {
        const present = ObjectManager.objectsAt(at).map((object) => ({ id: object.getId(), type: object.getType() }));
        throw new Error(`Nothing to remove on ${x},${y},${z}${type === undefined ? "" : ` with type ${type}`}; present: ${JSON.stringify(present)}`);
      }
      const spawns = readSpawns();
      let changed = false;
      const removed = [];
      for (const object of matches) {
        ObjectManager.deregister(object, true);
        removed.push({ id: object.getId(), type: object.getType(), x, y, z });
        // Entries this file placed for the object are dropped; a cache-map object
        // needs an explicit removal marker to stay gone on the next load.
        const covered = spawns.some(
          (entry) => entry.id === object.getId() && sameTile(entry, x, y, z)
            && (entry.type ?? 10) === object.getType() && entry.remove !== true,
        );
        if (objectStore().dropPlacement(spawns, object.getId(), x, y, z, object.getType())) changed = true;
        if (!covered) {
          spawns.push({
            id: object.getId(), position: { x, y, z },
            type: object.getType(), face: object.getFace(), remove: true, source: "agent-mcp",
          });
          changed = true;
        }
      }
      if (changed) writeSpawns(spawns);
      return { removed };
    }
  );

  tool(
    "clear_area",
    "Clear a rectangle on all planes. By default it removes only objects placed by object-spawns.json (agent or editor builds) and leaves the cache map's own scenery standing; includeCache:true razes everything, cache fences and ground decoration included, and persists removal markers for them (restore_area undoes those). It also drops spawn-file placements in the rectangle that no longer stand live, and removes NPCs standing in it unless includeNpcs is false. dryRun:true reports what would go without changing anything. Removals reach all players and persist; cache-map NPCs with no spawn-file entry return on restart and are reported. Collision goes with the objects.",
    {
      ...rectSchema,
      includeNpcs: z.boolean().default(true).describe("Also remove NPCs standing in the rectangle"),
      includeCache: z.boolean().default(false).describe("Also raze the cache map's own objects (persists removal markers)"),
      dryRun: z.boolean().default(false).describe("Report what would be removed; change nothing"),
    },
    ({ x1, y1, x2, y2, includeNpcs = true, includeCache = false, dryRun = false }) => {
      const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
      const inRect = (entry) => entry?.position?.x >= minX && entry.position.x <= maxX
        && entry.position.y >= minY && entry.position.y <= maxY;

      const spawns = readSpawns();
      let spawnsChanged = false;
      // Cache objects live in MapObjects, runtime ones in ObjectManager: clear both.
      // Player-owned (fires, traps) and private-area objects are left alone.
      // Regions load lazily; one nobody has visited has no MapObjects to clear yet.
      for (let x = minX; x <= maxX + 63; x += 64) {
        for (let y = minY; y <= maxY + 63; y += 64) {
          core.RegionManager?.loadMapFiles?.(Math.min(x, maxX), Math.min(y, maxY), false);
        }
      }
      const candidates = [];
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = 0; z <= 3; z++) {
            const at = new Location(x, y, z);
            const onTile = [
              ...ObjectManager.objectsAt(at),
              ...(MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []),
            ];
            for (const object of onTile) {
              if (candidates.includes(object)) continue;
              if (object.getOwner?.() || object.getPrivateArea?.()) continue;
              candidates.push(object);
            }
          }
        }
      }
      const removedObjects = [];
      const keptObjects = [];
      // A tile can hold the same loc twice (the cache's MapObjects and a registered
      // runtime object), so removals are keyed by object identity on the tile: a
      // second pass would otherwise find the placement entry already dropped and
      // write a removal marker for something this toolset placed itself.
      const removedKeys = new Set();
      for (const object of candidates) {
        const at = object.getLocation();
        const x = at.getX();
        const y = at.getY();
        const z = at.getZ();
        const type = object.getType();
        const identity = `${object.getId()}:${type}:${x},${y},${z}`;
        if (removedKeys.has(identity)) continue;
        removedKeys.add(identity);
        // Compute coverage first: dropPlacement clears the placement entry, so asking
        // afterwards would report every object as "not from this file" and write a
        // removal marker even for objects this toolset placed itself.
        const covered = spawns.some((entry) => entry.id === object.getId()
          && sameTile(entry, x, y, z) && (entry.type ?? 10) === type && entry.remove !== true);
        if (!covered && !includeCache) {
          keptObjects.push({ id: object.getId(), type, x, y, z });
          continue;
        }
        removedObjects.push({ id: object.getId(), type, x, y, z, cache: !covered });
        if (dryRun) continue;
        ObjectManager.deregister(object, true);
        if (objectStore().dropPlacement(spawns, object.getId(), x, y, z, type)) spawnsChanged = true;
        if (!covered) {
          spawns.push({
            id: object.getId(), position: { x, y, z },
            type, face: object.getFace(), remove: true, source: "agent-mcp",
          });
          spawnsChanged = true;
        }
      }
      // Placements with nothing standing live (e.g. one a later placement replaced on
      // its tile) would come back on the next load; the rectangle is being cleared, so
      // they go too.
      const standing = new Set(removedObjects.filter((object) => !object.cache)
        .map((object) => `${object.id}:${object.type}:${object.x},${object.y},${object.z}`));
      const orphans = spawns.filter((entry) => entry.remove !== true && inRect(entry)
        && !standing.has(`${entry.id}:${entry.type ?? 10}:${entry.position.x},${entry.position.y},${entry.position.z ?? 0}`));
      if (!dryRun && orphans.length > 0) {
        for (const orphan of orphans) spawns.splice(spawns.indexOf(orphan), 1);
        spawnsChanged = true;
      }
      if (!dryRun && spawnsChanged) writeSpawns(spawns);

      const removedNpcs = [];
      const unpersistedCacheNpcs = [];
      if (includeNpcs) {
        const npcSpawns = readNpcSpawnsFile();
        let npcsChanged = false;
        const center = new Location(Math.floor((minX + maxX) / 2), Math.floor((minY + maxY) / 2), 0);
        const radius = Math.max(maxX - minX, maxY - minY);
        for (const npc of World.getNpcsNear(center, radius, null)) {
          const at = npc.getLocation();
          if (at.getX() < minX || at.getX() > maxX || at.getY() < minY || at.getY() > maxY) continue;
          if (npc.getPrivateArea() || npc.isOwnerOnly?.()) continue;
          removedNpcs.push({ id: npc.getId(), x: at.getX(), y: at.getY(), z: at.getZ() });
          if (dryRun) continue;
          World.getRemoveNPCQueue().push(npc);
          let covered = false;
          // The file records the spawn tile, not where the NPC has wandered to.
          const spawn = npc.getSpawnPosition?.() ?? at;
          for (let i = npcSpawns.length - 1; i >= 0; i--) {
            const entry = npcSpawns[i];
            if (entry.id === npc.getId() && entry.x === spawn.getX() && entry.y === spawn.getY()
              && (entry.level ?? 0) === spawn.getZ()) {
              npcSpawns.splice(i, 1);
              npcsChanged = true;
              covered = true;
            }
          }
          if (!covered) unpersistedCacheNpcs.push({ id: npc.getId(), x: at.getX(), y: at.getY() });
        }
        if (npcsChanged) writeNpcSpawnsFile(npcSpawns);
      }

      return {
        cleared: { x1: minX, y1: minY, x2: maxX, y2: maxY },
        dryRun,
        removedObjects: removedObjects.length,
        removedCacheObjects: removedObjects.filter((object) => object.cache).length,
        removedObjectSample: removedObjects.slice(0, 10),
        droppedOrphanEntries: orphans.length,
        keptObjects: keptObjects.length,
        keptObjectSample: keptObjects.slice(0, 10),
        removedNpcs: removedNpcs.length,
        unpersistedCacheNpcs,
      };
    }
  );

  tool(
    "restore_area",
    "Undo cache-object removals in a rectangle on all planes: drops the removal markers clear_area (includeCache) or remove_object wrote to object-spawns.json and puts those cache objects back live for every player. Placements are left alone; clear_area removes those.",
    { ...rectSchema },
    ({ x1, y1, x2, y2 }) => {
      const { minX, maxX, minY, maxY } = normalizeRect(x1, y1, x2, y2);
      const spawns = readSpawns();
      const markers = spawns.filter((entry) => entry.remove === true
        && entry.position?.x >= minX && entry.position.x <= maxX
        && entry.position?.y >= minY && entry.position.y <= maxY);
      const restored = [];
      for (const marker of markers) {
        const { x, y, z = 0 } = marker.position;
        const type = marker.type ?? 10;
        const face = marker.face ?? 0;
        // Registering takes the removed map object's place, so scene reloads stop hiding it.
        ObjectManager.register(new GameObject(marker.id, new Location(x, y, z), type, face, null), true);
        spawns.splice(spawns.indexOf(marker), 1);
        restored.push({ id: marker.id, type, x, y, z });
      }
      if (restored.length > 0) writeSpawns(spawns);
      return {
        restored: restored.length,
        restoredSample: restored.slice(0, 10),
      };
    }
  );

  tool(
    "list_placed_objects",
    "Objects persisted in object-spawns.json (the file the ?edit editor overlays). Filter by source: agent-mcp entries are this toolset's, others are hand- or editor-made.",
    { source: z.string().optional().describe("Only entries with this source tag") },
    ({ source }) => {
      const spawns = readSpawns().filter((entry) => source === undefined || entry.source === source);
      return { count: spawns.length, objects: spawns };
    }
  );
};
