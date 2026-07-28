const MAX_SECTION_TEXT_LENGTH = 2800;

const COMMAND_TITLES = {
  config: "Calypso configuration",
  deploy: "Calypso deployment",
  emails: "Support email",
  errors: "Error tracking",
  help: "Calypso help",
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
  };
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
