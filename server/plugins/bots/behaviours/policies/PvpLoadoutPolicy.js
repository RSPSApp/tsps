"use strict";

const { applyPreset, getGlobalPresetByKey } = require("../../../modes/pvp/Presets");
const { Presetable } = require("../../../../src/main/typescript/elvarg/game/content/presets/Presetable");
const { CombatSpells } = require("../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { Item } = require("../../../../src/main/typescript/elvarg/game/model/Item");
const { MagicSpellbook } = require("../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { ItemIdentifiers } = require("../../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { getPvpProfile } = require("../pvp/PvpAssignment");
const { getPvpLoadout, PVP_LOADOUT_DEFINITIONS } = require("../pvp/PvpLoadoutRegistry");
const { SPEC_WEAPON_IDS } = require("./PvpCombatRuntimeCache");
const { isFoodItem } = require("../../../items/Food.plugin");

const ICE_BARRAGE_SPELL_ID = 12891;
const ICE_BLITZ_SPELL_ID = CombatSpells.ICE_BLITZ.spellId();
const ICE_BARRAGE_COMBAT_SPELL_ID = CombatSpells.ICE_BARRAGE.spellId();
const FIRE_BOLT_SPELL_ID = CombatSpells.FIRE_BOLT.spellId();
const FIRE_BLAST_SPELL_ID = CombatSpells.FIRE_BLAST.spellId();
const WIND_BLAST_SPELL_ID = CombatSpells.WIND_BLAST.spellId();
const BOT_LOADOUT_DEFINITIONS = PVP_LOADOUT_DEFINITIONS;

function pool(name) {
  const entries = BOT_LOADOUT_DEFINITIONS.pools[name];
  if (!Array.isArray(entries)) throw new Error("[pvp bot loadouts] unknown pool " + name);
  return Object.freeze(entries.map((key) => itemId(key, "pool " + name)));
}

function itemId(key, label) {
  const id = ItemIdentifiers[key];
  if (!Number.isInteger(id)) throw new Error("[pvp bot loadouts] " + label + " has unknown ItemIdentifiers key " + key);
  return id;
}

function itemIds(keys, label) {
  if (!Array.isArray(keys)) throw new Error("[pvp bot loadouts] " + label + " must be an array");
  return keys.map((key) => itemId(key, label));
}

const COMBAT_DEFINITIONS = BOT_LOADOUT_DEFINITIONS.combat ?? {};
const SPEC_AMMO_BY_WEAPON = new Map(Object.entries(COMBAT_DEFINITIONS.specAmmo ?? {}).map(([weapon, ammo]) => [
  itemId(weapon, "combat.specAmmo"), new Set(itemIds(ammo, "combat.specAmmo." + weapon)),
]));

function spellId(key) {
  const spell = CombatSpells[key];
  if (!spell || typeof spell.spellId !== "function") {
    throw new Error("[pvp bot loadouts] unknown CombatSpells key " + key);
  }
  return spell.spellId();
}

function magicPackages(definitions, spellCount) {
  if (!Array.isArray(definitions)) throw new Error("[pvp bot loadouts] magic packages must be an array");
  return Object.freeze(definitions.map((definition) => {
    if (!Array.isArray(definition.spells) || definition.spells.length !== spellCount) {
      throw new Error("[pvp bot loadouts] " + definition.style + " has invalid spell list");
    }
    const spells = definition.spells.map(spellId);
    return Object.freeze({
      weight: Number(definition.weight), style: definition.style, staffs: pool(definition.staffPool),
      strikeSpellId: spells[0], boltSpellId: spells[spellCount === 4 ? 1 : 0],
      blastSpellId: spells[spellCount === 4 ? 2 : 1], waveSpellId: spells[3],
    });
  }));
}

const ANCIENT_AUTOCAST_STAVES = pool("ancient_autocast_staves");
const REGULAR_AUTOCAST_STAVES = pool("regular_autocast_staves");
const REGULAR_MAGIC_PACKAGES = magicPackages(BOT_LOADOUT_DEFINITIONS.regularMagicPackages, 4);
function weightedPick(definitions, rng = Math.random) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return null;
  }
  const totalWeight = definitions.reduce((sum, definition) => {
    const weight = Number(definition?.weight ?? 0);
    return weight > 0 ? sum + weight : sum;
  }, 0);
  if (totalWeight <= 0) {
    return definitions[0] ?? null;
  }
  let roll = rng() * totalWeight;
  for (const definition of definitions) {
    const weight = Number(definition?.weight ?? 0);
    if (weight <= 0) {
      continue;
    }
    roll -= weight;
    if (roll <= 0) {
      return definition;
    }
  }
  return definitions[definitions.length - 1] ?? null;
}

function choose(values, rng = Math.random) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return values[Math.floor(rng() * values.length)] ?? null;
}

const BOT_PRESET_GROUPS = Object.freeze(BOT_LOADOUT_DEFINITIONS.presetGroups.map((group) =>
  Object.freeze({ ...group, presetKeys: Object.freeze([...group.presetKeys]) })
));

function selectBotPreset(state, rng = Math.random) {
  const pvp = state?.pvp;
  // F2P assignments must use their generated F2P gear, including after respawn.
  if (pvp?.presetPoolEnabled !== true || pvp.loadoutId?.startsWith("f2p_")) {
    return null;
  }
  const group =
    BOT_PRESET_GROUPS.find((entry) => entry.id === pvp.presetPoolGroup) ??
    weightedPick(BOT_PRESET_GROUPS, rng);
  if (!group) {
    return null;
  }
  pvp.presetPoolGroup = group.id;
  if (group.id === "random") {
    return null;
  }
  const presetKey = group.presetKeys.includes(pvp.presetPoolPresetKey)
    ? pvp.presetPoolPresetKey
    : choose(group.presetKeys, rng);
  const preset = getGlobalPresetByKey(presetKey);
  if (!preset) {
    return null;
  }
  pvp.presetPoolPresetKey = presetKey;
  return {
    preset,
    archetypeId: `preset:${presetKey}`,
    profileId: pvp.profileId ?? "standard",
    loadoutId: pvp.loadoutId ?? "edge_main_melee",
  };
}

function item(id, amount = 1) {
  return id == null ? null : new Item(id, amount);
}

const F2P_MAGIC_PACKAGES = magicPackages(BOT_LOADOUT_DEFINITIONS.f2pMagicPackages, 2);

function buildF2pMagicPackage(options = {}) {
  const {
    tier = "blast",
    elements = ["air", "water", "earth", "fire"],
  } = options;
  const allowedStyles = new Set(Array.isArray(elements) ? elements : ["air", "water", "earth", "fire"]);
  const packages = F2P_MAGIC_PACKAGES.filter((entry) => allowedStyles.has(entry.style));
  const selected = weightedPick(packages.length > 0 ? packages : F2P_MAGIC_PACKAGES) ?? F2P_MAGIC_PACKAGES[3];
  return {
    spellbook: MagicSpellbook.NORMAL,
    autocastSpellId: tier === "bolt" ? selected.boltSpellId : selected.blastSpellId,
    staffId: choose(selected.staffs),
    style: selected.style,
  };
}

function buildMagicPackage(profile, options = {}) {
  const confidenceTier = Number(profile?.confidenceTier ?? 2);
  const allowAncients = options.allowAncients !== false;
  const preferAncients = options.preferAncients === true;
  const hotspotId = typeof options.hotspotId === "string" ? options.hotspotId : "";

  const hotspotBias =
    hotspotId === "mage_bank" || hotspotId === "chaos_temple"
      ? 2
      : hotspotId === "revs_entrance" || hotspotId === "green_drags_gate"
      ? 1
      : hotspotId === "edge_ditch" || hotspotId === "edge_south"
      ? -1
      : 0;
  const effectiveTier = Math.max(1, confidenceTier + hotspotBias);

  const deepWildHotspot = hotspotId === "mage_bank" || hotspotId === "chaos_temple";
  const shouldUseAncients =
    allowAncients &&
    (
      preferAncients ||
      effectiveTier >= 4 ||
      (deepWildHotspot && effectiveTier >= 3)
    );

  if (shouldUseAncients) {
    const autocastSpellId =
      effectiveTier >= 4 ? ICE_BARRAGE_COMBAT_SPELL_ID : ICE_BLITZ_SPELL_ID;
    return {
      spellbook: MagicSpellbook.ANCIENT,
      autocastSpellId,
      staffId: choose(ANCIENT_AUTOCAST_STAVES),
      style: "ancient",
    };
  }

  const regularPackage = weightedPick(REGULAR_MAGIC_PACKAGES) ?? REGULAR_MAGIC_PACKAGES[3];
  let autocastSpellId = regularPackage.strikeSpellId;
  if (effectiveTier >= 4) {
    autocastSpellId = regularPackage.waveSpellId;
  } else if (effectiveTier >= 3) {
    autocastSpellId = regularPackage.blastSpellId;
  } else if (effectiveTier >= 2) {
    autocastSpellId = regularPackage.boltSpellId;
  }

  return {
    spellbook: MagicSpellbook.NORMAL,
    autocastSpellId,
    staffId: choose(regularPackage.staffs) ?? choose(REGULAR_AUTOCAST_STAVES),
    style: regularPackage.style,
  };
}

function profileAllowedForArchetype(archetype, profile) {
  const allowedProfiles = Array.isArray(archetype?.minimumProfileIds)
    ? archetype.minimumProfileIds
    : null;
  if (allowedProfiles && allowedProfiles.length > 0) {
    return allowedProfiles.includes(profile?.id ?? "standard");
  }
  const minimumConfidenceTier = Number(archetype?.minimumConfidenceTier ?? 0);
  if (minimumConfidenceTier > 0) {
    return Number(profile?.confidenceTier ?? 2) >= minimumConfidenceTier;
  }
  return true;
}

function resolveConfiguredItemId(spec, magicPackage) {
  if (spec == null) {
    return null;
  }
  if (Array.isArray(spec)) {
    return resolveConfiguredItemId(choose(spec), magicPackage);
  }
  if (typeof spec === "string") {
    if (spec.startsWith("@")) {
      return choose(pool(spec.slice(1)));
    }
    return spec === "magic_staff" ? magicPackage?.staffId : itemId(spec, "archetype item");
  }
  if (spec.choice) {
    return resolveConfiguredItemId(choose(spec.choice), magicPackage);
  }
  if (spec.pool) {
    return choose(pool(spec.pool));
  }
  if (spec.magicStaff) {
    return magicPackage?.staffId ?? itemId(spec.magicStaff, "archetype magicStaff");
  }
  return spec.item ? resolveConfiguredItemId(spec.item, magicPackage) : null;
}

function resolveConfiguredItem(spec, magicPackage) {
  if (spec == null) {
    return null;
  }
  const amount = typeof spec === "object" && !Array.isArray(spec)
    ? Number(spec.amount ?? 1)
    : 1;
  const id = resolveConfiguredItemId(spec, magicPackage);
  return id == null ? null : item(id, amount);
}

function buildConfiguredEquipment(definition, magicPackage) {
  return Object.values(definition.equipment ?? {})
    .map((spec) => resolveConfiguredItem(spec, magicPackage))
    .filter((entry) => entry != null);
}

function buildConfiguredInventory(definition, magicPackage) {
  const inventory = [];
  for (const spec of definition.inventory ?? []) {
    const repeat = typeof spec === "object" && !Array.isArray(spec)
      ? Number(spec.repeat ?? 1)
      : 1;
    for (let i = 0; i < repeat; i++) {
      const resolved = resolveConfiguredItem(spec, magicPackage);
      if (resolved) inventory.push(resolved);
    }
  }
  const fillId = resolveConfiguredItemId(definition.fill, magicPackage);
  while (fillId != null && inventory.length < 28) {
    inventory.push(item(fillId));
  }
  return inventory.slice(0, 28);
}

function resolveConfiguredMagicPackage(definition, profile, state) {
  const magic = definition.magic;
  if (!magic) {
    return null;
  }
  if (magic.type === "f2p") {
    return buildF2pMagicPackage(magic);
  }
  return buildMagicPackage(profile, {
    allowAncients: magic.allowAncients === true,
    preferAncients: magic.preferAncients === true,
    hotspotId: state?.pvp?.hotspotId,
  });
}

function buildConfiguredArchetype(definition) {
  if (!definition.equipment || !Array.isArray(definition.inventory)) {
    throw new Error("[pvp bot loadouts] incomplete archetype " + definition.id);
  }
  const autocastSpellId = definition.autocastSpell == null
    ? -1
    : spellId(definition.autocastSpell);
  return Object.freeze({
    id: definition.id,
    weight: Number(definition.weight),
    ...(definition.minimumProfileIds
      ? { minimumProfileIds: Object.freeze([...definition.minimumProfileIds]) }
      : {}),
    spellbook: MagicSpellbook[definition.spellbook] ?? MagicSpellbook.NORMAL,
    stats: Object.freeze([...definition.stats]),
    autocastSpellId,
    resolveMagicPackage: definition.magic
      ? (profile, state) => resolveConfiguredMagicPackage(definition, profile, state)
      : null,
    equipment: (magicPackage) => buildConfiguredEquipment(definition, magicPackage),
    inventory: (magicPackage) => buildConfiguredInventory(definition, magicPackage),
  });
}

const ARCHETYPES = Object.freeze(Object.fromEntries(
  BOT_LOADOUT_DEFINITIONS.archetypes.map((definition) => [
    definition.id,
    buildConfiguredArchetype(definition),
  ])
));

function getArchetypeChoices(loadoutId) {
  const loadout = getPvpLoadout(loadoutId);
  return (loadout?.archetypes ?? [])
    .map((archetypeId) => ARCHETYPES[archetypeId])
    .filter((entry) => entry != null);
}

function buildRandomPvpPreset(player, state) {
  const loadoutId = state?.pvp?.loadoutId ?? "edge_main_melee";
  const profile = getPvpProfile(state?.pvp?.profileId);
  // Loadout and profile are drawn independently at spawn. If no archetype is
  // valid for the selected profile, use a cheap generated fallback instead of
  // bypassing the profile gate and handing low-tier bots expensive gear.
  const allChoices = getArchetypeChoices(loadoutId);
  const gatedChoices = allChoices.filter((entry) =>
    profileAllowedForArchetype(entry, profile)
  );
  const choices = gatedChoices.length > 0 ? gatedChoices : getArchetypeChoices("budget_pk");
  const savedArchetypeId = state?.pvp?.generatedArchetypeId ?? null;
  const archetype =
    choices.find((entry) => entry.id === savedArchetypeId) ?? weightedPick(choices);
  if (!archetype) {
    return null;
  }

  const stats = [...(archetype.stats ?? [99, 99, 99, 99, 99, 99, 99])];
  if ((profile?.confidenceTier ?? 2) <= 1) {
    stats[3] = Math.max(80, stats[3] - 5);
  }
  const magicPackage =
    typeof archetype.resolveMagicPackage === "function"
      ? archetype.resolveMagicPackage(profile, state, player)
      : null;
  const resolvedSpellbook = magicPackage?.spellbook ?? archetype.spellbook ?? MagicSpellbook.NORMAL;
  const name = `PvP ${loadoutId}:${archetype.id}`;
  const generatedInventory = archetype.inventory(magicPackage, profile, state, player);
  const preset = new Presetable(
    name,
    generatedInventory,
    archetype.equipment(magicPackage, profile, state, player),
    stats,
    resolvedSpellbook,
    true,
    magicPackage?.autocastSpellId ?? archetype.autocastSpellId ?? -1
  );

  return {
    preset,
    archetypeId: archetype.id,
    profileId: profile?.id ?? "standard",
    loadoutId,
  };
}

function buildGeneratedPreset(player, state) {
  return selectBotPreset(state) ?? buildRandomPvpPreset(player, state);
}

function applyGeneratedPvpLoadout(player, state, options = {}) {
  if (!player || player.isPlayerBot?.() !== true) {
    return false;
  }
  const combat = player.getCombat?.();
  if (combat?.getTarget?.() || combat?.getAttacker?.() || player.getCombatFollowing?.()) {
    if (state?.pvp) state.pvp.loadoutPending = true;
    return false;
  }
  let generated;
  try {
    generated = buildGeneratedPreset(player, state);
  } catch (error) {
    if (state?.pvp) state.pvp.loadoutPending = true;
    options.api?.log?.("bot_pvp_loadout_generation_failed", {
      username: player.getUsername?.(),
      error: String(error),
    });
    return false;
  }
  if (!generated?.preset) {
    if (state?.pvp) state.pvp.loadoutPending = true;
    options.api?.log?.("bot_pvp_loadout_failed", {
      username: player.getUsername?.(),
      loadoutId: state?.pvp?.loadoutId ?? "edge_main_melee",
    });
    return false;
  }
  player.setCurrentPreset?.(generated.preset);
  let applied = false;
  try {
    applied = applyPreset(player, generated.preset);
  } catch (error) {
    options.api?.log?.("bot_pvp_loadout_apply_error", {
      username: player.getUsername?.(),
      loadoutId: generated.loadoutId,
      archetypeId: generated.archetypeId,
      error: String(error),
    });
  }
  if (!applied) {
    if (state?.pvp) state.pvp.loadoutPending = true;
    options.api?.log?.("bot_pvp_loadout_apply_failed", {
      username: player.getUsername?.(),
      loadoutId: generated.loadoutId,
      archetypeId: generated.archetypeId,
    });
    return false;
  }
  const inventoryItems = player.getInventory().getItems();
  if (player.getInventory().getFreeSlots() === 0 &&
      player.getEquipment().isSlotOccupied(Equipment.SHIELD_SLOT) &&
      inventoryItems.some((item) => item?.getDefinition().isDoubleHanded())) {
    // Virtual eating never frees a slot to stow the shield during a two-handed switch.
    const foodSlot = inventoryItems.findIndex((item) => isFoodItem(item?.getId()));
    if (foodSlot >= 0) player.getInventory().deleteAtSlot(foodSlot, 1);
  }
  if (state?.pvp) {
    state.pvp.loadoutPending = false;
    const equipment = generated.preset.getEquipment?.() ?? [];
    const inventory = generated.preset.getInventory?.() ?? [];
    state.pvp.generatedArchetypeId = generated.archetypeId;
    state.pvp.generatedPrimaryWeaponId =
      equipment.find?.((entry) =>
        entry?.getDefinition?.()?.getEquipmentType?.()?.getSlot?.() === Equipment.WEAPON_SLOT
      )?.getId?.() ?? null;
    state.pvp.generatedPrimaryAmmoId =
      equipment.find?.((entry) =>
        entry?.getDefinition?.()?.getEquipmentType?.()?.getSlot?.() === Equipment.AMMUNITION_SLOT
      )?.getId?.() ?? null;
    state.pvp.generatedSpecWeaponId =
      inventory.find?.((entry) => {
        const itemId = entry?.getId?.() ?? -1;
        return SPEC_WEAPON_IDS.has(itemId);
      })?.getId?.() ?? null;
    const specAmmoIds = SPEC_AMMO_BY_WEAPON.get(state.pvp.generatedSpecWeaponId);
    state.pvp.generatedSpecAmmoId = specAmmoIds
      ? inventory.find?.((entry) => specAmmoIds.has(entry?.getId?.() ?? -1))?.getId?.() ?? null
      : null;
    state.pvp.nextVengeanceAttemptAt = 0;
  }
  options.api?.log?.("bot_pvp_loadout_applied", {
    username: player.getUsername?.(),
    loadoutId: generated.loadoutId,
    profileId: generated.profileId,
    archetypeId: generated.archetypeId,
  });
  return true;
}

module.exports = {
  BOT_PRESET_GROUPS,
  selectBotPreset,
  applyGeneratedPvpLoadout,
  __testing: { buildGeneratedPreset },
};
