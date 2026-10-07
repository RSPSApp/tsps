const MULTIPLIER = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;

/** java.util.Random's nextInt(bound), for a seed: the generator the client's scripts assume. */
export function javaRandom(seed: bigint): (bound: number) => number {
    let state = (seed ^ MULTIPLIER) & MASK;
    const next31 = (): number => {
        state = (state * MULTIPLIER + 0xbn) & MASK;
        return Number(state >> 17n) | 0;
    };
    return (bound: number): number => {
        let r = next31();
        const m = bound - 1;
        if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n) | 0;
        for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = next31());
        return r;
    };
}
