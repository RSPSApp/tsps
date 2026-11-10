/**
 * Plague City (members).
 *
 * The words come from the "Plague City" transcript page. Edmond, Alrena,
 * Jethick, the Rehnison family, Milli, the Clerk, Bravek and Elena are all
 * indexed, so this plugin selects the variant by stage, answers the prose
 * conditions, completes the quest through Edmond's own action and mixes the
 * hangover cure from the transcript's item recipes.
 *
 * Sources: OSRS Wiki Plague City/Quick guide and Transcript:Plague City;
 * locs and varbits verified against the revision 241 cache.
 * Warrant house entry, tunnel digging/travel, the Edmond pull scene and sewer/manhole return travel
 * still need native movement/scene evidence; these handlers do not simulate them.
 *
 * Stages (varp 165): 1 find dwellberries, 2 gas mask, 3 soften the mud, 4-7
 * one to four buckets of water, 8 tunnel open, 9 rope tied, 10 pipe open,
 * 20 shown picture, 21 returned book, 22 spoke to the Rehnisons, 23 spoke to
 * Milli, 24 need clearance, 25 clerk permission, 26 hangover cure, 27 warrant,
 * 28 freed Elena, 29 complete, 30 read scroll.
 *
 */
module.exports = function registerPlagueCityQuest(api) {
  const { Skill, Equipment, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const EDMOND_NPC_ID = NpcIdentifiers.EDMOND_2; // 4256
  const ALRENA_NPC_IDS = new Set([
    NpcIdentifiers.ALRENA,
    NpcIdentifiers.ALRENA_2,
    NpcIdentifiers.ALRENA_3,
  ]);
  const BRAVEK_NPC_IDS = new Set([NpcIdentifiers.BRAVEK, NpcIdentifiers.BRAVEK_2]);
  const CLERK_NPC_IDS = new Set([NpcIdentifiers.CLERK, NpcIdentifiers.CLERK_2]);
  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257
  ]);
  const TED_REHNISON_NPC_ID = NpcIdentifiers.TED_REHNISON; // 4263
  const MARTHA_REHNISON_NPC_ID = NpcIdentifiers.MARTHA_REHNISON; // 4264
  const MILLI_REHNISON_NPC_ID = NpcIdentifiers.MILLI_REHNISON; // 4266
  const JETHICK_NPC_IDS = new Set([
    NpcIdentifiers.JETHICK,
    NpcIdentifiers.JETHICK_2,
    NpcIdentifiers.JETHICK_3,
  ]);

  const VARP_PLAGUE_CITY = 165;
  const STAGE_FIND_DWELLBERRIES = 1;
  const STAGE_GAS_MASK = 2;
  const STAGE_SOFTEN_MUD = 3;
  const STAGE_WATER_4 = 7;
  const STAGE_TUNNEL_OPEN = 8;
  const STAGE_ROPE_TIED = 9;
  const STAGE_PIPE_OPEN = 10;
  const STAGE_SHOWN_PICTURE = 20;
  const STAGE_RETURNED_BOOK = 21;
  const STAGE_SPOKE_TO_REHNISONS = 22;
  const STAGE_SPOKE_TO_MILLI = 23;
  const STAGE_NEED_CLEARANCE = 24;
  const STAGE_CLERK_PERMISSION = 25;
  const STAGE_NEED_HANGOVER_CURE = 26;
  const STAGE_HAVE_WARRANT = 27;
  const STAGE_FREED_ELENA = 28;
  const STAGE_COMPLETE = 29;
  const STAGE_READ_SCROLL = 30;

  const DWELLBERRIES_ITEM_ID = ItemIdentifiers.DWELLBERRIES;
  const GAS_MASK_ITEM_ID = ItemIdentifiers.GAS_MASK;
  const HANGOVER_CURE_ITEM_ID = ItemIdentifiers.HANGOVER_CURE;
  const WARRANT_ITEM_ID = ItemIdentifiers.WARRANT;
  const ARDOUGNE_SCROLL_ITEM_ID = ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL;
  const CHOCOLATE_DUST_ITEM_ID = ItemIdentifiers.CHOCOLATE_DUST;
  const BUCKET_OF_MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const CHOCOLATEY_MILK_ITEM_ID = ItemIdentifiers.CHOCOLATEY_MILK;
  const SNAPE_GRASS_ITEM_ID = ItemIdentifiers.SNAPE_GRASS;

  const START_HOOK = "quest:plague-city:start";
  const COMPLETE_ACTION_ID = "aGVmkR";

  const MUD_MULTILOC_ID = 2532; // cache plaguemudpatch2, varbit 1785
  const GRILL_MULTILOC_ID = 11422; // cache plague_grill, varbit 1787
  const HOUSE_DOOR_MULTILOC_ID = 37321; // cache plagueelenadoorshut
  const GRILL_CHECKED_ATTRIBUTE = "plague-city:grill-checked";
  const CELL_UNLOCKED_ATTRIBUTE = "plague-city:cell-unlocked";
  const CURE_GIVEN_ATTRIBUTE = "plague-city:cure-given";
  const VARBIT_DUG_HOLE = 1785;
  const VARBIT_CHECKED_GRILL = 1786;
  const VARBIT_PIPE = 1787;

  const pendingDoors = new WeakMap();

  const ELENA_LOCKED_VARIANT = "freeing-elena-attempting-to-open-the-basement-door-of-the-plague-house-without-the-key";
  const DOOR_LOCKED_MESSAGE_STEP = "Gtrtgc";
  const talkingThroughBars = new WeakSet();

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGasMask = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === GAS_MASK_ITEM_ID;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Edmond</col>",
        "behind his house in <col=800000>East Ardougne</col>.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    const lines = ["<str>Edmond asked me to find his missing daughter Elena.</str>", ""];
    if (stage === STAGE_FIND_DWELLBERRIES) {
      lines.push("I need <col=800000>dwellberries</col> so Alrena can make a gas mask.");
    } else if (stage === STAGE_GAS_MASK) {
      lines.push("<str>Alrena made me a gas mask.</str>", "I should speak to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_SOFTEN_MUD && stage < STAGE_WATER_4) {
      lines.push("I must pour four <col=800000>buckets of water</col> onto the mud patch.");
    } else if (stage === STAGE_WATER_4) {
      lines.push("The soil is soft. I should use a <col=800000>spade</col> on it.");
    } else if (stage === STAGE_TUNNEL_OPEN) {
      lines.push("I reached the sewers. The pipe grill needs a <col=800000>rope</col>.");
    } else if (stage === STAGE_ROPE_TIED) {
      lines.push("The rope is tied. I need <col=800000>Edmond</col> to help pull the grill away.");
    } else if (stage === STAGE_PIPE_OPEN) {
      lines.push("I should wear my gas mask, enter West Ardougne, and find <col=800000>Jethick</col>.");
    } else if (stage === STAGE_SHOWN_PICTURE) {
      lines.push("Jethick gave me a book to return to the <col=800000>Rehnison family</col>.");
    } else if (stage === STAGE_RETURNED_BOOK) {
      lines.push("I should ask <col=800000>Ted or Martha Rehnison</col> about Elena.");
    } else if (stage === STAGE_SPOKE_TO_REHNISONS) {
      lines.push("Their daughter <col=800000>Milli</col> saw what happened. She is upstairs.");
    } else if (stage === STAGE_SPOKE_TO_MILLI) {
      lines.push("I should investigate the plague house in southern West Ardougne.");
    } else if (stage === STAGE_NEED_CLEARANCE) {
      lines.push("I need clearance from <col=800000>Bravek</col> to enter the plague house.");
    } else if (stage === STAGE_NEED_HANGOVER_CURE) {
      lines.push("Bravek needs a <col=800000>hangover cure</col> before he can help me.");
    } else if (stage === STAGE_HAVE_WARRANT) {
      lines.push("I have a warrant. I must enter the plague house and free Elena.");
    } else if (stage === STAGE_FREED_ELENA) {
      lines.push("<str>I freed Elena.</str>", "I should return to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_COMPLETE) {
      lines.push(
        "<str>Edmond rewarded me for rescuing Elena.</str>",
        stage >= STAGE_READ_SCROLL
          ? "<str>I learned the Ardougne Teleport spell.</str>"
          : "I should read Edmond's magic scroll.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 2425);
  }

  function edmondVariant(stage) {
    if (stage >= STAGE_COMPLETE) {
      return "after-freeing-elena-edmond-talking-to-edmond-again-before-using-the-ardougne-teleport-scroll";
    }
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-edmond";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-edmond-after-unlocking-west-ardougne";
    if (stage === STAGE_ROPE_TIED) {
      return "starting-the-quest-talking-to-edmond-after-tying-the-rope-to-the-grill-on-the-pipe";
    }
    if (stage === STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-edmond-in-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-edmond-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage === 6) return "starting-the-quest-talking-to-edmond-after-pouring-three-buckets-of-water-on-the-mud-patch";
    if (stage === 5) return "starting-the-quest-talking-to-edmond-after-pouring-two-buckets-of-water-on-the-mud-patch";
    if (stage === 4) return "starting-the-quest-talking-to-edmond-after-pouring-one-bucket-of-water-on-the-mud-patch";
    if (stage === STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-edmond-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-edmond-after-getting-the-gas-mask";
    if (stage === STAGE_FIND_DWELLBERRIES) return "starting-the-quest-talking-to-edmond-before-getting-dwellberries";
    return "starting-the-quest-talking-to-edmond";
  }

  function alrenaVariant(stage, player) {
    if (stage < STAGE_FIND_DWELLBERRIES) return null;
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-talking-to-alrena-after-freeing-elena";
    if (stage >= STAGE_SHOWN_PICTURE) return "entering-west-ardougne-talking-to-alrena-after-jethick-asks-for-elena-s-picture";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-alrena-after-unlocking-west-ardougne";
    if (stage >= STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-alrena-after-digging-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-alrena-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage >= STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-alrena-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-alrena-after-getting-the-gas-mask";
    if (held(player, DWELLBERRIES_ITEM_ID)) {
      return "starting-the-quest-talking-to-alrena-after-getting-dwellberries";
    }
    return "starting-the-quest-talking-to-alrena-before-getting-dwellberries";
  }

  function jethickVariant(stage, player) {
    if (stage >= STAGE_RETURNED_BOOK) return "finding-elena-talking-to-jethick-after-delivering-the-book";
    if (stage >= STAGE_SHOWN_PICTURE) {
      return "finding-elena-talking-to-jethick-after-getting-elena-s-picture-talking-to-jethick-again-before-delivering-the-book";
    }
    if (stage >= STAGE_PIPE_OPEN) {
      if (held(player, ItemIdentifiers.PICTURE)) {
        return "finding-elena-talking-to-jethick-after-getting-elena-s-picture";
      }
      return "entering-west-ardougne-talking-to-jethick-if-the-player-does-not-have-elena-s-picture";
    }
    return null;
  }

  function rehnisonVariant(stage, afterFreeingVariant) {
    if (stage >= STAGE_FREED_ELENA) return afterFreeingVariant;
    if (stage >= STAGE_SPOKE_TO_MILLI) return "finding-elena-talking-to-ted-rehnison-after-questioning-milli";
    if (stage === STAGE_RETURNED_BOOK || stage === STAGE_SPOKE_TO_REHNISONS) {
      return "finding-elena-talking-to-ted-rehnison";
    }
    return "entering-west-ardougne-talking-to-ted-rehnison-before-getting-the-book-from-jethick";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === EDMOND_NPC_ID) {
      if (stage === STAGE_TUNNEL_OPEN && player.getAttribute(GRILL_CHECKED_ATTRIBUTE)) return "starting-the-quest-talking-to-edmond-after-trying-to-pull-the-grill";
      return edmondVariant(stage);
    }
    if (ALRENA_NPC_IDS.has(npcId)) return alrenaVariant(stage, player);
    if (JETHICK_NPC_IDS.has(npcId)) return jethickVariant(stage, player);
    if (npcId === TED_REHNISON_NPC_ID) {
      if (stage === STAGE_RETURNED_BOOK || stage === STAGE_SPOKE_TO_REHNISONS) {
        quest.setStage(player, STAGE_SPOKE_TO_REHNISONS);
      }
      return rehnisonVariant(stage, "after-freeing-elena-talking-to-ted-rehnison-after-freeing-elena");
    }
    if (npcId === MARTHA_REHNISON_NPC_ID) {
      if (stage >= STAGE_SPOKE_TO_MILLI) {
        return "finding-elena-talking-to-martha-rehnison-after-questioning-milli";
      }
      if (stage >= STAGE_RETURNED_BOOK) {
        quest.setStage(player, STAGE_SPOKE_TO_REHNISONS);
        return "finding-elena-talking-to-martha-rehnison";
      }
      return null;
    }
    if (npcId === MILLI_REHNISON_NPC_ID) {
      if (stage >= STAGE_SPOKE_TO_MILLI) {
        return "finding-elena-talking-to-milli-rehnison-after-attempting-to-enter-the-plague-house";
      }
      if (stage === STAGE_SPOKE_TO_REHNISONS) {
        quest.setStage(player, STAGE_SPOKE_TO_MILLI);
        return "finding-elena-talking-to-milli-rehnison";
      }
      return null;
    }
    if (CLERK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_NEED_HANGOVER_CURE) return "finding-elena-talking-to-clerk-after-meeting-bravek";
      if (stage === STAGE_CLERK_PERMISSION) {
        return "finding-elena-talking-to-the-clerk-after-getting-permission-to-speak-to-bravek";
      }
      if (stage === STAGE_NEED_CLEARANCE) {
        return "finding-elena-talking-to-the-clerk-before-getting-permission-to-speak-to-bravek";
      }
      return "entering-west-ardougne-talking-to-main-clerk-in-west-ardougne";
    }
    if (BRAVEK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HAVE_WARRANT) return "finding-elena-talking-to-bravek-after-receiving-the-warrant";
      if (stage === STAGE_NEED_HANGOVER_CURE) {
        if (player.getAttribute(CURE_GIVEN_ATTRIBUTE)) return "finding-elena-talking-to-bravek-before-getting-the-warrant";
        if (held(player, HANGOVER_CURE_ITEM_ID)) {
          return "finding-elena-talking-to-bravek-after-getting-the-hangover-cure";
        }
        return "finding-elena-talking-to-bravek-talking-to-bravek-again-before-getting-the-hangover-cure";
      }
      if (stage === STAGE_CLERK_PERMISSION) {
        quest.setStage(player, STAGE_NEED_HANGOVER_CURE);
        return "finding-elena-talking-to-bravek";
      }
      return "finding-elena-attempting-to-open-the-door-to-bravek-before-the-clerk-lets-you-in";
    }
    if (ELENA_NPC_IDS.has(npcId)) {
      if (stage === STAGE_HAVE_WARRANT && player.getAttribute(CELL_UNLOCKED_ATTRIBUTE)) {
        quest.setStage(player, STAGE_FREED_ELENA);
        return "freeing-elena-talking-to-elena-after-unlocking-the-basement-door";
      }
      if (stage < STAGE_FREED_ELENA) {
        if (npcId !== NpcIdentifiers.ELENA_2 || stage < STAGE_FIND_DWELLBERRIES) return null;
        talkingThroughBars.add(player);
        return ELENA_LOCKED_VARIANT;
      }
      return "freeing-elena-talking-to-elena-after-unlocking-the-basement-door";
    }
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (![ALRENA_NPC_IDS, JETHICK_NPC_IDS, CLERK_NPC_IDS, BRAVEK_NPC_IDS, ELENA_NPC_IDS].some(ids => ids.has(npcId)) && ![EDMOND_NPC_ID, TED_REHNISON_NPC_ID, MARTHA_REHNISON_NPC_ID, MILLI_REHNISON_NPC_ID].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    if (value.includes("already has the gas mask")) return held(player, GAS_MASK_ITEM_ID) || wearingGasMask(player);
    if (value.includes("does not have the gas mask") || value.includes("does not have a gas mask")) {
      return !held(player, GAS_MASK_ITEM_ID) && !wearingGasMask(player);
    }
    if (value.includes("has a gas mask")) return held(player, GAS_MASK_ITEM_ID);
    if (value.includes("has no inventory space")) return inventory.isFull();
    if (value.includes("edmond has not told the player to pour water")) return quest.getStage(player) < STAGE_SOFTEN_MUD;
    if (value.includes("first, second, or third bucket")) return quest.getStage(player) < STAGE_WATER_4;
    if (value.includes("fourth bucket of water")) return quest.getStage(player) >= STAGE_WATER_4;
    if (value.includes("grill has not been removed")) return quest.getStage(player) < STAGE_PIPE_OPEN;
    if (value.includes("not wearing a gas mask")) return !wearingGasMask(player);
    if (value.includes("has not talked to jethick before")) return quest.getStage(player) < STAGE_SHOWN_PICTURE;
    if (value.includes("has talked to jethick before")) return quest.getStage(player) >= STAGE_SHOWN_PICTURE;
    if (value.includes("lost the scruffy note")) return !held(player, ItemIdentifiers.A_SCRUFFY_NOTE);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== EDMOND_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_FIND_DWELLBERRIES) quest.setStage(player, STAGE_FIND_DWELLBERRIES);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === NpcIdentifiers.ELENA_2 && stepId === DOOR_LOCKED_MESSAGE_STEP && talkingThroughBars.has(player)) {
      talkingThroughBars.delete(player);
      event.handled = true;
      return;
    }
    const stage = quest.getStage(player);
    const inventory = player.getInventory();
    if (ALRENA_NPC_IDS.has(npcId) && stepId === "Br9tOd" && stage === STAGE_FIND_DWELLBERRIES && held(player, DWELLBERRIES_ITEM_ID)) {
      inventory.deleteNumber(DWELLBERRIES_ITEM_ID, 1);
      inventory.adds(GAS_MASK_ITEM_ID, 1);
      quest.setStage(player, STAGE_GAS_MASK);
    }
    if (ALRENA_NPC_IDS.has(npcId) && stepId === "jG6mG3" && stage >= STAGE_GAS_MASK && !held(player, GAS_MASK_ITEM_ID) && !wearingGasMask(player) && inventory.getFreeSlots() > 0) inventory.adds(GAS_MASK_ITEM_ID, 1);
    if (npcId === EDMOND_NPC_ID && stepId === "oCU2uO" && stage === STAGE_ROPE_TIED) quest.setStage(player, STAGE_PIPE_OPEN);
    if (npcId === TED_REHNISON_NPC_ID && stepId === "zQse1w" && stage === STAGE_SHOWN_PICTURE && held(player, ItemIdentifiers.BOOK_2)) {
      inventory.deleteNumber(ItemIdentifiers.BOOK_2, 1);
      quest.setStage(player, STAGE_RETURNED_BOOK);
      openPendingDoor(player);
    }
    if (BRAVEK_NPC_IDS.has(npcId) && ["nxSgWb", "sY8emd"].includes(stepId) && stage === STAGE_NEED_HANGOVER_CURE && !held(player, ItemIdentifiers.A_SCRUFFY_NOTE) && inventory.getFreeSlots() > 0) inventory.adds(ItemIdentifiers.A_SCRUFFY_NOTE, 1);
    if (BRAVEK_NPC_IDS.has(npcId) && stepId === "Z2OftI" && stage === STAGE_NEED_HANGOVER_CURE && held(player, HANGOVER_CURE_ITEM_ID)) {
      inventory.deleteNumber(HANGOVER_CURE_ITEM_ID, 1);
      player.setAttribute(CURE_GIVEN_ATTRIBUTE, true);
    }
    if (BRAVEK_NPC_IDS.has(npcId) && stepId === "Pn2ogc" && stage === STAGE_NEED_HANGOVER_CURE && player.getAttribute(CURE_GIVEN_ATTRIBUTE) && inventory.getFreeSlots() > 0) {
      inventory.adds(WARRANT_ITEM_ID, 1);
      quest.setStage(player, STAGE_HAVE_WARRANT);
    }
    if (stepId === "LILHam" && stage === STAGE_SPOKE_TO_MILLI) quest.setStage(player, STAGE_NEED_CLEARANCE);
    // "Jethick gives you a book." - he has shown the player Elena's picture.
    if (JETHICK_NPC_IDS.has(npcId) && stepId === "_dk_wV") {
      if (stage !== STAGE_PIPE_OPEN || !held(player, ItemIdentifiers.PICTURE) || inventory.getFreeSlots() < 1) return;
      if (!held(player, ItemIdentifiers.BOOK_2)) inventory.adds(ItemIdentifiers.BOOK_2, 1);
      quest.setStage(player, STAGE_SHOWN_PICTURE);
      return;
    }
    if (npcId === EDMOND_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_FREED_ELENA && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
  }

  function openPendingDoor(player) {
    const object = pendingDoors.get(player);
    pendingDoors.delete(player);
    if (object && player.getLocation().getDistance(object.getLocation()) <= 2) api.emitCustomEvent("door:open", { player, object, handled: false });
  }

  function handleDoor(event) {
    const { player, object, objectId, location } = event;
    const stage = quest.getStage(player);
    if (objectId === ObjectIdentifiers.DOOR_80 && location.x === 2530 && location.y === 3314 && location.z === 0 && stage < STAGE_CLERK_PERMISSION) {
      event.handled = true;
      startTranscript(api, player, NpcIdentifiers.BRAVEK, "Plague City", "finding-elena-attempting-to-open-the-door-to-bravek-before-the-clerk-lets-you-in");
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_85 && location.x === 2531 && location.y === 3328 && location.z === 0) {
      if (stage >= STAGE_RETURNED_BOOK) return;
      event.handled = true;
      if (stage === STAGE_SHOWN_PICTURE && held(player, ItemIdentifiers.BOOK_2)) {
        pendingDoors.set(player, object);
        startTranscript(api, player, TED_REHNISON_NPC_ID, "Plague City", "finding-elena-returning-the-book-to-ted-rehnison");
      } else startTranscript(api, player, TED_REHNISON_NPC_ID, "Plague City", "entering-west-ardougne-talking-to-ted-rehnison-before-getting-the-book-from-jethick");
      return;
    }
    if (objectId === HOUSE_DOOR_MULTILOC_ID && [2533, 2540].includes(location.x) && [3272, 3273].includes(location.y) && location.z === 0) {
      if (stage >= STAGE_HAVE_WARRANT) return;
      event.handled = true;
      const variant = stage === STAGE_SPOKE_TO_MILLI
        ? "finding-elena-attempting-to-enter-the-plague-house-elena-is-in-first-attempt-after-talking-to-milli-rehnison"
        : "finding-elena-attempting-to-enter-the-plague-house-elena-is-in-attempting-before-talking-to-milli-rehnison-and-subsequent-attempts";
      startTranscript(api, player, NpcIdentifiers.MOURNER, "Plague City", variant);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_78 && location.x === 2539 && location.y === 9672 && location.z === 0) {
      if (stage >= STAGE_HAVE_WARRANT && (player.getAttribute(CELL_UNLOCKED_ATTRIBUTE) || held(player, ItemIdentifiers.A_SMALL_KEY))) {
        if (!player.getAttribute(CELL_UNLOCKED_ATTRIBUTE)) player.sendMessage("You unlock the door.");
        player.setAttribute(CELL_UNLOCKED_ATTRIBUTE, true);
      } else {
        event.handled = true;
        talkingThroughBars.delete(player);
        startTranscript(api, player, NpcIdentifiers.ELENA_2, "Plague City", ELENA_LOCKED_VARIANT);
      }
    }
  }

  function useCure(event) {
    if (!BRAVEK_NPC_IDS.has(event.npcId) || event.itemId !== HANGOVER_CURE_ITEM_ID || quest.getStage(event.player) !== STAGE_NEED_HANGOVER_CURE || !held(event.player, HANGOVER_CURE_ITEM_ID)) return;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, "Plague City", "finding-elena-talking-to-bravek-after-getting-the-hangover-cure");
  }

  function openGrill(event) {
    if (![GRILL_MULTILOC_ID, ObjectIdentifiers.GRILL_4].includes(event.objectId) || event.location.x !== 2514 || event.location.y !== 9739 || event.location.z !== 0) return false;
    if (quest.getStage(event.player) === STAGE_TUNNEL_OPEN) {
      event.player.setAttribute(GRILL_CHECKED_ATTRIBUTE, true);
      event.player.getPacketSender().sendVarbit(VARBIT_CHECKED_GRILL, 1);
    }
    event.player.sendMessage("The grill is too secure. You can't pull it off alone.");
    return true;
  }

  function cupboard(event) {
    if (![ObjectIdentifiers.CUPBOARD_16, ObjectIdentifiers.CUPBOARD_17].includes(event.objectId) || event.location.x !== 2574 || event.location.y !== 3334 || event.location.z !== 0) return false;
    const { player, object } = event;
    if (event.option === "search") {
      if (quest.getStage(player) < STAGE_GAS_MASK) return false;
      startTranscript(api, player, NpcIdentifiers.ALRENA, "Plague City", "starting-the-quest-searching-the-cupboard");
    } else {
      const id = event.option === "close" ? ObjectIdentifiers.CUPBOARD_16 : ObjectIdentifiers.CUPBOARD_17;
      api.core.ObjectManager.deregister(object, true);
      api.core.ObjectManager.register(new api.core.GameObject(id, object.getLocation().clone(), object.getType(), object.getFace()), true);
    }
    return true;
  }

  function searchBarrel(event) {
    if (event.objectId !== ObjectIdentifiers.BARREL_11 || event.location.x !== 2534 || event.location.y !== 3268 || event.location.z !== 0) return false;
    const { player } = event;
    const inventory = player.getInventory();
    if (quest.getStage(player) === STAGE_HAVE_WARRANT && !held(player, ItemIdentifiers.A_SMALL_KEY) && inventory.getFreeSlots() > 0) {
      inventory.adds(ItemIdentifiers.A_SMALL_KEY, 1);
      player.sendMessage("You find a small key in the barrel.");
    }
    return true;
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId, location } = event;
    if (itemId === ItemIdentifiers.BUCKET_OF_WATER && [MUD_MULTILOC_ID, ObjectIdentifiers.MUD_PATCH_2, ObjectIdentifiers.MUD_PATCH_3].includes(objectId) && location.x === 2566 && location.y >= 3331 && location.y <= 3333 && location.z === 0) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage < STAGE_SOFTEN_MUD) {
        player.sendMessage("You see no reason to do that at the moment.");
      } else if (stage < STAGE_WATER_4 && held(player, ItemIdentifiers.BUCKET_OF_WATER)) {
        player.getInventory().deleteNumber(ItemIdentifiers.BUCKET_OF_WATER, 1);
        player.getInventory().adds(ItemIdentifiers.BUCKET, 1);
        quest.setStage(player, stage + 1);
        player.sendMessage(stage + 1 === STAGE_WATER_4 ? "You pour water onto the soil. The soil is now soft enough to dig into." : "You pour water onto the soil. The soil softens slightly.");
      }
    }
    if (itemId === ItemIdentifiers.ROPE && [GRILL_MULTILOC_ID, ObjectIdentifiers.GRILL_4].includes(objectId) && location.x === 2514 && location.y === 9739 && location.z === 0 && quest.getStage(player) === STAGE_TUNNEL_OPEN) {
      event.handled = true;
      if (!player.getAttribute(GRILL_CHECKED_ATTRIBUTE)) {
        startTranscript(api, player, EDMOND_NPC_ID, "Plague City", "starting-the-quest-interacting-with-the-pipe-using-rope-on-the-grill-before-trying-to-open-it-first");
      } else if (held(player, ItemIdentifiers.ROPE)) {
        player.getInventory().deleteNumber(ItemIdentifiers.ROPE, 1);
        quest.setStage(player, STAGE_ROPE_TIED);
        player.sendMessage("You tie the end of the rope to the sewer pipe's grill.");
      }
    }
    if (itemId === ItemIdentifiers.A_SMALL_KEY && objectId === ObjectIdentifiers.DOOR_78 && location.x === 2539 && location.y === 9672 && location.z === 0 && held(player, ItemIdentifiers.A_SMALL_KEY) && quest.getStage(player) >= STAGE_HAVE_WARRANT) {
      event.handled = true;
      player.setAttribute(CELL_UNLOCKED_ATTRIBUTE, true);
      player.sendMessage("You unlock the door.");
      api.emitCustomEvent("door:open", { player, object: event.object, handled: false });
    }
  }

  /**
   * Wiki (Ardougne teleport scroll): "If a player loses this scroll, they can go back to Edmond." His after-quest
   * transcript ("Do you have any more of those scrolls?" / "Yes, here you go.") has no item step, so the line gives it.
   */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (CLERK_NPC_IDS.has(npcId) && text === "I suppose they can come in then. If they keep it short." && quest.getStage(player) === STAGE_NEED_CLEARANCE) quest.setStage(player, STAGE_CLERK_PERMISSION);
    if (npcId === EDMOND_NPC_ID && text === "I've already tried digging down to them but the soil is rock hard. You'll need to pour on several buckets of water to soften it up. I reckon four buckets should do it." && quest.getStage(player) === STAGE_GAS_MASK) quest.setStage(player, STAGE_SOFTEN_MUD);
    if (npcId !== EDMOND_NPC_ID || text !== "Yes, here you go." || !quest.isComplete(player)) return;
    if (held(player, ARDOUGNE_SCROLL_ITEM_ID)) return;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    inventory.adds(ARDOUGNE_SCROLL_ITEM_ID, 1);
  }

  /** Bravek's hangover cure: chocolate dust + milk, then snape grass. */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    const hasPair = (a, b) => ids.includes(a) && ids.includes(b);
    if (hasPair(CHOCOLATE_DUST_ITEM_ID, BUCKET_OF_MILK_ITEM_ID)) {
      event.player.getInventory().deleteNumber(CHOCOLATE_DUST_ITEM_ID, 1);
      event.player.getInventory().deleteNumber(BUCKET_OF_MILK_ITEM_ID, 1);
      event.player.getInventory().adds(CHOCOLATEY_MILK_ITEM_ID, 1);
      event.player.sendMessage("You mix the chocolate dust into the bucket of milk.");
      event.handled = true;
      return;
    }
    if (hasPair(SNAPE_GRASS_ITEM_ID, CHOCOLATEY_MILK_ITEM_ID)) {
      event.player.getInventory().deleteNumber(SNAPE_GRASS_ITEM_ID, 1);
      event.player.getInventory().deleteNumber(CHOCOLATEY_MILK_ITEM_ID, 1);
      event.player.getInventory().adds(HANGOVER_CURE_ITEM_ID, 1);
      event.player.sendMessage("You mix the snape grass into the bucket and make a hangover cure.");
      event.handled = true;
    }
  }

  function syncObjects({ player, key }) {
    if (key !== undefined && key !== "plague_city") return;
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_DUG_HOLE, stage >= STAGE_TUNNEL_OPEN ? 1 : 0);
    sender.sendVarbit(VARBIT_CHECKED_GRILL, player.getAttribute(GRILL_CHECKED_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_PIPE, stage >= STAGE_PIPE_OPEN ? 2 : stage >= STAGE_ROPE_TIED ? 1 : 0);
  }

  function handleLogin({ player }) {
    syncObjects({ player });
    refreshQuestList(player);
  }

  /**
   * Wiki (Ardougne teleport scroll): reading it after the quest teaches the Ardougne Teleport spell and uses the
   * scroll up; any further scroll "will explode on use, converting into ashes" (no line is given for that).
   */
  function readScroll(event) {
    const { player, item, slot } = event;
    if (event.itemId !== ARDOUGNE_SCROLL_ITEM_ID) return false;
    event.handled = true;
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item || !quest.isComplete(player)) return true;
    if (quest.getStage(player) >= STAGE_READ_SCROLL) {
      inventory.setItem(slot, new api.core.Item(ItemIdentifiers.ASHES, 1));
      inventory.refreshItems();
      return true;
    }
    inventory.deleteAtSlot(slot, 1);
    quest.setStage(player, STAGE_READ_SCROLL);
    player.sendMessage("You memorise what is written on the scroll. You can now use the Ardougne Teleport Spell.");
    refreshQuestList(player);
    return true;
  }

  quest = registerQuest(api, {
    key: "plague_city",
    name: "Plague City",
    varpId: VARP_PLAGUE_CITY,
    startedValue: STAGE_FIND_DWELLBERRIES,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.MINING.getIndex(), amount: 2425, label: "Mining" }],
    rewardItemId: ARDOUGNE_SCROLL_ITEM_ID,
    rewardItemLabel: "Magic scroll",
    otherRewards: ["Access to the Ardougne Teleport spell after reading the scroll"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(GRILL_CHECKED_ATTRIBUTE, false);
  api.persistAttribute(CELL_UNLOCKED_ATTRIBUTE, false);
  api.persistAttribute(CURE_GIVEN_ATTRIBUTE, false);
  api.onCustomEvent("quest:stage-changed", syncObjects);
  api.onCustomEvent("door:toggle", handleDoor);
  api.onObjectInteraction("Grill", { Open: openGrill });
  api.onObjectInteraction("Cupboard", { Open: cupboard, Close: cupboard, Search: cupboard });
  api.onObjectInteraction("Barrel", { Search: searchBarrel });
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(useCure);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Ardougne teleport scroll", { Read: readScroll });
  api.onPlayerLogin(handleLogin);
};
