<!--
Release-notes template for AbleVSEP, codifying the house format used since v1.0.0.
GitHub has no native "apply this template" hook for releases, so the flow is manual:

  1. Copy everything below the comment into a new release body (GitHub Releases UI,
     or `gh release create vX.Y.Z --title "AbleVSEP X.Y.Z" --notes-file notes.md`).
  2. Fill in the date and the bullets.
  3. Attach the built `AbleVSEP-X.Y.Z.ablx` as the release asset.

Conventions:
  - Tag is `vX.Y.Z`; release title is `AbleVSEP X.Y.Z` (must match package.json / manifest.json).
  - Lead each bullet with a short **bold** summary, then the detail in plain language
    (what changed and why it helps the user, not how it was implemented).
  - Reference the issue or PR it resolves in parentheses at the end, e.g. (#15).
  - Keep the two headings below; delete a heading if it has no items for this release.
  - No em dashes (use periods, colons, parentheses, or shorter sentences). Write "MVSEP"
    all-caps. En dashes are fine in number ranges.
-->

*Released <Month Day, Year>*

## New Features and Improvements

- **<Short summary>:** <what changed and why it helps, in plain language>. (#<issue>)

## Bugfixes

- Fixed **<short description>**: <what was wrong and what happens now instead>. (#<issue>)
