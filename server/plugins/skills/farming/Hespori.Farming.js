
// Animation/projectile names verified in RuneLite gameval and this cache.
const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Patches = require("./Patches.Farming");
const Services = require("./Services.Farming");
const ANIMATION = { SPAWN: 8221, SPECIAL: 8223, RANGED: 8224 };
const PROJECTILE = { RANGE: 1639, MAGIC: 1640, VINES: 1642 };
const EXIT = new core.Location(1232, 3728, 0);
class HesporiArea extends core.PrivateArea {
    constructor() { super([new core.Boundary(1216, 1279, 10048, 10111, 0)]); }
}
const FIGHTS = new WeakMap();
const NPC_FIGHTS = new WeakMap();

function spawn(fight, id, x, y) {
    const npc = core.PluginManager.spawnNpc({ id, x, y, z: 0, owner: fight.player, ownerOnly: true, wanderRadius: 0 });
    (npc).__skipDefaultRespawn = true;
    npc.getMovementQueue().setBlockMovement(true);
    fight.area.enter(npc);
    NPC_FIGHTS.set(npc, fight);
    return npc;
}
function flowers(fight) {
    for (const flower of fight.flowers) core.World.getRemoveNPCQueue().push(flower);
    fight.flowers = [[-3, -3], [-3, 5], [5, -3], [5, 5]].map(([x, y]) =>
        spawn(fight, core.NpcIdentifiers.FLOWER, fight.patch.x + x, fight.patch.y + y));
    fight.phase++;
}
function harvestHespori(player, patch) {
    if (!Patches.requireTool(player, "Spade")) return;
    const state = Patches.stateFor(player, patch);
    if (state.hesporiLoot) {
        while (state.hesporiLoot.length) {
            const drop = state.hesporiLoot[0];
            if (!Patches.give(player, drop.itemId, drop.amount)) return;
            state.hesporiLoot.shift();
        }
        Patches.award(player, Data.CROPS.get("HESPORI").harvest);
        Services.cropRewards(player, Data.CROPS.get("HESPORI"));
        Patches.clearPatch(player, patch);
        return;
    }
    if (FIGHTS.has(player) || state.status !== "grown") return;
    if (Patches.farmFor(player).deathbank?.length) {
        player.sendMessage("Collect your items from Arno before starting another fight."); return;
    }
    const area = player.getArea() instanceof HesporiArea ? player.getArea()  : new HesporiArea();
    if (player.getArea() !== area) { player.getArea()?.leave(player, false); area.enter(player); }
    const fight = { player, patch, area, boss: null, flowers: [], phase: 0, attacks: 0, vinesUntil: 0, escapeClicks: 0 };
    FIGHTS.set(player, fight);
    fight.boss = spawn(fight, core.NpcIdentifiers.HESPORI, patch.x, patch.y);
    fight.boss.setHitpoints(300);
    fight.boss.performAnimation(new core.Animation(ANIMATION.SPAWN));
    flowers(fight);
    fight.boss.getCombat().attack(player);
    state.hesporiFight = true;
    Patches.syncPatch(player, patch);
}
class HesporiCombat extends core.CombatMethod {
     style = core.CombatType.RANGED;
     special = false;
    type() { return this.style; }
    attackSpeed() { return 6; }
    attackDistance() { return 16; }
    canAttack(npc, target) { return NPC_FIGHTS.get(npc)?.player === target; }
    start(npc, target) {
        const fight = NPC_FIGHTS.get(npc);
        if (!fight) return;
        // ponytail: approximate the documented 30–40 second entangle window; exact scheduling needs an OSRS capture.
        this.special = ++fight.attacks % 9 === 0;
        this.style = Math.random() < 0.5 ? core.CombatType.RANGED : core.CombatType.MAGIC;
        npc.performAnimation(new core.Animation(this.style === core.CombatType.RANGED && !this.special ? ANIMATION.RANGED : ANIMATION.SPECIAL));
        core.Projectile.createProjectile(npc, target, this.special ? PROJECTILE.VINES : this.style === core.CombatType.RANGED ? PROJECTILE.RANGE : PROJECTILE.MAGIC, 40, 65, 31, 43).sendProjectile();
        if (this.special) {
            fight.vinesUntil = core.World.getProcessCycle() + 10;
            fight.escapeClicks = 0;
            target.getMovementQueue().setBlockMovement(true).reset();
            target.getCombat().reset();
            target.performGraphic(new core.Graphic(1643));
            target.sendMessage("Hespori entangles you in some vines!");
        }
    }
    hits(npc, target) {
        if (this.special) return [];
        const ranged = this.style === core.CombatType.RANGED;
        return Array.from({ length: ranged ? 2 : 1 }, (_, index) => {
            const hit = new core.PendingHit(npc, target, this, 2 + index);
            const prayer = target.getPrayerActive()[ranged ? core.PrayerHandler.PROTECT_FROM_MISSILES : core.PrayerHandler.PROTECT_FROM_MAGIC];
            const damage = hit.isAccurate() ? Math.floor(Math.random() * (ranged ? 9 : 15)) : 0;
            hit.setTotalDamage(Math.min(target.getHitpoints(), prayer ? Math.floor(damage / 4) : damage));
            return hit;
        });
    }
    handleAfterHitEffects(hit) {
        // ponytail: poison severity is documented; its proc probability remains an estimate.
        if (hit.getTotalDamage() > 0 && Math.random() < 0.125) core.CombatFactory.poisonEntity(hit.getTarget(), 4);
    }
}
function hesporiHitRoll(event) {
    const fight = NPC_FIGHTS.get(event.attacker);
    if (fight?.boss === event.attacker) event.bypassProtectionPrayer = true;
    const defending = NPC_FIGHTS.get(event.target);
    if (defending?.flowers.includes(event.target)) event.forceAccurate = true;
}
function hesporiCanAttack(event) {
    if (NPC_FIGHTS.get(event.attacker)?.flowers.includes(event.attacker)) { event.allow = false; return; }
    const fight = NPC_FIGHTS.get(event.target);
    if (!fight) return;
    if (fight.player !== event.attacker || fight.vinesUntil || (event.target === fight.boss && fight.flowers.some(n => n.getHitpoints() > 0))) event.allow = false;
}
function hesporiHit(event) {
    const fight = NPC_FIGHTS.get(event.target);
    if (!fight) return;
    if (fight.flowers.includes(event.target)) event.target.setHitpoints(0);
    else if (event.target === fight.boss && fight.phase < 3) {
        const remaining = fight.boss.getHitpoints() - fight.boss.getCombat().getHitQueue().getQueuedDamage();
        if (remaining > 0 && remaining <= 300 - fight.phase * 100) flowers(fight);
    }
}
function hesporiDamage(event) {
    const fight = NPC_FIGHTS.get(event.target);
    if (fight?.flowers.includes(event.target)) event.hit.setTotalDamage(event.target.getHitpoints());
}
function hesporiInput(event) {
    const fight = FIGHTS.get(event.player);
    if (!fight?.vinesUntil || !["move", "npc_option", "spell_on_npc"].includes(event.packet.type)) return;
    event.handled = true;
    if (++fight.escapeClicks < 6) { event.player.sendMessage("You feel the vines loosen slightly as you try to move."); return; }
    releaseVines(fight);
    event.player.sendMessage("You break free of the vines.");
}
function releaseVines(fight) {
    fight.vinesUntil = 0;
    fight.player.getMovementQueue().setBlockMovement(false);
}
function hesporiProcess({ player }) {
    const fight = FIGHTS.get(player);
    if (!fight) return;
    if (player.getArea() !== fight.area) { hesporiLogout({ player }); return; }
    if (fight.vinesUntil && core.World.getProcessCycle() >= fight.vinesUntil) {
        releaseVines(fight);
        player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(40 + Math.floor(Math.random() * 11), core.HitMask.RED)]);
    }
}
function hesporiLoot(event) {
    const fight = NPC_FIGHTS.get(event.npc);
    if (!fight || fight.boss !== event.npc) return;
    event.handled = true;
    // The existing drop table supplies the main roll. Anima is one guaranteed roll, not three independent rolls.
    const anima = ["Attas seed", "Iasor seed", "Kronos seed"].map(Data.itemId);
    const loot = event.drops.filter((d) => !anima.includes(d.itemId) && d.itemId !== Data.itemId("Tangleroot"));
    loot.push({ itemId: anima[Math.floor(Math.random() * anima.length)], amount: 1 + Math.floor(Math.random() * 2) });
    Patches.stateFor(fight.player, fight.patch).hesporiLoot = loot.map(({ itemId, amount, noted }) => ({
        itemId: noted && core.CacheDefinitions.getItem(itemId).note >= 0 ? core.CacheDefinitions.getItem(itemId).note : itemId,
        amount,
    }));
    Patches.stateFor(fight.player, fight.patch).hesporiFight = false;
    releaseVines(fight);
    for (const flower of fight.flowers) core.World.getRemoveNPCQueue().push(flower);
    FIGHTS.delete(fight.player);
    Patches.syncPatch(fight.player, fight.patch);
    fight.player.sendMessage("The Hespori is defeated. Clear the patch to collect your harvest.");
}
function hesporiLogout({ player }) {
    const fight = FIGHTS.get(player);
    if (!fight) return;
    Patches.stateFor(player, fight.patch).hesporiFight = false;
    releaseVines(fight);
    for (const npc of [fight.boss, ...fight.flowers]) core.World.getRemoveNPCQueue().push(npc);
    FIGHTS.delete(player);
}
function hesporiDeathDrop(event) {
    const fight = FIGHTS.get(event.player);
    if (!fight || !event.dropEligible) return;
    const farm = Patches.farmFor(event.player);
    if (!fight.deathCaptured) { farm.deathbank = []; farm.deathbankPaid = false; fight.deathCaptured = true; }
    farm.deathbank.push({ id: event.item.getId(), amount: event.item.getAmount(), meta: core.Item.cloneMeta(event.item.getMeta()) });
    event.suppressDefaultDrop = true;
    event.handled = true;
}
function hesporiPlayerDeath(event) {
    if (!FIGHTS.has(event.player) && (core.PluginManager.emitShouldDropItemsOnDeath(event.player, event.killer) ?? true)) {
        Patches.farmFor(event.player).deathbank = [];
    }
}
function hesporiNpc(event) {
    if (event.definition?.getName() !== "Arno" || event.definition.getActions()?.[event.clickType - 1]?.toLowerCase() !== "collect") return;
    event.handled = true;
    const { player } = event;
    const farm = Patches.farmFor(player);
    if (!farm.deathbank?.length) { player.sendMessage("Arno has no items for you."); return; }
    Patches.choose(player, [[farm.deathbankPaid ? "Collect your items" : "Retrieve items (25,000 coins)", () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (!farm.deathbankPaid) {
            if (player.getInventory().getAmount(Data.itemId("Coins")) < 25000) { player.sendMessage("You need 25,000 coins."); return; }
            player.getInventory().deleteNumber(Data.itemId("Coins"), 25000);
            farm.deathbankPaid = true;
        }
        while (farm.deathbank.length && player.getInventory().getFreeSlots()) {
            const saved = farm.deathbank.shift();
            player.getInventory().addItem(new core.Item(saved.id, saved.amount, saved.meta));
        }
    }]]);
}
function hesporiCave(event) {
    const { player, location, definition } = event;
    if (!definition?.getName()?.toLowerCase().includes("cave") || location.x < 1216 || location.x > 1279) return;
    const action = definition.getInteractions()?.[event.clickType - 1]?.toLowerCase();
    if (location.y > 10048 && location.y < 10112 && ["exit", "quick-exit"].includes(action)) {
        event.handled = true;
        hesporiLogout({ player });
        player.getArea()?.leave(player, false);
        player.moveTo(EXIT.clone());
    } else if (location.y > 3700 && location.y < 3730 && action === "enter") {
        event.handled = true;
        const area = new HesporiArea();
        player.getArea()?.leave(player, false);
        area.enter(player);
        player.moveTo(new core.Location(1243, 10081, 0));
    }
}

Object.assign(module.exports, { harvestHespori, HesporiCombat, hesporiHitRoll, hesporiCanAttack, hesporiHit, hesporiDamage, hesporiInput, hesporiProcess, hesporiLoot, hesporiLogout, hesporiDeathDrop, hesporiPlayerDeath, hesporiNpc, hesporiCave });
