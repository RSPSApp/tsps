/**
 * Shilo Village: Cairn Isle and Bervirius' tomb, the crafting, the locating crystal and the ending, as the
 * capture plays them (RSProx capture ShiloVillage, rev 242.1; ticks are that recording's):
 * - Cairn Isle's bridge (y 2979): crossing its middle tile (x 2779) rolls the Wiki's chart (low 75, high
 *   250), one tick after the step, either way (t3482-3483 west, t5302-5303 east, t3397-3398 a fall).
 *   A success is "You manage to keep your balance on the bridge." and 10 Agility XP (Wiki); a fall is
 *   "You fall!", the stumble sound, a walk through the river to 2782,2971 with the player's gasps and a
 *   splash, and on landing, 12 ticks on, the two lines and three hits (t3398-3410, t3440-3456);
 * - the well stacked rocks (2234): the crawl-way's three boxes, sequence 827 on the second and the stage
 *   and the drop into the tomb (2760,9389) on the third (t3505-3519, t5222-5227);
 * - the tomb dolmen (2235): Search's box, then each item goes in as its own object box shows (t3599-3604);
 * - the climbing rocks (2236) out: the attempt with a two-tile step onto the rocks, two ticks on success
 *   (the step off and, two ticks later, Cairn Isle at 2764,2976) or a fall back with an overhead yell and a
 *   1-10 hit (t3546-3553, t5265-5279; Wiki: chart low 70, high 250, 1-10 damage);
 * - the crafting: the pommel into bone beads on the second box (t3614-3616), bronze wire on the beads into
 *   the Beads of the Dead in the wire's slot (t3620), the bone shard into the bone key in its slot once the
 *   lock is found (t4011); the Wiki's 20 Crafting and 3/4/3 XP;
 * - the locating crystal's Activate: the object box with the crystal, the menu, the tier box with the
 *   crystal's coloured form and a prayer point drained (t3660-3666);
 * - Bervirius' notes: the menu and the three papyri on the handwriting scroll (222), as laid out live
 *   (t3679-3692);
 * - Rashiliyia's remains on the dolmen: the object box, the mist, Rashiliyia beside the dolmen for her two
 *   lines, and on the last continue her disappearance, the mist again and the quest's completion (t5240-5257).
 */
module.exports = function attachBervirius(api, sv) {
  const { ObstacleRunner, STAGE, MECH, NPC, ITEM, LOC } = sv;
  const { Skill, Graphic, Location, Area, Boundary, Item } = api.core;

  // --- Cairn Isle's bridge ----------------------------------------------------------------------
  const BRIDGE_Y = 2979;
  /** The bridge's middle: a roll as it is stepped onto or run across. */
  const BRIDGE_MIDDLE_X = 2779;
  /** The area that watches the bridge: its planks (x 2776-2781) and the tiles at either end, to see a run across. */
  const BRIDGE_AREA = { minX: 2774, maxX: 2784 };
  const BRIDGE_LOW = 75;
  const BRIDGE_HIGH = 250;
  const BRIDGE_XP = 10;
  const BRIDGE_LINES = Object.freeze({
    balance: "You manage to keep your balance on the bridge.",
    fall: "You fall!",
    ashore: "You just manage to drag your pitiful frame onto the river bank.",
    drowned: "Though you nearly drowned in the river!",
  });
  /**
   * Each of the three hits is floor(HP / 11) (Wiki, Cairn Isle). Recorded difference: the capture's falls hit
   * floor(HP / 10) (54 HP -> 5, 5, 5 at t3410; 39 HP -> 3, 3, 3 at t3456).
   */
  const BRIDGE_HIT_DIVISOR = 11;

  // --- Bervirius' tomb --------------------------------------------------------------------------
  const BERVIRIUS_TOMB_TILE = [2760, 9389, 0];
  const CLIMB_OUT_TILE = [2764, 2976, 0];
  const CRAWL_YES = "Yes please, I can think of nothing nicer!";
  /** The crawl-way's three boxes (the transcript's "Search Well stacked rocks"). */
  const CRAWL_STRUGGLE_STEP = "yi2W8q";
  const CRAWL_DROP_STEP = "5imqbq";
  /** Ours: the line for a player below the Wiki's 32 Agility to enter the tomb; no source words it. */
  const CRAWL_AGILITY = 32;
  const CRAWL_REFUSAL = "You need an Agility level of at least 32 to squeeze in there.";
  /** Where both captured climbs start, beside the rocks at 2765,9376 (t3546, t5265). */
  const CLIMB_START = [2764, 9376];
  const CLIMB_LOW = 70;
  const CLIMB_HIGH = 250;
  const CLIMB_LINES = Object.freeze({
    attempt: "You attempt to climb the granite rock.",
    fall: "You fall!",
    yell: "Arrggghhhhhh!",
    out: "You manage to climb back out again!",
  });
  const DOLMEN_GIVES = new Map([
    ["AUHqGK", ITEM.SWORD_POMMEL],
    ["EV3xG1", ITEM.LOCATING_CRYSTAL],
    ["GbBn5Q", ITEM.BERVIRIUS_NOTES],
  ]);

  // --- Crafting ---------------------------------------------------------------------------------
  /** Wiki (Bone beads, Beads of the Dead, Bone key): 20 Crafting each, 3, 4 and 3 XP. */
  const CRAFT_LEVEL = 20;
  const BEADS_XP = 3;
  const NECKLACE_XP = 4;
  const KEY_XP = 3;
  /** Ours: the refusal for the beads and the necklace (the transcript words only the key's). */
  const CRAFT_REFUSAL = "You need a Crafting level of at least 20 to complete this task.";
  const BEADS_DONE_STEP = "TNglOw";
  const KEY_MADE_STEP = "O3CMbW";

  // --- The locating crystal ---------------------------------------------------------------------
  const CRYSTAL_VARIANT = "visiting-the-tomb-of-rashiliyia-activate-the-locating-crystal";
  const CRYSTAL_MISSING_STEP = "q3ZJWg";
  const CRYSTAL_ALWAYS_STEP = "dYTnLm";
  const CRYSTAL_ONCE = "Yes, just this once.";
  const CRYSTAL_ALWAYS_ATTRIBUTE = "shilo-village:crystal-always";
  const TOMB_CENTRE = { x: 2916, y: 3092 };
  /**
   * The tiers by the transcript's conditions: too far, within 200 squares, then three "within [unknown
   * squares]" (ours: 100, 50 and 10). Each result box shows the crystal's coloured form: the faint glow is
   * the blue crystal 612 with blue text (t3666); the brighter tiers' crystals (613 red, 614 yellow, 615
   * white) and plain text are ours.
   */
  const CRYSTAL_TIERS = Object.freeze({
    VMIEdG: { test: (d) => d > 200 },
    "7NFThh": { test: (d) => d > 100 && d <= 200 },
    DHF9Uw: { test: (d) => d > 50 && d <= 100 },
    "w8CW6-": { test: (d) => d > 10 && d <= 50 },
    BEZoJ0: { test: (d) => d <= 10 },
  });
  const CRYSTAL_RESULTS = Object.freeze({
    "2upPB5": { item: ITEM.LOCATING_CRYSTAL },
    "3TXsgY": { item: 612, colour: "0000ff" },
    LvquLT: { item: 613 },
    lbCbRu: { item: 614 },
    UsyktO: { item: 615 },
  });
  /** Wiki (Locating crystal): it needs 10 prayer points. Ours: the refusal's wording, and the line once the quest is done. */
  const CRYSTAL_PRAYER = 10;
  const CRYSTAL_NO_PRAYER = "You need a Prayer level of at least 10 for the crystal to work.";
  const CRYSTAL_SPENT = "The crystal does not respond anymore.";

  // --- Bervirius' notes -------------------------------------------------------------------------
  const NOTES_VARIANT = "visiting-the-tomb-of-bervirius-read-the-bervirius-notes";
  const SCROLL_INTERFACE = "messagescroll_handwriting"; // 222
  const SCROLL_LINES = 11;
  /** The three papyri as live lays them out on 222 (t3679-3692): blank lines first, then the text. */
  const NOTES = new Map([
    ["7aG-WD", ["", "", "",
      "...and rest like your mother who is silent in the",
      "peace of her tomb far to the North of Ah Za",
      "Rhoon. Near the sea, and under the hills deep in",
      "the underground to watch all of nature from the",
      "darkness of her final resting place."]],
    ["0uSJB3", ["", "", "", "",
      "...Rashiliyia did so love objects of beauty. Her",
      "tomb was adorned with crystals that glowed",
      "brightly when near to each other."]],
    ["i8hwtu", ["", "", "", "",
      "...the sphere is activated when power of a spiritual",
      "nature is expended upon it, this can be very",
      "draining on the body..."]],
  ]);

  // --- The ending -------------------------------------------------------------------------------
  const ENDING_VARIANT = "visiting-the-tomb-of-rashiliyia-using-rashiliyias-remains-on-the-dolmen";
  const ENDING_PLACED_STEP = "llhAok";
  const ENDING_GONE_STEP = "HTufPX";
  const ENDING_COMPLETE_STEP = "l7zrz_";
  /** Rashiliyia stands, and the mist rises, on the dolmen's far tile (t5248-5257). */
  const RASHILIYIA_TILE = [2767, 9367];
  const MIST_GFX = 184; // shilomist
  const MIST_SOUND = 2138; // swamp_gas

  const VARIANTS = Object.freeze({
    investigateRocks: "visiting-the-tomb-of-bervirius-investigate-well-stacked-rocks",
    searchRocks: "visiting-the-tomb-of-bervirius-search-well-stacked-rocks",
    inspectDolmen: "visiting-the-tomb-of-bervirius-inspect-tomb-dolmen",
    searchDolmen: "visiting-the-tomb-of-bervirius-search-tomb-dolmen",
    postQuestDolmen: "post-quest-tomb-of-bervirius-inspect-or-search-tomb-dolmen",
    beads: "visiting-the-tomb-of-bervirius-use-chisel-on-sword-pommel",
    necklace: "visiting-the-tomb-of-bervirius-use-bronze-wire-on-bone-beads",
    shardTooSoon: "visiting-ah-za-rhoon-using-chisel-on-bone-shard",
    key: "visiting-the-tomb-of-rashiliyia-use-chisel-on-bone-shard",
  });

  /** A crafting swap pending its box (the slot it keeps). */
  const pendingCraft = new Map();
  const rashiliyiaByPlayer = new Map();
  const bridgeLastX = new Map();

  /** Wiki's success chance for a skill chart: (1 + floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5)) / 256. */
  function chartChance(low, high, level) {
    return Math.min(1, (1 + Math.floor((low * (99 - level)) / 98 + (high * (level - 1)) / 98 + 0.5)) / 256);
  }

  function mapAnim(player, id, [x, y], { delay = 0, height = 0 } = {}) {
    const at = new Location(x, y, player.getLocation().getZ());
    const graphic = Graphic.delayed(id, delay, height);
    for (const viewer of [player, ...(player.getLocalPlayers?.() ?? [])]) viewer.getPacketSender().sendGlobalGraphic(graphic, at);
  }

  function areaSound(player, soundId, [x, y], radius = 10) {
    api.core.Sounds.playAreaSound({ soundId, x, y, level: player.getLocation().getZ(), radius });
  }

  /** Into the inventory, or onto the floor under the player when it is full (Wiki, Tomb of Bervirius). */
  function giveOrDrop(player, itemId) {
    if (sv.freeSlots(player) > 0) {
      sv.give(player, itemId);
      return;
    }
    api.core.ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), player.getLocation().clone());
  }

  function slotOf(player, itemId) {
    return player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
  }

  function setSlot(player, slot, itemId) {
    const inventory = player.getInventory();
    inventory.setItem(slot, itemId == null ? new Item(-1, 0) : new Item(itemId, 1));
    inventory.refreshItems?.();
  }

  // --- Bridge -----------------------------------------------------------------------------------
  /** A step across x 2779 since the last tick: onto it, or a run over it either way. */
  function crossedMiddle(fromX, toX) {
    return fromX !== toX && Math.min(fromX, toX) <= BRIDGE_MIDDLE_X && Math.max(fromX, toX) >= BRIDGE_MIDDLE_X
      && fromX !== BRIDGE_MIDDLE_X;
  }

  function watchBridge(player) {
    const at = player.getLocation();
    const x = at.getX();
    const last = bridgeLastX.get(player);
    bridgeLastX.set(player, at.getY() === BRIDGE_Y ? x : null);
    if (last == null || at.getY() !== BRIDGE_Y || ObstacleRunner.isBusy(player) || !crossedMiddle(last, x)) return;
    // The result shows a tick after the step (t3483, t5303).
    sv.later(player, 1, () => rollBridge(player));
  }

  function rollBridge(player) {
    if (ObstacleRunner.isBusy(player) || !player.isRegistered?.()) return;
    if (Math.random() < chartChance(BRIDGE_LOW, BRIDGE_HIGH, sv.agilityLevel(player))) {
      player.sendMessage(BRIDGE_LINES.balance);
      player.getSkillManager().addExperiences(Skill.AGILITY, BRIDGE_XP);
      return;
    }
    fallIntoRiver(player);
  }

  /**
   * The fall (t3398-3410, relative ticks): 0 the line and the stumble sound; 1 a step into the river and
   * "Ahhhhhhhhhh!"; 2 "Choke!" and the splash; 3-12 carried down to 2782,2971 ("Gulp!" at 4, "Cough!" at 8);
   * 12 the two lines, the three hits and "Gasp!".
   */
  function fallIntoRiver(player) {
    const hit = Math.floor(player.getHitpoints() / BRIDGE_HIT_DIVISOR);
    ObstacleRunner.run({ player }, [
      { msg: BRIDGE_LINES.fall },
      { sound: 2493, loops: 10 }, // stumble_loop
      { wait: 1 },
      { walk: [[2778, 2978]], arrive: true },
      { say: "Ahhhhhhhhhh!" },
      { wait: 1 },
      { say: "Choke!" },
      { run: () => { mapAnim(player, 68, [2778, 2978], { delay: 3 }); } }, // watersplash
      { sound: 1658 }, // pool_plop
      { wait: 1 },
      { walk: [[2778, 2977]], arrive: true },
      { wait: 1 },
      { walk: [[2778, 2975]], tilesPerTick: 2, arrive: true },
      { say: "Gulp!" },
      { wait: 2 },
      { walk: [[2779, 2973]], tilesPerTick: 2, arrive: true },
      { wait: 2 },
      { walk: [[2780, 2971]], tilesPerTick: 2, arrive: true },
      { say: "Cough!" },
      { wait: 2 },
      { walk: [[2781, 2972]], arrive: true },
      { wait: 2 },
      { walk: [[2782, 2971]], arrive: true },
      { msg: BRIDGE_LINES.ashore },
      { msg: BRIDGE_LINES.drowned },
      { hit },
      { hit },
      { hit },
      { say: "Gasp!" },
    ], { busyVarbit: true });
  }

  function createBridgeArea() {
    return new (class CairnIsleBridge extends Area {
      constructor() {
        super([new Boundary(BRIDGE_AREA.minX, BRIDGE_AREA.maxX, BRIDGE_Y, BRIDGE_Y, 0)]);
      }

      process(mobile) {
        if (mobile.isPlayer?.()) watchBridge(mobile);
      }

      postLeave(mobile) {
        bridgeLastX.delete(mobile);
      }
    })();
  }

  // --- Well stacked rocks, dolmen, climbing rocks -----------------------------------------------
  function handleWellStackedRocks(player, clickType) {
    sv.scene(player, sv.NPC.TRUFITUS, clickType === 1 ? VARIANTS.investigateRocks : VARIANTS.searchRocks);
  }

  function handleDolmen(player, clickType) {
    if (sv.complete(player)) {
      sv.scene(player, NPC.TRUFITUS, VARIANTS.postQuestDolmen);
      return;
    }
    sv.scene(player, NPC.TRUFITUS, clickType === 1 ? VARIANTS.inspectDolmen : VARIANTS.searchDolmen);
  }

  /**
   * The climb (relative to the attempt line, t5270): 0 the line and two tiles up onto the rocks; 2 either the
   * way out (the line and a step off, then Cairn Isle two ticks later) or the fall back down with the yell,
   * the stumble sound and, a tick later, the 1-10 hit (Wiki).
   */
  function climbRocks(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const [x, y] = CLIMB_START;
    const success = Math.random() < chartChance(CLIMB_LOW, CLIMB_HIGH, sv.agilityLevel(player));
    const outcome = success
      ? [
        { msg: CLIMB_LINES.out },
        { walk: [[x + 4, y - 1]], tilesPerTick: 2, arrive: true },
        { wait: 2 },
        { tele: CLIMB_OUT_TILE },
      ]
      : [
        // Back down the rocks with an exact move (to 2764,9376, cycles 31-50, facing east), the yell and the
        // stumble sound on the line's tick, the hit a tick later (t5272-5273).
        { msg: CLIMB_LINES.fall },
        { say: CLIMB_LINES.yell },
        { sound: 2493, loops: 10 },
        { anim: -1 },
        { move: [x, y], speed: [31, 50], dir: "east", ticks: 0 },
        { wait: 1 },
        { hit: [1, 10] },
        { wait: 1 },
        { tele: [x, y] },
      ];
    ObstacleRunner.run({ player }, [
      ...(sv.at(player, x, y) ? [] : [{ walk: [[x, y]], arrive: true }]),
      { msg: CLIMB_LINES.attempt },
      { walk: [[x + 2, y]], tilesPerTick: 2, arrive: true },
      { wait: 2 },
      ...outcome,
    ], { busyVarbit: true });
  }

  // --- Crafting ---------------------------------------------------------------------------------
  function craftBeads(player, pommelSlot) {
    if (sv.craftingLevel(player) < CRAFT_LEVEL) {
      player.sendMessage(CRAFT_REFUSAL);
      return;
    }
    pendingCraft.set(player, { step: BEADS_DONE_STEP, slot: pommelSlot, from: ITEM.SWORD_POMMEL, to: ITEM.BONE_BEADS, xp: BEADS_XP });
    sv.scene(player, NPC.TRUFITUS, VARIANTS.beads);
  }

  /** The wire becomes the necklace in its own slot and the beads go, as the box shows (t3620). */
  function craftNecklace(player, wireSlot, beadsSlot) {
    if (sv.craftingLevel(player) < CRAFT_LEVEL) {
      player.sendMessage(CRAFT_REFUSAL);
      return;
    }
    setSlot(player, beadsSlot, null);
    setSlot(player, wireSlot, ITEM.BEADS_OF_THE_DEAD);
    player.getSkillManager().addExperiences(Skill.CRAFTING, NECKLACE_XP);
    sv.scene(player, NPC.TRUFITUS, VARIANTS.necklace);
  }

  /** The shard is cut only once the lock has been seen (the transcript's two "use chisel on bone shard" sections). */
  function craftKey(player, shardSlot) {
    if (!sv.mechTest(player, MECH.FOUND_BONE_DOOR)) {
      sv.scene(player, NPC.TRUFITUS, VARIANTS.shardTooSoon);
      return;
    }
    pendingCraft.set(player, { step: KEY_MADE_STEP, slot: shardSlot, from: ITEM.BONE_SHARD, to: ITEM.BONE_KEY, xp: KEY_XP });
    sv.scene(player, NPC.TRUFITUS, VARIANTS.key);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot } = event;
    const slotOfId = (id) => (usedItemId === id ? usedItemSlot : usedWithItemId === id ? usedWithItemSlot : -1);
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(ITEM.CHISEL) && pair.has(ITEM.SWORD_POMMEL)) {
      event.handled = true;
      craftBeads(player, slotOfId(ITEM.SWORD_POMMEL));
    } else if (pair.has(ITEM.BRONZE_WIRE) && pair.has(ITEM.BONE_BEADS)) {
      event.handled = true;
      craftNecklace(player, slotOfId(ITEM.BRONZE_WIRE), slotOfId(ITEM.BONE_BEADS));
    } else if (pair.has(ITEM.CHISEL) && pair.has(ITEM.BONE_SHARD)) {
      event.handled = true;
      craftKey(player, slotOfId(ITEM.BONE_SHARD));
    }
  }

  // --- The crystal ------------------------------------------------------------------------------
  function crystalDistance(player) {
    const at = player.getLocation();
    return Math.max(Math.abs(at.getX() - TOMB_CENTRE.x), Math.abs(at.getY() - TOMB_CENTRE.y));
  }

  /** "Yes, just this once." steps: what "always" plays from then on, without the box and the menu. */
  function onceSteps(steps) {
    const choice = steps.find((step) => step.type === "choice");
    return choice?.options.find((option) => option.text === CRYSTAL_ONCE)?.steps ?? steps;
  }

  function activateCrystal(event) {
    const { player } = event;
    event.handled = true;
    if (sv.complete(player)) {
      player.sendMessage(CRYSTAL_SPENT);
      return true;
    }
    if (sv.level(player, Skill.PRAYER) < CRYSTAL_PRAYER) {
      player.sendMessage(CRYSTAL_NO_PRAYER);
      return true;
    }
    const always = Number(player.getAttribute(CRYSTAL_ALWAYS_ATTRIBUTE)) === 1;
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, NPC.TRUFITUS, sv.PAGE, CRYSTAL_VARIANT, always ? onceSteps : undefined);
    if (always) drainPrayer(player);
    return true;
  }

  function drainPrayer(player) {
    const skills = player.getSkillManager();
    skills.setCurrentLevel(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - 1));
  }

  // --- The notes --------------------------------------------------------------------------------
  function readNotes(event) {
    event.handled = true;
    sv.scene(event.player, NPC.TRUFITUS, NOTES_VARIANT);
    return true;
  }

  /** The papyrus opens on the pick's tick (t3687), on the handwriting scroll. */
  function openPapyrus(player, lines) {
    const { CacheDefinitions } = api.core;
    const sender = player.getPacketSender();
    sender.sendInterface(CacheDefinitions.getInterfaceId(SCROLL_INTERFACE));
    for (let index = 0; index < SCROLL_LINES; index++) {
      sender.sendString(lines[index] ?? "", CacheDefinitions.getComponentId(`${SCROLL_INTERFACE}:messagescroll${index + 1}_hw`));
    }
  }

  // --- The ending -------------------------------------------------------------------------------
  function mist(player) {
    mapAnim(player, MIST_GFX, RASHILIYIA_TILE, { height: 5 });
    areaSound(player, MIST_SOUND, RASHILIYIA_TILE);
  }

  /** Ours: how long Rashiliyia waits for a chat that was closed (the capture always continues). */
  const SCENE_NPC_TICKS = 100;

  /** The box's continue: the mist, and Rashiliyia beside the dolmen a tick later, facing the player (t5248-5250). */
  function raiseRashiliyia(player) {
    dismissRashiliyia(player);
    mist(player);
    sv.later(player, 1, () => {
      dismissRashiliyia(player);
      const npc = api.spawnNpc({
        id: NPC.RASHILIYIA, x: RASHILIYIA_TILE[0], y: RASHILIYIA_TILE[1], z: player.getLocation().getZ(),
        wanderRadius: 0, owner: player, ownerOnly: true,
      });
      if (!npc) return;
      npc.setPositionToFace?.(player.getLocation());
      rashiliyiaByPlayer.set(player, npc);
      // Ours: a chat closed before her last line leaves her; she goes after SCENE_NPC_TICKS.
      sv.later(player, SCENE_NPC_TICKS, () => { if (rashiliyiaByPlayer.get(player) === npc) dismissRashiliyia(player); });
    });
  }

  function dismissRashiliyia(player) {
    const npc = rashiliyiaByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    rashiliyiaByPlayer.delete(player);
  }

  // --- Dispatch ---------------------------------------------------------------------------------
  function handleObject(event) {
    const { objectId, player, clickType } = event;
    if (objectId === LOC.WELL_STACKED_ROCKS) {
      event.handled = true;
      handleWellStackedRocks(player, clickType);
    } else if (objectId === LOC.BERVIRIUS_DOLMEN) {
      event.handled = true;
      handleDolmen(player, clickType);
    } else if (objectId === LOC.CLIMBING_ROCKS) {
      event.handled = true;
      climbRocks(player);
    }
  }

  function handleItemOnObject(event) {
    if (event.itemId !== ITEM.RASHILIYIA_CORPSE || event.objectId !== LOC.BERVIRIUS_DOLMEN) return;
    event.handled = true;
    if (sv.complete(event.player)) return;
    sv.scene(event.player, NPC.RASHILIYIA, ENDING_VARIANT);
  }

  function handleChoice(event) {
    const { player, option } = event;
    if (!player) return;
    if (option === CRAWL_YES && sv.agilityLevel(player) < CRAWL_AGILITY) {
      event.end = true;
      player.sendMessage(CRAWL_REFUSAL);
    } else if (option === CRYSTAL_ONCE) {
      drainPrayer(player);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === CRAWL_STRUGGLE_STEP) {
      // The second box: the player stoops into the hole (seq 827, delay 5, t5226).
      player.performAnimation(new api.core.Animation(827, 5));
    } else if (stepId === CRAWL_DROP_STEP) {
      // The third box: down into the tomb, and the stage, on its tick (t3519, t5227).
      if (sv.stage(player) >= STAGE.LEFT_TEMPLE) sv.advance(player, STAGE.ENTERED_BERVIRIUS);
      sv.teleport(player, BERVIRIUS_TOMB_TILE);
    } else if (DOLMEN_GIVES.has(stepId)) {
      const itemId = DOLMEN_GIVES.get(stepId);
      if (!sv.held(player, itemId)) giveOrDrop(player, itemId);
    } else if (stepId && pendingCraft.get(player)?.step === stepId) {
      const craft = pendingCraft.get(player);
      pendingCraft.delete(player);
      const slot = slotOf(player, craft.from) === craft.slot ? craft.slot : slotOf(player, craft.from);
      if (slot >= 0) {
        setSlot(player, slot, craft.to);
        player.getSkillManager().addExperiences(Skill.CRAFTING, craft.xp);
      }
    } else if (stepId === CRYSTAL_MISSING_STEP) {
      // The export's lead-in marker: nothing to show.
      event.handled = true;
    } else if (stepId === CRYSTAL_ALWAYS_STEP) {
      // "Same as above, and further activations don't provide the options": the once branch, played now.
      player.setAttribute(CRYSTAL_ALWAYS_ATTRIBUTE, 1);
      drainPrayer(player);
      event.handled = true;
      require("../QuestRuntime").startTranscript(api, player, NPC.TRUFITUS, sv.PAGE, CRYSTAL_VARIANT, onceSteps);
    } else if (CRYSTAL_RESULTS[stepId] && event.kind === "message") {
      const result = CRYSTAL_RESULTS[stepId];
      if (result.colour) event.text = `<col=${result.colour}>${event.text}`;
      event.box = { items: [result.item] };
    } else if (NOTES.has(stepId)) {
      event.handled = true;
      event.end = true;
      openPapyrus(player, NOTES.get(stepId));
    } else if (stepId === ENDING_PLACED_STEP) {
      const previous = event.after;
      event.after = () => { previous?.(); raiseRashiliyia(player); };
    } else if (stepId === ENDING_GONE_STEP) {
      dismissRashiliyia(player);
      mist(player);
    } else if (stepId === ENDING_COMPLETE_STEP) {
      event.handled = true;
      event.end = true;
      if (!sv.complete(player)) {
        sv.take(player, ITEM.RASHILIYIA_CORPSE);
        sv.quest.complete(player);
      }
    }
  }

  function answerCondition({ player, stepId }) {
    // The key's "If the player does not have / has 20 Crafting:" (uCZeW2 / yHrfpt).
    if (stepId === "uCZeW2") return sv.craftingLevel(player) < CRAFT_LEVEL;
    if (stepId === "yHrfpt") return sv.craftingLevel(player) >= CRAFT_LEVEL;
    const tier = CRYSTAL_TIERS[stepId];
    if (tier) return tier.test(crystalDistance(player));
    return null;
  }

  function handleLogout({ player }) {
    dismissRashiliyia(player);
    pendingCraft.delete(player);
    bridgeLastX.delete(player);
  }

  api.persistAttribute(CRYSTAL_ALWAYS_ATTRIBUTE, 0);
  api.onObjectInteraction(handleObject);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Locating crystal", { Activate: activateCrystal });
  api.onItemAction("Bervirius notes", { Read: readNotes });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogout(handleLogout);
  api.registerArea(createBridgeArea());

  return { chartChance, rollBridge, fallIntoRiver, climbRocks, crystalDistance, openPapyrus, NOTES, BRIDGE_LINES, CLIMB_LINES };
};
