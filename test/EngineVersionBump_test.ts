import assert from "assert";

import { bumpProblem } from "../scripts/engineVersion";

describe("engineVersion bump check", () => {
  it("fails when engine source changed but engineVersion didn't", () => {
    const problem = bumpProblem(["src/engine/tick.ts", "README.md"], "3.1.0", "3.1.0");
    assert.ok(problem);
    assert.match(problem, /src\/engine\/tick\.ts/);
    assert.doesNotMatch(problem, /README/);
    assert.match(problem, /engineVersion/);
    assert.match(problem, /3\.1\.0/);
  });

  it("fails when bots source changed but engineVersion didn't", () => {
    const problem = bumpProblem(["src/bots/brains/rookie.json"], "3.1.0", "3.1.0");
    assert.match(problem, /src\/bots\/brains\/rookie\.json/);
  });

  it("names what each kind of bump would be", () => {
    const problem = bumpProblem(["src/bots/view.ts"], "3.1.0", "3.1.0");
    assert.match(problem, /4\.0\.0/);
    assert.match(problem, /3\.2\.0/);
    assert.match(problem, /3\.1\.1/);
  });

  it("passes when engineVersion was bumped", () => {
    assert.equal(bumpProblem(["src/engine/tick.ts"], "3.1.0", "3.1.1"), null);
  });

  it("fails when engineVersion went down or sideways", () => {
    assert.match(bumpProblem(["src/engine/tick.ts"], "3.1.0", "3.0.0"), /higher than 3\.1\.0/);
    assert.match(bumpProblem([], "3.1.0", "3.0.9"), /higher than 3\.1\.0/);
    assert.match(bumpProblem([], "3.1.0", "2.9.9"), /higher than 3\.1\.0/);
  });

  it("compares versions by number, not text", () => {
    assert.equal(bumpProblem(["src/engine/tick.ts"], "3.9.0", "3.10.0"), null);
  });

  it("passes a major, minor or patch step", () => {
    assert.equal(bumpProblem(["src/engine/tick.ts"], "3.1.4", "4.0.0"), null);
    assert.equal(bumpProblem(["src/engine/tick.ts"], "3.1.4", "3.2.0"), null);
    assert.equal(bumpProblem(["src/engine/tick.ts"], "3.1.4", "3.1.5"), null);
  });

  it("fails when engineVersion jumped more than one step", () => {
    const problem = bumpProblem(["src/engine/tick.ts"], "3.1.0", "9.0.0");
    assert.match(problem, /jumped from 3\.1\.0 to 9\.0\.0/);
    assert.match(problem, /4\.0\.0/);
    assert.match(problem, /3\.2\.0/);
    assert.match(problem, /3\.1\.1/);
    assert.match(bumpProblem([], "3.1.0", "3.3.0"), /jumped/);
    assert.match(bumpProblem([], "3.1.0", "3.2.1"), /jumped/);
    assert.match(bumpProblem([], "3.1.0", "4.1.0"), /jumped/);
  });

  it("passes when the base had no engineVersion yet", () => {
    assert.equal(bumpProblem(["src/engine/tick.ts"], undefined, "3.1.0"), null);
  });

  it("passes when neither engine nor bots changed", () => {
    assert.equal(bumpProblem(["src/rooms/SnakeRoom.ts", "src/engineering.ts", "test/src/engine/x.ts"], "3.1.0", "3.1.0"), null);
  });

  it("fails when engineVersion isn't X.Y.Z", () => {
    assert.match(bumpProblem([], "3.1.0", "v3.2"), /X\.Y\.Z/);
    assert.match(bumpProblem([], "3.1.0", undefined), /X\.Y\.Z/);
  });
});
