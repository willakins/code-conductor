const assert = require("node:assert/strict");
const test = require("node:test");

const {
  readDeployAvailabilityFromTopic,
} = require("../../src/shared/deploy_availability");

test("readDeployAvailabilityFromTopic finds production red status in a descriptive topic", () => {
  const topic =
    "set the channel topic: Production: :red_circle: (Test) On Call/Support: Isaiah Week of July 26-August 1st.";

  assert.equal(readDeployAvailabilityFromTopic(topic, "prod"), "blocked");
});

test("readDeployAvailabilityFromTopic reads each environment independently", () => {
  const topic = "Production: :large_green_circle: Staging: 🔴";

  assert.equal(readDeployAvailabilityFromTopic(topic, "prod"), "allowed");
  assert.equal(readDeployAvailabilityFromTopic(topic, "staging"), "blocked");
});

test("readDeployAvailabilityFromTopic returns unknown without a recognized marker", () => {
  assert.equal(
    readDeployAvailabilityFromTopic("Production deploy status is discussed elsewhere.", "prod"),
    "unknown",
  );
});
