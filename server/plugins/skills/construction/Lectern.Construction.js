"use strict";

const {
  Animation, CacheDefinitions, DialogueChainBuilder, Item, ItemIdentifiers, ItemStatementDialogue, MagicSpellbook,
  PluginManager, Skill, Sound, Sounds, Spell, StatementDialogue, Task, TaskManager, api,
} = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const LECTERN_DATA = require("./data/lectern.json");

// rsprox captures: Study opens teletabs_craft_if after setting teletab_enum (the lectern's tablet
// list) and makexcrafting (the quantity). A tab click sets tablet_to_make (the tab's 1-based
// slot); confirm closes the interface and makes one tablet every 4 ticks, the animation and
// sound on the first tick and the tablet the tick after.
//
// The Arceuus lectern in the Ouditor's house (rsprox 235/03899) also sets tablet_spellbook 3 (the
// client's Arceuus border, teletab_steelborder) before opening. Off the Arceuus spellbook a Study
// says "You must be using the Arceuus spellbook to use this lectern." and shows a box "You must
// have your mind occupied by the spells of the dead before using this lectern."; without essence,
// a box with the block "You need some dark essence to use this lectern."; short of a rune, "You do
// not have enough Mind Runes to cast this spell.". Neither refusal opens the interface.
const TELETABS_INTERFACE = Ids.iface("teletabs_craft_if");
const MAKE_BUTTONS = { 5: 1, 6: 5, 7: 10 };
const MAKE_X = 8;
const MAKE_ALL = 9;
const CONFIRM = 14;
const FIRST_TAB = 19;
const LAST_TAB = 39;
const TELETAB_ENUM_VARP = Ids.varp("teletab_enum");
const MAKE_AMOUNT_VARP = Ids.varp("makexcrafting");
const TABLET_VARBIT = Ids.varbit("tablet_to_make");
const CREATE_ANIMATION = Ids.seq("poh_create_magic_tablet");
const CREATE_SOUND = new Sound(228, 1, 0, 0);
const INTERVAL_TICKS = 4;
const NO_CLAY = "You need some soft clay to use this lectern.";
const NO_DARK_ESSENCE = "You need some dark essence to use this lectern.";
const WRONG_SPELLBOOK = "You must be using the Arceuus spellbook to use this lectern.";
const WRONG_SPELLBOOK_BOX = "You must have your mind occupied by the spells of the dead before using this lectern.";
const TABLET_SPELLBOOK_VARBIT = Ids.varbit("tablet_spellbook");
// The client's tablet_spellbook values (teletab_steelborder): 0 for the house's lecterns, 3 for Arceuus.
const TABLET_SPELLBOOKS = { ARCEUUS: 3 };
const TABLET_ATTRIBUTE = "construction:lectern-tablet";
const AMOUNT_ATTRIBUTE = "construction:lectern-amount";
// Wiki (Lectern (Arceuus)): Create-last remembers the last tablet and quantity "when using the same
// type of lectern", so the Arceuus lectern keeps its own.
const ARCEUUS_TABLET_ATTRIBUTE = "construction:arceuus-lectern-tablet";
const ARCEUUS_AMOUNT_ATTRIBUTE = "construction:arceuus-lectern-amount";

const TABLETS = new Map(Object.entries(LECTERN_DATA.tablets).map(([id, tablet]) => [Number(id), {
  ...tablet,
  runes: tablet.runes.map(([name, amount]) => [ItemIdentifiers[name], amount]),
}]));
const openLecterns = new WeakMap();

function lecternAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const enumId = furniture && LECTERN_DATA.lecterns[furniture.buildableKey];
  if (enumId) return { enumId, tablets: [...CacheDefinitions.getEnumValues(enumId).values()], material: ItemIdentifiers.SOFT_CLAY, spellbook: null, runeSpellbook: MagicSpellbook.NORMAL,
    tabletSpellbook: 0, tabletAttribute: TABLET_ATTRIBUTE, amountAttribute: AMOUNT_ATTRIBUTE };
  const world = LECTERN_DATA.worldLecterns?.[event.objectId];
  if (!world) return null;
  return {
    enumId: world.enumId,
    tablets: [...CacheDefinitions.getEnumValues(world.enumId).values()],
    material: ItemIdentifiers[world.material],
    spellbook: MagicSpellbook[world.spellbook],
    runeSpellbook: MagicSpellbook[world.spellbook],
    tabletSpellbook: TABLET_SPELLBOOKS[world.spellbook] ?? 0,
    tabletAttribute: ARCEUUS_TABLET_ATTRIBUTE,
    amountAttribute: ARCEUUS_AMOUNT_ATTRIBUTE,
    world: true,
  };
}

/** The runes a tablet still needs from the inventory or a rune pouch once staves are counted. */
function runesNeeded(player, lectern, tablet, count) {
  return tablet.runes
    .filter(([id]) => PluginManager.emitSpellRuneBypass(player, lectern.runeSpellbook, -1, id) !== true)
    .map(([id, amount]) => ({ id, amount: amount * count }));
}

function hasRunes(player, lectern, tablet, count) {
  const shortfall = Spell.inventoryShortfall(player, runesNeeded(player, lectern, tablet, count).map(({ id, amount }) => new Item(id, amount)));
  return shortfall.length === 0 || PluginManager.checkSpellRuneSource(player, shortfall);
}

function takeRunes(player, lectern, tablet) {
  const runes = runesNeeded(player, lectern, tablet, 1).map(({ id, amount }) => new Item(id, amount));
  const shortfall = Spell.inventoryShortfall(player, runes);
  for (const rune of runes) player.getInventory().delete(rune.getId(), Math.min(rune.getAmount(), player.getInventory().getAmount(rune.getId())));
  if (shortfall.length) PluginManager.consumeSpellRuneSource(player, shortfall);
}

/** How many of `tablet` the player could make now (the lectern's clay substitute and runes). */
function makeable(player, lectern, tablet) {
  let count = player.getInventory().getAmount(lectern.material);
  while (count > 0 && !hasRunes(player, lectern, tablet, count)) count--;
  return count;
}

function chosenTablet(player, lectern) {
  const slot = player.getPacketSender().getVarbit(TABLET_VARBIT);
  return slot > 0 ? lectern.tablets[slot - 1] ?? null : null;
}

function setAmount(player, lectern, amount) {
  player.setAttribute(lectern.amountAttribute, amount);
  player.getPacketSender().sendConfig(MAKE_AMOUNT_VARP, amount);
}

function study(event) {
  const lectern = lecternAt(event);
  if (!lectern) return false;
  const player = event.player;
  if (refused(player, lectern)) return true;
  const sender = player.getPacketSender();
  sender.sendVarbit(TABLET_SPELLBOOK_VARBIT, lectern.tabletSpellbook);
  sender.sendConfig(TELETAB_ENUM_VARP, lectern.enumId);
  sender.sendVarbit(TABLET_VARBIT, player.getAttribute(lectern.tabletAttribute) ?? 0);
  sender.sendConfig(MAKE_AMOUNT_VARP, player.getAttribute(lectern.amountAttribute) ?? 1);
  sender.sendInterface(TELETABS_INTERFACE);
  openLecterns.set(player, lectern);
  return true;
}

function createLast(event) {
  const lectern = lecternAt(event);
  if (!lectern) return false;
  const player = event.player;
  if (refused(player, lectern)) return true;
  player.getPacketSender().sendVarbit(TABLET_VARBIT, player.getAttribute(lectern.tabletAttribute) ?? 0);
  startMaking(player, lectern, player.getAttribute(lectern.amountAttribute) ?? 1);
  return true;
}

function missingMaterial(player, lectern) {
  const text = lectern.material === ItemIdentifiers.DARK_ESSENCE_BLOCK ? NO_DARK_ESSENCE : NO_CLAY;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, lectern.material, text)));
}

function wrongSpellbook(player, lectern) {
  if (!lectern.spellbook || player.getSpellbook() === lectern.spellbook) return false;
  player.sendMessage(WRONG_SPELLBOOK);
  return true;
}

/** A world lectern's own conditions for a Study or Create-last: the spellbook (a message and a box), then the essence. */
function refused(player, lectern) {
  if (!lectern.world) return false;
  if (wrongSpellbook(player, lectern)) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, WRONG_SPELLBOOK_BOX)));
    return true;
  }
  if (!player.getInventory().contains(lectern.material)) {
    missingMaterial(player, lectern);
    return true;
  }
  return false;
}

/** The first rune neither the inventory nor a rune pouch covers, or null when there is none. */
function missingRune(player, lectern, tablet) {
  const shortfall = Spell.inventoryShortfall(player, runesNeeded(player, lectern, tablet, 1).map(({ id, amount }) => new Item(id, amount)));
  if (shortfall.length === 0 || PluginManager.checkSpellRuneSource(player, shortfall)) return null;
  return shortfall.find(rune => !PluginManager.checkSpellRuneSource(player, [rune])) ?? shortfall[0];
}

/** "You do not have enough Mind Runes to cast this spell." (the Arceuus lectern, as cast spells say it). */
function missingRuneMessage(itemId) {
  const name = CacheDefinitions.getItem(itemId)?.name ?? "rune";
  return `You do not have enough ${name.replace(/\b\w/g, letter => letter.toUpperCase())}s to cast this spell.`;
}

function startMaking(player, lectern, amount) {
  const itemId = chosenTablet(player, lectern);
  const tablet = TABLETS.get(itemId);
  if (!tablet || amount < 1) return;
  if (wrongSpellbook(player, lectern)) return;
  if (!player.getInventory().contains(lectern.material)) {
    missingMaterial(player, lectern);
    return;
  }
  TaskManager.submit(new TabletTask(player, lectern, itemId, tablet, amount));
}

/** One tablet every INTERVAL_TICKS; keyed to the player, so their next walk or click stops it. */
class TabletTask extends Task {
  constructor(player, lectern, itemId, tablet, amount) {
    super(1, player.getIndex(), true);
    this.player = player;
    this.lectern = lectern;
    this.itemId = itemId;
    this.tablet = tablet;
    this.remaining = amount;
    this.step = 0;
  }

  execute() {
    const { player, lectern, tablet } = this;
    if (!player.isRegistered() || (!lectern.world && !House.houseFor(player))) return this.stop();
    if (this.step % INTERVAL_TICKS === 0) {
      if (!this.canMake()) return this.stop();
      player.performAnimation(new Animation(CREATE_ANIMATION));
      Sounds.sendSound(player, CREATE_SOUND);
    } else if (this.step % INTERVAL_TICKS === 1) {
      if (!this.canMake()) return this.stop();
      player.getInventory().delete(lectern.material, 1);
      takeRunes(player, lectern, tablet);
      player.getInventory().adds(this.itemId, 1);
      player.getSkillManager().addExperiences(Skill.MAGIC, tablet.experience);
      api.emitCustomEvent("construction:tablet-made", { player, itemId: this.itemId, amount: 1, lectern: lectern.world ? "arceuus" : "house" });
      if (--this.remaining <= 0) return this.stop();
    }
    this.step++;
  }

  canMake() {
    const { player, lectern, tablet } = this;
    if (wrongSpellbook(player, lectern)) return false;
    if (!player.getInventory().contains(lectern.material)) {
      missingMaterial(player, lectern);
      return false;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < tablet.level) {
      player.sendMessage(`You need a Magic level of ${tablet.level} to make that tablet.`);
      return false;
    }
    const missing = missingRune(player, lectern, tablet);
    if (missing) {
      player.sendMessage(lectern.world ? missingRuneMessage(missing.getId()) : "You do not have enough runes to make that tablet.");
      return false;
    }
    return true;
  }
}

function interfaceClick(event) {
  if (event.groupId !== TELETABS_INTERFACE) return;
  const player = event.player;
  const lectern = openLecterns.get(player);
  if (!lectern) return;
  event.handled = true;
  const child = event.childId;
  if (child >= FIRST_TAB && child <= LAST_TAB && child - FIRST_TAB < lectern.tablets.length) {
    const slot = child - FIRST_TAB + 1;
    player.setAttribute(lectern.tabletAttribute, slot);
    player.getPacketSender().sendVarbit(TABLET_VARBIT, slot);
  } else if (MAKE_BUTTONS[child]) {
    setAmount(player, lectern, MAKE_BUTTONS[child]);
  } else if (child === MAKE_ALL || child === MAKE_X) {
    const tablet = TABLETS.get(chosenTablet(player, lectern));
    const most = tablet ? Math.max(1, makeable(player, lectern, tablet)) : 1;
    if (child === MAKE_ALL) return setAmount(player, lectern, most);
    player.getPacketSender().sendConfig(MAKE_AMOUNT_VARP, 0).sendEnterAmountPrompt(`Enter amount: (1-${most})`);
    player.setEnteredAmountAction({ execute: amount => setAmount(player, lectern, Math.max(1, Math.min(most, amount))) });
  } else if (child === CONFIRM) {
    openLecterns.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    startMaking(player, lectern, player.getAttribute(lectern.amountAttribute) ?? 1);
  }
}

function closeLectern({ player }) {
  openLecterns.delete(player);
}

function attachLecterns(api) {
  api.persistAttribute(TABLET_ATTRIBUTE, 0);
  api.persistAttribute(AMOUNT_ATTRIBUTE, 1);
  api.persistAttribute(ARCEUUS_TABLET_ATTRIBUTE, 0);
  api.persistAttribute(ARCEUUS_AMOUNT_ATTRIBUTE, 1);
  api.onObjectInteraction("Lectern", { Study: study, "Create-last": createLast });
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("interface:close", closeLectern);
}

Object.assign(module.exports, { attachLecterns, _test: { lecternAt, startMaking, TABLETS, wrongSpellbook, study, createLast, interfaceClick } });
