
// Animation/projectile names verified in RuneLite gameval and this cache.
const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Patches = require("./Patches.Farming");
const Services = require("./Services.Farming");
const ANIMATION = { SPAWN: 8221, SPECIAL: 8223, RANGED: 8224 };
const PROJECTILE = { RANGE: 1639, MAGIC: 1640, VINES: 1642 };
/** 234/03282: the Hespori cave's Exit lands here, west of the cave (1232,3728 was inside its footprint), and Enter there. */
const EXIT = new core.Location(1230, 3730, 0);
const ENTRY = new core.Location(1242, 10082, 0);
class HesporiArea extends core.PrivateArea {
    constructor() { super([new core.Boundary(1216, 1279, 10048, 10111, 0)]); }
    isMulti() { return true; }
    process(mobile) { if (mobile.isPlayer?.()) hesporiProcess({ player: mobile.getAsPlayer() }); }
    postLeave(mobile, logout) {
        if (mobile.isPlayer?.()) hesporiLogout({ player: mobile.getAsPlayer() });
        super.postLeave(mobile, logout);
    }
    canAttack(attacker, target) {
        const event = { attacker, target, allow: null };
        hesporiCanAttack(event);
        return event.allow;
    }
}
const FIGHTS = new WeakMap();
const NPC_FIGHTS = new WeakMap();
const WARNINGS = new WeakMap();
const ENTRIES = new WeakMap();
const REENTRY_ACTION = "farming-hespori-reentry";
const REENTRY_VARIANT = "attempting-to-fight-the-hespori-with-items-in-arno-s-item-retrieval-service";
let warningSession = 0;

function cancelWarning({ player }) {
    ENTRIES.delete(player);
    const warning = WARNINGS.get(player);
    WARNINGS.delete(player);
    warning?.cancel?.();
}
function warningInterfaceChanged(event) {
    if (event.interfaceId >= 0) cancelWarning(event);
}
function warningSteps(steps, session) {
    return steps.map(step => {
        if (step.type === "action" && ["F74wXQ", "Fh9eKI"].includes(step.id)) {
            return { ...step, action: REENTRY_ACTION, session };
        }
        if (step.type === "choice") return { ...step, options: step.options.map(option =>
            ({ ...option, steps: warningSteps(option.steps, session) })) };
        return step;
    });
}
// Wiki: Arno / Transcript:Arno. Local RSProx recordings contain sightings, not this interaction.
function warnReentry(player, patch) {
    cancelWarning({ player });
    const warning = { patch, state: Patches.stateFor(player, patch), area: player.getArea(),
        position: player.getLocation().clone(), bank: Patches.farmFor(player).deathbank, session: ++warningSession };
    WARNINGS.set(player, warning);
    const request = { player, npcId: core.CacheDefinitions.getNpcId("farming_guild_hespori_farmer"),
        variant: { page: "Arno", variant: REENTRY_VARIANT }, exact: true,
        select: steps => warningSteps(steps, warning.session) };
    core.PluginManager.emitCustomEvent("npc-dialogue:start", request);
    warning.cancel = request.cancel;
    if (!request.handled) WARNINGS.delete(player);
}
function reentryAction(event) {
    if (event.action !== REENTRY_ACTION) return;
    event.handled = true;
    event.end = true;
    const { player } = event;
    const warning = WARNINGS.get(player);
    if (!warning || warning.session !== event.step?.session) return;
    WARNINGS.delete(player);
    if (!player.isRegistered() || player.getHitpoints() <= 0 || player.busy() || player.isNeedsPlacement()
        || player.getArea() !== warning.area || !player.getLocation().equals(warning.position)
        || Patches.stateFor(player, warning.patch) !== warning.state || warning.state.status !== "grown"
        || Patches.farmFor(player).deathbank !== warning.bank || FIGHTS.has(player)) return;
    if (event.stepId === "F74wXQ") {
        player.getArea()?.leave(player, false);
        player.moveTo(EXIT.clone());
    } else if (event.stepId === "Fh9eKI") startFight(player, warning.patch, true);
}

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
        spawn(fight, fight.quest ? core.NpcIdentifiers.FLOWER_2 : core.NpcIdentifiers.FLOWER, fight.patch.x + x, fight.patch.y + y));
    fight.phase++;
}
// The wild quest Hespori shares the farming boss's attacks and flower shields.
function challengeHespori(event) {
    if (FIGHTS.has(event.player)) { event.handled = true; return; }
    const fight = { player: event.player, patch: event.location, area: event.area, quest: true,
        boss: null, flowers: [], phase: 0, attacks: 0, vinesUntil: 0, escapeClicks: 0 };
    FIGHTS.set(fight.player, fight);
    fight.boss = spawn(fight, core.NpcIdentifiers.HESPORI_2, fight.patch.x, fight.patch.y);
    fight.maxHitpoints = fight.boss.getMaxHitpoints();
    flowers(fight);
    fight.boss.getCombat().attack(fight.player);
    event.handled = true;
}
// Capture (recording 3282): the harvest is refused on the next tick as the player is moved in front of
// the patch, the fight's sound playing; a defeated Hespori's patch is dug clear with the loot.
const HARVEST_TILE = new core.Location(1246, 10085, 0);
const HARVEST_SOUND = 4059;
function harvestHespori(player, patch) {
    const state = Patches.stateFor(player, patch);
    if (state.hesporiLoot) {
        if (!Patches.requireTool(player, "Spade", "You need a spade to clear a farming patch.")) return;
        if (player.getInventory().getFreeSlots() < 2) {
            player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
                .add(new core.StatementDialogue(0, "You need at least two free spaces in your inventory to clear this patch.")));
            return;
        }
        Patches.startClear(player, patch, "You start digging the farming patch...", () => {
            if (Patches.stateFor(player, patch) !== state) return;
            while (state.hesporiLoot.length) {
                const drop = state.hesporiLoot[0];
                if (!Patches.give(player, drop.itemId, drop.amount)) return;
                state.hesporiLoot.shift();
            }
            Patches.spam(player, "You have successfully cleared this patch for new crops.");
            Patches.award(player, Data.CROPS.get("HESPORI").harvest);
            Patches.awardPendingPlantExperience(player, patch, state);
            Services.cropRewards(player, Data.CROPS.get("HESPORI"));
            Patches.clearPatch(player, patch);
        });
        return;
    }
    if (FIGHTS.has(player) || state.status !== "grown") return;
    cancelWarning({ player });
    const entry = { position: player.getLocation().clone(), area: player.getArea() };
    ENTRIES.set(player, entry);
    Patches.after(player, 1, () => {
        if (ENTRIES.get(player) !== entry) return;
        ENTRIES.delete(player);
        if (!player.isRegistered() || player.getHitpoints() <= 0 || player.busy()
            || player.getArea() !== entry.area || !player.getLocation().equals(entry.position)
            || Patches.stateFor(player, patch) !== state) return;
        startFight(player, patch);
    });
}
function startFight(player, patch, acceptedWarning = false) {
    const state = Patches.stateFor(player, patch);
    if (FIGHTS.has(player) || state.status !== "grown") return;
    if (Patches.farmFor(player).deathbank?.length && !acceptedWarning) {
        warnReentry(player, patch); return;
    }
    const area = player.getArea() instanceof HesporiArea ? player.getArea()  : new HesporiArea();
    if (player.getArea() !== area) { player.getArea()?.leave(player, false); area.enter(player); }
    player.sendMessage("The Hespori doesn't take kindly to your attempt to harvest it.");
    player.getPacketSender().sendSound(HARVEST_SOUND, 1, 0);
    player.moveTo(HARVEST_TILE.clone());
    const fight = { player, patch, area, boss: null, flowers: [], phase: 0, attacks: 0, vinesUntil: 0, escapeClicks: 0 };
    FIGHTS.set(player, fight);
    fight.boss = spawn(fight, core.NpcIdentifiers.HESPORI, patch.x, patch.y);
    // https://oldschool.runescape.wiki/w/Hespori: immune to ring-of-recoil damage.
    fight.boss.setAttribute(core.CombatFactory.RECOIL_IMMUNE_ATTRIBUTE, true);
    fight.boss.setHitpoints(300);
    fight.maxHitpoints = 300;
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
            // Wiki: Protect from Missiles caps each spore at 2 (8+8 -> 2+2) and Protect from
            // Magic caps the wave at 3; it is a cap, not a quarter of the roll.
            const capped = prayer ? Math.min(damage, ranged ? 2 : 3) : damage;
            hit.setTotalDamage(Math.min(target.getHitpoints(), capped));
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
    if (fight.flowers.includes(event.target) && !fight.quest) event.target.setHitpoints(0);
    else if (event.target === fight.boss && fight.phase < 3) {
        const remaining = fight.boss.getHitpoints() - fight.boss.getCombat().getHitQueue().getQueuedDamage();
        if (remaining > 0 && remaining <= fight.maxHitpoints * (1 - fight.phase / 3)) flowers(fight);
    }
}
function hesporiDamage(event) {
    const fight = NPC_FIGHTS.get(event.target);
    if (fight?.flowers.includes(event.target) && !fight.quest) event.hit.setTotalDamage(event.target.getHitpoints());
}
function hesporiInput(event) {
    cancelWarning(event);
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
    if (fight.quest) keepQuestHesporiEngaged(fight);
    if (fight.vinesUntil && core.World.getProcessCycle() >= fight.vinesUntil) {
        releaseVines(fight);
        player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(40 + Math.floor(Math.random() * 11), core.HitMask.RED)]);
    }
}
function keepQuestHesporiEngaged(fight) {
    if (!fight?.quest || !fight.boss || fight.boss.getHitpoints() <= 0) return false;
    fight.boss.getCombat().getLastAttack().reset();
    return true;
}
function hesporiLoot(event) {
    const fight = NPC_FIGHTS.get(event.npc);
    if (!fight || fight.boss !== event.npc) return;
    event.handled = true;
    if (fight.quest) {
        finishQuestHespori(fight);
        return;
    }
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
function finishQuestHespori(fight) {
    if (!FIGHTS.has(fight.player)) return;
    releaseVines(fight);
    for (const flower of fight.flowers) core.World.getRemoveNPCQueue().push(flower);
    FIGHTS.delete(fight.player);
    core.PluginManager.emitCustomEvent("hespori:quest-defeated", { player: fight.player });
}
function questHesporiDeath({ npc }) {
    const fight = NPC_FIGHTS.get(npc);
    if (fight?.quest && fight.boss === npc) finishQuestHespori(fight);
}
function hesporiLogout({ player }) {
    cancelWarning({ player });
    const fight = FIGHTS.get(player);
    if (!fight) return;
    if (!fight.quest) Patches.stateFor(player, fight.patch).hesporiFight = false;
    releaseVines(fight);
    for (const npc of [fight.boss, ...fight.flowers]) core.World.getRemoveNPCQueue().push(npc);
    FIGHTS.delete(player);
}
function hesporiDeathDrop(event) {
    const fight = FIGHTS.get(event.player);
    if (!fight || fight.quest || !event.dropEligible) return;
    const farm = Patches.farmFor(event.player);
    if (!fight.deathCaptured) { farm.deathbank = []; farm.deathbankPaid = false; fight.deathCaptured = true; }
    farm.deathbank.push({ id: event.item.getId(), amount: event.item.getAmount(), meta: core.Item.cloneMeta(event.item.getMeta()) });
    event.suppressDefaultDrop = true;
    event.handled = true;
}
function hesporiPlayerDeath(event) {
    const fight = FIGHTS.get(event.player);
    // Item capture precedes this hook. An unsafe death without lost items still
    // destroys the previous retrieval; preserve only this death's newly stored items.
    if (!fight?.deathCaptured && (core.PluginManager.emitShouldDropItemsOnDeath(event.player, event.killer) ?? true)) {
        const farm = Patches.farmFor(event.player);
        farm.deathbank = [];
        farm.deathbankPaid = false;
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
            if (player.getInventory().getAmount(core.ItemIdentifiers.COINS) < 25000) { player.sendMessage("You need 25,000 coins."); return; }
            player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, 25000);
            farm.deathbankPaid = true;
        }
        const inventory = player.getInventory();
        for (let index = 0; index < farm.deathbank.length;) {
            const saved = farm.deathbank[index];
            const item = new core.Item(saved.id, saved.amount, saved.meta);
            const amount = inventory.getAddableAmount(item);
            if (amount <= 0) { index++; continue; }
            inventory.addItem(item.setAmount(amount));
            saved.amount -= amount;
            if (saved.amount <= 0) farm.deathbank.splice(index, 1);
            else index++;
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
        player.moveTo(ENTRY.clone());
    }
}

Object.assign(module.exports, { warningInterfaceChanged, reentryAction, questHesporiDeath, challengeHespori, harvestHespori, HesporiCombat, hesporiHitRoll, hesporiCanAttack, hesporiHit, hesporiDamage, hesporiInput, hesporiProcess, keepQuestHesporiEngaged, hesporiLoot, hesporiLogout, hesporiDeathDrop, hesporiPlayerDeath, hesporiNpc, hesporiCave });
