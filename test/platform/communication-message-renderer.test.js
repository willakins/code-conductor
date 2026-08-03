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

test("communication message renderer builds Slack blocks with plain-text fallback", () => {
  const message = buildCommunicationMessage({
    provider: "slack",
    text: "Blocking PRs: acme/widgets#42",
    presentation: STATUS_PRESENTATION,
  });

  assert.equal(message.text, "Blocking PRs: acme/widgets#42");
  assert.match(message.blocks[0].text.text, /Production deploy is blocked/);
  const renderedMessage = JSON.stringify(message.blocks);
  assert.match(
    renderedMessage,
    /<https:\/\/example\.test\/acme\/widgets\/pull\/42\|acme\/widgets#42 — Improve deploy controls>/,
  );
});

test("communication message renderer builds a Teams adaptive card", () => {
  const message = buildCommunicationMessage({
    provider: "microsoft_teams",
    text: "Blocking PRs: acme/widgets#42",
    presentation: STATUS_PRESENTATION,
  });

  assert.equal(message.text, "Blocking PRs: acme/widgets#42");
  assert.equal(
    message.attachments[0].contentType,
    "application/vnd.microsoft.card.adaptive",
  );
  const renderedMessage = JSON.stringify(message.attachments[0].content.body);
  assert.match(
    renderedMessage,
    /\[acme\/widgets#42 — Improve deploy controls\]\(https:\/\/example\.test\/acme\/widgets\/pull\/42\)/,
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
  const slackAction = slackMessage.blocks.find((block) => block.type === "actions").elements[0];
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
