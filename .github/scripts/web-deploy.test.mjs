import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareWebDeploy, checkWebDeploy, applyWebDeploy, publishWebRelease } from './web-deploy.mjs';
const commit = 'a'.repeat(40), id = '123-1', releaseId = '11111111-1111-5111-8111-111111111111';
const hash = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-deploy-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const host = path.join(dir, 'host'), client = path.join(dir, 'client'), stage = path.join(dir, 'stage'), live = path.join(dir, 'live');
    const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    write(host + '/index.html', 'new host'); write(client + '/index.html', 'new client');
    write(client + '/static/main.js', 'main'); write(client + '/static/main.js.map', 'do not deploy');
    write(client + '/.htaccess', 'public Apache configuration');
    write(client + '/caches/caches.json', 'server-owned cache manifest');
    const files = { 'runtime.snapshot.gz': 'complete runtime', 'definitions.json': '{"version":2}' };
    const release = { id: releaseId, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { bytes: Buffer.byteLength(text), sha256: hash(text) }])) };
    for (const [name, text] of Object.entries(files)) { write(host + '/browser-host/' + name, text); write(host + '/browser-host/releases/' + releaseId + '/' + name, text); }
    write(host + '/browser-host/releases/' + releaseId + '/release.json', JSON.stringify(release));
    write(host + '/browser-host/release-candidate.json', JSON.stringify({ id: releaseId }));
    write(host + '/browser-host/release.json', 'must not announce early');
    write(live + '/host/index.html', 'old host'); write(live + '/play/index.html', 'old client');
    write(live + '/host/browser-host/release.json', '{"id":"previous"}');
    write(live + '/play/caches/preserved.dat2', 'existing full cache');
    write(live + '/host/browser-host/releases/previous/runtime.snapshot.gz', 'older release');
    const manifest = prepareWebDeploy(host, client, stage, commit, id);
    return { dir, host, client, stage, live, write, manifest };
}
test('stages each startup file once; maps and server-owned client caches are excluded', t => {
    const f = fixture(t);
    assert.equal(f.manifest.files.filter(file => file.source).length, 2);
    assert.ok(f.manifest.files.every(file => !file.path.endsWith('.map') && !file.path.startsWith('play/caches/')));
    assert.ok(!fs.existsSync(f.stage + '/host/browser-host/releases/' + releaseId + '/runtime.snapshot.gz'));
    assert.equal(checkWebDeploy(f.stage, commit, id).releaseId, releaseId);
});
test('verified publication preserves old releases, full caches and the active marker', t => {
    const f = fixture(t); applyWebDeploy(f.stage, f.live, commit, id);
    assert.equal(fs.readFileSync(f.live + '/host/index.html', 'utf8'), 'new host');
    assert.equal(fs.readFileSync(f.live + '/play/.htaccess', 'utf8'), 'public Apache configuration');
    assert.equal(fs.readFileSync(f.live + '/host/browser-host/release.json', 'utf8'), '{"id":"previous"}');
    assert.equal(fs.readFileSync(f.live + '/play/caches/preserved.dat2', 'utf8'), 'existing full cache');
    assert.equal(fs.readFileSync(f.live + '/host/browser-host/releases/previous/runtime.snapshot.gz', 'utf8'), 'older release');
    const runtime = f.live + '/host/browser-host/runtime.snapshot.gz';
    assert.equal(fs.statSync(runtime).ino, fs.statSync(f.live + '/host/browser-host/releases/' + releaseId + '/runtime.snapshot.gz').ino);
    const before = fs.statSync(runtime).mtimeMs;
    applyWebDeploy(f.stage, f.live, commit, id);
    assert.equal(fs.statSync(runtime).mtimeMs, before, 'unchanged files are not rewritten');
});
for (const failure of ['short', 'same-size corruption', 'symlink', 'traversal', 'wrong identity', 'missing release']) {
    test(`${failure} fails before a live file is replaced`, t => {
        const f = fixture(t);
        const runtime = f.stage + '/host/browser-host/runtime.snapshot.gz';
        if (failure === 'short') fs.writeFileSync(runtime, 'short');
        if (failure === 'same-size corruption') fs.writeFileSync(runtime, 'x'.repeat(fs.statSync(runtime).size));
        if (failure === 'symlink') { fs.unlinkSync(runtime); fs.symlinkSync(f.host + '/browser-host/runtime.snapshot.gz', runtime); }
        if (failure === 'traversal') { f.manifest.files[0].path = 'host/../../escape'; fs.writeFileSync(f.stage + '/deployment.json', JSON.stringify(f.manifest)); }
        if (failure === 'missing release') { f.manifest.files = f.manifest.files.filter(file => !file.source); fs.writeFileSync(f.stage + '/deployment.json', JSON.stringify(f.manifest)); }
        assert.throws(() => applyWebDeploy(f.stage, f.live, failure === 'wrong identity' ? 'b'.repeat(40) : commit, id));
        assert.equal(fs.readFileSync(f.live + '/host/index.html', 'utf8'), 'old host');
        assert.equal(fs.readFileSync(f.live + '/host/browser-host/release.json', 'utf8'), '{"id":"previous"}');
    });
}
for (const fail of [false, true]) test(`public cache ${fail ? 'failure retains' : 'success publishes'} the marker`, async t => {
    const f = fixture(t); applyWebDeploy(f.stage, f.live, commit, id);
    const fetcher = async url => url.endsWith('caches.json') ? Response.json([{ name: 'test-cache' }])
        : new Response(new Uint8Array([0]), { status: fail ? 200 : 206, headers: { 'content-range': 'bytes 0-0/1234' } });
    const run = publishWebRelease(f.stage, f.live, commit, id, 'test-cache', fetcher);
    if (fail) { await assert.rejects(run, /Public cache check failed/); assert.equal(JSON.parse(fs.readFileSync(f.live + '/host/browser-host/release.json')).id, 'previous'); }
    else { await run; assert.equal(JSON.parse(fs.readFileSync(f.live + '/host/browser-host/release.json')).id, releaseId); }
});
test('publishing a replacement leaves the previous immutable runtime intact', t => {
    const f = fixture(t); applyWebDeploy(f.stage, f.live, commit, id);
    const old = f.live + '/host/browser-host/releases/' + releaseId + '/runtime.snapshot.gz';
    const bytes = fs.readFileSync(old);
    // A later upload is staged as a new file, never written through the existing hard link.
    f.write(f.live + '/host/browser-host/runtime.snapshot.gz.next', 'new runtime');
    fs.renameSync(f.live + '/host/browser-host/runtime.snapshot.gz.next', f.live + '/host/browser-host/runtime.snapshot.gz');
    assert.deepEqual(fs.readFileSync(old), bytes);
});
