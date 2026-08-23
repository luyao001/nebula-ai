# Code signing policy

Nebula AI publishes Windows installers built from the source code in the
official [luyao001/nebula-ai](https://github.com/luyao001/nebula-ai)
repository. Release artifacts submitted for signing must come from a tagged
commit owned by this repository and must use the same product name and version
as the tag.

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
- Package metadata must identify the product as `Nebula AI` and use the tagged
  version.
- The Windows installer and application executable are the only first-party
  binaries intended to receive the project signature.
- Signed artifacts must not be modified after signing.
- The SHA-256 digest of each released installer is published in its GitHub
  Release notes.

## Privacy

Nebula AI's data handling is documented in the project
[privacy policy](PRIVACY.md).
