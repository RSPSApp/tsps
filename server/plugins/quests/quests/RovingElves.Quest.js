/**
 * Roving Elves (members).
 *
 * The words come from the "Roving Elves" transcript page; this plugin supplies the
 * variant selector for Islwyn and Eluned, the prose-condition answers, the start
 * hook, the tomb entry, the seed pickup and Eluned's enchant hand-over, and the
 * seed planting by the Chalice of Eternity. The consecration seed drop itself
 * comes from npc-drops.json (4205 with the Roving Elves requirement).
 *
 * Stages (varp 402 "roving_elves_quest"; the cache quest table row 122 gives
 * endstate 6, and quest script 4024 reads varp 402 for quest 122):
 *   0 not started, 1 started (Islwyn), 2 spoken to Eluned, 3 seed recovered,
 *   4 seed enchanted, 5 seed planted, 6 complete.
 *
 * Requirements (cache quest table row 122 requirement_quests): Regicide (119)
 * and Waterfall Quest (158); the start hook gates on Regicide through the
 * quest:is-complete custom event, as instructed. The pebble itself only exists
 * if Waterfall Quest has been played.
 *
 * NPCs: Islwyn 7780/8675, Eluned 5304/8766/8767, Ilfeen 8676/8769. The roving
 * pair is not in npc-spawns.json (the world spawns under those names are Song of
 * the Elves bodies), so a per-player owner-only copy of each is spawned at the
 * wiki start spot (2289,3146) once Regicide is complete, and removed on logout.
 *
 * Rewards (OSRS Wiki + cache row 122): 1 Quest point, 10,000 Strength XP and a
 * used crystal bow or crystal shield with 500 charges, chosen in the transcript.
 *
 * Gaps:
 *  - Glarial's Tomb restricted-items rule is not enforced; entry just needs the
 *    pebble (item on the tombstone) and the quest started.
 *  - The Waterfall Dungeon travel (raft/rope/doors) is not modelled, matching the
 *    Waterfall Quest plugin; the seed is planted in place in the throne room.
 *  - Ilfeen's post-quest crystal chant and Islwyn's 750k/900k bow/shield sales
 *    are not implemented; her post-quest first conversation plays from this page,
 *    later ones continue on the "Ilfeen" page.
 *  - Talking to a player who has not completed Regicide has no Roving Elves
 *    variant (the NPCs are not spawned for them).
 */
module.exports = function registerRovingElvesQuest(api) {
  const {
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const {
    registerQuest,
    refreshQuestList,
    startTranscript,
  } = require("../QuestRuntime");

  const PAGE = "Roving Elves";

  const ISLWYN_NPC_ID = NpcIdentifiers.ISLWYN; // 7780, the spawned start body
  const ELUNED_NPC_ID = NpcIdentifiers.ELUNED; // 8766, also the plant chathead
  const ILFEEN_NPC_ID = NpcIdentifiers.ILFEEN; // 8676
  const ISLWYN_NPC_IDS = new Set([NpcIdentifiers.ISLWYN, NpcIdentifiers.ISLWYN_2]); // 7780, 8675
  const ELUNED_NPC_IDS = new Set([
    NpcIdentifiers.ELUNED, // 8766
    NpcIdentifiers.ELUNED_2, // 5304
    NpcIdentifiers.ELUNED_3, // 8767
  ]);
  const ILFEEN_NPC_IDS = new Set([NpcIdentifiers.ILFEEN, NpcIdentifiers.ILFEEN_2]); // 8676, 8769
  const OWNED_NPC_IDS = new Set([...ISLWYN_NPC_IDS, ...ELUNED_NPC_IDS, ...ILFEEN_NPC_IDS]);

  const VARP_ROVING_ELVES = 402; // "roving_elves_quest"
  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_ELUNED = 2;
  const STAGE_HAS_SEED = 3;
  const STAGE_ENCHANTED = 4;
  const STAGE_PLANTED = 5;
  const STAGE_COMPLETE = 6;

  const GLARIALS_PEBBLE_ITEM_ID = ItemIdentifiers.GLARIALS_PEBBLE; // 294
  const OLD_SEED_ITEM_ID = ItemIdentifiers.CONSECRATION_SEED; // 4205, no Plant option
  const ENCHANTED_SEED_ITEM_ID = ItemIdentifiers.CONSECRATION_SEED_2; // 4206, Plant option
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952
  const NEW_CRYSTAL_BOW_ITEM_ID = ItemIdentifiers.NEW_CRYSTAL_BOW; // 4212
  const NEW_CRYSTAL_SHIELD_ITEM_ID = ItemIdentifiers.NEW_CRYSTAL_SHIELD; // 4224
  const STRENGTH_XP = 10000; // cache row 122 stat_xp_awarded [2, 100000]

  const GLARIALS_TOMBSTONE_OBJECT_ID = ObjectIdentifiers.GLARIALS_TOMBSTONE; // 1992
  const TOMB_LADDER_OBJECT_ID = ObjectIdentifiers.LADDER_218; // 17387, generic id shared by many ladders
  const TOMB_LADDER_TILE = { x: 2556, y: 9844, z: 0 }; // cache placement inside Glarial's Tomb
  const TOMB_ENTRY_TILE = { x: 2556, y: 9845, z: 0 };
  const TOMB_EXIT_TILE = { x: 2557, y: 3445, z: 0 };
  // quest-helper's throne room zone around the Chalice (2603,9910).
  const CHALICE_CAVERN_ZONE = { minX: 2599, maxX: 2608, minY: 9901, maxY: 9916, levels: [0] };

  const START_HOOK = "quest:roving-elves:start";

  const HAND_SEED_MESSAGE_ID = "MCntL9";
  const RECEIVE_ENCHANTED_MESSAGE_ID = "Bt02mM";
  const RECEIVE_REPLACEMENT_MESSAGE_ID = "yqMnm8";
  const COMPLETE_ACTION_ID = "xMZIqj";

  const NO_SPADE_VARIANT = "rest-in-peace-planting-the-seed-trying-to-plant-the-seed-without-a-spade";
  const WRONG_PLACE_VARIANT = "rest-in-peace-planting-the-seed-trying-to-plant-the-seed-at-an-incorrect-location";
  const PLANTED_VARIANT = "rest-in-peace-planting-the-seed-planting-the-seed-in-the-chalice-of-eternity-cavern";

  const ISLWYN_SPAWN_TILE = { x: 2289, y: 3146, z: 0 }; // cache row 122 startcoord (2289,3146)
  const ELUNED_SPAWN_TILE = { x: 2290, y: 3145, z: 0 };
  const ILFEEN_SPAWN_TILE = { x: 2291, y: 3148, z: 0 };
  const ILFEEN_MET_ATTRIBUTE = "quest.roving_elves.ilfeen-met";
  const REWARD_CHOICE_ATTRIBUTE = "quest.roving_elves.reward-choice";
  const REWARD_CHOICE_BOW = 1;
  const REWARD_CHOICE_SHIELD = 2;

  let quest;
  const rovingNpcsByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const hasOldSeed = (player) => held(player, OLD_SEED_ITEM_ID);
  const hasEnchantedSeed = (player) => held(player, ENCHANTED_SEED_ITEM_ID);

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function isInsideZone(zone, location) {
    const x = location.getX();
    const y = location.getY();
    const z = location.getZ();
    return (
      x >= zone.minX && x <= zone.maxX &&
      y >= zone.minY && y <= zone.maxY &&
      (!zone.levels || zone.levels.includes(z))
    );
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Islwyn consecrate Glarial's new resting place in</str>",
        "<str>the Waterfall Dungeon, and he rewarded me with crystal equipment.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_PLANTED) {
      return [
        "I planted the enchanted crystal seed close to Glarial's remains",
        "in the Chalice of Eternity cavern.",
        "I should tell <col=800000>Islwyn</col> the ritual is done.",
      ];
    }
    if (stage >= STAGE_ENCHANTED) {
      return hasEnchantedSeed(player)
        ? ["Eluned enchanted the consecration seed. I should plant it close",
           "to Glarial's remains in the Waterfall Dungeon.",
           "",
           "I will need a <col=800000>spade</col>."]
        : ["I lost the enchanted seed. <col=800000>Eluned</col> can make another."];
    }
    if (stage >= STAGE_HAS_SEED) {
      return [
        "I recovered the consecration seed from Glarial's old tomb.",
        "I should take it to <col=800000>Eluned</col> so she can enchant it.",
      ];
    }
    if (stage >= STAGE_SPOKEN_ELUNED) {
      return [
        "<col=800000>Eluned</col> told me to retrieve the consecration seed",
        "from Glarial's old tomb, south-east of Baxtorian Falls.",
        "A Moss Guardian in the tomb protects it.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Islwyn wants Glarial's new resting place consecrated before",
        "he will take me to Arianwyn.",
        "I should speak to <col=800000>Eluned</col> about the ritual.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Islwyn</col>",
      "in the elven woods of Isafdar.",
      "",
      "This quest has the following requirements:",
      "Regicide",
      "Waterfall Quest",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, STRENGTH_XP);
    give(player, chosenRewardItemId(player), 1);
  }

  function chosenRewardItemId(player) {
    const choice = Number(player.getAttribute(REWARD_CHOICE_ATTRIBUTE));
    if (choice === REWARD_CHOICE_SHIELD) return NEW_CRYSTAL_SHIELD_ITEM_ID;
    if (choice === REWARD_CHOICE_BOW) return NEW_CRYSTAL_BOW_ITEM_ID;
    const bankedShield = (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(NEW_CRYSTAL_SHIELD_ITEM_ID)
      || (bank?.getAmount?.(NEW_CRYSTAL_SHIELD_ITEM_ID) ?? 0) > 0);
    return held(player, NEW_CRYSTAL_SHIELD_ITEM_ID) || bankedShield
      ? NEW_CRYSTAL_SHIELD_ITEM_ID
      : NEW_CRYSTAL_BOW_ITEM_ID;
  }

  // ==========================================================================
  // Dialogue variants and conditions
  // ==========================================================================

  function islwynVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-islwyn";
    if (stage >= STAGE_PLANTED) return "rest-in-peace-talking-to-islwyn";
    if (stage >= STAGE_ENCHANTED) return "enchanting-the-seed-talking-to-islwyn-after-enchanting-the-crystal-seed";
    if (stage >= STAGE_HAS_SEED) {
      return hasOldSeed(player)
        ? "enchanting-the-seed-talking-to-islwyn-with-the-crystal-seed"
        : "consecrating-the-tomb-talking-to-islwyn-again";
    }
    if (stage >= STAGE_SPOKEN_ELUNED) return "consecrating-the-tomb-talking-to-islwyn-again";
    if (stage >= STAGE_STARTED) return "roving-elves-talking-to-islwyn-again";
    return "roving-elves-talking-to-islwyn-or-eluned";
  }

  function elunedVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-eluned";
    if (stage >= STAGE_PLANTED) return "rest-in-peace-talking-to-eluned";
    if (stage >= STAGE_ENCHANTED) {
      return hasEnchantedSeed(player)
        ? "enchanting-the-seed-talking-to-eluned-with-the-enchanted-seed"
        : "enchanting-the-seed-talking-to-eluned-after-losing-the-enchanted-seed";
    }
    if (stage >= STAGE_HAS_SEED) {
      return hasOldSeed(player)
        ? "enchanting-the-seed-talking-to-eluned-with-the-crystal-seed"
        : "consecrating-the-tomb-talking-to-eluned-again";
    }
    // Quest Helper checks the seed in the inventory/bank before its stage-3
    // conditional, so a player who entered the tomb before speaking to Eluned
    // still hands the seed straight over.
    if (stage >= STAGE_STARTED && hasOldSeed(player)) {
      quest.setStage(player, STAGE_HAS_SEED);
      return "enchanting-the-seed-talking-to-eluned-with-the-crystal-seed";
    }
    if (stage >= STAGE_SPOKEN_ELUNED) return "consecrating-the-tomb-talking-to-eluned-again";
    if (stage >= STAGE_STARTED) {
      quest.setStage(player, STAGE_SPOKEN_ELUNED);
      return "consecrating-the-tomb-talking-to-eluned";
    }
    return "roving-elves-talking-to-islwyn-or-eluned";
  }

  function ilfeenVariant(player) {
    if (quest.getStage(player) < STAGE_COMPLETE) return "roving-elves-talking-to-ilfeen";
    if (Number(player.getAttribute(ILFEEN_MET_ATTRIBUTE)) !== 1) {
      player.setAttribute(ILFEEN_MET_ATTRIBUTE, 1);
      return "post-quest-talking-to-ilfeen-for-the-first-time-after-the-quest";
    }
    return { page: "Ilfeen", variant: "after-roving-elves-after-the-first-time" };
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (ISLWYN_NPC_IDS.has(npcId)) return islwynVariant(player);
    if (ELUNED_NPC_IDS.has(npcId)) return elunedVariant(player);
    if (ILFEEN_NPC_IDS.has(npcId)) return ilfeenVariant(player);
    return null;
  }

  /** Prose conditions on the Roving Elves/Ilfeen pages this plugin owns. */
  function answerCondition({ npcId, player, text }) {
    if (!player || !OWNED_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("inventory space")) return player.getInventory().isFull();
    if (value.includes("eyes of glouphrie")) return questComplete(player, "the_eyes_of_glouphrie");
    const mourningStart = canProceedToMourningsEnd(player);
    if (value.includes("without the requirements for mourning")) return !mourningStart;
    if (value.includes("with the requirements for mourning")) return mourningStart;
    return null;
  }

  function canProceedToMourningsEnd(player) {
    if (!quest.isComplete(player)) return false;
    const request = { player, started: false, meetsRequirements: false };
    api.emitCustomEvent("mournings-end-part-i:start-requirements", request);
    return request.started === true || request.meetsRequirements === true;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!player || hook !== START_HOOK) return;
    if (!ISLWYN_NPC_IDS.has(npcId) && !ELUNED_NPC_IDS.has(npcId)) return;
    if (!questComplete(player, "regicide")) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The wiki's hand-over and completion messages carry the item state. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId || !OWNED_NPC_IDS.has(npcId)) return;
    if (stepId === HAND_SEED_MESSAGE_ID) {
      if (hasOldSeed(player)) take(player, OLD_SEED_ITEM_ID, 1);
      return;
    }
    if (stepId === RECEIVE_ENCHANTED_MESSAGE_ID) {
      if (!hasEnchantedSeed(player)) give(player, ENCHANTED_SEED_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_ENCHANTED) quest.setStage(player, STAGE_ENCHANTED);
      return;
    }
    if (stepId === RECEIVE_REPLACEMENT_MESSAGE_ID) {
      if (!hasEnchantedSeed(player)) give(player, ENCHANTED_SEED_ITEM_ID, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      // The transcript's full-bag branch says Islwyn has no room to hand over
      // the crystal creation. Keep the quest at the planted stage so the player
      // can free a slot and talk to him again instead of losing the reward.
      if (!quest.isComplete(player) && !player.getInventory().isFull()) quest.complete(player);
      event.handled = true;
    }
  }

  /** Which crystal creation Islwyn is handing over at the end. */
  function handleRewardChoice({ player, npcId, option }) {
    if (!player || !ISLWYN_NPC_IDS.has(npcId)) return;
    const value = String(option ?? "").toLowerCase();
    if (value.includes("bow")) player.setAttribute(REWARD_CHOICE_ATTRIBUTE, REWARD_CHOICE_BOW);
    else if (value.includes("shield")) player.setAttribute(REWARD_CHOICE_ATTRIBUTE, REWARD_CHOICE_SHIELD);
  }

  // ==========================================================================
  // Tomb entry / seed planting / Moss Guardian
  // ==========================================================================

  /** The pebble opens the tomb; the player appears by the ladder inside. */
  function handlePebbleOnTombstone(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== GLARIALS_PEBBLE_ITEM_ID || objectId !== GLARIALS_TOMBSTONE_OBJECT_ID) return;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    event.handled = true;
    player.moveTo(new Location(TOMB_ENTRY_TILE.x, TOMB_ENTRY_TILE.y, TOMB_ENTRY_TILE.z));
  }

  /** The tomb ladder climbs back up beside the tombstone (no map link exists). */
  function claimTombLadder(request) {
    if (!request || request.objectId !== TOMB_LADDER_OBJECT_ID) return;
    const at = request.object?.getLocation?.();
    if (!at || at.getX() !== TOMB_LADDER_TILE.x || at.getY() !== TOMB_LADDER_TILE.y
      || at.getZ() !== TOMB_LADDER_TILE.z) return;
    request.handled = true;
    request.player.moveTo(new Location(TOMB_EXIT_TILE.x, TOMB_EXIT_TILE.y, TOMB_EXIT_TILE.z));
  }

  /** Moss Guardians drop the consecration seed via npc-drops.json; picking it up advances the stage. */
  function handleSeedPickup(event) {
    const { player, groundItemId } = event;
    if (!player || groundItemId !== OLD_SEED_ITEM_ID) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_HAS_SEED && player.getInventory().getFreeSlots() > 0) {
      quest.setStage(player, STAGE_HAS_SEED);
    }
  }

  /** The enchanted seed's Plant option replays the wiki plant messages. */
  function handleItemAction(event) {
    const { player, itemId } = event;
    if (!player || itemId !== ENCHANTED_SEED_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("plant")) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_ENCHANTED || stage >= STAGE_PLANTED) return;
    event.handled = true;
    if (!held(player, SPADE_ITEM_ID)) {
      startTranscript(api, player, ELUNED_NPC_ID, PAGE, NO_SPADE_VARIANT);
      return;
    }
    if (!isInsideZone(CHALICE_CAVERN_ZONE, player.getLocation())) {
      startTranscript(api, player, ELUNED_NPC_ID, PAGE, WRONG_PLACE_VARIANT);
      return;
    }
    take(player, ENCHANTED_SEED_ITEM_ID, 1);
    quest.setStage(player, STAGE_PLANTED);
    startTranscript(api, player, ELUNED_NPC_ID, PAGE, PLANTED_VARIANT);
  }

  // ==========================================================================
  // NPC spawning (owner-only roving pair, only reachable after Regicide)
  // ==========================================================================

  function spawnRovingNpc(player, id, tile) {
    return api.spawnNpc({
      id,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function spawnRovingElves(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (rovingNpcsByPlayer.has(player)) return;
    if (!questComplete(player, "regicide")) return;
    const spawned = [
      spawnRovingNpc(player, ISLWYN_NPC_ID, ISLWYN_SPAWN_TILE),
      spawnRovingNpc(player, ELUNED_NPC_ID, ELUNED_SPAWN_TILE),
      spawnRovingNpc(player, ILFEEN_NPC_ID, ILFEEN_SPAWN_TILE),
    ].filter(Boolean);
    rovingNpcsByPlayer.set(player, spawned);
  }

  function removeRovingElves(player) {
    const spawned = rovingNpcsByPlayer.get(player);
    if (!spawned) return;
    for (const npc of spawned) api.removeNpc(npc);
    rovingNpcsByPlayer.delete(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    refreshQuestList(player);
    spawnRovingElves(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    removeRovingElves(player);
  }

  /** Completing Regicide while online must make the roving pair spawn without a relog. */
  function handleQuestCompleted({ player, key }) {
    if (!player || key !== "regicide") return;
    spawnRovingElves(player);
  }

  api.persistAttribute(ILFEEN_MET_ATTRIBUTE, 0);
  api.persistAttribute(REWARD_CHOICE_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "roving_elves",
    name: "Roving Elves",
    varpId: VARP_ROVING_ELVES,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.STRENGTH.getIndex(), amount: STRENGTH_XP, label: "Strength" }],
    scrollItemId: chosenRewardItemId,
    rewardItemLabel: "Crystal bow or crystal shield",
    otherRewards: ["Ability to wield crystal equipment"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleRewardChoice);
  api.onCustomEvent("ladders:climb", claimTombLadder);
  api.onItemOnObject(handlePebbleOnTombstone, { noted: false });
  api.onItemAction(handleItemAction);
  api.onGroundItemPickup(handleSeedPickup);
  api.onCustomEvent("quest:completed", handleQuestCompleted);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
