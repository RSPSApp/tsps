"use strict";

const { applyPreset, getGlobalPresetByKey } = require("../../../modes/pvp/Presets");
const { Presetable } = require("../../../../src/main/typescript/elvarg/game/content/presets/Presetable");
const { CombatSpells } = require("../../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { Item } = require("../../../../src/main/typescript/elvarg/game/model/Item");
const { MagicSpellbook } = require("../../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { ItemIdentifiers } = require("../../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { Equipment } = require("../../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { getPvpLoadout, getPvpProfile } = require("../pvp/PvpAssignment");
const { isFoodItem } = require("../../../items/Food.plugin");

const ICE_BARRAGE_SPELL_ID = 12891;
const ICE_BLITZ_SPELL_ID = CombatSpells.ICE_BLITZ.spellId();
const ICE_BARRAGE_COMBAT_SPELL_ID = CombatSpells.ICE_BARRAGE.spellId();
const WIND_STRIKE_SPELL_ID = CombatSpells.WIND_STRIKE.spellId();
const WATER_STRIKE_SPELL_ID = CombatSpells.WATER_STRIKE.spellId();
const EARTH_STRIKE_SPELL_ID = CombatSpells.EARTH_STRIKE.spellId();
const FIRE_STRIKE_SPELL_ID = CombatSpells.FIRE_STRIKE.spellId();
const WIND_BOLT_SPELL_ID = CombatSpells.WIND_BOLT.spellId();
const WATER_BOLT_SPELL_ID = CombatSpells.WATER_BOLT.spellId();
const EARTH_BOLT_SPELL_ID = CombatSpells.EARTH_BOLT.spellId();
const FIRE_BOLT_SPELL_ID = CombatSpells.FIRE_BOLT.spellId();
const WIND_BLAST_SPELL_ID = CombatSpells.WIND_BLAST.spellId();
const WATER_BLAST_SPELL_ID = CombatSpells.WATER_BLAST.spellId();
const EARTH_BLAST_SPELL_ID = CombatSpells.EARTH_BLAST.spellId();
const FIRE_BLAST_SPELL_ID = CombatSpells.FIRE_BLAST.spellId();
const WIND_WAVE_SPELL_ID = CombatSpells.WIND_WAVE.spellId();
const WATER_WAVE_SPELL_ID = CombatSpells.WATER_WAVE.spellId();
const EARTH_WAVE_SPELL_ID = CombatSpells.EARTH_WAVE.spellId();
const FIRE_WAVE_SPELL_ID = CombatSpells.FIRE_WAVE.spellId();
const ANCIENT_AUTOCAST_STAVES = Object.freeze([
  ItemIdentifiers.ANCIENT_STAFF,
]);
const REGULAR_AUTOCAST_STAVES = Object.freeze([
  ItemIdentifiers.STAFF_OF_AIR,
  ItemIdentifiers.STAFF_OF_WATER,
  ItemIdentifiers.STAFF_OF_EARTH,
  ItemIdentifiers.STAFF_OF_FIRE,
  ItemIdentifiers.MAGIC_STAFF,
  ItemIdentifiers.BATTLESTAFF,
  ItemIdentifiers.AIR_BATTLESTAFF,
  ItemIdentifiers.WATER_BATTLESTAFF,
  ItemIdentifiers.EARTH_BATTLESTAFF,
  ItemIdentifiers.FIRE_BATTLESTAFF,
  ItemIdentifiers.MYSTIC_AIR_STAFF,
  ItemIdentifiers.MYSTIC_WATER_STAFF,
  ItemIdentifiers.MYSTIC_EARTH_STAFF,
  ItemIdentifiers.MYSTIC_FIRE_STAFF,
]);

const REGULAR_MAGIC_PACKAGES = Object.freeze([
  Object.freeze({
    weight: 2,
    style: "air",
    staffs: Object.freeze([
      ItemIdentifiers.STAFF_OF_AIR,
      ItemIdentifiers.AIR_BATTLESTAFF,
      ItemIdentifiers.MYSTIC_AIR_STAFF,
    ]),
    strikeSpellId: WIND_STRIKE_SPELL_ID,
    boltSpellId: WIND_BOLT_SPELL_ID,
    blastSpellId: WIND_BLAST_SPELL_ID,
    waveSpellId: WIND_WAVE_SPELL_ID,
  }),
  Object.freeze({
    weight: 2,
    style: "water",
    staffs: Object.freeze([
      ItemIdentifiers.STAFF_OF_WATER,
      ItemIdentifiers.WATER_BATTLESTAFF,
      ItemIdentifiers.MYSTIC_WATER_STAFF,
    ]),
    strikeSpellId: WATER_STRIKE_SPELL_ID,
    boltSpellId: WATER_BOLT_SPELL_ID,
    blastSpellId: WATER_BLAST_SPELL_ID,
    waveSpellId: WATER_WAVE_SPELL_ID,
  }),
  Object.freeze({
    weight: 2,
    style: "earth",
    staffs: Object.freeze([
      ItemIdentifiers.STAFF_OF_EARTH,
      ItemIdentifiers.EARTH_BATTLESTAFF,
      ItemIdentifiers.MYSTIC_EARTH_STAFF,
    ]),
    strikeSpellId: EARTH_STRIKE_SPELL_ID,
    boltSpellId: EARTH_BOLT_SPELL_ID,
    blastSpellId: EARTH_BLAST_SPELL_ID,
    waveSpellId: EARTH_WAVE_SPELL_ID,
  }),
  Object.freeze({
    weight: 3,
    style: "fire",
    staffs: Object.freeze([
      ItemIdentifiers.STAFF_OF_FIRE,
      ItemIdentifiers.FIRE_BATTLESTAFF,
      ItemIdentifiers.MYSTIC_FIRE_STAFF,
    ]),
    strikeSpellId: FIRE_STRIKE_SPELL_ID,
    boltSpellId: FIRE_BOLT_SPELL_ID,
    blastSpellId: FIRE_BLAST_SPELL_ID,
    waveSpellId: FIRE_WAVE_SPELL_ID,
  }),
  Object.freeze({
    weight: 1,
    style: "arcane",
    staffs: Object.freeze([
      ItemIdentifiers.MAGIC_STAFF,
      ItemIdentifiers.BATTLESTAFF,
    ]),
    strikeSpellId: FIRE_STRIKE_SPELL_ID,
    boltSpellId: FIRE_BOLT_SPELL_ID,
    blastSpellId: FIRE_BLAST_SPELL_ID,
    waveSpellId: FIRE_WAVE_SPELL_ID,
  }),
]);

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

const BOT_PRESET_GROUPS = Object.freeze([
  Object.freeze({
    id: "main_126",
    weight: 30,
    presetKeys: Object.freeze([
      "MAIN_HYBRID_126", "MAIN_RUNE_126", "MAIN_MELEE_126", "MAIN_RCB_TANK_126", "DHAROK_126",
      "MAIN_BARRAGE_126", "VOID_RANGER_126", "VOID_MELEE_126", "KARILS_TANK_126", "MAIN_TRIBRID_126",
    ]),
  }),
  Object.freeze({
    id: "pure_1_def",
    weight: 30,
    presetKeys: Object.freeze([
      "DDS_PURE_M_73", "DDS_PURE_R_73", "G_MAULER_70", "NH_PURE_83", "OBBY_MAULER_57",
    ]),
  }),
  Object.freeze({
    id: "tank_45_def",
    weight: 15,
    presetKeys: Object.freeze(["ATT_60_ZERKER_94", "ATT_70_ZERKER_97"]),
  }),
  Object.freeze({
    id: "tank_70_def",
    weight: 15,
    presetKeys: Object.freeze(["MAIN_RCB_TANK_70"]),
  }),
  Object.freeze({ id: "random", weight: 10, presetKeys: Object.freeze([]) }),
]);

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

function randomBetween(min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function item(id, amount = 1) {
  return id == null ? null : new Item(id, amount);
}

function compact(items) {
  return items.filter((entry) => entry != null);
}

function repeat(itemId, amount, count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(item(itemId, amount));
  }
  return items;
}

function fillFood(inventory, foodId, count) {
  for (let i = 0; i < count; i++) {
    inventory.push(item(foodId));
  }
}

const MAGE_HATS = Object.freeze([
  ItemIdentifiers.SKELETAL_HELM,
  ItemIdentifiers.SKELETAL_HELM_2,
  ItemIdentifiers.MYSTIC_HAT,
  ItemIdentifiers.MYSTIC_HAT_DARK_,
  ItemIdentifiers.MYSTIC_HAT_LIGHT_,
  ItemIdentifiers.MYSTIC_HAT_DUSK_,
  ItemIdentifiers.INFINITY_HAT,
  ItemIdentifiers.SPLITBARK_HELM,
  ItemIdentifiers.GHOSTLY_HOOD,
  ItemIdentifiers.ELDER_CHAOS_HOOD,
  ItemIdentifiers.DAGONHAI_HAT,
]);

const MAGE_BODIES = Object.freeze([
  ItemIdentifiers.SKELETAL_TOP,
  ItemIdentifiers.SKELETAL_TOP_2,
  ItemIdentifiers.MYSTIC_ROBE_TOP,
  ItemIdentifiers.MYSTIC_ROBE_TOP_DARK_,
  ItemIdentifiers.MYSTIC_ROBE_TOP_LIGHT_,
  ItemIdentifiers.MYSTIC_ROBE_TOP_DUSK_,
  ItemIdentifiers.INFINITY_TOP,
  ItemIdentifiers.SPLITBARK_BODY,
  ItemIdentifiers.GHOSTLY_ROBE,
  ItemIdentifiers.ELDER_CHAOS_TOP,
  ItemIdentifiers.DAGONHAI_ROBE_TOP,
]);

const MAGE_LEGS = Object.freeze([
  ItemIdentifiers.SKELETAL_BOTTOMS,
  ItemIdentifiers.SKELETAL_BOTTOMS_2,
  ItemIdentifiers.MYSTIC_ROBE_BOTTOM,
  ItemIdentifiers.MYSTIC_ROBE_BOTTOM_DARK_,
  ItemIdentifiers.MYSTIC_ROBE_BOTTOM_LIGHT_,
  ItemIdentifiers.MYSTIC_ROBE_BOTTOM_DUSK_,
  ItemIdentifiers.INFINITY_BOTTOMS,
  ItemIdentifiers.SPLITBARK_LEGS,
  ItemIdentifiers.GHOSTLY_ROBE,
  ItemIdentifiers.ELDER_CHAOS_ROBE,
  ItemIdentifiers.DAGONHAI_ROBE_BOTTOM,
]);

const MAGE_GLOVES = Object.freeze([
  ItemIdentifiers.SKELETAL_GLOVES,
  ItemIdentifiers.SKELETAL_GLOVES_2,
  ItemIdentifiers.MYSTIC_GLOVES,
  ItemIdentifiers.MYSTIC_GLOVES_DARK_,
  ItemIdentifiers.MYSTIC_GLOVES_LIGHT_,
  ItemIdentifiers.MYSTIC_GLOVES_DUSK_,
  ItemIdentifiers.INFINITY_GLOVES,
  ItemIdentifiers.SPLITBARK_GAUNTLETS,
  ItemIdentifiers.GHOSTLY_GLOVES,
]);

const MAGE_BOOTS = Object.freeze([
  ItemIdentifiers.SKELETAL_BOOTS,
  ItemIdentifiers.SKELETAL_BOOTS_2,
  ItemIdentifiers.MYSTIC_BOOTS,
  ItemIdentifiers.MYSTIC_BOOTS_DARK_,
  ItemIdentifiers.MYSTIC_BOOTS_LIGHT_,
  ItemIdentifiers.MYSTIC_BOOTS_DUSK_,
  ItemIdentifiers.INFINITY_BOOTS,
  ItemIdentifiers.SPLITBARK_BOOTS,
  ItemIdentifiers.GHOSTLY_BOOTS,
]);

const MAGE_CAPES = Object.freeze([
  ItemIdentifiers.SARADOMIN_CAPE,
  ItemIdentifiers.ZAMORAK_CAPE,
  ItemIdentifiers.GUTHIX_CAPE,
  ItemIdentifiers.GHOSTLY_CLOAK,
  ItemIdentifiers.AVAS_ACCUMULATOR,
]);

const MAGE_OFFHANDS = Object.freeze([
  ItemIdentifiers.UNHOLY_BOOK,
  ItemIdentifiers.BOOK_OF_DARKNESS,
]);

const MAGE_STAVES = Object.freeze([
  ...ANCIENT_AUTOCAST_STAVES,
  ...REGULAR_AUTOCAST_STAVES,
]);

const RANGE_HEADS = Object.freeze([
  ItemIdentifiers.COIF,
  ItemIdentifiers.GREEN_HAT,
  ItemIdentifiers.GREY_HAT,
  ItemIdentifiers.BLUE_HAT,
  ItemIdentifiers.RED_HAT,
  ItemIdentifiers.ZAMORAK_COIF,
  ItemIdentifiers.GUTHIX_COIF,
  ItemIdentifiers.SARADOMIN_COIF,
  ItemIdentifiers.ANCIENT_COIF,
  ItemIdentifiers.BANDOS_COIF,
  ItemIdentifiers.ARMADYL_COIF,
]);

const RANGE_BODIES = Object.freeze([
  ItemIdentifiers.LEATHER_BODY,
  ItemIdentifiers.STUDDED_BODY,
  ItemIdentifiers.GREEN_DHIDE_BODY,
  ItemIdentifiers.BLUE_DHIDE_BODY,
  ItemIdentifiers.RED_DHIDE_BODY,
  ItemIdentifiers.BLACK_DHIDE_BODY,
  ItemIdentifiers.SPINED_BODY,
  ItemIdentifiers.SNAKESKIN_BODY,
  ItemIdentifiers.ZAMORAK_DHIDE,
  ItemIdentifiers.GUTHIX_DRAGONHIDE,
  ItemIdentifiers.SARADOMIN_DHIDE,
  ItemIdentifiers.ANCIENT_DHIDE,
  ItemIdentifiers.BANDOS_DHIDE,
  ItemIdentifiers.ARMADYL_DHIDE,
]);

const RANGE_LEGS = Object.freeze([
  ItemIdentifiers.STUDDED_CHAPS,
  ItemIdentifiers.GREEN_DHIDE_CHAPS,
  ItemIdentifiers.BLUE_DHIDE_CHAPS,
  ItemIdentifiers.RED_DHIDE_CHAPS,
  ItemIdentifiers.BLACK_DHIDE_CHAPS,
  ItemIdentifiers.SPINED_CHAPS,
  ItemIdentifiers.SNAKESKIN_CHAPS,
  ItemIdentifiers.ZAMORAK_CHAPS,
  ItemIdentifiers.GUTHIX_CHAPS,
  ItemIdentifiers.SARADOMIN_CHAPS,
  ItemIdentifiers.ANCIENT_CHAPS,
  ItemIdentifiers.BANDOS_CHAPS,
  ItemIdentifiers.ARMADYL_CHAPS,
]);

const RANGE_GLOVES = Object.freeze([
  ItemIdentifiers.GREEN_DHIDE_VAMB,
  ItemIdentifiers.BLUE_DHIDE_VAMB,
  ItemIdentifiers.RED_DHIDE_VAMB,
  ItemIdentifiers.BLACK_DHIDE_VAMB,
  ItemIdentifiers.SPINED_GLOVES,
  ItemIdentifiers.SNAKESKIN_VAMBRACES,
  ItemIdentifiers.ZAMORAK_BRACERS,
  ItemIdentifiers.GUTHIX_BRACERS,
  ItemIdentifiers.SARADOMIN_BRACERS,
  ItemIdentifiers.ANCIENT_BRACERS,
  ItemIdentifiers.BANDOS_BRACERS,
  ItemIdentifiers.ARMADYL_BRACERS,
  ItemIdentifiers.MITHRIL_GLOVES,
  ItemIdentifiers.BARROWS_GLOVES,
]);

const RANGE_BOOTS = Object.freeze([
  ItemIdentifiers.CLIMBING_BOOTS,
  ItemIdentifiers.SNAKESKIN_BOOTS,
  ItemIdentifiers.SPINED_BOOTS,
  ItemIdentifiers.ANCIENT_DHIDE_BOOTS,
  ItemIdentifiers.BANDOS_DHIDE_BOOTS,
  ItemIdentifiers.GUTHIX_DHIDE_BOOTS,
  ItemIdentifiers.ARMADYL_DHIDE_BOOTS,
  ItemIdentifiers.SARADOMIN_DHIDE_BOOTS,
  ItemIdentifiers.ZAMORAK_DHIDE_BOOTS,
]);

const RANGE_CAPES = Object.freeze([
  ItemIdentifiers.AVAS_ACCUMULATOR,
  ItemIdentifiers.OBSIDIAN_CAPE,
]);

const BLACK_MASKS = Object.freeze([
  ItemIdentifiers.BLACK_MASK,
]);

const F2P_CAPES = Object.freeze([
  ItemIdentifiers.BLACK_CAPE,
  ItemIdentifiers.RED_CAPE,
]);

const F2P_RANGE_HEADS = Object.freeze([
  ItemIdentifiers.COIF,
  ItemIdentifiers.GREEN_HAT,
  ItemIdentifiers.GREY_HAT,
  ItemIdentifiers.BLUE_HAT,
  ItemIdentifiers.RED_HAT,
]);

const F2P_RANGE_BODIES = Object.freeze([
  ItemIdentifiers.LEATHER_BODY,
  ItemIdentifiers.HARDLEATHER_BODY,
  ItemIdentifiers.STUDDED_BODY,
  ItemIdentifiers.GREEN_DHIDE_BODY,
]);

const F2P_RANGE_LEGS = Object.freeze([
  ItemIdentifiers.STUDDED_CHAPS,
  ItemIdentifiers.GREEN_DHIDE_CHAPS,
]);

const F2P_MAGE_HEADS = Object.freeze([
  ItemIdentifiers.WIZARD_HAT,
  ItemIdentifiers.BLUE_WIZARD_HAT,
]);

const F2P_MAGE_BODIES = Object.freeze([
  ItemIdentifiers.BLUE_WIZARD_ROBE,
  ItemIdentifiers.ZAMORAK_ROBE_TOP,
  ItemIdentifiers.MONKS_ROBE_TOP,
]);

const F2P_MAGE_LEGS = Object.freeze([
  ItemIdentifiers.ZAMORAK_ROBE_LEGS,
  ItemIdentifiers.MONKS_ROBE,
]);

const HYBRID_MAGE_TOPS = Object.freeze([
  ItemIdentifiers.SKELETAL_TOP,
  ItemIdentifiers.SKELETAL_TOP_2,
  ItemIdentifiers.MYSTIC_ROBE_TOP,
  ItemIdentifiers.MYSTIC_ROBE_TOP_DARK_,
  ItemIdentifiers.MYSTIC_ROBE_TOP_LIGHT_,
  ItemIdentifiers.INFINITY_TOP,
  ItemIdentifiers.SPLITBARK_BODY,
  ItemIdentifiers.GHOSTLY_ROBE,
  ItemIdentifiers.ELDER_CHAOS_TOP,
  ItemIdentifiers.DAGONHAI_ROBE_TOP,
]);

const HYBRID_RANGE_LEGS = Object.freeze([
  ItemIdentifiers.SKELETAL_BOTTOMS,
  ItemIdentifiers.SKELETAL_BOTTOMS_2,
  ItemIdentifiers.MYSTIC_ROBE_BOTTOM,
  ItemIdentifiers.SPLITBARK_LEGS,
  ItemIdentifiers.BLACK_DHIDE_CHAPS,
  ItemIdentifiers.RED_DHIDE_CHAPS,
  ItemIdentifiers.BLUE_DHIDE_CHAPS,
  ItemIdentifiers.SPINED_CHAPS,
  ItemIdentifiers.ANCIENT_CHAPS,
  ItemIdentifiers.BANDOS_CHAPS,
  ItemIdentifiers.ARMADYL_CHAPS,
  ItemIdentifiers.GUTHIX_CHAPS,
  ItemIdentifiers.SARADOMIN_CHAPS,
  ItemIdentifiers.ZAMORAK_CHAPS,
]);

function chooseHybridWearSet() {
  return {
    head: choose([
      ItemIdentifiers.COIF,
      ItemIdentifiers.HELM_OF_NEITIZNOT,
      ItemIdentifiers.BLACK_MASK,
      ...MAGE_HATS,
    ]),
    cape: choose([...MAGE_CAPES, ...RANGE_CAPES]),
    body: choose([...HYBRID_MAGE_TOPS, ...RANGE_BODIES]),
    legs: choose(HYBRID_RANGE_LEGS),
    gloves: choose([ItemIdentifiers.BARROWS_GLOVES, ...MAGE_GLOVES, ...RANGE_GLOVES]),
    boots: choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS, ...MAGE_BOOTS, ...RANGE_BOOTS]),
    offhand: choose(MAGE_OFFHANDS),
  };
}

function chooseEdgeMeleeBody(profile) {
  const options = [
    ItemIdentifiers.RUNE_PLATEBODY,
    ItemIdentifiers.RUNE_CHAINBODY,
    ItemIdentifiers.FIGHTER_TORSO,
    ItemIdentifiers.OBSIDIAN_PLATEBODY,
  ];
  if (isVeteranOrEliteProfile(profile)) {
    options.push(ItemIdentifiers.GRANITE_BODY);
  }
  return choose(options);
}

function chooseEdgeMeleeLegs(profile) {
  const options = [
    ItemIdentifiers.RUNE_PLATELEGS,
    ItemIdentifiers.RUNE_PLATESKIRT,
    ItemIdentifiers.OBSIDIAN_PLATELEGS,
  ];
  if (isEliteProfile(profile)) {
    options.push(ItemIdentifiers.DRAGON_PLATELEGS);
    options.push(ItemIdentifiers.DRAGON_PLATESKIRT);
  }
  return choose(options);
}

function chooseEdgeMeleeOffhand(profile) {
  const options = [ItemIdentifiers.RUNE_DEFENDER];
  if (isVeteranOrEliteProfile(profile)) {
    options.push(ItemIdentifiers.DRAGON_DEFENDER);
  }
  return choose(options);
}

function chooseAncientsHybridWearSet(profile) {
  if (isVeteranOrEliteProfile(profile)) {
    return {
      head: choose([ItemIdentifiers.AHRIMS_HOOD, ItemIdentifiers.HELM_OF_NEITIZNOT, ItemIdentifiers.COIF, ...MAGE_HATS]),
      cape: choose([...MAGE_CAPES, ...RANGE_CAPES]),
      body: choose([ItemIdentifiers.AHRIMS_ROBETOP, ...HYBRID_MAGE_TOPS, ItemIdentifiers.BLACK_DHIDE_BODY]),
      legs: choose([ItemIdentifiers.AHRIMS_ROBESKIRT, ...HYBRID_RANGE_LEGS]),
      gloves: choose([ItemIdentifiers.BARROWS_GLOVES, ...MAGE_GLOVES, ...RANGE_GLOVES]),
      boots: choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS, ...MAGE_BOOTS, ...RANGE_BOOTS]),
      offhand: choose(MAGE_OFFHANDS),
    };
  }
  return chooseHybridWearSet();
}

function chooseEliteDarkBowSpecPrimary(magicPackage) {
  return (
    weightedPick([
      {
        weight: 5,
        weaponId: magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF,
        ammoId: null,
        usesAvas: false,
        useOffhand: true,
      },
      {
        weight: 2,
        weaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        ammoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        usesAvas: true,
        useOffhand: false,
      },
      {
        weight: 2,
        weaponId: ItemIdentifiers.CRYSTAL_BOW_FULL,
        ammoId: null,
        usesAvas: true,
        useOffhand: false,
      },
    ]) ?? {
      weaponId: magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF,
      ammoId: null,
      usesAvas: false,
      useOffhand: true,
    }
  );
}

function choosePureHybridWearSet() {
  return {
    head: choose([ItemIdentifiers.COIF, ItemIdentifiers.GREY_HAT, ...MAGE_HATS]),
    cape: choose([ItemIdentifiers.ZAMORAK_CAPE, ...MAGE_CAPES]),
    body: choose([
      ItemIdentifiers.ZAMORAK_ROBE,
      ItemIdentifiers.GHOSTLY_ROBE,
      ItemIdentifiers.MYSTIC_ROBE_TOP,
      ItemIdentifiers.MYSTIC_ROBE_TOP_DARK_,
      ItemIdentifiers.MYSTIC_ROBE_TOP_LIGHT_,
      ItemIdentifiers.MYSTIC_ROBE_TOP_DUSK_,
      ItemIdentifiers.SPLITBARK_BODY,
      ItemIdentifiers.BLACK_DHIDE_BODY,
      ItemIdentifiers.RED_DHIDE_BODY,
    ]),
    legs: choose([
      ItemIdentifiers.BLACK_DHIDE_CHAPS,
      ItemIdentifiers.RED_DHIDE_CHAPS,
      ItemIdentifiers.BLUE_DHIDE_CHAPS,
      ItemIdentifiers.SPINED_CHAPS,
      ItemIdentifiers.STUDDED_CHAPS,
    ]),
    gloves: choose([ItemIdentifiers.MITHRIL_GLOVES, ...MAGE_GLOVES, ...RANGE_GLOVES]),
    boots: choose([ItemIdentifiers.CLIMBING_BOOTS, ...MAGE_BOOTS, ...RANGE_BOOTS]),
    offhand: choose(MAGE_OFFHANDS),
  };
}

function chooseF2pRangeWearSet() {
  return {
    head: choose(F2P_RANGE_HEADS),
    cape: choose(F2P_CAPES),
    body: choose(F2P_RANGE_BODIES),
    legs: choose(F2P_RANGE_LEGS),
  };
}

function chooseF2pMageWearSet() {
  return {
    head: choose(F2P_MAGE_HEADS),
    cape: choose(F2P_CAPES),
    body: choose(F2P_MAGE_BODIES),
    legs: choose(F2P_MAGE_LEGS),
  };
}

function chooseInitiateCape(options = {}) {
  if (options.preferRange === true) {
    return choose([ItemIdentifiers.AVAS_ACCUMULATOR, ItemIdentifiers.OBSIDIAN_CAPE]);
  }
  return choose([
    ItemIdentifiers.OBSIDIAN_CAPE,
    ItemIdentifiers.STRENGTH_CAPE_T_,
    ItemIdentifiers.ZAMORAK_CAPE,
  ]);
}

function chooseInitiateAmulet(options = {}) {
  if (options.preferStrength === true) {
    return choose([ItemIdentifiers.AMULET_OF_STRENGTH, ItemIdentifiers.AMULET_OF_GLORY]);
  }
  return choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_STRENGTH]);
}

function chooseInitiateGloves(profile) {
  const options = [
    ItemIdentifiers.MITHRIL_GLOVES,
    ItemIdentifiers.ADAMANT_GLOVES,
    ItemIdentifiers.COMBAT_BRACELET,
  ];
  if (isVeteranOrEliteProfile(profile)) {
    options.push(ItemIdentifiers.BARROWS_GLOVES);
  }
  return choose(options);
}

function chooseInitiateRing(profile) {
  const options = [ItemIdentifiers.RING_OF_RECOIL, ItemIdentifiers.BERSERKER_RING];
  if (isEliteProfile(profile)) {
    options.push(ItemIdentifiers.BERSERKER_RING_I_);
  }
  return choose(options);
}

function chooseInitiateOffhand(profile) {
  const options = [
    ItemIdentifiers.MITHRIL_DEFENDER,
    ItemIdentifiers.UNHOLY_BOOK,
    ItemIdentifiers.BOOK_OF_LAW,
  ];
  if (isVeteranOrEliteProfile(profile)) {
    options.push(ItemIdentifiers.RUNE_DEFENDER);
  }
  return choose(options);
}

function buildInitiateMeleeInventory(specWeaponId, options = {}) {
  const inventory = [
    item(specWeaponId),
    item(ItemIdentifiers.SUPER_ATTACK_4_),
    item(ItemIdentifiers.SUPER_STRENGTH_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
    item(ItemIdentifiers.RING_OF_RECOIL),
  ];
  const karams = Number(options.comboEatCount ?? 5);
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
  return inventory.slice(0, 28);
}

function buildInitiateRangeInventory(specWeaponId, ammoAmount = 180, options = {}) {
  const inventory = compact([
    item(specWeaponId),
    item(ItemIdentifiers.RUNE_ARROW, ammoAmount),
    item(ItemIdentifiers.RANGING_POTION_4_),
    item(ItemIdentifiers.SUPER_ATTACK_4_),
    item(ItemIdentifiers.SUPER_STRENGTH_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
  ]);
  const karams = Number(options.comboEatCount ?? 5);
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
  return inventory.slice(0, 28);
}

const F2P_MAGIC_PACKAGES = Object.freeze([
  Object.freeze({
    weight: 2,
    style: "air",
    staffs: Object.freeze([ItemIdentifiers.STAFF_OF_AIR]),
    boltSpellId: WIND_BOLT_SPELL_ID,
    blastSpellId: WIND_BLAST_SPELL_ID,
  }),
  Object.freeze({
    weight: 2,
    style: "water",
    staffs: Object.freeze([ItemIdentifiers.STAFF_OF_WATER]),
    boltSpellId: WATER_BOLT_SPELL_ID,
    blastSpellId: WATER_BLAST_SPELL_ID,
  }),
  Object.freeze({
    weight: 2,
    style: "earth",
    staffs: Object.freeze([ItemIdentifiers.STAFF_OF_EARTH]),
    boltSpellId: EARTH_BOLT_SPELL_ID,
    blastSpellId: EARTH_BLAST_SPELL_ID,
  }),
  Object.freeze({
    weight: 3,
    style: "fire",
    staffs: Object.freeze([ItemIdentifiers.STAFF_OF_FIRE]),
    boltSpellId: FIRE_BOLT_SPELL_ID,
    blastSpellId: FIRE_BLAST_SPELL_ID,
  }),
]);

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
    staffId: choose(selected.staffs) ?? ItemIdentifiers.STAFF_OF_FIRE,
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

function buildEdgeMeleeInventory(specWeaponId, options = {}) {
  const inventory = [
    item(specWeaponId),
    item(ItemIdentifiers.SUPER_ATTACK_4_),
    item(ItemIdentifiers.SUPER_STRENGTH_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
    item(ItemIdentifiers.RING_OF_RECOIL),
  ];
  const karams = Number(options.comboEatCount ?? 4);
  const sharks = 28 - inventory.length - karams;
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  fillFood(inventory, ItemIdentifiers.SHARK, sharks);
  return inventory.slice(0, 28);
}

function buildRangeToMeleeInventory(specWeaponId, ammoId, ammoAmount, options = {}) {
  const inventory = compact([
    item(specWeaponId),
    ammoId != null ? item(ammoId, ammoAmount) : null,
    item(ItemIdentifiers.RANGING_POTION_4_),
    item(ItemIdentifiers.SUPER_ATTACK_4_),
    item(ItemIdentifiers.SUPER_STRENGTH_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
  ]);
  const karams = Number(options.comboEatCount ?? 4);
  const sharks = 28 - inventory.length - karams;
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  fillFood(inventory, ItemIdentifiers.SHARK, sharks);
  return inventory.slice(0, 28);
}

function buildDharokInventory(options = {}) {
  const inventory = [
    item(ItemIdentifiers.SUPER_COMBAT_POTION_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SUPER_RESTORE_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
    item(ItemIdentifiers.SARADOMIN_BREW_4_),
    item(ItemIdentifiers.RING_OF_RECOIL),
  ];
  const karams = Number(options.comboEatCount ?? 6);
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
  return inventory.slice(0, 28);
}

function isVeteranOrEliteProfile(profile) {
  return profile?.id === "veteran" || profile?.id === "elite";
}

function isEliteProfile(profile) {
  return profile?.id === "elite";
}

function chooseEliteSpecWeapon() {
  return choose([
    ItemIdentifiers.DRAGON_CLAWS,
    ItemIdentifiers.ARMADYL_GODSWORD,
    ItemIdentifiers.BANDOS_GODSWORD,
    ItemIdentifiers.SARADOMIN_GODSWORD,
    ItemIdentifiers.ZAMORAK_GODSWORD,
    ItemIdentifiers.ANCIENT_GODSWORD,
    ItemIdentifiers.BARRELCHEST_ANCHOR,
  ]);
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

function chooseVoidBody(profile) {
  return isEliteProfile(profile)
    ? ItemIdentifiers.ELITE_VOID_TOP
    : ItemIdentifiers.VOID_KNIGHT_TOP;
}

function chooseVoidLegs(profile) {
  return isEliteProfile(profile)
    ? ItemIdentifiers.ELITE_VOID_ROBE
    : ItemIdentifiers.VOID_KNIGHT_ROBE;
}

function buildHybridInventory(options = {}) {
  const {
    meleeWeaponId = ItemIdentifiers.ABYSSAL_WHIP,
    specWeaponId = ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
    rangeWeaponId = ItemIdentifiers.RUNE_CROSSBOW,
    rangeAmmoId = ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
    rangeAmmoAmount = 120,
    mageBodyId = ItemIdentifiers.MYSTIC_ROBE_TOP,
    mageLegId = ItemIdentifiers.MYSTIC_ROBE_BOTTOM,
    rangeBodyId = ItemIdentifiers.BLACK_DHIDE_BODY,
    rangeLegId = ItemIdentifiers.BLACK_DHIDE_CHAPS,
    shieldId = ItemIdentifiers.UNHOLY_BOOK,
    spellbook = MagicSpellbook.ANCIENT,
    extraFood = 0,
  } = options;

  const restoreCount = randomBetween(2, 3);
  const brewCount = randomBetween(1, 3);
  const inventory = [
    item(meleeWeaponId),
    item(specWeaponId),
    item(rangeWeaponId),
    item(rangeAmmoId, rangeAmmoAmount),
    item(rangeBodyId),
    item(rangeLegId),
    item(mageBodyId),
    item(mageLegId),
    item(shieldId),
    item(ItemIdentifiers.RANGING_POTION_4_),
  ];
  inventory.push(...repeat(ItemIdentifiers.SUPER_RESTORE_4_, 1, restoreCount));
  inventory.push(...repeat(ItemIdentifiers.SARADOMIN_BREW_4_, 1, brewCount));

  const karams = randomBetween(3, 6);
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, karams));
  const sharks = 28 - inventory.length + extraFood;
  fillFood(inventory, ItemIdentifiers.SHARK, Math.max(0, sharks));
  return inventory.slice(0, 28);
}

function buildStaffHybridInventory(options = {}) {
  const {
    staffId = ItemIdentifiers.ANCIENT_STAFF,
    specWeaponId = null,
    meleeWeaponId = ItemIdentifiers.ABYSSAL_WHIP,
    rangeWeaponId = ItemIdentifiers.RUNE_CROSSBOW,
    rangeAmmoId = ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
    rangeAmmoAmount = 100,
    mageBodyId = ItemIdentifiers.MYSTIC_ROBE_TOP,
    mageLegId = ItemIdentifiers.MYSTIC_ROBE_BOTTOM,
    rangeBodyId = ItemIdentifiers.BLACK_DHIDE_BODY,
    rangeLegId = ItemIdentifiers.BLACK_DHIDE_CHAPS,
    shieldId = ItemIdentifiers.BOOK_OF_DARKNESS,
    extraFood = 0,
  } = options;

  const restoreCount = randomBetween(2, 3);
  const brewCount = randomBetween(1, 3);
  const inventory = compact([
    item(staffId),
    meleeWeaponId != null ? item(meleeWeaponId) : null,
    specWeaponId != null ? item(specWeaponId) : null,
    item(rangeWeaponId),
    item(rangeAmmoId, rangeAmmoAmount),
    item(rangeBodyId),
    item(rangeLegId),
    item(mageBodyId),
    item(mageLegId),
    item(shieldId),
    item(ItemIdentifiers.RANGING_POTION_4_),
  ]);
  inventory.push(...repeat(ItemIdentifiers.SUPER_RESTORE_4_, 1, restoreCount));
  inventory.push(...repeat(ItemIdentifiers.SARADOMIN_BREW_4_, 1, brewCount));
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, randomBetween(3, 5)));
  fillFood(inventory, ItemIdentifiers.SHARK, Math.max(0, 28 - inventory.length + extraFood));
  return inventory.slice(0, 28);
}

function buildDarkBowSpecInventory(options = {}) {
  const {
    specAmmoAmount = 90,
    rangingPotionCount = 1,
    restoreCount = randomBetween(2, 4),
    brewCount = randomBetween(1, 3),
    comboEatCount = randomBetween(4, 6),
  } = options;

  const inventory = [
    item(ItemIdentifiers.DARK_BOW),
    item(ItemIdentifiers.DRAGON_ARROW, specAmmoAmount),
  ];

  inventory.push(...repeat(ItemIdentifiers.RANGING_POTION_4_, 1, rangingPotionCount));
  inventory.push(...repeat(ItemIdentifiers.SUPER_RESTORE_4_, 1, restoreCount));
  inventory.push(...repeat(ItemIdentifiers.SARADOMIN_BREW_4_, 1, brewCount));
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, comboEatCount));
  fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
  return inventory.slice(0, 28);
}

function buildAntiPkInventory(options = {}) {
  const spellbook = options.spellbook ?? MagicSpellbook.ANCIENT;
  const restoreCount = randomBetween(1, 3);
  const brewCount = randomBetween(1, 2);
  const inventory = [
    item(options.meleeWeaponId ?? ItemIdentifiers.ABYSSAL_WHIP),
    item(options.specWeaponId ?? ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_),
    item(options.mageWeaponId ?? ItemIdentifiers.ANCIENT_STAFF),
    item(options.mageBodyId ?? ItemIdentifiers.MYSTIC_ROBE_TOP),
    item(options.mageLegId ?? ItemIdentifiers.BLACK_DHIDE_CHAPS),
    item(ItemIdentifiers.SUPER_ATTACK_4_),
    item(ItemIdentifiers.SUPER_STRENGTH_4_),
    item(ItemIdentifiers.RANGING_POTION_4_),
  ];
  inventory.push(...repeat(ItemIdentifiers.SUPER_RESTORE_4_, 1, restoreCount));
  inventory.push(...repeat(ItemIdentifiers.SARADOMIN_BREW_4_, 1, brewCount));
  inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, randomBetween(3, 5)));
  fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
  return inventory.slice(0, 28);
}

function buildF2pFoodBlock(inventory, options = {}) {
  const pizzaCount = Number(options.pizzaCount ?? randomBetween(2, 5));
  const swordfishCount = Math.max(0, 28 - inventory.length - pizzaCount);
  inventory.push(...repeat(ItemIdentifiers.ANCHOVY_PIZZA, 1, pizzaCount));
  fillFood(inventory, ItemIdentifiers.SWORDFISH, swordfishCount);
  return inventory.slice(0, 28);
}

function buildF2pMeleeInventory(koWeaponId, options = {}) {
  const inventory = [
    item(koWeaponId),
    item(ItemIdentifiers.STRENGTH_POTION_4_),
    item(ItemIdentifiers.STRENGTH_POTION_4_),
  ];
  return buildF2pFoodBlock(inventory, options);
}

function buildF2pRangeInventory(koWeaponId, ammoAmount = 180, options = {}) {
  const inventory = [
    item(koWeaponId),
    item(ItemIdentifiers.ADAMANT_ARROW, ammoAmount),
    item(ItemIdentifiers.STRENGTH_POTION_4_),
    item(ItemIdentifiers.STRENGTH_POTION_4_),
  ];
  return buildF2pFoodBlock(inventory, options);
}

function buildF2pBindInventory(options = {}) {
  const {
    switchWeaponId = ItemIdentifiers.MAPLE_SHORTBOW,
    ammoAmount = 160,
    spellTier = "blast",
  } = options;
  const inventory = [
    item(switchWeaponId),
    item(ItemIdentifiers.ADAMANT_ARROW, ammoAmount),
    item(ItemIdentifiers.STRENGTH_POTION_4_),
  ];

  return buildF2pFoodBlock(inventory, { pizzaCount: 4 });
}

function buildF2pMagePureInventory(options = {}) {
  const { spellTier = "blast", element = "fire" } = options;
  const inventory = [item(ItemIdentifiers.STRENGTH_POTION_4_)];

  return buildF2pFoodBlock(inventory, { pizzaCount: 5, swordfishCount: 10 });
}

function buildF2pBindKoInventory(options = {}) {
  const {
    koWeaponId = ItemIdentifiers.RUNE_2H_SWORD,
    spellTier = "blast",
  } = options;
  const inventory = [item(koWeaponId), item(ItemIdentifiers.STRENGTH_POTION_4_)];

  return buildF2pFoodBlock(inventory, { pizzaCount: 4, swordfishCount: 9 });
}

const ARCHETYPES = Object.freeze({
  initiate_dscim_dds: Object.freeze({
    id: "initiate_dscim_dds",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 20, 99, 90, 82, 52, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.INITIATE_SALLET),
        item(chooseInitiateCape()),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(chooseInitiateAmulet({ preferStrength: true })),
        item(ItemIdentifiers.INITIATE_HAUBERK),
        item(chooseInitiateOffhand(profile)),
        item(ItemIdentifiers.INITIATE_CUISSE),
        item(chooseInitiateGloves(profile)),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS])),
        item(chooseInitiateRing(profile)),
      ]),
    inventory: () =>
      buildInitiateMeleeInventory(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_),
  }),
  initiate_dscim_gmaul: Object.freeze({
    id: "initiate_dscim_gmaul",
    weight: 16,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 20, 99, 90, 88, 52, 82],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.INITIATE_SALLET),
        item(chooseInitiateCape()),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(chooseInitiateAmulet({ preferStrength: true })),
        item(ItemIdentifiers.INITIATE_HAUBERK),
        item(chooseInitiateOffhand(profile)),
        item(choose([ItemIdentifiers.INITIATE_CUISSE, ItemIdentifiers.BLACK_DHIDE_CHAPS])),
        item(chooseInitiateGloves(profile)),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS])),
        item(chooseInitiateRing(profile)),
      ]),
    inventory: () =>
      buildInitiateMeleeInventory(ItemIdentifiers.GRANITE_MAUL, { comboEatCount: 6 }),
  }),
  initiate_msb_gmaul: Object.freeze({
    id: "initiate_msb_gmaul",
    weight: 12,
    spellbook: MagicSpellbook.NORMAL,
    stats: [50, 20, 99, 88, 96, 52, 82],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.INITIATE_SALLET),
        item(chooseInitiateCape({ preferRange: true })),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(chooseInitiateAmulet()),
        item(ItemIdentifiers.INITIATE_HAUBERK),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.INITIATE_CUISSE])),
        item(chooseInitiateGloves(profile)),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS])),
        item(chooseInitiateRing(profile)),
        item(ItemIdentifiers.RUNE_ARROW, 140),
      ]),
    inventory: () =>
      buildInitiateRangeInventory(ItemIdentifiers.GRANITE_MAUL, 180),
  }),
  low_level_dds_pure: Object.freeze({
    id: "low_level_dds_pure",
    weight: 16,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 1, 90, 86, 85, 31, 52],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_STRENGTH, ItemIdentifiers.AMULET_OF_GLORY])),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.RED_DHIDE_BODY, ItemIdentifiers.SPINED_BODY])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RED_DHIDE_CHAPS, ItemIdentifiers.SPINED_CHAPS])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, ...RANGE_GLOVES])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_, {
        comboEatCount: 5,
      }),
  }),
  low_level_gmaul_pure: Object.freeze({
    id: "low_level_gmaul_pure",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [50, 1, 92, 84, 92, 31, 52],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(choose([ItemIdentifiers.AMULET_OF_STRENGTH, ItemIdentifiers.AMULET_OF_GLORY])),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.RED_DHIDE_BODY, ItemIdentifiers.SPINED_BODY])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RED_DHIDE_CHAPS, ItemIdentifiers.SPINED_CHAPS])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, ...RANGE_GLOVES])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 150),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.GRANITE_MAUL,
        ItemIdentifiers.RUNE_ARROW,
        180,
        { comboEatCount: 5 }
      ),
  }),
  low_level_msb_ags_pure: Object.freeze({
    id: "low_level_msb_ags_pure",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 1, 95, 90, 99, 52, 70],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(choose([ItemIdentifiers.MAGIC_SHORTBOW, ItemIdentifiers.DARK_BOW])),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.RED_DHIDE_BODY, ItemIdentifiers.FIGHTER_TORSO])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RED_DHIDE_CHAPS])),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 150),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.RUNE_ARROW,
        180,
        { comboEatCount: 5 }
      ),
  }),
  rune_pure_dscim_dds: Object.freeze({
    id: "rune_pure_dscim_dds",
    weight: 15,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 40, 95, 92, 85, 52, 70],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.RUNE_FULL_HELM, ItemIdentifiers.BERSERKER_HELM, ItemIdentifiers.HELM_OF_NEITIZNOT])),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.STRENGTH_CAPE_T_])),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(choose([ItemIdentifiers.RUNE_PLATEBODY, ItemIdentifiers.FIGHTER_TORSO])),
        item(choose([ItemIdentifiers.RUNE_DEFENDER, ItemIdentifiers.MITHRIL_KITESHIELD])),
        item(choose([ItemIdentifiers.RUNE_PLATELEGS, ItemIdentifiers.RUNE_PLATESKIRT])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, ItemIdentifiers.BARROWS_GLOVES])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.ROCK_CLIMBING_BOOTS, ItemIdentifiers.RUNE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_, {
        comboEatCount: 5,
      }),
  }),
  rune_pure_msb_ags: Object.freeze({
    id: "rune_pure_msb_ags",
    weight: 9,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 40, 95, 94, 99, 52, 74],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.RUNE_FULL_HELM, ItemIdentifiers.HELM_OF_NEITIZNOT, ...RANGE_HEADS])),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, ItemIdentifiers.OBSIDIAN_CAPE])),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(choose([ItemIdentifiers.RUNE_PLATEBODY, ItemIdentifiers.FIGHTER_TORSO, ItemIdentifiers.BLACK_DHIDE_BODY])),
        null,
        item(choose([ItemIdentifiers.RUNE_PLATELEGS, ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RUNE_PLATESKIRT])),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RUNE_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 150),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.RUNE_ARROW,
        180,
        { comboEatCount: 5 }
      ),
  }),
  void_pure_claws: Object.freeze({
    id: "void_pure_claws",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 42, 99, 94, 99, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_RANGER_HELM),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 140),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_CLAWS,
        ItemIdentifiers.RUNE_ARROW,
        180,
        { comboEatCount: 5 }
      ),
  }),
  void_pure_ballista: Object.freeze({
    id: "void_pure_ballista",
    weight: 6,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 42, 99, 94, 99, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_RANGER_HELM),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.HEAVY_BALLISTA),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGON_JAVELIN, 70),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_CLAWS,
        ItemIdentifiers.DRAGON_JAVELIN,
        90,
        { comboEatCount: 5 }
      ),
  }),
  low_level_nh_pure: Object.freeze({
    id: "low_level_nh_pure",
    weight: 10,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [60, 1, 85, 90, 90, 52, 85],
    autocastSpellId: ICE_BLITZ_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage) => {
      const wear = choosePureHybridWearSet();
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        rangeWeaponId: ItemIdentifiers.RUNE_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 70,
        extraFood: -1,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  mid_tank_whip_ags: Object.freeze({
    id: "mid_tank_whip_ags",
    weight: 9,
    minimumProfileIds: ["standard", "veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 99, 85, 77, 74],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ItemIdentifiers.BERSERKER_HELM, ...BLACK_MASKS])),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.AVAS_ACCUMULATOR])),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ItemIdentifiers.GRANITE_BODY, ItemIdentifiers.RUNE_PLATEBODY])),
        item(choose([ItemIdentifiers.RUNE_DEFENDER, ItemIdentifiers.DRAGON_DEFENDER, ItemIdentifiers.ADAMANT_KITESHIELD])),
        item(choose([ItemIdentifiers.DRAGON_PLATELEGS, ItemIdentifiers.DRAGON_PLATESKIRT, ItemIdentifiers.OBSIDIAN_PLATELEGS])),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RUNE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, {
        comboEatCount: 5,
      }),
  }),
  mid_tank_dcb_ags: Object.freeze({
    id: "mid_tank_dcb_ags",
    weight: 8,
    minimumProfileIds: ["standard", "veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 70, 99, 99, 99, 77, 74],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ...RANGE_HEADS])),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.GRANITE_BODY])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.OBSIDIAN_PLATELEGS, ItemIdentifiers.DRAGON_PLATELEGS])),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS, ItemIdentifiers.RUNE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        120,
        { comboEatCount: 5 }
      ),
  }),
  f2p_rwh_pure: Object.freeze({
    id: "f2p_rwh_pure",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [20, 1, 90, 82, 85, 1, 1],
    autocastSpellId: -1,
    equipment: () => {
      const wear = chooseF2pRangeWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(ItemIdentifiers.MAPLE_SHORTBOW),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
        item(ItemIdentifiers.ADAMANT_ARROW, 120),
      ]);
    },
    inventory: () => buildF2pRangeInventory(ItemIdentifiers.RUNE_WARHAMMER, 180),
  }),
  f2p_rbaxe_pure: Object.freeze({
    id: "f2p_rbaxe_pure",
    weight: 14,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 1, 92, 84, 82, 1, 1],
    autocastSpellId: -1,
    equipment: () => {
      const wear = chooseF2pRangeWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(ItemIdentifiers.MAPLE_SHORTBOW),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
        item(ItemIdentifiers.ADAMANT_ARROW, 120),
      ]);
    },
    inventory: () => buildF2pRangeInventory(ItemIdentifiers.RUNE_BATTLEAXE, 180),
  }),
  f2p_rscim_r2h: Object.freeze({
    id: "f2p_rscim_r2h",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 40, 90, 88, 75, 1, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.RUNE_FULL_HELM),
        item(choose(F2P_CAPES)),
        item(ItemIdentifiers.RUNE_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(ItemIdentifiers.RUNE_CHAINBODY),
        item(ItemIdentifiers.RUNE_KITESHIELD),
        item(choose([ItemIdentifiers.GREEN_DHIDE_CHAPS, ItemIdentifiers.ADAMANT_PLATELEGS])),
        null,
        null,
        null,
      ]),
    inventory: () => buildF2pMeleeInventory(ItemIdentifiers.RUNE_2H_SWORD),
  }),
  f2p_rscim_rbaxe: Object.freeze({
    id: "f2p_rscim_rbaxe",
    weight: 14,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 40, 92, 88, 70, 1, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.RUNE_FULL_HELM),
        item(choose(F2P_CAPES)),
        item(ItemIdentifiers.RUNE_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(ItemIdentifiers.RUNE_CHAINBODY),
        item(ItemIdentifiers.RUNE_KITESHIELD),
        item(choose([ItemIdentifiers.GREEN_DHIDE_CHAPS, ItemIdentifiers.ADAMANT_PLATELEGS])),
        null,
        null,
        null,
      ]),
    inventory: () => buildF2pMeleeInventory(ItemIdentifiers.RUNE_BATTLEAXE),
  }),
  f2p_maple_r2h: Object.freeze({
    id: "f2p_maple_r2h",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 1, 85, 84, 92, 1, 1],
    autocastSpellId: -1,
    equipment: () => {
      const wear = chooseF2pRangeWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(ItemIdentifiers.MAPLE_SHORTBOW),
        item(ItemIdentifiers.AMULET_OF_POWER),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
        item(ItemIdentifiers.ADAMANT_ARROW, 140),
      ]);
    },
    inventory: () => buildF2pRangeInventory(ItemIdentifiers.RUNE_2H_SWORD, 220),
  }),
  f2p_maple_rbaxe: Object.freeze({
    id: "f2p_maple_rbaxe",
    weight: 14,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 1, 84, 84, 92, 1, 1],
    autocastSpellId: -1,
    equipment: () => {
      const wear = chooseF2pRangeWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(ItemIdentifiers.MAPLE_SHORTBOW),
        item(ItemIdentifiers.AMULET_OF_POWER),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
        item(ItemIdentifiers.ADAMANT_ARROW, 140),
      ]);
    },
    inventory: () => buildF2pRangeInventory(ItemIdentifiers.RUNE_BATTLEAXE, 220),
  }),
  f2p_bind_blast: Object.freeze({
    id: "f2p_bind_blast",
    weight: 10,
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 60, 76, 82, 1, 75],
    autocastSpellId: FIRE_BLAST_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "blast", elements: ["air", "water", "earth", "fire"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_FIRE),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () => buildF2pBindInventory({ spellTier: "blast" }),
  }),
  f2p_bind_maple: Object.freeze({
    id: "f2p_bind_maple",
    weight: 8,
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 50, 74, 85, 1, 70],
    autocastSpellId: FIRE_BOLT_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "bolt", elements: ["air", "water", "earth", "fire"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_FIRE),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () => buildF2pBindInventory({ spellTier: "bolt" }),
  }),
  f2p_addy_r2h_tank: Object.freeze({
    id: "f2p_addy_r2h_tank",
    weight: 16,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 30, 92, 90, 65, 1, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.ADAMANT_FULL_HELM, ItemIdentifiers.ADAMANT_MED_HELM])),
        item(choose(F2P_CAPES)),
        item(ItemIdentifiers.RUNE_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(choose([ItemIdentifiers.ADAMANT_CHAINBODY, ItemIdentifiers.ADAMANT_PLATEBODY])),
        item(ItemIdentifiers.ADAMANT_KITESHIELD),
        item(choose([ItemIdentifiers.ADAMANT_PLATELEGS, ItemIdentifiers.ADAMANT_PLATESKIRT])),
        null,
        null,
        null,
      ]),
    inventory: () => buildF2pMeleeInventory(ItemIdentifiers.RUNE_2H_SWORD),
  }),
  f2p_addy_rbaxe_tank: Object.freeze({
    id: "f2p_addy_rbaxe_tank",
    weight: 14,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 30, 92, 90, 62, 1, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.ADAMANT_FULL_HELM, ItemIdentifiers.ADAMANT_MED_HELM])),
        item(choose(F2P_CAPES)),
        item(ItemIdentifiers.RUNE_SCIMITAR),
        item(choose([ItemIdentifiers.AMULET_OF_POWER, ItemIdentifiers.AMULET_OF_STRENGTH])),
        item(choose([ItemIdentifiers.ADAMANT_CHAINBODY, ItemIdentifiers.ADAMANT_PLATEBODY])),
        item(ItemIdentifiers.ADAMANT_KITESHIELD),
        item(choose([ItemIdentifiers.ADAMANT_PLATELEGS, ItemIdentifiers.ADAMANT_PLATESKIRT])),
        null,
        null,
        null,
      ]),
    inventory: () => buildF2pMeleeInventory(ItemIdentifiers.RUNE_BATTLEAXE),
  }),
  f2p_fire_blast_pure: Object.freeze({
    id: "f2p_fire_blast_pure",
    weight: 8,
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 65, 78, 1, 1, 85],
    autocastSpellId: FIRE_BLAST_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "blast", elements: ["fire", "water", "earth", "air"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_FIRE),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () => buildF2pMagePureInventory({ spellTier: "blast", element: "fire" }),
  }),
  f2p_wind_blast_pure: Object.freeze({
    id: "f2p_wind_blast_pure",
    weight: 6,
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 60, 76, 1, 1, 79],
    autocastSpellId: WIND_BLAST_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "blast", elements: ["air", "water", "earth", "fire"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_AIR),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () => buildF2pMagePureInventory({ spellTier: "blast", element: "air" }),
  }),
  f2p_bind_r2h: Object.freeze({
    id: "f2p_bind_r2h",
    weight: 8,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 1, 75, 78, 1, 1, 79],
    autocastSpellId: FIRE_BLAST_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "blast", elements: ["air", "water", "earth", "fire"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_FIRE),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () =>
      buildF2pBindKoInventory({
        koWeaponId: ItemIdentifiers.RUNE_2H_SWORD,
        spellTier: "blast",
      }),
  }),
  f2p_bind_rbaxe: Object.freeze({
    id: "f2p_bind_rbaxe",
    weight: 7,
    spellbook: MagicSpellbook.NORMAL,
    stats: [40, 1, 74, 78, 1, 1, 76],
    autocastSpellId: FIRE_BOLT_SPELL_ID,
    resolveMagicPackage: () => buildF2pMagicPackage({ tier: "bolt", elements: ["air", "water", "earth", "fire"] }),
    equipment: (magicPackage) => {
      const wear = chooseF2pMageWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.STAFF_OF_FIRE),
        item(choose([ItemIdentifiers.AMULET_OF_MAGIC, ItemIdentifiers.AMULET_OF_POWER])),
        item(wear.body),
        null,
        item(wear.legs),
        null,
        null,
        null,
      ]);
    },
    inventory: () =>
      buildF2pBindKoInventory({
        koWeaponId: ItemIdentifiers.RUNE_BATTLEAXE,
        spellTier: "bolt",
      }),
  }),
  main_whip: Object.freeze({
    id: "main_whip",
    weight: 30,
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 99, 94, 70, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.STRENGTH_CAPE_T_])),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: (magicPackage, profile) =>
      buildEdgeMeleeInventory(
        isEliteProfile(profile)
          ? chooseEliteSpecWeapon()
          : choose([
              ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
              ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
              ItemIdentifiers.ANCIENT_GODSWORD,
              ItemIdentifiers.BARRELCHEST_ANCHOR,
            ]),
        { comboEatCount: 5 }
      ),
  }),
  full_dharok: Object.freeze({
    id: "full_dharok",
    weight: 12,
    spellbook: MagicSpellbook.LUNAR,
    stats: [70, 70, 99, 99, 1, 70, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.DHAROKS_HELM),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.STRENGTH_CAPE_T_])),
        item(ItemIdentifiers.DHAROKS_GREATAXE),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(ItemIdentifiers.DHAROKS_PLATEBODY),
        null,
        item(ItemIdentifiers.DHAROKS_PLATELEGS),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () => buildDharokInventory(),
  }),
  zerker_whip: Object.freeze({
    id: "zerker_whip",
    weight: 24,
    spellbook: MagicSpellbook.LUNAR,
    stats: [70, 45, 99, 95, 90, 52, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: (magicPackage, profile) =>
      buildEdgeMeleeInventory(
        isEliteProfile(profile)
          ? chooseEliteSpecWeapon()
          : choose([
              ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
              ItemIdentifiers.BARRELCHEST_ANCHOR,
            ])
      ),
  }),
  zerker_dscim: Object.freeze({
    id: "zerker_dscim",
    weight: 18,
    spellbook: MagicSpellbook.LUNAR,
    stats: [60, 45, 99, 92, 85, 52, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: (magicPackage, profile) =>
      buildEdgeMeleeInventory(
        isEliteProfile(profile)
          ? chooseEliteSpecWeapon()
          : choose([
              ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
              ItemIdentifiers.BARRELCHEST_ANCHOR,
            ])
      ),
  }),
  zerker_venge_ags: Object.freeze({
    id: "zerker_venge_ags",
    weight: 14,
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 45, 99, 96, 90, 70, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, {
        comboEatCount: 5,
      }),
  }),
  ancient_gs_venge: Object.freeze({
    id: "ancient_gs_venge",
    weight: 9,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 45, 99, 96, 90, 70, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ANCIENT_GODSWORD, {
        comboEatCount: 5,
      }),
  }),
  zerker_dcb_ags: Object.freeze({
    id: "zerker_dcb_ags",
    weight: 10,
    minimumProfileIds: ["standard", "veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 45, 99, 94, 99, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ...RANGE_BODIES])),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        120,
        { comboEatCount: 5 }
      ),
  }),
  zerker_whip_claws: Object.freeze({
    id: "zerker_whip_claws",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 45, 99, 95, 90, 70, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody(profile)),
        item(chooseEdgeMeleeOffhand(profile)),
        item(chooseEdgeMeleeLegs(profile)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_CLAWS, { comboEatCount: 5 }),
  }),
  med_whip_ags: Object.freeze({
    id: "med_whip_ags",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 75, 99, 99, 95, 94, 77],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ...BLACK_MASKS])),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.AVAS_ACCUMULATOR])),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, chooseEdgeMeleeBody(profile)])),
        item(chooseEdgeMeleeOffhand({ id: "elite" })),
        item(chooseEdgeMeleeLegs({ id: "elite" })),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, {
        comboEatCount: 6,
      }),
  }),
  med_dcb_claws: Object.freeze({
    id: "med_dcb_claws",
    weight: 7,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 75, 99, 99, 99, 94, 77],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.HELM_OF_NEITIZNOT])),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ...RANGE_BODIES])),
        null,
        item(choose(RANGE_LEGS)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_CLAWS,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        125,
        { comboEatCount: 5 }
      ),
  }),
  med_tribrid_ags: Object.freeze({
    id: "med_tribrid_ags",
    weight: 6,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [75, 75, 99, 99, 99, 94, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        specWeaponId: ItemIdentifiers.ARMADYL_GODSWORD,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 100,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  karils_venge_ags: Object.freeze({
    id: "karils_venge_ags",
    weight: 9,
    minimumProfileIds: ["standard", "veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 94, 99, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.KARILS_COIF),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.KARILS_CROSSBOW),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(ItemIdentifiers.KARILS_LEATHERTOP),
        null,
        item(ItemIdentifiers.KARILS_LEATHERSKIRT),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.BOLT_RACK, 180),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.BOLT_RACK,
        210,
        { comboEatCount: 5 }
      ),
  }),
  veracs_venge_claws: Object.freeze({
    id: "veracs_venge_claws",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 99, 80, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.VERACS_HELM),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.VERACS_FLAIL),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(ItemIdentifiers.VERACS_BRASSARD),
        null,
        item(ItemIdentifiers.VERACS_PLATESKIRT),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_CLAWS, {
        comboEatCount: 6,
      }),
  }),
  blowpipe_venge_ags: Object.freeze({
    id: "blowpipe_venge_ags",
    weight: 6,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 95, 99, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.VOID_RANGER_HELM, ...RANGE_HEADS])),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.TOXIC_BLOWPIPE),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.RED_DHIDE_BODY])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RED_DHIDE_CHAPS])),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGON_DART, 160),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGON_DART,
        320,
        { comboEatCount: 5 }
      ),
  }),
  dhalberd_venge_ags: Object.freeze({
    id: "dhalberd_venge_ags",
    weight: 6,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 70, 99, 99, 80, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ItemIdentifiers.BERSERKER_HELM])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.DRAGON_HALBERD),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ItemIdentifiers.GRANITE_BODY])),
        null,
        item(chooseEdgeMeleeLegs({ id: "elite" })),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, {
        comboEatCount: 6,
      }),
  }),
  spear_tribrid_ags: Object.freeze({
    id: "spear_tribrid_ags",
    weight: 7,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [80, 75, 99, 99, 99, 90, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, wear.head])),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, wear.body])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, wear.legs])),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 100),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ZAMORAKIAN_SPEAR,
        specWeaponId: ItemIdentifiers.ARMADYL_GODSWORD,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 110,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  sotd_hybrid_claws: Object.freeze({
    id: "sotd_hybrid_claws",
    weight: 5,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [85, 80, 99, 99, 99, 94, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.STAFF_OF_THE_DEAD),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(wear.body),
        item(wear.offhand),
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.STAFF_OF_THE_DEAD,
        specWeaponId: ItemIdentifiers.DRAGON_CLAWS,
        rangeWeaponId: ItemIdentifiers.RUNE_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 90,
        shieldId: ItemIdentifiers.BOOK_OF_DARKNESS,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  toxic_sotd_hybrid: Object.freeze({
    id: "toxic_sotd_hybrid",
    weight: 6,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [85, 80, 99, 99, 99, 94, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]);
    },
    inventory: () =>
      buildStaffHybridInventory({
        staffId: ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD,
        specWeaponId: ItemIdentifiers.DRAGON_CLAWS,
        meleeWeaponId: null,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 110,
        shieldId: ItemIdentifiers.BOOK_OF_DARKNESS,
      }),
  }),
  msb_gmaul: Object.freeze({
    id: "msb_gmaul",
    weight: 24,
    spellbook: MagicSpellbook.NORMAL,
    stats: [50, 1, 99, 88, 99, 1, 1],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(
          isVeteranOrEliteProfile(profile)
            ? ItemIdentifiers.CRYSTAL_BOW_FULL
            : ItemIdentifiers.MAGIC_SHORTBOW
        ),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(
          isVeteranOrEliteProfile(profile)
            ? ItemIdentifiers.FIGHTER_TORSO
            : choose(RANGE_BODIES)
        ),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        !isVeteranOrEliteProfile(profile)
          ? item(ItemIdentifiers.RUNE_ARROW, 150)
          : null,
      ]),
    inventory: (magicPackage, profile) =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.GRANITE_MAUL,
        isVeteranOrEliteProfile(profile) ? null : ItemIdentifiers.RUNE_ARROW,
        isVeteranOrEliteProfile(profile) ? 0 : 150
      ),
  }),
  rcb_dds: Object.freeze({
    id: "rcb_dds",
    weight: 24,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 45, 90, 92, 99, 52, 70],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.RUNE_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose(RANGE_BODIES)),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 75),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        125
      ),
  }),
  msb_dds: Object.freeze({
    id: "msb_dds",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 1, 92, 90, 99, 31, 1],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(
          isVeteranOrEliteProfile(profile)
            ? ItemIdentifiers.CRYSTAL_BOW_FULL
            : ItemIdentifiers.MAGIC_SHORTBOW
        ),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(
          isVeteranOrEliteProfile(profile)
            ? ItemIdentifiers.FIGHTER_TORSO
            : choose(RANGE_BODIES)
        ),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        !isVeteranOrEliteProfile(profile)
          ? item(ItemIdentifiers.RUNE_ARROW, 175)
          : null,
      ]),
    inventory: (magicPackage, profile) =>
      buildRangeToMeleeInventory(
        isEliteProfile(profile)
          ? chooseEliteSpecWeapon()
          : ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        isVeteranOrEliteProfile(profile) ? null : ItemIdentifiers.RUNE_ARROW,
        isVeteranOrEliteProfile(profile) ? 0 : 175
      ),
  }),
  dark_bow_ags: Object.freeze({
    id: "dark_bow_ags",
    weight: 8,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 45, 99, 96, 99, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.DARK_BOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(ItemIdentifiers.FIGHTER_TORSO),
        null,
        item(choose(RANGE_LEGS)),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGON_ARROW, 60),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGON_ARROW,
        90
      ),
  }),
  void_dcb_claws: Object.freeze({
    id: "void_dcb_claws",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 42, 99, 94, 99, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_RANGER_HELM),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.SNAKESKIN_BOOTS, ItemIdentifiers.RANGER_BOOTS, ItemIdentifiers.DRAGON_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_CLAWS,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        120
      ),
  }),
  void_dcb_ags: Object.freeze({
    id: "void_dcb_ags",
    weight: 7,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 42, 99, 94, 99, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_RANGER_HELM),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.SNAKESKIN_BOOTS, ItemIdentifiers.RANGER_BOOTS, ItemIdentifiers.DRAGON_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        120
      ),
  }),
  void_ballista_ags: Object.freeze({
    id: "void_ballista_ags",
    weight: 4,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 45, 99, 95, 99, 45, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_RANGER_HELM),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.HEAVY_BALLISTA),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGON_JAVELIN, 60),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.ARMADYL_GODSWORD,
        ItemIdentifiers.DRAGON_JAVELIN,
        80
      ),
  }),
  void_melee_claws: Object.freeze({
    id: "void_melee_claws",
    weight: 6,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 42, 99, 94, 90, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_MELEE_HELM),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_CLAWS, {
        comboEatCount: 5,
      }),
  }),
  void_melee_ags: Object.freeze({
    id: "void_melee_ags",
    weight: 5,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 42, 99, 94, 90, 42, 94],
    autocastSpellId: -1,
    equipment: (magicPackage, profile) =>
      compact([
        item(ItemIdentifiers.VOID_MELEE_HELM),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseVoidBody(profile)),
        null,
        item(chooseVoidLegs(profile)),
        item(ItemIdentifiers.VOID_KNIGHT_GLOVES),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.CLIMBING_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, {
        comboEatCount: 5,
      }),
  }),
  ancients_hybrid: Object.freeze({
    id: "ancients_hybrid",
    weight: 28,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(wear.cape),
        item(choose([ItemIdentifiers.RUNE_CROSSBOW, magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF])),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        item(wear.offhand),
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({ spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT }),
  }),
  elite_ancients_dbow: Object.freeze({
    id: "elite_ancients_dbow",
    weight: 12,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      const primary = chooseEliteDarkBowSpecPrimary(magicPackage);
      const capeId = primary.usesAvas
        ? choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])
        : wear.cape;
      const offhandId = primary.useOffhand ? wear.offhand : null;
      return compact([
        item(choose([ItemIdentifiers.AHRIMS_HOOD, ItemIdentifiers.HELM_OF_NEITIZNOT, ...MAGE_HATS])),
        item(capeId),
        item(primary.weaponId),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.AHRIMS_ROBETOP, ItemIdentifiers.KARILS_LEATHERTOP, wear.body])),
        item(offhandId),
        item(choose([ItemIdentifiers.AHRIMS_ROBESKIRT, ItemIdentifiers.BLACK_DHIDE_CHAPS, wear.legs])),
        item(choose([ItemIdentifiers.BARROWS_GLOVES, ...MAGE_GLOVES, ...RANGE_GLOVES])),
        item(choose([ItemIdentifiers.DRAGON_BOOTS, ItemIdentifiers.RANGER_BOOTS, ...MAGE_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        primary.ammoId != null ? item(primary.ammoId, 80) : null,
      ]);
    },
    inventory: () =>
      buildDarkBowSpecInventory({
        specAmmoAmount: 90,
        restoreCount: randomBetween(3, 4),
        brewCount: randomBetween(2, 3),
        comboEatCount: randomBetween(4, 5),
      }),
  }),
  tribrid_main: Object.freeze({
    id: "tribrid_main",
    weight: 22,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.RUNE_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 80),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        specWeaponId: ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        shieldId: ItemIdentifiers.UNHOLY_BOOK,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  nh_pure: Object.freeze({
    id: "nh_pure",
    weight: 14,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [60, 1, 90, 99, 99, 52, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage) => {
      const wear = choosePureHybridWearSet();
      return compact([
        item(wear.head),
        item(wear.cape),
        item(magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        rangeWeaponId: ItemIdentifiers.RUNE_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 60,
        extraFood: -1,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  elite_nh_ags: Object.freeze({
    id: "elite_nh_ags",
    weight: 10,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        specWeaponId: ItemIdentifiers.ARMADYL_GODSWORD,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 110,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  elite_nh_claws: Object.freeze({
    id: "elite_nh_claws",
    weight: 9,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        specWeaponId: ItemIdentifiers.DRAGON_CLAWS,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 110,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  volatile_nh: Object.freeze({
    id: "volatile_nh",
    weight: 5,
    minimumProfileIds: ["elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 99, 99, 99, 99, 99, 99],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: true,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseAncientsHybridWearSet(profile);
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(choose([ItemIdentifiers.AMULET_OF_GLORY, ItemIdentifiers.AMULET_OF_FURY])),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 95),
      ]);
    },
    inventory: () =>
      buildStaffHybridInventory({
        staffId: ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF,
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 110,
        shieldId: ItemIdentifiers.BOOK_OF_DARKNESS,
      }),
  }),
  budget_nh_dds: Object.freeze({
    id: "budget_nh_dds",
    weight: 10,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [75, 45, 90, 92, 90, 70, 85],
    autocastSpellId: ICE_BLITZ_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage) =>
      compact([
        item(choose([ItemIdentifiers.COIF, ...MAGE_HATS])),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, ...MAGE_CAPES])),
        item(ItemIdentifiers.RUNE_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.MYSTIC_ROBE_TOP])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.MYSTIC_ROBE_BOTTOM])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, ...MAGE_GLOVES, ...RANGE_GLOVES])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ...MAGE_BOOTS, ...RANGE_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 70),
      ]),
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.DRAGON_SCIMITAR,
        specWeaponId: ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        rangeWeaponId: ItemIdentifiers.RUNE_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 80,
        mageBodyId: choose([ItemIdentifiers.MYSTIC_ROBE_TOP, ItemIdentifiers.SPLITBARK_BODY]),
        mageLegId: choose([ItemIdentifiers.MYSTIC_ROBE_BOTTOM, ItemIdentifiers.BLACK_DHIDE_CHAPS]),
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  budget_nh_ags: Object.freeze({
    id: "budget_nh_ags",
    weight: 8,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.ANCIENT,
    stats: [75, 70, 94, 96, 94, 77, 90],
    autocastSpellId: ICE_BLITZ_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: (magicPackage, profile) => {
      const wear = chooseHybridWearSet();
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.DRAGON_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 85),
      ]);
    },
    inventory: (magicPackage) =>
      buildHybridInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        specWeaponId: ItemIdentifiers.ARMADYL_GODSWORD,
        rangeWeaponId: ItemIdentifiers.DRAGON_CROSSBOW,
        rangeAmmoId: ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        rangeAmmoAmount: 90,
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  anti_pk_rcb: Object.freeze({
    id: "anti_pk_rcb",
    weight: 24,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [90, 80, 95, 99, 99, 77, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: () => {
      const wear = chooseHybridWearSet();
      return compact([
        item(wear.head),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(ItemIdentifiers.RUNE_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(wear.body),
        null,
        item(wear.legs),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90),
      ]);
    },
    inventory: (magicPackage) =>
      buildAntiPkInventory({
        meleeWeaponId: ItemIdentifiers.ABYSSAL_WHIP,
        mageWeaponId: magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF,
        mageBodyId: choose(HYBRID_MAGE_TOPS),
        mageLegId: choose(HYBRID_RANGE_LEGS),
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  anti_pk_whip: Object.freeze({
    id: "anti_pk_whip",
    weight: 22,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [99, 90, 99, 99, 94, 77, 94],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: () => {
      const wear = chooseHybridWearSet();
      const mainHand = choose([ItemIdentifiers.ABYSSAL_WHIP, ItemIdentifiers.RUNE_CROSSBOW]);
      const usingRangeMainHand = mainHand === ItemIdentifiers.RUNE_CROSSBOW;
      return compact([
        item(choose([ItemIdentifiers.HELM_OF_NEITIZNOT, ...BLACK_MASKS, wear.head])),
        item(choose([ItemIdentifiers.OBSIDIAN_CAPE, ItemIdentifiers.AVAS_ACCUMULATOR, wear.cape])),
        item(mainHand),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(usingRangeMainHand ? wear.body : choose([chooseEdgeMeleeBody(), wear.body])),
        item(usingRangeMainHand ? null : choose([chooseEdgeMeleeOffhand(), wear.offhand])),
        item(usingRangeMainHand ? wear.legs : choose([chooseEdgeMeleeLegs(), wear.legs])),
        item(wear.gloves),
        item(wear.boots),
        item(ItemIdentifiers.RING_OF_RECOIL),
        usingRangeMainHand ? item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 90) : null,
      ]);
    },
    inventory: (magicPackage) =>
      buildAntiPkInventory({
        meleeWeaponId: ItemIdentifiers.RUNE_CROSSBOW,
        mageWeaponId: magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF,
        mageBodyId: choose(HYBRID_MAGE_TOPS),
        mageLegId: choose(HYBRID_RANGE_LEGS),
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  budget_anti_pk: Object.freeze({
    id: "budget_anti_pk",
    weight: 14,
    spellbook: MagicSpellbook.ANCIENT,
    stats: [70, 45, 90, 92, 90, 52, 85],
    autocastSpellId: ICE_BARRAGE_SPELL_ID,
    resolveMagicPackage: (profile, state) =>
      buildMagicPackage(profile, {
        allowAncients: true,
        preferAncients: false,
        hotspotId: state?.pvp?.hotspotId,
      }),
    equipment: () => {
      const wear = chooseHybridWearSet();
      const mainHand = choose([ItemIdentifiers.RUNE_CROSSBOW, ItemIdentifiers.DRAGON_SCIMITAR]);
      const usingRangeMainHand = mainHand === ItemIdentifiers.RUNE_CROSSBOW;
      return compact([
        item(choose([ItemIdentifiers.COIF, ItemIdentifiers.WARRIOR_HELM, wear.head])),
        item(choose([ItemIdentifiers.AVAS_ACCUMULATOR, ItemIdentifiers.OBSIDIAN_CAPE, wear.cape])),
        item(mainHand),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(usingRangeMainHand ? choose([ItemIdentifiers.BLACK_DHIDE_BODY, wear.body]) : choose([chooseEdgeMeleeBody(), wear.body, ItemIdentifiers.BLACK_DHIDE_BODY])),
        null,
        item(usingRangeMainHand ? choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, wear.legs]) : choose([chooseEdgeMeleeLegs(), wear.legs, ItemIdentifiers.BLACK_DHIDE_CHAPS])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, wear.gloves])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, wear.boots])),
        item(ItemIdentifiers.RING_OF_RECOIL),
        usingRangeMainHand ? item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 70) : null,
      ]);
    },
    inventory: (magicPackage) =>
      buildAntiPkInventory({
        meleeWeaponId: ItemIdentifiers.DRAGON_SCIMITAR,
        specWeaponId: choose([
          ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
          ItemIdentifiers.BARRELCHEST_ANCHOR,
        ]),
        mageWeaponId: magicPackage?.staffId ?? ItemIdentifiers.ANCIENT_STAFF,
        mageBodyId: choose(HYBRID_MAGE_TOPS),
        mageLegId: choose(HYBRID_RANGE_LEGS),
        spellbook: magicPackage?.spellbook ?? MagicSpellbook.ANCIENT,
      }),
  }),
  budget_scim: Object.freeze({
    id: "budget_scim",
    weight: 26,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 45, 90, 88, 70, 43, 70],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.WARRIOR_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(chooseEdgeMeleeBody()),
        item(chooseEdgeMeleeOffhand()),
        item(chooseEdgeMeleeLegs()),
        item(ItemIdentifiers.MITHRIL_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(
        choose([
          ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
          ItemIdentifiers.BARRELCHEST_ANCHOR,
        ])
      ),
  }),
  budget_rcb: Object.freeze({
    id: "budget_rcb",
    weight: 20,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 45, 85, 90, 90, 43, 70],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.RUNE_CROSSBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose(RANGE_BODIES)),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGONSTONE_BOLTS_E_, 60),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        ItemIdentifiers.DRAGONSTONE_BOLTS_E_,
        100
      ),
  }),
  budget_msb: Object.freeze({
    id: "budget_msb",
    weight: 18,
    spellbook: MagicSpellbook.NORMAL,
    stats: [50, 1, 85, 85, 95, 31, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose(RANGE_BODIES)),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 120),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_,
        ItemIdentifiers.RUNE_ARROW,
        150
      ),
  }),
  ags_zerker: Object.freeze({
    id: "ags_zerker",
    weight: 12,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.LUNAR,
    stats: [75, 45, 99, 97, 90, 70, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.BERSERKER_HELM),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.ABYSSAL_WHIP),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.FIGHTER_TORSO, ItemIdentifiers.GRANITE_BODY])),
        item(chooseEdgeMeleeOffhand({ id: "elite" })),
        item(chooseEdgeMeleeLegs({ id: "elite" })),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () => buildEdgeMeleeInventory(ItemIdentifiers.ARMADYL_GODSWORD, { comboEatCount: 5 }),
  }),
  obby_mauler: Object.freeze({
    id: "obby_mauler",
    weight: 10,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 99, 82, 70, 31, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.BERSERKER_HELM),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.TZHAAR_KET_OM),
        item(ItemIdentifiers.AMULET_OF_STRENGTH),
        item(ItemIdentifiers.FIGHTER_TORSO),
        null,
        item(ItemIdentifiers.OBSIDIAN_PLATELEGS),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () => buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_CLAWS, { comboEatCount: 6 }),
  }),
  obsidian_set_mauler: Object.freeze({
    id: "obsidian_set_mauler",
    weight: 7,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 60, 99, 95, 70, 31, 52],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(ItemIdentifiers.OBSIDIAN_HELMET),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.TZHAAR_KET_OM),
        item(ItemIdentifiers.BERSERKER_NECKLACE),
        item(ItemIdentifiers.OBSIDIAN_PLATEBODY),
        null,
        item(ItemIdentifiers.OBSIDIAN_PLATELEGS),
        item(ItemIdentifiers.BARROWS_GLOVES),
        item(ItemIdentifiers.DRAGON_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () =>
      buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_CLAWS, {
        comboEatCount: 5,
      }),
  }),
  ballista_pure: Object.freeze({
    id: "ballista_pure",
    weight: 10,
    minimumProfileIds: ["veteran", "elite"],
    spellbook: MagicSpellbook.NORMAL,
    stats: [75, 1, 95, 85, 99, 52, 94],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.VOID_RANGER_HELM])),
        item(ItemIdentifiers.AVAS_ACCUMULATOR),
        item(ItemIdentifiers.HEAVY_BALLISTA),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.BLACK_DHIDE_BODY, ItemIdentifiers.RED_DHIDE_BODY, ItemIdentifiers.SPINED_BODY])),
        null,
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.RED_DHIDE_CHAPS, ItemIdentifiers.SPINED_CHAPS])),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.DRAGON_JAVELIN, 70),
      ]),
    inventory: () =>
      buildRangeToMeleeInventory(
        ItemIdentifiers.DRAGON_CLAWS,
        ItemIdentifiers.DRAGON_JAVELIN,
        90
      ),
  }),
  gmaul_rusher: Object.freeze({
    id: "gmaul_rusher",
    weight: 26,
    spellbook: MagicSpellbook.NORMAL,
    stats: [50, 1, 99, 85, 99, 31, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([...RANGE_HEADS, ItemIdentifiers.SPINED_HELM])),
        item(choose(RANGE_CAPES)),
        item(ItemIdentifiers.MAGIC_SHORTBOW),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose(RANGE_BODIES)),
        null,
        item(choose(RANGE_LEGS)),
        item(choose(RANGE_GLOVES)),
        item(choose(RANGE_BOOTS)),
        item(ItemIdentifiers.RING_OF_RECOIL),
        item(ItemIdentifiers.RUNE_ARROW, 150),
      ]),
    inventory: () => buildRangeToMeleeInventory(ItemIdentifiers.GRANITE_MAUL, ItemIdentifiers.RUNE_ARROW, 180),
  }),
  dds_rusher: Object.freeze({
    id: "dds_rusher",
    weight: 22,
    spellbook: MagicSpellbook.NORMAL,
    stats: [60, 1, 95, 86, 80, 31, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.IRON_FULL_HELM, ItemIdentifiers.SPINED_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.DRAGON_SCIMITAR),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(choose([ItemIdentifiers.IRON_PLATEBODY, ItemIdentifiers.SPINED_BODY])),
        item(ItemIdentifiers.BOOK_OF_DARKNESS),
        item(choose([ItemIdentifiers.BLACK_DHIDE_CHAPS, ItemIdentifiers.SPINED_CHAPS])),
        item(choose([ItemIdentifiers.MITHRIL_GLOVES, ItemIdentifiers.SPINED_GLOVES])),
        item(choose([ItemIdentifiers.CLIMBING_BOOTS, ItemIdentifiers.SPINED_BOOTS])),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () => buildEdgeMeleeInventory(ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_, { comboEatCount: 6 }),
  }),
  obby_rusher: Object.freeze({
    id: "obby_rusher",
    weight: 14,
    spellbook: MagicSpellbook.NORMAL,
    stats: [1, 1, 99, 80, 60, 31, 1],
    autocastSpellId: -1,
    equipment: () =>
      compact([
        item(choose([ItemIdentifiers.IRON_FULL_HELM, ...BLACK_MASKS])),
        item(ItemIdentifiers.OBSIDIAN_CAPE),
        item(ItemIdentifiers.RUNE_KNIFE, 250),
        item(ItemIdentifiers.AMULET_OF_GLORY),
        item(ItemIdentifiers.IRON_PLATEBODY),
        item(ItemIdentifiers.UNHOLY_BOOK),
        item(ItemIdentifiers.BLACK_DHIDE_CHAPS),
        item(ItemIdentifiers.MITHRIL_GLOVES),
        item(ItemIdentifiers.CLIMBING_BOOTS),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ]),
    inventory: () => {
      const inventory = [
        item(ItemIdentifiers.TZHAAR_KET_OM),
        item(ItemIdentifiers.SUPER_STRENGTH_4_),
        item(ItemIdentifiers.RANGING_POTION_4_),
        item(ItemIdentifiers.SUPER_RESTORE_4_),
        item(ItemIdentifiers.RING_OF_RECOIL),
      ];
      inventory.push(...repeat(ItemIdentifiers.COOKED_KARAMBWAN, 1, 8));
      fillFood(inventory, ItemIdentifiers.SHARK, 28 - inventory.length);
      return inventory.slice(0, 28);
    },
  }),
});

function getArchetypeChoices(loadoutId) {
  const loadout = getPvpLoadout(loadoutId);
  return (loadout?.archetypes ?? [])
    .map((archetypeId) => ARCHETYPES[archetypeId])
    .filter((entry) => entry != null);
}

function buildRandomPvpPreset(player, state) {
  const loadoutId = state?.pvp?.loadoutId ?? "edge_main_melee";
  const profile = getPvpProfile(state?.pvp?.profileId);
  // Loadout and profile are drawn independently at spawn, so some pairs (e.g.
  // edge_med_level x novice) leave every archetype gated out. Falling back to
  // the ungated pool keeps the bot geared instead of dumping a naked level 3
  // into the wilderness.
  const allChoices = getArchetypeChoices(loadoutId);
  const gatedChoices = allChoices.filter((entry) =>
    profileAllowedForArchetype(entry, profile)
  );
  const choices = gatedChoices.length > 0 ? gatedChoices : allChoices;
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
    return false;
  }
  const generated = buildGeneratedPreset(player, state);
  if (!generated?.preset) {
    options.api?.log?.("bot_pvp_loadout_failed", {
      username: player.getUsername?.(),
      loadoutId: state?.pvp?.loadoutId ?? "edge_main_melee",
    });
    return false;
  }
  player.setCurrentPreset?.(generated.preset);
  if (!applyPreset(player, generated.preset)) {
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
        return (
          itemId === ItemIdentifiers.ARMADYL_GODSWORD ||
          itemId === ItemIdentifiers.BANDOS_GODSWORD ||
          itemId === ItemIdentifiers.SARADOMIN_GODSWORD ||
          itemId === ItemIdentifiers.ZAMORAK_GODSWORD ||
          itemId === ItemIdentifiers.DARK_BOW ||
          itemId === ItemIdentifiers.DRAGON_CLAWS ||
          itemId === ItemIdentifiers.DRAGON_DAGGER_P_PLUS_PLUS_ ||
          itemId === ItemIdentifiers.HEAVY_BALLISTA ||
          itemId === ItemIdentifiers.ANCIENT_GODSWORD ||
          itemId === ItemIdentifiers.GRANITE_MAUL ||
          itemId === ItemIdentifiers.BARRELCHEST_ANCHOR ||
          itemId === ItemIdentifiers.MAGIC_SHORTBOW ||
          itemId === ItemIdentifiers.MAGIC_SHORTBOW_I_ ||
          itemId === ItemIdentifiers.MAGIC_SHORTBOW_3
        );
      })?.getId?.() ?? null;
    state.pvp.generatedSpecAmmoId =
      state.pvp.generatedSpecWeaponId === ItemIdentifiers.DARK_BOW
        ? inventory.find?.((entry) => {
            const itemId = entry?.getId?.() ?? -1;
            return itemId === ItemIdentifiers.DRAGON_ARROW;
          })?.getId?.() ?? null
        : state.pvp.generatedSpecWeaponId === ItemIdentifiers.MAGIC_SHORTBOW ||
      state.pvp.generatedSpecWeaponId === ItemIdentifiers.MAGIC_SHORTBOW_I_ ||
      state.pvp.generatedSpecWeaponId === ItemIdentifiers.MAGIC_SHORTBOW_3
        ? inventory.find?.((entry) => {
            const itemId = entry?.getId?.() ?? -1;
            return (
              itemId === ItemIdentifiers.RUNE_ARROW ||
              itemId === ItemIdentifiers.ADAMANT_ARROW ||
              itemId === ItemIdentifiers.BROAD_ARROW
            );
          })?.getId?.() ?? null
        : state.pvp.generatedSpecWeaponId === ItemIdentifiers.HEAVY_BALLISTA
        ? inventory.find?.((entry) => {
            const itemId = entry?.getId?.() ?? -1;
            return (
              itemId === ItemIdentifiers.DRAGON_JAVELIN ||
              itemId === ItemIdentifiers.RUNE_JAVELIN ||
              itemId === ItemIdentifiers.ADAMANT_JAVELIN
            );
          })?.getId?.() ?? null
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
