"use strict";

/**
 * Fountain of Rune, as the client sees it: its script [proc,magic_runecount] (rev 234) returns an unlimited
 * count for any rune while `%fountain_of_rune_active = 1` (varbit 4145, RuneLite's FOUNTAIN_OF_RUNE_ACTIVE),
 * which is what lights the spellbook. The server's rune bypass is the other half: it must agree.
 */
const MAX_RANGE = 10;
const ACTIVE_VARBIT = 4145;
const ACCESS_CACHE_TICKS = 1;
const FOUNTAIN_NAME = "Fountain of Rune";
/**
 * The ruined fortress around the Fountain (Wiki map: x 3366-3388, y 3885-3903) with MAX_RANGE around it: the
 * only place a player can be in range, so the only place the plugin ever looks for the Fountain.
 */
const FOUNTAIN_BOX = { minX: 3350, maxX: 3400, minY: 3870, maxY: 3915 };
const LOW_ALCHEMY_DIARY_TASK = "cast-low-alchemy-at-the-fountain-of-rune";
const accessCache = new WeakMap();
/** Whether the client was last told the Fountain is active, per player. */
const lit = new WeakMap();

let api;
let core;
let fountainIds;
let fountainObjects;
let lowAlchemySpellId;

/**
 * A map loc that is the Fountain: its id or one of its cache transforms (the children 31941 desktop and 31942
 * mobile that a player sees), or its name. Recharge.Jewellery.js recognises the Fountain by what
 * ObjectDefinition.forPlayer resolves a loc to.
 */
function isFountain(object) {
  const id = object.getId();
  if (fountainIds.has(id)) return true;
  const transforms = core.CacheDefinitions.getObject(id)?.transforms;
  if (Array.isArray(transforms) && transforms.some((child) => fountainIds.has(child))) return true;
  return core.ObjectDefinition.forId(id)?.getName() === FOUNTAIN_NAME;
}

/** Cache the static map locs once, rather than scanning every loaded object per cast. */
function getFountainObjects() {
  if (fountainObjects) return fountainObjects;
  const found = [];
  for (const objects of core.MapObjects.mapObjects.values()) {
    for (const object of objects) {
      // Only the ruin around the Fountain is worth resolving: this reads each loc's cache type.
      const at = object.getLocation();
      if (at.getX() < FOUNTAIN_BOX.minX || at.getX() > FOUNTAIN_BOX.maxX
        || at.getY() < FOUNTAIN_BOX.minY || at.getY() > FOUNTAIN_BOX.maxY) continue;
      if (isFountain(object)) found.push(object);
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
  // Wiki: free players can visit the Fountain, "its features are only available to members".
  if (!core.WorldDefinition.isMembersWorld()) return false;
  const location = player.getLocation();
  const x = location.getX();
  const y = location.getY();
  const z = location.getZ();

  // Only near the Fountain does anything ask for it: elsewhere the loaded scenery map is never walked.
  if (x < FOUNTAIN_BOX.minX || x > FOUNTAIN_BOX.maxX || y < FOUNTAIN_BOX.minY || y > FOUNTAIN_BOX.maxY || z !== 0) return false;

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

/** Tells the client when the Fountain's range is entered or left, so the spellbook lights up. */
function syncSpellbook({ player }) {
  const active = hasFountainRuneAccess(player);
  if ((lit.get(player) ?? false) === active) return;
  lit.set(player, active);
  player.getPacketSender().sendVarbit(ACTIVE_VARBIT, active ? 1 : 0);
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
  api.onPlayerProcess(syncSpellbook);
  api.onCanGainExperience(blockMagicExperience);
  api.onCustomEvent("magic:alchemy-payment", noAlchemyExperience);
  api.onCustomEvent("magic:alchemy-completed", lowAlchemyAtFountain);
};

Object.assign(module.exports, { hasFountainRuneAccess });
