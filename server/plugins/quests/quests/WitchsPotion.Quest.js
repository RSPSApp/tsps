/** Witch's Potion. Capture evidence: docs/f2p-coastal-parity.md. */
module.exports = function registerWitchsPotionQuest(api) {
  const { Skill, Item, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startDialogue, startTranscript, questStartMessage } = require("../QuestRuntime");

  const VARP_WITCHS_POTION = 67;
  const STAGE_STARTED = 1;
  const STAGE_INGREDIENTS_GIVEN = 2;
  const STAGE_COMPLETE = 3;

  const START_HOOK = "quest:witch-s-potion:start";
  const HAND_IN_ACTION_ID = "Q5Eb7j";

  const PAGE_WITCHS_POTION = "Witch's Potion";
  const PAGE_HETTY = "Hetty";
  const VARIANT_STARTING = "starting-off-talking-to-hetty";
  const VARIANT_WITH_NONE = "acquiring-the-items-talking-to-hetty-with-none-of-the-items";
  const VARIANT_WITH_SOME = "acquiring-the-items-talking-to-hetty-with-some-of-the-items";
  const VARIANT_WITH_ALL = "acquiring-the-items-talking-to-hetty-with-all-the-items";
  const VARIANT_BEFORE_DRINKING =
    "acquiring-the-items-talking-to-hetty-again-before-drinking-from-the-cauldron";
  const VARIANT_COMPLETE = "standard-dialogue-after-completing-witch-s-potion";

  const CONDITION_PREFIX = "if the player only has";
  const RAT_TAIL_KEYWORDS = ["rat's tail", "rats tail"];
  const BURNT_MEAT_KEYWORDS = ["burnt meat"];
  const ONION_KEYWORDS = ["onion"];
  const EYE_OF_NEWT_KEYWORDS = ["eye of newt"];

  const REQUIRED_ITEMS = [
    { itemId: ItemIdentifiers.EYE_OF_NEWT, label: "An eye of newt" },
    { itemId: ItemIdentifiers.RATS_TAIL, label: "A rat's tail" },
    { itemId: ItemIdentifiers.ONION, label: "An onion" },
    { itemId: ItemIdentifiers.BURNT_MEAT, label: "A piece of burnt meat" },
  ];

  /** Item keywords as they appear in the wiki condition prose. */
  const CONDITION_ITEMS = [
    { itemId: ItemIdentifiers.RATS_TAIL, keywords: RAT_TAIL_KEYWORDS },
    { itemId: ItemIdentifiers.BURNT_MEAT, keywords: BURNT_MEAT_KEYWORDS },
    { itemId: ItemIdentifiers.ONION, keywords: ONION_KEYWORDS },
    { itemId: ItemIdentifiers.EYE_OF_NEWT, keywords: EYE_OF_NEWT_KEYWORDS },
  ];

  // 6224-6229 appear in the original hand-picked rat list but have no generated
  // NpcIdentifiers member (absent from the cache dump), so they stay named here.
  const UNENUMERATED_RAT_NPC_IDS = [6224, 6225, 6226, 6227, 6228, 6229];

  const RAT_NPC_IDS = new Set([
    NpcIdentifiers.RAT,
    NpcIdentifiers.RAT_2,
    NpcIdentifiers.RAT_3,
    NpcIdentifiers.RAT_4,
    NpcIdentifiers.RAT_5,
    NpcIdentifiers.RAT_6,
    NpcIdentifiers.RAT_7,
    NpcIdentifiers.RAT_10,
    NpcIdentifiers.RAT_11,
    NpcIdentifiers.RAT_12,
    NpcIdentifiers.RAT_13,
    NpcIdentifiers.RAT_14,
    NpcIdentifiers.RAT_15,
    NpcIdentifiers.RAT_16,
    NpcIdentifiers.RAT_17,
    NpcIdentifiers.RAT_18,
    ...UNENUMERATED_RAT_NPC_IDS,
  ]);

  let quest;
  let pluginApi;
  const accepted = new WeakSet();

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const heldCount = (player) => REQUIRED_ITEMS.filter((r) => hasItem(player, r.itemId)).length;

  const hasAllIngredients = (player) => heldCount(player) === REQUIRED_ITEMS.length;

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.MAGIC, 325);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I brought Hetty an onion, a rat's tail,</str>",
        "<str>a piece of burnt meat and an eye of newt.</str>",
        "<str>I drank from her cauldron and my magic power increased.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_INGREDIENTS_GIVEN) {
      return [
        "<str>I brought Hetty all the ingredients for her potion.</str>",
        "",
        "I should <col=800000>drink from the cauldron</col> and improve my magic.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>I spoke to Hetty in Rimmington.</str>",
        "She can increase my magic power if I bring:",
        "",
      ];
      for (const requirement of REQUIRED_ITEMS) {
        lines.push(
          hasItem(player, requirement.itemId)
            ? `<str>${requirement.label}</str>`
            : requirement.label
        );
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Hetty</col> in her house in <col=800000>Rimmington</col>,",
      "west of <col=800000>Port Sarim</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  /** "If the player only has the rat's tail and burnt meat:" -> does the held set match? */
  function conditionMatches(player, text) {
    const value = String(text).toLowerCase();
    if (!value.startsWith(CONDITION_PREFIX)) return null;
    const mentioned = new Set(
      CONDITION_ITEMS.filter((item) => item.keywords.some((word) => value.includes(word))).map(
        (item) => item.itemId
      )
    );
    const held = new Set(REQUIRED_ITEMS.filter((r) => hasItem(player, r.itemId)).map((r) => r.itemId));
    return mentioned.size === held.size && [...mentioned].every((itemId) => held.has(itemId));
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== NpcIdentifiers.HETTY) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return { page: PAGE_HETTY, variant: VARIANT_COMPLETE };
    }
    if (stage >= STAGE_INGREDIENTS_GIVEN) {
      return { page: PAGE_WITCHS_POTION, variant: VARIANT_BEFORE_DRINKING };
    }
    if (stage >= STAGE_STARTED) {
      const held = heldCount(player);
      if (held === REQUIRED_ITEMS.length) {
        return { page: PAGE_WITCHS_POTION, variant: VARIANT_WITH_ALL };
      }
      if (held === 0) {
        return { page: PAGE_WITCHS_POTION, variant: VARIANT_WITH_NONE };
      }
      return { page: PAGE_WITCHS_POTION, variant: VARIANT_WITH_SOME };
    }
    return { page: PAGE_WITCHS_POTION, variant: VARIANT_STARTING };
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== NpcIdentifiers.HETTY) return null;
    return conditionMatches(player, text);
  }

  // "Yes." on "Start the Witch's Potion quest?".
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== NpcIdentifiers.HETTY || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    accepted.add(player);
  }

  // Hand the four ingredients over: the transcript prints its own hand-over line.
  function handleHandIn(event) {
    if (event.npcId !== NpcIdentifiers.HETTY || event.stepId !== HAND_IN_ACTION_ID) return;
    if (!hasAllIngredients(event.player)) { event.handled = true; event.end = true; return; }
    event.box = { statement: true };
  }

  // Rat's tail drops from rats while the quest is in progress and none is carried.
  function handleRatDeath({ killer, npc, npcId }) {
    if (!killer || typeof killer.getInventory !== "function") return;
    if (!RAT_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    if (hasItem(killer, ItemIdentifiers.RATS_TAIL)) return;
    pluginApi
      .getItemOnGroundManager()
      .registerLocation(killer, new Item(ItemIdentifiers.RATS_TAIL, 1), npc.getLocation());
  }

  function renderQuestLine(event) {
    if (event.npcId !== NpcIdentifiers.HETTY) return;
    if (event.text.startsWith("You need an eye of newt, a rat's tail, an onion...")) event.before = () => {
      if (!accepted.has(event.player) || quest.getStage(event.player) !== 0) return;
      accepted.delete(event.player);
      quest.setStage(event.player, STAGE_STARTED);
      event.player.sendMessage(questStartMessage(event.player, "Witch's Potion"));
    };
    if (event.text === "Ok, now drink from the cauldron.") event.before = () => {
      if (quest.getStage(event.player) !== STAGE_STARTED || !hasAllIngredients(event.player)) return;
      for (const requirement of REQUIRED_ITEMS) event.player.getInventory().deleteNumber(requirement.itemId, 1);
      quest.setStage(event.player, STAGE_INGREDIENTS_GIVEN);
    };
  }

  function handleCauldronAction(event) {
    if (event.npcId !== NpcIdentifiers.HETTY) return;
    if (event.stepId === "oLsPKg") event.box = { statement: true };
    if (event.stepId === "OpbvIv" && quest.getStage(event.player) === STAGE_INGREDIENTS_GIVEN) {
      quest.complete(event.player);
      event.handled = true;
      event.end = true;
    }
  }

  function handleCauldronClick({ player }) {
    if (quest.getStage(player) === STAGE_INGREDIENTS_GIVEN) {
      startTranscript(api, player, NpcIdentifiers.HETTY, PAGE_WITCHS_POTION, "acquiring-the-items-drinking-from-the-cauldron");
      return;
    }
    startDialogue(api, player, { npcId: NpcIdentifiers.HETTY }, [
      { player: ["As nice as that looks, I think I'll give it a miss for now."] },
    ]);
  }

  pluginApi = api;
  quest = registerQuest(api, {
    key: "witchs_potion",
    name: "Witch's Potion",
    varpId: VARP_WITCHS_POTION,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    completionJingleId: 154,
    xpRewards: [{ skillId: Skill.MAGIC.getIndex(), amount: 325, label: "Magic" }],
    scrollItemId: ItemIdentifiers.EYE_OF_NEWT,
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleHandIn);
  api.onCustomEvent("npc-dialogue:action", handleCauldronAction);
  api.onCustomEvent("npc-dialogue:line", renderQuestLine);
  api.onNpcDeath(handleRatDeath);
  api.onObjectFirstClick(ObjectIdentifiers.CAULDRON_2, handleCauldronClick);
};
