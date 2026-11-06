const { JEWELLERY } = require("./Teleports.Jewellery");
const QuestRuntime = require("../quests/QuestRuntime");

const RUNE_CHARGES = 6;
const GUILD_CHARGES = 4;
const WEALTH_CHARGES = 5;
const ARDOUGNE_HARD_TASK = "recharge-some-jewellery-at-the-totem-in-the-lege";
const rechargeTables = new WeakMap();

function rechargeTable(core) {
  if (rechargeTables.has(core)) return rechargeTables.get(core);
  const table = new Map();
  for (const piece of JEWELLERY) {
    if (!piece.recharge) continue;
    table.set(piece.spent, { piece, charges: 0 });
    for (const [id, charges] of piece.charged) table.set(id, { piece, charges });
  }
  const ids = core.ItemIdentifiers;
  const rings = [
    [ids.RING_OF_WEALTH, ids.RING_OF_WEALTH_1_, ids.RING_OF_WEALTH_2_, ids.RING_OF_WEALTH_3_, ids.RING_OF_WEALTH_4_, ids.RING_OF_WEALTH_5_],
    [ids.RING_OF_WEALTH_I_, ids.RING_OF_WEALTH_I1_, ids.RING_OF_WEALTH_I2_, ids.RING_OF_WEALTH_I3_, ids.RING_OF_WEALTH_I4_, ids.RING_OF_WEALTH_I5_],
  ];
  for (const [index, ringIds] of rings.entries()) {
    const piece = { recharge: { wealth: true }, charged: [[ringIds[WEALTH_CHARGES], WEALTH_CHARGES]] };
    ringIds.forEach((id, charges) => table.set(id, { piece, charges }));
    // Cache variants used by the same ring family, with five or one charge.
    const variants = index === 0
      ? [ids.RING_OF_WEALTH_5__3, ids.RING_OF_WEALTH_1__3]
      : [ids.RING_OF_WEALTH_I5__2, ids.RING_OF_WEALTH_I1__2];
    variants.forEach((id, i) => table.set(id, { piece, charges: i === 0 ? WEALTH_CHARGES : 1 }));
  }
  rechargeTables.set(core, table);
  return table;
}

function questComplete(player, name) {
  return QuestRuntime.getRegisteredQuests().find((quest) => quest.name === name)?.isComplete(player) ?? false;
}

function chargingSite(core, event) {
  // Packets carry the morph parent, not necessarily the displayed fountain's id.
  const definition = core.ObjectDefinition.forPlayer(event.objectId, event.player);
  const name = definition?.getName();
  if (name === "Fountain of Rune") return "rune";
  if (name === "Fountain of Heroes") return "heroes";
  // Totem Pole is shared by unrelated scenery; only the Legends' Guild variants charge.
  const ids = core.ObjectIdentifiers;
  if ([ids.TOTEM_POLE_5, ids.TOTEM_POLE_7].includes(definition?.id)) return "totem";
  return null;
}

function rechargeableEntry(core, table, item, site) {
  if (!item) return null;
  const definition = core.ItemDefinition.forId(item.getId());
  const noted = definition.isNoted();
  const entry = table.get(noted ? definition.unNote() : item.getId());
  if (!entry) return null;
  // Only skills necklaces and combat bracelets can be charged as banknotes at Rune.
  if (noted && (site !== "rune" || !entry.piece.recharge.totem)) return null;
  return { ...entry, noted };
}

function rechargeAtFountain(api, event) {
  const { core } = api;
  const site = chargingSite(core, event);
  if (!site) return;
  const { player } = event;
  const table = rechargeTable(core);
  const used = rechargeableEntry(core, table, event.item, site);
  if (!used) return;
  const fits = (piece) => {
    if (piece.recharge.wealth) return site === "rune";
    if (!questComplete(player, piece.recharge.quest)) return false;
    if (site === "rune") return true;
    return site === "totem" ? piece.recharge.totem === true : piece.recharge.heroes === true;
  };
  if (!fits(used.piece)) {
    event.handled = true;
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  event.handled = true;
  let eternal = false;
  let changed = false;
  let recharged = false;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) {
      const entry = rechargeableEntry(core, table, item, site);
      if (!entry || !fits(entry.piece)) continue;
      const target = entry.piece.recharge.wealth ? WEALTH_CHARGES : site === "rune" ? RUNE_CHARGES : GUILD_CHARGES;
      if (entry.charges >= target) continue;
      const chance = site === "rune" ? entry.piece.recharge.eternalChance : 0;
      if (chance && Math.random() < 1 / chance) {
        item.setId(core.ItemIdentifiers.AMULET_OF_ETERNAL_GLORY);
        eternal = true;
      } else {
        const chargedId = entry.piece.charged.find(([, charges]) => charges === target)[0];
        item.setId(entry.noted ? core.ItemDefinition.forId(chargedId).getNoteId() : chargedId);
      }
      changed = true;
      if (site === "totem" && (entry.piece.key === "skills" || entry.piece.key === "combat")) recharged = true;
    }
    container.refreshItems();
  }
  if (!changed) {
    player.sendMessage("Nothing interesting happens.");
    return;
  }
  api.getBonusManager().update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  if (recharged) api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: ARDOUGNE_HARD_TASK });
  player.sendMessage(eternal
    ? "The power of the fountain is transferred into an amulet of eternal glory. It will now have unlimited charges."
    : site === "totem"
      ? "The totem pole recharges your jewellery."
      : "You feel a power emanating from the fountain as it recharges your jewellery.");
}

module.exports = function registerRecharge(api) {
  api.onItemOnObject(rechargeAtFountain.bind(null, api));
};

module.exports._test = { rechargeAtFountain, chargingSite, rechargeableEntry, ARDOUGNE_HARD_TASK };
