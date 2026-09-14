# CCO compatibility in the customer portal

`cco-compatibility.json` declares supported CCO editions and feature packs for
new product releases. Keep it with the release source commit and review it
when the supported versions change. The release publisher sends this JSON
to the portal alongside the product version. Existing portal releases retain
their own metadata; a duplicate publish (HTTP 409) does not update them.

The initial declaration comes from v0.1.5:README.md explicit live verification on Cloud FP2503.

The portal currently records editions and feature packs, not individual patch
levels. Only declare a whole feature pack when that support can be stated;
do not infer support from a build dependency alone.

## Existing releases reviewed on 2026-09-14

- `v0.1.0` (a33f8c7855e4): not specified
- `v0.1.1` (4e39351f7734): not specified
- `v0.1.2` (c8134f1bab93): not specified
- `v0.1.3` (c8134f1bab93): not specified
- `v0.1.4` (081f012ab5fd): CLOUD FP2503
- `v0.1.5` (b14852051cb0): CLOUD FP2503

The four oldest Web App Bridge releases remain unspecified because their tags
do not contain a feature-pack-specific support declaration.

Unknown or unlisted targets are not a claim of incompatibility. They need a
confirmed support declaration before being added to the portal filter.
