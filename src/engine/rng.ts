/** A random source in [0, 1), shaped like `Math.random`. */
export type Rng = () => number;

/**
 * mulberry32: a tiny seedable generator. The same seed always draws the same
 * sequence, which is what lets a game be replayed from its seed.
 */
export const mulberry32 = (seed: number): Rng => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
