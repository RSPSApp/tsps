/**
 * Tribal Totem (members).
 *
 * Words come from the "Tribal Totem" transcript page:
 *   Kangai Mau, not started -> getting-started-talking-to-kangai-mau
 *   Kangai Mau, carrying the totem -> returning-back-to-kangai-mau
 *   GPDT employee, crate relabelled -> investigating-the-gpdt-depot-talking-to-gpdt-employee-after-using-the-address-label-on-the-crate
 *   Horacio -> getting-started-talking-to-horacio
 *   Wizard Cromperty -> investigating-the-gpdt-depot-talking-to-wizard-cromperty
 *
 * This plugin supplies the variant selector, the prose-condition answers, the
 * start hook, the totem hand-in (transcript action), the guide-book read and the
 * object chain: the GPDT address label, the relabelled crate, the locked mansion
 * front door, the KURT combination door, the trapped stairs and the upstairs
 * chest.
 */
module.exports = function registerTribalTotemQuest(api) {
  const {
    Skill,
    Location,
    GameObject,
    ObjectManager,
    Item,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Tribal Totem";
  const VARP_TRIBAL_TOTEM = 200;

  const STAGE_STARTED = 1;
  const STAGE_CRATE_MARKED = 2;
  const STAGE_DELIVERED = 3;
  const STAGE_IN_MANSION = 4;
  const STAGE_COMPLETE = 5;

  const START_HOOK = "quest:tribal-totem:start";
  /** Transcript action that ends the "returning back to Kangai Mau" branch. */
  const COMPLETE_ACTION_ID = "WkVGYP";
  /** Transcript action after Cromperty's teleport incantation. */
  const TELEPORT_ACTION_ID = "bCwZ9I";

  const KANGAI_MAU_NPC_ID = NpcIdentifiers.KANGAI_MAU;
  const GPDT_EMPLOYEE_NPC_ID = NpcIdentifiers.GPDT_EMPLOYEE;
  const HORACIO_NPC_ID = NpcIdentifiers.HORACIO;
  const WIZARD_CROMPERTY_NPC_IDS = new Set([
    NpcIdentifiers.WIZARD_CROMPERTY,
    NpcIdentifiers.WIZARD_CROMPERTY_2,
  ]);

  const TRIBAL_TOTEM_ITEM_ID = ItemIdentifiers.TOTEM;
  const ADDRESS_LABEL_ITEM_ID = ItemIdentifiers.ADDRESS_LABEL;
  const GUIDE_BOOK_ITEM_ID = ItemIdentifiers.GUIDE_BOOK;
  const SWORDFISH_ITEM_ID = ItemIdentifiers.SWORDFISH;

  // Cache ids (RuneLite gameval names): 2707 HORNCRATE is the north-east crate
  // holding Handelmort's address label; 2708 TELEPORTCRATE is Cromperty's crate
  // to its south. 2706 is the locked mansion front door and 2705 is the KURT
  // combination door; 2709/2710 are the closed/open totem chest.
  const LABEL_CRATE_ID = ObjectIdentifiers.CRATE_19; // 2707
  const TELEPORT_CRATE_ID = ObjectIdentifiers.CRATE_20; // 2708
  const MANSION_CHEST_ID = ObjectIdentifiers.CHEST_21; // 2709
  const MANSION_OPEN_CHEST_ID = ObjectIdentifiers.CHEST_22; // 2710
  const MANSION_DOOR_ID = ObjectIdentifiers.DOOR_101; // 2706, locked front door
  const COMBINATION_DOOR_ID = ObjectIdentifiers.DOOR_100; // 2705, KURT lock
  const TRAP_STAIRS_ID = ObjectIdentifiers.STAIRS_13; // 2711

  // The same ids are also placed in a second mansion copy around (3340,5945);
  // every handler is pinned to the real Ardougne tiles so that copy is untouched.
  const LABEL_CRATE_TILE = { x: 2650, y: 3273, z: 0 };
  const TELEPORT_CRATE_TILE = { x: 2650, y: 3271, z: 0 };
  const MANSION_CHEST_TILE = { x: 2638, y: 3324, z: 1 };
  const MANSION_DOOR_TILE = { x: 2635, y: 3321, z: 0 };
  const COMBINATION_DOOR_TILE = { x: 2634, y: 3323, z: 0 };
  const TRAP_STAIRS_TILE = { x: 2631, y: 3322, z: 0 };
  const TELEPORT_TILE = { x: 2638, y: 3322, z: 0 };
  const SEWER_FALL_TILE = { x: 2566, y: 9641, z: 0 };

  const THIEVING_REQUIREMENT = 21;
  const STAIRS_INVESTIGATED_ATTRIBUTE = "quest.tribal_totem.stairs_investigated";
  const GUIDE_READ_ATTRIBUTE = "quest.tribal_totem.guide_read";
  const KURT_DOOR_UNLOCKED_ATTRIBUTE = "tribal-totem:kurt-door-unlocked";
  const COMBINATION_INTERFACE = 369;
  const COMBINATION_VARBITS = [14807, 14808, 14809, 14810];
  const COMBINATION_SOLUTION = [11, 21, 18, 20];
  const COMBINATION_BUTTONS = new Map([
    [0x0171003c, [0, -1]], [0x01710048, [0, 1]],
    [0x01710049, [1, -1]], [0x0171004a, [1, 1]],
    [0x0171004b, [2, -1]], [0x0171004c, [2, 1]],
    [0x0171004d, [3, -1]], [0x0171004e, [3, 1]],
  ]);
  const COMBINATION_ENTER_BUTTON = 0x0171003b;
  const combinationSessions = new WeakSet();

  const page = (variant) => ({ page: PAGE, variant });
  const hasInventory = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasInBank = (player, itemId) => {
    const banks = player.getBanks?.() ?? [player.getBank?.()];
    return banks.some((bank) => (Number(bank?.getAmount?.(itemId)) || 0) > 0);
  };
  const has = (player, itemId) => hasInventory(player, itemId) || hasInBank(player, itemId);
  const giveItem = (player, itemId) => {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      inventory.full?.();
      return false;
    }
    const before = inventory.getAmount(itemId);
    inventory.adds(itemId, 1);
    if (inventory.getAmount(itemId) <= before) {
      inventory.full?.();
      return false;
    }
    return true;
  };
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const actionOf = (event) =>
    String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  const atTile = (location, tile) =>
    location && location.x === tile.x && location.y === tile.y && (tile.z === undefined || location.z === tile.z);
  const objectTile = (event) => {
    const location = event.object?.getLocation?.();
    return location
      ? { x: location.getX?.() ?? location.x, y: location.getY?.() ?? location.y, z: location.getZ?.() ?? location.z }
      : event.location;
  };
  const replaceObject = (object, newId) => {
    const location = object?.getLocation?.();
    if (!location) return;
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea?.() ?? null
      ),
      true
    );
  };

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I recovered the Rantuki tribe's totem from</str>",
        "<str>Lord Handelmort's mansion in Ardougne.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CRATE_MARKED) {
      return [
        "<str>I relabelled Wizard Cromperty's crate so the GPDT</str>",
        "<str>would deliver it into Handelmort Mansion.</str>",
        "I must get inside and take the <col=800000>tribal totem</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Kangai Mau asked me to recover the Rantuki tribe's",
        "<col=800000>tribal totem</col> from <col=800000>Lord Handelmort's</col>",
        "mansion in East Ardougne.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Kangai Mau</col>",
      "in the Shrimp & Parrot in Brimhaven.",
      "",
      "I need level 21 <col=800000>Thieving</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 1775);
    const inventory = player.getInventory();
    // One at a time so a nearly full bag drops only the swordfish that do not fit.
    for (let i = 0; i < 4; i++) inventory.forceAdd(player, new Item(SWORDFISH_ITEM_ID, 1));
  }

  function kangaiVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) {
      // The post-quest lines live on the Kangai Mau page, not the quest transcript.
      return { page: "Kangai Mau", variant: "standard-dialogue-after-the-completion-of-the-quest" };
    }
    if (stage >= STAGE_IN_MANSION || has(player, TRIBAL_TOTEM_ITEM_ID)) return page("returning-back-to-kangai-mau");
    return page("getting-started-talking-to-kangai-mau");
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === KANGAI_MAU_NPC_ID) return kangaiVariant(player, stage);
    if (npcId === GPDT_EMPLOYEE_NPC_ID) {
      return page(
        stage >= STAGE_CRATE_MARKED
          ? "investigating-the-gpdt-depot-talking-to-gpdt-employee-after-using-the-address-label-on-the-crate"
          : "investigating-the-gpdt-depot-talking-to-a-gpdt-employee"
      );
    }
    if (npcId === HORACIO_NPC_ID) return page("getting-started-talking-to-horacio");
    if (WIZARD_CROMPERTY_NPC_IDS.has(npcId)) {
      return page("investigating-the-gpdt-depot-talking-to-wizard-cromperty");
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("does not have the totem")) return !has(player, TRIBAL_TOTEM_ITEM_ID);
    if (value.includes("has the totem")) return has(player, TRIBAL_TOTEM_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KANGAI_MAU_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The transcript's "Quest complete!" action consumes the totem and finishes. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === TELEPORT_ACTION_ID && WIZARD_CROMPERTY_NPC_IDS.has(npcId)) {
      // The block only reaches the mansion after the employee agrees to deliver it.
      if (quest.getStage(player) < STAGE_DELIVERED) return;
      player.moveTo(new Location(TELEPORT_TILE.x, TELEPORT_TILE.y, TELEPORT_TILE.z));
      if (quest.getStage(player) < STAGE_IN_MANSION) quest.setStage(player, STAGE_IN_MANSION);
      player.sendMessage("You find yourself inside Handelmort Mansion.");
      event.handled = true;
      return;
    }
    if (npcId !== KANGAI_MAU_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player)) return;
    if (quest.getStage(player) < STAGE_IN_MANSION || !hasInventory(player, TRIBAL_TOTEM_ITEM_ID)) return;
    event.handled = true;
    take(player, TRIBAL_TOTEM_ITEM_ID);
    quest.complete(player);
  }

  /** The north-east GPDT crate holds Handelmort's address label. */
  function investigateCrate(event) {
    if (!actionOf(event).includes("investigate")) return;
    const player = event.player;
    if (event.objectId === LABEL_CRATE_ID && atTile(event.location, LABEL_CRATE_TILE)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED) return;
      if (has(player, ADDRESS_LABEL_ITEM_ID) || quest.getStage(player) >= STAGE_CRATE_MARKED) {
        player.sendMessage("You can see the gluey outline from where you peeled the address label off.");
        return;
      }
      if (!giveItem(player, ADDRESS_LABEL_ITEM_ID)) return;
      player.sendMessage("There is a label on this crate. It says: Lord Handelmort, Handelmort Mansion, Ardougne");
      player.sendMessage("You carefully peel it off and take it.");
      return;
    }
    if (event.objectId === TELEPORT_CRATE_ID && atTile(event.location, TELEPORT_CRATE_TILE)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED) return;
      player.sendMessage("There is a label on this crate. It says;");
      player.sendMessage(
        quest.getStage(player) >= STAGE_CRATE_MARKED
          ? "To Lord Handelmort, Handelmort Mansion, Ardougne."
          : "Senior Patents Clerk, Chamber of Invention, The Wizards' Tower, Misthalin. The crate is securely fastened shut and ready for delivery."
      );
    }
  }

  /** Using the address label on Cromperty's crate relabels it for delivery. */
  function relabelCrate(event) {
    const { player } = event;
    if (event.itemId !== ADDRESS_LABEL_ITEM_ID || event.objectId !== TELEPORT_CRATE_ID) return;
    if (!atTile(event.location, TELEPORT_CRATE_TILE)) return;
    if (quest.getStage(player) < STAGE_STARTED || !hasInventory(player, ADDRESS_LABEL_ITEM_ID)) return;
    event.handled = true;
    if (quest.getStage(player) >= STAGE_CRATE_MARKED) {
      player.sendMessage("You have already replaced the delivery address label.");
      return;
    }
    take(player, ADDRESS_LABEL_ITEM_ID);
    quest.setStage(player, STAGE_CRATE_MARKED);
    player.sendMessage("You carefully place the delivery address label over the existing label, covering it completely.");
    player.sendMessage("Now I just need someone to deliver it for me.");
  }

  /** Talking to the employee makes the relabelled crate's delivery happen. */
  function handleDeliveryChoice({ player, npcId, option }) {
    if (npcId !== GPDT_EMPLOYEE_NPC_ID) return;
    if (!String(option ?? "").toLowerCase().includes("deliver this crate")) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_CRATE_MARKED || stage >= STAGE_DELIVERED) return;
    quest.setStage(player, STAGE_DELIVERED);
  }

  /**
   * The front door is securely locked from the outside until Cromperty teleports
   * the player in; the Doors plugin would otherwise swing it open for free.
   */
  function lockMansionDoor(request) {
    if (request.objectId !== MANSION_DOOR_ID) return;
    if (!atTile(request.location, MANSION_DOOR_TILE)) return;
    if (request.player.getLocation().getY() >= MANSION_DOOR_TILE.y) return;
    request.player.sendMessage("This door is securely locked.");
    request.handled = true;
  }

  /** The cache's TribalDoor interface and four code varbits are the KURT lock. */
  function openCombinationDoor(event) {
    if (event.objectId !== COMBINATION_DOOR_ID || !atTile(event.location, COMBINATION_DOOR_TILE)) return;
    if (!actionOf(event).includes("open")) return;
    if (event.player.getAttribute(KURT_DOOR_UNLOCKED_ATTRIBUTE) === true) return;
    event.handled = true;
    combinationSessions.add(event.player);
    const sender = event.player.getPacketSender();
    COMBINATION_VARBITS.forEach((varbit) => {
      const value = sender.getVarbit(varbit);
      if (value < 1 || value > 26) sender.sendVarbit(varbit, 1);
    });
    sender.sendInterface(COMBINATION_INTERFACE);
  }

  function handleCombinationButton({ player, buttonId, handled }) {
    if (handled || player.getInterfaceId?.() !== COMBINATION_INTERFACE || !combinationSessions.has(player)) return;
    const sender = player.getPacketSender();
    const move = COMBINATION_BUTTONS.get(buttonId);
    if (move) {
      const [index, delta] = move;
      const current = sender.getVarbit(COMBINATION_VARBITS[index]);
      const next = delta < 0
        ? (current === 1 ? 26 : current - 1)
        : (current === 26 ? 1 : current + 1);
      sender.sendVarbit(COMBINATION_VARBITS[index], next);
      return;
    }
    if (buttonId !== COMBINATION_ENTER_BUTTON) return;
    const correct = COMBINATION_VARBITS.every(
      (varbit, index) => sender.getVarbit(varbit) === COMBINATION_SOLUTION[index]
    );
    if (!correct) {
      player.sendMessage("The combination is incorrect.");
      return;
    }
    combinationSessions.delete(player);
    player.setAttribute(KURT_DOOR_UNLOCKED_ATTRIBUTE, true);
    sender.closeInterface();
    player.sendMessage("The combination seems correct!");
  }

  /** Investigating the stairs reveals the trap; climbing before that drops you. */
  function investigateStairs(event) {
    if (event.objectId !== TRAP_STAIRS_ID || !atTile(event.location, TRAP_STAIRS_TILE)) return;
    if (!actionOf(event).includes("investigate")) return;
    event.handled = true;
    if (event.player.getSkillManager().getCurrentLevel(Skill.THIEVING) < THIEVING_REQUIREMENT) {
      event.player.sendMessage("You don't find anything interesting.");
      return;
    }
    event.player.setAttribute(STAIRS_INVESTIGATED_ATTRIBUTE, 1);
    event.player.sendMessage(
      "Your trained senses as a thief enable you to see that there is a trap in these stairs. " +
        "You make a note of its location for future reference when using these stairs."
    );
  }

  /** Claim the Climb-up of the trapped stairs before the generic ladder handler. */
  function claimTrapStairs(request) {
    if (request.handled || request.objectId !== TRAP_STAIRS_ID) return;
    const location = request.object?.getLocation?.();
    if (!location || location.getX() !== TRAP_STAIRS_TILE.x || location.getY() !== TRAP_STAIRS_TILE.y) return;
    if (Number(request.player.getAttribute(STAIRS_INVESTIGATED_ATTRIBUTE)) === 1) return;
    request.player.sendMessage("As you climb the stairs you hear a click...");
    request.player.sendMessage("You have fallen through a trap!");
    request.player.moveTo(new Location(SEWER_FALL_TILE.x, SEWER_FALL_TILE.y, SEWER_FALL_TILE.z));
    request.handled = true;
  }

  /** Opening the chest swaps in the open chest; searching it yields the totem. */
  function openMansionChest(event) {
    const location = objectTile(event);
    if (!atTile(location, MANSION_CHEST_TILE)) return;
    const player = event.player;
    const option = actionOf(event);
    if (event.objectId === MANSION_CHEST_ID && option.includes("open")) {
      event.handled = true;
      replaceObject(event.object, MANSION_OPEN_CHEST_ID);
      player.sendMessage("You open the chest.");
      return;
    }
    if (event.objectId === MANSION_OPEN_CHEST_ID && option.includes("close")) {
      event.handled = true;
      replaceObject(event.object, MANSION_CHEST_ID);
      return;
    }
    if (event.objectId !== MANSION_OPEN_CHEST_ID || !option.includes("search")) return;
    if (quest.getStage(player) < STAGE_CRATE_MARKED) return;
    event.handled = true;
    if (quest.isComplete(player) || has(player, TRIBAL_TOTEM_ITEM_ID)) {
      player.sendMessage("The chest is empty.");
      return;
    }
    if (!giveItem(player, TRIBAL_TOTEM_ITEM_ID)) return;
    player.sendMessage("Inside the chest you find the tribal totem.");
  }

  function readGuideBook(event) {
    if (event.itemId !== GUIDE_BOOK_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.player.setAttribute(GUIDE_READ_ATTRIBUTE, 1);
    event.player.sendMessage("The guide lists the owner as Lord Francis Kurt Handelmort.");
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    combinationSessions.delete(player);
  }

  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId === COMBINATION_INTERFACE) combinationSessions.delete(player);
  }

  quest = registerQuest(api, {
    key: "tribal_totem",
    name: "Tribal Totem",
    varpId: VARP_TRIBAL_TOTEM,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.THIEVING.getIndex(), amount: 1775, label: "Thieving" }],
    rewardItemId: SWORDFISH_ITEM_ID,
    rewardItemLabel: "5 Swordfish",
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(STAIRS_INVESTIGATED_ATTRIBUTE);
  api.persistAttribute(GUIDE_READ_ATTRIBUTE);
  api.persistAttribute(KURT_DOOR_UNLOCKED_ATTRIBUTE, false);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleDeliveryChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onCustomEvent("door:toggle", lockMansionDoor);
  api.onCustomEvent("ladders:climb", claimTrapStairs);
  api.onObjectInteraction(investigateCrate);
  api.onObjectInteraction(openCombinationDoor);
  api.onInterfaceActionButton([
    ...COMBINATION_BUTTONS.keys(), COMBINATION_ENTER_BUTTON,
  ], handleCombinationButton);
  api.onObjectInteraction(investigateStairs);
  api.onObjectInteraction(openMansionChest);
  api.onItemOnObject(relabelCrate, { noted: false });
  api.onItemAction(readGuideBook);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
