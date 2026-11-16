/**
 * Shilo Village: the way into Ah Za Rhoon and what is found there, as the capture plays it (RSProx
 * capture ShiloVillage, rev 242.1; ticks are that recording's, facts in docs/quests/shilo-village/README.md):
 * - the mound of earth (2217, a 3x3 at 2921,2999): Look-at's box sets nothing (t2454), Search's box sets
 *   stage 3 (t2459); the spade's Dig beside it at stage 3 sets 4 on the click and plays human_dig_long
 *   (831) with sound 1470 and the five lines two ticks apart, the fissure (2218) appearing with the fifth
 *   (t2464-2474). The dug fissure turns back into the mound 49 ticks later (t2521, seen once), and a dig
 *   then opens it again with human_dig (830), human_stumble_back (846) two ticks on and the box two more
 *   ticks on (t2539-2543);
 * - the fissure: the torch dropped in (menu, seq 827 a tick on, the torch's object box; stage 5 and the
 *   torch gone on its continue, then "The torch burns out." and "Some rope might help here.", t2502-2513);
 *   the rope (seq 827 two ticks on, the roped fissure 2219, stage 6 and the rope's box a tick later,
 *   t2544-2547); the climb down (the three lines a tick apart, seq 827 with the second, stage 7 and the
 *   player in Ah Za Rhoon with the third, t2563-2566). "It looks very dangerous, and dark... Scary!" is
 *   said overhead (t2490);
 * - Ah Za Rhoon: the cave-ins (t2582-2612), the loose rocks' scroll on the Yes branch's object box
 *   (t2630-2648), the old sacks (t2695), the gallows' "You search the gallows..." in chat with its box three
 *   ticks later and the corpse on the Yes branch's second object box (t2723-2758);
 * - the scrolls: the tattered scroll in the message scroll (220), the crumpled scroll in the handwritten
 *   scroll (222), their captured lines from the third line on, opened on the Yes (t2659, t2713);
 * - Zadimus' corpse: Bury and Drop alike (t2763-2783); in the sacred ground the three chat lines two ticks
 *   apart with human_dig (830) and then 827, the box, the Spirit of Zadimus rising in smoke for his line,
 *   and on its continue the corpse turned into the bone shard in its slot (t3199-3227); stage 8 stays;
 * - leaving Ah Za Rhoon at stage 7 by any way out is stage 8 (a glory teleport at t2885).
 * The strange looking stone, the smashed table, the waterfall rocks and the stone-plaque were not played
 * in the capture: their transcript lines and the old handling are kept.
 */
module.exports = function attachAhZaRhoon(api, sv) {
  const { ObstacleRunner, STAGE, MECH, NPC, ITEM, LOC } = sv;
  const { Location, GameObject, ObjectManager, CacheDefinitions, Graphic, Area, Boundary } = api.core;

  const MOUND_TILE = { x: 2921, y: 2999, z: 0 };
  const MOUND_SIZE = 3;
  const MOUND_TYPE = 10;
  const MOUND_FACE = 0;
  /** The dug fissure turns back into the mound (2218 at t2472, the mound at t2521). */
  const FISSURE_REVERT_TICKS = 49;
  const FISSURE_IDS = new Set([LOC.FISSURE, LOC.ROPE_FISSURE]);

  const DIG_LONG = 831; // human_dig_long
  const DIG = 830; // human_dig
  const STUMBLE_BACK = 846; // human_stumble_back
  const DIG_SOUND = 1470;
  const PICK_UP = 827; // human_pickupfloor
  const DIG_LINES = [
    "You start digging...",
    "You dig a small hole and almost immediately hit granite.",
    "You excavate the hole a bit more...",
    "And see that there is a small fissure...",
    "You might just be able to crawl through it...",
  ];
  const CLIMB_DOWN_LINES = [
    "You start to contort your body...",
    "With some difficulty you manage to push yourself through the small crack in the rock.",
    "You cleverly use the rope to slowly lower yourself to the floor.",
  ];
  const SCARY = "It looks very dangerous, and dark... Scary!";
  const GALLOWS_SEARCH = "You search the gallows...";
  const BURY_LINES = [
    "You feel an unearthly compunction to bury this corpse!",
    "You dig a hole for the remains.",
    "You lay the remains of Zadimus to rest.",
  ];
  /** The transcript messages the timed scripts here send themselves, and the transcript then skips. */
  const SENT_BY_SCRIPT = new Set([
    "KQb6l2", "mMnKe7", // "You search the gallows..."
    "h7oBf7", "SZVWc5", "rNzYF1", "9wZ4y3", // the burial's chat lines
  ]);
  const STEP_SCROLL_FROM_ROCKS = "kT_QSL";
  const STEP_CORPSE_FROM_GALLOWS = "7-ya_6";
  const STEP_SPIRIT_RISES = "qOlYQB";
  const STEP_SHARD_INSPECT = "xWJEy4";
  const ACTION_ENTER_TEMPLE = "hD81Mw";
  const ACTION_RECEIVE_BONE_SHARD = "jlQo6F";
  const REFERENCE_TATTERED = "WH07P-";
  const REFERENCE_CRUMPLED = "n7hNYR";
  const CONDITION_WATERFALL_SUCCESS = "k-JIXW";
  const CONDITION_WATERFALL_FAILURE = "Jjfe_E";
  /** The shard's box with the colour the capture shows on Zadimus' words (t3239). */
  const SHARD_INSPECT_TEXT = "You look at the shard of bone. The words of Zadimus come back to you. "
    + "<col=0000ff>'I am the key, but only kin may approach her.'<col=000080>";

  const LIGHTS = new Map([
    [ITEM.LIT_TORCH, "visiting-ah-za-rhoon-use-lit-torch-on-fissure"],
    [ITEM.LIT_CANDLE, "visiting-ah-za-rhoon-use-lit-candle-on-fissure"],
    [ITEM.LIT_BLACK_CANDLE, "visiting-ah-za-rhoon-use-lit-black-candle-on-fissure"],
  ]);
  /** The first message after each light's Yes: its object box, whose continue uses the light up. */
  const LIGHT_DROP_STEPS = new Map([["-TPp0s", ITEM.LIT_TORCH], ["9IqOTO", ITEM.LIT_CANDLE], ["YAIMGo", ITEM.LIT_BLACK_CANDLE]]);
  /** Ours: the candles' burn-out lines are boxed like the torch's (only the torch was captured). */
  const CANDLE_BURN_OUT_STEPS = new Set(["-zF7fk", "vWOu7Z"]);

  const SACRED_ZONE = { minX: 2794, maxX: 2806, minY: 3087, maxY: 3102 };
  const SPIRIT_TILE = [2796, 3088];
  const SMOKEPUFF = 86;
  /** Ah Za Rhoon's two map squares (the fissure lands on 2898,9401; the sacks are at 2939,9285). */
  const AH_ZA_RHOON = { minX: 2880, maxX: 2943, minY: 9280, maxY: 9407 };
  const AH_ZA_RHOON_TILE = [2898, 9401, 0];
  const WATERFALL_EXIT_TILE = [2928, 2947, 0];
  const CAVE_IN_UPPER_TILE = [2888, 9283, 0];
  const CAVE_IN_LOWER_TILE = [2887, 9374, 0];

  /** The scrolls' captured lines, from the scroll's third line (lines 1-2 are blank, t2659, t2713). */
  const SCROLLS = Object.freeze({
    [REFERENCE_TATTERED]: {
      group: "messagescroll", component: (n) => `messagescroll:messcroll${n}`, size: 15, mech: MECH.READ_TATTERED,
      lines: [
        "Bervirius, son of King Danthalas, was killed in battle. His",
        "devout Mother Rashiliyia was so heartbroken that she swore",
        "fealty to Zamorak if he would return her son to her. Bervirius",
        "returned as an undead creature and terrorized the King and",
        "Queen. Many guards died fighting the Undead Bervirius.",
        "Eventually the undead Bervirius was set on fire and soon only",
        "the bones remained.His remains were taken far to the South,",
        "and then towards the setting sun to a tomb that is surrounded",
        "by and level with the sea. The only remedy for containing the",
        "spirits of witches and undead.",
      ],
    },
    [REFERENCE_CRUMPLED]: {
      group: "messagescroll_handwriting", component: (n) => `messagescroll_handwriting:messagescroll${n}_hw`, size: 11,
      mech: MECH.READ_CRUMPLED,
      lines: [
        "Rashiliyia's rage went unchecked. She killed",
        "without mercy for revenge of her son's life. Like",
        "a spectre through the night she entered houses",
        "and one by one quietly strangled life from the",
        "occupants. It is said that only a handful survived,",
        "protected by necklace wards to keep the Witch",
        "Queen at bay.",
      ],
    },
  });
  const SCROLL_FIRST_LINE = 3;

  const pendingLight = new Map();
  const spirits = new Map();

  // --- Helpers ----------------------------------------------------------------------------------
  function moundLocation() {
    return new Location(MOUND_TILE.x, MOUND_TILE.y, MOUND_TILE.z);
  }

  function ownedFissure(player) {
    return ObjectManager.objectsAt(moundLocation())
      .find((object) => object.getOwner?.() === player && FISSURE_IDS.has(object.getId()));
  }

  function placeFissure(player, id) {
    const existing = ownedFissure(player);
    if (existing?.getId() === id) return;
    if (existing) ObjectManager.deregister(existing, true);
    ObjectManager.register(new GameObject(id, moundLocation(), MOUND_TYPE, MOUND_FACE, null).setOwner(player), true);
  }

  function clearFissure(player) {
    const existing = ownedFissure(player);
    if (existing) ObjectManager.deregister(existing, true);
  }

  /** The dug fissure goes back to being the mound; the roped one stays (it was not seen to). */
  function scheduleRevert(player) {
    sv.later(player, FISSURE_REVERT_TICKS, () => {
      if (ownedFissure(player)?.getId() === LOC.FISSURE) clearFissure(player);
    });
  }

  function besideMound(location) {
    const x = location.getX(), y = location.getY();
    return x >= MOUND_TILE.x - 1 && x <= MOUND_TILE.x + MOUND_SIZE && y >= MOUND_TILE.y - 1 && y <= MOUND_TILE.y + MOUND_SIZE
      && location.getZ() === MOUND_TILE.z;
  }

  function inBox(location, box) {
    const x = location.getX(), y = location.getY();
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
  }

  function mapAnim(player, id, [x, y], height = 0) {
    const at = new Location(x, y, player.getLocation().getZ());
    for (const viewer of [player, ...(player.getLocalPlayers?.() ?? [])]) {
      viewer.getPacketSender().sendGlobalGraphic(Graphic.delayed(id, 0, height), at);
    }
  }

  // --- The mound and the dig --------------------------------------------------------------------
  function handleMound(player, clickType) {
    const stage = sv.stage(player);
    if (stage >= STAGE.DUG_MOUND) {
      sv.scene(player, NPC.TRUFITUS, clickType === 1 ? "visiting-ah-za-rhoon-look-at-fissure" : "visiting-ah-za-rhoon-search-fissure");
      return;
    }
    if (clickType === 2) {
      if (stage >= STAGE.STARTED) sv.advance(player, STAGE.SEARCHED_MOUND);
      sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-search-mound-of-earth");
      return;
    }
    sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-look-at-mound-of-earth");
  }

  /** Stage 3: the first dig (t2464-2474). The quest's stage is set on the click. */
  function firstDig(player) {
    sv.advance(player, STAGE.DUG_MOUND);
    ObstacleRunner.run({ player }, [
      { anim: DIG_LONG },
      { sound: DIG_SOUND },
      { msg: DIG_LINES[0] },
      { wait: 2 }, { msg: DIG_LINES[1] },
      { wait: 2 }, { msg: DIG_LINES[2] },
      { wait: 2 }, { msg: DIG_LINES[3] },
      { wait: 2 }, { msg: DIG_LINES[4] },
      { run: () => { placeFissure(player, LOC.FISSURE); scheduleRevert(player); } },
      { wait: 2 },
    ], { busyVarbit: true });
  }

  /** A dig once dug: the fissure open again, the stumble, and the box (t2539-2543). */
  function digAgain(player) {
    if (sv.stage(player) < STAGE.ROPED_MOUND && !ownedFissure(player)) {
      placeFissure(player, LOC.FISSURE);
      scheduleRevert(player);
    }
    ObstacleRunner.run({ player }, [
      { anim: DIG },
      { sound: DIG_SOUND },
      { wait: 2 }, { anim: STUMBLE_BACK },
      { wait: 2 },
      { run: () => sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-use-spade-on-fissure") },
    ], { keepAnimation: true });
  }

  /** The spade at the mound: Dig from the inventory or the spade used on it. False when it isn't this dig. */
  function digMound(player) {
    if (ObstacleRunner.isBusy(player)) return true;
    const stage = sv.stage(player);
    if (stage < STAGE.SEARCHED_MOUND) return false;
    if (stage === STAGE.SEARCHED_MOUND) firstDig(player);
    else digAgain(player);
    return true;
  }

  function handleSpadeDig(event) {
    const { player } = event;
    if (!besideMound(event.location ?? player.getLocation()) || !digMound(player)) return false;
    event.handled = true;
    return true;
  }

  // --- The fissure ------------------------------------------------------------------------------
  function handleFissure(player, clickType) {
    const stage = sv.stage(player);
    if (stage < STAGE.ROPED_MOUND && !sv.complete(player)) {
      sv.scene(player, NPC.TRUFITUS, clickType === 1 ? "visiting-ah-za-rhoon-look-at-fissure" : "visiting-ah-za-rhoon-search-fissure");
      return;
    }
    if (clickType === 2 && sv.agilityLevel(player) < 32) {
      player.sendMessage("You need a level 32 agility to attempt this.");
      return;
    }
    sv.scene(player, NPC.TRUFITUS, clickType === 1
      ? "visiting-ah-za-rhoon-look-at-fissure-after-rope-is-attached"
      : "visiting-ah-za-rhoon-search-fissure-after-rope-is-attached");
  }

  function lightFissure(player, itemId) {
    if (sv.stage(player) >= STAGE.LIT_MOUND) {
      player.sendMessage("You have already seen inside the fissure.");
      return;
    }
    if (sv.stage(player) !== STAGE.DUG_MOUND || ownedFissure(player)?.getId() !== LOC.FISSURE) return;
    pendingLight.set(player, itemId);
    sv.scene(player, NPC.TRUFITUS, LIGHTS.get(itemId));
  }

  /** The rope: seq 827 two ticks on, and a tick later the roped fissure, stage 6 and the box (t2544-2547). */
  function ropeFissure(player) {
    const stage = sv.stage(player);
    if (stage < STAGE.LIT_MOUND) {
      player.sendMessage("It's too dark to clearly see where to fix that.");
      return;
    }
    if (stage >= STAGE.ROPED_MOUND) {
      player.sendMessage("There is already a rope attached!");
      return;
    }
    if (ObstacleRunner.isBusy(player)) return;
    ObstacleRunner.run({ player }, [
      { face: [MOUND_TILE.x + 1, MOUND_TILE.y + 1] },
      { wait: 2 }, { anim: PICK_UP },
      { wait: 1 },
      { run: () => {
        if (!sv.held(player, ITEM.ROPE)) return;
        sv.take(player, ITEM.ROPE);
        sv.advance(player, STAGE.ROPED_MOUND);
        placeFissure(player, LOC.ROPE_FISSURE);
        sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-use-rope-on-fissure");
      } },
    ], { keepAnimation: true });
  }

  /** Down the rope: the three lines a tick apart, 827 with the second, the cavern with the third (t2563-2566). */
  function climbDown(player) {
    ObstacleRunner.run({ player }, [
      { wait: 1 }, { msg: CLIMB_DOWN_LINES[0] },
      { wait: 1 }, { msg: CLIMB_DOWN_LINES[1] }, { anim: PICK_UP },
      { wait: 1 }, { msg: CLIMB_DOWN_LINES[2] },
      { run: () => sv.advance(player, STAGE.ENTERED_TEMPLE) },
      { tele: AH_ZA_RHOON_TILE },
    ]);
  }

  // --- Ah Za Rhoon ------------------------------------------------------------------------------
  function searchLooseRocks(player) {
    if (sv.complete(player)) return sv.scene(player, NPC.TRUFITUS, "post-quest-ah-za-rhoon-search-loose-rocks");
    sv.scene(player, NPC.TRUFITUS, sv.held(player, ITEM.TATTERED_SCROLL)
      ? "visiting-ah-za-rhoon-search-loose-rocks-after-taking-the-scroll"
      : "visiting-ah-za-rhoon-search-loose-rocks");
  }

  function searchOldSacks(player) {
    if (sv.complete(player)) return sv.scene(player, NPC.TRUFITUS, "post-quest-ah-za-rhoon-search-old-sacks");
    if (!sv.held(player, ITEM.CRUMPLED_SCROLL)) sv.give(player, ITEM.CRUMPLED_SCROLL);
    sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-search-old-sacks");
  }

  function corpseTaken(player) {
    return [ITEM.ZADIMUS_CORPSE, ITEM.BONE_SHARD, ITEM.BONE_KEY].some((id) => sv.held(player, id));
  }

  /** "You search the gallows..." in chat, and the box three ticks later (t2723-2733, t2755-2758). */
  function searchGallows(player, clickType) {
    if (sv.complete(player)) return sv.scene(player, NPC.TRUFITUS, "post-quest-ah-za-rhoon-look-at-or-search-the-ancient-gallows");
    if (clickType === 1) return sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-look-at-ancient-gallows");
    if (ObstacleRunner.isBusy(player)) return;
    const variant = corpseTaken(player)
      ? "visiting-ah-za-rhoon-search-ancient-gallows-after-taking-the-corpse"
      : "visiting-ah-za-rhoon-search-ancient-gallows";
    ObstacleRunner.run({ player }, [
      { msg: GALLOWS_SEARCH },
      { wait: 3 },
      { run: () => sv.scene(player, NPC.TRUFITUS, variant) },
    ]);
  }

  function handleStrangeStone(player, clickType) {
    if (sv.complete(player)) return sv.scene(player, NPC.TRUFITUS, "post-quest-ah-za-rhoon-look-at-or-investigate-strange-looking-stone");
    sv.scene(player, NPC.TRUFITUS, clickType === 1
      ? "visiting-ah-za-rhoon-look-at-strange-looking-stone"
      : "visiting-ah-za-rhoon-investigate-strange-looking-stone");
  }

  function handleSmashedTable(player, clickType) {
    if (clickType === 1) return sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-look-at-smashed-table");
    sv.scene(player, NPC.TRUFITUS, sv.mechTest(player, MECH.USED_TABLE_WOOD)
      ? "visiting-ah-za-rhoon-craft-smashed-table-after-using-up-the-wood"
      : "visiting-ah-za-rhoon-craft-smashed-table");
  }

  function cutPlaque(player) {
    if (sv.held(player, ITEM.STONE_PLAQUE)) {
      player.sendMessage("It looks as if something has been cut from this stone.");
      return;
    }
    sv.give(player, ITEM.STONE_PLAQUE);
    sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-use-chisel-on-strange-looking-stone");
  }

  function openScroll(player, scroll) {
    const sender = player.getPacketSender();
    sender.sendInterface(CacheDefinitions.getInterfaceId(scroll.group));
    for (let line = 1; line <= scroll.size; line++) {
      const text = scroll.lines[line - SCROLL_FIRST_LINE] ?? "";
      sender.sendString(text, CacheDefinitions.getComponentId(scroll.component(line)));
    }
  }

  // --- Zadimus ----------------------------------------------------------------------------------
  /** Bury or Drop: the corpse won't be dropped (t2763, t2783). */
  function buryZadimus(player) {
    if (ObstacleRunner.isBusy(player)) return;
    if (!inBox(player.getLocation(), SACRED_ZONE)) {
      ObstacleRunner.run({ player }, [
        { msg: BURY_LINES[0] },
        { wait: 2 },
        { run: () => sv.scene(player, NPC.SPIRIT_OF_ZADIMUS, "visiting-ah-za-rhoon-burying-the-zadimus-corpse-in-the-wrong-place") },
      ]);
      return;
    }
    ObstacleRunner.run({ player }, [
      { msg: BURY_LINES[0] },
      { wait: 2 }, { msg: BURY_LINES[1] }, { anim: DIG },
      { wait: 2 }, { msg: BURY_LINES[2] }, { anim: PICK_UP },
      { wait: 2 },
      { run: () => sv.scene(player, NPC.SPIRIT_OF_ZADIMUS, "visiting-ah-za-rhoon-burying-the-zadimus-corpse-in-the-right-place") },
    ]);
  }

  /** The box's continue: the smoke, and the spirit stands there for his line (t3205-3210). */
  function raiseSpirit(player) {
    mapAnim(player, SMOKEPUFF, SPIRIT_TILE, 5);
    const spirit = api.spawnNpc({
      id: NPC.SPIRIT_OF_ZADIMUS, x: SPIRIT_TILE[0], y: SPIRIT_TILE[1], z: player.getLocation().getZ(),
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    if (spirit) spirits.set(player, spirit);
  }

  function dismissSpirit(player) {
    const spirit = spirits.get(player);
    if (spirit) api.removeNpc(spirit);
    spirits.delete(player);
  }

  // --- Hooks ------------------------------------------------------------------------------------
  function handleObjectInteraction(event) {
    const { objectId, player, clickType } = event;
    if (objectId === LOC.MOUND_OF_EARTH) handleMound(player, clickType);
    else if (FISSURE_IDS.has(objectId)) handleFissure(player, clickType);
    else if (objectId === LOC.STRANGE_LOOKING_STONE) handleStrangeStone(player, clickType);
    else if (objectId === LOC.LOOSE_ROCKS) searchLooseRocks(player);
    else if (objectId === LOC.OLD_SACKS) searchOldSacks(player);
    else if (objectId === LOC.ANCIENT_GALLOWS) searchGallows(player, clickType);
    else if (objectId === LOC.SMASHED_TABLE) handleSmashedTable(player, clickType);
    else if (objectId === LOC.WATERFALL_ROCKS) {
      sv.scene(player, NPC.TRUFITUS, clickType === 1 ? "visiting-ah-za-rhoon-look-at-waterfall-rocks" : "visiting-ah-za-rhoon-search-waterfall-rocks");
    } else if (objectId === LOC.CAVE_IN) sv.scene(player, NPC.TRUFITUS, "visiting-ah-za-rhoon-search-cave-in");
    else return;
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === ITEM.SPADE && (objectId === LOC.MOUND_OF_EARTH || FISSURE_IDS.has(objectId))) {
      if (digMound(player)) event.handled = true;
    } else if (LIGHTS.has(itemId) && FISSURE_IDS.has(objectId)) {
      event.handled = true;
      lightFissure(player, itemId);
    } else if (itemId === ITEM.ROPE && FISSURE_IDS.has(objectId)) {
      event.handled = true;
      ropeFissure(player);
    } else if (itemId === ITEM.CHISEL && objectId === LOC.STRANGE_LOOKING_STONE) {
      event.handled = true;
      cutPlaque(player);
    }
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    let variant = null;
    if (itemId === ITEM.ZADIMUS_CORPSE && (option === "bury" || option === "drop")) {
      event.handled = true;
      buryZadimus(player);
      return;
    }
    if (option === "read" && itemId === ITEM.TATTERED_SCROLL) variant = "visiting-ah-za-rhoon-read-tattered-scroll";
    else if (option === "read" && itemId === ITEM.CRUMPLED_SCROLL) variant = "visiting-ah-za-rhoon-read-crumpled-scroll";
    else if (option === "read" && itemId === ITEM.STONE_PLAQUE) variant = "visiting-ah-za-rhoon-read-stone-plaque";
    else if (option === "inspect" && itemId === ITEM.BONE_SHARD) variant = "visiting-ah-za-rhoon-inspect-bone-shard";
    if (!variant) return;
    event.handled = true;
    sv.scene(player, NPC.TRUFITUS, variant);
  }

  function handleChoice(event) {
    const { player, option } = event;
    if (!player || event.npcId !== NPC.TRUFITUS) return;
    if (pendingLight.has(player) && (option === "Yes" || option === "No")) {
      if (option === "No") pendingLight.delete(player);
      else sv.later(player, 1, () => player.performAnimation(new api.core.Animation(PICK_UP)));
      return;
    }
    if (option === "Yes, I'll give it a go!" && sv.stage(player) >= STAGE.ROPED_MOUND && ownedFissure(player)?.getId() === LOC.ROPE_FISSURE) {
      event.end = true;
      climbDown(player);
    } else if (option === "Yes, I'll wriggle through.") {
      sv.teleport(player, player.getLocation().getY() > 9344 ? CAVE_IN_UPPER_TILE : CAVE_IN_LOWER_TILE);
    }
  }

  function handleLine(event) {
    if (!event.player || String(event.text ?? "") !== SCARY) return;
    // Said overhead as the box closes (t2490), not a chat line.
    event.skip = true;
    event.player.forceChat(SCARY);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (SENT_BY_SCRIPT.has(stepId)) {
      event.handled = true;
      return;
    }
    if (LIGHT_DROP_STEPS.has(stepId) && pendingLight.get(player) === LIGHT_DROP_STEPS.get(stepId)) {
      const light = pendingLight.get(player);
      event.box = { items: [light] };
      event.after = () => {
        pendingLight.delete(player);
        if (sv.stage(player) !== STAGE.DUG_MOUND || !sv.held(player, light)) return;
        sv.take(player, light);
        sv.advance(player, STAGE.LIT_MOUND);
      };
      return;
    }
    if (CANDLE_BURN_OUT_STEPS.has(stepId)) {
      event.box = { statement: true };
      return;
    }
    if (stepId === STEP_SCROLL_FROM_ROCKS) {
      if (!sv.held(player, ITEM.TATTERED_SCROLL)) sv.give(player, ITEM.TATTERED_SCROLL);
      return;
    }
    if (stepId === STEP_CORPSE_FROM_GALLOWS) {
      if (!corpseTaken(player)) sv.give(player, ITEM.ZADIMUS_CORPSE);
      sv.mechSet(player, MECH.FOUND_CORPSE, true);
      return;
    }
    if (stepId === STEP_SPIRIT_RISES) {
      const previous = event.after;
      event.after = () => { previous?.(); raiseSpirit(player); };
      return;
    }
    if (stepId === STEP_SHARD_INSPECT) {
      event.text = SHARD_INSPECT_TEXT;
      return;
    }
    if (stepId === ACTION_RECEIVE_BONE_SHARD) {
      event.handled = true;
      dismissSpirit(player);
      if (sv.held(player, ITEM.ZADIMUS_CORPSE)) sv.swapInSlot(player, ITEM.ZADIMUS_CORPSE, ITEM.BONE_SHARD);
      else if (!sv.held(player, ITEM.BONE_SHARD)) sv.give(player, ITEM.BONE_SHARD);
      return;
    }
    if (stepId === ACTION_ENTER_TEMPLE) {
      event.handled = true;
      sv.advance(player, STAGE.ENTERED_TEMPLE);
      sv.teleport(player, AH_ZA_RHOON_TILE);
      return;
    }
    const scroll = SCROLLS[stepId];
    if (scroll) {
      event.handled = true;
      event.end = true;
      sv.mechSet(player, scroll.mech, true);
      // After the dialogue's own close, which would shut it too: a tick after the Yes (live: the same tick).
      sv.later(player, 0, () => openScroll(player, scroll));
    }
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    if (player && stepId === CONDITION_WATERFALL_SUCCESS) {
      sv.advance(player, STAGE.LEFT_TEMPLE);
      sv.teleport(player, WATERFALL_EXIT_TILE);
    }
  }

  /** The waterfall's success (no capture of it: the old answer, the path always holds). */
  function answerCondition({ stepId }) {
    if (stepId === CONDITION_WATERFALL_SUCCESS) return true;
    if (stepId === CONDITION_WATERFALL_FAILURE) return false;
    return null;
  }

  /** Ah Za Rhoon: leaving it any way at stage 7 is stage 8 (the glory teleport at t2882-2885). */
  function createAhZaRhoon() {
    return new (class AhZaRhoon extends Area {
      constructor() {
        super([new Boundary(AH_ZA_RHOON.minX, AH_ZA_RHOON.maxX, AH_ZA_RHOON.minY, AH_ZA_RHOON.maxY, 0)]);
      }

      postLeave(mobile, logout) {
        if (logout || !mobile.isPlayer?.()) return;
        if (sv.stage(mobile) === STAGE.ENTERED_TEMPLE) sv.advance(mobile, STAGE.LEFT_TEMPLE);
      }
    })();
  }

  /** Only the roped fissure outlasts a logout; the dug one would have turned back by then. */
  function handleLogin({ player }) {
    if (player && sv.stage(player) >= STAGE.ROPED_MOUND) placeFissure(player, LOC.ROPE_FISSURE);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearFissure(player);
    pendingLight.delete(player);
    dismissSpirit(player);
  }

  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction(handleItemAction);
  api.onItemAction("Spade", { Dig: handleSpadeDig });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.registerArea(createAhZaRhoon());

  return { ownedFissure, placeFissure, digMound, buryZadimus, openScroll, SCROLLS, MOUND_TILE, SACRED_ZONE };
};
