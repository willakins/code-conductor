# Preview assets

All documentation previews and their source assets live here:

- `avatars/`: the canonical Code Conductor app icon and portraits of fictional teammates Maya Chen,
  Alex Rivera, and Jordan Patel. Every avatar occurrence uses these exact files. Original generation
  prompts are recorded in [avatars/PROMPTS.md](avatars/PROMPTS.md); assets were generated with the
  built-in imagegen tool.
- `screenshots/`: the four PNG previews used in the project README: review summary, expanded human
  approval category, production readiness, and completed production deployment.
- `previews/`: editable scene fixtures, the shared Slack shell and CSS, generated HTML, and the capture
  script. Open any `slack-scene-*.html` in a browser to inspect a scene locally.

The summary and expanded review category use `buildReviewRecapPresentation`. Readiness executes the
real `StatusCommand`; deployment completion runs the real confirmed-command and follow-up flow.
All messages use the production `buildCommunicationMessage` renderer. Dependencies are fictional,
offline fixtures: no Slack, code-host, deployment, or database service is contacted. The deployment
scene shows the public completion response after user confirmation; status and reviews are ephemeral.
The date is fixed at October 6, 2026 in America/New_York for reproducibility.

Regenerate HTML and screenshots from the repository root:

```bash
npm run previews
```

Requires local Chromium on `PATH`; use `CHROMIUM_PATH=/path/to/chromium npm run previews` to choose
another executable. The capture uses headless Chromium with a disposable local profile and no sandbox,
and should only be used with the trusted local preview sources. Browser execution may require local
environment approval. No npm packages or browser downloads are needed.

To regenerate only HTML without a browser:

```bash
npm run previews -- --html-only
```

Edit `previews/scenes.cjs` for example data and `previews/slack.css` for the Slack shell. Keep bot text,
PR rows, facts, and actions sourced from the production renderer. The expanded review image has a
taller canvas so its rows and footer remain visible. Preserve the shared avatar paths when adding
previews; do not synthesize new faces or icons inside screenshots. The readiness example uses a
smaller canvas and tighter card spacing to keep attention on the two PRs and deployment actions.
Its local preview layout aligns each PR's status to the right of its title, with the repository below.
