const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { GameConstants } = require("../../../src/main/typescript/elvarg/game/GameConstants");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");

/** Teleport jewellery usable up to this Wilderness level unless a piece says otherwise. */
const DEFAULT_WILDERNESS_LEVEL = 20;
/** Dragonstone jewellery works deeper, through level 30 Wilderness. */
const DRAGONSTONE_WILDERNESS_LEVEL = 30;

const FARMING_GUILD_INTERMEDIATE_LEVEL = 45;

/**
 * Charged pieces, most charges first. `spent` is what the last charge leaves
 * behind (null when it crumbles); `eternal` ids never lose charges.
 *
 * Each destination is `{ label, tile }`; `tile` may be a function of the player.
 * `aliases` match worn-option names that differ from the dialogue label.
 */
const JEWELLERY = [
  {
    key: "glory",
    noun: "amulet",
    charged: [
      [ItemIds.AMULET_OF_GLORY_6_, 6],
      [ItemIds.AMULET_OF_GLORY_5_, 5],
      [ItemIds.AMULET_OF_GLORY_4_, 4],
      [ItemIds.AMULET_OF_GLORY_3_, 3],
      [ItemIds.AMULET_OF_GLORY_2_, 2],
      [ItemIds.AMULET_OF_GLORY_1_, 1],
    ],
    spent: ItemIds.AMULET_OF_GLORY,
    rechargeable: true,
    // Fountain of Heroes: 4 charges; Fountain of Rune: 6 (Wiki). Both need Heroes' Quest.
    recharge: { heroes: true, quest: "Heroes' Quest", eternalChance: 25000 },
    eternal: [ItemIds.AMULET_OF_ETERNAL_GLORY],
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    rubMessage: "You rub the amulet...",
    emptyMessage: "Your amulet hasn't got any charges left.",
    lastChargeMessage: "You use your amulet's last charge.",
    destinations: [
      { label: "Edgeville", tile: [3087, 3489, 0] },
      { label: "Karamja", tile: [2918, 3176, 0] },
      { label: "Draynor Village", tile: [3105, 3251, 0] },
      { label: "Al Kharid", tile: [3293, 3163, 0] },
    ],
  },
  {
    key: "glory_trimmed",
    noun: "amulet",
    charged: [
      [ItemIds.AMULET_OF_GLORY_T6_, 6],
      [ItemIds.AMULET_OF_GLORY_T5_, 5],
      [ItemIds.AMULET_OF_GLORY_T4_, 4],
      [ItemIds.AMULET_OF_GLORY_T3_, 3],
      [ItemIds.AMULET_OF_GLORY_T2_, 2],
      [ItemIds.AMULET_OF_GLORY_T1_, 1],
    ],
    spent: ItemIds.AMULET_OF_GLORY_T_,
    rechargeable: true,
    recharge: { heroes: true, quest: "Heroes' Quest" },
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    rubMessage: "You rub the amulet...",
    emptyMessage: "Your amulet hasn't got any charges left.",
    lastChargeMessage: "You use your amulet's last charge.",
    destinationsFrom: "glory",
  },
  {
    key: "games",
    noun: "games necklace",
    charged: [
      [ItemIds.GAMES_NECKLACE_8_, 8],
      [ItemIds.GAMES_NECKLACE_7_, 7],
      [ItemIds.GAMES_NECKLACE_6_, 6],
      [ItemIds.GAMES_NECKLACE_5_, 5],
      [ItemIds.GAMES_NECKLACE_4_, 4],
      [ItemIds.GAMES_NECKLACE_3_, 3],
      [ItemIds.GAMES_NECKLACE_2_, 2],
      [ItemIds.GAMES_NECKLACE_1_, 1],
    ],
    spent: null,
    rubMessage: "You rub the necklace...",
    emptyMessage: "Your necklace hasn't got any charges left.",
    lastChargeMessage: "Your games necklace crumbles to dust.",
    destinations: [
      { label: "Burthorpe", tile: [2898, 3552, 0] },
      { label: "Barbarian Outpost", tile: [2519, 3572, 0] },
      { label: "Corporeal Beast", tile: [2967, 4381, 2] },
      { label: "Tears of Guthix", tile: [3245, 9500, 2] },
      { label: "Wintertodt Camp", tile: [1627, 3941, 0] },
    ],
  },
  {
    key: "dueling",
    noun: "ring of dueling",
    charged: [
      [ItemIds.RING_OF_DUELING_8_, 8],
      [ItemIds.RING_OF_DUELING_7_, 7],
      [ItemIds.RING_OF_DUELING_6_, 6],
      [ItemIds.RING_OF_DUELING_5_, 5],
      [ItemIds.RING_OF_DUELING_4_, 4],
      [ItemIds.RING_OF_DUELING_3_, 3],
      [ItemIds.RING_OF_DUELING_2_, 2],
      [ItemIds.RING_OF_DUELING_1_, 1],
    ],
    spent: null,
    rubMessage: "You rub the ring...",
    emptyMessage: "Your ring hasn't got any charges left.",
    lastChargeMessage: "Your ring of dueling crumbles to dust.",
    destinations: [
      { label: "Emir's Arena", aliases: ["Duel Arena", "PvP Arena"], tile: [3315, 3235, 0] },
      { label: "Castle Wars", tile: [2440, 3090, 0] },
      { label: "Ferox Enclave", tile: [3151, 3636, 0] },
      // OSRS unlocks it with the Colosseum's Hero title; tsps has no Colosseum yet, so it's open.
      { label: "Fortis Colosseum", tile: [1793, 3107, 0] },
    ],
  },
  {
    key: "skills",
    noun: "skills necklace",
    charged: [
      [ItemIds.SKILLS_NECKLACE_6_, 6],
      [ItemIds.SKILLS_NECKLACE_5_, 5],
      [ItemIds.SKILLS_NECKLACE_4_, 4],
      [ItemIds.SKILLS_NECKLACE_3_, 3],
      [ItemIds.SKILLS_NECKLACE_2_, 2],
      [ItemIds.SKILLS_NECKLACE_1_, 1],
    ],
    spent: ItemIds.SKILLS_NECKLACE,
    rechargeable: true,
    // Legends' Guild totem pole: 6 charges once Legends' Quest is complete (Wiki).
    recharge: { totem: true, quest: "Legends' Quest" },
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    emptyMessage: "You will need to recharge your skills necklace before you can use it again.",
    lastChargeMessage: "You use your skills necklace's last charge.",
    destinations: [
      { label: "Fishing Guild", tile: [2613, 3389, 0] },
      { label: "Mining Guild", tile: [3048, 9763, 0] },
      { label: "Crafting Guild", tile: [2935, 3295, 0] },
      { label: "Cooking Guild", tile: [3143, 3439, 0] },
      { label: "Woodcutting Guild", tile: [1661, 3505, 0] },
      {
        label: "Farming Guild",
        // Players who can enter the intermediate tier land inside the guild.
        tile: (player) => (player.getSkillManager().getMaxLevel(Skill.FARMING) >= FARMING_GUILD_INTERMEDIATE_LEVEL
          ? [1248, 3725, 0]
          : [1248, 3719, 0]),
      },
    ],
  },
  {
    key: "combat",
    noun: "combat bracelet",
    charged: [
      [ItemIds.COMBAT_BRACELET_6_, 6],
      [ItemIds.COMBAT_BRACELET_5_, 5],
      [ItemIds.COMBAT_BRACELET_4_, 4],
      [ItemIds.COMBAT_BRACELET_3_, 3],
      [ItemIds.COMBAT_BRACELET_2_, 2],
      [ItemIds.COMBAT_BRACELET_1_, 1],
    ],
    spent: ItemIds.COMBAT_BRACELET,
    rechargeable: true,
    // Legends' Guild totem pole (Wiki).
    recharge: { totem: true, quest: "Legends' Quest" },
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    rubMessage: "You rub the bracelet...",
    emptyMessage: "You will need to recharge your combat bracelet before you can use it again.",
    lastChargeMessage: "You use your combat bracelet's last charge.",
    destinations: [
      { label: "Warriors' Guild", tile: [2882, 3547, 0] },
      { label: "Champions' Guild", tile: [3192, 3367, 0] },
      { label: "Monastery", aliases: ["Edgeville Monastery"], tile: [3052, 3487, 0] },
      { label: "Ranging Guild", tile: [2655, 3443, 0] },
    ],
  },
  {
    key: "burning",
    noun: "amulet",
    charged: [
      [ItemIds.BURNING_AMULET_5_, 5],
      [ItemIds.BURNING_AMULET_4_, 4],
      [ItemIds.BURNING_AMULET_3_, 3],
      [ItemIds.BURNING_AMULET_2_, 2],
      [ItemIds.BURNING_AMULET_1_, 1],
    ],
    spent: null,
    rubMessage: "You rub the amulet...",
    emptyMessage: "Your amulet hasn't got any charges left.",
    lastChargeMessage: "You use your amulet's last charge.",
    // Every destination is in the Wilderness, so each asks before teleporting.
    confirmWilderness: true,
    destinations: [
      { label: "Chaos Temple", tile: [3235, 3637, 0] },
      { label: "Bandit Camp", tile: [3038, 3651, 0] },
      { label: "Lava Maze", tile: [3027, 3839, 0] },
    ],
  },
  {
    key: "digsite",
    noun: "pendant",
    charged: [
      [ItemIds.DIGSITE_PENDANT_5_, 5],
      [ItemIds.DIGSITE_PENDANT_4_, 4],
      [ItemIds.DIGSITE_PENDANT_3_, 3],
      [ItemIds.DIGSITE_PENDANT_2_, 2],
      [ItemIds.DIGSITE_PENDANT_1_, 1],
    ],
    spent: null,
    rubMessage: "You rub the pendant...",
    emptyMessage: "Your pendant hasn't got any charges left.",
    lastChargeMessage: "You use your pendant's last charge.",
    destinations: [
      { label: "Digsite", tile: [3340, 3445, 0] },
      { label: "Fossil Island", tile: [3763, 3870, 1] },
      { label: "Lithkren Dungeon", aliases: ["Lithkren"], tile: [3547, 10456, 0] },
    ],
  },
  {
    key: "passage",
    noun: "necklace of passage",
    unit: "use",
    charged: [
      [ItemIds.NECKLACE_OF_PASSAGE_5_, 5],
      [ItemIds.NECKLACE_OF_PASSAGE_4_, 4],
      [ItemIds.NECKLACE_OF_PASSAGE_3_, 3],
      [ItemIds.NECKLACE_OF_PASSAGE_2_, 2],
      [ItemIds.NECKLACE_OF_PASSAGE_1_, 1],
    ],
    spent: null,
    rubMessage: "You rub the necklace...",
    emptyMessage: "Your necklace hasn't got any charges left.",
    lastChargeMessage: "Your necklace of passage crumbles to dust.",
    destinations: [
      { label: "Wizards' Tower", tile: [3113, 3177, 0] },
      { label: "The Outpost", tile: [2428, 3349, 0] },
      { label: "Eagles' Eyrie", tile: [3406, 3157, 0] },
    ],
  },
  {
    key: "slayer",
    noun: "slayer ring",
    charged: [
      [ItemIds.SLAYER_RING_8_, 8],
      [ItemIds.SLAYER_RING_7_, 7],
      [ItemIds.SLAYER_RING_6_, 6],
      [ItemIds.SLAYER_RING_5_, 5],
      [ItemIds.SLAYER_RING_4_, 4],
      [ItemIds.SLAYER_RING_3_, 3],
      [ItemIds.SLAYER_RING_2_, 2],
      [ItemIds.SLAYER_RING_1_, 1],
    ],
    spent: ItemIds.ENCHANTED_GEM,
    eternal: [ItemIds.SLAYER_RING_ETERNAL_],
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    rubMessage: "You rub the ring...",
    emptyMessage: "Your ring hasn't got any charges left.",
    lastChargeMessage: "Your slayer ring crumbles to dust.",
    teleportOptions: ["Rub", "Teleport"],
    // Rub's submenu is actions, not destinations (item params 451-455); Teleport picks one.
    subOps: ["check", "teleport", "master", "partner", "log"],
    destinations: [
      { label: "Slayer Tower", tile: [3429, 3538, 0] },
      { label: "Fremennik Slayer Dungeon", tile: [2807, 10002, 0] },
      { label: "Tarn's Lair", tile: [3185, 4601, 0] },
      { label: "Stronghold Slayer Cave", tile: [2431, 3424, 0] },
      { label: "Dark Beasts", tile: [2027, 4637, 0] },
    ],
  },
  {
    key: "returning",
    noun: "ring of returning",
    unit: "use",
    charged: [
      [ItemIds.RING_OF_RETURNING_5_, 5],
      [ItemIds.RING_OF_RETURNING_4_, 4],
      [ItemIds.RING_OF_RETURNING_3_, 3],
      [ItemIds.RING_OF_RETURNING_2_, 2],
      [ItemIds.RING_OF_RETURNING_1_, 1],
    ],
    spent: null,
    emptyMessage: "Your ring hasn't got any charges left.",
    lastChargeMessage: "Your ring of returning crumbles to dust.",
    // A single destination: rubbing teleports straight to the respawn point.
    destinations: [
      {
        label: "Respawn point",
        tile: () => {
          const spawn = GameConstants.DEFAULT_LOCATION;
          return [spawn.getX(), spawn.getY(), spawn.getZ()];
        },
      },
    ],
  },
];

for (const piece of JEWELLERY) {
  if (piece.destinationsFrom) {
    piece.destinations = JEWELLERY.find((other) => other.key === piece.destinationsFrom).destinations;
  }
}

module.exports = { JEWELLERY, DEFAULT_WILDERNESS_LEVEL };
