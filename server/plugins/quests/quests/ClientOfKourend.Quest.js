/**
 * Client of Kourend (members).
 *
 * The words come from the "Client of Kourend" transcript page; this plugin
 * supplies the variant selector for Veos and the five general store owners, the
 * start hook, the prose-condition answers, the feather-on-scroll quill creation,
 * the per-city note-taking, the orb hand-over/shattering and the completion.
 *
 * Stages (persisted quest attribute quest.client_of_kourend.stage):
 *   0 not started
 *   1 Veos gave the enchanted scroll
 *   2 all five store owners interviewed (veos_reveal set; whisper heard)
 *   3 Veos took the scroll and quill and gave the mysterious orb
 *   4 orb shattered at the Dark Altar
 *   5 complete (1 QP, Kharedst's memoirs, two antique lamps)
 *
 * Varps/varbits (lookup-gameval.ts varbit veos):
 *   varp 1566 "veos_quest"; house bits 5620 veos_piscarilius, 5621 veos_arceuus,
 *   5622 veos_lovakengj, 5623 veos_shayzien, 5624 veos_hosidius, 5625 veos_reveal.
 *   Each house bit and the reveal bit are written with sendVarbit (siblings in the
 *   shared varp survive); the whisper bit 5625 is set with the fifth owner.
 *   5619 veos_progress (varp 1566) is the real Client of Kourend stage varbit and
 *   is written by registerQuest's setStage. Live (rsprox captures local 1001998,
 *   1002104, 1001445) sends 1 at the start, 2 with the fifth owner's notes, 3 when
 *   the player agrees to one last task (saved here as TASK_OFFERED_ATTRIBUTE on durable
 *   stage 2), 4 with the orb, 5 when it shatters, 6 when the client takes Veos over,
 *   7 at completion (the cache's quest dbrow endstate) and 8, 9 as each antique lamp
 *   is used (LAMPS_USED_ATTRIBUTE). The durable stages stay 1-5 so old saves load.
 *   X Marks the Spot uses its own varp 2111/varbit 8063 (cluequest).
 *   5626 veos_housereward (legacy favour-certificate pick) is never touched.
 *
 * Source: OSRS Wiki "Client of Kourend" and "Transcript:Client of Kourend"; cache
 * ids from the generated identifiers. The orb (21261) shatters into broken glass
 * and granting it at the altar is not the completion: the finishing-up dialogue
 * with Veos ends in the M9w-_K "Quest complete!" action, as the transcript shows.
 *
 * Gaps/approximations:
 * - the X Marks the Spot requirement is checked through quest:is-complete when
 *   choosing Veos' variant; the transcript has no refusal branch, so an
 *   unqualified player simply gets Veos' default (standard) transcript.
 * - Client of Kourend's own conversation is offered only at the Piscarilius Veos
 *   (parent 2147, visible 10726/10727). Port Sarim Veos stays with X Marks;
 *   this plugin adds the missing WXJllC and post-X-Marks boat handoff to
 *   1825,3691 without taking that page.
 * - after completion the Piscarilius Veos plays the canonical
 *   standard-dialogue-at-port-piscarilius page; its lost-memoirs condition
 *   (drsnpy) returns 21760 because the generated branch has no item step.
 * - the two antique lamps rub through the shared xpreward interface for 500 XP
 *   each; each one used moves veos_progress on from 7 (8, then 9), as live.
 * - the journal is live's text for each state (local 1001445); before the first city
 *   it shows the quill paragraph until the player holds a quill or has a city's notes
 *   (Ours: live's two views straddle both, ticks 3798 and 4081).
 * - a possession cut short (the chat closed between Veos's "ARGH!" and the end) is not
 *   saved: talking to Veos again plays the finishing-up conversation again (Ours).
 * - "lost" means "not in the backpack" - bank contents are not inspected for the
 *   scroll/orb branches; the memoir reclaim treats a banked book as owned.
 * - a full backpack refuses the normal orb handover and keeps durable stage 2; no
 *   transcript or stage claims receipt without the orb.
 * - the orb activation must be within 6 tiles of the Dark Altar (object 27979 at
 *   1715,3882); anywhere else plays the "doesn't seem to respond" message.
 * - the general store owners' quest variants have no trade steps in the dump, so
 *   their "Let's trade" options close the chat while the quest dialogue is active.
 */
module.exports = function registerClientOfKourendQuest(api) {
  const { Animation, CountdownTask, Graphic, ItemIdentifiers, Location, NpcIdentifiers, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Client of Kourend";
  const START_HOOK = "quest:client-of-kourend:start";
  const X_MARKS_KEY = "x_marks_the_spot";

  const HOUSES_ATTRIBUTE = "quest.client_of_kourend.houses";
  /** Saved: the player agreed to Veos's last task and has not had the orb yet (live's veos_progress 3). */
  const TASK_OFFERED_ATTRIBUTE = "client-of-kourend:task-offered";
  /** Saved: how many of the two antique lamps have been used (live's veos_progress 8 and 9). */
  const LAMPS_USED_ATTRIBUTE = "client-of-kourend:lamps-used";

  const STAGE_STARTED = 1;
  const STAGE_GATHERED = 2;
  const STAGE_ORB = 3;
  const STAGE_ORB_USED = 4;
  const STAGE_COMPLETE = 5;

  const VARP_VEOS_QUEST = 1566; // "veos_quest"
  const VEOS_PROGRESS_VARBIT = 5619; // real quest progress; also the Kourend Castle Teleport unlock
  // veos_progress as live sends it (rsprox local 1001998 ticks 348-2150).
  const VEOS_TASK_OFFERED_VALUE = 3; // "Well, I don't necessarily believe I have much of a choice!"
  const VEOS_ORB_VARBIT_VALUE = 4; // carrying the orb
  const VEOS_ACTIVATED_VARBIT_VALUE = 5; // the orb shattered
  const VEOS_POSSESSED_VALUE = 6; // Veos's "ARGH!" as the client takes him over
  const VEOS_COMPLETE_VARBIT_VALUE = 7; // the quest dbrow's endstate; each lamp used adds one
  const LAMP_COUNT = 2;
  const VEOS_PISCARILIUS_VARBIT = 5620;
  const VEOS_ARCEUUS_VARBIT = 5621;
  const VEOS_LOVAKENGJ_VARBIT = 5622;
  const VEOS_SHAYZIEN_VARBIT = 5623;
  const VEOS_HOSIDIUS_VARBIT = 5624;
  const VEOS_REVEAL_VARBIT = 5625;

  const DARK_ALTAR_X = 1715;
  const DARK_ALTAR_Y = 3882;
  const DARK_ALTAR_RANGE = 6;

  const ENCHANTED_SCROLL_ITEM_ID = ItemIdentifiers.ENCHANTED_SCROLL; // 21259
  const ENCHANTED_QUILL_ITEM_ID = ItemIdentifiers.ENCHANTED_QUILL; // 21260
  const MYSTERIOUS_ORB_ITEM_ID = ItemIdentifiers.MYSTERIOUS_ORB; // 21261
  const ANTIQUE_LAMP_ITEM_ID = ItemIdentifiers.ANTIQUE_LAMP_17; // 21262
  const LAMP_XP = 500;
  const KHAREDSTS_MEMOIRS_ITEM_ID = ItemIdentifiers.KHAREDSTS_MEMOIRS; // 21760
  const BROKEN_GLASS_ITEM_ID = ItemIdentifiers.BROKEN_GLASS_2; // 1469, the shattered orb (local 1001998 tick 1795)

  // Animations, graphics and sounds as live plays them (rsprox local 1001998, 1002104, 1001445).
  const QUILL_PAIN_ANIMATION = 4341; // urn_search_bit, with the player's "ARGH!" (tick 1304)
  const ORB_SCAN_ANIMATION = 2721; // wanted_crystal_ball_scan (tick 1793)
  const ORB_SCAN_GRAPHIC = 454; // wanted_crystal_ball_scan_spotanim, height 92
  const ORB_SCAN_GRAPHIC_HEIGHT = 92;
  const ORB_SCAN_SOUND = 1900; // wanted_scan
  const ORB_SHATTER_DELAY_TICKS = 2; // the scan at 1793, the shatter at 1795 (1002104: 3991, 3993)
  const GLASS_BREAK_SOUND = 2127; // glass_break, with the shatter
  const VEOS_ARGH_ANIMATION = 4341; // urn_search_bit on Veos, this player only (tick 2093)
  const POSSESSION_GRAPHIC = 560; // skeleton_killerwatt_electricshock on Veos (tick 2095)
  const POSSESSION_ANIMATION = 3170; // human_killerwatt_electricshock on Veos (tick 2095)
  const VEOS_CLIENT_HEAD_NPC_ID = NpcIdentifiers.VEOS_2; // 2850 veos_controlled, the client's chat head
  const FEATHER_ITEM_IDS = new Set([
    ItemIdentifiers.FEATHER,
    ItemIdentifiers.STRIPY_FEATHER,
    ItemIdentifiers.RED_FEATHER,
    ItemIdentifiers.BLUE_FEATHER,
    ItemIdentifiers.YELLOW_FEATHER,
    ItemIdentifiers.ORANGE_FEATHER,
  ]);

  // Client of Kourend's own conversations belong to the Piscarilius docks Veos.
  // Port Sarim/Hosted Veos ids stay with X Marks the Spot; this plugin only adds
  // the missing sailing handoff there.
  const PISCARILIUS_VEOS_NPC_IDS = new Set([
    NpcIdentifiers.VEOS_6, // 10726, veos_vis
    NpcIdentifiers.VEOS_7, // 10727, veos_vis_amulet
  ]);
  const PORT_SARIM_VEOS_NPC_IDS = new Set([
    NpcIdentifiers.VEOS, // 8484 veos_visible
    NpcIdentifiers.VEOS_3, // 8630 veos_visible_travel, once Kourend has been visited
    NpcIdentifiers.VEOS_4, // 10723 veos_visible_amulet, X Marks' completed Port Sarim transform
    NpcIdentifiers.VEOS_5, // 10724 veos_visible_travel_amulet
  ]);
  const NARRATOR_NPC_ID = NpcIdentifiers.VEOS_7; // X Marks is complete before the orb/quill narration
  const PISCARILIUS_LANDING = new Location(1825, 3691, 0);
  const ZEAH_VISITED_VARBIT = 4897; // zeah_playerhasvisited, set by the boat ride
  /**
   * Saved, since varbits are not: Veos has sailed the player to Great Kourend once. The Wiki's
   * Wintertodt Camp teleport needs it ("provided they have already taken Veos's ship to Great
   * Kourend once"); it is sent again at login for everything that reads the varbit.
   */
  const ZEAH_VISITED_ATTRIBUTE = "kourend:visited";
  /** Ferries' routes that land in Great Kourend from Port Sarim or Piscarilius. */
  const KOUREND_LANDINGS = new Set(["kourend-piscarilius", "kourend-landsend"]);
  /** Great Kourend and Kebos on the surface (the house's own visit check, House.Construction). */
  const inKourend = (location) => location.getX() >= 1024 && location.getX() < 2048 && location.getY() >= 3200 && location.getY() < 4096;
  const VEOS_SAIL_ACTION_ID = "WXJllC";
  const PORT_SARIM_DESTINATIONS = new Map([
    ["I'd like to travel to Port Piscarilius, please.", "kourend-piscarilius"],
    ["I'd like to travel to Land's End, please.", "kourend-landsend"],
  ]);
  const PISCARILIUS_DESTINATIONS = new Map([
    ["Travel to Port Sarim.", "kourend-sarim"],
    ["Travel to Land's End.", "kourend-landsend"],
  ]);
  const VEOS_DEPARTURE_LINES = new Set([
    "As you wish.",
    "As you wish, I hope you don't get seasick, it is a long voyage.",
  ]);
  const POST_QUEST_VARIANT = "standard-dialogue-at-port-piscarilius";

  // The five house bits: who owns them, which varbit, and the transcript ids.
  const HOUSES = [
    {
      bit: 1 << 0,
      varbitId: VEOS_PISCARILIUS_VARBIT,
      label: "Port Piscarilius",
      variant: "leenz-the-port-piscarilius-general-store-owner",
      npcIds: [NpcIdentifiers.LEENZ],
      notLastConditionId: "wNJVb3",
      lastConditionId: "pH0iXc",
      doneMessageIds: ["R-bhsE"],
      lastMessageIds: ["X2sNMn"],
    },
    {
      bit: 1 << 1,
      varbitId: VEOS_ARCEUUS_VARBIT,
      label: "Arceuus",
      variant: "regath-the-arceuus-general-store-owner",
      npcIds: [NpcIdentifiers.REGATH],
      notLastConditionId: "WDvImY",
      lastConditionId: "DdB4Kn",
      doneMessageIds: ["wgj-O3"],
      lastMessageIds: ["zWo1vb"],
    },
    {
      bit: 1 << 2,
      varbitId: VEOS_LOVAKENGJ_VARBIT,
      label: "Lovakengj",
      variant: "munty-the-lovakengj-general-store-owner",
      npcIds: [NpcIdentifiers.MUNTY],
      // The dump gives both of Munty's conditions the same "was the last"
      // wording, so his pair is told apart by step id alone.
      notLastConditionId: "9RoiXa",
      lastConditionId: "CX8Or4",
      doneMessageIds: ["VGPooZ"],
      lastMessageIds: ["i22ChP"],
    },
    {
      bit: 1 << 3,
      varbitId: VEOS_SHAYZIEN_VARBIT,
      label: "Shayzien",
      variant: "jennifer-the-shayzien-general-store-owner",
      npcIds: [NpcIdentifiers.JENNIFER],
      notLastConditionId: "bXrAXE",
      lastConditionId: "R1Oi1W",
      doneMessageIds: ["R1DD-x"],
      lastMessageIds: ["-_CRFq"],
    },
    {
      bit: 1 << 4,
      varbitId: VEOS_HOSIDIUS_VARBIT,
      label: "Hosidius",
      variant: "horace-the-hosidius-general-store-owner",
      npcIds: [NpcIdentifiers.HORACE],
      notLastConditionId: "k-BFhJ",
      lastConditionId: "isK3zK",
      doneMessageIds: ["2vhmBN"],
      lastMessageIds: ["6fZqvf"],
    },
  ];
  const ALL_HOUSES_MASK = HOUSES.reduce((mask, house) => mask | house.bit, 0);
  const HOUSE_BY_NPC = new Map();
  const HOUSE_BY_MESSAGE = new Map();
  const HOUSE_LAST_MESSAGE = new Set();
  for (const house of HOUSES) {
    for (const npcId of house.npcIds) HOUSE_BY_NPC.set(npcId, house);
    for (const stepId of house.doneMessageIds) HOUSE_BY_MESSAGE.set(stepId, house);
    for (const stepId of house.lastMessageIds) {
      HOUSE_BY_MESSAGE.set(stepId, house);
      HOUSE_LAST_MESSAGE.add(stepId);
    }
  }

  // Prose condition step ids on the "Client of Kourend" page.
  const QUILL_MISSING_CONDITION_IDS = new Set(["Cilrda", "oG6z8m", "aPRr0n", "Dk0yH3", "E5Lcds"]);
  const QUILL_PRESENT_CONDITION_IDS = new Set(["Lm11Ba", "6LpQ8J", "Rd8R--", "fC7NCS", "hH5vKB"]);
  const LOST_SCROLL_FULL_CONDITION_ID = "T3xEGO";
  const LOST_SCROLL_CONDITION_ID = "kKFnIP";
  const HAS_SCROLL_CONDITION_ID = "p0TYrl";
  const HAS_SCROLL_QUILL_CONDITION_ID = "YcV-DQ";
  const LOST_ORB_CONDITION_ID = "LXZxal";
  const HAS_ORB_CONDITION_ID = "mJAvYg";
  const LOST_ORB_FULL_CONDITION_ID = "5IoSGv";
  const LOST_ORB_AGAIN_CONDITION_ID = "LIGbQM";
  const HAS_MEMOIRS_CONDITION_ID = "K8j5Z5";
  const MISSING_MEMOIRS_CONDITION_ID = "drsnpy";

  // Action/message step ids.
  const START_SCROLL_MESSAGE_ID = "qcqaI2";
  const QUILL_RECEIVE_ACTION_ID = "BB5wZw";
  const SCROLL_RETURN_MESSAGE_ID = "y6wsrd";
  const ITEMS_REMOVED_MESSAGE_ID = "4hbSAK";
  const ORB_RECEIVE_ACTION_ID = "YtCvIQ";
  const ORB_HAND_MESSAGE_ID = "jTrDuG";
  const ORB_SAME_AS_ABOVE_ACTION_ID = "R1UtTW";
  const ORB_ANOTHER_MESSAGE_ID = "xa0SlA";
  const ORB_SHATTER_MESSAGE_ID = "vy1GZz";
  const COMPLETE_ACTION_ID = "M9w-_K";
  const QUILL_ATTUNE_MESSAGE_ID = "fHkZpT";
  const QUILL_ALREADY_MESSAGE_ID = "31yBcc";
  const QUILL_ON_SCROLL_MESSAGE_ID = "P5Cowa";
  const QUILL_PAIN_MESSAGE_ID = "3XpnTQ";
  const ORB_WHISPER_MESSAGE_ID = "_AevAk";
  const ORB_NO_RESPONSE_MESSAGE_ID = "U7tFO6";

  // The page's boxes as the Wiki pictures them ({{tbox|pic=...|pic2=...}}) and live opens them:
  // objectbox / objectbox_double with these items, or a plain messagebox (local 1001998).
  const SCROLL_AND_QUILL = [ENCHANTED_SCROLL_ITEM_ID, ENCHANTED_QUILL_ITEM_ID];
  const ITEM_BOXES = new Map([
    [START_SCROLL_MESSAGE_ID, [ENCHANTED_SCROLL_ITEM_ID]],
    [QUILL_ATTUNE_MESSAGE_ID, SCROLL_AND_QUILL],
    [QUILL_ALREADY_MESSAGE_ID, [ENCHANTED_QUILL_ITEM_ID]],
    [QUILL_ON_SCROLL_MESSAGE_ID, [ENCHANTED_QUILL_ITEM_ID]],
    [QUILL_PAIN_MESSAGE_ID, SCROLL_AND_QUILL],
    [ITEMS_REMOVED_MESSAGE_ID, SCROLL_AND_QUILL],
    [ORB_HAND_MESSAGE_ID, [MYSTERIOUS_ORB_ITEM_ID]],
    [ORB_ANOTHER_MESSAGE_ID, [MYSTERIOUS_ORB_ITEM_ID]],
    [ORB_SHATTER_MESSAGE_ID, [BROKEN_GLASS_ITEM_ID]],
    [ORB_NO_RESPONSE_MESSAGE_ID, [MYSTERIOUS_ORB_ITEM_ID]],
  ]);
  const STATEMENT_BOXES = new Set([SCROLL_RETURN_MESSAGE_ID, ORB_WHISPER_MESSAGE_ID]);
  for (const house of HOUSES) {
    for (const stepId of house.doneMessageIds) ITEM_BOXES.set(stepId, SCROLL_AND_QUILL);
    for (const stepId of house.lastMessageIds) STATEMENT_BOXES.add(stepId);
  }

  // Lines the quest acts on (the transcript's words).
  const OVERHEAD_PAIN_LINES = new Set(["ARGH!", "Argh!"]); // the player's, said with the next box
  const TASK_ACCEPTED_LINE = "Well, I don't necessarily believe I have much of a choice!";
  const ORB_HANDOVER_LINE = "My client requires... another simple task.";
  const VEOS_ARGH_LINE = "ARGH!";
  const AFTER_POSSESSION_LINE = "Veos, this isn't funny anymore...";
  const VEOS_CLIENT_SPEAKER = "Veos' Client";
  /** The whisper also goes to chat, as live sends it with each box (ticks 1320, 1795). */
  const ORB_WHISPER_CHAT = "You hear a whisper in your ear.<br>'Return... to Veos. My thanks...'";
  const RETURN_WHISPER = " 'Return to Veos...'";

  let quest;
  const lampPending = new WeakMap();
  const travelPending = new WeakMap();
  const memoirsPending = new WeakSet();
  const MEMOIRS_LINE = "I do have some things for you. Enjoy!";

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const banked = (player, itemId) =>
    (player.getBanks?.() ?? []).some((bank) => Number(bank?.getAmount?.(itemId)) > 0);
  const ownsItem = (player, itemId) => held(player, itemId) || banked(player, itemId);
  const full = (player) => player.getInventory().getFreeSlots() === 0;
  const isPiscariliusVeos = (npcId) => PISCARILIUS_VEOS_NPC_IDS.has(npcId);

  function houses(player) {
    return Number(player.getAttribute(HOUSES_ATTRIBUTE)) || 0;
  }

  function hasHouse(player, house) {
    return (houses(player) & house.bit) !== 0;
  }

  function allOtherHouses(player, houseBit) {
    const mask = ALL_HOUSES_MASK & ~houseBit;
    return (houses(player) & mask) === mask;
  }

  function markHouse(player, house) {
    const bits = houses(player);
    if ((bits & house.bit) === 0) player.setAttribute(HOUSES_ATTRIBUTE, bits | house.bit);
    player.getPacketSender().sendVarbit(house.varbitId, 1);
  }

  function taskOffered(player) {
    return player.getAttribute(TASK_OFFERED_ATTRIBUTE) === true;
  }

  function lampsUsed(player) {
    return Math.min(LAMP_COUNT, Math.max(0, Number(player.getAttribute(LAMPS_USED_ATTRIBUTE)) || 0));
  }

  /** veos_progress for a durable stage, as live sends it (see the header). */
  function progressValue(stage, player) {
    if (stage >= STAGE_COMPLETE) return VEOS_COMPLETE_VARBIT_VALUE + lampsUsed(player);
    if (stage === STAGE_ORB_USED) return VEOS_ACTIVATED_VARBIT_VALUE;
    if (stage === STAGE_ORB) return VEOS_ORB_VARBIT_VALUE;
    if (stage === STAGE_GATHERED && taskOffered(player)) return VEOS_TASK_OFFERED_VALUE;
    return stage;
  }

  /** The player now carries Veos's orb: durable stage 3 (live's 4), the offer is spent. */
  function orbHanded(player) {
    if (quest.getStage(player) >= STAGE_ORB) return;
    player.setAttribute(TASK_OFFERED_ATTRIBUTE, false);
    quest.setStage(player, STAGE_ORB);
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Adds one item and reports whether the player now has it (already-held counts). */
  function give(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getAmount(itemId) > 0) return true;
    if (inventory.getFreeSlots() < 1) return false;
    inventory.adds(itemId, 1);
    return inventory.getAmount(itemId) > 0;
  }

  function removeOneFeather(player) {
    for (const itemId of FEATHER_ITEM_IDS) {
      if (held(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return;
      }
    }
  }

  function nearDarkAltar(player) {
    return player
      .getLocation()
      .isWithinDistance(new Location(DARK_ALTAR_X, DARK_ALTAR_Y, 0), DARK_ALTAR_RANGE);
  }

  function syncHouseVarbits(player) {
    const bits = houses(player);
    for (const house of HOUSES) {
      player.getPacketSender().sendVarbit(house.varbitId, (bits & house.bit) !== 0 ? 1 : 0);
    }
    player
      .getPacketSender()
      .sendVarbit(VEOS_REVEAL_VARBIT, (bits & ALL_HOUSES_MASK) === ALL_HOUSES_MASK ? 1 : 0);
  }

  // The journal as live writes it (rsprox local 1001445, ticks 3798-5478). Struck paragraphs are
  // the same words without their colours.
  const B = "<col=000080>";
  const R = "<col=800000>";
  const JOURNAL_AGREED = [
    `${B}I have agreed to help ${R}Veos${B} and his ${R}Mysterious Client${B} gather`,
    `${B}information on the five cities of ${R}Great Kourend${B}. ${B}To gather the`,
  ];
  const JOURNAL_SCROLL_ONLY = [
    `${B}information, ${R}Veos${B} gave me an ${R}Enchanted Scroll${B} to write it on.`,
    `${B}To do this I'll also need an ${R}Enchanted Quill${B}. I can make one by`,
    `${B}using a ${R}Feather${B} on the ${R}Enchanted Scroll${B}.`,
  ];
  const JOURNAL_TAUGHT = [
    `${B}information, ${R}Veos${B} gave me an ${R}Enchanted Scroll${B} and taught me`,
    `${B}how to make an ${R}Enchanted Quill${B}. ${R}Veos${B} suggested I gather the`,
    `${B}information by talking to the ${R}General Store Owners${B} of each`,
    `${B}city.`,
  ];
  const JOURNAL_STRUCK_START = [
    "<str>I agreed to help Veos and his Mysterious Client gather",
    "<str>information on the five cities of Great Kourend. To gather the",
    "<str>information, Veos gave me an Enchanted Scroll and taught me",
    "<str>how to make an Enchanted Quill. Veos suggested I gather the",
    "<str>information by talking to the General Store Owners of each",
    "<str>city.",
  ];
  const JOURNAL_GATHERED = [
    `${B}I spoke to all of the ${R}General Store Owners${B}. While speaking with`,
    `${B}the ${R}Arceuus Store Owner${B}, the ${R}Dark Altar${B} was mentioned. The`,
    `${B}mention of this caused the ${R}Enchanted Quill${B} to glow and`,
  ];
  const JOURNAL_STRUCK_GATHERED = [
    "<str>I spoke to all of the General Store Owners. While speaking with",
    "<str>the Arceuus Store Owner, the Dark Altar was mentioned. The",
    "<str>mention of this caused the Enchanted Quill to glow and",
    "<str>damage my hand.",
  ];
  const JOURNAL_RETURNED = `${B}I returned to ${R}Veos${B} who informed me that his ${R}Mysterious Client${B}`;
  const JOURNAL_ORB = [
    JOURNAL_RETURNED,
    `${B}had another task for me. ${R}Veos${B} gave me a ${R}Mysterious Orb${B} and`,
    `${B}asked me to activate it next to the ${R}Dark Altar${B}.`,
  ];
  const JOURNAL_STRUCK_ORB = [
    "<str>I returned to Veos who informed me that his Mysterious Client",
    "<str>had another task for me. Veos gave me a Mysterious Orb and",
    "<str>asked me to activate it next to the Dark Altar.",
  ];
  /** The cities in the journal's (alphabetical) order. */
  const JOURNAL_CITIES = ["Arceuus", "Hosidius", "Lovakengj", "Port Piscarilius", "Shayzien"];

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      // No capture opens the journal before the start; the overview reads this start sentence.
      return [
        "I can start this quest by speaking to <col=800000>Veos</col>",
        "at the <col=800000>Port Sarim</col> docks, then sailing to",
        "<col=800000>Great Kourend</col>.",
        "",
        "I must have completed <col=800000>X Marks the Spot</col>.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        ...JOURNAL_STRUCK_START, ...JOURNAL_STRUCK_GATHERED, ...JOURNAL_STRUCK_ORB,
        "<str>I activated the Mysterious Orb near the Dark Altar and it",
        "<str>exploded with power.",
        "<str>I returned to Veos to let him know what had happened but he",
        "<str>had no memory of the previous events. Suddenly, his eyes",
        "<str>glowed red and his body was taken over by his Mysterious",
        "<str>Client. The Mysterious Client thanked me for my help and had",
        "<str>Veos reward me.",
        "",
        "<col=ff0000>QUEST COMPLETE!",
      ];
    }
    if (stage === STAGE_STARTED) {
      if (!held(player, ENCHANTED_QUILL_ITEM_ID) && houses(player) === 0) return [...JOURNAL_AGREED, ...JOURNAL_SCROLL_ONLY];
      const owners = HOUSES.reduce((map, house) => map.set(house.label, hasHouse(player, house)), new Map());
      return [
        ...JOURNAL_AGREED, ...JOURNAL_TAUGHT, "",
        `${B}I should speak to the ${R}General Store Owners${B} of:`,
        ...JOURNAL_CITIES.map((city) => (owners.get(city) ? `<str>${city}` : `${R}${city}`)),
      ];
    }
    if (stage === STAGE_GATHERED && !taskOffered(player)) {
      return [
        ...JOURNAL_STRUCK_START, ...JOURNAL_GATHERED,
        `${B}damage my hand. I should head back to ${R}Veos${B} and let him know`,
        `${B}that I've completed my task.`,
      ];
    }
    if (stage === STAGE_GATHERED) {
      return [...JOURNAL_STRUCK_START, ...JOURNAL_STRUCK_GATHERED, JOURNAL_RETURNED, `${B}had another task for me. I should ask him what it is.`];
    }
    if (stage === STAGE_ORB) return [...JOURNAL_STRUCK_START, ...JOURNAL_STRUCK_GATHERED, ...JOURNAL_ORB];
    return [
      ...JOURNAL_STRUCK_START, ...JOURNAL_STRUCK_GATHERED, ...JOURNAL_STRUCK_ORB,
      `${B}I activated the ${R}Mysterious Orb${B} near the ${R}Dark Altar${B} and it`,
      `${B}exploded with power. I should return to ${R}Veos${B} and let him know`,
      `${B}what happened.`,
    ];
  }

  function grantReward(player) {
    // Two 500-XP antique lamps; registerQuest adds Kharedst's memoirs. Use the
    // reward path's forceAdd so a full backpack drops them instead of losing them.
    const inventory = player.getInventory();
    for (let lamp = 0; lamp < 2; lamp++) {
      inventory.forceAdd(player, new api.core.Item(ANTIQUE_LAMP_ITEM_ID, 1));
    }
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (lampPending.get(player)?.item !== item) return null;
    lampPending.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, true);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    // Each lamp used moves veos_progress on: 7, 8, 9 (local 1001998 ticks 2140, 2150).
    player.setAttribute(LAMPS_USED_ATTRIBUTE, Math.min(LAMP_COUNT, lampsUsed(player) + 1));
    if (quest.isComplete(player)) player.getPacketSender().sendVarbit(VEOS_PROGRESS_VARBIT, progressValue(quest.getStage(player), player));
    return `<col=0000ff>Your wish has been granted!</col><br>You have been awarded ${LAMP_XP} ${name ?? skill.getName()} experience!`;
  }

  /** The two quest lamps rub through the shared xpreward interface (XpReward.plugin.js). */
  function rubLamp(event) {
    if (event.itemId !== ANTIQUE_LAMP_ITEM_ID) return false;
    const { player, item, slot } = event;
    lampPending.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  /** Which transcript variant each quest NPC plays, by stage. */
  function selectVariant({ npcId, player }) {
    // A new Talk-to starts a fresh transcript. A prior accepted travel choice may
    // have been cancelled before its departure line, so discard that destination.
    if (isPiscariliusVeos(npcId) || PORT_SARIM_VEOS_NPC_IDS.has(npcId)) travelPending.delete(player);
    const house = HOUSE_BY_NPC.get(npcId);
    if (house) {
      return questActive(player) ? house.variant : null;
    }
    if (!isPiscariliusVeos(npcId)) return null;
    if (quest.isComplete(player)) return POST_QUEST_VARIANT;
    const stage = quest.getStage(player);
    if (stage >= STAGE_ORB_USED) {
      return "finishing-up";
    }
    // Live's veos_progress 3 (the task agreed, no orb yet) talks as after the orb: a missing orb
    // is handed over there.
    if (stage >= STAGE_ORB || (stage === STAGE_GATHERED && taskOffered(player))) {
      return "returning-to-veos-talking-to-veos-again-after-receiving-the-orb";
    }
    if (stage >= STAGE_GATHERED) return "returning-to-veos";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-veos-again";
    // X Marks the Spot gates the conversation; otherwise leave Veos to it.
    return isQuestComplete(player, X_MARKS_KEY) ? "starting-off" : null;
  }

  /** Answer the page's prose conditions. `stepId` disambiguates repeated wording. */
  function answerCondition({ npcId, player, stepId }) {
    const house = HOUSE_BY_NPC.get(npcId);
    if (house) {
      if (stepId === house.notLastConditionId) return !allOtherHouses(player, house.bit);
      if (stepId === house.lastConditionId) return allOtherHouses(player, house.bit);
      if (QUILL_MISSING_CONDITION_IDS.has(stepId)) {
        return !(held(player, ENCHANTED_SCROLL_ITEM_ID) && held(player, ENCHANTED_QUILL_ITEM_ID));
      }
      if (QUILL_PRESENT_CONDITION_IDS.has(stepId)) {
        return held(player, ENCHANTED_SCROLL_ITEM_ID) && held(player, ENCHANTED_QUILL_ITEM_ID);
      }
      return null;
    }
    if (!isPiscariliusVeos(npcId)) return null;
    if (stepId === HAS_MEMOIRS_CONDITION_ID) return ownsItem(player, KHAREDSTS_MEMOIRS_ITEM_ID);
    if (stepId === MISSING_MEMOIRS_CONDITION_ID) return !ownsItem(player, KHAREDSTS_MEMOIRS_ITEM_ID);
    const hasScroll = held(player, ENCHANTED_SCROLL_ITEM_ID);
    const hasQuill = held(player, ENCHANTED_QUILL_ITEM_ID);
    const hasOrb = held(player, MYSTERIOUS_ORB_ITEM_ID);
    switch (stepId) {
      case LOST_SCROLL_FULL_CONDITION_ID:
        return !hasScroll && full(player);
      case LOST_SCROLL_CONDITION_ID:
        return !hasScroll;
      case HAS_SCROLL_CONDITION_ID:
        return hasScroll;
      case HAS_SCROLL_QUILL_CONDITION_ID:
        return hasScroll && hasQuill;
      case LOST_ORB_CONDITION_ID:
        return !hasOrb;
      case HAS_ORB_CONDITION_ID:
        return hasOrb;
      case LOST_ORB_FULL_CONDITION_ID:
        return !hasOrb && full(player);
      case LOST_ORB_AGAIN_CONDITION_ID:
        return !hasOrb;
      default:
        return null;
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !isPiscariliusVeos(npcId)) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function markZeahVisited(player) {
    const first = player.getAttribute(ZEAH_VISITED_ATTRIBUTE) !== true;
    player.setAttribute(ZEAH_VISITED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(ZEAH_VISITED_VARBIT, 1);
    // Port Sarim's Veos gains his Port Piscarilius and Land's End options (X Marks the Spot shows him).
    if (first) api.emitCustomEvent("kourend:visited", { player });
  }

  function landAtPiscarilius(player) {
    player.moveTo(new Location(PISCARILIUS_LANDING.getX(), PISCARILIUS_LANDING.getY(), 0));
    markZeahVisited(player);
  }

  /** X Marks' completed Port Sarim Veos still needs the canonical boat handoff. */
  function sailToPiscarilius(event) {
    event.handled = true;
    landAtPiscarilius(event.player);
  }

  function rememberSailChoice({ npcId, player, option }) {
    if (!PORT_SARIM_VEOS_NPC_IDS.has(npcId) && !isPiscariliusVeos(npcId)) return;
    travelPending.delete(player);
    const route = (isPiscariliusVeos(npcId)
      ? PISCARILIUS_DESTINATIONS
      : PORT_SARIM_DESTINATIONS).get(option);
    if (route) travelPending.set(player, { npcId, route });
  }

  function finishSailLine(event) {
    const { npcId, npc, player, text } = event;
    const pending = travelPending.get(player);
    if (!pending || pending.npcId !== npcId || !VEOS_DEPARTURE_LINES.has(text ?? "")) return;
    event.after = () => {
      travelPending.delete(player);
      // A quest change can hide Veos while his final line is still open.
      // Revalidate the form this player can actually speak to before departure.
      if (npc && npc.getCurrentDefinition(player)?.getId() !== npcId) return;
      const request = { player, route: pending.route, handled: false };
      api.emitCustomEvent("ferries:travel", request);
    };
  }

  /**
   * Veos's ship landing in Great Kourend, whoever sails it (Veos, or Cabin Boy Herbert once he
   * takes over at Port Sarim) and however it was asked for (dialogue or right-click).
   */
  function shipArrived({ player, route }) {
    if (KOUREND_LANDINGS.has(route)) markZeahVisited(player);
  }

  /** The post-quest lost-memoirs line has no item step in the dump. */
  function handleConditionChosen(event) {
    const { npcId, player, stepId } = event;
    if (!isPiscariliusVeos(npcId)) return;
    if (stepId !== MISSING_MEMOIRS_CONDITION_ID) return;
    memoirsPending.delete(player);
    if (ownsItem(player, KHAREDSTS_MEMOIRS_ITEM_ID)) return;
    if (!give(player, KHAREDSTS_MEMOIRS_ITEM_ID)) memoirsPending.add(player);
  }

  /** A full bag must not play the "Enjoy!" receipt when no memoir was added. */
  function handleMemoirsLine(event) {
    const { npcId, player, text } = event;
    if (!isPiscariliusVeos(npcId) || !memoirsPending.has(player) || text !== MEMOIRS_LINE) return;
    memoirsPending.delete(player);
    event.skip = true;
    player.sendMessage("You need a free inventory space.");
  }

  /**
   * The orb item's Activate option: only the Dark Altar responds; the transcript's
   * vy1GZz message consumes the orb and marks the stage.
   */
  function activateOrb(event) {
    const { player } = event;
    if (event.itemId !== MYSTERIOUS_ORB_ITEM_ID) return;
    event.handled = true;
    if (!questActive(player) || quest.getStage(player) < STAGE_ORB) return;
    if (!held(player, MYSTERIOUS_ORB_ITEM_ID)) return;
    if (!nearDarkAltar(player)) {
      startTranscript(api, player, NARRATOR_NPC_ID, PAGE, "activating-the-orb-trying-to-activate-the-orb-in-a-different-location");
      return;
    }
    // The player holds the orb up as Wanted!'s crystal ball scans; it shatters two ticks later.
    player.performAnimation(new Animation(ORB_SCAN_ANIMATION));
    player.performGraphic(Graphic.atHeight(ORB_SCAN_GRAPHIC, ORB_SCAN_GRAPHIC_HEIGHT));
    player.getPacketSender().sendSoundEffect(ORB_SCAN_SOUND);
    TaskManager.submit(new CountdownTask(player, ORB_SHATTER_DELAY_TICKS, () => {
      if (!questActive(player) || quest.getStage(player) !== STAGE_ORB || !held(player, MYSTERIOUS_ORB_ITEM_ID)) return;
      startTranscript(api, player, NARRATOR_NPC_ID, PAGE, "activating-the-orb-using-the-activate-option-on-the-mysterious-orb-by-the-dark-altar");
    }));
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (usedItemId !== ENCHANTED_SCROLL_ITEM_ID && usedWithItemId !== ENCHANTED_SCROLL_ITEM_ID) {
      return;
    }
    if (!questActive(player)) return;
    event.handled = true;
    const otherId = usedItemId === ENCHANTED_SCROLL_ITEM_ID ? usedWithItemId : usedItemId;
    if (FEATHER_ITEM_IDS.has(otherId)) {
      startTranscript(
        api,
        player,
        NARRATOR_NPC_ID,
        PAGE,
        held(player, ENCHANTED_QUILL_ITEM_ID)
          ? "starting-off-using-a-feather-on-enchanted-scroll-trying-to-create-another-enchanted-quill-with-a-feather"
          : "starting-off-using-a-feather-on-enchanted-scroll"
      );
      return;
    }
    if (otherId === ENCHANTED_QUILL_ITEM_ID) {
      startTranscript(
        api,
        player,
        NARRATOR_NPC_ID,
        PAGE,
        "starting-off-using-a-feather-on-enchanted-scroll-trying-to-create-another-enchanted-quill-with-an-enchanted-quill"
      );
    }
  }

  function handleOrbGrant(event) {
    const { player } = event;
    if (!give(player, MYSTERIOUS_ORB_ITEM_ID)) {
      player.sendMessage("You need a free inventory space.");
      event.end = true;
      return false;
    }
    orbHanded(player);
    return true;
  }

  /** type "action" receive steps (Player receives ...). */
  function handleReceiveAction(event) {
    const { player, stepId } = event;
    if (stepId === QUILL_RECEIVE_ACTION_ID) {
      event.handled = true;
      removeOneFeather(player);
      give(player, ENCHANTED_QUILL_ITEM_ID);
      return;
    }
    if (stepId === ORB_RECEIVE_ACTION_ID) {
      event.handled = true;
      handleOrbGrant(event);
    }
  }

  /** type "message" steps (Veos hands you ...): side effects, message still shows. */
  function handleMessageAction(event) {
    const { player, stepId } = event;
    const items = ITEM_BOXES.get(stepId);
    if (items) event.box = { items };
    else if (STATEMENT_BOXES.has(stepId)) event.box = { statement: true };
    if (stepId === QUILL_PAIN_MESSAGE_ID) {
      // The player's overhead "ARGH!" comes with this box, as live (tick 1304).
      player.performAnimation(new Animation(QUILL_PAIN_ANIMATION));
      player.forceChat("ARGH!");
      return;
    }
    if (stepId === START_SCROLL_MESSAGE_ID || stepId === SCROLL_RETURN_MESSAGE_ID) {
      give(player, ENCHANTED_SCROLL_ITEM_ID);
      return;
    }
    if (stepId === ITEMS_REMOVED_MESSAGE_ID) {
      player.getInventory().deleteNumber(ENCHANTED_SCROLL_ITEM_ID, 1);
      player.getInventory().deleteNumber(ENCHANTED_QUILL_ITEM_ID, 1);
      return;
    }
    if (stepId === ORB_HAND_MESSAGE_ID || stepId === ORB_ANOTHER_MESSAGE_ID) {
      if (give(player, MYSTERIOUS_ORB_ITEM_ID)) orbHanded(player);
      return;
    }
    if (stepId === ORB_SHATTER_MESSAGE_ID) {
      if (held(player, MYSTERIOUS_ORB_ITEM_ID)) {
        player.getInventory().deleteNumber(MYSTERIOUS_ORB_ITEM_ID, 1);
        give(player, BROKEN_GLASS_ITEM_ID);
      }
      if (quest.getStage(player) < STAGE_ORB_USED) quest.setStage(player, STAGE_ORB_USED);
      // With the box: the player's overhead "Argh!", the glass breaking and the whisper in chat (tick 1795).
      player.forceChat("Argh!");
      player.getPacketSender().sendSoundEffect(GLASS_BREAK_SOUND);
      player.sendMessage(ORB_WHISPER_CHAT);
      return;
    }
    const house = HOUSE_BY_MESSAGE.get(stepId);
    if (!house) return;
    markHouse(player, house);
    if (HOUSE_LAST_MESSAGE.has(stepId)) {
      player.sendMessage(String(event.text ?? "").replace(RETURN_WHISPER, `<br>${RETURN_WHISPER.trim()}`));
      player.getPacketSender().sendVarbit(VEOS_REVEAL_VARBIT, 1);
      if (quest.getStage(player) < STAGE_GATHERED) quest.setStage(player, STAGE_GATHERED);
    }
  }

  function handleAction(event) {
    const { npcId, stepId } = event;
    if (stepId === VEOS_SAIL_ACTION_ID && PORT_SARIM_VEOS_NPC_IDS.has(npcId)) {
      sailToPiscarilius(event);
      return;
    }
    if (!isPiscariliusVeos(npcId) && !HOUSE_BY_NPC.has(npcId)) return;
    // Message steps arrive twice (generic action, then kind "message"); act once.
    if (event.kind === "message") {
      handleMessageAction(event);
      return;
    }
    if (event.action === "receive") {
      handleReceiveAction(event);
      return;
    }
    if (stepId === ORB_SAME_AS_ABOVE_ACTION_ID) {
      event.handled = true;
      handleOrbGrant(event);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (quest.getStage(event.player) >= STAGE_ORB_USED && !quest.isComplete(event.player)) {
        quest.complete(event.player);
      }
    }
  }

  /**
   * Lines the quest acts on: the player's overhead pain lines play with the box after them, the
   * agreement to Veos's last task (live's veos_progress 3), the orb handed with Veos's line (4, tick
   * 1509), and Veos taken over by his client (6, his "ARGH!", then the shock on the next line).
   */
  function handleQuestLine(event) {
    const { npcId, npc, player, step, text } = event;
    if (!isPiscariliusVeos(npcId) && !HOUSE_BY_NPC.has(npcId)) return;
    if (step?.presentation === "overhead" && OVERHEAD_PAIN_LINES.has(text)) {
      event.skip = true;
      return;
    }
    if (step?.speaker === VEOS_CLIENT_SPEAKER) {
      event.speakerId = VEOS_CLIENT_HEAD_NPC_ID;
      return;
    }
    if (!isPiscariliusVeos(npcId)) return;
    // Line events come as the conversation is laid out; `before` runs as each line shows.
    if (text === TASK_ACCEPTED_LINE) {
      event.before = () => {
        if (quest.getStage(player) !== STAGE_GATHERED) return;
        player.setAttribute(TASK_OFFERED_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VEOS_PROGRESS_VARBIT, VEOS_TASK_OFFERED_VALUE);
      };
      return;
    }
    if (String(text).startsWith(ORB_HANDOVER_LINE)) {
      // A full backpack is refused by the receive step after this line.
      event.before = () => {
        if (quest.getStage(player) === STAGE_GATHERED && give(player, MYSTERIOUS_ORB_ITEM_ID)) orbHanded(player);
      };
      return;
    }
    if (!npc) return;
    // Veos's own "ARGH!" (a typed line on the quest page), not the player's overheads.
    if (text === VEOS_ARGH_LINE && (step?.speaker === "Veos" || typeof step?.npc === "string")) {
      event.before = () => {
        if (quest.getStage(player) !== STAGE_ORB_USED) return;
        const sender = player.getPacketSender();
        sender.sendVarbit(VEOS_PROGRESS_VARBIT, VEOS_POSSESSED_VALUE);
        sender.sendNpcAnimationSpecific(npc, new Animation(VEOS_ARGH_ANIMATION));
      };
      return;
    }
    if (String(text).startsWith(AFTER_POSSESSION_LINE)) {
      event.before = () => {
        if (quest.getStage(player) !== STAGE_ORB_USED) return;
        const sender = player.getPacketSender();
        sender.sendNpcSpotAnimationSpecific(npc, new Graphic(POSSESSION_GRAPHIC));
        sender.sendNpcAnimationSpecific(npc, new Animation(POSSESSION_ANIMATION));
      };
    }
  }

  function handleLogin({ player }) {
    // Saves from before the visit was kept: Client of Kourend begins on the Piscarilius Veos, and
    // a player logging in on Kourend got there, so both count as the trip made.
    if (player.getAttribute(ZEAH_VISITED_ATTRIBUTE) !== true && (quest.getStage(player) > 0 || inKourend(player.getLocation()))) {
      player.setAttribute(ZEAH_VISITED_ATTRIBUTE, true);
    }
    if (player.getAttribute(ZEAH_VISITED_ATTRIBUTE) === true) {
      player.getPacketSender().sendVarbit(ZEAH_VISITED_VARBIT, 1);
      api.emitCustomEvent("kourend:visited", { player });
    }
    syncHouseVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    travelPending.delete(player);
  }

  api.persistAttribute(HOUSES_ATTRIBUTE);
  api.persistAttribute(TASK_OFFERED_ATTRIBUTE, false);
  api.persistAttribute(LAMPS_USED_ATTRIBUTE, 0);
  api.persistAttribute(ZEAH_VISITED_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "client_of_kourend",
    name: "Client of Kourend",
    varpId: VARP_VEOS_QUEST,
    varbitId: VEOS_PROGRESS_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: KHAREDSTS_MEMOIRS_ITEM_ID,
    rewardItemLabel: "Kharedst's memoirs and two antique lamps",
    otherRewards: ["Ability to use the Kourend Castle Teleport spell"],
    // The scroll as live words it, with the quill (local 1001998 tick 2127).
    rewardText: ["1 Quest Point", "2 Antique Lamps", "Kourend Castle Teleport", "Kharedst's Memoirs"],
    scrollItemId: ENCHANTED_QUILL_ITEM_ID,
    buildJournal,
    onReward: grantReward,
    varbitValue: progressValue,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:choice", rememberSailChoice);
  api.onCustomEvent("npc-dialogue:line", finishSailLine);
  api.onCustomEvent("npc-dialogue:line", handleMemoirsLine);
  api.onCustomEvent("npc-dialogue:line", handleQuestLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Mysterious orb", { Activate: activateOrb });
  api.onItemAction("Antique lamp", { Rub: rubLamp });
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("ferries:arrived", shipArrived);
  api.onPlayerLogout(handleLogout);
};
