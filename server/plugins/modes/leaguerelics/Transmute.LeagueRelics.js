/**
 * Transmute (https://oldschool.runescape.wiki/w/Transmute_(Demonic_Pacts_League)), Demonic Pacts'
 * tier 4 relic. The client itself puts Alchemic Divergence and Alchemic Convergence (spellbook
 * 218:199 and 218:200) in the alchemy spells' places for the relic's owner (script3159, the
 * cache's spell overrides) and draws them as the alchemy spells while the alchemy toggle is off;
 * this unit answers their casts (`onSpellOnItem`, by the spell objs' names):
 *
 * - Toggle off: the alchemy spell it stands in for, as core casts it (237/01102: High Level
 *   Alchemy's own animation from 218:199).
 * - Toggle on: up to 10 of an item one tier up or down its row of the cache's `transmutation`
 *   table (the Wiki's lists are that table), 10 Magic XP an item, no level, no runes (Wiki:
 *   Alchemic Divergence costs none, 6 May 2026), every 5 ticks (`skills:action-interval`, kind
 *   `transmute`: Flow State's 2), a click during a cast waiting for it. As recorded (237/01102, 01106, 238/04211): a stack, noted or stackable, gives 10 of the
 *   next tier in the same form (noted stays noted) and is cast on again every 5 ticks while its
 *   slot holds it, with the graphic alone; loose items convert up to 10 of those held, in place,
 *   and only with a free slot for each; with the bank toggle on a stack's products go to the bank.
 *   The lines: "Nothing interesting happens." for an item no row has, an item box for the lowest
 *   tier, the red no-room line, each word for word.
 * - The ledger (`TRANSMUTATION_LEDGER`), carried or worn in the shield slot, is an endless source
 *   of nature runes for every spell (`onSpellRuneBypass`; the client's magic_runecount counts it
 *   so). An item used on it opens the journal scroll with its row: the row's name, its tiers
 *   numbered, its own in red with " (Current)" (the Wiki's screenshot); an item no row has is left
 *   to the game's own answer.
 *
 * Not here, and why: Divergence on the highest tier (nothing records the answer; the cast does
 * nothing), the Read option of the ledger (no recording or Wiki text says what it shows), and
 * which skilling actions pause the automatic casts (the Wiki's strategy notes only).
 */
const Common = require("./Common.LeagueRelics");
const Toggles = require("./Toggles.LeagueRelics");

/** The journal scroll, as the diaries open it (Journal.AchievementDiaries.js). */
const JOURNAL_SCROLL = 741;
const SCROLL_TITLE = 2;
const SCROLL_FIRST_LINE = 4;
const MAIN_MODAL = (161 << 16) | 16;
const PAGEPOS_VARP = 334;
const BUSY_VARBIT = 12393;
const SCRIPT_JOURNAL_RESET = 6844;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_JOURNAL_SHOW = 6845;
const MAGIC_TAB = 6;

let core;
let effect;
/** Unnoted item id -> { row: { name, items }, index }, from the cache's table. */
let tiers = null;
/** Per player: { readyAt (process cycle), task (the cast waiting, if any) }. */
const casts = new WeakMap();

function active(player) {
  return Common.effectActive(player, effect);
}

function unnoted(itemId) {
  const definition = core.ItemDefinition.forId(itemId);
  return definition?.isNoted?.() ? definition.getNoteId() : itemId;
}

/** The cast's pace: 5 ticks unless content lowers it ("skills:action-interval", Flow State's 2). */
function pace(player) {
  const request = { player, skill: core.Skill.MAGIC, kind: "transmute", ticks: effect.castTicks };
  Common.api.emitCustomEvent("skills:action-interval", request);
  return Math.max(1, request.ticks | 0);
}

function stacks(itemId) {
  return core.ItemDefinition.forId(itemId)?.isStackable?.() === true;
}

/** Every row of the cache's table: its tiers lowest first (each listed twice there) and its name. */
function table() {
  if (tiers) return tiers;
  const { CacheDefinitions } = core;
  const id = CacheDefinitions.getDbTableId(effect.table);
  const items = CacheDefinitions.getDbColumn(id, effect.tierColumn);
  const name = CacheDefinitions.getDbColumn(id, effect.nameColumn);
  tiers = new Map();
  for (const dbRow of CacheDefinitions.getDbTableRows(id)) {
    const row = { name: dbRow.string(name), items: dbRow.column(items).filter((value, index) => index % 2 === 0) };
    row.items.forEach((itemId, index) => tiers.set(itemId, { row, index }));
  }
  return tiers;
}

function lookup(itemId) {
  return table().get(unnoted(itemId)) ?? null;
}

function state(player) {
  if (!casts.has(player)) casts.set(player, { readyAt: 0, task: null });
  return casts.get(player);
}

function later(player, ticks, fn) {
  const own = state(player);
  own.task?.stop?.();
  own.task = new core.CountdownTask(player, Math.max(1, ticks), () => {
    own.task = null;
    if (player.isRegistered?.() !== false) fn();
  });
  core.TaskManager.submit(own.task);
}

function lowestTier(player, itemId) {
  const { ItemStatementDialogue, DialogueChainBuilder } = core;
  const chain = new DialogueChainBuilder();
  chain.add(new ItemStatementDialogue(0, itemId, effect.messages.lowest));
  player.getDialogueManager().startDialogues(chain);
}

/** How many to take and where the products go, or null with the reason said. */
function plan(player, item, productId) {
  const inventory = player.getInventory();
  const itemId = item.getId();
  const stack = itemId !== unnoted(itemId) || stacks(itemId);
  const amount = Math.min(effect.perCast, stack ? item.getAmount() : inventory.getAmount(itemId));
  if (stack && Toggles.on(player, effect.bankToggle) && Common.bankHasRoom(player, unnoted(productId))) {
    return { stack, amount, bank: true };
  }
  const room = stack
    ? inventory.contains(productId) || inventory.getFreeSlots() > 0 || amount === item.getAmount()
    : inventory.getFreeSlots() >= amount;
  return room ? { stack, amount, bank: false } : null;
}

/** One cast on the item in `slot`; `clicked` is false for a recast (graphic only, no tab). */
function cast(player, spellName, slot, itemId, clicked) {
  const spell = effect.spells[spellName];
  const now = core.World.getProcessCycle();
  const own = state(player);
  if (now < own.readyAt) {
    later(player, own.readyAt - now, () => cast(player, spellName, slot, itemId, clicked));
    return;
  }
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() !== itemId) return;
  if (clicked) player.getPacketSender().sendTab(MAGIC_TAB);
  const found = lookup(itemId);
  if (!found) {
    if (clicked) player.sendMessage(effect.messages.nothing);
    return;
  }
  const target = found.row.items[found.index + spell.step];
  if (target === undefined) {
    if (clicked && spell.step < 0) lowestTier(player, itemId);
    return;
  }
  const noted = itemId !== unnoted(itemId);
  const productId = noted ? Common.noted(target) : target;
  const how = plan(player, item, productId);
  if (!how) {
    if (clicked) player.sendMessage(effect.messages.noRoom);
    return;
  }
  if (how.stack) inventory.deleteAtSlot(slot, how.amount);
  else inventory.deleteNumber(itemId, how.amount);
  if (how.bank) Common.bank(player, target, how.amount);
  else inventory.adds(productId, how.amount);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, effect.xpPerItem * how.amount);
  const { CacheDefinitions, Animation, Graphic } = core;
  if (clicked) player.performAnimation(new Animation(CacheDefinitions.getSeqId(spell.animation)));
  player.performGraphic(new Graphic(CacheDefinitions.getSpotanimId(spell.graphic)));
  const ticks = pace(player);
  own.readyAt = now + ticks;
  if (how.stack && inventory.getItems()[slot]?.getId() === itemId) {
    later(player, ticks, () => cast(player, spellName, slot, itemId, false));
  }
}

function spellOnItem(event) {
  const spell = effect.spells[event.spellName];
  if (!spell || event.handled || !active(event.player)) return;
  event.handled = true;
  const { player, itemId, slot } = event;
  if (!Toggles.on(player, effect.alchemyToggle)) {
    core.castAlchemy(player, spell.alchemy, itemId, slot);
    return;
  }
  cast(player, event.spellName, slot, itemId, true);
}

function holdsLedger(player) {
  const id = core.ItemIdentifiers[effect.ledger];
  return player.getInventory().contains(id) || player.getEquipment().get(core.Equipment.SHIELD_SLOT)?.getId?.() === id;
}

function natureRunes(event) {
  if (event.runeId === core.ItemIdentifiers.NATURE_RUNE && event.player?.isPlayer?.() && holdsLedger(event.player)) event.bypass = true;
}

/** The journal scroll with the item's row, its own tier in red. */
function showRow(player, itemId) {
  const found = lookup(itemId);
  const names = found.row.items.map((id) => core.ItemDefinition.forId(id).getName());
  const lines = names.map((name, index) => (index === found.index
    ? `<col=${effect.currentColour}>${index + 1}. ${name}${effect.messages.current}</col>`
    : `${index + 1}. ${name}`));
  const sender = player.getPacketSender();
  sender.sendConfig(PAGEPOS_VARP, lines.length);
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendInterfaceScript(SCRIPT_JOURNAL_RESET);
  sender.sendString(found.row.name, (JOURNAL_SCROLL << 16) | SCROLL_TITLE);
  lines.forEach((line, index) => sender.sendString(line, (JOURNAL_SCROLL << 16) | (SCROLL_FIRST_LINE + index)));
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(JOURNAL_SCROLL);
  sender.sendSubInterface(MAIN_MODAL, JOURNAL_SCROLL, 0);
  sender.sendInterfaceScript(SCRIPT_JOURNAL_SHOW, [1, lines.length]);
}

function itemOnLedger(event) {
  const ledger = core.ItemIdentifiers[effect.ledger];
  const other = event.usedItemId === ledger ? event.usedWithItemId : event.usedWithItemId === ledger ? event.usedItemId : -1;
  if (other < 0 || !lookup(other)) return;
  event.handled = true;
  showRow(event.player, other);
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.transmute;
  api.onSpellOnItem(spellOnItem);
  api.onSpellRuneBypass(natureRunes);
  api.onItemOnItem(itemOnLedger);
};

Object.assign(module.exports, { lookup, cast });
