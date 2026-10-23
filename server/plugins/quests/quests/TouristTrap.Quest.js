/**
 * The Tourist Trap (members).
 *
 * Quest Helper is the progression reference (pinned 06da90f). The durable
 * stages follow its varp 197 meaning: 0 not started, 1 Irena, 2 metal key,
 * 4 entering the camp, 7 slave clothes, 8/9 mining camp guard, 10 Al Shabim's
 * task, 11/12 Captain Siad's plans, 13/15 prototype dart, 16 Tenti pineapple,
 * 17 guard distracted, 18-26 Ana's barrel route, 27 escaped to Shantay Pass and
 * 30 complete (cache DB table 0 column 19 threshold).
 *
 * The words come from the "The Tourist Trap" transcript page. This plugin owns
 * the transcript variant selection, the item hand-outs/consumption, the object
 * and NPC transitions, and the final two-skill XP choice.
 *
 * The cache keeps this quest's characters as transform parents (the camp
 * captain is spawned as 4636, Irena as 6233/6234, the camp slave as 6232, and
 * the winch barrel and the flatback cart as the locs 18963 and 2682). The real
 * character, its options and its transcript only appear once the matching
 * varbit says so, so the plugin drives those varbits from the quest stage.
 */
module.exports = function registerTouristTrapQuest(api) {
  const { Skill, Location, Equipment, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const IRENA_NPC_IDS = new Set([
    NpcIdentifiers.IRENA,
    NpcIdentifiers.IRENA_2,
    6233, // tourtrap_qip_irena_multi_sad
    6234, // tourtrap_qip_irena_multi_happy
  ]);
  const ANA_NPC_IDS = new Set([NpcIdentifiers.ANA, NpcIdentifiers.ANA_2, NpcIdentifiers.ANA_3, 6230, 6231]);
  const MALE_SLAVE_NPC_IDS = new Set([
    NpcIdentifiers.MALE_SLAVE,
    NpcIdentifiers.MALE_SLAVE_2,
    NpcIdentifiers.MALE_SLAVE_3,
  ]);
  /**
   * The camp slave that walks out in the desert robes. The world spawns his
   * transform parent (6232), which the cache resolves to the male slave (4632)
   * or to the escaping slave (4633) by varbit 2803; the escaped slave owns the
   * "inside-the-camp-talking-to-the-escaping-slave" transcript variant.
   */
  const ESCAPING_SLAVE_NPC_IDS = new Set([NpcIdentifiers.ESCAPING_SLAVE]);
  const FEMALE_SLAVE_NPC_IDS = new Set([
    NpcIdentifiers.FEMALE_SLAVE,
    NpcIdentifiers.FEMALE_SLAVE_2,
    NpcIdentifiers.FEMALE_SLAVE_3,
  ]);
  const FEMALE_SLAVE_PAGE = "Female slave";
  const FEMALE_SLAVE_SPOKEN_VARIANT = "overhead-dialogue-when-spoken-to";
  const MINE_GUARD_NPC_IDS = new Set([4660, 4661, 4662, 4663, 4664, 4665, 4666, 4667, 4668, 4669, 4678]);
  const MERCENARY_CAPTAIN_NPC_ID = NpcIdentifiers.MERCENARY_CAPTAIN;
  const MERCENARY_GUARD_NPC_IDS = new Set([4656, 4657, 4658, 4659]);
  const CAPTAIN_SIAD_NPC_ID = NpcIdentifiers.CAPTAIN_SIAD;
  const AL_SHABIM_NPC_ID = NpcIdentifiers.AL_SHABIM;
  const MINE_CART_DRIVER_NPC_ID = NpcIdentifiers.MINE_CART_DRIVER;

  /**
   * The cache keeps this quest's NPCs and locs as transform parents: the real
   * character only shows up - with its own name, options and transcript - once
   * the matching varbit (all in varp 907) says so. These are the ids the cache
   * itself uses (CacheDefinitions.resolveNpc / ObjectDefinition.forPlayer).
   */
  const VARBIT_MINE_SLAVE = 2803;        // 0 male slave, 1 escaping slave
  const VARBIT_ANA_ON_LIFT = 2805;       // Ana rides the mine cart of the lift
  const VARBIT_IRENA_STATE = 2807;       // 0 sad Irena, 1 happy Irena
  const VARBIT_ANA_WINCH_BARREL = 2808;  // Ana in the barrel west of the winch
  const VARBIT_CART_ANA = 2809;          // 0 empty cart, 1 Ana on it, 2 cart gone

  const VARP_TOURIST_TRAP = 197;
  const STAGE_STARTED = 1;
  const STAGE_METAL_KEY = 2;
  const STAGE_ENTERED_CAMP = 4;
  const STAGE_SLAVE_CLOTHES = 7;
  const STAGE_GUARD_TALKED = 8;
  const STAGE_LEFT_CAMP = 9;
  const STAGE_SHABIM_TASK = 10;
  const STAGE_SEARCHED_BOOKCASE = 11;
  const STAGE_HAS_PLANS = 12;
  const STAGE_DART_TIP = 13;
  const STAGE_PROTOTYPE_DART = 15;
  const STAGE_HAS_PINEAPPLE = 16;
  const STAGE_GUARD_DISTRACTED = 17;
  const STAGE_IN_DEEP_MINE = 18;
  const STAGE_HAS_BARREL = 19;
  const STAGE_EAST_MINE = 20;
  const STAGE_ANA_IN_BARREL = 21;
  const STAGE_ANA_ON_CART = 22;
  const STAGE_ANA_SENT_UP = 23;
  const STAGE_ANA_SURFACE = 24;
  const STAGE_ANA_ON_CAMP_CART = 25;
  const STAGE_ESCAPED = 26;
  const STAGE_RETURNED = 27;
  const STAGE_COMPLETE = 30;

  const STAGE_VERSION_ATTRIBUTE = "the-tourist-trap:stage-version";
  const LEGACY_STAGE_VERSION_ATTRIBUTE = "quest.the_tourist_trap.stage-version";
  const STAGE_VERSION = 1;
  const SEARCHED_BOOKCASE_ATTRIBUTE = "the-tourist-trap:searched-bookcase";
  const DISTRACTED_SIAD_ATTRIBUTE = "the-tourist-trap:distracted-siad";
  const XP_CHOICES_ATTRIBUTE = "the-tourist-trap:xp-choices";
  /** The escaping slave has been caught and turned back into a male slave. */
  const ESCAPING_SLAVE_ATTRIBUTE = "the-tourist-trap:escaping-slave-turned-back";

  const ANA_IN_A_BARREL_ITEM_ID = ItemIdentifiers.ANA_IN_A_BARREL;
  const BARREL_ITEM_ID = ItemIdentifiers.BARREL;
  const METAL_KEY_ITEM_ID = ItemIdentifiers.METAL_KEY;
  const WROUGHT_IRON_KEY_ITEM_ID = ItemIdentifiers.WROUGHT_IRON_KEY;
  const BEDABIN_KEY_ITEM_ID = ItemIdentifiers.BEDABIN_KEY;
  const DESERT_SHIRT_ITEM_ID = ItemIdentifiers.DESERT_SHIRT;
  const DESERT_ROBE_ITEM_ID = ItemIdentifiers.DESERT_ROBE;
  const DESERT_BOOTS_ITEM_ID = ItemIdentifiers.DESERT_BOOTS;
  const SLAVE_SHIRT_ITEM_ID = ItemIdentifiers.SLAVE_SHIRT;
  const SLAVE_ROBE_ITEM_ID = ItemIdentifiers.SLAVE_ROBE;
  const SLAVE_BOOTS_ITEM_ID = ItemIdentifiers.SLAVE_BOOTS;
  const TECHNICAL_PLANS_ITEM_ID = ItemIdentifiers.TECHNICAL_PLANS;
  const PROTOTYPE_DART_TIP_ITEM_ID = ItemIdentifiers.PROTOTYPE_DART_TIP;
  const PROTOTYPE_DART_ITEM_ID = ItemIdentifiers.PROTOTYPE_DART;
  const TENTI_PINEAPPLE_ITEM_ID = ItemIdentifiers.TENTI_PINEAPPLE;
  const BRONZE_BAR_ITEM_ID = ItemIdentifiers.BRONZE_BAR;
  const FEATHER_ITEM_ID = ItemIdentifiers.FEATHER;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BRONZE_BARS_REQUIRED = 3;
  const FEATHERS_REQUIRED = 10;

  const CAMP_GATE_IDS = new Set([2673, 2674]);
  const MINE_DOOR_IDS = new Set([2675, 2676, 2690, 2691]);
  const MINE_CAVE_IDS = new Set([2698, 2699]);
  const MINE_CART_OBJECT_IDS = new Set([2684]);
  const BOOKCASE_OBJECT_ID = 2678;
  const CHEST_OBJECT_ID = 2677;
  const ANVIL_OBJECT_ID = 2672;
  const MINE_BARREL_OBJECT_IDS = new Set([2680, 2681]);
  /**
   * The barrel the winch hauls up, west of the camp winch. The map places the
   * transform parent 18963; the cache turns it into the searchable barrel 18962
   * when varbit 2808 says Ana is inside.
   */
  const ANA_BARREL_OBJECT_IDS = new Set([18963, 18962]);
  /**
   * The camp's flatback cart. The map places the transform parent 2682, which
   * the cache turns into the wooden cart 18958 (empty) or 18959 (Ana on it) by
   * varbit 2809.
   */
  const CAMP_CART_OBJECT_IDS = new Set([2682, 18958, 18959]);
  const WINCH_BUCKET_OBJECT_ID = 18951;
  const WINCH_OBJECT_ID = 18888;

  const MINING_CAMP_GATE_TILE = { x: 3274, y: 3029, z: 0 };
  const MINING_CAMP_INSIDE_TILE = { x: 3279, y: 3029, z: 0 };
  const MINING_CAMP_EXIT_TILE = { x: 3272, y: 3029, z: 0 };
  /** The camp itself (Quest Helper's camp zone), used to tell entering from leaving. */
  const MINING_CAMP_BOUNDS = { minX: 3274, maxX: 3305, minY: 3014, maxY: 3037 };
  const MINE1_TILE = { x: 3279, y: 9420, z: 0 };
  const DEEP_MINE_TILE = { x: 3284, y: 9414, z: 0 };
  const EAST_MINE_TILE = { x: 3318, y: 9430, z: 0 };
  const WEST_MINE_CART_TILE = { x: 3303, y: 9417, z: 0 };
  const CAMP_WINCH_TILE = { x: 3279, y: 3018, z: 0 };
  const SHANTAY_PASS_TILE = { x: 3304, y: 3112, z: 0 };

  const START_HOOK = "quest:the-tourist-trap:start";
  /** Ana gives the player the wrought iron key. */
  const GIVE_KEY_MESSAGE_ID = "hY0BOS";
  /** Ana's post-rescue reward branch completes the quest. */
  const COMPLETE_ACTION_ID = "ByiIGp";
  /** Al Shabim gives the Bedabin copy of the gate key. */
  const SHABIM_KEY_MESSAGE_ID = "pdpFAf";
  /** Al Shabim hands over the Tenti pineapple after the prototype dart. */
  const SHABIM_PINEAPPLE_MESSAGE_ID = "NJ2t2J";
  /** Al Shabim replaces a lost Bedabin key. */
  const SHABIM_REPLACEMENT_KEY_MESSAGE_ID = "AgNSAO";
  /** Male slave trades his clothes for the desert outfit. */
  const SLAVE_ROBE_MESSAGE_ID = "Q30ZW_";
  /** The escaping slave is caught and turns back into the male slave. */
  const ESCAPING_SLAVE_TURNED_BACK_MESSAGE_ID = "nxSDg3";
  /** Captain Siad is rambling about sailing and is distracted. */
  const SIAD_DISTRACTED_MESSAGE_ID = "HorYZZ";
  /** Feathers attached to the prototype dart tip. */
  const FEATHERS_ATTACHED_MESSAGE_ID = "XnpHhn";
  /** First line of the deeper-mine guard conversation. */
  const GUARD_TALKED_MESSAGE_ID = "jZJCvV";
  /** The two skill choice menus offer the same four skills. */
  const XP_CHOICE_SKILLS = new Map([
    ["fletching.", Skill.FLETCHING],
    ["agility.", Skill.AGILITY],
    ["smithing.", Skill.SMITHING],
    ["thieving", Skill.THIEVING],
    ["thieving.", Skill.THIEVING],
  ]);
  const QUEST_XP = 4650;

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const hasEquipped = (player, slot, itemId) =>
    player.getEquipment?.().get?.(slot)?.getId?.() === itemId;
  const hasSlaveClothes = (player) =>
    [
      [SLAVE_SHIRT_ITEM_ID, Equipment.BODY_SLOT],
      [SLAVE_ROBE_ITEM_ID, Equipment.LEG_SLOT],
      [SLAVE_BOOTS_ITEM_ID, Equipment.FEET_SLOT],
    ].every(([itemId, slot]) => held(player, itemId) || hasEquipped(player, slot, itemId));
  const wearingSlaveClothes = (player) =>
    hasEquipped(player, Equipment.BODY_SLOT, SLAVE_SHIRT_ITEM_ID) &&
    hasEquipped(player, Equipment.LEG_SLOT, SLAVE_ROBE_ITEM_ID) &&
    hasEquipped(player, Equipment.FEET_SLOT, SLAVE_BOOTS_ITEM_ID);
  const hasDesertClothesInInventory = (player) =>
    held(player, DESERT_SHIRT_ITEM_ID) && held(player, DESERT_ROBE_ITEM_ID) && held(player, DESERT_BOOTS_ITEM_ID);
  const hasDesertClothes = (player) =>
    [
      [DESERT_SHIRT_ITEM_ID, Equipment.BODY_SLOT],
      [DESERT_ROBE_ITEM_ID, Equipment.LEG_SLOT],
      [DESERT_BOOTS_ITEM_ID, Equipment.FEET_SLOT],
    ].every(([itemId, slot]) => held(player, itemId) || hasEquipped(player, slot, itemId));
  const skillLevel = (player, skill) =>
    Number(player.getSkillManager?.().getCurrentLevel?.(skill)) || 1;

  function stageOf(player) {
    return quest.getStage(player);
  }

  /**
   * Keeps the cache's transform varbits in step with the quest, so the camp's
   * NPCs and locs show up as themselves: the escaping slave after the trade,
   * Ana's barrel west of the winch once she is in it, the flatback cart with
   * Ana on it, and the happy Irena once Ana is back at the Shantay Pass.
   */
  function applyVarbits(player) {
    const stage = stageOf(player);
    const sender = player.getPacketSender();
    const escaping = stage >= STAGE_SLAVE_CLOTHES && !player.getAttribute(ESCAPING_SLAVE_ATTRIBUTE);
    const anaInBarrel = held(player, ANA_IN_A_BARREL_ITEM_ID);
    setVarbit(sender, VARBIT_MINE_SLAVE, escaping ? 1 : 0);
    setVarbit(sender, VARBIT_ANA_ON_LIFT, stage >= STAGE_ANA_ON_CART && stage < STAGE_ANA_ON_CAMP_CART ? 1 : 0);
    setVarbit(sender, VARBIT_IRENA_STATE, stage >= STAGE_RETURNED ? 1 : 0);
    setVarbit(sender, VARBIT_ANA_WINCH_BARREL,
      stage >= STAGE_ANA_SURFACE && stage < STAGE_ANA_ON_CAMP_CART && !anaInBarrel ? 1 : 0);
    setVarbit(sender, VARBIT_CART_ANA,
      stage >= STAGE_RETURNED ? 2 : stage >= STAGE_ANA_ON_CAMP_CART ? 1 : 0);
  }

  function setVarbit(sender, varbitId, value) {
    if (sender.getVarbit(varbitId) === value) return;
    sender.sendVarbit(varbitId, value);
  }

  function advance(player, stage) {
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    const changed = stageOf(player) < stage;
    if (changed) quest.setStage(player, stage);
    applyVarbits(player);
    return changed;
  }

  function giveItem(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    const before = inventory.getAmount(itemId);
    if (inventory.getFreeSlots() < 1 && before === 0) {
      player.getInventory().full?.();
      player.sendMessage("Not enough space in your inventory.");
      return false;
    }
    inventory.adds(itemId, amount);
    return inventory.getAmount(itemId) >= before + amount;
  }

  function moveTo(player, tile) {
    if (!Location) return;
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I rescued Ana from the desert mining camp.</str>",
        "<str>I returned her safely to Irena.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURNED) {
      return ["Ana is in a barrel.", "I must return her to <col=800000>Irena</col> south of the Shantay Pass."];
    }
    if (stage >= STAGE_ESCAPED) {
      return ["I escaped the mining camp with Ana.", "I must take her to <col=800000>Irena</col>."];
    }
    if (stage >= STAGE_ANA_ON_CAMP_CART) {
      return ["Ana is on the wooden cart.", "I must escape the camp with the mine cart driver."];
    }
    if (stage >= STAGE_ANA_IN_BARREL) {
      return ["Ana is hidden in a barrel.", "I must get her to the surface and onto the wooden cart."];
    }
    if (stage >= STAGE_HAS_BARREL) {
      return ["I have found a barrel in the deeper mine.", "I need to find <col=800000>Ana</col> and put her in it."];
    }
    if (stage >= STAGE_GUARD_DISTRACTED) {
      return ["The guard is distracted by the Tenti pineapple.", "I should enter the deeper mine."];
    }
    if (stage >= STAGE_HAS_PINEAPPLE) {
      return ["Al Shabim gave me a Tenti pineapple.", "I should use it on the guard by the cave opening."];
    }
    if (stage >= STAGE_PROTOTYPE_DART) {
      return ["I have a prototype dart.", "I should bring it to <col=800000>Al Shabim</col>."];
    }
    if (stage >= STAGE_DART_TIP) {
      return ["I have a prototype dart tip.", "I need to attach 10 feathers to it."];
    }
    if (stage >= STAGE_HAS_PLANS) {
      return ["I have the technical plans.", "I should make a prototype dart on the experimental anvil."];
    }
    if (stage >= STAGE_SHABIM_TASK) {
      return ["Al Shabim wants Captain Siad's technical plans.", "I must search his bookcase, distract him and open his chest."];
    }
    if (stage >= STAGE_SLAVE_CLOTHES) {
      return ["I am disguised as a slave.", "I should talk to the guard in the mine, then report to <col=800000>Al Shabim</col>."];
    }
    if (stage >= STAGE_METAL_KEY) {
      return ["I have the mining camp key.", "I should enter the camp in desert clothes and trade them for slave clothes."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Irena's daughter Ana is imprisoned in the mining camp.", "I should deal with the <col=800000>Mercenary Captain</col>."];
    }
    return [
      "I can start this quest by speaking to <col=800000>Irena</col>",
      "at the Shantay Pass.",
      "It requires 20 Smithing and 10 Fletching.",
    ];
  }

  function grantXp(player, skill) {
    if (!skill) return;
    player.getSkillManager()?.addExperiences?.(skill, QUEST_XP);
  }

  function handleChoice({ player, npcId, option }) {
    const text = String(option ?? "").trim().toLowerCase();
    if (MALE_SLAVE_NPC_IDS.has(npcId) && text === "yes, i'll trade.") {
      tradeForSlaveClothes(player);
      return;
    }
    if (npcId === AL_SHABIM_NPC_ID) {
      if (text !== "i am looking for a pineapple.") return;
      if (stageOf(player) < STAGE_HAS_PINEAPPLE || stageOf(player) >= STAGE_IN_DEEP_MINE) return;
      if (held(player, TENTI_PINEAPPLE_ITEM_ID)) return;
      giveItem(player, TENTI_PINEAPPLE_ITEM_ID);
      return;
    }
    if (!IRENA_NPC_IDS.has(npcId) || stageOf(player) < STAGE_RETURNED) return;
    const skill = XP_CHOICE_SKILLS.get(text);
    if (!skill) return;
    const chosen = Number(player.getAttribute(XP_CHOICES_ATTRIBUTE)) || 0;
    if (chosen >= 2) return;
    player.setAttribute(XP_CHOICES_ATTRIBUTE, chosen + 1);
    grantXp(player, skill);
    player.sendMessage(`You gain ${QUEST_XP.toLocaleString("en-US")} ${String(option).replace(/\.$/, "")} experience.`);
  }

  /** Al Shabim's task, the plans and the prototype dart. */
  function selectVariant({ npcId, player }) {
    const stage = stageOf(player);
    if (IRENA_NPC_IDS.has(npcId)) {
      if (stage === 0) return "starting-off";
      if (stage >= STAGE_RETURNED && stage < STAGE_COMPLETE) {
        const choices = Number(player.getAttribute(XP_CHOICES_ATTRIBUTE)) || 0;
        if (choices > 0) return "finishing-up-talking-to-irena-after-choosing-the-first-skill";
        return held(player, ANA_IN_A_BARREL_ITEM_ID)
          ? "finishing-up-talking-to-irena-while-holding-ana-in-a-barrel"
          : "finishing-up-talking-to-irena-after-rescuing-ana";
      }
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-tourist-trap";
      return "starting-off-talking-to-irena-again";
    }
    if (ANA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_ANA_IN_BARREL) return "the-deeper-mine-talking-to-ana-talking-to-ana-again";
      return "the-deeper-mine-talking-to-ana";
    }
    if (FEMALE_SLAVE_NPC_IDS.has(npcId)) {
      return { page: FEMALE_SLAVE_PAGE, variant: FEMALE_SLAVE_SPOKEN_VARIANT };
    }
    if (ESCAPING_SLAVE_NPC_IDS.has(npcId)) {
      return "inside-the-camp-talking-to-the-escaping-slave";
    }
    if (MALE_SLAVE_NPC_IDS.has(npcId)) {
      if (hasSlaveClothes(player)) return "inside-the-camp-talking-to-the-male-slave-while-wearing-slave-clothes";
      if (hasDesertClothes(player)) return "inside-the-camp-talking-to-the-male-slave-after-he-offers-to-trade";
      if (stage >= STAGE_SLAVE_CLOTHES) return "inside-the-camp-talking-to-the-male-slave-after-losing-the-slave-clothes";
      return "inside-the-camp-talking-to-male-slave-by-the-mine-door-entrance";
    }
    if (MINE_GUARD_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HAS_PINEAPPLE) {
        return held(player, TENTI_PINEAPPLE_ITEM_ID)
          ? "getting-a-tenti-pineapple-talking-to-the-guard-by-the-cave-opening"
          : "the-quest-for-tenti-s-talking-to-the-guard-in-the-cave-after-giving-him-the-tenti-pineapple";
      }
      return "getting-a-tenti-pineapple-talking-to-the-guard-by-the-cave-opening";
    }
    if (npcId === AL_SHABIM_NPC_ID) {
      if (held(player, PROTOTYPE_DART_ITEM_ID)) {
        return "the-quest-for-tenti-s-talking-to-al-shabim-while-holding-the-prototype-dart";
      }
      if (held(player, TECHNICAL_PLANS_ITEM_ID)) {
        return "the-quest-for-tenti-s-talking-to-al-shabim-while-holding-the-technical-plans";
      }
      if (stage >= STAGE_HAS_PINEAPPLE && stage < STAGE_IN_DEEP_MINE) {
        return held(player, TENTI_PINEAPPLE_ITEM_ID)
          ? "the-quest-for-tenti-s-talking-to-al-shabim-with-the-pineapple-in-bank-or-inventory"
          : "the-quest-for-tenti-s-talking-to-al-shabim-after-losing-the-pineapple";
      }
      if (stage >= STAGE_SHABIM_TASK && !held(player, BEDABIN_KEY_ITEM_ID) && stage < STAGE_HAS_PLANS) {
        return "the-quest-for-tenti-s-after-losing-the-bedabin-key";
      }
      if (stage >= STAGE_SHABIM_TASK || stage >= STAGE_LEFT_CAMP) {
        return "the-quest-for-tenti-s-talking-to-al-shabim";
      }
      return "getting-into-the-camp-talking-to-al-shabim-after-accepting-to-kill-al-zaba-bhasim";
    }
    if (npcId === MERCENARY_CAPTAIN_NPC_ID) {
      return stage >= STAGE_STARTED
        ? "getting-into-the-camp-talking-to-the-mercenary-captain"
        : "getting-into-the-camp-talking-to-a-mercenary";
    }
    if (npcId === CAPTAIN_SIAD_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-the-tourist-trap";
      return "the-quest-for-tenti-s-talking-to-captain-siad";
    }
    if (npcId === MINE_CART_DRIVER_NPC_ID) {
      return stage >= STAGE_ANA_ON_CAMP_CART
        ? "returning-to-the-surface-talking-to-mine-cart-driver"
        : "inside-the-camp-talking-to-the-mine-cart-driver";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    const known = IRENA_NPC_IDS.has(npcId) || ANA_NPC_IDS.has(npcId) || MALE_SLAVE_NPC_IDS.has(npcId)
      || ESCAPING_SLAVE_NPC_IDS.has(npcId)
      || MINE_GUARD_NPC_IDS.has(npcId)
      || [AL_SHABIM_NPC_ID, MERCENARY_CAPTAIN_NPC_ID, CAPTAIN_SIAD_NPC_ID, MINE_CART_DRIVER_NPC_ID].includes(npcId);
    if (!known) return null;
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("does not have 5 coins")) return !has(COINS_ITEM_ID, 5);
    if (value.includes("has any filled waterskins")) return false;
    if (value.includes("already placed a bet")) return true;
    if (value.includes("doesn't have enough gold") || value.includes("does not have enough coins")) return false;
    if (value.includes("not wearing slave clothes")) return !wearingSlaveClothes(player);
    if (value.includes("has the slave clothes")) return hasSlaveClothes(player);
    if (value.includes("lost the slave clothes")) return !hasSlaveClothes(player);
    if (value.includes("does not have the wrought iron key")) return !has(WROUGHT_IRON_KEY_ITEM_ID);
    if (value.includes("does not have the metal key")) return !has(METAL_KEY_ITEM_ID);
    if (value.includes("does not have the bedabin key")) return !has(BEDABIN_KEY_ITEM_ID);
    if (value.includes("does not have the cell door key")) return !has(ItemIdentifiers.CELL_DOOR_KEY);
    if (value.includes("holding the key")) return has(WROUGHT_IRON_KEY_ITEM_ID) || has(METAL_KEY_ITEM_ID);
    if (value.includes("player is holding ana in a barrel")) return has(ANA_IN_A_BARREL_ITEM_ID);
    if (value.includes("already has a barrel")) return has(ANA_IN_A_BARREL_ITEM_ID);
    if (value.includes("has no inventory space")) return player.getInventory().isFull();
    if (value.includes("missing the desert robe, desert shirt, and desert boots")) return !hasDesertClothes(player);
    if (value.includes("missing the desert robe and desert shirt")) {
      return !has(DESERT_ROBE_ITEM_ID) && !has(DESERT_SHIRT_ITEM_ID);
    }
    if (value.includes("missing the desert shirt and desert boots")) {
      return !has(DESERT_SHIRT_ITEM_ID) && !has(DESERT_BOOTS_ITEM_ID);
    }
    if (value.includes("missing the desert robe and desert boots")) {
      return !has(DESERT_ROBE_ITEM_ID) && !has(DESERT_BOOTS_ITEM_ID);
    }
    if (value.includes("missing the desert robe")) return !has(DESERT_ROBE_ITEM_ID);
    if (value.includes("missing the desert shirt")) return !has(DESERT_SHIRT_ITEM_ID);
    if (value.includes("missing the desert boots")) return !has(DESERT_BOOTS_ITEM_ID);
    if (value.includes("seen the sailing book")) return !!player.getAttribute(SEARCHED_BOOKCASE_ATTRIBUTE);
    if (value.includes("talked to al shabim about the plans")) return stageOf(player) >= STAGE_SHABIM_TASK;
    if (value.includes("already had the key in the bank")) return false;
    if (value.includes("no inventory space") || value.includes("no free inventory")) {
      return player.getInventory().isFull();
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!IRENA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (stageOf(player) === 0) advance(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === GIVE_KEY_MESSAGE_ID) {
      if (!IRENA_NPC_IDS.has(npcId)) return;
      if (held(player, WROUGHT_IRON_KEY_ITEM_ID)) return;
      giveItem(player, WROUGHT_IRON_KEY_ITEM_ID);
      return;
    }
    if (stepId === SHABIM_KEY_MESSAGE_ID) {
      if (npcId !== AL_SHABIM_NPC_ID) return;
      if (held(player, BEDABIN_KEY_ITEM_ID)) {
        advance(player, STAGE_SHABIM_TASK);
        return;
      }
      if (giveItem(player, BEDABIN_KEY_ITEM_ID)) advance(player, STAGE_SHABIM_TASK);
      return;
    }
    if (stepId === SHABIM_REPLACEMENT_KEY_MESSAGE_ID) {
      if (npcId !== AL_SHABIM_NPC_ID) return;
      if (!held(player, BEDABIN_KEY_ITEM_ID)) giveItem(player, BEDABIN_KEY_ITEM_ID);
      return;
    }
    if (stepId === SHABIM_PINEAPPLE_MESSAGE_ID) {
      if (npcId !== AL_SHABIM_NPC_ID) return;
      if (stageOf(player) >= STAGE_HAS_PINEAPPLE || held(player, TENTI_PINEAPPLE_ITEM_ID)) return;
      if (!giveItem(player, TENTI_PINEAPPLE_ITEM_ID)) return;
      // Quest Helper still needs the technical plans for the anvil, so only the
      // prototype dart changes hands.
      player.getInventory().deleteNumber(PROTOTYPE_DART_ITEM_ID, 1);
      advance(player, STAGE_HAS_PINEAPPLE);
      return;
    }
    if (stepId === ESCAPING_SLAVE_TURNED_BACK_MESSAGE_ID) {
      if (!ESCAPING_SLAVE_NPC_IDS.has(npcId)) return;
      player.setAttribute(ESCAPING_SLAVE_ATTRIBUTE, true);
      applyVarbits(player);
      return;
    }
    if (stepId === SLAVE_ROBE_MESSAGE_ID) {
      if (!MALE_SLAVE_NPC_IDS.has(npcId)) return;
      tradeForSlaveClothes(player);
      return;
    }
    if (stepId === SIAD_DISTRACTED_MESSAGE_ID) {
      if (npcId !== CAPTAIN_SIAD_NPC_ID) return;
      if (!player.getAttribute(SEARCHED_BOOKCASE_ATTRIBUTE)) return;
      player.setAttribute(DISTRACTED_SIAD_ATTRIBUTE, true);
      advance(player, STAGE_SEARCHED_BOOKCASE);
      return;
    }
    if (stepId === GUARD_TALKED_MESSAGE_ID) {
      if (!MINE_GUARD_NPC_IDS.has(npcId)) return;
      if (stageOf(player) >= STAGE_SLAVE_CLOTHES) advance(player, STAGE_GUARD_TALKED);
      return;
    }
    if (stepId === FEATHERS_ATTACHED_MESSAGE_ID) {
      if (!player.getInventory().contains(PROTOTYPE_DART_TIP_ITEM_ID)) return;
      player.getInventory().deleteNumber(PROTOTYPE_DART_TIP_ITEM_ID, 1);
      if (!held(player, PROTOTYPE_DART_ITEM_ID)) player.getInventory().adds(PROTOTYPE_DART_ITEM_ID, 1);
      advance(player, STAGE_PROTOTYPE_DART);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!IRENA_NPC_IDS.has(npcId)) return;
      if (stageOf(player) < STAGE_RETURNED || quest.isComplete(player)) return;
      player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
      quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  /**
   * The male slave trades his slave robes for the desert ones. A player who lost
   * the slave robes buys a new desert set at the Shantay Pass and trades again.
   */
  function tradeForSlaveClothes(player) {
    if (hasSlaveClothes(player)) return false;
    if (!hasDesertClothesInInventory(player)) {
      player.sendMessage("I need a desert robe, a desert shirt and desert boots if you want these clothes off me.");
      return false;
    }
    player.getInventory().deleteNumber(DESERT_SHIRT_ITEM_ID, 1);
    player.getInventory().deleteNumber(DESERT_ROBE_ITEM_ID, 1);
    player.getInventory().deleteNumber(DESERT_BOOTS_ITEM_ID, 1);
    player.getInventory().adds(SLAVE_ROBE_ITEM_ID, 1);
    player.getInventory().adds(SLAVE_SHIRT_ITEM_ID, 1);
    player.getInventory().adds(SLAVE_BOOTS_ITEM_ID, 1);
    advance(player, STAGE_SLAVE_CLOTHES);
    return true;
  }

  function grantPlans(player) {
    if (held(player, TECHNICAL_PLANS_ITEM_ID)) return true;
    if (!giveItem(player, TECHNICAL_PLANS_ITEM_ID)) return false;
    advance(player, STAGE_HAS_PLANS);
    return true;
  }

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    if (MERCENARY_GUARD_NPC_IDS.has(event.npcId)) {
      if (stageOf(killer) < STAGE_METAL_KEY || held(killer, METAL_KEY_ITEM_ID)) return;
      if (!giveItem(killer, METAL_KEY_ITEM_ID)) {
        killer.sendMessage("The guard drops a metal key, but you have no space to pick it up.");
        return;
      }
      killer.sendMessage("The guard drops a metal key. You pick it up.");
      return;
    }
    if (event.npcId !== MERCENARY_CAPTAIN_NPC_ID) return;
    if (stageOf(killer) < STAGE_STARTED) return;
    if (!held(killer, METAL_KEY_ITEM_ID)) {
      if (!giveItem(killer, METAL_KEY_ITEM_ID)) {
        killer.sendMessage("The mercenary captain drops a metal key, but you have no space to pick it up.");
        return;
      }
      killer.sendMessage("The mercenary captain drops a metal key. You pick it up.");
    }
    advance(killer, STAGE_METAL_KEY);
  }

  /** True while the player stands inside the desert mining camp. */
  function inMiningCamp(player) {
    const location = player.getLocation?.();
    if (!location) return false;
    const x = location.getX();
    const y = location.getY();
    return x >= MINING_CAMP_BOUNDS.minX && x <= MINING_CAMP_BOUNDS.maxX
      && y >= MINING_CAMP_BOUNDS.minY && y <= MINING_CAMP_BOUNDS.maxY;
  }

  function openCampGate(event) {
    const { player, objectId } = event;
    if (!CAMP_GATE_IDS.has(objectId)) return;
    event.handled = true;
    const stage = stageOf(player);
    if (stage >= STAGE_GUARD_TALKED && stage < STAGE_SHABIM_TASK) {
      player.sendMessage("You leave the mining camp.");
      advance(player, STAGE_LEFT_CAMP);
      moveTo(player, MINING_CAMP_EXIT_TILE);
      return;
    }
    if (stage >= STAGE_HAS_PLANS && stage < STAGE_HAS_PINEAPPLE) {
      player.sendMessage("You leave the mining camp.");
      moveTo(player, MINING_CAMP_EXIT_TILE);
      return;
    }
    if (inMiningCamp(player)) {
      // The guards only search you on the way in, so leaving is always possible.
      player.sendMessage("You leave the mining camp.");
      moveTo(player, MINING_CAMP_EXIT_TILE);
      return;
    }
    if (!held(player, METAL_KEY_ITEM_ID)) {
      player.sendMessage("This gate needs a key in order to be opened.");
      return;
    }
    if (!hasDesertClothes(player) && !hasSlaveClothes(player)) {
      player.sendMessage("The guards will not let you in without desert clothes.");
      return;
    }
    player.sendMessage("The guards search you thoroughly as you go through the gates.");
    if (stage < STAGE_SHABIM_TASK) advance(player, STAGE_ENTERED_CAMP);
    moveTo(player, MINING_CAMP_GATE_TILE);
  }

  function openMineDoor(event) {
    const { player, objectId } = event;
    if (!MINE_DOOR_IDS.has(objectId)) return;
    event.handled = true;
    if (objectId === 2690 || objectId === 2691) {
      player.sendMessage("You return to the surface.");
      if (stageOf(player) >= STAGE_GUARD_TALKED && stageOf(player) < STAGE_HAS_PLANS) advance(player, STAGE_LEFT_CAMP);
      moveTo(player, MINING_CAMP_INSIDE_TILE);
      return;
    }
    if (!wearingSlaveClothes(player)) {
      player.sendMessage("Only slaves may go down there.");
      return;
    }
    if (stageOf(player) < STAGE_ENTERED_CAMP) advance(player, STAGE_ENTERED_CAMP);
    player.sendMessage("The doors open with some effort!");
    moveTo(player, MINE1_TILE);
  }

  function enterDeepMine(event) {
    const { player, objectId } = event;
    if (!MINE_CAVE_IDS.has(objectId)) return;
    if (stageOf(player) < STAGE_GUARD_DISTRACTED) return;
    event.handled = true;
    if (stageOf(player) >= STAGE_ANA_SENT_UP) {
      player.sendMessage("You return to the surface.");
      moveTo(player, MINE1_TILE);
      return;
    }
    player.sendMessage("You walk into the darkness of the cavern...");
    advance(player, STAGE_IN_DEEP_MINE);
    moveTo(player, DEEP_MINE_TILE);
  }

  function searchBookcase(event) {
    const { player, objectId } = event;
    if (objectId !== BOOKCASE_OBJECT_ID) return;
    event.handled = true;
    if (stageOf(player) < STAGE_SHABIM_TASK) return;
    player.setAttribute(SEARCHED_BOOKCASE_ATTRIBUTE, true);
    player.sendMessage("You notice several books on the subject of sailing.");
  }

  function openChest(event) {
    const { player, objectId } = event;
    if (objectId !== CHEST_OBJECT_ID) return;
    event.handled = true;
    if (stageOf(player) < STAGE_SHABIM_TASK) return;
    if (!held(player, BEDABIN_KEY_ITEM_ID)) {
      player.sendMessage("This chest needs a key to unlock it.");
      return;
    }
    if (!player.getAttribute(DISTRACTED_SIAD_ATTRIBUTE)) {
      player.sendMessage("The captain spots you before you manage to open the chest...");
      return;
    }
    if (!player.getAttribute(SEARCHED_BOOKCASE_ATTRIBUTE)) {
      player.sendMessage("You have not found anything to talk to the captain about.");
      return;
    }
    if (grantPlans(player)) player.sendMessage("While the Captain's distracted, you quickly unlock the chest and take the plans.");
  }

  function useAnvil(event) {
    const { player, objectId } = event;
    if (objectId !== ANVIL_OBJECT_ID) return;
    event.handled = true;
    if (stageOf(player) < STAGE_HAS_PLANS) return;
    if (held(player, PROTOTYPE_DART_ITEM_ID) || held(player, PROTOTYPE_DART_TIP_ITEM_ID)) {
      player.sendMessage("You have already made the prototype dart.");
      return;
    }
    if (!held(player, TECHNICAL_PLANS_ITEM_ID) || !held(player, HAMMER_ITEM_ID)
      || !held(player, BRONZE_BAR_ITEM_ID, BRONZE_BARS_REQUIRED)) {
      player.sendMessage("You need the technical plans, a hammer and 3 bronze bars.");
      return;
    }
    if (skillLevel(player, Skill.SMITHING) < 20) {
      player.sendMessage("You need a Smithing level of 20 to make the prototype dart tip.");
      return;
    }
    player.getInventory().deleteNumber(BRONZE_BAR_ITEM_ID, BRONZE_BARS_REQUIRED);
    if (!giveItem(player, PROTOTYPE_DART_TIP_ITEM_ID)) {
      player.getInventory().adds(BRONZE_BAR_ITEM_ID, BRONZE_BARS_REQUIRED);
      return;
    }
    player.sendMessage("You follow the plans carefully and forge a prototype dart tip.");
    advance(player, STAGE_DART_TIP);
  }

  function lookBarrel(event) {
    const { player, objectId } = event;
    if (ANA_BARREL_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      event.player.sendMessage("You look into the barrel and see Ana.");
      return;
    }
    if (!MINE_BARREL_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    event.player.sendMessage("This looks like a mining barrel.");
  }

  function searchBarrel(event) {
    const { player, objectId } = event;
    if (ANA_BARREL_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (stageOf(player) < STAGE_ANA_SURFACE || stageOf(player) >= STAGE_ANA_ON_CAMP_CART) {
        player.sendMessage("This looks like an interesting mining barrel.");
        return;
      }
      if (held(player, ANA_IN_A_BARREL_ITEM_ID)) {
        player.sendMessage("The barrel is empty.");
        return;
      }
      if (!giveItem(player, ANA_IN_A_BARREL_ITEM_ID)) return;
      player.sendMessage("You search the barrel and find Ana.");
      advance(player, STAGE_ANA_SURFACE);
      return;
    }
    if (!MINE_BARREL_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    if (stageOf(player) < STAGE_IN_DEEP_MINE) return;
    if (held(player, ANA_IN_A_BARREL_ITEM_ID) || held(player, BARREL_ITEM_ID)) {
      player.sendMessage("You can only manage one of these at a time.");
      return;
    }
    if (giveItem(player, BARREL_ITEM_ID)) {
      player.sendMessage("You take the barrel, it's not that heavy, just awkward.");
      advance(player, STAGE_HAS_BARREL);
    }
  }

  function searchMineCart(event) {
    const { player, objectId } = event;
    if (!MINE_CART_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    const stage = stageOf(player);
    if (stage === STAGE_HAS_BARREL) {
      player.sendMessage("You squeeze yourself into the cart.");
      advance(player, STAGE_EAST_MINE);
      moveTo(player, EAST_MINE_TILE);
      return;
    }
    if (stage === STAGE_ANA_ON_CART) {
      player.sendMessage("The cart returns to the barrel loading room.");
      advance(player, STAGE_ANA_SENT_UP);
      moveTo(player, WEST_MINE_CART_TILE);
    }
  }

  function useWinchBucket(event) {
    const { player, objectId } = event;
    if (objectId !== WINCH_BUCKET_OBJECT_ID) return;
    if (stageOf(player) < STAGE_ANA_SENT_UP) return;
    event.handled = true;
    if (held(player, ANA_IN_A_BARREL_ITEM_ID)) player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
    player.sendMessage("You place Ana in the winch bucket and send her to the surface.");
    advance(player, STAGE_ANA_SENT_UP);
  }

  function operateWinch(event) {
    const { player, objectId } = event;
    if (objectId !== WINCH_OBJECT_ID) return;
    if (stageOf(player) < STAGE_ANA_SENT_UP) return;
    event.handled = true;
    player.sendMessage("You operate the winch and haul the barrel containing Ana onto the side.");
    advance(player, STAGE_ANA_SURFACE);
    moveTo(player, CAMP_WINCH_TILE);
  }

  function searchWoodenCart(event) {
    const { player, objectId } = event;
    if (!CAMP_CART_OBJECT_IDS.has(objectId)) return;
    const stage = stageOf(player);
    if (stage === STAGE_ESCAPED) {
      event.handled = true;
      player.sendMessage("You climb onto the cart and escape the camp.");
      if (!held(player, ANA_IN_A_BARREL_ITEM_ID) && !giveItem(player, ANA_IN_A_BARREL_ITEM_ID)) {
        player.sendMessage("You have no space for Ana in the barrel.");
        return;
      }
      advance(player, STAGE_RETURNED);
      moveTo(player, SHANTAY_PASS_TILE);
      return;
    }
    if (stage === STAGE_ANA_SURFACE) {
      if (!held(player, ANA_IN_A_BARREL_ITEM_ID)) return;
      event.handled = true;
      player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
      player.sendMessage("You place Ana in the barrel carefully on the cart.");
      advance(player, STAGE_ANA_ON_CAMP_CART);
    }
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (itemId === BARREL_ITEM_ID && ANA_NPC_IDS.has(npcId) && stageOf(player) >= STAGE_EAST_MINE) {
      event.handled = true;
      player.getInventory().deleteNumber(BARREL_ITEM_ID, 1);
      player.getInventory().adds(ANA_IN_A_BARREL_ITEM_ID, 1);
      player.sendMessage("You hide Ana in a barrel.");
      advance(player, STAGE_ANA_IN_BARREL);
      return;
    }
    if (itemId === TENTI_PINEAPPLE_ITEM_ID && MINE_GUARD_NPC_IDS.has(npcId) && stageOf(player) >= STAGE_HAS_PINEAPPLE) {
      event.handled = true;
      player.getInventory().deleteNumber(TENTI_PINEAPPLE_ITEM_ID, 1);
      player.sendMessage("You show the Tenti pineapple to the guard. He is delighted and distracted.");
      advance(player, STAGE_GUARD_DISTRACTED);
    }
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (itemId === ANA_IN_A_BARREL_ITEM_ID && CAMP_CART_OBJECT_IDS.has(objectId)
      && stageOf(player) >= STAGE_ANA_SURFACE && stageOf(player) < STAGE_ANA_ON_CAMP_CART) {
      event.handled = true;
      player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
      player.sendMessage("You place Ana in the barrel carefully on the cart.");
      advance(player, STAGE_ANA_ON_CAMP_CART);
      return;
    }
    if (itemId === ANA_IN_A_BARREL_ITEM_ID && MINE_CART_OBJECT_IDS.has(objectId)
      && stageOf(player) >= STAGE_EAST_MINE && stageOf(player) < STAGE_ANA_ON_CART) {
      event.handled = true;
      player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
      player.sendMessage("You place Ana in the barrel into the mine cart.");
      advance(player, STAGE_ANA_ON_CART);
      moveTo(player, WEST_MINE_CART_TILE);
    }
  }

  function handleItemOnItem(event) {
    const { player, itemId, otherItemId } = event;
    const isFeather = itemId === FEATHER_ITEM_ID || otherItemId === FEATHER_ITEM_ID;
    const isTip = itemId === PROTOTYPE_DART_TIP_ITEM_ID || otherItemId === PROTOTYPE_DART_TIP_ITEM_ID;
    if (!isFeather || !isTip) return;
    if (!held(player, FEATHER_ITEM_ID, FEATHERS_REQUIRED)) {
      player.sendMessage("You need 10 feathers to fletch the prototype dart.");
      return;
    }
    if (skillLevel(player, Skill.FLETCHING) < 10) {
      event.handled = true;
      player.sendMessage("You need a Fletching level of 10 to attach the feathers.");
      return;
    }
    event.handled = true;
    player.getInventory().deleteNumber(FEATHER_ITEM_ID, FEATHERS_REQUIRED);
    player.getInventory().deleteNumber(PROTOTYPE_DART_TIP_ITEM_ID, 1);
    player.getInventory().adds(PROTOTYPE_DART_ITEM_ID, 1);
    player.sendMessage("You successfully attach the feathers to the dart tip.");
    advance(player, STAGE_PROTOTYPE_DART);
  }

  function handleDriverTalk(event) {
    const { player, npcId } = event;
    if (npcId !== MINE_CART_DRIVER_NPC_ID) return false;
    if (stageOf(player) < STAGE_ANA_ON_CAMP_CART) return false;
    player.sendMessage("The mine cart driver agrees to take you out of the camp.");
    advance(player, STAGE_ESCAPED);
    // Let the transcript NPC dialogue play; this hook only records the agreement.
    return false;
  }

  function migrateLegacyStage(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    if (player.getAttribute(LEGACY_STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) {
      player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
      player.setAttribute(LEGACY_STAGE_VERSION_ATTRIBUTE, 0);
      return;
    }
    const legacy = stageOf(player);
    const migrated = ({ 10: STAGE_SLAVE_CLOTHES, 20: STAGE_SHABIM_TASK, 22: STAGE_SHABIM_TASK, 25: STAGE_ANA_IN_BARREL })[legacy] ?? legacy;
    if (migrated !== legacy) quest.setStage(player, migrated | 0);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
  }

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    applyVarbits(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "the_tourist_trap",
    name: "The Tourist Trap",
    varpId: VARP_TOURIST_TRAP,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    otherRewards: [
      "4,650 XP in two chosen skills (Agility, Fletching, Smithing or Thieving)",
      "The ability to smith darts",
    ],
    buildJournal,
  });

  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);
  // PlayerSave restores registered keys only; retain this input until old saves migrate.
  api.persistAttribute(LEGACY_STAGE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(SEARCHED_BOOKCASE_ATTRIBUTE, false);
  api.persistAttribute(DISTRACTED_SIAD_ATTRIBUTE, false);
  api.persistAttribute(XP_CHOICES_ATTRIBUTE, 0);
  api.persistAttribute(ESCAPING_SLAVE_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction("Gate", { Open: openCampGate });
  api.onObjectInteraction("Mine door entrance", { Open: openMineDoor });
  api.onObjectInteraction("Mine cave", { "Walk through": enterDeepMine });
  api.onObjectInteraction("Bookcase", { Search: searchBookcase });
  api.onObjectInteraction("Chest", { Open: openChest });
  api.onObjectInteraction("An experimental anvil", { Use: useAnvil });
  api.onObjectInteraction("Barrel", { Search: searchBarrel, "Look-in": lookBarrel, "Look in": lookBarrel });
  api.onObjectInteraction("Mine Cart", { Search: searchMineCart });
  api.onObjectInteraction("Winch bucket", { Use: useWinchBucket });
  api.onObjectInteraction("Winch", { Operate: operateWinch });
  api.onObjectInteraction("Wooden cart", { Search: searchWoodenCart });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onNpcInteraction("Mine cart driver", { "Talk-to": handleDriverTalk });
  api.onPlayerLogin(handleLogin);
};
