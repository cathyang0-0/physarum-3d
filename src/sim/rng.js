// Seeded pseudo-random number generator (mulberry32).
// Every random choice in the simulation goes through one of these, so a run is fully
// reproducible from `seed` + parameters + the list of food sources.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
  };
}

// In-place Fisher–Yates shuffle of the first n entries of a typed array, using the given rng.
export function shuffle(arr, rand, n = arr.length) {
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}
