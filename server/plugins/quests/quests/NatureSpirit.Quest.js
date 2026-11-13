/**
 * Nature Spirit (members).
 *
 * The words come from the "Nature Spirit" transcript page. Drezel (9636),
 * Filliman Tarlock (943) and the Nature Spirit (944) are all indexed, so this
 * plugin supplies the variant selector, the prose-condition answers, the start
 * hook, the completion action and the key item interactions (mirror/journal on
 * Filliman, casting the Bloom spell, the stones, blessing the sickle, the pouch).
 *
 * Stages (varp 307) are live's own (RSProx capture NatureSpirit, revision 242.1;
 * docs/quests/nature-spirit/README.md has the ticks): 5 started, 10 entered the
 * swamp, 15 failed talk (Wiki), 20 spoken to Filliman, 25 shown the mirror, 30
 * given the journal, 35 received the spell, 40 blessed, 45 cast the spell, 50
 * picked the fungus, 55 shown it to Filliman, 60 ritual, 65 entered the grotto,
 * 70 transformed, 75 sickle blessed, 80 sickle Bloom cast, 85 produce picked, 90
 * pouch filled, then a ghast each (95/100/105), 110 complete. Each moves on the
 * line, box or tick live moves it on.
 *
 * The world edits live here too: the swamp gate writes stage 10, the washing
 * bowl at the camp hides the mirror, Filliman appears at the grotto entrance
 * for its owner, the Bloom spell sprouts fungi on a rotting log, the fungus and
 * spell go on the nature/spirit stones, the Nature Spirit blesses the silver
 * sickle and hands over the druid pouch, the blessed sickle blooms swamp plants
 * into pouch charges, and the swamp's invisible ghasts attack players (rotting
 * food, or 1-3 damage with none). A filled pouch spends a charge to reveal an
 * attacker instead, so its food stays fresh; using a filled pouch on one reveals
 * it too.
 */
module.exports = function registerNatureSpiritQuest(api) {
  const {
    Animation, Skill, Equipment, Location, Item, ItemOnGroundManager, Boundary, Area, GameObject,
    ObjectManager, MapObjects, RegionManager, World, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
    HitDamage, HitMask, CacheDefinitions, Graphic, Projectile, TaskManager, CountdownTask,
    DialogueChainBuilder, ItemStatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL; // 9636
  const FILLIMAN_NPC_ID = NpcIdentifiers.FILLIMAN_TARLOCK; // 943
  const NATURE_SPIRIT_NPC_ID = NpcIdentifiers.NATURE_SPIRIT; // 944
  const PAGE = "Nature Spirit";

  const VARP_NATURE_SPIRIT = 307;

  // Drezel's id is shared with Priest in Peril, whose plugin also answers the
  // 9636 variant; while that quest is under way it owns the conversation.
  const PRIEST_IN_PERIL_STAGE_ATTRIBUTE = "quest.priest_in_peril.stage";
  const PRIEST_IN_PERIL_STARTED = 10;
  const PRIEST_IN_PERIL_COMPLETE = 60;

  const STAGE_STARTED = 5;
  const STAGE_ENTERED_SWAMP = 10;
  const STAGE_FAILED_TALK = 15;
  const STAGE_SPOKEN_FILLIMAN = 20;
  const STAGE_SHOWN_MIRROR = 25;
  const STAGE_GIVEN_JOURNAL = 30;
  const STAGE_RECEIVED_SPELL = 35;
  const STAGE_BLESSED = 40;
  const STAGE_CAST_SPELL = 45;
  const STAGE_PICKED_FUNGI = 50;
  const STAGE_SHOWN_FUNGUS = 55;
  const STAGE_PERFORMED_RITUAL = 60;
  const STAGE_ENTERED_GROTTO = 65;
  const STAGE_FULL_TRANSFORM = 70;
  const STAGE_BLESSED_SICKLE = 75;
  const STAGE_CAST_SICKLE_BLOOM = 80;
  const STAGE_PICKED_PRODUCE = 85;
  const STAGE_FILLED_POUCH = 90;
  const STAGE_KILLED_GHAST_1 = 95;
  const STAGE_KILLED_GHAST_2 = 100;
  const STAGE_KILLED_GHAST_3 = 105;
  const STAGE_COMPLETE = 110;

  const GHOSTSPEAK_AMULET_ITEM_ID = ItemIdentifiers.GHOSTSPEAK_AMULET;
  const SILVER_SICKLE_ITEM_ID = ItemIdentifiers.SILVER_SICKLE;
  const SILVER_SICKLE_BLESSED_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_;
  const MIRROR_ITEM_ID = ItemIdentifiers.MIRROR;
  const JOURNAL_ITEM_ID = ItemIdentifiers.JOURNAL;
  const DRUIDIC_SPELL_ITEM_ID = ItemIdentifiers.DRUIDIC_SPELL;
  const USED_SPELL_ITEM_ID = ItemIdentifiers.A_USED_SPELL;
  const MEAT_PIE_ITEM_ID = ItemIdentifiers.MEAT_PIE;
  const APPLE_PIE_ITEM_ID = ItemIdentifiers.APPLE_PIE;
  const MORT_MYRE_FUNGUS_ITEM_ID = ItemIdentifiers.MORT_MYRE_FUNGUS; // 2970
  const MORT_MYRE_STEM_ITEM_ID = ItemIdentifiers.MORT_MYRE_STEM; // 2972
  const MORT_MYRE_PEAR_ITEM_ID = ItemIdentifiers.MORT_MYRE_PEAR; // 2974
  const DRUID_POUCH_EMPTY_ITEM_ID = ItemIdentifiers.DRUID_POUCH; // 2957
  const DRUID_POUCH_FILLED_ITEM_ID = ItemIdentifiers.DRUID_POUCH_2; // 2958
  const WASHING_BOWL_ITEM_ID = ItemIdentifiers.WASHING_BOWL; // 2964

  const START_HOOK = "quest:nature-spirit:start";
  const COMPLETE_ACTION_ID = "b8LYWU";

  /** Transcript message steps, by id. */
  const MESSAGE = {
    FOOD: "nzSJ79", // "Drezel hands you some food."
    APPARITION: "Y3pqcj", // "A shifting apparition appears in front of you."
    MIRROR_USED: "y4eX98",
    MIRROR_TAKEN: "hyx_Ag",
    JOURNAL_GIVEN: "JPq1Gd",
    JOURNAL_READ: "FzHQca",
    SPELL_GIVEN: "WT-fQ8", // "The druid produces a small sheet of papyrus..."
    FUNGUS_SHOWN: "W7dGyk",
    ANOTHER_SPELL: "wHMtUI",
    SICKLE_BLESSED: "RFkpjv",
    POUCH_GIVEN: "bf6r0R",
    JOURNAL_FOUND: "tTawrz",
    NOT_TOLD: "_QtVge", // "You've not been told how to use this item yet."
  };
  /** Transcript conditions played directly. */
  const CONDITION = {
    MIRROR: "ASJiE8",
    JOURNAL: "LvFssE",
    GHOSTSPEAK_MISSING: "GQYpTB",
    TREE_LOOK: "3y79CC",
    TREE_SEARCH: "gsdUlz",
    TREE_NOTHING: "H0VKDy",
    BROWN_WRONG: "PDtZnW",
    BROWN_FUNGUS: "rjopYY",
    BROWN_DONE: "oPaALi",
    GREY_WRONG: "mdfjrS",
    GREY_SPELL: "_Vi78y",
    GREY_USED_SPELL: "zHerHE",
    GREY_DONE: "vEPhiL",
    ORANGE_WRONG: "Bz7Aib",
    SEARCH_GREY: "Zovl4d",
    SEARCH_BROWN: "JrYd8C",
    SEARCH_ORANGE: "BRVnZe",
    POUCH_NOT_TOLD: "Bw4hVJ",
  };
  const FILLIMAN_ITEM_VARIANT = "finding-filliman-subsequent-dialogue-with-filliman";
  const ISLAND_VARIANT = "finding-filliman-entering-filliman-s-island";
  const GROVE_VARIANT = "entering-filliman-s-grove";

  /** The lines live moves the quest on (or plays a scene) at, as the transcript words them. */
  const LINE = {
    NOT_THE_TRUTH: "Don't be silly now! That in no way reflects the truth!",
    A_SIGN: "It must be a sign...",
    COMING_BACK: "It's all coming back to me now.",
    BLESSING_START: "Very well my friend, prepare yourself for the blessings of Saradomin.",
    BLESSING_CHANT: "Ashustru, blessidium, adverturasi, fidum!",
    FUNGUS_WONDERFUL: "Wonderful, the mushroom represents 'something from nature'.",
    RITUAL_TRY: "Oh really.. Have you placed all the items on the stones?",
    TRANSFORM_NOW: "I must complete the transformation now.",
    TRANSFORM_DONE: "Hmmm, good, the transformation is complete.",
    SICKLE_BLESSING: "My friend, I will bless it for you",
    QUEST_DONE: "Many thanks my friend, you have completed your quest!",
    ALTAR_WELCOME: "Welcome to my Altar to Nature!",
  };

  const FUNGUS_OFFERING_ATTRIBUTE = "nature-spirit:fungus-offering";
  const SPELL_OFFERING_ATTRIBUTE = "nature-spirit:spell-offering";

  const SWAMP_GATE_IDS = new Set([ObjectIdentifiers.GATE_72, ObjectIdentifiers.GATE_73]); // 3506/3507
  const SWAMP_GATE_PASSAGE = { minX: 3443, maxX: 3444, y: 3458 }; // cache gate leaves; Doors Mort Myre pair
  const GROTTO_ID = ObjectIdentifiers.GROTTO; // 3516 surface entrance
  const GROTTO_TREE_ID = ObjectIdentifiers.GROTTO_TREE; // 3517
  const GROTTO_POOL_ID = ObjectIdentifiers.GROTTO_2; // 3520, Search summons the spirit
  const GROTTO_EXIT_IDS = new Set([ObjectIdentifiers.GROTTO_3, ObjectIdentifiers.GROTTO_4]); // 3525/3526
  const SICKLE_BLESSING_OBJECT_IDS = new Set([GROTTO_POOL_ID, ObjectIdentifiers.ALTAR_OF_NATURE]);

  const ROTTING_LOG_ID = ObjectIdentifiers.ROTTING_LOG; // 3508
  const FUNGI_ON_LOG_ID = ObjectIdentifiers.FUNGI_ON_LOG; // 3509
  const ROTTING_BRANCH_ID = ObjectIdentifiers.ROTTING_BRANCH; // 3510
  const BUDDING_BRANCH_ID = ObjectIdentifiers.BUDDING_BRANCH; // 3511
  const SMALL_BUSH_ID = ObjectIdentifiers.SMALL_BUSH; // 3512
  const GOLDEN_PEAR_BUSH_ID = ObjectIdentifiers.GOLDEN_PEAR_BUSH; // 3513
  const NATURE_STONE_ID = ObjectIdentifiers.STONE; // 3527 west, nature (brown)
  const FAITH_STONE_ID = ObjectIdentifiers.STONE_2; // 3528 south, faith (orange)
  const SPIRIT_STONE_ID = ObjectIdentifiers.STONE_3; // 3529 east, spirit (grey)

  const GHAST_VISIBLE_NPC_ID = NpcIdentifiers.GHAST_2; // 946, the level 30 ghast
  /** Every invisible version placed in Mort Myre (the Wiki lists 945 and 5622-5624). */
  const INVISIBLE_GHAST_IDS = new Set([
    NpcIdentifiers.GHAST,
    NpcIdentifiers.GHAST_3,
    NpcIdentifiers.GHAST_4,
    NpcIdentifiers.GHAST_5,
  ]);
  const GHAST_ATTACK_RANGE = 8;
  /** Not in the Wiki: how often one player may be attacked, in game ticks (the capture's are 26-29 apart). */
  const GHAST_ATTACK_MIN_DELAY = 12;
  const GHAST_ATTACK_MAX_DELAY = 30;
  /** Wiki: ghasts have a 7/10 chance of missing completely. */
  const GHAST_MISS_CHANCE = 0.7;
  /** Wiki: the easy Morytania diary gives a 50% chance the ghast ignores the player. */
  const GHAST_DIARY_IGNORE_CHANCE = 0.5;
  const ROTTEN_FOOD_ITEM_ID = ItemIdentifiers.ROTTEN_FOOD;

  /** Capture ticks 233, 285, 1257: the invisible ghast's attack. */
  const GHAST = {
    attackAnimation: 1093, // inv_ghast_attack
    attackSound: 433, // ghast_attack
    rotSound: 1494, // food_rot
    appearSound: 432, // ghast_appear
    missShout: "OOooooohhh",
    rotShout: "Oouuaarrr!",
    missMessage: "An attacking Ghast just misses you.",
    rotMessage: "You feel something attacking your backpack, and smell a terrible stench.",
    revealMessage: "The druid pouch makes the Ghast visible.",
    revealGraphic: 269, // druidpouch_impact, delay 90, height 124 on the player
    revealProjectile: 268, // druid_shooting_star from the player to the ghast
    revealTicks: 2, // the visible form two ticks after the reveal
  };

  /** What casting Bloom on each rotting plant grows. */
  const BLOOMED_PLANT = new Map([
    [ROTTING_LOG_ID, FUNGI_ON_LOG_ID],
    [ROTTING_BRANCH_ID, BUDDING_BRANCH_ID],
    [SMALL_BUSH_ID, GOLDEN_PEAR_BUSH_ID],
  ]);
  /** What each bloomed plant yields when picked. */
  const PLANT_HARVEST = new Map([
    [FUNGI_ON_LOG_ID, MORT_MYRE_FUNGUS_ITEM_ID],
    [BUDDING_BRANCH_ID, MORT_MYRE_STEM_ITEM_ID],
    [GOLDEN_PEAR_BUSH_ID, MORT_MYRE_PEAR_ITEM_ID],
  ]);
  /** The sound each plant makes as it blooms (capture 868, 1235; 1492 bloom_pears for the bush). */
  const BLOOM_PLANT_SOUND = new Map([
    [ROTTING_LOG_ID, { id: 1491, loops: 30 }],
    [ROTTING_BRANCH_ID, { id: 1489, loops: 1 }],
    [SMALL_BUSH_ID, { id: 1492, loops: 1 }],
  ]);
  const SPELL_BLOOMABLE_IDS = new Set([ROTTING_LOG_ID]);
  const SICKLE_BLOOMABLE_IDS = new Set(BLOOMED_PLANT.keys());
  /** Charges each piece of nature's bounty puts in the pouch (capture 1248: a fungus and two stems make five). */
  const POUCH_CHARGES = new Map([
    [MORT_MYRE_FUNGUS_ITEM_ID, 1],
    [MORT_MYRE_STEM_ITEM_ID, 2],
    [MORT_MYRE_PEAR_ITEM_ID, 3],
    [ItemIdentifiers.VINE_FLOWER, 1],
  ]);
  const POUCH_FILL_ITEMS = 3;
  const POUCH_FILL_SOUND = 3616; // lunar_hunter_kit_inv
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const BLOOM_RADIUS = 1;
  const SICKLE_BLOOM_ANIMATION = 1100; // druidicspirit_human_bloom
  const CAST_ANIMATION = 811; // human_casting
  const PRAY_ANIMATION = 645; // human_pray
  const PICK_ANIMATION = 827; // human_pickupfloor
  const PICK_SOUND = 2581;
  const BLOOM_PLAYER_GRAPHIC = 264; // druidicspirit_bloom_player_spotanim
  const BLOOM_PLANT_GRAPHIC = 263; // druidicspirit_bloom_spotanim
  const SHOOTING_STAR = 268; // druid_shooting_star
  const SPIRIT_EFFECT_GRAPHIC = 266; // druidicspirit_effect
  const PRIEST_BLESS_GRAPHIC = 259; // druidicspirit_priest_bless
  const DRUIDS_SHIELD_GRAPHIC = 255; // druidicspirit_druidsshield
  const BLOOM_SOUND = 1493; // cast_bloom
  const SPIRIT_TRANSFORM_SOUND = 1490;
  const SPIRIT_TRANSFORM_START_SOUND = 1495;
  const BLOOM_PEARS_SOUND = 1492;
  const PRAYER_RECHARGE_SOUND = 2674;
  const FIRE_BOLT_SOUND = 2340;
  /** Capture 866-868: the spell's effect two ticks after the cast. */
  const SPELL_DELAY_TICKS = 2;
  /** Capture 1234-1235: the sickle's plants a tick after the cast. */
  const SICKLE_DELAY_TICKS = 1;
  const BLOOM_DELAY_TICKS = 3; // the cache animation lasts 64 client cycles
  // Inferred from capture 1635: 145/214 eligible logs and 19/26 branches bloom.
  const BLOOM_SUCCESS_CHANCE = 2 / 3;
  const POUCH_DELAY_TICKS = 1; // the cache effect lasts 18 client cycles
  /** Capture 364-464, 473-573, 933-1033: Filliman stays a hundred ticks after he appears or changes. */
  const SPIRIT_LIFETIME_TICKS = 100;

  // Capture tick 1057: the grotto entrance lands here (and on plane 1 once the quest is done, 1614).
  const GROTTO_INTERIOR = { x: 3442, y: 9734 };
  // rsprox 227/01846.txt tick 4478 (also 226/01638, 226/01695, 227/00101, NatureSpirit 1178): the exit lands here.
  const GROTTO_SURFACE = { x: 3440, y: 3337, z: 0 };
  const FILLIMAN_CAMP = { x: 3440, y: 3336, z: 0 };
  /** Capture 1069: where Searching the grotto brings Filliman before he transforms (and after, 1099). */
  const GROTTO_SPIRIT_TILE = { x: 3443, y: 9738, z: 0 };
  /** Capture 1460: where he comes once the three ghasts are dead. */
  const GROTTO_RETURN_TILE = { x: 3441, y: 9736, z: 0 };
  /** Capture 1474-1482: where he stands on the finished grotto's plane. */
  const ALTAR_SPIRIT_TILE = { x: 3441, y: 9738, z: 1 };
  const WASHING_BOWL_TILE = { x: 3437, y: 3337, z: 0 };
  /** Capture 463: the mirror under the bowl lies for 200 ticks, for its finder only. */
  const MIRROR_DESPAWN_TICKS = 200;
  /** Ours: Filliman's island, between the bridge (y 3331) and the grotto. Leaving it loses him (capture 607-639). */
  const ISLAND_BOUNDS = new Boundary(3434, 3446, 3331, 3343, 0);
  /** The three ritual stones and Filliman's faith stone (capture 1040). */
  const RITUAL_STONE_TILES = [[3440, 3334], [3442, 3336], [3438, 3336]];
  /** Capture 1073: the stars that change Filliman, from the grotto's edges. */
  const TRANSFORM_STARS = [
    [3444, 9742, 116], [3444, 9738, 86], [3444, 9736, 96], [3438, 9742, 126],
    [3439, 9736, 116], [3439, 9738, 116], [3442, 9735, 106],
  ];
  /** Capture 1115: the stars that bless the sickle, from the grotto water. */
  const SICKLE_STARS = [[3441, 9741, 130], [3442, 9741, 130], [3441, 9740, 130], [3442, 9740, 120]];
  /** Capture 1467: the stars that make the grotto an altar. */
  const ALTAR_STARS = [[3444, 9742, 136], [3442, 9737, 86], [3438, 9742, 136]];
  /**
   * Mort Myre swamp: the ghasts the pouch can reveal all live inside. Its north edge is the Gate's
   * fence (the gate leaves are on y 3458, SWAMP_GATE_PASSAGE): y 3480 took in Canifis's south half,
   * its bank included (booths at 3513, 3478-3483).
   */
  const SWAMP_BOUNDS = new Boundary(3380, 3590, 3310, 3457, 0);
  /** North of the fence: the gate leaves' row and the two rows a walk or run through them starts from. */
  const SWAMP_GATE_APPROACH_BOUNDS = new Boundary(SWAMP_GATE_PASSAGE.minX - 2, SWAMP_GATE_PASSAGE.maxX + 2,
    SWAMP_GATE_PASSAGE.y, SWAMP_GATE_PASSAGE.y + 2, 0);

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGhostspeak = (player) =>
    player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ITEM_ID;
  const actionOf = (event) =>
    String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  const inGrotto = (player) => {
    const at = player.getLocation();
    return at.getX() >= 3435 && at.getX() <= 3448 && at.getY() >= 9733 && at.getY() <= 9746;
  };
  const tile = ([x, y], z) => new Location(x, y, z);
  /** Live's filterable channel (capture 233, 873, 1240: type spam). */
  const spam = (player, text) => player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);
  const sound = (player, id, loops = 1, delay = 0) => player.getPacketSender().sendSoundEffect(id, loops, delay, 0);
  /** Runs `step` `ticks` game ticks from now (0 = now), for this player. */
  const later = (player, ticks, step) => {
    if (ticks <= 0) return step();
    TaskManager.submit(new CountdownTask(player, ticks, step));
  };
  /** A druid's shooting star at `to` (a mobile follows it), heights as the capture gives them (sent / 4). */
  function star(from, to, lockon, start, end, startHeight, endHeight, angle) {
    const projectile = new Projectile(from, to, lockon, SHOOTING_STAR, start, end, startHeight / 4, endHeight / 4, null);
    if (angle !== undefined) projectile.withAngle(angle);
    projectile.sendProjectile();
  }
  /** Three druidicspirit_effect bursts on a tile (capture 1042, 1074, 1468). */
  function spiritBursts(player, at, delays) {
    const heights = [128, 64, 0];
    delays.forEach((delay, index) => player.getPacketSender().sendGraphic(new Graphic(SPIRIT_EFFECT_GRAPHIC, delay, heights[index]), at));
  }

  /** Owner-only quest NPC spawns (Filliman at the camp and in the grotto). */
  const spawnedByPlayer = new Map();
  const swampGateApproach = new WeakMap();
  const nextBloom = new WeakMap();
  const nextPouch = new WeakMap();
  /** The spawn each player's current lifetime countdown belongs to, so an older countdown does nothing. */
  const spiritLease = new WeakMap();

  function trackSpawn(player, npc) {
    if (!npc) return npc;
    const set = spawnedByPlayer.get(player) ?? new Set();
    set.add(npc);
    spawnedByPlayer.set(player, set);
    return npc;
  }

  function clearSpawns(player) {
    const set = spawnedByPlayer.get(player);
    if (set) for (const npc of set) api.removeNpc(npc);
    spawnedByPlayer.delete(player);
  }

  function removeSpawn(player, npc) {
    const set = spawnedByPlayer.get(player);
    if (!set?.has(npc)) return;
    api.removeNpc(npc);
    set.delete(npc);
  }

  /** The Filliman (or Nature Spirit) this player sees, if one is up. */
  function spiritOf(player) {
    for (const npc of spawnedByPlayer.get(player) ?? []) {
      if (npc?.isRegistered?.() !== false) return npc;
    }
    return null;
  }

  /** Filliman stays a hundred ticks after he appears or transforms, then goes. */
  function leaseSpirit(player, npc) {
    const lease = {};
    spiritLease.set(npc, lease);
    later(npc, SPIRIT_LIFETIME_TICKS, () => {
      if (spiritLease.get(npc) === lease) removeSpawn(player, npc);
    });
  }

  /** Brings up Filliman for his owner, replacing one elsewhere (another tile, plane or form). */
  function summonSpirit(player, npcId, at, { lease = true } = {}) {
    const current = spiritOf(player);
    if (current) {
      const where = current.getLocation();
      const id = current.getNpcTransformationId?.() >= 0 ? current.getNpcTransformationId() : current.getId();
      if (id === npcId && where.getX() === at.x && where.getY() === at.y && where.getZ() === at.z) return current;
      removeSpawn(player, current);
    }
    const npc = trackSpawn(player, api.spawnNpc({
      id: npcId, x: at.x, y: at.y, z: at.z, wanderRadius: 0, owner: player, ownerOnly: true,
    }));
    if (npc && lease) leaseSpirit(player, npc);
    return npc ?? null;
  }

  /**
   * The visible ghasts we spawned, by NPC: the invisible source it stands for and the owner
   * who can see it. The source stays in the world (and in the player's local NPCs), so this
   * association is what keeps one source to one visible form.
   */
  const visibleGhasts = new Map();
  /** Sources revealed but whose visible form is still on its way (capture: two ticks), per player. */
  const pendingReveals = new WeakMap();

  /** The visible form this player already sees for an invisible ghast, if any. */
  function visibleGhastFor(player, source) {
    for (const [npc, reveal] of visibleGhasts) {
      if (reveal.source === source && reveal.owner === player) return npc;
    }
    return null;
  }

  function revealPending(player, source) {
    return pendingReveals.get(player)?.has(source) === true;
  }

  /** The game cycle each player's next ghast attack may happen on. */
  const ghastNextAttack = new WeakMap();

  /** Swap a scenery object for another id in place (the reference's loc change). */
  function replaceObject(object, newId) {
    if (!object) return;
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  /** Every adjacent plant, deduplicating the map and runtime views of a loc. */
  function bloomablePlants(player, bloomableIds) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    const z = location.getZ();
    const plants = new Map();
    const consider = (object) => {
      if (!bloomableIds.has(object.getId())) return;
      if ((object.getPrivateArea() ?? null) !== (player.getPrivateArea?.() ?? null)) return;
      const objectLocation = object.getLocation();
      if (objectLocation.getZ() !== z) return;
      const distance = Math.max(
        Math.abs(objectLocation.getX() - x),
        Math.abs(objectLocation.getY() - y)
      );
      if (distance > BLOOM_RADIUS) return;
      plants.set(`${objectLocation.getX()},${objectLocation.getY()},${object.getType()}`, object);
    };
    // Cache/map locs live in MapObjects; only runtime objects are in World.
    RegionManager.loadMapFiles(x, y);
    for (let dx = -BLOOM_RADIUS; dx <= BLOOM_RADIUS; dx++) {
      for (let dy = -BLOOM_RADIUS; dy <= BLOOM_RADIUS; dy++) {
        for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x + dx, y + dy, z)) ?? []) {
          consider(object);
        }
      }
    }
    for (const object of World.getObjects()) {
      consider(object);
    }
    return [...plants.values()];
  }

  /** The bloom effect on the eight tiles around the player (capture 868 for the spell, 1235 for the sickle). */
  function bloomTiles(player, delay, height) {
    const at = player.getLocation();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) player.getPacketSender().sendGraphic(new Graphic(BLOOM_PLANT_GRAPHIC, delay, height),
        new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
    }
  }

  function growPlant(player, plant) {
    const bloomSound = BLOOM_PLANT_SOUND.get(plant.getId());
    replaceObject(plant, BLOOMED_PLANT.get(plant.getId()));
    if (bloomSound) sound(player, bloomSound.id, bloomSound.loops);
  }

  /** Both ritual offerings sit on their stones. */
  function ritualReady(player) {
    return Boolean(player.getAttribute(FUNGUS_OFFERING_ATTRIBUTE)) &&
      Boolean(player.getAttribute(SPELL_OFFERING_ATTRIBUTE));
  }

  /**
   * The washing bowl on the camp bench. The world spawn carries it in ground-items.json; if a
   * world has lost it, put one back so the quest can still be finished.
   */
  function ensureWashingBowl(player) {
    const position = new Location(WASHING_BOWL_TILE.x, WASHING_BOWL_TILE.y, WASHING_BOWL_TILE.z);
    const present = ItemOnGroundManager.getGroundItem(null, WASHING_BOWL_ITEM_ID, position, null) ??
      ItemOnGroundManager.getGroundItem(
        player.getUsername(),
        WASHING_BOWL_ITEM_ID,
        position,
        player.getPrivateArea()
      );
    if (present) return;
    ItemOnGroundManager.registerLocation(player, new Item(WASHING_BOWL_ITEM_ID, 1), position);
  }

  /**
   * Spawn the visible form where the invisible ghast stands, owned by the player who saw it.
   * The invisible source is never removed (it is a shared world spawn), so a source that is
   * already revealed for this player keeps the form it has instead of growing another copy.
   */
  function spawnVisibleGhast(player, ghast) {
    const existing = visibleGhastFor(player, ghast);
    if (existing) return existing;
    const location = ghast.getLocation();
    const visible = api.spawnNpc({
      id: GHAST_VISIBLE_NPC_ID,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: GHAST_ATTACK_RANGE,
      owner: player,
      ownerOnly: true,
    });
    if (visible) {
      visible.__skipDefaultRespawn = true;
      visibleGhasts.set(visible, { owner: player, source: ghast });
      visible.getCombat().attack(player);
    }
    return visible ?? null;
  }

  /**
   * A filled pouch spent to make a ghast visible (capture 1257, 1310): the line, the player's
   * block, the impact on the player, a star at the ghast and its appearing sound; the attackable
   * form two ticks later.
   */
  function revealGhast(player, ghast) {
    // Already visible (or on its way) to this player: spending a charge would reveal nothing new.
    if (visibleGhastFor(player, ghast) || revealPending(player, ghast)) return true;
    if (!held(player, DRUID_POUCH_FILLED_ITEM_ID)) {
      player.sendMessage("You have nothing left in your druid pouch!");
      return false;
    }
    player.getInventory().deleteNumber(DRUID_POUCH_FILLED_ITEM_ID, 1);
    if (!held(player, DRUID_POUCH_FILLED_ITEM_ID)) player.getInventory().adds(DRUID_POUCH_EMPTY_ITEM_ID, 1);
    player.sendMessage(GHAST.revealMessage);
    const block = player.getBlockAnim?.();
    if (Number.isInteger(block) && block >= 0) player.performAnimation(new Animation(block));
    player.performGraphic(new Graphic(GHAST.revealGraphic, 90, 124));
    ghast.performAnimation?.(new Animation(GHAST.attackAnimation));
    const projectile = new Projectile(player.getLocation(), ghast.getLocation(), ghast, GHAST.revealProjectile,
      51, 90, 172 / 4, 124 / 4, null).withAngle(16).withProgress(64);
    projectile.sendProjectile();
    sound(player, GHAST.appearSound);
    const pending = pendingReveals.get(player) ?? new Set();
    pending.add(ghast);
    pendingReveals.set(player, pending);
    later(player, GHAST.revealTicks, () => {
      pending.delete(ghast);
      if (player.isRegistered?.() === false) return;
      spawnVisibleGhast(player, ghast);
    });
    return true;
  }

  /** The easy Morytania diary makes half of the ghasts ignore the player (Wiki). */
  function easyMorytaniaDiary(player) {
    const request = { player, diary: "morytania", tier: "easy", complete: false };
    api.emitCustomEvent("diary:is-complete", request);
    return request.complete === true;
  }

  function nearestInvisibleGhast(player) {
    const location = player.getLocation();
    let nearest = null;
    let nearestDistance = GHAST_ATTACK_RANGE + 1;
    for (const npc of player.getLocalNpcs?.() ?? []) {
      if (!INVISIBLE_GHAST_IDS.has(npc?.getId?.())) continue;
      if (visibleGhastFor(player, npc) || revealPending(player, npc)) continue;
      const at = npc.getLocation?.();
      if (!at || at.getZ() !== location.getZ()) continue;
      const distance = Math.max(Math.abs(at.getX() - location.getX()), Math.abs(at.getY() - location.getY()));
      if (distance < nearestDistance) {
        nearest = npc;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /** Food is what the cache gives an Eat action; potions and raw/inedible items stay put. */
  function isFoodItem(itemId) {
    const definition = CacheDefinitions.getItem(itemId);
    if (!definition || definition.noteTemplate >= 0) return false;
    return (definition.inventoryActions ?? []).some((action) => String(action).toLowerCase() === "eat");
  }

  function hasFood(player) {
    return (player.getInventory().getItems?.() ?? []).some((item) => item && isFoodItem(item.getId()));
  }

  function wearsMorytaniaLegs4(player) {
    return player.getEquipment?.()?.get?.(Equipment.LEG_SLOT)?.getId?.() === ItemIdentifiers.MORYTANIA_LEGS_4;
  }

  /** The dish a food leaves when eaten (Food's data): a rotted pie leaves its pie dish (capture 285, 632). */
  function foodContainer(itemId) {
    const request = { itemId, container: null };
    api.emitCustomEvent("food:container", request);
    return Number.isInteger(request.container) ? request.container : null;
  }

  /**
   * The first edible item in the pack rots, false with nothing to rot. A pie becomes its dish in
   * its own slot and the rotten food goes in a free one (capture 285: slot 18 dish, 24 rotten);
   * other food turns into rotten food where it is (632).
   */
  function rotFood(player) {
    const inventory = player.getInventory();
    const items = inventory.getItems?.() ?? [];
    for (const item of items) {
      if (!item || !isFoodItem(item.getId())) continue;
      const dish = foodContainer(item.getId());
      if (item.getAmount() > 1) {
        inventory.deleteNumber(item.getId(), 1);
        if (dish !== null) inventory.adds(dish, 1);
        inventory.adds(ROTTEN_FOOD_ITEM_ID, 1);
      } else if (dish !== null && inventory.getFreeSlots() > 0) {
        item.setId(dish);
        inventory.refreshItems();
        inventory.adds(ROTTEN_FOOD_ITEM_ID, 1);
      } else {
        item.setId(ROTTEN_FOOD_ITEM_ID);
        inventory.refreshItems();
      }
      return true;
    }
    return false;
  }

  /** The ghast's lunge (capture 233): the player blocks, the ghast shouts and strikes. */
  function ghastLunge(player, ghast, shout) {
    const block = player.getBlockAnim?.();
    if (Number.isInteger(block) && block >= 0) player.performAnimation(new Animation(block));
    ghast.performAnimation?.(new Animation(GHAST.attackAnimation));
    if (shout) ghast.forceChat?.(shout);
    sound(player, GHAST.attackSound);
  }

  /**
   * A ghast's attack: on Filliman's island his camp's aura turns it away (Wiki "Whilst inside the
   * island"; capture 499); a filled druid pouch spends a charge to reveal the attacker instead
   * (so no food is rotted and no damage is taken), else 7/10 miss, else rot one food item or hit
   * 1-3 when there is none. Only a filled pouch reveals an attackable form. The Wiki gives the
   * roll but neither the interval nor the exact retreat, so one player sees an attempt every
   * 12-30 ticks. Once revealed, the visible form owns ordinary combat; its invisible source must
   * not keep rotting food or applying a second attack alongside it.
   */
  function ghastAttack(player, ghast) {
    const cycle = World.getProcessCycle();
    ghastNextAttack.set(player, cycle + GHAST_ATTACK_MIN_DELAY
      + Math.floor(Math.random() * (GHAST_ATTACK_MAX_DELAY - GHAST_ATTACK_MIN_DELAY + 1)));
    if (ISLAND_BOUNDS.inside(player.getLocation())) {
      player.sendMessage("The aura of Fillimans camp protects you from the swamp.");
      player.performGraphic(new Graphic(DRUIDS_SHIELD_GRAPHIC, 30));
      return;
    }
    if (easyMorytaniaDiary(player) && Math.random() < GHAST_DIARY_IGNORE_CHANCE) return;
    // The filled pouch is the defence the Wiki documents: it spends a charge to reveal the
    // ghast, which costs neither food nor health. revealGhast() spends nothing when the
    // source is already visible to this player, so repeat attacks cannot burn charges.
    if (held(player, DRUID_POUCH_FILLED_ITEM_ID) && revealGhast(player, ghast)) return;
    if (Math.random() < GHAST_MISS_CHANCE) {
      spam(player, GHAST.missMessage);
      ghastLunge(player, ghast, GHAST.missShout);
      return;
    }
    // Wiki (Morytania legs 4): worn, they completely block the attack that turns food rotten.
    if (wearsMorytaniaLegs4(player) && hasFood(player)) return;
    if (rotFood(player)) {
      player.sendMessage(GHAST.rotMessage);
      ghastLunge(player, ghast, GHAST.rotShout);
      sound(player, GHAST.rotSound);
      return;
    }
    // Ours: no capture shows the foodless hit; the lunge without a shout.
    ghastLunge(player, ghast, null);
    player.getCombat().getHitQueue().addPendingDamage([
      new HitDamage(1 + Math.floor(Math.random() * 3), HitMask.RED),
    ]);
  }

  /**
   * Three pieces of nature's bounty, the first three in the pack (capture 1248, 1299), go in the
   * pouch: a fungus is one charge, a stem two, a pear three.
   */
  function fillPouch(player) {
    const inventory = player.getInventory();
    if (!held(player, DRUID_POUCH_EMPTY_ITEM_ID) && !held(player, DRUID_POUCH_FILLED_ITEM_ID)) return false;
    const produce = [];
    for (const item of inventory.getItems?.() ?? []) {
      if (produce.length >= POUCH_FILL_ITEMS) break;
      const id = item?.getId?.();
      if (!POUCH_CHARGES.has(id)) continue;
      for (let n = 0; n < item.getAmount() && produce.length < POUCH_FILL_ITEMS; n++) produce.push(id);
    }
    if (produce.length < POUCH_FILL_ITEMS) {
      player.sendMessage("You need at least three blossomed items to add something to the druid pouch.");
      return true;
    }
    for (const id of produce) inventory.deleteNumber(id, 1);
    if (held(player, DRUID_POUCH_EMPTY_ITEM_ID)) inventory.deleteNumber(DRUID_POUCH_EMPTY_ITEM_ID, 1);
    const charges = produce.reduce((sum, id) => sum + POUCH_CHARGES.get(id), 0);
    inventory.adds(DRUID_POUCH_FILLED_ITEM_ID, charges);
    player.sendMessage(`You add ${NUMBER_WORDS[charges] ?? charges} harvested items to your druid pouch.`);
    sound(player, POUCH_FILL_SOUND);
    const stage = quest.getStage(player);
    if (stage >= STAGE_PICKED_PRODUCE && stage < STAGE_FILLED_POUCH) quest.setStage(player, STAGE_FILLED_POUCH);
    return true;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I helped Filliman become a Nature Spirit.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_FILLED_POUCH) {
      const killed = stage >= STAGE_KILLED_GHAST_3 ? 3 : stage >= STAGE_KILLED_GHAST_2 ? 2 : stage >= STAGE_KILLED_GHAST_1 ? 1 : 0;
      return [
        `I have released ${killed} of the 3 Ghasts.`,
        killed === 3
          ? "Return to the <col=800000>Nature Spirit</col>."
          : "Defeat Ghasts with charges from my druid pouch.",
      ];
    }
    if (stage >= STAGE_BLESSED_SICKLE) {
      return [
        "Use the blessed sickle to make swamp plants bloom,",
        "then fill the <col=800000>druid pouch</col> with their produce.",
      ];
    }
    if (stage >= STAGE_FULL_TRANSFORM) {
      return ["Bring the Nature Spirit a <col=800000>silver sickle</col> to bless."];
    }
    if (stage >= STAGE_PERFORMED_RITUAL) {
      return ["Enter the grotto and speak to Filliman to complete his transformation."];
    }
    if (stage >= STAGE_PICKED_FUNGI) {
      return [
        "Place the fungus on the nature stone and the used spell on",
        "the spirit stone, then speak to Filliman on the faith stone.",
      ];
    }
    if (stage >= STAGE_BLESSED) {
      return ["Pick <col=800000>Mort myre fungus</col> grown by the Bloom spell."];
    }
    if (stage >= STAGE_RECEIVED_SPELL) {
      return ["Ask <col=800000>Drezel</col> to bless me, then cast Filliman's spell in the swamp."];
    }
    if (stage >= STAGE_GIVEN_JOURNAL) {
      return ["Ask Filliman how I can help him become a nature spirit."];
    }
    if (stage >= STAGE_SHOWN_MIRROR) {
      return ["Find Filliman's <col=800000>journal</col> in the grotto tree and give it to him."];
    }
    if (stage >= STAGE_ENTERED_SWAMP) {
      return ["Wear an amulet of ghostspeak, find a mirror, and convince Filliman he is dead."];
    }
    if (stage >= STAGE_STARTED) {
      return ["Enter Mort Myre swamp and find <col=800000>Filliman Tarlock</col>."];
    }
    return ["I can start this quest by talking to <col=800000>Drezel</col> in the basement of the <col=800000>Paterdomus Temple</col>."];
  }

  /** Capture 1474: the grotto becomes the altar of nature on plane 1, and the player is moved up with it. */
  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3000);
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 2000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 2000);
    if (inGrotto(player) && player.getLocation().getZ() === 0) {
      const at = player.getLocation();
      player.sendMessage("You see a beautifully tended small grotto area.");
      player.moveTo(new Location(at.getX(), at.getY(), 1));
    }
  }

  function drezelVariant(stage) {
    // Once complete, Drezel returns to his canonical post-quest page. The quest
    // transcript variants stop at the blessing/ghast conversations.
    if (stage >= STAGE_COMPLETE) {
      return { page: "Drezel", variant: "standard-dialogue-after-priest-in-peril-after-nature-spirit" };
    }
    if (stage === STAGE_RECEIVED_SPELL) return "talking-to-drezel";
    if (stage >= STAGE_ENTERED_GROTTO) return "entering-filliman-s-grove-talking-to-drezel";
    if (stage >= STAGE_BLESSED) return "talking-to-drezel-subsequent-dialogue-with-drezel";
    if (stage === STAGE_FAILED_TALK) {
      return "finding-filliman-talking-to-drezel-after-talking-to-filliman-without-a-ghostspeak-amulet";
    }
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-drezel-again";
    return "starting-off-talking-to-drezel";
  }

  function fillimanVariant(stage, player) {
    if (stage >= STAGE_COMPLETE) {
      return "returning-to-filliman-s-grove-attempting-to-talk-to-him-again-before-he-disappears";
    }
    if (stage >= STAGE_KILLED_GHAST_3) return "returning-to-filliman-s-grove";
    if (stage >= STAGE_BLESSED_SICKLE) return "entering-filliman-s-grove-subsequent-dialogue-with-filliman";
    if (stage >= STAGE_FULL_TRANSFORM) {
      return "entering-filliman-s-grove-talking-to-filliman-inside-his-grotto-again";
    }
    if (stage >= STAGE_ENTERED_GROTTO) {
      return "entering-filliman-s-grove-talking-to-filliman-inside-his-grove";
    }
    if (stage >= STAGE_PERFORMED_RITUAL) {
      return "talking-to-filliman-talking-to-filliman-outside-the-grove-again";
    }
    // Capture 933-1042: the fungus talk, then "Hello again!" and the same menu, whose puzzle answer runs the ritual.
    if (stage >= STAGE_BLESSED) return "talking-to-filliman";
    if (stage >= STAGE_GIVEN_JOURNAL) return "finding-filliman-subsequent-dialogue-with-filliman-2";
    if (stage >= STAGE_SHOWN_MIRROR) {
      return "finding-filliman-talking-to-filliman-again-after-using-a-mirror-on-him";
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN) {
      return "finding-filliman-subsequent-dialogue-with-filliman";
    }
    if (stage >= STAGE_ENTERED_SWAMP) {
      // Wiki: talking without the amulet records the attempt; with it, stage 20 waits for his line (capture 381).
      if (!wearingGhostspeak(player) && stage < STAGE_FAILED_TALK) quest.setStage(player, STAGE_FAILED_TALK);
      return "finding-filliman-talking-to-filliman";
    }
    return null;
  }

  function priestInPerilActive(player) {
    const stage = Number(player.getAttribute(PRIEST_IN_PERIL_STAGE_ATTRIBUTE)) || 0;
    return stage >= PRIEST_IN_PERIL_STARTED && stage < PRIEST_IN_PERIL_COMPLETE;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === DREZEL_NPC_ID) {
      // While Priest in Peril runs, its own Drezel conversation must win.
      if (priestInPerilActive(player)) return null;
      return drezelVariant(stage);
    }
    if (npcId === FILLIMAN_NPC_ID || npcId === NATURE_SPIRIT_NPC_ID) {
      return fillimanVariant(stage, player);
    }
    return null;
  }

  /** The helper's setup requirements: The Restless Ghost and Priest in Peril. */
  function meetsRequirements(player) {
    return ["the_restless_ghost", "priest_in_peril"].every(key => {
      const request = { player, key, complete: false };
      api.emitCustomEvent("quest:is-complete", request);
      return request.complete === true;
    });
  }

  function answerCondition({ player, npcId, text }) {
    if (![DREZEL_NPC_ID, FILLIMAN_NPC_ID, NATURE_SPIRIT_NPC_ID].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("player searches the grotto")) return stage >= STAGE_ENTERED_GROTTO;
    const inventory = player.getInventory();
    if (value.includes("does not meet the requirements")) return !meetsRequirements(player);
    if (value.includes("meets the requirements")) return meetsRequirements(player);
    if (value.includes("talks to him again after speaking to him with a ghostspeak amulet")) {
      return wearingGhostspeak(player) && stage >= STAGE_SPOKEN_FILLIMAN;
    }
    if (/without wearing (?:a|the) ghostspeak amulet/.test(value)) return !wearingGhostspeak(player);
    if (value.includes("not wearing the ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("wearing the ghostspeak amulet")) return wearingGhostspeak(player);
    if (value.includes("not wearing their ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("did not go offer their help yet")) return stage < STAGE_RECEIVED_SPELL;
    if (value.includes("offered their help")) return stage >= STAGE_RECEIVED_SPELL;
    if (value.includes("has the silver sickle in their inventory")) {
      return held(player, SILVER_SICKLE_ITEM_ID) || held(player, SILVER_SICKLE_BLESSED_ITEM_ID);
    }
    if (value.includes("does not have the sickle in their inventory")) {
      return !held(player, SILVER_SICKLE_ITEM_ID) && !held(player, SILVER_SICKLE_BLESSED_ITEM_ID);
    }
    if (value.includes("does not have any inventory space")) return inventory.isFull();
    if (value.includes("has one free inventory space")) return !inventory.isFull();
    if (value.includes("does not have inventory space")) return inventory.isFull();
    // The Filliman "talking-to-filliman" variant guards the Bloom-spell states.
    if (value.includes("has not cast the bloom spell")) return stage < STAGE_CAST_SPELL;
    if (value.includes("nothing rotten is nearby")) return false;
    if (value.includes("nearby rotten remnants")) return false;
    if (value.includes("after casting the bloom spell")) return stage >= STAGE_CAST_SPELL;
    // Capture 933-975: the fungus is shown once (stage 55), then "Hello again!".
    if (value.includes("has not shown filliman the fungus")) return stage < STAGE_SHOWN_FUNGUS;
    if (value.includes("already shown filliman the fungus")) return stage >= STAGE_SHOWN_FUNGUS;
    // The puzzle answer only completes the ritual with both offerings placed (capture 962 vs 1042).
    if (value.includes("items are not all on their respective stones")) return !ritualReady(player);
    if (value.includes("all the items are placed onto their respective stones")) return ritualReady(player);
    if (value.includes("does not have all three items")) return !ritualReady(player);
    if (value.includes("has killed 1 ghast")) return stage >= STAGE_KILLED_GHAST_1;
    if (value.includes("has killed 2 ghasts")) return stage >= STAGE_KILLED_GHAST_2;
    if (value.includes("has killed 3 ghass") || value.includes("has killed 3 ghasts")) {
      return stage >= STAGE_KILLED_GHAST_3;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== DREZEL_NPC_ID || hook !== START_HOOK) return;
    if (!meetsRequirements(player)) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Item boxes live shows for the transcript's message steps (capture ticks in the README). */
  const MESSAGE_BOX_ITEMS = new Map([
    [MESSAGE.FOOD, [MEAT_PIE_ITEM_ID, APPLE_PIE_ITEM_ID]],
    [MESSAGE.MIRROR_USED, [MIRROR_ITEM_ID]],
    [MESSAGE.MIRROR_TAKEN, [MIRROR_ITEM_ID]],
    [MESSAGE.JOURNAL_GIVEN, [JOURNAL_ITEM_ID]],
    [MESSAGE.JOURNAL_READ, [JOURNAL_ITEM_ID]],
    [MESSAGE.SPELL_GIVEN, [DRUIDIC_SPELL_ITEM_ID]],
    [MESSAGE.FUNGUS_SHOWN, [MORT_MYRE_FUNGUS_ITEM_ID]],
    [MESSAGE.ANOTHER_SPELL, [DRUIDIC_SPELL_ITEM_ID]],
    [MESSAGE.SICKLE_BLESSED, [SILVER_SICKLE_BLESSED_ITEM_ID]],
    [MESSAGE.POUCH_GIVEN, [DRUID_POUCH_EMPTY_ITEM_ID]],
    [MESSAGE.JOURNAL_FOUND, [JOURNAL_ITEM_ID]],
    [MESSAGE.NOT_TOLD, [DRUID_POUCH_EMPTY_ITEM_ID]],
  ]);

  /**
   * The transcript's message steps: shown as the boxes live shows, each hand-out on its box
   * (capture 75 pies, 527 journal, 584 spell, 972 another spell, 1124 pouch).
   */
  function handleMessage(event) {
    const { player, npcId, stepId } = event;
    if (![DREZEL_NPC_ID, FILLIMAN_NPC_ID, NATURE_SPIRIT_NPC_ID].includes(npcId)) return;
    const items = MESSAGE_BOX_ITEMS.get(stepId);
    if (items) event.box = { items };
    if (stepId === MESSAGE.APPARITION) event.box = { statement: true };
    const stage = quest.getStage(player);
    if (stepId === MESSAGE.FOOD) {
      player.getInventory().adds(MEAT_PIE_ITEM_ID, 3);
      player.getInventory().adds(APPLE_PIE_ITEM_ID, 3);
      return;
    }
    if (stepId === MESSAGE.JOURNAL_FOUND) {
      if (stage === STAGE_SHOWN_MIRROR && !held(player, JOURNAL_ITEM_ID)) player.getInventory().adds(JOURNAL_ITEM_ID, 1);
      return;
    }
    if (stepId === MESSAGE.SPELL_GIVEN) {
      event.after = () => {
        if (quest.getStage(player) !== STAGE_GIVEN_JOURNAL || !wearingGhostspeak(player)) return;
        if (!held(player, DRUIDIC_SPELL_ITEM_ID)) {
          if (player.getInventory().getFreeSlots() < 1) {
            player.sendMessage("You don't have enough inventory space for the spell.");
            return;
          }
          player.getInventory().adds(DRUIDIC_SPELL_ITEM_ID, 1);
        }
        quest.setStage(player, STAGE_RECEIVED_SPELL);
      };
      return;
    }
    if (stepId === MESSAGE.ANOTHER_SPELL) {
      if (!player.getInventory().isFull()) player.getInventory().adds(DRUIDIC_SPELL_ITEM_ID, 1);
      return;
    }
    if (stepId === MESSAGE.SICKLE_BLESSED) {
      // The scene swapped it already; blessing a replacement sickle is also the lost-sickle route.
      blessHeldSickle(player);
      return;
    }
    if (stepId === MESSAGE.POUCH_GIVEN) {
      if (!held(player, DRUID_POUCH_EMPTY_ITEM_ID) && !held(player, DRUID_POUCH_FILLED_ITEM_ID)) {
        player.getInventory().adds(DRUID_POUCH_EMPTY_ITEM_ID, 1);
      }
    }
  }

  /** The held silver sickle becomes the blessed one, and the quest moves on to 75 (never backwards). */
  function blessHeldSickle(player) {
    if (held(player, SILVER_SICKLE_ITEM_ID)) {
      player.getInventory().deleteNumber(SILVER_SICKLE_ITEM_ID, 1);
      player.getInventory().adds(SILVER_SICKLE_BLESSED_ITEM_ID, 1);
    }
    if (quest.getStage(player) < STAGE_BLESSED_SICKLE) quest.setStage(player, STAGE_BLESSED_SICKLE);
  }

  function handleAction(event) {
    if (event.kind === "message") {
      handleMessage(event);
      return;
    }
    const { player, npcId, stepId } = event;
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (npcId !== FILLIMAN_NPC_ID && npcId !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_KILLED_GHAST_3 && !quest.isComplete(player)) {
      quest.complete(player);
    }
  }

  /**
   * Capture 746-750: Drezel prays over the player. The player kneels, Drezel casts and chants, a
   * star flies at the player the tick after, the blessing lands the tick after that, and on the
   * third tick the player is blessed (40) and his next line shows.
   */
  function blessingScene(player, drezel) {
    player.performAnimation(new Animation(PRAY_ANIMATION, 30));
    drezel?.performAnimation?.(new Animation(CAST_ANIMATION, 30));
    drezel?.forceChat?.(LINE.BLESSING_CHANT);
    later(player, 1, () => {
      if (drezel) star(drezel.getLocation(), player.getLocation(), player, 30, 90, 128, 128, 90);
      sound(player, PRAYER_RECHARGE_SOUND, 1, 30);
    });
    later(player, 2, () => player.performGraphic(new Graphic(PRIEST_BLESS_GRAPHIC, 30)));
    later(player, 3, () => {
      if (quest.getStage(player) === STAGE_RECEIVED_SPELL) quest.setStage(player, STAGE_BLESSED);
    });
  }

  /**
   * Capture 958-962 and 1037-1042: Filliman's spell. It fails with a cast and a sound and his
   * next line two ticks on; with both offerings placed, stars rise from the three stones two
   * ticks on and two more later the spell lands on him, the ritual is done (60) and he speaks.
   */
  function ritualScene(player, filliman) {
    sound(player, SPIRIT_TRANSFORM_START_SOUND, 1, 30);
    if (!ritualReady(player)) {
      filliman?.performAnimation?.(new Animation(CAST_ANIMATION, 30));
      return 2;
    }
    const at = filliman?.getLocation?.() ?? new Location(FILLIMAN_CAMP.x, FILLIMAN_CAMP.y, FILLIMAN_CAMP.z);
    later(player, 2, () => {
      for (const from of RITUAL_STONE_TILES) star(tile(from, 0), at, null, 30, 130, 0, 192);
      sound(player, SPIRIT_TRANSFORM_START_SOUND, 1, 30);
    });
    later(player, 4, () => {
      if (quest.getStage(player) === STAGE_SHOWN_FUNGUS && ritualReady(player)) quest.setStage(player, STAGE_PERFORMED_RITUAL);
      spiritBursts(player, at, [40, 35, 30]);
      sound(player, BLOOM_PEARS_SOUND, 1, 30);
    });
    return 4;
  }

  /**
   * Capture 1072-1075: Filliman becomes the Nature Spirit. A tick after his line he casts and
   * seven stars fly at him, a tick later three bursts land, and on the third tick he changes
   * (70) and speaks as the Nature Spirit.
   */
  function transformationScene(player, filliman) {
    later(player, 1, () => {
      const at = filliman?.getLocation?.() ?? new Location(GROTTO_SPIRIT_TILE.x, GROTTO_SPIRIT_TILE.y, 0);
      filliman?.performAnimation?.(new Animation(CAST_ANIMATION, 5));
      for (const [x, y, end] of TRANSFORM_STARS) star(new Location(x, y, 0), at, null, 30, end, 0, 128);
      sound(player, SPIRIT_TRANSFORM_SOUND, 1, 30);
    });
    later(player, 2, () => {
      const at = filliman?.getLocation?.() ?? new Location(GROTTO_SPIRIT_TILE.x, GROTTO_SPIRIT_TILE.y, 0);
      spiritBursts(player, at, [40, 35, 30]);
    });
    later(player, 3, () => {
      if (quest.getStage(player) === STAGE_ENTERED_GROTTO) quest.setStage(player, STAGE_FULL_TRANSFORM);
      if (filliman?.isRegistered?.() !== false && filliman) {
        filliman.performGraphic(new Graphic(SPIRIT_EFFECT_GRAPHIC, 0, 64));
        filliman.setNpcTransformationId?.(NATURE_SPIRIT_NPC_ID);
        leaseSpirit(player, filliman);
      }
    });
  }

  /**
   * Capture 1114-1120: the Nature Spirit blesses the sickle, starting a tick after the continue. Stars
   * fly from the grotto water at the player as the spirit casts, the player raises the sickle a tick
   * later, the sickle is blessed (75) on the next and the box shows six ticks after the continue.
   */
  function sickleScene(player, spirit) {
    player.performGraphic(new Graphic(BLOOM_PLAYER_GRAPHIC, 90, 200));
    spirit?.performAnimation?.(new Animation(CAST_ANIMATION, 30));
    for (const [x, y, end] of SICKLE_STARS) star(new Location(x, y, 0), player.getLocation(), player, 30, end, 0, 168);
    sound(player, PRAYER_RECHARGE_SOUND, 1, 30);
    later(player, 1, () => player.performAnimation(new Animation(SICKLE_BLOOM_ANIMATION, 30)));
    later(player, 2, () => {
      if (quest.getStage(player) === STAGE_FULL_TRANSFORM) blessHeldSickle(player);
    });
  }

  /**
   * Capture 1464-1482: the grotto becomes the altar. The spirit casts as his line closes, stars
   * fly at him two ticks on and burst a tick later, he casts again on the sixth tick and on the
   * ninth the quest completes, the player stands on the finished grotto (plane 1) and the spirit
   * greets them there.
   */
  function altarScene(player, spirit) {
    const at = spirit?.getLocation?.() ?? new Location(GROTTO_RETURN_TILE.x, GROTTO_RETURN_TILE.y, 0);
    spirit?.performAnimation?.(new Animation(CAST_ANIMATION));
    later(player, 2, () => {
      for (const [x, y, end] of ALTAR_STARS) star(new Location(x, y, 0), at, null, 30, end, 0, 168);
      sound(player, SPIRIT_TRANSFORM_START_SOUND, 1, 30);
    });
    later(player, 3, () => {
      spiritBursts(player, at, [86, 86, 86]);
      sound(player, BLOOM_PEARS_SOUND, 1, 30);
      sound(player, FIRE_BOLT_SOUND, 1, 30);
      sound(player, FIRE_BOLT_SOUND, 1, 30);
    });
    later(player, 6, () => spirit?.performAnimation?.(new Animation(CAST_ANIMATION)));
    later(player, 9, () => {
      if (quest.getStage(player) >= STAGE_KILLED_GHAST_3 && !quest.isComplete(player)) quest.complete(player);
      summonSpirit(player, NATURE_SPIRIT_NPC_ID, ALTAR_SPIRIT_TILE);
    });
  }

  /** `before`/`after`/`pauseTicks` on the lines live moves the quest on at (NpcDialogues' line event). */
  function handleSpiritLine(event) {
    const { player, text, npcId } = event;
    if (typeof text !== "string") return;
    const stage = quest.getStage(player);
    if (npcId === DREZEL_NPC_ID) {
      if (text.startsWith(LINE.BLESSING_CHANT)) {
        // Capture 747: Drezel chants overhead as the blessing starts (blessingScene), not after it.
        event.skip = true;
        return;
      }
      if (stage === STAGE_RECEIVED_SPELL && text.startsWith(LINE.BLESSING_START)) {
        event.after = () => blessingScene(player, event.npc);
        event.pauseTicks = 3;
      }
      return;
    }
    if (npcId !== FILLIMAN_NPC_ID && npcId !== NATURE_SPIRIT_NPC_ID) return;
    if (text.startsWith(LINE.NOT_THE_TRUTH)) {
      event.after = () => {
        const now = quest.getStage(player);
        if (now >= STAGE_ENTERED_SWAMP && now < STAGE_SPOKEN_FILLIMAN && wearingGhostspeak(player)) {
          quest.setStage(player, STAGE_SPOKEN_FILLIMAN);
        }
      };
    }
    if (text.startsWith(LINE.A_SIGN)) {
      event.after = () => {
        const now = quest.getStage(player);
        if (now >= STAGE_ENTERED_SWAMP && now < STAGE_SHOWN_MIRROR && held(player, MIRROR_ITEM_ID) && wearingGhostspeak(player)) {
          quest.setStage(player, STAGE_SHOWN_MIRROR);
        }
      };
    }
    // Capture 548-549: the journal goes and stage 30 comes with this line, after the leafing box.
    if (text.startsWith(LINE.COMING_BACK) && stage === STAGE_SHOWN_MIRROR) {
      event.before = () => {
        if (quest.getStage(player) !== STAGE_SHOWN_MIRROR || !held(player, JOURNAL_ITEM_ID) || !wearingGhostspeak(player)) return;
        player.getInventory().deleteNumber(JOURNAL_ITEM_ID, 1);
        quest.setStage(player, STAGE_GIVEN_JOURNAL);
      };
    }
    if (text.startsWith(LINE.FUNGUS_WONDERFUL)) {
      event.after = () => {
        if (quest.getStage(player) === STAGE_PICKED_FUNGI) quest.setStage(player, STAGE_SHOWN_FUNGUS);
      };
    }
    if (text.startsWith(LINE.RITUAL_TRY) && stage >= STAGE_SHOWN_FUNGUS && stage < STAGE_PERFORMED_RITUAL) {
      // Capture 960, 1038: the scene starts on the player's continue.
      event.pauseTicks = ritualReady(player) ? 4 : 2;
      event.after = () => ritualScene(player, spiritOf(player) ?? event.npc);
    }
    if (stage >= STAGE_FULL_TRANSFORM || (stage === STAGE_ENTERED_GROTTO && text.startsWith(LINE.TRANSFORM_DONE))) {
      event.speakerId = NATURE_SPIRIT_NPC_ID;
    }
    if (stage === STAGE_ENTERED_GROTTO && text.startsWith(LINE.TRANSFORM_NOW)) {
      event.after = () => transformationScene(player, spiritOf(player) ?? event.npc);
      event.pauseTicks = 3;
    }
    if (stage === STAGE_FULL_TRANSFORM && text.startsWith(LINE.SICKLE_BLESSING) && held(player, SILVER_SICKLE_ITEM_ID)) {
      event.after = () => later(player, 1, () => sickleScene(player, spiritOf(player) ?? event.npc));
      event.pauseTicks = 6;
    }
    if (stage >= STAGE_KILLED_GHAST_3 && stage < STAGE_COMPLETE && text.startsWith(LINE.QUEST_DONE)) {
      event.after = () => altarScene(player, spiritOf(player) ?? event.npc);
      event.pauseTicks = 9;
    }
    if (text.startsWith(LINE.ALTAR_WELCOME)) {
      event.speakerId = NATURE_SPIRIT_NPC_ID;
      // Capture 1485-1487: he is gone two ticks after his farewell.
      event.after = () => {
        const spirit = spiritOf(player);
        if (spirit) later(player, 2, () => removeSpawn(player, spirit));
      };
    }
  }

  /** The mirror proves to Filliman that he is dead. */
  function handleMirrorOnFilliman(event) {
    if (event.itemId !== MIRROR_ITEM_ID) return;
    const target = event.npcId ?? event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_ENTERED_SWAMP || stage >= STAGE_SHOWN_MIRROR) return;
    if (!held(event.player, MIRROR_ITEM_ID)) return;
    event.handled = startTranscript(api, event.player, FILLIMAN_NPC_ID, PAGE, FILLIMAN_ITEM_VARIANT,
      steps => steps.find(step => step.id === (wearingGhostspeak(event.player) ? CONDITION.MIRROR : CONDITION.GHOSTSPEAK_MISSING))?.steps,
      event.target);
  }

  /** Giving Filliman his journal opens his transformation plans. */
  function handleJournalOnFilliman(event) {
    if (event.itemId !== JOURNAL_ITEM_ID) return;
    const target = event.npcId ?? event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_SHOWN_MIRROR) return;
    if (!held(event.player, JOURNAL_ITEM_ID)) return;
    event.handled = startTranscript(api, event.player, FILLIMAN_NPC_ID, PAGE, FILLIMAN_ITEM_VARIANT,
      steps => steps.find(step => step.id === (wearingGhostspeak(event.player) ? CONDITION.JOURNAL : CONDITION.GHOSTSPEAK_MISSING))?.steps,
      event.target);
  }

  /** One condition of a transcript variant, played as its own conversation. */
  function playCondition(player, npcId, variant, conditionId, npc = null) {
    return startTranscript(api, player, npcId, PAGE, variant,
      steps => steps.find(step => step.id === conditionId)?.steps, npc);
  }

  /**
   * Casting the druidic Bloom spell (capture 643, 866-868, 985-987): unblessed it refuses; blessed,
   * the line, then two ticks later the cast, the bloom around the player and its sound, and either
   * fungi on the rotting logs next to the player (the spell is used up, 45) or the line that
   * nothing here can bloom.
   */
  function handleSpellAction(event) {
    if (event.itemId !== DRUIDIC_SPELL_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("cast")) return;
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_BLESSED) {
      player.sendMessage("You need to be blessed before you can cast this spell.");
      return;
    }
    if (World.getProcessCycle() < (nextBloom.get(player) ?? 0)) return;
    nextBloom.set(player, World.getProcessCycle() + SPELL_DELAY_TICKS + 1);
    player.sendMessage("You cast the spell in the swamp.");
    later(player, SPELL_DELAY_TICKS, () => {
      if (player.isRegistered?.() === false || !held(player, DRUIDIC_SPELL_ITEM_ID)) return;
      player.performAnimation(new Animation(CAST_ANIMATION, 30));
      bloomTiles(player, 30, 46);
      sound(player, BLOOM_SOUND, 30);
      const plants = bloomablePlants(player, SPELL_BLOOMABLE_IDS);
      if (!plants.length) {
        player.sendMessage("There is no suitable material to be affected in this area.");
        return;
      }
      for (const plant of plants) growPlant(player, plant);
      player.getInventory().deleteNumber(DRUIDIC_SPELL_ITEM_ID, 1);
      player.getInventory().adds(USED_SPELL_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_CAST_SPELL) quest.setStage(player, STAGE_CAST_SPELL);
    });
  }

  /**
   * Every sickle and flail whose cache menu carries Bloom: "Cast Bloom" on the blessed silver
   * sickle and its gem and Blisterwood upgrades, "Bloom" on the Ivandis, Blisterwood and
   * Hallowed flails (Wiki: Bloom).
   */
  function hasBloomOption(itemId) {
    return (CacheDefinitions.getItem(itemId)?.inventoryActions ?? []).some(action => /bloom/i.test(action ?? ""));
  }

  /**
   * A blessed sickle or flail's Bloom (capture 1234-1235): the cast, its effect and sound at once,
   * then a tick later the bloom around the player, the Prayer drain and the plants (80).
   */
  function handleSickleAction(event) {
    if (!hasBloomOption(event.itemId)) return;
    if (!String(event.option ?? "").toLowerCase().includes("bloom")) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_BLESSED_SICKLE) return;
    event.handled = true;
    if (World.getProcessCycle() < (nextBloom.get(player) ?? 0)) return;
    const skills = player.getSkillManager();
    if (skills.getCurrentLevel(Skill.PRAYER) <= 0) { player.sendMessage("You need some Prayer points to cast Bloom."); return; }
    player.performAnimation(new Animation(SICKLE_BLOOM_ANIMATION, 10));
    player.performGraphic(new Graphic(BLOOM_PLAYER_GRAPHIC, 30, 200));
    sound(player, BLOOM_SOUND, 35);
    nextBloom.set(player, World.getProcessCycle() + BLOOM_DELAY_TICKS);
    later(player, SICKLE_DELAY_TICKS, () => {
      if (player.isRegistered?.() === false) return;
      // Wiki (Bloom): 1-6 Prayer points per cast; the capture's two casts drain 2 and 3.
      const prayer = skills.getCurrentLevel(Skill.PRAYER);
      skills.setCurrentLevels(Skill.PRAYER, Math.max(0, prayer - 1 - Math.floor(Math.random() * 6)));
      skills.updateSkill(Skill.PRAYER);
      bloomTiles(player, 15, 150);
      const plants = bloomablePlants(player, SICKLE_BLOOMABLE_IDS);
      if (!plants.length) {
        player.sendMessage("There is no suitable material to be affected in this area.");
        return;
      }
      for (const plant of plants) if (Math.random() < BLOOM_SUCCESS_CHANCE) growPlant(player, plant);
      if (quest.getStage(player) < STAGE_CAST_SICKLE_BLOOM) quest.setStage(player, STAGE_CAST_SICKLE_BLOOM);
    });
  }

  function morytaniaHardDone(player) {
    const request = { player, diary: "morytania", tier: "hard", complete: false };
    api.emitCustomEvent("diary:is-complete", request);
    return request.complete === true;
  }

  /** Picking the Bloom's produce (capture 873, 1238, 1240): the first fungus is 50, the first sickle harvest 85. */
  function handleBloomPick(event) {
    const harvest = PLANT_HARVEST.get(event.objectId);
    if (harvest === undefined) return;
    const option = actionOf(event);
    if (!option.includes("pick") && !option.includes("take")) return;
    const { player } = event;
    event.handled = true;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.getInventory().adds(harvest, 1);
    // Morytania hard diary: Bloom yields double Mort myre fungi (Wiki: Morytania Diary).
    if (event.objectId === FUNGI_ON_LOG_ID && player.getInventory().getFreeSlots() > 0 && morytaniaHardDone(player)) {
      player.getInventory().adds(harvest, 1);
    }
    player.performAnimation(new Animation(PICK_ANIMATION));
    sound(player, PICK_SOUND);
    const source = [...BLOOMED_PLANT.entries()].find(([, bloomed]) => bloomed === event.objectId)?.[0];
    if (source !== undefined) replaceObject(event.object, source);
    const stage = quest.getStage(player);
    if (event.objectId === FUNGI_ON_LOG_ID && stage >= STAGE_CAST_SPELL && stage < STAGE_PICKED_FUNGI) {
      quest.setStage(player, STAGE_PICKED_FUNGI);
    } else if (stage === STAGE_CAST_SICKLE_BLOOM) {
      quest.setStage(player, STAGE_PICKED_PRODUCE);
    }
    if (event.objectId === FUNGI_ON_LOG_ID) {
      spam(player, "You pick a mushroom from the log.");
    } else if (event.objectId === BUDDING_BRANCH_ID) {
      spam(player, "You take a cutting from the budding branch.");
    } else {
      // Ours: no capture picks a pear.
      spam(player, "You pick a pear from the bush.");
    }
  }

  /**
   * The ritual offerings (capture 1005-1021): fungus on the nature stone (brown, west), a spell
   * on the spirit stone (grey, east). Each is the transcript's stone section: the line, and
   * Filliman's approval. The faith stone (orange, south) takes neither; Filliman stands on it.
   */
  function handleStoneOffering(event) {
    const { player, objectId, itemId } = event;
    if (![NATURE_STONE_ID, SPIRIT_STONE_ID, FAITH_STONE_ID].includes(objectId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_PICKED_FUNGI || stage >= STAGE_PERFORMED_RITUAL) return;
    event.handled = true;
    const filliman = spiritOf(player);
    if (objectId === FAITH_STONE_ID) {
      playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-orange-stone", CONDITION.ORANGE_WRONG, filliman);
      return;
    }
    if (objectId === NATURE_STONE_ID) {
      if (player.getAttribute(FUNGUS_OFFERING_ATTRIBUTE)) {
        playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-brown-stone", CONDITION.BROWN_DONE, filliman);
      } else if (itemId === MORT_MYRE_FUNGUS_ITEM_ID) {
        player.getInventory().deleteNumber(MORT_MYRE_FUNGUS_ITEM_ID, 1);
        player.setAttribute(FUNGUS_OFFERING_ATTRIBUTE, true);
        player.performAnimation(new Animation(PICK_ANIMATION));
        playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-brown-stone", CONDITION.BROWN_FUNGUS, filliman);
      } else {
        playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-brown-stone", CONDITION.BROWN_WRONG, filliman);
      }
      return;
    }
    if (player.getAttribute(SPELL_OFFERING_ATTRIBUTE)) {
      playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-grey-stone", CONDITION.GREY_DONE, filliman);
    } else if (itemId === USED_SPELL_ITEM_ID || itemId === DRUIDIC_SPELL_ITEM_ID) {
      player.getInventory().deleteNumber(itemId, 1);
      player.setAttribute(SPELL_OFFERING_ATTRIBUTE, true);
      player.performAnimation(new Animation(PICK_ANIMATION));
      playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-grey-stone",
        itemId === DRUIDIC_SPELL_ITEM_ID ? CONDITION.GREY_SPELL : CONDITION.GREY_USED_SPELL, filliman);
    } else {
      playCondition(player, FILLIMAN_NPC_ID, "talking-to-filliman-grey-stone", CONDITION.GREY_WRONG, filliman);
    }
  }

  /** Searching a stone reads its symbol (the transcript's stone search section). */
  function handleStoneSearch(event) {
    const condition = { [NATURE_STONE_ID]: CONDITION.SEARCH_BROWN, [SPIRIT_STONE_ID]: CONDITION.SEARCH_GREY,
      [FAITH_STONE_ID]: CONDITION.SEARCH_ORANGE }[event.objectId];
    if (!condition || !actionOf(event).includes("search")) return;
    event.handled = playCondition(event.player, FILLIMAN_NPC_ID, "talking-to-filliman-searching-all-the-stones-after-the-spell", condition);
  }

  /**
   * Taking the washing bowl uncovers the mirror hidden beneath it (capture 463): the line, and the
   * mirror on the bench for its finder (200 ticks), to pick up.
   */
  function handleWashingBowlPickup(event) {
    if (event.groundItemId !== WASHING_BOWL_ITEM_ID) return;
    const { player } = event;
    if (
      event.location?.x !== WASHING_BOWL_TILE.x ||
      event.location?.y !== WASHING_BOWL_TILE.y
    ) {
      return;
    }
    if (held(player, MIRROR_ITEM_ID)) return;
    const position = new Location(WASHING_BOWL_TILE.x, WASHING_BOWL_TILE.y, WASHING_BOWL_TILE.z);
    if (ItemOnGroundManager.getGroundItem(player.getUsername(), MIRROR_ITEM_ID, position, player.getPrivateArea())) return;
    ItemOnGroundManager.registerLocation(player, new Item(MIRROR_ITEM_ID, 1), position, player.getPrivateArea(),
      { goesGlobal: false, despawnDelay: MIRROR_DESPAWN_TICKS });
    player.sendMessage("You find a small mirror under the washing bowl.");
  }

  /** Capture 532-535: reading Filliman's journal, two boxes with the journal. No transcript holds them. */
  const JOURNAL_PAGES = [
    "Most of the writing is pretty uninteresting, but something inside refers to a nature spirit. The requirements are:",
    "'Something from nature', 'something with faith' and 'something of the spirit-to-become freely given'. It's all pretty vague.",
  ];

  function readJournal(event) {
    if (event.itemId !== JOURNAL_ITEM_ID || !String(event.option ?? "").toLowerCase().includes("read")) return;
    event.handled = true;
    const chain = new DialogueChainBuilder();
    JOURNAL_PAGES.forEach((text, index) => chain.add(new ItemStatementDialogue(index, JOURNAL_ITEM_ID, text)));
    event.player.getDialogueManager().startDialogues(chain);
  }

  /**
   * The druid pouch's Fill option. Capture 1130 (stage 75): before any of the swamp's bounty is
   * harvested it shows the "not been told" box (the Wiki has it for the pouch picked up in the
   * grotto); after, it fills as using the produce on it does.
   */
  function handlePouchFill(event) {
    if (event.itemId !== DRUID_POUCH_EMPTY_ITEM_ID && event.itemId !== DRUID_POUCH_FILLED_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("fill")) return;
    event.handled = true;
    // Ours: where the box stops; the capture only shows it at 75. Only while the quest runs: a pouch from
    // elsewhere (While Guthix Sleeps' skeleton) fills for a player who never started it.
    const stage = quest.getStage(event.player);
    if (stage > 0 && stage < STAGE_PICKED_PRODUCE) {
      playCondition(event.player, FILLIMAN_NPC_ID, GROVE_VARIANT, CONDITION.POUCH_NOT_TOLD);
      return;
    }
    fillPouch(event.player);
  }

  /** Using nature's bounty on the pouch fills it too (capture 1248). */
  function handleProduceOnPouch(event) {
    const produce = POUCH_CHARGES.has(event.usedItemId)
      ? event.usedItemId
      : POUCH_CHARGES.has(event.usedWithItemId)
        ? event.usedWithItemId
        : null;
    if (produce === null) return;
    const other = produce === event.usedItemId ? event.usedWithItemId : event.usedItemId;
    if (other !== DRUID_POUCH_EMPTY_ITEM_ID && other !== DRUID_POUCH_FILLED_ITEM_ID) return;
    const stage = quest.getStage(event.player);
    if (stage > 0 && stage < STAGE_PICKED_PRODUCE) {
      event.handled = true;
      playCondition(event.player, FILLIMAN_NPC_ID, GROVE_VARIANT, CONDITION.POUCH_NOT_TOLD);
      return;
    }
    if (fillPouch(event.player)) event.handled = true;
  }

  /** Using a filled pouch on an invisible ghast reveals it (capture 1308-1312). */
  function handlePouchOnGhast(event) {
    if (!INVISIBLE_GHAST_IDS.has(event.npcId)) return;
    if (event.itemId !== DRUID_POUCH_EMPTY_ITEM_ID && event.itemId !== DRUID_POUCH_FILLED_ITEM_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_BLESSED_SICKLE) return;
    if (event.itemId === DRUID_POUCH_EMPTY_ITEM_ID) {
      player.sendMessage("You have nothing left in your druid pouch!");
      event.handled = true;
      return;
    }
    event.handled = true;
    if (World.getProcessCycle() < (nextPouch.get(player) ?? 0)) return;
    if (revealGhast(player, event.target)) nextPouch.set(player, World.getProcessCycle() + POUCH_DELAY_TICKS);
  }

  /** Each revealed ghast that dies counts toward the three. */
  function handleGhastDeath(event) {
    const reveal = visibleGhasts.get(event.npc);
    if (!reveal) return;
    visibleGhasts.delete(event.npc);
    const player = event.killer ?? reveal.owner;
    const stage = quest.getStage(player);
    if (stage < STAGE_FILLED_POUCH || stage >= STAGE_KILLED_GHAST_3) return;
    const next = stage >= STAGE_KILLED_GHAST_2 ? STAGE_KILLED_GHAST_3 : stage >= STAGE_KILLED_GHAST_1 ? STAGE_KILLED_GHAST_2 : STAGE_KILLED_GHAST_1;
    quest.setStage(player, next);
    player.sendMessage(
      next === STAGE_KILLED_GHAST_1 ? "That's one Ghast, 2 more to kill."
        : next === STAGE_KILLED_GHAST_2 ? "That's two Ghasts, 1 more to kill."
        : "That's all three Ghasts!"
    );
  }

  /**
   * The swamp's invisible ghasts now do what the Wiki says they do: they attack players,
   * rotting a food item or dealing 1-3 when there is none. A filled pouch reveals the
   * attacker instead. Scope it to the swamp so no other area pays for the hook.
   */
  function createSwampArea() {
    class MortMyreSwampArea extends Area {
      postEnter(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (player.getPrivateArea?.()) return;
        api.emitCustomEvent("mort-myre:entered", { player });
      }

      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (player.getPrivateArea?.()) return;
        checkSwampGateCrossing(player);
        leaveIsland(player);
        const cycle = World.getProcessCycle();
        const next = ghastNextAttack.get(player);
        if (next === undefined) {
          ghastNextAttack.set(player, cycle + GHAST_ATTACK_MIN_DELAY);
          return;
        }
        if (cycle < next) return;
        const ghast = nearestInvisibleGhast(player);
        if (!ghast) return;
        ghastAttack(player, ghast);
      }
    }
    return new MortMyreSwampArea([SWAMP_BOUNDS]);
  }

  /** Capture 618-639: Filliman goes once his owner crosses back off the island. */
  function leaveIsland(player) {
    const spirit = spiritOf(player);
    if (!spirit || spirit.getLocation().getY() > 9000) return;
    if (!ISLAND_BOUNDS.inside(player.getLocation())) removeSpawn(player, spirit);
  }

  /**
   * The tiles just north of the Gate are outside the swamp, so its process can't see them. This strip only
   * records the approach for checkSwampGateCrossing (2 rows deep, for a running step); no diary entry, no ghasts.
   */
  function createSwampGateApproachArea() {
    class MortMyreGateApproachArea extends Area {
      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (player.getPrivateArea?.()) return;
        checkSwampGateCrossing(player);
      }
    }
    return new MortMyreGateApproachArea([SWAMP_GATE_APPROACH_BOUNDS]);
  }

  /**
   * The swamp gate is the only legitimate way into Mort Myre ("or Filliman will
   * not appear"): passing through it writes stage 10. Doors still swings the gate.
   * Wiki (Mort Myre Swamp): starting Nature Spirit first unlocks it; before that, opening it shows
   * the notice instead. Leaving is never stopped (a Mort'ton or Barrows teleport lands inside).
   */
  function handleSwampGate(request) {
    if (request.handled || !SWAMP_GATE_IDS.has(request.objectId)) return;
    const { player } = request;
    if (player.getLocation().getY() >= SWAMP_GATE_PASSAGE.y && quest.getStage(player) < STAGE_STARTED) {
      request.handled = true;
      player.sendMessage(SWAMP_GATE_NOTICE);
      return;
    }
    // rsprox 226/01638.txt:21691 (leaving, tick 1005) and :21802 (entering, tick 1014), also
    // 237/01134.txt:300241/301999: every crossing has its line, whatever the quest stage.
    if (player.getLocation().getY() < SWAMP_GATE_PASSAGE.y) {
      player.sendMessage("You skip gladly out of murky Mort Myre.");
      return;
    }
    if (!recordSwampEntry(player)) player.sendMessage(ENTER_SWAMP_MESSAGE);
  }

  const ENTER_SWAMP_MESSAGE = "You walk into the gloomy atmosphere of Mort Myre.";
  /** Wiki (Mort Myre Swamp, trivia): the gate before Nature Spirit is started. No recording has it. */
  const SWAMP_GATE_NOTICE = "Mort Myre is a dangerous Ghast infested swamp. Do not enter if you value your life. "
    + "All persons wishing to enter must see Drezel.";

  /** True when the quest step was recorded (and its line sent). */
  function recordSwampEntry(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_ENTERED_SWAMP) return false;
    quest.setStage(player, STAGE_ENTERED_SWAMP);
    player.sendMessage(ENTER_SWAMP_MESSAGE);
    ensureWashingBowl(player);
    return true;
  }

  /** Opening credits its actor; walking through another player's open gate must credit the walker. */
  function checkSwampGateCrossing(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_ENTERED_SWAMP) {
      swampGateApproach.delete(player);
      return;
    }
    const at = player.getLocation();
    const previous = swampGateApproach.get(player);
    swampGateApproach.set(player, at.clone());
    if (!previous || player.needsPlacement || previous.getZ() !== 0 || at.getZ() !== 0) return;
    if (previous.getY() >= SWAMP_GATE_PASSAGE.y && at.getY() < SWAMP_GATE_PASSAGE.y
      && Math.max(Math.abs(at.getX() - previous.getX()), Math.abs(at.getY() - previous.getY())) <= 2
      && Math.min(previous.getX(), at.getX()) <= SWAMP_GATE_PASSAGE.maxX
      && Math.max(previous.getX(), at.getX()) >= SWAMP_GATE_PASSAGE.minX) {
      recordSwampEntry(player);
    }
  }

  /**
   * After the quest the capture never shows the Nature Spirit again (1614-1652). Later quests talk to him in
   * the finished grotto (Fairytale I - Growing Pains, A Night at the Theatre), so he stands at his altar while
   * one of them is under way. Ours: when he appears for them; no capture shows it.
   */
  const LATER_QUESTS = ["fairytale_i_growing_pains", "a_night_at_the_theatre"];
  function spiritNeededLater(player) {
    return LATER_QUESTS.some((key) => {
      const started = { player, key, started: false };
      api.emitCustomEvent("quest:is-started", started);
      const done = { player, key, complete: false };
      api.emitCustomEvent("quest:is-complete", done);
      return started.started === true && done.complete !== true;
    });
  }

  function summonAltarSpirit(player) {
    if (quest.isComplete(player) && spiritNeededLater(player)) {
      summonSpirit(player, NATURE_SPIRIT_NPC_ID, ALTAR_SPIRIT_TILE, { lease: false });
    }
  }

  /**
   * The grotto entrance (capture 364, 473, 607, 933, 1057). Before the ritual Filliman appears
   * at his camp with the grotto's ghostly sound and talks as Talk-to would: the first time with
   * "A shifting apparition appears in front of you."; after it the player goes down (65).
   */
  function enterGrotto(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ENTERED_SWAMP) {
      player.sendMessage("You prepare to enter the Druid's grotto.");
      return;
    }
    if (stage < STAGE_PERFORMED_RITUAL) {
      sound(player, GHAST.appearSound);
      const filliman = summonSpirit(player, FILLIMAN_NPC_ID, FILLIMAN_CAMP);
      // Wiki Transcript:Nature Spirit, "If the player attempts to enter the Grotto": the line and the apparition box.
      if (stage < STAGE_SPOKEN_FILLIMAN) {
        startTranscript(api, player, FILLIMAN_NPC_ID, PAGE, fillimanVariant(stage, player), null, filliman);
        return;
      }
      player.sendMessage("You prepare to enter the Druid's grotto.");
      startTranscript(api, player, FILLIMAN_NPC_ID, PAGE, fillimanVariant(stage, player), null, filliman);
      return;
    }
    const spirit = spiritOf(player);
    if (spirit) removeSpawn(player, spirit);
    player.sendMessage("You prepare to enter the Druid's grotto.");
    player.sendMessage("You see a beautifully tended small grotto area.");
    player.moveTo(new Location(GROTTO_INTERIOR.x, GROTTO_INTERIOR.y, quest.isComplete(player) ? 1 : 0));
    if (quest.getStage(player) === STAGE_PERFORMED_RITUAL) quest.setStage(player, STAGE_ENTERED_GROTTO);
    summonAltarSpirit(player);
  }

  /**
   * Searching the grotto water (capture 1068, 1459) calls Filliman to his tile: as Filliman to
   * transform, as the Nature Spirit after, and to the water's edge once the ghasts are dead.
   */
  function searchGrotto(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ENTERED_GROTTO || stage >= STAGE_COMPLETE) return false;
    let spirit;
    if (stage >= STAGE_KILLED_GHAST_3) {
      spirit = summonSpirit(player, NATURE_SPIRIT_NPC_ID, GROTTO_RETURN_TILE);
      sound(player, SPIRIT_TRANSFORM_SOUND);
    } else {
      spirit = summonSpirit(player, stage >= STAGE_FULL_TRANSFORM ? NATURE_SPIRIT_NPC_ID : FILLIMAN_NPC_ID, GROTTO_SPIRIT_TILE);
    }
    const npcId = stage >= STAGE_FULL_TRANSFORM ? NATURE_SPIRIT_NPC_ID : FILLIMAN_NPC_ID;
    startTranscript(api, player, npcId, PAGE, fillimanVariant(stage, player), null, spirit);
    return true;
  }

  /** The grotto tree: Look-at and Search (the transcript's island section; capture 359, 527, 601). */
  function handleGrottoTree(player, option) {
    if (option.includes("look")) {
      playCondition(player, FILLIMAN_NPC_ID, ISLAND_VARIANT, CONDITION.TREE_LOOK);
      return;
    }
    const stage = quest.getStage(player);
    const finds = stage === STAGE_SHOWN_MIRROR && !held(player, JOURNAL_ITEM_ID);
    playCondition(player, FILLIMAN_NPC_ID, ISLAND_VARIANT, finds ? CONDITION.TREE_SEARCH : CONDITION.TREE_NOTHING);
  }

  /** The grotto cave entrance/exit, its water and the journal hidden in the grotto tree. */
  function handleGrotto(event) {
    const { player, objectId } = event;
    const option = actionOf(event);
    if (objectId === GROTTO_ID && option.includes("enter")) {
      event.handled = true;
      enterGrotto(player);
      return;
    }
    if (GROTTO_EXIT_IDS.has(objectId) && (option.includes("exit") || option.includes("leave"))) {
      event.handled = true;
      // rsprox 227/01846.txt ticks 4477-4478: the prepare line, then a tick later the crawl line and the move.
      player.sendMessage("You prepare to exit the Druid's grotto.");
      TaskManager.submit(new CountdownTask(player, 1, () => {
        const spirit = spiritOf(player);
        if (spirit) removeSpawn(player, spirit);
        player.sendMessage("You crawl back out of the grotto.");
        player.moveTo(new Location(GROTTO_SURFACE.x, GROTTO_SURFACE.y, GROTTO_SURFACE.z));
      }));
      return;
    }
    if (objectId === GROTTO_POOL_ID && option.includes("search")) {
      if (searchGrotto(player)) event.handled = true;
      return;
    }
    if (objectId === GROTTO_TREE_ID && (option.includes("search") || option.includes("look"))) {
      event.handled = true;
      handleGrottoTree(player, option);
    }
  }

  function blessReplacementSickle(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== SILVER_SICKLE_ITEM_ID || !SICKLE_BLESSING_OBJECT_IDS.has(objectId)) return;
    if (quest.getStage(player) < STAGE_BLESSED_SICKLE) return;
    event.handled = true;
    if (!held(player, SILVER_SICKLE_ITEM_ID)) return;
    player.getInventory().deleteNumber(SILVER_SICKLE_ITEM_ID, 1);
    player.getInventory().adds(SILVER_SICKLE_BLESSED_ITEM_ID, 1);
    player.sendMessage("You bless the silver sickle.");
  }

  /** Capture 1494, 1516: the altar boosts Prayer two above its level, once. */
  function prayAtNatureAltar({ player }) {
    if (!quest.isComplete(player)) return false;
    const skills = player.getSkillManager();
    const maximum = skills.getMaxLevel(Skill.PRAYER) + 2;
    if (skills.getCurrentLevel(Skill.PRAYER) >= maximum) {
      player.sendMessage("You have already boosted your prayer points.");
      return true;
    }
    player.performAnimation(new Animation(PRAY_ANIMATION));
    skills.setCurrentLevels(Skill.PRAYER, maximum);
    skills.updateSkill(Skill.PRAYER);
    player.setPrayerPointDrain(0);
    player.getPacketSender().sendSoundEffect(api.core.Sound.PRAYER_RECHARGE.getId(), 1, 0, 0);
    player.sendMessage("You recharge your prayer points at the altar of nature."); // rsprox 227/01846.txt tick 4473
    return true;
  }

  function prayAtNatureAltarRequest(request) {
    if (prayAtNatureAltar(request)) request.handled = true;
  }

  function handleLogin({ player }) {
    if (quest.isComplete(player) && inGrotto(player)
      && player.getLocation().getZ() === 0) {
      const at = player.getLocation();
      player.moveTo(new Location(at.getX(), at.getY(), 1));
    }
    if (quest.isComplete(player) && inGrotto(player)) summonAltarSpirit(player);
    refreshQuestList(player);
    if (quest.getStage(player) >= STAGE_ENTERED_SWAMP) ensureWashingBowl(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    nextBloom.delete(player);
    nextPouch.delete(player);
    swampGateApproach.delete(player);
    pendingReveals.delete(player);
    clearSpawns(player);
    for (const [npc, reveal] of [...visibleGhasts]) {
      if (reveal.owner !== player) continue;
      visibleGhasts.delete(npc);
      api.removeNpc(npc);
    }
  }

  quest = registerQuest(api, {
    key: "nature_spirit",
    name: "Nature Spirit",
    varpId: VARP_NATURE_SPIRIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 3000, label: "Crafting" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 2000, label: "Hitpoints" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 2000, label: "Defence" },
    ],
    // The blessing already hands over the sickle; completion must not grant a
    // second one. The scroll still shows it via scrollItemId.
    scrollItemId: SILVER_SICKLE_BLESSED_ITEM_ID,
    rewardItemLabel: "Silver sickle (b)",
    otherRewards: [
      "An altar of nature",
      "Ability to fight Ghasts",
      "Access to Mort Myre swamp produce",
    ],
    buildJournal,
    onReward: grantReward,
  });

  // The offerings stay on their stones across a logout: both items are used up when placed.
  api.persistAttribute(FUNGUS_OFFERING_ATTRIBUTE, false);
  api.persistAttribute(SPELL_OFFERING_ATTRIBUTE, false);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleSpiritLine);
  api.onCustomEvent("door:toggle", handleSwampGate);
  api.onNpcDeath(handleGhastDeath);
  api.onItemOnNpc(handleMirrorOnFilliman);
  api.onItemOnNpc(handleJournalOnFilliman);
  api.onItemOnNpc(handlePouchOnGhast);
  api.onItemOnItem(handleProduceOnPouch);
  api.onItemOnObject(handleStoneOffering);
  api.onItemOnObject(blessReplacementSickle);
  api.onItemAction(handleSpellAction);
  api.onItemAction(handleSickleAction);
  api.onItemAction(handlePouchFill);
  api.onItemAction(readJournal);
  api.onGroundItemPickup(handleWashingBowlPickup);
  api.onObjectInteraction(handleGrotto);
  api.onObjectInteraction(handleBloomPick);
  api.onObjectInteraction(handleStoneSearch);
  api.onCustomEvent("altar:nature-quest-prayer", prayAtNatureAltarRequest);
  // Fallback when the generic Altars plugin is disabled.
  api.onObjectInteraction("Altar of nature", { "Pray-at": prayAtNatureAltar });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.registerArea(createSwampArea());
  api.registerArea(createSwampGateApproachArea());
};
