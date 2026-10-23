/**
 * Monk's Friend (members).
 *
 * Brother Omad (4244) and Brother Cedric (4245) are both indexed on the
 * "Monk's Friend" transcript page, so every talk and hand-over is driven by the
 * dump; this plugin answers its two prose conditions, selects the variant by
 * stage, runs the start hook and turns the shared hand-in actions/messages into
 * stage changes.
 *
 * Stages (varp 30): 10 started, 20 blanket returned, 30 looking for Cedric,
 * 40 finding water, 50 given water, 60 fixing cart, 70 cart fixed, 80 complete.
 *
 * The stone circle's ladder is canonical object 16680 (LADDER_192), the
 * "Ladder" Quest Helper uses for the circle. The cache does not place it on the
 * map, so the circle is an Area that spawns it on entry ("A ladder
 * mysteriously appears.") and removes it once the last player leaves. Because
 * 16680 is used by many dungeon entrances, the click handler is scoped to the
 * circle tile. The final Omad transcript shows the eight-rune item box before
 * the party; normal bags are paid there, while a full bag is settled by the
 * completion reward after the dancing overheads.
 */
module.exports = function registerMonksFriendQuest(api) {
  const { Skill, Item, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location, Boundary, GameObject } = api.core;
  const { registerQuest, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Monk's Friend";

  const BROTHER_OMAD_NPC_ID = NpcIdentifiers.BROTHER_OMAD;
  const BROTHER_CEDRIC_NPC_ID = NpcIdentifiers.BROTHER_CEDRIC;

  const VARP_MONKS_FRIEND = 30;
  const STAGE_STARTED = 10;
  const STAGE_RETURNED_BLANKET = 20;
  const STAGE_LOOKING_FOR_CEDRIC = 30;
  const STAGE_FINDING_WATER = 40;
  const STAGE_GIVEN_WATER = 50;
  const STAGE_FIXING_CART = 60;
  const STAGE_FIXED_CART = 70;
  const STAGE_COMPLETE = 80;

  const CHILDS_BLANKET_ITEM_ID = ItemIdentifiers.CHILDS_BLANKET;
  const JUG_OF_WATER_ITEM_ID = ItemIdentifiers.JUG_OF_WATER;
  const LOGS_ITEM_ID = ItemIdentifiers.LOGS;
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK;
  const LAW_RUNE_ITEM_ID = ItemIdentifiers.LAW_RUNE;

  const HIDDEN_LADDER_LOC_ID = ObjectIdentifiers.LADDER_192;
  /** The ordinary cellar ladder (ladder_from_cellar), used in many places: only this one is the cave's. */
  const CAVE_LADDER_LOC_ID = ObjectIdentifiers.LADDER_216;
  const CAVE_LADDER_TILE = { x: 2561, y: 9622, z: 0 };

  // The stone circle the wiki marks with {{Map|2561,3221|r=4|mtype=square}}.
  const STONE_CIRCLE_BOUNDS = new Boundary(2557, 2565, 3217, 3225, 0);
  const HIDDEN_LADDER_LOCATION = new Location(2561, 3221, 0);
  const HIDDEN_LADDER_TYPE = 10;
  const HIDDEN_LADDER_FACE = 0;
  const LADDER_APPEARS_MESSAGE = "A ladder mysteriously appears.";
  const CAVE_LADDER_DESTINATION = new Location(2561, 9621, 0);
  const CAVE_LADDER_RETURN = new Location(2561, 3221, 0);

  const DANCING_CUTSCENE_VARIANT = "brother-cedric-dancing-cutscene";
  const DANCING_CUTSCENE_ACTION_ID = "KiiD54";

  const START_HOOK = "quest:monk-s-friend:start";
  const COMPLETE_ACTION_ID = "QwqMu_";
  const BLANKET_MESSAGE_ID = "bT1LEg";
  const WATER_MESSAGE_ID = "w4kh6u";
  const LOGS_MESSAGE_ID = "nd6lda";
  const PLANK_MESSAGE_ID = "Gil6fA";
  const RUNE_BOX_MESSAGE_ID = "iTAzwR";

  const PARTY_UNTIL_ATTRIBUTE = "monks-friend:party-until";
  const PARTY_DURATION_MS = 20 * 60 * 1000;
  const ARDOUGNE_MONK_NPC_ID = NpcIdentifiers.MONK_13;
  const RUNE_REWARD_COUNT = 8;
  const RUNE_REWARD_PAID_ATTRIBUTE = "monks-friend:rune-reward-paid";
  const RUNE_REWARD_PENDING_ATTRIBUTE = "monks-friend:rune-reward-pending";

  let quest;
  // The hidden ladder exists only while the stone circle has a player in it.
  let hiddenLadder = null;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasWood = (player) => hasItem(player, LOGS_ITEM_ID) || hasItem(player, PLANK_ITEM_ID);

  /** The canonical circle ladder 16680 is not on the map; it appears for whoever stands in the ring. */
  function createStoneCircleArea() {
    class StoneCircleArea extends api.core.Area {
      postEnter(mobile) {
        if (!mobile.isPlayer()) return;
        if (!hiddenLadder) {
          hiddenLadder = new GameObject(
            HIDDEN_LADDER_LOC_ID,
            HIDDEN_LADDER_LOCATION.clone(),
            HIDDEN_LADDER_TYPE,
            HIDDEN_LADDER_FACE,
            null
          );
          api.getObjectManager().register(hiddenLadder, true);
        }
        mobile.getAsPlayer().sendMessage(LADDER_APPEARS_MESSAGE);
      }

      postLeave(mobile) {
        if (!mobile.isPlayer() || !hiddenLadder || this.getPlayers().length > 0) return;
        api.getObjectManager().deregister(hiddenLadder, true);
        hiddenLadder = null;
      }
    }
    return new StoneCircleArea([STONE_CIRCLE_BOUNDS]);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const blanket = "<str>I recovered the child's blanket for Brother Omad.</str>";
    if (stage >= STAGE_COMPLETE) {
      return [
        blanket,
        "<str>I helped Brother Cedric repair his cart.</str>",
        "<str>I returned to the monastery for the party.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FIXED_CART) {
      return [blanket, "<str>I repaired Brother Cedric's cart.</str>", "I should return to <col=800000>Brother Omad</col>."];
    }
    if (stage >= STAGE_FIXING_CART) {
      return [blanket, "Brother Cedric needs some ordinary <col=800000>logs</col>", "to repair his broken cart."];
    }
    if (stage >= STAGE_GIVEN_WATER) {
      return [blanket, "<str>I sobered Brother Cedric up with water.</str>", "I should ask whether he needs more help."];
    }
    if (stage >= STAGE_FINDING_WATER) {
      return [blanket, "Brother Cedric is drunk. I need to bring him", "a <col=800000>jug of water</col>."];
    }
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) {
      return [blanket, "I should find <col=800000>Brother Cedric</col> on the road", "south of the Ardougne zoo."];
    }
    if (stage >= STAGE_RETURNED_BLANKET) {
      return [blanket, "I should ask <col=800000>Brother Omad</col> about the party."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Brother Omad asked me to recover a child's blanket.",
        "The thieves' cave is hidden beneath a <col=800000>ring of stones</col>",
        "south-west of the Clock Tower.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Brother Omad</col> at the monastery south of",
      "<col=800000>Ardougne</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.WOODCUTTING, 2000);
    // The transcript page titles the party chatter "for 20 minutes"; after that
    // the named Brother Omad page is the source-backed post-quest variant.
    player.setAttribute(PARTY_UNTIL_ATTRIBUTE, Date.now() + PARTY_DURATION_MS);
    // Settle the deferred full-bag handover here so quest:completed observers
    // already see the paid state. The normal bag was paid at the rune box.
    settleRuneReward(player);
  }

  function partyActive(player) {
    const until = Number(player.getAttribute(PARTY_UNTIL_ATTRIBUTE)) || 0;
    return until > Date.now();
  }

  function runeRewardPaid(player) {
    return Number(player.getAttribute(RUNE_REWARD_PAID_ATTRIBUTE)) === 1;
  }

  function runeRewardPending(player) {
    return Number(player.getAttribute(RUNE_REWARD_PENDING_ATTRIBUTE)) === 1;
  }

  function markRuneRewardPaid(player) {
    player.setAttribute(RUNE_REWARD_PAID_ATTRIBUTE, 1);
    player.setAttribute(RUNE_REWARD_PENDING_ATTRIBUTE, 0);
  }

  function canHoldRuneReward(player) {
    const inventory = player.getInventory();
    // Law runes stack, so an existing stack always takes the reward.
    return inventory.getAmount(LAW_RUNE_ITEM_ID) > 0 || inventory.getFreeSlots() > 0;
  }

  /**
   * The canonical tbox handover is before the party. Pay the eight runes there
   * when they fit; otherwise remember the deferred drop for the completion
   * reward after the dancing. Both flags are persisted so a re-talk or relog
   * cannot pay twice.
   */
  function grantRunesAtBox(player) {
    if (runeRewardPaid(player) || runeRewardPending(player)) return;
    if (!canHoldRuneReward(player)) {
      player.setAttribute(RUNE_REWARD_PENDING_ATTRIBUTE, 1);
      return;
    }
    const before = player.getInventory().getAmount(LAW_RUNE_ITEM_ID);
    player.getInventory().adds(LAW_RUNE_ITEM_ID, RUNE_REWARD_COUNT);
    if (player.getInventory().getAmount(LAW_RUNE_ITEM_ID) === before + RUNE_REWARD_COUNT) {
      markRuneRewardPaid(player);
    } else {
      player.setAttribute(RUNE_REWARD_PENDING_ATTRIBUTE, 1);
    }
  }

  /** Called from the completion reward after the dancing: settle once, or fall back if no box ran. */
  function settleRuneReward(player) {
    if (runeRewardPaid(player)) {
      player.setAttribute(RUNE_REWARD_PENDING_ATTRIBUTE, 0);
      return;
    }
    player.getInventory().forceAdd(player, new Item(LAW_RUNE_ITEM_ID, RUNE_REWARD_COUNT));
    markRuneRewardPaid(player);
  }

  function omadVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return partyActive(player)
        ? "post-quest-dialogue-for-20-minutes-talking-to-brother-omad"
        : { page: "Brother Omad", variant: "standard-dialogue-post-quest" };
    }
    if (stage >= STAGE_FIXED_CART) return "brother-cedric-talking-to-brother-omad-after-finding-and-helping-brother-cedric";
    if (stage >= STAGE_GIVEN_WATER) return "brother-cedric-talking-to-brother-omad-after-giving-brother-cedric-water";
    if (stage >= STAGE_FINDING_WATER) return "brother-cedric-talking-to-brother-omad-after-finding-brother-cedric";
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) return "brother-cedric-talking-to-brother-omad-before-finding-brother-cedric";
    if (stage >= STAGE_RETURNED_BLANKET) return "brother-cedric-talking-to-brother-omad-again";
    if (stage >= STAGE_STARTED) {
      return hasItem(player, CHILDS_BLANKET_ITEM_ID)
        ? "child-s-blanket-talking-to-brother-omad-after-retrieving-the-blanket"
        : "getting-started-talking-to-brother-omad-before-retrieving-the-blanket";
    }
    return "getting-started-talking-to-brother-omad";
  }

  function cedricVariant(stage, player) {
    // After completion Cedric is on the "Brother Cedric" page, not the quest page.
    if (stage >= STAGE_COMPLETE) return "after-monk-s-friend";
    if (stage >= STAGE_FIXED_CART) return "brother-cedric-talking-to-brother-cedric-again-before-returning";
    if (stage >= STAGE_FIXING_CART) {
      return hasWood(player)
        ? "brother-cedric-talking-to-brother-cedric-while-holding-some-wood"
        : "brother-cedric-talking-to-brother-cedric-before-getting-some-wood";
    }
    if (stage >= STAGE_GIVEN_WATER) {
      return "brother-cedric-talking-to-brother-cedric-after-giving-him-water-before-accepting-to-help-with-the-cart";
    }
    if (stage >= STAGE_FINDING_WATER) {
      return hasItem(player, JUG_OF_WATER_ITEM_ID)
        ? "brother-cedric-talking-to-brother-cedric-with-water"
        : "brother-cedric-talking-to-brother-cedric-before-getting-water";
    }
    if (stage >= STAGE_LOOKING_FOR_CEDRIC) {
      // The dump has no action for this transition; the reference advances when
      // Cedric asks for water, so do it as the conversation begins.
      quest.setStage(player, STAGE_FINDING_WATER);
      return "brother-cedric-talking-to-brother-cedric";
    }
    return "brother-cedric-talking-to-brother-cedric-before-agreeing-to-find-him";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === BROTHER_OMAD_NPC_ID) return omadVariant(quest.getStage(player), player);
    if (npcId === BROTHER_CEDRIC_NPC_ID) return cedricVariant(quest.getStage(player), player);
    // The Ardougne monastery monks share the party chatter for the same window.
    // After it expires their named page's default standard dialogue is correct.
    if (npcId === ARDOUGNE_MONK_NPC_ID) return monkVariant(quest.getStage(player), player);
    return null;
  }

  function monkVariant(stage, player) {
    if (stage < STAGE_STARTED) {
      return { page: "Monk", variant: "ardougne-monastery-before-monk-s-friend" };
    }
    if (stage >= STAGE_COMPLETE) {
      return partyActive(player)
        ? "post-quest-dialogue-for-20-minutes-talking-to-the-monks"
        : { page: "Monk", variant: "ardougne-monastery-after-monk-s-friend" };
    }
    if (stage >= STAGE_RETURNED_BLANKET) {
      return "child-s-blanket-talking-to-a-monk-after-retrieving-the-blanket";
    }
    // The quest's own monk line while the blanket is still missing. The generic
    // "Monk" page would offer the healing menu, but monks at the Ardougne
    // Monastery do not heal, so the quest line is the correct one here.
    return { page: "Monk's Friend", variant: "getting-started-monk-overhead" };
  }

  /**
   * The wood leg has two sibling conditions ("has logs", "has a plank"). The
   * shared runner plays the first true branch and then keeps the remaining
   * siblings as a tail, so a player carrying both would hand over a log *and*
   * a plank. Logs are the canonical hand-over, so the plank branch is answered
   * false while logs are held and once the cart is repaired.
   */
  function answerCondition({ player, npcId, text }) {
    if (npcId !== BROTHER_OMAD_NPC_ID && npcId !== BROTHER_CEDRIC_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("has logs")) return hasItem(player, LOGS_ITEM_ID);
    if (value.includes("has a plank")) {
      if (hasItem(player, LOGS_ITEM_ID)) return false;
      if (quest.getStage(player) >= STAGE_FIXED_CART) return false;
      return hasItem(player, PLANK_ITEM_ID);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== BROTHER_OMAD_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    const value = String(option ?? "").toLowerCase();
    const stage = quest.getStage(player);
    if (npcId === BROTHER_OMAD_NPC_ID && stage >= STAGE_RETURNED_BLANKET && stage < STAGE_LOOKING_FOR_CEDRIC) {
      if (value.includes("where should i look")) quest.setStage(player, STAGE_LOOKING_FOR_CEDRIC);
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && stage >= STAGE_GIVEN_WATER && stage < STAGE_FIXING_CART) {
      if (value.includes("yes") && value.includes("happy to")) quest.setStage(player, STAGE_FIXING_CART);
    }
  }

  /** The transcript's hand-over messages consume the item and advance the stage. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    const stage = quest.getStage(player);
    // The rune item box is the canonical handover: normal bags are paid at the
    // box; a full bag stays pending and is settled by the completion reward.
    if (npcId === BROTHER_OMAD_NPC_ID && stepId === RUNE_BOX_MESSAGE_ID
      && stage >= STAGE_FIXED_CART && stage < STAGE_COMPLETE) {
      event.box = { items: [LAW_RUNE_ITEM_ID] };
      grantRunesAtBox(player);
      return;
    }
    // "Dancing cutscene begins" points at the cutscene's own transcript variant,
    // which carries the completion action.
    if (stepId === DANCING_CUTSCENE_ACTION_ID) {
      const steps = loadTranscripts(api)?.[PAGE]?.variants?.[DANCING_CUTSCENE_VARIANT];
      event.handled = true;
      event.steps = Array.isArray(steps) ? steps : [];
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && stage >= STAGE_FIXED_CART) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (npcId === BROTHER_OMAD_NPC_ID && stepId === BLANKET_MESSAGE_ID && hasItem(player, CHILDS_BLANKET_ITEM_ID)) {
      player.getInventory().deleteNumber(CHILDS_BLANKET_ITEM_ID, 1);
      player.sendMessage("You hand the monk the child's blanket.");
      if (stage < STAGE_RETURNED_BLANKET) quest.setStage(player, STAGE_RETURNED_BLANKET);
      event.handled = true;
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && stepId === WATER_MESSAGE_ID && hasItem(player, JUG_OF_WATER_ITEM_ID)) {
      player.getInventory().deleteNumber(JUG_OF_WATER_ITEM_ID, 1);
      player.sendMessage("You hand the monk a jug of water.");
      if (stage < STAGE_GIVEN_WATER) quest.setStage(player, STAGE_GIVEN_WATER);
      event.handled = true;
      return;
    }
    if (npcId === BROTHER_CEDRIC_NPC_ID && (stepId === LOGS_MESSAGE_ID || stepId === PLANK_MESSAGE_ID)) {
      const itemId = stepId === LOGS_MESSAGE_ID ? LOGS_ITEM_ID : PLANK_ITEM_ID;
      // One hand-over repairs the cart: a repaired cart never takes more wood.
      if (stage >= STAGE_FIXED_CART || !hasItem(player, itemId)) {
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.sendMessage("You help Cedric repair the cart.");
      if (stage < STAGE_FIXED_CART) quest.setStage(player, STAGE_FIXED_CART);
      event.handled = true;
    }
  }

  function isCaveLadder(location) {
    return location?.x === CAVE_LADDER_TILE.x && location?.y === CAVE_LADDER_TILE.y && location?.z === CAVE_LADDER_TILE.z;
  }

  function isHiddenLadder(location) {
    return location?.x === HIDDEN_LADDER_LOCATION.getX()
      && location?.y === HIDDEN_LADDER_LOCATION.getY()
      && location?.z === HIDDEN_LADDER_LOCATION.getZ();
  }

  /** The ladders into and out of the thieves' cave. */
  function handleLadderInteraction(event) {
    const { objectId, player } = event;
    // 16680 is a common dungeon-entrance ladder; only our spawned circle one counts.
    if (objectId === HIDDEN_LADDER_LOC_ID && isHiddenLadder(event.location)) {
      player.moveTo(CAVE_LADDER_DESTINATION.clone());
      event.handled = true;
    } else if (objectId === CAVE_LADDER_LOC_ID && isCaveLadder(event.location)) {
      player.moveTo(CAVE_LADDER_RETURN.clone());
      event.handled = true;
    }
  }

  // No fixed starting value (a wall-clock deadline), but it must survive relog.
  api.persistAttribute(PARTY_UNTIL_ATTRIBUTE);
  api.persistAttribute(RUNE_REWARD_PAID_ATTRIBUTE, 0);
  api.persistAttribute(RUNE_REWARD_PENDING_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "monks_friend",
    name: "Monk's Friend",
    varpId: VARP_MONKS_FRIEND,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.WOODCUTTING.getIndex(), amount: 2000, label: "Woodcutting" }],
    scrollItemId: LAW_RUNE_ITEM_ID,
    rewardItemLabel: "8 Law runes",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleLadderInteraction);
  api.registerArea(createStoneCircleArea());
};
