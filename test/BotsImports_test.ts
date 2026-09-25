import assert from "assert";
import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

import { specifiers } from "./helpers";

const root = join(__dirname, "..");
const botsDir = join(root, "src/bots");
const engineDir = join(root, "src/engine");

const forbidden = [/(^|\/)rooms(\/|$)/, /schema/i, /colyseus/i];

/** Where `spec`, imported by the file at `from`, points, relative to `dir` ("" for `dir` itself). */
const target = (dir: string, from: string, spec: string) => relative(dir, resolve(dirname(from), spec));

/** Whether `spec`, imported by bots/`file`, is the engine's entry point or a file inside the bots directory. */
const allowed = (file: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  const from = join(botsDir, file);
  const engine = target(engineDir, from, spec);
  return engine === "" || engine === "index" || !target(botsDir, from, spec).startsWith("..");
};

/** Whether `spec`, imported by the file at `from`, names a file inside bots rather than its entry point. */
const reachesIntoBots = (from: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  const inside = target(botsDir, from, spec);
  return inside !== "" && inside !== "index" && !inside.startsWith("..");
};

describe("bots boundary", () => {
  const files = readdirSync(botsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"));

  it("finds the bots' files and their imports", () => {
    assert.ok(files.length > 0, "no bots files found");
    const all = files.flatMap((file) => specifiers(readFileSync(join(botsDir, file), "utf8")));
    assert.ok(all.includes("../engine"), "the scan missed a known import");
  });

  it("never imports from rooms/, the schema or Colyseus", () => {
    files.forEach((file) => {
      specifiers(readFileSync(join(botsDir, file), "utf8")).forEach((spec) => {
        forbidden.forEach((pattern) =>
          assert.ok(!pattern.test(spec), `bots/${file} imports "${spec}"`)
        );
      });
    });
  });

  it("imports only the engine's entry point and its own files", () => {
    files.forEach((file) => {
      specifiers(readFileSync(join(botsDir, file), "utf8")).forEach((spec) =>
        assert.ok(allowed(file, spec), `bots/${file} imports "${spec}"`)
      );
    });
  });

  it("tells the engine's entry point and its own files from anything else", () => {
    assert.ok(allowed("view.ts", "../engine"));
    assert.ok(allowed("view.ts", "../engine/index"));
    assert.ok(allowed("view.ts", "./rookie"));
    assert.ok(allowed("sub/a.ts", "../view"));
    assert.ok(!allowed("view.ts", "../engine/tick"));
    assert.ok(!allowed("view.ts", "../rooms/SnakeRoom"));
    assert.ok(!allowed("view.ts", "../gameConfig"));
    assert.ok(!allowed("view.ts", "colyseus"));
    assert.ok(!allowed("view.ts", "fs"));
  });

  it("is only ever reached through its entry point from outside it", () => {
    const consumers = ["src", "loadtest"]
      .flatMap((dir) =>
        readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) => join(root, dir, file))
      )
      .filter((file) => file.endsWith(".ts") && relative(botsDir, file).startsWith(".."));
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
