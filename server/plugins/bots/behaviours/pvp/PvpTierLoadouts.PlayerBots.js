"use strict";

/**
 * Lobby-chosen bot tiers (Novice / Intermediate / Veteran) shared by the minigames that
 * populate themselves with PvP bots (Castle Wars, Bounty Hunter). Each tier maps to a PvP
 * behaviour profile and a combat-level band; a bot draws a loadout+archetype inside the
 * band, so a Novice game fights with free-to-play-grade gear and a Veteran game with the
 * full presets.
 */

const { PVP_LOADOUT_DEFINITIONS, isLoadoutAvailable } = require("./PvpLoadoutRegistry.PlayerBots");
const { getPvpProfile } = require("./PvpProfileRegistry.PlayerBots");

const TIER_OPTIONS = Object.freeze([
  ["Novice", "novice"],
  ["Intermediate", "intermediate"],
  ["Veteran", "veteran"],
]);
const TIER_PROFILE_IDS = Object.freeze({
  novice: "novice",
  intermediate: "standard",
  veteran: "veteran",
});
const TIER_BANDS = Object.freeze({
  novice: Object.freeze({ min: 3, max: 80 }),
  intermediate: Object.freeze({ min: 81, max: 100 }),
  veteran: Object.freeze({ min: 101, max: 126 }),
});

/** Archetype stat lines are [attack, defence, strength, hp, ranged, prayer, magic]. */
function archetypeCombatLevel(stats) {
  const [attack, defence, strength, hp, ranged, prayer, magic] = stats;
  const base = (defence + hp + Math.floor(prayer / 2)) * 0.25;
  const offence = Math.max(
    (attack + strength) * 0.325,
    Math.floor(ranged * 1.5) * 0.325,
    Math.floor(magic * 1.5) * 0.325
  );
  return Math.min(126, Math.max(3, Math.floor(base + offence)));
}

/**
 * The level the preset policy will read for this archetype under `profile`: the sparse
 * "novice" profile bumps hitpoints, which moves the archetype's combat level, so the band
 * has to be judged with the same adjustment or the policy gates our forced archetype out.
 */
function tierCombatLevel(entry, profile) {
  const stats = [...entry.stats];
  if ((profile?.confidenceTier ?? 2) <= 1) {
    stats[3] = Math.max(80, stats[3] - 5);
  }
  return archetypeCombatLevel(stats);
}

/**
 * An archetype's main style, read from its kit: one that carries a spell to cast is a hybrid,
 * one whose weapon fires ammunition or is thrown is ranged, and the rest fight in melee.
 */
function buildStyle(entry) {
  if (entry.autocastSpell) return "hybrid";
  const equipment = entry.equipment ?? {};
  return equipment.ammo || typeof equipment.weapon?.amount === "number" ? "range" : "melee";
}

/** Every (loadout, archetype) pair of the PvP presets, built once; the tier filter does the rest. */
let archetypeChoices;
function getArchetypeChoices() {
  if (archetypeChoices) {
    return archetypeChoices;
  }
  const entries = new Map((PVP_LOADOUT_DEFINITIONS.archetypes ?? []).map((entry) => [entry.id, entry]));
  archetypeChoices = [];
  for (const loadout of PVP_LOADOUT_DEFINITIONS.loadouts ?? []) {
    if (!isLoadoutAvailable(loadout.id)) {
      continue;
    }
    for (const archetypeId of loadout.archetypes ?? []) {
      const entry = entries.get(archetypeId);
      if (entry) {
        archetypeChoices.push({ loadoutId: loadout.id, archetypeId, tags: loadout.tags ?? [], entry });
      }
    }
  }
  return archetypeChoices;
}

/**
 * A deterministic loadout+archetype for `tier`: the `index`th of the eligible choices, sorted.
 * `style` ("range" / "magic") keeps a post's combat style; `band` overrides the tier's level
 * band (Bounty Hunter narrows it to the levels a player can be matched with); `excludeF2p`
 * leaves out the free-to-play presets (members-only minigames); `build` keeps one buildStyle.
 * Returns null for an unknown tier.
 */
function pickTierChoice(tier, { index = 0, style = null, build = null, band = TIER_BANDS[tier], excludeF2p = false,
  profileId = TIER_PROFILE_IDS[tier] } = {}) {
  if (!TIER_PROFILE_IDS[tier] || !band) {
    return null;
  }
  const profile = getPvpProfile(profileId);
  const eligible = (choice) => {
    if (excludeF2p && choice.tags.includes("f2p")) {
      return false;
    }
    const minimumProfiles = choice.entry.minimumProfileIds;
    if (Array.isArray(minimumProfiles) && minimumProfiles.length > 0 && !minimumProfiles.includes(profile.id)) {
      return false;
    }
    const minimumConfidence = Number(choice.entry.minimumConfidenceTier ?? 0);
    return !(minimumConfidence > 0 && Number(profile.confidenceTier ?? 2) < minimumConfidence);
  };
  const all = getArchetypeChoices().filter(eligible);
  const styled = all.filter((choice) => (!style || choice.tags.includes(style)) && (!build || buildStyle(choice.entry) === build));
  const level = (choice) => tierCombatLevel(choice.entry, profile);
  let pool = styled.filter((choice) => level(choice) >= band.min && level(choice) <= band.max);
  if (pool.length === 0 && styled.length > 0) {
    // The preset data has no in-band archetype for this style and band (an intermediate
    // mage, say): take the nearest level band instead of changing the style.
    const centre = (band.min + band.max) / 2;
    const distance = (choice) => Math.abs(level(choice) - centre);
    const nearest = Math.min(...styled.map(distance));
    pool = styled.filter((choice) => distance(choice) <= nearest + 10);
  }
  const sorted = pool.sort(
    (a, b) => a.loadoutId.localeCompare(b.loadoutId) || a.archetypeId.localeCompare(b.archetypeId)
  );
  return sorted.length === 0 ? null : sorted[index % sorted.length];
}

module.exports = {
  TIER_OPTIONS,
  TIER_PROFILE_IDS,
  TIER_BANDS,
  archetypeCombatLevel,
  tierCombatLevel,
  buildStyle,
  pickTierChoice,
};
