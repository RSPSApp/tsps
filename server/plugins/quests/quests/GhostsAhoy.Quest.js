/**
 * Ghosts Ahoy (members).
 *
 * The words come from the "Ghosts Ahoy" transcript page; this plugin supplies
 * the variant selector for Velorina, Necrovarus, Gravingas, Ak-Haranu, Robin,
 * the Old crone, the Old man, the Ghost villager, the Ghost innkeeper and the
 * Ghost captain, the prose-condition answers, the start hook, the bedsheet /
 * ectoplasm disguise, the Book of Haricanto treasure hunt, the toy-ship repair,
 * the Necrovarus tomb, the Ectophial and the completion.
 *
 * Stages are the reference's quest string states (varp 408; real storage is
 * varbit 217, bits 28-31 of varp 408 - the framework mirrors the raw stage,
 * which only uses the unused low bits of that varp):
 *   1 asked Velorina, 2 Necrovarus pleaded, 3 sent to the Old crone,
 *   4 collecting the crone's materials, 5 ritual ready, 6 amulet enchanted,
 *   7 Necrovarus commanded, 8 complete.
 *
 * Subquest progress is persisted on the player: bow (0..8), toy boat (0..3),
 * petition signatures (0..10), toy/mast flag colours, the crone's given-item
 * flags and the tomb/chest one-shots.
 *
 * Source: GregHib/void pinned in issue #196 (2011 rev634); the Ectophial,
 * Port Phasmatys and dialogue branches not reproduced here are noted inline.
 * Gaps: Runedraw is not simulated (the bow is signed by using it on Robin),
 * nettle tea is accepted by the crone without brewing the milky special cup,
 * the giant lobster is spawned but its combat stats come from the cache, the
 * bedsheet has no player transform, and the Dragontooth/rock-jumping fades and
 * port barrier are simplified to teleports and messages.
 */
module.exports = function registerGhostsAhoyQuest(api) {
  const {
    Skill,
    Equipment,
    Item,
    Location,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const VELORINA_NPC_ID = NpcIdentifiers.VELORINA;
  const NECROVARUS_NPC_ID = NpcIdentifiers.NECROVARUS;
  const GRAVINGAS_NPC_ID = NpcIdentifiers.GRAVINGAS;
  const GHOST_DISCIPLE_NPC_ID = NpcIdentifiers.GHOST_DISCIPLE;
  const AK_HARANU_NPC_ID = NpcIdentifiers.AK_HARANU;
  const ROBIN_NPC_ID = NpcIdentifiers.ROBIN;
  const OLD_CRONE_NPC_ID = NpcIdentifiers.OLD_CRONE;
  const OLD_MAN_NPC_ID = NpcIdentifiers.OLD_MAN;
  const GHOST_VILLAGER_NPC_ID = NpcIdentifiers.GHOST_VILLAGER;
  const GHOST_INNKEEPER_NPC_ID = NpcIdentifiers.GHOST_INNKEEPER;
  const GHOST_CAPTAIN_NPC_ID = NpcIdentifiers.GHOST_CAPTAIN;
  const GIANT_LOBSTER_NPC_ID = NpcIdentifiers.GIANT_LOBSTER;

  const GHOSTS_AHOY_NPC_IDS = new Set([
    VELORINA_NPC_ID,
    NECROVARUS_NPC_ID,
    GRAVINGAS_NPC_ID,
    GHOST_DISCIPLE_NPC_ID,
    AK_HARANU_NPC_ID,
    ROBIN_NPC_ID,
    OLD_CRONE_NPC_ID,
    OLD_MAN_NPC_ID,
    GHOST_VILLAGER_NPC_ID,
    GHOST_INNKEEPER_NPC_ID,
    GHOST_CAPTAIN_NPC_ID,
  ]);

  const VARP_GHOSTS_AHOY = 408;
  const STAGE_STARTED = 1;
  const STAGE_PLEADED = 2;
  const STAGE_OLD_CRONE = 3;
  const STAGE_CRONE_HELP = 4;
  const STAGE_CRONE_RITUAL = 5;
  const STAGE_ENCHANTED = 6;
  const STAGE_COMMANDED = 7;
  const STAGE_COMPLETE = 8;

  const AMULET = ItemIdentifiers.GHOSTSPEAK_AMULET; // 552
  const ENCHANTED_AMULET = ItemIdentifiers.GHOSTSPEAK_AMULET_2; // 4250
  const BOOK_OF_HARICANTO = ItemIdentifiers.BOOK_OF_HARICANTO;
  const TRANSLATION_MANUAL = ItemIdentifiers.TRANSLATION_MANUAL;
  const MYSTICAL_ROBES = ItemIdentifiers.MYSTICAL_ROBES;
  const ECTOPHIAL = ItemIdentifiers.ECTOPHIAL;
  const ECTOPHIAL_EMPTY = ItemIdentifiers.ECTOPHIAL_2;
  const MODEL_SHIP = ItemIdentifiers.MODEL_SHIP;
  const REPAIRED_SHIP = ItemIdentifiers.MODEL_SHIP_2;
  const BONE_KEY = ItemIdentifiers.BONE_KEY_2; // Ghosts Ahoy bone key (4272)
  const CHEST_KEY = ItemIdentifiers.CHEST_KEY_4; // Ghosts Ahoy chest key (4273)
  const MAP_SCRAPS = [
    ItemIdentifiers.MAP_SCRAP,
    ItemIdentifiers.MAP_SCRAP_2,
    ItemIdentifiers.MAP_SCRAP_3,
  ];
  const MAP_SCRAP_SET = new Set(MAP_SCRAPS);
  const TREASURE_MAP = ItemIdentifiers.TREASURE_MAP;
  const ECTO_TOKEN = ItemIdentifiers.ECTO_TOKEN;
  const PETITION_FORM = ItemIdentifiers.PETITION_FORM;
  const BEDSHEET = ItemIdentifiers.BEDSHEET;
  const GREEN_BEDSHEET = ItemIdentifiers.BEDSHEET_2;
  const BUCKET_OF_SLIME = ItemIdentifiers.BUCKET_OF_SLIME;
  const BUCKET_OF_WATER = ItemIdentifiers.BUCKET_OF_WATER;
  const BUCKET_OF_MILK = ItemIdentifiers.BUCKET_OF_MILK;
  const BUCKET = ItemIdentifiers.BUCKET;
  const ASHES = ItemIdentifiers.ASHES;
  const OAK_LONGBOW = ItemIdentifiers.OAK_LONGBOW;
  const SIGNED_BOW = ItemIdentifiers.SIGNED_OAK_BOW;
  const SILK = ItemIdentifiers.SILK;
  const NEEDLE = ItemIdentifiers.NEEDLE;
  const THREAD = ItemIdentifiers.THREAD;
  const KNIFE = ItemIdentifiers.KNIFE;
  const SPADE = ItemIdentifiers.SPADE;
  const COINS = ItemIdentifiers.COINS;
  const NETTLES = ItemIdentifiers.NETTLES;
  const BOWL_OF_WATER = ItemIdentifiers.BOWL_OF_WATER;
  const NETTLE_WATER = ItemIdentifiers.NETTLE_WATER;
  const PORCELAIN_CUP = ItemIdentifiers.PORCELAIN_CUP;

  /** Nettle tea items the crone accepts (bowls and cups, plain and milky). */
  const TEA_ITEMS = new Set([
    ItemIdentifiers.NETTLE_TEA,
    ItemIdentifiers.NETTLE_TEA_2,
    ItemIdentifiers.CUP_OF_TEA_4,
    ItemIdentifiers.CUP_OF_TEA_5,
    ItemIdentifiers.CUP_OF_TEA_6,
    ItemIdentifiers.CUP_OF_TEA_7,
  ]);

  const DYE_COLOURS = new Map([
    [ItemIdentifiers.RED_DYE, "red"],
    [ItemIdentifiers.YELLOW_DYE, "yellow"],
    [ItemIdentifiers.BLUE_DYE, "blue"],
    [ItemIdentifiers.ORANGE_DYE, "orange"],
    [ItemIdentifiers.GREEN_DYE, "green"],
    [ItemIdentifiers.PURPLE_DYE, "purple"],
  ]);
  const DYE_INDEX = new Map([...DYE_COLOURS.keys()].map((id, index) => [id, index + 1]));
  const COLOUR_NAMES = ["white", "red", "yellow", "blue", "orange", "green", "purple"];

  const MAST_OBJECT_ID = ObjectIdentifiers.MAST_6; // 16640 (Ahoy shipwreck mast)
  const COFFIN_ID = ObjectIdentifiers.COFFIN_14; // 16644
  const COFFIN_OPEN_ID = ObjectIdentifiers.COFFIN_15; // 16645
  const ECTOFUNTUS_ID = ObjectIdentifiers.ECTOFUNTUS; // 16648
  const LOCKED_CHEST_ID = ObjectIdentifiers.CLOSED_CHEST_28; // 16116 AHOY_CHEST_LOCKED
  const LOCKED_CHEST_ACTIVE_ID = ObjectIdentifiers.OPEN_CHEST_24; // 16117
  const CLOSED_CHEST_ID = ObjectIdentifiers.CLOSED_CHEST_29; // 16118
  const OPEN_CHEST_ID = ObjectIdentifiers.OPEN_CHEST_25; // 16119
  const CHEST_IDS = new Set([
    LOCKED_CHEST_ID,
    LOCKED_CHEST_ACTIVE_ID,
    CLOSED_CHEST_ID,
    OPEN_CHEST_ID,
  ]);
  const OFFICE_CHEST_IDS = new Set([LOCKED_CHEST_ID, LOCKED_CHEST_ACTIVE_ID]);
  const SLIME_POOLS = new Set([
    ObjectIdentifiers.POOL_OF_SLIME,
    ObjectIdentifiers.POOL_OF_SLIME_2,
    ObjectIdentifiers.POOL_OF_SLIME_3,
    ObjectIdentifiers.POOL_OF_SLIME_4,
  ]);
  const NETTLE_OBJECT_ID = ObjectIdentifiers.NETTLES; // 1181
  const SHIPWRECK_GANGPLANKS = new Set([
    ObjectIdentifiers.GANGPLANK_28, // 16651
    ObjectIdentifiers.GANGPLANK_29, // 16652
  ]);

  const OFFICE_CHEST_X = 3619;
  const OFFICE_CHEST_Y = 3545;
  const OPEN_CHEST_SCRAP_3_X = 3606;
  const OPEN_CHEST_SCRAP_3_Y = 3564;
  const GUARDED_CHEST_X = 3618;
  const GUARDED_CHEST_Y = 3542;
  const DRAGONTOOTH_MIN_X = 3776;
  const DRAGONTOOTH_MAX_X = 3812;
  const DRAGONTOOTH_MIN_Y = 3520;
  const DRAGONTOOTH_MAX_Y = 3584;
  const DIG_X = 3803;
  const DIG_Y = 3530;
  const DRAGONTOOTH_LANDING = { x: 3792, y: 3559, z: 0 };
  const ECTOFUNTUS_LANDING = { x: 3654, y: 3519, z: 0 };

  const START_HOOK = "quest:ghosts-ahoy:start";

  const BOW_ATTRIBUTE = "quest.ghosts_ahoy.bow";
  const TOY_ATTRIBUTE = "quest.ghosts_ahoy.toy";
  const SIGNATURES_ATTRIBUTE = "quest.ghosts_ahoy.signatures";
  const BURNED_ATTRIBUTE = "quest.ghosts_ahoy.petition_burned";
  const GIVEN_BOOK_ATTRIBUTE = "quest.ghosts_ahoy.given_book";
  const GIVEN_MANUAL_ATTRIBUTE = "quest.ghosts_ahoy.given_manual";
  const GIVEN_ROBES_ATTRIBUTE = "quest.ghosts_ahoy.given_robes";
  const TOMB_ATTRIBUTE = "quest.ghosts_ahoy.tomb_unlocked";
  const LOBSTER_ATTRIBUTE = "quest.ghosts_ahoy.lobster_killed";
  const TOLD_ATTRIBUTE = "quest.ghosts_ahoy.told_crone";
  const TOY_TOP_ATTRIBUTE = "quest.ghosts_ahoy.toy_top";
  const TOY_SKULL_ATTRIBUTE = "quest.ghosts_ahoy.toy_skull";
  const TOY_BOTTOM_ATTRIBUTE = "quest.ghosts_ahoy.toy_bottom";
  const MAST_TOP_ATTRIBUTE = "quest.ghosts_ahoy.mast_top";
  const MAST_SKULL_ATTRIBUTE = "quest.ghosts_ahoy.mast_skull";
  const MAST_BOTTOM_ATTRIBUTE = "quest.ghosts_ahoy.mast_bottom";

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value | 0);
  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  const wearingItem = (player, slot, itemId) =>
    player.getEquipment().get(slot)?.getId?.() === itemId;
  const wearingAnyAmulet = (player) =>
    wearingItem(player, Equipment.AMULET_SLOT, AMULET) ||
    wearingItem(player, Equipment.AMULET_SLOT, ENCHANTED_AMULET);
  const wearingBedsheet = (player) =>
    wearingItem(player, Equipment.HEAD_SLOT, GREEN_BEDSHEET)
      ? GREEN_BEDSHEET
      : wearingItem(player, Equipment.HEAD_SLOT, BEDSHEET)
        ? BEDSHEET
        : -1;

  const hasAnyMapPiece = (player) =>
    MAP_SCRAPS.some((itemId) => held(player, itemId)) ||
    held(player, TREASURE_MAP) ||
    held(player, BOOK_OF_HARICANTO) ||
    attr(player, GIVEN_BOOK_ATTRIBUTE) === 1;

  const hasRepairKit = (player) =>
    held(player, SILK) && held(player, NEEDLE) && held(player, THREAD) && held(player, KNIFE);

  const mapPieceCount = (player) => MAP_SCRAPS.filter((itemId) => held(player, itemId)).length;

  const atDragontooth = (player) => {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return (
      location.getZ() === 0 &&
      x >= DRAGONTOOTH_MIN_X &&
      x <= DRAGONTOOTH_MAX_X &&
      y >= DRAGONTOOTH_MIN_Y &&
      y <= DRAGONTOOTH_MAX_Y
    );
  };

  const atDigSpot = (player) => {
    const location = player.getLocation();
    return location.getX() === DIG_X && location.getY() === DIG_Y && location.getZ() === 0;
  };

  const toyMatchesMast = (player) =>
    attr(player, TOY_TOP_ATTRIBUTE) > 0 &&
    attr(player, TOY_TOP_ATTRIBUTE) === attr(player, MAST_TOP_ATTRIBUTE) &&
    attr(player, TOY_SKULL_ATTRIBUTE) === attr(player, MAST_SKULL_ATTRIBUTE) &&
    attr(player, TOY_BOTTOM_ATTRIBUTE) === attr(player, MAST_BOTTOM_ATTRIBUTE);

  function randomizeMast(player) {
    setAttr(player, MAST_TOP_ATTRIBUTE, Math.floor(Math.random() * 6) + 1);
    setAttr(player, MAST_SKULL_ATTRIBUTE, Math.floor(Math.random() * 6) + 1);
    setAttr(player, MAST_BOTTOM_ATTRIBUTE, Math.floor(Math.random() * 6) + 1);
  }

  function becomeEnchanted(player) {
    const equipment = player.getEquipment();
    if (wearingItem(player, Equipment.AMULET_SLOT, AMULET)) {
      equipment.setItem(Equipment.AMULET_SLOT, new Item(ENCHANTED_AMULET, 1));
    } else if (held(player, AMULET)) {
      player.getInventory().deleteNumber(AMULET, 1);
      player.getInventory().adds(ENCHANTED_AMULET, 1);
    }
    player.sendMessage("The ghostspeak amulet emits a green glow from its gem.");
  }

  function dischargeEnchanted(player) {
    const equipment = player.getEquipment();
    if (wearingItem(player, Equipment.AMULET_SLOT, ENCHANTED_AMULET)) {
      equipment.setItem(Equipment.AMULET_SLOT, new Item(AMULET, 1));
    } else if (held(player, ENCHANTED_AMULET)) {
      player.getInventory().deleteNumber(ENCHANTED_AMULET, 1);
      player.getInventory().adds(AMULET, 1);
    }
  }

  function unlockTomb(player) {
    if (attr(player, TOMB_ATTRIBUTE) === 1) {
      player.sendMessage("The door is already unlocked.");
      return;
    }
    if (held(player, BONE_KEY)) player.getInventory().deleteNumber(BONE_KEY, 1);
    setAttr(player, TOMB_ATTRIBUTE, 1);
    player.sendMessage("You unlock the door.");
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Velorina</col> in",
        "<col=800000>Port Phasmatys</col>, east of Varrock through the Haunted Woods.",
        "",
        "I must have completed <col=800000>Priest in Peril</col> and",
        "<col=800000>The Restless Ghost</col>.",
        "I need at least level 25 Agility and level 20 Cooking.",
        "I must also be able to defeat a level 32 monster.",
      ];
    }
    const lines = [
      "<str>Velorina told me the sad history of the ghosts of Port Phasmatys.</str>",
      "<str>She asked me to plead with Necrovarus to let any ghost who wishes pass over.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push("I should speak to <col=800000>Necrovarus</col> in the Temple of Phasmatys.");
    }
    if (stage >= STAGE_PLEADED) lines.push("<str>I pleaded with Necrovarus, to no avail.</str>");
    if (stage === STAGE_PLEADED) lines.push("", "I should tell <col=800000>Velorina</col> that Necrovarus will not listen.");
    if (stage >= STAGE_OLD_CRONE) {
      lines.push("<str>Velorina spoke of an old woman who fled Port Phasmatys before its fall.</str>");
    }
    if (stage === STAGE_OLD_CRONE) lines.push("", "I should find the <col=800000>old crone</col> in her shack.");
    if (stage >= STAGE_CRONE_HELP) {
      lines.push("<str>The old crone will enchant my ghostspeak amulet.</str>");
    }
    if (stage === STAGE_CRONE_HELP) {
      const inventory = player.getInventory();
      const mark = (itemId, label, given) =>
        given || inventory.getAmount(itemId) > 0 ? `<str>${label}</str>` : label;
      lines.push(
        "",
        "I need to bring the <col=800000>old crone</col>:",
        mark(BOOK_OF_HARICANTO, "The Book of Haricanto", attr(player, GIVEN_BOOK_ATTRIBUTE) === 1),
        mark(MYSTICAL_ROBES, "The Robes of Necrovarus", attr(player, GIVEN_ROBES_ATTRIBUTE) === 1),
        mark(
          TRANSLATION_MANUAL,
          "Something to translate the Book of Haricanto",
          attr(player, GIVEN_MANUAL_ATTRIBUTE) === 1
        )
      );
      if (attr(player, TOY_ATTRIBUTE) >= 2) {
        lines.push("", "<str>I gave the old crone's toy boat to her son on the shipwreck.</str>");
      } else if (attr(player, TOY_ATTRIBUTE) >= 1) {
        lines.push(
          "",
          "The <col=800000>old crone</col> gave me a <col=800000>toy boat</col> to pass on to her son. It is a model of the ship he sailed away on."
        );
      }
      if (attr(player, BOW_ATTRIBUTE) >= 8) {
        lines.push("", "<str>Ak-Haranu traded me a translation manual for a signed oak longbow.</str>");
      } else if (attr(player, BOW_ATTRIBUTE) >= 1) {
        lines.push(
          "",
          "I agreed to bring <col=800000>Ak-Haranu</col> an oak longbow signed by <col=800000>Robin</col>, the Master Bowman staying at the Port Phasmatys inn."
        );
      }
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      if (signatures >= 10 && attr(player, BURNED_ATTRIBUTE) === 1) {
        lines.push("", "<str>Necrovarus burned Gravingas's petition to ashes.</str>");
      } else if (signatures > 0 || held(player, PETITION_FORM)) {
        lines.push(
          "",
          `<col=800000>Gravingas</col> asked me to collect 10 signatures for his petition. I have ${signatures} so far.`
        );
      }
    }
    if (stage >= STAGE_CRONE_RITUAL) {
      lines.push("<str>I brought the old crone the book, robes and translation manual.</str>");
    }
    if (stage === STAGE_CRONE_RITUAL) {
      lines.push("", "I need to bring her my <col=800000>ghostspeak amulet</col> to be enchanted.");
    }
    if (stage >= STAGE_ENCHANTED) {
      lines.push("<str>The old crone enchanted my ghostspeak amulet.</str>");
    }
    if (stage === STAGE_ENCHANTED) {
      lines.push(
        "",
        "I need to use the <col=800000>enchanted amulet</col> to command <col=800000>Necrovarus</col> in the Temple."
      );
    }
    if (stage >= STAGE_COMMANDED) lines.push("<str>I commanded Necrovarus to let the ghosts pass on.</str>");
    if (stage === STAGE_COMMANDED) {
      lines.push("", "I should tell <col=800000>Velorina</col> the news.");
    }
    if (stage >= STAGE_COMPLETE) {
      lines.push(
        "",
        "<str>Velorina gave me the Ectophial as thanks, and the ghosts of Port Phasmatys are free.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
    }
    return lines;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === VELORINA_NPC_ID) {
      if (stage <= 0) return "starting-off-talking-to-velorina";
      if (stage === STAGE_STARTED) return "starting-off-talking-to-velorina-again";
      if (stage === STAGE_PLEADED) return "returning-to-velorina-after-talking-to-necrovarus";
      if (stage === STAGE_OLD_CRONE) {
        return "returning-to-velorina-after-talking-to-necrovarus-talking-to-velorina-again";
      }
      if (stage === STAGE_CRONE_HELP) return "talking-to-velorina-after-talking-to-the-old-crone";
      if (stage <= STAGE_ENCHANTED) return "talking-to-velorina";
      if (stage === STAGE_COMMANDED) return "talking-to-velorina-2";
      return "post-quest-dialogue-velorina";
    }
    if (npcId === NECROVARUS_NPC_ID) {
      if (stage <= 0) return null;
      if (stage === STAGE_STARTED) return "talking-to-necrovarus";
      if (stage <= STAGE_OLD_CRONE) {
        return "talking-to-necrovarus-talking-to-necrovarus-again";
      }
      if (stage === STAGE_CRONE_HELP) {
        return attr(player, BURNED_ATTRIBUTE) === 1
          ? "robes-of-necrovarus-talking-to-necrovarus-whilst-collecting-signatures-subsequent-dialogue-with-necrovarus"
          : "robes-of-necrovarus-talking-to-necrovarus-whilst-collecting-signatures";
      }
      if (stage === STAGE_CRONE_RITUAL) {
        return "robes-of-necrovarus-talking-to-necrovarus-whilst-collecting-signatures-subsequent-dialogue-with-necrovarus";
      }
      if (stage === STAGE_ENCHANTED) return "commanding-necrovarus-to-stand-down";
      return "commanding-necrovarus-to-stand-down-talking-to-necrovarus-after-freeing-port-phasmatys";
    }
    if (npcId === GRAVINGAS_NPC_ID) {
      if (stage <= STAGE_OLD_CRONE) return "robes-of-necrovarus-talking-to-gravingas";
      if (stage <= STAGE_ENCHANTED) {
        return "robes-of-necrovarus-talking-to-gravingas-talking-to-gravingas-again";
      }
      return "post-quest-dialogue-gravingas";
    }
    if (npcId === AK_HARANU_NPC_ID) {
      const bow = attr(player, BOW_ATTRIBUTE);
      if (bow >= 8) {
        return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-after-getting-the-bow-signed-subsequent-dialogue-with-ak-haranu";
      }
      if (bow >= 1 && held(player, SIGNED_BOW)) {
        return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-after-getting-the-bow-signed";
      }
      if (bow >= 1) {
        return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu-subsequent-dialogue-with-ak-haranu";
      }
      return "something-to-translate-the-book-of-haricanto-talking-to-ak-haranu";
    }
    if (npcId === ROBIN_NPC_ID) {
      if (held(player, BEDSHEET)) {
        return "robes-of-necrovarus-talking-to-the-ghost-innkeeper-talking-to-robin-with-the-innkeeper-s-task";
      }
      if (attr(player, BOW_ATTRIBUTE) >= 7) {
        return "something-to-translate-the-book-of-haricanto-talking-to-robin-talking-to-robin-after-getting-the-bow-signed";
      }
      return "something-to-translate-the-book-of-haricanto-talking-to-robin";
    }
    if (npcId === OLD_CRONE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "post-quest-dialogue-old-crone";
      if (stage >= STAGE_ENCHANTED) {
        return "talking-to-the-old-crone-with-the-materials-talking-to-the-old-crone-again";
      }
      if (stage >= STAGE_CRONE_HELP) {
        if (attr(player, TOY_ATTRIBUTE) >= 2 && attr(player, TOLD_ATTRIBUTE) !== 1) {
          return "book-of-haricanto-talking-to-the-old-crone-after-finding-the-old-man";
        }
        return "talking-to-the-old-crone-with-the-materials";
      }
      if (stage >= STAGE_OLD_CRONE) return "talking-to-the-old-crone";
      return null;
    }
    if (npcId === OLD_MAN_NPC_ID) {
      if (attr(player, TOY_ATTRIBUTE) >= 2) {
        return held(player, CHEST_KEY)
          ? "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man-again"
          : "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man-after-losing-the-key";
      }
      return "book-of-haricanto-at-the-shipwrecked-boat-talking-to-the-old-man";
    }
    if (npcId === GHOST_VILLAGER_NPC_ID) {
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      if (
        stage >= STAGE_CRONE_HELP &&
        attr(player, BURNED_ATTRIBUTE) !== 1 &&
        (held(player, PETITION_FORM) || signatures > 0)
      ) {
        return "robes-of-necrovarus-talking-to-the-ghost-villagers";
      }
      return null;
    }
    if (npcId === GHOST_INNKEEPER_NPC_ID) {
      return "robes-of-necrovarus-talking-to-the-ghost-innkeeper";
    }
    if (npcId === GHOST_CAPTAIN_NPC_ID) {
      return "book-of-haricanto-travelling-to-dragontooth-island-talking-to-the-ghost-captain";
    }
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (!GHOSTS_AHOY_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const has = (itemId) => held(player, itemId);
    const tokens = player.getInventory().getAmount(ECTO_TOKEN);

    // ---- ghostspeak amulet ----
    if (value.includes("enchanted ghostspeak amulet")) {
      const wears = wearingItem(player, Equipment.AMULET_SLOT, ENCHANTED_AMULET);
      const carries = has(ENCHANTED_AMULET);
      if (value.includes("does not have") || value.includes("lost")) return !wears && !carries;
      if (value.includes("wearing")) return wears;
      return wears || carries;
    }
    if (value.includes("regular ghostspeak amulet")) {
      return has(AMULET) || wearingItem(player, Equipment.AMULET_SLOT, AMULET);
    }
    if (value.includes("ghostspeak amulet") || value.includes("amulet of ghostspeak")) {
      const wears = wearingAnyAmulet(player);
      const carries = has(AMULET) || has(ENCHANTED_AMULET);
      if (value.includes("not wearing") || value.includes("without the amulet")) return !wears;
      if (value.includes("does not have a ghostspeak amulet in their bag")) return !carries;
      if (value.includes("has a ghostspeak amulet in their bag")) return carries;
      if (value.includes("wearing or has the ghostspeak amulet")) return wears || carries;
      if (value.includes("doesn't have") || value.includes("does not have")) return !wears && !carries;
      if (value.includes("wearing")) return wears;
      return wears || carries;
    }

    // ---- nettle tea ----
    if (value.includes("nettle tea")) {
      const plain = has(ItemIdentifiers.NETTLE_TEA) || has(ItemIdentifiers.CUP_OF_TEA_4);
      const milky =
        has(ItemIdentifiers.NETTLE_TEA_2) ||
        has(ItemIdentifiers.CUP_OF_TEA_5) ||
        has(ItemIdentifiers.CUP_OF_TEA_6) ||
        has(ItemIdentifiers.CUP_OF_TEA_7);
      if (
        value.includes("puts the nettles") ||
        value.includes("burns the nettle") ||
        value.includes("successfully cooks") ||
        value.includes("without milk")
      ) {
        return null;
      }
      if (value.includes("does not already have a bowl of nettle tea")) return !plain && !milky;
      if (value.includes("already has a bowl of nettle tea")) {
        return has(ItemIdentifiers.NETTLE_TEA) || has(ItemIdentifiers.NETTLE_TEA_2);
      }
      if (value.includes("with milk")) return milky;
      if (value.includes("regular nettle tea")) return plain;
      return plain || milky;
    }

    // ---- bow subquest ----
    if (value.includes("oak longbow")) {
      if (value.includes("does not have")) return !has(OAK_LONGBOW);
      return has(OAK_LONGBOW);
    }
    if (value.includes("25 coins")) {
      if (value.includes("does not have")) return has(COINS) < 25;
      return has(COINS) >= 25;
    }
    if (value.includes("wins 100 coins")) return false;
    if (value.includes("if the player wins")) return false;
    if (value.includes("if the player loses")) return false;

    if (value.includes("translation manual")) {
      if (value.includes("lost")) return !has(TRANSLATION_MANUAL);
      if (value.includes("has the translation manual")) return has(TRANSLATION_MANUAL);
    }

    // ---- crone's materials ----
    if (value.includes("gave all three materials")) {
      return (
        attr(player, GIVEN_BOOK_ATTRIBUTE) === 1 &&
        attr(player, GIVEN_MANUAL_ATTRIBUTE) === 1 &&
        attr(player, GIVEN_ROBES_ATTRIBUTE) === 1
      );
    }
    if (value.includes("has the book of haricanto")) return has(BOOK_OF_HARICANTO);
    if (value.includes("has the robes of necrovarus")) return has(MYSTICAL_ROBES);

    // ---- toy ship ----
    if (value.includes("model ship") && value.includes("broken")) {
      return has(MODEL_SHIP) && !has(REPAIRED_SHIP);
    }
    if (value.includes("model ship") && value.includes("coloured wrong")) {
      return has(REPAIRED_SHIP) && !toyMatchesMast(player);
    }
    if (value.includes("model ship") && value.includes("correctly recoloured")) {
      return has(REPAIRED_SHIP) && toyMatchesMast(player);
    }
    if (value.includes("attempts to repair the toy ship without")) return !hasRepairKit(player);
    if (value.includes("without having the rest")) {
      const hasSome =
        has(SILK) || has(NEEDLE) || has(THREAD) || has(KNIFE);
      return hasSome && !hasRepairKit(player);
    }
    if (value.includes("whilst having the rest")) return hasRepairKit(player);
    if (value.includes("uses the repaired model ship on the old crone")) {
      return has(REPAIRED_SHIP);
    }
    if (value.includes("inspects the repaired toy ship")) return has(REPAIRED_SHIP);
    if (value.includes("dye on the toy ship")) return has(REPAIRED_SHIP);

    // ---- shipwreck chests and mast ----
    if (value.includes("searches the already opened chests")) return hasAnyMapPiece(player);
    if (value.includes("second-to-the-last chest")) return !has(ItemIdentifiers.MAP_SCRAP_3);
    if (value.includes("searches the guarded chest")) return !has(ItemIdentifiers.MAP_SCRAP_2);
    if (value.includes("searches the mast whilst the windspeed is low")) return true;
    if (value.includes("searches the mast whilst the windspeed is high")) return false;
    if (value.includes("near the mast")) {
      if (value.includes("boxes")) return true;
      return true;
    }
    if (value.includes("attempts to open the locked chest")) return !has(CHEST_KEY);
    if (value.includes("talks to the dead pirate captain")) return true;
    if (value.includes("uses the chest key on the chest")) return has(CHEST_KEY);
    if (value.includes("opens the chest")) return true;

    // ---- rocky island and map ----
    if (value.includes("crosses the gangplank")) return true;
    if (value.includes("successfully jumps to a rock")) return true;
    if (value.includes("falls onto the next rock")) return false;
    if (value.includes("northern-most part of the island")) return true;
    if (value.includes("only having two pieces")) return mapPieceCount(player) === 2;
    if (value.includes("with three pieces")) return mapPieceCount(player) === 3;
    if (value.includes("not at dragontooth island")) return !atDragontooth(player);
    if (value.includes("is at dragontooth island")) return atDragontooth(player);
    if (value.includes("digs at the wrong location")) return !atDigSpot(player);
    if (value.includes("digs at the correct location")) {
      return atDigSpot(player) && has(TREASURE_MAP);
    }
    if (value.includes("'follow' option")) return true;

    // ---- ghost captain ----
    if (value.includes("500 ectotokens")) {
      if (value.includes("does not have")) return tokens < 500;
      return tokens >= 500;
    }
    if (value.includes("at least 25 ectotokens")) return tokens >= 25;

    // ---- petition ----
    if (value.includes("petition form")) {
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      if (value.includes("drop")) return false;
      if (value.includes("loses the petition form")) {
        return attr(player, BURNED_ATTRIBUTE) !== 1 && !has(PETITION_FORM) && signatures > 0;
      }
      if (value.includes("not signed or partially signed")) {
        return has(PETITION_FORM) && signatures < 10;
      }
      if (value.includes("full petition form")) {
        return has(PETITION_FORM) && signatures >= 10;
      }
      return has(PETITION_FORM);
    }
    if (value.includes("no inventory space") || value.includes("does not have inventory space")) {
      return freeSlots(player) < 1;
    }
    if (value.includes("one free inventory space")) return freeSlots(player) >= 1;
    if (value.includes("no signatures")) return attr(player, SIGNATURES_ATTRIBUTE) === 0;
    if (value.includes("one signature")) return attr(player, SIGNATURES_ATTRIBUTE) === 1;
    if (value.includes("4-6 signatures")) {
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      return signatures >= 4 && signatures <= 6;
    }
    if (value.includes("7-8 signatures")) {
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      return signatures >= 7 && signatures <= 8;
    }
    if (value.includes("9 signatures")) return attr(player, SIGNATURES_ATTRIBUTE) === 9;
    if (value.includes("all 10 signatures")) return attr(player, SIGNATURES_ATTRIBUTE) >= 10;
    if (value.includes("same ghost villager")) return false;
    if (value.includes("succeeds in getting 10 signatures")) {
      return attr(player, SIGNATURES_ATTRIBUTE) >= 10;
    }
    if (value.includes("full petition form")) return attr(player, SIGNATURES_ATTRIBUTE) >= 10;
    if (value.includes("not enough ecto-tokens")) return tokens < 1;
    if (value.includes("ecto-tokens")) return tokens >= 1;

    // ---- bedsheet disguise ----
    if (value.includes("bedsheet")) {
      const clean = has(BEDSHEET);
      const green = has(GREEN_BEDSHEET);
      if (value.includes("does not have a bedsheet")) return !clean && !green;
      if (value.includes("already has a bedsheet")) return clean || green;
      if (value.includes("does not have a clean bedsheet")) return !clean;
      if (value.includes("clean bedsheet in their inventory")) return clean;
      if (value.includes("bucket of slime")) return clean && has(BUCKET_OF_SLIME);
      if (value.includes("bucket of water or milk")) return false;
      if (value.includes("leave port phasmatys")) return false;
      if (value.includes("outside port phasmatys")) return false;
      if (value.includes("not wearing a slimy bedsheet")) {
        return wearingBedsheet(player) !== GREEN_BEDSHEET;
      }
      if (value.includes("wearing a bedsheet but not slime")) {
        return wearingBedsheet(player) === BEDSHEET;
      }
      if (value.includes("wearing a slime covered bedsheet")) {
        return wearingBedsheet(player) === GREEN_BEDSHEET;
      }
    }

    // ---- necrovarus's tomb ----
    if (value.includes("bone key")) {
      if (value.includes("door without the key")) {
        return attr(player, TOMB_ATTRIBUTE) !== 1 && !has(BONE_KEY);
      }
      if (value.includes("on the door again")) return attr(player, TOMB_ATTRIBUTE) === 1;
      if (value.includes("uses the bone key on the door")) {
        return attr(player, TOMB_ATTRIBUTE) !== 1 && has(BONE_KEY);
      }
      if (value.includes("doesn't have") || value.includes("does not have")) {
        return attr(player, TOMB_ATTRIBUTE) !== 1 && !has(BONE_KEY);
      }
      return has(BONE_KEY);
    }
    if (value.includes("opens the tomb")) return attr(player, TOMB_ATTRIBUTE) === 1;
    if (value.includes("searches the tomb")) return attr(player, TOMB_ATTRIBUTE) === 1;

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== VELORINA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) <= 0) quest.setStage(player, STAGE_STARTED);
  }

  /** Chosen-condition side effects: hand-ins and stage advances. */
  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    const stage = quest.getStage(player);
    if (npcId === NECROVARUS_NPC_ID && stepId === "wNrTfA") {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_PLEADED);
      return;
    }
    if (npcId === VELORINA_NPC_ID && stepId === "TQFhQ8") {
      if (stage === STAGE_PLEADED) quest.setStage(player, STAGE_OLD_CRONE);
      return;
    }
    if (npcId !== OLD_CRONE_NPC_ID) return;
    if (stepId === "pz4L0V") {
      player.getInventory().deleteNumber(BOOK_OF_HARICANTO, 1);
      setAttr(player, GIVEN_BOOK_ATTRIBUTE, 1);
      player.sendMessage("You give the Book of Haricanto to the old crone.");
      return;
    }
    if (stepId === "FpgXvG") {
      player.getInventory().deleteNumber(TRANSLATION_MANUAL, 1);
      setAttr(player, GIVEN_MANUAL_ATTRIBUTE, 1);
      player.sendMessage("You give the translation manual to the old crone.");
      return;
    }
    if (stepId === "LvSGlR") {
      player.getInventory().deleteNumber(MYSTICAL_ROBES, 1);
      setAttr(player, GIVEN_ROBES_ATTRIBUTE, 1);
      player.sendMessage("You give the Robes of Necrovarus to the old crone.");
      return;
    }
    if (stepId === "BUgbCE" && stage === STAGE_CRONE_HELP) {
      quest.setStage(player, STAGE_CRONE_RITUAL);
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    const value = String(option ?? "").toLowerCase();
    if (npcId === OLD_CRONE_NPC_ID && value.includes("found your son")) {
      setAttr(player, TOLD_ATTRIBUTE, 1);
      return;
    }
    if (
      npcId === NECROVARUS_NPC_ID &&
      value.includes("let any ghost who so wishes pass on") &&
      quest.getStage(player) === STAGE_ENCHANTED
    ) {
      dischargeEnchanted(player);
      setAttr(player, TOMB_ATTRIBUTE, 1);
      quest.setStage(player, STAGE_COMMANDED);
    }
  }

  function sailToDragontooth(player) {
    player.sendMessage("After a long boat trip you arrive at Dragontooth Island.");
    player.moveTo(new Location(DRAGONTOOTH_LANDING.x, DRAGONTOOTH_LANDING.y, DRAGONTOOTH_LANDING.z));
  }

  function spawnGiantLobster(player) {
    const lobster = api.spawnNpc({
      id: GIANT_LOBSTER_NPC_ID,
      x: 3616,
      y: 3543,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (lobster) player.sendMessage("A giant lobster appears!");
  }

  function handleAction(event) {
    const { player, stepId } = event;
    const stage = quest.getStage(player);
    switch (stepId) {
      case "xK-8eQ":
        if (stage >= STAGE_COMMANDED && !quest.isComplete(player)) {
          quest.complete(player);
          event.handled = true;
          event.end = true;
        }
        return;
      case "zy3bCu":
        becomeEnchanted(player);
        if (stage === STAGE_CRONE_RITUAL) quest.setStage(player, STAGE_ENCHANTED);
        event.handled = true;
        return;
      case "YWXokZ":
        if (held(player, OAK_LONGBOW)) {
          player.getInventory().deleteNumber(OAK_LONGBOW, 1);
          player.getInventory().adds(SIGNED_BOW, 1);
          setAttr(player, BOW_ATTRIBUTE, 7);
        }
        event.handled = true;
        return;
      case "oPe4dE":
        if (held(player, SIGNED_BOW)) {
          player.getInventory().deleteNumber(SIGNED_BOW, 1);
          player.getInventory().adds(TRANSLATION_MANUAL, 1);
        }
        setAttr(player, BOW_ATTRIBUTE, 8);
        event.handled = true;
        return;
      case "3jzsI_":
        if (!held(player, TRANSLATION_MANUAL)) {
          player.getInventory().adds(TRANSLATION_MANUAL, 1);
        }
        event.handled = true;
        return;
      case "rWYHfe":
        if (attr(player, TOY_ATTRIBUTE) === 1) {
          if (!held(player, MODEL_SHIP) && !held(player, REPAIRED_SHIP)) {
            player.getInventory().adds(MODEL_SHIP, 1);
          }
          randomizeMast(player);
        }
        event.handled = true;
        return;
      case "YENHyy":
        if (!held(player, PORCELAIN_CUP)) player.getInventory().adds(PORCELAIN_CUP, 1);
        event.handled = true;
        return;
      case "xqZQgr":
        if (!held(player, BEDSHEET) && !held(player, GREEN_BEDSHEET)) {
          player.getInventory().adds(BEDSHEET, 1);
        }
        event.handled = true;
        return;
      case "2zNHiy":
      case "0F6hip":
        if (!held(player, PETITION_FORM)) {
          player.getInventory().adds(PETITION_FORM, 1);
          setAttr(player, SIGNATURES_ATTRIBUTE, 0);
          setAttr(player, BURNED_ATTRIBUTE, 0);
        }
        event.handled = true;
        return;
      case "t-Azeh":
        player.getInventory().deleteNumber(PETITION_FORM, 1);
        player.getInventory().adds(ASHES, 1);
        setAttr(player, BURNED_ATTRIBUTE, 1);
        event.handled = true;
        return;
      case "wxm-9t":
        if (!held(player, BONE_KEY)) player.getInventory().adds(BONE_KEY, 1);
        event.handled = true;
        return;
      case "s7MA3K":
        if (!held(player, CHEST_KEY)) player.getInventory().adds(CHEST_KEY, 1);
        event.handled = true;
        return;
      case "1p3ORv":
        if (!held(player, CHEST_KEY)) player.getInventory().adds(CHEST_KEY, 1);
        setAttr(player, TOY_ATTRIBUTE, 2);
        event.handled = true;
        return;
      case "_LN511":
        if (!hasAnyMapPiece(player)) {
          player.getInventory().adds(ItemIdentifiers.MAP_SCRAP, 1);
        }
        event.handled = true;
        return;
      case "DF_gCD":
        if (!held(player, ItemIdentifiers.MAP_SCRAP_3) && !held(player, TREASURE_MAP)) {
          player.getInventory().adds(ItemIdentifiers.MAP_SCRAP_3, 1);
        }
        event.handled = true;
        return;
      case "0rh2a0":
      case "6iEugl": {
        const signatures = Math.min(10, attr(player, SIGNATURES_ATTRIBUTE) + 1);
        setAttr(player, SIGNATURES_ATTRIBUTE, signatures);
        event.handled = true;
        player.sendMessage(
          `The ghost signs your petition. You have obtained ${signatures} signature${
            signatures === 1 ? "" : "s"
          } so far.`
        );
        return;
      }
      case "xKEU0g":
        setAttr(player, SIGNATURES_ATTRIBUTE, 10);
        event.handled = true;
        return;
      case "Ct4wPs":
        sailToDragontooth(player);
        event.handled = true;
        return;
      case "d8PAqv":
        if (player.getInventory().getAmount(ECTO_TOKEN) >= 500) {
          player.getInventory().deleteNumber(ECTO_TOKEN, 500);
          sailToDragontooth(player);
        }
        event.handled = true;
        return;
      case "-URfAp":
        player.getSkillManager().addExperiences(Skill.AGILITY, 10);
        event.handled = true;
        return;
      case "EBHdqY":
        player.getSkillManager().addExperiences(Skill.COOKING, 52);
        event.handled = true;
        return;
      case "1qdKTp":
        // Runedraw has no interface here; the bow is signed by using it on Robin.
        event.handled = true;
        return;
      case "8-6SLN":
        if (freeSlots(player) >= 1) player.getInventory().adds(ECTOPHIAL, 1);
        event.handled = true;
        return;
      default:
        return;
    }
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const targetId = event.target?.getId?.() ?? event.npcId;
    if (targetId === ROBIN_NPC_ID) {
      if (itemId === BEDSHEET) {
        player.getInventory().deleteNumber(BEDSHEET, 1);
        player.sendMessage("Robin takes the bedsheet and shoos you away.");
        event.handled = true;
        return;
      }
      if (
        itemId === OAK_LONGBOW &&
        attr(player, BOW_ATTRIBUTE) >= 1 &&
        !quest.isComplete(player)
      ) {
        player.getInventory().deleteNumber(OAK_LONGBOW, 1);
        player.getInventory().adds(SIGNED_BOW, 1);
        setAttr(player, BOW_ATTRIBUTE, 7);
        player.sendMessage("Robin signs the oak longbow for you.");
        event.handled = true;
        return;
      }
    }
    if (
      targetId === OLD_CRONE_NPC_ID &&
      TEA_ITEMS.has(itemId) &&
      quest.getStage(player) === STAGE_OLD_CRONE
    ) {
      player.getInventory().deleteNumber(itemId, 1);
      player.sendMessage(
        "As the old woman drinks the tea, enlightenment glows from within her eyes."
      );
      player.sendMessage("Ah, that's better. Now, let me see... Yes, I was once a disciple of Necrovarus.");
      quest.setStage(player, STAGE_CRONE_HELP);
      event.handled = true;
    }
  }

  function flagDescription(player) {
    const name = (value) => COLOUR_NAMES[value] ?? "white";
    return (
      `The top of the flag is ${name(attr(player, TOY_TOP_ATTRIBUTE))}. ` +
      `The skull emblem is ${name(attr(player, TOY_SKULL_ATTRIBUTE))}. ` +
      `The bottom of the flag is ${name(attr(player, TOY_BOTTOM_ATTRIBUTE))}.`
    );
  }

  function openDyePrompt(player, dyeId) {
    const colour = DYE_COLOURS.get(dyeId);
    const colourIndex = DYE_INDEX.get(dyeId);
    const apply = (attribute, label) => {
      if (!held(player, dyeId)) return;
      player.getInventory().deleteNumber(dyeId, 1);
      setAttr(player, attribute, colourIndex);
      player.sendMessage(`You dye the ${label} of the flag ${colour}.`);
    };
    api.sendMultiChatboxPrompt(
      player,
      "Which part of the flag do you want to dye?",
      "Top half",
      () => apply(TOY_TOP_ATTRIBUTE, "top"),
      "Bottom half",
      () => apply(TOY_BOTTOM_ATTRIBUTE, "bottom"),
      "Skull emblem",
      () => apply(TOY_SKULL_ATTRIBUTE, "skull emblem")
    );
  }

  function handleItemOnItem(event) {
    const used = event.usedItemId ?? event.itemId;
    const withItem = event.usedWithItemId ?? event.targetItemId;
    const ids = new Set([used, withItem]);
    const { player } = event;
    if (ids.has(BEDSHEET) && ids.has(BUCKET_OF_SLIME)) {
      player.getInventory().deleteNumber(BEDSHEET, 1);
      player.getInventory().deleteNumber(BUCKET_OF_SLIME, 1);
      player.getInventory().adds(GREEN_BEDSHEET, 1);
      player.sendMessage("You dip the bedsheet in the bucket of ectoplasm.");
      event.handled = true;
      return;
    }
    if (ids.has(BEDSHEET) && (ids.has(BUCKET_OF_WATER) || ids.has(BUCKET_OF_MILK))) {
      player.sendMessage("Nothing interesting happens.");
      event.handled = true;
      return;
    }
    if (ids.has(NETTLES) && ids.has(BOWL_OF_WATER)) {
      player.getInventory().deleteNumber(NETTLES, 1);
      player.getInventory().deleteNumber(BOWL_OF_WATER, 1);
      player.getInventory().adds(NETTLE_WATER, 1);
      player.sendMessage("You place the nettles into the bowl of water.");
      event.handled = true;
      return;
    }
    if (MAP_SCRAP_SET.has(used) && MAP_SCRAP_SET.has(withItem)) {
      if (mapPieceCount(player) >= 3) {
        for (const itemId of MAP_SCRAPS) player.getInventory().deleteNumber(itemId, 1);
        player.getInventory().adds(TREASURE_MAP, 1);
        player.sendMessage("You piece the three map scraps together to form a complete map.");
      } else {
        player.sendMessage("You don't have all the pieces of the map yet.");
      }
      event.handled = true;
      return;
    }
    if (used === REPAIRED_SHIP || withItem === REPAIRED_SHIP) {
      const dyeId = DYE_COLOURS.has(used) ? used : DYE_COLOURS.has(withItem) ? withItem : undefined;
      if (dyeId !== undefined && quest.getStage(player) >= STAGE_CRONE_HELP) {
        openDyePrompt(player, dyeId);
        event.handled = true;
      }
    }
  }

  function repairToyShip(player) {
    if (!hasRepairKit(player)) {
      player.sendMessage(
        "You need some silk to replace the flag, something to sew it to the boat, and something to cut the flag to the right size."
      );
      return;
    }
    player.getInventory().deleteNumber(SILK, 1);
    player.getInventory().deleteNumber(THREAD, 1);
    player.getInventory().deleteNumber(MODEL_SHIP, 1);
    player.getInventory().adds(REPAIRED_SHIP, 1);
    player.sendMessage("You replace the toy boat's missing flag.");
  }

  function digForBook(player) {
    if (!held(player, TREASURE_MAP) || !atDigSpot(player)) return;
    if (held(player, BOOK_OF_HARICANTO) || attr(player, GIVEN_BOOK_ATTRIBUTE) === 1) return;
    player.getInventory().adds(BOOK_OF_HARICANTO, 1);
    player.sendMessage("You unearth the Book of Haricanto.");
  }

  function emptyEctophial(player) {
    if (!held(player, ECTOPHIAL)) return;
    player.getInventory().deleteNumber(ECTOPHIAL, 1);
    player.getInventory().adds(ECTOPHIAL_EMPTY, 1);
    player.sendMessage("You empty the ectoplasm onto the ground around your feet...");
    player.moveTo(new Location(ECTOFUNTUS_LANDING.x, ECTOFUNTUS_LANDING.y, ECTOFUNTUS_LANDING.z));
    player.sendMessage("... and the world changes around you.");
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if (itemId === MODEL_SHIP && option.includes("repair")) {
      repairToyShip(player);
      event.handled = true;
      return;
    }
    if (itemId === REPAIRED_SHIP && option.includes("inspect")) {
      player.sendMessage(flagDescription(player));
      event.handled = true;
      return;
    }
    if (itemId === TREASURE_MAP && (option.includes("follow") || option.includes("read"))) {
      if (option.includes("read") || !atDragontooth(player)) {
        player.sendMessage("This map is for use elsewhere.");
      } else {
        player.sendMessage("The map marks a spot on Dragontooth Island. Use a spade there to dig.");
      }
      event.handled = true;
      return;
    }
    if (itemId === SPADE && option.includes("dig")) {
      digForBook(player);
      event.handled = true;
      return;
    }
    if (itemId === ECTOPHIAL && option.includes("empty")) {
      emptyEctophial(player);
      event.handled = true;
      return;
    }
    if (itemId === PETITION_FORM && option.includes("count")) {
      const signatures = attr(player, SIGNATURES_ATTRIBUTE);
      player.sendMessage(
        signatures === 0
          ? "You haven't got any signatures yet."
          : `You have obtained ${signatures} signature${signatures === 1 ? "" : "s"}.`
      );
      event.handled = true;
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === ECTOPHIAL_EMPTY && objectId === ECTOFUNTUS_ID) {
      player.getInventory().deleteNumber(ECTOPHIAL_EMPTY, 1);
      player.getInventory().adds(ECTOPHIAL, 1);
      player.sendMessage("You refill the ectophial from the Ectofuntus.");
      event.handled = true;
      return;
    }
    if (itemId === BUCKET && SLIME_POOLS.has(objectId)) {
      player.getInventory().deleteNumber(BUCKET, 1);
      player.getInventory().adds(BUCKET_OF_SLIME, 1);
      player.sendMessage("You fill the bucket with ectoplasm.");
      event.handled = true;
      return;
    }
    if (itemId === BONE_KEY && (objectId === COFFIN_ID || objectId === COFFIN_OPEN_ID)) {
      unlockTomb(player);
      event.handled = true;
      return;
    }
    if (itemId === CHEST_KEY && OFFICE_CHEST_IDS.has(objectId)) {
      if (!held(player, CHEST_KEY)) return;
      player.getInventory().deleteNumber(CHEST_KEY, 1);
      player.sendMessage("You unlock the chest.");
      if (!hasAnyMapPiece(player)) {
        player.getInventory().adds(ItemIdentifiers.MAP_SCRAP, 1);
        player.sendMessage("You find a piece of a map inside the chest.");
      }
      event.handled = true;
    }
  }

  function searchChest(event, option) {
    if (!option.includes("search") && !option.includes("open")) return;
    const { player, location } = event;
    const x = location?.x;
    const y = location?.y;
    event.handled = true;
    if (x === OFFICE_CHEST_X && y === OFFICE_CHEST_Y) {
      if (!held(player, CHEST_KEY)) {
        player.sendMessage("The chest is locked.");
        return;
      }
      player.getInventory().deleteNumber(CHEST_KEY, 1);
      player.sendMessage("You unlock the chest.");
      if (!hasAnyMapPiece(player)) {
        player.getInventory().adds(ItemIdentifiers.MAP_SCRAP, 1);
        player.sendMessage("You find a piece of a map inside the chest.");
      } else {
        player.sendMessage("You search the chest but find nothing.");
      }
      return;
    }
    if (x === OPEN_CHEST_SCRAP_3_X && y === OPEN_CHEST_SCRAP_3_Y) {
      if (hasAnyMapPiece(player)) {
        player.sendMessage("You search the chest but find nothing.");
        return;
      }
      player.getInventory().adds(ItemIdentifiers.MAP_SCRAP_3, 1);
      player.sendMessage("You find a piece of a map inside the chest.");
      return;
    }
    if (x === GUARDED_CHEST_X && y === GUARDED_CHEST_Y) {
      if (attr(player, LOBSTER_ATTRIBUTE) !== 1) {
        player.sendMessage("You are attacked by a giant lobster!");
        spawnGiantLobster(player);
        return;
      }
      if (hasAnyMapPiece(player)) {
        player.sendMessage("You search the chest but find nothing.");
        return;
      }
      player.getInventory().adds(ItemIdentifiers.MAP_SCRAP_2, 1);
      player.sendMessage("You find a piece of a map inside the chest.");
      return;
    }
    player.sendMessage("You search the chest but find nothing.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    const option = String(
      event.definition?.getInteractions?.()?.[event.clickType - 1] ?? ""
    ).toLowerCase();
    if (CHEST_IDS.has(objectId)) {
      searchChest(event, option);
      return;
    }
    if (objectId === MAST_OBJECT_ID) {
      if (option.includes("search")) {
        event.handled = true;
        const name = (value) => COLOUR_NAMES[value] ?? "white";
        player.sendMessage(
          "You can see a tattered flag blowing in the wind. " +
            `The top half is ${name(attr(player, MAST_TOP_ATTRIBUTE))}, ` +
            `the skull emblem is ${name(attr(player, MAST_SKULL_ATTRIBUTE))}, ` +
            `and the bottom half is ${name(attr(player, MAST_BOTTOM_ATTRIBUTE))}.`
        );
      }
      return;
    }
    if (objectId === COFFIN_ID || objectId === COFFIN_OPEN_ID) {
      if (attr(player, TOMB_ATTRIBUTE) !== 1) {
        if (held(player, BONE_KEY)) {
          unlockTomb(player);
        } else {
          player.sendMessage("The tomb door is locked.");
        }
        event.handled = true;
        return;
      }
      if (option.includes("open") || option.includes("search")) {
        if (!held(player, MYSTICAL_ROBES) && attr(player, GIVEN_ROBES_ATTRIBUTE) !== 1) {
          player.getInventory().adds(MYSTICAL_ROBES, 1);
          player.sendMessage("The coffin creaks open...");
          player.sendMessage(
            "You take the Robes of Necrovarus from the remains of his mortal body."
          );
        } else {
          player.sendMessage("The coffin is empty.");
        }
        event.handled = true;
      }
      return;
    }
    if (objectId === NETTLE_OBJECT_ID && option.includes("pick")) {
      if (freeSlots(player) < 1) {
        player.sendMessage("You don't have enough inventory space.");
        return;
      }
      player.getInventory().adds(NETTLES, 1);
      player.sendMessage("You pick some nettles.");
      event.handled = true;
      return;
    }
    if (SHIPWRECK_GANGPLANKS.has(objectId)) {
      player.sendMessage("You cross the gangplank.");
      if (location) {
        const moved = location.x + (player.getLocation().getX() <= location.x ? 1 : -1);
        player.moveTo(new Location(moved, location.y, location.z));
      }
      event.handled = true;
    }
  }

  function handleNpcDeath(event) {
    const player = event.player ?? event.killer;
    if (player && event.npcId === GIANT_LOBSTER_NPC_ID) {
      setAttr(player, LOBSTER_ATTRIBUTE, 1);
    }
  }

  function grantReward(player) {
    setAttr(player, GIVEN_BOOK_ATTRIBUTE, 1);
    setAttr(player, GIVEN_MANUAL_ATTRIBUTE, 1);
    setAttr(player, GIVEN_ROBES_ATTRIBUTE, 1);
    setAttr(player, BOW_ATTRIBUTE, 8);
    setAttr(player, TOY_ATTRIBUTE, 3);
    setAttr(player, SIGNATURES_ATTRIBUTE, 10);
    setAttr(player, BURNED_ATTRIBUTE, 0);
    setAttr(player, TOMB_ATTRIBUTE, 1);
    randomizeMast(player);
  }

  for (const attribute of [
    BOW_ATTRIBUTE,
    TOY_ATTRIBUTE,
    SIGNATURES_ATTRIBUTE,
    BURNED_ATTRIBUTE,
    GIVEN_BOOK_ATTRIBUTE,
    GIVEN_MANUAL_ATTRIBUTE,
    GIVEN_ROBES_ATTRIBUTE,
    TOMB_ATTRIBUTE,
    LOBSTER_ATTRIBUTE,
    TOLD_ATTRIBUTE,
    TOY_TOP_ATTRIBUTE,
    TOY_SKULL_ATTRIBUTE,
    TOY_BOTTOM_ATTRIBUTE,
    MAST_TOP_ATTRIBUTE,
    MAST_SKULL_ATTRIBUTE,
    MAST_BOTTOM_ATTRIBUTE,
  ]) {
    api.persistAttribute(attribute);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "ghosts_ahoy",
    name: "Ghosts Ahoy",
    varpId: VARP_GHOSTS_AHOY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.PRAYER.getIndex(), amount: 2400, label: "Prayer" }],
    rewardItemId: ECTOPHIAL,
    rewardItemLabel: "An Ectophial",
    otherRewards: ["Free entry to Port Phasmatys", "Access to Dragontooth Island"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
