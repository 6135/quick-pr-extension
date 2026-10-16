# Quick PR

Browser extension. It adds a **Quick PR** button next to the **Code** button on GitHub code pages. Type a title, click OK, and the extension opens GitHub's "Open a pull request" form with the title, source branch and target branch filled in. It works across forks.

MVP: it needs no token and does not call the API to create the PR. You click **Create pull request** on GitHub.

## Install

### Firefox 140+

- Quick test: run `npm run start:firefox`. Or open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `manifest.json`. Firefox removes a temporary add-on when it restarts.
- Permanent install: Firefox release accepts only signed add-ons. Sign it as unlisted (self-distributed) on addons.mozilla.org: `npx web-ext@10.8.0 sign --channel=unlisted --api-key=... --api-secret=...`. Then open the `.xpi` file in Firefox.
- If the button does not appear, open `about:addons` → Quick PR → **Permissions** and allow access to `github.com` and `api.github.com`.

### Chrome / Edge

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and select this folder.

## Quick actions

Click the Quick PR toolbar button (it works on any page) or open the extension settings.

- **Quick action:** a saved target with a name. The target can be any user's repo or fork (`owner/repo:branch`), or `:branch` for the default target repo. Optional: title prefix, body, labels, assignees, and the source repos where it shows (`owner/repo`, `owner/*`, `*`; empty means all).
- In the Quick PR dialog, pick a quick action. The last action used in a repo is selected next time.
- **Share:** Export gives JSON text. Send it to another person. They paste it and click Import. Actions with the same name are replaced.
- Quick actions are saved on this computer only (`storage.local`). Firefox Sync does not copy them, so use Export/Import to move them.

## Target rules

1. The quick action or target of your last Quick PR from this repo. Click **Use default target** in the dialog to go back to the default. Settings → **Remembered targets** shows and removes saved targets.
2. The per-repo override in the settings, if one exists.
3. Repo: the fork parent. If the repo is not a fork, the same repo.
4. Branch: the default branch in the settings. If it is empty, the default branch of the target repo. If that is unknown, `main`.

You can edit the source branch and the target in the dialog before you click OK.

## Limits

- Without a token, the API gives 60 requests per hour and reads only public repos. For private repos, the extension reads the "forked from" link on the page.
- GitHub changes its page structure often. If the button does not appear, the "Code" button selector in `src/content.js` needs an update.

## Commands

```
npm test        # unit tests
npm run lint    # Mozilla add-on linter
npm run build   # zip in web-ext-artifacts/
```
