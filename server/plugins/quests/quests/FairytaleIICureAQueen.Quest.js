/**
 * Fairytale II - Cure a Queen (members).
 *
 * The words come from the "Fairytale II - Cure a Queen" transcript page; shared
 * NPC pages ("Fairy Nuff", "Fairy Godfather", "Fairy Queen", "Fairy Fixit") supply
 * the post-quest tails. This plugin supplies the variant selector, the prose
 * condition answers, the certificate/shelf puzzle, the Godfather permission,
 * the hideout, the Godfather pickpocket, the magic essence brewing and the
 * queen's awakening.
 *
 * Stage (varbit 2326 "fairy2_queencure_quest" bits 0-6, varp 810; confirmed with
 * scripts/lookup-gameval.ts and cross-checked against the cache NPC/loc
 * transforms that key on the same varbit):
 *    0 not started,
 *    5 Martin asked me to wait for his crops (2333 martinchat set),
 *   10 crops grown, Martin tells me to investigate,
 *   20 I agreed; Nuff's room is ransacked (2327 cert visible, 2332 Nuff hidden),
 *   30 I studied the certificate,
 *   40 the Godfather gave me permission to use the fairy rings (2328/2329),
 *   45 I reached the fairy resistance hideout,
 *   50 Fairy Nuff asked me to pickpocket the Godfather (1808 set to 2),
 *   60 I have the Queen's secateurs,
 *   65 I gave them to Nuff, who needs a potion of magic essence (recipe),
 *   70 I have visited the cosmic and gorak planes again,
 *   72 star flower added to a vial of water (magic essence unf),
 *   73 gorak claw powder added (magic essence),
 *   75 the potion was used on the Fairy Queen,
 *   90 complete (cache DB row 47 column 19 requires varbit 2326 >= 90;
 *      older durable saves at 80 are migrated to 90 on login).
 *
 * Sibling varbits written alongside the stage (all in varp 810 unless noted):
 * 2327 fairynuff_cert_taken, 2328 fairyring_use, 2329 fairyring_permission,
 * 2330 fairyring_cosmic_plane, 2331 fairyring_gorack_plane, 2332 fairy2_nuffvisible,
 * 2333 fairy2_martinchat, 2334 fairy2_universal_mystery, 2335 fairy2_rewardgiven,
 * 2336 fairy2_certificute_examined, 2337 fairy2_chefchat, 2338 fairy2_sign_read,
 * 2339 fairy2_trashed_camera_pan, 2382 fairy2_gorak_killed; 1808 is FT1's
 * fairy_godfather_check bit in varp 671 (Godfather becomes pickpocketable).
 *
 * Source: OSRS Wiki (Fairytale II - Cure a Queen, its quick guide and transcript);
 * the stage values follow RuneLite QuestHelper's step map for the quest and the
 * 5.5 minute Martin wait the wiki's quick guide describes. Rewards per the wiki:
 * 2 Quest points, 3,500 Herblore / 2,500 Thieving XP, an antique lamp (2,500 XP,
 * any skill over 30) and the fairy ring network.
 *
 * Gaps/approximations:
 * - The fairy ring sequence that opens the hideout (AIR/DLR/DJQ/AJS) is the
 *   FairyRings plugin's territory, which refuses every ring until FT2 is
 *   complete. During the quest the player is teleported by the verifier; the
 *   shared change needed is a "fairyring_permission" branch in FairyRings.
 * - The cosmic plane and gorak plane are reached with ::tele in the same way;
 *   the star flowers are spawned instantly on entering the plane rather than
 *   after the wiki's 2-5 minute growth.
 * - The certificate "Study" and rune temple sign "Read" have no transcript page;
 *   they send short messages and set 2336/2338 (the sign message is not from a
 *   wiki transcript).
 * - The queen's awakening scene has several speakers (Queen, Nuff, Very Wise)
 *   but the shared transcript replay renders one chathead; the qUAH/lamp/complete
 *   step ids are hooked instead of re-authoring the scene.
 * - Pickpocket success is a level-scaled roll (min 40 Thieving, not boostable);
 *   failing teleports to the Lumbridge Swamp shed as the wiki describes.
 * - The potion is only accepted once Fairy Nuff has been given the secateurs, so
 *   no dose is lost on a premature use (the wiki lets the dose go to waste).
 * - The multi-tile sleeping queen loc 16316 has no generated identifier, so it is
 *   a raw constant here (as FT1's grove wall).
 * - Fairy Nuff's Talk-to is claimed through onNpcInteraction: FT1's own variant
 *   selector answers for her after FT1 (its "after-fairytale-part-1") and would
 *   otherwise beat this quest's selector.
 */
module.exports = function registerFairytaleIICureAQueenQuest(api) {
  const {
    Item,
    ItemIdentifiers,
    Location,
    Misc,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Fairytale II - Cure a Queen";

  const MARTIN_NPC_ID = NpcIdentifiers.MARTIN_THE_MASTER_GARDENER; // 5832
  const FAIRY_GODFATHER_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_GODFATHER, // 1840
    NpcIdentifiers.FAIRY_GODFATHER_2, // 5837
  ]);
  const FAIRY_NUFF_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_NUFF, // 1841
    NpcIdentifiers.FAIRY_NUFF_2, // 5836
  ]);
  const FAIRY_QUEEN_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_QUEEN, // 1161
    NpcIdentifiers.FAIRY_QUEEN_2, // 1842
  ]);
  const FAIRY_VERY_WISE_NPC_ID = NpcIdentifiers.FAIRY_VERY_WISE; // 1847
  const COORDINATOR_NPC_ID = NpcIdentifiers.CO_ORDINATOR; // 5835
  const FAIRY_CHEF_NPC_ID = NpcIdentifiers.FAIRY_CHEF; // 5856
  const FAIRY_FIXIT_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_FIXIT, // 7332
    NpcIdentifiers.FAIRY_FIXIT_2, // 7333
  ]);
  const COSMIC_BEING_NPC_ID = NpcIdentifiers.COSMIC_BEING; // 1835
  const GORAK_NPC_ID = NpcIdentifiers.GORAK; // 1834 (the FT2 gorak plane; GWD goraks are 3141)
  const STARFLOWER_NPC_ID = NpcIdentifiers.STARFLOWER_2; // 1857
  const ZANARIS_COW_NPC_ID = NpcIdentifiers.COW_5; // 5842

  const VARP_FAIRYTALE = 810;
  const VARBIT_QUEST = 2326; // "fairy2_queencure_quest", bits 0-6
  const VARBIT_CERT_TAKEN = 2327; // "fairynuff_cert_taken", bits 7-8
  const VARBIT_RING_USE = 2328; // "fairyring_use", bit 9
  const VARBIT_RING_PERMISSION = 2329; // "fairyring_permission", bits 10-11
  const VARBIT_COSMIC_PLANE = 2330; // "fairyring_cosmic_plane", bit 12
  const VARBIT_GORAK_PLANE = 2331; // "fairyring_gorack_plane", bit 13
  const VARBIT_NUFF_VISIBLE = 2332; // "fairy2_nuffvisible", bit 14
  const VARBIT_MARTIN_CHAT = 2333; // "fairy2_martinchat", bit 15
  const VARBIT_UNIVERSAL_MYSTERY = 2334; // "fairy2_universal_mystery", bit 16
  const VARBIT_REWARD_GIVEN = 2335; // "fairy2_rewardgiven", bit 17
  const VARBIT_CERT_EXAMINED = 2336; // "fairy2_certificute_examined", bit 18
  const VARBIT_CHEF_CHAT = 2337; // "fairy2_chefchat", bits 19-20
  const VARBIT_SIGN_READ = 2338; // "fairy2_sign_read", bits 21-23 (4 = read with the certificate)
  const VARBIT_TRASHED_PAN = 2339; // "fairy2_trashed_camera_pan", bit 24
  const VARBIT_GORAK_KILLED = 2382; // "fairy2_gorak_killed", bit 26
  const VARBIT_FAIRY_GODFATHER_FT1 = 1808; // FT1's "fairy_godfather_check", varp 671 bits 24-25

  const STAGE_WAITING = 5;
  const STAGE_READY = 10;
  const STAGE_INVESTIGATING = 20;
  const STAGE_CERTIFICATE_STUDIED = 30;
  const STAGE_PERMISSION = 40;
  const STAGE_HIDEOUT = 45;
  const STAGE_PICKPOCKET = 50;
  const STAGE_HAS_SECATEURS = 60;
  const STAGE_HANDED_OVER = 65;
  const STAGE_INGREDIENTS = 70;
  const STAGE_UNFINISHED_POTION = 72;
  const STAGE_FINISHED_POTION = 73;
  const STAGE_POTION_USED = 75;
  const STAGE_COMPLETE = 90;
  const LEGACY_STAGE_COMPLETE = 80;

  const NUFFS_CERTIFICATE_ITEM_ID = ItemIdentifiers.NUFFS_CERTIFICATE; // 9025
  const QUEENS_SECATEURS_ITEM_ID = ItemIdentifiers.QUEENS_SECATEURS_2; // 9020
  const GORAK_CLAWS_ITEM_ID = ItemIdentifiers.GORAK_CLAWS; // 9016
  const GORAK_CLAW_POWDER_ITEM_ID = ItemIdentifiers.GORAK_CLAW_POWDER; // 9018
  const STAR_FLOWER_ITEM_ID = ItemIdentifiers.STAR_FLOWER; // 9017
  const MAGIC_ESSENCE_UNF_ITEM_ID = ItemIdentifiers.MAGIC_ESSENCE_UNF_; // 9019
  const ESSENCE_DOSE_ITEM_IDS = [
    ItemIdentifiers.MAGIC_ESSENCE_4_, // 9021
    ItemIdentifiers.MAGIC_ESSENCE_3_, // 9022
    ItemIdentifiers.MAGIC_ESSENCE_2_, // 9023
    ItemIdentifiers.MAGIC_ESSENCE_1_, // 9024
  ];
  const VIAL_OF_WATER_ITEM_ID = ItemIdentifiers.VIAL_OF_WATER; // 227
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL; // 229
  const PESTLE_AND_MORTAR_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP; // 4447
  const LAMP_XP = 2500;
  const LAMP_MIN_LEVEL = 30;

  // Placement ids: the certificate and the sleeping queen are varbit-transformed
  // multi locs, so they have no generated identifier (as FT1's grove wall).
  const QUEEN_BED_OBJECT_ID = 16316; // fairytale2_cert_large_broken_a_multi's sibling, "Fairy Queen"
  const RIGHT_SHELF = { x: 2389, y: 4470 }; // the potion shelf the certificate fell from

  const START_HOOK = "quest:fairytale-ii-cure-a-queen:start";
  const MARTIN_QUEST_OPTION = "Ask about the quest.";
  const MARTIN_WAIT_MS = 5.5 * 60 * 1000;

  // Transcript step ids.
  const CERT_BEFORE_STUDY_CONDITION_IDS = new Set(["HOEOez", "IznESa", "eOKuqb", "eQw7c6"]);
  const CERT_AFTER_STUDY_CONDITION_IDS = new Set(["hNZlpT", "ucI2OP", "pwsAFt", "2OgD4O"]);
  const CERT_SHOW_TALK_CONDITION_ID = "dfIa3p";
  const SHELF_WRONG_CONDITION_ID = "1E1huy";
  const SHELF_RIGHT_CONDITION_ID = "RnasHV";
  const SHELF_FULL_CONDITION_ID = "uSZg_Z";
  const PICKPOCKET_FULL_CONDITION_ID = "5dBfKL";
  const PICKPOCKET_SUCCESS_CONDITION_ID = "bx036-";
  const PICKPOCKET_ALREADY_CONDITION_ID = "ntjs-9";
  const PICKPOCKET_FAIL_CONDITION_ID = "wyNz16";
  const POTION_NONE_CONDITION_ID = "ELvtOa";
  const POTION_UNFINISHED_CONDITION_ID = "zEkOlM";
  const POTION_READY_CONDITION_ID = "FJYR1J";
  const REWARD_NO_ROOM_CONDITION_ID = "-LSx7-";
  const REWARD_ROOM_CONDITION_ID = "e2I60y";
  const NUFF_INTRO_CONTINUE_ACTION_ID = "YO3q33"; // "You see a fairy approaching ..." message
  const HAND_OVER_SECATEURS_MESSAGE_ID = "j-qUAH";
  const PICKPOCKET_FAILED_MESSAGE_ID = "NBfLls";
  const REWARD_LAMP_MESSAGE_ID = "SuXalx";
  const REWARD_GIVEN_ATTRIBUTE = "fairytale-ii-cure-a-queen:reward-given";
  const COMPLETE_ACTION_ID = "Vca-Ck";

  // Variants (from the "Fairytale II - Cure a Queen" page unless noted).
  const MARTIN_FIRST_VARIANT = "starting-off-talking-to-martin";
  const MARTIN_WAIT_VARIANT = "starting-off-talking-to-martin-before-5-minutes-have-passed";
  const MARTIN_READY_VARIANT = "starting-off-talking-to-martin-after-5-minutes-have-passed";
  const MARTIN_AGAIN_VARIANT = "starting-off-talking-to-martin-again-after-starting-the-quest";
  const GODFATHER_START_VARIANT = "starting-off-talking-to-the-fairy-godfather";
  const GODFATHER_DENIED_VARIANT = "starting-off-talking-to-fairy-godfather-again-after-denying-his-request";
  const GODFATHER_PERMISSION_VARIANT =
    "starting-off-talking-to-the-fairy-godfather-after-getting-permission-to-use-the-fairy-rings";
  const COORDINATOR_VARIANT = "starting-off-co-ordinator";
  const FIXIT_VARIANT = "starting-off-fairy-fixit";
  const SHELF_SEARCH_VARIANT = "locating-the-hideout-searching-for-fairy-nuff-s-certificate";
  const NUFF_INTRO_VARIANT = "in-the-hideout-talking-to-fairy-nuff";
  const NUFF_AGAIN_VARIANT = "in-the-hideout-talking-to-fairy-nuff-again";
  const NUFF_RECAP_VARIANT =
    "curing-the-queen-talking-to-fairy-nuff-after-visiting-the-cosmic-plane-and-gorak-plane";
  const NUFF_POTION_VARIANT = "curing-the-queen-talking-to-fairy-nuff-again";
  const NUFF_LOST_SECATEURS_VARIANT = "curing-the-queen-returning-to-fairy-nuff-after-losing-the-secateurs";
  const NUFF_GIVE_SECATEURS_VARIANT = "curing-the-queen-bringing-fairy-nuff-the-secateurs";
  const PICKPOCKET_VARIANT = "in-the-hideout-pickpocketing-the-secateurs";
  const VERY_WISE_VARIANT = "in-the-hideout-talking-to-fairy-very-wise-again";
  const COSMIC_BEING_VARIANT = "curing-the-queen-talking-to-the-cosmic-being";
  const WAKE_VARIANT = "curing-the-queen-after-using-the-magic-essence-potion-on-the-fairy-queen";
  const VERY_WISE_CURED_VARIANT = "curing-the-queen-talking-to-fairy-very-wise-after-curing-the-queen";

  const CERTIFICATE_VARIANTS = new Map([
    [NpcIdentifiers.FAIRY_GODFATHER, "locating-the-hideout-using-the-certificate-on-various-npcs-fairy-godfather"],
    [NpcIdentifiers.FAIRY_GODFATHER_2, "locating-the-hideout-using-the-certificate-on-various-npcs-fairy-godfather"],
    [ZANARIS_COW_NPC_ID, "locating-the-hideout-using-the-certificate-on-various-npcs-any-zanaris-cow-but-the-dairy-cow"],
    [NpcIdentifiers.SHEEP_25, "locating-the-hideout-using-the-certificate-on-various-npcs-sheep"],
    [NpcIdentifiers.SHEEP_26, "locating-the-hideout-using-the-certificate-on-various-npcs-sheep"],
    [NpcIdentifiers.SHEEP_27, "locating-the-hideout-using-the-certificate-on-various-npcs-sheep"],
    [NpcIdentifiers.SHEEP_28, "locating-the-hideout-using-the-certificate-on-various-npcs-sheep"],
    [FAIRY_CHEF_NPC_ID, "locating-the-hideout-using-the-certificate-on-various-npcs-fairy-chef"],
    [NpcIdentifiers.GATEKEEPER, "locating-the-hideout-using-the-certificate-on-various-npcs-gatekeeper"],
    [NpcIdentifiers.GATEKEEPER_2, "locating-the-hideout-using-the-certificate-on-various-npcs-gatekeeper"],
    [COORDINATOR_NPC_ID, "locating-the-hideout-using-the-certificate-on-various-npcs-co-ordinator"],
    [NpcIdentifiers.FAIRY_NUFF, "locating-the-hideout-using-the-certificate-on-various-npcs-fairy-nuff"],
    [NpcIdentifiers.FAIRY_NUFF_2, "locating-the-hideout-using-the-certificate-on-various-npcs-fairy-nuff"],
  ]);

  const CERT_TAKEN_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:certificate-taken";
  const STUDIED_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:certificate-studied";
  const DENIED_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:godfather-denied";
  const PLANES_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:planes";
  const CHEF_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:chef-chat";
  const SIGN_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:sign-read";
  const MYSTERY_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:universal-mystery";
  const GORAK_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:gorak-killed";
  const MARTIN_TALK_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:martin-talk-at";
  const PLANE_COSMIC = 1 << 0;
  const PLANE_GORAK = 1 << 1;

  const HIDEOUT_ZONE = { minX: 2324, maxX: 2367, minY: 4420, maxY: 4468, levels: [0] };
  const STAR_PLANE_ZONE = { minX: 2060, maxX: 2098, minY: 4806, maxY: 4862, levels: [0] };
  const GORAK_PLANE_ZONE = { minX: 3009, maxX: 3072, minY: 5312, maxY: 5380, levels: [0] };

  // Star flower spawns on the cosmic entity's plane (wiki: they grow around the
  // plane; the cosmic being stands at 2090,4829).
  const STARFLOWER_SPAWNS = [
    { x: 2070, y: 4841, z: 0 },
    { x: 2077, y: 4836, z: 0 },
  ];
  const QUEEN_SPAWN = { x: 2354, y: 4455, z: 0 };
  // Failed pickpocket: "You slowly wake up in an unknown place" - the wiki's
  // "teleported outside Zanaris", by the Lumbridge Swamp shed.
  const ZANARIS_EXIT = { x: 3202, y: 3167, z: 0 };

  let quest;
  let groundItems;
  const shelfSearch = new WeakMap();
  const pickpocket = new WeakMap();
  const starflowers = new Map(); // player -> spawned NPCs
  const awakeQueen = new Map(); // player -> spawned NPC
  const pendingLamp = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();
  const studied = (player) => Number(player.getAttribute(STUDIED_ATTRIBUTE)) > 0;

  function ft1Complete(player) {
    const request = { player, key: "fairytale_i_growing_pains", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_WAITING && !quest.isComplete(player);
  }

  function planes(player) {
    return Number(player.getAttribute(PLANES_ATTRIBUTE)) || 0;
  }

  function planesVisited(player) {
    return (planes(player) & PLANE_COSMIC) !== 0 && (planes(player) & PLANE_GORAK) !== 0;
  }

  function setPlane(player, bit) {
    player.setAttribute(PLANES_ATTRIBUTE, planes(player) | bit);
  }

  function hasMagicEssence(player) {
    return ESSENCE_DOSE_ITEM_IDS.some((itemId) => held(player, itemId));
  }

  function martinWaited(player) {
    const at = Number(player.getAttribute(MARTIN_TALK_ATTRIBUTE));
    return Number.isFinite(at) && at > 0 && Date.now() - at >= MARTIN_WAIT_MS;
  }

  function advance(player, value) {
    if (quest.getStage(player) < value && !quest.isComplete(player)) {
      quest.setStage(player, value);
      syncProgress(player);
    }
  }

  /** Re-sends every sibling varbit in varp 810 (the quest stage lives in 2326). */
  function syncProgress(player) {
    const sender = player.getPacketSender();
    const stage = quest.getStage(player);
    const complete = stage >= STAGE_COMPLETE;
    sender.sendVarbit(
      VARBIT_CERT_TAKEN,
      stage < STAGE_INVESTIGATING ? 0 : Number(player.getAttribute(CERT_TAKEN_ATTRIBUTE)) > 0 ? 2 : 1
    );
    sender.sendVarbit(VARBIT_RING_USE, stage >= STAGE_PERMISSION ? 1 : 0);
    sender.sendVarbit(
      VARBIT_RING_PERMISSION,
      stage >= STAGE_PERMISSION ? 2 : Number(player.getAttribute(DENIED_ATTRIBUTE)) > 0 ? 1 : 0
    );
    sender.sendVarbit(VARBIT_COSMIC_PLANE, planes(player) & PLANE_COSMIC ? 1 : 0);
    sender.sendVarbit(VARBIT_GORAK_PLANE, planes(player) & PLANE_GORAK ? 1 : 0);
    sender.sendVarbit(VARBIT_NUFF_VISIBLE, stage >= STAGE_INVESTIGATING && !complete ? 1 : 0);
    sender.sendVarbit(VARBIT_MARTIN_CHAT, stage >= STAGE_WAITING ? 1 : 0);
    sender.sendVarbit(VARBIT_UNIVERSAL_MYSTERY, Number(player.getAttribute(MYSTERY_ATTRIBUTE)) > 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_REWARD_GIVEN, complete ? 1 : 0);
    sender.sendVarbit(VARBIT_CERT_EXAMINED, studied(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_CHEF_CHAT, Number(player.getAttribute(CHEF_ATTRIBUTE)) > 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_SIGN_READ, Number(player.getAttribute(SIGN_ATTRIBUTE)) > 0 ? 4 : 0);
    sender.sendVarbit(VARBIT_TRASHED_PAN, stage >= STAGE_INVESTIGATING ? 1 : 0);
    sender.sendVarbit(VARBIT_GORAK_KILLED, Number(player.getAttribute(GORAK_ATTRIBUTE)) > 0 ? 1 : 0);
    // FT1's Godfather spawn (5850) only offers Pick-pocket when 1808 is 2.
    if (stage >= STAGE_PICKPOCKET) sender.sendVarbit(VARBIT_FAIRY_GODFATHER_FT1, 2);
  }

  // ==========================================================================
  // Transcript selection
  // ==========================================================================

  function godfatherVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-fairytale-ii";
    if (stage >= STAGE_PERMISSION) return GODFATHER_PERMISSION_VARIANT;
    if (stage >= STAGE_INVESTIGATING) {
      return Number(player.getAttribute(DENIED_ATTRIBUTE)) > 0
        ? GODFATHER_DENIED_VARIANT
        : GODFATHER_START_VARIANT;
    }
    return null;
  }

  function nuffVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "after-fairytale-part-2";
    if (stage >= STAGE_HANDED_OVER) {
      if (stage < STAGE_INGREDIENTS && planesVisited(player)) {
        advance(player, STAGE_INGREDIENTS);
        return NUFF_RECAP_VARIANT;
      }
      return NUFF_POTION_VARIANT;
    }
    if (stage >= STAGE_HAS_SECATEURS) {
      return held(player, QUEENS_SECATEURS_ITEM_ID) ? NUFF_GIVE_SECATEURS_VARIANT : NUFF_LOST_SECATEURS_VARIANT;
    }
    if (stage >= STAGE_PICKPOCKET) return NUFF_AGAIN_VARIANT;
    if (stage >= STAGE_INVESTIGATING) return NUFF_INTRO_VARIANT;
    return null;
  }

  function queenVariant(stage) {
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-finishing-fairytale-ii-cure-a-queen";
    if (stage >= STAGE_POTION_USED) return WAKE_VARIANT;
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === MARTIN_NPC_ID) {
      if (!ft1Complete(player)) return null;
      if (stage >= STAGE_COMPLETE) return "standard-dialogue";
      if (stage >= STAGE_INVESTIGATING) return MARTIN_AGAIN_VARIANT;
      // 10 is the ready-to-accept copy: a refused start stays here so the
      // offer (and its quest:start hook) can be shown again.
      if (stage >= STAGE_READY) return MARTIN_READY_VARIANT;
      if (stage >= STAGE_WAITING) return martinWaited(player) ? MARTIN_READY_VARIANT : MARTIN_WAIT_VARIANT;
      return MARTIN_FIRST_VARIANT;
    }
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId)) return godfatherVariant(player, stage);
    if (FAIRY_QUEEN_NPC_IDS.has(npcId)) return queenVariant(stage);
    if (npcId === FAIRY_VERY_WISE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return VERY_WISE_CURED_VARIANT;
      if (stage >= STAGE_PERMISSION) return VERY_WISE_VARIANT;
      return null;
    }
    if (npcId === COORDINATOR_NPC_ID) {
      return stage >= STAGE_PERMISSION && stage < STAGE_COMPLETE ? COORDINATOR_VARIANT : null;
    }
    if (FAIRY_FIXIT_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-fairytale-ii-cure-a-queen";
      return stage >= STAGE_PERMISSION ? FIXIT_VARIANT : null;
    }
    if (npcId === COSMIC_BEING_NPC_ID) {
      return stage >= STAGE_HANDED_OVER && stage < STAGE_COMPLETE ? COSMIC_BEING_VARIANT : null;
    }
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      // Showing the certificate is the item-on-NPC route, never the talk menu.
      case CERT_SHOW_TALK_CONDITION_ID:
        return false;
      case SHELF_WRONG_CONDITION_ID:
        return shelfSearch.get(player) === "wrong";
      case SHELF_RIGHT_CONDITION_ID:
        return shelfSearch.get(player) === "right" && freeSlots(player) >= 1;
      case SHELF_FULL_CONDITION_ID:
        return shelfSearch.get(player) === "right" && freeSlots(player) < 1;
      case PICKPOCKET_FULL_CONDITION_ID:
        return pickpocket.get(player) === "full";
      case PICKPOCKET_SUCCESS_CONDITION_ID:
        return pickpocket.get(player) === "success";
      case PICKPOCKET_ALREADY_CONDITION_ID:
        return pickpocket.get(player) === "already";
      case PICKPOCKET_FAIL_CONDITION_ID:
        return pickpocket.get(player) === "fail";
      case POTION_NONE_CONDITION_ID:
        return !hasMagicEssence(player) && !held(player, MAGIC_ESSENCE_UNF_ITEM_ID);
      case POTION_UNFINISHED_CONDITION_ID:
        return held(player, MAGIC_ESSENCE_UNF_ITEM_ID);
      case POTION_READY_CONDITION_ID:
        return hasMagicEssence(player);
      case REWARD_NO_ROOM_CONDITION_ID:
        return freeSlots(player) < 1;
      case REWARD_ROOM_CONDITION_ID:
        return freeSlots(player) >= 1;
      default:
        if (CERT_BEFORE_STUDY_CONDITION_IDS.has(stepId)) return !studied(player);
        if (CERT_AFTER_STUDY_CONDITION_IDS.has(stepId)) return studied(player);
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function grantFairyRingPermission(player) {
    player.setAttribute(DENIED_ATTRIBUTE, 0);
    if (quest.getStage(player) < STAGE_PERMISSION) advance(player, STAGE_PERMISSION);
    syncProgress(player);
  }

  function handleChoice({ player, npcId, option }) {
    if (npcId === MARTIN_NPC_ID && option === MARTIN_QUEST_OPTION) {
      if (!ft1Complete(player)) return;
      const stage = quest.getStage(player);
      if (stage === 0) {
        player.setAttribute(MARTIN_TALK_ATTRIBUTE, Date.now());
        advance(player, STAGE_WAITING);
      } else if (stage === STAGE_WAITING && martinWaited(player)) {
        advance(player, STAGE_READY);
      }
      return;
    }
    if (npcId === COSMIC_BEING_NPC_ID && option === "I'm looking for a Star Flower.") {
      player.setAttribute(MYSTERY_ATTRIBUTE, 1);
      syncProgress(player);
      return;
    }
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING || stage >= STAGE_PERMISSION) return;
    if (option === "Yes, okay." || option === "Oh, okay then.") {
      grantFairyRingPermission(player);
    } else if (option === "No, I'll rescue her myself.") {
      player.setAttribute(DENIED_ATTRIBUTE, 1);
      syncProgress(player);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== MARTIN_NPC_ID || hook !== START_HOOK) return;
    if (!ft1Complete(player)) return;
    advance(player, STAGE_INVESTIGATING);
    syncProgress(player);
  }

  function handleConditionEvent(event) {
    const { player, stepId } = event;
    if (stepId === SHELF_RIGHT_CONDITION_ID) {
      const context = shelfSearch.get(player);
      shelfSearch.delete(player);
      if (context !== "right" || held(player, NUFFS_CERTIFICATE_ITEM_ID)) return;
      player.getInventory().adds(NUFFS_CERTIFICATE_ITEM_ID, 1);
      player.setAttribute(CERT_TAKEN_ATTRIBUTE, 1);
      syncProgress(player);
      return;
    }
    if (stepId === PICKPOCKET_SUCCESS_CONDITION_ID) {
      const context = pickpocket.get(player);
      pickpocket.delete(player);
      if (context !== "success") return;
      if (!held(player, QUEENS_SECATEURS_ITEM_ID)) {
        player.getInventory().adds(QUEENS_SECATEURS_ITEM_ID, 1);
      }
      advance(player, STAGE_HAS_SECATEURS);
      syncProgress(player);
      return;
    }
    if (stepId === PICKPOCKET_FULL_CONDITION_ID) {
      // The imported branch now carries the real "You don't have space to
      // carry the secateurs" message; only clear the attempt context.
      pickpocket.delete(player);
      return;
    }
    if (stepId === PICKPOCKET_ALREADY_CONDITION_ID || stepId === PICKPOCKET_FAIL_CONDITION_ID) {
      pickpocket.delete(player);
      return;
    }
    if (stepId === "ucI2OP") {
      player.setAttribute(CHEF_ATTRIBUTE, 1);
      syncProgress(player);
    }
  }

  function handleActionEvent(event) {
    const { player, npcId, stepId } = event;
    if (stepId === NUFF_INTRO_CONTINUE_ACTION_ID) {
      if (!FAIRY_NUFF_NPC_IDS.has(npcId)) return;
      // The import now carries the real "You see a fairy approaching ..."
      // message; leave it unhandled so it displays, and advance to the
      // pickpocket task before her warning continues.
      if (quest.getStage(player) >= STAGE_PERMISSION && quest.getStage(player) < STAGE_PICKPOCKET) {
        advance(player, STAGE_PICKPOCKET);
        syncProgress(player);
      }
      return;
    }
    if (stepId === HAND_OVER_SECATEURS_MESSAGE_ID) {
      if (!FAIRY_NUFF_NPC_IDS.has(npcId)) return;
      if (held(player, QUEENS_SECATEURS_ITEM_ID)) {
        player.getInventory().deleteNumber(QUEENS_SECATEURS_ITEM_ID, 1);
      }
      if (quest.getStage(player) < STAGE_HANDED_OVER) advance(player, STAGE_HANDED_OVER);
      return;
    }
    if (stepId === PICKPOCKET_FAILED_MESSAGE_ID) {
      if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return;
      player.moveTo(new Location(ZANARIS_EXIT.x, ZANARIS_EXIT.y, ZANARIS_EXIT.z));
      return;
    }
    if (stepId === REWARD_LAMP_MESSAGE_ID) {
      if (!FAIRY_QUEEN_NPC_IDS.has(npcId)) return;
      if (Number(player.getAttribute(REWARD_GIVEN_ATTRIBUTE)) > 0) return;
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() < 1) {
        player.sendMessage("You need an empty inventory slot for the antique lamp.");
        event.handled = true;
        event.end = true;
        return;
      }
      const before = inventory.getAmount(ANTIQUE_LAMP_ITEM_ID);
      inventory.adds(ANTIQUE_LAMP_ITEM_ID, 1);
      if (inventory.getAmount(ANTIQUE_LAMP_ITEM_ID) > before) {
        player.setAttribute(REWARD_GIVEN_ATTRIBUTE, 1);
      }
      syncProgress(player);
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (!FAIRY_QUEEN_NPC_IDS.has(npcId)) return;
    event.handled = true;
    event.end = true;
    if (quest.getStage(player) >= STAGE_POTION_USED && !quest.isComplete(player)) {
      quest.complete(player);
      syncProgress(player);
    }
  }

  // ==========================================================================
  // The certificate, the sign and the pickpocket
  // ==========================================================================

  function handleTakeCertificate(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING || quest.isComplete(player)) return false;
    if (held(player, NUFFS_CERTIFICATE_ITEM_ID)) return true;
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space to take the certificate.");
      return true;
    }
    player.getInventory().adds(NUFFS_CERTIFICATE_ITEM_ID, 1);
    player.setAttribute(CERT_TAKEN_ATTRIBUTE, 1);
    syncProgress(player);
    return true;
  }

  function handleShelfSearch(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING) return false;
    const right = !quest.isComplete(player)
      && !held(player, NUFFS_CERTIFICATE_ITEM_ID)
      && location?.x === RIGHT_SHELF.x
      && location?.y === RIGHT_SHELF.y;
    shelfSearch.set(player, right ? "right" : "wrong");
    startTranscript(api, player, NpcIdentifiers.FAIRY_NUFF, PAGE, SHELF_SEARCH_VARIANT);
    return true;
  }

  function handleReadSign(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING) return false;
    if (!studied(player)) {
      player.sendMessage("The strange markings on the sign mean nothing to you yet.");
      return true;
    }
    player.setAttribute(SIGN_ATTRIBUTE, 1);
    syncProgress(player);
    player.sendMessage("You read the sign. It says: Cosmic Rune Altar.");
    return true;
  }

  function handleItemAction(event) {
    if (event.itemId !== NUFFS_CERTIFICATE_ITEM_ID || event.option !== "Study") return;
    const { player } = event;
    event.handled = true;
    player.setAttribute(STUDIED_ATTRIBUTE, 1);
    advance(player, STAGE_CERTIFICATE_STUDIED);
    syncProgress(player);
    player.sendMessage("You study the certificate and notice strange symbols on the back.");
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== NUFFS_CERTIFICATE_ITEM_ID) return;
    const variant = CERTIFICATE_VARIANTS.get(event.npcId);
    if (!variant) return;
    event.handled = true;
    startTranscript(api, player, event.npcId, PAGE, variant);
  }

  function handlePickpocket(event) {
    const { player, npcId } = event;
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_PICKPOCKET || stage >= STAGE_HANDED_OVER) return false;
    event.handled = true;
    if (held(player, QUEENS_SECATEURS_ITEM_ID)) {
      pickpocket.set(player, "already");
    } else if (player.getSkillManager().getMaxLevel(Skill.THIEVING) < 40) {
      player.sendMessage("You need a Thieving level of 40 to pickpocket the Fairy Godfather.");
      return true;
    } else if (freeSlots(player) < 1) {
      pickpocket.set(player, "full");
    } else {
      const level = player.getSkillManager().getMaxLevel(Skill.THIEVING);
      const chance = Math.min(95, 45 + (level - 40) * 2);
      pickpocket.set(player, Misc.randomInclusive(1, 100) <= chance ? "success" : "fail");
    }
    startTranscript(api, player, npcId, PAGE, PICKPOCKET_VARIANT);
    return true;
  }

  // ==========================================================================
  // Brewing the magic essence and curing the queen
  // ==========================================================================

  function pair(event, a, b) {
    const ids = [event.usedItemId, event.usedWithItemId];
    return ids.includes(a) && ids.includes(b);
  }

  function handleItemOnItem(event) {
    const { player } = event;
    if (pair(event, PESTLE_AND_MORTAR_ITEM_ID, GORAK_CLAWS_ITEM_ID)) {
      if (!held(player, GORAK_CLAWS_ITEM_ID)) return;
      event.handled = true;
      player.getInventory().deleteNumber(GORAK_CLAWS_ITEM_ID, 1);
      player.getInventory().adds(GORAK_CLAW_POWDER_ITEM_ID, 1);
      player.sendMessage("You grind the gorak claws into a powder.");
      return;
    }
    if (pair(event, STAR_FLOWER_ITEM_ID, VIAL_OF_WATER_ITEM_ID)) {
      event.handled = true;
      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 57) {
        player.sendMessage("You need a Herblore level of 57 to mix this potion.");
        return;
      }
      player.getInventory().deleteNumber(STAR_FLOWER_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_OF_WATER_ITEM_ID, 1);
      player.getInventory().adds(MAGIC_ESSENCE_UNF_ITEM_ID, 1);
      player.sendMessage("You mix the star flower into the vial of water.");
      if (quest.getStage(player) >= STAGE_HANDED_OVER && quest.getStage(player) < STAGE_UNFINISHED_POTION) {
        advance(player, STAGE_UNFINISHED_POTION);
      }
      return;
    }
    if (pair(event, GORAK_CLAW_POWDER_ITEM_ID, MAGIC_ESSENCE_UNF_ITEM_ID)) {
      event.handled = true;
      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 57) {
        player.sendMessage("You need a Herblore level of 57 to mix this potion.");
        return;
      }
      player.getInventory().deleteNumber(GORAK_CLAW_POWDER_ITEM_ID, 1);
      player.getInventory().deleteNumber(MAGIC_ESSENCE_UNF_ITEM_ID, 1);
      player.getInventory().adds(ItemIdentifiers.MAGIC_ESSENCE_4_, 1);
      player.sendMessage("You add the gorak claw powder and finish the magic essence potion.");
      if (quest.getStage(player) >= STAGE_HANDED_OVER && quest.getStage(player) < STAGE_FINISHED_POTION) {
        advance(player, STAGE_FINISHED_POTION);
      }
    }
  }

  function consumeEssenceDose(player, itemId) {
    const index = ESSENCE_DOSE_ITEM_IDS.indexOf(itemId);
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(index < ESSENCE_DOSE_ITEM_IDS.length - 1 ? ESSENCE_DOSE_ITEM_IDS[index + 1] : VIAL_ITEM_ID, 1);
  }

  function handlePotionOnQueen(event) {
    const { player, itemId, objectId } = event;
    if (objectId !== QUEEN_BED_OBJECT_ID) return;
    if (ESSENCE_DOSE_ITEM_IDS.indexOf(itemId) === -1) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_HANDED_OVER) {
      player.sendMessage("Fairy Nuff should see this potion before you use it.");
      return;
    }
    if (stage >= STAGE_POTION_USED) {
      player.sendMessage("The Fairy Queen has already been cured.");
      return;
    }
    consumeEssenceDose(player, itemId);
    advance(player, STAGE_POTION_USED);
    syncProgress(player);
    ensureAwakeQueen(player);
    startTranscript(api, player, NpcIdentifiers.FAIRY_QUEEN_2, PAGE, WAKE_VARIANT);
  }

  function handleLampRub(event) {
    if (event.itemId !== ANTIQUE_LAMP_ITEM_ID) return false;
    const { player, item, slot } = event;
    pendingLamp.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: LAMP_MIN_LEVEL,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (pendingLamp.get(player)?.item !== item) return null;
    pendingLamp.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, false);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    return `You have been awarded ${LAMP_XP} ${name ?? skill.getName()} XP!`;
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  function actionOf(event) {
    return String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  /**
   * Fairy Nuff is shared with FT1, whose variant selector answers for her even
   * after FT1 is complete ("after-fairytale-part-1") and would beat ours (FT1
   * registers first). While FT2 is ours to serve, Talk-to is claimed here and her
   * variant is replayed directly, which also keeps the shared page's post-FT2
   * tail reachable.
   */
  function handleNuffTalk(event) {
    const { player, npcId } = event;
    if (!FAIRY_NUFF_NPC_IDS.has(npcId)) return;
    if (actionOf(event) !== "talk-to") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING) return;
    event.handled = true;
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, "Fairy Nuff", "after-fairytale-part-2");
      return;
    }
    startTranscript(api, player, npcId, PAGE, nuffVariant(player, stage));
  }

  function handleStarflowerPick(event) {
    const { player, npcId } = event;
    if (npcId !== STARFLOWER_NPC_ID) return;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < 49) {
      player.sendMessage("You need a Farming level of 49 to pick the star flower.");
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space to pick the star flower.");
      return;
    }
    const spawned = starflowers.get(player);
    if (Array.isArray(spawned)) {
      const index = spawned.indexOf(event.npc);
      if (index >= 0) spawned.splice(index, 1);
    }
    api.removeNpc(event.npc);
    player.getInventory().adds(STAR_FLOWER_ITEM_ID, 1);
    if (!quest.isComplete(player)) {
      setPlane(player, PLANE_COSMIC);
      syncProgress(player);
    }
    player.sendMessage("You pick the star flower.");
  }

  function handleGorakDeath({ killer, npc, npcId, location }) {
    if (npcId !== GORAK_NPC_ID) return;
    if (!killer || killer.isNpc?.()) return;
    const spot = npc?.getLocation?.() ?? (location ? new Location(location.x, location.y, location.z) : null);
    if (spot && groundItems) groundItems.registerLocation(killer, new Item(GORAK_CLAWS_ITEM_ID, 1), spot);
    killer.setAttribute(GORAK_ATTRIBUTE, 1);
    if (!quest.isComplete(killer)) setPlane(killer, PLANE_GORAK);
    syncProgress(killer);
  }

  function ensureStarflowers(player) {
    const alive = (starflowers.get(player) ?? []).filter((npc) => npc?.isRegistered?.() !== false);
    starflowers.set(player, alive);
    if (alive.length > 0) return;
    for (const spot of STARFLOWER_SPAWNS) {
      const npc = api.spawnNpc({
        id: STARFLOWER_NPC_ID,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) alive.push(npc);
    }
  }

  function ensureAwakeQueen(player) {
    const existing = awakeQueen.get(player);
    if (existing && existing.isRegistered?.() !== false) {
      existing.setPositionToFace?.(player.getLocation());
      return;
    }
    const npc = api.spawnNpc({
      id: NpcIdentifiers.FAIRY_QUEEN_2,
      x: QUEEN_SPAWN.x,
      y: QUEEN_SPAWN.y,
      z: QUEEN_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) awakeQueen.set(player, npc);
  }

  function removePlayerSpawns(player) {
    for (const npc of starflowers.get(player) ?? []) api.removeNpc(npc);
    starflowers.delete(player);
    const queen = awakeQueen.get(player);
    if (queen) api.removeNpc(queen);
    awakeQueen.delete(player);
  }

  function insideZone(location, zone) {
    if (!location || !zone.levels.includes(location.getZ?.())) return false;
    return (
      location.getX() >= zone.minX &&
      location.getX() <= zone.maxX &&
      location.getY() >= zone.minY &&
      location.getY() <= zone.maxY
    );
  }

  function handleHideoutZoneEnter({ player }) {
    if (!questActive(player)) return;
    if (quest.getStage(player) === STAGE_PERMISSION) advance(player, STAGE_HIDEOUT);
    if (quest.getStage(player) >= STAGE_POTION_USED) ensureAwakeQueen(player);
  }

  function handleStarPlaneZoneEnter({ player }) {
    if (!questActive(player)) return;
    setPlane(player, PLANE_COSMIC);
    syncProgress(player);
    ensureStarflowers(player);
  }

  function handleGorakPlaneZoneEnter({ player }) {
    if (!questActive(player)) return;
    setPlane(player, PLANE_GORAK);
    syncProgress(player);
  }

  function handleAdvanceTime(event) {
    const { player, ms } = event;
    const at = Number(player.getAttribute(MARTIN_TALK_ATTRIBUTE));
    if (!Number.isFinite(at) || at <= 0) return;
    player.setAttribute(MARTIN_TALK_ATTRIBUTE, at - ms);
    event.handledBy.push("FairytaleIICureAQueen");
  }

  function migrateLegacyCompletion(player) {
    // 80 used to be this plugin's completion value; the cache requires 90.
    if (quest.getStage(player) === LEGACY_STAGE_COMPLETE) quest.setStage(player, STAGE_COMPLETE);
  }

  function handleLogin({ player }) {
    migrateLegacyCompletion(player);
    refreshQuestList(player);
    syncProgress(player);
    const location = player.getLocation?.();
    if (!location) return;
    if (questActive(player) && insideZone(location, STAR_PLANE_ZONE)) ensureStarflowers(player);
    if (quest.getStage(player) >= STAGE_POTION_USED && insideZone(location, HIDEOUT_ZONE)) ensureAwakeQueen(player);
  }

  function handleBootstrap({ player }) {
    migrateLegacyCompletion(player);
    syncProgress(player);
  }

  function handleLogout({ player }) {
    removePlayerSpawns(player);
  }

  function handlePlayerDeath({ player }) {
    removePlayerSpawns(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>The Fairy Godfather had taken control of Zanaris and hidden the Fairy</str>",
        "<str>Queen in a resistance hideout while she slept.</str>",
        "<str>I recovered the Queen's secateurs from the Godfather and used a magic</str>",
        "<str>essence potion to wake her.</str>",
        "",
        "<str>I can now use the fairy rings and Fairy Fixit's shop.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_POTION_USED) {
      return [
        "The <col=800000>Fairy Queen</col> is waking from her enchanted sleep.",
        "",
        "I should speak to her.",
      ];
    }
    if (stage >= STAGE_HANDED_OVER) {
      return [
        "Fairy Nuff needs a potion of magic essence to wake the Fairy Queen:",
        "a <col=800000>star flower</col> mixed into a vial of water, then",
        "<col=800000>gorak claw powder</col> added as the catalyst.",
        "",
        held(player, STAR_FLOWER_ITEM_ID) ? "<str>A star flower</str>" : "A star flower",
        held(player, MAGIC_ESSENCE_UNF_ITEM_ID)
          ? "<str>Magic essence (unf)</str>"
          : "Magic essence (unf)",
        hasMagicEssence(player) ? "<str>A magic essence potion</str>" : "A magic essence potion",
      ];
    }
    if (stage >= STAGE_HAS_SECATEURS) {
      return [
        "I recovered the <col=800000>Queen's secateurs</col> from the Fairy",
        "Godfather. I should take them to <col=800000>Fairy Nuff</col> in the",
        "fairy resistance hideout.",
      ];
    }
    if (stage >= STAGE_PICKPOCKET) {
      return [
        "Fairy Nuff is hiding in the fairy resistance hideout with the Queen.",
        "I must pickpocket the <col=800000>Queen's secateurs</col> from the",
        "<col=800000>Fairy Godfather</col> in Zanaris. (Level 40 Thieving)",
      ];
    }
    if (stage >= STAGE_HIDEOUT) {
      return [
        "I found the fairy resistance hideout. I should speak to",
        "<col=800000>Fairy Nuff</col> and <col=800000>Fairy Very Wise</col>.",
      ];
    }
    if (stage >= STAGE_PERMISSION) {
      return [
        "The Godfather let me use the fairy rings. Nuff's certificate says to",
        "use the co-ordinates <col=800000>AIR</col>, <col=800000>DLR</col>,",
        "<col=800000>DJQ</col> and <col=800000>AJS</col> to find the hideout.",
      ];
    }
    if (stage >= STAGE_CERTIFICATE_STUDIED) {
      return [
        "I studied Nuff's certificate, which is covered in strange symbols.",
        "The Fairy chef said she had seen similar marks by the mysterious",
        "ruins. I should read the sign at the <col=800000>Cosmic Altar</col>.",
      ];
    }
    if (stage >= STAGE_INVESTIGATING) {
      return [
        "Martin asked me to find out why the crops are still failing.",
        "Fairy Nuff's room in Zanaris has been ransacked. I should search",
        "the <col=800000>potion shelves</col> and take anything useful.",
      ];
    }
    if (stage >= STAGE_WAITING) {
      return [
        "Martin the Master Gardener has planted new seeds and wants me to",
        "come back once his crops have had time to grow.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Martin the Master Gardener</col> in Draynor Village.",
      "",
      "I must have completed <col=800000>Fairytale I - Growing Pains</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, 3500);
    player.getSkillManager().addExperiences(Skill.THIEVING, 2500);
  }

  api.persistAttribute(CERT_TAKEN_ATTRIBUTE);
  api.persistAttribute(STUDIED_ATTRIBUTE);
  api.persistAttribute(DENIED_ATTRIBUTE);
  api.persistAttribute(PLANES_ATTRIBUTE);
  api.persistAttribute(CHEF_ATTRIBUTE);
  api.persistAttribute(SIGN_ATTRIBUTE);
  api.persistAttribute(MYSTERY_ATTRIBUTE);
  api.persistAttribute(GORAK_ATTRIBUTE);
  api.persistAttribute(MARTIN_TALK_ATTRIBUTE);
  api.persistAttribute(REWARD_GIVEN_ATTRIBUTE, 0);

  groundItems = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "fairytale_ii_cure_a_queen",
    name: "Fairytale II - Cure a Queen",
    varpId: VARP_FAIRYTALE,
    varbitId: VARBIT_QUEST,
    // Cache DB row 47 column 18: varbit 2326 >= 10 is started (stage 5 is the wait step).
    startedValue: STAGE_READY,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.HERBLORE.getIndex(), amount: 3500, label: "Herblore" },
      { skillId: Skill.THIEVING.getIndex(), amount: 2500, label: "Thieving" },
    ],
    rewardItemLabel: "Antique lamp",
    scrollItemId: ANTIQUE_LAMP_ITEM_ID,
    otherRewards: ["Access to the fairy ring network", "Access to Fairy Fixit's Fairy Enchantment shop"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleActionEvent);
  api.onObjectInteraction("Healing certificate", { Take: handleTakeCertificate });
  api.onObjectInteraction("Potion shelves", { Search: handleShelfSearch });
  api.onObjectInteraction("Potion shelf", { Search: handleShelfSearch });
  api.onObjectInteraction("Rune temple sign", { Read: handleReadSign });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handlePotionOnQueen, { noted: false });
  api.onItemAction(handleItemAction);
  api.onItemAction("Antique lamp", { Rub: handleLampRub });
  api.onNpcInteraction("Fairy Godfather", { "Pick-pocket": handlePickpocket });
  api.onNpcInteraction(handleNuffTalk);
  api.onNpcInteraction(handleStarflowerPick);
  api.onNpcDeath(handleGorakDeath);
  api.onZoneEnter(HIDEOUT_ZONE, handleHideoutZoneEnter);
  api.onZoneEnter(STAR_PLANE_ZONE, handleStarPlaneZoneEnter);
  api.onZoneEnter(GORAK_PLANE_ZONE, handleGorakPlaneZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("agent:advance-time", handleAdvanceTime);
};
