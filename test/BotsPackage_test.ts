import assert from "assert";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
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

  // Built into a scratch copy of the package the way `npm run build` builds
  // it, then imported by its published name, as an installing repo would.
  describe("once built", function () {
    this.timeout(60000);
    let pkgDir: string;

    before(() => {
      pkgDir = mkdtempSync(join(tmpdir(), "snake-colyseus-bots-"));
      copyFileSync(join(root, "package.json"), join(pkgDir, "package.json"));
      execFileSync(process.execPath, [
        require.resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.json"),
        "--outDir", join(pkgDir, tsconfig.compilerOptions.outDir)
      ], { cwd: root, stdio: "pipe" });
    });

    after(() => rmSync(pkgDir, { recursive: true, force: true }));

    /** Runs `script` in a fresh node, from inside the package, with no TypeScript loader. */
    const run = (script: string) => execFileSync(process.execPath, ["-e", script], { cwd: pkgDir, encoding: "utf8" });

    it("resolves \"snake-colyseus/bots\" to built JavaScript, with its types next to it", () => {
      const resolved = run("console.log(require.resolve('snake-colyseus/bots'))").trim();
      assert.strictEqual(resolved, join(pkgDir, built("bots/index", "js")));
      assert.ok(existsSync(join(pkgDir, built("bots/index", "d.ts"))), "the build has no types for the bots");
      const exported = JSON.parse(run("console.log(JSON.stringify(Object.keys(require('snake-colyseus/bots'))))"));
      ["Snapshots", "viewFor", "decide", "rookie", "rookieBotProfile"].forEach((name) =>
        assert.ok(exported.includes(name), `the built bots don't export ${name}`)
      );
    });

    it("doesn't load Colyseus when imported", () => {
      const loaded: string[] = JSON.parse(run(
        "require('snake-colyseus/bots'); console.log(JSON.stringify(Object.keys(require.cache)))"
      ));
      assert.ok(loaded.includes(join(pkgDir, built("bots/index", "js"))), "the bots never loaded");
      loaded.forEach((file) => {
        assert.ok(file.startsWith(pkgDir), `loads ${file}, outside the package`);
        assert.ok(!/colyseus|rooms|schema/i.test(file.slice(pkgDir.length)), `loads ${file}`);
      });
    });
  });
});
