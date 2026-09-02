# Trusted release setup

The repository publishes Nova desktop builds through
`.github/workflows/desktop.yml`. A stable version tag does not publish an
unsigned Windows fallback: the workflow stops if any SignPath credential,
approval, signature, or verification step fails.

Explicit testing tags in the form `vX.Y.Z-test.N` are the only exception. They
publish an unsigned GitHub pre-release for Windows x64 and ad-hoc signed DMGs
for Apple Silicon and Intel Macs. They do not replace the latest stable release.

After SignPath approves the open-source application:

1. Install and authorize the SignPath GitHub App for `luyao001/nova`.
2. Create the Nova project and signing policy in SignPath, using the GitHub
   Actions artifact as the trusted build output.
3. Add `SIGNPATH_API_TOKEN` as a GitHub Actions repository secret.
4. Add these GitHub Actions repository variables:
   - `SIGNPATH_ORGANIZATION_ID`
   - `SIGNPATH_PROJECT_SLUG`
   - `SIGNPATH_SIGNING_POLICY_SLUG`
5. Push a stable tag only after all four settings are present.

The tag workflow checks that the tag matches `package.json`, submits the single
NSIS installer to SignPath, waits for signing, validates the returned
Authenticode signature, builds both macOS architectures, records all SHA-256
digests, emits provenance attestations, and creates the GitHub Release. Never
commit or paste the API token into source files, issues, or workflow logs.

See [RELEASING.md](RELEASING.md) for versioning, trigger, artifact, and local
verification details.
