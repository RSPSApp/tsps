const core = require("./Core.Farming");
const Data = require("./Data.Farming");
const Model = require("./Model.Farming");
const Patches = require("./Patches.Farming");
const Geomancy = require("./Geomancy.Farming");

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
function curePlantRefusal(patch, state) {
    if (patch.type.includes("COMPOST")) return "Bins don't often get diseased.";
    if (state.status === "dead") return "It says 'Cure' not 'Resurrect'. Although death may arise from disease, it is not in itself a disease and hence cannot be cured. So there.";
    if (state.status === "grown") return "That's not diseased.";
    if (!state.crop) return state.weeds ? "The weeds are healthy enough already." : "There's nothing there to cure.";
    if (state.status !== "diseased") return "It's growing just fine.";
    return null;
}
function farmingSpell(event, patch) {
    const key = core.CacheDefinitions.getSpellName(event.spellWidget, event.spellItemId)?.toLowerCase();
    if (!SPELLS[key] || key === "geomancy") return;
    event.handled = true;
    const { player } = event;
    if (!patch) {
        if (key !== "cure plant") { event.handled = false; return; }
        player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
            new core.PlayerDialogue(0, "Umm... this spell won't cure that!")));
        return;
    }
    if (Patches.autoBusy(player)) return;
    Patches.cancelAuto(player, patch);
    Patches.advanceFarm(player);
    const state = Patches.stateFor(player, patch);
    if (key === "cure plant") {
        const refusal = curePlantRefusal(patch, state);
        if (refusal) { player.sendMessage(refusal); return; }
    }
    if (patch.type.includes("COMPOST") || patch.type === "ANIMA") { player.sendMessage("That spell cannot affect this patch."); return; }
    if (key === "fertile soil" && state.status === "grown") {
        player.sendMessage("Composting it isn't going to make it any bigger."); return;
    }
    if (key === "fertile soil" && (state.weeds || state.compost || state.status === "dead" || ["GRAPES", "CORAL"].includes(patch.type))) {
        player.sendMessage("This patch cannot be treated now."); return;
    }
    if (key === "resurrect crops" && (state.status !== "dead" || state.resurrected || ["REDWOOD", "HESPORI"].includes(patch.type))) { player.sendMessage("You cannot resurrect this crop."); return; }
    if (!new FarmingSpell(key, event.spellId).cast(player)) return;
    if (key === "cure plant") {
        if (Patches.cure(player, patch, false)) Patches.award(player, 91.5, patch);
    }
    else if (key === "fertile soil") {
        const ultra = (Patches.farmFor(player).ultraFertile || player.getPacketSender().getVarbit(5960) > 0) && player.getInventory().getAmount(Data.itemId("Volcanic ash")) >= 2;
        if (ultra) player.getInventory().deleteNumber(Data.itemId("Volcanic ash"), 2);
        Patches.fertilize(player, patch, ultra ? 3 : 2, false, 18);
        core.PluginManager.emitCustomEvent("farming:spell-fertilized", { player, patch, spell: key });
    }
    else {
        const level = Math.min(99, player.getSkillManager().getCurrentLevel(core.Skill.MAGIC));
        // OSRS Wiki's integer skilling-success formula: 129/256 at 78, 193/256 at 99.
        const successes = Math.floor(64 * (level - 36) / 21 + 0.5) + 1;
        if (Math.floor(Math.random() * 256) < successes) {
            state.resurrected = true;
            state.status = "growing";
            state.nextAt = Model.nextGrowth(Date.now(), Data.stageMinutes(Data.CROPS.get(state.crop), state.stage), Patches.farmFor(player).offset);
            player.sendMessage("You restore the crop to life.");
        } else { Patches.clearPatch(player, patch); player.sendMessage("The spell fails and clears the dead crop."); }
    }
    Patches.syncPatch(player, patch);
}
function farmingButton(event) {
    const key = core.CacheDefinitions.getSpellName(event.buttonId, -1)?.toLowerCase();
    if (key !== "geomancy") return;
    event.handled = true;
    const action = event.opId ?? event.action;
    if ((action !== undefined && action !== 1) || event.player.busy()) return;
    if (core.CombatFactory.inCombat(event.player)) {
        event.player.sendMessage("You can't commune with the land while fighting.");
        return;
    }
    if (!new FarmingSpell(key, event.buttonId).cast(event.player)) return;
    Geomancy.open(event.player);
}

Object.assign(module.exports, { farmingSpell, farmingButton });
