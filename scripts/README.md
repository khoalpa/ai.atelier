# Project scripts

The scripts in this directory fall into these operational groups:

- `build-*`, `render-*`, and release scripts create reproducible application artifacts.
- `benchmark-*`, `compare-*`, and `report-*` measure image workflow quality.
- `diagnose-*`, `audit-*`, `smoke-*`, and `verify-*` inspect an installation or feature.
- `prepare-*`, `import-*`, `migrate-*`, and `install-*` manage samples and local assets.
- `train-*`, `experiment-*`, and `refine-*` are research or calibration utilities.

Run the repository-level package commands for routine maintenance:

- `pnpm clean:cache` removes only explicitly listed generated caches.
- `pnpm verify:generated` builds the web UI in a temporary directory and checks it against
  `app/public` without modifying the working tree.
- `pnpm verify` runs the TypeScript check and generated-file verification.

Large local directories such as `models`, `workspace`, `weights`, `samples`, and `vendor`
are deliberately outside the cleanup command.
