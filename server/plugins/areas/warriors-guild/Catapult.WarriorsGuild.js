/**
 * Warriors' Guild: Gamfred's catapult room. Standing on the target with his defensive shield
 * wielded, the player picks the defence that matches what the catapult throws: 10 Defence XP and
 * a token for each block. The catapult fires every 8 ticks (Wiki). Wielding the shield swaps the
 * equipment tab for the defence styles and hides the quest, prayer, magic, options, emote and
 * music tabs until it comes off. Projectiles and animations follow Near-Reality's port.
 */
const Guild = require("./Common.WarriorsGuild");

const TARGET = [2842, 3545, 1];
const LAUNCH_FROM = [2842, 3554, 1];
const CATAPULT = [2840, 3552, 1];
const FIRE_EVERY = 8;
const LAUNCH_TICK = 3;
const LAND_TICK = 6;
const DEFENCE_XP = 10;
const TOKENS = 1;
const CATAPULT_ANIMATION = 4157;
const VIEW_DISTANCE = 15;

/** What the catapult throws: its graphic, the block that stops it, and the fall when it doesn't. */
const SHOTS = [
  { name: "spiky ball", graphic: 679, block: 4169, fall: 4172 },
  { name: "flung anvil", graphic: 680, block: 4168, fall: 4173 },
  { name: "slashing blades", graphic: 681, block: 4171, fall: 4174 },
  { name: "magic missile", graphic: 682, block: 4170, fall: 4175 },
];

/** The defence styles tab (interface 411): stab, crush, slash and magic, in SHOTS order. */
const STYLES_INTERFACE = 411;
const STYLE_BUTTONS = [6, 8, 10, 12];
const STYLE_BUTTON_UIDS = STYLE_BUTTONS.map((child) => (STYLES_INTERFACE << 16) | child);
/** Toplevel tab slots: the equipment tab, and the tabs hidden while the shield is up. */
const TOPLEVEL = 161;
const EQUIPMENT_TAB = [80, 387];
const HIDDEN_TABS = [[78, 629], [81, 541], [82, 218], [87, 116], [88, 216], [89, 239]];

const stances = new Map();
const shielded = new Set();
const cycle = { tick: 0, shot: null };

function onTarget(player) {
  return Guild.at(player, ...TARGET);
}

function holdsShield(player) {
  return Guild.wearing(player, Guild.core.Equipment.SHIELD_SLOT, Guild.ITEMS.DEFENSIVE_SHIELD);
}

function hasShield(player) {
  return holdsShield(player) || player.getInventory().contains(Guild.ITEMS.DEFENSIVE_SHIELD);
}

function playersNear([x, y, z], distance = VIEW_DISTANCE) {
  const near = [];
  for (const player of Guild.core.World.getPlayers()) {
    const at = player?.getLocation();
    if (at && at.getZ() === z && Math.abs(at.getX() - x) <= distance && Math.abs(at.getY() - y) <= distance) near.push(player);
  }
  return near;
}

// --- The tabs while the shield is wielded.

function showStyles(player) {
  const sender = player.getPacketSender();
  for (const [slot] of HIDDEN_TABS) sender.closeSubInterface((TOPLEVEL << 16) | slot);
  sender.sendTabInterface(EQUIPMENT_TAB[0], STYLES_INTERFACE);
  shielded.add(player);
}

function restoreTabs(player) {
  const sender = player.getPacketSender();
  sender.sendTabInterface(EQUIPMENT_TAB[0], EQUIPMENT_TAB[1]);
  for (const [slot, group] of HIDDEN_TABS) sender.sendTabInterface(slot, group);
  player.getEquipment().refreshItems();
  shielded.delete(player);
  stances.delete(player);
}

/** The shield comes off as soon as its wearer steps off the target. */
function takeShieldOff(player) {
  const equipment = player.getEquipment();
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() === 0) return;
  equipment.setItem(Guild.core.Equipment.SHIELD_SLOT, new Guild.core.Item(-1, 0));
  inventory.adds(Guild.ITEMS.DEFENSIVE_SHIELD, 1);
  equipment.refreshItems();
  player.getUpdateFlag().flag(Guild.core.Flag.APPEARANCE);
}

function watchShield({ player }) {
  const holding = holdsShield(player);
  if (holding && !onTarget(player)) takeShieldOff(player);
  const showing = shielded.has(player);
  if (holdsShield(player) && onTarget(player)) {
    if (!showing) showStyles(player);
  } else if (showing) {
    restoreTabs(player);
  }
}

function canWieldShield(event) {
  if (event.item?.getId() !== Guild.ITEMS.DEFENSIVE_SHIELD) return;
  if (!onTarget(event.player)) {
    event.player.sendMessage("You can only wield this shield while standing on the target.");
    event.allow = false;
  } else if (event.player.getEquipment().getItems()[Guild.core.Equipment.WEAPON_SLOT]?.getId() > 0) {
    event.player.sendMessage("You need both hands free to wield this shield.");
    event.allow = false;
  }
}

function chooseStance(event) {
  const style = STYLE_BUTTONS.indexOf(event.buttonId & 0xffff);
  if (style !== -1) stances.set(event.player, style);
}

// --- The catapult.

function defend(player, shot) {
  if (!holdsShield(player)) {
    Guild.playTranscript(api, player, Guild.NPCS.GAMFRED, "standing-on-the-marker-without-a-shield");
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0]][Guild.random(0, 2)];
    player.getMovementQueue().walkStep(dx, dy);
    return;
  }
  const { Animation, Skill } = Guild.core;
  if (stances.get(player) === SHOTS.indexOf(shot)) {
    player.performAnimation(new Animation(shot.block));
    player.getSkillManager().addExperiences(Skill.DEFENCE, DEFENCE_XP);
    Guild.credit(player, TOKENS);
    player.sendMessage(`You successfully defend against the ${shot.name}.`);
  } else {
    player.performAnimation(new Animation(shot.fall));
    Guild.damage(player, Guild.random(1, 5));
    player.sendMessage(`You fail defending against the ${shot.name}.`);
  }
}

function fire() {
  const tick = cycle.tick++ % FIRE_EVERY;
  if (tick === 0) {
    const catapult = Guild.core.MapObjects.get(Guild.core.ObjectIdentifiers.CATAPULT_11, Guild.tile(...CATAPULT), null);
    const launch = new Guild.core.Animation(CATAPULT_ANIMATION);
    if (catapult) for (const player of playersNear(CATAPULT)) player.getPacketSender().sendObjectAnimation(catapult, launch);
  } else if (tick === LAUNCH_TICK) {
    cycle.shot = SHOTS[Guild.random(0, SHOTS.length - 1)];
    const from = Guild.tile(...LAUNCH_FROM);
    const to = Guild.tile(...TARGET);
    for (const player of playersNear(CATAPULT)) {
      player.getPacketSender().sendProjectile(from, to, 0, 100, cycle.shot.graphic, 60, 15, null, 40, 5);
    }
  } else if (tick === LAND_TICK && cycle.shot) {
    for (const player of playersNear(TARGET, 0)) defend(player, cycle.shot);
    cycle.shot = null;
  }
}

function start() {
  Guild.every(null, fire);
}

// --- Gamfred hands out the shield.

function gamfredCondition({ player, npcId, text }) {
  if (npcId !== Guild.NPCS.GAMFRED) return null;
  if (text === "If the player has a defensive shield:") return hasShield(player);
  if (text === "If the player has no inventory space:") return player.getInventory().getFreeSlots() === 0;
  if (text === "If the player does not have a defensive shield:") return !hasShield(player);
  return null;
}

function giveShield(event) {
  if (event.npcId !== Guild.NPCS.GAMFRED || event.text !== "Defensive shield") return;
  if (!hasShield(event.player) && event.player.getInventory().getFreeSlots() > 0) {
    event.player.getInventory().adds(Guild.ITEMS.DEFENSIVE_SHIELD, 1);
  }
  event.handled = true;
}

function claimShield({ player }) {
  const gamfred = Guild.NPCS.GAMFRED;
  const ask = { player: "May I have a shield please?" };
  if (hasShield(player)) {
    Guild.talk(player, [ask, { npc: gamfred, text: "Silly muffin, you have one already!" }]);
  } else if (player.getInventory().getFreeSlots() === 0) {
    Guild.talk(player, [ask, { npc: gamfred, text: "I'd be happy ta give you a shield but you've no space for it." }]);
  } else {
    Guild.talk(player, [ask, { npc: gamfred, text: "Of course!" }, () => {
      player.sendMessage("The dwarf hands you a large shield.");
      player.getInventory().adds(Guild.ITEMS.DEFENSIVE_SHIELD, 1);
    }]);
  }
}

function forget({ player }) {
  stances.delete(player);
  shielded.delete(player);
}

let api;

module.exports = function attachCatapult(pluginApi) {
  api = pluginApi;
  api.onServerStartup(start);
  api.onPlayerProcess(watchShield);
  api.onCanEquip(canWieldShield);
  api.onInterfaceActionButton(STYLE_BUTTON_UIDS, chooseStance);
  api.onNpcInteraction("Gamfred", { "Claim-Shield": claimShield });
  api.onNpcDialogueCondition(gamfredCondition);
  api.onCustomEvent("npc-dialogue:action", giveShield);
  api.onPlayerLogout(forget);
};
