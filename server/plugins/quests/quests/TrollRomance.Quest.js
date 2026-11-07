/**
 * Troll Romance (members).
 *
 * The words come from the "Troll Romance" transcript page; this plugin supplies
 * the variant selector for Ug, Aga, Arrg, Tenzing and Dunstan, the start hook,
 * the sled-making and waxing hand-ins, the Trollweiss cave/slope route, the
 * flower pickups, the Arrg arena fight and the completion reward.
 *
 * Stages (varp 385, "troll_love" in the cache varp dump; the wiki publishes no
 * per-stage values, so these follow Quest Helper's varp-driven guide): 5 started
 * (Aga next), 10 Aga told (Tenzing next), 15 Tenzing told (Dunstan next), 20
 * Dunstan agreed (bring materials), 22 sled made, 25 sled waxed (ride the
 * slope), 30 Trollweiss picked (give it to Ug), 35 given to Ug (defeat Arrg),
 * 40 Arrg defeated (return to Ug), 45 complete. 45 is our completion value; the
 * last value Quest Helper guides on is 40.
 *
 * Requirements per the OSRS Wiki: Troll Stronghold (and so Death Plateau)
 * complete, 28 Agility to descend the slope (enforced at the slope, not at the
 * start). Rewards per the wiki: 2 QP, 8,000 Agility XP, 4,000 Strength XP, 1
 * uncut diamond, 2 uncut rubies, 4 uncut emeralds and a sled.
 *
 * Approximations: the sled ride is a moveTo cutscene over collision-checked
 * tiles rather than real slide physics; the ice troll cave is walked for real,
 * but its two ends are teleported (5007 -> 2803,10190; crevasse 5025 ->
 * 2773,3837) because nothing else wires the crevasse; Arrg is spawned
 * owner-only in the real Troll arena (2905,3621 / 2908,3621) and killed, not
 * trapped; the bucket of wax is consumed by the wax mix, as the wiki lists no
 * empty-bucket byproduct; "getting-started-talking-to-aga-again" is used from
 * stage 10 (after the love-life talk).
 *
 * Fidelity fixes for two dump defects: the "I need a sled!!" -> "Yes." branch's
 * jump (b4PZnn) has no target and NpcDialogues' fallback splices Ug's start
 * lines in, so the answer is replayed with the material lines the "No." branch
 * shares; and a refused start (Troll Stronghold incomplete) drops Ug's
 * acceptance lines so only the refusal message is seen.
 */
module.exports = function registerTrollRomanceQuest(api) {
  const { giveReward } = require("../QuestRuntime");
  const {
    Animation,
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const UG_NPC_IDS = new Set([NpcIdentifiers.UG, NpcIdentifiers.UG_2]); // 640, 644
  const AGA_NPC_ID = NpcIdentifiers.AGA; // 641
  const ARRG_NPC_IDS = new Set([NpcIdentifiers.ARRG, NpcIdentifiers.ARRG_2]); // 642, 643
  const ARRG_ATTACKABLE_NPC_ID = NpcIdentifiers.ARRG_2; // 643
  const TENZING_NPC_ID = NpcIdentifiers.TENZING; // 4094
  const DUNSTAN_NPC_ID = NpcIdentifiers.DUNSTAN; // 4105

  const RARE_FLOWERS_OBJECT_ID = ObjectIdentifiers.RARE_FLOWERS; // 5006
  const CAVE_ENTRANCE_OBJECT_ID = ObjectIdentifiers.CAVE_ENTRANCE_26; // 5007
  const SLOPE_OBJECT_ID = ObjectIdentifiers.SLOPE; // 5015
  const CREVASSE_OBJECT_ID = ObjectIdentifiers.CREVASSE; // 5025

  const SLED_ITEM_ID = ItemIdentifiers.SLED; // 4083
  const WAXED_SLED_ITEM_ID = ItemIdentifiers.SLED_2; // 4084
  const WAX_ITEM_ID = ItemIdentifiers.WAX; // 4085
  const TROLLWEISS_ITEM_ID = ItemIdentifiers.TROLLWEISS; // 4086
  const BUCKET_OF_WAX_ITEM_ID = ItemIdentifiers.BUCKET_OF_WAX; // 30
  const CAKE_TIN_ITEM_ID = ItemIdentifiers.CAKE_TIN; // 1887
  const SWAMP_TAR_ITEM_ID = ItemIdentifiers.SWAMP_TAR; // 1939
  const MAPLE_LOGS_ITEM_ID = ItemIdentifiers.MAPLE_LOGS; // 1517
  const YEW_LOGS_ITEM_ID = ItemIdentifiers.YEW_LOGS; // 1515
  const IRON_BAR_ITEM_ID = ItemIdentifiers.IRON_BAR; // 2351
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const UNCUT_DIAMOND_ITEM_ID = ItemIdentifiers.UNCUT_DIAMOND; // 1617
  const UNCUT_RUBY_ITEM_ID = ItemIdentifiers.UNCUT_RUBY; // 1619
  const UNCUT_EMERALD_ITEM_ID = ItemIdentifiers.UNCUT_EMERALD; // 1621

  const VARP_TROLL_LOVE = 385;

  const STAGE_STARTED = 5;
  const STAGE_AGA_TOLD = 10;
  const STAGE_TENZING_TOLD = 15;
  const STAGE_DUNSTAN_AGREED = 20;
  const STAGE_SLED = 22;
  const STAGE_SLED_WAXED = 25;
  const STAGE_FLOWER = 30;
  const STAGE_FLOWER_GIVEN = 35;
  const STAGE_ARRG_DEFEATED = 40;
  const STAGE_COMPLETE = 45;

  const START_HOOK = "quest:troll-romance:start";
  /** Dunstan's first-talk variant, whose "Yes." jump lost its target in the dump. */
  const DUNSTAN_INTRO_VARIANT = "finding-the-flowers-talking-to-dunstan";
  /** The lines the "Yes." options play before the missing jump. */
  const ACCEPTANCE_LINES = [
    "Don't worry now, I'll see what I can do.",
    "You help Ug? You nice, maybe Ug not eat you!",
    "Errrr... thanks... I think?",
    "I will go and talk to Aga.",
  ];
  /** Dunstan's transcript message that hands over the sled. */
  const SLED_HANDED_OVER_MESSAGE_ID = "-LrN_g";
  /** Ug's "Congratulations! Quest complete!" transcript action. */
  const COMPLETE_ACTION_ID = "ri6lci";

  const AGILITY_REQUIREMENT = 28;
  /** Toboggan animations (RuneLite AnimationID, checked in the cache seq dump). */
  const TOBOGGAN_MOVING_ANIMATION_ID = 1462;
  const TOBOGGAN_CRASHING_ANIMATION_ID = 1464;

  // The summit run: first slide at 2772/2773,3835 down to the crash site by the flowers.
  const SLOPE_TILES = new Set(["2772,3835", "2773,3835"]);
  const SLED_MIDPOINT_1 = new Location(2771, 3818, 0);
  const SLED_MIDPOINT_2 = new Location(2785, 3807, 0);
  const SLED_LANDING = new Location(2803, 3786, 0);
  const CAVE_INTERIOR = new Location(2803, 10190, 0);
  const SUMMIT_EXIT = new Location(2773, 3837, 0);

  const ARENA_TELEPORT = new Location(2905, 3621, 0);
  const ARENA_ARRG_SPAWN = new Location(2908, 3621, 0);

  /** The arena Arrg spawned for each challenger. */
  const arenaArrgByPlayer = new Map();
  /** Players whose quest-start refusal must drop Ug's acceptance lines. */
  const refusingStartByPlayer = new WeakSet();

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);

  function hasMaterials(player) {
    const logs = held(player, MAPLE_LOGS_ITEM_ID) || held(player, YEW_LOGS_ITEM_ID);
    return logs && held(player, IRON_BAR_ITEM_ID) && held(player, ROPE_ITEM_ID);
  }

  function hasWaxedSled(player) {
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return weapon?.getId?.() === WAXED_SLED_ITEM_ID || held(player, WAXED_SLED_ITEM_ID);
  }

  function trollStrongholdComplete(player) {
    const request = { player, key: "troll_stronghold", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Ug win the heart of Aga.</str>",
        "<str>I fetched Trollweiss from Trollweiss Mountain.</str>",
        "<str>I defeated Arrg in the Troll arena.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ARRG_DEFEATED) {
      return ["I have defeated Arrg.", "I should tell <col=800000>Ug</col> the good news."];
    }
    if (stage >= STAGE_FLOWER_GIVEN) {
      return ["Ug has the Trollweiss.", "I must defeat <col=800000>Arrg</col> in the Troll arena."];
    }
    if (stage >= STAGE_FLOWER) {
      return ["I picked the Trollweiss.", "I should give it to <col=800000>Ug</col> in the Troll Stronghold."];
    }
    if (stage >= STAGE_SLED_WAXED) {
      return [
        "My sled is waxed.",
        "I should ride down the Trollweiss Mountain slope and pick the flowers.",
      ];
    }
    if (stage >= STAGE_SLED) {
      return [
        "Dunstan made me a sled.",
        "It needs waxing: use swamp tar on a bucket of wax with a cake tin, then use the wax on the sled.",
      ];
    }
    if (stage >= STAGE_DUNSTAN_AGREED) {
      return [
        "Dunstan will make me a sled for a maple or yew log, an iron bar and some rope.",
      ];
    }
    if (stage >= STAGE_TENZING_TOLD) {
      return ["Tenzing told me a sled is the only way down.", "I should ask <col=800000>Dunstan</col> in Burthorpe to make one."];
    }
    if (stage >= STAGE_AGA_TOLD) {
      return [
        "Aga wants a Trollweiss flower.",
        "Someone who has lived in the mountains might know where it grows - Tenzing the sherpa.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return ["Ug is in love with Aga.", "I should talk to <col=800000>Aga</col> north of Ug."];
    }
    return [
      "I can start this quest by talking to <col=800000>Ug</col> in the Troll Stronghold.",
      "It requires completion of Troll Stronghold and 28 Agility.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, 8000);
    player.getSkillManager().addExperiences(Skill.STRENGTH, 4000);
    giveReward(player, UNCUT_DIAMOND_ITEM_ID, 1);
    giveReward(player, UNCUT_RUBY_ITEM_ID, 2);
    giveReward(player, UNCUT_EMERALD_ITEM_ID, 4);
  }

  // ==========================================================================
  // Dialogue variants
  // ==========================================================================

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (UG_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return { page: "Ug", variant: "after-troll-romance" };
      if (stage >= STAGE_ARRG_DEFEATED) return "returning-to-ug-talking-to-ug-after-defeating-arrg";
      if (stage >= STAGE_FLOWER_GIVEN) return "returning-to-ug-talking-to-ug-before-defeating-argg";
      if (stage >= STAGE_FLOWER && held(player, TROLLWEISS_ITEM_ID)) {
        player.getInventory().deleteNumber(TROLLWEISS_ITEM_ID, 1);
        quest.setStage(player, STAGE_FLOWER_GIVEN);
        return "returning-to-ug-talking-to-ug";
      }
      if (stage >= STAGE_TENZING_TOLD) return "finding-the-flowers-talking-to-ug";
      if (stage >= STAGE_AGA_TOLD) return "getting-started-returning-to-ug";
      if (stage >= STAGE_STARTED) return "getting-started-talking-to-ug-again";
      return "getting-started-talking-to-ug";
    }
    if (npcId === AGA_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: "Aga", variant: "after-troll-romance" };
      if (stage >= STAGE_AGA_TOLD) return "getting-started-talking-to-aga-again";
      if (stage >= STAGE_STARTED) return "getting-started-talking-to-aga";
      return null;
    }
    if (ARRG_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return { page: "Arrg", variant: "after-troll-romance" };
      if (stage >= STAGE_ARRG_DEFEATED) return "returning-to-ug-talking-to-arrg-after-defeating-him";
      if (stage >= STAGE_FLOWER_GIVEN) return "returning-to-ug-challenging-argg";
      if (stage >= STAGE_STARTED) return "getting-started-talking-to-arrg";
      return null;
    }
    if (npcId === TENZING_NPC_ID) {
      if (stage >= STAGE_AGA_TOLD && stage < STAGE_TENZING_TOLD) {
        return "finding-the-flowers-talking-to-tenzing";
      }
      // Once Troll Romance owns Tenzing, keep Troll Stronghold's stale variant away.
      if (stage >= STAGE_STARTED) return { page: "Tenzing", variant: "after-death-plateau" };
      return null;
    }
    if (npcId === DUNSTAN_NPC_ID) {
      if (stage === STAGE_TENZING_TOLD) return "finding-the-flowers-talking-to-dunstan";
      if (stage >= STAGE_COMPLETE) {
        return hasMaterials(player)
          ? "finding-the-flowers-talking-to-dunstan-with-materials"
          : { page: "Dunstan", variant: "standard-dialogue" };
      }
      if (stage >= STAGE_DUNSTAN_AGREED) {
        if (hasMaterials(player)) return "finding-the-flowers-talking-to-dunstan-with-materials";
        if (!held(player, SLED_ITEM_ID) && !held(player, WAXED_SLED_ITEM_ID)) {
          return "finding-the-flowers-talking-to-dunstan-again-without-materials";
        }
        return "finding-the-flowers-talking-to-dunstan-again-before-waxing-the-sled";
      }
      if (stage >= STAGE_STARTED) return { page: "Dunstan", variant: "standard-dialogue" };
      return null;
    }
    return null;
  }

  /** The two "what do I do next" choices that move the stage along mid-conversation. */
  function handleChoice({ player, npcId, option }) {
    if (!player || !option) return;
    const stage = quest.getStage(player);
    if (npcId === AGA_NPC_ID && stage === STAGE_STARTED && option === "So... how's your... um... love life?") {
      quest.setStage(player, STAGE_AGA_TOLD);
      return;
    }
    if (npcId === TENZING_NPC_ID && stage === STAGE_AGA_TOLD && option === "What would I need to make such a sled?") {
      quest.setStage(player, STAGE_TENZING_TOLD);
      return;
    }
    if (npcId === DUNSTAN_NPC_ID && stage === STAGE_TENZING_TOLD && option === "I need a sled!!") {
      quest.setStage(player, STAGE_DUNSTAN_AGREED);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!UG_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    if (!trollStrongholdComplete(player)) {
      refusingStartByPlayer.add(player);
      player.sendMessage("You must complete Troll Stronghold before you can help Ug.");
      return;
    }
    if (player.getSkillManager().getMaxLevel(Skill.AGILITY) < AGILITY_REQUIREMENT) {
      player.sendMessage(
        `You need an Agility level of at least ${AGILITY_REQUIREMENT} to start this quest.`
      );
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  /** Drops the acceptance lines when the chosen "Yes." could not start the quest. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    if (!UG_NPC_IDS.has(npcId) || !refusingStartByPlayer.has(player)) return;
    const index = ACCEPTANCE_LINES.indexOf(text);
    if (index === -1) return;
    event.skip = true;
    if (index === ACCEPTANCE_LINES.length - 1) refusingStartByPlayer.delete(player);
  }

  // ==========================================================================
  // Dunstan's "Yes." branch (the dump's b4PZnn jump has no target)
  // ==========================================================================

  /** The first option with this text, searching nested (line-attached) steps too. */
  function optionSteps(steps, text) {
    for (const step of steps ?? []) {
      for (const option of step.options ?? []) {
        if (option.text === text) return Array.isArray(option.steps) ? option.steps : null;
      }
      const nested = optionSteps(step.steps, text);
      if (nested) return nested;
    }
    return null;
  }

  /**
   * What Dunstan should say after "I need a sled!!" -> "Yes.": his question, then
   * the material request taken from the shared lines of the "No." branch, since the
   * dump's jump target is missing and NpcDialogues' fallback lands in Ug's start.
   */
  function dunstanAgreementSteps(steps) {
    const replies = optionSteps(steps, "I need a sled!!");
    const accepted = replies && optionSteps(replies, "Yes.");
    const declined = replies && optionSteps(replies, "No.");
    if (!accepted || !declined) return null;
    const question = accepted.filter((step) => step.type !== "jump");
    const marker = "I need the sled to get to a certain location in the mountains.";
    const index = declined.findIndex((step) => step.player === marker);
    if (index === -1) return null;
    return [...question, ...declined.slice(index + 1)];
  }

  /** Replays the answer a tick later, replacing the branch the broken jump starts. */
  function fixDunstanSledAnswer({ player, npcId, option }) {
    if (npcId !== DUNSTAN_NPC_ID || option !== "Yes.") return;
    if (quest.getStage(player) !== STAGE_DUNSTAN_AGREED) return;
    const { CountdownTask, TaskManager } = api.core;
    const replay = () => {
      if (player.isRegistered?.() === false) return;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npcId: DUNSTAN_NPC_ID,
        variant: DUNSTAN_INTRO_VARIANT,
        select: dunstanAgreementSteps,
      });
    };
    if (!CountdownTask || !TaskManager) {
      replay();
      return;
    }
    TaskManager.submit(new CountdownTask({}, 1, replay));
  }

  function handleAction(event) {
    const { player, npcId, stepId, action } = event;
    if (!player) return;
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) >= STAGE_ARRG_DEFEATED && !quest.isComplete(player)) {
        quest.complete(player);
      }
      return;
    }
    if (event.kind === "message" && stepId === SLED_HANDED_OVER_MESSAGE_ID) {
      if (!hasMaterials(player)) return;
      const logs = held(player, MAPLE_LOGS_ITEM_ID) ? MAPLE_LOGS_ITEM_ID : YEW_LOGS_ITEM_ID;
      player.getInventory().deleteNumber(logs, 1);
      player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 1);
      player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
      player.getInventory().adds(SLED_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_SLED) quest.setStage(player, STAGE_SLED);
      return;
    }
    if (action === "teleport" && ARRG_NPC_IDS.has(npcId)) {
      event.handled = true;
      startArenaFight(player);
    }
  }

  // ==========================================================================
  // Sled, wax and flowers
  // ==========================================================================

  /** Swamp tar + bucket of wax (with a cake tin) makes wax; wax turns the sled into a sled. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = (a, b) =>
      (usedItemId === a && usedWithItemId === b) || (usedItemId === b && usedWithItemId === a);
    if (pair(SWAMP_TAR_ITEM_ID, BUCKET_OF_WAX_ITEM_ID)) {
      if (quest.getStage(player) < STAGE_TENZING_TOLD) return;
      event.handled = true;
      if (!held(player, CAKE_TIN_ITEM_ID)) {
        player.sendMessage("You need a cake tin to store the wax in.");
        return;
      }
      player.getInventory().deleteNumber(SWAMP_TAR_ITEM_ID, 1);
      player.getInventory().deleteNumber(BUCKET_OF_WAX_ITEM_ID, 1);
      player.getInventory().adds(WAX_ITEM_ID, 1);
      player.sendMessage("You make some sled wax.");
      return;
    }
    if (pair(WAX_ITEM_ID, SLED_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(WAX_ITEM_ID, 1);
      player.getInventory().deleteNumber(SLED_ITEM_ID, 1);
      player.getInventory().adds(WAXED_SLED_ITEM_ID, 1);
      player.sendMessage("You wax the sled. You're now ready to go.");
      if (quest.getStage(player) === STAGE_SLED) quest.setStage(player, STAGE_SLED_WAXED);
    }
  }

  /** Using Trollweiss on Aga is always refused. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (event.itemId !== TROLLWEISS_ITEM_ID || npcId !== AGA_NPC_ID) return;
    event.handled = true;
    event.player.sendMessage("That's probably not a good idea...");
  }

  function pickFlower(event) {
    const { player } = event;
    event.handled = true;
    if (player.getInventory().isFull()) {
      player.sendMessage("I know it's only a flower, but I haven't got enough space...");
      return;
    }
    player.getInventory().adds(TROLLWEISS_ITEM_ID, 1);
    const stage = quest.getStage(player);
    if (stage >= STAGE_SLED_WAXED && stage < STAGE_FLOWER) quest.setStage(player, STAGE_FLOWER);
  }

  /** The first slide down to the flower patch, as a three-hop moveTo cutscene. */
  function rideSled(event) {
    const { player, location } = event;
    event.handled = true;
    if (!SLOPE_TILES.has(`${location.x},${location.y}`)) return;
    if (!quest.isComplete(player) && quest.getStage(player) < STAGE_SLED_WAXED) return;
    if (!hasWaxedSled(player)) {
      player.sendMessage("You need a waxed sled to slide down here.");
      return;
    }
    if (agilityLevel(player) < AGILITY_REQUIREMENT) {
      player.sendMessage("You need an Agility level of 28 to slide down the slope.");
      return;
    }
    const { CountdownTask, TaskManager } = api.core;
    player.performAnimation(new Animation(TOBOGGAN_MOVING_ANIMATION_ID));
    player.forceChat("Here we go!");
    const moves = [
      [2, () => player.moveTo(SLED_MIDPOINT_1.clone())],
      [4, () => player.moveTo(SLED_MIDPOINT_2.clone())],
      [
        6,
        () => {
          player.moveTo(SLED_LANDING.clone());
          player.performAnimation(new Animation(TOBOGGAN_CRASHING_ANIMATION_ID));
        },
      ],
      [7, () => player.forceChat("O-oh, this doesn't look good!")],
      [9, () => player.forceChat("And I thought snow was soft...")],
      [11, () => player.forceChat("Although it was a little softer than the rock I hit.")],
    ];
    if (!CountdownTask || !TaskManager) {
      player.moveTo(SLED_LANDING.clone());
      return;
    }
    for (const [ticks, move] of moves) {
      TaskManager.submit(
        new CountdownTask({}, ticks, () => {
          if (player.isRegistered?.() === false) return;
          move();
        })
      );
    }
  }

  function handleObjectInteraction(event) {
    const { objectId } = event;
    if (objectId === RARE_FLOWERS_OBJECT_ID) {
      pickFlower(event);
      return;
    }
    if (objectId === SLOPE_OBJECT_ID) {
      rideSled(event);
      return;
    }
    if (objectId === CAVE_ENTRANCE_OBJECT_ID) {
      event.handled = true;
      event.player.moveTo(CAVE_INTERIOR.clone());
      return;
    }
    if (objectId === CREVASSE_OBJECT_ID) {
      event.handled = true;
      event.player.moveTo(SUMMIT_EXIT.clone());
    }
  }

  // ==========================================================================
  // The Arrg fight
  // ==========================================================================

  function startArenaFight(player) {
    if (!arenaArrgByPlayer.has(player)) {
      const npc = api.spawnNpc({
        id: ARRG_ATTACKABLE_NPC_ID,
        x: ARENA_ARRG_SPAWN.getX(),
        y: ARENA_ARRG_SPAWN.getY(),
        z: ARENA_ARRG_SPAWN.getZ(),
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) arenaArrgByPlayer.set(player, npc);
    }
    player.moveTo(ARENA_TELEPORT.clone());
  }

  function removeArenaArrg(player) {
    const npc = arenaArrgByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    arenaArrgByPlayer.delete(player);
  }

  function handleNpcDeath({ killer, npcId, npc }) {
    if (npcId !== ARRG_ATTACKABLE_NPC_ID || !killer) return;
    arenaArrgByPlayer.delete(killer);
    npc?.forceChat?.("Arrg!");
    const stage = quest.getStage(killer);
    if (stage >= STAGE_FLOWER_GIVEN && stage < STAGE_ARRG_DEFEATED) {
      quest.setStage(killer, STAGE_ARRG_DEFEATED);
    }
  }

  function handleLogout({ player }) {
    if (player) removeArenaArrg(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "troll_romance",
    name: "Troll Romance",
    varpId: VARP_TROLL_LOVE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 8000, label: "Agility" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 4000, label: "Strength" },
    ],
    rewardItemId: SLED_ITEM_ID,
    rewardItemLabel: "A sled",
    otherRewards: [
      "1 uncut diamond, 2 uncut rubies, 4 uncut emeralds",
      "Sledding route from Trollweiss Mountain",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:choice", fixDunstanSledAnswer);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
