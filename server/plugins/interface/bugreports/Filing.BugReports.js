"use strict";

// Where a report goes. With BUG_REPORT_GITHUB_REPO and BUG_REPORT_GITHUB_TOKEN set, the
// screenshot and diagnostics.json are committed to that repository under
// reports/<date>/<id>/ and the issue links them (GitHub's API can't attach files to an issue).
// Otherwise, or when GitHub fails, the report is saved under data/saves/bug-reports/.

const fs = require("node:fs/promises");
const path = require("node:path");
const { issueBody, issueTitle } = require("./Issue.BugReports");

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 20_000;
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** Everything in the report except the screenshot, for diagnostics.json. */
function diagnosticsJson(report) {
  const { screenshot, ...rest } = report;
  return JSON.stringify({ ...rest, screenshot: screenshot ? `screenshot.${screenshot.extension}` : null }, null, 2);
}

function createGitHubFiler({ repo, token, apiUrl = GITHUB_API, fetch = globalThis.fetch }) {
  const request = async (method, route, body) => {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}${route}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "tsps-bug-reports",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const answer = await response.text();
    if (!response.ok) throw new Error(`GitHub ${method} ${route}: ${response.status} ${answer.slice(0, 200)}`);
    return answer ? JSON.parse(answer) : {};
  };
  const putFile = async (file, bytes, message) => {
    const route = `/repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}`;
    const { content } = await request("PUT", route, { message, content: Buffer.from(bytes).toString("base64") });
    return content.html_url;
  };
  return {
    destination: `github.com/${repo}`,
    async file(report) {
      const folder = `reports/${report.reportedAt.slice(0, 10)}/${report.id}`;
      const links = {};
      if (report.screenshot) {
        const name = `screenshot.${report.screenshot.extension}`;
        links.screenshot = `${await putFile(`${folder}/${name}`, report.screenshot.bytes, `Bug report ${report.id}: ${name}`)}?raw=true`;
      }
      links.diagnostics = await putFile(`${folder}/diagnostics.json`, diagnosticsJson(report),
        `Bug report ${report.id}: diagnostics.json`);
      const issue = await request("POST", `/repos/${repo}/issues`, {
        title: issueTitle(report),
        body: issueBody(report, links),
      });
      return { issueNumber: issue.number, issueUrl: issue.html_url };
    },
  };
}

function createLocalFiler({ directory }) {
  return {
    destination: undefined,
    async file(report) {
      const stamp = report.reportedAt.slice(0, 19).replace(/:/g, "-");
      const user = report.username.replace(/[^\w-]+/g, "_").slice(0, 32);
      const folder = path.join(directory, `${stamp}-${user}-${report.id.slice(0, 8)}`);
      await fs.mkdir(folder, { recursive: true });
      const links = { diagnostics: "diagnostics.json" };
      if (report.screenshot) {
        links.screenshot = `screenshot.${report.screenshot.extension}`;
        await fs.writeFile(path.join(folder, links.screenshot), report.screenshot.bytes);
      }
      await fs.writeFile(path.join(folder, links.diagnostics), diagnosticsJson(report));
      await fs.writeFile(path.join(folder, "report.md"), `# ${issueTitle(report)}\n\n${issueBody(report, links)}\n`);
      return { savedTo: folder };
    },
  };
}

/** GitHub when it's configured, falling back to the local folder; the local folder otherwise. */
function createFiler({ env = process.env, fetch, directory }) {
  const local = createLocalFiler({ directory });
  const repo = (env.BUG_REPORT_GITHUB_REPO ?? "").trim();
  const token = (env.BUG_REPORT_GITHUB_TOKEN ?? "").trim();
  if (!repo && !token) return local;
  if (!REPO_PATTERN.test(repo) || !token) {
    console.warn("[bug-report] BUG_REPORT_GITHUB_REPO (owner/name) and BUG_REPORT_GITHUB_TOKEN must both be set; " +
      "reports are saved under data/saves/bug-reports/ instead.");
    return local;
  }
  const github = createGitHubFiler({ repo, token, apiUrl: env.BUG_REPORT_GITHUB_API_URL || undefined, fetch });
  return {
    destination: github.destination,
    async file(report) {
      try {
        return await github.file(report);
      } catch (error) {
        console.warn(`[bug-report] filing on ${github.destination} failed, saving it locally: ${error.message}`);
        return local.file(report);
      }
    },
  };
}

module.exports = { createFiler, diagnosticsJson };
