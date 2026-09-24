import assert from "assert";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const engineDir = join(__dirname, "../src/engine");

/** Every module a file names: `import ... from`, bare `import`, `export ... from`, `require` and dynamic `import()`. */
const specifiers = (source: string) =>
  [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);

const forbidden = [/(^|\/)rooms(\/|$)/, /schema/i, /colyseus/i];

describe("engine boundary", () => {
  const files = readdirSync(engineDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"));

  it("finds the engine's files and their imports", () => {
    assert.ok(files.length > 0, "no engine files found");
    const all = files.flatMap((file) => specifiers(readFileSync(join(engineDir, file), "utf8")));
    assert.ok(all.includes("../gameConfig"), "the scan missed a known import");
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
});
