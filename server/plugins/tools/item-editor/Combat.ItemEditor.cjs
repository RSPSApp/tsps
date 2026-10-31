// Read-only inspection: use the game's resolver without constructing a player.
const fs = require('node:fs');
const path = require('node:path');
function createCombatReader(core, root) {
    const definitions = JSON.parse(fs.readFileSync(path.join(root, 'server/data/definitions/item-combat-styles.json'), 'utf8'));
    let specialSources;
    function specialAnimations(special) {
        if (!specialSources) {
            specialSources = new Map();
            const directory = path.join(root, 'server/plugins/combat/specials');
            for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.js'))) {
                const source = fs.readFileSync(path.join(directory, file), 'utf8');
                // Only report literal IDs. Never run a combat method or guess dynamic IDs.
                const id = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
                if (id)
                    specialSources.set(id, [...new Set([...source.matchAll(/new Animation\(\s*(\d+)\s*[,)]/g)].map(match => Number(match[1])))]);
            }
        }
        return specialSources.get(special.getId()) ?? [];
    }
    return function read(id) {
        const def = core.ItemDefinition.forId(id);
        const obj = core.CacheDefinitions.getItem(id);
        if (def.getEquipmentType().getSlot() !== 3 || def.isNoted() || obj.noteTemplate >= 0 || obj.placeholderTemplate >= 0)
            return { weapon: false };
        const weapon = def.getWeaponInterface();
        const weaponData = definitions.weaponInterfaces[weapon.getName()];
        if (!weaponData)
            throw Error('Combat styles are unavailable for this weapon');
        const styles = weapon.getFightType().map((fight, index) => {
            const data = definitions.fightTypes[weaponData.fightTypes[index]];
            const type = data.attackType === 'RANGE' ? core.CombatType.RANGED : data.attackType === 'MAGIC' ? core.CombatType.MAGIC : core.CombatType.MELEE;
            const player = { getEquipment: () => ({ getItems: () => ({ 3: { getId: () => id, getDefinition: () => def } }) }), getWeapon: () => weapon, getFightType: () => fight };
            return { name: data.name, stance: data.style, attackType: data.attackType, rapid: data.rapid === true,
                animation: core.WeaponProfiles.attackAnimation(player, fight.getAnimationAgainst(false), false),
                npcAnimation: core.WeaponProfiles.attackAnimation(player, fight.getAnimationAgainst(true), true),
                xp: type === core.CombatType.MAGIC ? (data.style === 'DEFENSIVE' ? ['Magic', 'Defence'] : ['Magic'])
                    : fight.getStyle().skill(type).map(index => core.Skill.values()[index].getName()) };
        });
        const special = core.CombatSpecial.getForWeaponId(id);
        return { weapon: true, category: weapon.getName(), idle: def.getStandAnim(), walk: def.getWalkAnim(), run: def.getRunAnim(), block: def.getBlockAnim(), styles,
            special: special ? { name: special.getId(), energy: special.getDrainAmountForWeaponId(id), animations: specialAnimations(special) } : null };
    };
}
module.exports = { createCombatReader };
