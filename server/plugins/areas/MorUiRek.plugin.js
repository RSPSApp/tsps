/**
 * Mor Ul Rek (TzHaar city) area interactions.
 *
 * Cave exit at 2479,5176 > Enter: back into the Karamja volcano dungeon at 2862,9572, beside its
 * cave entrance (rsprox captures, the move on the tick). The rocks up to the surface are
 * Karamja's.
 *
 * Hot vent doors > Pass: the player steps through to the far side in one 2-tile step, as a walk
 * or run (rsprox 224/01437, 235/03870-03891, 236/03958: (2436,5121) -> (2436,5119) through the
 * door at (2436,5120)). The city's music follows from the area as usual.
 */
const CAVE_EXIT_POSITION = { x: 2479, y: 5176, z: 0 };
const VOLCANO_DUNGEON_LANDING = [2862, 9572, 0];

const ACCESS_ATTRIBUTE = "mor-ul-rek:access";
/** The Inferno's completion count (Run.Inferno's ATTR_COMPLETIONS): TzKal-Zuk beaten at least once. */
const INFERNO_COMPLETIONS_ATTRIBUTE = "inferno:completions";
/**
 * The Wiki transcripts' blank for the player's TzHaar name ("Can I help you [TzHaar caste]-[player
 * name]?"), sometimes written after "JalYt-" or before "-Xo" too. Live fills it with the whole name
 * ("You need help JalYt-Mej-Z-Kris?", rsprox_transcripts/227/00073.txt; "JalYt-Mej-Xo-..." once into
 * the inner core, 227/01749.txt). A Fight Pit champion's caste is not the player's: left alone.
 */
const CASTE_PLACEHOLDER = /(?:JalYt-(?:Hur-)?)?\[TzHaar caste\](?:-Xo)?(?!-\[champion's name\])/g;
const CASTE_CONDITION = /^if the player's caste is jalyt-(mej|ket|xil|hur):?$/;
const CAPE_SHOWN_STEP = "2-PLAV";
const CAPE_BRANCH_ID = "qovHJi";
const GUARD_PAGE = "TzHaar-Ket";
const GUARD_VARIANT = "standard-dialogue";
const { startTranscript } = require("../quests/QuestRuntime");
const Names = require("./moruirek/Names.MorUiRek");
const SHOW_CAPE_MESSAGE = "You hold out your fire cape and show it to TzHaar-Ket.";

// The side facing the outer city: north on the three horizontal crossings, west on the other two.
const ENTRY_SIDE_BY_DOOR = new Map([
  ["2436,5120", 1], ["2457,5119", 1], ["2474,5137", 1],
  ["2494,5174", -1], ["2495,5157", -1],
]);

const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const PASS_TICKS = 2;

/** Each player's latest pass, which alone may end the clipping exemption. */
const passes = new WeakMap();

let core;
let pluginApi;

function hasAccess(player) {
  return player.getAttribute(ACCESS_ATTRIBUTE) === true;
}

/** "JalYt-Mej", "JalYt-Mej-Xo" or "JalYt-Mej-Kal" (Names.MorUiRek). */
function tzhaarTitle(player) {
  return Names.title(player, core.Skill, {
    innerCore: hasAccess(player),
    beatenZuk: (Number(player.getAttribute(INFERNO_COMPLETIONS_ATTRIBUTE)) || 0) > 0,
  });
}

function fillTzhaarTitle(request) {
  if (typeof request.text !== "string" || !request.text.includes("[TzHaar caste]")) return;
  const title = tzhaarTitle(request.player);
  request.text = request.text.replace(CASTE_PLACEHOLDER, title);
}

/** "If the player's caste is JalYt-Ket:": the TzHaar dialogues' branch for each caste. */
function casteCondition({ player, text }) {
  const match = CASTE_CONDITION.exec(String(text).trim().toLowerCase());
  if (!match) return null;
  return Names.caste(player, core.Skill).toLowerCase() === match[1];
}

function grantAccess({ player }) {
  player.setAttribute(ACCESS_ATTRIBUTE, true);
}

function isGuard(npcId) {
  const { TZHAAR_KET_8, TZHAAR_KET_9 } = core.NpcIdentifiers;
  return npcId === TZHAAR_KET_8 || npcId === TZHAAR_KET_9;
}

function fireCapes() {
  const { FIRE_CAPE, FIRE_MAX_CAPE, FIRE_CAPE_L_, FIRE_MAX_CAPE_L_ } = core.ItemIdentifiers;
  return [FIRE_CAPE, FIRE_MAX_CAPE, FIRE_CAPE_L_, FIRE_MAX_CAPE_L_];
}

function hasFireCape(player) {
  const worn = player.getEquipment().get(core.Equipment.CAPE_SLOT)?.getId();
  return fireCapes().some((id) => id === worn || player.getInventory().contains(id));
}

function guardCondition({ player, npcId, definition, text }) {
  if (definition?.getName() !== "TzHaar-Ket") return null;
  const condition = text.toLowerCase();
  if (condition.includes("has a firecape with them")) return isGuard(npcId) && hasFireCape(player);
  if (condition.includes("has access to mor ul rek")) return hasAccess(player);
  if (condition.includes("does not have access to mor ul rek")) return !hasAccess(player);
  return null;
}

function showCapeInDialogue(event) {
  if (event.kind !== "message" || event.stepId !== CAPE_SHOWN_STEP || !isGuard(event.npcId)) return;
  if (!hasFireCape(event.player)) {
    event.end = true;
    return;
  }
  grantAccess(event);
}

/**
 * A fire cape used on the guard plays the same exchange as choosing to show it in his dialogue:
 * the player's line, "You hold out your fire cape and show it to TzHaar-Ket." in a box (its step
 * grants access, showCapeInDialogue) and his two replies (rsprox 234/03276 tick 25553, 237/01141,
 * 227/00083: the item use opens that conversation, not a chat line).
 */
function useCapeOnGuard(event) {
  if (!isGuard(event.npcId) || !fireCapes().includes(event.itemId)) return;
  event.handled = true;
  if (!event.player.getInventory().contains(event.itemId)) return;
  const shown = startTranscript(pluginApi, event.player, event.npcId, GUARD_PAGE, GUARD_VARIANT, capeBranch, event.npc ?? null);
  if (!shown) {
    grantAccess(event);
    event.player.sendMessage(SHOW_CAPE_MESSAGE);
  }
}

/** The standard dialogue's "I managed to defeat TzTok-Jad and obtain this firecape." option's steps. */
function capeBranch(steps) {
  const find = (node) => {
    if (Array.isArray(node)) { for (const v of node) { const r = find(v); if (r) return r; } return null; }
    if (!node || typeof node !== "object") return null;
    if (node.id === CAPE_BRANCH_ID && Array.isArray(node.steps)) return node.steps;
    for (const v of Object.values(node)) { const r = find(v); if (r) return r; }
    return null;
  };
  return find(steps) ?? [];
}

/** Rotation 0 and 2 doors are passed north-south, 1 and 3 east-west (the cache's placements). */
function passVentDoor({ player, object }) {
  const door = object.getLocation();
  const at = player.getLocation();
  const northSouth = object.getFace() % 2 === 0;
  const beside = (offset) => northSouth
    ? new core.Location(door.getX(), door.getY() + offset, door.getZ())
    : new core.Location(door.getX() + offset, door.getY(), door.getZ());
  // Clicked again while on the door tile itself: carry on to the side that pass was heading for.
  const entrySide = ENTRY_SIDE_BY_DOOR.get(`${door.getX()},${door.getY()}`);
  const previous = passes.get(player);
  const onDoor = at.getX() === door.getX() && at.getY() === door.getY();
  const side = onDoor && previous ? -previous.towards
    : Math.sign(northSouth ? at.getY() - door.getY() : at.getX() - door.getX()) || entrySide || 1;
  const movement = player.getMovementQueue();
  movement.reset();
  if (side === entrySide && !hasAccess(player)) {
    player.sendMessage("You need to show a fire cape to a TzHaar-Ket guard before entering the inner city.");
    return true;
  }
  const near = beside(side);
  const far = beside(-side);
  // The door blocks its own tile: the steps go straight through it, then clipping is back. Only the
  // latest pass clears the flag, so a second click doesn't lose it to the first one's cleanup. Steps,
  // not a teleport, so a diagonal arrival walks round to the door (a move would drop the queued step).
  player.setFlag(IGNORE_CLIPPING_FLAG, true);
  if (!onDoor && !at.equals(near)) movement.addSteps(near);
  movement.addSteps(far);
  const pass = { towards: -side };
  passes.set(player, pass);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(PASS_TICKS, player, false); }
    execute() { this.stop(); }
    stop() {
      if (passes.get(player) === pass) {
        passes.delete(player);
        player.removeFlag(IGNORE_CLIPPING_FLAG);
      }
      super.stop();
    }
  })());
  return true;
}

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

function exitToVolcano(event) {
  const { player, location } = event;
  if (!isAt(location, CAVE_EXIT_POSITION)) return false;
  player.moveTo(new core.Location(...VOLCANO_DUNGEON_LANDING));
  event.handled = true;
}

module.exports = {
  name: "MorUiRek",
  description: "Mor Ul Rek (the TzHaar city): its cave exit back to the Karamja volcano and its hot vent doors.",
  members: true,
  passVentDoor,
  fillTzhaarTitle,
  casteCondition,
  register(api) {
    core = api.core;
    pluginApi = api;
    api.persistAttribute(ACCESS_ATTRIBUTE, false);
    api.onNpcDialogueCondition(guardCondition);
    api.onNpcDialogueCondition(casteCondition);
    api.onCustomEvent("npc-dialogue:line", fillTzhaarTitle);
    api.onItemOnNpc(useCapeOnGuard);
    api.onCustomEvent("npc-dialogue:action", showCapeInDialogue);
    api.onCustomEvent("mor-ul-rek:grant-access", grantAccess);
    api.onObjectInteraction("Cave exit", { Enter: exitToVolcano });
    api.onObjectInteraction("Hot vent door", { Pass: passVentDoor });
  },
};
