/**
 * The Depths of Despair (members).
 *
 * The words come from the "The Depths of Despair" transcript page (plus the
 * QuestRuntime's transcript replay for the cave obstacles). This plugin supplies
 * the per-stage variant selector for the family and Galana, the start hook, the
 * prose-condition answers, the Arceuus Library book search, the Crabclaw Caves
 * traversal, the Sand Snake fight and the completion reward.
 *
 * Stages (varp 1671 "hosidiusquest_main", varbit 6027 "hosidiusquest" bits 0-5,
 * from scripts/lookup-gameval.ts; the wiki publishes no numeric stage values, this
 * is the natural transcript order and fits the 6-bit field):
 *   1 started, 2 spoke to Chef Olivia, 3 spoke to Galana (book bay assigned),
 *   4 read the Envoy to Varlamore - the Read action alone sets this and it is
 *   what opens the Crabclaw Caves (finding the book does not advance the stage),
 *   5 met Artur in the caves, 6 killed the Sand Snake, 7 looted the Royal
 *   Accord, 8 Artur returned home, 9 complete.
 * The durable stages 5-9 are sent as the Quest Helper/cache varbit values
 * 8, 9, 10, 10 and 11; script 4029 marks 6027 complete at >= 11. The wire
 * names the next action, so the caves are worth 6 (descend) and 7 (Artur)
 * while the durable stage is still 4, and each leg turns one step further on.
 * Varbit 6028 "hosidiusquest_reward" (bit 6) is set on completion; varbit 6029
 * "hosidiusquest_favour" (bit 7) is deliberately left alone (Kourend favour was
 * removed in 2024). Varbit 12153 "hosidiusquest_artur_vis" (bit 8) drives the
 * 7925->7898 house transform and is set when Artur goes home.
 *
 * Requirements (OSRS Wiki): Client of Kourend (asked through the shared
 * "quest:is-complete" event, so it reads false until that quest is complete) and
 * 18 Agility, not boostable - checked against the base level.
 *
 * Rewards (OSRS Wiki): 1 Quest Point, 1,500 Agility XP, 4,000 coins, the
 * "Lunch by the Lancalliums" page for Kharedst's memoirs, the Hosidius graceful
 * recolour and the Nightmare Zone Sand Snake unlock.
 *
 * Cave objects (cache dump at 1639-1721, 9746-9849; RuneLite gameval names in
 * brackets): 31690 Cave [HOSIDIUSQUEST_CAVE_ENTRANCE] at 1644,3449, 31691 Sand
 * pile [CAVE_EXIT], 31692 Tunnel entrance [ROPE_TOP], 31693 Rope [ROPE_BOTTOM],
 * 31695/31696 Crevice [CRACKIN/CRACKOUT], 31697/31698 Rocks [ROCK/ROCK_SNAKE],
 * 31699 Stepping stone [STONE] and 31703 Chest at 1700,9753. The instanced part
 * of the OSRS caves is a shared map here; Artur (7898) and the Sand Snake (7903)
 * are owner-only plugin spawns, so nobody else sees or fights them.
 *
 * Gaps/approximations:
 * - OSRS pins one random bookshelf per player; here Galana names a random floor
 *   and quadrant and any shelf in it works. Wrong-shelf searches use the generic
 *   lines from "Transcript:Bookcase" (the quest pack has no ordinary-search text).
 * - Crossing the stepping stones and climbing the rocks always succeed at the
 *   quest's 18 Agility requirement; the wiki's fall branches are answered but
 *   cannot be reached without the starting requirement.
 * - Palace/King variants of the family (A Kingdom Divided) are out of scope;
 *   the Lord is only shared with A Kingdom Divided in the stage ranges that
 *   quest actually owns him in, and with AKD unset the house spawns resolve to
 *   the working Talk-to ids.
 * - The journal lines are written here (the wiki publishes no journal text).
 */
module.exports = function registerDepthsOfDespairQuest(api) {
  const {
    DialogueChainBuilder,
    EndDialogue,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    StatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Depths of Despair";
  const START_HOOK = "quest:the-depths-of-despair:start";
  const AKD_KEY = "a_kingdom_divided";
  const AKD_STAGE_COMPLETE = 150;

  const VARP_HOSIDIUS_QUEST = 1671; // "hosidiusquest_main"
  const VARBIT_HOSIDIUS_QUEST = 6027; // "hosidiusquest" bits 0-5
  const VARBIT_HOSIDIUS_REWARD = 6028; // "hosidiusquest_reward" bit 6
  const VARBIT_ARTUR_HOME = 12153; // "hosidiusquest_artur_vis" bit 8
  const VARBIT_PAGE_ADDED = 7918; // "kourend_diary_hos_teleport" bit in varp 2087
  const MEMOIR_PAGE_ADDED_ATTRIBUTE = "depths-of-despair:memoir-page-added";

  const STAGE_STARTED = 1;
  const STAGE_OLIVIA = 2;
  const STAGE_GALANA = 3;
  const STAGE_READ_BOOK = 4;
  const STAGE_MET_ARTUR = 5;
  const STAGE_SNAKE_KILLED = 6;
  const STAGE_ACCORD_LOOTED = 7;
  const STAGE_ARTUR_HOME = 8;
  const STAGE_COMPLETE = 9;

  // Quest Helper loadSteps() keys are the cache varbit values: 0 Lord, 1
  // Olivia, 2 Galana, 3 find/read the Envoy, 4 enter the caves, 6 lower caves,
  // 7 talk to Artur, 8 kill the snake, 9 loot the chest, 10 return to Lord.
  // The cache's script 4029 only marks varbit 6027 complete at 11 (`>= 11`),
  // which the final hand-in reaches. The wire names the NEXT action, so the
  // durable dialogue stages (which are already behind the player) map one step
  // further on: met Artur -> kill the snake (8), snake killed -> chest (9),
  // chest emptied -> return to the Lord (10), Artur home -> the Lord (10),
  // complete -> 11. Inside the caves the durable stage is still "read the
  // Envoy" (4), so the location adds the two native cave values: 6 for the
  // descent and 7 for the chamber where Artur waits.
  const WIRE_ENTER_CAVES = 4;
  const WIRE_LOWER_CAVES = 6;
  const WIRE_ARTUR = 7;
  const CANONICAL_WIRE_BY_STAGE = { 5: 8, 6: 9, 7: 10, 8: 10, 9: 11 };

  /** The native wire value for a durable stage, following the player's location. */
  function wireValue(stage, player) {
    if (stage <= STAGE_GALANA) return stage;
    if (stage === STAGE_READ_BOOK) {
      const location = player?.getLocation?.();
      if (inZone(CAVE_CHAMBER_ZONE, location)) return WIRE_ARTUR;
      if (inZone(CAVE_ZONE, location)) return WIRE_LOWER_CAVES;
      return WIRE_ENTER_CAVES;
    }
    return CANONICAL_WIRE_BY_STAGE[stage] ?? stage;
  }

  const AGILITY_REQUIREMENT = 18;

  // House spawns are nameless transform parents; getContentId resolves these.
  const LORD_NPC_IDS = new Set([
    NpcIdentifiers.LORD_KANDUR_HOSIDIUS, // 10966
    NpcIdentifiers.LORD_KANDUR_HOSIDIUS_3, // 10971
    NpcIdentifiers.LORD_KANDUR_HOSIDIUS_4, // 11033 - house 11143 resolves here
  ]);
  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA_HOSIDIUS, // 10982
    NpcIdentifiers.ELENA_HOSIDIUS_3, // 11034 - house 11144 resolves here
  ]);
  const ARTUR_NPC_IDS = new Set([
    NpcIdentifiers.ARTUR_HOSIDIUS, // 7898 - cave spawn and 7925 house transform
    NpcIdentifiers.ARTUR_HOSIDIUS_2, // 7899
  ]);
  const BUTLER_NPC_ID = NpcIdentifiers.BUTLER_JARVIS; // 7900
  const OLIVIA_NPC_ID = NpcIdentifiers.CHEF_OLIVIA; // 7901
  const GALANA_NPC_ID = NpcIdentifiers.GALANA; // 7902
  const CAVE_SON_NPC_ID = NpcIdentifiers.ARTUR_HOSIDIUS; // 7898 HOSIDIUSQUEST_SON
  const SAND_SNAKE_NPC_ID = NpcIdentifiers.SAND_SNAKE_2; // 7903 HOSIDIUSQUEST_SNAKE
  const QUEST_SPEAKER_NPC_IDS = new Set([
    ...LORD_NPC_IDS,
    ...ELENA_NPC_IDS,
    ...ARTUR_NPC_IDS,
    BUTLER_NPC_ID,
    OLIVIA_NPC_ID,
    GALANA_NPC_ID,
  ]);

  const VARLAMORE_ENVOY_ITEM_ID = ItemIdentifiers.VARLAMORE_ENVOY; // 21756
  const ROYAL_ACCORD_ITEM_ID = ItemIdentifiers.ROYAL_ACCORD_OF_TWILL; // 21758
  const LANCALLIUMS_PAGE_ITEM_ID = ItemIdentifiers.LUNCH_BY_THE_LANCALLIUMS; // 21762
  const MEMOIRS_ITEM_IDS = new Set([
    ItemIdentifiers.KHAREDSTS_MEMOIRS, // 21760
    ItemIdentifiers.KHAREDSTS_MEMOIRS_2, // 21761
  ]);
  const MEMOIRS_ITEM_ID = ItemIdentifiers.KHAREDSTS_MEMOIRS; // 21760
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995

  const CAVE_ENTRANCE_OBJECT_ID = ObjectIdentifiers.CAVE_58; // 31690
  const SAND_PILE_OBJECT_ID = ObjectIdentifiers.SAND_PILE_2; // 31691
  const TUNNEL_ENTRANCE_OBJECT_ID = ObjectIdentifiers.TUNNEL_ENTRANCE_2; // 31692
  const ROPE_OBJECT_ID = ObjectIdentifiers.ROPE_8; // 31693
  const CREVICE_IN_OBJECT_ID = ObjectIdentifiers.CREVICE_31; // 31695
  const CREVICE_OUT_OBJECT_ID = ObjectIdentifiers.CREVICE_32; // 31696
  const UPPER_ROCKS_OBJECT_ID = ObjectIdentifiers.ROCKS_33; // 31697
  const LOWER_ROCKS_OBJECT_ID = ObjectIdentifiers.ROCKS_34; // 31698
  const STEPPING_STONE_OBJECT_ID = ObjectIdentifiers.STEPPING_STONE_38; // 31699
  const CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_109; // 31703

  const BOOK_BAY_ATTRIBUTE = "quest.the-depths-of-despair.book-bay";

  const HOSIDIUS_HOUSE_ZONE = { minX: 1770, maxX: 1800, minY: 3555, maxY: 3585, levels: [0, 1, 2] };
  const LIBRARY_ZONE = { minX: 1600, maxX: 1665, minY: 3780, maxY: 3835, levels: [0, 1, 2] };
  const CAVE_ZONE = { minX: 1630, maxX: 1730, minY: 9720, maxY: 9870, levels: [0, 1] };
  // The lower chamber (Artur, the Sand Snake and the chest); the Quest Helper's
  // "downstairs in the caves" zone, which is where the native wire is 7.
  const CAVE_CHAMBER_ZONE = { minX: 1670, maxX: 1701, minY: 9742, maxY: 9763, levels: [0, 1] };

  // Library shelf bounds: x 1607-1658, y 3784-3831, planes 0-2.
  const LIBRARY_CENTER_X = 1633;
  const LIBRARY_CENTER_Y = 3808;

  const CAVE_ENTRY_TILE = { x: 1646, y: 9847 };
  const CAVE_SURFACE_TILE = { x: 1644, y: 3448 };
  const CAVE_ARTUR_TILE = { x: 1681, y: 9748 };
  const CAVE_SNAKE_TILE = { x: 1694, y: 9750 };
  const LOWER_CHAMBER_TILE = { x: 1678, y: 9748 };
  const UPPER_CAVE_TILE = { x: 1671, y: 9800 };
  const CREVICE_SOUTH_TILE = { x: 1712, y: 9819 };
  const CREVICE_NORTH_TILE = { x: 1711, y: 9825 };
  const STONES_WEST_TILE = { x: 1701, y: 9800 };
  const STONES_EAST_TILE = { x: 1709, y: 9800 };
  const UPPER_ROCKS_WEST_TILE = { x: 1686, y: 9801 };
  const UPPER_ROCKS_EAST_TILE = { x: 1690, y: 9801 };
  const LOWER_ROCKS_WEST_TILE = { x: 1684, y: 9754 };
  const LOWER_ROCKS_EAST_TILE = { x: 1692, y: 9752 };

  const WRONG_SHELF_LINES = [
    "None of them look very interesting.",
    "You find nothing to interest you.",
    "You don't find anything you'd ever want to read.",
  ];

  // Transcript:Varlamore Envoy, kept verbatim (one message box per paragraph).
  const BOOK_PARAGRAPHS = [
    "Although it has been many years since the fighting ended, the war with Varlamore remains fresh in the minds of Kourend's people. The betrayal of Emperor Imafore is hard to forget and it is likely that this mistrust will continue for numerous lifetimes.",
    "In the hope of repairing the relationship with Varlamore, King Kharedst III ordered an envoy be sent to the Shining Kingdom. However, the envoy is not all that was sent.",
    "For over one hundred decades the original Royal Accord of Twill was kept safe within the Historical Archive of Kourend. The Accord survived the Long Winter, the Age of Strife and the War of the Five Houses but it did not survive the foolishness of our great King Kharedst.",
    "Despite the protests of many, the King insisted that the Accord be taken with the envoy to Varlamore to be displayed in the Grand Museum of Civitas illa Fortis. Alas, the Accord never made it to Varlamore.",
    "It was day 1,372 of the 135th decade when they departed. They left by ship from Port Piscarilius for the week long journey to the Civitas Port.",
    "Less than half way into the journey, disaster struck. The ship was travelling off the south coast of Kourend, when it was caught up in a great storm. The ship, the crew and the Accord itself were all lost beneath the waves. The only survivor was the envoy himself, saved by some passing fishermen.",
    "Following the loss of the Accord, the King ordered a great search be conducted in an attempt to recover it. For over fourty years, searches were conducted both above and below the waves in an attempt to find the Accord. Despite the efforts of many, it was never found.",
    "Many years later, rulership of Kourend was transferred to the Kourend Council. Not long after the Council took over, the search for the Accord was finally called off.",
    "Over time, the Accord was mostly forgotten, but there were still some who desired to see it return to Kourend. Many years after the search ended, a new lead was found. Not far from Land's End, a set of caves were discovered that led deep below the sea.",
    "Those searching for the Accord theorised that the ship may have sunk beneath the seabed and into the caves below. They assembled a search party and entered the caves.",
    "Alas, the search party consisted of historians, not adventurers. They were poorly equipped to face the perils of those caves. Of those who entered, only two returned, and the search for the Accord was once again over.",
    "Perhaps it is meant to be this way, perhaps the Accord was meant to stay lost. However, this may not be the end of the story. All it would need is for an adventurer to enter those caves and reach the bottom and the Accord may yet return to Kourend.",
  ];

  let quest;
  const caveEncounters = new Map();
  /** One-shot teleport per obstacle click, consumed by the message step. */
  const pendingMoves = new WeakMap();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function bankHasItem(player, itemId) {
    if (typeof player.getBanks === "function") {
      const banks = player.getBanks() ?? [];
      if (banks.some((bank) => bank?.getAmount?.(itemId) > 0)) return true;
    }
    return (player.getBank?.()?.getAmount?.(itemId) ?? 0) > 0;
  }

  const ownsItem = (player, itemId) => held(player, itemId) || bankHasItem(player, itemId);

  function pageAddedToMemoir(player) {
    return Number(player.getAttribute(MEMOIR_PAGE_ADDED_ATTRIBUTE)) > 0 ||
      (player.getPacketSender().getVarbit?.(VARBIT_PAGE_ADDED) ?? 0) !== 0;
  }

  /** The lost-page branch only applies before the page is recorded in the memoir. */
  function lostLunchPage(player) {
    return quest.getStage(player) >= STAGE_COMPLETE &&
      !ownsItem(player, LANCALLIUMS_PAGE_ITEM_ID) &&
      ownsItem(player, MEMOIRS_ITEM_ID) &&
      !pageAddedToMemoir(player);
  }

  function tileOf(value) {
    if (!value) return null;
    return typeof value.getX === "function"
      ? { x: value.getX(), y: value.getY(), z: value.getZ() }
      : { x: value.x, y: value.y, z: value.z ?? 0 };
  }

  function inZone(zone, value) {
    const tile = tileOf(value);
    return Boolean(tile) && tile.x >= zone.minX && tile.x <= zone.maxX &&
      tile.y >= zone.minY && tile.y <= zone.maxY &&
      (!zone.levels || zone.levels.includes(tile.z));
  }

  function clientOfKourendComplete(player) {
    const request = { player, key: "client_of_kourend", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function otherQuestStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number.isFinite(request.stage) ? request.stage | 0 : 0;
  }

  /**
   * A Kingdom Divided only claims Lord Kandur in its own stage ranges
   * (AKingdomDivided.Quest.js: STAGE_HOUSES..STAGE_LOOKOUT 110-118,
   * STAGE_MEETING..STAGE_ACCORD 122-137, STAGE_ACCORD..STAGE_ARREST 138-145
   * and STAGE_ARREST..STAGE_COMPLETE 146-149). Outside them A Kingdom
   * Divided declines the Lord and he falls back to his generic transcript,
   * which has neither the Depths start option nor its hand-in, so the quest
   * could neither be started nor finished while it was in progress.
   */
  const AKD_LORD_STAGE_WINDOWS = [[110, 119], [122, 138], [138, 146], [146, 150]];

  function akdOwnsLord(player) {
    const stage = otherQuestStage(player, AKD_KEY);
    return AKD_LORD_STAGE_WINDOWS.some(([from, to]) => stage >= from && stage < to);
  }

  const akdComplete = (player) => otherQuestStage(player, AKD_KEY) >= AKD_STAGE_COMPLETE;

  function meetsRequirements(player) {
    if (player.getSkillManager().getMaxLevel(Skill.AGILITY) < AGILITY_REQUIREMENT) return false;
    return clientOfKourendComplete(player);
  }

  function canCross(player) {
    return player.getSkillManager().getMaxLevel(Skill.AGILITY) >= AGILITY_REQUIREMENT;
  }

  function syncArturVisibility(player) {
    const home = quest.getStage(player) >= STAGE_ARTUR_HOME;
    player.getPacketSender().sendVarbit(VARBIT_ARTUR_HOME, home ? 1 : 0);
  }

  // ==========================================================================
  // Dialogue variants
  // ==========================================================================

  function selectLordVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) return "starting-off";
    if (stage >= STAGE_COMPLETE) {
      return lostLunchPage(player)
        ? "if-the-player-lost-the-memoir-page-before-using-it-on-the-memoir"
        : "standard-dialogue";
    }
    if (stage >= STAGE_ARTUR_HOME) return "finishing-up-returning-to-lord-hosidius";
    return "starting-off-talking-to-lord-hosidius-again";
  }

  function selectJarvisVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) return "before-completing-the-depths-of-despair";
    if (stage >= STAGE_COMPLETE) return "after-completing-the-depths-of-despair";
    if (stage >= STAGE_ARTUR_HOME) return "finishing-up-talking-to-butler-jarvis-after-artur-returns";
    if (stage >= STAGE_OLIVIA) return "starting-off-talking-to-butler-jarvis-again";
    return "starting-off-talking-to-butler-jarvis";
  }

  function selectOliviaVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) return "standard-dialogue-before-starting-the-depths-of-despair";
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-completing-the-depths-of-despair";
    if (stage >= STAGE_ARTUR_HOME) return "finishing-up-talking-to-chef-olivia-after-artur-returns";
    if (stage >= STAGE_OLIVIA) return "starting-off-talking-to-chef-olivia-talking-to-chef-olivia-again";
    return "starting-off-talking-to-chef-olivia";
  }

  function selectElenaVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) return "standard-dialogue-before-completing-the-depths-of-despair";
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-completing-the-depths-of-despair";
    if (stage >= STAGE_ARTUR_HOME) return "finishing-up-talking-to-elena-hosidius-after-artur-returns";
    return "starting-off-talking-to-elena-hosidius";
  }

  function selectGalanaVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-the-depths-of-despair";
    if (stage <= STAGE_STARTED) return "before-the-depths-of-despair";
    if (stage === STAGE_OLIVIA) return "the-envoy-to-varlamore-talking-to-galana";
    return "the-envoy-to-varlamore-talking-to-galana-talking-to-galana-again";
  }

  function selectArturVariant(player, tile) {
    const stage = quest.getStage(player);
    if (tile && tile.y > 9000) {
      if (stage === STAGE_READ_BOOK) return "the-envoy-to-varlamore-talking-to-artur-hosidius";
      if (stage === STAGE_MET_ARTUR) return "the-envoy-to-varlamore-talking-to-artur-hosidius-talking-to-artur-hosidius-again";
      if (stage === STAGE_SNAKE_KILLED) return "the-envoy-to-varlamore-talking-to-artur-hosidius-after-killing-the-snake";
      if (stage === STAGE_ACCORD_LOOTED) return "the-envoy-to-varlamore-after-emptying-the-chest";
      return null;
    }
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-the-completion-of-the-depths-of-despair";
    if (stage >= STAGE_ARTUR_HOME) return "finishing-up-talking-to-artur";
    return null; // hidden before he returns home (transform varbit 12153)
  }

  function selectVariant({ npcId, player, npc }) {
    const tile = tileOf(npc?.getLocation?.());
    // The dialogue test drives the selector without an NPC object; trust the id then.
    const at = (zone) => !npc || inZone(zone, tile);
    if (LORD_NPC_IDS.has(npcId)) {
      if (!at(HOSIDIUS_HOUSE_ZONE)) return null;
      // A Kingdom Divided's Lord Kandur story owns the conversation while active.
      return akdOwnsLord(player) ? null : selectLordVariant(player);
    }
    if (ELENA_NPC_IDS.has(npcId)) {
      if (!at(HOSIDIUS_HOUSE_ZONE)) return null;
      if (akdComplete(player)) return "standard-dialogue-after-completing-a-kingdom-divided";
      return selectElenaVariant(player);
    }
    if (npcId === BUTLER_NPC_ID) {
      if (!at(HOSIDIUS_HOUSE_ZONE)) return null;
      return akdComplete(player) ? "after-completing-a-kingdom-divided" : selectJarvisVariant(player);
    }
    if (npcId === OLIVIA_NPC_ID) {
      if (!at(HOSIDIUS_HOUSE_ZONE)) return null;
      return akdComplete(player) ? "standard-dialogue-after-completing-a-kingdom-divided" : selectOliviaVariant(player);
    }
    if (npcId === GALANA_NPC_ID) {
      return at(LIBRARY_ZONE) ? selectGalanaVariant(player) : null;
    }
    if (ARTUR_NPC_IDS.has(npcId)) {
      if (!npc || inZone(CAVE_ZONE, tile)) return selectArturVariant(player, tile);
      if (!inZone(HOSIDIUS_HOUSE_ZONE, tile)) return null;
      return akdComplete(player) ? "standard-dialogue-after-the-completion-of-a-kingdom-divided" : selectArturVariant(player, tile);
    }
    return null;
  }

  /** The wiki prose conditions, keyed off their step ids on the quest page. */
  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case "Kac5Aj":
        return !meetsRequirements(player);
      case "TrbpPj":
        return meetsRequirements(player);
      case "ke_p6B":
        return !held(player, ROYAL_ACCORD_ITEM_ID);
      case "AsCy-M":
      case "eYGFOA":
        return held(player, ROYAL_ACCORD_ITEM_ID);
      case "VGsYqW":
      case "5rX0VQ":
        return player.getInventory().isFull();
      case "WQKVh4":
        return held(player, VARLAMORE_ENVOY_ITEM_ID);
      case "EUo3pD":
      case "ksSr_q":
        return canCross(player);
      case "XoOOyn":
      case "sn3VWw":
        return !canCross(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Book bay
  // ==========================================================================

  function randomBookBay() {
    return {
      floor: Math.floor(Math.random() * 3),
      north: Math.random() < 0.5,
      east: Math.random() < 0.5,
    };
  }

  function storeBookBay(player, bay) {
    player.setAttribute(BOOK_BAY_ATTRIBUTE, `${bay.floor}|${bay.north ? "n" : "s"}|${bay.east ? "e" : "w"}`);
  }

  function loadBookBay(player) {
    const raw = String(player.getAttribute(BOOK_BAY_ATTRIBUTE) ?? "");
    const [floor, northSouth, eastWest] = raw.split("|");
    if (!/^[0-2]$/.test(floor) || !/^[ns]$/.test(northSouth) || !/^[ew]$/.test(eastWest)) {
      const bay = randomBookBay();
      storeBookBay(player, bay);
      return bay;
    }
    return { floor: Number(floor), north: northSouth === "n", east: eastWest === "e" };
  }

  function assignBookBay(player) {
    storeBookBay(player, randomBookBay());
    if (quest.getStage(player) === STAGE_OLIVIA) quest.setStage(player, STAGE_GALANA);
  }

  function shelfMatchesBay(location, player) {
    const bay = loadBookBay(player);
    if (location.z !== bay.floor) return false;
    const north = location.y >= LIBRARY_CENTER_Y;
    const east = location.x >= LIBRARY_CENTER_X;
    return north === bay.north && east === bay.east;
  }

  function bookBayHint(player) {
    const bay = loadBookBay(player);
    const floor = bay.floor === 0 ? "bottom" : bay.floor === 1 ? "middle" : "top";
    return { floor, northSouth: bay.north ? "north" : "south", eastWest: bay.east ? "eastern" : "western" };
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0 || !meetsRequirements(player)) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueLine(event) {
    const { player, npcId } = event;
    let text = String(event.text ?? "");
    if (QUEST_SPEAKER_NPC_IDS.has(npcId) && text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(player.getUsername()));
      event.text = text;
    }
    if (LORD_NPC_IDS.has(npcId) &&
      text.includes("I assume you're after that reward I promised you") &&
      lostLunchPage(player)) {
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() < 1) {
        player.sendMessage("You need a free inventory slot to take the memoir page.");
      } else {
        inventory.adds(LANCALLIUMS_PAGE_ITEM_ID, 1);
      }
    }
    if (npcId === OLIVIA_NPC_ID) {
      if (text.includes("He's been spending a lot of time in the Arceuus Library recently") &&
        quest.getStage(player) === STAGE_STARTED) {
        quest.setStage(player, STAGE_OLIVIA);
      }
      return;
    }
    if (npcId === GALANA_NPC_ID) {
      if (text.includes("It details how the original Accord was lost")) {
        assignBookBay(player);
        return;
      }
      if (text.includes("[top/middle/bottom]")) {
        const hint = bookBayHint(player);
        event.text = text
          .replace("[top/middle/bottom]", hint.floor)
          .replace("[north/south]", hint.northSouth)
          .replace("[eastern/western]", hint.eastWest);
      }
      return;
    }
    if (ARTUR_NPC_IDS.has(npcId) && inZone(CAVE_ZONE, tileOf(event.npc?.getLocation?.()))) {
      if (text.startsWith("Typical. Fine, I'll kill the snake")) {
        if (quest.getStage(player) === STAGE_READ_BOOK) quest.setStage(player, STAGE_MET_ARTUR);
        return;
      }
      if (text.startsWith("Eugh. Fine, I'll go home")) {
        if (quest.getStage(player) === STAGE_ACCORD_LOOTED) sendArturHome(player);
      }
    }
  }

  function sendArturHome(player) {
    quest.setStage(player, STAGE_ARTUR_HOME);
    syncArturVisibility(player);
    const tracked = caveEncounters.get(player);
    if (tracked?.son) {
      api.removeNpc(tracked.son);
      tracked.son = null;
    }
  }

  // ==========================================================================
  // Cave traversal and chest (transcript messages carry the words)
  // ==========================================================================

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z ?? 0));
  }

  /**
   * Starts an obstacle transcript whose message step owns one teleport. The
   * destination is captured now, at click time, and consumed once when the
   * message is emitted (the runtime emits message steps once; the one-shot map
   * also keeps the directional moves safe under any duplicate emission).
   */
  function startMoveTranscript(player, variant, destination) {
    pendingMoves.set(player, destination);
    if (!startTranscript(api, player, CAVE_SON_NPC_ID, PAGE, variant)) {
      pendingMoves.delete(player);
    }
  }

  function creviceDestination(player) {
    return player.getLocation().getY() >= 9822 ? CREVICE_SOUTH_TILE : CREVICE_NORTH_TILE;
  }

  function stonesDestination(player) {
    return player.getLocation().getX() > 1705 ? STONES_WEST_TILE : STONES_EAST_TILE;
  }

  /**
   * The stepping stones are a water crossing, not a floor object that can be
   * reached by walking onto its clipped tile. Let the normal Cross action run
   * from either authored bank; its transcript owns the actual crossing.
   */
  function routeSteppingStone(event) {
    if (event.objectId !== STEPPING_STONE_OBJECT_ID || event.clickType !== 1) return;
    const source = event.sourceLocation;
    const target = event.object?.getLocation?.();
    if (!source || !target || source.z !== 0 || target.getZ() !== 0) return;
    const bank = source.x > 1705 ? STONES_EAST_TILE : STONES_WEST_TILE;
    const atStone = target.getY() === 9800 && [1704, 1706].includes(target.getX());
    if (atStone) {
      event.destination = { x: bank.x, y: bank.y, z: bank.z ?? 0 };
    }
  }

  function rocksDestination(player, lower) {
    const x = player.getLocation().getX();
    if (lower) return x > 1687 ? LOWER_ROCKS_WEST_TILE : LOWER_ROCKS_EAST_TILE;
    return x > 1688 ? UPPER_ROCKS_WEST_TILE : UPPER_ROCKS_EAST_TILE;
  }

  /** Consumes the click's one-shot teleport; returns false when there is none. */
  function applyPendingMove(player) {
    const destination = pendingMoves.get(player);
    if (!destination) return false;
    pendingMoves.delete(player);
    moveTo(player, destination);
    return true;
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "GL3IJy": // You climb down into the cave.
      case "liq8sV": // You squeeze through the crevice.
      case "oY3wLB": // You successfully make it to the other side.
      case "0QAGMq": // You climb over the rocks.
      case "Y4ZprR": // You climb down the rope.
      case "aXacAX": // You climb up the rope.
      case "IAW0EN": // You climb up the sand pile.
        if (applyPendingMove(player)) {
          // The move is the real action boundary: it decides whether the player
          // is on the surface (4), in the caves (6) or in Artur's chamber (7).
          publishWire(player);
          if (stepId === "Y4ZprR") ensureCaveNpcs(player);
        }
        return;
      case "r7iI2i": { // You take a copy.
        if (!held(player, VARLAMORE_ENVOY_ITEM_ID) && !player.getInventory().isFull()) {
          player.getInventory().adds(VARLAMORE_ENVOY_ITEM_ID, 1);
        }
        return;
      }
      case "b_bfNd": { // You search the chest and find the original Accord.
        if (!held(player, ROYAL_ACCORD_ITEM_ID) && !player.getInventory().isFull()) {
          player.getInventory().adds(ROYAL_ACCORD_ITEM_ID, 1);
          if (quest.getStage(player) < STAGE_ACCORD_LOOTED) quest.setStage(player, STAGE_ACCORD_LOOTED);
        }
        return;
      }
      case "2AuI1C": // Congratulations! Quest complete!
        handInAccord(player);
        event.handled = true;
        return;
      default:
    }
  }

  function handInAccord(player) {
    if (!held(player, ROYAL_ACCORD_ITEM_ID)) return;
    player.getInventory().deleteNumber(ROYAL_ACCORD_ITEM_ID, 1);
    player.getPacketSender().sendVarbit(VARBIT_HOSIDIUS_REWARD, 1);
    quest.complete(player);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    switch (objectId) {
      case CAVE_ENTRANCE_OBJECT_ID:
        event.handled = true;
        enterCave(player);
        return;
      case SAND_PILE_OBJECT_ID:
        event.handled = true;
        leaveCave(player);
        return;
      case TUNNEL_ENTRANCE_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-climbing-down-the-tunnel-entrance", LOWER_CHAMBER_TILE);
        return;
      case ROPE_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-climbing-up-the-rope", UPPER_CAVE_TILE);
        return;
      case CREVICE_IN_OBJECT_ID:
      case CREVICE_OUT_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-entering-the-crevice", creviceDestination(player));
        return;
      case STEPPING_STONE_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-crossing-the-stepping-stone", stonesDestination(player));
        return;
      case UPPER_ROCKS_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-climbing-the-rocks", rocksDestination(player, false));
        return;
      case LOWER_ROCKS_OBJECT_ID:
        event.handled = true;
        startMoveTranscript(player, "the-envoy-to-varlamore-climbing-the-rocks", rocksDestination(player, true));
        return;
      case CHEST_OBJECT_ID:
        event.handled = true;
        searchChest(player);
        return;
      default:
    }
  }

  function enterCave(player) {
    if (quest.getStage(player) < STAGE_READ_BOOK || quest.isComplete(player)) {
      player.sendMessage("You have no reason to go in there.");
      return;
    }
    startMoveTranscript(player, "the-envoy-to-varlamore-entering-the-cave", CAVE_ENTRY_TILE);
  }

  function leaveCave(player) {
    startMoveTranscript(player, "the-envoy-to-varlamore-climbing-out-of-the-caves", CAVE_SURFACE_TILE);
  }

  function searchChest(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      player.sendMessage("You have already recovered the Accord.");
      return;
    }
    if (stage < STAGE_SNAKE_KILLED) return;
    // The chest stays searchable after Artur goes home so a lost Accord can be
    // fetched again (Lord Hosidius: "Well go fetch it and bring it here.").
    // The transcript's own conditions still report an Accord already held.
    startTranscript(api, player, CAVE_SON_NPC_ID, PAGE, "the-envoy-to-varlamore-looting-the-chest");
  }

  /** The library shelves; the assigned floor and quadrant hold the Envoy. */
  function searchBookshelf(event) {
    const { player, location } = event;
    if (event.handled) return;
    if (quest.getStage(player) !== STAGE_GALANA) return false;
    if (!inZone(LIBRARY_ZONE, location)) return false;
    if (!shelfMatchesBay(location, player)) {
      player.sendMessage("You search the books.");
      player.sendMessage(WRONG_SHELF_LINES[Math.floor(Math.random() * WRONG_SHELF_LINES.length)]);
      return;
    }
    startTranscript(api, player, GALANA_NPC_ID, PAGE, "the-envoy-to-varlamore-searching-the-appropriate-bookshelf");
  }

  // ==========================================================================
  // Reading the Envoy
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (itemId !== VARLAMORE_ENVOY_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.handled = true;
    readBook(player);
    if (quest.getStage(player) === STAGE_GALANA) quest.setStage(player, STAGE_READ_BOOK);
  }

  function readBook(player) {
    const builder = new DialogueChainBuilder();
    BOOK_PARAGRAPHS.forEach((paragraph, index) => builder.add(new StatementDialogue(index, paragraph)));
    builder.add(new EndDialogue(BOOK_PARAGRAPHS.length));
    player.getDialogueManager().startDialogues(builder);
  }

  /** "You add an entry to Kharedst's Memoirs." */
  function useLunchPageOnMemoirs(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(LANCALLIUMS_PAGE_ITEM_ID) || ![usedItemId, usedWithItemId].some((id) => MEMOIRS_ITEM_IDS.has(id))) return;
    if (pageAddedToMemoir(player)) return;
    event.handled = true;
    player.getInventory().deleteNumber(LANCALLIUMS_PAGE_ITEM_ID, 1);
    player.setAttribute(MEMOIR_PAGE_ADDED_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(VARBIT_PAGE_ADDED, 1);
    player.sendMessage("You add an entry to Kharedst's Memoirs.");
  }

  // ==========================================================================
  // Cave NPCs and the Sand Snake
  // ==========================================================================

  function ensureCaveNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_READ_BOOK || stage > STAGE_ACCORD_LOOTED) return;
    const tracked = caveEncounters.get(player) ?? {};
    if (!tracked.son) {
      const son = api.spawnNpc({
        id: CAVE_SON_NPC_ID,
        x: CAVE_ARTUR_TILE.x,
        y: CAVE_ARTUR_TILE.y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (son) tracked.son = son;
    }
    if (!tracked.snake && stage < STAGE_SNAKE_KILLED) {
      const snake = api.spawnNpc({
        id: SAND_SNAKE_NPC_ID,
        x: CAVE_SNAKE_TILE.x,
        y: CAVE_SNAKE_TILE.y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (snake) tracked.snake = snake;
    }
    caveEncounters.set(player, tracked);
  }

  function clearCaveNpcs(player) {
    const tracked = caveEncounters.get(player);
    if (!tracked) return;
    if (tracked.son) api.removeNpc(tracked.son);
    if (tracked.snake) api.removeNpc(tracked.snake);
    caveEncounters.delete(player);
  }

  function handleNpcDeath(event) {
    if (event.npcId !== SAND_SNAKE_NPC_ID) return;
    const owner = event.killer?.isPlayer?.() ? event.killer : null;
    if (!owner) return;
    const tracked = caveEncounters.get(owner);
    if (!tracked || tracked.snake !== event.npc) return;
    delete tracked.snake;
    if (quest.getStage(owner) < STAGE_SNAKE_KILLED && !quest.isComplete(owner)) {
      quest.setStage(owner, STAGE_SNAKE_KILLED);
    }
  }

  function handleZoneEnter({ player }) {
    ensureCaveNpcs(player);
  }

  function handleZoneExit({ player }) {
    clearCaveNpcs(player);
  }

  /**
   * The generic Ladders plugin owns objects named "Rope" and would prompt
   * before our handler runs; claim the lower rope climb explicitly.
   */
  function claimRopeClimb(request) {
    if (request.objectId !== ROPE_OBJECT_ID) return;
    request.handled = true;
    startMoveTranscript(request.player, "the-envoy-to-varlamore-climbing-up-the-rope", UPPER_CAVE_TILE);
  }

  function syncRewardVar(player) {
    const claimed = quest.getStage(player) >= STAGE_COMPLETE ? 1 : 0;
    player.getPacketSender().sendVarbit(VARBIT_HOSIDIUS_REWARD, claimed);
  }

  /** Publishes the native quest wire value for the player's current step. */
  function publishWire(player) {
    player.getPacketSender().sendVarbit(VARBIT_HOSIDIUS_QUEST, wireValue(quest.getStage(player), player));
  }

  function handleLogin({ player }) {
    syncArturVisibility(player);
    syncRewardVar(player);
    const pageAdded = Number(player.getAttribute(MEMOIR_PAGE_ADDED_ATTRIBUTE)) > 0 ||
      (player.getPacketSender().getVarbit?.(VARBIT_PAGE_ADDED) ?? 0) !== 0;
    if (pageAdded) {
      player.setAttribute(MEMOIR_PAGE_ADDED_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(VARBIT_PAGE_ADDED, 1);
    }
    publishWire(player);
    if (inZone(CAVE_ZONE, player.getLocation())) ensureCaveNpcs(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    clearCaveNpcs(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Lord Kandur Hosidius asked me to find his missing son Artur.</str>",
        "<str>I tracked Artur to the Crabclaw Caves and helped him recover</str>",
        "<str>the original Royal Accord of Twill.</str>",
        "<str>I returned the Accord to Lord Hosidius and claimed my reward.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>Lord Kandur Hosidius asked me to find his missing son Artur.</str>",
      ];
      if (stage >= STAGE_OLIVIA) {
        lines.push(
          "<str>Chef Olivia told me Artur was searching for the Royal Accord of</str>",
          "<str>Twill and had been spending his time in the Arceuus Library.</str>"
        );
      }
      if (stage >= STAGE_GALANA) {
        lines.push("<str>Galana told me to look for 'The Envoy to Varlamore' in the library.</str>");
      }
      if (stage >= STAGE_READ_BOOK) {
        lines.push(
          "<str>I read the book and learned the Accord sank with a ship in the</str>",
          "<str>Crabclaw Caves, south of the Woodcutting Guild.</str>"
        );
      }
      if (stage >= STAGE_MET_ARTUR) {
        lines.push("<str>I found Artur in the caves. He asked me to kill the Sand Snake.</str>");
      }
      if (stage >= STAGE_SNAKE_KILLED) lines.push("<str>I killed the Sand Snake.</str>");
      if (stage >= STAGE_ACCORD_LOOTED) {
        lines.push("<str>I recovered the Royal Accord of Twill from the chest.</str>");
      }
      if (stage >= STAGE_ARTUR_HOME) {
        lines.push(
          "<str>Artur has returned home.</str>",
          "",
          "I should return the Accord to <col=800000>Lord Kandur Hosidius</col>."
        );
      } else {
        lines.push("", "I should continue my search for <col=800000>Artur</col>.");
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Lord Kandur Hosidius</col> in his home in <col=800000>Hosidius</col>,",
      "north-west of the Vinery.",
      "",
      "I must have completed <col=800000>Client of Kourend</col> and have an",
      "<col=800000>Agility</col> level of 18 to start this quest.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, 1500);
    player.getInventory().adds(COINS_ITEM_ID, 4000);
  }

  api.persistAttribute(BOOK_BAY_ATTRIBUTE);
  api.persistAttribute(MEMOIR_PAGE_ADDED_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "the_depths_of_despair",
    name: "The Depths of Despair",
    varpId: VARP_HOSIDIUS_QUEST,
    varbitId: VARBIT_HOSIDIUS_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.AGILITY.getIndex(), amount: 1500, label: "Agility" }],
    rewardItemId: LANCALLIUMS_PAGE_ITEM_ID,
    rewardItemLabel: "Lunch by the Lancalliums",
    otherRewards: ["4,000 Coins", "Hosidius graceful outfit recolour", "Nightmare Zone Sand Snake"],
    buildJournal,
    onReward: grantReward,
    varbitValue: wireValue,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(routeSteppingStone);
  api.onCustomEvent("ladders:climb", claimRopeClimb);
  api.onObjectInteraction("Bookshelf", { Search: searchBookshelf });
  api.onItemAction(handleItemAction);
  api.onItemOnItem(useLunchPageOnMemoirs);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CAVE_ZONE, handleZoneEnter);
  api.onZoneExit(CAVE_ZONE, handleZoneExit);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
