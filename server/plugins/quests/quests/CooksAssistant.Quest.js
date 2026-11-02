/** Cook's Assistant: Wiki transcript, with handover/reward timing from rsprox 1718. */
module.exports = function registerCooksAssistantQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const COOK_NPC_ID = NpcIdentifiers.COOK_7;

  const VARP_COOKS_ASSISTANT = 29;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const REQUIRED_ITEMS = [
    { itemId: ItemIdentifiers.BUCKET_OF_MILK, label: "a bucket of milk" },
    { itemId: ItemIdentifiers.EGG, label: "an egg" },
    { itemId: ItemIdentifiers.POT_OF_FLOUR, label: "a pot of flour" },
  ];

  /** The transcript's "You still need to get" order; REQUIRED_ITEMS' order is saved as bits. */
  const MISSING_LIST_ORDER = [ItemIdentifiers.BUCKET_OF_MILK, ItemIdentifiers.POT_OF_FLOUR, ItemIdentifiers.EGG];

  const DELIVERED_INGREDIENTS_ATTRIBUTE = "cooks-assistant:delivered-ingredients";
  const ALL_INGREDIENTS = (1 << REQUIRED_ITEMS.length) - 1;
  const HANDOVER_MESSAGE_ID = "qPWhXs";
  const MISSING_INGREDIENTS_MESSAGE_ID = "UxCH5X";

  /** The Cook transcript's hand-over lines, keyed to the item the player gives. */
  const HANDOVER_LINE_ITEMS = new Map([
    ["Here's a bucket of milk.", ItemIdentifiers.BUCKET_OF_MILK],
    ["Here's a pot of flour.", ItemIdentifiers.POT_OF_FLOUR],
    ["Here's a fresh egg.", ItemIdentifiers.EGG],
  ]);

  /** The "Yes." choice on "Start Cook's Assistant?" carries this quest slug. */
  const START_HOOK = "quest:cook-s-assistant:start";

  let quest;
  const pendingStart = new WeakSet();

  const deliveredIngredients = (player) => Number(player.getAttribute(DELIVERED_INGREDIENTS_ATTRIBUTE)) || 0;

  function deliverIngredient(player, itemId) {
    const index = REQUIRED_ITEMS.findIndex((entry) => entry.itemId === itemId);
    const bit = 1 << index;
    if (index < 0 || (deliveredIngredients(player) & bit) !== 0) return;
    if (player.getInventory().getAmount(itemId) <= 0) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.setAttribute(DELIVERED_INGREDIENTS_ATTRIBUTE, deliveredIngredients(player) | bit);
  }

  function hasAllIngredients(player) {
    const inventory = player.getInventory();
    return REQUIRED_ITEMS.every((requirement, index) =>
      (deliveredIngredients(player) & (1 << index)) !== 0 || inventory.getAmount(requirement.itemId) > 0);
  }

  /**
   * "If the player has the ingredients:" is the else of "has not obtained anything
   * yet", so it means at least one - the nested has/has-not-all conditions below it
   * then pick whether to hand in or ask for the rest.
   */
  function hasAnyIngredient(player) {
    const inventory = player.getInventory();
    return REQUIRED_ITEMS.some((requirement, index) =>
      (deliveredIngredients(player) & (1 << index)) === 0 && inventory.getAmount(requirement.itemId) > 0);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>It was the Duke of Lumbridge's birthday, but his cook had</str>",
        "<str>forgotten to buy the ingredients he needed to make him a</str>",
        "<str>cake. I brought the cook an egg, some flour and some milk and</str>",
        "<str>the cook made a delicious looking cake with them.</str>",
        "",
        "<str>As a reward he now lets me use his high quality range which</str>",
        "<str>lets me burn things less whenever I wish to cook there.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "It is the <col=800000>Duke of Lumbridge's</col> birthday.",
        "His <col=800000>cook</col> needs the following ingredients:",
        "",
      ];
      for (const [index, ingredient] of REQUIRED_ITEMS.entries()) {
        lines.push(
          (deliveredIngredients(player) & (1 << index)) !== 0
            ? `<str>${ingredient.label}</str>`
            : ingredient.label
        );
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to the",
      "<col=800000>Cook</col> in the kitchen on the ground floor",
      "of <col=800000>Lumbridge Castle</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 300);
  }

  /** Which transcript variant the Cook plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (npcId !== COOK_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-cook-s-assistant";
    if (stage >= STAGE_STARTED) return "talking-to-the-cook-again";
    return "starting-off";
  }

  /** Answer the Cook transcript's prose conditions. */
  function answerCondition({ npcId, player, text }) {
    if (npcId !== COOK_NPC_ID) return null;
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const has = (itemId) => inventory.getAmount(itemId) > 0;
    if (value.includes("does not have an empty pot")) return !has(ItemIdentifiers.POT);
    if (value.includes("has an empty pot")) return has(ItemIdentifiers.POT);
    if (value.includes("does not have an empty bucket")) return !has(ItemIdentifiers.BUCKET);
    if (value.includes("has an empty bucket")) return has(ItemIdentifiers.BUCKET);
    if (value.includes("already has the necessary items")) return hasAllIngredients(player);
    if (value.includes("doesn't have the necessary items")) return !hasAllIngredients(player);
    if (value.includes("has not obtained anything yet")) {
      return !hasAnyIngredient(player) && deliveredIngredients(player) !== ALL_INGREDIENTS;
    }
    if (value.includes("hasn't handed in at least one item")) return deliveredIngredients(player) !== ALL_INGREDIENTS;
    if (value.includes("has brought all the ingredients")) return hasAllIngredients(player);
    if (value.includes("has not brought all the ingredients")) return !hasAllIngredients(player);
    if (value.includes("has the ingredients")) return hasAnyIngredient(player) || deliveredIngredients(player) === ALL_INGREDIENTS;
    if (value.includes("free-to-play world")) return !api.core.WorldDefinition.isMembersWorld();
    if (value.includes("members' world")) return api.core.WorldDefinition.isMembersWorld();
    return null;
  }

  /**
   * The transcript always reads all three "Here's a ..." hand-over lines; drop the
   * ones for ingredients the player is not carrying.
   */
  function handleDialogueLine(event) {
    if (event.npcId !== COOK_NPC_ID) return;
    if (event.text === "Yes, I'll help you." && pendingStart.has(event.player)) {
      event.after = () => {
        pendingStart.delete(event.player);
        if (quest.getStage(event.player) !== 0) return;
        quest.setStage(event.player, STAGE_STARTED);
        event.player.sendMessage("You've started a new quest: <col=081190>Cook's Assistant</col>");
      };
    }
    const itemId = HANDOVER_LINE_ITEMS.get(event.text);
    if (itemId !== undefined) {
      const bit = 1 << REQUIRED_ITEMS.findIndex((entry) => entry.itemId === itemId);
      if ((deliveredIngredients(event.player) & bit) !== 0 || event.player.getInventory().getAmount(itemId) <= 0) {
        event.skip = true;
      } else {
        event.after = () => deliverIngredient(event.player, itemId);
      }
    }
    if (event.text === "Maybe, but I won't be holding my breath.") {
      event.after = () => {
        if (quest.getStage(event.player) === STAGE_STARTED && deliveredIngredients(event.player) === ALL_INGREDIENTS) {
          quest.complete(event.player);
        }
      };
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== COOK_NPC_ID || hook !== START_HOOK || quest.getStage(player) !== 0) return;
    pendingStart.add(player);
  }

  function handleHandIn(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== COOK_NPC_ID || quest.getStage(player) !== STAGE_STARTED) return;
    if (stepId === HANDOVER_MESSAGE_ID && hasAllIngredients(player)) {
      event.box = { items: [ItemIdentifiers.POT_OF_FLOUR, ItemIdentifiers.BUCKET_OF_MILK] };
      event.after = () => {
        for (const requirement of REQUIRED_ITEMS) deliverIngredient(player, requirement.itemId);
      };
    }
    if (stepId === MISSING_INGREDIENTS_MESSAGE_ID) {
      const missing = MISSING_LIST_ORDER.filter((itemId) => {
        const index = REQUIRED_ITEMS.findIndex((entry) => entry.itemId === itemId);
        return (deliveredIngredients(player) & (1 << index)) === 0;
      });
      event.text = ["You still need to get:", ...missing.map((itemId) => {
        const { label } = REQUIRED_ITEMS.find((entry) => entry.itemId === itemId);
        return label.charAt(0).toUpperCase() + label.slice(1);
      })].join("<br>");
      event.box = { statement: true };
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "cooks_assistant",
    name: "Cook's Assistant",
    varpId: VARP_COOKS_ASSISTANT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 152,
    xpRewards: [{ skillId: Skill.COOKING.getIndex(), amount: 300, label: "Cooking" }],
    scrollItemId: ItemIdentifiers.CAKE,
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(DELIVERED_INGREDIENTS_ATTRIBUTE, 0);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleHandIn);
  api.onPlayerLogin(handleLogin);
};
