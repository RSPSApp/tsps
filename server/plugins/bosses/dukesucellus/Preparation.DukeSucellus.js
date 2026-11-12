"use strict";
const Common = require('./Common.DukeSucellus');
const Model = require('./Model.DukeSucellus');
// Recorded types (rsprox, all Duke Sucellus captures): spam for the mushroom (359), pick swing (1676), grinding (356),
// vat additions (~160 each), crushing, emptying and salt (339) lines; the ferment, poison and vat-ready lines are game.
/** A spam line (filterable), as these are in the recordings. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, text);
}
const vatKey = tile => `${tile[0]},${tile[1]}`;
const vatRotation = tile => tile[0] < Common.data.site.arrival[0] ? 3 : 1;
const ingredientRows = () => [
  { id: Common.data.items.muscaPowder, raw: Common.data.items.musca, name: 'musca powder' },
  { id: Common.data.items.salt, name: 'salax salt' },
  { id: Common.data.items.arderPowder, raw: Common.data.items.arder, name: 'arder powder' }
];
function animate(player, name) {
  player.performAnimation(new Common.core.Animation(Common.core.CacheDefinitions.getSeqId(name)));
}
function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 1);
}
function refresh(session) {
  const { objects: o, resources: r } = Common.data;
  const awake = session.fight.active || session.fight.over;
  session.place(awake ? o.inactiveArder : o.arder, r.arder);
  session.place(awake ? o.inactiveMusca : o.musca, r.musca);
  for (const tile of r.salts)
    session.place(awake ? o.inactiveSalt : o.salt, tile, tile[0] < Common.data.site.arrival[0] ? 2 : 0);
  for (const tile of r.vats)
    session.place(awake ? o.inactiveVat : session.vats.get(vatKey(tile))?.ready ? o.readyVat : o.vat, tile, vatRotation(tile));
  session.place(awake || session.tools.has(o.pestle) ? o.inactivePestle : o.pestle, r.pestle, 1);
  session.place(awake || session.tools.has(o.pickaxe) ? o.inactivePickaxe : o.pickaxe, r.pickaxe, 1);
}
function near(session, at, range = 1) {
  return Model.near(Common.source(session, session.player.getLocation()), at, range);
}
function nearObject(session, at, id, rotation = 0) {
  const definition = Common.core.CacheDefinitions.getObject(id);
  const width = rotation % 2 ? definition.sizeY : definition.sizeX;
  const height = rotation % 2 ? definition.sizeX : definition.sizeY;
  const [x, y] = Common.source(session, session.player.getLocation());
  return Model.near([x, y], [Math.max(at[0], Math.min(x, at[0] + width - 1)), Math.max(at[1], Math.min(y, at[1] + height - 1))]);
}
const nearVat = (session, at) => nearObject(session, at, Common.data.objects.vat, vatRotation(at));
const nearSalt = (session, at) => nearObject(session, at, Common.data.objects.salt, at[0] < Common.data.site.arrival[0] ? 2 : 0);
function pick(session, type) {
  Common.core.TaskManager.cancelTasks(session.player.getIndex());
  if (!pickOne(session, type))
    return true;
  let wait = 3;
  Common.core.TaskManager.submit(new (class extends Common.core.Task {
    constructor() {
      super(1, session.player.getIndex(), false);
    }
    execute() {
      if (session.ended || !session.player.isRegistered() || session.player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      if (--wait > 0)
        return;
      wait = 3;
      if (!pickOne(session, type))
        this.stop();
    }
  })());
  return true;
}
function pickOne(session, type) {
  const { resources: r, items, objects } = Common.data;
  if (session.fight.active || session.fight.over || !near(session, r[type]))
    return false;
  if (session.picks[type] >= r.picks) {
    session.player.sendMessage('These mushrooms have been picked clean.');
    return false;
  }
  if (Common.give(session.player, items[type])) {
    session.picks[type]++;
    animate(session.player, 'picking_low');
    sound(session.player, 2581);
    spam(session.player, "You pick a mushroom.");
    if (session.picks[type] === r.picks)
      session.place(objects[`${type}Depleted`], r[type]);
    return true;
  }
  return false;
}
function mine(session, at) {
  if (!Common.data.resources.salts.some(tile => Model.near(tile, at, 0)) || !nearSalt(session, at))
    return false;
  const request = { player: session.player, pickaxe: null };
  Common.api.emitCustomEvent('mining:best-pickaxe', request);
  if (!request.pickaxe) {
    session.player.sendMessage('You need a pickaxe you can use to mine the salt.');
    return true;
  }
  const interval = Math.max(2, request.pickaxe.attemptIntervalTicks || 4);
  const action = { kind: 'salt', at, start: Common.source(session, session.player.getLocation()), next: session.tick + interval,
    interval, until: session.tick + 500, pickaxe: request.pickaxe };
  Common.core.TaskManager.cancelTasks(session.player.getIndex());
  session.action = action;
  session.player.getCombat().reset();
  // Start swinging on the click response; salt arrives after the pickaxe cycle.
  session.player.performAnimation(action.pickaxe.animation);
  spam(session.player, "You swing your pick at the rock.");
  Common.core.TaskManager.submit(new (class extends Common.core.Task {
    constructor() {
      super(1, session.player.getIndex(), false);
    }
    execute() {
      if (session.ended || !session.player.isRegistered() || session.player.getHitpoints() <= 0 || session.action !== action || !mineStep(session, action)) {
        if (session.action === action)
          session.action = null;
        this.stop();
      }
    }
  })());
  return true;
}
function grind(event) {
  const session = Common.sessionOf(event.player);
  if (!session)
    return false;
  const ids = new Set([event.usedItemId, event.usedWithItemId]), { items } = Common.data;
  if (!ids.has(items.pestle))
    return false;
  const raw = ids.has(items.arder) ? items.arder : ids.has(items.musca) ? items.musca : null;
  if (raw == null)
    return false;
  event.handled = true;
  Common.core.TaskManager.cancelTasks(event.player.getIndex());
  if (!grindOne(session, raw))
    return true;
  // The click acts immediately; the next response is two ticks after its response
  // cycle, followed by three-tick repeats (current powder creation pages).
  let wait = 3;
  Common.core.TaskManager.submit(new (class extends Common.core.Task {
    constructor() {
      super(1, event.player.getIndex(), false);
    }
    execute() {
      if (session.ended || !event.player.isRegistered() || event.player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      if (--wait > 0)
        return;
      wait = 3;
      if (!grindOne(session, raw))
        this.stop();
    }
  })());
  return true;
}
function grindOne(session, raw) {
  const player = session.player, inventory = player.getInventory(), { items } = Common.data;
  if (inventory.getAmount(raw) < 1 || inventory.getAmount(items.pestle) < 1)
    return false;
  const result = raw === items.arder ? items.arderPowder : items.muscaPowder;
  const amount = Model.powderYield(player.getSkillManager().getCurrentLevel(Common.core.Skill.HERBLORE));
  const before = inventory.getCopiedItems();
  inventory.deleteNumber(raw, 1);
  if (inventory.getAddableAmount(new Common.core.Item(result, amount)) < amount) {
    inventory.setItems(before);
    inventory.refreshItems();
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.add(new Common.core.Item(result, amount), true);
  const sequence = Common.core.CacheDefinitions.getSeqId('human_herbing_grind');
  player.performAnimation(new Common.core.Animation(sequence));
  sound(player, 2608);
  spam(player, "You grind the mushroom into dust.");
  return true;
}
function fill(session, at) {
  if (!nearVat(session, at))
    return false;
  Common.core.TaskManager.cancelTasks(session.player.getIndex());
  const key = vatKey(at), { resources: r, items } = Common.data, p = session.player;
  const vat = session.vats.get(key) || { readyAt: null, ready: false, tile: at, timer: null, amounts: {} };
  if (vat.readyAt != null) {
    Common.messageBox(p, "The vat is currently fermenting.");
    return true;
  }
  const inventory = p.getInventory();
  let added = false;
  for (const row of ingredientRows()) {
    const held = vat.amounts[row.id] || 0, count = Math.min(r.ingredients - held, inventory.getAmount(row.id));
    if (count > 0) {
      inventory.deleteNumber(row.id, count);
      vat.amounts[row.id] = held + count;
      added = true;
      spam(p, `You add some ${row.name} to the vat.`);
    }
    if (row.raw) {
      const crushed = Math.min(r.ingredients - (vat.amounts[row.id] || 0), inventory.getAmount(row.raw));
      if (crushed > 0) {
        inventory.deleteNumber(row.raw, crushed);
        vat.amounts[row.id] = (vat.amounts[row.id] || 0) + crushed;
        added = true;
        spam(p, `You crush some ${row.id === items.muscaPowder ? "musca mushroom" : "arder mushroom"} into to the vat with your hands.`);
      }
    }
  }
  if (!added) {
    Common.messageBox(p, "You don't appear to have any ingredients to add.");
    return true;
  }
  session.vats.set(key, vat);
  animate(p, 'qip_cook_hopper_grain');
  sound(p, 2447);
  if (ingredientRows().every(row => vat.amounts[row.id] === r.ingredients)) {
    vat.readyAt = session.tick + r.fermentTicks;
    vat.timer = session.spawnPassive(Common.data.npcs.vatTimer, at);
    if (vat.timer)
      vat.timer.showHeadbar(Common.data.meters.vat.id, { fill: 0, endFill: Common.data.meters.vat.width, duration: r.fermentTicks * 30 });
    p.sendMessage('The mixture in the vat begins to ferment.');
  }
  return true;
}
function empty(session, at) {
  if (!nearVat(session, at))
    return false;
  Common.core.TaskManager.cancelTasks(session.player.getIndex());
  const key = vatKey(at), vat = session.vats.get(key);
  if (!vat)
    return true;
  const inventory = session.player.getInventory(), before = inventory.getCopiedItems();
  for (const row of ingredientRows()) {
    const amount = vat.amounts[row.id] || 0;
    if (!amount)
      continue;
    const item = new Common.core.Item(row.id, amount);
    if (inventory.getAddableAmount(item) < amount) {
      inventory.setItems(before);
      inventory.refreshItems();
      session.player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    inventory.add(item, false);
  }
  inventory.refreshItems();
  session.removePassive(vat.timer);
  session.vats.delete(key);
  session.place(Common.data.objects.vat, at, vatRotation(at));
  sound(session.player, 2431);
  spam(session.player, 'You empty all of the ingredients from the vat.');
  return true;
}
function check(session, tile) {
  if (!nearVat(session, tile))
    return false;
  const vat = session.vats.get(vatKey(tile));
  const lines = [{ id: Common.data.items.muscaPowder, label: "Musca powder" }, { id: Common.data.items.arderPowder, label: "Arder powder" }, { id: Common.data.items.salt, label: "Salax salt" }].map(({ id, label }, index) => label + (index === 0 ? ": " : ":  ") + (vat?.amounts[id] ?? 0) + " / " + Common.data.resources.ingredients);
  Common.messageBox(session.player, lines.join("<br>"));
  return true;
}
function collect(session, at) {
  if (!nearVat(session, at))
    return false;
  Common.core.TaskManager.cancelTasks(session.player.getIndex());
  const key = vatKey(at), vat = session.vats.get(key);
  if (!vat?.ready) {
    Common.messageBox(session.player, "The vat is currently fermenting.");
    return true;
  }
  if (Common.give(session.player, Common.data.items.poison)) {
    session.vats.delete(key);
    session.place(Common.data.objects.vat, at, vatRotation(at));
    animate(session.player, 'qip_cook_hopper_grain');
    sound(session.player, 2434);
    session.player.sendMessage('You collect some poison from the vat.');
    session.player.getSkillManager().addExperiences(Common.core.Skill.HERBLORE, 10);
  }
  return true;
}
function object(event) {
  const session = Common.sessionOf(event.player);
  if (!session || event.player.getPrivateArea?.() !== session.area)
    return false;
  const id = event.objectId ?? event.definition?.id, { objects: o, resources: r, items } = Common.data;
  const at = Common.source(session, event.location ?? event.object?.getLocation());
  if ((session.fight.active || session.fight.over) && [o.arder, o.musca, o.salt, o.vat, o.readyVat, o.pestle, o.pickaxe].includes(id))
    return true;
  if (id === o.arder)
    return pick(session, 'arder');
  if (id === o.musca)
    return pick(session, 'musca');
  if (id === o.salt)
    return mine(session, at);
  const vat = r.vats.find(tile => Model.near(tile, at, 0));
  if (vat && (id === o.vat || id === o.readyVat)) {
    const option = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? event.option ?? '').toLowerCase();
    if (option === 'empty')
      return empty(session, vat);
    if (option === 'check')
      return check(session, vat);
    return id === o.readyVat ? collect(session, vat) : fill(session, vat);
  }
  if ((id === o.pestle || id === o.pickaxe) && near(session, at) && !session.tools.has(id)) {
    if (Common.give(event.player, id === o.pestle ? items.pestle : items.ironPickaxe)) {
      session.tools.add(id);
      session.place(id === o.pestle ? o.inactivePestle : o.inactivePickaxe, at, 1);
    }
    return true;
  }
  return false;
}
function process(session) {
  if (session.wakeAt != null && session.tick >= session.wakeAt) {
    session.wakeAt = null;
    session.picks = { arder: 0, musca: 0 };
    session.fight.wake();
    session.player.sendMessage("<col=ef0083>Duke Sucellus awakens...");
  }
  for (const vat of session.vats.values())
    if (!vat.ready && vat.readyAt != null && session.tick >= vat.readyAt) {
      vat.ready = true;
      session.removePassive(vat.timer);
      vat.timer = null;
      if (!session.fight.active && !session.fight.over)
        session.place(Common.data.objects.readyVat, vat.tile, vatRotation(vat.tile));
      sound(session.player, 2655);
      session.player.sendMessage('<col=06600c>A fermentation vat is ready to be emptied.</col>');
    }
}
function mineStep(session, a) {
  const p = session.player, here = Common.source(session, p.getLocation());
  if (session.fight.active || session.fight.over || !Model.near(here, a.start, 0) || !nearSalt(session, a.at))
    return false;
  if (session.tick >= a.until) {
    p.sendMessage('Your arms get tired from all the mining.');
    return false;
  }
  if (session.tick < a.next)
    return true;
  a.next = session.tick + a.interval;
  const amount = Model.saltYield(p.getSkillManager().getCurrentLevel(Common.core.Skill.MINING));
  if (!Common.give(p, Common.data.items.salt, amount))
    return false;
  p.performAnimation(a.pickaxe.animation);
  spam(p, 'You manage to mine some salt.');
  p.getSkillManager().addExperiences(Common.core.Skill.MINING, 5);
  return true;
}
function feed(event) {
  const session = Common.sessionOf(event.player);
  if (!session || (event.npc ?? event.target) !== session.boss || !Model.melee(Common.source(session, event.player.getLocation())))
    return false;
  if (event.itemId != null && ![Common.data.items.poison, Common.data.items.arderPowder, Common.data.items.muscaPowder].includes(event.itemId))
    return false;
  event.handled = true;
  Common.core.TaskManager.cancelTasks(event.player.getIndex());
  if (session.fight.active || session.fight.over)
    return true;
  const inventory = event.player.getInventory(), { items } = Common.data;
  const powder = inventory.getItems().find(held => held && held.getAmount() > 0 && [items.arderPowder, items.muscaPowder].includes(held.getId()))?.getId();
  const item = event.itemId ?? (inventory.getAmount(items.poison) > 0 ? items.poison : powder);
  if (!item || inventory.getAmount(item) < 1) {
    event.player.sendMessage("You don't have anything to feed him.");
    return true;
  }
  const cycle = Common.core.World.getProcessCycle();
  if (item !== items.poison && session.lastPowderCycle === cycle)
    return true;
  const result = Model.feed(session.meter, item === Common.data.items.poison ? Common.data.normal.poison : 5, Common.data.normal.meter);
  if (!result.consumed)
    return true;
  inventory.deleteNumber(item, 1);
  animate(event.player, 'human_pickuptable_walkmerge');
  sound(event.player, 7249, 30);
  const damage = result.meter - session.meter;
  session.meter = result.meter;
  const splat = new Common.core.HitDamage(damage, Common.core.HitMask.GREEN).setSplatTypes(Common.data.meters.poisonSplat, Common.data.meters.poisonSplat);
  splat.setSource(event.player);
  session.boss.addTickHit(splat);
  session.boss.setDisplayedHealth({ current: session.meter, max: Common.data.normal.meter, bar: Common.data.meters.poison });
  if (item !== items.poison)
    session.lastPowderCycle = cycle;
  if (result.awake) {
    session.wakeAt = session.tick + 1;
  }
  return true;
}
function attach(api) {
  api.onItemOnItem('Pestle and mortar', 'Arder mushroom', grind, { noted: false });
  api.onItemOnItem('Pestle and mortar', 'Musca mushroom', grind, { noted: false });
  api.onItemOnNpc(feed);
  api.onNpcInteraction('Duke Sucellus', { Feed: feed });
}
module.exports = { refresh, pick, mine, grind, fill, collect, empty, check, object, process, feed, attach };
