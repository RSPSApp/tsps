/**
 * Avernic treads (Wiki: Avernic treads).
 *
 * Primordial, pegasian and eternal boots are added one pair at a time, in any order, each for
 * 4,000 demon tears, which takes the treads through the (pr) (pe) (et) states to (max). Dismantle
 * returns the base treads and every pair added; the tears are lost.
 *
 * Captured (rsprox 3360, rev 235): Dismantle on the (max) treads asks "Are you sure you wish to
 * dismantle your avernic treads (max)?" with "Yes." / "No.". No capture shows boots being added or
 * the other states' prompts, so adding has no confirmation, the other states reuse the captured
 * wording with their own item name, and the refusal lines below are ours.
 * Boosted levels count (Wiki), and each pair gives 200 Magic and 200 Runecraft experience (Wiki recipe).
 * Preset (untradeable, unbankable) copies never convert: the treads, the boots and the tears must
 * be unrestricted instances, and only those are consumed, so a free item cannot become a plain one.
 */
const MAGIC_LEVEL = 80;
const RUNECRAFTING_LEVEL = 60;
const TEARS_PER_PAIR = 4000;
const EXPERIENCE = 200;
const PRESET_TEXT = "Preset items cannot be used for this.";

const PRIMORDIAL = 1;
const PEGASIAN = 2;
const ETERNAL = 4;
const ALL_PAIRS = PRIMORDIAL | PEGASIAN | ETERNAL;

// Item names must match the item definitions (onItemOnItem and onItemAction are name-based).
const PAIRS = [
  { bit: PRIMORDIAL, boots: "Primordial boots", id: "PRIMORDIAL_BOOTS" },
  { bit: PEGASIAN, boots: "Pegasian boots", id: "PEGASIAN_BOOTS" },
  { bit: ETERNAL, boots: "Eternal boots", id: "ETERNAL_BOOTS" },
];

// Which pairs each treads item holds. Item 33172 is the Last Man Standing treads, not a (max).
const STATES = [
  { mask: 0, name: "Avernic treads", ids: [31088] },
  { mask: PRIMORDIAL, name: "Avernic treads (pr)", ids: [31091] },
  { mask: PEGASIAN, name: "Avernic treads (pe)", ids: [31092] },
  { mask: ETERNAL, name: "Avernic treads (et)", ids: [31093] },
  { mask: PRIMORDIAL | PEGASIAN, name: "Avernic treads (pr)(pe)", ids: [31094] },
  { mask: PRIMORDIAL | ETERNAL, name: "Avernic treads (pr)(et)", ids: [31095] },
  { mask: PEGASIAN | ETERNAL, name: "Avernic treads (pe)(et)", ids: [31096] },
  { mask: ALL_PAIRS, name: "Avernic treads (max)", ids: [31097] },
];

let api = null;
let core = null;

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so they never convert. */
function restricted(item) {
  const Item = core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

function stateOf(itemId) {
  return STATES.find((state) => state.ids.includes(itemId));
}

function stateFor(mask) {
  return STATES.find((state) => state.mask === mask);
}

/** The slot of an unrestricted copy of the item: the instance that is actually consumed. */
function plainSlot(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item && item.getId() === itemId && !restricted(item));
}

/** The slots and amounts of unrestricted demon tears, which are what can pay. */
function plainTears(player) {
  const tearId = core.ItemIdentifiers.DEMON_TEAR;
  const stacks = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (item && item.getId() === tearId && !restricted(item)) stacks.push({ slot, amount: item.getAmount() });
  });
  return stacks;
}

function meetsLevels(player) {
  const skills = player.getSkillManager();
  const { Skill } = core;
  if (skills.getCurrentLevel(Skill.MAGIC) >= MAGIC_LEVEL && skills.getCurrentLevel(Skill.RUNECRAFTING) >= RUNECRAFTING_LEVEL) {
    return true;
  }
  player.sendMessage("You need level 80 Magic and 60 Runecrafting to do this.");
  return false;
}

function addPair(pair, { player, usedItem, usedWithItem }) {
  const boots = usedItem.getId() === core.ItemIdentifiers[pair.id] ? usedItem : usedWithItem;
  const treads = boots === usedItem ? usedWithItem : usedItem;
  const state = stateOf(treads.getId());
  if (!state || (state.mask & pair.bit) !== 0) return;
  if (restricted(boots) || restricted(treads)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (!meetsLevels(player)) return;
  const stacks = plainTears(player);
  if (stacks.reduce((sum, stack) => sum + stack.amount, 0) < TEARS_PER_PAIR) {
    player.sendMessage(`You need ${TEARS_PER_PAIR} demon tears to add the ${pair.boots.toLowerCase()}.`);
    return;
  }
  const inventory = player.getInventory();
  const bootsSlot = plainSlot(player, core.ItemIdentifiers[pair.id]);
  const treadsSlot = plainSlot(player, treads.getId());
  if (bootsSlot < 0 || treadsSlot < 0) return;
  let owed = TEARS_PER_PAIR;
  for (const stack of stacks) {
    const take = Math.min(owed, stack.amount);
    inventory.deleteAtSlot(stack.slot, take);
    owed -= take;
    if (owed === 0) break;
  }
  inventory.deleteAtSlot(bootsSlot, 1);
  inventory.deleteAtSlot(treadsSlot, 1);
  inventory.add(new core.Item(stateFor(state.mask | pair.bit).ids[0], 1), true);
  player.getSkillManager().addExperiences(core.Skill.MAGIC, EXPERIENCE);
  player.getSkillManager().addExperiences(core.Skill.RUNECRAFTING, EXPERIENCE);
}

function dismantle({ player, item }) {
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  const state = stateOf(item.getId());
  if (!state || state.mask === 0) return true;
  api.sendMultiChatboxPrompt(player, `Are you sure you wish to dismantle your ${state.name.toLowerCase()}?`,
    "Yes.", () => confirmDismantle(player, state),
    "No.", () => {});
  return true;
}

/** Checked again here: the inventory may have changed since the prompt. */
function confirmDismantle(player, state) {
  const inventory = player.getInventory();
  const slot = plainSlot(player, state.ids[0]);
  if (slot < 0) return;
  const returned = [stateFor(0).ids[0], ...PAIRS.filter((pair) => (state.mask & pair.bit) !== 0)
    .map((pair) => core.ItemIdentifiers[pair.id])];
  // The treads give up their slot, so one fewer free slot is needed.
  if (inventory.getFreeSlots() + 1 < returned.length) {
    player.sendMessage("You don't have enough inventory space to do that.");
    return;
  }
  inventory.deleteAtSlot(slot, 1);
  for (const id of returned) inventory.add(new core.Item(id, 1), true);
}

function attachPair(pair) {
  for (const state of STATES) {
    if ((state.mask & pair.bit) === 0) {
      api.onItemOnItem(pair.boots, state.name, (event) => addPair(pair, event), { noted: false });
    }
  }
}

function attachState(state) {
  if (state.mask !== 0) api.onItemAction(state.name, { Dismantle: dismantle });
}

module.exports = {
  name: "AvernicTreads",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    PAIRS.forEach(attachPair);
    STATES.forEach(attachState);
  },
  _test: { STATES, addPair, dismantle },
};
