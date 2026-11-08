// The Grand Exchange's two decanters (rsprox 226/01637, 226/01671, 232/03238, 238/04168; Wiki):
// - Bob Barter (herbs) > Decant opens the decant interface (582); its four buttons pool every potion
//   family's doses into potions of that many doses, the rest in one smaller potion, empty vials back.
//   Families come from the cache's dose enum (Potions' "potions:dose-family"); only those that empty
//   into a vial are his to decant.
// - Murky Matt (runes) > Decant pools the charges on teleport jewellery the same way, up to each
//   piece's normal capacity; an emptied piece comes back uncharged, or is gone.
// Noted and unnoted are pooled apart and come back as they went in (recorded). Neither charges for the
// service; Bob sells any vial he has to supply (Wiki).
const DATA = require("./data/ge-decanters.json");

let api;

const core = () => api.core;
const definition = (id) => core().ItemDefinition.forId(id);
const objId = (name) => core().CacheDefinitions.getObjId(name);
const MAX_STACK = 2147483647; // the client's stack limit (StackType MAX_STACK_AMOUNT)

function talk(player, who, line, mood) {
  const { DialogueChainBuilder, NpcDialogue, CacheDefinitions } = core();
  const npcId = CacheDefinitions.getNpcId(who.npc);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, line, who.name, DATA.anim[mood])));
}

/** The inventory's stacks as { slot, id, amount, base, noted, meta }: `base` is the unnoted item. */
function stacks(player) {
  return player.getInventory().getItems().map((item, slot) => {
    if (!item || item.getId() < 0 || item.getAmount() <= 0) return null;
    const def = definition(item.getId());
    const noted = def.isNoted();
    return { slot, id: item.getId(), amount: item.getAmount(), base: noted ? def.getNoteId() : item.getId(), noted, meta: item.getMeta?.() ?? null };
  }).filter(Boolean);
}

const asNoted = (id, noted) => (noted ? definition(id).getNoteId() : id);

// ---------------------------------------------------------------- a planned inventory
//
// Each family is worked out on a copy of the inventory, slot by slot: its own plain slots come out,
// what it pays (vials, coins) comes from the copy as it stands then, and its results go in under the
// stack limit. A family that doesn't fit leaves the copy as it was; families refused for room are tried
// again once the others have freed theirs. The finished copy is written back in one go, so nothing is
// taken without its result, and items a family doesn't own (presets, other metadata) are never touched.

/** The inventory as { id, amount, meta } per slot, or null for an empty one. */
function snapshot(player) {
  return player.getInventory().getItems().map((item) =>
    (item && item.getId() >= 0 && item.getAmount() > 0 ? { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null } : null));
}

const plainSlot = (slots, id) => slots.findIndex((slot) => slot && slot.id === id && slot.meta == null);

/** Adds to the copy as Inventory.add would; false if it can't hold all of it. */
function addTo(slots, id, amount) {
  if (definition(id).isStackable()) {
    const at = plainSlot(slots, id);
    if (at >= 0) {
      if (MAX_STACK - slots[at].amount < amount) return false;
      slots[at].amount += amount;
      return true;
    }
    const free = slots.indexOf(null);
    if (free < 0 || amount > MAX_STACK) return false;
    slots[free] = { id, amount, meta: null };
    return true;
  }
  for (let i = 0; i < amount; i++) {
    const free = slots.indexOf(null);
    if (free < 0) return false;
    slots[free] = { id, amount: 1, meta: null };
  }
  return true;
}

/** Takes up to `amount` of plain `id` from the copy; returns how many it took. */
function takeFrom(slots, id, amount) {
  let taken = 0;
  for (let i = 0; i < slots.length && taken < amount; i++) {
    const slot = slots[i];
    if (!slot || slot.id !== id || slot.meta != null) continue;
    const n = Math.min(slot.amount, amount - taken);
    slot.amount -= n;
    taken += n;
    if (slot.amount === 0) slots[i] = null;
  }
  return taken;
}

const count = (slots, id) => slots.reduce((n, slot) => n + (slot && slot.id === id && slot.meta == null ? slot.amount : 0), 0);

/**
 * One family on a copy of `slots`: its pieces out, its payment taken, its results in. Returns the new
 * copy, or { refused: "short" | "poor" } leaving `slots` as it was.
 */
function planGroup(slots, group) {
  const next = slots.map((slot) => (slot ? { ...slot } : null));
  for (const piece of group.pieces) {
    const slot = next[piece.slot];
    if (!slot || slot.id !== piece.id || slot.amount !== piece.amount || slot.meta != null) return { refused: "short" };
    next[piece.slot] = null;
  }
  if (group.vialsNeeded > 0) {
    const vial = asNoted(objId(DATA.vial), group.noted);
    const own = takeFrom(next, vial, Math.min(group.vialsNeeded, count(next, vial)));
    const price = (group.vialsNeeded - own) * DATA.vialPrice;
    if (price > 0 && takeFrom(next, objId(DATA.coins), price) < price) return { refused: "poor" };
  }
  for (const { id, amount } of [...group.outputs, ...(group.spare?.amount > 0 ? [group.spare] : [])]) {
    if (!addTo(next, id, amount)) return { refused: "short" };
  }
  return { slots: next };
}

/** Plans every family, retrying the refused ones while others still make room; returns the outcome. */
function plan(player, groups) {
  let slots = snapshot(player);
  // Families that give vials back go first, so one that needs vials uses those before buying (any order).
  let pending = [...groups].sort((a, b) => (b.spare?.amount ?? 0) - (a.spare?.amount ?? 0) || (a.vialsNeeded ?? 0) - (b.vialsNeeded ?? 0));
  let changed = false;
  let progress = true;
  const refusals = new Map();
  while (progress && pending.length) {
    progress = false;
    for (const group of [...pending]) {
      const result = planGroup(slots, group);
      if (result.refused) {
        refusals.set(group, result.refused);
        continue;
      }
      slots = result.slots;
      pending = pending.filter((other) => other !== group);
      refusals.delete(group);
      changed = progress = true;
    }
  }
  const left = [...refusals.values()];
  return { slots, changed, short: left.includes("short"), poor: left.includes("poor") };
}

/** Writes a planned copy back, slot by slot. */
function commit(player, slots) {
  const inventory = player.getInventory();
  const { Item } = core();
  slots.forEach((slot, i) => inventory.setItem(i, slot ? new Item(slot.id, slot.amount, slot.meta) : new Item(-1, 0)));
  inventory.refreshItems();
}

/** Plans `groups`, writes the result, and says how it went. */
function apply(player, groups) {
  const outcome = plan(player, groups);
  if (outcome.changed) commit(player, outcome.slots);
  return outcome;
}

/** The same counts as the pieces already are: nothing to do for this group. */
function sameAs(pieces, outputs) {
  const tally = (list) => list.reduce((map, entry) => map.set(entry.id, (map.get(entry.id) ?? 0) + entry.amount), new Map());
  const before = tally(pieces);
  const after = tally(outputs);
  return before.size === after.size && [...before].every(([id, amount]) => after.get(id) === amount);
}

// ---------------------------------------------------------------- Bob Barter: potions

function doseFamily(itemId) {
  const request = { itemId, family: null };
  api.emitCustomEvent("potions:dose-family", request);
  return request.family;
}

/** Potion groups (one per family, noted apart from unnoted) decanted into `target` doses. */
function potionGroups(player, target) {
  const vial = objId(DATA.vial);
  const groups = new Map();
  for (const stack of stacks(player)) {
    if (stack.meta != null) continue;
    const family = doseFamily(stack.base);
    // Bob's are the vial potions; a family that empties into something else (or nothing) is not.
    if (!family || family.byDose[0] !== vial) continue;
    const key = `${family.byDose.join(",")}:${stack.noted}`;
    if (!groups.has(key)) groups.set(key, { noted: stack.noted, family, pieces: [], stacks: 0 });
    const group = groups.get(key);
    group.pieces.push({ slot: stack.slot, id: stack.id, amount: stack.amount, value: family.byDose.indexOf(stack.base) });
    group.stacks++;
  }
  const result = [];
  for (const group of groups.values()) {
    const { byDose, max } = group.family;
    const doses = Math.min(target, max);
    const total = group.pieces.reduce((sum, piece) => sum + piece.value * piece.amount, 0);
    const full = Math.floor(total / doses);
    const rest = total % doses;
    const idFor = (d) => asNoted(byDose[d], group.noted);
    group.outputs = [...(full > 0 ? [{ id: idFor(doses), amount: full }] : []), ...(rest > 0 ? [{ id: idFor(rest), amount: 1 }] : [])];
    if (sameAs(group.pieces, group.outputs)) continue;
    const potions = group.pieces.reduce((sum, piece) => sum + piece.amount, 0);
    const spare = potions - group.outputs.reduce((sum, out) => sum + out.amount, 0);
    // Splitting needs vials: the player's own (noted for a noted split) first, then Bob's at 5 coins each (Wiki).
    if (spare >= 0) group.spare = { id: asNoted(vial, group.noted), amount: spare };
    else group.vialsNeeded = -spare;
    result.push(group);
  }
  return result;
}

function openDecant({ player }) {
  player.getPacketSender().sendChatboxInterface(DATA.decantInterface);
  return true;
}

function decant(player, target) {
  player.getPacketSender().sendSoundEffect(DATA.decantSound, 1, 0, 1);
  const { changed, short, poor } = apply(player, potionGroups(player, target));
  if (short) return talk(player, DATA.bob, DATA.messages.short, "sad");
  if (poor && !changed) return talk(player, DATA.bob, DATA.messages.poor, "sad");
  if (!changed) return talk(player, DATA.bob, DATA.messages.nothingToDecant, "sad");
  talk(player, DATA.bob, DATA.messages.decanted, "happy");
}

/** A dose button, only while the decant interface is the chatbox's (closing or walking off ends it). */
function decantButton(event) {
  if (event.groupId !== DATA.decantInterface) return;
  const target = DATA.buttons[event.childId];
  if (!target || !event.player.getPacketSender().isChatboxInterface(DATA.decantInterface)) return;
  // Not while trading or otherwise busy: a trade's free-slot check has already been made.
  if (event.player.busy()) return;
  event.handled = true;
  decant(event.player, target);
}

// ---------------------------------------------------------------- Murky Matt: jewellery

let families;

/** id -> { family, charges } for every charged piece of the families Matt handles. */
function jewellery() {
  if (families) return families;
  families = new Map();
  for (const family of DATA.jewellery) {
    for (let charges = 1; charges <= 8; charges++) {
      const id = objId(`${family.prefix}${charges}`);
      if (id != null) families.set(id, { family, charges });
    }
  }
  return families;
}

function jewelleryGroups(player) {
  const groups = new Map();
  let fountain = false;
  for (const stack of stacks(player)) {
    const piece = jewellery().get(stack.base);
    if (!piece || stack.meta != null) continue;
    if (piece.family.fountain) fountain = true;
    // Wiki: never past its normal capacity, as for a glory charged to 6 at the Fountain of Rune.
    if (piece.charges > piece.family.cap) continue;
    const key = `${piece.family.prefix}:${stack.noted}`;
    if (!groups.has(key)) groups.set(key, { noted: stack.noted, family: piece.family, pieces: [], stacks: 0 });
    const group = groups.get(key);
    group.pieces.push({ slot: stack.slot, id: stack.id, amount: stack.amount, value: piece.charges });
    group.stacks++;
  }
  const result = [];
  for (const group of groups.values()) {
    const { cap, prefix, empty } = group.family;
    const total = group.pieces.reduce((sum, piece) => sum + piece.value * piece.amount, 0);
    const full = Math.floor(total / cap);
    const rest = total % cap;
    const idFor = (charges) => asNoted(objId(`${prefix}${charges}`), group.noted);
    group.outputs = [...(full > 0 ? [{ id: idFor(cap), amount: full }] : []), ...(rest > 0 ? [{ id: idFor(rest), amount: 1 }] : [])];
    if (sameAs(group.pieces, group.outputs)) continue;
    const pieces = group.pieces.reduce((sum, piece) => sum + piece.amount, 0);
    const emptied = pieces - group.outputs.reduce((sum, out) => sum + out.amount, 0);
    if (empty && emptied > 0) group.spare = { id: asNoted(objId(empty), group.noted), amount: emptied };
    result.push(group);
  }
  return { groups: result, fountain };
}

function combine({ player }) {
  const { groups, fountain } = jewelleryGroups(player);
  const { changed } = apply(player, groups);
  if (changed) return talk(player, DATA.matt, DATA.messages.combined, "happy");
  if (fountain) return talk(player, DATA.matt, DATA.messages.fountain, "sad3");
  talk(player, DATA.matt, DATA.messages.nothingToCombine, "sad");
}

module.exports = {
  name: "GeDecanters",
  description: "Adds the Grand Exchange decanting service, which swaps potion doses between vials in a player's inventory for a fee.",
  members: true,
  DATA,
  _test: { potionGroups, jewelleryGroups, decant, combine, plan },
  register(pluginApi) {
    api = pluginApi;
    api.onNpcInteraction(DATA.bob.name, { Decant: openDecant });
    api.onNpcInteraction(DATA.matt.name, { Decant: combine });
    api.onInterfaceActionClick(decantButton);
  },
};
