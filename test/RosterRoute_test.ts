import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config";
import { RULES_VERSION } from "../src/engine";

describe("GET /roster", () => {
  let colyseus: ColyseusTestServer;

  before(async () => (colyseus = await boot(appConfig)));
  after(async () => colyseus.shutdown());

  it("lists the roster with its metadata, and no weights", async () => {
    const response = await colyseus.http.get("/roster");
    assert.strictEqual(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /application\/json/);
    assert.deepStrictEqual(response.data, [
      { id: "rookie", name: "Rookie", generation: 0, method: "scripted", rating: 1200, kind: "scripted" },
      { id: "dummy", name: "Dummy", generation: 0, method: "hand-made", kind: "brain", encoderVersion: 1, rulesVersion: RULES_VERSION },
      { id: "greedy-gus", name: "Greedy Gus", personality: "glutton", generation: 250, method: "neuroevolution", rating: 1150, kind: "brain", encoderVersion: 1, rulesVersion: RULES_VERSION }
    ]);
    assert.doesNotMatch(JSON.stringify(response.data), /weights|biases|layers/);
  });
});
