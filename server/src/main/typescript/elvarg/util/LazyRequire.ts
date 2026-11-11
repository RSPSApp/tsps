/**
 * Wraps a lazy `require()` (used to break an import cycle) so it resolves once.
 *
 * Node only fills its per-caller fast path for a relative `require()` when that call is the one
 * that first loads the module. A lazy getter always runs after the module was loaded elsewhere,
 * so without caching every call does a full resolve, `package.json` stat included: about 3.4 µs
 * instead of about 0.2 µs. In hot checks such as `Mobile.isNpc()` that was ~30% of tick CPU.
 *
 * A `require()` made while the target is still loading (mid-cycle) can return `undefined`, so
 * the result is only cached once it is defined.
 */
export function lazyRequire<T>(load: () => T): () => T {
    let cached: T | undefined;
    return () => {
        if (cached !== undefined) {
            return cached;
        }
        const value = load();
        if (value !== undefined) {
            cached = value;
        }
        return value;
    };
}
