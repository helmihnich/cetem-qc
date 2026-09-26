# Technical Stack Review

Reviewed 2026-09-26 against current official release sources.

## Verdict

**Approved for the Phase 1 spine.** The selected versions exist and the important mobile compatibility set is coherent: Expo SDK 57 uses React Native 0.86 and React 19.2; Expo 57.0.17 or later updates React Native to 0.86.3 and contains the documented Hermes development-startup correction. The stated Expo version, `57.0.25`, clears that minimum.

There are no high-severity version or compatibility findings that require changing the spine.

## Follow-up finding

**Medium — clarify the Expo workflow in implementation.** Expo SDK 57 describes `expo prebuild` as its default workflow. The spine’s escape hatch still works, but the wording “move to Expo prebuild … only when a required dependency fails” can be read as a requirement to avoid prebuild. At mobile initialization, record whether the project uses Expo’s current continuous-native-generation/prebuild workflow or remains without generated native projects; validate every native local-storage, encryption, and secure-key dependency with Expo Doctor and development builds. This is an implementation decision, not a reason to select the bare React Native CLI now.

## Verified versions

| Technology | Spine value | Assessment |
| --- | --- | --- |
| Node.js | 24.21.0 LTS | Current v24 LTS patch at review time. |
| pnpm | 12.7 | Current 12.7.0 release; pin as `12.7.0` in `packageManager` rather than a range. |
| TypeScript | 6.0.3 review baseline | Valid stable release at review time. The final spine does not bind it permanently: implementation selects and pins the supported stable compiler after Expo/Next compatibility validation. |
| Next.js | 16.3.6 | Current Active LTS security patch at review time. A 16.3.7 security release is scheduled for 2026-09-30; apply it after it is published and validated. |
| React | 19.2.x | Compatible with Expo SDK 57. Pin the exact patch resolved by Expo rather than independently selecting one. |
| Expo / React Native | 57.0.25 / 0.86.3 | Coherent. Expo documents RN 0.86.3 from Expo 57.0.17 onward. |
| Express | 5.2.1 | Current release. |
| PostgreSQL | 18.6 | Current supported v18 minor. |
| Zod | 4.6.5 | Current release at review time. |

## Sources

- [Expo SDK 57](https://expo.dev/sdk/57) and [SDK 57 changelog](https://expo.dev/changelog/sdk-57)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [Next.js release and security updates](https://nextjs.org/blog)
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [PostgreSQL version policy](https://www.postgresql.org/support/versioning/)
- [pnpm releases](https://github.com/pnpm/pnpm/releases)
- [Express package](https://www.npmjs.com/package/express) and [Zod package](https://www.npmjs.com/package/zod)
