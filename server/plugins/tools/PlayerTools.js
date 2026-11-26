// Shared operations library. Neither adapter imports another plugin or its mutable state.
// All core access comes from the calling plugin API; quests use their owning plugin's event.
class PlayerToolError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MAX_QUANTITY = 2147483647;
const itemCatalogues = new WeakMap();
const position = location => ({ x: location.getX(), y: location.getY(), z: location.getZ() });

function skills(core, player) {
  const manager = player?.getSkillManager();
  return core.Skill.values().map(skill => ({
    name: skill.getName(), index: skill.getIndex(),
    minimum: skill === core.Skill.HITPOINTS ? 10 : 1,
    maximum: core.SkillManager.getMaxAchievingLevel(skill),
    ...(manager ? { level: manager.getMaxLevel(skill), current: manager.getCurrentLevel(skill), experience: manager.getExperience(skill) } : {}),
  }));
}

function destinations(core) {
  return [
    { name: "World spawn", location: core.GameConstants.DEFAULT_LOCATION },
    ...core.SpellTeleports.getTeleportDestinations().map(({ name, destination }) => ({ name, location: destination })),
  ].map(({ name, location }) => ({ name, ...position(location) }));
}

function describePlayer(api, player) {
  const quests = { player };
  if (player) api.emitCustomEvent("quests:admin", quests);
  return { enabled: true, skills: skills(api.core, player), destinations: destinations(api.core),
    ...(player ? { position: position(player.getLocation()), quests: quests.quests ?? [] } : {}) };
}

function searchItems(core, query) {
  const wanted = query.trim().toLowerCase();
  if (wanted.length < 2 && !/^\d+$/.test(wanted)) return [];
  if (wanted.length > 80) throw new PlayerToolError(400, "Use an item name of at most 80 characters.");
  let catalogue = itemCatalogues.get(core);
  if (!catalogue || Date.now() - catalogue.at > 15000) {
    const cache = core.CacheDefinitions;
    const count = (cache.getBaseCounts?.() ?? cache.getCounts()).items;
    const ids = new Set(Array.from({ length: count }, (_, id) => id));
    for (const item of cache.getCustomItems()) ids.add(item.id);
    for (const item of cache.getCustomDefinitions()) if (item.kind === "item") ids.add(item.id);
    const items = [];
    for (const id of ids) {
      if (!cache.hasItem(id)) continue;
      const definition = core.ItemDefinition.forId(id);
      const cached = cache.getItem(id);
      // Bank placeholders are not usable inventory items. Real noted variants remain searchable.
      if (cached.placeholderTemplate >= 0) continue;
      items.push({ id, name: definition.getName(), noted: definition.isNoted(), stackable: definition.isStackable() });
    }
    catalogue = { at: Date.now(), items };
    itemCatalogues.set(core, catalogue);
  }
  return catalogue.items.filter(item => item.name.toLowerCase().includes(wanted) || String(item.id) === wanted)
    .sort((a, b) => Number(b.name.toLowerCase() === wanted) - Number(a.name.toLowerCase() === wanted) ||
      a.name.localeCompare(b.name) || a.id - b.id);
}

function requireNativeAccess(core, actor, target, commands = []) {
  if (!core.PlayerRights.hasAdminRights(actor) || !core.PluginManager.playerHasCommandRights(actor, "admin")) {
    throw new PlayerToolError(403, "Admin access is no longer available.");
  }
  if (target && target.getRights().getId() > actor.getRights().getId()) {
    throw new PlayerToolError(403, "You cannot edit a higher-ranked player.");
  }
  if (!commands.length) return;
  const available = core.PluginManager.getRegisteredCommands(actor);
  for (const command of commands) {
    if (!available.some(entry => entry.command === command)) {
      throw new PlayerToolError(403, `This action requires ::${command} permission.`);
    }
  }
}

function requiredCommands(core, actor, target, body, teleportCommand) {
  const grants = actor === target ? "item" : "give";
  switch (body.action) {
    case "teleport": return [teleportCommand];
    case "give": return [grants];
    case "skill": return ["setlevel"];
    case "preset": return [body.preset === "reset" ? "reset" : "master"];
    case "quest":
    case "quest-bulk": return ["quest"];
    case "container": {
      const creating = body.mode === "add" || body.mode === "increase" || body.mode === "set" &&
        require("./Containers.PlayerTools").raisesQuantity(core, target, body);
      return creating ? ["copybank", grants] : ["copybank"];
    }
    default: return [];
  }
}

// Only the native adapter supplies a live actor. World Admin authorizes its allowed actions with the owner token.
async function applyPlayerTool(api, target, body, { actor, teleportCommand = "tele" } = {}) {
  if (!["teleport", "give", "skill", "preset", "restore", "quest", "quest-bulk", "rank", "container"].includes(body.action)) return null;
  const core = api.core;
  if (core.Server?.isShuttingDown?.()) throw new PlayerToolError(409, "Wait until the server has finished restarting.");
  if (!target || target.isRegistered?.() === false) throw new PlayerToolError(409, "The player is offline.");
  if (actor) requireNativeAccess(core, actor, target, requiredCommands(core, actor, target, body, teleportCommand));
  if (target.getProfile() !== (core.GameConstants.WORLD_PROFILE ?? "main")) throw new PlayerToolError(409, "The player is on a different world profile.");
  if (target.isDyingReturn() || target.getHitpoints() <= 0 || target.isTeleportingReturn()) {
    throw new PlayerToolError(409, "Wait until the player is alive and has finished teleporting.");
  }
  const persistence = core.GameConstants.PLAYER_PERSISTENCE;
  if (persistence.constructor.name === "NullPlayerPersistence") throw new PlayerToolError(409, "Enable player persistence before using player tools.");
  let message, extra;
  if (body.action === "container") {
    extra = require("./Containers.PlayerTools").apply(core, target, body);
    message = extra.message;
  } else if (body.action === "teleport") {
    if (target.getPrivateArea()) throw new PlayerToolError(409, "Leave the player's instance in game before using this teleport.");
    const destination = body.destination === undefined ? body : destinations(core).find(place => place.name === body.destination);
    if (!destination || ![destination.x, destination.y, destination.z].every(Number.isInteger) ||
        destination.x < 0 || destination.x > 16383 || destination.y < 0 || destination.y > 16383 || destination.z < 0 || destination.z > 3) {
      throw new PlayerToolError(400, "Choose a named destination or whole coordinates X/Y 0-16383 and plane 0-3.");
    }
    core.TeleportHandler.onTeleporting(target, body.preserveInterface !== true);
    target.moveTo(new core.Location(destination.x, destination.y, destination.z));
    message = `Teleported ${target.getUsername()} to ${destination.name ?? `${destination.x}, ${destination.y}, ${destination.z}`}.`;
  } else if (body.action === "give") {
    const { itemId, quantity } = body;
    if (!Number.isInteger(itemId) || !core.CacheDefinitions.hasItem(itemId)) throw new PlayerToolError(400, "Select an item loaded in this world.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw new PlayerToolError(400, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    const cached = core.CacheDefinitions.getItem(itemId);
    if (cached.placeholderTemplate >= 0) throw new PlayerToolError(400, "Choose a usable item, not a bank placeholder.");
    const inventory = target.getInventory();
    const room = Math.min(quantity, inventory.getAddableAmount(new core.Item(itemId, quantity)));
    if (room <= 0) throw new PlayerToolError(409, "The player's inventory has no room for this item.");
    const before = inventory.getAmount(itemId);
    inventory.adds(itemId, room);
    const given = inventory.getAmount(itemId) - before;
    if (given <= 0) throw new PlayerToolError(409, "The item could not be added to the inventory.");
    message = `Gave ${target.getUsername()} ${given} x ${core.ItemDefinition.forId(itemId).getName()}.${given < quantity ? ` Only ${given} of ${quantity} fit.` : ""}`;
  } else if (body.action === "skill") {
    const skill = core.Skill.values().find(skill => skill.getName() === body.skill);
    const minimum = skill === core.Skill.HITPOINTS ? 10 : 1;
    if (!skill || !Number.isInteger(body.level) || body.level < minimum || body.level > core.SkillManager.getMaxAchievingLevel(skill)) {
      throw new PlayerToolError(400, "Choose a skill and a level within its displayed limits.");
    }
    // Match ::setlevel, including experience, combat level, appearance and the combat tab.
    target.getSkillManager().setCurrentLevels(skill, body.level, false).setMaxLevels(skill, body.level, false)
      .setExperience(skill, core.SkillManager.getExperienceForLevel(body.level));
    core.WeaponInterfaceManager.assign(target);
    target.getUpdateFlag().flag(core.Flag.APPEARANCE);
    message = `Set ${target.getUsername()}'s ${skill.getName()} to level ${body.level}.`;
  } else if (body.action === "preset") {
    if (!["max", "combat", "reset"].includes(body.preset)) throw new PlayerToolError(400, "Choose a listed skill preset.");
    const combat = [core.Skill.ATTACK, core.Skill.DEFENCE, core.Skill.STRENGTH, core.Skill.HITPOINTS,
      core.Skill.RANGED, core.Skill.PRAYER, core.Skill.MAGIC];
    for (const skill of core.Skill.values()) {
      if (body.preset === "combat" && !combat.includes(skill)) continue;
      const level = body.preset === "reset" ? (skill === core.Skill.HITPOINTS ? 10 : 1) : core.SkillManager.getMaxAchievingLevel(skill);
      target.getSkillManager().setCurrentLevels(skill, level, false).setMaxLevels(skill, level, false)
        .setExperience(skill, core.SkillManager.getExperienceForLevel(level));
    }
    core.WeaponInterfaceManager.assign(target);
    target.getUpdateFlag().flag(core.Flag.APPEARANCE);
    message = `Applied ${body.preset} skills to ${target.getUsername()}.`;
  } else if (body.action === "rank") {
    const rights = core.PlayerRights;
    const callerRank = actor?.getRights?.().getId();
    const rank = rights?.[body.rank];
    if (!Number.isInteger(callerRank) || callerRank < rights.OWNER.getId() ||
        !rank || !["NONE", "MODERATOR", "ADMINISTRATOR", "OWNER", "DEVELOPER"].includes(body.rank) ||
        actor === target || target.getRights().getId() >= callerRank || rank.getId() >= callerRank) {
      throw new PlayerToolError(403, "Only owners can change a lower-ranked player's rank to a rank below their own. You cannot change your own rank.");
    }
    target.setRights(rank);
    target.getUpdateFlag().flag(core.Flag.APPEARANCE);
    message = `Set ${target.getUsername()}'s rank to ${body.rank.toLowerCase()}.`;
  } else if (body.action === "restore") {
    const manager = target.getSkillManager();
    for (const skill of core.Skill.values()) manager.setCurrentLevels(skill, manager.getMaxLevel(skill));
    target.setRunEnergy(100);
    message = `Restored ${target.getUsername()}'s current levels and run energy.`;
  } else {
    if (body.action === "quest-bulk") {
      if (!["complete-all", "reset-all"].includes(body.mode)) throw new PlayerToolError(400, "Choose Unlock all quests or Reset all quests.");
    } else if (typeof body.quest !== "string" || !["complete", "reset"].includes(body.mode)) {
      throw new PlayerToolError(400, "Choose a quest and Complete or Reset.");
    }
    const event = { player: target, key: body.quest, action: body.mode };
    api.emitCustomEvent("quests:admin", event);
    if (!event.handled) throw new PlayerToolError(409, "Quest tools are unavailable. Enable QuestCommand on the next server start.");
    if (event.error) throw new PlayerToolError(400, event.error);
    message = event.message;
  }
  // Persist the live entity, never patch its saved JSON underneath it.
  try {
    persistence.save(target, `player-tools-${body.action}`);
    await persistence.flush();
  } catch (error) {
    console.error(`[player-tools] Could not save ${target.getUsername()} after ${body.action}`, error);
    throw new PlayerToolError(500, "The live change happened, but saving failed. Do not repeat item or quest grants; check the server's persistence error.");
  }
  target.sendMessage(`[Admin] ${message}`);
  return { ok: true, message, ...(extra ? { undo: extra.undo } : {}) };
}

module.exports = { PlayerToolError, describePlayer, searchItems, applyPlayerTool, requireNativeAccess };
