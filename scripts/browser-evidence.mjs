import { mkdirSync, writeFileSync } from "node:fs";
export default class BrowserEvidence {
  onBegin(config) {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/browser-engines.json",
      JSON.stringify(
        config.projects.map((project) => ({
          name: project.name,
          browserName: project.use.browserName,
          retries: project.retries,
          repeatEach: project.repeatEach,
        })),
        null,
        2,
      ) + "\n",
    );
  }
}
