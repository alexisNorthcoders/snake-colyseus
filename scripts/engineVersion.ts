/**
 * The engine and bots ship under one `engine-vX.Y.Z` tag series, and a PR
 * declares the next tag's version in package.json's `engineVersion`. CI tags
 * `master` from it once the PR lands (see AGENTS.md).
 */

/** Where the engine's and bots' source lives; a change here needs a new tag. */
const shipped = ["src/engine/", "src/bots/"];

const semver = /^(\d+)\.(\d+)\.(\d+)$/;

/** A version's major, minor and patch numbers, or null if it isn't X.Y.Z. */
const parse = (version: string | undefined) => semver.exec(version ?? "")?.slice(1).map(Number) ?? null;

/** Whether version `a` comes after `b`. */
const isAfter = (a: number[], b: number[]) => {
  const i = a.findIndex((n, j) => n !== b[j]);
  return i >= 0 && a[i] > b[i];
};

/** The three versions that can follow `[major, minor, patch]`, with what each is for. */
const nextSteps = ([major, minor, patch]: number[]) => [
  `  ${major + 1}.0.0 for a rules change (RULES_VERSION bumped) or a breaking API change`,
  `  ${major}.${minor + 1}.0 for an added export`,
  `  ${major}.${minor}.${patch + 1} for a fix that changes neither`,
];

/** Whether `head` is exactly one major, minor or patch step after `base`. */
const isNextStep = ([major, minor, patch]: number[], head: number[]) =>
  [
    [major + 1, 0, 0],
    [major, minor + 1, 0],
    [major, minor, patch + 1],
  ].some((step) => step.every((n, i) => n === head[i]));

/**
 * Why a PR's `engineVersion` needs fixing, given the files it changed and the
 * field on its base and head, or null if it's fine.
 */
export function bumpProblem(changedFiles: string[], baseVersion: string | undefined, headVersion: string | undefined) {
  const head = parse(headVersion);
  if (!head) return `package.json's engineVersion must be X.Y.Z, e.g. "3.1.0"; it's ${JSON.stringify(headVersion)}.`;
  const base = parse(baseVersion);
  if (!base) return null;
  if (isAfter(base, head)) {
    return `package.json's engineVersion must be higher than ${baseVersion}, the base branch's; it's ${headVersion}.`;
  }
  if (isAfter(head, base)) {
    if (isNextStep(base, head)) return null;
    return [
      `package.json's engineVersion jumped from ${baseVersion} to ${headVersion}; bump it one step instead:`,
      ...nextSteps(base),
    ].join("\n");
  }

  const changed = changedFiles.filter((file) => shipped.some((dir) => file.startsWith(dir)));
  if (changed.length === 0) return null;

  return [
    `These engine or bots files changed, but package.json's engineVersion is still ${headVersion}:`,
    ...changed.map((file) => `  ${file}`),
    "Bump engineVersion so CI tags the change once it's merged:",
    ...nextSteps(head),
  ].join("\n");
}
