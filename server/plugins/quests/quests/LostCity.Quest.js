/**
 * Lost City (members).
 *
 * The four adventurers in Lumbridge Swamp (archer 1157, warrior 1158, monk 1159,
 * wizard 1160), Shamus (1162), the cave monk (1164) and the tool leprechauns are
 * indexed on the "Lost City" transcript page, so their talk is transcript-driven;
 * this plugin selects the variant by stage and answers the page's one prose
 * condition. The tree spirit (1163) is indexed but not spoken to; its defeat is
 * wired through onNpcDeath.
 *
 * The gathering gameplay is supplied here: chopping the leprechaun tree spawns
 * Shamus, chopping the Dramen tree spawns the tree spirit then yields a branch,
 * a knife carves the branch into a staff, and opening the Zanaris shed door while
 * wielding the staff teleports to Zanaris and completes the quest.
 *
 * Stages (varp 147): 1 started, 2 spoken to Shamus, 3 spirit defeated,
 * 4 branch chopped, 5 staff made, 6 complete.
 *
 * Gaps (no dump support): the reference's combat-45/skills warning is answered
 * from live stats; the tree spirit and Shamus are spawned owner-only and not
 * reaped on logout. The warrior/archer/monk/wizard post-shamus lines are reused
 * once the branch exists (the dump has no separate post-quest adventurer text).
 */
module.exports = function registerLostCityQuest(api) {
  const {
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Equipment,
    Location,
  } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const PAGE = "Lost City";

  const ARCHER_NPC_ID = NpcIdentifiers.ARCHER;
  const WARRIOR_NPC_ID = NpcIdentifiers.WARRIOR;
  const MONK_NPC_ID = NpcIdentifiers.MONK_9;
  const WIZARD_NPC_ID = NpcIdentifiers.WIZARD;
  const SHAMUS_NPC_ID = NpcIdentifiers.SHAMUS;
  const TREE_SPIRIT_NPC_ID = NpcIdentifiers.TREE_SPIRIT;
  const CAVE_MONK_NPC_ID = NpcIdentifiers.CAVE_MONK;
  const TOOL_LEPRECHAUN_NPC_IDS = new Set([
    NpcIdentifiers.TOOL_LEPRECHAUN_3,
    NpcIdentifiers.TOOL_LEPRECHAUN_4,
    NpcIdentifiers.TOOL_LEPRECHAUN_5,
  ]);

  const VARP_LOST_CITY = 147;
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_SHAMUS = 2;
  const STAGE_SPIRIT_DEFEATED = 3;
  const STAGE_TREE_CHOPPED = 4;
  const STAGE_STAFF_MADE = 5;
  const STAGE_COMPLETE = 6;

  const DRAMEN_BRANCH_ITEM_ID = ItemIdentifiers.DRAMEN_BRANCH;
  const DRAMEN_STAFF_ITEM_ID = ItemIdentifiers.DRAMEN_STAFF;
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE;

  const AXE_ITEM_IDS = [
    ItemIdentifiers.BRONZE_AXE,
    ItemIdentifiers.IRON_AXE,
    ItemIdentifiers.STEEL_AXE,
    ItemIdentifiers.BLACK_AXE,
    ItemIdentifiers.MITHRIL_AXE,
    ItemIdentifiers.ADAMANT_AXE,
    ItemIdentifiers.RUNE_AXE,
    ItemIdentifiers.DRAGON_AXE,
    ItemIdentifiers.INFERNAL_AXE,
    ItemIdentifiers._3RD_AGE_AXE,
    ItemIdentifiers.CRYSTAL_AXE,
    ItemIdentifiers.DRAGON_FELLING_AXE,
  ];

  const LEPRECHAUN_TREE_LOC_ID = ObjectIdentifiers.TREE_12;
  const DRAMEN_TREE_LOC_ID = ObjectIdentifiers.DRAMEN_TREE;
  const ZANARIS_DOOR_LOC_ID = ObjectIdentifiers.DOOR_72;

  const SHAMUS_TILE = { x: 3139, y: 3211, z: 0 };
  const TREE_SPIRIT_TILE = { x: 2860, y: 9737, z: 0 };
  const ZANARIS_TILE = { x: 2452, y: 4473, z: 0 };

  const START_HOOK = "quest:lost-city:start";

  let quest;
  let pluginApi;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAxe = (player) => AXE_ITEM_IDS.some((id) => hasItem(player, id));
  const woodcuttingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.WOODCUTTING);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>An adventurer revealed that a leprechaun knows the way to Zanaris.</str>",
        "<str>I entered Zanaris through the swamp shed.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STAFF_MADE) {
      return [
        "<str>I made a Dramen staff.</str>",
        "I should wield it and enter the <col=800000>shed in Lumbridge Swamp</col>.",
      ];
    }
    if (stage >= STAGE_TREE_CHOPPED) {
      return [
        "<str>I defeated the Tree spirit and cut a Dramen branch.</str>",
        "I should carve the branch into a staff with a <col=800000>knife</col>.",
      ];
    }
    if (stage >= STAGE_SPIRIT_DEFEATED) {
      return [
        "<str>I defeated the Tree spirit.</str>",
        "I can now cut a <col=800000>Dramen branch</col> from the tree.",
      ];
    }
    if (stage >= STAGE_SPOKEN_SHAMUS) {
      return [
        "<str>An adventurer revealed that a leprechaun knows the way to Zanaris.</str>",
        "Shamus told me to obtain a branch from the <col=800000>Dramen tree</col>",
        "beneath Entrana.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>An adventurer revealed that a leprechaun knows the way to Zanaris.</str>",
        "I should chop the unusual <col=800000>trees</col> near the swamp camp",
        "to find him.",
      ];
    }
    return [
      "I can start this quest by speaking to the <col=800000>adventurers</col>",
      "in Lumbridge Swamp.",
      "",
      "Level 31 Crafting",
      "Level 36 Woodcutting",
      "I must defeat a spirit without bringing weapons to Entrana.",
    ];
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("lower than 45 combat")) {
      const skills = player.getSkillManager();
      const combat = typeof skills.getCombatLevel === "function" ? skills.getCombatLevel() : 999;
      const crafting = skills.getCurrentLevel(Skill.CRAFTING);
      const woodcutting = skills.getCurrentLevel(Skill.WOODCUTTING);
      return combat < 45 && (crafting >= 31 || woodcutting >= 36);
    }
    return null;
  }

  function adventurerVariant(stage, firstVariant, againVariant, afterShamusVariant) {
    if (stage >= STAGE_SPIRIT_DEFEATED) return afterShamusVariant;
    if (stage >= STAGE_STARTED) return againVariant;
    return firstVariant;
  }

  function shamusVariant(stage, player) {
    if (stage >= STAGE_SPIRIT_DEFEATED) return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-subsequent-talks";
    if (stage >= STAGE_SPOKEN_SHAMUS) return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-attempting-to-chop-the-tree-after-shamus-has-appeared";
    if (stage >= STAGE_STARTED) {
      quest.setStage(player, STAGE_SPOKEN_SHAMUS);
      return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-first-talk";
    }
    return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-shamus-before-starting-the-quest";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    switch (npcId) {
      case WARRIOR_NPC_ID:
        return adventurerVariant(
          stage,
          "starting-out-adventurer-camp-warrior",
          "starting-out-adventurer-camp-talking-to-warrior-again-after-learning-about-zanaris",
          "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-warrior-after-talking-to-shamus"
        );
      case ARCHER_NPC_ID:
        return adventurerVariant(
          stage,
          "starting-out-adventurer-camp-archer",
          "starting-out-adventurer-camp-talking-to-archer-again-after-learning-about-zanaris",
          "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-archer-after-talking-to-shamus"
        );
      case MONK_NPC_ID:
        return adventurerVariant(
          stage,
          "starting-out-adventurer-camp-monk",
          "starting-out-adventurer-camp-talking-to-monk-again-after-learning-about-zanaris",
          "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-monk-after-talking-to-shamus"
        );
      case WIZARD_NPC_ID:
        return adventurerVariant(
          stage,
          "starting-out-adventurer-camp-wizard",
          "starting-out-adventurer-camp-talking-to-wizard-again-after-learning-about-zanaris",
          "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-wizard-after-talking-to-shamus"
        );
      case SHAMUS_NPC_ID:
        return shamusVariant(stage, player);
      case CAVE_MONK_NPC_ID:
        return "the-island-of-entrana-cave-monk";
      default:
        if (TOOL_LEPRECHAUN_NPC_IDS.has(npcId)) return "talking-to-a-tool-leprechaun";
        return null;
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== WARRIOR_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleTreeSpiritDeath({ killer, npcId }) {
    if (npcId !== TREE_SPIRIT_NPC_ID || !killer) return;
    if (quest.getStage(killer) === STAGE_SPOKEN_SHAMUS) {
      quest.setStage(killer, STAGE_SPIRIT_DEFEATED);
      killer.sendMessage("With the Tree spirit defeated, you may now chop the tree.");
    }
  }

  /** Chopping the leprechaun's tree flushes Shamus out. */
  function handleTreeChop(event) {
    if (event.objectId !== LEPRECHAUN_TREE_LOC_ID) return;
    const { player } = event;
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop this tree.");
      event.handled = true;
      return;
    }
    if (quest.getStage(player) !== STAGE_STARTED) {
      player.sendMessage("It looks like an ordinary tree.");
      event.handled = true;
      return;
    }
    pluginApi.spawnNpc({
      id: SHAMUS_NPC_ID,
      ...SHAMUS_TILE,
      wanderRadius: 5,
      owner: player,
      ownerOnly: true,
    });
    player.sendMessage("A leprechaun jumps out of the tree!");
    event.handled = true;
  }

  /** Chopping the Dramen tree spawns the spirit, then yields a branch. */
  function handleDramenTreeChop(event) {
    if (event.objectId !== DRAMEN_TREE_LOC_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_SHAMUS) {
      player.sendMessage("The tree has an ominous aura. You cannot bring yourself to chop it.");
      event.handled = true;
      return;
    }
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to chop this tree.");
      event.handled = true;
      return;
    }
    if (woodcuttingLevel(player) < 36) {
      player.sendMessage("You need level 36 Woodcutting to chop this tree.");
      event.handled = true;
      return;
    }
    if (stage === STAGE_SPOKEN_SHAMUS) {
      pluginApi.spawnNpc({
        id: TREE_SPIRIT_NPC_ID,
        ...TREE_SPIRIT_TILE,
        owner: player,
        ownerOnly: true,
      });
      player.sendMessage("A Tree spirit appears: 'You must defeat me before touching the tree!'");
      event.handled = true;
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(DRAMEN_BRANCH_ITEM_ID, 1);
    if (stage === STAGE_SPIRIT_DEFEATED) quest.setStage(player, STAGE_TREE_CHOPPED);
    player.sendMessage("You cut a branch from the Dramen tree.");
    event.handled = true;
  }

  function handleStaffCraft(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(KNIFE_ITEM_ID) || !ids.includes(DRAMEN_BRANCH_ITEM_ID)) return;
    const { player } = event;
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 31) {
      player.sendMessage("You need level 31 Crafting to carve a Dramen staff.");
      event.handled = true;
      return;
    }
    player.getInventory().deleteNumber(DRAMEN_BRANCH_ITEM_ID, 1);
    player.getInventory().adds(DRAMEN_STAFF_ITEM_ID, 1);
    if (quest.getStage(player) === STAGE_TREE_CHOPPED) quest.setStage(player, STAGE_STAFF_MADE);
    player.sendMessage("You carve the branch into a Dramen staff.");
    event.handled = true;
  }

  /** The shed door only opens for a wielded Dramen staff. */
  function handleZanarisDoor(event) {
    if (event.objectId !== ZANARIS_DOOR_LOC_ID) return;
    const { player } = event;
    const wielded = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.();
    if (wielded !== DRAMEN_STAFF_ITEM_ID) return;
    if (quest.getStage(player) < STAGE_STAFF_MADE) {
      player.sendMessage("The staff does not yet respond to this doorway.");
      event.handled = true;
      return;
    }
    player.sendMessage("The world starts to shimmer...");
    player.moveTo(new Location(ZANARIS_TILE.x, ZANARIS_TILE.y, ZANARIS_TILE.z));
    if (!quest.isComplete(player)) quest.complete(player);
    event.handled = true;
  }

  pluginApi = api;
  quest = registerQuest(api, {
    key: "lost_city",
    name: "Lost City",
    varpId: VARP_LOST_CITY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    rewardItemId: DRAMEN_STAFF_ITEM_ID,
    rewardItemLabel: "A Dramen staff",
    otherRewards: ["Access to Zanaris", "Ability to wield a Dramen staff"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onNpcDeath(handleTreeSpiritDeath);
  api.onObjectInteraction(handleTreeChop);
  api.onObjectInteraction(handleDramenTreeChop);
  api.onObjectInteraction(handleZanarisDoor);
  api.onItemOnItem(handleStaffCraft);
};
