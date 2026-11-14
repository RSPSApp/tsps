/**
 * Murder Mystery (members).
 *
 * The words come from the "Murder Mystery" transcript page. This plugin supplies
 * the guard / suspect / poison-salesman variant selector, the start hook, the
 * prose-condition answers, the physical evidence gathering (smashed window,
 * barrels, flour, flypaper), the flour / flypaper fingerprint recipes, the poison
 * salesman proof and the guard's completion action.
 *
 * Stages (varp 192): 0 not started, 1 started, 2 complete. Extra state is kept in
 * player attributes (murderer, poison proof, evidence flags) because the wiki's
 * 193/194/195 varps are not read by this runtime.
 *
 * The crime-scene criminal's dagger and pungent pot come from the static ground
 * spawns (ground-items.json). Gaps: the drain/gate investigate-prose is reduced
 * to the wiki's clue messages; the guard dog itself has no dialogue.
 */
module.exports = function registerMurderMysteryQuest(api) {
  const { Skill, Item, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  // npc-spawns.json spawns the mansion family and one guard under ids the
  // identifiers dump does not name; 4220-4225 are the same characters' older ids.
  const GUARD_MANSION_ID = 6194;
  const MANSION_ANNA_ID = 6195;
  const MANSION_BOB_ID = 6196;
  const MANSION_CAROL_ID = 6197;
  const MANSION_DAVID_ID = 6198;
  const MANSION_ELIZABETH_ID = 6199;
  const MANSION_FRANK_ID = 6200;

  const GUARD_IDS = new Set([NpcIdentifiers.GUARD_61, GUARD_MANSION_ID]);
  const ANNA_ID = NpcIdentifiers.ANNA_3;
  const BOB_ID = NpcIdentifiers.BOB_5;
  const CAROL_ID = NpcIdentifiers.CAROL;
  const DAVID_ID = NpcIdentifiers.DAVID_2;
  const DAVID_ALT_ID = NpcIdentifiers.DAVID;
  const ELIZABETH_ID = NpcIdentifiers.ELIZABETH;
  const FRANK_ID = NpcIdentifiers.FRANK;
  const GOSSIP_ID = NpcIdentifiers.GOSSIP;
  const POISON_SALESMAN_ID = NpcIdentifiers.POISON_SALESMAN;
  const DONOVAN_ID = NpcIdentifiers.DONOVAN_THE_FAMILY_HANDYMAN;
  const PIERRE_ID = NpcIdentifiers.PIERRE;
  const HOBBES_ID = NpcIdentifiers.HOBBES;
  const LOUISA_ID = NpcIdentifiers.LOUISA;
  const MARY_ID = NpcIdentifiers.MARY;
  const STANFORD_ID = NpcIdentifiers.STANFORD;

  /** The murder-room smashed window on the map is 26123, unnamed in the dump. */
  const SMASHED_WINDOW_STUDY_ID = 26123;
  const SMASHED_WINDOW_IDS = [
    ObjectIdentifiers.SMASHED_WINDOW,
    ObjectIdentifiers.SMASHED_WINDOW_2,
    ObjectIdentifiers.WINDOW_9,
    SMASHED_WINDOW_STUDY_ID,
  ];
  const FLOUR_BARREL_ID = ObjectIdentifiers.BARREL_OF_FLOUR_2;
  const FLYPAPER_SACKS_ID = ObjectIdentifiers.SACKS_6;
  const STURDY_GATE_IDS = [
    ObjectIdentifiers.STURDY_WOODEN_GATE,
    ObjectIdentifiers.STURDY_WOODEN_GATE_2,
  ];

  const VARP_MURDER_MYSTERY = 192;
  const VARP_MURDERER_SUSPECT = 195;
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 2;

  const POISON_SALESMAN_QUESTIONED = 1;
  const POISON_MURDERER_QUESTIONED = 2;
  const POISON_LOCATION_CHECKED = 3;
  const EVIDENCE_THREAD = 1 << 1;
  const EVIDENCE_FINGERPRINTS = 1 << 2;

  const EV_ATTR = "quest.murder_mystery.evidence";
  const POISON_ATTR = "quest.murder_mystery.poison";
  const MURDERER_ATTR = "quest.murder_mystery.murderer";

  const ITEM = ItemIdentifiers;
  const POT = ITEM.POT;

  /** The cache has two placements of every suspect barrel; both are named and searched. */
  const MURDERERS = [
    {
      id: 1, name: "Anna", npcId: ANNA_ID,
      original: ITEM.SILVER_NECKLACE, dusted: ITEM.SILVER_NECKLACE_2, print: ITEM.ANNAS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_2,
      barrelIds: [ObjectIdentifiers.ANNAS_BARREL, ObjectIdentifiers.ANNAS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_COMPOST_HEAP, poisonTarget: "compost heap",
      alibiEnd: "kill off some of the wildlife living in it.",
    },
    {
      id: 2, name: "Bob", npcId: BOB_ID,
      original: ITEM.SILVER_CUP, dusted: ITEM.SILVER_CUP_2, print: ITEM.BOBS_PRINT,
      thread: ITEM.CRIMINALS_THREAD,
      barrelIds: [ObjectIdentifiers.BOBS_BARREL, ObjectIdentifiers.BOBS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_BEEHIVE, poisonTarget: "beehive",
      alibiEnd: "I decided I would deal with it myself. So I did.",
    },
    {
      id: 3, name: "Carol", npcId: CAROL_ID,
      original: ITEM.SILVER_BOTTLE, dusted: ITEM.SILVER_BOTTLE_2, print: ITEM.CAROLS_PRINT,
      thread: ITEM.CRIMINALS_THREAD,
      barrelIds: [ObjectIdentifiers.CAROLS_BARREL, ObjectIdentifiers.CAROLS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SINCLAIR_MANSION_DRAIN, poisonTarget: "drain",
      alibiEnd: "I felt I had to do it myself.",
    },
    {
      id: 4, name: "David", npcId: DAVID_ID,
      original: ITEM.SILVER_BOOK, dusted: ITEM.SILVER_BOOK_2, print: ITEM.DAVIDS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_2,
      barrelIds: [ObjectIdentifiers.DAVIDS_BARREL, ObjectIdentifiers.DAVIDS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SPIDERS_NEST, poisonTarget: "spiders' nest",
      alibiEnd: "fire the whole workshy lot of them!",
    },
    {
      id: 5, name: "Elizabeth", npcId: ELIZABETH_ID,
      original: ITEM.SILVER_NEEDLE, dusted: ITEM.SILVER_NEEDLE_2, print: ITEM.ELIZABETHS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_3,
      barrelIds: [ObjectIdentifiers.ELIZABETHS_BARREL, ObjectIdentifiers.ELIZABETHS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_FOUNTAIN, poisonTarget: "fountain",
      alibiEnd: "Doesn't everyone?",
    },
    {
      id: 6, name: "Frank", npcId: FRANK_ID,
      original: ITEM.SILVER_POT, dusted: ITEM.SILVER_POT_2, print: ITEM.FRANKS_PRINT,
      thread: ITEM.CRIMINALS_THREAD_3,
      barrelIds: [ObjectIdentifiers.FRANKS_BARREL, ObjectIdentifiers.FRANKS_BARREL_2],
      poisonLocId: ObjectIdentifiers.SINCLAIR_FAMILY_CREST, poisonTarget: "family crest",
      alibiEnd: "It's cleaned up a bit now.",
    },
  ];

  /** Evidence confiscated from the inventory at completion. */
  const EVIDENCE_ITEM_IDS = [
    ITEM.CRIMINALS_DAGGER, ITEM.CRIMINALS_DAGGER_2,
    ITEM.CRIMINALS_THREAD, ITEM.CRIMINALS_THREAD_2, ITEM.CRIMINALS_THREAD_3,
    ITEM.UNKNOWN_PRINT, ITEM.KILLERS_PRINT, ITEM.ANNAS_PRINT, ITEM.BOBS_PRINT,
    ITEM.CAROLS_PRINT, ITEM.DAVIDS_PRINT, ITEM.ELIZABETHS_PRINT, ITEM.FRANKS_PRINT,
    ITEM.SILVER_NECKLACE, ITEM.SILVER_NECKLACE_2, ITEM.SILVER_CUP, ITEM.SILVER_CUP_2,
    ITEM.SILVER_BOTTLE, ITEM.SILVER_BOTTLE_2, ITEM.SILVER_BOOK, ITEM.SILVER_BOOK_2,
    ITEM.SILVER_NEEDLE, ITEM.SILVER_NEEDLE_2, ITEM.SILVER_POT, ITEM.SILVER_POT_2,
    ITEM.PUNGENT_POT, ITEM.FLYPAPER,
  ];

  /** The mansion family/guard spawn under these cache ids, which npc-dialogue-index lacks. */
  const MANSION_NPC_IDS = [
    GUARD_MANSION_ID, MANSION_ANNA_ID, MANSION_BOB_ID, MANSION_CAROL_ID,
    MANSION_DAVID_ID, MANSION_ELIZABETH_ID, MANSION_FRANK_ID,
  ];

  /** Murder Mystery page -> the variant name fragment for each speaker. */
  const SPEAKER_FRAGMENT = new Map([
    [ANNA_ID, "anna"], [BOB_ID, "bob"], [CAROL_ID, "carol"], [DAVID_ID, "david"],
    [DAVID_ALT_ID, "david"], [ELIZABETH_ID, "elizabeth"], [FRANK_ID, "frank"],
    [MANSION_ANNA_ID, "anna"], [MANSION_BOB_ID, "bob"], [MANSION_CAROL_ID, "carol"],
    [MANSION_DAVID_ID, "david"], [MANSION_ELIZABETH_ID, "elizabeth"], [MANSION_FRANK_ID, "frank"],
    [GOSSIP_ID, "gossip"], [DONOVAN_ID, "donovan"], [PIERRE_ID, "pierre"],
    [HOBBES_ID, "hobbes"], [LOUISA_ID, "louisa"], [MARY_ID, "mary"], [STANFORD_ID, "stanford"],
  ]);

  const FAMILY_IDS = new Set([
    ANNA_ID, CAROL_ID, ELIZABETH_ID, MARY_ID,
    MANSION_ANNA_ID, MANSION_CAROL_ID, MANSION_ELIZABETH_ID,
  ]);
  const MEN_IDS = new Set([
    BOB_ID, DAVID_ID, DAVID_ALT_ID, FRANK_ID,
    MANSION_BOB_ID, MANSION_DAVID_ID, MANSION_FRANK_ID,
  ]);
  const SERVANT_IDS = new Set([DONOVAN_ID, PIERRE_ID, HOBBES_ID, LOUISA_ID, MARY_ID, STANFORD_ID]);
  const SERVANTS_WITH_BEFORE = new Set([DONOVAN_ID, PIERRE_ID, HOBBES_ID, LOUISA_ID, STANFORD_ID]);

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAny = (player, itemIds) => itemIds.some((itemId) => has(player, itemId));
  const murderer = (player) => MURDERERS[(attr(player, MURDERER_ATTR) || 1) - 1] ?? MURDERERS[0];

  function setEvidence(player, flag) {
    setAttr(player, EV_ATTR, attr(player, EV_ATTR) | flag);
  }

  function sendMurdererVarp(player) {
    const id = attr(player, MURDERER_ATTR);
    player.getPacketSender().sendConfig(VARP_MURDERER_SUSPECT, id >= 1 && id <= MURDERERS.length ? id : 0);
  }

  /**
   * The physical evidence the all-evidence hand-in needs, not just the durable flags.
   * The wiki says the silver belonging, dagger and pot can be dropped once the prints
   * match, so only the thread and the killer's print are shown to the guard.
   */
  function handInEvidenceIds(player) {
    return [murderer(player).thread, ITEM.KILLERS_PRINT];
  }

  function hasHandInEvidence(player) {
    return handInEvidenceIds(player).every((itemId) => has(player, itemId));
  }

  function conclusiveEvidence(player) {
    const evidence = attr(player, EV_ATTR);
    return (evidence & EVIDENCE_THREAD) !== 0 &&
      (evidence & EVIDENCE_FINGERPRINTS) !== 0 &&
      attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I gathered three independent pieces of evidence.</str>",
        "<str>I identified Lord Sinclair's murderer.</str>",
        "<col=ff0000>Quest complete!</col>",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to a",
        "<col=800000>guard<col=000080> outside the Sinclair Mansion.",
      ];
    }
    const evidence = attr(player, EV_ATTR);
    return [
      "The guards asked me to investigate Lord Sinclair's murder.",
      (evidence & EVIDENCE_THREAD) !== 0
        ? "<str>I found coloured thread at the broken window.</str>"
        : "I should investigate the broken study window.",
      (evidence & EVIDENCE_FINGERPRINTS) !== 0
        ? "<str>I matched a family member's prints to the dagger.</str>"
        : "I should compare fingerprints from the dagger and silver belongings.",
      attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED
        ? "<str>I proved one family member lied about using poison.</str>"
        : "I should ask the poison salesman and inspect where each suspect used poison.",
      "When all three clues agree, I should report to the guard.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1406);
    const inventory = player.getInventory();
    for (const itemId of EVIDENCE_ITEM_IDS) {
      const amount = inventory.getAmount(itemId);
      if (amount > 0) inventory.deleteNumber(itemId, amount);
    }
    // registerQuest adds the rewardItemId coin; top the stack up to 2,000.
    // forceAdd merges into a coin stack or drops the overflow on a full bag.
    inventory.forceAdd(player, new Item(ITEM.COINS, 1999));
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GUARD_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-guard-after-the-quest";
      if (stage === STAGE_NOT_STARTED) return "getting-started-talking-to-guard";
      if (conclusiveEvidence(player) && hasHandInEvidence(player)) {
        return "presenting-the-evidence-talking-to-the-guard-with-all-evidence";
      }
      // Proof, not just progress: the salesman or a suspect's claim is not evidence.
      // Banked or dropped evidence also belongs here; the guard cannot take what is absent.
      if (conclusiveEvidence(player) || attr(player, EV_ATTR) !== 0 || attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED) {
        return "presenting-the-evidence-talking-to-the-guard-with-some-but-not-all-evidence";
      }
      return "getting-started-talking-to-the-guard-after-starting-the-quest";
    }
    if (npcId === POISON_SALESMAN_ID) {
      if (stage === STAGE_STARTED) return "visiting-the-poison-salesman-talking-to-the-poison-salesman";
      if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-poison-salesman-after-the-quest";
      return null;
    }
    const fragment = SPEAKER_FRAGMENT.get(npcId);
    if (!fragment) return null;
    if (stage === STAGE_STARTED) {
      // Once the salesman has named the buyers everyone gets the "why the poison"
      // menu; only the family have that exact question (Gossip has neither variant).
      if (npcId !== GOSSIP_ID && attr(player, POISON_ATTR) >= POISON_SALESMAN_QUESTIONED) {
        return `visiting-the-poison-salesman-talking-to-${fragment}-after-learning-about-the-poison`;
      }
      return `questioning-the-inhabitants-talking-to-${fragment}`;
    }
    if (stage >= STAGE_COMPLETE) {
      if (npcId === GOSSIP_ID) return "post-quest-talking-to-gossip-after-the-quest";
      if (npcId === PIERRE_ID) return null; // no post-quest transcript variant
      return `post-quest-talking-to-${fragment}-after-the-quest`;
    }
    // Not started: only some NPCs have a "before starting" snub variant.
    if (SERVANTS_WITH_BEFORE.has(npcId)) return `before-starting-talking-to-${fragment}`;
    if (FAMILY_IDS.has(npcId)) return "before-starting-talking-to-anna-carol-mary-or-elizabeth";
    if (MEN_IDS.has(npcId)) return "before-starting-talking-to-frank-david-or-bob";
    return null;
  }

  /**
   * The mansion family and the inside guard are spawned as cache ids 6194-6200,
   * which npc-dialogue-index.json does not list. Their cache names are empty, so
   * the generic name fallback cannot reach the "Murder Mystery" page either.
   * Play the same transcript variant explicitly for those spawned ids.
   */
  function handleMansionTalk(event) {
    const { player, npcId } = event;
    if (!MANSION_NPC_IDS.includes(npcId)) return false;
    const variant = selectVariant({ npcId, player });
    if (!variant) return false;
    if (startTranscript(api, player, npcId, "Murder Mystery", variant, null, event.npc) === false) {
      return false;
    }
    event.handled = true;
    return true;
  }

  function answerCondition({ player, npcId, text }) {
    if (!GUARD_IDS.has(npcId) && !SPEAKER_FRAGMENT.has(npcId) && npcId !== POISON_SALESMAN_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("criminal's thread is red")) return murderer(player).thread === ITEM.CRIMINALS_THREAD;
    if (value.includes("thread isn't red")) return murderer(player).thread !== ITEM.CRIMINALS_THREAD;
    if (value.includes("full inventory")) return player.getInventory().isFull?.() === true;
    // The guard's evidence menu: each option is only shown when that clue is held.
    if (value.startsWith("if the player has the thread evidence")) {
      return (attr(player, EV_ATTR) & EVIDENCE_THREAD) !== 0;
    }
    if (value.startsWith("if the player has poison evidence")) {
      return attr(player, POISON_ATTR) >= POISON_LOCATION_CHECKED;
    }
    if (value.startsWith("if the player has fingerprint evidence")) {
      return (attr(player, EV_ATTR) & EVIDENCE_FINGERPRINTS) !== 0;
    }
    // The guard's per-suspect tellings; without this the first unanswered one wins.
    const who = /^if (anna|bob|carol|david|elizabeth|frank) is the murderer/.exec(value);
    if (who) return murderer(player).name.toLowerCase() === who[1];
    return null;
  }

  /** Deterministic per-account culprit (the wiki picks one at random per player). */
  function pickMurderer(player) {
    const name = String(player.getUsername?.() ?? "").toLowerCase();
    let hash = 0;
    for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) | 0;
    return (Math.abs(hash) % MURDERERS.length) + 1;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GUARD_IDS.has(npcId) || hook !== "quest:murder-mystery:start") return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    setAttr(player, MURDERER_ATTR, pickMurderer(player));
    setAttr(player, POISON_ATTR, 0);
    setAttr(player, EV_ATTR, 0);
    quest.setStage(player, STAGE_STARTED);
    sendMurdererVarp(player);
  }

  function handleAction({ player, npcId, stepId }) {
    if (!GUARD_IDS.has(npcId) || stepId !== "uvOs6C") return;
    if (quest.isComplete(player)) return;
    if (!hasHandInEvidence(player)) {
      player.sendMessage("You need to bring all the evidence to the guard before handing it over.");
      return;
    }
    setAttr(player, MURDERER_ATTR, 0);
    setAttr(player, POISON_ATTR, 0);
    setAttr(player, EV_ATTR, 0);
    sendMurdererVarp(player);
    quest.complete(player);
  }

  function investigationBlocked(player) {
    if (quest.getStage(player) !== STAGE_STARTED) {
      player.sendMessage("You need the guard's permission to investigate.");
      return true;
    }
    return false;
  }

  /** Coloured thread is caught on the smashed study window. */
  function handleWindow(event) {
    if (!SMASHED_WINDOW_IDS.includes(event.objectId)) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (option === "break") {
      player.sendMessage("You don't want to damage evidence!");
      event.handled = true;
      return;
    }
    const thread = murderer(player).thread;
    if (!has(player, thread)) {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory slot.");
        event.handled = true;
        return;
      }
      player.getInventory().adds(thread, 1);
    }
    setEvidence(player, EVIDENCE_THREAD);
    player.sendMessage("You take coloured thread caught on a nail in the smashed window.");
    event.handled = true;
  }

  /** Each suspect's barrel hides a silver belonging. */
  function handleBarrel(event) {
    const suspect = MURDERERS.find((entry) => entry.barrelIds.includes(event.objectId));
    if (!suspect) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (has(player, suspect.original) || has(player, suspect.dusted) || has(player, suspect.print)) {
      player.sendMessage(`You already took ${suspect.name}'s silver belonging.`);
      event.handled = true;
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(suspect.original, 1);
    player.sendMessage(`You find ${suspect.name}'s silver belonging in the barrel.`);
    event.handled = true;
  }

  /**
   * The kitchen's barrel of flour (26122) fills one empty pot per use, by Take-from or by using
   * the pot on it, before, during and after the quest (Wiki "Barrel of flour (Sinclair
   * Mansion)": an infinite source of flour after the quest). Lines and timing from rsprox
   * captures (local recs 1001551 rev 241, 1001930/1001958 rev 242: pot used on the barrel, the
   * two lines and the pot of flour in the pot's slot one tick after arriving, no animation or
   * sound) and the quest transcript's barrel pages: Take-from opens with "A barrel full of finely
   * sifted flour." and has the no-pot line. The crime-scene pots get the Wiki's evidence line.
   * Ours: the stage is not checked (the captures are mid-quest; the Wiki does not gate it).
   */
  const FLOUR_EVIDENCE_POTS = new Set([ITEM.SILVER_POT, ITEM.SILVER_POT_2, ITEM.PUNGENT_POT]);

  function fillPotWithFlour(player, slot) {
    const inventory = player.getInventory();
    const potSlot = slot >= 0 && inventory.getSlot(slot) === POT ? slot : inventory.getSlotForItemId(POT);
    if (potSlot < 0) {
      player.sendMessage("You need something to put the flour in.");
      return;
    }
    inventory.setItem(potSlot, new Item(ITEM.POT_OF_FLOUR, 1)).refreshItems();
    player.sendMessage("You take some flour from the barrel.");
    player.sendMessage("There's still plenty of flour left.");
  }

  function handleFlourBarrel(event) {
    if (event.objectId !== FLOUR_BARREL_ID) return;
    event.player.sendMessage("A barrel full of finely sifted flour.");
    fillPotWithFlour(event.player, -1);
    event.handled = true;
  }

  function handleItemOnFlourBarrel(event) {
    if (event.objectId !== FLOUR_BARREL_ID) return;
    if (FLOUR_EVIDENCE_POTS.has(event.itemId)) {
      event.player.sendMessage("You probably shouldn't use evidence from a crime scene to keep flour in...");
    } else if (event.itemId === POT) {
      fillPotWithFlour(event.player, event.itemSlot);
    } else {
      return;
    }
    event.handled = true;
  }

  function handleFlypaperSacks(event) {
    if (event.objectId !== FLYPAPER_SACKS_ID) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(ITEM.FLYPAPER, 1);
    player.sendMessage("You take a piece of sticky flypaper.");
    event.handled = true;
  }

  /** The sturdy wooden gate is the guard-dog clue: no intruder could pass the dog. */
  function handleSturdyGate(event) {
    if (!STURDY_GATE_IDS.includes(event.objectId)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STARTED) {
      player.sendMessage("I need the guards' permission to do that.");
      event.handled = true;
      return;
    }
    player.sendMessage(
      "As you approach the gate the guard dog starts barking loudly at you. There is no way an intruder could have committed the murder. It must have been someone the dog knew to get past it quietly."
    );
    event.handled = true;
  }

  /** Flour + silver -> empty pot + dusted item; flypaper + dusted -> original + print.
   * The crime-scene dagger follows the same recipe and yields the unknown print. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    if (ids.includes(ITEM.POT_OF_FLOUR) && ids.includes(ITEM.CRIMINALS_DAGGER)) {
      player.getInventory().deleteNumber(ITEM.POT_OF_FLOUR, 1);
      player.getInventory().deleteNumber(ITEM.CRIMINALS_DAGGER, 1);
      player.getInventory().adds(POT, 1);
      player.getInventory().adds(ITEM.CRIMINALS_DAGGER_2, 1);
      player.sendMessage("You sprinkle a small amount of flour on the murder weapon.");
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.FLYPAPER) && ids.includes(ITEM.CRIMINALS_DAGGER_2)) {
      player.getInventory().deleteNumber(ITEM.FLYPAPER, 1);
      player.getInventory().deleteNumber(ITEM.CRIMINALS_DAGGER_2, 1);
      player.getInventory().adds(ITEM.CRIMINALS_DAGGER, 1);
      player.getInventory().adds(ITEM.UNKNOWN_PRINT, 1);
      player.sendMessage("You have a clean impression of the murderer's finger prints.");
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.POT_OF_FLOUR)) {
      const proof = MURDERERS.find((entry) => ids.includes(entry.original));
      if (!proof) return;
      player.getInventory().deleteNumber(ITEM.POT_OF_FLOUR, 1);
      player.getInventory().deleteNumber(proof.original, 1);
      player.getInventory().adds(POT, 1);
      player.getInventory().adds(proof.dusted, 1);
      player.sendMessage(`You coat ${proof.name}'s silver with a thin layer of flour.`);
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.FLYPAPER)) {
      const proof = MURDERERS.find((entry) => ids.includes(entry.dusted));
      if (!proof) return;
      player.getInventory().deleteNumber(ITEM.FLYPAPER, 1);
      player.getInventory().deleteNumber(proof.dusted, 1);
      player.getInventory().adds(proof.original, 1);
      player.getInventory().adds(proof.print, 1);
      player.sendMessage(`You lift a clean fingerprint from ${proof.name}'s silver.`);
      event.handled = true;
      return;
    }
    if (ids.includes(ITEM.UNKNOWN_PRINT)) {
      const suspect = MURDERERS.find((entry) => ids.includes(entry.print));
      if (!suspect) return;
      if (attr(player, MURDERER_ATTR) !== suspect.id) {
        player.getInventory().deleteNumber(suspect.print, 1);
        player.sendMessage(`The prints do not match. This clears ${suspect.name}.`);
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(ITEM.UNKNOWN_PRINT, 1);
      player.getInventory().deleteNumber(suspect.print, 1);
      player.getInventory().adds(ITEM.KILLERS_PRINT, 1);
      setEvidence(player, EVIDENCE_FINGERPRINTS);
      player.sendMessage(`${suspect.name}'s fingerprints exactly match those on the murder weapon.`);
      event.handled = true;
    }
  }

  /** Record the alibi only after the actual culprit has finished explaining it. */
  function handlePoisonLine({ player, npcId, text }) {
    if (quest.getStage(player) !== STAGE_STARTED || typeof text !== "string") return;
    if (npcId === POISON_SALESMAN_ID && text.includes("all bought a bottle! In fact they bought the last of my supplies!")) {
      if (attr(player, POISON_ATTR) < POISON_SALESMAN_QUESTIONED) setAttr(player, POISON_ATTR, POISON_SALESMAN_QUESTIONED);
      return;
    }
    const suspect = murderer(player);
    if (SPEAKER_FRAGMENT.get(npcId) !== suspect.name.toLowerCase()
      || attr(player, POISON_ATTR) !== POISON_SALESMAN_QUESTIONED) return;
    if (text.endsWith(suspect.alibiEnd)) setAttr(player, POISON_ATTR, POISON_MURDERER_QUESTIONED);
  }

  function handlePoisonSalesmanTalk(event) {
    if (event.npcId !== POISON_SALESMAN_ID || quest.getStage(event.player) !== STAGE_STARTED) return false;
    if (!startTranscript(api, event.player, event.npcId, "Murder Mystery", selectVariant(event))) return false;
    event.handled = true;
    return true;
  }

  function handlePoisonLocation(event) {
    const suspect = MURDERERS.find((entry) => entry.poisonLocId === event.objectId);
    if (!suspect) return;
    const { player } = event;
    if (investigationBlocked(player)) return;
    if (attr(player, POISON_ATTR) < POISON_MURDERER_QUESTIONED) {
      player.sendMessage(`It is the Sinclair ${suspect.poisonTarget}.`);
      event.handled = true;
      return;
    }
    if (attr(player, MURDERER_ATTR) === suspect.id) {
      setAttr(player, POISON_ATTR, POISON_LOCATION_CHECKED);
      player.sendMessage(`The ${suspect.poisonTarget} is untouched. ${suspect.name} lied about using poison here.`);
    } else {
      player.sendMessage(`The ${suspect.poisonTarget} shows clear traces of recently used poison.`);
    }
    event.handled = true;
  }

  function handleBootstrap({ player }) {
    sendMurdererVarp(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendMurdererVarp(player);
  }

  quest = registerQuest(api, {
    key: "murder_mystery",
    name: "Murder Mystery",
    varpId: VARP_MURDER_MYSTERY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1406, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.COINS,
    rewardItemLabel: "2,000 coins",
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(EV_ATTR);
  api.persistAttribute(POISON_ATTR);
  api.persistAttribute(MURDERER_ATTR);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcFirstClick(MANSION_NPC_IDS, handleMansionTalk);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handlePoisonLine);
  api.onNpcInteraction("Poison Salesman", { "Talk-to": handlePoisonSalesmanTalk });
  api.onObjectInteraction(handleWindow);
  api.onObjectInteraction(handleBarrel);
  api.onObjectInteraction(handleFlourBarrel);
  api.onItemOnObject(handleItemOnFlourBarrel, { noted: false });
  api.onObjectInteraction(handleFlypaperSacks);
  api.onObjectInteraction(handleSturdyGate);
  api.onObjectInteraction(handlePoisonLocation);
  api.onItemOnItem(handleItemOnItem);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
