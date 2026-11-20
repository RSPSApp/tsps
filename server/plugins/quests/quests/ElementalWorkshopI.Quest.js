const { hasKey, storedKey, ownsStoredKey } = require("../../items/KeyAvailability");
/**
 * Elemental Workshop I (members), as the user's rev 242 rsprox capture plays it
 * (ElementalWorkshop1.bin, docs/quests/elemental-workshop-i/README.md has the ticks), with the
 * Wiki's quest transcript for the branches the capture doesn't take.
 *
 * Stage is a durable bitfield (existing saves keep their meaning) laid out like the cache's
 * elemental_workshop_* varbits on varp 299: book bit 1, key bit 2, gate1 bit 3, gate2 bit 4,
 * switch bit 5, bellows bit 6, fire bit 7, bellows_switch bit 9, stairs bit 13, leather bit 14,
 * finished bit 20. Opening the odd wall sets the unnamed bit 15 (capture tick 198: 5126 ->
 * 37894); it is kept in private bit 16 and mirrored to 15, as old saves used 15 for a needle.
 * Quest status is the separate varbit 13718 (elementalworkshop; DB table 0 column 19 threshold
 * 2): started 1, complete 2. The water controls, wheel, bellows and furnace are varbit multilocs
 * on those bits (cache: 3403/3404 on 2059/2058, 3405 on 2060, 3407 on 2063, 3410 on 2062).
 */
module.exports = function registerElementalWorkshopIQuest(api) {
  const {
    Skill, Location, Animation, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, NpcDefinition, ItemDefinition,
    Equipment, BonusManager, ObjectManager, GameObject, TaskManager, CountdownTask, DialogueChainBuilder,
    OptionDialogue, StatementDialogue, ItemStatementDialogue, PlayerDialogue, Bank,
  } = api.core;
  const { registerQuest, refreshQuestList, openBook, bookPagesFromSpreads, questStartMessage, loadTranscripts, giveReward } = require("../QuestRuntime");

  const VARP_MACHINE_BITS = 299;
  const VARBIT_QUEST_STATUS = 13718;
  const EW2_KEY = "elemental_workshop_ii";

  const BIT = {
    book: 1 << 1,
    key: 1 << 2,
    gate1: 1 << 3, // west water control (3404)
    gate2: 1 << 4, // east water control (3403)
    waterSwitch: 1 << 5,
    bellows: 1 << 6,
    fire: 1 << 7,
    bellowsSwitch: 1 << 9,
    stairs: 1 << 13,
    leather: 1 << 14,
    /** Old saves' needle bit; never sent. */
    legacyNeedle: 1 << 15,
    enteredWall: 1 << 16,
    finished: 1 << 20,
  };
  /** The wall bit as the client has it. */
  const WIRE_ENTERED_WALL = 1 << 15;
  const WIRE_MASK = BIT.book | BIT.key | BIT.gate1 | BIT.gate2 | BIT.waterSwitch | BIT.bellows | BIT.fire
    | BIT.bellowsSwitch | BIT.stairs | BIT.leather | BIT.finished | WIRE_ENTERED_WALL;

  const STAGE_STARTED = BIT.book;
  const STAGE_COMPLETE = BIT.finished;

  const I = ItemIdentifiers;
  const BOOKCASE = ObjectIdentifiers.BOOKCASE_99; // 26113 elemental_workshop_bookcase
  const ODD_WALL_LEFT = ObjectIdentifiers.ODD_LOOKING_WALL_8; // 26115 at 2709,3495
  const ODD_WALL_RIGHT = ObjectIdentifiers.ODD_LOOKING_WALL_7; // 26114 at 2710,3495
  const ODD_WALLS = [ODD_WALL_LEFT, ODD_WALL_RIGHT];
  /** North of the wall (y 3496+) is the stairwell; the wall's tile row is 3495. */
  const STAIRWELL_Y = 3496;
  const LEATHER_CRATE = ObjectIdentifiers.CRATE_27; // 3394 elemental_workshop_box_1
  const NEEDLE_CRATE = ObjectIdentifiers.CRATE_28; // 3395 elemental_workshop_box_2
  const BOWL_BOXES = ObjectIdentifiers.BOXES_5; // 3397 elemental_workshop_box_4
  // The water controls are multilocs (no name of their own); clicks arrive on the base or a child.
  const WATER_CONTROL_EAST = 3403; // elemental_workshop_valve_1, transform varbit 2059 (gate2)
  const WATER_CONTROL_WEST = 3404; // elemental_workshop_valve_2, transform varbit 2058 (gate1)
  const WATER_CONTROL_CHILDREN = [ObjectIdentifiers.WATER_CONTROLS, ObjectIdentifiers.WATER_CONTROLS_2]; // 18509/18510
  const WATER_WHEEL_X = 2720;
  const WATER_LEVER = ObjectIdentifiers.LEVER_22; // 3406 elemental_workshop_water_lever
  const AIR_LEVER = ObjectIdentifiers.LEVER_23; // 3409 elemental_workshop_air_lever
  /** elemental_workshop_lever_pulled: both levers show it for two ticks (ticks 305-307, 361-363). */
  const LEVER_PULLED = 3417;
  const LEVER_DOWN_TICKS = 2;
  const BELLOWS = [3407, ObjectIdentifiers.BELLOWS_3, ObjectIdentifiers.BELLOWS_4]; // multiloc 3407, 18515/18516
  const FURNACES = [3410, ObjectIdentifiers.FURNACE_14, ObjectIdentifiers.FURNACE_15]; // multiloc 3410, 18525/18526
  const LAVA_TROUGHS = [
    ObjectIdentifiers.LAVA_TROUGH, ObjectIdentifiers.LAVA_TROUGH_2, ObjectIdentifiers.LAVA_TROUGH_3,
    ObjectIdentifiers.LAVA_TROUGH_4, ObjectIdentifiers.LAVA_TROUGH_5,
  ];
  const SURFACE_STAIRS = ObjectIdentifiers.STAIRCASE_10; // 3415 elemental_workshop_spiralstairstop
  const WORKSHOP_STAIRS = ObjectIdentifiers.STAIRCASE_11; // 3416 elemental_workshop_spiralstairs
  const WORKSHOP_LANDING = [2716, 9888];
  const SURFACE_LANDING = [2709, 3497];

  const ANIM = {
    turnValve: 4861, // elem1_qip_turn_valve
    fillBowl: 4862, // elem1_qip_fill_bowl
    repairBellows: 4863, // elem1_qip_bellow_repair
    furnace: 899, // human_furnace
    rockEmerge: 4865, // earth_elemental_rework_emerge
  };
  const SOUND = {
    locked: 2402,
    valve: 1541, // squeaky_valve
    waterWheelStart: 1547,
    lever: 2400,
    lavaFill: 1537,
    lavaPour: 1538,
  };

  const BOOK_TITLE = "Book of the elemental shield";
  // The captured spreads (ticks 35 and 38), line for line.
  const BOOK_PAGES = bookPagesFromSpreads([
    [[
      "Within the pages of this book", "you will find the secret to", "working the very elements", "themselves.",
      "Early in the fifth age, a new", "ore was discovered. This ore", "has a unique property of",
      "absorbing, transforming or", "focusing elemental energy. A", "workshop was erected close",
      "by to work this new material.", "The workshop was set up for", "artisans and inventors to be",
      "able to come and create", "devices made from the",
    ], ["unique ore, found only in the", "village of the Seers."]],
    [[
      "After some time of successful", "industry the true power of", "this ore became apparent, as",
      "greater and more powerful", "weapons were created.", "Realising the threat this", "posed, the magi of the time",
      "closed down the workshop", "and bound it under lock and", "key, also trying to destroy all",
      "knowledge of manufacturing", "processes. Yet this book", "remains and you may still", "find a way to enter the",
      "workshop within this leather",
    ], ["bound volume."]],
  ]);

  const MSG = {
    bookcaseBook: "You search the bookcase and find a battered book. You take it.",
    bookcaseBookNoRoom: "You search the bookcase and find a battered book. However, you don't have enough room to take it.",
    bookcaseSlashed: "You search the bookcase and find a slashed book. You take it.",
    bookcaseKey: "You search the bookcase and find a battered key. You take it.",
    bookcaseBoth: "You search the bookcase and find a slashed book and a battered key. You take them.",
    // Ours: the Wiki gives no line for a bookcase with nothing left to find.
    bookcaseNothing: "You search the bookcase but find nothing of interest.",
    startPrompt: "Start the Elemental Workshop I quest?",
    lowCombat: "Before starting this quest, be aware that your combat level is lower than the recommended level of 15.",
    bookParts: "The book has two parts: an introduction and an instruction section.",
    bookIntro: "You flip the book open to the introduction and start reading.",
    cutSpine: "You make a small cut in the spine of the book.",
    keyFound: "Inside you find a small, old, battered key.",
    keyDropped: "You drop the key on the floor as you have no space in your backpack.",
    dontDamage: "You don't want to damage the book.",
    // Ours: the Wiki and the capture read the book before cutting it; no line for cutting it first.
    readFirst: "You should read the book before cutting it.",
    wallKey: "You use the battered key to open the doors.",
    wallKeyRing: "You use the battered key on your keyring to open the doors.",
    wallLocked: "You see a small hole in the wall but no way to open it.",
    wallWrongItem: "You can't unlock the door with that.",
    exploreLine: "Now to explore this area thoroughly, to find what forgotten secrets it contains.",
    turnHandle: "You turn the handle.",
    pullLever: "You pull the lever.",
    wheelStarts: "You hear the sound of a water wheel starting up.",
    wheelStops: "You hear the sound of a water wheel coming to a standstill.",
    gatesReset: "You hear the sound of the flow gates resetting.",
    leatherFound: "You find some leather.",
    needleFound: "You find a needle.",
    bowlFound: "You find a stone bowl.",
    // Wiki (Crate (Elemental Workshop, empty)): the workshop's empty crates.
    empty: "It's empty.",
    bellowsMaterials: "You need a piece of leather, some thread and a needle to fix this.",
    bellowsStitched: "You stitch the leather over the hole in the bellows.",
    bellowsFixed: "The bellows already look fixed to you.",
    // Ours: the Wiki gives the 20 Crafting requirement but no refusal line.
    bellowsCrafting: "You need level 20 Crafting to repair the bellows.",
    bellowsPump: "The bellows pump air down the pipe.",
    bellowsHole: "The bellows pump air out of the hole.",
    bellowsReset: "Looks like they need fixing. You reset the lever.",
    bellowsStop: "The bellows stop pumping air.",
    bowlFilled: "You fill the bowl with hot lava.",
    lavaPoured: "You empty the lava into the furnace.",
    furnaceLit: "The furnace bursts to life.",
    furnaceCold: "The furnace is cold and useless for anything.",
    tinderbox: "The tinderbox cannot make a spark large enough to light this.",
    // Ours: a second bowl of lava on a lit furnace, and ore with the wheel or bellows stopped.
    furnaceAlreadyLit: "The furnace is already burning.",
    furnaceUnpowered: "The furnace is not hot enough to refine the ore.",
    needCoal: "You need four heaps of coal to smelt elemental ore.",
    // Ours: the Wiki gives the 20 Smithing requirement but no refusal line.
    smeltLevel: "You need level 20 Smithing to smelt elemental metal.",
    oreIn: "You place the elemental ore and four heaps of coal into the furnace.",
    barOut: "You retrieve a bar of elemental metal.",
    // Ours: the Wiki gives the 20 Mining requirement but no refusal line; the pickaxe line too.
    mineLevel: "You need a Mining level of 20 to mine this rock.",
    noPickaxe: "You need a pickaxe to mine this rock.",
  };

  /** Valve turned: the gate's colour changes three ticks after the handle (ticks 272 -> 275, 293 -> 296). */
  const VALVE_TICKS = 3;
  /** Lava poured: the furnace lights four ticks later (411 -> 415). */
  const FURNACE_LIGHT_TICKS = 4;
  /**
   * Ore in: the bar comes out six ticks later (Wiki, Elemental metal: 6 ticks). Recorded
   * difference: the capture has it four ticks later (500 -> 504).
   */
  const SMELT_TICKS = 6;
  /** Trough: the bowl fills two ticks after the scoop (397 -> 399). */
  const FILL_TICKS = 2;
  /** Stairs: the player lands a tick after the click (203 -> 204, 232 -> 233). */
  const STAIRS_TICKS = 1;
  /** Mined rock: it rises with the emerge animation and becomes the elemental two ticks later (436 -> 438). */
  const ROCK_RISE_TICKS = 2;
  /** Ours: no capture shows an untouched elemental going back to rock; DormantNpcs' crab rest time. */
  const ROCK_REST_TICKS = 20;

  const SMELT_XP = 8; // Wiki (Elemental metal) and capture tick 504

  let quest;
  /** Busy players (a turn, a pour, a smelt, a hammering in progress): one at a time. */
  const working = new WeakSet();
  /** Rocks the miner woke: npc -> { target, rising, idle }. */
  const awakeRocks = new Map();

  const raw = (player) => quest.getStage(player);
  const hasBit = (player, bit) => (raw(player) & bit) !== 0;
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const sound = (player, id) => player.getPacketSender().sendSound(id, 1, 0);
  const animate = (mob, id) => mob.performAnimation(new Animation(id));

  function later(player, ticks, action) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      action();
    }));
  }

  /** Steps that took their inputs on the click (the pour, the smelt): finished on logout, not lost. */
  const pendingFinish = new WeakMap();

  function finishLater(player, ticks, finish) {
    pendingFinish.set(player, finish);
    later(player, ticks, () => {
      if (pendingFinish.get(player) !== finish) return;
      pendingFinish.delete(player);
      finish();
    });
  }

  function finishOnLogout({ player }) {
    const finish = pendingFinish.get(player);
    if (!finish) return;
    pendingFinish.delete(player);
    finish();
  }

  function write(player, value) {
    quest.setStage(player, value | 0);
    syncMachine(player);
  }

  function setBit(player, bit, enabled = true) {
    write(player, enabled ? raw(player) | bit : raw(player) & ~bit);
  }

  /** The machine bits the client renders (valves, wheel, bellows and furnace multilocs). */
  function syncMachine(player) {
    const value = raw(player);
    const machine = (value & ~(BIT.legacyNeedle | BIT.enteredWall)) | (value & (BIT.enteredWall | BIT.stairs) ? WIRE_ENTERED_WALL : 0);
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_MACHINE_BITS, (sender.getVarp(VARP_MACHINE_BITS) & ~WIRE_MASK) | (machine & WIRE_MASK));
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function statement(player, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function itemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
  }

  /** One loc for another in place, for everyone (loc_add_change). */
  function swapLoc(object, id) {
    const at = object.getLocation();
    const next = new GameObject(id, new Location(at.getX(), at.getY(), at.getZ()), object.getType(), object.getFace(),
      object.getPrivateArea?.() ?? null);
    ObjectManager.replaceInPlace(object, next);
    return next;
  }

  /** A lever drops to elemental_workshop_lever_pulled and is back two ticks later. */
  function dropLever(object, leverId) {
    if (!object) return;
    const pulled = swapLoc(object, LEVER_PULLED);
    TaskManager.submit(new CountdownTask(pulled, LEVER_DOWN_TICKS, () => swapLoc(pulled, leverId)));
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= BIT.finished) {
      return ["<str>I restored the workshop and made an elemental shield.", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (!(stage & BIT.book)) {
      return [
        "I can start this quest by reading a battered book",
        "found in a house in Seers' Village.",
        "",
        "Minimum requirements: 20 Mining, Smithing and Crafting.",
      ];
    }
    // Captured at this stage (tick 53).
    const lines = [
      "<str>I have found a battered book in a house in Seers' Village.",
      "<str>It tells of magic ore and a workshop created to fashion it.",
      "",
    ];
    if (!(stage & (BIT.enteredWall | BIT.stairs))) {
      lines.push("Where is this workshop and how do I get in?");
      return lines;
    }
    // Ours from here: no capture of the journal past the first stage.
    lines.push("<str>I found the Elemental Workshop beneath the Seers' Village smithy.");
    if (!(stage & BIT.waterSwitch)) lines.push("The water wheel needs its flow gates opened to turn.");
    if (!(stage & BIT.bellows)) lines.push("The bellows need leather, thread and a needle.");
    if (!(stage & BIT.bellowsSwitch)) lines.push("The bellows lever should send air to the furnace.");
    if (!(stage & BIT.fire)) lines.push("A stone bowl of lava will light the furnace.");
    if (has(player, I.ELEMENTAL_METAL)) {
      lines.push("I should use the elemental metal on a workbench with a hammer.");
    } else {
      lines.push("The furnace can smelt elemental ore with four heaps of coal.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 5000);
    player.getSkillManager().addExperiences(Skill.SMITHING, 5000);
  }

  // ==========================================================================
  // The battered book and the bookcase
  // ==========================================================================

  function readBook(player) {
    if (!hasBit(player, BIT.book)) {
      askToStart(player);
      return;
    }
    openShieldBook(player);
  }

  /** Live: the prompt first; the book's two lines, the start and the book on "Yes." (ticks 30-35). */
  function askToStart(player) {
    const warn = player.getSkillManager().getCombatLevel() < 15;
    const menu = new OptionDialogue(warn ? 1 : 0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) !== 1 || hasBit(player, BIT.book)) return;
        setBit(player, BIT.book);
        player.sendMessage(questStartMessage(player, quest.name));
        openShieldBook(player);
      },
    }, "Yes.", "No.").setTitle(MSG.startPrompt);
    const chain = new DialogueChainBuilder();
    if (warn) chain.add(new StatementDialogue(0, MSG.lowCombat));
    chain.add(menu);
    player.getDialogueManager().startDialogues(chain);
  }

  function openShieldBook(player) {
    player.sendMessage(MSG.bookParts);
    player.sendMessage(MSG.bookIntro);
    openBook(player, BOOK_TITLE, BOOK_PAGES);
  }

  /** Knives, and weapons that slash (Wiki: "a knife or any slash weapon"). */
  function cutsBook(itemId) {
    const definition = ItemDefinition.forId(itemId);
    if (!definition || definition.isNoted()) return false;
    if (definition.getName() === "Knife") return true;
    if (definition.getEquipmentType?.()?.getSlot?.() !== Equipment.WEAPON_SLOT) return false;
    return (definition.getBonuses?.()?.[BonusManager.ATTACK_SLASH] ?? 0) > 0;
  }

  function cutBook(player, bookSlot) {
    if (!hasBit(player, BIT.book)) {
      player.sendMessage(MSG.readFirst);
      return;
    }
    const inventory = player.getInventory();
    const book = inventory.getItems()[bookSlot];
    if (book?.getId?.() !== I.BATTERED_BOOK) return;
    inventory.setItem(bookSlot, new (api.core.Item)(I.SLASHED_BOOK, 1));
    inventory.refreshItems();
    player.sendMessage(MSG.cutSpine);
    player.sendMessage(MSG.keyFound);
    if (inventory.getFreeSlots() > 0) {
      inventory.adds(I.BATTERED_KEY, 1);
    } else {
      api.core.ItemOnGroundManager.registerLocation(player, new (api.core.Item)(I.BATTERED_KEY, 1), player.getLocation().clone());
      player.sendMessage(MSG.keyDropped);
    }
    setBit(player, BIT.key);
  }

  function searchBookcase(player) {
    const inventory = player.getInventory();
    if (!hasBit(player, BIT.key)) {
      if (has(player, I.BATTERED_BOOK)) {
        player.sendMessage(MSG.bookcaseNothing);
        return;
      }
      if (inventory.getFreeSlots() < 1) {
        itemBox(player, I.BATTERED_BOOK, MSG.bookcaseBookNoRoom);
        return;
      }
      inventory.adds(I.BATTERED_BOOK, 1);
      itemBox(player, I.BATTERED_BOOK, MSG.bookcaseBook);
      return;
    }
    // Wiki (Battered book): searching once the book is slashed takes the battered copies away.
    while (has(player, I.BATTERED_BOOK)) inventory.deleteNumber(I.BATTERED_BOOK, 1);
    const needsBook = !has(player, I.SLASHED_BOOK);
    const needsKey = !hasKey(api, player, I.BATTERED_KEY) && !ownsStoredKey(api, player, I.BATTERED_KEY);
    if (!needsBook && !needsKey) {
      player.sendMessage(MSG.bookcaseNothing);
      return;
    }
    if (inventory.getFreeSlots() < (needsBook ? 1 : 0) + (needsKey ? 1 : 0)) {
      inventory.full();
      return;
    }
    if (needsBook) inventory.adds(I.SLASHED_BOOK, 1);
    if (needsKey) inventory.adds(I.BATTERED_KEY, 1);
    if (needsBook && needsKey) itemBox(player, I.SLASHED_BOOK, MSG.bookcaseBoth);
    else if (needsBook) itemBox(player, I.SLASHED_BOOK, MSG.bookcaseSlashed);
    else itemBox(player, I.BATTERED_KEY, MSG.bookcaseKey);
  }

  // ==========================================================================
  // The odd wall and the stairs
  // ==========================================================================

  /**
   * Captured both ways (ticks 197-200 in, 239-242 out): the key line from outside only, then
   * Doors' pass-through gate (inviswall on both wall tiles, the open leaves north, scrape 2410,
   * the player across in the same tick, the wall back two ticks later).
   */
  function openOddWall(player, object, keyUsed) {
    const inside = player.getLocation().getY() >= STAIRWELL_Y;
    if (!inside) {
      if (keyUsed || player.getInventory().contains(I.BATTERED_KEY)) {
        player.sendMessage(MSG.wallKey);
      } else if (storedKey(api, player, I.BATTERED_KEY)) {
        player.sendMessage(MSG.wallKeyRing);
      } else {
        player.sendMessage(MSG.wallLocked);
        sound(player, SOUND.locked);
        return;
      }
    }
    const request = { player, object, handled: false };
    api.emitCustomEvent("door:open", request);
    if (request.handled && !inside && !hasBit(player, BIT.enteredWall)) setBit(player, BIT.enteredWall);
  }

  function climbDown(player) {
    later(player, STAIRS_TICKS, () => {
      player.moveTo(new Location(WORKSHOP_LANDING[0], WORKSHOP_LANDING[1], 0));
      if (hasBit(player, BIT.stairs)) return;
      setBit(player, BIT.stairs);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, MSG.exploreLine)));
    });
  }

  function climbUp(player) {
    later(player, STAIRS_TICKS, () => player.moveTo(new Location(SURFACE_LANDING[0], SURFACE_LANDING[1], 0)));
  }

  // ==========================================================================
  // The water wheel, the bellows and the furnace
  // ==========================================================================

  /**
   * The handle turns on arrival and its gate changes colour three ticks later. Wiki: the east
   * (right, gate2) control can't be turned while the west (left, gate1) one is green, so the
   * order is east then west; either turns back. Ours: what a blocked east turn shows.
   */
  function turnValve(player, objectId, location) {
    if (working.has(player)) return;
    const east = objectId === WATER_CONTROL_EAST || (objectId !== WATER_CONTROL_WEST && (location?.x ?? 0) > WATER_WHEEL_X);
    const bit = east ? BIT.gate2 : BIT.gate1;
    player.sendMessage(MSG.turnHandle);
    animate(player, ANIM.turnValve);
    sound(player, SOUND.valve);
    if (east && hasBit(player, BIT.gate1)) return;
    working.add(player);
    later(player, VALVE_TICKS, () => {
      working.delete(player);
      setBit(player, bit, !hasBit(player, bit));
    });
  }

  function pullWaterLever(player, object) {
    player.sendMessage(MSG.pullLever);
    dropLever(object, WATER_LEVER);
    if (hasBit(player, BIT.waterSwitch)) {
      setBit(player, BIT.waterSwitch, false);
      player.sendMessage(MSG.wheelStops);
      sound(player, SOUND.lever);
    } else if (hasBit(player, BIT.gate1) && hasBit(player, BIT.gate2)) {
      setBit(player, BIT.waterSwitch);
      player.sendMessage(MSG.wheelStarts);
      sound(player, SOUND.waterWheelStart);
    } else {
      write(player, raw(player) & ~(BIT.gate1 | BIT.gate2));
      player.sendMessage(MSG.gatesReset);
      sound(player, SOUND.lever);
    }
  }

  function hasNeedle(player) {
    return has(player, I.NEEDLE) || has(player, I.COSTUME_NEEDLE);
  }

  function fixBellows(player) {
    if (hasBit(player, BIT.bellows)) {
      player.sendMessage(MSG.bellowsFixed);
      return;
    }
    if (!has(player, I.LEATHER) || !has(player, I.THREAD) || !hasNeedle(player)) {
      player.sendMessage(MSG.bellowsMaterials);
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 20) {
      player.sendMessage(MSG.bellowsCrafting);
      return;
    }
    player.getInventory().deleteNumber(I.LEATHER, 1);
    player.getInventory().deleteNumber(I.THREAD, 1);
    animate(player, ANIM.repairBellows);
    setBit(player, BIT.bellows);
    player.sendMessage(MSG.bellowsStitched);
  }

  function pullAirLever(player, object) {
    player.sendMessage(MSG.pullLever);
    dropLever(object, AIR_LEVER);
    sound(player, SOUND.lever);
    if (hasBit(player, BIT.bellowsSwitch)) {
      setBit(player, BIT.bellowsSwitch, false);
      player.sendMessage(MSG.bellowsStop);
    } else if (hasBit(player, BIT.bellows)) {
      setBit(player, BIT.bellowsSwitch);
      player.sendMessage(MSG.bellowsPump);
    } else {
      player.sendMessage(MSG.bellowsHole);
      player.sendMessage(MSG.bellowsReset);
    }
  }

  function fillBowl(player) {
    if (working.has(player) || !has(player, I.A_STONE_BOWL)) return;
    working.add(player);
    animate(player, ANIM.fillBowl);
    later(player, FILL_TICKS, () => {
      working.delete(player);
      const slot = player.getInventory().getSlotForItemId(I.A_STONE_BOWL);
      if (slot < 0) return;
      player.getInventory().setItem(slot, new (api.core.Item)(I.A_STONE_BOWL_2, 1));
      player.getInventory().refreshItems();
      player.sendMessage(MSG.bowlFilled);
      sound(player, SOUND.lavaFill);
    });
  }

  function pourLava(player) {
    if (working.has(player)) return;
    if (hasBit(player, BIT.fire)) {
      player.sendMessage(MSG.furnaceAlreadyLit);
      return;
    }
    const slot = player.getInventory().getSlotForItemId(I.A_STONE_BOWL_2);
    if (slot < 0) return;
    player.getInventory().setItem(slot, new (api.core.Item)(I.A_STONE_BOWL, 1));
    player.getInventory().refreshItems();
    player.sendMessage(MSG.lavaPoured);
    sound(player, SOUND.lavaPour);
    working.add(player);
    finishLater(player, FURNACE_LIGHT_TICKS, () => {
      working.delete(player);
      if (hasBit(player, BIT.fire)) return;
      setBit(player, BIT.fire);
      player.sendMessage(MSG.furnaceLit);
    });
  }

  function smeltOre(player) {
    if (working.has(player)) return;
    if (!hasBit(player, BIT.waterSwitch) || !hasBit(player, BIT.bellowsSwitch)) {
      player.sendMessage(MSG.furnaceUnpowered);
      return;
    }
    if (!has(player, I.COAL, 4)) {
      player.sendMessage(MSG.needCoal);
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < 20) {
      player.sendMessage(MSG.smeltLevel);
      return;
    }
    player.getInventory().deleteNumber(I.ELEMENTAL_ORE, 1);
    player.getInventory().deleteNumber(I.COAL, 4);
    animate(player, ANIM.furnace);
    player.sendMessage(MSG.oreIn);
    working.add(player);
    finishLater(player, SMELT_TICKS, () => {
      working.delete(player);
      animate(player, ANIM.furnace);
      // The ore and coal went in six ticks ago: a bag filled meanwhile gets the bar on the floor
      // (Ours: no source shows a full bag here), never loses it.
      giveReward(player, I.ELEMENTAL_METAL, 1);
      player.getSkillManager().addExperiences(Skill.SMITHING, SMELT_XP);
      player.sendMessage(MSG.barOut);
    });
  }

  function useOnFurnace(player, itemId) {
    if (!hasBit(player, BIT.fire)) {
      if (itemId === I.A_STONE_BOWL_2) pourLava(player);
      else if (itemId === I.TINDERBOX) player.sendMessage(MSG.tinderbox);
      else player.sendMessage(MSG.furnaceCold);
      return true;
    }
    if (itemId === I.A_STONE_BOWL_2) {
      pourLava(player);
      return true;
    }
    if (itemId === I.ELEMENTAL_ORE) {
      smeltOre(player);
      return true;
    }
    return false;
  }

  /**
   * The workbench is Elemental Workshop II's (ElementalWorkshopII.Quest.js), which offers this
   * quest's shield beside its own recipes. The first shield made there completes this quest.
   */
  function shieldMade({ player }) {
    if (quest.isComplete(player)) return;
    const machine = raw(player);
    if (quest.complete(player)) write(player, machine | BIT.finished);
  }

  // ==========================================================================
  // Crates
  // ==========================================================================

  function searchLeatherCrate(player) {
    if (hasBit(player, BIT.leather) || quest.isComplete(player) || !quest.isStarted(player)) {
      player.sendMessage(MSG.empty);
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return;
    }
    setBit(player, BIT.leather);
    player.getInventory().adds(I.LEATHER, 1);
    player.sendMessage(MSG.leatherFound);
  }

  /** Wiki: a needle while unowned, until Elemental Workshop II is done. */
  function searchNeedleCrate(player) {
    if (Bank.owns(player, I.NEEDLE) || questComplete(player, EW2_KEY)) {
      player.sendMessage(MSG.empty);
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return;
    }
    player.getInventory().adds(I.NEEDLE, 1);
    player.sendMessage(MSG.needleFound);
  }

  /** Wiki: a stone bowl while unowned, before Elemental Workshop II (after it the boxes hold needles). */
  function searchBowlBoxes(player) {
    if (questComplete(player, EW2_KEY)) return false;
    if (Bank.owns(player, [I.A_STONE_BOWL, I.A_STONE_BOWL_2])) {
      player.sendMessage(MSG.empty);
      return true;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.getInventory().full();
      return true;
    }
    player.getInventory().adds(I.A_STONE_BOWL, 1);
    player.sendMessage(MSG.bowlFound);
    return true;
  }

  // ==========================================================================
  // The elemental rocks
  // ==========================================================================

  /** Any pickaxe the player can use, as Mining judges them. */
  function hasPickaxe(player) {
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    return request.pickaxe != null;
  }

  function rockLine(variant) {
    const steps = loadTranscripts(api)?.["Earth elemental"]?.variants?.[variant];
    return Array.isArray(steps) ? steps[0]?.npc ?? null : null;
  }

  /** Transcript:Earth elemental's second line: mining while another elemental is attacking the miner. */
  function attackedByElemental(player) {
    const attacker = player.getCombat?.()?.getAttacker?.();
    if (!attacker?.isNpc?.() || attacker.getHitpoints() <= 0 || !api.core.CombatFactory.inCombat(player)) return false;
    return /elemental$/i.test(String(attacker.getCurrentDefinition?.()?.getName?.() ?? ""));
  }

  /**
   * Captured (ticks 430-438): the rock plays its emerge animation on the miner's arrival, and two
   * ticks later it says its line and becomes the level 35 earth elemental (the same NPC), which
   * goes for the miner. Killed, it drops its ore and rock and is back as a rock (NpcDrops, death).
   */
  function mineRock(player, npc) {
    if (!npc || awakeRocks.has(npc) || npc.getNpcTransformationId?.() !== -1) return;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 20) {
      player.sendMessage(MSG.mineLevel);
      return;
    }
    if (!hasPickaxe(player)) {
      player.sendMessage(MSG.noPickaxe);
      return;
    }
    const line = rockLine(attackedByElemental(player)
      ? "attempting-to-mine-while-being-attacked-by-another-elemental"
      : "attempting-to-mine");
    const state = { target: player, rising: ROCK_RISE_TICKS, idle: 0, line };
    awakeRocks.set(npc, state);
    animate(npc, ANIM.rockEmerge);
    npc.getMovementQueue().reset();
    npc.getMovementQueue().setBlockMovement(true);
  }

  function riseRock(npc, state) {
    const awakeId = NpcIdentifiers.EARTH_ELEMENTAL_2;
    const definition = NpcDefinition.forId(awakeId);
    npc.setNpcTransformationId(awakeId);
    npc.setMaxHitpoints(definition.getHitpoints());
    npc.setHitpoints(definition.getHitpoints());
    if (state.line) npc.forceChat(state.line);
    npc.getMovementQueue().setBlockMovement(false);
    const target = state.target;
    if (target?.isRegistered?.() && target.getHitpoints() > 0) npc.getCombat().attack(target);
  }

  function restRock(npc) {
    awakeRocks.delete(npc);
    npc.setNpcTransformationId(-1);
    npc.setMaxHitpoints(-1);
    npc.setHitpoints(npc.getMaxHitpoints());
    npc.getMovementQueue().setBlockMovement(false);
  }

  function rockTick() {
    for (const [npc, state] of awakeRocks) {
      if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
        awakeRocks.delete(npc);
        continue;
      }
      if (state.rising > 0) {
        if (--state.rising === 0) riseRock(npc, state);
        continue;
      }
      if (api.core.CombatFactory.inCombat(npc)) state.idle = 0;
      else if (++state.idle >= ROCK_REST_TICKS) restRock(npc);
    }
  }

  function startRockTask() {
    TaskManager.submit(new (class ElementalRockTask extends api.core.Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        if (awakeRocks.size > 0) rockTick();
      }
    })());
  }

  function handleNpcDeath({ npc }) {
    awakeRocks.delete(npc);
  }

  // ==========================================================================
  // Event routing
  // ==========================================================================

  function objectOption(event) {
    return String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  function handleObjectInteraction(event) {
    const option = objectOption(event);
    const { player, objectId, location, object } = event;
    const handled = () => { event.handled = true; };

    if (objectId === BOOKCASE && option === "search") return handled(), searchBookcase(player);
    if (ODD_WALLS.includes(objectId) && option === "open") return handled(), openOddWall(player, object, false);
    if (objectId === SURFACE_STAIRS && option === "climb-down") return handled(), climbDown(player);
    if (objectId === WORKSHOP_STAIRS && option === "climb-up") return handled(), climbUp(player);
    if (objectId === LEATHER_CRATE && option === "search") return handled(), searchLeatherCrate(player);
    if (objectId === NEEDLE_CRATE && option === "search") return handled(), searchNeedleCrate(player);
    if (objectId === BOWL_BOXES && option === "search") {
      if (searchBowlBoxes(player)) handled();
      return;
    }
    if ((objectId === WATER_CONTROL_EAST || objectId === WATER_CONTROL_WEST || WATER_CONTROL_CHILDREN.includes(objectId))
      && option === "turn") return handled(), turnValve(player, objectId, location);
    if (objectId === WATER_LEVER && option === "pull") return handled(), pullWaterLever(player, object);
    if (BELLOWS.includes(objectId) && option === "fix") return handled(), fixBellows(player);
    if (objectId === AIR_LEVER && option === "pull") return handled(), pullAirLever(player, object);
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId, object, itemSlot } = event;
    if (ODD_WALLS.includes(objectId)) {
      event.handled = true;
      if (itemId === I.BATTERED_KEY) openOddWall(player, object, true);
      else player.sendMessage(MSG.wallWrongItem);
      return;
    }
    if (LAVA_TROUGHS.includes(objectId) && itemId === I.A_STONE_BOWL) {
      event.handled = true;
      fillBowl(player);
      return;
    }
    if (FURNACES.includes(objectId)) {
      if (useOnFurnace(player, itemId)) event.handled = true;
      return;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(I.BATTERED_BOOK)) return;
    const usedIsBook = event.usedItemId === I.BATTERED_BOOK;
    const other = usedIsBook ? event.usedWithItemId : event.usedItemId;
    const bookSlot = usedIsBook ? event.usedItemSlot : event.usedWithItemSlot;
    event.handled = true;
    if (other === I.BATTERED_BOOK) return;
    if (!cutsBook(other)) {
      player.sendMessage(MSG.dontDamage);
      return;
    }
    cutBook(player, bookSlot);
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (![I.BATTERED_BOOK, I.SLASHED_BOOK].includes(event.itemId) || option !== "read") return;
    event.handled = true;
    readBook(event.player);
  }

  function handleNpcInteraction(event) {
    if (event.npcId !== NpcIdentifiers.ELEMENTAL_ROCK) return;
    const action = (event.definition?.getActions?.() ?? [])[event.clickType - 1];
    if (String(action).toLowerCase() !== "mine") return;
    event.handled = true;
    mineRock(event.player, event.npc);
  }

  function handleLogin({ player }) {
    // Login replay of the machine bits; the status varbit is re-sent by QuestRuntime.sendQuestVarps.
    syncMachine(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "elemental_workshop_i",
    name: "Elemental Workshop I",
    varbitId: VARBIT_QUEST_STATUS,
    // Existing durable bitfield saves keep their meaning; only the wire is mapped.
    varbitValue(stage) {
      if (stage >= BIT.finished) return 2;
      return stage !== 0 ? 1 : 0;
    },
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 5000, label: "Crafting" },
      { skillId: Skill.SMITHING.getIndex(), amount: 5000, label: "Smithing" },
    ],
    // The shield is the one just made; the scroll only shows it (tick 518).
    scrollItemId: I.ELEMENTAL_SHIELD,
    otherRewards: ["Ability to make Elemental", "Shields"],
    buildJournal,
    onReward: grantReward,
  });

  api.onServerStartup(startRockTask);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("elemental-workshop-i:shield-made", shieldMade);
  api.onPlayerLogout(finishOnLogout);

  return { _test: { BIT, MSG, awakeRocks, rockTick, BOOK_PAGES } };
};
