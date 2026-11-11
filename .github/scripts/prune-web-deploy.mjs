import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';

const day = 86_400_000;
const releaseId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const deployId = /^\d+-\d+$/;
const bundlePath = /^(host|play)\/static\/js\/[\w.-]+\.[a-f0-9]{8,64}(?:\.chunk)?\.js(?:\.map|\.LICENSE\.txt)?$/;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function manifest(file) {
    const data = readJson(file);
    if (!deployId.test(data.id) || !releaseId.test(data.releaseId)) throw Error('Invalid deployment history');
    return { id: data.id, release: data.releaseId, bundles: data.files.map(file => file.path).filter(name => bundlePath.test(name)) };
}

async function recentRequests(logs) {
    const releases = new Set();
    const bundles = new Set();
    for (let rotation = 0; rotation <= 7; rotation++) {
        const name = path.join(logs, rotation < 2 ? ['access.log', 'access.log.1'][rotation] : `access.log.${rotation}.gz`);
        const input = fs.createReadStream(name);
        // Fail closed if traffic history cannot be read, including during log rotation.
        await pipeline(input, ...(rotation < 2 ? [] : [createGunzip()]), async stream => {
            for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
                const request = /"(?:GET|HEAD) \/([^?\s]+)(?:\?[^\s]*)? HTTP\/[^"]+" (?:200|206|304) /.exec(line);
                if (!request) continue;
                const name = request[1];
                const release = /^host\/browser-host\/releases\/([^/]+)\//.exec(name);
                if (rotation <= 2 && release) releases.add(release[1]);
                if (bundlePath.test(name)) bundles.add(name);
            }
        });
    }
    return { releases, bundles };
}

export async function pruneWebDeploy(root, staging, stage, logs, now = Date.now()) {
    const current = manifest(path.join(stage, 'deployment.json'));
    const browserHost = path.join(root, 'host/browser-host');
    const live = readJson(path.join(browserHost, 'release.json')).id;
    const candidate = readJson(path.join(browserHost, 'release-candidate.json')).id;
    if (live !== current.release || candidate !== live) throw Error('Web release is not fully published');

    const retired = path.join(staging, 'retired');
    fs.mkdirSync(retired, { recursive: true, mode: 0o700 });
    const baseline = path.join(staging, 'baseline/deployment.json');
    if (fs.existsSync(baseline)) {
        const previous = manifest(baseline);
        if (previous.id !== current.id) {
            // The grace period starts when a build stops being live, even if it was live for weeks.
            const record = path.join(retired, previous.id + '.json');
            if (!fs.existsSync(record)) {
                fs.copyFileSync(baseline, record + '.tmp');
                fs.renameSync(record + '.tmp', record);
            }
        }
    }

    const { releases, bundles } = await recentRequests(logs);
    const liveBundles = new Set(current.bundles);
    const retainedBundles = new Set([...liveBundles, ...bundles]);
    const requestedReleases = new Set(releases);
    releases.add(live);
    const expired = [];
    for (const entry of fs.readdirSync(retired, { withFileTypes: true })) {
        if (!entry.isFile() || !/^\d+-\d+\.json$/.test(entry.name)) continue;
        const file = path.join(retired, entry.name);
        const build = manifest(file);
        const retiredAt = fs.statSync(file).mtimeMs;
        if (retiredAt >= now - 2 * day) releases.add(build.release);
        if (retiredAt >= now - 7 * day || (build.release !== live && requestedReleases.has(build.release))
            || build.bundles.some(name => bundles.has(name) && !liveBundles.has(name))) {
            for (const name of build.bundles) retainedBundles.add(name);
        } else {
            expired.push(file);
        }
    }

    const removeOlder = (dir, age, matches, directory) => {
        let removed = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if ((directory ? entry.isDirectory() : entry.isFile()) && matches(entry.name) && fs.statSync(file).mtimeMs < now - age * day) {
                fs.rmSync(file, { recursive: directory });
                removed++;
            }
        }
        return removed;
    };
    const snapshots = removeOlder(path.join(browserHost, 'releases'), 2, name => releaseId.test(name) && !releases.has(name), true);
    let oldBundles = 0;
    for (const app of ['host', 'play']) {
        const prefix = `${app}/static/js/`;
        // shortcut: pre-retention builds have no saved manifest, so only their individually requested bundles can be identified.
        oldBundles += removeOlder(path.join(root, prefix), 7, name => bundlePath.test(prefix + name) && !retainedBundles.has(prefix + name), false);
    }
    const uploads = removeOlder(staging, 3, name => deployId.test(name) && name !== current.id, true);
    for (const file of expired) fs.unlinkSync(file);
    console.log(`Pruned ${snapshots} old Host snapshots, ${oldBundles} old JS assets and ${uploads} abandoned deploy uploads`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await pruneWebDeploy(...process.argv.slice(2));
}
