"use strict";

/**
 * The Sulphur mine in Lovakengj (Wiki: Sulphur mine, Poison gas cloud).
 *
 * The gas clouds (cache NPC 7070, the unnamed "lovakengj_sulphur_gas" config) move around the
 * mine. A player within the 3x3 square centred on a cloud's south-west tile takes 1 damage per
 * cloud per tick with a breathing filter, or 1-3 without one; the damage stacks per cloud. The
 * bank chest in the south-east corner is outside the clouds' reach. Cloud spawn tiles are not in
 * the cache map, so three are placed inside the Wiki's mine outline; the exact live count and
 * starting tiles are not published.
 */
const GAS_CLOUD_ID = 7070;
const GAS_CLOUD_SIZE = 1; // a 3x3 square centred on the cloud's south-west tile
const MINE = { minX: 1420, maxX: 1460, minY: 3845, maxY: 3885, z: 0 };
const BANK_CHEST_SAFE = { minX: 1449, maxX: 1460, minY: 3845, maxY: 3864, z: 0 };
const BREATHING_FILTER_PATTERN = /gas mask|facemask|slayer helmet/i;

let core;

function inside(location, area) {
  return location?.getZ?.() === area.z
    && location.getX() >= area.minX && location.getX() <= area.maxX
    && location.getY() >= area.minY && location.getY() <= area.maxY;
}

function wearsBreathingFilter(player) {
  const head = player.getEquipment().get(core.Equipment.HEAD_SLOT);
  if (!head || head.getId() <= 0) return false;
  return BREATHING_FILTER_PATTERN.test(core.CacheDefinitions.getItem(head.getId())?.name ?? "");
}

/** Clouds whose 3x3 square contains the player's tile. */
function cloudsBeside(location, npcs) {
  const clouds = [];
  for (const npc of npcs) {
    if (npc.getId() !== GAS_CLOUD_ID) continue;
    const at = npc.getLocation();
    if (Math.abs(location.getX() - at.getX()) <= GAS_CLOUD_SIZE
      && Math.abs(location.getY() - at.getY()) <= GAS_CLOUD_SIZE) clouds.push(npc);
  }
  return clouds;
}

function damage(filtered, random = Math.random) {
  return filtered ? 1 : 1 + Math.floor(random() * 3);
}

function sulphurMineArea() {
  class SulphurMineArea extends core.Area {
    getName() {
      return "Sulphur mine";
    }

    process(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (!player.isRegistered() || player.getHitpoints() <= 0) return;
      const at = player.getLocation();
      if (inside(at, BANK_CHEST_SAFE)) return;
      const clouds = cloudsBeside(at, this.getNpcs());
      if (clouds.length === 0) return;
      const filtered = wearsBreathingFilter(player);
      for (let i = 0; i < clouds.length; i++) {
        player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage(filtered), core.HitMask.RED)]);
      }
    }
  }
  return new SulphurMineArea([new core.Boundary(MINE.minX, MINE.maxX, MINE.minY, MINE.maxY, MINE.z)]);
}

module.exports = {
  name: "SulphurMine",
  members: true,
  _test: { MINE, BANK_CHEST_SAFE, inside, wearsBreathingFilter, cloudsBeside, damage, sulphurMineArea },
  register(api) {
    core = api.core;
    api.registerArea(sulphurMineArea());
  },
};
