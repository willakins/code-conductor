const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDefaultCommandPresentation,
} = require("../../src/commands/presentation/default_command_presentation");

test("default command presentation provides a title for every command", () => {
  const expectedTitles = {
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

  for (const [commandName, expectedTitle] of Object.entries(expectedTitles)) {
    const presentation = buildDefaultCommandPresentation({
      commandName,
      responseText: "Command response.",
    });
    assert.equal(presentation.title, expectedTitle);
  }
});

test("default command presentation separates headings and long-form content", () => {
  const presentation = buildDefaultCommandPresentation({
    commandName: "help",
    responseText: [
      "*Calypso*",
      "Deployment gatekeeper.",
      "",
      "*Start Here*",
      "`/calypso status` Show deploy blockers.",
      "",
      "*Modules*",
      "`/calypso help deploy` Show deploy help.",
    ].join("\n"),
  });

  assert.equal(presentation.summary, "Deployment gatekeeper.");
  assert.deepEqual(
    presentation.sections.map((section) => section.text),
    [
      "*Start Here*\n`/calypso status` Show deploy blockers.",
      "*Modules*\n`/calypso help deploy` Show deploy help.",
    ],
  );
});

test("default command presentation uses outcome-aware tones", () => {
  assert.equal(
    buildDefaultCommandPresentation({
      commandName: "tested",
      responseText: "Marked PR #42 as tested.",
    }).tone,
    "success",
  );
  assert.equal(
    buildDefaultCommandPresentation({
      commandName: "unknown",
      responseText: "Unknown subcommand.",
    }).tone,
    "warning",
  );
  assert.equal(
    buildDefaultCommandPresentation({
      commandName: "sync",
      responseText: "Open PR sync failed: provider unavailable.",
    }).tone,
    "danger",
  );
});
