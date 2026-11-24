const { PlayerToolError, requireNativeAccess } = require("../PlayerTools");

const BOOKS = [["NORMAL", "Standard"], ["ANCIENT", "Ancient"], ["LUNAR", "Lunar"], ["ARCEUUS", "Arceuus"]];
const PRAYERS = ["PRESERVE", "RIGOUR", "AUGURY"];
const fail = message => { throw new PlayerToolError(409, message); };

function modes(api, actor, player) {
  const event = { actor, player };
  api.emitCustomEvent("admin:testing-modes", event);
  return event;
}

function rows(api, actor, player) {
  const { core } = api;
  const rows = [];
  const add = (key, name, description, actions, detail = "", tab = "TESTING") => rows.push({ key, name, description, actions, detail, tab, section: key.startsWith("mode:") ? "Temporary modes" : key.startsWith("book:") ? "Spellbooks" : key.startsWith("prayer:") ? "Prayer unlocks" : key === "bank" ? "Bank" : "Resources and combat" });
  for (const [key, name] of BOOKS) add(`book:${key}`, `${name} spellbook`,
    "Switch instantly, bypassing unlock requirements. Clears autocast when changing books.", ["Switch"],
    player.getSpellbook() === core.MagicSpellbook[key] ? " (current)" : "");
  add("restore", "Full restore", "Restore current skills, hitpoints, prayer, run and special attack. Cure poison, venom and disease. Base levels and XP stay the same.", ["Restore"]);
  add("hp", "Hitpoints", "Set current hitpoints between 1 and the base level. Base level and XP stay the same.", ["Full", "Set amount", "1 HP"], ` ${player.getHitpoints()}/${player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS)}`);
  add("prayer", "Prayer points", "Set current prayer points between 0 and the base level. Base level and XP stay the same.", ["Full", "Set amount", "Empty"], ` ${player.getSkillManager().getCurrentLevel(core.Skill.PRAYER)}`);
  add("run", "Run energy", "Set run energy between 0 and 100 percent.", ["Full", "Set amount", "Empty"], ` ${player.getRunEnergy()}%`);
  add("special", "Special attack", "Set special attack energy between 0 and 100 percent.", ["Full", "Set amount", "Empty"], ` ${player.getSpecialPercentage()}%`);
  add("cure", "Cure ailments", "Remove poison, venom and disease without granting lasting immunity.", ["Cure"]);
  add("restrictions", "Clear combat restrictions", "Clear Tele Block, prayer block, freeze and stun, including their immunity timers.", ["Clear"]);
  add("combat", "Stop combat", "Stop this player's current attack and movement. Other creatures can attack again; pending hits still land.", ["Stop"]);
  add("prayers-off", "Deactivate prayers", "Turn off active standard prayers. TSPS has no supported alternate prayer book.", ["Deactivate"]);
  for (const prayer of PRAYERS) add(`prayer:${prayer}`, `Unlock ${prayer[0]}${prayer.slice(1).toLowerCase()}`,
    "Permanently unlock this scroll prayer. Normal level requirements still apply.", ["Unlock"]);
  const state = modes(api, actor, player);
  for (const [key, name, description] of [
    ["invisible", "Invisible", "Hide the selected player's model, overheads and minimap dot. Combat participation stays active. Session only."],
    ["health", "Infinite hitpoints", "Restore hitpoints now and prevent HP loss. Session only."],
    ["prayer", "Infinite prayer", "Restore prayer now and prevent active-prayer and supported combat prayer drain. Session only."],
    ["run", "Infinite run energy", "Keep run energy full. Session only."],
    ["runes", "Infinite runes", "Cast without owning or consuming spell runes. Keeps normal Magic XP and other spell requirements. Does not create inventory items. Session only."],
    ["special", "Infinite special attack", "Restore special energy and bypass special attack energy costs. Session only."],
    ["noclip", "Noclip", "Ignore movement collision for the selected player. Session only."],
  ]) {
    if (state.allowed?.[key]) add(`mode:${key}`, name, description, ["Enable", "Disable"], state[key] ? " (on)" : " (off)", "GODMODE");
  }
  const tools = { actor, player };
  api.emitCustomEvent("admin:testing-tools", tools);
  if (tools.allowed?.npc) {
    add("spawn-npcs", "Spawn test NPCs", "Enter NPC ID and count, 1 to 20. Spawn at the selected player's location, capped at 100 active panel spawns per admin. Never saved; no default respawn after death.", ["Spawn"], "", "NPCS");
    add("remove-npcs", "Remove test NPCs", "Remove only NPCs you spawned through this panel, including spawns at another player's location. Also cleaned up when you log out. Boss-created adds are managed by their encounter.", ["Remove"], ` (${tools.spawned})`, "NPCS");
  }
  if (actor === player && actor.getRights().getId() >= core.PlayerRights.OWNER.getId() && core.PluginManager.playerHasCommandRights(actor, "bank")) {
    add("bank", "Open bank", "Open your bank at your current location. Replaces this panel. Uses the existing bank command's permission.", ["Open"]);
  }
  return rows;
}

function resourceLimit(core, player, key) {
  if (key === "hp") return player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  if (key === "prayer") return player.getSkillManager().getMaxLevel(core.Skill.PRAYER);
  return 100;
}

function setResource(core, player, key, amount) {
  if (key === "hp" || key === "prayer") player.getSkillManager().setCurrentLevels(key === "hp" ? core.Skill.HITPOINTS : core.Skill.PRAYER, amount);
  else if (key === "run") { player.setRunEnergy(amount); player.getPacketSender().sendRunEnergy(); }
  else { player.setSpecialPercentage(amount); core.CombatSpecial.updateBar(player); }
}

function cure(api, player) {
  player.setPoisonDamage(0);
  player.setVenomed(false);
  api.emitCustomEvent("disease:cure", { player, immunity: 0 });
}

// Called only by the authenticated native panel, never by a command string or public endpoint.
async function apply(api, actor, player, body) {
  const { core } = api;
  const command = body.testing === "special" || body.testing === "restore" ? "spec"
    : body.testing?.startsWith("prayer:") ? "unlockprayers" : null;
  requireNativeAccess(core, actor, player, command ? [command] : []);
  if (core.Server.isShuttingDown()) fail("Wait until the server has finished restarting.");
  if (!player?.isRegistered() || core.World.getPlayerByName(player.getUsername()) !== player) fail("The player is offline.");
  if (player.getProfile() !== (core.GameConstants.WORLD_PROFILE ?? "main")) fail("The player is on a different world profile.");
  if (player.isDyingReturn() || player.getHitpoints() <= 0 || player.isTeleportingReturn()) fail("Wait until the player is alive and has finished teleporting.");
  const entry = rows(api, actor, player).find(entry => entry.key === body.testing);
  if (!entry || !Number.isInteger(body.option) || !entry.actions[body.option]) throw new PlayerToolError(400, "Choose an available testing action.");
  const persistence = core.GameConstants.PLAYER_PERSISTENCE;
  if (persistence.constructor.name === "NullPlayerPersistence") fail("Enable player persistence before using player tools.");
  const key = entry.key;
  let actionMessage;
  if (key.startsWith("book:")) core.MagicSpellbook.changeSpellbook(player, core.MagicSpellbook[key.slice(5)], true, null);
  else if (["hp", "prayer", "run", "special"].includes(key)) {
    const minimum = key === "hp" ? 1 : 0;
    const maximum = resourceLimit(core, player, key);
    const amount = body.option === 0 ? maximum : body.option === 2 ? minimum : body.amount;
    if (!Number.isInteger(amount) || amount < minimum || amount > maximum) throw new PlayerToolError(400, `Enter a whole amount from ${minimum} to ${maximum}.`);
    setResource(core, player, key, amount);
  } else if (key === "restore") {
    const skills = player.getSkillManager();
    for (const skill of core.Skill.values()) skills.setCurrentLevels(skill, skills.getMaxLevel(skill));
    setResource(core, player, "run", 100);
    setResource(core, player, "special", 100);
    cure(api, player);
  } else if (key === "cure") cure(api, player);
  else if (key === "restrictions") {
    player.getCombat().getTeleblockTimer().stop();
    player.getCombat().getPrayerBlockTimer().stop();
    for (const timer of ["FREEZE", "FREEZE_IMMUNITY", "STUN", "STUN_IMMUNITY"]) player.getTimers().cancel(core.TimerKey[timer]);
  } else if (key === "combat") player.getCombat().reset();
  else if (key === "prayers-off") core.PrayerHandler.deactivatePrayers(player);
  else if (key.startsWith("prayer:")) {
    const event = { player, prayer: core.PrayerData[key.slice(7)] };
    api.emitCustomEvent("prayer:unlock", event);
    if (!event.handled) fail("PrayerUnlocks is unavailable. Enable it on the next server start.");
  } else if (key.startsWith("mode:")) {
    const event = { actor, player, action: "set", mode: key.slice(5), enabled: body.option === 0 };
    api.emitCustomEvent("admin:testing-modes", event);
    if (!event.handled) fail(event.error ?? "Admin testing modes are unavailable.");
  } else if (["spawn-npcs", "remove-npcs"].includes(key)) {
    const event = { actor, player, action: key, id: body.npcId, amount: body.count };
    api.emitCustomEvent("admin:testing-tools", event);
    if (!event.handled) fail(event.error ?? "Admin testing tools are unavailable.");
    actionMessage = event.message;
  } else if (key === "bank") player.getBank(player.getCurrentBankTab()).open();
  const message = actionMessage ?? `${entry.name}: ${entry.actions[body.option]} applied to ${player.getUsername()}.`;
  if (!["bank", "spawn-npcs", "remove-npcs"].includes(key) && !key.startsWith("mode:")) {
    try {
      persistence.save(player, `admin-testing-${key}`);
      await persistence.flush();
    } catch (error) {
      console.error("[admin-panel] Testing change could not be saved", error);
      throw new PlayerToolError(500, "The live change happened, but saving failed. Check the server log before repeating it.");
    }
  }
  player.sendMessage(`[Admin] ${message}`);
  return { ok: true, message };
}

module.exports = { rows, apply };
