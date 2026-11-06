/**
 * The Fremennik Trials (members).
 *
 * The words come from the "The Fremennik Trials" transcript page; this plugin
 * supplies the variant selector for Brundt, Manni, Olaf, Lalli, Sigli, Sigmund,
 * Swensen, Peer, Thorvald, Askeladden and the merchant-chain Fremennik, the
 * prose-condition answers, the start hook, the seven trials and the completion.
 *
 * The stage numbers below are durable plugin stages. nativeProgress maps them to
 * the native cache phases; see docs/quests/native-quest-state-a.md.
 *
 * Stages (varp 347, the real OSRS "VIKING" varp): 1 started, each completed
 * trial advances a stage up to 7, and Brundt's acceptance sets 8 (complete).
 * Per-trial progress (0 none / 1 started / 2 done) is
 * kept in the persisted "quest.fremennik_trials.trials" attribute (three bits
 * per trial), the merchant-chain step in "quest.fremennik_trials.merchant" and
 * the small flags in "quest.fremennik_trials.flags".
 *
 * Source: LostCityRS/Content scripts/quests/quest_viking (pinned in issue #196).
 * Maze and Seer puzzle: https://oldschool.runescape.wiki/w/The_Fremennik_Trials
 *
 * Gaps: the Koschei fight is a plain owner-only spawn; the strange object has no
 * explosion timer; the party potion uses the transcript's 250 gp branch.
 */
module.exports = function registerFremennikTrialsQuest(api) {
  const {
    Skill,
    Location,
    GameObject,
    ObjectManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    CountdownTask,
    TaskManager,
    Bank,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Fremennik Trials";
  const VARP_FREMENNIK_TRIALS = 347;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 8;
  const VOTES_REQUIRED = 7;

  const TRIALS_ATTRIBUTE = "quest.fremennik_trials.trials";
  const MERCHANT_ATTRIBUTE = "quest.fremennik_trials.merchant";
  const FLAGS_ATTRIBUTE = "quest.fremennik_trials.flags";

  const REVELLER = 0;
  const BARD = 1;
  const MERCHANT = 2;
  const NAVIGATOR = 3;
  const SEER = 4;
  const WARRIOR = 5;
  const HUNTER = 6;
  const TRIAL_NAMES = [
    "the Reveller's trial",
    "the Bard's trial",
    "the Merchant's trial",
    "the Navigator's trial",
    "the Seer's trial",
    "the Warrior's trial",
    "the Hunter's trial",
  ];

  const FLAG_FIRECRACKER = 0;
  const FLAG_LOW_ALCOHOL = 1;
  const FLAG_SOUP_ROCK = 2;
  const FLAG_SOUP_CABBAGE = 3;
  const FLAG_SOUP_POTATO = 4;
  const FLAG_SOUP_ONION = 5;
  const FLAG_DRAUGEN = 6;
  const FLAG_NAVIGATOR = 7;
  const FLAG_LOW_ALCOHOL_BOUGHT = 8;
  const FLAG_SEER_RIDDLE = 9;
  const FLAG_MURAL_OLD_DISK = 10;
  const FLAG_MURAL_RED_DISK = 11;

  const M_NONE = 0;
  const M_STARTED = 1;
  const M_SAILOR = 2;
  const M_OLAF = 3;
  const M_YRSA = 4;
  const M_CHIEF = 5;
  const M_SIGLI = 6;
  const M_SKULGRIMEN = 7;
  const M_FISHERMAN = 8;
  const M_SWENSEN = 9;
  const M_SEER = 10;
  const M_THORVALD = 11;
  const M_MANNI = 12;
  const M_THORA = 13;
  const M_NOTE = 14;
  const M_COCKTAIL = 15;
  const M_TOKEN = 16;
  const M_CONTRACT = 17;
  const M_FORECAST = 18;
  const M_SEAMAP = 19;
  const M_FISH = 20;
  const M_BOWSTRING = 21;
  const M_TRACKING = 22;
  const M_FISCAL = 23;
  const M_BOOTS = 24;
  const M_BALLAD = 25;
  const M_FLOWER = 26;

  const START_HOOK = "quest:the-fremennik-trials:start";

  const BRUNDT_IDS = new Set([
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_2,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_3,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_4,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_5,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_6,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_7,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_8,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_9,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_10,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_11,
    NpcIdentifiers.BRUNDT_THE_CHIEFTAIN_12,
  ]);
  const OLAF_IDS = new Set([NpcIdentifiers.OLAF_THE_BARD, NpcIdentifiers.OLAF_THE_BARD_2]);
  const LALLI_IDS = new Set([NpcIdentifiers.LALLI]);
  const MANNI_IDS = new Set([NpcIdentifiers.MANNI_THE_REVELLER, 9275]); // 9275 = Manni the Reveller (rework)
  const SIGLI_IDS = new Set([NpcIdentifiers.SIGLI_THE_HUNTSMAN]);
  const SIGMUND_IDS = new Set([NpcIdentifiers.SIGMUND_THE_MERCHANT]);
  const THORVALD_IDS = new Set([
    NpcIdentifiers.THORVALD_THE_WARRIOR,
    NpcIdentifiers.THORVALD_THE_WARRIOR_2,
    NpcIdentifiers.THORVALD_THE_WARRIOR_3,
  ]);
  const PEER_IDS = new Set([NpcIdentifiers.PEER_THE_SEER, NpcIdentifiers.PEER_THE_SEER_2]);
  const SWENSEN_IDS = new Set([NpcIdentifiers.SWENSEN_THE_NAVIGATOR, NpcIdentifiers.SWENSEN_THE_NAVIGATOR_2]);
  const ASKELADDEN_IDS = new Set([
    NpcIdentifiers.ASKELADDEN,
    NpcIdentifiers.ASKELADDEN_2,
    NpcIdentifiers.ASKELADDEN_3,
    NpcIdentifiers.ASKELADDEN_4,
  ]);
  const THORA_IDS = new Set([NpcIdentifiers.THORA_THE_BARKEEP, 9264]); // 9264 = Thora the Barkeep (rework)
  const YRSA_IDS = new Set([NpcIdentifiers.YRSA_2]);
  const FISHERMAN_IDS = new Set([NpcIdentifiers.FISHERMAN]);
  const SKULGRIMEN_IDS = new Set([NpcIdentifiers.SKULGRIMEN]);
  const SAILOR_IDS = new Set([NpcIdentifiers.SAILOR, NpcIdentifiers.SAILOR_2]);
  const COUNCIL_WORKMAN_ID = NpcIdentifiers.COUNCIL_WORKMAN;
  const POISON_SALESMAN_ID = NpcIdentifiers.POISON_SALESMAN;
  const LONGHALL_BOUNCER_ID = NpcIdentifiers.LONGHALL_BOUNCER;
  const FOSSEGRIMEN_ID = NpcIdentifiers.FOSSEGRIMEN;
  const DRAUGEN_ID = NpcIdentifiers.THE_DRAUGEN;
  const KOSCHEI_IDS = new Set([
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_2,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_3,
    NpcIdentifiers.KOSCHEI_THE_DEATHLESS_4,
  ]);

  const STALL_IDS = new Set([
    ObjectIdentifiers.FISH_STALL,
    ObjectIdentifiers.FUR_STALL_2,
    ObjectIdentifiers.MARKET_STALL_7,
  ]);
  const SWAYING_TREE_ID = ObjectIdentifiers.SWAYING_TREE;
  // Peer's house: the map only places the puzzle floor two planes up, with no
  // ladder on the intermediate plane, so the generic climb handlers refuse them.
  const PEER_LADDER_IDS = new Set([ObjectIdentifiers.LADDER_35, ObjectIdentifiers.LADDER_36]);
  const PEER_TRAPDOOR_IDS = new Set([ObjectIdentifiers.TRAPDOOR_14, ObjectIdentifiers.TRAPDOOR_15]);
  const PEER_PUZZLE_FLOOR = 2;
  // The seven cache portal variants follow S-W-E-N-S-E-N; the eighth is a dead end.
  const MAZE_PORTALS = new Map([
    [ObjectIdentifiers.PORTAL, [2642, 10016]],
    [ObjectIdentifiers.PORTAL_29, [2653, 10005]],
    [ObjectIdentifiers.PORTAL_2, [2665, 10016]],
    [ObjectIdentifiers.PORTAL_3, [2630, 10027]],
    [ObjectIdentifiers.PORTAL_4, [2653, 10038]],
    [ObjectIdentifiers.PORTAL_5, [2666, 10027]],
    [ObjectIdentifiers.PORTAL_6, [2665, 10038]],
    [ObjectIdentifiers.PORTAL_7, [2631, 10016]],
  ]);

  /** NPCs whose transcripts this plugin owns; dialogue conditions from anyone else are not ours. */
  const DIALOGUE_NPC_IDS = new Set([
    ...BRUNDT_IDS,
    ...OLAF_IDS,
    ...LALLI_IDS,
    ...MANNI_IDS,
    ...SIGMUND_IDS,
    ...SIGLI_IDS,
    ...SWENSEN_IDS,
    ...PEER_IDS,
    ...THORVALD_IDS,
    ...ASKELADDEN_IDS,
    ...THORA_IDS,
    ...YRSA_IDS,
    ...FISHERMAN_IDS,
    ...SKULGRIMEN_IDS,
    ...SAILOR_IDS,
    COUNCIL_WORKMAN_ID,
    POISON_SALESMAN_ID,
    LONGHALL_BOUNCER_ID,
    FOSSEGRIMEN_ID,
  ]);

  const {
    BEER,
    BEER_TANKARD,
    KEG_OF_BEER,
    LOW_ALCOHOL_KEG,
    STRANGE_OBJECT,
    LIT_STRANGE_OBJECT,
    PET_ROCK,
    BRANCH,
    UNSTRUNG_LYRE,
    LYRE,
    ENCHANTED_LYRE,
    GOLDEN_FLEECE,
    GOLDEN_WOOL,
    HUNTERS_TALISMAN,
    HUNTERS_TALISMAN_2,
    EXOTIC_FLOWER,
    FREMENNIK_BALLAD,
    STURDY_BOOTS,
    TRACKING_MAP,
    CUSTOM_BOW_STRING,
    UNUSUAL_FISH,
    SEA_FISHING_MAP,
    WEATHER_FORECAST,
    CHAMPIONS_TOKEN,
    LEGENDARY_COCKTAIL,
    FISCAL_STATEMENT,
    PROMISSORY_NOTE,
    WARRIORS_CONTRACT,
    COINS,
    KNIFE,
    TINDERBOX,
    RAW_SHARK,
    RAW_MANTA_RAY,
    RAW_SEA_TURTLE,
    RAW_BASS,
    CABBAGE,
    POTATO,
    ONION,
    VASE_2,
    VASE_OF_WATER,
    FROZEN_VASE,
    VASE_LID,
    SEALED_VASE,
    SEALED_VASE_3,
    FROZEN_KEY,
    SEERS_KEY,
    RED_HERRING,
    HERRING,
    OLD_RED_DISK,
    RED_DISK_3,
    WOODEN_DISK,
    STICKY_RED_GOOP,
    MAGNET_2,
    BLUE_THREAD,
    SMALL_PICK,
    TOY_SHIP,
    FULL_BUCKET,
    _4_5THS_FULL_BUCKET,
    _3_5THS_FULL_BUCKET,
    _2_5THS_FULL_BUCKET,
    _1_5THS_FULL_BUCKET,
    EMPTY_BUCKET,
    FROZEN_BUCKET,
    FULL_JUG,
    _2_3RDS_FULL_JUG,
    _1_3RDS_FULL_JUG,
    EMPTY_JUG,
    FROZEN_JUG,
    FREMENNIK_BLADE,
  } = ItemIdentifiers;

  const SIGMUND = "the-council-members-sigmund-the-merchant-s-small-favour";
  const SAILOR_FAVOR = `${SIGMUND}-the-sailor-s-favor`;
  const SWENSEN_FAVOR = `${SAILOR_FAVOR}-talking-to-swensen-the-navigator`;

  const V = {
    brundtStart: "starting-off-talking-to-brundt-the-chieftain",
    brundtProgress: "the-council-members-talking-to-brundt",
    brundtPost: "post-quest-dialogue",
    brundtFlower: `${SIGMUND}-finding-the-unique-flower-s-whereabouts-talking-to-brundt`,
    brundtSailor: `${SAILOR_FAVOR}-talking-to-brundt`,
    brundtMap: `${SWENSEN_FAVOR}-giving-the-map-to-brundt`,
    brundtMapAgain: `${SWENSEN_FAVOR}-talking-to-brundt-again`,
    revellerOffer: "the-council-members-manni-the-reveller",
    revellerAgain: "the-council-members-manni-the-reveller-talking-to-manni-the-reveller-again",
    revellerRetry:
      "the-council-members-manni-the-reveller-talking-to-manni-the-reveller-again-talking-to-manni-after-the-player-s-loss",
    revellerWin:
      "the-council-members-creating-a-distraction-talking-to-manni-after-switching-with-the-low-alcohol-beer",
    revellerDone: "the-council-members-subsequent-dialogue-with-manni",
    olafOffer: "the-council-members-olaf-the-bard",
    olafAgain: "the-council-members-olaf-the-bard-talking-to-him-again",
    olafDone: "the-council-members-olaf-the-bard-subsequent-dialogue-with-olaf",
    lalliFirst: "the-council-members-olaf-the-bard-talking-to-lalli",
    lalliRock: "the-council-members-olaf-the-bard-talking-to-lalli-again-with-the-pet-rock",
    lalliSoup:
      "the-council-members-olaf-the-bard-talking-to-lalli-again-with-the-pet-rock-making-rock-soup-talking-to-lalli-after-making-the-soup",
    askeladdenBase: "the-non-council-members-askeladden",
    askeladdenOlaf: "the-council-members-olaf-the-bard-talking-to-askeladden",
    askeladdenOlafAgain:
      "the-council-members-olaf-the-bard-talking-to-askeladden-talking-to-askeladden-again",
    sigmundOffer: SIGMUND,
    sigmundAgain: `${SIGMUND}-talking-to-sigmund-again`,
    sigmundFlowers: `${SAILOR_FAVOR}-giving-the-flowers-to-sigmund`,
    sigmundDone: `${SAILOR_FAVOR}-subsequent-dialogue-with-sigmund`,
    sigliOffer: "the-council-members-sigli-the-huntsman",
    sigliAgain: "the-council-members-sigli-the-huntsman-talking-to-sigli-again",
    sigliHuntDone: "the-council-members-sigli-the-huntsman-talking-to-sigli-after-defeating-the-draugen",
    sigliDone:
      "the-council-members-sigli-the-huntsman-talking-to-sigli-after-defeating-the-draugen-subsequent-dialogue-with-sigli",
    sigliBow:
      "the-council-members-sigmund-the-merchant-s-small-favour-the-sailor-s-favor-finding-sigli-s-bowstring",
    swensenOffer: "the-council-members-swensen-s-trial-talking-to-swensen",
    swensenAgain: "the-council-members-swensen-s-trial-talking-to-swensen-again",
    swensenDone: "the-council-members-swensen-s-trial-talking-to-swensen-again-2",
    peerMenu: "the-council-members-peer-the-seer",
    peerTrial: "the-council-members-peer-the-seer-s-trial",
    peerTrialAgain: "the-council-members-peer-the-seer-s-trial-talking-to-peer-the-seer-again",
    peerDone: "the-council-members-peer-the-seer-s-trial-talking-to-peer-the-seer-again-2",
    peerBodyguard: `${SWENSEN_FAVOR}-giving-peer-the-seer-the-bodyguard-contract`,
    thorvaldOffer: "the-council-members-thorvald-the-warrior",
    thorvaldAgain: "the-council-members-thorvald-the-warrior-talking-to-thorvald-again",
    thorvaldDone: "the-council-members-peer-the-seer-after-defeating-koschei-talking-to-thorvald",
    thorvaldBoots: `${SWENSEN_FAVOR}-giving-thorvald-his-token`,
    thorvaldConvince: `${SWENSEN_FAVOR}-convincing-thorvald-to-be-a-bodyguard`,
    thorvaldAgain2: `${SWENSEN_FAVOR}-talking-to-thorvald-again-2`,
    bouncerBlessed: "the-council-members-olaf-the-bard-talking-to-the-longhall-with-the-blessed-lyre",
    bouncerBackstage: "the-council-members-olaf-the-bard-entering-the-backstage",
    workman: "the-council-members-talking-to-the-council-workman",
    workmanBeer:
      "the-council-members-talking-to-the-council-workman-using-a-normal-beer-or-beer-tankard-on-the-council-workman",
    poison: "the-council-members-talking-to-the-poison-salesman",
    poisonAgain: "the-council-members-talking-to-the-poison-salesman-talking-to-the-poison-salesman-again",
    fossegrimen: "the-council-members-olaf-the-bard-talking-to-the-fossegrimen",
  };

  const flowerAsk = (slug) => `${SIGMUND}-finding-the-unique-flower-s-whereabouts-talking-to-${slug}`;
  const bowAsk = (slug) => `${SAILOR_FAVOR}-finding-sigli-s-bowstring-talking-to-${slug}`;
  const swensenGiving = (slug) => `${SWENSEN_FAVOR}-giving-${slug}`;
  const swensenTalk = (slug) => `${SWENSEN_FAVOR}-talking-to-${slug}`;

  const BUCKET_UNITS = new Map([
    [EMPTY_BUCKET, 0],
    [_1_5THS_FULL_BUCKET, 1],
    [_2_5THS_FULL_BUCKET, 2],
    [_3_5THS_FULL_BUCKET, 3],
    [_4_5THS_FULL_BUCKET, 4],
    [FULL_BUCKET, 5],
    [FROZEN_BUCKET, 0],
  ]);
  const JUG_UNITS = new Map([
    [EMPTY_JUG, 0],
    [_1_3RDS_FULL_JUG, 1],
    [_2_3RDS_FULL_JUG, 2],
    [FULL_JUG, 3],
    [FROZEN_JUG, 0],
  ]);
  const BUCKET_BY_UNITS = [
    EMPTY_BUCKET,
    _1_5THS_FULL_BUCKET,
    _2_5THS_FULL_BUCKET,
    _3_5THS_FULL_BUCKET,
    _4_5THS_FULL_BUCKET,
    FULL_BUCKET,
  ];
  const JUG_BY_UNITS = [EMPTY_JUG, _1_3RDS_FULL_JUG, _2_3RDS_FULL_JUG, FULL_JUG];
  const WORTHY_FISH = [RAW_SHARK, RAW_MANTA_RAY, RAW_SEA_TURTLE];

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const skill = (player, s) => player.getSkillManager().getCurrentLevel(s);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull?.() === true
        ? 0
        : 1;
  }

  function readAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  }

  function trialState(player, index) {
    return (readAttribute(player, TRIALS_ATTRIBUTE) >>> (index * 3)) & 0x7;
  }

  function setTrialState(player, index, value) {
    const shift = index * 3;
    const current = readAttribute(player, TRIALS_ATTRIBUTE);
    const next = (current & ~(0x7 << shift)) | ((value & 0x7) << shift);
    player.setAttribute(TRIALS_ATTRIBUTE, next);
  }

  function merchantStep(player) {
    return readAttribute(player, MERCHANT_ATTRIBUTE);
  }

  function setMerchantStep(player, value) {
    player.setAttribute(MERCHANT_ATTRIBUTE, value | 0);
  }

  function flag(player, bit) {
    return ((readAttribute(player, FLAGS_ATTRIBUTE) >>> bit) & 1) === 1;
  }

  function setFlag(player, bit, on = true) {
    const current = readAttribute(player, FLAGS_ATTRIBUTE);
    const next = on ? current | (1 << bit) : current & ~(1 << bit);
    player.setAttribute(FLAGS_ATTRIBUTE, next);
  }

  function votesFor(player) {
    let count = 0;
    for (let index = 0; index <= HUNTER; index++) {
      if (trialState(player, index) === 2) count++;
    }
    return count;
  }

  function soupDone(player) {
    return (
      flag(player, FLAG_SOUP_ROCK) &&
      flag(player, FLAG_SOUP_CABBAGE) &&
      flag(player, FLAG_SOUP_POTATO) &&
      flag(player, FLAG_SOUP_ONION)
    );
  }

  function completeTrial(player, index) {
    if (trialState(player, index) === 2) return;
    setTrialState(player, index, 2);
    const stage = quest.getStage(player);
    if (stage < STAGE_COMPLETE - 1) quest.setStage(player, stage + 1);
    else player.getPacketSender().sendConfig(VARP_FREMENNIK_TRIALS, nativeProgress(stage, player));
    player.sendMessage(`Congratulations! You have completed ${TRIAL_NAMES[index]}.`);
  }

  function inBox(player, minX, maxX, minY, maxY) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  const inRellekka = (player) => inBox(player, 2590, 2760, 3610, 3710);
  const onLonghallStage = (player) =>
    player.getLocation().getZ() === 0 && inBox(player, 2655, 2662, 3683, 3685);
  const inPeerHouse = (player) => inBox(player, 2624, 2648, 3658, 3680);
  const carryingAnything = (player) =>
    player.getInventory().getValidItems().length > 0 || player.getEquipment().getValidItems().length > 0;
  const inTrollCave = (player) => inBox(player, 2755, 2790, 3605, 3640);

  function hasLevel99(player) {
    return Skill.values().some((s) => s.getIndex() >= 0 && skill(player, s) >= 99);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I made my way to Rellekka and passed the trials of the</str>",
        "<str>Fremennik, earning seven council votes and a new name.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Brundt the Chieftain</col>",
        "in the <col=800000>Rellekka Longhall</col>.",
        "",
        "I may need 40 Woodcutting, 40 Crafting and 25 Fletching",
        "to make the lyre, and the courage to fight unarmed.",
      ];
    }
    const lines = [`I have ${votesFor(player)} of the ${VOTES_REQUIRED} council votes I need.`, ""];
    const labels = [
      ["the Reveller", "defeat Manni in a drinking contest"],
      ["the Bard", "make and play a lyre in the longhall"],
      ["the Merchant", "run Sigmund's trading errand"],
      ["the Navigator", "pass Swensen's maze"],
      ["the Seer", "solve Peer's house puzzle"],
      ["the Warrior", "face Koschei unarmed"],
      ["the Hunter", "track and defeat the Draugen"],
    ];
    labels.forEach(([name, task], index) => {
      const state = trialState(player, index);
      if (state === 2) lines.push(`<str>${name}: vote earned.</str>`);
      else if (state === 1) lines.push(`${name}: I must ${task}.`);
      else lines.push(`${name}: I have not started this trial.`);
    });
    return lines;
  }

  function grantReward(player) {
    const amount = 2812.4;
    for (const s of [
      Skill.AGILITY,
      Skill.ATTACK,
      Skill.CRAFTING,
      Skill.DEFENCE,
      Skill.FISHING,
      Skill.FLETCHING,
      Skill.HITPOINTS,
      Skill.STRENGTH,
      Skill.THIEVING,
      Skill.WOODCUTTING,
    ]) {
      player.getSkillManager().addExperiences(s, amount);
    }
  }

  function brundtVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return V.brundtPost;
    if (stage <= 0) return V.brundtStart;
    if (votesFor(player) >= VOTES_REQUIRED || trialState(player, MERCHANT) === 2) return V.brundtProgress;
    const step = merchantStep(player);
    if (step >= M_TRACKING && held(player, TRACKING_MAP)) return V.brundtMap;
    if (held(player, FISCAL_STATEMENT) || step >= M_FISCAL) return V.brundtMapAgain;
    if (step === M_YRSA) setMerchantStep(player, M_CHIEF);
    if (step >= M_YRSA) return V.brundtSailor;
    if (step >= M_STARTED) return V.brundtFlower;
    return V.brundtProgress;
  }

  function olafVariant(player, stage) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, STURDY_BOOTS)) return swensenGiving("the-boots-to-olaf");
    if (merchantActive && step === M_SAILOR) setMerchantStep(player, M_OLAF);
    if (merchantActive && step >= M_BALLAD) return swensenTalk("olaf-again");
    if (merchantActive && step >= M_BOWSTRING) return bowAsk("olaf");
    // He keeps asking for boots until he has them. The step moves when this variant is
    // picked, so a closed menu or "Ask about becoming a Fremennik" must not lose it.
    if (merchantActive && step >= M_SAILOR) return `${SAILOR_FAVOR}-talking-to-olaf-the-bard`;
    if (merchantActive && step >= M_STARTED) return flowerAsk("olaf");
    if (trialState(player, BARD) === 2) return V.olafDone;
    if (stage >= STAGE_STARTED) return trialState(player, BARD) >= 1 ? V.olafAgain : V.olafOffer;
    return null;
  }

  function lalliVariant(player) {
    if (trialState(player, BARD) === 2 || soupDone(player)) return V.lalliSoup;
    if (trialState(player, BARD) >= 1 && held(player, PET_ROCK)) return V.lalliRock;
    return V.lalliFirst;
  }

  function askeladdenVariant(player) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && step === M_THORA) return swensenTalk("askeladden");
    if (merchantActive && step >= M_BOWSTRING) return bowAsk("askeladden");
    if (merchantActive && step >= M_STARTED) return flowerAsk("askeladden");
    return askeladdenTrialVariant(player);
  }

  /** Askeladden's own talk: the pet rock once Olaf's trial is under way. */
  function askeladdenTrialVariant(player) {
    if (trialState(player, BARD) < 1) return V.askeladdenBase;
    return held(player, PET_ROCK) ? V.askeladdenOlafAgain : V.askeladdenOlaf;
  }

  function manniVariant(player, stage) {
    const state = trialState(player, REVELLER);
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, LEGENDARY_COCKTAIL)) return swensenGiving("manni-his-legendary-cocktail");
    if (merchantActive && step === M_THORVALD) {
      setMerchantStep(player, M_MANNI);
      return swensenTalk("manni-the-reveller");
    }
    if (merchantActive && step >= M_COCKTAIL) return swensenTalk("manni-again-2");
    if (merchantActive && step >= M_MANNI) return swensenTalk("manni-again");
    if (merchantActive && step >= M_BOWSTRING) return bowAsk("manni");
    if (merchantActive && step >= M_STARTED) return flowerAsk("manni");
    if (state === 2) return V.revellerDone;
    if (stage >= STAGE_STARTED) {
      if (state === 0) return V.revellerOffer;
      if (flag(player, FLAG_LOW_ALCOHOL) && held(player, KEG_OF_BEER)) return V.revellerWin;
      if (held(player, KEG_OF_BEER)) return V.revellerAgain;
      return V.revellerRetry;
    }
    return null;
  }

  function sigmundVariant(player, stage) {
    if (trialState(player, MERCHANT) === 2) return V.sigmundDone;
    if (held(player, EXOTIC_FLOWER)) return V.sigmundFlowers;
    if (stage >= STAGE_STARTED && merchantStep(player) === M_NONE) return V.sigmundOffer;
    return V.sigmundAgain;
  }

  function sigliVariant(player, stage) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, CUSTOM_BOW_STRING)) return swensenGiving("the-bowstring-to-sigli");
    if (merchantActive && step === M_CHIEF) setMerchantStep(player, M_SIGLI);
    if (merchantActive && step >= M_TRACKING) return swensenTalk("sigli-again");
    if (merchantActive && step >= M_CHIEF) return V.sigliBow;
    if (merchantActive && step >= M_STARTED) return flowerAsk("sigli");
    if (trialState(player, HUNTER) === 2) return V.sigliDone;
    if (trialState(player, HUNTER) === 1) return flag(player, FLAG_DRAUGEN) ? V.sigliHuntDone : V.sigliAgain;
    if (stage >= STAGE_STARTED) return V.sigliOffer;
    return null;
  }

  function swensenVariant(player, stage) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, WEATHER_FORECAST)) return swensenGiving("swensen-the-forecast");
    if (merchantActive && step === M_FISHERMAN) {
      setMerchantStep(player, M_SWENSEN);
      return SWENSEN_FAVOR;
    }
    if (merchantActive && step >= M_SWENSEN) return swensenTalk("swensen-again");
    if (merchantActive && step >= M_STARTED) return SWENSEN_FAVOR;
    if (trialState(player, NAVIGATOR) === 2) return V.swensenDone;
    if (stage >= STAGE_STARTED) return trialState(player, NAVIGATOR) === 1 ? V.swensenAgain : V.swensenOffer;
    return null;
  }

  function peerVariant(player, stage) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, WARRIORS_CONTRACT)) return V.peerBodyguard;
    if (merchantActive && step === M_SWENSEN) {
      setMerchantStep(player, M_SEER);
      return `${SWENSEN_FAVOR}-peer-the-seer-s-favour`;
    }
    if (merchantActive && step >= M_SEER) return swensenTalk("peer-the-seer-again");
    if (merchantActive && step >= M_BOWSTRING && step < M_SWENSEN) return bowAsk("peer-the-seer");
    if (merchantActive && step >= M_STARTED) return flowerAsk("peer-the-seer");
    if (trialState(player, SEER) === 2) return V.peerDone;
    if (stage >= STAGE_STARTED) return trialState(player, SEER) === 1 ? V.peerTrialAgain : V.peerMenu;
    return null;
  }

  function thorvaldVariant(player, stage) {
    const merchantActive = trialState(player, MERCHANT) !== 2;
    const step = merchantStep(player);
    if (merchantActive && held(player, CHAMPIONS_TOKEN)) return V.thorvaldBoots;
    if (merchantActive && step === M_SEER) {
      setMerchantStep(player, M_THORVALD);
      return V.thorvaldConvince;
    }
    if (merchantActive && step >= M_THORVALD) return V.thorvaldAgain2;
    if (merchantActive && step >= M_BOWSTRING) return bowAsk("thorvald");
    if (merchantActive && step >= M_STARTED) return flowerAsk("thorvald");
    if (trialState(player, WARRIOR) === 2) return V.thorvaldDone;
    if (stage >= STAGE_STARTED) return trialState(player, WARRIOR) === 1 ? V.thorvaldAgain : V.thorvaldOffer;
    return null;
  }

  function thoraVariant(player) {
    const step = merchantStep(player);
    if (held(player, PROMISSORY_NOTE)) return `${SWENSEN_FAVOR}-getting-thora-s-legendary-cocktail`;
    if (step >= M_COCKTAIL) return swensenTalk("thora-again-2");
    if (step === M_MANNI) {
      setMerchantStep(player, M_THORA);
      return swensenTalk("thora");
    }
    if (step >= M_THORA || step >= M_BOWSTRING) return swensenTalk("thora-again");
    if (step >= M_STARTED) return swensenTalk("thora");
    return "the-non-council-members-thora-the-barkeep";
  }

  function yrsaVariant(player) {
    if (held(player, FISCAL_STATEMENT)) return swensenGiving("the-fiscal-statement-to-yrsa");
    const step = merchantStep(player);
    if (step === M_OLAF) {
      setMerchantStep(player, M_YRSA);
      return `${SAILOR_FAVOR}-talking-to-yrsa`;
    }
    if (step >= M_BOWSTRING) return bowAsk("yrsa");
    if (step >= M_STARTED) return `${SAILOR_FAVOR}-talking-to-yrsa-talking-to-yrsa-again`;
    return null;
  }

  function fishermanVariant(player) {
    if (held(player, SEA_FISHING_MAP)) return swensenGiving("the-fisherman-the-map");
    const step = merchantStep(player);
    if (step === M_SKULGRIMEN) {
      setMerchantStep(player, M_FISHERMAN);
      return `${SAILOR_FAVOR}-talking-to-the-fisherman`;
    }
    if (step >= M_BOWSTRING) return bowAsk("the-fisherman");
    if (step >= M_FISHERMAN) {
      return `${SAILOR_FAVOR}-talking-to-the-fisherman-talking-to-the-fisherman-again`;
    }
    if (step >= M_STARTED) return flowerAsk("the-fisherman");
    return "the-non-council-members-fisherman";
  }

  function skulgrimenVariant(player) {
    if (held(player, UNUSUAL_FISH)) return swensenGiving("the-fish-to-skulgrimen");
    const step = merchantStep(player);
    if (step === M_SIGLI) {
      setMerchantStep(player, M_SKULGRIMEN);
      return bowAsk("skulgrimen");
    }
    if (step >= M_SKULGRIMEN) return bowAsk("skulgrimen-again");
    if (step >= M_STARTED) return flowerAsk("skulgrimen");
    return "the-non-council-members-skulgrimen";
  }

  function sailorVariant(player) {
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return null;
    const step = merchantStep(player);
    if (held(player, FREMENNIK_BALLAD)) return swensenGiving("the-ballad-to-the-sailor");
    if (step === M_STARTED) {
      setMerchantStep(player, M_SAILOR);
      return `${SAILOR_FAVOR}-talking-to-the-sailor`;
    }
    if (step >= M_BOWSTRING) return bowAsk("the-sailor");
    if (step >= M_BALLAD) return swensenTalk("the-sailor-again");
    return `${SAILOR_FAVOR}-talking-to-the-sailor`;
  }

  function poisonVariant(player, stage) {
    if (stage < STAGE_STARTED) return null;
    return flag(player, FLAG_LOW_ALCOHOL_BOUGHT) ? V.poisonAgain : V.poison;
  }

  function bouncerVariant(player, stage) {
    if (held(player, ENCHANTED_LYRE)) return V.bouncerBlessed;
    if (trialState(player, BARD) === 2 || stage >= STAGE_COMPLETE) return V.bouncerBackstage;
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (BRUNDT_IDS.has(npcId)) return brundtVariant(player, stage);
    if (OLAF_IDS.has(npcId)) return olafVariant(player, stage);
    if (LALLI_IDS.has(npcId)) return lalliVariant(player);
    if (MANNI_IDS.has(npcId)) return manniVariant(player, stage);
    if (SIGMUND_IDS.has(npcId)) return sigmundVariant(player, stage);
    if (SIGLI_IDS.has(npcId)) return sigliVariant(player, stage);
    if (SWENSEN_IDS.has(npcId)) return swensenVariant(player, stage);
    if (PEER_IDS.has(npcId)) return peerVariant(player, stage);
    if (THORVALD_IDS.has(npcId)) return thorvaldVariant(player, stage);
    if (ASKELADDEN_IDS.has(npcId)) return askeladdenVariant(player);
    if (THORA_IDS.has(npcId)) return thoraVariant(player);
    if (YRSA_IDS.has(npcId)) return yrsaVariant(player);
    if (FISHERMAN_IDS.has(npcId)) return fishermanVariant(player);
    if (SKULGRIMEN_IDS.has(npcId)) return skulgrimenVariant(player);
    if (SAILOR_IDS.has(npcId)) return sailorVariant(player);
    if (npcId === COUNCIL_WORKMAN_ID) return stage >= STAGE_STARTED ? V.workman : null;
    if (npcId === POISON_SALESMAN_ID) return poisonVariant(player, stage);
    if (npcId === LONGHALL_BOUNCER_ID) return bouncerVariant(player, stage);
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    const value = String(text ?? "").toLowerCase();
    if (!value) return null;
    const inventory = player.getInventory();
    const has = (itemId, amount = 1) => inventory.getAmount(itemId) >= amount;
    const free = freeSlots(player);
    const coins = inventory.getAmount(COINS);
    const votes = votesFor(player);

    if (value.includes("missing at least one requirement")) {
      return (
        skill(player, Skill.WOODCUTTING) < 40 ||
        skill(player, Skill.CRAFTING) < 40 ||
        skill(player, Skill.FLETCHING) < 25
      );
    }

    if (value.includes("does not already have the tankard and/or beer tankard")) return !has(BEER_TANKARD);
    if (value.includes("does not have the beer tankards")) return !has(BEER_TANKARD);
    if (value.includes("has the beer tankards")) return has(BEER_TANKARD);
    if (value.includes("does not have a keg of beer")) return !has(KEG_OF_BEER);
    if (value.includes("has a regular keg of beer")) return has(KEG_OF_BEER) && !flag(player, FLAG_LOW_ALCOHOL);

    if (value.includes("does not have 250 gp")) return coins < 250;
    if (value.includes("has 250 gp")) return coins >= 250;
    if (value.includes("does not have 5,000 gp")) return coins < 5000;
    if (value.includes("has 5,000 gp")) return coins >= 5000;

    if (value.includes("inventory is full")) return free <= 0;
    if (
      value.includes("does not have inventory space") ||
      value.includes("no inventory space") ||
      value.includes("not have inventory space")
    ) {
      return free <= 0;
    }
    if (value.includes("has inventory space")) return free > 0;

    if (value.includes("does not have the pet rock")) return !has(PET_ROCK);
    if (value.includes("has the pet rock")) return has(PET_ROCK);

    if (value.includes("done adding the vegetables")) return soupDone(player);
    if (value.includes("adds anything other than rock")) return false;
    if (value.includes("adds a pet rock") || value.includes("adds vegetable")) return false;

    if (value.includes("attempts to cut a swaying tree")) return false;
    if (value.includes("uses a knife on the branch")) return false;
    if (value.includes("uses a ball of wool to string the lyre")) return false;
    if (value.includes("does not have the golden fleece")) return !has(GOLDEN_FLEECE);
    if (value.includes("already has golden fleece")) return has(GOLDEN_FLEECE);
    if (value.includes("unspun golden fleece or a regular ball of wool on the unstrung lyre")) return false;
    if (value.includes("spinning wheel at rellekka")) return has(GOLDEN_FLEECE) && inRellekka(player);
    if (value.includes("spinning wheel anywhere else")) return has(GOLDEN_FLEECE) && !inRellekka(player);
    if (value.includes("without 25 fletching")) return skill(player, Skill.FLETCHING) < 25;
    if (value.includes("with 25 fletching")) return skill(player, Skill.FLETCHING) >= 25;
    if (value.includes("attempts to play the lyre")) return false;

    if (value.includes("does not have a raw shark")) return !has(RAW_SHARK);
    if (value.includes("has a raw shark")) return has(RAW_SHARK);
    if (value.includes("does not have a raw manta ray")) return !has(RAW_MANTA_RAY);
    if (value.includes("has a manta ray")) return has(RAW_MANTA_RAY);
    if (value.includes("does not have a raw sea turtle")) return !has(RAW_SEA_TURTLE);
    if (value.includes("has a raw sea turtle")) return has(RAW_SEA_TURTLE);
    if (value.includes("does not have a raw bass")) return !has(RAW_BASS);
    if (value.includes("has a raw bass")) return has(RAW_BASS);
    if (value.includes("deposits a raw fish")) return WORTHY_FISH.some((fish) => has(fish));

    if (value.includes("champions guild")) return false;
    if (value.includes("heroes' guild") || value.includes("heroes guild")) return false;
    if (value.includes("legends' guild") || value.includes("legends guild")) return false;
    if (value.includes("level 99 in any skill")) return hasLevel99(player);
    if (value.includes("doesn't have any achievements")) return !hasLevel99(player);

    if (value.includes("does not have a talisman")) return !has(HUNTERS_TALISMAN) && !has(HUNTERS_TALISMAN_2);
    if (value.includes("has the talisman")) return has(HUNTERS_TALISMAN) || has(HUNTERS_TALISMAN_2);

    if (value.includes("draugen is defeated")) return flag(player, FLAG_DRAUGEN);
    if (value.includes("locate feature")) return false;
    if (value.includes("draugen moves")) return false;
    if (value.includes("3 tiles near the draugen")) return false;
    if (value.includes("of the draugen")) return false;

    if (value.includes("sigmund other types of flowers")) return false;
    if (value.includes("ballad on the ice queen")) return false;
    if (value.includes("raw sardine on thorvald")) return false;
    if (value.includes("bank is full") || value.includes("unbankable")) return false;
    if (value.includes("bank is not full")) return true;

    if (value.includes("4th form")) return false;
    if (value.includes("in 10 minutes")) return false;
    if (value.includes("manages to defeat koschei")) return false;
    if (value.includes("does not manage to defeat")) return false;
    if (value.includes("wield the blade")) return false;
    if (value.includes("has any weapons or armour")) return false;
    if (value.includes("does not have any weapons or armour")) return true;
    if (value.includes("enters the arena")) return false;
    if (value.includes("another player's koschei")) return false;
    if (value.includes("prayer potion") || value.includes("nearly dead") || value.includes("phase")) return false;

    if (value.includes("does not have any items in their inventory")) return !carryingAnything(player);
    if (value.includes("has items in their inventory")) return carryingAnything(player);
    if (value.includes("peer the seer's house on the east side")) return false;
    if (value.includes("peer the seer's house on the west side")) return false;
    if (value.includes("fails to solve the puzzle")) return false;
    if (value.includes("solves the riddle")) return flag(player, FLAG_SEER_RIDDLE);
    if (value.includes("enters the wrong code")) return false;
    if (value.includes("enters the correct code")) return flag(player, FLAG_SEER_RIDDLE);
    if (value.includes("enters the door and attempts to leave")) return false;
    if (value.includes("presses continue") || value.includes("clicks anywhere else")) return false;

    if (value.includes("trapdoors") || value.includes("climbs down the ladder")) return false;
    if (value.includes("escape rope") || value.includes("climbs up the stairs")) return false;
    if (value.includes("climb down into the maze again")) return false;

    if (value.includes("has not gotten only one vote")) return votes === 1;
    if (value.includes("has gotten 2-6 votes")) return votes >= 2 && votes <= 6;
    if (value.includes("has gotten all 7 votes")) return votes >= VOTES_REQUIRED;

    if (value.includes("did not receive the money")) return !flag(player, FLAG_LOW_ALCOHOL_BOUGHT);
    if (value.includes("free-to-play world")) return false;
    if (value.includes("members' world")) return true;

    if (
      value.startsWith("if the player uses") ||
      value.startsWith("if the player searches") ||
      value.startsWith("if the player shakes") ||
      value.startsWith("if the player studies") ||
      value.startsWith("if the player places") ||
      value.startsWith("if the player adds") ||
      value.startsWith("if the player enters") ||
      value.startsWith("if the player climbs") ||
      value.startsWith("if the player leaves") ||
      value.startsWith("if the player tries")
    ) {
      return false;
    }
    return null;
  }

  function handleHook({ player, npcId, hook }) {
    if (!BRUNDT_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function spawnKoschei(player) {
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: NpcIdentifiers.KOSCHEI_THE_DEATHLESS,
      x: location.getX(),
      y: location.getY() + 1,
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) npc.__skipDefaultRespawn = true;
    player.sendMessage("Koschei the deathless steps forward. Fight him unarmed!");
  }

  /**
   * The trial-acceptance dialogue for a council member. The transcript dump lost
   * the wiki jump targets for the "Ask about becoming a Fremennik" option, so the
   * option is replayed through the member's own trial variant instead.
   */
  function trialOfferVariant(player, npcId) {
    if (OLAF_IDS.has(npcId)) return trialState(player, BARD) === 2 ? V.olafDone : trialState(player, BARD) === 1 ? V.olafAgain : V.olafOffer;
    if (PEER_IDS.has(npcId)) return trialState(player, SEER) === 2 ? V.peerDone : trialState(player, SEER) === 1 ? V.peerTrialAgain : V.peerTrial;
    if (SWENSEN_IDS.has(npcId)) return trialState(player, NAVIGATOR) === 2 ? V.swensenDone : trialState(player, NAVIGATOR) === 1 ? V.swensenAgain : V.swensenOffer;
    if (THORVALD_IDS.has(npcId)) return V.thorvaldOffer;
    if (SIGLI_IDS.has(npcId)) return V.sigliOffer;
    if (MANNI_IDS.has(npcId)) return V.revellerOffer;
    if (ASKELADDEN_IDS.has(npcId)) return askeladdenTrialVariant(player);
    return null;
  }

  function handleChoice({ player, npcId, option }) {
    const text = String(option ?? "").trim().toLowerCase();
    if (text.startsWith("ask about becoming a fremennik")) {
      const offer = trialOfferVariant(player, npcId);
      if (offer && quest.getStage(player) >= STAGE_STARTED) {
        // Let the option's dead branch close the chatbox first, then replay.
        TaskManager.submit(
          new CountdownTask(player, 1, () => {
            if (player.isRegistered?.() === false) return;
            startTranscript(api, player, npcId, PAGE, offer);
          })
        );
      }
      return;
    }
    if (text !== "yes" && text !== "yes.") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return;
    if (SIGMUND_IDS.has(npcId) && merchantStep(player) === M_NONE) {
      setMerchantStep(player, M_STARTED);
      return;
    }
    if (OLAF_IDS.has(npcId) && trialState(player, BARD) === 0) setTrialState(player, BARD, 1);
    if (SWENSEN_IDS.has(npcId) && trialState(player, NAVIGATOR) === 0) setTrialState(player, NAVIGATOR, 1);
    if (PEER_IDS.has(npcId) && trialState(player, SEER) === 0) setTrialState(player, SEER, 1);
    if (THORVALD_IDS.has(npcId) && trialState(player, WARRIOR) === 0) {
      setTrialState(player, WARRIOR, 1);
      spawnKoschei(player);
    }
  }

  function handleConditionStep({ player, stepId }) {
    if (!player) return;
    if (stepId === "KniVWy") {
      if (quest.getStage(player) < STAGE_STARTED) return;
      if (trialState(player, REVELLER) === 0) setTrialState(player, REVELLER, 1);
      if (!held(player, BEER_TANKARD)) give(player, BEER_TANKARD, 1);
      if (!held(player, KEG_OF_BEER) && !flag(player, FLAG_LOW_ALCOHOL)) {
        give(player, KEG_OF_BEER, 1);
        player.sendMessage("You take a keg of beer from the table near the bar.");
      }
      return;
    }
    if (stepId === "TneElg" || stepId === "nHsqoq") {
      if (trialState(player, REVELLER) !== 1) return;
      if (!held(player, BEER_TANKARD)) give(player, BEER_TANKARD, 1);
      if (!held(player, KEG_OF_BEER) && !flag(player, FLAG_LOW_ALCOHOL)) {
        give(player, KEG_OF_BEER, 1);
        player.sendMessage("You take a keg of beer from the table near the bar.");
      }
      return;
    }
    if (stepId === "LZ_wQa" || stepId === "D4d-wQ") {
      if (trialState(player, HUNTER) === 0) setTrialState(player, HUNTER, 1);
      if (stepId === "LZ_wQa" && !held(player, HUNTERS_TALISMAN) && !held(player, HUNTERS_TALISMAN_2)) {
        give(player, HUNTERS_TALISMAN_2, 1);
      }
    }
  }

  /** The first-talk menu holding Peer's bank spell (its "Yes" runs deposit step -sJh9n). */
  function peerBankMenu(steps) {
    for (const step of steps ?? []) {
      if (step.options?.some((option) => option.steps?.some((entry) => entry.id === "-sJh9n"))) return [step];
      for (const option of step.options ?? []) {
        const found = peerBankMenu(option.steps);
        if (found) return found;
      }
    }
    return undefined;
  }

  /**
   * Talking to Peer again while carrying items: the dump lost the targets of the offer's
   * Yes/No ({{tact|above}}, Peer's first-talk bank menu), so they fell back to Brundt's
   * unrelated "Yes"/"No" and never banked anything. Replay that menu after the offer line.
   */
  function offerPeerBankAgain(event) {
    if (!PEER_IDS.has(event.npcId) || !/perform this small spell upon you/i.test(String(event.text ?? ""))) return;
    const { player, npcId } = event;
    event.after = () => startTranscript(api, player, npcId, PAGE, V.peerTrial, peerBankMenu);
  }

  function handleDialogueLine(event) {
    if (event.npcId !== NpcIdentifiers.SIGMUND_THE_MERCHANT) return;
    if (!/incredible! your merchanting skills/i.test(String(event.text ?? ""))) return;
    const { player } = event;
    if (!player || !held(player, EXOTIC_FLOWER) || trialState(player, MERCHANT) === 2) return;
    take(player, EXOTIC_FLOWER, 1);
    completeTrial(player, MERCHANT);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    switch (stepId) {
      case "-sJh9n":
      case "-rbFGl":
        if (!PEER_IDS.has(event.npcId)) return;
        Bank.depositItems(player, player.getInventory(), true);
        Bank.depositItems(player, player.getEquipment(), true);
        return;
      case "Y--9Gn":
        if (!held(player, STRANGE_OBJECT) && !held(player, LIT_STRANGE_OBJECT)) {
          give(player, STRANGE_OBJECT, 1);
        }
        return;
      case "PkDa1o":
        if (held(player, COINS, 250) && !held(player, LOW_ALCOHOL_KEG)) {
          take(player, COINS, 250);
          give(player, LOW_ALCOHOL_KEG, 1);
          setFlag(player, FLAG_LOW_ALCOHOL_BOUGHT);
        }
        return;
      case "rXjJ1K":
        if (!held(player, PET_ROCK)) give(player, PET_ROCK, 1);
        return;
      case "vLCBvq":
        if (!held(player, PET_ROCK)) give(player, PET_ROCK, 1);
        return;
      case "-ZyXnW":
        if (!held(player, GOLDEN_FLEECE)) give(player, GOLDEN_FLEECE, 1);
        return;
      case "-lHzb5":
        if (trialState(player, HUNTER) === 0) setTrialState(player, HUNTER, 1);
        if (!held(player, HUNTERS_TALISMAN) && !held(player, HUNTERS_TALISMAN_2)) {
          give(player, HUNTERS_TALISMAN_2, 1);
        }
        return;
      case "gKEm-3":
        if (!held(player, HUNTERS_TALISMAN) && !held(player, HUNTERS_TALISMAN_2)) {
          give(player, HUNTERS_TALISMAN_2, 1);
        }
        return;
      case "atRour":
        if (held(player, COINS, 5000) && !held(player, PROMISSORY_NOTE)) {
          take(player, COINS, 5000);
          give(player, PROMISSORY_NOTE, 1);
          setMerchantStep(player, M_NOTE);
        }
        return;
      case "QT__OZ":
        if (held(player, PROMISSORY_NOTE) && !held(player, LEGENDARY_COCKTAIL)) {
          take(player, PROMISSORY_NOTE, 1);
          give(player, LEGENDARY_COCKTAIL, 1);
          setMerchantStep(player, M_COCKTAIL);
        }
        return;
      case "dkEO0D":
        if (held(player, LEGENDARY_COCKTAIL) && !held(player, CHAMPIONS_TOKEN)) {
          take(player, LEGENDARY_COCKTAIL, 1);
          give(player, CHAMPIONS_TOKEN, 1);
          setMerchantStep(player, M_TOKEN);
        }
        return;
      case "TI-M0g":
        if (held(player, CHAMPIONS_TOKEN) && !held(player, WARRIORS_CONTRACT)) {
          take(player, CHAMPIONS_TOKEN, 1);
          give(player, WARRIORS_CONTRACT, 1);
          setMerchantStep(player, M_CONTRACT);
        }
        return;
      case "R0GVxE":
        if (held(player, WARRIORS_CONTRACT) && !held(player, WEATHER_FORECAST)) {
          take(player, WARRIORS_CONTRACT, 1);
          give(player, WEATHER_FORECAST, 1);
          setMerchantStep(player, M_FORECAST);
        }
        return;
      case "998Hmd":
        if (held(player, WEATHER_FORECAST) && !held(player, SEA_FISHING_MAP)) {
          take(player, WEATHER_FORECAST, 1);
          give(player, SEA_FISHING_MAP, 1);
          setMerchantStep(player, M_SEAMAP);
        }
        return;
      case "uHd7UN":
        if (held(player, SEA_FISHING_MAP) && !held(player, UNUSUAL_FISH)) {
          take(player, SEA_FISHING_MAP, 1);
          give(player, UNUSUAL_FISH, 1);
          setMerchantStep(player, M_FISH);
        }
        return;
      case "s_MUAW":
        if (held(player, UNUSUAL_FISH) && !held(player, CUSTOM_BOW_STRING)) {
          take(player, UNUSUAL_FISH, 1);
          give(player, CUSTOM_BOW_STRING, 1);
          setMerchantStep(player, M_BOWSTRING);
        }
        return;
      case "aiidGO":
        if (held(player, CUSTOM_BOW_STRING) && !held(player, TRACKING_MAP)) {
          take(player, CUSTOM_BOW_STRING, 1);
          give(player, TRACKING_MAP, 1);
          setMerchantStep(player, M_TRACKING);
        }
        return;
      case "Q1dOsa":
        if (held(player, TRACKING_MAP) && !held(player, FISCAL_STATEMENT)) {
          take(player, TRACKING_MAP, 1);
          give(player, FISCAL_STATEMENT, 1);
          setMerchantStep(player, M_FISCAL);
        }
        return;
      case "8iL98F":
        if (held(player, FISCAL_STATEMENT) && !held(player, STURDY_BOOTS)) {
          take(player, FISCAL_STATEMENT, 1);
          give(player, STURDY_BOOTS, 1);
          setMerchantStep(player, M_BOOTS);
        }
        return;
      case "e1867B":
        if (held(player, STURDY_BOOTS) && !held(player, FREMENNIK_BALLAD)) {
          take(player, STURDY_BOOTS, 1);
          give(player, FREMENNIK_BALLAD, 1);
          setMerchantStep(player, M_BALLAD);
        }
        return;
      case "cJx4A6":
        if (held(player, FREMENNIK_BALLAD) && !held(player, EXOTIC_FLOWER)) {
          take(player, FREMENNIK_BALLAD, 1);
          give(player, EXOTIC_FLOWER, 1);
          setMerchantStep(player, M_FLOWER);
        }
        return;
      case "KrSm12":
        completeTrial(player, REVELLER);
        return;
      case "FNLh6a":
      case "wGcoul":
        if (held(player, KEG_OF_BEER)) take(player, KEG_OF_BEER, 1);
        return;
      case "s66r1V":
        completeTrial(player, BARD);
        return;
      case "a4NUvk":
        if (held(player, SEERS_KEY)) take(player, SEERS_KEY, 1);
        completeTrial(player, SEER);
        return;
      case "KVGiuL":
      case "WSyuYN":
      case "6Tdk9I":
        completeTrial(player, WARRIOR);
        return;
      case "Ked1GJ":
        setFlag(player, FLAG_DRAUGEN);
        return;
      case "3gWp4j":
        if (votesFor(player) >= VOTES_REQUIRED && !quest.isComplete(player)) {
          quest.complete(player);
        }
        event.handled = true;
        event.end = true;
        return;
      default:
        return;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const used = event.usedItemId;
    const withItem = event.usedWithItemId;
    const pair = new Set([used, withItem]);

    if (trialState(player, SEER) === 1 && inPeerHouse(player)) {
      if (pair.has(STICKY_RED_GOOP) && pair.has(WOODEN_DISK)) {
        event.handled = true;
        take(player, STICKY_RED_GOOP);
        take(player, WOODEN_DISK);
        give(player, RED_DISK_3);
        player.sendMessage("You coat the wooden disk with the sticky red goop.");
        return;
      }
      if (pair.has(FULL_JUG) && pair.has(VASE_2)) {
        event.handled = true;
        take(player, FULL_JUG);
        take(player, VASE_2);
        give(player, EMPTY_JUG);
        give(player, VASE_OF_WATER);
        return;
      }
      const vase = pair.has(VASE_OF_WATER) ? VASE_OF_WATER : pair.has(VASE_2) ? VASE_2 : null;
      if (pair.has(VASE_LID) && vase !== null) {
        event.handled = true;
        take(player, VASE_LID);
        take(player, vase);
        give(player, vase === VASE_OF_WATER ? SEALED_VASE_3 : SEALED_VASE);
        player.sendMessage("You screw the lid on tightly.");
        return;
      }
    }

    if (pair.has(BRANCH) && pair.has(KNIFE)) {
      event.handled = true;
      if (trialState(player, BARD) < 1) return;
      if (skill(player, Skill.CRAFTING) < 40) {
        player.sendMessage("You need a Crafting level of 40 to make a lyre.");
        return;
      }
      take(player, BRANCH, 1);
      give(player, UNSTRUNG_LYRE, 1);
      player.sendMessage("You craft an unstrung lyre out of the branch.");
      return;
    }
    if (pair.has(GOLDEN_WOOL) && pair.has(UNSTRUNG_LYRE)) {
      event.handled = true;
      if (skill(player, Skill.FLETCHING) < 25) {
        player.sendMessage("You need to have a Fletching level of 25 to string the lyre.");
        return;
      }
      take(player, GOLDEN_WOOL, 1);
      take(player, UNSTRUNG_LYRE, 1);
      give(player, LYRE, 1);
      player.sendMessage("You attach the golden strings to the lyre.");
      return;
    }
    if (pair.has(TINDERBOX) && pair.has(STRANGE_OBJECT)) {
      event.handled = true;
      take(player, STRANGE_OBJECT, 1);
      give(player, LIT_STRANGE_OBJECT, 1);
      player.sendMessage("You light the string of the strange object. It starts to hiss slightly.");
      return;
    }
    if (pair.has(LOW_ALCOHOL_KEG) && pair.has(KEG_OF_BEER)) {
      event.handled = true;
      if (!flag(player, FLAG_FIRECRACKER)) {
        player.sendMessage("You need a distraction before you can switch the drinks.");
        return;
      }
      take(player, LOW_ALCOHOL_KEG, 1);
      setFlag(player, FLAG_LOW_ALCOHOL);
      player.sendMessage("You empty the keg and refill it with low alcohol beer.");
      return;
    }
    pourSeerWater(event, used, withItem);
  }

  function pourSeerWater(event, used, withItem) {
    if (trialState(event.player, SEER) < 1) return;
    const jugUsed = JUG_UNITS.has(used);
    const bucketUsed = BUCKET_UNITS.has(used);
    const jugWith = JUG_UNITS.has(withItem);
    const bucketWith = BUCKET_UNITS.has(withItem);
    if (!(jugUsed || bucketUsed) || !(jugWith || bucketWith) || jugUsed === jugWith) return;

    let sourceUnits = jugUsed ? JUG_UNITS.get(used) : BUCKET_UNITS.get(used);
    let targetUnits = jugWith ? JUG_UNITS.get(withItem) : BUCKET_UNITS.get(withItem);
    const targetCap = jugWith ? 3 : 5;
    const moved = Math.min(sourceUnits, targetCap - targetUnits);
    if (moved <= 0) {
      event.player.sendMessage("Nothing happens.");
      event.handled = true;
      return;
    }
    sourceUnits -= moved;
    targetUnits += moved;
    const sourceId = jugUsed ? JUG_BY_UNITS[sourceUnits] : BUCKET_BY_UNITS[sourceUnits];
    const targetId = jugWith ? JUG_BY_UNITS[targetUnits] : BUCKET_BY_UNITS[targetUnits];
    take(event.player, used, 1);
    take(event.player, withItem, 1);
    give(event.player, sourceId, 1);
    give(event.player, targetId, 1);
    event.handled = true;
    event.player.sendMessage(moved > 0 ? "You pour the water between the vessels." : "Nothing happens.");
  }

  function spinGoldenFleece(event) {
    if (event.itemId !== GOLDEN_FLEECE) return;
    event.handled = true;
    const { player } = event;
    if (trialState(player, BARD) < 1) return;
    if (inRellekka(player)) {
      player.sendMessage("Only Fremenniks may use this spinning wheel.");
      return;
    }
    take(player, GOLDEN_FLEECE, 1);
    give(player, GOLDEN_WOOL, 1);
    player.sendMessage("You spin the golden fleece into golden wool.");
  }

  function offerLyre(event) {
    if (event.itemId !== LYRE) return;
    event.handled = true;
    const { player } = event;
    if (trialState(player, BARD) !== 1) return;
    const fish = WORTHY_FISH.find((itemId) => held(player, itemId));
    if (!fish) {
      player.sendMessage("Fossegrimen requires a greater offering to enchant your lyre.");
      return;
    }
    take(player, fish, 1);
    take(player, LYRE, 1);
    give(player, ENCHANTED_LYRE, 1);
    player.sendMessage("Fossegrimen has enchanted your lyre so that you may play it.");
  }

  function placeFirecracker(event) {
    if (event.itemId !== LIT_STRANGE_OBJECT) return;
    event.handled = true;
    const { player } = event;
    if (!inRellekka(player)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    take(player, LIT_STRANGE_OBJECT, 1);
    setFlag(player, FLAG_FIRECRACKER);
    player.sendMessage("You put the lit strange object into the pipe.");
    player.sendMessage("You hear a loud bang from outside. It echoes through the drain.");
  }

  function addToCauldron(event) {
    const bitByItem = new Map([
      [PET_ROCK, FLAG_SOUP_ROCK],
      [CABBAGE, FLAG_SOUP_CABBAGE],
      [POTATO, FLAG_SOUP_POTATO],
      [ONION, FLAG_SOUP_ONION],
    ]);
    const bit = bitByItem.get(event.itemId);
    if (bit === undefined) return;
    event.handled = true;
    const { player } = event;
    if (trialState(player, BARD) < 1 || !inTrollCave(player)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (flag(player, bit)) {
      player.sendMessage("You already put that in the soup.");
      return;
    }
    take(player, event.itemId, 1);
    setFlag(player, bit);
    player.sendMessage(
      bit === FLAG_SOUP_ROCK
        ? "You put your pet rock into the cauldron."
        : "You put a vegetable into the cauldron."
    );
    if (soupDone(player)) player.sendMessage("Lalli's rock soup is ready to taste.");
  }

  function fillAtTap(event) {
    event.handled = true;
    const { player, itemId } = event;
    if (trialState(player, SEER) < 1) return;
    if (!inPeerHouse(player)) return;
    if (itemId === EMPTY_BUCKET || itemId === _1_5THS_FULL_BUCKET || itemId === _2_5THS_FULL_BUCKET || itemId === _3_5THS_FULL_BUCKET || itemId === _4_5THS_FULL_BUCKET) {
      take(player, itemId, 1);
      give(player, FULL_BUCKET, 1);
    } else if (itemId === EMPTY_JUG || itemId === _1_3RDS_FULL_JUG || itemId === _2_3RDS_FULL_JUG) {
      take(player, itemId, 1);
      give(player, FULL_JUG, 1);
    } else if (itemId === VASE_2) {
      take(player, VASE_2, 1);
      give(player, VASE_OF_WATER, 1);
    } else {
      return;
    }
    player.sendMessage("You fill the vessel from the tap.");
  }

  function drainSeerVessel(event) {
    event.handled = true;
    const { player, itemId } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return;
    if (BUCKET_UNITS.has(itemId)) {
      if (BUCKET_UNITS.get(itemId) === 0) {
        player.sendMessage("Your bucket is already empty.");
        return;
      }
      take(player, itemId, 1);
      give(player, EMPTY_BUCKET, 1);
    } else if (JUG_UNITS.has(itemId)) {
      if (JUG_UNITS.get(itemId) === 0) {
        player.sendMessage("Your jug is already empty.");
        return;
      }
      take(player, itemId, 1);
      give(player, EMPTY_JUG, 1);
    } else if (itemId === VASE_OF_WATER) {
      take(player, itemId, 1);
      give(player, VASE_2, 1);
    } else {
      return;
    }
    player.sendMessage("You empty the vessel down the drain.");
  }

  function freezeOnTable(event) {
    event.handled = true;
    const { player, itemId } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return;
    if (itemId === SEALED_VASE_3) {
      take(player, itemId, 1);
      give(player, FROZEN_KEY, 1);
      player.sendMessage("The water expands as it freezes, and shatters the vase.");
      player.sendMessage("You are left with a key encased in ice.");
    } else if (itemId === VASE_OF_WATER) {
      take(player, VASE_OF_WATER);
      give(player, FROZEN_VASE);
      player.sendMessage("The icy table immediately freezes the water in your vase.");
    } else if (itemId === FULL_BUCKET) {
      take(player, FULL_BUCKET, 1);
      give(player, FROZEN_BUCKET, 1);
      player.sendMessage("The icy table immediately freezes the water in your bucket.");
    } else if (itemId === FULL_JUG) {
      take(player, FULL_JUG, 1);
      give(player, FROZEN_JUG, 1);
      player.sendMessage("The icy table immediately freezes the water in your jug.");
    } else {
      player.sendMessage("Nothing interesting happens.");
    }
  }

  function meltOnRange(event) {
    event.handled = true;
    const { player, itemId } = event;
    if (trialState(player, SEER) !== 1 || !inPeerHouse(player)) return;
    if (itemId === RED_HERRING) {
      if (freeSlots(player) < 1) {
        player.sendMessage("You need another free inventory space.");
        return;
      }
      take(player, RED_HERRING);
      give(player, STICKY_RED_GOOP);
      give(player, HERRING);
      player.sendMessage("The colouring on the herring peels off as sticky red goop.");
      return;
    }
    if (itemId === FROZEN_VASE) {
      take(player, FROZEN_VASE);
      give(player, VASE_2);
      return;
    }
    if (itemId === FROZEN_KEY) {
      take(player, FROZEN_KEY, 1);
      give(player, SEERS_KEY, 1);
      player.sendMessage("The heat of the range melts the ice around the key.");
      return;
    }
    if (itemId === FROZEN_BUCKET) {
      take(player, FROZEN_BUCKET, 1);
      give(player, EMPTY_BUCKET, 1);
      player.sendMessage("You place the frozen bucket on the range. The ice turns to steam.");
      return;
    }
    if (itemId === FROZEN_JUG) {
      take(player, FROZEN_JUG, 1);
      give(player, EMPTY_JUG, 1);
      player.sendMessage("You place the frozen jug on the range. The ice turns to steam.");
      return;
    }
    player.sendMessage("Nothing interesting happens.");
  }

  function openScaleChest(event) {
    if (event.itemId !== _4_5THS_FULL_BUCKET || event.objectId !== ObjectIdentifiers.CHEST_33) return;
    event.handled = true;
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return;
    if ([VASE_2, VASE_OF_WATER, FROZEN_VASE, SEALED_VASE, SEALED_VASE_3, FROZEN_KEY, SEERS_KEY].some((id) => held(player, id))) return;
    give(player, VASE_2, 1);
    player.sendMessage("You place the bucket on the scale.");
    player.sendMessage("It is a perfect counterweight and balances precisely.");
    player.sendMessage("You take a strange looking vase out of the chest.");
  }

  function unlockSeerDoor(event) {
    if (event.itemId !== SEERS_KEY || event.objectId !== ObjectIdentifiers.DOOR_120) return;
    event.handled = true;
    const { player } = event;
    if (trialState(player, SEER) !== 1 || !inPeerHouse(player)) return;
    take(player, SEERS_KEY, 1);
    player.sendMessage("You unlock the door with your key.");
    player.sendMessage("You have successfully completed the Seer's Trial.");
    completeTrial(player, SEER);
    player.moveTo(new Location(2636, 3668, 0));
  }

  function searchSeerChest(event) {
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    if (event.objectId === ObjectIdentifiers.CHEST_33) {
      player.sendMessage("This chest is locked. Its balance is marked with the number four.");
      return;
    }
    if (!held(player, EMPTY_JUG) && !heldKind(player, JUG_UNITS)) {
      give(player, EMPTY_JUG, 1);
      player.sendMessage("You search the chest...");
      player.sendMessage("You find a jug with a number three painted on it.");
      return;
    }
    player.sendMessage("You search the chest...");
    player.sendMessage("You find nothing of interest.");
  }

  function heldKind(player, unitMap) {
    for (const itemId of unitMap.keys()) {
      if (held(player, itemId)) return itemId;
    }
    return undefined;
  }

  function searchSeerCupboard(event) {
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    if (!held(player, EMPTY_BUCKET) && !heldKind(player, BUCKET_UNITS)) {
      give(player, EMPTY_BUCKET, 1);
      player.sendMessage("You search the cupboard...");
      player.sendMessage("You find a bucket with a number five painted on it.");
      return;
    }
    player.sendMessage("You search the cupboard...");
    player.sendMessage("You find nothing of interest.");
  }

  function searchSeerBookcase(event) {
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    if (!held(player, RED_HERRING)) {
      give(player, RED_HERRING, 1);
      player.sendMessage("You search the bookcase...");
      player.sendMessage("Hidden behind some old books, you find a red herring.");
      return;
    }
    player.sendMessage("You search the bookcase...");
    player.sendMessage("You find nothing of interest.");
  }

  function searchSeerBoxes(event) {
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    if (!held(player, MAGNET_2)) {
      give(player, MAGNET_2, 1);
      player.sendMessage("You search the boxes...");
      player.sendMessage("You find a magnet hidden inside.");
      return;
    }
    if (!held(player, BLUE_THREAD)) {
      give(player, BLUE_THREAD, 1);
      player.sendMessage("You search the boxes...");
      player.sendMessage("You find some thread hidden inside.");
      return;
    }
    player.sendMessage("You search the boxes...");
    player.sendMessage("You find nothing of interest.");
  }

  function searchSeerCrate(event) {
    const { player } = event;
    if (trialState(player, SEER) < 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    if (!held(player, TOY_SHIP)) {
      give(player, TOY_SHIP, 1);
      player.sendMessage("You search the boxes...");
      player.sendMessage("You find a toy ship hidden inside.");
      return;
    }
    if (!held(player, SMALL_PICK)) {
      give(player, SMALL_PICK, 1);
      player.sendMessage("You search the boxes...");
      player.sendMessage("You find a small pick hidden inside.");
      return;
    }
    player.sendMessage("You search the boxes...");
    player.sendMessage("You find nothing of interest.");
  }

  function studySeerHead(event) {
    const { player, objectId } = event;
    if (trialState(player, SEER) !== 1 || !inPeerHouse(player)) return false;
    event.handled = true;
    const oldDisk = objectId === ObjectIdentifiers.UNICORNS_HEAD_2;
    const itemId = oldDisk ? OLD_RED_DISK : WOODEN_DISK;
    const alreadyTaken = oldDisk
      ? held(player, OLD_RED_DISK) || flag(player, FLAG_MURAL_OLD_DISK)
      : held(player, WOODEN_DISK) || held(player, RED_DISK_3) || flag(player, FLAG_MURAL_RED_DISK);
    if (alreadyTaken) return;
    give(player, itemId);
    player.sendMessage("You take a disk from the head's eye.");
  }

  function addSeerDisk(event) {
    const { player, itemId } = event;
    if (trialState(player, SEER) !== 1 || !inPeerHouse(player) || (itemId !== OLD_RED_DISK && itemId !== RED_DISK_3)) return false;
    const bit = itemId === OLD_RED_DISK ? FLAG_MURAL_OLD_DISK : FLAG_MURAL_RED_DISK;
    event.handled = true;
    if (flag(player, bit)) return;
    take(player, itemId);
    setFlag(player, bit);
    player.sendMessage("You put the red disk into the empty hole on the mural. It is a perfect fit!");
    if (flag(player, FLAG_MURAL_OLD_DISK) && flag(player, FLAG_MURAL_RED_DISK)) {
      give(player, VASE_LID);
      player.sendMessage("The centre of the mural falls out, revealing a vase lid.");
    }
  }

  function merchantTrade(player, inputId, outputId, nextStep) {
    if (!held(player, inputId) || held(player, outputId)) return false;
    take(player, inputId, 1);
    give(player, outputId, 1);
    setMerchantStep(player, nextStep);
    return true;
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (itemId === BEER || itemId === BEER_TANKARD) {
      if (npcId === COUNCIL_WORKMAN_ID) {
        event.handled = true;
        take(player, itemId, 1);
        api.emitCustomEvent("npc-dialogue:start", {
          player,
          npcId: COUNCIL_WORKMAN_ID,
          variant: V.workmanBeer,
        });
        return;
      }
    }
    if (itemId === PROMISSORY_NOTE && THORA_IDS.has(npcId)) {
      event.handled = merchantTrade(player, PROMISSORY_NOTE, LEGENDARY_COCKTAIL, M_COCKTAIL);
      return;
    }
    if (itemId === LEGENDARY_COCKTAIL && MANNI_IDS.has(npcId)) {
      event.handled = merchantTrade(player, LEGENDARY_COCKTAIL, CHAMPIONS_TOKEN, M_TOKEN);
      return;
    }
    if (itemId === CHAMPIONS_TOKEN && THORVALD_IDS.has(npcId)) {
      event.handled = merchantTrade(player, CHAMPIONS_TOKEN, WARRIORS_CONTRACT, M_CONTRACT);
      return;
    }
    if (itemId === WARRIORS_CONTRACT && PEER_IDS.has(npcId)) {
      event.handled = merchantTrade(player, WARRIORS_CONTRACT, WEATHER_FORECAST, M_FORECAST);
      return;
    }
    if (itemId === WEATHER_FORECAST && SWENSEN_IDS.has(npcId)) {
      event.handled = merchantTrade(player, WEATHER_FORECAST, SEA_FISHING_MAP, M_SEAMAP);
      return;
    }
    if (itemId === SEA_FISHING_MAP && FISHERMAN_IDS.has(npcId)) {
      event.handled = merchantTrade(player, SEA_FISHING_MAP, UNUSUAL_FISH, M_FISH);
      return;
    }
    if (itemId === UNUSUAL_FISH && SKULGRIMEN_IDS.has(npcId)) {
      event.handled = merchantTrade(player, UNUSUAL_FISH, CUSTOM_BOW_STRING, M_BOWSTRING);
      return;
    }
    if (itemId === CUSTOM_BOW_STRING && SIGLI_IDS.has(npcId)) {
      event.handled = merchantTrade(player, CUSTOM_BOW_STRING, TRACKING_MAP, M_TRACKING);
      return;
    }
    if (itemId === TRACKING_MAP && BRUNDT_IDS.has(npcId)) {
      event.handled = merchantTrade(player, TRACKING_MAP, FISCAL_STATEMENT, M_FISCAL);
      return;
    }
    if (itemId === FISCAL_STATEMENT && YRSA_IDS.has(npcId)) {
      event.handled = merchantTrade(player, FISCAL_STATEMENT, STURDY_BOOTS, M_BOOTS);
      return;
    }
    if (itemId === STURDY_BOOTS && OLAF_IDS.has(npcId)) {
      event.handled = merchantTrade(player, STURDY_BOOTS, FREMENNIK_BALLAD, M_BALLAD);
      return;
    }
    if (itemId === FREMENNIK_BALLAD && SAILOR_IDS.has(npcId)) {
      event.handled = merchantTrade(player, FREMENNIK_BALLAD, EXOTIC_FLOWER, M_FLOWER);
      return;
    }
    if (itemId === EXOTIC_FLOWER && SIGMUND_IDS.has(npcId)) {
      if (trialState(player, MERCHANT) !== 2 && held(player, EXOTIC_FLOWER)) {
        take(player, EXOTIC_FLOWER, 1);
        completeTrial(player, MERCHANT);
      }
      event.handled = true;
      return;
    }
    if (itemId === HUNTERS_TALISMAN && SIGLI_IDS.has(npcId)) {
      event.handled = true;
      completeHunterTrial(player);
      return;
    }
    if (itemId === HUNTERS_TALISMAN_2 && SIGLI_IDS.has(npcId)) {
      event.handled = true;
      player.sendMessage("The talisman is empty; the Draugen must be defeated first.");
    }
  }

  function completeHunterTrial(player) {
    if (trialState(player, HUNTER) !== 1 || !flag(player, FLAG_DRAUGEN)) return;
    if (held(player, HUNTERS_TALISMAN)) take(player, HUNTERS_TALISMAN, 1);
    if (held(player, HUNTERS_TALISMAN_2)) take(player, HUNTERS_TALISMAN_2, 1);
    player.sendMessage("Sigli takes the charged talisman.");
    completeTrial(player, HUNTER);
  }

  function locateDraugen(player) {
    if (trialState(player, HUNTER) !== 1) return;
    if (flag(player, FLAG_DRAUGEN)) {
      player.sendMessage("You have already captured the Draugen.");
      return;
    }
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: DRAUGEN_ID,
      x: location.getX() + 1,
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) npc.__skipDefaultRespawn = true;
    player.sendMessage("The Draugen is here! Beware!");
  }

  function performAtLonghall(player) {
    if (!onLonghallStage(player)) {
      player.sendMessage("You can only perform on the Rellekka longhall stage.");
      return;
    }
    if (trialState(player, BARD) !== 1) {
      player.sendMessage("You have no reason to perform here.");
      return;
    }
    player.sendMessage("You withdraw your lyre.");
    player.sendMessage("Your lyre is perfectly tuned.");
    player.sendMessage("Wow! That was awesome! You are one of the greatest bards I have ever heard!");
    if (held(player, ENCHANTED_LYRE)) {
      take(player, ENCHANTED_LYRE, 1);
      give(player, LYRE, 1);
    }
    completeTrial(player, BARD);
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if ((itemId === SEALED_VASE || itemId === SEALED_VASE_3) && option === "remove-lid") {
      if (trialState(player, SEER) !== 1 || !inPeerHouse(player)) return;
      event.handled = true;
      if (freeSlots(player) < 1) {
        player.sendMessage("You need another free inventory space.");
        return;
      }
      take(player, itemId);
      give(player, itemId === SEALED_VASE ? VASE_2 : VASE_OF_WATER);
      give(player, VASE_LID);
      return;
    }
    if (itemId === HUNTERS_TALISMAN_2 && option.includes("locate")) {
      event.handled = true;
      locateDraugen(player);
      return;
    }
    if (itemId === HUNTERS_TALISMAN && option.includes("locate")) {
      event.handled = true;
      player.sendMessage("You have already captured the Draugen.");
      return;
    }
    if (itemId === ENCHANTED_LYRE && (option.includes("play") || option.includes("perform"))) {
      event.handled = true;
      performAtLonghall(player);
    }
  }

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player) return;
    if (KOSCHEI_IDS.has(event.npcId)) {
      if (quest.getStage(player) >= STAGE_STARTED) completeTrial(player, WARRIOR);
      return;
    }
    if (event.npcId === DRAUGEN_ID) {
      if (trialState(player, HUNTER) !== 1) return;
      setFlag(player, FLAG_DRAUGEN);
      if (held(player, HUNTERS_TALISMAN_2)) {
        take(player, HUNTERS_TALISMAN_2, 1);
        give(player, HUNTERS_TALISMAN, 1);
      }
      player.sendMessage("You absorb the Draugen's essence into your talisman.");
    }
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    if (event.clickType !== 1) return;
    if (BRUNDT_IDS.has(npcId) && votesFor(player) >= VOTES_REQUIRED && !quest.isComplete(player)) {
      // The transcript's "I have seven votes" branch sits after a generic end, so it
      // can never play; replay just that branch.
      event.handled = true;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npcId,
        variant: V.brundtProgress,
        select: (steps) => steps.filter((step) => step.id === "Ve_OpV"),
      });
      return;
    }
    if (npcId === FOSSEGRIMEN_ID) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, V.fossegrimen);
      return;
    }
    if (SWENSEN_IDS.has(npcId) && trialState(player, NAVIGATOR) === 1 && flag(player, FLAG_NAVIGATOR)) {
      completeTrial(player, NAVIGATOR);
      return;
    }
    if (SIGLI_IDS.has(npcId) && trialState(player, HUNTER) === 1) completeHunterTrial(player);
  }

  /** Opens the east trapdoor by swapping in the already-open variant. */
  function openPeerTrapdoor(event) {
    event.handled = true;
    const object = event.object;
    if (!object) return;
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        ObjectIdentifiers.TRAPDOOR_14,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === ObjectIdentifiers.LADDER_32 && event.clickType === 1) {
      event.handled = true;
      if (trialState(player, NAVIGATOR) === 0) {
        player.sendMessage("You must accept Swensen's challenge before entering his maze.");
      } else if (trialState(player, NAVIGATOR) === 2) {
        player.sendMessage("No way am I doing that maze again!");
      } else {
        player.moveTo(new Location(2631, 10006, 0));
      }
      return;
    }
    if (inBox(player, 2625, 2671, 9999, 10044) && player.getLocation().getZ() === 0 && event.clickType === 1) {
      const destination = MAZE_PORTALS.get(objectId);
      if (destination) {
        event.handled = true;
        player.moveTo(new Location(destination[0], destination[1], 0));
        return;
      }
      if (objectId === ObjectIdentifiers.LADDER_33 || objectId === ObjectIdentifiers.LADDER_34 || objectId === ObjectIdentifiers.ESCAPE_ROPE) {
        event.handled = true;
        if (objectId === ObjectIdentifiers.LADDER_34 && trialState(player, NAVIGATOR) === 1) {
          setFlag(player, FLAG_NAVIGATOR);
          player.sendMessage("You have finished Swensen's maze. Tell him of your success.");
        }
        player.moveTo(new Location(2644, 3658, 0));
        return;
      }
    }
    if ((objectId === ObjectIdentifiers.DOOR_119 || objectId === ObjectIdentifiers.DOOR_120) && event.clickType === 1) {
      event.handled = true;
      const location = player.getLocation();
      if (location.getY() < 3667) {
        if (objectId === ObjectIdentifiers.DOOR_120) {
          if (held(player, SEERS_KEY)) unlockSeerDoor({ ...event, itemId: SEERS_KEY });
          else player.sendMessage("This door is locked tightly shut.");
        } else {
          api.sendMultiChatboxPrompt(player, "Leaving this way fails the trial. Leave?",
            "Leave", () => leaveSeerHouse(player), "Stay", () => {});
        }
        return;
      }
      if (trialState(player, SEER) !== 1 || objectId === ObjectIdentifiers.DOOR_120) {
        player.sendMessage("This door is locked tightly shut.");
        return;
      }
      if (carryingAnything(player)) {
        player.sendMessage("You must bank all your items and equipment before entering Peer's house.");
        return;
      }
      // shortcut: the entrance uses the life riddle; add selection if varied riddles are needed.
      player.sendMessage("My first is in the well, but not at sea. My second in 'I', but not in 'me'.");
      player.sendMessage("My third is in flies, but insects not found. My last is in earth, but not in the ground.");
      player.sendMessage("My whole when stolen from you, causes you death. What am I?");
      player.setEnteredSyntaxAction({ execute: (answer) => {
        if (trialState(player, SEER) !== 1 || !player.getLocation().equals(location)) return;
        if (String(answer).trim().toLowerCase() !== "life") {
          player.sendMessage("You have failed to solve the riddle.");
          return;
        }
        if (carryingAnything(player)) return;
        setFlag(player, FLAG_SEER_RIDDLE);
        player.sendMessage("You have solved the riddle!");
        player.moveTo(new Location(2631, 3666, 0));
      } });
      player.getPacketSender().sendEnterInputPrompt("What is the four-letter answer?");
      return;
    }
    if (inPeerHouse(player) && event.clickType === 1) {
      const location = player.getLocation();
      if (PEER_LADDER_IDS.has(objectId) && location.getZ() === 0) {
        event.handled = true;
        player.moveTo(new Location(location.getX(), location.getY(), PEER_PUZZLE_FLOOR));
        return;
      }
      if (PEER_TRAPDOOR_IDS.has(objectId) && location.getZ() === PEER_PUZZLE_FLOOR) {
        if (objectId === ObjectIdentifiers.TRAPDOOR_15) {
          openPeerTrapdoor(event);
          return;
        }
        event.handled = true;
        player.moveTo(new Location(location.getX(), location.getY(), 0));
        return;
      }
    }
    if (objectId === SWAYING_TREE_ID) {
      event.handled = true;
      if (trialState(player, BARD) !== 1) {
        player.sendMessage("You have no reason to chop this tree.");
        return;
      }
      if (skill(player, Skill.WOODCUTTING) < 40) {
        player.sendMessage("You need a Woodcutting level of 40 to chop a branch from this tree.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("You do not have enough free space in your inventory to chop this tree.");
        return;
      }
      give(player, BRANCH, 1);
      player.sendMessage("You cut a branch from the strangely musical tree.");
      return;
    }
    if (STALL_IDS.has(objectId) && !quest.isComplete(player)) {
      event.handled = true;
      player.sendMessage(
        "The fishmonger is staring at you suspiciously. You cannot steal from his stall while he distrusts you."
      );
    }
  }

  function handleLonghallDoor(event) {
    const { player, location } = event;
    if (event.objectId !== ObjectIdentifiers.DOOR_118 || event.clickType !== 1 ||
        location.x !== 2667 || location.y !== 3683 || location.z !== 0) return;
    event.handled = true;
    const entering = player.getLocation().getX() >= 2667;
    if (entering && !held(player, ENCHANTED_LYRE) && trialState(player, BARD) !== 2 && !quest.isComplete(player)) {
      player.sendMessage("The bouncer won't let you backstage without an enchanted lyre.");
      return;
    }
    // This cache door has no open variant; cross its west-facing wall after the bouncer's check.
    player.moveTo(new Location(entering ? 2666 : 2667, 3683, 0));
  }

  function handlePeerDoor(event) {
    // These two puzzle doors must run before the generic wall-door opener.
    if (event.objectId === ObjectIdentifiers.DOOR_119 || event.objectId === ObjectIdentifiers.DOOR_120) {
      handleObjectInteraction(event);
    }
  }

  function leaveSeerHouse(player) {
    if (!inPeerHouse(player) || player.getLocation().getZ() !== 0) return;
    for (const itemId of [
      ...BUCKET_UNITS.keys(), ...JUG_UNITS.keys(), VASE_2, VASE_OF_WATER, FROZEN_VASE,
      VASE_LID, SEALED_VASE, SEALED_VASE_3, FROZEN_KEY, SEERS_KEY, RED_HERRING,
      STICKY_RED_GOOP, OLD_RED_DISK, WOODEN_DISK, RED_DISK_3, MAGNET_2, BLUE_THREAD, SMALL_PICK, TOY_SHIP,
    ]) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) take(player, itemId, amount);
    }
    setFlag(player, FLAG_SEER_RIDDLE, false);
    setFlag(player, FLAG_MURAL_OLD_DISK, false);
    setFlag(player, FLAG_MURAL_RED_DISK, false);
    player.moveTo(new Location(2631, 3668, 0));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(TRIALS_ATTRIBUTE);
  api.persistAttribute(MERCHANT_ATTRIBUTE);
  api.persistAttribute(FLAGS_ATTRIBUTE);

  // QH 06da90: viking 1..7 are trials, 8 awaits Brundt, and the cache completes at 10.
  // Saved stage 7 was capped before the seventh vote; its durable trial bits disambiguate it.
  function nativeProgress(stage, player) {
    if (stage >= STAGE_COMPLETE) return 10;
    if (stage <= 0) return 0;
    return Math.max(stage, Math.min(8, 1 + votesFor(player)));
  }

  quest = registerQuest(api, {
    key: "fremennik_trials",
    name: "The Fremennik Trials",
    varpId: VARP_FREMENNIK_TRIALS,
    varpValue: nativeProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 2812.4, label: "Agility" },
      { skillId: Skill.ATTACK.getIndex(), amount: 2812.4, label: "Attack" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 2812.4, label: "Crafting" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 2812.4, label: "Defence" },
      { skillId: Skill.FISHING.getIndex(), amount: 2812.4, label: "Fishing" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 2812.4, label: "Fletching" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 2812.4, label: "Hitpoints" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 2812.4, label: "Strength" },
      { skillId: Skill.THIEVING.getIndex(), amount: 2812.4, label: "Thieving" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 2812.4, label: "Woodcutting" },
    ],
    rewardItemId: FREMENNIK_BLADE,
    rewardItemLabel: "A Fremennik blade",
    otherRewards: [
      "Access to Rellekka and the Fremennik facilities",
      "A Fremennik name",
      "The ability to wield the Fremennik blade",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:line", offerPeerBankAgain);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onItemOnObject("Golden fleece", "Spinning wheel", spinGoldenFleece);
  api.onItemOnObject("Lyre", "Strange altar", offerLyre);
  api.onItemOnObject("Lit strange object", "Pipe", placeFirecracker);
  api.onItemOnObject("Pet rock", "Lalli's Stew", addToCauldron);
  api.onItemOnObject("Cabbage", "Lalli's Stew", addToCauldron);
  api.onItemOnObject("Potato", "Lalli's Stew", addToCauldron);
  api.onItemOnObject("Onion", "Lalli's Stew", addToCauldron);
  api.onItemOnObject("Empty bucket", "Tap", fillAtTap);
  api.onItemOnObject("Empty jug", "Tap", fillAtTap);
  api.onItemOnObject("Vase", "Tap", fillAtTap);
  api.onItemOnObject("1/5ths full bucket", "Tap", fillAtTap);
  api.onItemOnObject("2/5ths full bucket", "Tap", fillAtTap);
  api.onItemOnObject("3/5ths full bucket", "Tap", fillAtTap);
  api.onItemOnObject("4/5ths full bucket", "Tap", fillAtTap);
  api.onItemOnObject("1/3rds full jug", "Tap", fillAtTap);
  api.onItemOnObject("2/3rds full jug", "Tap", fillAtTap);
  api.onItemOnObject("Empty bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("Empty jug", "Drain", drainSeerVessel);
  api.onItemOnObject("Full bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("1/5ths full bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("2/5ths full bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("3/5ths full bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("4/5ths full bucket", "Drain", drainSeerVessel);
  api.onItemOnObject("Full jug", "Drain", drainSeerVessel);
  api.onItemOnObject("1/3rds full jug", "Drain", drainSeerVessel);
  api.onItemOnObject("2/3rds full jug", "Drain", drainSeerVessel);
  api.onItemOnObject("Vase of water", "Drain", drainSeerVessel);
  api.onItemOnObject("4/5ths full bucket", "Chest", openScaleChest);
  api.onItemOnObject("Vase of water", "Frozen table", freezeOnTable);
  api.onItemOnObject("Sealed vase", "Frozen table", freezeOnTable);
  api.onItemOnObject("Full bucket", "Frozen table", freezeOnTable);
  api.onItemOnObject("Full jug", "Frozen table", freezeOnTable);
  api.onItemOnObject("Frozen key", "Cooking range", meltOnRange);
  api.onItemOnObject("Frozen bucket", "Cooking range", meltOnRange);
  api.onItemOnObject("Frozen jug", "Cooking range", meltOnRange);
  api.onItemOnObject("Frozen vase", "Cooking range", meltOnRange);
  api.onItemOnObject("Red herring", "Cooking range", meltOnRange);
  api.onItemOnObject("Old red disk", "Abstract mural", addSeerDisk);
  api.onItemOnObject("Red disk", "Abstract mural", addSeerDisk);
  api.onItemOnObject("Seer's key", "Door", unlockSeerDoor);
  api.onObjectInteraction(handleObjectInteraction);
  api.onBeforeObjectInteraction(handleLonghallDoor);
  api.onBeforeObjectInteraction(handlePeerDoor);
  api.onObjectInteraction("Chest", { Open: searchSeerChest, Search: searchSeerChest });
  api.onObjectInteraction("Cupboard", { Open: searchSeerCupboard, Search: searchSeerCupboard });
  api.onObjectInteraction("Bookcase", { Search: searchSeerBookcase });
  api.onObjectInteraction("Boxes", { Search: searchSeerBoxes });
  api.onObjectInteraction("Crate", { Search: searchSeerCrate });
  api.onObjectInteraction("Unicorn's head", { Study: studySeerHead });
  api.onObjectInteraction("Bull's head", { Study: studySeerHead });
  api.onPlayerLogin(handleLogin);
};
