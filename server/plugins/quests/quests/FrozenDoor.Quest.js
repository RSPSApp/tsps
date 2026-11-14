/**
 * The Frozen Door (members miniquest, December 2021, cache revision 242 quest-table id 165, no quest points).
 *
 * Sources: the OSRS Wiki quest page, Transcript:The Frozen Door, Transcript:Important letter, the Messenger,
 * Important letter, Frozen key and Ashuelot Reis pages (raw wikitext, sha256 in docs/quests/frozen-door/README.md),
 * the generated npc-dialogues export for the messenger's five conversations (untouched), the revision 242 cache,
 * and RSProx capture 801 (revision 234): the assemble and unlock messages, Ashuelot's first conversation and the
 * miniquest's journal text at the key stage.
 *
 * Cache facts: quest-table id 165, end state 10, requires Desert Treasure I; the stage is varbit `frozen_door`
 * (13175, six bits of varp 3264) with `frozen_door_*_piece` (13176-13179), `nex_message_destroyed` (13181: how
 * many letters were destroyed unread, three bits) and `nex_story_npc` (13182: which Ashuelot is shown). Ashuelot is
 * two multi-NPCs on 13182: `nex_story_npc_outer` (11295) shows her (11288, Talk-to) at 0; `nex_story_npc_inner`
 * (11296) shows 11288 at 1 and 11289 (Talk-to, Bank, Collect) at 2. The messenger (`nex_messenger`, 11287) has no
 * options: he is delivered, not clicked.
 *
 * The cache names no values between started and complete: 1 = the letter is read, 2 = the key is assembled, 3 =
 * the Frozen Door is unsealed (speak to Ashuelot), 10 = complete (her first conversation has ended). The story
 * varbit is 0 until she has departed (the quest completes), 1 until she has been spoken to in the safe room, then 2.
 *
 * The Nex plugin already owned the key and the door; it now announces both (`nex:frozen-key-assembled`,
 * `nex:frozen-door-unsealed`) and asks this plugin before the prison's outer door opens (`nex:prison-door`).
 */
module.exports = function registerFrozenDoorQuest(api) {
  const { CacheDefinitions, NpcDefinition } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questNamed, openBook, bookPagesFromSpreads } = require("../QuestRuntime");
  const DATA = require("../data/frozen-door.json");
  const FOSSIL_UNDERWATER = require("../../areas/data/fossil-island-underwater.json").underwater;

  const named = (lookup, name) => {
    const id = CacheDefinitions[lookup](name);
    if (!Number.isInteger(id)) throw new Error(`The Frozen Door: cache has no ${lookup} "${name}"`);
    return id;
  };
  const QUEST_VARBIT = named("getVarbitId", "frozen_door");
  const PIECE_VARBITS = {
    armadyl: named("getVarbitId", "frozen_door_armadyl_piece"),
    bandos: named("getVarbitId", "frozen_door_bandos_piece"),
    zamorak: named("getVarbitId", "frozen_door_zamorak_piece"),
    saradomin: named("getVarbitId", "frozen_door_saradomin_piece"),
  };
  const DESTROYED_VARBIT = named("getVarbitId", "nex_message_destroyed");
  const STORY_VARBIT = named("getVarbitId", "nex_story_npc");
  const LETTER = named("getObjId", "nex_message");
  const PIECES = {
    armadyl: named("getObjId", "nex_frozen_key_armadyl"),
    bandos: named("getObjId", "nex_frozen_key_bandos"),
    zamorak: named("getObjId", "nex_frozen_key_zamorak"),
    saradomin: named("getObjId", "nex_frozen_key_saradomin"),
  };
  const GODS = Object.keys(PIECES);
  const PIECE_IDS = new Set(Object.values(PIECES));
  const MESSENGER = named("getNpcId", "nex_messenger");
  const ASHUELOT = named("getNpcId", "nex_story_npc_1op");
  const ASHUELOT_BANK = named("getNpcId", "nex_story_npc_3op");
  const ASHUELOT_IDS = new Set([ASHUELOT, ASHUELOT_BANK]);

  const STAGE_LETTER_READ = 1;
  const STAGE_KEY = 2;
  const STAGE_UNSEALED = 3;
  const STAGE_COMPLETE = 10;
  const STORY_OUTER = 0; // Ashuelot waits at the door; the prison is closed to the player
  const STORY_DEPARTED = 1; // she is in the safe room (Talk-to)
  const STORY_BANKING = 2; // after the safe-room talk she banks

  const LETTER_ATTRIBUTE = "frozen-door:letter";
  const DESTROYED_ATTRIBUTE = "frozen-door:destroyed";
  const STORY_ATTRIBUTE = "frozen-door:story";
  const PIECES_ATTRIBUTE = "frozen-door:pieces";

  const MESSENGER_PAGE = "Messenger (The Frozen Door)";
  const MESSENGER_VARIANTS = [
    "standard-dialogue-the-first-delivery",
    "standard-dialogue-if-the-player-destroys-the-first-letter-without-reading-it",
    "standard-dialogue-if-the-player-destroys-the-second-letter-without-reading-it",
    "standard-dialogue-if-the-player-destroys-the-third-letter-without-reading-it",
    "standard-dialogue-if-the-player-destroys-the-fourth-letter-without-reading-it",
  ];
  const START_MESSAGE = "You've started a new quest: <col=081190>The Frozen Door</col>";
  const MAX_DESTROYED = 7; // varbit 13181 is three bits
  const MESSENGER_STAY_TICKS = 150;
  const UNLOCKED_ATTRIBUTE = "nex:frozen-door-unlocked";
  const BUSY_VARBIT = 12393; // the reading pose of a book

  let quest;
  /** Players with a messenger on the way, and the messenger each one has out. */
  const pending = new WeakSet();
  const messengers = new WeakMap();

  const stageOf = (player) => quest.getStage(player);
  const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));
  const story = (player) => Math.min(STORY_BANKING, count(player, STORY_ATTRIBUTE));
  const desertTreasureDone = (player) => questNamed?.("Desert Treasure I")?.isComplete?.(player) === true;
  const inProgress = (player) => stageOf(player) >= STAGE_LETTER_READ && stageOf(player) < STAGE_COMPLETE;
  const holdsLetter = (player) => player.getAttribute(LETTER_ATTRIBUTE) === true;
  const unsealedBefore = (player) => player.getAttribute(UNLOCKED_ATTRIBUTE) === true;
  // A player who opened the door before this quest existed has nothing to be told: they finish at Ashuelot.
  const eligibleForMessenger = (player) => stageOf(player) === 0 && desertTreasureDone(player) && !holdsLetter(player) && !unsealedBefore(player);

  const later = (player, ticks, action) => api.core.TaskManager.submit(new api.core.CountdownTask(player, Math.max(1, ticks), action));
  const randomTicks = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  // --- the varbits the client reads --------------------------------------------------------------

  function pieceFlags(player) {
    const held = player.getAttribute(PIECES_ATTRIBUTE);
    const flags = held && typeof held === "object" ? { ...held } : {};
    for (const god of GODS) {
      if (player.getInventory().contains(PIECES[god]) || stageOf(player) >= STAGE_KEY) flags[god] = true;
    }
    return flags;
  }

  function sendState(player) {
    const sender = player.getPacketSender();
    const flags = pieceFlags(player);
    player.setAttribute(PIECES_ATTRIBUTE, flags);
    for (const god of GODS) sender.sendVarbit(PIECE_VARBITS[god], flags[god] === true ? 1 : 0);
    sender.sendVarbit(DESTROYED_VARBIT, Math.min(MAX_DESTROYED, count(player, DESTROYED_ATTRIBUTE)));
    sender.sendVarbit(STORY_VARBIT, story(player));
  }

  function setStory(player, value) {
    player.setAttribute(STORY_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(STORY_VARBIT, value);
  }

  // --- the letter and the messenger ------------------------------------------------------------

  /** Word-wraps the letter's paragraphs to the book's lines, a blank line between them. */
  function letterLines(player) {
    const name = player.getDisplayName?.() ?? player.getUsername?.() ?? "adventurer";
    const lines = [];
    for (const paragraph of DATA.letter) {
      for (const part of paragraph.replace("[player name]", name).split("\n")) {
        let line = "";
        for (const word of part.split(" ")) {
          if (line && `${line} ${word}`.length > 34) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
        }
        if (line) lines.push(line);
      }
      lines.push("");
    }
    while (lines.at(-1) === "") lines.pop();
    return lines;
  }

  function readLetter(event) {
    const { player } = event;
    if (!player) return false;
    event.handled = true;
    const lines = letterLines(player);
    const sides = [];
    for (let at = 0; at < lines.length; at += 15) sides.push(lines.slice(at, at + 15));
    const spreads = [];
    for (let at = 0; at < sides.length; at += 2) spreads.push([sides[at], sides[at + 1] ?? []]);
    // The letter is read once the reader closes it: that is what starts the miniquest.
    openBook(player, "Important letter", bookPagesFromSpreads(spreads), () => begin(player));
    return true;
  }

  function begin(player) {
    if (stageOf(player) !== 0 || !desertTreasureDone(player)) return;
    quest.setStage(player, STAGE_LETTER_READ);
    player.sendMessage(START_MESSAGE);
    refreshQuestList(player);
  }

  /** A free tile beside the player, or the player's own. */
  function tileBeside(player) {
    const at = player.getLocation();
    const { Location, RegionManager } = api.core;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      const tile = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
      if (!RegionManager.blocked(tile, null)) return tile;
    }
    return at;
  }

  /** Fossil Island's sea floor: the Wiki's messenger "will no longer appear underwater". */
  function underwater(player) {
    const [minX, maxX, minY, maxY] = FOSSIL_UNDERWATER.box;
    const at = player.getLocation();
    return at.getZ() === FOSSIL_UNDERWATER.plane && at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY;
  }

  /** Not while the player is under water, in a conversation, an open interface, a fight, an instance or a book. */
  function occupied(player) {
    const sender = player.getPacketSender();
    return underwater(player)
      || player.getDialogueManager().isActive()
      || (player.getInterfaceId?.() ?? -1) >= 0
      || (sender.getChatboxGroupId?.() ?? -1) >= 0
      || api.core.CombatFactory.inCombat(player)
      || player.getPrivateArea?.() != null
      || sender.getVarbit(BUSY_VARBIT) === 1;
  }

  /** Sends `npc` (default: the messenger the player has out) away; an old timer never removes a newer one. */
  function dismiss(player, npc = messengers.get(player)) {
    if (messengers.get(player) === npc) messengers.delete(player);
    if (npc?.isRegistered?.()) api.removeNpc(npc);
  }

  /** The messenger appears beside the player and speaks at once (he has no options to click). */
  function deliver(player) {
    if (!player.isRegistered?.() || !eligibleForMessenger(player) || messengers.has(player)) return;
    // Not now: under water, busy, or no room for the letter (it would land on the floor and could be lost).
    if (occupied(player) || player.getInventory().getFreeSlots() < 1) { scheduleMessenger(player, 40, 120); return; }
    const tile = tileBeside(player);
    const npc = api.spawnNpc({ id: MESSENGER, x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) return;
    npc.setPositionToFace?.(player.getLocation());
    messengers.set(player, npc);
    const variant = MESSENGER_VARIANTS[Math.min(count(player, DESTROYED_ATTRIBUTE), MESSENGER_VARIANTS.length - 1)];
    if (!startTranscript(api, player, MESSENGER, MESSENGER_PAGE, variant, undefined, npc)) { dismiss(player); return; }
    // Left alone, he goes after a while.
    later(player, MESSENGER_STAY_TICKS, () => dismiss(player, npc));
  }

  /** One messenger on the way at a time; a relog starts the wait again, so none can pile up. */
  function scheduleMessenger(player, min, max) {
    if (pending.has(player) || messengers.has(player) || !eligibleForMessenger(player)) return;
    pending.add(player);
    later(player, randomTicks(min, max), () => {
      pending.delete(player);
      deliver(player);
    });
  }

  function itemDestroyed({ player, itemId }) {
    if (!player || itemId !== LETTER) return;
    // Only an unread letter brings another: once it is read there is nothing more to deliver.
    if (stageOf(player) !== 0) return;
    player.setAttribute(LETTER_ATTRIBUTE, false);
    player.setAttribute(DESTROYED_ATTRIBUTE, Math.min(MAX_DESTROYED, count(player, DESTROYED_ATTRIBUTE) + 1));
    sendState(player);
    scheduleMessenger(player, 20, 60);
  }

  function desertTreasureCompleted({ player, quest: finished }) {
    if (player && finished?.name === "Desert Treasure I") scheduleMessenger(player, 30, 120);
  }

  // --- the key, the door and the drops -------------------------------------------------------------

  function keyAssembled({ player }) {
    if (!player) return;
    if (stageOf(player) === STAGE_LETTER_READ) quest.setStage(player, STAGE_KEY);
    sendState(player);
  }

  function doorUnsealed({ player }) {
    if (!player) return;
    // A player who unsealed the door before this quest existed has no stage; they finish at Ashuelot all the same.
    if (stageOf(player) < STAGE_UNSEALED) quest.setStage(player, STAGE_UNSEALED);
    setStory(player, STORY_OUTER);
    sendState(player);
  }

  /** Key pieces drop only during the miniquest (Wiki: "only dropped during The Frozen Door miniquest"). */
  function questItem(request) {
    if (PIECE_IDS.has(request.itemId) && request.player) request.allowed = inProgress(request.player);
  }

  // --- Ashuelot Reis ---------------------------------------------------------------------------------

  /** Plays quest-owned steps as Ashuelot, as the shared transcript player runs any conversation. */
  function playAshuelot(player, npc, steps) {
    const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const npcId = story(player) >= STORY_DEPARTED ? ASHUELOT_BANK : ASHUELOT;
    const definition = NpcDefinition.forId(npcId);
    const context = { player, npc, npcId, definition, pages: [{ page: "Ashuelot Reis", variants: [] }] };
    startDialogue(api, { player, npcId, npc, definition }, steps, {}, context);
  }

  function talkToAshuelot(event) {
    const { player, npcId } = event;
    if (!ASHUELOT_IDS.has(npcId)) return;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option === "Bank") {
      event.handled = true;
      player.getBank(player.getCurrentBankTab()).open();
      return;
    }
    if (option !== "Talk-to") return;
    const place = story(player);
    let steps;
    if (place === STORY_OUTER) steps = DATA["ashuelot-first"];
    else if (place === STORY_DEPARTED) steps = [...DATA["ashuelot-safe-intro"], ...DATA["ashuelot-menu"]];
    else steps = DATA["ashuelot-menu"];
    playAshuelot(player, event.npc, steps);
    event.handled = true;
  }

  /** Between the entry room and the prison proper: Ashuelot will not let the player by until she has spoken. */
  function prisonDoor(request) {
    const { player } = request;
    if (!player || story(player) !== STORY_OUTER) return;
    request.blocked = true;
    playAshuelot(player, null, DATA["ashuelot-blocked"]);
  }

  function handleAction(event) {
    const { player, npcId, stepId, action } = event;
    if (!player) return;
    if (npcId === MESSENGER && action === "receive" && /Important letter/.test(String(event.text ?? ""))) {
      event.handled = true;
      const npc = messengers.get(player);
      later(player, 3, () => dismiss(player, npc));
      // Held only if it really went into the backpack (a full one would drop it on the floor, to be lost).
      if (player.getInventory().getFreeSlots() < 1) { scheduleMessenger(player, 40, 120); return; }
      player.getInventory().adds(LETTER, 1);
      player.setAttribute(LETTER_ATTRIBUTE, true);
      return;
    }
    if (!ASHUELOT_IDS.has(npcId)) return;
    if (action === "fd-bank-ready" && stepId === "fd:bank-ready") {
      // The intro is done: from now on she is the banking form (the dialogue's own bank option needs it).
      setStory(player, STORY_BANKING);
      event.handled = true;
    } else if (stepId === "fd:departs" && event.kind === "message") {
      // "Ashuelot Reis departs for the inner section of the prison." ends the miniquest, a tick after the chat closes.
      later(player, 1, () => {
        setStory(player, STORY_DEPARTED);
        if (stageOf(player) < STAGE_COMPLETE) quest.complete(player);
        sendState(player);
      });
    }
  }

  // --- journal -----------------------------------------------------------------------------------------

  const LETTER_DONE = [
    "<str>I received a Mysterious Letter from an Unknown Sender. It",
    "<str>encouraged me to head to an Ancient Dungeon deep beneath",
    "<str>Trollheim and open a Frozen Door there.",
  ];
  const LETTER_TODO = LETTER_DONE.map((line) => line.replace("<str>", ""));
  const KEY_TODO = [
    "<col=000080>I managed to recover <col=800000>Four Key Pieces<col=000080> from the <col=800000>Leaders<col=000080> of the",
    "<col=000080><col=800000>Four Armies<col=000080> fighting in the <col=800000>Ancient Dungeon<col=000080>. I then used them",
    "<col=000080>to assemble a <col=800000>Frozen Key<col=000080>. Now I just need to use it to open",
    "<col=000080>the <col=800000>Frozen Door<col=000080>.",
  ];

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [...LETTER_DONE, "<str>I used a Frozen Key to open the Frozen Door and met Ashuelot Reis.", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_UNSEALED) {
      return [...LETTER_DONE, "<str>I assembled a Frozen Key and unsealed the Frozen Door.", "", "I should speak to <col=800000>Ashuelot Reis</col> inside."];
    }
    if (stage >= STAGE_KEY) return [...LETTER_DONE, ...KEY_TODO];
    if (stage >= STAGE_LETTER_READ) {
      const flags = pieceFlags(player);
      const missing = GODS.filter((god) => flags[god] !== true).map((god) => `<col=800000>${god[0].toUpperCase()}${god.slice(1)}</col>`);
      return [...LETTER_TODO, "", `I still need the key pieces of: ${missing.join(", ") || "none"}.`];
    }
    return ["I can start this miniquest by waiting for a <col=800000>messenger</col> to bring me a letter", "once I have completed <col=800000>Desert Treasure I</col>."];
  }

  /** A letter that is in neither the backpack nor the bank is not held, whatever happened to it. */
  function reconcileLetter(player) {
    if (stageOf(player) !== 0 || !holdsLetter(player)) return;
    const banked = player.getBanks?.().some((bank) => bank?.contains?.(LETTER)) === true;
    if (!player.getInventory().contains(LETTER) && !banked) player.setAttribute(LETTER_ATTRIBUTE, false);
  }

  function handleLogin({ player }) {
    reconcileLetter(player);
    // A player who opened the door before the quest existed is at the door's stage: Ashuelot completes it.
    if (unsealedBefore(player) && !quest.isComplete(player) && stageOf(player) < STAGE_UNSEALED) quest.setStage(player, STAGE_UNSEALED);
    refreshQuestList(player);
    sendState(player);
    scheduleMessenger(player, 100, 400);
  }

  quest = registerQuest(api, {
    key: "the_frozen_door",
    name: "The Frozen Door",
    varbitId: QUEST_VARBIT,
    startedValue: STAGE_LETTER_READ,
    completionValue: STAGE_COMPLETE,
    questPoints: 0,
    otherRewards: ["Access to Nex in the Ancient Prison"],
    buildJournal,
  });

  api.persistAttribute(LETTER_ATTRIBUTE, false);
  api.persistAttribute(DESTROYED_ATTRIBUTE, 0);
  api.persistAttribute(STORY_ATTRIBUTE, 0);
  api.persistAttribute(PIECES_ATTRIBUTE, {});

  api.onItemAction("Important letter", { Read: readLetter });
  api.onBeforeNpcInteraction(talkToAshuelot);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-drops:quest-item", questItem);
  api.onCustomEvent("destroy-item:destroyed", itemDestroyed);
  api.onCustomEvent("quest:completed", desertTreasureCompleted);
  api.onCustomEvent("nex:frozen-key-assembled", keyAssembled);
  api.onCustomEvent("nex:frozen-door-unsealed", doorUnsealed);
  api.onCustomEvent("nex:prison-door", prisonDoor);
  api.onPlayerLogin(handleLogin);
};
