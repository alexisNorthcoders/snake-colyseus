import { RULES_VERSION } from "../engine";
import { Brain, brainDecider, brainProblems } from "./brain";
import { dummyBrain } from "./dummy";
import { rookie, rookieBotProfile } from "./rookie";
import { Decider } from "./view";

export type Personality = "glutton" | "survivor" | "hunter";
export type TrainingMethod = "scripted" | "hand-made" | "neuroevolution" | "ppo";

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

/** A named opponent a vs-bot room can play against. */
export type RosterEntry =
  | (EntryMetadata & { kind: "scripted"; decider: Decider })
  | (EntryMetadata & { kind: "brain"; encoderVersion: number; rulesVersion: number; brain: Brain });

/** A roster entry without its brain or code: what `GET /roster` lists. */
export type RosterListing =
  | (EntryMetadata & { kind: "scripted" })
  | (EntryMetadata & { kind: "brain"; encoderVersion: number; rulesVersion: number });

/** A brain entry as committed, before its brain is checked. */
export type RosterSource = EntryMetadata & { brain: unknown };

const rookieEntry: RosterEntry = {
  id: "rookie",
  name: rookieBotProfile.name,
  generation: 0,
  method: "scripted",
  kind: "scripted",
  decider: rookie
};

/**
 * The roster's brains, as committed. Adding a snake means adding its brain
 * file under brains/ and an entry here, and nothing else.
 */
export const rosterSources: RosterSource[] = [
  { id: "dummy", name: "Dummy", generation: 0, method: "hand-made", brain: dummyBrain }
];

/** Where loading reports a skipped entry or a warning. */
export type RosterLog = Pick<Console, "error" | "warn">;

/**
 * The roster: the rookie, always first, then every source whose brain is
 * valid. A brain that isn't, or an id that's taken, is skipped with a logged
 * error; a brain made under other rules is loaded with a logged warning.
 * Never throws.
 */
export function loadRoster(sources: RosterSource[] = rosterSources, log: RosterLog = console): RosterEntry[] {
  const entries: RosterEntry[] = [rookieEntry];
  sources.forEach(({ brain, ...metadata }) => {
    if (entries.some((entry) => entry.id === metadata.id)) {
      log.error(`[roster] Skipped "${metadata.id}": another entry has that id`);
      return;
    }
    const problems = brainProblems(brain);
    if (problems.length > 0) {
      log.error(`[roster] Skipped "${metadata.id}": its brain isn't valid: ${problems.join("; ")}`);
      return;
    }
    const valid = brain as Brain;
    if (valid.rulesVersion !== RULES_VERSION) {
      log.warn(`[roster] "${metadata.id}" was made under rules v${valid.rulesVersion}, not v${RULES_VERSION}`);
    }
    entries.push({ ...metadata, kind: "brain", encoderVersion: valid.encoderVersion, rulesVersion: valid.rulesVersion, brain: valid });
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
