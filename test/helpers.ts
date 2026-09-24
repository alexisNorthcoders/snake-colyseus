import { gameConfig } from "../src/gameConfig";

export const TICK_MS = 1000 / gameConfig.fps;

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const joinOptions = (name: string, head: string) => ({
  name,
  colours: { head, body: head, eyes: "#ffffff" }
});

/**
 * Resolves once a patch has carried `predicate` to the client, rejecting if it
 * never arrives. Driven by patches rather than by a sleep, so a test fails on
 * state that never syncs rather than on a timing guess.
 *
 * Not @colyseus/testing's `waitForNextPatch()`: its client-side override hooks
 * a `Room.patch` method that colyseus.js 0.16 doesn't have, so it never fires.
 */
export const waitForState = (client: any, predicate: () => boolean, what: string) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`client never received ${what}`)),
      TICK_MS * 8
    );
    const settle = () => {
      // `connectTo` can resolve before the initial full state is applied, so
      // the first checks may run against a client with no state at all yet.
      let satisfied = false;
      try {
        satisfied = predicate();
      } catch {
        satisfied = false;
      }
      if (!satisfied) return;
      clearTimeout(timeout);
      client.onStateChange.remove(settle);
      resolve();
    };
    client.onStateChange(settle);
    settle();
  });

/** Every module a file names: `import ... from`, bare `import`, `export ... from`, `require` and dynamic `import()`. */
export const specifiers = (source: string) =>
  [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
