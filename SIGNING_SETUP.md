# Trusted release setup

The repository is prepared to publish Nebula AI `v0.2.1` through SignPath. A
version tag does not publish an unsigned fallback: the workflow stops if any
approval, credential, signature, or verification step fails.

After SignPath approves the open-source application:

1. Install and authorize the SignPath GitHub App for `luyao001/nebula-ai`.
2. Create the Nebula AI project and signing policy in SignPath, using the
   GitHub Actions artifact as the trusted build output.
3. Add `SIGNPATH_API_TOKEN` as a GitHub Actions repository secret.
4. Add these GitHub Actions repository variables:
   - `SIGNPATH_ORGANIZATION_ID`
   - `SIGNPATH_PROJECT_SLUG`
   - `SIGNPATH_SIGNING_POLICY_SLUG`
5. Push tag `v0.2.1` only after all four settings are present.

The tag workflow checks that the tag matches `package.json`, submits the single
NSIS installer to SignPath, waits for signing, validates the returned Windows
Authenticode signature, records its SHA-256 digest, and creates the GitHub
Release. Never commit or paste the API token into source files, issues, or
workflow logs.
