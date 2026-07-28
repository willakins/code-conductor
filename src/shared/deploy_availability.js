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

function updateDeployAvailabilityInTopic(topicText, deployEnvironment, status) {
  const topic = String(topicText || "").trim();
  const environmentLabel = String(deployEnvironment || "").toLowerCase() === "staging"
    ? "Staging"
    : "Production";
  const marker = status === "closed" ? ":red_circle:" : ":large_green_circle:";
  const labelPattern = new RegExp(`\\b(${environmentLabel}|${environmentLabel === "Production" ? "Prod" : "Staging"})\\b\\s*:`, "i");
  const labelMatch = topic.match(labelPattern);
  if (!labelMatch) {
    return [topic, `${environmentLabel}: ${marker}`].filter(Boolean).join(" · ");
  }

  const labelEnd = labelMatch.index + labelMatch[0].length;
  const before = topic.slice(0, labelEnd);
  const after = topic.slice(labelEnd);
  const otherEnvironmentPattern = environmentLabel === "Production"
    ? /\bStaging\b\s*:/i
    : /\b(?:Prod|Production)\b\s*:/i;
  const otherEnvironmentMatch = after.match(otherEnvironmentPattern);
  const segmentEnd = otherEnvironmentMatch?.index ?? after.length;
  const targetSegment = after.slice(0, segmentEnd);
  const remainingTopic = after.slice(segmentEnd);
  const markerPattern =
    /(\s*)(:red_circle:|:large_red_circle:|🔴|:green_circle:|:large_green_circle:|🟢)/i;
  if (markerPattern.test(targetSegment)) {
    return `${before}${targetSegment.replace(markerPattern, `$1${marker}`)}${remainingTopic}`;
  }
  return `${before} ${marker}${targetSegment}${remainingTopic}`;
}

module.exports = {
  readDeployAvailabilityFromTopic,
  updateDeployAvailabilityInTopic,
};
