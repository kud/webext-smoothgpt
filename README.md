# SmoothGPT

A Firefox extension that makes long ChatGPT conversations fast. It applies `content-visibility: auto` to off-screen message turns so the browser skips layout and paint work for nodes outside the viewport, eliminating the jitter and input lag that builds up in 500+ message threads.

The extension is content-script-only, fully local, and collects no data. There are no accounts, no telemetry, no network calls beyond the page itself.

## How it works

ChatGPT keeps every message turn live in the DOM. In long threads this produces thousands of nodes that the browser must re-layout on each new token. SmoothGPT applies CSS containment (`content-visibility: auto` + `contain-intrinsic-size`) to turns outside the viewport, telling the browser it can skip their rendering until they are scrolled into view. The nodes remain in the DOM — Ctrl+F, text selection, code-block copy buttons, and ChatGPT's own React reconciliation all continue to work normally.

Containment is only engaged once a conversation exceeds 30 turns. The currently-streaming turn is always exempted to preserve auto-scroll-to-bottom behaviour. A `MutationObserver` on the conversation container keeps containment applied as new turns arrive and survives SPA chat switches.

## Install

Firefox Add-ons (AMO): _link will appear after first submission_.

To load temporarily for development, see **Development** below.

## Development

```bash
npm install
npm run dev        # launches Firefox Nightly with the extension loaded
```

For changes to `src/background.js`, reload the extension manually via `about:debugging → This Firefox → Reload`. Content script and icon changes hot-reload automatically under `web-ext run`.

To load without Firefox Nightly: open `about:debugging → This Firefox → Load Temporary Add-on` and point to `manifest.json`. The extension is removed on browser restart.

## Lint and build

```bash
npm run lint       # validate manifest and source against AMO rules
npm run build      # package into web-ext-artifacts/
```

## Publishing

**First submission** — run `bash publish.sh`. This builds the package, opens the AMO Developer Hub in your browser, and reveals the `web-ext-artifacts/` folder. Upload the `.zip` manually and complete the listing (description, screenshots, review queue). The very first submission cannot be automated.

**Subsequent releases** — bump, tag, and push:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

`npm version` syncs the new version into `manifest.json` automatically (via the `version` lifecycle hook), then CI picks up the `v*` tag and runs `npm run sign:listed` to sign and upload the new version to AMO.

**Unlisted / self-signed** — for side-loading outside the AMO store:

```bash
npm run sign:self
```

Reads `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` from the environment. Same credentials as listed signing.

## CI setup (one time)

Before the first CI-driven release, add two secrets to the GitHub repo:

```bash
gh secret set MOZILLA_ADDONS_JWT_ISSUER
gh secret set MOZILLA_ADDONS_JWT_SECRET
```

Retrieve both values from https://addons.mozilla.org/en-US/developers/addon/api/key/ (the JWT issuer and JWT secret). `release.yml` maps them to the environment variable names that `web-ext` expects.

## Permissions

- `https://chatgpt.com/*` and `https://chat.openai.com/*` — content script injection only; required to read and modify the conversation DOM. No data leaves the browser.

No other permissions are requested.

## Licence

MIT — see [LICENSE](LICENSE).
