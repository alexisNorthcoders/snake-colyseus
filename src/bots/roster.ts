/**
 * The roster: the named opponents a vs-bot room can play. The rookie is in
 * code; every other snake is data, read from JSON at start-up.
 *
 * Adding a snake takes two JSON files and no code:
 * - its brain, `src/bots/brains/<file>.json`, a `Brain`
 * - its entry, `src/bots/entries/<id>.json`:
 *   `{ "id", "name", "personality"?, "generation", "method", "brain": "<file>.json" }`,
 *   where `brain` names its file in `brains/`
 *
 * `tsconfig.json` includes both folders, so the build ships them.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import { RULES_VERSION } from "../engine";
import { Brain, brainDecider, brainProblems } from "./brain";
import { rookie, rookieBotProfile } from "./rookie";
import { Decider } from "./view";

const personalities = ["glutton", "survivor", "hunter"] as const;
const methods = ["scripted", "hand-made", "neuroevolution", "ppo"] as const;

export type Personality = (typeof personalities)[number];
export type TrainingMethod = (typeof methods)[number];

/** What every roster entry says about itself. */
interface EntryMetadata {
  /** A stable slug: what a client asks for. */
  id: string;
  /** Shown in game as the bot's player name. */
  name: string;
  /** What it was trained for; left out for an entry that wasn't trained. */
  personality?: Personality;
  /** 0 for an entry that wasn't trained. */
  generation: number;
  method: TrainingMethod;
}

/** A roster entry without its brain or code: what `GET /roster` lists. */
export type RosterListing =
  | (EntryMetadata & { kind: "scripted" })
  | (EntryMetadata & { kind: "brain"; encoderVersion: number; rulesVersion: number });

/** A named opponent a vs-bot room can play against. */
export type RosterEntry =
  | (Extract<RosterListing, { kind: "scripted" }> & { decider: Decider })
  | (Extract<RosterListing, { kind: "brain" }> & { brain: Brain });

const rookieEntry: RosterEntry = {
  id: "rookie",
  name: rookieBotProfile.name,
  generation: 0,
  method: "scripted",
  kind: "scripted",
  decider: rookie
};

/** Where the committed roster's JSON lives: `entries/` and `brains/` in the bots' folder. */
const ROSTER_DIR = __dirname;

/** Where loading reports a skipped entry or a warning. */
export type RosterLog = Pick<Console, "error" | "warn">;

const entryFields = ["id", "name", "personality", "generation", "method", "brain"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What's wrong with `value` as a roster entry file, or nothing if it's a valid one. */
function entryProblems(value: unknown): string[] {
  if (!isObject(value)) return ["an entry must be an object"];
  const problems: string[] = [];
  const nonEmpty = (field: string) => {
    if (typeof value[field] !== "string" || value[field] === "") problems.push(`${field} must be a string that isn't empty`);
  };
  nonEmpty("id");
  nonEmpty("name");
  if (value.personality !== undefined && !personalities.includes(value.personality as Personality)) {
    problems.push(`personality ${JSON.stringify(value.personality)} isn't one of ${personalities.join(", ")}`);
  }
  if (!Number.isInteger(value.generation) || (value.generation as number) < 0) problems.push("generation must be a whole number, 0 or more");
  if (!methods.includes(value.method as TrainingMethod)) {
    problems.push(`method ${JSON.stringify(value.method)} isn't one of ${methods.join(", ")}`);
  }
  // A file in brains/ itself, never a path out of it.
  if (typeof value.brain !== "string" || !/^[\w.-]+\.json$/.test(value.brain) || value.brain.startsWith(".")) {
    problems.push("brain must name a .json file in brains/");
  }
  Object.keys(value).forEach((field) => {
    if (!entryFields.includes(field)) problems.push(`field "${field}" isn't known`);
  });
  return problems;
}

/** The JSON in `path`, or why it can't be read. */
function readJson(path: string): { json: unknown } | { problem: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { problem: `there's no file ${path}` };
  }
  try {
    return { json: JSON.parse(text) };
  } catch (error) {
    return { problem: `${path} isn't JSON: ${(error as Error).message}` };
  }
}

/**
 * The roster: the rookie, always first, then every snake in `dir`, in the
 * order of its entry's file name. Never throws.
 *
 * An entry that can't be read (not JSON, a field missing or unknown, a
 * personality or method that isn't known), one that names a brain file that
 * isn't there or isn't a valid brain, or one whose id is taken, is skipped
 * with a logged error. A brain made under other rules is loaded with a logged
 * warning.
 */
export function loadRoster(dir: string = ROSTER_DIR, log: RosterLog = console): RosterEntry[] {
  const entries: RosterEntry[] = [rookieEntry];
  let files: string[];
  try {
    files = readdirSync(join(dir, "entries")).filter((file) => file.endsWith(".json")).sort();
  } catch {
    log.error(`[roster] Loaded only the rookie: there's no folder ${join(dir, "entries")}`);
    return entries;
  }

  files.forEach((file) => {
    const skip = (why: string) => log.error(`[roster] Skipped entries/${file}: ${why}`);
    const read = readJson(join(dir, "entries", file));
    if ("problem" in read) return skip(read.problem);
    const problems = entryProblems(read.json);
    if (problems.length > 0) return skip(`it isn't a valid entry: ${problems.join("; ")}`);
    const { brain: brainFile, ...metadata } = read.json as EntryMetadata & { brain: string };

    const skipEntry = (why: string) => skip(`"${metadata.id}" ${why}`);
    if (entries.some((entry) => entry.id === metadata.id)) return skipEntry("has an id another entry has");
    const brain = readJson(join(dir, "brains", brainFile));
    if ("problem" in brain) return skipEntry(`names brain ${brainFile}, which can't be read: ${brain.problem}`);
    const brainIssues = brainProblems(brain.json);
    if (brainIssues.length > 0) return skipEntry(`has a brain, ${brainFile}, that isn't valid: ${brainIssues.join("; ")}`);

    const checked = brain.json as Brain;
    if (checked.rulesVersion !== RULES_VERSION) {
      log.warn(`[roster] "${metadata.id}" was made under rules v${checked.rulesVersion}, not v${RULES_VERSION}`);
    }
    entries.push({ ...metadata, kind: "brain", encoderVersion: checked.encoderVersion, rulesVersion: checked.rulesVersion, brain: checked });
  });
  return entries;
}

/** The committed roster, loaded. */
export const roster = loadRoster();

/** The entry with id `id`, or the rookie if there isn't one. */
export function pickBot(id: unknown, from: RosterEntry[] = roster): RosterEntry {
  return from.find((entry) => entry.id === id) ?? rookieEntry;
}

/** How `entry` plays. */
export function deciderFor(entry: RosterEntry): Decider {
  return entry.kind === "scripted" ? entry.decider : brainDecider(entry.brain);
}

/** Every entry's metadata, without its brain or code. */
export function rosterListing(from: RosterEntry[] = roster): RosterListing[] {
  return from.map((entry) => {
    if (entry.kind === "scripted") {
      const { decider, ...listing } = entry;
      return listing;
    }
    const { brain, ...listing } = entry;
    return listing;
  });
}
