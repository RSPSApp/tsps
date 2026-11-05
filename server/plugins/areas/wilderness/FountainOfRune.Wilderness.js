"use strict";

const MAX_RANGE = 10;
const ACCESS_CACHE_TICKS = 1;
const LOW_ALCHEMY_DIARY_TASK = "cast-low-alchemy-at-the-fountain-of-rune";
const accessCache = new WeakMap();

let api;
let core;
let fountainIds;
let fountainObjects;
let lowAlchemySpellId;

/** Cache the static map locs once, rather than scanning every loaded object per cast. */
function getFountainObjects() {
  if (fountainObjects) return fountainObjects;
  const found = [];
  for (const objects of core.MapObjects.mapObjects.values()) {
    for (const object of objects) {
      if (fountainIds.has(object.getId())) found.push(object);
    }
  }
  // A player can arrive before the map's scenery has finished loading. Leave the cache
  // unset when empty so the next check can discover the loaded Fountain.
  if (found.length) fountainObjects = found;
  return found;
}

/** The Fountain's rune-free area follows its loaded scenery loc and projectile line of sight. */
function hasFountainRuneAccess(player) {
  if (!player?.getLocation || player.getPrivateArea?.() != null) return false;
  const location = player.getLocation();
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();

  // The Fountain is in the north-eastern Wilderness (levels 40-50). Avoid scanning
  // the loaded scenery map for players elsewhere in the world.
  if (x < 3200 || x > 3392 || y < 3840 || y > 3967 || z !== 0) return false;

  const cycle = core.World.getProcessCycle();
  const cached = accessCache.get(player);
  if (cached && cached.x === x && cached.y === y && cached.z === z
    && cycle - cached.cycle < ACCESS_CACHE_TICKS) return cached.allowed;

  let allowed = false;
  for (const object of getFountainObjects()) {
    const fountain = object.getLocation();
    if (fountain.getZ() !== z
      || Math.max(Math.abs(fountain.getX() - x), Math.abs(fountain.getY() - y)) > MAX_RANGE) continue;
    if (core.RegionManager.canProjectileAttack(player, location, fountain)) {
      allowed = true;
      break;
    }
  }

  accessCache.set(player, { x, y, z, cycle, allowed });
  return allowed;
}

function bypassRunes(event) {
  if (hasFountainRuneAccess(event.player)) event.bypass = true;
}

/** Spells at the Fountain do not award Magic experience, including item alchemy casts. */
function blockMagicExperience(event) {
  if (event.skill === core.Skill.MAGIC && hasFountainRuneAccess(event.player)) event.allow = false;
}

function noAlchemyExperience(payment) {
  if (hasFountainRuneAccess(payment.player)) payment.experience = 0;
}

function lowAlchemyAtFountain({ player, spellId }) {
  if (spellId !== lowAlchemySpellId || !hasFountainRuneAccess(player)) return;
  api.emitCustomEvent("diary:task", {
    player,
    diary: "wilderness",
    task: LOW_ALCHEMY_DIARY_TASK,
  });
}

module.exports = function attachFountainOfRune(pluginApi) {
  api = pluginApi;
  core = api.core;
  lowAlchemySpellId = core.EffectSpells.LOW_ALCHEMY.spellId();
  fountainIds = new Set([
    api.core.ObjectIdentifiers.FOUNTAIN_OF_RUNE,
    api.core.ObjectIdentifiers.FOUNTAIN_OF_RUNE_2,
  ]);
  api.onSpellRuneBypass(bypassRunes);
  api.onCanGainExperience(blockMagicExperience);
  api.onCustomEvent("magic:alchemy-payment", noAlchemyExperience);
  api.onCustomEvent("magic:alchemy-completed", lowAlchemyAtFountain);
};

Object.assign(module.exports, { hasFountainRuneAccess });
