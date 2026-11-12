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
 *   varbit 534 ham (13-14): bit 0 the H.A.M. robes, bit 1 the silverware (0 -> 1 -> 3 in
 *     rsprox 20261112T152024-5ab63b4, ticks 999 and 1185)
 *   varbit 538 hole_2_dug: deep hole at 3224,9601 squeezed through
 *   varbit 540 sigmund_leaving: 1 for 30 ticks while the dismissed Sigmund walks out (1238-1268)
 *   varbit 541 bookmark (22-24): the goblin symbol book's open spread, 0-5 (rsprox_transcripts/232/03222.txt)
 *   varbit 533 returned_brooch: brooch returned to Mistag for a mining helmet
 *   varbits 535 mistag_denial, 536 maze_warned, 537 contact and 539 sigmund_accused stay 0, as
 *   that capture leaves them through the whole quest; contact is kept as an attribute only.
 *
 * Sources: rsprox 20261112T152024-5ab63b4 (revision 242, the whole quest; docs/quests/the-lost-tribe/README.md),
 * OSRS Wiki "The Lost Tribe", its Quick guide and Transcript page, plus the cache (object/NPC
 * transforms, varbits, placements) for all ids and tiles.
 *
 * Gaps / approximations:
 *  - The maze has no trap state here; the dirt tunnel is walkable end to end, so wrong
 *    paths cost nothing (no swamp gas, no pit) and the symbol rocks keep their default
 *    Look-at. The tunnel's darkness overlay is not drawn.
 *  - 17 Mining, 13 Agility and 13 Thieving are checked at the start, and Sigmund's
 *    pickpocket re-checks 13 Thieving.
 *  - The H.A.M. trapdoor is opened by swapping 6434 -> 6435 (open trapdoor) for the
 *    whole world; Ladders/ClimbLinks handle the climb itself.
 *  - Sigmund's post-firing spawn (6290 -> 5323) also stands around the H.A.M. hideout
 *    at stages 10-12; talking there replays "Sigmund is ignoring you.".
 *  - Sigmund's chest and the post-quest brooch -> mining helmet exchange are included;
 *    the chest's already-searched wording is this plugin's own line.
 */
module.exports = function registerLostTribeQuest(api) {
  const {
    Animation,
    CountdownTask,
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NPC,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    PathFinder,
    Skill,
    TaskManager,
    World,
  } = api.core;
  const questRuntime = require("../QuestRuntime");
  const { registerQuest, refreshQuestList, startTranscript } = questRuntime;
  const mining = require("../../skills/Mining.plugin.js");

  const treatyScene = require("../losttribe/Treaty.LostTribe")(api, completeTreaty);
  const cellarHole = require("../losttribe/Cellar.LostTribe")(api);
  const witnesses = require("../losttribe/Witness.LostTribe")(api);

  const PAGE = "The Lost Tribe";

  const VARP = 465; // "lost_tribe"
  const VARBIT_STAGE = 532; // lost_tribe_quest, bits 0-10
  const VARBIT_RETURNED_BROOCH = 533;
  const VARBIT_HAM = 534; // bits 13-14: bit 0 robes, bit 1 silverware
  const VARBIT_HOLE2 = 538; // lost_tribe_hole_2_dug
  const VARBIT_SIGMUND_LEAVING = 540; // lost_tribe_sigmund_leaving: shows npc 6289 as Sigmund
  const VARBIT_BOOKMARK = 541; // bits 22-24
  /** The varbit's value for each saved H.A.M. step: none, the robes, the robes and the silverware. */
  const HAM_VARBIT_VALUES = [0, 1, 3];

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
  const BOOKMARK_ATTRIBUTE = "quest.the_lost_tribe.bookmark"; // the symbol book's spread, 0..5
  const BIT_RETURNED_BROOCH = 1 << 0;
  const BIT_GREETED = 1 << 1;
  const BIT_BOOKMARK = 1 << 2; // the symbol book was given (its page is BOOKMARK_ATTRIBUTE)
  const BIT_HOLE2 = 1 << 3;

  const SIGMUND_ID = NpcIdentifiers.SIGMUND_13; // 5322, Lumbridge Castle
  const SIGMUND_HAM_ID = NpcIdentifiers.SIGMUND_14; // 5323, H.A.M. hideout after the firing
  const SIGMUND_IDS = new Set([SIGMUND_ID, SIGMUND_HAM_ID]);
  // lost_tribe_sigmund (6288, shown at lost_tribe_quest 0-9) and lost_tribe_sigmund_leaving (6289,
  // shown while varbit 540 is 1): the castle spawn, and the one that walks out once he is dismissed.
  const SIGMUND_CASTLE_SPAWN_ID = 6288;
  const SIGMUND_LEAVING_ID = 6289;
  // rsprox 20261112T152024-5ab63b4, ticks 1238-1268: he leaves from his tile (3211,3219 there) by
  // two north-west steps and one west to 3208,3221, and is gone 15 ticks after the dismissal;
  // varbit 540 clears 30 ticks after it. Ours: he walks there from wherever he stands.
  const SIGMUND_EXIT_TILE = [3208, 3221];
  const SIGMUND_LEAVING_DESPAWN_TICKS = 15;
  const SIGMUND_LEAVING_TICKS = 30;
  const DUKE_HORACIO_ID = NpcIdentifiers.DUKE_HORACIO; // 815
  const DONIE_IDS = new Set([NpcIdentifiers.DONIE, NpcIdentifiers.GEE]); // 921, 6816
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
  // lost_tribe_mistag (5324): the mine's spawn, which shows 7297-7299 by lost_tribe_quest.
  const MISTAG_SPAWN_IDS = new Set([5324, ...MISTAG_IDS]);

  const HAM_TRAPDOOR_CLOSED = ObjectIdentifiers.TRAPDOOR_35; // 6434, 3118,3244
  const HAM_TRAPDOOR_OPEN = ObjectIdentifiers.TRAPDOOR_36; // 6435, Climb-down
  const HAM_LADDER = ObjectIdentifiers.LADDER_67; // 6436, 3118,9643
  const SIGMUND_CHEST_LOCATIONS = new Set([
    `${ObjectIdentifiers.CHEST_38}:3209,3217,1`, // legacy location
    `${ObjectIdentifiers.CHEST_38}:3211,3212,1`, // current post-3 November 2026 location
  ]);
  const HAM_CRATE = ObjectIdentifiers.CRATE_65; // 6911, 3152,9645
  const LIBRARY_BOOKCASE = ObjectIdentifiers.BOOKCASE_25; // 6916, 3207,3496
  // rsprox 20261112T152024-5ab63b4, ticks 999-1003: the chest shows opendungeonchest (2194) with
  // chest_open (52) as the robes are found, and closes again as the player's line is continued.
  const SIGMUND_CHEST_OPEN = ObjectIdentifiers.CHEST_7; // 2194
  const CHEST_OPEN_SOUND = 52;

  // The brooch lies 10 steps into the tunnel, at 3230,9610 (obj_add_specific, line 2418 of that
  // capture's transcript; picked up at tick 262).
  const BROOCH_TILE = { x: 3230, y: 9610 };
  const CELLAR_WALL_TILES = new Set(["3219,9618", "3221,9618"]);
  const DEEP_HOLE_TILE = "3224,9601";
  const LIBRARY_BOOKCASE_TILE = "3207,3496,0";
  const HAM_CRATE_TILE = "3152,9645,0";
  const HAM_TRAPDOOR_TILE = "3118,3244,0";
  const HAM_LADDER_TILE = "3118,9643,0";
  const HAM_HIDEOUT_LANDING = { x: 3119, y: 9643 };
  const HAM_SURFACE_LANDING = { x: 3119, y: 3244 };

  // The chest's set, in the order it fills the inventory (that capture, tick 999): the key is used up,
  // and the shirt takes its slot.
  const HAM_ROBE_SET = [
    ItemIdentifiers.HAM_SHIRT, // 4298
    ItemIdentifiers.HAM_ROBE, // 4300
    ItemIdentifiers.HAM_HOOD, // 4302
  ];

  // The generals show both greetings once "That good idea. Watch." is continued (ticks 518-527):
  // the chat closes, the player does the victory dance (2128, 45 cycles in) with Bentnoze's
  // (6137) a tick later, the bow (2127) with Wartface's (6136) four ticks after that, and the
  // message box comes four ticks after the bow.
  const GENERALS_WATCH_LINE = "That good idea. Watch.";
  const HUMAN_GOBLIN_DANCE = 2128; // human_cave_goblin_dance
  const HUMAN_GOBLIN_BOW = 2127; // human_cave_goblin_bow
  const GOBLIN_EMOTE_DELAY = 45;
  const BENTNOZE_DANCE = 6137; // surface_goblin_update_dance
  const WARTFACE_BOW = 6136; // surface_goblin_update_bow
  const GENERALS_DANCE_TICK = 1;
  const GENERALS_BOW_TICK = 5;
  const GENERALS_MESSAGE_TICK = 9;
  const BENTNOZE_IDS = new Set([NpcIdentifiers.GENERAL_BENTNOZE, NpcIdentifiers.GENERAL_BENTNOZE_5, NpcIdentifiers.GENERAL_BENTNOZE_6]);
  const WARTFACE_IDS = new Set([NpcIdentifiers.GENERAL_WARTFACE, NpcIdentifiers.GENERAL_WARTFACE_5, NpcIdentifiers.GENERAL_WARTFACE_6]);

  // Mistag panics at every Talk-to until the player does the Goblin Bow emote by him, which starts
  // his friendly greeting by itself (ticks 845-869: three talks, then the emote at 862).
  const EMOTE_GOBLIN_BOW = 22; // emotes.json slot
  const EMOTE_GOBLIN_SALUTE = 23;
  /** Ours: how close to Mistag an emote counts (the capture's player stood beside him). */
  const MISTAG_EMOTE_RANGE = 6;
  const MISTAG_CONTACT_LINE = "We blocked up our tunnel behind us";
  // He bows as he greets the player (tick 865): dttd_zanik_bow.
  const MISTAG_GREETING_LINE = "Greetings, friend. I am sorry I panicked";
  const MISTAG_BOW = 6000;

  const PICKPOCKET_ANIMATION = 881; // human_pickpocket (tick 972)
  const PICKPOCKET_ACTION_ID = "nQOgNz"; // "You steal a little key."
  const NO_CHEST_KEY_ACTION_ID = "_mH8yB"; // "You don't have the key to open this chest."
  const HAM_MEMBER_LINE = "Sigmund must be a member";
  const BOOK_SYMBOL_LINE = "Hey... The symbol";
  const BOOK_SYMBOL_EXPRESSION = 568; // chathap2 (tick 395)
  const DUKE_PERMISSION_LINE = "Hmm, very well. I give you permission";

  // Condition step ids on the "The Lost Tribe" page (and the chest/key pair).
  const BOW_CONDITION_ID = "Ds1-NK";
  const SALUTE_CONDITION_ID = "h2U7Gc";
  const KEY_CONDITION_ID = "oEnj9o";
  const NO_KEY_CONDITION_ID = "Xjjjh9";
  const NO_TREATY_CONDITION_ID = "cXIAOU";
  const DRAGON_SLAYER_CONDITION_ID = "QQJ5aZ";
  const RUNE_MYSTERIES_CONDITION_ID = "qSGrsq";
  /** Kazgar's nested water-mill option ("After Death to the Dorgeshuun" on the transcript). */
  const WATERMILL_OPTION_CONDITION_ID = "UEIaPX";
  // Action / message step ids.
  const TAKE_BOOK_ACTION_ID = "ThLyr1";
  const READ_PAGES_ACTION_ID = "8WepSb";
  const ROBES_FOUND_ACTION_ID = "RCYXcm";
  const SILVERWARE_FOUND_ACTION_ID = "EMSHq8";
  const TREATY_SIGNED_ACTION_ID = "N5kpDk";
  const CUTSCENE_START_ACTION_ID = "oIhMoa";
  const KAZGAR_ESCORT_ACTION_ID = "m471ps";
  const BROOCH_HELMET_ACTION_ID = "a-40GY";
  const MESSAGE_BOX_STEP_IDS = new Set([TAKE_BOOK_ACTION_ID, EMOTES_TAUGHT_MESSAGE_ID, NO_CHEST_KEY_ACTION_ID]);

  const START_HOOK = "quest:the-lost-tribe:start";

  // The witness's last line moves 1 to 2 as it opens (tick 73), the Duke's permission 2 to 3 (121).
  const WITNESS_RUMOUR_LINE = "If you can convince the Duke";
  const DUKE_RELDO_LINE = "librarian in Varrock";
  const RELDO_BOOK_LINE = "book about ancient goblin tribes";
  const DUKE_SILVERWARE_LINE = "Unless it is returned";

  // The goblin symbol book is its own cache interface, lost_tribe_symbol_book (183), with all its
  // text in the cache (Wiki, Transcript:Goblin symbol book): six spreads, each a layer the server
  // shows in turn, and two "Turn page" arrows (transmitop) the server answers. rsprox_transcripts/
  // 232/03222.txt reads it (lines 35971-35990, 36008-36040, 36738-36803, 38279): the spreads go
  // titles, page 1-3, directions, symbols, and the last spread hides the right arrow. Each arrow
  // click writes the new spread to varbit 541 (lost_tribe_bookmark, e.g. 5 -> 4 at line 36009), and
  // the book reopens there (line 35979: bookmark 5, the symbols). Getting the book is a quest bit.
  const SYMBOL_BOOK = 183;
  const SYMBOL_BOOK_SPREADS = [
    33, // lost_tribe_titles: "A History of the Goblin Race" (shown by default)
    38, // lost_tribe_page_1
    42, // lost_tribe_page_2
    46, // lost_tribe_page_3: "In the following pages I present a list of the tribes and their symbols."
    15, // lost_tribe_directions: Thorobshuun ... Narogoshuun
    14, // lost_tribe_symbols: Drogokishuun ... Yurkolgokh (the last spread)
  ];
  const SYMBOL_BOOK_RIGHT_ARROW = 16;
  const SYMBOL_BOOK_LEFT_ARROW = 17;
  const SYMBOL_BOOK_RIGHT_ARROW_LAYER = 18;
  const SYMBOL_BOOK_LEFT_ARROW_LAYER = 19;
  const SCRIPT_MAINMODAL_OPEN = 2524;
  /** The spread each reader has open (never persisted). */
  const symbolBookSpread = new WeakMap();
  /** Readers who turned to the last spread this time, for the player's line as they close it. */
  const symbolBookFinished = new WeakSet();
  /** Sigmund's chest each player has open, until their line after the robes is continued. */
  const openedChest = new WeakMap();
  /** The chest a player just searched, for the robes' step to open. */
  const pendingChest = new WeakMap();
  /** The pickaxe each player dug the rubble with, for the dig's item box. */
  const digItem = new WeakMap();
  const DIG_TICKS = 3;
  const BOOKCASE_EMPTY_TICKS = 4;
  const DIG_ACTION_ID = "Zom9NQ"; // "You dig a narrow tunnel through the rocks."

  let quest;

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

  function hamVarbitValue(player) {
    return HAM_VARBIT_VALUES[getHam(player)] ?? 0;
  }

  function setHam(player, value) {
    player.setAttribute(HAM_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_HAM, hamVarbitValue(player));
  }

  function getBookmark(player) {
    const spread = Number(player.getAttribute(BOOKMARK_ATTRIBUTE)) || 0;
    return Math.max(0, Math.min(SYMBOL_BOOK_SPREADS.length - 1, spread | 0));
  }

  function setBookmark(player, spread) {
    player.setAttribute(BOOKMARK_ATTRIBUTE, spread);
    player.getPacketSender().sendVarbit(VARBIT_BOOKMARK, spread);
  }

  function getContact(player) {
    return Number(player.getAttribute(CONTACT_ATTRIBUTE)) || 0;
  }

  function setContact(player, value) {
    player.setAttribute(CONTACT_ATTRIBUTE, value | 0);
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
    packet.sendVarbit(VARBIT_HAM, hamVarbitValue(player));
    packet.sendVarbit(VARBIT_HOLE2, hasBit(player, BIT_HOLE2) ? 1 : 0);
    packet.sendVarbit(VARBIT_BOOKMARK, getBookmark(player));
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

  const later = (player, ticks, callback) => TaskManager.submit(new CountdownTask(player, ticks, () => {
    if (player.isRegistered()) callback();
  }));

  /** The steps after the step with `id`, wherever it sits: a conversation resumed from there. */
  function stepsFrom(steps, id, inclusive = true) {
    for (let index = 0; index < (steps?.length ?? 0); index++) {
      const step = steps[index];
      if (step?.id === id) return steps.slice(inclusive ? index : index + 1);
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = stepsFrom(nested, id, inclusive);
        if (found) return found;
      }
    }
    return null;
  }

  function localNpc(player, ids) {
    return [...(player.getLocalNpcs?.() ?? [])].find((npc) => ids.has(npc.getId())) ?? null;
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
      variant = `${witnesses.WITNESS_VARIANT}-talking-to-sigmund-after-talking-to-who-saw-the-goblin`;
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

  /**
   * rsprox 20261112T152024-5ab63b4, ticks 972-976: the pickpocket plays human_pickpocket facing
   * him, and the key comes with an item box; a second try while carrying it is a game message.
   */
  function pickpocketSigmund(event) {
    const { player, npc, npcId } = event;
    if (npcId !== SIGMUND_ID) return false;
    if (quest.getStage(player) !== STAGE_MISTAG || getContact(player) < 2) {
      // Ours: no capture of an early pickpocket.
      player.sendMessage("You have no reason to pick his pocket right now.");
      return true;
    }
    if (npc) player.setPositionToFace(npc.getLocation());
    if (held(player, ItemIdentifiers.KEY_10)) {
      player.sendMessage("You have already stolen Sigmund's key.");
      return true;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 13) {
      player.sendMessage("You need a Thieving level of at least 13 to pick this pocket.");
      return true;
    }
    if (freeSlots(player) < 1) {
      player.getInventory().full();
      return true;
    }
    player.performAnimation(new Animation(PICKPOCKET_ANIMATION));
    playVariant(player, SIGMUND_ID, "property-recovery-pickpocketing-sigmund-s-key");
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

  /** The player's witness, or null before the quest has them asking around. */
  function witnessOf(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ASK_PEOPLE) return null;
    return witnesses.of(player, stage > STAGE_ASK_PEOPLE, unavailableWitnesses(player));
  }

  /** Father Aereck answers The Restless Ghost while it is under way; the quest leaves him to it. */
  function restlessGhostUnderWay(player) {
    const started = { player, key: "the_restless_ghost", started: false };
    api.emitCustomEvent("quest:is-started", started);
    return started.started === true && !hasQuest(player, "the_restless_ghost");
  }

  function unavailableWitnesses(player) {
    return restlessGhostUnderWay(player) ? [NpcIdentifiers.FATHER_AERECK] : [];
  }

  /**
   * The Cook, Hans, Bob and Father Aereck while the player asks around: their own "Asking ..."
   * section, whose cellar question the witness answers with the witness's lines instead
   * (answerWitnessQuestion); the witness answers it again until the Duke is told.
   */
  function talkWitnessCandidate(event) {
    const { player, npcId } = event;
    const candidate = witnesses.candidate(npcId);
    if (!candidate || unavailableWitnesses(player).includes(npcId)) return false;
    const stage = quest.getStage(player);
    const asking = stage === STAGE_ASK_PEOPLE || (stage === STAGE_TELL_DUKE && witnessOf(player) === candidate);
    if (!asking) return false;
    playVariant(player, npcId, candidate.variant);
    return true;
  }

  /** Donie and Gee know only that the wall fell (Transcript: "Asking Donie or Gee"). */
  function talkDonieOrGee(event) {
    const { player, npcId } = event;
    if (!DONIE_IDS.has(npcId) || quest.getStage(player) !== STAGE_ASK_PEOPLE) return false;
    playVariant(player, npcId, "a-hole-in-the-wall-asking-donie-or-gee");
    return true;
  }

  /** The witness's cellar question plays the witness section (or its repeat) in its place. */
  function answerWitnessQuestion(choice) {
    const { player, npcId } = choice;
    const candidate = witnesses.candidate(npcId);
    if (!candidate || !witnesses.CELLAR_QUESTION.test(String(choice.option ?? ""))) return;
    const stage = quest.getStage(player);
    if ((stage !== STAGE_ASK_PEOPLE && stage !== STAGE_TELL_DUKE) || witnessOf(player) !== candidate) return;
    choice.end = true;
    const variant = stage === STAGE_ASK_PEOPLE ? witnesses.WITNESS_VARIANT : witnesses.WITNESS_AGAIN_VARIANT;
    playVariant(player, npcId, variant, witnesses.witnessAnswer);
  }

  /**
   * Father Aereck's "Asking" section lists "Could you tell me more about prayers?" and "... about
   * Saradomin?" with no lines, and no dialogue page has them: they are left out rather than closing
   * the chat. Ours: no source shows what they lead to.
   */
  function dropEmptyAereckOptions(notice) {
    if (notice.npcId !== NpcIdentifiers.FATHER_AERECK || !Array.isArray(notice.options)) return;
    if (!notice.options.some((option) => witnesses.CELLAR_QUESTION.test(String(option?.text ?? "")))) return;
    notice.options = notice.options.filter((option) => option?.steps?.length || witnesses.CELLAR_QUESTION.test(String(option?.text ?? ""))
      || /^I'd better be going/.test(String(option?.text ?? "")));
  }

  /** Options naming "[NPC]" (the Duke's, Sigmund's) name the player's witness. */
  function nameWitnessInMenu(notice) {
    dropEmptyAereckOptions(notice);
    if (notice.npcId !== DUKE_HORACIO_ID && !SIGMUND_IDS.has(notice.npcId)) return;
    const options = Array.isArray(notice.options) ? notice.options : [];
    if (!options.some((option) => String(option?.text ?? "").includes("[NPC]"))) return;
    const witness = witnessOf(notice.player);
    if (!witness) return;
    notice.options = options.map((option) => (String(option?.text ?? "").includes("[NPC]")
      ? { ...option, text: witnesses.fill(option.text, witness) }
      : option));
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

  /** The greetings section's panic: its lines up to the first emote condition. */
  function panicSteps(steps) {
    const end = steps.findIndex((step) => step.type === "condition");
    return end === -1 ? steps : steps.slice(0, end);
  }

  /** The lines under one of the greetings section's emote conditions. */
  const emoteSteps = (conditionId) => (steps) => steps.find((step) => step.id === conditionId)?.steps ?? [];

  function talkMistag(event) {
    const { player, npcId } = event;
    if (!MISTAG_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_FIND_GENERALS) {
      playVariant(player, npcId, "meeting-the-lost-tribe-greetings", panicSteps);
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

  /** The Goblin Bow by Mistag starts his friendly greeting; the Goblin Salute scares him. */
  function greetMistag({ player, slot }) {
    if (slot !== EMOTE_GOBLIN_BOW && slot !== EMOTE_GOBLIN_SALUTE) return;
    if (quest.getStage(player) !== STAGE_FIND_GENERALS) return;
    const mistag = localNpc(player, MISTAG_SPAWN_IDS);
    if (!mistag || mistag.getLocation().getDistance(player.getLocation()) > MISTAG_EMOTE_RANGE) return;
    if (player.getDialogueManager().isActive()) return;
    const conditionId = slot === EMOTE_GOBLIN_BOW ? BOW_CONDITION_ID : SALUTE_CONDITION_ID;
    playVariant(player, mistag.getCurrentDefinition?.(player)?.getId?.() ?? mistag.getId(), "meeting-the-lost-tribe-greetings",
      emoteSteps(conditionId));
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
      witnesses.pick(player, unavailableWitnesses(player));
    }
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (stepId === DRAGON_SLAYER_CONDITION_ID) return hasQuest(player, "dragon_slayer_i");
    if (stepId === RUNE_MYSTERIES_CONDITION_ID) return hasQuest(player, "rune_mysteries");
    // The emote branches play from greetMistag's emote, never from a Talk-to.
    if (stepId === BOW_CONDITION_ID || stepId === SALUTE_CONDITION_ID) return false;
    if (stepId === KEY_CONDITION_ID) return held(player, ItemIdentifiers.KEY_10);
    if (stepId === NO_KEY_CONDITION_ID) return !held(player, ItemIdentifiers.KEY_10);
    if (stepId === NO_TREATY_CONDITION_ID) return !held(player, ItemIdentifiers.PEACE_TREATY);
    if (stepId === WATERMILL_OPTION_CONDITION_ID) return hasQuest(player, "death_to_the_dorgeshuun");
    // Unknown condition: leave it for the owning plugin (null = unanswered).
    return null;
  }

  const onPage = (event) => event.pages?.some(({ page }) => page === PAGE) === true;

  /** The witness section's "NPC" speaks as the player's witness, and "[NPC]" is their name. */
  function nameWitnessInLine(event) {
    const { player, npcId, step } = event;
    if (DONIE_IDS.has(npcId) && step?.speaker === "Donie/Gee") {
      event.speakerName = event.definition?.getName?.() ?? undefined;
      return;
    }
    const witness = witnessOf(player);
    if (!witness) return;
    if (step?.speaker === witnesses.PLACEHOLDER_SPEAKER) {
      event.speakerName = witness.name;
      event.speakerId = witness.npcId;
    }
    if (String(event.text).includes("[NPC]")) event.text = witnesses.fill(event.text, witness);
  }

  function handleDialogueLine(event) {
    treatyScene.line(event);
    if (!onPage(event)) return;
    nameWitnessInLine(event);
    const { player, npcId, text, step } = event;
    const stage = quest.getStage(player);
    // Line events come as the conversation is built; `before` runs as the line itself shows.
    if (step?.speaker === witnesses.PLACEHOLDER_SPEAKER && stage === STAGE_ASK_PEOPLE && text.includes(WITNESS_RUMOUR_LINE)) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_ASK_PEOPLE) quest.setStage(player, STAGE_TELL_DUKE);
      };
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_TELL_DUKE && text.startsWith(DUKE_PERMISSION_LINE)) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_TELL_DUKE) quest.setStage(player, STAGE_DIG);
      };
      return;
    }
    if (GENERAL_IDS.has(npcId) && stage === STAGE_FIND_GENERALS && text === GENERALS_WATCH_LINE) {
      event.after = () => demonstrateGreetings(player, npcId);
      return;
    }
    if (MISTAG_SPAWN_IDS.has(npcId) && stage === STAGE_FIND_GENERALS && text.startsWith(MISTAG_GREETING_LINE)) {
      event.before = () => localNpc(player, MISTAG_SPAWN_IDS)?.performAnimation(new Animation(MISTAG_BOW));
      return;
    }
    if (MISTAG_SPAWN_IDS.has(npcId) && stage === STAGE_FIND_GENERALS && text.startsWith(MISTAG_CONTACT_LINE)) {
      event.before = () => {
        if (quest.getStage(player) !== STAGE_FIND_GENERALS) return;
        setContact(player, Math.max(getContact(player), 1));
        quest.setStage(player, STAGE_MISTAG);
      };
      return;
    }
    if (typeof step?.player === "string" && text.startsWith(BOOK_SYMBOL_LINE)) {
      event.expression = BOOK_SYMBOL_EXPRESSION;
      return;
    }
    if (typeof step?.player === "string" && text.startsWith(HAM_MEMBER_LINE) && openedChest.has(player)) {
      event.after = () => closeSigmundChest(player);
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_MISTAG && getContact(player) < 2 && text.includes(DUKE_SILVERWARE_LINE)) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_MISTAG && getContact(player) < 2) setContact(player, 2);
      };
      return;
    }
    if (npcId === DUKE_HORACIO_ID && stage === STAGE_SHOW_BROOCH && text.includes(DUKE_RELDO_LINE)) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_SHOW_BROOCH) quest.setStage(player, STAGE_FIND_RELDO);
      };
      return;
    }
    if (RELDO_IDS.has(npcId) && stage === STAGE_FIND_RELDO && text.includes(RELDO_BOOK_LINE)) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_FIND_RELDO) quest.setStage(player, STAGE_FIND_BOOK);
      };
    }
  }

  function handleDialogueCondition(event) {
    const { player, stepId } = event;
    if (stepId === NO_TREATY_CONDITION_ID) {
      const stage = quest.getStage(player);
      if (stage === STAGE_TREATY || stage === STAGE_ESCORTED) giveItem(player, ItemIdentifiers.PEACE_TREATY);
    }
  }

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    // These messages are message boxes live (229, ticks 368, 527, 993), not chat lines.
    if (event.kind === "message" && MESSAGE_BOX_STEP_IDS.has(stepId) && onPage(event)) event.box = { statement: true };
    if (stepId === EMOTES_TAUGHT_MESSAGE_ID && event.kind === "message"
      && GENERAL_IDS.has(event.npcId) && quest.getStage(player) === STAGE_FIND_GENERALS) {
      player.setAttribute(EMOTES_TAUGHT_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_STAGE, nativeProgress(quest.getStage(player), player));
      return;
    }
    if (stepId === TAKE_BOOK_ACTION_ID) {
      if (!hasBit(player, BIT_BOOKMARK)) {
        // A full inventory keeps the book on the shelf: no "You take the book" box.
        if (!giveItem(player, ItemIdentifiers.GOBLIN_SYMBOL_BOOK)) {
          event.end = true;
          return;
        }
        setBit(player, BIT_BOOKMARK);
      }
      return;
    }
    if (stepId === DIG_ACTION_ID) {
      const pickaxe = digItem.get(player);
      digItem.delete(player);
      if (pickaxe !== undefined) event.box = { items: [pickaxe] };
      return;
    }
    if (stepId === PICKPOCKET_ACTION_ID) {
      if (!held(player, ItemIdentifiers.KEY_10) && !giveItem(player, ItemIdentifiers.KEY_10)) {
        event.end = true;
        return;
      }
      event.box = { items: [ItemIdentifiers.KEY_10] };
      return;
    }
    if (stepId === ROBES_FOUND_ACTION_ID) {
      if (getHam(player) < 1) {
        if (freeSlots(player) + (held(player, ItemIdentifiers.KEY_10) ? 1 : 0) < HAM_ROBE_SET.length) {
          player.getInventory().full();
          event.end = true;
          return;
        }
        player.getInventory().deleteNumber(ItemIdentifiers.KEY_10, 1);
        for (const itemId of HAM_ROBE_SET) giveItem(player, itemId);
        setHam(player, 1);
        openSigmundChest(player);
      }
      event.box = { items: [HAM_ROBE_SET[0]] };
      return;
    }
    if (stepId === SILVERWARE_FOUND_ACTION_ID) {
      if (quest.getStage(player) === STAGE_MISTAG && getContact(player) >= 2) {
        if (!held(player, ItemIdentifiers.SILVERWARE) && !giveItem(player, ItemIdentifiers.SILVERWARE)) {
          event.end = true;
          return;
        }
        setHam(player, 2);
        event.box = { items: [ItemIdentifiers.SILVERWARE] };
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
        sigmundLeaves(player);
        event.box = { items: [ItemIdentifiers.PEACE_TREATY] };
      }
      return;
    }
    if (stepId === KAZGAR_ESCORT_ACTION_ID) {
      if (quest.getStage(player) === STAGE_TREATY) quest.setStage(player, STAGE_ESCORTED);
      return;
    }
    if (stepId === CUTSCENE_START_ACTION_ID) {
      const stage = quest.getStage(player);
      if ((stage !== STAGE_TREATY && stage !== STAGE_ESCORTED) || !held(player, ItemIdentifiers.PEACE_TREATY)) return;
      event.handled = true;
      event.end = true;
      treatyScene.start(player);
      return;
    }
    if (treatyScene.action(event)) return;
    if (stepId === BROOCH_HELMET_ACTION_ID) {
      setBit(player, BIT_RETURNED_BROOCH);
    }
  }

  function showSymbolBookSpread(player, spread) {
    const sender = player.getPacketSender();
    const uid = (child) => (SYMBOL_BOOK << 16) | child;
    SYMBOL_BOOK_SPREADS.forEach((layer, index) => sender.sendInterfaceDisplayState(uid(layer), index !== spread));
    sender.sendInterfaceDisplayState(uid(SYMBOL_BOOK_LEFT_ARROW_LAYER), spread === 0);
    sender.sendInterfaceDisplayState(uid(SYMBOL_BOOK_RIGHT_ARROW_LAYER), spread === SYMBOL_BOOK_SPREADS.length - 1);
  }

  function readSymbolBook({ player }) {
    const spread = getBookmark(player);
    symbolBookSpread.set(player, spread);
    showSymbolBookSpread(player, spread);
    const sender = player.getPacketSender();
    sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
    sender.sendInterface(SYMBOL_BOOK);
  }

  function turnSymbolBookPage(event) {
    const buttonId = Number(event.buttonId ?? 0);
    if ((event.groupId ?? (buttonId >>> 16)) !== SYMBOL_BOOK) return;
    const child = event.childId ?? (buttonId & 0xffff);
    if (child !== SYMBOL_BOOK_RIGHT_ARROW && child !== SYMBOL_BOOK_LEFT_ARROW) return;
    const { player } = event;
    const current = symbolBookSpread.get(player);
    if (current === undefined) return;
    event.handled = true;
    const spread = current + (child === SYMBOL_BOOK_RIGHT_ARROW ? 1 : -1);
    if (spread < 0 || spread >= SYMBOL_BOOK_SPREADS.length) return;
    symbolBookSpread.set(player, spread);
    setBookmark(player, spread);
    // rsprox 20261112T152024-5ab63b4, tick 387: turning to the symbols spread moves 5 to 6.
    const stage = quest.getStage(player);
    if (spread === SYMBOL_BOOK_SPREADS.length - 1 && (stage === STAGE_FIND_RELDO || stage === STAGE_FIND_BOOK)) {
      quest.setStage(player, STAGE_FIND_GENERALS);
      symbolBookFinished.add(player);
    }
    showSymbolBookSpread(player, spread);
  }

  /** Closing the book after reaching the symbols: "Hey... The symbol of the 'Dorgeshuun' tribe ..." (tick 395). */
  function closeSymbolBook({ player, interfaceId }) {
    if (interfaceId !== SYMBOL_BOOK || !symbolBookSpread.has(player)) return;
    symbolBookSpread.delete(player);
    if (!symbolBookFinished.has(player)) return;
    symbolBookFinished.delete(player);
    playVariant(player, NpcIdentifiers.RELDO, "investigation-a-history-of-the-goblin-race",
      (steps) => stepsFrom(steps, READ_PAGES_ACTION_ID, false) ?? []);
  }

  /** The generals' greetings, after "That good idea. Watch." is continued (ticks 518-529). */
  function demonstrateGreetings(player, npcId) {
    if (quest.getStage(player) !== STAGE_FIND_GENERALS) return;
    player.setAttribute(EMOTES_TAUGHT_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_STAGE, nativeProgress(quest.getStage(player), player));
    player.getDialogueManager().reset();
    player.getPacketSender().sendInterfaceRemoval();
    const movement = player.getMovementQueue();
    movement.reset();
    movement.setBlockMovement(true);
    later(player, GENERALS_DANCE_TICK, () => {
      player.performAnimation(new Animation(HUMAN_GOBLIN_DANCE, GOBLIN_EMOTE_DELAY));
      localNpc(player, BENTNOZE_IDS)?.performAnimation(new Animation(BENTNOZE_DANCE));
    });
    later(player, GENERALS_BOW_TICK, () => {
      player.performAnimation(new Animation(HUMAN_GOBLIN_BOW, GOBLIN_EMOTE_DELAY));
      localNpc(player, WARTFACE_IDS)?.performAnimation(new Animation(WARTFACE_BOW));
    });
    TaskManager.submit(new CountdownTask(player, GENERALS_MESSAGE_TICK, () => {
      movement.setBlockMovement(false);
      if (!player.isRegistered()) return;
      playVariant(player, npcId, "investigation-the-goblin-generals",
        (steps) => stepsFrom(steps, EMOTES_TAUGHT_MESSAGE_ID) ?? []);
    }));
  }

  /** The robes' chest stands open for the player until their line after it is continued. */
  function openSigmundChest(player) {
    const chest = pendingChest.get(player);
    pendingChest.delete(player);
    if (!chest) return;
    const sender = player.getPacketSender();
    sender.sendObject(new GameObject(SIGMUND_CHEST_OPEN, chest.getLocation().clone(), chest.getType(), chest.getFace(), null));
    sender.sendSound(CHEST_OPEN_SOUND, 0, 0);
    openedChest.set(player, chest);
  }

  function closeSigmundChest(player) {
    const chest = openedChest.get(player);
    openedChest.delete(player);
    if (chest) player.getPacketSender().sendObject(chest);
  }

  /** Dismissed, Sigmund (6289 while varbit 540 is 1) walks out of the Duke's room for this player. */
  function sigmundLeaves(player) {
    const sender = player.getPacketSender();
    const castle = localNpc(player, new Set([SIGMUND_CASTLE_SPAWN_ID, SIGMUND_ID]));
    sender.sendVarbit(VARBIT_SIGMUND_LEAVING, 1);
    later(player, SIGMUND_LEAVING_TICKS, () => sender.sendVarbit(VARBIT_SIGMUND_LEAVING, 0));
    if (!castle) return;
    const from = castle.getLocation();
    const leaving = NPC.create(SIGMUND_LEAVING_ID, from.clone());
    leaving.setOwner(player);
    leaving.setOwnerOnly(true);
    leaving.setScriptedMovement?.(true);
    leaving.__skipDefaultRespawn = true;
    World.getAddNPCQueue().push(leaving);
    // The add queue registers him during the next world tick; he sets off once he is in the world.
    const walkOut = (tries) => later(player, 1, () => {
      if (leaving.isRegistered?.()) PathFinder.calculateWalkRoute(leaving, ...SIGMUND_EXIT_TILE);
      else if (tries > 1) walkOut(tries - 1);
    });
    walkOut(3);
    TaskManager.submit(new CountdownTask(leaving, SIGMUND_LEAVING_DESPAWN_TICKS, () => {
      if (leaving.isRegistered?.()) World.getRemoveNPCQueue().push(leaving);
    }));
  }

  function completeTreaty(player) {
    const stage = quest.getStage(player);
    if ((stage !== STAGE_TREATY && stage !== STAGE_ESCORTED) || !held(player, ItemIdentifiers.PEACE_TREATY)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.PEACE_TREATY, 1);
    quest.complete(player);
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
    // rsprox 20261112T152024-5ab63b4, ticks 173-181: the pickaxe's wall swing, then three ticks on
    // the stage moves 3 to 4 with an item box of the pickaxe used.
    const used = mining.PICKAXES.find((entry) => entry.id === event.itemId) ?? mining.findBestPickaxe(player);
    const movement = player.getMovementQueue();
    movement.reset();
    movement.setBlockMovement(true);
    player.setPositionToFace(new Location(event.location.x, event.location.y, 0));
    if (used) player.performAnimation(mining.swingAnimation(used, { swing: "wall" }));
    TaskManager.submit(new CountdownTask(player, DIG_TICKS, () => {
      movement.setBlockMovement(false);
      if (!player.isRegistered() || quest.getStage(player) !== STAGE_DIG) return;
      player.performAnimation(new Animation(-1));
      quest.setStage(player, STAGE_FIND_BROOCH);
      digItem.set(player, event.itemId);
      playVariant(player, SIGMUND_ID, "a-hole-in-the-wall-opening-the-tunnel");
      ensureBrooch(player);
    }));
  }

  function searchSigmundChest(event) {
    const { player } = event;
    event.handled = true;
    if (getHam(player) >= 1) {
      player.sendMessage("You have already searched this chest.");
      return;
    }
    if (event.object) pendingChest.set(player, event.object);
    playVariant(player, SIGMUND_ID, "property-recovery-opening-sigmund-s-chest");
  }

  /**
   * The first search takes the book; the take box is where live ends it (ticks 363-369). Live
   * searched it straight after the Duke, without asking Reldo first.
   */
  function searchGoblinBookcase(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if ((stage !== STAGE_FIND_RELDO && stage !== STAGE_FIND_BOOK) || hasBit(player, BIT_BOOKMARK)) {
      // rsprox 20261112T152024-5ab63b4, ticks 370-374: any other search, the book already taken.
      player.sendMessage("You search the bookcase...");
      later(player, BOOKCASE_EMPTY_TICKS, () => player.sendMessage("You find nothing of interest."));
      return;
    }
    playVariant(player, NpcIdentifiers.RELDO, "investigation-a-history-of-the-goblin-race", (steps) => {
      const take = steps.findIndex((step) => step.id === TAKE_BOOK_ACTION_ID);
      return take === -1 ? steps : steps.slice(0, take + 1);
    });
  }

  function searchHamCrate(event) {
    const { player } = event;
    // Older saves may have lost the silverware when merely opening the Duke's dialogue.
    // Until the treaty stage, the original search is also the lost-item recovery path.
    const banked = (player.getBanks?.() ?? []).some(bank => (bank?.getAmount(ItemIdentifiers.SILVERWARE) ?? 0) > 0);
    if (getHam(player) >= 2 && (held(player, ItemIdentifiers.SILVERWARE) || banked || quest.getStage(player) !== STAGE_MISTAG)) {
      event.handled = true;
      // rsprox 20261112T152024-5ab63b4, tick 1191: a search after the silverware.
      player.sendMessage("You search the crate but find nothing.");
      return;
    }
    if (quest.getStage(player) !== STAGE_MISTAG || getContact(player) < 2) return;
    event.handled = true;
    playVariant(player, SIGMUND_ID, "property-recovery-searching-the-h-a-m-hideout");
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
      event.handled = cellarHole.squeeze(event.player, location);
      return;
    }
    if (id === ObjectIdentifiers.HOLE_9 && tileKey(location) === DEEP_HOLE_TILE) {
      event.handled = true;
      if (!hasBit(event.player, BIT_HOLE2)) setBit(event.player, BIT_HOLE2);
      stepThroughY(event.player, location);
      return;
    }
    if (SIGMUND_CHEST_LOCATIONS.has(`${id}:${tileKey(location, true)}`)) {
      searchSigmundChest(event);
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
  api.persistAttribute(BOOKMARK_ATTRIBUTE, 0);

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
  api.onNpcsInteraction(["Cook", "Hans", "Bob", "Father Aereck"], { "Talk-to": talkWitnessCandidate });
  api.onNpcsInteraction(["Donie", "Gee"], { "Talk-to": talkDonieOrGee });
  api.onNpcInteraction("Reldo", { "Talk-to": talkReldo });
  api.onNpcInteraction("General Bentnoze", { "Talk-to": talkGenerals });
  api.onNpcInteraction("General Wartface", { "Talk-to": talkGenerals });
  api.onNpcInteraction("Mistag", { "Talk-to": talkMistag });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction("Goblin symbol book", { Read: readSymbolBook });
  api.onInterfaceActionClick(turnSymbolBookPage);
  api.onInterfaceActionClick(cellarHole.warningClick);
  api.onCustomEvent("interface:closed", closeSymbolBook);
  api.onCustomEvent("interface:closed", cellarHole.warningClosed);
  api.onCustomEvent("player:emote", greetMistag);
  api.onCustomEvent("npc-dialogue:choice", answerWitnessQuestion);
  api.onCustomEvent("npc-dialogue:menu", nameWitnessInMenu);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(digRubble, { noted: false });
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogin(cellarHole.restoreWarningCount);
};
