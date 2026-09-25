import assert from "assert";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

import { specifiers } from "./helpers";

const root = join(__dirname, "..");
const botsDir = join(root, "src/bots");
const engineDir = join(root, "src/engine");
const engineEntry = join(engineDir, "index.ts");

const forbidden = [/(^|\/)rooms(\/|$)/, /schema/i, /colyseus/i];

/** Where `spec`, imported by the file at `from`, points, relative to `dir` ("" for `dir` itself). */
const target = (dir: string, from: string, spec: string) => relative(dir, resolve(dirname(from), spec));

/** Whether `path`, relative to some directory, stays inside it. */
const inside = (path: string) => !path.startsWith("..");

/** Whether `spec`, imported by the file at `from`, names the engine's entry point. */
const isEngineEntry = (from: string, spec: string) =>
  spec.startsWith(".") && ["", "index"].includes(target(engineDir, from, spec));

/**
 * Whether `spec`, imported by the file at `from`, names another bots file
 * without ever stepping outside the bots directory on the way, so
 * "../bots/view" from bots/rookie.ts doesn't count.
 */
const isOwnFile = (from: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  let at = dirname(from);
  return spec.split("/").every((segment) => {
    at = resolve(at, segment);
    return inside(relative(botsDir, at));
  });
};

/** Whether `spec`, imported by bots/`file`, is the engine's entry point or one of the bots' own files. */
const allowed = (file: string, spec: string) => {
  const from = join(botsDir, file);
  return isEngineEntry(from, spec) || isOwnFile(from, spec);
};

/** The .ts file a relative `spec`, imported by the file at `from`, loads. */
const resolveTs = (from: string, spec: string) => {
  const base = resolve(dirname(from), spec);
  const file = [`${base}.ts`, join(base, "index.ts")].find(existsSync);
  assert.ok(file, `${relative(root, from)} imports "${spec}", which isn't a .ts file`);
  return file;
};

/** Whether `spec`, imported by the file at `from`, names a file inside bots rather than its entry point. */
const reachesIntoBots = (from: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  const path = target(botsDir, from, spec);
  return path !== "" && path !== "index" && inside(path);
};

describe("bots boundary", () => {
  const files = readdirSync(botsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"));
  const importsOf = (file: string) => specifiers(readFileSync(join(botsDir, file), "utf8"));

  it("finds the bots' files and their imports", () => {
    assert.ok(files.length > 0, "no bots files found");
    assert.ok(files.flatMap(importsOf).includes("../engine"), "the scan missed a known import");
  });

  it("never imports from rooms/, the schema or Colyseus", () => {
    files.forEach((file) => {
      importsOf(file).forEach((spec) => {
        forbidden.forEach((pattern) =>
          assert.ok(!pattern.test(spec), `bots/${file} imports "${spec}"`)
        );
      });
    });
  });

  it("never reaches past the engine's entry point", () => {
    files.forEach((file) => {
      const from = join(botsDir, file);
      importsOf(file).forEach((spec) => {
        const path = target(engineDir, from, spec);
        if (spec.startsWith(".") && inside(path)) {
          assert.ok(isEngineEntry(from, spec), `bots/${file} imports "${spec}", past the engine's entry point`);
        }
      });
    });
  });

  it("imports only the engine's entry point and its own files", () => {
    files.forEach((file) => {
      importsOf(file).forEach((spec) =>
        assert.ok(allowed(file, spec), `bots/${file} imports "${spec}"`)
      );
    });
  });

  it("loads, from its entry point, only its own files and the engine's entry point", () => {
    const reached = new Set<string>();
    const visit = (file: string) => {
      if (reached.has(file)) return;
      reached.add(file);
      if (file === engineEntry) return;
      specifiers(readFileSync(file, "utf8")).forEach((spec) => {
        assert.ok(spec.startsWith("."), `${relative(root, file)} imports "${spec}"`);
        visit(resolveTs(file, spec));
      });
    };
    visit(join(botsDir, "index.ts"));

    assert.ok(reached.has(engineEntry), "the bots never reached the engine");
    reached.forEach((file) =>
      assert.ok(file === engineEntry || inside(relative(botsDir, file)), `the bots load ${relative(root, file)}`)
    );
    files.forEach((file) =>
      assert.ok(reached.has(join(botsDir, file)), `bots/${file} isn't reached from the entry point`)
    );
  });

  it("tells the engine's entry point and its own files from anything else", () => {
    assert.ok(allowed("view.ts", "../engine"));
    assert.ok(allowed("view.ts", "../engine/index"));
    assert.ok(allowed("view.ts", "./rookie"));
    assert.ok(allowed("view.ts", "."));
    assert.ok(allowed("sub/a.ts", "../view"));
    assert.ok(!allowed("view.ts", "../bots/rookie"));
    assert.ok(!allowed("view.ts", "../engine/tick"));
    assert.ok(!allowed("view.ts", "../engine/index/../tick"));
    assert.ok(!allowed("view.ts", "../rooms/SnakeRoom"));
    assert.ok(!allowed("view.ts", "../rooms/schema/SnakeRoomState"));
    assert.ok(!allowed("view.ts", "../gameConfig"));
    assert.ok(!allowed("view.ts", "colyseus"));
    assert.ok(!allowed("view.ts", "@colyseus/schema"));
    assert.ok(!allowed("view.ts", "fs"));
  });

  it("is only ever reached through its entry point from outside it", () => {
    const consumers = ["src", "loadtest"]
      .flatMap((dir) =>
        readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) => join(root, dir, file))
      )
      .filter((file) => file.endsWith(".ts") && !inside(relative(botsDir, file)));
    assert.ok(consumers.some((file) => file.endsWith("SnakeRoom.ts")), "the scan missed the room");
    consumers.forEach((file) => {
      specifiers(readFileSync(file, "utf8")).forEach((spec) =>
        assert.ok(!reachesIntoBots(file, spec), `${relative(root, file)} imports "${spec}"`)
      );
    });
    const room = join(root, "src/rooms/SnakeRoom.ts");
    assert.ok(!reachesIntoBots(room, "../bots"));
    assert.ok(reachesIntoBots(room, "../bots/rookie"));
  });
});
