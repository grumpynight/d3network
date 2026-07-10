# d3network edit worker

Cloudflare Worker that powers the "Siūlyti pokyčius" button on the site.
It receives edits, validates them, and handles them in one of two ways:

- **New character / image change** → opens a **pull request** against
  `gh-pages` for the owner to approve (merging publishes, closing rejects).
- **Link add / retype / remove** → **commits directly** to `gh-pages`
  (no approval needed; every change is still an auditable commit that can
  be reverted from the git history).

Site visitors do not need GitHub accounts.

## One-time setup

1. **Create a GitHub token** (as `grumpynight`):
   GitHub → Settings → Developer settings → Fine-grained personal access tokens →
   Generate new token.
   - Repository access: *Only select repositories* → `grumpynight/d3network`
   - Permissions: **Contents: Read and write**, **Pull requests: Read and write**
   - Set a long expiration and note the renewal date — the edit form stops
     working when the token expires.

2. **Deploy the worker** (needs a free Cloudflare account):

   ```sh
   cd worker
   npx wrangler login          # opens browser, log in to Cloudflare
   npx wrangler deploy         # prints the worker URL
   npx wrangler secret put GITHUB_TOKEN   # paste the token from step 1
   ```

3. **Point the site at the worker**: put the printed worker URL into
   `WORKER_URL` at the top of `js/edit.js` (keep the `/submit` suffix).

## Reviewing suggestions

Each suggestion becomes one PR named after the change (e.g.
`Naujas veikėjas: NAME (pasiūlė ...)`) touching only `Points.txt`/`Links.txt`.
Review the diff on github.com and **merge** to publish or **close** to reject.

Branches are always cut from the latest `gh-pages`. If two open PRs edit the
same lines, merge one; if the other then shows a conflict, close it and ask the
submitter to resubmit (the form always works against current data).

## Local development

```sh
cd worker
echo 'GITHUB_TOKEN=<token>' > .dev.vars   # optional; only needed to test PR creation
npx wrangler dev --port 8787
```

`http://localhost:8932` (the local site preview) is in the worker's allowed
origins, so a locally served site can talk to a locally running worker by
setting `WORKER_URL` to `http://localhost:8787/submit`.
