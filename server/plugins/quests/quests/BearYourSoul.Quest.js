/**
 * Bear Your Soul (miniquest).
 *
 * Quest Helper progression (helpers/quests/bearyoursoul):
 *   stage 0  find and read "The Journey of Souls" in the Arceuus Library
 *   stage 1  talk to Aretha at the Soul Altar
 *   stage 2  dig in the Arceuus church crypt, then have the Key Master repair it
 *   done     the Key Master returns a soul bearer
 *
 * Quest Helper keys this on QuestVarbits.QUEST_BEAR_YOUR_SOUL =
 * VarbitID.ARCEUUS_SOULBEARER_STORY. The cache resolves that to varbit 5078
 * ("arceuus_soulbearer_story", varp 695, bits 30-31), whose quest row 5 marks
 * the miniquest complete at 3 (script 4029 reads quest DB table 0 column 19).
 * Its loadSteps keys are 0, 1 and 2; the four values fit the 2-bit field.
 *
 * Speech is the generated "Aretha" and "Key Master" transcripts (Aretha
 * standard-dialogue, Key Master during-bear-your-soul). The generated data has
 * no page for the wiki's "after recovering the damaged soul bearer" section, so
 * the two lines that branch adds are played from the reviewed Wiki transcript
 * through the line hook; the rest of Aretha's conversation stays transcript-led.
 *
 * Approximation: OSRS pins the book to one random Arceuus Library shelf. The
 * server does not model that rotation, so any shelf there finds it while the
 * book is still unread. Digging is likewise scoped to the crypt area rather than
 * a single tile, matching the Wiki's "dig anywhere".
 */
module.exports = function registerBearYourSoulQuest(api) {
  const {
    Animation, DialogueChainBuilder, EndDialogue, ItemIdentifiers: Items, ItemStatementDialogue,
    NpcDialogue, NpcIdentifiers: Npcs, PlayerDialogue,
  } = api.core;
  const { openBook, registerQuest, startTranscript } = require("../QuestRuntime");

  const VARP_SOULBEARER_STORY = 695;
  const VARBIT_SOULBEARER_STORY = 5078;
  const STAGE_NOT_STARTED = 0;
  const STAGE_BOOK_READ = 1;
  const STAGE_STARTED = 2;
  const STAGE_COMPLETE = 3;

  const ARETHA = Npcs.ARETHA; // 7042
  const KEY_MASTER = Npcs.KEY_MASTER; // 12599
  const SOUL_JOURNEY = Items.SOUL_JOURNEY; // 19637
  const DAMAGED_SOUL_BEARER = Items.DAMAGED_SOUL_BEARER; // 19636
  const SOUL_BEARER = Items.SOUL_BEARER; // 19634
  const SPADE = Items.SPADE; // 952
  const SEARCH_ANIMATION = new Animation(832); // human_pickuptable
  const READ_ANIMATION = new Animation(1350); // human_readbook
  const DIG_ANIMATION = new Animation(830); // human_dig
  const DIG_SOUND = 1470;
  const REPAIR_SOUND = 1595;

  const KEY_MASTER_PAGE = "Key Master";
  const KEY_MASTER_REPAIR_VARIANT = "during-bear-your-soul";
  const MESSAGE_REPAIR = "VKnY1K";

  const BOOK_PAGES = require("../data/bear-your-soul-book.json");
  const BOOK_TITLE = "The Journey of Souls";

  // Arceuus Library (the shelves Depths of Despair also searches).
  const LIBRARY_ZONE = { minX: 1600, maxX: 1665, minY: 3780, maxY: 3835, levels: [0, 1, 2] };
  // The open centre of the Arceuus church; Quest Helper digs at (1699, 3794, 0).
  const CRYPT_ZONE = { minX: 1690, maxX: 1708, minY: 3784, maxY: 3804, levels: [0] };

  const BOOK_FOUND_MESSAGE = "You find:<br><col=00007f>The Journey of Souls, by Aretha.</col><br>You take a copy.";
  const BOOK_READ_MESSAGE = "The book referred to an artefact being buried in Kourend, but the author did not specify where it was buried. Maybe you could persuade her to change her mind.";
  const BEARER_FOUND_MESSAGE = "You have found the soul bearer.";
  const BEARER_ALREADY_FOUND_MESSAGE = "You have already found the soul bearer.";
  const AREATHA_REPAIRED_LINE = "I got it repaired by the Key Master";
  const AREATHA_REMINDER_LINE = "Use it carefully, traveller";

  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const owns = (player, itemId) => has(player, itemId) || banked(player, itemId);
  const ownsDamagedBearer = (player) => owns(player, DAMAGED_SOUL_BEARER);
  const ownsSoulBearer = (player) => owns(player, SOUL_BEARER);
  const stageOf = (player) => quest.getStage(player);

  /** Runs one tick later when the task runtime exists, otherwise immediately. */
  function later(player, ticks, action) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      action();
    }));
  }

  function showItemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text))
    );
  }

  function inZone(zone, location) {
    if (!location) return false;
    if (!zone.levels.includes(location.z ?? location.getZ?.())) return false;
    return location.x >= zone.minX && location.x <= zone.maxX
      && location.y >= zone.minY && location.y <= zone.maxY;
  }

  // ==========================================================================
  // The book
  // ==========================================================================

  /** Any Arceuus Library shelf hands over the unread book (see the module note). */
  function searchBookshelf(event) {
    const { player, location } = event;
    if (event.handled) return false;
    if (!inZone(LIBRARY_ZONE, location ?? player.getLocation?.())) return false;
    if (stageOf(player) !== STAGE_NOT_STARTED) return false;
    if (owns(player, SOUL_JOURNEY)) return false;
    player.performAnimation?.(SEARCH_ANIMATION);
    if (inventory(player).isFull()) {
      inventory(player).full();
      event.handled = true;
      return true;
    }
    inventory(player).adds(SOUL_JOURNEY, 1);
    later(player, 1, () => showItemBox(player, SOUL_JOURNEY, BOOK_FOUND_MESSAGE));
    event.handled = true;
    return true;
  }

  function readBook(event) {
    if (event.itemId !== SOUL_JOURNEY) return false;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return false;
    const { player } = event;
    if (!has(player, SOUL_JOURNEY)) return false;
    player.performAnimation?.(READ_ANIMATION);
    openBook(player, BOOK_TITLE, BOOK_PAGES, () => finishReadingBook(player));
    event.handled = true;
    return true;
  }

  /** Live moves the stage and shows the hint only once the book is closed. */
  function finishReadingBook(player) {
    if (stageOf(player) !== STAGE_NOT_STARTED) return;
    quest.setStage(player, STAGE_BOOK_READ);
    showItemBox(player, SOUL_JOURNEY, BOOK_READ_MESSAGE);
  }

  // ==========================================================================
  // Aretha and the crypt
  // ==========================================================================

  function answerCondition({ npcId, player, text }) {
    if (npcId !== ARETHA) return null;
    const value = String(text ?? "").toLowerCase();
    if (value.includes("not yet found the soul bearer")) {
      // Still askable after the directions (stage 2) until the bearer is dug up.
      return stageOf(player) >= STAGE_BOOK_READ && !ownsDamagedBearer(player) && !quest.isComplete(player);
    }
    if (value.includes("started/completed the bear your soul miniquest")) {
      return ownsDamagedBearer(player) || quest.isComplete(player);
    }
    return null;
  }

  /**
   * The Wiki's post-recovery branch is missing from the generated transcript.
   * Replace the repaired-bearer exchange with the damaged-bearer words and add
   * the rest of that section after the first reply.
   */
  function handleDialogueLine(event) {
    if (event.npcId !== ARETHA) return;
    if (typeof event.text !== "string") return;
    const { player } = event;
    // Live moves 1 -> 2 after the Key Master line, just before this one.
    if (stageOf(player) === STAGE_BOOK_READ && event.text.includes("Now, we buried the artefact")) {
      event.before = () => {
        if (stageOf(player) === STAGE_BOOK_READ) quest.setStage(player, STAGE_STARTED);
      };
      return;
    }
    if (!ownsDamagedBearer(player)) return;
    if (event.text.includes(AREATHA_REPAIRED_LINE)) {
      event.text = "About the soul bearer again... I've dug it up, but it's damaged.";
      return;
    }
    if (event.text.includes(AREATHA_REMINDER_LINE)) {
      event.text = "This should be of no surprise to you, adventurer, if you paid attention to my book. Indeed, I even spoke of this matter when I first told you where the artefact was buried.";
      event.after = () => playDamagedBearerReminder(player);
    }
  }

  function playDamagedBearerReminder(player) {
    const chain = new DialogueChainBuilder();
    chain.add(new NpcDialogue(0, ARETHA, "Although the Elders of Arceuus never had the knowledge to repair it, I told you of one who may be able to help."));
    chain.add(new NpcDialogue(1, ARETHA, "I spoke of the Key Master, he who watches over the cave of the three-headed Guardian of the River. He has been there for countless years, and will have absorbed power from the River in that time."));
    chain.add(new PlayerDialogue(2, "Oh yes, I see."));
    chain.add(new EndDialogue(3));
    player.getDialogueManager().startDialogues(chain);
  }

  function digForBearer(event) {
    if (event.itemId !== SPADE) return false;
    if (String(event.option ?? "").toLowerCase() !== "dig") return false;
    const { player } = event;
    if (!inZone(CRYPT_ZONE, event.location ?? player.getLocation?.())) return false;
    if (stageOf(player) < STAGE_STARTED) return false;
    if (ownsDamagedBearer(player) || ownsSoulBearer(player)) {
      player.sendMessage(BEARER_ALREADY_FOUND_MESSAGE);
      event.handled = true;
      return true;
    }
    if (inventory(player).isFull()) {
      inventory(player).full();
      event.handled = true;
      return true;
    }
    player.performAnimation?.(DIG_ANIMATION);
    player.getPacketSender().sendSound(DIG_SOUND, 1, 0);
    inventory(player).adds(DAMAGED_SOUL_BEARER, 1);
    showItemBox(player, DAMAGED_SOUL_BEARER, BEARER_FOUND_MESSAGE);
    event.handled = true;
    return true;
  }

  // ==========================================================================
  // The Key Master
  // ==========================================================================

  function talkToKeyMaster(event) {
    const { player } = event;
    if (stageOf(player) < STAGE_STARTED || !has(player, DAMAGED_SOUL_BEARER)) return false;
    return startTranscript(api, player, KEY_MASTER, KEY_MASTER_PAGE, KEY_MASTER_REPAIR_VARIANT);
  }

  function handleDialogueAction(event) {
    if (event.npcId !== KEY_MASTER || event.stepId !== MESSAGE_REPAIR) return;
    const { player } = event;
    if (!has(player, DAMAGED_SOUL_BEARER)) {
      event.handled = true;
      event.end = true;
      return;
    }
    const before = inventory(player).getAmount(DAMAGED_SOUL_BEARER);
    inventory(player).deleteNumber(DAMAGED_SOUL_BEARER, 1);
    if (inventory(player).getAmount(DAMAGED_SOUL_BEARER) === before) {
      event.handled = true;
      event.end = true;
      return;
    }
    inventory(player).adds(SOUL_BEARER, 1);
    // Live sends only the repair sound and item box here; the completion
    // jingle, scroll and "Congratulations" line are not part of this miniquest.
    player.getPacketSender().sendSound(REPAIR_SOUND, 1, 0);
    event.box = { items: [SOUL_BEARER] };
    quest.complete(player, { scroll: false, announce: false });
  }

  // ==========================================================================
  // Journal and registration
  // ==========================================================================

  function buildJournal(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I read 'The Journey of Souls' and spoke to Aretha at the Soul Altar.</str>",
        "<str>I dug up the damaged soul bearer from the Arceuus church crypt.</str>",
        "<str>The Key Master repaired it into a soul bearer.</str>",
        "",
        "<col=ff0000>MINIQUEST COMPLETE!</col>",
      ];
    }
    if (ownsDamagedBearer(player)) {
      return [
        "I found the <col=800000>damaged soul bearer</col> in the crypt.",
        "I should take it to the <col=800000>Key Master</col> in Cerberus' Lair",
        "beneath Taverley for repair.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Aretha told me the soul bearer is buried in the crypt of the",
        "<col=800000>Arceuus church</col>. I should dig there with a spade.",
      ];
    }
    if (stage >= STAGE_BOOK_READ) {
      return [
        "I've read <col=800000>The Journey of Souls</col>.",
        "I should speak to <col=800000>Aretha</col> at the Soul Altar.",
      ];
    }
    return [
      "I can start this miniquest by reading the",
      "<col=800000>Journey of Souls</col> book, which can be found in the",
      "<col=800000>Arceuus Library</col>.",
    ];
  }

  quest = registerQuest(api, {
    key: "bear_your_soul",
    name: "Bear Your Soul",
    varpId: VARP_SOULBEARER_STORY,
    varbitId: VARBIT_SOULBEARER_STORY,
    startedValue: STAGE_BOOK_READ,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    scrollItemId: SOUL_BEARER,
    rewardItemLabel: "Soul bearer",
    buildJournal,
  });

  api.onObjectInteraction("Bookshelf", { Search: searchBookshelf });
  api.onItemAction("Soul Journey", { Read: readBook });
  api.onItemAction("Spade", { Dig: digForBearer });
  api.onNpcInteraction("Key Master", { "Talk-to": talkToKeyMaster });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
};
