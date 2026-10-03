/**
 * Demon Slayer.
 *
 * Words come from npc-dialogues.json. The "Demon Slayer" page mixes every NPC
 * of the quest, so the branch is chosen by the speaker's cache id:
 *   Aris 11868, Sir Prysin 5083/5084/12622, Captain Rovin 5085/12627,
 *   Wizard Traiborn 5081, Delrith 5079, Weakened Delrith 5080.
 *
 * Variants by state:
 *   Aris        stage 0 -> starting-demon-slayer
 *               stage 1 -> starting-demon-slayer-aris-after-starting-the-quest
 *               key hunt -> getting-the-key-from-traiborn-after-talking-to-sir-prysin
 *               sword     -> getting-the-key-from-traiborn-aris-after-acquiring-the-sword
 *               complete  -> "Aris" / after-demon-slayer
 *   Sir Prysin  stage <2  -> sir-prysin
 *               key hunt -> (none|one|two keys|all three) key-progress variants
 *               sword    -> getting-the-key-from-traiborn-talking-to-sir-prysin-before-fighting-delrith
 *               complete -> "Sir Prysin" / standard-dialogue
 *   Rovin       getting-the-key-from-captain-rovin (-talking-to-captain-rovin-again-after-obtaining-the-key)
 *   Traiborn    stage 2 -> getting-the-key-from-traiborn
 *               stage 3..27 -> returning-with-no/some/the-last-of-the-bones variants
 *               stage 28 -> after-losing-the-key (key missing) / after-obtaining-the-key
 *               stage >=29 or <2 -> "Wizard Traiborn" / standard-dialogue
 *
 * This plugin supplies the variant selector, prose-condition answers, the start
 * hook, the three key hand-overs, the 25-bones hand-over and the kitchen-drain
 * interactions (search + pour water) that wash Sir Prysin's key into the sewers.
 *
 * Gaps (no dump/index support, see summary):
 *   - Delrith 5079 / Weakened Delrith 5080 are not in npc-dialogue-index.json,
 *     so "the-final-battle*" cannot be reached; the reference's incantation
 *     pick menu is not in the dump. Only the completion action is wired.
 *   - The bank-storage condition for Rovin's key is answered "not stored".
 *   - Aris 5082 and Rovin 12627 are absent from the index, so the fallback name
 *     page is used if those ids ever appear.
 */
module.exports = function registerDemonSlayerQuest(api) {
  const { Item, Location, World, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const ARIS_NPC_ID = NpcIdentifiers.ARIS;
  /** Aris' legacy cache id 5082 has no generated NpcIdentifiers member. */
  const ARIS_LEGACY_NPC_ID = 5082;
  const TRAIBORN_NPC_ID = NpcIdentifiers.WIZARD_TRAIBORN;
  const PRYSIN_NPC_IDS = new Set([
    NpcIdentifiers.SIR_PRYSIN,
    NpcIdentifiers.SIR_PRYSIN_2,
    NpcIdentifiers.SIR_PRYSIN_3,
  ]);
  const ROVIN_NPC_IDS = new Set([NpcIdentifiers.CAPTAIN_ROVIN, NpcIdentifiers.CAPTAIN_ROVIN_2]);
  const DELRITH_NPC_ID = NpcIdentifiers.DELRITH;
  const WEAKENED_DELRITH_NPC_ID = NpcIdentifiers.WEAKENED_DELRITH;

  const VARP_DEMON_SLAYER = 222;
  const STAGE_STARTED = 1;
  const STAGE_KEY_HUNT = 2;
  const STAGE_COLLECTING_BONES = 3;
  const STAGE_TRAIBORN_KEY = 28;
  const STAGE_SILVERLIGHT = 29;
  const STAGE_COMPLETE = 30;
  const BONES_REQUIRED = 25;

  const TRAIBORN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY;
  const ROVIN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY_2;
  const PRYSIN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY_3;
  const SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT;
  const BONES_ITEM_ID = ItemIdentifiers.BONES;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const EMPTY_BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const SPINACH_ROLL_ITEM_ID = ItemIdentifiers.SPINACH_ROLL;

  /** Object id 2843 has no generated ObjectIdentifiers member; value kept from the original plugin. */
  const PALACE_KITCHEN_DRAIN_OBJECT_ID = 2843;
  const DRAIN_LOC_IDS = new Set([
    PALACE_KITCHEN_DRAIN_OBJECT_ID,
    ObjectIdentifiers.DRAIN_6,
    ObjectIdentifiers.DRAIN_7,
  ]);
  const SEWER_KEY_TILE = new Location(3227, 9898, 0);

  const DRAIN_ATTRIBUTE = "demon_slayer.drain";

  const QUEST_START_HOOK = "quest:demon-slayer:start";
  const PRYSIN_INTRO_OPTION_ID = "vc9k5u";
  const ROVIN_KEY_MESSAGE_ID = "E0eUno";
  const SPINACH_ROLL_MESSAGE_ID = "OZH22x";
  const BONES_SOME_MESSAGE_ID = "Sq4znF";
  const BONES_LAST_MESSAGE_ID = "yjBusJ";
  const TRAIBORN_KEY_MESSAGE_ID = "o1N_Vv";
  const SILVERLIGHT_MESSAGE_ID = "AFDEAH";
  const QUEST_COMPLETE_ACTION_ID = "WId-ED";
  const PRYSIN_SELL_SILVERLIGHT_ACTION_ID = "p5BVZ5";
  /** Condition step id on the pre-fight page that offers Silverlight back when lost. */
  const PRYSIN_LOST_SILVERLIGHT_CONDITION_ID = "VlRPCO";
  const BONES_CHOICE_TEXT = "i'll get the bones for you.";
  const TALK_ABOUT_QUEST_TEXT = "talk about demon slayer";

  /** Correct incantation, used to fill the transcript's [word N] placeholders. */
  const INCANTATION_WORDS = ["Carlem", "Aber", "Camerinthum", "Purchai", "Gabindo"];

  /** The stone circle south of Varrock where Delrith is summoned (owner-only fight). */
  const DELRITH_ZONE = { minX: 3220, maxX: 3235, minY: 3362, maxY: 3377, levels: [0] };
  const DELRITH_TILE = { x: 3228, y: 3369, z: 0 };
  const DELRITH_WANDER_RADIUS = 2;
  const WEAKENED_DELRITH_TICKS = 100;
  const CORRECT_INCANTATION = "Carlem Aber Camerinthum Purchai Gabindo";
  const INCANTATION_OPTIONS = [
    "Carlem Gabindo Purchai Zaree Camerinthum",
    "Purchai Zaree Gabindo Carlem Camerinthum",
    "Purchai Camerinthum Aber Gabindo Carlem",
    CORRECT_INCANTATION,
  ];

  let quest;
  let itemOnGroundManager;
  let pluginApi;

  /** player -> { delrith, weakened, weakenedExpiresAt }; owner-only instanced fight. */
  const demonEncounters = new WeakMap();

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /** Inventory or equipment (Silverlight is a weapon, so can be wielded). */
  const ownsItem = (player, itemId) =>
    hasItem(player, itemId) ||
    (player.getEquipment().getItems() || []).some((item) => item && item.getId?.() === itemId);

  const hasAllKeys = (player) =>
    hasItem(player, TRAIBORN_KEY_ITEM_ID) &&
    hasItem(player, ROVIN_KEY_ITEM_ID) &&
    hasItem(player, PRYSIN_KEY_ITEM_ID);

  const carriedKeyCount = (player) =>
    [TRAIBORN_KEY_ITEM_ID, ROVIN_KEY_ITEM_ID, PRYSIN_KEY_ITEM_ID].filter((id) =>
      hasItem(player, id)
    ).length;

  const drainState = (player) => Number(player.getAttribute(DRAIN_ATTRIBUTE)) || 0;
  const setDrainState = (player, value) => player.setAttribute(DRAIN_ATTRIBUTE, value);

  /** The drained state (=2) means the key is lying in the sewer. Ground items
   * despawn after ~3 minutes, so re-place the owner's key whenever they are in the
   * sewer and it is missing; the drain stage itself is persisted on the player. */
  function inSewer(player) {
    const location = player.getLocation();
    return Math.abs(location.getX() - SEWER_KEY_TILE.getX()) <= 64
      && Math.abs(location.getY() - SEWER_KEY_TILE.getY()) <= 64;
  }

  function ensureSewerKey(player) {
    if (drainState(player) !== 2) return;
    if (hasItem(player, PRYSIN_KEY_ITEM_ID)) return;
    if (!inSewer(player)) return;
    if (itemOnGroundManager.getGroundItem(player.getUsername(), PRYSIN_KEY_ITEM_ID, SEWER_KEY_TILE)) return;
    itemOnGroundManager.registerLocation(player, new Item(PRYSIN_KEY_ITEM_ID, 1), SEWER_KEY_TILE);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Aris</col> in the",
        "<col=800000>tent in Varrock's main square</col>.",
        "",
        "I must be able to defeat an apocalyptic demon!",
      ];
    }

    const history = [
      "<str>I spoke to Aris in Varrock Square, who saw my future.</str>",
      "<str>It involved killing Delrith, who almost destroyed Varrock.</str>",
    ];
    if (stage < STAGE_KEY_HUNT) {
      return [
        ...history,
        "",
        "To defeat <col=800000>Delrith</col> I need the magical sword",
        "<col=800000>Silverlight</col>. I should speak to <col=800000>Sir Prysin</col> in Varrock Palace.",
      ];
    }
    if (stage < STAGE_SILVERLIGHT) {
      const lines = [
        ...history,
        "",
        "Sir Prysin needs three keys before he can give me Silverlight.",
        hasItem(player, PRYSIN_KEY_ITEM_ID)
          ? "<str>I have recovered Sir Prysin's key.</str>"
          : "His key was dropped down the palace kitchen drain.",
        hasItem(player, ROVIN_KEY_ITEM_ID)
          ? "<str>I have Captain Rovin's key.</str>"
          : "Captain Rovin has another key in Varrock Palace.",
      ];
      if (hasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        lines.push("<str>I have Wizard Traiborn's key.</str>");
      } else if (stage >= STAGE_COLLECTING_BONES && stage <= STAGE_TRAIBORN_KEY) {
        const given = stage - STAGE_COLLECTING_BONES;
        lines.push(
          `Wizard Traiborn still needs ${Math.max(0, BONES_REQUIRED - given)} sets of bones.`
        );
      } else {
        lines.push("Wizard Traiborn has the third key at the Wizards' Tower.");
      }
      if (hasAllKeys(player)) {
        lines.push("", "I should take all three keys back to Sir Prysin.");
      }
      return lines;
    }
    if (stage === STAGE_SILVERLIGHT) {
      return [
        ...history,
        "<str>I reclaimed Silverlight from Sir Prysin.</str>",
        "",
        "I should go to the stone circle south of Varrock and destroy",
        "<col=800000>Delrith</col> while wielding <col=800000>Silverlight</col>.",
      ];
    }
    return [
      ...history,
      "<str>I reclaimed Silverlight from Sir Prysin.</str>",
      "<str>I used it and Aris's incantation to banish Delrith.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  // Which transcript each quest NPC plays, by quest stage / keys carried.
  function selectDialogueVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: "Aris", variant: "after-demon-slayer" };
      if (stage >= STAGE_SILVERLIGHT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-aris-after-acquiring-the-sword" };
      }
      if (stage >= STAGE_KEY_HUNT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-after-talking-to-sir-prysin" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Demon Slayer", variant: "starting-demon-slayer-aris-after-starting-the-quest" };
      }
      return { page: "Demon Slayer", variant: "starting-demon-slayer" };
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return { page: "Sir Prysin", variant: "standard-dialogue" };
      if (stage >= STAGE_SILVERLIGHT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-talking-to-sir-prysin-before-fighting-delrith" };
      }
      if (stage >= STAGE_KEY_HUNT) {
        if (hasAllKeys(player)) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-to-sir-prysin-with-all-the-keys" };
        }
        const count = carriedKeyCount(player);
        if (count === 0) {
          return { page: "Demon Slayer", variant: "sir-prysin-talking-to-sir-prysin-again-before-getting-keys" };
        }
        if (count === 1) {
          return { page: "Demon Slayer", variant: "sir-prysin-returning-to-sir-prysin-with-one-key" };
        }
        return { page: "Demon Slayer", variant: "sir-prysin-talking-to-sir-prysin-with-two-keys" };
      }
      return { page: "Demon Slayer", variant: "sir-prysin" };
    }

    if (ROVIN_NPC_IDS.has(npcId)) {
      if (
        stage >= STAGE_KEY_HUNT &&
        stage < STAGE_SILVERLIGHT &&
        hasItem(player, ROVIN_KEY_ITEM_ID)
      ) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-captain-rovin-talking-to-captain-rovin-again-after-obtaining-the-key" };
      }
      return { page: "Demon Slayer", variant: "getting-the-key-from-captain-rovin" };
    }

    if (npcId === TRAIBORN_NPC_ID) {
      if (stage === STAGE_TRAIBORN_KEY && !hasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-traiborn-after-losing-the-key" };
      }
      if (stage >= STAGE_COLLECTING_BONES && stage < STAGE_TRAIBORN_KEY) {
        const needed = BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES);
        const available = Math.min(needed, player.getInventory().getAmount(BONES_ITEM_ID));
        if (available <= 0) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-no-bones-to-traiborn" };
        }
        if (available >= needed) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-the-last-of-the-bones-to-traiborn" };
        }
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-some-bones-to-traiborn" };
      }
      if (stage === STAGE_TRAIBORN_KEY) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-traiborn-after-obtaining-the-key" };
      }
      if (stage === STAGE_KEY_HUNT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn" };
      }
      // stage 0/1 and stage >= SILVERLIGHT: generic wizard talk.
      return { page: "Wizard Traiborn", variant: "standard-dialogue" };
    }

    // Only reachable if the human adds these ids to npc-dialogue-index.json.
    if (npcId === WEAKENED_DELRITH_NPC_ID) {
      return { page: "Demon Slayer", variant: "the-final-battle-after-lowering-delrith-s-hitpoints-to-0" };
    }
    if (npcId === DELRITH_NPC_ID) {
      return { page: "Demon Slayer", variant: "the-final-battle" };
    }

    return null;
  }

  // Answer the transcript's prose conditions.
  function answerDialogueCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();

    if (npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID) {
      if (value.includes("doesn't have any money")) return inventory.getAmount(COINS_ITEM_ID) < 1;
      return null;
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (value.includes("keys from traiborn and rovin")) {
        return hasItem(player, TRAIBORN_KEY_ITEM_ID) && hasItem(player, ROVIN_KEY_ITEM_ID);
      }
      if (value.includes("keys from rovin and the drain")) {
        return hasItem(player, ROVIN_KEY_ITEM_ID) && hasItem(player, PRYSIN_KEY_ITEM_ID);
      }
      if (value.includes("keys from traiborn and the drain")) {
        return hasItem(player, TRAIBORN_KEY_ITEM_ID) && hasItem(player, PRYSIN_KEY_ITEM_ID);
      }
      if (value.includes("key from captain rovin")) return hasItem(player, ROVIN_KEY_ITEM_ID);
      if (value.includes("key from wizard traiborn")) return hasItem(player, TRAIBORN_KEY_ITEM_ID);
      if (value.includes("key from the drain")) return hasItem(player, PRYSIN_KEY_ITEM_ID);
      if (value.includes("does not have silverlight")) return !ownsItem(player, SILVERLIGHT_ITEM_ID);
      if (value.includes("has silverlight")) return ownsItem(player, SILVERLIGHT_ITEM_ID);
      if (value.includes("does not have at least 500 coins")) {
        return inventory.getAmount(COINS_ITEM_ID) < 500;
      }
      if (value.includes("at least 500 coins")) {
        return inventory.getAmount(COINS_ITEM_ID) >= 500 && !inventory.isFull();
      }
      if (value.includes("lacks sufficient inventory space")) return inventory.isFull();
      return null;
    }

    if (ROVIN_NPC_IDS.has(npcId)) {
      if (value.includes("key in their inventory")) return hasItem(player, ROVIN_KEY_ITEM_ID);
      // ponytail: no bank lookup; treat the key as not stored in a bank.
      if (value.includes("key in their bank")) return false;
      return null;
    }

    return null;
  }

  // The dump keeps wiki placeholders in a few spoken lines; render them.
  function renderDialogueLine(event) {
    const text = String(event.text || "");
    if (event.npcId === TRAIBORN_NPC_ID && text.includes("[25-X]")) {
      event.skip = true;
      const stage = quest.getStage(event.player);
      const remaining = Math.max(0, BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES));
      event.player.sendMessage(
        `I still need ${remaining} more set${remaining === 1 ? "" : "s"}.`
      );
      return;
    }
    if ((event.npcId === ARIS_NPC_ID || event.npcId === ARIS_LEGACY_NPC_ID) && text.includes("[word")) {
      event.skip = true;
      event.player.sendMessage(
        text.replace(/\[word (\d)\]/g, (_, index) => INCANTATION_WORDS[Number(index) - 1])
      );
    }
  }

  // Option choices that carry no action id in the dump but gate quest state.
  function handleDialogueChoice({ player, npcId, option, stepId }) {
    if (stepId === PRYSIN_INTRO_OPTION_ID && PRYSIN_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_STARTED && stage < STAGE_KEY_HUNT) {
        quest.setStage(player, STAGE_KEY_HUNT);
        if (drainState(player) < 1) setDrainState(player, 1);
      }
      return;
    }
    if (npcId !== TRAIBORN_NPC_ID) return;
    const text = String(option || "").toLowerCase();
    if (text === BONES_CHOICE_TEXT) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_KEY_HUNT && stage < STAGE_COLLECTING_BONES) {
        quest.setStage(player, STAGE_COLLECTING_BONES);
      }
      return;
    }
    if (text.includes(TALK_ABOUT_QUEST_TEXT)) {
      const stage = quest.getStage(player);
      if (stage === STAGE_TRAIBORN_KEY && !hasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        quest.setStage(player, STAGE_COLLECTING_BONES);
      }
    }
  }

  // "Demon Slayer is started." carries this slug; the reading cost 1 coin.
  function handleDialogueHook({ player, npcId, hook }) {
    if (hook !== QUEST_START_HOOK) return;
    if (npcId !== ARIS_NPC_ID && npcId !== ARIS_LEGACY_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    if (player.getInventory().getAmount(COINS_ITEM_ID) > 0) {
      player.getInventory().deleteNumber(COINS_ITEM_ID, 1);
    }
  }

  // Key and bone hand-overs keyed off the transcript's message/action ids.
  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;

    if (stepId === ROVIN_KEY_MESSAGE_ID && ROVIN_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (
        !hasItem(player, ROVIN_KEY_ITEM_ID) &&
        stage >= STAGE_KEY_HUNT &&
        stage < STAGE_SILVERLIGHT &&
        !player.getInventory().isFull()
      ) {
        player.getInventory().adds(ROVIN_KEY_ITEM_ID, 1);
      } else {
        event.handled = true;
      }
      return;
    }

    if (npcId === TRAIBORN_NPC_ID) {
      if (stepId === SPINACH_ROLL_MESSAGE_ID) {
        if (!player.getInventory().isFull()) player.getInventory().adds(SPINACH_ROLL_ITEM_ID, 1);
        return; // leave the transcript's own message to play
      }
      if (stepId === BONES_SOME_MESSAGE_ID || stepId === BONES_LAST_MESSAGE_ID) {
        const stage = quest.getStage(player);
        if (stage < STAGE_COLLECTING_BONES || stage >= STAGE_TRAIBORN_KEY) {
          event.handled = true;
          return;
        }
        const needed = BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES);
        const available = Math.min(needed, player.getInventory().getAmount(BONES_ITEM_ID));
        if (available <= 0) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(BONES_ITEM_ID, available);
        quest.setStage(player, stage + available);
        player.sendMessage(
          `You give Traiborn ${available} set${available === 1 ? "" : "s"} of bones.`
        );
        event.handled = true;
        event.end = false;
        return;
      }
      if (stepId === TRAIBORN_KEY_MESSAGE_ID) {
        const stage = quest.getStage(player);
        if (
          !hasItem(player, TRAIBORN_KEY_ITEM_ID) &&
          stage >= STAGE_TRAIBORN_KEY &&
          !player.getInventory().isFull()
        ) {
          player.getInventory().adds(TRAIBORN_KEY_ITEM_ID, 1);
        }
        return; // leave "Traiborn hands you a key." to play
      }
      return;
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (stepId === SILVERLIGHT_MESSAGE_ID) {
        if (!ownsItem(player, SILVERLIGHT_ITEM_ID) && hasAllKeys(player)) {
          player.getInventory().deleteNumber(TRAIBORN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(ROVIN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(PRYSIN_KEY_ITEM_ID, 1);
          player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
          quest.setStage(player, STAGE_SILVERLIGHT);
          setDrainState(player, 3);
        }
        return; // leave the transcript's own message to play
      }
      if (stepId === PRYSIN_SELL_SILVERLIGHT_ACTION_ID) {
        if (
          player.getInventory().getAmount(COINS_ITEM_ID) >= 500 &&
          !ownsItem(player, SILVERLIGHT_ITEM_ID) &&
          !player.getInventory().isFull()
        ) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, 500);
          player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
        }
        event.handled = true;
        return;
      }
      return;
    }

    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_SILVERLIGHT && stage < STAGE_COMPLETE) quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  // The lost-Silverlight branch of the pre-fight dialogue gives it back.
  function restoreSilverlightCondition({ player, npcId, stepId }) {
    if (!PRYSIN_NPC_IDS.has(npcId) || stepId !== PRYSIN_LOST_SILVERLIGHT_CONDITION_ID) return;
    if (ownsItem(player, SILVERLIGHT_ITEM_ID) || player.getInventory().isFull()) return;
    player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_SILVERLIGHT) quest.setStage(player, STAGE_SILVERLIGHT);
    player.sendMessage("Sir Prysin returns Silverlight.");
  }

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  function searchDrain(event) {
    if (!DRAIN_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_KEY_HUNT) {
      player.sendMessage("You can see a key in the drain, but you cannot quite reach it.");
    } else if (stage >= STAGE_SILVERLIGHT || hasItem(player, PRYSIN_KEY_ITEM_ID)) {
      player.sendMessage("Nothing interesting seems to have been dropped down here today.");
    } else if (drainState(player) >= 2) {
      player.sendMessage("The key has been washed into the sewer.");
    } else {
      player.sendMessage(
        "You can see a key, but it is stuck just out of reach. Perhaps water could dislodge it."
      );
    }
    event.handled = true;
  }

  function pourWaterOnDrain(event) {
    if (event.itemId !== BUCKET_OF_WATER_ITEM_ID || !DRAIN_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    if (quest.getStage(player) >= STAGE_SILVERLIGHT) {
      player.sendMessage("There is no reason to pour water there.");
      event.handled = true;
      return;
    }
    if (player.getInventory().getAmount(BUCKET_OF_WATER_ITEM_ID) <= 0) return;
    player.getInventory().deleteNumber(BUCKET_OF_WATER_ITEM_ID, 1);
    player.getInventory().adds(EMPTY_BUCKET_ITEM_ID, 1);
    player.sendMessage("You pour the water down the drain.");
    event.handled = true;
    if (hasItem(player, PRYSIN_KEY_ITEM_ID)) return;
    if (drainState(player) < 2) {
      setDrainState(player, 2);
    }
    ensureSewerKey(player);
    player.sendMessage(
      "The key washes into the sewer. You should retrieve it before somebody else does."
    );
  }

  function handlePlayerProcess({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    ensureSewerKey(player);
    if (!isInsideZone(DELRITH_ZONE, player.getLocation())) return;

    const tracked = demonEncounters.get(player);
    if (
      tracked?.weakened &&
      tracked.weakenedExpiresAt !== undefined &&
      World.getProcessCycle() >= tracked.weakenedExpiresAt
    ) {
      pluginApi.removeNpc(tracked.weakened);
      tracked.weakened = null;
      demonEncounters.set(player, tracked);
    }
    // Silverlight must stay wielded: unequipping despawns the un-weakened Delrith.
    if (tracked?.delrith && !silverlightEquipped(player)) {
      pluginApi.removeNpc(tracked.delrith);
      tracked.delrith = null;
      demonEncounters.set(player, tracked);
    }
    ensureDelrith(player);
  }

  /** The stone circle the fight happens in (levels empty = all planes). */
  function isInsideZone(zone, location) {
    const x = location.getX();
    const y = location.getY();
    const z = location.getZ();
    return (
      x >= zone.minX &&
      x <= zone.maxX &&
      y >= zone.minY &&
      y <= zone.maxY &&
      (!zone.levels || zone.levels.includes(z))
    );
  }

  function silverlightEquipped(player) {
    return (player.getEquipment().getItems() || []).some(
      (item) => item && item.getId?.() === SILVERLIGHT_ITEM_ID
    );
  }

  /**
   * Delrith only appears in the stone circle once the player has Silverlight
   * wielded (quest stage SILVERLIGHT). The fight is owner-only: the spawned NPC is
   * hidden from, and never aggressive to, anyone but its owner.
   */
  function ensureDelrith(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (quest.getStage(player) !== STAGE_SILVERLIGHT) return;
    if (!silverlightEquipped(player)) return;
    const tracked = demonEncounters.get(player);
    if (tracked?.delrith || tracked?.weakened) return;
    const npc = pluginApi.spawnNpc({
      id: DELRITH_NPC_ID,
      x: DELRITH_TILE.x,
      y: DELRITH_TILE.y,
      z: DELRITH_TILE.z,
      wanderRadius: DELRITH_WANDER_RADIUS,
      owner: player,
      ownerOnly: true,
    });
    if (npc) demonEncounters.set(player, { ...(tracked ?? {}), delrith: npc });
  }

  function spawnWeakenedDelrith(player, tile) {
    const npc = pluginApi.spawnNpc({
      id: WEAKENED_DELRITH_NPC_ID,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    const tracked = demonEncounters.get(player) ?? {};
    tracked.delrith = null;
    tracked.weakened = npc;
    tracked.weakenedExpiresAt = World.getProcessCycle() + WEAKENED_DELRITH_TICKS;
    demonEncounters.set(player, tracked);
  }

  function clearDemonEncounter(player) {
    const tracked = demonEncounters.get(player);
    if (!tracked) return;
    if (tracked.delrith) pluginApi.removeNpc(tracked.delrith);
    if (tracked.weakened) pluginApi.removeNpc(tracked.weakened);
    demonEncounters.delete(player);
  }

  function handleDelrithZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    ensureDelrith(player);
  }

  function handleDelrithZoneExit({ player }) {
    if (!player) return;
    clearDemonEncounter(player);
  }

  /** Delrith never dies: killing him swaps in the weakened form to be banished. */
  function handleDelrithBeforeDeath(event) {
    const npc = event?.npc;
    if (!npc || npc.getId?.() !== DELRITH_NPC_ID) return;
    const owner = npc.getOwner?.();
    if (!owner || quest.getStage(owner) !== STAGE_SILVERLIGHT) return;
    const tracked = demonEncounters.get(owner);
    if (!tracked || tracked.delrith !== npc) return;
    const location = npc.getLocation();
    pluginApi.removeNpc(npc);
    tracked.delrith = null;
    demonEncounters.set(owner, tracked);
    spawnWeakenedDelrith(owner, { x: location.getX(), y: location.getY(), z: location.getZ() });
    owner.sendMessage("Delrith is weakened. Use the Banish option and recite the incantation!");
    event.preventDeath = true;
  }

  function chooseIncantation(player, npc, incantation) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    pluginApi.removeNpc(npc);
    tracked.weakened = null;
    demonEncounters.set(player, tracked);
    if (incantation === CORRECT_INCANTATION) {
      demonEncounters.delete(player);
      player.sendMessage("As you chant, Delrith is sucked towards the vortex...");
      player.sendMessage("Back to the dark dimension from which he came.");
      quest.complete(player);
      return;
    }
    player.sendMessage("Suddenly the vortex collapses. That was the wrong incantation.");
    ensureDelrith(player);
  }

  function banishWeakenedDelrith({ player, npc }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    const pairs = [];
    for (const incantation of INCANTATION_OPTIONS) {
      pairs.push(incantation, () => chooseIncantation(player, npc, incantation));
    }
    pluginApi.sendMultiChatboxPrompt(player, "Now what was that incantation again?", ...pairs);
  }

  function handlePlayerLogout({ player }) {
    if (player) clearDemonEncounter(player);
  }

  function handlePlayerLogin({ player }) {
    refreshQuestList(player);
    ensureSewerKey(player);
  }

  quest = registerQuest(api, {
    key: "demon_slayer",
    name: "Demon Slayer",
    varpId: VARP_DEMON_SLAYER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    scrollItemId: SILVERLIGHT_ITEM_ID,
    rewardItemLabel: "Silverlight",
    buildJournal,
  });

  itemOnGroundManager = api.getItemOnGroundManager();
  pluginApi = api;
  api.persistAttribute(DRAIN_ATTRIBUTE);

  api.onNpcDialogueVariant(selectDialogueVariant);
  api.onNpcDialogueCondition(answerDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", renderDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:condition", restoreSilverlightCondition);

  // Delrith: owner-only summon in the stone circle, weaken then banish.
  api.onZoneEnter(DELRITH_ZONE, handleDelrithZoneEnter);
  api.onZoneExit(DELRITH_ZONE, handleDelrithZoneExit);
  api.onNpcBeforeDeath(handleDelrithBeforeDeath);
  api.onNpcInteraction("Weakened Delrith", { Banish: banishWeakenedDelrith });

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  api.onObjectInteraction(searchDrain);
  api.onItemOnObject(pourWaterOnDrain, { noted: false });

  api.onPlayerLogin(handlePlayerLogin);
  api.onPlayerLogout(handlePlayerLogout);
  api.onPlayerProcess(handlePlayerProcess);
};
