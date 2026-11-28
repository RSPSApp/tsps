/**
 * Creature of Fenkenstrain inside the castle: Dr Fenkenstrain's talks and hand-ins, the creature,
 * Rologarth, the pickpocket that ends the quest and recovers a lost ring, the bookcases and amulets,
 * the clock, the lightning conductor, the tower door and the signpost. Words are the quest's
 * transcript page; the facts with capture ticks are in docs/quests/creature-of-fenkenstrain.
 */
module.exports = function registerCastle(api, { state, common, quest }) {
  const { STAGE, FIELD } = state;
  const { PAGE, NPC, CASTLE_NPCS, ITEM, LOC, SEQ, SOUND, held, heldAny, ownsRing, baseId, box, later } = common;
  const { Skill, Animation, GameObject, Location } = api.core;
  const { startTranscript, openBook, openLongScroll, bookPagesFromSpreads } = require("../QuestRuntime");

  const GARDENER_PAGE = "Gardener Ghost";
  const ROLOGARTH_PAGE = "Lord Rologarth";
  const OUR_PAGES = new Set([PAGE, GARDENER_PAGE, ROLOGARTH_PAGE]);

  /** Speaker labels the transcripts give each castle NPC, and the name live shows on its lines. */
  const SPEAKERS = new Map([
    [NPC.FENKENSTRAIN, { labels: ["Dr Fenkenstrain"], name: "Dr Fenkenstrain" }],
    [NPC.FENKENSTRAIN_IN_TOWER, { labels: ["Dr Fenkenstrain"], name: "Dr Fenkenstrain" }],
    [NPC.CREATURE, { labels: ["Fenkenstrain's Monster"], name: "Fenkenstrain's Monster" }],
    [NPC.ROLOGARTH, { labels: ["Rologarth", "Lord Rologarth"], name: "Lord Rologarth" }],
    [NPC.GARDENER, { labels: ["Gardener Ghost"], name: "Gardener Ghost" }],
  ]);

  const PART_ITEMS = [ITEM.HEAD_WITH_BRAIN, ITEM.TORSO, ITEM.ARMS, ITEM.LEGS];
  const PART_FIELDS = [FIELD.ARMS, FIELD.LEGS, FIELD.TORSO, FIELD.HEAD];
  const THIEVING_LEVEL = 25;
  const STEAL_MESSAGE = "You steal the Ring of Charos from Fenkenstrain.";

  /** The two first-floor bookcases with a compartment (the ground floor's are ScenerySearch's). */
  const WEST_BOOKCASE = [3542, 3558, 1];
  const EAST_BOOKCASE = [3555, 3558, 1];
  /** The book on the north-east bookcase that opens as a book (capture tick 459), and its two pages. */
  const SWEEPING_BOOK = "Chimney Sweeping on a Budget";
  const SWEEPING_PAGES = [[
    ["Page 26", "that sometimes a sweep may", "find themselves brushless and", "without the funds to purchase",
      "the one tool that is most", "essential to their trade. What", "is a chimney sweep without",
      "his or her brush?", "In this kind of situation any", "normal long-handled brush", "might be a suitable",
      "replacement, although when", "attaching extensions to the", "handle make sure to use", "something sturdy like wire,"],
    ["otherwise a sweep may find", "themselves losing their brush", "and livelyhood to the forces", "of gravity"],
  ]];

  /** The conductor on the roof (3548,3536,2): repaired for as long as its box is up (ticks 1820-1824). */
  const CONDUCTOR_TILE = [3548, 3536, 2];

  /** player -> what started the conversation the bookcase/clock conditions ask about. */
  const pending = new WeakMap();
  /** player -> the needle or thread handed over in the talk now running (the "speaks to him again" lines are for a later talk). */
  const givenThisTalk = new WeakMap();

  const stageOf = (player) => state.stage(player);
  const isCastleNpc = (entity) => CASTLE_NPCS.has(baseId(entity));
  const ourTalk = (event) => isCastleNpc(event.npc)
    || (event.pages ?? []).some((page) => OUR_PAGES.has(page.page))
    || pending.has(event.player);

  // ------------------------------------------------------------------------------------------
  // Which talk each person plays
  // ------------------------------------------------------------------------------------------

  function fenkenstrainVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE.NOT_STARTED) return "dr-fenkenstrain-talking-to-dr-fenkenstrain";
    if (stage === STAGE.PARTS) {
      return heldAny(player, PART_ITEMS)
        ? "talking-to-dr-fenkenstrain-with-the-body-parts"
        : "dr-fenkenstrain-talking-to-dr-fenkenstrain-talking-to-dr-fenkenstrain-again";
    }
    if (stage === STAGE.NEEDLE_AND_THREAD) return "talking-to-dr-fenkenstrain-with-the-body-parts-talking-to-dr-fenkenstrain-again";
    if (stage === STAGE.CONDUCTOR) {
      return held(player, ITEM.CONDUCTOR)
        ? "getting-the-conductor-talking-to-dr-fenkenstrain-with-the-conductor"
        : "talking-to-dr-fenkenstrain-with-the-body-parts-talking-to-dr-fenkenstrain-again-after-sewing-the-body-parts-together";
    }
    if (stage === STAGE.CONDUCTOR_REPAIRED) return "talking-to-dr-fenkenstrain-after-using-the-conductor";
    if (stage === STAGE.CREATURE_LOOSE) {
      // Ours: no source says how a lost tower key comes back; his first talk, which hands it over, plays again.
      const lostKey = !held(player, ITEM.TOWER_KEY) && !state.get(player, FIELD.UNLOCKED_TOWER);
      return lostKey ? "talking-to-dr-fenkenstrain-after-using-the-conductor" : "talking-to-dr-fenkenstrain-after-using-the-conductor-talking-to-dr-fenkenstrain-again";
    }
    if (stage === STAGE.CREATURE_CONVINCED) return "convincing-dr-fenkenstrain-to-stop-his-experiments";
    return null;
  }

  function gardenerVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE.NOT_STARTED) return { page: GARDENER_PAGE, variant: "before-creature-of-fenkenstrain" };
    if (stage <= STAGE.NEEDLE_AND_THREAD) return { page: PAGE, variant: "decapitated-head-talking-to-the-gardener-ghost" };
    if (stage === STAGE.CONDUCTOR) return { page: PAGE, variant: "getting-help-from-the-gardener-ghost" };
    if (stage < STAGE.COMPLETE) return { page: PAGE, variant: "talking-to-the-gardener-ghost-after-using-the-conductor" };
    return { page: GARDENER_PAGE, variant: "after-creature-of-fenkenstrain" };
  }

  function selectVariant(event) {
    const { player } = event;
    const id = baseId(event.npc);
    if (!CASTLE_NPCS.has(id)) return null;
    givenThisTalk.delete(player);
    pending.delete(player);
    const stage = stageOf(player);
    if (id === NPC.FENKENSTRAIN) {
      const variant = fenkenstrainVariant(player);
      return variant ? { page: PAGE, variant } : null;
    }
    if (id === NPC.FENKENSTRAIN_IN_TOWER) return stage >= STAGE.COMPLETE ? { page: PAGE, variant: "post-quest-dialogue-dr-fenkenstrain" } : null;
    if (id === NPC.CREATURE) {
      if (stage === STAGE.CREATURE_LOOSE) return { page: PAGE, variant: "talking-to-the-creature-of-fenkenstrain" };
      if (stage === STAGE.CREATURE_CONVINCED) return { page: PAGE, variant: "talking-to-the-creature-of-fenkenstrain-talking-to-the-creature-of-fenkenstrain-again" };
      return null;
    }
    if (id === NPC.ROLOGARTH) return stage >= STAGE.COMPLETE ? { page: ROLOGARTH_PAGE, variant: "after-creature-of-fenkenstrain" } : null;
    if (id === NPC.GARDENER) return gardenerVariant(player);
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // The transcript's conditions
  // ------------------------------------------------------------------------------------------

  const needleGiven = (player) => state.get(player, FIELD.NEEDLE) === 1;
  const threadsGiven = (player) => state.get(player, FIELD.THREADS);
  const headFound = (player) => held(player, ITEM.HEAD) || held(player, ITEM.HEAD_WITH_BRAIN) || state.get(player, FIELD.HEAD) === 1;
  const allPartsGiven = (player) => PART_FIELDS.every((field) => state.get(player, field) === 1);

  function answerCondition(event) {
    if (!ourTalk(event)) return null;
    const { player } = event;
    const text = String(event.text ?? "").toLowerCase();
    const has = (itemId) => held(player, itemId);
    const where = pending.get(player);
    // The castle's floor-one variant (the clock and both bookcases share it).
    if (text.includes("winds the clock at the south-west")) return where === "clock" && !has(ITEM.LETTER);
    if (text.includes("winds the clock again with the letter")) return where === "clock" && has(ITEM.LETTER);
    if (text.includes("searches the bookcase to the north-west")) return where === "west-bookcase";
    if (text.includes("searches the bookcase to the north-east")) return where === "east-bookcase";
    if (text.includes("combines the marble and obsidian amulets")) return false;
    if (text.includes("does not have the marble amulet")) return !has(ITEM.MARBLE_AMULET) && !has(ITEM.STAR_AMULET);
    if (text.includes("marble or star amulet is in the player's inventory")) return has(ITEM.MARBLE_AMULET) || has(ITEM.STAR_AMULET);
    if (text.includes("without the obsidian amulet")) return !has(ITEM.OBSIDIAN_AMULET) && !has(ITEM.STAR_AMULET);
    if (text.includes("obsidian or star amulet is in the backpack")) return has(ITEM.OBSIDIAN_AMULET) || has(ITEM.STAR_AMULET);
    // The gardener.
    if (text.includes("not wearing the amulet of ghostspeak") || text.includes("not wearing the ghostspeak amulet")) return !common.wearingGhostspeak(player);
    if (text.includes("wearing the amulet of ghostspeak") || text.includes("wearing the ghostspeak amulet")) return common.wearingGhostspeak(player);
    if (text.includes("already found the head")) return headFound(player);
    if (text.includes("does not have the head")) return !headFound(player);
    if (text.includes("attempts to use the decapitated head")) return false;
    // Hand-ins, each judged after the one before has been taken.
    if (text.includes("has the decapitated head with the brain")) return has(ITEM.HEAD_WITH_BRAIN);
    if (text.includes("has the torso")) return has(ITEM.TORSO);
    if (text.includes("has the arms")) return has(ITEM.ARMS);
    if (text.includes("has the legs")) return has(ITEM.LEGS);
    if (text.includes("brought all parts to dr fenkenstrain")) return allPartsGiven(player);
    // The needle and the thread.
    const needleToGive = !needleGiven(player) && has(ITEM.NEEDLE);
    const threadToGive = threadsGiven(player) < 5 && has(ITEM.THREAD);
    const gaveNow = givenThisTalk.has(player);
    if (text.includes("does not have either the needle or five thread")) {
      return !needleToGive && !threadToGive && !needleGiven(player) && threadsGiven(player) === 0
        && !common.heldAny(player, ITEM.COSTUME_NEEDLES);
    }
    if (text.includes("has a costume needle")) {
      return !needleGiven(player) && !has(ITEM.NEEDLE) && common.heldAny(player, ITEM.COSTUME_NEEDLES) && !threadToGive;
    }
    if (text.includes("only has a needle in their inventory")) return needleToGive;
    if (text.includes("only has 1-5 thread in their inventory")) return threadToGive;
    if (text.includes("only brought the needle and speaks to him again")) {
      return !gaveNow && needleGiven(player) && threadsGiven(player) < 5 && !threadToGive;
    }
    if (text.includes("only brought the thread and speaks to him again")) {
      return !gaveNow && !needleGiven(player) && threadsGiven(player) > 0 && !needleToGive;
    }
    if (text.includes("brought the needle and five thread")) return needleGiven(player) && threadsGiven(player) >= 5;
    // The pub's brain (Roavar's talk is started from the bar's jar).
    const brainHeld = has(ITEM.BRAIN) || has(ITEM.HEAD_WITH_BRAIN);
    if (text.includes("attempts to pick up the pickled brain")) return !brainHeld;
    if (text.includes("attempts to take the pickled brain whilst having one")) return brainHeld;
    if (text.includes("uses the decapitated head on the brain")) return false;
    if (text.includes("does not have 50 coins")) return player.getInventory().getAmount(ITEM.COINS) < 50;
    if (text.includes("has 50 coins")) return player.getInventory().getAmount(ITEM.COINS) >= 50;
    // The signpost.
    if (text.includes("reads the signpost")) return true;
    return null;
  }

  /** A chosen condition is the moment live hands each thing over (ticks 1392-1395, 1414-1416). */
  function handOver(event) {
    if (!ourTalk(event) || baseId(event.npc) !== NPC.FENKENSTRAIN) return;
    const { player } = event;
    const text = String(event.text ?? "").toLowerCase();
    const parts = [
      ["has the arms", ITEM.ARMS, FIELD.ARMS],
      ["has the legs", ITEM.LEGS, FIELD.LEGS],
      ["has the torso", ITEM.TORSO, FIELD.TORSO],
      ["has the decapitated head with the brain", ITEM.HEAD_WITH_BRAIN, FIELD.HEAD],
    ];
    for (const [words, itemId, field] of parts) {
      if (!text.includes(words) || !held(player, itemId)) continue;
      player.getInventory().deleteNumber(itemId, 1);
      state.set(player, field, 1);
      return;
    }
    if (text.includes("brought all parts to dr fenkenstrain")) {
      if (stageOf(player) === STAGE.PARTS) quest().setStage(player, STAGE.NEEDLE_AND_THREAD);
      return;
    }
    if (text.includes("only has a needle in their inventory") && held(player, ITEM.NEEDLE)) {
      player.getInventory().deleteNumber(ITEM.NEEDLE, 1);
      state.set(player, FIELD.NEEDLE, 1);
      givenThisTalk.set(player, true);
      return;
    }
    if (text.includes("only has 1-5 thread in their inventory")) {
      const amount = Math.min(5 - threadsGiven(player), player.getInventory().getAmount(ITEM.THREAD));
      if (amount <= 0) return;
      player.getInventory().deleteNumber(ITEM.THREAD, amount);
      state.set(player, FIELD.THREADS, threadsGiven(player) + amount);
      givenThisTalk.set(player, true);
      return;
    }
    if (text.includes("brought the needle and five thread") && stageOf(player) === STAGE.NEEDLE_AND_THREAD) {
      quest().setStage(player, STAGE.CONDUCTOR);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Lines, boxes and actions
  // ------------------------------------------------------------------------------------------

  /** Each castle person's lines carry their own (multinpc) head and name, as live sends them. */
  function present(event) {
    const { player, step } = event;
    const id = baseId(event.npc);
    const speaker = SPEAKERS.get(id);
    if (speaker && typeof step?.player !== "string" && speaker.labels.includes(step?.speaker)) {
      event.speakerId = id;
      event.speakerName = speaker.name;
    }
    const text = String(event.text ?? "");
    if (id === NPC.FENKENSTRAIN && text.startsWith("Destroy it!!! Take the key to the Tower")) {
      // The stage as the line shows, the key as it is continued (ticks 1882, 1885).
      event.before = () => {
        if (stageOf(player) === STAGE.CONDUCTOR_REPAIRED) quest().setStage(player, STAGE.CREATURE_LOOSE);
      };
      event.after = () => {
        if (stageOf(player) === STAGE.CREATURE_LOOSE && !held(player, ITEM.TOWER_KEY)) player.getInventory().adds(ITEM.TOWER_KEY, 1);
      };
      return;
    }
    if (id === NPC.CREATURE && text.startsWith("Only one - please stop Fenkenstrain")) {
      event.before = () => {
        if (stageOf(player) === STAGE.CREATURE_LOOSE) quest().setStage(player, STAGE.CREATURE_CONVINCED);
      };
    }
  }

  /** Book and box presentation, and the transcript's hand-outs, keyed by their words. */
  function act(event) {
    if (!ourTalk(event)) return;
    const { player } = event;
    const text = String(event.text ?? "");
    if (event.kind === "message") return presentMessage(event, player, text);
    const lower = text.toLowerCase();
    const give = (itemId) => {
      if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
      event.handled = true;
    };
    if (lower === "marble amulet") return give(ITEM.MARBLE_AMULET);
    if (lower === "obsidian amulet") return give(ITEM.OBSIDIAN_AMULET);
    if (lower === "a letter") return give(ITEM.LETTER);
    if (lower.startsWith("a shed key")) return give(ITEM.SHED_KEY);
    if (lower === "the gardener ghost follows the player") {
      // The guide sets off as the gardener's last line is continued (Gardener unit).
      event.handled = true;
      return;
    }
  }

  function presentMessage(event, player, text) {
    const where = pending.get(player);
    const itemBox = (itemId) => { event.box = { items: [itemId] }; event.handled = true; };
    const statement = () => { event.box = { statement: true }; event.handled = true; };
    if (text.startsWith("Fenkenstrain uses the needle and thread")) return statement();
    if (text.startsWith("The creature stumbles") || text.startsWith("The creature becomes instantly sober")) return statement();
    if (text.startsWith("The Headless Gardener's neck twitches")) return statement();
    if (text.startsWith("You feel power emanate from the Amulet of Ghostspeak")) {
      // Shown the first time only; then the gardener just talks (ticks 570-572, 596).
      if (state.get(player, FIELD.SPOKEN_TO_GARDENER)) {
        event.handled = true;
        return;
      }
      itemBox(ITEM.GHOSTSPEAK_AMULETS[0]);
      event.after = () => state.set(player, FIELD.SPOKEN_TO_GARDENER, 1);
      return;
    }
    if (text.startsWith("The headless gardener hands you a rusty key")) return itemBox(ITEM.SHED_KEY);
    if (text.startsWith("As you pull the book a hidden latch")) {
      // The latch and the compartment swinging open (ticks 473, 517): an item box on the north-east
      // bookcase, a message box on the north-west one.
      const tile = where === "west-bookcase" ? WEST_BOOKCASE : EAST_BOOKCASE;
      const object = pendingObjects.get(player);
      if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(SEQ.BOOKCASE_OPEN));
      player.getPacketSender().sendSoundEffect(SOUND.BOOKCASE, 1, 0);
      return tile === WEST_BOOKCASE ? statement() : itemBox(ITEM.JOURNAL);
    }
    if (text.startsWith("You find a marble amulet")) return itemBox(ITEM.MARBLE_AMULET);
    if (text.startsWith("You find an obsidian amulet")) return itemBox(ITEM.OBSIDIAN_AMULET);
    if (text.startsWith("The secret compartment is empty")) return statement();
    if (text.startsWith("This book") || text.startsWith("The book is appallingly dull")) return itemBox(ITEM.JOURNAL);
    if (text.startsWith("As you wind the old clock")) return itemBox(ITEM.LETTER);
    if (text.startsWith("The signpost has a note pinned onto it")) return statement();
    if (text.startsWith("You've started a new quest")) {
      // Reading the signpost's note starts the quest (Wiki; not in the capture, which started it with him).
      startQuest(player);
      return;
    }
  }

  function choose(event) {
    if (!ourTalk(event)) return;
    const { player } = event;
    const option = String(event.option ?? "");
    if (baseId(event.npc) === NPC.FENKENSTRAIN && option === "Grave-digging" && stageOf(player) === STAGE.NOT_STARTED) {
      // The quest starts as the answer is picked, before "Mmmm, I see." (tick 373).
      startQuest(player);
      return;
    }
    if (option === SWEEPING_BOOK && pending.get(player) === "east-bookcase") {
      pending.delete(player);
      event.end = true;
      player.getPacketSender().sendInterfaceRemoval();
      openBook(player, SWEEPING_BOOK, bookPagesFromSpreads(SWEEPING_PAGES));
    }
  }

  function startQuest(player) {
    if (stageOf(player) !== STAGE.NOT_STARTED) return;
    quest().setStage(player, STAGE.PARTS);
  }

  // ------------------------------------------------------------------------------------------
  // Pickpocket: the ending, and the ring again afterwards
  // ------------------------------------------------------------------------------------------

  function pickpocket(event) {
    const { player } = event;
    const id = baseId(event.npc);
    if (id !== NPC.FENKENSTRAIN && id !== NPC.FENKENSTRAIN_IN_TOWER) return false;
    const stage = stageOf(player);
    const refuse = () => startTranscript(api, player, NPC.FENKENSTRAIN_MODEL, PAGE,
      "dr-fenkenstrain-attempting-to-pickpocket-dr-fenkenstrain-before-starting-the-quest", undefined, event.npc);
    if (stage === STAGE.CREATURE_CONVINCED || (stage >= STAGE.COMPLETE && !ownsRing(player))) {
      if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < THIEVING_LEVEL) {
        // Ours: the Wiki's boostable 25 Thieving, worded as the other pickpockets are.
        player.sendMessage(`You need level ${THIEVING_LEVEL} thieving to pick Dr Fenkenstrain's pocket.`);
        return true;
      }
      player.sendMessage(STEAL_MESSAGE);
      if (stage === STAGE.CREATURE_CONVINCED) {
        // Varp 400 is cleared and varp 399 goes to 8 on the same tick (2225); the ring is the reward.
        state.clear(player);
        quest().complete(player);
      } else {
        player.getInventory().adds(ITEM.RING, 1);
      }
      return true;
    }
    refuse();
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The first floor: bookcases, amulets, the clock and the letter
  // ------------------------------------------------------------------------------------------

  const pendingObjects = new WeakMap();

  function searchBookcase(event) {
    const { player, objectId, location, object } = event;
    if (objectId !== LOC.BOOKCASE) return false;
    const west = common.at(location, ...WEST_BOOKCASE);
    const east = common.at(location, ...EAST_BOOKCASE);
    if (!west && !east) return false;
    pending.set(player, west ? "west-bookcase" : "east-bookcase");
    if (object) pendingObjects.set(player, object);
    startTranscript(api, player, NPC.FENKENSTRAIN_MODEL, PAGE, "inside-dr-fenkenstrain-s-tower-floornumber-uk-1");
    return true;
  }

  function windClock(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.CLOCK) return false;
    pending.set(player, "clock");
    startTranscript(api, player, NPC.FENKENSTRAIN_MODEL, PAGE, "inside-dr-fenkenstrain-s-tower-floornumber-uk-1");
    return true;
  }

  /** The marble and obsidian amulets make the star (tick 525): both go, the star is shown in a box. */
  function combineAmulets(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (!ids.has(ITEM.MARBLE_AMULET) || !ids.has(ITEM.OBSIDIAN_AMULET)) return false;
    event.handled = true;
    player.getInventory().deleteNumber(ITEM.MARBLE_AMULET, 1);
    player.getInventory().deleteNumber(ITEM.OBSIDIAN_AMULET, 1);
    player.getInventory().adds(ITEM.STAR_AMULET, 1);
    box(player, "The marble and obsidian amulets snap together tightly to form a six-pointed amulet.", ITEM.STAR_AMULET);
    return true;
  }

  /** The letter from the clock (Wiki, Transcript:Letter (Creature of Fenkenstrain)); ours: the long scroll it opens in. */
  const LETTER_LINES = [
    "Rologarric,",
    "I am writing to you, my brother, to ask for your aid, and to forgive me on behalf of all the poor souls that I have sacrificed to save my own neck. I have no doubt that my own soul lies forfeit, but I would wish to see you once again before I am cast into the eternal fire. You well know the history of our noble ancestors, who have stood against the wave of darkness covering all of Morytania, protecting the inhabitants of this castle by sheer force of personality. I, however, stand lacking in their all too dominating shadow. I have been weak, my brother, letting him rule in my stead.",
    "",
    "You know of whom I speak but dare not name - my 'doctor' of many years, the very same creature you sought to escape ten years ago. He advised me that the power in the South was rising, and soon our ancestral home would fall to the growing evil. He advised me to send a gift of tribute to the vampires, to satisfy their hunger for at least a while. I regret to say that I acceded to this request. I ordered a young girl out into the forest to pick mushrooms, knowing that I was sending her to her death, or worse, her undeath.",
    "",
    "Of course, soon after my advisor told me that the vampires were again restive, and to send another 'gift' And of course, this I did, to ensure the safety of everyone in the castle.",
    "",
    "But a vampire's hunger can never be sated. Every innocent soul I have sent into the Forest to their doom both strengthens their power and increases their hunger.",
    "",
    "He knows this. I look into his eyes and see amusement. In his eyes I see the truth - that he must have struck a deal with them some time ago. He sold my people to them in exchange for... this castle.",
    "",
    "I have sent them all to their doom, and now I fear my own.",
    "",
    "Your brother,",
    "Rologarth,",
    "15th Lord of the North Coast",
  ];

  function readLetter({ player, itemId }) {
    if (itemId !== ITEM.LETTER) return false;
    openLongScroll(player, "", LETTER_LINES);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The roof's lightning conductor
  // ------------------------------------------------------------------------------------------

  function repairConductor(event) {
    const { player, objectId, object } = event;
    if (objectId !== LOC.CONDUCTOR_BROKEN) return false;
    const stage = stageOf(player);
    if (stage > STAGE.CONDUCTOR) {
      player.sendMessage("The lightning conductor is now beyond repair.");
      return true;
    }
    if (stage !== STAGE.CONDUCTOR || !held(player, ITEM.CONDUCTOR)) {
      // Ours: no source covers Repair before the sewing or without a conductor.
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    player.getInventory().deleteNumber(ITEM.CONDUCTOR, 1);
    quest().setStage(player, STAGE.CONDUCTOR_REPAIRED);
    // Repaired, struck and melted again as its box goes (ticks 1820-1824).
    const sender = player.getPacketSender();
    const location = new Location(...CONDUCTOR_TILE);
    const face = object?.getFace?.() ?? 2;
    const repaired = new GameObject(LOC.CONDUCTOR_REPAIRED, location, 10, face, null);
    sender.sendObject(repaired);
    sender.sendObjectAnimation(repaired, new Animation(SEQ.LIGHTNING));
    sender.sendSoundEffect(SOUND.LIGHTNING, 1, 0);
    box(player, "You repair the lightning conductor not one moment too soon - a tremendous bolt of lightning melts the new lightning conductor, and power blazes throughout the castle, if only briefly.", null,
      () => sender.sendObject(new GameObject(LOC.CONDUCTOR_BROKEN, location, 10, face, null)));
    return true;
  }

  function conductorOnStand(event) {
    if (event.itemId !== ITEM.CONDUCTOR || event.objectId !== LOC.CONDUCTOR_BROKEN) return false;
    event.handled = true;
    return repairConductor(event);
  }

  // ------------------------------------------------------------------------------------------
  // The tower door (Doors.plugin opens it as a pass-through gate)
  // ------------------------------------------------------------------------------------------

  /**
   * The key goes into the lock once (tick 1927) and the door opens freely after (2176); after the quest
   * it is never locked (2311). Every opening also sends the lock's sound (2402).
   */
  function towerDoor(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.TOWER_DOOR) return;
    const unlocked = stageOf(player) >= STAGE.COMPLETE || state.get(player, FIELD.UNLOCKED_TOWER);
    if (!unlocked && !held(player, ITEM.TOWER_KEY)) {
      event.handled = true;
      // Ours: the shed's locked message (Wiki); no capture tries the tower door without its key.
      player.sendMessage("The door is locked.");
      return;
    }
    if (!unlocked) {
      player.getInventory().deleteNumber(ITEM.TOWER_KEY, 1);
      state.set(player, FIELD.UNLOCKED_TOWER, 1);
    }
    player.getPacketSender().sendSoundEffect(SOUND.LOCKED, 1, 0);
  }

  // ------------------------------------------------------------------------------------------
  // The Canifis signpost
  // ------------------------------------------------------------------------------------------

  function readSignpost(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.SIGNPOST) return false;
    const stage = stageOf(player);
    if (stage >= STAGE.COMPLETE) {
      // Wiki (Fenkenstrain's Castle): the note after the quest.
      box(player, "AAARRGGGHHHHH!!!!!");
      return true;
    }
    if (stage > STAGE.NOT_STARTED) {
      // Ours: the note as the Wiki gives it, without the start prompt.
      box(player, "The signpost has a note pinned onto it. The note says:<br>'----Braindead Butler Wanted----<br>Gravedigging skills essential - Hunchback advantageous<br>See Dr Fenkenstrain at the castle NE of Canifis'");
      return true;
    }
    startTranscript(api, player, NPC.FENKENSTRAIN_MODEL, PAGE, "reading-the-signpost-at-the-centre-of-canifis");
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // A zombie head on Fenkenstrain
  // ------------------------------------------------------------------------------------------

  function zombieHead(event) {
    const { player, target } = event;
    const itemId = event.item?.getId?.() ?? event.itemId;
    if (itemId !== ITEM.ZOMBIE_HEAD || baseId(target) !== NPC.FENKENSTRAIN) return false;
    event.handled = true;
    startTranscript(api, player, NPC.FENKENSTRAIN_MODEL, PAGE, "finding-the-torso-arms-and-legs-using-the-zombie-head-on-dr-fenkenstrain", undefined, target);
    return true;
  }

  function forget({ player }) {
    pending.delete(player);
    givenThisTalk.delete(player);
    pendingObjects.delete(player);
  }

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handOver);
  api.onCustomEvent("npc-dialogue:line", present);
  api.onCustomEvent("npc-dialogue:action", act);
  api.onCustomEvent("npc-dialogue:choice", choose);
  api.onNpcInteraction("Dr Fenkenstrain", { Pickpocket: pickpocket });
  api.onObjectInteraction("Bookcase", { Search: searchBookcase });
  api.onObjectInteraction("Clock", { Wind: windClock });
  api.onObjectInteraction("Lightning conductor", { Repair: repairConductor });
  api.onObjectInteraction("Signpost", { Read: readSignpost });
  api.onItemOnItem(combineAmulets);
  api.onItemAction("Letter", { Read: readLetter });
  api.onItemOnObject(conductorOnStand, { noted: false });
  api.onItemOnNpc(zombieHead);
  api.onCustomEvent("door:toggle", towerDoor);
  api.onPlayerLogout(forget);

  return { pending };
};
