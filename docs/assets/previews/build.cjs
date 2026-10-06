const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { buildScenes } = require("./scenes.cjs");
const { renderScene } = require("./render.cjs");

async function main() {
  const scenes = await buildScenes();
  const htmlOnly = process.argv.includes("--html-only");
  for (const scene of scenes) {
    const filename = `slack-scene-${scene.slug}`;
    const htmlPath = path.join(__dirname, `${filename}.html`);
    await fs.writeFile(htmlPath, renderScene(scene));
    if (!htmlOnly) {
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-preview-"));
      try {
        const result = spawnSync(process.env.CHROMIUM_PATH || "chromium", [
          "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
          "--no-pdf-header-footer", "--force-device-scale-factor=1",
          `--user-data-dir=${profile}`, `--window-size=${scene.width || 1672},${scene.height || 1000}`, "--virtual-time-budget=1500",
          `--screenshot=${path.join(__dirname, "..", "screenshots", `${filename}.png`)}`,
          pathToFileURL(htmlPath).href,
        ], { encoding: "utf8", timeout: 30000 });
        if (result.error || result.status !== 0) {
          throw new Error(`Chromium capture failed: ${result.error?.message || result.stderr}`);
        }
      } finally {
        await fs.rm(profile, { recursive: true, force: true });
      }
    }
    console.log(`Built ${filename}${htmlOnly ? ".html" : ".html and .png"}`);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
