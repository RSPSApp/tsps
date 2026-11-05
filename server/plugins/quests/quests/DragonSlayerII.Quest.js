/** Dragon Slayer II: the transcript supplies the conversations; this plugin owns the quest state and world actions. */
const NPC_TRANSCRIPTS = require("../../../data/definitions/npc-dialogues.json");
const ONEIROMANCER_IDS = new Set([3835, 8049]);
// Static NPC spawns in the Ancient Cavern orb room; their cache variants use varbits 6109–6111.
const FORGE_HEADS = new Map([[7506, { bit: 1, varbit: 6109 }], [7507, { bit: 2, varbit: 6110 }], [7508, { bit: 4, varbit: 6111 }]]);

function oneiromancerDialogueVariant({ npcId, stage, dreamProgress, hasDreamPotion }) {
  if (!ONEIROMANCER_IDS.has(npcId)) return null;
  if (stage === 7) {
    if (dreamProgress < 2) return null;
    return hasDreamPotion
      ? "robert-the-strong-talking-to-the-oneiromancer-before-making-the-dream-potion-talking-to-her-after-making-the-dream-potion"
      : "robert-the-strong-talking-to-the-oneiromancer-before-making-the-dream-potion";
  }
  if (stage >= 11 && stage < 12) return "a-world-united-meeting-between-leaders";
  if (stage >= 12) return "the-assault-end-of-the-battle";
  return null;
}

function restoreSphinxGeneralTopic(steps) {
  const general = NPC_TRANSCRIPTS.Sphinx?.variants?.["standard-dialogue-with-a-cat-follower-or-in-the-inventory"];
  if (!general) return steps;
  const replace = (entries) => (entries ?? []).map((step) => ({
    ...step,
    options: step.options?.map((option) => ({
      ...option,
      steps: option.text === "Talk about something else." && !option.steps?.length
        ? JSON.parse(JSON.stringify(general))
        : replace(option.steps),
    })),
    steps: step.steps ? replace(step.steps) : step.steps,
  }));
  return replace(steps);
}

module.exports = function registerDragonSlayerII(api) {
  const { Skill, Location, Boundary, PrivateArea, TemplatedInstanceArea, GameObject, ObjectManager, NPC, World, PrayerHandler, HitDamage, HitMask, ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");
  const PAGE = "Dragon Slayer II";
  // The Lunar Isle ceremonial brazier is a cache multiloc with no generated
  // ObjectIdentifiers member; 17025 is the base id at (2072, 3911).
  const LUNAR_MOONCLAN_BRAZIER = 17025;
  const LUNAR_BOB_TILE = new Location(2074, 3912, 0);
  const S = { START: 1, KARAMJA: 2, TUNNEL: 3, MURAL: 4, MAP: 5, TO_LITHKREN: 6, DREAM: 7, KEYS: 8, FORGE: 9, LITHKREN: 10, LEADERS: 11, FLEET: 12, GALVEK: 13, COMPLETE: 14 };
  // DS2's native main-progress varbit uses the milestones consumed by cache NPC/loc
  // transforms and the client journal. Keep the plugin's compact stage enum private.
  const NATIVE_STAGE = { 0: 0, 1: 5, 2: 10, 3: 15, 4: 30, 5: 40, 6: 55, 7: 90,
    8: 125, 9: 130, 10: 135, 11: 140, 12: 170, 13: 200, 14: 215 };
  // QuestHelper maps the repair phase and each earned wave to these cache-visible milestones.
  const ASSAULT_NATIVE_STAGE = [180, 181, 182, 183, 184, 185, 186, 190, 191, 191, 195, 196, 196];
  const KEY_PARTS = [I.DRAGON_KEY_PIECE, I.DRAGON_KEY_PIECE_2, I.DRAGON_KEY_PIECE_3, I.DRAGON_KEY_PIECE_4];
  // RuneLite QH's DS2_VARROCK_BOOKCASE: the marked red census-book shelf.
  const RELDO_BOOKCASE_ID = 32462;
  const UNGAEL_NOTES = [I.OLD_NOTES, I.OLD_NOTES_2, I.OLD_NOTES_3, I.OLD_NOTES_4, I.OLD_NOTES_5, I.OLD_NOTES_6];
  const UNGAEL_LAB_SOURCE_X = 2248;
  const UNGAEL_LAB_SOURCE_Y = 10448;
  const UNGAEL_NOTE_OBJECTS = new Map([
    [O.ANCIENT_MACHINERY_2, { x: 2254, y: 10465, item: UNGAEL_NOTES[0] }],
    [O.ANCIENT_MACHINERY_3, { x: 2288, y: 10456, item: UNGAEL_NOTES[1] }],
    [O.ANCIENT_EQUIPMENT, { x: 2290, y: 10474, item: UNGAEL_NOTES[2] }],
    [O.ANCIENT_INCUBATOR, { x: 2273, y: 10476, item: UNGAEL_NOTES[3] }],
    [O.ANCIENT_EQUIPMENT_2, { x: 2273, y: 10455, item: UNGAEL_NOTES[4] }],
    [O.ANCIENT_INCUBATOR_2, { x: 2279, y: 10464, item: UNGAEL_NOTES[5] }],
  ]);
  const ASSAULT_DRAGONS = [
    { id: N.RED_DRAGON_8, x: 1695, y: 5665, z: 2 },
    { id: N.IRON_DRAGON_4, x: 1688, y: 5665, z: 1 },
    { id: N.BRUTAL_GREEN_DRAGON_2, x: 1679, y: 5665, z: 1 },
    { id: N.BLUE_DRAGON_14, x: 1662, y: 5661, z: 1 },
    { id: N.GREEN_DRAGON_11, x: 1649, y: 5662, z: 1 },
    { id: N.BLUE_DRAGON_14, x: 1642, y: 5660, z: 1 },
    { id: N.GREEN_DRAGON_11, x: 1635, y: 5666, z: 2 },
    { id: N.BLACK_DRAGON_13, x: 1655, y: 5688, z: 2 },
    { id: N.STEEL_DRAGON_5, x: 1668, y: 5698, z: 1 },
    { id: N.BRUTAL_RED_DRAGON_2, x: 1679, y: 5708, z: 2 },
    { id: N.MITHRIL_DRAGON_3, x: 1698, y: 5710, z: 1 },
    { id: N.ADAMANT_DRAGON, x: 1705, y: 5722, z: 0 },
    { id: N.RUNE_DRAGON_3, x: 1666, y: 5734, z: 0 },
  ];
  const FLEET_BOUNDARIES = [0, 1, 2, 3].map((plane) => new Boundary(1600, 1726, 5520, 5758, plane));
  const FLEET_BOAT_START = new Location(1702, 5543, 1);
  const FLEET_START = new Location(1696, 5665, 2);
  const TORFINN_FLEET = new Location(2640, 3697, 0);
  // shortcut: the Wiki documents the red-to-iron deck change but not its tile.
  // This cache-clear tile is reachable on both decks and sits beside the Iron dragon.
  const ASSAULT_LADDER = new Location(1687, 5665, 2);
  // QH routes through this cached gap to the lower deck; the south edge is the reachable approach.
  // The upper-deck path reaches the cache Gap tile itself; its south-side tiles
  // are blocked, so the click must execute from this QH waypoint.
  const ASSAULT_DROP_GAP = { id: O.GAP_40, x: 1668, y: 5704, z: 1,
    approach: { x: 1668, y: 5704, z: 1 }, landing: { x: 1668, y: 5707, z: 0 } };
  // shortcut: the cache Gap and QH's paired waypoints establish this return-deck edge.
  const ASSAULT_GALVEK_DECK_GAP = { id: O.GAP_40, x: 1655, y: 5682, z: 1,
    approach: { x: 1655, y: 5681, z: 1 }, landing: { x: 1655, y: 5684, z: 0 } };
  // shortcut: QH's route crosses the cached gap at1662,5689 from the isolated
  // ladder landing and reaches the lower deck at1665,5689; the cache has no
  // walkable intermediate tiles or paired ladder for this plane change.
  const ASSAULT_MAIN_SHIP_GAP = { id: O.GAP_39, x: 1662, y: 5689, z: 1,
    approach: { x: 1658, y: 5688, z: 1 }, landing: { x: 1665, y: 5689, z: 0 } };
  // shortcut: QH's route crosses this wreck gap from the upper deck to the lower deck;
  // the cache has no paired ladder at this transition, so preserve its documented waypoints.
  const ASSAULT_MITHRIL_GAP = { id: O.GAP_39, x: 1679, y: 5708, z: 2,
    approach: { x: 1679, y: 5708, z: 2 }, landing: { x: 1690, y: 5708, z: 1 } };
  // shortcut: the cache marks the route's deck change with this gap; its QH landing is two tiles south.
  const ASSAULT_ADAMANT_GAP = { id: O.GAP_40, x: 1698, y: 5710, z: 1,
    approach: { x: 1697, y: 5710, z: 1 }, landing: { x: 1698, y: 5712, z: 0 } };
  // RuneLite QuestHelper's post-Adamant route clicks this cache gap from the wreckage tile
  // and lands on the upper plank, then continues north across the ship.
  const ASSAULT_RUNE_GAP = { id: O.GAP_40, x: 1706, y: 5722, z: 0,
    approach: { x: 1705, y: 5722, z: 0 }, landing: { x: 1708, y: 5723, z: 1 } };
  // shortcut: QH follows the upper deck at 1708,5728,1 and the lower deck at
  // 1708,5729,0; the reachable south approach is inferred from the cache footprint.
  const ASSAULT_RUNE_SHIP = { id: O.SHIP, x: 1708, y: 5726, z: 1,
    approach: { x: 1708, y: 5725, z: 1 }, landing: { x: 1708, y: 5729, z: 0 } };
  // shortcut: QH confirms the plane change but does not document the jump landing tile.
  const ASSAULT_RUNE_FINAL_GAP = { id: O.GAP_39, x: 1697, y: 5737, z: 2,
    approach: { x: 1698, y: 5737, z: 2 }, landing: { x: 1696, y: 5737, z: 0 } };
  // shortcut: this cache rope ladder is the QH plane-0 to plane-2 transition at 1704,5739.
  const ASSAULT_RUNE_ROPE_LADDER = { id: O.ROPE_LADDER_6, x: 1704, y: 5739, z: 0,
    landing: { x: 1704, y: 5739, z: 2 } };
  const ASSAULT_RUNE_WEST_GAP = { id: O.GAP_40, x: 1688, y: 5737, z: 0,
    approach: { x: 1689, y: 5737, z: 0 }, landing: { x: 1687, y: 5738, z: 0 } };
  // shortcut: these west-return links follow QH's ordered waypoints across the
  // cache wreckage and gaps; the map has no continuous walkable deck between them.
  const ASSAULT_RUNE_RETURN_GAP = { id: O.GAP_40, x: 1659, y: 5733, z: 0,
    approach: { x: 1660, y: 5734, z: 0 }, landing: { x: 1657, y: 5733, z: 1 } };
  const ASSAULT_RUNE_WEST_DROP_GAP = { id: O.GAP_40, x: 1657, y: 5725, z: 1,
    approach: { x: 1657, y: 5726, z: 1 }, landing: { x: 1657, y: 5724, z: 0 } };
  const ASSAULT_RUNE_WEST_RISE_GAP = { id: O.GAP_39, x: 1657, y: 5714, z: 0,
    approach: { x: 1657, y: 5717, z: 0 }, landing: { x: 1657, y: 5713, z: 1 } };
  const ASSAULT_RUNE_RETURN_DROP_GAP = { id: O.GAP_39, x: 1655, y: 5704, z: 1,
    approach: { x: 1656, y: 5704, z: 1 }, landing: { x: 1654, y: 5704, z: 0 } };
  const ASSAULT_RUNE_DEBRIS_CROSSES = [
    // shortcut: QH sends the player from the isolated lower-deck waypoint to
    // the real ladder at1668,5698; the cache debris is the only intervening crossing.
    { object: [1668, 5690, 0], from: [1668, 5689, 0], landing: [1668, 5695, 0] },
    // shortcut: the cache debris action is the only crossing between these QH deck waypoints.
    { object: [1709, 5730, 0], from: [1708, 5729, 0], landing: [1710, 5731, 0] },
    // shortcut: QH's west return crosses the real debris and wreckage between its waypoints.
    { object: [1657, 5723, 0], from: [1657, 5724, 0], landing: [1657, 5717, 0] },
    { object: [1653, 5703, 0], from: [1654, 5704, 0], landing: [1651, 5701, 0] },
  ];
  // The wreckage jump objects are the cache's intended links across the broken deck.
  // Their landing tiles follow the QH route through the wrecks; plain terrain walking
  // cannot cross these water gaps.
  const ASSAULT_WRECKAGE_JUMPS = [
    // shortcut: QH's board route crosses the cached broken plank immediately
    // north of Torfinn's lower-deck landing; both waypoints are from its route.
    { object: [1638, 5706, 0], from: [1637, 5706, 0], landing: [1640, 5706, 0] },
    // shortcut: QH's next lower-deck waypoint is the far side of this cached wreckage.
    { object: [1645, 5701, 0], from: [1640, 5706, 0], landing: [1645, 5701, 0] },
    // shortcut: QH's next waypoint after this cache wreckage is the upper-deck tile.
    { object: [1648, 5701, 0], from: [1645, 5701, 0], landing: [1647, 5681, 1] },
    // shortcut: QH's lower-deck waypoint lies across the cached wreckage at1655,5687.
    { object: [1655, 5687, 0], from: [1655, 5684, 0], landing: [1655, 5688, 0] },
    // shortcut: QH's next lower-deck waypoint is the far side of this cached wreckage.
    { object: [1668, 5689, 0], from: [1665, 5689, 0], landing: [1668, 5689, 0] },
    { object: [1698, 5715, 0], from: [1698, 5712, 0], landing: [1698, 5715, 0] },
    { object: [1668, 5710, 0], from: [1668, 5707, 0], landing: [1673, 5710, 0] },
    { object: [1702, 5722, 0], from: [1698, 5715, 0], landing: [1702, 5719, 0] },
    { object: [1705, 5722, 0], from: [1702, 5719, 0], landing: [1705, 5722, 0] },
    // shortcut: cache wreckage separates these QH waypoints across missing deck planks.
    { object: [1710, 5734, 0], from: [1710, 5731, 0], landing: [1705, 5739, 0] },
    { object: [1693, 5737, 0], from: [1696, 5737, 0], landing: [1688, 5737, 0] },
    // The QH world point is the Rune dragon's southwest footprint corner. Land
    // east of its 5x5 body so the player can actually select and attack it.
    { object: [1679, 5738, 0], from: [1687, 5738, 0], landing: [1676, 5738, 0] },
    // shortcut: the west return follows QH back across these cached wreckage links.
    { object: [1670, 5738, 0], from: [1676, 5738, 0], landing: [1670, 5738, 0] },
    { object: [1663, 5734, 0], from: [1670, 5738, 0], landing: [1666, 5734, 0] },
    { object: [1660, 5734, 0], from: [1666, 5734, 0], landing: [1660, 5734, 0] },
    // shortcut: these are the return direction across the board wreckage back to Torfinn.
    { object: [1645, 5701, 0], from: [1651, 5701, 0], landing: [1640, 5706, 0] },
    { object: [1638, 5706, 0], from: [1640, 5706, 0], landing: [1637, 5706, 0] },
  ];
  const FLEET_BOSS = new Location(1631, 5735, 2);
  const FLEET_RESUME = new Location(1637, 5706, 0);
  function isAssaultShipStage(player) {
    return stage(player) === S.FLEET || stage(player) === S.GALVEK;
  }
  const GALVEK_PHASES = [N.GALVEK_2, N.GALVEK_4, N.GALVEK_3, N.GALVEK_5];
  const ATTR_LEADERS = "dragon-slayer-ii:leaders";
  const ATTR_PARTS = "dragon-slayer-ii:key-parts";
  const ATTR_AREA = "dragon-slayer-ii:instance-area";
  const ATTR_KARAMJA_INSTANCE_ACTIVE = "dragon-slayer-ii:karamja-instance-active";
  const ATTR_BOSS = "dragon-slayer-ii:instance-boss";
  const ATTR_ASSAULT_INDEX = "dragon-slayer-ii:assault-index";
  const ATTR_ASSAULT_CHECKPOINT = "dragon-slayer-ii:assault-checkpoint";
  const ATTR_ASSAULT_DEFENSE_ACTIVE = "dragon-slayer-ii:assault-defense-active";
  const ATTR_ASSAULT_DEFENDED = "dragon-slayer-ii:assault-ship-defended";
  const QUEST_POINTS_ATTRIBUTE = "quest.points";
  const ATTR_MORYTANIA = "dragon-slayer-ii:morytania-step";
  const ATTR_ORB_TARGET = "dragon-slayer-ii:locator-target";
  const ATTR_VEOS_TRAVEL_DESTINATION = "dragon-slayer-ii:veos-travel-destination";
  const VEOS_NPC_IDS = new Set([
    N.VEOS, N.VEOS_2, N.VEOS_3, N.VEOS_4, N.VEOS_5, N.VEOS_6, N.VEOS_7, N.VEOS_8,
  ]);
  // The cache's named port arrivals are the reliable landing tiles for Veos's
  // two narrated destinations. The boat dialogue itself is transcript-driven.
  const VEOS_DESTINATIONS = {
    "I'd like to travel to Port Piscarilius, please.": new Location(1825, 3691, 0),
    "I'd like to travel to Land's End, please.": new Location(1504, 3401, 0),
  };
  const ATTR_MURAL_READ = "dragon-slayer-ii:mural-read";
  const ATTR_CRANDOR_BLOCKAGE_PROGRESS = "dragon-slayer-ii:crandor-blockage-progress";
  const ATTR_MURAL_GUARDIAN_DEFEATED = "dragon-slayer-ii:mural-guardian-defeated";
  const ATTR_FORGE_HEADS = "dragon-slayer-ii:forge-heads";
  const ATTR_UNGAEL_TRIP = "dragon-slayer-ii:ungael-trip";
  const ATTR_VORKATH_DEFEATED = "dragon-slayer-ii:vorkath-defeated";
  const VARBIT_UNGAEL_EXIT = 6108;
  // Cache loc 29873 changes to Investigate (32165), Mine (32167), then
  // Enter (32169) as native DS2 main progress varbit 6104 advances 15→20→25.
  const CRANDOR_BLOCKAGE_RIGHT = O.DRAGON_SLAYER_MINE_TUNNEL_RIGHT ?? 29873;
  const CRANDOR_BLOCKAGE_LEFT = O.DRAGON_SLAYER_MINE_TUNNEL_LEFT ?? 29896;
  const CRANDOR_BLOCKAGE_ACTIONS = new Set([
    CRANDOR_BLOCKAGE_RIGHT, CRANDOR_BLOCKAGE_LEFT,
    32165, 32166, 32167, 32168, 32169, 32170,
  ]);
  const ATTR_LAB_TIMER = "dragon-slayer-ii:lab-timer";
  const ATTR_UNGAEL_LAB_ACTIVE = "dragon-slayer-ii:ungael-lab-active";
  const ATTR_CRYPT_ACTIVE = "dragon-slayer-ii:kourend-crypt-active";
  const ATTR_CRYPT_READY = "dragon-slayer-ii:kourend-crypt-ready";
  const ATTR_CRYPT_ORDER = "dragon-slayer-ii:kourend-crypt-order";
  const ATTR_CRYPT_PLACED = "dragon-slayer-ii:kourend-crypt-placed";
  const ATTR_CRYPT_INSPECTED = "dragon-slayer-ii:kourend-crypt-inspected";
  const ATTR_CRYPT_KEY_COLLECTED = "dragon-slayer-ii:kourend-crypt-key-collected";
  const ATTR_NOTES_READ = "dragon-slayer-ii:notes-read";
  const ATTR_KARAMJA_JOURNAL = "dragon-slayer-ii:malumac-journal";
  const ATTR_ROWBOAT_BUILT = "dragon-slayer-ii:lithkren-rowboat-built";
  const ATTR_JARDRIC_TALKED = "dragon-slayer-ii:jardric-talked-about-lithkren";
  const ATTR_LITHKREN_ARRIVED = "dragon-slayer-ii:lithkren-arrived";
  const ATTR_LITHKREN_NATIVE_STAGE = "dragon-slayer-ii:lithkren-native-stage";
  const ATTR_LITHKREN_DALLAS_TALKED = "dragon-slayer-ii:lithkren-dallas-talked";
  const ATTR_VAULT_SCENE_ACTIVE = "dragon-slayer-ii:vault-scene-active";
  const ATTR_VAULT_SCENE_COMPLETE = "dragon-slayer-ii:vault-scene-complete";
  const ATTR_AIVAS_DIARY = "dragon-slayer-ii:aivas-diary";
  const ATTR_AIVAS_DIARY_FOUND = "dragon-slayer-ii:aivas-diary-found";
  const ATTR_DREAM_PROGRESS = "dragon-slayer-ii:dream-progress";
  const ATTR_MAP_FOUND = "dragon-slayer-ii:fossil-map-found";
  const ATTR_MAP_HANDED_IN = "dragon-slayer-ii:fossil-map-handed-in";
  const ATTR_MAP_SOLVED = "dragon-slayer-ii:fossil-map-solved";
  const ATTR_MAP_INTRODUCED = "dragon-slayer-ii:fossil-map-introduced";
  const ATTR_ANCIENT_DIARY_READ = "dragon-slayer-ii:ancient-diary-read";
  const ACTION_LITHKREN_DIARY_COMPLETE = "dragon-slayer-ii:lithkren-diary-complete";
  const ACTION_LITHKREN_DALLAS_COMPLETE = "dragon-slayer-ii:lithkren-dallas-complete";
  const MAP_PIECES = Array.from({ length: 24 }, (_, index) => (index === 0 ? I.MAP_PIECE : I[`MAP_PIECE_${index + 1}`]));
  const MAP_SOURCES = [
    { id: 29911, x: 3764, y: 3872, z: 0, first: 0, count: 5, label: "open stone chest" },
    { id: 29912, x: 3766, y: 3873, z: 1, first: 5, count: 3, label: "upstairs stone chest" },
    { id: 29913, x: 3755, y: 3873, z: 0, first: 8, count: 4, label: "fungi" },
    { id: 29914, x: 3764, y: 3861, z: 0, first: 12, count: 7, label: "hook briar" },
    { id: 29915, x: 3790, y: 3876, z: 0, first: 19, count: 5, label: "mushtree" },
  ];
  // 29910 is the actual cache placement on the map grid. The numbered IDs
  // are its map-piece transforms, which are not placed as separate locs.
  const MAP_OBJECT_IDS = new Set([29910, 32441, 32442, 32443, 32444]);
  // Cache CS2 2104/2106 and the DS2 map puzzle's current-position/current-rotation varbits.
  const MAP_POSITION_VARBITS = [6156, 6168, 6159, 6178, -1, 6203, 6173, 6167, 6158, 6169, 6208, 6199,
    6204, 6174, 6183, 6176, 6162, -1, -1, 6179, -1, 6180, 6182, 6175,
    6184, 6170, 6209, 6190, 6191, 6216, -1, 6217, 6198, 6171, 6200, 6211];
  const MAP_ROTATION_VARBITS = [6166, 6172, 6177, 6181, -1, 6197, 6201, 6202, 6160, 6161, 6163, 6164,
    6165, 6205, 6206, 6207, 6185, -1, -1, 6186, -1, 6187, 6188, 6189,
    6210, 6212, 6213, 6214, 6215, 6192, -1, 6193, 6194, 6195, 6196, 6218];
  const MAP_INTERFACE_GROUP = 305;
  const ATTR_MAP_POSITIONS = "dragon-slayer-ii:fossil-map-positions";
  const ATTR_MAP_ROTATIONS = "dragon-slayer-ii:fossil-map-rotations";
  const ATTR_MAP_PUZZLE_READY = "dragon-slayer-ii:fossil-map-puzzle-ready";
  const ACTION_MAP_COMPLETE = "dragon-slayer-ii:fossil-map-complete";
  const ATTR_GALVEK_DEFEATED = "dragon-slayer-ii:galvek-defeated";
  const ATTR_TRAINING_REWARDS = "dragon-slayer-ii:ellen-training-rewards";
  const DS2_COMBAT_LAMP_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS, Skill.RANGED, Skill.MAGIC];
  const ACTION_BOB_MEMORIES_COMPLETE = "dragon-slayer-ii:bob-memories-complete";
  const ACTION_BOB_FIRST_TALK_COMPLETE = "dragon-slayer-ii:bob-first-talk-complete";
  const ACTION_SPHINX_DREAM_COMPLETE = "dragon-slayer-ii:sphinx-dream-complete";
  // Cache loc29916 is a 2x3 multiloc at this anchor; QH's clickable waypoint
  // (3659,3849) is inside its footprint. Varbit6104 changes it from Build to Travel.
  const ROWBOAT_OBJECT_TILE = { x: 3658, y: 3848, z: 0 };
  const ROWBOAT_SPACE_TILE = { x: 3659, y: 3849, z: 0 };
  // QuestHelper's surface route continues at the courtyard stairs on Lithkren.
  const LITHKREN_LANDING = new Location(3559, 4004, 0);
  // The ancient doors lead into the Deep Lithkren vault, on the north edge of the
  // Ancient Cavern map. These are the cache/QH room bounds and entry tile.
  const DEEP_LITHKREN_BOUNDS = new Boundary(1539, 1596, 5059, 5107, 0);
  const DEEP_LITHKREN_ENTRY = new Location(1566, 5060, 0);
  const DEEP_LITHKREN_EXIT = new Location(3550, 10423, 0);
  const DEEP_LITHKREN_ACTORS = [
    { id: N.DALLAS_JONES_6, x: 1566, y: 5099 },
    { id: N.BOB_16, x: 1567, y: 5099 },
    { id: N.JARDRIC_8, x: 1564, y: 5098 },
    { id: N.ZORGOTH_5, x: 1568, y: 5101 },
    { id: N.GALVEK_6, x: 1570, y: 5103 },
  ];
  const KARAMJA_INSTANCE = { sourceChunkX: 352, sourceChunkY: 1150, widthChunks: 8, heightChunks: 13 };
  const KARAMJA_SOURCE = { x: 2816, y: 9200 };
  const KARAMJA_ENTRANCE = { x: 2943, y: 2894, z: 0 };
  const KARAMJA_EXIT = { x: 2942, y: 2892, z: 0 };
  const KARAMJA_START = { x: 2846, y: 9292, z: 0 };
  const KARAMJA_PLINTH = { x: 2848, y: 9248, z: 0 };
  const KARAMJA_GUARDIAN_BOX = { minX: 2816, maxX: 2880, minY: 9216, maxY: 9280 };
  const KARAMJA_TRAPS = new Set([O.TRAP_9, O.TRAP_10, O.TRAP_11, O.TRAP_12]);
  const spawnRows = require("../../../data/definitions/npc-spawns.json");
  let quest;
  let QuestArea;
  let DragonForgeHeadArea;
  let KaramjaArea;
  let UngaelLabArea;
  let KourendCryptArea;

  function defineArea() {
    DragonForgeHeadArea = class DragonForgeHeadArea extends api.core.Area {
      constructor() { super([new Boundary(1545, 1567, 4873, 4892, 0)]); }
      canCastOnNpc(player, npc, spell) {
        if (!FORGE_HEADS.has(npc?.getId?.())) return null;
        if (stage(player) !== S.FORGE) return false;
        return [api.core.CombatSpells.FIRE_WAVE.spellId(), api.core.CombatSpells.FIRE_SURGE.spellId()]
          .includes(spell?.spellId?.());
      }
    };
    QuestArea = class DragonSlayerIIArea extends PrivateArea {
      constructor(ownerName, boundaries) { super(Array.isArray(boundaries) ? boundaries : [boundaries]); this.ownerName = ownerName; }
      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (player.getAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE)) {
          processAssaultShip(this, player);
          return;
        }
        const boss = player.getAttribute(ATTR_BOSS);
        if (!boss) return;
        if ((boss.getRealId?.() ?? boss.getId?.()) === N.GALVEK_2 && stage(player) === S.GALVEK) {
          const playerLocation = player.getLocation?.();
          const bossLocation = boss.getLocation?.();
          // Galvek is created when the final dragon falls, but the player may
          // still be on a distant wreckage deck (or may have logged back in at
          // Torfinn). His arena attacks must only advance once the player has
          // actually reached the same deck.
          if (!playerLocation || !bossLocation || playerLocation.getZ() !== bossLocation.getZ()
            || Math.abs(playerLocation.getX() - bossLocation.getX()) > 12
            || Math.abs(playerLocation.getY() - bossLocation.getY()) > 12) {
            this.galvekHazard = null;
            return;
          }
          boss.getCombat().getLastAttack().reset();
          boss.setScriptedMovement(true);
          processGalvek(this, player, boss);
        }
      }
      destroy() {
        if (this.isDestroyed?.()) return;
        const addQueue = World.getAddNPCQueue(), removeQueue = World.getRemoveNPCQueue();
        for (const entity of this.entities) {
          if (!entity?.isNpc?.() || !entity.getAsNpc) continue;
          const npc = entity.getAsNpc();
          for (let i = addQueue.indexOf(npc); i >= 0; i = addQueue.indexOf(npc)) addQueue.splice(i, 1);
          if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
        }
        super.destroy();
      }
      postLeave(mobile, logout) {
        if (mobile?.isPlayer?.()) {
          const player = mobile.getAsPlayer();
          if (player.getAttribute(ATTR_AREA) === this) player.setAttribute(ATTR_AREA, null);
          player.setAttribute(ATTR_BOSS, null);
        }
        super.postLeave(mobile, logout);
      }
    };
    KaramjaArea = class DragonSlayerIIKaramjaArea extends TemplatedInstanceArea {
      constructor(owner) {
        super(KARAMJA_INSTANCE.widthChunks, KARAMJA_INSTANCE.heightChunks);
        this.owner = owner;
        for (let chunkX = 0; chunkX < KARAMJA_INSTANCE.widthChunks; chunkX++) {
          for (let chunkY = 0; chunkY < KARAMJA_INSTANCE.heightChunks; chunkY++) {
            for (let plane = 0; plane < 4; plane++) {
              this.setChunk(plane, chunkX, chunkY, {
                sourceChunkX: KARAMJA_INSTANCE.sourceChunkX + chunkX,
                sourceChunkY: KARAMJA_INSTANCE.sourceChunkY + chunkY,
                sourcePlane: plane,
                rotation: 0,
              });
            }
          }
        }
        this.plinth = null;
        let parts = Number(owner.getAttribute(ATTR_PARTS)) || 0;
        if ((parts & 1) && !has(owner, KEY_PARTS[0])) {
          parts &= ~1;
          owner.setAttribute(ATTR_PARTS, parts);
        }
        this.installPlinth(parts & 1 ? O.PLINTH_18 : O.PLINTH_17);
      }
      getName() { return "Karamjan Temple (Dragon Slayer II)"; }
      isMulti() { return true; }
      allowSummonPet() { return false; }
      installPlinth(id) {
        if (this.plinth) {
          ObjectManager.deregister(this.plinth, true);
          this.remove(this.plinth);
        }
        this.plinth = new GameObject(id, this.tile(KARAMJA_PLINTH.x - KARAMJA_SOURCE.x,
          KARAMJA_PLINTH.y - KARAMJA_SOURCE.y, KARAMJA_PLINTH.z), 10, 0, this);
        ObjectManager.register(this.plinth, true);
        this.add(this.plinth);
      }
      destroy() {
        if (this.isDestroyed()) return;
        for (const entity of [...this.entities]) {
          if (!entity?.isNpc?.() || !entity.getAsNpc) continue;
          const npc = entity.getAsNpc();
          for (let i = World.getAddNPCQueue().indexOf(npc); i >= 0; i = World.getAddNPCQueue().indexOf(npc)) World.getAddNPCQueue().splice(i, 1);
          if (npc.isRegistered?.() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
        }
        super.destroy();
      }
      postLeave(mobile, logout) {
        if (mobile?.isPlayer?.() && mobile.getAsPlayer().getAttribute(ATTR_AREA) === this) {
          mobile.getAsPlayer().setAttribute(ATTR_AREA, null);
          mobile.getAsPlayer().setAttribute(ATTR_BOSS, null);
        }
        super.postLeave(mobile, logout);
      }
    };
    UngaelLabArea = class DragonSlayerIIUngaelLabArea extends TemplatedInstanceArea {
      constructor(owner) {
        super(6, 4);
        this.owner = owner;
        for (let chunkX = 0; chunkX < 6; chunkX++) {
          for (let chunkY = 0; chunkY < 4; chunkY++) {
            for (let plane = 0; plane < 4; plane++) {
              this.setChunk(plane, chunkX, chunkY, {
                sourceChunkX: 281 + chunkX,
                sourceChunkY: 1306 + chunkY,
                sourcePlane: plane,
                rotation: 0,
              });
            }
          }
        }
      }
      getName() { return "Ungael laboratory (Dragon Slayer II)"; }
      allowSummonPet() { return false; }
      destroy() {
        if (this.isDestroyed()) return;
        for (const entity of [...this.entities]) {
          if (!entity?.isNpc?.() || !entity.getAsNpc) continue;
          const npc = entity.getAsNpc();
          for (let i = World.getAddNPCQueue().indexOf(npc); i >= 0; i = World.getAddNPCQueue().indexOf(npc)) World.getAddNPCQueue().splice(i, 1);
          if (npc.isRegistered?.() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
        }
        super.destroy();
      }
      postLeave(mobile, logout) {
        if (mobile?.isPlayer?.() && mobile.getAsPlayer().getAttribute(ATTR_AREA) === this) {
          mobile.getAsPlayer().setAttribute(ATTR_AREA, null);
          mobile.getAsPlayer().setAttribute(ATTR_BOSS, null);
        }
        super.postLeave(mobile, logout);
      }
    };
    KourendCryptArea = class DragonSlayerIIKourendCryptArea extends TemplatedInstanceArea {
      constructor(owner) {
        super(12, 8);
        this.owner = owner;
        for (let chunkX = 0; chunkX < 12; chunkX++) {
          for (let chunkY = 0; chunkY < 8; chunkY++) {
            for (let plane = 0; plane < 4; plane++) {
              this.setChunk(plane, chunkX, chunkY, {
                sourceChunkX: 184 + chunkX,
                sourceChunkY: 1240 + chunkY,
                sourcePlane: plane,
                rotation: 0,
              });
            }
          }
        }
      }
      getName() { return "Shayzien Crypts (Dragon Slayer II)"; }
      isMulti() { return true; }
      allowSummonPet() { return false; }
      destroy() {
        if (this.isDestroyed()) return;
        for (const entity of [...this.entities]) {
          if (!entity?.isNpc?.() || !entity.getAsNpc) continue;
          const npc = entity.getAsNpc();
          for (let i = World.getAddNPCQueue().indexOf(npc); i >= 0; i = World.getAddNPCQueue().indexOf(npc)) World.getAddNPCQueue().splice(i, 1);
          if (npc.isRegistered?.() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
        }
        for (const object of this.puzzleObjects ?? []) {
          ObjectManager.deregister(object, true);
          this.remove(object);
        }
        super.destroy();
      }
      postLeave(mobile, logout) {
        if (mobile?.isPlayer?.() && mobile.getAsPlayer().getAttribute(ATTR_AREA) === this) {
          mobile.getAsPlayer().setAttribute(ATTR_AREA, null);
          mobile.getAsPlayer().setAttribute(ATTR_BOSS, null);
        }
        super.postLeave(mobile, logout);
      }
    };
  }

  const stage = (p) => quest.getStage(p);
  const advance = (p, value) => { if (stage(p) < value) quest.setStage(p, value); };
  const has = (p, id, amount = 1) => p.getInventory().getAmount(id) >= amount;
  function give(p, id, amount = 1) {
    if (p.getInventory().getFreeSlots() < (amount > 1 ? 1 : 1)) { p.sendMessage("You need an empty inventory space."); return false; }
    p.getInventory().adds(id, amount); return true;
  }
  function remove(p, id, amount = 1) { p.getInventory().deleteNumber(id, amount); }
  function talk(p, npcId, variant, select) { return startTranscript(api, p, npcId, PAGE, variant, select); }
  function onNpcInteractions(names, actions) {
    for (const name of names) api.onNpcInteraction(name, actions);
  }
  function buildJournal(p) {
    const s = stage(p);
    if (s >= S.COMPLETE) return ["<str>I defeated Galvek and saved the kingdoms.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (s >= S.GALVEK) return [p.getAttribute(ATTR_GALVEK_DEFEATED)
      ? "Return to Alec Kincade at the Myths' Guild and report your victory."
      : "Defeat Galvek and report to the heroes aboard the ship."];
    if (s >= S.FLEET) return ["Help defend the allied fleet from Zorgoth and Galvek."];
    if (s >= S.LEADERS) return ["Gather the leaders of Misthalin, Asgarnia, Kandarin and the Fremennik Isles."];
    if (s >= S.LITHKREN) return ["Enter Lithkren with the completed dragon key and learn what Zorgoth plans."];
    if (s >= S.FORGE) return ["Take the dragon key to Lithkren."];
    if (s >= S.KEYS) return ["Find the four dragon key pieces and use an anvil to reforge them."];
    if (s === S.DREAM) {
      const progress = Number(p.getAttribute(ATTR_DREAM_PROGRESS)) || 0;
      if (progress === 0) return ["Find Bob the Cat, then meet him at the Sphinx in Sophanem to ask about Robert's memories."];
      if (progress === 1) return ["Meet Bob at the Sphinx in Sophanem, then travel to Lunar Isle."];
      return ["Speak to the Oneiromancer on Lunar Isle and make a dream potion to recover Robert's memories."];
    }
    if (s >= S.TO_LITHKREN) return ["Find Jardric at the Museum Camp and arrange a boat to Lithkren."];
    if (s >= S.MAP) return ["Find all 24 Fossil Island map pieces, give them to Dallas, and complete the map."];
    if (s >= S.MURAL) return ["Speak to Dallas Jones about the mural and report to the Oneiromancer."];
    if (s >= S.TUNNEL) return ["Investigate the blockage in the north-east of Elvarg's lair, then enter the passage."];
    if (s >= S.KARAMJA) return ["Use a pickaxe on the northern wall in Elvarg's lair."];
    if (s >= S.START) return ["Meet Dallas Jones at the Karamja pub."];
    return ["I can start this quest by talking to <col=800000>Alec Kincade</col> outside the <col=800000>Myths' Guild</col>."];
  }
  function startRequirements(player) {
    const requirements = [
      ["Magic", Skill.MAGIC, 75], ["Smithing", Skill.SMITHING, 70],
      ["Mining", Skill.MINING, 68], ["Crafting", Skill.CRAFTING, 62],
      ["Agility", Skill.AGILITY, 60], ["Thieving", Skill.THIEVING, 60],
      ["Construction", Skill.CONSTRUCTION, 50], ["Hitpoints", Skill.HITPOINTS, 50],
    ];
    const missingSkill = requirements.find(([, skill, level]) => player.getSkillManager().getMaxLevel(skill) < level);
    if (missingSkill) return { met: false, message: `You need ${missingSkill[2]} ${missingSkill[0]} to begin this quest.` };
    if ((Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) < 200) {
      return { met: false, message: "You need at least 200 Quest Points to begin this quest." };
    }
    const questRequirements = [
      ["legends_quest", "Legends' Quest"],
      ["dream_mentor", "Dream Mentor"],
      ["a_tail_of_two_cats", "A Tail of Two Cats"],
      ["animal_magnetism", "Animal Magnetism"],
      ["ghosts_ahoy", "Ghosts Ahoy"],
      ["bone_voyage", "Bone Voyage"],
      ["client_of_kourend", "Client of Kourend"],
    ];
    for (const [key, name] of questRequirements) {
      const prerequisite = { player, key, complete: false };
      api.emitCustomEvent("quest:is-complete", prerequisite);
      if (!prerequisite.complete) return { met: false, message: `You need to complete ${name} before starting this quest.` };
    }
    return { met: true };
  }
  function answerAlecStartRequirements({ player, npcId, stepId }) {
    if (npcId !== N.ALEC_KINCADE || !["5wzysS", "7iH3Yl"].includes(stepId)) return null;
    return startRequirements(player).met === (stepId === "7iH3Yl");
  }
  function talkAlec({ player: p, npcId }) {
    if (stage(p) === 0) {
      const check = startRequirements(p);
      if (!check.met) return p.sendMessage(check.message);
      talk(p, npcId, "starting-out-talking-to-alec-kincade"); advance(p, S.START);
    }
    else if (stage(p) === S.GALVEK && p.getAttribute(ATTR_GALVEK_DEFEATED)) talk(p, npcId, "finishing-up");
    else if (stage(p) < S.COMPLETE) talk(p, npcId, "starting-out-talking-to-alec-kincade-talking-to-alec-again");
    else talk(p, npcId, "finishing-up");
  }
  function talkDallas({ player: p, npcId }) {
    if (stage(p) < S.START) return false;
    if (stage(p) === S.START) { talk(p, npcId, "starting-out-talking-to-dallas-jones"); advance(p, S.KARAMJA); }
    else if (stage(p) === S.KARAMJA) {
      talk(p, npcId, "starting-out-talking-to-dallas-in-elvarg-s-lair");
      advance(p, S.TUNNEL);
      p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 15);
    }
    else if (stage(p) === S.MURAL) {
      talk(p, npcId, "starting-out-the-secret-laboratory-talking-to-dallas-after-inspecting-the-mural");
      if (p.getAttribute(ATTR_MURAL_READ)) {
        advance(p, S.MAP);
      }
    }
    else if (stage(p) === S.MAP && !p.getAttribute(ATTR_MAP_SOLVED)) {
      if (!p.getAttribute(ATTR_MAP_INTRODUCED)) {
        p.setAttribute(ATTR_MAP_INTRODUCED, true);
        talk(p, npcId, "the-house-on-the-hill-talking-to-dallas");
      } else {
        handInMapPieces(p);
        talk(p, npcId, "the-house-on-the-hill-searching-the-map-pieces", (steps) => {
          const addCompletionAction = (entries) => entries.map((entry) => {
            if (entry.type === "choice" && Array.isArray(entry.options)) {
              return { ...entry, options: entry.options.map((option) => ({
                ...option,
                steps: option.text === "Let's do it!"
                  ? [...option.steps, { type: "action", text: "The map is ready to complete.", id: ACTION_MAP_COMPLETE }]
                  : addCompletionAction(option.steps ?? []),
              })) };
            }
            return entry.steps ? { ...entry, steps: addCompletionAction(entry.steps) } : entry;
          });
          return addCompletionAction(steps);
        });
      }
    }
    else if (stage(p) === S.TO_LITHKREN && p.getAttribute(ATTR_LITHKREN_ARRIVED)) {
      if (p.getAttribute(ATTR_AIVAS_DIARY_FOUND)) {
        startTranscript(api, p, npcId, PAGE, "to-lithkren-talking-to-dallas-after-finding-aivas-diary", (steps) => {
          const condition = steps.find((step) => step.id === "SguGCm");
          if (!condition) return steps;
          const branch = condition.steps[p.getAttribute(ATTR_AIVAS_DIARY) ? 1 : 0];
          return [
            ...steps.flatMap((step) => step === condition ? (branch?.steps ?? []) : [step]),
            ...(p.getAttribute(ATTR_AIVAS_DIARY)
              ? [{ type: "action", text: "We should investigate Bob's memories.", id: ACTION_LITHKREN_DIARY_COMPLETE }]
              : []),
          ];
        });
      } else talk(p, npcId, "to-lithkren-talking-to-dallas-at-the-ancient-doors", (steps) => [
        ...steps,
        { type: "action", text: "We should search the nearby skeleton.", id: ACTION_LITHKREN_DALLAS_COMPLETE },
      ]);
    }
    else if (stage(p) === S.TO_LITHKREN && (!p.getAttribute(ATTR_LITHKREN_ARRIVED)
      && nearRowboat(p))) {
      talk(p, npcId, p.getAttribute(ATTR_ROWBOAT_BUILT)
        ? "to-lithkren-talking-to-dallas-at-the-rowboat-space-after-building-the-boat"
        : "to-lithkren-talking-to-dallas-at-the-rowboat-space");
    }
    else if (stage(p) >= S.KEYS && stage(p) < S.FORGE) talk(p, npcId, "the-house-on-the-hill-finishing-the-map-talking-to-dallas-again");
    else if (stage(p) >= S.LITHKREN) talk(p, npcId, "the-ultimate-weapon-talking-to-dallas");
  }
  function talkJardric({ player: p, npcId, location }) {
    if (stage(p) < S.TO_LITHKREN || stage(p) >= S.COMPLETE) return false;
    const here = location ?? p.getLocation();
    const x = here.getX?.() ?? here.x;
    const y = here.getY?.() ?? here.y;
    const atBoat = Math.max(Math.abs(x - ROWBOAT_SPACE_TILE.x), Math.abs(y - ROWBOAT_SPACE_TILE.y)) <= 12;
    const variant = atBoat ? "to-lithkren-talking-to-jardric-at-the-rowboat-space"
      : p.getAttribute(ATTR_ROWBOAT_BUILT) ? "to-lithkren-talking-to-jardric-talking-to-jardric-again"
        : "to-lithkren-talking-to-jardric";
    talk(p, npcId, variant);
    if (!p.getAttribute(ATTR_JARDRIC_TALKED)) {
      p.setAttribute(ATTR_JARDRIC_TALKED, true);
      p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, 60);
      p.getPacketSender?.().sendVarbit?.(6104, 60);
    }
  }
  function nearRowboat(p) {
    const loc = p.getLocation();
    return Math.max(Math.abs(loc.getX() - ROWBOAT_SPACE_TILE.x), Math.abs(loc.getY() - ROWBOAT_SPACE_TILE.y)) <= 20;
  }
  function bitCount(value) {
    let count = 0;
    for (let bits = Number(value) >>> 0; bits; bits &= bits - 1) count++;
    return count;
  }
  function handInMapPieces(p) {
    let handed = Number(p.getAttribute(ATTR_MAP_HANDED_IN)) || 0;
    for (let i = 0; i < MAP_PIECES.length; i++) {
      const bit = 1 << i;
      if ((handed & bit) || !has(p, MAP_PIECES[i])) continue;
      remove(p, MAP_PIECES[i]);
      handed |= bit;
    }
    p.setAttribute(ATTR_MAP_HANDED_IN, handed);
    if (bitCount(handed) > 0) p.sendMessage(`Dallas takes the map pieces. ${24 - bitCount(handed)} pieces remain to be found.`);
    return bitCount(handed);
  }
  function searchFossilMapSource({ player: p, objectId, location }) {
    if (stage(p) !== S.MAP || p.getAttribute(ATTR_MAP_SOLVED)) return false;
    const source = MAP_SOURCES.find((candidate) => candidate.id === objectId
      && candidate.x === location.x && candidate.y === location.y && candidate.z === location.z);
    if (!source) return false;
    let found = Number(p.getAttribute(ATTR_MAP_FOUND)) || 0;
    const handed = Number(p.getAttribute(ATTR_MAP_HANDED_IN)) || 0;
    let amount = 0;
    for (let index = source.first; index < source.first + source.count; index++) {
      const bit = 1 << index;
      if (handed & bit) continue;
      if (!(found & bit) || !has(p, MAP_PIECES[index])) {
        if (!give(p, MAP_PIECES[index])) break;
        found |= bit;
        amount++;
      }
    }
    p.setAttribute(ATTR_MAP_FOUND, found);
    p.sendMessage(amount ? `You search the ${source.label} and find ${amount} map piece${amount === 1 ? "" : "s"}.`
      : `You have already collected all the map pieces from the ${source.label}.`);
    return true;
  }
  function searchAncientDiary({ player: p, objectId, location }) {
    if (stage(p) < S.MAP || stage(p) >= S.TO_LITHKREN || ![30715, 30716].includes(objectId)
      || location.z !== 0 || location.y !== 3865 || ![3761, 3764].includes(location.x)) return false;
    if (has(p, I.ANCIENT_DIARY) || p.getAttribute(ATTR_ANCIENT_DIARY_READ)) {
      p.sendMessage("You have already taken the ancient diary from the pile of books.");
      return true;
    }
    if (!give(p, I.ANCIENT_DIARY)) return true;
    p.sendMessage("You search behind the ladder and find an ancient diary.");
    return true;
  }
  function readAncientDiary({ player: p, itemId }) {
    if (itemId !== I.ANCIENT_DIARY) return false;
    p.setAttribute(ATTR_ANCIENT_DIARY_READ, true);
    p.sendMessage("You read the diary. It describes a Dragonkin conflict on Fossil Island.");
    return true;
  }
  function answerMapDialogueCondition({ player: p, stepId }) {
    if (stepId === "ekjMs9") return p.getAttribute(ATTR_ANCIENT_DIARY_READ) === true;
    if (stepId === "1ZoA0Q") return p.getAttribute(ATTR_ANCIENT_DIARY_READ) !== true;
    const handedIn = bitCount(Number(p.getAttribute(ATTR_MAP_HANDED_IN)) || 0);
    if (stepId === "rs8Q9u") return handedIn === 0;
    if (stepId === "nJTruP") return handedIn < MAP_PIECES.length;
    if (stepId === "LkwLY1") return handedIn === MAP_PIECES.length;
    return null;
  }
  function answerDreamDialogueCondition({ player: p, stepId }) {
    const hasDreamVial = [I.DREAM_VIAL_EMPTY_, I.DREAM_VIAL_WATER_, I.DREAM_VIAL_HERB_].some((id) => has(p, id));
    if (stepId === "5cREAj") return hasDreamVial;
    if (stepId === "SWgxx_") return p.getInventory().getFreeSlots() === 0;
    const amuletIds = [I.CATSPEAK_AMULET, I.CATSPEAK_AMULET_E_, I.CATSPEAK_AMULET_2, I.CATSPEAK_AMULET_E__2];
    const wearingAmulet = amuletIds.some((id) => p.getEquipment?.().getAmount?.(id) > 0);
    if (stepId === "i7XI9Q") return !wearingAmulet;
    if (stepId === "gQ21dn") return wearingAmulet;
    // This player has no following pet unless one is implemented by the core.
    if (stepId === "b6EB1q") return false;
    return null;
  }
  function handleDreamDialogueLine(event) {
    if (!ONEIROMANCER_IDS.has(event.npcId)
      || stage(event.player) !== S.DREAM || Number(event.player.getAttribute(ATTR_DREAM_PROGRESS)) < 2
      || has(event.player, I.DREAM_POTION)
      || [I.DREAM_VIAL_EMPTY_, I.DREAM_VIAL_WATER_, I.DREAM_VIAL_HERB_].some((id) => has(event.player, id))) return;
    if (event.text !== "Here's a vial for your potion. Good luck.") return;
    event.after = () => give(event.player, I.DREAM_VIAL_EMPTY_);
  }
  function sendMapPuzzleState(p, positions, rotations) {
    const packet = p.getPacketSender();
    for (let index = 0; index < MAP_POSITION_VARBITS.length; index++) {
      const positionVarbit = MAP_POSITION_VARBITS[index];
      if (positionVarbit < 0) continue;
      packet.sendVarbit(positionVarbit, positions[index]);
      packet.sendVarbit(MAP_ROTATION_VARBITS[index], rotations[index]);
    }
  }
  function beginMapPuzzle(p) {
    let positions = p.getAttribute(ATTR_MAP_POSITIONS);
    let rotations = p.getAttribute(ATTR_MAP_ROTATIONS);
    if (!Array.isArray(positions) || positions.length !== 36 || !Array.isArray(rotations) || rotations.length !== 36) {
      positions = Array(36).fill(0);
      rotations = Array(36).fill(0);
      let tile = 1;
      const editable = [];
      for (let index = 0; index < MAP_POSITION_VARBITS.length; index++) {
        if (MAP_POSITION_VARBITS[index] < 0) continue;
        positions[index] = tile++;
        editable.push(index);
      }
      const current = editable.map((index) => positions[index]);
      for (let index = 0; index < editable.length; index++) {
        positions[editable[index]] = current[(index + 1) % current.length];
        rotations[editable[index]] = 1;
      }
      p.setAttribute(ATTR_MAP_POSITIONS, positions);
      p.setAttribute(ATTR_MAP_ROTATIONS, rotations);
    }
    sendMapPuzzleState(p, positions, rotations);
    p.getPacketSender().sendInterface(MAP_INTERFACE_GROUP);
  }
  function mapScriptArgs(data) {
    if (!data) return [];
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const values = [];
    for (let offset = 0; offset < bytes.length;) {
      let raw = 0, shift = 0, byte;
      do {
        if (offset >= bytes.length || shift > 28) return [];
        byte = bytes[offset++];
        raw |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      values.push((raw >>> 1) ^ -(raw & 1));
    }
    return values;
  }
  function handleMapPuzzleClick(event) {
    const { player: p } = event;
    if (event.groupId !== MAP_INTERFACE_GROUP || stage(p) !== S.MAP
      || !p.getAttribute(ATTR_MAP_PUZZLE_READY) || p.getAttribute(ATTR_MAP_SOLVED)) return;
    const positions = p.getAttribute(ATTR_MAP_POSITIONS);
    const rotations = p.getAttribute(ATTR_MAP_ROTATIONS);
    if (!Array.isArray(positions) || !Array.isArray(rotations)) return;
    const args = mapScriptArgs(event.argsData);
    if (args.length < 3) return;
    let changed = false;
    if (args.length >= 4) {
      const from = args[1], to = args[3];
      if (from >= 0 && from < 36 && to >= 0 && to < 36
        && MAP_POSITION_VARBITS[from] >= 0 && MAP_POSITION_VARBITS[to] >= 0 && from !== to) {
        [positions[from], positions[to]] = [positions[to], positions[from]];
        [rotations[from], rotations[to]] = [rotations[to], rotations[from]];
        changed = true;
      }
    } else {
      const index = args.length >= 3 ? args[2] : (Number.isInteger(event.slot) ? event.slot : event.childId);
      const turn = args.length >= 1 ? args[0] : event.action;
      if (index >= 0 && index < 36 && MAP_ROTATION_VARBITS[index] >= 0 && (turn === 1 || turn === 2)) {
        rotations[index] = (rotations[index] + (turn === 1 ? 1 : 3)) % 4;
        changed = true;
      }
    }
    if (!changed) return;
    event.handled = true;
    p.setAttribute(ATTR_MAP_POSITIONS, positions);
    p.setAttribute(ATTR_MAP_ROTATIONS, rotations);
    sendMapPuzzleState(p, positions, rotations);
    let targetTile = 1;
    const solved = positions.every((value, index) => MAP_POSITION_VARBITS[index] < 0 || value === targetTile++)
      && rotations.every((value, index) => MAP_ROTATION_VARBITS[index] < 0 || value === 0);
    if (!solved) return;
    p.setAttribute(ATTR_MAP_SOLVED, true);
    p.getPacketSender().sendInterfaceRemoval();
    talk(p, N.DALLAS_JONES, "the-house-on-the-hill-finishing-the-map");
    advance(p, S.TO_LITHKREN);
  }
  function interactWithFossilMap({ player: p, objectId, definition, location }) {
    if (!location) return false;
    const visibleId = definition?.id ?? objectId;
    const onMapGrid = location.z === 0 && location.x >= 3762 && location.x <= 3766 && location.y >= 3867 && location.y <= 3871;
    if ((!MAP_OBJECT_IDS.has(visibleId) && !(onMapGrid && [30731, 30732, 30733].includes(objectId)))
      || stage(p) < S.MAP || stage(p) >= S.TO_LITHKREN) return false;
    if (bitCount(Number(p.getAttribute(ATTR_MAP_HANDED_IN)) || 0) !== 24) {
      p.sendMessage("The map is missing pieces. Find all 24 pieces and give them to Dallas Jones.");
      return true;
    }
    if (!p.getAttribute(ATTR_MAP_PUZZLE_READY)) {
      p.sendMessage("Speak to Dallas Jones about completing the map first.");
      return true;
    }
    beginMapPuzzle(p);
    return true;
  }
  function buildLithkrenRowboat({ player: p, objectId, location, definition }) {
    const visibleObjectId = definition?.id ?? objectId;
    if (![29916, O.ROWBOAT_SPACE, O.ROWBOAT_14].includes(objectId)
      && ![O.ROWBOAT_SPACE, O.ROWBOAT_14].includes(visibleObjectId)) return false;
    if (location.x !== ROWBOAT_OBJECT_TILE.x || location.y !== ROWBOAT_OBJECT_TILE.y || location.z !== 0
      || stage(p) < S.TO_LITHKREN || stage(p) >= S.COMPLETE) return false;
    if (visibleObjectId === O.ROWBOAT_14 || definition?.getInteractions?.()?.[0] === "Travel") {
      return travelRowboat({ player: p, objectId: visibleObjectId, location });
    }
    if (p.getAttribute(ATTR_ROWBOAT_BUILT)) {
      p.sendMessage("The rowboat is built. Speak to Dallas Jones to continue your journey.");
      return true;
    }
    if (p.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < 50) return p.sendMessage("You need at least 50 Construction to build the rowboat.");
    if (!has(p, I.HAMMER) || !has(p, I.SAW)) return p.sendMessage("You need a hammer and a saw to build the rowboat.");
    if (!has(p, I.OAK_PLANK, 8) || !has(p, I.SWAMP_PASTE, 10)) return p.sendMessage("You need 8 oak planks and 10 swamp paste to build the rowboat.");
    const nails = [I.BRONZE_NAILS, I.IRON_NAILS, I.STEEL_NAILS, I.BLACK_NAILS, I.MITHRIL_NAILS, I.ADAMANTITE_NAILS, I.RUNE_NAILS];
    if (nails.reduce((total, id) => total + p.getInventory().getAmount(id), 0) < 12) return p.sendMessage("You need at least 12 nails of any kind.");
    remove(p, I.OAK_PLANK, 8); remove(p, I.SWAMP_PASTE, 10);
    let remaining = 12;
    for (const id of nails) {
      const used = Math.min(remaining, p.getInventory().getAmount(id));
      if (used > 0) remove(p, id, used);
      remaining -= used;
      if (remaining === 0) break;
    }
    p.setAttribute(ATTR_ROWBOAT_BUILT, true);
    p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, 65);
    p.getPacketSender?.().sendVarbit?.(6104, 65);
    p.sendMessage("You successfully build the boat.");
    return true;
  }
  function travelRowboat({ player: p, objectId, location }) {
    if (![O.ROWBOAT_14, O.ROWBOAT_SPACE].includes(objectId)
      || location.x !== ROWBOAT_OBJECT_TILE.x || location.y !== ROWBOAT_OBJECT_TILE.y || location.z !== 0
      || !p.getAttribute(ATTR_ROWBOAT_BUILT) || stage(p) < S.TO_LITHKREN || stage(p) >= S.COMPLETE) return false;
    p.moveTo(LITHKREN_LANDING);
    p.setAttribute(ATTR_LITHKREN_ARRIVED, true);
    p.sendMessage("You row across to Lithkren and step ashore near the ancient fortress.");
    return true;
  }
  function onLithkrenDialogueAction({ player: p, stepId }) {
    if (stepId !== "wKz-eF" || !p.getAttribute(ATTR_ROWBOAT_BUILT) || stage(p) < S.TO_LITHKREN || stage(p) >= S.COMPLETE) return;
    p.moveTo(LITHKREN_LANDING);
    p.setAttribute(ATTR_LITHKREN_ARRIVED, true);
    p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, 70);
    p.getPacketSender?.().sendVarbit?.(6104, 70);
  }
  function syncLithkrenNativeStage({ player: p }) {
    if (stage(p) !== S.TO_LITHKREN || !p.getAttribute(ATTR_LITHKREN_ARRIVED)) return;
    const loc = p.getLocation();
    const y = loc.getY?.() ?? loc.y;
    const nativeStage = p.getAttribute(ATTR_AIVAS_DIARY) ? 85
      : p.getAttribute(ATTR_LITHKREN_DALLAS_TALKED) ? 80
        : y >= 10000 ? 75 : 70;
    if (Number(p.getAttribute(ATTR_LITHKREN_NATIVE_STAGE)) === nativeStage) return;
    p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, nativeStage);
    p.getPacketSender?.().sendVarbit?.(6104, nativeStage);
  }
  function nativeStage(value, player) {
    if (value === S.FLEET) {
      if (player?.getAttribute?.(ATTR_ASSAULT_DEFENSE_ACTIVE)) return 175;
      if (player?.getAttribute?.(ATTR_ASSAULT_DEFENDED)) {
        const index = Math.max(0, Math.min(ASSAULT_NATIVE_STAGE.length - 1,
          Number(player.getAttribute(ATTR_ASSAULT_INDEX)) || 0));
        return ASSAULT_NATIVE_STAGE[index];
      }
    }
    if (value === S.GALVEK && player?.getAttribute?.(ATTR_GALVEK_DEFEATED)) return 205;
    return NATIVE_STAGE[value] ?? 0;
  }
  function syncFleetNativeStage({ player: p }) {
    const value = stage(p);
    if (value !== S.FLEET && value !== S.GALVEK) return;
    const sender = p.getPacketSender?.();
    const desired = nativeStage(value, p);
    if (sender?.getVarbit?.(6104) !== desired) sender?.sendVarbit?.(6104, desired);
  }
  function climbLithkrenNorthStairs(event) {
    const { player: p, object, objectId } = event;
    if (stage(p) < S.TO_LITHKREN || stage(p) >= S.LEADERS || !p.getAttribute(ATTR_LITHKREN_ARRIVED)
      || objectId !== O.STAIRCASE_169) return;
    const loc = object?.getLocation?.();
    if (!loc || (loc.getX?.() ?? loc.x) !== 3549 || (loc.getY?.() ?? loc.y) !== 10469
      || (loc.getZ?.() ?? loc.z) !== 0) return;
    // The cache's Climb link has no paired loc for this second staircase. The Wiki and
    // QuestHelper route both place it north of the entry, above Dallas and Aivas' skeleton.
    event.handled = true;
    p.moveTo(new Location(3549, 10419, 0));
  }
  function routeLithkrenNorthStairs(event) {
    if (event.objectId !== O.STAIRCASE_169 || event.clickType !== 1
      || stage(event.player) < S.TO_LITHKREN || stage(event.player) >= S.LEADERS
      || !event.player.getAttribute(ATTR_LITHKREN_ARRIVED)) return;
    const { x, y, z } = event.object.getLocation();
    if (x !== 3549 || y !== 10469 || z !== 0) return;

    // This large cache staircase sits inside a tight wall footprint. The default
    // object route picks the far side of that footprint and stops short. Route
    // the click to an actually reachable perimeter tile, then let Ladders handle
    // the normal climb transition above the Dallas chamber.
    let width = event.definition?.getSizeX?.() ?? 1;
    let height = event.definition?.getSizeY?.() ?? 1;
    if ((event.object.getFace?.() ?? 0) & 1) [width, height] = [height, width];
    const candidates = [];
    for (let dx = 0; dx < width; dx++) {
      candidates.push({ x: x + dx, y: y - 1 }, { x: x + dx, y: y + height });
    }
    for (let dy = 0; dy < height; dy++) {
      candidates.push({ x: x - 1, y: y + dy }, { x: x + width, y: y + dy });
    }
    const position = event.player.getLocation();
    const finder = new api.core.RsmodRouteFinding();
    const reachable = candidates.map((tile) => ({ ...tile, route: finder.findRoute({
      level: z, srcX: position.getX(), srcY: position.getY(), srcSize: 1,
      destX: tile.x, destY: tile.y, privateArea: event.player.getPrivateArea?.() ?? null,
      moveNear: false,
    }) })).filter((tile) => tile.route.success)
      .sort((a, b) => Math.abs(a.x - position.getX()) + Math.abs(a.y - position.getY())
        - Math.abs(b.x - position.getX()) - Math.abs(b.y - position.getY()));
    if (reachable.length) event.destination = { x: reachable[0].x, y: reachable[0].y, z };
  }
  function spawnDeepLithkrenScene(p) {
    leaveArea(p);
    const area = new QuestArea(p.getUsername?.(), DEEP_LITHKREN_BOUNDS);
    area.enter(p);
    p.setAttribute(ATTR_AREA, area);
    for (const actor of DEEP_LITHKREN_ACTORS) {
      const npc = api.spawnNpc({
        id: actor.id, x: actor.x, y: actor.y, z: 0,
        owner: p, ownerOnly: true, wanderRadius: 0,
      });
      if (!npc) continue;
      npc.setScriptedMovement?.(true);
      area.add(npc);
      World.getAddNPCQueue().push(npc);
    }
    return area;
  }
  function enterDeepLithkrenVault(p, { resume = false } = {}) {
    if (stage(p) !== S.LEADERS || !p.getAttribute(ATTR_LITHKREN_ARRIVED)) return false;
    if (!resume && p.getAttribute(ATTR_VAULT_SCENE_COMPLETE)) {
      p.sendMessage("The vault is silent now.");
      return true;
    }
    if (!resume && p.getAttribute(ATTR_VAULT_SCENE_ACTIVE)) return true;
    spawnDeepLithkrenScene(p);
    p.setAttribute(ATTR_VAULT_SCENE_ACTIVE, true);
    p.moveTo(DEEP_LITHKREN_ENTRY);
    // The vault NPCs are cache scene actors without Talk-to actions. OSRS starts
    // this multi-speaker transcript automatically after the player enters.
    startTranscript(api, p, N.DALLAS_JONES_6, PAGE, "the-ultimate-weapon-talking-to-either-in-the-vault");
    return true;
  }
  function finishDeepLithkrenCutscene(p, complete) {
    p.setAttribute(ATTR_VAULT_SCENE_ACTIVE, false);
    if (complete) p.setAttribute(ATTR_VAULT_SCENE_COMPLETE, true);
    leaveArea(p);
    p.moveTo(DEEP_LITHKREN_EXIT);
  }
  function onQuestDialogueAction(event) {
    const { player: p, stepId } = event;
    if (stage(p) === S.LEADERS && stepId === "MCUN0r"
      && p.getAttribute(ATTR_VAULT_SCENE_ACTIVE)) {
      // This transcript action is the cache cutscene transition back outside
      // the unlocked Lithkren doors as Galvek escapes.
      finishDeepLithkrenCutscene(p, true);
      return;
    }
    if (stage(p) === S.LEADERS && stepId === "Zq2IQ9") {
      p.setAttribute(ATTR_VAULT_SCENE_ACTIVE, false);
      p.setAttribute(ATTR_VAULT_SCENE_COMPLETE, true);
      return;
    }
    // The transcript's Yes choice is the actual point at which Bob and the
    // player enter the dream. A No choice leaves them at the brazier.
    if (stepId === "z9kHar" && stage(p) === S.DREAM
      && Number(p.getAttribute(ATTR_DREAM_PROGRESS)) >= 2) {
      event.handled = true;
      event.end = true;
      enterArea(p, N.ROBERT_THE_STRONG_2, 1761, 3850, 18);
      return;
    }
    if (stepId === ACTION_BOB_FIRST_TALK_COMPLETE && stage(p) === S.DREAM) {
      p.setAttribute(ATTR_DREAM_PROGRESS, 1);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === ACTION_SPHINX_DREAM_COMPLETE && stage(p) === S.DREAM) {
      p.setAttribute(ATTR_DREAM_PROGRESS, 2);
      p.getPacketSender?.().sendVarbit?.(6144, 1);
      p.getPacketSender?.().sendVarbit?.(6145, 0);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === ACTION_LITHKREN_DALLAS_COMPLETE && stage(p) === S.TO_LITHKREN
      && p.getAttribute(ATTR_LITHKREN_ARRIVED)) {
      p.setAttribute(ATTR_LITHKREN_DALLAS_TALKED, true);
      p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, 80);
      p.getPacketSender?.().sendVarbit?.(6104, 80);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === ACTION_MAP_COMPLETE && stage(p) === S.MAP
      && bitCount(Number(p.getAttribute(ATTR_MAP_HANDED_IN)) || 0) === MAP_PIECES.length) {
      p.setAttribute(ATTR_MAP_PUZZLE_READY, true);
      p.getPacketSender?.().sendVarbit?.(6104, 45);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === "lXAPbM" && stage(p) === S.FLEET) {
      startAssault(p);
      return;
    }
    if (stepId === ACTION_LITHKREN_DIARY_COMPLETE && stage(p) === S.TO_LITHKREN && p.getAttribute(ATTR_AIVAS_DIARY)) {
      advance(p, S.DREAM);
      p.setAttribute(ATTR_DREAM_PROGRESS, 0);
      return;
    }
    if (stepId === ACTION_BOB_MEMORIES_COMPLETE && stage(p) === S.DREAM) {
      advance(p, S.KEYS);
      // Dream maps use a private cave at 1760,3850; the live world destination
      // after the scene is Bob's Lunar Isle tile beside the brazier.
      p.moveTo(LUNAR_BOB_TILE);
      return;
    }
    if (stepId === "b5j1wa" && stage(p) === S.GALVEK && p.getAttribute(ATTR_GALVEK_DEFEATED)) {
      if (!has(p, I.LOCATOR_ORB) && p.getInventory().getFreeSlots() < 1) {
        p.sendMessage("You need one free inventory space to receive the locator orb.");
        return;
      }
      quest.complete(p);
      p.setAttribute(ATTR_GALVEK_DEFEATED, false);
    }
  }
  /** Ellen's four 25,000 XP rewards are spent, or the quest was completed without experience (a league quest pack). */
  function ellenTrainingDone(p) {
    return Number(p.getAttribute(ATTR_TRAINING_REWARDS)) >= 4 || quest.experienceWithheld(p);
  }
  function talkEllenTraining({ player: p, npcId }) {
    if (!quest.isComplete(p)) return false;
    startTranscript(api, p, npcId, "Ellen", ellenTrainingDone(p)
      ? "after-claiming-experience-rewards" : "standard-dialogue");
  }
  function handleEllenTrainingAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== N.ELLEN || stepId !== "P2tord" || !quest.isComplete(player) || ellenTrainingDone(player)) return;
    event.handled = true;
    // The transcript tail immediately closes its chatbox after this action. If
    // the reward modal opens in the same callback, that close removes the modal
    // and clears XpReward's pending selection before the player can choose.
    const request = {
      player,
      skills: DS2_COMBAT_LAMP_SKILLS,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        const manager = player.getSkillManager();
        const before = manager.getExperience(skill);
        manager.addExperience(skill, 25000, false);
        if (manager.getExperience(skill) === before) return null;
        const claimed = Number(player.getAttribute(ATTR_TRAINING_REWARDS)) || 0;
        player.setAttribute(ATTR_TRAINING_REWARDS, Math.min(4, claimed + 1));
        return `You have been awarded 25,000 ${name} XP!`;
      },
    };
    setImmediate(() => api.emitCustomEvent("xpreward:open", request));
  }
  function searchAivasSkeleton({ player: p, objectId, definition, location }) {
    const visibleObjectId = definition?.id ?? objectId;
    if (stage(p) !== S.TO_LITHKREN || !p.getAttribute(ATTR_LITHKREN_ARRIVED)
      || !p.getAttribute(ATTR_LITHKREN_DALLAS_TALKED)
      || ![O.SKELETON_82, O.SKELETON_83, 29871].some((id) => id === objectId || id === visibleObjectId)
      || (location && (location.x !== 3555 || location.y !== 10419))) return false;
    if (p.getAttribute(ATTR_AIVAS_DIARY_FOUND) || has(p, I.AIVAS_DIARY)) return p.sendMessage("You have already taken Aivas' diary.");
    if (!give(p, I.AIVAS_DIARY)) return true;
    p.setAttribute(ATTR_AIVAS_DIARY_FOUND, true);
    talk(p, N.DALLAS_JONES_2, "to-lithkren-searching-the-charred-skeleton");
    return true;
  }
  function readAivasDiary({ player: p, itemId }) {
    if (itemId !== I.AIVAS_DIARY || !p.getAttribute(ATTR_AIVAS_DIARY_FOUND) || stage(p) !== S.TO_LITHKREN) return false;
    p.setAttribute(ATTR_AIVAS_DIARY, true);
    p.sendMessage("Aivas' diary describes Robert the Strong leading the battle against the Dragonkin on Lithkren.");
    p.setAttribute(ATTR_LITHKREN_NATIVE_STAGE, 85);
    p.getPacketSender?.().sendVarbit?.(6104, 85);
    return true;
  }
  function talkBob({ player: p, npcId }) {
    if (stage(p) === S.DREAM) {
      const progress = Number(p.getAttribute(ATTR_DREAM_PROGRESS)) || 0;
      if (progress === 0) {
        talk(p, npcId, "bob-the-cat-talking-to-bob", (steps) => [
          ...steps,
          { type: "action", text: "Bob agrees to meet in Sophanem.", id: ACTION_BOB_FIRST_TALK_COMPLETE },
        ]);
      } else if (progress === 1) {
        talk(p, npcId, "bob-the-cat-talking-to-bob-talking-to-bob-again");
      } else {
        talk(p, npcId, has(p, I.DREAM_POTION)
          ? "robert-the-strong-talking-to-bob-on-lunar-isle-talking-to-bob-after-making-the-dream-potion"
          : "robert-the-strong-talking-to-bob-on-lunar-isle");
      }
    }
    else if (stage(p) >= S.KEYS && stage(p) < S.LITHKREN) talk(p, npcId, "bob-the-cat-talking-to-bob");
    else if (stage(p) >= S.LITHKREN && stage(p) < S.LEADERS) talk(p, npcId, "the-ultimate-weapon-talking-to-bob");
    else if (stage(p) >= S.FLEET) talk(p, npcId, "the-assault-talking-to-bob-on-varrock-s-grand-ship");
    else return false;
  }
  function talkSphinx({ player: p, npcId }) {
    if (stage(p) !== S.DREAM || Number(p.getAttribute(ATTR_DREAM_PROGRESS)) < 1) return false;
    return talk(p, npcId, "bob-the-cat-talking-to-the-sphinx", (rawSteps) => restoreSphinxGeneralTopic(rawSteps).map((step) => {
      if (step.type !== "choice" || !Array.isArray(step.options)) return step;
      return { ...step, options: step.options.map((option) => option.text === "Ask the Sphinx for help with Bob's memories."
        ? { ...option, steps: [...option.steps, { type: "action", text: "The Sphinx enchants you and sends Bob to Lunar Isle.", id: ACTION_SPHINX_DREAM_COMPLETE }] }
        : option) };
    }));
  }
  function talkBrundtForKey({ player: p, npcId }) {
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    talk(p, npcId, p.getAttribute(ATTR_UNGAEL_TRIP)
      ? "robert-s-ungael-key-piece-talking-to-brundt-the-chieftain-talking-to-brundt-again"
      : "robert-s-ungael-key-piece-talking-to-brundt-the-chieftain");
    p.setAttribute(ATTR_UNGAEL_TRIP, true);
    return true;
  }
  function talkTorfinnForKey({ player: p, npcId }) {
    if (stage(p) === S.FLEET) {
      talk(p, npcId, "the-assault-talking-to-torfinn");
      return;
    }
    if (stage(p) === S.GALVEK) {
      talk(p, npcId, "the-assault-talking-to-torfinn");
      enterFleetArea(p, FLEET_RESUME);
      spawnGalvek(p);
      return;
    }
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE || !p.getAttribute(ATTR_UNGAEL_TRIP)) return false;
    talk(p, npcId, "robert-s-ungael-key-piece-talking-to-torfinn");
    p.setAttribute(ATTR_UNGAEL_TRIP, true);
    p.sendMessage("Torfinn takes you to Ungael. Vorkath is ahead; prepare for the fight.");
    p.moveTo(new Location(2272, 4053, 0));
  }
  function talkHerbertForKey({ player: p, npcId }) {
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    talk(p, npcId, "camorra-s-key-piece-talking-to-veos-cabin-boy-herbert");
  }
  function talkAmeliaForKey({ player: p, npcId }) {
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    talk(p, npcId, p.getAttribute(ATTR_CRYPT_READY)
      ? "camorra-s-key-piece-talking-to-amelia-talking-to-amelia-again"
      : "camorra-s-key-piece-talking-to-amelia");
    p.setAttribute(ATTR_CRYPT_READY, true);
  }
  function talkKourendHistorian({ player: p, npcId, definition }) {
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    const name = definition?.getName?.() || definition?.name;
    const variant = name === "Istoria" ? "camorra-s-key-piece-talking-to-istoria"
      : name === "Imerominia" ? "camorra-s-key-piece-talking-to-imerominia"
        : "camorra-s-key-piece-talking-to-jonathan";
    talk(p, npcId, variant);
  }
  function selectOneiromancerDialogue({ player: p, npcId }) {
    return oneiromancerDialogueVariant({
      npcId,
      stage: stage(p),
      dreamProgress: Number(p.getAttribute(ATTR_DREAM_PROGRESS)) || 0,
      hasDreamPotion: has(p, I.DREAM_POTION),
    });
  }
  function talkReldo({ player: p, npcId }) {
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    const step = Number(p.getAttribute(ATTR_MORYTANIA)) || 0;
    const variant = step === 0 ? "tristan-s-key-piece-talking-to-reldo"
      : step === 1 ? "tristan-s-key-piece-talking-to-reldo-talking-to-him-before-finding-the-book"
        : "tristan-s-key-piece-talking-to-reldo-with-the-book";
    talk(p, npcId, variant);
    if (step === 0) p.setAttribute(ATTR_MORYTANIA, 1);
  }
  function searchReldoBook(event) {
    const { player: p, objectId, location } = event;
    const progress = Number(p.getAttribute(ATTR_MORYTANIA)) || 0;
    const needsRecovery = progress === 2 && !has(p, I.VARROCK_CENSUS_RECORDS);
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE || (progress !== 1 && !needsRecovery)) return false;
    if (objectId !== RELDO_BOOKCASE_ID || location.x !== 3211 || location.y !== 3495) return false;
    event.handled = true;
    talk(p, N.RELDO, "tristan-s-key-piece-finding-the-book");
    if (progress === 1) p.setAttribute(ATTR_MORYTANIA, 2);
    return true;
  }
  function handleReldoBookMessage(event) {
    const { player: p, stepId } = event;
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE) return;
    if (stepId === "mF7UO1" && Number(p.getAttribute(ATTR_MORYTANIA)) === 2) {
      event.handled = true;
      if (!has(p, I.VARROCK_CENSUS_RECORDS) && !give(p, I.VARROCK_CENSUS_RECORDS)) event.end = true;
      return;
    }
    if (stepId === "0ordv0" && Number(p.getAttribute(ATTR_MORYTANIA)) >= 2) {
      event.handled = true;
      if (!has(p, I.VARROCK_CENSUS_RECORDS)) {
        p.sendMessage("You need to search the marked red bookcase for the census records first.");
        event.end = true;
        return;
      }
      remove(p, I.VARROCK_CENSUS_RECORDS);
    }
  }
  function talkSarah({ player: p, npcId }) {
    const step = Number(p.getAttribute(ATTR_MORYTANIA)) || 0;
    if (stage(p) < S.KEYS || stage(p) >= S.FORGE || step < 2) return false;
    talk(p, npcId, step < 3 ? "tristan-s-key-piece-talking-to-sarah-corvo" : "tristan-s-key-piece-talking-to-sarah-corvo-talking-to-her-again");
    p.setAttribute(ATTR_MORYTANIA, 3);
  }
  function talkAva({ player: p, npcId }) {
    const step = Number(p.getAttribute(ATTR_MORYTANIA)) || 0;
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || step < 3) return false;
    if (step === 3) {
      talk(p, npcId, "tristan-s-key-piece-talking-to-ava");
      p.setAttribute(ATTR_MORYTANIA, 4);
    } else if (has(p, I.INERT_LOCATOR_ORB)) {
      finishLocatorOrb({ player: p, npcId });
    } else {
      talk(p, npcId, has(p, I.LOCATOR_ORB)
        ? "tristan-s-key-piece-talking-to-ava-after-making-the-orb-talking-to-her-again-after-receiving-the-orb"
        : "tristan-s-key-piece-talking-to-ava-talking-to-her-again-before-making-the-orb");
    }
  }
  function talkLeader({ player: p, npcId, definition }) {
    const name = definition?.getName?.() || definition?.name;
    if (name === "Brundt the Chieftain" && stage(p) >= S.KEYS && stage(p) < S.FORGE) {
      return talkBrundtForKey({ player: p, npcId });
    }
    if (stage(p) < S.LEADERS || stage(p) >= S.COMPLETE) return false;
    const variants = {
      "Sir Amik Varze": "a-world-united-talking-to-sir-amik-varze",
      "King Lathas": "a-world-united-talking-to-king-lathas-thoros-king-lathas",
      "Brundt the Chieftain": "a-world-united-brundt-the-chieftain",
      "King Roald": "a-world-united-talking-to-king-roald",
    };
    const idx = ["Sir Amik Varze", "King Lathas", "Brundt the Chieftain", "King Roald"].indexOf(name);
    if (idx < 0) return false;
    talk(p, npcId, variants[name]);
    const bits = Number(p.getAttribute(ATTR_LEADERS)) || 0;
    const next = bits | (1 << idx);
    p.setAttribute(ATTR_LEADERS, next);
    if (next === 15) advance(p, S.FLEET);
    return true;
  }
  function enterArea(p, bossId, x, y, radius) {
    leaveArea(p);
    const area = new QuestArea(p.getUsername?.(), new Boundary(x - radius, x + radius, y - radius, y + radius, 0));
    p.setAttribute(ATTR_AREA, area);
    area.enter(p);
    const at = p.getLocation();
    if (Math.max(Math.abs(at.getX() - x), Math.abs(at.getY() - y)) > 8) p.moveTo(new Location(x - 1, y, 0));
    const boss = NPC.create(bossId, new Location(x, y, 0));
    boss.setOwner?.(p); boss.setOwnerOnly?.(true); boss.__skipDefaultRespawn = true;
    area.add(boss); World.getAddNPCQueue().push(boss);
    p.setAttribute(ATTR_BOSS, boss);
    return area;
  }
  function startAssault(p) {
    const index = Math.min(ASSAULT_DRAGONS.length - 1, Number(p.getAttribute(ATTR_ASSAULT_DEFENDED)
      ? p.getAttribute(ATTR_ASSAULT_INDEX) : p.getAttribute(ATTR_ASSAULT_CHECKPOINT)) || 0);
    if (!p.getAttribute(ATTR_ASSAULT_DEFENDED) && index === 0) {
      if (p.getInventory().getFreeSlots() < 4) return p.sendMessage("You need four free inventory spaces for the ship supplies.");
      const area = enterFleetArea(p, FLEET_BOAT_START);
      p.setAttribute(ATTR_ASSAULT_INDEX, 0);
      p.setAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE, true);
      area.assaultShipTick = 0;
      area.assaultIntegrity = 100;
      area.assaultDamage = new Map();
      area.assaultDamageSequence = 0;
      area.assaultObjects = [];
      const supplies = [
        [O.HAMMERS, 1699, 5530], [O.WATER_CONTAINERS, 1703, 5530],
        [O.SWAMP_PASTE, 1699, 5536], [O.POTIONS, 1703, 5536],
      ];
      for (const [id, x, y] of supplies) addAssaultObject(area, id, new Location(x, y, 1));
      p.sendMessage("Defend Brundt's ship for four minutes. Take the hammer, water container, swamp paste and revitalisation potion from the crates; repair the damage as it appears.");
      return;
    }
    const area = enterFleetArea(p, p.getAttribute(ATTR_ASSAULT_DEFENDED) || index > 0 ? FLEET_START : FLEET_BOAT_START);
    if (index > 0) addAssaultTraversal(area);
    p.setAttribute(ATTR_ASSAULT_INDEX, index);
    p.sendMessage(index >= 10
      ? "The final wave attacks: defeat the mithril, adamant and rune dragons."
      : index >= 7
        ? "The dragons press on: defeat the black, steel and brutal red dragons."
        : "The allied fleet is under attack. Fight through the dragons and reach the grand ship.");
    spawnAssaultDragon(p, index);
  }
  const ASSAULT_REPAIRS = [
    { id: O.FIRE_32, item: I.WATER_CONTAINER, action: "Douse", verb: "douse the fire" },
    { id: O.LEAK, item: I.SWAMP_PASTE_2, action: "Fill", verb: "fill the leak" },
    { id: O.COL_FFFF00_FREMENNIK_WARRIOR_COL_2, item: I.REVITALISATION_POTION, action: "Heal", verb: "heal the rower" },
    { id: O.DAMAGED_MAST, item: I.HAMMER, action: "Repair", verb: "repair the mast" },
  ];
  // shortcut: Wiki/cached ship art shows the damage types, but does not publish
  // their per-tick tiles. Keep the inferred anchors on the reachable east deck;
  // the west-side cache railing isolates the original fire/rower positions.
  const ASSAULT_DAMAGE_TILES = [
    new Location(1702, 5532, 1), new Location(1705, 5534, 1),
    new Location(1702, 5542, 1), new Location(1705, 5547, 1),
  ];
  function addAssaultObject(area, id, location) {
    const object = new GameObject(id, location, 10, 0, area);
    ObjectManager.register(object, true);
    area.add(object);
    area.assaultObjects.push(object);
    return object;
  }
  function addAssaultTraversal(area) {
    if (!area || area.assaultTraversal) return;
    const lower = new Location(ASSAULT_LADDER.getX(), ASSAULT_LADDER.getY(), ASSAULT_LADDER.getZ() - 1);
    const objects = [
      new GameObject(O.SHIPS_LADDER_2, ASSAULT_LADDER.clone(), 10, 0, area),
      new GameObject(O.SHIPS_LADDER, lower, 10, 2, area),
    ];
    for (const object of objects) {
      ObjectManager.register(object, true);
      area.add(object);
      area.assaultObjects.push(object);
    }
    area.assaultTraversal = true;
  }
  function claimAssaultLadder(event) {
    const { player: p, object, objectId } = event;
    const area = p.getAttribute(ATTR_AREA);
    const location = object?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || !area.assaultTraversal || !location
      || location.getX() !== ASSAULT_LADDER.getX() || location.getY() !== ASSAULT_LADDER.getY()) return;
    const down = objectId === O.SHIPS_LADDER_2 && location.getZ() === ASSAULT_LADDER.getZ();
    const up = objectId === O.SHIPS_LADDER && location.getZ() === ASSAULT_LADDER.getZ() - 1;
    if (!down && !up) return;
    const destination = down
      ? new Location(1687, 5662, ASSAULT_LADDER.getZ() - 1)
      : new Location(1687, 5664, ASSAULT_LADDER.getZ());
    api.emitCustomEvent(down ? "ladders:climbDown" : "ladders:climbUp", { player: p, destination });
    event.handled = true;
    return true;
  }
  function routeAssaultLadder(event) {
    if (event.clickType !== 1) return;
    const { player: p, object, objectId } = event;
    const area = p?.getAttribute?.(ATTR_AREA);
    const location = object?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || !area.assaultTraversal || !location
      || location.getX() !== ASSAULT_LADDER.getX() || location.getY() !== ASSAULT_LADDER.getY()) return;
    const lower = objectId === O.SHIPS_LADDER && location.getZ() === ASSAULT_LADDER.getZ() - 1;
    const upper = objectId === O.SHIPS_LADDER_2 && location.getZ() === ASSAULT_LADDER.getZ();
    if (!lower && !upper) return;
    // shortcut: the cache ladder sits behind blocked railing tiles on the lower deck.
    // Route its earned climb from the adjacent walkable ship corridor; the ladder action
    // still performs the normal paired-floor climb at this canonical anchor.
    event.destination = lower
      ? { x: 1687, y: 5662, z: ASSAULT_LADDER.getZ() - 1 }
      : { x: 1687, y: 5664, z: ASSAULT_LADDER.getZ() };
  }
  function assaultGapCrossing({ player: p, object, objectId, definition }) {
    const area = p.getAttribute(ATTR_AREA);
    const id = definition?.id ?? objectId;
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || ![O.GAP_39, O.GAP_40].includes(id)) return null;
    const location = object?.getLocation?.();
    const position = p.getLocation?.();
    if (!location || !position) return null;
    if (id === ASSAULT_GALVEK_DECK_GAP.id && location.getX() === ASSAULT_GALVEK_DECK_GAP.x
      && location.getY() === ASSAULT_GALVEK_DECK_GAP.y && location.getZ() === ASSAULT_GALVEK_DECK_GAP.z) {
      return ASSAULT_GALVEK_DECK_GAP;
    }
    if (id === ASSAULT_MAIN_SHIP_GAP.id && location.getX() === ASSAULT_MAIN_SHIP_GAP.x
      && location.getY() === ASSAULT_MAIN_SHIP_GAP.y && location.getZ() === ASSAULT_MAIN_SHIP_GAP.z) {
      return ASSAULT_MAIN_SHIP_GAP;
    }
    if (id === ASSAULT_DROP_GAP.id && location.getX() === ASSAULT_DROP_GAP.x
      && location.getY() === ASSAULT_DROP_GAP.y && location.getZ() === ASSAULT_DROP_GAP.z) {
      return ASSAULT_DROP_GAP;
    }
    if (id === ASSAULT_MITHRIL_GAP.id && location.getX() === ASSAULT_MITHRIL_GAP.x
      && location.getY() === ASSAULT_MITHRIL_GAP.y && location.getZ() === ASSAULT_MITHRIL_GAP.z) {
      return ASSAULT_MITHRIL_GAP;
    }
    if (id === ASSAULT_ADAMANT_GAP.id && location.getX() === ASSAULT_ADAMANT_GAP.x
      && location.getY() === ASSAULT_ADAMANT_GAP.y && location.getZ() === ASSAULT_ADAMANT_GAP.z) {
      return ASSAULT_ADAMANT_GAP;
    }
    if (id === ASSAULT_RUNE_GAP.id && location.getX() === ASSAULT_RUNE_GAP.x
      && location.getY() === ASSAULT_RUNE_GAP.y && location.getZ() === ASSAULT_RUNE_GAP.z) {
      return ASSAULT_RUNE_GAP;
    }
    if (id === ASSAULT_RUNE_FINAL_GAP.id && location.getX() === ASSAULT_RUNE_FINAL_GAP.x
      && location.getY() === ASSAULT_RUNE_FINAL_GAP.y && location.getZ() === ASSAULT_RUNE_FINAL_GAP.z) {
      return ASSAULT_RUNE_FINAL_GAP;
    }
    if (id === ASSAULT_RUNE_WEST_GAP.id && location.getX() === ASSAULT_RUNE_WEST_GAP.x
      && location.getY() === ASSAULT_RUNE_WEST_GAP.y && location.getZ() === ASSAULT_RUNE_WEST_GAP.z) {
      return ASSAULT_RUNE_WEST_GAP;
    }
    for (const crossing of [ASSAULT_RUNE_RETURN_GAP, ASSAULT_RUNE_WEST_DROP_GAP,
      ASSAULT_RUNE_WEST_RISE_GAP, ASSAULT_RUNE_RETURN_DROP_GAP]) {
      if (id === crossing.id && location.getX() === crossing.x
        && location.getY() === crossing.y && location.getZ() === crossing.z) return crossing;
    }
    const face = object.getFace?.() ?? 0;
    const sizeX = definition?.getSizeX?.() ?? object.getDefinition?.()?.sizeX ?? 1;
    const sizeY = definition?.getSizeY?.() ?? object.getDefinition?.()?.sizeY ?? 1;
    const width = face % 2 === 1 ? sizeY : sizeX;
    const height = face % 2 === 1 ? sizeX : sizeY;
    const x = location.getX(), y = location.getY(), z = location.getZ();
    const px = position.getX(), py = position.getY();
    if (width >= height && py >= y - 1 && py <= y + height) {
      const row = Math.max(y, Math.min(y + height - 1, py));
      if (px < x) return { approach: { x: x - 1, y: row, z }, landing: { x: x + width, y: row, z } };
      if (px >= x + width) return { approach: { x: x + width, y: row, z }, landing: { x: x - 1, y: row, z } };
    } else if (height > width && px >= x - 1 && px <= x + width) {
      const column = Math.max(x, Math.min(x + width - 1, px));
      if (py < y) return { approach: { x: column, y: y - 1, z }, landing: { x: column, y: y + height, z } };
      if (py >= y + height) return { approach: { x: column, y: y + height, z }, landing: { x: column, y: y - 1, z } };
    }
    return null;
  }
  function routeAssaultGap(event) {
    if (event.clickType !== 1) return;
    const crossing = assaultGapCrossing(event);
    if (crossing) event.destination = crossing.approach;
  }
  function assaultWreckageJump({ player: p, object, objectId, definition }) {
    const area = p?.getAttribute?.(ATTR_AREA);
    const id = definition?.id ?? objectId;
    const location = object?.getLocation?.();
    const position = p?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || id !== O.WRECKAGE || !location || !position) return null;
    const jump = ASSAULT_WRECKAGE_JUMPS.find((entry) =>
      entry.object[0] === location.getX() && entry.object[1] === location.getY() && entry.object[2] === location.getZ()
      && ((entry.from[0] === position.getX() && entry.from[1] === position.getY() && entry.from[2] === position.getZ())
        || (entry.object[0] === position.getX() && entry.object[1] === position.getY() && entry.object[2] === position.getZ())));
    return jump || null;
  }
  function routeAssaultWreckage(event) {
    if (event.clickType !== 1) return;
    const jump = assaultWreckageJump(event);
    if (jump) event.destination = { x: jump.from[0], y: jump.from[1], z: jump.from[2] };
  }
  function jumpAssaultWreckage(event) {
    const jump = assaultWreckageJump(event);
    if (!jump) return false;
    event.handled = true;
    event.player.moveTo(new Location(...jump.landing));
    return true;
  }
  function jumpAssaultGap(event) {
    const crossing = assaultGapCrossing(event);
    if (!crossing) return false;
    const position = event.player.getLocation();
    if (position.getX() !== crossing.approach.x || position.getY() !== crossing.approach.y
      || position.getZ() !== crossing.approach.z) return false;
    event.handled = true;
    event.player.moveTo(new Location(crossing.landing.x, crossing.landing.y, crossing.landing.z));
    return true;
  }
  function assaultRuneShip(event) {
    const { player: p, object, objectId, definition } = event;
    const area = p?.getAttribute?.(ATTR_AREA);
    const id = definition?.id ?? objectId;
    const location = object?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || ![12, ASSAULT_DRAGONS.length].includes(Number(p.getAttribute(ATTR_ASSAULT_INDEX)))
      || id !== ASSAULT_RUNE_SHIP.id || !location
      || location.getX() !== ASSAULT_RUNE_SHIP.x || location.getY() !== ASSAULT_RUNE_SHIP.y
      || location.getZ() !== ASSAULT_RUNE_SHIP.z) return null;
    return ASSAULT_RUNE_SHIP;
  }
  function routeAssaultRuneShip(event) {
    if (event.clickType !== 1) return;
    const crossing = assaultRuneShip(event);
    if (crossing) event.destination = crossing.approach;
  }
  function jumpAssaultRuneShip(event) {
    const crossing = assaultRuneShip(event);
    if (!crossing) return false;
    const position = event.player.getLocation();
    if (position.getX() !== crossing.approach.x || position.getY() !== crossing.approach.y
      || position.getZ() !== crossing.approach.z) return false;
    event.handled = true;
    event.player.moveTo(new Location(crossing.landing.x, crossing.landing.y, crossing.landing.z));
    return true;
  }
  function climbAssaultRuneLadder(event) {
    const { player: p, object, objectId, definition } = event;
    const area = p?.getAttribute?.(ATTR_AREA);
    const id = definition?.id ?? objectId;
    const location = object?.getLocation?.();
    const position = p?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || ![12, ASSAULT_DRAGONS.length].includes(Number(p.getAttribute(ATTR_ASSAULT_INDEX)))
      || id !== ASSAULT_RUNE_ROPE_LADDER.id
      || !location || location.getX() !== ASSAULT_RUNE_ROPE_LADDER.x
      || location.getY() !== ASSAULT_RUNE_ROPE_LADDER.y || location.getZ() !== ASSAULT_RUNE_ROPE_LADDER.z
      || !position || position.getZ() !== ASSAULT_RUNE_ROPE_LADDER.z
      || Math.max(Math.abs(position.getX() - location.getX()), Math.abs(position.getY() - location.getY())) > 2) return false;
    event.handled = true;
    p.moveTo(new Location(ASSAULT_RUNE_ROPE_LADDER.landing.x,
      ASSAULT_RUNE_ROPE_LADDER.landing.y, ASSAULT_RUNE_ROPE_LADDER.landing.z));
    return true;
  }
  function assaultRuneDebrisCrossing({ player: p, object, objectId, definition }) {
    const area = p?.getAttribute?.(ATTR_AREA);
    const id = definition?.id ?? objectId;
    const location = object?.getLocation?.();
    const position = p?.getLocation?.();
    if (!(area instanceof QuestArea) || !isAssaultShipStage(p) || !p.getAttribute(ATTR_ASSAULT_DEFENDED)
      || ![12, ASSAULT_DRAGONS.length].includes(Number(p.getAttribute(ATTR_ASSAULT_INDEX)))
      || ![O.DEBRIS, O.DEBRIS_2].includes(id)
      || !location || !position) return null;
    return ASSAULT_RUNE_DEBRIS_CROSSES.find((crossing) =>
      crossing.object[0] === location.getX() && crossing.object[1] === location.getY()
      && crossing.object[2] === location.getZ() && crossing.from[0] === position.getX()
      && crossing.from[1] === position.getY() && crossing.from[2] === position.getZ()) || null;
  }
  function routeAssaultRuneDebris(event) {
    if (event.clickType !== 1) return;
    const crossing = assaultRuneDebrisCrossing(event);
    if (crossing) event.destination = { x: crossing.from[0], y: crossing.from[1], z: crossing.from[2] };
  }
  function crossAssaultRuneDebris(event) {
    const crossing = assaultRuneDebrisCrossing(event);
    if (!crossing) return false;
    event.handled = true;
    event.player.moveTo(new Location(crossing.landing[0], crossing.landing[1], crossing.landing[2]));
    return true;
  }
  function removeAssaultObject(area, object) {
    if (!object) return;
    ObjectManager.deregister(object, true);
    area.remove(object);
    area.assaultObjects = (area.assaultObjects || []).filter((entry) => entry !== object);
  }
  function clearAssaultObjects(area) {
    for (const object of [...(area.assaultObjects || [])]) removeAssaultObject(area, object);
    area.assaultDamage?.clear();
  }
  function processAssaultShip(area, player) {
    area.assaultShipTick++;
    if (area.assaultShipTick % 10 === 0) {
      const activeDamage = area.assaultDamage.size;
      area.assaultIntegrity = Math.max(0, area.assaultIntegrity - (activeDamage >= 4 ? 4 : 1));
      if (area.assaultIntegrity === 0) {
        clearAssaultObjects(area);
        area.assaultShipTick = 0;
        area.assaultIntegrity = 100;
        player.sendMessage("The ship's integrity reaches zero. The crew restore it and the assault begins again.");
        return;
      }
      if (activeDamage < 4) {
        const entry = ASSAULT_REPAIRS[area.assaultDamageSequence++ % ASSAULT_REPAIRS.length];
        const location = ASSAULT_DAMAGE_TILES.find((tile) => !area.assaultDamage.has(`${tile.getX()},${tile.getY()},${tile.getZ()}`));
        if (location) {
          const object = addAssaultObject(area, entry.id, location);
          area.assaultDamage.set(`${location.getX()},${location.getY()},${location.getZ()}`, { ...entry, object });
          player.sendMessage(`Dragonfire damages the ship: ${entry.action.toLowerCase()} the damage before it gets worse.`);
        }
      }
    }
    if (area.assaultShipTick < 400) return;
    clearAssaultObjects(area);
    player.setAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE, false);
    player.setAttribute(ATTR_ASSAULT_DEFENDED, true);
    player.setAttribute(ATTR_ASSAULT_CHECKPOINT, 0);
    player.sendMessage("You hold Brundt's ship together until the fleet reaches the wrecks.");
    talk(player, N.KOSCHEI_THE_DEATHLESS_5, "the-assault-crashing-the-ship");
    player.moveTo(FLEET_START);
    spawnAssaultDragon(player, 0);
  }
  function takeAssaultSupply({ player: p, objectId }) {
    if (!p.getAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE)) return false;
    const item = new Map([
      [O.HAMMERS, I.HAMMER], [O.WATER_CONTAINERS, I.WATER_CONTAINER],
      [O.SWAMP_PASTE, I.SWAMP_PASTE_2], [O.POTIONS, I.REVITALISATION_POTION],
    ]).get(objectId);
    if (!item) return false;
    if (p.getInventory().getFreeSlots() < 1) return p.sendMessage("You need an inventory space for that ship supply.");
    give(p, item);
    p.sendMessage("You take a supply for repairing Brundt's ship.");
    return true;
  }
  function repairAssaultShip({ player: p, objectId, itemId, location }) {
    if (!p.getAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE)) return false;
    const area = p.getAttribute(ATTR_AREA);
    const damage = area?.assaultDamage?.get(`${location.x},${location.y},${location.z}`);
    const definitionId = damage?.id === objectId || damage?.object?.getId?.() === objectId;
    if (!damage || !definitionId) return false;
    if (itemId != null && itemId !== damage.item) return false;
    if (!has(p, damage.item)) {
      p.sendMessage(`Take the correct supply to ${damage.verb}.`);
      return true;
    }
    if (damage.item !== I.HAMMER) remove(p, damage.item);
    removeAssaultObject(area, damage.object);
    area.assaultDamage.delete(`${location.x},${location.y},${location.z}`);
    area.assaultIntegrity = Math.min(100, area.assaultIntegrity + 4);
    p.sendMessage(`You ${damage.verb}. Ship integrity: ${area.assaultIntegrity}%.`);
    return true;
  }
  function enterFleetArea(p, arrival) {
    leaveArea(p);
    const area = new QuestArea(p.getUsername?.(), FLEET_BOUNDARIES);
    area.assaultObjects = [];
    area.enter(p);
    p.setAttribute(ATTR_AREA, area);
    p.moveTo(arrival);
    return area;
  }
  function spawnAssaultDragon(p, index) {
    const area = p.getAttribute(ATTR_AREA);
    const encounter = ASSAULT_DRAGONS[index];
    const dragon = NPC.create(encounter.id, new Location(encounter.x, encounter.y, encounter.z));
    dragon.setOwner?.(p); dragon.setOwnerOnly?.(true); dragon.__skipDefaultRespawn = true;
    area.add(dragon); World.getAddNPCQueue().push(dragon);
    p.setAttribute(ATTR_BOSS, dragon);
    p.setAttribute(ATTR_ASSAULT_INDEX, index);
  }
  function spawnGalvek(p) {
    const area = p.getAttribute(ATTR_AREA);
    const galvek = NPC.create(N.GALVEK_2, FLEET_BOSS);
    galvek.setOwner?.(p); galvek.setOwnerOnly?.(true); galvek.__skipDefaultRespawn = true;
    galvek.setScriptedMovement(true); galvek.setMaxHitpoints?.(1200); galvek.setHitpoints?.(1200);
    area.add(galvek); World.getAddNPCQueue().push(galvek);
    p.setAttribute(ATTR_BOSS, galvek);
    p.sendMessage("Galvek lands on the ship. Change prayers and watch the dragon's attacks carefully.");
  }
  function leaveArea(p) {
    const old = p.getAttribute(ATTR_AREA);
    if (old && typeof old.isDestroyed === "function" && !old.isDestroyed()) {
      old.leave(p, false); old.postLeave(p, false); old.destroy();
    }
    p.setAttribute(ATTR_AREA, null); p.setAttribute(ATTR_BOSS, null);
  }
  function processGalvek(area, player, boss) {
    const hp = boss.getHitpoints();
    const phase = hp > 900 ? 0 : hp > 600 ? 1 : hp > 300 ? 2 : 3;
    if (area.galvekPhase !== phase) {
      area.galvekPhase = phase;
      boss.setNpcTransformationId?.(GALVEK_PHASES[phase]);
      const names = ["fire", "air", "water", "earth"];
      player.sendMessage(`Galvek draws on the power of ${names[phase]}. Change your protection and watch for the special attack.`);
    }
    area.galvekTick = (area.galvekTick || 0) + 1;
    const pending = area.galvekHazard;
    if (pending && area.galvekTick >= pending.impactAt) {
      area.galvekHazard = null;
      const here = player.getLocation();
      const dx = Math.abs(here.getX() - pending.x);
      const dy = Math.abs(here.getY() - pending.y);
      if (pending.kind === "fireball") {
        if (Math.max(dx, dy) <= 1) {
          player.sendMessage("Galvek's fireball explodes beneath you!");
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.max(1, player.getHitpoints()), HitMask.RED)]);
        } else player.sendMessage("Galvek's fireball crashes into the deck where you stood.");
      } else if (pending.kind === "hurricane") {
        if (Math.max(dx, dy) <= 1) {
          player.sendMessage("The hurricane catches you and drains your energy.");
          player.setRunEnergy(Math.max(0, player.getRunEnergy() - 35));
          player.getSkillManager().decreaseCurrentLevel(Skill.RANGED, 5, 0);
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(20, HitMask.RED)]);
        } else player.sendMessage("You avoid the worst of Galvek's hurricane.");
      } else if (pending.kind === "tsunami") {
        if (here.getY() === pending.y && here.getX() !== pending.gapX) {
          player.sendMessage("The tsunami sweeps you off your feet!");
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(109, HitMask.RED)]);
        } else player.sendMessage("You find the gap and the wave passes over the deck.");
      } else if (pending.kind === "earth") {
        if (Math.max(dx, dy) <= 1) {
          player.sendMessage("Galvek's earth attack entombs you in stone.");
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(30, HitMask.RED)]);
        } else player.sendMessage("The earth projectile smashes into the deck beside you.");
      }
    }
    if (area.galvekHazard || area.galvekTick < (area.galvekNextSpecial || 7)) return;
    const here = player.getLocation();
    const x = here.getX(); const y = here.getY();
    const count = area.galvekSpecialCount || 0;
    const kind = count % 2 === 0 ? "fireball" : ["fireball", "hurricane", "tsunami", "earth"][phase];
    area.galvekSpecialCount = count + 1;
    area.galvekNextSpecial = area.galvekTick + 9;
    if (count > 0 && count % 4 === 0) {
      PrayerHandler.deactivatePrayers(player);
      player.sendMessage("Galvek's purple dragonfire extinguishes your prayers!");
    }
    if (kind === "fireball") {
      player.sendMessage("Galvek launches a fireball into the air. Move at least two tiles away!");
      area.galvekHazard = { kind, x, y, impactAt: area.galvekTick + 3 };
    } else if (kind === "hurricane") {
      player.sendMessage("Galvek summons a hurricane. Move away before it reaches you!");
      area.galvekHazard = { kind, x, y, impactAt: area.galvekTick + 3 };
    } else if (kind === "tsunami") {
      const gapX = x + 2;
      player.sendMessage(`A tsunami sweeps across the ship. The one-tile gap is at ${gapX}, ${y}; get into it!`);
      area.galvekHazard = { kind, x, y, gapX, impactAt: area.galvekTick + 3 };
    } else {
      player.sendMessage("Galvek hurls a rock at you. Move aside before it entombs you!");
      area.galvekHazard = { kind, x, y, impactAt: area.galvekTick + 3 };
    }
  }
  function spawnKaramjaGuardians(area, player) {
    for (const row of spawnRows) {
      if (!KARAMJA_GUARDIAN_BOX || row.x < KARAMJA_GUARDIAN_BOX.minX || row.x >= KARAMJA_GUARDIAN_BOX.maxX
        || row.y < KARAMJA_GUARDIAN_BOX.minY || row.y >= KARAMJA_GUARDIAN_BOX.maxY
        || !String(row.name || "").startsWith("Stone Guardian")) continue;
      const npc = api.spawnNpc({
        id: row.id,
        x: area.getBaseX() + row.x - KARAMJA_SOURCE.x,
        y: area.getBaseY() + row.y - KARAMJA_SOURCE.y,
        z: row.level || 0,
        owner: player,
        ownerOnly: true,
        wanderRadius: 2,
      });
      if (npc) area.add(npc);
    }
  }
  function enterKaramjaMaze({ player: p, objectId, location }) {
    if (objectId !== O.CAVE_63 || location.x !== KARAMJA_ENTRANCE.x || location.y !== KARAMJA_ENTRANCE.y || location.z !== KARAMJA_ENTRANCE.z) return false;
    if (stage(p) < S.KEYS || stage(p) > S.FORGE) {
      p.sendMessage("The cave is too dangerous to explore until you have learned about Robert the Strong's key pieces.");
      return true;
    }
    leaveArea(p);
    const area = new KaramjaArea(p);
    area.enter(p);
    p.setAttribute(ATTR_AREA, area);
    p.setAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE, true);
    p.moveTo(area.tile(KARAMJA_START.x - KARAMJA_SOURCE.x, KARAMJA_START.y - KARAMJA_SOURCE.y, 0));
    spawnKaramjaGuardians(area, p);
    p.sendMessage("You descend into the ancient Karamjan Temple.");
    return true;
  }
  function leaveKaramjaMaze(p, area = p.getAttribute(ATTR_AREA)) {
    if (!(area instanceof KaramjaArea)) return false;
    area.leave(p, false);
    area.postLeave(p, false);
    area.destroy();
    p.setAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE, false);
    p.moveTo(new Location(KARAMJA_EXIT.x, KARAMJA_EXIT.y, KARAMJA_EXIT.z));
    return true;
  }
  const CRYPT_SOURCE = { x: 1472, y: 9920 };
  // The cache already contains the canonical puzzle at these locs. 29901 is
  // Camorra's tomb; 29902-29905 are the corner busts; 29906-29909 are the
  // four 2x1 plinths. Their transforms use native DS2 varbits 6105, 6152-6155.
  const CRYPT_TOMB = { id: 29901, x: 1503, y: 9938, width: 2, height: 2 };
  const CRYPT_PLINTHS = {
    north: { id: 29906, x: 1503, y: 9941, width: 2, height: 1, click: [1504, 9941], varbit: 6152 },
    south: { id: 29907, x: 1503, y: 9936, width: 2, height: 1, click: [1504, 9936], varbit: 6153 },
    east: { id: 29908, x: 1506, y: 9938, width: 1, height: 2, click: [1506, 9939], varbit: 6154 },
    west: { id: 29909, x: 1501, y: 9938, width: 1, height: 2, click: [1501, 9939], varbit: 6155 },
  };
  const CRYPT_BUSTS = [
    { item: I.AIVAS_BUST, templateObject: 29905, object: O.BUST_8, emptyObject: O.BUST_7, nativeValue: 3, location: [1500, 9941], face: 3, label: "Aivas", home: "Zartharim", weapon: "crossbow" },
    { item: I.CAMORRA_BUST, templateObject: 29903, object: O.BUST_10, emptyObject: O.BUST_9, nativeValue: 2, location: [1507, 9936], face: 1, label: "Camorra", home: "Saranthium", weapon: "axe" },
    { item: I.ROBERT_BUST, templateObject: 29902, object: O.BUST_12, emptyObject: O.BUST_11, nativeValue: 4, location: [1500, 9936], face: 2, label: "Robert", home: "Arkney", weapon: "bow" },
    { item: I.TRISTAN_BUST, templateObject: 29904, object: O.BUST_14, emptyObject: O.BUST_13, nativeValue: 1, location: [1507, 9941], face: 0, label: "Tristan", home: "Karville", weapon: "sword" },
  ];
  const CRYPT_PUZZLE_PLANE = 1;
  const CRYPT_ENTRANCE = { x: 1483, y: 3548, z: 0 };
  const CRYPT_STAIRS = new Map([
    [O.LADDER_370, [{ x: 1479, y: 9950, z: 2, to: [1479, 9950, 1] }, { x: 1528, y: 9950, z: 2, to: [1528, 9950, 1] }]],
    [O.LADDER_371, [{ x: 1479, y: 9950, z: 1, to: [1479, 9950, 2] }, { x: 1528, y: 9950, z: 1, to: [1528, 9950, 2] }]],
    [O.LADDER_372, [{ x: 1524, y: 9967, z: 3, to: [1524, 9967, 2] }]],
    [O.LADDER_373, [{ x: 1524, y: 9967, z: 2, to: [1524, 9967, 3] }]],
    [O.LADDER_374, [{ x: 1483, y: 9933, z: 3, to: [1483, 9933, 2] }]],
    [O.LADDER_375, [{ x: 1483, y: 9933, z: 2, to: [1483, 9933, 3] }]],
    [O.STAIRCASE_171, [{ x: 1503, y: 9927, z: 3, to: [1503, 9925, 2] }, { x: 1496, y: 9978, z: 2, to: [1494, 9978, 1] }, { x: 1510, y: 9978, z: 2, to: [1510, 9978, 1] }]],
    [O.STAIRCASE_170, [{ x: 1503, y: 9925, z: 2, to: [1503, 9927, 3] }, { x: 1494, y: 9978, z: 1, to: [1496, 9978, 2] }, { x: 1510, y: 9978, z: 1, to: [1510, 9978, 2] }]],
  ]);
  function cryptObjects(area) {
    area.puzzleObjects ??= [];
    return area.puzzleObjects;
  }
  function removeCryptObjectAt(area, target) {
    for (const object of cryptObjects(area).filter((entry) => {
      const loc = entry.getLocation();
      return loc.getX() === target.getX() && loc.getY() === target.getY() && loc.getZ() === target.getZ();
    })) {
      ObjectManager.deregister(object, true);
      area.remove(object);
      area.puzzleObjects.splice(area.puzzleObjects.indexOf(object), 1);
    }
  }
  function setCryptBustObject(area, bust, id) {
    const target = area.tile(bust.location[0] - CRYPT_SOURCE.x, bust.location[1] - CRYPT_SOURCE.y, CRYPT_PUZZLE_PLANE);
    removeCryptObjectAt(area, target);
    // Overlay the canonical cache bust loc with its quest child. Its 11-shape
    // and face match the cache loc, so the cache position/collision stays put.
    const object = new GameObject(id, target, 11, bust.face, area);
    ObjectManager.register(object, true);
    area.add(object);
    cryptObjects(area).push(object);
  }
  function setCryptPuzzleVarbits(p, placed) {
    const sender = p.getPacketSender?.();
    const bustFor = (direction) => CRYPT_BUSTS.find((bust) => bust.item === placed[direction]);
    for (const [direction, plinth] of Object.entries(CRYPT_PLINTHS)) {
      sender?.sendVarbit?.(plinth.varbit, bustFor(direction)?.nativeValue ?? 0);
    }
    const nativeStage = (p.getAttribute(ATTR_CRYPT_KEY_COLLECTED) || has(p, KEY_PARTS[3])) ? 36
      : Object.keys(placed).length === 4 ? 30
        : p.getAttribute(ATTR_CRYPT_INSPECTED) || Object.keys(placed).length ? 25 : 4;
    sender?.sendVarbit?.(6105, nativeStage);
  }
  function resetCryptPuzzle(p, area, randomize = true, revealClues = true) {
    if (randomize || !Array.isArray(p.getAttribute(ATTR_CRYPT_ORDER))) {
      const order = CRYPT_BUSTS.map((bust) => bust.item);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      p.setAttribute(ATTR_CRYPT_ORDER, order);
    }
    const placed = randomize ? {} : (p.getAttribute(ATTR_CRYPT_PLACED) || {});
    p.setAttribute(ATTR_CRYPT_PLACED, placed);
    if (Object.keys(placed).length) p.setAttribute(ATTR_CRYPT_INSPECTED, true);
    for (const bust of CRYPT_BUSTS) {
      const heldOrPlaced = has(p, bust.item) || Object.values(placed).includes(bust.item);
      const objectId = heldOrPlaced || !p.getAttribute(ATTR_CRYPT_INSPECTED) ? bust.emptyObject : bust.object;
      setCryptBustObject(area, bust, objectId);
    }
    setCryptPuzzleVarbits(p, placed);
    if (revealClues) {
      const [north, south, west] = p.getAttribute(ATTR_CRYPT_ORDER);
      const person = (item) => CRYPT_BUSTS.find((bust) => bust.item === item);
      const n = person(north), s = person(south), w = person(west);
      p.sendMessage(`The one from ${n.home} sat at the north of the table.`);
      p.sendMessage(`The ${s.weapon} bearer sat opposite ${n.label}.`);
      p.sendMessage(`The ${w.weapon} bearer sat at the west of the table; place the remaining bust east.`);
    }
  }
  function enterKourendCrypt({ player: p, objectId, location }) {
    if (objectId !== O.CRYPT_ENTRANCE || location.x !== CRYPT_ENTRANCE.x || location.y !== CRYPT_ENTRANCE.y) return false;
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || !p.getAttribute(ATTR_CRYPT_READY)) {
      p.sendMessage("You should find out what Camorra's clues say before entering the crypt.");
      return true;
    }
    leaveArea(p);
    const area = new KourendCryptArea(p.getUsername?.());
    area.enter(p);
    p.setAttribute(ATTR_AREA, area);
    p.setAttribute(ATTR_CRYPT_ACTIVE, true);
    p.moveTo(area.tile(1483 - CRYPT_SOURCE.x, 9933 - CRYPT_SOURCE.y, 3));
    for (const row of spawnRows) {
      if (row.x < 1472 || row.x >= 1568 || row.y < 9920 || row.y >= 9984) continue;
      if (!/^(?:Skeleton|Zombie)/i.test(row.name || "")) continue;
      const npc = api.spawnNpc({
        id: row.id,
        x: area.getBaseX() + row.x - CRYPT_SOURCE.x,
        y: area.getBaseY() + row.y - CRYPT_SOURCE.y,
        z: row.level || 0,
        owner: p,
        ownerOnly: true,
      });
      if (npc) area.add(npc);
    }
    resetCryptPuzzle(p, area, !p.getAttribute(ATTR_CRYPT_ORDER), false);
    p.sendMessage("You descend into the Shayzien Crypts. The tomb lies on the lowest floor.");
    return true;
  }
  function inCryptFootprint(x, y, footprint) {
    return x >= footprint.x && y >= footprint.y
      && x < footprint.x + footprint.width && y < footprint.y + footprint.height;
  }
  function isCryptTombObject(id) {
    return id === CRYPT_TOMB.id || id === O.TOMB_6 || id === O.TOMB_7;
  }
  function isCryptPlinthObject(id) {
    return Object.values(CRYPT_PLINTHS).some((plinth) => plinth.id === id)
      || [O.PLINTH_10, O.PLINTH_11, O.PLINTH_12, O.PLINTH_13, O.PLINTH_14, O.PLINTH_15].includes(id);
  }
  function handleCryptObject(event) {
    const { player: p, objectId, location } = event;
    const area = p.getAttribute(ATTR_AREA);
    if (!(area instanceof KourendCryptArea) || stage(p) < S.KEYS || stage(p) > S.FORGE) return false;
    const visibleObjectId = event.definition?.id ?? objectId;
    const sourceX = CRYPT_SOURCE.x + location.x - area.getBaseX();
    const sourceY = CRYPT_SOURCE.y + location.y - area.getBaseY();
    const stair = CRYPT_STAIRS.get(visibleObjectId)?.find(({ x, y, z }) => x === sourceX && y === sourceY && z === location.z)
      ?? CRYPT_STAIRS.get(objectId)?.find(({ x, y, z }) => x === sourceX && y === sourceY && z === location.z);
    if (stair) {
      p.moveTo(area.tile(stair.to[0] - CRYPT_SOURCE.x, stair.to[1] - CRYPT_SOURCE.y, stair.to[2]));
      p.sendMessage(stair.to[2] < location.z ? "You climb down." : "You climb up.");
      return true;
    }
    if (isCryptTombObject(visibleObjectId) && inCryptFootprint(sourceX, sourceY, CRYPT_TOMB) && location.z === CRYPT_PUZZLE_PLANE) {
      const placed = p.getAttribute(ATTR_CRYPT_PLACED) || {};
      if (visibleObjectId === O.TOMB_7 || Object.keys(placed).length === 4) {
        if (has(p, KEY_PARTS[3])) {
          return p.sendMessage("The tomb has already yielded its dragon key piece.");
        }
        if (!give(p, KEY_PARTS[3])) return true;
        p.setAttribute(ATTR_CRYPT_KEY_COLLECTED, true);
        const parts = (Number(p.getAttribute(ATTR_PARTS)) || 0) | (1 << 3);
        p.setAttribute(ATTR_PARTS, parts);
        setCryptPuzzleVarbits(p, placed);
        if (parts === 15) advance(p, S.FORGE);
        p.sendMessage("You search Camorra's tomb and take the dragon key piece.");
        return true;
      }
      p.setAttribute(ATTR_CRYPT_INSPECTED, true);
      resetCryptPuzzle(p, area, !Array.isArray(p.getAttribute(ATTR_CRYPT_ORDER)), true);
      p.sendMessage("You inspect Camorra's tomb and study the clues around the table.");
      return true;
    }
    const bust = CRYPT_BUSTS.find((entry) => (entry.templateObject === visibleObjectId || entry.object === visibleObjectId)
      && entry.location[0] === sourceX && entry.location[1] === sourceY && location.z === CRYPT_PUZZLE_PLANE);
    if (bust) {
      if (!p.getAttribute(ATTR_CRYPT_INSPECTED)) return false;
      if (has(p, bust.item) || Object.values(p.getAttribute(ATTR_CRYPT_PLACED) || {}).includes(bust.item)) {
        p.sendMessage(`You already have the bust of ${bust.label}.`);
        return true;
      }
      if (!has(p, bust.item)) {
        if (!give(p, bust.item)) return true;
        setCryptBustObject(area, bust, bust.emptyObject);
        p.sendMessage(`You pick up the bust of ${bust.label}.`);
      }
      return true;
    }
    return false;
  }
  function placeCryptBust(event) {
    const { player: p, itemId, objectId, location } = event;
    const area = p.getAttribute(ATTR_AREA);
    const visibleObjectId = event.definition?.id ?? objectId;
    if (!(area instanceof KourendCryptArea) || !isCryptPlinthObject(visibleObjectId) || !CRYPT_BUSTS.some((bust) => bust.item === itemId)) return false;
    const sourceX = CRYPT_SOURCE.x + location.x - area.getBaseX();
    const sourceY = CRYPT_SOURCE.y + location.y - area.getBaseY();
    const direction = Object.entries(CRYPT_PLINTHS).find(([, plinth]) => inCryptFootprint(sourceX, sourceY, plinth))?.[0];
    if (!direction) return false;
    if (!p.getAttribute(ATTR_CRYPT_INSPECTED)) return false;
    event.handled = true;
    const order = p.getAttribute(ATTR_CRYPT_ORDER);
    const expected = { north: order?.[0], south: order?.[1], west: order?.[2], east: order?.[3] }[direction];
    if (itemId !== expected) {
      p.sendMessage("The bust does not fit this clue. The puzzle resets and the crypt throws you back upstairs.");
      for (const placedItem of Object.values(p.getAttribute(ATTR_CRYPT_PLACED) || {})) give(p, placedItem);
      resetCryptPuzzle(p, area, true);
      p.moveTo(area.tile(1483 - CRYPT_SOURCE.x, 9933 - CRYPT_SOURCE.y, 3));
      return true;
    }
    remove(p, itemId);
    const placed = { ...(p.getAttribute(ATTR_CRYPT_PLACED) || {}), [direction]: itemId };
    p.setAttribute(ATTR_CRYPT_PLACED, placed);
    const bust = CRYPT_BUSTS.find((entry) => entry.item === itemId);
    setCryptBustObject(area, bust, bust.emptyObject);
    setCryptPuzzleVarbits(p, placed);
    p.sendMessage(`You place the bust at the ${direction} of the table.`);
    if (Object.keys(placed).length === 4) {
      p.sendMessage("The tomb unlocks. Search it for the dragon key piece.");
    }
    return true;
  }
  function enterUngaelLaboratory({ player: p, objectId, location }) {
    const current = p.getAttribute(ATTR_AREA);
    if (current instanceof UngaelLabArea) {
      const sourceX = 2256 + location.x - current.getBaseX();
      const sourceY = 10456 + location.y - current.getBaseY();
      if (objectId !== O.CAVE_62 || sourceX !== 2248 || sourceY !== 4077) return false;
      current.leave(p, false); current.postLeave(p, false); current.destroy();
      p.setAttribute(ATTR_UNGAEL_LAB_ACTIVE, false);
      p.moveTo(new Location(2248, 4077, 0));
      return true;
    }
    if (objectId !== O.CAVE_62 || location.x !== 2248 || location.y !== 4077) return false;
    if (stage(p) < S.KEYS || !p.getAttribute(ATTR_VORKATH_DEFEATED)) {
      p.sendMessage("Vorkath blocks the way into the Dragonkin laboratory.");
      return true;
    }
    leaveArea(p);
    const area = new UngaelLabArea(p.getUsername?.());
    area.enter(p);
    p.setAttribute(ATTR_AREA, area);
    p.setAttribute(ATTR_UNGAEL_LAB_ACTIVE, true);
    p.moveTo(area.tile(12, 16, 0));
    p.sendMessage("You enter the Ungael laboratory. Search the machinery, then find a way to the locked eastern room.");
    return true;
  }
  function handleUngaelLab({ player: p, objectId, location }) {
    const area = p.getAttribute(ATTR_AREA);
    if (!(area instanceof UngaelLabArea)) return false;
    const sourceX = UNGAEL_LAB_SOURCE_X + location.x - area.getBaseX();
    const sourceY = UNGAEL_LAB_SOURCE_Y + location.y - area.getBaseY();
    const note = UNGAEL_NOTE_OBJECTS.get(objectId);
    if (note && stage(p) >= S.KEYS && sourceX === note.x && sourceY === note.y) {
      if (has(p, note.item)) p.sendMessage("You have already taken this set of Dragonkin notes.");
      else if (give(p, note.item)) p.sendMessage("You search the ancient apparatus and find an old Dragonkin note.");
      return true;
    }
    if (objectId === O.LEVER_55 && sourceX === 2260 && sourceY === 10464) {
      if ((p.getRunEnergy?.() ?? 100) < 15) { p.sendMessage("You need at least 15% run energy to reach the other side in time."); return true; }
      p.setAttribute(ATTR_LAB_TIMER, World.getProcessCycle() + 30);
      p.sendMessage("You pull the lever. A door opens somewhere to the east!");
      return true;
    }
    if (objectId === O.STONE_CHEST_3 && sourceX === 2292 && sourceY === 10466) {
      if ((Number(p.getAttribute(ATTR_LAB_TIMER)) || 0) < World.getProcessCycle()) {
        p.sendMessage("The eastern door has shut. Pull the lever again and hurry.");
        return true;
      }
      if (!has(p, KEY_PARTS[2]) && p.getInventory().getFreeSlots() < 2) {
        p.sendMessage("You need two free inventory spaces for the key piece and ancient key.");
        return true;
      }
      if (!has(p, KEY_PARTS[2])) {
        if (!give(p, KEY_PARTS[2])) return true;
        const parts = (Number(p.getAttribute(ATTR_PARTS)) || 0) | (1 << 2);
        p.setAttribute(ATTR_PARTS, parts);
        if (parts === 15) advance(p, S.FORGE);
      }
      if (!has(p, I.ANCIENT_KEY)) give(p, I.ANCIENT_KEY);
      p.sendMessage("You search the stone chest and take the Ungael dragon key piece and ancient key.");
      return true;
    }
    return false;
  }
  function exitKaramjaStaircase({ player: p, objectId, location }) {
    if (objectId !== O.STAIRCASE_172 || !(p.getAttribute(ATTR_AREA) instanceof KaramjaArea)) return false;
    const area = p.getAttribute(ATTR_AREA);
    const sourceX = KARAMJA_SOURCE.x + location.x - area.getBaseX();
    const sourceY = KARAMJA_SOURCE.y + location.y - area.getBaseY();
    if (sourceX !== 2846 || sourceY !== 9293 || location.z !== 0) return false;
    p.sendMessage("You climb back out of the temple.");
    return leaveKaramjaMaze(p, area);
  }
  function handleKaramjaPlinth({ player: p, objectId, location }) {
    const area = p.getAttribute(ATTR_AREA);
    if (!(area instanceof KaramjaArea) || stage(p) < S.KEYS || stage(p) > S.FORGE) return false;
    const sourceX = KARAMJA_SOURCE.x + location.x - area.getBaseX();
    const sourceY = KARAMJA_SOURCE.y + location.y - area.getBaseY();
    if (sourceX !== KARAMJA_PLINTH.x || sourceY !== KARAMJA_PLINTH.y || location.z !== KARAMJA_PLINTH.z) return false;
    if (objectId === O.PLINTH_17 || objectId === O.PLINTH_16) {
      if (has(p, KEY_PARTS[0])) {
        area.installPlinth(O.PLINTH_18);
        return true;
      }
      if (!give(p, KEY_PARTS[0])) return true;
      const parts = Number(p.getAttribute(ATTR_PARTS)) || 0;
      p.setAttribute(ATTR_PARTS, parts | 1);
      area.installPlinth(O.PLINTH_18);
      p.sendMessage("You take the dragon key piece from the plinth.");
      if ((parts | 1) === 15) advance(p, S.FORGE);
      return true;
    }
    if (objectId === O.PLINTH_18) {
      p.sendMessage("The plinth hums with ancient power and returns you to the temple entrance.");
      return leaveKaramjaMaze(p, area);
    }
    return false;
  }
  function searchKaramjaSkeleton({ player: p, objectId, location }) {
    const area = p.getAttribute(ATTR_AREA);
    if (!(area instanceof KaramjaArea) || objectId !== O.SKELETON_84 || stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    const sourceX = KARAMJA_SOURCE.x + location.x - area.getBaseX();
    const sourceY = KARAMJA_SOURCE.y + location.y - area.getBaseY();
    if (sourceX !== 2838 || sourceY !== 9219 || location.z !== 0) return false;
    if (p.getAttribute(ATTR_KARAMJA_JOURNAL)) return p.sendMessage("You have already taken the journal from the skeleton.");
    if (!give(p, I.MALUMACS_JOURNAL)) return true;
    p.setAttribute(ATTR_KARAMJA_JOURNAL, true);
    p.sendMessage("You find Malumac's journal among the skeleton's remains.");
    return true;
  }
  function disableKaramjaTrap({ player: p, objectId, location, object }) {
    const area = p.getAttribute(ATTR_AREA);
    if (!(area instanceof KaramjaArea) || !KARAMJA_TRAPS.has(objectId)) return false;
    const acrossX = Number(object?.getFace?.() ?? 0) % 2 === 1;
    const axis = acrossX ? "x" : "y";
    const crossTrap = () => {
      const side = Math.sign(p.getLocation()[acrossX ? "getX" : "getY"]() - location[axis]);
      const offset = (side || -1) * 2;
      const destination = acrossX
        ? new Location(location.x - offset, location.y, location.z)
        : new Location(location.x, location.y - offset, location.z);
      p.getMovementQueue().reset();
      p.moveTo(destination);
    };
    if (objectId === O.TRAP_11 || objectId === O.TRAP_12) {
      if (p.getSkillManager().getMaxLevel(Skill.THIEVING) < 60) return p.sendMessage("You need at least 60 Thieving to disable these traps.");
      area.disabledTraps ??= new Set();
      const trapKey = `${location.x},${location.y}`;
      if (area.disabledTraps.has(trapKey)) return p.sendMessage("You have already disabled this trap.");
      if (Math.random() < Math.min(0.9, p.getSkillManager().getMaxLevel(Skill.THIEVING) / 100)) {
        p.sendMessage("You carefully disable the wall trap.");
        area.disabledTraps.add(trapKey);
        crossTrap();
      } else {
        p.sendMessage("You trigger the wall trap while trying to disable it.");
        p.getCombat().getHitQueue().addPendingDamage([new HitDamage(1 + Math.floor(Math.random() * 8), HitMask.RED)]);
      }
      return true;
    }
    if (p.getSkillManager().getMaxLevel(Skill.AGILITY) < 60) return p.sendMessage("You need at least 60 Agility to climb over these traps.");
    if (Math.random() < Math.min(0.9, p.getSkillManager().getMaxLevel(Skill.AGILITY) / 100)) {
      p.sendMessage("You nimbly climb over the floor trap.");
      crossTrap();
    } else {
      p.sendMessage("You misjudge the trap and are struck by its blades.");
      p.getCombat().getHitQueue().addPendingDamage([new HitDamage(1 + Math.floor(Math.random() * 8), HitMask.RED)]);
    }
    return true;
  }
  function routeKaramjaTrap(event) {
    if (!KARAMJA_TRAPS.has(event.objectId) || event.clickType !== 1
      || !(event.player.getAttribute(ATTR_AREA) instanceof KaramjaArea)) return;
    const area = event.player.getAttribute(ATTR_AREA);
    const { x, y, z } = event.object.getLocation();
    const position = event.player.getLocation();
    const route = new api.core.RsmodRouteFinding().findRoute({
      level: position.getZ(), srcX: position.getX(), srcY: position.getY(), srcSize: 1,
      destX: x, destY: y, privateArea: area, moveNear: true,
    });
    if (route.success) event.destination = { x: route.endX, y: route.endY, z };
  }
  function routeKourendEntrance(event) {
    if (event.objectId !== O.CRYPT_ENTRANCE || event.clickType !== 1) return;
    const { x, y, z } = event.object.getLocation();
    const position = event.player.getLocation();
    const route = new api.core.RsmodRouteFinding().findRoute({
      level: position.getZ(), srcX: position.getX(), srcY: position.getY(), srcSize: 1,
      destX: x, destY: y, privateArea: event.player.getArea?.() ?? null, moveNear: true,
    });
    if (route.success) event.destination = { x: route.endX, y: route.endY, z };
  }
  function routeKourendStairs(event) {
    const area = event.player.getAttribute(ATTR_AREA);
    if (!(area instanceof KourendCryptArea) || event.clickType !== 1) return;
    const { x, y, z } = event.object.getLocation();
    const sourceX = CRYPT_SOURCE.x + x - area.getBaseX();
    const sourceY = CRYPT_SOURCE.y + y - area.getBaseY();
    const stair = CRYPT_STAIRS.get(event.objectId)?.find((entry) => entry.x === sourceX && entry.y === sourceY && entry.z === z);
    if (!stair) return;
    const player = event.player.getLocation();
    const definition = event.definition;
    let width = definition?.getSizeX?.() ?? 1;
    let height = definition?.getSizeY?.() ?? 1;
    if ((event.object.getFace?.() ?? 0) & 1) [width, height] = [height, width];
    const candidates = [];
    for (let dx = 0; dx < width; dx++) {
      for (let dy = 0; dy < height; dy++) {
        candidates.push({ x: x + dx, y: y - 1 }, { x: x + dx, y: y + height });
      }
    }
    for (let dy = 0; dy < height; dy++) {
      candidates.push({ x: x - 1, y: y + dy }, { x: x + width, y: y + dy });
    }
    const finder = new api.core.RsmodRouteFinding();
    const reachable = candidates
      .map((tile) => ({ ...tile, route: finder.findRoute({
        level: z, srcX: player.getX(), srcY: player.getY(), srcSize: 1,
        destX: tile.x, destY: tile.y, privateArea: area, moveNear: false,
      }) }))
      .filter((candidate) => candidate.route.success)
      .sort((a, b) => (Math.abs(a.x - player.getX()) + Math.abs(a.y - player.getY())) - (Math.abs(b.x - player.getX()) + Math.abs(b.y - player.getY())));
    if (reachable.length) event.destination = { x: reachable[0].x, y: reachable[0].y, z };
  }
  function handleNpcDeath({ killer, npc }) {
    if (killer && stage(killer) === S.KEYS && killer.getAttribute(ATTR_UNGAEL_TRIP)
      && [N.VORKATH_4, N.VORKATH_5].includes(npc?.getId?.())) {
      killer.setAttribute(ATTR_VORKATH_DEFEATED, true);
      syncUngaelExit(killer);
      killer.sendMessage("Vorkath falls. The cave to the north-west leads to the Dragonkin laboratory.");
      return;
    }
    if (!killer || killer.getAttribute(ATTR_BOSS) !== npc || !(killer.getAttribute(ATTR_AREA) instanceof QuestArea)) return;
    const s = stage(killer);
    if (s === S.FLEET) {
      const next = (Number(killer.getAttribute(ATTR_ASSAULT_INDEX)) || 0) + 1;
      if (next === 7) {
        killer.setAttribute(ATTR_ASSAULT_CHECKPOINT, 7);
        talk(killer, N.ZORGOTH, "the-assault-arrival-of-zorgoth-and-galvek");
        spawnAssaultDragon(killer, next);
        return;
      }
      if (next === 10) {
        killer.setAttribute(ATTR_ASSAULT_CHECKPOINT, 10);
        talk(killer, N.WISE_OLD_MAN, "the-assault-the-heroes-arrive");
        spawnAssaultDragon(killer, next);
        return;
      }
      if (next < ASSAULT_DRAGONS.length) {
        if (next === 1) addAssaultTraversal(killer.getAttribute(ATTR_AREA));
        spawnAssaultDragon(killer, next);
      } else {
        killer.setAttribute(ATTR_ASSAULT_INDEX, ASSAULT_DRAGONS.length);
        advance(killer, S.GALVEK);
        talk(killer, N.ZORGOTH, "the-assault-the-final-fight-begins");
        spawnGalvek(killer);
      }
      return;
    }
    if (s === S.MURAL) {
      killer.setAttribute(ATTR_MURAL_GUARDIAN_DEFEATED, true);
      killer.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 25);
      killer.getPacketSender?.().sendVarbit?.(6104, 25);
      killer.sendMessage("The Spawn collapses. You should investigate the mural again.");
    }
    if (s === S.DREAM) {
      talk(killer, N.BOB, "robert-the-strong-robert-s-memories", (steps) => [
        ...steps,
        { type: "action", text: "Bob's recovered memories are complete.", id: ACTION_BOB_MEMORIES_COMPLETE },
      ]);
    }
    else if (s === S.GALVEK) {
      killer.setAttribute(ATTR_GALVEK_DEFEATED, true);
      killer.sendMessage("Galvek falls. Speak to the heroes, then return to Alec Kincade at the Myths' Guild.");
      talk(killer, N.BRUNDT_THE_CHIEFTAIN_9, "the-assault-end-of-the-battle");
    }
    leaveArea(killer);
  }
  function syncUngaelExit(player) {
    // Cache loc 25337 at the north crater wall transforms to climbable loc
    // 31992 at varbit 6108 value 30, and the Rellekka boat (29917) shows Travel from 20.
    // A completed quest counts too (live OSRS is at 45 by then, rsprox 229/2334; 30 is enough for both).
    player.getPacketSender?.().sendVarbit?.(VARBIT_UNGAEL_EXIT,
      // The final transform is the default child after transform value 29.
      player.getAttribute(ATTR_VORKATH_DEFEATED) || stage(player) >= S.COMPLETE ? 30 : 0);
  }
  function handleObject(event) {
    const handled = handleObjectAction(event);
    if (handled) event.handled = true;
    return handled;
  }
  function handleObjectAction({ player: p, objectId, location, clickType, definition }) {
    const s = stage(p);
    // This cache entrance sits beyond the grandiose vault doors. The key unlocks
    // those doors first; don't let the generic loc teleport skip the diary,
    // forged-key and Dallas/Bob chapters by entering the broken doorway early.
    if (objectId === O.BROKEN_DOORS && s < S.LEADERS) {
      p.sendMessage("The grandiose doors are still sealed. Find Aivas' diary and unlock the vault with the completed dragon key first.");
      return true;
    }
    if (searchFossilMapSource({ player: p, objectId, location })) return true;
    if (interactWithFossilMap({ player: p, objectId, location })) return true;
    const option = definition?.getInteractions?.()?.[clickType - 1];
    if (takeAssaultSupply({ player: p, objectId })) return true;
    if (repairAssaultShip({ player: p, objectId, location })) return true;
    if ([29916, O.ROWBOAT_SPACE, O.ROWBOAT_14].includes(objectId)
      || [O.ROWBOAT_SPACE, O.ROWBOAT_14].includes(definition?.id)) {
      return buildLithkrenRowboat({ player: p, objectId, location, definition });
    }
    if (handleUngaelLab({ player: p, objectId, location })) return true;
    if (enterUngaelLaboratory({ player: p, objectId, location })) return true;
    const visibleObjectId = definition?.id ?? objectId;
    if (s === S.LEADERS && p.getAttribute(ATTR_LITHKREN_ARRIVED)
      && [O.ANCIENT_DOORS, O.ANCIENT_DOORS_2, O.ANCIENT_DOORS_3, O.ANCIENT_DOORS_4].includes(visibleObjectId)
      && definition?.getInteractions?.()?.[clickType - 1] === "Enter") {
      return enterDeepLithkrenVault(p);
    }
    if (s === S.TUNNEL && CRANDOR_BLOCKAGE_ACTIONS.has(visibleObjectId)
      && [2859, 2860].includes(location.x) && location.y === 9648 && location.z === 0) {
      const progress = Number(p.getAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS)) || 15;
      if (progress === 15 && (option === "Investigate" || visibleObjectId === 32165)) {
        p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 16);
        p.getPacketSender?.().sendVarbit?.(6104, 16);
        p.sendMessage("You examine the blockage and find a weak point in the rock.");
        return true;
      }
      if (progress === 16 && (option === "Mine" || visibleObjectId === 32167)) {
        if (!has(p, I.BRONZE_PICKAXE) && !has(p, I.IRON_PICKAXE)) {
          p.sendMessage("You need a pickaxe to mine through the blockage.");
          return true;
        }
        p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 17);
        p.getPacketSender?.().sendVarbit?.(6104, 17);
        p.sendMessage("You mine through the blockage and uncover a hidden passage.");
        return true;
      }
      if (progress === 17 && (option === "Enter" || visibleObjectId === 32169)) {
        p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 17);
        advance(p, S.MURAL);
        p.getPacketSender?.().sendVarbit?.(6104, 17);
        p.moveTo(new Location(2867, 9673, 0));
        p.sendMessage("You enter the passage beyond the blockage.");
        return true;
      }
    }
    if (s === S.MURAL && objectId === O.ANCIENT_MURAL && location.x === 2866 && location.y === 9680) {
      if (!p.getAttribute(ATTR_MURAL_GUARDIAN_DEFEATED)) {
        p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 22);
        p.getPacketSender?.().sendVarbit?.(6104, 22);
        p.sendMessage("As you investigate the mural, a Spawn attacks!");
        enterArea(p, N.SPAWN_5, location.x + 2, location.y, 12);
        return true;
      }
      p.setAttribute(ATTR_MURAL_READ, true);
      p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, 30);
      p.getPacketSender?.().sendVarbit?.(6104, 30);
      p.sendMessage("You study the mural again and uncover the Dragonkin's hidden laboratory.");
      return true;
    }
    if (s === S.MURAL && [O.ANCIENT_MACHINERY, O.ANCIENT_MACHINERY_2, O.ANCIENT_MACHINERY_3].includes(objectId)) {
      p.setAttribute(ATTR_NOTES_READ, true);
      p.sendMessage("You find notes describing the Dragonkin's experiments.");
      return true;
    }
    if (s === S.FORGE && [O.ANVIL, O.ANVIL_2, O.ANVIL_3, O.ANVIL_4, O.ANVIL_8].includes(objectId)) {
      if (!has(p, I.ANCIENT_KEY)) return p.sendMessage("You need the ancient key to reforge the dragon key.");
      if (!KEY_PARTS.every((id) => has(p, id))) return p.sendMessage("You need all four dragon key pieces.");
      if ((Number(p.getAttribute(ATTR_FORGE_HEADS)) || 0) !== 7) return p.sendMessage("The dragon forge is still cold. Cast Fire Wave or Fire Surge on all three dragon heads in the Ancient Cavern first.");
      if (!has(p, I.HAMMER)) return p.sendMessage("You need a hammer to reforge the dragon key.");
      KEY_PARTS.forEach((id) => remove(p, id)); remove(p, I.ANCIENT_KEY); give(p, I.DRAGON_KEY);
      advance(p, S.LITHKREN); return true;
    }
    if (s >= S.KEYS && s < S.LEADERS && p.getAttribute(ATTR_LITHKREN_ARRIVED)
      && [O.ANCIENT_DOORS, O.ANCIENT_DOORS_2, O.ANCIENT_DOORS_3, O.ANCIENT_DOORS_4].includes(visibleObjectId)) {
      if (!has(p, I.DRAGON_KEY)) return p.sendMessage("The lock requires a dragon key.");
      remove(p, I.DRAGON_KEY); p.sendMessage("The ancient doors unlock. Dallas and Bob enter the Lithkren laboratory.");
      advance(p, S.LEADERS); return true;
    }
    if (s === S.FLEET && [O.GANGPLANK_15, O.GANGPLANK_16, O.GANGPLANK_77, O.GANGPLANK_78].includes(objectId)) {
      p.sendMessage("Speak to Torfinn to rejoin the allied fleet."); return true;
    }
    return false;
  }
  function useItemOnObject(event) {
    const { player: p, itemId, objectId, handled } = event;
    if (repairAssaultShip({ player: p, itemId, objectId, location: event.location })) {
      event.handled = true;
      return true;
    }
    if (stage(p) === S.DREAM && itemId === I.DREAM_VIAL_EMPTY_ && [O.SINK, O.SINK_2, O.SINK_3, O.FOUNTAIN, O.FOUNTAIN_2].includes(objectId)) {
      event.handled = true;
      remove(p, I.DREAM_VIAL_EMPTY_); give(p, I.DREAM_VIAL_WATER_); return true;
    }
    if (stage(p) === S.DREAM && itemId === I.DREAM_POTION
      && [LUNAR_MOONCLAN_BRAZIER, O.BRAZIER, O.BRAZIER_2, O.BRAZIER_3].includes(objectId)) {
      event.handled = true;
      if ((p.getPacketSender?.().getVarbit?.(2430) ?? 0) < 1) {
        p.sendMessage("Light the ceremonial brazier with a tinderbox first.");
        return true;
      }
      remove(p, I.DREAM_POTION);
      talk(p, N.BOB, "robert-the-strong-using-the-potion-on-the-brazier");
      return true;
    }
    if (stage(p) >= S.KEYS && p.getAttribute(ATTR_LITHKREN_ARRIVED) && itemId === I.DRAGON_KEY
      && [O.ANCIENT_DOORS, O.ANCIENT_DOORS_2, O.ANCIENT_DOORS_3, O.ANCIENT_DOORS_4]
        .includes(api.core.ObjectDefinition.forPlayer(objectId, p)?.id ?? objectId)) {
      const visibleObjectId = api.core.ObjectDefinition.forPlayer(objectId, p)?.id ?? objectId;
      const didUnlock = handleObject({ player: p, objectId: visibleObjectId, handled });
      if (didUnlock) event.handled = true;
      return didUnlock;
    }
    return false;
  }
  function syncForgeHeadVarbits(p) {
    const lit = Number(p.getAttribute(ATTR_FORGE_HEADS)) || 0;
    for (const { bit, varbit } of FORGE_HEADS.values()) p.getPacketSender().sendVarbit(varbit, lit & bit ? 1 : 0);
  }
  function protectForgeHead({ npc, hit }) {
    if (!FORGE_HEADS.has(npc.getId())) return;
    for (const damage of hit.getHits()) damage.setDamage(0);
    hit.updateTotalDamage();
  }
  function kindleDragonForge({ attacker: p, target, spell }) {
    if (!p?.isPlayer?.() || stage(p) !== S.FORGE) return;
    const head = FORGE_HEADS.get(target?.getId?.());
    if (!head) return;
    const wave = api.core.CombatSpells.FIRE_WAVE.spellId();
    const surge = api.core.CombatSpells.FIRE_SURGE.spellId();
    if (![wave, surge].includes(spell?.spellId?.())) return;
    if (!has(p, I.ANCIENT_KEY) || !KEY_PARTS.every((id) => has(p, id))) {
      p.sendMessage("The dragon heads remain dormant until you have the ancient key and all four key pieces.");
      return;
    }
    const lit = (Number(p.getAttribute(ATTR_FORGE_HEADS)) || 0) | head.bit;
    p.setAttribute(ATTR_FORGE_HEADS, lit);
    syncForgeHeadVarbits(p);
    p.sendMessage(lit === 7 ? "The three dragon heads blaze to life. The dragon forge is ready." : "The dragon head glows with the heat of the spell.");
  }
  function itemOnItem({ player: p, usedItemId, usedWithItemId }) {
    if (usedItemId !== usedWithItemId && UNGAEL_NOTES.includes(usedItemId) && UNGAEL_NOTES.includes(usedWithItemId)) {
      if (!UNGAEL_NOTES.every((id) => has(p, id))) {
        p.sendMessage("You need all six Ungael notes before you can combine them.");
        return true;
      }
      UNGAEL_NOTES.forEach((id) => remove(p, id));
      give(p, I.UNGAEL_LAB_NOTES);
      p.sendMessage("You combine the six old notes into a record of Zorgoth's Ungael experiments.");
      return true;
    }
    if (stage(p) >= S.DREAM && stage(p) < S.KEYS && [usedItemId, usedWithItemId].includes(I.ASTRAL_RUNE) && [usedItemId, usedWithItemId].includes(I.HAMMER)) {
      remove(p, I.ASTRAL_RUNE); give(p, I.ASTRAL_RUNE_SHARDS); p.sendMessage("You crush the astral rune into shards."); return true;
    }
    if (stage(p) >= S.DREAM && stage(p) < S.KEYS && [usedItemId, usedWithItemId].includes(I.ASTRAL_RUNE_SHARDS) && [usedItemId, usedWithItemId].includes(I.PESTLE_AND_MORTAR)) {
      remove(p, I.ASTRAL_RUNE_SHARDS); give(p, I.GROUND_ASTRAL_RUNE); return true;
    }
    if (stage(p) >= S.DREAM && stage(p) < S.KEYS && [usedItemId, usedWithItemId].includes(I.DREAM_VIAL_WATER_) && [usedItemId, usedWithItemId].includes(I.GOUTWEED)) {
      remove(p, I.DREAM_VIAL_WATER_); remove(p, I.GOUTWEED); give(p, I.DREAM_VIAL_HERB_); return true;
    }
    if (stage(p) >= S.DREAM && stage(p) < S.KEYS && [usedItemId, usedWithItemId].includes(I.DREAM_VIAL_HERB_) && [usedItemId, usedWithItemId].includes(I.GROUND_ASTRAL_RUNE)) {
      remove(p, I.DREAM_VIAL_HERB_); remove(p, I.GROUND_ASTRAL_RUNE); give(p, I.DREAM_POTION); p.sendMessage("You complete the dream potion."); return true;
    }
    return false;
  }
  function onLogin({ player: p }) {
    syncUngaelExit(p);
    syncForgeHeadVarbits(p);
    if (stage(p) >= S.KEYS && (p.getAttribute(ATTR_CRYPT_ORDER) || p.getAttribute(ATTR_CRYPT_PLACED)
      || p.getAttribute(ATTR_CRYPT_INSPECTED) || p.getAttribute(ATTR_CRYPT_KEY_COLLECTED))) {
      setCryptPuzzleVarbits(p, p.getAttribute(ATTR_CRYPT_PLACED) || {});
    }
    if (stage(p) === S.TUNNEL || stage(p) === S.MURAL) {
      let progress = Number(p.getAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS));
      // Migrate values used by the earlier compact implementation to the real
      // cache milestones (the shared varbit has individual 15/16/17 stages).
      if (stage(p) === S.TUNNEL && progress === 20) progress = 16;
      if (stage(p) === S.TUNNEL && progress === 25) progress = 17;
      if (progress !== Number(p.getAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS))) {
        p.setAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS, progress);
      }
      if ([15, 16, 17, 22, 25, 30].includes(progress)) p.getPacketSender?.().sendVarbit?.(6104, progress);
    }
    if (stage(p) === S.MAP && Array.isArray(p.getAttribute(ATTR_MAP_POSITIONS))) {
      sendMapPuzzleState(p, p.getAttribute(ATTR_MAP_POSITIONS), p.getAttribute(ATTR_MAP_ROTATIONS));
    }
    const area = p.getAttribute(ATTR_AREA);
    if ((area instanceof QuestArea || area instanceof KaramjaArea || area instanceof UngaelLabArea || area instanceof KourendCryptArea) && !area.isDestroyed?.()) {
      leaveArea(p);
    }
    if (p.getAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE)) {
      p.setAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE, false);
      p.moveTo(new Location(KARAMJA_EXIT.x, KARAMJA_EXIT.y, KARAMJA_EXIT.z));
    }
    if (p.getAttribute(ATTR_UNGAEL_LAB_ACTIVE)) {
      p.setAttribute(ATTR_UNGAEL_LAB_ACTIVE, false);
      p.moveTo(new Location(2248, 4077, 0));
    }
    if (p.getAttribute(ATTR_CRYPT_ACTIVE)) {
      p.setAttribute(ATTR_CRYPT_ACTIVE, false);
      p.moveTo(new Location(CRYPT_ENTRANCE.x, CRYPT_ENTRANCE.y, CRYPT_ENTRANCE.z));
    }
    if (p.getAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE)) {
      p.setAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE, false);
      p.moveTo(TORFINN_FLEET);
    }
    if (stage(p) === S.FLEET || stage(p) === S.GALVEK) {
      const savedLocation = p.getLocation();
      if (!(p.getAttribute(ATTR_AREA) instanceof QuestArea)
        || !FLEET_BOUNDARIES.some((boundary) => boundary.inside(savedLocation))) {
        p.moveTo(TORFINN_FLEET);
      }
    }
    if (stage(p) === S.LEADERS && p.getAttribute(ATTR_VAULT_SCENE_ACTIVE)
      && !p.getAttribute(ATTR_VAULT_SCENE_COMPLETE)) {
      enterDeepLithkrenVault(p, { resume: true });
    }
  }
  function onPlayerDeath({ player: p }) {
    const area = p.getAttribute(ATTR_AREA);
    if ((area instanceof QuestArea || area instanceof KaramjaArea || area instanceof UngaelLabArea || area instanceof KourendCryptArea) && !area.isDestroyed?.()) leaveArea(p);
    p.setAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE, false);
    p.setAttribute(ATTR_UNGAEL_LAB_ACTIVE, false);
    p.setAttribute(ATTR_CRYPT_ACTIVE, false);
    p.setAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE, false);
  }
  function onPlayerLogout({ player: p }) {
    if (p.getAttribute(ATTR_AREA) instanceof QuestArea) {
      leaveArea(p);
      p.setAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE, false);
      if (stage(p) === S.FLEET || stage(p) === S.GALVEK) p.moveTo(TORFINN_FLEET);
    }
  }
  function grantDragonSlayerIIRewards(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SMITHING, 80000);
    skills.addExperiences(Skill.MINING, 60000);
    skills.addExperiences(Skill.AGILITY, 50000);
    skills.addExperiences(Skill.THIEVING, 50000);
  }
  function makeInertLocatorOrb({ player: p, usedItemId, usedWithItemId }) {
    const pair = [usedItemId, usedWithItemId];
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || (Number(p.getAttribute(ATTR_MORYTANIA)) || 0) < 4 || !pair.includes(I.GLASSBLOWING_PIPE) || !pair.includes(I.DRAGONSTONE)) return false;
    if (!has(p, I.CHISEL)) return p.sendMessage("You need a chisel to cut the dragonstone.");
    if (!has(p, I.MOLTEN_GLASS, 2)) return p.sendMessage("You need two molten glass to make a locator orb.");
    remove(p, I.DRAGONSTONE); remove(p, I.MOLTEN_GLASS, 2); give(p, I.INERT_LOCATOR_ORB);
    p.sendMessage("You use the pipe and molten glass to encase the dragonstone in an inert locator orb.");
    return true;
  }
  function finishLocatorOrb({ player: p, npcId }) {
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || !has(p, I.INERT_LOCATOR_ORB)) return;
    remove(p, I.INERT_LOCATOR_ORB); give(p, I.LOCATOR_ORB);
    p.setAttribute(ATTR_MORYTANIA, 5);
    const targets = [[3460, 3413], [3477, 3392], [3422, 3364], [3443, 3340], [3493, 3376]];
    p.setAttribute(ATTR_ORB_TARGET, targets[Math.floor(Math.random() * targets.length)]);
    talk(p, npcId, "tristan-s-key-piece-talking-to-ava-after-making-the-orb");
  }
  function feelLocatorOrb(event) {
    const { player: p } = event;
    if (!has(p, I.LOCATOR_ORB)) return;
    event.handled = true;
    const queue = p.getCombat().getHitQueue();
    // Multiple Feels can arrive before the queued self-damage lands.
    const damage = Math.min(10, Math.max(0, p.getHitpoints() - queue.getQueuedDamage() - 1));
    if (damage > 0) queue.addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    const target = p.getAttribute(ATTR_ORB_TARGET);
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || (Number(p.getAttribute(ATTR_MORYTANIA)) || 0) < 5 || !Array.isArray(target)) {
      p.sendMessage("The locator orb is unstable and hurts you as you use it.");
      return;
    }
    const loc = p.getLocation();
    const [x, y] = target;
    const dx = x - loc.getX(), dy = y - loc.getY();
    const directions = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
    const direction = directions[((Math.round(Math.atan2(dx, dy) / (Math.PI / 4)) % 8) + 8) % 8];
    p.sendMessage(Math.max(Math.abs(dx), Math.abs(dy)) <= 1
      ? "The locator orb pulses strongly. The key piece must be buried very close by."
      : `The locator orb glows and pulls you ${direction}. It shocks you as you use it.`);
  }
  function rememberVeosTravelDestination(event) {
    if (!VEOS_NPC_IDS.has(event.npcId) || stage(event.player) < S.KEYS || stage(event.player) >= S.FORGE) return;
    const destination = VEOS_DESTINATIONS[event.option];
    if (destination) event.player.setAttribute(ATTR_VEOS_TRAVEL_DESTINATION, [destination.getX(), destination.getY(), destination.getZ()]);
  }
  function travelWithVeos(event) {
    const { player: p, npcId, definition, clickType } = event;
    if (!VEOS_NPC_IDS.has(npcId) || stage(p) < S.KEYS || stage(p) >= S.FORGE) return false;
    const option = definition?.getActions?.()?.[clickType - 1];
    const destination = VEOS_DESTINATIONS[option === "Port Piscarilius"
      ? "I'd like to travel to Port Piscarilius, please."
      : option === "Land's End" ? "I'd like to travel to Land's End, please." : ""];
    if (!destination) return false;
    p.moveTo(destination);
    p.sendMessage(`Veos takes you to ${option}.`);
    return true;
  }
  function finishVeosTravel(event) {
    const { player: p, npcId, text } = event;
    if (!VEOS_NPC_IDS.has(npcId) || !/^As you wish, I hope you don't get seasick, it is a\s+long voyage\.$/.test(text ?? "")) return;
    const destination = p.getAttribute(ATTR_VEOS_TRAVEL_DESTINATION);
    if (!Array.isArray(destination) || destination.length !== 3) return;
    event.after = () => {
      p.setAttribute(ATTR_VEOS_TRAVEL_DESTINATION, null);
      p.moveTo(new Location(destination[0], destination[1], destination[2]));
    };
  }
  function digForMorytaniaPiece(event) {
    const { player: p } = event;
    if (stage(p) < S.KEYS || stage(p) > S.FORGE || !has(p, I.LOCATOR_ORB) || !has(p, I.SPADE) || (Number(p.getAttribute(ATTR_MORYTANIA)) || 0) < 5) return false;
    event.handled = true;
    const { x, y } = p.getLocation();
    const target = p.getAttribute(ATTR_ORB_TARGET);
    if (!target || Math.max(Math.abs(x - target[0]), Math.abs(y - target[1])) > 1) {
      p.sendMessage("You dig around, but the ground here does not seem right.");
      return true;
    }
    const parts = Number(p.getAttribute(ATTR_PARTS)) || 0;
    if (has(p, KEY_PARTS[1])) return p.sendMessage("You have already recovered this dragon key piece.");
    if (!give(p, KEY_PARTS[1])) return true;
    p.setAttribute(ATTR_PARTS, parts | (1 << 1));
    p.sendMessage("You dig up a dragon key piece from the swamp.");
    if ((parts | (1 << 1)) === 15) advance(p, S.FORGE);
    return true;
  }

  defineArea();
  api.registerArea(new DragonForgeHeadArea());
  quest = registerQuest(api, {
    key: "dragon_slayer_ii", name: "Dragon Slayer II", varpId: 1685, varbitId: 6104,
    varbitValue: (value, player) => {
      const crandorProgress = Number(player?.getAttribute?.(ATTR_CRANDOR_BLOCKAGE_PROGRESS));
      if ((value === S.TUNNEL || value === S.MURAL) && [15, 16, 17, 22, 25, 30].includes(crandorProgress)) {
        return crandorProgress;
      }
      if (value === S.MAP && player?.getAttribute?.(ATTR_MAP_PUZZLE_READY)) return 45;
      if (value === S.TO_LITHKREN && player?.getAttribute?.(ATTR_LITHKREN_ARRIVED)) {
        if (player.getAttribute(ATTR_AIVAS_DIARY)) return 85;
        if (player.getAttribute(ATTR_LITHKREN_DALLAS_TALKED)) return 80;
        const location = player.getLocation?.();
        const y = location?.getY?.() ?? location?.y;
        return y >= 10000 ? 75 : 70;
      }
      if (value === S.TO_LITHKREN && player?.getAttribute?.(ATTR_ROWBOAT_BUILT)) return 65;
      if (value === S.TO_LITHKREN && player?.getAttribute?.(ATTR_JARDRIC_TALKED)) return 60;
      return nativeStage(value, player);
    },
    startedValue: S.START, completionValue: S.COMPLETE, questPoints: 5,
    xpRewards: [
      { skillId: Skill.SMITHING.getIndex(), amount: 80000, label: "Smithing" },
      { skillId: Skill.MINING.getIndex(), amount: 60000, label: "Mining" },
      { skillId: Skill.AGILITY.getIndex(), amount: 50000, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 50000, label: "Thieving" },
    ],
    rewardItemId: I.LOCATOR_ORB,
    onReward: grantDragonSlayerIIRewards,
    otherRewards: ["Claim four 25,000 XP combat rewards from Ellen at the Myths' Guild", "Access to the Myths' Guild", "Access to Lithkren", "Access to Vorkath", "Access to the Fountain of Uhld", "Access to the Wrath Altar", "Access to adamant and rune dragons", "Ability to make super antifire potions", "Ability to make a dragonfire ward", "Ability to make ferocious gloves", "Ability to upgrade Ava's device", "Ability to reforge the dragon platebody and kiteshield", "Ability to teleport to Lithkren with a Digsite pendant"],
    buildJournal,
  });
  api.persistAttribute(ATTR_LEADERS); api.persistAttribute(ATTR_PARTS);
  api.persistAttribute(ATTR_ASSAULT_INDEX); api.persistAttribute(ATTR_ASSAULT_CHECKPOINT);
  api.persistAttribute(ATTR_ASSAULT_DEFENSE_ACTIVE); api.persistAttribute(ATTR_ASSAULT_DEFENDED);
  api.persistAttribute(ATTR_MORYTANIA); api.persistAttribute(ATTR_ORB_TARGET);
  api.persistAttribute(ATTR_VEOS_TRAVEL_DESTINATION);
  api.persistAttribute(ATTR_MURAL_READ); api.persistAttribute(ATTR_NOTES_READ); api.persistAttribute(ATTR_KARAMJA_JOURNAL);
  api.persistAttribute(ATTR_CRANDOR_BLOCKAGE_PROGRESS);
  api.persistAttribute(ATTR_MURAL_GUARDIAN_DEFEATED);
  api.persistAttribute(ATTR_KARAMJA_INSTANCE_ACTIVE);
  api.persistAttribute(ATTR_FORGE_HEADS);
  api.persistAttribute(ATTR_UNGAEL_TRIP); api.persistAttribute(ATTR_VORKATH_DEFEATED);
  api.persistAttribute(ATTR_LAB_TIMER); api.persistAttribute(ATTR_UNGAEL_LAB_ACTIVE);
  api.persistAttribute(ATTR_CRYPT_ACTIVE); api.persistAttribute(ATTR_CRYPT_READY);
  api.persistAttribute(ATTR_CRYPT_ORDER); api.persistAttribute(ATTR_CRYPT_PLACED);
  api.persistAttribute(ATTR_CRYPT_INSPECTED); api.persistAttribute(ATTR_CRYPT_KEY_COLLECTED);
  api.persistAttribute(ATTR_ROWBOAT_BUILT); api.persistAttribute(ATTR_LITHKREN_ARRIVED); api.persistAttribute(ATTR_AIVAS_DIARY);
  api.persistAttribute(ATTR_LITHKREN_DALLAS_TALKED);
  api.persistAttribute(ATTR_LITHKREN_NATIVE_STAGE);
  api.persistAttribute(ATTR_VAULT_SCENE_ACTIVE); api.persistAttribute(ATTR_VAULT_SCENE_COMPLETE);
  api.persistAttribute(ATTR_AIVAS_DIARY_FOUND);
  api.persistAttribute(ATTR_DREAM_PROGRESS);
  api.persistAttribute(ATTR_MAP_FOUND); api.persistAttribute(ATTR_MAP_HANDED_IN); api.persistAttribute(ATTR_MAP_SOLVED); api.persistAttribute(ATTR_MAP_INTRODUCED);
  api.persistAttribute(ATTR_MAP_POSITIONS); api.persistAttribute(ATTR_MAP_ROTATIONS);
  api.persistAttribute(ATTR_MAP_PUZZLE_READY);
  api.persistAttribute(ATTR_ANCIENT_DIARY_READ);
  api.persistAttribute(ATTR_GALVEK_DEFEATED);
  api.persistAttribute(ATTR_TRAINING_REWARDS);
  api.persistAttribute(ATTR_JARDRIC_TALKED);
  api.onNpcInteraction("Alec Kincade", { "Talk-to": talkAlec });
  api.onNpcInteraction("Ellen", { "Talk-to": talkEllenTraining });
  api.onNpcInteraction("Dallas Jones", { "Talk-to": talkDallas });
  api.onNpcDialogueCondition(answerMapDialogueCondition);
  api.onNpcDialogueCondition(answerDreamDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", handleDreamDialogueLine);
  api.onNpcDialogueCondition(answerAlecStartRequirements);
  onNpcInteractions(["Veos"], { "Port Piscarilius": travelWithVeos, "Land's End": travelWithVeos });
  onNpcInteractions(["Jardric"], { "Talk-to": talkJardric });
  // The cache names Bob's roaming cat NPC "Bob"; the explicit alias is kept
  // for cache revisions that expose the descriptive name instead.
  onNpcInteractions(["Bob", "Bob the Cat"], { "Talk-to": talkBob });
  api.onNpcInteraction("Sphinx", { "Talk-to": talkSphinx });
  api.onNpcDialogueVariant(selectOneiromancerDialogue);
  api.onNpcInteraction("Reldo", { "Talk-to": talkReldo });
  api.onNpcInteraction("Sarah", { "Talk-to": talkSarah });
  api.onNpcInteraction("Ava", { "Talk-to": talkAva });
  api.onNpcInteraction("Torfinn", { "Talk-to": talkTorfinnForKey });
  api.onNpcInteraction("Cabin Boy Herbert", { "Talk-to": talkHerbertForKey });
  api.onNpcInteraction("Amelia", { "Talk-to": talkAmeliaForKey });
  onNpcInteractions(["Istoria", "Imerominia", "Jonathan"], { "Talk-to": talkKourendHistorian });
  onNpcInteractions(["Sir Amik Varze", "King Lathas", "Brundt the Chieftain", "King Roald"], { "Talk-to": talkLeader });
  api.onObjectInteraction(handleObject);
  api.onPlayerProcess(syncLithkrenNativeStage);
  api.onPlayerProcess(syncFleetNativeStage);
  api.onPlayerLogin(syncFleetNativeStage);
  api.onPlayerLogin(({ player }) => {
    if (Number(player.getAttribute(ATTR_DREAM_PROGRESS)) >= 2) {
      player.getPacketSender?.().sendVarbit?.(6144, 1);
      player.getPacketSender?.().sendVarbit?.(6145, 0);
    }
  });
  api.onCustomEvent("ladders:climb", climbLithkrenNorthStairs);
  api.onCustomEvent("ladders:climb", claimAssaultLadder);
  api.onObjectRoute(routeAssaultLadder);
  api.onObjectRoute(routeAssaultGap);
  api.onObjectRoute(routeAssaultWreckage);
  api.onObjectRoute(routeAssaultRuneShip);
  api.onObjectRoute(routeAssaultRuneDebris);
  api.onObjectInteraction("Ship", { Jump: jumpAssaultRuneShip });
  api.onObjectInteraction("Rope ladder", { "Climb-up": climbAssaultRuneLadder });
  api.onObjectInteraction("Debris", { Cross: crossAssaultRuneDebris });
  api.onObjectInteraction("Gap", { Jump: jumpAssaultGap });
  api.onObjectInteraction("Wreckage", { "Jump-to": jumpAssaultWreckage });
  api.onObjectRoute(routeLithkrenNorthStairs);
  api.onInterfaceActionClick(handleMapPuzzleClick);
  api.onObjectFirstClick(MAP_SOURCES.map((source) => source.id), searchFossilMapSource);
  api.onObjectFirstClick([30715, 30716], searchAncientDiary);
  api.onObjectFirstClick([...MAP_OBJECT_IDS], interactWithFossilMap);
  api.onCustomEvent("npc-dialogue:action", onLithkrenDialogueAction);
  api.onCustomEvent("npc-dialogue:action", onQuestDialogueAction);
  api.onCustomEvent("npc-dialogue:action", handleReldoBookMessage);
  api.onCustomEvent("npc-dialogue:action", handleEllenTrainingAction);
  api.onCustomEvent("npc-dialogue:choice", rememberVeosTravelDestination);
  api.onCustomEvent("npc-dialogue:line", finishVeosTravel);
  api.onObjectFirstClick(O.CAVE_63, enterKaramjaMaze);
  api.onObjectInteraction("Cave", {
    Enter(event) {
      const visibleObjectId = event.definition?.id ?? event.objectId;
      if (visibleObjectId !== O.CAVE_62) return false;
      return enterUngaelLaboratory({ ...event, objectId: visibleObjectId });
    },
  });
  api.onObjectFirstClick(O.CRYPT_ENTRANCE, enterKourendCrypt);
  api.onObjectFirstClick([
    CRYPT_TOMB.id, O.TOMB_6, O.TOMB_7,
    ...CRYPT_BUSTS.flatMap((bust) => [bust.templateObject, bust.object]),
    ...CRYPT_STAIRS.keys(),
  ], handleCryptObject);
  api.onObjectFirstClick([O.PLINTH_16, O.PLINTH_17, O.PLINTH_18], handleKaramjaPlinth);
  api.onObjectFirstClick(O.SKELETON_84, searchKaramjaSkeleton);
  api.onObjectFirstClick([O.SKELETON_82, O.SKELETON_83, 29871], searchAivasSkeleton);
  api.onObjectFirstClick([O.TRAP_9, O.TRAP_10, O.TRAP_11, O.TRAP_12], disableKaramjaTrap);
  api.onObjectRoute(routeKaramjaTrap);
  api.onObjectRoute(routeKourendEntrance);
  api.onObjectRoute(routeKourendStairs);
  api.onObjectFirstClick(O.STAIRCASE_172, exitKaramjaStaircase);
  api.onObjectInteraction("Bookcase", { Search: searchReldoBook });
  api.onItemOnObject(useItemOnObject, { noted: false });
  api.onItemOnObject(placeCryptBust, { noted: false });
  api.onNpcHitModify(protectForgeHead);
  api.onCustomEvent("magic:hit-effects", kindleDragonForge);
  api.onItemOnItem(itemOnItem);
  api.onItemOnItem(makeInertLocatorOrb);
  api.onItemAction("Locator orb", { Feel: feelLocatorOrb });
  api.onItemAction("Aivas' diary", { Read: readAivasDiary });
  api.onItemAction("Ancient diary", { Read: readAncientDiary });
  api.onItemAction("Spade", { Dig: digForMorytaniaPiece });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(onLogin);
  api.onPlayerLogout(onPlayerLogout);
  api.onPlayerDeath(onPlayerDeath);
  module.exports._test.cryptPuzzle = {
    createArea: (owner) => new KourendCryptArea(owner),
    reset: resetCryptPuzzle,
    takeObject: handleCryptObject,
    placeBust: placeCryptBust,
    source: { ...CRYPT_SOURCE },
    tomb: { ...CRYPT_TOMB, click: [1504, 9939] },
    plinths: Object.fromEntries(Object.entries(CRYPT_PLINTHS).map(([direction, loc]) => [direction, { ...loc, click: [...loc.click] }])),
    busts: CRYPT_BUSTS.map((bust) => ({ ...bust, location: [...bust.location] })),
  };
  module.exports._test.assaultDamageTiles = ASSAULT_DAMAGE_TILES.map((tile) => [tile.getX(), tile.getY(), tile.getZ()]);
  module.exports._test.assaultLadder = {
    location: [ASSAULT_LADDER.getX(), ASSAULT_LADDER.getY(), ASSAULT_LADDER.getZ()],
    createArea: () => {
      const area = new QuestArea("test", FLEET_BOUNDARIES);
      area.assaultObjects = [];
      addAssaultTraversal(area);
      return area;
    },
  };
  module.exports._test.spawnAssaultDragon = spawnAssaultDragon;
  module.exports._test.spawnGalvek = spawnGalvek;
  module.exports._test.assaultDragons = ASSAULT_DRAGONS.map((dragon) => ({ ...dragon }));
};

module.exports._test = { restoreSphinxGeneralTopic, oneiromancerDialogueVariant };
