import assert from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { RULES_VERSION } from "../src/engine";
import {
  BotView,
  deciderFor,
  dummyBrain,
  loadRoster,
  pickBot,
  roster,
  rosterListing,
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

const dummyEntry = { id: "dummy", name: "Dummy", generation: 0, method: "hand-made", brain: "dummy.json" };

/**
 * A roster written to a scratch folder, as JSON files alone: each entry as
 * `entries/<file>`, each brain as `brains/<file>`. A string is written as it
 * is, anything else as JSON.
 */
const scratch: string[] = [];
const scratchRoster = (entries: Record<string, unknown>, brains: Record<string, unknown> = { "dummy.json": dummyBrain }) => {
  const dir = mkdtempSync(join(tmpdir(), "snake-roster-"));
  scratch.push(dir);
  Object.entries({ entries, brains }).forEach(([folder, files]) => {
    mkdirSync(join(dir, folder));
    Object.entries(files).forEach(([file, value]) =>
      writeFileSync(join(dir, folder, file), typeof value === "string" ? value : JSON.stringify(value))
    );
  });
  return dir;
};

/** Loads a scratch roster, and says what it logged. */
const load = (entries: Record<string, unknown>, brains?: Record<string, unknown>) => {
  const { errors, warnings, log } = recorder();
  const loaded = loadRoster(scratchRoster(entries, brains), log);
  return { ids: loaded.map((e) => e.id), loaded, errors, warnings };
};

describe("the roster", () => {
  after(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

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
    assert.deepStrictEqual(dummy.brain, dummyBrain);
    assert.strictEqual(dummy.encoderVersion, dummyBrain.encoderVersion);
    assert.strictEqual(dummy.rulesVersion, dummyBrain.rulesVersion);
  });

  it("has unique ids", () => {
    const ids = roster.map((e) => e.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  it("loads the committed roster without a word", () => {
    const { errors, warnings, log } = recorder();
    const loaded = loadRoster(undefined, log);
    assert.deepStrictEqual(loaded.map((e) => e.id), ["rookie", "dummy"]);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warnings, []);
  });

  it("adds a snake from its JSON files alone, and plays it", () => {
    const { ids, loaded, errors, warnings } = load(
      { "dummy.json": dummyEntry, "twin.json": { id: "twin", name: "Twin", personality: "glutton", generation: 12, method: "neuroevolution", brain: "twin.json" } },
      { "dummy.json": dummyBrain, "twin.json": dummyBrain }
    );
    assert.deepStrictEqual(ids, ["rookie", "dummy", "twin"]);
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(warnings, []);
    assert.deepStrictEqual(rosterListing(loaded)[2], {
      id: "twin", name: "Twin", personality: "glutton", generation: 12, method: "neuroevolution",
      kind: "brain", encoderVersion: 1, rulesVersion: RULES_VERSION
    });
    assert.strictEqual(deciderFor(pickBot("twin", loaded))(view()), "d");
  });

  it("loads entries in the order of their file names", () => {
    const { ids } = load({ "b.json": { ...dummyEntry, id: "b" }, "a.json": { ...dummyEntry, id: "a" }, "notes.txt": "not an entry" });
    assert.deepStrictEqual(ids, ["rookie", "a", "b"]);
  });

  it("skips a broken brain with an error, and still loads the others", () => {
    const { ids, errors, warnings } = load(
      { "broken.json": { ...dummyEntry, id: "broken", brain: "broken.json" }, "dummy.json": dummyEntry },
      { "broken.json": { ...dummyBrain, sizes: [23, 3] }, "dummy.json": dummyBrain }
    );
    assert.deepStrictEqual(ids, ["rookie", "dummy"]);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /broken/);
    assert.deepStrictEqual(warnings, []);
  });

  it("skips a brain that isn't even an object, or isn't JSON", () => {
    const { ids, errors } = load(
      { "a.json": { ...dummyEntry, id: "nothing", brain: "null.json" }, "b.json": { ...dummyEntry, id: "garbled", brain: "garbled.json" } },
      { "null.json": null, "garbled.json": "{ not json" }
    );
    assert.deepStrictEqual(ids, ["rookie"]);
    assert.strictEqual(errors.length, 2);
    assert.match(errors[1], /garbled/);
  });

  it("skips an entry that names a missing brain file, and still loads the others", () => {
    const { ids, errors } = load({ "a.json": { ...dummyEntry, id: "lost", brain: "nowhere.json" }, "b.json": dummyEntry });
    assert.deepStrictEqual(ids, ["rookie", "dummy"]);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /lost/);
    assert.match(errors[0], /nowhere\.json/);
  });

  it("won't read a brain from outside the brains folder", () => {
    const { ids, errors } = load({ "a.json": { ...dummyEntry, brain: "../entries/a.json" } });
    assert.deepStrictEqual(ids, ["rookie"]);
    assert.strictEqual(errors.length, 1);
  });

  it("skips a malformed entry, and still loads the others", () => {
    const { name, ...nameless } = dummyEntry;
    const { ids, errors } = load({
      "a.json": nameless,
      "b.json": "{ not json",
      "c.json": ["dummy"],
      "d.json": { ...dummyEntry, id: "", generation: -1 },
      "e.json": { ...dummyEntry, id: "extra", colour: "green" },
      "f.json": { ...dummyEntry, id: "fine" }
    });
    assert.deepStrictEqual(ids, ["rookie", "fine"]);
    assert.strictEqual(errors.length, 5);
    ["a.json", "b.json", "c.json", "d.json", "e.json"].forEach((file, i) => assert.match(errors[i], new RegExp(file)));
    assert.match(errors[0], /name/);
    assert.match(errors[4], /colour/);
  });

  it("skips an entry with an unknown method or personality, and still loads the others", () => {
    const { ids, errors } = load({
      "a.json": { ...dummyEntry, id: "mystery", method: "magic" },
      "b.json": { ...dummyEntry, id: "moody", personality: "grumpy" },
      "c.json": dummyEntry
    });
    assert.deepStrictEqual(ids, ["rookie", "dummy"]);
    assert.strictEqual(errors.length, 2);
    assert.match(errors[0], /magic/);
    assert.match(errors[1], /grumpy/);
  });

  it("loads a brain made under other rules, with a warning", () => {
    const { ids, loaded, errors, warnings } = load(
      { "old.json": { ...dummyEntry, id: "old", brain: "old.json" } },
      { "old.json": { ...dummyBrain, rulesVersion: RULES_VERSION - 1 } }
    );
    assert.deepStrictEqual(ids, ["rookie", "old"]);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /old/);
    const entry = loaded[1];
    assert.ok(entry.kind === "brain" && entry.rulesVersion === RULES_VERSION - 1);
  });

  it("skips an entry whose id is already taken", () => {
    const { loaded, errors } = load({ "a.json": dummyEntry, "b.json": { ...dummyEntry, name: "Other" }, "c.json": { ...dummyEntry, id: "rookie" } });
    assert.deepStrictEqual(loaded.map((e) => e.name), ["Rookie", "Dummy"]);
    assert.strictEqual(errors.length, 2);
  });

  it("has only the rookie, with an error, if there's no roster to read", () => {
    const { errors, log } = recorder();
    assert.deepStrictEqual(loadRoster(join(tmpdir(), "no-such-roster"), log).map((e) => e.id), ["rookie"]);
    assert.strictEqual(errors.length, 1);
  });

  it("always has the rookie, first", () => {
    assert.deepStrictEqual(load({}).ids, ["rookie"]);
    assert.strictEqual(roster[0].id, "rookie");
  });

  describe("picking a bot", () => {
    it("finds an entry by id", () => {
      assert.strictEqual(pickBot("dummy").id, "dummy");
      assert.strictEqual(pickBot("rookie").id, "rookie");
    });

    it("falls back to the rookie for a missing, unknown or skipped id", () => {
      [undefined, "nobody", "", 7, {}, "toString"].forEach((id) => assert.strictEqual(pickBot(id).id, "rookie"));
      const { loaded } = load({ "dummy.json": dummyEntry }, { "dummy.json": {} });
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
