import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { isGroupMissingError } from "../../rs/cache/js5/GroupMissingError";
import { retryOnMissingGroup } from "../../rs/cache/js5/retryOnMissingGroup";
import { Opcodes } from "../../rs/cs2/Opcodes";
import { type Script as Cs2Script, parseScriptFromBytes } from "../../rs/cs2/Script";

const CHAT_INPUT_SCRIPT_ID = 73;

export type ClientScriptLoaderDeps = {
    getCacheSystem: () => CacheSystem;
};

/**
 * LRU-ish client script cache and on-demand loader from the DAT2 clientScript index.
 */
export class ClientScriptLoader {
    private static readonly CACHE_CAPACITY = 128;
    private readonly cache: Map<number, Cs2Script> = new Map();
    private readonly overrides = new Map<number, Cs2Script>();
    private readonly pendingLoads = new Map<number, Promise<Cs2Script | null>>();

    constructor(private readonly deps: ClientScriptLoaderDeps) {}

    clear(): void {
        this.cache.clear();
        this.overrides.clear();
    }

    setOverride(script: Cs2Script): void {
        if (!Number.isInteger(script.id) || script.id < 0) throw new RangeError("Invalid script override id");
        this.overrides.set(script.id, script);
    }
    removeOverride(scriptId: number): void { this.overrides.delete(scriptId); }
    async getRawBytesWithRetry(scriptId: number): Promise<Int8Array | null> {
        return retryOnMissingGroup(() => {
            const index = this.deps.getCacheSystem().getIndex(IndexType.DAT2.clientScript);
            if (!index.archiveExists(scriptId)) return null;
            return index.getArchive(scriptId)?.getFile(0)?.data?.slice() ?? null;
        }, 20, 250).then(bytes => bytes ?? null);
    }

    private tryLoad(scriptId: number): Cs2Script | null {
        const override = this.overrides.get(scriptId);
        if (override) return override;
        const cached = this.cache.get(scriptId);
        if (cached) {
            this.cache.delete(scriptId);
            this.cache.set(scriptId, cached);
            return cached;
        }

        const scriptIdx = this.deps.getCacheSystem().getIndex(IndexType.DAT2.clientScript);
        const arch = scriptIdx.getArchive(scriptId);
        const file = arch?.getFile(0);
        if (!file?.data) return null;

        const script = parseScriptFromBytes(
            scriptId,
            file.data,
            this.deps.getCacheSystem().decodeProfile,
        );
        this.cacheClientScript(scriptId, script);
        return script;
    }

    load(scriptId: number): Cs2Script | null {
        try {
            return this.tryLoad(scriptId);
        } catch (e) {
            if (!isGroupMissingError(e)) {
                console.warn(`[Cs2Vm] Failed to load script ${scriptId}`, e);
            }
            return null;
        }
    }

    loadWithRetry(scriptId: number): Promise<Cs2Script | null> {
        const pending = this.pendingLoads.get(scriptId);
        if (pending) return pending;

        const promise = retryOnMissingGroup(() => this.tryLoad(scriptId), 20, 250)
            .then((script) => script ?? null)
            .catch((e) => {
                console.warn(`[Cs2Vm] Failed to load script ${scriptId}`, e);
                return null;
            })
            .finally(() => this.pendingLoads.delete(scriptId));
        this.pendingLoads.set(scriptId, promise);
        return promise;
    }

    loadIfExists(scriptId: number): Cs2Script | null {
        const override = this.overrides.get(scriptId);
        if (override) return override;
        const cached = this.cache.get(scriptId);
        if (cached) {
            this.cache.delete(scriptId);
            this.cache.set(scriptId, cached);
            return cached;
        }

        try {
            const scriptIdx = this.deps.getCacheSystem().getIndex(IndexType.DAT2.clientScript);
            if (!scriptIdx.archiveExists(scriptId | 0)) return null;
            const arch = scriptIdx.getArchive(scriptId | 0);
            const file = arch?.getFile(0);
            if (!file?.data) return null;
            const script = parseScriptFromBytes(
                scriptId | 0,
                file.data,
                this.deps.getCacheSystem().decodeProfile,
            );
            this.cacheClientScript(scriptId | 0, script);
            return script;
        } catch {
            return null;
        }
    }

    private cacheClientScript(scriptId: number, script: Cs2Script): void {
        if (scriptId === CHAT_INPUT_SCRIPT_ID) {
            const bankCheck = script.stringOperands.indexOf("::bank");
            if (bankCheck >= 0 && script.instructions[bankCheck + 4] === Opcodes.IF_ICMPEQ) {
                // Skip the cache's bank easter egg so DOCHEAT reaches the server command.
                script.intOperands[bankCheck + 4] = 0;
            }
        }
        if (this.cache.has(scriptId)) {
            this.cache.delete(scriptId);
        }
        this.cache.set(scriptId, script);

        if (this.cache.size > ClientScriptLoader.CACHE_CAPACITY) {
            const oldestKey = this.cache.keys().next().value as number | undefined;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
    }
}
