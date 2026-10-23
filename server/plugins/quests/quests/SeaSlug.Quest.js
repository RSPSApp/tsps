/**
 * Sea Slug (members).
 *
 * The words come from the "Sea Slug" transcript page. Caroline, Bailey, Kennith,
 * Kent and the four Holgart ids are all indexed, so this plugin supplies the
 * variant selector, the prose-condition answers, the start hook, the completion
 * action and the stage transitions the transcript does not carry (swamp-paste
 * hand-in, Kennith's escape, Kent's slug reveal).
 *
 * Stages (varp 159):
 *   1 started, 2 needs swamp paste, 3 boat repaired, 4 spoken to Kennith,
 *   5 sailed to Kent, 6 spoken to Kent, 7 lit torch, 8 Kennith needs escape,
 *   9 panel opened, 10 needs crane, 11 saved Kennith, 12 complete.
 *
 * The torch chain is wired directly: broken glass on damp sticks makes dry sticks, and
 * Dry sticks' "Rub-together" option lights the unlit torch (30 Firemaking) and advances
 * stage 6 -> 7. The loose panel and crane play the transcript and advance 8 -> 9 and
 * 10 -> 11. The cabin door steps through to Kennith's room: the map walls the doorway's
 * far tile off from the room with crates, so a plain one-tile cross leaves him unreachable.
 * The platform Holgart (cache id 5070) has no world spawn, so the quest owns him for its
 * players: he takes the player to the island at stage 4 and back to the shore at stage 11.
 * Gaps: the swamp-paste mixing recipe (flour + swamp tar on a fire) is not wired here.
 */
module.exports = function registerSeaSlugQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

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
  // The platform Holgart (cache id 5070, "Holgart (platform)", Talk-to + Travel) has no world
  // spawn, so the quest owns him for its own players on the fishing platform.
  const PLATFORM_HOLGART_NPC_ID = NpcIdentifiers.HOLGART_3; // 5070
  const PLATFORM_HOLGART_TILE = { x: 2781, y: 3274, z: 0 };

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

  // 18168 is a shared house-door id; only the fishing platform's placements (x >= 2750)
  // are claimed so Witchaven's houses keep the generic Doors plugin behaviour.
  const CABIN_DOOR_OBJECT_ID = 18168;
  const LOOSE_PANEL_OBJECT_ID = 18251;
  const CRANE_OBJECT_ID = 18327;
  const CRANE_FOOTPRINT = { x0: 2770, x1: 2773, y0: 3287, y1: 3290, z: 1 };
  const PLATFORM_MIN_X = 2750;
  const PLATFORM_TILE = { x: 2784, y: 3276, z: 0 };
  const ISLAND_TILE = { x: 2794, y: 3320, z: 0 };
  const SHORE_TILE = { x: 2720, y: 3305, z: 0 };

  // Kennith's cabin (z=1). Crates seal the tile behind the doorway off from the room, so the
  // crossing steps between the corridor and the cabin floor instead of one tile west.
  const CABIN_DOOR_TILE = { x: 2767, y: 3285, z: 1 };
  const CABIN_ROOM_TILE = { x: 2765, y: 3288, z: 1 };
  const CABIN_CORRIDOR_TILE = { x: 2768, y: 3285, z: 1 };

  const DAMP_STICKS_ITEM_ID = ItemIdentifiers.DAMP_STICKS;
  const DRY_STICKS_ITEM_ID = ItemIdentifiers.DRY_STICKS;
  const DAMP_STICKS_ITEM_NAME = "Damp sticks";
  const BROKEN_GLASS_ITEM_NAME = "Broken glass";
  const DRY_STICKS_ITEM_NAME = "Dry sticks";
  const RUB_TOGETHER_OPTION = "Rub-together";
  const FIREMAKING_REQUIREMENT = 30;
  // Wiki chart for lighting a torch: 77.34% (198/256) at level 30, 100% from level 43.
  const TORCH_LIGHT_CHANCE_AT_30 = 198 / 256;
  const TORCH_LIGHT_MAX_LEVEL = 43;

  const SAIL_TO_PLATFORM_STEP_ID = "46f1OE"; // "You arrive at the fishing platform."
  const SAIL_TO_ISLAND_STEP_ID = "zUdSJX"; // "You arrive on a small island."
  const SAIL_TO_SHORE_STEP_ID = "w8c3IN"; // "Holgart takes the player back to Witchaven."
  const RETURN_TO_PLATFORM_STEP_ID = "Jn71UA"; // "You arrive at the fishing platform."
  const RETURN_TO_SHORE_STEP_ID = "i9MI4w"; // "The boat arrives at Witchaven."
  const ARRIVAL_PLATFORM_MESSAGE = "You arrive at the fishing platform.";
  const ARRIVAL_SHORE_MESSAGE = "The boat arrives at Witchaven.";
  const UNLIT_TORCH_RECEIVE_IDS = new Set(["G6lOss", "o9pnQL"]);
  const UNLIT_TORCH_DROP_ACTION_ID = "ab-u4V"; // full bag: "The unlit torch is dropped to the ground."
  const TORCH_LIT_MESSAGE_ID = "mqmTA7"; // "Your torch lights."
  const PANEL_KICK_MESSAGE_IDS = new Set(["vJ1GjP", "NgGUPy", "5u-9os"]);
  const CRANE_MESSAGE_IDS = new Set(["utnJSh", "PGBTE0"]);

  const START_HOOK = "quest:sea-slug:start";
  const COMPLETE_ACTION_ID = "U0muMo";
  const KENT_ACTION_ID = "EkOxin";
  const PAGE = "Sea Slug";

  let quest;
  const platformHolgarts = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

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
      quest.setStage(player, STAGE_NEEDS_SWAMP_PASTE);
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
    if (stage === STAGE_SAILED_TO_KENT) return "at-the-shipwreck-island-talking-to-kent";
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
    if (value.includes("too far away from the crane")) {
      return quest.getStage(player) === STAGE_NEEDS_CRANE && craneDistance(player) > 1;
    }
    if (value.includes("one tile from the crane")) {
      return quest.getStage(player) === STAGE_NEEDS_CRANE && craneDistance(player) <= 1;
    }
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

  /**
   * The platform Holgart owns the stage 4 leg (he sails the player to the island) and the
   * stage 11 return. He is spawned for the player only, while the quest needs him there.
   */
  function removePlatformHolgart(player) {
    const npc = platformHolgarts.get(player);
    if (!npc) return;
    platformHolgarts.delete(player);
    api.removeNpc(npc);
  }

  function ensurePlatformHolgart(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_SPOKEN_TO_KENNITH || stage >= STAGE_COMPLETE) {
      removePlatformHolgart(player);
      return;
    }
    if (platformHolgarts.has(player)) return;
    const npc = api.spawnNpc({
      id: PLATFORM_HOLGART_NPC_ID,
      x: PLATFORM_HOLGART_TILE.x,
      y: PLATFORM_HOLGART_TILE.y,
      z: PLATFORM_HOLGART_TILE.z,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (npc) platformHolgarts.set(player, npc);
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

  function handleAction({ player, npcId, stepId }) {
    if (stepId === COMPLETE_ACTION_ID) {
      if (npcId === CAROLINE_NPC_ID && !quest.isComplete(player)) {
        if (quest.getStage(player) < STAGE_SAVED_KENNITH) return;
        quest.complete(player);
      }
      return;
    }
    if (stepId === KENT_ACTION_ID && npcId === KENT_NPC_ID) {
      if (quest.getStage(player) < STAGE_SPOKEN_TO_KENT) quest.setStage(player, STAGE_SPOKEN_TO_KENT);
      return;
    }
    if (stepId === SAIL_TO_PLATFORM_STEP_ID) {
      player.moveTo(new api.core.Location(PLATFORM_TILE.x, PLATFORM_TILE.y, PLATFORM_TILE.z));
      return;
    }
    if (stepId === SAIL_TO_ISLAND_STEP_ID) {
      if (quest.getStage(player) < STAGE_SAILED_TO_KENT) quest.setStage(player, STAGE_SAILED_TO_KENT);
      player.moveTo(new api.core.Location(ISLAND_TILE.x, ISLAND_TILE.y, ISLAND_TILE.z));
      return;
    }
    if (stepId === SAIL_TO_SHORE_STEP_ID) {
      player.moveTo(new api.core.Location(SHORE_TILE.x, SHORE_TILE.y, SHORE_TILE.z));
      return;
    }
    if (stepId === RETURN_TO_PLATFORM_STEP_ID) {
      player.moveTo(new api.core.Location(PLATFORM_TILE.x, PLATFORM_TILE.y, PLATFORM_TILE.z));
      return;
    }
    if (stepId === RETURN_TO_SHORE_STEP_ID) {
      player.moveTo(new api.core.Location(SHORE_TILE.x, SHORE_TILE.y, SHORE_TILE.z));
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
    if (stepId === TORCH_LIT_MESSAGE_ID) {
      if (!held(player, LIT_TORCH_ITEM_ID)) {
        player.getInventory().deleteNumber(UNLIT_TORCH_ITEM_ID, 1);
        player.getInventory().adds(LIT_TORCH_ITEM_ID, 1);
      }
      if (quest.getStage(player) === STAGE_SPOKEN_TO_KENT) quest.setStage(player, STAGE_LIT_TORCH);
      return;
    }
    if (PANEL_KICK_MESSAGE_IDS.has(stepId)) {
      if (quest.getStage(player) === STAGE_KENNITH_NEEDS_ESCAPE) quest.setStage(player, STAGE_PANEL_OPENED);
      return;
    }
    if (CRANE_MESSAGE_IDS.has(stepId)) {
      if (quest.getStage(player) === STAGE_NEEDS_CRANE) quest.setStage(player, STAGE_SAVED_KENNITH);
    }
  }

  /** Holgart's "already has one swamp paste" branch: hand it over, fix the boat. */
  function handleCondition({ player, npcId, stepId }) {
    if (stepId !== "u-qtrY" || !HOLGART_NPC_IDS.has(npcId)) return;
    if (!held(player, SWAMP_PASTE_ITEM_ID)) return;
    player.getInventory().deleteNumber(SWAMP_PASTE_ITEM_ID, 1);
    quest.setStage(player, STAGE_BOAT_REPAIRED);
  }

  function isCabinDoor(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return Number(x) === CABIN_DOOR_TILE.x &&
      Number(y) === CABIN_DOOR_TILE.y &&
      Number(z) === CABIN_DOOR_TILE.z;
  }

  function craneDistance(player) {
    const location = player.getLocation?.();
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    if (![x, y, z].every(Number.isFinite) || z !== CRANE_FOOTPRINT.z) return Infinity;
    const dx = Math.max(CRANE_FOOTPRINT.x0 - x, 0, x - CRANE_FOOTPRINT.x1);
    const dy = Math.max(CRANE_FOOTPRINT.y0 - y, 0, y - CRANE_FOOTPRINT.y1);
    return Math.max(dx, dy);
  }

  function isCraneObjectLocation(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return z === CRANE_FOOTPRINT.z && x >= CRANE_FOOTPRINT.x0 && x <= CRANE_FOOTPRINT.x1 &&
      y >= CRANE_FOOTPRINT.y0 && y <= CRANE_FOOTPRINT.y1;
  }

  function insideCabin(location) {
    return location.getZ() === CABIN_DOOR_TILE.z &&
      location.getX() <= CABIN_DOOR_TILE.x &&
      location.getY() >= CABIN_DOOR_TILE.y + 3;
  }

  /**
   * Doors in north-south walls (face 0/2) are crossed in x, others in y. The walk route
   * parks the player on the door tile, which counts as the east side, so a tie heads west,
   * through the doorway. The cabin door skips to the cabin floor: its far tile is boxed in
   * by crates and would leave Kennith sealed away.
   */
  function crossDoor(event) {
    const { player, location } = event;
    const position = player.getLocation();
    if (isCabinDoor(location)) {
      const destination = insideCabin(position) ? CABIN_CORRIDOR_TILE : CABIN_ROOM_TILE;
      player.moveTo(new api.core.Location(destination.x, destination.y, destination.z));
      return;
    }
    if ((Number(event.object?.getFace?.() ?? 1) & 1) === 0) {
      // West of the door crosses east; the door tile itself counts as the east side.
      const destinationX = position.getX() < location.x ? location.x + 1 : location.x - 1;
      player.moveTo(new api.core.Location(destinationX, position.getY(), location.z));
      return;
    }
    const destinationY = position.getY() >= location.y ? location.y - 1 : location.y + 1;
    player.moveTo(new api.core.Location(position.getX(), destinationY, location.z));
  }

  /**
   * The cabin can only be left by the door, whose tile the crates put out of reach from
   * inside; route the click to the cabin floor so the interaction still fires, then
   * crossDoor moves the player out.
   */
  function routeCabinDoor(event) {
    if (event.objectId !== CABIN_DOOR_OBJECT_ID || !event.sourceLocation) return;
    if (!isCabinDoor(event.object?.getLocation?.())) return;
    const from = event.sourceLocation;
    event.destination = from.z === CABIN_DOOR_TILE.z &&
      from.x <= CABIN_DOOR_TILE.x && from.y >= CABIN_DOOR_TILE.y + 3
      ? { x: CABIN_ROOM_TILE.x, y: CABIN_ROOM_TILE.y, z: CABIN_ROOM_TILE.z }
      : { x: CABIN_DOOR_TILE.x, y: CABIN_DOOR_TILE.y, z: CABIN_DOOR_TILE.z };
  }

  const within = (position, tile, radius) =>
    Math.max(Math.abs(position.getX() - tile.x), Math.abs(position.getY() - tile.y)) <= radius;

  function moveToTile(player, tile) {
    player.moveTo(new api.core.Location(tile.x, tile.y, tile.z));
  }

  function arriveAt(player, tile, message) {
    player.sendMessage(message);
    moveToTile(player, tile);
  }

  function sailToIsland(player) {
    if (quest.getStage(player) < STAGE_SAILED_TO_KENT) quest.setStage(player, STAGE_SAILED_TO_KENT);
    moveToTile(player, ISLAND_TILE);
  }

  /** Holgart's Travel option: the trip the current stage's Talk-to offers, without words. */
  function handleHolgartTravel({ player }) {
    if (quest.getStage(player) < STAGE_BOAT_REPAIRED) return false;
    const position = player.getLocation();
    if (within(position, ISLAND_TILE, 16)) {
      arriveAt(player, PLATFORM_TILE, ARRIVAL_PLATFORM_MESSAGE);
      return true;
    }
    if (within(position, PLATFORM_TILE, 16)) {
      if (quest.getStage(player) === STAGE_SPOKEN_TO_KENNITH) {
        sailToIsland(player);
      } else {
        arriveAt(player, SHORE_TILE, ARRIVAL_SHORE_MESSAGE);
      }
      return true;
    }
    if (within(position, SHORE_TILE, 16)) {
      arriveAt(player, PLATFORM_TILE, ARRIVAL_PLATFORM_MESSAGE);
      return true;
    }
    return false;
  }

  /** Use Broken glass on Damp sticks: both are consumed, a pair of dry sticks is left. */
  function handleGlassOnSticks(event) {
    const inventory = event.player.getInventory();
    inventory.deleteNumber(event.usedItemId, 1);
    inventory.deleteNumber(event.usedWithItemId, 1);
    inventory.adds(DRY_STICKS_ITEM_ID, 1);
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
    inventory.deleteNumber(DRY_STICKS_ITEM_ID, 1);
    player.sendMessage("You place the smoulding twigs to your torch.");
    player.sendMessage("Your torch lights.");
    inventory.deleteNumber(UNLIT_TORCH_ITEM_ID, 1);
    inventory.adds(LIT_TORCH_ITEM_ID, 1);
    if (quest.getStage(player) === STAGE_SPOKEN_TO_KENT) quest.setStage(player, STAGE_LIT_TORCH);
    event.handled = true;
  }

  /** Doors' name hook claims most "Door" locs, so claim the platform cabin first. */
  function handleDoorToggle(event) {
    if (event.objectId !== CABIN_DOOR_OBJECT_ID || event.location.x < PLATFORM_MIN_X) return;
    event.handled = true;
    crossDoor(event);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === CABIN_DOOR_OBJECT_ID) {
      if (event.location.x < PLATFORM_MIN_X) return;
      event.handled = true;
      crossDoor(event);
      return;
    }
    if (objectId === LOOSE_PANEL_OBJECT_ID) {
      event.handled = true;
      startTranscript(api, player, BAILEY_NPC_ID, PAGE, "freeing-kennith");
      return;
    }
    if (objectId === CRANE_OBJECT_ID && quest.getStage(player) === STAGE_NEEDS_CRANE &&
      isCraneObjectLocation(event.object?.getLocation?.() ?? event.location)) {
      event.handled = true;
      startTranscript(api, player, BAILEY_NPC_ID, PAGE, "freeing-kennith-using-the-crane");
    }
  }

  function handleStageChanged({ player, key, stage }) {
    if (key !== "sea_slug") return;
    ensurePlatformHolgart(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensurePlatformHolgart(player);
  }

  function handleLogout({ player }) {
    removePlatformHolgart(player);
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
    rewardItemLabel: "Oyster pearls",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(routeCabinDoor);
  api.onItemOnItem(BROKEN_GLASS_ITEM_NAME, DAMP_STICKS_ITEM_NAME, handleGlassOnSticks, { noted: false });
  api.onItemAction(DRY_STICKS_ITEM_NAME, { [RUB_TOGETHER_OPTION]: handleRubSticks });
  api.onNpcInteraction("Holgart", { Travel: handleHolgartTravel });
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
