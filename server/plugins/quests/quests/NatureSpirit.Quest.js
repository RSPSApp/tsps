/**
 * Nature Spirit (members).
 *
 * The words come from the "Nature Spirit" transcript page. Drezel (9636),
 * Filliman Tarlock (943) and the Nature Spirit (944) are all indexed, so this
 * plugin supplies the variant selector, the prose-condition answers, the start
 * hook, the completion action and the key item interactions (mirror/journal on
 * Filliman, casting the Bloom spell, blessing the sickle).
 *
 * Stages (varp 307) step by 5: 5 started, 10 entered swamp, 15 failed talk,
 * 20 spoken to Filliman, 25 shown mirror, 30 given journal, 35 received spell,
 * 40 blessed, 45 cast spell, 50 picked fungi, 55 spoken again, 60 ritual,
 * 65 entered grotto, 70 full transform, 75 blessed sickle, 80 sickle bloom,
 * 90 pouch, then the three ghast stages (95/100/105), 110 complete.
 *
 * The world edits live here too: the swamp gate writes stage 10, the washing
 * bowl at the camp hides the mirror, the Bloom spell sprouts fungi on a
 * rotting log, the fungus/used spell go on the nature/spirit stones, the
 * Nature Spirit blesses the silver sickle and hands over the druid pouch, the
 * blessed sickle blooms swamp plants into pouch charges, and walking a filled
 * pouch past a ghast reveals it so the kill can count.
 */
module.exports = function registerNatureSpiritQuest(api) {
  const {
    Skill, Equipment, Location, Item, ItemOnGroundManager, Boundary, Area, GameObject,
    ObjectManager, MapObjects, RegionManager, World, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL; // 9636
  const FILLIMAN_NPC_ID = NpcIdentifiers.FILLIMAN_TARLOCK; // 943
  const NATURE_SPIRIT_NPC_ID = NpcIdentifiers.NATURE_SPIRIT; // 944

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
  const STAGE_SPOKEN_FILLIMAN_2 = 55;
  const STAGE_PERFORMED_RITUAL = 60;
  const STAGE_ENTERED_GROTTO = 65;
  const STAGE_FULL_TRANSFORM = 70;
  const STAGE_BLESSED_SICKLE = 75;
  const STAGE_CAST_SICKLE_BLOOM = 80;
  const STAGE_ADDED_POUCH = 90;
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
  /** Drezel's "Drezel hands you some food." message step. */
  const FOOD_MESSAGE_ID = "LAAzzo";
  /** The Nature Spirit's "Your sickle has been blessed!" step. */
  const SICKLE_BLESSED_MESSAGE_ID = "zcAIZC";
  /** The Nature Spirit's "gives you an empty pouch." step. */
  const POUCH_GIVEN_MESSAGE_ID = "bf6r0R";

  const FUNGUS_OFFERING_ATTRIBUTE = "nature-spirit:fungus-offering";
  const SPELL_OFFERING_ATTRIBUTE = "nature-spirit:spell-offering";

  const SWAMP_GATE_IDS = new Set([ObjectIdentifiers.GATE_72, ObjectIdentifiers.GATE_73]); // 3506/3507
  const GROTTO_ID = ObjectIdentifiers.GROTTO; // 3516 surface entrance
  const GROTTO_TREE_ID = ObjectIdentifiers.GROTTO_TREE; // 3517
  const GROTTO_EXIT_ID = ObjectIdentifiers.GROTTO_3; // 3525 cave exit
  const SICKLE_BLESSING_OBJECT_IDS = new Set([ObjectIdentifiers.GROTTO_2, ObjectIdentifiers.ALTAR_OF_NATURE]);

  const ROTTING_LOG_ID = ObjectIdentifiers.ROTTING_LOG; // 3508
  const FUNGI_ON_LOG_ID = ObjectIdentifiers.FUNGI_ON_LOG; // 3509
  const ROTTING_BRANCH_ID = ObjectIdentifiers.ROTTING_BRANCH; // 3510
  const BUDDING_BRANCH_ID = ObjectIdentifiers.BUDDING_BRANCH; // 3511
  const SMALL_BUSH_ID = ObjectIdentifiers.SMALL_BUSH; // 3512
  const GOLDEN_PEAR_BUSH_ID = ObjectIdentifiers.GOLDEN_PEAR_BUSH; // 3513
  const NATURE_STONE_ID = ObjectIdentifiers.STONE; // 3527 west, nature
  const FAITH_STONE_ID = ObjectIdentifiers.STONE_2; // 3528 south, faith (orange)
  const SPIRIT_STONE_ID = ObjectIdentifiers.STONE_3; // 3529 east, spirit

  const GHAST_NPC_ID = NpcIdentifiers.GHAST; // 945, the invisible swamp ghast
  const GHAST_VISIBLE_NPC_ID = NpcIdentifiers.GHAST_2; // 946, the level 30 ghast

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
  const SPELL_BLOOMABLE_IDS = new Set([ROTTING_LOG_ID]);
  const SICKLE_BLOOMABLE_IDS = new Set(BLOOMED_PLANT.keys());
  const POUCH_PRODUCE_ITEM_IDS = [
    MORT_MYRE_PEAR_ITEM_ID,
    MORT_MYRE_STEM_ITEM_ID,
    MORT_MYRE_FUNGUS_ITEM_ID,
    ItemIdentifiers.VINE_FLOWER,
  ];
  const BLOOM_RADIUS = 2;

  const GROTTO_INTERIOR = { x: 3441, y: 9736, z: 0 };
  const GROTTO_SURFACE = { x: 3443, y: 3338, z: 0 };
  const FILLIMAN_CAMP = { x: 3442, y: 3340, z: 0 };
  const NATURE_SPIRIT_CAMP = { x: 3441, y: 9736, z: 0 };
  const WASHING_BOWL_TILE = { x: 3437, y: 3337, z: 0 };
  /** Mort Myre swamp: the ghasts the pouch can reveal all live inside. */
  const SWAMP_BOUNDS = new Boundary(3380, 3590, 3310, 3480, 0);

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGhostspeak = (player) =>
    player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ITEM_ID;
  const actionOf = (event) =>
    String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();

  /** Owner-only quest NPC spawns (Filliman outside, Nature Spirit inside). */
  const spawnedByPlayer = new Map();

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

  function despawn(player, npcId) {
    const set = spawnedByPlayer.get(player);
    if (!set) return;
    for (const npc of [...set]) {
      if (npc?.getId?.() === npcId) {
        api.removeNpc(npc);
        set.delete(npc);
      }
    }
  }

  function hasSpawn(player, npcId) {
    const set = spawnedByPlayer.get(player);
    if (!set) return false;
    for (const npc of set) if (npc?.getId?.() === npcId) return true;
    return false;
  }

  function spawnAt(player, npcId, tile) {
    return trackSpawn(
      player,
      api.spawnNpc({
        id: npcId,
        x: tile.x,
        y: tile.y,
        z: tile.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      })
    );
  }

  /** The visible ghasts we spawned, so a death can be counted for its owner. */
  const visibleGhasts = new Map();

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

  /** The nearest rotting plant the player's Bloom can reach, or null. */
  function nearestBloomable(player, bloomableIds) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    const z = location.getZ();
    let best = null;
    let bestDistance = BLOOM_RADIUS + 1;
    const consider = (object) => {
      if (!bloomableIds.has(object.getId())) return;
      const objectLocation = object.getLocation();
      if (objectLocation.getZ() !== z) return;
      const distance = Math.max(
        Math.abs(objectLocation.getX() - x),
        Math.abs(objectLocation.getY() - y)
      );
      if (distance < bestDistance) {
        best = object;
        bestDistance = distance;
      }
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
    return best;
  }

  /** Both ritual offerings sit on their stones. */
  function ritualReady(player) {
    return Boolean(player.getAttribute(FUNGUS_OFFERING_ATTRIBUTE)) &&
      Boolean(player.getAttribute(SPELL_OFFERING_ATTRIBUTE));
  }

  /**
   * The mirror hides under the washing bowl on the camp bench. The world spawn
   * carries it in ground-items.json; if a world has lost it, put one back so
   * the quest can still be finished.
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

  /** A filled pouch spent to make a ghast visible and attackable. */
  function revealGhast(player, ghast) {
    if (!held(player, DRUID_POUCH_FILLED_ITEM_ID)) {
      player.sendMessage("You have nothing left in your druid pouch!");
      return;
    }
    player.getInventory().deleteNumber(DRUID_POUCH_FILLED_ITEM_ID, 1);
    if (!held(player, DRUID_POUCH_FILLED_ITEM_ID)) player.getInventory().adds(DRUID_POUCH_EMPTY_ITEM_ID, 1);
    const location = ghast.getLocation();
    const visible = api.spawnNpc({
      id: GHAST_VISIBLE_NPC_ID,
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (visible) {
      visible.__skipDefaultRespawn = true;
      visibleGhasts.set(visible, player);
    }
    player.sendMessage("The druid pouch makes the ghast visible.");
  }

  function firstProduce(player) {
    for (const itemId of POUCH_PRODUCE_ITEM_IDS) if (held(player, itemId)) return itemId;
    return null;
  }

  /** Fill with three pieces, favouring the produce that grants more charges. */
  function fillPouch(player, produceId) {
    if (!held(player, produceId) || (!held(player, DRUID_POUCH_EMPTY_ITEM_ID) && !held(player, DRUID_POUCH_FILLED_ITEM_ID))) return false;
    const produce = [];
    for (const id of POUCH_PRODUCE_ITEM_IDS) for (let n=0;n<player.getInventory().getAmount(id)&&produce.length<3;n++) produce.push(id);
    if (produce.length<3) { player.sendMessage("You need at least three pieces of nature's bounty to fill the pouch."); return true; }
    for (const id of produce) player.getInventory().deleteNumber(id, 1);
    if (held(player, DRUID_POUCH_EMPTY_ITEM_ID)) player.getInventory().deleteNumber(DRUID_POUCH_EMPTY_ITEM_ID, 1);
    player.getInventory().adds(DRUID_POUCH_FILLED_ITEM_ID, produce.reduce((charges,id)=>charges+(id===MORT_MYRE_PEAR_ITEM_ID?3:id===MORT_MYRE_STEM_ITEM_ID?2:1),0));
    player.sendMessage("You fill the druid pouch with nature's bounty.");
    return true;
  }

  /** Filliman waits at his camp until the grotto ritual, then the Spirit is inside. */
  function ensureQuestNpcs(player) {
    if (!player) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_ENTERED_GROTTO) {
      despawn(player, FILLIMAN_NPC_ID);
      if (!hasSpawn(player, NATURE_SPIRIT_NPC_ID)) spawnAt(player, NATURE_SPIRIT_NPC_ID, NATURE_SPIRIT_CAMP);
      return;
    }
    if (stage >= STAGE_ENTERED_SWAMP && !hasSpawn(player, FILLIMAN_NPC_ID)) {
      spawnAt(player, FILLIMAN_NPC_ID, FILLIMAN_CAMP);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I helped Filliman become a Nature Spirit.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_ADDED_POUCH) {
      const killed = stage >= STAGE_KILLED_GHAST_3 ? 3 : stage >= 100 ? 2 : stage >= 95 ? 1 : 0;
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
    if (stage >= STAGE_ENTERED_GROTTO || stage >= STAGE_PERFORMED_RITUAL) {
      return ["Enter the grotto and speak to Filliman to complete his transformation."];
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN_2 || stage >= STAGE_PICKED_FUNGI) {
      return [
        "Place the fungus on the nature stone and the used spell on",
        "the spirit stone, then speak to Filliman on the faith stone.",
      ];
    }
    if (stage >= STAGE_CAST_SPELL || stage >= STAGE_BLESSED) {
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
    return ["Speak to <col=800000>Drezel</col> after completing Priest in Peril."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3000);
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 2000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 2000);
  }

  function drezelVariant(stage, player) {
    // Once complete, Drezel returns to his canonical post-quest page. The quest
    // transcript variants stop at the blessing/ghast conversations.
    if (stage >= STAGE_COMPLETE) {
      return { page: "Drezel", variant: "standard-dialogue-after-priest-in-peril-after-nature-spirit" };
    }
    if (stage === STAGE_RECEIVED_SPELL) {
      quest.setStage(player, STAGE_BLESSED);
      return "talking-to-drezel";
    }
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
    if (stage >= STAGE_ADDED_POUCH) return "entering-filliman-s-grove-subsequent-dialogue-with-filliman";
    if (stage >= STAGE_FULL_TRANSFORM) {
      return "entering-filliman-s-grove-talking-to-filliman-inside-his-grotto-again";
    }
    if (stage >= STAGE_ENTERED_GROTTO) {
      quest.setStage(player, STAGE_FULL_TRANSFORM);
      return "entering-filliman-s-grove-talking-to-filliman-inside-his-grove";
    }
    if (stage >= STAGE_PERFORMED_RITUAL) {
      return "talking-to-filliman-talking-to-filliman-outside-the-grove-again";
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN_2) {
      if (ritualReady(player)) quest.setStage(player, STAGE_PERFORMED_RITUAL);
      return "talking-to-filliman-talking-to-filliman-again-on-the-orange-stone";
    }
    if (stage >= STAGE_PICKED_FUNGI) {
      quest.setStage(player, STAGE_SPOKEN_FILLIMAN_2);
      return "talking-to-filliman";
    }
    if (stage >= STAGE_CAST_SPELL) return "talking-to-filliman";
    if (stage >= STAGE_RECEIVED_SPELL) return "finding-filliman-subsequent-dialogue-with-filliman-2";
    if (stage >= STAGE_GIVEN_JOURNAL) {
      quest.setStage(player, STAGE_RECEIVED_SPELL);
      return "finding-filliman-subsequent-dialogue-with-filliman-2";
    }
    if (stage >= STAGE_SHOWN_MIRROR) {
      return "finding-filliman-talking-to-filliman-again-after-using-a-mirror-on-him";
    }
    if (stage >= STAGE_SPOKEN_FILLIMAN) {
      return "finding-filliman-subsequent-dialogue-with-filliman";
    }
    if (stage >= STAGE_ENTERED_SWAMP) {
      if (!wearingGhostspeak(player)) {
        quest.setStage(player, STAGE_FAILED_TALK);
      } else {
        quest.setStage(player, STAGE_SPOKEN_FILLIMAN);
      }
      // The washing bowl is ensured on login and on entering the swamp, not in
      // this selector (variant selection must stay side-effect-free and cacheless).
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
      return drezelVariant(stage, player);
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
    const inventory = player.getInventory();
    if (value.includes("does not meet the requirements")) return !meetsRequirements(player);
    if (value.includes("meets the requirements")) return meetsRequirements(player);
    if (value.includes("talks to him again after speaking to him with a ghostspeak amulet")) {
      return wearingGhostspeak(player) && quest.getStage(player) >= STAGE_SPOKEN_FILLIMAN;
    }
    if (value.includes("without wearing a ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("not wearing the ghostspeak amulet")) return !wearingGhostspeak(player);
    if (value.includes("wearing the ghostspeak amulet")) return wearingGhostspeak(player);
    if (value.includes("not wearing their ghostspeak amulet")) return !wearingGhostspeak(player);
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
    if (value.includes("has not cast the bloom spell")) return quest.getStage(player) < STAGE_CAST_SPELL;
    if (value.includes("nothing rotten is nearby")) return false;
    if (value.includes("nearby rotten remnants")) return false;
    if (value.includes("after casting the bloom spell")) return quest.getStage(player) >= STAGE_CAST_SPELL;
    // The orange-stone conversation only completes the ritual with both offerings placed.
    if (value.includes("items are not all on their respective stones")) return !ritualReady(player);
    if (value.includes("all the items are placed onto their respective stones")) return ritualReady(player);
    if (value.includes("has killed 1 ghast")) return quest.getStage(player) >= 95;
    if (value.includes("has killed 2 ghasts")) return quest.getStage(player) >= 100;
    if (value.includes("has killed 3 ghass") || value.includes("has killed 3 ghasts")) {
      return quest.getStage(player) >= STAGE_KILLED_GHAST_3;
    }
    if (value.includes("does not have all three items")) {
      return !(held(player, MIRROR_ITEM_ID) && held(player, JOURNAL_ITEM_ID));
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== DREZEL_NPC_ID || hook !== START_HOOK) return;
    if (!meetsRequirements(player)) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /**
   * The food Drezel hands over during the start conversation (3 meat pies and
   * 3 apple pies). The message step emits the action event once as a generic
   * step and once as `kind: "message"`; only act on the message event so the
   * chat line still shows and the pies are handed out once.
   */
  function giveDrezelFood(event) {
    if (event.stepId !== FOOD_MESSAGE_ID || event.kind !== "message") return;
    if (event.npcId !== DREZEL_NPC_ID) return;
    const { player } = event;
    player.getInventory().adds(MEAT_PIE_ITEM_ID, 3);
    player.getInventory().adds(APPLE_PIE_ITEM_ID, 3);
  }

  /**
   * The Nature Spirit's blessing lines hand over the blessed sickle and the
   * druid pouch. The message step emits the action event once as a generic
   * step and once as `kind: "message"`; only act on the message event so the
   * chat line still shows and the items are handed out once.
   */
  function handleBlessingMessage(event) {
    if (event.kind !== "message") return;
    const { player, npcId, stepId } = event;
    if (npcId !== NATURE_SPIRIT_NPC_ID && npcId !== FILLIMAN_NPC_ID) return;
    if (stepId === SICKLE_BLESSED_MESSAGE_ID) {
      // Blessing a replacement sickle is also the lost-sickle recovery route;
      // never move a later stage backwards when the message replays.
      if (held(player, SILVER_SICKLE_ITEM_ID)) {
        player.getInventory().deleteNumber(SILVER_SICKLE_ITEM_ID, 1);
        if (!held(player, SILVER_SICKLE_BLESSED_ITEM_ID)) {
          player.getInventory().adds(SILVER_SICKLE_BLESSED_ITEM_ID, 1);
        }
      }
      if (quest.getStage(player) < STAGE_BLESSED_SICKLE) {
        quest.setStage(player, STAGE_BLESSED_SICKLE);
      }
      return;
    }
    if (stepId === POUCH_GIVEN_MESSAGE_ID) {
      if (!held(player, DRUID_POUCH_EMPTY_ITEM_ID) && !held(player, DRUID_POUCH_FILLED_ITEM_ID)) {
        player.getInventory().adds(DRUID_POUCH_EMPTY_ITEM_ID, 1);
      }
      if (quest.getStage(player) < STAGE_ADDED_POUCH) quest.setStage(player, STAGE_ADDED_POUCH);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === FOOD_MESSAGE_ID) {
      giveDrezelFood(event);
      return;
    }
    if (stepId === SICKLE_BLESSED_MESSAGE_ID || stepId === POUCH_GIVEN_MESSAGE_ID) {
      handleBlessingMessage(event);
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (npcId !== FILLIMAN_NPC_ID && npcId !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_KILLED_GHAST_3 && !quest.isComplete(player)) {
      quest.complete(player);
    }
  }

  /** The mirror proves to Filliman that he is dead. */
  function handleMirrorOnFilliman(event) {
    if (event.itemId !== MIRROR_ITEM_ID) return;
    const target = event.npcId ?? event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_SPOKEN_FILLIMAN) return;
    if (!wearingGhostspeak(event.player)) return;
    quest.setStage(event.player, STAGE_SHOWN_MIRROR);
    event.player.sendMessage("Filliman sees no reflection and finally accepts that he is dead.");
    event.handled = true;
  }

  /** Giving Filliman his journal earns the Bloom spell. */
  function handleJournalOnFilliman(event) {
    if (event.itemId !== JOURNAL_ITEM_ID) return;
    const target = event.npcId ?? event.target?.getId?.();
    if (target !== FILLIMAN_NPC_ID && target !== NATURE_SPIRIT_NPC_ID) return;
    if (quest.getStage(event.player) !== STAGE_SHOWN_MIRROR) return;
    if (!held(event.player, JOURNAL_ITEM_ID)) return;
    event.player.getInventory().deleteNumber(JOURNAL_ITEM_ID, 1);
    if (!held(event.player, DRUIDIC_SPELL_ITEM_ID)) event.player.getInventory().adds(DRUIDIC_SPELL_ITEM_ID, 1);
    quest.setStage(event.player, STAGE_GIVEN_JOURNAL);
    event.player.sendMessage("Filliman reads his journal and remembers his purpose.");
    event.handled = true;
  }

  /**
   * Casting the druidic Bloom spell while blessed turns it into the used spell
   * and grows fungi on a nearby rotting log, which can then be picked.
   */
  function handleSpellAction(event) {
    if (event.itemId !== DRUIDIC_SPELL_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("cast")) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_BLESSED || stage >= STAGE_PICKED_FUNGI) return;
    if (!held(player, DRUIDIC_SPELL_ITEM_ID)) return;
    const plant = nearestBloomable(player, SPELL_BLOOMABLE_IDS);
    if (!plant) {
      player.sendMessage("You cast the spell in the swamp.");
      player.sendMessage("There is no suitable material to be affected in this area.");
      event.handled = true;
      return;
    }
    replaceObject(plant, BLOOMED_PLANT.get(plant.getId()));
    player.getInventory().deleteNumber(DRUIDIC_SPELL_ITEM_ID, 1);
    player.getInventory().adds(USED_SPELL_ITEM_ID, 1);
    if (stage < STAGE_CAST_SPELL) quest.setStage(player, STAGE_CAST_SPELL);
    player.sendMessage("The Bloom spell makes fungi erupt from the rotting logs.");
    event.handled = true;
  }

  /** The blessed sickle's Bloom grows the swamp produce used to fill the pouch. */
  function handleSickleAction(event) {
    if (event.itemId !== SILVER_SICKLE_BLESSED_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("cast bloom")) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_BLESSED_SICKLE) return;
    const plant = nearestBloomable(player, SICKLE_BLOOMABLE_IDS);
    if (!plant) {
      player.sendMessage("There is no suitable material to be affected in this area.");
      event.handled = true;
      return;
    }
    replaceObject(plant, BLOOMED_PLANT.get(plant.getId()));
    if (quest.getStage(player) < STAGE_CAST_SICKLE_BLOOM) {
      quest.setStage(player, STAGE_CAST_SICKLE_BLOOM);
    }
    player.sendMessage("The blessed sickle makes the swamp plants bloom.");
    event.handled = true;
  }

  /** Picking the Bloom's produce; the first fungus picked completes the step. */
  function handleBloomPick(event) {
    const harvest = PLANT_HARVEST.get(event.objectId);
    if (harvest === undefined) return;
    const option = actionOf(event);
    if (!option.includes("pick") && !option.includes("take")) return;
    const { player } = event;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      event.handled = true;
      return;
    }
    player.getInventory().adds(harvest, 1);
    const source = [...BLOOMED_PLANT.entries()].find(([, bloomed]) => bloomed === event.objectId)?.[0];
    if (source !== undefined) replaceObject(event.object, source);
    if (event.objectId === FUNGI_ON_LOG_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_CAST_SPELL && stage < STAGE_PICKED_FUNGI) {
        quest.setStage(player, STAGE_PICKED_FUNGI);
      }
      player.sendMessage("You pick the fungus from the dead log.");
    } else if (event.objectId === BUDDING_BRANCH_ID) {
      player.sendMessage("You take a cutting from the budding branch.");
    } else {
      player.sendMessage("You pick the pear from the bush.");
    }
    event.handled = true;
  }

  /**
   * The ritual offerings: fungus on the nature stone (brown, west), the used
   * spell on the spirit stone (grey, east). The faith stone (orange, south)
   * takes neither; Filliman completes the ritual when talked to.
   */
  function handleStoneOffering(event) {
    const { player, objectId, itemId } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_PICKED_FUNGI || stage >= STAGE_ENTERED_GROTTO) return;
    if (objectId === NATURE_STONE_ID && itemId === MORT_MYRE_FUNGUS_ITEM_ID) {
      if (player.getAttribute(FUNGUS_OFFERING_ATTRIBUTE)) {
        player.sendMessage("The stone seems to be complete already.");
      } else {
        player.getInventory().deleteNumber(MORT_MYRE_FUNGUS_ITEM_ID, 1);
        player.setAttribute(FUNGUS_OFFERING_ATTRIBUTE, true);
        player.sendMessage("The stone seems to absorb the fungus.");
      }
      event.handled = true;
      return;
    }
    if (objectId === SPIRIT_STONE_ID && itemId === USED_SPELL_ITEM_ID) {
      if (player.getAttribute(SPELL_OFFERING_ATTRIBUTE)) {
        player.sendMessage("The stone seems to be complete already.");
      } else {
        player.getInventory().deleteNumber(USED_SPELL_ITEM_ID, 1);
        player.setAttribute(SPELL_OFFERING_ATTRIBUTE, true);
        player.sendMessage("The stone seems to absorb the used spell.");
        player.sendMessage("Aha, yes, that seems right - well done!");
      }
      event.handled = true;
      return;
    }
    if (objectId === NATURE_STONE_ID || objectId === SPIRIT_STONE_ID) {
      player.sendMessage("You try to place the item onto the stone, but it just moves off.");
      event.handled = true;
    } else if (objectId === FAITH_STONE_ID) {
      player.sendMessage("Nothing interesting happens.");
      event.handled = true;
    }
  }

  /** Taking the washing bowl uncovers the mirror hidden beneath it. */
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
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space to take the mirror.");
      return;
    }
    player.getInventory().adds(MIRROR_ITEM_ID, 1);
    player.sendMessage("You find a small mirror under the washing bowl.");
  }

  /** The druid pouch's "Fill" option packs the produce in the inventory. */
  function handlePouchFill(event) {
    if (event.itemId !== DRUID_POUCH_EMPTY_ITEM_ID && event.itemId !== DRUID_POUCH_FILLED_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("fill")) return;
    const produce = firstProduce(event.player);
    if (produce === null) {
      event.player.sendMessage("You have nothing to fill the druid pouch with.");
      event.handled = true;
      return;
    }
    if (fillPouch(event.player, produce)) event.handled = true;
  }

  /** Using nature's bounty on the empty pouch fills it too. */
  function handleProduceOnPouch(event) {
    const produce = POUCH_PRODUCE_ITEM_IDS.includes(event.usedItemId)
      ? event.usedItemId
      : POUCH_PRODUCE_ITEM_IDS.includes(event.usedWithItemId)
        ? event.usedWithItemId
        : null;
    if (produce === null) return;
    const other = produce === event.usedItemId ? event.usedWithItemId : event.usedItemId;
    if (other !== DRUID_POUCH_EMPTY_ITEM_ID && other !== DRUID_POUCH_FILLED_ITEM_ID) return;
    if (fillPouch(event.player, produce)) event.handled = true;
  }

  /** Using a filled pouch on an invisible ghast reveals it. */
  function handlePouchOnGhast(event) {
    if (event.npcId !== GHAST_NPC_ID) return;
    if (event.itemId !== DRUID_POUCH_EMPTY_ITEM_ID && event.itemId !== DRUID_POUCH_FILLED_ITEM_ID) return;
    const { player } = event;
    if (quest.getStage(player) < STAGE_ADDED_POUCH) return;
    if (event.itemId === DRUID_POUCH_EMPTY_ITEM_ID) {
      player.sendMessage("You have nothing left in your druid pouch!");
      event.handled = true;
      return;
    }
    revealGhast(player, event.target);
    event.handled = true;
  }

  /** Each revealed ghast that dies counts toward the three. */
  function handleGhastDeath(event) {
    const owner = visibleGhasts.get(event.npc);
    if (!owner) return;
    visibleGhasts.delete(event.npc);
    const player = event.killer ?? owner;
    const stage = quest.getStage(player);
    if (stage < STAGE_ADDED_POUCH || stage >= STAGE_KILLED_GHAST_3) return;
    const next = stage >= 100 ? STAGE_KILLED_GHAST_3 : stage >= 95 ? 100 : 95;
    quest.setStage(player, next);
    player.sendMessage(
      next === 95 ? "That's one Ghast, 2 more to kill."
        : next === 100 ? "That's two Ghasts, 1 more to kill."
        : "That's all three Ghasts!"
    );
  }

  /**
   * Walking a filled pouch past a ghast is what makes it attack and become
   * visible; scope it to the swamp so no other area pays for the hook.
   */
  function createSwampArea() {
    class MortMyreSwampArea extends Area {
      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (quest.getStage(player) < STAGE_ADDED_POUCH) return;
        if (!held(player, DRUID_POUCH_FILLED_ITEM_ID)) return;
        for (const npc of player.getLocalNpcs?.() ?? []) {
          if (npc?.getId?.() !== GHAST_NPC_ID) continue;
          if (player.calculateDistance(npc) > 1) continue;
          revealGhast(player, npc);
          return;
        }
      }
    }
    return new MortMyreSwampArea([SWAMP_BOUNDS]);
  }

  /**
   * The swamp gate is the only legitimate way into Mort Myre ("or Filliman will
   * not appear"): passing through it writes stage 10. Doors still swings the gate.
   */
  function handleSwampGate(request) {
    if (!SWAMP_GATE_IDS.has(request.objectId)) return;
    const { player } = request;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_ENTERED_SWAMP) return;
    quest.setStage(player, STAGE_ENTERED_SWAMP);
    player.sendMessage("You walk into the gloomy atmosphere of Mort Myre.");
    ensureQuestNpcs(player);
    ensureWashingBowl(player);
  }

  /** The grotto cave entrance/exit and the journal hidden in the grotto tree. */
  function handleGrotto(event) {
    const { player, objectId } = event;
    const option = actionOf(event);
    if (objectId === GROTTO_ID && option.includes("enter")) {
      event.handled = true;
      player.moveTo(new Location(GROTTO_INTERIOR.x, GROTTO_INTERIOR.y, GROTTO_INTERIOR.z));
      if (quest.getStage(player) >= STAGE_PERFORMED_RITUAL && quest.getStage(player) < STAGE_FULL_TRANSFORM) {
        quest.setStage(player, STAGE_ENTERED_GROTTO);
      }
      ensureQuestNpcs(player);
      return;
    }
    if (objectId === GROTTO_EXIT_ID && (option.includes("exit") || option.includes("leave"))) {
      event.handled = true;
      player.moveTo(new Location(GROTTO_SURFACE.x, GROTTO_SURFACE.y, GROTTO_SURFACE.z));
      return;
    }
    if (objectId === GROTTO_TREE_ID && option.includes("search")) {
      const stage = quest.getStage(player);
      if (stage < STAGE_SHOWN_MIRROR || stage >= STAGE_GIVEN_JOURNAL || held(player, JOURNAL_ITEM_ID)) return;
      event.handled = true;
      player.getInventory().adds(JOURNAL_ITEM_ID, 1);
      player.sendMessage("You find a journal hidden in the branches of the grotto tree.");
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

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureQuestNpcs(player);
    if (quest.getStage(player) >= STAGE_ENTERED_SWAMP) ensureWashingBowl(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearSpawns(player);
    for (const [npc, owner] of [...visibleGhasts]) {
      if (owner !== player) continue;
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

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
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
  api.onGroundItemPickup(handleWashingBowlPickup);
  api.onObjectInteraction(handleGrotto);
  api.onObjectInteraction(handleBloomPick);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.registerArea(createSwampArea());
};
