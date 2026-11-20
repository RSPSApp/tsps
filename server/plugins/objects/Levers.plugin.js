/**
 * The Wilderness teleport levers (docs/wilderness-levers.md): the Edgeville and East Ardougne
 * levers into the Deserted Keep, the Keep's lever out (East Ardougne, or Edgeville after the easy
 * Wilderness Diary), and the Mage Arena bank's pair. As rsprox captures show them: the player pulls (macro_lever_switch_down)
 * with "You pull the lever...", the lever clicks and drops to its down loc a tick later, the standard
 * teleport is cast a tick after that, and the player lands three ticks later with the lever's own
 * line as the lever goes back up. The player pulls from the lever's own tile (a straight wall
 * decoration's reach), facing the wall it is mounted on.
 *
 * Other plugins teleport through it without a lever's pull:
 *   api.emitCustomEvent("lever:teleport", { player, destination, onArrival? })
 * `onArrival` runs when the player has landed. Given the pulled lever loc as `object` (and its
 * down loc's gameval as `down`, ikov_leverdown by default), it plays the captured pull instead, with
 * the lever's own lines: `message` on the pull and `landed` on landing, each a string or
 * `{ spam }` (none when not given; docs/king-black-dragon.md).
 */
const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

// "Yes, and don't show this warning again." on the levers' warning.
const SKIP_WARNING_ATTRIBUTE = "levers:skip-wilderness-warning";
/** All Settings > Warnings: "Show warning on Wilderness teleport levers", the warning's own "don't ask again". */
const SKIP_WARNING_SETTING = 253;

const PULL_MESSAGE = "You pull the lever...";
const WARNING =
  "<col=7f0000>Warning!</col> The lever will teleport you deep into the <col=7f0000>Wilderness</col>.";
const WARNING_TITLE = "Are you sure you wish to pull it?";
const WARNING_OPTIONS = [
  "Yes, I'm brave.",
  "Eeep! The Wilderness... No thank you.",
  "Yes, and don't show this warning again.",
];

const INTO_WILDERNESS = "... and teleport into the Wilderness.";
const OUT_OF_WILDERNESS = "... and teleport out of the Wilderness.";

// Landing tiles from the captures, except two no recording shows: the Keep lever's Edgeville
// option (the tile this server always used, the Edgeville lever's) and the East Ardougne lever,
// which the Wiki only says lands by the Keep lever (the tile the Edgeville lever lands on).
const DESERTED_KEEP = [3154, 3924];
// The easy Ardougne Diary's "Use the Ardougne Lever to teleport to the Wilderness."
const ARDOUGNE_LEVER_TASK = { diary: "ardougne", task: "use-the-ardougne-lever-to-teleport-to-the-wilder" };
// The easy Wilderness Diary's "Enter the Wilderness from the Ardougne or Edgeville lever." Counted on
// landing; no recording shows the completion, so the moment is the journal text read plainly.
const WILDERNESS_LEVER_TASK = { diary: "wilderness", task: "enter-the-wilderness-from-the-ardougne-or-edgevi" };
const EAST_ARDOUGNE = [2562, 3311];
const EDGEVILLE = [3090, 3475];

// The lever's down loc: the same Lever models (2108 up, 2077 down) for all of them. Captured for
// the Edgeville and Keep levers (ikov_leverdown, 224/01444.txt) and the Mage Arena bank pair
// (magearena_lever_down, 233/00454.txt); the East Ardougne lever, with no recording, is given
// the Edgeville lever's.
const WILDERNESS_LEVER_DOWN = "ikov_leverdown";
const MAGE_BANK_LEVER_DOWN = "magearena_lever_down";

/** By loc gameval: its down loc, where each option goes, and the line on landing. */
const LEVERS = Object.freeze({
  edgeville_wildy_lever: {
    down: WILDERNESS_LEVER_DOWN,
    warn: true,
    Pull: { to: DESERTED_KEEP, landed: INTO_WILDERNESS, intoKeep: true, diaryTasks: [WILDERNESS_LEVER_TASK] },
  },
  // Wiki, Lever (Ardougne). Its warning is assumed to be the Edgeville lever's.
  wildinlever: {
    down: WILDERNESS_LEVER_DOWN,
    warn: true,
    Pull: { to: DESERTED_KEEP, landed: INTO_WILDERNESS, intoKeep: true, diaryTasks: [ARDOUGNE_LEVER_TASK, WILDERNESS_LEVER_TASK] },
  },
  // The Keep's multiloc: "Pull" until the easy Wilderness Diary, then "Ardougne" and "Edgeville".
  wildoutlever: {
    down: WILDERNESS_LEVER_DOWN,
    Pull: { to: EAST_ARDOUGNE, landed: OUT_OF_WILDERNESS },
    Ardougne: { to: EAST_ARDOUGNE, landed: OUT_OF_WILDERNESS },
    Edgeville: { to: EDGEVILLE, landed: OUT_OF_WILDERNESS },
  },
  magearena_lever_to_cellar: { down: MAGE_BANK_LEVER_DOWN, Pull: { to: [2539, 4712], landed: "... and teleport into the mage's cave." } },
  magearena_lever_from_cellar: { down: MAGE_BANK_LEVER_DOWN, Pull: { to: [3090, 3956], landed: "... and teleport out of the mage's cave." } },
});

let api = null;
let core = null;
let leverIds = null;
let ids = null;

/** The levers by loc id, and the ids the sequence uses, resolved from gamevals on first use. */
function resolve() {
  if (leverIds) return;
  const cache = core.CacheDefinitions;
  const need = (id, name) => {
    if (!Number.isInteger(id)) throw new Error(`[Levers] unknown gameval ${name}`);
    return id;
  };
  leverIds = new Map(Object.entries(LEVERS).map(([name, lever]) => [
    need(cache.getLocId(name), name),
    { ...lever, downId: need(cache.getLocId(lever.down), lever.down) },
  ]));
  ids = {
    pull: need(cache.getSeqId("macro_lever_switch_down"), "macro_lever_switch_down"),
    cast: need(cache.getSeqId("human_castteleport"), "human_castteleport"),
    castGfx: need(cache.getSpotanimId("teleport_casting"), "teleport_casting"),
    busy: need(cache.getVarbitId("busy"), "busy"),
    skipWarning: need(cache.getVarbitId("wilderness_lever_blockwarning_standard"), "wilderness_lever_blockwarning_standard"),
    // The Keep lever's multiloc: 0 "Pull", 1 Ardougne first, 2 Edgeville first.
    keepLever: need(cache.getVarbitId("wildoutlever_vis"), "wildoutlever_vis"),
    // All Settings "Deep Wilderness lever default option": 1 puts Edgeville first.
    edgevilleFirst: need(cache.getVarbitId("wilderness_lever_first_op"), "wilderness_lever_first_op"),
  };
}

// Sounds as captured: the lever's click, then the standard teleport's cast.
const LEVER_SOUND = 2400;
const CAST_SOUND = 200;
// The lever is down from a tick after the pull until the landing, four ticks (224/01487.txt,
// 224/01506.txt, 226/01630.txt, 233/00454.txt: down, then back up four ticks later).
const LEVER_DOWN_TICKS = 4;

/** The private area whose locs the player sees, or null for the main world (as ObjectManager's). */
function viewedArea(player) {
  const area = player.getPrivateArea?.() ?? null;
  return area && !area.countsAsMainWorld?.() ? area : null;
}

/**
 * Swaps the pulled lever for its down loc, for everyone who sees it, and puts it back up after
 * LEVER_DOWN_TICKS whether or not the pull completes (the down loc has no options). A main-world
 * lever pulled from inside a private area (an Echo King Black Dragon's lair) is flipped there, as
 * a copy of the lever in that area: the area is sent nothing of the main world's locs, and the main
 * world's lever stays up for everyone outside.
 */
function lowerLever(player, object, downId) {
  const location = object.getLocation();
  const area = object.getPrivateArea?.() ?? viewedArea(player);
  const at = () => new core.Location(location.getX(), location.getY(), location.getZ());
  const down = new core.GameObject(downId, at(), object.getType(), object.getFace(), area);
  if (object.getPrivateArea?.() || !area) {
    api.getTaskManager().submit(new core.TimedObjectReplacementTask(object, down, LEVER_DOWN_TICKS, true));
    return;
  }
  // A private loc joins its area when it is made, so the lever's copy is made when it goes back up.
  let ticks = 0;
  core.ObjectManager.register(down, true);
  api.getTaskManager().submit(new (class extends core.Task {
    constructor() { super(1, false); }
    execute() {
      if (++ticks < LEVER_DOWN_TICKS) return;
      // The area went (its player left by this very pull): its locs went with it.
      if (!area.isDestroyed?.()) {
        const lever = new core.GameObject(object.getId(), at(), object.getType(), object.getFace(), area);
        core.ObjectManager.replaceInPlace(down, lever);
      }
      this.stop();
    }
  })());
}

/**
 * The pull holds the player as a teleport does (TeleportHandler.teleport): their fight stops, and
 * from the pull until the landing nothing can attack them and they attack nothing, auto-retaliate
 * included. The captures show varbit busy set for that whole time.
 */
function hold(player) {
  core.TeleportHandler.onTeleporting(player);
  player.setUntargetable(true);
  player.setTeleporting(true);
}

function release(player) {
  player.setUntargetable(false);
  player.setTeleporting(false);
}

/**
 * As captured: the pull (with varbit busy, rev 238) a tick after the lever is used or the warning
 * answered, the lever's sound and its down loc a tick later, the cast on the next, and the landing
 * three ticks after the cast, as the lever goes back up.
 */
function pullSteps(lever, destination, onLanding, { message = PULL_MESSAGE } = {}) {
  return [
    { wait: 1 },
    { run: ({ player }) => hold(player) },
    { anim: ids.pull },
    message && { msg: message },
    { varbit: [ids.busy, 1] },
    { wait: 1 },
    { run: ({ player, object }) => lowerLever(player, object, lever.downId) },
    { sound: LEVER_SOUND },
    { wait: 1 },
    { anim: ids.cast },
    { gfx: ids.castGfx, height: 92 },
    { sound: CAST_SOUND },
    { wait: 3 },
    { tele: [destination.to[0], destination.to[1], destination.to[2] ?? 0] },
    destination.landed && { msg: destination.landed },
    { varbit: [ids.busy, 0] },
    { run: ({ player }) => release(player) },
    { run: onLanding },
  ].filter(Boolean);
}

function hasEasyWildernessDiary(player) {
  const request = { player, diary: "wilderness", tier: "easy", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/**
 * Landing in the Keep sets its lever's look: "Pull" without the easy Wilderness Diary, Ardougne and
 * Edgeville with it (wildoutlever_vis 1 on landing in recording 1444; 4155's player, who had put
 * Edgeville first, got 2).
 */
function landedInKeep(player) {
  if (!hasEasyWildernessDiary(player)) return;
  const sender = player.getPacketSender();
  sender.sendVarbit(ids.keepLever, sender.getVarbit(ids.edgevilleFirst) === 1 ? 2 : 1);
}

function landed(player, destination) {
  if (destination.intoKeep) landedInKeep(player);
  for (const task of destination.diaryTasks ?? []) api.emitCustomEvent("diary:task", { player, ...task });
}

function pull(player, object, lever, destination, onLanding = () => landed(player, destination), options = {}) {
  // Someone else's pull has it down (a walk to it or a warning answered meanwhile): the down loc
  // has no options, so nothing happens.
  if (!core.MapObjects.exists(object)) return;
  const to = new core.Location(destination.to[0], destination.to[1], destination.to[2] ?? 0);
  if (!core.TeleportHandler.checkReqs(player, to, Infinity)) return;
  ObstacleRunner.run({ player, object }, pullSteps(lever, destination, onLanding, options), {
    // A pull cut short (death, logout) never reaches the landing step's busy 0 and release.
    onFinish: (completed) => {
      if (completed) return;
      player.getPacketSender().sendVarbit(ids.busy, 0);
      release(player);
    },
  });
}

function skipsWarning(player) {
  return player.getAttribute(SKIP_WARNING_ATTRIBUTE) === true;
}

function setSkipWarning(player, skip) {
  resolve();
  player.setAttribute(SKIP_WARNING_ATTRIBUTE, skip);
  player.getPacketSender().sendVarbit(ids.skipWarning, skip ? 1 : 0);
}

function skipWarningSettingClicked(request) {
  if (request.settingId !== SKIP_WARNING_SETTING) return;
  request.handled = true;
  setSkipWarning(request.player, !skipsWarning(request.player));
}

/** The captured warning: a message box, then the three choices. */
function warn(player, object, lever, destination) {
  const { DialogueChainBuilder, StatementDialogue, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, WARNING),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 3) setSkipWarning(player, true);
        if (Number(option) === 1 || Number(option) === 3) pull(player, object, lever, destination);
      },
    }, ...WARNING_OPTIONS).setTitle(WARNING_TITLE),
  ));
}

/** Any option on a teleport lever, by its cache name; false for every other lever. */
function useLever(event) {
  resolve();
  const lever = leverIds.get(event.objectId);
  const destination = lever?.[event.definition?.getInteractions()?.[event.clickType - 1]];
  if (!destination) return false;
  const { player, object } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  if (lever.warn && !skipsWarning(player)) warn(player, object, lever, destination);
  else pull(player, object, lever, destination);
  return true;
}

function sendSkipWarning({ player }) {
  resolve();
  if (skipsWarning(player)) player.getPacketSender().sendVarbit(ids.skipWarning, 1);
}

function initialize(pluginApi) {
  api = pluginApi;
  core = api.core;
  ObstacleRunner.init(api);
}

/**
 * A plugin's own lever (the King Black Dragon's): the captured pull and its lever's down loc, then the
 * teleport, with the lines its owner gives (the KBD entrance lever's, rsprox_transcripts/242/900155.txt).
 */
function pullOwnLever({ player, destination, onArrival, object, down, message = null, landed = null }) {
  resolve();
  if (ObstacleRunner.isBusy(player)) return;
  const downName = down ?? WILDERNESS_LEVER_DOWN;
  const downId = core.CacheDefinitions.getLocId(downName);
  if (!Number.isInteger(downId)) throw new Error(`[Levers] unknown gameval ${downName}`);
  const to = [destination.getX(), destination.getY(), destination.getZ()];
  pull(player, object, { downId }, { to, landed }, () => onArrival?.(), { message });
}

function teleport(event) {
  if (event.object) return pullOwnLever(event);
  const { player, destination, onArrival } = event;
  if (core.TeleportHandler.checkReqs(player, destination, Infinity)) {
    core.TeleportHandler.teleport(player, destination.clone(), core.TeleportType.NORMAL, false, onArrival);
  }
}

module.exports = {
  name: "Levers",
  description: "The Wilderness teleport levers (Edgeville, East Ardougne, the Deserted Keep and Mage Arena bank), with the Wilderness warning and a shared lever teleport event that can also pull another plugin's lever.",
  register(pluginApi) {
    initialize(pluginApi);
    api.persistAttribute(SKIP_WARNING_ATTRIBUTE, false);
    api.onObjectInteraction("Lever", { Pull: useLever, Ardougne: useLever, Edgeville: useLever });
    api.onPlayerLogin(sendSkipWarning);
    api.onCustomEvent("settings:setting-clicked", skipWarningSettingClicked);
    api.onCustomEvent("lever:teleport", teleport);
  },
};
