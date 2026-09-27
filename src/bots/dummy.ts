import { Brain, brainProblems } from "./brain";
import dummy from "./brains/dummy.json";

/**
 * Dummy: a brain whose weights were set by hand, not trained, to show a brain
 * playing before any has been. It only has to be sane, not good.
 *
 * Five tanh hidden units read encoder v1: one for each of left, straight and
 * right that fires when the next cell that way is blocked or beside an enemy
 * head, and two for the best pellet, how far to the right and how far ahead
 * it is. The outputs then give straight a small lead, take a lot off any way
 * that's in danger, and lean towards the pellet: straight while it's ahead,
 * turning towards its side once it's level or behind.
 */
export const dummyBrain = dummy as Brain;

const problems = brainProblems(dummyBrain);
if (problems.length > 0) throw new Error(`Dummy isn't a valid brain: ${problems.join("; ")}`);
