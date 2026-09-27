import assert from "assert";

import { RULES_VERSION } from "../src/engine";
import {
  BotView,
  RosterSource,
  deciderFor,
  dummyBrain,
  loadRoster,
  pickBot,
  roster,
  rosterListing,
  rosterSources,
  rookie
} from "../src/bots";

const view = (): BotView => ({
  grid: { width: 20, height: 20 },
  mode: "timed",
  ticksLeft: 100,
  tickLimit: 100,
  self: { head: { x: 5, y: 5 }, body: [{ x: 6, y: 5 }, { x: 5, y: 4 }], movedDirection: { x: 1, y: 0 }, score: 0, hunger: 0 },
  others: [],
  food: [{ x: 5, y: 9, type: "apple", score: 10 }]
});

/** A logger that remembers what it was told. */
const recorder = () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  return { errors, warnings, log: { error: (...args: unknown[]) => errors.push(args.join(" ")), warn: (...args: unknown[]) => warnings.push(args.join(" ")) } };
};

const dummySource = rosterSources.find((s) => s.id === "dummy")!;

describe("the roster", () => {
  it("has the rookie and Dummy, with their metadata", () => {
    const rookieEntry = roster.find((e) => e.id === "rookie")!;
    assert.deepStrictEqual(
      { ...rookieEntry, decider: undefined },
      { id: "rookie", name: "Rookie", generation: 0, method: "scripted", kind: "scripted", decider: undefined }
    );
    const dummy = roster.find((e) => e.id === "dummy")!;
    assert.strictEqual(dummy.kind, "brain");
    assert.strictEqual(dummy.name, "Dummy");
    assert.strictEqual(dummy.method, "hand-made");
    assert.strictEqual(dummy.generation, 0);
    assert.strictEqual(dummy.personality, undefined);
    if (dummy.kind !== "brain") return;
    assert.strictEqual(dummy.brain, dummyBrain);
    assert.strictEqual(dummy.encoderVersion, dummyBrain.encoderVersion);
    assert.strictEqual(dummy.rulesVersion, dummyBrain.rulesVersion);
  });

  it("has unique ids", () => {
    const ids = roster.map((e) => e.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  it("loads the committed roster without a word", () => {
    const { errors, warnings, log } = recorder();
    const loaded = loadRoster(rosterSources, log);
    assert.deepStrictEqual(loaded.map((e) => e.id), ["rookie", "dummy"]);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warnings, []);
  });

  it("skips a broken brain with an error, and still loads the others", () => {
    const { errors, warnings, log } = recorder();
    const broken: RosterSource = { ...dummySource, id: "broken", name: "Broken", brain: { ...dummyBrain, sizes: [23, 3] } };
    const loaded = loadRoster([broken, dummySource], log);
    assert.deepStrictEqual(loaded.map((e) => e.id), ["rookie", "dummy"]);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /broken/);
    assert.deepStrictEqual(warnings, []);
  });

  it("skips a brain that isn't even an object", () => {
    const { errors, log } = recorder();
    const loaded = loadRoster([{ ...dummySource, id: "nothing", brain: null }], log);
    assert.deepStrictEqual(loaded.map((e) => e.id), ["rookie"]);
    assert.strictEqual(errors.length, 1);
  });

  it("loads a brain made under other rules, with a warning", () => {
    const { errors, warnings, log } = recorder();
    const old: RosterSource = { ...dummySource, id: "old", brain: { ...dummyBrain, rulesVersion: RULES_VERSION - 1 } };
    const loaded = loadRoster([old], log);
    assert.deepStrictEqual(loaded.map((e) => e.id), ["rookie", "old"]);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /old/);
    const entry = loaded[1];
    assert.ok(entry.kind === "brain" && entry.rulesVersion === RULES_VERSION - 1);
  });

  it("skips an entry whose id is already taken", () => {
    const { errors, log } = recorder();
    const loaded = loadRoster([dummySource, { ...dummySource, name: "Other" }, { ...dummySource, id: "rookie" }], log);
    assert.deepStrictEqual(loaded.map((e) => e.name), ["Rookie", "Dummy"]);
    assert.strictEqual(errors.length, 2);
  });

  it("always has the rookie, first", () => {
    assert.deepStrictEqual(loadRoster([], recorder().log).map((e) => e.id), ["rookie"]);
    assert.strictEqual(roster[0].id, "rookie");
  });

  describe("picking a bot", () => {
    it("finds an entry by id", () => {
      assert.strictEqual(pickBot("dummy").id, "dummy");
      assert.strictEqual(pickBot("rookie").id, "rookie");
    });

    it("falls back to the rookie for a missing, unknown or skipped id", () => {
      [undefined, "nobody", "", 7, {}, "toString"].forEach((id) => assert.strictEqual(pickBot(id).id, "rookie"));
      const loaded = loadRoster([{ ...dummySource, brain: {} }], recorder().log);
      assert.strictEqual(pickBot("dummy", loaded).id, "rookie");
    });
  });

  describe("a decider for any entry", () => {
    it("plays the rookie as the rookie", () => {
      assert.strictEqual(deciderFor(pickBot("rookie"))(view()), rookie(view()));
    });

    it("plays a brain through its weights", () => {
      // Dummy turns away from the body ahead and above it, towards the pellet below.
      assert.strictEqual(deciderFor(pickBot("dummy"))(view()), "d");
    });

    it("works for every entry", () => {
      roster.forEach((entry) => assert.ok(["u", "d", "l", "r"].includes(deciderFor(entry)(view()))));
    });
  });

  describe("its listing", () => {
    it("has every entry's metadata, and no weights or code", () => {
      const listing = rosterListing(roster);
      assert.deepStrictEqual(listing, [
        { id: "rookie", name: "Rookie", generation: 0, method: "scripted", kind: "scripted" },
        { id: "dummy", name: "Dummy", generation: 0, method: "hand-made", kind: "brain", encoderVersion: 1, rulesVersion: RULES_VERSION }
      ]);
      // It survives JSON as it is.
      assert.deepStrictEqual(JSON.parse(JSON.stringify(listing)), listing);
    });
  });
});
