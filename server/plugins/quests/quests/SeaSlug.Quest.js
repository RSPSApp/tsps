/**
 * Sea Slug (members).
 *
 * The words come from the "Sea Slug" transcript page. Caroline, Bailey, Kennith,
 * Kent and the Holgart ids are all indexed, so this plugin supplies the variant
 * selector, the prose-condition answers, the start hook, the completion action and
 * the stage transitions the transcript does not carry.
 *
 * Live order and timing come from the user's RSProx capture of the whole quest
 * (20261110T112750-5ab63b4, rev 242); docs/quests/sea-slug/README.md lists the facts.
 *
 * Stages (varp 159):
 *   1 started, 2 needs swamp paste, 3 boat repaired, 4 spoken to Kennith,
 *   5 sailed to Kent, 6 spoken to Kent, 7 lit torch, 8 Kennith needs escape,
 *   9 panel opened, 10 needs crane, 11 saved Kennith, 12 complete.
 *
 * - Holgart's boat (stage 3 on): every crossing, Talk-to or Travel, is a ferries `rowing`
 *   trip (seaslug_boat_travel, the route's layer), as live rows them. Live offers Travel from
 *   the boat repair on (Holgart 5071 is 7789, with Travel, from varp 159 = 3).
 * - The swamp paste goes on "You give Holgart the swamp paste." (1 -> 3), then the boat
 *   repair cutscene plays (seaslug/Scenes.SeaSlug.js), as do Kent's grab, the panel kick and
 *   the crane.
 * - The platform's and cabin's doors are ordinary doors (Doors.plugin.js): live opens them
 *   in place (18168 -> 11617) and walks the player through.
 * - The platform Holgart is the world's 6241, which shows 5070 while slug2_npc_track1 is 0.
 *
 * Gaps: the swamp-paste mixing recipe (flour + swamp tar on a fire) is not wired here.
 */
module.exports = function registerSeaSlugQuest(api) {
  const { Animation, Graphic, HitDamage, HitMask, Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const createSeaSlugScenes = require("../seaslug/Scenes.SeaSlug");

  const CAROLINE_NPC_ID = NpcIdentifiers.CAROLINE; // 5067
  const KENNITH_NPC_IDS = new Set([NpcIdentifiers.KENNITH, NpcIdentifiers.KENNITH_2]);
  const BAILEY_NPC_ID = NpcIdentifiers.BAILEY; // 5066
  const KENT_NPC_ID = NpcIdentifiers.KENT; // 5074
  const HOLGART_NPC_IDS = new Set([
    NpcIdentifiers.HOLGART,
    NpcIdentifiers.HOLGART_2,
    NpcIdentifiers.HOLGART_3,
    NpcIdentifiers.HOLGART_4,
    NpcIdentifiers.HOLGART_5,
    NpcIdentifiers.HOLGART_6,
    NpcIdentifiers.HOLGART_7,
  ]);

  const VARP_SEA_SLUG = 159;
  const STAGE_STARTED = 1;
  const STAGE_NEEDS_SWAMP_PASTE = 2;
  const STAGE_BOAT_REPAIRED = 3;
  const STAGE_SPOKEN_TO_KENNITH = 4;
  const STAGE_SAILED_TO_KENT = 5;
  const STAGE_SPOKEN_TO_KENT = 6;
  const STAGE_LIT_TORCH = 7;
  const STAGE_KENNITH_NEEDS_ESCAPE = 8;
  const STAGE_PANEL_OPENED = 9;
  const STAGE_NEEDS_CRANE = 10;
  const STAGE_SAVED_KENNITH = 11;
  const STAGE_COMPLETE = 12;

  const SWAMP_PASTE_ITEM_ID = ItemIdentifiers.SWAMP_PASTE;
  const LIT_TORCH_ITEM_ID = ItemIdentifiers.LIT_TORCH;
  const UNLIT_TORCH_ITEM_ID = ItemIdentifiers.UNLIT_TORCH;

  const LOOSE_PANEL_OBJECT_ID = 18251; // slug_breakable_panel (Badly repaired wall / Broken wall)
  const CRANE_OBJECT_ID = 18327; // seaslug_crane
  const CRANE_FOOTPRINT = { x0: 2770, x1: 2773, y0: 3287, y1: 3290, z: 1 };
  const PLATFORM_LADDER_OBJECT_ID = 18324; // seaslug_ladder (Climb-up)
  const PLATFORM_MIN_X = 2750;
  const PLATFORM_TILE = { x: 2784, y: 3276, z: 0 };
  const ISLAND_TILE = { x: 2794, y: 3320, z: 0 };
  const SHORE_TILE = { x: 2720, y: 3305, z: 0 };

  const DAMP_STICKS_ITEM_NAME = "Damp sticks";
  const BROKEN_GLASS_ITEM_NAME = "Broken glass";
  const DRY_STICKS_ITEM_NAME = "Dry sticks";
  const DRY_STICKS_ITEM_ID = ItemIdentifiers.DRY_STICKS;
  const RUB_TOGETHER_OPTION = "Rub-together";
  const FIREMAKING_REQUIREMENT = 30;
  // Wiki chart for lighting a torch: 77.34% (198/256) at level 30, 100% from level 43.
  const TORCH_LIGHT_CHANCE_AT_30 = 198 / 256;
  const TORCH_LIGHT_MAX_LEVEL = 43;
  // Capture ticks 276 (glass on sticks) and 297 (rub): seq/spotanim/sound with their delays.
  const DRYING_SEQ = 4809; // seaslug_player_drying_sticks
  const DRYING_GRAPHIC = 791; // seaslug_drying_sticks
  const DRYING_SOUND = 3023; // slug_dry_sticks
  const DRYING_DELAY = 15;
  const TORCH_LIT_SOUND = 3028; // slug_torch_lit
  // Capture tick 303: climbing up with the lit torch (not a transcript line).
  const TORCH_LADDER_MESSAGE = "The fishermen seem afraid of your torch.";
  const UNLIT_LADDER_VARIANT = "rescuing-kennith-attempting-to-go-upstairs-with-an-unlit-torch";
  const LADDER_SMACK_ACTION_ID = "wgQntK"; // "The player is dealt 4 Hitpoints."
  const LADDER_SMACK_DAMAGE = 4;

  // Holgart's crossings (plugins/world/data/ferries.json).
  const ROUTE_PLATFORM = "sea-slug-platform";
  const ROUTE_ISLAND = "sea-slug-island";
  const ROUTE_ISLAND_RETURN = "sea-slug-island-return";
  const ROUTE_WITCHAVEN = "sea-slug-witchaven";
  const TRAVEL_STEPS = {
    "46f1OE": ROUTE_PLATFORM, // "You arrive at the fishing platform."
    zUdSJX: ROUTE_ISLAND, // "You arrive on a small island."
    w8c3IN: ROUTE_WITCHAVEN, // "Holgart takes the player back to Witchaven."
    Jn71UA: ROUTE_ISLAND_RETURN, // "You arrive at the fishing platform."
    i9MI4w: ROUTE_WITCHAVEN, // "The boat arrives at Witchaven."
  };
  const SWAMP_PASTE_GIVEN_STEP_ID = "rSdV8b"; // "You give Holgart the swamp paste."
  const BOAT_REPAIR_ACTION_ID = "YlJKOo"; // "Cutscene starts, focusing on Holgart fixing the boat."
  const UNLIT_TORCH_RECEIVE_IDS = new Set(["G6lOss", "o9pnQL"]);
  const UNLIT_TORCH_DROP_ACTION_ID = "ab-u4V"; // full bag: "The unlit torch is dropped to the ground."
  // "Bailey gives you a torch.": an item box with the unlit torch, the torch after it (capture tick 248).
  const TORCH_BOX_STEP_IDS = new Set(["05RBJj", "wKrin9"]);
  const CRANE_FAR_VARIANT = "freeing-kennith-using-the-crane";

  const START_HOOK = "quest:sea-slug:start";
  const COMPLETE_ACTION_ID = "U0muMo";
  const KENT_ACTION_ID = "EkOxin";
  const KENT_FIRST_VARIANT = "at-the-shipwreck-island-talking-to-kent";
  const PAGE = "Sea Slug";
  // Capture tick 450: the completion scroll's model and lines, and jingle 154.
  const SCROLL_ITEM_ID = ItemIdentifiers.SEA_SLUG; // seasluginv
  const COMPLETION_JINGLE = 154; // quest complete 3

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const Scenes = createSeaSlugScenes(api, {
    onPanelOpened: (player) => advance(player, STAGE_KENNITH_NEEDS_ESCAPE, STAGE_PANEL_OPENED),
    onCraneDone: (player) => advance(player, STAGE_NEEDS_CRANE, STAGE_SAVED_KENNITH),
  });

  /** `from` -> `to`, only from that stage. */
  function advance(player, from, to) {
    if (quest.getStage(player) === from) quest.setStage(player, to);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const history = [
      "<str>I agreed to find Caroline's husband Kent and son Kennith.</str>",
      "",
    ];
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Caroline</col>",
        "on the coast <col=800000>east of Ardougne</col>.",
        "",
        "I need level 30 <col=800000>Firemaking</col>.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [...history, "I should speak to <col=800000>Holgart</col> about reaching the Fishing Platform."];
    }
    if (stage === STAGE_NEEDS_SWAMP_PASTE) {
      return [
        ...history,
        held(player, SWAMP_PASTE_ITEM_ID)
          ? "I should give my <col=800000>swamp paste</col> to Holgart."
          : "Holgart needs <col=800000>swamp paste</col> to repair his boat.",
      ];
    }
    if (stage === STAGE_BOAT_REPAIRED) {
      return [...history, "Holgart's boat is repaired. I should sail to the <col=800000>Fishing Platform</col>."];
    }
    if (stage === STAGE_SPOKEN_TO_KENNITH || stage === STAGE_SAILED_TO_KENT) {
      return [...history, "I found Kennith hiding on the platform. I need to find <col=800000>Kent</col>."];
    }
    if (stage === STAGE_SPOKEN_TO_KENT) {
      return [...history, "Sea slugs fear heat. I need Bailey's torch and a way to <col=800000>light it</col>."];
    }
    if (stage === STAGE_LIT_TORCH) {
      return [...history, "My torch keeps the fishermen away. I should return to <col=800000>Kennith</col>."];
    }
    if (stage === STAGE_KENNITH_NEEDS_ESCAPE) {
      return [...history, "Kennith needs another escape route. The nearby wall panel looks weak."];
    }
    if (stage === STAGE_PANEL_OPENED) {
      return [...history, "I opened the wall. I should tell <col=800000>Kennith</col>."];
    }
    if (stage === STAGE_NEEDS_CRANE) {
      return [...history, "I need to use the <col=800000>crane</col> to lower Kennith into Holgart's boat."];
    }
    if (stage === STAGE_SAVED_KENNITH) {
      return [...history, "Kennith is safe. I should return to <col=800000>Caroline</col>."];
    }
    return [
      ...history,
      "<str>I rescued Kennith and helped reunite Caroline's family.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FISHING, 7175);
  }

  function carolineVariant(stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-caroline";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-caroline-again";
    return "starting-off";
  }

  function holgartVariant(stage, player) {
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) {
      // Live goes straight from 1 to 3 when the paste is already in the pack (tick 38).
      if (!held(player, SWAMP_PASTE_ITEM_ID)) quest.setStage(player, STAGE_NEEDS_SWAMP_PASTE);
      return "talking-to-holgart";
    }
    if (stage === STAGE_NEEDS_SWAMP_PASTE) {
      return held(player, SWAMP_PASTE_ITEM_ID)
        ? "talking-to-holgart"
        : "talking-to-holgart-talking-to-holgart-again";
    }
    if (stage === STAGE_BOAT_REPAIRED) return "talking-to-holgart-talking-to-holgart-after-fixing-the-boat";
    if (stage === STAGE_SPOKEN_TO_KENNITH) return "talking-to-holgart-after-talking-to-kennith";
    if (stage === STAGE_SAILED_TO_KENT) return "at-the-shipwreck-island-talking-to-holgart";
    if (stage === STAGE_SPOKEN_TO_KENT) {
      return "at-the-shipwreck-island-talking-to-holgart-again-before-returning-to-the-fishing-platform";
    }
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-holgart";
    if (stage >= STAGE_LIT_TORCH) return "at-the-fishing-platform-talking-to-holgart-at-the-fishing-platform";
    return "at-the-shipwreck-island-talking-to-holgart";
  }

  function kennithVariant(stage) {
    if (stage === STAGE_BOAT_REPAIRED) return "at-the-fishing-platform-talking-to-kennith";
    if (stage >= STAGE_SPOKEN_TO_KENNITH && stage <= STAGE_SPOKEN_TO_KENT) {
      return "at-the-fishing-platform-subsequent-dialogue-with-kennith";
    }
    if (stage === STAGE_LIT_TORCH || stage === STAGE_KENNITH_NEEDS_ESCAPE) {
      return "rescuing-kennith-talking-to-kennith";
    }
    if (stage === STAGE_PANEL_OPENED) {
      return "freeing-kennith-talking-to-kennith-after-making-a-hole-in-the-wall";
    }
    if (stage >= STAGE_NEEDS_CRANE) return "freeing-kennith-subsequent-dialogue-with-kennith";
    return null;
  }

  function baileyVariant(stage, player) {
    if (stage >= STAGE_SAVED_KENNITH) return "freeing-kennith-talking-to-bailey-after-freeing-kennith";
    if (stage === STAGE_SPOKEN_TO_KENT) {
      return held(player, UNLIT_TORCH_ITEM_ID)
        ? "rescuing-kennith-talking-to-bailey-again-with-the-unlit-torch"
        : "rescuing-kennith-talking-to-bailey";
    }
    if (stage >= STAGE_LIT_TORCH && stage < STAGE_SAVED_KENNITH) {
      if (held(player, LIT_TORCH_ITEM_ID)) {
        return "rescuing-kennith-talking-to-bailey-with-the-lit-torch";
      }
      // A lost torch is replaced by the first conversation's "loses their unlit torch"
      // branch; the "again with the unlit torch" line would leave the player stuck.
      if (!held(player, UNLIT_TORCH_ITEM_ID)) return "rescuing-kennith-talking-to-bailey";
      return "rescuing-kennith-talking-to-bailey-again-with-the-unlit-torch";
    }
    return "at-the-fishing-platform-talking-to-bailey";
  }

  function kentVariant(stage) {
    if (stage === STAGE_SAILED_TO_KENT) return KENT_FIRST_VARIANT;
    if (stage >= STAGE_SPOKEN_TO_KENT) return "at-the-shipwreck-island-subsequent-dialogue-with-kent";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      // Let the named-NPC pages own their canonical post-quest dialogue (and The
      // Slug Menace's shared Holgart/Bailey conversations) once this quest is done.
      return npcId === CAROLINE_NPC_ID ? { page: "Caroline", variant: "after-sea-slug" } : null;
    }
    if (npcId === CAROLINE_NPC_ID) return carolineVariant(stage);
    if (HOLGART_NPC_IDS.has(npcId)) return holgartVariant(stage, player);
    if (KENNITH_NPC_IDS.has(npcId)) {
      if (stage === STAGE_BOAT_REPAIRED) quest.setStage(player, STAGE_SPOKEN_TO_KENNITH);
      if (stage === STAGE_LIT_TORCH) quest.setStage(player, STAGE_KENNITH_NEEDS_ESCAPE);
      if (stage === STAGE_PANEL_OPENED) quest.setStage(player, STAGE_NEEDS_CRANE);
      return kennithVariant(stage);
    }
    if (npcId === BAILEY_NPC_ID) return baileyVariant(stage, player);
    if (npcId === KENT_NPC_ID) return kentVariant(stage);
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const firemaking = player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
    if (value.includes("firemaking level is less than 30")) return firemaking < 30;
    if (value.includes("firemaking level is 30 or above")) return firemaking >= 30;
    if (value.includes("no space in their inventory")) return inventory.isFull();
    if (value.includes("one free space in their")) {
      // Bailey's hand-out: the player has room for the torch and has not had it yet.
      return !inventory.isFull() && quest.getStage(player) === STAGE_SPOKEN_TO_KENT;
    }
    if (value.includes("already has one swamp paste")) return inventory.getAmount(SWAMP_PASTE_ITEM_ID) >= 1;
    if (value.includes("does not have swamp tar")) return !held(player, ItemIdentifiers.SWAMP_TAR);
    if (value.includes("has swamp tar")) return held(player, ItemIdentifiers.SWAMP_TAR);
    if (value.includes("loses their unlit torch")) {
      // Only after the torch stage: before it the player never carried one.
      return quest.getStage(player) >= STAGE_LIT_TORCH && !held(player, UNLIT_TORCH_ITEM_ID);
    }
    if (value.includes("has an unlit torch")) return held(player, UNLIT_TORCH_ITEM_ID);
    if (value.includes("does not have an unlit torch")) return !held(player, UNLIT_TORCH_ITEM_ID);
    if (value.includes("no sea slugs or fishermen nearby")) return true;
    if (value.includes("sea slugs or fishermen nearby")) return false;
    if (value.includes("kicks the loose panel near kennith after talking to bailey")) {
      return quest.getStage(player) >= STAGE_KENNITH_NEEDS_ESCAPE;
    }
    if (value.includes("kicks the loose panel near kennith")) {
      return quest.getStage(player) < STAGE_KENNITH_NEEDS_ESCAPE;
    }
    if (value.includes("too far away from the crane")) return !atCraneControls(player);
    if (value.includes("one tile from the crane")) return atCraneControls(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CAROLINE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Register a player-owned quest item when a dialogue handout cannot fit. */
  function registerPlayerGroundItem(player, itemId, position) {
    const manager = api.getItemOnGroundManager?.();
    const privateArea = player.getPrivateArea?.() ?? null;
    if (manager?.getGroundItem?.(player.getUsername(), itemId, position, privateArea)) return false;
    if (!manager?.registerLocation) return false;
    manager.registerLocation(player, new api.core.Item(itemId, 1), position);
    return true;
  }

  function grantUnlitTorch(player) {
    if (held(player, UNLIT_TORCH_ITEM_ID) || held(player, LIT_TORCH_ITEM_ID)) return;
    player.getInventory().adds(UNLIT_TORCH_ITEM_ID, 1);
  }

  /** ab-u4V: full bag, so the torch goes to the floor instead of being lost. */
  function dropUnlitTorch(player) {
    if (held(player, UNLIT_TORCH_ITEM_ID) || held(player, LIT_TORCH_ITEM_ID)) return;
    registerPlayerGroundItem(player, UNLIT_TORCH_ITEM_ID, player.getLocation().clone());
  }

  /** Hands a crossing to the Ferries plugin's rowing trip; without it, the plain move. */
  function row(player, route, fallback) {
    const request = { player, route, handled: false };
    api.emitCustomEvent("ferries:travel", request);
    if (!request.handled && fallback) player.moveTo(new api.core.Location(fallback.x, fallback.y, fallback.z));
    return request.handled;
  }

  const ROUTE_FALLBACK = {
    [ROUTE_PLATFORM]: PLATFORM_TILE,
    [ROUTE_ISLAND]: ISLAND_TILE,
    [ROUTE_ISLAND_RETURN]: PLATFORM_TILE,
    [ROUTE_WITCHAVEN]: SHORE_TILE,
  };

  /** A transcript travel step: the trip replaces the step's own message, which is the box it lands with. */
  function travelStep(event) {
    const route = TRAVEL_STEPS[event.stepId];
    if (!route) return false;
    event.handled = true;
    event.end = true;
    if (route === ROUTE_ISLAND) advance(event.player, STAGE_SPOKEN_TO_KENNITH, STAGE_SAILED_TO_KENT);
    row(event.player, route, ROUTE_FALLBACK[route]);
    return true;
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (Scenes.marker(event)) return;
    if (stepId === COMPLETE_ACTION_ID) {
      if (npcId === CAROLINE_NPC_ID && !quest.isComplete(player)) {
        if (quest.getStage(player) < STAGE_SAVED_KENNITH) return;
        quest.complete(player);
      }
      return;
    }
    if (stepId === KENT_ACTION_ID && npcId === KENT_NPC_ID) {
      if (quest.getStage(player) >= STAGE_SPOKEN_TO_KENT) return;
      quest.setStage(player, STAGE_SPOKEN_TO_KENT);
      // Live closes the conversation here and Kent calls the player back three ticks later.
      event.handled = true;
      event.end = true;
      Scenes.startKent(player, event.npc, npcId, KENT_FIRST_VARIANT);
      return;
    }
    if (travelStep(event)) return;
    if (stepId === SWAMP_PASTE_GIVEN_STEP_ID && HOLGART_NPC_IDS.has(npcId)) {
      handSwampPaste(player);
      return;
    }
    if (stepId === BOAT_REPAIR_ACTION_ID && HOLGART_NPC_IDS.has(npcId)) {
      // The overhead lines after it belong to the cutscene; the conversation ends here.
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) === STAGE_BOAT_REPAIRED) Scenes.boatRepair(player);
      return;
    }
    if (TORCH_BOX_STEP_IDS.has(stepId) && event.kind === "message") {
      event.box = { items: [UNLIT_TORCH_ITEM_ID] };
      return;
    }
    if (UNLIT_TORCH_RECEIVE_IDS.has(stepId)) {
      grantUnlitTorch(player);
      return;
    }
    if (stepId === UNLIT_TORCH_DROP_ACTION_ID) {
      dropUnlitTorch(player);
      return;
    }
    if (stepId === LADDER_SMACK_ACTION_ID) {
      event.handled = true;
      player.getCombat?.()?.getHitQueue?.()?.addPendingDamage?.([new HitDamage(LADDER_SMACK_DAMAGE, HitMask.RED)]);
    }
  }

  /** "You give Holgart the swamp paste.": the paste goes and the boat is mended (1 or 2 -> 3). */
  function handSwampPaste(player) {
    if (quest.getStage(player) >= STAGE_BOAT_REPAIRED || !held(player, SWAMP_PASTE_ITEM_ID)) return;
    player.getInventory().deleteNumber(SWAMP_PASTE_ITEM_ID, 1);
    quest.setStage(player, STAGE_BOAT_REPAIRED);
  }

  /**
   * The crane works from its controls on the north side (live: refused from 2769,3287 west of
   * it, tick 365; used from 2771,3291, tick 375, then the player steps to 2772,3291).
   * Ours: the whole north row counts, from those two samples.
   */
  function atCraneControls(player) {
    const location = player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return z === CRANE_FOOTPRINT.z && y === CRANE_FOOTPRINT.y1 + 1 &&
      x >= CRANE_FOOTPRINT.x0 && x <= CRANE_FOOTPRINT.x1;
  }

  function isCraneObjectLocation(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return z === CRANE_FOOTPRINT.z && x >= CRANE_FOOTPRINT.x0 && x <= CRANE_FOOTPRINT.x1 &&
      y >= CRANE_FOOTPRINT.y0 && y <= CRANE_FOOTPRINT.y1;
  }

  const within = (position, tile, radius) =>
    Math.max(Math.abs(position.getX() - tile.x), Math.abs(position.getY() - tile.y)) <= radius;

  /** Holgart's Travel option: the crossing the current stage's Talk-to offers, without words. */
  function handleHolgartTravel({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BOAT_REPAIRED) return false;
    const position = player.getLocation();
    if (within(position, ISLAND_TILE, 16)) return row(player, ROUTE_ISLAND_RETURN, PLATFORM_TILE);
    if (within(position, PLATFORM_TILE, 16)) {
      // Ours: the stage 4 Talk-to is the only captured way to the island.
      if (stage === STAGE_SPOKEN_TO_KENNITH) {
        advance(player, STAGE_SPOKEN_TO_KENNITH, STAGE_SAILED_TO_KENT);
        return row(player, ROUTE_ISLAND, ISLAND_TILE);
      }
      return row(player, ROUTE_WITCHAVEN, SHORE_TILE);
    }
    if (within(position, SHORE_TILE, 16)) return row(player, ROUTE_PLATFORM, PLATFORM_TILE);
    return false;
  }

  /** Use Broken glass on Damp sticks: the sticks dry (the glass is kept, capture tick 276). */
  function handleGlassOnSticks(event) {
    const { player } = event;
    const inventory = player.getInventory();
    inventory.deleteNumber(ItemIdentifiers.DAMP_STICKS, 1);
    inventory.adds(DRY_STICKS_ITEM_ID, 1);
    player.performAnimation?.(new Animation(DRYING_SEQ, DRYING_DELAY));
    player.performGraphic?.(new Graphic(DRYING_GRAPHIC, DRYING_DELAY));
    player.getPacketSender().sendSound(DRYING_SOUND, 1, DRYING_DELAY);
    event.handled = true;
  }

  /** OSRS torch-lighting success: 198/256 at 30, 256/256 from 43 (wiki chart). */
  function torchLightChance(firemaking) {
    if (firemaking >= TORCH_LIGHT_MAX_LEVEL) return 1;
    if (firemaking <= FIREMAKING_REQUIREMENT) return TORCH_LIGHT_CHANCE_AT_30;
    const steps = TORCH_LIGHT_MAX_LEVEL - FIREMAKING_REQUIREMENT;
    return (198 + Math.round(((firemaking - FIREMAKING_REQUIREMENT) * 58) / steps)) / 256;
  }

  /** Dry sticks' "Rub-together": light the unlit torch (30 Firemaking), stage 6 -> 7. */
  function handleRubSticks(event) {
    const { player } = event;
    const inventory = player.getInventory();
    const firemaking = player.getSkillManager().getCurrentLevel(Skill.FIREMAKING);
    if (firemaking < FIREMAKING_REQUIREMENT) {
      player.sendMessage("You rub together the dry sticks but nothing happens.");
      player.sendMessage("You need a Firemaking level of 30 or above.");
      event.handled = true;
      return;
    }
    const lit = Math.random() < torchLightChance(firemaking);
    if (!lit) {
      player.sendMessage("You rub together the dry sticks and the sticks smoke momentarily then die out.");
      event.handled = true;
      return;
    }
    player.sendMessage("You rub together the dry sticks and the sticks catch alight.");
    if (!held(player, UNLIT_TORCH_ITEM_ID)) {
      // The transcript's no-torch branch dies out; keep the sticks so the player
      // can still light the torch after Bailey replaces it.
      player.sendMessage("The sticks smoke momentarily then die out.");
      event.handled = true;
      return;
    }
    // The dry sticks stay in the pack: only the torch changes (capture tick 297).
    player.sendMessage("You place the smoulding twigs to your torch.");
    player.sendMessage("Your torch lights.");
    inventory.deleteNumber(UNLIT_TORCH_ITEM_ID, 1);
    inventory.adds(LIT_TORCH_ITEM_ID, 1);
    player.getPacketSender().sendSound(TORCH_LIT_SOUND, 1, 0);
    advance(player, STAGE_SPOKEN_TO_KENT, STAGE_LIT_TORCH);
    event.handled = true;
  }

  /** The loose panel's Kick: at stage 8 the timed kick; before, the transcript's "nothing interesting". */
  function kickPanel(player) {
    if (quest.getStage(player) === STAGE_KENNITH_NEEDS_ESCAPE) {
      Scenes.kickPanel(player);
      return;
    }
    if (quest.getStage(player) < STAGE_KENNITH_NEEDS_ESCAPE) {
      // Ours: the same kick as stage 8's; the transcript's lines say the player kicks it.
      player.performAnimation(new Animation(Scenes.PANEL.kickSeq));
      player.getPacketSender().sendSound(Scenes.PANEL.kickSound, 1, 0);
      startTranscript(api, player, NpcIdentifiers.KENNITH, PAGE, "at-the-fishing-platform-subsequent-dialogue-with-kennith",
        (steps) => steps.filter((step) => step?.id === "tVEAUZ"));
    }
  }

  function rotateCrane(player) {
    if (quest.getStage(player) !== STAGE_NEEDS_CRANE) {
      // The transcript's "If the player rotates the crane upstairs" line, before it is needed.
      startTranscript(api, player, BAILEY_NPC_ID, PAGE, "rescuing-kennith-interacting-with-the-items",
        (steps) => steps.filter((step) => step?.id === "na1ZP2"));
      return;
    }
    if (atCraneControls(player)) Scenes.crane(player);
    else startTranscript(api, player, BAILEY_NPC_ID, PAGE, CRANE_FAR_VARIANT);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === LOOSE_PANEL_OBJECT_ID) {
      event.handled = true;
      kickPanel(player);
      return;
    }
    if (objectId === CRANE_OBJECT_ID && isCraneObjectLocation(event.object?.getLocation?.() ?? event.location)) {
      if (quest.getStage(player) >= STAGE_COMPLETE) return;
      event.handled = true;
      rotateCrane(player);
    }
  }

  /**
   * The platform ladder while the fishermen are possessed (stages 6-10): with the lit torch the
   * climb lands with "The fishermen seem afraid of your torch." (capture tick 303); without it
   * the transcript's unlit-torch lines play and the climb is refused.
   */
  function climbPlatformLadder(request) {
    if (request.objectId !== PLATFORM_LADDER_OBJECT_ID || request.handled) return;
    const { player } = request;
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_KENT || stage >= STAGE_SAVED_KENNITH) return;
    if (player.getLocation().getX() < PLATFORM_MIN_X) return;
    request.handled = true;
    if (!held(player, LIT_TORCH_ITEM_ID)) {
      startTranscript(api, player, BAILEY_NPC_ID, PAGE, UNLIT_LADDER_VARIANT);
      return;
    }
    api.emitCustomEvent("ladders:climbUp", {
      player, object: request.object, objectId: request.objectId,
      location: locationOf(request.object), onArrival: () => player.sendMessage(TORCH_LADDER_MESSAGE),
    });
  }

  function locationOf(object) {
    const location = object?.getLocation?.();
    return location ? { x: location.getX(), y: location.getY(), z: location.getZ() } : undefined;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "sea_slug",
    name: "Sea Slug",
    varpId: VARP_SEA_SLUG,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.FISHING.getIndex(), amount: 7175, label: "Fishing" }],
    rewardItemId: ItemIdentifiers.OYSTER_PEARLS,
    otherRewards: ["Fishing Platform Access", "Some Oyster Pearls"],
    scrollItemId: SCROLL_ITEM_ID,
    completionJingleId: COMPLETION_JINGLE,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("ladders:climb", climbPlatformLadder);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnItem(BROKEN_GLASS_ITEM_NAME, DAMP_STICKS_ITEM_NAME, handleGlassOnSticks, { noted: false });
  api.onItemAction(DRY_STICKS_ITEM_NAME, { [RUB_TOGETHER_OPTION]: handleRubSticks });
  api.onNpcInteraction("Holgart", { Travel: handleHolgartTravel });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(Scenes.interrupted);
};
