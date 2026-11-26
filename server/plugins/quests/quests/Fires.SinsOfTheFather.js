"use strict";

/**
 * Damien Leucurte's magical fires (Sins of the Father, the Crombwick Manor fight).
 *
 * Wiki (Sins of the Father): Damien "periodically spread[s] magical fire around the room during the
 * fight. You must stamp out the fires or he will become increasingly resistant to your attacks."
 * Wiki (Sins of the Father/Quick guide): the fires "reduce the damage you deal to him. He can,
 * however, be killed even with one on-screen."
 *
 * rsprox captures (docs/quests/sins-of-the-father.md): local 1000270, rsprox.net 102 and 1637.
 * - A cast: Damien faces the fire's tile and plays human_castenfeeble (728); two ticks later the fire
 *   (myq5_damien_fire_small, "Magical Fire", Stamp-out) appears there with sound 2596.
 * - Casts come on Damien's 5-tick attack turns, 30 ticks apart (local 1000270 and 102) or 40 (1637);
 *   the first came 13 to 28 ticks after he turned hostile.
 * - "Your attacks seem to have reduced effect on Damien." once per fire, as the player's next attack
 *   lands (none when the player stamps it out before attacking again: 102).
 * - Stamp-out: human_stamp (794) on arrival, a tick later sound 1446 at the fire and the fire is gone.
 * - Damien's death clears any fire still burning.
 *
 * Ours: a cast every 30 ticks, the first 28 ticks after the fight starts (or after the player comes back:
 * more than 15 tiles from Damien, or off his floor, puts the fires out and stops the casts); the fire's tile is a free
 * one in the part of the room the recordings used; each burning fire takes 20% off the player's
 * damage (the Wiki gives no figure; hits with one fire burning averaged about 80% of those without
 * in local 1000270). The fire is shown only to the fighting player, like the fight itself.
 */
module.exports = function createDamienFires(api) {
  const { Animation, Location, GameObject, ObjectManager, RegionManager, Task, TaskManager, ObjectIdentifiers } = api.core;

  const FIRE_OBJECT_ID = ObjectIdentifiers.MAGICAL_FIRE_4; // myq5_damien_fire_small
  const CAST_ANIMATION = 728; // human_castenfeeble
  const STAMP_ANIMATION = 794; // human_stamp
  const FIRE_SOUND = 2596;
  const STAMP_SOUND = 1446;
  const SOUND_RADIUS = 10;
  const FIRST_CAST_TICKS = 28;
  const CAST_INTERVAL_TICKS = 30;
  const FIRE_DELAY_TICKS = 2;
  const STAMP_DELAY_TICKS = 1;
  const DAMAGE_FIFTHS = 5;
  /** Ours: further than this from Damien (or off his floor) the player has left the fight. */
  const FIGHT_RANGE = 15;
  const REDUCED_MESSAGE = "Your attacks seem to have reduced effect on Damien.";
  /** The room tiles the recorded fires used (x 3717-3722, y 3355-3360 on the manor's upper floor). */
  const FIRE_AREA = Object.freeze({ minX: 3717, maxX: 3722, minY: 3355, maxY: 3360, z: 1 });

  /** player -> { npc, ticks, fires: Map<tileKey, GameObject>, warn, task } */
  const fights = new Map();

  function tileKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  function same(location, x, y, z) {
    return location?.getX?.() === x && location.getY() === y && location.getZ() === z;
  }

  function freeTiles(fight, player) {
    const tiles = [];
    for (let x = FIRE_AREA.minX; x <= FIRE_AREA.maxX; x++) {
      for (let y = FIRE_AREA.minY; y <= FIRE_AREA.maxY; y++) {
        if (fight.fires.has(tileKey(x, y, FIRE_AREA.z))) continue;
        if (same(player.getLocation(), x, y, FIRE_AREA.z) || same(fight.npc.getLocation(), x, y, FIRE_AREA.z)) continue;
        if (RegionManager.blocked(new Location(x, y, FIRE_AREA.z), null)) continue;
        tiles.push({ x, y, z: FIRE_AREA.z });
      }
    }
    return tiles;
  }

  function sound(player, soundId, tile) {
    player.getPacketSender().sendAreaSound(soundId, tile.x, tile.y, tile.z, 1, 0, SOUND_RADIUS);
  }

  function cast(player, fight) {
    const tiles = freeTiles(fight, player);
    if (!tiles.length) return;
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    fight.npc.setPositionToFace(new Location(tile.x, tile.y, tile.z));
    fight.npc.performAnimation(new Animation(CAST_ANIMATION));
    fight.casts.push({ tile, at: fight.ticks + FIRE_DELAY_TICKS });
  }

  function light(player, fight, tile) {
    const key = tileKey(tile.x, tile.y, tile.z);
    if (fight.fires.has(key)) return;
    const rotation = Math.floor(Math.random() * 4);
    const fire = new GameObject(FIRE_OBJECT_ID, new Location(tile.x, tile.y, tile.z), 10, rotation, null).setOwner(player);
    ObjectManager.register(fire, true);
    fight.fires.set(key, fire);
    fight.warn = true;
    sound(player, FIRE_SOUND, tile);
  }

  function clearFires(fight) {
    for (const fire of fight.fires.values()) ObjectManager.deregister(fire, true);
    fight.fires.clear();
    fight.casts.length = 0;
  }

  /** Ends the player's fight: the fires go out with Damien (captures: his death clears them). */
  function stop(player) {
    const fight = fights.get(player);
    if (!fight) return;
    fights.delete(player);
    clearFires(fight);
    fight.task?.stop();
  }

  function inFight(player, npc) {
    const at = player.getLocation();
    const damien = npc.getLocation();
    return at.getZ() === damien.getZ()
      && Math.max(Math.abs(at.getX() - damien.getX()), Math.abs(at.getY() - damien.getY())) <= FIGHT_RANGE;
  }

  function tick(player) {
    const fight = fights.get(player);
    if (!fight) return false;
    if (player.isRegistered?.() === false || fight.npc.isRegistered?.() === false) {
      stop(player);
      return false;
    }
    if (!inFight(player, fight.npc)) {
      // Died, teleported or walked off: the fires go out and the casts start over on return.
      clearFires(fight);
      fight.ticks = 0;
      return true;
    }
    fight.ticks++;
    for (let index = fight.casts.length - 1; index >= 0; index--) {
      const pending = fight.casts[index];
      if (pending.at > fight.ticks) continue;
      fight.casts.splice(index, 1);
      light(player, fight, pending.tile);
    }
    if (fight.ticks >= FIRST_CAST_TICKS && (fight.ticks - FIRST_CAST_TICKS) % CAST_INTERVAL_TICKS === 0) {
      cast(player, fight);
    }
    return true;
  }

  /** Damien (the fight NPC) is up for `player`; his casts start counting from now. */
  function start(player, npc) {
    const existing = fights.get(player);
    if (existing?.npc === npc && existing.task?.isRunning()) return;
    stop(player);
    const fight = { npc, ticks: 0, fires: new Map(), casts: [], warn: false, task: null };
    fights.set(player, fight);
    // Keyed to the fight, not the player: plugins that cancel a player's tasks must not end it.
    fight.task = new (class extends Task {
      constructor() {
        super(1, fight, false);
      }

      execute() {
        if (!tick(player)) this.stop();
      }
    })();
    TaskManager.submit(fight.task);
  }

  function stampOut(event) {
    const { player } = event;
    const fight = fights.get(player);
    const location = event.location ?? event.object?.getLocation?.();
    if (!fight || !location) return false;
    const tile = { x: location.getX?.() ?? location.x, y: location.getY?.() ?? location.y, z: location.getZ?.() ?? location.z };
    const key = tileKey(tile.x, tile.y, tile.z);
    if (!fight.fires.has(key)) return false;
    event.handled = true;
    player.setPositionToFace(new Location(tile.x, tile.y, tile.z));
    player.performAnimation(new Animation(STAMP_ANIMATION));
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(STAMP_DELAY_TICKS, player, false);
      }

      execute() {
        this.stop();
        const current = fights.get(player);
        const fire = current?.fires.get(key);
        if (!fire) return;
        current.fires.delete(key);
        ObjectManager.deregister(fire, true);
        sound(player, STAMP_SOUND, tile);
      }
    })());
    return true;
  }

  /** Each burning fire removes one fifth of the player's damage on Damien. */
  function reduceDamage(event) {
    const { attacker, target, damage } = event;
    if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !damage) return;
    const fight = fights.get(attacker);
    if (!fight || fight.npc !== target || fight.fires.size === 0) return;
    const remainingFifths = Math.max(0, DAMAGE_FIFTHS - fight.fires.size);
    damage.setDamage(Math.floor(damage.getDamage() * remainingFifths / DAMAGE_FIFTHS));
    if (fight.warn) {
      fight.warn = false;
      attacker.sendMessage(REDUCED_MESSAGE);
    }
  }

  function firesFor(player) {
    const fight = fights.get(player);
    return fight ? [...fight.fires.keys()] : [];
  }

  return { start, stop, stampOut, reduceDamage, tick, firesFor };
};
