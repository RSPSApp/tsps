/**
 * Etched fang upgrades: a boss fang is etched with a chisel, then the etched fang is combined with
 * a jewellery piece into its upgrade. Each recipe below is one row; the flow is shared.
 *
 * Necklace of rupture (Wiki: Necklace of rupture, Etched elder venator fang, Elder venator fang):
 * Etch on the Elder venator fang, with a chisel and 84 Crafting (boostable), makes the tradeable
 * Etched elder venator fang for no experience. The Wiki's transcript: without a chisel, "Etching an
 * elder venator fang requires a chisel."; with one, "You etch the elder venator fang.". The etched
 * fang used on a Necklace of anguish (either way round), near a bank and with 84 Crafting, makes
 * the Necklace of rupture for 500 Crafting experience. The transcript: away from a bank, "Creating
 * a necklace of rupture requires you to be near a bank."; otherwise "Do you wish to create a
 * necklace of rupture using a etched elder venator fang and a necklace of anguish?", "This process
 * is non-reversible and will consume both items.", then "Do you wish to create a necklace of
 * rupture?" Yes. / No., and Yes gives "You carefully craft a necklace of rupture.".
 *
 * Amulet of rancour (Wiki: Amulet of rancour, Etched araxyte fang, Araxyte fang, and their
 * transcripts): Etch on the Araxyte fang, with a chisel and 86 Crafting (boostable), makes the
 * tradeable Etched araxyte fang for no experience. Without a chisel, a box with the chisel:
 * "Creating a araxyte fang requires a chisel." (sic); with one the fang is just replaced, with no
 * message. The plain fang used on an Amulet of torture gives a box with the etched fang: "You need
 * to etch the fang in order to use it to craft.". The etched fang on the amulet (either way round),
 * at 86 Crafting, asks "Do you wish to use the etched araxyte fang on your amulet of torture? This
 * process is non-reversible and will consume both items.", then "Do you wish to create a amulet of
 * rancour?" Yes. / No., and Yes gives a box with the amulet: "You successfully create a amulet of
 * rancour." and 500 Crafting experience. Neither the Wiki recipe nor the transcript names a bank,
 * so it works anywhere.
 *
 * Both Wiki item pages describe the etch as "using a chisel on" the fang, so the chisel used on
 * the fang (either way round) does what the fang's Etch option does.
 *
 * Neither upgrade is reversible, and the cache gives neither product a Dismantle.
 *
 * Ours: the level messages (no transcript has one; the Araxyte fang transcript lists the etch level
 * refusal as missing), the rupture dialogue boxes' items. The rupture bank check is LeagueMode's
 * shared `league:near-bank`, as the chugging barrel and the giant egg sac use. The product takes the
 * jewellery's slot. Etching happens on the click (the Wiki recipe gives 1 tick). Only the plain base item is accepted (Necklace of anguish 19547, not the
 * cache's other copy 27172; Amulet of torture 19553, not the ornamented one), and preset (or other
 * untradeable or unbankable) copies are refused, both when etching and when combining.
 */
let api;
let core;

const PRESET = "Preset items cannot be used for this.";

/** Built at register time, once the item ids are reachable. */
function recipes() {
  const I = core.ItemIdentifiers;
  return [
    {
      fang: I.ELDER_VENATOR_FANG,
      fangName: "Elder venator fang",
      etched: I.ETCHED_ELDER_VENATOR_FANG,
      etchedName: "Etched elder venator fang",
      base: I.NECKLACE_OF_ANGUISH,
      baseName: "Necklace of anguish",
      product: I.NECKLACE_OF_RUPTURE,
      level: 84,
      xp: 500,
      nearBank: true,
      text: {
        noChisel: "Etching an elder venator fang requires a chisel.",
        noChiselItem: -1,
        etched: "You etch the elder venator fang.",
        etchLevel: "You need a Crafting level of 84 to etch the elder venator fang.",
        noBank: "Creating a necklace of rupture requires you to be near a bank.",
        combineLevel: "You need a Crafting level of 84 to create a necklace of rupture.",
        confirm: [
          "Do you wish to create a necklace of rupture using a etched elder venator fang and a necklace of anguish?",
          "This process is non-reversible and will consume both items.",
        ],
        confirmItems: true,
        title: "Do you wish to create a necklace of rupture?",
        crafted: "You carefully craft a necklace of rupture.",
      },
    },
    {
      fang: I.ARAXYTE_FANG,
      fangName: "Araxyte fang",
      etched: I.ETCHED_ARAXYTE_FANG,
      etchedName: "Etched araxyte fang",
      base: I.AMULET_OF_TORTURE,
      baseName: "Amulet of torture",
      product: I.AMULET_OF_RANCOUR,
      level: 86,
      xp: 500,
      nearBank: false,
      text: {
        noChisel: "Creating a araxyte fang requires a chisel.",
        noChiselItem: I.CHISEL,
        etched: null,
        etchLevel: "You need a Crafting level of 86 to etch the araxyte fang.",
        unetched: "You need to etch the fang in order to use it to craft.",
        combineLevel: "You need a Crafting level of 86 to create an amulet of rancour.",
        confirm: [
          "Do you wish to use the etched araxyte fang on your amulet of torture? This process is non-reversible and will consume both items.",
        ],
        confirmItems: false,
        title: "Do you wish to create a amulet of rancour?",
        crafted: "You successfully create a amulet of rancour.",
      },
    },
  ];
}

function restricted(item) {
  const { Item } = core;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

function crafting(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING);
}

function nearBank(player) {
  const query = { player, near: false };
  api.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

function statement(player, dialogue) {
  const chain = new core.DialogueChainBuilder();
  chain.add(dialogue);
  player.getDialogueManager().startDialogues(chain);
}

function box(player, text, itemId = -1) {
  statement(player, itemId > 0
    ? new core.ItemStatementDialogue(0, itemId, text)
    : new core.StatementDialogue(0, text));
}

/** The slot of an unrestricted copy of the item: the instance that is actually used up. */
function plainSlot(player, id) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === id && !restricted(item));
}

/** Etch on the fang: the fang becomes the etched one in its own slot. */
function etch(recipe, { player, item }) {
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0 || item.getId() !== recipe.fang) return false;
  if (restricted(item)) {
    player.sendMessage(PRESET);
    return true;
  }
  if (!inventory.contains(core.ItemIdentifiers.CHISEL)) {
    box(player, recipe.text.noChisel, recipe.text.noChiselItem);
    return true;
  }
  if (crafting(player) < recipe.level) {
    player.sendMessage(recipe.text.etchLevel);
    return true;
  }
  inventory.setItem(slot, new core.Item(recipe.etched, 1));
  inventory.refreshItems();
  if (recipe.text.etched) box(player, recipe.text.etched, recipe.etched);
  return true;
}

/** A chisel used on the fang (either way round) is the same as its Etch option. */
function chiselOn(recipe, { player, usedItem, usedWithItem }) {
  const item = [usedItem, usedWithItem].find((it) => it.getId() === recipe.fang);
  return item ? etch(recipe, { player, item }) : false;
}

/** Everything the combine needs, checked again when Yes is chosen. Sends the refusal and returns false. */
function canCombine(recipe, player) {
  if (recipe.nearBank && !nearBank(player)) {
    box(player, recipe.text.noBank);
    return false;
  }
  if (crafting(player) < recipe.level) {
    player.sendMessage(recipe.text.combineLevel);
    return false;
  }
  return true;
}

function craft(recipe, player) {
  const inventory = player.getInventory();
  const base = plainSlot(player, recipe.base);
  const fang = plainSlot(player, recipe.etched);
  if (base < 0 || fang < 0 || !canCombine(recipe, player)) return;
  inventory.deleteAtSlot(fang, 1, false);
  inventory.setItem(base, new core.Item(recipe.product, 1));
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, recipe.xp);
  box(player, recipe.text.crafted, recipe.product);
}

/** The etched fang used on the base item, or the base item on the fang. */
function combine(recipe, { player, usedItem, usedWithItem }) {
  const ids = [usedItem.getId(), usedWithItem.getId()];
  if (!ids.includes(recipe.base) || !ids.includes(recipe.etched)) return false;
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage(PRESET);
    return true;
  }
  if (!canCombine(recipe, player)) return true;
  const chain = new core.DialogueChainBuilder();
  recipe.text.confirm.forEach((text, index) => {
    chain.add(recipe.text.confirmItems
      ? new core.DoubleItemStatementDialogue(index, recipe.etched, recipe.base, text)
      : new core.StatementDialogue(index, text));
  });
  chain.add(new core.OptionDialogue(recipe.text.confirm.length, {
    executeOption(option) {
      player.getDialogueManager().reset();
      if (Number(option) === 1) craft(recipe, player);
    },
  }, "Yes.", "No.").setTitle(recipe.text.title));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

/** The unetched fang used on the base item, either way round. */
function unetched(recipe, { player, usedItem, usedWithItem }) {
  const ids = [usedItem.getId(), usedWithItem.getId()];
  if (!ids.includes(recipe.base) || !ids.includes(recipe.fang)) return false;
  box(player, recipe.text.unetched, recipe.etched);
  return true;
}

module.exports = {
  name: "EtchedFangs",
  description: "Etches the Elder venator and Araxyte fangs with a chisel, and crafts the etched fangs into the Necklace of rupture (with a Necklace of anguish, near a bank, 84 Crafting) and the Amulet of rancour (with an Amulet of torture, 86 Crafting), 500 XP each.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    for (const recipe of recipes()) {
      api.onItemAction(recipe.fangName, { Etch: (event) => etch(recipe, event) });
      api.onItemOnItem("Chisel", recipe.fangName, (event) => chiselOn(recipe, event), { noted: false });
      api.onItemOnItem(recipe.etchedName, recipe.baseName, (event) => combine(recipe, event), { noted: false });
      if (recipe.text.unetched) {
        api.onItemOnItem(recipe.fangName, recipe.baseName, (event) => unetched(recipe, event), { noted: false });
      }
    }
  },
  _test: { recipes: () => recipes(), PRESET },
};
