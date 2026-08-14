const { formatReviewRecencyLabel } = require("../shared/timeframes");
const {
  REVIEW_RECAP_CATEGORY_KEYS,
  categorizeReviewRecapPullRequests,
  readReviewPullRequestLastModifiedAt,
  readReviewPullRequestLastModifiedTimestamp,
} = require("../shared/review_recap");

const TIMESTAMP_STYLES = {
  human: "human",
  legacyUtc: "legacy_utc",
};

const REVIEW_RECAP_ITEMS_PER_TAB = 8;

const REVIEW_RECAP_SECTION_DEFINITIONS = Object.freeze([
  {
    key: REVIEW_RECAP_CATEGORY_KEYS.approved,
    title: "Approved, unmerged",
    actionLabel: "Approved",
    icon: "✅",
    status: "Ready to merge",
    statusTone: "success",
  },
  {
    key: REVIEW_RECAP_CATEGORY_KEYS.waitingHuman,
    title: "Waiting on human approval",
    actionLabel: "Human approval",
    icon: "👤",
    status: "Human review needed",
    statusTone: "warning",
  },
  {
    key: REVIEW_RECAP_CATEGORY_KEYS.unapproved,
    title: "Unapproved",
    actionLabel: "Unapproved",
    icon: "",
    status: "Review needed",
    statusTone: "warning",
  },
  {
    key: REVIEW_RECAP_CATEGORY_KEYS.backburner,
    title: "Backburner",
    actionLabel: "Backburner",
    icon: "🗄️",
    status: "Inactive 30+ days",
    statusTone: "neutral",
  },
]);

const UTC_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatReviewListHeader(label) {
  const normalizedLabel = String(label || "").trim();
  if (normalizedLabel === "") {
    return ":";
  }

  return normalizedLabel.endsWith(":") ? normalizedLabel : `${normalizedLabel}:`;
}

function formatReviewListItem(summary, details = null) {
  const normalizedSummary = String(summary || "").trim();
  const headerLine = normalizedSummary === "" ? "•" : `• ${normalizedSummary}`;
  if (details === null || details === undefined) {
    return headerLine;
  }

  const detailLines = (Array.isArray(details) ? details : [details])
    .flatMap((line) => String(line || "").split("\n"))
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (detailLines.length === 0) {
    return headerLine;
  }

  return [
    headerLine,
    ...detailLines.map((line) => `  ${line}`),
  ].join("\n");
}

function formatStatusResponse({ lastDeployAt, blockers, timeFormat, timeZone }) {
  const lastDeploymentTimestamp = formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone });
  const hasBlockingPullRequests = Array.isArray(blockers) && blockers.length > 0;

  if (!hasBlockingPullRequests) {
    return buildNoBlockersMessage(lastDeploymentTimestamp);
  }

  return buildBlockersMessage(lastDeploymentTimestamp, blockers);
}

function formatReviewRecapResponse({
  pullRequests,
  waitingPullRequests,
  reviewScope,
  recencyValue,
  recencyUnit,
  timeZone,
  now = new Date(),
  selectedTabKey = null,
  page = 1,
}) {
  const effectivePullRequests = Array.isArray(pullRequests)
    ? pullRequests
    : waitingPullRequests;
  const inScopeLabel = formatReviewRecapScopeLabel({
    reviewScope,
    recencyValue,
    recencyUnit,
  });
  const selectedTab = REVIEW_RECAP_SECTION_DEFINITIONS.find(
    (definition) => definition.key === selectedTabKey,
  );
  const header = selectedTab
    ? `*PR Review Recap — ${selectedTab.title}*`
    : `*PR Review Recap — ${inScopeLabel}*`;
  const hasPullRequests = Array.isArray(effectivePullRequests) && effectivePullRequests.length > 0;

  if (!hasPullRequests) {
    return [header, formatReviewListItem("No open non-draft pull requests in scope.")].join("\n");
  }

  const sections = buildReviewRecapSections(effectivePullRequests, { now });
  const displayedSections = selectedTab
    ? sections
      .filter((section) => section.key === selectedTab.key)
      .map((section) => ({
        ...section,
        totalPullRequestCount: section.pullRequests.length,
        pullRequests: paginatePullRequests(section.pullRequests, page).pullRequests,
      }))
    : sections;
  if (selectedTab && displayedSections.length === 0) {
    return [header, formatReviewListItem("No pull requests in this tab.")].join("\n");
  }
  return [
    header,
    ...displayedSections.flatMap((section) => [
      "",
      `*${[section.icon, section.title].filter(Boolean).join(" ")} · ${
        section.totalPullRequestCount || section.pullRequests.length
      }*`,
      ...section.pullRequests.map((pullRequest) =>
        formatReviewRecapPullRequestLine({ pullRequest, timeZone }),
      ),
    ]),
  ].join("\n");
}

function buildReviewRecapPresentation({
  pullRequests,
  waitingPullRequests,
  reviewScope,
  recencyValue,
  recencyUnit,
  timeZone,
  now = new Date(),
  selectedTabKey = null,
  page = 1,
}) {
  const effectivePullRequests = Array.isArray(pullRequests)
    ? pullRequests
    : waitingPullRequests;
  const normalizedPullRequests = Array.isArray(effectivePullRequests)
    ? effectivePullRequests
    : [];
  const sections = buildReviewRecapSections(normalizedPullRequests, { now });
  const activeCount = sections
    .filter((section) => section.key !== REVIEW_RECAP_CATEGORY_KEYS.backburner)
    .reduce((count, section) => count + section.pullRequests.length, 0);
  const backburnerCount = sections.find(
    (section) => section.key === REVIEW_RECAP_CATEGORY_KEYS.backburner,
  )
    ?.pullRequests.length || 0;
  const selectedDefinition = REVIEW_RECAP_SECTION_DEFINITIONS.find(
    (definition) => definition.key === selectedTabKey,
  );
  const selectedSection = selectedDefinition
    ? sections.find((section) => section.key === selectedTabKey)
      || { ...selectedDefinition, pullRequests: [] }
    : null;
  const selectedPage = selectedSection
    ? paginatePullRequests(selectedSection.pullRequests, page)
    : null;
  const toggleSections = selectedTabKey
    ? []
    : buildReviewRecapToggleSections({ sections, timeZone });

  return {
    tone: activeCount > 0 ? "warning" : "success",
    title: "PR review recap",
    status: {
      label: `${normalizedPullRequests.length} open`,
      detail: `${activeCount} active · ${backburnerCount} backburner`,
      showIcon: activeCount === 0,
      tone: activeCount > 0 ? "warning" : "success",
    },
    facts: REVIEW_RECAP_SECTION_DEFINITIONS.map((definition) => ({
      label: [definition.icon, definition.title].filter(Boolean).join(" "),
      value: String(
        sections.find((section) => section.key === definition.key)?.pullRequests.length || 0,
      ),
    })),
    sections: selectedSection
      ? [{
          layout: "rows",
          title: `${[selectedSection.icon, selectedSection.title]
            .filter(Boolean)
            .join(" ")}  ·  ${selectedSection.pullRequests.length}`,
          items: selectedPage.pullRequests.map((pullRequest) =>
            buildReviewRecapPresentationItem({
              pullRequest,
              section: selectedSection,
              timeZone,
            })),
        }]
      : [],
    actions: buildReviewRecapTabActions({
      page: selectedPage?.page || 1,
      pageCount: selectedPage?.pageCount || 1,
      sections,
      selectedTabKey,
      toggleSections,
    }),
    context: buildReviewRecapContext({
      page: selectedPage?.page || 1,
      pageCount: selectedPage?.pageCount || 1,
      recencyUnit,
      recencyValue,
      reviewScope,
      selectedSection,
    }),
    toggleSections,
  };
}

function buildReviewRecapTabActions({
  page,
  pageCount,
  sections,
  selectedTabKey,
  toggleSections,
}) {
  if (selectedTabKey) {
    return [
      { id: "review_recap_summary", label: "All tabs", command: "reviews tab:summary" },
      ...(page > 1
        ? [{
            id: "review_recap_previous",
            label: "Previous",
            command: `reviews tab:${selectedTabKey} page:${page - 1}`,
          }]
        : []),
      ...(page < pageCount
        ? [{
            id: "review_recap_next",
            label: "Next",
            command: `reviews tab:${selectedTabKey} page:${page + 1}`,
            style: "primary",
          }]
        : []),
    ];
  }

  return REVIEW_RECAP_SECTION_DEFINITIONS.map((definition) => ({
    id: `review_recap_${definition.key}`,
    label: `${definition.actionLabel} (${sections.find(
      (section) => section.key === definition.key,
    )?.pullRequests.length || 0})`,
    command: `reviews tab:${definition.key}`,
    toggleTargets: buildReviewRecapToggleTargets(
      toggleSections,
      buildReviewRecapToggleSectionId(definition.key, 1),
    ),
  }));
}

function buildReviewRecapToggleSections({ sections, timeZone }) {
  const categorySections = REVIEW_RECAP_SECTION_DEFINITIONS.map((definition) =>
    sections.find((section) => section.key === definition.key)
      || { ...definition, pullRequests: [] });
  const toggleSections = categorySections.flatMap((section) => {
    const pageCount = Math.max(
      Math.ceil(section.pullRequests.length / REVIEW_RECAP_ITEMS_PER_TAB),
      1,
    );
    return Array.from({ length: pageCount }, (_value, pageIndex) => {
      const currentPage = pageIndex + 1;
      const paginatedPullRequests = paginatePullRequests(
        section.pullRequests,
        currentPage,
      ).pullRequests;
      return {
        id: buildReviewRecapToggleSectionId(section.key, currentPage),
        categoryKey: section.key,
        page: currentPage,
        pageCount,
        title: `${section.icon} ${section.title}  ·  ${section.pullRequests.length}`,
        text: paginatedPullRequests.length === 0 ? "No pull requests in this tab." : "",
        items: paginatedPullRequests.map((pullRequest) =>
          buildReviewRecapPresentationItem({ pullRequest, section, timeZone })),
      };
    });
  });

  return toggleSections.map((section) => ({
    ...section,
    actions: [
      {
        id: `${section.id}_all_tabs`,
        label: "All tabs",
        command: "reviews tab:summary",
        toggleTargets: [{ id: section.id, isVisible: false }],
      },
      ...(section.page > 1
        ? [{
            id: `${section.id}_previous`,
            label: "Previous",
            command: `reviews tab:${section.categoryKey} page:${section.page - 1}`,
            toggleTargets: buildReviewRecapToggleTransitionTargets(
              section.id,
              buildReviewRecapToggleSectionId(section.categoryKey, section.page - 1),
            ),
          }]
        : []),
      ...(section.page < section.pageCount
        ? [{
            id: `${section.id}_next`,
            label: "Next",
            command: `reviews tab:${section.categoryKey} page:${section.page + 1}`,
            toggleTargets: buildReviewRecapToggleTransitionTargets(
              section.id,
              buildReviewRecapToggleSectionId(section.categoryKey, section.page + 1),
            ),
          }]
        : []),
    ],
  }));
}

function buildReviewRecapToggleTargets(toggleSections, visibleSectionId) {
  return toggleSections.map((section) => ({
    id: section.id,
    isVisible: section.id === visibleSectionId,
  }));
}

function buildReviewRecapToggleTransitionTargets(currentSectionId, nextSectionId) {
  return [
    { id: currentSectionId, isVisible: false },
    { id: nextSectionId, isVisible: true },
  ];
}

function buildReviewRecapToggleSectionId(categoryKey, page) {
  return `review-recap-${categoryKey}-page-${page}`;
}

function buildReviewRecapContext({
  page,
  pageCount,
  recencyUnit,
  recencyValue,
  reviewScope,
  selectedSection,
}) {
  return [
    `Scope: ${formatReviewRecapScopeLabel({ reviewScope, recencyValue, recencyUnit })}.`,
    selectedSection
      ? `${selectedSection.title} · page ${page} of ${pageCount}.`
      : "Choose a tab to view its pull requests.",
    "Backburner means last modified more than 30 days ago.",
  ].join("  ·  ");
}

function paginatePullRequests(pullRequests, requestedPage) {
  const pageCount = Math.max(
    Math.ceil(pullRequests.length / REVIEW_RECAP_ITEMS_PER_TAB),
    1,
  );
  const normalizedPage = Math.min(normalizePositiveInteger(requestedPage), pageCount);
  const startIndex = (normalizedPage - 1) * REVIEW_RECAP_ITEMS_PER_TAB;
  return {
    page: normalizedPage,
    pageCount,
    pullRequests: pullRequests.slice(startIndex, startIndex + REVIEW_RECAP_ITEMS_PER_TAB),
  };
}

function normalizePositiveInteger(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function buildReviewRecapSections(pullRequests, { now = new Date() } = {}) {
  const pullRequestsBySectionKey = categorizeReviewRecapPullRequests({ pullRequests, now });

  return REVIEW_RECAP_SECTION_DEFINITIONS
    .map((definition) => ({
      ...definition,
      pullRequests: sortPullRequestsByMostRecent(
        pullRequestsBySectionKey[definition.key],
      ),
    }))
    .filter((section) => section.pullRequests.length > 0);
}

function sortPullRequestsByMostRecent(pullRequests) {
  return [...(Array.isArray(pullRequests) ? pullRequests : [])].sort((left, right) => {
    const leftTimestamp = readReviewPullRequestLastModifiedTimestamp(left);
    const rightTimestamp = readReviewPullRequestLastModifiedTimestamp(right);
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    const leftPrNumber = Number(left?.pr_number);
    const rightPrNumber = Number(right?.pr_number);
    const normalizedLeftPrNumber = Number.isFinite(leftPrNumber) ? leftPrNumber : -Infinity;
    const normalizedRightPrNumber = Number.isFinite(rightPrNumber) ? rightPrNumber : -Infinity;
    return normalizedRightPrNumber - normalizedLeftPrNumber;
  });
}

function formatReviewPullRequestLine({ pullRequest, timeZone }) {
  const pullRequestTitle = pullRequest.title || "(no title)";
  const pullRequestLink = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
    display: "number",
  });
  const lastModifiedAt = readReviewPullRequestLastModifiedAt(pullRequest);
  const formattedLastModified = lastModifiedAt
    ? formatDateWithTimezone(lastModifiedAt, timeZone || "America/New_York")
    : "unknown";

  return formatReviewListItem(
    `${pullRequestLink} - *${pullRequestTitle}*`,
    [
      `author: ${pullRequest.author_login || "unknown"}`,
      `review: ${formatReviewStateLabel(pullRequest.review_state)}`,
      `codex: ${pullRequest?.codex_approved === true ? "approved" : "not approved"}`,
      `Last modified: ${formattedLastModified}`,
    ].join(" | "),
  );
}

function formatReviewRecapPullRequestLine({ pullRequest, timeZone }) {
  const pullRequestTitle = pullRequest.title || "(no title)";
  const pullRequestLink = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
    display: "number",
  });
  return formatReviewListItem(
    `${pullRequestLink} — *${pullRequestTitle}*`,
    `by ${pullRequest.author_login || "unknown"} · modified ${formatReviewPullRequestModifiedDate({
      pullRequest,
      timeZone,
    })}`,
  );
}

function buildReviewRecapPresentationItem({ pullRequest, section, timeZone }) {
  const hasChangesRequested = String(pullRequest?.review_state || "").toLowerCase().trim()
    === "changes_requested";
  return {
    title: `#${pullRequest.pr_number}  ${pullRequest.title || "(untitled)"}`,
    url: pullRequest.url || "",
    description: `by ${pullRequest.author_login || "unknown"} · modified ${formatReviewPullRequestModifiedDate({
      pullRequest,
      timeZone,
    })}`,
    showStatusIcon: hasChangesRequested || section.statusTone !== "warning",
    status: hasChangesRequested ? "Changes requested" : section.status,
    statusTone: hasChangesRequested ? "danger" : section.statusTone,
  };
}

function formatReviewPullRequestModifiedDate({ pullRequest, timeZone }) {
  const lastModifiedAt = readReviewPullRequestLastModifiedAt(pullRequest);
  return lastModifiedAt
    ? formatDateWithTimezone(lastModifiedAt, timeZone || "America/New_York")
    : "unknown";
}

function formatReviewStateLabel(reviewState) {
  const normalizedReviewState = String(reviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes requested";
  }
  if (normalizedReviewState === "waiting") {
    return "waiting";
  }

  return "unknown";
}

function formatReviewRecapScopeLabel({ reviewScope, recencyValue, recencyUnit }) {
  const normalizedScope = String(reviewScope || "").toLowerCase().trim();
  if (normalizedScope === "day") {
    return "last day";
  }
  if (normalizedScope === "week") {
    return "last week";
  }
  if (normalizedScope === "month") {
    return "last month";
  }
  if (normalizedScope === "legacy") {
    const recencyLabel = formatReviewRecencyLabel(recencyValue, recencyUnit);
    return `last ${recencyLabel}`;
  }

  return "all open non-draft PRs";
}

function formatPullRequestReviewIndicators(pullRequest) {
  return [
    formatDraftIndicator(pullRequest?.is_draft),
    formatCodexApprovalIndicator(pullRequest),
  ].join(" | ");
}

function formatDraftIndicator(isDraft) {
  return isDraft ? "Draft: Yes" : "Draft: No";
}

function formatCodexApprovalIndicator(pullRequest) {
  const isCodexApproved = pullRequest?.codex_approved === true;
  return isCodexApproved ? "Codex Approved: Yes" : "Codex Approved: No";
}

function buildNoBlockersMessage(lastDeploymentTimestamp) {
  return `No blockers since last prod deploy (${lastDeploymentTimestamp}).`;
}

function buildBlockersMessage(lastDeploymentTimestamp, blockers) {
  return [
    `Blocking PRs since last prod deploy (${lastDeploymentTimestamp}):`,
    ...blockers.map(formatBlockingPullRequestLine),
  ].join("\n");
}

function formatBlockingPullRequestLine(pullRequest) {
  const pullRequestReference = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
  });
  const pullRequestTitleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return `• ${pullRequestReference} (${pullRequest.status})${pullRequestTitleSuffix}`;
}

function formatPullRequestReference({ repo, prNumber, url, display = "full" }) {
  const normalizedRepo = String(repo || "").trim();
  const normalizedPrNumber = Number.isFinite(Number(prNumber)) ? Number(prNumber) : String(prNumber || "");
  const referenceLabel =
    display === "number"
      ? `#${normalizedPrNumber}`
      : `${normalizedRepo}#${normalizedPrNumber}`;
  if (!url) {
    return referenceLabel;
  }

  return `<${url}|${referenceLabel}>`;
}

function formatTimestampWithTimezone(value, options = {}) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  const style = options.style || TIMESTAMP_STYLES.human;
  if (style === TIMESTAMP_STYLES.legacyUtc) {
    return formatTimestampAsUtcLegacyFromParsedDate(parsedDate);
  }

  const timeZone = options.timeZone || "America/New_York";
  return formatTimestampAsHumanFromParsedDate(parsedDate, timeZone);
}

function formatTimestampByTimeFormat(value, options = {}) {
  const normalizedTimeFormat = String(options.timeFormat || "").toLowerCase().trim();
  if (normalizedTimeFormat === "long") {
    return formatTimestampWithTimezone(value, {
      style: TIMESTAMP_STYLES.legacyUtc,
    });
  }

  return formatTimestampWithTimezone(value, {
    style: TIMESTAMP_STYLES.human,
    timeZone: options.timeZone || "America/New_York",
  });
}

function isValidTimeZone(timeZone) {
  const candidateTimeZone = String(timeZone || "").trim();
  if (candidateTimeZone === "") {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidateTimeZone });
    return true;
  } catch (_error) {
    return false;
  }
}

function formatTimestampAsUtcLegacy(value) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  return formatTimestampAsUtcLegacyFromParsedDate(parsedDate);
}

function formatTimestampAsHumanFromParsedDate(parsedDate, timeZone) {
  const timestampParts = readDateTimeParts(parsedDate, timeZone);
  const dayOfMonth = Number(timestampParts.day);
  const ordinalDay = `${dayOfMonth}${readOrdinalSuffix(dayOfMonth)}`;
  const meridiem = (timestampParts.dayPeriod || "").toUpperCase();

  return [
    "on",
    `${timestampParts.month} ${ordinalDay},`,
    `${timestampParts.year}`,
    "at",
    `${timestampParts.hour}:${timestampParts.minute}`,
    meridiem,
    timestampParts.timeZoneName,
  ].join(" ");
}

function formatTimestampAsUtcLegacyFromParsedDate(parsedDate) {
  const year = parsedDate.getUTCFullYear();
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getUTCDate()).padStart(2, "0");
  const hour = String(parsedDate.getUTCHours()).padStart(2, "0");
  const minute = String(parsedDate.getUTCMinutes()).padStart(2, "0");
  const second = String(parsedDate.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
}

function formatDateWithTimezone(value, timeZone) {
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return String(value);
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
    return formatter.format(parsedDate);
  } catch (_error) {
    return formatDateWithTimezone(parsedDate, "UTC");
  }
}

function readDateTimeParts(parsedDate, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });

    const parts = formatter.formatToParts(parsedDate);
    const partsByType = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        partsByType[part.type] = part.value;
      }
    }

    return {
      month: partsByType.month,
      day: partsByType.day,
      year: partsByType.year,
      hour: partsByType.hour,
      minute: partsByType.minute,
      dayPeriod: partsByType.dayPeriod,
      timeZoneName: partsByType.timeZoneName || "UTC",
    };
  } catch (_error) {
    if (timeZone !== "UTC") {
      return readDateTimeParts(parsedDate, "UTC");
    }

    const hour24 = parsedDate.getUTCHours();
    return {
      month: UTC_MONTH_NAMES[parsedDate.getUTCMonth()],
      day: String(parsedDate.getUTCDate()),
      year: String(parsedDate.getUTCFullYear()),
      hour: String(hour24 % 12 || 12),
      minute: String(parsedDate.getUTCMinutes()).padStart(2, "0"),
      dayPeriod: hour24 >= 12 ? "PM" : "AM",
      timeZoneName: "UTC",
    };
  }
}

function readOrdinalSuffix(dayOfMonth) {
  if (dayOfMonth % 100 >= 11 && dayOfMonth % 100 <= 13) {
    return "th";
  }

  switch (dayOfMonth % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

module.exports = {
  TIMESTAMP_STYLES,
  buildReviewRecapPresentation,
  formatPullRequestReviewIndicators,
  sortPullRequestsByMostRecent,
  formatReviewListHeader,
  formatReviewListItem,
  formatReviewPullRequestLine,
  formatReviewRecapResponse,
  formatReviewRecencyLabel,
  formatPullRequestReference,
  formatTimestampAsUtcLegacy,
  formatTimestampByTimeFormat,
  formatTimestampWithTimezone,
  formatStatusResponse,
  isValidTimeZone,
};
