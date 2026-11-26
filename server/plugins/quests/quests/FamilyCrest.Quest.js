/**
 * Family Crest (members).
 *
 * Built against two whole runs of the quest on live, revision 242 (the user's RSProx captures
 * `FamilyCrest + FamilyPest.bin`, local recording 1002252, and local recording 1002185; ticks below
 * are 1002252's unless marked B). The words are the generated "Family Crest" transcript and the NPC
 * transcripts of Dimintheis, Caleb, Avan, Johnathon, Boot and the Gem trader, with the captures'
 * wording laid over the Wiki in osrsreboxed-db's capture-sources.json. docs/quests/family-crest/README.md
 * lists the facts this plugin relies on.
 *
 * The stage (varp 148) moves as live sends it: always as the player continues the line or box before
 * the one that comes with it, never when the lines are built.
 *   1  "Yes." on "Start the Family Crest quest?" (189)
 *   2  either answer to Caleb's fish list: "Ok, I will get those." (B 7757) or "Why don't you just give
 *      me the crest?" (364)
 *   3  continuing "You exchange the fish for Caleb's piece of the crest." (the fish go and piece 780
 *      comes with it, 374)
 *   4  Caleb's "He said he was on some kind of search for treasure..." (392)
 *   5  continuing the Gem trader's "Maybe we'll all get lucky..." (B 7980)
 *   6  continuing Avan's "Unfortunately he has apparently returned to his home..." (637)
 *   7  Boot's "High quality gold eh?..." (812)
 *   8  continuing the ring-and-necklace box (piece 779 comes with it, 1648)
 *   9  Johnathon's "The... poison... it is all... too much..." (2021)
 *  10  any antipoison on Johnathon (2032)
 *  11  continuing Dimintheis's "They can also be granted extra powers..." (3033)
 *
 * The sons stand in the world as nameless multi-NPCs (Avan 4983, Caleb 4986, Johnathon 4988) shown as
 * their stage's form (Avan 385/386/387, Caleb 4317/5433, Johnathon 5443/5445); live's chathead is the
 * multi-NPC itself on every line (if_setnpchead 4983/4986/4988, ticks 319-6221).
 */
module.exports = function registerFamilyCrestQuest(api) {
  const { Skill, CombatType, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questNamed, questStartMessage } = require("../QuestRuntime");

  const PAGE = "Family Crest";

  const VARP_FAMILY_CREST = 148;

  const STAGE_SPOKEN_DIMINTHEIS = 1;
  const STAGE_SPOKEN_CALEB = 2;
  const STAGE_CALEB_PIECE = 3;
  const STAGE_SEEKING_AVAN = 4;
  const STAGE_SPOKEN_GEM_TRADER = 5;
  const STAGE_SPOKEN_AVAN = 6;
  const STAGE_SPOKEN_BOOT = 7;
  const STAGE_AVAN_PIECE = 8;
  const STAGE_SPOKEN_JOHNATHON = 9;
  const STAGE_CURED_JOHNATHON = 10;
  const STAGE_COMPLETE = 11;

  const START_HOOK = "quest:family-crest:start";
  /** "Congratulations! Quest complete!" in the-crest-reassembled-talking-to-dimintheis: done by the last line's `after`. */
  const COMPLETE_ACTION_ID = "QH4WTh";
  const WITCHAVEN_GOLD_ROCK_REGION_X = 42;
  const WITCHAVEN_GOLD_ROCK_REGION_Y = 151;

  /** The gauntlets the player was last given or had imbued: what Dimintheis returns when they are lost. */
  const GAUNTLETS_ATTRIBUTE = "family-crest:gauntlets";
  /**
   * The crest is in Dimintheis's hands: live takes it as its box is continued and completes the quest five lines
   * later (3027 -> 3033). Ours: a player who walks away in between hears the hand-in again, without a crest.
   */
  const CREST_HANDED_ATTRIBUTE = "family-crest:crest-handed";

  // The lines and answers that move the quest on, as the transcripts word them.
  /** "Ok, I will get those." is stage 2 on the pick (B 7757); the other answer on its echo's continue (364 -> 365). */
  const FISH_LIST_PICK = "Ok, I will get those.";
  const CALEB_HEIRLOOM_LINE = /^It's a valuable family heirloom\. I think the least you can do/;
  const CALEB_AVAN_LINE = /^He said he was on some kind of search for treasure/;
  const GEM_TRADER_LAST_LINE = /^Maybe we'll all get lucky and the scorpions will deal with him/;
  const AVAN_BOOT_LINE = /^Unfortunately he has apparently returned to his home, somewhere under Ice Mountain/;
  const BOOT_GOLD_LINE = /^High quality gold eh\?/;
  const JOHNATHON_POISON_LINE = /^The\.\.\. poison\.\.\. it is all\.\.\. too much/;
  const DIMINTHEIS_LAST_LINE = /^They can also be granted extra powers/;
  const CALEB_FISH_EXCHANGE_MESSAGE_ID = "1xC7CR";
  const CALEB_PIECE_RETURN_MESSAGE_ID = "OvmzYQ";
  const AVAN_JEWELLERY_MESSAGE_ID = "S9wqPO";
  const CREST_PIECES_HAND_IN_MESSAGE_ID = "a-4U9N";
  const CREST_HAND_IN_MESSAGE_ID = "mD5IXN";
  const JOHNATHON_LEAVE_OPTION = "I will be on my way now.";

  // Spell ids from CombatSpells.ts; Chronozon's weakening is per element.
  const BLAST_SPELL_ELEMENTS = new Map([
    [1172, "wind"],
    [1175, "water"],
    [1177, "earth"],
    [1181, "fire"],
  ]);
  const weakenedByPlayer = new WeakMap();

  const GAUNTLET_CHANGE_COST = 25000;
  const STEEL_GAUNTLETS = ItemIdentifiers.STEEL_GAUNTLETS;
  const GAUNTLETS = [STEEL_GAUNTLETS, ItemIdentifiers.COOKING_GAUNTLETS, ItemIdentifiers.GOLDSMITH_GAUNTLETS, ItemIdentifiers.CHAOS_GAUNTLETS];
  const GAUNTLET_NAMES = new Map([
    [STEEL_GAUNTLETS, "steel"],
    [ItemIdentifiers.GOLDSMITH_GAUNTLETS, "goldsmithing"],
    [ItemIdentifiers.COOKING_GAUNTLETS, "cooking"],
    [ItemIdentifiers.CHAOS_GAUNTLETS, "chaos"],
  ]);
  // Message-step ids of each son's imbue: the free first one (post-quest page) and the paid change (NPC pages).
  const IMBUE_STEPS = new Map([
    ["MOcYDq", { target: ItemIdentifiers.COOKING_GAUNTLETS, free: true }],
    ["Ajs0NX", { target: ItemIdentifiers.COOKING_GAUNTLETS, free: false }],
    ["P09-0v", { target: ItemIdentifiers.GOLDSMITH_GAUNTLETS, free: true }],
    ["aGBezT", { target: ItemIdentifiers.GOLDSMITH_GAUNTLETS, free: false }],
    ["oicU8Z", { target: ItemIdentifiers.CHAOS_GAUNTLETS, free: true }],
    ["CWShbu", { target: ItemIdentifiers.CHAOS_GAUNTLETS, free: false }],
  ]);
  /** "Dimintheis returns your gauntlets." (the lost pair, back from his house). */
  const GAUNTLETS_RETURNED_MESSAGE_ID = "4s0yTB";

  const DIMINTHEIS_NPC_IDS = new Set([NpcIdentifiers.DIMINTHEIS, NpcIdentifiers.DIMINTHEIS_2]);
  const AVAN_PARENT = api.core.CacheDefinitions.getNpcId("avan");
  const CALEB_PARENT = api.core.CacheDefinitions.getNpcId("caleb_fitzharmon");
  const JOHNATHON_PARENT = api.core.CacheDefinitions.getNpcId("johnathon_fitzharmon");
  const CALEB_NPC_IDS = new Set([CALEB_PARENT, NpcIdentifiers.CALEB, NpcIdentifiers.CALEB_2]);
  const AVAN_NPC_IDS = new Set([AVAN_PARENT, NpcIdentifiers.MAN, NpcIdentifiers.AVAN, NpcIdentifiers.AVAN_2]);
  const JOHNATHON_NPC_IDS = new Set([JOHNATHON_PARENT, NpcIdentifiers.JOHNATHON, NpcIdentifiers.JOHNATHON_2]);
  const SON_HEADS = [[AVAN_NPC_IDS, AVAN_PARENT], [CALEB_NPC_IDS, CALEB_PARENT], [JOHNATHON_NPC_IDS, JOHNATHON_PARENT]];

  // The cache's crest parts: 779 avan_crest, 780 caleb_crest, 781 johnathon_crest (ticks 374, 1648, 2902).
  const AVAN_CREST = ItemIdentifiers.CREST_PART;
  const CALEB_CREST = ItemIdentifiers.CREST_PART_2;
  const JOHNATHON_CREST = ItemIdentifiers.CREST_PART_3;
  const CREST_PARTS = [CALEB_CREST, AVAN_CREST, JOHNATHON_CREST];
  const FAMILY_CREST = ItemIdentifiers.FAMILY_CREST;
  const PERFECT_RING = ItemIdentifiers.PERFECT_RING;
  const PERFECT_NECKLACE = ItemIdentifiers.PERFECT_NECKLACE;

  const FISH = [ItemIdentifiers.SHRIMPS, ItemIdentifiers.SALMON, ItemIdentifiers.TUNA, ItemIdentifiers.BASS, ItemIdentifiers.SWORDFISH];

  const ANTIPOISONS = new Set([
    ItemIdentifiers.ANTIPOISON_1_, ItemIdentifiers.ANTIPOISON_2_, ItemIdentifiers.ANTIPOISON_3_, ItemIdentifiers.ANTIPOISON_4_,
    ItemIdentifiers.SUPERANTIPOISON_1_, ItemIdentifiers.SUPERANTIPOISON_2_, ItemIdentifiers.SUPERANTIPOISON_3_, ItemIdentifiers.SUPERANTIPOISON_4_,
    ItemIdentifiers.SANFEW_SERUM_1_, ItemIdentifiers.SANFEW_SERUM_2_, ItemIdentifiers.SANFEW_SERUM_3_, ItemIdentifiers.SANFEW_SERUM_4_,
  ]);
  /** The antipoison going down Johnathon (synth 2401 "liquid", tick 2032). */
  const LIQUID_SOUND = 2401;

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const owns = (player, itemId) => has(player, itemId)
    || player.getEquipment().getAmount?.(itemId) > 0
    || player.getBanks().some((bank) => (bank?.getAmount(itemId) ?? 0) > 0);

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Dimintheis</col> in south-east Varrock.",
        "",
        "I will need level 40 Mining, Smithing and Crafting, and level 59 Magic.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I restored the Fitzharmon family crest.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    const lines = ["<str>I agreed to restore the Fitzharmon family crest.</str>", ""];
    if (stage === STAGE_SPOKEN_DIMINTHEIS) lines.push("I should find <col=800000>Caleb</col>, a chef beyond White Wolf Mountain.");
    else if (stage === STAGE_SPOKEN_CALEB) lines.push("Caleb needs cooked shrimp, salmon, tuna, bass and swordfish.");
    else if (stage === STAGE_CALEB_PIECE) lines.push("I have Caleb's piece. I should ask him where his brothers went.");
    else if (stage === STAGE_SEEKING_AVAN) lines.push("A trader in <col=800000>Al Kharid</col> may know where Avan is.");
    else if (stage === STAGE_SPOKEN_GEM_TRADER) lines.push("I should find <col=800000>Avan</col> near the Al Kharid mine.");
    else if (stage === STAGE_SPOKEN_AVAN) lines.push("I should ask <col=800000>Boot</col> in the Dwarven Mine about perfect gold.");
    else if (stage === STAGE_SPOKEN_BOOT) lines.push("I need a perfect ruby ring and necklace for Avan.");
    else if (stage === STAGE_AVAN_PIECE) lines.push("I should cure <col=800000>Johnathon</col> at the Jolly Boar Inn.");
    else if (stage === STAGE_SPOKEN_JOHNATHON) lines.push("Johnathon needs a dose of poison cure.");
    else if (stage === STAGE_CURED_JOHNATHON) lines.push("I must weaken Chronozon with all four Blast spells, kill him, and restore the crest.");
    return lines;
  }

  /** The son a clicked NPC id is, or null. */
  function sonOf(npcId) {
    if (CALEB_NPC_IDS.has(npcId)) return "Caleb";
    if (AVAN_NPC_IDS.has(npcId)) return "Avan";
    if (JOHNATHON_NPC_IDS.has(npcId)) return "Johnathon";
    return null;
  }

  /**
   * A son's gauntlets talk once the quest is done: with plain steel gauntlets, the free first imbue of the
   * quest's post-quest dialogue (Johnathon tick 3237, Avan 3353); otherwise his own page's paid change
   * (Caleb 3516-3536, the player holding goldsmith gauntlets).
   */
  function gauntletTalk(player, son) {
    return has(player, STEEL_GAUNTLETS)
      ? page(PAGE, `post-quest-dialogue-talking-to-${son.toLowerCase()}-after-the-quest`)
      : page(son, "standard-dialogue-after-completing-family-crest");
  }

  /** The paid change on a son's own page is under its "Gauntlets" menu entry (the Family Pest entry is that quest's). */
  function gauntletSteps(selected) {
    if (selected.page === PAGE) return undefined;
    return (steps) => {
      const menu = steps.find((step) => step.type === "choice" && step.options?.some((option) => option.text === "Gauntlets"));
      return menu?.options.find((option) => option.text === "Gauntlets")?.steps ?? steps;
    };
  }

  /** Family Pest's own conversations take over while it is in progress or done. */
  const familyPestStarted = (player) => (questNamed("Family Pest")?.getStage(player) ?? 0) > 0;

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (DIMINTHEIS_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page("Dimintheis", "standard-dialogue-after-completing-family-crest");
      const handed = player.getAttribute(CREST_HANDED_ATTRIBUTE) === true;
      if (has(player, FAMILY_CREST) || handed || stage >= STAGE_CURED_JOHNATHON && CREST_PARTS.every((id) => has(player, id))) {
        return page(PAGE, "the-crest-reassembled-talking-to-dimintheis");
      }
      if (stage >= STAGE_CALEB_PIECE) return page(PAGE, "starting-off-dimintheis-talking-to-dimintheis-again-after-obtaining-a-crest-piece");
      if (stage >= STAGE_SPOKEN_DIMINTHEIS) return page(PAGE, "starting-off-dimintheis-talking-to-dimintheis-again");
      return page(PAGE, "starting-off-dimintheis");
    }

    const son = sonOf(npcId);
    if (son && stage >= STAGE_COMPLETE) {
      // Family Pest's menus and post-miniquest talks are its own plugin's.
      if (familyPestStarted(player)) return null;
      return gauntletTalk(player, son);
    }

    if (son === "Caleb") {
      if (has(player, FAMILY_CREST)) return page(PAGE, "caleb-talking-to-caleb-after-assembling-the-family-crest");
      if (stage >= STAGE_SEEKING_AVAN) return page(PAGE, "caleb-talking-to-caleb-again-after-obtaining-the-first-crest-piece");
      // Tick 385: between handing over his piece and telling you about Avan.
      if (stage === STAGE_CALEB_PIECE) return page(PAGE, "caleb-talking-to-caleb-after-getting-his-crest-piece");
      if (stage >= STAGE_SPOKEN_CALEB) return page(PAGE, "caleb-talking-to-caleb-again");
      if (stage >= STAGE_SPOKEN_DIMINTHEIS) return page(PAGE, "caleb");
      return null;
    }

    if (npcId === NpcIdentifiers.GEM_TRADER && stage === STAGE_SEEKING_AVAN) {
      return page(PAGE, "avan-talking-to-the-gem-trader");
    }

    if (son === "Avan") {
      if (has(player, FAMILY_CREST)) return page(PAGE, "avan-talking-to-avan-after-assembling-the-family-crest");
      if (stage >= STAGE_AVAN_PIECE) return page(PAGE, "avan-talking-to-avan-after-getting-his-crest-piece");
      if (stage >= STAGE_SPOKEN_BOOT) {
        return page(PAGE, has(player, PERFECT_RING) && has(player, PERFECT_NECKLACE)
          ? "avan-talking-to-avan-after-talking-to-boot-if-the-player-has-the-jewellery"
          : "avan-talking-to-avan-after-talking-to-boot-if-the-player-has-not-made-the-jewellery");
      }
      if (stage >= STAGE_SPOKEN_AVAN) return page(PAGE, "avan-talking-to-avan-talking-to-avan-again");
      if (stage >= STAGE_SPOKEN_GEM_TRADER) return page(PAGE, "avan-talking-to-avan");
      if (stage >= STAGE_SEEKING_AVAN) return page(PAGE, "avan-talking-to-avan-man-before-talking-to-the-gem-trader");
      return null;
    }

    // Boot keeps the quest's menu after telling you where the gold is (tick 816: the gold answer again at 7). No
    // recording talks to him later: from stage 8 his own page plays again.
    if (npcId === NpcIdentifiers.BOOT && (stage === STAGE_SPOKEN_AVAN || stage === STAGE_SPOKEN_BOOT)) {
      return page(PAGE, "avan-boot");
    }

    if (son === "Johnathon") {
      if (stage >= STAGE_CURED_JOHNATHON && (has(player, JOHNATHON_CREST) || has(player, FAMILY_CREST))) {
        return page(PAGE, "johnathon-returning-after-defeating-chronozon");
      }
      if (stage >= STAGE_CURED_JOHNATHON) return page(PAGE, "johnathon-talking-to-johnathon-again-2");
      if (stage >= STAGE_SPOKEN_JOHNATHON) return page(PAGE, "johnathon-talking-to-johnathon-again");
      if (stage >= STAGE_AVAN_PIECE) return page(PAGE, "johnathon");
      return null;
    }

    return null;
  }

  /** The pairs the player still owns, carried, worn or banked. */
  const ownedGauntlets = (player) => GAUNTLETS.filter((id) => owns(player, id));

  function answerCondition({ player, text, npcId }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (CALEB_NPC_IDS.has(npcId)) {
      const cooking = has(player, ItemIdentifiers.COOKING_GAUNTLETS);
      const other = GAUNTLETS.some((id) => id !== ItemIdentifiers.COOKING_GAUNTLETS && has(player, id));
      if (value.includes("already has a pair of cooking gauntlets")) return cooking;
      if (value.includes("does not have any other gauntlets")) return !cooking && !other;
      if (value.includes("has another set of gauntlets")) return !cooking && other;
      if (value.includes("does not have enough coins")) return !has(player, ItemIdentifiers.COINS, GAUNTLET_CHANGE_COST);
    }
    if (DIMINTHEIS_NPC_IDS.has(npcId)) {
      const defender = questNamed("Defender of Varrock")?.isComplete(player) === true;
      if (value === "if defender of varrock has not been completed:") return !defender;
      if (value === "if defender of varrock has been completed:") return defender;
      const owned = ownedGauntlets(player);
      if (value === "if the player is missing their gauntlets:") return owned.length === 0;
      // Tick 3800: holding goldsmith gauntlets, Dimintheis names them; any other pair gets the Wiki's answer.
      if (value === "if the player has their goldsmith gauntlets:") return owned.includes(ItemIdentifiers.GOLDSMITH_GAUNTLETS);
      if (value === "if the player has their gauntlets:") return owned.length > 0 && !owned.includes(ItemIdentifiers.GOLDSMITH_GAUNTLETS);
    }
    // Wiki: the start warns a player below the quest's levels (and combat 55) before the prompt.
    if (value.includes("lacks one or more requirements")) {
      return !meetsSkillRequirements(player) && player.getSkillManager().getCombatLevel?.() < 55;
    }
    if (value.includes("does not have all the fish")) return !FISH.every((id) => has(player, id));
    if (value.includes("has all the fish")) return FISH.every((id) => has(player, id));
    // Live asks where Avan is until you have found him (tick 394, stage 4).
    if (value.includes("before finding avan")) return stage < STAGE_SPOKEN_AVAN;
    // A piece in the bank is not lost: Caleb gives a second one only to a player who has none anywhere.
    const lost = (id) => !owns(player, id) && !owns(player, FAMILY_CREST);
    if (value.includes("player has the first piece")) return !lost(CALEB_CREST);
    if (value.includes("player has lost the crest piece")) return lost(CALEB_CREST);
    if (value.includes("player has all the crest pieces")) return CREST_PARTS.every((id) => has(player, id));
    if (value.includes("player has lost avan's crest piece")) return lost(AVAN_CREST);
    if (value.includes("player has lost the fragment")) return lost(JOHNATHON_CREST);
    const handed = player.getAttribute(CREST_HANDED_ATTRIBUTE) === true;
    if (value.includes("crest isn't assembled")) return !handed && !has(player, FAMILY_CREST);
    if (value.includes("crest is assembled")) return handed || has(player, FAMILY_CREST);
    return null;
  }

  /** Wiki: 59 Magic, 40 Mining, 40 Smithing and 40 Crafting. */
  const REQUIRED_SKILLS = [
    { skill: Skill.MAGIC, level: 59, label: "Magic" },
    { skill: Skill.MINING, level: 40, label: "Mining" },
    { skill: Skill.SMITHING, level: 40, label: "Smithing" },
    { skill: Skill.CRAFTING, level: 40, label: "Crafting" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function meetsSkillRequirements(player) {
    return missingSkillRequirements(player).length === 0;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DIMINTHEIS_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    // Wiki (Requirements): none of the skills is needed to start; below them the transcript's warning box is shown
    // before the prompt ("If the player lacks one or more requirements..."), and the quest starts.
    if (quest.getStage(player) < STAGE_SPOKEN_DIMINTHEIS) {
      quest.setStage(player, STAGE_SPOKEN_DIMINTHEIS);
      // With the stage, before "Ok, I will help you." (tick 189).
      player.sendMessage(questStartMessage(player, "Family Crest"));
    }
  }

  function handleChoice({ player, npcId, option }) {
    if (!CALEB_NPC_IDS.has(npcId) || String(option ?? "") !== FISH_LIST_PICK) return;
    if (quest.getStage(player) === STAGE_SPOKEN_DIMINTHEIS) quest.setStage(player, STAGE_SPOKEN_CALEB);
  }

  /** Runs `action` when the line is reached (the previous one continued), before it is drawn. */
  function before(event, action) {
    const previous = event.before;
    event.before = () => { previous?.(); action(); };
  }

  /** Runs `action` as the player continues past the line. */
  function after(event, action) {
    const previous = event.after;
    event.after = () => { previous?.(); action(); };
  }

  /** The stage the quest moves to as a line comes or goes, and the sons' chatheads. */
  function handleLine(event) {
    const { player, npcId, step } = event;
    const text = String(event.text ?? "");
    const spoken = typeof step?.player !== "string";
    const stage = quest.getStage(player);
    if (spoken) {
      const head = SON_HEADS.find(([ids]) => ids.has(npcId));
      if (head && head[1] != null && (step?.speaker === undefined || sonOf(npcId) === step.speaker || step.speaker === "Man")) {
        event.speakerId = head[1];
        // The multi-NPC has no name of its own: the line keeps the name of the form it shows ("Man", "Avan", ...).
        event.speakerName ??= step?.speaker ?? event.definition?.getName?.() ?? sonOf(npcId);
      }
    }
    if (!spoken) return;
    if (CALEB_NPC_IDS.has(npcId) && CALEB_HEIRLOOM_LINE.test(text) && stage === STAGE_SPOKEN_DIMINTHEIS) {
      before(event, () => { if (quest.getStage(player) === STAGE_SPOKEN_DIMINTHEIS) quest.setStage(player, STAGE_SPOKEN_CALEB); });
    } else if (CALEB_NPC_IDS.has(npcId) && CALEB_AVAN_LINE.test(text) && stage === STAGE_CALEB_PIECE) {
      before(event, () => { if (quest.getStage(player) === STAGE_CALEB_PIECE) quest.setStage(player, STAGE_SEEKING_AVAN); });
    } else if (npcId === NpcIdentifiers.GEM_TRADER && GEM_TRADER_LAST_LINE.test(text) && stage === STAGE_SEEKING_AVAN) {
      after(event, () => { if (quest.getStage(player) === STAGE_SEEKING_AVAN) quest.setStage(player, STAGE_SPOKEN_GEM_TRADER); });
    } else if (AVAN_NPC_IDS.has(npcId) && AVAN_BOOT_LINE.test(text) && stage === STAGE_SPOKEN_GEM_TRADER) {
      after(event, () => { if (quest.getStage(player) === STAGE_SPOKEN_GEM_TRADER) quest.setStage(player, STAGE_SPOKEN_AVAN); });
    } else if (npcId === NpcIdentifiers.BOOT && BOOT_GOLD_LINE.test(text) && stage === STAGE_SPOKEN_AVAN) {
      before(event, () => { if (quest.getStage(player) === STAGE_SPOKEN_AVAN) quest.setStage(player, STAGE_SPOKEN_BOOT); });
    } else if (JOHNATHON_NPC_IDS.has(npcId) && JOHNATHON_POISON_LINE.test(text) && stage === STAGE_AVAN_PIECE) {
      before(event, () => { if (quest.getStage(player) === STAGE_AVAN_PIECE) quest.setStage(player, STAGE_SPOKEN_JOHNATHON); });
    } else if (DIMINTHEIS_NPC_IDS.has(npcId) && DIMINTHEIS_LAST_LINE.test(text) && stage === STAGE_CURED_JOHNATHON) {
      after(event, () => completeQuest(player));
    }
  }

  function completeQuest(player) {
    if (quest.isComplete(player) || quest.getStage(player) !== STAGE_CURED_JOHNATHON) return;
    if (player.getAttribute(CREST_HANDED_ATTRIBUTE) !== true) return;
    player.setAttribute(GAUNTLETS_ATTRIBUTE, STEEL_GAUNTLETS);
    player.setAttribute(CREST_HANDED_ATTRIBUTE, false);
    quest.complete(player);
  }

  /** The crest pieces combine on each other once all three are held. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.every((id) => CREST_PARTS.includes(id))) return;
    const { player } = event;
    if (!CREST_PARTS.every((id) => has(player, id))) {
      player.sendMessage("You still need one more piece of the crest.");
      event.handled = true;
      return;
    }
    for (const id of CREST_PARTS) player.getInventory().deleteNumber(id, 1);
    player.getInventory().adds(FAMILY_CREST, 1);
    player.sendMessage("You have restored the Family Crest.");
    event.handled = true;
  }

  /** Cure Johnathon with any antipoison: the potion goes, whatever its doses (tick 2032). */
  function handleItemOnNpc(event) {
    if (!ANTIPOISONS.has(event.itemId)) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!JOHNATHON_NPC_IDS.has(npcId)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_SPOKEN_JOHNATHON) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    api.core.Sounds?.sendSound?.(player, new api.core.Sound(LIQUID_SOUND, 1, 0, 0));
    quest.setStage(player, STAGE_CURED_JOHNATHON);
    startTranscript(api, player, npcId, PAGE, "johnathon-using-an-antipoison-on-johnathon", undefined, event.target ?? null);
    event.handled = true;
  }

  function gauntletsOption(event) {
    if (!quest.isComplete(event.player)) return;
    const son = sonOf(event.npcId);
    if (!son) return;
    const pestComplete = questNamed("Family Pest")?.isComplete(event.player);
    const selected = pestComplete ? page(son, "standard-dialogue-after-completing-family-pest") : gauntletTalk(event.player, son);
    event.handled = startTranscript(api, event.player, event.npcId, selected.page, selected.variant,
      pestComplete ? undefined : gauntletSteps(selected), event.npc ?? null);
  }

  /** Wiki (Gold rocks, Witchaven version): the gold rocks of the Witchaven Dungeon. */
  const isWitchavenGoldRock = (x, y, z) =>
    z === 0 && Math.floor(x / 64) === WITCHAVEN_GOLD_ROCK_REGION_X && Math.floor(y / 64) === WITCHAVEN_GOLD_ROCK_REGION_Y;

  /**
   * The Witchaven rocks are ordinary gold rocks that Mining mines (Wiki, Gold rocks: 65 XP, depleting, "perfect" ore
   * instead of gold ore). Only the pre-quest refusal is ours; once Boot has told you where it is, the click is left to
   * Mining and `handleOreYield` swaps the ore.
   */
  function handleObjectInteraction(event) {
    if (event.objectId !== ObjectIdentifiers.GOLD_ROCKS_2) return;
    const { x, y, z } = event.location ?? {};
    if (!isWitchavenGoldRock(x, y, z)) return;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (!option.includes("mine")) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_SPOKEN_BOOT) {
      player.sendMessage("This gold does not look special to you.");
      event.handled = true;
    }
  }

  /** "mining:ore-yield": a gold rock of the Witchaven Dungeon gives 'perfect' gold ore instead of gold ore (Wiki, Gold rocks). */
  function handleOreYield(request) {
    const at = request.rockObject?.getLocation?.();
    if (!at || request.rock !== "Gold rocks" || request.oreId !== ItemIdentifiers.GOLD_ORE) return;
    if (request.rockObject.getId() !== ObjectIdentifiers.GOLD_ROCKS_2 || !isWitchavenGoldRock(at.getX(), at.getY(), at.getZ())) return;
    request.oreId = ItemIdentifiers.PERFECT_GOLD_ORE;
    // Wiki ('Perfect' gold ore): Varrock armour gives one gold ore and one perfect gold ore, not two perfect.
    request.extraOreId = ItemIdentifiers.GOLD_ORE;
  }

  /** The canonical monster-drop table supplies Johnathon's piece, only when it is still needed. */
  function filterChronozonDrops({ player, npcId, drops }) {
    if (npcId !== NpcIdentifiers.CHRONOZON || !player) return;
    if (quest.getStage(player) === STAGE_CURED_JOHNATHON && !owns(player, JOHNATHON_CREST) && !owns(player, FAMILY_CREST)) return;
    for (let index = drops.length - 1; index >= 0; index--) {
      if (drops[index].itemId === JOHNATHON_CREST) drops.splice(index, 1);
    }
  }

  function handleNpcDeath({ killer, npcId }) {
    if (killer && npcId === NpcIdentifiers.CHRONOZON) weakenedByPlayer.delete(killer);
  }

  /** The box a message step of these conversations is drawn as (live: messagebox, objectbox or objectbox_double). */
  function boxFor(stepId, text) {
    if (stepId === AVAN_JEWELLERY_MESSAGE_ID) return { items: [PERFECT_RING, PERFECT_NECKLACE] }; // tick 1647
    if (stepId === CREST_HAND_IN_MESSAGE_ID) return { items: [FAMILY_CREST] }; // tick 3026
    const imbue = IMBUE_STEPS.get(stepId);
    if (imbue) return { items: [imbue.target] }; // tick 3364 (the imbued pair)
    if (/^You still need one more piece|^You have restored the Family Crest|^Chronozon weakens/.test(text)) return null;
    return { statement: true };
  }

  const FAMILY_CREST_PAGES = new Set([PAGE, "Dimintheis", "Caleb", "Avan", "Johnathon", "Boot", "Gem trader"]);
  const isOurConversation = (event) => FAMILY_CREST_PAGES.has(event.playing?.page ?? event.pages?.[0]?.page);

  /**
   * Message steps: the item exchanges and the boxes they are drawn as. Each exchange happens as the player continues
   * the box (the fish at tick 374, the jewellery at 1648, the crest at 3027).
   */
  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      return;
    }
    if (event.kind !== "message" || !isOurConversation(event)) return;
    if (IMBUE_STEPS.has(stepId) || stepId === GAUNTLETS_RETURNED_MESSAGE_ID) return; // handleGauntletImbue's
    const box = boxFor(stepId, String(event.text ?? ""));
    if (box && !event.box) event.box = box;
    switch (stepId) {
      case CALEB_FISH_EXCHANGE_MESSAGE_ID:
        if (quest.getStage(player) !== STAGE_SPOKEN_CALEB || !FISH.every((id) => has(player, id))) return;
        event.after = () => {
          if (quest.getStage(player) !== STAGE_SPOKEN_CALEB || !FISH.every((id) => has(player, id))) return;
          for (const id of FISH) player.getInventory().deleteNumber(id, 1);
          if (!has(player, CALEB_CREST)) player.getInventory().adds(CALEB_CREST, 1);
          quest.setStage(player, STAGE_CALEB_PIECE);
        };
        return;
      case CALEB_PIECE_RETURN_MESSAGE_ID:
        event.box = { items: [CALEB_CREST] };
        event.after = () => {
          if (!owns(player, CALEB_CREST) && !owns(player, FAMILY_CREST)) player.getInventory().adds(CALEB_CREST, 1);
        };
        return;
      case AVAN_JEWELLERY_MESSAGE_ID:
        event.after = () => {
          if (quest.getStage(player) !== STAGE_SPOKEN_BOOT) return;
          if (!has(player, PERFECT_RING) || !has(player, PERFECT_NECKLACE)) return;
          player.getInventory().deleteNumber(PERFECT_RING, 1);
          player.getInventory().deleteNumber(PERFECT_NECKLACE, 1);
          // Before the ids were put right Caleb gave 779; a save from then holds 779 as his piece, so Avan's is 780.
          if (!owns(player, AVAN_CREST)) player.getInventory().adds(AVAN_CREST, 1);
          else if (!owns(player, CALEB_CREST)) player.getInventory().adds(CALEB_CREST, 1);
          quest.setStage(player, STAGE_AVAN_PIECE);
        };
        return;
      case CREST_HAND_IN_MESSAGE_ID:
        event.after = () => {
          if (!DIMINTHEIS_NPC_IDS.has(npcId) || quest.getStage(player) !== STAGE_CURED_JOHNATHON) return;
          if (player.getAttribute(CREST_HANDED_ATTRIBUTE) === true) return;
          if (!has(player, FAMILY_CREST)) return;
          player.getInventory().deleteNumber(FAMILY_CREST, 1);
          player.setAttribute(CREST_HANDED_ATTRIBUTE, true);
        };
        return;
      case CREST_PIECES_HAND_IN_MESSAGE_ID:
        event.after = () => {
          if (!DIMINTHEIS_NPC_IDS.has(npcId) || quest.getStage(player) !== STAGE_CURED_JOHNATHON) return;
          if (!CREST_PARTS.every((id) => has(player, id))) return;
          for (const id of CREST_PARTS) player.getInventory().deleteNumber(id, 1);
          player.setAttribute(CREST_HANDED_ATTRIBUTE, true);
        };
        return;
      default:
        return;
    }
  }

  /**
   * Johnathon's questions after the cure (2037-2052): the first menu leaves out "I will be on my way now.", and each
   * later one leaves out the question just asked (the others come back).
   */
  function shapeMenu(notice) {
    if (!notice?.player) return;
    // Ours: before Family Pest starts no recording shows a son's "Family Pest" entry; his own page's
    // gauntlets talk plays as it does with steel gauntlets (straight in).
    if (sonOf(notice.npcId) && !familyPestStarted(notice.player) && quest.isComplete(notice.player)) {
      const entries = (notice.options ?? []).map((option) => option.text);
      if (entries.length === 2 && entries[0] === "Family Pest" && entries[1] === "Gauntlets") notice.select = notice.options[1];
      return;
    }
    if (!JOHNATHON_NPC_IDS.has(notice.npcId)) return;
    const options = notice.options ?? [];
    if (!options.some((option) => option.text === JOHNATHON_LEAVE_OPTION) || options.length < 4) return;
    const left = options.some((option) => option.text === notice.chosen) ? notice.chosen : JOHNATHON_LEAVE_OPTION;
    notice.options = options.filter((option) => option.text !== left);
  }

  /** "[steel/goldsmithing/cooking/chaos]": the pair that came back to Dimintheis. */
  function fillGauntletName(event) {
    if (!DIMINTHEIS_NPC_IDS.has(event.npcId)) return;
    const text = String(event.text ?? "");
    if (!text.includes("[steel/goldsmithing/cooking/chaos]")) return;
    const lost = Number(event.player.getAttribute(GAUNTLETS_ATTRIBUTE)) || STEEL_GAUNTLETS;
    event.text = text.replace("[steel/goldsmithing/cooking/chaos]", GAUNTLET_NAMES.get(lost) ?? "steel");
  }

  /** The sons imbue the gauntlets: free for plain steel ones, 25,000 coins to change an imbued pair. */
  function handleGauntletImbue(event) {
    const { player, stepId } = event;
    if (stepId === GAUNTLETS_RETURNED_MESSAGE_ID && DIMINTHEIS_NPC_IDS.has(event.npcId)) {
      const lost = Number(player.getAttribute(GAUNTLETS_ATTRIBUTE)) || STEEL_GAUNTLETS;
      event.box = { items: [lost] };
      if (ownedGauntlets(player).length === 0) player.getInventory().adds(lost, 1);
      return;
    }
    const imbue = IMBUE_STEPS.get(stepId);
    if (!imbue) return;
    const inventory = player.getInventory();
    const source = (imbue.free ? [STEEL_GAUNTLETS] : GAUNTLETS.filter((id) => id !== imbue.target)).find((id) => has(player, id));
    const refuse = (message) => {
      player.sendMessage(message);
      event.handled = true;
      event.end = true;
    };
    if (source === undefined) return refuse("You don't have any gauntlets for them to imbue.");
    if (!imbue.free && !has(player, ItemIdentifiers.COINS, GAUNTLET_CHANGE_COST)) {
      return refuse("You need 25,000 coins to change your gauntlets.");
    }
    event.box = { items: [imbue.target] };
    if (!imbue.free) inventory.deleteNumber(ItemIdentifiers.COINS, GAUNTLET_CHANGE_COST);
    inventory.deleteNumber(source, 1);
    inventory.adds(imbue.target, 1);
    player.setAttribute(GAUNTLETS_ATTRIBUTE, imbue.target);
  }

  /**
   * Live prints "Chronozon weakens..." on each Blast spell at him, on the cast's own tick, repeats included (2441-2474,
   * 2864-2893). The Wiki: he has to be hit for actual damage (a splash doesn't count), so the queued hit's roll and
   * damage decide.
   */
  function handleHitQueued({ player, target, hit }) {
    if (target?.isNpc?.() !== true || target.getId?.() !== NpcIdentifiers.CHRONOZON) return;
    if (hit?.getCombatType?.() !== CombatType.MAGIC || hit.isAccurate?.() !== true || !(hit.getTotalDamage?.() > 0)) return;
    if (!BLAST_SPELL_ELEMENTS.has(hit.getSpell?.()?.spellId?.())) return;
    player.sendMessage("Chronozon weakens...");
  }

  /** Wiki: Chronozon can only die once each of the four Blast spells has hit him; the hits are tracked per player. */
  function handleNpcHitModify({ npc, hit }) {
    if (npc?.getId?.() !== NpcIdentifiers.CHRONOZON) return;
    // The Wiki: he has to be hit, for actual damage; the same hit the message announced (handleHitQueued).
    if (hit?.getCombatType?.() !== CombatType.MAGIC || hit.isAccurate?.() !== true || !(hit.getTotalDamage?.() > 0)) return;
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.() !== true) return;
    const player = attacker.getAsPlayer();
    const element = BLAST_SPELL_ELEMENTS.get(hit.getSpell?.()?.spellId?.());
    if (!element) return;
    let weakened = weakenedByPlayer.get(player);
    if (!weakened) {
      weakened = new Set();
      weakenedByPlayer.set(player, weakened);
    }
    weakened.add(element);
  }

  /**
   * Wiki: unless all four Blast spells have hit him, Chronozon returns to full health when nearly dead. Live says
   * "Chronozon regenerates..." the tick after the hit that emptied his health bar (2477 -> 2478).
   */
  function keepChronozonUp(event) {
    const { npc } = event;
    if (npc?.getId?.() !== NpcIdentifiers.CHRONOZON) return;
    const killer = npc.getCombat?.()?.getKiller?.(false);
    if (killer && weakenedByPlayer.get(killer)?.size >= BLAST_SPELL_ELEMENTS.size) return;
    event.preventDeath = true;
    npc.setHitpoints(npc.getDefinition().getHitpoints());
    npc.getCombat?.()?.reset?.();
    const player = killer?.isPlayer?.() ? killer.getAsPlayer?.() ?? killer : null;
    if (player) api.core.TaskManager.submit(new api.core.CountdownTask(player, 1, () => player.sendMessage("Chronozon regenerates...")));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  // The 3 November 2026 update's quest XP (Wiki: Update:Quest Month Kick Off, TFA Tweaks & More),
  // paid on completion; held back for a completion not played through (experience: false).
  const COMPLETION_XP = [[api.core.Skill.MINING, 2000, "Mining"], [api.core.Skill.SMITHING, 2000, "Smithing"], [api.core.Skill.CRAFTING, 2000, "Crafting"]];
  function grantCompletionXp(player, _quest, options = {}) {
    if (options.experience === false) return;
    for (const [skill, amount] of COMPLETION_XP) player.getSkillManager().addExperiences(skill, amount);
  }

  quest = registerQuest(api, {
    key: "family_crest",
    name: "Family Crest",
    varpId: VARP_FAMILY_CREST,
    startedValue: STAGE_SPOKEN_DIMINTHEIS,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: COMPLETION_XP.map(([skill, amount, label]) => ({ skillId: skill.getIndex(), amount, label })),
    rewardItemId: ItemIdentifiers.STEEL_GAUNTLETS,
    // The scroll's lines (tick 3033).
    rewardItemLabel: "Some Steel Gauntlets",
    otherRewards: ["Gauntlet Skill Imbues"],
    buildJournal,
    onReward: grantCompletionXp,
  });

  api.persistAttribute(GAUNTLETS_ATTRIBUTE, 0);
  api.persistAttribute(CREST_HANDED_ATTRIBUTE, false);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", fillGauntletName);
  api.onCustomEvent("npc-dialogue:menu", shapeMenu);
  api.onCustomEvent("npc-dialogue:action", handleGauntletImbue);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcInteraction("Caleb", { Gauntlets: gauntletsOption });
  api.onNpcInteraction("Avan", { Gauntlets: gauntletsOption });
  api.onNpcInteraction("Johnathon", { Gauntlets: gauntletsOption });
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("mining:ore-yield", handleOreYield);
  api.onCustomEvent("combat:hit-queued", handleHitQueued);
  api.onNpcHitModify(handleNpcHitModify);
  api.onNpcBeforeDeath(keepChronozonUp);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("npc-drops:roll", filterChronozonDrops);
  api.onPlayerLogin(handleLogin);
  require("./WitchavenPuzzle.FamilyCrest").attach(api);
};
