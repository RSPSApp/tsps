/** Mining Guild entry needs 60 current Mining (boosts count); leaving is unrestricted.
 * https://oldschool.runescape.wiki/w/Mining_Guild
 *
 * The members' area (behind the two inner doors) gives an invisible +7 Mining level to the success
 * rolls and empties rocks for half as long: iron 5.4 s -> 2.4 s, adamantite 4 -> 2 minutes, runite
 * 12 -> 6 minutes (Wiki rock pages). Amethyst keeps its own 75 seconds (Wiki Amethyst crystals).
 * Docs: docs/mining.md.
 */

const REQUIRED_LEVEL = 60;
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
/**
 * Belona's "Can you combine my mining gloves?" (https://oldschool.runescape.wiki/w/Expert_mining_gloves,
 * https://oldschool.runescape.wiki/w/Belona): Mining gloves and Superior mining gloves, for a fee of 40
 * unidentified minerals, become Expert mining gloves. The transcript guards the hand-over with prose
 * conditions and a "receive" action, answered here. Ours: only unnoted gloves in the inventory count
 * (her line asks the player to bring them; no source covers worn gloves). No capture covers it.
 */
const MINING_GLOVES = 21343;
const SUPERIOR_MINING_GLOVES = 21345;
const EXPERT_MINING_GLOVES = 21392;
const COMBINE_FEE = 40;
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
  const { DialogueChainBuilder, StatementDialogue } = core;
  const text = `You need a Mining level of ${REQUIRED_LEVEL} to access the Mining Guild.`;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  return false;
}

function guardLadder(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.LADDER_354) return;
  if (!canEnter(request.player)) request.handled = true;
}

/**
 * The guild doors' Mining level and members checks. Doors.plugin.js opens the door for everyone in
 * view (its PASS_THROUGH_GATES entry, RSProx 3241 and 3131) when this leaves the request unhandled.
 */
function useDoor(request) {
  if (request.handled) return;
  const { DOOR_562, DOOR_563, DOOR_564 } = core.ObjectIdentifiers;
  if (![DOOR_562, DOOR_563, DOOR_564].includes(request.objectId)) return;
  const { player, object } = request;
  // All three cache doors are north-facing walls: the guild side is the door's own tile.
  const entering = player.getLocation().getY() > object.getLocation().getY();
  if (!entering) return;
  if (!canEnter(player)) {
    request.handled = true;
    return;
  }
  if (request.objectId !== DOOR_562 && !core.WorldDefinition.isMembersWorld()) {
    request.handled = true;
    player.sendMessage("You need to be on a members' world to enter this part of the Mining Guild.");
  }
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

function hasGloves(player) {
  const inventory = player.getInventory();
  return inventory.contains(MINING_GLOVES) && inventory.contains(SUPERIOR_MINING_GLOVES);
}

function hasFee(player) {
  return player.getInventory().getAmount(MINERAL_ITEM) >= COMBINE_FEE;
}

/** Belona's dialogue branches are guarded by wiki prose; answer them from the toggle and the inventory. */
function answerMineralCondition({ npcId, player, text }) {
  if (npcId !== BELONA) return null;
  const value = String(text).toLowerCase();
  if (value.includes("currently receiving unidentified minerals")) return mineralsEnabled(player);
  if (value.includes("currently not receiving unidentified minerals")) return !mineralsEnabled(player);
  // The three combine branches, in the transcript's order: no gloves, too few minerals, everything.
  if (value.includes("does not have all the items needed to create expert mining gloves")) return !hasGloves(player);
  if (value.includes("does not enough unidentified minerals")) return hasGloves(player) && !hasFee(player);
  if (value.includes("has all the items needed to create expert mining gloves")) return hasGloves(player) && hasFee(player);
  return null;
}

/** The "receive" step of the combine branch: both pairs and the fee become Expert mining gloves. */
function combineGloves(event) {
  const { player, npcId, action, text } = event;
  if (npcId !== BELONA || action !== "receive" || !/expert mining gloves/i.test(String(text ?? ""))) return;
  event.handled = true;
  // Checked again: the inventory may have changed since the condition was answered.
  if (!hasGloves(player) || !hasFee(player)) {
    event.end = true;
    return;
  }
  const inventory = player.getInventory();
  inventory.delete(MINING_GLOVES, 1);
  inventory.delete(SUPERIOR_MINING_GLOVES, 1);
  inventory.delete(MINERAL_ITEM, COMBINE_FEE);
  inventory.adds(EXPERT_MINING_GLOVES, 1);
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
  description: "Mining Guild entry needs 60 Mining; its members' area gives an invisible +7 Mining level, halves rock respawn times and rolls unidentified minerals; Belona combines mining gloves into Expert mining gloves.",
  _test: { mineralsEnabled, setMinerals, toggleMinerals, answerMineralCondition, chooseMinerals, combineGloves, rollMinerals, inMembersArea, MINERALS_ATTRIBUTE, MINERAL_ITEM },
  register(api) {
    core = api.core;
    api.persistAttribute(MINERALS_ATTRIBUTE, true);
    api.onCustomEvent("ladders:climb", guardLadder);
    api.onCustomEvent("door:toggle", useDoor);
    api.onCustomEvent("mining:level-boost", boostMining);
    api.onCustomEvent("mining:respawn-ticks", halveRespawn);
    api.onCustomEvent("mining:success", rollMinerals);
    api.onNpcInteraction("Belona", { "Toggle-minerals": toggleMinerals });
    api.onNpcDialogueCondition(answerMineralCondition);
    api.onCustomEvent("npc-dialogue:choice", chooseMinerals);
    api.onCustomEvent("npc-dialogue:action", combineGloves);
  },
};
