import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { pruneWebDeploy } from './prune-web-deploy.mjs';

test('post-publish cleanup keeps live, recent and requested builds', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-web-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const root = path.join(dir, 'live'), staging = path.join(dir, 'staging');
    const stage = path.join(staging, '5-1'), logs = path.join(dir, 'logs');
    const browserHost = path.join(root, 'host/browser-host');
    const ids = ['1', '2', '3', '4', '5'].map(n => n.repeat(8) + '-1111-5111-8111-111111111111');
    const now = Date.now(), old = (now - 10 * 86_400_000) / 1000;
    const write = (file, data, age = old) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, data);
        fs.utimesSync(file, age, age);
    };
    const record = (file, id, releaseId, names) => write(file, JSON.stringify({ id, releaseId, files: names.map(path => ({ path })) }));
    const snapshot = id => path.join(browserHost, 'releases', id);
    for (const id of ids) {
        write(path.join(snapshot(id), 'runtime.snapshot.gz'), 'runtime');
        if (id !== ids[3]) fs.utimesSync(snapshot(id), old, old);
    }
    const [active, requested, lazy, orphan, previous] = ['a', 'b', 'c', 'd', 'e'].map(n => `play/static/js/main.${n.repeat(8)}.js`);
    write(path.join(root, 'host/static/js/keep.txt'), 'unmanaged');
    for (const name of [active, requested, lazy, orphan, previous]) write(path.join(root, name), 'bundle');
    record(path.join(stage, 'deployment.json'), '5-1', ids[4], [active]);
    record(path.join(staging, 'retired/2-1.json'), '2-1', ids[1], [requested, lazy]);
    record(path.join(staging, 'retired/3-1.json'), '3-1', ids[2], [orphan]);
    record(path.join(staging, 'baseline/deployment.json'), '1-1', ids[0], [previous]);
    fs.utimesSync(stage, old, old);
    write(path.join(staging, '9-1/deployment.json'), 'abandoned');
    fs.utimesSync(path.join(staging, '9-1'), old, old);
    write(path.join(staging, '10-1/deployment.json'), 'uploading');
    write(path.join(browserHost, 'release-candidate.json'), JSON.stringify({ id: ids[4] }));
    write(path.join(browserHost, 'release.json'), JSON.stringify({ id: ids[0] }));
    await assert.rejects(pruneWebDeploy(root, staging, stage, logs, now), /not fully published/);

    write(path.join(browserHost, 'release.json'), JSON.stringify({ id: ids[4] }));
    for (let rotation = 0; rotation <= 7; rotation++) {
        const traffic = `1 - - [today] "GET /${requested}?v=1 HTTP/2.0" 304 0\n`
            + `1 - - [today] "GET /host/browser-host/releases/${ids[1]}/runtime.snapshot.gz HTTP/2.0" 206 1\n`;
        if (rotation < 2) write(path.join(logs, rotation ? 'access.log.1' : 'access.log'), '');
        else write(path.join(logs, `access.log.${rotation}.gz`), rotation === 7 ? 'invalid gzip' : gzipSync(rotation === 2 ? traffic : ''));
    }
    await assert.rejects(pruneWebDeploy(root, staging, stage, logs, now));
    assert.ok(fs.existsSync(path.join(root, orphan)));
    write(path.join(logs, 'access.log.7.gz'), gzipSync(''));
    await pruneWebDeploy(root, staging, stage, logs, now);
    for (const id of [ids[0], ids[1], ids[3], ids[4]]) assert.ok(fs.existsSync(snapshot(id)));
    assert.ok(!fs.existsSync(snapshot(ids[2])));
    for (const name of [active, requested, lazy, previous]) assert.ok(fs.existsSync(path.join(root, name)));
    assert.ok(!fs.existsSync(path.join(root, orphan)));
    assert.ok(fs.existsSync(path.join(stage, 'deployment.json')));
    assert.ok(!fs.existsSync(path.join(staging, '9-1')));
    assert.ok(fs.existsSync(path.join(staging, '10-1')));
    assert.ok(!fs.existsSync(path.join(staging, 'retired/3-1.json')));
});
