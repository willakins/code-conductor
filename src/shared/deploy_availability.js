function readDeployAvailabilityFromTopic(topicText, deployEnvironment) {
  const segment = readEnvironmentTopicSegment(topicText, deployEnvironment);
  if (!segment) {
    return "unknown";
  }

  const normalizedSegment = segment.toLowerCase();
  if (containsTopicStatus(normalizedSegment, [":red_circle:", ":large_red_circle:", "🔴"])) {
    return "blocked";
  }

  if (
    containsTopicStatus(
      normalizedSegment,
      [":green_circle:", ":large_green_circle:", "🟢"],
    )
  ) {
    return "allowed";
  }

  return "unknown";
}

function readEnvironmentTopicSegment(topicText, deployEnvironment) {
  const normalizedEnvironment = String(deployEnvironment || "").toLowerCase();
  const targetLabel =
    normalizedEnvironment === "prod" ? "(?:prod|production)" : "(?:staging)";
  const otherLabel =
    normalizedEnvironment === "prod" ? "(?:staging)" : "(?:prod|production)";
  const pattern = new RegExp(
    `\\b${targetLabel}\\b\\s*:\\s*(.*?)(?=\\b${otherLabel}\\b\\s*:|$)`,
    "i",
  );
  const match = String(topicText || "").match(pattern);
  return match?.[1] ? String(match[1]).trim() : "";
}

function containsTopicStatus(topicSegment, tokens) {
  return tokens.some((token) => topicSegment.includes(token.toLowerCase()));
}

module.exports = {
  readDeployAvailabilityFromTopic,
};
