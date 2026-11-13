# Changelog

What changed in each release, and why. Newest first.

## 0.1.3 (2026-11-13, tag `v0.1.3`): first release published from GitHub Actions, with provenance

The code is unchanged from 0.1.2.

**Before:** 0.1.2 was published by hand, the first time, because npm can only trust a workflow for a
package that already exists. It has no provenance.

**After:** this version is built, tested and published by `.github/workflows/publish.yml` when its tag
is pushed, through npm Trusted Publishing: no token is stored anywhere. npm shows a provenance
statement linking the package to the exact commit and workflow run that built it.

**Why:** anyone installing the package can check where it came from; and this first publish through
the workflow confirms the Trusted Publishing connection.

## 0.1.2 (2026-11-13, tag `v0.1.2`): published on npm

The first version on npm: `npm install @supersemantics/vsl-langgraph`. The code is unchanged from
0.1.1.

**Before:** installed from GitHub, with vsl-corejs from a Git URL pinned to `v0.2.0`.

**After:** `@supersemantics/vsl-core` is a normal dependency, `^0.2.3`, resolved from npm;
`package.json` names the repository and publishes publicly; and a pushed release tag publishes from
GitHub Actions through npm Trusted Publishing, with provenance (`.github/workflows/publish.yml`).

**Why:** installs from a registry, with a version range npm can share with an application's own
dependency on vsl-corejs, so there is one copy and `instanceof` works.

## 0.1.1 (2026-11-12, tag `v0.1.1`): vsl-corejs pinned to v0.2.0

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
