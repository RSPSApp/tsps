/**
 * The Fremennik Isles (members).
 *
 * The words come from the "The Fremennik Isles" transcript page; this plugin
 * supplies the variant selector for the indexed quest NPCs, the Talk-to
 * interception for the scenes whose variants are not indexed to their speaker
 * (King Gjuki Sorvott IV, Mawnis Burowgar's spawn, Kjedelig/Trogen), the prose
 * condition answers (item/outfit/inventory checks and the tax quiz), the
 * ferry/teleport actions, the jester chest, the bridge repairs, the tax
 * collection rounds, the yakhide/shield crafting, the troll cave and Troll King
 * fight, and the completion reward.
 *
 * Stage varbit: 3311 "fris_quest" (varp 970, bits 0-9). Evidence: cache
 * gameval dump ("3311 fris_quest varp=970 bits=0-9"); cache dbTable 0 row 56
 * ("Fremennik Isles, The") column 19 stores the completion value 340, and cs2
 * script 4024 (the quest list's quest-id -> progress map) case 56 reads varbit
 * 3311. Sibling bits of varp 970 (3312 fris_task, 3313-3317 fris_m_b3..b5/king/
 * missiontype, 3319 fris_jatiszo_mine_visited, 3320-3326 tax bits) are left
 * alone; stage writes use sendVarbit so they survive.
 *
 * Stages (values 1..20, complete 340):
 *   1  started (Mord accepted)
 *   2  tuna task (first talk with King Sorvott)
 *   3  ore task (Hrafn fed)
 *   4  ores delivered (jester chest open, mission explained)
 *   5  Slug briefed the jester mission (outfit worn, ready)
 *   6  first performance done (report to Slug)
 *   7  Slug quiz passed (gain the Burgher's trust; rope task)
 *   8  ropes delivered (split log task)
 *   9  split logs delivered (bridges repairable)
 *   10 both bridges repaired (Mawnis told the plan; sent to Jatizso)
 *   11 window tax bag received
 *   12 window taxes returned (beard tax active)
 *   13 beard taxes returned (sent back to Slug)
 *   14 second performance reported (King rant pending)
 *   15 royal decree received
 *   16 decree delivered (yakhide armour rites)
 *   17 full yakhide armour made (shield instructions)
 *   18 oaths sworn (Champion of Neitiznot)
 *   19 ten frenzied trolls killed
 *   20 Troll King's head taken
 *   340 complete (dbTable 0 row 56 column 19)
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 5,000 Construction, 5,000 Crafting
 * and 10,000 Woodcutting XP, two lots of 10,000 combat XP (Attack, Strength,
 * Defence or Hitpoints) and the Helm of Neitiznot.
 *
 * Sources: OSRS Wiki "The Fremennik Isles", its Quick guide and Transcript
 * page; the cache for every id, varbit and placement.
 *
 * Gaps / approximations:
 *  - The jester control-panel interface does not exist here, so the two
 *    performances play the wiki's instruction/overheard-plans/success lines as
 *    chained cutscenes (mawnis-instructions + honour-guard + friedleif plans +
 *    after-a-successful-performance) and always succeed; the -again variants
 *    that only "jump above" reuse the first performance's lines.
 *  - King Sorvott, Mawnis, Kjedelig and Trogen are played through this plugin's
 *    own Talk-to interception because their quest variants are not indexed to
 *    their NPC ids; their post-quest own-page dialogues still play when this
 *    plugin returns no variant (indexed NPCs only).
 *  - The window/beard tax's number-entry step is absent, so the "right amount"
 *    condition is answered true and the too low/high ones false.
 *  - The tax bag is tracked in the persisted "quest.the_fremennik_isles.tax"
 *    attribute and mirrored onto the 5 cache tax bag items (0/10k/20k/29k
 *    thresholds); its Check option prints the exact wiki line.
 *  - Thorkel's alternative ore hand-in (starting-off-ore-delivery-talking-to-
 *    thorkel) is not wired to consume ore; the King's hand-in is the path.
 *  - The Ice Troll King (5822) has no spawn in npc-spawns.json: he is spawned
 *    owner-only south of the cave bridge once the player has killed 10 frenzied
 *    trolls, at (2392,10244,1) (the lair tiles across the bridge); the head is
 *    granted on his death rather than cut from a corpse object (21622 is not
 *    placed in this cache).
 *  - Bridges keep their broken appearance after Repair (the swap object has no
 *    placement here); clicking Walk-across on a repaired bridge moves the
 *    player over it. The 56 Woodcutting gate on the shield is not enforced (the
 *    shop path does not need it); rope spinning enforces Crafting 30 with a
 *    system message. The chest, splitting, curing, shield-making and head-taking
 *    steps use short system messages where the wiki transcript has no line.
 *  - The weapon/shield "hands free" check follows Cold War: WEAPON_SLOT and
 *    SHIELD_SLOT empty.
 *
 * ponytail: the tax input step, the jester interface and the Troll King corpse
 * are approximated as above; upgrade paths are the real interfaces/objects if
 * those are ever added.
 */
module.exports = function registerTheFremennikIslesQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Fremennik Isles";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const MAWNIS_BUROWGAR = NpcIdentifiers.MAWNIS_BUROWGAR; // 1878
  const MAWNIS_BUROWGAR_2 = NpcIdentifiers.MAWNIS_BUROWGAR_2; // 1879
  const MAWNIS_BUROWGAR_3 = NpcIdentifiers.MAWNIS_BUROWGAR_3; // 2980
  // Nameless spawn parent (transforms to 1878/1879 with the fris_m_b3-b5 bits).
  const MAWNIS_BUROWGAR_SPAWN = 2979;
  const MAWNIS_IDS = new Set([
    MAWNIS_BUROWGAR,
    MAWNIS_BUROWGAR_2,
    MAWNIS_BUROWGAR_3,
    MAWNIS_BUROWGAR_SPAWN,
  ]);
  const FRIDLEIF_IDS = new Set([
    NpcIdentifiers.FRIDLEIF_SHIELDSON, // 1880
    NpcIdentifiers.FRIDLEIF_SHIELDSON_2, // 2983
  ]);
  const THAKKRAD_IDS = new Set([
    NpcIdentifiers.THAKKRAD_SIGMUNDSON, // 1881
    NpcIdentifiers.THAKKRAD_SIGMUNDSON_2, // 2984
  ]);
  const MARIA_RELLEKKA = NpcIdentifiers.MARIA_GUNNARS_2; // 1883
  const MARIA_NEITIZNOT = NpcIdentifiers.MARIA_GUNNARS; // 1882
  const MORD_RELLEKKA = NpcIdentifiers.MORD_GUNNARS; // 1900
  const MORD_JATIZSO = NpcIdentifiers.MORD_GUNNARS_2; // 1940
  const MORD_IDS = new Set([MORD_RELLEKKA, MORD_JATIZSO]);

  /** Hands an ordinary crossing to the Ferries plugin's captured trip; without it, the plain move. */
  function ferry(player, route, fallback) {
    const request = { player, route, handled: false };
    api.emitCustomEvent("ferries:travel", request);
    if (!request.handled) player.moveTo(fallback);
  }
  const SLUG_HEMLIGSSEN = NpcIdentifiers.SLUG_HEMLIGSSEN; // 1895
  const KING_GJUKI_SORVOTT_IV = NpcIdentifiers.KING_GJUKI_SORVOTT_IV; // 1897
  const HRH_HRAFN = NpcIdentifiers.HRH_HRAFN; // 1898
  const KJEDELIG_UPPSEN = NpcIdentifiers.KJEDELIG_UPPSEN; // 1893
  const TROGEN_KONUNGARDE = NpcIdentifiers.TROGEN_KONUNGARDE; // 1894
  const HRING_HRING = NpcIdentifiers.HRING_HRING; // 1941
  const FLOSI_DALKSSON = NpcIdentifiers.FLOSI_DALKSSON; // 1942
  const RAUM_URDA_STEIN = NpcIdentifiers.RAUM_URDA_STEIN; // 1943
  const SKULI_MYRKA = NpcIdentifiers.SKULI_MYRKA; // 1944
  const KEEPA_KETTILON = NpcIdentifiers.KEEPA_KETTILON; // 1945
  const VANLIGGA_GASTFRIHET = NpcIdentifiers.VANLIGGA_GASTFRIHET; // 1990
  const ERIC = NpcIdentifiers.ERIC_3; // 1997
  const BRENDT = NpcIdentifiers.BRENDT; // 1999
  const GRUNDT = NpcIdentifiers.GRUNDT; // 2000
  const GUARD_IDS = new Set([
    NpcIdentifiers.GUARD_32, // 1949
    NpcIdentifiers.GUARD_33, // 1950
    NpcIdentifiers.GUARD_105, // 7437
    NpcIdentifiers.GUARD_106, // 7438
  ]);
  const HONOUR_GUARD_IDS = new Set([
    NpcIdentifiers.HONOUR_GUARD, // 1889
    NpcIdentifiers.HONOUR_GUARD_2, // 1890
    NpcIdentifiers.HONOUR_GUARD_3, // 1891
    NpcIdentifiers.HONOUR_GUARD_4, // 1892
  ]);
  const BORK_SIGMUNDSON = NpcIdentifiers.BORK_SIGMUNDSON; // 5827
  const ICE_TROLL_KING = NpcIdentifiers.ICE_TROLL_KING; // 5822
  const FRENZIED_TROLL_IDS = new Set([
    NpcIdentifiers.FRENZIED_ICE_TROLL_RUNT, // 5823
    NpcIdentifiers.FRENZIED_ICE_TROLL_MALE, // 5824
    NpcIdentifiers.FRENZIED_ICE_TROLL_FEMALE, // 5825
    NpcIdentifiers.FRENZIED_ICE_TROLL_GRUNT, // 5826
  ]);
  const TAX_NPC_IDS = new Set([
    HRING_HRING,
    FLOSI_DALKSSON,
    RAUM_URDA_STEIN,
    SKULI_MYRKA,
    KEEPA_KETTILON,
    VANLIGGA_GASTFRIHET,
    ERIC,
    BRENDT,
    GRUNDT,
  ]);
  const JESTER_MERCHANTS = new Set([SKULI_MYRKA, RAUM_URDA_STEIN, HRING_HRING]);

  const RAW_TUNA = ItemIdentifiers.RAW_TUNA; // 359
  const TUNA = ItemIdentifiers.TUNA; // 361
  const TIN_ORE = ItemIdentifiers.TIN_ORE; // 438
  const COAL = ItemIdentifiers.COAL; // 453
  const MITHRIL_ORE = ItemIdentifiers.MITHRIL_ORE; // 447
  const ROPE = ItemIdentifiers.ROPE; // 954
  const KNIFE = ItemIdentifiers.KNIFE; // 946
  const SPLIT_LOG = ItemIdentifiers.SPLIT_LOG; // 10812
  const ARCTIC_PINE_LOGS = ItemIdentifiers.ARCTIC_PINE_LOGS; // 10810
  const HAIR = ItemIdentifiers.HAIR; // 10814, yak hair
  const YAK_HIDE = ItemIdentifiers.YAK_HIDE; // 10818
  const CURED_YAK_HIDE = ItemIdentifiers.CURED_YAK_HIDE; // 10820
  const YAK_HIDE_BODY = ItemIdentifiers.YAK_HIDE_ARMOUR; // 10822 (top)
  const YAK_HIDE_LEGS = ItemIdentifiers.YAK_HIDE_ARMOUR_3; // 10824
  const NEITIZNOT_SHIELD = ItemIdentifiers.NEITIZNOT_SHIELD; // 10826
  const HELM_OF_NEITIZNOT = ItemIdentifiers.HELM_OF_NEITIZNOT; // 10828
  const ROYAL_DECREE = ItemIdentifiers.ROYAL_DECREE; // 10830
  const EMPTY_TAX_BAG = ItemIdentifiers.EMPTY_TAX_BAG; // 10831
  const LIGHT_TAX_BAG = ItemIdentifiers.LIGHT_TAX_BAG; // 10832
  const NORMAL_TAX_BAG = ItemIdentifiers.NORMAL_TAX_BAG; // 10833
  const HEFTY_TAX_BAG = ItemIdentifiers.HEFTY_TAX_BAG; // 10834
  const BULGING_TAX_BAG = ItemIdentifiers.BULGING_TAXBAG; // 10835
  const TAX_BAG_IDS = new Set([
    EMPTY_TAX_BAG,
    LIGHT_TAX_BAG,
    NORMAL_TAX_BAG,
    HEFTY_TAX_BAG,
    BULGING_TAX_BAG,
  ]);
  const JESTER_HAT = ItemIdentifiers.SILLY_JESTER_HAT; // 10836
  const JESTER_TOP = ItemIdentifiers.SILLY_JESTER_TOP; // 10837
  const JESTER_TIGHTS = ItemIdentifiers.SILLY_JESTER_TIGHTS; // 10838
  const JESTER_BOOTS = ItemIdentifiers.SILLY_JESTER_BOOTS; // 10839
  const TROLL_HEAD = ItemIdentifiers.DECAPITATED_HEAD_3; // 10842
  const COINS = ItemIdentifiers.COINS; // 995
  const CABBAGE = ItemIdentifiers.CABBAGE; // 1965
  const NEEDLE = ItemIdentifiers.NEEDLE; // 1733
  const THREAD = ItemIdentifiers.THREAD; // 1734
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const BRONZE_NAILS = ItemIdentifiers.BRONZE_NAILS; // 4819
  const STRENGTH_POTION_4 = ItemIdentifiers.STRENGTH_POTION_4_; // 113
  const PRAYER_POTION_3 = ItemIdentifiers.PRAYER_POTION_3_; // 139

  const JESTER_CHEST = ObjectIdentifiers.CHEST_70; // 21299
  const SPINNING_WHEEL = ObjectIdentifiers.SPINNING_WHEEL_5; // 21304
  const WOODCUTTING_STUMP = ObjectIdentifiers.WOODCUTTING_STUMP; // 21305
  const WEST_BRIDGE_IDS = new Set([
    ObjectIdentifiers.ROPE_BRIDGE_6, // 21310
    ObjectIdentifiers.ROPE_BRIDGE_7, // 21311
  ]);
  const MIDDLE_BRIDGE_IDS = new Set([
    ObjectIdentifiers.ROPE_BRIDGE_8, // 21312
    ObjectIdentifiers.ROPE_BRIDGE_9, // 21313
  ]);
  const RUNITE_BRIDGE_IDS = new Set([
    ObjectIdentifiers.ROPE_BRIDGE_10, // 21314
    ObjectIdentifiers.ROPE_BRIDGE_11, // 21315
  ]);
  const CAVE_BRIDGE_IDS = new Set([
    ObjectIdentifiers.ROPE_BRIDGE_14, // 21318
    ObjectIdentifiers.ROPE_BRIDGE_15, // 21319
  ]);
  const EAST_CAVE = ObjectIdentifiers.CAVE_30; // 21584
  const WEST_CAVE = ObjectIdentifiers.CAVE_31; // 21585
  const MIDDLE_CAVE = ObjectIdentifiers.CAVE_32; // 21586

  const VARP_FREMENNIK_ISLES = 970; // "fris_quest" parent; bits 0-9 carry the stage
  const VARBIT_STAGE = 3311; // fris_quest

  const STAGE_STARTED = 1;
  const STAGE_TUNA_TASK = 2;
  const STAGE_ORE_TASK = 3;
  const STAGE_ORES_DELIVERED = 4;
  const STAGE_JESTER_MISSION = 5;
  const STAGE_PERFORMED = 6;
  const STAGE_SPY_REPORTED = 7;
  const STAGE_ROPES_DELIVERED = 8;
  const STAGE_LOGS_DELIVERED = 9;
  const STAGE_BRIDGES_REPAIRED = 10;
  const STAGE_WINDOW_TAX = 11;
  const STAGE_WINDOW_PAID = 12;
  const STAGE_BEARD_PAID = 13;
  const STAGE_JESTER_AGAIN = 14;
  const STAGE_DECREE = 15;
  const STAGE_DECREE_DELIVERED = 16;
  const STAGE_ARMOUR_DONE = 17;
  const STAGE_CHAMPION = 18;
  const STAGE_TEN_TROLLS = 19;
  const STAGE_HEAD_TAKEN = 20;
  const STAGE_COMPLETE = 340; // dbTable 0 row 56 column 19

  const CHEST_ATTRIBUTE = "quest.the_fremennik_isles.chest";
  const PERFORMANCES_ATTRIBUTE = "quest.the_fremennik_isles.performances";
  const MISSION_ATTRIBUTE = "quest.the_fremennik_isles.mission";
  const MISSION2_ATTRIBUTE = "quest.the_fremennik_isles.mission2";
  const QUIZ1_ATTRIBUTE = "quest.the_fremennik_isles.quiz1";
  const QUIZ2_ATTRIBUTE = "quest.the_fremennik_isles.quiz2";
  const BRIDGES_ATTRIBUTE = "quest.the_fremennik_isles.bridges";
  const TAX_ATTRIBUTE = "quest.the_fremennik_isles.tax";
  const WINDOW_TAXES_ATTRIBUTE = "quest.the_fremennik_isles.window-taxes";
  const BEARD_TAXES_ATTRIBUTE = "quest.the_fremennik_isles.beard-taxes";
  const VANLIGGA_ATTRIBUTE = "quest.the_fremennik_isles.vanligga"; // 0 none, 1 collected, 2 paid, 4 refunded
  const BORK_ATTRIBUTE = "quest.the_fremennik_isles.bork";
  const TROLL_KILLS_ATTRIBUTE = "quest.the_fremennik_isles.troll-kills";

  const TAX_FLAG_FLOSI = 1 << 0;
  const TAX_FLAG_KEEPA = 1 << 1;
  const TAX_FLAG_VANLIGGA = 1 << 2;
  const TAX_FLAG_SKULI = 1 << 3;
  const TAX_FLAG_RAUM = 1 << 4;
  const TAX_FLAG_HRING = 1 << 5;
  const WINDOW_TAX_MASK =
    TAX_FLAG_FLOSI | TAX_FLAG_KEEPA | TAX_FLAG_VANLIGGA | TAX_FLAG_SKULI | TAX_FLAG_RAUM;
  const BEARD_TAX_MASK =
    TAX_FLAG_FLOSI | TAX_FLAG_KEEPA | TAX_FLAG_SKULI | TAX_FLAG_RAUM | TAX_FLAG_HRING;

  const BRIDGE_WEST = 1;
  const BRIDGE_MIDDLE = 2;

  const BORK_FOOD = 1;
  const BORK_STRENGTH = 2;
  const BORK_PRAYER = 4;

  const START_HOOK = "quest:the-fremennik-isles:start";

  // Ferry / teleport tiles (the spawn tiles of each ferryman's dock).
  const JATIZSO_LANDING = new Location(2419, 3785, 0);
  const RELLEKKA_LANDING = new Location(2646, 3712, 0);
  const NEITIZNOT_LANDING = new Location(2314, 3784, 0);
  const CAVE_LANDING = new Location(2394, 10288, 1);
  // The cave and its lair only exist on plane 1. 2394,10252 is the free tile
  // under the rope bridge; 2397,10252 was inside the surrounding ice.
  const LAIR_LANDING = new Location(2394, 10252, 1);
  const KING_LAIR_TILE = new Location(2392, 10244, 1);

  const WRONG_QUIZ1 = new Set([
    "They are ready now.",
    "They will be ready tomorrow.",
    "Sixteen militia have been trained.",
    "Eighteen militia have been trained.",
    "There are three bridges to repair.",
    "There are four bridges to repair.",
  ]);
  const WRONG_QUIZ2 = new Set([
    "They are in a secluded bay, near Miscellania.",
    "They are in a secluded bay, near Rellekka.",
    "They will be given some fine ale and meat.",
    "They will be given some party hats and balloons.",
    "Chieftain Brundt of Rellekka has been helping Neitiznot.",
    "Advisor Ghrim of Miscellania has been helping Neitiznot.",
  ]);

  const WINDOW_TAX_VARIANTS = new Map([
    [FLOSI_DALKSSON, { flag: TAX_FLAG_FLOSI, variant: "return-to-jatizso-tax-time-windows-flosi-dalksson" }],
    [KEEPA_KETTILON, { flag: TAX_FLAG_KEEPA, variant: "return-to-jatizso-tax-time-windows-keepa-kettilon" }],
    [VANLIGGA_GASTFRIHET, { flag: TAX_FLAG_VANLIGGA, variant: "return-to-jatizso-tax-time-windows-vanligga-gastfrihet" }],
    [SKULI_MYRKA, { flag: TAX_FLAG_SKULI, variant: "return-to-jatizso-tax-time-windows-skuli-myrka" }],
    [RAUM_URDA_STEIN, { flag: TAX_FLAG_RAUM, variant: "return-to-jatizso-tax-time-windows-raum-urda-stein" }],
  ]);
  const BEARD_TAX_VARIANTS = new Map([
    [RAUM_URDA_STEIN, { flag: TAX_FLAG_RAUM, variant: "return-to-jatizso-tax-time-beards-raum-urda-stein" }],
    [FLOSI_DALKSSON, { flag: TAX_FLAG_FLOSI, variant: "return-to-jatizso-tax-time-beards-flosi-dalksson" }],
    [HRING_HRING, { flag: TAX_FLAG_HRING, variant: "return-to-jatizso-tax-time-beards-hring-hring" }],
    [SKULI_MYRKA, { flag: TAX_FLAG_SKULI, variant: "return-to-jatizso-tax-time-beards-skuli-myrka" }],
    [KEEPA_KETTILON, { flag: TAX_FLAG_KEEPA, variant: "return-to-jatizso-tax-time-beards-keepa-kettilon" }],
  ]);
  const AFTER_TAX_VARIANTS = new Map([
    [VANLIGGA_GASTFRIHET, "return-to-jatizso-returning-with-beard-taxes-talking-to-vanligga"],
    [KEEPA_KETTILON, "return-to-jatizso-returning-with-beard-taxes-talking-to-keepa"],
    [SKULI_MYRKA, "return-to-jatizso-returning-with-beard-taxes-talking-to-skuli-flosi-raum-hring"],
    [FLOSI_DALKSSON, "return-to-jatizso-returning-with-beard-taxes-talking-to-skuli-flosi-raum-hring"],
    [RAUM_URDA_STEIN, "return-to-jatizso-returning-with-beard-taxes-talking-to-skuli-flosi-raum-hring"],
    [HRING_HRING, "return-to-jatizso-returning-with-beard-taxes-talking-to-skuli-flosi-raum-hring"],
  ]);

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function isFull(player) {
    return player.getInventory().isFull?.() === true;
  }

  function equipped(player, slot) {
    return player.getEquipment().get(slot)?.getId?.();
  }

  function jesterWorn(player) {
    return (
      equipped(player, Equipment.HEAD_SLOT) === JESTER_HAT &&
      equipped(player, Equipment.BODY_SLOT) === JESTER_TOP &&
      equipped(player, Equipment.LEG_SLOT) === JESTER_TIGHTS &&
      equipped(player, Equipment.FEET_SLOT) === JESTER_BOOTS
    );
  }

  function handsFree(player) {
    const empty = (slot) => {
      const id = equipped(player, slot);
      return !id || id < 1;
    };
    return empty(Equipment.WEAPON_SLOT) && empty(Equipment.SHIELD_SLOT);
  }

  function performanceCount(player) {
    return Number(player.getAttribute(PERFORMANCES_ATTRIBUTE)) || 0;
  }

  function addPerformance(player) {
    player.setAttribute(PERFORMANCES_ATTRIBUTE, performanceCount(player) + 1);
  }

  function hasFlag(player, attribute, bit) {
    return (Number(player.getAttribute(attribute)) || 0) & bit;
  }

  function setFlag(player, attribute, bit) {
    player.setAttribute(attribute, (Number(player.getAttribute(attribute)) || 0) | bit);
  }

  function bridgesRepaired(player) {
    return (Number(player.getAttribute(BRIDGES_ATTRIBUTE)) || 0) & (BRIDGE_WEST | BRIDGE_MIDDLE);
  }

  function bothBridges(player) {
    return bridgesRepaired(player) === (BRIDGE_WEST | BRIDGE_MIDDLE);
  }

  function taxAmount(player) {
    return Number(player.getAttribute(TAX_ATTRIBUTE)) || 0;
  }

  function taxMask(player, attribute) {
    return Number(player.getAttribute(attribute)) || 0;
  }

  function windowTaxesDone(player) {
    return (taxMask(player, WINDOW_TAXES_ATTRIBUTE) & WINDOW_TAX_MASK) === WINDOW_TAX_MASK;
  }

  function beardTaxesDone(player) {
    return (taxMask(player, BEARD_TAXES_ATTRIBUTE) & BEARD_TAX_MASK) === BEARD_TAX_MASK;
  }

  function hasTaxBag(player) {
    for (const itemId of TAX_BAG_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function updateTaxBag(player) {
    for (const itemId of TAX_BAG_IDS) {
      const amount = player.getInventory().getAmount(itemId);
      if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
    }
    const amount = taxAmount(player);
    const itemId =
      amount >= 29000 ? BULGING_TAX_BAG
        : amount >= 20000 ? HEFTY_TAX_BAG
        : amount >= 10000 ? NORMAL_TAX_BAG
        : amount > 0 ? LIGHT_TAX_BAG
        : EMPTY_TAX_BAG;
    player.getInventory().adds(itemId, 1);
  }

  function collectTax(player, amount, attribute, flag) {
    player.setAttribute(TAX_ATTRIBUTE, taxAmount(player) + amount);
    setFlag(player, attribute, flag);
    updateTaxBag(player);
  }

  function trollKills(player) {
    return Number(player.getAttribute(TROLL_KILLS_ATTRIBUTE)) || 0;
  }

  function borkFlags(player) {
    return Number(player.getAttribute(BORK_ATTRIBUTE)) || 0;
  }

  function miningTier(player) {
    const mining = player.getSkillManager().getMaxLevel(Skill.MINING);
    if (mining >= 55) return { itemId: MITHRIL_ORE, amount: 6, word: "six", ore: "mithril", coins: 6000 };
    if (mining >= 2) return { itemId: COAL, amount: 7, word: "seven", ore: "coal", coins: 4000 };
    return { itemId: TIN_ORE, amount: 8, word: "eight", ore: "tin", coins: 2000 };
  }

  function hasTaskOres(player) {
    const tier = miningTier(player);
    return hasItem(player, tier.itemId, tier.amount);
  }

  function takeTaskOres(player) {
    const tier = miningTier(player);
    player.getInventory().deleteNumber(tier.itemId, tier.amount);
  }

  function fillText(player, text) {
    const tier = miningTier(player);
    return String(text ?? "")
      .replace(/\[six\/seven\/eight\]/g, tier.word)
      .replace(/\[tin\/coal\/mithril\]/g, tier.ore)
      .replace(/\[amount\]/g, String(tier.coins))
      .replace(/\[X\]/g, String(Math.max(0, 10 - trollKills(player))))
      .replace(/\[number\]/g, "1");
  }

  function addCoins(player, amount) {
    player.getInventory().adds(COINS, amount);
  }

  // ==========================================================================
  // Transcript helpers and cutscenes
  // ==========================================================================

  function play(player, npcId, variant) {
    if (variant) startTranscript(api, player, npcId, PAGE, variant);
    return variant;
  }

  /**
   * Plays transcript variants back to back, waiting for each chatbox to close
   * before starting the next (the jester performance has no interface here).
   */
  function playChain(player, npcId, variants, onDone) {
    const queue = [...variants];
    const next = () => {
      if (player.isRegistered?.() === false) return;
      const variant = queue.shift();
      if (variant === undefined) {
        onDone?.();
        return;
      }
      play(player, npcId, variant);
      waitForChatboxClose(player, next);
    };
    next();
  }

  function waitForChatboxClose(player, run) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) return;
    const step = () => {
      if (player.isRegistered?.() === false) return;
      if (player.getDialogueManager?.()?.isActive?.() === true) {
        TaskManager.submit(new CountdownTask(player, 1, step));
        return;
      }
      run();
    };
    TaskManager.submit(new CountdownTask(player, 1, step));
  }

  function performFirst(player, npcId) {
    playChain(
      player,
      npcId,
      [
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-talking-to-mawnis",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-mawnis-instructions",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-honour-guard-overhead-during-the-performance",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-friedleif-and-thakkrad-s-plans",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-after-a-successful-performance",
      ],
      () => {
        if (stageOf(player) === STAGE_JESTER_MISSION) {
          addPerformance(player);
          setStage(player, STAGE_PERFORMED);
        }
      }
    );
  }

  function performAgain(player, npcId) {
    playChain(
      player,
      npcId,
      [
        "jestering-again-performing-for-the-burgher-again-talking-to-mawnis-burowgar",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-mawnis-instructions",
        "jestering-again-performing-for-the-burgher-again-friedleif-and-thakkrad-s-plans",
        "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-after-a-successful-performance",
      ],
      () => {
        if (stageOf(player) === STAGE_BEARD_PAID) {
          addPerformance(player);
          setFlag(player, MISSION2_ATTRIBUTE, 2); // performed
          player.sendMessage("You finish entertaining the Burgher and overhear the plans.");
        }
      }
    );
  }

  // ==========================================================================
  // Variant selection (indexed NPCs)
  // ==========================================================================

  function mordVariant(player, npcId) {
    const stage = stageOf(player);
    if (npcId === MORD_RELLEKKA) {
      if (stage >= STAGE_HEAD_TAKEN) return "returning-victorious-talking-to-mord-gunnars";
      return "starting-off-learning-about-jatizso-talking-to-mord-gunnars-in-rellekka";
    }
    if (stage >= STAGE_HEAD_TAKEN) return "returning-victorious-talking-to-mord-gunnars";
    if (stage >= STAGE_WINDOW_TAX) return "return-to-jatizso-after-becoming-a-tax-collector-talking-to-mord-gunnars-on-jatizso";
    if (stage >= STAGE_JESTER_MISSION && stage <= STAGE_PERFORMED) {
      return "jestering-around-before-departing-from-jatizso-talking-to-mord-gunnars";
    }
    return "starting-off-learning-about-jatizso-talking-to-mord-gunnars-in-jatizso";
  }

  function mariaVariant(player, npcId) {
    const stage = stageOf(player);
    if (npcId === MARIA_RELLEKKA) {
      if (stage >= STAGE_SPY_REPORTED) {
        return "burgher-buddy-after-relaying-the-information-talking-to-maria-gunnars-in-relleka";
      }
      if (stage >= STAGE_ORES_DELIVERED) {
        return "jestering-around-learning-about-neitiznot-talking-to-maria-gunnars-at-relleka";
      }
      return "starting-off-learning-about-jatizso-talking-to-maria-gunnars";
    }
    if (stage >= STAGE_SPY_REPORTED) {
      return "burgher-buddy-after-relaying-the-information-talking-to-maria-gunnars-in-neitiznot";
    }
    return "jestering-around-learning-about-neitiznot-talking-to-maria-gunnars-on-neitiznot";
  }

  function thakkradVariant(player) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return "post-quest-talking-to-thakkrad";
    if (stage >= STAGE_CHAMPION) return "gear-of-a-champion-swearing-your-oaths-talking-to-thakkrad";
    if (stage >= STAGE_DECREE_DELIVERED) {
      if (hasItem(player, YAK_HIDE) || hasItem(player, CURED_YAK_HIDE)) {
        return "gear-of-a-champion-making-yak-hide-armor-talking-with-thakkrad-or-maris-with-yak-hide";
      }
      return "gear-of-a-champion-learning-about-the-gear-talking-to-thakkrad";
    }
    if (stage >= STAGE_BRIDGES_REPAIRED) return "bridge-building-after-learning-about-mawnis-plans-talking-to-thakkrad";
    if (stage === STAGE_LOGS_DELIVERED) return "bridge-building-repairing-the-bridges-talking-to-thakkrad";
    if (stage === STAGE_ROPES_DELIVERED) return "bridge-building-split-log-delivery";
    if (stage === STAGE_SPY_REPORTED) return "rope-gathering-talking-to-fridleif-or-thakkrad";
    if (stage >= STAGE_ORES_DELIVERED) return "jestering-around-first-meetings-in-neitiznot-talking-to-thakkrad";
    return null;
  }

  function fridleifVariant(player) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return "post-quest-talking-to-fridleif";
    if (stage >= STAGE_CHAMPION) return "gear-of-a-champion-swearing-your-oaths-talking-to-fridleif";
    if (stage >= STAGE_DECREE_DELIVERED) return "gear-of-a-champion-learning-about-the-gear-talking-to-fridleif";
    if (stage >= STAGE_BRIDGES_REPAIRED) return "bridge-building-after-learning-about-mawnis-plans-talking-to-fridleif";
    if (stage === STAGE_LOGS_DELIVERED) return "bridge-building-repairing-the-bridges-talking-to-fridleif-shieldson";
    if (stage === STAGE_ROPES_DELIVERED) return "bridge-building-split-log-delivery";
    if (stage === STAGE_SPY_REPORTED) return "rope-gathering-talking-to-fridleif-or-thakkrad";
    if (stage >= STAGE_ORES_DELIVERED) return "jestering-around-first-meetings-in-neitiznot-talking-to-fridleif";
    return null;
  }

  function slugVariant(player) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return null;
    if (stage >= STAGE_JESTER_AGAIN) return "jestering-again-reporting-in-talking-to-slug-again";
    if (stage === STAGE_BEARD_PAID) {
      if (!hasFlag(player, MISSION2_ATTRIBUTE, 1)) {
        setFlag(player, MISSION2_ATTRIBUTE, 1);
        return "jestering-again-meeting-with-slug-again";
      }
      return hasFlag(player, MISSION2_ATTRIBUTE, 2)
        ? "jestering-again-reporting-in-talking-to-slug"
        : "jestering-again-meeting-with-slug-again";
    }
    if (stage >= STAGE_SPY_REPORTED) {
      return stage === STAGE_SPY_REPORTED
        ? "rope-gathering-talking-to-slug"
        : "burgher-buddy-after-relaying-the-information-talking-to-slug-again";
    }
    if (stage === STAGE_PERFORMED) return "burgher-buddy-reporting-to-slug";
    if (
      stage === STAGE_JESTER_MISSION ||
      (stage === STAGE_ORES_DELIVERED && !hasFlag(player, MISSION_ATTRIBUTE, 1))
    ) {
      return hasFlag(player, MISSION_ATTRIBUTE, 1)
        ? "your-mission-should-you-choose-to-accept-it-after-discussing-the-mission-talking-to-slug-again"
        : "your-mission-should-you-choose-to-accept-it-meeting-slug";
    }
    return null;
  }

  function guardVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE_STARTED || stage === STAGE_TUNA_TASK) {
      return "starting-off-first-meetings-in-jatizso-talking-to-the-throne-room-guard";
    }
    if (stage === STAGE_ORE_TASK) return "starting-off-tuna-delivery-talking-to-the-throne-room-guard";
    if (stage >= STAGE_SPY_REPORTED && stage <= STAGE_BEARD_PAID) {
      return "burgher-buddy-after-relaying-the-information-speaking-to-the-throne-room-guard";
    }
    return null;
  }

  function honourGuardVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_ORES_DELIVERED && stage <= STAGE_PERFORMED) {
      return "jestering-around-first-meetings-in-neitiznot-talking-to-an-honour-guard";
    }
    return null;
  }

  function borkVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_CHAMPION || quest.isComplete(player)) return null;
    return borkFlags(player) === (BORK_FOOD | BORK_STRENGTH | BORK_PRAYER)
      ? "facing-the-trolls-talking-to-bork-after-claiming-all-supplies"
      : "facing-the-trolls-talking-to-bork";
  }

  function taxVariant(player, npcId) {
    const stage = stageOf(player);
    if (npcId === ERIC) {
      if (stage === STAGE_WINDOW_TAX) return "return-to-jatizso-tax-time-windows-eric";
      if (stage === STAGE_WINDOW_PAID) return "return-to-jatizso-tax-time-beards-eric";
      return null;
    }
    if (stage === STAGE_JESTER_MISSION && JESTER_MERCHANTS.has(npcId)) {
      return "jestering-around-before-departing-from-jatizso-talking-to-skuli-raum-or-hring";
    }
    if (stage === STAGE_WINDOW_TAX) {
      const spec = WINDOW_TAX_VARIANTS.get(npcId);
      if (!spec) return null;
      return hasFlag(player, WINDOW_TAXES_ATTRIBUTE, spec.flag)
        ? "return-to-jatizso-tax-time-windows-talking-to-a-taxed-merchant-again"
        : spec.variant;
    }
    if (stage === STAGE_WINDOW_PAID) {
      const spec = BEARD_TAX_VARIANTS.get(npcId);
      if (!spec) return null;
      return hasFlag(player, BEARD_TAXES_ATTRIBUTE, spec.flag)
        ? "return-to-jatizso-tax-time-beards-talking-to-a-taxed-merchant-again"
        : spec.variant;
    }
    if (stage === STAGE_BEARD_PAID) return AFTER_TAX_VARIANTS.get(npcId) ?? null;
    if (stage === STAGE_ORE_TASK && npcId === FLOSI_DALKSSON) {
      return "starting-off-ore-delivery-talking-to-flosi-dalksson";
    }
    if (stage < STAGE_ORES_DELIVERED && (npcId === KEEPA_KETTILON || npcId === VANLIGGA_GASTFRIHET)) {
      return npcId === KEEPA_KETTILON
        ? "starting-off-first-meetings-in-jatizso-talking-to-keepa-kettilon"
        : "starting-off-first-meetings-in-jatizso-talking-to-vanligga-gastfrihet";
    }
    return null;
  }

  function thorkelVariant(player) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return null;
    if (stage === STAGE_STARTED) return "starting-off-first-meetings-in-jatizso-talking-to-thorkel";
    if (stage === STAGE_TUNA_TASK) return "starting-off-tuna-delivery-talking-to-thorkel";
    if (stage === STAGE_ORE_TASK) return "starting-off-ore-delivery-talking-to-thorkel";
    if (stage >= STAGE_ORES_DELIVERED && stage <= STAGE_PERFORMED) {
      return "jestering-around-before-departing-from-jatizso-talking-to-thorkel";
    }
    if (stage === STAGE_BRIDGES_REPAIRED || stage === STAGE_WINDOW_TAX) {
      return stage === STAGE_BRIDGES_REPAIRED
        ? "return-to-jatizso-becoming-a-tax-collector-talking-to-thorkel"
        : "return-to-jatizso-after-becoming-a-tax-collector-talking-to-thorkel";
    }
    if (stage === STAGE_WINDOW_PAID) return "return-to-jatizso-returning-with-the-window-taxes-talking-to-thorkel";
    if (stage === STAGE_BEARD_PAID) return "return-to-jatizso-returning-with-beard-taxes-talking-to-thorkel";
    return null;
  }

  function selectVariant(event) {
    const { npcId, player } = event;
    if (MORD_IDS.has(npcId)) return mordVariant(player, npcId);
    if (npcId === MARIA_RELLEKKA || npcId === MARIA_NEITIZNOT) return mariaVariant(player, npcId);
    if (npcId === NpcIdentifiers.THORKEL_SILKBEARD) return thorkelVariant(player);
    if (THAKKRAD_IDS.has(npcId)) return thakkradVariant(player);
    if (FRIDLEIF_IDS.has(npcId)) return fridleifVariant(player);
    if (npcId === SLUG_HEMLIGSSEN) return slugVariant(player);
    if (GUARD_IDS.has(npcId)) return guardVariant(player);
    if (HONOUR_GUARD_IDS.has(npcId)) return honourGuardVariant(player);
    if (npcId === BORK_SIGMUNDSON) return borkVariant(player);
    if (TAX_NPC_IDS.has(npcId)) return taxVariant(player, npcId);
    return null;
  }

  // ==========================================================================
  // Talk-to interception (scenes not indexed to their speaker)
  // ==========================================================================

  function talkToKing(event) {
    const { player, npcId } = event;
    if (npcId !== KING_GJUKI_SORVOTT_IV) return false;
    const stage = stageOf(player);
    if (quest.isComplete(player) || stage >= STAGE_HEAD_TAKEN) {
      return play(player, npcId, "post-quest-talking-to-king-sorvott");
    }
    if (stage >= STAGE_CHAMPION) {
      return play(player, npcId, "facing-the-trolls-talking-to-king-sorvott-after-the-start-of-the-battle");
    }
    if (stage >= STAGE_DECREE_DELIVERED) {
      return play(player, npcId, "gear-of-a-champion-learning-about-the-gear-talking-to-king-sorvott");
    }
    if (stage === STAGE_DECREE) return play(player, npcId, "jestering-again-reporting-in-talking-to-king-sorvott-again");
    if (stage === STAGE_JESTER_AGAIN) return play(player, npcId, "jestering-again-reporting-in-returning-to-king-sorvott");
    if (stage === STAGE_BEARD_PAID) return play(player, npcId, "jestering-again-after-discussing-the-new-mission-talking-to-king-sorvott");
    if (stage === STAGE_WINDOW_PAID) {
      return play(
        player,
        npcId,
        beardTaxesDone(player)
          ? "return-to-jatizso-returning-with-beard-taxes-talking-to-king-sorvott-or-thorkel"
          : "return-to-jatizso-returning-with-the-window-taxes-talking-to-king-sorvott-again"
      );
    }
    if (stage === STAGE_WINDOW_TAX) {
      if (!hasTaxBag(player)) {
        if (!isFull(player)) {
          player.setAttribute(TAX_ATTRIBUTE, 0);
          player.getInventory().adds(EMPTY_TAX_BAG, 1);
        }
        return play(player, npcId, "return-to-jatizso-tax-bag-interactions-reclaiming-tax-bag-if-lost");
      }
      return play(
        player,
        npcId,
        windowTaxesDone(player)
          ? "return-to-jatizso-returning-with-the-window-taxes-talking-to-king-sorvott"
          : "return-to-jatizso-after-becoming-a-tax-collector-talking-to-king-sorvott-again"
      );
    }
    if (stage === STAGE_BRIDGES_REPAIRED) {
      return play(player, npcId, "return-to-jatizso-becoming-a-tax-collector-talking-to-king-sorvott");
    }
    if (stage === STAGE_ORE_TASK) return play(player, npcId, "starting-off-ore-delivery-talking-to-king-sorvott-iv");
    if (stage === STAGE_TUNA_TASK) return play(player, npcId, "starting-off-tuna-delivery-talking-to-king-sorvott-iv");
    if (stage >= STAGE_ORES_DELIVERED) {
      return play(player, npcId, "jestering-around-before-departing-from-jatizso-talking-to-king-sorvott");
    }
    setStage(player, STAGE_TUNA_TASK);
    play(player, npcId, "starting-off-talking-to-king-sorvott-iv");
  }

  function talkToMawnis(event) {
    const { player, npcId } = event;
    if (!MAWNIS_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (quest.isComplete(player)) return play(player, npcId, "post-quest-talking-to-mawnis-burowgar");
    if (stage >= STAGE_HEAD_TAKEN) return play(player, npcId, "returning-victorious-returning-to-mawnis-victorious");
    if (stage >= STAGE_CHAMPION) return play(player, npcId, "gear-of-a-champion-swearing-your-oaths-talking-to-mawnis");
    if (stage === STAGE_ARMOUR_DONE) {
      if (hasItem(player, NEITIZNOT_SHIELD)) {
        setStage(player, STAGE_CHAMPION);
        return play(player, npcId, "gear-of-a-champion-swearing-your-oaths-talking-to-mawnis");
      }
      return play(player, npcId, "gear-of-a-champion-making-the-neitiznot-shield-talking-to-mawnis-before-making-the-shield");
    }
    if (stage === STAGE_DECREE_DELIVERED) {
      if (hasItem(player, YAK_HIDE_BODY) && hasItem(player, YAK_HIDE_LEGS)) {
        setStage(player, STAGE_ARMOUR_DONE);
        return play(player, npcId, "gear-of-a-champion-making-yak-hide-armor-talking-to-mawnis-after-making-a-full-set-of-yak-hide");
      }
      if (hasItem(player, YAK_HIDE_BODY) || hasItem(player, YAK_HIDE_LEGS)) {
        return play(player, npcId, "gear-of-a-champion-making-yak-hide-armor-talking-to-mawnis-after-having-made-one-piece-of-yak-hide-armour");
      }
      return play(player, npcId, "gear-of-a-champion-learning-about-the-gear-talking-to-mawnis-again");
    }
    if (stage === STAGE_DECREE) return play(player, npcId, "gear-of-a-champion-learning-about-the-gear-talking-to-mawnis-burowgar");
    if (stage >= STAGE_BEARD_PAID) {
      if (
        jesterWorn(player) &&
        handsFree(player) &&
        stage === STAGE_BEARD_PAID &&
        hasFlag(player, MISSION2_ATTRIBUTE, 1) &&
        !hasFlag(player, MISSION2_ATTRIBUTE, 2)
      ) {
        performAgain(player, npcId);
        return;
      }
      return play(player, npcId, "return-to-jatizso-after-becoming-a-tax-collector-talking-to-mawnis-burowgar");
    }
    if (stage >= STAGE_BRIDGES_REPAIRED) {
      return play(player, npcId, "return-to-jatizso-after-becoming-a-tax-collector-talking-to-mawnis-burowgar");
    }
    if (stage === STAGE_LOGS_DELIVERED) {
      return play(
        player,
        npcId,
        bothBridges(player)
          ? "bridge-building-talking-to-mawnis-after-repairing-both-bridges"
          : "bridge-building-repairing-the-bridges-talking-to-mawnis"
      );
    }
    if (stage === STAGE_ROPES_DELIVERED) return play(player, npcId, "bridge-building-split-log-delivery");
    if (stage >= STAGE_SPY_REPORTED) return play(player, npcId, "burgher-buddy-talking-to-mawnis-burowgar");
    if (stage >= STAGE_JESTER_MISSION) {
      if (jesterWorn(player) && handsFree(player) && performanceCount(player) === 0) {
        performFirst(player, npcId);
        return;
      }
      if (jesterWorn(player) && handsFree(player)) {
        return play(player, npcId, "burgher-buddy-talking-to-mawnis-burowgar");
      }
      return play(player, npcId, "jestering-around-first-meetings-in-neitiznot-talking-to-mawnis");
    }
    if (stage >= STAGE_ORES_DELIVERED) {
      return play(player, npcId, "jestering-around-first-meetings-in-neitiznot-talking-to-mawnis");
    }
    return false;
  }

  function talkToKjedelig(event) {
    const { player, npcId } = event;
    if (npcId !== KJEDELIG_UPPSEN && npcId !== TROGEN_KONUNGARDE) return false;
    const stage = stageOf(player);
    if (quest.isComplete(player) || stage >= STAGE_HEAD_TAKEN) {
      return play(player, npcId, "post-quest-talking-to-trogen-or-kjedelig");
    }
    if (stage >= STAGE_BEARD_PAID) return play(player, npcId, "jestering-again-after-discussing-the-new-mission-talking-to-trogen-or-kjedelig");
    if (stage >= STAGE_ROPES_DELIVERED) return play(player, npcId, "rope-gathering-talking-to-kjedelig-or-trogen");
    if (stage === STAGE_SPY_REPORTED) return play(player, npcId, "burgher-buddy-after-relaying-the-information-talking-to-kjedelig-or-trogen");
    if (stage === STAGE_PERFORMED) return play(player, npcId, "your-mission-should-you-choose-to-accept-it-performing-for-the-burgher-talking-to-kjedelig-or-trogen-after-the-performance");
    if (stage === STAGE_JESTER_MISSION) return play(player, npcId, "your-mission-should-you-choose-to-accept-it-after-discussing-the-mission-talking-to-kjedelig-or-trogen");
    if (stage >= STAGE_ORES_DELIVERED) return play(player, npcId, "jestering-around-first-meetings-in-neitiznot-talking-to-kjedelig-or-trogen");
    return false;
  }

  /**
   * Tax merchants and post-quest Maria: NpcDialogues' default for an indexed NPC
   * is the first variant on "The Fremennik Isles" page, so this Talk-to hook
   * plays their own-page dialogue instead when the round selector has no quest
   * variant to offer.
   */
  function handleSpecialTalk(event) {
    const { player, npcId } = event;
    const option = event.definition?.getActions?.()[event.clickType - 1];
    if (option !== "Talk-to") return;
    if (npcId === MARIA_RELLEKKA || npcId === MARIA_NEITIZNOT) {
      if (!quest.isComplete(player)) return;
      event.handled = true;
      startTranscript(api, player, npcId, "Maria Gunnars", "after-the-fremennik-isles");
      return;
    }
    if (!TAX_NPC_IDS.has(npcId) || npcId === ERIC) return;
    if (taxVariant(player, npcId)) return; // the variant selector owns this stage
    const stage = stageOf(player);
    let page;
    let variant;
    if (npcId === KEEPA_KETTILON) {
      page = "Keepa Kettilon";
      variant = quest.isComplete(player)
        ? "standard-dialogue-after-completing-the-fremennik-isles"
        : "standard-dialogue-during-the-fremennik-isles";
    } else if (npcId === VANLIGGA_GASTFRIHET) {
      page = "Vanligga Gastfrihet";
      variant = quest.isComplete(player)
        ? "standard-dialogue-after-completing-the-fremennik-isles"
        : "standard-dialogue-during-the-dwarves-visit-in-the-fremennik-isles";
    } else if (npcId === BRENDT || npcId === GRUNDT) {
      page = npcId === BRENDT ? "Brendt" : "Grundt";
      variant = stage >= STAGE_ORES_DELIVERED
        ? "standard-dialogue-after-delivering-their-ore-during-the-fremennik-isles"
        : "standard-dialogue-before-delivering-their-ore-during-the-fremennik-isles";
    } else {
      page = npcId === HRING_HRING ? "Hring Hring"
        : npcId === FLOSI_DALKSSON ? "Flosi Dalksson"
        : npcId === RAUM_URDA_STEIN ? "Raum Urda-Stein"
        : "Skuli Myrka";
      variant = "standard-dialogue-after-completing-the-fremennik-isles";
    }
    event.handled = true;
    startTranscript(api, player, npcId, page, variant);
  }

  // ==========================================================================
  // Prose condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Pre/post-quest flavour guards.
      case "pEn5t-":
      case "Ihp3aT":
        return stageOf(player) === 0;
      case "0rRl59":
      case "CHFIjB":
        return stageOf(player) >= STAGE_STARTED;
      // Tuna and ore hand-ins.
      case "KDJ7LL":
        return !hasItem(player, RAW_TUNA);
      case "Aa7pB6":
      case "wJcHc0":
        return !hasTaskOres(player);
      case "NseFrF":
        return false; // noted ores are counted by the unnoted branch
      case "nKdzca":
        return hasTaskOres(player);
      // Jester outfit and hands.
      case "JEjU1i":
      case "CrpWLp":
      case "mCwnq6":
      case "1BjIWa":
      case "5iTF6h":
      case "PKLYSc":
        return !jesterWorn(player);
      case "O3J1XZ":
      case "D1TxsH":
      case "a-jUlK":
      case "rsXsfL":
      case "6vCR1K":
      case "gLn0VV":
      case "lbdY6-":
      case "MUf_hf":
        return jesterWorn(player);
      case "UyCdVb":
      case "a7ZgpO":
        return !jesterWorn(player) || !handsFree(player);
      case "oMZvSG":
      case "4zwUdT":
        return jesterWorn(player) && handsFree(player);
      case "Jn9dc7":
        return !handsFree(player);
      case "PPEKkE":
        return handsFree(player);
      // Performances.
      case "MAaagt":
      case "vbhvWF":
        return performanceCount(player) === 0;
      case "XA0BKe":
      case "oaDAxB":
        return performanceCount(player) >= 1;
      // Slug's quizzes.
      case "NBJO9v":
        return hasFlag(player, QUIZ1_ATTRIBUTE, 1) !== 0;
      case "ijpsrW":
        return !hasFlag(player, QUIZ1_ATTRIBUTE, 1);
      case "tYygYD":
        return hasFlag(player, QUIZ2_ATTRIBUTE, 1) !== 0;
      case "287ies":
        return !hasFlag(player, QUIZ2_ATTRIBUTE, 1);
      // Burgher's trust / rope task.
      case "kakqfB":
        return stageOf(player) === STAGE_PERFORMED;
      case "OXI8pU":
        return stageOf(player) >= STAGE_SPY_REPORTED;
      case "m_yatk":
        return !hasItem(player, ROPE, 8);
      case "Qj6hNK":
      case "uP2k1l":
        return false;
      case "6F5gJ8":
        return hasItem(player, ROPE, 8);
      // Split logs and inventory space. The two greeting branches have no
      // "continues" marker, so answering either true would win the run and drop
      // the hand-in clauses below them.
      case "YFprXs":
      case "_9rRGH":
        return false;
      case "0Xwlzn":
        return !hasItem(player, SPLIT_LOG, 8);
      case "mbbV8v":
        return hasItem(player, SPLIT_LOG, 8);
      // Full / free inventory pairs (all of them).
      case "bt6eVE":
      case "Zt6EoJ":
      case "BZnaLO":
      case "vq3AEQ":
      case "jMiinL":
      case "GCHRv5":
      case "nOYHTU":
      case "NfJoRW":
      case "nLcM2V":
      case "L-f5Z-":
        return isFull(player);
      case "betCeN":
      case "bOd05N":
      case "5K-AD4":
      case "44rIyz":
      case "UlKKWs":
      case "z0HNXe":
      case "IlGs38":
      case "vqsAhz":
      case "eSUzAi":
      case "2S1YkU":
        return !isFull(player);
      // Window tax amount entries (no number input here: the right one wins).
      case "q_p22M":
      case "9vmJbL":
      case "AA2I5B":
      case "736YVn":
      case "W8BZBc":
        return true;
      case "Wyf_Jl":
      case "bY8ffg":
      case "bckxrK":
      case "H3s5Mf":
      case "_musjU":
      case "A9sUuM":
      case "xEmceu":
      case "AJC842":
      case "-LQCx1":
      case "sRfY49":
        return false;
      case "lkRiBG":
      case "J1kYcm":
        return !hasItem(player, COINS, 5000);
      case "i5eQrG":
      case "jPVtKK":
        return hasItem(player, COINS, 5000);
      case "0wQ3r_":
        return hasFlag(player, VANLIGGA_ATTRIBUTE, 1) !== 0;
      case "dGMcQh":
        return hasFlag(player, VANLIGGA_ATTRIBUTE, 2) !== 0;
      // Decree.
      case "BsZ_-S":
        return hasItem(player, ROYAL_DECREE);
      case "gEgCmn":
        return !hasItem(player, ROYAL_DECREE);
      case "R7FqIP":
        return !hasItem(player, ROYAL_DECREE);
      case "xcVcnH":
        return hasItem(player, ROYAL_DECREE);
      // Yakhide curing and crafting.
      case "lzWMaS": {
        const hides = player.getInventory().getAmount(YAK_HIDE);
        return player.getInventory().getAmount(COINS) < hides * 5;
      }
      case "FPmCig":
        return player.getSkillManager().getMaxLevel(Skill.CRAFTING) < 43;
      case "i-PloP":
        return player.getSkillManager().getMaxLevel(Skill.CRAFTING) < 46;
      case "pYRUcM":
      case "PreHMM":
        return false;
      case "gIFdLS":
        return !hasItem(player, THREAD);
      case "x7_Wwx":
        return hasItem(player, CURED_YAK_HIDE) && !hasItem(player, CURED_YAK_HIDE, 2);
      case "KtQjLp":
        return hasItem(player, CURED_YAK_HIDE, 2)
          && hasItem(player, THREAD)
          && !hasItem(player, YAK_HIDE_BODY)
          && player.getSkillManager().getMaxLevel(Skill.CRAFTING) >= 46;
      case "FfydyU":
        return hasItem(player, CURED_YAK_HIDE)
          && hasItem(player, THREAD)
          && !hasItem(player, YAK_HIDE_LEGS)
          && player.getSkillManager().getMaxLevel(Skill.CRAFTING) >= 43;
      // Troll King.
      case "75_TlB":
        return !hasItem(player, TROLL_HEAD);
      case "M7cMyx":
        return hasItem(player, TROLL_HEAD);
      // Post-quest helm.
      case "nZc9RC":
        return !hasItem(player, HELM_OF_NEITIZNOT);
      case "Rvj2pC":
        return hasItem(player, HELM_OF_NEITIZNOT);
      case "MQWKLI":
        return !hasItem(player, COINS, 50000);
      case "H8zpqG":
        return true;
      case "ljfnvX":
        return false;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript hook / choice / action handling
  // ==========================================================================

  /** Wiki: 40 Agility, 20 Construction and The Fremennik Trials. */
  const REQUIRED_SKILLS = [
    { skill: Skill.AGILITY, level: 40, label: "Agility" },
    { skill: Skill.CONSTRUCTION, level: 20, label: "Construction" },
  ];
  const REQUIRED_QUEST_KEY = "fremennik_trials";
  const REQUIRED_QUEST_NAME = "The Fremennik Trials";

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsStartRequirements(player) {
    return (
      missingSkillRequirements(player).length === 0 && questIsComplete(player, REQUIRED_QUEST_KEY)
    );
  }

  function notifyStartRequirements(player) {
    notifySkillRequirements(player);
    if (!questIsComplete(player, REQUIRED_QUEST_KEY)) {
      player.sendMessage(`You must complete ${REQUIRED_QUEST_NAME} to start this quest.`);
    }
  }

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

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !MORD_IDS.has(npcId)) return;
    if (stageOf(player) === 0) {
      if (!meetsStartRequirements(player)) {
        notifyStartRequirements(player);
        return;
      }
      setStage(player, STAGE_STARTED);
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === SLUG_HEMLIGSSEN) {
      if (option === "Free stuff please.") {
        setFlag(player, MISSION_ATTRIBUTE, 1);
        setStage(player, STAGE_JESTER_MISSION);
        return;
      }
      if (option === "Yes I have.") {
        player.setAttribute(QUIZ1_ATTRIBUTE, 1);
        return;
      }
      if (option === "Yes, I am.") {
        player.setAttribute(QUIZ2_ATTRIBUTE, 1);
        return;
      }
      if (WRONG_QUIZ1.has(option)) {
        player.setAttribute(QUIZ1_ATTRIBUTE, 0);
        return;
      }
      if (WRONG_QUIZ2.has(option)) {
        player.setAttribute(QUIZ2_ATTRIBUTE, 0);
        return;
      }
      return;
    }
    if (npcId === VANLIGGA_GASTFRIHET) {
      if (option === "I suppose I could pay the tax for you." && hasItem(player, COINS, 5000)) {
        player.getInventory().deleteNumber(COINS, 5000);
        collectTax(player, 5000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_VANLIGGA);
        setFlag(player, VANLIGGA_ATTRIBUTE, 2);
        return;
      }
      if (option === "Do you know what? I'll give you a refund." && hasItem(player, COINS, 5000)) {
        player.getInventory().deleteNumber(COINS, 5000);
        setFlag(player, VANLIGGA_ATTRIBUTE, 4);
        return;
      }
      return;
    }
    if (THAKKRAD_IDS.has(npcId)) {
      const cureAll = option === "Cure all my hides.";
      const cureOne = option === "Cure one hide.";
      if (!cureAll && !cureOne) return;
      const held = player.getInventory().getAmount(YAK_HIDE);
      const count = cureAll ? held : Math.min(1, held);
      if (count <= 0 || player.getInventory().getAmount(COINS) < count * 5) {
        player.sendMessage("You don't have enough gold to pay me!");
        return;
      }
      player.getInventory().deleteNumber(COINS, count * 5);
      player.getInventory().deleteNumber(YAK_HIDE, count);
      player.getInventory().adds(CURED_YAK_HIDE, count);
      player.sendMessage(`Thakkrad cures ${count === 1 ? "the yak-hide" : `${count} yak-hides`} for ${count * 5} coins.`);
      return;
    }
    if (MAWNIS_IDS.has(npcId) && option === "Very well, I accept.") {
      if (hasItem(player, COINS, 50000)) {
        player.getInventory().deleteNumber(COINS, 50000);
        player.getInventory().adds(HELM_OF_NEITIZNOT, 1);
      }
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Ferries.
      case "itvaHf":
        ferry(player, "jatizso", JATIZSO_LANDING);
        return;
      case "ynQW7s":
      case "BDz1Ek":
        ferry(player, event.npcId === MARIA_NEITIZNOT ? "neitiznot-back" : "jatizso-back", RELLEKKA_LANDING);
        return;
      case "y8Zfde":
        ferry(player, "neitiznot", NEITIZNOT_LANDING);
        return;
      // Tuna.
      case "Py3jqy":
        if (hasItem(player, RAW_TUNA)) player.getInventory().deleteNumber(RAW_TUNA, 1);
        setStage(player, STAGE_ORE_TASK);
        return;
      // Ores.
      case "-UQEZy":
        if (hasTaskOres(player)) takeTaskOres(player);
        event.step && (event.step.text = fillText(player, event.step.text));
        setStage(player, STAGE_ORES_DELIVERED);
        return;
      case "02jNR_":
        addCoins(player, miningTier(player).coins);
        event.step && (event.step.text = fillText(player, event.step.text));
        return;
      // Jester and spies.
      case "U8RN0U":
        addCoins(player, 2500);
        player.setAttribute(QUIZ1_ATTRIBUTE, 1);
        setStage(player, STAGE_SPY_REPORTED);
        return;
      case "30yZzw":
        return; // the rope is shown, not taken
      case "UmIVU3":
      case "2yLVYG":
        addCoins(player, 1000);
        setStage(player, STAGE_ROPES_DELIVERED);
        return;
      case "ainyGK":
        player.getInventory().deleteNumber(SPLIT_LOG, 8);
        addCoins(player, 1500);
        setStage(player, STAGE_LOGS_DELIVERED);
        return;
      case "E92sz8":
        addCoins(player, 1500);
        setStage(player, STAGE_BRIDGES_REPAIRED);
        return;
      // Tax bag.
      case "lpQ4Zf":
        player.getInventory().adds(EMPTY_TAX_BAG, 1);
        setStage(player, STAGE_WINDOW_TAX);
        return;
      case "x3P562":
        collectTax(player, 5000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_FLOSI);
        return;
      case "dskV53":
        collectTax(player, 5000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_KEEPA);
        return;
      case "wsGFGs":
        collectTax(player, 5000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_VANLIGGA);
        player.setAttribute(VANLIGGA_ATTRIBUTE, 1);
        return;
      case "IErB7_":
        collectTax(player, 6000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_SKULI);
        return;
      case "DKkzB0":
        collectTax(player, 8000, WINDOW_TAXES_ATTRIBUTE, TAX_FLAG_RAUM);
        return;
      case "oe4mzP":
        setStage(player, STAGE_WINDOW_PAID);
        return;
      case "Co4EZV":
        collectTax(player, 1000, BEARD_TAXES_ATTRIBUTE, TAX_FLAG_RAUM);
        return;
      case "ShJjk0":
        collectTax(player, 1000, BEARD_TAXES_ATTRIBUTE, TAX_FLAG_FLOSI);
        return;
      case "aMe04V":
        collectTax(player, 1000, BEARD_TAXES_ATTRIBUTE, TAX_FLAG_HRING);
        return;
      case "5OtiAA":
        collectTax(player, 1000, BEARD_TAXES_ATTRIBUTE, TAX_FLAG_SKULI);
        return;
      case "5DLiYu":
        collectTax(player, 1000, BEARD_TAXES_ATTRIBUTE, TAX_FLAG_KEEPA);
        return;
      case "IH9HCp": {
        for (const itemId of TAX_BAG_IDS) {
          const amount = player.getInventory().getAmount(itemId);
          if (amount > 0) player.getInventory().deleteNumber(itemId, amount);
        }
        player.setAttribute(TAX_ATTRIBUTE, 0);
        setStage(player, STAGE_BEARD_PAID);
        return;
      }
      case "UIFAyO":
        player.getInventory().adds(CABBAGE, 1);
        return;
      // Second jestering.
      case "7xNGn6":
        addCoins(player, 2500);
        setStage(player, STAGE_JESTER_AGAIN);
        return;
      case "Vwm25f":
      case "Rp1aB3":
        if (!isFull(player)) player.getInventory().adds(ROYAL_DECREE, 1);
        setStage(player, STAGE_DECREE);
        return;
      // Rites.
      case "7DEjT7":
        if (hasItem(player, ROYAL_DECREE)) player.getInventory().deleteNumber(ROYAL_DECREE, 1);
        setStage(player, STAGE_DECREE_DELIVERED);
        return;
      // Bork's supplies.
      case "1eVvoF":
        player.getInventory().adds(TUNA, 10);
        setFlag(player, BORK_ATTRIBUTE, BORK_FOOD);
        return;
      case "eJNB7e":
        player.getInventory().adds(STRENGTH_POTION_4, 4);
        setFlag(player, BORK_ATTRIBUTE, BORK_STRENGTH);
        return;
      case "eCZJLI":
        player.getInventory().adds(PRAYER_POTION_3, 4);
        setFlag(player, BORK_ATTRIBUTE, BORK_PRAYER);
        return;
      case "57Z66s":
        if (stageOf(player) >= STAGE_CHAMPION && stageOf(player) < STAGE_TEN_TROLLS) {
          setStage(player, STAGE_TEN_TROLLS);
        }
        return;
      case "3CHUQU":
      case "m4TmXs":
        event.step && (event.step.text = fillText(player, event.step.text));
        return;
      // Head and completion.
      case "xq4Jp-":
        if (hasItem(player, TROLL_HEAD)) player.getInventory().deleteNumber(TROLL_HEAD, 1);
        return;
      case "fWsiWT":
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  /** The NPCs whose lines carry this quest's blanks; "[amount]" is common to other pages. */
  const BLANK_SPEAKERS = new Set(["King Sorvott IV", "Thorkel Silkbeard", "Mawnis Burowgar"]);

  function handleLine(event) {
    const { text } = event;
    const value = String(text ?? "");
    if (!BLANK_SPEAKERS.has(event.definition?.getName?.())) return;
    if (
      value.includes("[six/seven/eight]") ||
      value.includes("[tin/coal/mithril]") ||
      value.includes("[amount]") ||
      value.includes("[X]") ||
      value.includes("[number]")
    ) {
      event.text = fillText(event.player, value);
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function objectOption(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return actions[event.clickType - 1] ?? "";
  }

  function openJesterChest(event) {
    const { player } = event;
    event.handled = true;
    if (hasFlag(player, CHEST_ATTRIBUTE, 1)) {
      player.sendMessage("You have already taken the jester costume.");
      return;
    }
    if (stageOf(player) < STAGE_ORES_DELIVERED) {
      player.sendMessage("You should speak to the King before rummaging through his chest.");
      return;
    }
    if (isFull(player)) {
      player.sendMessage("You need some free inventory space to take the costume.");
      return;
    }
    setFlag(player, CHEST_ATTRIBUTE, 1);
    player.getInventory().adds(JESTER_HAT, 1);
    player.getInventory().adds(JESTER_TOP, 1);
    player.getInventory().adds(JESTER_TIGHTS, 1);
    player.getInventory().adds(JESTER_BOOTS, 1);
    player.sendMessage("You take the silly jester costume from the chest.");
  }

  function repairBridge(event, bit) {
    const { player } = event;
    event.handled = true;
    if (bridgesRepaired(player) & bit) {
      play(player, BORK_SIGMUNDSON, "bridge-building-repairing-the-bridges-trying-to-repair-a-fixed-bridge");
      return;
    }
    if (!hasItem(player, KNIFE)) {
      player.sendMessage("You will need a knife to repair the bridge.");
      return;
    }
    if (player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < 20) {
      player.sendMessage("You need a Construction level of 20 to repair the bridge.");
      return;
    }
    if (!hasItem(player, SPLIT_LOG, 4)) {
      player.sendMessage("You need four split logs to repair the bridge.");
      return;
    }
    if (!hasItem(player, ROPE, 4)) {
      player.sendMessage("You need four lengths of rope to repair the bridge.");
      return;
    }
    player.getInventory().deleteNumber(SPLIT_LOG, 4);
    player.getInventory().deleteNumber(ROPE, 4);
    setFlag(player, BRIDGES_ATTRIBUTE, bit);
    player.sendMessage("You repair the bridge.");
  }

  function crossBrokenBridge(event, bit) {
    const { player, location } = event;
    event.handled = true;
    if (!(bridgesRepaired(player) & bit)) {
      play(player, BORK_SIGMUNDSON, "rope-gathering-trying-to-repair-or-cross-the-bridges-early");
      return;
    }
    player.moveTo(new Location(location.x, location.y + 8, location.z ?? 0));
  }

  function crossRuniteBridge(event) {
    const { player, location } = event;
    event.handled = true;
    if (!quest.isComplete(player)) {
      play(player, BORK_SIGMUNDSON, "bridge-building-repairing-the-bridges-trying-to-cross-bridge-to-runite-rock");
      return;
    }
    player.moveTo(new Location(location.x, location.y + 8, location.z ?? 0));
  }

  function enterCave(event, east) {
    const { player } = event;
    event.handled = true;
    if (!east) {
      play(player, BORK_SIGMUNDSON, "bridge-building-after-learning-about-mawnis-plans-trying-to-enter-the-western-or-middle-troll-caves");
      return;
    }
    if (stageOf(player) < STAGE_CHAMPION) {
      play(player, BORK_SIGMUNDSON, "bridge-building-after-learning-about-mawnis-plans-trying-to-enter-the-eastern-troll-caves");
      return;
    }
    playChain(player, BORK_SIGMUNDSON, ["facing-the-trolls-entering-the-eastern-cave"], () => {
      player.moveTo(CAVE_LANDING);
    });
  }

  function spawnTrollKing(player, z) {
    const world = api.getWorld?.();
    if (world?.getNpcs) {
      for (const npc of world.getNpcs()) {
        if (npc?.getId?.() === ICE_TROLL_KING && npc.getOwner?.() === player) return npc;
      }
    }
    return api.spawnNpc({
      id: ICE_TROLL_KING,
      x: KING_LAIR_TILE.x,
      y: KING_LAIR_TILE.y,
      z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function crossCaveBridge(event) {
    const { player } = event;
    event.handled = true;
    const z = LAIR_LANDING.z;
    const stage = stageOf(player);
    if (stage >= STAGE_HEAD_TAKEN) {
      player.moveTo(new Location(LAIR_LANDING.x, LAIR_LANDING.y, z));
      return;
    }
    if (stage < STAGE_TEN_TROLLS) {
      const remaining = Math.max(0, 10 - trollKills(player));
      player.sendMessage(
        remaining === 1
          ? "You have one more troll to kill before you can kill the Troll King."
          : `You have ${remaining} more trolls to kill before you can kill the Troll King.`
      );
      return;
    }
    spawnTrollKing(player, z);
    play(player, ICE_TROLL_KING, "facing-the-trolls-facing-the-ice-troll-king");
    player.moveTo(new Location(LAIR_LANDING.x, LAIR_LANDING.y, z));
  }

  function spinYakHair(event) {
    const { player } = event;
    if (!hasItem(player, HAIR)) return;
    event.handled = true;
    if (player.getSkillManager().getMaxLevel(Skill.CRAFTING) < 30) {
      player.sendMessage("You need a Crafting level of 30 to spin yak hair into rope.");
      return;
    }
    const amount = player.getInventory().getAmount(HAIR);
    player.getInventory().deleteNumber(HAIR, amount);
    player.getInventory().adds(ROPE, amount);
    player.sendMessage("You spin the yak hair into rope.");
  }

  function useWoodcuttingStump(event) {
    const { player } = event;
    if (stageOf(player) >= STAGE_ARMOUR_DONE && !hasItem(player, NEITIZNOT_SHIELD)) {
      if (
        hasItem(player, ARCTIC_PINE_LOGS, 2) &&
        hasItem(player, ROPE) &&
        hasItem(player, BRONZE_NAILS) &&
        hasItem(player, HAMMER)
      ) {
        event.handled = true;
        player.getInventory().deleteNumber(ARCTIC_PINE_LOGS, 2);
        player.getInventory().deleteNumber(ROPE, 1);
        player.getInventory().deleteNumber(BRONZE_NAILS, 1);
        player.getInventory().adds(NEITIZNOT_SHIELD, 1);
        player.sendMessage("You make a Neitiznot shield.");
        return;
      }
    }
    if (!hasItem(player, ARCTIC_PINE_LOGS)) return;
    event.handled = true;
    const amount = player.getInventory().getAmount(ARCTIC_PINE_LOGS);
    player.getInventory().deleteNumber(ARCTIC_PINE_LOGS, amount);
    player.getInventory().adds(SPLIT_LOG, amount);
    player.sendMessage("You split the arctic pine logs.");
  }

  function handleObjectInteraction(event) {
    const { objectId } = event;
    if (objectId === JESTER_CHEST) {
      if (objectOption(event) === "Open") openJesterChest(event);
      return;
    }
    if (WEST_BRIDGE_IDS.has(objectId)) {
      const option = objectOption(event);
      if (option === "Repair") repairBridge(event, BRIDGE_WEST);
      else if (option === "Walk-across") crossBrokenBridge(event, BRIDGE_WEST);
      return;
    }
    if (MIDDLE_BRIDGE_IDS.has(objectId)) {
      const option = objectOption(event);
      if (option === "Repair") repairBridge(event, BRIDGE_MIDDLE);
      else if (option === "Walk-across") crossBrokenBridge(event, BRIDGE_MIDDLE);
      return;
    }
    if (RUNITE_BRIDGE_IDS.has(objectId)) {
      crossRuniteBridge(event);
      return;
    }
    if (CAVE_BRIDGE_IDS.has(objectId)) {
      crossCaveBridge(event);
      return;
    }
    if (objectId === EAST_CAVE) {
      enterCave(event, true);
      return;
    }
    if (objectId === WEST_CAVE || objectId === MIDDLE_CAVE) {
      enterCave(event, false);
      return;
    }
    if (objectId === SPINNING_WHEEL) {
      spinYakHair(event);
      return;
    }
    if (objectId === WOODCUTTING_STUMP) {
      useWoodcuttingStump(event);
    }
  }

  // ==========================================================================
  // Item and NPC interactions
  // ==========================================================================

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== HRH_HRAFN || itemId !== RAW_TUNA) return;
    event.handled = true;
    player.getInventory().deleteNumber(RAW_TUNA, 1);
    play(player, npcId, "starting-off-tuna-delivery-giving-tuna-to-hrafn-directly-when-given-raw-tuna");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(NEEDLE) || !pair.has(CURED_YAK_HIDE)) return;
    if (stageOf(player) < STAGE_DECREE_DELIVERED) return;
    event.handled = true;
    const crafting = player.getSkillManager().getMaxLevel(Skill.CRAFTING);
    if (!hasItem(player, THREAD)) {
      player.sendMessage("You need some thread to make armour from yak hide.");
      return;
    }
    if (crafting < 46 && crafting < 43) {
      player.sendMessage("You need a Crafting level of 43 to make armour from yak hide.");
      return;
    }
    const hides = player.getInventory().getAmount(CURED_YAK_HIDE);
    if (hides >= 2 && !hasItem(player, YAK_HIDE_BODY) && crafting >= 46) {
      player.getInventory().deleteNumber(CURED_YAK_HIDE, 2);
      player.getInventory().deleteNumber(THREAD, 1);
      player.getInventory().adds(YAK_HIDE_BODY, 1);
      player.sendMessage("You make yak-hide body armour.");
      return;
    }
    if (!hasItem(player, YAK_HIDE_LEGS) && crafting >= 43) {
      player.getInventory().deleteNumber(CURED_YAK_HIDE, 1);
      player.getInventory().deleteNumber(THREAD, 1);
      player.getInventory().adds(YAK_HIDE_LEGS, 1);
      player.sendMessage("You make yak-hide leg armour.");
      return;
    }
    player.sendMessage(
      hides < 2
        ? "You need 2 pieces of cured yak hide to make yak-hide body armour."
        : "You need a Crafting level of 46 to make yak-hide body armour."
    );
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (!TAX_BAG_IDS.has(itemId)) return;
    if (!String(event.option ?? "").startsWith("Check")) return;
    event.handled = true;
    player.sendMessage(`The bag contains ${taxAmount(player)} gold pieces.`);
  }

  function handleNpcDeath(event) {
    const { killer, npcId } = event;
    if (!killer) return;
    if (FRENZIED_TROLL_IDS.has(npcId)) {
      if (stageOf(killer) < STAGE_CHAMPION || quest.isComplete(killer)) return;
      const kills = trollKills(killer);
      if (kills >= 10) return;
      killer.setAttribute(TROLL_KILLS_ATTRIBUTE, kills + 1);
      if (kills + 1 >= 10) {
        setStage(killer, STAGE_TEN_TROLLS);
        killer.sendMessage("You have defeated enough trolls to attack the King.");
      }
      return;
    }
    if (npcId === ICE_TROLL_KING) {
      if (stageOf(killer) < STAGE_TEN_TROLLS || quest.isComplete(killer)) return;
      setStage(killer, STAGE_HEAD_TAKEN);
      killer.getInventory().adds(TROLL_HEAD, 1);
      killer.sendMessage("You take the Troll King's head as proof of your victory.");
    }
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Jatizso and Neitiznot settle their differences.</str>",
        "<str>I became Champion of Neitiznot and killed the Ice Troll King.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const lines = [];
    if (stage >= STAGE_STARTED) {
      lines.push("<str>Mord Gunnars ferried me to the Fremennik Isles.</str>");
    }
    if (stage >= STAGE_TUNA_TASK) {
      lines.push("<str>King Gjuki Sorvott IV asked me to help him.</str>");
    }
    if (stage >= STAGE_ORE_TASK) {
      lines.push("<str>I fed HRH Hrafn raw tuna and was tasked with ores.</str>");
    }
    if (stage >= STAGE_ORES_DELIVERED) {
      lines.push("<str>I delivered the ores and the King explained his plan.</str>");
    }
    if (stage >= STAGE_JESTER_MISSION && stage < STAGE_PERFORMED) {
      lines.push("I should entertain Burgher Mawnis Burowgar in the jester costume,");
      lines.push("then report what I overheard to Slug Hemligssen.");
    }
    if (stage >= STAGE_PERFORMED && stage < STAGE_SPY_REPORTED) {
      lines.push("I should report to <col=800000>Slug Hemligssen</col> about the plans.");
    }
    if (stage >= STAGE_SPY_REPORTED && stage < STAGE_ROPES_DELIVERED) {
      lines.push("I should gather eight ropes and take them to Mawnis Burowgar.");
    }
    if (stage >= STAGE_ROPES_DELIVERED && stage < STAGE_LOGS_DELIVERED) {
      lines.push("I need eight split logs for Thakkrad's bridges.");
    }
    if (stage >= STAGE_LOGS_DELIVERED && stage < STAGE_BRIDGES_REPAIRED) {
      lines.push("I should repair the two broken bridges north of Neitiznot.");
    }
    if (stage >= STAGE_BRIDGES_REPAIRED && stage < STAGE_WINDOW_TAX) {
      lines.push("I should travel to Jatizso and find out what King Sorvott knows.");
    }
    if (stage === STAGE_WINDOW_TAX) {
      lines.push("I should collect the Window Tax from Jatizso's shopkeepers.");
    }
    if (stage === STAGE_WINDOW_PAID) {
      lines.push("I should collect the new Beard Tax from Jatizso's shopkeepers.");
    }
    if (stage === STAGE_BEARD_PAID) {
      lines.push("I should report back to <col=800000>Slug Hemligssen</col> again.");
    }
    if (stage === STAGE_JESTER_AGAIN) {
      lines.push("I should take the decree from King Sorvott to Mawnis Burowgar.");
    }
    if (stage >= STAGE_DECREE_DELIVERED && stage < STAGE_ARMOUR_DONE) {
      lines.push("Thakkrad is guiding my Fremennik warrior rites: I need yakhide armour.");
    }
    if (stage === STAGE_ARMOUR_DONE) {
      lines.push("I should make a Neitiznot shield at the woodcutting stump.");
    }
    if (stage >= STAGE_CHAMPION && stage < STAGE_HEAD_TAKEN) {
      lines.push("I am Champion of Neitiznot: I must slay 10 ice trolls in the eastern cave,");
      lines.push(`then defeat the Ice Troll King. Trolls killed: ${Math.min(10, trollKills(player))}/10.`);
    }
    if (stage >= STAGE_HEAD_TAKEN) {
      lines.push("I should take the Troll King's head to Mawnis Burowgar.");
    }
    if (lines.length > 0) return lines;
    return [
      "I can start this quest by talking to <col=800000>Mord Gunnars</col>",
      "at the northernmost dock in <col=800000>Rellekka</col>.",
    ];
  }

  function offerCombatXp(player, round) {
    const choices = [
      ["Attack", Skill.ATTACK],
      ["Strength", Skill.STRENGTH],
      ["Defence", Skill.DEFENCE],
      ["Hitpoints", Skill.HITPOINTS],
    ];
    const grant = (label, skill) => {
      player.getSkillManager().addExperiences(skill, 10000);
      player.sendMessage(`You are awarded 10,000 ${label} experience.`);
      if (round === 1) offerCombatXp(player, 2);
    };
    const pairs = [];
    for (const [label, skill] of choices) {
      pairs.push(label, () => grant(label, skill));
    }
    api.sendMultiChatboxPrompt(player, `Choose a combat skill (${round} of 2)`, ...pairs);
  }

  function grantRewards(player, quest, options = {}) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CONSTRUCTION, 5000);
    skills.addExperiences(Skill.CRAFTING, 5000);
    skills.addExperiences(Skill.WOODCUTTING, 10000);
    // A completion without experience (a league's quest pack) offers no combat XP either.
    if (options.experience === false) return;
    // NpcDialogues sends sendInterfaceRemoval right after the final action, which
    // would wipe a prompt opened now: open it on the next tick instead.
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      offerCombatXp(player, 1);
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        offerCombatXp(player, 1);
      })
    );
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(CHEST_ATTRIBUTE);
  api.persistAttribute(PERFORMANCES_ATTRIBUTE);
  api.persistAttribute(MISSION_ATTRIBUTE);
  api.persistAttribute(MISSION2_ATTRIBUTE);
  api.persistAttribute(QUIZ1_ATTRIBUTE);
  api.persistAttribute(QUIZ2_ATTRIBUTE);
  api.persistAttribute(BRIDGES_ATTRIBUTE);
  api.persistAttribute(TAX_ATTRIBUTE);
  api.persistAttribute(WINDOW_TAXES_ATTRIBUTE);
  api.persistAttribute(BEARD_TAXES_ATTRIBUTE);
  api.persistAttribute(VANLIGGA_ATTRIBUTE);
  api.persistAttribute(BORK_ATTRIBUTE);
  api.persistAttribute(TROLL_KILLS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_fremennik_isles",
    name: "The Fremennik Isles",
    varpId: VARP_FREMENNIK_ISLES,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 5000, label: "Construction" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 5000, label: "Crafting" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 10000, label: "Woodcutting" },
    ],
    rewardItemId: HELM_OF_NEITIZNOT,
    rewardItemLabel: "Helm of Neitiznot",
    otherRewards: ["Two lots of 10,000 Combat experience (Attack, Strength, Defence or Hitpoints)"],
    buildJournal,
    onReward: grantRewards,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("King Gjuki Sorvott IV", { "Talk-to": talkToKing });
  api.onNpcInteraction("Mawnis Burowgar", { "Talk-to": talkToMawnis });
  api.onNpcInteraction("Kjedelig Uppsen", { "Talk-to": talkToKjedelig });
  api.onNpcInteraction("Trogen Konungarde", { "Talk-to": talkToKjedelig });
  api.onNpcInteraction(handleSpecialTalk);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onNpcDeath(handleNpcDeath);
};
