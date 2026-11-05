/**
 * A league character on login (every login on a league world): joins the world's league the
 * first time (starting levels from the Wiki, the starter kit as recorded), gets the league varbits
 * the client's journal and panels read, its XP rate, the league content every plugin contributes (Content.LeagueMode),
 * plays as a standard Ironman (Wiki "Player restrictions": every league player is one; set through
 * the Ironman plugin's `ironman:set-mode` at every login the character is anything else, and kept,
 * since `ironman:change-mode` is refused for a league character), and answers `league:profile`
 * ({ player } -> { league }) for every other plugin. A main character (a plain world) gets nothing.
 */
const Common = require("./Common.LeagueMode");

/** world.json pluginConfig: when the league started (an ISO date), for the client's league clock; beside `league:type`. */
const START_CONFIG = "league:start";

/**
 * The varbits a league account carries (capture 227/00070 login): account, type, the tutorial's
 * stage (Tutorial's `league:tutorial-stage`, else the finished value the journal tab needs), the client's date (current_runeday, which live sends with the
 * journal and the Info panel reads) and, when the world says when its league began, that start.
 */
function sendVarbits(player, type) {
  const { varbits, varps, tutorialCompletedValue } = Common.data;
  const sender = player.getPacketSender();
  sender.sendVarbit(varbits.account, 1);
  sender.sendVarbit(varbits.type, type);
  const tutorial = { player, stage: tutorialCompletedValue };
  Common.api.emitCustomEvent("league:tutorial-stage", tutorial);
  sender.sendVarbit(varbits.tutorialCompleted, tutorial.stage);
  sender.sendVarbit(varbits.runeday, Common.runeday());
  const start = Date.parse(String(Common.api.getPluginConfig(START_CONFIG, "")));
  if (Number.isFinite(start)) sender.sendConfig(varps.leagueStart, Math.floor(start / 60000));
}

/** A new league character starts with the league's levels (Wiki: Trailblazer Reloaded starts at Herblore 3, Runecraft 5, Agility 10). */
function applyStartingLevels(player, type) {
  const { Skill } = Common.core;
  const SkillManager = Common.api.getSkillManager();
  const skills = player.getSkillManager();
  for (const [name, level] of Object.entries(Common.league(type).startingLevels ?? {})) {
    const skill = Skill[name];
    if (!skill || skills.getMaxLevel(skill) >= level) continue;
    const experience = SkillManager.getExperienceForLevel(level);
    skills.setExperiences(skill, experience, false);
    skills.setMaxLevels(skill, level, false);
    skills.setCurrentLevels(skill, level, true);
  }
}

/**
 * A new league character's inventory (`starterKit`, obj gameval names): Demonic Pacts' is what live
 * sends at the first login (237/01098), the Lumbridge kit and a Dramen staff. Given once, as the
 * character joins. A name the cache lacks is skipped and logged (the tests check every name).
 */
function giveStarterKit(player, type) {
  const kit = Common.league(type).starterKit;
  if (!Array.isArray(kit)) return;
  const inventory = player.getInventory();
  for (const [name, amount] of kit) {
    const id = Common.core.CacheDefinitions.getObjId(name);
    if (id === null) Common.api.log?.("starter kit: no obj", { name });
    else inventory.add(new Common.core.Item(id, amount));
  }
}

/**
 * The league's automatic quests (`startQuests`; Demonic Pacts: Druidic Ritual, Rune Mysteries and
 * the rest the Wiki lists), at every login so a character made before the list gets them too; the
 * quests already complete are left alone, and none gives experience or items (`league:complete-quests`,
 * `items: false`): live's new Demonic Pacts character holds only the starter kit (237/01098), no Air
 * talisman, Elemental shield or Wolfbane.
 */
function completeStartQuests(player, type) {
  const quests = Common.league(type).startQuests;
  if (Array.isArray(quests) && quests.length) Common.api.emitCustomEvent("league:complete-quests", { player, quests, items: false });
}

/** The mode the Ironman plugin reports ("none" without one), or undefined when that plugin is not loaded. */
function ironmanMode(player) {
  const query = { player };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode;
}

/**
 * Every league player is a standard Ironman (Wiki): any other mode (none, or one an admin or an
 * earlier save gave it) is set right at every login, so characters made before this rule get it
 * too. Nothing happens when the Ironman plugin is not loaded (its `ironman:mode` goes unanswered).
 */
function applyIronman(player) {
  const mode = ironmanMode(player);
  if (mode === undefined || mode === Common.data.ironmanMode) return;
  Common.api.emitCustomEvent("ironman:set-mode", { player, mode: Common.data.ironmanMode, handled: false });
}

function login({ player, isNewAccount }) {
  if (!Common.isLeagueProfile(player)) return;
  let type = Common.leagueOf(player);
  if (type === null) {
    type = Common.configuredType();
    player.setAttribute(Common.LEAGUE_TYPE_ATTRIBUTE, type);
    if (isNewAccount) {
      applyStartingLevels(player, type);
      giveStarterKit(player, type);
    }
    Common.api.emitCustomEvent("league:joined", { player, league: type });
  }
  sendVarbits(player, type);
  applyIronman(player);
  completeStartQuests(player, type);
  Common.api.emitCustomEvent("league:login", { player, league: type });
}

/**
 * The client tells a league world by the world flags it caches (varp map_flags_cached, script 206:
 * bit 30 set and bit 29 clear), not by the league varbits: the journal's Leagues tab, the summary
 * and the trophies all check it. The Wilderness plugin owns that varp and asks for extra bits.
 */
function mapFlags(request) {
  if (!request?.player || !Common.isLeagueProfile(request.player)) return;
  request.flags = (request.flags | 0) | Common.data.mapFlags.leagueWorld;
}

/** A league character's mode cannot be changed in game (the Ironman tutor, Adam): `ironman:change-mode` is refused. */
function refuseModeChange(change) {
  if (!Common.isLeagueProfile(change?.player)) return;
  change.allowed = false;
  change.reason = Common.message("ironmanLocked");
}

function profile(query) {
  if (!query?.player) return;
  query.league = Common.leagueOf(query.player);
}

/** The league's XP rate multiplies every gain (the world's own rate still applies first). */
function experienceRate(event) {
  if (!Common.isLeagueProfile(event.player)) return;
  event.multiplier *= Common.xpMultiplier(event.player);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.LEAGUE_TYPE_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onCustomEvent("league:profile", profile);
  api.onCustomEvent("world:map-flags", mapFlags);
  api.onCustomEvent("ironman:change-mode", refuseModeChange);
  api.onCanGainExperience(experienceRate);
};
