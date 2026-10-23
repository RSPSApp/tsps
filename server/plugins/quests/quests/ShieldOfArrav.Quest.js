/** Shield of Arrav. Capture evidence and remaining presentation gaps: docs/shield-of-arrav.md. */
module.exports = function registerShieldOfArravQuest(api) {
  const { Location, Item, Area, Boundary, StatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, openBook } = require("../QuestRuntime");
  const { crossingFor } = require("../../objects/WallDoor.Doors");

  const VARP_SHIELD_OF_ARRAV = 145;
  const VARP_BLACK_ARM_GANG = 146;
  const BOOK_PAGES = require("../data/shield-of-arrav-book.json");
  const CERTIFICATE_INTERFACE = 526;
  const CERTIFICATE_TEXT = "The bearer of this certificate has brought half of the legendary Shield of Arrav to me, Haig Halen, Curator of the Varrock Museum. I have examined the shield and am satisfied as to its authenticity. I recommend to His Majesty, King Roald III, that the bearer is rewarded as per Proclimation 262 of the year 143 of the 5th Age, by King Roald II.";

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_READ_BOOK = 2;
  const STAGE_GANG_TASK = 3;
  const STAGE_JOINED_GANG = 4;
  const STAGE_CERTIFICATE = 6;
  const STAGE_COMPLETE = 7;

  const BOOK_ID = ItemIdentifiers.BOOK;
  const KEY_ID = ItemIdentifiers.WEAPON_STORE_KEY;
  const REPORT_ID = ItemIdentifiers.INTEL_REPORT;
  const PHOENIX_HALF_ID = ItemIdentifiers.BROKEN_SHIELD;
  const BLACKARM_HALF_ID = ItemIdentifiers.BROKEN_SHIELD_2;
  const CROSSBOW_ID = ItemIdentifiers.PHOENIX_CROSSBOW;
  const CERTIFICATE_ID = ItemIdentifiers.CERTIFICATE;
  const PHOENIX_CERT_ID = ItemIdentifiers.HALF_CERTIFICATE;
  const BLACKARM_CERT_ID = ItemIdentifiers.HALF_CERTIFICATE_2;
  const COINS_ID = ItemIdentifiers.COINS;

  // Reference cache ids the generated NpcIdentifiers enum has no member for
  // (grep by number found nothing); kept as named constants.
  const RELDO_REFERENCE_NPC_ID = 6203;
  const WEAPONSMASTER_REFERENCE_NPC_ID = 5211;
  const JONNY_REFERENCE_NPC_ID = 5213;

  const RELDO_NPC_IDS = new Set([RELDO_REFERENCE_NPC_ID, NpcIdentifiers.RELDO, NpcIdentifiers.RELDO_2]);
  const BARAEK_NPC_IDS = new Set([NpcIdentifiers.BARAEK, NpcIdentifiers.BARAEK_2]);
  const CHARLIE_NPC_ID = NpcIdentifiers.CHARLIE_THE_TRAMP;
  const KATRINE_NPC_ID = NpcIdentifiers.KATRINE;
  const STRAVEN_NPC_ID = NpcIdentifiers.STRAVEN;
  const WEAPONSMASTER_NPC_IDS = new Set([WEAPONSMASTER_REFERENCE_NPC_ID, NpcIdentifiers.WEAPONSMASTER]);
  const CURATOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN;
  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD,
    NpcIdentifiers.KING_ROALD_3,
    NpcIdentifiers.KING_ROALD_5,
    NpcIdentifiers.KING_ROALD_6,
    NpcIdentifiers.KING_ROALD_7,
  ]);
  const JONNY_NPC_IDS = new Set([JONNY_REFERENCE_NPC_ID, NpcIdentifiers.JONNY_THE_BEARD, NpcIdentifiers.JONNY_THE_BEARD_2]);

  const BOOKCASE_ID = ObjectIdentifiers.BOOKCASE_10;
  const PHOENIX_CHEST_IDS = new Set([ObjectIdentifiers.CHEST_11, ObjectIdentifiers.CHEST_12]);
  const BLACKARM_CUPBOARD_IDS = new Set([ObjectIdentifiers.CUPBOARD_12, ObjectIdentifiers.CUPBOARD_13]);
  const WEAPON_STORE_DOOR_ID = ObjectIdentifiers.DOOR_70;
  const BLACKARM_DOOR_ID = ObjectIdentifiers.DOOR_71;
  const PHOENIX_HIDEOUT_DOOR_ID = ObjectIdentifiers.DOOR_69;

  const GANG_PHOENIX = 1;
  const GANG_BLACKARM = 2;

  const GANG_ATTRIBUTE = "shield-of-arrav.gang";
  const PHOENIX_LOCATION_ATTRIBUTE = "shield-of-arrav.phoenix-location-known";
  const CHARLIE_PAID_ATTRIBUTE = "shield-of-arrav.charlie-paid";
  const CHARLIE_MET_ATTRIBUTE = "shield-of-arrav:charlie-met";
  const RELDO_MET_ATTRIBUTE = "shield-of-arrav.reldo-met";

  const SHIELDOFARRAV_VARBIT = 13716;
  const RELDO_MET_VARBIT = 11509;
  const CHARLIE_MET_VARBIT = 11510;
  const CHARLIE_PAID_VARBIT = 11511;
  const CHARLIE_FULL_PAYMENT = 10;

  const DIRECTIONS_ATTRIBUTE = "shield-of-arrav:reldo-directions";
  const PHOENIX_TASK_ATTRIBUTE = "shield-of-arrav:phoenix-task";
  const BLACKARM_TASK_ATTRIBUTE = "shield-of-arrav:black-arm-task";

  const TAIL_OF_TWO_CATS_QUEST_KEY = "a_tail_of_two_cats";
  const TAIL_OF_TWO_CATS_RELDO_STAGES = new Set([4, 5]);
  const THE_GOLEM_QUEST_KEY = "the_golem";
  const THE_GOLEM_CURATOR_MIN_STAGE = 1;
  const THE_GOLEM_CURATOR_LAST_STAGE = 3;

  const PAGE = "Shield of Arrav";
  const START_HOOK = "quest:shield-of-arrav:start";

  // Transcript step ids. Message steps keep handled=false so their text still
  // shows; action-type steps are consumed with handled=true.
  const BARAEK_PAY_ACTIONS = new Set(["6ECylA", "5UTIVW"]);
  const CHARLIE_TEN_COIN_MESSAGES = new Set(["-YbdFO", "OfFGS6"]);
  const CHARLIE_FIVE_COIN_MESSAGES = new Set(["24Nlqb", "Fo_zeD", "DSC-L4", "7GfBwz"]);
  const STRAVEN_HANDIN_ACTIONS = new Set(["XSi6qr"]);
  const STRAVEN_KEY_MESSAGE = "G02Ai7";
  const STRAVEN_LOST_KEY_MESSAGES = new Set(["zyd3U3", "xWwA_D"]);
  const KATRINE_HANDIN_MESSAGE = "i8Y3sS";
  const KATRINE_HANDIN_ACTION = "q34K2Z";
  const CURATOR_CERT_MESSAGE = "2pltJk";
  const CURATOR_REPLACE_MESSAGE = "g7REXu";
  const CURATOR_SHIELD_VARIANT = "finishing-up-talking-to-curator-haig-halen";
  const CURATOR_REPLACE_VARIANT = "finishing-up-talking-to-the-curator-again-after-giving-him-the-shield-half";
  const KING_COMPLETE_ACTIONS = new Set(["25_j1f", "e0pTWp"]);
  const WEAPONMASTER_ATTACK_STEP = "12WBZW";


  let quest;
  let groundItems;

  const reldoFirstTalk = new WeakMap();
  const charlieFirstAsk = new WeakMap();

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const questStage = (player, key) => {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number.isInteger(request.stage) ? request.stage : null;
  };
  const tailOfTwoCatsOwnsReldo = (player) =>
    TAIL_OF_TWO_CATS_RELDO_STAGES.has(questStage(player, TAIL_OF_TWO_CATS_QUEST_KEY));
  const theGolemOwnsCurator = (player) => {
    const stage = questStage(player, THE_GOLEM_QUEST_KEY);
    return stage !== null && stage >= THE_GOLEM_CURATOR_MIN_STAGE && stage <= THE_GOLEM_CURATOR_LAST_STAGE;
  };
  const charliePaid = (player) => {
    const value = player.getAttribute(CHARLIE_PAID_ATTRIBUTE);
    return value === true ? CHARLIE_FULL_PAYMENT : Number(value) || 0;
  };
  const gang = (player) => attr(player, GANG_ATTRIBUTE);
  const gangChosen = (player) => gang(player) !== 0;
  const isPhoenix = (player) => gang(player) === GANG_PHOENIX;
  const joinedGang = (player) => gangChosen(player) && quest.getStage(player) >= STAGE_JOINED_GANG;
  const phoenixTask = (player) => !!attr(player, PHOENIX_TASK_ATTRIBUTE) || (isPhoenix(player) && quest.getStage(player) === STAGE_GANG_TASK);
  const blackArmTask = (player) => !!attr(player, BLACKARM_TASK_ATTRIBUTE) || (isBlackArm(player) && quest.getStage(player) === STAGE_GANG_TASK);
  const bankHasItem = (player, itemId) => player.getBanks?.()?.some((bank) => bank && bank.getAmount(itemId) > 0) === true;
  const isBlackArm = (player) => gang(player) === GANG_BLACKARM;
  const hasItem = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const coins = (player) => player.getInventory().getAmount(COINS_ID);

  function phoenixProgress(player) {
    const stage = quest.getStage(player);
    if (joinedGang(player) && isPhoenix(player)) return stage >= STAGE_COMPLETE ? 10 : 9;
    return phoenixTask(player) ? 8 : attr(player, PHOENIX_LOCATION_ATTRIBUTE) ? 4
      : attr(player, DIRECTIONS_ATTRIBUTE) ? 3 : Math.min(stage, STAGE_READ_BOOK);
  }

  function syncGangProgress(player) {
    const stage = quest.getStage(player);
    const packet = player.getPacketSender();
    packet.sendConfig(VARP_SHIELD_OF_ARRAV, phoenixProgress(player));
    packet.sendConfig(VARP_BLACK_ARM_GANG,
      joinedGang(player) && isBlackArm(player) ? stage >= STAGE_COMPLETE ? 4 : 3
        : blackArmTask(player) ? 2 : attr(player, DIRECTIONS_ATTRIBUTE) ? 1 : 0);
    // Current-cache quest state bits read by the client's quest list and by
    // Quest Helper's Shield of Arrav condition checks.
    packet.sendVarbit(SHIELDOFARRAV_VARBIT,
      stage >= STAGE_COMPLETE ? 2 : stage >= STAGE_STARTED ? 1 : 0);
    packet.sendVarbit(RELDO_MET_VARBIT, attr(player, RELDO_MET_ATTRIBUTE) ? 1 : 0);
    packet.sendVarbit(CHARLIE_MET_VARBIT, attr(player, CHARLIE_MET_ATTRIBUTE) ? 1 : 0);
    packet.sendVarbit(CHARLIE_PAID_VARBIT, charliePaid(player) >= CHARLIE_FULL_PAYMENT ? 1 : 0);
  }

  function markCharlieMet(player) {
    if (attr(player, CHARLIE_MET_ATTRIBUTE)) return;
    player.setAttribute(CHARLIE_MET_ATTRIBUTE, true);
    syncGangProgress(player);
  }

  function setGang(player, value) {
    player.setAttribute(GANG_ATTRIBUTE, value);
  }

  function giveItem(player, itemId, message) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    if (typeof inventory.getFreeSlots === "function") return inventory.getFreeSlots();
    return inventory.isFull() ? 0 : 1;
  }

  function giveItems(player, itemId, quantity, message) {
    if (freeSlots(player) < quantity) {
      player.sendMessage("You need more inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, quantity);
    if (message) player.sendMessage(message);
    return true;
  }

  function ownShieldAndCert(player) {
    if (!gangChosen(player)) return undefined;
    return isPhoenix(player)
      ? { shield: PHOENIX_HALF_ID, half: PHOENIX_CERT_ID }
      : { shield: BLACKARM_HALF_ID, half: BLACKARM_CERT_ID };
  }

  function hasShieldHalf(player) {
    return hasItem(player, PHOENIX_HALF_ID) || hasItem(player, BLACKARM_HALF_ID);
  }

  function hasCertHalf(player) {
    return hasItem(player, PHOENIX_CERT_ID) || hasItem(player, BLACKARM_CERT_ID);
  }

  function handInReport(player, questHandle) {
    if (!phoenixTask(player) || joinedGang(player) || questHandle.getStage(player) !== STAGE_GANG_TASK) return false;
    if (!hasItem(player, REPORT_ID)) return false;
    player.getInventory().deleteNumber(REPORT_ID, 1);
    giveItem(player, KEY_ID);
    setGang(player, GANG_PHOENIX);
    questHandle.setStage(player, STAGE_JOINED_GANG);
    return true;
  }

  function handInShieldHalf(player, questHandle) {
    const own = ownShieldAndCert(player);
    if (!own || questHandle.getStage(player) !== STAGE_JOINED_GANG) return false;
    if (!hasItem(player, own.shield)) return false;
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space.");
      return false;
    }
    player.getInventory().deleteNumber(own.shield, 1);
    giveItems(player, own.half, 2);
    questHandle.setStage(player, STAGE_CERTIFICATE);
    return true;
  }

  function handInCrossbows(player, questHandle) {
    if (!blackArmTask(player) || joinedGang(player) || questHandle.getStage(player) !== STAGE_GANG_TASK) return false;
    if (!hasItem(player, CROSSBOW_ID, 2)) return false;
    player.getInventory().deleteNumber(CROSSBOW_ID, 2);
    setGang(player, GANG_BLACKARM);
    questHandle.setStage(player, STAGE_JOINED_GANG);
    return true;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === STAGE_NOT_STARTED) {
      return ["I can start this quest by speaking to", "<col=800000>Reldo</col> in Varrock Palace library."];
    }
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I returned the Shield of Arrav to Varrock.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }

    const lines = ["Reldo told me about the stolen Shield of Arrav."];
    if (stage === STAGE_STARTED) {
      lines.push("I should search the marked bookcase and read the book.");
      return lines;
    }
    if (stage < STAGE_JOINED_GANG) {
      if (!attr(player, DIRECTIONS_ATTRIBUTE)) lines.push("I should speak to Reldo about the gangs in the book.");
      else lines.push("I can investigate the Phoenix Gang through Baraek,", "or the Black Arm Gang through Charlie the Tramp.");
      if (phoenixTask(player)) lines.push("Straven wants Jonny the Beard's intelligence report.");
      if (blackArmTask(player)) lines.push("Katrine wants two Phoenix crossbows.");
      return lines;
    }

    const phoenix = isPhoenix(player);
    lines.push(`I chose to work with the <col=800000>${phoenix ? "Phoenix" : "Black Arm"} Gang</col>.`);
    if (stage === STAGE_JOINED_GANG) {
      const shield = phoenix ? PHOENIX_HALF_ID : BLACKARM_HALF_ID;
      lines.push(
        hasItem(player, shield)
          ? "I have my half of the shield and should take it to the curator."
          : `I should search the ${phoenix ? "Phoenix chest" : "Black Arm cupboard"} for my half of the shield.`
      );
    } else if (stage >= STAGE_CERTIFICATE) {
      if (hasItem(player, CERTIFICATE_ID)) {
        lines.push("I have a completed certificate to show King Roald.");
      } else {
        lines.push("I need to exchange a certificate half with a member", "of the opposite gang, then combine the two halves.");
      }
    }
    return lines;
  }

  function reward(player) {
    player.getInventory().adds(COINS_ID, 600);
  }

  function selectDialogueVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (RELDO_NPC_IDS.has(npcId)) {
      if (tailOfTwoCatsOwnsReldo(player)) return null;
      if (stage === STAGE_NOT_STARTED) {
        // The first-time and "otherwise" branches are sibling conditions in one
        // transcript; remember which one this talk is before they are resolved.
        reldoFirstTalk.set(player, !attr(player, RELDO_MET_ATTRIBUTE));
        player.setAttribute(RELDO_MET_ATTRIBUTE, true);
        syncGangProgress(player);
        return { page: PAGE, variant: "shared-starting-talking-to-reldo" };
      }
      if (stage === STAGE_STARTED) {
        return hasItem(player, BOOK_ID)
          ? { page: PAGE, variant: "shared-starting-talking-to-reldo-before-reading-the-book" }
          : { page: PAGE, variant: "shared-starting-talking-to-reldo-before-finding-the-book" };
      }
      if (stage >= STAGE_READ_BOOK && stage < STAGE_JOINED_GANG) {
        return { page: PAGE, variant: "shared-starting-talking-to-reldo-after-reading-the-book" };
      }
      if (stage >= STAGE_JOINED_GANG && stage < STAGE_COMPLETE && hasShieldHalf(player)) {
        return hasItem(player, PHOENIX_HALF_ID)
          ? { page: PAGE, variant: "phoenix-gang-talking-to-reldo-with-half-of-the-shield" }
          : { page: PAGE, variant: "black-arm-gang-talking-to-reldo-with-half-of-the-shield" };
      }
      return null;
    }

    if (BARAEK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_READ_BOOK && stage < STAGE_JOINED_GANG && !attr(player, PHOENIX_LOCATION_ATTRIBUTE)) {
        return { page: PAGE, variant: "phoenix-gang-talking-to-baraek" };
      }
      return null;
    }

    if (npcId === CHARLIE_NPC_ID) {
      if (isPhoenix(player) && joinedGang(player)) {
        markCharlieMet(player);
        return { page: PAGE, variant: "phoenix-gang-learning-the-location-of-the-black-arm-gang-from-charlie-the-tramp" };
      }
      if (stage === STAGE_GANG_TASK && blackArmTask(player)) {
        markCharlieMet(player);
        return { page: PAGE, variant: "black-arm-gang-talking-to-charlie-the-tramp-after-accepting-katrine-s-task" };
      }
      if (stage >= STAGE_READ_BOOK && attr(player, DIRECTIONS_ATTRIBUTE)) {
        charlieFirstAsk.set(player, !attr(player, CHARLIE_MET_ATTRIBUTE));
        markCharlieMet(player);
        return { page: PAGE, variant: "black-arm-gang-talking-to-charlie-the-tramp" };
      }
      return null;
    }

    // Early gang conversations still need their own page; a null choice falls
    // back to the unrelated Heroes' Guild transcript.
    if (npcId === KATRINE_NPC_ID) {
      if (joinedGang(player)) {
        if (isPhoenix(player)) return { page: PAGE, variant: "phoenix-gang-talking-to-katrine-after-joining-the-phoenix-gang" };
        return { page: PAGE, variant: stage >= STAGE_COMPLETE
          ? "post-quest-talking-to-katrine-as-a-member-of-the-black-arm-gang"
          : "black-arm-gang-talking-to-katrine-after-joining-the-black-arm-gang" };
      }
      return { page: PAGE, variant: blackArmTask(player)
        ? "black-arm-gang-talking-to-katrine-again-after-accepting-her-task"
        : "black-arm-gang-talking-to-katrine" };
    }

    if (npcId === STRAVEN_NPC_ID) {
      if (joinedGang(player)) {
        if (isBlackArm(player)) return { page: PAGE, variant: "black-arm-gang-talking-to-straven-after-joining-the-black-arm-gang" };
        return { page: PAGE, variant: stage >= STAGE_COMPLETE
          ? hasItem(player, KEY_ID) ? "post-quest-talking-to-straven-as-a-member-of-the-phoenix-gang" : "post-quest-if-you-lost-the-weapon-store-key"
          : hasItem(player, KEY_ID) ? "phoenix-gang-talking-to-straven-after-joining-the-phoenix-gang" : "phoenix-gang-talking-to-straven-after-losing-the-weapon-store-key" };
      }
      return { page: PAGE, variant: phoenixTask(player)
        ? "phoenix-gang-talking-to-straven-or-opening-the-door-after-accepting-his-task"
        : "phoenix-gang-talking-to-straven-or-attempting-to-open-the-door" };
    }

    if (WEAPONSMASTER_NPC_IDS.has(npcId)) {
      return isPhoenix(player)
        ? { page: PAGE, variant: "phoenix-gang-talking-to-the-weaponsmaster-after-joining-the-phoenix-gang" }
        : { page: PAGE, variant: "black-arm-gang-talking-to-the-weaponsmaster" };
    }

    if (npcId === CURATOR_NPC_ID) {
      if (theGolemOwnsCurator(player)) return null;
      const own = ownShieldAndCert(player);
      if (!own || stage < STAGE_JOINED_GANG || stage >= STAGE_COMPLETE) return null;
      if (stage === STAGE_JOINED_GANG && hasItem(player, own.shield)) {
        return { page: PAGE, variant: "finishing-up-talking-to-curator-haig-halen" };
      }
      if (stage === STAGE_CERTIFICATE && !hasItem(player, CERTIFICATE_ID) && !hasItem(player, own.half)) {
        return { page: PAGE, variant: "finishing-up-talking-to-the-curator-again-after-giving-him-the-shield-half" };
      }
      return null;
    }

    if (KING_ROALD_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_JOINED_GANG && stage < STAGE_COMPLETE && hasItem(player, CERTIFICATE_ID)) {
        return { page: PAGE, variant: "finishing-up-talking-to-king-roald-with-a-full-certificate" };
      }
      if (stage >= STAGE_JOINED_GANG && stage < STAGE_COMPLETE && (hasShieldHalf(player) || hasCertHalf(player))) {
        return { page: PAGE, variant: "finishing-up-talking-to-king-roald-without-a-full-certificate" };
      }
      return null;
    }

    return null;
  }

  function answerDialogueCondition({ npcId, player, text, stepId, pages }) {
    // Production always supplies the resolved pages. When they are present, a
    // Shield-specific prose condition must not answer for another NPC page that
    // shares the same wording; direct hook calls without pages keep the legacy
    // single-quest behaviour.
    const onShieldPage = Array.isArray(pages) ? pages.some(entry => entry.page === PAGE) : undefined;
    if (["Vl3BPs", "JaT1Z6"].includes(stepId) && onShieldPage !== false) return player.getInventory().isFull();
    const value = String(text).toLowerCase();

    if (RELDO_NPC_IDS.has(npcId)) {
      if (value.includes("combat level is less than 10")) return player.getSkillManager().getCombatLevel() < 10;
      if (value.includes("first time ever") || value.includes("otherwise")) {
        const first = reldoFirstTalk.has(player) ? reldoFirstTalk.get(player) : !attr(player, RELDO_MET_ATTRIBUTE);
        return value.includes("first time ever") ? first : !first;
      }
      return null;
    }

    if (BARAEK_NPC_IDS.has(npcId)) {
      if (value.includes("doesn't have 20 coins") || value.includes("does not have 20 coins")) return coins(player) < 20;
      if (value.includes("has 20 coins")) return coins(player) >= 20;
      return null;
    }

    if (npcId === CHARLIE_NPC_ID) {
      if (value.includes("combat level is less than 10")) return player.getSkillManager().getCombatLevel() < 10;
      if (onShieldPage === false) return null;
      if (value.includes("haven't yet paid charlie") || value.includes("hasn't yet paid charlie")) {
        return charliePaid(player) < CHARLIE_FULL_PAYMENT;
      }
      if (value.includes("already paying charlie")) return charliePaid(player) >= CHARLIE_FULL_PAYMENT;
      if (value.includes("first time") || value.includes("otherwise")) {
        const first = charlieFirstAsk.has(player) ? charlieFirstAsk.get(player) : !attr(player, CHARLIE_MET_ATTRIBUTE);
        return value.includes("first time") ? first : !first;
      }
      return null;
    }

    if (npcId === KATRINE_NPC_ID) {
      const crossbows = player.getInventory().getAmount(CROSSBOW_ID);
      if (value.includes("no phoenix crossbows")) return crossbows < 1;
      if (value.includes("one phoenix crossbow")) return crossbows === 1;
      if (value.includes("two phoenix crossbows")) return crossbows >= 2;
      return null;
    }

    if (npcId === STRAVEN_NPC_ID) {
      const report = hasItem(player, REPORT_ID) || bankHasItem(player, REPORT_ID);
      if (value.includes("doesn't have the intel report") || value.includes("does not have the intel report")) return !report;
      if (value.includes("has the intel report")) return report;
      if (value.includes("intel report is in the bank")) return !hasItem(player, REPORT_ID) && bankHasItem(player, REPORT_ID);
      if (value.includes("intel report is in the inventory")) return hasItem(player, REPORT_ID);
      return null;
    }

    if (KING_ROALD_NPC_IDS.has(npcId)) {
      if (value.includes("has a half-certificate")) return hasCertHalf(player);
      if (value.includes("has a shield half")) return hasShieldHalf(player);
      if (value.includes("has no certificate")) return !hasItem(player, CERTIFICATE_ID);
      return null;
    }

    return null;
  }

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=0ab0ff>Shield of Arrav</col>");
  }

  function handleGangChoice({ player, npcId, option }) {
    if (joinedGang(player) || quest.getStage(player) < STAGE_READ_BOOK) return;
    if (npcId === STRAVEN_NPC_ID && option === "I'd like to offer you my services.") {
      player.setAttribute(PHOENIX_TASK_ATTRIBUTE, true);
      quest.setStage(player, STAGE_GANG_TASK);
      syncGangProgress(player);
    }
    if (npcId === KATRINE_NPC_ID && (option === "Okay, no problem." || option === "Okay, I'll do it.")) {
      player.setAttribute(BLACKARM_TASK_ATTRIBUTE, true);
      quest.setStage(player, STAGE_GANG_TASK);
      syncGangProgress(player);
    }
  }

  function renderQuestLine(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (RELDO_NPC_IDS.has(request.npcId) && request.text.startsWith("There are rumours that they are based")) {
      request.before = () => {
        request.player.setAttribute(DIRECTIONS_ATTRIBUTE, true);
        syncGangProgress(request.player);
      };
    }
    if (request.text.includes("[Phoenix Gang/Black Arm Gang]")) {
      request.text = request.text.replace("[Phoenix Gang/Black Arm Gang]", isPhoenix(request.player) ? "Phoenix Gang" : "Black Arm Gang")
        .replace("[Black Arm Gang/Phoenix Gang]", isPhoenix(request.player) ? "Black Arm Gang" : "Phoenix Gang");
    }
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;

    // The full-certificate transcript marks its final line "end" before the
    // "Congratulations! Quest complete!" action step. The runtime's end marker
    // closes the chain, so let that action run instead of swallowing it.
    if (
      KING_ROALD_NPC_IDS.has(npcId) &&
      event.step?.type === "end" &&
      quest.getStage(player) === STAGE_CERTIFICATE &&
      hasItem(player, CERTIFICATE_ID)
    ) {
      event.handled = true;
      event.end = false;
      return;
    }

    if (!stepId) return;

    if (BARAEK_NPC_IDS.has(npcId) && BARAEK_PAY_ACTIONS.has(stepId)) {
      if (coins(player) < 20) return;
      player.getInventory().deleteNumber(COINS_ID, 20);
      player.setAttribute(PHOENIX_LOCATION_ATTRIBUTE, true);
      syncGangProgress(player);
      player.sendMessage("You give 20 coins to Baraek.");
      event.handled = true;
      return;
    }

    if (npcId === CHARLIE_NPC_ID && (CHARLIE_TEN_COIN_MESSAGES.has(stepId) || CHARLIE_FIVE_COIN_MESSAGES.has(stepId))) {
      const cost = CHARLIE_TEN_COIN_MESSAGES.has(stepId) ? CHARLIE_FULL_PAYMENT : 5;
      if (coins(player) < cost) return;
      player.getInventory().deleteNumber(COINS_ID, cost);
      // Five coins only buys half the information; the second five completes it.
      player.setAttribute(CHARLIE_PAID_ATTRIBUTE, Math.min(CHARLIE_FULL_PAYMENT, charliePaid(player) + cost));
      syncGangProgress(player);
      return; // leave the message to the runtime
    }

    if (WEAPONSMASTER_NPC_IDS.has(npcId) && stepId === WEAPONMASTER_ATTACK_STEP) {
      if (!isPhoenix(player)) event.npc?.getCombat?.().attack?.(player);
      event.handled = true;
      return;
    }

    if (npcId === STRAVEN_NPC_ID) {
      if (stepId === STRAVEN_KEY_MESSAGE || STRAVEN_HANDIN_ACTIONS.has(stepId)) {
        handInReport(player, quest);
        if (STRAVEN_HANDIN_ACTIONS.has(stepId)) event.handled = true;
        return;
      }
      if (STRAVEN_LOST_KEY_MESSAGES.has(stepId)) {
        giveItem(player, KEY_ID);
        return;
      }
    }

    if (npcId === KATRINE_NPC_ID && (stepId === KATRINE_HANDIN_MESSAGE || stepId === KATRINE_HANDIN_ACTION)) {
      handInCrossbows(player, quest);
      if (stepId === KATRINE_HANDIN_ACTION) event.handled = true;
      return;
    }

    if (npcId === CURATOR_NPC_ID) {
      if (stepId === CURATOR_CERT_MESSAGE) {
        const own = ownShieldAndCert(player);
        if (!handInShieldHalf(player, quest)) event.handled = true;
        else {
          event.text = "You give the shield half to the curator and he gives you two half-certificates.";
          event.box = { items: [own.shield, own.half] };
        }
        return;
      }
      if (stepId === CURATOR_REPLACE_MESSAGE) {
        const own = ownShieldAndCert(player);
        if (!own || quest.getStage(player) !== STAGE_CERTIFICATE || hasItem(player, own.half)) {
          event.handled = true;
          return;
        }
        if (!giveItems(player, own.half, 2)) event.handled = true;
        return;
      }
    }

    if (KING_ROALD_NPC_IDS.has(npcId) && KING_COMPLETE_ACTIONS.has(stepId)) {
      if (!hasItem(player, CERTIFICATE_ID)) return;
      player.getInventory().deleteNumber(CERTIFICATE_ID, 1);
      quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  /**
   * The curator is not indexed to the Shield of Arrav page, so his own Talk-to
   * would play The Dig Site. While the player is on the shield half-in, replay
   * the curator's Shield of Arrav variant instead; the action steps then reach
   * the hand-in above with the real curator id and chathead.
   */
  function handleNpcInteraction(event) {
    if (event.npcId !== CURATOR_NPC_ID) return;
    const action = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "");
    if (action.toLowerCase() !== "talk-to") return;

    const { player } = event;
    if (theGolemOwnsCurator(player)) return;
    const stage = quest.getStage(player);
    const own = ownShieldAndCert(player);
    if (!own || stage < STAGE_JOINED_GANG || stage >= STAGE_COMPLETE) return;

    if (stage === STAGE_JOINED_GANG && hasItem(player, own.shield)) {
      event.handled = true;
      startTranscript(api, player, CURATOR_NPC_ID, PAGE, CURATOR_SHIELD_VARIANT);
      return;
    }
    if (stage === STAGE_CERTIFICATE && !hasItem(player, CERTIFICATE_ID) && !hasItem(player, own.half)) {
      event.handled = true;
      startTranscript(api, player, CURATOR_NPC_ID, PAGE, CURATOR_REPLACE_VARIANT);
    }
  }

  /** Fill the wiki transcript's "[player name]" blanks in Reldo's lines. */
  function fillReldoPlayerName(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!RELDO_NPC_IDS.has(request.npcId)) return;
    if (!request.text.includes("[player name]")) return;
    request.text = request.text.replace(/\[player name\]/gi, request.player.getUsername());
  }

  function handleLogin({ player }) {
    syncGangProgress(player);
  }

  function handleStageChanged({ player, key }) {
    if (key === "shield_of_arrav") syncGangProgress(player);
  }

  function readBook(event) {
    if (event.itemId !== BOOK_ID) return;
    const option = String(event.option ?? "").toLowerCase();
    if (!option.includes("read")) return;
    if (!hasItem(event.player, BOOK_ID)) return;
    openBook(event.player, "The Shield of Arrav", BOOK_PAGES);
    if (quest.getStage(event.player) === STAGE_STARTED) {
      quest.setStage(event.player, STAGE_READ_BOOK);
    }
    event.handled = true;
  }

  function readCertificate(event) {
    if (event.itemId !== CERTIFICATE_ID || String(event.option).toLowerCase() !== "read" || !hasItem(event.player, CERTIFICATE_ID)) return;
    event.player.getPacketSender().sendInterface(CERTIFICATE_INTERFACE)
      .sendString(CERTIFICATE_TEXT, (CERTIFICATE_INTERFACE << 16) | 3);
    event.handled = true;
  }

  function closeCertificate({ player }) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  function inspectQuestItem(event) {
    if (String(event.option).toLowerCase() !== "inspect") return;
    const { player, itemId } = event;
    if (!hasItem(player, itemId)) return;
    if (itemId === PHOENIX_CERT_ID || itemId === BLACKARM_CERT_ID) {
      if (hasItem(player, PHOENIX_CERT_ID) && hasItem(player, BLACKARM_CERT_ID)) {
        api.sendMultiChatboxPrompt(player, "Combine the two half-certificates?",
          "Yes.", () => combineCertificateHalves({ player, usedItemId: PHOENIX_CERT_ID, usedWithItemId: BLACKARM_CERT_ID }),
          "No.", () => {});
      } else player.sendMessage("It's half of a certificate for claiming a reward from King Roald. If you're working with a player who's restricted from trading, you can still give them this item by using it on them.");
    } else if (itemId === KEY_ID) {
      player.sendMessage("It's the key to the Phoenix Gang's weapons store. If you're working with a player who's restricted from trading, you can still give them this item by using it on them.");
    } else if (itemId === CROSSBOW_ID) {
      player.sendMessage("If you need to give this item to a player who's restricted from trading, you can give them the item by using it on them.");
    } else return;
    event.handled = true;
  }

  function combineCertificateHalves(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(PHOENIX_CERT_ID) || !pair.has(BLACKARM_CERT_ID)) return;
    if (quest.getStage(player) !== STAGE_CERTIFICATE) return;
    if (!hasItem(player, PHOENIX_CERT_ID) || !hasItem(player, BLACKARM_CERT_ID)) return;
    player.getInventory().deleteNumber(PHOENIX_CERT_ID, 1);
    player.getInventory().deleteNumber(BLACKARM_CERT_ID, 1);
    player.getInventory().adds(CERTIFICATE_ID, 1);
    StatementDialogue.send(player, "You combine the two halves to make a complete certificate.");
    event.handled = true;
  }

  function handReportToStraven(event) {
    if (event.itemId !== REPORT_ID) return;
    if ((event.npcId ?? event.target?.getId?.()) !== STRAVEN_NPC_ID) return;
    if (handInReport(event.player, quest)) event.handled = true;
  }

  function useKeyOnDoor(event) {
    if (event.itemId !== KEY_ID || event.objectId !== WEAPON_STORE_DOOR_ID) return;
    if (!hasItem(event.player, KEY_ID)) return;
    event.player.sendMessage("You unlock the door using the key you're carrying.");
    crossDoor(event.player, event.object);
    event.handled = true;
  }

  // OSRS offers a deliberate hand-over prompt for all three tradeable quest items.
  function handleItemOnPlayer(event) {
    const { player, target, itemId } = event;
    if (![KEY_ID, CROSSBOW_ID, PHOENIX_CERT_ID, BLACKARM_CERT_ID].includes(itemId)) return;
    if (!target?.getInventory || !hasItem(player, itemId)) return;
    const label = itemId === KEY_ID ? "key" : itemId === CROSSBOW_ID ? "crossbow" : "certificate";
    event.handled = true;
    api.sendMultiChatboxPrompt(player, `Drop your ${label} for ${target.getUsername()} to take?`,
      "Yes", () => {
        if (!hasItem(player, itemId)) return;
        const location = player.getLocation().clone();
        if (player.getPrivateArea() !== target.getPrivateArea() || !target.getLocation().isWithinDistance(location, 1)) return;
        groundItems.registerLocation(target, new Item(itemId, 1), location);
        player.getInventory().deleteNumber(itemId, 1);
        player.sendMessage(`${target.getUsername()} can now take the item from the ground.`);
        target.sendMessage(`<col=ef1020>${player.getUsername()} has dropped something for you to take.</col>`);
      },
      "No", () => {});
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId } = event;

    if (objectId === BOOKCASE_ID && option.includes("search")) {
      searchBookcase(player, quest);
      event.handled = true;
      return;
    }
    if (PHOENIX_CHEST_IDS.has(objectId) && (option.includes("open") || option.includes("search"))) {
      searchShieldCache(player, quest, true);
      event.handled = true;
      return;
    }
    if (BLACKARM_CUPBOARD_IDS.has(objectId) && (option.includes("open") || option.includes("search"))) {
      searchShieldCache(player, quest, false);
      event.handled = true;
      return;
    }
  }

  /** Doors.plugin.js claims every "Door" first; the gang doors are claimed here through door:toggle. */
  function handleGangDoor(request) {
    const { player, objectId, object } = request;
    if (request.handled || ![WEAPON_STORE_DOOR_ID, BLACKARM_DOOR_ID, PHOENIX_HIDEOUT_DOOR_ID].includes(objectId)) return;
    request.handled = true;
    if (objectId === WEAPON_STORE_DOOR_ID) {
      if (!hasItem(player, KEY_ID)) {
        player.sendMessage("The door is securely locked.");
        return;
      }
      player.sendMessage("You unlock the door using the key you're carrying.");
    } else if (objectId === BLACKARM_DOOR_ID && (!isBlackArm(player) || quest.getStage(player) < STAGE_JOINED_GANG)) {
      player.sendMessage(isPhoenix(player) && joinedGang(player)
        ? "The door is securely locked."
        : "This door seems to be locked from the inside.");
      return;
    } else if (objectId === PHOENIX_HIDEOUT_DOOR_ID && (!isPhoenix(player) || quest.getStage(player) < STAGE_JOINED_GANG)) {
      player.sendMessage("The door is securely locked.");
      return;
    }
    crossDoor(player, object);
  }

  function handleNpcDeath({ killer, npc, npcId }) {
    if (!killer || !npc || !groundItems) return;
    const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
    if (!location) return;

    if (JONNY_NPC_IDS.has(npcId)) {
      if (!phoenixTask(killer) || joinedGang(killer) || quest.getStage(killer) !== STAGE_GANG_TASK) return;
      if (hasItem(killer, REPORT_ID)) return;
      groundItems.registerLocation(killer, new Item(REPORT_ID, 1), location);
      return;
    }
  }

  class WeaponsStoreArea extends Area {
    canAttack(attacker, target) {
      if (!attacker.isPlayer() || !WEAPONSMASTER_NPC_IDS.has(target.getId?.())) return null;
      if (joinedGang(attacker) && isPhoenix(attacker) && !quest.isComplete(attacker)) {
        attacker.sendMessage("He's a fellow Phoenix Gang member.");
        return false;
      }
      return null;
    }
  }

  function protectPhoenixCrossbows(event) {
    if (event.groundItem?.getItem?.()?.getId?.() !== CROSSBOW_ID) return;
    const tile = event.groundItem.getPosition();
    if (tile.getZ() !== 1 || tile.getX() < 3242 || tile.getX() > 3253 || tile.getY() < 3380 || tile.getY() > 3390) return;
    const weaponsmaster = [...(api.getWorld()?.getNpcs?.() ?? [])].find((npc) =>
      WEAPONSMASTER_NPC_IDS.has(npc?.getId?.()) && npc.getHitpoints() > 0 && !npc.isDyingFunction());
    if (!weaponsmaster) return;
    event.handled = true;
    if (joinedGang(event.player) && isPhoenix(event.player)) {
      weaponsmaster.forceChat("Hey! That's Straven's! He won't like you messing with that!");
      return;
    }
    weaponsmaster.forceChat("Stop! Thief!");
    weaponsmaster.getCombat().attack(event.player);
  }

  function searchBookcase(player, questHandle) {
    if (questHandle.getStage(player) !== STAGE_STARTED) {
      player.sendMessage("A large collection of books.");
      return;
    }
    if (hasItem(player, BOOK_ID)) {
      player.sendMessage("You already have The Shield of Arrav.");
      return;
    }
    giveItem(player, BOOK_ID, "You search the bookcase and find a book titled The Shield of Arrav.");
  }

  function searchShieldCache(player, questHandle, phoenix) {
    if (questHandle.getStage(player) !== STAGE_JOINED_GANG || isPhoenix(player) !== phoenix) {
      player.sendMessage("You find nothing of interest.");
      return;
    }
    const itemId = phoenix ? PHOENIX_HALF_ID : BLACKARM_HALF_ID;
    if (hasItem(player, itemId)) {
      player.sendMessage(phoenix
        ? "You open the chest, but don't find anything of interest inside."
        : "You open the cupboard, but don't find anything of interest inside.");
      return;
    }
    if (phoenix) player.sendMessage("You search the chest.");
    giveItem(player, itemId, phoenix
      ? "You open the chest and find half of a shield inside."
      : "You open the cupboard and find half of a shield inside.");
  }

  function crossDoor(player, door) {
    const crossing = crossingFor(door, player.getLocation());
    if (crossing) player.moveTo(new Location(crossing.destination.x, crossing.destination.y, crossing.destination.z));
  }

  quest = registerQuest(api, {
    key: "shield_of_arrav",
    name: "Shield of Arrav",
    varpId: VARP_SHIELD_OF_ARRAV,
    varpValue: (stage, player) => phoenixProgress(player),
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    scrollItemId: CERTIFICATE_ID,
    rewardItemLabel: "600 Coins",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(DIRECTIONS_ATTRIBUTE, false);
  api.persistAttribute(PHOENIX_TASK_ATTRIBUTE, false);
  api.persistAttribute(BLACKARM_TASK_ATTRIBUTE, false);
  api.persistAttribute(GANG_ATTRIBUTE);
  api.persistAttribute(PHOENIX_LOCATION_ATTRIBUTE);
  api.persistAttribute(CHARLIE_PAID_ATTRIBUTE, 0);
  api.persistAttribute(CHARLIE_MET_ATTRIBUTE, false);
  api.persistAttribute(RELDO_MET_ATTRIBUTE, false);

  groundItems = api.getItemOnGroundManager();

  api.onNpcDialogueVariant(selectDialogueVariant);
  api.onNpcDialogueCondition(answerDialogueCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleGangChoice);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", fillReldoPlayerName);
  api.onCustomEvent("npc-dialogue:line", renderQuestLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onNpcInteraction(handleNpcInteraction);
  api.onPlayerLogin(handleLogin);
  api.onItemAction(readBook);
  api.onItemAction(inspectQuestItem);
  api.onItemAction(readCertificate);
  api.onInterfaceActionButton([(CERTIFICATE_INTERFACE << 16) | 4], closeCertificate);
  api.onItemOnItem(combineCertificateHalves);
  api.onItemOnNpc(handReportToStraven);
  api.onItemOnObject(useKeyOnDoor);
  api.onItemOnPlayer(handleItemOnPlayer);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("door:toggle", handleGangDoor);
  api.onNpcDeath(handleNpcDeath);
  api.onGroundItemPickup(protectPhoenixCrossbows);
  api.registerArea(new WeaponsStoreArea([new Boundary(3242, 3253, 3380, 3390, 1)]));
};
