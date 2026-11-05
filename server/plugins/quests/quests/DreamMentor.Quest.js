/**
 * Dream Mentor (members).
 *
 * The words come from the "Dream Mentor" transcript page (plus the shared
 * "'Bird's-Eye' Jack" and "Cyrisus" pages' standard variants); this plugin
 * supplies the Talk-to dispatch for the fallen man/Cyrisus, 'Bird's-Eye' Jack
 * and the Oneiromancer, the food/spirit recovery loop, the chest-and-armour
 * check, the dream potion chain, the Dream Hall brazier and the four-monster
 * dream fight.
 *
 * Stage varbit 3618 "dream_prog" (varp 1003, bits 0-5; lookup-gameval.ts
 * dream_prog). Durable stages below are translated by nativeProgress; native 24
 * includes the fight, native 26 awaits the reward, and native 28 is complete:
 *   0 not started, 2 helping the fallen man, 6 his name is Cyrisus (both first
 *   thresholds met), 16 armour requested ('Bird's-Eye' Jack appears at the
 *   Lunar bank: NPC 6126 transforms to 3472 at even dream_prog 16-28), 18
 *   dressed, 20 fear revealed / meet the Oneiromancer, 22 plan agreed + dream
 *   vial given, 24 dream potion made, 26 inside the dream, 28 the fears are
 *   conquered, 30 complete. Odd values are unused.
 *
 * Sibling state mirrored to the cache varbits of varp 1003/1005: 3621
 * dream_health, 3622 dream_spirit, 3623 dream_armament, 3624
 * dream_banker_intro, 3634 dream_cyris_multi (1-3 shows Cyrisus 6124 beside
 * the Oneiromancer as 3469/3470/3471, 4-6 shows 6125 beside the Dream Hall
 * brazier; 0 hides both). Varbit 2430 lunar_brazier_lit lights the Dream Hall
 * ceremonial brazier (multiloc 17025 at 2072,3911).
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 15,000 Hitpoints and 10,000 Magic
 * XP, a dreamy lamp, the seven Dream Mentor Lunar spells and Lunar Isle bank
 * access without a Seal of Passage.
 *
 * Source: OSRS Wiki "Dream Mentor" page, quick guide and transcript; every
 * cache id confirmed with scripts/lookup-gameval.ts and CacheDefinitions.
 *
 * Gaps / approximations:
 *  - Cyrisus keeps one cave model through the recovery; the cache's waking and
 *    sitting forms (3466/3467) are not swapped in.
 *  - Cyrisus's bank is not a real container: 'Bird's-Eye' Jack hands over the
 *    chest and the player stores the armour in it (item on item). The "Using
 *    the bank" menu option does nothing.
 *  - The world's Jack at 2099,3921 stands on the unwalkable bank counter, so the
 *    quest spawns its own owner-only Jack on the bank floor at 2099,3919 while
 *    stages 16-29 run (same pattern as Lunar Diplomacy's Baba Yaga/Jack).
 *  - Astral Contact is not implemented, so "gearing-up-astral-contacting-cyrisus"
 *    and "gearing-up-showing-him-gear-through-astral-contact" never play; the
 *    in-person variant carries both beats of the gear check.
 *  - The fight is one owner-only boss at a time in the Dream World arena
 *    (1824,5144-5152,2). A Doubt is not summoned, the overhead dialogue
 *    variants are not played, and the arena's one static Inadequacy
 *    (1823,5149,2) is removed on entry and respawned on leaving.
 *  - "Our lives" has no Read text, the vial/potion handovers use plain game
 *    messages, and the dreamy lamp cannot be rubbed.
 */
module.exports = function registerDreamMentorQuest(api) {
  const {
    CacheDefinitions,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Dream Mentor";
  const START_HOOK = "quest:dream-mentor:start";

  // ==========================================================================
  // Ids
  // ==========================================================================

  // Varbits (lookup-gameval.ts dream).
  const VARBIT_STAGE = 3618; // dream_prog, varp 1003 bits 0-5
  const VARBIT_HEALTH = 3621; // dream_health, bits 9-15
  const VARBIT_SPIRIT = 3622; // dream_spirit, bits 16-22
  const VARBIT_ARMAMENT = 3623; // dream_armament, bits 23-29
  const VARBIT_BANKER_INTRO = 3624; // dream_banker_intro, bit 30
  const VARBIT_CYRIS_MULTI = 3634; // dream_cyris_multi, varp 1005 bits 8-10
  const VARBIT_BRAZIER_LIT = 2430; // lunar_brazier_lit, varp 675 bit 9

  const STAGE_STARTED = 2;
  const STAGE_NAMED = 6;
  const STAGE_ARMOUR = 16;
  const STAGE_DRESSED = 18;
  const STAGE_FEAR = 20;
  const STAGE_VIAL = 22;
  const STAGE_POTION = 24;
  const STAGE_DREAM = 26;
  const STAGE_DEFEATED = 28;
  const STAGE_COMPLETE = 30;

  const HEALTH_THRESHOLD = 70;
  const SPIRIT_THRESHOLD = 75;
  const WAKE_HEALTH = 30;
  const HEALTH_PER_FOOD = 5;
  const SPIRIT_PER_TALK = 10;
  const COMBAT_REQUIREMENT = 85;

  const FALLEN_MAN_NPC_ID = NpcIdentifiers.FALLEN_MAN; // 3465
  const FALLEN_MAN_BARE_NPC_ID = NpcIdentifiers.FALLEN_MAN_2; // 3466
  const CYRISUS_SITTING_NPC_ID = NpcIdentifiers.CYRISUS_4; // 3467
  const CYRISUS_RANGER_NPC_ID = NpcIdentifiers.CYRISUS_6; // 3469
  const CYRISUS_MELEE_NPC_ID = NpcIdentifiers.CYRISUS_7; // 3470
  const CYRISUS_CASTER_NPC_ID = NpcIdentifiers.CYRISUS_8; // 3471
  const JACK_NPC_ID = NpcIdentifiers.BIRDS_EYE_JACK; // 3472
  const ONEIROMANCER_NPC_ID = NpcIdentifiers.ONEIROMANCER; // 3835
  const INADEQUACY_NPC_ID = NpcIdentifiers.THE_INADEQUACY; // 3473
  const EVERLASTING_NPC_ID = NpcIdentifiers.THE_EVERLASTING; // 3474
  const UNTOUCHABLE_NPC_ID = NpcIdentifiers.THE_UNTOUCHABLE; // 3475
  const ILLUSIVE_NPC_ID = NpcIdentifiers.THE_ILLUSIVE; // 3476

  const CAVE_NPC_IDS = new Set([
    FALLEN_MAN_NPC_ID,
    FALLEN_MAN_BARE_NPC_ID,
    CYRISUS_SITTING_NPC_ID,
  ]);
  const OUTSIDE_CYRISUS_IDS = new Set([
    CYRISUS_RANGER_NPC_ID,
    CYRISUS_MELEE_NPC_ID,
    CYRISUS_CASTER_NPC_ID,
  ]);
  const BOSS_ORDER = [INADEQUACY_NPC_ID, EVERLASTING_NPC_ID, UNTOUCHABLE_NPC_ID, ILLUSIVE_NPC_ID];

  const CHEST_ITEM_ID = ItemIdentifiers.CYRISUSS_CHEST; // 11158
  const VIAL_EMPTY_ITEM_ID = ItemIdentifiers.DREAM_VIAL_EMPTY_; // 11151
  const VIAL_WATER_ITEM_ID = ItemIdentifiers.DREAM_VIAL_WATER_; // 11152
  const VIAL_HERB_ITEM_ID = ItemIdentifiers.DREAM_VIAL_HERB_; // 11153
  const DREAM_POTION_ITEM_ID = ItemIdentifiers.DREAM_POTION; // 11154
  const GROUND_ASTRAL_ITEM_ID = ItemIdentifiers.GROUND_ASTRAL_RUNE; // 11155
  const ASTRAL_SHARDS_ITEM_ID = ItemIdentifiers.ASTRAL_RUNE_SHARDS; // 11156
  const DREAMY_LAMP_ITEM_ID = ItemIdentifiers.DREAMY_LAMP; // 11157
  const GOUTWEED_ITEM_ID = ItemIdentifiers.GOUTWEED; // 3261
  const ASTRAL_RUNE_ITEM_ID = ItemIdentifiers.ASTRAL_RUNE; // 9075
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const PESTLE_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const VIAL_ITEM_IDS = new Set([VIAL_EMPTY_ITEM_ID, VIAL_WATER_ITEM_ID, VIAL_HERB_ITEM_ID]);

  const OUR_LIVES_OBJECT_ID = ObjectIdentifiers.OUR_LIVES; // 11398
  const BRAZIER_UNLIT_OBJECT_ID = ObjectIdentifiers.CEREMONIAL_BRAZIER_3; // 16810
  const BRAZIER_LIT_OBJECT_ID = ObjectIdentifiers.CEREMONIAL_BRAZIER_4; // 16811
  const SINK_OBJECT_IDS = new Set([
    ObjectIdentifiers.SINK_18, // 16704
    ObjectIdentifiers.SINK_19, // 16705
  ]);

  const ARMOUR_SETS = {
    melee: {
      head: ItemIdentifiers.DRAGON_MED_HELM,
      body: ItemIdentifiers.AHRIMS_ROBETOP,
      legs: ItemIdentifiers.AHRIMS_ROBESKIRT,
      feet: ItemIdentifiers.RANGER_BOOTS,
      weapon: ItemIdentifiers.ABYSSAL_WHIP,
    },
    ranged: {
      head: ItemIdentifiers.SPLITBARK_HELM,
      body: ItemIdentifiers.KARILS_LEATHERTOP,
      legs: ItemIdentifiers.TORAGS_PLATELEGS,
      feet: ItemIdentifiers.ADAMANT_BOOTS,
      weapon: ItemIdentifiers.MAGIC_SHORTBOW,
    },
    mage: {
      head: ItemIdentifiers.ROBIN_HOOD_HAT,
      body: ItemIdentifiers.DRAGON_CHAINBODY,
      legs: ItemIdentifiers.BLACK_DHIDE_CHAPS,
      feet: ItemIdentifiers.INFINITY_BOOTS,
      weapon: ItemIdentifiers.ANCIENT_STAFF,
    },
  };
  const ARMOUR_SLOT_BY_ITEM = new Map();
  for (const set of Object.values(ARMOUR_SETS)) {
    for (const [slot, itemId] of Object.entries(set)) ARMOUR_SLOT_BY_ITEM.set(itemId, slot);
  }

  // 3634 values by combat style (cache: 1->3470 melee, 2->3471 caster,
  // 3->3469 ranger; 4-6 at the brazier).
  const CYRIS_OUTSIDE_VALUE = { melee: 1, mage: 2, ranged: 3 };
  const CYRIS_BRAZIER_VALUE = { melee: 4, mage: 5, ranged: 6 };
  const CYRIS_CONTENT_BY_STYLE = {
    melee: CYRISUS_MELEE_NPC_ID,
    mage: CYRISUS_CASTER_NPC_ID,
    ranged: CYRISUS_RANGER_NPC_ID,
  };

  const DREAM_ENTRY = new Location(1824, 5156, 2);
  const DREAM_EXIT = new Location(2074, 3913, 0);
  const STATIC_INADEQUACY_TILE = { x: 1823, y: 5149, z: 2 };
  const BOSS_TILES = [
    { x: 1824, y: 5144, z: 2 },
    { x: 1824, y: 5146, z: 2 },
    { x: 1824, y: 5150, z: 2 },
    { x: 1824, y: 5152, z: 2 },
  ];
  const ONEIROMANCER_TILE = { x: 2149, y: 3867 };
  const BRAZIER_TILE = { x: 2074, y: 3911 };
  const JACK_BANK_TILE = { x: 2099, y: 3919 };

  const RANDOM_CONVO_ACTIONS = new Set(["u0G8_8", "FGAqZp", "m-cazF", "o18slu"]);

  const HEALTH_ATTRIBUTE = "quest.dream_mentor.health";
  const SPIRIT_ATTRIBUTE = "quest.dream_mentor.spirit";
  const ARMAMENT_ATTRIBUTE = "quest.dream_mentor.armament";
  const LAST_FOOD_ATTRIBUTE = "quest.dream_mentor.last-food";
  const WOKEN_ATTRIBUTE = "quest.dream_mentor.woken";
  const NAME_KNOWN_ATTRIBUTE = "quest.dream_mentor.name-known";
  const CHECKPOINT_1_ATTRIBUTE = "quest.dream_mentor.spirit-checkpoint-1";
  const CHECKPOINT_2_ATTRIBUTE = "quest.dream_mentor.spirit-checkpoint-2";
  const CHEST_TAKEN_ATTRIBUTE = "quest.dream_mentor.chest-taken";
  const CHEST_ITEMS_ATTRIBUTE = "quest.dream_mentor.chest-items";
  const ARMOUR_STYLE_ATTRIBUTE = "quest.dream_mentor.armour-style";
  const CHECKPOINT_ATTRIBUTE = "quest.dream_mentor.gear-checkpoint";
  const FEAR_TOLD_ATTRIBUTE = "quest.dream_mentor.fear-told";
  const BANKER_INTRO_ATTRIBUTE = "quest.dream_mentor.banker-intro";
  const BRAZIER_ATTRIBUTE = "quest.dream_mentor.brazier-lit";
  const INTRO_PENDING_ATTRIBUTE = "quest.dream_mentor.intro-pending";
  const BOSS_INDEX_ATTRIBUTE = "quest.dream_mentor.boss-index";
  const CONVO_ATTRIBUTE = "quest.dream_mentor.convo-active";

  const bosses = new WeakMap();
  let staticInadequacyRemoved = false;
  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) === value) return;
    quest.setStage(player, value);
  }

  function numberAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value : 0;
  }

  function healthOf(player) {
    return Math.max(0, Math.min(100, numberAttribute(player, HEALTH_ATTRIBUTE)));
  }

  function spiritOf(player) {
    return Math.max(0, Math.min(100, numberAttribute(player, SPIRIT_ATTRIBUTE)));
  }

  function armamentOf(player) {
    return Math.max(0, Math.min(100, numberAttribute(player, ARMAMENT_ATTRIBUTE)));
  }

  function setHealth(player, value) {
    player.setAttribute(HEALTH_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_HEALTH, value | 0);
  }

  function setSpirit(player, value) {
    player.setAttribute(SPIRIT_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_SPIRIT, value | 0);
  }

  function addSpirit(player, amount) {
    setSpirit(player, Math.min(100, spiritOf(player) + amount));
  }

  function nameKnown(player) {
    return player.getAttribute(NAME_KNOWN_ATTRIBUTE) === true || stageOf(player) >= STAGE_NAMED;
  }

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function hasAnyVial(player) {
    for (const itemId of VIAL_ITEM_IDS) if (held(player, itemId)) return true;
    return false;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    return (
      questComplete(player, "lunar_diplomacy") &&
      questComplete(player, "eadgars_ruse") &&
      player.getSkillManager().getCombatLevel() >= COMBAT_REQUIREMENT
    );
  }

  function isEdible(itemId) {
    const actions = CacheDefinitions.getItem(itemId)?.inventoryActions ?? [];
    return actions.some((action) => typeof action === "string" && /^(eat|drink)$/i.test(action));
  }

  function resolvedObjectId(event) {
    if (typeof event.definition?.getId === "function") return event.definition.getId();
    const resolved = ObjectDefinition.forPlayer(event.objectId, event.player);
    return resolved?.getId?.() ?? event.objectId;
  }

  function nearTile(location, tile, radius = 4) {
    if (!location?.getX) return false;
    return (
      Math.abs(location.getX() - tile.x) <= radius && Math.abs(location.getY() - tile.y) <= radius
    );
  }

  function armourStyle(player) {
    let style = player.getAttribute(ARMOUR_STYLE_ATTRIBUTE);
    if (style === "melee" || style === "ranged" || style === "mage") return style;
    const skills = player.getSkillManager();
    const melee = Math.max(skills.getMaxLevel(Skill.ATTACK), skills.getMaxLevel(Skill.STRENGTH));
    const ranged = skills.getMaxLevel(Skill.RANGED);
    const magic = skills.getMaxLevel(Skill.MAGIC);
    if (magic > melee && magic >= ranged) style = "mage";
    else if (ranged > melee && ranged > magic) style = "ranged";
    else style = "melee";
    player.setAttribute(ARMOUR_STYLE_ATTRIBUTE, style);
    return style;
  }

  function cyrisusNpcId(player) {
    return CYRIS_CONTENT_BY_STYLE[armourStyle(player)] ?? CYRISUS_MELEE_NPC_ID;
  }

  function chestItems(player) {
    const raw = player.getAttribute(CHEST_ITEMS_ATTRIBUTE);
    return raw && typeof raw === "object" ? raw : {};
  }

  function setChestItems(player, items) {
    player.setAttribute(CHEST_ITEMS_ATTRIBUTE, items);
  }

  function gearCorrect(player) {
    const wanted = ARMOUR_SETS[armourStyle(player)];
    const stored = chestItems(player);
    return Object.keys(wanted).every((slot) => stored[slot] === wanted[slot]);
  }

  function isBrazierLit(player) {
    if (player.getAttribute(BRAZIER_ATTRIBUTE) === true) return true;
    // Death clears the attribute but leaves varbit 2430 set, so recover the
    // attribute from the varbit here (mirrors LunarDiplomacy's isBrazierLit)
    // or the brazier reads "already lit" while the dialogue treats it as unlit.
    if (player.getPacketSender().getVarbit(VARBIT_BRAZIER_LIT) > 0) {
      player.setAttribute(BRAZIER_ATTRIBUTE, true);
      return true;
    }
    return false;
  }

  function variantSteps(variant) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const stage = stageOf(player);
    sender.sendVarbit(VARBIT_HEALTH, healthOf(player));
    sender.sendVarbit(VARBIT_SPIRIT, spiritOf(player));
    sender.sendVarbit(VARBIT_ARMAMENT, armamentOf(player));
    sender.sendVarbit(VARBIT_BANKER_INTRO, player.getAttribute(BANKER_INTRO_ATTRIBUTE) === true ? 1 : 0);
    const style = player.getAttribute(ARMOUR_STYLE_ATTRIBUTE);
    let cyris = 0;
    if (style && stage >= STAGE_FEAR && stage < STAGE_COMPLETE) {
      cyris =
        stage >= STAGE_POTION && stage < STAGE_DEFEATED
          ? CYRIS_BRAZIER_VALUE[style]
          : CYRIS_OUTSIDE_VALUE[style];
    }
    sender.sendVarbit(VARBIT_CYRIS_MULTI, cyris || 0);
    if (stage >= STAGE_STARTED) {
      sender.sendVarbit(VARBIT_BRAZIER_LIT, isBrazierLit(player) ? 1 : 0);
    }
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found a fallen man in the caves north of the Lunar Isle mine</str>",
        "<str>and helped him recover. His name was Cyrisus.</str>",
        "<str>He was afraid of combat, so the Oneiromancer and I helped him</str>",
        "<str>enter a shared dream, where he conquered his fears.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DEFEATED) {
      return [
        "<str>I helped Cyrisus recover in the Lunar Isle mine and face his</str>",
        "<str>fear of combat in a shared dream.</str></str>",
        "",
        "I should speak to the <col=800000>Oneiromancer</col> about what we achieved.",
      ];
    }
    if (stage >= STAGE_DREAM) {
      return [
        "<str>I helped Cyrisus recover in the Lunar Isle mine and make the</str>",
        "<str>Potion of Shared Dreaming.</str></str>",
        "",
        "I must defeat the monsters of <col=800000>Cyrisus's</col> fears in the dream:",
        "the <col=800000>Inadequacy</col>, the <col=800000>Everlasting</col>, the <col=800000>Untouchable</col>",
        "and the <col=800000>Illusive</col>.",
      ];
    }
    if (stage >= STAGE_POTION) {
      return [
        "<str>I helped Cyrisus recover in the Lunar Isle mine and the</str>",
        "<str>Oneiromancer agreed to help him face his fear of combat.</str></str>",
        "",
        "I should light the <col=800000>ceremonial brazier</col> in the <col=800000>Dream Hall</col> with a",
        "tinderbox and speak to <col=800000>Cyrisus</col> beside it to enter the dream.",
      ];
    }
    if (stage >= STAGE_VIAL) {
      return [
        "<str>I helped Cyrisus recover in the Lunar Isle mine and the</str>",
        "<str>Oneiromancer agreed to help him face his fear of combat.</str></str>",
        "",
        "I need to make the <col=800000>Potion of Shared Dreaming</col>: water, goutweed",
        "and a ground astral rune in the <col=800000>dream vial</col>.",
      ];
    }
    if (stage >= STAGE_FEAR) {
      return [
        "<str>I helped Cyrisus recover and gave him a set of armour from</str>",
        "<str>his bank chest.</str></str>",
        "",
        "Cyrisus told me he is afraid of combat. I should meet him at the",
        "<col=800000>Oneiromancer</col> south-east of the Lunar Isle bank.",
      ];
    }
    if (stage >= STAGE_DRESSED) {
      return [
        "<str>I found a fallen man in the caves north of the Lunar Isle mine</str>",
        "<str>and helped him recover. His name was Cyrisus.</str></str>",
        "",
        "Cyrisus likes the armour I brought. I should speak to him again",
        "about his fear of combat.",
      ];
    }
    if (stage >= STAGE_ARMOUR) {
      return [
        "<str>I found a fallen man in the caves north of the Lunar Isle mine</str>",
        "<str>and helped him recover. His name was Cyrisus.</str></str>",
        "",
        "Cyrisus needs armour before he can leave. I should talk to",
        "<col=800000>'Bird's-Eye' Jack</col> at the <col=800000>Lunar Isle bank</col> about his chest.",
      ];
    }
    if (stage >= STAGE_NAMED) {
      return [
        "<str>I found a fallen man in the caves north of the Lunar Isle mine</str>",
        "<str>and helped him recover. His name is Cyrisus.</str></str>",
        "",
        "I still need to improve his <col=800000>health</col> and <col=800000>spirit</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I found a fallen man in the caves north of the Lunar Isle mine</str>",
        "<str>and agreed to help him.</str></str>",
        "",
        "He needs food to improve his <col=800000>health</col> and conversation to lift",
        "his <col=800000>spirit</col>.",
      ];
    }
    return [
      "I can start this quest by talking to the <col=800000>fallen man</col> in the",
      "caves north of the <col=800000>Lunar Isle mine</col>.",
      "",
      "I must have completed <col=800000>Lunar Diplomacy</col> and <col=800000>Eadgar's Ruse</col>",
      "and have a combat level of 85.",
    ];
  }

  // ==========================================================================
  // Recovery: feeding and conversation
  // ==========================================================================

  function randomSpiritMenu() {
    const steps = variantSteps("spirit-possible-conversations");
    const menus = steps.filter(
      (step) => step?.type === "choice" && Array.isArray(step.options) && step.options.length
    );
    return menus.length ? [menus[Math.floor(Math.random() * menus.length)]] : [];
  }

  function startSpiritConversation(player) {
    const menu = randomSpiritMenu();
    if (!menu.length) return;
    player.setAttribute(CONVO_ATTRIBUTE, true);
    startTranscript(api, player, FALLEN_MAN_NPC_ID, PAGE, "spirit-possible-conversations", () => menu);
  }

  function recoveryChat(player, npcId) {
    const health = healthOf(player);
    const spirit = spiritOf(player);
    if (!nameKnown(player)) {
      if (health >= HEALTH_THRESHOLD && spirit >= SPIRIT_THRESHOLD) {
        player.setAttribute(NAME_KNOWN_ATTRIBUTE, true);
        setStage(player, STAGE_NAMED);
        startTranscript(api, player, npcId, PAGE, "spirit-reaching-food-and-spirit-threshold");
        return;
      }
    } else {
      if (spirit >= 100 && player.getAttribute(CHECKPOINT_2_ATTRIBUTE) !== true) {
        player.setAttribute(CHECKPOINT_2_ATTRIBUTE, true);
        startTranscript(api, player, npcId, PAGE, "spirit-checkpoint-reached-2");
        return;
      }
      if (health >= 100 && spirit >= 100) {
        setStage(player, STAGE_ARMOUR);
        startTranscript(api, player, npcId, PAGE, "spirit-reaching-both-thresholds-again");
        return;
      }
    }
    if (spirit >= 100 && player.getAttribute(CHECKPOINT_2_ATTRIBUTE) !== true) {
      player.setAttribute(CHECKPOINT_2_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "spirit-checkpoint-reached-2");
      return;
    }
    if (spirit >= 50 && player.getAttribute(CHECKPOINT_1_ATTRIBUTE) !== true) {
      player.setAttribute(CHECKPOINT_1_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "spirit-checkpoint-reached");
      return;
    }
    startSpiritConversation(player);
  }

  function feedFallenMan(player, npcId, itemId) {
    if (!isEdible(itemId)) {
      startTranscript(api, player, npcId, PAGE, "recovery-using-inedible-items-on-him");
      return;
    }
    if (healthOf(player) >= 100) {
      startTranscript(api, player, npcId, PAGE, "spirit-using-food-on-him-after-reaching-food-threshold");
      return;
    }
    if (player.getAttribute(LAST_FOOD_ATTRIBUTE) === itemId) {
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        nameKnown(player)
          ? "spirit-feeding-him-something-he-recently-ate-after-learning-his-name"
          : "recovery-feeding-him-something-he-recently-ate"
      );
      return;
    }
    if (!held(player, itemId)) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.setAttribute(LAST_FOOD_ATTRIBUTE, itemId);
    const health = Math.min(100, healthOf(player) + HEALTH_PER_FOOD);
    setHealth(player, health);
    if (player.getAttribute(WOKEN_ATTRIBUTE) !== true && health >= WAKE_HEALTH) {
      player.setAttribute(WOKEN_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "recovery-waking-up");
      return;
    }
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      nameKnown(player)
        ? "spirit-using-edible-items-on-him-after-learning-his-name"
        : "recovery-using-edible-items-on-him"
    );
  }

  // ==========================================================================
  // Talk-to: the cave NPCs
  // ==========================================================================

  function talkCaveNpc(event) {
    const { player, npcId } = event;
    if (!CAVE_NPC_IDS.has(npcId)) return false;
    if (quest.isComplete(player)) {
      startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-cyrisus-again-2");
      return;
    }
    const stage = stageOf(player);
    if (stage === 0) {
      startTranscript(api, player, npcId, PAGE, "starting-off");
      return;
    }
    if (stage >= STAGE_FEAR) {
      startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-cyrisus-again-2");
      return;
    }
    if (stage >= STAGE_ARMOUR) {
      talkCaveNpcAtArmour(player, npcId);
      return;
    }
    if (player.getAttribute(WOKEN_ATTRIBUTE) !== true) {
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-the-fallen-man");
      return;
    }
    recoveryChat(player, npcId);
  }

  function talkCaveNpcAtArmour(player, npcId) {
    const stage = stageOf(player);
    if (stage === STAGE_ARMOUR) {
      if (!held(player, CHEST_ITEM_ID)) {
        startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-cyrisus-again");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "gearing-up-bringing-him-gear-in-person");
      return;
    }
    if (!player.getAttribute(CHECKPOINT_ATTRIBUTE)) {
      player.setAttribute(CHECKPOINT_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "gearing-up-checkpoint-reached");
      return;
    }
    if (!player.getAttribute(FEAR_TOLD_ATTRIBUTE)) {
      startTranscript(api, player, npcId, PAGE, "gearing-up-fully-restored");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-cyrisus-again-2");
  }

  // ==========================================================================
  // Talk-to: Cyrisus outside the cave
  // ==========================================================================

  function talkCyrisus(event) {
    const { player, npcId } = event;
    if (!OUTSIDE_CYRISUS_IDS.has(npcId)) return false;
    const location = event.npc?.getLocation?.() ?? player.getLocation();
    const stage = stageOf(player);
    if (nearTile(location, BRAZIER_TILE)) {
      if (stage === STAGE_POTION) {
        startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-cyrisus-next-to-the-brazier");
        return;
      }
      if (stage === STAGE_DREAM) {
        startTranscript(
          api,
          player,
          npcId,
          PAGE,
          isBrazierLit(player)
            ? "cyrisus-courage-re-entering-the-dream-after-leaving"
            : "cyrisus-courage-trying-to-re-enter-with-the-brazier-unlit"
        );
        return;
      }
      startTranscript(api, player, npcId, PAGE, "finishing-up-talking-to-cyrisus-after-conquering-his-fears");
      return;
    }
    if (stage === STAGE_FEAR || stage === STAGE_VIAL) {
      startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-cyrisus-next-to-the-oneiromancer-first");
      return;
    }
    if (stage >= STAGE_DEFEATED) {
      startTranscript(api, player, npcId, PAGE, "finishing-up-talking-to-cyrisus-after-conquering-his-fears");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-cyrisus-next-to-the-oneiromancer-first");
  }

  // ==========================================================================
  // Talk-to: 'Bird's-Eye' Jack
  // ==========================================================================

  function talkJack(event) {
    const { player, npcId } = event;
    if (npcId !== JACK_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage < STAGE_ARMOUR || stage >= STAGE_COMPLETE) return false;
    if (player.getAttribute(CHEST_TAKEN_ATTRIBUTE) !== true) {
      startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-birds-eye-jack");
      return;
    }
    if (!held(player, CHEST_ITEM_ID)) {
      startTranscript(api, player, npcId, PAGE, "gearing-up-getting-a-new-chest-after-losing-it");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "gearing-up-talking-to-birds-eye-jack-2");
  }

  /**
   * The world's Jack (placeholder 6126) transforms to 3472 on the bank-counter
   * tile 2099,3921, which is not reachable, so the gear steps spawn an
   * owner-only 3472 on the walkable bank floor instead.
   */
  function ownedJack(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() === JACK_NPC_ID && npc.getOwner?.() === player) return npc;
    }
    return null;
  }

  function ensureJack(player) {
    if (quest.isComplete(player) || stageOf(player) < STAGE_ARMOUR) {
      removeOwnedJack(player);
      return;
    }
    const existing = ownedJack(player);
    if (existing) {
      const location = existing.getLocation?.();
      if (location?.getX?.() === JACK_BANK_TILE.x && location?.getY?.() === JACK_BANK_TILE.y) return;
      api.removeNpc(existing);
    }
    api.spawnNpc({
      id: JACK_NPC_ID,
      x: JACK_BANK_TILE.x,
      y: JACK_BANK_TILE.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function removeOwnedJack(player) {
    const npc = ownedJack(player);
    if (npc) api.removeNpc(npc);
  }

  // ==========================================================================
  // Talk-to: the Oneiromancer
  // ==========================================================================

  function talkOneiromancer(event) {
    const { player, npcId } = event;
    if (npcId !== ONEIROMANCER_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage < STAGE_FEAR || stage >= STAGE_COMPLETE) return false;
    if (stage === STAGE_FEAR) {
      startTranscript(api, player, npcId, PAGE, "dream-mentoring");
      return;
    }
    if (stage === STAGE_VIAL) {
      if (held(player, DREAM_POTION_ITEM_ID)) {
        startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-the-oneiromancer-after-making-the-potion");
        return;
      }
      if (hasAnyVial(player)) {
        startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-the-oneiromancer-again");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "dream-mentoring-getting-a-new-dream-vial-if-lost");
      return;
    }
    if (stage === STAGE_POTION) {
      startTranscript(api, player, npcId, PAGE, "dream-mentoring-talking-to-the-oneiromancer-after-making-the-potion");
      return;
    }
    if (stage === STAGE_DREAM) {
      startTranscript(api, player, npcId, PAGE, "cyrisus-courage-talking-to-the-oneiromancer-after-entering-the-dream");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "finishing-up-talking-to-the-oneiromancer");
  }

  // ==========================================================================
  // The dream
  // ==========================================================================

  function removeStaticInadequacy() {
    if (staticInadequacyRemoved) return;
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      if (npc && npc.getId?.() === INADEQUACY_NPC_ID && !npc.getOwner?.()) {
        api.removeNpc(npc);
        staticInadequacyRemoved = true;
      }
    }
  }

  function restoreStaticInadequacy() {
    if (!staticInadequacyRemoved) return;
    staticInadequacyRemoved = false;
    api.spawnNpc({
      id: INADEQUACY_NPC_ID,
      x: STATIC_INADEQUACY_TILE.x,
      y: STATIC_INADEQUACY_TILE.y,
      z: STATIC_INADEQUACY_TILE.z,
      wanderRadius: 0,
    });
  }

  function despawnBosses(player) {
    const npc = bosses.get(player);
    if (npc) {
      api.removeNpc(npc);
      bosses.delete(player);
    }
  }

  /**
   * Removes this player's arena bosses, tracked or not. A boss left over from
   * an earlier visit (or from before a relog, when its owner object is no
   * longer registered) would otherwise pile up on re-entry and answer
   * "This npc was not spawned for you".
   */
  function reconcileBosses(player) {
    const world = api.getWorld();
    if (world?.getNpcs) {
      for (const npc of world.getNpcs()) {
        if (!npc || !BOSS_ORDER.includes(npc.getId?.())) continue;
        const owner = npc.getOwner?.();
        if (owner === player || (owner && owner.isRegistered?.() === false)) api.removeNpc(npc);
      }
    }
    bosses.delete(player);
  }

  function spawnBoss(player, index) {
    const tile = BOSS_TILES[index] ?? BOSS_TILES[0];
    const npc = api.spawnNpc({
      id: BOSS_ORDER[index],
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) bosses.set(player, npc);
    player.setAttribute(BOSS_INDEX_ATTRIBUTE, index);
  }

  function enterDream(player) {
    const stage = stageOf(player);
    if (stage !== STAGE_POTION && stage !== STAGE_DREAM) return;
    reconcileBosses(player);
    removeStaticInadequacy();
    if (held(player, DREAM_POTION_ITEM_ID)) player.getInventory().deleteNumber(DREAM_POTION_ITEM_ID, 1);
    player.moveTo(DREAM_ENTRY);
    if (stage < STAGE_DREAM) {
      setStage(player, STAGE_DREAM);
      player.setAttribute(INTRO_PENDING_ATTRIBUTE, true);
    }
    player.setAttribute(BOSS_INDEX_ATTRIBUTE, 0);
    spawnBoss(player, 0);
  }

  function leaveDream(player) {
    despawnBosses(player);
    player.setAttribute(BOSS_INDEX_ATTRIBUTE, 0);
    restoreStaticInadequacy();
    player.moveTo(DREAM_EXIT);
  }

  function respawnDreamBossOnLogin(player) {
    if (stageOf(player) !== STAGE_DREAM) {
      restoreStaticInadequacy();
      return;
    }
    const location = player.getLocation();
    if (location.getZ() !== 2 || location.getY() < 5000) {
      restoreStaticInadequacy();
      return;
    }
    reconcileBosses(player);
    const index = Math.max(0, Math.min(BOSS_ORDER.length - 1, numberAttribute(player, BOSS_INDEX_ATTRIBUTE)));
    spawnBoss(player, index);
  }

  // ==========================================================================
  // NPC dialogue conditions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "akU__u":
      case "huoan9":
      case "TKFai5":
        return player.getInventory().isFull();
      case "ZqbSxp":
        return false;
      case "n48ugZ":
        return stageOf(player) === STAGE_ARMOUR && !gearCorrect(player);
      case "yaQkbS":
        return stageOf(player) === STAGE_ARMOUR && gearCorrect(player);
      case "S9LK2E":
        return held(player, DREAM_POTION_ITEM_ID);
      case "XoukMz":
        return !held(player, DREAM_POTION_ITEM_ID) && !hasAnyVial(player);
      case "YveB34":
        return !held(player, DREAM_POTION_ITEM_ID) && hasAnyVial(player);
      default:
        return null;
    }
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    if (stepId === "yaQkbS" && stageOf(player) === STAGE_ARMOUR) {
      player.setAttribute(ARMAMENT_ATTRIBUTE, 100);
      setChestItems(player, {});
      setStage(player, STAGE_DRESSED);
    }
  }

  // ==========================================================================
  // Transcript hooks / choices / actions / lines
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || npcId !== FALLEN_MAN_NPC_ID) return;
    if (stageOf(player) !== 0) return;
    if (!meetsRequirements(player)) {
      player.sendMessage(
        "You must have completed Lunar Diplomacy and Eadgar's Ruse and have a combat level of 85 or higher to help this man."
      );
      return;
    }
    setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (player.getAttribute(CONVO_ATTRIBUTE) === true) {
      player.setAttribute(CONVO_ATTRIBUTE, false);
      addSpirit(player, SPIRIT_PER_TALK);
    }
    if (option === "Yes, let's go!") {
      enterDream(player);
      return;
    }
    if (option === "Leave" && stageOf(player) === STAGE_DREAM) {
      leaveDream(player);
      return;
    }
    if (option === "Cyrisus." && npcId === ONEIROMANCER_NPC_ID && stageOf(player) === STAGE_FEAR) {
      player.setAttribute(ARMOUR_STYLE_ATTRIBUTE, armourStyle(player));
      setStage(player, STAGE_VIAL);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === "VXda0S") {
      event.handled = true;
      if (player.getAttribute(INTRO_PENDING_ATTRIBUTE) === true) {
        player.setAttribute(INTRO_PENDING_ATTRIBUTE, false);
        event.steps = variantSteps("cyrisus-courage");
      }
      return;
    }
    if (stepId === "ySo6Z3") {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (RANDOM_CONVO_ACTIONS.has(stepId)) {
      event.handled = true;
      const menu = randomSpiritMenu();
      if (menu.length) {
        player.setAttribute(CONVO_ATTRIBUTE, true);
        event.steps = menu;
      }
      return;
    }
    if (stepId === "g_2AMh") {
      event.handled = true;
      if (stageOf(player) < STAGE_ARMOUR) {
        const menu = randomSpiritMenu();
        if (menu.length) {
          player.setAttribute(CONVO_ATTRIBUTE, true);
          event.steps = menu;
        }
      }
    }
  }

  function handleLine(event) {
    const { player, npcId } = event;
    const text = String(event.text ?? "");
    if (npcId === JACK_NPC_ID) {
      if (text.startsWith("I suppose you had better take this chest")) giveChest(player);
      else if (text.startsWith("Well, I don't suppose it would be a problem to give you another")) giveChest(player);
      return;
    }
    if (npcId === ONEIROMANCER_NPC_ID && text.startsWith("Simple. I shall give you a vial")) {
      giveDreamVial(player);
      return;
    }
    if (npcId === ONEIROMANCER_NPC_ID && text.startsWith("Now that wasn't difficult, was it?")) {
      giveDreamVial(player);
      return;
    }
    if (CAVE_NPC_IDS.has(npcId) && text.startsWith("Excellent! Please, you go on ahead")) {
      player.setAttribute(FEAR_TOLD_ATTRIBUTE, true);
      setStage(player, STAGE_FEAR);
      return;
    }
    if (OUTSIDE_CYRISUS_IDS.has(npcId) && text.startsWith("See you there!")) {
      player.moveTo(DREAM_EXIT);
      player.setAttribute(BOSS_INDEX_ATTRIBUTE, BOSS_ORDER.length);
      restoreStaticInadequacy();
    }
  }

  function giveChest(player) {
    if (held(player, CHEST_ITEM_ID)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You do not have enough space for the chest.");
      return;
    }
    player.getInventory().adds(CHEST_ITEM_ID, 1);
    player.setAttribute(CHEST_TAKEN_ATTRIBUTE, true);
    player.setAttribute(BANKER_INTRO_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_BANKER_INTRO, 1);
  }

  function giveDreamVial(player) {
    if (held(player, DREAM_POTION_ITEM_ID) || hasAnyVial(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You do not have enough space for the vial.");
      return;
    }
    player.getInventory().adds(VIAL_EMPTY_ITEM_ID, 1);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!CAVE_NPC_IDS.has(npcId)) return;
    const stage = stageOf(player);
    if (stage < STAGE_STARTED || stage >= STAGE_ARMOUR) return;
    event.handled = true;
    feedFallenMan(player, npcId, itemId);
  }

  function storeChestArmour(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(CHEST_ITEM_ID)) return false;
    const itemId = usedItemId === CHEST_ITEM_ID ? usedWithItemId : usedItemId;
    event.handled = true;
    const slot = ARMOUR_SLOT_BY_ITEM.get(itemId);
    if (!slot) {
      player.sendMessage("Cyrisus isn't going to want to wear that!");
      return true;
    }
    const stored = { ...chestItems(player) };
    stored[slot] = itemId;
    setChestItems(player, stored);
    player.getInventory().deleteNumber(itemId, 1);
    player.sendMessage(`You put the ${ItemDefinition.forId(itemId)?.getName?.() ?? "item"} in the chest.`);
    return true;
  }

  function brewVial(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(GOUTWEED_ITEM_ID) && pair.has(VIAL_WATER_ITEM_ID)) {
      event.handled = true;
      if (!held(player, GOUTWEED_ITEM_ID) || !held(player, VIAL_WATER_ITEM_ID)) return true;
      player.getInventory().deleteNumber(GOUTWEED_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_WATER_ITEM_ID, 1);
      player.getInventory().adds(VIAL_HERB_ITEM_ID, 1);
      player.sendMessage("You add the goutweed to the dream vial.");
      return true;
    }
    if (pair.has(GROUND_ASTRAL_ITEM_ID) && pair.has(VIAL_HERB_ITEM_ID)) {
      event.handled = true;
      if (!held(player, GROUND_ASTRAL_ITEM_ID) || !held(player, VIAL_HERB_ITEM_ID)) return true;
      player.getInventory().deleteNumber(GROUND_ASTRAL_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_HERB_ITEM_ID, 1);
      player.getInventory().adds(DREAM_POTION_ITEM_ID, 1);
      player.sendMessage("You add the ground astral rune to the dream vial. The potion is ready.");
      if (stageOf(player) === STAGE_VIAL) setStage(player, STAGE_POTION);
      return true;
    }
    if (pair.has(HAMMER_ITEM_ID) && pair.has(ASTRAL_RUNE_ITEM_ID)) {
      event.handled = true;
      if (!held(player, ASTRAL_RUNE_ITEM_ID)) return true;
      player.getInventory().deleteNumber(ASTRAL_RUNE_ITEM_ID, 1);
      player.getInventory().adds(ASTRAL_SHARDS_ITEM_ID, 1);
      player.sendMessage("You hammer the astral rune into shards.");
      return true;
    }
    if (pair.has(PESTLE_ITEM_ID) && pair.has(ASTRAL_SHARDS_ITEM_ID)) {
      event.handled = true;
      if (!held(player, ASTRAL_SHARDS_ITEM_ID)) return true;
      player.getInventory().deleteNumber(ASTRAL_SHARDS_ITEM_ID, 1);
      player.getInventory().adds(GROUND_ASTRAL_ITEM_ID, 1);
      player.sendMessage("You grind the astral rune shards into dust.");
      return true;
    }
    return false;
  }

  function handleItemOnItem(event) {
    if (storeChestArmour(event)) return;
    brewVial(event);
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (itemId === VIAL_EMPTY_ITEM_ID && SINK_OBJECT_IDS.has(resolvedObjectId(event))) {
      event.handled = true;
      if (!held(player, VIAL_EMPTY_ITEM_ID)) return;
      player.getInventory().deleteNumber(VIAL_EMPTY_ITEM_ID, 1);
      player.getInventory().adds(VIAL_WATER_ITEM_ID, 1);
      player.sendMessage("You fill the dream vial with water.");
      return;
    }
    if (itemId !== TINDERBOX_ITEM_ID || stageOf(player) < STAGE_VIAL) return;
    const objectId = resolvedObjectId(event);
    if (objectId === BRAZIER_LIT_OBJECT_ID) {
      event.handled = true;
      player.sendMessage("The brazier is already lit.");
      return;
    }
    if (objectId !== BRAZIER_UNLIT_OBJECT_ID) return;
    event.handled = true;
    player.setAttribute(BRAZIER_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_BRAZIER_LIT, 1);
    player.sendMessage("You light the ceremonial brazier.");
  }

  function lookInChest(event) {
    const { player } = event;
    const stored = chestItems(player);
    const names = Object.values(stored)
      .map((itemId) => ItemDefinition.forId(itemId)?.getName?.() ?? "something")
      .filter(Boolean);
    if (names.length === 0) {
      startTranscript(api, player, FALLEN_MAN_NPC_ID, PAGE, "gearing-up-looking-in-the-chest-while-it-s-empty");
      return;
    }
    player.sendMessage(`The chest contains: ${names.join(", ")}.`);
  }

  // ==========================================================================
  // Objects and NPC deaths
  // ==========================================================================

  function leaveLectern(event) {
    const { player } = event;
    if (event.objectId !== OUR_LIVES_OBJECT_ID || stageOf(player) !== STAGE_DREAM) return;
    event.handled = true;
    startTranscript(api, player, cyrisusNpcId(player), PAGE, "cyrisus-courage-leaving-the-dream");
  }

  function handleNpcDeath(event) {
    const index = BOSS_ORDER.indexOf(event.npcId);
    if (index === -1) return;
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    const tracked = bosses.get(player);
    if (tracked && event.npc && tracked !== event.npc) return;
    bosses.delete(player);
    if (stageOf(player) !== STAGE_DREAM) return;
    if (index < BOSS_ORDER.length - 1) {
      spawnBoss(player, index + 1);
      return;
    }
    setStage(player, STAGE_DEFEATED);
    startTranscript(api, player, cyrisusNpcId(player), PAGE, "cyrisus-courage-defeating-the-illusive");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    syncVarbits(player);
    respawnDreamBossOnLogin(player);
    ensureJack(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
    ensureJack(player);
  }

  /** Mirrors the sibling varbits after any stage change, including ::quest and complete(). */
  function handleStageChanged(event) {
    if (event?.key !== "dream_mentor" || !event.player) return;
    if ((event.stage | 0) === 0) {
      resetQuestState(event.player);
      return;
    }
    syncVarbits(event.player);
    ensureJack(event.player);
  }

  /** ::quest reset / a fresh start drops the recovery counters and dream spawns. */
  function resetQuestState(player) {
    for (const key of [
      HEALTH_ATTRIBUTE,
      SPIRIT_ATTRIBUTE,
      ARMAMENT_ATTRIBUTE,
      LAST_FOOD_ATTRIBUTE,
      WOKEN_ATTRIBUTE,
      NAME_KNOWN_ATTRIBUTE,
      CHECKPOINT_1_ATTRIBUTE,
      CHECKPOINT_2_ATTRIBUTE,
      CHEST_TAKEN_ATTRIBUTE,
      CHEST_ITEMS_ATTRIBUTE,
      ARMOUR_STYLE_ATTRIBUTE,
      CHECKPOINT_ATTRIBUTE,
      FEAR_TOLD_ATTRIBUTE,
      BANKER_INTRO_ATTRIBUTE,
      BRAZIER_ATTRIBUTE,
      INTRO_PENDING_ATTRIBUTE,
      BOSS_INDEX_ATTRIBUTE,
      CONVO_ATTRIBUTE,
    ]) {
      player.setAttribute(key, null);
    }
    despawnBosses(player);
    removeOwnedJack(player);
    restoreStaticInadequacy();
    syncVarbits(player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  function persistDreamAttributes() {
    for (const attribute of [
      HEALTH_ATTRIBUTE,
      SPIRIT_ATTRIBUTE,
      ARMAMENT_ATTRIBUTE,
      LAST_FOOD_ATTRIBUTE,
      WOKEN_ATTRIBUTE,
      NAME_KNOWN_ATTRIBUTE,
      CHECKPOINT_1_ATTRIBUTE,
      CHECKPOINT_2_ATTRIBUTE,
      CHEST_TAKEN_ATTRIBUTE,
      CHEST_ITEMS_ATTRIBUTE,
      ARMOUR_STYLE_ATTRIBUTE,
      CHECKPOINT_ATTRIBUTE,
      FEAR_TOLD_ATTRIBUTE,
      BANKER_INTRO_ATTRIBUTE,
      BRAZIER_ATTRIBUTE,
      INTRO_PENDING_ATTRIBUTE,
      BOSS_INDEX_ATTRIBUTE,
      CONVO_ATTRIBUTE,
    ]) {
      api.persistAttribute(attribute);
    }
  }

  persistDreamAttributes();

  // QH 06da90: native 4 is feeding, 24 includes the potion and all dream fights,
  // 26 returns to the Oneiromancer, and cache DB 28 completes. Saved 26/28/30 keep
  // their encounter/reward meanings; no native completion is published before reward.
  function nativeProgress(stage) {
    stage |= 0;
    if (stage >= STAGE_COMPLETE) return 28;
    if (stage >= STAGE_DEFEATED) return 26;
    if (stage >= STAGE_POTION) return 24;
    return stage === STAGE_STARTED ? 4 : stage;
  }

  quest = registerQuest(api, {
    key: "dream_mentor",
    name: "Dream Mentor",
    varpId: 1003,
    varbitId: VARBIT_STAGE,
    varbitValue: nativeProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.HITPOINTS.getIndex(), amount: 15000, label: "Hitpoints" },
      { skillId: Skill.MAGIC.getIndex(), amount: 10000, label: "Magic" },
    ],
    rewardItemId: DREAMY_LAMP_ITEM_ID,
    rewardItemLabel: "Dreamy lamp",
    otherRewards: [
      "Access to the Lunar spells Monster Examine, Humidify, Hunter Kit, Stat Spy, Dream, Plank Make and Spellbook Swap",
      "'Birds-Eye' Jack lets you use the Lunar Isle bank without a Seal of Passage",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Fallen Man", { "Talk-to": talkCaveNpc });
  api.onNpcInteraction("Cyrisus", { "Talk-to": talkCyrisus });
  api.onNpcInteraction("Oneiromancer", { "Talk-to": talkOneiromancer });
  api.onNpcInteraction("'Bird's-Eye' Jack", { "Talk-to": talkJack });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction("Cyrisus's chest", { "Look-in": lookInChest });
  api.onObjectInteraction("Our lives", { Leave: leaveLectern });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 15000);
    player.getSkillManager().addExperiences(Skill.MAGIC, 10000);
  }
};
