/** Pirate's Treasure. Capture evidence: docs/f2p-coastal-parity.md. */
module.exports = function registerPiratesTreasureQuest(api) {
  const { Equipment, Item, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, GameObject, Animation, Task, TaskManager, CountdownTask, StatementDialogue } = api.core;
  const { registerQuest, startTranscript, questNamed } = require("../QuestRuntime");

  const FRANK_NPC_ID = NpcIdentifiers.REDBEARD_FRANK;
  const WYDIN_NPC_ID = NpcIdentifiers.WYDIN;
  const LUTHAS_NPC_ID = NpcIdentifiers.LUTHAS;
  const BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_6;
  const ZEMBO_NPC_ID = NpcIdentifiers.ZEMBO;
  const BARCRAWL_PROGRESS_VARBIT = 13714; // Cache241: 0 unstarted, 1 during, >=2 complete.
  const GARDENER_NPC_ID = NpcIdentifiers.GARDENER_3;
  const CUSTOMS_OFFICER_IDS = new Set([
    NpcIdentifiers.CUSTOMS_OFFICER,
    NpcIdentifiers.CUSTOMS_OFFICER_2,
  ]);

  const VARP_PIRATES_TREASURE = 71;
  const STAGE_STARTED = 1;
  const STAGE_KEY = 2;
  const STAGE_NOTE = 3;
  const STAGE_COMPLETE = 4;

  const RUM_ITEM_ID = ItemIdentifiers.KARAMJAN_RUM;
  const KEY_ITEM_ID = ItemIdentifiers.CHEST_KEY;
  const MESSAGE_ITEM_ID = ItemIdentifiers.PIRATE_MESSAGE;
  const CASKET_ITEM_ID = ItemIdentifiers.CASKET_3;
  const NOTE_INTERFACE = 222;
  const BANANA_ITEM_ID = ItemIdentifiers.BANANA;
  const APRON_ITEM_ID = ItemIdentifiers.WHITE_APRON;
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const RING_ITEM_ID = ItemIdentifiers.GOLD_RING;
  const EMERALD_ITEM_ID = ItemIdentifiers.EMERALD;

  const PLANTATION_CRATE_ID = ObjectIdentifiers.CRATE_15;
  const STORE_CRATE_ID = ObjectIdentifiers.CRATE_14;
  const STOCK_ROOM_DOOR_ID = ObjectIdentifiers.DOOR_56;
  const CHEST_ID = ObjectIdentifiers.CHEST_4;
  const OPEN_CHEST_ID = 2080; // piratechestopen, cache241/capture.
  const CHEST_TILE = new Location(3219, 3396, 1);
  const CHEST_OPEN_SOUND = 52;
  /** chest_open: the casket opening, as the chest (the user's rev 242 capture PiratesTreasure, tick 1236). */
  const CASKET_OPEN_SOUND = 52;
  /** locked: Open on the closed chest (rev 242 capture, ticks 1107 and 1123). */
  const CHEST_LOCKED_SOUND = 2402;
  const TREASURE_TILE = { x: 2999, y: 3383, z: 0 };
  /** The gardener appears at 3001,3386 facing south-west (Direction 5), as the rev 242 capture adds him (tick 1197). */
  const GARDENER_TILE = { x: 3001, y: 3386, z: 0 };
  const GARDENER_FACE = 5;
  const DIG_ANIMATION = 830;
  /** digspade, on both digs (rev 242 capture, ticks 1197 and 1226). */
  const DIG_SOUND = 1470;
  const STOCK_ROOM_DOOR_TILE = { x: 3012, y: 3204 };
  const STORE_CRATE_TILE = { x: 3009, y: 3207 };
  /** The store crate: "There are a lot of bananas", the rum 4 ticks later, the banana question 4 ticks after (rev 242 capture, ticks 942-950; rsprox index grocerycrate). */
  const STORE_CRATE_STEP_TICKS = 4;
  /** pick2 and human_pickuptable, when the rum or a banana comes out of the store crate (rev 242 capture, ticks 946 and 953). */
  const PICK_SOUND = 2582;
  const PICK_ANIMATION = 832;

  /**
   * The boats, as the user's rev 242 capture PiratesTreasure plays every Karamja crossing (ticks 171, 187, 221,
   * 327, 343, 431, 822; every Karamja boat recording since rev 227 agrees): "You pay the boarding charge of 30
   * coins." and "You board the ship and sail to <port>." on the click, the sea jingle and fade_overlay out, the
   * dock five ticks later, the fade back in two ticks after that and the overlay closed two more. No message box.
   */
  const PORT_SARIM_LANDING = new Location(3029, 3217, 0);
  const MUSA_POINT_LANDING = new Location(2956, 3146, 0);
  const PANDEMONIUM_LANDING = new Location(3065, 3002, 0);
  const SEAMAN_MORRIS_NPC_ID = NpcIdentifiers.SEAMAN_MORRIS;
  const TOPLEVEL = 161;
  const OVERLAY_ATMOSPHERE_UID = (TOPLEVEL << 16) | 1;
  const FADE_OVERLAY = 174;
  const FADE_SCRIPT = 948;
  const FADE_CYCLES = 50;
  const SEA_SONG = 147;
  const SEA_JINGLE = 171;
  const VOYAGE_LAND_TICK = 5;
  const VOYAGE_FADE_IN_TICK = 7;
  const VOYAGE_CLOSE_TICK = 9;
  const FARE = 30;
  /** The half fare for worn Karamja gloves, both ways (the customs officer's Pay-fare transcript; Wiki, Seaman Lorris). */
  const GLOVES_FARE = 15;
  const GARDENER_SHOUT = "First moles, now this! Take this, vandal!";
  const RUM_SPILLED = "Your Karamjan rum gets broken and spilled.";
  /** Gerrant's hooked apron (piratetreasure_apron), taken as a white apron (data/definitions/ground-items.json). */
  const HOOKED_APRON_ITEM_ID = 7957;
  /** Wiki (Pirate's Treasure transcript) and the rev 242 capture, tick 850. */
  const APRON_TAKEN = "You take an apron. It feels freshly starched and smells of laundry.";
  const MAIN_MODAL_OPEN = 2524;
  const NO_MODAL_BACKGROUND = [-1, -1];

  /** Packing a banana into the crate: captured animation and sound (rsprox 4287). */
  const PACK_BANANA_ANIMATION = 832;
  const PACK_BANANA_SOUND = 2739;

  const EMPLOYMENT_ATTRIBUTE = "pirates-treasure.employment";
  const BANANA_ATTRIBUTE = "pirates-treasure.bananas";
  const RUM_ATTRIBUTE = "pirates-treasure.rum";
  const DUG_ATTRIBUTE = "pirates-treasure.dug";

  const START_HOOK = "quest:pirate-s-treasure:start";
  const EMPLOYMENT_CHOICE = "Could you offer me employment on your plantation?";
  /** After a payment, this answer ends the job: Luthas greets the player afresh next time (rev 242 capture, ticks 588-591, 805-808). */
  const LEAVE_PLANTATION_CHOICE = "Thank you, I'll be on my way";
  /** "If the player has a white apron:" - the branch that hires the player. */
  const WYDIN_HIRE_CONDITION_ID = "06RiCk";
  /** "If the player has enough coins:" under the bartender's rum option. */
  const BARTENDER_RUM_COINS_ID = "HEeY2G";
  /** "The customs officer confiscates your rum." (three pages). */
  const RUM_CONFISCATE_STEP_IDS = new Set(["JN4f2Q", "pUSUQY", "et2BjU", "CO6KKg", "pNZxTm"]);
  /** Seaman Morris's "Where would you like to go?" answers; the trip starts once the player has said it. */
  const MORRIS_PORT_SARIM_LINE = "I'd like to go to Port Sarim.";
  const MORRIS_MUSA_POINT_LINE = "I'd like to go to Musa Point.";
  /** "30 coins" actions on the two Luthas payment pages. */
  const PAYMENT_STEP_IDS = new Set(["76-Dox", "1YHx0E"]);
  const PAYMENT_MESSAGE_ID = "A0JWWz";
  const BANANA_WAGE = 30;
  const RECLAIM_KEY_STEP_ID = "0m95Tl";
  /** "Frank happily takes the rum... and hands you a key." */
  const RUM_HANDIN_STEP_ID = "Uy0FFQ";
  /** Seamen/Tobias "The player is transported to Karamja." action steps. */
  const SAIL_TO_KARAMJA_STEP_IDS = new Set(["0dBZni", "ZZHN0-", "oJnbxR", "aCDRxJ"]);
  /** Tobias's after-Pandemonium "The player is then transported to the Pandemonium." step. */
  const SAIL_TO_PANDEMONIUM_STEP_ID = "yrFrGT";
  /** Their "If the player does not have enough coins" conditions. */
  const SAIL_FARE_CONDITION_IDS = new Set(["4EHa7z", "PWA2Z3", "FUAwJK"]);
  /** Customs officer payment steps: fare 30, 15 with Karamja gloves, free with Charos. */
  const SAIL_BACK_FARES = new Map([
    ["QF4lwJ", 30],
    ["ThyZB7", 15],
    ["upG45P", 0],
  ]);
  /** "If the player has completed Rum Deal:" before Frank's Braindeath line (rev 242 capture, tick 57). */
  const RUM_DEAL_CONDITION_IDS = new Set(["6py1j9", "WbtA4m"]);

  let quest;
  /** The gardener each player's last dig spawned; a WeakMap so a lost NPC never sticks. */
  const gardenerByPlayer = new WeakMap();
  const digging = new WeakSet();
  /** Players crossing on a boat, mapped to the trip's landing (run early on logout). */
  const sailing = new Map();
  const searchingStoreCrate = new WeakSet();
  const openingChests = new WeakMap();

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const isEmployed = (player, bit) => (attr(player, EMPLOYMENT_ATTRIBUTE) & bit) !== 0;
  const hasApron = (player) => hasItem(player, APRON_ITEM_ID) || wearingApron(player);
  const wearingApron = (player) =>
    player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === APRON_ITEM_ID;

  function giveItem(player, itemId, message) {
    if (hasItem(player, itemId)) return true;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  /** Runs `action` once, `ticks` from now, while the player is logged in. */
  function later(player, ticks, action) {
    const task = new Task(ticks, player, false);
    task.execute = () => {
      task.stop();
      if (player.isRegistered?.() !== false) action();
    };
    TaskManager.submit(task);
  }

  const BLUE = "<col=000080>";
  const RED = "<col=800000>";
  const STRUCK = "<str>";
  const FRANK_LINES = [
    `${BLUE}I have spoken to ${RED}Redbeard Frank${BLUE}. He has agreed to tell me the`,
    `${BLUE}location of some ${RED}treasure${BLUE} for some ${RED}Karamja Rum${BLUE}.`,
  ];

  /**
   * The journal. Stage 1 and 2 are the captured lines (rev 242 capture PiratesTreasure ticks 111, 556, 748, 858;
   * the user's rev 240 recording 1001335 for the shipped crate and stage 2); "I have taken employment as  the"
   * keeps live's double space. Stages 3 and 4 have no capture. Ours: stage 2's lines struck, then the note's clue.
   */
  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to",
        `${RED}Redbeard Frank</col> at Port Sarim.`,
      ];
    }
    if (stage === STAGE_STARTED) return ["", ...FRANK_LINES, "", ...rumLines(player)];
    const keyLines = [
      "",
      `${STRUCK}I have spoken to Redbeard Frank. He has agreed to tell me the`,
      `${STRUCK}location of some treasure for some Karamja Rum.`,
      "",
      `${STRUCK}I have smuggled some rum off Karamja, and retrieved it from`,
      `${STRUCK}the back room of Wydin's shop.`,
      "",
    ];
    const toldLines = [
      `${BLUE}I have given the rum to ${RED}Redbeard Frank${BLUE}. He has told me that`,
      `${BLUE}the ${RED}treasure${BLUE} is hidden in the chest in the upstairs room of`,
      `${BLUE}the ${RED}Blue Moon Inn${BLUE} in ${RED}Varrock${BLUE}.`,
    ];
    if (stage === STAGE_KEY) {
      return [...keyLines, ...toldLines, "",
        `${BLUE}I have a ${RED}key${BLUE} that can be used to unlock the chest that holds`,
        `${BLUE}the treasure. The chest is located in ${RED}Hector's old room${BLUE}, at the`,
        `${BLUE}${RED}Blue Moon Inn${BLUE} in ${RED}Varrock${BLUE}.`,
      ];
    }
    const struck = [...keyLines,
      `${STRUCK}I have given the rum to Redbeard Frank. He has told me that`,
      `${STRUCK}the treasure is hidden in the chest in the upstairs room of`,
      `${STRUCK}the Blue Moon Inn in Varrock.`,
      "",
    ];
    if (stage === STAGE_NOTE) {
      // Ours: no capture opens the journal after the note is read.
      return [...struck,
        `${BLUE}The ${RED}pirate message${BLUE} says the treasure is buried in ${RED}Falador Park${BLUE},`,
        `${BLUE}where Saradomin points to the X. I should bring a ${RED}spade${BLUE}.`,
      ];
    }
    // Ours: no capture opens the completed journal.
    return [...struck,
      `${STRUCK}I dug up One-Eyed Hector's treasure in Falador Park.`,
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  /** Stage 1's second paragraph: the rum's way off Karamja, as far as the player has got. */
  function rumLines(player) {
    const employed = isEmployed(player, 1);
    const rum = attr(player, RUM_ATTRIBUTE);
    if (rum >= 2) {
      return [
        `${STRUCK}I have taken employment on the banana plantation, as  the`,
        `${STRUCK}Customs Officers might not notice the rum if it is covered in`,
        `${STRUCK}bananas.`,
        "",
        `${STRUCK}I have hidden my rum in the crate. I should fill it with bananas`,
        `${STRUCK}and speak to Luthas to have it shipped over.`,
        "",
        `${BLUE}I have spoken to ${RED}Luthas${BLUE}, and the crate has been shipped to`,
        `${BLUE}${RED}Wydin's store${BLUE} in ${RED}Port Sarim${BLUE} north of the jail. Now all I have to`,
        `${BLUE}do is get to it...`,
      ];
    }
    if (!employed && rum === 0) {
      return [
        `${BLUE}I need to go to ${RED}Karamja${BLUE} and buy some ${RED}rum${BLUE}. I hope it is not too`,
        `${BLUE}expensive.`,
      ];
    }
    return [
      `${BLUE}I have taken employment on the ${RED}banana plantation${BLUE}, as the`,
      `${BLUE}${RED}Customs Officers${BLUE} might not notice the ${RED}rum${BLUE} if it is covered in`,
      `${BLUE}${RED}bananas${BLUE}.`,
      "",
      ...(rum === 1 ? [
        `${BLUE}I have hidden my ${RED}rum${BLUE} in the crate. I should fill it with ${RED}bananas${BLUE}`,
        `${BLUE}and speak to ${RED}Luthas${BLUE} to have it shipped over.`,
      ] : [
        `${BLUE}Now all I need is some ${RED}rum${BLUE} to hide in the next crate destined`,
        `${BLUE}for ${RED}Wydin's store${BLUE}...`,
      ]),
    ];
  }


  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === FRANK_NPC_ID) {
      // Once he has the rum, Frank no longer offers the treasure: "Arr!" and "Do you have anything for trade?"
      // only, as after the quest (rev 242 capture, ticks 1034-1042, key in hand). Ours: stage 3 the same.
      const after = { page: "Redbeard Frank", variant: "after-pirate-s-treasure" };
      if (stage >= STAGE_COMPLETE || stage === STAGE_NOTE) return after;
      if (stage === STAGE_KEY) {
        if (hasItem(player, KEY_ITEM_ID) || hasItem(player, MESSAGE_ITEM_ID)) return after;
        return { page: "Pirate's Treasure", variant: "delivering-the-rum-reclaiming-the-key" };
      }
      if (stage === STAGE_STARTED) {
        return hasItem(player, RUM_ITEM_ID)
          ? { page: "Pirate's Treasure", variant: "delivering-the-rum-talking-to-redbeard-frank" }
          : { page: "Pirate's Treasure", variant: "getting-started-talking-to-redbeard-frank-again" };
      }
      return { page: "Pirate's Treasure", variant: "getting-started-talking-to-redbeard-frank" };
    }

    if (npcId === WYDIN_NPC_ID) {
      if (isEmployed(player, 2)) {
        return { page: "Pirate's Treasure", variant: "retrieving-the-rum-talking-to-wydin-after-getting-the-job" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Pirate's Treasure", variant: "retrieving-the-rum-talking-to-wydin" };
      }
      return null;
    }

    if (npcId === LUTHAS_NPC_ID) {
      if (isEmployed(player, 1)) {
        return attr(player, BANANA_ATTRIBUTE) >= 10
          ? { page: "Pirate's Treasure", variant: "visiting-karamja-talking-to-luthas-after-filling-up-the-crate" }
          : { page: "Luthas", variant: "standard-dialogue-after-accepting-his-task" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Pirate's Treasure", variant: "visiting-karamja-talking-to-luthas" };
      }
      return null;
    }

    if (CUSTOMS_OFFICER_IDS.has(npcId)) {
      return stage >= STAGE_COMPLETE
        ? { page: "Customs officer", variant: "standard-dialogue-after-completing-pirate-s-treasure" }
        : { page: "Customs officer", variant: "standard-dialogue-before-completing-pirate-s-treasure" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text, stepId }) {
    const value = String(text).toLowerCase();

    if (npcId === FRANK_NPC_ID) {
      if (RUM_DEAL_CONDITION_IDS.has(stepId) || value.includes("completed rum deal")) {
        return questNamed("Rum Deal")?.isComplete(player) === true;
      }
      if (stepId === "I3U8bt" || value.includes("does not have the rum")) return !hasItem(player, RUM_ITEM_ID);
    }

    if (npcId === WYDIN_NPC_ID) {
      if (value.includes("white apron is not equipped")) return !wearingApron(player);
      if (value.includes("does not have a white apron")) return !hasApron(player);
      if (value.includes("has a white apron")) return hasApron(player);
    }

    if (CUSTOMS_OFFICER_IDS.has(npcId)) {
      if (value.includes("does not have karamjan rum")) return !hasItem(player, RUM_ITEM_ID);
      if (value.includes("has karamjan rum")) return hasItem(player, RUM_ITEM_ID);
      const coins = player.getInventory().getAmount(COINS_ITEM_ID);
      if (value.includes("karamja gloves")) {
        if (!wearsKaramjaGloves(player)) return false;
        if (value.includes("does not have 15")) return coins < GLOVES_FARE;
        if (value.includes("has 15")) return coins >= GLOVES_FARE;
        return true;
      }
      // The Karamja gloves' half fare comes before the 30-coin answers.
      if (stepId === "l2iXlt" || stepId === "o99Ow0" || value.includes("does not have enough coins")) {
        return !wearsKaramjaGloves(player) && coins < FARE;
      }
      if (stepId === "GGmLiT" || value.includes("has 30 coins")) {
        return !wearsKaramjaGloves(player) && coins >= FARE;
      }
      if (value.includes("ring of charos")) return wearsRingOfCharos(player);
    }

    if (SAIL_FARE_CONDITION_IDS.has(stepId)) {
      // "Not enough money" uses the fare the Travel click charges: 15 in Karamja gloves (Wiki, Seaman Lorris).
      return player.getInventory().getAmount(COINS_ITEM_ID) < (wearsKaramjaGloves(player) ? GLOVES_FARE : FARE);
    }

    if (npcId === ZEMBO_NPC_ID && value === "during alfred grimhand's barcrawl:") {
      return player.getPacketSender().getVarbit(BARCRAWL_PROGRESS_VARBIT) === 1;
    }

    if (npcId === BARTENDER_NPC_ID) {
      const coins = player.getInventory().getAmount(COINS_ITEM_ID);
      if (stepId === BARTENDER_RUM_COINS_ID) return coins >= 27;
      if (stepId === "MPrKD-") return coins < 27;
      if (stepId === "ruDy4d") return coins >= 3;
      if (stepId === "CYuhhY") return coins < 3;
    }

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== FRANK_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    if (npcId !== LUTHAS_NPC_ID) return;
    if (option === EMPLOYMENT_CHOICE) {
      setAttr(player, EMPLOYMENT_ATTRIBUTE, attr(player, EMPLOYMENT_ATTRIBUTE) | 1);
    } else if (option === LEAVE_PLANTATION_CHOICE) {
      setAttr(player, EMPLOYMENT_ATTRIBUTE, attr(player, EMPLOYMENT_ATTRIBUTE) & ~1);
    }
  }

  function handleConditionMet({ player, npcId, stepId }) {
    if (npcId === WYDIN_NPC_ID && stepId === WYDIN_HIRE_CONDITION_ID) {
      setAttr(player, EMPLOYMENT_ATTRIBUTE, attr(player, EMPLOYMENT_ATTRIBUTE) | 2);
    }
    if (npcId === BARTENDER_NPC_ID && stepId === BARTENDER_RUM_COINS_ID) {
      buyRum(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === WYDIN_NPC_ID && stepId === "2MkvlZ") {
      event.handled = true;
      startTranscript(api, player, WYDIN_NPC_ID, "Pirate's Treasure", "retrieving-the-rum-talking-to-wydin", (steps) => steps[1].options[3].steps);
      return;
    }
    if (npcId === FRANK_NPC_ID && stepId === RUM_HANDIN_STEP_ID) {
      event.box = { items: [RUM_ITEM_ID, KEY_ITEM_ID] };
      if (quest.getStage(player) === STAGE_STARTED && hasItem(player, RUM_ITEM_ID)) {
        player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
        giveItem(player, KEY_ITEM_ID);
        quest.setStage(player, STAGE_KEY);
      }
      return;
    }
    if (npcId === FRANK_NPC_ID && stepId === RECLAIM_KEY_STEP_ID) {
      giveItem(player, KEY_ITEM_ID);
      event.handled = true;
      return;
    }
    if (npcId === LUTHAS_NPC_ID && (stepId === PAYMENT_MESSAGE_ID || PAYMENT_STEP_IDS.has(stepId))) {
      if (attr(player, BANANA_ATTRIBUTE) >= 10
          && player.getInventory().getAddableAmount(new Item(COINS_ITEM_ID, BANANA_WAGE)) < BANANA_WAGE) {
        // No capture covers a capped coin stack; this refusal wording is ours.
        player.sendMessage("You can't carry all of your wages.");
        event.handled = true;
        event.end = true;
        return;
      }
      if (PAYMENT_STEP_IDS.has(stepId)) payForBananas(player);
      // The transcript's own "Luthas hands you 30 coins." step (A0JWWz) stays silent: payForBananas sends that line
      // with the coins at the next step (76-Dox), once, as live does (rsprox_transcripts/239/04287.txt).
      event.handled = true;
      return;
    }
    if (CUSTOMS_OFFICER_IDS.has(npcId) && RUM_CONFISCATE_STEP_IDS.has(stepId)) {
      if (event.text) player.sendMessage(String(event.text));
      // The carried bottle only: rum already stashed or shipped in Luthas's crate stays there.
      if (hasItem(player, RUM_ITEM_ID)) player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
      event.handled = true;
      return;
    }
    if (SAIL_TO_KARAMJA_STEP_IDS.has(stepId)) {
      sailToKaramja(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === SAIL_TO_PANDEMONIUM_STEP_ID) {
      sailFromPortSarimToPandemonium(player);
      event.handled = true;
      event.end = true;
      return;
    }
    const returnFare = SAIL_BACK_FARES.get(stepId);
    if (returnFare !== undefined) {
      // The talked-through crossing pays and sails as the Travel click does; the transcript's
      // "The ship arrives at Port Sarim." box is the pre-fade voyage's, so the chain ends here.
      voyage(player, PORT_SARIM_LANDING, "Port Sarim", "musa-point-port-sarim", returnFare);
      event.handled = true;
      event.end = true;
    }
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== RUM_ITEM_ID) return;
    if ((event.npcId ?? event.target?.getId?.()) !== FRANK_NPC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STARTED || !hasItem(player, RUM_ITEM_ID)) return;
    startTranscript(api, player, FRANK_NPC_ID, "Pirate's Treasure", "delivering-the-rum-talking-to-redbeard-frank");
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { objectId, itemId } = event;
    if (objectId === PLANTATION_CRATE_ID && itemId === BANANA_ITEM_ID) {
      packBanana(event.player);
      event.handled = true;
      return;
    }
    if (objectId === PLANTATION_CRATE_ID && itemId === RUM_ITEM_ID) {
      stashRum(event.player);
      event.handled = true;
      return;
    }
    if (objectId === CHEST_ID && itemId === KEY_ITEM_ID) {
      unlockChest(event.player);
      event.handled = true;
    }
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId } = event;

    if (objectId === PLANTATION_CRATE_ID) {
      if (option.includes("search")) {
        searchPlantationCrate(player);
        event.handled = true;
      } else if (option.includes("fill")) {
        fillCrate(player);
        event.handled = true;
      }
      return;
    }
    if (objectId === STORE_CRATE_ID && option.includes("search")) {
      searchStoreCrate(player);
      event.handled = true;
      return;
    }
    if (objectId === CHEST_ID && option.includes("open")) {
      player.sendMessage("The chest is locked.");
      player.getPacketSender().sendSoundEffect(CHEST_LOCKED_SOUND);
      event.handled = true;
    }
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    const { player } = event;
    if (!hasItem(player, event.itemId)) return;
    if (event.itemId === MESSAGE_ITEM_ID && option === "read") {
      if (quest.getStage(player) === STAGE_KEY) quest.setStage(player, STAGE_NOTE);
      const packet = player.getPacketSender();
      // Captured: toplevel_mainmodal_open with no background, then the handwritten note (rev 242 capture, tick 1127).
      packet.sendInterfaceScript(MAIN_MODAL_OPEN, NO_MODAL_BACKGROUND);
      packet.sendInterface(NOTE_INTERFACE);
      for (let child = 1; child <= 11; child++) packet.sendString(child === 5
        ? "Visit the city of the White Knights. In the park," : child === 6
          ? "Saradomin points to the X which marks the spot." : "", (NOTE_INTERFACE << 16) | child);
      event.handled = true;
    }
    if (event.itemId === CASKET_ITEM_ID && option === "open") {
      const needed = hasItem(player, COINS_ITEM_ID) ? 2 : 3;
      if (player.getInventory().getFreeSlots() + 1 < needed) {
        player.sendMessage("You need more inventory space.");
      } else {
        player.getInventory().deleteNumber(CASKET_ITEM_ID, 1);
        player.getInventory().adds(COINS_ITEM_ID, 450);
        player.getInventory().adds(RING_ITEM_ID, 1);
        player.getInventory().adds(EMERALD_ITEM_ID, 1);
        player.sendMessage("You open the casket, and find One-Eyed Hector's treasure.");
        player.getPacketSender().sendSoundEffect(CASKET_OPEN_SOUND);
      }
      event.handled = true;
    }
  }

  /**
   * Barrows registers its Spade "Dig" hook before this quest's item-action hook and
   * always swallows the click, so the treasure dig is resolved from the can-use
   * gate, which runs before any item-action hook.
   */
  function handleCanUseItem(event) {
    if (event.itemId !== SPADE_ITEM_ID || !/dig/i.test(String(event.option ?? ""))) return;
    if (!digForTreasure(event.player)) return;
    event.allow = false;
  }

  // The 3 November 2026 update's quest XP (Wiki: Update:Quest Month Kick Off, TFA Tweaks & More),
  // paid on completion; held back for a completion not played through (experience: false).
  const COMPLETION_XP = [[api.core.Skill.COOKING, 800, "Cooking"]];
  function grantCompletionXp(player, _quest, options = {}) {
    if (options.experience === false) return;
    for (const [skill, amount] of COMPLETION_XP) player.getSkillManager().addExperiences(skill, amount);
  }

  quest = registerQuest(api, {
    key: "pirates_treasure",
    name: "Pirate's Treasure",
    varpId: VARP_PIRATES_TREASURE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: COMPLETION_XP.map(([skill, amount, label]) => ({ skillId: skill.getIndex(), amount, label })),
    rewardItemId: CASKET_ITEM_ID,
    scrollItemId: CASKET_ITEM_ID,
    completionJingleId: 153,
    rewardItemLabel: "One-Eyed Hector's Treasure",
    buildJournal,
    onReward: grantCompletionXp,
  });

  api.persistAttribute(EMPLOYMENT_ATTRIBUTE);
  api.persistAttribute(BANANA_ATTRIBUTE);
  api.persistAttribute(RUM_ATTRIBUTE);
  api.persistAttribute(DUG_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionMet);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleMorrisDestination);
  api.onCustomEvent("door:toggle", guardStockRoomDoor);
  api.onCustomEvent("teleport:landed", spillRumOnTeleport);
  api.onCustomEvent("ground-items:taken", takeHookedApron);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(handleObjectRoute);
  api.onItemAction(handleItemAction);
  api.onCanUseItem(handleCanUseItem);
  // After Pandemonium (varbit 18314) the boats' Travel becomes "Musa Point" and "The Pandemonium".
  api.onNpcsInteraction(["Seaman Thresnor", "Seaman Lorris", "Captain Tobias"], {
    Travel: travelToKaramja, "Musa Point": travelToKaramja, "The Pandemonium": travelToPandemonium,
  });
  api.onNpcInteraction("Customs officer", {
    Travel: travelToPortSarim, "Port Sarim": travelToPortSarim, "The Pandemonium": travelFromKaramjaToPandemonium,
  });
  // Seaman Morris sails the Pandemonium's passengers back (rev 242 capture, tick 187).
  api.onNpcInteraction("Seaman Morris", {
    "Port Sarim": travelFromPandemoniumToPortSarim, "Musa Point": travelFromPandemoniumToMusaPoint,
  });
  api.onPlayerLogout(cleanupGardener);
  api.onServerShutdown(landEveryone);
  function buyRum(player) {
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < 27) return;
    if (!giveItem(player, RUM_ITEM_ID, "You buy a bottle of rum.")) return;
    inventory.deleteNumber(COINS_ITEM_ID, 27);
  }

  /** Takes `fare` coins, or reports the shortfall so the caller can refuse passage. */
  function payFare(player, fare) {
    if (fare <= 0) return true;
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < fare) return false;
    inventory.deleteNumber(COINS_ITEM_ID, fare);
    return true;
  }

  /** Wiki (Seaman Lorris, Karamja Diary): 15 coins while wearing any Karamja gloves. */
  function boatFare(player) {
    return wearsKaramjaGloves(player) ? GLOVES_FARE : FARE;
  }

  function sailToKaramja(player) {
    sailFromPortSarim(player, MUSA_POINT_LANDING, "Musa Point", "port-sarim-musa-point");
  }

  function sailFromPortSarimToPandemonium(player) {
    sailFromPortSarim(player, PANDEMONIUM_LANDING, "the Pandemonium", "port-sarim-pandemonium");
  }

  function sailFromPortSarim(player, destination, port, route) {
    if (sailing.has(player)) return;
    const fare = boatFare(player);
    if (player.getInventory().getAmount(COINS_ITEM_ID) < fare) {
      player.sendMessage("You don't have enough coins to pay for passage.");
      return;
    }
    voyage(player, destination, port, route, fare);
  }

  function wearsKaramjaGloves(player) {
    const gloves = player.getEquipment?.()?.getItems?.()?.[Equipment.HANDS_SLOT];
    return /^Karamja gloves/.test(gloves?.getDefinition?.()?.getName?.() ?? "");
  }

  /** The customs officer's free-passage option needs the Ring of Charos(a) worn. */
  function wearsRingOfCharos(player) {
    const ring = player.getEquipment?.()?.get?.(Equipment.RING_SLOT);
    return ring?.getId?.() === ItemIdentifiers.RING_OF_CHAROS_A_;
  }

  function travelToKaramja({ player }) {
    sailToKaramja(player);
  }

  function travelToPandemonium({ player }) {
    sailFromPortSarimToPandemonium(player);
  }

  function travelToPortSarim({ player }) {
    leaveKaramja(player, PORT_SARIM_LANDING, "Port Sarim", "musa-point-port-sarim");
  }

  function travelFromKaramjaToPandemonium({ player }) {
    leaveKaramja(player, PANDEMONIUM_LANDING, "the Pandemonium", "musa-point-pandemonium");
  }

  /**
   * The customs officer's travel options (the Pay-fare transcript): worn Karamja gloves halve the
   * fare, and rum carried aboard is confiscated as the fare is paid. Captured with rum and 30 coins
   * (rev 242 capture, tick 327): one line, "You pay the boarding charge of 30 coins. However, the
   * customs officer confiscates your rum before letting you board.", and the ship sails.
   */
  function leaveKaramja(player, destination, port, route) {
    if (sailing.has(player)) return;
    const gloves = wearsKaramjaGloves(player);
    const fare = gloves ? GLOVES_FARE : FARE;
    if (player.getInventory().getAmount(COINS_ITEM_ID) < fare) {
      player.sendMessage(gloves
        ? "You do not have enough coins to pay passage. You need 15 when wearing the Karamja gloves."
        : `You do not have enough coins to pay passage, you need ${fare}.`);
      return;
    }
    const rum = player.getInventory().getAmount(RUM_ITEM_ID);
    let paid = gloves
      ? "The officer smiles as she recognises your Karamja gloves and lets you pass for half price - 15 coins."
      : `You pay the boarding charge of ${fare} coins.`;
    if (rum > 0) {
      // Ours: only the 30-coin line with rum is captured; the gloves line takes the same ending.
      player.getInventory().deleteNumber(RUM_ITEM_ID, rum);
      paid = `${gloves ? `You pay the boarding charge of ${fare} coins.` : paid} However, the customs officer confiscates your rum before letting you board.`;
    }
    voyage(player, destination, port, route, fare, paid);
  }

  function travelFromPandemoniumToPortSarim({ player }) {
    leavePandemonium(player, PORT_SARIM_LANDING, "Port Sarim", "pandemonium-port-sarim", FARE);
  }

  function travelFromPandemoniumToMusaPoint({ player }) {
    leavePandemonium(player, MUSA_POINT_LANDING, "Musa Point", "pandemonium-musa-point", boatFare(player));
  }

  /** Talk-to: the destination the player names in Seaman Morris's dialogue sails once they continue past it. */
  function handleMorrisDestination(event) {
    if (event.npcId !== SEAMAN_MORRIS_NPC_ID || !event.step?.player) return;
    if (event.text === MORRIS_PORT_SARIM_LINE) event.after = () => travelFromPandemoniumToPortSarim(event);
    else if (event.text === MORRIS_MUSA_POINT_LINE) event.after = () => travelFromPandemoniumToMusaPoint(event);
  }

  /**
   * Seaman Morris's fares (Wiki, Seaman Morris): 30 coins to either port, but 15 to Musa Point in Karamja gloves;
   * Port Sarim stays 30. The boarding lines are the boats' own.
   */
  function leavePandemonium(player, destination, port, route, fare) {
    if (sailing.has(player)) return;
    if (player.getInventory().getAmount(COINS_ITEM_ID) < fare) {
      // Ours: no capture of Seaman Morris without the fare.
      player.sendMessage("You don't have enough coins to pay for passage.");
      return;
    }
    voyage(player, destination, port, route, fare);
  }

  /**
   * A crossing, as captured: the fare and the boarding line on the click, the sea jingle and the fade out,
   * the landing at VOYAGE_LAND_TICK, the fade back in and the overlay closed after. The player is held
   * still until the fade comes back; a logout before the landing lands them (cleanupGardener).
   */
  function voyage(player, destination, port, route, fare, paidLine) {
    if (sailing.has(player) || !payFare(player, fare)) return false;
    const sender = player.getPacketSender();
    if (paidLine) player.sendMessage(paidLine);
    else if (fare > 0) player.sendMessage(`You pay the boarding charge of ${fare} coins.`);
    player.sendMessage(`You board the ship and sail to ${port}.`);
    const from = player.getLocation().clone?.() ?? player.getLocation();
    player.getDialogueManager().reset();
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    sender.sendSong(SEA_SONG).sendJingle(SEA_JINGLE, 0);
    sender.mountSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args: [0, 255, 0, 0, FADE_CYCLES] }] });
    const trip = { landed: false };
    trip.land = () => {
      if (trip.landed) return;
      trip.landed = true;
      player.moveTo(destination);
      api.emitCustomEvent("ferries:arrived", { player, route });
    };
    sailing.set(player, trip);
    api.emitCustomEvent("ferries:departed", { player, route, from });
    later(player, VOYAGE_LAND_TICK, () => trip.land());
    later(player, VOYAGE_FADE_IN_TICK, () => {
      if (sailing.get(player) !== trip) return;
      sailing.delete(player);
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
      const mount = sender.mountSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args: [0, 0, 0, 255, FADE_CYCLES] }] });
      later(player, VOYAGE_CLOSE_TICK - VOYAGE_FADE_IN_TICK, () => sender.closeSubInterfaceMount(mount));
    });
    return true;
  }

  /**
   * Wiki (Karamjan rum and Pirate's Treasure): carried rum breaks on any teleport, including after
   * retrieval from Wydin's Port Sarim crate. The captured house teleport spills on landing (tick 390).
   */
  function spillRumOnTeleport({ player, from, to }) {
    if (!player || !from || !to) return;
    const rum = player.getInventory().getAmount(RUM_ITEM_ID);
    if (rum <= 0) return;
    player.getInventory().deleteNumber(RUM_ITEM_ID, rum);
    player.sendMessage(RUM_SPILLED);
  }

  function takeHookedApron({ player, groundItem }) {
    if (groundItem?.getItem?.()?.getId?.() === HOOKED_APRON_ITEM_ID) player.sendMessage(APRON_TAKEN);
  }

  function payForBananas(player) {
    if (attr(player, BANANA_ATTRIBUTE) < 10) return;
    player.getInventory().adds(COINS_ITEM_ID, BANANA_WAGE);
    player.sendMessage("Luthas hands you 30 coins.");
    setAttr(player, BANANA_ATTRIBUTE, 0);
    if (attr(player, RUM_ATTRIBUTE) === 1) setAttr(player, RUM_ATTRIBUTE, 2);
  }

  function packBanana(player) {
    if (!isEmployed(player, 1)) {
      player.sendMessage("Why would I want to do that?");
      return;
    }
    const stored = attr(player, BANANA_ATTRIBUTE);
    if (stored >= 10) {
      player.sendMessage("The crate is already full.");
      return;
    }
    if (!hasItem(player, BANANA_ITEM_ID)) return;
    player.getInventory().deleteNumber(BANANA_ITEM_ID, 1);
    setAttr(player, BANANA_ATTRIBUTE, stored + 1);
    player.performAnimation(new Animation(PACK_BANANA_ANIMATION));
    player.getPacketSender().sendSoundEffect(PACK_BANANA_SOUND);
    StatementDialogue.send(player, "You pack a banana into the crate.");
  }

  function fillCrate(player) {
    if (!isEmployed(player, 1)) {
      player.sendMessage("Why would I want to do that?");
      return;
    }
    const stored = attr(player, BANANA_ATTRIBUTE);
    if (stored >= 10) {
      player.sendMessage("The crate is already full.");
      return;
    }
    const carried = player.getInventory().getAmount(BANANA_ITEM_ID);
    if (carried <= 0) {
      player.sendMessage("You have no bananas to pack.");
      return;
    }
    const packed = Math.min(carried, 10 - stored);
    player.getInventory().deleteNumber(BANANA_ITEM_ID, packed);
    setAttr(player, BANANA_ATTRIBUTE, stored + packed);
    player.performAnimation(new Animation(PACK_BANANA_ANIMATION));
    player.getPacketSender().sendSoundEffect(PACK_BANANA_SOUND);
    // Captured: "fill" only when bananas are left over (rsprox 4287: 12 and 11 carried); every carried
    // banana going in, even the tenth, is "pack all" (the rev 242 capture, ticks 569, 660, 790: 10 into 0 and 9 into 1).
    StatementDialogue.send(player, packed < carried
      ? "You fill the crate with bananas."
      : "You pack all your bananas into the crate.");
  }

  function stashRum(player) {
    if (!isEmployed(player, 1)) {
      player.sendMessage("Why would I want to do that?");
      return;
    }
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (attr(player, RUM_ATTRIBUTE) >= 1) {
      player.sendMessage("There's already some rum in here...");
      return;
    }
    if (!hasItem(player, RUM_ITEM_ID)) return;
    player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
    setAttr(player, RUM_ATTRIBUTE, 1);
    StatementDialogue.send(player, "You stash the rum in the crate.");
  }

  function searchPlantationCrate(player) {
    const bananas = attr(player, BANANA_ATTRIBUTE), rum = attr(player, RUM_ATTRIBUTE) === 1;
    if (rum && bananas === 0) player.sendMessage("There is some rum in here, although with no bananas to cover it. It is a little obvious.");
    else if (bananas === 0) player.sendMessage("The crate is completely empty.");
    else player.sendMessage(bananas >= 10 ? "The crate is full of bananas." : `The crate has ${bananas} banana${bananas === 1 ? "" : "s"} inside.`);
    if (rum && bananas > 0) player.sendMessage("There is also some rum stashed in here too.");
  }

  /**
   * Wydin's crate, as captured: the bananas line at once; a shipped bottle of rum comes out four ticks later
   * (pickuptable, pick2); four ticks after the last line, "Do you want to take a banana?".
   */
  function searchStoreCrate(player) {
    if (!isEmployed(player, 2)) { player.sendMessage("Wydin won't let you into the stock room."); return; }
    if (!wearingApron(player)) { player.sendMessage("You need to put your white apron on first."); return; }
    if (searchingStoreCrate.has(player)) return;
    searchingStoreCrate.add(player);
    player.sendMessage("There are a lot of bananas in the crate.");
    const offerBanana = () => later(player, STORE_CRATE_STEP_TICKS, () => {
      searchingStoreCrate.delete(player);
      api.sendMultiChatboxPrompt(player, "Do you want to take a banana?", "Yes.", () => takeBanana(player), "No.", () => {});
    });
    if (attr(player, RUM_ATTRIBUTE) < 2) {
      offerBanana();
      return;
    }
    later(player, STORE_CRATE_STEP_TICKS, () => {
      if (attr(player, RUM_ATTRIBUTE) < 2) { searchingStoreCrate.delete(player); return; }
      if (!giveItem(player, RUM_ITEM_ID)) { searchingStoreCrate.delete(player); return; }
      setAttr(player, RUM_ATTRIBUTE, 0);
      pick(player);
      player.sendMessage("You find your bottle of rum in amongst the bananas.");
      offerBanana();
    });
  }

  function takeBanana(player) {
    if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return; }
    player.getInventory().adds(BANANA_ITEM_ID, 1);
    pick(player);
    player.sendMessage("You take a banana.");
  }

  function pick(player) {
    player.performAnimation(new Animation(PICK_ANIMATION));
    player.getPacketSender().sendSoundEffect(PICK_SOUND);
  }

  /**
   * Wydin's stock-room door is a pass-through door (Doors.plugin.js). From the shop it opens only for
   * an employee in the white apron; otherwise Wydin stops the player (Pirate's Treasure transcript).
   * The shop is east of the door (x >= 3012), the stock room west.
   */
  function guardStockRoomDoor(request) {
    if (request.objectId !== STOCK_ROOM_DOOR_ID) return;
    const { player } = request;
    const door = request.object?.getLocation?.() ?? request.location;
    const doorX = door?.getX?.() ?? door?.x, doorY = door?.getY?.() ?? door?.y;
    if (doorX !== STOCK_ROOM_DOOR_TILE.x || doorY !== STOCK_ROOM_DOOR_TILE.y) return;
    if (player.getLocation().getX() < STOCK_ROOM_DOOR_TILE.x) return;
    if (isEmployed(player, 2) && wearingApron(player)) return;
    request.handled = true;
    startTranscript(api, player, WYDIN_NPC_ID, "Pirate's Treasure", !isEmployed(player, 2)
      ? "retrieving-the-rum-trying-to-open-the-door-in-the-food-store-before-getting-the-job"
      : "retrieving-the-rum-trying-to-open-the-door-after-getting-the-job-while-not-wearing-a-white-apron");
  }

  /**
   * The closed stock-room door breaks the crate's route from the shop, so a crate click that
   * starts inside the shop is stepped through the door first, then walked to the crate.
   * The step is a placement: until it lands, getMobility() is INVALID and walkToTile drops
   * a walk, so a route destination set in the same tick was lost and only a second click
   * searched. The walk waits for the placement instead (a new click cancels it, as any walk).
   */
  function handleObjectRoute(event) {
    if (event.objectId !== STORE_CRATE_ID) return;
    const { player, sourceLocation } = event;
    const x = STOCK_ROOM_DOOR_TILE.x;
    const y = STOCK_ROOM_DOOR_TILE.y;
    const inShop = sourceLocation.x >= x && sourceLocation.x <= x + 5
      && sourceLocation.y >= y - 3 && sourceLocation.y <= y + 4;
    if (!inShop || !isEmployed(player, 2) || !wearingApron(player)) return;
    const z = player.getLocation().getZ();
    const search = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase().includes("search");
    player.moveTo(new Location(x - 1, y, z));
    const walkToCrate = (tries) => TaskManager.submit(new CountdownTask(player.getIndex(), 1, () => {
      if (player.isNeedsPlacement() && tries < 3) {
        walkToCrate(tries + 1);
        return;
      }
      player.getMovementQueue().walkToTile(new Location(STORE_CRATE_TILE.x + 1, STORE_CRATE_TILE.y, z), () => {
        player.setPositionToFace(new Location(STORE_CRATE_TILE.x, STORE_CRATE_TILE.y, z));
        if (search) searchStoreCrate(player);
      });
    }));
    walkToCrate(0);
  }

  function closeChest(player) {
    const closed = openingChests.get(player);
    if (!closed) return;
    openingChests.delete(player);
    player.getPacketSender().sendObject(closed).sendVarbit(12393, 0);
    player.getMovementQueue().setBlockMovement(false);
  }

  function unlockChest(player) {
    if (openingChests.has(player)) return;
    if (quest.getStage(player) !== STAGE_KEY || !hasItem(player, KEY_ITEM_ID)) {
      player.sendMessage("The chest is locked.");
      return;
    }
    const closed = new GameObject(CHEST_ID, CHEST_TILE, 10, 0, player.getPrivateArea());
    const opened = new GameObject(OPEN_CHEST_ID, CHEST_TILE, 10, 0, player.getPrivateArea());
    openingChests.set(player, closed);
    player.sendMessage("You unlock the chest.");
    player.sendMessage("All that's in the chest is a message...");
    player.getMovementQueue().setBlockMovement(true);
    player.getPacketSender().sendObject(opened).sendVarbit(12393, 1).sendSoundEffect(CHEST_OPEN_SOUND);
    const task = new Task(4, player, false);
    task.execute = () => {
      task.stop();
      if (!openingChests.has(player)) return;
      closeChest(player);
      if (!hasItem(player, KEY_ITEM_ID) || quest.getStage(player) !== STAGE_KEY) return;
      player.getInventory().deleteNumber(KEY_ITEM_ID, 1);
      giveItem(player, MESSAGE_ITEM_ID);
      player.sendMessage("You take the message from the chest.");
    };
    TaskManager.submit(task);
  }

  function digForTreasure(player) {
    if (quest.getStage(player) !== STAGE_NOTE) return false;
    const position = player.getLocation();
    const distance = Math.max(
      Math.abs(position.getX() - TREASURE_TILE.x),
      Math.abs(position.getY() - TREASURE_TILE.y),
    );
    if (distance > 1 || position.getZ() !== TREASURE_TILE.z) return false;
    if (digging.has(player)) return true;
    // The first dig only wakes the gardener; the casket is on the second (Wiki).
    if (!attr(player, DUG_ATTRIBUTE)) {
      dig(player);
      setAttr(player, DUG_ATTRIBUTE, 1);
      spawnGardener(player);
      return true;
    }
    // Blocked only while the gardener is alive and on the player; a skipped or dead
    // gardener (or a player who relogged away from one) must never block completion.
    if (gardenerThreatens(player)) {
      player.sendMessage("I can't dig up anything with him attacking me!");
      return true;
    }
    if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return true; }
    dig(player);
    player.sendMessage("You dig a hole in the ground...");
    digging.add(player);
    const task = new Task(4, player, false);
    task.execute = () => {
      task.stop(); digging.delete(player);
      if (quest.getStage(player) !== STAGE_NOTE || player.isRegistered?.() === false) return;
      if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return; }
      player.sendMessage("and find a little chest of treasure.");
      quest.complete(player);
    };
    TaskManager.submit(task);
    return true;
  }

  function dig(player) {
    player.performAnimation(new Animation(DIG_ANIMATION));
    player.getPacketSender().sendSoundEffect(DIG_SOUND);
  }

  function spawnGardener(player) {
    const npc = api.spawnNpc({
      id: GARDENER_NPC_ID,
      ...GARDENER_TILE,
      face: GARDENER_FACE,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    npc.forceChat(GARDENER_SHOUT);
    player.getPacketSender().sendEntityHint(npc);
    npc.getCombat().attack(player);
    gardenerByPlayer.set(player, npc);
  }

  function cleanupGardener({ player }) {
    closeChest(player);
    // A logout mid-crossing lands the player where the boat was going.
    const trip = sailing.get(player);
    sailing.delete(player);
    if (trip) {
      trip.land();
      player.getMovementQueue().setBlockMovement(false);
      player.setUntargetable(false);
    }
    searchingStoreCrate.delete(player);
    const npc = gardenerByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    gardenerByPlayer.delete(player);
    digging.delete(player);
  }

  /** A shutdown mid-crossing lands everyone where their boat was going, as a logout does. */
  function landEveryone() {
    for (const [player, trip] of [...sailing]) {
      sailing.delete(player);
      trip.land();
    }
  }

  function gardenerThreatens(player) {
    const npc = gardenerByPlayer.get(player);
    if (!npc) return false;
    const registered = typeof npc.isRegistered !== "function" || npc.isRegistered();
    if (!registered || npc.getHitpoints() <= 0) {
      gardenerByPlayer.delete(player);
      player.getPacketSender().sendEntityHintRemoval();
      return false;
    }
    return npc.getLocation().isWithinDistance(player.getLocation(), 8);
  }
};
