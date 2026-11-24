// Live container edits shared by authenticated player-tool adapters. No saved-file edits.
const fail = message => { const error = new Error(message); error.status = 409; throw error; };
const signature = item => JSON.stringify([item?.getId(), item?.getAmount(), item?.getMeta?.() ?? null]);
const fingerprint = container => container.getItems().map(signature).join("|");
const EQUIPMENT_NAMES = { HEAD_SLOT: "Head", CAPE_SLOT: "Cape", AMULET_SLOT: "Neck", WEAPON_SLOT: "Weapon",
  BODY_SLOT: "Body", SHIELD_SLOT: "Shield", LEG_SLOT: "Legs", HANDS_SLOT: "Hands", FEET_SLOT: "Feet", RING_SLOT: "Ring", AMMUNITION_SLOT: "Ammo" };
const equipmentNames = core => new Map(Object.entries(EQUIPMENT_NAMES).map(([key, name]) => [core.Equipment[key], name]));
function container(core, player, name, tab = 0) {
  if (name === "inventory") return player.getInventory();
  if (name === "equipment") return player.getEquipment();
  if (name !== "bank" || !Number.isInteger(tab) || tab < 0 || tab >= core.Bank.BANK_SEARCH_TAB_INDEX) fail("Choose a bank tab.");
  return player.getBank(tab);
}
function entries(core, player, name) {
  const tabs = name === "bank" ? Array.from({ length: core.Bank.BANK_SEARCH_TAB_INDEX }, (_, tab) => tab) : [0];
  const slots = equipmentNames(core);
  return tabs.flatMap(tab => container(core, player, name, tab).getItems().flatMap((item, slot) =>
    item && item.getId() >= 0 && item.getAmount() > 0 ? [{ container: name, bankTab: tab, slot, itemId: item.getId(), quantity: item.getAmount(),
      signature: signature(item), name: core.ItemDefinition.forId(item.getId()).getName(),
      location: name === "equipment" ? slots.get(slot) ?? "Worn slot" : name === "bank" ? `Bank tab ${tab + 1}` : `Slot ${slot + 1}` }] : []));
}
// Bank refresh can collapse and replace tab objects. Snapshot/compare every real tab
// so undo cannot lose a following tab or overwrite an intervening edit elsewhere.
function scope(core, player, name) {
  return name === "bank" ? Array.from({ length: core.Bank.BANK_SEARCH_TAB_INDEX }, (_, tab) => player.getBank(tab))
    : [container(core, player, name)];
}
const scopeFingerprint = held => held.map(fingerprint).join("\n");
function refresh(core, player, held, name) {
  held.refreshItems();
  if (name === "equipment") {
    core.BonusManager.update(player);
    core.WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  }
}
function checkedSlot(core, held, name, slot) {
  const limit = name === "bank" ? core.Bank.MAX_SLOTS : held.capacity();
  if (!Number.isInteger(slot) || slot < 0 || slot >= limit || name === "equipment" && !equipmentNames(core).has(slot)) fail("Choose a valid item slot.");
  return held.getItems()[slot];
}
function putSlot(core, held, name, slot, item) {
  if (name === "bank") while (held.getItems().length <= slot) held.getItems().push(new core.Item(-1, 0));
  held.setItem(slot, item);
}
function firstOpenSlot(core, player, name, tab=0) {
  const held=container(core,player,name,tab),items=held.getItems();
  const limit=name==='bank'?core.Bank.MAX_SLOTS:held.capacity();
  for(let slot=0;slot<limit;slot++) if(!items[slot] || items[slot].getId()<0) return slot;
  return -1;
}
function equipAllowed(core, player, slot, item) {
  if (!item || item.getId() < 0) return;
  const definition = item.getDefinition();
  if (definition.getEquipmentType().getSlot() !== slot) fail("That item belongs in a different equipment slot.");
  const unmet = core.EquipmentRequirements.getUnmet(player, definition);
  if (unmet) fail(core.EquipmentRequirements.message(unmet));
  if (!definition.isStackable() && item.getAmount() !== 1) fail("Equip one of this item at a time.");
  if (core.PluginManager.emitCanEquip(player, slot, item) === false) fail("This equipment cannot be equipped now.");
}
function apply(core, player, body) {
  const held = container(core, player, body.container, body.bankTab ?? 0);
  const affected = scope(core, player, body.container);
  const before = affected.map(held => held.getCopiedItems());
  let message;
  if (body.mode === "undo") {
    const undo = body.undo;
    if (!undo || undo.container !== body.container || (body.container !== "bank" && undo.held !== held)
      || scopeFingerprint(affected) !== undo.after) fail("Items changed since this edit. Undo is no longer available.");
    if (body.container === "equipment") {
      for (let slot = 0; slot < before[0].length; slot++) {
        const item = before[0][slot], restored = undo.before[0][slot];
        if (signature(item) === signature(restored)) continue;
        if (item.getId() >= 0 && core.PluginManager.emitCanUnequip(player, slot, item) === false) fail("This equipment cannot be removed now.");
        if (restored.getId() >= 0 && (core.EquipmentRequirements.getUnmet(player, restored.getDefinition()) ||
          core.PluginManager.emitCanEquip(player, slot, restored) === false)) fail("This equipment cannot be restored now.");
      }
    }
    affected.forEach((target, index) => target.setItems(undo.before[index].map(item => item.clone())));
    message = `Undid the item edit for ${player.getUsername()}.`;
  } else if (body.mode === "set" || body.mode === "increase") {
    const item = checkedSlot(core, held, body.container, body.slot);
    if (!item || item.getId() < 0 || signature(item) !== body.signature) fail("That slot changed. Select the current item again.");
    const adding=body.mode==='increase';
    if (!Number.isInteger(body.quantity) || body.quantity < (adding?1:0) || body.quantity > 2147483647) fail(adding?"Enter a positive whole quantity up to 2147483647.":"Enter a whole quantity from 0 to 2147483647.");
    const quantity=adding?item.getAmount()+body.quantity:body.quantity;
    if(quantity>2147483647) fail("The item stack is full.");
    if (body.container !== "bank" && !item.getDefinition().isStackable() && quantity > 1) fail("This item uses one per slot. Add another through an empty slot.");
    if (body.container === "equipment") {
      if (core.PluginManager.emitCanUnequip(player, body.slot, item) === false) fail("This equipment cannot be changed now.");
      if (quantity) equipAllowed(core, player, body.slot, item.clone().setAmount(quantity));
    }
    if (!quantity) held.deleteAtSlot(body.slot, item.getAmount(), false);
    else held.setItem(body.slot, item.clone().setAmount(quantity));
    message = adding?`Added ${body.quantity} x ${item.getDefinition().getName()} to ${player.getUsername()}'s ${body.container}.`
      :`Set ${item.getDefinition().getName()} to ${quantity} in ${player.getUsername()}'s ${body.container}.`;
  } else if (body.mode === "move") {
    const item = checkedSlot(core, held, body.container, body.slot);
    const destination = container(core, player, body.container, body.destinationBankTab ?? body.bankTab ?? 0);
    const other = checkedSlot(core, destination, body.container, body.destinationSlot);
    if (!item || item.getId() < 0 || signature(item) !== body.signature || signature(other) !== body.destinationSignature) fail("An item moved during the drag. Try again.");
    if (held === destination && body.slot === body.destinationSlot) fail("Drop on another slot.");
    if (body.container === "equipment") {
      if (core.PluginManager.emitCanUnequip(player, body.slot, item) === false || other?.getId() >= 0 && core.PluginManager.emitCanUnequip(player, body.destinationSlot, other) === false) fail("This equipment cannot be moved now.");
      equipAllowed(core, player, body.destinationSlot, item);
      equipAllowed(core, player, body.slot, other);
    }
    const merge = body.container === "bank" && other?.getId() === item.getId() && JSON.stringify(other.getMeta?.()) === JSON.stringify(item.getMeta?.());
    if (merge && item.getAmount() + other.getAmount() > 2147483647) fail("The destination stack is full.");
    putSlot(core, destination, body.container, body.destinationSlot, merge ? other.clone().setAmount(item.getAmount()+other.getAmount()) : item.clone());
    putSlot(core, held, body.container, body.slot, merge || !other ? new core.Item(-1,0) : other.clone());
    message = `Moved ${item.getDefinition().getName()} in ${player.getUsername()}'s ${body.container}.`;
  } else if (body.mode === "remove") {
    if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot >= held.capacity()) fail("Select an occupied slot.");
    const item = held.getItems()[body.slot];
    if (!item || signature(item) !== body.signature) fail("That slot changed. Select the current item again.");
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > item.getAmount()) fail("Enter an amount within the selected stack.");
    if (body.container === "equipment" && core.PluginManager.emitCanUnequip(player, body.slot, item) === false) fail("This equipment cannot be removed now.");
    held.deleteAtSlot(body.slot, body.quantity, false);
    message = `Removed ${body.quantity} x ${item.getDefinition().getName()} from ${player.getUsername()}'s ${body.container}.`;
  } else if (body.mode === "add") {
    if (!Number.isInteger(body.itemId) || !core.CacheDefinitions.hasItem(body.itemId) || core.CacheDefinitions.getItem(body.itemId).placeholderTemplate >= 0) fail("Choose a loaded, usable item.");
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 2147483647) fail("Enter a positive whole quantity up to 2147483647.");
    const item = new core.Item(body.itemId, body.quantity), definition = item.getDefinition();
    if(body.firstOpen) {
      if(!['inventory','bank'].includes(body.container)) fail("Choose inventory or bank.");
      const slot=firstOpenSlot(core,player,body.container,body.bankTab??0);
      if(slot<0) fail(`There is no available open slot in this ${body.container}.`);
      body={...body,slot,signature:signature(held.getItems()[slot])};
    }
    if (body.slot !== undefined) {
      const selected = checkedSlot(core, held, body.container, body.slot);
      if (signature(selected) !== body.signature) fail("That slot changed. Choose the slot again.");
      if (selected?.getId() >= 0 && body.container !== "equipment") fail("Choose an empty slot, or edit the selected stack.");
      if (body.container === "equipment" && definition.getEquipmentType().getSlot() !== body.slot) fail("That item belongs in a different equipment slot.");
    }
    let given = body.quantity;
    if (body.container === "equipment") {
      const slot = definition.getEquipmentType().getSlot();
      if (!equipmentNames(core).has(slot)) fail("This item cannot be equipped.");
      const unmet = core.EquipmentRequirements.getUnmet(player, definition);
      if (unmet) fail(core.EquipmentRequirements.message(unmet));
      if (core.PluginManager.emitCanEquip(player, slot, item) === false) fail("This item cannot be equipped now.");
      if (!definition.isStackable() && body.quantity !== 1) fail("Equip one of this item at a time.");
      const existing = held.getItems()[slot];
      if (existing.getId() >= 0 && (existing.getId() !== body.itemId || !definition.isStackable() || existing.getMeta?.())) fail("Remove the item already in this equipment slot first.");
      if (definition.isDoubleHanded() && held.getItems()[core.Equipment.SHIELD_SLOT].getId() >= 0) fail("Remove the shield before equipping a two-handed weapon.");
      if (slot === core.Equipment.SHIELD_SLOT && held.getItems()[core.Equipment.WEAPON_SLOT].getId() >= 0 && held.getItems()[core.Equipment.WEAPON_SLOT].getDefinition().isDoubleHanded()) fail("Remove the two-handed weapon before equipping a shield.");
      const total = (existing.getId() === body.itemId ? existing.getAmount() : 0) + body.quantity;
      if (total > 2147483647) fail("The equipment stack is full.");
      held.setItem(slot, new core.Item(body.itemId, total));
    } else {
      const room = held.getAddableAmount(item);
      if (room < 1) fail("There is no room for this item.");
      given = Math.min(room, body.quantity);
      item.setAmount(given);
      if (body.slot !== undefined && (body.firstOpen || !(body.container === "bank" && held.contains(body.itemId)))) {
        const first = body.container === "bank" || definition.isStackable() ? given : 1;
        putSlot(core, held, body.container, body.slot, new core.Item(body.itemId, first));
        if (given > first) held.add(new core.Item(body.itemId, given-first), false);
      } else held.add(item, false);
    }
    message = `Added ${given} x ${definition.getName()} to ${player.getUsername()}'s ${body.container}.${given < body.quantity ? ` Only ${given} of ${body.quantity} fit.` : ""}`;
  } else fail("Choose a valid item action.");
  refresh(core, player, held, body.container);
  return { message, undo: body.mode === "undo" ? null : { held, before, after: scopeFingerprint(scope(core, player, body.container)), container: body.container, bankTab: body.bankTab ?? 0 } };
}
module.exports = { entries, apply, fingerprint, signature, container, firstOpenSlot,
  viewFingerprint: (core, player, name) => scopeFingerprint(scope(core, player, name)) };
