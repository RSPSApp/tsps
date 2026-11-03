/**
 * Holy Grail (members).
 *
 * Every speaking NPC is indexed on the "Holy Grail" transcript page, so the ask
 * King Arthur -> Merlin -> High Priest chain, Galahad's napkin, the Fisher King
 * and Sir Percival's whistle hand-over are all transcript-driven. This plugin
 * selects the variant by stage, answers the page's prose conditions, gives the
 * quest items on the dump's receive actions and runs the world mechanics the
 * transcript only describes. Behaviour follows the OSRS Wiki walkthrough and
 * transcript; stage values and tiles follow Quest Helper and the cache. No
 * rsprox recording of the quest exists (searched items 15-19, NPCs 4056-4067,
 * locs 22/23, varp 5 and the quest's messages).
 *
 * Stages (varp 5): 2 started, 3 spoken to Merlin, 4 spoken to the High Priest,
 * 7 defeated the Black Knight Titan, 8 spoken to the Fisher King, 9 gave Percival
 * the whistle, 10 complete. Quest Helper shows the varp takes 7 between 4 and 8
 * but not what sets it; the Titan's death is inferred. (There is no
 * "quest:holy-grail:start" hook in the dump; the quest starts on King Arthur's
 * "Yes." choice.)
 *
 * World mechanics:
 * - The two magic whistles on the top floor of Draynor Manor appear (privately)
 *   only while the player carries Galahad's napkin, topped up on entering the room.
 * - A whistle blown under the tower north-west of Brimhaven crosses into the
 *   Fisher Realm: the withered realm until Percival is king (stage 9), the
 *   restored one (the same map, 128 tiles west) after. Blown in either realm it
 *   returns to the tower.
 * - The Black Knight Titan holds the one-tile bridge (his tile is cache-blocked).
 *   He regenerates unless the killing blow lands while Excalibur is wielded; a
 *   valid kill carries the player past him. Every crossing needs a kill until
 *   the realm is restored.
 * - Asking the fisherman how to get into the castle leaves a Grail bell by the
 *   dismantled bricks; ringing it there takes the player inside.
 * - The feather points to Sir Percival's sacks in Goblin Village, and opening
 *   them with the feather frees him.
 *
 * Gaps: the crone is a chathead only (she does not appear beside the High
 * Priest), the fairy ring BJR is not gated on quest progress (the refusal
 * message is unknown), and Sir Percival's "Your father wishes to speak to you."
 * option is unreachable because the wiki transcript indents the whistle
 * conditions between his two options (a dump fix, not a plugin one).
 */
module.exports = function registerHolyGrailQuest(api) {
  const {
    Skill, ItemIdentifiers, NpcIdentifiers, Equipment, Location, Item, ItemOnGroundManager,
    DialogueChainBuilder, StatementDialogue,
  } = api.core;
  const { registerQuest, getRegisteredQuests, startTranscript } = require("../QuestRuntime");

  const KING_ARTHUR_NPC_IDS = new Set([
    NpcIdentifiers.KING_ARTHUR,
    NpcIdentifiers.ARTHUR,
    NpcIdentifiers.KING_ARTHUR_2,
    NpcIdentifiers.KING_ARTHUR_3,
  ]);
  const MERLIN_NPC_IDS = new Set([NpcIdentifiers.MERLIN, NpcIdentifiers.MERLIN_2]);
  const HIGH_PRIEST_NPC_IDS = new Set([
    NpcIdentifiers.HIGH_PRIEST,
    NpcIdentifiers.CRONE,
    NpcIdentifiers.HIGH_PRIEST_3,
  ]);
  const SIR_PERCIVAL_NPC_ID = NpcIdentifiers.SIR_PERCIVAL;
  const KING_PERCIVAL_NPC_ID = NpcIdentifiers.KING_PERCIVAL;
  const GALAHAD_NPC_ID = NpcIdentifiers.GALAHAD;
  const FISHERMAN_NPC_ID = NpcIdentifiers.FISHERMAN_2;
  const FISHER_KING_NPC_ID = NpcIdentifiers.THE_FISHER_KING;
  const GRAIL_MAIDEN_NPC_ID = NpcIdentifiers.GRAIL_MAIDEN;
  const BLACK_KNIGHT_TITAN_NPC_ID = NpcIdentifiers.BLACK_KNIGHT_TITAN;
  /** The withered realm's peasants (4060) and the restored realm's (4061). */
  const WITHERED_PEASANT_NPC_ID = NpcIdentifiers.PEASANT;
  const RESTORED_PEASANT_NPC_ID = NpcIdentifiers.PEASANT_2;

  const KNIGHT_VARIANTS = new Map([
    [NpcIdentifiers.SIR_LANCELOT, "asking-the-other-knights-talking-to-sir-lancelot"],
    [NpcIdentifiers.SIR_GAWAIN, "asking-the-other-knights-talking-to-sir-gawain"],
    [NpcIdentifiers.SIR_KAY, "asking-the-other-knights-talking-to-sir-kay"],
    [NpcIdentifiers.SIR_BEDIVERE, "asking-the-other-knights-talking-to-sir-bedivere"],
    [NpcIdentifiers.SIR_PELLEAS, "asking-the-other-knights-talking-to-sir-pellas"],
    [NpcIdentifiers.SIR_LUCAN, "asking-the-other-knights-talking-to-sir-lucan"],
    [NpcIdentifiers.SIR_PELLEAS_3, "asking-the-other-knights-talking-to-sir-pellas"],
    [NpcIdentifiers.SIR_GAWAIN_3, "asking-the-other-knights-talking-to-sir-gawain"],
    [NpcIdentifiers.SIR_KAY_3, "asking-the-other-knights-talking-to-sir-kay"],
  ]);

  /** NPCs whose transcripts this plugin owns; dialogue conditions from anyone else are not ours. */
  const DIALOGUE_NPC_IDS = new Set([
    ...KING_ARTHUR_NPC_IDS,
    ...MERLIN_NPC_IDS,
    ...HIGH_PRIEST_NPC_IDS,
    ...KNIGHT_VARIANTS.keys(),
    SIR_PERCIVAL_NPC_ID,
    KING_PERCIVAL_NPC_ID,
    WITHERED_PEASANT_NPC_ID,
    GALAHAD_NPC_ID,
    FISHERMAN_NPC_ID,
    FISHER_KING_NPC_ID,
    GRAIL_MAIDEN_NPC_ID,
    BLACK_KNIGHT_TITAN_NPC_ID,
  ]);

  const VARP_HOLY_GRAIL = 5;
  const STAGE_STARTED = 2;
  const STAGE_SPOKEN_MERLIN = 3;
  const STAGE_SPOKEN_CRONE = 4;
  const STAGE_DEFEATED_TITAN = 7;
  const STAGE_FINDING_PERCIVAL = 8;
  const STAGE_GIVEN_WHISTLE = 9;
  const STAGE_COMPLETE = 10;

  const NAPKIN_ITEM_ID = ItemIdentifiers.HOLY_TABLE_NAPKIN;
  const MAGIC_WHISTLE_ITEM_ID = ItemIdentifiers.MAGIC_WHISTLE;
  const GRAIL_BELL_ITEM_ID = ItemIdentifiers.GRAIL_BELL;
  const MAGIC_FEATHER_ITEM_ID = ItemIdentifiers.MAGIC_GOLD_FEATHER;
  const HOLY_GRAIL_ITEM_ID = ItemIdentifiers.HOLY_GRAIL;
  const EXCALIBUR_ITEM_ID = ItemIdentifiers.EXCALIBUR;
  /** 1978, the drinkable cup of tea (712 is the display one). */
  const CUP_OF_TEA_ITEM_ID = ItemIdentifiers.CUP_OF_TEA_2;

  // Under the tower north of the Brimhaven gold rocks, where the six heads point
  // (Quest Helper's whistle zone); blowing in the realm comes back to its middle.
  const WHISTLE_AREA = { minX: 2740, maxX: 2743, minY: 3234, maxY: 3237 };
  const BRIMHAVEN_TILE = { x: 2742, y: 3236, z: 0 };
  // The withered realm is the restored realm's map 128 tiles east. Both arrivals
  // are on the east bank, before the Titan's bridge.
  const REALM_OFFSET_X = 128;
  const WITHERED_REALM_BOUNDS = { minX: 2740, maxX: 2815, minY: 4665, maxY: 4740 };
  const RESTORED_REALM_BOUNDS = { minX: 2600, maxX: 2700, minY: 4665, maxY: 4740 };
  const WITHERED_ARRIVAL_TILE = { x: 2793, y: 4724, z: 0 };
  const RESTORED_ARRIVAL_TILE = { x: WITHERED_ARRIVAL_TILE.x - REALM_OFFSET_X, y: 4724, z: 0 };
  // The bridge is one tile wide (y 4722) over the river at x 2790-2792; the
  // Titan's tile in its middle is cache-blocked, so a kill steps the player over.
  const TITAN_TILE = { x: 2791, y: 4722, z: 0 };
  const BRIDGE_EAST_TILE = { x: 2792, y: 4722, z: 0 };
  const BRIDGE_WEST_TILE = { x: 2790, y: 4722, z: 0 };
  // The Grail bell lies north of the dismantled bricks (2761-2762, 4693);
  // ringing it within four tiles of them takes the player inside.
  const BELL_TILE = { x: 2762, y: 4694, z: 0 };
  const BRICK_TILES = [{ x: 2761, y: 4693, z: 0 }, { x: 2762, y: 4693, z: 0 }];
  const BELL_RADIUS = 4;
  const CASTLE_INSIDE_TILE = { x: 2762, y: 4691, z: 0 };
  // The whistle room south of Professor Oddenstein, top floor of Draynor Manor (Quest Helper's
  // magicWhistleRoom); the door at 3106,3361 lands on its north row.
  const WHISTLE_ROOM_ZONE = { minX: 3104, maxX: 3112, minY: 3357, maxY: 3361, levels: [2] };
  const WHISTLE_TABLE_TILE = { x: 3107, y: 3359, z: 2 };
  const WHISTLES_ON_TABLE = 2;
  // Sir Percival is trapped in the sacks in the east house of Goblin Village.
  // He steps out on the open west side of the sacks (the east tile is a pocket).
  const SACKS_TILE = { x: 2962, y: 3506, z: 0 };
  const PERCIVAL_TILE = { x: 2960, y: 3506, z: 0 };
  const PERCIVAL_HOUSE = { minX: 2958, maxX: 2963, minY: 3504, maxY: 3508 };
  const FEATHER_NEARBY_RADIUS = 5;
  /** Underground maps start here; the feather does not work in dungeons. */
  const DUNGEON_MIN_Y = 6400;
  const PERCIVAL_REVEALED_ATTRIBUTE = "holy-grail:percival-revealed";

  const NAPKIN_ACTION_ID = "IWEKeT";
  const FEATHER_ACTION_ID = "QFSQAR";
  const WHISTLE_ACTION_IDS = new Set(["xUC5cW", "RwrmfE"]);
  const COMPLETE_ACTION_ID = "MtgzHp";
  const TELEPORT_ACTION_ID = "jbdCvp";
  const TEA_RECEIVE_ACTION_IDS = new Set(["7SPxqF", "rAfHgn"]);
  /** "Sir Galahad gives you a cup of tea." on each of his four paths. */
  const TEA_MESSAGE_IDS = new Set(["UM_Nt9", "B7B2V7", "y1Y3N3", "lIuD4R"]);
  const SACK_OPENED_MESSAGE_ID = "VHDHnK";
  const INSIDE_CASTLE_MESSAGE_ID = "TXKuhf";
  const FEATHER_GIVEN_MESSAGE_ID = "Vfcrb6";
  /** The transcript's boxed lines ({{tbox}}); its other messages are chat ({{mes}}). */
  const STATEMENT_MESSAGE_IDS = new Set([
    "Nf9LIy", // Arthur: the combat level warning
    "J6t5U2", // Galahad hangs a kettle over the fire
    ...TEA_MESSAGE_IDS,
    "TCOaoy", // Galahad passes you a small cloth
    "rp1SrY", // I am the Black Knight Titan!
    "Afwqnt", "d7cNoK", // Ting-a-ling-a-ling!
    INSIDE_CASTLE_MESSAGE_ID,
    "UgU-C8", SACK_OPENED_MESSAGE_ID,
    ...WHISTLE_ACTION_IDS,
  ]);
  const TITAN_CHALLENGE_OPTION = "Okay, have at ye oh evil knight!";
  const FISHERMAN_BELL_OPTION = "Any idea how to get into the castle?";
  const FISHER_KING_SON_OPTION = "You don't look too well.";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const ownsGrail = (player) => hasItem(player, HOLY_GRAIL_ITEM_ID);

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I returned the Holy Grail to Camelot.</str>",
        "<str>Percival took his father's place in the Fisher Realm.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_GIVEN_WHISTLE) {
      return ["Percival has returned to the Fisher Realm. I should take", "the <col=800000>Holy Grail</col> back to <col=800000>King Arthur</col>."];
    }
    if (stage >= STAGE_FINDING_PERCIVAL) {
      return ["The Fisher King wants his son <col=800000>Percival</col>, a Knight", "of the Round Table, to return to his castle."];
    }
    if (stage >= STAGE_SPOKEN_CRONE) {
      return ["A crone told me to blow a whistle where the six stone", "heads face to reach the <col=800000>Fisher King</col>."];
    }
    if (stage >= STAGE_SPOKEN_MERLIN) {
      return ["<str>King Arthur sent me to recover the Holy Grail.</str>", "Merlin suggested a holy island, or <col=800000>Sir Galahad</col>."];
    }
    if (stage >= STAGE_STARTED) {
      return ["<str>King Arthur sent me to recover the Holy Grail.</str>", "I should speak to <col=800000>Merlin</col> in his Camelot workshop."];
    }
    return ["I can start this quest by talking to <col=800000>King Arthur</col> in <col=800000>Camelot</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 11000);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 15300);
  }

  function questComplete(player, key) {
    const entry = getRegisteredQuests().find((registered) => registered.key === key);
    return Boolean(entry && entry.isComplete(player));
  }

  function merlinsCrystalIncomplete(player) {
    const merlinsCrystal = getRegisteredQuests().find((entry) => entry.key === "merlins_crystal");
    return Boolean(merlinsCrystal && !merlinsCrystal.isComplete(player));
  }

  function arthurVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) {
      // King's Ransom has its own after-quest lines.
      if (questComplete(player, "kings_ransom")) return null;
      return { page: "King Arthur", variant: "standard-dialogue-after-completing-holy-grail" };
    }
    if (stage >= STAGE_GIVEN_WHISTLE) {
      return ownsGrail(player) ? "talking-to-king-arthur-2" : "talking-to-merlin-updating-king-arthur";
    }
    if (stage >= STAGE_FINDING_PERCIVAL) return "talking-to-king-arthur";
    if (stage >= STAGE_SPOKEN_MERLIN) return "talking-to-merlin-updating-king-arthur";
    if (stage >= STAGE_STARTED) return "starting-off-subsequent-dialogue-with-king-arthur";
    return "starting-off";
  }

  function merlinVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) {
      if (questComplete(player, "kings_ransom")) return null;
      return { page: "Merlin", variant: "after-holy-grail" };
    }
    if (stage < STAGE_STARTED) return null;
    if (stage === STAGE_STARTED) quest.setStage(player, STAGE_SPOKEN_MERLIN);
    return "talking-to-merlin";
  }

  function inBounds(place, bounds) {
    const { x, y } = coords(place);
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  function percivalVariant(stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Sir Percival", variant: "standard-dialogue-after-holy-grail-in-the-goblin-village" };
    if (stage >= STAGE_GIVEN_WHISTLE) return "talking-to-sir-percival-subsequent-dialogue-with-sir-percival";
    if (stage >= STAGE_FINDING_PERCIVAL) return "talking-to-sir-percival";
    return null;
  }

  function selectVariant({ npcId, player, npc }) {
    const stage = quest.getStage(player);
    const during = stage >= STAGE_STARTED && stage < STAGE_COMPLETE;
    if (KING_ARTHUR_NPC_IDS.has(npcId)) {
      // Arthur's Merlin's Crystal start comes first; Holy Grail only opens once it is done.
      if (merlinsCrystalIncomplete(player)) return null;
      return arthurVariant(player, stage);
    }
    if (MERLIN_NPC_IDS.has(npcId)) {
      // Merlin's Crystal owns Merlin until it is finished; Holy Grail's chain only starts after Arthur.
      if (merlinsCrystalIncomplete(player)) return null;
      return merlinVariant(player, stage);
    }
    if (HIGH_PRIEST_NPC_IDS.has(npcId)) {
      // The player opens with "I am in search of the Holy Grail", so only once Merlin has sent them.
      if (stage < STAGE_SPOKEN_MERLIN || stage >= STAGE_COMPLETE) return null;
      if (stage === STAGE_SPOKEN_MERLIN) quest.setStage(player, STAGE_SPOKEN_CRONE);
      return "talking-to-the-high-priest-of-entrana";
    }
    if (npcId === GALAHAD_NPC_ID) return during ? "talking-to-sir-galahad" : null;
    if (npcId === FISHERMAN_NPC_ID) return "talking-to-the-fisherman";
    if (npcId === FISHER_KING_NPC_ID) return "talking-to-the-fisher-king";
    if (npcId === GRAIL_MAIDEN_NPC_ID) {
      const place = npc?.getLocation?.() ?? player.getLocation();
      return inBounds(place, RESTORED_REALM_BOUNDS)
        ? { page: "Grail Maiden", variant: "talking-to-them-inside-the-castle" }
        : "ringing-the-grail-bell-talking-to-a-grail-maiden";
    }
    if (npcId === SIR_PERCIVAL_NPC_ID) return percivalVariant(stage);
    if (KNIGHT_VARIANTS.has(npcId)) {
      // The Grail round-table talk is only Holy Grail's after Merlin's Crystal and its own start.
      if (merlinsCrystalIncomplete(player) || !during) return null;
      return KNIGHT_VARIANTS.get(npcId);
    }
    if (npcId === WITHERED_PEASANT_NPC_ID) return "talking-to-the-fisherman-peasant";
    if (npcId === RESTORED_PEASANT_NPC_ID) return { page: "Peasant", variant: "standard-dialogue-after-holy-grail" };
    return null;
  }

  function answerCondition({ player, npcId, text }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const skills = player.getSkillManager();
    const combat = typeof skills.getCombatLevel === "function" ? skills.getCombatLevel() : 999;
    if (value.includes("combat level is less than 50")) return combat < 50;
    if (value.includes("combat level is more than 50")) return combat >= 50;
    if (value.includes("talked to the high priest of entrana first")) return quest.getStage(player) >= STAGE_SPOKEN_CRONE;
    // The Titan's defeat lines play when he dies (handleTitanDeath), not when he is challenged.
    if (value.includes("defeats the black knight titan") || value.includes("uses the excalibur")) return false;
    if (value.includes("does not have the whistle")) return !hasItem(player, MAGIC_WHISTLE_ITEM_ID);
    if (value.includes("has the magic whistle")) return hasItem(player, MAGIC_WHISTLE_ITEM_ID);
    if (value.includes("loses the feather")) return !hasItem(player, MAGIC_FEATHER_ITEM_ID);
    if (value.includes("does not have enough inventory space")) return player.getInventory().isFull();
    if (value.includes("has one free inventory space")) return !player.getInventory().isFull();
    if (value.includes("talks to him again")) return false;
    if (value.includes("rings the grail bell but is not by")) return !byTheBricks(player.getLocation());
    if (value.includes("at least four tiles by the dismantled bricks")) return byTheBricks(player.getLocation());
    // The sack prose belongs to opening the sack (openSacks), not to talking to Percival after.
    if (value.includes("prods at the sacks")) return false;
    if (value.includes("attempts to open the sack")) return openingSack.has(player);
    return null;
  }

  /** Wiki: 20 Attack. */
  const ATTACK_REQUIREMENT = 20;

  function meetsSkillRequirements(player) {
    return player.getSkillManager().getMaxLevel(Skill.ATTACK) >= ATTACK_REQUIREMENT;
  }

  function notifySkillRequirements(player) {
    if (!meetsSkillRequirements(player)) {
      player.sendMessage(
        `You need an Attack level of at least ${ATTACK_REQUIREMENT} to start this quest.`
      );
    }
  }

  /**
   * King Arthur's "Yes." starts the quest. The same NPC and choice text accept
   * Merlin's Crystal's start while that quest is incomplete, and that choice is
   * not ours, so defer until the prerequisite is done.
   */
  function startQuest(player, option) {
    if (quest.getStage(player) !== 0) return;
    if (merlinsCrystalIncomplete(player)) return;
    if (String(option ?? "").replace(/[^a-z]/gi, "").toLowerCase() !== "yes") return;
    if (!meetsSkillRequirements(player)) {
      notifySkillRequirements(player);
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npc, npcId, option }) {
    if (KING_ARTHUR_NPC_IDS.has(npcId)) {
      startQuest(player, option);
      return;
    }
    if (npcId === BLACK_KNIGHT_TITAN_NPC_ID && option === TITAN_CHALLENGE_OPTION) {
      // Wiki: not aggressive until spoken to.
      npc?.getCombat?.()?.attack?.(player);
      return;
    }
    if (npcId === FISHERMAN_NPC_ID && option === FISHERMAN_BELL_OPTION) {
      leaveBell(player);
      return;
    }
    if (npcId === FISHER_KING_NPC_ID && option === FISHER_KING_SON_OPTION) {
      const stage = quest.getStage(player);
      if (stage === STAGE_SPOKEN_CRONE || stage === STAGE_DEFEATED_TITAN) quest.setStage(player, STAGE_FINDING_PERCIVAL);
    }
  }

  function giveOnce(player, itemId, label) {
    if (hasItem(player, itemId) || player.getInventory().isFull()) return;
    player.getInventory().adds(itemId, 1);
    if (label) player.sendMessage(label);
  }

  /** Reads a Location or a plain { x, y, z } into tile numbers. */
  function coords(value) {
    return {
      x: typeof value?.getX === "function" ? value.getX() : value?.x,
      y: typeof value?.getY === "function" ? value.getY() : value?.y,
      z: typeof value?.getZ === "function" ? value.getZ() : value?.z ?? 0,
    };
  }

  const toLocation = (tile) => new Location(tile.x, tile.y, tile.z);

  function within(place, tile, radius) {
    const from = coords(place);
    return from.z === tile.z
      && Math.abs(from.x - tile.x) <= radius
      && Math.abs(from.y - tile.y) <= radius;
  }

  function inFisherRealm(location) {
    // The Grail castles' upper floors are planes 1 and 2, so ignore the plane.
    return inBounds(location, WITHERED_REALM_BOUNDS) || inBounds(location, RESTORED_REALM_BOUNDS);
  }

  function inWhistleArea(location) {
    const { z } = coords(location);
    return z === 0 && inBounds(location, WHISTLE_AREA);
  }

  function byTheBricks(location) {
    return BRICK_TILES.some((tile) => within(location, tile, BELL_RADIUS));
  }

  function statement(player, text, after) {
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, text));
    if (after) chain.add(new api.core.ActionDialogue(1, { execute: after }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** The whistle travels between the Brimhaven tower and the Fisher Realm. */
  function blowWhistle({ player }) {
    const location = player.getLocation();
    if (inFisherRealm(location)) {
      player.moveTo(toLocation(BRIMHAVEN_TILE));
      return;
    }
    if (!inWhistleArea(location)) {
      statement(player, "The whistle makes no noise. It will not work in this location.");
      return;
    }
    const restored = quest.getStage(player) >= STAGE_GIVEN_WHISTLE;
    player.moveTo(toLocation(restored ? RESTORED_ARRIVAL_TILE : WITHERED_ARRIVAL_TILE));
  }

  /** Ringing the bell by the dismantled bricks: the transcript's two conditions pick the outcome. */
  function ringGrailBell({ player }) {
    startTranscript(api, player, GRAIL_MAIDEN_NPC_ID, "Holy Grail", "ringing-the-grail-bell");
  }

  /** The feather points to Percival's sacks: in his house, near them, or a compass direction. */
  function blowFeather({ player }) {
    const location = coords(player.getLocation());
    if (location.z !== 0 || location.y >= DUNGEON_MIN_Y) {
      player.sendMessage("The feather doesn't seem to work here...");
      return;
    }
    if (inBounds(location, PERCIVAL_HOUSE)) {
      player.sendMessage("The feather points at the sacks.");
      return;
    }
    const dx = SACKS_TILE.x - location.x;
    const dy = SACKS_TILE.y - location.y;
    if (Math.abs(dx) <= FEATHER_NEARBY_RADIUS && Math.abs(dy) <= FEATHER_NEARBY_RADIUS) {
      player.sendMessage("The feather points to somewhere nearby.");
      return;
    }
    const northSouth = dy > 0 ? "north" : "south";
    const eastWest = dx > 0 ? "east" : "west";
    if (Math.abs(dx) === Math.abs(dy)) player.sendMessage(`The feather points to the ${northSouth}${eastWest}.`);
    else if (Math.abs(dx) > Math.abs(dy)) player.sendMessage(`The feather points to the ${eastWest}.`);
    else player.sendMessage(`The feather points to the ${northSouth}.`);
  }

  /** Private ground items of `itemId` the player has lying on `tile`. */
  function lyingFor(player, itemId, tile) {
    return ItemOnGroundManager.ownedBy(player.getUsername()).filter((groundItem) => {
      const position = groundItem.getPosition();
      return groundItem.getItem().getId() === itemId
        && position.getX() === tile.x && position.getY() === tile.y && position.getZ() === tile.z;
    });
  }

  function leaveForPlayer(player, itemId, tile, count) {
    for (let lying = lyingFor(player, itemId, tile).length; lying < count; lying++) {
      ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), toLocation(tile), player.getPrivateArea(), { goesGlobal: false });
    }
  }

  /** Wiki: the two whistles are only perceived while carrying the napkin; re-entering the room respawns them. */
  function enterWhistleRoom({ player }) {
    if (!hasItem(player, NAPKIN_ITEM_ID)) return;
    leaveForPlayer(player, MAGIC_WHISTLE_ITEM_ID, WHISTLE_TABLE_TILE, WHISTLES_ON_TABLE);
  }

  /** Wiki: one bell at a time, and none once the quest is done. */
  function leaveBell(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE || hasItem(player, GRAIL_BELL_ITEM_ID)) return;
    leaveForPlayer(player, GRAIL_BELL_ITEM_ID, BELL_TILE, 1);
  }

  /** The Grail can't be taken before Percival is king, nor twice. */
  function pickUpGrail(event) {
    if (event.groundItemId !== HOLY_GRAIL_ITEM_ID) return;
    const { player } = event;
    if (ownsGrail(player)) {
      statement(player, "You feel that taking more than one Holy Grail might be greedy...");
      event.handled = true;
      return;
    }
    if (quest.getStage(player) < STAGE_GIVEN_WHISTLE) {
      statement(player, "You feel that the Grail shouldn't be moved. You must complete some task here before you are worthy.");
      event.handled = true;
    }
  }

  /** The player whose hit last landed on each Titan: Excalibur must be wielded for the killing blow. */
  const lastTitanHitter = new WeakMap();

  function trackTitanHit({ npc, hit }) {
    if (npc?.getId?.() !== BLACK_KNIGHT_TITAN_NPC_ID) return;
    const attacker = hit?.getAttacker?.();
    if (attacker?.isPlayer?.()) lastTitanHitter.set(npc, attacker.getAsPlayer?.() ?? attacker);
  }

  function wieldsExcalibur(player) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === EXCALIBUR_ITEM_ID;
  }

  /** Wiki: without Excalibur he regenerates to full; with it the player may pass. */
  function handleTitanDeath(event) {
    const { npc } = event;
    if (npc?.getId?.() !== BLACK_KNIGHT_TITAN_NPC_ID) return;
    const player = lastTitanHitter.get(npc) ?? npc.getCombat?.()?.getKiller?.(false);
    lastTitanHitter.delete(npc);
    if (!player) return;
    if (!wieldsExcalibur(player)) {
      event.preventDeath = true;
      npc.setHitpoints(npc.getDefinition().getHitpoints());
      npc.getCombat?.()?.reset?.();
      statement(player, "Puny mortal... You cannot defeat me...");
      player.sendMessage("Maybe you need something more to beat the titan?");
      return;
    }
    player.sendMessage("Well done! You have defeated the Black Knight Titan!");
    if (quest.getStage(player) === STAGE_SPOKEN_CRONE) quest.setStage(player, STAGE_DEFEATED_TITAN);
    const east = coords(player.getLocation()).x > TITAN_TILE.x;
    player.getCombat?.()?.reset?.();
    player.moveTo(toLocation(east ? BRIDGE_WEST_TILE : BRIDGE_EAST_TILE));
  }

  /**
   * The dialogue index binds neither the Titan (his lines are boxes, not speech) nor King
   * Percival (only his own page) to the Holy Grail page, so their Talk-to starts it here.
   */
  function talkToTitan({ player, npcId, npc }) {
    if (npcId !== BLACK_KNIGHT_TITAN_NPC_ID || quest.getStage(player) < STAGE_STARTED) return false;
    return startTranscript(api, player, npcId, "Holy Grail", "encountering-the-black-knight-titan", undefined, npc);
  }

  function talkToKingPercival({ player, npcId, npc }) {
    if (quest.getStage(player) < STAGE_GIVEN_WHISTLE) return false;
    return startTranscript(api, player, npcId, "Holy Grail", "talking-to-sir-percival-talking-to-sir-percival-at-the-fisher-realm", undefined, npc);
  }

  /** Owner-only Percival spawns when his sack is opened. */
  const percivalByPlayer = new Map();
  /** Players opening the sack: the transcript's "attempts to open the sack" branch is theirs. */
  const openingSack = new WeakSet();

  function percivalRevealed(player) {
    return player.getAttribute(PERCIVAL_REVEALED_ATTRIBUTE) === true;
  }

  function revealPercival(player) {
    player.setAttribute(PERCIVAL_REVEALED_ATTRIBUTE, true);
    if (percivalByPlayer.has(player)) return percivalByPlayer.get(player);
    const npc = api.spawnNpc({
      id: SIR_PERCIVAL_NPC_ID,
      x: PERCIVAL_TILE.x,
      y: PERCIVAL_TILE.y,
      z: PERCIVAL_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) percivalByPlayer.set(player, npc);
    return npc;
  }

  function clearPercival(player) {
    const npc = percivalByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    percivalByPlayer.delete(player);
  }

  function handleLogout({ player }) {
    if (player) clearPercival(player);
  }

  /** Other "Sacks" locs share the name; Percival's are the pair in the east house. */
  function percivalsSacks(event) {
    return within(event.location, SACKS_TILE, 1);
  }

  function prodSacks(event) {
    if (!percivalsSacks(event)) return false;
    statement(event.player, "You hear a muffled groan. The sack wriggles slightly.");
    event.handled = true;
    return true;
  }

  /** Wiki: open (not prod) with the feather in the inventory, and Percival comes out. */
  function openSacks(event) {
    const { player } = event;
    if (!percivalsSacks(event)) return false;
    const ready = quest.getStage(player) === STAGE_FINDING_PERCIVAL
      && hasItem(player, MAGIC_FEATHER_ITEM_ID)
      && !percivalRevealed(player);
    if (!ready) return prodSacks(event);
    const percival = revealPercival(player);
    openingSack.add(player);
    startTranscript(api, player, SIR_PERCIVAL_NPC_ID, "Holy Grail", "talking-to-sir-percival", undefined, percival);
    event.handled = true;
    return true;
  }

  /** Boxes the transcript's {{tbox}} lines, and runs the ones that move or give something. */
  function handleMessage(event) {
    const { player, stepId } = event;
    if (STATEMENT_MESSAGE_IDS.has(stepId)) event.box = { statement: true };
    if (stepId === FEATHER_GIVEN_MESSAGE_ID) event.box = { items: [MAGIC_FEATHER_ITEM_ID] };
    if (TEA_MESSAGE_IDS.has(stepId)) giveOnce(player, CUP_OF_TEA_ITEM_ID);
    if (stepId === SACK_OPENED_MESSAGE_ID) openingSack.delete(player);
    if (stepId === INSIDE_CASTLE_MESSAGE_ID) event.after = () => player.moveTo(toLocation(CASTLE_INSIDE_TILE));
    if (WHISTLE_ACTION_IDS.has(stepId)) {
      player.getInventory().deleteNumber(MAGIC_WHISTLE_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_GIVEN_WHISTLE) quest.setStage(player, STAGE_GIVEN_WHISTLE);
    }
  }

  function handleAction(event) {
    if (event.kind === "message") {
      handleMessage(event);
      return;
    }
    const { player, stepId } = event;
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_GIVEN_WHISTLE && ownsGrail(player)) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === NAPKIN_ACTION_ID) {
      giveOnce(player, NAPKIN_ITEM_ID);
      event.handled = true;
      return;
    }
    if (stepId === FEATHER_ACTION_ID) {
      giveOnce(player, MAGIC_FEATHER_ITEM_ID);
      event.handled = true;
      return;
    }
    // The tea is handed over on Galahad's message line; the receive marker repeats it.
    if (TEA_RECEIVE_ACTION_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    if (stepId === TELEPORT_ACTION_ID) {
      player.moveTo(toLocation(BRIMHAVEN_TILE));
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "holy_grail",
    name: "Holy Grail",
    varpId: VARP_HOLY_GRAIL,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 11000, label: "Prayer" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 15300, label: "Defence" },
    ],
    // The player already holds the Grail; it is only the scroll's picture, not a second one.
    scrollItemId: HOLY_GRAIL_ITEM_ID,
    otherRewards: ["Access to the Fisher Realm"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction("Magic whistle", { Blow: blowWhistle });
  api.onItemAction("Grail bell", { Ring: ringGrailBell });
  api.onItemAction("Magic gold feather", { "Blow-on": blowFeather });
  api.onNpcInteraction("Black Knight Titan", { "Talk-to": talkToTitan });
  api.onNpcInteraction("King Percival", { "Talk-to": talkToKingPercival });
  api.onObjectInteraction("Sacks", { Prod: prodSacks, Open: openSacks });
  api.onZoneEnter(WHISTLE_ROOM_ZONE, enterWhistleRoom);
  api.onGroundItemPickup(pickUpGrail);
  api.onNpcHitModify(trackTitanHit);
  api.onNpcBeforeDeath(handleTitanDeath);
  api.onPlayerLogout(handleLogout);
};
