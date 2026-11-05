import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RELEASE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validIdentity = (commit, id) => /^[a-f0-9]{40}$/.test(commit) && /^\d+-\d+$/.test(id);
const safePath = name => typeof name === 'string' && /^(host|play)\//.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..') && !/[\\\0\r\n]/.test(name);

export function prepareWebDeploy(host, client, output, commit, id) {
    if (!validIdentity(commit, id)) throw Error('Invalid deployment identity');
    if (fs.existsSync(output)) throw Error('Deployment output already exists');
    const files = [];
    const sources = new Map();
    const walk = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const source = path.join(directory, entry.name);
            const name = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) walk(source, name);
            else if (!entry.isFile()) throw Error(`Unsupported artifact entry: ${name}`);
            else if (!name.endsWith('.map') && name !== 'host/browser-host/release.json' && !name.startsWith('play/caches/')) {
                if (!safePath(name)) throw Error('Invalid artifact path');
                const bytes = fs.readFileSync(source);
                if (!bytes.length) throw Error(`Empty artifact: ${name}`);
                files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
                sources.set(name, source);
            }
        }
    };
    walk(host, 'host');
    walk(client, 'play');
    for (const root of ['host', 'play']) if (!sources.has(`${root}/index.html`)) throw Error(`Missing ${root}/index.html`);
    const candidate = JSON.parse(fs.readFileSync(path.join(host, 'browser-host/release-candidate.json')));
    if (!RELEASE.test(candidate.id)) throw Error('Invalid release candidate');
    const byName = new Map(files.map(file => [file.path, file]));
    // Preserve both URL forms without transferring the identical startup files twice.
    for (const name of ['runtime.snapshot.gz', 'definitions.json']) {
        const canonical = byName.get(`host/browser-host/${name}`);
        const alias = byName.get(`host/browser-host/releases/${candidate.id}/${name}`);
        if (!canonical || !alias || alias.sha256 !== canonical.sha256) throw Error(`Release does not match ${name}`);
        alias.source = canonical.path;
    }
    for (const file of files.filter(file => !file.source)) {
        const destination = path.join(output, file.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(sources.get(file.path), destination);
    }
    const manifest = { version: 1, commit, id, releaseId: candidate.id, files };
    fs.writeFileSync(path.join(output, 'deployment.json'), JSON.stringify(manifest));
    console.log(`${files.length} files; ${(files.filter(file => !file.source).reduce((sum, file) => sum + file.bytes, 0) / 1048576).toFixed(1)} MiB before SSH compression; no source maps`);
    return manifest;
}

function regularFile(root, name) {
    let current = root;
    const parts = name.split('/');
    for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw Error(`Unsafe deployment path: ${name}`);
    }
    return current;
}

export function checkWebDeploy(stage, commit, id) {
    if (!validIdentity(commit, id)) throw Error('Invalid deployment identity');
    if (fs.lstatSync(stage).isSymbolicLink()) throw Error('Unsafe deployment directory');
    const metadata = fs.readFileSync(regularFile(stage, 'deployment.json'), 'utf8');
    if (metadata.length > 5_000_000) throw Error('Deployment manifest too large');
    const manifest = JSON.parse(metadata);
    if (manifest.version !== 1 || manifest.commit !== commit || manifest.id !== id || !RELEASE.test(manifest.releaseId)
        || !Array.isArray(manifest.files) || manifest.files.length > 10000) throw Error('Invalid deployment manifest');
    const files = new Map();
    for (const file of manifest.files) {
        if (!safePath(file.path) || files.has(file.path) || file.path.endsWith('.map') || file.path.startsWith('play/caches/')
            || file.path === 'host/browser-host/release.json' || !Number.isSafeInteger(file.bytes) || file.bytes < 1
            || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid deployment file');
        files.set(file.path, file);
    }
    for (const file of files.values()) {
        const source = file.source ? files.get(file.source) : file;
        const allowedAlias = `host/browser-host/releases/${manifest.releaseId}/`;
        if (!source || source.source || (file.source && (!file.path.startsWith(allowedAlias)
            || !['runtime.snapshot.gz', 'definitions.json'].includes(file.path.slice(allowedAlias.length))
            || file.source !== `host/browser-host/${file.path.slice(allowedAlias.length)}`))) throw Error('Invalid release alias');
        const bytes = fs.readFileSync(regularFile(stage, source.path));
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw Error(`Incomplete deployment: ${file.path}`);
    }
    for (const name of ['host/index.html', 'play/index.html', 'host/browser-host/release-candidate.json',
        ...['release.json', 'runtime.snapshot.gz', 'definitions.json'].map(file => `host/browser-host/releases/${manifest.releaseId}/${file}`)]) {
        if (!files.has(name)) throw Error(`Missing ${name}`);
    }
    const candidate = JSON.parse(fs.readFileSync(path.join(stage, 'host/browser-host/release-candidate.json')));
    if (candidate.id !== manifest.releaseId) throw Error('Mismatched release candidate');
    const release = JSON.parse(fs.readFileSync(regularFile(stage, `host/browser-host/releases/${manifest.releaseId}/release.json`)));
    if (release.id !== manifest.releaseId) throw Error('Mismatched release metadata');
    for (const name of ['runtime.snapshot.gz', 'definitions.json']) {
        const file = files.get(`host/browser-host/releases/${manifest.releaseId}/${name}`);
        if (release.files?.[name]?.bytes !== file.bytes || release.files?.[name]?.sha256 !== file.sha256) throw Error(`Invalid release metadata: ${name}`);
    }
    return manifest;
}

function destinationPath(root, name) {
    let directory = root;
    for (const part of name.split('/').slice(0, -1)) {
        directory = path.join(directory, part);
        if (fs.existsSync(directory)) {
            const stat = fs.lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(`Unsafe destination: ${name}`);
        } else {
            const owner = fs.statSync(path.dirname(directory));
            fs.mkdirSync(directory, { mode: 0o755 });
            fs.chownSync(directory, owner.uid, owner.gid);
        }
    }
    const destination = path.join(root, name);
    if (fs.existsSync(destination) && !fs.lstatSync(destination).isFile()) throw Error(`Unsafe destination: ${name}`);
    return destination;
}

export function applyWebDeploy(stage, root, commit, id) {
    const manifest = checkWebDeploy(stage, commit, id);
    const pending = new Map();
    const unchanged = file => {
        const target = destinationPath(root, file.path);
        return fs.existsSync(target) && digest(fs.readFileSync(target)) === file.sha256;
    };
    const temporaryPath = file => {
        const target = destinationPath(root, file.path);
        const temporary = `${target}.uploading-${id}`;
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        pending.set(file.path, { target, temporary });
        return temporary;
    };
    try {
        for (const file of manifest.files.filter(file => !file.source)) {
            if (unchanged(file)) continue;
            const temporary = temporaryPath(file);
            fs.copyFileSync(regularFile(stage, file.path), temporary);
            const copied = fs.readFileSync(temporary);
            if (copied.length !== file.bytes || digest(copied) !== file.sha256) throw Error(`Staged file changed: ${file.path}`);
            fs.chmodSync(temporary, 0o644);
            const owner = fs.statSync(path.dirname(temporary));
            fs.chownSync(temporary, owner.uid, owner.gid);
        }
        for (const file of manifest.files.filter(file => file.source)) {
            if (unchanged(file)) continue;
            const source = pending.get(file.source)?.temporary ?? destinationPath(root, file.source);
            fs.linkSync(source, temporaryPath(file));
        }
        // Verify/stage every file first, then publish the HTML entry points last.
        for (const [name, file] of [...pending].sort(([a], [b]) => Number(a.endsWith('/index.html')) - Number(b.endsWith('/index.html')))) {
            fs.renameSync(file.temporary, file.target);
        }
    } finally {
        for (const file of pending.values()) if (fs.existsSync(file.temporary)) fs.unlinkSync(file.temporary);
    }
    console.log(`Published ${pending.size} changed files; retained existing release files and client caches`);
}

export async function publishWebRelease(stage, root, commit, id, target, fetcher = fetch) {
    const manifest = checkWebDeploy(stage, commit, id);
    for (const file of manifest.files) {
        if (digest(fs.readFileSync(regularFile(root, file.path))) !== file.sha256) throw Error(`Live file mismatch: ${file.path}`);
    }
    const get = (url, extra = {}) => fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(10000), ...extra });
    const cacheBase = 'https://rsps.app/play/caches/';
    const response = await get(cacheBase + 'caches.json');
    if (!response.ok || (await response.json())[0]?.name !== target) throw Error('Public client cache does not match the server');
    for (const file of ['main_file_cache.dat2', 'main_file_cache.idx255']) {
        const response = await get(`${cacheBase}${encodeURIComponent(target)}/${file}`, { headers: { Range: 'bytes=0-0' } });
        if (response.status !== 206 || !/^bytes 0-0\/[1-9]\d*$/.test(response.headers.get('content-range') ?? '')
            || (await response.arrayBuffer()).byteLength !== 1) throw Error(`Public cache check failed: ${file}`);
    }
    const marker = destinationPath(root, 'host/browser-host/release.json');
    const temporary = `${marker}.uploading-${id}`;
    fs.writeFileSync(temporary, JSON.stringify({ id: manifest.releaseId }), { mode: 0o644 });
    const owner = fs.statSync(path.dirname(marker));
    fs.chownSync(temporary, owner.uid, owner.gid);
    fs.renameSync(temporary, marker);
    console.log(`Published hosted-world release ${manifest.releaseId}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'prepare') prepareWebDeploy(...args);
    else if (command === 'check') checkWebDeploy(args[0], args[2], args[3]);
    else if (command === 'apply') applyWebDeploy(...args);
    else if (command === 'publish') await publishWebRelease(...args);
    else throw Error('Usage: web-deploy.mjs <prepare|check|apply|publish> ...');
}
