const { JEWELLERY } = require("./Teleports.Jewellery");
const QuestRuntime = require("../quests/QuestRuntime");

const RUNE_CHARGES = 6;
const GUILD_CHARGES = 4;
const WEALTH_CHARGES = 5;
const ARDOUGNE_HARD_TASK = "recharge-some-jewellery-at-the-totem-in-the-lege";
const rechargeTables = new WeakMap();
const TOTEM_DELAY_TICKS = 2;
const TOTEM_ANIMATION = 827;
const TOTEM_NOTHING_SOUND = 2238;
const TOTEM_TEXT = {
  combat: "You feel a power emanating from the totem pole as it recharges your bracelet. You can now rub the bracelet to teleport and wear it to get information while on a Slayer assignment.",
  skills: "You feel a power emanating from the totem pole as it recharges your necklace. You can now rub the necklace to teleport and wear it to get more caskets while big net Fishing.",
};

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

/** The amulet of eternal glory's row on a league's Boosted drops page. */
const ETERNAL_SOURCE = "Fountain of Rune";

/**
 * How many times likelier content makes a glory turn eternal: "drops:chance" { player, source,
 * rules } (a league's boosted drops) answers rules on the amulet of eternal glory's name.
 */
function eternalBoost(api, player) {
  const rules = [];
  api.emitCustomEvent("drops:chance", { player, source: ETERNAL_SOURCE, rules });
  const name = String(api.core.ItemDefinition.forId(api.core.ItemIdentifiers.AMULET_OF_ETERNAL_GLORY)?.getName?.() ?? "");
  return rules.reduce((value, rule) => (rule.pattern.test(name) ? value * rule.multiplier : value), 1);
}

function rechargeAtFountain(api, event) {
  const { core } = api;
  const site = chargingSite(core, event);
  if (!site) return;
  const { player } = event;
  const table = rechargeTable(core);
  const used = rechargeableEntry(core, table, event.item, site);
  if (!used && site === "totem") {
    // RSProx 20261121T080414 tick 402: any other item; the sound comes two ticks later.
    event.handled = true;
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, "You touch the item against the totem pole... but nothing interesting happens.");
    core.TaskManager.submit(new core.CountdownTask(player, TOTEM_DELAY_TICKS, () => player.getPacketSender().sendSound(TOTEM_NOTHING_SOUND, 1, 0)));
    return;
  }
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
  let last = null;
  const pieces = new Set();
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) {
      const entry = rechargeableEntry(core, table, item, site);
      if (!entry || !fits(entry.piece)) continue;
      const target = entry.piece.recharge.wealth ? WEALTH_CHARGES : site === "rune" ? RUNE_CHARGES : GUILD_CHARGES;
      if (entry.charges >= target) continue;
      const chance = site === "rune" ? entry.piece.recharge.eternalChance : 0;
      if (chance && Math.random() * chance < eternalBoost(api, player)) {
        item.setId(core.ItemIdentifiers.AMULET_OF_ETERNAL_GLORY);
        eternal = true;
      } else {
        const chargedId = entry.piece.charged.find(([, charges]) => charges === target)[0];
        item.setId(entry.noted ? core.ItemDefinition.forId(chargedId).getNoteId() : chargedId);
        last = { key: entry.piece.key, id: chargedId };
      }
      changed = true;
      pieces.add(entry.piece.key);
      if (site === "totem" && (entry.piece.key === "skills" || entry.piece.key === "combat")) recharged = true;
    }
    container.refreshItems();
  }
  if (!changed) {
    player.sendMessage(site === "totem" ? "You don't have any jewellery that the totem can recharge." : "Nothing interesting happens.");
    return;
  }
  api.getBonusManager().update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  if (recharged) api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: ARDOUGNE_HARD_TASK });
  // `jewellery:recharged` { player, site, piece }: once per kind of piece charged ("Charge an Amulet of Glory at
  // the Fountain of Heroes"); site is "heroes", "totem" or "rune", piece the jewellery table's key ("glory").
  for (const piece of pieces) api.emitCustomEvent("jewellery:recharged", { player, site, piece });
  if (site === "totem") {
    totemBox(core, player, last);
    return;
  }
  player.sendMessage(eternal
    ? "The power of the fountain is transferred into an amulet of eternal glory. It will now have unlimited charges."
    : "You feel a power emanating from the fountain as it recharges your jewellery.");
}

/**
 * RSProx 20261121T080414 ticks 250-254 and 373-377: on arrival the touch line and anim 827 (the
 * jewellery is charged that tick); two ticks later an item box shows the last piece charged.
 */
function totemBox(core, player, last) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, "You touch the jewellery against the totem pole...");
  player.performAnimation(new core.Animation(TOTEM_ANIMATION));
  const text = TOTEM_TEXT[last?.key];
  if (!text) return;
  core.TaskManager.submit(new core.CountdownTask(player, TOTEM_DELAY_TICKS, () => {
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
      .add(new core.ItemStatementDialogue(0, last.id, text)).add(new core.EndDialogue(1)));
  }));
}

module.exports = function registerRecharge(api) {
  api.onItemOnObject(rechargeAtFountain.bind(null, api));
};

module.exports._test = { rechargeAtFountain, chargingSite, rechargeableEntry, ARDOUGNE_HARD_TASK };
