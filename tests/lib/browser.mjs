// Where to find Chromium: CHROMIUM_PATH, else the copy preinstalled in Claude Code's cloud containers, else the
// one `npx playwright install chromium` downloads (playwright-core finds that by itself).
import fs from "node:fs";
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  return undefined;
}
