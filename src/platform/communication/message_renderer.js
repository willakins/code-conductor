const ADAPTIVE_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";
const MAX_ITEMS_PER_SECTION = 8;
const MAX_ITEMS_PER_PRESENTATION_SECTION = 40;

const TONE_STYLES = {
  danger: {
    icon: "⛔",
    slackColor: "#E01E5A",
    teamsColor: "Attention",
  },
  info: {
    icon: "🚀",
    slackColor: "#36C5F0",
    teamsColor: "Accent",
  },
  neutral: {
    icon: "🎛️",
    slackColor: "#6B7280",
    teamsColor: "Default",
  },
  success: {
    icon: "✅",
    slackColor: "#2EB67D",
    teamsColor: "Good",
  },
  warning: {
    icon: "⚠️",
    slackColor: "#ECB22E",
    teamsColor: "Warning",
  },
};

function buildCommunicationMessage({ provider, text, presentation }) {
  const plainText = String(text || "");
  const payload = { text: plainText };
  const normalizedPresentation = normalizePresentation(presentation);
  if (!normalizedPresentation) {
    return payload;
  }

  if (normalizeProvider(provider) === "microsoft_teams") {
    return {
      attachments: [buildTeamsAdaptiveCard(normalizedPresentation, plainText)],
    };
  }

  const toneStyle = resolveToneStyle(normalizedPresentation.tone);
  return {
    attachments: [{
      color: toneStyle.slackColor,
      fallback: plainText || normalizedPresentation.title,
      blocks: buildSlackBlocks(normalizedPresentation),
    }],
  };
}

function buildSlackBlocks(presentation) {
  const toneStyle = resolveToneStyle(presentation.tone);
  const showHeaderIcon = presentation.showHeaderIcon || !presentation.status;
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${showHeaderIcon ? `${toneStyle.icon} ` : ""}${presentation.title}`.slice(0, 150),
        emoji: true,
      },
    },
  ];

  if (presentation.status) {
    blocks.push(buildSlackStatus(presentation.status));
  }

  if (presentation.summary) {
    blocks.push(buildSlackSection(presentation.summary));
  }

  if (presentation.facts.length > 0 && presentation.factsPosition !== "after_sections") {
    if (presentation.factsSeparator) blocks.push({ type: "divider" });
    blocks.push(buildSlackFactsBlock(presentation.facts));
  }

  for (const section of presentation.sections) {
    if (section.separator) {
      blocks.push({ type: "divider" });
    }
    if (section.layout === "rows") {
      if (section.title || section.text) {
        blocks.push(buildSlackSection(formatSlackSectionText(section, [])));
      }
      blocks.push(...section.items.map(buildSlackRow));
      continue;
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

  if (presentation.facts.length > 0 && presentation.factsPosition === "after_sections") {
    if (presentation.factsSeparator) blocks.push({ type: "divider" });
    blocks.push(buildSlackFactsBlock(presentation.facts));
  }

  const trailingBlocks = [];
  const useCompactFooter = presentation.compactFooter
    && presentation.actions.length === 1
    && presentation.context;
  if (useCompactFooter) {
    trailingBlocks.push({ type: "divider" });
    trailingBlocks.push(buildSlackCompactFooter(
      presentation.context,
      presentation.actions[0],
    ));
  } else if (presentation.actions.length > 0) {
    trailingBlocks.push({
      type: "actions",
      elements: presentation.actions.slice(0, 5).map(buildSlackButton),
    });
  }

  if (presentation.context && !useCompactFooter) {
    trailingBlocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: presentation.context.slice(0, 2000),
        },
      ],
    });
  }

  return fitSlackBlocks(blocks, trailingBlocks);
}

function buildTeamsAdaptiveCard(presentation, fallbackText) {
  const toneStyle = resolveToneStyle(presentation.tone);
  const showHeaderIcon = presentation.showHeaderIcon || !presentation.status;
  const body = [
    {
      type: "TextBlock",
      text: `${showHeaderIcon ? `${toneStyle.icon} ` : ""}${presentation.title}`,
      size: "Large",
      weight: "Bolder",
      color: toneStyle.teamsColor,
      wrap: true,
    },
  ];

  if (presentation.status) {
    const statusStyle = resolveToneStyle(presentation.status.tone);
    body.push({
      type: "TextBlock",
      text: [
        `${presentation.status.showIcon ? `${statusStyle.icon} ` : ""}**${presentation.status.label}**`,
        presentation.status.detail,
      ].filter(Boolean).join("  •  "),
      color: statusStyle.teamsColor,
      weight: "Bolder",
      wrap: true,
      spacing: "Small",
    });
  }

  if (presentation.summary) {
    body.push({
      type: "TextBlock",
      text: convertSlackMarkupToTeams(presentation.summary),
      wrap: true,
      spacing: "Small",
    });
  }

  if (presentation.facts.length > 0 && presentation.factsPosition !== "after_sections") {
    body.push(buildTeamsFactsBlock(presentation.facts));
  }

  for (const section of presentation.sections) {
    body.push(buildTeamsSectionContainer(section));
  }

  for (const section of presentation.toggleSections) {
    body.push(buildTeamsSectionContainer(section, {
      id: section.id,
      isVisible: false,
    }));
  }

  if (presentation.facts.length > 0 && presentation.factsPosition === "after_sections") {
    body.push(buildTeamsFactsBlock(presentation.facts));
  }

  if (presentation.actions.length > 0) {
    body.push({
      type: "ActionSet",
      separator: true,
      actions: presentation.actions.slice(0, 5).map(buildTeamsAction),
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
      ...(fallbackText ? { fallbackText } : {}),
      body,
    },
  };
}

function buildTeamsSectionContainer(section, options = {}) {
  const sectionItems = section.items.map(formatTeamsItem);
  return {
    type: "Container",
    ...(options.id ? { id: options.id } : {}),
    ...(typeof options.isVisible === "boolean" ? { isVisible: options.isVisible } : {}),
    separator: options.id ? true : section.separator,
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
      section.actions?.length > 0
        ? {
            type: "ActionSet",
            actions: section.actions.map(buildTeamsAction),
          }
        : null,
    ].filter(Boolean),
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

function buildSlackStatus(status) {
  const toneStyle = resolveToneStyle(status.tone);
  return buildSlackSection([
    `${status.showIcon ? `${toneStyle.icon} ` : ""}*${status.label}*`,
    status.detail,
  ].filter(Boolean).join("  •  "));
}

function buildSlackFactsBlock(facts) {
  return {
    type: "section",
    fields: facts.slice(0, 10).map((fact) => ({
      type: "mrkdwn",
      text: formatSlackFact(fact).slice(0, 2000),
    })),
  };
}

function buildSlackCompactFooter(context, action) {
  return {
    type: "section",
    text: { type: "mrkdwn", text: context.slice(0, 3000) },
    accessory: buildSlackButton(action),
  };
}

function buildSlackButton(action) {
  return {
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
  };
}

function buildTeamsAction(action) {
  if (action.toggleTargets.length > 0) {
    return {
      type: "Action.ToggleVisibility",
      title: action.label,
      targetElements: action.toggleTargets.map((target) => ({
        elementId: target.id,
        isVisible: target.isVisible,
      })),
    };
  }
  if (action.url) {
    return {
      type: "Action.OpenUrl",
      title: action.label,
      url: action.url,
    };
  }
  return {
    type: "Action.Submit",
    title: action.label,
    data: { command: action.command },
  };
}

function buildTeamsFactsBlock(facts) {
  return {
    type: "FactSet",
    facts: facts.map((fact) => ({
      title: fact.label,
      value: formatTeamsFact(fact),
    })),
    separator: true,
  };
}

function fitSlackBlocks(contentBlocks, trailingBlocks) {
  const maxContentBlockCount = Math.max(50 - trailingBlocks.length, 0);
  if (contentBlocks.length <= maxContentBlockCount) {
    return [...contentBlocks, ...trailingBlocks];
  }

  const omissionNotice = buildSlackSection("_Additional rows were omitted to keep this card actionable._");
  return [
    ...contentBlocks.slice(0, Math.max(maxContentBlockCount - 1, 0)),
    ...(maxContentBlockCount > 0 ? [omissionNotice] : []),
    ...trailingBlocks,
  ].slice(0, 50);
}

function buildSlackRow(item) {
  const title = item.url
    ? `<${sanitizeSlackUrl(item.url)}|${sanitizeSlackLinkLabel(item.title)}>`
    : item.title;
  const statusStyle = resolveToneStyle(item.statusTone);
  const statusIcon = item.showStatusIcon ? `${statusStyle.icon} ` : "";
  const status = item.status ? `${statusIcon}*${item.status}*` : "";
  const secondaryText = [
    item.description ? `_${item.description}_` : "",
    status,
  ].filter(Boolean).join("  ·  ");
  const text = [
    [item.icon, title].filter(Boolean).join(" "),
    secondaryText,
  ].filter(Boolean).join("\n");

  return {
    type: "section",
    text: { type: "mrkdwn", text: text.slice(0, 3000) },
  };
}

function formatSlackFact(fact) {
  const tonePrefix = fact.tone ? `${resolveToneStyle(fact.tone).icon} ` : "";
  return `*${fact.label}*\n${tonePrefix}${fact.value}`;
}

function formatTeamsFact(fact) {
  const tonePrefix = fact.tone ? `${resolveToneStyle(fact.tone).icon} ` : "";
  return `${tonePrefix}${convertSlackMarkupToTeams(fact.value)}`;
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
  const titleWithIcon = [item.icon, title].filter(Boolean).join(" ");
  const status = item.status
    ? `${item.showStatusIcon ? `${resolveToneStyle(item.statusTone).icon} ` : ""}${item.status}`
    : "";
  if (item.inlineDescription && item.description) {
    return `• ${titleWithIcon} ${item.description}${status ? ` · ${status}` : ""}`;
  }
  return [
    `• ${titleWithIcon}${status ? ` — ${status}` : ""}`,
    item.description ? `  ${item.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTeamsItem(item) {
  const title = item.url
    ? `[${escapeTeamsLinkLabel(item.title)}](${item.url})`
    : item.title;
  const titleWithIcon = [item.icon, title].filter(Boolean).join(" ");
  const status = item.status
    ? `${item.showStatusIcon ? `${resolveToneStyle(item.statusTone).icon} ` : ""}${item.status}`
    : "";
  if (item.inlineDescription && item.description) {
    return `• ${titleWithIcon} ${convertSlackMarkupToTeams(item.description)}${
      status ? ` · ${status}` : ""
    }`;
  }
  return [
    `• ${titleWithIcon}${status ? ` — ${status}` : ""}`,
    item.description ? `  ${convertSlackMarkupToTeams(item.description)}` : "",
  ]
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
    compactFooter: presentation.compactFooter === true,
    factsSeparator: presentation.factsSeparator === true,
    factsPosition: normalizeText(presentation.factsPosition) === "after_sections"
      ? "after_sections"
      : "before_sections",
    showHeaderIcon: presentation.showHeaderIcon === true,
    summary: normalizeText(presentation.summary),
    status: normalizePresentationStatus(presentation.status),
    context: normalizeText(presentation.context),
    facts: (Array.isArray(presentation.facts) ? presentation.facts : [])
      .map((fact) => ({
        label: normalizeText(fact?.label),
        tone: normalizeText(fact?.tone),
        value: normalizeText(fact?.value),
      }))
      .filter((fact) => fact.label && fact.value),
    actions: normalizePresentationActions(presentation.actions),
    sections: (Array.isArray(presentation.sections) ? presentation.sections : [])
      .map((section) => ({
        layout: normalizeText(section?.layout) === "rows" ? "rows" : "list",
        title: normalizeText(section?.title),
        text: normalizeText(section?.text),
        separator: section?.separator !== false,
        items: normalizePresentationItems(section?.items),
      }))
      .filter((section) => section.title || section.text || section.items.length > 0),
    toggleSections: (Array.isArray(presentation.toggleSections)
      ? presentation.toggleSections
      : [])
      .map((section) => ({
        id: normalizeText(section?.id),
        title: normalizeText(section?.title),
        text: normalizeText(section?.text),
        actions: normalizePresentationActions(section?.actions),
        items: normalizePresentationItems(section?.items),
      }))
      .filter((section) => section.id && (section.title || section.text || section.items.length > 0)),
  };
}

function normalizePresentationActions(actions) {
  return (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({
      command: normalizeText(action?.command),
      confirm: normalizeText(action?.confirm),
      id: normalizeText(action?.id) || `action_${index}`,
      label: normalizeText(action?.label),
      style: normalizeText(action?.style),
      toggleTargets: (Array.isArray(action?.toggleTargets) ? action.toggleTargets : [])
        .map((target) => ({
          id: normalizeText(target?.id),
          isVisible: target?.isVisible === true,
        }))
        .filter((target) => target.id),
      url: normalizeText(action?.url),
    }))
    .filter((action) =>
      action.label && (action.command || action.url || action.toggleTargets.length > 0));
}

function normalizePresentationStatus(status) {
  if (!status || typeof status !== "object") {
    return null;
  }

  const label = normalizeText(status.label);
  if (!label) {
    return null;
  }

  return {
    detail: normalizeText(status.detail),
    label,
    showIcon: status.showIcon !== false,
    tone: normalizeText(status.tone) || "info",
  };
}

function normalizePresentationItems(items) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      icon: normalizeText(item?.icon),
      title: normalizeText(item?.title),
      url: normalizeText(item?.url),
      description: normalizeText(item?.description),
      inlineDescription: item?.inlineDescription === true,
      status: normalizeText(item?.status),
      showStatusIcon: item?.showStatusIcon !== false,
      statusTone: normalizeText(item?.statusTone) || "neutral",
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
