const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateDeploymentGate } = require("../../src/shared/gate_decision");

test("explicit gate state is authoritative over the channel topic", () => {
  const decision = evaluateDeploymentGate({
    environment: "prod",
    explicitGateState: { status: "open" },
    topicAvailability: "blocked",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.gateSource, "explicit");
  assert.equal(decision.gateStatus, "open");
});

test("gate decision combines manual, PR, and active deployment blockers", () => {
  const decision = evaluateDeploymentGate({
    activeDeployment: { id: 91 },
    blockingPullRequests: [{ pr_number: 42 }],
    environment: "prod",
    explicitGateState: { status: "closed", reason: "Incident in progress." },
  });

  assert.equal(decision.allowed, false);
  assert.deepEqual(
    decision.reasons.map((reason) => reason.code),
    ["manual_gate_closed", "untested_pull_requests", "deployment_in_progress"],
  );
});

test("staging gate ignores production PR blockers", () => {
  const decision = evaluateDeploymentGate({
    blockingPullRequests: [{ pr_number: 42 }],
    environment: "staging",
    topicAvailability: "allowed",
  });

  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.blockingPullRequests, []);
});
