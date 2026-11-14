/**
 * The Fremennik Trials: the Seer's trial (Peer the Seer's house puzzle).
 *
 * Captures: 1002236 (rev 242) t9725-10290 and 1001646 (rev 241) t2880-3460; facts and gap list in
 * docs/fremennik-trials.md. Live keeps all puzzle state on the server: no varbit changes in the
 * house, only `viking` 7 -> 8 when the player leaves by the exit door with the key.
 *
 * - Peer: the trial offer, the bank spell (-sJh9n, -rbFGl) and his "again"/"done" lines. He is
 *   also on Sigmund's trading chain; the Merchant unit answers those variants first.
 * - The entrance door (viking_seers_door1): the riddle plaque and the seer_combolock wheels; once
 *   solved, the door lets an empty-handed player in. Leaving by it from inside: the Wiki's
 *   warning box, and the house items are gone.
 * - Inside (x 2629-2638, y 3659-3666, planes 0 and 2): ladders, trapdoors, cupboard and chests
 *   open and shut for this player only, the heads, mural, water, scales, vase and key.
 * - The exit door (viking_seers_door2) with the key: the key and the other house items go, the
 *   trial passes and Peer says so.
 */
module.exports = function attachFremennikTrialsSeer(api, ctx) {
  const { Location, GameObject, ObjectManager, ObjectIdentifiers: O, NpcIdentifiers, Animation, Bank, CacheDefinitions } = api.core;
  const { T, FLAG, NPC, I, held, give, take, swapInSlot, trialState, setTrialState, flag, setFlag } = ctx;

  const V = {
    menu: "the-council-members-peer-the-seer",
    trial: "the-council-members-peer-the-seer-s-trial",
    again: "the-council-members-peer-the-seer-s-trial-talking-to-peer-the-seer-again",
    done: "the-council-members-peer-the-seer-s-trial-talking-to-peer-the-seer-again-2",
    unlock: "the-council-members-peer-the-seer-s-trial-unlocking-the-door",
  };
  /** Peer's own page: his line for a player who tries his door before the quest (data/Wiki only). */
  const PEER_PAGE = "Peer the Seer";
  const PEER_DOOR_VARIANT = "standard-dialogue-before-starting-the-fremennik-trials-when-attempting-to-open-the-front-door-of-peer-s-house";
  const BANK_STEPS = new Set(["-sJh9n", "-rbFGl"]);

  // ---- the entrance lock ------------------------------------------------------------------------
  // A combination lock (seer_combolock, an if1 modal) under a riddle plaque. Flow, texts, wheels and
  // messages from rsprox 1001646 (rev 241, ticks 2931-3101) and 1002236 (rev 242, ticks 9896-10024).
  const SEER_RIDDLE_ATTRIBUTE = "quest.fremennik_trials.seer_riddle";
  const SEER_LOCK_GROUP = 298;
  const SEER_LOCK_LETTERS = [43, 44, 45, 46];
  // seera_left/right .. seerd_left/right -> [wheel, step]; left goes back a letter (A to Z).
  const SEER_LOCK_ARROWS = new Map([
    [47, [0, -1]], [48, [0, 1]], [49, [1, -1]], [50, [1, 1]],
    [51, [2, -1]], [52, [2, 1]], [53, [3, -1]], [54, [3, 1]],
  ]);
  const SEER_LOCK_ENTER = 56;
  const SCRIPT_MAINMODAL_OPEN = 2524;
  const SEER_LOCK_TEXT =
    "There is a combination lock on this door. Above the lock you can see<br>that there is a metal plaque with a riddle on it.";
  // The plaque's six riddles. MIND and WIND are as the captures show them; the others are the
  // Wiki's "Transcript:The Fremennik Trials", except FIRE, whose transcript lines repeat the
  // sea and the mountains, so its lines are from the quest page's riddle table.
  const SEER_RIDDLES = [
    { answer: "LIFE", pages: [
      "My first is in the well, but not at sea.<br>My second in 'I', but not in 'me'.<br>My third is in flies, but insects not found.<br>My last is in earth, but not in the ground.",
      "My whole when stolen from you, causes you death.<br>What am I?",
    ] },
    { answer: "TIME", pages: [
      "My first is in water, and also in tea.<br>My second in fish, but not in the sea.<br>My third in mountains, but not underground.<br>My last is in strike, but not in pound.",
      "My whole crushes mountains, drains rivers, and destroys civilisations.<br>All that live fear my passing.<br>What am I?",
    ] },
    { answer: "MIND", pages: [
      "My first is in mage, but not in wizard.<br>My second in goblin, and also in lizard.<br>My third is in night, but not in the day.<br>My last is in fields, but not in the hay.",
      "My whole is the most powerful tool you will ever possess.<br>What am I?",
    ] },
    { answer: "TREE", pages: [
      "My first is in tar, but not in a swamp.<br>My second in fire, but not in a camp.<br>My third is in eagle, but never in air.<br>My last is in hate, but also in care.",
      "My whole wears rings the older I get.<br>What am I?",
    ] },
    { answer: "FIRE", pages: [
      "My first is in fish, but not in the sea.<br>My second in birds, but not in a tree.<br>My third is in doors, but not in a hall.<br>My last is everything, but nothing at all.",
      "My whole cannot die as long as it has food.<br>What am I?",
    ] },
    { answer: "WIND", pages: [
      "My first is in wizard, but not in a mage.<br>My second in jail, but not in a cage.<br>My third is in anger, but not in a rage.<br>My last in a drawing, but not on a page.",
      "My whole helps to make bread, let birds fly and boats sail.<br>What am I?",
    ] },
  ];
  /** The wheels of each player's open lock, as letter indexes (0 is A). */
  const seerLocks = new WeakMap();

  // ---- the house ---------------------------------------------------------------------------------
  /** The interior: plane 0 (two rooms split by a wall at x=2634) and the puzzle floor, plane 2. */
  const HOUSE = { minX: 2629, maxX: 2638, minY: 3659, maxY: 3666, levels: [0, 2] };
  const PUZZLE_FLOOR = 2;
  /** The house's south-facing front: the doors stand on y 3667, the tile just inside is y 3666. */
  const DOOR_Y = 3667;
  const INSIDE_Y = 3666;
  const ENTRANCE_X = 2631;
  const EXIT_X = 2636;

  const LOC_INVISWALL = CacheDefinitions.getLocId("inviswall"); // 38848
  const LOC_DOOR_INACTIVE = CacheDefinitions.getLocId("viking_door_inactive"); // 4249
  /** The open leaf stands just inside, a plain wall turned west-facing (shape 0 rot 0). */
  const LEAF_TYPE = 0;
  const LEAF_FACE = 0;
  const DOOR_OPEN_TICKS = 2;

  const SEQ_LADDER = 828; // human_reachforladder
  const SEQ_OPEN_CUPBOARD = 542; // human_openhighcupboard
  const SEQ_CLOSE_CUPBOARD = 541; // human_closehighcupboard
  const SEQ_OPEN_CHEST = 536; // human_openchest
  const SEQ_CLOSE_CHEST = 535; // human_closechest
  const SEQ_POUR = 1077; // throw_bucketofwater
  const SYNTH_DOOR_OPEN = 62; // door_open
  const SYNTH_CUPBOARD_OPEN = 58; // cupboard_open
  const SYNTH_CUPBOARD_CLOSE = 57; // cupboard_close
  const SYNTH_CHEST_OPEN = 52; // chest_open
  const SYNTH_CHEST_CLOSE = 51; // chest_close
  const SYNTH_POUR = 1733; // holy_water_pour
  const MURAL_INTERFACE = 376; // viking_mural
  /** "You search the X..." and the find line are four ticks apart (1002236 t10042 -> t10046). */
  const SEARCH_TICKS = 4;
  const IGNORE_CLIPPING_FLAG = api.core.MovementQueue?.IGNORE_CLIPPING_FLAG ?? "movement:ignore-clipping";

  const BUCKET_UNITS = new Map([
    [I.EMPTY_BUCKET, 0], [I._1_5THS_FULL_BUCKET, 1], [I._2_5THS_FULL_BUCKET, 2],
    [I._3_5THS_FULL_BUCKET, 3], [I._4_5THS_FULL_BUCKET, 4], [I.FULL_BUCKET, 5],
  ]);
  const JUG_UNITS = new Map([[I.EMPTY_JUG, 0], [I._1_3RDS_FULL_JUG, 1], [I._2_3RDS_FULL_JUG, 2], [I.FULL_JUG, 3]]);
  const BUCKET_BY_UNITS = [I.EMPTY_BUCKET, I._1_5THS_FULL_BUCKET, I._2_5THS_FULL_BUCKET, I._3_5THS_FULL_BUCKET,
    I._4_5THS_FULL_BUCKET, I.FULL_BUCKET];
  const JUG_BY_UNITS = [I.EMPTY_JUG, I._1_3RDS_FULL_JUG, I._2_3RDS_FULL_JUG, I.FULL_JUG];
  const BUCKET_CAPACITY = 5;
  const JUG_CAPACITY = 3;
  /** The scales balance a bucket four-fifths full (1002236 t10204). */
  const BALANCING_UNITS = 4;
  const VASE_ITEMS = [I.VASE_2, I.VASE_OF_WATER, I.FROZEN_VASE, I.SEALED_VASE, I.SEALED_VASE_2, I.SEALED_VASE_3,
    I.FROZEN_KEY, I.SEERS_KEY];
  /** Everything the house hands out; none of it leaves (1002236 t10267: the key and a jug go). */
  const HOUSE_ITEMS = [
    ...BUCKET_UNITS.keys(), I.FROZEN_BUCKET, ...JUG_UNITS.keys(), I.FROZEN_JUG, ...VASE_ITEMS, I.VASE_LID,
    I.RED_HERRING, I.STICKY_RED_GOOP, I.STICKY_RED_GOOP_2, I.OLD_RED_DISK, I.WOODEN_DISK, I.RED_DISK_3,
    I.MAGNET_2, I.BLUE_THREAD, I.SMALL_PICK, I.TOY_SHIP,
  ];

  const LOC = {
    WEST_LADDER: O.LADDER_35, // 4163 viking_seer_up_ladder
    EAST_LADDER: O.LADDER_36, // 4164 viking_seer_down_ladder
    ENTRANCE: O.DOOR_119, // 4165 viking_seers_door1
    EXIT: O.DOOR_120, // 4166 viking_seers_door2
    CHEST: O.CHEST_31, // 4167
    CHEST_OPEN: O.CHEST_32, // 4168
    FROZEN_TABLE: O.FROZEN_TABLE, // 4169
    SCALES: O.CHEST_33, // 4170
    BOOKCASE: O.BOOKCASE_14, // 4171
    RANGE: O.COOKING_RANGE_2, // 4172
    TRAPDOOR_OPEN: O.TRAPDOOR_14, // 4173
    TRAPDOOR: O.TRAPDOOR_15, // 4174
    DRAIN: O.DRAIN, // 4175
    TAP: O.TAP, // 4176
    CUPBOARD: O.CUPBOARD_27, // 4177
    CUPBOARD_OPEN: O.CUPBOARD_28, // 4178
    MURAL: O.ABSTRACT_MURAL, // 4179
    UNICORN: O.UNICORNS_HEAD_2, // 4181
    BULL: O.BULLS_HEAD_2, // 4182
    BOXES: O.BOXES_9, // 4183 viking_seerboxes_1
    BOXES_2: O.BOXES_10, // 4184
    CRATE: O.CRATE_38, // 4185
    CRATE_2: O.CRATE_39, // 4186
  };
  /**
   * The puzzle floor's boxes and crates (Wiki transcript, "the puzzle room"). Ours: which pile the
   * Wiki's compass words mean; none is captured. Keyed by "id" or "id@x" (two piles share 4183).
   */
  const PILE_FINDS = new Map([
    [`${LOC.BOXES}@2633`, { item: I.MAGNET_2, text: "You find a magnet hidden inside." }],
    [`${LOC.BOXES}@2636`, null],
    [`${LOC.CRATE_2}`, { item: I.TOY_SHIP, text: "You find a toy ship hidden inside." }],
    [`${LOC.CRATE}`, { item: I.SMALL_PICK, text: "You find a small pick hidden inside." }],
    [`${LOC.BOXES_2}`, { item: I.BLUE_THREAD, text: "You find some thread hidden inside." }],
  ]);
  const PILES = new Set([LOC.BOXES, LOC.BOXES_2, LOC.CRATE, LOC.CRATE_2]);
  /** Locs that open and shut for one player, with their open form and the anim/sound each way. */
  const OPENERS = new Map([
    [LOC.CUPBOARD, { open: LOC.CUPBOARD_OPEN, seq: SEQ_OPEN_CUPBOARD, synth: SYNTH_CUPBOARD_OPEN }],
    [LOC.CHEST, { open: LOC.CHEST_OPEN, seq: SEQ_OPEN_CHEST, synth: SYNTH_CHEST_OPEN }],
  ]);
  const CLOSERS = new Map([
    [LOC.CUPBOARD_OPEN, { shut: LOC.CUPBOARD, seq: SEQ_CLOSE_CUPBOARD, synth: SYNTH_CUPBOARD_CLOSE }],
    [LOC.CHEST_OPEN, { shut: LOC.CHEST, seq: SEQ_CLOSE_CHEST, synth: SYNTH_CHEST_CLOSE }],
  ]);

  /** Per player: the locs swapped for them only, by tile ({ base, current }). */
  const privateLocs = new WeakMap();

  const TEXT = {
    locked: "This door is locked tightly shut.",
    mustBank: "You must bank all your items and equipment before entering Peer's house.",
    leaveWarning: "If you leave by this door you will fail this trial. Press continue to go through the door anyway.",
    unlock: "You unlock the door with your key.",
    passed: "You have successfully completed the Seer's Trial.",
    trapdoorOpens: "The trapdoor opens...",
    searchCupboard: "You search the cupboard...",
    searchChest: "You search the chest...",
    searchBookcase: "You search the bookcase...",
    searchBoxes: "You search the boxes...",
    nothing: "You find nothing of interest.",
    bucket: "You find a bucket with a number five painted on it.",
    jug: "You find a jug with a number three painted on it.",
    herring: "Hidden behind some old books, you find a red herring.",
    unicorn: "You notice there is something unusual about the left eye of this<br>unicorn head...",
    unicornTake: "It is not an eye at all, but some kind of red coloured disk. You take<br>it from the head.",
    unicornAgain: "It's unusual because you removed it already!",
    bull: "You notice there is something unusual about the right eye of this<br>bulls' head...",
    bullTake: "It is not an eye at all, but some kind of disk made of wood. You<br>take it from the head.",
    bullAgain: "It's unusual because you've already taken it!", // Wiki (iHkvxX)
    bullHole: "There is a hole in this bull head where a right eye should be.",
    muralStudy: "You study the mural... it appears to be missing something...",
    muralDisk: "You put the red disk into the empty hole on the mural.",
    muralFit: "It is a perfect fit!",
    muralDone: "The center of the mural falls out!",
    muralWooden: "You put the wooden disk into the empty hole in the mural.", // Wiki
    muralWoodenOut: "It is slightly too small, and falls back out.", // Wiki
    herringCooked: "As you cook the herring on the stove, the colouring on it peels off<br>separately as a red sticky goop...",
    coat: "You coat the wooden coin with the sticky red goop.",
    scalesLocked: "This chest is securely locked shut. There is some kind of balance attached to the lock, and a number four is painted just above it.", // Wiki
    tooLight: "It is too light to balance it properly.", // Wiki
    tooHeavy: "It is too heavy to balance it properly.", // Wiki
    balances: "It is a perfect counterweight and balances precisely.",
    vaseOut: "You take a strange looking vase out of the chest.",
    shake: "You shake the strangely shaped Vase. From the sound of it there is<br>something metallic inside, but the neck of the vase is too narrow for<br>it to come out.",
    shakeWater: "You shake the strangely shaped Vase. The water inside it sloshes around a little. Some spills out of the neck of the vase.", // Wiki
    shakeFrozen: "You shake the strangely shaped Vase. Whatever is at the bottom of it is packed with ice and does not rattle.", // Wiki
    vaseFill: "You fill the strange looking vase with water.",
    vaseEmpty: "You empty the strange looking vase of water.", // Wiki
    vaseAlreadyEmpty: "The vase is already empty.", // Wiki
    lid: "You screw the lid on tightly.",
    lidIce: "The ice prevents you screwing on the lid.", // Wiki
    shatter: "The water expands as it freezes, and shatters the vase.",
    keyInIce: "You are left with a key encased in ice.",
    melt: "The heat of the range melts the ice around the key.",
    vaseCold: "Your empty vase gets very cold on the icy table.", // Wiki
    vaseFreezes: "The icy table immediately freezes the water in your vase.", // Wiki
    vaseSteam: "You place the frozen vase on the range. The ice turns to steam.", // Wiki
    magnetChest: "You use the magnet on the chest. The scale wobbles a bit.", // Wiki
    magnetVase: "You use the magnet on the vase. The metallic object inside moves.", // Wiki
    magnetVase2: "The neck of the vase is too thin for the object to come out of the vase.", // Wiki
    magnetTable: "You use the magnet on the table. It gets slightly colder.", // Wiki
    magnetTap: "You use the magnet on the tap. It gets a bit wet.", // Wiki
    pickChest: "You might be able to break the chest open using this pick...", // Wiki
    pickChest2: "...if you stood here tapping at it for twenty years or so.", // Wiki
    pickVase: "This pick wouldn't be strong enough to break the vase open.", // Wiki
    shipVase: "It wouldn't fit in there!", // Wiki
  };

  const isPeer = (npcId) => NPC.PEER.has(npcId);
  const at = (player) => player.getLocation();
  const inHouse = (player) => {
    const location = at(player);
    return HOUSE.levels.includes(location.getZ()) && ctx.inBox(player, HOUSE.minX, HOUSE.maxX, HOUSE.minY, HOUSE.maxY);
  };
  const vessel = (itemId) => BUCKET_UNITS.has(itemId) ? "bucket" : JUG_UNITS.has(itemId) ? "jug" : null;
  const units = (itemId) => BUCKET_UNITS.get(itemId) ?? JUG_UNITS.get(itemId);
  const heldAny = (player, ids) => ids.some((id) => held(player, id));
  const bucketKinds = [...BUCKET_UNITS.keys(), I.FROZEN_BUCKET];
  const jugKinds = [...JUG_UNITS.keys(), I.FROZEN_JUG];

  // ---- Peer's dialogue ---------------------------------------------------------------------------

  function peerVariant(player, stage) {
    if (trialState(player, T.SEER) === 2) return V.done;
    if (stage >= ctx.STAGE_STARTED) return trialState(player, T.SEER) === 1 ? V.again : V.menu;
    return null;
  }

  function peerOffer(player) {
    const state = trialState(player, T.SEER);
    return state === 2 ? V.done : state === 1 ? V.again : V.trial;
  }

  function peerCondition({ player, npcId, value }) {
    if (!isPeer(npcId)) return null;
    if (value.includes("bank is full") || value.includes("unbankable")) return false;
    if (value.includes("bank is not full")) return true;
    if (value.includes("does not have any items in their inventory")) return !ctx.carryingAnything(player);
    if (value.includes("has items in their inventory")) return ctx.carryingAnything(player);
    if (value.includes("solves the riddle") || value.includes("enters the correct code")) return flag(player, FLAG.SEER_RIDDLE);
    return null;
  }

  /** "Yes" to Peer's challenge starts the trial. */
  function acceptTrial(event, text) {
    const { player, npcId } = event;
    if (!isPeer(npcId) || (text !== "yes" && text !== "yes.")) return;
    const pages = event.pages;
    if (Array.isArray(pages) && !pages.some((page) => page.variants?.includes(V.trial))) return;
    if (trialState(player, T.SEER) === 0) setTrialState(player, T.SEER, 1);
  }

  /** The bank spell: inventory and worn items go to the bank (1002236 t9888, 1001646 t2926). */
  function bankSpell(event) {
    if (!isPeer(event.npcId)) return;
    const { player } = event;
    Bank.depositItems(player, player.getInventory(), true);
    Bank.depositItems(player, player.getEquipment(), true);
  }

  /** The first-talk menu holding Peer's bank spell (its "Yes" runs deposit step -sJh9n). */
  function peerBankMenu(steps) {
    for (const step of steps ?? []) {
      if (step.options?.some((option) => option.steps?.some((entry) => entry.id === "-sJh9n"))) return [step];
      for (const option of step.options ?? []) {
        const found = peerBankMenu(option.steps);
        if (found) return found;
      }
    }
    return undefined;
  }

  /**
   * Talking to Peer again while carrying items: the dump lost the targets of the offer's
   * Yes/No ({{tact|above}}, Peer's first-talk bank menu), so they fell back to Brundt's
   * unrelated "Yes"/"No" and never banked anything. Replay that menu after the offer line.
   */
  function offerPeerBankAgain(event) {
    if (!isPeer(event.npcId) || !/perform this small spell upon you/i.test(String(event.text ?? ""))) return;
    const { player, npcId } = event;
    event.after = () => ctx.play(player, npcId, V.trial, peerBankMenu);
  }

  // ---- message boxes ------------------------------------------------------------------------------

  /** Message boxes one after another, then `then` once the last is continued. */
  function mesboxes(player, pages, then = () => {}) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder();
    pages.forEach((text, index) => chain.add(new StatementDialogue(index, text)));
    chain.add(new ActionDialogue(pages.length, { execute() { player.getDialogueManager().reset(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  // ---- the entrance lock ---------------------------------------------------------------------------

  /**
   * The riddle on a player's plaque. Ours: it is rolled once and kept, as no recording shows how
   * live picks it; rsprox 1001646 read the same riddle three times over 100 ticks.
   */
  function seerRiddle(player) {
    let index = ctx.readAttribute(player, SEER_RIDDLE_ATTRIBUTE);
    if (index < 1 || index > SEER_RIDDLES.length) {
      index = 1 + Math.floor(Math.random() * SEER_RIDDLES.length);
      player.setAttribute(SEER_RIDDLE_ATTRIBUTE, index);
    }
    return SEER_RIDDLES[index - 1];
  }

  /** The plaque's message box and its menu (rsprox 1001646 ticks 2931-2941). */
  function showSeerLock(player) {
    const door = at(player);
    const stillAtDoor = () => trialState(player, T.SEER) === 1 && at(player).equals(door);
    mesboxes(player, [SEER_LOCK_TEXT], () => {
      if (!stillAtDoor()) return;
      api.sendMultiChatboxPrompt(player, "What would you like to do?",
        "Read the riddle", () => mesboxes(player, seerRiddle(player).pages, () => {
          if (stillAtDoor()) openSeerLock(player);
        }),
        "Solve the riddle", () => { if (stillAtDoor()) openSeerLock(player); },
        "Forget it", () => player.sendMessage("You leave the riddle for later."));
    });
  }

  /** Opens the combination lock with every wheel on A. */
  function openSeerLock(player) {
    const wheels = [0, 0, 0, 0];
    seerLocks.set(player, wheels);
    const sender = player.getPacketSender();
    SEER_LOCK_LETTERS.forEach((child, index) => sender.sendString(seerLetter(wheels[index]), (SEER_LOCK_GROUP << 16) | child));
    sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, -1, -1);
    sender.sendInterface(SEER_LOCK_GROUP);
  }

  const seerLetter = (index) => String.fromCharCode(65 + index);

  function clickSeerLock(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== SEER_LOCK_GROUP) return;
    event.handled = true;
    const wheels = seerLocks.get(player);
    if (!wheels || player.getInterfaceId() !== SEER_LOCK_GROUP) return;
    const child = buttonId & 0xffff;
    const arrow = SEER_LOCK_ARROWS.get(child);
    if (arrow) {
      const [wheel, step] = arrow;
      wheels[wheel] = (wheels[wheel] + step + 26) % 26;
      player.getPacketSender().sendString(seerLetter(wheels[wheel]), (SEER_LOCK_GROUP << 16) | SEER_LOCK_LETTERS[wheel]);
      return;
    }
    if (child !== SEER_LOCK_ENTER) return;
    seerLocks.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    if (trialState(player, T.SEER) !== 1) return;
    if (wheels.map(seerLetter).join("") !== seerRiddle(player).answer) {
      player.sendMessage("You have failed to solve the riddle.");
      return;
    }
    setFlag(player, FLAG.SEER_RIDDLE);
    player.sendMessage("You have solved the riddle!");
  }

  // ---- private locs ----------------------------------------------------------------------------------

  const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

  /** Shows `object`'s tile as `toId` for this player only (a loc_add_change for them alone). */
  function swapLoc(player, object, toId) {
    let locs = privateLocs.get(player);
    if (!locs) privateLocs.set(player, locs = new Map());
    const key = tileKey(object.getLocation());
    const entry = locs.get(key);
    const base = entry?.base ?? object;
    if (entry) ObjectManager.deregister(entry.current, true);
    if (toId === base.getId()) {
      locs.delete(key);
      player.getPacketSender().sendObject(base);
      return;
    }
    const current = new GameObject(toId, base.getLocation().clone(), base.getType(), base.getFace(), null).setOwner(player);
    ObjectManager.register(current, true);
    locs.set(key, { base, current });
  }

  /** Puts every loc back as the map has it (the player left; `quiet` when they logged out). */
  function resetLocs(player, quiet = false) {
    const locs = privateLocs.get(player);
    if (!locs) return;
    privateLocs.delete(player);
    for (const { base, current } of locs.values()) {
      ObjectManager.deregister(current, true);
      if (!quiet) player.getPacketSender().sendObject(base);
    }
  }

  // ---- doors --------------------------------------------------------------------------------------

  /** Ticks the doorway's clipping stays set aside at most, should the step never be taken. */
  const STEP_TICKS = 3;

  /**
   * One walked step with the doorway's clipping set aside (the door is an inviswall for it now).
   * The world moves players before it reads their clicks, so the step is taken a tick after this
   * one: the clipping comes back once the player stands on the tile (or after STEP_TICKS).
   */
  function stepTo(player, destination) {
    const already = player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true;
    if (!already) player.setFlag(IGNORE_CLIPPING_FLAG, true);
    player.getMovementQueue().reset();
    player.getMovementQueue().addSteps(destination);
    if (already) return;
    let waited = 0;
    const restore = () => {
      if (!at(player).equals(destination) && ++waited < STEP_TICKS) {
        ctx.later(player, 1, restore);
        return;
      }
      player.removeFlag(IGNORE_CLIPPING_FLAG);
    };
    ctx.later(player, 1, restore);
  }

  /**
   * Walks the player through a front door, as both doors play it (1002236 t10024 in, t10267 out):
   * the doorway becomes an inviswall, the open leaf (viking_door_inactive) stands just inside,
   * door_open sounds and the player steps one tile; two ticks later the door is back.
   */
  function passDoor(player, door, goingIn) {
    const doorTile = door.getLocation();
    const inside = new Location(doorTile.getX(), INSIDE_Y, doorTile.getZ());
    const from = goingIn ? doorTile : inside;
    const to = goingIn ? inside : doorTile;
    if (!at(player).equals(from)) player.moveTo(from.clone());
    const sender = player.getPacketSender();
    const leaf = new GameObject(LOC_DOOR_INACTIVE, inside.clone(), LEAF_TYPE, LEAF_FACE, null);
    sender.sendObject(new GameObject(LOC_INVISWALL, doorTile.clone(), door.getType(), door.getFace(), null));
    sender.sendObject(leaf);
    sender.sendSound(SYNTH_DOOR_OPEN, 1, 0);
    stepTo(player, to.clone());
    ctx.later(player, DOOR_OPEN_TICKS, () => {
      sender.sendObject(door);
      sender.sendObjectRemoval(leaf);
    });
  }

  /** Inside the house at the front wall's inner row (the doors are on y 3667). */
  const insideAtDoors = (player) => inHouse(player) && at(player).getZ() === 0 && at(player).getY() <= INSIDE_Y;

  function entranceDoor(event) {
    const { player, object } = event;
    if (insideAtDoors(player)) {
      leaveByEntrance(player, object);
      return;
    }
    if (ctx.quest.getStage(player) < ctx.STAGE_STARTED) {
      // Data/Wiki only: Peer shouts at a player who tries his door before the quest.
      const peer = [...NPC.PEER][0];
      api.emitCustomEvent("npc-dialogue:start", { player, npcId: peer, variant: { page: PEER_PAGE, variant: PEER_DOOR_VARIANT } });
      return;
    }
    if (trialState(player, T.SEER) !== 1) {
      player.sendMessage(TEXT.locked);
      return;
    }
    if (ctx.carryingAnything(player)) {
      player.sendMessage(TEXT.mustBank);
      return;
    }
    if (flag(player, FLAG.SEER_RIDDLE)) {
      // Solved: the door lets the player in (rsprox 1001646 t3101, 1002236 t10024).
      passDoor(player, object, true);
      return;
    }
    showSeerLock(player);
  }

  /**
   * Leaving by the entrance from inside (Wiki uvFMwf, no capture): the warning box; Continue loses
   * the house items and walks out, anything else (the box closed) resumes the puzzle. Ours: the
   * riddle has to be solved again, as the quest page says parts must be done over.
   */
  function leaveByEntrance(player, door) {
    const standing = at(player).clone();
    mesboxes(player, [TEXT.leaveWarning], () => {
      if (!at(player).equals(standing)) return;
      stripHouseItems(player);
      setFlag(player, FLAG.SEER_RIDDLE, false);
      resetLocs(player);
      passDoor(player, door, false);
    });
  }

  function exitDoor(event) {
    const { player, object } = event;
    if (!insideAtDoors(player)) {
      player.sendMessage(TEXT.locked);
      return;
    }
    if (!held(player, I.SEERS_KEY) || trialState(player, T.SEER) !== 1) {
      // 1001646 t3216.
      player.sendMessage(TEXT.locked);
      return;
    }
    unlockExit(player, object);
  }

  /**
   * The key opens the exit (1002236 t10267-10269, 1001646 t3433-3435): on one tick the unlock
   * line, the door animation and the step out, with the key and every other house item taken
   * (a plain herring stays); the next tick the trial passes, its message and Peer's line.
   */
  function unlockExit(player, door) {
    player.sendMessage(TEXT.unlock);
    stripHouseItems(player);
    resetLocs(player);
    passDoor(player, door, false);
    // The vote is saved with the key gone, so a logout on the next tick cannot lose both (Ours:
    // live moves viking a tick later, with the message, 1002236 t10268).
    if (!ctx.completeTrial(player, T.SEER)) return;
    ctx.later(player, 1, () => {
      player.sendMessage(TEXT.passed);
      const peer = [...NPC.PEER][0];
      ctx.play(player, peer, V.unlock, (steps) => steps.filter((step) => step.type === "line"));
    });
  }

  // ---- ladders and trapdoors ------------------------------------------------------------------------

  /** Both ladders climb straight to the puzzle floor (1002236 t10030-10031, t10153-10154). */
  function climbUp(player) {
    const location = at(player);
    player.performAnimation(new Animation(SEQ_LADDER));
    ctx.later(player, 1, () => player.moveTo(new Location(location.getX(), location.getY(), PUZZLE_FLOOR)));
  }

  /** Down through an open trapdoor: no animation (1001646 t3206 -> t3207). */
  function climbDown(player) {
    const location = at(player);
    ctx.later(player, 1, () => {
      if (at(player).getZ() !== PUZZLE_FLOOR) return;
      player.moveTo(new Location(location.getX(), location.getY(), 0));
    });
  }

  /** The east trapdoor opens for this player (1002236 t10128); it stays open until they leave. */
  function openTrapdoor(player, object) {
    player.sendMessage(TEXT.trapdoorOpens);
    swapLoc(player, object, LOC.TRAPDOOR_OPEN);
    player.getPacketSender().sendSound(SYNTH_DOOR_OPEN, 1, 0);
  }

  /** Ours: Close shuts it for this player again (no capture), as Open opened it. */
  function closeTrapdoor(player, object) {
    swapLoc(player, object, LOC.TRAPDOOR);
  }

  // ---- cupboard, chests, bookcases, piles ------------------------------------------------------------

  /** Open: the anim and sound, then the open loc a tick later (1002236 t10036-10037). */
  function openLoc(player, object, opener) {
    player.performAnimation(new Animation(opener.seq));
    player.getPacketSender().sendSound(opener.synth, 1, 0);
    ctx.later(player, 1, () => { if (inHouse(player)) swapLoc(player, object, opener.open); });
  }

  /** Shut/Close, the same way back (1001646 t3243-3244, t3267). */
  function shutLoc(player, object, closer) {
    player.performAnimation(new Animation(closer.seq));
    player.getPacketSender().sendSound(closer.synth, 1, 0);
    ctx.later(player, 1, () => { if (inHouse(player)) swapLoc(player, object, closer.shut); });
  }

  /** "You search the X...", then four ticks later the find, or nothing (1002236 t10042-10046). */
  function search(player, opening, find) {
    player.sendMessage(opening);
    ctx.later(player, SEARCH_TICKS, () => {
      if (!inHouse(player)) return;
      const found = find?.();
      if (found) give(player, found.item);
      player.sendMessage(found ? found.text : TEXT.nothing);
    });
  }

  /** The cupboard's bucket: again while holding one, nothing. Ours: a lost bucket can be found again. */
  function searchCupboard(player) {
    search(player, TEXT.searchCupboard, () => heldAny(player, bucketKinds) ? null : { item: I.EMPTY_BUCKET, text: TEXT.bucket });
  }

  /**
   * The south chest (2635,3660) holds the jug (1002236 t10091); the east one nothing (Wiki RoO9fF).
   * Ours: which chest the Wiki means; a lost jug can be found again.
   */
  function searchChest(player, object) {
    const jugChest = object.getLocation().getX() === JUG_CHEST_X;
    search(player, TEXT.searchChest, () => !jugChest || heldAny(player, jugKinds) ? null : { item: I.EMPTY_JUG, text: TEXT.jug });
  }
  const JUG_CHEST_X = 2635;

  /** Both bookcases hide the herring (1002236 at 2635,3665; 1001646 at 2634,3665). */
  function searchBookcase(player) {
    search(player, TEXT.searchBookcase, () =>
      heldAny(player, [I.RED_HERRING, I.STICKY_RED_GOOP]) ? null : { item: I.RED_HERRING, text: TEXT.herring });
  }

  /** The red-herring piles (Wiki only). Swensen's boxes next door are not part of this. */
  function searchPile(player, object) {
    const id = object.getId();
    const key = PILE_FINDS.has(`${id}@${object.getLocation().getX()}`) ? `${id}@${object.getLocation().getX()}` : String(id);
    const find = PILE_FINDS.get(key);
    search(player, TEXT.searchBoxes, () => !find || held(player, find.item) ? null : find);
  }

  // ---- heads and mural ---------------------------------------------------------------------------

  /**
   * The heads' eyes (1002236 t10050-10055, t10063; 1001646 t3125, t3143, t3259): two message boxes,
   * the disk given as the second opens. Again while holding it: the first box, then a game message.
   * The bull's again after its disk went into the mural: one box about the hole.
   */
  function studyHead(player, unicorn) {
    if (unicorn) {
      if (held(player, I.OLD_RED_DISK) || flag(player, FLAG.MURAL_OLD_DISK)) {
        mesboxes(player, [TEXT.unicorn], () => player.sendMessage(TEXT.unicornAgain));
        return;
      }
      mesboxes(player, [TEXT.unicorn], () => {
        give(player, I.OLD_RED_DISK);
        mesboxes(player, [TEXT.unicornTake]);
      });
      return;
    }
    if (flag(player, FLAG.MURAL_RED_DISK)) {
      mesboxes(player, [TEXT.bullHole]);
      return;
    }
    if (heldAny(player, [I.WOODEN_DISK, I.RED_DISK_3])) {
      mesboxes(player, [TEXT.bull], () => player.sendMessage(TEXT.bullAgain));
      return;
    }
    mesboxes(player, [TEXT.bull], () => {
      give(player, I.WOODEN_DISK);
      mesboxes(player, [TEXT.bullTake]);
    });
  }

  /** Study: the line and the viking_mural interface (1001646 t3209-3210). */
  function studyMural(player) {
    player.sendMessage(TEXT.muralStudy);
    player.getPacketSender().sendInterface(MURAL_INTERFACE);
  }

  /**
   * A red disk fits (1002236, 1001646, either order): two lines and the disk goes; the second
   * disk's centre falls out and the lid takes its slot. The wooden disk is too small (Wiki).
   */
  function diskOnMural(player, itemId, slot) {
    if (itemId === I.WOODEN_DISK) {
      player.sendMessage(TEXT.muralWooden);
      player.sendMessage(TEXT.muralWoodenOut);
      return true;
    }
    const bit = itemId === I.OLD_RED_DISK ? FLAG.MURAL_OLD_DISK : itemId === I.RED_DISK_3 ? FLAG.MURAL_RED_DISK : -1;
    if (bit < 0 || flag(player, bit)) return false;
    setFlag(player, bit);
    player.sendMessage(TEXT.muralDisk);
    player.sendMessage(TEXT.muralFit);
    if (flag(player, FLAG.MURAL_OLD_DISK) && flag(player, FLAG.MURAL_RED_DISK)) {
      player.sendMessage(TEXT.muralDone);
      swapInSlot(player, itemId, I.VASE_LID, slot);
    } else {
      removeAt(player, itemId, slot);
    }
    return true;
  }

  function removeAt(player, itemId, slot) {
    const inventory = player.getInventory();
    if (Number.isInteger(slot) && inventory.forSlot(slot)?.getId() === itemId) {
      inventory.setItem(slot, new api.core.Item(-1, 0));
      inventory.refreshItems();
      return;
    }
    take(player, itemId);
  }

  // ---- water, scales, vase, key ------------------------------------------------------------------------

  /** The tap fills a bucket, jug or the vase (1002236 t10161, t10212; jug: Wiki). */
  function onTap(player, itemId, slot) {
    if (itemId === I.MAGNET_2) return say(player, TEXT.magnetTap);
    if (itemId === I.VASE_2) {
      swapInSlot(player, itemId, I.VASE_OF_WATER, slot);
      return say(player, TEXT.vaseFill);
    }
    const kind = vessel(itemId);
    if (!kind) return false;
    const full = kind === "bucket" ? I.FULL_BUCKET : I.FULL_JUG;
    if (itemId === full) return false;
    swapInSlot(player, itemId, full, slot);
    return say(player, `You fill the ${kind} from the tap.`);
  }

  /** The drain: throw_bucketofwater + holy_water_pour, then the line (1002236 t10171). */
  function onDrain(player, itemId, slot) {
    if (itemId === I.VASE_2) return say(player, TEXT.vaseAlreadyEmpty);
    if (itemId === I.VASE_OF_WATER) {
      swapInSlot(player, itemId, I.VASE_2, slot);
      return say(player, TEXT.vaseEmpty);
    }
    const kind = vessel(itemId);
    if (!kind || units(itemId) === 0) return false;
    swapInSlot(player, itemId, kind === "bucket" ? I.EMPTY_BUCKET : I.EMPTY_JUG, slot);
    player.performAnimation(new Animation(SEQ_POUR));
    player.getPacketSender().sendSound(SYNTH_POUR, 1, 0);
    return say(player, `You empty the ${kind} down the drain.`);
  }

  /** Jug into bucket or back (1002236 t10175-10195, 1001646 t3291-3354; the rest Wiki). */
  function pour(player, event) {
    const used = event.usedItemId;
    const target = event.usedWithItemId;
    const from = vessel(used);
    const into = vessel(target);
    if (!from || !into || from === into) return false;
    const capacity = into === "bucket" ? BUCKET_CAPACITY : JUG_CAPACITY;
    const moved = Math.min(units(used), capacity - units(target));
    if (moved <= 0) return false;
    const left = units(used) - moved;
    const filled = units(target) + moved;
    const byUnits = (kind) => kind === "bucket" ? BUCKET_BY_UNITS : JUG_BY_UNITS;
    swapInSlot(player, used, byUnits(from)[left], event.usedItemSlot);
    swapInSlot(player, target, byUnits(into)[filled], event.usedWithItemSlot);
    // Ours: when both happen at once the filling line wins; no source has that pour.
    if (filled === capacity) return say(player, `You fill the ${into} to the brim.`);
    return say(player, `You empty the ${from} into the ${into}.`);
  }

  /**
   * The scales (1002236 t10204, 1001646 t3365): a bucket four-fifths full balances; the vase
   * takes its slot and the chest anim plays. Lighter or heavier: Wiki lines. Ours: partial jugs
   * and buckets other than the Wiki's are "too light".
   */
  function onScales(player, itemId, slot) {
    if (itemId === I.MAGNET_2) return say(player, TEXT.magnetChest);
    if (itemId === I.SMALL_PICK) return say(player, TEXT.pickChest, TEXT.pickChest2);
    const kind = vessel(itemId);
    if (!kind) return false;
    player.sendMessage(`You place the ${kind} on the scale.`);
    if (kind === "jug" || units(itemId) < BALANCING_UNITS) return say(player, TEXT.tooLight);
    if (units(itemId) > BALANCING_UNITS) return say(player, TEXT.tooHeavy);
    player.sendMessage(TEXT.balances);
    player.sendMessage(TEXT.vaseOut);
    player.performAnimation(new Animation(SEQ_OPEN_CHEST));
    swapInSlot(player, itemId, I.VASE_2, slot);
    return true;
  }

  /** The frozen table (1002236 t10233 for the sealed vase of water; the rest Wiki). */
  function onFrozenTable(player, itemId, slot) {
    if (itemId === I.SEALED_VASE_3) {
      swapInSlot(player, itemId, I.FROZEN_KEY, slot);
      return say(player, TEXT.shatter, TEXT.keyInIce);
    }
    if (itemId === I.MAGNET_2) return say(player, TEXT.magnetTable);
    if (itemId === I.VASE_2) return say(player, TEXT.vaseCold);
    if (itemId === I.VASE_OF_WATER) {
      swapInSlot(player, itemId, I.FROZEN_VASE, slot);
      return say(player, TEXT.vaseFreezes);
    }
    const kind = vessel(itemId);
    if (!kind) return false;
    if (units(itemId) === 0) return say(player, `Your empty ${kind} gets very cold on the icy table.`);
    if (itemId !== I.FULL_BUCKET && itemId !== I.FULL_JUG) return false;
    swapInSlot(player, itemId, kind === "bucket" ? I.FROZEN_BUCKET : I.FROZEN_JUG, slot);
    return say(player, `The icy table immediately freezes the water in your ${kind}.`);
  }

  /** The range (1002236 t10109, t10242; frozen vessels Wiki). */
  function onRange(player, itemId, slot) {
    if (itemId === I.RED_HERRING) {
      // The herring keeps its slot, the goop takes a new one; a message box (1002236 t10109).
      swapInSlot(player, itemId, I.HERRING, slot);
      give(player, I.STICKY_RED_GOOP);
      mesboxes(player, [TEXT.herringCooked]);
      return true;
    }
    if (itemId === I.FROZEN_KEY) {
      swapInSlot(player, itemId, I.SEERS_KEY, slot);
      return say(player, TEXT.melt);
    }
    if (itemId === I.FROZEN_VASE) {
      swapInSlot(player, itemId, I.VASE_2, slot);
      return say(player, TEXT.vaseSteam);
    }
    if (itemId === I.FROZEN_BUCKET || itemId === I.FROZEN_JUG) {
      const kind = itemId === I.FROZEN_BUCKET ? "bucket" : "jug";
      swapInSlot(player, itemId, kind === "bucket" ? I.EMPTY_BUCKET : I.EMPTY_JUG, slot);
      return say(player, `You place the frozen ${kind} on the range. The ice turns to steam.`);
    }
    return false;
  }

  function say(player, ...lines) {
    for (const line of lines) player.sendMessage(line);
    return true;
  }

  /** Item on item inside the house: the goop, the lid, pouring and the red herrings' lines. */
  function handleItemOnItem(event) {
    const { player } = event;
    if (event.handled || !inHouse(player)) return;
    const a = event.usedItemId;
    const b = event.usedWithItemId;
    const pair = (x, y) => (a === x && b === y) || (a === y && b === x);
    const slotOf = (id) => (a === id ? event.usedItemSlot : event.usedWithItemSlot);
    let done = false;
    if (pair(I.STICKY_RED_GOOP, I.WOODEN_DISK)) {
      // 1002236 t10118: the disk's slot becomes the red disk, the goop's is cleared.
      swapInSlot(player, I.WOODEN_DISK, I.RED_DISK_3, slotOf(I.WOODEN_DISK));
      removeAt(player, I.STICKY_RED_GOOP, slotOf(I.STICKY_RED_GOOP));
      done = say(player, TEXT.coat);
    } else if (pair(I.VASE_LID, I.VASE_OF_WATER) || pair(I.VASE_LID, I.VASE_2)) {
      // 1002236 t10223, either way round: the vase's slot is sealed, the lid goes.
      const vase = a === I.VASE_LID ? b : a;
      swapInSlot(player, vase, vase === I.VASE_OF_WATER ? I.SEALED_VASE_3 : I.SEALED_VASE, slotOf(vase));
      removeAt(player, I.VASE_LID, slotOf(I.VASE_LID));
      done = say(player, TEXT.lid);
    } else if (pair(I.VASE_LID, I.FROZEN_VASE)) {
      done = say(player, TEXT.lidIce);
    } else if (pair(I.SMALL_PICK, I.VASE_2) || pair(I.SMALL_PICK, I.FROZEN_VASE)) {
      done = say(player, TEXT.pickVase);
    } else if (pair(I.TOY_SHIP, I.VASE_2)) {
      done = say(player, TEXT.shipVase);
    } else if (pair(I.MAGNET_2, I.VASE_2)) {
      done = say(player, TEXT.magnetVase, TEXT.magnetVase2);
    } else {
      done = pour(player, event);
    }
    if (done) event.handled = true;
  }

  /** Item on a house loc (the exit door's key included). */
  function handleItemOnObject(event) {
    const { player, objectId, itemId, itemSlot } = event;
    if (event.handled) return;
    if (objectId === LOC.EXIT && itemId === I.SEERS_KEY) {
      if (!insideAtDoors(player) || trialState(player, T.SEER) !== 1) return;
      event.handled = true;
      unlockExit(player, event.object);
      return;
    }
    if (!inHouse(player)) return;
    let done = false;
    switch (objectId) {
      case LOC.TAP: done = onTap(player, itemId, itemSlot); break;
      case LOC.DRAIN: done = onDrain(player, itemId, itemSlot); break;
      case LOC.SCALES: done = onScales(player, itemId, itemSlot); break;
      case LOC.FROZEN_TABLE: done = onFrozenTable(player, itemId, itemSlot); break;
      case LOC.RANGE: done = onRange(player, itemId, itemSlot); break;
      case LOC.MURAL: done = diskOnMural(player, itemId, itemSlot); break;
      default: return;
    }
    if (done) event.handled = true;
  }

  /** The vase's Shake (1001646 t3373; with water or frozen: Wiki) and the sealed vases' Remove-lid. */
  function shakeVase(event) {
    const { player, itemId } = event;
    const text = itemId === I.VASE_2 ? TEXT.shake : itemId === I.VASE_OF_WATER ? TEXT.shakeWater
      : itemId === I.FROZEN_VASE ? TEXT.shakeFrozen : null;
    if (!text) return false;
    event.handled = true;
    mesboxes(player, [text]);
    return true;
  }

  /** Ours: Remove-lid gives back the vase and the lid (no source has it). */
  function removeLid(event) {
    const { player, itemId, slot } = event;
    if (itemId !== I.SEALED_VASE && itemId !== I.SEALED_VASE_3) return false;
    event.handled = true;
    if (ctx.freeSlots(player) < 1) {
      player.sendMessage("You need another free inventory space.");
      return true;
    }
    swapInSlot(player, itemId, itemId === I.SEALED_VASE ? I.VASE_2 : I.VASE_OF_WATER, slot);
    give(player, I.VASE_LID);
    return true;
  }

  // ---- object clicks ---------------------------------------------------------------------------------

  function handleObject(event) {
    const { player, objectId, object } = event;
    if (event.handled || !object) return;
    const op = event.clickType;
    if (objectId === LOC.ENTRANCE && op === 1) {
      event.handled = true;
      entranceDoor(event);
      return;
    }
    if (objectId === LOC.EXIT && op === 1) {
      event.handled = true;
      exitDoor(event);
      return;
    }
    if (!inHouse(player)) return;
    const z = at(player).getZ();
    if ((objectId === LOC.WEST_LADDER || objectId === LOC.EAST_LADDER) && op === 1 && z === 0) {
      climbUp(player);
    } else if (objectId === LOC.TRAPDOOR && op === 1 && z === PUZZLE_FLOOR) {
      openTrapdoor(player, object);
    } else if (objectId === LOC.TRAPDOOR_OPEN && z === PUZZLE_FLOOR) {
      if (op === 1) climbDown(player);
      else closeTrapdoor(player, object);
    } else if (OPENERS.has(objectId) && op === 1) {
      openLoc(player, object, OPENERS.get(objectId));
    } else if (CLOSERS.has(objectId)) {
      if (op === 1) shutLoc(player, object, CLOSERS.get(objectId));
      else if (objectId === LOC.CUPBOARD_OPEN) searchCupboard(player);
      else searchChest(player, object);
    } else if (objectId === LOC.SCALES && op === 1) {
      player.sendMessage(TEXT.scalesLocked);
    } else if (objectId === LOC.BOOKCASE) {
      searchBookcase(player);
    } else if (PILES.has(objectId)) {
      searchPile(player, object);
    } else if (objectId === LOC.UNICORN || objectId === LOC.BULL) {
      studyHead(player, objectId === LOC.UNICORN);
    } else if (objectId === LOC.MURAL) {
      studyMural(player);
    } else {
      return;
    }
    event.handled = true;
  }

  // ---- leaving -------------------------------------------------------------------------------------

  /** Takes every house item (a plain herring stays) and the mural's disks, so the lid can come again. */
  function stripHouseItems(player) {
    const inventory = player.getInventory();
    let taken = 0;
    for (const itemId of HOUSE_ITEMS) {
      const amount = inventory.getAmount(itemId);
      if (amount > 0) {
        take(player, itemId, amount);
        taken += amount;
      }
    }
    setFlag(player, FLAG.MURAL_OLD_DISK, false);
    setFlag(player, FLAG.MURAL_RED_DISK, false);
    return taken;
  }

  /** Ours: out of the house any other way (a teleport), the house items and open locs go too. */
  function leftHouse({ player }) {
    stripHouseItems(player);
    resetLocs(player);
  }

  /** Ours: a player who logged out inside and comes back elsewhere loses the house items. */
  function handleLogin({ player }) {
    if (!inHouse(player) && heldAny(player, HOUSE_ITEMS)) stripHouseItems(player);
  }

  function handleLogout({ player }) {
    seerLocks.delete(player);
    resetLocs(player, true);
  }

  api.persistAttribute(SEER_RIDDLE_ATTRIBUTE, 0);

  ctx.variant(NPC.PEER, peerVariant);
  ctx.offer(NPC.PEER, peerOffer);
  ctx.condition(peerCondition);
  ctx.choice(acceptTrial);
  for (const step of BANK_STEPS) ctx.action(step, bankSpell);
  ctx.line(offerPeerBankAgain);
  api.onBeforeObjectInteraction(handleObject);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Vase", { Shake: shakeVase });
  api.onItemAction("Vase of water", { Shake: shakeVase });
  api.onItemAction("Frozen vase", { Shake: shakeVase });
  api.onItemAction("Sealed vase", { "Remove-lid": removeLid });
  api.onInterfaceActionClick(clickSeerLock);
  api.onZoneExit(HOUSE, leftHouse);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
