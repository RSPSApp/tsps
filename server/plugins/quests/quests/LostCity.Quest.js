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
 * The tree spirit and Shamus are spawned owner-only per player, reused on
 * repeated chops, and reaped on logout and quest completion.
 * The warrior has a separate post-quest transcript; the other adventurers reuse
 * their after-shamus lines because the dump has no post-quest variant for them.
 *
 * Entrana.plugin owns the shared ferry search and boat travel. The Cave monk's
 * warning and one-way dungeon ladder remain part of this quest's route.
 */
module.exports = function registerLostCityQuest(api) {
  const {
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Equipment,
    Location,
    Animation,
    CacheDefinitions,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

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

  // One-way ladder 2408 at 2820,3374 and Cave monk 1164 both land here; 2820,9774
  // itself is blocked map data.
  const ENTRANA_DUNGEON_LANDING = { x: 2822, y: 9774, z: 0 };

  const CAVE_DESCENT_ACTION_ID = "u31XRz";
  const ENTRANA_LADDER_OBJECT_ID = 2408;
  const ENTRANA_LADDER_TILE = { x: 2820, y: 3374, z: 0 };

  /** Owner-only quest NPCs by player, so a repeat chop reuses one and logout/complete reaps it. */
  const spawnedByPlayer = new WeakMap();

  const START_HOOK = "quest:lost-city:start";

  let quest;
  let pluginApi;

  function trackedNpc(player, key) {
    const npc = spawnedByPlayer.get(player)?.[key];
    if (!npc) return null;
    return typeof npc.isRegistered === "function" && !npc.isRegistered() ? null : npc;
  }

  function spawnTrackedNpc(player, key, definition) {
    const existing = trackedNpc(player, key);
    if (existing) return existing;
    const npc = pluginApi.spawnNpc(definition);
    if (!npc) return null;
    const state = spawnedByPlayer.get(player) ?? {};
    state[key] = npc;
    spawnedByPlayer.set(player, state);
    return npc;
  }

  function clearTrackedNpc(player, key) {
    const state = spawnedByPlayer.get(player);
    if (!state) return;
    const npc = state[key];
    state[key] = null;
    if (npc && (typeof npc.isRegistered !== "function" || npc.isRegistered())) pluginApi.removeNpc(npc);
  }

  function reapTrackedNpcs(player) {
    clearTrackedNpc(player, "shamus");
    clearTrackedNpc(player, "spirit");
    spawnedByPlayer.delete(player);
  }

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAxe = (player) => AXE_ITEM_IDS.some((id) => hasItem(player, id)
    || player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === id);
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

  /** Wiki: 31 Crafting and 36 Woodcutting. */
  const REQUIRED_SKILLS = [
    { skill: Skill.CRAFTING, level: 31, label: "Crafting" },
    { skill: Skill.WOODCUTTING, level: 36, label: "Woodcutting" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("lower than 45 combat")) {
      return (
        player.getSkillManager().getCombatLevel() < 45 &&
        missingSkillRequirements(player).length > 0
      );
    }
    return null;
  }

  function adventurerVariant(stage, firstVariant, againVariant, afterShamusVariant) {
    if (stage >= STAGE_SPOKEN_SHAMUS) return afterShamusVariant;
    if (stage >= STAGE_STARTED) return againVariant;
    return firstVariant;
  }

  function shamusVariant(stage, player) {
    if (stage >= STAGE_SPOKEN_SHAMUS) return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-subsequent-talks";
    if (stage >= STAGE_STARTED) {
      return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-first-talk";
    }
    return "talking-to-a-tool-leprechaun-leprechaun-in-a-tree-talking-to-shamus-before-starting-the-quest";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    switch (npcId) {
      case WARRIOR_NPC_ID:
        if (stage >= STAGE_COMPLETE) return { page: "Warrior (Lost City)", variant: "standard-dialogue-after-lost-city" };
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
        return { page: "Cave monk", variant: "standard-dialogue" };
      default:
        if (TOOL_LEPRECHAUN_NPC_IDS.has(npcId)) return "talking-to-a-tool-leprechaun";
        return null;
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== WARRIOR_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (missingSkillRequirements(player).length > 0) {
        notifySkillRequirements(player);
        return;
      }
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleTreeSpiritDeath({ killer, npcId, npc }) {
    if (npcId !== TREE_SPIRIT_NPC_ID || !killer) return;
    const state = spawnedByPlayer.get(killer);
    if (!npc || state?.spirit !== npc) return;
    state.spirit = null;
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
    spawnTrackedNpc(player, "shamus", {
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
      spawnTrackedNpc(player, "spirit", {
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
    api.emitCustomEvent("woodcutting:chop", {
      player, object: event.object, logId: DRAMEN_BRANCH_ITEM_ID, handled: false,
    });
    event.handled = true;
  }

  function handleWoodcuttingSuccess({ player, logId }) {
    if (logId === DRAMEN_BRANCH_ITEM_ID && quest.getStage(player) === STAGE_SPIRIT_DEFEATED) {
      quest.setStage(player, STAGE_TREE_CHOPPED);
    }
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
    player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_fletching")));
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
    reapTrackedNpcs(player);
    event.handled = true;
  }

  /** Shamus directions and the Cave monk's one-way descent. */
  function handleDialogueAction(event) {
    if (event.handled) return;
    const { player } = event;
    const stepId = event.stepId ?? event.step?.id;
    if (!player || !stepId) return;
    if ((stepId === "qdoJ9W" || stepId === "OyPO7t") && event.npcId === SHAMUS_NPC_ID) {
      if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_SHAMUS);
      clearTrackedNpc(player, "shamus");
      event.handled = true;
      return;
    }
    if (stepId === CAVE_DESCENT_ACTION_ID) {
      if (event.npcId !== CAVE_MONK_NPC_ID) return;
      player.moveTo(new Location(ENTRANA_DUNGEON_LANDING.x, ENTRANA_DUNGEON_LANDING.y, ENTRANA_DUNGEON_LANDING.z));
      event.handled = true;
    }
  }

  /** Ladder 2408 has no pair in the cache; play the Cave monk's descent warning. */
  function claimEntranaLadder(request) {
    if (request.handled || request.objectId !== ENTRANA_LADDER_OBJECT_ID) return;
    const at = request.object?.getLocation?.();
    if (!at || at.getX() !== ENTRANA_LADDER_TILE.x || at.getY() !== ENTRANA_LADDER_TILE.y
      || at.getZ() !== ENTRANA_LADDER_TILE.z) return;
    request.handled = true;
    startTranscript(pluginApi, request.player, CAVE_MONK_NPC_ID, "Cave monk", "when-trying-to-go-down-the-ladder");
  }

  function handleLogout({ player }) {
    if (player) reapTrackedNpcs(player);
  }

  pluginApi = api;
  quest = registerQuest(api, {
    key: "lost_city",
    name: "Lost City",
    varpId: VARP_LOST_CITY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    scrollItemId: DRAMEN_STAFF_ITEM_ID,
    otherRewards: [
      "Access to Zanaris",
      "Ability to craft Cosmic Runes",
      "Ability to buy and wield Dragon Daggers & Longswords",
    ],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("ladders:climb", claimEntranaLadder);
  api.onCustomEvent("woodcutting:success", handleWoodcuttingSuccess);
  api.onNpcDeath(handleTreeSpiritDeath);
  api.onPlayerLogout(handleLogout);
  api.onObjectInteraction(handleTreeChop);
  api.onObjectInteraction(handleDramenTreeChop);
  api.onObjectInteraction(handleZanarisDoor);
  api.onItemOnItem(handleStaffCraft);
};
