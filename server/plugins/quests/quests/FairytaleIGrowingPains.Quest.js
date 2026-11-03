/**
 * Fairytale I - Growing Pains (members).
 *
 * The words come from the "Fairytale I - Growing Pains" transcript page; the
 * shared "Gatekeeper" and "Fairy Nuff" pages supply the refusal at the shady-grove
 * gap and Nuff's post-quest line (both indexed to the same NPCs).
 *
 * Stages (varp 671 "fairytale_multi", varbit 1803 "fairy_farmers_quest" bits
 * 0-6, confirmed with scripts/lookup-gameval.ts). The cache's NPC and loc
 * transforms only resolve at multiples of 10, so every stage is one:
 *   0 not started,
 *   10 Martin asked me to talk to five gardeners,
 *   20 five gardeners reported (Martin sends me to a fairy),
 *   30 Fairy Nuff gave me the symptoms list,
 *   40 Zandar Horfyre diagnosed the Queen,
 *   50 Malignius Mortifer taught me the recipe,
 *   60 the Nature Spirit enchanted my secateurs,
 *   70 the Tanglefoot is dead and I have the Queen's secateurs,
 *   80 complete.
 *
 * Varbits sharing varp 671: 1804-1806 hold the three randomised nature items
 * (positions 1-31 in the wiki's ordered table); 1807 hides the throne Queen and
 * shows her bed in Nuff's room (spawned 5849 -> 1161, loc 12002 -> 12090);
 * 1808 shows the Fairy Godfather and his henchmen (spawned 5850-5852 transform
 * to 5837-5839); 1803 itself turns the grove gatekeeper 6534 into 5855 and the
 * gap/wall locs 11999-12001.
 *
 * Source: OSRS Wiki (Fairytale I - Growing Pains, its quick guide and transcript).
 * Rewards per the wiki: 2 Quest points, the magic secateurs (already made during
 * the quest), 3,500 Farming / 2,000 Attack / 1,000 Magic XP. The fairy rings the
 * task brief mentions are the Fairytale II reward, not this quest's.
 *
 * Gaps/approximations:
 * - Zandar's page has only the diagnosis variant. His own transcript record is
 *   empty, so the selector must never return null (the shared page would leak
 *   Martin's start conversation); a post-diagnosis re-talk replays the no-list
 *   branch.
 * - Fairy Nuff has no "I still have the list" variant; talking to her while
 *   holding it falls back to her standard-page dialogue.
 * - The grove's north-west chamber is sealed in the cache's static clipping, so
 *   the fight happens in the connected tunnel south of the entrance (the
 *   transcript's "appears in the grove" action teleports there).
 * - The Tanglefoot is spawned per player (it is absent from npc-spawns.json).
 *   Only magic secateurs damage it; the wiki's ring-of-recoil exception is not
 *   modelled, and normal secateurs have no Wield option, so enchanting consumes
 *   them from the inventory.
 * - The wiki prose is authored for the two dig and damage messages, which no
 *   transcript page carries.
 */
module.exports = function registerFairytaleIGrowingPainsQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    Misc,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Fairytale I - Growing Pains";
  const GATEKEEPER_PAGE = "Gatekeeper";

  const MARTIN_NPC_ID = NpcIdentifiers.MARTIN_THE_MASTER_GARDENER; // 5832
  const FAIRY_NUFF_NPC_IDS = new Set([NpcIdentifiers.FAIRY_NUFF, NpcIdentifiers.FAIRY_NUFF_2]); // 1841, 5836
  const FAIRY_GODFATHER_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_GODFATHER,
    NpcIdentifiers.FAIRY_GODFATHER_2, // 1840, 5837
  ]);
  const ZANDAR_NPC_ID = NpcIdentifiers.ZANDAR_HORFYRE; // 5841
  const MALIGNIUS_NPC_ID = NpcIdentifiers.MALIGNIUS_MORTIFER; // 1783
  const NATURE_SPIRIT_NPC_IDS = new Set([NpcIdentifiers.NATURE_SPIRIT, NpcIdentifiers.FILLIMAN_TARLOCK]); // 944, 943
  const GATEKEEPER_NPC_ID = NpcIdentifiers.GATEKEEPER_2; // 5855, the grove guard (6534 transformed)
  const TANGLEFOOT_NPC_ID = NpcIdentifiers.TANGLEFOOT; // 5848

  // Group of Advanced Gardeners members that predate Old School RuneScape.
  const GARDENER_NPC_IDS = new Set([
    NpcIdentifiers.ELSTAN, // 2663
    NpcIdentifiers.DANTAERA, // 2664
    NpcIdentifiers.KRAGEN, // 2665
    NpcIdentifiers.LYRA, // 2666
    NpcIdentifiers.FRANCIS, // 2667
    NpcIdentifiers.GARTH, // 2669
    NpcIdentifiers.ELLENA, // 2670
    NpcIdentifiers.SELENA, // 2671
    NpcIdentifiers.VASQUEN, // 2672
    NpcIdentifiers.RHONEN, // 2673
    NpcIdentifiers.DREVEN, // 2674
    NpcIdentifiers.TARIA, // 2675
    NpcIdentifiers.RHAZIEN, // 2676
    NpcIdentifiers.TORRELL, // 2677
    NpcIdentifiers.ALAIN, // 2678
    NpcIdentifiers.HESKEL, // 2679
    NpcIdentifiers.TREZNOR, // 2680
    NpcIdentifiers.FAYETH, // 2681
    NpcIdentifiers.BOLONGO, // 2682
    NpcIdentifiers.GILETH, // 2683
    NpcIdentifiers.FRIZZY_SKERNIP, // 2684
    NpcIdentifiers.YULF_SQUECKS, // 2685
    NpcIdentifiers.PRAISTAN_EBOLA, // 2686
    NpcIdentifiers.PRISSY_SCILLA, // 2687
    NpcIdentifiers.LILIWEN, // 2689
    NpcIdentifiers.GARDENER, // 3275
    NpcIdentifiers.GARDENER_2, // 3276
    NpcIdentifiers.GARDENER_3, // 3651
    NpcIdentifiers.GARDENER_4, // 5512
    NpcIdentifiers.TREZNOR_2, // 11957
  ]);
  // Farmers added after the OSRS launch: the invalid-gardener answer.
  const INVALID_GARDENER_NPC_IDS = new Set([
    NpcIdentifiers.AYESHA, // 310
    NpcIdentifiers.IMIAGO, // 2688
    NpcIdentifiers.LAMMY_LANGLE, // 6814
    NpcIdentifiers.MARISI, // 6921
  ]);

  const STAGE_STARTED = 10;
  const STAGE_GARDENERS_REPORTED = 20;
  const STAGE_HAS_SYMPTOMS_LIST = 30;
  const STAGE_DIAGNOSED = 40;
  const STAGE_HAS_RECIPE = 50;
  const STAGE_HAS_MAGIC_SECATEURS = 60;
  const STAGE_TANGLEFOOT_DEFEATED = 70;
  const STAGE_COMPLETE = 80;

  const VARP_FAIRYTALE = 671;
  const VARBIT_FAIRYTALE_QUEST = 1803; // "fairy_farmers_quest", bits 0-6
  const VARBIT_NATURE_ITEM_1 = 1804; // "fairy_nature_item1", bits 7-11
  const VARBIT_NATURE_ITEM_2 = 1805; // "fairy_nature_item2", bits 12-16
  const VARBIT_NATURE_ITEM_3 = 1806; // "fairy_nature_item3", bits 17-21
  const VARBIT_FAIRY_QUEEN_CHECK = 1807; // 1 = Queen in Nuff's room, not on the throne
  const VARBIT_FAIRY_GODFATHER_CHECK = 1808; // 1 = Godfather and henchmen visible

  const GARDENERS_ATTRIBUTE = "quest.fairytale-i-growing-pains:gardeners";
  const MALIGNIUS_ASKED_ATTRIBUTE = "quest.fairytale-i-growing-pains:malignius-asked";
  const NATURE_ITEMS_ATTRIBUTE = "quest.fairytale-i-growing-pains:nature-items";

  const SECATEURS_ITEM_ID = ItemIdentifiers.SECATEURS; // 5329
  const MAGIC_SECATEURS_ITEM_ID = ItemIdentifiers.MAGIC_SECATEURS; // 7409
  const QUEENS_SECATEURS_ITEM_ID = ItemIdentifiers.QUEENS_SECATEURS; // 7410
  const SYMPTOMS_LIST_ITEM_ID = ItemIdentifiers.SYMPTOMS_LIST; // 7411
  const DRAYNOR_SKULL_ITEM_ID = ItemIdentifiers.DRAYNOR_SKULL; // 7408
  const GHOSTSPEAK_AMULET_ITEM_ID = ItemIdentifiers.GHOSTSPEAK_AMULET; // 552
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952

  const DRAYNOR_GRAVE_OBJECT_ID = ObjectIdentifiers.GRAVESTONE_8; // 12125 at 3106,3384
  const DRAYNOR_GRAVE_TILE = new Location(3106, 3384, 0);
  const NUFF_HANDOVER_LINES = [
    "I believe he now resides in the Dark Wizard's tower near Falador,",
    "Well not to worry, I have a copy of it here.",
  ];
  // 12004 is the static gap at 2397,4379; 11999 is the placed loc at 2399,4379
  // whose varbit-1803 transform is 12041 "A gap through the wall". Object click
  // events carry the placed id, and 11999 has no generated identifier.
  const GROVE_WALL_OBJECT_ID = 11999; // 11999 -> 12041 during the quest
  const GROVE_GAP_OBJECT_IDS = new Set([
    ObjectIdentifiers.A_GAP_THROUGH_THE_WALL, // 12004
    GROVE_WALL_OBJECT_ID, // 11999
  ]);

  /** The wiki's ordered nature-item list; a run of three consecutive positions. */
  const NATURE_ITEMS = [
    { id: ItemIdentifiers.WHITE_BERRIES, name: "white berries" },
    { id: ItemIdentifiers.MORT_MYRE_PEAR, name: "a mort myre pear" },
    { id: ItemIdentifiers.MORT_MYRE_STEM, name: "a mort myre stem" },
    { id: ItemIdentifiers.MORT_MYRE_FUNGUS, name: "a mort myre fungus" },
    { id: ItemIdentifiers.NATURE_TALISMAN, name: "a nature talisman" },
    { id: ItemIdentifiers.AVANTOE, name: "clean avantoe" },
    { id: ItemIdentifiers.IRIT_LEAF, name: "clean irit leaf" },
    { id: ItemIdentifiers.BLUE_DRAGON_SCALE, name: "a blue dragon scale" },
    { id: ItemIdentifiers.PROBOSCIS, name: "a proboscis" },
    { id: ItemIdentifiers.JANGERBERRIES, name: "jangerberries" },
    { id: ItemIdentifiers.POTATO_CACTUS, name: "a potato cactus" },
    { id: ItemIdentifiers.CRUSHED_GEM, name: "a crushed gem" },
    { id: ItemIdentifiers.SNAPDRAGON, name: "clean snapdragon" },
    { id: ItemIdentifiers.SUPERCOMPOST, name: "supercompost" },
    { id: ItemIdentifiers.VOLENCIA_MOSS, name: "clean volencia moss" },
    { id: ItemIdentifiers.BABYDRAGON_BONES, name: "babydragon bones" },
    { id: ItemIdentifiers.UNCUT_DIAMOND, name: "an uncut diamond" },
    { id: ItemIdentifiers.RAW_CAVE_EEL, name: "a raw cave eel" },
    { id: ItemIdentifiers.EDIBLE_SEAWEED, name: "edible seaweed" },
    { id: ItemIdentifiers.OYSTER, name: "an unopened oyster" },
    { id: ItemIdentifiers.CHARCOAL, name: "charcoal" },
    { id: ItemIdentifiers.RED_VINE_WORM, name: "a red vine worm" },
    { id: ItemIdentifiers.FAT_SNAIL, name: "a fat snail" },
    { id: ItemIdentifiers.RED_SPIDERS_EGGS, name: "red spiders' eggs" },
    { id: ItemIdentifiers.RAW_SLIMY_EEL, name: "a raw slimy eel" },
    { id: ItemIdentifiers.GRAPES, name: "grapes" },
    { id: ItemIdentifiers.UNCUT_RUBY, name: "an uncut ruby" },
    { id: ItemIdentifiers.JOGRE_BONES, name: "jogre bones" },
    { id: ItemIdentifiers.KING_WORM, name: "a king worm" },
    { id: ItemIdentifiers.SNAPE_GRASS, name: "snape grass" },
    { id: ItemIdentifiers.LIME, name: "a lime" },
  ];

  // Transcript step ids.
  const ZANDAR_HAS_LIST_CONDITION_ID = "p_F3FX";
  const MALIGNIUS_HAS_SKULL_CONDITION_ID = "k3Tam3";
  const MALIGNIUS_NO_SKULL_CONDITION_ID = "9eMl-y";
  const NATURE_HAS_ITEMS_CONDITION_ID = "vEqy6a";
  const NATURE_NO_ITEMS_CONDITION_ID = "bOMXdk";
  const LOST_SECATEURS_CONDITION_ID = "jC0-xh";
  const ENCHANT_ACTION_ID = "JQyqMZ";
  const GROVE_ENTER_ACTION_ID = "EwGK2L";
  const GROVE_REENTER_ACTION_ID = "HxBLkD";
  const RECEIVE_SECATEURS_ACTION_ID = "pZt1sS";
  const COMPLETE_ACTION_ID = "Z_ZWiI";

  const START_HOOK = "quest:fairytale-i-growing-pains:start";
  const GARDENER_QUESTION = "Are you a member of the Group of Advanced Gardeners?";

  const GATEKEEPER_REFUSAL_VARIANT =
    "gatekeeper-near-the-entrance-to-the-tanglefoot-s-lair-attempting-to-enter-the-shady-grove-without-magic-secateurs";
  const GATEKEEPER_AFTER_VARIANT =
    "gatekeeper-near-the-entrance-to-the-tanglefoot-s-lair-after-fairytale-i";
  const ZANDAR_VARIANT = "at-the-dark-wizard-s-tower-talking-to-zandar-horfyre";

  // The tunnel south of the gap; the sealed north-west chamber is not simulated.
  const GROVE_ENTRY = { x: 2394, y: 4379, z: 0 };
  const GROVE_EXIT = { x: 2400, y: 4379, z: 0 };
  const TANGLEFOOT_SPAWN = { x: 2395, y: 4358, z: 0 };
  const GROVE_ZONE = {
    minX: 2388,
    maxX: 2396,
    minY: 4354,
    maxY: 4384,
    levels: [0],
  };

  let quest;
  const tanglefootByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function advance(player, value) {
    if (quest.getStage(player) < value && !quest.isComplete(player)) quest.setStage(player, value);
  }

  function actionOf(event) {
    return String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  function askedGardeners(player) {
    return String(player.getAttribute(GARDENERS_ATTRIBUTE) ?? "")
      .split(",")
      .map(Number)
      .filter((npcId) => Number.isInteger(npcId) && npcId > 0);
  }

  function wearingGhostspeak(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ITEM_ID;
  }

  function natureItemPositions(player) {
    return String(player.getAttribute(NATURE_ITEMS_ATTRIBUTE) ?? "")
      .split(",")
      .map(Number)
      .filter((position) => position >= 1 && position <= NATURE_ITEMS.length);
  }

  function requiredNatureItems(player) {
    return natureItemPositions(player).map((position) => NATURE_ITEMS[position - 1]);
  }

  function heldNatureItemIds(player) {
    return requiredNatureItems(player).map((entry) => entry.id);
  }

  function hasEnchantingItems(player) {
    const ids = heldNatureItemIds(player);
    return ids.length === 3 && held(player, SECATEURS_ITEM_ID) && ids.every((id) => held(player, id));
  }

  function giveSymptomsList(player) {
    if (!held(player, SYMPTOMS_LIST_ITEM_ID)) player.getInventory().adds(SYMPTOMS_LIST_ITEM_ID, 1);
    return held(player, SYMPTOMS_LIST_ITEM_ID);
  }

  function rollNatureItems(player) {
    const first = Misc.randomInclusive(1, NATURE_ITEMS.length - 2);
    const positions = [first, first + 1, first + 2];
    player.setAttribute(NATURE_ITEMS_ATTRIBUTE, positions.join(","));
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_NATURE_ITEM_1, positions[0]);
    sender.sendVarbit(VARBIT_NATURE_ITEM_2, positions[1]);
    sender.sendVarbit(VARBIT_NATURE_ITEM_3, positions[2]);
  }

  function sendProgressVarbits(player) {
    const sender = player.getPacketSender();
    const started = quest.getStage(player) >= STAGE_STARTED;
    sender.sendVarbit(VARBIT_FAIRY_QUEEN_CHECK, started ? 1 : 0);
    sender.sendVarbit(VARBIT_FAIRY_GODFATHER_CHECK, started ? 1 : 0);
    const positions = natureItemPositions(player);
    sender.sendVarbit(VARBIT_NATURE_ITEM_1, positions[0] ?? 0);
    sender.sendVarbit(VARBIT_NATURE_ITEM_2, positions[1] ?? 0);
    sender.sendVarbit(VARBIT_NATURE_ITEM_3, positions[2] ?? 0);
  }

  function insideGrove(player) {
    const location = player.getLocation?.();
    if (!location || location.getZ() !== GROVE_ZONE.levels[0]) return false;
    return (
      location.getX() >= GROVE_ZONE.minX &&
      location.getX() <= GROVE_ZONE.maxX &&
      location.getY() >= GROVE_ZONE.minY &&
      location.getY() <= GROVE_ZONE.maxY
    );
  }

  /** The Tanglefoot exists only while the player on stage 60 is in its tunnel. */
  function ensureTanglefoot(player) {
    if (quest.getStage(player) !== STAGE_HAS_MAGIC_SECATEURS) return;
    const existing = tanglefootByPlayer.get(player);
    if (existing && existing.isRegistered?.() !== false) return;
    const npc = api.spawnNpc({
      id: TANGLEFOOT_NPC_ID,
      x: TANGLEFOOT_SPAWN.x,
      y: TANGLEFOOT_SPAWN.y,
      z: TANGLEFOOT_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) tanglefootByPlayer.set(player, npc);
  }

  function removeTanglefoot(player) {
    const npc = tanglefootByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    tanglefootByPlayer.delete(player);
  }

  // ==========================================================================
  // Transcript selection
  // ==========================================================================

  function martinVariant(player, stage) {
    if (stage >= STAGE_GARDENERS_REPORTED) return null;
    if (stage < STAGE_STARTED) return "starting-the-quest";
    const asked = askedGardeners(player);
    if (asked.length >= 5) {
      advance(player, STAGE_GARDENERS_REPORTED);
      return "talking-to-the-gardeners-returning-to-martin";
    }
    if (asked.length > 0) {
      return `talking-to-the-gardeners-gardener-${asked.length}-reporting-to-martin`;
    }
    return "starting-the-quest-talking-to-martin-again";
  }

  function nuffVariant(player, stage) {
    if (stage >= STAGE_TANGLEFOOT_DEFEATED && stage < STAGE_COMPLETE) {
      return "after-defeating-the-tanglefoot-returning-to-fairy-nuff-first";
    }
    if (stage >= STAGE_DIAGNOSED) return "after-fairytale-part-1";
    if (stage >= STAGE_HAS_SYMPTOMS_LIST) {
      if (held(player, SYMPTOMS_LIST_ITEM_ID)) return null;
      return "entering-zanaris-talking-to-fairy-nuff-again";
    }
    if (stage >= STAGE_GARDENERS_REPORTED) {
      return "entering-zanaris-talking-to-fairy-nuff";
    }
    return null;
  }

  function godfatherVariant(stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) {
      return "after-defeating-the-tanglefoot-returning-to-the-fairy-godfather";
    }
    if (stage >= STAGE_DIAGNOSED) return "entering-zanaris-trying-to-talk-to-the-fairy-godfather-again";
    if (stage >= STAGE_STARTED) return "entering-zanaris-talking-to-the-fairy-godfather";
    return null;
  }

  function maligniusVariant(player, stage) {
    if (stage < STAGE_DIAGNOSED) return null;
    if (stage >= STAGE_HAS_RECIPE) {
      return "talking-to-malignius-mortifer-talking-to-malignius-again-after-learning-how-to-kill-the-tanglefoot";
    }
    if (held(player, DRAYNOR_SKULL_ITEM_ID)) return "talking-to-malignius-mortifer";
    if (Number(player.getAttribute(MALIGNIUS_ASKED_ATTRIBUTE)) > 0) {
      return "talking-to-malignius-mortifer-talking-to-malignius-again-before-getting-the-skull";
    }
    return "talking-to-malignius-mortifer";
  }

  function natureSpiritVariant(player, stage) {
    if (stage >= STAGE_HAS_RECIPE && stage < STAGE_HAS_MAGIC_SECATEURS) {
      if (!wearingGhostspeak(player)) return "in-the-nature-grotto-without-a-ghostspeak-amulet";
      return "in-the-nature-grotto-talking-to-the-nature-spirit";
    }
    if (
      stage >= STAGE_HAS_MAGIC_SECATEURS &&
      stage < STAGE_COMPLETE &&
      !held(player, MAGIC_SECATEURS_ITEM_ID)
    ) {
      return "in-the-nature-grotto-talking-to-the-nature-spirit-after-losing-the-secateurs";
    }
    return null;
  }

  function gatekeeperVariant(stage) {
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) return GATEKEEPER_AFTER_VARIANT;
    if (stage >= STAGE_STARTED) return "shady-grove";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === MARTIN_NPC_ID) return martinVariant(player, stage);
    if (FAIRY_NUFF_NPC_IDS.has(npcId)) return nuffVariant(player, stage);
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId)) return godfatherVariant(stage);
    if (npcId === ZANDAR_NPC_ID) return ZANDAR_VARIANT;
    if (npcId === MALIGNIUS_NPC_ID) return maligniusVariant(player, stage);
    if (NATURE_SPIRIT_NPC_IDS.has(npcId)) return natureSpiritVariant(player, stage);
    if (npcId === GATEKEEPER_NPC_ID) return gatekeeperVariant(stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (npcId === MARTIN_NPC_ID) {
      // The start conversation branches on pickpocketing Martin; only the
      // no-pickpocket and Farming-trained answers are modelled.
      if (stepId === "nWr7FB") return false;
      if (stepId === "7kb35l") return true;
      if (stepId === "O3O0GH") return player.getSkillManager().getMaxLevel(Skill.FARMING) <= 1;
      if (stepId === "qeSx96") return player.getSkillManager().getMaxLevel(Skill.FARMING) > 1;
      return null;
    }
    if (npcId === ZANDAR_NPC_ID) {
      if (stepId === ZANDAR_HAS_LIST_CONDITION_ID) return held(player, SYMPTOMS_LIST_ITEM_ID);
      if (stepId === "g4MTNC") return !held(player, SYMPTOMS_LIST_ITEM_ID);
      return null;
    }
    if (npcId === MALIGNIUS_NPC_ID) {
      if (stepId === MALIGNIUS_HAS_SKULL_CONDITION_ID) return held(player, DRAYNOR_SKULL_ITEM_ID);
      if (stepId === MALIGNIUS_NO_SKULL_CONDITION_ID) return !held(player, DRAYNOR_SKULL_ITEM_ID);
      return null;
    }
    if (NATURE_SPIRIT_NPC_IDS.has(npcId)) {
      if (stepId === NATURE_HAS_ITEMS_CONDITION_ID) return hasEnchantingItems(player);
      if (stepId === NATURE_NO_ITEMS_CONDITION_ID) return !hasEnchantingItems(player);
      return null;
    }
    if (npcId === GATEKEEPER_NPC_ID) {
      if (stepId === LOST_SECATEURS_CONDITION_ID) return !held(player, QUEENS_SECATEURS_ITEM_ID);
      return null;
    }
    return null;
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleNuffDialogueLine(event) {
    if (!FAIRY_NUFF_NPC_IDS.has(event.npcId) || !NUFF_HANDOVER_LINES.some(line => event.text.startsWith(line))) return;
    event.after = () => {
      const stage = quest.getStage(event.player);
      if (stage < STAGE_GARDENERS_REPORTED || stage >= STAGE_DIAGNOSED) return;
      if (giveSymptomsList(event.player)) advance(event.player, STAGE_HAS_SYMPTOMS_LIST);
    };
  }

  function handleDialogueChoice({ player, npcId, option }) {
    if (option !== GARDENER_QUESTION) return;
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (!GARDENER_NPC_IDS.has(npcId)) return;
    const asked = askedGardeners(player);
    if (asked.length >= 5 || asked.includes(npcId)) return;
    asked.push(npcId);
    player.setAttribute(GARDENERS_ATTRIBUTE, asked.join(","));
  }

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== MARTIN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) {
      const missing = [
        { key: "lost_city", name: "Lost City" },
        { key: "nature_spirit", name: "Nature Spirit" },
      ].filter((requirement) => !questIsComplete(player, requirement.key));
      if (missing.length > 0) {
        for (const requirement of missing) {
          player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
        }
        return;
      }
    }
    advance(player, STAGE_STARTED);
    sendProgressVarbits(player);
  }

  function handleConditionEvent({ player, npcId, stepId }) {
    if (npcId === ZANDAR_NPC_ID && stepId === ZANDAR_HAS_LIST_CONDITION_ID) {
      if (quest.getStage(player) !== STAGE_HAS_SYMPTOMS_LIST) return;
      if (!held(player, SYMPTOMS_LIST_ITEM_ID)) return;
      player.getInventory().deleteNumber(SYMPTOMS_LIST_ITEM_ID, 1);
      advance(player, STAGE_DIAGNOSED);
      return;
    }
    if (npcId !== MALIGNIUS_NPC_ID) return;
    if (stepId === MALIGNIUS_NO_SKULL_CONDITION_ID) {
      if (quest.getStage(player) === STAGE_DIAGNOSED) {
        player.setAttribute(MALIGNIUS_ASKED_ATTRIBUTE, 1);
      }
      return;
    }
    if (stepId !== MALIGNIUS_HAS_SKULL_CONDITION_ID) return;
    if (quest.getStage(player) !== STAGE_DIAGNOSED) return;
    if (!held(player, DRAYNOR_SKULL_ITEM_ID)) return;
    player.getInventory().deleteNumber(DRAYNOR_SKULL_ITEM_ID, 1);
    rollNatureItems(player);
    advance(player, STAGE_HAS_RECIPE);
  }

  function enchantSecateurs(player) {
    const ids = heldNatureItemIds(player);
    if (ids.length === 3 && held(player, SECATEURS_ITEM_ID)) {
      player.getInventory().deleteNumber(SECATEURS_ITEM_ID, 1);
      for (const id of ids) player.getInventory().deleteNumber(id, 1);
    }
    if (!held(player, MAGIC_SECATEURS_ITEM_ID)) {
      player.getInventory().adds(MAGIC_SECATEURS_ITEM_ID, 1);
    }
    advance(player, STAGE_HAS_MAGIC_SECATEURS);
  }

  function handleActionEvent(event) {
    const { player, npcId, stepId } = event;
    if (stepId === GROVE_ENTER_ACTION_ID || stepId === GROVE_REENTER_ACTION_ID) {
      event.handled = true;
      player.moveTo(new Location(GROVE_ENTRY.x, GROVE_ENTRY.y, GROVE_ENTRY.z));
      return;
    }
    if (stepId === RECEIVE_SECATEURS_ACTION_ID) {
      event.handled = true;
      if (!held(player, QUEENS_SECATEURS_ITEM_ID)) {
        player.getInventory().adds(QUEENS_SECATEURS_ITEM_ID, 1);
      }
      return;
    }
    if (stepId === ENCHANT_ACTION_ID) {
      if (!NATURE_SPIRIT_NPC_IDS.has(npcId)) return;
      event.handled = true;
      enchantSecateurs(player);
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return;
    event.handled = true;
    event.end = true;
    if (quest.getStage(player) >= STAGE_TANGLEFOOT_DEFEATED && !quest.isComplete(player)) {
      if (held(player, QUEENS_SECATEURS_ITEM_ID)) {
        player.getInventory().deleteNumber(QUEENS_SECATEURS_ITEM_ID, 1);
      }
      quest.complete(player);
    }
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  function gardenerVariant(player, npcId) {
    const asked = askedGardeners(player);
    if (asked.length >= 5) {
      return "talking-to-the-gardeners-talking-to-other-gardeners-after-having-already-asked-five";
    }
    if (asked.includes(npcId)) return "talking-to-the-gardeners-if-the-player-has-already-talked-to-them";
    return `talking-to-the-gardeners-gardener-${asked.length + 1}`;
  }

  /** The gardeners are shared NPCs; only claim them for the gathering stage. */
  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    const isGardener = GARDENER_NPC_IDS.has(npcId);
    if (!isGardener && !INVALID_GARDENER_NPC_IDS.has(npcId)) return;
    if (actionOf(event) !== "talk-to") return;
    if (quest.getStage(player) !== STAGE_STARTED) return;
    event.handled = true;
    const variant = isGardener
      ? gardenerVariant(player, npcId)
      : "talking-to-the-gardeners-invalid-gardener";
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (!GROVE_GAP_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    const y = Math.max(4378, Math.min(4380, location.y));
    if (player.getLocation().getX() < location.x) {
      player.moveTo(new Location(GROVE_EXIT.x, y, GROVE_EXIT.z));
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_HAS_MAGIC_SECATEURS || !held(player, MAGIC_SECATEURS_ITEM_ID)) {
      if (stage < STAGE_STARTED) {
        player.sendMessage("I'm afraid nobody is allowed in there.");
        return;
      }
      startTranscript(api, player, GATEKEEPER_NPC_ID, GATEKEEPER_PAGE, GATEKEEPER_REFUSAL_VARIANT);
      return;
    }
    const variant =
      stage >= STAGE_TANGLEFOOT_DEFEATED
        ? "shady-grove-re-entering-the-shady-grove-after-obtaining-the-queen-s-secateurs"
        : "shady-grove-entering-the-shady-grove";
    startTranscript(api, player, GATEKEEPER_NPC_ID, PAGE, variant);
  }

  /** The Draynor skull is dug from the manor grave, quest or no quest. */
  function digDraynorGrave(player) {
    const at = player.getLocation();
    if (!at.isWithinDistance(DRAYNOR_GRAVE_TILE, 1)) return false;
    if (!api.core.MapObjects.get(DRAYNOR_GRAVE_OBJECT_ID, DRAYNOR_GRAVE_TILE, player.getPrivateArea())) return false;
    if (held(player, DRAYNOR_SKULL_ITEM_ID)) {
      player.sendMessage("You dig the grave but find nothing.");
      return true;
    }
    if (player.getBanks().some(bank => bank?.getAmount(DRAYNOR_SKULL_ITEM_ID) > 0)) {
      player.sendMessage("I think I've already stored the skull in my bank.");
      return true;
    }
    if (player.getInventory().getFreeSlots() === 0) {
      player.getInventory().full();
      return true;
    }
    player.getInventory().adds(DRAYNOR_SKULL_ITEM_ID, 1);
    player.sendMessage("You dig the grave and find a skull.");
    return true;
  }

  function handleSpadeDig({ player }) {
    return digDraynorGrave(player);
  }

  function handleSpadeOnGrave(event) {
    if (event.itemId !== SPADE_ITEM_ID || event.objectId !== DRAYNOR_GRAVE_OBJECT_ID) return;
    if (!Location.isSameTile(event.location, DRAYNOR_GRAVE_TILE)) return;
    event.handled = digDraynorGrave(event.player);
  }

  /** Only magic secateurs can harm the Tanglefoot (wiki: no other weapon). */
  function handleNpcHitModify({ npc, hit }) {
    if (npc?.getContentId?.() !== TANGLEFOOT_NPC_ID) return;
    const attacker = hit?.getAttacker?.();
    const weaponId = attacker?.getEquipment?.()?.get?.(Equipment.WEAPON_SLOT)?.getId?.();
    if (weaponId === MAGIC_SECATEURS_ITEM_ID) return;
    const hadDamage = Number(hit?.getTotalDamage?.() ?? 0) > 0;
    for (const single of hit?.getHits?.() ?? []) single.setDamage(0);
    hit?.updateTotalDamage?.();
    if (hadDamage && attacker?.sendMessage) {
      attacker.sendMessage("I can't deal any damage with this weapon.");
    }
  }

  function handleNpcDeath({ killer, npc, npcId }) {
    if (npc?.getId?.() !== TANGLEFOOT_NPC_ID && npcId !== TANGLEFOOT_NPC_ID) return;
    if (!killer || killer.isNpc?.()) return;
    if (quest.getStage(killer) !== STAGE_HAS_MAGIC_SECATEURS) return;
    tanglefootByPlayer.delete(killer);
    // The Queen's secateurs come from the NPC's npc-drops.json table (always
    // drop), so nothing is registered here.
    advance(killer, STAGE_TANGLEFOOT_DEFEATED);
  }

  function handleZoneEnter({ player }) {
    ensureTanglefoot(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendProgressVarbits(player);
    if (insideGrove(player)) ensureTanglefoot(player);
  }

  function handleBootstrap({ player }) {
    sendProgressVarbits(player);
  }

  function handleLogout({ player }) {
    removeTanglefoot(player);
  }

  function handlePlayerDeath({ player }) {
    removeTanglefoot(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Martin the Master Gardener asked me to find out why the crops were failing.</str>",
        "<str>The fairies were to blame. I killed the Tanglefoot and returned the Queen's</str>",
        "<str>secateurs to the Fairy Godfather.</str>",
        "",
        "<str>I keep the magic secateurs, which improve some crop harvests.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) {
      return [
        "I killed the <col=800000>Tanglefoot</col> and recovered the",
        "<col=800000>Queen's secateurs</col>. I should take them to the",
        "<col=800000>Fairy Godfather</col> in Zanaris.",
      ];
    }
    if (stage >= STAGE_HAS_MAGIC_SECATEURS) {
      return [
        "The <col=800000>Nature Spirit</col> enchanted my secateurs.",
        "I should use the <col=800000>magic secateurs</col> to kill the",
        "<col=800000>Tanglefoot</col> at the end of the shady grove.",
      ];
    }
    if (stage >= STAGE_HAS_RECIPE) {
      return [
        "Malignius Mortifer told me only enchanted secateurs can harm",
        "the Tanglefoot. I must take a pair of <col=800000>secateurs</col>",
        "and these items to the <col=800000>Nature Spirit</col>:",
        "",
        ...requiredNatureItems(player).map((entry) =>
          held(player, entry.id) ? `<str>${entry.name}</str>` : entry.name
        ),
      ];
    }
    if (stage >= STAGE_DIAGNOSED) {
      return [
        "Zandar Horfyre says the Fairy Queen is losing her life essence.",
        "I should ask <col=800000>Malignius Mortifer</col> near Port Sarim",
        "how to defeat the <col=800000>Tanglefoot</col>.",
      ];
    }
    if (stage >= STAGE_HAS_SYMPTOMS_LIST) {
      return [
        "Fairy Nuff gave me a list of the Fairy Queen's symptoms.",
        "I should take it to <col=800000>Zandar Horfyre</col> in the",
        "<col=800000>Dark Wizards' Tower</col>.",
      ];
    }
    if (stage >= STAGE_GARDENERS_REPORTED) {
      return [
        "The gardeners all blamed something different for the failing",
        "crops. Martin suggested the <col=800000>fairies</col> are behind",
        "it. I should travel to <col=800000>Zanaris</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Martin the Master Gardener has asked me to find out why the",
        "crops are failing. I should ask five members of the",
        "<col=800000>Group of Advanced Gardeners</col>.",
        "",
        `I have spoken to ${askedGardeners(player).length} of 5 gardeners.`,
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Martin the Master Gardener</col> at the market in",
      "<col=800000>Draynor Village</col>.",
      "",
      "I need to have completed <col=800000>Lost City</col> and",
      "<col=800000>Nature Spirit</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FARMING, 3500);
    player.getSkillManager().addExperiences(Skill.ATTACK, 2000);
    player.getSkillManager().addExperiences(Skill.MAGIC, 1000);
  }

  api.persistAttribute(GARDENERS_ATTRIBUTE);
  api.persistAttribute(MALIGNIUS_ASKED_ATTRIBUTE);
  api.persistAttribute(NATURE_ITEMS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "fairytale_i_growing_pains",
    name: "Fairytale I - Growing Pains",
    varpId: VARP_FAIRYTALE,
    varbitId: VARBIT_FAIRYTALE_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.FARMING.getIndex(), amount: 3500, label: "Farming" },
      { skillId: Skill.ATTACK.getIndex(), amount: 2000, label: "Attack" },
      { skillId: Skill.MAGIC.getIndex(), amount: 1000, label: "Magic" },
    ],
    rewardItemLabel: "Magic secateurs",
    scrollItemId: MAGIC_SECATEURS_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleNuffDialogueLine);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleActionEvent);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleSpadeOnGrave, { noted: false });
  api.onItemAction("Spade", { Dig: handleSpadeDig });
  api.onNpcHitModify(handleNpcHitModify);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(GROVE_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
