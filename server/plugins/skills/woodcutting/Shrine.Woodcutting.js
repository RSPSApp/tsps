/**
 * The Woodcutting Guild's shrine, as captured: a bird's egg used on it becomes a bird nest with
 * seeds in the same slot ("You offer your bird's egg to the shrine and receive a reward.", the
 * offering count, 3705, a projectile and sound in the egg's colour). The Wiki adds 100 Prayer XP
 * (the capture shows none; the Wiki is followed) and a 1/1200 chance of each evil chicken piece
 * instead of the nest. Praying at it is the Altars plugin's.
 */
const GuildData = require("./GuildData.Woodcutting");

const OFFERINGS_ATTRIBUTE = "woodcutting-guild:shrine-offerings";

let core = null;
let SHRINE = null;

/** One of the four evil chicken pieces at 1/1200 each, otherwise the seed nest. */
function reward(random = Math.random) {
  const { chance, pieces } = SHRINE.evilChicken;
  for (const piece of pieces) if (random() * chance < 1) return piece;
  return SHRINE.nest;
}

function offerEgg(event) {
  const egg = SHRINE.eggs[String(event.itemId)];
  if (!egg || event.objectId !== SHRINE.id) return false;
  const { player } = event;
  const inventory = player.getInventory();
  if (inventory.get(event.itemSlot)?.getId() !== event.itemId) return true;
  inventory.setItem(event.itemSlot, new core.Item(reward(), 1));
  inventory.refreshItems?.();
  player.getSkillManager().addExperiences(core.Skill.PRAYER, SHRINE.xp);
  const count = (Number(player.getAttribute(OFFERINGS_ATTRIBUTE)) || 0) + 1;
  player.setAttribute(OFFERINGS_ATTRIBUTE, count);
  player.sendMessage(SHRINE.messages.offer);
  player.sendMessage(count === 1 ? SHRINE.messages.countOne : SHRINE.messages.count.replace("{count}", String(count)));
  player.performAnimation(new core.Animation(SHRINE.anim));
  const { from, to, startCycle, endCycle, angle, startHeight, endHeight } = SHRINE.projectile;
  const { x, y, z } = event.location;
  new core.Projectile(
    new core.Location(x + from[0], y + from[1], z), new core.Location(x + to[0], y + to[1], z), null,
    egg.projectile, startCycle, endCycle, startHeight, endHeight, player.getPrivateArea(),
  ).withAngle(angle).sendProjectile();
  player.getPacketSender().sendSound(egg.sound, 1, 0);
  return true;
}

function attach(api) {
  core = api.core;
  SHRINE = GuildData.load(core).shrine;
  api.persistAttribute(OFFERINGS_ATTRIBUTE);
  api.onItemOnObject("Bird's egg", "Shrine", offerEgg);
}

module.exports = { attach, offerEgg, reward, OFFERINGS_ATTRIBUTE };
