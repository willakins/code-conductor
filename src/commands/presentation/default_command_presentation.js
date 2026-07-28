const MAX_SECTION_TEXT_LENGTH = 2800;

const COMMAND_TITLES = {
  config: "Calypso configuration",
  deploy: "Calypso deployment",
  doctor: "Calypso diagnostics",
  emails: "Support email",
  errors: "Error tracking",
  help: "Calypso help",
  gate: "Deployment gate",
  history: "Calypso activity",
  "must-test": "Force-deploy protection",
  reviews: "Pull request reviews",
  status: "Production deploy status",
  sync: "Pull request sync",
  tested: "Testing confirmation",
  unknown: "Calypso command",
  whitelist: "Deploy access",
};

function buildDefaultCommandPresentation({ commandName, responseText }) {
  const normalizedResponseText = String(responseText || "").trim();
  const { summary, sections } = splitResponseContent(normalizedResponseText);

  return {
    tone: inferResponseTone(normalizedResponseText),
    title: COMMAND_TITLES[commandName] || COMMAND_TITLES.unknown,
    summary,
    sections: sections.map((text) => ({ text })),
    actions: buildDefaultActions(commandName),
  };
}

function buildDefaultActions(commandName) {
  const actionsByCommand = {
    config: [{ id: "config_help", label: "Configuration help", command: "help config" }],
    deploy: [{ id: "deploy_status", label: "View status", command: "status" }],
    doctor: [{ id: "rerun_doctor", label: "Run again", command: "doctor" }],
    emails: [{ id: "refresh_emails", label: "Refresh queue", command: "emails" }],
    errors: [{ id: "refresh_errors", label: "Refresh errors", command: "errors" }],
    gate: [{ id: "gate_status", label: "Gate status", command: "gate status prod" }],
    history: [{ id: "refresh_history", label: "Refresh history", command: "history" }],
    "must-test": [{ id: "must_test_status", label: "View status", command: "status" }],
    reviews: [{ id: "refresh_reviews", label: "Refresh reviews", command: "reviews" }],
    status: [{ id: "refresh_status", label: "Refresh status", command: "status" }],
    sync: [{ id: "view_reviews", label: "View reviews", command: "reviews" }],
    tested: [{ id: "tested_status", label: "View status", command: "status" }],
    whitelist: [{ id: "deploy_help", label: "Deploy help", command: "help deploy" }],
  };
  return actionsByCommand[commandName] || [];
}

function splitResponseContent(responseText) {
  const lines = String(responseText || "").split("\n");
  removeLeadingBlankLines(lines);
  let summary = String(lines.shift() || "").trim();
  removeLeadingBlankLines(lines);

  if (isStandaloneMarkdownHeading(summary) && lines.length > 0) {
    summary = String(lines.shift() || "").trim();
    removeLeadingBlankLines(lines);
  }

  const paragraphs = splitLinesIntoParagraphs(lines);
  return {
    summary,
    sections: paragraphs.flatMap((paragraph) =>
      splitTextAtLineBoundaries(paragraph, MAX_SECTION_TEXT_LENGTH),
    ),
  };
}

function splitLinesIntoParagraphs(lines) {
  const paragraphs = [];
  let currentLines = [];

  for (const line of lines) {
    if (String(line).trim() === "") {
      if (currentLines.length > 0) {
        paragraphs.push(currentLines.join("\n"));
        currentLines = [];
      }
      continue;
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    paragraphs.push(currentLines.join("\n"));
  }
  return paragraphs;
}

function splitTextAtLineBoundaries(text, maxLength) {
  const chunks = [];
  let currentChunk = "";

  for (const line of String(text || "").split("\n")) {
    const candidate = currentChunk ? `${currentChunk}\n${line}` : line;
    if (candidate.length <= maxLength) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }
    currentChunk = "";

    for (let index = 0; index < line.length; index += maxLength) {
      const lineChunk = line.slice(index, index + maxLength);
      if (lineChunk.length === maxLength) {
        chunks.push(lineChunk);
      } else {
        currentChunk = lineChunk;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }
  return chunks;
}

function inferResponseTone(responseText) {
  const responseLead = String(responseText || "").slice(0, 400);
  if (/\b(failed|denied|could not|hit an error)\b/i.test(responseLead)) {
    return "danger";
  }
  if (
    /\b(unavailable|not found|invalid|already|cannot)\b/i.test(responseLead)
    || /^(usage:|unknown subcommand)/i.test(responseLead)
  ) {
    return "warning";
  }
  if (
    /\b(marked|updated|configured|added|cleared|completed|finished successfully)\b/i
      .test(responseLead)
  ) {
    return "success";
  }
  return "neutral";
}

function isStandaloneMarkdownHeading(value) {
  return /^\*[^*\n]+\*$/.test(String(value || "").trim());
}

function removeLeadingBlankLines(lines) {
  while (lines.length > 0 && String(lines[0]).trim() === "") {
    lines.shift();
  }
}

module.exports = {
  buildDefaultCommandPresentation,
};
