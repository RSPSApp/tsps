import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
const panel = path.resolve(__dirname, '../../server/plugins/tools/worldadmin/panel');

test('Ghost plugins group first without moving files; plugin shortcuts render as safe local links', async t => {
    const dom = new JSDOM(fs.readFileSync(path.join(panel, 'page.html'), 'utf8').replace(/<style>[\s\S]*?<\/style>/g, ''), { url: 'http://localhost:49601/?view=plugins', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window as any;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.setTimeout = () => 1; w.setInterval = () => 1;
    const plugin = (name: string, file: string, category?: string) => ({ name, file, area: file.split('/')[0], category, enabled: true, loaded: true, defaultEnabled: true, dependsOn: [] });
    const data = { catalog: { plugins: [plugin('Native', 'accounts/Native.plugin.js'), plugin('Creator', 'tools/ContentBuilders.plugin.js', '@ Ghost Plugins @'), plugin('MonsterExamine', 'interface/MonsterExamine.plugin.js', '@ Ghost Plugins @'), plugin('AdminPanel', 'tools/AdminPanel.plugin.js', '@ Ghost Plugins @')], options: [], world: [], membersWorld: true }, layers: { localHash: 'test' }, mode: 'dev', serverStatus: 'online', onlinePlayers: 0, playerCount: 0, botCount: 0,
        cacheEditorUrl: 'http://localhost:3101/?cache=1', mapEditorUrl: 'http://localhost:3101/?edit=1', toolLinks: [
            { id: 'npc-editor', label: 'NPC editor', url: 'http://localhost:3101/?cache=1&tool=content-builders&tool-view=npc' },
            { id: 'gear-editor', label: 'Gear editor', url: 'http://localhost:3101/?cache=1&tool=content-builders&tool-view=gear' },
            { id: 'unsafe', label: 'Unsafe', url: 'https://evil.example/?cache=1' },
        ] };
    w.fetch = async (url: string) => ({ ok: true, status: 200, text: async () => JSON.stringify(String(url).includes('/api/catalog') ? data : { players: [], bots: [] }) });
    for (const name of ['panel.js']) w.eval(fs.readFileSync(path.join(panel, name), 'utf8'));
    const script = [...w.document.querySelectorAll('script')].find((s: any) => !s.src);
    w.eval(script.textContent);
    await new Promise(resolve => setImmediate(resolve));
    const links = [...w.document.querySelectorAll('#plugin-tool-links a')] as HTMLAnchorElement[];
    assert.deepEqual(links.map(a => a.textContent), ['NPC editor', 'Gear editor']);
    assert.equal(new URL(links[1].href).searchParams.get('tool-view'), 'gear');
    assert.ok(links.every(a => a.target === '_blank' && a.rel.includes('noopener')));
    const groups = [...w.document.querySelectorAll('#panel-plugins details')].filter((d: any) => d.querySelector(':scope > summary')?.textContent.includes('plugin')) as HTMLElement[];
    assert.ok(groups.length >= 2, w.document.getElementById('panel-plugins').textContent);
    assert.match(groups[0].querySelector('summary')!.textContent!, /^@ Ghost Plugins @/);
    for (const name of ['Creator', 'MonsterExamine', 'AdminPanel']) assert.ok(groups[0].textContent!.includes(name));
    assert.equal(data.catalog.plugins[1].file, 'tools/ContentBuilders.plugin.js', 'category never rewrites the source path');
    const search = w.document.getElementById('search');
    search.value = '@ Ghost';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(groups[0].hidden, false, 'readable host grouping stays searchable with the upstream bundle');
    assert.equal(groups[1].hidden, true, 'empty category groups hide after search');

});
