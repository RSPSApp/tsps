const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");

const SPELLS = {
    "cure plant": { level: 66, xp: 60, runes: [["Astral rune", 1], ["Earth rune", 8]] },
    "fertile soil": { level: 83, xp: 87, runes: [["Astral rune", 3], ["Nature rune", 2], ["Earth rune", 15]] },
    "resurrect crops": { level: 78, xp: 90, runes: [["Earth rune", 25], ["Blood rune", 8], ["Nature rune", 12], ["Soul rune", 8]] },
    "geomancy": { level: 65, xp: 60, runes: [["Astral rune", 3], ["Nature rune", 3], ["Earth rune", 8]] },
};
class FarmingSpell extends core.Spell {
    constructor(key, id) { super(); this.key = key; this.id = id; }
    spellId() { return this.id; }
    levelRequired() { return SPELLS[this.key].level; }
    baseExperience() { return SPELLS[this.key].xp; }
    itemsRequired() { return SPELLS[this.key].runes.map(([name, amount]) => new core.Item(Data.itemId(name), amount)); }
    equipmentRequired() { return []; }
    startCast() {}
    getSpellbook() { return this.key === "resurrect crops" ? core.MagicSpellbook.ARCEUUS : core.MagicSpellbook.LUNAR; }
    cast(player) {
        if (!this.canCast(player, true)) return false;
        player.performAnimation(new core.Animation(4413));
        player.getSkillManager().addExperiences(core.Skill.MAGIC, this.baseExperience());
        return true;
    }
}
function farmingSpell(event, patch) {
    const key = core.CacheDefinitions.getSpellName(event.spellWidget, event.spellItemId)?.toLowerCase();
    if (!SPELLS[key] || key === "geomancy") return;
    event.handled = true;
    const { player } = event;
    Model.advanceFarm(Patches.farmFor(player), Date.now());
    const state = Patches.stateFor(player, patch);
    if (patch.type.includes("COMPOST") || patch.type === "ANIMA") { player.sendMessage("That spell cannot affect this patch."); return; }
    if (key === "cure plant" && state.status !== "diseased") { player.sendMessage("The plant is not diseased."); return; }
    if (key === "fertile soil" && (state.weeds || state.compost || state.status === "dead" || ["GRAPES", "CORAL"].includes(patch.type))) {
        player.sendMessage("This patch cannot be treated now."); return;
    }
    if (key === "resurrect crops" && (state.status !== "dead" || state.resurrected)) { player.sendMessage("You cannot resurrect this crop."); return; }
    if (!new FarmingSpell(key, event.spellId).cast(player)) return;
    if (key === "cure plant") Patches.cure(player, patch, false);
    else if (key === "fertile soil") {
        const ultra = (Patches.farmFor(player).ultraFertile || player.getPacketSender().getVarbit(5960) > 0) && player.getInventory().getAmount(Data.itemId("Volcanic ash")) >= 2;
        if (ultra) player.getInventory().deleteNumber(Data.itemId("Volcanic ash"), 2);
        Patches.fertilize(player, patch, ultra ? 3 : 2, false);
    }
    else {
        const level = Math.min(99, player.getSkillManager().getCurrentLevel(core.Skill.MAGIC));
        if (Math.random() < 0.5 + (level - 78) / 84) {
            state.resurrected = true;
            state.status = "growing";
            state.nextAt = Model.nextGrowth(Date.now(), Data.CROPS.get(state.crop).minutes, Patches.farmFor(player).offset);
            player.sendMessage("You restore the crop to life.");
        } else { Patches.clearPatch(player, patch); player.sendMessage("The spell fails and clears the dead crop."); }
    }
    Patches.syncPatch(player, patch);
}
function farmingButton(event) {
    const key = core.CacheDefinitions.getSpellName(event.buttonId, -1)?.toLowerCase();
    if (key !== "geomancy") return;
    event.handled = true;
    if (!new FarmingSpell(key, event.buttonId).cast(event.player)) return;
    const farm = Patches.farmFor(event.player);
    Model.advanceFarm(farm, Date.now());
    const patches = Data.CACHE.patches.filter(p => farm.patches[Data.patchKey(p)]?.crop);
    if (!patches.length) { event.player.sendMessage("You have no crops growing."); return; }
    Patches.choose(event.player, patches.map(p => {
        const s = farm.patches[Data.patchKey(p)];
        return [`${Data.CROPS.get(s.crop).name}: ${s.status}`, () => event.player.sendMessage(`Patch at ${p.x}, ${p.y}: ${s.status}${s.protected ? ", gardener protected" : ""}.`)];
    }));
}

Object.assign(module.exports, { farmingSpell, farmingButton });
