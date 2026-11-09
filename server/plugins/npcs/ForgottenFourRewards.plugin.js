const { validKey, record } = require('./OrderedRewards.NpcDrops');
const STATE_ATTRIBUTE = 'forgotten-four:loot-state';
function snapshot(api, event) {
    if (event.domain !== 'forgotten_four' || !validKey(event.tableId))
        return;
    const saved = event.player?.getAttribute?.(STATE_ATTRIBUTE);
    const all = saved === undefined ? {} : saved;
    if (!record(all))
        throw new Error('Invalid saved Forgotten Four reward state');
    event.state = Object.hasOwn(all, event.tableId) ? all[event.tableId] : {};
    const count = { player: event.player, monster: event.wikiPage, total: 0 };
    api.emitCustomEvent('combat-achievements:count', count);
    if (!Number.isSafeInteger(count.total) || count.total < 0)
        throw new Error('Invalid Forgotten Four kill count');
    event.killCount = count.total;
    event.handled = true;
}
function commit(event) {
    if (event.domain !== 'forgotten_four' || !validKey(event.tableId) || !record(event.state) || typeof event.player?.setAttribute !== 'function')
        return;
    const saved = event.player.getAttribute(STATE_ATTRIBUTE);
    const all = saved === undefined ? {} : saved;
    if (!record(all))
        throw new Error('Invalid saved Forgotten Four reward state');
    event.player.setAttribute(STATE_ATTRIBUTE, { ...all, [event.tableId]: { ...event.state } });
    event.committed = true;
}
module.exports = { name: 'ForgottenFourRewards', description: 'Saves each player\'s Forgotten Four reward state, using combat-achievement kill counts, for the ordered boss drop tables.', members: true, STATE_ATTRIBUTE, register(api) {
        api.persistAttribute(STATE_ATTRIBUTE, {});
        api.onCustomEvent('npc-drops:reward-state', snapshot.bind(null, api));
        api.onCustomEvent('npc-drops:reward-state-commit', commit);
    } };
