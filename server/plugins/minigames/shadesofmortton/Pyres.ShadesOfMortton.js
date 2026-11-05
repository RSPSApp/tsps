/**
 * The funeral pyres, as recorded (rsprox 227/01846 [10247]-[10272], 232/03118; shades-of-mortton.json
 * `pyres`):
 * - pyre logs on an empty pyre (or its Build): "You put some logs on the pyre.", and it shows the
 *   wood; remains on the logs (or the pyre's Use): "You place the shade's remains on the logs.";
 * - Light: "You attempt to light the funeral pyre."; 3 ticks on the fire, the Prayer and
 *   Firemaking experience; 2 ticks later the Shade Spirit rises; 4 ticks after that the reward on
 *   the stone stand (private, gone after 500 ticks) with a puff of smoke, and the pyre is empty;
 * - Wiki: the Prayer experience by remains and wood, +50% Prayer (Morytania Hard) and +50% Firemaking
 *   (Morytania Elite), the Firemaking level each wood needs and gives, the wood each remains needs, 21% coins or
 *   else a key (the remains decide which).
 * The quest (quests/quests/ShadesOfMortton.Quest.js) hears "shades-of-mortton:pyre-logs" and
 * "shades-of-mortton:cremated" for its stages.
 */
const Common = require("./Common.ShadesOfMortton");

const COINS = 995;
const TINDERBOX = "tinderbox";
const EMPTY_PYRE = "temple_pyre";
/** Each pyre in use: its tile key -> the player and what is on it. */
const pyres = new Map();

const p = () => Common.data.pyres;
const tileKey = (object) => `${object.getLocation().getX()},${object.getLocation().getY()},${object.getLocation().getZ()}`;

/** wood -> { level, xp, logs, pyre, ready } from the cache's names. */
let woodTable = null;
function woods() {
  if (woodTable) return woodTable;
  woodTable = p().woods.map(([wood, level, xp]) => ({
    wood, level, xp,
    // Plain logs are "logs_pyre"; the rest "<wood>_logs_pyre".
    logs: Common.objId(wood === "logs" ? "logs_pyre" : `${wood}_logs_pyre`),
    pyre: Common.locId(`temple_pyre_${wood}`),
    ready: Common.locId(`temple_pyre_bones_${wood}`),
  }));
  return woodTable;
}

const woodByLogs = (itemId) => woods().find((w) => w.logs === itemId) ?? null;
const woodByPyre = (locId) => woods().find((w) => w.pyre === locId || w.ready === locId) ?? null;

function remainsOf(itemId) {
  for (const [name, remains] of Object.entries(p().remains)) {
    if (Common.objId(name) === itemId) return { name, ...remains, itemId };
  }
  return null;
}

/** Morytania diary tier done (Hard: Prayer +50%, Elite: Firemaking +50% from cremating; Wiki). */
function diaryDone(player, tier) {
  const request = { player, diary: "morytania", tier, complete: false };
  Common.api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function questStage(player) {
  const request = { player, key: "shades_of_mortton" };
  Common.api.emitCustomEvent("quest:get-stage", request);
  return Number(request.stage) || 0;
}

/** The quest's step "made pyre logs" comes first (70: quests/quests/ShadesOfMortton.Quest.js). */
function mayBurn(player) {
  if (questStage(player) >= 70) return true;
  player.sendMessage(Common.message("needQuest"));
  return false;
}

function swap(object, locId) {
  const { GameObject, ObjectManager } = Common.core;
  const next = new GameObject(locId, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
  ObjectManager.register(next, true);
  return next;
}

function busy(player, object) {
  const use = pyres.get(tileKey(object));
  if (use && use.player !== player) {
    player.sendMessage(Common.message("pyreBusy"));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- logs and remains

function putLogs(player, object, wood) {
  if (!mayBurn(player) || busy(player, object)) return;
  player.getInventory().delete(wood.logs, 1);
  player.getInventory().refreshItems?.();
  player.performAnimation?.(new Common.core.Animation(p().anims.place));
  player.sendMessage(Common.message("logsOn"));
  pyres.set(tileKey(object), { player, wood, remains: null, burning: false, object: swap(object, wood.pyre) });
  Common.api.emitCustomEvent("shades-of-mortton:pyre-logs", { player });
}

function putRemains(player, object, remains) {
  const use = pyres.get(tileKey(object));
  if (!use || use.player !== player) return void player.sendMessage(Common.message("pyreBusy"));
  if (use.wood.level < remains.minWood) return void player.sendMessage(Common.message("weakLogs"));
  player.getInventory().delete(remains.itemId, 1);
  player.getInventory().refreshItems?.();
  player.performAnimation?.(new Common.core.Animation(p().anims.place));
  player.sendMessage(Common.message("remainsOn"));
  use.remains = remains;
  use.object = swap(object, use.wood.ready);
}

/** Items used on a pyre: pyre logs on the empty one, remains on the logs. */
function itemOnPyre(event) {
  const { player, object, itemId } = event;
  const empty = object?.getId?.() === Common.locId(EMPTY_PYRE);
  const wood = woodByPyre(object?.getId?.());
  if (!empty && !wood) return;
  event.handled = true;
  if (empty) {
    const logs = woodByLogs(itemId);
    if (logs) putLogs(player, object, logs);
    return;
  }
  if (object.getId() === wood.ready) {
    if (itemId === Common.objId(TINDERBOX)) light({ player, object });
    return;
  }
  const remains = remainsOf(itemId);
  if (remains) putRemains(player, object, remains);
}

/** Build (2024): the best pyre logs the player carries. */
function build({ player, object }) {
  const carried = woods().filter((w) => player.getInventory().getAmount(w.logs) > 0);
  if (!carried.length) return true;
  putLogs(player, object, carried[carried.length - 1]);
  return true;
}

/** Use (2024): the best remains the pyre can take. */
function use({ player, object }) {
  const wood = woodByPyre(object?.getId?.());
  if (!wood || object.getId() !== wood.pyre) return false;
  const usable = Object.keys(p().remains).map((name) => remainsOf(Common.objId(name)))
    .filter((r) => r && player.getInventory().getAmount(r.itemId) > 0 && wood.level >= r.minWood);
  if (!usable.length) return true;
  putRemains(player, object, usable[usable.length - 1]);
  return true;
}

// ---------------------------------------------------------------- burning

function nearbyPlayers(location) {
  return [...(Common.core.World.getPlayers?.() ?? [])].filter((other) => other?.getLocation?.()?.getDistance?.(location) <= 15);
}

function graphicAt(id, location, viewers) {
  const graphic = new Common.core.Graphic(id, 0, 0);
  for (const viewer of viewers) viewer.getPacketSender().sendGraphic?.(graphic, location);
}

/** The stone stand nearest the pyre (the reward's place). */
function standNear(object) {
  const { MapObjects, Location } = Common.core;
  const at = object.getLocation();
  const stand = Common.locId(p().stand);
  const reach = p().standReach;
  for (let d = 1; d <= reach; d++) {
    for (let x = -d; x <= d; x++) {
      for (let y = -d; y <= d; y++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
        const tile = new Location(at.getX() + x, at.getY() + y, at.getZ());
        if (MapObjects.get?.(stand, tile, object.getPrivateArea?.() ?? null)) return tile;
      }
    }
  }
  return at;
}

/** Wiki: 21% coins, else a key from the remains' groups (equal within a group). */
function rewardFor(remains) {
  let roll = Math.random() * 100;
  for (const [chance, keys] of remains.keys) {
    if (roll < chance) return { id: Common.objId(`shadekey_${keys[Common.randomInt(0, keys.length - 1)]}`), amount: 1 };
    roll -= chance;
  }
  return { id: COINS, amount: Common.randomInt(...remains.coins) };
}

function light({ player, object }) {
  const use = pyres.get(tileKey(object));
  const wood = woodByPyre(object?.getId?.());
  if (!wood || object.getId() !== wood.ready) return false;
  if (!use || use.player !== player || !use.remains || use.burning) {
    player.sendMessage(Common.message("pyreBusy"));
    return true;
  }
  if (player.getInventory().getAmount(Common.objId(TINDERBOX)) <= 0) {
    player.sendMessage(Common.message("noTinderbox"));
    return true;
  }
  const skills = player.getSkillManager();
  if (skills.getCurrentLevel(Common.core.Skill.FIREMAKING) < wood.level) {
    player.sendMessage(Common.message("firemaking", { level: wood.level }));
    return true;
  }
  use.burning = true;
  player.sendMessage(Common.message("lighting"));
  player.performAnimation?.(new Common.core.Animation(p().anims.light));
  const at = object.getLocation();
  const { remains } = use;
  // Each step is this burn's own: a pyre given up on logout is no longer it.
  const key = tileKey(object);
  const current = () => pyres.get(key) === use;
  Common.later(p().fireTicks, () => {
    if (!current()) return;
    graphicAt(p().graphics.fire, at, nearbyPlayers(at));
    // The experience is added in tenths (the skill manager drops the rest).
    const prayer = remains.prayer[wood.wood] * (diaryDone(player, "hard") ? p().diaryBonus : 1);
    const firemaking = wood.xp * (diaryDone(player, "elite") ? p().diaryBonus : 1);
    skills.addExperience(Common.core.Skill.PRAYER, prayer);
    skills.addExperience(Common.core.Skill.FIREMAKING, firemaking);
  });
  Common.later(p().fireTicks + p().spiritTicks, () => {
    if (!current()) return;
    const spirit = Common.core.NPC.create(Common.npcId(p().spirit), at.clone());
    spirit.__skipDefaultRespawn = true;
    Common.core.World.getAddNPCQueue().push(spirit);
    Common.later(p().spiritLeavesTicks, () => Common.core.World.getRemoveNPCQueue().push(spirit));
  });
  Common.later(p().fireTicks + p().spiritTicks + p().rewardTicks, () => {
    if (!current()) return;
    const stand = standNear(object);
    const reward = rewardFor(remains);
    // Recorded: the burner's alone, never public.
    Common.core.ItemOnGroundManager.registerNonGlobals(player, new Common.core.Item(reward.id, reward.amount), stand);
    graphicAt(p().graphics.smoke, stand, nearbyPlayers(stand));
    pyres.delete(key);
    swap(object, Common.locId(EMPTY_PYRE));
    Common.api.emitCustomEvent("shades-of-mortton:cremated", { player, remains: remains.itemId, wood: use.wood.wood, reward });
  });
  return true;
}

/** A pyre its burner leaves is emptied for the next player. */
function forget({ player }) {
  for (const [key, use] of pyres) {
    if (use.player !== player) continue;
    pyres.delete(key);
    swap(use.object, Common.locId(EMPTY_PYRE));
  }
}

function attachPyres(api) {
  api.onItemOnObject(itemOnPyre);
  api.onObjectInteraction("Funeral Pyre", { Build: build });
  for (const wood of p().woods) {
    const name = Common.core.CacheDefinitions.getObject(Common.locId(`temple_pyre_${wood[0]}`))?.name;
    if (name) api.onObjectInteraction(name, { Use: use, Light: light });
  }
  api.onPlayerLogout(forget);
}

module.exports = { attachPyres, itemOnPyre, build, use, light, rewardFor, woods, pyres };
