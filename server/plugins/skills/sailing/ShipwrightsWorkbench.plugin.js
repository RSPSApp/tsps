/**
 * Shipwrights' workbench (https://oldschool.runescape.wiki/w/Shipwrights%27_workbench): hull
 * parts, large hull parts and repair kits for Construction XP, from
 * plugins/skills/sailing/data/shipwrights-workbench.json. As captured (rsprox, rev 235):
 * - Craft asks "What would you like to craft?" with "Hull parts." and "Repair kits."; each opens
 *   the skillmulti menu (clientscript 2046 mode 36 for hull parts, 2 for repair kits), at most
 *   as many as the materials make; Craft-hull-parts and Craft-repair-kits open it directly;
 * - without a hammer and a saw: "You need a hammer and a saw to use this workbench." (mesbox);
 * - missing materials: a mesbox naming the recipe ("You need two camphor planks, ten adamantite
 *   nails and five swamp paste to craft a set of two camphor repair kits."), and the menu again
 *   after it;
 * - each item: human_poh_build with synth 938, then 3 ticks later the materials go, the product
 *   comes with the XP and "You craft some oak hull parts." (spam); the next starts a tick later.
 * Planks come from the inventory first, then a carried plank sack (Wiki, "storage:take"); a set
 * of kits the inventory can't hold drops the rest to the floor (Wiki), but a recipe that only
 * uses inventory planks needs the room. Large hull parts take 5 ticks (Wiki).
 */
const fs = require("fs");
const path = require("path");

const TASK_ATTRIBUTE = "shipwrights-workbench:task";
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "shipwrights-workbench.json"), "utf8"));

let api = null;
let core = null;
let ids = null;

/** A cache gameval name as its id; a name this cache doesn't have stops the plugin loading. */
function lookup(kind, name, find) {
  const id = find(name);
  if (id == null) throw new Error(`Shipwrights' workbench: the cache has no ${kind} named ${name}`);
  return id;
}

function obj(name) {
  return lookup("obj", name, (n) => core.CacheDefinitions.getObjId(n));
}

/** A tool by its ItemIdentifiers name (the cache's names for them moved between revisions). */
function tool(name) {
  const id = core.ItemIds[name];
  if (!Number.isInteger(id)) throw new Error(`Shipwrights' workbench: unknown tool ${name}`);
  return id;
}

function resolveRecipe(recipe) {
  return {
    ...recipe,
    itemId: obj(recipe.item),
    amount: recipe.amount ?? 1,
    materials: recipe.materials.map(([name, amount]) => [obj(name), amount]),
  };
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = {
    animation: lookup("seq", DATA.animation, (n) => core.CacheDefinitions.getSeqId(n)),
    hammers: DATA.tools.hammer.map(tool),
    saws: DATA.tools.saw.map(tool),
    recipes: {
      hull: DATA.recipes.hull.map(resolveRecipe),
      kits: DATA.recipes.kits.map(resolveRecipe),
    },
  };
}

function format(text, values) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
}

/** A tool carried, or wielded in either hand (an Imcando hammer, Amy's saw). */
function hasTool(player, toolIds) {
  const { Equipment } = core;
  const equipment = player.getEquipment();
  const wielded = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT].map((slot) => equipment.get(slot)?.getId?.());
  return toolIds.some((id) => player.getInventory().contains(id) || wielded.includes(id));
}

function hasTools(player) {
  return hasTool(player, ids.hammers) && hasTool(player, ids.saws);
}

function messageBox(player, text, then = null) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

/** What a carried container (the plank sack) holds of an item ("storage:amount"). */
function storedAmount(player, itemId) {
  const request = { player, itemId, amount: 0 };
  api.emitCustomEvent("storage:amount", request);
  return request.amount;
}

function available(player, itemId) {
  return player.getInventory().getAmount(itemId) + storedAmount(player, itemId);
}

/** How many times the materials make the recipe. */
function makeable(player, recipe) {
  return Math.min(...recipe.materials.map(([itemId, amount]) => Math.floor(available(player, itemId) / amount)));
}

function constructionLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.CONSTRUCTION);
}

/** Inventory slots the materials free: unstackable ones taken from it, or a stack used up. */
function slotsFreed(player, recipe) {
  const inventory = player.getInventory();
  let freed = 0;
  for (const [itemId, amount] of recipe.materials) {
    const held = inventory.getAmount(itemId);
    if (core.ItemDefinition.forId(itemId).isStackable()) freed += held > 0 && held <= amount ? 1 : 0;
    else freed += Math.min(held, amount);
  }
  return freed;
}

/** All from the inventory: the products need its room. With a sack's planks the rest drop (Wiki). */
function hasRoom(player, recipe) {
  const room = player.getInventory().getFreeSlots() + slotsFreed(player, recipe);
  const fromSack = recipe.materials.some(([itemId, amount]) => player.getInventory().getAmount(itemId) < amount);
  return fromSack || room >= recipe.amount;
}

/** Wiki (Plank sack): the inventory's first, then the sack's ("storage:take"). */
function useMaterials(player, recipe) {
  const inventory = player.getInventory();
  for (const [itemId, amount] of recipe.materials) {
    const held = Math.min(amount, inventory.getAmount(itemId));
    if (held > 0) inventory.delete(itemId, held);
    if (amount > held) api.emitCustomEvent("storage:take", { player, itemId, amount: amount - held, taken: 0 });
  }
}

function giveProducts(player, recipe) {
  const { Item, ItemOnGroundManager } = core;
  const inventory = player.getInventory();
  for (let i = 0; i < recipe.amount; i++) {
    const item = new Item(recipe.itemId, 1);
    if (inventory.canTake(item)) inventory.add(item);
    else ItemOnGroundManager.registers(player, item);
  }
}

/** The Carpenter's outfit's Construction bonus (Wiki: applies at the workbench since 26 November 2025). */
function outfitMultiplier(player) {
  const request = { player, multiplier: 1 };
  api.emitCustomEvent("construction:outfit-multiplier", request);
  return request.multiplier;
}

function craft(player, recipe) {
  useMaterials(player, recipe);
  giveProducts(player, recipe);
  player.getSkillManager().addExperiences(core.Skill.CONSTRUCTION, recipe.xp * outfitMultiplier(player));
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, format(DATA.messages.crafted, recipe));
}

function hammer(player) {
  player.performAnimation(new core.Animation(ids.animation));
  player.getPacketSender().sendSound(DATA.sound, 0, 0);
}

function stopCrafting(player) {
  player.getAttribute(TASK_ATTRIBUTE)?.stop();
}

/** Why the recipe can't be made now (a mesbox text), or null. */
function refusal(player, recipe) {
  if (!hasTools(player)) return DATA.messages.noTools;
  if (constructionLevel(player) < recipe.level) return format(DATA.messages.level, recipe);
  if (makeable(player, recipe) < 1) return format(DATA.messages.noMaterials, { materials: recipe.need, product: recipe.product });
  return null;
}

/**
 * The hammer swings on the pick, the product comes 3 ticks later (4 for large hull parts), and
 * the next swing a tick after that, until the amount is made, the materials run out or the
 * player moves or opens something.
 */
function startCrafting(player, category, recipe, amount, anchor) {
  stopCrafting(player);
  const reason = refusal(player, recipe);
  if (reason) {
    messageBox(player, reason, reason === DATA.messages.noTools ? null : () => openMenu(player, category, anchor));
    return;
  }
  if (!hasRoom(player, recipe)) {
    player.sendMessage(DATA.messages.noRoom);
    return;
  }

  class WorkbenchTask extends core.Task {
    constructor() {
      super(1, player.getIndex());
      this.ticks = 0;
      this.remaining = amount;
    }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getMovementQueue().size() > 0 ||
        player.getInterfaceId() !== -1 || player.getLocation().getDistance(anchor) > 2) {
        this.stop();
        return;
      }
      const tick = ++this.ticks % recipe.ticks;
      if (tick === 0) {
        if (refusal(player, recipe) || !hasRoom(player, recipe)) {
          this.stop();
          return;
        }
        hammer(player);
      } else if (tick === recipe.ticks - 1) {
        if (refusal(player, recipe) || !hasRoom(player, recipe)) {
          this.stop();
          return;
        }
        craft(player, recipe);
        if (--this.remaining <= 0) this.stop();
      }
    }
    stop() {
      super.stop();
      if (player.getAttribute(TASK_ATTRIBUTE) === this) player.setAttribute(TASK_ATTRIBUTE, null);
    }
  }

  hammer(player);
  const task = new WorkbenchTask();
  player.setAttribute(TASK_ATTRIBUTE, task);
  api.getTaskManager().submit(task);
}

/** The skillmulti menu of one category, at most as many as the materials make (at least 1). */
function openMenu(player, category, anchor) {
  const recipes = ids.recipes[category];
  const { mode, title } = DATA.menus[category];
  const byItem = new Map(recipes.map((recipe) => [recipe.itemId, recipe]));
  const maxAmount = Math.max(1, ...recipes.map((recipe) => makeable(player, recipe)));
  const menu = new core.CreationMenu(title, recipes.map((recipe) => recipe.itemId), {
    execute: (itemId, amount) => {
      const recipe = byItem.get(itemId);
      if (recipe) startCrafting(player, category, recipe, amount, anchor);
    },
  }, { maxAmount, mode });
  player.getPacketSender().sendCreationMenu(menu);
}

/** Stops what the player was making; without the tools, says so and answers false. */
function ready(player) {
  stopCrafting(player);
  if (hasTools(player)) return true;
  messageBox(player, DATA.messages.noTools);
  return false;
}

function craftAtWorkbench({ player, object }) {
  if (!ready(player)) return true;
  const anchor = object.getLocation();
  const [hull, kits] = DATA.categories;
  api.sendMultiChatboxPrompt(player, DATA.prompt,
    hull, () => openMenu(player, "hull", anchor),
    kits, () => openMenu(player, "kits", anchor));
  return true;
}

function craftHullParts({ player, object }) {
  if (ready(player)) openMenu(player, "hull", object.getLocation());
  return true;
}

function craftRepairKits({ player, object }) {
  if (ready(player)) openMenu(player, "kits", object.getLocation());
  return true;
}

module.exports = {
  name: "ShipwrightsWorkbench",
  members: true,
  register(pluginApi) {
    pluginApi.onServerStartup(() => start(pluginApi));
    pluginApi.onObjectInteraction("Shipwrights' Workbench", {
      Craft: craftAtWorkbench,
      "Craft-hull-parts": craftHullParts,
      "Craft-repair-kits": craftRepairKits,
    });
  },
  _test: { start, DATA, makeable, hasRoom, openMenu, TASK_ATTRIBUTE },
};
