/**
 * The PR check: fails when the engine or bots changed since `<base-ref>`
 * without a bump to package.json's engineVersion.
 *
 *   tsx scripts/checkEngineBump.ts <base-ref>
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

import { bumpProblem } from "./engineVersion";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

const base = process.argv[2];
if (!base) throw new Error("usage: tsx scripts/checkEngineBump.ts <base-ref>");

const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const baseVersion = JSON.parse(git("show", `${base}:package.json`)).engineVersion;
const headVersion = JSON.parse(readFileSync("package.json", "utf8")).engineVersion;

const problem = bumpProblem(changed, baseVersion, headVersion);
if (problem) {
  console.error(problem);
  process.exit(1);
}
console.log(`engineVersion ${headVersion} is fine.`);
