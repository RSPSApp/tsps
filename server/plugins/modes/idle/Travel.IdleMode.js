/**
 * Idle travel (plugins/modes/data/idle-mode.json "travel"): an idle player picks a site (a kind of
 * tree, rock, fishing spot or monster, and where) and teleports to its tile with the normal
 * teleport. The tile becomes the activity's anchor: the gathering target for auto-resume
 * (Auto.adopt) or the monster for idle combat (Combat.adopt), so the character walks to the
 * nearest one there and starts by itself. Gathering sites need the skill's level; combat sites
 * only advise a combat level. Members sites are left out of free-to-play worlds. The teleport
 * keeps the server's own rules (TeleportHandler.checkReqs: busy, deep Wilderness, teleblock).
 * The sites are checked against the cache map by server/tests/idle-travel-sites.test.cjs.
 */
const Common = require("./Common.IdleMode");
const Auto = require("./Auto.IdleMode");
const Combat = require("./Combat.IdleMode");

const COMBAT = "COMBAT";

function config() {
  return Common.data.travel;
}

/** The sites this world offers, in the data's order (members ones only on a members world). */
function sites() {
  const membersWorld = Common.core.WorldDefinition.isMembersWorld?.() !== false;
  return config().sites.filter((site) => membersWorld || !site.members);
}

function byId(id) {
  return sites().find((site) => site.id === id) ?? null;
}

/** The player's level for the site's skill (their combat level for a combat site). */
function levelFor(player, site) {
  if (site.skill === COMBAT) return player.getSkillManager().getCombatLevel();
  const skill = Common.core.Skill[site.skill];
  return skill ? player.getSkillManager().getMaxLevel(skill) : 0;
}

/** Why the player can't go there, or null when they can. A combat level is advice, not a rule. */
function refusal(player, site) {
  if (!Common.isIdle(player)) return "Turn Idle Mode on first (::idle on).";
  if (site.skill !== COMBAT && levelFor(player, site) < site.level) {
    return `You need ${Common.skillName(site.skill)} level ${site.level} for ${site.name.toLowerCase()}.`;
  }
  return null;
}

function anchorOf(site) {
  const [x, y, z = 0] = site.tile;
  return { x, y, z };
}

/** What the activity there becomes: a gathering target or a monster to fight. */
function adoptTarget(player, site) {
  const anchor = anchorOf(site);
  if (site.skill === COMBAT) Combat.adopt(player, { name: site.target, anchor });
  else Auto.adopt(player, { skill: site.skill, kind: site.kind, name: site.target, option: site.option, anchor });
}

/** Teleports the player to the site and makes it the activity. True when the teleport started. */
function travel(player, site) {
  const reason = refusal(player, site);
  if (reason) {
    player.sendMessage(reason);
    return false;
  }
  const { Location, TeleportHandler, TeleportType } = Common.core;
  player.getPacketSender().sendInterfaceRemoval();
  const anchor = anchorOf(site);
  const destination = new Location(anchor.x, anchor.y, anchor.z);
  if (!TeleportHandler.checkReqs(player, destination)) return false;
  TeleportHandler.teleport(player, destination, TeleportType[config().teleportType] ?? TeleportType.NORMAL, false);
  adoptTarget(player, site);
  // Travelling to work means working: auto-resume comes on if it was off.
  if (player.getAttribute(Common.AUTO_ATTRIBUTE) === false) Auto.setAuto(player, true);
  player.sendMessage(`You travel to ${site.place}: ${site.name.toLowerCase()}.${site.tool ? ` You'll need: ${site.tool.toLowerCase()}.` : ""}`);
  return true;
}

/** `::idle go <site>`; `::idle sites` lists them. */
function travelCommand(player, parts) {
  const choice = String(parts[1] ?? "").toLowerCase();
  if (choice === "sites") {
    player.sendMessage(`Idle travel sites: ${sites().map((site) => site.id).join(", ")}.`);
    return;
  }
  const site = byId(String(parts[2] ?? "").toLowerCase());
  if (!site) {
    player.sendMessage("Use ::idle go <site>. ::idle sites lists them; ::idle travel shows them all.");
    return;
  }
  travel(player, site);
}

module.exports = {
  COMBAT,
  COMMANDS: ["go", "sites"],
  sites,
  byId,
  levelFor,
  refusal,
  travel,
  travelCommand,
};
