import assert from "assert";
import { readdirSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

import { specifiers } from "./helpers";

const engineDir = join(__dirname, "../src/engine");

const forbidden = [/(^|\/)rooms(\/|$)/, /schema/i, /colyseus/i];

/** Whether `spec`, imported by engine/`file`, names a file inside the engine directory. */
const staysInEngine = (file: string, spec: string) => {
  if (!spec.startsWith(".")) return false;
  const target = relative(engineDir, resolve(engineDir, dirname(file), spec));
  return !target.startsWith("..");
};

describe("engine boundary", () => {
  const files = readdirSync(engineDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"));

  it("finds the engine's files and their imports", () => {
    assert.ok(files.length > 0, "no engine files found");
    const all = files.flatMap((file) => specifiers(readFileSync(join(engineDir, file), "utf8")));
    assert.ok(all.includes("./rng"), "the scan missed a known import");
  });

  it("never imports from rooms/, the schema or Colyseus", () => {
    files.forEach((file) => {
      specifiers(readFileSync(join(engineDir, file), "utf8")).forEach((spec) => {
        forbidden.forEach((pattern) =>
          assert.ok(!pattern.test(spec), `engine/${file} imports "${spec}"`)
        );
      });
    });
  });

  it("imports only files inside the engine directory", () => {
    files.forEach((file) => {
      specifiers(readFileSync(join(engineDir, file), "utf8")).forEach((spec) =>
        assert.ok(staysInEngine(file, spec), `engine/${file} imports "${spec}"`)
      );
    });
  });

  it("tells a file inside the engine from one outside it", () => {
    assert.ok(staysInEngine("tick.ts", "./rng"));
    assert.ok(staysInEngine("sub/a.ts", "../rng"));
    assert.ok(!staysInEngine("tick.ts", "../gameConfig"));
    assert.ok(staysInEngine("tick.ts", "."));
    assert.ok(!staysInEngine("tick.ts", "colyseus"));
    assert.ok(!staysInEngine("tick.ts", "fs"));
  });
});
