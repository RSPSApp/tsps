/**
 * Fairytale II - Cure a Queen (members).
 *
 * The words come from the "Fairytale II - Cure a Queen" transcript page (aligned with the user's
 * revision 242 capture in osrsreboxed-db); shared NPC pages ("Fairy Nuff", "Fairy Godfather",
 * "Fairy Queen", "Fairy Fixit") supply the post-quest tails. This plugin picks the variants, answers
 * the prose conditions and runs the quest's state and scenes, as the whole-quest rsprox capture
 * FairyTale2 (rev 242.1) plays them; docs/quests/fairytale-ii-cure-a-queen/README.md has the ticks.
 *
 * Stage (varbit 2326 "fairy2_queencure_quest" bits 0-6, varp 810), as the capture sets it:
 *    0 not started,
 *    5 Martin asked me to wait for his crops (2333 martinchat set),
 *   10 crops grown, Martin's offer stands,
 *   20 I agreed (77; 1807 -> 2, 2332 Nuff hidden, 2327 certificate on her wall),
 *   30 the grotto's camera sweep ended (306, with 2339),
 *   40 the Godfather let me use the fairy rings (511, with 2328/2329),
 *   45 Fairy Very Wise arrived in the hideout ("You see a fairy approaching ...", 976),
 *   50 I said I'd pickpocket the secateurs (1002; 1808 -> 2 shows the Godfather's Pick-pocket),
 *   60 I have the Queen's secateurs (1603),
 *   65 Nuff took them and cast her spell (1882; 1808 back to 1),
 *   70 Nuff told me the magic essence recipe (1915),
 *   72 star flower added to a vial of water (2391),
 *   73 gorak claw powder added (2398),
 *   75 the potion was poured on the Fairy Queen (2415),
 *   80 the Queen is awake (2419; the 2971 multinpc stands her up),
 *   90 complete (2532; cache DB row 47 column 19 requires >= 90).
 *
 * Sibling varbits written alongside the stage (all in varp 810 unless noted):
 * 2327 fairynuff_cert_taken, 2328 fairyring_use, 2329 fairyring_permission,
 * 2330 fairyring_cosmic_plane, 2331 fairyring_gorack_plane, 2332 fairy2_nuffvisible,
 * 2333 fairy2_martinchat, 2334 fairy2_universal_mystery, 2335 fairy2_rewardgiven,
 * 2336 fairy2_certificute_examined, 2337 fairy2_chefchat, 2338 fairy2_sign_read,
 * 2339 fairy2_trashed_camera_pan, 2382 fairy2_gorak_killed; 1807/1808 are FT1's
 * fairy_queen_check/fairy_godfather_check in varp 671.
 *
 * Rewards per the Wiki: 2 Quest points, 3,500 Herblore / 2,500 Thieving XP, an antique lamp (2,500
 * XP, any skill over 30) and the fairy ring network.
 *
 * Gaps (also in the docs' Not covered list):
 * - Ours: the 5.5 minute Martin wait (the Wiki's quick guide "5 minutes"; not captured).
 * - Ours: what sets 2330 (the cosmic plane). The capture arrives on the plane and picks a star
 *   flower without it changing; this plugin sets it on the Cosmic Being's star flower answer.
 * - Ours: the pickpocket success chance (min 40 Thieving, not boostable).
 * - Brewing before Fairy Nuff's recipe is refused (Ours wording); the Wiki's early-mix loss is not
 *   modelled.
 * - The sleeping queen loc 16316 has no generated identifier, so it is a raw constant here.
 */
module.exports = function registerFairytaleIICureAQueenQuest(api) {
  const {
    Animation,
    ChatType,
    DialogueChainBuilder,
    Item,
    ItemIdentifiers,
    ItemStatementDialogue,
    Location,
    Misc,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = require("../QuestRuntime");
  const { buildLines } = require("../fairytaleii/Journal.FairytaleIICureAQueen");
  const Scenes = require("../fairytaleii/Scenes.FairytaleIICureAQueen")(api);

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
  /** The hideout's fairies (1848-1851 and the fairy child 7748), all on the "Fairy" page's hideout variant. */
  const HIDEOUT_FAIRY_NPC_IDS = new Set([1848, 1849, 1850, 1851, 7748]);
  const COSMIC_BEING_NPC_ID = NpcIdentifiers.COSMIC_BEING; // 1835
  const GORAK_NPC_ID = NpcIdentifiers.GORAK; // 1834 (the FT2 gorak plane; GWD goraks are 3141)
  const STARFLOWER_NPC_ID = NpcIdentifiers.STARFLOWER_2; // 1857, the bloom
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
  const VARBIT_FAIRY_QUEEN_FT1 = 1807; // FT1's "fairy_queen_check": 2 once FT2 starts (77)
  const VARBIT_FAIRY_GODFATHER_FT1 = 1808; // FT1's "fairy_godfather_check": 2 shows Pick-pocket

  const STAGE_WAITING = 5;
  const STAGE_READY = 10;
  const STAGE_INVESTIGATING = 20;
  const STAGE_GROTTO_SEEN = 30;
  const STAGE_PERMISSION = 40;
  const STAGE_VERY_WISE = 45;
  const STAGE_PICKPOCKET = 50;
  const STAGE_HAS_SECATEURS = 60;
  const STAGE_HANDED_OVER = 65;
  const STAGE_RECIPE = 70;
  const STAGE_UNFINISHED_POTION = 72;
  const STAGE_FINISHED_POTION = 73;
  const STAGE_POTION_USED = 75;
  const STAGE_QUEEN_AWAKE = 80;
  const STAGE_COMPLETE = 90;

  const NUFFS_CERTIFICATE_ITEM_ID = ItemIdentifiers.NUFFS_CERTIFICATE; // 9025
  const BROKEN_GLASS_ITEM_ID = ItemIdentifiers.BROKEN_GLASS_2; // 1469, the shelves' box (323)
  const CERTIFICATE_FRONT_INTERFACE = 423;
  const CERTIFICATE_BACK_INTERFACE = 424;
  const RUNE_TEMPLE_SIGN_INTERFACE = 425;
  const GODFATHER_SCROLL_INTERFACE = 427; // scroll_godfather (494)
  const DOCUMENT_OPEN_SCRIPT = 2524;
  const QUEENS_SECATEURS_ITEM_ID = ItemIdentifiers.QUEENS_SECATEURS_2; // 9020
  const GORAK_CLAWS_ITEM_ID = ItemIdentifiers.GORAK_CLAWS; // 9016
  const GORAK_CLAW_POWDER_ITEM_ID = ItemIdentifiers.GORAK_CLAW_POWDER; // 9018
  const STAR_FLOWER_ITEM_ID = ItemIdentifiers.STAR_FLOWER; // 9017
  const MAGIC_ESSENCE_UNF_ITEM_ID = ItemIdentifiers.MAGIC_ESSENCE_UNF_; // 9019
  const MAGIC_ESSENCE_XP = 130; // 2398
  const PICKPOCKET_XP = 47; // 1603; the Wiki's Fairy Godfather Thieving info
  const ESSENCE_DOSE_ITEM_IDS = [
    ItemIdentifiers.MAGIC_ESSENCE_4_, // 9021
    ItemIdentifiers.MAGIC_ESSENCE_3_, // 9022
    ItemIdentifiers.MAGIC_ESSENCE_2_, // 9023
    ItemIdentifiers.MAGIC_ESSENCE_1_, // 9024
  ];
  const VIAL_OF_WATER_ITEM_ID = ItemIdentifiers.VIAL_OF_WATER; // 227
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL; // 229
  const PESTLE_AND_MORTAR_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  // Wiki (Antique lamp (A Tail of Two Cats)): the Fairy Queen's lamp is that quest's 2,500 XP lamp (2532).
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_2; // 6543
  /** Brewing (2390-2398): the vial and grind animations, each with the grind synth. */
  const HERBING_VIAL_SEQ = 363;
  const HERBING_GRIND_SEQ = 364;
  const SYNTH_GRIND = 2608;

  // The sleeping queen is a varbit-transformed multi loc with no generated identifier.
  const QUEEN_BED_OBJECT_ID = 16316; // fairy_queen_sleeping_multi2 (2415)
  const RIGHT_SHELF = { x: 2389, y: 4470 }; // the potion shelf a lost certificate's copy hides in
  const NUFFS_ROOM = { minX: 2384, maxX: 2389, minY: 4470, maxY: 4474, levels: [0] };
  const ROOM_PAN_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:nuff-room-pan";

  const START_HOOK = "quest:fairytale-ii-cure-a-queen:start";
  const MARTIN_QUEST_OPTION = "Ask about the quest.";
  const MARTIN_WAIT_MS = 5.5 * 60 * 1000;

  // Transcript step ids.
  const CERT_BEFORE_STUDY_CONDITION_IDS = new Set(["HOEOez", "IznESa", "eOKuqb", "eQw7c6"]);
  const CERT_AFTER_STUDY_CONDITION_IDS = new Set(["hNZlpT", "ucI2OP", "pwsAFt", "2OgD4O"]);
  const SHELF_WRONG_CONDITION_ID = "1E1huy";
  const SHELF_RIGHT_CONDITION_ID = "RnasHV";
  const SHELF_FULL_CONDITION_ID = "uSZg_Z";
  const SHELF_GLASS_MESSAGE_ID = "4X0HGi";
  const SHELF_COPY_MESSAGE_IDS = new Set(["Scnlfm", "1hMiKZ"]);
  const PICKPOCKET_SUCCESS_MESSAGE_ID = "LMiXR_";
  const PICKPOCKET_ALREADY_MESSAGE_ID = "lC_3S_";
  const PICKPOCKET_FULL_CONDITION_ID = "5dBfKL";
  const PICKPOCKET_SUCCESS_CONDITION_ID = "bx036-";
  const PICKPOCKET_ALREADY_CONDITION_ID = "ntjs-9";
  const PICKPOCKET_FAIL_CONDITION_ID = "wyNz16";
  const POTION_NONE_CONDITION_ID = "ELvtOa";
  const POTION_UNFINISHED_CONDITION_ID = "zEkOlM";
  const POTION_READY_CONDITION_ID = "FJYR1J";
  const REWARD_NO_ROOM_CONDITION_ID = "-LSx7-";
  const REWARD_ROOM_CONDITION_ID = "e2I60y";
  const SCROLL_ACTION_ID = "myHyVx"; // "(Contract scroll interface pops up.)"
  const NUFF_INTRO_CONTINUE_ACTION_ID = "YO3q33"; // "You see a fairy approaching ..." message
  const HAND_OVER_SECATEURS_MESSAGE_ID = "j-qUAH";
  const REWARD_LAMP_MESSAGE_ID = "SuXalx";
  const COMPLETE_ACTION_ID = "Vca-Ck";
  /** Conditions the capture-aligned transcript adds; answered by their text. */
  const CERT_OPTION_CONDITION = "With Fairy Nuff's certificate:";
  const FAIRIES_BEFORE_NEWS_CONDITION = "Before Fairy Very Wise brings her news:";
  const RECAP_GORAK_ONLY_CONDITION = "After visiting the Gorak Plane but not the Cosmic Plane:";
  const RECAP_NO_GORAK_CONDITION = "Before visiting the Gorak Plane:";
  const SHOW_GODFATHER_OPTION = "Show the Godfather the Certificate!";
  const SHOW_COORDINATOR_OPTION = "Fairy Nuff's certificate.";

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
  const HIDEOUT_FAIRIES_VARIANT = "in-the-hideout-talking-to-the-fairies";
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
  /** The certificate box names the NPC it is shown to; its picture is the certificate (433, 637). */
  const CERTIFICATE_SHOWN = /^You show the certificate to /;

  const CERT_TAKEN_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:certificate-taken";
  const STUDIED_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:certificate-studied";
  const DENIED_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:godfather-denied";
  const PLANES_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:planes";
  const CHEF_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:chef-chat";
  const SIGN_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:sign-read";
  const MYSTERY_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:universal-mystery";
  const GORAK_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:gorak-killed";
  const MARTIN_TALK_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:martin-talk-at";
  /** Nuff's both-planes recap ended with "Yes, I'm on my way."; she then asks after the potion. */
  const RECAP_DONE_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:recap-done";
  const REWARD_GIVEN_ATTRIBUTE = "fairytale-ii-cure-a-queen:reward-given";
  /** Set when the Queen wakes (80): an 80 without it is an older save's completion (see migrate). */
  const QUEEN_WOKE_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:queen-woke";
  /** The lamp box completed the quest; its scroll is still to show (not saved: a relog skips it). */
  const ANNOUNCE_PENDING_ATTRIBUTE = "quest.fairytale-ii-cure-a-queen:announce-pending";
  const PLANE_COSMIC = 1 << 0;
  const PLANE_GORAK = 1 << 1;

  const STAR_PLANE_ZONE = { minX: 2060, maxX: 2098, minY: 4806, maxY: 4862, levels: [0] };
  const GORAK_PLANE_ZONE = { minX: 3009, maxX: 3072, minY: 5312, maxY: 5380, levels: [0] };
  const HIDEOUT_SEQUENCE = ["AIR", "DLR", "DJQ", "AJS"];
  // Cache loc 29495 is 1x1 here; ordinary DB89 destinations likewise match its anchor (846).
  const HIDEOUT_RING = new Location(2328, 4426, 0);

  let quest;
  let groundItems;
  const shelfSearch = new WeakMap();
  const pickpocket = new WeakMap();
  const hideoutSequence = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();
  const studied = (player) => Number(player.getAttribute(STUDIED_ATTRIBUTE)) > 0;
  const flag = (player, attribute) => Number(player.getAttribute(attribute)) > 0;

  function answerFairyRingAccess(request) {
    request.allowed = quest.getStage(request.player) >= STAGE_PERMISSION;
  }

  function resolveFairyRingDestination(request) {
    const { player, code } = request;
    if (quest.getStage(player) < STAGE_PERMISSION) return;
    // DJQ is the sequence's no-trip step, not a new destination (827).
    if (code === "DJQ") request.destination = request.origin ?? player.getLocation().clone();
    if (code !== "AJS" || hideoutSequence.get(player) !== 3) return;
    if (quest.isComplete(player)
      || (held(player, NUFFS_CERTIFICATE_ITEM_ID) && studied(player) && flag(player, SIGN_ATTRIBUTE))) {
      request.destination = HIDEOUT_RING;
    } else if (held(player, NUFFS_CERTIFICATE_ITEM_ID) && studied(player)) {
      // Wiki (Fairytale II, Regrouping): with the right sequence but the Cosmic Altar sign skipped,
      // "Maybe you need to investigate further first.." (the penguin island is for a missing or
      // unstudied certificate). No recording; the ring keeping the player in place is assumed.
      request.destination = request.origin ?? player.getLocation().clone();
      player.sendMessage("Maybe you need to investigate further first..");
    }
  }

  function recordFairyRingTravel({ player, code }) {
    const step = hideoutSequence.get(player) ?? 0;
    const next = code === HIDEOUT_SEQUENCE[step] ? step + 1 : code === HIDEOUT_SEQUENCE[0] ? 1 : 0;
    hideoutSequence.set(player, next < HIDEOUT_SEQUENCE.length ? next : 0);
  }

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

  const visited = (player, bit) => (planes(player) & bit) !== 0;

  function setPlane(player, bit) {
    player.setAttribute(PLANES_ATTRIBUTE, planes(player) | bit);
  }

  function hasMagicEssence(player) {
    return ESSENCE_DOSE_ITEM_IDS.some((itemId) => held(player, itemId));
  }

  function potionRecipeTaught(player) {
    return quest.getStage(player) >= STAGE_RECIPE;
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

  function roomPanSeen(player) {
    return player.getAttribute(ROOM_PAN_ATTRIBUTE) === true
      || quest.getStage(player) >= STAGE_GROTTO_SEEN
      || flag(player, CERT_TAKEN_ATTRIBUTE);
  }

  /** Re-sends every sibling varbit in varp 810 (the quest stage lives in 2326) and FT1's two. */
  function syncProgress(player) {
    const sender = player.getPacketSender();
    const stage = quest.getStage(player);
    const complete = stage >= STAGE_COMPLETE;
    sender.sendVarbit(VARBIT_CERT_TAKEN, stage < STAGE_INVESTIGATING ? 0 : flag(player, CERT_TAKEN_ATTRIBUTE) ? 2 : 1);
    sender.sendVarbit(VARBIT_RING_USE, stage >= STAGE_PERMISSION ? 1 : 0);
    sender.sendVarbit(VARBIT_RING_PERMISSION, stage >= STAGE_PERMISSION ? 2 : flag(player, DENIED_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_COSMIC_PLANE, visited(player, PLANE_COSMIC) ? 1 : 0);
    sender.sendVarbit(VARBIT_GORAK_PLANE, visited(player, PLANE_GORAK) ? 1 : 0);
    sender.sendVarbit(VARBIT_NUFF_VISIBLE, stage >= STAGE_INVESTIGATING && !complete ? 1 : 0);
    sender.sendVarbit(VARBIT_MARTIN_CHAT, stage >= STAGE_WAITING ? 1 : 0);
    sender.sendVarbit(VARBIT_UNIVERSAL_MYSTERY, flag(player, MYSTERY_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_REWARD_GIVEN, complete ? 1 : 0);
    sender.sendVarbit(VARBIT_CERT_EXAMINED, studied(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_CHEF_CHAT, flag(player, CHEF_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_SIGN_READ, flag(player, SIGN_ATTRIBUTE) ? 4 : 0);
    sender.sendVarbit(VARBIT_TRASHED_PAN, roomPanSeen(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_GORAK_KILLED, flag(player, GORAK_ATTRIBUTE) ? 1 : 0);
    if (stage >= STAGE_INVESTIGATING) sender.sendVarbit(VARBIT_FAIRY_QUEEN_FT1, 2);
    // The Godfather's spawn (5850) offers Pick-pocket only while 1808 is 2 (1002 -> 1882).
    if (stage >= STAGE_PICKPOCKET && stage < STAGE_HANDED_OVER) sender.sendVarbit(VARBIT_FAIRY_GODFATHER_FT1, 2);
    else if (stage >= STAGE_HANDED_OVER) sender.sendVarbit(VARBIT_FAIRY_GODFATHER_FT1, 1);
  }

  // ==========================================================================
  // Transcript selection
  // ==========================================================================

  function godfatherVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-fairytale-ii";
    if (stage >= STAGE_PERMISSION) return GODFATHER_PERMISSION_VARIANT;
    if (stage >= STAGE_INVESTIGATING) {
      return flag(player, DENIED_ATTRIBUTE) ? GODFATHER_DENIED_VARIANT : GODFATHER_START_VARIANT;
    }
    return null;
  }

  function nuffVariant(player, stage) {
    if (stage >= STAGE_QUEEN_AWAKE) return WAKE_VARIANT;
    if (stage >= STAGE_UNFINISHED_POTION) return NUFF_POTION_VARIANT;
    // 70 (and 65 if her recipe was cut short): the recap until the both-planes answer is given (2364).
    if (stage >= STAGE_HANDED_OVER) return flag(player, RECAP_DONE_ATTRIBUTE) ? NUFF_POTION_VARIANT : NUFF_RECAP_VARIANT;
    if (stage >= STAGE_HAS_SECATEURS) {
      return held(player, QUEENS_SECATEURS_ITEM_ID) ? NUFF_GIVE_SECATEURS_VARIANT : NUFF_LOST_SECATEURS_VARIANT;
    }
    if (stage >= STAGE_PICKPOCKET) return NUFF_AGAIN_VARIANT;
    if (stage >= STAGE_PERMISSION) return NUFF_INTRO_VARIANT;
    return null;
  }

  function queenVariant(stage) {
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-finishing-fairytale-ii-cure-a-queen";
    if (stage >= STAGE_QUEEN_AWAKE) return WAKE_VARIANT;
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === MARTIN_NPC_ID) {
      if (!ft1Complete(player)) return null;
      if (stage >= STAGE_COMPLETE) return "standard-dialogue";
      if (stage >= STAGE_INVESTIGATING) return MARTIN_AGAIN_VARIANT;
      // 10 is the ready-to-accept copy: a refused start stays here so the
      // offer (and its quest:start hook) can be shown again (58-77).
      if (stage >= STAGE_READY) return MARTIN_READY_VARIANT;
      if (stage >= STAGE_WAITING) return martinWaited(player) ? MARTIN_READY_VARIANT : MARTIN_WAIT_VARIANT;
      return MARTIN_FIRST_VARIANT;
    }
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId)) return godfatherVariant(player, stage);
    if (FAIRY_QUEEN_NPC_IDS.has(npcId)) return queenVariant(stage);
    if (npcId === FAIRY_VERY_WISE_NPC_ID) {
      // At 80 she already thanks the player (2424-2426).
      if (stage >= STAGE_QUEEN_AWAKE) return VERY_WISE_CURED_VARIANT;
      if (stage >= STAGE_VERY_WISE) return VERY_WISE_VARIANT;
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
    if (HIDEOUT_FAIRY_NPC_IDS.has(npcId) && stage >= STAGE_PERMISSION && stage < STAGE_COMPLETE) {
      return { page: PAGE, variant: HIDEOUT_FAIRIES_VARIANT };
    }
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId, text }) {
    switch (text) {
      case CERT_OPTION_CONDITION:
        return held(player, NUFFS_CERTIFICATE_ITEM_ID);
      case FAIRIES_BEFORE_NEWS_CONDITION:
        // Stage 40 (877-941) has these five; from 50 the Wiki's seven (1016-1020).
        return quest.getStage(player) < STAGE_VERY_WISE;
      case RECAP_GORAK_ONLY_CONDITION:
        return visited(player, PLANE_GORAK) && !visited(player, PLANE_COSMIC);
      case RECAP_NO_GORAK_CONDITION:
        return !visited(player, PLANE_GORAK);
      default:
        break;
    }
    switch (stepId) {
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
    advance(player, STAGE_PERMISSION);
    syncProgress(player);
  }

  const onPage = (event, variant) => event.pages?.some(({ page, variants }) => page === PAGE && variants?.includes(variant));

  /**
   * Line events come as the runtime lays out a run of lines, so a line's state change goes in
   * `before` (as it shows) or `after` (once the player continues past it).
   */
  function handleLine(event) {
    const { player, npcId } = event;
    const text = String(event.step?.text ?? event.step?.player ?? event.text ?? "");
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage < STAGE_INVESTIGATING || stage >= STAGE_PERMISSION) return;
      // The contract-scroll route: permission comes as his "wrong scroll" line shows (511).
      if (text.startsWith("Eet does? Oh, sorry, must-a geeven yous da wrong-a scroll.")) {
        event.before = () => grantFairyRingPermission(player);
      } else if (text.startsWith("Good. Now-a yous talk-a to da co-ordinator.")) {
        // The Wiki's "Yes, okay." route (not captured): permission once he says so. Ours: on the line.
        event.before = () => grantFairyRingPermission(player);
      }
      return;
    }
    if (!FAIRY_NUFF_NPC_IDS.has(npcId)) return;
    if (text.startsWith("That's easy I'll just pickpocket them off of him")) {
      // The player's promise is where the pickpocket task starts (1002).
      event.before = () => {
        if (quest.getStage(player) >= STAGE_PERMISSION) advance(player, STAGE_PICKPOCKET);
      };
      return;
    }
    if (text.startsWith("only way onto or off of their world is through the fairy rings.")) {
      // The recipe's last line; the stage moves as the player continues past it (1915).
      event.after = () => advance(player, STAGE_RECIPE);
      return;
    }
    if (text === "Yes, I'm on my way." && onPage(event, NUFF_RECAP_VARIANT)) {
      event.after = () => {
        player.setAttribute(RECAP_DONE_ATTRIBUTE, 1);
        advance(player, STAGE_RECIPE);
      };
      return;
    }
    if (text.startsWith("Star Flowers only grow on the higher planes") && onPage(event, NUFF_RECAP_VARIANT)
      && !text.includes("Goraks also live")) {
      // The Gorak-only recap ends on this line (2370).
      event.after = () => advance(player, STAGE_RECIPE);
    }
  }

  function handleChoice(choice) {
    const { player, npcId, option } = choice;
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
      // Ours: the cosmic plane's varbit (see the header).
      if (quest.getStage(player) >= STAGE_HANDED_OVER && !quest.isComplete(player)) setPlane(player, PLANE_COSMIC);
      player.setAttribute(MYSTERY_ATTRIBUTE, 1);
      syncProgress(player);
      return;
    }
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId) && option === SHOW_GODFATHER_OPTION) {
      // The menu's third option shows the certificate (431-437); its "below" is that section.
      choice.end = true;
      showCertificate(player, npcId);
      return;
    }
    if (npcId === COORDINATOR_NPC_ID && option === SHOW_COORDINATOR_OPTION) {
      // Her "below" would run on into the fairy rings answer (636-639).
      choice.end = true;
      showCertificate(player, npcId);
      return;
    }
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING || stage >= STAGE_PERMISSION) return;
    if (option === "No, I'll rescue her myself.") {
      // 2329 goes to 1 with the refusal (473).
      player.setAttribute(DENIED_ATTRIBUTE, 1);
      syncProgress(player);
    }
  }

  /**
   * After "That's not very helpful." the Godfather's "other options" go straight into the one
   * question not yet asked (455-457), as live plays it, rather than showing the menu again.
   */
  function handleMenu(notice) {
    if (!FAIRY_GODFATHER_NPC_IDS.has(notice.npcId) || notice.via !== "other") return;
    const remaining = (notice.options ?? []).filter((option) => option.text !== notice.chosen);
    if (remaining.length !== 1 || !Array.isArray(remaining[0].steps)) return;
    notice.handled = true;
    startTranscript(api, notice.player, notice.npcId, PAGE, GODFATHER_START_VARIANT, () => remaining[0].steps);
  }

  function showCertificate(player, npcId) {
    const variant = CERTIFICATE_VARIANTS.get(npcId);
    if (!variant) return;
    // The certificate's section plays the tick after the pick (431 -> 433, 636 -> 637).
    api.core.TaskManager.submit(new api.core.CountdownTask({}, 1, () =>
      startTranscript(api, player, npcId, PAGE, variant)));
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== MARTIN_NPC_ID || hook !== START_HOOK) return;
    if (!ft1Complete(player) || quest.getStage(player) >= STAGE_INVESTIGATING) return;
    advance(player, STAGE_INVESTIGATING);
    player.sendMessage(questStartMessage(player, "Fairytale II - Cure a Queen")); // 77
  }

  function handleConditionEvent(event) {
    const { player, stepId } = event;
    if (stepId === "ucI2OP") {
      player.setAttribute(CHEF_ATTRIBUTE, 1);
      syncProgress(player);
    }
  }

  function handleActionEvent(event) {
    const { player, npcId, stepId } = event;
    if (event.kind === "message") {
      handleMessage(event);
      return;
    }
    if (stepId === SCROLL_ACTION_ID && FAIRY_GODFATHER_NPC_IDS.has(npcId)) {
      // The contract scroll opens a tick after his line (493 -> 494) and holds the talk until it is
      // closed; the player's refusal shows the tick after (506 -> 507).
      event.wait = (resume) => {
        api.core.TaskManager.submit(new api.core.CountdownTask({}, 1, () => {
          player.getPacketSender().sendClientScript(DOCUMENT_OPEN_SCRIPT, -1, -1).sendInterface(GODFATHER_SCROLL_INTERFACE);
          waitForScroll.set(player, { resume, at: player.getLocation().clone() });
        }));
      };
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (!FAIRY_QUEEN_NPC_IDS.has(npcId) && !FAIRY_NUFF_NPC_IDS.has(npcId)) return;
    event.handled = true;
    event.end = true;
    // The lamp box already completed the quest (2532); the scroll comes as it is continued (2535).
    if (flag(player, REWARD_GIVEN_ATTRIBUTE) && quest.isComplete(player) && flag(player, ANNOUNCE_PENDING_ATTRIBUTE)) {
      player.setAttribute(ANNOUNCE_PENDING_ATTRIBUTE, 0);
      quest.announceCompletion(player);
    } else if (quest.getStage(player) >= STAGE_QUEEN_AWAKE && !quest.isComplete(player)) {
      quest.complete(player);
      syncProgress(player);
    }
  }

  const waitForScroll = new WeakMap();

  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId !== GODFATHER_SCROLL_INTERFACE) return;
    const waiting = waitForScroll.get(player);
    if (!waiting) return;
    waitForScroll.delete(player);
    // Closed in place, the talk carries on (506-507); walking off (which closes it too) ends it.
    api.core.TaskManager.submit(new api.core.CountdownTask({}, 1, () => {
      if (player.getLocation().equals(waiting.at)) waiting.resume();
    }));
  }

  /** Message steps: the boxes' pictures, and the state each one carries. */
  function handleMessage(event) {
    const { player, npcId, stepId } = event;
    const text = String(event.text ?? "");
    if (CERTIFICATE_SHOWN.test(text)) {
      event.box = { items: [NUFFS_CERTIFICATE_ITEM_ID] };
      return;
    }
    if (stepId === PICKPOCKET_SUCCESS_MESSAGE_ID) {
      event.box = { items: [QUEENS_SECATEURS_ITEM_ID] }; // 1603
      return;
    }
    if (stepId === PICKPOCKET_ALREADY_MESSAGE_ID) {
      event.box = { statement: true }; // the Wiki's tbox
      return;
    }
    if (stepId === SHELF_GLASS_MESSAGE_ID) {
      event.box = { items: [BROKEN_GLASS_ITEM_ID] };
      shelfSearch.delete(player);
      return;
    }
    if (SHELF_COPY_MESSAGE_IDS.has(stepId)) {
      event.box = { items: [NUFFS_CERTIFICATE_ITEM_ID] };
      const context = shelfSearch.get(player);
      shelfSearch.delete(player);
      if (context !== "right" || freeSlots(player) < 1 || held(player, NUFFS_CERTIFICATE_ITEM_ID)) return;
      player.getInventory().adds(NUFFS_CERTIFICATE_ITEM_ID, 1);
      player.setAttribute(CERT_TAKEN_ATTRIBUTE, 1);
      syncProgress(player);
      return;
    }
    if (stepId === NUFF_INTRO_CONTINUE_ACTION_ID && FAIRY_NUFF_NPC_IDS.has(npcId)) {
      // "You see a fairy approaching ..." brings Fairy Very Wise (the 2970 multinpc) in (976).
      if (quest.getStage(player) >= STAGE_PERMISSION) advance(player, STAGE_VERY_WISE);
      return;
    }
    if (stepId === HAND_OVER_SECATEURS_MESSAGE_ID && FAIRY_NUFF_NPC_IDS.has(npcId)) {
      // The box shows the secateurs (1880); as it closes Nuff casts and takes them (1882).
      event.box = { items: [QUEENS_SECATEURS_ITEM_ID] };
      event.after = () => {
        if (held(player, QUEENS_SECATEURS_ITEM_ID)) player.getInventory().deleteNumber(QUEENS_SECATEURS_ITEM_ID, 1);
        advance(player, STAGE_HANDED_OVER);
        Scenes.nuffEnchant(player, event.npc);
      };
      return;
    }
    if (stepId === REWARD_LAMP_MESSAGE_ID && (FAIRY_QUEEN_NPC_IDS.has(npcId) || FAIRY_NUFF_NPC_IDS.has(npcId))) {
      event.box = { items: [ANTIQUE_LAMP_ITEM_ID] };
      // The room branch's box; a full bag (its own branch) never gets here, and a stale one cannot grant.
      if (flag(player, REWARD_GIVEN_ATTRIBUTE) || freeSlots(player) < 1) return;
      const inventory = player.getInventory();
      const before = inventory.getAmount(ANTIQUE_LAMP_ITEM_ID);
      inventory.adds(ANTIQUE_LAMP_ITEM_ID, 1);
      if (inventory.getAmount(ANTIQUE_LAMP_ITEM_ID) <= before) return;
      player.setAttribute(REWARD_GIVEN_ATTRIBUTE, 1);
      // 90, 2335 and the XP come with the box (2532); the jingle, chat line and scroll as it closes.
      if (quest.getStage(player) >= STAGE_QUEEN_AWAKE && !quest.isComplete(player)) {
        player.setAttribute(ANNOUNCE_PENDING_ATTRIBUTE, 1);
        quest.complete(player, { scroll: false, announce: false });
      }
      syncProgress(player);
    }
  }

  // ==========================================================================
  // The grotto, the certificate and the sign
  // ==========================================================================

  function startRoomPan({ player }) {
    if (quest.getStage(player) !== STAGE_INVESTIGATING || roomPanSeen(player) || Scenes.isPanning(player)) return;
    Scenes.startRoomPan(player, () => {
      player.setAttribute(ROOM_PAN_ATTRIBUTE, true);
      advance(player, STAGE_GROTTO_SEEN);
    });
  }

  /** Take on the broken frame (317-318): the certificate and its box, 2327 to 2. */
  function handleTakeCertificate(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING || quest.isComplete(player)) return false;
    if (flag(player, CERT_TAKEN_ATTRIBUTE)) return true;
    if (freeSlots(player) < 1) {
      // Ours: no recording or Wiki line for a full inventory here.
      player.sendMessage("You don't have enough inventory space to take the certificate.");
      return true;
    }
    player.getInventory().adds(NUFFS_CERTIFICATE_ITEM_ID, 1);
    player.setAttribute(CERT_TAKEN_ATTRIBUTE, 1);
    syncProgress(player);
    player.sendMessage("You pick up Fairy Nuff's certificate, being careful not to cut yourself on its broken frame.");
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, NUFFS_CERTIFICATE_ITEM_ID,
      "You pick up Fairy Nuff's certificate, being careful not to cut yourself on its broken frame.")));
    return true;
  }

  function handleShelfSearch(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INVESTIGATING) return false;
    // A lost certificate's copy hides in the right shelf (the Wiki); with it held every shelf is glass (321-346).
    const right = !quest.isComplete(player)
      && flag(player, CERT_TAKEN_ATTRIBUTE)
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
      // Ours: the Wiki only says the sign must be read with the certificate studied.
      player.sendMessage("The strange markings on the sign mean nothing to you yet.");
      return true;
    }
    player.setAttribute(SIGN_ATTRIBUTE, 1);
    syncProgress(player);
    openDocument(player, RUNE_TEMPLE_SIGN_INTERFACE);
    return true;
  }

  function openDocument(player, interfaceId, args = [-1, -1]) {
    player.getPacketSender().sendClientScript(DOCUMENT_OPEN_SCRIPT, ...args).sendInterface(interfaceId);
  }

  function handleReadCertificate({ player }) {
    openDocument(player, CERTIFICATE_FRONT_INTERFACE);
    return true;
  }

  function handleStudyCertificate({ player }) {
    player.setAttribute(STUDIED_ATTRIBUTE, 1);
    // Older saves taken the certificate before the sweep existed are still at 20.
    if (quest.getStage(player) === STAGE_INVESTIGATING && roomPanSeen(player)) advance(player, STAGE_GROTTO_SEEN);
    syncProgress(player);
    player.sendMessage("You turn the certificate over and look at the back...");
    // RSProx 424 supplies the back document's distinct mainmodal arguments.
    openDocument(player, CERTIFICATE_BACK_INTERFACE, [4269835, 100]);
    return true;
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== NUFFS_CERTIFICATE_ITEM_ID) return;
    const variant = CERTIFICATE_VARIANTS.get(event.npcId);
    if (!variant) return;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, variant);
  }

  // ==========================================================================
  // The Godfather's pocket
  // ==========================================================================

  function handlePickpocket(event) {
    const { player, npcId, npc } = event;
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_PICKPOCKET || stage >= STAGE_HANDED_OVER) return false;
    event.handled = true;
    if (Scenes.isKnockedOut(player)) return true;
    if (held(player, QUEENS_SECATEURS_ITEM_ID)) {
      pickpocket.set(player, "already");
      startTranscript(api, player, npcId, PAGE, PICKPOCKET_VARIANT, (steps) => onlyBranch(steps, PICKPOCKET_ALREADY_CONDITION_ID));
      return true;
    }
    if (player.getSkillManager().getMaxLevel(Skill.THIEVING) < 40) {
      // Ours: the requirement message (the Wiki gives the level, not the line).
      player.sendMessage("You need a Thieving level of 40 to pickpocket the Fairy Godfather.");
      return true;
    }
    if (freeSlots(player) < 1) {
      pickpocket.set(player, "full");
      startTranscript(api, player, npcId, PAGE, PICKPOCKET_VARIANT, (steps) => onlyBranch(steps, PICKPOCKET_FULL_CONDITION_ID, true));
      return true;
    }
    const level = player.getSkillManager().getMaxLevel(Skill.THIEVING);
    const chance = Math.min(95, 45 + (level - 40) * 2); // Ours
    Scenes.reach(player, npc);
    if (Misc.randomInclusive(1, 100) > chance) {
      pickpocket.set(player, "fail");
      Scenes.knockOut(player, npc);
      return true;
    }
    // Success (1603): the stage, the secateurs and their box, 47 XP and the jingle on one tick.
    player.getInventory().adds(QUEENS_SECATEURS_ITEM_ID, 1);
    player.getSkillManager().addExperiences(Skill.THIEVING, PICKPOCKET_XP);
    advance(player, STAGE_HAS_SECATEURS);
    Scenes.stealJingle(player);
    pickpocket.set(player, "success");
    startTranscript(api, player, npcId, PAGE, PICKPOCKET_VARIANT, (steps) => onlyBranch(steps, PICKPOCKET_SUCCESS_CONDITION_ID));
    return true;
  }

  /** One condition branch of the pickpocket page (the reach line is the plugin's, on the same tick). */
  function onlyBranch(steps, id, keepAttempt = false) {
    const branch = steps.find((step) => step.id === id);
    if (!branch) return steps;
    return [...(keepAttempt ? steps.filter((step) => step.type === "message").slice(0, 1) : []), ...(branch.steps ?? [])];
  }

  // ==========================================================================
  // Brewing the magic essence and curing the queen
  // ==========================================================================

  function pair(event, a, b) {
    const ids = [event.usedItemId, event.usedWithItemId];
    return ids.includes(a) && ids.includes(b);
  }

  function brew(player, seqId, message) {
    player.performAnimation(new Animation(seqId));
    api.core.Sounds.sendSound(player, new api.core.Sound(SYNTH_GRIND, 1, 0, 1));
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, message);
  }

  function handleItemOnItem(event) {
    const { player } = event;
    if (pair(event, PESTLE_AND_MORTAR_ITEM_ID, GORAK_CLAWS_ITEM_ID)) {
      if (!held(player, GORAK_CLAWS_ITEM_ID)) return;
      event.handled = true;
      player.getInventory().deleteNumber(GORAK_CLAWS_ITEM_ID, 1);
      player.getInventory().adds(GORAK_CLAW_POWDER_ITEM_ID, 1);
      brew(player, HERBING_GRIND_SEQ, "You grind the Gorak's claw into dust."); // 2394
      return;
    }
    if (pair(event, STAR_FLOWER_ITEM_ID, VIAL_OF_WATER_ITEM_ID)) {
      event.handled = true;
      if (!potionRecipeTaught(player)) {
        // Ours.
        player.sendMessage("I should learn how Fairy Nuff wants the potion prepared first.");
        return;
      }
      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 57) {
        // Ours: the Wiki gives the level, not the line.
        player.sendMessage("You need a Herblore level of 57 to mix this potion.");
        return;
      }
      player.getInventory().deleteNumber(STAR_FLOWER_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_OF_WATER_ITEM_ID, 1);
      player.getInventory().adds(MAGIC_ESSENCE_UNF_ITEM_ID, 1);
      brew(player, HERBING_VIAL_SEQ, "You put the star flower into the vial of water."); // 2390-2391
      if (quest.getStage(player) >= STAGE_RECIPE) advance(player, STAGE_UNFINISHED_POTION);
      return;
    }
    if (pair(event, GORAK_CLAW_POWDER_ITEM_ID, MAGIC_ESSENCE_UNF_ITEM_ID)) {
      event.handled = true;
      if (!potionRecipeTaught(player)) {
        player.sendMessage("I should learn how Fairy Nuff wants the potion prepared first.");
        return;
      }
      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 57) {
        player.sendMessage("You need a Herblore level of 57 to mix this potion.");
        return;
      }
      player.getInventory().deleteNumber(GORAK_CLAW_POWDER_ITEM_ID, 1);
      player.getInventory().deleteNumber(MAGIC_ESSENCE_UNF_ITEM_ID, 1);
      // Magic essence(3), for 130 Herblore XP (2398; the Wiki's Magic essence page).
      player.getInventory().adds(ItemIdentifiers.MAGIC_ESSENCE_3_, 1);
      player.getSkillManager().addExperiences(Skill.HERBLORE, MAGIC_ESSENCE_XP);
      brew(player, HERBING_VIAL_SEQ, "You mix the gorak claws into your potion."); // 2397-2398
      if (quest.getStage(player) >= STAGE_RECIPE) advance(player, STAGE_FINISHED_POTION);
    }
  }

  function consumeEssenceDose(player, itemId) {
    const index = ESSENCE_DOSE_ITEM_IDS.indexOf(itemId);
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(index < ESSENCE_DOSE_ITEM_IDS.length - 1 ? ESSENCE_DOSE_ITEM_IDS[index + 1] : VIAL_ITEM_ID, 1);
  }

  /** A dose on the sleeping Queen (2415): 75, the pour, her waking; four ticks later 80 (2419). */
  function handlePotionOnQueen(event) {
    const { player, itemId, objectId, object } = event;
    if (objectId !== QUEEN_BED_OBJECT_ID) return;
    if (ESSENCE_DOSE_ITEM_IDS.indexOf(itemId) === -1) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_HANDED_OVER) {
      // Ours.
      player.sendMessage("Fairy Nuff should see this potion before you use it.");
      return;
    }
    if (!potionRecipeTaught(player)) {
      player.sendMessage("I should learn how Fairy Nuff wants the potion prepared first.");
      return;
    }
    if (stage >= STAGE_POTION_USED || Scenes.isPouring(player)) return;
    consumeEssenceDose(player, itemId);
    advance(player, STAGE_POTION_USED);
    Scenes.pourPotion(player, object, () => wakeQueen(player));
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
    const { player, npcId, npc } = event;
    if (!FAIRY_NUFF_NPC_IDS.has(npcId)) return;
    if (actionOf(event) !== "talk-to") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_PERMISSION) return;
    event.handled = true;
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, npcId, "Fairy Nuff", "after-fairytale-part-2", undefined, npc);
      return;
    }
    // The awakening plays from her Talk-to at 80, the Queen speaking first (2431-2432).
    startTranscript(api, player, npcId, PAGE, nuffVariant(player, stage), undefined, npc);
  }

  /** Pick on a bloom (2073-2076): no message; the star flower goes in the pack as the bloom withers. */
  function handleStarflowerPick(event) {
    const { player, npcId, npc } = event;
    if (npcId !== STARFLOWER_NPC_ID) return;
    if (actionOf(event) !== "pick") return;
    event.handled = true;
    const stage = quest.getStage(player);
    const complete = stage >= STAGE_COMPLETE;
    if (!Scenes.bloomOf(player, npc)) return;
    if (!complete && held(player, STAR_FLOWER_ITEM_ID)) {
      // The Wiki (Star flower).
      player.sendMessage("You already have a Star flower, you don't need another one.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.FARMING) < 49) {
      // Ours: the Wiki gives the level, not the line.
      player.sendMessage("You need a Farming level of 49 to pick the star flower.");
      return;
    }
    if (freeSlots(player) < 1) {
      // Ours.
      player.sendMessage("You don't have enough inventory space to pick the star flower.");
      return;
    }
    if (!Scenes.pickFlower(player, npc)) return;
    player.getInventory().adds(STAR_FLOWER_ITEM_ID, 1);
  }

  function handleGorakDeath({ killer, npc, npcId, location }) {
    if (npcId !== GORAK_NPC_ID) return;
    if (!killer || killer.isNpc?.()) return;
    if (quest.getStage(killer) < STAGE_HANDED_OVER) return;
    // The killer's own claws, never public (2206, "Untradeable drop: Gorak claws"). Gorak has no
    // generated drop table here, so its bones and coins are not dropped (see the docs).
    const spot = npc?.getLocation?.() ?? (location ? new Location(location.x, location.y, location.z) : null);
    if (spot && groundItems) groundItems.registerLocation(killer, new Item(GORAK_CLAWS_ITEM_ID, 1), spot);
    killer.setAttribute(GORAK_ATTRIBUTE, 1);
    syncProgress(killer);
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

  /**
   * The field grows for a player with Nuff's recipe, or after the quest (1966-2098). Ours (kept from
   * main): during the quest only while Nuff's certificate is held; neither source says.
   */
  function fieldOpen(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return true;
    return stage >= STAGE_HANDED_OVER && held(player, NUFFS_CERTIFICATE_ITEM_ID);
  }

  function enterStarPlane(player) {
    if (!fieldOpen(player) || Scenes.hasField(player)) return;
    Scenes.enterField(player, (location) => insideZone(location, STAR_PLANE_ZONE));
  }

  function handleGorakPlaneZoneEnter({ player }) {
    if (!questActive(player)) return;
    // 2331 goes to 1 on arrival (2094).
    if (quest.getStage(player) < STAGE_HANDED_OVER) return;
    setPlane(player, PLANE_GORAK);
    syncProgress(player);
  }

  function handleAdvanceTime(event) {
    const { player, ms } = event;
    if (!player || !Number.isFinite(ms) || ms <= 0) return;
    const at = Number(player.getAttribute(MARTIN_TALK_ATTRIBUTE));
    if (!Number.isFinite(at) || at <= 0) return;
    player.setAttribute(MARTIN_TALK_ATTRIBUTE, Math.max(1, at - ms));
    event.handledBy.push("FairytaleIICureAQueen");
  }

  function wakeQueen(player) {
    player.setAttribute(QUEEN_WOKE_ATTRIBUTE, 1);
    advance(player, STAGE_QUEEN_AWAKE);
  }

  /**
   * Saves from before the capture alignment finished the quest at 80; 80 is now the awake Queen
   * before her reward (2419-2532). Only an 80 the pour did not mark is an older completion.
   */
  function migrateLegacyCompletion(player) {
    if (quest.getStage(player) === STAGE_QUEEN_AWAKE && !flag(player, QUEEN_WOKE_ATTRIBUTE)) {
      quest.setStage(player, STAGE_COMPLETE);
    }
    // 75 lasts only the pour's four ticks; a save left there (cut short, or from before the
    // capture alignment, where 75 played the awakening) has used its dose, so the Queen is awake.
    if (quest.getStage(player) === STAGE_POTION_USED && !Scenes.isPouring(player)) wakeQueen(player);
  }

  function handleLogin({ player }) {
    migrateLegacyCompletion(player);
    refreshQuestList(player);
    syncProgress(player);
    if (insideZone(player.getLocation?.(), STAR_PLANE_ZONE)) enterStarPlane(player);
  }

  function handleBootstrap({ player }) {
    migrateLegacyCompletion(player);
    syncProgress(player);
  }

  function handleLogout({ player }) {
    Scenes.endAll(player, true);
    hideoutSequence.delete(player);
    waitForScroll.delete(player);
  }

  function handlePlayerDeath({ player }) {
    Scenes.endAll(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const potion = held(player, MAGIC_ESSENCE_UNF_ITEM_ID) || hasMagicEssence(player);
    return buildLines({
      stage: questHandle.getStage(player),
      signRead: flag(player, SIGN_ATTRIBUTE),
      flower: held(player, STAR_FLOWER_ITEM_ID) || potion,
      claw: held(player, GORAK_CLAWS_ITEM_ID) || held(player, GORAK_CLAW_POWDER_ITEM_ID) || hasMagicEssence(player),
    });
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, 3500);
    player.getSkillManager().addExperiences(Skill.THIEVING, 2500);
  }

  api.persistAttribute(CERT_TAKEN_ATTRIBUTE);
  api.persistAttribute(ROOM_PAN_ATTRIBUTE, false);
  api.persistAttribute(STUDIED_ATTRIBUTE);
  api.persistAttribute(DENIED_ATTRIBUTE);
  api.persistAttribute(PLANES_ATTRIBUTE);
  api.persistAttribute(CHEF_ATTRIBUTE);
  api.persistAttribute(SIGN_ATTRIBUTE);
  api.persistAttribute(MYSTERY_ATTRIBUTE);
  api.persistAttribute(GORAK_ATTRIBUTE);
  api.persistAttribute(MARTIN_TALK_ATTRIBUTE);
  api.persistAttribute(RECAP_DONE_ATTRIBUTE, 0);
  api.persistAttribute(REWARD_GIVEN_ATTRIBUTE, 0);
  api.persistAttribute(QUEEN_WOKE_ATTRIBUTE, 0);

  groundItems = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "fairytale_ii_cure_a_queen",
    name: "Fairytale II - Cure a Queen",
    varpId: VARP_FAIRYTALE,
    varbitId: VARBIT_QUEST,
    // Cache DB unstartedstate is inclusive: 0..10 precedes acceptance; the start hook sets 20.
    startedValue: STAGE_INVESTIGATING,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.HERBLORE.getIndex(), amount: 3500, label: "Herblore" },
      { skillId: Skill.THIEVING.getIndex(), amount: 2500, label: "Thieving" },
    ],
    rewardItemLabel: "Antique lamp",
    // The scroll's lines as live writes them (2535).
    rewardText: ["2 Quest Points", "3,500 Herblore XP", "2,500 Thieving XP", "Fairy Ring Access", "An Antique Lamp"],
    // The scroll's model is a four-dose magic essence (2535).
    scrollItemId: ESSENCE_DOSE_ITEM_IDS[0],
    otherRewards: ["Access to the fairy ring network", "Access to Fairy Fixit's Fairy Enchantment shop"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleActionEvent);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onCustomEvent("fairy-rings:access", answerFairyRingAccess);
  api.onCustomEvent("fairy-rings:destination", resolveFairyRingDestination);
  api.onCustomEvent("fairy-rings:travelled", recordFairyRingTravel);
  api.onCustomEvent("fairy-rings:invalid", recordFairyRingTravel);
  api.onObjectInteraction("Healing certificate", { Take: handleTakeCertificate });
  api.onObjectInteraction("Potion shelves", { Search: handleShelfSearch });
  api.onObjectInteraction("Potion shelf", { Search: handleShelfSearch });
  api.onObjectInteraction("Rune temple sign", { Read: handleReadSign });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handlePotionOnQueen, { noted: false });
  api.onItemAction("Nuff's certificate", { Read: handleReadCertificate, Study: handleStudyCertificate });
  api.onNpcInteraction("Fairy Godfather", { "Pick-pocket": handlePickpocket });
  api.onNpcInteraction(handleNuffTalk);
  api.onNpcInteraction(handleStarflowerPick);
  api.onNpcDeath(handleGorakDeath);
  class StarflowerPlaneArea extends api.core.Area {
    process(mobile) {
      if (!mobile.isPlayer()) return;
      enterStarPlane(mobile.getAsPlayer());
    }
  }
  api.registerArea(new StarflowerPlaneArea([
    new api.core.Boundary(
      STAR_PLANE_ZONE.minX,
      STAR_PLANE_ZONE.maxX,
      STAR_PLANE_ZONE.minY,
      STAR_PLANE_ZONE.maxY,
      STAR_PLANE_ZONE.levels[0],
    ),
  ]));
  api.onZoneEnter(NUFFS_ROOM, startRoomPan);
  api.onZoneEnter(GORAK_PLANE_ZONE, handleGorakPlaneZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("agent:advance-time", handleAdvanceTime);
};
