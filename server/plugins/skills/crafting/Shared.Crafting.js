/**
 * What the Crafting units share: the plugin api, the skillmulti make-many menu and the task
 * that makes one item every few ticks until the amount is made or the player stops.
 *
 * Every captured make-many loop (docs/crafting.md) has the same shape, counted from the tick
 * the player picks the item: a start animation (and sound) on `startTick`, the first item on
 * `firstTick`, then one every `interval` ticks, each with the animation replayed. Walking away,
 * opening an interface, dying or running out of materials stops it.
 */
const fs = require("fs");
const path = require("path");

const CRAFTING_TASK_ATTRIBUTE = "crafting:task";
/** The recipes: data/crafting.json, items by their ItemIdentifiers names. */
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "crafting.json"), "utf8"));

let api = null;
let core = null;

/** Keeps the plugin api for the units; registers no hooks. */
function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** An ItemIdentifiers name from crafting.json as the cache id; an unknown name throws. */
function itemId(name) {
  const id = core.ItemIds[name];
  if (!Number.isInteger(id)) throw new Error(`crafting.json: unknown item ${name}`);
  return id;
}

function getApi() {
  return api;
}

function getCore() {
  return core;
}

function craftingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING);
}

function addCraftingXp(player, xp) {
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, xp);
}

function isMembersWorld() {
  return core.WorldDefinition.isMembersWorld();
}

/** Recipes this world offers: members recipes only on members worlds. */
function available(recipes) {
  const members = isMembersWorld();
  return recipes.filter((recipe) => members || !recipe.members);
}

function itemName(itemId) {
  return core.CacheDefinitions.getItem(itemId).name;
}

/** "a beer glass", "an unpowered staff orb". */
function withArticle(name) {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** Plays the animation and the sound, both optional. */
function animate(player, animation, sound) {
  if (animation) player.performAnimation(animation);
  if (sound) core.Sounds.sendSound(player, sound);
}

function stopCrafting(player) {
  player.getAttribute(CRAFTING_TASK_ATTRIBUTE)?.stop();
}

/**
 * The skillmulti menu: `items` in menu order, each `{ itemId, label? }`. `choose(item, amount)`
 * runs with the chosen entry.
 */
function openMakeMenu(player, { title, mode, items, maxAmount, choose }) {
  const byItem = new Map(items.map((item) => [item.itemId, item]));
  const menu = new core.CreationMenu(
    title,
    items.map((item) => item.itemId),
    {
      execute: (itemId, amount) => {
        const item = byItem.get(itemId);
        if (item) choose(item, amount);
      },
    },
    {
      labels: items.map((item) => item.label ?? itemName(item.itemId)),
      maxAmount,
      mode,
    }
  );
  player.getPacketSender().sendCreationMenu(menu);
}

/**
 * Starts the make-many loop. `has()` says whether another item can be made, `make()` makes one
 * and returns false when it could not. `anchor`, when given, stops the loop once the player is
 * more than 2 tiles from it (a furnace or wheel the menu was opened at).
 */
function startMaking(player, {
  amount, startTick = 0, firstTick, interval, animation = null, sound = null,
  onAnimate = null, has, make, anchor = null, resetAnimation = false,
}) {
  stopCrafting(player);
  if (!has()) return;

  const play = () => {
    animate(player, animation, sound);
    onAnimate?.();
  };

  class CraftingTask extends core.Task {
    constructor() {
      super(1, player);
      this.ticks = 0;
      this.remaining = amount;
    }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 ||
        player.getMovementQueue().size() > 0 || player.getForceMovement() != null ||
        player.getInterfaceId() !== -1 || (anchor && player.getLocation().getDistance(anchor) > 2) || !has()) {
        this.stop();
        return;
      }
      const tick = ++this.ticks;
      if (tick === startTick) play();
      if (tick < firstTick || (tick - firstTick) % interval !== 0) return;
      if (tick !== startTick) play();
      if (!make() || --this.remaining <= 0 || !has()) this.stop();
    }
    stop() {
      super.stop();
      if (player.getAttribute(CRAFTING_TASK_ATTRIBUTE) === this) {
        player.setAttribute(CRAFTING_TASK_ATTRIBUTE, null);
      }
      if (resetAnimation) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
    }
  }

  if (startTick === 0) play();
  const task = new CraftingTask();
  player.setAttribute(CRAFTING_TASK_ATTRIBUTE, task);
  api.getTaskManager().submit(task);
}

module.exports = {
  CRAFTING_TASK_ATTRIBUTE,
  DATA,
  attach,
  itemId,
  getApi,
  getCore,
  craftingLevel,
  addCraftingXp,
  isMembersWorld,
  available,
  itemName,
  withArticle,
  animate,
  stopCrafting,
  openMakeMenu,
  startMaking,
};
