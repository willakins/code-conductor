const {
  getReviewRecapConfig,
  listOpenPullRequestsForReviewRecapSince,
  listOpenPullRequestsWaitingOnReviewSince,
  markReviewRecapSent,
} = require("../db");
const {
  buildReviewRecapPresentation,
  formatReviewRecapResponse,
} = require("../util/format");
const {
  createSlackMessageClientAdapter,
} = require("../platform/communication/slack_message_client_adapter");
const {
  REVIEW_RECAP_BACKBURNER_AGE_MS,
  computeReviewRecapSinceTimestamp,
} = require("../shared/review_recap");

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const SCHEDULE_LOOKBACK_MINUTES = 8 * 24 * 60;
const MAX_POST_ATTEMPTS_PER_SLOT = 3;
const DAILY_SCHEDULE_WEEKDAY = "daily";
const WEEKEND_WEEKDAYS = new Set(["sat", "sun"]);
const US_FEDERAL_HOLIDAY_OBSERVED_DATE_KEYS_BY_YEAR = new Map();

function startReviewRecapScheduler(options) {
  const {
    communicationClient = null,
    getReviewRecapConfigFn = getReviewRecapConfig,
    listOpenPullRequestsForReviewRecapSinceFn = listOpenPullRequestsForReviewRecapSince,
    listOpenPullRequestsWaitingOnReviewSinceFn = null,
    markReviewRecapSentFn = markReviewRecapSent,
    buildReviewRecapPresentationFn = buildReviewRecapPresentation,
    formatReviewRecapResponseFn = formatReviewRecapResponse,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    nowFn = () => new Date(),
    logger = console,
    pool,
    slackClient,
  } = options;
  const messageClient = communicationClient || createSlackMessageClientAdapter(slackClient);

  if (!pool || !messageClient || typeof messageClient.postChannelMessage !== "function") {
    logger.warn("Review recap scheduler disabled: missing pool or communication message client.");
    return {
      stop() {},
    };
  }

  const schedulerState = buildSchedulerState();

  async function tick() {
    await runReviewRecapSchedulerTick({
      getReviewRecapConfigFn,
      listOpenPullRequestsForReviewRecapSinceFn,
      listOpenPullRequestsWaitingOnReviewSinceFn,
      markReviewRecapSentFn,
      buildReviewRecapPresentationFn,
      formatReviewRecapResponseFn,
      nowFn,
      logger,
      messageClient,
      pool,
      schedulerState,
    });
  }

  void tick();
  const intervalId = setInterval(() => {
    void tick();
  }, tickIntervalMs);

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}

async function runReviewRecapSchedulerTick({
  getReviewRecapConfigFn,
  listOpenPullRequestsForReviewRecapSinceFn,
  listOpenPullRequestsWaitingOnReviewSinceFn,
  markReviewRecapSentFn,
  buildReviewRecapPresentationFn = buildReviewRecapPresentation,
  formatReviewRecapResponseFn,
  nowFn,
  logger,
  messageClient,
  slackClient,
  pool,
  schedulerState,
}) {
  const effectiveSchedulerState = ensureSchedulerState(schedulerState);

  try {
    const effectiveMessageClient = messageClient || createSlackMessageClientAdapter(slackClient);
    if (!effectiveMessageClient || typeof effectiveMessageClient.postChannelMessage !== "function") {
      logger.warn("Review recap scheduler tick skipped: no communication message client configured.");
      return;
    }

    const now = nowFn();
    const config = await getReviewRecapConfigFn(pool);
    if (!config.targetChannelId) {
      logNoChannelConfigured({ logger, now, schedulerState: effectiveSchedulerState });
      return;
    }

    const scheduledSlot = findMostRecentScheduledSlot({
      now,
      scheduleWeekday: config.scheduleWeekday,
      scheduleTime: config.scheduleTime,
      timeZone: config.timeZone,
      lookbackMinutes: SCHEDULE_LOOKBACK_MINUTES,
    });
    if (!scheduledSlot) {
      return;
    }

    if (hasSlotAlreadyBeenSent({ scheduledSlot, lastSentSlotAt: config.lastSentSlotAt })) {
      return;
    }
    const slotKey = scheduledSlot.toISOString();
    if (shouldSkipScheduledSlot({ config, scheduledSlot })) {
      await markReviewRecapSentFn(pool, slotKey);
      clearPostAttemptState({
        schedulerState: effectiveSchedulerState,
        slotKey,
      });
      return;
    }

    if (hasReachedPostAttemptLimit({ schedulerState: effectiveSchedulerState, slotKey })) {
      logPostAttemptLimitReached({
        logger,
        schedulerState: effectiveSchedulerState,
        slotKey,
      });
      return;
    }

    const sinceTimestamp = computeReviewRecapSinceTimestamp({
      now,
      reviewScope: config.reviewScope,
      recencyValue: config.recencyValue,
      recencyUnit: config.recencyUnit,
    });
    const listPullRequestsFn = resolveRecapListFn({
      listOpenPullRequestsForReviewRecapSinceFn,
      listOpenPullRequestsWaitingOnReviewSinceFn,
    });
    const backburnerBeforeTimestamp = new Date(
      now.getTime() - REVIEW_RECAP_BACKBURNER_AGE_MS,
    );
    const pullRequests = await listPullRequestsFn(
      pool,
      sinceTimestamp,
      backburnerBeforeTimestamp,
    );
    const recapFormatOptions = {
      pullRequests,
      reviewScope: config.reviewScope,
      recencyValue: config.recencyValue,
      recencyUnit: config.recencyUnit,
      timeZone: config.timeZone,
      now,
    };
    const message = formatReviewRecapResponseFn(recapFormatOptions);
    const presentation = buildReviewRecapPresentationFn(recapFormatOptions);

    try {
      await effectiveMessageClient.postChannelMessage({
        channelId: config.targetChannelId,
        presentation,
        text: message,
        mrkdwn: true,
      });
    } catch (error) {
      const attemptCount = recordFailedPostAttempt({
        schedulerState: effectiveSchedulerState,
        slotKey,
      });
      logPostError({
        schedulerState: effectiveSchedulerState,
        logger,
        error,
        attemptCount,
        slotKey,
      });
      return;
    }

    await markReviewRecapSentFn(pool, scheduledSlot.toISOString());
    clearPostAttemptState({
      schedulerState: effectiveSchedulerState,
      slotKey,
    });
  } catch (error) {
    logger.error("Review recap scheduler tick failed.");
    logger.error(error.message);
  }
}

function logNoChannelConfigured({ logger, now, schedulerState }) {
  const minuteKey = now.toISOString().slice(0, 16);
  if (schedulerState.lastNoChannelLogMinuteKey === minuteKey) {
    return;
  }

  schedulerState.lastNoChannelLogMinuteKey = minuteKey;
  logger.info("Review recap scheduler skipped: no target channel configured.");
}

function buildSchedulerState() {
  return {
    lastNoChannelLogMinuteKey: null,
    postAttemptCountBySlotKey: new Map(),
    loggedPostAttemptLimitBySlotKey: new Set(),
  };
}

function ensureSchedulerState(schedulerState) {
  if (!schedulerState) {
    return buildSchedulerState();
  }

  if (!(schedulerState.postAttemptCountBySlotKey instanceof Map)) {
    schedulerState.postAttemptCountBySlotKey = new Map();
  }
  if (!(schedulerState.loggedPostAttemptLimitBySlotKey instanceof Set)) {
    schedulerState.loggedPostAttemptLimitBySlotKey = new Set();
  }

  return schedulerState;
}

function hasReachedPostAttemptLimit({ schedulerState, slotKey }) {
  const attemptCount = schedulerState.postAttemptCountBySlotKey.get(slotKey) || 0;
  return attemptCount >= MAX_POST_ATTEMPTS_PER_SLOT;
}

function recordFailedPostAttempt({ schedulerState, slotKey }) {
  const previousAttemptCount = schedulerState.postAttemptCountBySlotKey.get(slotKey) || 0;
  const nextAttemptCount = previousAttemptCount + 1;
  schedulerState.postAttemptCountBySlotKey.set(slotKey, nextAttemptCount);
  return nextAttemptCount;
}

function clearPostAttemptState({ schedulerState, slotKey }) {
  schedulerState.postAttemptCountBySlotKey.delete(slotKey);
  schedulerState.loggedPostAttemptLimitBySlotKey.delete(slotKey);
}

function logPostAttemptLimitReached({ logger, schedulerState, slotKey }) {
  if (schedulerState.loggedPostAttemptLimitBySlotKey.has(slotKey)) {
    return;
  }

  schedulerState.loggedPostAttemptLimitBySlotKey.add(slotKey);
  logger.error(
    `Review recap scheduler reached max retry attempts (${MAX_POST_ATTEMPTS_PER_SLOT}) for slot ${slotKey}. Skipping further retries until next scheduled slot.`,
  );
}

function logPostError({ schedulerState, logger, error, attemptCount, slotKey }) {
  logger.error("Review recap scheduler tick failed.");

  const errorCode = readErrorCode(error);
  if (errorCode === "not_in_channel") {
    logger.error(
      [
        "Review recap post failed: bot is not in the configured channel (`not_in_channel`).",
        "Invite the bot to that channel and rerun `/conductor config review-recap-channel:<#CHANNEL|CHANNEL_ID>`.",
      ].join(" "),
    );
  } else {
    logger.error(error?.message || String(error));
  }

  logger.error(
    `Review recap post attempt ${attemptCount}/${MAX_POST_ATTEMPTS_PER_SLOT} failed for slot ${slotKey}.`,
  );

  if (attemptCount >= MAX_POST_ATTEMPTS_PER_SLOT) {
    schedulerState.loggedPostAttemptLimitBySlotKey.add(slotKey);
    logger.error(
      `Review recap scheduler reached max retry attempts (${MAX_POST_ATTEMPTS_PER_SLOT}) for slot ${slotKey}. Skipping further retries until next scheduled slot.`,
    );
  }
}

function readErrorCode(error) {
  const codeFromPayload = String(error?.data?.error || "").trim().toLowerCase();
  if (codeFromPayload) {
    return codeFromPayload;
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not_in_channel")) {
    return "not_in_channel";
  }

  return "";
}

function hasSlotAlreadyBeenSent({ scheduledSlot, lastSentSlotAt }) {
  if (!lastSentSlotAt) {
    return false;
  }

  const sentTimestamp = lastSentSlotAt instanceof Date ? lastSentSlotAt : new Date(lastSentSlotAt);
  if (Number.isNaN(sentTimestamp.getTime())) {
    return false;
  }

  return sentTimestamp.getTime() >= scheduledSlot.getTime();
}

function resolveRecapListFn({
  listOpenPullRequestsForReviewRecapSinceFn,
  listOpenPullRequestsWaitingOnReviewSinceFn,
}) {
  if (typeof listOpenPullRequestsForReviewRecapSinceFn === "function") {
    return listOpenPullRequestsForReviewRecapSinceFn;
  }

  return (
    listOpenPullRequestsWaitingOnReviewSinceFn ||
    listOpenPullRequestsWaitingOnReviewSince
  );
}

function findMostRecentScheduledSlot({ now, scheduleWeekday, scheduleTime, timeZone, lookbackMinutes }) {
  const normalizedScheduleWeekday = String(scheduleWeekday || "").toLowerCase().trim();
  const scheduledMinuteOfDaySet = parseScheduledMinuteOfDaySet(scheduleTime);
  if (scheduledMinuteOfDaySet.size === 0) {
    return null;
  }

  const nowMinute = new Date(now);
  nowMinute.setUTCSeconds(0, 0);

  for (let offsetMinutes = 0; offsetMinutes <= lookbackMinutes; offsetMinutes += 1) {
    const candidateSlot = new Date(nowMinute.getTime() - offsetMinutes * 60 * 1000);
    const candidateParts = readTimeZoneMinuteParts(candidateSlot, timeZone);
    if (!candidateParts) {
      continue;
    }

    const candidateWeekday = normalizeShortWeekday(candidateParts.weekday);
    if (
      (
        normalizedScheduleWeekday === DAILY_SCHEDULE_WEEKDAY ||
        candidateWeekday === normalizedScheduleWeekday
      ) &&
      scheduledMinuteOfDaySet.has(
        Number(candidateParts.hour) * 60 + Number(candidateParts.minute),
      )
    ) {
      return candidateSlot;
    }
  }

  return null;
}

function readTimeZoneMinuteParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const partsByType = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        partsByType[part.type] = part.value;
      }
    }

    return {
      weekday: partsByType.weekday,
      hour: partsByType.hour,
      minute: partsByType.minute,
    };
  } catch (_error) {
    return null;
  }
}

function normalizeShortWeekday(shortWeekday) {
  const normalizedWeekday = String(shortWeekday || "").toLowerCase().trim();
  const weekdayMap = {
    mon: "mon",
    tue: "tue",
    wed: "wed",
    thu: "thu",
    fri: "fri",
    sat: "sat",
    sun: "sun",
  };

  return weekdayMap[normalizedWeekday] || null;
}

function parseScheduledMinuteOfDaySet(scheduleTime) {
  const scheduleTimes = String(scheduleTime || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const scheduleMinuteSet = new Set();

  for (const timePart of scheduleTimes) {
    const timeMatch = timePart.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!timeMatch) {
      return new Set();
    }

    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    scheduleMinuteSet.add(hour * 60 + minute);
  }

  return scheduleMinuteSet;
}

function shouldSkipScheduledSlot({ config, scheduledSlot }) {
  const sendOnWeekends = readReviewRecapDeliveryToggle(config?.sendOnWeekends, false);
  const sendOnHolidays = readReviewRecapDeliveryToggle(config?.sendOnHolidays, false);
  if (sendOnWeekends && sendOnHolidays) {
    return false;
  }

  const scheduledCalendarDay = readTimeZoneCalendarDay(scheduledSlot, config?.timeZone);
  if (!scheduledCalendarDay) {
    return false;
  }

  if (!sendOnWeekends && WEEKEND_WEEKDAYS.has(scheduledCalendarDay.weekday)) {
    return true;
  }

  if (!sendOnHolidays && isUsFederalHolidayObserved(scheduledCalendarDay)) {
    return true;
  }

  return false;
}

function readReviewRecapDeliveryToggle(rawToggle, defaultValue) {
  if (rawToggle === true || rawToggle === false) {
    return rawToggle;
  }

  const normalizedToggle = String(rawToggle || "").toLowerCase().trim();
  if (["true", "1", "yes", "on"].includes(normalizedToggle)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedToggle)) {
    return false;
  }

  return defaultValue;
}

function readTimeZoneCalendarDay(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const partsByType = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        partsByType[part.type] = part.value;
      }
    }

    const weekday = normalizeShortWeekday(partsByType.weekday);
    const year = Number(partsByType.year);
    const month = Number(partsByType.month);
    const day = Number(partsByType.day);
    if (!weekday || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    return {
      weekday,
      year,
      month,
      day,
    };
  } catch (_error) {
    return null;
  }
}

function isUsFederalHolidayObserved(calendarDay) {
  const candidateDateKey = formatDateKey({
    year: calendarDay.year,
    month: calendarDay.month,
    day: calendarDay.day,
  });
  const candidateYears = [calendarDay.year - 1, calendarDay.year, calendarDay.year + 1];

  for (const candidateYear of candidateYears) {
    const holidayDateKeys = readUsFederalHolidayObservedDateKeys(candidateYear);
    if (holidayDateKeys.has(candidateDateKey)) {
      return true;
    }
  }

  return false;
}

function readUsFederalHolidayObservedDateKeys(year) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear)) {
    return new Set();
  }

  if (US_FEDERAL_HOLIDAY_OBSERVED_DATE_KEYS_BY_YEAR.has(normalizedYear)) {
    return US_FEDERAL_HOLIDAY_OBSERVED_DATE_KEYS_BY_YEAR.get(normalizedYear);
  }

  const holidayDateKeys = new Set();
  addObservedFixedHolidayDate(holidayDateKeys, normalizedYear, 1, 1); // New Year's Day
  addLastWeekdayHolidayDate(holidayDateKeys, normalizedYear, 5, 1); // Memorial Day (last Monday, May)
  addObservedFixedHolidayDate(holidayDateKeys, normalizedYear, 7, 4); // Independence Day
  addFloatingHolidayDate(holidayDateKeys, normalizedYear, 9, 1, 1); // Labor Day (1st Monday, Sep)
  addFloatingHolidayDate(holidayDateKeys, normalizedYear, 10, 1, 2); // Columbus Day (2nd Monday, Oct)
  addObservedFixedHolidayDate(holidayDateKeys, normalizedYear, 11, 11); // Veterans Day
  addFloatingHolidayDate(holidayDateKeys, normalizedYear, 11, 4, 4); // Thanksgiving Day (4th Thursday, Nov)
  addObservedFixedHolidayDate(holidayDateKeys, normalizedYear, 12, 25); // Christmas Day

  US_FEDERAL_HOLIDAY_OBSERVED_DATE_KEYS_BY_YEAR.set(normalizedYear, holidayDateKeys);
  return holidayDateKeys;
}

function addObservedFixedHolidayDate(dateKeySet, year, month, day) {
  const observedDate = readObservedFixedHolidayDate({ year, month, day });
  dateKeySet.add(formatDateKey(observedDate));
}

function readObservedFixedHolidayDate({ year, month, day }) {
  const holidayDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = holidayDate.getUTCDay();

  if (dayOfWeek === 6) {
    holidayDate.setUTCDate(holidayDate.getUTCDate() - 1);
  } else if (dayOfWeek === 0) {
    holidayDate.setUTCDate(holidayDate.getUTCDate() + 1);
  }

  return {
    year: holidayDate.getUTCFullYear(),
    month: holidayDate.getUTCMonth() + 1,
    day: holidayDate.getUTCDate(),
  };
}

function addFloatingHolidayDate(dateKeySet, year, month, weekday, nth) {
  const day = findNthWeekdayOfMonth({ year, month, weekday, nth });
  if (!day) {
    return;
  }

  dateKeySet.add(formatDateKey({ year, month, day }));
}

function addLastWeekdayHolidayDate(dateKeySet, year, month, weekday) {
  const day = findLastWeekdayOfMonth({ year, month, weekday });
  if (!day) {
    return;
  }

  dateKeySet.add(formatDateKey({ year, month, day }));
}

function findNthWeekdayOfMonth({ year, month, weekday, nth }) {
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const firstDateWeekday = firstDate.getUTCDay();
  const dayOffset = (weekday - firstDateWeekday + 7) % 7;
  const dayOfMonth = 1 + dayOffset + (nth - 1) * 7;
  const monthEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (dayOfMonth > monthEndDay) {
    return null;
  }

  return dayOfMonth;
}

function findLastWeekdayOfMonth({ year, month, weekday }) {
  const monthEndDate = new Date(Date.UTC(year, month, 0));
  const monthEndDay = monthEndDate.getUTCDate();
  const monthEndWeekday = monthEndDate.getUTCDay();
  const dayOffset = (monthEndWeekday - weekday + 7) % 7;
  return monthEndDay - dayOffset;
}

function formatDateKey({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

module.exports = {
  findMostRecentScheduledSlot,
  runReviewRecapSchedulerTick,
  startReviewRecapScheduler,
};
