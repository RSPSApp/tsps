const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");
const Guild = require("./Guild.Farming");

const CROPS = [
    { name: "Golovanova", level: 34, xp: 6, object: core.ObjectIdentifiers.GOLOVANOVA_SEEDLING },
    { name: "Bologano", level: 54, xp: 14, object: core.ObjectIdentifiers.BOLOGANO_SEEDLING },
    { name: "Logavano", level: 74, xp: 23, object: core.ObjectIdentifiers.LOGAVANO_SEEDLING },
];
const REWARDS = [["Farmer's strawhat", 75], ["Farmer's jacket", 150], ["Farmer's shirt", 150],
    ["Farmer's boro trousers", 125], ["Farmer's boots", 50], ["Compost", 1], ["Supercompost", 5], ["Grape seed", 2],
    ["Gricoller's can", 200], ["Seed box", 250], ["Herb sack", 250], ["Herb box", 30], ["Seed pack", 30], ["Bologa's blessing", 1, 20]];
class TitheArea extends core.PrivateArea {
    constructor() { super([new core.Boundary(1805, 1840, 3485, 3518, 0)]); }
    process(mobile) { if (mobile.isPlayer?.()) titheProcess({ player: mobile.getAsPlayer() }); }
    postLeave(mobile, logout) {
        super.postLeave(mobile, logout);
        // Logging out keeps the run's items; titheLogout has already ended the game.
        const player = mobile.isPlayer?.() ? mobile.getAsPlayer() : null;
        if (player && !logout && GAMES.has(player)) leave(player);
    }
}
const GAMES = new WeakMap();
function scoreFor(player) { return Patches.farmFor(player).tithe ??= { points: 0, score: 0 }; }
function inField(player) {
    const p = player.getLocation();
    return p.getX() > 1805 && p.getX() <= 1840 && p.getY() >= 3485 && p.getY() <= 3518 && p.getZ() === 0;
}
function sync(player) {
    const score = scoreFor(player);
    player.getPacketSender().sendVarbit(4893, score.points).sendVarbit(4900, score.score);
}
function enter(player) {
    const area = new TitheArea();
    player.getArea()?.leave(player, false);
    area.enter(player);
    const plots = new Map();
    for (const base of Data.CACHE.scenery.filter(p => p.id === core.ObjectIdentifiers.TITHE_PATCH && p.y >= 3485)) plots.set(`${base.x}:${base.y}`, { base });
    GAMES.set(player, { area, plots });
    core.PluginManager.emitCustomEvent("tithe-farm:entered", { player });
    player.getPacketSender().sendVarbit(4909, 1);
    sync(player);
}
function redraw(game, plot) {
    const p = plot.plant;
    const id = !p ? core.ObjectIdentifiers.TITHE_PATCH : CROPS[p.crop].object + (p.stage === 3 ? 9 : p.stage * 3 + (p.dead ? 2 : p.watered ? 1 : 0));
    if (plot.object?.getId() === id) return;
    if (plot.object) {
        core.ObjectManager.deregister(plot.object, false);
        game.area.detach(plot.object);
    }
    const b = plot.base;
    plot.object = new core.GameObject(id, new core.Location(b.x, b.y, b.z), b.shape, b.face, game.area);
    core.ObjectManager.register(plot.object, true);
}
function titheLogin({ player }) { if (inField(player)) enter(player); }
function titheLogout({ player }) {
    const game = GAMES.get(player);
    if (!game) return;
    GAMES.delete(player);
    if (player.getArea() === game.area) game.area.leave(player, true);
    else game.area.destroy();
}
function leave(player) {
    titheLogout({ player });
    const inventory = player.getInventory();
    for (const crop of CROPS) for (const suffix of [" seed", " fruit"]) inventory.deleteNumber(Data.itemId(crop.name + suffix), inventory.getAmount(Data.itemId(crop.name + suffix)));
    inventory.deleteNumber(Data.itemId("Gricoller's fertiliser"), inventory.getAmount(Data.itemId("Gricoller's fertiliser")));
    scoreFor(player).score = 0;
    sync(player);
}
function titheProcess({ player }) {
    const game = GAMES.get(player);
    if (!game) return;
    if (!inField(player) || player.getArea() !== game.area) { leave(player); return; }
    for (const plot of game.plots.values()) if (plot.plant) { Model.advanceTithe(plot.plant, Date.now()); redraw(game, plot); }
}
function titheObject(event) {
    const { player, object } = event;
    const id = object.getId();
    if (id === core.ObjectIdentifiers.FARM_DOOR) {
        event.handled = true;
        if (inField(player)) {
            Patches.choose(player, [["Leave and discard this batch", () => {
                if (!player.getLocation().isWithinDistance(object.getLocation(), 3)) return;
                leave(player); player.moveTo(new core.Location(1804, 3501, 0));
            }], ["Stay", () => {}]]);
        } else if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < 34) player.sendMessage("You need level 34 Farming to enter.");
        else if (!CROPS.some(c => player.getInventory().contains(Data.itemId(c.name + " seed")))) player.sendMessage("Take some seeds from the table first.");
        else {
            enter(player); player.moveTo(new core.Location(1806, 3501, 0));
            if (!player.getInventory().contains(Data.itemId("Gricoller's fertiliser"))) Patches.give(player, Data.itemId("Gricoller's fertiliser"));
        }
        return;
    }
    if (id === core.ObjectIdentifiers.SEED_TABLE) {
        event.handled = true;
        Patches.choose(player, CROPS.map(c => [`${c.name} seeds (level ${c.level})`, () => {
            if (!player.getLocation().isWithinDistance(object.getLocation(), 4)) return;
            if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < c.level) { player.sendMessage(`You need level ${c.level} Farming.`); return; }
            if (CROPS.some(other => other !== c && (player.getInventory().contains(Data.itemId(other.name + " seed")) || player.getInventory().contains(Data.itemId(other.name + " fruit"))))) {
                player.sendMessage("You can only use one type of seed at a time."); return;
            }
            Patches.choose(player, [100, 1000, 10000].map(amount => [`Take ${amount}`, () => {
                if (!player.getLocation().isWithinDistance(object.getLocation(), 4)) return;
                if (CROPS.some(other => other !== c && player.getInventory().contains(Data.itemId(other.name + " seed")))) return;
                const count = Math.min(amount, 10000 - player.getInventory().getAmount(Data.itemId(c.name + " seed")));
                if (count > 0) Patches.give(player, Data.itemId(c.name + " seed"), count);
            }]));
        }]));
        return;
    }
    const game = GAMES.get(player);
    if (!game) return;
    if ([core.ObjectIdentifiers.SACK_16, core.ObjectIdentifiers.SACK_17].includes(id)) {
        event.handled = true;
        const crop = CROPS.find(c => player.getInventory().contains(Data.itemId(c.name + " fruit")));
        if (!crop) { player.sendMessage("You have no fruit to deposit."); return; }
        const score = scoreFor(player), fruit = Data.itemId(crop.name + " fruit");
        const result = Model.titheDeposit(score.score, player.getInventory().getAmount(fruit), crop.xp);
        player.getInventory().deleteNumber(fruit, result.count);
        score.score = result.score;
        score.points = Math.min(16000, score.points + result.points);
        Patches.award(player, result.xp);
        player.getSkillManager().addExperiences(core.Skill.FARMING, result.bonus);
        sync(player);
        player.sendMessage(`You have ${score.score} fruit in the sack and ${score.points} reward points.`);
        return;
    }
    const plot = game.plots.get(`${event.location.x}:${event.location.y}`);
    if (!plot) return;
    event.handled = true;
    titheProcess({ player });
    const plant = plot.plant;
    if (!plant) return;
    if (plant.dead) { if (Patches.requireTool(player, "Spade")) { plot.plant = undefined; player.performAnimation(new core.Animation(830)); } }
    else if (plant.stage === 3) {
        if (Patches.give(player, Data.itemId(CROPS[plant.crop].name + " fruit"))) {
            Patches.award(player, CROPS[plant.crop].xp);
            core.PluginManager.emitCustomEvent("farming:success", { player, petChance: 7494000 - player.getSkillManager().getMaxLevel(core.Skill.FARMING) * 25 });
            player.performAnimation(new core.Animation(2282));
            plot.plant = undefined;
        }
    } else if (!plant.watered && Patches.water(player)) plant.watered = true;
    redraw(game, plot);
}
function titheItem(event) {
    const game = GAMES.get(event.player);
    const plot = game?.plots.get(`${event.location.x}:${event.location.y}`);
    if (!plot) return;
    event.handled = true;
    const { player, itemId: id } = event;
    if (player.getInventory().forSlot(event.itemSlot)?.getId() !== id) return;
    titheProcess({ player });
    const crop = CROPS.findIndex(c => id === Data.itemId(c.name + " seed"));
    if (crop >= 0 && !plot.plant) {
        if (player.getSkillManager().getCurrentLevel(core.Skill.FARMING) < CROPS[crop].level || !Patches.requireTool(player, "Seed dibber")) return;
        player.getInventory().deleteNumber(id, 1);
        plot.plant = { crop, stage: 0, watered: false, dead: false, fertilized: false, nextAt: Date.now() + 60000 };
        player.performAnimation(new core.Animation(2291));
    } else if (plot.plant && id === Data.itemId("Spade")) {
        plot.plant = undefined; player.performAnimation(new core.Animation(830));
    } else if (plot.plant && !plot.plant.dead && plot.plant.stage < 3) {
        if (id === Data.itemId("Gricoller's fertiliser") && !plot.plant.fertilized) {
            plot.plant.fertilized = true;
            plot.plant.nextAt = Date.now() + Math.max(0, plot.plant.nextAt - Date.now()) / 2;
            player.performAnimation(new core.Animation(2283));
        } else if (/watering can|Gricoller's can/i.test(core.CacheDefinitions.getItem(id).name) && !plot.plant.watered && Patches.water(player, id)) plot.plant.watered = true;
    }
    redraw(game, plot);
}
function titheItemOnNpc(event) {
    if (event.target.getDefinition()?.getName() !== "Farmer Gricoller") return;
    const reward = REWARDS.find(([name]) => name.startsWith("Farmer's") && Data.itemId(name) === event.itemId);
    if (!reward) return;
    event.handled = true;
    const { player } = event, refund = Math.floor(reward[1] * 0.8);
    Patches.choose(player, [[`Return ${reward[0]} for ${refund} points`, () => {
        if (!player.getLocation().isWithinDistance(event.target.getLocation(), 5) || player.getInventory().forSlot(event.slot)?.getId() !== event.itemId) return;
        const score = scoreFor(player);
        if (score.points + refund > 16000) { player.sendMessage("Spend some reward points first."); return; }
        player.getInventory().deleteAtSlot(event.slot);
        score.points += refund; sync(player);
    }], ["Keep the item", () => {}]]);
}
function titheNpc(event) {
    if (event.definition?.getName() === "Bologa") {
        event.handled = true;
        const { player } = event, score = scoreFor(player);
        if (score.bologa) { player.sendMessage("You may buy my blessings from Farmer Gricoller."); return; }
        Patches.choose(player, [["Unlock grape blessings (75,000 coins)", () => {
            if (score.bologa || !player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
            if (player.getSkillManager().getCurrentLevel(core.Skill.PRAYER) < 50) { player.sendMessage("You need level 50 Prayer."); return; }
            if (!player.getEquipment().getItems().some(i => /zamorak|unholy/i.test(core.CacheDefinitions.getItem(i.getId()).name))) {
                player.sendMessage("Wear an item dedicated to Zamorak first."); return;
            }
            if (player.getInventory().getAmount(Data.itemId("Coins")) < 75000) { player.sendMessage("You need 75,000 coins."); return; }
            player.getInventory().deleteNumber(Data.itemId("Coins"), 75000);
            score.bologa = true; player.sendMessage("You can now purchase grape blessings from Gricoller.");
        }]]);
        return;
    }
    if (event.definition?.getName() !== "Farmer Gricoller") return;
    event.handled = true;
    const { player } = event;
    const score = scoreFor(player);
    player.sendMessage(`You have ${score.points} Tithe Farm reward points.`);
    const entries = REWARDS.map(([name, cost, amount]) => [`${name} (${cost} points)`, () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (score.points < cost) { player.sendMessage("You do not have enough points."); return; }
        if (name === "Herb sack" && player.getSkillManager().getCurrentLevel(core.Skill.HERBLORE) < 58) { player.sendMessage("You need level 58 Herblore."); return; }
        if (name === "Bologa's blessing" && !score.bologa) { player.sendMessage("First arrange for Bologa to bless your grapes."); return; }
        const itemId = Data.itemId(name);
        const received = name === "Seed pack"
            ? Guild.giveSeedPack(player, 3, true)
            : Patches.give(player, itemId, amount ?? 1);
        if (!received) return;
        score.points -= cost;
        sync(player);
        core.PluginManager.emitCustomEvent("collection-log:obtain", { player, itemId, amount: amount ?? 1 });
    }]);
    entries.push([score.autoWeedUnlocked ? "Toggle Auto-weed" : "Unlock Auto-weed (50 points)", () => {
        if (!player.getLocation().isWithinDistance(event.npc.getLocation(), 5)) return;
        if (!score.autoWeedUnlocked && score.points < 50) { player.sendMessage("You need 50 points."); return; }
        if (!score.autoWeedUnlocked) { score.points -= 50; score.autoWeedUnlocked = true; }
        Patches.farmFor(player).autoWeed = !Patches.farmFor(player).autoWeed;
        player.sendMessage(`Auto-weed is ${Patches.farmFor(player).autoWeed ? "enabled" : "disabled"}.`); sync(player);
    }]);
    Patches.choose(player, entries);
}

Object.assign(module.exports, { titheLogin, titheLogout, titheProcess, titheObject, titheItem, titheItemOnNpc, titheNpc });
