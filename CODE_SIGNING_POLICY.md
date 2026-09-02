# Code signing policy

Nova publishes Windows and macOS desktop installers built from the source code
in the official [luyao001/nova](https://github.com/luyao001/nova) repository.
Release artifacts must come from a version tag owned by this repository, and
the version in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml` must match the tag.

All desktop artifacts are built on GitHub-hosted runners by
`.github/workflows/desktop.yml`. The workflow produces a Windows x64 NSIS
installer and separate macOS DMGs for Apple Silicon and Intel Macs.

Stable Windows builds are submitted through the SignPath GitHub connector for
origin verification, manual approval, and Authenticode signing. Publication
fails closed: no stable GitHub Release is created unless Windows validates the
returned signature. macOS builds currently use an ad-hoc app signature so they
run on Apple Silicon, but they are not Apple-notarized and may require approval
in macOS Privacy & Security on first launch.

Tags in the form `vX.Y.Z-test.N` publish clearly labeled unsigned pre-releases
for direct testing. Their Windows installer filename and release notes contain
an `UNSIGNED` warning, and they are never marked as the latest stable release.

Free code signing provided by [SignPath.io](https://about.signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/).

## Team roles

- Committer and reviewer: [luyao001](https://github.com/luyao001)
- Signing approver: [luyao001](https://github.com/luyao001)

Changes from contributors who are not committers must be reviewed before they
are merged. Accounts participating in source control or signing must use
multi-factor authentication. Every signing request requires manual approval by
the signing approver.

## Artifact requirements

- The source commit must have a version tag in the form `vX.Y.Z`.
- Package metadata must identify the product as `Nova` and use the tagged
  version.
- Stable Windows NSIS installers are the first-party binaries intended to
  receive the SignPath project signature.
- macOS DMGs contain ad-hoc signed application bundles for `arm64` and `x64`.
  They must not be described as Apple-notarized until Developer ID signing and
  notarization are configured.
- Signed artifacts must not be modified after signing.
- The SHA-256 digest of every released installer is published in
  `SHA256SUMS.txt` on the GitHub Release.
- Each tagged release artifact receives a GitHub build-provenance attestation.
- Unsigned testing tags use `vX.Y.Z-test.N` and must not be represented as
  trusted production releases.

## Repository configuration

The SignPath API token is stored only as the GitHub Actions secret
`SIGNPATH_API_TOKEN`. The non-secret organization, project, and signing-policy
identifiers are stored as repository variables named
`SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, and
`SIGNPATH_SIGNING_POLICY_SLUG`. These values are configured after SignPath
approves the project and are never embedded in release binaries.

## Privacy

Nova's data handling is documented in the project
[privacy policy](PRIVACY.md).
