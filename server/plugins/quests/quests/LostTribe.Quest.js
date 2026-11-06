/**
 * The Lost Tribe (members).
 *
 * The words come from the "The Lost Tribe" transcript page; this plugin supplies the
 * per-stage variant choice for the shared Lumbridge/Varrock/Goblin Village NPCs, the
 * prose-condition answers (Dragon Slayer/Rune Mysteries completion, the goblin bow,
 * the chest key, the missing treaty), the cellar dig + tunnel squeeze-through, the
 * brooch, the goblin symbol book, Sigmund's pickpocket/chest, the H.A.M. crate, the
 * treaty hand-in and the signing cutscene.
 *
 * Native progress is published in varbit 532 (lost_tribe_quest, varp 465, bits 0-10; dumped with
 * `lookup-gameval varbit lost_tribe`). The cache's own multi-locs read it directly:
 * cellar wall 6898/6899 -> 6904 shelves (0) / 6903 rubble (1-3) / 6905 hole (4-12) /
 * nothing (13+), floor 6900 -> 6902 rubble (1-10). The legacy saved stages below
 * retain gameplay/old-save compatibility; nativeProgress maps them to the cache/QH
 * phases, whose completion is 11:
 *
 *   0 not started
 *   1 asking around Lumbridge about the cellar
 *   2 telling the Duke what Bob saw
 *   3 permission given, dig the rubble (needs a pickaxe)
 *   4 tunnel open, find the brooch (ground item at 3224,9616)
 *   5 show the brooch to the Duke
 *   6 take the brooch to Reldo in Varrock
 *   7 find "A History of the Goblin Race" on the library bookcase
 *   8 ask the goblin generals about the Dorgeshuun, then return to the tunnel
 *   9 met Mistag; the Duke reports the missing silverware and Sigmund's H.A.M. plot
 *   10 silverware returned, Duke signs the peace treaty
 *   11 escorted by Kazgar; deliver the treaty to Mistag
 *   12 complete
 * These saved stages are mapped to native phases 0..11; the generals' message
 * records their emote lesson, and contact records the Duke's silverware request.
 *
 * Side progress is kept in persisted attributes and mirrored to the cache side varbits
 * on every change (and on login, because client varps are per-session):
 *   varbit 534 ham (13-14): 1 H.A.M. robes found, 2 silverware found
 *   varbit 537 contact (17-18): 1 met Mistag, 2 told the Duke about the cave goblins
 *   varbit 535 mistag_denial: first (panic) greeting seen
 *   varbit 538 hole_2_dug: deep hole at 3224,9601 squeezed through
 *   varbit 541 bookmark (22-24): goblin symbol book read
 *   varbit 533 returned_brooch: brooch returned to Mistag for a mining helmet
 *   varbits 536 maze_warned, 539 sigmund_accused, 540 sigmund_leaving are unused by
 *   this server's map and left at 0.
 *
 * Sources: OSRS Wiki "The Lost Tribe", its Quick guide and Transcript page, plus the
 * cache (object/NPC transforms, varbits, placements) for all ids and tiles.
 *
 * Gaps / approximations:
 *  - The emotes are always available in this server and emote clicks cannot be observed
 *    (the Emotes plugin claims the interface button first), so Mistag's goblin-bow
 *    condition keys off the panic greeting having already happened: talk once (panic),
 *    he bows next talk.
 *  - The maze has no trap state here; the dirt tunnel is walkable end to end, so wrong
 *    paths cost nothing (no swamp gas, no pit) and the symbol rocks keep their default
 *    Look-at.
 *  - No light-source requirement is enforced; 17 Mining, 13 Agility and 13
 *    Thieving are checked at the start, and Sigmund's pickpocket re-checks 13
 *    Thieving.
 *  - The H.A.M. trapdoor is opened by swapping 6434 -> 6435 (open trapdoor) for the
 *    whole world; Ladders/ClimbLinks handle the climb itself.
 *  - Sigmund's post-firing spawn (6290 -> 5323) also stands around the H.A.M. hideout
 *    at stages 10-12; talking there replays "Sigmund is ignoring you.".
 *  - Sigmund's chest and the post-quest brooch -> mining helmet exchange are included;
 *    the chest's already-searched wording is this plugin's own line.
 */
module.exports = function registerLostTribeQuest(api) {
  const {
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const mining = require("../../skills/Mining.plugin.js");

  const PAGE = "The Lost Tribe";

  const VARP = 465; // "lost_tribe"
  const VARBIT_STAGE = 532; // lost_tribe_quest, bits 0-10
  const VARBIT_RETURNED_BROOCH = 533;
  const VARBIT_HAM = 534; // bits 13-14
  const VARBIT_GREETED = 535; // lost_tribe_mistag_denial
  const VARBIT_CONTACT = 537; // bits 17-18
  const VARBIT_HOLE2 = 538; // lost_tribe_hole_2_dug
  const VARBIT_BOOKMARK = 541; // bits 22-24

  const STAGE_ASK_PEOPLE = 1;
  const STAGE_TELL_DUKE = 2;
  const STAGE_DIG = 3;
  const STAGE_FIND_BROOCH = 4;
  const STAGE_SHOW_BROOCH = 5;
  const STAGE_FIND_RELDO = 6;
  const STAGE_FIND_BOOK = 7;
  const STAGE_FIND_GENERALS = 8;
  const STAGE_MISTAG = 9;
  const STAGE_TREATY = 10;
  const STAGE_ESCORTED = 11;
  const STAGE_COMPLETE = 12;

  const EMOTES_TAUGHT_ATTRIBUTE = "lost-tribe:emotes-taught";
  const EMOTES_TAUGHT_MESSAGE_ID = "msb9X3"; // the generals demonstrate both goblin greetings
  const BITS_ATTRIBUTE = "quest.the_lost_tribe.bits";
  const HAM_ATTRIBUTE = "quest.the_lost_tribe.ham"; // 0..2
  const CONTACT_ATTRIBUTE = "quest.the_lost_tribe.contact"; // 0..2
  const BIT_RETURNED_BROOCH = 1 << 0;
  const BIT_GREETED = 1 << 1;
  const BIT_BOOKMARK = 1 << 2;
  const BIT_HOLE2 = 1 << 3;

  const SIGMUND_ID = NpcIdentifiers.SIGMUND_13; // 5322, Lumbridge Castle
  const SIGMUND_HAM_ID = NpcIdentifiers.SIGMUND_14; // 5323, H.A.M. hideout after the firing
  const SIGMUND_IDS = new Set([SIGMUND_ID, SIGMUND_HAM_ID]);
  const DUKE_HORACIO_ID = NpcIdentifiers.DUKE_HORACIO; // 815
  const COOK_ID = NpcIdentifiers.COOK_7; // 4626
  const HANS_ID = NpcIdentifiers.HANS; // 3105
  const BOB_ID = NpcIdentifiers.BOB_15; // 10619
  const RELDO_IDS = new Set([NpcIdentifiers.RELDO, NpcIdentifiers.RELDO_2]); // 4242/4243
  const GENERAL_IDS = new Set([
    NpcIdentifiers.GENERAL_BENTNOZE, // 669
    NpcIdentifiers.GENERAL_WARTFACE, // 670
    NpcIdentifiers.GENERAL_WARTFACE_5, // 3391
    NpcIdentifiers.GENERAL_BENTNOZE_5, // 3392
    NpcIdentifiers.GENERAL_BENTNOZE_6, // 5149
    NpcIdentifiers.GENERAL_WARTFACE_6, // 5150
  ]);
  const MISTAG_IDS = new Set([
    NpcIdentifiers.MISTAG, // 5328
    NpcIdentifiers.MISTAG_2, // 7297 (before contact)
    NpcIdentifiers.MISTAG_3, // 7298 (met Mistag)
    NpcIdentifiers.MISTAG_4, // 7299 (after the quest)
  ]);

  const HAM_TRAPDOOR_CLOSED = ObjectIdentifiers.TRAPDOOR_35; // 6434, 3118,3244
  const HAM_TRAPDOOR_OPEN = ObjectIdentifiers.TRAPDOOR_36; // 6435, Climb-down
  const HAM_LADDER = ObjectIdentifiers.LADDER_67; // 6436, 3118,9643
  const SIGMUND_CHEST = ObjectIdentifiers.CHEST_38; // 6910, 3209,3217,1
  const HAM_CRATE = ObjectIdentifiers.CRATE_65; // 6911, 3152,9645
  const LIBRARY_BOOKCASE = ObjectIdentifiers.BOOKCASE_25; // 6916, 3207,3496

  const BROOCH_TILE = { x: 3224, y: 9616 };
  const CELLAR_WALL_TILES = new Set(["3219,9618", "3221,9618"]);
  const DEEP_HOLE_TILE = "3224,9601";
  const LIBRARY_BOOKCASE_TILE = "3207,3496,0";
  const SIGMUND_CHEST_TILE = "3209,3217,1";
  const HAM_CRATE_TILE = "3152,9645,0";
  const HAM_TRAPDOOR_TILE = "3118,3244,0";
  const HAM_LADDER_TILE = "3118,9643,0";
  const HAM_HIDEOUT_LANDING = { x: 3119, y: 9643 };
  const HAM_SURFACE_LANDING = { x: 3119, y: 3244 };
  const LUMBRIDGE_LANDING = { x: 3209, y: 3214 };
  const MISTAG_LANDING = { x: 3319, y: 9616 };

  const HAM_ROBE_SET = [
    ItemIdentifiers.HAM_HOOD, // 4302
    ItemIdentifiers.HAM_ROBE, // 4300
    ItemIdentifiers.HAM_CLOAK, // 4304
  ];

  // Condition step ids on the "The Lost Tribe" page (and the chest/key pair).
  const BOW_CONDITION_ID = "Ds1-NK";
  const SALUTE_CONDITION_ID = "h2U7Gc";
  const KEY_CONDITION_ID = "oEnj9o";
  const NO_KEY_CONDITION_ID = "Xjjjh9";
  const NO_TREATY_CONDITION_ID = "cXIAOU";
  const DRAGON_SLAYER_CONDITION_ID = "PbfBX1";
  const RUNE_MYSTERIES_CONDITION_ID = "We9PoA";
  /** Kazgar's water-mill option needs Death to the Dorgeshuun, which this server lacks. */
  const WATERMILL_OPTION_CONDITION_ID = "UEIaPX";
  // Action / message step ids.
  const TAKE_BOOK_ACTION_ID = "ThLyr1";
  const READ_PAGES_ACTION_ID = "8WepSb";
  const WAY_OUT_ACTION_ID = "yWjjdW";
  const POST_QUEST_WAY_OUT_ACTION_ID = "uzpbCL";
  const ROBES_FOUND_ACTION_ID = "RCYXcm";
  const SILVERWARE_FOUND_ACTION_ID = "EMSHq8";
  const TREATY_SIGNED_ACTION_ID = "N5kpDk";
  const CUTSCENE_START_ACTION_ID = "oIhMoa";
  const CUTSCENE_COMPLETE_ACTION_ID = "_c-03w";
  const KAZGAR_ESCORT_ACTION_ID = "m471ps";
  const BROOCH_HELMET_ACTION_ID = "a-40GY";

  const START_HOOK = "quest:the-lost-tribe:start";

  const BOB_RUMOUR_LINE = "If you can convince the Duke";
  const DUKE_BOB_LINE = "Bob says he saw something in the cellar. Like a goblin with big eyes.";
  const DUKE_RELDO_LINE = "librarian in Varrock";
  const RELDO_BOOK_LINE = "book about ancient goblin tribes";
  const DUKE_SILVERWARE_LINE = "Unless it is returned";

  let quest;

  /** Transient flag for the greeting conversation now playing (never persisted). */
  const greetingFirst = new WeakMap();

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
    refreshSideVarbits(player);
  }

  function getHam(player) {
    return Number(player.getAttribute(HAM_ATTRIBUTE)) || 0;
  }

  function setHam(player, value) {
    player.setAttribute(HAM_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_HAM, value | 0);
  }

  function getContact(player) {
    return Number(player.getAttribute(CONTACT_ATTRIBUTE)) || 0;
  }

  function setContact(player, value) {
    player.setAttribute(CONTACT_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_CONTACT, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_STAGE, nativeProgress(quest.getStage(player), player));
  }

  function nativeProgress(stage, player) {
    if (stage >= STAGE_COMPLETE) return 11;
    if (stage >= STAGE_TREATY) return 10;
    if (stage === STAGE_MISTAG) return getContact(player) >= 2 ? 9 : 8;
    if (stage === STAGE_FIND_GENERALS) {
      // Old saves already at Mistag have durable greeting/contact evidence of this checkpoint.
      return player.getAttribute(EMOTES_TAUGHT_ATTRIBUTE) === true
        || hasBit(player, BIT_GREETED) || getContact(player) > 0 ? 7 : 6;
    }
    if (stage >= STAGE_FIND_RELDO) return 5;
    if (stage === STAGE_SHOW_BROOCH) return 4;
    return stage;
  }

  function refreshSideVarbits(player) {
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_STAGE, nativeProgress(quest.getStage(player), player));
    packet.sendVarbit(VARBIT_RETURNED_BROOCH, hasBit(player, BIT_RETURNED_BROOCH) ? 1 : 0);
    packet.sendVarbit(VARBIT_HAM, getHam(player));
    packet.sendVarbit(VARBIT_GREETED, hasBit(player, BIT_GREETED) ? 1 : 0);
    packet.sendVarbit(VARBIT_CONTACT, getContact(player));
    packet.sendVarbit(VARBIT_HOLE2, hasBit(player, BIT_HOLE2) ? 1 : 0);
    packet.sendVarbit(VARBIT_BOOKMARK, hasBit(player, BIT_BOOKMARK) ? 1 : 0);
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function giveItem(player, itemId, amount = 1) {
    if (freeSlots(player) < 1) {
      player.getInventory().full();
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function hasQuest(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Plays a named variant through NpcDialogues; falls back to the runtime replay. */
  function playVariant(player, npcId, variant, select) {
    const request = { player, npcId, variant, select, handled: false };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (!request.handled) startTranscript(api, player, npcId, PAGE, variant);
  }

  /** The resolved object id when multi-locs are involved (event.definition is resolved). */
  function resolvedObjectId(event) {
    return event.definition?.id ?? event.objectId;
  }

  function tileKey(location, withZ = false) {
    if (!location) return "";
    return withZ
      ? `${location.x},${location.y},${location.z | 0}`
      : `${location.x},${location.y}`;
  }

  /** Mirrors the player through the two-tile cellar wall (steps 3 in x). */
  function stepThroughX(player, location) {
    const current = player.getLocation();
    const destination =
      current.getX() <= location.x
        ? new Location(location.x + 3, location.y, current.getZ())
        : new Location(location.x - 3, location.y, current.getZ());
    player.moveTo(destination);
  }

  /** Mirrors the player through a wall that runs east-west (steps in y). */
  function stepThroughY(player, location) {
    const current = player.getLocation();
    const destination =
      current.getY() <= location.y
        ? new Location(location.x, location.y + 2, current.getZ())
        : new Location(location.x, location.y - 2, current.getZ());
    player.moveTo(destination);
  }

  function ensureBrooch(player) {
    if (quest.getStage(player) !== STAGE_FIND_BROOCH) return;
    if (held(player, ItemIdentifiers.BROOCH)) return;
    const tile = new Location(BROOCH_TILE.x, BROOCH_TILE.y, 0);
    const manager = api.getItemOnGroundManager();
    if (manager.getGroundItem(player.getUsername(), ItemIdentifiers.BROOCH, tile)) return;
    manager.registerLocation(player, new Item(ItemIdentifiers.BROOCH, 1), tile);
  }

  // ==========================================================================
  // NPC dialogue
  // ==========================================================================

  function talkSigmund(event) {
    const { player, npcId } = event;
    if (!SIGMUND_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    let variant;
    if (npcId === SIGMUND_HAM_ID) {
      if (stage < STAGE_TREATY) return false;
      variant = "resolving-tensions-returning-the-silverware-attempting-to-talk-to-sigmund";
    } else if (stage === 0) {
      variant = "a-hole-in-the-wall-the-duke-s-adviser";
    } else if (stage === STAGE_ASK_PEOPLE) {
      variant = "a-hole-in-the-wall-the-duke-s-adviser-talking-to-sigmund-again-after-starting-the-quest";
    } else if (stage === STAGE_TELL_DUKE) {
      variant = "a-hole-in-the-wall-asking-bob-talking-to-sigmund-after-talking-to-bob";
    } else if (stage === STAGE_DIG) {
      variant = "a-hole-in-the-wall-convincing-horacio-talking-to-sigmund-again";
    } else if (stage <= STAGE_FIND_RELDO) {
      variant = "a-hole-in-the-wall-opening-the-tunnel-talking-to-sigmund-after-opening-the-tunnel";
    } else if (stage === STAGE_FIND_BOOK) {
      variant = "investigation-a-history-of-the-goblin-race-talking-to-sigmund";
    } else if (stage === STAGE_FIND_GENERALS) {
      variant = "investigation-the-goblin-generals-speaking-to-sigmund-after-the-goblin-generals";
    } else if (stage === STAGE_MISTAG) {
      const ham = getHam(player);
      variant =
        ham >= 2
          ? "resolving-tensions-talking-to-sigmund-before-returning-the-silverware"
          : ham === 1
            ? "property-recovery-asking-sigmund-about-h-a-m"
            : "property-recovery-talking-to-sigmund";
    } else {
      return false;
    }
    playVariant(player, npcId, variant);
    return true;
  }

  function pickpocketSigmund(event) {
    const { player, npcId } = event;
    if (npcId !== SIGMUND_ID) return false;
    if (quest.getStage(player) !== STAGE_MISTAG || getContact(player) < 2) {
      player.sendMessage("You have no reason to pick his pocket right now.");
      return true;
    }
    if (held(player, ItemIdentifiers.KEY_10)) {
      player.sendMessage("You already have his key.");
      return true;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 13) {
      player.sendMessage("You need a Thieving level of at least 13 to pick this pocket.");
      return true;
    }
    if (!giveItem(player, ItemIdentifiers.KEY_10)) return true;
    player.sendMessage("You steal a little key.");
    return true;
  }

  function talkDuke(event) {
    const { player, npcId } = event;
    if (npcId !== DUKE_HORACIO_ID) return false;
    const stage = quest.getStage(player);
    const contact = getContact(player);
    const ham = getHam(player);
    let variant;
    if (stage === STAGE_ASK_PEOPLE) {
      variant = "a-hole-in-the-wall-asking-the-duke";
    } else if (stage === STAGE_TELL_DUKE) {
      variant = "a-hole-in-the-wall-convincing-horacio";
    } else if (stage === STAGE_DIG) {
      variant = "a-hole-in-the-wall-convincing-horacio-talking-to-the-duke-again";
    } else if (stage === STAGE_FIND_BROOCH || stage === STAGE_FIND_RELDO) {
      variant = "a-hole-in-the-wall-opening-the-tunnel-talking-to-the-duke-after-opening-the-tunnel";
    } else if (stage === STAGE_SHOW_BROOCH) {
      variant = "a-hole-in-the-wall-showing-the-brooch-to-the-duke";
    } else if (stage === STAGE_FIND_BOOK) {
      variant = "investigation-a-history-of-the-goblin-race-talking-to-the-duke";
    } else if (stage === STAGE_FIND_GENERALS) {
      variant = "investigation-the-goblin-generals-speaking-to-duke-horacio-after-the-goblin-generals";
    } else if (stage === STAGE_MISTAG) {
      variant =
        ham >= 2 && held(player, ItemIdentifiers.SILVERWARE)
          ? "resolving-tensions-returning-the-silverware"
          : ham === 1
            ? "property-recovery-telling-the-duke-about-sigmund-s-h-a-m-loving-ways"
            : contact < 2
              ? "meeting-the-lost-tribe-informing-duke-horacio-sigmund"
              : "property-recovery-talking-to-the-duke-again";
    } else if (stage === STAGE_TREATY || stage === STAGE_ESCORTED) {
      variant = "resolving-tensions-returning-the-silverware-talking-to-duke-horacio-again";
    } else {
      return false;
    }
    playVariant(player, npcId, variant);
    return true;
  }

  function talkCook(event) {
    const { player, npcId } = event;
    if (npcId !== COOK_ID || quest.getStage(player) !== STAGE_ASK_PEOPLE) return false;
    playVariant(player, npcId, "a-hole-in-the-wall-asking-the-cook");
    return true;
  }

  function talkHans(event) {
    const { player, npcId } = event;
    if (npcId !== HANS_ID || quest.getStage(player) !== STAGE_ASK_PEOPLE) return false;
    playVariant(player, npcId, "a-hole-in-the-wall-asking-hans");
    return true;
  }

  function talkBob(event) {
    const { player, npcId } = event;
    if (npcId !== BOB_ID) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_ASK_PEOPLE) {
      playVariant(player, npcId, "a-hole-in-the-wall-asking-bob");
      return true;
    }
    if (stage === STAGE_TELL_DUKE) {
      playVariant(player, npcId, "a-hole-in-the-wall-asking-bob-talking-to-bob-again");
      return true;
    }
    return false;
  }

  function talkReldo(event) {
    const { player, npcId } = event;
    if (!RELDO_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage !== STAGE_FIND_RELDO && stage !== STAGE_FIND_BOOK) return false;
    playVariant(player, npcId, "investigation-talking-to-reldo");
    return true;
  }

  function talkGenerals(event) {
    const { player, npcId } = event;
    if (!GENERAL_IDS.has(npcId) || quest.getStage(player) !== STAGE_FIND_GENERALS) return false;
    playVariant(player, npcId, "investigation-the-goblin-generals");
    return true;
  }

  /** The friendly half of the greetings transcript, without the panic + end before it. */
  function greetingConditionSteps(steps) {
    return steps.filter((step) => step.type === "condition");
  }

  function talkMistag(event) {
    const { player, npcId } = event;
    if (!MISTAG_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_FIND_GENERALS) {
      const first = !hasBit(player, BIT_GREETED);
      if (first) setBit(player, BIT_GREETED);
      greetingFirst.set(player, first);
      playVariant(player, npcId, "meeting-the-lost-tribe-greetings", first ? undefined : greetingConditionSteps);
      greetingFirst.delete(player);
      return true;
    }
    if (stage === STAGE_MISTAG) {
      playVariant(
        player,
        npcId,
        getContact(player) < 2
          ? "meeting-the-lost-tribe-talking-to-mistag-after-first-contact"
          : "property-recovery-asking-mistag-about-the-silverware"
      );
      return true;
    }
    if (stage === STAGE_TREATY || stage === STAGE_ESCORTED) {
      playVariant(
        player,
        npcId,
        held(player, ItemIdentifiers.PEACE_TREATY)
          ? "resolving-tensions-delivering-the-treaty"
          : "meeting-the-lost-tribe-talking-to-mistag-after-first-contact"
      );
      return true;
    }
    return false;
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!MISTAG_IDS.has(npcId) || !quest.isComplete(player)) return;
    if (itemId !== ItemIdentifiers.BROOCH) return;
    event.handled = true;
    if (hasBit(player, BIT_RETURNED_BROOCH)) {
      playVariant(player, npcId, "standard-dialogue-using-a-brooch-on-him-again");
      return;
    }
    // The unlit helmet (5014), as Miltog's shop and the cave goblin miners give it. INFERRED: no capture of this
    // reward, and the Wiki says only that Mistag gives a mining helmet.
    if (!giveItem(player, ItemIdentifiers.MINING_HELMET_2)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.BROOCH, 1);
    setBit(player, BIT_RETURNED_BROOCH);
    playVariant(player, npcId, "standard-dialogue-using-the-brooch-on-him");
  }

  // ==========================================================================
  // Transcript events
  // ==========================================================================

  /** Wiki: 17 Mining, 13 Agility, 13 Thieving, Goblin Diplomacy and Rune Mysteries. */
  const REQUIRED_SKILLS = [
    { skill: Skill.MINING, level: 17, label: "Mining" },
    { skill: Skill.AGILITY, level: 13, label: "Agility" },
    { skill: Skill.THIEVING, level: 13, label: "Thieving" },
  ];
  const REQUIRED_QUESTS = [
    { key: "goblin_diplomacy", name: "Goblin Diplomacy" },
    { key: "rune_mysteries", name: "Rune Mysteries" },
  ];

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function missingQuestRequirements(player) {
    return REQUIRED_QUESTS.filter(({ key }) => !questIsComplete(player, key));
  }

  function notifyQuestRequirements(player) {
    for (const requirement of missingQuestRequirements(player)) {
      player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
    }
  }

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function handleDialogueHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !SIGMUND_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0) {
      if (missingSkillRequirements(player).length > 0) {
        event.end = true;
        notifySkillRequirements(player);
        return;
      }
      if (missingQuestRequirements(player).length > 0) {
        event.end = true;
        notifyQuestRequirements(player);
        return;
      }
      quest.setStage(player, STAGE_ASK_PEOPLE);
    }
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (stepId === DRAGON_SLAYER_CONDITION_ID) return hasQuest(player, "dragon_slayer_i");
    if (stepId === RUNE_MYSTERIES_CONDITION_ID) return hasQuest(player, "rune_mysteries");
    if (stepId === BOW_CONDITION_ID) return greetingFirst.get(player) === false;
    if (stepId === SALUTE_CONDITION_ID) return false;
    if (stepId === KEY_CONDITION_ID) return held(player, ItemIdentifiers.KEY_10);
    if (stepId === NO_KEY_CONDITION_ID) return !held(player, ItemIdentifiers.KEY_10);
    if (stepId === NO_TREATY_CONDITION_ID) return !held(player, ItemIdentifiers.PEACE_TREATY);
    if (stepId === WATERMILL_OPTION_CONDITION_ID) return false;
    // Unknown condition: leave it for the owning plugin (null = unanswered).
    return null;
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    const stage = quest.getStage(player);
    if (npcId === BOB_ID && stage === STAGE_ASK_PEOPLE && text.includes(BOB_RUMOUR_LINE)) {
      quest.setStage(player, STAGE_TELL_DUKE);
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_TELL_DUKE && text === DUKE_BOB_LINE) {
      quest.setStage(player, STAGE_DIG);
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_MISTAG && getContact(player) < 2 && text.includes(DUKE_SILVERWARE_LINE)) {
      setContact(player, 2);
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_SHOW_BROOCH && text.includes(DUKE_RELDO_LINE)) {
      quest.setStage(player, STAGE_FIND_RELDO);
      return;
    }
    if (RELDO_IDS.has(npcId) && stage === STAGE_FIND_RELDO && text.includes(RELDO_BOOK_LINE)) {
      quest.setStage(player, STAGE_FIND_BOOK);
    }
  }

  function handleDialogueCondition(event) {
    const { player, stepId } = event;
    if (stepId === BOW_CONDITION_ID && quest.getStage(player) === STAGE_FIND_GENERALS) {
      setContact(player, Math.max(getContact(player), 1));
      quest.setStage(player, STAGE_MISTAG);
      return;
    }
    if (stepId === NO_TREATY_CONDITION_ID && quest.getStage(player) === STAGE_TREATY) {
      giveItem(player, ItemIdentifiers.PEACE_TREATY);
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (stepId === EMOTES_TAUGHT_MESSAGE_ID && event.kind === "message"
      && GENERAL_IDS.has(event.npcId) && quest.getStage(player) === STAGE_FIND_GENERALS) {
      player.setAttribute(EMOTES_TAUGHT_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_STAGE, nativeProgress(quest.getStage(player), player));
      return;
    }
    if (stepId === TAKE_BOOK_ACTION_ID) {
      if (!hasBit(player, BIT_BOOKMARK)) {
        if (giveItem(player, ItemIdentifiers.GOBLIN_SYMBOL_BOOK)) setBit(player, BIT_BOOKMARK);
      }
      return;
    }
    if (stepId === READ_PAGES_ACTION_ID) {
      if (quest.getStage(player) === STAGE_FIND_BOOK) quest.setStage(player, STAGE_FIND_GENERALS);
      return;
    }
    if (stepId === ROBES_FOUND_ACTION_ID) {
      if (getHam(player) < 1) {
        if (freeSlots(player) < HAM_ROBE_SET.length) {
          player.getInventory().full();
          return;
        }
        if (held(player, ItemIdentifiers.KEY_10)) {
          player.getInventory().deleteNumber(ItemIdentifiers.KEY_10, 1);
        }
        for (const itemId of HAM_ROBE_SET) giveItem(player, itemId);
        setHam(player, 1);
      }
      return;
    }
    if (stepId === SILVERWARE_FOUND_ACTION_ID) {
      if (quest.getStage(player) === STAGE_MISTAG && getContact(player) >= 2) {
        if (!held(player, ItemIdentifiers.SILVERWARE) && !giveItem(player, ItemIdentifiers.SILVERWARE)) return;
        setHam(player, 2);
      }
      return;
    }
    if (stepId === TREATY_SIGNED_ACTION_ID) {
      if (quest.getStage(player) === STAGE_MISTAG && held(player, ItemIdentifiers.SILVERWARE)) {
        // Opening or cancelling the conversation is not a hand-in. Exchange only when signed;
        // the silverware's slot also makes room for the treaty in a full inventory.
        player.getInventory().deleteNumber(ItemIdentifiers.SILVERWARE, 1);
        if (!held(player, ItemIdentifiers.PEACE_TREATY) && !giveItem(player, ItemIdentifiers.PEACE_TREATY)) {
          giveItem(player, ItemIdentifiers.SILVERWARE);
          return;
        }
        quest.setStage(player, STAGE_TREATY);
      }
      return;
    }
    if (stepId === KAZGAR_ESCORT_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_TREATY) {
        if (quest.getStage(player) === STAGE_TREATY) quest.setStage(player, STAGE_ESCORTED);
        player.moveTo(new Location(MISTAG_LANDING.x, MISTAG_LANDING.y, 0));
      }
      return;
    }
    if (stepId === WAY_OUT_ACTION_ID || stepId === POST_QUEST_WAY_OUT_ACTION_ID) {
      player.moveTo(new Location(LUMBRIDGE_LANDING.x, LUMBRIDGE_LANDING.y, 0));
      return;
    }
    if (stepId === CUTSCENE_START_ACTION_ID) {
      if (quest.getStage(player) < STAGE_TREATY) return;
      if (held(player, ItemIdentifiers.PEACE_TREATY)) {
        player.getInventory().deleteNumber(ItemIdentifiers.PEACE_TREATY, 1);
      }
      event.handled = true;
      event.end = true;
      scheduleCutscene(player);
      return;
    }
    if (stepId === CUTSCENE_COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (stepId === BROOCH_HELMET_ACTION_ID) {
      setBit(player, BIT_RETURNED_BROOCH);
    }
  }

  function scheduleCutscene(player) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      playVariant(player, DUKE_HORACIO_ID, "resolving-tensions-cut-scene-a-meeting-of-leaders");
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        playVariant(player, DUKE_HORACIO_ID, "resolving-tensions-cut-scene-a-meeting-of-leaders");
      })
    );
  }

  // ==========================================================================
  // Objects and ground items
  // ==========================================================================

  function digRubble(event) {
    const { player } = event;
    const itemName = String(ItemDefinition.forId(event.itemId)?.getName?.() ?? "");
    if (!/pickaxe/i.test(itemName)) return;
    if (!CELLAR_WALL_TILES.has(tileKey(event.location))) return;
    const resolved = ObjectDefinition.forPlayer(event.objectId, player)?.id ?? event.objectId;
    if (resolved !== ObjectIdentifiers.RUBBLE) return;
    if (quest.getStage(player) !== STAGE_DIG) return;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < 17) {
      player.sendMessage("You need a Mining level of at least 17 to dig through the rubble.");
      return;
    }
    const pickaxe = mining.findBestPickaxe(player);
    if (pickaxe) player.performAnimation(pickaxe.animation);
    quest.setStage(player, STAGE_FIND_BROOCH);
    player.sendMessage("You dig a narrow tunnel through the rocks.");
    ensureBrooch(player);
  }

  function openSigmundChest(event) {
    const { player } = event;
    event.handled = true;
    if (getHam(player) >= 1) {
      player.sendMessage("You have already searched this chest.");
      return;
    }
    startTranscript(api, player, SIGMUND_ID, PAGE, "property-recovery-opening-sigmund-s-chest");
  }

  function searchGoblinBookcase(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage !== STAGE_FIND_BOOK || hasBit(player, BIT_BOOKMARK)) return;
    event.handled = true;
    startTranscript(api, player, NpcIdentifiers.RELDO, PAGE, "investigation-a-history-of-the-goblin-race");
  }

  function searchHamCrate(event) {
    const { player } = event;
    // Older saves may have lost the silverware when merely opening the Duke's dialogue.
    // Until the treaty stage, the original search is also the lost-item recovery path.
    const banked = (player.getBanks?.() ?? []).some(bank => (bank?.getAmount(ItemIdentifiers.SILVERWARE) ?? 0) > 0);
    if (getHam(player) >= 2 && (held(player, ItemIdentifiers.SILVERWARE) || banked || quest.getStage(player) !== STAGE_MISTAG)) {
      event.handled = true;
      player.sendMessage("You have already taken the silverware.");
      return;
    }
    if (quest.getStage(player) !== STAGE_MISTAG || getContact(player) < 2) return;
    event.handled = true;
    startTranscript(api, player, SIGMUND_ID, PAGE, "property-recovery-searching-the-h-a-m-hideout");
  }

  function openHamTrapdoor(event) {
    const { player } = event;
    event.handled = true;
    ObjectManager.deregister(event.object, true);
    ObjectManager.register(
      new GameObject(HAM_TRAPDOOR_OPEN, new Location(3118, 3244, 0), 10, 0, null),
      true
    );
    player.moveTo(new Location(HAM_HIDEOUT_LANDING.x, HAM_HIDEOUT_LANDING.y, 0));
  }

  function climbDownHamTrapdoor(event) {
    const { player } = event;
    event.handled = true;
    player.moveTo(new Location(HAM_HIDEOUT_LANDING.x, HAM_HIDEOUT_LANDING.y, 0));
  }

  function climbUpHamLadder(event) {
    const { player } = event;
    event.handled = true;
    player.moveTo(new Location(HAM_SURFACE_LANDING.x, HAM_SURFACE_LANDING.y, 0));
  }

  function handleObjectInteraction(event) {
    const id = resolvedObjectId(event);
    const location = event.location;
    const key = tileKey(location);
    if (id === ObjectIdentifiers.HOLE_8 && CELLAR_WALL_TILES.has(key)) {
      event.handled = true;
      stepThroughX(event.player, location);
      return;
    }
    if (id === ObjectIdentifiers.HOLE_9 && tileKey(location) === DEEP_HOLE_TILE) {
      event.handled = true;
      if (!hasBit(event.player, BIT_HOLE2)) setBit(event.player, BIT_HOLE2);
      stepThroughY(event.player, location);
      return;
    }
    if (id === SIGMUND_CHEST && tileKey(location, true) === SIGMUND_CHEST_TILE) {
      openSigmundChest(event);
      return;
    }
    if (id === LIBRARY_BOOKCASE && tileKey(location, true) === LIBRARY_BOOKCASE_TILE) {
      searchGoblinBookcase(event);
      return;
    }
    if (id === HAM_CRATE && tileKey(location, true) === HAM_CRATE_TILE) {
      searchHamCrate(event);
      return;
    }
    if (event.objectId === HAM_TRAPDOOR_CLOSED && tileKey(location, true) === HAM_TRAPDOOR_TILE) {
      openHamTrapdoor(event);
      return;
    }
    if (id === HAM_TRAPDOOR_OPEN && tileKey(location, true) === HAM_TRAPDOOR_TILE) {
      climbDownHamTrapdoor(event);
      return;
    }
    if (event.objectId === HAM_LADDER && tileKey(location, true) === HAM_LADDER_TILE) {
      climbUpHamLadder(event);
    }
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== ItemIdentifiers.BROOCH) return;
    if (quest.getStage(player) === STAGE_FIND_BROOCH) quest.setStage(player, STAGE_SHOW_BROOCH);
  }

  function handleLogin({ player }) {
    refreshSideVarbits(player);
    ensureBrooch(player);
    refreshQuestList(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I investigated the collapsed wall in the Lumbridge</str>",
        "<str>cellar and met the Dorgeshuun, a lost goblin tribe.</str>",
        "<str>I cleared Sigmund, exposed his H.A.M. plot and returned</str>",
        "<str>the silverware, so the Duke made peace with them.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_TREATY) {
      return [
        "The Duke has signed a peace treaty with the Dorgeshuun.",
        "",
        "I should take the <col=800000>peace treaty</col> to",
        "<col=800000>Mistag</col> in the Dorgeshuun mine (follow",
        "<col=800000>Kazgar</col> through the tunnel).",
      ];
    }
    if (stage === STAGE_MISTAG) {
      const lines = [
        "I have made contact with the cave goblins; the Duke says",
        "the <col=800000>Lumbridge silverware</col> is missing.",
      ];
      const ham = getHam(player);
      if (ham === 0) {
        lines.push(
          "",
          "I should pickpocket <col=800000>Sigmund</col> for a key and",
          "search his chest in the spinning wheel room."
        );
      } else if (ham === 1) {
        lines.push(
          "",
          "Sigmund is a <col=800000>H.A.M.</col> member! I should search",
          "the crate in the <col=800000>H.A.M. hideout</col> west of",
          "Lumbridge Castle for the silverware."
        );
      } else {
        lines.push(
          "",
          "I found the silverware in the H.A.M. hideout. I should",
          "return it to <col=800000>Duke Horacio</col>."
        );
      }
      return lines;
    }
    if (stage >= STAGE_FIND_GENERALS) {
      return [
        "I have identified the brooch as the symbol of the",
        "<col=800000>Dorgeshuun</col>.",
        "",
        "I should ask the <col=800000>goblin generals</col> in the",
        "Goblin Village about the lost tribe.",
      ];
    }
    if (stage === STAGE_FIND_BOOK) {
      return [
        "The symbol on the brooch belongs to an ancient goblin",
        "tribe. <col=800000>Reldo</col> said there is a book about",
        "them in the <col=800000>Varrock Palace library</col>.",
        "",
        "I should search the bookcases on the west wall.",
      ];
    }
    if (stage === STAGE_FIND_RELDO) {
      return [
        "I showed the brooch to <col=800000>Duke Horacio</col>.",
        "",
        "He asked me to take it to <col=800000>Reldo</col>, the",
        "librarian in <col=800000>Varrock Palace</col>.",
      ];
    }
    if (stage === STAGE_SHOW_BROOCH) {
      return [
        "I found a strange <col=800000>brooch</col> in the tunnel",
        "beyond the castle cellar.",
        "",
        "I should show it to <col=800000>Duke Horacio</col>.",
      ];
    }
    if (stage === STAGE_FIND_BROOCH) {
      return [
        "The <col=800000>Duke</col> let me investigate the cellar.",
        "I dug through the rubble and found a tunnel.",
        "",
        "I should look for whatever was dropped in the cave.",
      ];
    }
    if (stage === STAGE_DIG) {
      return [
        "The <col=800000>Duke</col> let me investigate the cellar.",
        "",
        "I should use a <col=800000>pickaxe</col> on the rubble in the",
        "castle cellar and climb through the hole.",
      ];
    }
    if (stage === STAGE_TELL_DUKE) {
      return [
        "<col=800000>Bob</col> saw a goblin-like creature in the cellar",
        "with big bulging eyes and a helmet with a light on it.",
        "",
        "I should tell <col=800000>Duke Horacio</col> what Bob saw.",
      ];
    }
    if (stage === STAGE_ASK_PEOPLE) {
      return [
        "I spoke to <col=800000>Sigmund</col>, the Duke's adviser.",
        "Part of the castle cellar wall collapsed and he thinks",
        "monsters are to blame.",
        "",
        "I should ask people around Lumbridge if they saw anything.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Sigmund</col>",
      "in <col=800000>Lumbridge Castle</col>.",
      "",
      "Requirements: <col=800000>Goblin Diplomacy</col> and",
      "<col=800000>Rune Mysteries</col>, 17 Mining, 13 Agility and",
      "13 Thieving.",
      "I will need a pickaxe and a light source.",
    ];
  }

  function grantMiningXp(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 3000);
  }

  api.persistAttribute(EMOTES_TAUGHT_ATTRIBUTE, false);
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(HAM_ATTRIBUTE);
  api.persistAttribute(CONTACT_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_lost_tribe",
    name: "The Lost Tribe",
    varpId: VARP,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_ASK_PEOPLE,
    completionValue: STAGE_COMPLETE,
    varbitValue: nativeProgress,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.MINING.getIndex(), amount: 3000, label: "Mining" }],
    rewardItemId: ItemIdentifiers.RING_OF_LIFE,
    rewardItemLabel: "A ring of life",
    otherRewards: [
      "The ability to use the Goblin Bow and Goblin Salute emotes",
      "Access to the Dorgesh-Kaan mine and Nardok's Bone Weapons",
    ],
    buildJournal,
    onReward: grantMiningXp,
  });

  api.onNpcInteraction("Sigmund", { "Talk-to": talkSigmund, Pickpocket: pickpocketSigmund });
  api.onNpcInteraction("Duke Horacio", { "Talk-to": talkDuke });
  api.onNpcInteraction("Cook", { "Talk-to": talkCook });
  api.onNpcInteraction("Hans", { "Talk-to": talkHans });
  api.onNpcInteraction("Bob", { "Talk-to": talkBob });
  api.onNpcInteraction("Reldo", { "Talk-to": talkReldo });
  api.onNpcInteraction("General Bentnoze", { "Talk-to": talkGenerals });
  api.onNpcInteraction("General Wartface", { "Talk-to": talkGenerals });
  api.onNpcInteraction("Mistag", { "Talk-to": talkMistag });
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(digRubble, { noted: false });
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onPlayerLogin(handleLogin);
};
