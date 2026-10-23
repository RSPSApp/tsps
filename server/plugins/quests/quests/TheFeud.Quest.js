/**
 * The Feud (members).
 *
 * The words come from the "The Feud" transcript page (plus the "Bandit
 * (Pollnivneach)", "Drunken Ali", "Menaphite Thug", "Cowardly Bandit", "Ali the
 * Kebab seller" and "Ali the Snake Charmer" pages the dump splits it across);
 * this plugin supplies the variant selector per NPC/stage, the prose-condition
 * answers, every item hand-in, the gang-receipt and pickpocket progression, the
 * mayor's-house safe, the snake charm, the camel trough, the Tough Guy/Bandit
 * champion fights and the completion reward.
 *
 * Stage varbit: 334 "feud_var" (varp 435 "main_feud_var", bits 0-5). Evidence:
 * cache varbit dump names 334 feud_var on varp 435; RuneLite Quest Helper maps
 * this quest to VarbitID.FEUD_VAR and its step values 0..27; the cache NPC
 * post-quest transforms (e.g. 11871 Drunken Ali) switch at index 28, which is
 * why completion writes 28.
 *
 * Stages (varbit 334):
 *   0 not started             15 have the jewels
 *   1 asked by Ali Morrisane  16 looking for the traitor
 *   2 learnt of the feud      17 told Ali the Operator
 *   3 bought-camels agreed    18 the Hag wants a snake
 *   4 receipts handed over    19 gave the Hag the snake
 *   5 joined the Menaphites   20 gave the Hag the dung, got poison
 *   6 first pocket failed     22 poisoned Traitorous Ali's drink
 *   7 urchin distracted       23 reported to Ali the Operator
 *   8 second pocket done      24 defeat the Tough Guy
 *   9 got the oak blackjack   25 defeat the Bandit champion
 *  10 villager knocked out    26 spoke to Ali the Mayor
 *  11 third pocket done       27 report back to Ali Morrisane
 *  12 second job: the safe   28 complete
 *  13 hid behind the cactus
 *  14 in the mayor's house
 *
 * Sibling varbits of varp 435/436 mirrored where the cache reads them:
 * 315 feud_var_talk_gangs, 316 feud_var_comp_gangs, 318 feud_var_drink (beers),
 * 320 feud_var_mayorsdoor, 321 feud_var_drink_found, 335/336 boss visibility,
 * 338 feud_bandit_boss_vis, 340 feud_npc_multi, 342 feud_found_trait,
 * 343 feud_talk_villager, 14604 feud_mayor_multivar.
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 15,000 Thieving XP, 500 coins, an
 * oak blackjack, a desert disguise, a willow blackjack (Tough Guy drop) and an
 * adamant scimitar (bandit champion drop).
 *
 * Sources: OSRS Wiki "The Feud" + its Transcript and Quick guide; RuneLite Quest
 * Helper's TheFeud.java for the stage values; the cache loc/npc/varbit dumps for
 * ids and placements.
 *
 * Gaps / approximations:
 *  - The wiki transcript has no words for the safe dial, the red hot sauce on the
 *    trough, the bucket on the dung, a successful pickpocket/knock-out or the
 *    money pot, so those play short OSRS-style messages instead of invented
 *    dialogue; the safe itself is a two-page chatbox dial requiring 1,1,2,3,5,8.
 *  - The shared Doors plugin opens the mayor's house door without the keys; the
 *    keys still play their transcript and advance the stage, but the door cannot
 *    be locked against a player who skips them.
 *  - Damage/stun and the "thug attacks you" stage directions are applied
 *    (2 damage + stun on a failed pocket); the shared gang NPCs are not made
 *    aggressive, so the summoned Tough Guy / champion are the fights.
 *  - The urchin's distracted villager is any villager near you, not the flagged
 *    one; the lured/knocked-out state is tracked per player, not per NPC.
 *  - Beneath Cursed Sands' completion changes the Menaphite Leader's lore
 *    branch; answered via quest:is-complete when that quest is loaded.
 */
module.exports = function registerTheFeudQuest(api) {
  const {
    Equipment,
    GameObject,
    HitDamage,
    HitMask,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
    TimerKey,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Feud";
  const START_HOOK = "quest:the-feud:start";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const VARBIT_FEUD_VAR = 334; // varp 435, bits 0-5
  const VARBIT_TALK_GANGS = 315;
  const VARBIT_COMP_GANGS = 316;
  const VARBIT_FEUD_DRINK = 318;
  const VARBIT_MAYORSDOOR = 320;
  const VARBIT_DRINK_FOUND = 321;
  const VARBIT_BOSS_VIS = 335;
  const VARBIT_BOSS_VIS2 = 336;
  const VARBIT_BANDIT_BOSS_VIS = 338;
  const VARBIT_NPC_MULTI = 340;
  const VARBIT_FOUND_TRAIT = 342;
  const VARBIT_TALK_VILLAGER = 343;
  const VARBIT_MAYOR_MULTIVAR = 14604;

  const STAGE_STARTED = 1;
  const STAGE_DRUNK = 2;
  const STAGE_GANGS = 3;
  const STAGE_RECEIPTS = 4;
  const STAGE_JOINED = 5;
  const STAGE_POCKET_ONE = 6;
  const STAGE_DISTRACTED = 7;
  const STAGE_POCKET_TWO = 8;
  const STAGE_BLACKJACK = 9;
  const STAGE_KNOCKED_OUT = 10;
  const STAGE_POCKET_THREE = 11;
  const STAGE_SAFE_JOB = 12;
  const STAGE_STAKED_OUT = 13;
  const STAGE_INSIDE = 14;
  const STAGE_JEWELS = 15;
  const STAGE_TRAITOR = 16;
  const STAGE_TRAITOR_TOLD = 17;
  const STAGE_POISON_PLAN = 18;
  const STAGE_SNAKE_GIVEN = 19;
  const STAGE_POISON_MADE = 20;
  const STAGE_POISONED = 22;
  const STAGE_REPORTED = 23;
  const STAGE_TOUGH_GUY = 24;
  const STAGE_CHAMPION = 25;
  const STAGE_MAYOR = 26;
  const STAGE_FINAL = 27;
  const STAGE_COMPLETE = 28;

  const ALI_MORRISANE_ID = NpcIdentifiers.ALI_MORRISANE; // 3533
  const DRUNKEN_ALI_ID = NpcIdentifiers.DRUNKEN_ALI; // 3534
  const BARMAN_ID = NpcIdentifiers.ALI_THE_BARMAN; // 3535
  const CAMEL_MAN_ID = NpcIdentifiers.ALI_THE_CAMEL_MAN; // 3538
  const URCHIN_ID = NpcIdentifiers.STREET_URCHIN; // 3539
  const MAYOR_ID = NpcIdentifiers.ALI_THE_MAYOR; // 3540
  const HAG_ID = NpcIdentifiers.ALI_THE_HAG; // 3541
  const SNAKE_CHARMER_ID = NpcIdentifiers.ALI_THE_SNAKE_CHARMER; // 3542
  const DESERT_SNAKE_ID = NpcIdentifiers.SNAKE_5; // 3544
  const DESERT_SNAKE_OUTSIDE_ID = NpcIdentifiers.SNAKE_6; // 12084
  const MENAPHITE_LEADER_ID = NpcIdentifiers.MENAPHITE_LEADER; // 3547
  const OPERATOR_ID = NpcIdentifiers.ALI_THE_OPERATOR; // 3548
  const MENAPHITE_THUG_ID = NpcIdentifiers.MENAPHITE_THUG; // 3549
  const MENAPHITE_THUG_2_ID = NpcIdentifiers.MENAPHITE_THUG_2; // 3550
  const TOUGH_GUY_ID = NpcIdentifiers.TOUGH_GUY; // 3551
  const BANDIT_LEADER_ID = NpcIdentifiers.BANDIT_LEADER; // 733
  const BANDIT_ID = NpcIdentifiers.BANDIT_7; // 734
  const BANDIT_2_ID = NpcIdentifiers.BANDIT_8; // 735
  const BANDIT_3_ID = NpcIdentifiers.BANDIT_9; // 736
  const BANDIT_4_ID = NpcIdentifiers.BANDIT_10; // 737
  const BANDIT_CHAMPION_ID = NpcIdentifiers.BANDIT_CHAMPION; // 738
  const COWARDLY_BANDIT_ID = NpcIdentifiers.COWARDLY_BANDIT; // 739
  const MAYOR_POSTQUEST_ID = NpcIdentifiers.HAKEEM_THE_MAYOR; // 11879

  const MAYOR_IDS = new Set([MAYOR_ID, MAYOR_POSTQUEST_ID]);
  const DESERT_SNAKE_IDS = new Set([DESERT_SNAKE_ID, DESERT_SNAKE_OUTSIDE_ID]);
  const THUG_IDS = new Set([MENAPHITE_THUG_ID, MENAPHITE_THUG_2_ID]);
  const BANDIT_IDS = new Set([BANDIT_ID, BANDIT_2_ID, BANDIT_3_ID, BANDIT_4_ID]);
  const VILLAGER_IDS = new Set([
    NpcIdentifiers.VILLAGER, // 3552
    NpcIdentifiers.VILLAGER_2, // 3553
    NpcIdentifiers.VILLAGER_3, // 3554
    NpcIdentifiers.VILLAGER_4, // 3555
    NpcIdentifiers.VILLAGER_5, // 3556
    NpcIdentifiers.VILLAGER_6, // 3557
    NpcIdentifiers.VILLAGER_7, // 3558
    NpcIdentifiers.VILLAGER_8, // 3559
    NpcIdentifiers.VILLAGER_9, // 3560
  ]);

  const BEER_ITEM_ID = ItemIdentifiers.BEER; // 1917
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const KEYS_ITEM_ID = ItemIdentifiers.KEYS; // 4589
  const JEWELS_ITEM_ID = ItemIdentifiers.JEWELS; // 4590
  const KHARIDIAN_HEADPIECE_ITEM_ID = ItemIdentifiers.KHARIDIAN_HEADPIECE; // 4591
  const FAKE_BEARD_ITEM_ID = ItemIdentifiers.FAKE_BEARD; // 4593
  const KARIDIAN_DISGUISE_ITEM_ID = ItemIdentifiers.KARIDIAN_DISGUISE; // 4595
  const NOTE_FIBONACCI_ITEM_ID = ItemIdentifiers.NOTE; // 4597, Note (Fibonacci)
  const NOTE_NUMBERS_ITEM_ID = ItemIdentifiers.NOTE_2; // 4598, Note (numbers)
  const OAK_BLACKJACK_ITEM_ID = ItemIdentifiers.OAK_BLACKJACK; // 4599
  const WILLOW_BLACKJACK_ITEM_ID = ItemIdentifiers.WILLOW_BLACKJACK; // 4600
  const ADAMANT_SCIMITAR_ITEM_ID = ItemIdentifiers.ADAMANT_SCIMITAR; // 1331
  const UGTHANKI_DUNG_ITEM_ID = ItemIdentifiers.UGTHANKI_DUNG; // 4601
  const RECEIPT_ITEM_ID = ItemIdentifiers.RECEIPT; // 4603
  const HAGS_POISON_ITEM_ID = ItemIdentifiers.HAGS_POISON; // 4604
  const SNAKE_CHARM_ITEM_ID = ItemIdentifiers.SNAKE_CHARM; // 4605
  const SNAKE_BASKET_ITEM_ID = ItemIdentifiers.SNAKE_BASKET; // 4606
  const SNAKE_BASKET_FULL_ITEM_ID = ItemIdentifiers.SNAKE_BASKET_FULL; // 4607
  const RED_HOT_SAUCE_ITEM_ID = ItemIdentifiers.RED_HOT_SAUCE; // 4610
  const DESERT_DISGUISE_ITEM_ID = ItemIdentifiers.DESERT_DISGUISE; // 4611
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET; // 1925

  const MONEY_POT_OBJECT_ID = ObjectIdentifiers.MONEY_POT; // 6230
  const DOOR_LEFT_OBJECT_ID = ObjectIdentifiers.DOOR_165; // 6238
  const DOOR_RIGHT_OBJECT_ID = ObjectIdentifiers.DOOR_167; // 6240
  const POISON_TABLE_OBJECT_ID = ObjectIdentifiers.TABLE_62; // 6246
  const TROUGH_OBJECT_IDS = new Set([
    ObjectIdentifiers.TROUGH_7, // 6255
    ObjectIdentifiers.TROUGH_8, // 6256
  ]);
  const DUNG_OBJECT_ID = ObjectIdentifiers.DUNG; // 6257
  const BED_OBJECT_ID = ObjectIdentifiers.BED_37; // 6274
  const DESK_OBJECT_ID = ObjectIdentifiers.STUDY_DESK_3; // 6275
  const LANDSCAPE_OBJECT_ID = ObjectIdentifiers.LANDSCAPE_3; // 6276
  const CACTUS_OBJECT_ID = ObjectIdentifiers.CACTUS_7; // 6277

  const DUNG_TILE = { x: 3342, y: 2959, z: 0 };
  const SAFE_SEQUENCE = [1, 1, 2, 3, 5, 8];

  // ==========================================================================
  // State
  // ==========================================================================

  const BEERS_ATTRIBUTE = "quest.the_feud.beers";
  const GANGS_ATTRIBUTE = "quest.the_feud.gangs";
  const RECEIPTS_ATTRIBUTE = "quest.the_feud.receipts";
  const FLAGS_ATTRIBUTE = "quest.the_feud.flags";

  const GANG_MENAPHITE = 1;
  const GANG_BANDIT = 2;
  const RECEIPT_MENAPHITE = 1;
  const RECEIPT_BANDIT = 2;

  const FLAG_TOUGH_SPAWNED = 1 << 0;
  const FLAG_TOUGH_DEAD = 1 << 1;
  const FLAG_CHAMPION_SPAWNED = 1 << 2;
  const FLAG_CHAMPION_DEAD = 1 << 3;
  const FLAG_URCHIN_PAID = 1 << 4;
  const FLAG_URCHIN_DENIED = 1 << 5;
  const FLAG_SAFE_UNLOCKED = 1 << 6;
  const FLAG_DISTRACTED = 1 << 7;
  const FLAG_KNOCKED_OUT = 1 << 8;
  const FLAG_HAG_ASKED = 1 << 9;

  let quest;
  let dungInstalled = false;
  const safeDials = new WeakMap();
  const snakeAttempts = new WeakMap();

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, flag) {
    return (flags(player) & flag) !== 0;
  }

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag);
  }

  function clearFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) & ~flag);
  }

  function beers(player) {
    return Number(player.getAttribute(BEERS_ATTRIBUTE)) || 0;
  }

  function gangs(player) {
    return Number(player.getAttribute(GANGS_ATTRIBUTE)) || 0;
  }

  function receipts(player) {
    return Number(player.getAttribute(RECEIPTS_ATTRIBUTE)) || 0;
  }

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function stage(player) {
    return quest.getStage(player);
  }

  function questActive(player) {
    return quest.isStarted(player) && !quest.isComplete(player);
  }

  function sendVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value);
  }

  function wearingGloves(player) {
    const hands = player.getEquipment().get(Equipment.HANDS_SLOT);
    return Boolean(hands?.getId?.() && hands.getId() !== -1);
  }

  function wearingDisguise(player) {
    const head = player.getEquipment().get(Equipment.HEAD_SLOT);
    const id = head?.getId?.();
    return id === DESERT_DISGUISE_ITEM_ID || id === KARIDIAN_DISGUISE_ITEM_ID;
  }

  function wearingOakBlackjack(player) {
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return weapon?.getId?.() === OAK_BLACKJACK_ITEM_ID;
  }

  function villagerNear(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return false;
    const here = player.getLocation();
    for (const npc of world.getNpcs()) {
      if (!npc) continue;
      const id = npc.getContentId ? npc.getContentId(player) : npc.getId();
      if (!VILLAGER_IDS.has(id)) continue;
      const location = npc.getLocation();
      if (Math.abs(location.getX() - here.getX()) <= 12 && Math.abs(location.getY() - here.getY()) <= 12) {
        return true;
      }
    }
    return false;
  }

  /** Cache feud_var_talk_gangs mapping: 0 none, 2 menaphite, 3 bandit/both. */
  function talkGangsValue(player) {
    const talked = gangs(player);
    if (talked === 0) return 0;
    if (talked === GANG_MENAPHITE) return 2;
    return 3;
  }

  /** The few sibling varbits the cache transforms read, re-derived per player. */
  function syncVarbits(player) {
    const current = stage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_FEUD_DRINK, Math.min(3, beers(player)));
    sender.sendVarbit(VARBIT_TALK_GANGS, talkGangsValue(player));
    sender.sendVarbit(VARBIT_COMP_GANGS, receipts(player) === (RECEIPT_MENAPHITE | RECEIPT_BANDIT) ? 1 : 0);
    sender.sendVarbit(VARBIT_MAYORSDOOR, current >= STAGE_INSIDE ? 1 : 0);
    sender.sendVarbit(VARBIT_DRINK_FOUND, current >= STAGE_POISON_PLAN ? 1 : 0);
    sender.sendVarbit(VARBIT_FOUND_TRAIT, current >= STAGE_TRAITOR_TOLD ? 1 : 0);
    sender.sendVarbit(VARBIT_TALK_VILLAGER, current >= STAGE_MAYOR ? 2 : current >= STAGE_CHAMPION ? 1 : 0);
    sender.sendVarbit(VARBIT_NPC_MULTI, current >= STAGE_JOINED ? 2 : 0);
    sender.sendVarbit(VARBIT_BOSS_VIS, current >= STAGE_REPORTED && current < STAGE_CHAMPION ? 1 : 0);
    sender.sendVarbit(VARBIT_BOSS_VIS2, current >= STAGE_REPORTED && current < STAGE_CHAMPION ? 1 : 0);
    sender.sendVarbit(VARBIT_BANDIT_BOSS_VIS, current >= STAGE_CHAMPION ? 1 : 0);
    sender.sendVarbit(VARBIT_MAYOR_MULTIVAR, quest.isComplete(player) ? 1 : 0);
  }

  function start(player, variant, npcId = OPERATOR_ID) {
    if (!variant) return false;
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  function damageAndStun(player) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(2, HitMask.RED)]);
    player.getTimers().registers(TimerKey.STUN, 8);
  }

  // ==========================================================================
  // Transcript variants per NPC and stage
  // ==========================================================================

  function selectAliMorrisane(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) return null;
    if (current === 0) return "getting-started";
    if (current >= STAGE_FINAL) return "reporting-back-to-ali-morrisane-talking-to-ali-morrisane";
    return "asking-the-locals-talking-to-ali-morrisane-before-any-other-progress";
  }

  function selectDrunkenAli(player) {
    const count = beers(player);
    if (count >= 3) return "asking-the-locals-talking-to-drunken-ali-after-the-third-beer";
    if (count === 2) return "asking-the-locals-talking-to-drunken-ali-after-the-second-beer";
    if (count === 1) return "asking-the-locals-talking-to-drunken-ali-after-the-first-beer";
    return "asking-the-locals-talking-to-drunken-ali-initial-dialogue";
  }

  function selectCamelMan(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) return null;
    if (current === STAGE_FINAL) return "reporting-back-to-ali-morrisane-talking-to-ali-the-camel-man";
    if (current >= STAGE_JOINED) return "joining-a-gang-talking-to-ali-the-camel-man";
    if (current === STAGE_RECEIPTS) return "now-we-have-camels-talking-to-ali-the-camel-man-again";
    return "acquiring-some-camels-talking-to-ali-the-camel-man";
  }

  function selectUrchin(player) {
    const current = stage(player);
    if (current >= STAGE_MAYOR) return "celebrating-your-victory-talking-to-a-street-urchin";
    if (current === STAGE_POCKET_TWO) {
      if (hasFlag(player, FLAG_URCHIN_DENIED)) {
        return "pickpocketing-part-three-talking-to-a-street-urchin-after-denying-them-the-money-earlier";
      }
      if (!hasFlag(player, FLAG_URCHIN_PAID)) {
        return "pickpocketing-part-three-talking-to-a-street-urchin-first-time-after-the-distraction";
      }
      return "pickpocketing-part-three-talking-to-a-street-urchin-after-failing-the-distraction-again";
    }
    if (current === STAGE_DISTRACTED) return "picking-another-pocket-talking-to-a-street-urchin";
    if (current >= STAGE_BLACKJACK) {
      return "pickpocketing-part-three-talking-to-a-street-urchin-trying-the-distraction-again";
    }
    return "asking-the-locals-talking-to-a-street-urchin";
  }

  function selectMayor(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) return "after-the-feud";
    if (current >= STAGE_FINAL) return "reporting-back-to-ali-morrisane-talking-to-ali-the-mayor";
    if (current >= STAGE_MAYOR) return "finishing-up-talking-to-ali-the-mayor";
    if (current >= STAGE_CHAMPION) return "celebrating-your-victory-talking-to-ali-the-mayor";
    if (current === STAGE_JEWELS) return "now-you-ve-stolen-the-jewels-talking-to-ali-the-mayor";
    if (current >= STAGE_JOINED) return "joining-a-gang-talking-to-ali-the-mayor";
    return "asking-the-locals-talking-to-ali-the-mayor";
  }

  function selectBarman(player) {
    const current = stage(player);
    if (current >= STAGE_FINAL) return "reporting-back-to-ali-morrisane-talking-to-ali-the-barman";
    if (current >= STAGE_POISON_PLAN && current <= STAGE_POISONED) {
      return "planning-a-murder-talking-to-ali-the-barman";
    }
    return null;
  }

  function selectOperator(player) {
    const current = stage(player);
    if (current >= STAGE_CHAMPION) return "celebrating-your-victory-talking-to-ali-the-operator";
    if (current >= STAGE_REPORTED) return "meeting-the-leader-talking-to-ali-the-operator";
    if (current === STAGE_POISONED) return "reporting-the-deed-talking-to-ali-the-operator";
    if (current >= STAGE_POISON_PLAN) return "planning-a-murder-talking-to-ali-the-operator";
    if (current === STAGE_TRAITOR_TOLD) return "searching-for-the-traitor-talking-to-ali-the-operator-again";
    if (current === STAGE_TRAITOR) return "searching-for-the-traitor-talking-to-ali-the-operator";
    if (current === STAGE_JEWELS) return "now-you-ve-stolen-the-jewels-talking-to-ali-the-operator";
    if (current === STAGE_INSIDE) return "breaking-and-entering-speaking-to-ali-the-operator-again";
    if (current === STAGE_STAKED_OUT) return "breaking-and-entering-talking-to-ali-the-operator";
    if (current === STAGE_SAFE_JOB) return "staking-out-the-house-talking-to-ali-the-operator";
    if (current === STAGE_BLACKJACK || current === STAGE_KNOCKED_OUT || current === STAGE_POCKET_THREE) {
      return "learning-to-steal-talking-to-ali-the-operator-again";
    }
    if (current === STAGE_POCKET_TWO) return "pickpocketing-part-three-talking-to-ali-the-operator";
    if (current === STAGE_DISTRACTED) return "learning-to-steal-talking-to-ali-the-operator-again";
    if (current === STAGE_POCKET_ONE) return "picking-another-pocket-talking-to-ali-the-operator";
    if (current === STAGE_JOINED || current === STAGE_RECEIPTS) return "joining-a-gang-talking-to-ali-the-operator";
    return null;
  }

  /** Stage 11 talks to the operator for the second job. */
  function operatorVariant(player) {
    const current = stage(player);
    if (current === STAGE_POCKET_THREE) return "welcome-to-the-menaphites-talking-to-ali-the-operator";
    return selectOperator(player);
  }

  function selectThug(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) {
      return { page: "Menaphite Thug", variant: "after-the-feud" };
    }
    if (current >= STAGE_CHAMPION) return "celebrating-your-victory-talking-to-a-menaphite-thug";
    if (current >= STAGE_REPORTED) return "meeting-the-leader-talking-to-a-menaphite-thug";
    if (current === STAGE_TRAITOR) return "searching-for-the-traitor-talking-to-a-menaphite-thug";
    if (current >= STAGE_DISTRACTED && current <= STAGE_TRAITOR_TOLD) {
      return "learning-to-steal-talking-to-a-menaphite-thug";
    }
    if (current === STAGE_RECEIPTS && held(player, RECEIPT_ITEM_ID)) {
      return "now-we-have-camels-talking-to-a-menaphite-thug";
    }
    if (current >= STAGE_JOINED && current <= STAGE_POCKET_ONE) {
      return "joining-a-gang-talking-to-a-menaphite-thug";
    }
    if (current >= STAGE_DRUNK) return "asking-the-gangs-talking-to-a-menaphite-thug";
    return "before-the-feud";
  }

  function selectBandit(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) {
      return { page: "Bandit (Pollnivneach)", variant: "after-killing-the-bandit-champion-during-the-feud-quest" };
    }
    if (current >= STAGE_FINAL) return "finishing-up-talking-to-a-bandit";
    if (current >= STAGE_MAYOR) return "running-the-bandits-out-of-town-talking-to-a-bandit";
    if (current >= STAGE_CHAMPION) return "celebrating-your-victory-talking-to-a-bandit";
    if (current === STAGE_RECEIPTS && held(player, RECEIPT_ITEM_ID)) {
      return "now-we-have-camels-talking-to-a-bandit";
    }
    if (current >= STAGE_DISTRACTED && current <= STAGE_TRAITOR_TOLD) {
      return "learning-to-steal-talking-to-a-bandit";
    }
    if (current >= STAGE_JOINED) return "joining-a-gang-talking-to-a-bandit";
    if (current >= STAGE_DRUNK) return "asking-the-gangs-talking-to-a-bandit";
    return { page: "Bandit (Pollnivneach)", variant: "before-any-quest-progression" };
  }

  function selectBanditLeader(player) {
    const current = stage(player);
    if (current >= STAGE_FINAL) return "finishing-up-talking-to-the-bandit-leader";
    if (current >= STAGE_MAYOR) {
      return "running-the-bandits-out-of-town-upon-defeating-the-bandit-champion";
    }
    if (hasFlag(player, FLAG_CHAMPION_SPAWNED) && !hasFlag(player, FLAG_CHAMPION_DEAD)) {
      return "running-the-bandits-out-of-town-talking-to-the-bandit-leader-again";
    }
    return "running-the-bandits-out-of-town-talking-to-the-bandit-leader";
  }

  function selectCowardlyBandit(player) {
    const current = stage(player);
    if (current >= STAGE_FINAL) return "finishing-up-talking-to-the-cowardly-bandit";
    if (current >= STAGE_CHAMPION) return "celebrating-your-victory-talking-to-the-cowardly-bandit";
    if (current >= STAGE_DISTRACTED && current <= STAGE_POCKET_THREE) {
      return "learning-to-steal-talking-to-the-cowardly-bandit";
    }
    return null;
  }

  function selectMenaphiteLeader(player) {
    const current = stage(player);
    if (hasFlag(player, FLAG_TOUGH_DEAD)) return "meeting-the-leader-after-defeating-the-tough-guy";
    if (hasFlag(player, FLAG_TOUGH_SPAWNED)) return "meeting-the-leader-talking-to-the-menaphite-leader-again";
    if (current >= STAGE_REPORTED) return "meeting-the-leader-talking-to-the-menaphite-leader";
    return null;
  }

  function selectHag(player) {
    const current = stage(player);
    if (current >= STAGE_MAYOR) return "reporting-the-deed-talking-to-ali-the-hag";
    if (current >= STAGE_POISON_MADE) return "the-end-of-traitorous-ali-talking-to-ali-the-hag";
    if (current === STAGE_SNAKE_GIVEN) {
      return held(player, UGTHANKI_DUNG_ITEM_ID)
        ? "planning-a-murder-talking-to-ali-the-hag-with-ughthanki-dung"
        : "planning-a-murder-talking-to-ali-the-hag-again-2";
    }
    if (current === STAGE_POISON_PLAN) {
      if (held(player, SNAKE_BASKET_FULL_ITEM_ID)) {
        return "planning-a-murder-talking-to-ali-the-hag-with-a-snake-basket-full";
      }
      return hasFlag(player, FLAG_HAG_ASKED)
        ? "planning-a-murder-talking-to-ali-the-hag-again"
        : "planning-a-murder-talking-to-ali-the-hag";
    }
    return null;
  }

  function selectVillager(player) {
    const current = stage(player);
    if (current >= STAGE_MAYOR) return "finishing-up-talking-to-a-villager";
    if (current >= STAGE_TOUGH_GUY) return "celebrating-your-victory-talking-to-a-villager";
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case "fUE8zu": // combat level below the recommended 40
        return player.getSkillManager().getCombatLevel() < 40;
      case "1vrJkf":
      case "0mVAz6":
        return freeSlots(player) < 2;
      case "j4AL20":
        return !held(player, COINS_ITEM_ID, 500);
      case "pafRPJ":
        return !held(player, COINS_ITEM_ID, 1000);
      case "CqJAFW":
        return freeSlots(player) >= 2 && held(player, COINS_ITEM_ID, 500);
      case "JRWDga":
        return freeSlots(player) >= 2 && held(player, COINS_ITEM_ID, 1000);
      case "46-_RR":
        return held(player, RECEIPT_ITEM_ID, 2);
      case "TLlnSM":
        return freeSlots(player) < 1;
      case "Ur8WRb":
        return freeSlots(player) >= 1;
      case "lwtOr1":
      case "DISQTW":
        return !held(player, RECEIPT_ITEM_ID);
      case "qd_-9p":
      case "s9HTiy":
        return held(player, RECEIPT_ITEM_ID);
      case "hfoWpv":
        return !villagerNear(player);
      case "Ckg-pN":
        return !held(player, COINS_ITEM_ID, 20);
      case "9hcB0P":
        return held(player, COINS_ITEM_ID, 20);
      case "nwXKn8":
        return !villagerNear(player);
      case "ZKPcrT":
        return villagerNear(player);
      case "KY4SjA":
        return freeSlots(player) < 1;
      case "Xi_BRp":
        return held(player, OAK_BLACKJACK_ITEM_ID);
      case "r7Fk13":
        return freeSlots(player) >= 1 && !held(player, OAK_BLACKJACK_ITEM_ID);
      case "PS9Zkl":
        return freeSlots(player) < 1;
      case "-o41LU":
        return freeSlots(player) >= 1;
      case "oLi_g5":
      case "jAxBry":
        return !held(player, KEYS_ITEM_ID);
      case "vKoALD":
        return held(player, KEYS_ITEM_ID);
      case "SN-vhR":
        return stage(player) < STAGE_SAFE_JOB || stage(player) > STAGE_JEWELS;
      case "25LRX8":
        return !wearingGloves(player);
      case "4lxqMw":
        return !wearingDisguise(player);
      case "3PO7Fj":
        return wearingGloves(player) && wearingDisguise(player);
      case "xODpAG":
      case "nL1D1D":
      case "jmu8Rb":
        return freeSlots(player) < 1;
      case "7B6v3w":
      case "JkeIGq":
      case "vJnv1A":
        return freeSlots(player) >= 1;
      // The safe transcript only plays once the dial is solved.
      case "VFou1d":
      case "C6OcPG":
        return false;
      case "-DPpJR":
        return true;
      case "j-BBPh":
        return !held(player, JEWELS_ITEM_ID);
      case "2sXVLI":
        return held(player, JEWELS_ITEM_ID);
      case "XaDmLM":
        return snakeAttempts.get(player) === false;
      case "GwLkqx":
        return snakeAttempts.get(player) === true;
      case "PJBV8l":
        return held(player, HAGS_POISON_ITEM_ID);
      case "AM3jTo":
        return !held(player, HAGS_POISON_ITEM_ID);
      case "qu_Dx2":
        return !questComplete("beneath_cursed_sands", player);
      case "_DkAxL":
        return questComplete("beneath_cursed_sands", player);
      case "Y8ytAH": // kebab seller: full inventory
        return freeSlots(player) < 1;
      case "tNA2KV": // kebab seller: otherwise
        return freeSlots(player) >= 1;
      case "R-ZW5K": // snake charmer: no room for the kit
        return freeSlots(player) < 2;
      case "nJAtvc": // snake charmer: has the charm, lost the basket
        return held(player, SNAKE_CHARM_ITEM_ID) && !held(player, SNAKE_BASKET_ITEM_ID);
      case "8yZQDi": // snake charmer: has the basket, lost the charm
        return !held(player, SNAKE_CHARM_ITEM_ID) && held(player, SNAKE_BASKET_ITEM_ID);
      case "18_JZ8": // snake charmer: neither
        return !held(player, SNAKE_CHARM_ITEM_ID) && !held(player, SNAKE_BASKET_ITEM_ID);
      case "bQculI": // snake charmer: both
        return held(player, SNAKE_CHARM_ITEM_ID) && held(player, SNAKE_BASKET_ITEM_ID);
      default:
        return null;
    }
  }

  function questComplete(key, player) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  // ==========================================================================
  // NPC conversations
  // ==========================================================================

  function talk(player, variant, npcId = OPERATOR_ID) {
    return start(player, variant, npcId);
  }

  function handleAliMorrisaneTalk(event) {
    const { player, npcId } = event;
    if (npcId !== ALI_MORRISANE_ID) return false;
    const variant = selectAliMorrisane(player);
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
  }

  function handleDrunkenAliTalk(event) {
    const { player, npcId } = event;
    if (npcId !== DRUNKEN_ALI_ID) return false;
    if (stage(player) > STAGE_DRUNK) return false;
    if (!talk(player, selectDrunkenAli(player), npcId)) return false;
    event.handled = true;
  }

  function handleBarmanTalk(event) {
    const { player, npcId } = event;
    if (npcId !== BARMAN_ID) return false;
    const variant = selectBarman(player);
    if (!variant) return false;
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
  }

  function handleCamelManTalk(event) {
    const { player, npcId } = event;
    if (npcId !== CAMEL_MAN_ID) return false;
    const variant = selectCamelMan(player);
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
  }

  function handleUrchinTalk(event) {
    const { player, npcId } = event;
    if (npcId !== URCHIN_ID) return false;
    if (!questActive(player)) return false;
    const variant = selectUrchin(player);
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
    if (stage(player) === STAGE_DISTRACTED && villagerNear(player)) {
      setFlag(player, FLAG_DISTRACTED);
    }
  }

  function handleMayorTalk(event) {
    const { player, npcId } = event;
    if (!MAYOR_IDS.has(npcId)) return false;
    if (npcId === MAYOR_POSTQUEST_ID) return false;
    const variant = selectMayor(player);
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
    if (stage(player) === STAGE_MAYOR) quest.setStage(player, STAGE_FINAL);
  }

  function handleOperatorTalk(event) {
    const { player, npcId } = event;
    if (npcId !== OPERATOR_ID) return false;
    const current = stage(player);
    const variant = operatorVariant(player);
    if (!variant) return false;
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
    if (current === STAGE_POCKET_ONE) quest.setStage(player, STAGE_DISTRACTED);
    if (current === STAGE_POCKET_THREE) quest.setStage(player, STAGE_SAFE_JOB);
    if (current === STAGE_TRAITOR_TOLD && variant === "searching-for-the-traitor-talking-to-ali-the-operator-again") {
      quest.setStage(player, STAGE_POISON_PLAN);
    }
    if (current === STAGE_POISONED && variant === "reporting-the-deed-talking-to-ali-the-operator") {
      quest.setStage(player, STAGE_REPORTED);
      syncVarbits(player);
    }
  }

  function handleMenaphiteLeaderTalk(event) {
    const { player, npcId } = event;
    if (npcId !== MENAPHITE_LEADER_ID) return false;
    if (stage(player) < STAGE_REPORTED) return false;
    const variant = selectMenaphiteLeader(player);
    if (!variant) return false;
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
    if (stage(player) === STAGE_REPORTED) quest.setStage(player, STAGE_TOUGH_GUY);
  }

  function handleMenaphiteThugTalk(event) {
    const { player, npcId } = event;
    if (!THUG_IDS.has(npcId)) return false;
    const choice = selectThug(player);
    const variant = typeof choice === "string" ? choice : choice.variant;
    const page = typeof choice === "string" ? PAGE : choice.page;
    if (!startTranscript(api, player, npcId, page, variant)) return false;
    event.handled = true;
    if (stage(player) === STAGE_DRUNK && variant === "asking-the-gangs-talking-to-a-menaphite-thug") {
      markGangTalked(player, GANG_MENAPHITE);
    }
    if (stage(player) === STAGE_TRAITOR && variant === "searching-for-the-traitor-talking-to-a-menaphite-thug") {
      quest.setStage(player, STAGE_TRAITOR_TOLD);
      sendVarbit(player, VARBIT_FOUND_TRAIT, 1);
    }
  }

  function handleBanditTalk(event) {
    const { player, npcId } = event;
    if (!BANDIT_IDS.has(npcId)) return false;
    const choice = selectBandit(player);
    const variant = typeof choice === "string" ? choice : choice.variant;
    const page = typeof choice === "string" ? PAGE : choice.page;
    if (!startTranscript(api, player, npcId, page, variant)) return false;
    event.handled = true;
    if (stage(player) === STAGE_DRUNK && variant === "asking-the-gangs-talking-to-a-bandit") {
      markGangTalked(player, GANG_BANDIT);
    }
  }

  function handleBanditLeaderTalk(event) {
    const { player, npcId } = event;
    if (npcId !== BANDIT_LEADER_ID) return false;
    if (stage(player) < STAGE_CHAMPION) return false;
    const variant = selectBanditLeader(player);
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
  }

  function handleCowardlyBanditTalk(event) {
    const { player, npcId } = event;
    if (npcId !== COWARDLY_BANDIT_ID) return false;
    if (!questActive(player)) return false;
    const variant = selectCowardlyBandit(player);
    if (!variant) return false;
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
  }

  function handleHagTalk(event) {
    const { player, npcId } = event;
    if (npcId !== HAG_ID) return false;
    if (!questActive(player)) return false;
    const variant = selectHag(player);
    if (!variant) return false;
    if (!startTranscript(api, player, npcId, PAGE, variant)) return false;
    event.handled = true;
    if (variant === "planning-a-murder-talking-to-ali-the-hag") {
      setFlag(player, FLAG_HAG_ASKED);
    }
  }

  function handleVillagerTalk(event) {
    const { player, npcId } = event;
    if (!VILLAGER_IDS.has(npcId)) return false;
    if (!questActive(player)) return false;
    const variant = selectVillager(player);
    if (!variant) return false;
    if (!talk(player, variant, npcId)) return false;
    event.handled = true;
    if (stage(player) === STAGE_TOUGH_GUY && hasFlag(player, FLAG_TOUGH_DEAD)) {
      quest.setStage(player, STAGE_CHAMPION);
      syncVarbits(player);
    }
  }

  function markGangTalked(player, gang) {
    player.setAttribute(GANGS_ATTRIBUTE, gangs(player) | gang);
    sendVarbit(player, VARBIT_TALK_GANGS, talkGangsValue(player));
    if (gangs(player) === (GANG_MENAPHITE | GANG_BANDIT) && stage(player) === STAGE_DRUNK) {
      quest.setStage(player, STAGE_GANGS);
    }
  }

  // ==========================================================================
  // Pickpocketing the villagers
  // ==========================================================================

  function failPocket(player, npcId) {
    startTranscript(api, player, npcId, PAGE, "picking-another-pocket-trying-to-pickpocket-a-villager-again");
  }

  function handleVillagerPickpocket(event) {
    const { player, npcId } = event;
    if (!VILLAGER_IDS.has(npcId)) return false;
    if (!questActive(player)) return false;
    const current = stage(player);
    if (current < STAGE_JOINED || current > STAGE_POCKET_THREE) {
      event.handled = true;
      return;
    }
    event.handled = true;
    if (current === STAGE_JOINED || current === STAGE_POCKET_ONE || current === STAGE_BLACKJACK) {
      if (current === STAGE_JOINED) quest.setStage(player, STAGE_POCKET_ONE);
      failPocket(player, npcId);
      return;
    }
    if (current === STAGE_DISTRACTED && hasFlag(player, FLAG_DISTRACTED)) {
      clearFlag(player, FLAG_DISTRACTED);
      quest.setStage(player, STAGE_POCKET_TWO);
      player.getInventory().adds(COINS_ITEM_ID, 15);
      player.sendMessage("You pick the villager's pocket.");
      return;
    }
    if (current === STAGE_KNOCKED_OUT && hasFlag(player, FLAG_KNOCKED_OUT)) {
      clearFlag(player, FLAG_KNOCKED_OUT);
      quest.setStage(player, STAGE_POCKET_THREE);
      player.getInventory().adds(COINS_ITEM_ID, 15);
      player.sendMessage("You pick the villager's pocket.");
      return;
    }
    failPocket(player, npcId);
  }

  function handleVillagerKnockOut(event) {
    const { player, npcId } = event;
    if (!VILLAGER_IDS.has(npcId)) return false;
    if (!questActive(player)) return false;
    event.handled = true;
    if (stage(player) !== STAGE_BLACKJACK) return;
    if (!wearingOakBlackjack(player)) {
      player.sendMessage("You need to equip a blackjack to knock the villager out.");
      return;
    }
    setFlag(player, FLAG_KNOCKED_OUT);
    quest.setStage(player, STAGE_KNOCKED_OUT);
    player.sendMessage("You knock the villager unconscious.");
  }

  function handleVillagerLure(event) {
    const { player, npcId } = event;
    if (!VILLAGER_IDS.has(npcId)) return false;
    if (!questActive(player)) return false;
    const current = stage(player);
    if (current < STAGE_BLACKJACK || current > STAGE_POCKET_THREE) return false;
    if (!startTranscript(api, player, npcId, PAGE, "pickpocketing-part-three-luring-a-villager")) return false;
    event.handled = true;
  }

  // ==========================================================================
  // Items on NPCs
  // ==========================================================================

  function handleItemOnNpc(event) {
    const { player } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    const itemId = event.itemId ?? event.inventoryItemId;
    if (npcId === DRUNKEN_ALI_ID && stage(player) === STAGE_STARTED) {
      event.handled = true;
      if (itemId !== BEER_ITEM_ID) {
        startTranscript(api, player, npcId, PAGE, "asking-the-locals-talking-to-drunken-ali-using-an-item-other-than-a-beer-on-him");
        return;
      }
      const count = Math.min(3, beers(player) + 1);
      player.setAttribute(BEERS_ATTRIBUTE, count);
      sendVarbit(player, VARBIT_FEUD_DRINK, count);
      const variant =
        count === 3
          ? "asking-the-locals-talking-to-drunken-ali-using-the-third-beer-on-him"
          : count === 2
            ? "asking-the-locals-talking-to-drunken-ali-using-the-second-beer-on-him"
            : "asking-the-locals-talking-to-drunken-ali-using-the-first-beer-on-him";
      startTranscript(api, player, npcId, PAGE, variant);
      if (count === 3) {
        quest.setStage(player, STAGE_DRUNK);
      }
      return;
    }
    if (DESERT_SNAKE_IDS.has(npcId) && itemId === SNAKE_CHARM_ITEM_ID) {
      const current = stage(player);
      if (!questActive(player) || current < STAGE_POISON_PLAN || current > STAGE_SNAKE_GIVEN) return false;
      event.handled = true;
      if (!held(player, SNAKE_BASKET_ITEM_ID)) {
        player.sendMessage("You need an empty snake basket for the snake.");
        return;
      }
      const success = Math.random() < 0.6;
      snakeAttempts.set(player, success);
      startTranscript(api, player, npcId, PAGE, "planning-a-murder-charming-a-snake");
      snakeAttempts.delete(player);
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleDialogueHook(event) {
    if (event.hook !== START_HOOK) return;
    if (event.npcId !== ALI_MORRISANE_ID) return;
    const { player } = event;
    if (stage(player) === 0) {
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === OPERATOR_ID && option === "Yes, of course, those bandits should be taught a lesson.") {
      if (stage(player) === STAGE_JOINED) {
        quest.setStage(player, STAGE_POCKET_ONE);
        sendVarbit(player, VARBIT_NPC_MULTI, 2);
      }
      return;
    }
    if (npcId === URCHIN_ID && stage(player) === STAGE_POCKET_TWO) {
      if (option === "Here you go, thanks.") {
        if (held(player, COINS_ITEM_ID, 10)) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, 10);
        }
        setFlag(player, FLAG_URCHIN_PAID);
      } else if (option === "What money?") {
        setFlag(player, FLAG_URCHIN_DENIED);
      }
    }
  }

  function handleConditionChosen(event) {
    const { stepId, player } = event;
    if (stepId === "9hcB0P" && held(player, COINS_ITEM_ID, 20)) {
      player.getInventory().deleteNumber(COINS_ITEM_ID, 20);
      setFlag(player, FLAG_URCHIN_PAID);
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (event.step?.type === "end" && event.npcId === BANDIT_LEADER_ID && stage(player) === STAGE_CHAMPION) {
      spawnLeaderGuard(player, BANDIT_LEADER_ID, BANDIT_CHAMPION_ID, FLAG_CHAMPION_SPAWNED);
    }
    switch (stepId) {
      // Camel purchase: 500 / 1,000 coins for two receipts.
      case "1JYri1":
      case "8PdnLd": {
        const price = stepId === "1JYri1" ? 500 : 1000;
        if (held(player, COINS_ITEM_ID, price) && freeSlots(player) >= 2) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, price);
          player.getInventory().adds(RECEIPT_ITEM_ID, 2);
        }
        if (stage(player) < STAGE_RECEIPTS) quest.setStage(player, STAGE_RECEIPTS);
        event.handled = true;
        return;
      }
      // Camel man tops up missing receipts.
      case "KfEJLa":
        if (!held(player, RECEIPT_ITEM_ID, 2) && freeSlots(player) >= 1) {
          player.getInventory().adds(RECEIPT_ITEM_ID, Math.min(2, 2 - player.getInventory().getAmount(RECEIPT_ITEM_ID)));
        }
        event.handled = true;
        return;
      // Hand a receipt to a gang.
      case "-Jb-bz":
      case "pHGlPz": {
        if (held(player, RECEIPT_ITEM_ID)) {
          player.getInventory().deleteNumber(RECEIPT_ITEM_ID, 1);
        }
        const bit = stepId === "-Jb-bz" ? RECEIPT_MENAPHITE : RECEIPT_BANDIT;
        const next = receipts(player) | bit;
        player.setAttribute(RECEIPTS_ATTRIBUTE, next);
        sendVarbit(player, VARBIT_COMP_GANGS, next === (RECEIPT_MENAPHITE | RECEIPT_BANDIT) ? 1 : 0);
        if (next === (RECEIPT_MENAPHITE | RECEIPT_BANDIT) && stage(player) === STAGE_RECEIPTS) {
          quest.setStage(player, STAGE_JOINED);
        }
        event.handled = true;
        return;
      }
      case "z89WnM":
        damageAndStun(player);
        event.handled = true;
        return;
      case "S1K0jh":
        if (!held(player, OAK_BLACKJACK_ITEM_ID)) player.getInventory().adds(OAK_BLACKJACK_ITEM_ID, 1);
        if (stage(player) === STAGE_POCKET_TWO) quest.setStage(player, STAGE_BLACKJACK);
        event.handled = true;
        return;
      case "GnwMcX":
      case "eI3U9S":
      case "Bbwgr6":
        if (!held(player, KEYS_ITEM_ID)) player.getInventory().adds(KEYS_ITEM_ID, 1);
        event.handled = true;
        return;
      case "KMB_VR":
        if (stage(player) === STAGE_SAFE_JOB) quest.setStage(player, STAGE_STAKED_OUT);
        event.handled = true;
        return;
      case "sxI5_2":
        if (stage(player) === STAGE_STAKED_OUT) quest.setStage(player, STAGE_INSIDE);
        sendVarbit(player, VARBIT_MAYORSDOOR, 1);
        event.handled = true;
        return;
      // The study desk and the bed notes.
      case "zEZ9VR":
        if (!held(player, NOTE_NUMBERS_ITEM_ID)) player.getInventory().adds(NOTE_NUMBERS_ITEM_ID, 1);
        event.handled = true;
        return;
      case "xacVn3":
        if (!held(player, NOTE_FIBONACCI_ITEM_ID)) player.getInventory().adds(NOTE_FIBONACCI_ITEM_ID, 1);
        event.handled = true;
        return;
      // The safe opens with the jewels.
      case "Tj1PIq":
        if (!held(player, JEWELS_ITEM_ID)) player.getInventory().adds(JEWELS_ITEM_ID, 1);
        setFlag(player, FLAG_SAFE_UNLOCKED);
        if (stage(player) === STAGE_INSIDE) quest.setStage(player, STAGE_JEWELS);
        event.handled = true;
        return;
      case "9K8uBx":
        if (held(player, JEWELS_ITEM_ID)) player.getInventory().deleteNumber(JEWELS_ITEM_ID, 1);
        if (stage(player) === STAGE_JEWELS) quest.setStage(player, STAGE_TRAITOR);
        event.handled = true;
        return;
      // Snake charming and the poison.
      case "MzP-E3":
        if (held(player, SNAKE_BASKET_ITEM_ID)) player.getInventory().deleteNumber(SNAKE_BASKET_ITEM_ID, 1);
        player.getInventory().adds(SNAKE_BASKET_FULL_ITEM_ID, 1);
        event.handled = true;
        return;
      case "nEt0jL":
        if (held(player, SNAKE_BASKET_FULL_ITEM_ID)) player.getInventory().deleteNumber(SNAKE_BASKET_FULL_ITEM_ID, 1);
        if (stage(player) < STAGE_SNAKE_GIVEN) quest.setStage(player, STAGE_SNAKE_GIVEN);
        event.handled = true;
        return;
      case "TiFd_S":
        if (held(player, UGTHANKI_DUNG_ITEM_ID)) player.getInventory().deleteNumber(UGTHANKI_DUNG_ITEM_ID, 1);
        player.getInventory().adds(HAGS_POISON_ITEM_ID, 1);
        if (stage(player) < STAGE_POISON_MADE) quest.setStage(player, STAGE_POISON_MADE);
        event.handled = true;
        return;
      case "d72gnq":
        player.getInventory().adds(HAGS_POISON_ITEM_ID, 1);
        event.handled = true;
        return;
      case "rQTsZU":
        if (held(player, HAGS_POISON_ITEM_ID)) player.getInventory().deleteNumber(HAGS_POISON_ITEM_ID, 1);
        if (stage(player) < STAGE_POISONED) {
          quest.setStage(player, STAGE_POISONED);
          sendVarbit(player, VARBIT_DRINK_FOUND, 1);
        }
        event.handled = true;
        return;
      // The gang violence.
      case "AsCtr4": {
        spawnLeaderGuard(player, MENAPHITE_LEADER_ID, TOUGH_GUY_ID, FLAG_TOUGH_SPAWNED);
        event.handled = true;
        return;
      }
      case "byv5b1":
      case "YLtyn7": {
        spawnLeaderGuard(player, BANDIT_LEADER_ID, BANDIT_CHAMPION_ID, FLAG_CHAMPION_SPAWNED);
        event.handled = true;
        return;
      }
      case "6eHv81":
        event.handled = true;
        return;
      // The barman's free beer and Ali Morrisane's reward.
      case "hV9lSG":
        player.getInventory().adds(BEER_ITEM_ID, 1);
        event.handled = true;
        return;
      case "Nhv81S":
        event.handled = true;
        return;
      case "_jFbux":
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) {
          quest.complete(player);
          syncVarbits(player);
        }
        return;
      // Kebab seller gives the red hot sauce.
      case "ekGbm6":
        if (!held(player, RED_HOT_SAUCE_ITEM_ID)) player.getInventory().adds(RED_HOT_SAUCE_ITEM_ID, 1);
        event.handled = true;
        return;
      // Snake charmer replacement pieces.
      case "Y3IL4b":
        player.getInventory().adds(SNAKE_BASKET_ITEM_ID, 1);
        event.handled = true;
        return;
      case "YJYlWt":
        player.getInventory().adds(SNAKE_CHARM_ITEM_ID, 1);
        event.handled = true;
        return;
      case "wXgto_":
        player.getInventory().adds(SNAKE_CHARM_ITEM_ID, 1);
        player.getInventory().adds(SNAKE_BASKET_ITEM_ID, 1);
        event.handled = true;
        return;
      default:
        return;
    }
  }

  /** Spawns a leader's summoned champion next to them, owner-only. */
  function spawnLeaderGuard(player, leaderId, guardId, spawnedFlag) {
    if (hasFlag(player, spawnedFlag)) return;
    const world = api.getWorld();
    let leader = null;
    if (world?.getNpcs) {
      for (const npc of world.getNpcs()) {
        const id = npc?.getContentId ? npc.getContentId(player) : npc?.getId?.();
        if (id === leaderId) {
          leader = npc;
          break;
        }
      }
    }
    const location = leader?.getLocation?.() ?? player.getLocation();
    setFlag(player, spawnedFlag);
    api.spawnNpc({
      id: guardId,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  // ==========================================================================
  // Object and item interactions
  // ==========================================================================

  function actionOf(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return String(actions[event.clickType - 1] ?? "");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === CACTUS_OBJECT_ID && actionOf(event) === "Hide-behind") {
      const current = stage(player);
      if (current < STAGE_SAFE_JOB || current > STAGE_STAKED_OUT) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "staking-out-the-house-hiding-behind-the-cactus");
      return;
    }
    if (objectId === DESK_OBJECT_ID && actionOf(event) === "Search") {
      if (stage(player) !== STAGE_INSIDE) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "breaking-and-entering-searching-the-mayor-s-study-desk");
      return;
    }
    if (objectId === BED_OBJECT_ID && actionOf(event) === "Search") {
      if (stage(player) !== STAGE_INSIDE) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "breaking-and-entering-searching-the-mayor-s-bed");
      return;
    }
    if (objectId === LANDSCAPE_OBJECT_ID && actionOf(event) === "Search") {
      if (stage(player) !== STAGE_INSIDE) return;
      event.handled = true;
      if (hasFlag(player, FLAG_SAFE_UNLOCKED)) {
        if (!held(player, JEWELS_ITEM_ID)) player.getInventory().adds(JEWELS_ITEM_ID, 1);
        return;
      }
      player.sendMessage(
        "On the wall hangs a rather nondescript picture. On closer inspection you notice that it's covering something: a safe."
      );
      openSafeDial(player);
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === MONEY_POT_OBJECT_ID && itemId === COINS_ITEM_ID) {
      const current = stage(player);
      if (!questActive(player) || current < STAGE_POISON_PLAN || current > STAGE_SNAKE_GIVEN) return;
      event.handled = true;
      startTranscript(api, player, SNAKE_CHARMER_ID, "Ali the Snake Charmer", "standard-dialogue-using-a-coin-on-the-money-pot");
      return;
    }
    if (TROUGH_OBJECT_IDS.has(objectId) && itemId === RED_HOT_SAUCE_ITEM_ID) {
      if (!questActive(player) || stage(player) < STAGE_SNAKE_GIVEN) return;
      event.handled = true;
      player.getInventory().deleteNumber(RED_HOT_SAUCE_ITEM_ID, 1);
      installDung();
      player.sendMessage("You pour the red hot sauce into the trough.");
      return;
    }
    if (objectId === DUNG_OBJECT_ID && itemId === BUCKET_ITEM_ID) {
      if (!questActive(player)) return;
      event.handled = true;
      player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
      player.getInventory().adds(UGTHANKI_DUNG_ITEM_ID, 1);
      player.sendMessage("You scoop the dung into the bucket.");
      return;
    }
    if (objectId === POISON_TABLE_OBJECT_ID && itemId === HAGS_POISON_ITEM_ID) {
      if (!questActive(player) || stage(player) < STAGE_POISON_MADE) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "the-end-of-traitorous-ali-using-the-hag-s-poison-on-the-table");
      return;
    }
    if (objectId === POISON_TABLE_OBJECT_ID && held(player, HAGS_POISON_ITEM_ID) === false) {
      if (!questActive(player) || stage(player) < STAGE_POISONED) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "the-end-of-traitorous-ali-using-an-item-on-the-drink-after-poisoning-it");
      return;
    }
    if ((objectId === DOOR_LEFT_OBJECT_ID || objectId === DOOR_RIGHT_OBJECT_ID) && itemId === KEYS_ITEM_ID) {
      if (!questActive(player) || stage(player) < STAGE_STAKED_OUT) return;
      event.handled = true;
      startTranscript(api, player, OPERATOR_ID, PAGE, "breaking-and-entering-using-the-keys-on-the-mayor-s-house-door");
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(KHARIDIAN_HEADPIECE_ITEM_ID) || !pair.has(FAKE_BEARD_ITEM_ID)) return;
    event.handled = true;
    if (held(player, DESERT_DISGUISE_ITEM_ID)) {
      player.sendMessage("You already have a desert disguise.");
      return;
    }
    player.getInventory().deleteNumber(KHARIDIAN_HEADPIECE_ITEM_ID, 1);
    player.getInventory().deleteNumber(FAKE_BEARD_ITEM_ID, 1);
    player.getInventory().adds(DESERT_DISGUISE_ITEM_ID, 1);
    player.sendMessage("You combine the headpiece and the fake beard into a desert disguise.");
  }

  // ==========================================================================
  // The safe dial
  // ==========================================================================

  function openSafeDial(player) {
    safeDials.set(player, { index: 0, page: 0 });
    showSafePrompt(player);
  }

  function showSafePrompt(player) {
    const state = safeDials.get(player);
    if (!state) return;
    const digits = state.page === 0 ? [1, 2, 3, 4] : [5, 6, 7, 8];
    const pairs = [];
    for (const digit of digits) {
      pairs.push(String(digit), () => pickSafeDigit(player, digit));
    }
    if (state.page === 0) {
      pairs.push("More...", () => {
        const current = safeDials.get(player);
        if (!current) return;
        current.page = 1;
        showSafePrompt(player);
      });
    } else {
      pairs.push("Reset", () => {
        const current = safeDials.get(player);
        if (!current) return;
        current.index = 0;
        current.page = 0;
        player.sendMessage("Clank!! That must be the safe resetting itself.");
        showSafePrompt(player);
      });
    }
    api.sendMultiChatboxPrompt(player, "Safe", ...pairs);
  }

  function pickSafeDigit(player, digit) {
    const state = safeDials.get(player);
    if (!state) return;
    if (SAFE_SEQUENCE[state.index] !== digit) {
      safeDials.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage(
        "A rather loud clank reverberates from the safe. It sounds as if you've gotten the combination wrong. You wonder how many more attempts you have before the safe permanently locks itself."
      );
      return;
    }
    state.index++;
    if (state.index >= SAFE_SEQUENCE.length) {
      safeDials.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      startTranscript(api, player, OPERATOR_ID, PAGE, "breaking-and-entering-searching-the-mayor-s-landscape");
      return;
    }
    state.page = state.index >= 4 ? 1 : 0;
    showSafePrompt(player);
  }

  function installDung() {
    if (dungInstalled) return;
    dungInstalled = true;
    ObjectManager.register(
      new GameObject(DUNG_OBJECT_ID, new Location(DUNG_TILE.x, DUNG_TILE.y, DUNG_TILE.z), 10, 0, null),
      true
    );
  }

  // ==========================================================================
  // Deaths, login and journal
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event.killer;
    if (!player) return;
    const { npcId } = event;
    if (npcId === TOUGH_GUY_ID) {
      setFlag(player, FLAG_TOUGH_DEAD);
      return;
    }
    if (npcId === BANDIT_CHAMPION_ID) {
      setFlag(player, FLAG_CHAMPION_DEAD);
      const reward = held(player, WILLOW_BLACKJACK_ITEM_ID)
        ? ADAMANT_SCIMITAR_ITEM_ID
        : WILLOW_BLACKJACK_ITEM_ID;
      player.getInventory().adds(reward, 1);
      if (stage(player) === STAGE_CHAMPION) {
        quest.setStage(player, STAGE_MAYOR);
        syncVarbits(player);
      }
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    if (quest.isStarted(player)) syncVarbits(player);
  }

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current >= STAGE_COMPLETE) {
      return [
        "<str>Ali Morrisane asked me to find his nephew Ali in Pollnivneach.</str>",
        "<str>I got involved in the feud between the Menaphites and the bandits,</str>",
        "<str>robbed the mayor's jewels and poisoned Traitorous Ali for Ali the</str>",
        "<str>Operator, then defeated the Tough Guy and the Bandit champion.</str>",
        "<str>The Mayor explained Ali's nephew had been smuggled out of town, and</str>",
        "<str>Ali Morrisane rewarded me for the news.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (current <= 0) {
      return [
        "I can start this quest by talking to <col=800000>Ali Morrisane</col>",
        "in northern Al Kharid.",
        "",
        "I need level 30 Thieving to start it.",
      ];
    }
    const lines = [
      "<str>Ali Morrisane asked me to find his nephew Ali in Pollnivneach.</str>",
      "",
    ];
    const hints = {
      [STAGE_STARTED]: [
        "I should travel to <col=800000>Pollnivneach</col> and look for Ali.",
        "Drunken Ali in the bar may know something.",
      ],
      [STAGE_DRUNK]: [
        "Drunken Ali says Ali's nephew is in trouble with the gangs.",
        "I should ask both the <col=800000>Menaphites</col> and the",
        "<col=800000>bandits</col> about the feud.",
      ],
      [STAGE_GANGS]: [
        "Both gangs blame the other for stealing a camel.",
        "I should buy two camels from <col=800000>Ali the Camel Man</col>",
        "and offer one to each gang.",
      ],
      [STAGE_RECEIPTS]: [
        "I have the camel receipts; I should show one to each gang.",
      ],
      [STAGE_JOINED]: [
        "I've joined <col=800000>Ali the Operator</col>'s gang.",
        "He wants me to pickpocket a villager to prove myself.",
      ],
      [STAGE_POCKET_ONE]: [
        "The villager caught me. Ali the Operator may have advice.",
      ],
      [STAGE_DISTRACTED]: [
        "The street urchin is distracting a villager.",
        "I should pick the distracted villager's pocket.",
      ],
      [STAGE_POCKET_TWO]: [
        "I've picked two pockets. Ali the Operator may have",
        "another idea for the third.",
      ],
      [STAGE_BLACKJACK]: [
        "Ali the Operator gave me an <col=800000>oak blackjack</col>.",
        "I should equip it and knock a villager out.",
      ],
      [STAGE_KNOCKED_OUT]: [
        "The villager is knocked out; I should pick their pocket.",
      ],
      [STAGE_POCKET_THREE]: [
        "I've proved myself. I should talk to Ali the Operator",
        "for my next job.",
      ],
      [STAGE_SAFE_JOB]: [
        "Ali the Operator wants the mayor's wife's jewels.",
        "I need a <col=800000>desert disguise</col>, gloves and to hide",
        "behind the <col=800000>cactus</col> by the mayor's house.",
      ],
      [STAGE_STAKED_OUT]: [
        "The coast is clear. I should use the <col=800000>keys</col>",
        "on the mayor's front door.",
      ],
      [STAGE_INSIDE]: [
        "I'm in the mayor's house. Search the desk, bed and the",
        "<col=800000>landscape</col> for the safe (1-1-2-3-5-8).",
      ],
      [STAGE_JEWELS]: [
        "I have the jewels. I should take them to Ali the Operator.",
      ],
      [STAGE_TRAITOR]: [
        "Ali the Operator wants a traitor rooted out.",
        "A <col=800000>Menaphite Thug</col> may know who it is.",
      ],
      [STAGE_TRAITOR_TOLD]: [
        "I know it was Traitorous Ali. I should tell Ali the Operator.",
      ],
      [STAGE_POISON_PLAN]: [
        "Ali the Operator wants Traitorous Ali killed. Ali the Barman",
        "knows where his drink is, and <col=800000>Ali the Hag</col> will",
        "make the poison if I bring her a snake.",
      ],
      [STAGE_SNAKE_GIVEN]: [
        "The Hag needs fresh <col=800000>camel dung</col> from the",
        "camel trough. Ali the Kebab seller has red hot sauce.",
      ],
      [STAGE_POISON_MADE]: [
        "I have the <col=800000>Hag's poison</col>. I should use it on",
        "Traitorous Ali's drink in the bar.",
      ],
      [STAGE_POISONED]: [
        "The drink is poisoned. I should tell Ali the Operator.",
      ],
      [STAGE_REPORTED]: [
        "I should meet the <col=800000>Menaphite Leader</col> outside",
        "the tent; he will set his Tough Guy on me.",
      ],
      [STAGE_TOUGH_GUY]: [
        "The Tough Guy is defeated. The villagers say the bandits now",
        "rule the town - I should see the <col=800000>Bandit Leader</col>.",
      ],
      [STAGE_CHAMPION]: [
        "I've broken the bandits' grip. I should talk to the",
        "<col=800000>Mayor</col> by the well.",
      ],
      [STAGE_MAYOR]: [
        "The Mayor explained Ali's nephew was smuggled out of town.",
        "I should report back to <col=800000>Ali Morrisane</col>.",
      ],
      [STAGE_FINAL]: [
        "I should report back to <col=800000>Ali Morrisane</col>",
        "in Al Kharid.",
      ],
    };
    lines.push(...(hints[current] ?? hints[STAGE_FINAL]));
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 15000);
    player.getInventory().adds(COINS_ITEM_ID, 499);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(BEERS_ATTRIBUTE);
  api.persistAttribute(GANGS_ATTRIBUTE);
  api.persistAttribute(RECEIPTS_ATTRIBUTE);
  api.persistAttribute(FLAGS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_feud",
    name: "The Feud",
    varpId: 435,
    varbitId: VARBIT_FEUD_VAR,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 15000, label: "Thieving" }],
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "500 Coins",
    otherRewards: ["Oak blackjack", "Desert disguise", "Willow blackjack", "Adamant scimitar"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Ali Morrisane", { "Talk-to": handleAliMorrisaneTalk });
  api.onNpcInteraction("Drunken Ali", { "Talk-to": handleDrunkenAliTalk });
  api.onNpcInteraction("Ali the Barman", { "Talk-to": handleBarmanTalk });
  api.onNpcInteraction("Ali the Camel Man", { "Talk-to": handleCamelManTalk });
  api.onNpcInteraction("Street urchin", { "Talk-to": handleUrchinTalk });
  api.onNpcInteraction("Ali the Mayor", { "Talk-to": handleMayorTalk });
  api.onNpcInteraction("Ali the Hag", { "Talk-to": handleHagTalk });
  api.onNpcInteraction("Ali the Operator", { "Talk-to": handleOperatorTalk });
  api.onNpcInteraction("Menaphite Leader", { "Talk-to": handleMenaphiteLeaderTalk });
  api.onNpcInteraction("Menaphite Thug", { "Talk-to": handleMenaphiteThugTalk });
  api.onNpcInteraction("Bandit", { "Talk-to": handleBanditTalk });
  api.onNpcInteraction("Bandit Leader", { "Talk-to": handleBanditLeaderTalk });
  api.onNpcInteraction("Cowardly Bandit", { "Talk-to": handleCowardlyBanditTalk });
  api.onNpcInteraction("Villager", {
    "Talk-to": handleVillagerTalk,
    Pickpocket: handleVillagerPickpocket,
    "Knock-Out": handleVillagerKnockOut,
    Lure: handleVillagerLure,
  });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);

  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
