import JavaRandom from "java-random";

export const clamp = (num: number, min: number, max: number) => Math.min(Math.max(num, min), max);

export const lerp = (start: number, end: number, progress: number) => {
    if (progress <= 0) {
        return start;
    } else if (progress >= 1) {
        return end;
    }
    return start + (end - start) * progress;
};

/**
 * Interpolates along the shortest displacement around a circular range.
 * The result is unwrapped: slerp(10, 2, 0.5, 10) returns 11, equivalent to 1 modulo 10.
 * Progress <= 0 returns the original start; progress >= 1 returns the original end.
 */
export const slerp = (start: number, end: number, progress: number, range: number) => {
    if (progress <= 0) {
        return start;
    } else if (progress >= 1) {
        return end;
    }
    const shortest_distance = ((((end - start) % range) + range * 1.5) % range) - range / 2;
    const movement = shortest_distance * progress;
    return start + movement;
};

export function isPowerOfTwo(n: number) {
    return n === (-n & n);
}

export function nextPow2(i: number): number {
    i = --i | (i >>> 1);
    i |= i >>> 2;
    i |= i >>> 4;
    i |= i >>> 8;
    i |= i >>> 16;
    return i + 1;
}

export function toSigned16bit(n: number) {
    return (n << 16) >> 16;
}

export function nextIntJagex(random: JavaRandom, bound: number): number {
    if (bound <= 0) {
        throw new Error("bound must be positive");
    }
    if (isPowerOfTwo(bound)) {
        return Number((BigInt(bound) * (BigInt(random.nextInt()) & 0xffffffffn)) >> 32n);
    }
    const maxValue = (-0x80000000 - ((0x100000000 % bound) | 0)) | 0;
    let rndValue: number;
    do {
        rndValue = random.nextInt();
    } while (rndValue >= maxValue);
    return boundJagex(rndValue, bound);
}

function boundJagex(value: number, bound: number): number {
    const i_78_ = (value >> 31) & (bound - 1);
    return i_78_ + ((value + (value >>> 31)) % bound);
}
