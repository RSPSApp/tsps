"use strict";

/**
 * The offerings ents leave at a totem (Claim, Inspect) and the Vale offerings they become
 * (Rummage, Hasty-rummage, Inspect).
 *
 * Captures (rsprox, Auburn Valley):
 * - Claim: a tick after arriving, human_pickupfloor with sound 2582, "You collect 40
 *   offerings." and the pile's varbit back to 0. Inspect: "There are ten offerings here." (mesbox).
 * - Rummage: 100 offerings at a time, every 2 ticks while there are enough: sound 1412, "You
 *   rummage through the offerings...", "You find some loot: 26 x Dirty arrowtips" (or "Bird
 *   nest" for one) and a research point (varp ent_totems_research_points). The first point also
 *   says "<col=229628>You now have 1 Vale Research Point!</col>" and "Ranulph offers rewards to
 *   those who help with his research.". Too few: an objectbox with the offerings, "You don't
 *   have enough offerings to rummage through.<br>You need at least 100.".
 * - Hasty-rummage: up to 500 at once, "You rummage through the offerings four times..." then one
 *   loot line per rummage.
 * - Inspect: an objectbox, "You have enough offerings to rummage through them<br><col=06600c>once
 *   </col>.<br><br>You've earned <col=06600c>0 Vale Research Points</col>." ("<col=06600c>4<br>
 *   <col=06600c>times</col>" for more).
 * Wiki ("Vale offerings"): the loot table, two nests from level 80 Fletching (the second on the
 * floor when there's no room).
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");
const Loot = require("./Loot.ValeTotems");

const { DATA } = Shared;
const CLAIM_DELAY = 1;
const RUMMAGE_TICKS = 2;
const GREEN = "<col=06600c>";
const RUMMAGE_COUNTS = ["", "", "twice", "three times", "four times", "five times"];

function offeringsId() {
  return Shared.obj("ent_totems_loot");
}

function siteOf(event) {
  return State.siteOfLoc(event.objectId ?? event.object?.getId?.());
}

function claim(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  Shared.face(player, State.tileOf(site));
  Shared.later(CLAIM_DELAY, () => collect(player, site));
  return true;
}

function collect(player, site) {
  const points = State.totem(player, site).points;
  if (points <= 0) return;
  if (!Shared.hasRoomFor(player, offeringsId())) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  Shared.animate(player, Shared.SEQ.CLAIM);
  Shared.sound(player, Shared.SOUND.CLAIM);
  player.getInventory().adds(offeringsId(), points);
  player.getInventory().refreshItems();
  State.set(player, site, { points: 0 });
  player.sendMessage(`You collect ${points} offerings.`);
}

function inspectPile(event) {
  const { player } = event;
  const site = siteOf(event);
  if (site == null) return false;
  const points = State.totem(player, site).points;
  Shared.statement(player, points === 1 ? "There is one offering here." : `There are ${Shared.numberWord(points)} offerings here.`);
  return true;
}

function tooFew(player) {
  Shared.itemStatement(player, offeringsId(), `You don't have enough offerings to rummage through.<br>You need at least ${DATA.rummageCost}.`);
}

/**
 * One roll: the loot, and a research point. It needs a free slot whatever the roll gives (an
 * existing stack doesn't count, as the loot isn't known in advance); false when there's no room.
 * `announce` runs once it's sure to happen.
 */
function rummageOnce(player, announce = () => {}) {
  const reward = player.getInventory().getFreeSlots() > 0 ? Loot.roll(player) : null;
  if (!reward || !Shared.hasRoomFor(player, reward.id, reward.amount)) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  announce();
  player.getInventory().delete(offeringsId(), DATA.rummageCost);
  Loot.give(player, reward);
  const points = State.researchPoints(player) + 1;
  State.setResearchPoints(player, points);
  if (points === 1) {
    player.sendMessage("<col=229628>You now have 1 Vale Research Point!</col>");
    player.sendMessage("Ranulph offers rewards to those who help with his research.");
  }
  return true;
}

function rummage({ player }) {
  if (player.getInventory().getAmount(offeringsId()) < DATA.rummageCost) {
    tooFew(player);
    return true;
  }
  Shared.startAction(player, (tick) => {
    if (tick % RUMMAGE_TICKS !== 0) return true;
    if (player.getInventory().getAmount(offeringsId()) < DATA.rummageCost) return false;
    const rummaged = rummageOnce(player, () => {
      Shared.sound(player, Shared.SOUND.RUMMAGE);
      player.sendMessage("You rummage through the offerings...");
    });
    player.getInventory().refreshItems();
    return rummaged;
  });
  return true;
}

function hastyRummage({ player }) {
  const count = Math.min(DATA.hastyRummages, Math.floor(player.getInventory().getAmount(offeringsId()) / DATA.rummageCost));
  if (count <= 0) {
    tooFew(player);
    return true;
  }
  Shared.stopAction(player);
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  Shared.sound(player, Shared.SOUND.RUMMAGE);
  player.sendMessage(count === 1 ? "You rummage through the offerings..." : `You rummage through the offerings ${RUMMAGE_COUNTS[count]}...`);
  for (let i = 0; i < count; i++) {
    if (!rummageOnce(player)) break;
  }
  player.getInventory().refreshItems();
  return true;
}

function inspect({ player }) {
  const count = Math.floor(player.getInventory().getAmount(offeringsId()) / DATA.rummageCost);
  const points = State.researchPoints(player);
  const times = count === 1 ? `<br>${GREEN}once</col>` : ` ${GREEN}${count}<br>${GREEN}times</col>`;
  Shared.itemStatement(player, offeringsId(),
    `You have enough offerings to rummage through them${times}.<br><br>You've earned ${GREEN}${points} Vale Research ${points === 1 ? "Point" : "Points"}</col>.`);
  return true;
}

function attach(api) {
  api.onObjectInteraction("Offerings", { Claim: claim, Inspect: inspectPile });
  api.onItemAction("Vale offerings", { Rummage: rummage, "Hasty-rummage": hastyRummage, Inspect: inspect });
}

module.exports = { attach };
