# Hackathon Provenance README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first screen of the Bitcoin++ branch README clearly distinguish OpenStays' pre-existing foundation from the work built during the hackathon.

**Architecture:** Keep provenance in two documentation layers: a concise judge-facing comparison in `README.md` and the existing detailed evidence manifest in `HACKATHON_BASELINE.md`. Use commit `5c3038e` in comparison commands because the friendly baseline tag is currently local-only and unavailable to GitHub visitors.

**Tech Stack:** GitHub-flavoured Markdown, Git

---

### Task 1: Correct the detailed baseline manifest

**Files:**
- Modify: `HACKATHON_BASELINE.md:27-28`

- [ ] **Step 1: Update the active reward statement**

Replace:

```markdown
The post-kickoff objective is a privacy-safe OpenTimestamps consensus receipt
and a one-time 210-sat Wavelength signet reward claimed by the guest.
```

with:

```markdown
The post-kickoff contribution is a privacy-safe OpenTimestamps consensus
receipt and a one-time 1,000-sat Wavelength signet reward claimed by the guest.
```

- [ ] **Step 2: Verify that the active manifest no longer describes a 210-sat reward**

Run:

```powershell
rg -n "post-kickoff|1,000-sat|210-sat" HACKATHON_BASELINE.md
```

Expected: the post-kickoff sentence contains `1,000-sat`; no active `210-sat`
reward statement remains.

- [ ] **Step 3: Commit the manifest correction**

```powershell
git add -- HACKATHON_BASELINE.md
git commit -m "docs: correct permanent hackathon reward"
```

### Task 2: Add the first-screen provenance comparison

**Files:**
- Modify: `README.md:1-14`

- [ ] **Step 1: Replace the existing hackathon blockquote**

Keep `# OpenStays`, then replace the current Bitcoin++ introductory blockquote
with this section:

```markdown
## Bitcoin++ Toronto 2026: what changed

OpenStays was already a working open-source booking engine before the event.
This branch adds the **Consensus Receipt + Reward** contribution on top of that
foundation; it does not claim the entire platform as hackathon-built.

| Already existed before Bitcoin++ | Built during Bitcoin++ |
| --- | --- |
| Conflict-proof booking holds and confirmation | Immutable, privacy-safe canonical consensus receipts |
| Stripe, Square, Zaprite and Wavelength payment foundations | OpenTimestamps submission, proof upgrades and downloadable `.ots` evidence |
| Zaprite reconciliation, manual refunds, booking chat and outbound email | One-time, exact **1,000-sat Wavelength signet reward** unlocked by a submitted proof |
| Staff operations, fictional Consensus Commons shell, consensus timeline and dormant Channex adapter | Receipt/reward guest experience, authoritative reward reconciliation and judge-demo proof states |

**Verify the boundary:** read the
[full baseline disclosure](./HACKATHON_BASELINE.md), inspect
[pre-kickoff commit `5c3038e`](https://github.com/murdawkmedia/openstays/commit/5c3038e),
or run:

```powershell
git diff --stat 5c3038e..HEAD
git log --oneline 5c3038e..HEAD
```

> The Consensus Commons rails are experimental and local-first. The demo uses
> fictional inventory, Wavelength signet test sats, and OpenTimestamps proofs;
> it does not include production Zaprite, Wavelength mainnet, Channex
> certification, or customer inventory. See the
> [hackathon runbook](./docs/hackathon-mvp.md).
```

Leave the existing `Open-source booking engine and property-management system`
introduction and the rest of the README immediately after this section.

- [ ] **Step 2: Verify the required provenance claims**

Run:

```powershell
rg -n "what changed|Already existed|Built during|5c3038e|1,000-sat|experimental and local-first" README.md
```

Expected: every phrase is present in the first README section.

- [ ] **Step 3: Verify that pre-existing capabilities are not claimed as event work**

Run:

```powershell
rg -n "Conflict-proof|Zaprite reconciliation|booking chat|Staff operations|OpenTimestamps|reward reconciliation" README.md
```

Expected: booking, reconciliation, chat, and staff operations appear only in
the left column; OpenTimestamps and reward reconciliation appear in the right
column.

- [ ] **Step 4: Check Markdown whitespace**

Run:

```powershell
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 5: Commit the README disclosure**

```powershell
git add -- README.md
git commit -m "docs: clarify Bitcoin++ contribution boundary"
```

### Task 3: Verify the branch evidence and prepare the handoff

**Files:**
- Verify: `README.md`
- Verify: `HACKATHON_BASELINE.md`
- Verify: `docs/superpowers/specs/2026-07-23-hackathon-provenance-readme-design.md`
- Verify: `docs/superpowers/plans/2026-07-23-hackathon-provenance-readme.md`

- [ ] **Step 1: Confirm the baseline commit is available**

Run:

```powershell
git cat-file -t 5c3038e
git diff --stat 5c3038e..HEAD
```

Expected: the first command prints `commit`; the second prints the transparent
post-kickoff file summary.

- [ ] **Step 2: Confirm only intended documentation changed**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: the worktree is clean after the planned commits, and the newest
commits are documentation-only.

- [ ] **Step 3: Stop before external publication**

Report the local commits and verification results. Do not push until Murphy
explicitly approves updating the public branch.
