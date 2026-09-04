# boring-arcade

Three deterministic terminal games for the minutes when an AI coding agent
is still working. The package is intentionally small and can be installed as
a normal npm command-line application.

## Install

```sh
npm install --global boring-arcade
boring-arcade --list
```

## Play

Offline play is the default and never uploads a score:

```sh
boring-arcade --game completion-hell --offline
boring-arcade --game bracket-balance --offline
boring-arcade --game slack-off-breakout --offline
```

Use `--seed` and `--scripted-input auto` when a repeatable, machine-readable
run is useful:

```sh
boring-arcade --game completion-hell --offline \
  --seed example-seed --scripted-input auto --json
```

Online ranked runs require a pairing code from Pending Club and a local device
key. Set `BORING_ARCADE_API_ORIGIN` only when using a compatible API endpoint;
the default is `https://pendingclub.com`.

```sh
boring-arcade link ABC123
boring-arcade --game completion-hell --online
```

## Development

This repository contains only the public arcade release tree. Install the
lockfile dependencies, then run the local quality checks:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run release:check
```

The npm package contains the bundled `dist/cli.js`, `package.json`, this
README, and the MIT license. Source files, tests, and the release workflow are
kept in the repository for reproducible builds but are not included in the
published package.
