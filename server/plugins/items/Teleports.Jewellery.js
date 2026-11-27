const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

/** Teleport jewellery usable up to this Wilderness level unless a piece says otherwise. */
const DEFAULT_WILDERNESS_LEVEL = 20;
/** Wiki (Digsite pendant): the refusal for a destination whose quest isn't done. */
const LOCKED_DESTINATION_MESSAGE = "You have not yet unlocked that destination.";
/** Dragonstone jewellery works deeper, through level 30 Wilderness. */
const DRAGONSTONE_WILDERNESS_LEVEL = 30;

const FARMING_GUILD_INTERMEDIATE_LEVEL = 45;

/**
 * Wiki (Strange Machine): using a Digsite pendant on the House on the Hill's machine unlocks its Fossil Island
 * teleport, and on the Lithkren Vault's machine (after Dragon Slayer II) its Lithkren teleport. Each is the player's
 * own, kept by these attributes, set at the machine (Jewellery.plugin.js) and keyed by the machine's cache loc.
 */
const DIGSITE_PENDANT_UNLOCKS = {
  fossil_lab_necklace_enchanter: "digsite-pendant:fossil-island-unlocked",
  lithkren_necklace_enchanter: "digsite-pendant:lithkren-unlocked",
};

/**
 * Destinations marked `kourend` need a first trip to Great Kourend on Veos's ship: the
 * zeah_playerhasvisited varbit (Client of Kourend saves and resends it). Wiki (Games necklace):
 * Wintertodt Camp "Must have visited Zeah at least once". The POH jewellery box's init script
 * strikes Wintertodt Camp, the Woodcutting Guild and the Farming Guild out on the one bit, so the
 * skills necklace's two Kourend guilds share the rule (cache; the Wiki is silent for them).
 */
function visitedKourend(player) {
  const id = CacheDefinitions.getVarbitId("zeah_playerhasvisited");
  return id != null && (player.getPacketSender().getVarbit(id) ?? 0) > 0;
}

/**
 * Charged pieces, most charges first. `spent` is what the last charge leaves
 * behind (null when it crumbles); `eternal` ids never lose charges.
 *
 * Each destination is `{ label, tile }`; `tile` may be a function of the player and plugin API.
 * `aliases` match worn-option names that differ from the dialogue label; `menu` (and the piece's
 * `nowhereMenu`) is the Rub menu's text where the game words it differently from the label.
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
      { label: "Edgeville", tile: [3087, 3496, 0] },
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
    // The Wiki's 1-in-25,000 eternal glory chance also applies to the trimmed variant.
    recharge: { heroes: true, quest: "Heroes' Quest", eternalChance: 25000 },
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    rubMessage: "You rub the amulet...",
    emptyMessage: "Your amulet hasn't got any charges left.",
    lastChargeMessage: "You use your amulet's last charge.",
    destinationsFrom: "glory",
  },
  {
    key: "games",
    noun: "games necklace",
    unit: "use",
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
      { label: "Corporeal Beast", tile: (player, api) => {
        const request = { player, tile: [2967, 4381, 2] };
        api?.emitCustomEvent?.("corporeal:teleport-destination", request);
        return request.tile;
      } },
      // Wiki (Games necklace): "Requires completion of Tears of Guthix quest".
      { label: "Tears of Guthix", tile: [3245, 9500, 2], quest: { key: "tears_of_guthix", name: "Tears of Guthix" } },
      { label: "Wintertodt Camp", tile: [1627, 3941, 0], kourend: true },
    ],
  },
  {
    key: "dueling",
    noun: "ring of dueling",
    unit: "use",
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
    // Rub (rsprox_transcripts/232/03238.txt:39368, and every other recording of it): "Emir's Arena.|Castle Wars
    // Arena.|Ferox Enclave.|Fortis Colosseum.|Nowhere."; the worn options are the labels (Wiki).
    nowhereMenu: "Nowhere.",
    destinations: [
      { label: "Emir's Arena", menu: "Emir's Arena.", aliases: ["Duel Arena", "PvP Arena"], tile: [3315, 3235, 0] },
      { label: "Castle Wars", menu: "Castle Wars Arena.", tile: [2440, 3090, 0] },
      { label: "Ferox Enclave", menu: "Ferox Enclave.", tile: [3151, 3636, 0] },
      // Unlocked by the Colosseum's Hero title (Wiki); rsprox 723 shows the message box when locked.
      {
        label: "Fortis Colosseum",
        menu: "Fortis Colosseum.",
        tile: [1793, 3107, 0],
        colosseumRank: "Hero",
        lockedMessage: "This destination is unlocked by reaching <col=ff0000>Hero</col> status in the Fortis<br>Colosseum.",
      },
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
    // Legends' Guild totem pole: 4 charges once Legends' Quest is complete (Wiki). Recharge
    // Dragonstone needs the quest too, unlike for glories.
    recharge: { totem: true, quest: "Legends' Quest", spellNeedsQuest: true },
    wildernessLevel: DRAGONSTONE_WILDERNESS_LEVEL,
    emptyMessage: "You will need to recharge your skills necklace before you can use it again.",
    lastChargeMessage: "You use your skills necklace's last charge.",
    destinations: [
      { label: "Fishing Guild", tile: [2613, 3389, 0] },
      { label: "Mining Guild", tile: [3048, 9763, 0] },
      { label: "Crafting Guild", tile: [2935, 3295, 0] },
      { label: "Cooking Guild", tile: [3143, 3439, 0] },
      { label: "Woodcutting Guild", tile: [1661, 3505, 0], kourend: true },
      {
        label: "Farming Guild",
        kourend: true,
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
    // Legends' Guild totem pole (Wiki); Recharge Dragonstone needs the quest too.
    recharge: { totem: true, quest: "Legends' Quest", spellNeedsQuest: true },
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
    noun: "burning amulet",
    unit: "use",
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
    lastChargeMessage: "Your burning amulet crumbles away.",
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
    noun: "Digsite Pendant",
    unit: "use",
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
    lastChargeMessage: "Your Digsite Pendant crumbles to dust.",
    destinations: [
      { label: "Digsite", tile: [3340, 3445, 0] },
      // Wiki (Digsite pendant): each teleport comes after its quest - Bone Voyage, and Dragon Slayer II - and
      // (Wiki: Strange Machine) once the pendant has been used on that destination's Strange Machine.
      { label: "Fossil Island", tile: [3763, 3870, 1], quest: { key: "bone_voyage", name: "Bone Voyage" },
        unlock: DIGSITE_PENDANT_UNLOCKS.fossil_lab_necklace_enchanter },
      { label: "Lithkren Dungeon", aliases: ["Lithkren"], tile: [3547, 10456, 0], quest: { key: "dragon_slayer_ii", name: "Dragon Slayer II" },
        unlock: DIGSITE_PENDANT_UNLOCKS.lithkren_necklace_enchanter },
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
    lastChargeMessage: "Your necklace of passage crumbles away.",
    destinations: [
      { label: "Wizards' Tower", tile: [3113, 3177, 0] },
      { label: "The Outpost", tile: [2428, 3349, 0] },
      { label: "Eagles' Eyrie", tile: [3406, 3157, 0] },
      { label: "Wyrmscraig", tile: [2592, 2220, 0] },
    ],
  },
  {
    key: "slayer",
    noun: "Slayer ring",
    // "Your Slayer ring has 7 charges left." but "has one charge left." (captured).
    digits: true,
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
    lastChargeMessage: "Your Slayer ring has worn out.",
    // The cache gives this ring two submenus, and they are different kinds of thing: Rub's rows
    // are actions (Contact Master, Partner, Open Log) and Teleport's are the destinations below.
    // A bare Teleport click still offers the list, which a client without the flyout needs.
    teleportOptions: ["Teleport"],
    actionRows: ["Contact Master", "Partner", "Open Log"],
    destinations: [
      // Wiki (Slayer ring, Teleports): Slayer Tower needs Priest in Peril, Tarn's Lair Haunted Mine, Dark Beasts
      // Mourning's End Part II, Wyrmscraig Cavern (added 29 July 2026, near Mortimer) Fallen From Grace.
      // `aliases` are the rows' own names in the cache's Teleport submenu ("Stronghold", "Fremennik Dungeon").
      { label: "Slayer Tower", tile: [3429, 3538, 0], quest: { key: "priest_in_peril", name: "Priest in Peril" } },
      { label: "Fremennik Slayer Dungeon", aliases: ["Fremennik Dungeon"], tile: [2807, 10002, 0] },
      { label: "Tarn's Lair", tile: [3185, 4601, 0], quest: { key: "haunted_mine", name: "Haunted Mine" } },
      { label: "Stronghold Slayer Cave", aliases: ["Stronghold"], tile: [2431, 3424, 0] },
      { label: "Dark Beasts", tile: [2027, 4637, 0], quest: { key: "mournings_end_part_ii", name: "Mourning's End Part II" } },
      { label: "Wyrmscraig Cavern", tile: [2581, 8633, 0], quest: { key: "fallen_from_grace", name: "Fallen From Grace" } },
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
    // A single destination: rubbing teleports straight to the respawn point (Wiki), the one
    // RespawnPoints.plugin.js keeps for the player (the world's spawn without it).
    destinations: [
      {
        label: "Respawn point",
        tile: (player, pluginApi) => {
          const request = { player, location: null };
          pluginApi?.emitCustomEvent?.("respawn-point:location", request);
          const spawn = request.location ?? GameConstants.DEFAULT_LOCATION;
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

/** The ring of wealth's teleports; RingOfWealth.plugin.js handles the ring itself. */
const RING_OF_WEALTH_DESTINATIONS = [
  { label: "Grand Exchange", tile: [3163, 3478, 0] },
  // Wiki (Ring of wealth): "Requires completion of Throne of Miscellania"; Dondakan "Requires completion of Between a Rock...".
  { label: "Miscellania", tile: [2534, 3862, 0], quest: { key: "throne_of_miscellania", name: "Throne of Miscellania" } },
  { label: "Falador Park", tile: [2995, 3375, 0] },
  { label: "Dondakan", tile: [2824, 10168, 0], quest: { key: "between_a_rock", name: "Between a Rock..." } },
];

/** Whether a destination's own unlock (`unlock`, an attribute key) is done; destinations without one always are. */
function destinationUnlockDone(player, destination) {
  return !destination?.unlock || player.getAttribute(destination.unlock) === true;
}

module.exports = { JEWELLERY, RING_OF_WEALTH_DESTINATIONS, DEFAULT_WILDERNESS_LEVEL, LOCKED_DESTINATION_MESSAGE, DIGSITE_PENDANT_UNLOCKS, visitedKourend, destinationUnlockDone };
