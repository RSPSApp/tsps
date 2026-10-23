/**
 * A Tail of Two Cats (members).
 *
 * The words come from the "A Tail of Two Cats" transcript page (OSRS Wiki); this
 * plugin supplies the variant selector for Unferth, Bob, Hild, Gertrude, Reldo, the
 * Sphinx, the Apothecary and the player's cat, the start hook, the prose-condition
 * answers, the catspeak-amulet enchant, the five Unferth chores (bed, fireplace,
 * table, shears/patch), the doctor/nurse disguise and cure, and the two cutscenes.
 *
 * Stage lives in varbit 1028 "twocats_quest" (varp 568, bits 0-6). Evidence:
 * `yarn dump:cs2 4024` maps quest DB row 142 ("quest_tailoftwocats" gameval; table-0
 * row "Tail of Two Cats, A", whose col 25 names Icthlarin's Little Helper's row 75)
 * to `get_varbit 1028`; the gameval dump names varbit 1028 `twocats_quest` on varp
 * 568. The quest DB row's completion stage (col 19) is 70, so completionValue 70.
 *
 * The chores use the quest's own sub-varbits of varp 568, because the cache's object
 * and NPC multi transforms read them: 1029 tidyhouse (0/1; bed multi 9438 -> 9437
 * "Make"/9436), 1030 warmhuman (1 logs, 2 lit; fireplace multi 9442 -> 9441/9439),
 * 1031 feedhuman (1 empty, 2 milk, 3 cake, 4 both; table multi 9435), 1032 tidyhuman
 * (8 sheared; Unferth multi 6202 -> 4237-4241), 1033 tidygarden (3 raked, 4 planted,
 * 8 grown; patch multi 9399 -> 9400-9408). QuestHelper's ATailOfTwoCats uses the same
 * completion values (madeBed 1, litLogs 2, placedCake 3, placedMilk 4, usedShears 8,
 * grownPotatoes 8).
 *
 * Stages: 1 started (Hild), 2 amulet enchanted (find Bob), 3 found Bob (ask Gertrude),
 * 4 asked Gertrude (ask Reldo), 5 asked Reldo (return to Bob), 6 told Bob (see the
 * Sphinx), 10 Sphinx cutscene done, chores list (Bob away), 20 chores done, 30 Unferth
 * ill, 40 Apothecary told (disguise), 50 Unferth cured, 60 Bob's holiday cutscene
 * (back in Burthorpe), 70 complete. The durable values are this plugin's and are
 * preserved for existing saves; `WIRE_STAGE` maps them to the Quest Helper keys
 * (0, 5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70) actually written to
 * varbit 1028. The cache pins the completion threshold (70, DB row 142 col 19).
 *
 * Rewards per the OSRS Wiki: 2 Quest points, a Doctor's hat or Nurse hat, and a
 * present containing two antique lamps (2,500 XP each in skills over 30) and a mouse
 * toy. 5 Kudos are not modelled (no museum Kudos tracking).
 *
 * Gaps / approximations:
 *  - Bob is a static npc-spawns.json spawn at Unferth's house (2924,3565) and cannot
 *    wander; the catspeak amulet(e) "Open" locate interface is not implemented, so the
 *    amulet only gates the cat-speech branches. Bob is hidden (varbit 6144) while he
 *    is away with Neite and shown again once Unferth is cured; Neite's world spawn
 *    (6201 -> 4236, varbit 6145) is revealed from then on.
 *  - The transcript has no text for "Skip cutscene and view summary." ({{tmissing}}),
 *    so that option plays the post-hypnosis tail of the cutscene; as the wiki says,
 *    the Burthorpe teleport option is dropped after a summary.
 *  - The player's cat only adds the chore-hint variants; outside stages 10/20 a cat
 *    keeps the pre-existing page fallback.
 *  - The Apothecary's Doctor/Nurse hat choice is two sibling conditions in the dump
 *    with no menu; the first request gives a Doctor's hat, and losing it and asking
 *    again alternates to the other hat (the wiki's switch-by-destroying).
 *  - The patch grows after 20 minutes (wiki: 15-35); MCP advance_time advances it.
 *    potatoes' "milk placed first" table state (feedhuman 2) has no wiki message.
 *  - Object prompts the transcript lacks (needing 4 seeds/a dibber, no logs in the
 *    fireplace, not holding a vial) use plain game messages.
 */
module.exports = function registerTailOfTwoCatsQuest(api) {
  const {
    Equipment,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } =
    require("../QuestRuntime");

  const PAGE = "A Tail of Two Cats";
  const START_HOOK = "quest:a-tail-of-two-cats:start";
  const PREREQUISITE_KEY = "ictlharins_little_helper";

  // Varbits (varp 568 "twocats_var"); see the header for the evidence.
  const VARBIT_TWOCATS_QUEST = 1028;
  const VARP_TWOCATS = 568;
  const VARBIT_CHORES_TIDYHOUSE = 1029;
  const VARBIT_CHORES_WARMHUMAN = 1030;
  const VARBIT_CHORES_FEEDHUMAN = 1031;
  const VARBIT_CHORES_TIDYHUMAN = 1032;
  const VARBIT_CHORES_TIDYGARDEN = 1033;
  const VARBIT_BOB_INVISIBLE = 6144; // varp 1687 bit 9
  const VARBIT_NIETE_VISIBLE = 6145; // varp 1687 bit 10

  const STAGE_STARTED = 1;
  const STAGE_AMULET_ENCHANTED = 2;
  const STAGE_FOUND_BOB = 3;
  const STAGE_ASKED_GERTRUDE = 4;
  const STAGE_ASKED_RELDO = 5;
  const STAGE_TOLD_BOB = 6;
  const STAGE_CHORES = 10;
  const STAGE_CHORES_DONE = 20;
  const STAGE_MEDICAL = 30;
  const STAGE_APOTHECARY = 40;
  const STAGE_CURED = 50;
  const STAGE_BOB_BACK = 60;
  const STAGE_COMPLETE = 70;

  // Durable stage -> Quest Helper/OSRS varbit 1028 value. The durable values stay
  // as they are so existing saves keep their meaning; only the transmitted wire
  // value uses the helper's stage keys.
  const WIRE_STAGE = new Map([
    [STAGE_STARTED, 5], // talkToHild
    [STAGE_AMULET_ENCHANTED, 15], // findBob/talkToBob
    [STAGE_FOUND_BOB, 20], // talkToGertrude
    [STAGE_ASKED_GERTRUDE, 25], // talkToReldo
    [STAGE_ASKED_RELDO, 30], // findBobAgain/talkToBobAgain
    [STAGE_TOLD_BOB, 35], // talkToSphinx
    [STAGE_CHORES, 40], // doChores
    [STAGE_CHORES_DONE, 45], // reportToUnferth
    [STAGE_MEDICAL, 50], // talkToApoth
    [STAGE_APOTHECARY, 55], // talkToUnferthAsDoctor
    [STAGE_CURED, 60], // findBobToFinish/talkToBobToFinish
    [STAGE_BOB_BACK, 65], // talkToUnferthToFinish
    [STAGE_COMPLETE, 70], // cache completion threshold
  ]);
  const wireStage = (stage) => WIRE_STAGE.get(stage) ?? stage;

  // ------------------------------------------------------------------ NPCs

  const UNFERTH_NPC_IDS = new Set([
    NpcIdentifiers.UNFERTH, // 4237 bald
    NpcIdentifiers.UNFERTH_2, // 4238 short hair
    NpcIdentifiers.UNFERTH_3, // 4239 medium hair
    NpcIdentifiers.UNFERTH_4, // 4240 spikey hair
    NpcIdentifiers.UNFERTH_5, // 4241 long hair
  ]);
  const UNFERTH_NPC_ID = NpcIdentifiers.UNFERTH; // 4237, the chathead for object variants
  const BOB_NPC_IDS = new Set([NpcIdentifiers.BOB]); // 8034, resolved from the static 4113
  const HILD_NPC_ID = NpcIdentifiers.HILD_2; // 4112
  const GERTRUDE_NPC_IDS = new Set([
    NpcIdentifiers.GERTRUDE, // 7284
    NpcIdentifiers.GERTRUDE_2, // 7723
  ]);
  const RELDO_NPC_IDS = new Set([
    NpcIdentifiers.RELDO, // 4242
    NpcIdentifiers.RELDO_2, // 4243
  ]);
  const SPHINX_NPC_IDS = new Set([
    NpcIdentifiers.SPHINX, // 2637
    NpcIdentifiers.SPHINX_2, // 4209
  ]);
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY; // 5036
  const CAT_FOLLOWER_NPC_IDS = new Set([
    NpcIdentifiers.CAT, // 1619
    NpcIdentifiers.CAT_2, // 1620
    NpcIdentifiers.CAT_3, // 1621
    NpcIdentifiers.CAT_4, // 1622
    NpcIdentifiers.CAT_5, // 1623
    NpcIdentifiers.CAT_6, // 1624
    NpcIdentifiers.KITTEN_2, // 5591
    NpcIdentifiers.KITTEN_3, // 5592
    NpcIdentifiers.KITTEN_4, // 5593
    NpcIdentifiers.KITTEN_5, // 5594
    NpcIdentifiers.KITTEN_6, // 5595
    NpcIdentifiers.KITTEN_7, // 5596
    NpcIdentifiers.HELL_KITTEN, // 5597
    NpcIdentifiers.OVERGROWN_CAT, // 5598
    NpcIdentifiers.OVERGROWN_CAT_2, // 5599
    NpcIdentifiers.OVERGROWN_CAT_3, // 5600
    NpcIdentifiers.OVERGROWN_CAT_4, // 5601
    NpcIdentifiers.OVERGROWN_CAT_5, // 5602
    NpcIdentifiers.OVERGROWN_CAT_6, // 5603
    NpcIdentifiers.OVERGROWN_HELLCAT, // 5604
    NpcIdentifiers.HELLCAT, // 1625
  ]);
  const QUEST_NPC_IDS = new Set([
    ...UNFERTH_NPC_IDS,
    ...BOB_NPC_IDS,
    ...GERTRUDE_NPC_IDS,
    ...RELDO_NPC_IDS,
    ...SPHINX_NPC_IDS,
    ...CAT_FOLLOWER_NPC_IDS,
    HILD_NPC_ID,
    APOTHECARY_NPC_ID,
  ]);

  // ------------------------------------------------------------------ items

  const CATSPEAK_AMULET_ITEM_IDS = new Set([
    ItemIdentifiers.CATSPEAK_AMULET, // 4677
    ItemIdentifiers.CATSPEAK_AMULET_E_, // 6544
  ]);
  const CATSPEAK_AMULET_ITEM_ID = ItemIdentifiers.CATSPEAK_AMULET;
  const CATSPEAK_AMULET_E_ITEM_ID = ItemIdentifiers.CATSPEAK_AMULET_E_;
  const CAT_ITEM_IDS = [
    ItemIdentifiers.PET_KITTEN, // 1555
    ItemIdentifiers.PET_KITTEN_2, // 1556
    ItemIdentifiers.PET_KITTEN_3, // 1557
    ItemIdentifiers.PET_KITTEN_4, // 1558
    ItemIdentifiers.PET_KITTEN_5, // 1559
    ItemIdentifiers.PET_KITTEN_6, // 1560
    ItemIdentifiers.PET_CAT, // 1561
    ItemIdentifiers.PET_CAT_2, // 1562
    ItemIdentifiers.PET_CAT_3, // 1563
    ItemIdentifiers.PET_CAT_4, // 1564
    ItemIdentifiers.PET_CAT_5, // 1565
    ItemIdentifiers.PET_CAT_6, // 1566
    ItemIdentifiers.PET_CAT_7, // 1567
    ItemIdentifiers.PET_CAT_8, // 1568
    ItemIdentifiers.PET_CAT_9, // 1569
    ItemIdentifiers.PET_CAT_10, // 1570
    ItemIdentifiers.PET_CAT_11, // 1571
    ItemIdentifiers.PET_CAT_12, // 1572
    ItemIdentifiers.OVERGROWN_HELLCAT, // 7581
    ItemIdentifiers.HELL_CAT, // 7582
    ItemIdentifiers.HELL_KITTEN, // 7583
  ];
  const DEATH_RUNE_ITEM_ID = ItemIdentifiers.DEATH_RUNE; // 560
  const CHOCOLATE_CAKE_ITEM_IDS = new Set([
    ItemIdentifiers.CHOCOLATE_CAKE, // 1897
    ItemIdentifiers.CHOCOLATE_CAKE_2, // 1898
  ]);
  const BUCKET_OF_MILK_ITEM_IDS = new Set([
    ItemIdentifiers.BUCKET_OF_MILK, // 1927
    ItemIdentifiers.BUCKET_OF_MILK_2, // 1928
  ]);
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX;
  const SHEARS_ITEM_IDS = new Set([
    ItemIdentifiers.SHEARS, // 1735
    ItemIdentifiers.SHEARS_2, // 1736
    ItemIdentifiers.SHEARS_3, // 5603
  ]);
  const RAKE_ITEM_IDS = new Set([
    ItemIdentifiers.RAKE, // 5341
    ItemIdentifiers.RAKE_2, // 5342
  ]);
  const SEED_DIBBER_ITEM_IDS = new Set([
    ItemIdentifiers.SEED_DIBBER, // 5343
    ItemIdentifiers.SEED_DIBBER_2, // 5344
  ]);
  const POTATO_SEED_ITEM_ID = ItemIdentifiers.POTATO_SEED; // 5318
  const VIAL_OF_WATER_ITEM_IDS = new Set([
    ItemIdentifiers.VIAL_OF_WATER, // 227
    ItemIdentifiers.VIAL_OF_WATER_2, // 228
  ]);
  const ROBE_TOP_ITEM_IDS = new Set([
    ItemIdentifiers.DESERT_SHIRT, // 1833
    ItemIdentifiers.DESERT_SHIRT_2, // 1834
    ItemIdentifiers.DRUIDS_ROBE_TOP, // 540
    ItemIdentifiers.DRUIDS_ROBE_TOP_2, // 541
  ]);
  const ROBE_BOTTOM_ITEM_IDS = new Set([
    ItemIdentifiers.DESERT_ROBE, // 1835
    ItemIdentifiers.DESERT_ROBE_2, // 1836
    ItemIdentifiers.DRUIDS_ROBE, // 538
    ItemIdentifiers.DRUIDS_ROBE_2, // 539
  ]);
  const DOCTORS_HAT_ITEM_ID = ItemIdentifiers.DOCTORS_HAT; // 6547
  const NURSE_HAT_ITEM_ID = ItemIdentifiers.NURSE_HAT; // 6548
  const RECIPE_ITEM_ID = ItemIdentifiers.RECIPE; // 6546
  const CHORES_ITEM_ID = ItemIdentifiers.CHORES; // 6545
  const PRESENT_ITEM_ID = ItemIdentifiers.PRESENT; // 6542
  const MOUSE_TOY_ITEM_ID = ItemIdentifiers.MOUSE_TOY; // 6541
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_2; // 6543
  const LAMP_EXPERIENCE = 2500;

  // ------------------------------------------------------------------ objects

  const PATCH_OBJECT_ID = 9399; // twocats_patch multi, Unferth's patch
  const TABLE_OBJECT_ID = 9435; // twocats_table multi
  const BED_OBJECT_ID = 9438; // twocats_bed multi
  const FIREPLACE_OBJECT_ID = 9442; // twocats_fireplace multi
  const BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_38; // 9443

  // ------------------------------------------------------------------ state

  const FLAGS_ATTRIBUTE = "quest.a_tail_of_two_cats.flags";
  const CHORES_ATTRIBUTE = "quest.a_tail_of_two_cats.chores";
  const HAT_ATTRIBUTE = "quest.a_tail_of_two_cats.hat";
  const PATCH_ATTRIBUTE = "quest.a_tail_of_two_cats.patch";

  const BIT_HILD_MET = 1 << 0;

  const HAT_DOCTOR = 0;
  const HAT_NURSE = 1;

  const TIDY_HOUSE_BITS = { shift: 0, mask: 0x1 };
  const WARM_HUMAN_BITS = { shift: 1, mask: 0x3 };
  const FEED_HUMAN_BITS = { shift: 3, mask: 0x7 };
  const TIDY_HUMAN_BITS = { shift: 6, mask: 0xf };
  const TIDY_GARDEN_BITS = { shift: 10, mask: 0xf };

  const PATCH_GROWTH_MS = 20 * 60 * 1000; // wiki: 15-35 minutes

  /** The tile just outside Unferth's house, used by the Sphinx teleport. */
  const BURTHORPE_TELEPORT = new Location(2923, 3563, 0);

  const CLEAN_MESSAGES = new Map([
    ["54NMoa", "You have found a recipe but do not have the space in your inventory for it."],
    ["rvvb71", "You find nothing of interest."],
    ["3GqgYz", "The table is bare."],
    ["dyw-c-", "The table has an empty cake stand and empty milk glass on it."],
    ["vXAoOg", "The table has a chocolate cake and empty milk glass on it."],
    ["eIUeQY", "The table has a chocolate cake and full milk glass on it."],
  ]);

  /** Cutscene stage directions that have no executable contract. */
  const CUTSCENE_ACTION_IDS = new Set([
    "oM_XLm", "sFWpWr", "rTsL08", "QPBp_6", "ldKrip", "w3r0oK",
    "qbg5Z1", "0yQwFB", "v9fKhL", "bYn47U", "8Y-TyB",
  ]);

  let quest;
  let transcriptData = null;
  const lampPending = new WeakMap();

  // ------------------------------------------------------------------ helpers

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function giveItem(player, itemId) {
    if (player.getInventory().getFreeSlots() <= 0) return false;
    player.getInventory().adds(itemId, 1);
    return true;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    const stage = Number(player.getAttribute(`quest.${key}.stage`));
    return Number.isFinite(stage) && stage >= 2;
  }

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, flag) {
    return (flags(player) & flag) !== 0;
  }

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag);
  }

  function chores(player) {
    return Number(player.getAttribute(CHORES_ATTRIBUTE)) || 0;
  }

  function choreValue(player, bits) {
    return (chores(player) >>> bits.shift) & bits.mask;
  }

  function setChore(player, varbitId, bits, value) {
    const packed = (chores(player) & ~(bits.mask << bits.shift)) | ((value & bits.mask) << bits.shift);
    player.setAttribute(CHORES_ATTRIBUTE, packed);
    player.getPacketSender().sendVarbit(varbitId, value & bits.mask);
  }

  const tidyHouse = (player) => choreValue(player, TIDY_HOUSE_BITS);
  const warmHuman = (player) => choreValue(player, WARM_HUMAN_BITS);
  const feedHuman = (player) => choreValue(player, FEED_HUMAN_BITS);
  const tidyHuman = (player) => choreValue(player, TIDY_HUMAN_BITS);
  const tidyGarden = (player) => choreValue(player, TIDY_GARDEN_BITS);
  const setTidyHouse = (player, value) => setChore(player, VARBIT_CHORES_TIDYHOUSE, TIDY_HOUSE_BITS, value);
  const setWarmHuman = (player, value) => setChore(player, VARBIT_CHORES_WARMHUMAN, WARM_HUMAN_BITS, value);
  const setFeedHuman = (player, value) => setChore(player, VARBIT_CHORES_FEEDHUMAN, FEED_HUMAN_BITS, value);
  const setTidyHuman = (player, value) => setChore(player, VARBIT_CHORES_TIDYHUMAN, TIDY_HUMAN_BITS, value);
  const setTidyGarden = (player, value) => setChore(player, VARBIT_CHORES_TIDYGARDEN, TIDY_GARDEN_BITS, value);

  function hatType(player) {
    return Number(player.getAttribute(HAT_ATTRIBUTE)) === HAT_NURSE ? HAT_NURSE : HAT_DOCTOR;
  }

  function catFollower(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc && npc.getOwner?.() === player && CAT_FOLLOWER_NPC_IDS.has(npc.getId())) return npc;
    }
    return null;
  }

  const hasCatFollower = (player) => catFollower(player) !== null;

  function ownsCat(player) {
    if (hasCatFollower(player)) return true;
    return CAT_ITEM_IDS.some((itemId) => held(player, itemId));
  }

  function wearingCatspeak(player) {
    const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
    return CATSPEAK_AMULET_ITEM_IDS.has(amulet?.getId?.());
  }

  function hasCatspeakAmulet(player) {
    if (held(player, CATSPEAK_AMULET_ITEM_ID)) return true;
    const amulet = player.getEquipment().get(Equipment.AMULET_SLOT);
    return amulet?.getId?.() === CATSPEAK_AMULET_ITEM_ID;
  }

  function hasHat(player) {
    const head = player.getEquipment().get(Equipment.HEAD_SLOT);
    const headId = head?.getId?.() ?? -1;
    if (headId === DOCTORS_HAT_ITEM_ID || headId === NURSE_HAT_ITEM_ID) return true;
    return held(player, DOCTORS_HAT_ITEM_ID) || held(player, NURSE_HAT_ITEM_ID);
  }

  function canCure(player) {
    const equipment = player.getEquipment();
    const head = equipment.get(Equipment.HEAD_SLOT)?.getId?.() ?? -1;
    const body = equipment.get(Equipment.BODY_SLOT)?.getId?.() ?? -1;
    const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.() ?? -1;
    const weapon = equipment.get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
    const shield = equipment.get(Equipment.SHIELD_SLOT)?.getId?.() ?? -1;
    const hasVial = [...VIAL_OF_WATER_ITEM_IDS].some((itemId) => held(player, itemId));
    return (
      (head === DOCTORS_HAT_ITEM_ID || head === NURSE_HAT_ITEM_ID) &&
      ROBE_TOP_ITEM_IDS.has(body) &&
      ROBE_BOTTOM_ITEM_IDS.has(legs) &&
      weapon <= 0 &&
      shield <= 0 &&
      hasVial
    );
  }

  function isLogItem(itemId) {
    const name = ItemDefinition.forId(itemId)?.getName?.() ?? "";
    return /logs$/i.test(name);
  }

  function choresDone(player) {
    return (
      tidyHouse(player) === 1 &&
      warmHuman(player) === 2 &&
      feedHuman(player) === 4 &&
      tidyHuman(player) === 8 &&
      tidyGarden(player) === 8
    );
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_CHORES_TIDYHOUSE, tidyHouse(player));
    sender.sendVarbit(VARBIT_CHORES_WARMHUMAN, warmHuman(player));
    sender.sendVarbit(VARBIT_CHORES_FEEDHUMAN, feedHuman(player));
    sender.sendVarbit(VARBIT_CHORES_TIDYHUMAN, tidyHuman(player));
    sender.sendVarbit(VARBIT_CHORES_TIDYGARDEN, tidyGarden(player));
    const stage = quest.getStage(player);
    sender.sendVarbit(VARBIT_BOB_INVISIBLE, stage >= STAGE_CHORES && stage < STAGE_CURED ? 1 : 0);
    sender.sendVarbit(VARBIT_NIETE_VISIBLE, stage >= STAGE_CURED ? 1 : 0);
  }

  function transcripts() {
    if (!transcriptData) transcriptData = loadTranscripts(api);
    return transcriptData;
  }

  function variantSteps(name) {
    const steps = transcripts()?.[PAGE]?.variants?.[name];
    return Array.isArray(steps) ? steps : [];
  }

  function finishChore(player) {
    if (quest.getStage(player) !== STAGE_CHORES || !choresDone(player)) return;
    quest.setStage(player, STAGE_CHORES_DONE);
    const cat = catFollower(player);
    if (cat) {
      startTranscript(api, player, cat.getContentId(player), PAGE, "unferth-s-chores-after-finishing-the-chores");
    } else {
      player.sendMessage("Well done, that's all the chores finished!");
      player.sendMessage("Let's talk to Unferth to see if there's anything else we can do.");
    }
  }

  function growPotatoes(player) {
    if (quest.getStage(player) !== STAGE_CHORES || tidyGarden(player) >= 8) return false;
    setTidyGarden(player, 8);
    player.setAttribute(PATCH_ATTRIBUTE, 0);
    return true;
  }

  function finishPotatoes(player) {
    if (!growPotatoes(player)) return;
    if (choresDone(player)) {
      // The cat's "all the chores finished" transcript carries the news.
      finishChore(player);
      return;
    }
    startTranscript(api, player, UNFERTH_NPC_ID, PAGE, "unferth-s-chores-tending-the-garden");
  }

  function refreshPatch(player) {
    const growAt = Number(player.getAttribute(PATCH_ATTRIBUTE)) || 0;
    if (growAt > 0 && Date.now() >= growAt) finishPotatoes(player);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectUnferthVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null; // Unferth's own post-quest page
    if (stage >= STAGE_BOB_BACK) return "back-to-bob-returning-to-unferth";
    if (stage >= STAGE_CURED) return "medical-emergency-talking-to-unferth-after-curing-him";
    if (stage >= STAGE_APOTHECARY) return "medical-emergency-returning-to-unferth";
    if (stage >= STAGE_MEDICAL) return "medical-emergency-talking-to-unferth-again";
    if (stage >= STAGE_CHORES_DONE) {
      quest.setStage(player, STAGE_MEDICAL);
      return "medical-emergency";
    }
    if (stage >= STAGE_CHORES) return "unferth-s-chores";
    if (stage >= STAGE_AMULET_ENCHANTED) return "returning-to-bob-talking-to-unferth";
    if (stage >= STAGE_STARTED) return "starting-out-talking-to-unferth-again";
    return "starting-out";
  }

  function selectBobVariant(player, stage) {
    if (stage === STAGE_AMULET_ENCHANTED) {
      quest.setStage(player, STAGE_FOUND_BOB);
      return "finding-bob";
    }
    if (stage === STAGE_FOUND_BOB || stage === STAGE_ASKED_GERTRUDE) {
      return "finding-bob-talking-to-bob-again";
    }
    if (stage === STAGE_ASKED_RELDO) {
      quest.setStage(player, STAGE_TOLD_BOB);
      return "returning-to-bob";
    }
    if (stage === STAGE_TOLD_BOB) return "returning-to-bob-talking-to-bob-again";
    if (stage === STAGE_CURED) return "back-to-bob";
    return null; // Bob's own page before the quest and after it
  }

  function selectCatVariant(player, stage) {
    if (stage === STAGE_CHORES) return "unferth-s-chores-talking-to-your-cat-about-chores";
    if (stage === STAGE_CHORES_DONE) return "unferth-s-chores-talking-to-your-cat-after-finishing-the-chores";
    return null;
  }

  function selectHildVariant(player, stage) {
    if (stage !== STAGE_STARTED) return null; // Hild's own page after the enchantment
    if (hasFlag(player, BIT_HILD_MET)) {
      return "starting-out-talking-to-hild-again-before-enchanting-the-amulet";
    }
    setFlag(player, BIT_HILD_MET);
    return "starting-out-talking-to-hild";
  }

  function selectReldoVariant(player, stage) {
    if (stage === STAGE_ASKED_GERTRUDE) return "finding-bob-talking-to-reldo";
    if (stage === STAGE_ASKED_RELDO) return "finding-bob-talking-to-reldo-again";
    return null;
  }

  function selectSphinxVariant(player, stage) {
    if (stage === STAGE_CHORES) return "returning-to-bob-talking-to-the-sphinx-again";
    return null;
  }

  function selectApothecaryVariant(player, stage) {
    if (stage === STAGE_MEDICAL) return "medical-emergency-talking-to-the-apothecary";
    if (stage >= STAGE_APOTHECARY && stage < STAGE_COMPLETE) {
      return "medical-emergency-talking-to-the-apothecary-again";
    }
    return null; // his own standard page after the quest
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (UNFERTH_NPC_IDS.has(npcId)) return selectUnferthVariant(player, stage);
    if (BOB_NPC_IDS.has(npcId)) return selectBobVariant(player, stage);
    if (CAT_FOLLOWER_NPC_IDS.has(npcId)) return selectCatVariant(player, stage);
    if (HILD_NPC_ID === npcId) return selectHildVariant(player, stage);
    if (RELDO_NPC_IDS.has(npcId)) return selectReldoVariant(player, stage);
    if (SPHINX_NPC_IDS.has(npcId)) return selectSphinxVariant(player, stage);
    if (APOTHECARY_NPC_ID === npcId) return selectApothecaryVariant(player, stage);
    // Gertrude is claimed in her own Talk-to handler (Gertrude's Cat always
    // answers the variant hook for her, complete or not).
    return null;
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId, text }) {
    if (!QUEST_NPC_IDS.has(npcId)) return null;
    // The Sphinx replaces a lost catspeak amulet for a player with a cat. This
    // condition belongs to her post-Icthlarin dialogue, not A Tail of Two Cats'
    // own quest-stage variants, so answer it here for completed-prerequisite
    // players as well as active DS2 players.
    if (SPHINX_NPC_IDS.has(npcId) && /lost the amulet of catspeak/i.test(String(text ?? ""))) {
      const hasAnyCatspeak = held(player, CATSPEAK_AMULET_ITEM_ID)
        || held(player, CATSPEAK_AMULET_E_ITEM_ID)
        || wearingCatspeak(player);
      return isQuestComplete(player, PREREQUISITE_KEY) && hasCatFollower(player) && !hasAnyCatspeak;
    }
    if (SPHINX_NPC_IDS.has(npcId) && /catspeak amulet is not worn/i.test(String(text ?? ""))) {
      return !wearingCatspeak(player);
    }
    if (SPHINX_NPC_IDS.has(npcId) && /catspeak amulet is worn/i.test(String(text ?? ""))) {
      return wearingCatspeak(player);
    }
    switch (stepId) {
      // Requirements, cat and catspeak amulet.
      case "pZkgC1":
        return !isQuestComplete(player, PREREQUISITE_KEY);
      case "1FzJGG":
        return !ownsCat(player);
      case "iSyLD_":
        return ownsCat(player) && !hasCatFollower(player);
      case "rTGaaG":
        return hasCatFollower(player);
      case "eCOJsV":
      case "a0xGzc":
      case "KTrsmr":
      case "FI_EF6":
      case "3O6jMh":
      case "g3oo3a":
      case "Pxl8kI":
        return !wearingCatspeak(player);
      case "r6MLd6":
      case "9UWr3v":
      case "HJ1dcX":
      case "OF_n39":
      case "hauDHC":
      case "5k3DLO":
      case "qRIP23":
      case "Nblcpl":
      case "Bl6-CX":
        return wearingCatspeak(player);
      // Hild's enchantment.
      case "jJvdhF":
      case "lFgOmg":
        return !held(player, DEATH_RUNE_ITEM_ID, 5);
      case "z6MmKU":
        // The dump's "with runes" branch is a lost "below" jump; the hand-in is
        // the again-before-enchanting variant's dGGdBa branch.
        return false;
      case "dGGdBa":
        return held(player, DEATH_RUNE_ITEM_ID, 5) && hasCatspeakAmulet(player);
      // Chore hints from the player's cat.
      case "jTyME6":
        return tidyHouse(player) === 0;
      case "Sv7Ppp":
        return tidyHouse(player) === 1;
      case "vTkT3S":
        return warmHuman(player) < 2;
      case "kuYsv_":
        return warmHuman(player) === 2;
      case "IOpYt3":
        return feedHuman(player) < 4;
      case "fMIuT7":
        return feedHuman(player) === 4;
      case "uNwQjO":
        return tidyHuman(player) < 8;
      case "7fh1wM":
        return tidyHuman(player) === 8;
      case "o5X9o-":
        return tidyGarden(player) < 3;
      case "zb5Jl9":
        return tidyGarden(player) >= 3 && tidyGarden(player) < 8;
      case "5Kme2w":
        return tidyGarden(player) === 8;
      // The bed and patch object variants only start when their condition holds.
      case "J-EJxI":
        return true;
      case "VnYEs9":
        return tidyGarden(player) === 8;
      // Bookshelf recipe.
      case "28so23":
        return !held(player, RECIPE_ITEM_ID) && !player.getInventory().isFull();
      case "tXALht":
        return !held(player, RECIPE_ITEM_ID) && player.getInventory().isFull();
      case "QNUt0l":
        return held(player, RECIPE_ITEM_ID);
      // Table inspection.
      case "EVHMj3":
        return quest.getStage(player) < STAGE_CHORES;
      case "FxZYRO":
        return quest.getStage(player) >= STAGE_CHORES && feedHuman(player) <= 1;
      case "2ClYvM":
        return feedHuman(player) === 3;
      case "9WfTK9":
        return feedHuman(player) === 4;
      // Apothecary hats. The first request gives a Doctor's hat; the lost-hat
      // variant hands out whichever hat was not given last, so it alternates.
      case "jZyrKO":
        return hatType(player) !== HAT_NURSE;
      case "FgxNOb":
        return hatType(player) === HAT_NURSE;
      case "M253qm":
        return hatType(player) === HAT_NURSE;
      case "Tdu3b3":
        return quest.getStage(player) >= STAGE_APOTHECARY && !hasHat(player);
      case "qTxDW1":
        return hatType(player) !== HAT_NURSE;
      // Doctor's call.
      case "y21iOQ":
        return !canCure(player);
      case "De2r23":
        return canCure(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue hooks / choices / actions
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !UNFERTH_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    const stage = quest.getStage(player);
    const text = String(option ?? "");
    if (GERTRUDE_NPC_IDS.has(npcId) && text === "Ask about Bob's parents." && stage === STAGE_FOUND_BOB) {
      quest.setStage(player, STAGE_ASKED_GERTRUDE);
      return;
    }
    if (RELDO_NPC_IDS.has(npcId) && text === "I have a cat related question." && stage === STAGE_ASKED_GERTRUDE) {
      quest.setStage(player, STAGE_ASKED_RELDO);
    }
  }

  function consumeAmuletOffer(player) {
    if (held(player, DEATH_RUNE_ITEM_ID, 5)) {
      player.getInventory().deleteNumber(DEATH_RUNE_ITEM_ID, 5);
    }
    if (held(player, CATSPEAK_AMULET_ITEM_ID)) {
      player.getInventory().deleteNumber(CATSPEAK_AMULET_ITEM_ID, 1);
    } else {
      player.getEquipment().deleteNumber(CATSPEAK_AMULET_ITEM_ID, 1);
    }
  }

  function grantEnchantedAmulet(player) {
    if (!held(player, CATSPEAK_AMULET_E_ITEM_ID)) giveItem(player, CATSPEAK_AMULET_E_ITEM_ID);
    if (quest.getStage(player) < STAGE_AMULET_ENCHANTED) {
      quest.setStage(player, STAGE_AMULET_ENCHANTED);
    }
  }

  function startChores(player) {
    giveItem(player, CHORES_ITEM_ID);
    if (feedHuman(player) < 1) setFeedHuman(player, 1);
    if (tidyHuman(player) < 4) setTidyHuman(player, 4);
    if (quest.getStage(player) < STAGE_CHORES) quest.setStage(player, STAGE_CHORES);
    syncVarbits(player);
  }

  function giveHat(player, type) {
    player.setAttribute(HAT_ATTRIBUTE, type);
    const itemId = type === HAT_NURSE ? NURSE_HAT_ITEM_ID : DOCTORS_HAT_ITEM_ID;
    if (!held(player, itemId)) giveItem(player, itemId);
    if (quest.getStage(player) < STAGE_APOTHECARY) {
      quest.setStage(player, STAGE_APOTHECARY);
    }
  }

  function cureUnferth(player) {
    for (const itemId of VIAL_OF_WATER_ITEM_IDS) {
      if (held(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        break;
      }
    }
    if (quest.getStage(player) < STAGE_CURED) quest.setStage(player, STAGE_CURED);
    syncVarbits(player);
  }

  function handleMessage(event) {
    const { player, stepId, text } = event;
    const clean = CLEAN_MESSAGES.get(stepId);
    if (clean !== undefined) {
      event.handled = true;
      player.sendMessage(clean);
    }
    switch (stepId) {
      case "vA_xBM":
        // Canonical Sphinx transcript action: "The Sphinx hands you an amulet
        // of catspeak." Keep the normal item recoverable after the prerequisite
        // quest has been completed; never mint it from the DS2 quest handler.
        event.handled = true;
        if (giveItem(player, CATSPEAK_AMULET_ITEM_ID)) {
          player.sendMessage(String(text ?? "The Sphinx hands you an amulet of catspeak."));
        } else {
          player.sendMessage("You need an open inventory slot before the Sphinx can give you an amulet.");
        }
        return;
      case "4OiD70":
        consumeAmuletOffer(player);
        return;
      case "XfUKZ6":
        grantEnchantedAmulet(player);
        return;
      case "5-sEgA":
      case "_Fpj9r":
        startChores(player);
        return;
      case "oU28T9":
        giveItem(player, RECIPE_ITEM_ID);
        return;
      case "nlTu2_":
      case "Va-d-n":
        giveHat(player, HAT_DOCTOR);
        return;
      case "hPJgTu":
      case "UUtW8M":
        giveHat(player, HAT_NURSE);
        return;
      case "Ijadj5":
        cureUnferth(player);
        return;
      default:
        return;
    }
  }

  function handleAction(event) {
    const { player, stepId, kind, text } = event;
    if (kind === "message") {
      handleMessage(event);
      return;
    }
    if (stepId === "OxgFrB") {
      event.handled = true;
      player.moveTo(new Location(BURTHORPE_TELEPORT.getX(), BURTHORPE_TELEPORT.getY(), BURTHORPE_TELEPORT.getZ()));
      return;
    }
    if (stepId === "EmFpdJ") {
      event.handled = true;
      player.sendMessage(String(text ?? ""));
      player.moveTo(new Location(BURTHORPE_TELEPORT.getX(), BURTHORPE_TELEPORT.getY(), BURTHORPE_TELEPORT.getZ()));
      if (quest.getStage(player) < STAGE_BOB_BACK) {
        quest.setStage(player, STAGE_BOB_BACK);
        syncVarbits(player);
      }
      return;
    }
    if (stepId === "-5euge") {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (CUTSCENE_ACTION_IDS.has(stepId)) {
      event.handled = true;
      player.sendMessage(String(text ?? ""));
    }
  }

  // ==========================================================================
  // The Sphinx's cutscene/summary options
  // ==========================================================================

  function summarySteps(cutscene) {
    const start = cutscene.findIndex(
      (step) => typeof step.text === "string" && step.text.includes("no longer under my influence")
    );
    const clone = JSON.parse(JSON.stringify(start === -1 ? cutscene : cutscene.slice(start)));
    const stripTeleport = (list) => {
      for (const step of list) {
        if (Array.isArray(step.options)) {
          step.options = step.options.filter((option) => !/^yes, teleport/i.test(String(option.text ?? "")));
        }
        if (Array.isArray(step.steps)) stripTeleport(step.steps);
        for (const option of step.options ?? []) {
          if (Array.isArray(option.steps)) stripTeleport(option.steps);
        }
      }
    };
    stripTeleport(clone);
    return clone;
  }

  /**
   * The dump's "View the cutscene" option is only a lost "below" jump and the
   * summary is {{tmissing}}, so splice the cutscene variant in for the former and
   * its post-hypnosis tail (without the teleport) for the latter.
   */
  function selectSphinxOptions(steps) {
    const clone = JSON.parse(JSON.stringify(steps));
    const cutscene = variantSteps("returning-to-bob-cutscene");
    const summary = summarySteps(cutscene);
    const apply = (list) => {
      for (const step of list) {
        for (const option of step.options ?? []) {
          const text = String(option.text ?? "");
          if (/^view the cutscene/i.test(text)) option.steps = JSON.parse(JSON.stringify(cutscene));
          else if (/^skip cutscene/i.test(text)) option.steps = JSON.parse(JSON.stringify(summary));
          if (Array.isArray(option.steps)) apply(option.steps);
        }
        if (Array.isArray(step.steps)) apply(step.steps);
      }
    };
    apply(clone);
    return clone;
  }

  // ==========================================================================
  // Talk-to interceptions (NPCs another plugin or the page fallback claims)
  // ==========================================================================

  function talkToGertrude(event) {
    const { player } = event;
    if (!GERTRUDE_NPC_IDS.has(event.npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_FOUND_BOB) {
      event.handled = true;
      startTranscript(api, player, event.npcId, PAGE, "finding-bob-talking-to-gertrude");
      return true;
    }
    if (stage === STAGE_ASKED_GERTRUDE) {
      event.handled = true;
      startTranscript(api, player, event.npcId, PAGE, "finding-bob-talking-to-gertrude-again");
      return true;
    }
    return false;
  }

  function talkToSphinx(event) {
    const { player } = event;
    if (!SPHINX_NPC_IDS.has(event.npcId)) return false;
    if (quest.getStage(player) !== STAGE_TOLD_BOB) return false;
    event.handled = true;
    startTranscript(api, player, event.npcId, PAGE, "returning-to-bob-talking-to-the-sphinx", selectSphinxOptions);
    return true;
  }

  function selectLostHat(steps) {
    for (const step of steps ?? []) {
      if (step.type === "condition" && step.id === "Tdu3b3") return step.steps ?? [];
    }
    return steps;
  }

  function talkToApothecary(event) {
    const { player } = event;
    if (event.npcId !== APOTHECARY_NPC_ID) return false;
    if (quest.getStage(player) < STAGE_APOTHECARY) return false;
    if (hasHat(player)) return false;
    event.handled = true;
    startTranscript(
      api,
      player,
      APOTHECARY_NPC_ID,
      PAGE,
      "medical-emergency-talking-to-the-apothecary-again",
      selectLostHat
    );
    return true;
  }

  // ==========================================================================
  // Objects and items
  // ==========================================================================

  function makeBed(event, player) {
    event.handled = true;
    refreshPatch(player);
    if (quest.getStage(player) < STAGE_CHORES) {
      startTranscript(api, player, UNFERTH_NPC_ID, PAGE, "unferth-s-chores-tidying-the-house");
      return;
    }
    if (tidyHouse(player) === 1) return;
    setTidyHouse(player, 1);
    finishChore(player);
  }

  function inspectTable(event, player) {
    event.handled = true;
    startTranscript(api, player, UNFERTH_NPC_ID, PAGE, "unferth-s-chores-feeding-the-human-table");
  }

  function searchBookcase(event, player) {
    event.handled = true;
    startTranscript(api, player, UNFERTH_NPC_ID, PAGE, "unferth-s-chores-feeding-the-human-bookshelf");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === BED_OBJECT_ID) {
      makeBed(event, player);
      return;
    }
    if (objectId === TABLE_OBJECT_ID) {
      inspectTable(event, player);
      return;
    }
    if (objectId === BOOKCASE_OBJECT_ID) {
      searchBookcase(event, player);
    }
  }

  function useOnPatch(event, player, itemId) {
    refreshPatch(player);
    if (quest.getStage(player) !== STAGE_CHORES) return;
    if (RAKE_ITEM_IDS.has(itemId)) {
      event.handled = true;
      if (tidyGarden(player) < 3) setTidyGarden(player, 3);
      return;
    }
    if (itemId !== POTATO_SEED_ITEM_ID) return;
    event.handled = true;
    if (tidyGarden(player) !== 3) return;
    if (![...SEED_DIBBER_ITEM_IDS].some((id) => held(player, id))) {
      player.sendMessage("You need a seed dibber to plant the seeds.");
      return;
    }
    if (!held(player, POTATO_SEED_ITEM_ID, 4)) {
      player.sendMessage("You need four potato seeds to plant in this patch.");
      return;
    }
    player.getInventory().deleteNumber(POTATO_SEED_ITEM_ID, 4);
    setTidyGarden(player, 4);
    player.setAttribute(PATCH_ATTRIBUTE, Date.now() + PATCH_GROWTH_MS);
  }

  function useOnFireplace(event, player, itemId) {
    if (quest.getStage(player) !== STAGE_CHORES) return;
    if (itemId === TINDERBOX_ITEM_ID) {
      event.handled = true;
      if (warmHuman(player) === 1) {
        setWarmHuman(player, 2);
        finishChore(player);
      } else if (warmHuman(player) === 0) {
        player.sendMessage("You'll need to put some logs in the fireplace first.");
      }
      return;
    }
    if (!isLogItem(itemId)) return;
    event.handled = true;
    if (warmHuman(player) !== 0) return;
    player.getInventory().deleteNumber(itemId, 1);
    setWarmHuman(player, 1);
  }

  function useOnTable(event, player, itemId) {
    const cake = CHOCOLATE_CAKE_ITEM_IDS.has(itemId);
    const milk = BUCKET_OF_MILK_ITEM_IDS.has(itemId);
    if (!cake && !milk) return;
    if (quest.getStage(player) !== STAGE_CHORES) return;
    event.handled = true;
    if (cake) {
      if (feedHuman(player) >= 3) return;
      player.getInventory().deleteNumber(itemId, 1);
      setFeedHuman(player, feedHuman(player) === 2 ? 4 : 3);
      finishChore(player);
      return;
    }
    if (feedHuman(player) === 2 || feedHuman(player) === 4 || feedHuman(player) === 0) return;
    player.getInventory().deleteNumber(itemId, 1);
    setFeedHuman(player, feedHuman(player) === 3 ? 4 : 2);
    finishChore(player);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === PATCH_OBJECT_ID) {
      useOnPatch(event, player, itemId);
      return;
    }
    if (objectId === FIREPLACE_OBJECT_ID) {
      useOnFireplace(event, player, itemId);
      return;
    }
    if (objectId === TABLE_OBJECT_ID) {
      useOnTable(event, player, itemId);
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!UNFERTH_NPC_IDS.has(npcId) || !SHEARS_ITEM_IDS.has(itemId)) return;
    if (quest.getStage(player) !== STAGE_CHORES || tidyHuman(player) >= 8) return;
    event.handled = true;
    setTidyHuman(player, 8);
    finishChore(player);
  }

  function openPresent(event) {
    if (event.itemId !== PRESENT_ITEM_ID) return false;
    const { player } = event;
    if (player.getInventory().getFreeSlots() + 1 < 3) {
      player.sendMessage("You need more inventory space to open the present.");
      return true;
    }
    player.getInventory().deleteNumber(PRESENT_ITEM_ID, 1);
    player.getInventory().adds(ANTIQUE_LAMP_ITEM_ID, 2);
    player.getInventory().adds(MOUSE_TOY_ITEM_ID, 1);
    return true;
  }

  function rubAntiqueLamp(event) {
    if (event.itemId !== ANTIQUE_LAMP_ITEM_ID) return false;
    const { player, item, slot } = event;
    lampPending.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 30,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (lampPending.get(player)?.item !== item) return null;
    lampPending.delete(player);
    if (player.getInventory().get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_EXPERIENCE, false);
    if (manager.getExperience(skill) === before) return null;
    player.getInventory().deleteAtSlot(slot, 1);
    return `You have been awarded ${LAMP_EXPERIENCE} ${name ?? skill.getName()} XP!`;
  }

  // ==========================================================================
  // Growth / login
  // ==========================================================================

  function handleAdvanceTime(event) {
    const { player, ms } = event;
    if (!player || !Number.isFinite(ms) || ms <= 0) return;
    const growAt = Number(player.getAttribute(PATCH_ATTRIBUTE)) || 0;
    if (growAt <= 0) return;
    const next = growAt - ms;
    player.setAttribute(PATCH_ATTRIBUTE, Math.max(0, next));
    if (next <= Date.now()) finishPotatoes(player);
    if (Array.isArray(event.handledBy)) event.handledBy.push("TailOfTwoCats");
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    // No dialogue on login: grow silently, then let the player discover the
    // finished chores (the advance-time path and chore interactions announce).
    if (growPotatoes(player)) {
      player.sendMessage("Perhaps I should have a look and see if Unferth's potatoes have grown...");
      if (quest.getStage(player) === STAGE_CHORES && choresDone(player)) {
        quest.setStage(player, STAGE_CHORES_DONE);
      }
    }
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Unferth asked me to find his missing cat Bob.</str>",
        "<str>With Hild's help and an enchanted catspeak amulet I</str>",
        "<str>tracked Bob down, and the Sphinx proved he was once</str>",
        "<str>Robert the Strong. I looked after Unferth, cured his</str>",
        "<str>imaginary illness, and Bob came home with Neite.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BOB_BACK) {
      return [
        "<str>Bob and Neite went on holiday while I looked after</str>",
        "<str>Unferth and cured his imaginary illness.</str>",
        "",
        "Bob should be back now; I should speak to <col=800000>Unferth</col>.",
      ];
    }
    if (stage >= STAGE_CURED) {
      return [
        "<str>Bob and Neite went on holiday while I looked after</str>",
        "<str>Unferth. I disguised as a doctor and 'cured' him.</str>",
        "",
        "My cat says <col=800000>Bob</col> should be back by now.",
      ];
    }
    if (stage >= STAGE_APOTHECARY) {
      return [
        "<str>Bob and Neite went on holiday while I looked after</str>",
        "<str>Unferth. He thinks he is ill, so the Apothecary in</str>",
        "<str>Varrock told me to dress as a doctor or nurse and</str>",
        "<str>give him a vial of water.</str>",
        "",
        "I should visit <col=800000>Unferth</col> in white robes, wearing a hat",
        "and with a vial of water.",
      ];
    }
    if (stage >= STAGE_MEDICAL) {
      return [
        "<str>Bob and Neite went on holiday while I looked after</str>",
        "<str>Unferth.</str>",
        "",
        "Unferth says he is ill; I should fetch the",
        "<col=800000>Apothecary</col> from Varrock.",
      ];
    }
    if (stage >= STAGE_CHORES_DONE) {
      return [
        "<str>Bob and Neite went on holiday while I looked after</str>",
        "<str>Unferth, and I have finished his list of chores.</str>",
        "",
        "I should speak to <col=800000>Unferth</col>.",
      ];
    }
    if (stage >= STAGE_CHORES) {
      const line = (undone, done) =>
        done ? `<str>${done}</str>` : `I still need to ${undone}.`;
      return [
        "<str>Bob asked me to look after Unferth while he and</str>",
        "<str>Neite are away, and gave me a list of chores.</str>",
        "",
        line("<col=800000>tidy the house</col>", "I have tidied the house", tidyHouse(player) === 1),
        line("<col=800000>warm the human</col>", "I have warmed the human", warmHuman(player) === 2),
        line("<col=800000>feed the human</col>", "I have fed the human", feedHuman(player) === 4),
        line("<col=800000>tidy the human</col>", "I have tidied the human", tidyHuman(player) === 8),
        line("<col=800000>tend the garden</col>", "I have tended the garden", tidyGarden(player) === 8),
      ];
    }
    if (stage >= STAGE_TOLD_BOB) {
      return [
        "<str>Bob has no memory of his parents, but my cat thinks</str>",
        "<str>he may be Robert the Strong.</str>",
        "",
        "The <col=800000>Sphinx</col> in Sophanem may be able to unlock Bob's",
        "memories.",
      ];
    }
    if (stage >= STAGE_ASKED_RELDO) {
      return [
        "<str>Reldo told me the legend of Robert the Strong and</str>",
        "<str>the dragonkin. My cat thinks Bob is Robert.</str>",
        "",
        "I should tell <col=800000>Bob</col> what we have learned.",
      ];
    }
    if (stage >= STAGE_ASKED_GERTRUDE) {
      return [
        "<str>Gertrude found Bob as a kitten but knows nothing of</str>",
        "<str>his parents; my cat thinks he may be Robert the Strong.</str>",
        "",
        "<col=800000>Reldo</col> in the Varrock Palace library may know more.",
      ];
    }
    if (stage >= STAGE_FOUND_BOB) {
      return [
        "<str>I found Bob. He is in love with Neite and knows</str>",
        "<str>nothing of his parents; Gertrude looked after him</str>",
        "<str>as a kitten.</str>",
        "",
        "I should ask <col=800000>Gertrude</col> about Bob's parents.",
      ];
    }
    if (stage >= STAGE_AMULET_ENCHANTED) {
      return [
        "<str>Unferth asked me to find his missing cat Bob.</str>",
        "<str>Hild enchanted my catspeak amulet for five death runes</str>",
        "<str>so that I can locate Bob.</str>",
        "",
        "I should use the <col=800000>catspeak amulet(e)</col> to find Bob.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Unferth's cat Bob is missing, and he asked me to help.</str>",
        "",
        "His friend <col=800000>Hild</col>, just up the road, may be able to",
        "locate Bob.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Unferth</col> in his",
      "house in Burthorpe.",
      "",
      "I must have a cat with me and wear my catspeak amulet.",
      "Requirements: <col=800000>Icthlarin's Little Helper</col>.",
    ];
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(CHORES_ATTRIBUTE);
  api.persistAttribute(HAT_ATTRIBUTE);
  api.persistAttribute(PATCH_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "a_tail_of_two_cats",
    name: "A Tail of Two Cats",
    varpId: VARP_TWOCATS,
    varbitId: VARBIT_TWOCATS_QUEST,
    varbitValue: wireStage,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    rewardItemId: PRESENT_ITEM_ID,
    rewardItemLabel: "A present",
    otherRewards: ["A Doctor's hat or Nurse hat"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("agent:advance-time", handleAdvanceTime);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onPlayerLogin(handleLogin);
  api.onNpcInteraction("Gertrude", { "Talk-to": talkToGertrude });
  api.onNpcInteraction("Sphinx", { "Talk-to": talkToSphinx });
  api.onNpcInteraction("Apothecary", { "Talk-to": talkToApothecary });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemAction("Present", { Open: openPresent });
  api.onItemAction("Antique lamp", { Rub: rubAntiqueLamp });
};
