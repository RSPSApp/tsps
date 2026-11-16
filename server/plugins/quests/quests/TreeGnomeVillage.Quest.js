/**
 * Tree Gnome Village (members).
 *
 * Words come from the "Tree Gnome Village" transcript page. The plugin supplies
 * the variant selector for King Bolren, Commander Montai, Elkoy, the trackers,
 * the Khazard warlord and the villagers, the prose-condition answers, the start
 * hook, the six-log hand-in, the ballista/chest/wall interactions and the orb
 * hand-in that completes the quest.
 *
 * Stages (varp 111): 1 started, 2 told Montai, 3 given logs, 4 finding trackers,
 * 5 ballista fired, 6 first orb retrieved, 7 returned first orb, 8 warlord
 * defeated, 9 complete.
 *
 * Varbits 598-602 share varp 279: orbs handed in, the three trackers, and the
 * random x coordinate the trackers' riddle and the ballista read.
 *
 * Elkoy's walks through the maze (and Bolren's "Elkoy guides you out") fade the
 * screen out, move the player while it is dark and fade it back in. The ballista
 * plays its launch and sends its spear at the stronghold. The warlord's orbs land
 * among his remains.
 */
module.exports = function registerTreeGnomeVillageQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, Location, Task, TaskManager, Animation, Graphic } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Tree Gnome Village";
  const VARP_TREE_GNOME_VILLAGE = 111;

  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_MONTAI = 2;
  const STAGE_GIVEN_LOGS = 3;
  const STAGE_FINDING_TRACKERS = 4;
  const STAGE_BALLISTA_FIRED = 5;
  const STAGE_RETRIEVED_ORB = 6;
  const STAGE_RETURNED_FIRST_ORB = 7;
  const STAGE_DEFEATED_WARLORD = 8;
  const STAGE_COMPLETE = 9;
  const VARBIT_BOLREN_GOT_ORBS = 598;
  const VARBIT_GNOMETRACKER_H = 599;
  const VARBIT_GNOMETRACKER_Y = 600;
  const VARBIT_GNOMETRACKER_X = 601;
  const VARBIT_BALLISTA = 602;

  const TRACKER_STATE_ATTRIBUTE = "tree-gnome-village:trackers";
  /** Bolren has taken the orbs for the ceremony (live takes them as the chant box opens); kept so a cut-off ceremony can finish. */
  const ORBS_GIVEN_ATTRIBUTE = "tree-gnome-village:orbs-given";
  const BALLISTA_COORDINATE_ATTRIBUTE = "tree-gnome-village:ballista-coordinate";

  const BALLISTA_OBJECT_ID = 2181;
  /** catabow_launch: loc 2181 (catabow, "Ballista") throwing its arm. */
  const BALLISTA_LAUNCH_SEQ = 730;
  /** ballista_travel (model 2240, seq 731 catabow_travel): the huge spear in flight. */
  const BALLISTA_SPEAR_SPOTANIM = 182;
  /** Ours: a wrong x coordinate lands this many tiles east or west of the target per step it is out (no miss is captured). */
  const BALLISTA_MISS_STEP = 3;
  /**
   * The spear's flight as the user's rsprox capture sends it (local 1001802 tick 1469, revision 242): from the tile
   * 1 east and 3 north of the ballista's corner to 2509,3254 (inside the crumbled wall), client cycles 110 to 375,
   * angle 7, progress 0, heights 95 to 0 on the wire. No graphic is played where it lands.
   */
  const BALLISTA_SPEAR_FROM = [1, 3];
  const BALLISTA_SPEAR_TARGET = new Location(2509, 3254, 0);
  const BALLISTA_SPEAR_DELAY = 110;
  const BALLISTA_SPEAR_END = 375;
  const BALLISTA_SPEAR_SLOPE = 7;
  const BALLISTA_SPEAR_PROGRESS = 0;
  /** sendProjectile multiplies heights by 4; the wire value is 95. */
  const BALLISTA_SPEAR_START_HEIGHT = 95 / 4;
  /** treevillage_catabow_launch with the launch; treevillage_catabow_hit two ticks later, as the hit box opens (t1469, t1471). */
  const BALLISTA_LAUNCH_SOUND = 3488;
  const BALLISTA_HIT_SOUND = 3487;
  const BALLISTA_RESULT_TICKS = 2;
  const STRONGHOLD_DOOR_OBJECT_ID = api.core.ObjectIdentifiers.DOOR_67;
  const STRONGHOLD_DOOR_LOCATION = new Location(2502, 3250, 0);
  const CLOSED_CHEST_OBJECT_ID = 2183;
  const OPEN_CHEST_OBJECT_ID = 2182;
  const KHAZARD_WARLORD_SPAWN_ID = 4971;
  const VARBIT_WARLORD_FIGHTING = 3460; // khazard_warlord_fighting
  /** The talking warlord stays hidden this long after his fighter dies (3460 1 -> 0 30 ticks after the orbs drop in all three captures). */
  const WARLORD_HIDDEN_AFTER_DEATH_TICKS = 30;
  /** current_hint_arrow 7 and an arrow on the fighter as he appears (captures 1001800, 1001802, 1002235); live never clears it. */
  const VARBIT_CURRENT_HINT_ARROW = 14192;
  const HINT_ARROW_NPC = 7;
  const WARLORD_COMBAT_ID = NpcIdentifiers.KHAZARD_WARLORD_3;
  /** He fights in melee: his aggression range is his follow distance plus one. */
  const WARLORD_ATTACK_DISTANCE = 1;
  /** The tiles tried for his home beside the talking warlord: west, east, south, north, then the corners. */
  const WARLORD_HOME_STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const ELKOY_OUTSIDE_MAZE_ID = 6265;
  const ELKOY_INSIDE_MAZE_ID = 6266;
  /** Map-spawn ids with no npc-dialogue-index entry, so no page of ours for the dialogue plugin to offer. */
  const UNINDEXED_TALK_IDS = new Set([ELKOY_OUTSIDE_MAZE_ID, ELKOY_INSIDE_MAZE_ID, KHAZARD_WARLORD_SPAWN_ID]);
  const VILLAGE_ENTRANCE = new Location(2504, 3191, 0);
  // QH maze path ends south of Loose railing2186; Elkoy does not bypass it.
  const INNER_MAZE_EXIT = new Location(2515, 3159, 0);

  /** Transcript action that ends the "return of the orb" branch. */
  const COMPLETE_ACTION_ID = "51Oq7J";
  const POST_QUEST_AMULET_CONDITION_IDS = new Set(["jhUV9W", "khpxfY", "a0UQ7j"]);
  const POST_QUEST_AMULET_MESSAGE_ID = "SoVY4z";
  const POST_QUEST_AMULET_RECEIVE_IDS = new Set(["LUAm8Y", "wWnJYI"]);
  const TRACKER_H_MESSAGE_ID = "eBZQ_A";
  const TRACKER_Y_MESSAGE_ID = "8H1UCb";
  const CHEST_ORB_MESSAGE_ID = "JOh59P";
  /** "The orbs of protection come to rest gently in the branches..." in the hand-in ceremony. */
  const ORBS_RESTED_MESSAGE_ID = "C0ryYx";
  /** Varbit 598 value that swaps the village's spirit tree multiloc 1293 to loc 26261 (seq 333, the glowing tree). */
  const BOLREN_GOT_ORBS_PLACED = 2;
  /** Bolren's "Elkoy guides you out of the maze." after the start and after the first orb. */
  const BOLREN_GUIDE_OUT_MESSAGE_IDS = new Set(["GnZ1Sn", "dJzhSl"]);
  const ELKOY_GUIDE_OPTIONS = new Set(["Yes please.", "Can you show me out of the village?"]);
  /**
   * The screen is dark when the player is moved; the box carries on by itself once it is light again: the move
   * 3 ticks after the box, the fade-in and Elkoy's line at 4 (local 1001802 ticks 938-942, 1639-1644, 1755-1759, 2168-2173).
   */
  const GUIDE_MOVE_TICKS = 3;
  const GUIDE_HOLD_TICKS = 4;
  /** Follow on Elkoy plays this box, then his line from the Talk-to's guide answer (ticks 1639, 2168). */
  const ELKOY_FOLLOW_GUIDE_STEP = Object.freeze({ type: "message", text: "Elkoy guides you through the maze.", id: "ciSH8i" });
  const ELKOY_GUIDE_TEXT = /^Elkoy guides you /;
  /** The start: the quest starts as the player continues past this line of theirs (local 1001802 tick 920). */
  const START_LINE = "I would be glad to help.";
  /** Montai's stages, each as the player continues past the line (ticks 1062, 1186); the logs go as "I have some here." shows (1081). */
  const MONTAI_WOOD_LINE = "Ok, I'll gather some wood.";
  const MONTAI_TRACKERS_LINE = "Thank you, you're braver than most.";
  const LOGS_HAND_IN_LINE = "I have some here.";
  /** Bolren takes the orb, and the quest moves on, as the player continues past this line (tick 1750). */
  const BOLREN_FIRST_ORB_LINE = "You are brave, but this task will be tough even for you.";
  /** Tracker gnome 3's coordinate flag is set as his talk opens (tick 1364), the others' at their boxes. */
  const TRACKER_3_FIRST_LINE = "Are you OK?";
  /** "You enter the height and y coordinates..." : the ballista fires as it is continued (tick 1469). */
  const BALLISTA_ENTER_MESSAGE_ID = "f-0NYt";
  /** The Khazard commander's shout as the player climbs into the stronghold (tick 1526) and his "Oi!" at the chest. */
  const COMMANDER_WALL_SHOUT = "Don't even think of taking the orb!";
  const COMMANDER_CHEST_SHOUT = "Oi! You! Get out of there.";
  const CRUMBLED_WALL_OBJECT_ID = 2185;
  /**
   * Live: the commander's attack the tick after the climb, his shout the tick after that (ticks 1524-1526). Ours: the
   * attack starts the tick after the player lands (3 ticks): the crossing's start and landing each place the player
   * again, and combat drops a target that is being placed.
   */
  const COMMANDER_SHOUT_TICKS = 2;
  const COMMANDER_REACH = 10;
  /** The warlord's death box shows the orbs (objectbox 193, item 588, tick 2068). */
  const WARLORD_DEFEATED_MESSAGE_ID = "y9C1Ip";
  /** "The gnomes begin to chant...": Bolren takes the orbs and varbit 598 goes to 1 as it opens (tick 2258). */
  const CEREMONY_CHANT_MESSAGE_ID = "5zRGYZ";
  /** gnome_chanting, with every "Su tana."/"En tania." (ticks 2263-2269). */
  const CHANT_SEQ = 12049;
  /** Bolren casts the orbs 2 ticks after the last chant: gnome_globes (79) and gnome_cast_globes (199), both delay 20 (t2271). */
  const ORBS_CAST_SPOTANIM = 79;
  const ORBS_CAST_SEQ = 199;
  const ORBS_CAST_DELAY = 20;
  const ORBS_CAST_HEIGHT = 124;
  /** 3 ticks later 598 goes to 2 and the tree (2543,3168, shape 10, rotation 1) plays entendseq (333); the box 4 ticks after that (t2274, t2278). */
  const TREE_GLOW_TICKS = 3;
  const ORBS_RESTED_BOX_TICKS = 7;
  const SPIRIT_TREE_LOC_ID = 1293;
  const SPIRIT_TREE_LOCATION = new Location(2543, 3168, 0);
  const SPIRIT_TREE_GLOW_SEQ = 333;
  const BALLISTA_SUCCESS_CONDITION_ID = "1G3SE7";
  const BALLISTA_MISS_CONDITION_ID = "wwt4fB";
  const BALLISTA_HIT_MESSAGE_ID = "8Wc7CR";
  const BALLISTA_MISS_MESSAGE_ID = "B_5n9I";
  const WARLORD_DEFEATED_VARIANT = "the-khazard-warlord-when-defeated";
  const TRACKER_X_CONDITION_IDS = new Set(["FBaYjB", "cLo8NW", "RDXbKP", "TPAWlA"]);

  const KING_BOLREN_NPC_ID = NpcIdentifiers.KING_BOLREN;
  const COMMANDER_MONTAI_NPC_ID = NpcIdentifiers.COMMANDER_MONTAI;
  const KHAZARD_WARLORD_NPC_IDS = new Set([
    KHAZARD_WARLORD_SPAWN_ID,
    NpcIdentifiers.KHAZARD_WARLORD_2,
    NpcIdentifiers.KHAZARD_WARLORD_3,
  ]);
  const ELKOY_NPC_IDS = new Set([
    NpcIdentifiers.ELKOY, NpcIdentifiers.ELKOY_2, ELKOY_OUTSIDE_MAZE_ID, ELKOY_INSIDE_MAZE_ID,
  ]);

  const TRACKER_VARIANTS = new Map([
    [
      NpcIdentifiers.TRACKER_GNOME_1,
      {
        postQuestPage: "Tracker gnome 1",
        battlefield: "battlefield-talking-to-tracker-gnome-1",
        coords: "battlefield-tracker-gnomes-tracker-gnome-1",
        fired: "using-the-ballista-talking-to-tracker-gnome-1-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-1-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-1",
      },
    ],
    [
      NpcIdentifiers.TRACKER_GNOME_2,
      {
        postQuestPage: "Tracker gnome 2",
        battlefield: "battlefield-talking-to-tracker-gnome-2",
        coords: "battlefield-tracker-gnomes-tracker-gnome-2",
        fired: "using-the-ballista-talking-to-tracker-gnome-2-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-2-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-2",
      },
    ],
    [
      NpcIdentifiers.TRACKER_GNOME_3,
      {
        postQuestPage: "Tracker gnome 3",
        battlefield: "battlefield-talking-to-tracker-gnome-3",
        coords: "battlefield-tracker-gnomes-tracker-gnome-3",
        fired: "using-the-ballista-talking-to-tracker-gnome-3-after-successfully-firing-the-ballista",
        orb: "into-the-stronghold-tracker-gnome-3-after-getting-the-orb",
        returned: "bringing-bolren-the-orb-tracker-gnome-3",
      },
    ],
  ]);

  const LOGS_ITEM_ID = ItemIdentifiers.LOGS;
  const ORB_OF_PROTECTION_ITEM_ID = ItemIdentifiers.ORB_OF_PROTECTION;
  const ORBS_OF_PROTECTION_ITEM_ID = ItemIdentifiers.ORBS_OF_PROTECTION;
  const GNOME_AMULET_ITEM_ID = ItemIdentifiers.GNOME_AMULET;
  const LOGS_REQUIRED = 6;

  const page = (variant) => ({ page: PAGE, variant });

  let quest;

  function logCount(player) {
    return player.getInventory().getAmount(LOGS_ITEM_ID);
  }

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I restored all three orbs of protection.</str>",
        "<str>The Spirit Tree keeps the gnomes safe once more.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return ["I should return the <col=800000>orbs of protection</col> to King Bolren."];
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return ["I must defeat the <col=800000>Khazard warlord</col> and take back the remaining orbs."];
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return ["I should return the first orb to <col=800000>King Bolren</col>."];
    }
    if (stage >= STAGE_BALLISTA_FIRED) {
      return ["The stronghold is breached. I need the orb from its chest."];
    }
    if (stage >= STAGE_FINDING_TRACKERS) {
      return ["I should find the three trackers, then fire the <col=800000>ballista</col>."];
    }
    if (stage >= STAGE_GIVEN_LOGS) {
      return ["I should speak to <col=800000>Commander Montai</col> about the attack."];
    }
    if (stage >= STAGE_SPOKEN_MONTAI) {
      return ["Montai needs <col=800000>six normal logs</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["I should report to <col=800000>Commander Montai</col> on the battlefield."];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Bolren</col>",
      "in the Tree Gnome Village maze.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 11450);
  }

  const ballistaChoices = new WeakMap();
  /** The ballista loc the player last fired, for the launch and the spear's start. */
  const ballistaLocs = new WeakMap();
  const warlordsByPlayer = new Map();
  /** Where Elkoy is taking the player once they have said yes, until the walk plays. */
  const pendingGuides = new WeakMap();
  const guiding = new WeakSet();
  const Scenes = createQuestScenes(api);

  function trackerMask(player) {
    return Number(player.getAttribute(TRACKER_STATE_ATTRIBUTE)) || 0;
  }

  function allTrackersFound(player) {
    return (trackerMask(player) & 0b111) === 0b111;
  }

  function ballistaCoordinate(player) {
    const value = Number(player.getAttribute(BALLISTA_COORDINATE_ATTRIBUTE));
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
  }

  function isInsideVillage(player) {
    const location = player.getLocation?.();
    return !!location && location.z === 0
      && location.x >= 2514 && location.x <= 2542
      && location.y >= 3158 && location.y <= 3175;
  }

  function guideDestination(player) {
    return isInsideVillage(player) ? VILLAGE_ENTRANCE : INNER_MAZE_EXIT;
  }

  /** Elkoy's walk through the maze: fade out, move the player while it is dark, fade back in. */
  function guideThroughMaze(player, destination) {
    pendingGuides.delete(player);
    if (guiding.has(player)) return;
    guiding.add(player);
    Scenes.controls(player, true);
    Scenes.fade(player, true);
    Scenes.later(player, GUIDE_MOVE_TICKS, () => {
      guiding.delete(player);
      Scenes.controls(player, false);
      if (player.isRegistered?.() === false) return;
      player.moveTo(destination.clone());
      Scenes.fade(player, false);
    });
  }

  /** A guide message shows over the fade without a continue, then carries on once the player is there. */
  function guideWithMessage(message, player, destination) {
    message.box = { statement: true, holdTicks: GUIDE_HOLD_TICKS, advance: true };
    guideThroughMaze(player, destination);
  }

  /** Elkoy's next line, when no message of his comes first: the walk plays as it shows. */
  function guideOnElkoyLine(request) {
    const { player, step } = request;
    if (!pendingGuides.has(player) || step?.speaker !== "Elkoy") return;
    const destination = pendingGuides.get(player);
    pendingGuides.delete(player);
    request.holdTicks = GUIDE_HOLD_TICKS;
    const previous = request.before;
    request.before = () => {
      previous?.();
      guideThroughMaze(player, destination);
    };
  }

  /** Whether the coordinate the player entered at the ballista is the right one. */
  function ballistaHits(player) {
    const chosen = ballistaChoices.get(player);
    return chosen !== undefined && chosen === ballistaCoordinate(player) + 1;
  }

  /**
   * The launch on the ballista, its sound, and the spear onto the stronghold, or wide of it by the coordinate's
   * error; the hit sound follows as the hit box opens (local 1001802 ticks 1469-1471).
   */
  function launchBallistaSpear(player) {
    const ballista = ballistaLocs.get(player);
    if (!ballista?.getLocation) return;
    const hit = ballistaHits(player);
    const sender = player.getPacketSender();
    sender.sendObjectAnimation(ballista, new Animation(BALLISTA_LAUNCH_SEQ));
    sender.sendSound(BALLISTA_LAUNCH_SOUND, 0, 0);
    const corner = ballista.getLocation();
    const from = new Location(corner.getX() + BALLISTA_SPEAR_FROM[0], corner.getY() + BALLISTA_SPEAR_FROM[1], corner.getZ());
    const error = hit ? 0 : (ballistaChoices.get(player) ?? 0) - (ballistaCoordinate(player) + 1);
    const to = BALLISTA_SPEAR_TARGET.transform(error * BALLISTA_MISS_STEP, 0);
    sender.sendProjectile(from, to, 0, BALLISTA_SPEAR_END, BALLISTA_SPEAR_SPOTANIM, BALLISTA_SPEAR_START_HEIGHT, 0, null,
      BALLISTA_SPEAR_DELAY, BALLISTA_SPEAR_SLOPE, BALLISTA_SPEAR_PROGRESS);
    if (hit) Scenes.later(player, BALLISTA_RESULT_TICKS, () => player.getPacketSender().sendSound(BALLISTA_HIT_SOUND, 0, 0));
  }

  function giveItem(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getAmount(itemId) > 0) return;
    if (inventory.isFull()) {
      const groundItems = api.getItemOnGroundManager();
      const location = player.getLocation();
      if (!groundItems.getGroundItem(player.getUsername(), itemId, location, player.getPrivateArea())) {
        groundItems.registerLocation(player, new api.core.Item(itemId, 1), location.clone());
      }
      return;
    }
    inventory.adds(itemId, 1);
  }

  function beginTrackerSearch(player) {
    player.setAttribute(TRACKER_STATE_ATTRIBUTE, 0);
    player.setAttribute(BALLISTA_COORDINATE_ATTRIBUTE, Math.floor(Math.random() * 4));
    quest.setStage(player, STAGE_FINDING_TRACKERS);
  }

  function bolrenVariant(player, stage) {
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return orbsHandedOver(player)
        ? "return-of-the-orb"
        : "the-khazard-warlord-talking-to-king-bolren-without-the-orbs-after-getting-them";
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return "into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it";
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return has(player, ORB_OF_PROTECTION_ITEM_ID)
        ? "bringing-bolren-the-orb"
        : "into-the-stronghold-talking-to-bolren-without-the-orb-after-finding-it";
    }
    if (stage >= STAGE_SPOKEN_MONTAI) {
      return "tree-gnome-king-talking-to-king-bolren-again-after-agreeing-to-bring-logs-to-montai";
    }
    if (stage >= STAGE_STARTED) {
      return "tree-gnome-king-talking-to-king-bolren-again-before-agreeing-to-bring-logs-to-montai";
    }
    return "tree-gnome-king";
  }

  function montaiVariant(stage) {
    if (stage >= STAGE_RETRIEVED_ORB) return "into-the-stronghold-commander-montai-after-getting-the-orb";
    if (stage >= STAGE_BALLISTA_FIRED) return "using-the-ballista-commander-montai-after-shooting-the-ballista";
    if (stage >= STAGE_FINDING_TRACKERS) return "battlefield-commander-montai-while-getting-the-coordinates";
    if (stage >= STAGE_GIVEN_LOGS) return "battlefield-talking-to-commander-montai-afterwards";
    if (stage >= STAGE_SPOKEN_MONTAI) return "battlefield-commander-montai-again";
    if (stage >= STAGE_STARTED) return "battlefield-commander-montai";
    return null;
  }

  function trackerVariant(variants, stage) {
    if (stage >= STAGE_RETURNED_FIRST_ORB) return variants.returned;
    if (stage >= STAGE_RETRIEVED_ORB) return variants.orb;
    if (stage >= STAGE_BALLISTA_FIRED) return variants.fired;
    if (stage >= STAGE_FINDING_TRACKERS) return variants.coords;
    return variants.battlefield;
  }

  function elkoyVariant(stage, inside) {
    if (stage >= STAGE_DEFEATED_WARLORD) {
      return inside
        ? "the-khazard-warlord-elkoy-after-defeating-the-warlord-inside-the-maze"
        : "the-khazard-warlord-elkoy-after-defeating-the-warlord";
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB) {
      return inside
        ? "bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-inside-the-maze"
        : "bringing-bolren-the-orb-talking-to-elkoy-after-giving-bolren-the-orb-of-protection-outside-the-maze";
    }
    if (stage >= STAGE_RETRIEVED_ORB) {
      return inside
        ? "into-the-stronghold-elkoy-after-getting-the-orb-inside-the-maze"
        : "into-the-stronghold-elkoy-after-getting-the-orb";
    }
    if (stage >= STAGE_FINDING_TRACKERS) return "battlefield-talking-to-elkoy-after-agreeing-to-help-montai";
    if (stage >= STAGE_STARTED) {
      return inside
        ? "tree-gnome-king-talking-to-elkoy-after-starting-the-quest-inside-the-maze"
        : "tree-gnome-king-talking-to-elkoy-after-starting-the-quest-outside-the-maze";
    }
    return null;
  }

  /**
   * Which transcript variant the clicked NPC plays. Indexed NPCs fall through to
   * their own page once this quest is done; Elkoy and the warlord's map-spawn ids
   * are not in npc-dialogue-index, so their canonical page is selected here.
   */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    const inside = isInsideVillage(player);
    if (ELKOY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return {
          page: "Elkoy",
          variant: inside
            ? "after-the-completion-of-tree-gnome-village-while-inside-the-village"
            : "after-the-completion-of-tree-gnome-village-while-at-the-maze-entrance",
        };
      }
      if (stage < STAGE_STARTED) {
        return {
          page: "Elkoy",
          variant: inside
            ? "before-starting-tree-gnome-village-while-at-the-village"
            : "before-starting-tree-gnome-village-while-outside-the-maze",
        };
      }
      const variant = elkoyVariant(stage, inside);
      return variant ? page(variant) : null;
    }
    if (stage >= STAGE_COMPLETE) {
      if (npcId === COMMANDER_MONTAI_NPC_ID) {
        return { page: "Commander Montai", variant: "after-returning-the-orb-of-protection-to-king-bolren" };
      }
      const trackers = TRACKER_VARIANTS.get(npcId);
      if (trackers) {
        return { page: trackers.postQuestPage, variant: "after-returning-the-orb-of-protection-to-king-bolren" };
      }
      if (KHAZARD_WARLORD_NPC_IDS.has(npcId)) {
        return { page: "Khazard warlord", variant: "after-killing-him-in-tree-gnome-village" };
      }
      return null;
    }
    if (npcId === KING_BOLREN_NPC_ID) return page(bolrenVariant(player, stage));
    if (npcId === COMMANDER_MONTAI_NPC_ID) {
      const variant = montaiVariant(stage);
      return variant ? page(variant) : null;
    }
    if (KHAZARD_WARLORD_NPC_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) {
        return npcId === KHAZARD_WARLORD_SPAWN_ID
          ? { page: "Khazard warlord", variant: "dialogue-before-taking-the-orb-of-protection" }
          : null;
      }
      if (stage >= STAGE_DEFEATED_WARLORD) {
        return page("the-khazard-warlord-talking-to-the-khazard-warlord-again-after-defeating-him");
      }
      if (stage >= STAGE_RETURNED_FIRST_ORB) return page("the-khazard-warlord");
      return page("battlefield-talking-to-the-khazard-warlord");
    }
    const trackers = TRACKER_VARIANTS.get(npcId);
    if (trackers) return stage >= STAGE_STARTED ? page(trackerVariant(trackers, stage)) : null;
    if (stage < STAGE_STARTED) return null;
    if (npcId === NpcIdentifiers.KHAZARD_COMMANDER
      && stage >= STAGE_BALLISTA_FIRED && stage <= STAGE_RETRIEVED_ORB) return page("into-the-stronghold");
    if (npcId === NpcIdentifiers.BOLKOY) return page("into-the-stronghold-bolkoy-after-getting-the-orb");
    if (npcId === NpcIdentifiers.REMSAI) return page("tree-gnome-king-talking-to-remsai");
    if (npcId === NpcIdentifiers.KALRON) return page("tree-gnome-king-talking-to-kalron");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text, stepId }) {
    if (npcId === KING_BOLREN_NPC_ID && quest.getStage(player) >= STAGE_COMPLETE &&
      POST_QUEST_AMULET_CONDITION_IDS.has(stepId)) {
      return !has(player, GNOME_AMULET_ITEM_ID);
    }
    if (npcId === COMMANDER_MONTAI_NPC_ID) {
      const value = String(text).toLowerCase();
      if (value.includes("doesn't have 6 logs") || value.includes("does not have 6 logs")) {
        return logCount(player) < LOGS_REQUIRED;
      }
      if (value.includes("has 6 logs")) return logCount(player) >= LOGS_REQUIRED;
    }
    if (TRACKER_X_CONDITION_IDS.has(stepId)) {
      const match = /coordinate is (one|two|three|four)/i.exec(String(text));
      if (!match) return null;
      const coordinate = { one: 0, two: 1, three: 2, four: 3 }[match[1].toLowerCase()];
      return ballistaCoordinate(player) === coordinate;
    }
    if (stepId === BALLISTA_SUCCESS_CONDITION_ID || stepId === BALLISTA_MISS_CONDITION_ID) {
      const chosen = ballistaChoices.get(player);
      if (chosen === undefined) return null;
      const correct = chosen === ballistaCoordinate(player) + 1;
      return stepId === BALLISTA_SUCCESS_CONDITION_ID ? correct : !correct;
    }
    return null;
  }

  function markTracker(player, bit) {
    const mask = trackerMask(player);
    if (mask & (1 << bit)) return;
    player.setAttribute(TRACKER_STATE_ATTRIBUTE, mask | (1 << bit));
    sendProgressVarbits(player);
  }

  /** The page's start hook fires as "Yes." is picked; live starts the quest a line later (START_LINE). */
  function startQuest(player) {
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, quest.name));
  }

  function handLogsToMontai(player) {
    if (quest.getStage(player) !== STAGE_SPOKEN_MONTAI || logCount(player) < LOGS_REQUIRED) return;
    player.getInventory().deleteNumber(LOGS_ITEM_ID, LOGS_REQUIRED);
    quest.setStage(player, STAGE_GIVEN_LOGS);
  }

  function giveBolrenFirstOrb(player) {
    if (quest.getStage(player) !== STAGE_RETRIEVED_ORB || !has(player, ORB_OF_PROTECTION_ITEM_ID)) return;
    player.getInventory().deleteNumber(ORB_OF_PROTECTION_ITEM_ID, 1);
    quest.setStage(player, STAGE_RETURNED_FIRST_ORB);
  }

  /**
   * Quest state that live changes as a line shows or is continued (local 1001802): the start, Montai's two stages
   * and the logs, Bolren taking the first orb, and tracker gnome 3's flag as his talk opens.
   */
  function handleStageLines(request) {
    const { player, npcId } = request;
    const text = String(request.text ?? "");
    const stage = quest.getStage(player);
    let effect = null;
    let when = "after";
    if (npcId === KING_BOLREN_NPC_ID && stage < STAGE_STARTED && text === START_LINE) effect = () => startQuest(player);
    else if (npcId === KING_BOLREN_NPC_ID && stage === STAGE_RETRIEVED_ORB && text.startsWith(BOLREN_FIRST_ORB_LINE)) {
      effect = () => giveBolrenFirstOrb(player);
    } else if (npcId === COMMANDER_MONTAI_NPC_ID && stage === STAGE_STARTED && text === MONTAI_WOOD_LINE) {
      effect = () => { if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_MONTAI); };
    } else if (npcId === COMMANDER_MONTAI_NPC_ID && stage === STAGE_GIVEN_LOGS && text === MONTAI_TRACKERS_LINE) {
      effect = () => { if (quest.getStage(player) === STAGE_GIVEN_LOGS) beginTrackerSearch(player); };
    } else if (npcId === COMMANDER_MONTAI_NPC_ID && stage === STAGE_SPOKEN_MONTAI && text.startsWith(LOGS_HAND_IN_LINE)) {
      effect = () => handLogsToMontai(player);
      when = "before";
    } else if (npcId === NpcIdentifiers.TRACKER_GNOME_3 && stage === STAGE_FINDING_TRACKERS && text === TRACKER_3_FIRST_LINE) {
      effect = () => markTracker(player, 2);
      when = "before";
    }
    if (!effect) return;
    const previous = request[when];
    request[when] = () => {
      previous?.();
      effect();
    };
  }

  /**
   * Elkoy's map spawns (6265, 6266) and the warlord's (4971) are not in npc-dialogue-index, so the dialogue plugin never
   * offers them this page and onNpcDialogueVariant never ran for them: Talk-to played their generic page at every stage.
   * Where selectVariant names this page, the quest starts it itself; anything else keeps the generic Talk-to.
   */
  function talkToUnindexed({ player, npc, npcId }) {
    const spawnId = npc?.getId?.() ?? npcId;
    if (!UNINDEXED_TALK_IDS.has(spawnId) && !UNINDEXED_TALK_IDS.has(npcId)) return false;
    const choice = selectVariant({ npcId, player });
    if (choice?.page !== PAGE) return false;
    return startTranscript(api, player, npcId, PAGE, choice.variant, undefined, npc);
  }

  /** The steps of a Talk-to's guide answer with the player's lines left out, led by the guide box when it has none. */
  function followSteps(raw) {
    for (const step of raw) {
      if (step?.type !== "choice") continue;
      for (const option of step.options ?? []) {
        const steps = (option.steps ?? []).filter((entry) => typeof entry.player !== "string");
        const guides = steps.some((entry) => ELKOY_GUIDE_TEXT.test(String(entry.text ?? "")));
        const arrives = steps.some((entry) => /^Here we are\./.test(String(entry.text ?? entry.npc ?? "")));
        if (guides) return steps;
        if (arrives) return [ELKOY_FOLLOW_GUIDE_STEP, ...steps];
      }
    }
    return [ELKOY_FOLLOW_GUIDE_STEP];
  }

  /**
   * Follow: the guide box over the fade, the walk, then Elkoy's line from his Talk-to's guide answer at this stage
   * and side of the maze (local 1001802 ticks 1639-1644 and 2168-2173: "Here we are. ...").
   */
  function followElkoy({ player, npc, npcId }) {
    if (!ELKOY_NPC_IDS.has(npcId) || quest.getStage(player) < STAGE_STARTED) return;
    const destination = guideDestination(player);
    pendingGuides.set(player, destination);
    const choice = selectVariant({ npcId, player });
    if (choice && startTranscript(api, player, npcId, choice.page, choice.variant, followSteps, npc)) return;
    guideThroughMaze(player, destination);
  }

  /** Where Elkoy is to take the player, and the coordinate entered at the ballista. */
  function handleChoice({ player, npcId, option }) {
    const stage = quest.getStage(player);
    // The walk itself plays at the guide message, or with Elkoy's next line where there is none.
    if (ELKOY_NPC_IDS.has(npcId)) {
      if (ELKOY_GUIDE_OPTIONS.has(option) && stage >= STAGE_STARTED) {
        pendingGuides.set(player, option === "Can you show me out of the village?" ? VILLAGE_ENTRANCE : guideDestination(player));
      } else {
        pendingGuides.delete(player);
      }
      return;
    }
    if (/^000[1-4]$/.test(String(option ?? "")) && stage === STAGE_FINDING_TRACKERS) {
      ballistaChoices.set(player, Number(option));
    }
  }

  /** Tracker gnome 3's riddle branch: his flag, if his talk did not open at stage 4 (it is set as it opens). */
  function handleConditionStep({ player, stepId }) {
    if (TRACKER_X_CONDITION_IDS.has(stepId) && quest.getStage(player) === STAGE_FINDING_TRACKERS) markTracker(player, 2);
  }

  /** Transcript message actions that carry item/state changes. */
  function handleAction(event) {
    applyAction(event);
    // Every message of this page shows in a message box with its continue, as all three captures send them
    // (messagebox 229), unless the step chose its own box above (the guide's held box, the warlord's orbs).
    if (event.kind === "message" && !event.box && !event.handled && event.pages?.some?.((entry) => entry?.page === PAGE)) {
      event.box = { statement: true };
    }
  }

  function applyAction(event) {
    const { player, npcId, stepId } = event;
    const text = String(event.text ?? "");
    // Bolren's line plays where he stands; the start and the first orb are the only times it is said.
    if (npcId === KING_BOLREN_NPC_ID && BOLREN_GUIDE_OUT_MESSAGE_IDS.has(stepId)) {
      const stage = quest.getStage(player);
      if (event.kind === "message" && (stage === STAGE_STARTED || stage === STAGE_RETURNED_FIRST_ORB)) {
        guideWithMessage(event, player, VILLAGE_ENTRANCE);
      }
      return;
    }
    if (ELKOY_NPC_IDS.has(npcId) && ELKOY_GUIDE_TEXT.test(text)) {
      if (event.kind !== "message") {
        // A message step has its own event after this one on older runners; only an action-type step is turned into one.
        if (event.step?.type === "action") {
          event.handled = true;
          event.steps = [{ type: "message", text: event.text, id: stepId }];
        }
        return;
      }
      if (quest.getStage(player) >= STAGE_STARTED) {
        guideWithMessage(event, player, pendingGuides.get(player) ?? guideDestination(player));
      }
      return;
    }
    if (stepId === BALLISTA_ENTER_MESSAGE_ID && event.kind === "message") {
      event.box = { statement: true };
      event.after = () => launchBallistaSpear(player);
      return;
    }
    if (stepId === BALLISTA_HIT_MESSAGE_ID || stepId === BALLISTA_MISS_MESSAGE_ID) {
      if (event.kind !== "message") return;
      event.box = { statement: true, delayTicks: BALLISTA_RESULT_TICKS };
      if (stepId === BALLISTA_HIT_MESSAGE_ID) {
        event.after = () => {
          if (quest.getStage(player) === STAGE_FINDING_TRACKERS && ballistaHits(player)) quest.setStage(player, STAGE_BALLISTA_FIRED);
        };
      }
      return;
    }
    if (npcId === KING_BOLREN_NPC_ID && quest.getStage(player) >= STAGE_COMPLETE &&
      (stepId === POST_QUEST_AMULET_MESSAGE_ID || POST_QUEST_AMULET_RECEIVE_IDS.has(stepId))) {
      giveItem(player, GNOME_AMULET_ITEM_ID);
      return;
    }
    if (stepId === TRACKER_H_MESSAGE_ID) {
      if (quest.getStage(player) === STAGE_FINDING_TRACKERS) markTracker(player, 0);
      return;
    }
    if (stepId === TRACKER_Y_MESSAGE_ID) {
      if (quest.getStage(player) === STAGE_FINDING_TRACKERS) markTracker(player, 1);
      return;
    }
    if (stepId === WARLORD_DEFEATED_MESSAGE_ID && event.kind === "message") {
      event.box = { items: [ORBS_OF_PROTECTION_ITEM_ID] };
      return;
    }
    if (npcId === KING_BOLREN_NPC_ID && stepId === CEREMONY_CHANT_MESSAGE_ID && event.kind === "message") {
      takeCeremonyOrbs(player);
      return;
    }
    if (npcId === KING_BOLREN_NPC_ID && stepId === ORBS_RESTED_MESSAGE_ID && event.kind === "message") {
      castOrbsIntoTree(player);
      event.box = { statement: true, delayTicks: ORBS_RESTED_BOX_TICKS };
      return;
    }
    if (stepId === CHEST_ORB_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_BALLISTA_FIRED || stage >= STAGE_RETURNED_FIRST_ORB) return;
      giveItem(player, ORB_OF_PROTECTION_ITEM_ID);
      if (stage === STAGE_BALLISTA_FIRED) quest.setStage(player, STAGE_RETRIEVED_ORB);
      return;
    }
    if (npcId !== KING_BOLREN_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_DEFEATED_WARLORD) return;
    if (!orbsHandedOver(player)) return;
    player.getInventory().deleteNumber(ORBS_OF_PROTECTION_ITEM_ID, player.getInventory().getAmount(ORBS_OF_PROTECTION_ITEM_ID));
    player.setAttribute(ORBS_GIVEN_ATTRIBUTE, false);
    quest.complete(player);
  }

  /** The player carries the orbs, or Bolren already took them for a ceremony that was cut off. */
  function orbsHandedOver(player) {
    return has(player, ORBS_OF_PROTECTION_ITEM_ID) || player.getAttribute(ORBS_GIVEN_ATTRIBUTE) === true;
  }

  /** "The gnomes begin to chant...": Bolren takes the orbs, and 598 goes to 1 (local 1001802 tick 2258). */
  function takeCeremonyOrbs(player) {
    if (quest.getStage(player) !== STAGE_DEFEATED_WARLORD || !orbsHandedOver(player)) return;
    const inventory = player.getInventory();
    if (has(player, ORBS_OF_PROTECTION_ITEM_ID)) inventory.deleteNumber(ORBS_OF_PROTECTION_ITEM_ID, inventory.getAmount(ORBS_OF_PROTECTION_ITEM_ID));
    player.setAttribute(ORBS_GIVEN_ATTRIBUTE, true);
    sendProgressVarbits(player);
  }

  /** Bolren casts the orbs, then the spirit tree takes them and glows (ticks 2271, 2274). */
  function castOrbsIntoTree(player) {
    const bolren = [...(player.getLocalNpcs?.() ?? [])].find((npc) => npc.getContentId?.(player) === KING_BOLREN_NPC_ID);
    bolren?.performGraphic?.(Graphic.delayed(ORBS_CAST_SPOTANIM, ORBS_CAST_DELAY, ORBS_CAST_HEIGHT));
    bolren?.performAnimation?.(new Animation(ORBS_CAST_SEQ, ORBS_CAST_DELAY));
    Scenes.later(player, TREE_GLOW_TICKS, () => {
      if (player.isRegistered?.() === false) return;
      const sender = player.getPacketSender();
      sender.sendVarbit(VARBIT_BOLREN_GOT_ORBS, BOLREN_GOT_ORBS_PLACED);
      const tree = api.core.MapObjects?.getType?.(SPIRIT_TREE_LOCATION, 10, null)
        ?? { getId: () => SPIRIT_TREE_LOC_ID, getLocation: () => SPIRIT_TREE_LOCATION, getType: () => 10, getFace: () => 1 };
      sender.sendObjectAnimation(tree, new Animation(SPIRIT_TREE_GLOW_SEQ));
    });
  }

  function fireBallista(player) {
    const stage = quest.getStage(player);
    ballistaChoices.delete(player);
    if (stage < STAGE_FINDING_TRACKERS) {
      startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "battlefield-attempting-to-fire-the-ballista-before-the-repairs");
      return;
    }
    if (stage >= STAGE_BALLISTA_FIRED) {
      startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "using-the-ballista-using-the-ballista-again");
      return;
    }
    if (!allTrackersFound(player)) {
      player.sendMessage("You need the coordinates from all three tracker gnomes first.");
      return;
    }
    startTranscript(api, player, COMMANDER_MONTAI_NPC_ID, PAGE, "using-the-ballista");
  }

  function openChest(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BALLISTA_FIRED) {
      player.sendMessage("The door is locked from the inside.");
      return;
    }
    if (stage >= STAGE_RETURNED_FIRST_ORB || has(player, ORB_OF_PROTECTION_ITEM_ID)) {
      player.sendMessage("The chest is empty.");
      return;
    }
    startTranscript(api, player, NpcIdentifiers.KHAZARD_COMMANDER, PAGE, "into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection");
  }

  function guardStrongholdDoor(event) {
    if (event.objectId !== STRONGHOLD_DOOR_OBJECT_ID || event.object?.getFace?.() !== 1) return;
    const location = event.object.getLocation();
    if (!Location.isSameTile(location, STRONGHOLD_DOOR_LOCATION)
      || event.player.getLocation().getY() > location.getY()) return;
    startTranscript(api, event.player, NpcIdentifiers.KHAZARD_COMMANDER, PAGE,
      "into-the-stronghold-opening-the-stronghold-door-from-the-outside");
    event.handled = true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    // Some runners send only the click's index: its option is the cache's name for that slot.
    const option = String(event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (objectId === BALLISTA_OBJECT_ID && option === "fire") {
      if (event.object) ballistaLocs.set(player, event.object);
      fireBallista(player);
      event.handled = true;
      return;
    }
    // The shared Chests plugin opens the loc first; only Search awards the orb.
    if (objectId === CLOSED_CHEST_OBJECT_ID && option === "open"
      && quest.getStage(player) >= STAGE_BALLISTA_FIRED) return;
    if ((objectId === CLOSED_CHEST_OBJECT_ID && option === "open")
      || (objectId === OPEN_CHEST_OBJECT_ID && option === "search")) {
      openChest(player);
      event.handled = true;
      return;
    }
  }

  /** Players whose warlord fell within the last 30 ticks: the talking warlord stays hidden until then. */
  const warlordFallen = new WeakSet();
  /** Each fall's own token, so only the latest fall's timer shows him again. */
  const warlordFallTokens = new WeakMap();

  function syncWarlord(player) {
    const npc = warlordsByPlayer.get(player);
    player.getPacketSender().sendVarbit(VARBIT_WARLORD_FIGHTING, npc?.isRegistered() || warlordFallen.has(player) ? 1 : 0);
  }

  function handleWarlordBootstrap({ player }) {
    syncWarlord(player);
  }

  /** The transcript's directional chorus labels name the actual village cohorts. */
  function bindCeremonyChorus(request) {
    const { player, step } = request;
    if (request.npcId !== KING_BOLREN_NPC_ID || step?.presentation !== "overhead"
      || !["[Northern Local Gnomes]", "[Southern Local Gnomes]"].includes(step.speaker)
      || quest.getStage(player) !== STAGE_DEFEATED_WARLORD || !orbsHandedOver(player)) return;
    const locals = [...(player.getLocalNpcs?.() ?? [])];
    const bolren = locals.find(npc => npc.getContentId(player) === KING_BOLREN_NPC_ID);
    const centre = bolren?.getSpawnPosition();
    const north = step.speaker === "[Northern Local Gnomes]";
    request.actors = centre ? locals.filter(npc => {
      if (npc.getContentId(player) !== NpcIdentifiers.LOCAL_GNOME_2) return false;
      const home = npc.getSpawnPosition();
      return home.getZ() === centre.getZ() && (north ? home.getY() > centre.getY() : home.getY() < centre.getY());
    }) : [];
    // Each chanter plays gnome_chanting with his words (local 1001802 ticks 2263-2269).
    const chanters = request.actors;
    const previous = request.before;
    request.before = () => {
      previous?.();
      for (const npc of chanters) npc.performAnimation?.(new Animation(CHANT_SEQ));
    };
  }

  /** The commanders the player can see: who shouts at the chest, or comes for them past the wall. */
  function commandersNear(player) {
    const at = player.getLocation();
    return [...(player.getLocalNpcs?.() ?? [])].filter((npc) => npc.getId?.() === NpcIdentifiers.KHAZARD_COMMANDER
      && npc.isRegistered?.() !== false && npc.getHitpoints?.() > 0
      && npc.getLocation().getZ() === at.getZ() && npc.getLocation().getDistance(at) <= COMMANDER_REACH)
      .sort((a, b) => a.getLocation().getDistance(at) - b.getLocation().getDistance(at));
  }

  /** The commander waiting for a player who is still climbing in. */
  const climbingCommanders = new WeakMap();

  /** The landing places the player again, which ends any attack begun on that tick: he starts the tick after. */
  function commanderAttacksLanded({ player, objectId }) {
    const commander = climbingCommanders.get(player);
    if (objectId !== CRUMBLED_WALL_OBJECT_ID || !commander) return;
    climbingCommanders.delete(player);
    Scenes.later(player, 1, () => {
      if (player.isRegistered?.() === false || commander.isRegistered?.() === false || !(commander.getHitpoints?.() > 0)) return;
      commander.getCombat().attack(player);
    });
  }

  /** The chest's "Oi! You!" comes from a commander in view; with none left (the capture's, killed first) nobody says it. */
  function bindChestShout(request) {
    const { player, step } = request;
    if (request.npcId !== NpcIdentifiers.KHAZARD_COMMANDER || step?.presentation !== "overhead"
      || String(request.text ?? "") !== COMMANDER_CHEST_SHOUT) return;
    const near = commandersNear(player);
    if (near.length) request.actors = [near[0]];
    else request.skip = true;
  }

  /**
   * Over the crumbled wall into the stronghold, during the attack on it: the nearest commander comes for the player
   * the tick after the climb and shouts the tick after that (local 1001802 ticks 1524-1526; the Wiki: "the Khazard
   * commanders that will attack you"). Ours: only while the orb is still to be taken back to Bolren.
   */
  function commanderMeetsClimb({ player, objectId, success }) {
    if (objectId !== CRUMBLED_WALL_OBJECT_ID) return;
    // A climb cut short leaves its commander waiting; any new climb replaces him.
    climbingCommanders.delete(player);
    if (!success) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_BALLISTA_FIRED || stage >= STAGE_RETURNED_FIRST_ORB) return;
    if (player.getLocation().getY() >= BALLISTA_SPEAR_TARGET.getY()) return;
    const commander = commandersNear(player).find((npc) => !npc.getCombat?.().getTarget?.());
    if (!commander) return;
    climbingCommanders.set(player, commander);
    Scenes.later(player, COMMANDER_SHOUT_TICKS, () => {
      if (commander.isRegistered?.() !== false && commander.getHitpoints?.() > 0) commander.forceChat(COMMANDER_WALL_SHOUT);
    });
  }

  function clearWarlord(player) {
    warlordFallen.delete(player);
    const npc = warlordsByPlayer.get(player);
    if (npc) {
      npc.getCombat().reset();
      api.removeNpc(npc);
      warlordsByPlayer.delete(player);
    }
    syncWarlord(player);
  }

  function handleWarlordThreat(request) {
    const { player, npc, npcId, text } = request;
    if (!KHAZARD_WARLORD_NPC_IDS.has(npcId) || !npc?.getLocation
      || (npc.getOwner?.() && npc.getOwner() !== player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_RETURNED_FIRST_ORB || stage > STAGE_DEFEATED_WARLORD) return;
    if (text !== "Ha, you really think you stand a chance? I'll crush you."
      && text !== "Fool, warriors blessed by Khazard don't die. You can't kill that which is already dead. However I can kill you!") return;
    const previous = request.after;
    request.after = () => {
      previous?.();
      const existing = warlordsByPlayer.get(player);
      if (existing?.isRegistered()) return;
      if (player.isRegistered?.() === false || quest.getStage(player) !== stage || !npc.isRegistered()) return;
      // He appears where the talking warlord stood (captures 1001800, 1001802, 1002235), and leashes to the tile beside.
      const home = freeTileBeside(npc);
      const at = npc.getLocation();
      const fighter = api.spawnNpc({ id: WARLORD_COMBAT_ID, x: at.getX(), y: at.getY(), z: at.getZ(),
        owner: player, ownerOnly: true, wanderRadius: 0 });
      if (!fighter) return;
      fighter.setSpawnPosition?.(home.clone());
      warlordFallen.delete(player);
      warlordsByPlayer.set(player, fighter);
      syncWarlord(player);
      player.getPacketSender().sendVarbit(VARBIT_CURRENT_HINT_ARROW, HINT_ARROW_NPC).sendEntityHint(fighter);
      TaskManager.submit(new WarlordFightTask(player, fighter, home));
      fighter.getCombat().attack(player);
    };
  }

  /**
   * The talking warlord keeps his tile while he is hidden from his challenger, and no NPC steps onto
   * another's: a fighter whose home was that tile could never get back to it, so he stood retreating
   * and healing. He starts, and keeps his home, beside it.
   */
  function freeTileBeside(npc) {
    const at = npc.getLocation();
    const movement = npc.getMovementQueue?.();
    for (const [dx, dy] of WARLORD_HOME_STEPS) {
      const tile = at.transform(dx, dy);
      try {
        if (movement?.canWalkTo(tile, at)) return tile;
      } catch {
        break;
      }
    }
    return at.clone();
  }

  /**
   * The chase, as the Wiki's safespot describes it: past his follow distance from home, or with his
   * challenger out of his aggression range (follow distance plus his melee reach), he gives up and walks
   * home; back home, he takes the fight up again while his challenger is in range. Core combat does
   * not leash an owner-only NPC everywhere, so the quest keeps it.
   */
  class WarlordFightTask extends Task {
    constructor(player, fighter, home) {
      super(1, fighter, false);
      this.player = player;
      this.fighter = fighter;
      this.home = home;
      this.returning = false;
    }

    walkHome() {
      const { fighter, home } = this;
      if (fighter.getMovementQueue().size() === 0) api.core.PathFinder.calculateWalkRoute(fighter, home.getX(), home.getY());
    }

    execute() {
      const { player, fighter, home } = this;
      if (warlordsByPlayer.get(player) !== fighter || !fighter.isRegistered()) {
        this.stop();
        return;
      }
      if (fighter.getHitpoints() <= 0) return;
      const followDistance = fighter.getCurrentDefinition().getCombatFollowDistance();
      const at = player.getLocation();
      const inRange = at.getZ() === home.getZ() && at.getDistance(home) <= followDistance + WARLORD_ATTACK_DISTANCE;
      const isHome = fighter.getLocation().equals(home);
      if (fighter.getCombat().getTarget()) {
        if (this.returning || fighter.getLocation().getDistance(home) > followDistance || !inRange) {
          fighter.getCombat().reset();
          this.returning = true;
          this.walkHome();
        }
        return;
      }
      if (!isHome) {
        this.returning = true;
        this.walkHome();
        return;
      }
      this.returning = false;
      if (inRange) fighter.getCombat().attack(player);
    }
  }

  function handleWarlordLogout({ player }) {
    clearWarlord(player);
  }

  /** "You spot the orbs of protection among his remains": they land on his tile, for his challenger. */
  function dropOrbs(player, location) {
    // Bolren may already hold them, from a ceremony that was cut off: no second set.
    if (orbsHandedOver(player)) return false;
    const groundItems = api.getItemOnGroundManager();
    if (groundItems.getGroundItem(player.getUsername(), ORBS_OF_PROTECTION_ITEM_ID, location, player.getPrivateArea())) return false;
    groundItems.registerLocation(player, new api.core.Item(ORBS_OF_PROTECTION_ITEM_ID, 1), location.clone());
    return true;
  }

  function handleNpcDeath({ npc, npcId, killer, damagers }) {
    if (!KHAZARD_WARLORD_NPC_IDS.has(npcId)) return;
    const player = killer?.isPlayer?.() ? killer : (damagers ?? []).find((entry) => entry?.isPlayer?.());
    if (!player || !npc || npc !== warlordsByPlayer.get(player)) return;
    warlordsByPlayer.delete(player);
    warlordFallen.add(player);
    const token = {};
    warlordFallTokens.set(player, token);
    Scenes.later(player, WARLORD_HIDDEN_AFTER_DEATH_TICKS, () => {
      if (!warlordFallen.has(player) || warlordFallTokens.get(player) !== token) return;
      warlordFallen.delete(player);
      if (player.isRegistered?.() !== false) syncWarlord(player);
    });
    const stage = quest.getStage(player);
    if (stage < STAGE_RETURNED_FIRST_ORB || stage > STAGE_DEFEATED_WARLORD) return;
    if (stage === STAGE_RETURNED_FIRST_ORB) quest.setStage(player, STAGE_DEFEATED_WARLORD);
    if (dropOrbs(player, npc.getLocation())) {
      startTranscript(api, player, WARLORD_COMBAT_ID, PAGE, WARLORD_DEFEATED_VARIANT);
    }
  }

  /**
   * Varbits 598-602 share varp 279: orbs handed in, the three tracker flags and
   * the random ballista x coordinate. Sends stay per-varbit, never the parent.
   */
  function sendProgressVarbits(player) {
    const stage = quest.getStage(player);
    const mask = trackerMask(player);
    const sender = player.getPacketSender();
    // 0 through the quest (the first orb does not change it), 1 once Bolren takes the orbs for the ceremony, 2 complete.
    const orbs = stage >= STAGE_COMPLETE ? BOLREN_GOT_ORBS_PLACED : player.getAttribute(ORBS_GIVEN_ATTRIBUTE) === true ? 1 : 0;
    sender.sendVarbit(VARBIT_BOLREN_GOT_ORBS, orbs);
    sender.sendVarbit(VARBIT_GNOMETRACKER_H, mask & 1 ? 1 : 0);
    sender.sendVarbit(VARBIT_GNOMETRACKER_Y, mask & 2 ? 1 : 0);
    sender.sendVarbit(VARBIT_GNOMETRACKER_X, mask & 4 ? 1 : 0);
    sender.sendVarbit(VARBIT_BALLISTA, ballistaCoordinate(player));
  }

  function handleStageChanged({ player, key }) {
    if (key === "tree_gnome_village") sendProgressVarbits(player);
  }

  function handleLogin({ player }) {
    syncWarlord(player);
    refreshQuestList(player);
    sendProgressVarbits(player);
  }

  quest = registerQuest(api, {
    key: "tree_gnome_village",
    name: "Tree Gnome Village",
    varpId: VARP_TREE_GNOME_VILLAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.ATTACK.getIndex(), amount: 11450, label: "Attack" }],
    rewardItemId: GNOME_AMULET_ITEM_ID,
    // The scroll's lines as captured (local 1001802 tick 2320): points, Attack, then the tree, then the amulet.
    rewardItemLabel: "A Gnome Amulet",
    otherRewards: ["Spirit Tree Access"],
    rewardOrder: ["xp", "other", "item"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(TRACKER_STATE_ATTRIBUTE, 0);
  api.persistAttribute(ORBS_GIVEN_ATTRIBUTE, false);
  api.persistAttribute(BALLISTA_COORDINATE_ATTRIBUTE, -1);

  api.onNpcInteraction("Elkoy", { Follow: followElkoy, "Talk-to": talkToUnindexed });
  api.onNpcInteraction("Khazard warlord", { "Talk-to": talkToUnindexed });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("door:toggle", guardStrongholdDoor);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("npc-dialogue:line", handleWarlordThreat);
  api.onCustomEvent("npc-dialogue:line", bindCeremonyChorus);
  api.onCustomEvent("npc-dialogue:line", guideOnElkoyLine);
  api.onCustomEvent("npc-dialogue:line", handleStageLines);
  api.onCustomEvent("npc-dialogue:line", bindChestShout);
  api.onCustomEvent("agility:obstacle-start", commanderMeetsClimb);
  api.onCustomEvent("agility:obstacle", commanderAttacksLanded);
  api.onCustomEvent("player:bootstrap-complete", handleWarlordBootstrap);
  api.onPlayerLogout(handleWarlordLogout);
  api.onPlayerDeath(handleWarlordLogout);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
};
