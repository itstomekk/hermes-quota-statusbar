# Updating

When the tool changes: refresh the screenshot (`.github/readme/` and `docs/img/`), the README and the docs page (`docs/index.html`), run the leak scan, then push.

Take upstream fixes: `git fetch upstream && git merge upstream/main`, resolve conflicts (the desktop `plugin.js` is where this fork differs most), then run all tests from [DEVELOPMENT.md](DEVELOPMENT.md).

Steps and the leak scan command live in the skill `github-public-repo-maintenance`.
