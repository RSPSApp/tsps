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
 *   is written by registerQuest's setStage. Durable stages stay 1-5 but the wire
 *   follows Quest Helper: 3 sends 4 (orb held), 4 sends 5 (orb activated), and
 *   completion sends 9 (also the Kourend Castle Teleport unlock). X Marks the
 *   Spot uses its own varp 2111/varbit 8063 (cluequest).
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
 *   (10724). Port Sarim Veos stays with X Marks; this plugin adds the missing
 *   WXJllC and post-X-Marks boat handoff to 1825,3691 without taking that page.
 * - after completion the Piscarilius Veos plays the canonical
 *   standard-dialogue-at-port-piscarilius page; its lost-memoirs condition
 *   (drsnpy) returns 21760 because the generated branch has no item step.
 * - the two antique lamps rub through the shared xpreward interface for 500 XP
 *   each and the completion sends the teleport unlock wire value 9.
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
  const { ItemIdentifiers, Location, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Client of Kourend";
  const START_HOOK = "quest:client-of-kourend:start";
  const X_MARKS_KEY = "x_marks_the_spot";

  const HOUSES_ATTRIBUTE = "quest.client_of_kourend.houses";

  const STAGE_STARTED = 1;
  const STAGE_GATHERED = 2;
  const STAGE_ORB = 3;
  const STAGE_ORB_USED = 4;
  const STAGE_COMPLETE = 5;

  const VARP_VEOS_QUEST = 1566; // "veos_quest"
  const VEOS_PROGRESS_VARBIT = 5619; // real quest progress; also the Kourend Castle Teleport unlock
  const VEOS_ORB_VARBIT_VALUE = 4; // Quest Helper wire state while carrying the orb
  const VEOS_ACTIVATED_VARBIT_VALUE = 5; // Quest Helper wire state after activating the orb
  const VEOS_COMPLETE_VARBIT_VALUE = 9; // PacketSender's completed value for the teleport unlock
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
  const BROKEN_GLASS_ITEM_ID = ItemIdentifiers.BROKEN_GLASS; // 690
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
  const PISCARILIUS_VEOS_NPC_ID = NpcIdentifiers.VEOS_5; // 10724 at 1825,3691
  const PORT_SARIM_VEOS_NPC_IDS = new Set([
    NpcIdentifiers.VEOS, // 8484
    NpcIdentifiers.VEOS_4, // 10723, X Marks' completed Port Sarim transform
  ]);
  const NARRATOR_NPC_ID = PISCARILIUS_VEOS_NPC_ID; // the orb/quill narration chathead
  const PISCARILIUS_LANDING = new Location(1825, 3691, 0);
  const PORT_SARIM_LANDING = new Location(3054, 3245, 0);
  const LANDS_END_LANDING = new Location(1504, 3401, 0);
  const ZEAH_VISITED_VARBIT = 4897; // zeah_playerhasvisited, set by the boat ride
  const VEOS_SAIL_ACTION_ID = "WXJllC";
  const PORT_SARIM_DESTINATIONS = new Map([
    ["I'd like to travel to Port Piscarilius, please.", PISCARILIUS_LANDING],
    ["I'd like to travel to Land's End, please.", LANDS_END_LANDING],
  ]);
  const PISCARILIUS_DESTINATIONS = new Map([
    ["Travel to Port Sarim.", PORT_SARIM_LANDING],
    ["Travel to Land's End.", LANDS_END_LANDING],
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
  const isPiscariliusVeos = (npcId) => npcId === PISCARILIUS_VEOS_NPC_ID;

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

  function houseJournalLine(player, house) {
    return hasHouse(player, house)
      ? `<str>I have gathered information on ${house.label}.</str>`
      : `I need to gather information on <col=800000>${house.label}</col>.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Veos' client gather information on the five cities</str>",
        "<str>of Great Kourend, then activated a mysterious orb at the</str>",
        "<str>Dark Altar for them.</str>",
        "",
        "<str>Veos' client gave me Kharedst's memoirs and two antique lamps.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Veos</col>",
        "at the <col=800000>Port Sarim</col> docks, then sailing to",
        "<col=800000>Great Kourend</col>.",
        "",
        "I must have completed <col=800000>X Marks the Spot</col>.",
      ];
    }
    const lines = [
      "<str>I agreed to help Veos' client learn about the cities of</str>",
      "<str>Great Kourend.</str>",
      "",
      "I should use a <col=800000>feather</col> on the",
      "<col=800000>enchanted scroll</col> to create an <col=800000>enchanted quill</col>.",
      "",
    ];
    for (const house of HOUSES) lines.push(houseJournalLine(player, house));
    if (stage >= STAGE_GATHERED) {
      lines.push("", "I should return to <col=800000>Veos</col> in Port Piscarilius.");
    }
    if (stage >= STAGE_ORB) {
      lines.push(
        "",
        "I should activate the <col=800000>mysterious orb</col> near the",
        "<col=800000>Dark Altar</col> north of Arceuus."
      );
    }
    if (stage >= STAGE_ORB_USED) {
      lines.push("", "I should return to <col=800000>Veos</col>.");
    }
    return lines;
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
    manager.addExperience(skill, LAMP_XP, false);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    return `You have been awarded ${LAMP_XP} ${name ?? skill.getName()} XP!`;
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
    if (stage >= STAGE_ORB) {
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

  function landAtPiscarilius(player) {
    player.moveTo(new Location(PISCARILIUS_LANDING.getX(), PISCARILIUS_LANDING.getY(), 0));
    player.getPacketSender().sendVarbit(ZEAH_VISITED_VARBIT, 1);
  }

  /** X Marks' completed Port Sarim Veos still needs the canonical boat handoff. */
  function sailToPiscarilius(event) {
    event.handled = true;
    landAtPiscarilius(event.player);
  }

  function rememberSailChoice({ npcId, player, option }) {
    if (!PORT_SARIM_VEOS_NPC_IDS.has(npcId) && !isPiscariliusVeos(npcId)) return;
    travelPending.delete(player);
    const destination = (isPiscariliusVeos(npcId)
      ? PISCARILIUS_DESTINATIONS
      : PORT_SARIM_DESTINATIONS).get(option);
    if (destination) travelPending.set(player, { npcId, destination });
  }

  function finishSailLine(event) {
    const { npcId, player, text } = event;
    const pending = travelPending.get(player);
    if (!pending || pending.npcId !== npcId || !VEOS_DEPARTURE_LINES.has(text ?? "")) return;
    event.after = () => {
      travelPending.delete(player);
      player.moveTo(new Location(
        pending.destination.getX(), pending.destination.getY(), pending.destination.getZ(),
      ));
      if (pending.destination === PISCARILIUS_LANDING) {
        player.getPacketSender().sendVarbit(ZEAH_VISITED_VARBIT, 1);
      }
    };
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
    startTranscript(
      api,
      player,
      NARRATOR_NPC_ID,
      PAGE,
      nearDarkAltar(player)
        ? "activating-the-orb-using-the-activate-option-on-the-mysterious-orb-by-the-dark-altar"
        : "activating-the-orb-trying-to-activate-the-orb-in-a-different-location"
    );
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
    if (quest.getStage(player) < STAGE_ORB) quest.setStage(player, STAGE_ORB);
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
      give(player, MYSTERIOUS_ORB_ITEM_ID);
      return;
    }
    if (stepId === ORB_SHATTER_MESSAGE_ID) {
      if (held(player, MYSTERIOUS_ORB_ITEM_ID)) {
        player.getInventory().deleteNumber(MYSTERIOUS_ORB_ITEM_ID, 1);
        give(player, BROKEN_GLASS_ITEM_ID);
      }
      if (quest.getStage(player) < STAGE_ORB_USED) quest.setStage(player, STAGE_ORB_USED);
      return;
    }
    const house = HOUSE_BY_MESSAGE.get(stepId);
    if (!house) return;
    markHouse(player, house);
    if (HOUSE_LAST_MESSAGE.has(stepId)) {
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

  function handleLogin({ player }) {
    syncHouseVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    travelPending.delete(player);
  }

  api.persistAttribute(HOUSES_ATTRIBUTE);

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
    buildJournal,
    onReward: grantReward,
    // Keep the durable stages but send the wire values the quest's cache/Quest
    // Helper states use: 3 means returning to Veos, 4 carrying the orb, 5 acted.
    varbitValue: (stage) => {
      if (stage >= STAGE_COMPLETE) return VEOS_COMPLETE_VARBIT_VALUE;
      if (stage === STAGE_ORB) return VEOS_ORB_VARBIT_VALUE;
      if (stage === STAGE_ORB_USED) return VEOS_ACTIVATED_VARBIT_VALUE;
      return stage;
    },
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:choice", rememberSailChoice);
  api.onCustomEvent("npc-dialogue:line", finishSailLine);
  api.onCustomEvent("npc-dialogue:line", handleMemoirsLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Mysterious orb", { Activate: activateOrb });
  api.onItemAction("Antique lamp", { Rub: rubLamp });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
