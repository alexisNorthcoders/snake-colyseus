import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));

/** Where tsc puts the compiled form of `src/<path>.ts`. */
const built = (path: string, ext: "js" | "d.ts") => `./${tsconfig.compilerOptions.outDir}/${path}.${ext}`;

/**
 * Another repo installs the engine from a git tag and imports
 * "snake-colyseus/engine": these hold the manifest to what that needs.
 */
describe("engine package", () => {
  it("is installed under the name its import uses", () => {
    assert.strictEqual(pkg.name, "snake-colyseus");
  });

  it("exposes the engine's entry point, built, with its types", () => {
    assert.deepStrictEqual(pkg.exports["./engine"], {
      types: built("engine/index", "d.ts"),
      default: built("engine/index", "js")
    });
    assert.ok(tsconfig.compilerOptions.declaration, "tsc emits no type declarations");
  });

  it("still points at the server as the package's main entry", () => {
    assert.strictEqual(pkg.main, "build/index.js");
    assert.strictEqual(pkg.exports["."], built("index", "js"));
    assert.strictEqual(pkg.scripts.build, "npm run clean && tsc");
  });

  it("builds on a git install and ships the build, which git ignores", () => {
    const outDir = tsconfig.compilerOptions.outDir;
    assert.ok(readFileSync(join(root, ".gitignore"), "utf8").split("\n").includes(outDir), "the build is committed");
    assert.match(pkg.scripts.prepare, /npm run build$/);
    assert.ok(pkg.files.includes(outDir), "the build isn't packed");
  });

  // A prod install that leaves out devDependencies has no tsc to build with.
  it("skips the build on install when there's no tsc", () => {
    assert.match(pkg.scripts.prepare, /^tsc --version .*\|\| exit 0;/);
  });
});
