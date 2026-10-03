/**
 * Underground Pass (members).
 *
 * The words come from the "Underground Pass" transcript page; this plugin supplies
 * the variant selector for King Lathas, Koftik, Niloof, Klank, Kamen, the slaves,
 * the paladins, Kardia, her cat, the disciples of Iban and Iban; the start hook,
 * the prose-condition answers, the fire-arrow bridge crossing, the cave-maze
 * objects (wells, furnace, doors, cages, tomb), the Doll of Iban elements
 * (blood / dove / ashes / shadow), the paladin badges and unicorn horn into the
 * blood well, and the Well of Voyage doll throw that ends Iban.
 *
 * Stages (varp 161): 0 not started, 1 spoke Koftik, 2 crossed the bridge,
 * 3 entered the cave below the well, 4 dislodged the boulder, 5 entered Iban's
 * lair, 6 spoke Niloof, 7 found the witch's chest, 8 entered Iban's temple,
 * 9 threw the doll into the Well of Voyage, 10 complete.
 * Per-player progress bits mirror LostCity's varp-162 layout in the persisted
 * "quest.underground_pass.bits" attribute (bit 30 reuses the source's reserved
 * maze range for Kamen's free food).
 *
 * Gaps (no dump/coordinate support): the pass tile map is not reproduced, so
 * obstacle interactions show the transcript words and advance the stage instead
 * of teleporting; the unicorn boulder is folded into the smashed cage; the
 * grid-tile maze, Iban's bolt pattern and the soulless bite damage are not
 * simulated. Source: LostCity quest_upass (pinned in issue #196).
 */
module.exports = function registerUndergroundPassQuest(api) {
  const {
    Skill,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Underground Pass";
  const VARP_UPASS = 161;
  const VARP_IBANMULTI = 162;
  const BITS_ATTRIBUTE = "quest.underground_pass.bits";

  const STAGE_NOT_STARTED = 0;
  const STAGE_SPOKEN_KOFTIK = 1;
  const STAGE_PASSED_BRIDGE = 2;
  const STAGE_SECOND_AREA = 3;
  const STAGE_KILLED_UNICORN = 4;
  const STAGE_MAIN_AREA = 5;
  const STAGE_SPOKEN_NILOOF = 6;
  const STAGE_FOUND_DOLL = 7;
  const STAGE_CONFRONTED_IBAN = 8;
  const STAGE_DEFEATED_IBAN = 9;
  const STAGE_COMPLETE = 10;

  // Bit indexes follow LostCity's varp 162 (see quest_upass.constant).
  const BIT_BLOOD = 1;
  const BIT_DOVE = 2;
  const BIT_ASHES = 3;
  const BIT_SHADOW = 4;
  const BIT_ORB = [5, 6, 7, 8];
  const BIT_DROPPED_CAT = 9;
  const BIT_READ_JOURNAL = 10;
  const BIT_STARTED = 11;
  const BIT_SEARCHED_CRATE = 12;
  const BIT_SPOKEN_JERRO = 13;
  const BIT_THROWN_JERRO = 14;
  const BIT_THROWN_CARL = 15;
  const BIT_THROWN_HARRY = 16;
  const BIT_KOFTIK_INSANE = 17;
  const BIT_THROWN_HORN = 18;
  const BIT_READ_HISTORY = 19;
  const BIT_READ_WELL = 20;
  const BIT_POURED_BREW = 21;
  // ponytail: reuse the source's reserved maze bit range; no maze here.
  const BIT_MET_KOFTIK = 22;
  const BIT_KAMEN_FOOD = 30;

  const UP = "the-underground-pass-";
  const START_HOOK = "quest:underground-pass:start";

  const KOFTIK_IDS = new Set([NpcIdentifiers.KOFTIK, NpcIdentifiers.KOFTIK_2]);
  const NILOOF_IDS = new Set([NpcIdentifiers.NILOOF, NpcIdentifiers.NILOOF_2]);
  const KLANK_IDS = new Set([NpcIdentifiers.KLANK, NpcIdentifiers.KLANK_2]);
  const KAMEN_IDS = new Set([NpcIdentifiers.KAMEN, NpcIdentifiers.KAMEN_2]);
  const KING_LATHAS_IDS = new Set([
    NpcIdentifiers.KING_LATHAS,
    NpcIdentifiers.KING_LATHAS_2,
    NpcIdentifiers.LATHAS,
    NpcIdentifiers.KING_LATHAS_3,
    NpcIdentifiers.KING_LATHAS_4,
  ]);
  const PALADIN_IDS = new Set([
    NpcIdentifiers.SIR_JERRO,
    NpcIdentifiers.SIR_CARL,
    NpcIdentifiers.SIR_HARRY,
  ]);
  const SLAVE_VARIANTS = new Map([
    [NpcIdentifiers.SLAVE_5, UP + "talking-to-the-slaves-slave-1"],
    [NpcIdentifiers.SLAVE_6, UP + "talking-to-the-slaves-slave-2"],
    [NpcIdentifiers.SLAVE_7, UP + "talking-to-the-slaves-slave-3"],
    [NpcIdentifiers.SLAVE_8, UP + "talking-to-the-slaves-slave-4"],
    [NpcIdentifiers.SLAVE_9, UP + "talking-to-the-slaves-slave-5"],
    [NpcIdentifiers.SLAVE_10, UP + "talking-to-the-slaves-slave-6"],
    [NpcIdentifiers.SLAVE_11, UP + "talking-to-the-slaves-slave-7"],
  ]);

  const OILY_CLOTH = ItemIdentifiers.OILY_CLOTH;
  const PIECE_OF_RAILING = ItemIdentifiers.PIECE_OF_RAILING;
  const UNICORN_HORN = ItemIdentifiers.UNICORN_HORN_3;
  const DOLL_OF_IBAN = ItemIdentifiers.DOLL_OF_IBAN;
  const OLD_JOURNAL = ItemIdentifiers.OLD_JOURNAL;
  const HISTORY_OF_IBAN = ItemIdentifiers.HISTORY_OF_IBAN;
  const KLANKS_GAUNTLETS = ItemIdentifiers.KLANKS_GAUNTLETS;
  const WITCHS_CAT = ItemIdentifiers.WITCHS_CAT;
  const DWARF_BREW = ItemIdentifiers.DWARF_BREW;
  const IBANS_ASHES = ItemIdentifiers.IBANS_ASHES;
  const IBANS_DOVE = ItemIdentifiers.IBANS_DOVE;
  const IBANS_SHADOW = ItemIdentifiers.IBANS_SHADOW;
  const IBANS_STAFF = ItemIdentifiers.IBANS_STAFF;
  const BUCKET = ItemIdentifiers.BUCKET;
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  const ROPE = ItemIdentifiers.ROPE;
  const PLANK = ItemIdentifiers.PLANK;
  const COINS = ItemIdentifiers.COINS;

  const ORB_IDS = [
    ItemIdentifiers.ORB_OF_LIGHT,
    ItemIdentifiers.ORB_OF_LIGHT_2,
    ItemIdentifiers.ORB_OF_LIGHT_3,
    ItemIdentifiers.ORB_OF_LIGHT_4,
  ];
  const ORB_BIT_BY_ITEM = new Map(ORB_IDS.map((itemId, index) => [itemId, BIT_ORB[index]]));
  const AMULET_IDS = [
    ItemIdentifiers.AMULET_OF_OTHANIAN,
    ItemIdentifiers.AMULET_OF_DOOMION,
    ItemIdentifiers.AMULET_OF_HOLTHION,
  ];
  const BADGE_BIT_BY_ITEM = new Map([
    [ItemIdentifiers.PALADINS_BADGE, BIT_THROWN_JERRO],
    [ItemIdentifiers.PALADINS_BADGE_2, BIT_THROWN_CARL],
    [ItemIdentifiers.PALADINS_BADGE_3, BIT_THROWN_HARRY],
  ]);
  const CATSPEAK_AMULET_IDS = new Set([
    ItemIdentifiers.CATSPEAK_AMULET,
    ItemIdentifiers.CATSPEAK_AMULET_E_,
    ItemIdentifiers.CATSPEAK_AMULET_2,
    ItemIdentifiers.CATSPEAK_AMULET_E__2,
  ]);
  const ZAMORAK_TOP_IDS = new Set([
    ItemIdentifiers.ZAMORAK_MONK_TOP,
    ItemIdentifiers.ZAMORAK_MONK_TOP_2,
  ]);
  const ZAMORAK_BOTTOM_IDS = new Set([
    ItemIdentifiers.ZAMORAK_MONK_BOTTOM,
    ItemIdentifiers.ZAMORAK_MONK_BOTTOM_2,
  ]);

  const ARROW_TO_FIRE = new Map([
    [ItemIdentifiers.BRONZE_ARROW, ItemIdentifiers.BRONZE_FIRE_ARROW],
    [ItemIdentifiers.IRON_ARROW, ItemIdentifiers.IRON_FIRE_ARROW],
    [ItemIdentifiers.STEEL_ARROW, ItemIdentifiers.STEEL_FIRE_ARROW],
    [ItemIdentifiers.MITHRIL_ARROW, ItemIdentifiers.MITHRIL_FIRE_ARROW],
    [ItemIdentifiers.ADAMANT_ARROW, ItemIdentifiers.ADAMANT_FIRE_ARROW],
    [ItemIdentifiers.RUNE_ARROW, ItemIdentifiers.RUNE_FIRE_ARROW],
  ]);
  const FIRE_TO_LIT = new Map([
    [ItemIdentifiers.BRONZE_FIRE_ARROW, ItemIdentifiers.BRONZE_FIRE_ARROW_LIT_],
    [ItemIdentifiers.IRON_FIRE_ARROW, ItemIdentifiers.IRON_FIRE_ARROW_LIT_],
    [ItemIdentifiers.STEEL_FIRE_ARROW, ItemIdentifiers.STEEL_FIRE_ARROW_LIT_],
    [ItemIdentifiers.MITHRIL_FIRE_ARROW, ItemIdentifiers.MITHRIL_FIRE_ARROW_LIT_],
    [ItemIdentifiers.ADAMANT_FIRE_ARROW, ItemIdentifiers.ADAMANT_FIRE_ARROW_LIT_],
    [ItemIdentifiers.RUNE_FIRE_ARROW, ItemIdentifiers.RUNE_FIRE_ARROW_LIT_],
  ]);
  const LIT_FIRE_ARROWS = new Set(FIRE_TO_LIT.values());
  const UNLIT_FIRE_ARROWS = new Set(FIRE_TO_LIT.keys());

  const CAVE_ENTRANCE = ObjectIdentifiers.CAVE_ENTRANCE_17;
  const CAVE_EXIT = ObjectIdentifiers.CAVE_EXIT_23;
  const BRIDGE_LEVER_IDS = new Set([ObjectIdentifiers.LEVER_19, ObjectIdentifiers.LEVER_20]);
  const PORTCULLIS_LEVER_IDS = new Set([ObjectIdentifiers.LEVER_21]);
  const GUIDE_ROPE_IDS = new Set([ObjectIdentifiers.GUIDE_ROPE, ObjectIdentifiers.GUIDE_ROPE_2]);
  const WELL_OF_IBAN = ObjectIdentifiers.WELL_3;
  const BLOOD_WELL = ObjectIdentifiers.WELL_4;
  const WELL_OF_VOYAGE = ObjectIdentifiers.WELL_5;
  const FURNACE = ObjectIdentifiers.FURNACE_3;
  const UNICORN_DOOR_IDS = new Set([ObjectIdentifiers.DOOR_109, ObjectIdentifiers.DOOR_110]);
  const TEMPLE_DOOR_IDS = new Set([
    ObjectIdentifiers.TEMPLE_DOOR,
    ObjectIdentifiers.DOOR_111,
    ObjectIdentifiers.DOOR_112,
  ]);
  const SEARCHABLE_CAGE_IDS = new Set([ObjectIdentifiers.CAGE_4, ObjectIdentifiers.CAGE_5]);
  const SMASHED_CAGE = ObjectIdentifiers.SMASHED_CAGE;
  const CRATE = ObjectIdentifiers.CRATE_26;
  const WITCH_CHEST_IDS = new Set([ObjectIdentifiers.CHEST_28, ObjectIdentifiers.CHEST_29]);
  const SHADOW_CHEST = ObjectIdentifiers.CHEST_30;
  const WITCH_DOOR_IDS = new Set([ObjectIdentifiers.DOOR_107, ObjectIdentifiers.DOOR_108]);
  const WITCH_WINDOW = ObjectIdentifiers.WINDOW_2;
  const TOMB_IDS = new Set([ObjectIdentifiers.TOMB, ObjectIdentifiers.TOMB_2]);
  const BREW_BARREL = ObjectIdentifiers.BREW_BARREL;
  const PLANK_ROCK_IDS = new Set([ObjectIdentifiers.FLAT_ROCK, ObjectIdentifiers.FLAT_ROCK_2]);
  const SWAMP = ObjectIdentifiers.SWAMP;
  const ROCKSLIDE = ObjectIdentifiers.ROCKSLIDE;
  const PIPE_IDS = new Set([
    ObjectIdentifiers.PIPE_18,
    ObjectIdentifiers.PIPE_19,
    ObjectIdentifiers.PIPE_20,
  ]);
  const PLATFORM_JUMP_IDS = new Set([
    ObjectIdentifiers.BRIDGE_3,
    ObjectIdentifiers.BRIDGE_4,
    ObjectIdentifiers.BRIDGE_5,
    ObjectIdentifiers.BRIDGE_6,
    ObjectIdentifiers.BRIDGE_7,
    ObjectIdentifiers.BRIDGE_8,
    ObjectIdentifiers.BRIDGE_9,
    ObjectIdentifiers.BRIDGE_10,
    ObjectIdentifiers.BRIDGE_11,
    ObjectIdentifiers.STONE_BRIDGE,
    ObjectIdentifiers.LEDGE_4,
  ]);
  const STONE_TABLET_IDS = new Set([
    ObjectIdentifiers.STONE_TABLET,
    ObjectIdentifiers.STONE_TABLET_2,
    ObjectIdentifiers.STONE_TABLET_3,
    ObjectIdentifiers.STONE_TABLET_4,
    ObjectIdentifiers.STONE_TABLET_5,
    ObjectIdentifiers.STONE_TABLET_6,
    ObjectIdentifiers.STONE_TABLET_7,
    ObjectIdentifiers.STONE_TABLET_8,
  ]);

  /** Transcript message ids that hand out an item or apply a side effect. */
  const CLOTH_MESSAGE_IDS = new Set(["dKjVQR", "JKl_wP", "6MKgFV"]);
  const PALADIN_SUPPLY_MESSAGE_IDS = new Set(["5VMTyv"]);
  const KLANK_GAUNTLETS_MESSAGE_IDS = new Set(["togqjv", "Yjq1j1"]);
  const KAMEN_FREE_FOOD_MESSAGE_IDS = new Set(["Vj8ttE"]);
  const KAMEN_PAID_FOOD_MESSAGE_IDS = new Set(["W5Jrt0"]);
  const KAMEN_DRINK_MESSAGE_IDS = new Set(["AohvL6", "52VkCl"]);
  const NILOOF_DOLL_MESSAGE_IDS = new Set(["lzsRTE", "mQDqE_"]);
  const NILOOF_BOOK_MESSAGE_IDS = new Set(["Ndmv27", "37Ws3c"]);
  const TOMB_ASHES_MESSAGE_IDS = new Set(["Y2Bdpv"]);
  const WELL_DOLL_MESSAGE_IDS = new Set(["eL5hdF"]);

  let quest;

  const hasItem = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) =>
    player.getInventory().deleteNumber(itemId, amount);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull?.() === true
        ? 0
        : 28;
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function testBit(player, bit) {
    return (bits(player) & (1 << bit)) !== 0;
  }

  function setBit(player, bit) {
    const next = bits(player) | (1 << bit);
    player.setAttribute(BITS_ATTRIBUTE, next | 0);
    player.getPacketSender().sendConfig(VARP_IBANMULTI, next | 0);
  }

  function orbCount(player) {
    return BIT_ORB.reduce((count, bit) => count + (testBit(player, bit) ? 1 : 0), 0);
  }

  function elementsOnDoll(player) {
    return [BIT_BLOOD, BIT_DOVE, BIT_ASHES, BIT_SHADOW].reduce(
      (count, bit) => count + (testBit(player, bit) ? 1 : 0),
      0
    );
  }

  const hasDoll = (player) => hasItem(player, DOLL_OF_IBAN);
  const hasFinishedDoll = (player) => hasDoll(player) && elementsOnDoll(player) === 4;
  const hasAnyOrb = (player) => ORB_IDS.some((itemId) => hasItem(player, itemId));
  const hasAllAmulets = (player) => AMULET_IDS.every((itemId) => hasItem(player, itemId));
  const unicornDoorUnlocked = (player) =>
    testBit(player, BIT_THROWN_JERRO) &&
    testBit(player, BIT_THROWN_CARL) &&
    testBit(player, BIT_THROWN_HARRY) &&
    testBit(player, BIT_THROWN_HORN);

  function wearingZamorakRobes(player) {
    const equipment = player.getEquipment?.();
    const top = equipment?.get?.(Equipment.BODY_SLOT)?.getId?.();
    const bottom = equipment?.get?.(Equipment.LEG_SLOT)?.getId?.();
    return ZAMORAK_TOP_IDS.has(top) && ZAMORAK_BOTTOM_IDS.has(bottom);
  }

  function wearingGauntlets(player) {
    return player.getEquipment?.().get?.(Equipment.HANDS_SLOT)?.getId?.() === KLANKS_GAUNTLETS;
  }

  function hasCatspeakAmulet(player) {
    for (const itemId of CATSPEAK_AMULET_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function hasBow(player) {
    const itemId = player.getEquipment?.().get?.(Equipment.WEAPON_SLOT)?.getId?.();
    if (!Number.isInteger(itemId) || itemId <= 0) return false;
    try {
      const name = api.core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
      return /bow/i.test(name) && !/crossbow/i.test(name);
    } catch {
      return false;
    }
  }

  function hasLitFireArrow(player) {
    const ammo = player.getEquipment?.().get?.(Equipment.AMMUNITION_SLOT)?.getId?.();
    if (LIT_FIRE_ARROWS.has(ammo)) return true;
    for (const itemId of LIT_FIRE_ARROWS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function removeLitFireArrow(player) {
    const equipment = player.getEquipment?.();
    const ammo = equipment?.get?.(Equipment.AMMUNITION_SLOT)?.getId?.();
    if (LIT_FIRE_ARROWS.has(ammo)) {
      equipment.deleteNumber?.(ammo, 1);
      return true;
    }
    for (const itemId of LIT_FIRE_ARROWS) {
      if (hasItem(player, itemId)) {
        take(player, itemId, 1);
        return true;
      }
    }
    return false;
  }

  /** The bridge is shot from the west bank, at the rope, from the pass floor. */
  function bridgeInPosition(player) {
    const location = player.getLocation?.();
    return (location?.getY?.() ?? 0) >= 9700;
  }

  function randomChance(player, skill, base) {
    const level = player.getSkillManager().getCurrentLevel(skill) || 1;
    const chance = Math.min(0.95, Math.max(0.05, (level / 99) * base));
    return Math.random() < chance;
  }

  const agilityRoll = (player) => randomChance(player, Skill.AGILITY, 0.9);
  const disarmRoll = (player) => randomChance(player, Skill.THIEVING, 0.85);

  function playVariant(player, variant) {
    startTranscript(api, player, NpcIdentifiers.KOFTIK, PAGE, variant);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I defeated Iban and destroyed the Doll of Iban in the",
        "<str>Well of Voyage. King Lathas will send mages to repair it.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DEFEATED_IBAN) {
      return [
        "Iban is destroyed and I have his staff.",
        "I must report back to <col=800000>King Lathas</col> in East Ardougne.",
      ];
    }
    if (stage >= STAGE_CONFRONTED_IBAN) {
      return [
        "I have confronted Iban in his temple.",
        "I must finish the <col=800000>Doll of Iban</col> and throw it into",
        "the <col=800000>Well of Voyage</col>.",
      ];
    }
    if (stage >= STAGE_FOUND_DOLL) {
      const elements = [
        ["Blood of Kalrag", BIT_BLOOD],
        ["Iban's dove", BIT_DOVE],
        ["Iban's ashes", BIT_ASHES],
        ["Iban's shadow", BIT_SHADOW],
      ].map(([label, bit]) => (testBit(player, bit) ? `<str>${label}</str>` : label));
      return [
        "The witch's book says the doll needs four elements:",
        ...elements,
        "",
        "Then I must use it on the Well of Voyage in Iban's temple.",
      ];
    }
    if (stage >= STAGE_SPOKEN_NILOOF) {
      return [
        "Niloof told me to find the witch <col=800000>Kardia</col>,",
        "who lives on the platforms above.",
      ];
    }
    if (stage >= STAGE_MAIN_AREA) {
      return [
        "I passed into Iban's lair through the double doors.",
        "I should look for the dwarves to the south.",
      ];
    }
    if (stage >= STAGE_KILLED_UNICORN) {
      return [
        "The boulder crushed the unicorn.",
        "I should pass through the tunnel to the east.",
      ];
    }
    if (stage >= STAGE_SECOND_AREA) {
      return [
        "I climbed down the well after destroying the orbs of light.",
        "Something is watching me; I must go deeper into the caverns.",
      ];
    }
    if (stage >= STAGE_PASSED_BRIDGE) {
      return [
        "I crossed the underground bridge with a fire arrow.",
        "I must work my way deeper into these caverns.",
      ];
    }
    if (stage >= STAGE_SPOKEN_KOFTIK) {
      if (!testBit(player, BIT_MET_KOFTIK)) {
        return [
          "King Lathas asked me to meet a tracker named <col=800000>Koftik</col>.",
          "He waits by the <col=800000>cave entrance</col> in far West Ardougne.",
        ];
      }
      return [
        "I met Koftik at the bridge. The bridge is up, held by ropes.",
        "Koftik found a damp cloth near some charred arrows.",
      ];
    }
    if (testBit(player, BIT_STARTED)) {
      return [
        "King Lathas asked me to meet a tracker named <col=800000>Koftik</col>.",
        "He waits by the <col=800000>cave entrance</col> in far West Ardougne.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Lathas</col>",
      "in <col=800000>East Ardougne</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 3000);
    skills.addExperiences(Skill.ATTACK, 3000);
    // All quest items are cleared when the quest is completed, except the staff
    // and Klank's gauntlets (the stated rewards).
    const junk = [
      OILY_CLOTH,
      PIECE_OF_RAILING,
      UNICORN_HORN,
      DOLL_OF_IBAN,
      OLD_JOURNAL,
      HISTORY_OF_IBAN,
      WITCHS_CAT,
      DWARF_BREW,
      IBANS_ASHES,
      IBANS_DOVE,
      IBANS_SHADOW,
      ...AMULET_IDS,
      ...ORB_IDS,
      ItemIdentifiers.PALADINS_BADGE,
      ItemIdentifiers.PALADINS_BADGE_2,
      ItemIdentifiers.PALADINS_BADGE_3,
    ];
    for (const itemId of junk) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) take(player, itemId, amount);
    }
  }

  /** Which transcript variant each indexed speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (KING_LATHAS_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "finishing-up-talking-to-king-lathas-again";
      if (stage >= STAGE_DEFEATED_IBAN) return "finishing-up";
      if (stage >= STAGE_SPOKEN_KOFTIK || testBit(player, BIT_STARTED)) {
        return "starting-off-talking-to-king-lathas-again";
      }
      return "starting-off";
    }

    if (KOFTIK_IDS.has(npcId)) {
      if (stage >= STAGE_DEFEATED_IBAN) return UP + "talking-to-koftik";
      if (stage >= STAGE_SPOKEN_KOFTIK && !testBit(player, BIT_MET_KOFTIK)) {
        setBit(player, BIT_MET_KOFTIK);
        return UP + "talking-to-koftik-or-attempting-to-enter-the-pass";
      }
      if (stage === STAGE_SPOKEN_KOFTIK) {
        return npcId === NpcIdentifiers.KOFTIK
          ? UP + "talking-to-koftik-outside-the-pass-again"
          : UP + "talking-to-koftik-at-the-bridge";
      }
      if (stage < STAGE_SPOKEN_KOFTIK) return UP + "talking-to-koftik-outside-the-pass-again";
      if (stage === STAGE_PASSED_BRIDGE) return UP + "talking-to-koftik-after-lowering-the-bridge";
      if (stage === STAGE_SECOND_AREA) return UP + "talking-to-koftik-at-the-grid-puzzle";
      if (stage === STAGE_KILLED_UNICORN) return UP + "talking-to-koftik-after-the-stone-bridge-maze";
      if (testBit(player, BIT_KOFTIK_INSANE)) return UP + "talking-to-koftik-again";
      return UP + "talking-to-koftik-in-iban-s-lair";
    }

    if (NILOOF_IDS.has(npcId)) {
      if (stage >= STAGE_DEFEATED_IBAN) return UP + "talking-to-niloof-after-killing-iban";
      if (stage >= STAGE_CONFRONTED_IBAN) return UP + "talking-to-niloof-after-encountering-iban";
      if (stage >= STAGE_FOUND_DOLL) return UP + "returning-to-niloof";
      if (stage >= STAGE_SPOKEN_NILOOF) return UP + "talking-to-niloof-again";
      if (stage >= STAGE_MAIN_AREA) quest.setStage(player, STAGE_SPOKEN_NILOOF);
      return UP + "talking-to-niloof";
    }

    if (KLANK_IDS.has(npcId)) {
      if (stage >= STAGE_CONFRONTED_IBAN) return UP + "talking-to-klank-again";
      if (stage >= STAGE_FOUND_DOLL) return UP + "talking-to-klank-unknown-conditions";
      return UP + "talking-to-klank";
    }

    if (KAMEN_IDS.has(npcId)) {
      if (testBit(player, BIT_KAMEN_FOOD)) {
        return UP + "talking-to-kamen-again-after-receiving-free-food";
      }
      return UP + "talking-to-kamen";
    }

    if (SLAVE_VARIANTS.has(npcId)) return SLAVE_VARIANTS.get(npcId);

    if (PALADIN_IDS.has(npcId)) {
      if (stage >= STAGE_DEFEATED_IBAN) {
        return "historical-talking-to-any-of-the-paladins-post-quest";
      }
      if (testBit(player, BIT_SPOKEN_JERRO)) {
        return UP + "talking-to-the-paladins-again-after-receiving-supplies";
      }
      return UP + "speaking-to-any-of-the-paladins";
    }

    if (npcId === NpcIdentifiers.KARDIA) {
      if (stage >= STAGE_SPOKEN_NILOOF) return UP + "opening-the-witch-s-door-or-searching-window";
      return (
        UP + "attempting-to-open-the-door-or-search-the-window-of-the-witch-s-house-before-talking-to-niloof"
      );
    }
    if (npcId === NpcIdentifiers.WITCHS_CAT) return UP + "the-witch-s-cat";
    if (npcId === NpcIdentifiers.DISCIPLE_OF_IBAN) {
      return wearingZamorakRobes(player)
        ? UP + "talking-to-the-disciples-of-iban-while-wearing-zamorak-robes"
        : UP + "talking-to-the-disciples-of-iban-if-not-wearing-zamorak-robes";
    }
    if (npcId === NpcIdentifiers.IBAN) {
      return stage >= STAGE_CONFRONTED_IBAN ? UP + "facing-iban" : UP + "entering-iban-s-temple";
    }
    return null;
  }

  /** Answer the page's prose conditions without ever throwing. */
  function answerCondition({ player, text, stepId }) {
    const value = String(text ?? "").toLowerCase();
    const stage = quest.getStage(player);
    const slots = freeSlots(player);
    const coins = player.getInventory().getAmount(COINS);

    // Regicide follow-up at the end of the King Lathas conversation.
    if (value.includes("requirements for regicide")) {
      const requirements =
        player.getSkillManager().getCurrentLevel(Skill.AGILITY) >= 56 &&
        player.getSkillManager().getCurrentLevel(Skill.CRAFTING) >= 10;
      return value.includes("does not") ? !requirements : requirements;
    }
    if (value.includes("unknown condition")) return null;

    // Firing the stay rope.
    if (value.includes("without having a bow")) return !hasBow(player);
    if (value.includes("without fire arrows")) return !hasLitFireArrow(player);
    if (value.includes("from the right position")) return bridgeInPosition(player);
    if (value.includes("from the wrong position")) return !bridgeInPosition(player);
    if (value.includes("from the other side of the bridge")) return false;

    // Koftik and the abandoned equipment.
    if (value.includes("before talking to koftik")) return !testBit(player, BIT_MET_KOFTIK);
    if (value.includes("after talking to koftik but with a full inventory")) {
      return testBit(player, BIT_MET_KOFTIK) && slots < 1;
    }
    if (value.includes("taking one cloth")) return slots >= 1 && !hasItem(player, OILY_CLOTH);
    if (value.includes("taking more than one cloth")) {
      return slots >= 1 && hasItem(player, OILY_CLOTH);
    }

    // Pipes and rope swing.
    if (value.includes("from the wrong side")) return false;
    if (value.includes("from the right side")) return true;
    if (value.includes("tying the rope")) return hasItem(player, ROPE);
    if (value.includes("swinging back the other way")) return true;

    // Trap disarms.
    const disarmed = disarmRoll(player);
    if (value.includes("successfully disarmed with a full inventory")) {
      return disarmed && slots < 1;
    }
    if (value.includes("successfully disarmed with free space")) {
      return disarmed && slots >= 1;
    }
    if (value.includes("if successfully disarmed")) return disarmed;
    if (value.includes("if unsuccessfully disarmed")) return !disarmed;

    // Flat rock and orbs.
    if (value.includes("searching the rock")) return true;
    if (value.includes("crossing the rock with a plank")) return hasItem(player, PLANK);
    if (value.includes("already having the orb in your inventory")) return hasAnyOrb(player);

    // Crossings.
    if (value.includes("failing to cross")) return !agilityRoll(player);
    if (value.includes("successfully crossing")) return agilityRoll(player);

    // Cage railing and unicorn horn.
    if (value.includes("while already having a railing piece")) return hasItem(player, PIECE_OF_RAILING);
    if (value.includes("without a railing piece")) return !hasItem(player, PIECE_OF_RAILING);
    if (value.includes("with a railing piece")) return hasItem(player, PIECE_OF_RAILING);
    if (value.includes("while already having the unicorn horn")) return hasItem(player, UNICORN_HORN);

    // Inventory space, most specific phrasings first.
    if (value.includes("after dropping both the book and doll with only 1 open")) return slots === 1;
    if (value.includes("after dropping both the book and doll with 2 or more open")) return slots >= 2;
    if (value.includes("after dropping the doll and/or book while not having any open")) return slots < 1;
    if (value.includes("after dropping the doll with open")) {
      return slots >= 1 && !hasItem(player, DOLL_OF_IBAN);
    }
    if (value.includes("after dropping the book with open")) {
      return slots >= 1 && !hasItem(player, HISTORY_OF_IBAN);
    }
    if (value.includes("without 4 or more inventory")) return slots < 4;
    if (value.includes("4 or more inventory")) return slots >= 4;
    if (value.includes("without enough inventory spots open")) return slots < 4;
    if (value.includes("3 or more inventory spaces open")) return slots >= 3;
    if (value.includes("without enough inventory space")) return slots < 3;
    if (value.includes("7 or more free inventory slots")) return slots >= 7;
    if (
      value.includes("doesn't have enough room in their inventory") ||
      value.includes("does not have enough room in their inventory") ||
      value.includes("doesn't have enough room in the inventory")
    ) {
      return slots < 7;
    }
    if (value.includes("without room in the inventory")) return slots < 1;
    if (value.includes("with a full inventory")) return slots < 1;
    if (
      value.includes("no room in their inventory") ||
      value.includes("no room in your inventory") ||
      value.includes("without room") ||
      value.includes("full inventory") ||
      value.includes("don't have enough room") ||
      value.includes("doesn't have enough room for it")
    ) {
      return slots < 1;
    }
    if (
      value.includes("with open inventory space") ||
      value.includes("has room in their inventory") ||
      value.includes("has room in your inventory") ||
      value.includes("with open inventory")
    ) {
      return slots >= 1;
    }
    if (value.includes("with 3 or more inventory spaces")) return slots >= 3;

    // Coins (75 to Kamen, 5000 to Klank).
    if (value.includes("without enough coins")) return stepId === "eLjI7-" ? coins < 5000 : coins < 75;
    if (value.includes("with enough coins and inventory space")) {
      return coins >= 75 && slots >= 3;
    }

    // Catspeak and the witch's cat.
    if (value.includes("without a catspeak amulet")) return !hasCatspeakAmulet(player);
    if (value.includes("with a catspeak amulet")) return hasCatspeakAmulet(player);
    if (value.includes("trying to pick it up with a full inventory")) return slots < 1;
    if (value.includes("picking it up with inventory space early")) return stage < STAGE_SPOKEN_NILOOF;
    if (value.includes("trying to pick up a second cat")) return hasItem(player, WITCHS_CAT);
    if (value.includes("dropping the cat")) return hasItem(player, WITCHS_CAT);

    // Distracted witch.
    if (
      value.includes("searching the window") ||
      value.includes("opening the door") ||
      value.includes("trying to talk to the witch")
    ) {
      return true;
    }

    // Brew barrel.
    if (value.includes("filling bucket")) return hasItem(player, BUCKET);
    if (value.includes("without a bucket")) return !hasItem(player, BUCKET);

    // Doll, journal and the tomb.
    if (value.includes("without the doll of iban or book")) {
      return !hasDoll(player) || !hasItem(player, HISTORY_OF_IBAN);
    }
    if (value.includes("with the doll and book")) {
      return hasDoll(player) && hasItem(player, HISTORY_OF_IBAN);
    }
    if (value.includes("without the doll of iban")) return !hasDoll(player);
    if (value.includes("throwing the doll into the well")) return hasFinishedDoll(player);
    if (value.includes("if the player lost the doll")) return stage >= STAGE_CONFRONTED_IBAN && !hasDoll(player);
    if (value.includes("if the player also lost the book")) return !hasItem(player, HISTORY_OF_IBAN);
    if (value.includes("attempting to use dwarf brew on the tomb before reading the history of iban")) {
      return !testBit(player, BIT_READ_HISTORY);
    }
    if (value.includes("after reading the history of iban and without the doll")) {
      return testBit(player, BIT_READ_HISTORY) && !hasDoll(player);
    }
    if (value.includes("after reading the history of iban and with the doll")) {
      return testBit(player, BIT_READ_HISTORY) && hasDoll(player);
    }
    if (value.includes("attempting to pour brew on the tomb a second time")) {
      return testBit(player, BIT_POURED_BREW);
    }
    if (value.includes("lighting the tomb")) return hasItem(player, TINDERBOX);
    if (value.includes("searching the tomb while already having iban's ashes")) {
      return hasItem(player, IBANS_ASHES);
    }
    if (value.includes("after smearing the ashes on the doll")) return testBit(player, BIT_ASHES);
    if (value.includes("before reading the history of iban")) return !testBit(player, BIT_READ_HISTORY);
    if (value.includes("after reading the history of iban")) return testBit(player, BIT_READ_HISTORY);

    // Iban's shadow chest.
    if (value.includes("without all 3 amulets")) return !hasAllAmulets(player);
    if (value.includes("with all 3 amulets")) return hasAllAmulets(player);
    if (value.includes("searching again after getting iban's shadow")) return hasItem(player, IBANS_SHADOW);

    // Klank's gauntlets.
    if (value.includes("without having klank's gauntlets in the inventory")) {
      return !hasItem(player, KLANKS_GAUNTLETS) && !wearingGauntlets(player);
    }
    if (value.includes("with open inventory space while wearing the gauntlets")) {
      return slots >= 1 && wearingGauntlets(player);
    }
    if (value.includes("without wearing klank's gauntlets")) return !wearingGauntlets(player);
    if (value.includes("while wearing klank's gauntlets")) return wearingGauntlets(player);

    // Iban's temple door.
    if (value.includes("without wearing zamorak robes")) return !wearingZamorakRobes(player);
    if (value.includes("while wearing zamorak robes with the finished doll")) {
      return wearingZamorakRobes(player) && hasFinishedDoll(player);
    }
    if (value.includes("leaving the temple")) return false;
    if (value.includes("after killing iban")) return stage >= STAGE_DEFEATED_IBAN;

    // Well of Iban seal.
    if (value.includes("before throwing all 4 items in")) return !unicornDoorUnlocked(player);
    if (value.includes("after unlocking the doors")) return unicornDoorUnlocked(player);

    // Tunnel directions are positional and cannot be told apart here.
    if (value.includes("going down") || value.includes("going back up")) return null;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !player) return;
    if (npcId !== undefined && !KING_LATHAS_IDS.has(npcId)) return;
    if (!testBit(player, BIT_STARTED)) setBit(player, BIT_STARTED);
    if (quest.getStage(player) < STAGE_SPOKEN_KOFTIK) {
      quest.setStage(player, STAGE_SPOKEN_KOFTIK);
    }
  }

  /** The King Lathas hand-in completes the quest the moment the player reports. */
  function handleChoice({ player, npcId }) {
    if (!player || !KING_LATHAS_IDS.has(npcId)) return;
    if (quest.getStage(player) !== STAGE_DEFEATED_IBAN) return;
    quest.complete(player);
  }

  /** Item hand-outs carried by transcript message steps. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (CLOTH_MESSAGE_IDS.has(stepId)) {
      if (!hasItem(player, OILY_CLOTH)) give(player, OILY_CLOTH, 1);
      return;
    }
    if (PALADIN_SUPPLY_MESSAGE_IDS.has(stepId)) {
      if (freeSlots(player) >= 7) {
        give(player, ItemIdentifiers.MEAT_PIE, 2);
        give(player, ItemIdentifiers.STEW, 1);
        give(player, ItemIdentifiers.BREAD, 2);
        give(player, ItemIdentifiers.ATTACK_POTION_2_, 1);
        give(player, ItemIdentifiers.RESTORE_POTION_3_, 1);
        if (!testBit(player, BIT_SPOKEN_JERRO)) setBit(player, BIT_SPOKEN_JERRO);
      }
      return;
    }
    if (KLANK_GAUNTLETS_MESSAGE_IDS.has(stepId)) {
      if (!hasItem(player, KLANKS_GAUNTLETS) && !wearingGauntlets(player)) {
        give(player, KLANKS_GAUNTLETS, 1);
      }
      return;
    }
    if (KAMEN_FREE_FOOD_MESSAGE_IDS.has(stepId)) {
      give(player, ItemIdentifiers.MEAT_PIE, 1);
      give(player, ItemIdentifiers.STEW, 1);
      give(player, ItemIdentifiers.BREAD, 1);
      if (!testBit(player, BIT_KAMEN_FOOD)) setBit(player, BIT_KAMEN_FOOD);
      return;
    }
    if (KAMEN_PAID_FOOD_MESSAGE_IDS.has(stepId)) {
      if (player.getInventory().getAmount(COINS) >= 75) take(player, COINS, 75);
      give(player, ItemIdentifiers.MEAT_PIE, 1);
      give(player, ItemIdentifiers.STEW, 1);
      give(player, ItemIdentifiers.BREAD, 1);
      if (!testBit(player, BIT_KAMEN_FOOD)) setBit(player, BIT_KAMEN_FOOD);
      return;
    }
    if (KAMEN_DRINK_MESSAGE_IDS.has(stepId)) {
      // ponytail: the agility drain/strength boost/damage is not applied.
      return;
    }
    if (NILOOF_DOLL_MESSAGE_IDS.has(stepId)) {
      if (!hasDoll(player)) give(player, DOLL_OF_IBAN, 1);
      return;
    }
    if (NILOOF_BOOK_MESSAGE_IDS.has(stepId)) {
      if (!hasItem(player, OLD_JOURNAL)) give(player, OLD_JOURNAL, 1);
      return;
    }
    if (TOMB_ASHES_MESSAGE_IDS.has(stepId)) {
      if (!hasItem(player, IBANS_ASHES)) give(player, IBANS_ASHES, 1);
      return;
    }
    if (WELL_DOLL_MESSAGE_IDS.has(stepId)) {
      defeatIban(player);
    }
  }

  function defeatIban(player) {
    if (quest.getStage(player) >= STAGE_DEFEATED_IBAN) return;
    if (hasDoll(player)) take(player, DOLL_OF_IBAN, 1);
    if (!hasItem(player, IBANS_STAFF)) give(player, IBANS_STAFF, 1);
    give(player, ItemIdentifiers.DEATH_RUNE, 15);
    give(player, ItemIdentifiers.FIRE_RUNE, 30);
    quest.setStage(player, STAGE_DEFEATED_IBAN);
    player.sendMessage("Amongst Iban's remains you find his staff and some runes.");
  }

  /** Oil the arrows, light them, and smear the doll's four elements. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];

    if (ids.includes(OILY_CLOTH)) {
      const arrowId = ids.find((itemId) => ARROW_TO_FIRE.has(itemId));
      if (arrowId === undefined) return;
      if (freeSlots(player) < 1 && player.getInventory().getAmount(arrowId) <= 1) {
        player.sendMessage("You don't have space to do that.");
        event.handled = true;
        return;
      }
      take(player, OILY_CLOTH, 1);
      take(player, arrowId, 1);
      give(player, ARROW_TO_FIRE.get(arrowId), 1);
      player.sendMessage("You wrap the damp cloth around the arrow head.");
      event.handled = true;
      return;
    }

    if (ids.includes(TINDERBOX)) {
      const unlit = ids.find((itemId) => UNLIT_FIRE_ARROWS.has(itemId));
      if (unlit === undefined) return;
      if (freeSlots(player) < 1 && player.getInventory().getAmount(unlit) <= 1) return;
      take(player, unlit, 1);
      give(player, FIRE_TO_LIT.get(unlit), 1);
      player.sendMessage("You light the cloth wrapped arrow head.");
      event.handled = true;
      return;
    }

    if (!ids.includes(DOLL_OF_IBAN)) return;
    const smear = [
      [IBANS_ASHES, BIT_ASHES, "You smear the ashes onto the doll."],
      [IBANS_DOVE, BIT_DOVE, "You smear the remains of the dove onto the doll."],
      [IBANS_SHADOW, BIT_SHADOW, "You pour the strange liquid over the doll."],
    ].find(([itemId]) => ids.includes(itemId));
    if (!smear) return;
    const [itemId, bit, message] = smear;
    if (testBit(player, bit)) return;
    take(player, itemId, 1);
    setBit(player, bit);
    player.sendMessage(message);
    event.handled = true;
  }

  /** Read the witch's book and Randas' journal. */
  function handleItemAction(event) {
    const { player, itemId } = event;
    if (!player) return;
    if (itemId === HISTORY_OF_IBAN) {
      if (!testBit(player, BIT_READ_HISTORY)) setBit(player, BIT_READ_HISTORY);
      player.sendMessage("The book tells of the four elements that brought Iban back from the dead.");
      event.handled = true;
      return;
    }
    if (itemId === OLD_JOURNAL) {
      if (!testBit(player, BIT_READ_JOURNAL)) setBit(player, BIT_READ_JOURNAL);
      player.sendMessage("Randas' journal speaks of the Spheres of Light he hid in the caverns.");
      event.handled = true;
    }
  }

  /** Quest items into the wells, furnace, tomb and doll. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    const stage = quest.getStage(player);

    if (objectId === FURNACE && ORB_BIT_BY_ITEM.has(itemId)) {
      event.handled = true;
      const bit = ORB_BIT_BY_ITEM.get(itemId);
      if (testBit(player, bit)) {
        player.sendMessage("The light of that orb has already faded.");
        return;
      }
      take(player, itemId, 1);
      setBit(player, bit);
      player.sendMessage("You throw the glowing orb into the furnace...");
      player.sendMessage(
        "You feel a cold shudder run down your spine as the light of the orb fades."
      );
      return;
    }

    if (objectId === BLOOD_WELL) {
      const badgeBit = BADGE_BIT_BY_ITEM.get(itemId);
      const isHorn = itemId === UNICORN_HORN;
      if (badgeBit === undefined && !isHorn) return;
      event.handled = true;
      if (isHorn) {
        take(player, UNICORN_HORN, 1);
        setBit(player, BIT_THROWN_HORN);
        player.sendMessage("You throw the unicorn horn into the well.");
      } else {
        take(player, itemId, 1);
        setBit(player, badgeBit);
        player.sendMessage("You throw the coat of arms into the well.");
      }
      player.sendMessage("You hear a howl in the distance as you do.");
      if (unicornDoorUnlocked(player)) {
        player.sendMessage("You hear a click from the skull above the door.");
      }
      return;
    }

    if (objectId === BREW_BARREL && itemId === BUCKET) {
      event.handled = true;
      take(player, BUCKET, 1);
      give(player, DWARF_BREW, 1);
      player.sendMessage("You fill a bucket with dwarf brew.");
      return;
    }

    if (TOMB_IDS.has(objectId)) {
      if (itemId === DWARF_BREW) {
        event.handled = true;
        if (!testBit(player, BIT_READ_HISTORY)) {
          player.sendMessage("You have no reason to do that.");
          return;
        }
        if (testBit(player, BIT_POURED_BREW)) {
          player.sendMessage("You have already poured brew over the tomb.");
          return;
        }
        take(player, DWARF_BREW, 1);
        give(player, BUCKET, 1);
        setBit(player, BIT_POURED_BREW);
        player.sendMessage("You pour the brew over the tomb.");
        return;
      }
      if (itemId === TINDERBOX) {
        event.handled = true;
        if (!testBit(player, BIT_POURED_BREW)) {
          player.sendMessage("It will not light.");
          return;
        }
        player.sendMessage("You light the tomb and it bursts into flames.");
        if (hasItem(player, IBANS_ASHES)) return;
        if (freeSlots(player) < 1) {
          player.sendMessage(
            "You find the ashes of Iban's corpse but you don't have enough room to take them."
          );
          return;
        }
        give(player, IBANS_ASHES, 1);
        player.sendMessage("You search the remains and find the ashes of Iban's corpse.");
        return;
      }
      return;
    }

    if (objectId === WELL_OF_VOYAGE && itemId === DOLL_OF_IBAN) {
      event.handled = true;
      if (!hasFinishedDoll(player)) {
        player.sendMessage("The doll is still incomplete.");
        return;
      }
      if (stage < STAGE_CONFRONTED_IBAN) {
        player.sendMessage("You have no reason to do that yet.");
        return;
      }
      playVariant(player, UP + "the-well-of-voyage");
      defeatIban(player);
      return;
    }

    if (PLANK_ROCK_IDS.has(objectId) && itemId === PLANK) {
      event.handled = true;
      take(player, PLANK, 1);
      player.sendMessage("You place the plank across the flat rock...");
      player.sendMessage("...and quickly walk over.");
      return;
    }

    if (WITCH_DOOR_IDS.has(objectId) && itemId === WITCHS_CAT) {
      event.handled = true;
      if (testBit(player, BIT_DROPPED_CAT)) {
        player.sendMessage("The witch is busy playing with her other cat...");
        return;
      }
      take(player, WITCHS_CAT, 1);
      setBit(player, BIT_DROPPED_CAT);
      playVariant(player, UP + "opening-the-witch-s-door-after-finding-the-cat");
      return;
    }

    if (objectId === SMASHED_CAGE && itemId === PIECE_OF_RAILING) {
      event.handled = true;
      if (stage < STAGE_SECOND_AREA) return;
      if (stage >= STAGE_KILLED_UNICORN) {
        player.sendMessage("The boulder has already fallen.");
        return;
      }
      take(player, PIECE_OF_RAILING, 1);
      quest.setStage(player, STAGE_KILLED_UNICORN);
      player.sendMessage("You use the railing as leverage to dislodge the boulder...");
      player.sendMessage("You hear a loud crash as the boulder reaches the bottom.");
    }
  }

  /** Paladin badges, the demons' amulets and Kalrag's blood. */
  function handleNpcDeath(event) {
    const player = event.killer;
    const { npcId } = event;
    if (!player || typeof player.getInventory !== "function") return;
    const stage = quest.getStage(player);

    if (npcId === NpcIdentifiers.KALRAG) {
      if (stage < STAGE_FOUND_DOLL) {
        player.sendMessage("Kalrag slumps to the floor...");
        return;
      }
      if (!hasDoll(player)) {
        player.sendMessage("...poisonous blood flows from the corpse over the soil.");
        player.sendMessage("But it seeps away into the earth. You can't collect it without the doll.");
        return;
      }
      if (!testBit(player, BIT_BLOOD)) {
        setBit(player, BIT_BLOOD);
        player.sendMessage("You smear the doll of Iban in the poisoned blood.");
      }
      return;
    }

    const amulet = npcId === NpcIdentifiers.OTHANIAN ? ItemIdentifiers.AMULET_OF_OTHANIAN
      : npcId === NpcIdentifiers.DOOMION ? ItemIdentifiers.AMULET_OF_DOOMION
      : npcId === NpcIdentifiers.HOLTHION ? ItemIdentifiers.AMULET_OF_HOLTHION
      : undefined;
    if (amulet !== undefined && stage >= STAGE_FOUND_DOLL && !hasItem(player, amulet)) {
      give(player, amulet, 1);
      player.sendMessage("The demon leaves its amulet behind.");
      return;
    }

    const badge = npcId === NpcIdentifiers.SIR_JERRO ? ItemIdentifiers.PALADINS_BADGE
      : npcId === NpcIdentifiers.SIR_CARL ? ItemIdentifiers.PALADINS_BADGE_2
      : npcId === NpcIdentifiers.SIR_HARRY ? ItemIdentifiers.PALADINS_BADGE_3
      : undefined;
    if (badge !== undefined && !hasItem(player, badge) && !quest.isComplete(player)) {
      give(player, badge, 1);
      player.sendMessage("The paladin's badge clatters to the ground and you pick it up.");
    }
  }

  /** Cavern doors, platforms, wells and the cave maze. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || objectId === undefined) return;
    const stage = quest.getStage(player);

    if (objectId === CAVE_ENTRANCE) {
      event.handled = true;
      if (stage === STAGE_NOT_STARTED && !testBit(player, BIT_STARTED)) {
        player.sendMessage("You must speak to King Lathas before you can enter the Underground Pass.");
        return;
      }
      if (stage === STAGE_NOT_STARTED) {
        quest.setStage(player, STAGE_SPOKEN_KOFTIK);
      }
      playVariant(player, UP + "entering-the-cave-entrance");
      return;
    }

    if (objectId === CAVE_EXIT) {
      event.handled = true;
      playVariant(player, UP + "exiting-back-out-to-west-ardougne");
      return;
    }

    if (BRIDGE_LEVER_IDS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_PASSED_BRIDGE) {
        quest.setStage(player, STAGE_PASSED_BRIDGE);
        playVariant(player, UP + "pulling-the-lever-to-lower-the-bridge");
      } else {
        player.sendMessage("The bridge is already lowered.");
      }
      return;
    }

    if (GUIDE_ROPE_IDS.has(objectId)) {
      event.handled = true;
      if (stage >= STAGE_PASSED_BRIDGE) {
        player.sendMessage("The bridge has already fallen.");
        return;
      }
      if (!hasBow(player)) {
        player.sendMessage("You'll need a bow to do that.");
        return;
      }
      if (!hasLitFireArrow(player)) {
        player.sendMessage(
          "You don't have anything suitable to fire. You need something that will make the bridge drop."
        );
        return;
      }
      removeLitFireArrow(player);
      player.sendMessage("You fire your arrow at the rope supporting the bridge...");
      player.sendMessage("...the arrow impales the rope support.");
      quest.setStage(player, STAGE_PASSED_BRIDGE);
      playVariant(player, UP + "firing-arrows-at-the-bridge");
      return;
    }

    if (PORTCULLIS_LEVER_IDS.has(objectId)) {
      event.handled = true;
      playVariant(player, UP + "pulling-the-lever-next-to-the-portcullis");
      return;
    }

    if (objectId === WELL_OF_IBAN) {
      event.handled = true;
      if (orbCount(player) === 4) {
        if (stage < STAGE_SECOND_AREA) quest.setStage(player, STAGE_SECOND_AREA);
        playVariant(player, UP + "climbing-down-the-well");
      } else {
        playVariant(player, UP + "trying-to-climb-down-the-well-before-destroying-the-orbs");
      }
      return;
    }

    if (objectId === BLOOD_WELL) {
      event.handled = true;
      if (!testBit(player, BIT_READ_WELL)) setBit(player, BIT_READ_WELL);
      player.sendMessage("You search the stone structure and find an old inscription.");
      player.sendMessage("Feed me three crests, and a creature's remains.");
      return;
    }

    if (UNICORN_DOOR_IDS.has(objectId)) {
      event.handled = true;
      if (!unicornDoorUnlocked(player)) {
        player.sendMessage("The door is locked.");
        return;
      }
      if (stage < STAGE_MAIN_AREA) {
        quest.setStage(player, STAGE_MAIN_AREA);
        setBit(player, BIT_KOFTIK_INSANE);
      }
      playVariant(player, UP + "opening-the-door");
      return;
    }

    if (TEMPLE_DOOR_IDS.has(objectId)) {
      event.handled = true;
      if (!testBit(player, BIT_READ_HISTORY)) {
        player.sendMessage("You have no reason to go in there.");
        return;
      }
      if (!hasFinishedDoll(player)) {
        player.sendMessage("You should wait until you have the finished doll before going in there.");
        return;
      }
      if (!wearingZamorakRobes(player)) {
        player.sendMessage("The door refuses to open. Only followers of Zamorak may enter.");
        return;
      }
      if (stage < STAGE_CONFRONTED_IBAN) quest.setStage(player, STAGE_CONFRONTED_IBAN);
      playVariant(player, UP + "entering-iban-s-temple");
      return;
    }

    if (SEARCHABLE_CAGE_IDS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_SECOND_AREA) {
        player.sendMessage("You search the cage but find nothing.");
        return;
      }
      if (hasItem(player, PIECE_OF_RAILING)) {
        player.sendMessage("You search the cage but find nothing.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage(
          "You find a broken piece of railing but you don't have enough room to take it."
        );
        return;
      }
      give(player, PIECE_OF_RAILING, 1);
      player.sendMessage("You find a broken piece of railing lying on the floor. You take it.");
      return;
    }

    if (objectId === SMASHED_CAGE) {
      event.handled = true;
      if (stage < STAGE_KILLED_UNICORN) {
        player.sendMessage("A huge boulder rests against the broken cage.");
        return;
      }
      if (hasItem(player, UNICORN_HORN)) {
        player.sendMessage("You search the cage remains but find nothing.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage(
          "You find a damaged horn amongst the remains but you don't have enough room to take it."
        );
        return;
      }
      give(player, UNICORN_HORN, 1);
      player.sendMessage("You find a damaged horn amongst the remains. You take it.");
      return;
    }

    if (objectId === CRATE) {
      event.handled = true;
      if (testBit(player, BIT_SEARCHED_CRATE)) {
        player.sendMessage("You search the crate but find nothing of interest.");
        return;
      }
      if (freeSlots(player) < 4) {
        player.sendMessage(
          "You search the crate and find some food but you don't have enough room to take it."
        );
        return;
      }
      setBit(player, BIT_SEARCHED_CRATE);
      give(player, ItemIdentifiers.SALMON, 2);
      give(player, ItemIdentifiers.MEAT_PIE, 2);
      player.sendMessage("You search the crate and find some food.");
      return;
    }

    if (WITCH_CHEST_IDS.has(objectId)) {
      event.handled = true;
      if (!testBit(player, BIT_DROPPED_CAT)) {
        player.sendMessage("Inside you hear a witch. She sounds angry.");
        return;
      }
      if (stage < STAGE_SPOKEN_NILOOF) {
        player.sendMessage("You have no reason to search the witch's chest.");
        return;
      }
      const wantsDoll = !hasDoll(player);
      const wantsBook = !hasItem(player, HISTORY_OF_IBAN);
      if (!wantsDoll && !wantsBook) {
        player.sendMessage("You search the chest... but the doll's gone.");
        return;
      }
      if (freeSlots(player) < (wantsDoll ? 1 : 0) + (wantsBook ? 1 : 0)) {
        player.sendMessage(
          "You search the chest and find a doll and a book. However, you don't have enough room."
        );
        return;
      }
      if (stage < STAGE_FOUND_DOLL) quest.setStage(player, STAGE_FOUND_DOLL);
      if (wantsDoll) give(player, DOLL_OF_IBAN, 1);
      if (wantsBook) give(player, HISTORY_OF_IBAN, 1);
      if (freeSlots(player) >= 2) {
        give(player, ItemIdentifiers.ATTACK_POTION_2_, 1);
        give(player, ItemIdentifiers.RESTORE_POTION_3_, 1);
      }
      player.sendMessage("You search the chest and find a doll, a book and some potions.");
      return;
    }

    if (objectId === SHADOW_CHEST) {
      event.handled = true;
      if (hasItem(player, IBANS_SHADOW)) {
        player.sendMessage(
          "The three amulets glow red so you place them on the chest. The chest opens but it contains nothing."
        );
        return;
      }
      if (!hasAllAmulets(player)) {
        player.sendMessage("You attempt to open the chest but it's magically sealed.");
        return;
      }
      for (const itemId of AMULET_IDS) take(player, itemId, 1);
      give(player, IBANS_SHADOW, 1);
      player.sendMessage("The three amulets glow red so you place them on the chest.");
      player.sendMessage("The chest opens and inside you find a strange dark liquid.");
      return;
    }

    if (WITCH_DOOR_IDS.has(objectId) || objectId === WITCH_WINDOW) {
      event.handled = true;
      if (testBit(player, BIT_DROPPED_CAT)) {
        player.sendMessage("The witch is busy talking to her cat.");
      } else if (stage < STAGE_SPOKEN_NILOOF) {
        player.sendMessage("Inside you hear a witch. She sounds angry.");
      } else {
        player.sendMessage("Inside you hear a witch. It sounds like she's looking for something.");
      }
      return;
    }

    if (TOMB_IDS.has(objectId)) {
      event.handled = true;
      player.sendMessage("You try to open the lid of the tomb but it refuses to open.");
      player.sendMessage("You hear a strange noise from below.");
      return;
    }

    if (objectId === FURNACE) {
      event.handled = true;
      player.sendMessage("The furnace glows with a cold, unnatural light.");
      return;
    }

    if (PLATFORM_JUMP_IDS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_SECOND_AREA) {
        player.sendMessage("You have no reason to cross there yet.");
        return;
      }
      player.sendMessage("You attempt to jump over the gap...");
      if (!agilityRoll(player)) {
        player.sendMessage("...but you slip and tumble into the darkness.");
        return;
      }
      player.sendMessage("...you manage to cross safely.");
      return;
    }

    if (PIPE_IDS.has(objectId)) {
      event.handled = true;
      player.sendMessage("You crawl through the pipe.");
      return;
    }

    if (objectId === SWAMP) {
      event.handled = true;
      player.sendMessage("You try to cross the swamp...");
      player.sendMessage("...but you are pulled below.");
      return;
    }

    if (objectId === ROCKSLIDE) {
      event.handled = true;
      player.sendMessage("You climb over the rocks.");
      return;
    }

    if (STONE_TABLET_IDS.has(objectId)) {
      event.handled = true;
      player.sendMessage("The writing seems to have been scratched into the rock with bare hands.");
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "underground_pass",
    name: "Underground Pass",
    varpId: VARP_UPASS,
    startedValue: STAGE_SPOKEN_KOFTIK,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 3000, label: "Agility" },
      { skillId: Skill.ATTACK.getIndex(), amount: 3000, label: "Attack" },
    ],
    scrollItemId: IBANS_STAFF,
    otherRewards: ["The Iban Blast spell", "Klank's gauntlets"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction(handleItemAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
