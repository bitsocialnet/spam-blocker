# Changelog

## <small>0.1.19 (2026-11-27)</small>

* fix(challenge): use the SpamBlocker name and the renamed repository (#36) ([2795779](https://github.com/bitsocialnet/spamblocker/commit/2795779)), closes [#36](https://github.com/bitsocialnet/spamblocker/issues/36)

## <small>0.1.18 (2026-11-26)</small>

* fix(challenge): fail with a clear error when the spam blocker server is unreachable (#35) ([659bd6a](https://github.com/bitsocialnet/spam-blocker/commit/659bd6a)), closes [#35](https://github.com/bitsocialnet/spam-blocker/issues/35)
* docs: open the README with the SpamBlocker icon header (#34) ([4b91b28](https://github.com/bitsocialnet/spam-blocker/commit/4b91b28)), closes [#34](https://github.com/bitsocialnet/spam-blocker/issues/34)
* chore(design): add the Spam Blocker icon (#33) ([790ea54](https://github.com/bitsocialnet/spam-blocker/commit/790ea54)), closes [#33](https://github.com/bitsocialnet/spam-blocker/issues/33) [#3](https://github.com/bitsocialnet/spam-blocker/issues/3)

## <small>0.1.17 (2026-11-26)</small>

* feat(challenge): reject invalid options through pkc-js's validateChallengeSettings hook (#32) ([6a59922](https://github.com/bitsocialnet/spam-blocker/commit/6a59922)), closes [#32](https://github.com/bitsocialnet/spam-blocker/issues/32) [#14](https://github.com/bitsocialnet/spam-blocker/issues/14)

## <small>0.1.16 (2026-11-26)</small>

* fix(deps): upgrade @pkcprotocol/pkc-js 0.0.30 -> 0.0.163 (#31) ([e18e1a8](https://github.com/bitsocialnet/spam-blocker/commit/e18e1a8)), closes [#31](https://github.com/bitsocialnet/spam-blocker/issues/31)
* docs: a redeemed pre-check pass settles without a second iframe (#30) ([850f6d1](https://github.com/bitsocialnet/spam-blocker/commit/850f6d1)), closes [#30](https://github.com/bitsocialnet/spam-blocker/issues/30)
* docs: describe the hosted CAPTCHA-first verification page and its sign-in providers (#27) ([2ff9f9e](https://github.com/bitsocialnet/spam-blocker/commit/2ff9f9e)), closes [#27](https://github.com/bitsocialnet/spam-blocker/issues/27) [bitsocialnet/spam-blocker-server#43](https://github.com/bitsocialnet/spam-blocker-server/issues/43) [#45](https://github.com/bitsocialnet/spam-blocker/issues/45)
* docs: document upload authorization and the sign-in window routes (#29) ([d969f80](https://github.com/bitsocialnet/spam-blocker/commit/d969f80)), closes [#29](https://github.com/bitsocialnet/spam-blocker/issues/29) [#46](https://github.com/bitsocialnet/spam-blocker/issues/46)
* docs: say a remembered sign-in passes a post from any connection (#28) ([fe32915](https://github.com/bitsocialnet/spam-blocker/commit/fe32915)), closes [#28](https://github.com/bitsocialnet/spam-blocker/issues/28)

## <small>0.1.15 (2026-11-22)</small>

* feat(challenge): accept sign-in exemptions and give abuse as the rejection reason (#26) ([700fd89](https://github.com/bitsocialnet/spam-blocker/commit/700fd89)), closes [#26](https://github.com/bitsocialnet/spam-blocker/issues/26)

## <small>0.1.14 (2026-11-21)</small>

* feat(challenge): honor established-account exemption and name iCloud Private Relay (#25) ([1143e8c](https://github.com/bitsocialnet/spam-blocker/commit/1143e8c)), closes [#25](https://github.com/bitsocialnet/spam-blocker/issues/25)

## <small>0.1.13 (2026-11-19)</small>

* fix(challenge): read the pre-check pass from index-keyed challenge answers (#24) ([e7e06d0](https://github.com/bitsocialnet/spam-blocker/commit/e7e06d0)), closes [#24](https://github.com/bitsocialnet/spam-blocker/issues/24)
* docs(readme): fix exclude.roles and IP rule wording (#23) ([bcc6f90](https://github.com/bitsocialnet/spam-blocker/commit/bcc6f90)), closes [#23](https://github.com/bitsocialnet/spam-blocker/issues/23)
* chore(ci): skip Claude reviews on draft PRs [skip ci] [skip github-alerts] ([852868e](https://github.com/bitsocialnet/spam-blocker/commit/852868e))

## <small>0.1.12 (2026-11-17)</small>

* fix(challenge): require complete connection classification (#21) ([6805106](https://github.com/bitsocialnet/spam-blocker/commit/6805106)), closes [#21](https://github.com/bitsocialnet/spam-blocker/issues/21)

## <small>0.1.11 (2026-11-17)</small>

* feat(challenge): publish and explain connection restrictions (#20) ([4fa195c](https://github.com/bitsocialnet/spam-blocker/commit/4fa195c)), closes [#20](https://github.com/bitsocialnet/spam-blocker/issues/20)

## <small>0.1.10 (2026-11-16)</small>

* fix: verify declared exemptions before upload prechecks (#18) ([a1d7fcc](https://github.com/bitsocialnet/spam-blocker/commit/a1d7fcc)), closes [#18](https://github.com/bitsocialnet/spam-blocker/issues/18)

## <small>0.1.9 (2026-11-16)</small>

* fix(challenge): stop advertising unsafe exemption prechecks (#17) ([cfa3597](https://github.com/bitsocialnet/spam-blocker/commit/cfa3597)), closes [#17](https://github.com/bitsocialnet/spam-blocker/issues/17)
* docs(readme): rewrite around the public integration surface ([aa5badf](https://github.com/bitsocialnet/spam-blocker/commit/aa5badf))

## <small>0.1.8 (2026-11-16)</small>

* feat(challenge): explain and publish community Tor policy (#16) ([d7d513b](https://github.com/bitsocialnet/spam-blocker/commit/d7d513b)), closes [#16](https://github.com/bitsocialnet/spam-blocker/issues/16)
* fix(agents): reject stale Cursor skill links ([3370855](https://github.com/bitsocialnet/spam-blocker/commit/3370855))
* chore(agents): remove Cursor configuration ([56585da](https://github.com/bitsocialnet/spam-blocker/commit/56585da))

## <small>0.1.7 (2026-10-31)</small>

* chore(agents): add repository retrospective skill ([94af9a2](https://github.com/bitsocialnet/spam-blocker/commit/94af9a2))
* chore(ai workflows): consolidate native agent configuration ([c4322c6](https://github.com/bitsocialnet/spam-blocker/commit/c4322c6))
* chore(deps): fix Dependabot security alerts [skip github-alerts] ([415fc17](https://github.com/bitsocialnet/spam-blocker/commit/415fc17))
* chore(deps): patch vulnerable dependencies [skip ci] [skip github-alerts] ([bf611f5](https://github.com/bitsocialnet/spam-blocker/commit/bf611f5))
* chore(deps): patch vulnerable dependencies [skip ci] [skip github-alerts] ([cc4ca20](https://github.com/bitsocialnet/spam-blocker/commit/cc4ca20))
* chore(prettier): ignore the synced review workflow and format AGENTS.md ([ccf4c08](https://github.com/bitsocialnet/spam-blocker/commit/ccf4c08))
* feat(challenge): redeem pre-check passes and publish the pre-check URL (#15) ([b2c8b04](https://github.com/bitsocialnet/spam-blocker/commit/b2c8b04)), closes [#15](https://github.com/bitsocialnet/spam-blocker/issues/15)
* ci: add Claude Code review workflow ([13b3ecc](https://github.com/bitsocialnet/spam-blocker/commit/13b3ecc))
* ci: update Claude Code review workflow from bitsocialnet/5chan [skip ci] [skip github-alerts] ([d5e60f5](https://github.com/bitsocialnet/spam-blocker/commit/d5e60f5))
* ci: update Claude Code review workflow from bitsocialnet/5chan [skip ci] [skip github-alerts] ([0edbd5b](https://github.com/bitsocialnet/spam-blocker/commit/0edbd5b))
* fix(deps): patch Dependabot alerts [skip github-alerts] [skip ci] ([78ee377](https://github.com/bitsocialnet/spam-blocker/commit/78ee377))
* docs: record hosted service source policy ([b570938](https://github.com/bitsocialnet/spam-blocker/commit/b570938))

## <small>0.1.6 (2026-08-12)</small>

* docs: document hosted signer-cluster protection ([78d9673](https://github.com/bitsocialnet/spam-blocker/commit/78d9673))
* chore(deps): resolve Dependabot alerts ([c2f9136](https://github.com/bitsocialnet/spam-blocker/commit/c2f9136))
* chore(deps): resolve remaining Dependabot alerts ([e3045aa](https://github.com/bitsocialnet/spam-blocker/commit/e3045aa))

## <small>0.1.5 (2026-07-28)</small>

* ci: add .prettierignore for generated files ([48defb6](https://github.com/bitsocialnet/spam-blocker/commit/48defb6))
* ci: gate CI on prettier config changes ([78bae12](https://github.com/bitsocialnet/spam-blocker/commit/78bae12))
* chore: upgrade typescript to 7.0.2 ([ebb434b](https://github.com/bitsocialnet/spam-blocker/commit/ebb434b))
* chore(agents): inherit session model for judgment-tier subagents ([90da333](https://github.com/bitsocialnet/spam-blocker/commit/90da333))
* chore(codex agents): inherit parent model settings ([bdb66f3](https://github.com/bitsocialnet/spam-blocker/commit/bdb66f3))
* chore(deps): add resolutions for vulnerable transitive deps ([6adfea5](https://github.com/bitsocialnet/spam-blocker/commit/6adfea5))
* docs(agents): require evidence before bug fixes ([c93e2bb](https://github.com/bitsocialnet/spam-blocker/commit/c93e2bb))
* Fix Codex hooks config schema ([2ffe161](https://github.com/bitsocialnet/spam-blocker/commit/2ffe161))
* Update package.json ([b675e37](https://github.com/bitsocialnet/spam-blocker/commit/b675e37))

## <small>0.1.4 (2026-05-23)</small>

* test(challenge): align lazy iframe coverage with locked pkc-js ([850ad6f](https://github.com/bitsocialnet/spam-blocker/commit/850ad6f))
* fix(challenge): defer spam blocker evaluation until iframe open ([f4eb457](https://github.com/bitsocialnet/spam-blocker/commit/f4eb457))
* docs(agents): add generated LLM context workflow ([5b5345b](https://github.com/bitsocialnet/spam-blocker/commit/5b5345b))
* chore(cursor agents): use composer-2.5-fast model ([a2a3162](https://github.com/bitsocialnet/spam-blocker/commit/a2a3162))

## <small>0.1.3 (2026-05-08)</small>

- fix(challenge): trim runtime dependencies ([ea03c82](https://github.com/bitsocialnet/spam-blocker/commit/ea03c82))
- docs(agents): require descriptive worktree names ([c3112e4](https://github.com/bitsocialnet/spam-blocker/commit/c3112e4))
- ci(challenge): allow manual npm publish dispatch ([8ff2672](https://github.com/bitsocialnet/spam-blocker/commit/8ff2672))
- ci(challenge): ignore changelog-only release changes ([de4376b](https://github.com/bitsocialnet/spam-blocker/commit/de4376b))
- ci(challenge): publish release outputs automatically ([8002646](https://github.com/bitsocialnet/spam-blocker/commit/8002646))

## <small>0.1.2 (2026-04-29)</small>

- style(challenge): format changelog ([2d27c4c](https://github.com/bitsocialnet/spam-blocker/commit/2d27c4c))
- fix(challenge): bypass spam checks for moderation actions ([89ca246](https://github.com/bitsocialnet/spam-blocker/commit/89ca246))
- docs(agents): add operating principles ([f9c249b](https://github.com/bitsocialnet/spam-blocker/commit/f9c249b))

## <small>0.1.1 (2026-04-24)</small>

- docs(challenge): add one-command setup instructions ([b850bf6](https://github.com/bitsocialnet/spam-blocker/commit/b850bf6))
- style(agents): format debug skill files ([ef5e5ff](https://github.com/bitsocialnet/spam-blocker/commit/ef5e5ff))
