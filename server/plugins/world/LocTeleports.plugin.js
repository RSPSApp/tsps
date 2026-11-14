/**
 * Ladders, stairs, caves and holes tsps had no working handler for, and trapdoors that open and
 * close, played as live OSRS does (docs/loc-teleports.md):
 * - plugins/world/data/loc-teleports.json: where a loc placement takes the player
 *   (scripts/sync-loc-teleports.cjs writes it from the rsprox capture database);
 * - plugins/world/data/loc-swaps.json: trapdoors and household drawers whose Open/Close swaps the loc
 *   for its other state (and an open drawer's Search, which only answers "The drawers are empty."),
 *   and (`toggles`) per-player multiloc trapdoors whose Open/Close sets the varbit showing the other
 *   state, kept across logins (Evil Dave's cellar trapdoor).
 *
 * - A loc nobody else handles: the generic object hook takes the click when the clicked tile
 *   and option have an entry, or the loc and option have a swap.
 * - A ladder or staircase: Ladders asks other plugins first (ladders:climb), and an entry
 *   answers before Ladders guesses from the map.
 *
 * Gates (an entry's `requires`, decided in plugins/world/data/loc-teleport-sync.json) are checked in
 * order first: a total level, worn items (any one set), an item used on the loc once before (a
 * rope tied to the Elid crevice), a completed quest (`quest`: the Prifddinas gates, Dorgesh-Kaan's doors),
 * a started quest (`questStarted`: the Troll Stronghold's roof ladder),
 * a skill level or a Slayer task (`skill`, `slayerTask`: Araxxor's lair). The first one the player lacks plays its refusal: a
 * game message, a message box, or an NPC's line.
 *
 * A loc whose option asks first (`ask`: "Climb out of the window?") shows the game's question and
 * options; the options that lead on move the player, and a ladder direction the captures never
 * saw goes to Ladders (ladders:climbUp / ladders:climbDown), which finds it on the map.
 *
 * A loc with a warning (`warn`: Cavey Davey at the Mos Le'Harmless cave) plays the captured
 * conversation and its question until the player turns the warning off; its other option
 * (`toggle`: Toggle-warning) asks first, then flips the warning, which is kept across logins.
 *
 * Each plays its captured animation, sound and fade, and moves the player (or swaps the loc) on
 * the captured tick. An entry's `message` (with `messageType` "spam" for the filterable channel)
 * is the game message live OSRS sends on a successful crossing, on the move's tick, before it. Ticks in the data count from the player arriving at the loc; the click is
 * handled on the tick after that, as Ladders' climbs are.
 *
 * Not members-only: free-to-play ladders are in the data too. On a free-to-play world,
 * FreeToPlay moves anyone who ends up in a members area back to free land.
 */
const fs = require("fs");
const path = require("path");

const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
/** Locs a player has used an item on to pass (a rope tied to a crevice), by gameval name. */
const TIED_ATTRIBUTE = "loc-teleports:tied";
/** Warnings a player has turned off (Toggle-warning), by varbit name; the varbit is sent again at login. */
const WARNINGS_OFF_ATTRIBUTE = "loc-teleports:warnings-off";
/** Toggled trapdoor varbits a player has changed, by varbit name -> value; sent again at login. */
const TOGGLED_ATTRIBUTE = "loc-teleports:toggled";
/** The handler runs one tick after the arrival the captured ticks count from. */
const HANDLER_TICK = 1;

let core = null;
let pluginApi = null;
/** "x,y,z:op" -> loc teleport entry. */
let entries = new Map();
/** "id:op" -> trapdoor swap. */
let swaps = new Map();
/** "id:op" -> the varbit toggles of a per-player multiloc trapdoor for that option. */
let toggles = new Map();

const keyOf = (x, y, z, op) => `${x},${y},${z}:${op}`;
/** A captured tick, counted from the click instead of the arrival. */
const fromClick = (tick) => Math.max(0, tick - HANDLER_TICK);

function readDefinitions(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "data", name), "utf8"));
}

function loadEntries() {
  return new Map(readDefinitions("loc-teleports.json").locs.map((entry) => [keyOf(entry.x, entry.y, entry.z, entry.op), entry]));
}

function loadSwaps() {
  return new Map(readDefinitions("loc-swaps.json").swaps.map((swap) => [`${swap.id}:${swap.op}`, swap]));
}

function loadToggles() {
  const byKey = new Map();
  for (const toggle of readDefinitions("loc-swaps.json").toggles ?? []) {
    const key = `${toggle.id}:${toggle.op}`;
    byKey.set(key, [...(byKey.get(key) ?? []), toggle]);
  }
  return byKey;
}

function entryFor(object, clickType) {
  const location = object?.getLocation?.();
  if (!location) return null;
  const entry = entries.get(keyOf(location.getX(), location.getY(), location.getZ(), clickType));
  return entry && entry.id === object.getId() ? entry : null;
}

/** The destination for a player at `at`: the entry's, or its side nearest them (a staircase used from either end). */
function destinationFor(entry, at) {
  if (entry.to) return entry.to;
  let best = null;
  for (const side of entry.sides ?? []) {
    const distance = Math.max(Math.abs(at.getX() - side.from[0]), Math.abs(at.getY() - side.from[1]));
    if (!best || distance < best.distance) best = { distance, to: side.to };
  }
  return best?.to ?? null;
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * Runs `steps` (tick from the click -> actions) one tick at a time, with the player's movement
 * blocked until the last. Steps due on the click's own tick run now. Stops if the player leaves,
 * dies or is moved off their tile before `holdUntil`.
 */
function runSteps(player, steps, holdUntil) {
  const { Task, TaskManager } = core;
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return;
  const start = player.getLocation().clone();
  const privateArea = player.getPrivateArea();
  const last = Math.max(...steps.keys());
  let tick = 0;
  const run = () => {
    for (const step of steps.get(tick) ?? []) step();
  };
  movement.setBlockMovement(true).reset();
  run();
  if (tick >= last) {
    movement.setBlockMovement(false);
    return;
  }
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      // Until the move: the player walked off, or something else moved them into or out of an instance.
      // After it, leaving an instance (Araxxor's lair) is the move itself, and the fade back in still plays.
      const moved = tick <= holdUntil && (!player.getLocation().equals(start) || player.getPrivateArea() !== privateArea);
      if (!player.isRegistered() || player.getHitpoints() <= 0 || moved) {
        this.stop();
        return;
      }
      run();
      if (tick >= last) this.stop();
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
}

function schedule() {
  const steps = new Map();
  const at = (tick, step) => steps.set(tick, [...(steps.get(tick) ?? []), step]);
  return { steps, at };
}

/** The game message of a successful crossing: a plain game message, or spam the chat filter hides. */
function sayCrossed(player, { message, messageType }) {
  if (messageType === "spam") player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, message);
  else player.sendMessage(message);
}

function animateAndSound(player, { anim, sound }) {
  if (anim !== undefined) player.performAnimation(new core.Animation(anim));
  if (sound !== undefined) player.getPacketSender().sendSound(sound, 1, 0);
}

/**
 * A loc teleport: animation and sound (and the fade out) on the animation's tick, the minimap
 * off a tick later, the move, then the fade back in a tick after it and the overlay closed two
 * ticks later.
 */
function travel(player, entry, destination, answer = null) {
  const { steps, at } = schedule();
  // After a question, the captured ticks count from the answer, which is handled on its own tick.
  const animTick = answer ? answer.animTick : fromClick(entry.animTick ?? entry.tick);
  const moveTick = answer ? Math.max(animTick + 1, answer.tick) : Math.max(animTick + 1, fromClick(entry.tick));
  at(animTick, () => {
    animateAndSound(player, entry);
    if (entry.fade) fade(player, true);
    if (entry.mesbox) player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, entry.mesbox)));
  });
  if (entry.fade) at(animTick + 1, () => player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  if (entry.message) at(moveTick, () => sayCrossed(player, entry));
  at(moveTick, () => {
    const landing = new core.Location(destination[0], destination[1], destination[2]);
    player.moveTo(landing);
    if (player.getLocation().equals(landing)) pluginApi.emitCustomEvent("loc-teleports:arrived", {
      player, objectId: entry.id, location: { x: entry.x, y: entry.y, z: entry.z },
    });
  });
  if (entry.fade) {
    at(moveTick + 1, () => {
      player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
      fade(player, false);
    });
    at(moveTick + 3, () => player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  }
  runSteps(player, steps, moveTick);
}

/** Puts `id` in place of the loc, for everyone (the game sends it as a zone update). */
function replaceLoc(object, id) {
  const { GameObject, Location, ObjectManager } = core;
  const location = object.getLocation();
  ObjectManager.deregister(object, true);
  ObjectManager.register(new GameObject(id, new Location(location.getX(), location.getY(), location.getZ()), object.getType(), object.getFace(), null), true);
}

/**
 * A trapdoor's or drawer's Open or Close: the message, the animation and sound, then the swap.
 * A row without `becomes` (an open drawer's Search) only sends its message.
 */
function swapLoc(player, object, swap) {
  const { steps, at } = schedule();
  if (swap.message) at(fromClick(swap.messageTick ?? swap.tick), () => player.sendMessage(swap.message));
  at(fromClick(swap.animTick ?? swap.tick), () => animateAndSound(player, swap));
  const swapTick = fromClick(swap.tick);
  if (swap.becomes != null) at(swapTick, () => {
    // Someone else may have opened or closed it meanwhile.
    if (core.MapObjects.get(swap.id, object.getLocation(), object.getPrivateArea?.() ?? null) === object) replaceLoc(object, swap.becomes);
  });
  runSteps(player, steps, swapTick);
}

function toggled(player) {
  const value = player.getAttribute(TOGGLED_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** The toggle this click plays: the option whose `from` state the player's varbit shows. */
function toggleFor(player, object, clickType) {
  const candidates = object ? toggles.get(`${object.getId()}:${clickType}`) : null;
  if (!candidates) return null;
  return candidates.find((toggle) => {
    const id = varbitId(toggle.varbit);
    return id != null && player.getPacketSender().getVarbit(id) === toggle.from;
  }) ?? null;
}

/** A per-player trapdoor's Open or Close: the animation and sound, and the varbit, kept for the next login. */
function toggleLoc(player, toggle) {
  const { steps, at } = schedule();
  const tick = fromClick(toggle.tick);
  at(fromClick(toggle.animTick ?? toggle.tick), () => animateAndSound(player, toggle));
  at(tick, () => {
    player.getPacketSender().sendVarbit(varbitId(toggle.varbit), toggle.to);
    player.setAttribute(TOGGLED_ATTRIBUTE, { ...toggled(player), [toggle.varbit]: toggle.to });
  });
  runSteps(player, steps, tick);
}

/** The client's copy of the toggled trapdoors, which a login starts without. */
function restoreToggled(player) {
  for (const [name, value] of Object.entries(toggled(player))) {
    const id = varbitId(name);
    if (id != null && Number.isInteger(value)) player.getPacketSender().sendVarbit(id, value);
  }
}

function tied(player) {
  const value = player.getAttribute(TIED_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
}

function meets(player, entry, requirement) {
  if (requirement.totalLevel !== undefined) return player.getSkillManager().getTotalLevel() >= requirement.totalLevel;
  if (requirement.wornAny) return requirement.wornAny.some((set) => set.every((id) => player.getEquipment().contains(id)));
  if (requirement.item !== undefined) return player.getInventory().contains(requirement.item);
  if (requirement.tied !== undefined) return tied(player).includes(entry.name);
  if (requirement.varbit !== undefined) return player.getPacketSender().getVarbit(requirement.varbit) >= (requirement.atLeast ?? 1);
  if (requirement.quest !== undefined) return questComplete(player, requirement.quest);
  if (requirement.questStarted !== undefined) return questStarted(player, requirement.questStarted);
  if (requirement.skill !== undefined) return player.getSkillManager().getCurrentLevel(core.Skill[requirement.skill.toUpperCase()]) >= requirement.atLeast;
  if (requirement.slayerTask !== undefined) return onSlayerTask(player, requirement.slayerTask);
  return true;
}

/** Whether the player's Slayer task is one of `names` (araxyte or spider), as the Slayer plugin answers. */
function onSlayerTask(player, names) {
  const query = { player, task: null };
  pluginApi.emitCustomEvent("slayer:current-task", query);
  const task = String(query.task?.name ?? "").toLowerCase();
  return names.some((name) => task.includes(name));
}

/** A quest the loc needs done (`{ quest: key }`), answered by the quest system. */
function questComplete(player, key) {
  const query = { player, key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", query);
  return query.complete === true;
}

/** A quest the loc needs started (`{ questStarted: key }`), answered by the quest system. */
function questStarted(player, key) {
  const query = { player, key, started: false };
  pluginApi.emitCustomEvent("quest:is-started", query);
  return query.started === true;
}

/** The captured refusal: a game message, a message box, or an NPC's line. */
function refuse(player, { message, mesbox, npc, say }) {
  if (message) player.sendMessage(message);
  if (mesbox) player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, mesbox)));
  if (say) player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.NpcDialogue(0, npc, say)));
}

/** The game's question; each option leads on, hands the climb to Ladders, or just closes. */
function ask(player, object, entry, destination) {
  const start = player.getLocation().clone();
  const location = object.getLocation();
  const choose = (option) => () => {
    if (!player.getLocation().equals(start)) return;
    if (option.go) {
      travel(player, entry, destination, entry.ask.answer ?? { animTick: 0, tick: 1 });
      return;
    }
    if (option.ladder) {
      pluginApi.emitCustomEvent(option.ladder === "up" ? "ladders:climbUp" : "ladders:climbDown", {
        player, object, objectId: object.getId(),
        location: { x: location.getX(), y: location.getY(), z: location.getZ() },
        sourceLocation: { x: start.getX(), y: start.getY(), z: start.getZ() },
      });
    }
  };
  pluginApi.sendMultiChatboxPrompt(player, entry.ask.prompt, ...entry.ask.options.flatMap((option) => [option.text, choose(option)]));
}

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function warningsOff(player) {
  const value = player.getAttribute(WARNINGS_OFF_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
}

/** Whether the player has turned this warning off. */
function warningOff(player, name) {
  return warningsOff(player).includes(name);
}

/** The client's copy of the warnings turned off and the toggled trapdoors, which a login starts without. */
function restoreVarbits({ player }) {
  restoreToggled(player);
  for (const name of warningsOff(player)) {
    const id = varbitId(name);
    if (id != null) player.getPacketSender().sendVarbit(id, 1);
  }
}

/** A loc's warning: the captured conversation, then the question that leads on or closes. */
function warn(player, object, entry, destination) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder();
  const lines = entry.warn.dialogue;
  lines.forEach((line, index) => chain.add(line.npc !== undefined
    ? new NpcDialogue(index, line.npc, line.text, undefined, line.expression)
    : new PlayerDialogue(index, line.text, line.expression)));
  chain.add(new ActionDialogue(lines.length, { execute: () => ask(player, object, { ...entry, ask: entry.warn.ask }, destination) }));
  player.getDialogueManager().startDialogues(chain);
}

/** Toggle-warning: asks, and on Yes turns the warning off, or back on. */
function toggleWarning(player, toggle) {
  const id = varbitId(toggle.varbit);
  if (id == null) return;
  const off = warningOff(player, toggle.varbit);
  const flip = () => {
    const others = warningsOff(player).filter((name) => name !== toggle.varbit);
    player.setAttribute(WARNINGS_OFF_ATTRIBUTE, off ? others : [...others, toggle.varbit]);
    player.getPacketSender().sendVarbit(id, off ? 0 : 1);
  };
  pluginApi.sendMultiChatboxPrompt(player, off ? toggle.enable : toggle.disable, "Yes.", flip, "No.", () => {});
}

/** The first gate the player doesn't pass, or null. */
function failedGate(player, entry) {
  return (entry.requires ?? []).find((requirement) => !meets(player, entry, requirement)) ?? null;
}

/** Plays the entry or swap for this click, if there is one; true when it did. */
function play(player, object, clickType) {
  // A per-player trapdoor's closed Open and open Close; the open state's option 1 is its entry below.
  const toggle = toggleFor(player, object, clickType);
  if (toggle) {
    toggleLoc(player, toggle);
    return true;
  }
  const entry = entryFor(object, clickType);
  if (entry) {
    if (entry.toggle) {
      toggleWarning(player, entry.toggle);
      return true;
    }
    const destination = destinationFor(entry, player.getLocation());
    if (!destination) return false;
    const gate = failedGate(player, entry);
    if (gate) {
      refuse(player, gate.refuse);
      return true;
    }
    if (entry.warn && !warningOff(player, entry.warn.varbit)) {
      warn(player, object, entry, destination);
      return true;
    }
    if (entry.ask) {
      ask(player, object, entry, destination);
      return true;
    }
    travel(player, entry, destination);
    return true;
  }
  const swap = object ? swaps.get(`${object.getId()}:${clickType}`) : null;
  if (!swap) return false;
  swapLoc(player, object, swap);
  return true;
}

/** An item used on a gated loc that wants it (a rope on the Elid crevice): tied once, then down. */
function useItemOnLoc(event) {
  if (event.handled) return;
  const location = event.object?.getLocation?.();
  if (!location) return;
  const entry = [...entries.values()].find((candidate) => candidate.x === location.getX() && candidate.y === location.getY()
    && candidate.z === location.getZ() && candidate.id === event.object.getId()
    && (candidate.requires ?? []).some((requirement) => requirement.tied === event.itemId));
  if (!entry) return;
  const { player } = event;
  if (!tied(player).includes(entry.name)) player.setAttribute(TIED_ATTRIBUTE, [...tied(player), entry.name]);
  event.handled = true;
  play(player, event.object, entry.op);
}

function useLoc(event) {
  if (event.handled) return;
  if (play(event.player, event.object, event.clickType)) event.handled = true;
}

/** Ladders' "does anyone own this ladder?": captured ladders and staircases answer it. */
function claimLadder(request) {
  if (request.handled) return;
  if (play(request.player, request.object, request.clickType)) request.handled = true;
}

/** "loc-teleports:captured" { object, clickType, captured }: whether a captured entry covers this placement. */
function answerCaptured(request) {
  if (request.object) request.captured = entryFor(request.object, request.clickType) != null;
}

/** Route to an explicit threshold when surrounding walls block ordinary loc reach. */
function routeToLoc(event) {
  const approach = entryFor(event.object, event.clickType)?.approach;
  if (!event.destination && approach) event.destination = { x: approach[0], y: approach[1], z: approach[2] };
}

/** Let a captured portal keep its transition semantics instead of swinging it as a local door. */
function claimDoorToggle(request) {
  if (request.handled) return;
  if (play(request.player, request.object, request.clickType)) request.handled = true;
}

module.exports = {
  name: "LocTeleports",
  description: "Handles ladders, stairs, caves and holes with no other handler from captured data, plus opening and closing trapdoors and household drawers, with level, item and quest gates.",
  _test: { entryFor, destinationFor, play, useItemOnLoc, claimDoorToggle, get entries() { return entries; }, get swaps() { return swaps; }, get toggles() { return toggles; }, TOGGLED_ATTRIBUTE },
  register(api) {
    core = api.core;
    pluginApi = api;
    entries = loadEntries();
    swaps = loadSwaps();
    toggles = loadToggles();
    api.persistAttribute(TIED_ATTRIBUTE);
    api.persistAttribute(WARNINGS_OFF_ATTRIBUTE);
    api.persistAttribute(TOGGLED_ATTRIBUTE);
    api.onPlayerLogin(restoreVarbits);
    api.onObjectInteraction(useLoc);
    api.onObjectRoute(routeToLoc);
    api.onItemOnObject(useItemOnLoc);
    api.onCustomEvent("ladders:climb", claimLadder);
    api.onCustomEvent("loc-teleports:captured", answerCaptured);
    api.onCustomEvent("door:toggle", claimDoorToggle);
  },
};
