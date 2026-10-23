/**
 * Rag and Bone Man II (members).
 *
 * The words come from the "Rag and Bone Man II" transcript page and, for the start
 * and post-quest reclaim/exchange conversations, the "Odd Old Man" page
 * (npc-dialogues.json). This plugin owns the variant selector, the prose-condition
 * answers, the 27-bone wish list, the hand-in, the 1/4 drop rolls, the
 * vinegar/pot-boiler cleaning chain and the reward.
 *
 * Durable stages stay 1 started / 2 complete. The cache's progress reader
 * (script 4024) reads varp 714 for this quest, and the quest DB row (115,
 * column 19) completes at 6. Rag and Bone Man I uses the same varp, so the
 * durable stage maps to the wire as 4 started / 6 complete; while II is
 * unstarted the wire follows Rag and Bone Man I (0/1, or 4 once I completes).
 * The handed-in bones live in the persisted
 * "quest.rag_and_bone_man_ii.bones" attribute bitset (one bit per species, in the
 * SPECIES order below); the chosen reward(s) in
 * "quest.rag_and_bone_man_ii.rewards" (bit 1 ram skull helm, bit 2 bonesack).
 *
 * Drops (OSRS Wiki, each bone's "Item sources"): the dirty bone drops 1/4 from the
 * monster ids in SPECIES, while the quest is in progress and the bone has not been
 * handed in. The pot-boiler is the map object 14004 at 3360,3505,0 (its client
 * states are 14005-14009); the Wish-list is object 14010 at 3361,3507,0 and the
 * Odd Old Man is npc 1259 at 3361,3505,0.
 *
 * Rewards (OSRS Wiki): 1 Quest point, 5,000 Prayer XP, and a bonesack and/or a ram
 * skull helm chosen in the transcript's finishing dialogue. The post-quest
 * replacement and exchange branches are answered from the reward bits.
 *
 * Gaps/approximations:
 * - Talk-to is claimed by NPC name once Rag and Bone Man I is complete, because
 *   RagAndBoneManI.Quest.js's variant selector always returns its post-quest
 *   variant for a completed quest and would shadow this quest's branches; the
 *   claim replays the right page/variant through QuestRuntime.startTranscript.
 *   The claim defers while Bone Voyage's Odd Old Man lucky-charm step is active,
 *   so BoneVoyage.Quest.js's variant selector keeps NPC 1259.
 * - RagAndBoneManI.Quest.js owns the shared pot-boiler state machine. This quest
 *   passes its vinegar/clean bone ids to that handler, so both quests use the
 *   normal put-bone, light, wait, Remove-Bone and logout-refund lifecycle. The
 *   shared Wish-list object's Read is also theirs; after Rag and Bone Man I it
 *   lists this quest's species, so no separate handler is registered here.
 * - npc-drops.json already rolls the wolf bone from Desert/Dire wolves and the
 *   experiment bone from Experiments unconditionally (its quest condition exists
 *   only as a free-text note), so those ids are omitted here; the other four
 *   conditional rows target monsters this map does not use (a corpse, reanimated
 *   troll/dagannoth). Killing an Experiment or Desert/Dire wolf can therefore drop
 *   twice.
 * - Post-quest replacement/reward ownership counts inventory, equipment and the
 *   bank; an exchange removes the item from whichever container holds it.
 * - Pot-boiler/action messages are this plugin's wording; the transcript has none.
 *
 * Source: https://oldschool.runescape.wiki/w/Rag_and_Bone_Man_II and
 * https://oldschool.runescape.wiki/w/Transcript:Rag_and_Bone_Man_II
 */
module.exports = function registerRagAndBoneManIIQuest(api) {
  const { Item, ItemIdentifiers, NpcIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const ODD_OLD_MAN_NPC_ID = NpcIdentifiers.ODD_OLD_MAN; // 1259
  const ODD_OLD_MAN_NPC_NAME = "Odd Old Man";
  const PAGE = "Rag and Bone Man II";
  const ODD_OLD_MAN_PAGE = "Odd Old Man";

  const POT_OF_VINEGAR_ITEM_ID = ItemIdentifiers.POT_OF_VINEGAR; // 7811
  const RAM_SKULL_HELM_ITEM_ID = ItemIdentifiers.RAM_SKULL_HELM; // 7917
  const BONESACK_ITEM_ID = ItemIdentifiers.BONESACK; // 7918

  const VARP_RAG_AND_BONE_MAN = 714; // shared with Rag and Bone Man I
  const WIRE_STARTED = 4;
  const WIRE_COMPLETE = 6;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;
  const PRAYER_XP = 5000;
  const DROP_DENOMINATOR = 4;
  const LOAD_SHARED_VINEGAR_BONE_EVENT = "rag-and-bone-man-i:load-vinegar-bone";

  const BONES_ATTRIBUTE = "quest.rag_and_bone_man_ii.bones";
  const REWARDS_ATTRIBUTE = "quest.rag_and_bone_man_ii.rewards";
  const BIT_REWARD_HELM = 1 << 0;
  const BIT_REWARD_BONESACK = 1 << 1;
  const RAG_AND_BONE_MAN_I_STAGE_ATTRIBUTE = "quest.rag_and_bone_man_i.stage";
  const RAG_AND_BONE_MAN_I_COMPLETE = 2;
  // Bone Voyage's Odd Old Man step (stage 9 plan agreed, before 11 complete).
  const BONE_VOYAGE_KEY = "bone_voyage";
  const BONE_VOYAGE_PLAN_AGREED = 9;
  const BONE_VOYAGE_COMPLETE = 11;
  const BONE_VOYAGE_CHARM_ATTRIBUTE = "quest.bone_voyage.charm";

  // Transcript ids.
  const PAGE_VARIANT_START = "talking-to-the-odd-old-man-without-any-bones";
  const PAGE_VARIANT_HANDING_IN = "handing-in-some-bones";
  const PAGE_VARIANT_UNCLEAN = "trying-to-hand-in-unclean-bones";
  const PAGE_VARIANT_FINISHING = "finishing-up";
  const POST_QUEST_VARIANT = "after-rag-and-bone-man-ii";
  const HAND_IN_LOOK_LINE = "Great! Let me take a look at them.";
  const INVENTORY_FULL_CONDITION_ID = "_2B26o";
  const HELM_ACTION_ID = "xoRC1-";
  const BONESACK_ACTION_ID = "apFl7S";
  const BOTH_ACTION_ID = "RB5AF3";
  const REPLACEMENT_HELM_CONDITION_ID = "ou_17H";
  const REPLACEMENT_BONESACK_CONDITION_ID = "_IOmyc";
  const EXCHANGE_HELM_CONDITION_ID = "KTAIdv";
  const EXCHANGE_BONESACK_CONDITION_ID = "nJ-h1Q";
  const OWNS_BOTH_CONDITION_ID = "h0RXmB";
  const EXCHANGE_HELM_FOR_BONESACK_OPTION = "Could I exchange this helm for the bonesack?";
  const EXCHANGE_BONESACK_FOR_HELM_OPTION = "Could I exchange this bonesack for the helm?";
  const BOTH_BONESACK_OPTION = "Could I have a bonesack as well?";
  const BOTH_HELM_OPTION = "Could I have a helm as well?";
  const COMPLETION_ACTIONS = new Map([
    [HELM_ACTION_ID, "helm"],
    [BONESACK_ACTION_ID, "bonesack"],
    [BOTH_ACTION_ID, "both"],
  ]);

  /**
   * The 27 wish-list species in cache id order (dirty bone, bone in vinegar,
   * polished bone) with the monster ids the OSRS Wiki lists as drop sources.
   * Desert/Dire wolves and Experiments are left out because npc-drops.json
   * already rolls their bone unconditionally (see the header).
   */
  const SPECIES = [
    {
      label: "Wolf bone",
      dirty: ItemIdentifiers.WOLF_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_7,
      clean: ItemIdentifiers.WOLF_BONE_2,
      npcIds: [
        NpcIdentifiers.WOLF, NpcIdentifiers.WOLF_2, NpcIdentifiers.WOLF_3, NpcIdentifiers.WOLF_4,
        NpcIdentifiers.WOLF_5, NpcIdentifiers.WOLF_6, NpcIdentifiers.WOLF_7, NpcIdentifiers.WOLF_8,
        NpcIdentifiers.WHITE_WOLF, NpcIdentifiers.WHITE_WOLF_2,
      ],
    },
    {
      label: "Bat wing",
      dirty: ItemIdentifiers.BAT_WING,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_8,
      clean: ItemIdentifiers.BAT_WING_2,
      npcIds: [NpcIdentifiers.BAT, NpcIdentifiers.BAT_2, NpcIdentifiers.BAT_4, NpcIdentifiers.BAT_5],
    },
    {
      label: "Rat bone",
      dirty: ItemIdentifiers.RAT_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_9,
      clean: ItemIdentifiers.RAT_BONE_2,
      npcIds: [
        NpcIdentifiers.RAT_4, NpcIdentifiers.RAT_5, NpcIdentifiers.RAT_6, NpcIdentifiers.RAT_7,
        NpcIdentifiers.RAT_9, NpcIdentifiers.RAT_20,
        NpcIdentifiers.GIANT_RAT, NpcIdentifiers.GIANT_RAT_2, NpcIdentifiers.GIANT_RAT_3,
      ],
    },
    {
      label: "Baby dragon bone",
      dirty: ItemIdentifiers.BABY_DRAGON_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_10,
      clean: ItemIdentifiers.BABY_DRAGON_BONE_2,
      npcIds: [
        NpcIdentifiers.BABY_BLUE_DRAGON, NpcIdentifiers.BABY_BLUE_DRAGON_2, NpcIdentifiers.BABY_BLUE_DRAGON_3,
        NpcIdentifiers.BABY_BLUE_DRAGON_4, NpcIdentifiers.BABY_BLUE_DRAGON_5,
      ],
    },
    {
      label: "Ogre ribs",
      dirty: ItemIdentifiers.OGRE_RIBS,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_11,
      clean: ItemIdentifiers.OGRE_RIBS_2,
      npcIds: [NpcIdentifiers.OGRE, NpcIdentifiers.OGRE_2, NpcIdentifiers.OGRE_3, NpcIdentifiers.OGRE_4, NpcIdentifiers.OGRE_5],
    },
    {
      label: "Jogre bone",
      dirty: ItemIdentifiers.JOGRE_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_12,
      clean: ItemIdentifiers.JOGRE_BONE_2,
      npcIds: [NpcIdentifiers.JOGRE, NpcIdentifiers.JOGRE_2],
    },
    {
      label: "Zogre bone",
      dirty: ItemIdentifiers.ZOGRE_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_13,
      clean: ItemIdentifiers.ZOGRE_BONE_2,
      npcIds: [
        NpcIdentifiers.ZOGRE, NpcIdentifiers.ZOGRE_2, NpcIdentifiers.ZOGRE_3, NpcIdentifiers.ZOGRE_4,
        NpcIdentifiers.ZOGRE_5, NpcIdentifiers.ZOGRE_6, NpcIdentifiers.ZOGRE_7, NpcIdentifiers.ZOGRE_8,
        NpcIdentifiers.ZOGRE_9, NpcIdentifiers.ZOGRE_10, NpcIdentifiers.ZOGRE_11,
      ],
    },
    {
      label: "Mogre bone",
      dirty: ItemIdentifiers.MOGRE_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_14,
      clean: ItemIdentifiers.MOGRE_BONE_2,
      npcIds: [NpcIdentifiers.MOGRE],
    },
    {
      label: "Dagannoth ribs",
      dirty: ItemIdentifiers.DAGANNOTH_RIBS,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_16,
      clean: ItemIdentifiers.DAGANNOTH_RIBS_2,
      npcIds: [
        NpcIdentifiers.DAGANNOTH, NpcIdentifiers.DAGANNOTH_2, NpcIdentifiers.DAGANNOTH_3,
        NpcIdentifiers.DAGANNOTH_4, NpcIdentifiers.DAGANNOTH_5, NpcIdentifiers.DAGANNOTH_6,
        NpcIdentifiers.DAGANNOTH_7, NpcIdentifiers.DAGANNOTH_11, NpcIdentifiers.DAGANNOTH_12,
        NpcIdentifiers.DAGANNOTH_13, NpcIdentifiers.DAGANNOTH_14, NpcIdentifiers.DAGANNOTH_15,
        NpcIdentifiers.DAGANNOTH_16, NpcIdentifiers.DAGANNOTH_17,
      ],
    },
    {
      label: "Snake spine",
      dirty: ItemIdentifiers.SNAKE_SPINE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_17,
      clean: ItemIdentifiers.SNAKE_SPINE_2,
      npcIds: [
        NpcIdentifiers.SNAKE, NpcIdentifiers.SNAKE_2, NpcIdentifiers.SNAKE_4, NpcIdentifiers.SNAKE_5,
        NpcIdentifiers.SNAKE_6, NpcIdentifiers.SNAKE_7, NpcIdentifiers.SNAKE_8,
      ],
    },
    {
      label: "Zombie bone",
      dirty: ItemIdentifiers.ZOMBIE_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_18,
      clean: ItemIdentifiers.ZOMBIE_BONE_2,
      npcIds: [
        NpcIdentifiers.ZOMBIE, NpcIdentifiers.ZOMBIE_2, NpcIdentifiers.ZOMBIE_3, NpcIdentifiers.ZOMBIE_4,
        NpcIdentifiers.ZOMBIE_5, NpcIdentifiers.ZOMBIE_6, NpcIdentifiers.ZOMBIE_7, NpcIdentifiers.ZOMBIE_8,
        NpcIdentifiers.ZOMBIE_9, NpcIdentifiers.ZOMBIE_10, NpcIdentifiers.ZOMBIE_11, NpcIdentifiers.ZOMBIE_12,
        NpcIdentifiers.ZOMBIE_13, NpcIdentifiers.ZOMBIE_14, NpcIdentifiers.ZOMBIE_15, NpcIdentifiers.ZOMBIE_16,
        NpcIdentifiers.ZOMBIE_17, NpcIdentifiers.ZOMBIE_18, NpcIdentifiers.ZOMBIE_19, NpcIdentifiers.ZOMBIE_20,
        NpcIdentifiers.ZOMBIE_21, NpcIdentifiers.ZOMBIE_22, NpcIdentifiers.ZOMBIE_23, NpcIdentifiers.ZOMBIE_24,
        NpcIdentifiers.ZOMBIE_25, NpcIdentifiers.ZOMBIE_26, NpcIdentifiers.ZOMBIE_27, NpcIdentifiers.ZOMBIE_28,
        NpcIdentifiers.ZOMBIE_29, NpcIdentifiers.ZOMBIE_30, NpcIdentifiers.ZOMBIE_31, NpcIdentifiers.ZOMBIE_32,
        NpcIdentifiers.ZOMBIE_33, NpcIdentifiers.ZOMBIE_34, NpcIdentifiers.ZOMBIE_35, NpcIdentifiers.ZOMBIE_36,
        NpcIdentifiers.ZOMBIE_37, NpcIdentifiers.ZOMBIE_38, NpcIdentifiers.ZOMBIE_39, NpcIdentifiers.ZOMBIE_40,
        NpcIdentifiers.ZOMBIE_41, NpcIdentifiers.ZOMBIE_42, NpcIdentifiers.ZOMBIE_43,
        NpcIdentifiers.ZOMBIE_44, NpcIdentifiers.ZOMBIE_46, NpcIdentifiers.ZOMBIE_47,
        NpcIdentifiers.ZOMBIE_48, NpcIdentifiers.ZOMBIE_49, NpcIdentifiers.ZOMBIE_50,
        NpcIdentifiers.ZOMBIE_51, NpcIdentifiers.ZOMBIE_52, NpcIdentifiers.ZOMBIE_53,
        NpcIdentifiers.ZOMBIE_54, NpcIdentifiers.ZOMBIE_55, NpcIdentifiers.ZOMBIE_56,
        NpcIdentifiers.ZOMBIE_85, NpcIdentifiers.ZOMBIE_86, NpcIdentifiers.ZOMBIE_87,
        NpcIdentifiers.ZOMBIE_88, NpcIdentifiers.ZOMBIE_89, NpcIdentifiers.ZOMBIE_90,
        NpcIdentifiers.ZOMBIE_91,
      ],
    },
    {
      label: "Werewolf bone",
      dirty: ItemIdentifiers.WEREWOLF_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_19,
      clean: ItemIdentifiers.WEREWOLF_BONE_2,
      npcIds: [
        NpcIdentifiers.WEREWOLF, NpcIdentifiers.WEREWOLF_2, NpcIdentifiers.WEREWOLF_3,
        NpcIdentifiers.WEREWOLF_4, NpcIdentifiers.WEREWOLF_5, NpcIdentifiers.WEREWOLF_6,
        NpcIdentifiers.WEREWOLF_7, NpcIdentifiers.WEREWOLF_8, NpcIdentifiers.WEREWOLF_9,
        NpcIdentifiers.WEREWOLF_10, NpcIdentifiers.WEREWOLF_11, NpcIdentifiers.WEREWOLF_12,
        NpcIdentifiers.WEREWOLF_13, NpcIdentifiers.WEREWOLF_14, NpcIdentifiers.WEREWOLF_15,
        NpcIdentifiers.WEREWOLF_16, NpcIdentifiers.WEREWOLF_17, NpcIdentifiers.WEREWOLF_18,
        NpcIdentifiers.WEREWOLF_19, NpcIdentifiers.WEREWOLF_20, NpcIdentifiers.WEREWOLF_21,
        NpcIdentifiers.WEREWOLF_22,
      ],
    },
    {
      label: "Moss giant bone",
      dirty: ItemIdentifiers.MOSS_GIANT_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_20,
      clean: ItemIdentifiers.MOSS_GIANT_BONE_2,
      npcIds: [
        NpcIdentifiers.MOSS_GIANT_2, NpcIdentifiers.MOSS_GIANT_3, NpcIdentifiers.MOSS_GIANT_4,
        NpcIdentifiers.MOSS_GIANT_5, NpcIdentifiers.MOSS_GIANT_6, NpcIdentifiers.MOSS_GIANT_7,
        NpcIdentifiers.MOSS_GIANT_8, NpcIdentifiers.MOSS_GIANT_9, NpcIdentifiers.MOSS_GIANT_10,
        NpcIdentifiers.MOSS_GIANT_11, NpcIdentifiers.MOSS_GIANT_12, NpcIdentifiers.MOSS_GIANT_13,
      ],
    },
    {
      label: "Fire giant bone",
      dirty: ItemIdentifiers.FIRE_GIANT_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_21,
      clean: ItemIdentifiers.FIRE_GIANT_BONE_2,
      npcIds: [
        NpcIdentifiers.FIRE_GIANT, NpcIdentifiers.FIRE_GIANT_2, NpcIdentifiers.FIRE_GIANT_3,
        NpcIdentifiers.FIRE_GIANT_4, NpcIdentifiers.FIRE_GIANT_5, NpcIdentifiers.FIRE_GIANT_6,
        NpcIdentifiers.FIRE_GIANT_7, NpcIdentifiers.FIRE_GIANT_8, NpcIdentifiers.FIRE_GIANT_9,
        NpcIdentifiers.FIRE_GIANT_10, NpcIdentifiers.FIRE_GIANT_11, NpcIdentifiers.FIRE_GIANT_12,
      ],
    },
    {
      label: "Ice giant ribs",
      dirty: ItemIdentifiers.ICE_GIANT_RIBS,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_22,
      clean: ItemIdentifiers.ICE_GIANT_RIBS_2,
      npcIds: [
        NpcIdentifiers.ICE_GIANT, NpcIdentifiers.ICE_GIANT_2, NpcIdentifiers.ICE_GIANT_3,
        NpcIdentifiers.ICE_GIANT_4, NpcIdentifiers.ICE_GIANT_5, NpcIdentifiers.ICE_GIANT_6,
        NpcIdentifiers.ICE_GIANT_7, NpcIdentifiers.ICE_GIANT_8, NpcIdentifiers.ICE_GIANT_9,
        NpcIdentifiers.ICE_GIANT_10,
      ],
    },
    {
      label: "Terrorbird wing",
      dirty: ItemIdentifiers.TERRORBIRD_WING,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_23,
      clean: ItemIdentifiers.TERRORBIRD_WING_2,
      npcIds: [NpcIdentifiers.TERRORBIRD, NpcIdentifiers.TERRORBIRD_2, NpcIdentifiers.TERRORBIRD_3],
    },
    {
      label: "Ghoul bone",
      dirty: ItemIdentifiers.GHOUL_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_24,
      clean: ItemIdentifiers.GHOUL_BONE_2,
      npcIds: [NpcIdentifiers.GHOUL],
    },
    {
      label: "Troll bone",
      dirty: ItemIdentifiers.TROLL_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_25,
      clean: ItemIdentifiers.TROLL_BONE_2,
      npcIds: [
        NpcIdentifiers.TROLL, NpcIdentifiers.MOUNTAIN_TROLL, NpcIdentifiers.MOUNTAIN_TROLL_2,
        NpcIdentifiers.MOUNTAIN_TROLL_3, NpcIdentifiers.MOUNTAIN_TROLL_4, NpcIdentifiers.MOUNTAIN_TROLL_5,
        NpcIdentifiers.MOUNTAIN_TROLL_6, NpcIdentifiers.MOUNTAIN_TROLL_7, NpcIdentifiers.MOUNTAIN_TROLL_8,
        NpcIdentifiers.MOUNTAIN_TROLL_9, NpcIdentifiers.MOUNTAIN_TROLL_10, NpcIdentifiers.MOUNTAIN_TROLL_11,
        NpcIdentifiers.TROLL_GENERAL, NpcIdentifiers.TROLL_GENERAL_2, NpcIdentifiers.TROLL_GENERAL_3,
        NpcIdentifiers.THROWER_TROLL, NpcIdentifiers.THROWER_TROLL_2, NpcIdentifiers.THROWER_TROLL_3,
        NpcIdentifiers.THROWER_TROLL_4, NpcIdentifiers.THROWER_TROLL_5,
        NpcIdentifiers.RIVER_TROLL, NpcIdentifiers.RIVER_TROLL_2, NpcIdentifiers.RIVER_TROLL_3,
        NpcIdentifiers.RIVER_TROLL_4, NpcIdentifiers.RIVER_TROLL_5, NpcIdentifiers.RIVER_TROLL_6,
        NpcIdentifiers.ARRG_2, NpcIdentifiers.ARRG_3, NpcIdentifiers.KRAKA, NpcIdentifiers.STICK,
        NpcIdentifiers.PEE_HAT, NpcIdentifiers.TWIG_2, NpcIdentifiers.TWIG_3, NpcIdentifiers.BERRY,
        NpcIdentifiers.BERRY_2, NpcIdentifiers.DRINK_TROLL, NpcIdentifiers.CHUCK_UP,
        NpcIdentifiers.DADDYS_SPECIAL_WATER, NpcIdentifiers.THE_ROCKS, NpcIdentifiers.DINKY_THE_DRINK_TROLL,
      ],
    },
    {
      label: "Seagull wing",
      dirty: ItemIdentifiers.SEAGULL_WING,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_26,
      clean: ItemIdentifiers.SEAGULL_WING_2,
      npcIds: [NpcIdentifiers.SEAGULL, NpcIdentifiers.SEAGULL_2, NpcIdentifiers.SEAGULL_3, NpcIdentifiers.SEAGULL_5],
    },
    {
      label: "Undead cow ribs",
      dirty: ItemIdentifiers.UNDEAD_COW_RIBS,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_27,
      clean: ItemIdentifiers.UNDEAD_COW_RIBS_2,
      npcIds: [NpcIdentifiers.UNDEAD_COW],
    },
    {
      label: "Experiment bone",
      dirty: ItemIdentifiers.EXPERIMENT_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_28,
      clean: ItemIdentifiers.EXPERIMENT_BONE_2,
      npcIds: [],
    },
    {
      label: "Rabbit bone",
      dirty: ItemIdentifiers.RABBIT_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_29,
      clean: ItemIdentifiers.RABBIT_BONE_2,
      npcIds: [
        NpcIdentifiers.RABBIT, NpcIdentifiers.RABBIT_2, NpcIdentifiers.RABBIT_3, NpcIdentifiers.RABBIT_4,
        NpcIdentifiers.RABBIT_5, NpcIdentifiers.RABBIT_6, NpcIdentifiers.RABBIT_7, NpcIdentifiers.RABBIT_12,
        NpcIdentifiers.RABBIT_13, NpcIdentifiers.RABBIT_14, NpcIdentifiers.RABBIT_15,
        NpcIdentifiers.BUNNY, NpcIdentifiers.BUNNY_2,
      ],
    },
    {
      label: "Basilisk bone",
      dirty: ItemIdentifiers.BASILISK_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_30,
      clean: ItemIdentifiers.BASILISK_BONE_2,
      npcIds: [
        NpcIdentifiers.BASILISK, NpcIdentifiers.BASILISK_2, NpcIdentifiers.BASILISK_3,
        NpcIdentifiers.BASILISK_4, NpcIdentifiers.BASILISK_5, NpcIdentifiers.BASILISK_6,
      ],
    },
    {
      label: "Desert lizard bone",
      dirty: ItemIdentifiers.DESERT_LIZARD_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_31,
      clean: ItemIdentifiers.DESERT_LIZARD_BONE_2,
      npcIds: [NpcIdentifiers.LIZARD],
    },
    {
      label: "Cave goblin skull",
      dirty: ItemIdentifiers.CAVE_GOBLIN_SKULL,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_32,
      clean: ItemIdentifiers.CAVE_GOBLIN_SKULL_2,
      npcIds: [
        NpcIdentifiers.CAVE_GOBLIN_27, NpcIdentifiers.CAVE_GOBLIN_28, NpcIdentifiers.CAVE_GOBLIN_29,
        NpcIdentifiers.CAVE_GOBLIN_30, NpcIdentifiers.CAVE_GOBLIN_GUARD, NpcIdentifiers.CAVE_GOBLIN_GUARD_2,
        NpcIdentifiers.CAVE_GOBLIN_MINER, NpcIdentifiers.CAVE_GOBLIN_MINER_2, NpcIdentifiers.CAVE_GOBLIN_MINER_3,
        NpcIdentifiers.CAVE_GOBLIN_MINER_4, NpcIdentifiers.CAVE_GOBLIN_MINER_5, NpcIdentifiers.CAVE_GOBLIN_MINER_6,
        NpcIdentifiers.CAVE_GOBLIN_MINER_7, NpcIdentifiers.CAVE_GOBLIN_MINER_8,
      ],
    },
    {
      label: "Vulture wing",
      dirty: ItemIdentifiers.VULTURE_WING,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_34,
      clean: ItemIdentifiers.VULTURE_WING_2,
      npcIds: [NpcIdentifiers.VULTURE, NpcIdentifiers.VULTURE_2],
    },
    {
      label: "Jackal bone",
      dirty: ItemIdentifiers.JACKAL_BONE,
      vinegar: ItemIdentifiers.BONE_IN_VINEGAR_35,
      clean: ItemIdentifiers.JACKAL_BONE_2,
      npcIds: [NpcIdentifiers.JACKAL, NpcIdentifiers.JACKAL_2],
    },
  ];

  SPECIES.forEach((species, index) => {
    species.bit = 1 << index;
  });
  const ALL_BONES_MASK = (1 << SPECIES.length) - 1;
  const SPECIES_BY_DIRTY_ID = new Map(SPECIES.map((species) => [species.dirty, species]));
  const SPECIES_BY_VINEGAR_ID = new Map(SPECIES.map((species) => [species.vinegar, species]));
  const SPECIES_BY_NPC_ID = new Map();
  for (const species of SPECIES) {
    for (const npcId of species.npcIds) SPECIES_BY_NPC_ID.set(npcId, species);
  }

  let quest;
  const rewardChoices = new WeakMap();
  /** Players whose current Odd Old Man conversation is one of this quest's hand-ins. */
  const pendingHandIn = new WeakSet();

  function bones(player) {
    return Number(player.getAttribute(BONES_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bones(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BONES_ATTRIBUTE, bones(player) | bit);
  }

  function rewards(player) {
    return Number(player.getAttribute(REWARDS_ATTRIBUTE)) || 0;
  }

  function hasReward(player, bit) {
    return (rewards(player) & bit) !== 0;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function ragAndBoneManIComplete(player) {
    const request = { player, key: "rag_and_bone_man_i", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    if (request.complete === true) return true;
    return (Number(player.getAttribute(RAG_AND_BONE_MAN_I_STAGE_ATTRIBUTE)) || 0) >= RAG_AND_BONE_MAN_I_COMPLETE;
  }

  /** Another registered quest's durable stage, or 0 when it is not registered. */
  function questStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  }

  /**
   * Bone Voyage owns NPC 1259 while it wants the lucky bone charm; its variant
   * selector must run instead of this quest's Talk-to transcript.
   */
  function boneVoyageNeedsOddOldMan(player) {
    const stage = questStage(player, BONE_VOYAGE_KEY);
    if (stage < BONE_VOYAGE_PLAN_AGREED || stage >= BONE_VOYAGE_COMPLETE) return false;
    return (Number(player.getAttribute(BONE_VOYAGE_CHARM_ATTRIBUTE)) || 0) < 2;
  }

  function carriedOrWorn(player, itemId) {
    if (player.getInventory().getAmount(itemId) > 0) return true;
    return (player.getEquipment().getItems() || []).some((item) => item && item.getId?.() === itemId);
  }

  function hasItem(player, itemId) {
    if (carriedOrWorn(player, itemId)) return true;
    return (player.getBanks?.() ?? []).some((bank) => (Number(bank?.getAmount?.(itemId)) || 0) > 0);
  }

  /** Removes one item from wherever the player owns it; true when removed. */
  function removeItem(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getAmount(itemId) > 0) {
      inventory.deleteNumber(itemId, 1);
      return true;
    }
    const equipment = player.getEquipment();
    if ((equipment.getItems() || []).some((item) => item && item.getId?.() === itemId)) {
      equipment.deleteNumber(itemId, 1);
      return true;
    }
    for (const bank of player.getBanks?.() ?? []) {
      if ((Number(bank?.getAmount?.(itemId)) || 0) > 0) {
        bank.deleteNumber(itemId, 1);
        return true;
      }
    }
    return false;
  }

  function giveItem(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() > 0 || inventory.getAmount(itemId) > 0) {
      inventory.adds(itemId, 1);
      return;
    }
    api.getItemOnGroundManager().registerLocation(player, new Item(itemId, 1), player.getLocation());
  }

  function handInBones(player) {
    const inventory = player.getInventory();
    for (const species of SPECIES) {
      if (hasBit(player, species.bit)) continue;
      if (inventory.getAmount(species.clean) <= 0) continue;
      inventory.deleteNumber(species.clean, 1);
      setBit(player, species.bit);
    }
  }

  /** Cleaned bones the player is carrying that the Odd Old Man still needs. */
  function readyBoneCount(player) {
    const inventory = player.getInventory();
    return SPECIES.filter(
      (species) => !hasBit(player, species.bit) && inventory.getAmount(species.clean) > 0
    ).length;
  }

  function remainingBoneCount(player) {
    return SPECIES.filter((species) => !hasBit(player, species.bit)).length;
  }

  function carryingUncleanBones(player) {
    const inventory = player.getInventory();
    return SPECIES.some(
      (species) =>
        inventory.getAmount(species.dirty) > 0 || inventory.getAmount(species.vinegar) > 0
    );
  }

  function allBonesHandedIn(player) {
    return (bones(player) & ALL_BONES_MASK) === ALL_BONES_MASK;
  }

  /** This quest's durable stage on the varp shared with Rag and Bone Man I. */
  function wireValue(stage, player) {
    if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (stage >= STAGE_STARTED) return WIRE_STARTED;
    const previous = Number(player.getAttribute(RAG_AND_BONE_MAN_I_STAGE_ATTRIBUTE)) || 0;
    return previous >= RAG_AND_BONE_MAN_I_COMPLETE ? WIRE_STARTED : previous;
  }

  /** Which wish-list variant the current state calls for; also starts the quest. */
  function wishListVariant(player) {
    if (quest.isComplete(player)) {
      pendingHandIn.delete(player);
      return POST_QUEST_VARIANT;
    }
    if (quest.getStage(player) === 0) {
      quest.setStage(player, STAGE_STARTED);
      return PAGE_VARIANT_START;
    }
    if (allBonesHandedIn(player)) {
      pendingHandIn.delete(player);
      return PAGE_VARIANT_FINISHING;
    }
    const ready = readyBoneCount(player);
    if (ready > 0) {
      pendingHandIn.add(player);
      return ready === remainingBoneCount(player) ? PAGE_VARIANT_FINISHING : PAGE_VARIANT_HANDING_IN;
    }
    pendingHandIn.delete(player);
    if (carryingUncleanBones(player)) return PAGE_VARIANT_UNCLEAN;
    return PAGE_VARIANT_START;
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== ODD_OLD_MAN_NPC_ID) return null;
    if (!ragAndBoneManIComplete(player)) return null;
    return wishListVariant(player);
  }

  /**
   * Claims Talk-to once Rag and Bone Man I is complete: its plugin answers every
   * variant request with its post-quest conversation, so the II branch has to
   * replay the right page/variant itself.
   */
  function talkToOddOldMan(event) {
    const { player } = event;
    if (!ragAndBoneManIComplete(player)) return false;
    if (boneVoyageNeedsOddOldMan(player)) return false;
    const variant = wishListVariant(player);
    const page = variant === POST_QUEST_VARIANT ? ODD_OLD_MAN_PAGE : PAGE;
    return startTranscript(api, player, ODD_OLD_MAN_NPC_ID, page, variant);
  }

  function answerCondition({ npcId, player, stepId }) {
    if (npcId !== ODD_OLD_MAN_NPC_ID) return null;
    if (stepId === INVENTORY_FULL_CONDITION_ID) {
      return player.getInventory().getFreeSlots() < 2;
    }
    if (stepId === REPLACEMENT_HELM_CONDITION_ID) {
      return hasReward(player, BIT_REWARD_HELM) && !hasItem(player, RAM_SKULL_HELM_ITEM_ID);
    }
    if (stepId === REPLACEMENT_BONESACK_CONDITION_ID) {
      return hasReward(player, BIT_REWARD_BONESACK) && !hasItem(player, BONESACK_ITEM_ID);
    }
    if (stepId === EXCHANGE_HELM_CONDITION_ID) {
      return (
        hasReward(player, BIT_REWARD_HELM) &&
        !hasReward(player, BIT_REWARD_BONESACK) &&
        hasItem(player, RAM_SKULL_HELM_ITEM_ID)
      );
    }
    if (stepId === EXCHANGE_BONESACK_CONDITION_ID) {
      return (
        hasReward(player, BIT_REWARD_BONESACK) &&
        !hasReward(player, BIT_REWARD_HELM) &&
        hasItem(player, BONESACK_ITEM_ID)
      );
    }
    if (stepId === OWNS_BOTH_CONDITION_ID) {
      return hasItem(player, RAM_SKULL_HELM_ITEM_ID) && hasItem(player, BONESACK_ITEM_ID);
    }
    return null;
  }

  function handleDialogueLine(event) {
    if (event.npcId !== ODD_OLD_MAN_NPC_ID) return;
    if (event.text !== HAND_IN_LOOK_LINE) return;
    if (!questActive(event.player)) return;
    if (!pendingHandIn.has(event.player)) return;
    pendingHandIn.delete(event.player);
    handInBones(event.player);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (event.npcId !== ODD_OLD_MAN_NPC_ID) return;
    const choice = COMPLETION_ACTIONS.get(stepId);
    if (!choice) return;
    event.handled = true;
    event.end = true;
    if (quest.isComplete(player) || !allBonesHandedIn(player)) return;
    rewardChoices.set(player, choice);
    quest.complete(player);
  }

  function handleConditionEffect(event) {
    const { player, stepId } = event;
    if (event.npcId !== ODD_OLD_MAN_NPC_ID) return;
    if (!quest.isComplete(player)) return;
    if (stepId === REPLACEMENT_HELM_CONDITION_ID) {
      if (!hasItem(player, RAM_SKULL_HELM_ITEM_ID)) giveItem(player, RAM_SKULL_HELM_ITEM_ID);
      return;
    }
    if (stepId === REPLACEMENT_BONESACK_CONDITION_ID) {
      if (!hasItem(player, BONESACK_ITEM_ID)) giveItem(player, BONESACK_ITEM_ID);
    }
  }

  function exchangeReward(player, fromItemId, toItemId, rewardBits) {
    const inventory = player.getInventory();
    const fromItemIsCarried = inventory.getAmount(fromItemId) > 0;
    if (!fromItemIsCarried && inventory.getFreeSlots() <= 0) {
      player.sendMessage("You need more inventory space to exchange the reward.");
      return false;
    }
    if (!removeItem(player, fromItemId)) return;
    if (!inventory.adds(toItemId, 1)) {
      // Preserve the original reward if capacity changes between preflight and receipt.
      giveItem(player, fromItemId);
      player.sendMessage("You need more inventory space to exchange the reward.");
      return false;
    }
    player.setAttribute(REWARDS_ATTRIBUTE, rewardBits);
    return true;
  }

  function handleChoice(event) {
    const { player, option } = event;
    if (event.npcId !== ODD_OLD_MAN_NPC_ID || !quest.isComplete(player)) return;
    if (option === EXCHANGE_HELM_FOR_BONESACK_OPTION) {
      exchangeReward(player, RAM_SKULL_HELM_ITEM_ID, BONESACK_ITEM_ID, BIT_REWARD_BONESACK);
      return;
    }
    if (option === EXCHANGE_BONESACK_FOR_HELM_OPTION) {
      exchangeReward(player, BONESACK_ITEM_ID, RAM_SKULL_HELM_ITEM_ID, BIT_REWARD_HELM);
      return;
    }
    if (option === BOTH_BONESACK_OPTION) {
      if (!hasItem(player, BONESACK_ITEM_ID)) giveItem(player, BONESACK_ITEM_ID);
      player.setAttribute(REWARDS_ATTRIBUTE, rewards(player) | BIT_REWARD_BONESACK);
      return;
    }
    if (option === BOTH_HELM_OPTION) {
      if (!hasItem(player, RAM_SKULL_HELM_ITEM_ID)) giveItem(player, RAM_SKULL_HELM_ITEM_ID);
      player.setAttribute(REWARDS_ATTRIBUTE, rewards(player) | BIT_REWARD_HELM);
    }
  }

  function handleNpcDeath(event) {
    const { killer, npc } = event;
    if (!killer || !npc) return;
    const npcId = Number.isInteger(event.npcId) ? event.npcId : npc.getId?.();
    if (!Number.isInteger(npcId)) return;
    const species = SPECIES_BY_NPC_ID.get(npcId);
    if (!species) return;
    if (!questActive(killer) || hasBit(killer, species.bit)) return;
    if (Math.floor(Math.random() * DROP_DENOMINATOR) !== 0) return;
    api.getItemOnGroundManager().registerLocation(killer, new Item(species.dirty, 1), npc.getLocation());
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const species = SPECIES_BY_DIRTY_ID.get(usedItemId) ?? SPECIES_BY_DIRTY_ID.get(usedWithItemId);
    if (!species) return;
    const otherItemId = usedItemId === species.dirty ? usedWithItemId : usedItemId;
    if (otherItemId !== POT_OF_VINEGAR_ITEM_ID) return;
    const inventory = player.getInventory();
    if (inventory.getAmount(species.dirty) <= 0 || inventory.getAmount(POT_OF_VINEGAR_ITEM_ID) <= 0) return;
    event.handled = true;
    inventory.deleteNumber(species.dirty, 1);
    inventory.deleteNumber(POT_OF_VINEGAR_ITEM_ID, 1);
    inventory.adds(species.vinegar, 1);
    player.sendMessage("You put the bone in the pot of vinegar.");
  }

  /** The first quest's boiler handler owns logs, tinderbox, timer, Remove-Pot and Remove-Bone. */
  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const species = SPECIES_BY_VINEGAR_ID.get(itemId);
    if (!species) return;
    if (!questActive(player)) return;
    api.emitCustomEvent(LOAD_SHARED_VINEGAR_BONE_EVENT, {
      event,
      bone: { vinegar: species.vinegar, cleaned: species.clean },
    });
  }

  function buildJournal(player, questHandle) {
    if (questHandle.isComplete(player)) {
      return [
        "<str>I collected every bone on the Odd Old Man's wish list</str>",
        "<str>and he added them to his museum collection.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (questHandle.getStage(player) >= STAGE_STARTED) {
      const lines = [
        "The <col=800000>Odd Old Man</col> gave me a wish list of",
        "bones he needs for his museum collection:",
        "",
      ];
      for (const species of SPECIES) {
        lines.push(hasBit(player, species.bit) ? `<str>${species.label}</str>` : species.label);
      }
      lines.push("", "I should clean the bones in his pot-boiler and", "bring them back to him.");
      return lines;
    }
    return [
      "I can start this quest by talking to the",
      "<col=800000>Odd Old Man</col> by the Limestone Mine",
      "north-east of <col=800000>Varrock</col>.",
      "",
      "I must have completed <col=800000>Rag and Bone Man I</col>.",
    ];
  }

  function grantRewards(player) {
    const choice = rewardChoices.get(player) ?? "bonesack";
    rewardChoices.delete(player);
    let rewardBits = 0;
    if (choice === "helm" || choice === "both") {
      giveItem(player, RAM_SKULL_HELM_ITEM_ID);
      rewardBits |= BIT_REWARD_HELM;
    }
    if (choice === "bonesack" || choice === "both") {
      giveItem(player, BONESACK_ITEM_ID);
      rewardBits |= BIT_REWARD_BONESACK;
    }
    player.setAttribute(REWARDS_ATTRIBUTE, rewardBits);
    player.getSkillManager().addExperiences(Skill.PRAYER, PRAYER_XP);
  }

  function completionScrollItemId(player) {
    return hasReward(player, BIT_REWARD_HELM) ? RAM_SKULL_HELM_ITEM_ID : BONESACK_ITEM_ID;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(BONES_ATTRIBUTE);
  api.persistAttribute(REWARDS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "rag_and_bone_man_ii",
    name: "Rag and Bone Man II",
    varpId: VARP_RAG_AND_BONE_MAN,
    varpValue: wireValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: PRAYER_XP, label: "Prayer" }],
    scrollItemId: completionScrollItemId,
    rewardItemLabel: "A bonesack or ram skull helm",
    buildJournal,
    onReward: grantRewards,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(ODD_OLD_MAN_NPC_NAME, { "Talk-to": talkToOddOldMan });
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEffect);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onNpcDeath(handleNpcDeath);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onPlayerLogin(handleLogin);
};
