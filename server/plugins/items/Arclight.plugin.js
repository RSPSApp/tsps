/** Wiki Arclight: altar creation, shard charges and per-sword infusion for Emberlight. */
const ARC_META = 'arclight';
const MAX_CHARGES = 10000;
let core;
let pluginApi;

function state(item) {
  const saved = item.getMetaValue(ARC_META);
  return {
    charges: Math.max(0, Math.min(MAX_CHARGES, saved?.charges ?? (item.getId() === core.ItemIdentifiers.ARCLIGHT ? 1000 : 0))),
    infusion: Math.max(0, Math.min(MAX_CHARGES, saved?.infusion ?? 0)),
  };
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

/** The chat type of a mesbox line, as the Castle Wars lobby and the Mime event send them; the number is not verified by this capture (it shows only `type=mesbox`). */
const MESBOX_CHAT = 115;

/**
 * rsprox 3333: the text goes to the chat as a mesbox line, and a box shows it. The refusal is an
 * OBJECTBOX_DOUBLE (interface 11) with the shard and Darklight; the made box is an OBJECTBOX (interface 193) with Arclight.
 */
function box(player, entry) {
  player.getPacketSender().sendTypedMessage(MESBOX_CHAT, entry.getText());
  const { DialogueChainBuilder, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(entry, new EndDialogue(1)));
}

/** Darklight on the Catacombs altar (rsprox 3333 ticks 4099-4105): asks first, then combines in place. */
function enhance(event) {
  const { player, item, objectId } = event, I = core.ItemIdentifiers;
  if (objectId !== core.ObjectIdentifiers.ALTAR_52) return false;
  if (player.getInventory().getAmount(I.ANCIENT_SHARD) < 3) {
    player.sendMessage('You need three ancient shards to enhance Darklight.');
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    player,
    'Combine Darklight with three ancient shards?',
    'Yes.',
    () => combine(player, item),
    'No.',
    () => {},
  );
}

/** The answer is Yes: checked again, as the shards or the sword may have gone while the question was open. */
function combine(player, item) {
  const I = core.ItemIdentifiers;
  // The very object that was clicked: wielding it meanwhile leaves it detached and still saying Darklight.
  if (!player.getInventory().getItems().includes(item) || item.getId() !== I.DARKLIGHT
      || player.getInventory().getAmount(I.ANCIENT_SHARD) < 3) return;
  player.getInventory().deleteNumber(I.ANCIENT_SHARD, 3);
  item.setId(I.ARCLIGHT).setMetaValue(ARC_META, { charges: 1000, infusion: 0 });
  refresh(player);
  box(player, new core.ItemStatementDialogue(0, I.ARCLIGHT,
    'You combine Darklight with the shards and it seems to glow in your hands creating Arclight. Your Arclight has 1000 charges.'));
}

function charge(event) {
  const I = core.ItemIdentifiers, ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(I.ANCIENT_SHARD)) return;
  if (ids.includes(I.DARKLIGHT)) {
    // Away from the altar (rsprox 3333 tick 3081); on it, the altar's own use asks first.
    event.handled = true;
    box(event.player, new core.DoubleItemStatementDialogue(0, I.ANCIENT_SHARD, I.DARKLIGHT,
      'You require additional power from the catacombs altar to create Arclight.'));
    return;
  }
  const sword = [event.usedItem, event.usedWithItem].find(i => [I.ARCLIGHT, I.ARCLIGHT_INACTIVE_].includes(i.getId()));
  if (!sword) return;
  event.handled = true;
  const current = state(sword), inventory = event.player.getInventory();
  if (current.charges >= MAX_CHARGES) {
    event.player.sendMessage('Your Arclight is already fully charged.');
    return;
  }
  const shards = Math.min(inventory.getAmount(I.ANCIENT_SHARD), Math.ceil((MAX_CHARGES - current.charges) / 1000) * 3);
  if (!shards) return;
  inventory.deleteNumber(I.ANCIENT_SHARD, shards);
  current.charges = Math.min(MAX_CHARGES, current.charges + Math.floor(shards / 3) * 1000 + (shards % 3) * 333);
  sword.setId(I.ARCLIGHT).setMetaValue(ARC_META, current);
  refresh(event.player);
}

function check({ player, item }) {
  const current = state(item);
  player.sendMessage(`Your Arclight has ${current.charges} charges and ${Math.floor(current.infusion / 100)}% infusion.`);
}

function hitResolved({ attacker, hit }) {
  if (!attacker?.isPlayer() || !hit.isAccurate() || hit.getTotalDamage() <= 0 || hit.getCombatType() !== core.CombatType.MELEE) return;
  if (hit.getCombatMethod() === core.CombatSpecial.getById('arclight')?.getCombatMethod()) return;
  const player = attacker.getAsPlayer(), sword = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (sword?.getId() !== core.ItemIdentifiers.ARCLIGHT) return;
  // Content may spare the charge (a league fragment): the same question every melee weapon with charges asks.
  const consume = { player, itemId: sword.getId(), skip: false };
  pluginApi?.emitCustomEvent('combat:melee-charge', consume);
  pluginApi?.emitCustomEvent('combat:consume-charge', consume);
  if (consume.skip) return;
  const current = state(sword);
  current.charges = Math.max(0, current.charges - 1);
  current.infusion = Math.min(MAX_CHARGES, current.infusion + 1);
  sword.setMetaValue(ARC_META, current);
  if (!current.charges) {
    sword.setId(core.ItemIdentifiers.ARCLIGHT_INACTIVE_);
    refresh(player);
    player.sendMessage('Your Arclight has run out of charges. Its infusion is preserved.');
  }
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.onItemOnObject('Darklight', 'Altar', enhance, { noted: false });
  api.onItemOnItem(charge, { noted: false });
  api.onItemAction('Arclight', { Check: check });
  api.onItemAction('Arclight (inactive)', { Check: check });
  api.onCombatHitResolved(hitResolved);
}

module.exports = { name: 'Arclight', members: true, state, register(api) { attach(api); }, _test: { enhance, charge, hitResolved } };
