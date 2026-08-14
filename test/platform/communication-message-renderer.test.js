const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCommunicationMessage,
} = require("../../src/platform/communication/message_renderer");

const STATUS_PRESENTATION = {
  tone: "danger",
  title: "Production deploy is blocked",
  summary: "One PR needs testing.",
  facts: [
    {
      label: "Blocking PRs",
      value: "1",
    },
  ],
  sections: [
    {
      title: "Needs testing",
      items: [
        {
          title: "acme/widgets#42 — Improve deploy controls",
          url: "https://example.test/acme/widgets/pull/42",
          description: "Status: untested",
        },
      ],
    },
  ],
  context: "Run `/conductor tested 42` when verified.",
};

test("communication message renderer keeps Slack plain text as attachment fallback", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Blocking PRs: acme/widgets#42",
    presentation: STATUS_PRESENTATION,
  });

  assert.equal(message.text, undefined);
  assert.equal(message.attachments[0].fallback, "Blocking PRs: acme/widgets#42");
  const blocks = message.attachments[0].blocks;
  assert.match(blocks[0].text.text, /Production deploy is blocked/);
  const renderedMessage = JSON.stringify(blocks);
  assert.match(
    renderedMessage,
    /<https:\/\/example\.test\/acme\/widgets\/pull\/42\|acme\/widgets#42 — Improve deploy controls>/,
  );
});

test("communication message renderer keeps text visible when no rich presentation exists", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Plain command response",
  });

  assert.deepEqual(message, { text: "Plain command response" });
});

test("communication message renderer keeps help text as Slack attachment fallback", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Full help text",
    presentation: {
      title: "Calypso help",
      summary: "Choose a command.",
    },
  });

  assert.equal(message.text, undefined);
  assert.equal(message.attachments[0].fallback, "Full help text");
  assert.match(JSON.stringify(message.attachments[0].blocks), /Choose a command/);
});

test("communication message renderer keeps help text as Teams card fallback", () => {
  const message = buildCommunicationMessage({
    provider: "microsoft_teams",
    text: "Full help text",
    presentation: {
      title: "Calypso help",
      summary: "Choose a command.",
    },
  });

  assert.equal(message.text, undefined);
  assert.equal(message.attachments[0].content.fallbackText, "Full help text");
  assert.match(JSON.stringify(message.attachments[0].content.body), /Choose a command/);
});

test("communication message renderer builds a preview-style Slack status card", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Production is blocked by one required test.",
    presentation: {
      tone: "danger",
      title: "Production readiness",
      status: {
        label: "Blocked",
        detail: "1 required test",
        tone: "danger",
      },
      facts: [
        { label: "Production app", value: "Healthy · 184 ms", tone: "success" },
        { label: "Last deployment", value: "2 hours ago", tone: "info" },
      ],
      factsPosition: "after_sections",
      sections: [{
        layout: "rows",
        title: "Changes since last deploy",
        items: [{
          icon: "🔀",
          title: "#187 Add billing webhooks",
          url: "https://example.test/pull/187",
          status: "Must test",
          statusTone: "warning",
        }],
      }],
      actions: [{
        id: "view_history",
        label: "Deployment history",
        command: "history prod",
      }],
      context: "Monitoring continues automatically.",
    },
  });

  assert.equal(message.blocks, undefined);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].color, "#E01E5A");

  const blocks = message.attachments[0].blocks;
  assert.equal(blocks[0].text.text, "Production readiness");
  assert.match(blocks[1].text.text, /\*Blocked\*  •  1 required test/);

  const changeRow = blocks.find((block) =>
    block.type === "section" && block.fields?.some((field) => field.text.includes("#187")),
  );
  assert.match(changeRow.fields[0].text, /🔀 <https:\/\/example\.test\/pull\/187\|#187 Add billing webhooks>/);
  assert.match(changeRow.fields[1].text, /⚠️ \*Must test\*/);
  const changeRowIndex = blocks.indexOf(changeRow);
  const factsIndex = blocks.findIndex((block) =>
    block.type === "section" && block.fields?.some((field) => field.text.includes("Production app")),
  );
  assert.ok(factsIndex > changeRowIndex);
});

test("communication message renderer preserves Slack actions and context for long row lists", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Long review queue",
    presentation: {
      tone: "info",
      title: "Pull request review queue",
      status: { label: "60 open", detail: "need attention", tone: "warning" },
      sections: Array.from({ length: 3 }, (_section, sectionIndex) => ({
        layout: "rows",
        title: `Age group ${sectionIndex + 1}`,
        items: Array.from({ length: 20 }, (_item, itemIndex) => ({
          title: `PR #${sectionIndex * 20 + itemIndex + 1}`,
          status: "Review requested",
          statusTone: "warning",
        })),
      })),
      actions: [{ id: "refresh", label: "Refresh", command: "reviews" }],
      context: "Queue scope: all open PRs.",
    },
  });

  const blocks = message.attachments[0].blocks;
  assert.equal(blocks.length, 50);
  assert.ok(blocks.some((block) => block.type === "actions"));
  assert.ok(blocks.some((block) =>
    block.type === "context" && block.elements[0].text.includes("Queue scope"),
  ));
  assert.match(JSON.stringify(blocks), /Additional rows were omitted/);
});

test("communication message renderer builds a Teams adaptive card", () => {
  const message = buildCommunicationMessage({
    provider: "microsoft_teams",
    text: "Blocking PRs: acme/widgets#42",
    presentation: { ...STATUS_PRESENTATION, factsPosition: "after_sections" },
  });

  assert.equal(message.text, undefined);
  assert.equal(
    message.attachments[0].contentType,
    "application/vnd.microsoft.card.adaptive",
  );
  assert.equal(
    message.attachments[0].content.fallbackText,
    "Blocking PRs: acme/widgets#42",
  );
  const body = message.attachments[0].content.body;
  const renderedMessage = JSON.stringify(body);
  assert.match(
    renderedMessage,
    /\[acme\/widgets#42 — Improve deploy controls\]\(https:\/\/example\.test\/acme\/widgets\/pull\/42\)/,
  );
  assert.ok(
    body.findIndex((block) => block.type === "FactSet")
      > body.findIndex((block) => block.type === "Container"),
  );
});

test("communication message renderer summarizes oversized item lists", () => {
  const presentation = {
    ...STATUS_PRESENTATION,
    sections: [
      {
        title: "Needs testing",
        items: Array.from({ length: 45 }, (_value, index) => ({
          title: `PR #${index + 1}`,
        })),
      },
    ],
  };
  const message = buildCommunicationMessage({
    provider: "microsoft_teams",
    text: "45 blocking PRs",
    presentation,
  });

  const renderedMessage = JSON.stringify(message.attachments[0].content.body);
  assert.match(renderedMessage, /PR #40/);
  assert.doesNotMatch(renderedMessage, /PR #41/);
  assert.match(renderedMessage, /…and 5 more/);
});

test("communication message renderer maps actions to Slack and Teams", () => {
  const presentation = {
    ...STATUS_PRESENTATION,
    actions: [{
      command: "deploy prod",
      confirm: "Deploy production now?",
      id: "deploy_prod",
      label: "Deploy production",
      style: "primary",
    }],
  };

  const slackMessage = buildCommunicationMessage({
    provider: "slack",
    presentation,
    text: "Ready.",
  });
  const slackAction = slackMessage.attachments[0].blocks
    .find((block) => block.type === "actions").elements[0];
  assert.equal(slackAction.action_id, "calypso:deploy_prod");
  assert.equal(slackAction.value, "deploy prod");
  assert.equal(slackAction.style, "primary");
  assert.match(slackAction.confirm.text.text, /Deploy production now/);

  const teamsMessage = buildCommunicationMessage({
    provider: "microsoft_teams",
    presentation,
    text: "Ready.",
  });
  const actionSet = teamsMessage.attachments[0].content.body.find(
    (block) => block.type === "ActionSet",
  );
  assert.deepEqual(actionSet.actions[0].data, { command: "deploy prod" });
});

test("communication message renderer maps provider-safe toggle tabs", () => {
  const presentation = {
    title: "PR review recap",
    actions: [{
      id: "approved_tab",
      label: "Approved (2)",
      command: "reviews tab:approved",
      toggleTargets: [
        { id: "approved-page-1", isVisible: true },
        { id: "backburner-page-1", isVisible: false },
      ],
    }],
    toggleSections: [{
      id: "approved-page-1",
      title: "Approved, unmerged",
      items: [{ title: "#42 Ship it" }],
      actions: [{
        id: "all_tabs",
        label: "All tabs",
        command: "reviews tab:summary",
        toggleTargets: [{ id: "approved-page-1", isVisible: false }],
      }],
    }],
  };

  const slackMessage = buildCommunicationMessage({
    provider: "slack",
    presentation,
    text: "recap",
  });
  assert.doesNotMatch(JSON.stringify(slackMessage.attachments[0].blocks), /#42 Ship it/);
  const slackAction = slackMessage.attachments[0].blocks.find(
    (block) => block.type === "actions",
  ).elements[0];
  assert.equal(slackAction.value, "reviews tab:approved");

  const teamsMessage = buildCommunicationMessage({
    provider: "microsoft_teams",
    presentation,
    text: "recap",
  });
  const teamsBody = teamsMessage.attachments[0].content.body;
  const hiddenTab = teamsBody.find((block) => block.id === "approved-page-1");
  assert.equal(hiddenTab.isVisible, false);
  assert.match(JSON.stringify(hiddenTab), /#42 Ship it/);
  const teamsTabAction = teamsBody.find((block) => block.type === "ActionSet").actions[0];
  assert.equal(teamsTabAction.type, "Action.ToggleVisibility");
  assert.deepEqual(teamsTabAction.targetElements[0], {
    elementId: "approved-page-1",
    isVisible: true,
  });
});
