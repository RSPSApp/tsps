/**
 * Crab Quest's dream: the private copy of Dognose Island the bottle sends the player into.
 *
 * Live (RSProx capture 20261103T014803-ee79c12, revision 241) builds it with rebuild_region:
 * 12x12 zones copied unturned from 3008,2592 (planes 0-3), the player kept on the same source
 * tile. The quest's scenery, NPCs and shells are added for the owner only (loc_add_change,
 * npc adds, obj_add_specific with ownership self). Everything here is in source coordinates;
 * `tile` and `toSource` translate to and from the instance.
 */
module.exports = function createCrabDream(api, { onLeave } = {}) {
  const { GameObject, Item, ItemOnGroundManager, Location, TemplatedInstanceArea } = api.core;

  const SOURCE_X = 3008;
  const SOURCE_Y = 2592;
  const SIZE_CHUNKS = 12;
  const PLANES = 4;
  const GROUND_ITEM_DESPAWN_TICKS = 16959;

  const dreams = new Map();

  class CrabDreamArea extends TemplatedInstanceArea {
    constructor(owner) {
      super(SIZE_CHUNKS, SIZE_CHUNKS);
      this.owner = owner;
      for (let z = 0; z < PLANES; z++) {
        for (let x = 0; x < SIZE_CHUNKS; x++) {
          for (let y = 0; y < SIZE_CHUNKS; y++) {
            this.setChunk(z, x, y, { sourceChunkX: SOURCE_X / 8 + x, sourceChunkY: SOURCE_Y / 8 + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() { return "Crab Quest dream"; }
    canTeleport() { return false; }
    canAttack() { return false; }
    npcAggression() { return false; }
    /** The shells and the net stay as long as live keeps them (obj_add_specific despawn=16959). */
    groundItemDespawnDelay() { return GROUND_ITEM_DESPAWN_TICKS; }

    sourceTile(x, y, z = 0) { return this.tile(x - SOURCE_X, y - SOURCE_Y, z); }

    postLeave(mobile, logout) {
      if (mobile === this.owner && dreams.get(mobile)?.area === this) close(mobile, logout);
      super.postLeave(mobile, logout);
    }
  }

  function get(player) {
    return dreams.get(player) ?? null;
  }

  function active(player) {
    return dreams.has(player);
  }

  /** The instance tile for a source tile; the source tile itself when the player is not dreaming. */
  function tile(player, x, y, z = 0) {
    const dream = dreams.get(player);
    return dream ? dream.area.sourceTile(x, y, z) : new Location(x, y, z);
  }

  /**
   * The source tile an instance location stands for (unchanged outside the dream). Takes a
   * Location or a plain { x, y, z } (interaction events carry the latter).
   */
  function toSource(player, location) {
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    const z = location.getZ?.() ?? location.z ?? 0;
    const dream = dreams.get(player);
    if (!dream || !dream.area.contains(new Location(x, y, z))) return { x, y, z };
    return { x: x - dream.area.getBaseX() + SOURCE_X, y: y - dream.area.getBaseY() + SOURCE_Y, z };
  }

  function enter(player, { x, y }) {
    if (dreams.has(player)) return dreams.get(player);
    const dream = { player, area: null, locs: new Map(), npcs: new Map(), items: new Map() };
    dream.area = new CrabDreamArea(player);
    dreams.set(player, dream);
    dream.area.enter(player);
    player.moveTo(dream.area.sourceTile(x, y, 0));
    return dream;
  }

  /** Leaves the dream for the same source tile in the real world (or wherever `to` says). */
  function leave(player, to) {
    const dream = dreams.get(player);
    if (!dream) return;
    const from = toSource(player, player.getLocation());
    if (player.getPrivateArea?.() === dream.area) dream.area.leave(player, false);
    close(player, false);
    const target = to ?? from;
    player.moveTo(new Location(target.x, target.y, target.z ?? 0));
  }

  function close(player, logout) {
    const dream = dreams.get(player);
    if (!dream) return;
    dreams.delete(player);
    for (const npc of dream.npcs.values()) if (npc?.isRegistered?.()) api.removeNpc(npc);
    dream.npcs.clear();
    dream.area.destroy();
    onLeave?.(player, logout);
  }

  /** Places (or replaces) a quest loc, keyed by its tile and shape like loc_add_change. */
  function loc(player, { id, x, y, z = 0, shape = 10, rotation = 0 }) {
    const dream = dreams.get(player);
    if (!dream) return null;
    const key = `${x},${y},${z},${shape}`;
    if (dream.locs.get(key)?.getId?.() === id) return dream.locs.get(key);
    const object = new GameObject(id, dream.area.sourceTile(x, y, z), shape, rotation, dream.area);
    dream.area.add(object);
    api.core.ObjectManager.register(object, true);
    dream.locs.set(key, object);
    return object;
  }

  function locAt(player, x, y, z = 0, shape = 10) {
    return dreams.get(player)?.locs.get(`${x},${y},${z},${shape}`) ?? null;
  }

  /** One owner-only NPC per key, replaced when its id or tile changes. */
  function npc(player, key, { id, x, y, z = 0, face, wanderRadius = 0 }) {
    const dream = dreams.get(player);
    if (!dream) return null;
    const existing = dream.npcs.get(key);
    if (existing?.isRegistered?.()) {
      const at = toSource(player, existing.getLocation());
      const realId = existing.getRealId?.() ?? existing.getId?.();
      if (realId === id && at.x === x && at.y === y) return existing;
      api.removeNpc(existing);
    }
    const tileAt = dream.area.sourceTile(x, y, z);
    const spawned = api.spawnNpc({
      id, x: tileAt.getX(), y: tileAt.getY(), z, owner: player, ownerOnly: true, wanderRadius,
    });
    if (!spawned) {
      dream.npcs.delete(key);
      return null;
    }
    spawned.__skipDefaultRespawn = true;
    dream.area.add(spawned);
    if (face) spawned.setPositionToFace(dream.area.sourceTile(face[0], face[1], z));
    dream.npcs.set(key, spawned);
    return spawned;
  }

  function removeNpc(player, key) {
    const dream = dreams.get(player);
    const existing = dream?.npcs.get(key);
    if (!existing) return;
    dream.npcs.delete(key);
    if (existing.isRegistered?.()) api.removeNpc(existing);
  }

  function npcFor(player, key) {
    const existing = dreams.get(player)?.npcs.get(key);
    return existing?.isRegistered?.() ? existing : null;
  }

  /** An owner-only floor item that never turns public, as obj_add_specific ownership=self. */
  function groundItem(player, itemId, { x, y }) {
    const dream = dreams.get(player);
    if (!dream) return null;
    const key = `${itemId}`;
    const existing = dream.items.get(key);
    if (existing && World().getItems().includes(existing)) return existing;
    const item = ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), dream.area.sourceTile(x, y, 0),
      dream.area, { goesGlobal: false });
    dream.items.set(key, item);
    return item;
  }

  function removeGroundItem(player, itemId) {
    const dream = dreams.get(player);
    const existing = dream?.items.get(`${itemId}`);
    if (!existing) return;
    dream.items.delete(`${itemId}`);
    if (World().getItems().includes(existing)) ItemOnGroundManager.deregister(existing);
  }

  function World() {
    return api.core.World;
  }

  return {
    active, enter, get, groundItem, leave, loc, locAt, npc, npcFor, removeGroundItem, removeNpc, tile, toSource,
    SOURCE_X, SOURCE_Y, SIZE_CHUNKS,
  };
};
