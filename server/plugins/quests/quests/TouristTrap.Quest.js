/**
 * The Tourist Trap (members).
 *
 * The words come from the "The Tourist Trap" transcript page; this plugin
 * supplies the variant selector for Irena, Ana, the Mercenary Captain, Captain
 * Siad, Al Shabim and the mine cart driver (all indexed), the start hook, the
 * prose-condition answers, the slave-disguise hand-out and the barrel hand-in
 * that completes the quest.
 *
 * Stages (varp 197): 1 started, 10 disguised by Al Shabim, 20 admitted to the
 * camp, 22 talking to Ana, 25 carrying Ana in a barrel, 30 complete.
 *
 * Gaps (no dump/index support): the "Tenti Pineapple" side quest, the actual
 * mining-camp stealth/escape and Ana's barrel-smuggling route are not
 * simulated; the disguise and Ana's barrel are granted by the plugin, and the
 * two XP rewards are the transcript's own choice menu (handled by the runtime,
 * not the scroll). Ana's transcript spawn ids (6230/6231) and Irena's
 * (6233/6234) differ from NpcIdentifiers, which are used here.
 */
module.exports = function registerTouristTrapQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const IRENA_NPC_IDS = new Set([NpcIdentifiers.IRENA, NpcIdentifiers.IRENA_2]);
  const ANA_NPC_IDS = new Set([NpcIdentifiers.ANA, NpcIdentifiers.ANA_2, NpcIdentifiers.ANA_3]);
  const MERCENARY_CAPTAIN_NPC_ID = NpcIdentifiers.MERCENARY_CAPTAIN;
  const CAPTAIN_SIAD_NPC_ID = NpcIdentifiers.CAPTAIN_SIAD;
  const AL_SHABIM_NPC_ID = NpcIdentifiers.AL_SHABIM;
  const MINE_CART_DRIVER_NPC_ID = NpcIdentifiers.MINE_CART_DRIVER;

  const VARP_TOURIST_TRAP = 197;
  const STAGE_STARTED = 1;
  const STAGE_DISGUISED = 10;
  const STAGE_IN_CAMP = 20;
  const STAGE_TALKING_TO_ANA = 22;
  const STAGE_HAS_ANA = 25;
  const STAGE_COMPLETE = 30;

  const ANA_IN_A_BARREL_ITEM_ID = ItemIdentifiers.ANA_IN_A_BARREL;
  const METAL_KEY_ITEM_ID = ItemIdentifiers.METAL_KEY;
  const WROUGHT_IRON_KEY_ITEM_ID = ItemIdentifiers.WROUGHT_IRON_KEY;
  const SLAVE_SHIRT_ITEM_ID = ItemIdentifiers.SLAVE_SHIRT;
  const SLAVE_ROBE_ITEM_ID = ItemIdentifiers.SLAVE_ROBE;
  const SLAVE_BOOTS_ITEM_ID = ItemIdentifiers.SLAVE_BOOTS;
  const BRONZE_BAR_ITEM_ID = ItemIdentifiers.BRONZE_BAR;
  const FEATHER_ITEM_ID = ItemIdentifiers.FEATHER;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BRONZE_BARS_REQUIRED = 3;
  const FEATHERS_REQUIRED = 10;

  const START_HOOK = "quest:the-tourist-trap:start";
  /** Ana's "you show Irena the barrel" message hands over the iron key. */
  const GIVE_KEY_MESSAGE_ID = "hY0BOS";
  /** The Irena reward-choice branch ends the quest. */
  const COMPLETE_ACTION_ID = "ByiIGp";

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasDisguise = (player) =>
    held(player, SLAVE_SHIRT_ITEM_ID) &&
    held(player, SLAVE_ROBE_ITEM_ID) &&
    held(player, SLAVE_BOOTS_ITEM_ID);

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
    if (stage >= STAGE_HAS_ANA) {
      return [
        "Ana is hidden in a barrel.",
        "I must smuggle her out and return to <col=800000>Irena</col>.",
      ];
    }
    if (stage >= STAGE_TALKING_TO_ANA) {
      return [
        "I have entered the mine disguised as a slave.",
        "I need to find <col=800000>Ana</col> in the underground mine.",
      ];
    }
    if (stage >= STAGE_DISGUISED) {
      return [
        "I can enter the camp, but need a disguise.",
        "<col=800000>Al Shabim</col> can help me make slave clothing.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Irena's daughter Ana is imprisoned in the mining camp.",
        "I should deal with the <col=800000>Mercenary Captain</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Irena</col>",
      "at the Shantay Pass.",
      "It requires 20 Smithing and 10 Fletching.",
    ];
  }

  function grantReward(_player) {
    // The XP reward is chosen through the transcript's own two menus.
  }

  /** Al Shabim takes the smithing supplies and hands over the disguise. */
  function disguisePlayer(player) {
    if (!held(player, BRONZE_BAR_ITEM_ID, BRONZE_BARS_REQUIRED)) return false;
    if (!held(player, FEATHER_ITEM_ID, FEATHERS_REQUIRED)) return false;
    player.getInventory().deleteNumber(BRONZE_BAR_ITEM_ID, BRONZE_BARS_REQUIRED);
    player.getInventory().deleteNumber(FEATHER_ITEM_ID, FEATHERS_REQUIRED);
    player.getInventory().adds(SLAVE_SHIRT_ITEM_ID, 1);
    player.getInventory().adds(SLAVE_ROBE_ITEM_ID, 1);
    player.getInventory().adds(SLAVE_BOOTS_ITEM_ID, 1);
    player.getInventory().adds(WROUGHT_IRON_KEY_ITEM_ID, 1);
    player.sendMessage("Al Shabim makes you a slave disguise and copies a key.");
    return true;
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (IRENA_NPC_IDS.has(npcId)) {
      if (stage === 0) return "starting-off";
      if (stage < STAGE_HAS_ANA) return "starting-off-talking-to-irena-again";
      if (stage < STAGE_COMPLETE) return "finishing-up-talking-to-irena-while-holding-ana-in-a-barrel";
      return "finishing-up-talking-to-irena-after-rescuing-ana";
    }
    if (ANA_NPC_IDS.has(npcId)) {
      if (stage === STAGE_TALKING_TO_ANA) {
        player.getInventory().adds(ANA_IN_A_BARREL_ITEM_ID, 1);
        player.sendMessage("You hide Ana in a barrel.");
        quest.setStage(player, STAGE_HAS_ANA);
        return "the-deeper-mine-using-the-barrel-on-ana";
      }
      if (stage >= STAGE_HAS_ANA) return "the-deeper-mine-talking-to-ana-talking-to-ana-again";
      return "the-deeper-mine-talking-to-ana";
    }
    if (npcId === AL_SHABIM_NPC_ID) {
      if (stage >= STAGE_STARTED && stage < STAGE_DISGUISED) {
        if (disguisePlayer(player)) quest.setStage(player, STAGE_DISGUISED);
      }
      return "getting-into-the-camp-talking-to-al-shabim-after-accepting-to-kill-al-zaba-bhasim";
    }
    if (npcId === MERCENARY_CAPTAIN_NPC_ID) {
      return "getting-into-the-camp-talking-to-the-mercenary-captain";
    }
    if (npcId === CAPTAIN_SIAD_NPC_ID) {
      if (stage >= STAGE_DISGUISED && stage < STAGE_IN_CAMP && hasDisguise(player)) {
        quest.setStage(player, STAGE_IN_CAMP);
      } else if (stage === STAGE_IN_CAMP && hasDisguise(player)) {
        quest.setStage(player, STAGE_TALKING_TO_ANA);
      }
      return "the-quest-for-tenti-s-talking-to-captain-siad";
    }
    if (npcId === MINE_CART_DRIVER_NPC_ID) {
      return "inside-the-camp-talking-to-the-mine-cart-driver";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("does not have 5 coins")) return !has(COINS_ITEM_ID, 5);
    if (value.includes("has any filled waterskins")) return false;
    if (value.includes("already placed a bet")) return true;
    if (value.includes("doesn't have enough gold") || value.includes("does not have enough coins")) {
      return false;
    }
    if (value.includes("not wearing slave clothes")) return !hasDisguise(player);
    if (value.includes("has the slave clothes")) return hasDisguise(player);
    if (value.includes("lost the slave clothes")) return !hasDisguise(player);
    if (value.includes("does not have the wrought iron key")) {
      return !has(WROUGHT_IRON_KEY_ITEM_ID);
    }
    if (value.includes("does not have the metal key")) return !has(METAL_KEY_ITEM_ID);
    if (value.includes("does not have the bedabin key")) return true;
    if (value.includes("does not have the cell door key")) {
      return !has(ItemIdentifiers.CELL_DOOR_KEY);
    }
    if (value.includes("holding the key")) {
      return has(WROUGHT_IRON_KEY_ITEM_ID) || has(METAL_KEY_ITEM_ID);
    }
    if (value.includes("player is holding ana in a barrel")) return has(ANA_IN_A_BARREL_ITEM_ID);
    if (value.includes("already has a barrel")) return has(ANA_IN_A_BARREL_ITEM_ID);
    if (value.includes("has no inventory space")) return player.getInventory().isFull();
    if (value.includes("missing the desert robe, desert shirt, and desert boots")) {
      return !hasDisguise(player);
    }
    if (value.includes("missing the desert robe and desert shirt")) {
      return !has(SLAVE_ROBE_ITEM_ID) && !has(SLAVE_SHIRT_ITEM_ID);
    }
    if (value.includes("missing the desert shirt and desert boots")) {
      return !has(SLAVE_SHIRT_ITEM_ID) && !has(SLAVE_BOOTS_ITEM_ID);
    }
    if (value.includes("missing the desert robe and desert boots")) {
      return !has(SLAVE_ROBE_ITEM_ID) && !has(SLAVE_BOOTS_ITEM_ID);
    }
    if (value.includes("missing the desert robe")) return !has(SLAVE_ROBE_ITEM_ID);
    if (value.includes("missing the desert shirt")) return !has(SLAVE_SHIRT_ITEM_ID);
    if (value.includes("missing the desert boots")) return !has(SLAVE_BOOTS_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!IRENA_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction({ player, npcId, stepId }) {
    if (IRENA_NPC_IDS.has(npcId) && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_HAS_ANA && !quest.isComplete(player)) {
        player.getInventory().deleteNumber(ANA_IN_A_BARREL_ITEM_ID, 1);
        quest.complete(player);
      }
      return;
    }
    if (stepId === GIVE_KEY_MESSAGE_ID && !held(player, WROUGHT_IRON_KEY_ITEM_ID)) {
      player.getInventory().adds(WROUGHT_IRON_KEY_ITEM_ID, 1);
    }
  }

  function handleLogin({ player }) {
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
    rewardItemId: ItemIdentifiers.SLAVE_ROBE,
    rewardItemLabel: "A slave robe",
    otherRewards: [
      "2 lots of 4,650 XP in a choice of skills",
      "The ability to smith darts",
      "Full slave robes",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
};
