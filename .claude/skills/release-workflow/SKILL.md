---
name: release-workflow
description: How changes reach main and how releases are tagged in the Context Band repo. Use for any change to this repository (code, README, manifest, CI, docs), and whenever asked to commit, push, open or merge a PR, bump the version, cut or push a tag, release, or prepare for the Anthropic Plugin Directory.
---

# Release workflow for Context Band

`main` is protected. Every change reaches it through a pull request whose **Tests** check has passed. A release is an annotated `vX.Y.Z` tag on a merge commit of `main`, with the same version as `.claude-plugin/plugin.json`.

## Rules

- Never commit or push to `main` directly. Branch protection refuses it, admins included.
- Never bypass the gate: no `gh pr merge --admin`, no disabling protection, no force-push.
- Never move, delete or re-push a tag once it has been pushed. If a release is wrong, release the next patch version.
- The version in `plugin.json` rises with every change that alters what users install or what the directory listing shows. That includes code, the manifest, the README, `PRIVACY.md` and `icon.png`. A change to CI or this skill alone doesn't need a bump, but it may ride along with one.
- Commits and PR bodies end with the attribution lines the session provides.

## 1. Branch

```
git checkout main && git pull
git checkout -b <short-kebab-description>
```

Start from an up-to-date `main`, with one branch per change.

## 2. Change, then check locally

Run every check before pushing:

```
claude plugin validate --strict .
claude plugin test .
```

- **Type-check** with `npx tsc -p .` once Claude Code has written `.claude-plugin/types/`, which happens after the plugin has been loaded once, for example with `claude --plugin-dir .`.
- **Add or update tests** in `hooks/register.test.ts` for any behaviour change.
- **Keep the README accurate.** Every claim about behaviour must match `hooks/register.tsx`. Update the "What each hook does" table if hooks change. Keep the `/config` descriptions in `plugin.json` in step with it.
- **Bump `version`** in `.claude-plugin/plugin.json` if the rules above call for it. Use a patch bump for fixes and wording, minor for new items or options, and major for removed options or changed defaults.

Before committing, also check:
- the secret scan (`mcp__plugin-authoring__scan_secrets` on the repo folder) is clean
- `grep` finds no private paths or usernames
- there are no `.DS_Store` files, and no file is over 256 KiB

## 3. Pull request

```
git add <files> && git commit
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."
```

- The **Tests** workflow runs when a PR is opened, gets new commits, is reopened or is marked ready for review.
- **Tests**, on the pinned Claude Code version, must pass. It's the required check and is accepted only from GitHub Actions.
- **Tests (latest Claude Code, advisory)** doesn't block merging. If it fails, investigate: an upstream API change may be coming.
- The branch must be up to date with `main`. If it falls behind, run `gh pr update-branch <n>` and wait for the checks again.

Wait for the checks to finish:

```
gh pr checks <n>
```

Then merge:

```
gh pr merge <n> --squash --delete-branch
```

Use squash merges only, so `main` gets one commit per PR. If the merge is refused, fix the cause; don't bypass it.

## 4. Tag a release

Only after a version-bumping PR has merged:

```
git checkout main && git pull
grep '"version"' .claude-plugin/plugin.json      # e.g. 0.3.2
git tag -a v0.3.2 -m "Context Band 0.3.2"         # annotated, on main's merge commit
git push origin v0.3.2                            # the tag only
```

- The tag goes on the merge commit at the tip of `main`, and its version matches `plugin.json` exactly.
- Pushing a tag adds no commits, so branch protection doesn't apply to it. That's why the rules above never allow moving a tag.

Then confirm:
- `git ls-remote --tags origin` lists the tag
- the README's version badge shows it
- the **Tests** run on `main` for the merge commit passed

## 5. Anthropic Plugin Directory

The directory validates and security-scans each commit. Before submitting or relisting:

- `claude plugin validate --strict .` passes.
- The README is at least 40 words outside code blocks, and describes everything the plugin runs, sends or fetches.
- `LICENSE` exists. `plugin.json` has `name`, `description`, `author` and a raised `version`, plus `icon`, `documentationUrl`, `supportUrl` and `privacyPolicyUrl` as `https://` URLs that resolve.
- `PRIVACY.md` still matches what the plugin does.
- A fresh install works in an isolated home: `env -i PATH=/usr/bin:/bin HOME=<tmp> claude plugin install context-band --marketplace ajwann/context-band`. The installed copy validates and passes its tests.

To submit: claude.ai/directory/manage, then **Submit new**, then **Plugin bundle**. Choose `ajwann/context-band`, plugin folder `/`. Answer the data-handling questions (no personal data, no sharing, no retention, not aimed at under-18s), then **Validate** and **Submit**.
