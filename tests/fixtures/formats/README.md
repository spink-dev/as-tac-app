# Frozen format samples

One file per released data format, written by the app version named inside. Every later version must
still open them (`tests/unit/migrations.test.ts`); `SHA256SUMS` makes sure nobody "fixes" a sample to
make a broken migration pass.

| File | Format | Written by |
| --- | --- | --- |
| `project-v1.json` | plan format 1 (all collections, attachments, an inset image, optional fields) | 1.0.0-alpha.2 |
| `archive-v2.astac` | `.astac` container 2 with plan format 1, three pictures, a PDF attachment and its base map (area format 1) | 1.0.0-alpha.2 |
| `link-v1.txt` | `#plan=` link, plan format 1 | 1.0.0-alpha.2 |
| `teams-v1.json` | team preset 1 without `projectFormatVersion` (as 1.0.0-alpha.1 wrote it) | 1.0.0-alpha.2 |
| `area-v1.astac-map.json` | area package 1 | 1.0.0-alpha.2 |
| `prefs-alpha1.json` | device preferences without version (English browser) | 1.0.0-alpha.1 |

When a format changes: add a sample of the **new** format with the next number, keep the old ones, and
append both hashes to `SHA256SUMS` (`sha256sum <file> >> SHA256SUMS`). Never edit an existing sample.
