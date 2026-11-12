/**
 * The player's own character while they fight an unranked duel. Live PvP Arena worlds give a
 * separate arena character; here the main one fights, so its belongings are put aside for the
 * fight, in the shape of Last Man Standing's stash (lms/Stash.LastManStanding.js):
 * - the fight starting puts aside the inventory, the equipment (with each item's meta), the
 *   combat skills, the spellbook, special and run energy, the autocast spell and the
 *   per-character attributes the data names (the ring of recoil's count, the imbued heart's
 *   cooldown, a divine potion's effect), then empties both containers and resets those attributes;
 * - leaving the arena (a win, a death, a forfeit, a logout) puts everything back as it was;
 * - the stash is never saved: any save taken mid-fight (a periodic save, a crash) writes the
 *   player's own character and an Emir's Arena tile instead of the arena's ("persistence:
 *   snapshot"), so no save ever holds arena gear or a stash, whatever plugins the next world
 *   runs.
 */
const Common = require("./Common.DuelArena");
const Dragonfire = require("../../combat/DragonfireProtection");

const COMBAT_SKILLS = ["ATTACK", "DEFENCE", "STRENGTH", "HITPOINTS", "RANGED", "PRAYER", "MAGIC"];
const INVENTORY_SIZE = 28;
const EQUIPMENT_SIZE = 14;

/** Player -> their own character, from the fight's start until they leave it. */
const stashes = new WeakMap();

function itemsOf(container) {
  return container.getItems().map((item) => (item && item.getId() > 0 ? [item.getId(), item.getAmount(), item.getMeta()] : null));
}

function skillsOf(player) {
  const skills = player.getSkillManager();
  return COMBAT_SKILLS.map((name) => {
    const skill = Common.core.Skill[name];
    const index = skill.getIndex();
    return [skills.getCurrentLevel(skill), skills.getMaxLevels(index), skills.skills?.experience?.[index] ?? skills.getExperience(skill)];
  });
}

function stashed(player) {
  return stashes.get(player) ?? null;
}

function spellbookName(player) {
  const { MagicSpellbook } = Common.core;
  const book = player.getSpellbook();
  return ["NORMAL", "ANCIENT", "LUNAR", "ARCEUUS"].find((name) => MagicSpellbook[name] === book) ?? "NORMAL";
}

function clear(player) {
  player.getInventory().resetItems().refreshItems();
  player.getEquipment().resetItems().refreshItems();
}

/** The character attributes the arena starts afresh, by key: their value outside it. */
function characterKeys() {
  return Object.keys(Common.data.characterAttributes).filter((key) => !key.startsWith("$"));
}

function characterAttributes(player) {
  return Object.fromEntries(characterKeys().map((key) => [key, player.getAttribute(key)]));
}

/**
 * Puts the player's own character aside, leaving them empty-handed. False, and nothing
 * touched, when one is already held: a second fight must not start on top of it.
 */
function save(player, exit) {
  if (stashed(player)) return false;
  stashes.set(player, {
    inventory: itemsOf(player.getInventory()),
    equipment: itemsOf(player.getEquipment()),
    skills: skillsOf(player),
    spellbook: spellbookName(player),
    special: player.getSpecialPercentage(),
    run: player.getRunEnergy(),
    autocast: player.getCombat().getAutocastSpell?.() ?? null,
    timers: timersOf(player),
    attributes: characterAttributes(player),
    exit: exit ?? Common.data.arena.sides[0].exits[0],
  });
  clear(player);
  stopTimers(player);
  for (const key of characterKeys()) player.setAttribute(key, Common.data.characterAttributes[key]);
  player.setHasVengeance(false);
  return true;
}

/**
 * The player's own antifire, poison/venom protection and Vengeance cooldown are put aside with the character, and the
 * fight's stopped when it ends: an arena anti-venom or a Lunar load-out's Vengeance cooldown never leaves it. Tele Block
 * is not put aside: it ends on leaving the Wilderness (Wiki: Tele Block), so the player's own one ends as the fight
 * starts, and one cast in the arena (no Wilderness there) ends as they leave.
 */
function timersOf(player) {
  const combat = player.getCombat();
  return {
    vengeance: player.getVengeanceTimer().secondsRemaining(),
    fire: combat.getFireImmunityTimer().secondsRemaining(),
    dragonfire: dragonfireOf(player),
    poison: combat.getPoisonClock().finished() ? null : combat.getPoisonClock().snapshot(),
  };
}

/**
 * The antifire itself (tier, label, end time) lives in an attribute the fire timer only mirrors, and is what
 * dragonfire reads first: kept as its tier, label and remaining time, so the pause doesn't run it down.
 */
function dragonfireOf(player) {
  const state = player.getAttribute(Dragonfire.ATTR_DRAGONFIRE_STATE);
  if (!state || !Number.isFinite(state.endsAt)) return null;
  const seconds = Math.ceil((state.endsAt - Date.now()) / 1000);
  return seconds > 0 ? { tier: state.tier, label: state.label, seconds } : null;
}

function stopTimers(player) {
  const combat = player.getCombat();
  combat.getTeleblockTimer().stop();
  // The antifire's timer, state and saved tier all go (DragonfireProtection), so none outlives the pause.
  Dragonfire.clearDragonfireProtection(player);
  combat.getPoisonClock().stop();
  player.getVengeanceTimer().stop();
  player.getPacketSender().sendEffectTimer?.(0, Common.core.EffectTimer?.TELE_BLOCK);
}

function restoreTimers(player, timers) {
  stopTimers(player);
  if (!timers) return;
  const combat = player.getCombat();
  if (timers.vengeance > 0) player.getVengeanceTimer().start(timers.vengeance);
  if (timers.dragonfire) Dragonfire.setDragonfireProtection(player, timers.dragonfire);
  else if (timers.fire > 0) combat.getFireImmunityTimer().start(timers.fire);
  if (timers.poison) combat.getPoisonClock().restore(timers.poison);
}

function itemOf([id, amount, meta]) {
  return new Common.core.Item(id, amount, meta ? { ...meta } : null);
}

function fill(container, items) {
  const { Item } = Common.core;
  items.forEach((entry, slot) => container.setItem(slot, entry ? itemOf(entry) : new Item(-1, 0)));
  container.refreshItems();
}

/** Everything back as it was before the fight; nothing to do when nothing is held. */
function restore(player) {
  const stash = stashed(player);
  if (!stash) return false;
  stashes.delete(player);
  const { Skill, MagicSpellbook, Flag, WeaponInterfaceManager, BonusManager, CombatSpecial } = Common.core;
  fill(player.getInventory(), stash.inventory);
  fill(player.getEquipment(), stash.equipment);
  const skills = player.getSkillManager();
  COMBAT_SKILLS.forEach((name, index) => {
    const [level, max, experience] = stash.skills[index] ?? [];
    const skill = Skill[name];
    if (max == null) return;
    skills.setMaxLevels(skill, max, false);
    skills.setExperiences(skill, experience, false);
    skills.setCurrentLevel(skill, level, true);
  });
  const book = MagicSpellbook[stash.spellbook] ?? MagicSpellbook.NORMAL;
  player.setSpellbook(book);
  player.getPacketSender().sendTabInterface(Common.MAGIC_TAB, book.getInterfaceId());
  player.setSpecialPercentage(stash.special ?? 100);
  CombatSpecial.updateBar(player);
  player.setRunEnergy(stash.run ?? 100);
  for (const [key, value] of Object.entries(stash.attributes)) player.setAttribute(key, value);
  player.setHasVengeance(false);
  restoreTimers(player, stash.timers);
  player.getCombat().setAutocastSpell(stash.autocast);
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  return true;
}

/** A save taken mid-fight writes the player's own character, standing in the Emir's Arena. */
function snapshot({ player, save: playerSave }) {
  const stash = stashed(player);
  if (!stash) return;
  const { Item, Skill, MagicSpellbook, Location } = Common.core;
  const items = (entries, size) => Array.from({ length: size }, (_, slot) => (entries[slot] ? itemOf(entries[slot]) : new Item(-1, 0)));
  playerSave.setInventory(items(stash.inventory, INVENTORY_SIZE));
  playerSave.setEquipment(items(stash.equipment, EQUIPMENT_SIZE));
  const skills = playerSave.getSkills();
  COMBAT_SKILLS.forEach((name, index) => {
    const [level, max, experience] = stash.skills[index] ?? [];
    if (max == null) return;
    const at = Skill[name].getIndex();
    skills.level[at] = level;
    skills.maxLevel[at] = max;
    skills.experience[at] = experience;
  });
  playerSave.setSpellBook(MagicSpellbook[stash.spellbook] ?? MagicSpellbook.NORMAL);
  playerSave.setSpecPercentage(stash.special ?? 100);
  playerSave.setRunEnergy(stash.run ?? 100);
  playerSave.setHasVengeance(false);
  // The player's own timers, not the fight's; no Tele Block, which ended as the fight started.
  playerSave.teleblockTimer = 0;
  playerSave.setLastVengeanceTimer(stash.timers?.vengeance ?? 0);
  playerSave.fireImmunityTimer = stash.timers?.fire ?? 0;
  playerSave.poisonClock = stash.timers?.poison ?? undefined;
  // Without a stashed clock the legacy immunity seconds would rebuild the arena's anti-venom on load.
  playerSave.setPoisonImmunityTimer(0);
  playerSave.autocastSpellId = stash.autocast?.spellId?.() ?? -1;
  playerSave.setPosition(new Location(stash.exit[0], stash.exit[1], 0));
  const attributes = { ...(playerSave.attributes ?? {}) };
  for (const [key, value] of Object.entries(stash.attributes)) {
    if (value === undefined || value === null) delete attributes[key];
    else attributes[key] = value;
  }
  const dragonfire = stash.timers?.dragonfire;
  attributes[Dragonfire.ATTR_DRAGONFIRE_STATE] = dragonfire
    ? { tier: dragonfire.tier, label: dragonfire.label, endsAt: Date.now() + dragonfire.seconds * 1000, warned: false }
    : null;
  // The saved tier too: it's what a relog rebuilds the antifire from, and the live one is the arena's.
  attributes[Dragonfire.ATTR_DRAGONFIRE_TIER] = dragonfire ? { tier: dragonfire.tier, label: dragonfire.label } : null;
  playerSave.attributes = attributes;
}

function attachStash(api) {
  api.onCustomEvent("persistence:snapshot", snapshot);
}

module.exports = { attachStash, save, restore, stashed, clear, snapshot, COMBAT_SKILLS };
