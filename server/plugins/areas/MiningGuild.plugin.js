/** Mining Guild entry needs 60 current Mining (boosts count); leaving is unrestricted.
 * https://oldschool.runescape.wiki/w/Mining_Guild
 *
 * The members' area (behind the two inner doors) gives an invisible +7 Mining level to the success
 * rolls and empties rocks for half as long: iron 5.4 s -> 2.4 s, adamantite 4 -> 2 minutes, runite
 * 12 -> 6 minutes (Wiki rock pages). Amethyst keeps its own 75 seconds (Wiki Amethyst crystals).
 * Docs: docs/mining.md.
 */
const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const REQUIRED_LEVEL = 60;
const MAIN_DOOR_SOUND = 81;
const MAIN_DOOR_OPEN_ROTATION = 2;
/** Wiki Mining Guild: the invisible boost inside the members' area. */
const MEMBERS_AREA_BOOST = 7;
/** Rocks that already have the area's own time on their Wiki page. */
const OWN_RESPAWN_ROCKS = new Set(["Amethyst crystals"]);
/**
 * The members' area: the main cave, the corridor behind the door at 3019,9732 and the one behind
 * 3043,9729 (the tiles reachable from the cave with the inner doors shut, in the active cache).
 */
const MEMBERS_AREA_TILES = [
  [2999, 3058, 9696, 9728],
  [3017, 3021, 9729, 9732],
  [3042, 3044, 9729, 9729],
];
/**
 * Unidentified minerals (https://oldschool.runescape.wiki/w/Unidentified_minerals): one roll per
 * ore mined in the members' area, at the Wiki's per-rock rate, while Belona's toggle is on. The
 * toggle is on by default and she flips it from her right-click option or the two dialogue
 * branches; the shop that spends them is data (shops.json, id 1454).
 */
const MINERALS_ATTRIBUTE = "mining-guild:minerals";
const MINERAL_ITEM = 21341;
const BELONA = 7719;
/** Ore item -> the rock's 1-in-N chance (Wiki). Noted forms never come out of a rock. */
const MINERAL_CHANCE = new Map([
  [440, 100], // iron
  [453, 60], // coal
  [447, 40], // mithril
  [449, 30], // adamantite
  [451, 20], // runite
  [21347, 20], // amethyst
]);
const MINERAL_FOUND = "You find some minerals while you mine.";
// The Wiki gives Belona's dialogue lines but not the game message her right-click option prints.
const MINERALS_ON = "You will now receive unidentified minerals when you mine here.";
const MINERALS_OFF = "You will no longer receive unidentified minerals when you mine here.";
let core;
let membersArea = null;

function inMembersArea(location) {
  membersArea ??= MEMBERS_AREA_TILES.map(([x, x2, y, y2]) => new core.Boundary(x, x2, y, y2, 0));
  return membersArea.some((boundary) => boundary.inside(location));
}

/** "mining:level-boost": the area's invisible boost for the player standing in it. */
function boostMining(request) {
  if (inMembersArea(request.player.getLocation())) request.boost += MEMBERS_AREA_BOOST;
}

/** "mining:respawn-ticks": half the time for a rock standing in the area. */
function halveRespawn(request) {
  if (OWN_RESPAWN_ROCKS.has(request.rock) || !inMembersArea(request.object.getLocation())) return;
  request.ticks = Math.floor(request.ticks / 2);
}

/**
 * rsprox_transcripts/234/03285.txt:506107 (the guild door at 56 Mining): "...to access..." as a mesbox chat line and,
 * the same tick, the message box.
 */
function canEnter(player) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.MINING) >= REQUIRED_LEVEL) return true;
  const { DialogueChainBuilder, StatementDialogue, ChatType } = core;
  const text = `You need a Mining level of ${REQUIRED_LEVEL} to access the Mining Guild.`;
  player.getPacketSender().sendTypedMessage(ChatType.MESBOX, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  return false;
}

function guardLadder(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.LADDER_354) return;
  if (!canEnter(request.player)) request.handled = true;
}

/** RSProx 3241 and 3131 show an invisible wall, a quarter-turned leaf and a two-tick close. */
function passMainDoor(player, object, x, y) {
  const { CacheDefinitions, GameObject, Location } = core;
  const tile = object.getLocation();
  const wall = new GameObject(CacheDefinitions.getLocId("inviswall"), tile, object.getType(), object.getFace(), null);
  const leaf = new GameObject(CacheDefinitions.getLocId("inactivepoordoor"), new Location(x, tile.getY() + 1, tile.getZ()),
    object.getType(), MAIN_DOOR_OPEN_ROTATION, null);
  const sender = player.getPacketSender();
  let opened = false;
  ObstacleRunner.run({ player }, [
    { wait: 1 },
    { run: () => {
      // Remove the cached door mesh before replacing it with the invisible wall.
      sender.sendObjectRemoval(object);
      sender.sendObject(wall);
      sender.sendObject(leaf);
      sender.sendSound(MAIN_DOOR_SOUND, 1, 0);
      opened = true;
    } },
    { walk: [[x, y]], arrive: true },
    { wait: 2 },
  ], {
    onFinish: () => {
      if (!opened) return;
      sender.sendObjectRemoval(leaf);
      sender.sendObject(object);
    },
  });
}

function useDoor(request) {
  if (request.handled) return;
  const { DOOR_562, DOOR_563, DOOR_564 } = core.ObjectIdentifiers;
  if (![DOOR_562, DOOR_563, DOOR_564].includes(request.objectId)) return;
  request.handled = true;
  const { player, object } = request;
  if (ObstacleRunner.isBusy(player) || player.getMovementQueue().isMovementBlocked()) return;
  const door = object.getLocation();
  const from = player.getLocation();
  // All three cache doors are north-facing walls: the guild side is the door's own tile.
  const entering = from.getY() > door.getY();
  if (entering && !canEnter(player)) return;
  if (entering && request.objectId !== DOOR_562 && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members' world to enter this part of the Mining Guild.");
    return;
  }
  const x = door.getX(), y = door.getY() + (entering ? 0 : 1);
  if (from.getZ() !== door.getZ() || Math.abs(from.getX() - x) + Math.abs(from.getY() - y) !== 1) return;
  if (request.objectId === DOOR_562) {
    passMainDoor(player, object, x, y);
    return;
  }
  const sender = player.getPacketSender();
  sender.sendObjectRemoval(object);
  // Keep the shared wall closed so another player cannot bypass the entry check.
  ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: [[x, y]] }], {
    onFinish: () => sender.sendObject(object),
  });
}

function mineralsEnabled(player) {
  return player.getAttribute(MINERALS_ATTRIBUTE) !== false;
}

function setMinerals(player, enabled) {
  player.setAttribute(MINERALS_ATTRIBUTE, enabled);
  player.sendMessage(enabled ? MINERALS_ON : MINERALS_OFF);
}

/** Belona's right-click "Toggle-minerals". */
function toggleMinerals({ player }) {
  setMinerals(player, !mineralsEnabled(player));
  return true;
}

/** The two dialogue branches are guarded by wiki prose; answer them from the toggle. */
function answerMineralCondition({ npcId, player, text }) {
  if (npcId !== BELONA) return null;
  const value = String(text).toLowerCase();
  if (value.includes("currently receiving unidentified minerals")) return mineralsEnabled(player);
  if (value.includes("currently not receiving unidentified minerals")) return !mineralsEnabled(player);
  return null;
}

/** The branches carry no action of their own, so the choice itself flips the toggle. */
function chooseMinerals({ player, npcId, option }) {
  if (npcId !== BELONA) return;
  const value = String(option).toLowerCase();
  if (value.includes("don't want to receive minerals")) setMinerals(player, false);
  else if (value.includes("like to receive minerals")) setMinerals(player, true);
}

/** "mining:success": one roll per ore, in the members' area, while the toggle is on. */
function rollMinerals({ player, itemId, location }) {
  if (!mineralsEnabled(player)) return;
  const chance = MINERAL_CHANCE.get(itemId);
  if (!chance || !inMembersArea(location ?? player.getLocation())) return;
  if (Math.floor(Math.random() * chance) !== 0) return;
  // forceAdd drops what does not fit; a container without it (a test stand-in) takes a plain add.
  const inventory = player.getInventory();
  if (typeof inventory.forceAdd === "function") inventory.forceAdd(player, new core.Item(MINERAL_ITEM, 1));
  else inventory.adds(MINERAL_ITEM, 1);
  player.sendMessage(MINERAL_FOUND);
}

module.exports = {
  name: "MiningGuild",
  description: "Mining Guild entry needs 60 Mining; its members' area gives an invisible +7 Mining level, halves rock respawn times and rolls unidentified minerals.",
  _test: { mineralsEnabled, setMinerals, toggleMinerals, answerMineralCondition, chooseMinerals, rollMinerals, inMembersArea, MINERALS_ATTRIBUTE, MINERAL_ITEM },
  register(api) {
    core = api.core;
    ObstacleRunner.init(api);
    api.persistAttribute(MINERALS_ATTRIBUTE, true);
    api.onCustomEvent("ladders:climb", guardLadder);
    api.onCustomEvent("door:toggle", useDoor);
    api.onCustomEvent("mining:level-boost", boostMining);
    api.onCustomEvent("mining:respawn-ticks", halveRespawn);
    api.onCustomEvent("mining:success", rollMinerals);
    api.onNpcInteraction("Belona", { "Toggle-minerals": toggleMinerals });
    api.onNpcDialogueCondition(answerMineralCondition);
    api.onCustomEvent("npc-dialogue:choice", chooseMinerals);
  },
};
