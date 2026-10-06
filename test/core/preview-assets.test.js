const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildScenes, participants } = require("../../docs/assets/previews/scenes.cjs");
const { renderScene } = require("../../docs/assets/previews/render.cjs");

test("review previews show the current summary and an expanded human approval category", async () => {
  const scenes = await buildScenes();
  const summary = scenes.find((scene) => scene.slug === "review-queue");
  const blocks = summary.message.attachments[0].blocks;
  assert.equal(blocks[0].text.text, "PR review recap");
  assert.match(blocks[1].text.text, /11 open.*9 active · 2 backburner/);
  assert.deepEqual(blocks.find((block) => block.type === "actions").elements.map((item) => item.text.text),
    ["Approved (2)", "Human approval (4)", "Unapproved (3)", "Backburner (2)"]);
  assert.doesNotMatch(JSON.stringify(blocks), /Add usage dashboard/);

  const category = scenes.find((scene) => scene.slug === "review-category");
  const categoryBlocks = category.message.attachments[0].blocks;
  const rows = categoryBlocks.filter((block) => block.text?.text.includes("Human review needed"));
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.text.text.includes("modified 10/5/2026")));
  assert.equal(categoryBlocks.find((block) => block.type === "actions").elements[0].text.text, "All tabs");
});

test("every preview reuses canonical portrait files throughout its Slack shell", async () => {
  for (const scene of await buildScenes()) {
    const html = renderScene(scene);
    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
    for (const file of ["code-conductor.png", ...Object.values(participants).map((person) => person.avatar)]) {
      assert.ok(sources.includes(`../avatars/${file}`));
      assert.ok(fs.existsSync(path.join(__dirname, "../../docs/assets/avatars", file)));
    }
    assert.ok(sources.every((source) => source.startsWith("../avatars/")));
    assert.equal(sources.filter((source) => source.endsWith(participants[scene.participant].avatar)).length, 4);
    assert.equal(html.includes("Only visible to you"), scene.ephemeral);
  }
});

test("operational previews retain the blocked readiness and completed-deploy outcomes", async () => {
  const scenes = await buildScenes();
  const readiness = scenes.find((scene) => scene.slug === "production-readiness").message;
  assert.match(readiness.attachments[0].blocks[0].text.text, /Production readiness/);
  assert.match(JSON.stringify(readiness), /Blocked.*1 required test/);
  assert.match(JSON.stringify(readiness), /Mark #187 tested/);
  const deployment = scenes.find((scene) => scene.slug === "automated-deploy").message;
  assert.equal(deployment.response_type, "in_channel");
  assert.equal(deployment.attachments[0].blocks[0].text.text, "✅ Production deployment complete");
  assert.match(JSON.stringify(deployment), /Completed in 4m 12s/);
  assert.match(JSON.stringify(deployment), /Healthy · HTTP 200/);
});

test("readiness preview places PR statuses beside their titles and retains repository details", async () => {
  const scenes = await buildScenes();
  const scene = scenes.find((item) => item.slug === "production-readiness");
  const html = renderScene(scene);
  const rows = [...html.matchAll(/<div class="section pr-row">(.*?)<\/div><\/div>/g)];
  assert.equal(rows.length, 2);
  assert.match(rows[0][1], /class="pr-title".*#184.*class="pr-status".*Tested.*class="pr-description".*northstar\/app/);
  assert.match(rows[1][1], /class="pr-title".*#187.*class="pr-status".*Must test.*class="pr-description".*northstar\/app/);
  for (const otherScene of scenes.filter((item) => item.slug !== scene.slug)) {
    assert.doesNotMatch(renderScene(otherScene), /class="pr-status"/);
  }
});
