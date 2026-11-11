/** Cowbell amulet: Wiki mechanics; Ring/no-air statements and sounds from rsprox 4153. */
const { plainAmount, takePlain, PRESET_TEXT } = require("../../../items/PoweredStaff");
module.exports = function attachCowbellAmulet(api) {
  const { ItemIdentifiers: I, Equipment, DialogueChainBuilder, StatementDialogue, ItemStatementDialogue,
    Animation, Graphic, TeleportType, TeleportHandler, Location, Flag, World } = api.core;
  const CHARGES_META_KEY = "cowbell-amulet:charges";
  const CHARGES_VARBIT = 20097; // cache charges_cowbell_amulet_quantity
  const MAX_CHARGES = 1000;
  const EMPTY_ID = I.COWBELL_AMULET;
  const CHARGED_ID = I.COWBELL_AMULET_2;
  const BELL_SOUND = 2192;
  // shortcut: the recording has no charged teleport; verify this field tile and timing with a teleport capture.
  const DESTINATION = new Location(3253, 3271, 0);
  const TELEPORT = new TeleportType(4, new Animation(13811), null, Animation.DEFAULT_RESET_ANIMATION,
    new Graphic(3603), null, null, { busy: true });

  const isAmulet = item => item && (item.getId() === EMPTY_ID || item.getId() === CHARGED_ID);
  const charges = item => Math.max(0, Math.min(MAX_CHARGES, Math.trunc(Number(item.getMetaValue(CHARGES_META_KEY)) || 0)));
  const held = (player, item) => isAmulet(item) &&
    [player.getInventory(), player.getEquipment()].some(container => container.getItems().includes(item));

  function showMessage(player, text, itemId) {
    const line = itemId === undefined ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, itemId, text);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(line));
  }

  function setCharges(player, item, amount) {
    item.setMetaValue(CHARGES_META_KEY, amount > 0 ? amount : undefined);
    item.setId(amount > 0 ? CHARGED_ID : EMPTY_ID);
    player.getPacketSender().sendVarbit(CHARGES_VARBIT, amount);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
    if (player.getEquipment().getItems().includes(item)) player.getUpdateFlag().flag(Flag.APPEARANCE);
  }

  function ring({ player, item }) {
    if (!held(player, item)) return false;
    for (const delay of [0, 8, 16]) player.getPacketSender().sendSoundEffect(BELL_SOUND, 1, delay);
    showMessage(player, "You ring the bell.", CHARGED_ID);
    api.emitCustomEvent("ides-of-milk:cowbell-ring", { player });
    return true;
  }

  function charge({ player, item }) {
    if (!held(player, item)) return false;
    if (charges(item) >= MAX_CHARGES) {
      showMessage(player, "The amulet is already fully charged.");
      return true;
    }
    if (player.getInventory().getAmount(I.AIR_RUNE) <= 0) {
      showMessage(player, "You don't have any Air Runes to charge the amulet with.");
      return true;
    }
    // Uncharge pays plain runes back, so only plain ones charge it (a preset's runes would come back plain).
    if (plainAmount(player.getInventory(), I.AIR_RUNE) <= 0) {
      showMessage(player, PRESET_TEXT);
      return true;
    }
    player.setEnteredAmountAction({ execute(amount) {
      if (!Number.isInteger(amount) || amount <= 0 || !held(player, item)) return;
      const used = Math.min(amount, MAX_CHARGES - charges(item), plainAmount(player.getInventory(), I.AIR_RUNE));
      if (used <= 0) return;
      takePlain(player.getInventory(), I.AIR_RUNE, used);
      setCharges(player, item, charges(item) + used);
    } });
    player.getPacketSender().sendEnterAmountPrompt("How many Air Runes would you like to add?");
    return true;
  }

  function chargeWithRune(event) {
    const item = event.usedItemId === I.AIR_RUNE ? event.usedWithItem
      : event.usedWithItemId === I.AIR_RUNE ? event.usedItem : null;
    if (!isAmulet(item)) return;
    event.handled = charge({ player: event.player, item });
  }

  function check({ player, item }) {
    if (!held(player, item)) return false;
    const remaining = charges(item);
    player.getPacketSender().sendVarbit(CHARGES_VARBIT, remaining);
    showMessage(player, `Your cowbell amulet has ${remaining} charge${remaining === 1 ? "" : "s"} remaining.`);
    return true;
  }

  function uncharge({ player, item }) {
    if (!held(player, item)) return false;
    const remaining = charges(item);
    if (remaining <= 0) return true;
    const inventory = player.getInventory();
    // Plain runes never join a preset stack, so only a plain stack gives them room without a free slot.
    if (plainAmount(inventory, I.AIR_RUNE) === 0 && inventory.getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory slot for the Air Runes.");
      return true;
    }
    inventory.adds(I.AIR_RUNE, remaining);
    setCharges(player, item, 0);
    return true;
  }

  function teleport({ player, item }) {
    if (!held(player, item)) return false;
    if (charges(item) <= 0) {
      showMessage(player, "Your cowbell amulet has no charges remaining.");
      return true;
    }
    if (!TeleportHandler.checkReqs(player, DESTINATION, 20)) return true;
    TeleportHandler.confirm(player, DESTINATION, (carried) => {
      if (charges(carried) <= 0) return;
      setCharges(player, carried, charges(carried) - 1);
      TeleportHandler.teleport(player, DESTINATION.clone(), TELEPORT, false, () => {
        const nearbyCow = World.getNpcsNear(player.getLocation(), 10, player.getPrivateArea()).find(npc =>
          /^(Cow|Cow calf)$/.test(npc.getDefinition().getName()));
        if (nearbyCow) nearbyCow.forceChat(nearbyCow.getDefinition().getName() === "Cow calf" ? "M-Moo?" : "Moo?");
      });
    }, 20, { item });
    return true;
  }

  function showEquippedCharges({ player }) {
    const item = player.getEquipment().get(Equipment.AMULET_SLOT);
    if (isAmulet(item)) player.getPacketSender().sendVarbit(CHARGES_VARBIT, charges(item));
  }

  api.onItemAction("Cowbell amulet", { Ring: ring, Charge: charge, Teleport: teleport, Check: check, Uncharge: uncharge });
  api.onItemOnItem(chargeWithRune, { noted: false });
  api.onCustomEvent("equipment:changed", showEquippedCharges);
  api.onPlayerLogin(showEquippedCharges);
};
