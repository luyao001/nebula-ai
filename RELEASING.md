# Desktop releases

Nova's desktop workflow builds the same tagged source on native GitHub-hosted
runners for these targets:

| Artifact | Runner | Rust target | Bundle |
| --- | --- | --- | --- |
| Windows 10/11 x64 | `windows-2025` | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| macOS 11+ Apple Silicon | `macos-15` | `aarch64-apple-darwin` | `.dmg` |
| macOS 11+ Intel | `macos-15-intel` | `x86_64-apple-darwin` | `.dmg` |

## CI builds

Pushes and pull requests targeting `main`, plus manual workflow dispatches,
run TypeScript tests/checks, Rust formatting/lint/tests, and all three desktop
builds. Installers are retained as workflow artifacts. Windows CI installers
are explicitly named `UNSIGNED`; macOS app bundles receive an ad-hoc signature.

## Release triggers

The workflow recognizes two tag forms:

- `vX.Y.Z` creates or updates the latest stable release. The version must match
  `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
  Windows publication is blocked unless SignPath returns a valid Authenticode
  signature.
- `vX.Y.Z-test.N` creates or updates an unsigned GitHub pre-release. Use this
  channel for direct installation testing before the stable signing request.

For example, when all version files contain `0.3.0`:

```text
git tag v0.3.0-test.2
git push origin v0.3.0-test.2
```

The tag push is the release trigger; generated `.exe` and `.dmg` files are not
committed to Git. A release is published only after checks and all platform
builds succeed.

## Verification

Every release contains `SHA256SUMS.txt`. GitHub also records build provenance
for each tagged installer. A downloaded artifact can be checked with:

```text
gh attestation verify Nova_0.3.0_macos_arm64.dmg -R luyao001/nova
```

The macOS builds are not Apple-notarized. On first launch, Gatekeeper may
require explicit approval from System Settings > Privacy & Security. A future
Developer ID setup can override the ad-hoc identity and add notarization
without changing the target matrix.
