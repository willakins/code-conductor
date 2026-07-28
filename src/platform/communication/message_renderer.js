const ADAPTIVE_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";
const MAX_ITEMS_PER_SECTION = 8;
const MAX_ITEMS_PER_PRESENTATION_SECTION = 40;

const TONE_STYLES = {
  danger: {
    icon: "⛔",
    teamsColor: "Attention",
  },
  info: {
    icon: "🚀",
    teamsColor: "Accent",
  },
  neutral: {
    icon: "🌊",
    teamsColor: "Default",
  },
  success: {
    icon: "✅",
    teamsColor: "Good",
  },
  warning: {
    icon: "⚠️",
    teamsColor: "Warning",
  },
};

function buildCommunicationMessage({ provider, text, presentation }) {
  const payload = {
    text: String(text || ""),
  };
  const normalizedPresentation = normalizePresentation(presentation);
  if (!normalizedPresentation) {
    return payload;
  }

  if (normalizeProvider(provider) === "microsoft_teams") {
    return {
      ...payload,
      attachments: [buildTeamsAdaptiveCard(normalizedPresentation)],
    };
  }

  return {
    ...payload,
    blocks: buildSlackBlocks(normalizedPresentation),
  };
}

function buildSlackBlocks(presentation) {
  const toneStyle = resolveToneStyle(presentation.tone);
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${toneStyle.icon} ${presentation.title}`.slice(0, 150),
        emoji: true,
      },
    },
  ];

  if (presentation.summary) {
    blocks.push(buildSlackSection(presentation.summary));
  }

  if (presentation.facts.length > 0) {
    blocks.push({
      type: "section",
      fields: presentation.facts.slice(0, 10).map((fact) => ({
        type: "mrkdwn",
        text: `*${fact.label}*\n${fact.value}`.slice(0, 2000),
      })),
    });
  }

  for (const section of presentation.sections) {
    if (section.separator) {
      blocks.push({ type: "divider" });
    }
    const itemGroups = chunk(section.items, MAX_ITEMS_PER_SECTION);
    if (itemGroups.length === 0) {
      blocks.push(buildSlackSection(formatSlackSectionText(section, [])));
      continue;
    }

    itemGroups.forEach((items, index) => {
      blocks.push(
        buildSlackSection(
          formatSlackSectionText(
            {
              ...section,
              title: index === 0 ? section.title : "",
              text: index === 0 ? section.text : "",
            },
            items,
          ),
        ),
      );
    });
  }

  if (presentation.actions.length > 0) {
    blocks.push({
      type: "actions",
      elements: presentation.actions.slice(0, 5).map((action) => ({
        type: "button",
        action_id: `calypso:${action.id}`.slice(0, 255),
        text: { type: "plain_text", text: action.label.slice(0, 75), emoji: true },
        ...(action.url ? { url: action.url } : { value: action.command }),
        ...(action.style === "primary" || action.style === "danger"
          ? { style: action.style }
          : {}),
        ...(action.confirm
          ? {
              confirm: {
                title: { type: "plain_text", text: "Confirm action" },
                text: { type: "mrkdwn", text: action.confirm },
                confirm: { type: "plain_text", text: "Continue" },
                deny: { type: "plain_text", text: "Cancel" },
              },
            }
          : {}),
      })),
    });
  }

  if (presentation.context) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: presentation.context.slice(0, 2000),
        },
      ],
    });
  }

  return blocks.slice(0, 50);
}

function buildTeamsAdaptiveCard(presentation) {
  const toneStyle = resolveToneStyle(presentation.tone);
  const body = [
    {
      type: "TextBlock",
      text: `${toneStyle.icon} ${presentation.title}`,
      size: "Large",
      weight: "Bolder",
      color: toneStyle.teamsColor,
      wrap: true,
    },
  ];

  if (presentation.summary) {
    body.push({
      type: "TextBlock",
      text: convertSlackMarkupToTeams(presentation.summary),
      wrap: true,
      spacing: "Small",
    });
  }

  if (presentation.facts.length > 0) {
    body.push({
      type: "FactSet",
      facts: presentation.facts.map((fact) => ({
        title: fact.label,
        value: convertSlackMarkupToTeams(fact.value),
      })),
      separator: true,
    });
  }

  for (const section of presentation.sections) {
    const sectionItems = section.items.map(formatTeamsItem);
    body.push({
      type: "Container",
      separator: section.separator,
      items: [
        section.title
          ? {
              type: "TextBlock",
              text: section.title,
              weight: "Bolder",
              wrap: true,
            }
          : null,
        section.text
          ? {
              type: "TextBlock",
              text: convertSlackMarkupToTeams(section.text),
              wrap: true,
              spacing: "Small",
            }
          : null,
        ...sectionItems.map((text) => ({
          type: "TextBlock",
          text,
          wrap: true,
          spacing: "Small",
        })),
      ].filter(Boolean),
    });
  }

  if (presentation.actions.length > 0) {
    body.push({
      type: "ActionSet",
      separator: true,
      actions: presentation.actions.slice(0, 5).map((action) =>
        action.url
          ? {
              type: "Action.OpenUrl",
              title: action.label,
              url: action.url,
            }
          : {
              type: "Action.Submit",
              title: action.label,
              data: { command: action.command },
            }),
    });
  }

  if (presentation.context) {
    body.push({
      type: "TextBlock",
      text: convertSlackMarkupToTeams(presentation.context),
      isSubtle: true,
      size: "Small",
      wrap: true,
      separator: true,
    });
  }

  return {
    contentType: ADAPTIVE_CARD_CONTENT_TYPE,
    content: {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.4",
      body,
    },
  };
}

function buildSlackSection(text) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: String(text || "").slice(0, 3000),
    },
  };
}

function formatSlackSectionText(section, items) {
  return [
    section.title ? `*${section.title}*` : "",
    section.text || "",
    ...items.map(formatSlackItem),
  ].filter(Boolean).join("\n");
}

function formatSlackItem(item) {
  const title = item.url
    ? `<${sanitizeSlackUrl(item.url)}|${sanitizeSlackLinkLabel(item.title)}>`
    : item.title;
  return [`• ${title}`, item.description ? `  ${item.description}` : ""]
    .filter(Boolean)
    .join("\n");
}

function formatTeamsItem(item) {
  const title = item.url
    ? `[${escapeTeamsLinkLabel(item.title)}](${item.url})`
    : item.title;
  return [`• ${title}`, item.description ? `  ${convertSlackMarkupToTeams(item.description)}` : ""]
    .filter(Boolean)
    .join("\n");
}

function normalizePresentation(presentation) {
  if (!presentation || typeof presentation !== "object") {
    return null;
  }

  const title = normalizeText(presentation.title);
  if (!title) {
    return null;
  }

  return {
    title,
    tone: normalizeText(presentation.tone) || "info",
    summary: normalizeText(presentation.summary),
    context: normalizeText(presentation.context),
    facts: (Array.isArray(presentation.facts) ? presentation.facts : [])
      .map((fact) => ({
        label: normalizeText(fact?.label),
        value: normalizeText(fact?.value),
      }))
      .filter((fact) => fact.label && fact.value),
    actions: (Array.isArray(presentation.actions) ? presentation.actions : [])
      .map((action, index) => ({
        command: normalizeText(action?.command),
        confirm: normalizeText(action?.confirm),
        id: normalizeText(action?.id) || `action_${index}`,
        label: normalizeText(action?.label),
        style: normalizeText(action?.style),
        url: normalizeText(action?.url),
      }))
      .filter((action) => action.label && (action.command || action.url)),
    sections: (Array.isArray(presentation.sections) ? presentation.sections : [])
      .map((section) => ({
        title: normalizeText(section?.title),
        text: normalizeText(section?.text),
        separator: section?.separator !== false,
        items: normalizePresentationItems(section?.items),
      }))
      .filter((section) => section.title || section.text || section.items.length > 0),
  };
}

function normalizePresentationItems(items) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      title: normalizeText(item?.title),
      url: normalizeText(item?.url),
      description: normalizeText(item?.description),
    }))
    .filter((item) => item.title);
  const omittedItemCount = normalizedItems.length - MAX_ITEMS_PER_PRESENTATION_SECTION;
  if (omittedItemCount <= 0) {
    return normalizedItems;
  }

  return [
    ...normalizedItems.slice(0, MAX_ITEMS_PER_PRESENTATION_SECTION),
    {
      title: `…and ${omittedItemCount} more`,
      url: "",
      description: "Additional items were omitted from this summary.",
    },
  ];
}

function convertSlackMarkupToTeams(value) {
  return String(value || "")
    .replace(/<([^>|]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<@([^>]+)>/g, "@$1")
    .replace(/<!here>/g, "@here");
}

function resolveToneStyle(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.info;
}

function normalizeProvider(provider) {
  return String(provider || "slack").trim().toLowerCase();
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function sanitizeSlackUrl(value) {
  return String(value || "").replace(/[|>]/g, "");
}

function sanitizeSlackLinkLabel(value) {
  return String(value || "").replace(/[|>]/g, "");
}

function escapeTeamsLinkLabel(value) {
  return String(value || "").replace(/[[\]]/g, "");
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

module.exports = {
  buildCommunicationMessage,
};
