# Changelog

What changed in each release, and why. Newest first.

## 0.1.1 (unreleased): vsl-corejs pinned to v0.2.0

**Before:** `@supersemantics/vsl-core` came from `github:supersemantics/vsl-corejs` with no ref,
so an install took whatever vsl-corejs's default branch was that day.

**After:** it is pinned to vsl-corejs's release tag, `github:supersemantics/vsl-corejs#v0.2.0`. An
application that also depends on vsl-corejs should name the same spec, so npm installs one copy:
`gatedNode` recognises a denial with `instanceof`, which needs the same copy on both sides.

**Why:** reproducible installs; tested against vsl-corejs 0.2.0.

**Also fixed:** `package-lock.json` pointed vsl-core at an old repository name, so `npm ci`
failed on a fresh clone. It is regenerated against the tag, over https.

**Also:** the docs no longer point to a separate hosted ledger package; they name the ledger stores this library's core ships with.

## 0.1.0

The first release.
