/**
 * Wine of Zamorak spawns: https://oldschool.runescape.wiki/w/Wine_of_Zamorak
 *
 * Taking or telegrabbing the wine at a Chaos Temple angers Zamorak: "STOP STEALING MY WINE! GAH!",
 * a flame on the thief and a stat drain on that tick, and a hit on the next. The drain takes
 * level / 20 + 1 from the current Attack, Defence, Strength, Ranged, Prayer and Magic, and the hit
 * is Hitpoints level / 20 + 1 (1 to 5).
 *
 * - Asgarnia, both floors: the monks of Zamorak on the wine's floor attack the thief. By hand
 *   the wine only comes away once every monk on that floor is dead; the punishment lands either
 *   way. On the upper floor Zamorak monk robes or vestment robes keep the monks off a telegrab.
 * - The Wilderness temple (church) and the Deep Wilderness Dungeon: only Telekinetic Grab takes
 *   the wine, and with the hard Wilderness Diary done it comes noted. The church grab is punished;
 *   ours: the dungeon grab isn't, as nothing documents it there.
 */
const WINE_MESSAGE = "STOP STEALING MY WINE! GAH!";
const ZAMORAK_FLAME_GRAPHIC = 78; // zamorak_flame
const ZAMORAK_FLAME_SOUND = 229;
const MONK_NAME = "Monk of Zamorak";
/** How far from the wine the monks guarding it stand. */
const GUARD_RANGE = 12;
const HAND_TAKE_NEVER = "never";
const HAND_TAKE_GUARDS_DEAD = "guards-dead";

let core;
let pluginApi;
/** Takes the punishment already ran for, let through to the generic pickup on the next tick. */
const releasedTakes = new WeakSet();

/**
 * Each wine spawn: its tile and item, whether it is punished (`punish`: on "take", "grab" or both),
 * when it may be taken by hand, whether monks guard it, whether robes calm them for a telegrab,
 * and whether the hard Wilderness Diary notes it.
 */
function spawns() {
  const Items = core.ItemIdentifiers;
  return [
    { x: 2930, y: 3515, z: 0, item: Items.WINE_OF_ZAMORAK, punish: ["take", "grab"], handTake: HAND_TAKE_GUARDS_DEAD, guarded: true },
    { x: 2938, y: 3517, z: 1, item: Items.WINE_OF_ZAMORAK, punish: ["take", "grab"], handTake: HAND_TAKE_GUARDS_DEAD, guarded: true, robesCalmGrab: true },
    { x: 2950, y: 3824, z: 0, item: Items.WINE_OF_ZAMORAK, punish: ["grab"], handTake: HAND_TAKE_NEVER, noted: true },
    { x: 3018, y: 10353, z: 0, item: Items.WINE_OF_ZAMORAK_3, punish: [], handTake: HAND_TAKE_NEVER, noted: true },
  ];
}

let SPAWNS = null;

function spawnOf(groundItem) {
  if (!groundItem?.isStaticSpawn?.()) return null;
  const position = groundItem.getPosition();
  const id = groundItem.getItem().getId();
  SPAWNS ??= spawns();
  return SPAWNS.find((spawn) => spawn.item === id && spawn.x === position.getX()
    && spawn.y === position.getY() && spawn.z === position.getZ()) ?? null;
}

function npcName(npc) {
  return (npc?.getCurrentDefinition?.() ?? npc?.getDefinition?.())?.getName?.() ?? "";
}

/** The living monks guarding a spawn: those on its floor within range of the wine. */
function guards(spawn) {
  const monks = [];
  core.World.getNpcs().forEach((npc) => {
    if (!npc?.isRegistered?.() || npc.getHitpoints() <= 0 || npcName(npc) !== MONK_NAME) return;
    const location = npc.getLocation();
    if (location.getZ() !== spawn.z) return;
    if (Math.max(Math.abs(location.getX() - spawn.x), Math.abs(location.getY() - spawn.y)) > GUARD_RANGE) return;
    monks.push(npc);
  });
  return monks;
}

function wornName(player, slot) {
  const id = player.getEquipment().getItems()[slot]?.getId?.() ?? -1;
  return id > 0 ? core.ItemDefinition.forId(id)?.getName?.() ?? "" : "";
}

/** Zamorak monk robes or vestment robes: a top and a bottom from either set. */
function wearsZamorakRobes(player) {
  const top = wornName(player, core.Equipment.BODY_SLOT);
  const bottom = wornName(player, core.Equipment.LEG_SLOT);
  return (top === "Zamorak monk top" || top === "Zamorak robe top")
    && (bottom === "Zamorak monk bottom" || bottom === "Zamorak robe legs");
}

/** Level / 20 + 1: 1 below 20, up to 5 at 80-99 (and more on a boosted level). */
function penalty(level) {
  return Math.floor(Math.max(0, level) / 20) + 1;
}

function drainedSkills() {
  const { Skill } = core;
  return [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.RANGED, Skill.PRAYER, Skill.MAGIC];
}

/** Zamorak's punishment: the shout, flame and drain now, the hit on the next tick. */
function punish(player) {
  player.sendMessage(WINE_MESSAGE);
  player.performGraphic(new core.Graphic(ZAMORAK_FLAME_GRAPHIC));
  player.getPacketSender().sendSoundEffect(ZAMORAK_FLAME_SOUND, 1, 0);
  const skills = player.getSkillManager();
  for (const skill of drainedSkills()) {
    skills.decreaseCurrentLevel(skill, penalty(skills.getCurrentLevel(skill)), 0);
  }
  afterTick(player, () => {
    if (!player.isRegistered?.() || player.getHitpoints() <= 0) return;
    const damage = penalty(skills.getMaxLevel(core.Skill.HITPOINTS));
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
  });
}

function provokeGuards(player, spawn) {
  for (const monk of guards(spawn)) {
    if (monk.getCombat().getTarget() !== player) monk.getCombat().attack(player);
  }
}

function afterTick(player, run) {
  const task = new core.Task(1, false);
  task.execute = () => {
    task.stop();
    run();
  };
  core.TaskManager.submit(task);
}

/** Take by hand: punished and guarded; the wine comes away a tick later only when allowed. */
function takeWine(event) {
  const { player, groundItem } = event;
  if (releasedTakes.has(groundItem)) return;
  const spawn = spawnOf(groundItem);
  if (!spawn) return;
  event.handled = true;
  const allowed = spawn.handTake === HAND_TAKE_GUARDS_DEAD && guards(spawn).length === 0;
  if (spawn.punish.includes("take")) punish(player);
  if (spawn.guarded) provokeGuards(player, spawn);
  if (!allowed) return;
  afterTick(player, () => {
    if (!player.isRegistered?.() || player.getHitpoints() <= 0) return;
    releasedTakes.add(groundItem);
    try {
      core.ItemOnGroundManager.pickup(player, groundItem);
    } finally {
      releasedTakes.delete(groundItem);
    }
  });
}

/** Telekinetic Grab cast at the wine: punished on the cast, and the guards come unless robes calm them. */
function grabWine({ player, groundItem }) {
  const spawn = spawnOf(groundItem);
  if (!spawn) return;
  if (spawn.punish.includes("grab")) punish(player);
  if (spawn.guarded && !(spawn.robesCalmGrab && wearsZamorakRobes(player))) provokeGuards(player, spawn);
}

function diaryComplete(player, diary, tier) {
  const request = { player, diary, tier, complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** The hard Wilderness Diary notes the Wilderness wines. */
function noteWine(request) {
  const spawn = spawnOf(request.groundItem);
  if (spawn?.noted && diaryComplete(request.player, "wilderness", "hard")) request.noted = true;
}

module.exports = {
  name: "WineOfZamorak",
  description: "Wine of Zamorak spawns: Zamorak's punishment, the guarding monks, the hand-take rules and the Wilderness Diary's noted wine.",
  _test: { penalty, spawnOf, guards, wearsZamorakRobes, takeWine, grabWine, noteWine, punish },
  register(api) {
    core = api.core;
    pluginApi = api;
    SPAWNS = null;
    api.onGroundItemPickup(takeWine);
    api.onCustomEvent("magic:telekinetic-grab-cast", grabWine);
    api.onCustomEvent("ground-items:reward", noteWine);
  },
};
