// Thin wrapper over the GitHub Contents API. This is the persistence layer:
// Vercel functions have no writable disk, so every state change is a commit.

const API = "https://api.github.com";

function env() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error("Missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO env vars");
  }
  return { token: GITHUB_TOKEN, owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: GITHUB_BRANCH || "main" };
}

async function ghFetch(path, options = {}) {
  const { token } = env();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  return res;
}

// Returns { content: string, sha: string|null }. sha is null if the file doesn't exist yet.
export async function getFile(path) {
  const { owner, repo, branch } = env();
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${branch}`);
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw new Error(`GitHub getFile(${path}) failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf8");
  return { content, sha: json.sha };
}

// Creates or updates a file. Pass the sha you last read to avoid clobbering
// a concurrent write; on a 409 (sha mismatch) this throws so the caller can
// re-fetch and retry.
export async function putFile(path, content, message, sha) {
  const { owner, repo, branch } = env();
  const res = await ghFetch(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409) {
    const err = new Error(`GitHub putFile(${path}) conflict: sha out of date`);
    err.code = "SHA_CONFLICT";
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub putFile(${path}) failed: ${res.status} ${await res.text()}`);
  return res.json();
}
