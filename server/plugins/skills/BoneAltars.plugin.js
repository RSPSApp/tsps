/**
 * Offering bones on an altar (docs/bone-altars.md), from plugins/skills/data/bone-altars.json:
 * the Chaos Temple's altar in level 38 Wilderness gives 3.5 times the bones' burying experience,
 * and half its offerings keep the bone (Wiki). Bones are taken from the top-left of the
 * inventory, not the slot used (Wiki, 22 February 2023), and the offering repeats every 4 ticks
 * while that kind of bone lasts, as captured on a house altar. The bones and their experience
 * come from the Prayer plugin ("prayer:bone").
 *
 *   api.emitCustomEvent("bone-altars:offer", { player, object, itemId, altar, handled: false })
 *     -> offers `itemId` on another plugin's altar (Construction's house altars) with the same
 *        offering loop, and sets `handled` when `itemId` is a bone. `altar.blessing(bone)` gives
 *        `{ experience, message }` for each offering, or null once the altar is gone; it is asked
 *        again for every bone, so a house's incense burners going out show at once.
 *        `altar.spareChance` (default 0) and `spareMessage` keep a bone as the Chaos altar does.
 *
 *   api.onCustomEvent("bone-altars:offering", (request) => ...)
 *     { player, itemId, boneItemId: null, cost: 1, anyAltar: false }: content may let an item that is
 *     not a bone be offered as one (`boneItemId`), `cost` of it an offering, and on any altar one can
 *     pray at as well as these (`anyAltar`, at the bone's burying experience). A league relic's coins.
 */
const DATA = require("./data/bone-altars.json");
const { pauseForLevelUp, actionInterval } = require("./SkillActions");

let api = null;
let core = null;
let ids = null;

/** The gamevals in the data file, resolved on first use. */
function resolved() {
  if (ids) return ids;
  const { CacheDefinitions } = core;
  const id = (kind, name, lookup) => {
    const value = lookup(name);
    if (!Number.isInteger(value)) throw new Error(`[BoneAltars] unknown ${kind} gameval ${name}`);
    return value;
  };
  ids = {
    seq: id("seq", DATA.seq, (name) => CacheDefinitions.getSeqId(name)),
    spotanim: id("spotanim", DATA.spotanim, (name) => CacheDefinitions.getSpotanimId(name)),
    zealot: new Set(DATA.zealot.pieces.map((name) => id("obj", name, (n) => CacheDefinitions.getObjId(n)))),
    altars: DATA.altars.map((altar) => ({
      ...altar,
      id: id("loc", altar.loc, (name) => CacheDefinitions.getLocId(name)),
      blessing: dataBlessing(altar),
    })),
  };
  return ids;
}

function altarAt(objectId, location) {
  return resolved().altars.find((altar) => altar.id === objectId &&
    altar.x === location.x && altar.y === location.y && altar.z === location.z) ?? null;
}

function boneFor(itemId) {
  const request = { itemId, bone: null };
  api.emitCustomEvent("prayer:bone", request);
  return request.bone;
}

/** What a non-bone counts as ("bone-altars:offering"), or null. */
function offeringFor(player, itemId) {
  const request = { player, itemId, boneItemId: null, cost: 1, anyAltar: false };
  api.emitCustomEvent("bone-altars:offering", request);
  const bone = Number.isInteger(request.boneItemId) ? boneFor(request.boneItemId) : null;
  if (!bone) return null;
  return { bone, cost: Number.isSafeInteger(request.cost) && request.cost > 0 ? request.cost : 1, anyAltar: request.anyAltar === true };
}

/** A standard altar one prays at, offered on at the bone's burying experience. */
const STANDARD_ALTAR = { blessing: (bone) => ({ experience: bone.xp, message: DATA.message }) };

function prayAltar(object) {
  const definition = object?.getDefinition?.();
  return (definition?.actions ?? definition?.getActions?.() ?? []).some((action) => /^pray/i.test(action ?? ""));
}

function zealotPieces(player) {
  const worn = new Set(player.getEquipment().getItems().map((item) => item?.getId?.() ?? -1));
  return [...resolved().zealot].filter((id) => worn.has(id)).length;
}

/** The altar keeps the bone, or failing that the Zealot's robes do (Wiki: two rolls). */
function spared(player, altar) {
  if (Math.random() < (altar.spareChance ?? 0)) return "altar";
  return Math.random() < zealotPieces(player) * DATA.zealot.chancePerPiece ? "robes" : null;
}

/** The altar's tile nearest the player, where the captured offering graphic plays. */
function graphicTile(player, object) {
  const location = object.getLocation();
  const definition = object.getDefinition?.();
  const turned = (object.getFace?.() ?? 0) % 2 === 1;
  const sizeX = (turned ? definition?.sizeY : definition?.sizeX) ?? 1;
  const sizeY = (turned ? definition?.sizeX : definition?.sizeY) ?? 1;
  const at = player.getLocation();
  const clamp = (value, low, size) => Math.max(low, Math.min(low + size - 1, value));
  return new core.Location(clamp(at.getX(), location.getX(), sizeX), clamp(at.getY(), location.getY(), sizeY), location.getZ());
}

/** A data-file altar's offering: its scale of the burying experience, rounded up as burying is. */
function dataBlessing(altar) {
  return (bone) => ({ experience: Math.ceil(bone.xp * altar.xpScale), message: DATA.message });
}

/** One offering of the first `boneId` carried; false when there is none left or the altar is gone. */
function offer(player, object, altar, boneId, bone, cost = 1) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(boneId);
  if (slot < 0 || (cost > 1 && inventory.getAmount(boneId) < cost)) return false;
  const blessing = altar.blessing(bone);
  if (!blessing) return false;
  const kept = spared(player, altar);
  if (!kept) {
    if (cost > 1) inventory.deleteNumber(boneId, cost);
    else inventory.deleteAtSlot(slot, 1);
  }
  const message = kept === "altar" ? altar.spareMessage : blessing.message;
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, message);
  // Experience first: a level-up pop-up resets the player's animation, and this offering's
  // animation still plays over it.
  player.getSkillManager().addExperiences(core.Skill.PRAYER, blessing.experience);
  const tile = graphicTile(player, object);
  const { seq, spotanim } = resolved();
  player.setPositionToFace(tile);
  player.performAnimation(new core.Animation(seq));
  player.getPacketSender().sendSound(DATA.sound, 1, 0).sendGlobalGraphic(new core.Graphic(spotanim), tile);
  return true;
}

/** Each player's repeating offering, retained while the level-up dialogue is open. */
const offerings = new WeakMap();

/**
 * Offers every `intervalTicks` from the next one, keyed to the player so a walk or click stops
 * it; a level-up pop-up pauses it, as it does other skilling (docs/settings.md). Content may
 * offer faster ("skills:action-interval", a league relic's 2-tick pace).
 */
function keepOffering(player, object, altar, boneId, bone, cost = 1) {
  let tick = 0;
  const interval = actionInterval(api, player, core.Skill.PRAYER, "offer", DATA.intervalTicks);
  const task = new (class extends core.Task {
    constructor() { super(1, player.getIndex(), false); }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      if (this.levelUpPaused) return;
      if (++tick % interval !== 0) return;
      if (!offer(player, object, altar, boneId, bone, cost)) this.stop();
    }
  })();
  offerings.set(player, task);
  core.TaskManager.submit(task);
}

function stopOffering({ player }) {
  offerings.get(player)?.stop();
  offerings.delete(player);
}

function pauseOffering(event) {
  pauseForLevelUp(event, offerings, (player) => stopOffering({ player }));
}

/**
 * Offers at once and then every few ticks. Using a bone again restarts the loop with an immediate
 * offering, so offering by hand is faster than letting it repeat (Wiki: Pay-to-play Prayer training).
 */
function startOffering(player, object, altar, itemId, offering = undefined) {
  const counted = boneFor(itemId) ? null : offering === undefined ? offeringFor(player, itemId) : offering;
  const bone = counted?.bone ?? boneFor(itemId);
  if (!bone) return false;
  const cost = counted?.cost ?? 1;
  if (cost > 1 && player.getInventory().getAmount(itemId) < cost) {
    player.sendMessage("You don't have enough to offer.");
    return true;
  }
  if (bone.level && player.getSkillManager().getMaxLevel(core.Skill.PRAYER) < bone.level) {
    player.sendMessage(`You need a Prayer level of ${bone.level} to offer these bones.`);
    return true;
  }
  stopOffering({ player });
  // Register the loop before the immediate offering so its first XP drop can pause it too.
  keepOffering(player, object, altar, itemId, bone, cost);
  if (!offer(player, object, altar, itemId, bone, cost)) stopOffering({ player });
  return true;
}

function useBoneOnAltar(event) {
  const { player, object, objectId, itemId, location } = event;
  const altar = altarAt(objectId, location);
  if (altar) {
    if (startOffering(player, object, altar, itemId)) event.handled = true;
    return;
  }
  // Any altar one prays at, for an offering content allows there ("bone-altars:offering"); a
  // private area's altars (a house's) are its owner's, which offer through "bone-altars:offer".
  if (boneFor(itemId) || !prayAltar(object) || player.getPrivateArea?.()) return;
  const offering = offeringFor(player, itemId);
  if (offering?.anyAltar && startOffering(player, object, STANDARD_ALTAR, itemId, offering)) event.handled = true;
}

/** "bone-altars:offer": another plugin's altar, offered on with this loop. */
function offerOnAltar(request) {
  const { player, object, itemId, altar } = request;
  if (startOffering(player, object, altar, itemId)) request.handled = true;
}

module.exports = {
  name: "BoneAltars",
  members: true,
  _test: { altarAt, spared, zealotPieces, graphicTile },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onItemOnObject(useBoneOnAltar, { noted: false });
    api.onCustomEvent("level-up:popup-opened", pauseOffering);
    api.onCustomEvent("bone-altars:offer", offerOnAltar);
  },
};
