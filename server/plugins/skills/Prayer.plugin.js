/**
 * Burying bones, from plugins/skills/data/bones.json, and scattering demonic ashes, from
 * plugins/skills/data/ashes.json (docs/prayer-bones.md).
 *
 * Other plugins bury through custom events:
 *   api.emitCustomEvent("prayer:bury", { player, itemId, scale, crushed })
 *     -> sets `handled` when `itemId` is a bone, or demonic ashes: its experience (times `scale`,
 *        default 1) and a bone's Prayer restore are given. `crushed` (the bonecrusher) leaves out
 *        bones it can't crush, and all ashes.
 *   api.emitCustomEvent("prayer:bone", { itemId, bone: null })
 *     -> sets `bone` to the bone's row ({ xp, level, ... }) when `itemId` is a bone, for content
 *        that gives its own experience (altars).
 *   api.onCustomEvent("prayer:bone-restore", (event) => { event.restore = event.points; })
 *     -> asked after every burial; `points` is the bone's restore, and Prayer gives back
 *        `restore` once, so two sources (the Catacombs, a dragonbone necklace) never stack.
 */
const DATA = require("./data/bones.json");
const ASHES = require("./data/ashes.json");
const { pauseForLevelUp } = require("./SkillActions");
const BURY_WITHOUT_ASKING_ATTRIBUTE = "giant-lairs:bury-without-asking";

const BURY_DELAY_MS = 1200; // Two OSRS game ticks.
const BURY_ANIMATION = 827; // human_pickupfloor
// Every bone sends these two, whatever its name (rsprox captures, docs/prayer-bones.md).
const DIG_MESSAGE = "You dig a hole in the ground...";
const BURY_MESSAGE = "You bury the bones.";
// Scattering as live OSRS sends it (rsprox captures, docs/prayer-bones.md): no spotanim.
const SCATTER_ANIMATION = 2295; // farming_ingredient_sprinkle
const SCATTER_SOUND = 2444; // farming_sprinkle

let api = null;
let bones = null;
let ashes = null;
const burials = new WeakMap();
const BURY_CONFIRMATION = "Bury the bones? (This grants Prayer XP)";
const BURY_OPTIONS = ["Yes", "No", "Yes, don't ask me again"];

/**
 * world.json `pluginConfig` `"Prayer:sequentialBurying": true` (overridable in world.local.json)
 * makes one Bury click continue through the inventory's bones (docs/prayer-bones.md). Off by
 * default: one bone per click, as OSRS.
 */
const SEQUENTIAL_CONFIG = "Prayer:sequentialBurying";
const sequentialBurying = () => api.getPluginConfig(SEQUENTIAL_CONFIG, false) === true;

/** Rows keyed by item id, resolved from their obj gamevals on first use. */
function rowsByItemId(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = api.core.CacheDefinitions.getObjId(row.obj);
    if (!Number.isInteger(id)) throw new Error(`[Prayer] unknown obj gameval ${row.obj}`);
    map.set(id, row);
  }
  return map;
}

/** The bone rows by item id. */
function boneFor(itemId) {
  if (!bones) bones = rowsByItemId(DATA.bones);
  return bones.get(itemId) ?? null;
}

function inventoryBoneFor(itemId) {
  const bone = boneFor(itemId);
  return bone?.groundOnly ? null : bone;
}

/** The demonic ash rows by item id. */
function ashFor(itemId) {
  if (!ashes) ashes = rowsByItemId(ASHES.ashes);
  return ashes.get(itemId) ?? null;
}

/** Burying and scattering lines are on the spam channel (rsprox captures). */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);
}

/** SkillManager preserves tenths; do not round up bone or bonecrusher rewards here. */
const experience = (xp, scale) => xp * scale;

function restorePrayer(player, itemId, bone) {
  if (!bone.restore) return;
  const event = { player, itemId, points: bone.restore, restore: 0 };
  api.emitCustomEvent("prayer:bone-restore", event);
  if (event.restore <= 0) return;
  const { Skill } = api.core;
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(Skill.PRAYER);
  if (skills.getCurrentLevel(Skill.PRAYER) >= max) return;
  skills.increaseCurrentLevel(Skill.PRAYER, event.restore, max);
}

function award(player, itemId, bone, scale) {
  player.getSkillManager().addExperiences(api.core.Skill.PRAYER, experience(bone.xp, scale));
  restorePrayer(player, itemId, bone);
}

/** "prayer:bury": a bone buried without the spade (the bonecrusher), or ashes scattered (a league fragment). */
function buryRequest(request) {
  const bone = boneFor(request?.itemId) ?? (request?.crushed ? null : ashFor(request?.itemId));
  if (!bone || !request.player) return;
  if (request.crushed && bone.crush === false) return;
  award(request.player, request.itemId, bone, request.scale ?? 1);
  request.handled = true;
}

/** "prayer:bone": the bone's row for `itemId`. */
function boneRequest(request) {
  if (request) request.bone = inventoryBoneFor(request.itemId);
}

function groundBoneFor(event) {
  const itemId = event.groundItemId ?? event.groundItem?.getItem?.()?.getId?.();
  const bone = boneFor(itemId);
  return bone?.groundOnly ? { itemId, bone } : null;
}

function takeGroundOnlyBones(event) {
  const groundBone = groundBoneFor(event);
  if (!groundBone) return false;
  event.handled = true;
  event.player.sendMessage("I don't think those will fit in my backpack...");
  return true;
}

function preventGroundOnlyBoneTransfer(event) {
  if (!boneFor(event?.itemId)?.groundOnly) return;
  event.allow = false;
}

function preventGroundOnlyBoneTelegrab(event) {
  const itemId = event?.groundItem?.getItem?.()?.getId?.();
  if (boneFor(itemId)?.groundOnly) event.allow = false;
}

function buryGroundOnlyBone(event) {
  const groundBone = groundBoneFor(event);
  if (!groundBone) return false;
  event.handled = true;
  const bury = () => {
    const { player, groundItem } = event;
    if (groundItem.isPendingRemoval?.()) return;
    api.core.ItemOnGroundManager.deregister(groundItem);
    player.performAnimation(new api.core.Animation(BURY_ANIMATION));
    api.core.Sounds.sendSound(player, api.core.Sound.BURY_BONES);
    player.getSkillManager().addExperiences(api.core.Skill.PRAYER, groundBone.bone.xp);
  };
  if (event.player.getAttribute(BURY_WITHOUT_ASKING_ATTRIBUTE) === true) {
    bury();
    return true;
  }
  const [yes, no, always] = BURY_OPTIONS;
  api.sendMultiChatboxPrompt(event.player, BURY_CONFIRMATION,
    yes, () => { event.player.getPacketSender().sendInterfaceRemoval(); bury(); },
    no, () => event.player.getPacketSender().sendInterfaceRemoval(),
    always, () => {
      event.player.setAttribute(BURY_WITHOUT_ASKING_ATTRIBUTE, true);
      event.player.getPacketSender().sendInterfaceRemoval();
      bury();
    });
  return true;
}

function stopBurial({ player }) {
  burials.get(player)?.stop();
}

function pauseBurial(event) {
  pauseForLevelUp(event, burials, (player) => stopBurial({ player }), (task) => task.resumeAnimation());
}

function interruptBurialForItem(event) {
  // Merely calculating worn-item bonuses is not a player action.
  if (event.action !== "bonus") stopBurial(event);
}

function buryBone({ player, itemId, slot }) {
  const core = api.core;
  const bone = inventoryBoneFor(itemId);
  if (!bone) return false;
  if (!player.getClickDelay().elapsedTime(BURY_DELAY_MS)) return true;
  const inventory = player.getInventory();
  if (inventory.get(slot)?.getId() !== itemId) return true;
  if (bone.level && player.getSkillManager().getMaxLevel(core.Skill.PRAYER) < bone.level) {
    player.sendMessage(`You need a Prayer level of ${bone.level} to bury these bones.`);
    return true;
  }
  if (sequentialBurying()) burySequence(player, itemId, slot, bone);
  else buryOnce(player, itemId, slot, bone);
  return true;
}

/** Still online, alive and standing where the burial started. */
function stillBurying(player, location) {
  return player.isRegistered() && player.getHitpoints() > 0 &&
    player.getLocation().equals(location) && player.getMovementQueue().size() === 0 &&
    player.getForceMovement() == null;
}

/** Takes the bone at `slot` with the dig message and its experience; false when it is no longer there. */
function consumeBone(player, itemId, slot, bone) {
  const inventory = player.getInventory();
  if (inventory.get(slot)?.getId() !== itemId) return false;
  inventory.deleteAtSlot(slot, 1);
  spam(player, DIG_MESSAGE);
  award(player, itemId, bone, 1);
  return true;
}

/** Sequential burial: the bone with both messages, on the resolving tick. */
function resolveBurial(player, itemId, slot, bone) {
  if (!consumeBone(player, itemId, slot, bone)) return false;
  spam(player, BURY_MESSAGE);
  return true;
}

/**
 * One bone per Bury click, as OSRS (the default): the animation, sound, dig message, bone and
 * experience come on the click's tick, "You bury the bones." on the next (rsprox captures).
 */
function buryOnce(player, itemId, slot, bone) {
  const core = api.core;
  player.getSkillManager().stopSkillable();
  player.getPacketSender().sendInterfaceRemoval();
  if (!consumeBone(player, itemId, slot, bone)) return;
  player.performAnimation(new core.Animation(BURY_ANIMATION));
  core.Sounds.sendSound(player, core.Sound.BURY_BONES);
  api.getTaskManager().submit(new core.CountdownTask(player, 1, () => {
    if (player.isRegistered()) spam(player, BURY_MESSAGE);
  }));
  player.getClickDelay().reset();
}

/**
 * With `Prayer:sequentialBurying`: the clicked bone, then every eligible bone left in the
 * inventory in slot order, one every two ticks, until the player does anything else.
 */
function burySequence(player, itemId, slot, bone) {
  const core = api.core;
  const inventory = player.getInventory();
  stopBurial({ player });
  player.getSkillManager().stopSkillable();
  player.getPacketSender().sendInterfaceRemoval();
  const location = player.getLocation().clone();
  // Consume and award XP together on the resolving tick. An interrupted burial
  // keeps its bone, including on logout before the account is saved.
  const task = new (class extends core.Task {
    constructor() { super(2, player, false); }
    execute() {
      if (this.levelUpPaused) return;
      if (!canComplete() || !resolveBurial(player, itemId, slot, bone)) return this.stop();
      // XP can open the popup; retain the next bone while its acknowledgement is pending.
      if (!this.isRunning() || !canComplete()) return this.stop();
      const next = inventory.getItems().findIndex(item => {
        if (!item || item.getAmount() <= 0) return false;
        if (!core.WorldDefinition.isMembersWorld() && core.CacheDefinitions.getItem(item.getId()).isMembers) return false;
        const row = inventoryBoneFor(item.getId());
        return row && (!row.level || player.getSkillManager().getMaxLevel(core.Skill.PRAYER) >= row.level);
      });
      if (next < 0) return this.stop();
      slot = next;
      itemId = inventory.get(slot).getId();
      bone = boneFor(itemId);
      if (!this.levelUpPaused) animate();
    }
    resumeAnimation() { animate(); }
    onTick() { if (!canComplete()) this.stop(); }
    stop() {
      super.stop();
      if (burials.get(player) !== this) return;
      burials.delete(player);
      if (player.getSkill() === action) {
        player.setSkill(null);
        if (player.isRegistered()) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
      }
    }
  })();
  // Register as a cancellable skilling action so ordinary interactions can stop it.
  const action = { cancel: () => task.stop() };
  function canComplete() {
    return stillBurying(player, location) && player.getSkill() === action;
  }
  function animate() {
    player.performAnimation(new core.Animation(BURY_ANIMATION));
    core.Sounds.sendSound(player, core.Sound.BURY_BONES);
    player.getClickDelay().reset();
  }
  burials.set(player, task);
  player.setSkill(action);
  animate();
  api.getTaskManager().submit(task);
}

/**
 * "Scatter" on demonic ashes: Prayer experience, no restore (Wiki, Remains). Unlike burying, it
 * resolves on the tick it is clicked: live OSRS removes the ash and sends the experience, the
 * message, the sequence and the synth together.
 */
function scatterAshes({ player, itemId, slot }) {
  const core = api.core;
  const ash = ashFor(itemId);
  if (!ash) return false;
  // Burying's two-tick click delay; the captures only show scatters three or more ticks apart.
  if (!player.getClickDelay().elapsedTime(BURY_DELAY_MS)) return true;
  const inventory = player.getInventory();
  if (inventory.get(slot)?.getId() !== itemId) return true;

  player.getSkillManager().stopSkillable();
  player.getPacketSender().sendInterfaceRemoval();
  inventory.deleteAtSlot(slot, 1);
  player.performAnimation(new core.Animation(SCATTER_ANIMATION));
  core.Sounds.sendSound(player, new core.Sound(SCATTER_SOUND, 1, 0, 0));
  spam(player, "You scatter the ashes.");
  player.getSkillManager().addExperiences(core.Skill.PRAYER, ash.xp);
  player.getClickDelay().reset();
  return true;
}

module.exports = {
  name: "Prayer",
  register(pluginApi) {
    api = pluginApi;
    api.onItemFirstAction(buryBone);
    api.onItemFirstAction(scatterAshes);
    api.persistAttribute(BURY_WITHOUT_ASKING_ATTRIBUTE, false);
    api.onGroundItemPickup(takeGroundOnlyBones);
    for (const { obj } of DATA.bones.filter((bone) => bone.groundOnly)) {
      const itemId = api.core.CacheDefinitions.getObjId(obj);
      api.onGroundItemClick(itemId, 3, buryGroundOnlyBone);
    }
    api.onCustomEvent("ground-items:take", preventGroundOnlyBoneTransfer);
    api.onCustomEvent("magic:can-telekinetic-grab", preventGroundOnlyBoneTelegrab);
    api.onCustomEvent("prayer:bury", buryRequest);
    api.onCustomEvent("prayer:bone", boneRequest);
    api.onCanUseItem(interruptBurialForItem);
    api.onPlayerLogout(stopBurial);
    api.onPlayerDisconnect(stopBurial);
    api.onPlayerDeath(stopBurial);
    api.onCustomEvent("level-up:popup-opened", pauseBurial);
  },
};
