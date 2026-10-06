const { participants } = require("./scenes.cjs");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

// The limited Slack mrkdwn emitted by these fixtures; never interpret fixture HTML.
function mrkdwn(value) {
  const tokens = [];
  const token = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  const text = String(value || "")
    .replace(/<@([^>]+)>/g, (_match, id) => token(`<span class="mention">@${escapeHtml({
      U_ALEX: "Alex Rivera", U_JORDAN: "Jordan Patel", U_MAYA: "Maya Chen",
    }[id] || id)}</span>`))
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_match, url, label) =>
      token(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`))
    .replace(/`([^`]+)`/g, (_match, code) => token(`<code>${escapeHtml(code)}</code>`));
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br>")
    .replace(/\u0000(\d+)\u0000/g, (_match, index) => tokens[Number(index)]);
}

function icon(name) {
  const paths = {
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    threads: '<path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4Z"/><path d="M8 8h7M8 12h5"/>',
    edit: '<path d="M13 5H5v14h14v-8M10 14l1-5 7-7 4 4-7 7-5 1Z"/>',
    headphones: '<path d="M4 15v-5a8 8 0 0 1 16 0v5M4 12h4v8H4ZM16 12h4v8h-4Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6h5"/>',
    home: '<path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7"/>',
    bell: '<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM10 21h4"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14q4 5 8 0M8 9h.01M16 9h.01"/>',
    video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11v2a7 7 0 0 0 14 0v-2M12 20v3M8 23h8"/>',
    files: '<path d="M6 2h8l5 5v15H6ZM14 2v6h5M9 12h7M9 16h7"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.threads}</svg>`;
}

function avatar(key, className = "", online = false) {
  const participant = participants[key];
  const file = participant?.avatar || "code-conductor.png";
  return `<span class="avatar-wrap ${className}"><img class="avatar" src="../avatars/${file}" alt="${escapeHtml(participant?.name || "Code Conductor")}">${online ? '<i class="online"></i>' : ""}</span>`;
}

function button(element) {
  return `<button class="action ${escapeHtml(element.style || "")}">${escapeHtml(element.text.text)}</button>`;
}

function renderBlock(block, { alignPullRequestStatuses = false } = {}) {
  if (block.type === "header") return `<h2>${escapeHtml(block.text.text)}</h2>`;
  if (block.type === "divider") return "<hr>";
  if (block.type === "actions") return `<div class="actions">${block.elements.map(button).join("")}</div>`;
  if (block.type === "context") return `<div class="context">${block.elements.map((item) => mrkdwn(item.text)).join(" ")}</div>`;
  if (block.type === "section") {
    if (block.fields) return `<div class="fields">${block.fields.map((field) => `<div>${mrkdwn(field.text)}</div>`).join("")}</div>`;
    const pullRequestRow = alignPullRequestStatuses && block.text?.text.match(
      /^(.*)\n(.*?)  ·  ([^*]*\*(?:Tested|Must test|Untested)\*)$/,
    );
    if (pullRequestRow) {
      const [, title, repository, status] = pullRequestRow;
      return `<div class="section pr-row"><div class="pr-title">${mrkdwn(title)}</div><div class="pr-status">${mrkdwn(status)}</div><div class="pr-description">${mrkdwn(repository)}</div></div>`;
    }
    return `<div class="section ${block.accessory ? "footer" : ""}"><div>${mrkdwn(block.text?.text)}</div>${block.accessory ? button(block.accessory) : ""}</div>`;
  }
  throw new Error(`Unsupported preview block: ${block.type}`);
}

function renderScene(scene) {
  const participant = participants[scene.participant];
  const attachment = scene.message.attachments[0];
  const blocks = attachment.blocks.map((block) => renderBlock(block, {
    alignPullRequestStatuses: scene.slug === "production-readiness",
  })).join("");
  const channels = ["announcements", "engineering", "deployments", "observability", "design", "product"];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Code Conductor — ${escapeHtml(scene.slug)}</title><link rel="stylesheet" href="slack.css"></head>
<body class="scene-${escapeHtml(scene.slug)}" style="--scene-width:${scene.width || 1672}px;--scene-height:${scene.height || 1000}px"><div class="workspace">
  <header class="topbar"><div class="window-dots"><i></i><i></i><i></i></div><div class="history">← <span>→</span> ${icon("clock")}</div><div class="search">${icon("search")}<span>Search Northstar</span><kbd>⌘ K</kbd></div><span class="help">?</span>${avatar(scene.participant, "profile", true)}</header>
  <nav class="rail"><div class="workspace-icon">N</div><div class="rail-item selected">${icon("home")}<small>Home</small></div><div class="rail-item">${icon("threads")}<small>DMs</small></div><div class="rail-item">${icon("bell")}<small>Activity</small></div><div class="rail-item">${icon("files")}<small>Files</small></div><div class="rail-more">•••<small>More</small></div><div class="rail-bottom">＋</div></nav>
  <aside class="sidebar"><div class="workspace-heading">Northstar <span>⌄</span>${icon("edit")}</div><div class="sidebar-content"><div class="nav-item">${icon("threads")} Threads</div><div class="nav-item"><span class="at">@</span> Mentions & reactions</div><div class="nav-item">${icon("files")} Drafts & sent</div><div class="nav-item"><span class="nav-symbol">◇</span> Slack Connect</div><div class="group-heading">⌄ <span>Channels</span><span class="group-plus">＋</span></div>${channels.map((channel) => `<div class="channel ${channel === scene.channel ? "active" : ""}"><span>#</span> ${channel}</div>`).join("")}<div class="group-heading">⌄ <span>Direct messages</span><span class="group-plus">＋</span></div>${Object.entries(participants).map(([key, person]) => `<div class="direct-message">${avatar(key, "tiny", true)}<span>${escapeHtml(person.name)}${key === scene.participant ? ' <span class="you">(you)</span>' : ""}</span></div>`).join("")}<div class="nav-item add-teammates">＋ <span>Add teammates</span></div></div></aside>
  <main><div class="channel-heading"><strong><span>#</span> ${escapeHtml(scene.channel)} <span class="chevron">⌄</span></strong><div class="channel-tools"><div class="members">${Object.keys(participants).map((key) => avatar(key, "tiny")).join("")}<span>3</span></div>${icon("headphones")}<span>⋮</span></div></div><div class="tabs"><span class="tab-selected">Messages</span><span>Files</span><span>Pins</span><span>＋</span></div>
  <div class="conversation"><div class="date"><span>Tuesday, October 6</span></div><article class="message">${avatar(scene.participant)}<div class="message-content"><div class="byline"><strong>${escapeHtml(participant.name)}</strong><time>${scene.slug === "automated-deploy" ? "10:42 AM" : escapeHtml(scene.time)}</time></div><div class="command">${escapeHtml(scene.command)}</div></div></article><article class="message bot-message">${avatar("bot")}<div class="message-content"><div class="byline"><strong>Code Conductor</strong><span class="app-badge">APP</span><time>${escapeHtml(scene.time)}</time>${scene.ephemeral ? '<span class="visibility">Only visible to you</span>' : ""}</div><div class="card" style="--accent:${escapeHtml(attachment.color)}">${blocks}</div></div></article></div>
  <div class="composer"><div class="composer-format"><strong>B</strong><i>I</i><span><s>S</s></span><span>↗</span><span>☷</span><span>≡</span><span>&lt;/&gt;</span></div><div class="composer-placeholder">Message #${escapeHtml(scene.channel)}</div><div class="composer-tools"><span class="plus">＋</span>${icon("smile")}<span>@</span><span class="tool-divider"></span>${icon("video")}${icon("mic")}<span class="send">${icon("send")}</span></div></div><div class="composer-hint"><strong>Return</strong> to send <span>·</span> <strong>Shift + Return</strong> for a new line</div></main>
</div></body></html>`;
}

module.exports = { renderScene };
