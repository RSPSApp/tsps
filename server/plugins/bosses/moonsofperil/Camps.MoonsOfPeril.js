/**
 * Neypotzli's camps and supplies after Perilous Moons (docs/moons-of-peril.md), data `supplies`
 * and `neypotzli`, as captured where a recording shows it:
 * - Cooking stove, Cook (or a raw one used on it): raw bream and moss lizards, one a tick until none are left (capture:
 *   human_cooking_walkmerge_norestart, sound 2577). 30 Cooking, 45 / 60 xp, nothing burns; a second
 *   bream, or extra lizard meat, by Cooking level (Wiki). "You haven't got anything to cook."
 * - Cooking stove, Make-cuppa: full run energy, "You drink the tea and find yourself feeling
 *   energised!" (spam).
 * - Supply crates: each kit hands over the tools the player lacks (and two vials of water every
 *   time), named in an object box.
 * - Grubby sapling: a moonlight grub two ticks after arriving, sometimes two ("Your hunting
 *   knowledge allows you to find an extra grub.").
 * - Pestle and mortar on a grub: paste, sometimes from two grubs ("Your herblore knowledge allows
 *   you to crush an extra grub."). Paste on a vial of water: a moonlight potion of 2-4 doses by
 *   Herblore (38 needed), with the captured lines for the extra doses.
 * - Leaving Neypotzli: its foods, grubs and paste fizzle away and its potions turn back into vials
 *   of water - "The resources from Neypotzli fizzle to dust as they are severed from its magic."
 * The quest keeps all of this for its own steps until the Moons are reached.
 */
const Common = require("./Common.MoonsOfPeril");

const supplies = () => Common.data.supplies;
const itemId = (name) => Common.core.ItemIdentifiers[name];

/** The quest is past its gathering (from the ritual on, Moons done included), or done. */
function afterGathering(player) {
  const done = { player, key: "perilous_moons", complete: false };
  Common.api.emitCustomEvent("quest:is-complete", done);
  if (done.complete) return true;
  const request = { player, open: false };
  Common.api.emitCustomEvent("moons-of-peril:camps-open", request);
  return request.open === true;
}

/** A chance that grows from `low` at `from` to `high` at 99 with the skill's level. */
function chance(level, from, [low, high]) {
  const t = Math.max(0, Math.min(1, (level - from) / Math.max(1, 99 - from)));
  return low + (high - low) * t;
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(skill);
}

function xp(player, skill, amount) {
  player.getSkillManager().addExperience(skill, amount, true);
}

/** A repeating action, one step a tick, that stops when the player moves or starts another. */
function repeat(player, step) {
  const token = {};
  player.__moonsAction = token;
  const start = player.getLocation().clone();
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, true);
    }
    execute() {
      if (player.__moonsAction !== token || !player.isRegistered() || !player.getLocation().equals(start) || !step()) {
        if (player.__moonsAction === token) player.__moonsAction = null;
        this.stop();
      }
    }
  })());
}

// ------------------------------------------------------------------ the cooking stove

function cook({ player, objectId }) {
  const s = supplies();
  if (objectId !== s.stove || !afterGathering(player)) return false;
  const { cook: spec } = s;
  const { Skill } = Common.core;
  const food = () => spec.foods.find((entry) => player.getInventory().contains(itemId(entry.raw)));
  if (!food()) {
    statement(player, spec.nothing);
    return true;
  }
  if (player.getSkillManager().getMaxLevel(Skill.COOKING) < spec.level) {
    statement(player, spec.lowLevel);
    return true;
  }
  repeat(player, () => {
    const entry = food();
    if (!entry) return false;
    cookOne(player, entry, spec);
    return true;
  });
  return true;
}

/** One cook: the raw item becomes cooked, with extras by Cooking level (Wiki). */
function cookOne(player, entry, spec) {
  const { Skill, Item } = Common.core;
  const inventory = player.getInventory();
  const raw = itemId(entry.raw);
  const cooked = itemId(entry.cooked);
  Common.animate(player, spec.anim);
  Common.sound(player, spec.sound);
  const odds = chance(level(player, Skill.COOKING), spec.level, spec.double);
  let made = 1;
  if (entry.extras) {
    // A lizard gives up to `extras` more cuts of meat.
    for (let i = 0; i < entry.extras && Math.random() < odds; i++) made++;
    inventory.deleteNumber(raw, 1);
  } else {
    // A second bream cooks with the first when there is one.
    const second = inventory.getAmount(raw) >= 2 && Math.random() < odds;
    if (second) made = 2;
    inventory.deleteNumber(raw, made);
  }
  if (made > 1) player.sendMessage(entry.doubleMessage);
  for (let i = 0; i < made; i++) inventory.add(new Item(cooked, 1), false);
  inventory.refreshItems();
  xp(player, Skill.COOKING, entry.xp * (entry.extras ? 1 : made));
}

function cuppa({ player, objectId }) {
  const s = supplies();
  if (objectId !== s.stove) return false;
  const { cuppa: spec } = s;
  Common.animate(player, spec.anim);
  Common.sound(player, spec.sound);
  player.setRunEnergy(100);
  player.getPacketSender().sendRunEnergy();
  // A spam line (rsprox captures 1104, 1693, 3276).
  player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, spec.message);
  return true;
}

// ------------------------------------------------------------------ the supply crates

function statement(player, text) {
  const { StatementDialogue } = Common.core;
  StatementDialogue.send(player, text, true);
}

/** Hands over a kit's missing tools (and its "always" items), shown in an object box. */
function takeKit(player, kit) {
  const s = supplies();
  const { Item, ItemStatementDialogue, DoubleItemStatementDialogue, DialogueChainBuilder } = Common.core;
  const inventory = player.getInventory();
  const given = kit.items.filter(([name, , always]) => always || !inventory.contains(itemId(name)));
  const slots = given.reduce((total, [name, amount]) => total + amount, 0);
  if (given.length === 0) return;
  if (inventory.getFreeSlots() < slots) {
    player.sendMessage(s.fullMessage);
    return;
  }
  Common.animate(player, s.pickupAnim);
  Common.sound(player, s.pickupSound);
  for (const [name, amount] of given) inventory.add(new Item(itemId(name), amount), false);
  inventory.refreshItems();
  const names = given.map(([name]) => name);
  const text = kit.messages[names.join(",")] ?? kit.messages[names[0]];
  const chain = new DialogueChainBuilder();
  chain.add(names.length >= 2
    ? new DoubleItemStatementDialogue(0, itemId(names[0]), itemId(names[1]), text)
    : new ItemStatementDialogue(0, itemId(names[0]), text));
  player.getDialogueManager().startDialogues(chain);
}

function crateKit(name) {
  return ({ player, objectId }) => {
    if (objectId !== supplies().crates || !afterGathering(player)) return false;
    takeKit(player, supplies().kits[name]);
    return true;
  };
}

/** Take-from: which kit (no response was captured; the three named options are the choice). */
function crateChoice({ player, objectId }) {
  const s = supplies();
  if (objectId !== s.crates || !afterGathering(player)) return false;
  const { OptionDialogue, DialogueChainBuilder } = Common.core;
  const kits = ["fishing", "hunting", "herblore"];
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const kit = kits[Number(option) - 1]; // options are one-based
        if (kit) takeKit(player, s.kits[kit]);
      },
    }, ...s.kitOptions).setTitle(s.kitQuestion),
  ));
  return true;
}

// ------------------------------------------------------------------ grubs, paste and potions

function collectGrub({ player, objectId }) {
  const s = supplies();
  if (objectId !== s.sapling || !afterGathering(player)) return false;
  const { grub } = s;
  const { Skill, Item } = Common.core;
  Common.later(grub.delay, () => {
    if (!player.isRegistered()) return;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage(grub.fullMessage);
      return;
    }
    Common.sound(player, grub.sound);
    const two = inventory.getFreeSlots() >= 2 && Math.random() < chance(level(player, Skill.HUNTER), 1, grub.extra);
    inventory.add(new Item(itemId("MOONLIGHT_GRUB"), two ? 2 : 1), true);
    if (two) player.sendMessage(grub.extraMessage);
  });
  return true;
}

function crushGrub(event) {
  const { player } = event;
  const { crush } = supplies();
  const { Skill } = Common.core;
  const inventory = player.getInventory();
  const grub = itemId("MOONLIGHT_GRUB");
  if (!inventory.contains(grub)) return true;
  Common.animate(player, crush.anim);
  Common.sound(player, crush.sound);
  const two = inventory.getAmount(grub) >= 2 && Math.random() < chance(level(player, Skill.HERBLORE), 1, crush.extra);
  inventory.deleteNumber(grub, two ? 2 : 1);
  inventory.adds(itemId("MOONLIGHT_GRUB_PASTE"), two ? 2 : 1);
  if (two) player.sendMessage(crush.extraMessage);
  return true;
}

function makePotion(event) {
  const { player } = event;
  const { potion } = supplies();
  const { Skill, Item } = Common.core;
  if (level(player, Skill.HERBLORE) < potion.level) {
    player.sendMessage(potion.lowLevel);
    return true;
  }
  const inventory = player.getInventory();
  const paste = itemId("MOONLIGHT_GRUB_PASTE");
  const vial = itemId("VIAL_OF_WATER");
  if (!inventory.contains(paste) || !inventory.contains(vial)) return true;
  Common.animate(player, potion.anim);
  Common.sound(player, potion.sound);
  const odds = chance(level(player, Skill.HERBLORE), potion.level, potion.extra);
  const doses = Object.keys(potion.doses);
  let extra = 0;
  while (extra < doses.length - 1 && Math.random() < odds) extra++;
  inventory.deleteNumber(paste, 1);
  inventory.deleteNumber(vial, 1);
  inventory.add(new Item(itemId(doses[extra]), 1), true);
  const message = potion.doses[doses[extra]];
  if (message) player.sendMessage(message);
  return true;
}

// ------------------------------------------------------------------ leaving Neypotzli

function inNeypotzli(location) {
  return Common.data.neypotzli.bounds.some(({ x, y, z }) =>
    location.getZ() === z && location.getX() >= x[0] && location.getX() <= x[1] && location.getY() >= y[0] && location.getY() <= y[1]);
}

/** Out of Neypotzli: its resources fizzle, its potions turn back into vials of water (Wiki). */
function fizzle(player) {
  const { neypotzli } = Common.data;
  const { Item } = Common.core;
  const inventory = player.getInventory();
  let changed = false;
  for (const name of neypotzli.resources) {
    const id = itemId(name);
    const amount = inventory.getAmount(id);
    if (amount > 0) {
      inventory.deleteNumber(id, amount);
      changed = true;
    }
  }
  const vial = itemId("VIAL_OF_WATER");
  for (const name of neypotzli.potions) {
    const id = itemId(name);
    const amount = inventory.getAmount(id);
    if (amount <= 0) continue;
    inventory.deleteNumber(id, amount);
    inventory.add(new Item(vial, amount), false);
    changed = true;
  }
  if (!changed) return;
  inventory.refreshItems();
  player.sendMessage(neypotzli.fizzle);
}

/** A copy of Neypotzli (the quest's camp caverns are instances) counts as the place it copies. */
function sourceOf(player, location) {
  const area = player.getPrivateArea?.();
  return typeof area?.toSource === "function" && area.contains?.(location) ? area.toSource(location) : location;
}

function onMapSquare({ player, location }) {
  if (location && !inNeypotzli(sourceOf(player, location))) fizzle(player);
}

/** A tick on: a save made inside a quest's copy of Neypotzli is first put back on its real landing. */
function onLogin({ player }) {
  const { CountdownTask, TaskManager } = Common.core;
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (player.isRegistered?.() === false) return;
    if (!inNeypotzli(sourceOf(player, player.getLocation()))) fizzle(player);
  }));
}

module.exports = function attachCamps(api) {
  api.onObjectInteraction("Cooking stove", { Cook: cook, "Make-cuppa": cuppa });
  api.onItemOnObject("Raw bream", "Cooking stove", cook, { noted: false });
  api.onItemOnObject("Raw moss lizard", "Cooking stove", cook, { noted: false });
  api.onObjectInteraction("Supply crates", {
    "Take-from": crateChoice,
    "Take-from <col=00ffff>Fishing": crateKit("fishing"),
    "Take-from <col=00ffff>Hunting": crateKit("hunting"),
    "Take-from <col=00ffff>Herblore": crateKit("herblore"),
  });
  api.onObjectInteraction("Grubby sapling", { "Collect-from": collectGrub });
  api.onItemOnItem("Pestle and mortar", "Moonlight grub", crushGrub);
  api.onItemOnItem("Moonlight grub paste", "Vial of water", makePotion);
  // Not an Area: the Moon arenas are Areas inside Neypotzli and an actor holds one Area at a
  // time. Leaving is checked per map square crossed (areas.md), not per tick.
  api.onPlayerMapSquareChange(onMapSquare);
  api.onPlayerLogin(onLogin);
};

Object.assign(module.exports, { inNeypotzli, fizzle, chance, afterGathering });
