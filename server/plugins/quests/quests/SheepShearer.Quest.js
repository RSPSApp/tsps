/**
 * Sheep Shearer.
 *
 * Words come from npc-dialogues.json ("Sheep Shearer" / "Fred the Farmer" /
 * "Sheep (penguins)" pages):
 *   stage 0            -> "Sheep Shearer" / "starting-off"
 *   in progress        -> "starting-off-with-regular-wool" | "handing-in-any-balls-of-wool"
 *                          | "starting-off-before-delivering-any-balls-of-wool"
 *                          | "after-interacting-with-the-the-thing" (saw The Thing)
 *                          | "finishing-up" (enough balls to hand in)
 *   complete           -> "Fred the Farmer" / "after-sheep-shearer"
 *
 * Wool collection follows the Wiki; fast-path handover and rewards follow rsprox 1718.
 */
module.exports = function registerSheepShearerQuest(api) {
  const { Skill, Animation, ItemIdentifiers, NpcIdentifiers, TaskManager, CountdownTask } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const FRED_THE_FARMER_NPC_ID = NpcIdentifiers.FRED_THE_FARMER;
  // The cache calls 731 "Sheep"; the plugin names it for "The Thing" (strange sheep).
  const STRANGE_SHEEP_NPC_ID = NpcIdentifiers.SHEEP;

  const VARP_SHEEP_SHEARER = 179;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 21;
  const TOTAL_BALLS_OF_WOOL = 20;

  const SHEARS_ITEM_ID = ItemIdentifiers.SHEARS;
  const WOOL_ITEM_ID = ItemIdentifiers.WOOL;
  const BALL_OF_WOOL_ITEM_ID = ItemIdentifiers.BALL_OF_WOOL;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  const SHEAR_ANIMATION = new Animation(893);

  /**
   * The revision-241 shearable sheep, each mapped to the sheared npc of the same
   * wool colour. The pairs are the cache gamevals' matching SHEEPUNSHEERED and
   * SHEEPSHEERED names.
   */
  const SHEARED_SHEEP_BY_ID = new Map([
    [NpcIdentifiers.SHEEP_18, NpcIdentifiers.SHEEP_2],
    [NpcIdentifiers.SHEEP_19, NpcIdentifiers.SHEEP_4],
    [NpcIdentifiers.SHEEP_20, NpcIdentifiers.SHEEP_9],
    [NpcIdentifiers.SHEEP_21, NpcIdentifiers.SHEEP_10],
    [NpcIdentifiers.SHEEP_BALD_BLACK_HEAD, NpcIdentifiers.SHEEP_11],
    [NpcIdentifiers.SHEEP_3, NpcIdentifiers.SHEEP_12],
    [NpcIdentifiers.SHEEP_BALD_WHITE_HEAD, NpcIdentifiers.SHEEP_13],
    [NpcIdentifiers.SHEEP_5, NpcIdentifiers.SHEEP_14],
    [NpcIdentifiers.SHEEP_6, NpcIdentifiers.SHEEP_15],
    [NpcIdentifiers.SHEEP_7, NpcIdentifiers.SHEEP_16],
    [NpcIdentifiers.SHEEP_8, NpcIdentifiers.SHEEP_17],
  ]);

  const SAW_THING_ATTRIBUTE = "sheep-shearer:saw-thing";
  const FINAL_DELIVERY_ATTRIBUTE = "sheep-shearer:final-delivery";
  const shornSheep = new WeakSet();

  /** Condition step ids and their prose substrings. */
  const SPEEDRUNNING_STEP_ID = "br3A1e";
  const ALREADY_HAS_WOOL_STEP_ID = "JlC38d";
  const NO_SHEARS_STEP_ID = "HK3p0J";
  const NO_SHEARS_STEP_ID_2 = "nCewYx";
  const HAS_SHEARS_STEP_ID = "4-ne12";
  const HAS_SHEARS_STEP_ID_2 = "MKY9UA";

  const CONDITION_SPEEDRUNNING = "quest speedrunning";
  const CONDITION_ALREADY_HAS_WOOL = "already has 20 balls of wool";
  const CONDITION_NO_SHEARS = "doesn't have shears";
  const CONDITION_DOES_NOT_HAVE_SHEARS = "does not have shears";
  const CONDITION_HAS_SHEARS = "has shears";

  /** Action step ids. */
  const GIVE_SHEARS_STEP_ID = "H9GkGT";
  const START_WITH_20_BALLS_STEP_ID = "MW-4c0";
  const FINISHING_UP_STEP_ID = "l--V3R";
  const HANDING_IN_STEP_ID = "XaM2d6";
  const AFTER_THING_STEP_ID = "0OkI2g";

  const PAGE_FRED_THE_FARMER = "Fred the Farmer";
  const PAGE_SHEEP_SHEARER = "Sheep Shearer";
  const VARIANT_STARTING_OFF = "starting-off";
  const VARIANT_AFTER = "after-sheep-shearer";
  const VARIANT_FINISHING_UP = "finishing-up";
  const VARIANT_AFTER_THING = "after-interacting-with-the-the-thing";
  const VARIANT_HANDING_IN = "handing-in-any-balls-of-wool";
  const VARIANT_STARTING_WITH_WOOL = "starting-off-with-regular-wool";
  const VARIANT_STARTING_BEFORE_DELIVERY = "starting-off-before-delivering-any-balls-of-wool";

  /** "Yes." on "Start the Sheep Shearer quest?" carries this slug. */
  const START_HOOK = "quest:sheep-shearer:start";

  let quest;
  const pendingStart = new WeakSet();

  const deliveredWool = (stage) => (stage <= STAGE_STARTED ? 0 : stage >= STAGE_COMPLETE ? TOTAL_BALLS_OF_WOOL : stage - STAGE_STARTED);
  const remainingWool = (stage) => TOTAL_BALLS_OF_WOOL - deliveredWool(stage);
  const woolBalls = (player) => player.getInventory().getAmount(BALL_OF_WOOL_ITEM_ID);
  const hasShears = (player) => player.getInventory().getAmount(SHEARS_ITEM_ID) > 0;
  const sawTheThing = (player) => player.getAttribute(SAW_THING_ATTRIBUTE) === true;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I have spoken to Fred the Farmer.</str>",
        "<str>I have collected twenty balls of wool and</str>",
        "<str>given them to him.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const remaining = remainingWool(stage);
      return [
        "I have spoken to <col=800000>Fred the Farmer</col>.",
        "",
        `I need to collect ${remaining} more`,
        `<col=800000>${remaining === 1 ? "ball" : "balls"} of wool</col>.`,
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Fred the Farmer</col> who lives",
      "<col=800000>north-west of Lumbridge</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  /** Shears used on (or the Shear option of) a normal sheep yields one wool. */
  function shearSheep(player, npc) {
    if (!npc || shornSheep.has(npc)) return;
    if (!hasShears(player)) {
      player.sendMessage("You need a set of shears to do this.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space to hold the wool.");
      return;
    }
    player.performAnimation(SHEAR_ANIMATION);
    player.getInventory().adds(WOOL_ITEM_ID, 1);
    player.sendMessage("You get some wool.");
    shornSheep.add(npc);
    const shearedId = SHEARED_SHEEP_BY_ID.get(npc.getDefinition().getId());
    npc.setNpcTransformationId(shearedId ?? -1);
    TaskManager.submit(new CountdownTask(npc, 100, () => {
      shornSheep.delete(npc);
      if (npc.isRegistered()) npc.setNpcTransformationId(-1);
    }));
  }

  /** Shearing "The Thing" escapes and, once the quest is underway, flags it seen. */
  function shearStrangeSheep(player) {
    if (!hasShears(player)) {
      player.sendMessage("You need a pair of shears to shear the sheep.");
      return;
    }
    player.performAnimation(SHEAR_ANIMATION);
    player.sendMessage("The... whatever it is... manages to get away from you!");
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE) {
      player.setAttribute(SAW_THING_ATTRIBUTE, true);
    }
  }

  /** Remove up to `quantity` balls of wool and return how many were taken. */
  function removeWoolBalls(player, quantity) {
    const carried = woolBalls(player);
    const removed = Math.max(0, Math.min(carried, quantity));
    if (removed > 0) player.getInventory().deleteNumber(BALL_OF_WOOL_ITEM_ID, removed);
    return removed;
  }

  function reward(player) {
    player.getInventory().adds(COINS_ITEM_ID, 60);
    player.getSkillManager().addExperiences(Skill.CRAFTING, 150);
  }

  // Which Fred transcript plays, by quest stage and inventory.
  function selectVariant({ npcId, player }) {
    if (npcId !== FRED_THE_FARMER_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: PAGE_FRED_THE_FARMER, variant: VARIANT_AFTER };
    if (stage >= STAGE_STARTED) {
      const remaining = remainingWool(stage);
      const carried = woolBalls(player);
      if (player.getAttribute(FINAL_DELIVERY_ATTRIBUTE) === true) return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_FINISHING_UP };
      if (carried >= remaining) return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_FINISHING_UP };
      if (sawTheThing(player)) return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_AFTER_THING };
      if (carried > 0) return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_HANDING_IN };
      if (player.getInventory().getAmount(WOOL_ITEM_ID) > 0) {
        return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_STARTING_WITH_WOOL };
      }
      return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_STARTING_BEFORE_DELIVERY };
    }
    return { page: PAGE_SHEEP_SHEARER, variant: VARIANT_STARTING_OFF };
  }

  // Answer the transcript's prose conditions.
  function answerCondition({ npcId, player, text, stepId }) {
    if (npcId !== FRED_THE_FARMER_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (stepId === SPEEDRUNNING_STEP_ID || value.includes(CONDITION_SPEEDRUNNING)) return false;
    if (stepId === ALREADY_HAS_WOOL_STEP_ID || value.includes(CONDITION_ALREADY_HAS_WOOL)) return woolBalls(player) >= TOTAL_BALLS_OF_WOOL;
    if (stepId === NO_SHEARS_STEP_ID || stepId === NO_SHEARS_STEP_ID_2) return !hasShears(player);
    if (stepId === HAS_SHEARS_STEP_ID || stepId === HAS_SHEARS_STEP_ID_2) return hasShears(player);
    if (value.includes(CONDITION_NO_SHEARS) || value.includes(CONDITION_DOES_NOT_HAVE_SHEARS)) return !hasShears(player);
    if (value.includes(CONDITION_HAS_SHEARS)) return hasShears(player);
    return null;
  }

  function updateDialogueLine(event) {
    if (event.npcId !== FRED_THE_FARMER_NPC_ID) return;
    if (event.text === "Yes, okay. I can do that." && pendingStart.has(event.player)) {
      event.after = () => {
        pendingStart.delete(event.player);
        if (quest.getStage(event.player) !== 0) return;
        // Fred's start gives shears unless the player already has them or has all 20 balls.
        // Do not commit the start when that handout cannot fit.
        if (!hasShears(event.player) && woolBalls(event.player) < TOTAL_BALLS_OF_WOOL
          && event.player.getInventory().isFull()) {
          event.player.getInventory().full();
          return;
        }
        quest.setStage(event.player, STAGE_STARTED);
      };
    }
    const remaining = remainingWool(quest.getStage(event.player));
    event.text = event.text.replace("20 more balls of wool", `${remaining} more ${remaining === 1 ? "ball" : "balls"} of wool`)
      .replace("[1-19]", String(remaining))
      .replace("[#]", String(remaining));
  }

  function handleDialogueAction(event) {
    if (event.npcId !== FRED_THE_FARMER_NPC_ID) return;
    const { player } = event;

    switch (event.stepId) {
      case GIVE_SHEARS_STEP_ID: // "Fred gives you a set of sharp shears."
        if (!hasShears(player) && player.getInventory().isFull()) {
          player.sendMessage("You need a free inventory slot for the shears.");
          event.handled = true;
          event.end = true;
          return;
        }
        if (!hasShears(player)) player.getInventory().adds(SHEARS_ITEM_ID, 1);
        event.box = { items: [SHEARS_ITEM_ID] };
        return; // leave unhandled so the message still shows
      case "sheep-shearer:finish-handover": {
        if (player.getAttribute(FINAL_DELIVERY_ATTRIBUTE) === true) { event.handled = true; return; }
        const remaining = remainingWool(quest.getStage(player));
        if (woolBalls(player) < remaining || quest.isComplete(player)) {
          event.handled = true;
          event.end = true;
          return;
        }
        const removed = removeWoolBalls(player, remaining);
        player.setAttribute(FINAL_DELIVERY_ATTRIBUTE, true);
        event.text = removed === 1 ? "You give Fred a ball of wool." : `You give Fred ${removed} balls of wool.`;
        event.box = { statement: true };
        return;
      }
      case START_WITH_20_BALLS_STEP_ID:
      case FINISHING_UP_STEP_ID:
        if (player.getAttribute(FINAL_DELIVERY_ATTRIBUTE) === true) {
          player.setAttribute(FINAL_DELIVERY_ATTRIBUTE, false);
          quest.complete(player);
        }
        event.handled = true;
        event.end = true;
        return;
      case HANDING_IN_STEP_ID: // handing-in-any-balls-of-wool
      case AFTER_THING_STEP_ID: { // after-interacting-with-the-the-thing
        const stage = quest.getStage(player);
        const handIn = Math.min(woolBalls(player), remainingWool(stage));
        const removed = removeWoolBalls(player, handIn);
        if (removed > 0) quest.setStage(player, stage + removed);
        event.text = removed === 1 ? "You give Fred a ball of wool." : `You give Fred ${removed} balls of wool.`;
        if (removed > 0) event.box = { statement: true };
        else event.handled = true;
        event.end = false;
        return;
      }
      default:
        return;
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== FRED_THE_FARMER_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    pendingStart.add(player);
  }

  // Shearing sheep: the Shear option, or shears used on a sheep.
  function handleNpcInteraction(event) {
    const action = (event.definition?.getActions?.() ?? [])[event.clickType - 1];
    if (String(action).toLowerCase() !== "shear") return;
    if (event.npcId === STRANGE_SHEEP_NPC_ID) {
      shearStrangeSheep(event.player);
      event.handled = true;
      return;
    }
    if (SHEARED_SHEEP_BY_ID.has(event.npcId)) {
      shearSheep(event.player, event.npc ?? event.target);
      event.handled = true;
    }
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== SHEARS_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId === STRANGE_SHEEP_NPC_ID) {
      shearStrangeSheep(event.player);
      event.handled = true;
      return;
    }
    if (SHEARED_SHEEP_BY_ID.has(npcId)) {
      shearSheep(event.player, event.npc ?? event.target);
      event.handled = true;
    }
  }

  function handlePlayerLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "sheep_shearer",
    name: "Sheep Shearer",
    varpId: VARP_SHEEP_SHEARER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 150, label: "Crafting" }],
    scrollItemId: SHEARS_ITEM_ID,
    rewardItemLabel: "60 Coins",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(SAW_THING_ATTRIBUTE, false);
  api.persistAttribute(FINAL_DELIVERY_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", updateDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);

  // Shearing sheep: the Shear option, or shears used on a sheep.
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemOnNpc(handleItemOnNpc);


  api.onPlayerLogin(handlePlayerLogin);
};
