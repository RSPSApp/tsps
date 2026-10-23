/** Getting Ahead: recorded dialogue boundaries, crafting, encounter and final inspection.
* RSProx1692 (rev226); current-cache ids. See docs/p2p-kourend-parity.md.
*/
module.exports = function registerGettingAheadQuest(api) {
  const { Animation, Boundary, CountdownTask, TaskManager, TemplatedInstanceArea, StatementDialogue, DialogueChainBuilder, ActionDialogue, GameObject, ObjectManager, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill, MeleeCombatMethod, Graphic, HitDamage, HitMask, PrivateArea, Equipment } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const PAGE = "Getting Ahead";
  const GORDON_PAGE = "Gordon";
  const MARY_PAGE = "Mary (Getting Ahead)";
  const START_HOOK = "quest:getting-ahead:start";
  const GORDON_NPC_ID = NpcIdentifiers.GORDON; // 10500
  const GORDON_NPC_IDS = new Set([NpcIdentifiers.GORDON, NpcIdentifiers.GORDON_2]);
  const MARY_NPC_IDS = new Set([
    NpcIdentifiers.MARY_2, // 10502, the spawned transform of 8597
    NpcIdentifiers.MARY_3,
    NpcIdentifiers.MARY_4,
  ]);
  const SERGEANT_NPC_IDS = new Set([
    NpcIdentifiers.SERGEANT_3, // 8600
    NpcIdentifiers.SERGEANT_4, // 10505
    NpcIdentifiers.SERGEANT_5, // 10725
  ]);
  const HEADLESS_BEAST_NPC_ID = NpcIdentifiers.HEADLESS_BEAST_2; // 10506, ga_beast
  const VARP_GETTING_AHEAD = 2851; // ga_main
  const VARBIT_GETTING_AHEAD = 693; // ga, bits 0-5
  const VARBIT_COINS_RECEIVED = 694; // ga_reward, varp 2851 bit 6
  const STAGE_STARTED = 2;
  const STAGE_MARY_TALK = 4;
  const LEGACY_STAGE_FLOUR_POURING = 6;
  const STAGE_FLOUR_POURED = 8;
  const STAGE_FLOUR_TRAIL = 10;
  const STAGE_LAIR_ENTERED = 12;
  const STAGE_BEAST_KILLED = 14;
  const STAGE_GORDON_REFUSED = 16;
  const STAGE_MARY_FAKE = 18;
  const STAGE_CLAY_MADE = 20;
  const STAGE_CLAY_SHOWN = 22;
  const STAGE_FUR_MADE = 24;
  const STAGE_FUR_SHOWN = 26;
  const STAGE_BLOODY_MADE = 28;
  const STAGE_BLOODY_SHOWN = 30;
  const STAGE_MOUNTED = 32;
  const STAGE_COMPLETE = 34;
  const CRAFTING_LEVEL = 30;
  const CONSTRUCTION_LEVEL = 26;
  const CRAFTING_XP = 4000;
  const CONSTRUCTION_XP = 3200;
  const COINS_REWARD = 3000;
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const POT_OF_FLOUR_ITEM_ID = ItemIdentifiers.POT_OF_FLOUR; // 1933
  const POT_ITEM_ID = ItemIdentifiers.POT; // 1931
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const SOFT_CLAY_ITEM_ID = ItemIdentifiers.SOFT_CLAY; // 1761
  const RED_DYE_ITEM_ID = ItemIdentifiers.RED_DYE; // 1763
  const CLAY_HEAD_ITEM_ID = ItemIdentifiers.CLAY_HEAD; // 25145
  const FUR_HEAD_ITEM_ID = ItemIdentifiers.FUR_HEAD; // 25146
  const BLOODY_HEAD_ITEM_ID = ItemIdentifiers.BLOODY_HEAD; // 25147
  const NEILANS_JOURNAL_ITEM_ID = ItemIdentifiers.NEILANS_JOURNAL; // 25152
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const NEEDLE_ITEM_ID = ItemIdentifiers.NEEDLE; // 1733
  const THREAD_ITEM_ID = ItemIdentifiers.THREAD; // 1734
  const FUR_ITEM_IDS = [
    ItemIdentifiers.BEAR_FUR, // 948
    ItemIdentifiers.GREY_WOLF_FUR, // 958
    ItemIdentifiers.FUR, // 6814
  ];
  const BLOOD_ITEM_IDS = [ItemIdentifiers.VIAL_OF_BLOOD, ItemIdentifiers.BLOOD_PINT];
  const HAMMER_ITEM_IDS = [ItemIdentifiers.HAMMER, ItemIdentifiers.IMCANDO_HAMMER, ItemIdentifiers.IMCANDO_HAMMER_OFF_HAND_];
  const SAW_ITEM_IDS = [
    ItemIdentifiers.SAW,
    ItemIdentifiers.CRYSTAL_SAW,
    ItemIdentifiers.AMYS_SAW,
    ItemIdentifiers.AMYS_SAW_OFF_HAND_,
  ];
  const NAIL_ITEM_IDS = [
    ItemIdentifiers.BRONZE_NAILS, // 4819
    ItemIdentifiers.IRON_NAILS, // 4820
    ItemIdentifiers.STEEL_NAILS, // 1539
    ItemIdentifiers.BLACK_NAILS, // 4821
    ItemIdentifiers.MITHRIL_NAILS, // 4822
    ItemIdentifiers.ADAMANTITE_NAILS, // 4823
    ItemIdentifiers.RUNE_NAILS, // 4824
    ItemIdentifiers.DRAGON_NAILS,
  ].reverse(); // OSRS uses the strongest carried nails first.
  const NAIL_BEND_BASE = [5,10,15,20,25,30,35,40]; // Dragon through bronze, estimated percent at level1.
  const BEAST_STOMP_ANIMATION = 8835, BEAST_ROCK_GRAPHIC = 317;
  const BOULDER_FLIGHT_TICKS = 4;
  const boulderAttack = new WeakSet();
  // ga_fencegate_l/r, the two leaves of the cattle gate (no generated constant).
  const FENCE_GATE_OBJECT_IDS = new Set([40427, 40428]);
  // ga_mounted_head, the map loc that transforms into the Mounted Head Space.
  const MOUNTED_HEAD_OBJECT_ID = 20858;
  const HEAD_MODEL_BY_STEP = new Map([
    ["wT3s4c", 25148], ["jl91sv", 25148], ["w0k-Ii", 25148],
    ["9iNdir", 25149], ["o0A-RH", 25149], ["OPtAA-", 25149],
    ["_RfAUL", 25150], ["ILAeKi", 25150], ["fvoksk", 25150],
  ]); // Cache ga_clayhead_large / ga_furhead_large / ga_bloodhead_large.
  const CAVE_ENTER_TILE = { x: 1211, y: 3646 };
  const CAVE_EXIT_TILE = { x: 1189, y: 10029 };
  const CAVE_INSIDE_TILE = { x: 1190, y: 10028, z: 0 };
  const CAVE_OUTSIDE_TILE = { x: 1212, y: 3648, z: 0 };
  const BEAST_TILE = { x: 1187, y: 10020, z: 0 };
  // Condition step ids on the "Getting Ahead" and "Gordon" pages.
  const REQUIREMENTS_MISSING_CONDITION_ID = "F1Rypv";
  const REQUIREMENTS_MET_CONDITION_ID = "-vnUdk";
  const COINS_RECEIVED_CONDITION_ID = "Ve-vo0";
  const COINS_MISSING_CONDITION_ID = "ybriIj";
  // Action/message step ids that move the stage.
  const COMPLETE_MESSAGE_ID = "ORkcay";
  const RECLAIM_COINS_ACTION_ID = "eJJth4";
  const STAGE_BY_STEP_ID = new Map([
    ["pL8hVR", STAGE_FLOUR_POURED], // You pour some flour over the gate.
    ["wT3s4c", STAGE_CLAY_MADE], // You sculpt the clay into the shape of a head.
    ["9iNdir", STAGE_FUR_MADE], // You attach the fur to the clay head.
    ["_RfAUL", STAGE_BLOODY_MADE], // You dye the fur head red.
  ]);
  const SHOW_VARIANTS = new Map([
    [CLAY_HEAD_ITEM_ID, "a-strange-fake-talking-to-gordon-after-making-the-clay-head"],
    [FUR_HEAD_ITEM_ID, "a-strange-fake-talking-to-gordon-after-making-the-fur-head"],
    [BLOODY_HEAD_ITEM_ID, "a-strange-fake-talking-to-gordon-after-making-the-bloody-head"],
    [NEILANS_JOURNAL_ITEM_ID, "a-strange-beast-using-items-on-gordon-neilan-s-journal"],
    [ItemIdentifiers.NEILANS_JOURNAL_2, "a-strange-beast-using-items-on-gordon-neilan-s-journal"],
    [ItemIdentifiers.BIG_BONES, "a-strange-beast-using-items-on-gordon-big-bones"],
    [ItemIdentifiers.BIG_BONES_2, "a-strange-beast-using-items-on-gordon-big-bones"],
    [ItemIdentifiers.ENSOULED_BEAR_HEAD, "a-strange-beast-using-items-on-gordon-ensouled-bear-head"],
    [ItemIdentifiers.ENSOULED_BEAR_HEAD_2, "a-strange-beast-using-items-on-gordon-ensouled-bear-head"],
    [ItemIdentifiers.ENSOULED_BEAR_HEAD_3, "a-strange-beast-using-items-on-gordon-ensouled-bear-head"],
    [ItemIdentifiers.ENSOULED_BEAR_HEAD_4, "a-strange-beast-using-items-on-gordon-ensouled-bear-head"],
    [ItemIdentifiers.BEARHEAD, "a-strange-beast-using-items-on-gordon-bearhead"],
    [ItemIdentifiers.BEARHEAD_2, "a-strange-beast-using-items-on-gordon-bearhead"],
  ]);
  const HEAD_SHOW_WINDOW = new Map([
    [CLAY_HEAD_ITEM_ID, [STAGE_CLAY_MADE, STAGE_CLAY_SHOWN]],
    [FUR_HEAD_ITEM_ID, [STAGE_FUR_MADE, STAGE_FUR_SHOWN]],
    [BLOODY_HEAD_ITEM_ID, [STAGE_BLOODY_MADE, STAGE_BLOODY_SHOWN]],
  ]);
  const MET_GORDON_ATTRIBUTE = "quest.getting_ahead.met-gordon";
  const COINS_PENDING_ATTRIBUTE = "quest.getting_ahead.coins-pending";
  const COINS_CLAIMED_ATTRIBUTE = "getting-ahead:coins-claimed";
  const PICKAXE_TAKEN_ATTRIBUTE = "quest.getting_ahead.pickaxe-taken";
  const NAILS_TAKEN_ATTRIBUTE = "getting-ahead:nails-taken";
  const FINISH_PENDING_ATTRIBUTE = "getting-ahead:inspection-pending";
  const TANNING_UNLOCKED_ATTRIBUTE = "getting-ahead:tanning-unlocked";
  const BEASTS = new WeakMap(), lairs = new WeakMap(), actions = new WeakMap(), scenes = new WeakMap();
  const FLOATER_UID = (161 << 16) | 1;
  const STAGE_BY_LINE = new Map([
    ["Oh! I have an idea! If this beast ended up getting coated in flour, it wouldn't be hard for you to track it back to its home.", STAGE_MARY_TALK],
    ["Well if you manage to get hold of the beast's head, let me know. Until then, I can't pay you.", STAGE_GORDON_REFUSED],
    ["That's the spirit! I've tried my hand at clay modelling in the past. You can make all sorts of things. Just get some soft clay and a knife and I'm sure you'll be able to make a lovely head.", STAGE_MARY_FAKE],
    ["Quite rare because they don't exist! I'm no fool, this is clearly a pretend head! It doesn't even have any fur!", STAGE_CLAY_SHOWN],
    ["You must take me for an idiot! This is some head you bought from a taxidermist or something. It's clearly not a fresh kill!", STAGE_FUR_SHOWN],
    ["A head like this deserves a place of honour! My friend, please could you mount it in our home?", STAGE_BLOODY_SHOWN],
  ]);
  const later = (key, ticks, fn) => TaskManager.submit(new CountdownTask(key, ticks, fn));

  function fade(player, out, duration = 50) {
    player.getPacketSender().sendSubInterface(FLOATER_UID, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, duration] : [0, 0, 0, 255, duration] }],
    });
  }

  function confirm(player, title, yes) {
    api.sendMultiChatboxPrompt(player, title, "Yes.", yes, "No.", () => player.getPacketSender().sendInterfaceRemoval());
  }
  const pageVariant = (variant) => ({ page: PAGE, variant });
  let quest;

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (skills.getMaxLevel(Skill.CRAFTING) >= CRAFTING_LEVEL &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= CONSTRUCTION_LEVEL);
  }

  function coinsPending(player) {
    return Number(player.getAttribute(COINS_PENDING_ATTRIBUTE)) === 1;
  }

  function coinsClaimed(player) {
    return Number(player.getAttribute(COINS_CLAIMED_ATTRIBUTE)) === 1;
  }
  /** Monotonic stage advance; never moves a quest-complete player back. */

  function advanceTo(player, stage) {
    const current = quest.getStage(player);
    if (current < stage && current >= STAGE_STARTED && current < STAGE_COMPLETE) {
      quest.setStage(player, stage);
    }
  }
  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function hasTool(player, itemIds) {
    return itemIds.some(itemId => held(player, itemId)) || [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT]
      .some(slot => itemIds.includes(player.getEquipment().get(slot)?.getId()));
  }

  function nailCount(player) {
    const inventory = player.getInventory();
    return NAIL_ITEM_IDS.reduce((sum, itemId) => sum + inventory.getAmount(itemId), 0);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Gordon asked me to kill the beast that was stealing his livestock.</str>",
        "<str>I killed the headless beast, then fooled Gordon with a fake head</str>",
        "<str>and mounted it in his house.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "Gordon asked me to kill the beast that has been stealing his livestock and bring him its head.",
      ];
      if (stage < STAGE_MARY_TALK) {
        lines.push("", "I should ask his wife <col=800000>Mary</col> if she has seen anything.");
      }
      else if (stage < STAGE_FLOUR_POURED) {
        lines.push("", "Mary suggested pouring <col=800000>flour</col> over the cattle gate to track the beast.");
      }
      else if (stage < STAGE_BEAST_KILLED) {
        lines.push("", "I covered the gate in flour and followed the trail to the <col=800000>Headless Beast's lair</col>.");
      }
      else if (stage < STAGE_GORDON_REFUSED) {
        lines.push("", "I killed the headless beast. I should tell <col=800000>Gordon</col>.");
      }
      else if (stage < STAGE_MARY_FAKE) {
        lines.push("", "Gordon won't pay without a head. I should talk to <col=800000>Mary</col> again.");
      }
      else if (stage < STAGE_CLAY_MADE) {
        lines.push("", "Mary suggested making a fake head from <col=800000>soft clay</col> with a knife.");
      }
      else if (stage < STAGE_CLAY_SHOWN) {
        lines.push("", "I should show my clay head to <col=800000>Gordon</col>.");
      }
      else if (stage < STAGE_FUR_MADE) {
        lines.push("", "Gordon wasn't fooled. He said it needs fur.");
      }
      else if (stage < STAGE_FUR_SHOWN) {
        lines.push("", "I should show my fur head to <col=800000>Gordon</col>.");
      }
      else if (stage < STAGE_BLOODY_MADE) {
        lines.push("", "Gordon said the head needs blood on it.");
      }
      else if (stage < STAGE_BLOODY_SHOWN) {
        lines.push("", "I should show my bloody head to <col=800000>Gordon</col>.");
      }
      else if (stage < STAGE_MOUNTED) {
        lines.push("", "Gordon wants the head mounted in his house.");
      }
      else {
        lines.push("", "I should tell <col=800000>Gordon</col> the head is mounted.");
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to <col=800000>Gordon</col> on his farm",
      "south of the <col=800000>Farming Guild</col>.",
      "",
      "I need level 30 Crafting and level 26 Construction to start.",
    ];
  }

  function grantRewards(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CRAFTING, CRAFTING_XP);
    skills.addExperiences(Skill.CONSTRUCTION, CONSTRUCTION_XP);
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() === 0 && inventory.getAmount(COINS_ITEM_ID) === 0) {
      player.setAttribute(COINS_PENDING_ATTRIBUTE, 1);
      player.setAttribute(COINS_CLAIMED_ATTRIBUTE, 0);
      return;
    }
    inventory.adds(COINS_ITEM_ID, COINS_REWARD);
    player.setAttribute(COINS_PENDING_ATTRIBUTE, 0);
    player.setAttribute(COINS_CLAIMED_ATTRIBUTE, 1);
  }

  function reclaimCoins(player) {
    if (!coinsPending(player)) {
      return;
    }
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() === 0 && inventory.getAmount(COINS_ITEM_ID) === 0) {
      player.sendMessage("You need a free inventory slot to take the coins.");
      return;
    }
    inventory.adds(COINS_ITEM_ID, COINS_REWARD);
    player.setAttribute(COINS_PENDING_ATTRIBUTE, 0);
    player.setAttribute(COINS_CLAIMED_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_COINS_RECEIVED, coinsClaimed(player) ? 1 : 0);
  }

  function selectGordonVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return { page: GORDON_PAGE, variant: "standard-dialogue-after-completing-getting-ahead" };
    }
    if (stage >= STAGE_MOUNTED) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-mounting-the-bloody-head");
    }
    if (stage >= STAGE_BLOODY_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-bloody-head-talking-to-gordon-again-after-making-the-bloody-head");
    }
    if (stage >= STAGE_BLOODY_MADE) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-bloody-head");
    }
    if (stage >= STAGE_FUR_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-fur-head-talking-to-gordon-again-after-making-the-fur-head");
    }
    if (stage >= STAGE_FUR_MADE) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-fur-head");
    }
    if (stage >= STAGE_CLAY_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-clay-head-talking-to-gordon-again-after-making-the-clay-head");
    }
    if (stage >= STAGE_CLAY_MADE) {
      return pageVariant("a-strange-fake-talking-to-gordon-after-making-the-clay-head");
    }
    if (stage >= STAGE_GORDON_REFUSED) {
      return pageVariant("a-strange-beast-talking-to-gordon-after-killing-the-headless-beast-talking-to-gordon-again-after-killing-the-headless-beast");
    }
    if (stage >= STAGE_BEAST_KILLED) {
      return pageVariant("a-strange-beast-talking-to-gordon-after-killing-the-headless-beast");
    }
    if (stage >= STAGE_FLOUR_POURED) {
      return pageVariant("a-strange-beast-talking-to-gordon-after-pouring-the-flour");
    }
    if (stage >= STAGE_MARY_TALK) {
      return pageVariant("a-strange-event-talking-to-gordon-after-talking-to-mary");
    }
    if (stage >= STAGE_STARTED) {
      return pageVariant("a-strange-event-talking-to-gordon-talking-to-gordon-again-after-starting-the-quest");
    }
    if (Number(player.getAttribute(MET_GORDON_ATTRIBUTE)) === 1) {
      return pageVariant("a-strange-event-talking-to-gordon-talking-to-gordon-again-before-starting-the-quest");
    }
    return pageVariant("a-strange-event-talking-to-gordon");
  }

  function selectMaryVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      return null;
    }
    if (stage >= STAGE_COMPLETE) {
      return { page: MARY_PAGE, variant: player.getAttribute(TANNING_UNLOCKED_ATTRIBUTE)
        ? "standard-dialogue-after-completing-getting-ahead-after-unlocking-tanning"
        : "standard-dialogue-after-completing-getting-ahead" };
    }
    if (stage >= STAGE_MOUNTED) {
      return pageVariant("a-strange-fake-talking-to-mary-after-mounting-the-bloody-head");
    }
    if (stage >= STAGE_BLOODY_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-mary-after-showing-gordon-the-bloody-head");
    }
    if (stage >= STAGE_BLOODY_MADE) {
      return pageVariant("a-strange-fake-talking-to-mary-after-making-the-bloody-head");
    }
    if (stage >= STAGE_FUR_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-mary-after-showing-gordon-the-fur-head");
    }
    if (stage >= STAGE_FUR_MADE) {
      return pageVariant("a-strange-fake-talking-to-mary-after-making-the-fur-head");
    }
    if (stage >= STAGE_CLAY_SHOWN) {
      return pageVariant("a-strange-fake-talking-to-mary-after-showing-gordon-the-clay-head");
    }
    if (stage >= STAGE_CLAY_MADE) {
      return pageVariant("a-strange-fake-talking-to-mary-after-making-the-clay-head");
    }
    if (stage >= STAGE_MARY_FAKE) {
      return pageVariant("a-strange-fake-talking-to-mary-after-killing-the-beast-talking-to-mary-again-after-killing-the-beast");
    }
    if (stage >= STAGE_GORDON_REFUSED) {
      return pageVariant("a-strange-fake-talking-to-mary-after-killing-the-beast");
    }
    if (stage >= STAGE_BEAST_KILLED) {
      return pageVariant("a-strange-beast-talking-to-mary-after-killing-the-beast-but-before-talking-to-gordon");
    }
    if (stage >= STAGE_FLOUR_POURED) {
      return pageVariant("a-strange-beast-talking-to-mary-after-pouring-the-flour");
    }
    if (stage >= STAGE_MARY_TALK) {
      return pageVariant("a-strange-event-talking-to-mary-talking-to-mary-again");
    }
    return pageVariant("a-strange-event-talking-to-mary");
  }

  function tradeMary(event) {
    if (!MARY_NPC_IDS.has(event.npcId)) return false;
    if (quest.isComplete(event.player) && event.player.getAttribute(TANNING_UNLOCKED_ATTRIBUTE)) {
      api.emitCustomEvent("tanning:open", { player: event.player, npc: event.npc });
    } else startTranscript(api, event.player, event.npcId, MARY_PAGE, quest.isComplete(event.player)
      ? "standard-dialogue-after-completing-getting-ahead" : "standard-dialogue");
    return true;
  }

  function selectSergeantVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) {
      return null;
    }
    return pageVariant("a-strange-event-talking-to-the-sergeant");
  }

  function selectVariant({ npcId, player }) {
    if (GORDON_NPC_IDS.has(npcId)) {
      return selectGordonVariant(player);
    }
    if (MARY_NPC_IDS.has(npcId)) {
      return selectMaryVariant(player);
    }
    if (SERGEANT_NPC_IDS.has(npcId)) {
      return selectSergeantVariant(player);
    }
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (!GORDON_NPC_IDS.has(npcId)) {
      return null;
    }
    if (stepId === REQUIREMENTS_MISSING_CONDITION_ID) {
      return !meetsRequirements(player);
    }
    if (stepId === REQUIREMENTS_MET_CONDITION_ID) {
      return meetsRequirements(player);
    }
    if (stepId === COINS_RECEIVED_CONDITION_ID) {
      return !coinsPending(player);
    }
    if (stepId === COINS_MISSING_CONDITION_ID) {
      return coinsPending(player);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GORDON_NPC_IDS.has(npcId) || hook !== START_HOOK) {
      return;
    }
    if (quest.getStage(player) !== 0 || !meetsRequirements(player)) {
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (!GORDON_NPC_IDS.has(event.npcId) && !MARY_NPC_IDS.has(event.npcId) && event.npcId !== HEADLESS_BEAST_NPC_ID) {
      return;
    }
    const { player, stepId } = event;
    if (stepId === "cUU4Bn" && MARY_NPC_IDS.has(event.npcId) && quest.isComplete(player)) {
      event.handled = true;
      event.end = true;
      later(player, 1, () => { if (player.isRegistered?.() !== false) api.emitCustomEvent("tanning:open", { player, npc: event.npc }); });
      return;
    }
    if (stepId === COMPLETE_MESSAGE_ID || stepId === "LJaElH" || stepId === "FcajVO") {
      event.handled = true;
      return;
    }
    if (stepId === "7aXCpS") {
      event.handled = true;
      event.end = true;
      waitOvernight(player);
      return;
    }
    if (stepId === RECLAIM_COINS_ACTION_ID) {
      event.handled = true;
      reclaimCoins(player);
      return;
    }
    const model = HEAD_MODEL_BY_STEP.get(stepId);
    if (model !== undefined) {
      event.box = { items: [model] };
    }
    if (stepId === "pL8hVR" || stepId === "xQdlJY") {
      event.box = { statement: true };
    }
    const stage = STAGE_BY_STEP_ID.get(stepId);
    if (stage === undefined) {
      return;
    }
    event.handled = true;
    advanceTo(player, stage);
  }
  /** Pot of flour on a cattle-gate leaf; the transcript sets the flour stage. */

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== POT_OF_FLOUR_ITEM_ID || !FENCE_GATE_OBJECT_IDS.has(objectId)) {
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_MARY_TALK || stage >= STAGE_BEAST_KILLED) {
      return;
    }
    event.handled = true;
    if (stage >= STAGE_FLOUR_POURED) {
      return;
    }
    const inventory = player.getInventory();
    if (!held(player, POT_OF_FLOUR_ITEM_ID)) {
      return;
    }
    inventory.deleteNumber(POT_OF_FLOUR_ITEM_ID, 1);
    inventory.adds(POT_ITEM_ID, 1);
    player.performAnimation(new Animation(8837));
    quest.setStage(player, STAGE_FLOUR_POURED);
    startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-event-pouring-the-flour-on-the-gate");
  }

  function deleteOneOf(inventory, itemIds) {
    for (const itemId of itemIds) {
      if (inventory.getAmount(itemId) > 0) {
        inventory.deleteNumber(itemId, 1);
        return;
      }
    }
  }

  function makeClayHead(player, inventory) {
    if (quest.getStage(player) < STAGE_MARY_FAKE || quest.getStage(player) >= STAGE_MOUNTED || !held(player, SOFT_CLAY_ITEM_ID) || !held(player, KNIFE_ITEM_ID)) {
      return;
    }
    player.performAnimation(new Animation(8838));
    inventory.deleteNumber(SOFT_CLAY_ITEM_ID, 1);
    inventory.adds(CLAY_HEAD_ITEM_ID, 1);
    startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-fake-making-the-clay-head");
  }

  function makeFurHead(player, inventory) {
    if (quest.getStage(player) < STAGE_CLAY_SHOWN || quest.getStage(player) >= STAGE_MOUNTED || !held(player, CLAY_HEAD_ITEM_ID) || !hasTool(player, FUR_ITEM_IDS)) {
      return;
    }
    if (!held(player, NEEDLE_ITEM_ID) || !held(player, THREAD_ITEM_ID)) {
      player.sendMessage("You need a needle and some thread to attach the fur.");
      return;
    }
    player.performAnimation(new Animation(8839));
    player.getPacketSender().sendSoundEffect(2592, 1, 0);
    inventory.deleteNumber(CLAY_HEAD_ITEM_ID, 1);
    deleteOneOf(inventory, FUR_ITEM_IDS);
    inventory.deleteNumber(THREAD_ITEM_ID, 1);
    inventory.adds(FUR_HEAD_ITEM_ID, 1);
    startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-fake-making-the-fur-head");
  }

  function makeBloodyHead(player, inventory) {
    if (quest.getStage(player) < STAGE_FUR_SHOWN || quest.getStage(player) >= STAGE_MOUNTED || !held(player, FUR_HEAD_ITEM_ID) || !held(player, RED_DYE_ITEM_ID)) {
      return;
    }
    player.getPacketSender().sendSoundEffect(2392, 1, 0);
    inventory.deleteNumber(FUR_HEAD_ITEM_ID, 1);
    inventory.deleteNumber(RED_DYE_ITEM_ID, 1);
    inventory.adds(BLOODY_HEAD_ITEM_ID, 1);
    startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-fake-making-the-bloody-head");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) {
      return;
    }
    const ids = new Set([usedItemId, usedWithItemId]);
    const inventory = player.getInventory();
    if (ids.has(KNIFE_ITEM_ID) && ids.has(SOFT_CLAY_ITEM_ID)) {
      if (stage < STAGE_MARY_FAKE || stage >= STAGE_MOUNTED) {
        return;
      }
      event.handled = true;
      confirm(player, "Sculpt a clay head?", () => makeClayHead(player, inventory));
      return;
    }
    if (ids.has(CLAY_HEAD_ITEM_ID) && FUR_ITEM_IDS.some((itemId) => ids.has(itemId))) {
      if (stage < STAGE_CLAY_SHOWN || stage >= STAGE_MOUNTED) {
        return;
      }
      event.handled = true;
      confirm(player, "Attach the fur to the clay head?", () => makeFurHead(player, inventory));
      return;
    }
    if (ids.has(FUR_HEAD_ITEM_ID) && ids.has(RED_DYE_ITEM_ID)) {
      if (stage < STAGE_FUR_SHOWN || stage >= STAGE_MOUNTED) {
        return;
      }
      event.handled = true;
      confirm(player, "Dye the fur head?", () => makeBloodyHead(player, inventory));
      return;
    }
    if (ids.has(FUR_HEAD_ITEM_ID) && BLOOD_ITEM_IDS.some((itemId) => ids.has(itemId))) {
      if (stage < STAGE_FUR_SHOWN || stage >= STAGE_BLOODY_SHOWN) {
        return;
      }
      event.handled = true;
      startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-fake-using-a-vial-of-blood-or-a-blood-pint-on-the-fur-head");
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!GORDON_NPC_IDS.has(npcId)) {
      return;
    }
    const variant = SHOW_VARIANTS.get(itemId);
    if (!variant) {
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) {
      return;
    }
    const window = HEAD_SHOW_WINDOW.get(itemId);
    if (window && (stage < window[0] || stage >= window[1])) {
      return;
    }
    event.handled = true;
    startTranscript(api, player, GORDON_NPC_ID, PAGE, variant, steps => window ? steps.slice(1) : steps);
  }

  function handleBeastDeath({ killer, npcId, npc }) {
    if (npcId !== HEADLESS_BEAST_NPC_ID && npc?.getId?.() !== HEADLESS_BEAST_NPC_ID) {
      return;
    }
    if (!killer || BEASTS.get(killer) !== npc) {
      return;
    }
    BEASTS.delete(killer);
    TaskManager.cancelTasks(npc);
    const stage = quest.getStage(killer);
    if (stage < STAGE_FLOUR_POURED || stage >= STAGE_BEAST_KILLED) {
      return;
    }
    quest.setStage(killer, STAGE_BEAST_KILLED);
    killer.getPacketSender().sendCameraReset();
    startTranscript(api, killer, HEADLESS_BEAST_NPC_ID, PAGE, "a-strange-beast-upon-killing-the-headless-beast");
  }

  function removeBeast(player) {
    const beast = BEASTS.get(player);
    if (beast) {
      TaskManager.cancelTasks(beast);
      if (beast.getArea() instanceof BeastLair) beast.getArea().leave(beast, false);
      api.removeNpc(beast);
    }
    BEASTS.delete(player);
  }

  class HeadlessBeastCombat extends MeleeCombatMethod {
    start(npc,target) {
      boulderAttack.delete(npc);
      // shortcut: capture1692 shows five melee swings before a stomp;1/6 selection and4-tick impact need another capture.
      if (BEASTS.get(target) !== npc || Math.random() >= 1/6) { super.start(npc,target); return; }
      boulderAttack.add(npc);
      npc.performAnimation(new Animation(BEAST_STOMP_ANIMATION));
      const tile = target.getLocation().clone(), area = target.getPrivateArea();
      target.getPacketSender().sendSoundEffect(2406,1,0);
      const active = () => BEASTS.get(target) === npc && npc.isRegistered() && target.isRegistered()
        && target.getPrivateArea() === area && (npc.getHitpoints?.() ?? 1) > 0 && (target.getHitpoints?.() ?? 1) > 0;
      later(npc,1,() => { if (active()) target.getPacketSender().sendGraphic(new Graphic(BEAST_ROCK_GRAPHIC),tile); });
      later(npc,BOULDER_FLIGHT_TICKS,() => {
        if (!active() || !target.getLocation().equals(tile)) return;
        const damage = 12 + Math.floor(Math.random()*5);
        target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage,HitMask.RED).setSource(npc)]);
      });
    }
    hits(npc,target) { return boulderAttack.has(npc) ? [] : super.hits(npc,target); }
    attackSpeed() { return 4; }
  }

  class BeastLair extends PrivateArea {
    constructor(owner) { super([new Boundary(1175,1205,10010,10040,0)]); this.owner = owner; }
    getName() { return "Headless Beast's Lair"; }
    canAttack(attacker,target) {
      if (attacker?.isNpc?.() && attacker.getId() === HEADLESS_BEAST_NPC_ID) return BEASTS.get(target) === attacker;
      if (target?.isNpc?.() && target.getId() === HEADLESS_BEAST_NPC_ID) return BEASTS.get(attacker) === target;
      return null;
    }
    postLeave(mobile, logout) {
      if (mobile === this.owner) { lairs.delete(mobile); removeBeast(mobile); }
      super.postLeave(mobile, logout);
    }
  }

  function enterLair(player) {
    let lair = lairs.get(player);
    if (lair && !lair.isDestroyed()) return lair;
    lair = new BeastLair(player); lairs.set(player, lair); lair.enter(player);
    for (const [id, x, y, face] of [[ObjectIdentifiers.CAVE_56,1189,10029,0], [ObjectIdentifiers.SKELETON_77,1187,10018,2]])
      ObjectManager.register(new GameObject(id,new Location(x,y,0),10,face,lair),true);
    return lair;
  }

  function leaveLair(player, logout = false) {
    const lair = lairs.get(player);
    if (lair && player.getArea() === lair) lair.leave(player, logout);
    else removeBeast(player);
  }

  function ensureHeadlessBeast(player) {
    const lair = enterLair(player);
    if (BEASTS.has(player) || quest.getStage(player) >= STAGE_BEAST_KILLED) {
      return;
    }
    const beast = api.spawnNpc({ id: HEADLESS_BEAST_NPC_ID, x: BEAST_TILE.x, y: BEAST_TILE.y, z: 0,
      wanderRadius: 2, owner: player, ownerOnly: true });
    if (beast) {
      beast.__skipDefaultRespawn = true;
      BEASTS.set(player, beast);
      lair.enter(beast);
      beast.getCombat().attack(player);
    }
  }

  function syncCoinReward({ player }) {
    player.getPacketSender().sendVarbit(VARBIT_COINS_RECEIVED, coinsClaimed(player) ? 1 : 0);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    if (quest.isComplete(player) && !coinsPending(player)) {
      player.setAttribute(COINS_CLAIMED_ATTRIBUTE, 1);
    }
    syncCoinReward({ player });
    player.getPacketSender().sendVarbit(696, Number(player.getAttribute(TANNING_UNLOCKED_ATTRIBUTE) || 0));
    player.getPacketSender().sendVarbit(697, Number(player.getAttribute(MET_GORDON_ATTRIBUTE) || 0))
      .sendVarbit(9684, Number(player.getAttribute(NAILS_TAKEN_ATTRIBUTE) || 0));
    if (player.getAttribute(FINISH_PENDING_ATTRIBUTE) && quest.getStage(player) === STAGE_MOUNTED) {
      player.setAttribute(FINISH_PENDING_ATTRIBUTE, 0);
    }
    // Older builds saved 6 after consuming the flour, before its transcript moved to 8.
    if (quest.getStage(player) === LEGACY_STAGE_FLOUR_POURING) {
      quest.setStage(player, STAGE_FLOUR_POURED);
    }
    if (quest.getStage(player) === STAGE_FLOUR_POURED) {
      later(player, 1, () => { if (player.isRegistered()) waitOvernight(player); });
    }
    const at = player.getLocation();
    if (at.getX() >= 1175 && at.getX() <= 1205 && at.getY() >= 10010 && at.getY() <= 10040
      && quest.getStage(player) >= STAGE_LAIR_ENTERED) {
      ensureHeadlessBeast(player);
    }
  }

  function handleCaveClick(event) {
    const { player, objectId, location } = event;
    if (objectId === ObjectIdentifiers.CAVE_55 && location?.x === CAVE_ENTER_TILE.x && location?.y === CAVE_ENTER_TILE.y) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_FLOUR_TRAIL) {
        player.sendMessage("You have no reason to enter this cave.");
        return;
      }
      confirm(player, "This cave looks dangerous. Are you sure you want to enter?", () => {
        if (actions.has(player)) {
          return;
        }
        const token = {};
        actions.set(player, token);
        player.getMovementQueue().reset().setBlockMovement(true);
        fade(player, true);
        later(token, 2, () => {
          if (actions.get(player) !== token) {
            return;
          }
          player.moveTo(new Location(CAVE_INSIDE_TILE.x, CAVE_INSIDE_TILE.y, 0));
          advanceTo(player, STAGE_LAIR_ENTERED);
          ensureHeadlessBeast(player);
        });
        later(token, 3, () => {
          if (actions.get(player) !== token) {
            return;
          }
          actions.delete(player);
          fade(player, false);
          player.getMovementQueue().setBlockMovement(false);
        });
      });
      return;
    }
    if (objectId === ObjectIdentifiers.CAVE_56 && location?.x === CAVE_EXIT_TILE.x && location?.y === CAVE_EXIT_TILE.y) {
      event.handled = true;
      leaveLair(player);
      player.moveTo(new Location(CAVE_OUTSIDE_TILE.x, CAVE_OUTSIDE_TILE.y, 0));
    }
  }

  function searchSkeleton(event) {
    const { player } = event;
    event.handled = true;
    const inventory = player.getInventory();
    if (held(player, NEILANS_JOURNAL_ITEM_ID) || held(player, ItemIdentifiers.NEILANS_JOURNAL_2)) {
      player.sendMessage("You have already taken the journal.");
      return;
    }
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space for the journal.");
      return;
    }
    inventory.adds(NEILANS_JOURNAL_ITEM_ID, 1);
    player.getPacketSender().sendVarbit(695, 1);
    player.sendMessage("You search the skeleton and find a journal.");
  }
  /** ga_flourbarrel upstairs: fill an empty pot with flour. */

  function takeFlourFromBarrel(event) {
    const { player } = event;
    event.handled = true;
    if (!held(player, POT_ITEM_ID)) {
      player.sendMessage("You need an empty pot to hold the flour.");
      return;
    }
    const inventory = player.getInventory();
    inventory.deleteNumber(POT_ITEM_ID, 1);
    inventory.adds(POT_OF_FLOUR_ITEM_ID, 1);
    player.sendMessage("You fill the pot with flour.");
  }
  /** ga_shelves by the stairs: some red dye for the fake head. */

  function searchShelves(event) {
    const { player } = event;
    event.handled = true;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(RED_DYE_ITEM_ID, 1);
    player.sendMessage("You take some red dye from the shelves.");
  }
  /** ga_workbench in the shed north of the house: nails for the mounting. */

  function searchWorkbench(event) {
    const { player } = event;
    event.handled = true;
    const inventory = player.getInventory();
    if (player.getAttribute(NAILS_TAKEN_ATTRIBUTE)) {
      player.sendMessage("You have already taken all the nails here.");
      return;
    }
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    inventory.adds(ItemIdentifiers.IRON_NAILS, 20);
    player.setAttribute(NAILS_TAKEN_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(9684, 1);
    player.sendMessage("You take some iron nails from the workbench.");
  }
  /** ga_rocks_pickaxe at the Kebos mine: the stuck pickaxe, one per player. */

  function takePickaxe(event) {
    const { player } = event;
    event.handled = true;
    if (Number(player.getAttribute(PICKAXE_TAKEN_ATTRIBUTE)) === 1) {
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.setAttribute(PICKAXE_TAKEN_ATTRIBUTE, 1);
    player.getInventory().adds(ItemIdentifiers.BRONZE_PICKAXE, 1);
    player.sendMessage("You take a bronze pickaxe from the rocks.");
  }

  function canMountHead(player) {
    return (held(player, BLOODY_HEAD_ITEM_ID) &&
      held(player, PLANK_ITEM_ID, 2) &&
      nailCount(player) >= 6 &&
      hasTool(player, HAMMER_ITEM_IDS) &&
      hasTool(player, SAW_ITEM_IDS));
  }

  function useNail(player) {
    const index = NAIL_ITEM_IDS.findIndex(id => held(player,id));
    if (index < 0) return false;
    player.getInventory().deleteNumber(NAIL_ITEM_IDS[index],1);
    const level = Math.max(1,Math.min(99,player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION)));
    // shortcut: Wiki confirms the quality/level trend, not rates; replace this estimated roll with measured OSRS rates.
    const bent = Math.random() < NAIL_BEND_BASE[index] / 100 * (100-level) / 100;
    player.sendMessage(bent ? "You bend the nail." : "You use a nail.");
    return !bent;
  }

  function buildMountedHead(event) {
    const { player } = event;
    if (event.objectId !== MOUNTED_HEAD_OBJECT_ID) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_BLOODY_SHOWN || actions.has(player)) return;
    if (!canMountHead(player)) { player.sendMessage("You need the bloody head, two planks, six nails, a hammer and a saw."); return; }
    const token = { nailed:0, attempts:0 }, origin = player.getLocation().clone();
    actions.set(player,token);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(3676));
    player.getPacketSender().sendSoundEffect(938,1,0);
    const valid = () => actions.get(player) === token && player.getLocation().equals(origin)
      && quest.getStage(player) === STAGE_BLOODY_SHOWN && held(player,BLOODY_HEAD_ITEM_ID)
      && held(player,PLANK_ITEM_ID,2) && hasTool(player,HAMMER_ITEM_IDS) && hasTool(player,SAW_ITEM_IDS);
    function hammerNail() {
      if (actions.get(player) !== token) return;
      if (!valid()) { cancelAction(player); return; }
      if (token.nailed === 6) {
        player.getInventory().deleteNumber(BLOODY_HEAD_ITEM_ID,1);
        player.getInventory().deleteNumber(PLANK_ITEM_ID,2);
        cancelAction(player); quest.setStage(player,STAGE_MOUNTED);
        startTranscript(api,player,GORDON_NPC_ID,PAGE,"a-strange-fake-mounting-the-bloody-head");
        return;
      }
      if (nailCount(player) === 0) { player.sendMessage("You don't have any nails left."); cancelAction(player); return; }
      if (useNail(player)) token.nailed++;
      token.attempts++;
      if (token.nailed < 6) player.performAnimation(new Animation(3676));
      if (token.attempts % 2 === 0) player.getPacketSender().sendSoundEffect(938,1,0);
      later(token,1,hammerNail);
    }
    later(token,1,hammerNail);
  }

  function cancelAction(player) {
    const token = actions.get(player);
    if (token) {
      TaskManager.cancelTasks(token);
    }
    actions.delete(player);
    player.getMovementQueue().setBlockMovement(false);
  }

  function waitOvernight(player) {
    if (quest.getStage(player) !== STAGE_FLOUR_POURED || actions.has(player)) {
      return;
    }
    const token = {};
    actions.set(player, token);
    player.getDialogueManager().reset();
    player.getMovementQueue().reset().setBlockMovement(true);
    fade(player, true);
    later(token, 2, () => {
      if (actions.get(player) === token) {
        advanceTo(player, STAGE_FLOUR_TRAIL);
      }
    });
    later(token, 4, () => {
      if (actions.get(player) !== token) return;
      fade(player, false);
      cancelAction(player);
      const text = "You head off for the night and come back the next day.";
      player.getDialogueManager().startDialogues(new DialogueChainBuilder()
        .add(new StatementDialogue(0, text))
        .add(new ActionDialogue(1, { execute: () => {
          player.getPacketSender().closeSubInterface(FLOATER_UID);
          startTranscript(api, player, GORDON_NPC_ID, PAGE, "a-strange-event-pouring-the-flour-on-the-gate", steps => steps.slice(3));
        } })));
    });
  }

  function line(event) {
    const { player, npcId, text } = event;
    if (!GORDON_NPC_IDS.has(npcId) && !MARY_NPC_IDS.has(npcId)) {
      return;
    }
    if (GORDON_NPC_IDS.has(npcId) && !player.getAttribute(MET_GORDON_ATTRIBUTE)) {
      event.before = () => {
        player.setAttribute(MET_GORDON_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(697, 1);
      };
    }
    if (MARY_NPC_IDS.has(npcId) && text.includes("With the beast dealt with, I've been able to get back to tanning again.")) event.before = () => {
      player.setAttribute(TANNING_UNLOCKED_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(696, 1);
    };
    const stage = STAGE_BY_LINE.get(text);
    if (stage !== undefined) {
      event.before = () => advanceTo(player, stage);
    }
    if (text === "That's great! I'd say it's about time for your reward. But first, let's have a look at this head...") {
      event.after = () => inspectHead(player);
    }
  }

  class Inspection extends TemplatedInstanceArea {
    constructor(player) {
      super(4, 3);
      this.owner = player;
      this.actors = [];
      for (let z = 0; z < 4; z++)
        for (let x = 0; x < 4; x++)
          for (let y = 0; y < 3; y++)
            this.setChunk(z, x, y, { sourceChunkX: 154 + x, sourceChunkY: 459 + y, sourcePlane: z, rotation: 0 });
    }
    sourceTile(x, y) {
      return this.tile(x - 1232, y - 3672, 0);
    }
    canTeleport() {
      return false;
    }
    canAttack() {
      return false;
    }
    destroy() {
      for (const actor of this.actors)
        api.removeNpc(actor);
      this.actors = [];
      super.destroy();
    }
    postLeave(actor, logout) {
      if (actor === this.owner) {
        TaskManager.cancelTasks(this);
        scenes.delete(actor);
        this.destroy();
        actor.getMovementQueue().setBlockMovement(false);
        actor.setUntargetable(false);
        actor.getPacketSender().sendCameraUnlock(false).sendCameraReset().closeSubInterface(FLOATER_UID);
      }
      super.postLeave(actor, logout);
    }
  }

  function inspectHead(player) {
    if (quest.getStage(player) !== STAGE_MOUNTED || scenes.has(player)) {
      return;
    }
    player.setAttribute(FINISH_PENDING_ATTRIBUTE, 1);
    player.getDialogueManager().reset();
    const scene = new Inspection(player);
    scenes.set(player, scene);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    fade(player, true);
    later(scene, 3, () => {
      player.moveTo(scene.sourceTile(1239, 3681));
      scene.enter(player);
      for (const [id, x, y] of [[NpcIdentifiers.GORDON_2, 1239, 3683], [NpcIdentifiers.MARY_4, 1238, 3677]]) {
        const tile = scene.sourceTile(x, y), npc = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
        if (npc) {
          scene.enter(npc);
          scene.actors.push(npc);
        }
      }
      scene.gordon = scene.actors[0];
      scene.mary = scene.actors[1];
      for (const [id, x, y, type, face] of [[40381, 1239, 3685, 10, 3], [40382, 1237, 3683, 0, 2], [40382, 1242, 3682, 0, 1], [40382, 1245, 3685, 0, 0], [40363, 1240, 3688, 10, 2]]) {
        const object = new GameObject(id, scene.sourceTile(x, y), type, face, scene);
        ObjectManager.register(object, true);
        scene.add(object);
      }
    });
    later(scene, 4, () => {
      const camera = scene.sourceTile(1238, 3677), look = scene.sourceTile(1239, 3683), options = { rate: 232, rate2: 100, heightRelative: false };
      player.getPacketSender().sendCameraMoveTo(camera.getX(), camera.getY(), 420, options).sendCameraLookAt(look.getX(), look.getY(), 40, options);
      scene.gordon?.performAnimation(new Animation(862));
    });
    later(scene, 5, () => fade(player, false));
    for (let tick = 6; tick <= 9; tick++)
      later(scene, tick, () => scene.mary?.getMovementQueue().addSteps(scene.sourceTile(1238, 3677 + tick - 5)));
    later(scene, 10, () => scene.mary?.setPositionToFace(scene.sourceTile(1239, 3683)));
    for (const [tick, animation] of [[8, 861], [11, 862], [15, 861], [18, 862]])
      later(scene, tick, () => scene.gordon?.performAnimation(new Animation(animation)));
    later(scene, 13, () => {
      player.performAnimation(new Animation(4275));
      scene.mary?.performAnimation(new Animation(4275, 12));
    });
    later(scene, 16, () => fade(player, true, 80));
    later(scene, 19, () => {
      // Leave cancels the scene tasks; the captured return fade/reward use a new key.
      scene.leave(player, false);
      player.moveTo(new Location(1249, 3684, 0));
      const token = {};
      actions.set(player, token);
      later(token, 3, () => fade(player, false));
      later(token, 5, () => {
        if (actions.get(player) !== token) {
          return;
        }
        cancelAction(player);
        player.setAttribute(FINISH_PENDING_ATTRIBUTE, 0);
        quest.complete(player);
        player.getPacketSender().sendVarbit(VARBIT_COINS_RECEIVED, coinsClaimed(player) ? 1 : 0).closeSubInterface(FLOATER_UID);
      });
    });
  }

  function handleLogout({ player }) {
    cancelAction(player);
    leaveLair(player, true);
    const scene = scenes.get(player);
    if (scene) {
      scene.leave(player, true);
      player.moveTo(new Location(1249, 3684, 0));
    }
  }
  api.persistAttribute(MET_GORDON_ATTRIBUTE);
  api.persistAttribute(COINS_PENDING_ATTRIBUTE);
  api.persistAttribute(COINS_CLAIMED_ATTRIBUTE, 0);
  api.persistAttribute(PICKAXE_TAKEN_ATTRIBUTE);
  api.persistAttribute(NAILS_TAKEN_ATTRIBUTE, 0);
  api.persistAttribute(FINISH_PENDING_ATTRIBUTE, 0);
  api.persistAttribute(TANNING_UNLOCKED_ATTRIBUTE, 0);
  quest = registerQuest(api, {
    key: "getting_ahead",
    name: "Getting Ahead",
    varpId: VARP_GETTING_AHEAD,
    varbitId: VARBIT_GETTING_AHEAD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: CRAFTING_XP, label: "Crafting" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: CONSTRUCTION_XP, label: "Construction" },
    ],
    scrollItemId: COINS_ITEM_ID,
    rewardItemLabel: "3,000 Coins",
    otherRewards: ["Access to a tannery in the Kebos Lowlands"],
    buildJournal,
    onReward: grantRewards,
  });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Mary", { Trade: tradeMary });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("player:bootstrap-complete", syncCoinReward);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectFirstClick([ObjectIdentifiers.CAVE_55, ObjectIdentifiers.CAVE_56], handleCaveClick);
  api.onObjectFirstClick([ObjectIdentifiers.SKELETON_77], searchSkeleton);
  api.onObjectFirstClick([ObjectIdentifiers.BARREL_OF_FLOUR_3], takeFlourFromBarrel);
  api.onObjectFirstClick([ObjectIdentifiers.SHELVES_119], searchShelves);
  api.onObjectFirstClick([ObjectIdentifiers.WORKBENCH_19], searchWorkbench);
  api.onObjectFirstClick([ObjectIdentifiers.ROCKS_96], takePickaxe);
  api.onObjectInteraction("Mounted Head Space", { Build: buildMountedHead });
  api.onNpcDeath(handleBeastDeath);
  api.registerNpcCombatMethodProvider(HEADLESS_BEAST_NPC_ID, HeadlessBeastCombat);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
