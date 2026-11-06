/*
 * Copyright (c) 2026, Walter Rezende
 * All rights reserved.
 *
 * Ported to TypeScript from OSRS Translate PT-BR (RemoteTranslationService). The dictionaries are
 * downloaded from the author's repository at run time; none are shipped with this client.
 * BSD 2-Clause License, see ./LICENSE.
 */
import { REQUIRED_FILES, type DictionaryData, type DictionaryFile } from "./TranslationState";

/**
 * The author's manifest on GitHub's raw host. The plugin hub version reads it through
 * api.github.com, which allows 60 unauthenticated requests an hour per address; the raw host has
 * no such limit and sends the CORS and CORP headers a cross-origin-isolated page needs.
 */
export const DEFAULT_MANIFEST_URL =
    "https://raw.githubusercontent.com/walterrezende12-tech/osrs-translate-translations/main/manifest.json";

/** Cache API store for downloaded files. Not `osrs-typescript::cache::*`: pruneCacheStorage deletes those. */
export const CACHE_NAME = "osrs-translate::v1";
/** Where the last activated release of a language is remembered, for starting offline. */
const ACTIVE_KEY_PREFIX = "https://osrs-translate.invalid/active/";

const SUPPORTED_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MANIFEST_TIMEOUT_MS = 10_000;
const FILE_TIMEOUT_MS = 180_000;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const SHA_256 = /^[a-fA-F0-9]{64}$/;

export interface RemoteFile {
    readonly name: DictionaryFile;
    readonly url: string;
    readonly sha256: string;
}

export interface LanguageRelease {
    readonly language: string;
    readonly version: string;
    readonly files: readonly RemoteFile[];
}

export interface LoadedRelease {
    /** Version plus a hash of the file hashes, as upstream's release directory name. */
    readonly id: string;
    readonly version: string;
    readonly data: DictionaryData;
}

/** What loading touches outside the page; tests replace it. */
export interface FetchDeps {
    fetch: typeof fetch;
    caches?: CacheStorage;
    subtle: SubtleCrypto;
}

export class TranslationLoadError extends Error {}

function fail(message: string): never {
    throw new TranslationLoadError(message);
}

function requireHttps(value: unknown, base: string, label: string): string {
    if (typeof value !== "string" || !value.trim()) fail(`missing URL for ${label}`);
    let url: URL;
    try {
        url = new URL(value.trim(), base);
    } catch {
        fail(`invalid URL for ${label}`);
    }
    if (url.protocol !== "https:") fail(`only HTTPS is allowed for ${label}`);
    return url.toString();
}

/** RemoteTranslationService.validateManifest and validateFileEntry, for one language folder. */
export function parseManifest(json: unknown, language: string, manifestUrl: string): LanguageRelease {
    if (!SAFE_NAME.test(language)) fail(`invalid language ${language}`);
    const manifest = json as { schemaVersion?: unknown; version?: unknown; languages?: Record<string, unknown> };
    if (!manifest || typeof manifest !== "object") fail("empty manifest");
    if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) fail(`unsupported schema version ${String(manifest.schemaVersion)}`);
    if (typeof manifest.version !== "string" || !manifest.version.trim()) fail("manifest has no version");
    if (!manifest.languages || typeof manifest.languages !== "object") fail("manifest has no languages");
    const entry = manifest.languages[language] as { files?: Record<string, { url?: unknown; sha256?: unknown }> } | undefined;
    if (!entry?.files || typeof entry.files !== "object") fail(`language not in manifest: ${language}`);
    const files = REQUIRED_FILES.map((name): RemoteFile => {
        const file = entry.files![name];
        if (!file) fail(`missing URL for ${name}`);
        const url = requireHttps(file.url, manifestUrl, name);
        if (typeof file.sha256 !== "string" || !SHA_256.test(file.sha256)) fail(`invalid SHA-256 for ${name}`);
        return { name, url, sha256: file.sha256.toLowerCase() };
    });
    return { language, version: manifest.version.trim(), files };
}

function toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array, subtle: SubtleCrypto): Promise<string> {
    return toHex(await subtle.digest("SHA-256", data as BufferSource));
}

/** RemoteTranslationService.buildReleaseId: the version plus 12 hex of the files' hashes. */
export async function releaseId(release: LanguageRelease, subtle: SubtleCrypto): Promise<string> {
    const text = release.files.map((file) => file.name + file.sha256).join("");
    const hash = await sha256Hex(new TextEncoder().encode(text), subtle);
    const safeVersion = release.version.replace(/[^A-Za-z0-9._-]/g, "_") || "release";
    return `${safeVersion}-${hash.slice(0, 12)}`;
}

/** TranslationLookupHelper.parseJsonMapStrict: an object whose every value is a string. */
export function parseDictionary(bytes: ArrayBuffer, name: string): Record<string, string> {
    let json: unknown;
    try {
        json = JSON.parse(new TextDecoder("utf-8").decode(bytes));
    } catch {
        fail(`invalid translation JSON: ${name}`);
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) fail(`the root of ${name} must be an object`);
    const map = json as Record<string, unknown>;
    for (const key in map) {
        if (typeof map[key] !== "string") fail(`invalid translation for key ${JSON.stringify(key)} in ${name}`);
    }
    return map as Record<string, string>;
}

async function readLimited(response: Response, limit: number, label: string): Promise<ArrayBuffer> {
    if (!response.ok) fail(`HTTP ${response.status} downloading ${label}`);
    const length = Number(response.headers.get("content-length") ?? "");
    // A gzip-encoded body reports its compressed length; the decoded size is checked below.
    if (Number.isFinite(length) && length > limit && !response.headers.get("content-encoding")) fail(`${label} is too large`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > limit) fail(`${label} is too large`);
    return bytes;
}

async function openCache(deps: FetchDeps): Promise<Cache | undefined> {
    try {
        return await deps.caches?.open(CACHE_NAME);
    } catch {
        return undefined;
    }
}

export async function fetchManifest(manifestUrl: string, deps: FetchDeps): Promise<unknown> {
    const url = requireHttps(manifestUrl, manifestUrl, "manifest");
    const response = await deps.fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
    const bytes = await readLimited(response, MAX_MANIFEST_BYTES, "manifest");
    try {
        return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    } catch {
        fail("invalid manifest JSON");
    }
}

/**
 * Every file of a release, verified against the manifest's SHA-256: from the Cache API when it
 * already holds the pinned URL, otherwise downloaded and stored there. A mismatch fails the whole
 * release, so the caller keeps the one it has. Files of other releases are removed afterwards.
 */
export async function loadReleaseFiles(
    release: LanguageRelease,
    deps: FetchDeps,
): Promise<Partial<Record<DictionaryFile, Record<string, string>>>> {
    const cache = await openCache(deps);
    const out: Partial<Record<DictionaryFile, Record<string, string>>> = {};
    for (const file of release.files) {
        let bytes: ArrayBuffer | undefined;
        try {
            const cached = await cache?.match(file.url);
            if (cached) {
                const candidate = await cached.arrayBuffer();
                if ((await sha256Hex(candidate, deps.subtle)) === file.sha256) bytes = candidate;
            }
        } catch {
            bytes = undefined;
        }
        if (!bytes) {
            const response = await deps.fetch(file.url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
            bytes = await readLimited(response, MAX_FILE_BYTES, file.name);
            if ((await sha256Hex(bytes, deps.subtle)) !== file.sha256) fail(`SHA-256 mismatch for ${file.name}`);
            try {
                await cache?.put(file.url, new Response(bytes, { headers: { "content-type": "application/json" } }));
            } catch {
                // Out of quota or storage blocked: the release still works for this session.
            }
        }
        out[file.name] = parseDictionary(bytes, file.name);
    }
    try {
        await cache?.put(ACTIVE_KEY_PREFIX + release.language, new Response(JSON.stringify(release)));
        // Drop this language's files from older releases; other languages keep theirs.
        const keep = new Set(release.files.map((file) => file.url));
        for (const request of (await cache?.keys()) ?? []) {
            const url = request.url;
            if (!url.startsWith(ACTIVE_KEY_PREFIX) && !keep.has(url) && url.includes(`/${release.language}/`)) {
                await cache?.delete(request);
            }
        }
    } catch {
        // Cleaning up is best effort; the loaded release is already valid.
    }
    return out;
}

/** The release last activated for `language`, to start from the cache when GitHub can't be reached. */
export async function readActiveRelease(language: string, deps: FetchDeps): Promise<LanguageRelease | undefined> {
    try {
        const response = await (await openCache(deps))?.match(ACTIVE_KEY_PREFIX + language);
        if (!response) return undefined;
        const release = JSON.parse(await response.text()) as LanguageRelease;
        return release.language === language && Array.isArray(release.files) ? release : undefined;
    } catch {
        return undefined;
    }
}

function toMaps(raw: Partial<Record<DictionaryFile, Record<string, string>>>): DictionaryData {
    const data: Partial<Record<DictionaryFile, ReadonlyMap<string, string>>> = {};
    for (const name of REQUIRED_FILES) {
        const object = raw[name];
        if (object) data[name] = new Map(Object.entries(object));
    }
    return data;
}

export type LoadFiles = (release: LanguageRelease) => Promise<Partial<Record<DictionaryFile, Record<string, string>>>>;

function defaultDeps(): FetchDeps {
    return {
        fetch: (...args) => fetch(...args),
        caches: typeof caches === "undefined" ? undefined : caches,
        subtle: globalThis.crypto.subtle,
    };
}

/**
 * Loads one language's dictionaries. Downloading, hashing and parsing about 25 MB run in a Web
 * Worker so the game keeps drawing; without workers they run here.
 */
export class TranslationRepository {
    private readonly deps: FetchDeps;
    private readonly loadFiles: LoadFiles;

    constructor(options: { deps?: FetchDeps; loadFiles?: LoadFiles } = {}) {
        this.deps = options.deps ?? defaultDeps();
        this.loadFiles = options.loadFiles ?? ((release) => loadReleaseFiles(release, this.deps));
    }

    /**
     * The current release of `language`, or null when it is `currentId` already. When the manifest
     * can't be read, the last activated release is loaded from the cache instead (once: a
     * `currentId` means it is already loaded).
     */
    async update(manifestUrl: string, language: string, currentId?: string): Promise<LoadedRelease | null> {
        let release: LanguageRelease;
        try {
            release = parseManifest(await fetchManifest(manifestUrl, this.deps), language, manifestUrl);
        } catch (error) {
            const cached = currentId ? undefined : await readActiveRelease(language, this.deps);
            if (!cached) throw error;
            release = cached;
        }
        const id = await releaseId(release, this.deps.subtle);
        if (id === currentId) return null;
        const raw = await this.loadFiles(release);
        return { id, version: release.version, data: toMaps(raw) };
    }
}
