import assert from "assert";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));

/** Where tsc puts the compiled form of `src/<path>.ts`. */
const built = (path: string, ext: "js" | "d.ts") => `./${tsconfig.compilerOptions.outDir}/${path}.${ext}`;

/**
 * Another repo installs the bots from a git tag, next to the engine, and
 * imports "snake-colyseus/bots": these hold the manifest to what that needs.
 */
describe("bots package", () => {
  it("exposes the bots' entry point, built, with its types", () => {
    assert.deepStrictEqual(pkg.exports["./bots"], {
      types: built("bots/index", "d.ts"),
      default: built("bots/index", "js")
    });
    assert.deepStrictEqual(pkg.typesVersions["*"].bots, [built("bots/index", "d.ts").slice(2)]);
    assert.ok(tsconfig.compilerOptions.declaration, "tsc emits no type declarations");
  });

  it("doesn't load Colyseus when imported", () => {
    const loaded: string[] = JSON.parse(execFileSync(process.execPath, [
      "-r", "tsx/cjs",
      "-e", "require('./src/bots'); console.log(JSON.stringify(Object.keys(require.cache)))"
    ], { cwd: root, encoding: "utf8" }));
    assert.ok(loaded.some((file) => file.endsWith(join("src", "bots", "index.ts"))), "the bots never loaded");
    loaded.forEach((file) => assert.ok(!/colyseus/i.test(file.slice(root.length)), `loads ${file}`));
  });
});
