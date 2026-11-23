"use strict";

/**
 * Extreme heat in the Karuulm Slayer Dungeon (docs/karuulm-slayer-dungeon.md).
 *
 * Wiki (Extreme heat, Karuulm Slayer Dungeon, Mount Karuulm): beyond the entrance chamber, where
 * the three Tasakaal stand, the floor burns a player for 4 damage every tick. Boots of stone,
 * Boots of Brimstone or granite boots keep it off, and so does the reward of the elite Kourend &
 * Kebos Diary, with any footwear or none.
 *
 * The entrance chamber is the cache map's walkable room around the elevator landing
 * (1311,10188): 1303-1320, 10188-10214 on level 0, closed off by the three "Rocks" stepovers at
 * 1321,10205, 1302,10205 and 1311,10215. The Alchemical Hydra's chamber is its own private area.
 *
 * Ours: the warning the Wiki says players get on leaving the chamber without boots is not
 * written down anywhere we have (no Wiki text, no recording), so no warning is sent.
 */
const DAMAGE_PER_TICK = 4;
/** Every level of the dungeon, west of the Alchemical Hydra's chamber. */
const DUNGEON = { minX: 1230, maxX: 1355, minY: 10130, maxY: 10290, levels: [0, 1, 2] };
/** The Tasakaal's chamber the elevator lands in, the one cool room. */
const ENTRANCE_CHAMBER = { minX: 1303, maxX: 1320, minY: 10185, maxY: 10214, z: 0 };

let core;
let pluginApi;
let protectiveBoots = null;

function inside(location, box) {
  return location.getZ() === box.z
    && location.getX() >= box.minX && location.getX() <= box.maxX
    && location.getY() >= box.minY && location.getY() <= box.maxY;
}

function inHeat(location) {
  return !inside(location, ENTRANCE_CHAMBER);
}

/** Wiki (Extreme heat): the three boots that keep the floor's heat off. */
function bootsIds() {
  const items = core.ItemIdentifiers;
  protectiveBoots ??= new Set([items.BOOTS_OF_STONE, items.BOOTS_OF_BRIMSTONE, items.GRANITE_BOOTS]);
  return protectiveBoots;
}

function wearsProtectiveBoots(player) {
  const feet = player.getEquipment().get(core.Equipment.FEET_SLOT);
  return !!feet && bootsIds().has(feet.getId());
}

function hasEliteDiaryReward(player) {
  const request = { player, diary: "kourend", tier: "elite", claimed: false };
  pluginApi.emitCustomEvent("diary:is-reward-claimed", request);
  return request.claimed === true;
}

function isProtected(player) {
  return wearsProtectiveBoots(player) || hasEliteDiaryReward(player);
}

function burn(player) {
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(DAMAGE_PER_TICK, core.HitMask.RED)]);
}

function karuulmSlayerDungeon() {
  class KaruulmSlayerDungeon extends core.Area {
    getName() {
      return "Karuulm Slayer Dungeon";
    }

    process(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (!player.isRegistered() || player.getHitpoints() <= 0) return;
      if (!inHeat(player.getLocation()) || isProtected(player)) return;
      burn(player);
    }
  }
  return new KaruulmSlayerDungeon(DUNGEON.levels.map(
    (level) => new core.Boundary(DUNGEON.minX, DUNGEON.maxX, DUNGEON.minY, DUNGEON.maxY, level),
  ));
}

module.exports = {
  name: "KaruulmSlayerDungeon",
  description: "The Karuulm Slayer Dungeon's extreme heat: 4 damage a tick beyond the entrance chamber without boots of stone, brimstone or granite boots, or the elite Kourend & Kebos Diary reward.",
  members: true,
  _test: { DAMAGE_PER_TICK, DUNGEON, ENTRANCE_CHAMBER, inHeat, isProtected, karuulmSlayerDungeon },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.registerArea(karuulmSlayerDungeon());
  },
};
