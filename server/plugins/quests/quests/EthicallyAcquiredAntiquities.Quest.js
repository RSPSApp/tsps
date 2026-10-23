/**
 * Ethically Acquired Antiquities (members).
 *
 * Behaviour follows the complete quest in RSProx recording 1695 (revision 226, ticks
 * 7114-7934); the words come from the "Ethically Acquired Antiquities" transcript page
 * (OSRS Wiki). Evidence and remaining gaps: docs/p2p-varlamore-group-2-parity.md.
 *
 * Stages live in varbit 11193 "eaa" (varp 4400, bits 0-6), as captured:
 *
 *   0 not started (inspecting the empty display starts the quest)
 *   2 agreed to help; talk to Curator Herminius
 *   4 investigate the tools and the display
 *   6 question the visitors
 *   8 a visitor saw the thief head for the landing site; ask Regulus Cento
 *  10 ask a trader crewmember in the Cothon
 *  12 have the tattered sails repaired by Artima
 *  14 sails returned
 *  16 ask the Port Sarim charter crew
 *  18 ask Betty about the rune order
 *  20 read Betty's notes
 *  22 ask Curator Haig Halen
 *  24 pickpocket Haig for the storeroom key and search the crate
 *  26/28 diadem found (both sent on the crate search); confront Haig
 *  30 shame Haig (the Shame-o-meter)
 *  32 the explanation cutscene
 *  34 cutscene ends
 *  36 return to Curator Herminius (completes at 38)
 *
 * Side flags are mirrored to the cache's own varbits: 11194 investigated display, 11195
 * tools, 11196-11198 questioned citizen/tourist/academic, 11199 shame (0-100), 11200
 * crewmember favour, 11201 crafting favour, 11204 given sails, 11205 fixed sails, 11206
 * given notes and 11207 diadem (the display multi-loc 55377). The capture never sets
 * 11202 (Betty told about the note) and sets 11207 only after completion.
 *
 * Every NPC is the world's own (npc-spawns.json). The visitors are any Citizen, Tourist or
 * Academic in the Grand Museum; the charter crew are matched by name at the Cothon and the
 * Port Sarim dock, as the Wiki's "any trader crewmember".
 *
 * Rewards per the capture: 1 Quest point, 6,000 Thieving XP and 5,000 coins.
 */
module.exports = function registerEthicallyAcquiredAntiquitiesQuest(api) {
  const {
    ActionDialogue,
    Animation,
    Boundary,
    CountdownTask,
    DialogueChainBuilder,
    GameObject,
    ItemIdentifiers,
    Location,
    MultiChatboxPrompt,
    NpcDefinition,
    NpcDialogue,
    NpcIdentifiers,
    ObjectIdentifiers,
    PlayerDialogue,
    PrivateArea,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const { crossingFor } = require("../../objects/WallDoor.Doors");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  ObstacleRunner.init(api);

  const PAGE = "Ethically Acquired Antiquities";
  const START_HOOK = "quest:ethically-acquired-antiquities:start";

  // Varp/varbits: lookup-gameval.ts varbit eaa -> "11193 eaa varp=4400 bits=0-6".
  const VARP_EAA = 4400;
  const STAGE_VARBIT = 11193;
  const INVESTIGATED_DISPLAY_VARBIT = 11194;
  const INVESTIGATED_TOOLS_VARBIT = 11195;
  const QUESTIONED_CITIZEN_VARBIT = 11196;
  const QUESTIONED_TOURIST_VARBIT = 11197;
  const QUESTIONED_ACADEMIC_VARBIT = 11198;
  const SHAME_VARBIT = 11199;
  const CREWMEMBER_FAVOUR_VARBIT = 11200;
  const CRAFTING_FAVOUR_VARBIT = 11201;
  const BETTY_TOLD_VARBIT = 11202;
  const GIVEN_SAILS_VARBIT = 11204;
  const FIXED_SAILS_VARBIT = 11205;
  const GIVEN_NOTES_VARBIT = 11206;
  const DIADEM_VARBIT = 11207;
  const CUTSCENE_STATUS_VARBIT = 542; // cutscene_status
  const MINIMAP_STATE_VARBIT = 6719; // minimap_state

  const STAGE_STARTED = 2;
  const STAGE_INVESTIGATE = 4;
  const STAGE_CLUE = 6;
  const STAGE_REGULUS = 8;
  const STAGE_CREW = 10;
  const STAGE_REPAIR = 12;
  const STAGE_RETURN_SAILS = 14;
  const STAGE_PORT_SARIM = 16;
  const STAGE_BETTY = 18;
  const STAGE_READ_NOTES = 20;
  const STAGE_HAIG = 22;
  const STAGE_STOREROOM = 24;
  const STAGE_SEARCH_CRATE = 26;
  const STAGE_CONFRONT = 28;
  const STAGE_SHAME = 30;
  const STAGE_CUTSCENE = 32;
  const STAGE_CUTSCENE_END = 34;
  const STAGE_RETURN = 36;
  const STAGE_COMPLETE = 38;

  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const TATTERED_SAILS_ITEM_ID = ItemIdentifiers.TATTERED_SAILS; // 29903
  const SAILS_ITEM_ID = ItemIdentifiers.SAILS; // 29904
  const BETTYS_NOTES_ITEM_ID = ItemIdentifiers.BETTYS_NOTES; // 29905
  const STOREROOM_KEY_ITEM_ID = ItemIdentifiers.STOREROOM_KEY_3; // 29906
  const DIADEM_ITEM_ID = 29907; // gameval eaa_diadem: the crate box and completion scroll model
  const TOOLS_ITEM_ID = 29908; // gameval eaa_tools: the tools box model

  const EMPTY_DISPLAY_OBJECT_ID = ObjectIdentifiers.EMPTY_DISPLAY_5; // 54693
  const DIADEM_DISPLAY_OBJECT_ID = ObjectIdentifiers.XERNAS_DIADEM; // 54694
  const TOOLS_OBJECT_ID = ObjectIdentifiers.TOOLS_13; // 54700, Investigate
  const STOREROOM_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_746; // 54695, Open
  const STOREROOM_DOOR_OPEN_OBJECT_ID = ObjectIdentifiers.DOOR_747; // 54696
  const STOREROOM_DOORWAY_OBJECT_ID = 38848; // the nameless loc the capture swaps into the doorway
  const DIADEM_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_340; // 54697, Search
  const FLAVOUR_CRATES_OBJECT_ID = ObjectIdentifiers.CRATES_107; // 54698, Search
  const STOREROOM_DOOR_TILE = { x: 3266, y: 3456 };

  const HERMINIUS_NPC_ID = NpcIdentifiers.CURATOR_HERMINIUS; // 13297
  const HAIG_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN; // 5214
  const HAIG_ACTOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN_2; // 13816, the cutscene Haig
  const THIEF_ACTOR_NPC_ID = NpcIdentifiers.THIEF_18; // 13817
  const REGULUS_NPC_ID = NpcIdentifiers.REGULUS_CENTO_3; // 12885, the Civitas landing site
  const ARTIMA_NPC_ID = NpcIdentifiers.ARTIMA; // 13342

  /** Visitor kinds by NPC name, and the varbit questioning each sets. */
  const VISITORS = {
    Citizen: { kind: "citizen", bit: 1 << 2, varbit: QUESTIONED_CITIZEN_VARBIT },
    Tourist: { kind: "tourist", bit: 1 << 3, varbit: QUESTIONED_TOURIST_VARBIT },
    Academic: { kind: "academic", bit: 1 << 4, varbit: QUESTIONED_ACADEMIC_VARBIT },
  };
  const CREW_NAMES = ["Trader Crewmember", "Trader crewmember", "Trader Stan"];
  const GRAND_MUSEUM = { minX: 1695, maxX: 1730, minY: 3150, maxY: 3175 };
  const COTHON = { minX: 1720, maxX: 1770, minY: 3110, maxY: 3160 };
  const PORT_SARIM_DOCK = { minX: 3028, maxX: 3050, minY: 3180, maxY: 3200 };

  const FLAGS_ATTRIBUTE = "quest.ethically_acquired_antiquities.flags";
  const INFORMANT_ATTRIBUTE = "quest.ethically_acquired_antiquities.informant";
  const SHAME_ATTRIBUTE = "quest.ethically_acquired_antiquities.shame";
  const PENDING_SAILS_ATTRIBUTE = "quest.ethically_acquired_antiquities.pending-sails";
  const DECLINED_FAVOUR_ATTRIBUTE = "quest.ethically_acquired_antiquities.declined-favour";

  const BIT_INVESTIGATED_DISPLAY = 1 << 0;
  const BIT_INVESTIGATED_TOOLS = 1 << 1;
  const BIT_CREWMEMBER_FAVOUR_ASKED = 1 << 5;
  const BIT_CRAFTING_FAVOUR_ASKED = 1 << 6;
  const BIT_BETTY_TOLD = 1 << 7;
  const BIT_GIVEN_SAILS = 1 << 8;
  const BIT_FIXED_SAILS = 1 << 9;
  const BIT_GIVEN_NOTES = 1 << 10;
  const BIT_DIADEM = 1 << 11;
  const FLAG_VARBITS = [
    [BIT_INVESTIGATED_DISPLAY, INVESTIGATED_DISPLAY_VARBIT],
    [BIT_INVESTIGATED_TOOLS, INVESTIGATED_TOOLS_VARBIT],
    ...Object.values(VISITORS).map(({ bit, varbit }) => [bit, varbit]),
    [BIT_CREWMEMBER_FAVOUR_ASKED, CREWMEMBER_FAVOUR_VARBIT],
    [BIT_CRAFTING_FAVOUR_ASKED, CRAFTING_FAVOUR_VARBIT],
    [BIT_BETTY_TOLD, BETTY_TOLD_VARBIT],
    [BIT_GIVEN_SAILS, GIVEN_SAILS_VARBIT],
    [BIT_FIXED_SAILS, FIXED_SAILS_VARBIT],
    [BIT_GIVEN_NOTES, GIVEN_NOTES_VARBIT],
    [BIT_DIADEM, DIADEM_VARBIT],
  ];

  // The Grand Museum's display notice (interface 873, filled by clientscript 5006), as captured.
  const DISPLAY_INTERFACE = 873;
  const DISPLAY_SCRIPT = 5006;
  const DISPLAY_SCRIPT_ARGS = [
    "Xerna's Diadem", 53130,
    "Be aware that the diadem normally displayed here was recently stolen. The Grand Museum is willing to pay a high price for information that leads to its return.",
    -3, 135, 0, 1938, 0, 560, 0,
  ];
  const DISPLAY_NOTICE_TICKS = 4;
  // Betty's notes (interface 291): the captured text components; the rest are cleared.
  const NOTES_INTERFACE = 291;
  const NOTES_LINES = {
    8: "One that lets me travel, but not fight.",
    10: "Three that are needed to grab, but not weaken.",
    12: "One that doesn't make fruit, but instead makes gold.",
  };
  // The diadem appears back on display this long after completion in the capture.
  const DIADEM_RETURN_TICKS = 64;
  const PICKPOCKET_ANIMATION = 881;
  const ARTIMA_STITCH_ANIMATION = 10794;
  const ARTIMA_STITCH_TICKS = 4;
  const DOOR_RESET_TICKS = 2;
  const DOOR_UNLOCK_SOUND = 2419;
  const DOOR_OPEN_SOUND = 44;

  // The interrogation, as captured: an instance copy of the museum, the meter at 50, the
  // opening exchange moving it -4 then +4, then three-option rounds until it is full.
  const SHAME_MAX = 100;
  const SHAME_START = 50;
  const SHAME_OPENING = [-4, 4];
  const SHAME_STEP_MIN = 4;
  const SHAME_STEP_MAX = 9;
  const SHAME_INTERFACE = 881;
  const OVERLAY_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const CAMERA_RATES = { rate: 232, rate2: 100 };
  const TURN_YAW = 1024;
  const TURN_CYCLES = 5;
  const VARROCK_MUSEUM = [3240, 3280, 3430, 3470];
  const FORTIS_MUSEUM = [1695, 1730, 3150, 3175];
  const CONFRONT_TILE = [3258, 3449];
  const CONFRONT_HAIG_TILE = [3256, 3449];
  const CONFRONT_CAMERA = [3257, 3449, 221];
  const LOOK_AT_HAIG = [3256, 3449, 220];
  const LOOK_AT_PLAYER = [3258, 3449, 220];
  const SCENE_END_TILE = [3258, 3447];
  const HAIG_TALK_ANIMATION = 857;
  const HAIG_PUNCH_ANIMATIONS = [11736, 11737, 11736];
  const THIEF_SWING_ANIMATION = 11738;
  const THIEF_FALL_ANIMATION = 9101;
  const PICKUP_ANIMATION = 827;

  const SHAME_INCREASE_OPTIONS = new Set([
    "A real historian would never steal!",
    "Are you even a real historian, or just a petty criminal?",
    "Aren't you embarrassed to have stolen items in your collection?",
    "Did you know Varlamore sends thieves to the Colosseum?",
    "Do you really think you did the right thing?",
    "Do your colleagues know what you've done? What do they think?",
    "Hand that artefact back this instant!",
    "How will Varlamorians learn their history now?",
    "How would you feel if someone came in here and stole all your stuff?",
    "I guess you were just in it for the glory, were you?",
    "I thought archaeology was cool. I didn't realise it was just thieving!",
    "If you're looking for stolen goods, I can get my hands on plenty.",
    "Is everything here stolen from other museums?",
    "Just give it back already!",
    "Look me in the eye and tell me you did the right thing.",
    "Nobody wants to see stolen goods on display!",
    "So can anyone just go around stealing and call it archaeology?",
    "Stealing is against the law!",
    "Stealing is stealing, no matter how you try to justify it.",
    "Think of the Varlamorian children who won't get to see this artefact.",
    "This is stealing! Thieving! Taking what's not yours!",
    "Varlamore might close their lands again after this.",
    "Varlamore might never let you and your colleagues visit again!",
    "You can't justify theft by saying it's for preservation.",
    "You could have damaged the artefact!",
    "You ought to be ashamed.",
    "You should give Varlamore a chance before stealing their stuff.",
    "You're a disgrace to your entire profession!",
    "You're a loose cannon.",
    "You're hoarding artefacts, but you should be sharing them!",
    "You're not above the law! You stole this stuff!",
    "You're setting a terrible example.",
    "You're supposed to protect history, not steal it!",
    "You've betrayed the trust of Varlamore.",
    "You've committed a crime.",
  ]);

  // Variant keys on the "Ethically Acquired Antiquities" page.
  const V_DISPLAY_START = "xerna-s-stolen-diadem-inpecting-the-empty-display";
  const V_HERMINIUS_INTRO = "xerna-s-stolen-diadem-talking-to-curator-herminius";
  const V_HERMINIUS_CLUES = "clues-in-civitas-illa-fortis-talking-to-curator-herminius";
  const V_HERMINIUS_FINAL = "in-varrock-museum-talking-to-curator-herminius";
  const V_TOOLS = "clues-in-civitas-illa-fortis-investigating-the-tools-on-ground";
  const V_DISPLAY_AGAIN = "clues-in-civitas-illa-fortis-inpecting-the-empty-display-once-more";
  const V_VISITOR_NOTHING = "clues-in-civitas-illa-fortis-talking-to-an-academic-citizen-or-tourist-that-didn-t-see-anything";
  const V_VISITOR_CLUE = "clues-in-civitas-illa-fortis-talking-to-a-tourist";
  const V_REGULUS_FIRST = "clues-in-civitas-illa-fortis-talking-to-regulus-cento";
  const V_REGULUS_AGAIN = "clues-in-civitas-illa-fortis-talking-to-regulus-cento-again";
  const V_FORTIS_FIRST = "clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember";
  const V_FORTIS_DECLINED = "clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-declining-doing-the-favour";
  const V_FORTIS_AGREED = "clues-in-civitas-illa-fortis-talking-to-trader-crewmember-after-agreeing-to-the-favour";
  const V_FORTIS_WITH_SAILS = "clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-with-the-sails";
  const V_FORTIS_RETURNED = "clues-in-civitas-illa-fortis-talking-to-a-trader-crewmember-after-having-returned-the-sails";
  const V_ARTIMA_FIRST = "clues-in-civitas-illa-fortis-talking-to-artima";
  const V_ARTIMA_DECLINED = "clues-in-civitas-illa-fortis-talking-to-artima-after-declining-doing-the-favour";
  const V_ARTIMA_LOST = "clues-in-civitas-illa-fortis-talking-to-artima-after-losing-the-repaired-sails";
  const V_SARIM_FIRST = "clues-in-port-sarim-talking-to-a-trader-crewmember-in-port-sarim";
  const V_SARIM_AGAIN = "clues-in-port-sarim-talking-to-a-trader-crewmember-in-port-sarim-again";
  const V_BETTY_FIRST = "clues-in-port-sarim-talking-to-betty";
  const V_BETTY_AGAIN = "clues-in-port-sarim-talking-to-betty-again";
  const V_NOTES_FIRST = "clues-in-port-sarim-inspecting-betty-s-notes-for-the-first-time";
  const V_HAIG_FIRST = "in-varrock-museum-talking-to-curtor-haig-halen";
  const V_HAIG_AGAIN = "in-varrock-museum-talking-to-curtor-haig-halen-talking-to-haig-again";
  const V_HAIG_PICKPOCKET = "in-varrock-museum-pickpocketing-curator-haig-halen";
  const V_HAIG_CRATE = "in-varrock-museum-searching-the-crate";
  const V_HAIG_CRATES = "in-varrock-museum-searching-the-two-crates";
  const V_HAIG_FOUND = "in-varrock-museum-talking-to-curator-haig-halen-after-finding-the-diadem";

  // Step ids on the page.
  const SAILS_GIVEN_STEP_IDS = new Set(["1wx5TB", "-1DZ27", "123zW4"]);
  const SAILS_REPAIRED_STEP = "92E3NZ";
  const SAILS_REPLACED_STEP = "6yZD0M";
  const SAILS_RETURNED_STEP = "7Wg9ig";
  const NOTES_GIVEN_STEP_IDS = new Set(["zLd3nC", "9CiLQ7"]);
  const TOOLS_STEP = "tNweU6";
  const DISPLAY_AGAIN_STEP = "Qqjtag";
  const PICKPOCKET_STEP = "azipeA";
  const CRATE_SEARCH_STEP = "XVW4Mv";
  const INTERROGATION_START_STEP = "X-XWP3";
  const INTERROGATION_FAILED_STEP = "f07S0F";
  const INTERROGATION_PASSED_STEP = "ke5P0h";
  const CUTSCENE_BEGIN_STEP = "xxhjn2";
  const CUTSCENE_END_STEP = "MC3wD2";
  const COMPLETE_STEP = "i2moAx";
  const NO_LEAD_STEP_IDS = ["YULuAF", "BBOzW9"];
  const CITIZEN_LEAD_STEP = "ZSVQQP";
  const TOURIST_LEAD_STEP = "HBhK3a";
  /** Item boxes the capture shows for the page's message steps (an entry of null is a plain box). */
  const MESSAGE_BOXES = {
    [TOOLS_STEP]: TOOLS_ITEM_ID,
    [DISPLAY_AGAIN_STEP]: null,
    "1wx5TB": TATTERED_SAILS_ITEM_ID,
    [SAILS_REPAIRED_STEP]: SAILS_ITEM_ID,
    [SAILS_RETURNED_STEP]: SAILS_ITEM_ID,
    zLd3nC: BETTYS_NOTES_ITEM_ID,
    [PICKPOCKET_STEP]: STOREROOM_KEY_ITEM_ID,
    [CRATE_SEARCH_STEP]: DIADEM_ITEM_ID,
  };

  const VISITOR_QUESTION_LINE = "I was wondering if you'd seen anything unusual around the museum lately?";
  const VISITOR_NO_LEAD_LINES = new Set(["No, I don't think so...", "Oh... Sorry, but I don't think I can be much help."]);
  const HERMINIUS_STARTED_LINE = "Perhaps you'll have better luck though. Maybe you could have a look around for any sort of clues and see if you can find anything wrong.";
  const DISPLAY_AGAIN_LINE = "I don't think I'm going to find much more just lying around... Maybe I should try asking if anyone nearby saw anything.";
  const REGULUS_LEAD_LINE = "Yes, I thought it was quite strange. I told him no, and he made his way east, towards the Cothon.";
  const CREW_FAVOUR_LINE = "Although, we could use a hand... Think you could do us a small favour?";
  const ARTIMA_FAVOUR_LINE = "Oh, in that case, I'll help you out, just so long as you can do me a small favour.";
  const ARTIMA_STITCH_LINES = ["Let's see... Thread that through there...", "Grab some of that, then pull that through...", "Tie off the end there and..."];
  const ARTIMA_REPAIRED_LINE = "There we have it! They might not look the prettiest, but they'll be sturdy enough for the job at least.";
  const CREW_PORT_SARIM_LINE = "Well, we explained how it does work and he then asked us to take him to Port Sarim...";
  const SARIM_RUNES_LINE = "Wandered up north, I think. Said something about trying to get hold of some runes.";
  const HAIG_DENIAL_LINE = "What awful news! I'm not sure I can help you with that, though...";
  const HAIG_CONFRONTED_LINE = "Ah...";
  const HAIG_RETURN_LINE = "Okay... I'll have it sent back at once.";

  /** Player -> the running interrogation/cutscene. */
  const scenes = new Map();
  /** Players with Betty's notes open for the first time. */
  const readingNotes = new WeakSet();
  /** Per-player keys for one-off delays outside a scene. */
  const playerTasks = new WeakMap();

  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, bit) {
    return (flags(player) & bit) !== 0;
  }

  function setFlag(player, bit, varbitId) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | bit);
    player.getPacketSender().sendVarbit(varbitId, 1);
  }

  function shame(player) {
    return Math.max(0, Math.min(SHAME_MAX, Number(player.getAttribute(SHAME_ATTRIBUTE)) || 0));
  }

  function setShame(player, value) {
    const clamped = Math.max(0, Math.min(SHAME_MAX, value));
    player.setAttribute(SHAME_ATTRIBUTE, clamped);
    player.getPacketSender().sendVarbit(SHAME_VARBIT, clamped);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function within(player, zone) {
    const location = player.getLocation();
    return location.getZ() === 0
      && location.getX() >= zone.minX && location.getX() <= zone.maxX
      && location.getY() >= zone.minY && location.getY() <= zone.maxY;
  }

  function npcName(npcId) {
    return NpcDefinition.forId(npcId)?.getName?.() ?? null;
  }

  function isCrew(npcId) {
    return CREW_NAMES.includes(npcName(npcId));
  }

  function informantRole(player) {
    const stored = player.getAttribute(INFORMANT_ATTRIBUTE);
    if (stored === "citizen" || stored === "tourist") return stored;
    if (quest.getStage(player) !== STAGE_CLUE) return null;
    const role = Math.random() < 0.5 ? "citizen" : "tourist";
    player.setAttribute(INFORMANT_ATTRIBUTE, role);
    return role;
  }

  function isQuestPage(pages) {
    return Array.isArray(pages) && pages.some((page) => page?.page === PAGE);
  }

  /** Another quest's completion through the runtime, with a stage>=2 fallback. */
  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    const stage = Number(player.getAttribute(`quest.${key}.stage`));
    return Number.isFinite(stage) && stage >= 2;
  }

  function meetsRequirements(player) {
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 25) return false;
    return isQuestComplete(player, "children_of_the_sun") && isQuestComplete(player, "shield_of_arrav");
  }

  function advanceStage(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  function later(key, ticks, callback) {
    if (key?.isPlayer?.()) {
      const player = key;
      key = playerTasks.get(player);
      if (!key) { key = {}; playerTasks.set(player, key); }
    }
    TaskManager.submit(new CountdownTask(key, ticks, callback));
  }

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** The step list holding a step id anywhere in a variant, and its index there. */
  function locate(steps, id) {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === id) return { list: steps, index };
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? locate(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  function stepsAfter(steps, id) {
    const found = locate(steps, id);
    return found ? found.list.slice(found.index + 1) : [];
  }

  function stepById(steps, id) {
    const found = locate(steps, id);
    return found ? found.list[found.index] : null;
  }

  // ==========================================================================
  // Transcript wiring
  // ==========================================================================

  /** Which variant an NPC plays, by quest stage. Unrelated NPCs fall through. */
  function selectVariant({ npcId, player }) {
    if (npcId === HERMINIUS_NPC_ID) return selectHerminiusVariant(player);
    if (npcId === REGULUS_NPC_ID) return selectRegulusVariant(player);
    if (npcId === ARTIMA_NPC_ID) return selectArtimaVariant(player);
    if (npcId === HAIG_NPC_ID) return selectHaigVariant(player);
    if (npcId === NpcIdentifiers.BETTY) return selectBettyVariant(player);
    return null;
  }

  function selectHerminiusVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return null;
    if (stage >= STAGE_RETURN) return V_HERMINIUS_FINAL;
    if (stage >= STAGE_INVESTIGATE) return V_HERMINIUS_CLUES;
    return V_HERMINIUS_INTRO;
  }

  // Shared NPCs are only claimed inside EAA's own mandatory dialogue window. Outside it
  // (and after completion) the next quest's variant hook or the default page must run.

  function selectRegulusVariant(player) {
    const stage = quest.getStage(player);
    // Twilight's Promise's quetzal keeper: stages 8-9.
    if (stage < STAGE_REGULUS || stage >= STAGE_CREW || quest.isComplete(player)) return null;
    return stage > STAGE_REGULUS ? V_REGULUS_AGAIN : V_REGULUS_FIRST;
  }

  function selectFortisCrewVariant(player) {
    const stage = quest.getStage(player);
    // Cothon crew: stages 10-15.
    if (stage < STAGE_CREW || stage >= STAGE_PORT_SARIM || quest.isComplete(player)) return null;
    if (stage >= STAGE_RETURN_SAILS) return V_FORTIS_RETURNED;
    if (stage >= STAGE_REPAIR) {
      return held(player, SAILS_ITEM_ID) ? V_FORTIS_WITH_SAILS : V_FORTIS_AGREED;
    }
    return player.getAttribute(DECLINED_FAVOUR_ATTRIBUTE) === true ? V_FORTIS_DECLINED : V_FORTIS_FIRST;
  }

  function selectSarimCrewVariant(player) {
    const stage = quest.getStage(player);
    // Port Sarim crew: stages 16-17.
    if (stage < STAGE_PORT_SARIM || stage >= STAGE_BETTY || quest.isComplete(player)) return null;
    return stage > STAGE_PORT_SARIM ? V_SARIM_AGAIN : V_SARIM_FIRST;
  }

  function selectArtimaVariant(player) {
    const stage = quest.getStage(player);
    // Artima: stages 12-13.
    if (stage < STAGE_REPAIR || stage >= STAGE_RETURN_SAILS) return null;
    // She can only replace sails from a tattered pair; without one the crew hands them out.
    if (!held(player, TATTERED_SAILS_ITEM_ID)) return null;
    if (hasFlag(player, BIT_FIXED_SAILS)) return V_ARTIMA_LOST;
    if (hasFlag(player, BIT_CRAFTING_FAVOUR_ASKED)) return V_ARTIMA_DECLINED;
    return V_ARTIMA_FIRST;
  }

  function selectBettyVariant(player) {
    const stage = quest.getStage(player);
    // Hand in the Sand's Betty: stages 18-21.
    if (stage < STAGE_BETTY || stage >= STAGE_HAIG || quest.isComplete(player)) return null;
    return stage >= STAGE_READ_NOTES ? V_BETTY_AGAIN : V_BETTY_FIRST;
  }

  function selectHaigVariant(player) {
    const stage = quest.getStage(player);
    // Dig Site and Bone Voyage's Haig: stages 22-35, released with the return hand-in.
    if (stage < STAGE_HAIG || stage >= STAGE_RETURN || quest.isComplete(player)) return null;
    if (stage >= STAGE_CONFRONT) return V_HAIG_FOUND;
    return stage >= STAGE_STOREROOM ? V_HAIG_AGAIN : V_HAIG_FIRST;
  }

  /** Answers the wiki prose conditions from the player's quest state. */
  function answerCondition(event) {
    if (!isQuestPage(event.pages)) return null;
    const { player, stepId } = event;
    switch (stepId) {
      case "CAzpP4":
        return !meetsRequirements(player);
      case "MBl5US":
        return meetsRequirements(player);
      case "Qeeq6m":
        return quest.getStage(player) < STAGE_CLUE;
      case "UWPNbs":
        return quest.getStage(player) >= STAGE_CLUE && quest.getStage(player) < STAGE_REGULUS;
      case "SsFS8H":
        return quest.getStage(player) >= STAGE_REGULUS && quest.getStage(player) < STAGE_CONFRONT;
      case "WPK1ZO":
        return quest.getStage(player) >= STAGE_CONFRONT;
      case "ZSVQQP":
        return informantRole(player) === "citizen";
      case "HBhK3a":
        return informantRole(player) === "tourist";
      case "LgTVfY":
      case "jVFeXW":
        return !isQuestComplete(player, "one_small_favour");
      case "Vr0XnM":
      case "wQ6LNT":
        return isQuestComplete(player, "one_small_favour");
      case "1yeeSP":
      case "Y9Jo6i":
      case "2mcH7X":
      case "4TczKs":
        return player.getInventory().isFull();
      case "bnZg2R":
      case "94fUqn":
      case "pVAcnS":
        return !player.getInventory().isFull();
      case "t_CApx":
        return held(player, TATTERED_SAILS_ITEM_ID);
      case "QbESwT":
        return !held(player, TATTERED_SAILS_ITEM_ID)
          && !held(player, SAILS_ITEM_ID)
          && !player.getInventory().isFull();
      case "jcDmva":
        return player.getAttribute(PENDING_SAILS_ATTRIBUTE) === true;
      case "zMEiLB":
        return held(player, BETTYS_NOTES_ITEM_ID);
      case "HItAxB":
        return !held(player, BETTYS_NOTES_ITEM_ID);
      case "krLq4g":
        return player.getInventory().isFull();
      default:
        return null;
    }
  }

  /** The quest-start slug on the display's "Yes." option. */
  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK || quest.getStage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Ethically Acquired Antiquities</col>");
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (isCrew(npcId) && quest.getStage(player) === STAGE_CREW && option === "Not right now.") {
      player.setAttribute(DECLINED_FAVOUR_ATTRIBUTE, true);
    }
  }

  /**
   * Lines that mark a milestone. Line events fire while a run of lines is queued, so
   * state that the capture changes as a line appears goes in `before`.
   */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    const stage = quest.getStage(player);
    const at = (expected, action) => { if (text === expected) event.before = action; };
    if (npcId === HERMINIUS_NPC_ID) {
      if (stage === STAGE_STARTED) at(HERMINIUS_STARTED_LINE, () => advanceStage(player, STAGE_INVESTIGATE));
      // The display's second look leads to the visitors once the tools were seen too.
      if (stage === STAGE_INVESTIGATE) at(DISPLAY_AGAIN_LINE, () => {
        if (hasFlag(player, BIT_INVESTIGATED_TOOLS) && hasFlag(player, BIT_INVESTIGATED_DISPLAY)) advanceStage(player, STAGE_CLUE);
      });
      return;
    }
    if (npcId === HAIG_NPC_ID) {
      if (stage === STAGE_HAIG) at(HAIG_DENIAL_LINE, () => advanceStage(player, STAGE_STOREROOM));
      if (stage >= STAGE_CONFRONT && stage < STAGE_CUTSCENE && text === HAIG_CONFRONTED_LINE) {
        event.after = () => beginInterrogation(player);
      }
      if (stage === STAGE_CUTSCENE_END) at(HAIG_RETURN_LINE, () => advanceStage(player, STAGE_RETURN));
      return;
    }
    if (npcId === REGULUS_NPC_ID) {
      if (stage === STAGE_REGULUS) at(REGULUS_LEAD_LINE, () => advanceStage(player, STAGE_CREW));
      return;
    }
    if (npcId === ARTIMA_NPC_ID) {
      if (stage === STAGE_REPAIR) at(ARTIMA_FAVOUR_LINE, () => setFlag(player, BIT_CRAFTING_FAVOUR_ASKED, CRAFTING_FAVOUR_VARBIT));
      if (ARTIMA_STITCH_LINES.includes(text)) event.before = () => stitch(player, event.npc, text);
      at(ARTIMA_REPAIRED_LINE, () => repairSails(player));
      return;
    }
    if (npcId === NpcIdentifiers.BETTY) {
      // The notes action advances the stage, so a full bag cannot skip the hand-over.
      return;
    }
    if (isCrew(npcId)) {
      // The Port Sarim lines are typed "Trader Crewmember"; Trader Stan keeps his own head.
      if (npcName(npcId) === "Trader Stan" && event.step?.speaker) {
        event.speakerId = npcId;
        event.speakerName = "Trader Stan";
      }
      if (stage === STAGE_CREW) at(CREW_FAVOUR_LINE, () => setFlag(player, BIT_CREWMEMBER_FAVOUR_ASKED, CREWMEMBER_FAVOUR_VARBIT));
      if (stage === STAGE_RETURN_SAILS) at(CREW_PORT_SARIM_LINE, () => advanceStage(player, STAGE_PORT_SARIM));
      if (stage === STAGE_PORT_SARIM) at(SARIM_RUNES_LINE, () => advanceStage(player, STAGE_BETTY));
      return;
    }
    const visitor = VISITORS[npcName(npcId)];
    if (visitor && stage === STAGE_CLUE && within(player, GRAND_MUSEUM)) {
      if (VISITOR_NO_LEAD_LINES.has(text)) event.before = () => setFlag(player, visitor.bit, visitor.varbit);
      if (text.startsWith("They left through the front door and turned right")) event.before = () => {
        setFlag(player, visitor.bit, visitor.varbit);
        advanceStage(player, STAGE_REGULUS);
      };
    }
  }

  /**
   * Condition branches that carry side effects. The chosen-branch event has no
   * `pages` field, so these are scoped by the speaker and the page's step ids.
   */
  function handleChosenCondition(event) {
    const { player, npcId, stepId } = event;
    if (!isCrew(npcId)) return;
    if (stepId === "1yeeSP") player.setAttribute(PENDING_SAILS_ATTRIBUTE, true);
    if (stepId === "bnZg2R") player.setAttribute(PENDING_SAILS_ATTRIBUTE, false);
  }

  /** Action/message steps that hand items over, with the item box the capture shows. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (event.kind === "message" && Object.hasOwn(MESSAGE_BOXES, stepId) && isQuestPage(event.pages)) {
      const item = MESSAGE_BOXES[stepId];
      event.handled = true;
      event.box = item === null ? { statement: true } : { items: [item] };
    }
    if (isCrew(npcId) && SAILS_GIVEN_STEP_IDS.has(stepId)) {
      if (!held(player, TATTERED_SAILS_ITEM_ID)) player.getInventory().adds(TATTERED_SAILS_ITEM_ID, 1);
      if (!held(player, TATTERED_SAILS_ITEM_ID)) return;
      setFlag(player, BIT_GIVEN_SAILS, GIVEN_SAILS_VARBIT);
      player.setAttribute(PENDING_SAILS_ATTRIBUTE, false);
      advanceStage(player, STAGE_REPAIR);
      return;
    }
    if (npcId === ARTIMA_NPC_ID && (stepId === SAILS_REPAIRED_STEP || stepId === SAILS_REPLACED_STEP)) {
      repairSails(player);
      return;
    }
    if (isCrew(npcId) && stepId === SAILS_RETURNED_STEP) {
      if (held(player, SAILS_ITEM_ID)) player.getInventory().deleteNumber(SAILS_ITEM_ID, 1);
      advanceStage(player, STAGE_RETURN_SAILS);
      return;
    }
    if (npcId === NpcIdentifiers.BETTY && NOTES_GIVEN_STEP_IDS.has(stepId)) {
      if (!held(player, BETTYS_NOTES_ITEM_ID)) player.getInventory().adds(BETTYS_NOTES_ITEM_ID, 1);
      setFlag(player, BIT_GIVEN_NOTES, GIVEN_NOTES_VARBIT);
      advanceStage(player, STAGE_READ_NOTES);
      return;
    }
    if (npcId === HAIG_NPC_ID && stepId === CRATE_SEARCH_STEP) {
      advanceStage(player, STAGE_SEARCH_CRATE);
      advanceStage(player, STAGE_CONFRONT);
      return;
    }
    if (npcId === HERMINIUS_NPC_ID && stepId === COMPLETE_STEP) {
      if (!quest.isComplete(player)) quest.complete(player);
    }
  }

  /** Artima's three stitching lines play on their own, four ticks each, as she works. */
  function stitch(player, artima, text) {
    const manager = player.getDialogueManager();
    if (text === ARTIMA_STITCH_LINES[0] && held(player, TATTERED_SAILS_ITEM_ID)) {
      player.getInventory().deleteNumber(TATTERED_SAILS_ITEM_ID, 1);
    }
    manager.advance();
    const line = manager.getCurrent?.();
    player.getPacketSender().sendString("", (231 << 16) | 5).sendInterfaceFlagsRange((231 << 16) | 5, -1, -1, 0);
    artima?.performAnimation?.(new Animation(ARTIMA_STITCH_ANIMATION));
    later(player, ARTIMA_STITCH_TICKS, () => {
      if (manager.getCurrent?.() === line) manager.advance();
    });
  }

  function repairSails(player) {
    if (held(player, TATTERED_SAILS_ITEM_ID)) player.getInventory().deleteNumber(TATTERED_SAILS_ITEM_ID, 1);
    if (!held(player, SAILS_ITEM_ID)) player.getInventory().adds(SAILS_ITEM_ID, 1);
    if (!hasFlag(player, BIT_FIXED_SAILS)) setFlag(player, BIT_FIXED_SAILS, FIXED_SAILS_VARBIT);
  }

  // ==========================================================================
  // The Grand Museum
  // ==========================================================================

  function inspectEmptyDisplay(event) {
    if (event.definition?.id !== EMPTY_DISPLAY_OBJECT_ID) return false;
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === 0) {
      showDisplayNotice(player);
      return true;
    }
    if (stage === STAGE_INVESTIGATE) {
      setFlag(player, BIT_INVESTIGATED_DISPLAY, INVESTIGATED_DISPLAY_VARBIT);
      startTranscript(api, player, HERMINIUS_NPC_ID, PAGE, V_DISPLAY_AGAIN);
      return true;
    }
    if (stage < STAGE_CLUE) startTranscript(api, player, HERMINIUS_NPC_ID, PAGE, V_DISPLAY_START);
    return true;
  }

  /** The display's notice, then (four ticks on, as captured) the player's thought. */
  function showDisplayNotice(player) {
    player.getPacketSender().sendInterface(DISPLAY_INTERFACE).sendClientScript(DISPLAY_SCRIPT, ...DISPLAY_SCRIPT_ARGS);
    later(player, DISPLAY_NOTICE_TICKS, () => {
      if (player.isRegistered?.() === false || quest.getStage(player) !== 0) return;
      if (player.getInterfaceId?.() === DISPLAY_INTERFACE) player.getPacketSender().sendInterfaceRemoval();
      startTranscript(api, player, HERMINIUS_NPC_ID, PAGE, V_DISPLAY_START);
    });
  }

  function inspectDiademDisplay(event) {
    if (event.definition?.id !== DIADEM_DISPLAY_OBJECT_ID) return false;
    event.handled = true;
    const { player } = event;
    player.sendMessage("The diadem on display here dates back to the earliest days of Varlamore. It was made for the hero Xerna and it is believed she wore it when she wed her long-time companion, Quoatlos.");
    player.sendMessage("While the diadem was safely displayed here for many years, it was recently stolen by an unknown party. However, thanks to a helpful adventurer, the diadem was quickly recovered.");
    return true;
  }

  function investigateTools(event) {
    if (event.definition?.id !== TOOLS_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_INVESTIGATE) return false;
    event.handled = true;
    setFlag(player, BIT_INVESTIGATED_TOOLS, INVESTIGATED_TOOLS_VARBIT);
    startTranscript(api, player, HERMINIUS_NPC_ID, PAGE, V_TOOLS);
    return true;
  }

  /**
   * Any Citizen, Tourist or Academic on the museum floor: a greeting by kind, then either
   * the lead (one citizen-or-tourist kind per player) or one of the Wiki's random no-leads.
   */
  function talkToVisitor(event) {
    const { player, npcId } = event;
    const name = npcName(npcId);
    if (!VISITORS[name] || quest.getStage(player) !== STAGE_CLUE || !within(player, GRAND_MUSEUM)) return false;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, V_VISITOR_NOTHING, () => visitorSteps(player, name));
    return true;
  }

  function visitorSteps(player, name) {
    const spokenBy = (steps) => steps.map((step) => (step.type === "line" ? { ...step, speaker: name } : step));
    const clue = variantSteps(V_VISITOR_CLUE);
    const greeting = name === "Tourist" ? clue[1] : variantSteps(V_VISITOR_NOTHING)[1];
    const opening = spokenBy([{ player: "Hello there." }, greeting, { player: VISITOR_QUESTION_LINE }]);
    const kind = VISITORS[name].kind;
    if (kind === informantRole(player)) {
      const lead = stepById(clue, kind === "citizen" ? CITIZEN_LEAD_STEP : TOURIST_LEAD_STEP)?.steps ?? [];
      return [...opening, ...spokenBy([clue[3], clue[4], ...lead])];
    }
    const id = NO_LEAD_STEP_IDS[Math.floor(Math.random() * NO_LEAD_STEP_IDS.length)];
    return [...opening, ...spokenBy(stepById(variantSteps(V_VISITOR_NOTHING), id)?.steps ?? [])];
  }

  // ==========================================================================
  // The charter crews, Betty and the Varrock Museum
  // ==========================================================================

  /**
   * CharterShips claims the charter crew's Talk-to, so play the quest variant first while
   * EAA needs them: any crewmember at the Cothon, Trader Stan or a crewmember at the Port
   * Sarim dock. Everyone else, and completed quests, fall through to the charter menu.
   */
  function talkToTraderCrewmember(event) {
    const { player, npcId } = event;
    const variant = within(player, COTHON)
      ? selectFortisCrewVariant(player)
      : within(player, PORT_SARIM_DOCK) ? selectSarimCrewVariant(player) : null;
    if (!variant) return false;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant, undefined, event.npc ?? null);
    return true;
  }

  /** Using the repaired sails on a Cothon crewmember opens the hand-over. */
  function handleSailsOnCrewmember(event) {
    if (event.itemId !== SAILS_ITEM_ID || !isCrew(event.npcId) || !within(event.player, COTHON)) return;
    event.handled = true;
    if (quest.getStage(event.player) >= STAGE_RETURN_SAILS) return;
    startTranscript(api, event.player, event.npcId, PAGE, V_FORTIS_WITH_SAILS);
  }

  /** Betty's notes open their paper; the first read moves the hunt to Varrock. */
  function readBettyNotes(event) {
    const { player } = event;
    event.handled = true;
    const sender = player.getPacketSender();
    for (let child = 5; child <= 16; child++) sender.sendString(NOTES_LINES[child] ?? "", (NOTES_INTERFACE << 16) | child);
    if (quest.getStage(player) === STAGE_READ_NOTES) {
      quest.setStage(player, STAGE_HAIG);
      readingNotes.add(player);
    }
    sender.sendInterface(NOTES_INTERFACE);
    return true;
  }

  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId !== NOTES_INTERFACE || !readingNotes.has(player)) return;
    readingNotes.delete(player);
    startTranscript(api, player, NpcIdentifiers.BETTY, PAGE, V_NOTES_FIRST);
  }

  /**
   * Dig Site's variant hook owns Haig whenever its own quest has not started, so claim his
   * Talk-to while EAA needs him. A cutscene cut short by a logout resumes with its ending.
   */
  function talkToCuratorHaig(event) {
    if (event.npcId !== HAIG_NPC_ID) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_HAIG || stage >= STAGE_RETURN || scenes.has(player)) return false;
    event.handled = true;
    if (stage >= STAGE_CUTSCENE) {
      advanceStage(player, STAGE_CUTSCENE_END);
      playAfterCutscene(player);
      return true;
    }
    startTranscript(api, player, HAIG_NPC_ID, PAGE, selectHaigVariant(player));
    return true;
  }

  /** Pickpocketing Haig during the storeroom step always yields the key. */
  function pickCuratorPocket(event) {
    if (event.npcId !== HAIG_NPC_ID) return false;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STOREROOM || held(player, STOREROOM_KEY_ITEM_ID)) return false;
    event.handled = true;
    player.performAnimation(new Animation(PICKPOCKET_ANIMATION));
    player.getInventory().adds(STOREROOM_KEY_ITEM_ID, 1);
    startTranscript(api, player, HAIG_NPC_ID, PAGE, V_HAIG_PICKPOCKET);
    return true;
  }

  /**
   * The storeroom door lets its key holder through and shuts behind them: the open door
   * shows for two ticks while the player walks the doorway, as captured.
   */
  function handleStoreroomDoor(request) {
    if (request.handled || request.objectId !== STOREROOM_DOOR_OBJECT_ID) return;
    const { player, object } = request;
    const location = object?.getLocation?.();
    if (!location || location.getX() !== STOREROOM_DOOR_TILE.x || location.getY() !== STOREROOM_DOOR_TILE.y) return;
    request.handled = true;
    const crossing = crossingFor(object, player.getLocation());
    if (!crossing || ObstacleRunner.isBusy(player)) return;
    const entering = crossing.destination.x === location.getX() && crossing.destination.y === location.getY();
    if (entering && !held(player, STOREROOM_KEY_ITEM_ID)) {
      player.sendMessage("The door is locked.");
      return;
    }
    const sender = player.getPacketSender();
    if (entering) {
      player.sendMessage("You use the key to unlock the door.");
      sender.sendSound(DOOR_UNLOCK_SOUND, 1, 0);
    }
    const z = location.getZ(), face = object.getFace();
    const open = new GameObject(STOREROOM_DOOR_OPEN_OBJECT_ID, new Location(location.getX(), location.getY() - 1, z), 0, 0, null);
    sender.sendObject(open).sendObject(new GameObject(STOREROOM_DOORWAY_OBJECT_ID, location.clone(), 0, face, null))
      .sendSound(DOOR_OPEN_SOUND, 1, 0);
    ObstacleRunner.run({ player, object }, [{ walk: [[crossing.destination.x, crossing.destination.y]] }]);
    later(player, DOOR_RESET_TICKS, () => {
      sender.sendObjectRemoval(open).sendObject(new GameObject(STOREROOM_DOOR_OBJECT_ID, location.clone(), 0, face, null));
    });
  }

  function searchDiademCrate(event) {
    if (event.definition?.id !== DIADEM_CRATE_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_STOREROOM) return false;
    // Claim every later search too, so repeat clicks never replay the find.
    event.handled = true;
    if (quest.getStage(player) < STAGE_CONFRONT) startTranscript(api, player, HAIG_NPC_ID, PAGE, V_HAIG_CRATE);
    return true;
  }

  function searchFlavourCrates(event) {
    if (event.definition?.id !== FLAVOUR_CRATES_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_STOREROOM) return false;
    event.handled = true;
    startTranscript(api, player, HAIG_NPC_ID, PAGE, V_HAIG_CRATES);
    return true;
  }

  // ==========================================================================
  // The interrogation and Haig's story
  // ==========================================================================

  class EaaScene extends PrivateArea {
    constructor(player, [minX, maxX, minY, maxY]) {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.owner = player;
    }
    canAttack() { return false; }
    canTeleport() { return false; }
    postLeave(mobile, logout) {
      const scene = scenes.get(mobile);
      if (mobile === this.owner && scene?.area === this) {
        scene.area = null;
        endScene(mobile, logout);
      }
      super.postLeave(mobile, logout);
    }
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(OVERLAY_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function controls(player, active) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active);
    player.getPacketSender().sendVarbit(CUTSCENE_STATUS_VARBIT, active ? 1 : 0).sendVarbit(MINIMAP_STATE_VARBIT, active ? 2 : 0);
  }

  /** An empty chatbox the player cannot continue: the capture's held moments. */
  function hold(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) })
    ));
  }

  function cameraOn(player, look) {
    player.getPacketSender().sendCameraMoveTo(...CONFRONT_CAMERA, CAMERA_RATES).sendCameraLookAt(...look, CAMERA_RATES);
  }

  function turn(player, yaw) {
    player.getPacketSender().sendCameraRotateBy(0, yaw, TURN_CYCLES, "linear");
  }

  function actor(player, scene, id, [x, y], face) {
    const npc = api.spawnNpc({ id, x, y, z: 0, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return null;
    scene.area.add(npc);
    scene.actors.push(npc);
    npc.setPositionToFace(new Location(face[0], face[1], 0));
    return npc;
  }

  function enterArea(player, scene, bounds) {
    scene.area = new EaaScene(player, bounds);
    scene.area.enter(player);
  }

  function removeActors(scene) {
    for (const npc of scene.actors.splice(0)) api.removeNpc(npc);
  }

  /** Plays scene lines in order; each step can act as its line appears. */
  function play(player, steps, done) {
    const scene = scenes.get(player);
    if (!scene) return;
    const [step, ...rest] = steps;
    if (!step) {
      done?.();
      return;
    }
    scene.resume = () => play(player, steps, done);
    step.before?.();
    const chain = new DialogueChainBuilder();
    chain.add(step.player ? new PlayerDialogue(0, step.text) : new NpcDialogue(0, HAIG_ACTOR_NPC_ID, step.text));
    chain.add(new ActionDialogue(1, { execute: () => play(player, rest, done) }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** A transcript line as a scene step. */
  function sceneLine(step, before) {
    return { player: step.player !== undefined, text: step.player ?? step.text, before };
  }

  function beginInterrogation(player) {
    if (scenes.has(player)) return;
    const scene = { actors: [], area: null, menus: [], resume: null };
    scenes.set(player, scene);
    controls(player, true);
    hold(player);
    fade(player, true);
    later(scene, 2, () => {
      enterArea(player, scene, VARROCK_MUSEUM);
      player.moveTo(new Location(...CONFRONT_TILE, 0));
      player.setPositionToFace(new Location(CONFRONT_TILE[0] - 1, CONFRONT_TILE[1], 0));
      scene.haig = actor(player, scene, HAIG_ACTOR_NPC_ID, CONFRONT_HAIG_TILE, CONFRONT_TILE);
    });
    later(scene, 3, () => cameraOn(player, LOOK_AT_HAIG));
    later(scene, 4, () => fade(player, false));
    later(scene, 6, () => {
      setShame(player, SHAME_START);
      cameraOn(player, LOOK_AT_HAIG);
      play(player, openingSteps(player, scene), () => shameRound(player));
    });
    scene.watchdog = () => watch(player, scene);
    later(scene, 1, scene.watchdog);
  }

  /** The recorded opening, from the transcript's lines, with the capture's camera and meter. */
  function openingSteps(player, scene) {
    const lines = stepsAfter(variantSteps(V_HAIG_FOUND), INTERROGATION_START_STEP);
    const opening = lines.slice(0, lines.findIndex((step) => step.type === "choice"));
    const cues = [
      () => cameraOn(player, LOOK_AT_HAIG),
      () => scene.haig?.performAnimation(new Animation(HAIG_TALK_ANIMATION)),
      () => cameraOn(player, LOOK_AT_PLAYER),
      () => cameraOn(player, LOOK_AT_HAIG),
      () => cameraOn(player, LOOK_AT_PLAYER),
      () => { cameraOn(player, LOOK_AT_HAIG); advanceStage(player, STAGE_SHAME); },
      () => { cameraOn(player, LOOK_AT_PLAYER); player.getPacketSender().sendSubInterface(OVERLAY_UID, SHAME_INTERFACE, 1); },
      () => { turn(player, TURN_YAW); setShame(player, shame(player) + SHAME_OPENING[0]); },
      () => turn(player, -TURN_YAW),
      () => { turn(player, TURN_YAW); setShame(player, shame(player) + SHAME_OPENING[1]); },
    ];
    return opening.map((step, index) => sceneLine(step, cues[index]));
  }

  /** The transcript's argument options, in its fixed groups of three. */
  function shameMenus() {
    const options = stepsAfter(variantSteps(V_HAIG_FOUND), INTERROGATION_START_STEP).find((step) => step.type === "choice")?.options ?? [];
    const menus = [];
    for (let index = 0; index + 3 <= options.length; index += 3) menus.push(options.slice(index, index + 3));
    return menus;
  }

  function shameStep() {
    return SHAME_STEP_MIN + Math.floor(Math.random() * (SHAME_STEP_MAX - SHAME_STEP_MIN + 1));
  }

  // ponytail: the capture shows +4..+9 for shaming options; the falls for the Wiki's
  // "decrease" options and the order of menus are not recorded, so both are random.
  function shameRound(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    if (scene.menus.length === 0) scene.menus = shameMenus().sort(() => Math.random() - 0.5);
    const menu = scene.menus.shift();
    turn(player, -TURN_YAW);
    const present = () => {
      player.getDialogueManager().reset();
      api.sendMultiChatboxPrompt(player, "Select an option", ...menu.flatMap((option) => [option.text, () => answer(player, option)]));
    };
    scene.resume = present;
    present();
  }

  function answer(player, option) {
    const [said, reply] = option.steps ?? [];
    const delta = (SHAME_INCREASE_OPTIONS.has(option.text) ? 1 : -1) * shameStep();
    const steps = [sceneLine(said ?? { player: option.text })];
    if (reply) steps.push(sceneLine(reply, () => { turn(player, TURN_YAW); setShame(player, shame(player) + delta); }));
    play(player, steps, () => {
      if (shame(player) >= SHAME_MAX) interrogationOver(player, true);
      else if (shame(player) <= 0) interrogationOver(player, false);
      else shameRound(player);
    });
  }

  function interrogationOver(player, passed) {
    const variant = variantSteps(V_HAIG_FOUND);
    const lines = stepsAfter(variant, INTERROGATION_START_STEP);
    const closing = lines[lines.findIndex((step) => step.type === "choice") + 1];
    const branch = stepById(variant, passed ? INTERROGATION_PASSED_STEP : INTERROGATION_FAILED_STEP)?.steps ?? [];
    const spoken = branch.slice(0, branch.findIndex((step) => step.type === "action" || step.type === "end"));
    const steps = [sceneLine(closing, () => {
      if (passed) advanceStage(player, STAGE_CUTSCENE);
      turn(player, -TURN_YAW);
      player.getPacketSender().closeSubInterface(OVERLAY_UID);
    })];
    spoken.forEach((step, index) => steps.push(sceneLine(step, () => cameraOn(player, index % 2 === 0 ? LOOK_AT_HAIG : LOOK_AT_PLAYER))));
    play(player, steps, () => (passed ? flashback(player) : walkOut(player)));
  }

  /** Haig's story in the Grand Museum, with the capture's actors, timing and pans. */
  function flashback(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    scene.resume = null;
    hold(player);
    fade(player, true);
    const story = stepsAfter(variantSteps(V_HAIG_FOUND), CUTSCENE_BEGIN_STEP).filter((step) => step.type === "line");
    later(scene, 2, () => {
      removeActors(scene);
      const previous = scene.area;
      scene.area = null;
      previous?.leave(player, false);
      enterArea(player, scene, FORTIS_MUSEUM);
      player.moveTo(new Location(1712, 3167, 0));
      scene.haig = actor(player, scene, HAIG_ACTOR_NPC_ID, [1704, 3165], [1702, 3165]);
      scene.thief = actor(player, scene, THIEF_ACTOR_NPC_ID, [1720, 3164], [1722, 3164]);
    });
    later(scene, 3, () => player.getPacketSender().sendCameraMoveTo(1712, 3160, 500, CAMERA_RATES).sendCameraLookAt(1702, 3166, 499, CAMERA_RATES));
    later(scene, 4, () => fade(player, false));
    later(scene, 6, () => play(player, [
      sceneLine(story[0], () => scene.haig?.performAnimation(new Animation(HAIG_TALK_ANIMATION))),
      sceneLine(story[1]),
      sceneLine(story[2], () => scene.haig?.setPositionToFace(new Location(1720, 3165, 0))),
    ], () => thiefAppears(player, scene, story)));
  }

  function thiefAppears(player, scene, story) {
    scene.resume = null;
    hold(player);
    scene.haig?.getMovementQueue().addSteps(new Location(1705, 3164, 0));
    scene.haig?.getMovementQueue().addSteps(new Location(1710, 3164, 0));
    scene.thief?.getMovementQueue().addSteps(new Location(1714, 3164, 0));
    later(scene, 1, () => player.getPacketSender()
      .sendCameraMoveTo(1712, 3160, 300, { cycles: 210, easing: "ease_out_sine", ignoreTerrain: true })
      .sendCameraLookAt(1712, 3168, 499, { cycles: 210, easing: "ease_out_sine" }));
    later(scene, 7, () => play(player, [sceneLine(story[3]), sceneLine(story[4])], () => fight(player, scene, story)));
  }

  function fight(player, scene, story) {
    scene.resume = null;
    hold(player);
    scene.haig?.setMovementSteps?.(2);
    scene.haig?.getMovementQueue().addSteps(new Location(1712, 3164, 0));
    scene.thief?.getMovementQueue().addSteps(new Location(1713, 3164, 0));
    later(scene, 1, () => {
      scene.haig?.setMovementSteps?.(1);
      scene.haig?.performAnimation(new Animation(HAIG_PUNCH_ANIMATIONS[0]));
      scene.thief?.performAnimation(new Animation(THIEF_SWING_ANIMATION));
    });
    later(scene, 2, () => scene.haig?.performAnimation(new Animation(HAIG_PUNCH_ANIMATIONS[1])));
    later(scene, 3, () => scene.haig?.performAnimation(new Animation(HAIG_PUNCH_ANIMATIONS[2])));
    later(scene, 4, () => scene.thief?.performAnimation(new Animation(THIEF_FALL_ANIMATION)));
    later(scene, 5, () => play(player, [sceneLine(story[5]), sceneLine(story[6])], () => storyEnds(player, scene)));
  }

  function storyEnds(player, scene) {
    scene.resume = null;
    hold(player);
    scene.haig?.performAnimation(new Animation(PICKUP_ANIMATION));
    later(scene, 3, () => scene.haig?.getMovementQueue().addSteps(new Location(1712, 3161, 0)));
    later(scene, 4, () => {
      advanceStage(player, STAGE_CUTSCENE_END);
      fade(player, true);
    });
    later(scene, 6, () => leaveScene(player, true));
  }

  /** Back to Haig in the Varrock Museum: fade in, then (after the story) his reply. */
  function leaveScene(player, afterStory) {
    if (!scenes.has(player)) return;
    endScene(player, false);
    later(player, 2, () => fade(player, false));
    if (afterStory) later(player, 4, () => playAfterCutscene(player));
  }

  /** A failed interrogation fades back to the museum; talking to Haig again starts over. */
  function walkOut(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    scene.resume = null;
    hold(player);
    fade(player, true);
    later(scene, 2, () => leaveScene(player, false));
  }

  function playAfterCutscene(player) {
    startTranscript(api, player, HAIG_NPC_ID, PAGE, V_HAIG_FOUND, (steps) => stepsAfter(steps, CUTSCENE_END_STEP));
  }

  /** Ends any scene: actors gone, controls and camera back, the player back with Haig. */
  function endScene(player, logout) {
    const scene = scenes.get(player);
    if (!scene) return;
    scenes.delete(player);
    TaskManager.cancelTasks(scene);
    removeActors(scene);
    controls(player, false);
    player.getPacketSender().closeSubInterface(OVERLAY_UID).sendCameraReset();
    const area = scene.area;
    scene.area = null;
    if (area && player.getArea() === area) area.leave(player, logout);
    player.moveTo(new Location(...SCENE_END_TILE, 0));
    player.setPositionToFace(new Location(SCENE_END_TILE[0] - 1, SCENE_END_TILE[1], 0));
    if (!logout) player.getDialogueManager().reset();
  }

  /** A scene dialogue or menu closed by the player (Escape, a click) comes back. */
  function watch(player, scene) {
    if (scenes.get(player) !== scene) return;
    const open = player.getDialogueManager().isActive?.() === true || MultiChatboxPrompt.getPending?.(player);
    if (!open && scene.resume) scene.resume();
    later(scene, 1, scene.watchdog);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I investigated the theft of Xerna's Diadem from the Grand</str>",
        "<str>Museum in Civitas illa Fortis and traced it to Curator Haig</str>",
        "<str>Halen in Varrock. I confronted him and he agreed to have the</str>",
        "<str>diadem returned to the Grand Museum.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN) {
      return [
        "Haig Halen agreed to return Xerna's Diadem to the Grand Museum.",
        "",
        "I should tell <col=800000>Curator Herminius</col> in Civitas illa Fortis",
        "that the diadem is on its way back.",
      ];
    }
    if (stage >= STAGE_SHAME) {
      return [
        "I found Xerna's Diadem in the Varrock Museum storeroom.",
        "",
        "I should shame <col=800000>Curator Haig Halen</col> into admitting",
        "that he took it, until he agrees to return it.",
      ];
    }
    if (stage >= STAGE_CONFRONT) {
      return [
        "I found Xerna's Diadem in a crate in the Varrock Museum",
        "storeroom, along with other stolen artefacts.",
        "",
        "I should confront <col=800000>Curator Haig Halen</col> about it.",
      ];
    }
    if (stage >= STAGE_STOREROOM) {
      return [
        "Curator Haig Halen denied knowing anything about the diadem.",
        "",
        "I should pickpocket him for the storeroom key, then search the",
        "crate in the museum storeroom.",
      ];
    }
    if (stage >= STAGE_HAIG) {
      return [
        "The runes Betty's notes described are those for Varrock",
        "Teleport, and the grey-haired man matches <col=800000>Curator Haig",
        "Halen</col> of the Varrock Museum.",
        "",
        "I should ask him about Xerna's Diadem.",
      ];
    }
    if (stage >= STAGE_READ_NOTES) {
      return [
        "Betty in Port Sarim gave me notes on the strange rune order",
        "the grey-haired man asked about.",
        "",
        "I should read <col=800000>Betty's notes</col>.",
      ];
    }
    if (stage >= STAGE_BETTY) {
      return [
        "The trader crew in Port Sarim said the grey-haired man with",
        "the case headed north to buy runes.",
        "",
        "I should ask <col=800000>Betty</col> in her magic shop.",
      ];
    }
    if (stage >= STAGE_PORT_SARIM) {
      return [
        "The man with the case sailed to Port Sarim.",
        "",
        "I should ask the trader crew at the southern dock there where",
        "he went.",
      ];
    }
    if (stage >= STAGE_RETURN_SAILS) {
      return [
        "The trader crew told me the grey-haired man with the case",
        "chartered a ship to Port Sarim.",
        "",
        "I should make my way to Port Sarim and ask about him there.",
      ];
    }
    if (stage >= STAGE_REPAIR) {
      return [
        "The trader crew in the Fortis Cothon asked me to get their",
        "tattered sails repaired in return for information.",
        "",
        hasFlag(player, BIT_FIXED_SAILS)
          ? "I should return the <col=800000>repaired sails</col> to the crew."
          : "I should take the <col=800000>tattered sails</col> to Artima's crafting shop.",
      ];
    }
    if (stage >= STAGE_CREW) {
      return [
        "Regulus Cento said the suspicious man headed east to the",
        "Fortis Cothon.",
        "",
        "I should ask a <col=800000>trader crewmember</col> there about him.",
      ];
    }
    if (stage >= STAGE_REGULUS) {
      return [
        "Someone saw a shifty individual leave the Grand Museum and",
        "head towards the quetzal landing site.",
        "",
        "I should ask <col=800000>Regulus Cento</col> there.",
      ];
    }
    if (stage >= STAGE_CLUE) {
      return [
        "I found evidence the diadem was stolen by a professional",
        "thief and asked the museum visitors about it.",
        "",
        "I should follow the lead to the quetzal landing site.",
      ];
    }
    if (stage >= STAGE_INVESTIGATE) {
      return [
        "Curator Herminius asked me to look around the museum for",
        "anything he might have missed.",
        "",
        "I should investigate the tools behind the display and then",
        "inspect the empty display again.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I inspected the empty display in the Grand Museum and spoke",
        "to <col=800000>Curator Herminius</col> about the stolen diadem.",
        "",
        "I should ask him how I can help.",
      ];
    }
    return [
      "I can start this quest by investigating the <col=800000>Empty Display</col>",
      "on the ground floor of the Grand Museum in Civitas illa Fortis.",
      "",
      "I need 25 Thieving, and to have completed Children of the Sun",
      "and Shield of Arrav.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 6000);
    // registerQuest adds one coin; top the stack up to 5,000.
    player.getInventory().adds(COINS_ITEM_ID, 4999);
    if (held(player, BETTYS_NOTES_ITEM_ID)) player.getInventory().deleteNumber(BETTYS_NOTES_ITEM_ID, 1);
    later(player, DIADEM_RETURN_TICKS, () => {
      if (player.isRegistered?.() !== false && !hasFlag(player, BIT_DIADEM)) setFlag(player, BIT_DIADEM, DIADEM_VARBIT);
    });
  }

  // ==========================================================================
  // Login / logout
  // ==========================================================================

  /** Mirrors the side flags. Older saves set the diadem early; it returns only on completion. */
  function syncSideVarbits({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const complete = quest.isComplete(player);
    if (hasFlag(player, BIT_DIADEM) !== complete) {
      player.setAttribute(FLAGS_ATTRIBUTE, complete ? flags(player) | BIT_DIADEM : flags(player) & ~BIT_DIADEM);
    }
    const bits = flags(player);
    const sender = player.getPacketSender();
    for (const [bit, varbitId] of FLAG_VARBITS) sender.sendVarbit(varbitId, (bits & bit) !== 0 ? 1 : 0);
    sender.sendVarbit(SHAME_VARBIT, shame(player));
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) endScene(player, true);
  }

  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  api.persistAttribute(INFORMANT_ATTRIBUTE);
  api.persistAttribute(SHAME_ATTRIBUTE, 0);
  api.persistAttribute(PENDING_SAILS_ATTRIBUTE, false);
  api.persistAttribute(DECLINED_FAVOUR_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "ethically_acquired_antiquities",
    name: "Ethically Acquired Antiquities",
    varpId: VARP_EAA,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 6000, label: "Thieving" }],
    rewardItemId: COINS_ITEM_ID,
    scrollItemId: DIADEM_ITEM_ID,
    rewardItemLabel: "5,000 Coins",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:condition", handleChosenCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onObjectInteraction("Empty display", { Inspect: inspectEmptyDisplay });
  api.onObjectInteraction("Xerna's Diadem", { Inspect: inspectDiademDisplay });
  api.onObjectInteraction("Tools", { Investigate: investigateTools });
  api.onObjectInteraction("Crate", { Search: searchDiademCrate });
  api.onObjectInteraction("Crates", { Search: searchFlavourCrates });
  api.onCustomEvent("door:toggle", handleStoreroomDoor);
  api.onNpcInteraction("Curator Haig Halen", {
    "Talk-to": talkToCuratorHaig,
    Pickpocket: pickCuratorPocket,
  });
  for (const name of Object.keys(VISITORS)) api.onNpcInteraction(name, { "Talk-to": talkToVisitor });
  api.onNpcsInteraction(CREW_NAMES, { "Talk-to": talkToTraderCrewmember });
  // ItemIdentifiers.BETTYS_NOTES (29905): inventory option "Read".
  api.onItemAction("Betty's notes", { Read: readBettyNotes });
  api.onItemOnNpc(handleSailsOnCrewmember, { noted: false });
  api.onCustomEvent("player:bootstrap-complete", syncSideVarbits);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
