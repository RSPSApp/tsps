/**
 * What the Ectofuntus units share: the bones and bonemeal (plugins/skills/data/bones.json), the
 * saved state with the varbits that show it, and a keyed step runner a click cancels.
 */
const DATA = require("../data/bones.json");

const TOKENS_ATTRIBUTE = "ectofuntus:tokens";
const GRINDER_STATUS_ATTRIBUTE = "ectofuntus:grinder-status";
const GRINDER_BONE_ATTRIBUTE = "ectofuntus:grinder-bone";

/** ahoy_grinder_status: 0 empty, 1 bones in the hopper, 2 crushed bones in the bin. */
const GRINDER_EMPTY = 0;
const GRINDER_HOPPER = 1;
const GRINDER_BIN = 2;

let api = null;
let core = null;
let bonesById = null;
let bonemealById = null;

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
}

function gameval(kind, name) {
  const { CacheDefinitions } = core;
  const id = kind === "obj" ? CacheDefinitions.getObjId(name)
    : kind === "seq" ? CacheDefinitions.getSeqId(name)
      : kind === "spotanim" ? CacheDefinitions.getSpotanimId(name)
        : CacheDefinitions.getVarbitId(name);
  if (!Number.isInteger(id)) throw new Error(`[Ectofuntus] unknown ${kind} gameval ${name}`);
  return id;
}

function index() {
  if (bonesById) return;
  bonesById = new Map();
  bonemealById = new Map();
  for (const row of DATA.bonemeal) bonemealById.set(gameval("obj", row.obj), row);
  for (const row of DATA.bones) {
    if (!row.groundOnly) bonesById.set(gameval("obj", row.obj), gameval("obj", row.bonemeal));
  }
}

/** The bonemeal pot a bone grinds into, or null. */
function bonemealFor(boneId) {
  index();
  return bonesById.get(boneId) ?? null;
}

/** A bonemeal pot's worship row ({ xp, level }), or null. */
function worshipFor(bonemealId) {
  index();
  return bonemealById.get(bonemealId) ?? null;
}

/** "big bones": how the grinder's messages name a bone. */
const boneName = (boneId) => core.ItemDefinition.forId(boneId).getName().toLowerCase();

const number = (player, key) => Number(player.getAttribute(key)) || 0;

const tokens = (player) => number(player, TOKENS_ATTRIBUTE);
const grinderStatus = (player) => number(player, GRINDER_STATUS_ATTRIBUTE);
const grinderBone = (player) => number(player, GRINDER_BONE_ATTRIBUTE);

/**
 * The unclaimed tokens show in ahoy_ectotokens_base (6 bits) and ahoy_ectotokens_more (2 bits),
 * from the time the disciples held 65 at most; the Wiki's cap is 1000 now, so they show up to 255.
 */
function sendTokens(player) {
  const shown = Math.min(tokens(player), 255);
  const sender = player.getPacketSender();
  sender.sendVarbit(gameval("varbit", "ahoy_ectotokens_base"), shown & 63);
  sender.sendVarbit(gameval("varbit", "ahoy_ectotokens_more"), shown >> 6);
}

function setTokens(player, count) {
  player.setAttribute(TOKENS_ATTRIBUTE, count);
  sendTokens(player);
}

function sendGrinder(player) {
  player.getPacketSender().sendVarbit(gameval("varbit", "ahoy_grinder_status"), grinderStatus(player));
}

function setGrinder(player, status, boneId) {
  player.setAttribute(GRINDER_STATUS_ATTRIBUTE, status);
  player.setAttribute(GRINDER_BONE_ATTRIBUTE, status === GRINDER_EMPTY ? 0 : boneId);
  sendGrinder(player);
}

function restore({ player }) {
  sendTokens(player);
  sendGrinder(player);
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function mesbox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, text)));
}

function animate(player, seq, delay = 0) {
  player.performAnimation(new core.Animation(gameval("seq", seq), delay));
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

/** Puts `toId` in `fromId`'s slot, as the server swaps a used bucket or pot in place. */
function swap(player, fromId, toId) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(fromId);
  if (slot < 0) return false;
  inventory.setItem(slot, new core.Item(toId, 1)).refreshItems();
  return true;
}

/**
 * Runs `step(tick)` every tick from the next one, as a task keyed to the player so a walk or a
 * click cancels it. `step` returns false to stop.
 */
function run(player, step) {
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || step(++tick) === false) this.stop();
    }
  })());
}

module.exports = {
  TOKENS_ATTRIBUTE, GRINDER_STATUS_ATTRIBUTE, GRINDER_BONE_ATTRIBUTE,
  GRINDER_EMPTY, GRINDER_HOPPER, GRINDER_BIN,
  init, gameval, bonemealFor, worshipFor, boneName, tokens, setTokens, grinderStatus, grinderBone,
  setGrinder, restore, spam, mesbox, animate, sound, swap, run,
  get api() { return api; },
  get core() { return core; },
};
