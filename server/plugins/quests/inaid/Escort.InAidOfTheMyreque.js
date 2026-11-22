/**
 * In Aid of the Myreque: Escort (see ../quests/InAidOfTheMyreque.Quest.js for the unit map).
 *
 * Veliaf's start and every talk in the Canifis hideout (stages 0-20 and 280-315), Ivan's supplies,
 * the route map (interface 53 burgh_map), the swamp ambush instance, the arrival outside Paterdomus,
 * Drezel (315-350 and his key replacement), the library keyhole and the temple trapdoor (360).
 * Capture ticks are the user's recording "In Aid of the Myreque" (revision 242); the facts are in
 * docs/quests/in-aid-of-the-myreque/README.md.
 *
 * - The hideout's Myreque are the world multinpcs 9620/9626/9628/9630, which show Veliaf 5048, Radigad
 *   5051, Polmafi 5052 and Ivan 5053 while varbit 10367 (route_hideout_npcs) is 0 and nobody once it is
 *   1 (set with 315). Drezel is the world multinpc 9805 (shown as 9636 by Priest in Peril's varp 302).
 *   Neither gets an owner-only copy.
 * - The ambush is a private copy of the swamp (source chunks 2848-2871 x 4552-4575, plane 0), with
 *   scene actors (QuestScenes): Ivan 4441 and the juvinates. Its count is varbit 2000.
 */
const { createQuestScenes } = require("../QuestScenes");
const { giveReward } = require("../QuestRuntime");

const AMBUSH_EXIT_ATTRIBUTE = "in-aid-of-the-myreque:ambush-exit";
const IN_SEARCH_STAGE_ATTRIBUTE = "quest.in_search_of_the_myreque.stage";
const IN_SEARCH_COMPLETE = 105;

/** Transcript variants ("In Aid of the Myreque" page; "Drezel" page for the key replacement). */
const V = Object.freeze({
  JOB_VELIAF: "the-myreque-s-job-offer-veliaf-hurtz",
  JOB_RADIGAD: "the-myreque-s-job-offer-radigad-ponfit",
  JOB_POLMAFI: "the-myreque-s-job-offer-polmafi-ferdygris",
  JOB_IVAN: "the-myreque-s-job-offer-ivan-strom",
  HIDEOUT: "at-the-myreque-hideout",
  HIDEOUT_VELIAF: "at-the-myreque-hideout-veliaf",
  HIDEOUT_POLMAFI: "at-the-myreque-hideout-polmafi",
  HIDEOUT_RADIGAD: "at-the-myreque-hideout-radigad",
  HIDEOUT_IVAN: "at-the-myreque-hideout-ivan",
  SUPPLIES: "escorting-ivan-to-paterdomus-giving-ivan-supplies",
  TALK_IVAN: "escorting-ivan-to-paterdomus-talking-to-ivan",
  ENCOUNTER_TALK: "escorting-ivan-to-paterdomus-talking-to-ivan-during-an-encounter",
  ENCOUNTER_FOOD: "escorting-ivan-to-paterdomus-using-food-on-ivan-during-an-encounter",
  FLEE: "escorting-ivan-to-paterdomus-if-ivan-takes-too-much-damage",
  ESCAPED: "escorting-ivan-to-paterdomus-escaping-from-the-vampyres",
  ARRIVED: "escorting-ivan-to-paterdomus-after-finishing-the-encounter",
  BEFORE_LEAVING: "escorting-ivan-to-paterdomus-talking-to-ivan-before-he-leaves-after-finishing-the-encounter",
  DREZEL: "asking-drezel-about-ivandis",
  DREZEL_AFTER: "asking-drezel-about-ivandis-talking-to-drezel-afterwards",
  DREZEL_POST_PIP: "standard-dialogue-after-priest-in-peril",
});
const DREZEL_PAGE = "Drezel";

/** Transcript step ids this unit answers or acts on. */
const STEP = Object.freeze({
  SPEAKING_AGAIN: "KOQqfF", // Veliaf, after the start
  VELIAF_AGAIN: "PUItB3",
  VELIAF_NOT_TOLD: "ozeyLw",
  VELIAF_TOLD: "bj6iRI",
  POLMAFI_FIRST: "RRQbon",
  POLMAFI_AFTER: "VOV-Bw",
  RADIGAD_FIRST: "lcbila",
  RADIGAD_AFTER: "7S1TlN",
  IVAN_NOT_TOLD: "M-pMre",
  IVAN_TOLD: "OawSE5",
  STEEL: "dTqNhq",
  STEEL_NEW: "yx_fD0",
  STEEL_HAD: "3Afh_y",
  OTHER_ARMOUR: "OBaGol",
  SICKLE: "OyYlo_",
  SICKLE_BOX: "x3h7tl",
  FOOD: "s-QcHN",
  FOOD_ASK: "C8NO4O",
  FOOD_HANDED: "lNeXDx",
  FOOD_ROOM: "h_id_c",
  FOOD_FULL: "8w23PY",
  OTHER_FOOD: "xaMWCU",
  ESCAPED_BOX: "b4-b5G",
  SLAIN_BOX: "ycpUjH",
  DREZEL_NOT_EXHAUSTED: "zTSrDo",
  DREZEL_KEY_BOX: "fTKBGC",
  DREZEL_KEY_RECEIVE: "B_kRtc",
  LOST_KEY: "P91CrU",
  LOST_KEY_RECEIVE: "7Z6IoI",
});

module.exports = function attachEscort(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const quest = context.quest;
  const { NpcIdentifiers: N, ItemIdentifiers: I, ObjectIdentifiers: O, Location, Animation, CacheDefinitions, ObjectDefinition } = api.core;

  const NPC = Object.freeze({
    VELIAF: N.VELIAF_HURTZ_2, // 5048 (multinpc 9620)
    RADIGAD: N.RADIGAD_PONFIT, // 5051 (9626)
    POLMAFI: N.POLMAFI_FERDYGRIS, // 5052 (9628)
    IVAN: N.IVAN_STROM_3, // 5053 (9630)
    IVAN_FLEEING: N.IVAN_STROM, // 4440: the head on his flee line (t3625)
    IVAN_AMBUSH: N.IVAN_STROM_2, // 4441 burgh_ivan_strom_temple_ambush_sickle
    JUVINATE_ROUTE_1: N.VAMPYRE_JUVINATE_11, // 4442 burgh_ivan_temple_vampire_juve_1 (level 75)
    JUVINATE_ROUTE_2: N.VAMPYRE_JUVINATE_12, // 4443 burgh_ivan_temple_vampire_juve_2 (level 50)
    MIST: N.MIST_2, // 4435 burgh_juvinate_vampyre_misty
    DREZEL: N.DREZEL, // 9636
    DREZEL_MAUSOLEUM: 9805, // priestperiltrappedmonk2, the mausoleum Drezel's world multinpc
  });
  const ITEM = Object.freeze({
    HELM: I.STEEL_MED_HELM,
    BODY: I.STEEL_CHAINBODY,
    LEGS: I.STEEL_PLATELEGS,
    SICKLE: I.SILVER_SICKLE,
    KEY: I.TEMPLE_LIBRARY_KEY, // 7632 burgh_key
  });
  /** Wiki: Ivan takes snails, salmon, slimy eel or stew; up to 15 (live 2005 cap, t3789 "another 7"). */
  const IVAN_FOODS = new Set([I.SALMON, I.STEW, I.COOKED_SLIMY_EEL, I.THIN_SNAIL_MEAT, I.LEAN_SNAIL_MEAT, I.FAT_SNAIL_MEAT]);
  const IVAN_FOOD_MAX = 15;
  /** The armour varbits and the control mask (1989 burgh_ivan_armour_give_control: helm 1, legs 2, body 4; t3384-3399). */
  const ARMOUR_CONTROL_VARBIT = 1989;
  const ARMOUR = new Map([
    [ITEM.HELM, { varbit: VARBIT.IVAN_HELM, mask: 1, thanks: "helmet", offer: "a helmet", count: "one" }],
    [ITEM.LEGS, { varbit: VARBIT.IVAN_LEGS, mask: 2, thanks: "steel legs", offer: "some platelegs", count: "some" }],
    [ITEM.BODY, { varbit: VARBIT.IVAN_BODY, mask: 4, thanks: "chainbody", offer: "a chainbody", count: "one" }],
  ]);
  const ARMOUR_SLOTS = new Set([0, 4, 5, 7]); // head, body, shield, legs (equipment slots)

  /** Interface 53 burgh_map (cache gamevals) and its clientscripts (capture t3364-3477). */
  const MAP = Object.freeze({
    GROUP: 53,
    PLAYER_ICON: 18,
    NPC_ICON: 19,
    CLICKOUT: 21,
    ROUTE_1: 23, // route1_layer
    ROUTE_2: 28, // route2_layer
    TRAVEL_2: 37, // text_travel_layer2
    TRAVEL_1: 38, // text_travel_layer1
    SET_HOVER_SCRIPT: 1281, // burgh_set_hover, on open
    REVERT_SCRIPT: 1467, // burgh_revert_highlight (clickout)
    HIGHLIGHT_1_SCRIPT: 1469, // shows text_travel_layer1 (cs2 1469); route 1 is not in the capture
    HIGHLIGHT_2_SCRIPT: 1470, // burgh_highlight_2
  });
  const uid = (child) => (MAP.GROUP << 16) | child;
  /** Per route: the 2001 value, the two legs' icon animations (seq 3559-3562) and the juvinates. */
  const ROUTES = Object.freeze({
    1: { routeTaken: 2, legs: [3559, 3560], juvinate: NPC.JUVINATE_ROUTE_1, count: 2, escapeAt: 2 }, // Ours: 2001 value and kills (Wiki: two level 75)
    2: { routeTaken: 1, legs: [3561, 3562], juvinate: NPC.JUVINATE_ROUTE_2, count: 4, escapeAt: 3 }, // capture t3483, 4023
  });

  // The ambush copy (capture t3483: rebuild_region of source chunks 356-358 x 569-571, plane 0).
  const AMBUSH = Object.freeze({
    sourceChunk: [356, 569],
    size: 3,
    bounds: [[2848, 2871, 4552, 4575, 0]],
    at: [2859, 4554, 0],
    ivan: [2860, 4553, 0],
    juvinates: [2860, 4557, 0],
    exitPath: [3429, 3401, 0], // burgh_swamp_exit_path 12820 -> Mort Myre (t3633)
    arrival: [3432, 3484, 0], // t4033
    arrivalIvan: [3432, 3485, 0], // t4034, facing south
  });
  const AMBUSH_MUSIC = 504; // fangs for the memory (t3483)
  const FOLLOWER_VARP = 447; // follower_npc = (4441 << 16) | index (t3483), -1 when it ends
  const MIST_FADE_TICKS = 9; // mist_disappear 1262 nine ticks after it appears (t3577 -> 3586), gone a tick later
  const MIST_FADE = 1262;
  // A wandering juvinate went for Ivan once 3 tiles from him (second attempt: turned to him at
  // t3890 from (2857,4556), Ivan at (2860,4555), struck as it reached him, t3892-3893).
  const IVAN_ENGAGE_RANGE = 3;
  const SOUTH = 6; // Direction id

  const LIBRARY = Object.freeze({ tile: [3360, 9904, 0], climbAnimation: 827 }); // t4286-4287
  const FLEE_EXPRESSION = 615; // chatang2 (t3625)
  const JUVINATE_EXPRESSION = 567; // chathap1 (t3484)

  const Scenes = createQuestScenes(api, { onEnd: ambushEnded, recoveryAttribute: AMBUSH_EXIT_ATTRIBUTE });
  /** player -> what is being offered to Ivan ({ kind, itemId, had, amount }). */
  const offers = new WeakMap();
  /** player -> the route chosen on the map, while its travel animation plays. */
  const travelling = new WeakMap();
  /** player -> the ambush in progress. */
  const ambushes = new WeakMap();
  /** actor npc -> its ambush. */
  const actorAmbush = new WeakMap();

  const stage = (player) => state.stage(player);
  const get = (player, varbit) => state.get(player, varbit);
  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const ownsPage = (pages, page = PAGE) => !Array.isArray(pages) || pages.some((entry) => entry?.page === page);

  // ---------------------------------------------------------------------------
  // Veliaf and the hideout
  // ---------------------------------------------------------------------------

  function inSearchActive(player) {
    const value = Number(player.getAttribute(IN_SEARCH_STAGE_ATTRIBUTE)) || 0;
    return value >= 1 && value < IN_SEARCH_COMPLETE;
  }

  /** The steps of one condition of a variant, played on their own. */
  const conditionSteps = (id) => (steps) => steps.find((step) => step?.id === id)?.steps ?? [];

  function talkVeliaf(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.VELIAF) return false;
    const now = stage(player);
    if (now >= STAGE.IVAN_DELIVERED) return false;
    if (now === 0) {
      // While In Search of the Myreque runs, its own Veliaf conversation must win.
      if (inSearchActive(player)) return false;
      if (!context.meetsRequirements(player)) {
        context.requirementsMessage(player);
        return true;
      }
      return common.play(player, npcId, V.JOB_VELIAF, undefined, PAGE, npc);
    }
    // Live's Hollows talk (t3233) comes after Veliaf headed back from the store (1981 = 3, t2634).
    if (now === STAGE.GADDERANKS_DEAD && get(player, VARBIT.BLOOD_TITHE) >= 3) {
      return common.play(player, npcId, V.HIDEOUT, undefined, PAGE, npc);
    }
    if (now >= STAGE.HIDEOUT_TALK) return common.play(player, npcId, V.HIDEOUT_VELIAF, undefined, PAGE, npc);
    // Ours: stages 20-280 replay the job offer's "If speaking again" lines (the capture has none).
    return common.play(player, npcId, V.JOB_VELIAF, conditionSteps(STEP.SPEAKING_AGAIN), PAGE, npc);
  }

  function talkRadigad(event) {
    return talkMember(event, NPC.RADIGAD, V.JOB_RADIGAD, V.HIDEOUT_RADIGAD);
  }

  function talkPolmafi(event) {
    return talkMember(event, NPC.POLMAFI, V.JOB_POLMAFI, V.HIDEOUT_POLMAFI);
  }

  function talkMember(event, id, jobVariant, hideoutVariant) {
    const { player, npcId, npc } = event;
    if (npcId !== id) return false;
    const now = stage(player);
    if (now < STAGE.STARTED || now >= STAGE.IVAN_DELIVERED) return false;
    // Ours: before Veliaf's Hollows talk (280) they keep their job-offer line (captured at 20, t53-63).
    return common.play(player, npcId, now >= STAGE.HIDEOUT_TALK ? hideoutVariant : jobVariant, undefined, PAGE, npc);
  }

  function talkIvan(event) {
    const { player, npcId, npc } = event;
    if (npcId === NPC.IVAN_AMBUSH) return talkAmbushIvan(event);
    if (npcId !== NPC.IVAN) return false;
    const now = stage(player);
    if (now < STAGE.STARTED || now >= STAGE.IVAN_DELIVERED) return false;
    if (now < STAGE.HIDEOUT_TALK) return common.play(player, npcId, V.JOB_IVAN, undefined, PAGE, npc);
    if (now < STAGE.MEMBERS_TOLD) return common.play(player, npcId, V.HIDEOUT_IVAN, undefined, PAGE, npc);
    // 300-310: his three lines, then the route map (t3356-3364; again at 310, t3426-3432 and t3800-3811).
    return common.play(player, npcId, V.TALK_IVAN, (steps) => steps.slice(0, 3), PAGE, npc);
  }

  function talkAmbushIvan(event) {
    const { player, npc, npcId } = event;
    const ambush = ambushes.get(player);
    if (ambush && ambush.ivan === npc) return common.play(player, npcId, V.ENCOUNTER_TALK, undefined, PAGE, npc);
    // Ours: his thanks cut short (walked off, chatbox closed) play again, so 315 is still reachable.
    if (npc && arrivalIvans.get(player) === npc && stage(player) === STAGE.ESCORT) return playArrival(player, npc);
    if (npc?.getOwner?.() === player) return common.play(player, npcId, V.BEFORE_LEAVING, undefined, PAGE, npc);
    return false;
  }

  // ---------------------------------------------------------------------------
  // Ivan's supplies (item on Ivan, 290-310)
  // ---------------------------------------------------------------------------

  function isEdible(itemId) {
    const actions = CacheDefinitions.getItem?.(itemId)?.inventoryActions ?? [];
    return actions.some((action) => typeof action === "string" && action.toLowerCase() === "eat");
  }

  function isArmour(itemId) {
    const slot = api.core.ItemDefinition.forId(itemId)?.getEquipmentType?.()?.getSlot?.();
    return ARMOUR_SLOTS.has(slot);
  }

  function useItemOnIvan(event) {
    const { player, npcId, itemId, target } = event;
    if (npcId === NPC.IVAN_AMBUSH && ambushes.get(player)?.ivan === target) {
      if (!IVAN_FOODS.has(itemId) && !isEdible(itemId)) return;
      event.handled = true;
      common.play(player, npcId, V.ENCOUNTER_FOOD, undefined, PAGE, target);
      return;
    }
    if (npcId !== NPC.IVAN) return;
    const now = stage(player);
    if (now < STAGE.HIDEOUT_TALK || now > STAGE.ESCORT) return;
    const piece = ARMOUR.get(itemId);
    let offer;
    if (piece) {
      const had = get(player, piece.varbit) === 1;
      if (!had) {
        // Live takes the piece and sets its varbit as Ivan's thanks shows (t3384).
        player.getInventory().deleteNumber(itemId, 1);
        state.set(player, piece.varbit, 1);
        state.set(player, ARMOUR_CONTROL_VARBIT, get(player, ARMOUR_CONTROL_VARBIT) | piece.mask);
      }
      offer = { kind: "steel", itemId, had };
    } else if (itemId === ITEM.SICKLE) offer = { kind: "sickle", itemId, had: get(player, VARBIT.IVAN_SICKLE) === 1 };
    else if (IVAN_FOODS.has(itemId)) offer = { kind: "food", itemId, amount: 0 };
    else if (isEdible(itemId)) offer = { kind: "other-food", itemId };
    else if (isArmour(itemId)) offer = { kind: "armour", itemId };
    else return;
    event.handled = true;
    if (offer.kind === "food" && get(player, VARBIT.IVAN_FOOD) >= IVAN_FOOD_MAX) {
      // Ours: a stocked Ivan answers with his full line alone, without asking for more food.
      offers.set(player, { ...offer, kind: "food-full" });
      common.play(player, npcId, V.SUPPLIES, (steps) => conditionSteps(STEP.FOOD)(steps).filter((step) => step?.id === STEP.FOOD_FULL), PAGE, target);
      return;
    }
    offers.set(player, offer);
    common.play(player, npcId, V.SUPPLIES, undefined, PAGE, target);
  }

  function chooseFoodAmount(event) {
    const { player, option } = event;
    const offer = offers.get(player);
    if (offer?.kind !== "food" || !ownsPage(event.pages)) return;
    const text = String(option ?? "");
    if (!text.startsWith("Yes, I'll offer all") && !text.startsWith("Nope, I'll just")) return;
    const room = Math.max(0, IVAN_FOOD_MAX - get(player, VARBIT.IVAN_FOOD));
    const wanted = text.startsWith("Yes") ? player.getInventory().getAmount(offer.itemId) : 1;
    // The food leaves the inventory on the hand-over box's continue, with 2005 (t3789).
    offer.amount = Math.min(wanted, room, player.getInventory().getAmount(offer.itemId));
  }

  // ---------------------------------------------------------------------------
  // The route map (interface 53)
  // ---------------------------------------------------------------------------

  function openMap(player) {
    if (stage(player) !== STAGE.ESCORT || ambushes.get(player)) return;
    // A failed ambush's count goes back to 0 as the map opens again (t3811).
    if (get(player, VARBIT.AMBUSH_DEATHS) !== 0) state.set(player, VARBIT.AMBUSH_DEATHS, 0);
    const sender = player.getPacketSender();
    sender.sendInterface(MAP.GROUP);
    sender.sendClientScript(MAP.SET_HOVER_SCRIPT);
  }

  function mapOpen(player) {
    return player.getInterfaceId?.() === MAP.GROUP && stage(player) === STAGE.ESCORT && !ambushes.get(player);
  }

  function selectRoute(event) {
    const { player, buttonId } = event;
    if (!mapOpen(player) || travelling.get(player)) return false;
    const script = buttonId === uid(MAP.ROUTE_1) ? MAP.HIGHLIGHT_1_SCRIPT
      : buttonId === uid(MAP.ROUTE_2) ? MAP.HIGHLIGHT_2_SCRIPT : MAP.REVERT_SCRIPT;
    player.getPacketSender().sendClientScript(script);
    return true;
  }

  function travel(event) {
    const { player, buttonId } = event;
    if (!mapOpen(player) || travelling.get(player)) return false;
    const number = buttonId === uid(MAP.TRAVEL_1) ? 1 : 2;
    const route = ROUTES[number];
    travelling.set(player, number);
    // Route 1's message follows route 2's (t3477); the capture only took route 2.
    player.sendMessage(`You decide to take route ${number}.`);
    animateIcons(player, route.legs[0]);
    common.later(player, 6, () => {
      travelling.delete(player);
      if (player.getInterfaceId?.() !== MAP.GROUP || stage(player) !== STAGE.ESCORT) return;
      startAmbush(player, number);
    });
    return true;
  }

  function animateIcons(player, sequence) {
    const sender = player.getPacketSender();
    sender.sendInterfaceAnimation(uid(MAP.PLAYER_ICON), sequence);
    sender.sendInterfaceAnimation(uid(MAP.NPC_ICON), sequence);
  }

  // ---------------------------------------------------------------------------
  // The swamp ambush
  // ---------------------------------------------------------------------------

  function startAmbush(player, number) {
    const route = ROUTES[number];
    state.set(player, VARBIT.ROUTE_TAKEN, route.routeTaken);
    const scene = Scenes.open(player, "in-aid-of-the-myreque-ambush", AMBUSH.bounds, {
      multi: false, // multiway_indicator 0 (t3490): "I'm already under attack."
      canTeleport: () => null,
      musicTrack: AMBUSH_MUSIC,
    }, { instance: { sourceChunk: AMBUSH.sourceChunk, size: AMBUSH.size }, at: AMBUSH.at, exit: AMBUSH.exitPath });
    const ambush = { player, scene, route, number, juvinates: [], ivan: null, done: false, fled: false };
    ambushes.set(player, ambush);
    ambush.ivan = Scenes.actor(scene, NPC.IVAN_AMBUSH, AMBUSH.ivan, null, { direction: SOUTH });
    if (ambush.ivan) {
      actorAmbush.set(ambush.ivan, ambush);
      ambush.ivan.setMultiCombat?.(true);
      player.getPacketSender().sendConfig(FOLLOWER_VARP, (NPC.IVAN_AMBUSH << 16) | ambush.ivan.getIndex());
    }
    for (let i = 0; i < route.count; i++) {
      // All of them wander (both live attempts: the first spawn moved, t3842).
      const juvinate = Scenes.actor(scene, route.juvinate, AMBUSH.juvinates, null, { direction: SOUTH, wanderRadius: 6 });
      if (!juvinate) continue;
      juvinate.setMultiCombat?.(true);
      actorAmbush.set(juvinate, ambush);
      ambush.juvinates.push(juvinate);
    }
    player.getPacketSender().sendSong?.(AMBUSH_MUSIC);
    player.getPacketSender().sendInterfaceRemoval();
    Scenes.later(scene, 1, () => {
      common.play(player, route.juvinate, V.TALK_IVAN, (steps) => steps.slice(-1), PAGE);
    });
    // No juvinate starts on the player: live's player struck first (t3491, t3843). Wiki: the
    // others "wander around for a while, and then eventually engage Ivan"; watchIvan sends one
    // that wanders near him.
    Scenes.later(scene, 1, () => watchIvan(ambush));
  }

  /** A free juvinate near Ivan goes for him, unless one already is on him (checked every tick). */
  function engageIvan(ambush) {
    const { ivan } = ambush;
    const at = ivan?.getLocation?.();
    if (!at) return;
    const targetOf = (juvinate) => juvinate.getCombat?.().getTarget?.() ?? null;
    if (ambush.juvinates.some((juvinate) => targetOf(juvinate) === ivan)) return;
    const near = (juvinate) => {
      const where = juvinate.getLocation();
      return where.getZ() === at.getZ()
        && Math.max(Math.abs(where.getX() - at.getX()), Math.abs(where.getY() - at.getY())) <= IVAN_ENGAGE_RANGE;
    };
    engage(ambush, ambush.juvinates.find((juvinate) => !targetOf(juvinate) && near(juvinate)), ivan);
  }

  function engage(ambush, juvinate, target) {
    if (!juvinate?.isRegistered?.() || !target?.isRegistered?.()) return;
    juvinate.getCombat().attack(target);
    if (target === ambush.ivan) ambush.ivan.getCombat().attack(juvinate);
  }

  /** Ivan eats when he is hurt (Wiki); with no food left he gives up (Wiki: "teleports out"). */
  function watchIvan(ambush) {
    if (ambush.done || ambushes.get(ambush.player) !== ambush) return;
    const { player, ivan } = ambush;
    if (!ivan?.isRegistered?.()) return;
    const max = ivan.getMaxHitpoints?.() ?? 0;
    // Ours: the capture shows no hitpoints; he eats below half (Wiki: "if his health gets too low").
    if (max > 0 && ivan.getHitpoints() < max / 2) {
      const food = get(player, VARBIT.IVAN_FOOD);
      if (food <= 0) return ivanFlees(ambush);
      state.set(player, VARBIT.IVAN_FOOD, food - 1);
      // Ours: a bite heals a quarter of his hitpoints (no source for the amount).
      ivan.heal(Math.ceil(max / 4));
      // Wiki wording ("too"); live sent "to" (t3950).
      player.sendMessage(`Ivan : Urgh, just had too eat some food, I only have ${food - 1} left.`);
    }
    engageIvan(ambush);
    Scenes.later(ambush.scene, 1, () => watchIvan(ambush));
  }

  function ivanFlees(ambush) {
    const { player, scene, ivan } = ambush;
    if (ambush.fled || ambush.done) return;
    ambush.fled = true;
    if (ivan) Scenes.removeActor(scene, ivan);
    ambush.ivan = null;
    clearFollower(player);
    // Live (t3625-3629): with Ivan gone nobody fights (the player's foe had just died, t3624), the
    // juvinates left only wander, and his line stays up until continued. A juvinate still on the
    // player would close it with its next hit, as every hit does, so their fight stops here too.
    const playerCombat = player.getCombat?.();
    if (ambush.juvinates.includes(playerCombat?.getTarget?.())) playerCombat.reset?.();
    for (const juvinate of ambush.juvinates) {
      juvinate.getCombat?.().reset?.();
      api.core.TaskManager.cancelTasks(juvinate); // a retaliation already queued by a landed hit
      api.core.HitQueue?.dropHitsFrom?.(juvinate); // a swing already on its way lands no more
      // The player's swing on its way to it would land and set it back on them (this ambush's only).
      juvinate.getCombat?.().getHitQueue?.()?.clearIncoming?.();
    }
    common.play(player, NPC.IVAN_FLEEING, V.FLEE, undefined, PAGE);
  }

  /** A juvinate at 0 hitpoints goes at once as a mist (t3577); any killer counts. Ivan at 0 gives up. */
  function ambushDeath(event) {
    const npc = event?.npc;
    const ambush = npc ? actorAmbush.get(npc) : null;
    if (!ambush || ambushes.get(ambush.player) !== ambush) return;
    event.preventDeath = true;
    if (npc === ambush.ivan) {
      // Ours: an Ivan beaten to nothing leaves as he does with no food.
      npc.setHitpoints(1);
      ivanFlees(ambush);
      return;
    }
    // Counted once: a gone juvinate (removed this tick) never counts again.
    if (!ambush.juvinates.includes(npc)) return;
    const { player, scene } = ambush;
    const tile = Scenes.toSource(npc, npc.getLocation());
    Scenes.removeActor(scene, npc);
    ambush.juvinates = ambush.juvinates.filter((juvinate) => juvinate !== npc);
    const mist = Scenes.actor(scene, NPC.MIST, [tile.getX(), tile.getY(), tile.getZ()], null, { wanderRadius: 4 });
    if (mist) {
      Scenes.later(scene, MIST_FADE_TICKS, () => mist.isRegistered?.() && common.anim(mist, MIST_FADE));
      Scenes.later(scene, MIST_FADE_TICKS + 1, () => Scenes.removeActor(scene, mist));
    }
    if (ambush.done || ambush.fled) return;
    const deaths = get(player, VARBIT.AMBUSH_DEATHS) + 1;
    state.set(player, VARBIT.AMBUSH_DEATHS, deaths);
    if (deaths >= ambush.route.escapeAt) return escaped(ambush);
  }

  /** Three deaths on route 2 (t4023): the box, the map's second leg, then outside Paterdomus. */
  function escaped(ambush) {
    const { player, scene } = ambush;
    ambush.done = true;
    // Won: a logout before the arrival is saved outside Paterdomus, not back in Mort Myre.
    scene.exit = [...AMBUSH.arrival];
    player.setAttribute(AMBUSH_EXIT_ATTRIBUTE, scene.exit);
    clearFollower(player);
    if (ambush.ivan) Scenes.removeActor(scene, ambush.ivan);
    ambush.ivan = null;
    for (const juvinate of ambush.juvinates.splice(0)) Scenes.removeActor(scene, juvinate);
    player.getCombat?.().reset?.();
    common.play(player, NPC.IVAN_AMBUSH, V.ESCAPED, undefined, PAGE);
    // The box closes by itself two ticks on (t4025); the map shows the second leg (t4027).
    Scenes.later(scene, 2, () => player.getPacketSender().sendInterfaceRemoval());
    Scenes.later(scene, 4, () => {
      player.getPacketSender().sendInterface(MAP.GROUP);
      animateIcons(player, ambush.route.legs[1]);
    });
    Scenes.later(scene, 10, () => arrive(ambush));
  }

  /** The owner-only Ivan outside Paterdomus until his thanks (t4034-4044), per player. */
  const arrivalIvans = new WeakMap();

  function removeArrivalIvan(player) {
    const ivan = arrivalIvans.get(player);
    arrivalIvans.delete(player);
    if (ivan) api.removeNpc(ivan);
  }

  const playArrival = (player, ivan) =>
    common.play(player, NPC.IVAN_AMBUSH, V.ARRIVED, (steps) => steps.filter((step) => step?.id !== STEP.SLAIN_BOX), PAGE, ivan);

  function arrive(ambush) {
    const { player } = ambush;
    removeArrivalIvan(player);
    Scenes.end(player, false);
    player.moveTo(new Location(...AMBUSH.arrival));
    // Ivan appears outside Paterdomus the tick after (t4034) and thanks the player.
    common.later(player, 1, () => {
      player.getPacketSender().sendInterfaceRemoval();
      const [x, y, z] = AMBUSH.arrivalIvan;
      const ivan = api.spawnNpc({ id: NPC.IVAN_AMBUSH, x, y, z, owner: player, ownerOnly: true, face: SOUTH });
      if (!ivan) return;
      ivan.__skipDefaultRespawn = true;
      arrivalIvans.set(player, ivan);
      playArrival(player, ivan);
    });
  }

  function clearFollower(player) {
    const sender = player.getPacketSender();
    if ((sender.getVarp(FOLLOWER_VARP) >>> 16) === NPC.IVAN_AMBUSH) sender.sendConfig(FOLLOWER_VARP, -1);
  }

  function ambushEnded(player, scene, logout) {
    const ambush = ambushes.get(player);
    if (!ambush) return;
    ambushes.delete(player);
    clearFollower(player);
    // Ours: a won ambush cut short by a logout counts as Ivan delivered (his thanks unplayed).
    if (logout && ambush.done && stage(player) === STAGE.ESCORT) delivered(player);
  }

  /** burgh_swamp_exit_path 12820 "Escape": out of the copy into Mort Myre (t3632-3633). */
  function escapeSwamp(event) {
    const { player } = event;
    const ambush = ambushes.get(player);
    if (!ambush || ambush.done) return false;
    Scenes.end(player, false);
    player.moveTo(new Location(...AMBUSH.exitPath));
    return true;
  }

  /** A logout drops the scene's pending steps and the arrival Ivan (owner-only NPCs outlive their owner). */
  function handleLogout({ player }) {
    if (!player) return;
    Scenes.cancel(player);
    removeArrivalIvan(player);
  }

  // ---------------------------------------------------------------------------
  // Drezel, the keyhole and the trapdoor
  // ---------------------------------------------------------------------------

  function talkDrezel(event) {
    const { player, npcId, npc } = event;
    if (npcId !== NPC.DREZEL || npc?.getId?.() !== NPC.DREZEL_MAUSOLEUM) return false;
    const now = stage(player);
    if (now < STAGE.IVAN_DELIVERED) return false;
    // After the quest Drezel is the other quests' again, except to replace a lost library key.
    if (now >= STAGE.COMPLETE && held(player, ITEM.KEY)) return false;
    if (now >= STAGE.LIBRARY_KEY && !held(player, ITEM.KEY)) {
      // The Drezel page's lost-key lines, alone (the rest of that page is Priest in Peril's).
      return common.play(player, npcId, V.DREZEL_POST_PIP, conditionSteps(STEP.LOST_KEY), DREZEL_PAGE, npc);
    }
    if (now >= STAGE.LIBRARY_KEY) return common.play(player, npcId, V.DREZEL_AFTER, undefined, PAGE, npc);
    // Live opens at "Well done for bringing Ivan..." (t4060), not the transcript's first greeting.
    return common.play(player, npcId, V.DREZEL, (steps) => steps.slice(1), PAGE, npc);
  }

  function inspectKeyhole(event) {
    const { player } = event;
    if ((event.objectId ?? event.object?.getId?.()) !== O.KEYHOLE) return false;
    common.mesbox(player, "You inspect the panel. It looks like there's some sort of keyhole in it.");
    return true;
  }

  /** Key on the keyhole (t4269): 1982 = 1 opens the multiloc 12762; the stage and the key stay. */
  function useKeyOnKeyhole(event) {
    const { player } = event;
    if (event.objectId !== O.KEYHOLE || event.itemId !== ITEM.KEY) return false;
    if (stage(player) < STAGE.LIBRARY_KEY) return false;
    event.handled = true;
    if (get(player, VARBIT.TEMPLE_TRAPDOOR) !== 1) state.set(player, VARBIT.TEMPLE_TRAPDOOR, 1);
    common.mesbox(player, "You use the library key in the keyhole and you hear a click to the left of you.");
    return true;
  }

  /** The opened multiloc (12762 -> 12763 "Trapdoor"): 360 and the library, no message (t4286-4287). */
  function climbLibraryTrapdoor(event) {
    const { player } = event;
    // The client sends the multiloc's base id (oploc1 12762, t4282); the event's definition is the
    // one 1982 picks for this player. ObjectDefinition has an `id` field, not a getId().
    const id = event.definition?.id ?? ObjectDefinition.forPlayer(event.objectId, player)?.id ?? event.objectId;
    if (id !== O.TRAPDOOR_52) return false;
    if (get(player, VARBIT.TEMPLE_TRAPDOOR) !== 1) return false;
    common.anim(player, LIBRARY.climbAnimation);
    const from = player.getLocation().clone();
    common.later(player, 1, () => {
      // Moved meanwhile (a teleport between the animation and the climb): no climb.
      if (!player.getLocation().equals(from)) return;
      if (stage(player) >= STAGE.LIBRARY_KEY) state.advance(player, STAGE.LIBRARY_OPEN);
      player.moveTo(new Location(...LIBRARY.tile));
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // The transcript's lines, conditions and actions
  // ---------------------------------------------------------------------------

  /** `[when, match]`: the live trigger on each line (capture ticks). */
  function handleLine(request) {
    const { player, step } = request;
    if (!player || !step) return;
    const raw = String(step.player ?? step.text ?? step.npc ?? "");
    if (!ownsPage(request.pages) && !ownsPage(request.pages, DREZEL_PAGE)) return;
    const now = stage(player);
    if (raw.startsWith("Exactly. Head down to Burgh de Rott")) {
      // 0 -> 20 as this line shows, with the start message (t46).
      if (now === 0) request.before = () => {
        if (stage(player) === 0 && context.meetsRequirements(player)) state.advance(player, STAGE.STARTED);
      };
      return;
    }
    if (raw === "I'll see what I can dig up." && now === STAGE.GADDERANKS_DEAD) {
      request.after = () => state.advance(player, STAGE.HIDEOUT_TALK); // t3278
      return;
    }
    if (raw === "Sure." && now === STAGE.HIDEOUT_TALK && request.npcId === NPC.VELIAF) {
      // The transcript's "continue" jump: live goes straight to Veliaf's menu (t3282), without "Hello again".
      request.after = () => common.play(player, NPC.VELIAF, V.HIDEOUT_VELIAF,
        (steps) => steps.filter((step) => step?.id !== STEP.VELIAF_AGAIN), PAGE, request.npc);
      return;
    }
    if (raw.startsWith("Hey. Veliaf says it's time to head down") && now === STAGE.HIDEOUT_TALK) {
      request.before = () => state.advance(player, STAGE.MEMBERS_TOLD); // t3347, as the line shows
      return;
    }
    if (raw === "That's right. We should get going soon." && (now === STAGE.MEMBERS_TOLD || now === STAGE.ESCORT)) {
      request.after = () => state.advance(player, STAGE.ESCORT); // t3362
      return;
    }
    if (raw === "Very well. I'm ready, lead the way." && now >= STAGE.MEMBERS_TOLD && now <= STAGE.ESCORT) {
      // The chat closes and the map opens (t3364); the chain's own close comes first.
      request.after = () => common.later(player, 1, openMap);
      return;
    }
    if (raw.startsWith("There's that tasty morsel Ivan!")) {
      request.speakerId = request.npcId;
      request.expression = JUVINATE_EXPRESSION;
      return;
    }
    if (raw.startsWith("I'm getting badly beaten up here")) {
      request.expression = FLEE_EXPRESSION;
      return;
    }
    if (raw.startsWith("Not a problem. I need to chat to Drezel") && now === STAGE.ESCORT) {
      request.after = () => delivered(player); // t4040
      return;
    }
    if (raw.startsWith("You might find this sickle helpful")) {
      request.after = () => handOverSickle(player); // t3411, as Ivan answers
      return;
    }
    if (raw.startsWith("Yes, it seems to be") && now === STAGE.IVAN_DELIVERED) {
      request.after = () => state.advance(player, STAGE.DREZEL_TALKED); // t4068
      return;
    }
    if (raw.startsWith("But you don't even know what he said about Ivandis") && now === STAGE.DREZEL_TALKED) {
      request.after = () => state.advance(player, STAGE.DREZEL_IVANDIS); // t4089
      return;
    }
    if (raw.startsWith("So you have no further information on him") && now === STAGE.DREZEL_IVANDIS) {
      request.after = () => state.advance(player, STAGE.DREZEL_NO_INFO); // t4182
      return;
    }
    fillIvanText(request);
  }

  /** Ivan's supply lines: the piece he was offered, and the food he can still carry. */
  function fillIvanText(request) {
    const offer = offers.get(request.player);
    if (!offer || typeof request.text !== "string") return;
    let text = request.text;
    const piece = ARMOUR.get(offer.itemId);
    if (piece) {
      text = text.replace("[helmet/chainbody/steel legs]", piece.thanks)
        .replace("[a helmet/a chainbody/some platelegs]", piece.offer)
        .replace("[one/some]", piece.count);
      // Live says "wear them" for the legs (t3399).
      if (offer.itemId === ITEM.LEGS) text = text.replace("wear it under", "wear them under");
    }
    if (text.includes("[number]")) text = text.replace("[number]", String(Math.max(0, IVAN_FOOD_MAX - get(request.player, VARBIT.IVAN_FOOD))));
    request.text = text;
  }

  function handOverSickle(player) {
    const offer = offers.get(player);
    if (offer?.kind !== "sickle" || offer.had || get(player, VARBIT.IVAN_SICKLE) === 1) return;
    if (!held(player, ITEM.SICKLE)) return;
    player.getInventory().deleteNumber(ITEM.SICKLE, 1);
    state.set(player, VARBIT.IVAN_SICKLE, 1);
  }

  /** 315 and route_hideout_npcs 10367 = 1 (the hideout empties); Ivan goes 4 ticks on (t4040-4044). */
  function delivered(player) {
    state.advance(player, STAGE.IVAN_DELIVERED);
    state.set(player, VARBIT.HIDEOUT_NPCS, 1);
    common.later(player, 4, () => removeArrivalIvan(player));
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    const offer = offers.get(player);
    switch (stepId) {
      case STEP.SICKLE_BOX: // "You offer the sickle to Ivan." objectbox with the sickle (t3406)
        event.box = { items: [ITEM.SICKLE] };
        return;
      case STEP.FOOD_ASK: // t3780
        if (offer?.itemId) event.box = { items: [offer.itemId] };
        return;
      case STEP.FOOD_HANDED: // t3786; 2005 is set as the box is continued (t3789)
        if (!offer?.itemId) return;
        event.box = { items: [offer.itemId] };
        event.after = () => {
          const room = Math.max(0, IVAN_FOOD_MAX - get(player, VARBIT.IVAN_FOOD));
          const amount = Math.min(offer.amount, room, player.getInventory().getAmount(offer.itemId));
          offer.amount = 0;
          if (amount <= 0) return;
          player.getInventory().deleteNumber(offer.itemId, amount);
          state.set(player, VARBIT.IVAN_FOOD, get(player, VARBIT.IVAN_FOOD) + amount);
        };
        return;
      case STEP.ESCAPED_BOX:
        event.box = { statement: true };
        return;
      case STEP.DREZEL_KEY_BOX: // 350 and the key with the objectbox (t4264)
        if (!ownsPage(event.pages)) return;
        if (stage(player) >= STAGE.DREZEL_NO_INFO) {
          state.advance(player, STAGE.LIBRARY_KEY);
          if (!held(player, ITEM.KEY)) giveReward(player, ITEM.KEY, 1);
        }
        event.box = { items: [ITEM.KEY] };
        return;
      case STEP.DREZEL_KEY_RECEIVE:
        if (ownsPage(event.pages)) event.handled = true;
        return;
      case STEP.LOST_KEY_RECEIVE:
        if (!ownsPage(event.pages, DREZEL_PAGE)) return;
        if (stage(player) >= STAGE.LIBRARY_KEY && !held(player, ITEM.KEY)) giveReward(player, ITEM.KEY, 1);
        event.handled = true;
        return;
      default:
        return;
    }
  }

  function answerCondition({ player, stepId, pages }) {
    if (!player) return null;
    if (stepId === STEP.LOST_KEY) {
      if (!ownsPage(pages, DREZEL_PAGE)) return null;
      const now = stage(player);
      return now >= STAGE.LIBRARY_KEY && !held(player, ITEM.KEY) ? true : null;
    }
    if (!ownsPage(pages)) return null;
    const now = stage(player);
    const offer = offers.get(player);
    switch (stepId) {
      case STEP.SPEAKING_AGAIN: return now >= STAGE.STARTED;
      case STEP.VELIAF_AGAIN: return now >= STAGE.HIDEOUT_TALK;
      case STEP.VELIAF_NOT_TOLD: case STEP.IVAN_NOT_TOLD:
      case STEP.POLMAFI_FIRST: case STEP.RADIGAD_FIRST:
        return now < STAGE.MEMBERS_TOLD;
      case STEP.VELIAF_TOLD: case STEP.IVAN_TOLD:
      case STEP.POLMAFI_AFTER: case STEP.RADIGAD_AFTER:
        return now >= STAGE.MEMBERS_TOLD;
      case STEP.STEEL: return offer?.kind === "steel";
      case STEP.STEEL_NEW: return offer?.kind === "steel" && !offer.had;
      case STEP.STEEL_HAD: return offer?.kind === "steel" && offer.had;
      case STEP.OTHER_ARMOUR: return offer?.kind === "armour";
      case STEP.SICKLE: return offer?.kind === "sickle";
      case STEP.FOOD: return offer?.kind === "food";
      case STEP.OTHER_FOOD: return offer?.kind === "other-food";
      case STEP.FOOD_ROOM: return get(player, VARBIT.IVAN_FOOD) < IVAN_FOOD_MAX;
      case STEP.FOOD_FULL: return get(player, VARBIT.IVAN_FOOD) >= IVAN_FOOD_MAX;
      // Ours: live had used all three questions first (t4096-4182); the second menu always follows.
      case STEP.DREZEL_NOT_EXHAUSTED: return false;
      default: return null;
    }
  }

  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Radigad Ponfit", { "Talk-to": talkRadigad });
  api.onNpcInteraction("Polmafi Ferdygris", { "Talk-to": talkPolmafi });
  api.onNpcInteraction("Ivan Strom", { "Talk-to": talkIvan });
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onItemOnNpc(useItemOnIvan);
  api.onPlayerLogout(handleLogout);
  api.onInterfaceActionButton([uid(MAP.ROUTE_1), uid(MAP.ROUTE_2), uid(MAP.CLICKOUT)], selectRoute);
  api.onInterfaceActionButton([uid(MAP.TRAVEL_1), uid(MAP.TRAVEL_2)], travel);
  api.onNpcBeforeDeath(ambushDeath);
  api.onObjectInteraction("Exit path", { Escape: escapeSwamp });
  api.onObjectInteraction("Keyhole", { Inspect: inspectKeyhole });
  api.onObjectInteraction("Trapdoor", { "Climb-down": climbLibraryTrapdoor });
  api.onItemOnObject("Temple library key", "Keyhole", useKeyOnKeyhole);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", chooseFoodAmount);
};
