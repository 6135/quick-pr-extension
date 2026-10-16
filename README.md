# Quick PR

Browser extension. It adds a **Quick PR** button next to the **Code** button on GitHub code pages. Type a title, click OK, and the extension opens GitHub's "Open a pull request" form with the title, source branch and target branch filled in. It works across forks.

MVP: it needs no token and does not call the API to create the PR. You click **Create pull request** on GitHub.

## Install (unpacked)

- Chrome / Edge: open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, select this folder.
- Firefox 121+: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, select `manifest.json`.

## Target rules

1. The per-repo override in the settings, if one exists.
2. Repo: the fork parent. If the repo is not a fork, the same repo.
3. Branch: the default branch in the settings. If it is empty, the default branch of the target repo. If that is unknown, `main`.

You can edit the source branch and the target in the dialog before you click OK.

## Limits

- Without a token, the API gives 60 requests per hour and reads only public repos. For private repos, the extension reads the "forked from" link on the page.
- GitHub changes its page structure often. If the button does not appear, the "Code" button selector in `src/content.js` needs an update.

## Test

```
npm test
```
