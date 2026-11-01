/**
 * Priest in Peril (members).
 *
 * The words come from the "Priest in Peril" transcript page; this plugin supplies
 * the variant selector for King Roald and Drezel (both indexed), the prose-
 * condition answers, the start hook, the monuments, the well, the cell gate, the
 * coffin and the essence hand-in. The monument lines come from the wiki's
 * "Transcript:Monument" page, which the dialogue dump does not cover.
 *
 * Saved stages (quest.priest_in_peril.stage): 10 started, 20 guardian killed,
 * 30 told King Roald, 40 met Drezel, 43 cell unlocked, 46 vampyre sealed,
 * 50 asked to meet in the mausoleum, 55 repairing the barrier, 60 complete.
 * The client sees OSRS's own varp 302 values (see wireValue); saves made before
 * 43/46/55 existed keep their meaning (an old 50 had the vampyre sealed).
 */
module.exports = function registerPriestInPerilQuest(api) {
  const {
    Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location,
    StatementDialogue, ItemStatementDialogue, DoubleItemStatementDialogue, DialogueChainBuilder,
    HitDamage, HitMask, Item,
  } = api.core;
  const { registerQuest, startTranscript, startDialogue, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Priest in Peril";
  const DREZEL_PAGE = "Drezel";

  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD,
    NpcIdentifiers.KING_ROALD_3,
    NpcIdentifiers.KING_ROALD_5,
    NpcIdentifiers.KING_ROALD_6,
    NpcIdentifiers.KING_ROALD_7,
  ]);
  /** Both Drezels (cell 9804, mausoleum 9805) resolve to 9636; their tile tells them apart. */
  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL;
  /** The world guardian 3487 resolves to the attackable 7620 at varp 302 values 0-2. */
  const TEMPLE_GUARDIAN_NPC_IDS = new Set([NpcIdentifiers.TEMPLE_GUARDIAN, 3487]);
  /** The hooded level 30 Monk of Zamorak (3486, shown as 16273): the only one with the golden key. */
  const HOODED_MONK_NPC_IDS = new Set([NpcIdentifiers.MONK_OF_ZAMORAK_6, NpcIdentifiers.MONK_OF_ZAMORAK_17]);

  const VARP_PRIEST_IN_PERIL = 302;
  const STAGE_STARTED = 10;
  const STAGE_GUARDIAN_KILLED = 20;
  const STAGE_TOLD_KING_ROALD = 30;
  const STAGE_MET_DREZEL = 40;
  const STAGE_CELL_UNLOCKED = 43;
  const STAGE_VAMPYRE_SEALED = 46;
  const STAGE_MEET_IN_MAUSOLEUM = 50;
  const STAGE_REPAIRING_BARRIER = 55;
  const STAGE_COMPLETE = 60;

  /**
   * Varp 302 as live OSRS sends it (Quest Helper's PriestInPeril steps; the cache's
   * transforms key on the same values): 1 started, 2 agreed to kill the dog,
   * 3 dog killed, 4 King told, 5 met Drezel, 6 cell unlocked, 7 coffin sealed,
   * 8 meet in the mausoleum, 10-59 essence (60 minus the essence still owed), 61 done.
   * The guardian 3487 shows at 0-2, the cell Drezel at 4-8, the mausoleum Drezel at 8-61.
   */
  function wireValue(stage, player) {
    if (stage >= STAGE_COMPLETE) return 61;
    if (stage >= STAGE_REPAIRING_BARRIER) return 10 + Math.min(ESSENCE_REQUIRED - 1, essenceHandedIn(player));
    if (stage >= STAGE_MEET_IN_MAUSOLEUM) return 8;
    if (stage >= STAGE_VAMPYRE_SEALED) return 7;
    if (stage >= STAGE_CELL_UNLOCKED) return 6;
    if (stage >= STAGE_MET_DREZEL) return 5;
    if (stage >= STAGE_TOLD_KING_ROALD) return 4;
    if (stage >= STAGE_GUARDIAN_KILLED) return 3;
    if (stage >= STAGE_STARTED) return agreedToKillDog(player) ? 2 : 1;
    return 0;
  }

  const GOLDEN_KEY_ITEM_ID = ItemIdentifiers.GOLDEN_KEY;
  const IRON_KEY_ITEM_ID = ItemIdentifiers.IRON_KEY;
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const MURKY_WATER_ITEM_ID = ItemIdentifiers.MURKY_WATER;
  const BLESSED_WATER_ITEM_ID = ItemIdentifiers.BLESSED_WATER;
  const RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE;
  const PURE_ESSENCE_ITEM_ID = ItemIdentifiers.PURE_ESSENCE;
  const NOTED_ESSENCE_ITEM_IDS = [ItemIdentifiers.RUNE_ESSENCE_2, ItemIdentifiers.PURE_ESSENCE_2];
  const ESSENCE_REQUIRED = 50;

  const START_HOOK = "quest:priest-in-peril:start";
  /** Transcript action that ends the "giving the last of the essence" branch. */
  const COMPLETE_ACTION_ID = "5wj46V";
  /** "You give Drezel some essence." message steps (last batch and partial ones). */
  const ESSENCE_MESSAGE_IDS = new Set(["4daSZa", "ViQ2ji"]);
  /** "Drezel inspects the water. He then says some sort of prayer." */
  const BLESSING_MESSAGE_ID = "feQ9cD";
  const ESSENCE_REMAINING_BLANK = "[1-50]";
  const ESSENCE_HANDED_ATTRIBUTE = "priest-in-peril:essence-handed-in";
  /** How many times Drezel has blessed water: his "first time" lines follow the first blessing. */
  const BLESSINGS_ATTRIBUTE = "priest-in-peril:blessings";
  /** Bit per monument (MONUMENTS index) whose golden souvenir has been swapped out. */
  const SOUVENIRS_ATTRIBUTE = "priest-in-peril:souvenirs";
  /** Transcript message shown only below the recommended combat level. */
  const COMBAT_WARNING_STEP_ID = "0cBLcT";
  const RECOMMENDED_COMBAT_LEVEL = 15;

  // The mausoleum trapdoors: 1579 north of the temple (over the mausoleum ladder)
  // and 3432 inside the church.
  const NORTH_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_4; // 1579 at 3405,3507
  const CHURCH_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_12; // 3432 at 3422,3485
  const MAUSOLEUM_LADDER_ID = ObjectIdentifiers.LADDER_216; // 17385 at 3405,9907
  const LARGE_DOOR_IDS = new Set([
    ObjectIdentifiers.LARGE_DOOR_21, // 3489
    ObjectIdentifiers.LARGE_DOOR_22, // 3490
  ]);
  const CELL_GATE_ID = ObjectIdentifiers.CELL_GATE_7; // 3463 at 3415,3489,2
  const COFFIN_ID = ObjectIdentifiers.COFFIN_7; // 3480 at 3413,3486,2
  const WELL_ID = ObjectIdentifiers.WELL_6; // 3485 at 3423,9890,0
  const MYSTERIOUS_VOICE_NPC_ID = 12240;
  const DOOR_ANSWERED_ATTRIBUTE = "priest-in-peril:door-answered";

  /**
   * The seven monuments around the well. Positions from the cache, items from the
   * wiki's golden item pages (west pot, north hammer, east feather, south needle,
   * south-east tinderbox, north-west candle; the north-east one holds the iron key).
   */
  const MONUMENTS = [
    { id: ObjectIdentifiers.MONUMENT, name: "pot", items: [ItemIdentifiers.POT], golden: ItemIdentifiers.GOLDEN_POT,
      study: "Saradomin is the vessel that keeps us safe from harm." },
    { id: ObjectIdentifiers.MONUMENT_2, name: "hammer", items: [ItemIdentifiers.HAMMER], golden: ItemIdentifiers.GOLDEN_HAMMER,
      study: "Saradomin is the hammer that crushes evil everywhere." },
    { id: ObjectIdentifiers.MONUMENT_3, name: "feather", items: [ItemIdentifiers.FEATHER], golden: ItemIdentifiers.GOLDEN_FEATHER,
      study: "Saradomin is the delicate touch that brushes us with love." },
    { id: ObjectIdentifiers.MONUMENT_4, name: "needle", items: [ItemIdentifiers.NEEDLE], golden: ItemIdentifiers.GOLDEN_NEEDLE,
      study: "Saradomin is the needle that binds our lives together." },
    { id: ObjectIdentifiers.MONUMENT_5, name: "key", key: true,
      study: "Saradomin is the key that unlocks the mysteries of life." },
    { id: ObjectIdentifiers.MONUMENT_6, name: "tinderbox", items: [ItemIdentifiers.TINDERBOX], golden: ItemIdentifiers.GOLDEN_TINDERBOX,
      study: "Saradomin is the spark that lights the fire in our hearts." },
    { id: ObjectIdentifiers.MONUMENT_7, name: "candle", items: [ItemIdentifiers.CANDLE, ItemIdentifiers.LIT_CANDLE],
      golden: ItemIdentifiers.GOLDEN_CANDLE, study: "Saradomin is the light that shines throughout our lives." },
  ];

  const NORTH_TRAPDOOR_LOCATION = { x: 3405, y: 3507, z: 0 };
  const CHURCH_TRAPDOOR_LOCATION = { x: 3422, y: 3485, z: 0 };
  const CELL_GATE_LOCATION = { x: 3415, y: 3489, z: 2 };
  const COFFIN_LOCATION = { x: 3413, y: 3486, z: 2 };
  const WELL_LOCATION = { x: 3423, y: 9890, z: 0 };
  // Walkable tiles beside each trapdoor to route to first (the trapdoor itself
  // is ground decoration, so walkToObject cannot find a side to stand on).
  const NORTH_TRAPDOOR_APPROACH = { x: 3405, y: 3506, z: 0 };
  const CHURCH_TRAPDOOR_APPROACH = { x: 3421, y: 3485, z: 0 };
  const MAUSOLEUM_LADDER_LOCATION = { x: 3405, y: 9907, z: 0 };
  const NORTH_TRAPDOOR_LANDING = new Location(3405, 9906, 0);
  const CHURCH_TRAPDOOR_LANDING = new Location(3422, 9885, 0);
  const MAUSOLEUM_LADDER_LANDING = new Location(3405, 3506, 0);
  const HOLY_BARRIER_LANDING = new Location(3423, 3485, 0);
  /** The cell gate's wall is on the east edge of its tile: Drezel's cell is east of it. */
  const CELL_OUTSIDE = new Location(3415, 3489, 2);
  const CELL_INSIDE = new Location(3416, 3489, 2);
  /** Drezel's cell spawn is on the temple's top floor; the mausoleum one is underground. */
  const MAUSOLEUM_MIN_Y = 9000;

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function agreedToKillDog(player) {
    return Boolean(player.getAttribute(DOOR_ANSWERED_ATTRIBUTE));
  }

  function essenceCount(player) {
    return (
      player.getInventory().getAmount(RUNE_ESSENCE_ITEM_ID) +
      player.getInventory().getAmount(PURE_ESSENCE_ITEM_ID)
    );
  }

  /** Hand-ins are banked: 50 unnoted essence do not fit in one inventory. */
  function essenceHandedIn(player) {
    return Number(player.getAttribute(ESSENCE_HANDED_ATTRIBUTE)) || 0;
  }

  /** Takes only what is still owed, so a full inventory never overpays. */
  function giveEssenceToDrezel(player) {
    let owed = ESSENCE_REQUIRED - essenceHandedIn(player);
    for (const itemId of [RUNE_ESSENCE_ITEM_ID, PURE_ESSENCE_ITEM_ID]) {
      const amount = Math.min(owed, player.getInventory().getAmount(itemId));
      if (amount > 0) {
        player.getInventory().deleteNumber(itemId, amount);
        owed -= amount;
      }
    }
    player.setAttribute(ESSENCE_HANDED_ATTRIBUTE, ESSENCE_REQUIRED - owed);
    // The essence still owed is part of the varp (60 minus it).
    if (quest.getStage(player) === STAGE_REPAIRING_BARRIER) quest.setStage(player, STAGE_REPAIRING_BARRIER);
  }

  function sameTile(location, tile) {
    return Boolean(location) && location.x === tile.x && location.y === tile.y && (location.z ?? 0) === tile.z;
  }

  function adjacentTo(location, tile) {
    return Math.max(Math.abs(location.x - tile.x), Math.abs(location.y - tile.y)) <= 1;
  }

  function inMausoleum(npc) {
    return (npc?.getLocation?.()?.getY?.() ?? 0) >= MAUSOLEUM_MIN_Y;
  }

  function showStatement(player, text) {
    StatementDialogue.send(player, text);
  }

  function showItemStatement(player, itemId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text))
    );
  }

  function showSwap(player, givenItemId, takenItemId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new DoubleItemStatementDialogue(0, givenItemId, takenItemId, text))
    );
  }

  function sayAsPlayer(player, line) {
    startDialogue(api, player, { npcId: DREZEL_NPC_ID }, [{ player: [line] }]);
  }

  function playPage(player, variant, npcId = DREZEL_NPC_ID) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  /**
   * The trapdoors are ground decoration (shape 22): walkToObject cannot find a
   * side to stand on, so the click never reaches the interaction hooks. Route to
   * a walkable tile beside one first; an adjacent click stands still.
   */
  function handleTrapdoorRoute(event) {
    const objectLocation = event.object?.getLocation?.();
    if (event.objectId === NORTH_TRAPDOOR_ID && sameTile(objectLocation, NORTH_TRAPDOOR_LOCATION)) {
      event.destination = adjacentTo(event.sourceLocation, NORTH_TRAPDOOR_LOCATION)
        ? { ...event.sourceLocation }
        : { ...NORTH_TRAPDOOR_APPROACH };
      return;
    }
    if (event.objectId === CHURCH_TRAPDOOR_ID && sameTile(objectLocation, CHURCH_TRAPDOOR_LOCATION)) {
      event.destination = adjacentTo(event.sourceLocation, CHURCH_TRAPDOOR_LOCATION)
        ? { ...event.sourceLocation }
        : { ...CHURCH_TRAPDOOR_APPROACH };
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I restored the River Salve barrier.</str>",
        "<str>Drezel can safely guard the temple again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_REPAIRING_BARRIER) {
      const owed = ESSENCE_REQUIRED - essenceHandedIn(player);
      return [
        "<str>I freed Drezel and sealed the vampyre's coffin.</str>",
        `Drezel needs <col=800000>${owed} more rune or pure essence</col>`,
        "to restore the River Salve barrier.",
      ];
    }
    if (stage >= STAGE_MEET_IN_MAUSOLEUM) {
      return [
        "<str>I freed Drezel and sealed the vampyre's coffin.</str>",
        "I should meet <col=800000>Drezel</col> in the mausoleum.",
      ];
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      return [
        "<str>I sealed the vampyre's coffin with blessed water.</str>",
        "I should talk to <col=800000>Drezel</col> again.",
      ];
    }
    if (stage >= STAGE_CELL_UNLOCKED) {
      return [
        "<str>I unlocked Drezel's cell.</str>",
        "Drezel can bless <col=800000>water from the Salve</col> to deal",
        "with the vampyre in the coffin.",
      ];
    }
    if (stage >= STAGE_MET_DREZEL) {
      return [
        "<str>I found Drezel imprisoned at the top of the temple.</str>",
        "I need to find the <col=800000>key to his cell</col> and deal",
        "with the vampyre in the coffin.",
      ];
    }
    if (stage >= STAGE_TOLD_KING_ROALD) {
      return [
        "King Roald explained that the creature guarded Misthalin.",
        "I must return to the temple and rescue <col=800000>Drezel</col>.",
      ];
    }
    if (stage >= STAGE_GUARDIAN_KILLED) {
      return [
        "<str>I killed the creature at the temple.</str>",
        "I should report back to <col=800000>King Roald</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "King Roald sent me to check on <col=800000>Drezel</col>.",
        "I should investigate the temple east of Varrock.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>King Roald</col> in Varrock Palace.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1406);
  }

  function kingRoaldVariant(stage, player) {
    // Shield of Arrav also finishes at King Roald; defer to its handler once the
    // player has joined a gang (otherwise its certificate branch is unreachable).
    const shieldStage = Number(player.getAttribute("quest.shield_of_arrav.stage")) || 0;
    if (shieldStage >= 4) return null;
    if (stage >= STAGE_COMPLETE) {
      return { page: "King Roald", variant: "standard-dialogue-after-priest-in-peril" };
    }
    if (stage >= STAGE_MEET_IN_MAUSOLEUM) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-king-roald-again";
    }
    if (stage >= STAGE_CELL_UNLOCKED) return "talking-to-drezel-with-the-iron-key-updating-king-roald";
    if (stage >= STAGE_MET_DREZEL) return "saving-drezel-and-the-world-updating-king-roald";
    if (stage >= STAGE_TOLD_KING_ROALD) return "you-killed-a-dog-talking-to-him-again";
    if (stage >= STAGE_GUARDIAN_KILLED) {
      // Telling him about the dog is what completes "report back to King Roald".
      quest.setStage(player, STAGE_TOLD_KING_ROALD);
      return "you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog";
    }
    if (stage >= STAGE_STARTED) {
      return agreedToKillDog(player)
        ? "at-the-temple-talking-to-king-roald-after-accepting-to-kill-the-dog"
        : "starting-the-quest-talking-to-king-roald-again";
    }
    return "starting-the-quest";
  }

  /** The Drezel in the mausoleum takes the essence once the vampyre is sealed. */
  function mausoleumDrezelVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) return { page: DREZEL_PAGE, variant: "standard-dialogue-after-priest-in-peril" };
    if (stage >= STAGE_REPAIRING_BARRIER) {
      if (essenceCount(player) > 0) {
        return essenceHandedIn(player) + essenceCount(player) >= ESSENCE_REQUIRED
          ? "giving-drezel-the-last-of-the-essence"
          : "repairing-the-barrier-bringing-drezel-essence";
      }
      if (NOTED_ESSENCE_ITEM_IDS.some((itemId) => held(player, itemId))) {
        return "repairing-the-barrier-bringing-drezel-noted-essence";
      }
      return essenceHandedIn(player) > 0
        ? "repairing-the-barrier-talking-to-drezel-again-2"
        : "repairing-the-barrier-talking-to-drezel-again";
    }
    if (stage >= STAGE_MEET_IN_MAUSOLEUM) {
      quest.setStage(player, STAGE_REPAIRING_BARRIER);
      return "repairing-the-barrier";
    }
    return null;
  }

  /** The Drezel in the cell: the key, the blessing, the coffin and the move downstairs. */
  function cellDrezelVariant(stage, player) {
    if (stage >= STAGE_MEET_IN_MAUSOLEUM) {
      return "after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-drezel-again";
    }
    if (stage >= STAGE_VAMPYRE_SEALED) {
      quest.setStage(player, STAGE_MEET_IN_MAUSOLEUM);
      return "after-drezel-is-freed-and-the-vampyre-is-sealed";
    }
    // Without blessed water, talkToUnlockedDrezel already played his conversation.
    if (stage >= STAGE_CELL_UNLOCKED) return "talking-to-drezel-with-the-iron-key-talking-to-drezel-with-blessed-water";
    if (stage >= STAGE_MET_DREZEL) {
      if (held(player, IRON_KEY_ITEM_ID)) return "talking-to-drezel-with-the-iron-key";
      if (held(player, GOLDEN_KEY_ITEM_ID)) return "saving-drezel-and-the-world-talking-to-drezel-with-the-golden-key";
      if (held(player, MURKY_WATER_ITEM_ID)) {
        return "saving-drezel-and-the-world-talking-to-drezel-with-murky-water-before-unlocking-the-cell";
      }
      return "saving-drezel-and-the-world-talking-to-drezel-again";
    }
    quest.setStage(player, STAGE_MET_DREZEL);
    return "saving-drezel-and-the-world-meeting-drezel";
  }

  const UNLOCK_VARIANT = "talking-to-drezel-with-the-iron-key-unlocking-drezel-s-cell";
  /** The unlock message and "The key fit the lock!" open the variant; the rest is Drezel's. */
  const UNLOCK_OPENING_STEPS = 2;

  function needsUnlockedTalk(player) {
    return quest.getStage(player) === STAGE_CELL_UNLOCKED
      && (held(player, MURKY_WATER_ITEM_ID) || !held(player, BLESSED_WATER_ITEM_ID));
  }

  /**
   * Talking to Drezel in his unlocked cell replays the unlocking conversation after
   * its "You use the key..." opening: the murky-water branch blesses it, the other
   * asks for water from the Salve. The transcript runtime cannot slice a variant, so
   * this claims the Talk-to before it (onNpcInteraction runs ahead of the runtime).
   */
  function talkToUnlockedDrezel(event) {
    const { player, npc, npcId, clickType } = event;
    if (npcId !== DREZEL_NPC_ID || clickType !== 1 || inMausoleum(npc) || !needsUnlockedTalk(player)) return;
    event.handled = startTranscript(api, player, DREZEL_NPC_ID, PAGE, UNLOCK_VARIANT,
      (steps) => steps.slice(UNLOCK_OPENING_STEPS), npc);
  }

  /** Which transcript variant the speaker plays. */
  function selectVariant({ npcId, npc, player }) {
    const stage = quest.getStage(player);
    if (KING_ROALD_NPC_IDS.has(npcId)) return kingRoaldVariant(stage, player);
    if (npcId !== DREZEL_NPC_ID) return null;
    if (inMausoleum(npc)) return mausoleumDrezelVariant(stage, player);
    if (stage >= STAGE_COMPLETE) return null;
    return cellDrezelVariant(stage, player);
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("attempts to use magic spells on the guardian")) return true;
    if (value.includes("doesn't have murky water")) return !held(player, MURKY_WATER_ITEM_ID);
    if (value.includes("has murky water")) return held(player, MURKY_WATER_ITEM_ID);
    // Asked right after the blessing message, so the blessing just given counts.
    if (value.includes("first time blessing water")) return blessings(player) <= 1;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!KING_ROALD_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Drezel blesses every bucket of murky water the player carries. */
  function blessWater(player) {
    const inventory = player.getInventory();
    const amount = inventory.getAmount(MURKY_WATER_ITEM_ID);
    if (amount <= 0) return;
    inventory.deleteNumber(MURKY_WATER_ITEM_ID, amount);
    inventory.adds(BLESSED_WATER_ITEM_ID, amount);
    player.setAttribute(BLESSINGS_ATTRIBUTE, blessings(player) + 1);
  }

  function blessings(player) {
    return Number(player.getAttribute(BLESSINGS_ATTRIBUTE)) || 0;
  }

  /** The transcript's blessing, hand-in and "Quest complete!" steps. */
  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    // The wiki guards the warning below combat 15 but the parsed message is
    // unconditional; drop it for everyone who meets the recommendation.
    if (kind === "message" && stepId === COMBAT_WARNING_STEP_ID) {
      if (player.getSkillManager().getCombatLevel() >= RECOMMENDED_COMBAT_LEVEL) event.handled = true;
      return;
    }
    if (npcId !== DREZEL_NPC_ID) return;
    if (kind === "message" && stepId === BLESSING_MESSAGE_ID) {
      if (quest.getStage(player) === STAGE_CELL_UNLOCKED) blessWater(player);
      return;
    }
    if (kind === "message" && ESSENCE_MESSAGE_IDS.has(stepId)) {
      // Fire only on the message emission, not the generic action one.
      if (quest.getStage(player) === STAGE_REPAIRING_BARRIER) giveEssenceToDrezel(player);
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) === STAGE_REPAIRING_BARRIER && essenceHandedIn(player) >= ESSENCE_REQUIRED) {
      quest.complete(player);
    }
  }

  /** Fill Drezel's "[1-50] more" blank with the essence still owed. */
  function fillEssenceLine(event) {
    if (event.npcId !== DREZEL_NPC_ID || typeof event.text !== "string") return;
    if (!event.text.includes(ESSENCE_REMAINING_BLANK)) return;
    const remaining = Math.max(0, ESSENCE_REQUIRED - essenceHandedIn(event.player));
    event.text = event.text.replace(ESSENCE_REMAINING_BLANK, String(remaining));
  }

  /** Killing the temple guardian, once the monks asked for it, advances the quest. */
  function handleGuardianDeath({ killer, npcId }) {
    if (!killer || !TEMPLE_GUARDIAN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(killer) !== STAGE_STARTED || !agreedToKillDog(killer)) return;
    quest.setStage(killer, STAGE_GUARDIAN_KILLED);
    startTranscript(api, killer, DREZEL_NPC_ID, PAGE, "you-killed-a-dog");
  }

  /**
   * The hooded monk drops the golden key from the King's warning until the coffin is
   * sealed. The generated drop table lists it as a 1/1 tertiary without a quest
   * condition, which NpcDrops skips, so the quest drops it.
   */
  function handleHoodedMonkDeath({ killer, npcId, location }) {
    if (!killer || !HOODED_MONK_NPC_IDS.has(npcId) || !location) return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_TOLD_KING_ROALD || stage >= STAGE_VAMPYRE_SEALED) return;
    api.getItemOnGroundManager().registerLocation(killer, new Item(GOLDEN_KEY_ITEM_ID, 1),
      new Location(location.x, location.y, location.z));
  }

  /**
   * The trapdoors north of the temple and inside the church drop into the
   * mausoleum (the ladder at 3405,9907 is right below the north one). The
   * generic Ladders fallback cannot pair a trapdoor's "Open" with the ladder,
   * so climb down explicitly.
   */
  function handleTrapdoorOpen(event) {
    const { player, objectId, location } = event;
    if (objectId === NORTH_TRAPDOOR_ID && sameTile(location, NORTH_TRAPDOOR_LOCATION)) {
      api.emitCustomEvent("ladders:climbDown", { player, destination: NORTH_TRAPDOOR_LANDING.clone() });
      event.handled = true;
      return true;
    }
    if (objectId === CHURCH_TRAPDOOR_ID && sameTile(location, CHURCH_TRAPDOOR_LOCATION)) {
      api.emitCustomEvent("ladders:climbDown", { player, destination: CHURCH_TRAPDOOR_LANDING.clone() });
      event.handled = true;
      return true;
    }
    return false;
  }

  /**
   * Doors lists "Trapdoor" among its toggles and its Open hook registers before
   * this quest's, so claim the two mausoleum trapdoors through "door:toggle",
   * which runs before any generic door handling.
   */
  function claimTrapdoorToggle(request) {
    if (request.handled) return;
    handleTrapdoorOpen(request);
  }

  /**
   * The mausoleum ladder (17385) is listed at many other places, and Monk's
   * Friend claims every 17385 for its cave; claim this one through the Ladders
   * "ladders:climb" extension point, which runs before the generic hooks.
   */
  function claimMausoleumClimb(request) {
    if (request.objectId !== MAUSOLEUM_LADDER_ID) return;
    const location = request.object?.getLocation?.();
    if (!location || location.getX() !== MAUSOLEUM_LADDER_LOCATION.x || location.getY() !== MAUSOLEUM_LADDER_LOCATION.y) {
      return;
    }
    api.emitCustomEvent("ladders:climbUp", {
      player: request.player,
      destination: MAUSOLEUM_LADDER_LANDING.clone(),
    });
    request.handled = true;
  }

  function handleHolyBarrier({ player, objectId }) {
    if (objectId !== ObjectIdentifiers.HOLY_BARRIER) return false;
    if (!quest.isComplete(player)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_MEET_IN_MAUSOLEUM) {
        playPage(player, "after-drezel-is-freed-and-the-vampyre-is-sealed-attempting-to-pass-the-holy-barrier-before-securing-the-barrier");
      } else {
        player.sendMessage("You need to complete Priest in Peril before passing through this barrier.");
      }
      return true;
    }
    player.moveTo(HOLY_BARRIER_LANDING.clone());
    player.sendMessage("You pass through the holy barrier.");
    return true;
  }

  /**
   * Knocking the large door: the Mysterious Voice asks about the dog before the
   * kill and thanks the player after it. Once the King has been told, the door
   * just opens (the doors plugin's normal toggle). Before the quest nobody
   * answers and the door stays shut.
   */
  function handleLargeDoor(request) {
    if (!LARGE_DOOR_IDS.has(request.objectId)) return;
    const { player } = request;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "pre-quest-at-the-temple-before-starting-the-quest");
      request.handled = true;
      return;
    }
    if (stage >= STAGE_TOLD_KING_ROALD) return;
    const variant = stage >= STAGE_GUARDIAN_KILLED
      ? "you-killed-a-dog-letting-the-monks-know-you-did-the-deed"
      : agreedToKillDog(player)
        ? "at-the-temple-knocking-on-the-door-after-accepting-to-kill-the-dog"
        : "at-the-temple";
    if (startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, variant)) {
      if (!agreedToKillDog(player)) {
        player.setAttribute(DOOR_ANSWERED_ATTRIBUTE, true);
        // Agreeing to kill the dog is varp 302 value 2: it shows the guardian.
        quest.setStage(player, stage);
      }
      request.handled = true;
    }
  }

  function crossCellGate(player) {
    const inside = player.getLocation().getX() >= CELL_INSIDE.getX();
    player.moveTo((inside ? CELL_OUTSIDE : CELL_INSIDE).clone());
  }

  function unlockCellGate(player) {
    quest.setStage(player, STAGE_CELL_UNLOCKED);
    crossCellGate(player);
    playPage(player, UNLOCK_VARIANT);
  }

  /** The cell gate: locked until the iron key opens it, then a plain gate. */
  function openCellGate(event) {
    const { player, objectId, location } = event;
    if (objectId !== CELL_GATE_ID || !sameTile(location, CELL_GATE_LOCATION)) return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_CELL_UNLOCKED) {
      crossCellGate(player);
    } else if (stage >= STAGE_MET_DREZEL && held(player, IRON_KEY_ITEM_ID)) {
      unlockCellGate(player);
    } else {
      playPage(player, "pre-quest-attempting-to-open-the-gate");
    }
    return true;
  }

  function useItemOnCellGate(player, itemId) {
    const stage = quest.getStage(player);
    if (itemId === IRON_KEY_ITEM_ID) {
      if (stage >= STAGE_CELL_UNLOCKED) crossCellGate(player);
      else if (stage >= STAGE_MET_DREZEL) unlockCellGate(player);
      else return false;
      return true;
    }
    if (itemId === GOLDEN_KEY_ITEM_ID && stage >= STAGE_MET_DREZEL && stage < STAGE_CELL_UNLOCKED) {
      playPage(player, "saving-drezel-and-the-world-using-the-golden-key-on-the-lock");
      return true;
    }
    return false;
  }

  function openCoffin(event) {
    const { player, objectId, location } = event;
    if (objectId !== COFFIN_ID || !sameTile(location, COFFIN_LOCATION)) return false;
    playPage(player, quest.getStage(player) >= STAGE_VAMPYRE_SEALED
      ? "talking-to-drezel-with-the-iron-key-attempting-to-open-the-coffin-again"
      : "saving-drezel-and-the-world-attempting-to-open-the-coffin-on-the-top-floor");
    return true;
  }

  function useItemOnCoffin(player, itemId) {
    const stage = quest.getStage(player);
    if (itemId === BLESSED_WATER_ITEM_ID) {
      if (stage !== STAGE_CELL_UNLOCKED) return false;
      player.getInventory().deleteNumber(BLESSED_WATER_ITEM_ID, 1);
      player.getInventory().adds(BUCKET_ITEM_ID, 1);
      quest.setStage(player, STAGE_VAMPYRE_SEALED);
      playPage(player, "talking-to-drezel-with-the-iron-key-pouring-blessed-water-on-the-coffin");
      return true;
    }
    if (stage >= STAGE_VAMPYRE_SEALED) return false;
    if (itemId === MURKY_WATER_ITEM_ID) {
      playPage(player, "talking-to-drezel-with-the-iron-key-attempting-to-pour-murky-water-on-the-coffin");
      return true;
    }
    if (itemId === BUCKET_OF_WATER_ITEM_ID) {
      playPage(player, "talking-to-drezel-with-the-iron-key-attempting-to-pour-normal-water-on-the-coffin");
      return true;
    }
    return false;
  }

  function inspectWell(event) {
    const { player, objectId, location } = event;
    if (objectId !== WELL_ID || !sameTile(location, WELL_LOCATION)) return false;
    if (quest.isComplete(player)) {
      // rsprox.net #365 and #4263 (post-quest): the Salve runs clean again.
      showStatement(player, "You look down the well and see the fresh water of the River Salve<br>moving swiftly along.");
    } else {
      playPage(player, "talking-to-drezel-with-the-iron-key-searching-the-well");
    }
    return true;
  }

  /** During the quest the well's water is the desecrated Salve: murky water. */
  function useItemOnWell(player, itemId) {
    if (itemId !== BUCKET_ITEM_ID || quest.isComplete(player)) return false;
    player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
    player.getInventory().adds(MURKY_WATER_ITEM_ID, 1);
    playPage(player, "talking-to-drezel-with-the-iron-key-filling-a-bucket-from-the-well");
    return true;
  }

  function monumentFor(objectId) {
    return MONUMENTS.find((monument) => monument.id === objectId) ?? null;
  }

  /** The monuments hold their items until the blessed water seals the coffin. */
  function monumentsGuarded(player) {
    return quest.getStage(player) < STAGE_VAMPYRE_SEALED;
  }

  function studyMonument(event) {
    const monument = monumentFor(event.objectId);
    if (!monument) return false;
    const { player } = event;
    showStatement(player, quest.isStarted(player) && monumentsGuarded(player)
      ? monument.study
      : "A monument dedicated to the fallen.");
    return true;
  }

  function takeFromMonument(event) {
    const monument = monumentFor(event.objectId);
    if (!monument) return false;
    const { player } = event;
    if (!quest.isStarted(player) || !monumentsGuarded(player)) {
      showStatement(player, "It would be wrong to dishonour this monument.");
      return true;
    }
    player.sendMessage(`You try to take the ${monument.name} from the monument but a holy power stops you!`);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
    return true;
  }

  function souvenirsTaken(player) {
    return Number(player.getAttribute(SOUVENIRS_ATTRIBUTE)) || 0;
  }

  function useItemOnMonument(player, objectId, itemId) {
    const monument = monumentFor(objectId);
    if (!monument || !quest.isStarted(player) || !monumentsGuarded(player)) return false;
    const inventory = player.getInventory();
    if (monument.key) {
      if (itemId === GOLDEN_KEY_ITEM_ID) {
        inventory.deleteNumber(GOLDEN_KEY_ITEM_ID, 1);
        inventory.adds(IRON_KEY_ITEM_ID, 1);
        showSwap(player, GOLDEN_KEY_ITEM_ID, IRON_KEY_ITEM_ID, "You swap your Golden key for the iron key.");
        return true;
      }
      if (itemId === IRON_KEY_ITEM_ID) {
        sayAsPlayer(player, "I think this key is more useful to me right now than the golden key is.");
        return true;
      }
      return false;
    }
    const bit = 1 << MONUMENTS.indexOf(monument);
    if (itemId === monument.golden) {
      sayAsPlayer(player, `You know... I think I'd rather keep the valuable solid gold ${monument.name}.`);
      return true;
    }
    if (!monument.items.includes(itemId)) return false;
    if (souvenirsTaken(player) & bit) {
      showStatement(player, `You have already taken the Golden ${monument.name}.`);
      return true;
    }
    inventory.deleteNumber(itemId, 1);
    inventory.adds(monument.golden, 1);
    player.setAttribute(SOUVENIRS_ATTRIBUTE, souvenirsTaken(player) | bit);
    showSwap(player, itemId, monument.golden, `You swap your ${monument.name} for the golden ${monument.name}.`);
    return true;
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId, location } = event;
    let handled = false;
    if (objectId === CELL_GATE_ID && sameTile(location, CELL_GATE_LOCATION)) handled = useItemOnCellGate(player, itemId);
    else if (objectId === COFFIN_ID && sameTile(location, COFFIN_LOCATION)) handled = useItemOnCoffin(player, itemId);
    else if (objectId === WELL_ID && sameTile(location, WELL_LOCATION)) handled = useItemOnWell(player, itemId);
    else handled = useItemOnMonument(player, objectId, itemId);
    if (handled) event.handled = true;
    return handled;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "priest_in_peril",
    name: "Priest in Peril",
    varpId: VARP_PRIEST_IN_PERIL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 1406, label: "Prayer" }],
    rewardItemId: ItemIdentifiers.WOLFBANE,
    rewardItemLabel: "Wolfbane dagger",
    otherRewards: ["Access to Morytania"],
    buildJournal,
    onReward: grantReward,
    varpValue: wireValue,
  });

  api.persistAttribute(DOOR_ANSWERED_ATTRIBUTE, false);
  api.persistAttribute(ESSENCE_HANDED_ATTRIBUTE, 0);
  api.persistAttribute(BLESSINGS_ATTRIBUTE, 0);
  api.persistAttribute(SOUVENIRS_ATTRIBUTE, 0);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", fillEssenceLine);
  api.onCustomEvent("door:toggle", handleLargeDoor);
  api.onCustomEvent("door:toggle", claimTrapdoorToggle);
  api.onCustomEvent("ladders:climb", claimMausoleumClimb);
  api.onNpcDeath(handleGuardianDeath);
  api.onNpcDeath(handleHoodedMonkDeath);
  api.onNpcInteraction(talkToUnlockedDrezel);
  api.onObjectRoute(handleTrapdoorRoute);
  api.onObjectInteraction("Trapdoor", { Open: handleTrapdoorOpen });
  api.onObjectInteraction("Holy barrier", { "Pass-through": handleHolyBarrier });
  api.onObjectInteraction("Cell gate", { Open: openCellGate });
  api.onObjectInteraction("Coffin", { Open: openCoffin });
  api.onObjectInteraction("Well", { Inspect: inspectWell });
  api.onObjectInteraction("Monument", { Study: studyMonument, "Take-from": takeFromMonument });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onPlayerLogin(handleLogin);
};
