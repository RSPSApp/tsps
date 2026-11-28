import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function main() {
    const dom = new JSDOM('<!doctype html><div id="content"></div>', { url: 'http://localhost:3103', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLAnchorElement: dom.window.HTMLAnchorElement });
    const { EditorObjectSwatches, parseObjectSwatches } = require('../game/plugins/editmode/EditorObjectSwatches');
    const stone = { id: 50, type: 22, name: 'Stone', turn: 3 };
    assert.deepEqual(parseObjectSwatches(JSON.stringify([{ id: 50, type: 22, name: 'Stone' }])), [{ ...stone, turn: 0 }], 'RSPSi records load without a turn field');
    for (const value of [null, {}, [{ ...stone, id: -1 }], [{ ...stone, type: 99 }], [{ ...stone, turn: 4 }], [{ ...stone, name: 7 }]]) assert.throws(() => parseObjectSwatches(JSON.stringify(value)));
    assert.deepEqual(parseObjectSwatches(JSON.stringify([stone, stone])), [stone]);
    const notices: string[] = []; let picked: any;
    const options = { pick: (value: any) => picked = value, selected: () => stone, browse: () => { }, thumbnail: async () => undefined, notify: (value: string) => notices.push(value) };
    const panel = document.querySelector<HTMLElement>('#content')!;
    let swatches = new EditorObjectSwatches(options); swatches.mount(panel);
    (panel.querySelector('[aria-label="Add selected object to swatches"]') as HTMLButtonElement).click();
    assert.equal(panel.querySelectorAll('[data-swatch-key]').length, 2, 'one saved button and its image');
    (panel.querySelector('button[data-swatch-key]') as HTMLButtonElement).click(); assert.deepEqual(picked, stone, 'placement preserves variant and direction');
    swatches.unmount(); swatches = new EditorObjectSwatches(options); swatches.mount(panel);
    assert.equal(panel.querySelectorAll('button[data-swatch-key]').length, 1, 'browser storage restores swatches');
    const fileSaver = require('file-saver'); const original = fileSaver.saveAs; let downloaded: Blob | undefined;
    fileSaver.saveAs = (blob: Blob) => downloaded = blob;
    (panel.querySelector('[aria-label="Save object swatches"]') as HTMLButtonElement).click();
    assert.deepEqual(JSON.parse(await downloaded!.text()), [stone]); fileSaver.saveAs = original;
    const load = async (text: string) => {
        const input = panel.querySelector('input[type="file"]')!;
        Object.defineProperty(input, 'files', { configurable: true, value: [{ size: text.length, text: async () => text }] });
        input.dispatchEvent(new dom.window.Event('change'));
        await new Promise(resolve => setImmediate(resolve));
    };
    await load(JSON.stringify([{ id: 60, type: 0, name: 'Wall', turn: 1 }]));
    assert.equal(panel.querySelectorAll('button[data-swatch-key]').length, 2, 'import keeps existing swatches');
    await load(JSON.stringify([{ id: 70, type: 0, name: 'Valid' }, { id: -1, type: 0, name: 'Invalid' }]));
    assert.equal(panel.querySelectorAll('button[data-swatch-key]').length, 2, 'invalid import changes nothing');
    assert.match(notices.at(-1)!, /Invalid object swatch/);
    (panel.querySelector('button[data-swatch-key]') as HTMLButtonElement).click();
    (panel.querySelector('[aria-label="Remove selected object swatch"]') as HTMLButtonElement).click();
    assert.equal(panel.querySelectorAll('button[data-swatch-key]').length, 1);
    swatches.unmount(); dom.window.close();
}
void main();
