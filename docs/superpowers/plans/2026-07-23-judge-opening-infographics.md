# Bitcoin++ Judge Opening Infographics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce three polished 16:9 infographic variations and matching jot-note source material for the first 30–40 seconds of the OpenStays Bitcoin++ judge demo.

**Architecture:** Keep all audience-facing wording in one Markdown brief, then implement each visual as a self-contained HTML file with inline CSS so it remains editable and renders without build tooling. Render each HTML file to PNG with the existing stakeholder-infographic Chrome renderer, inspect every PNG, and keep the three outputs together under `docs/demo/judge-opening/`.

**Tech Stack:** Semantic HTML5, inline CSS, PowerShell, headless Chrome, PNG.

---

### Task 1: Create the shared judge-opening brief

**Files:**
- Create: `docs/demo/judge-opening/README.md`

- [ ] **Step 1: Write the shared source brief**

Create a concise Markdown file containing:

```markdown
# OpenStays Judge Opening

## 35-second script

Booking systems have a consensus problem.
The guest, property, payment rail, notifications, and booking channels can all disagree.
OpenStays gives them one authoritative booking state: availability is reserved,
payment is independently verified, and only then is the booking confirmed.
We commit that result through OpenTimestamps, creating a privacy-safe receipt
that can anchor to Bitcoin.
Then Wavelength sends the guest a 1,000-sat signet reward.
It’s an open-source booking system where consensus is visible, verifiable, and portable.

## Jot-note sequence

DISAGREEMENT → ONE LEDGER → PROOF → REWARD → OPEN SOURCE

## 15-second fallback

Booking systems have a consensus problem: the guest, property, payment rail,
and channels can disagree. OpenStays gives them one authoritative state, proves
the result through OpenTimestamps, and rewards the guest through Wavelength—all
as an open-source booking system.

## Accuracy notes

- OpenTimestamps receipts may be submitted before they become Bitcoin-anchored.
- The 1,000-sat Wavelength reward uses signet.
- Channex is adapter-ready, not connected.
```

- [ ] **Step 2: Verify wording**

Run:

```powershell
rg -n "consensus problem|OpenTimestamps|1,000-sat signet|open-source|adapter-ready" docs/demo/judge-opening/README.md
```

Expected: every approved key phrase appears, with no mainnet reward claim.

- [ ] **Step 3: Commit**

```powershell
git add docs/demo/judge-opening/README.md
git commit -m "add judge opening source brief"
```

### Task 2: Build Variation A — Consensus Convergence

**Files:**
- Create: `docs/demo/judge-opening/variation-a-consensus-convergence.html`

- [ ] **Step 1: Create the landscape HTML**

Implement a fixed `1600px × 900px` canvas using:

```html
<main class="canvas" aria-label="OpenStays consensus convergence infographic">
  <header>
    <p class="eyebrow">BITCOIN++ TORONTO · OPENSTAYS</p>
    <h1>BOOKINGS HAVE A <span>CONSENSUS PROBLEM</span></h1>
  </header>
  <section class="flow" aria-label="Five systems converge on one booking truth">
    <div class="actors">
      <span>GUEST</span><span>PROPERTY</span><span>PAYMENT</span>
      <span>NOTIFICATIONS</span><span>CHANNELS</span>
    </div>
    <div class="openstays">OPENSTAYS<small>authoritative ledger</small></div>
    <div class="truth">ONE BOOKING TRUTH</div>
  </section>
  <section class="proofs">
    <div><strong>OpenTimestamps</strong><span>privacy-safe Bitcoin proof</span></div>
    <div><strong>Wavelength</strong><span>1,000 signet sats to the guest</span></div>
  </section>
  <footer>OPEN · VERIFIABLE · PORTABLE</footer>
</main>
```

Use charcoal `#111827`, warm white `#f7f2e8`, Bitcoin orange `#f7931a`,
verification teal `#39c6b4`, and system UI fonts. Use CSS arrows and lines
rather than images. Keep the title at least `68px` and supporting labels at
least `24px`.

- [ ] **Step 2: Verify required content**

Run:

```powershell
rg -n "CONSENSUS PROBLEM|GUEST|PROPERTY|PAYMENT|NOTIFICATIONS|CHANNELS|ONE BOOKING TRUTH|OpenTimestamps|1,000 signet sats|OPEN · VERIFIABLE · PORTABLE" docs/demo/judge-opening/variation-a-consensus-convergence.html
```

Expected: all ten concepts appear exactly once in the visible composition.

- [ ] **Step 3: Commit**

```powershell
git add docs/demo/judge-opening/variation-a-consensus-convergence.html
git commit -m "build consensus convergence infographic"
```

### Task 3: Build Variations B and C

**Files:**
- Create: `docs/demo/judge-opening/variation-b-consensus-table.html`
- Create: `docs/demo/judge-opening/variation-c-claim-to-proof.html`

- [ ] **Step 1: Create the five-actor consensus table**

Build another fixed `1600px × 900px` canvas with five labeled actor cards
arranged around a central circle:

```html
<div class="actor guest"><strong>GUEST</strong><span>Did I book?</span></div>
<div class="actor property"><strong>PROPERTY</strong><span>Is it available?</span></div>
<div class="actor payment"><strong>PAYMENT</strong><span>Did it settle?</span></div>
<div class="actor notification"><strong>NOTIFICATIONS</strong><span>Was it delivered?</span></div>
<div class="actor channels"><strong>CHANNELS</strong><span>Is inventory ready?</span></div>
<div class="ledger"><small>OPENSTAYS</small><strong>CONSENSUS<br>REACHED</strong></div>
```

Add a bottom proof strip:

```html
<div class="proof-strip">
  <span>OpenTimestamps → privacy-safe Bitcoin proof</span>
  <span>Wavelength → 1,000 signet sats</span>
  <span>OPEN SOURCE</span>
</div>
```

Use a warm paper background, dark green ledger, orange agreement lines, and
blue proof strip. Ensure actor questions are readable at `26px` or larger.

- [ ] **Step 2: Create the claim-to-proof chain**

Build a third fixed `1600px × 900px` canvas led by:

```html
<h1>“BOOKING CONFIRMED”<br><span>IS ONLY A CLAIM</span></h1>
```

Render the five-step chain:

```html
<ol class="chain">
  <li><b>01</b><strong>AVAILABILITY</strong><span>atomically reserved</span></li>
  <li><b>02</b><strong>PAYMENT</strong><span>independently verified</span></li>
  <li><b>03</b><strong>CONFIRMATION</strong><span>one booking state</span></li>
  <li><b>04</b><strong>TIMESTAMP</strong><span>Bitcoin-verifiable receipt</span></li>
  <li><b>05</b><strong>REWARD</strong><span>1,000 signet sats</span></li>
</ol>
```

End with:

```html
<footer><strong>OPENSTAYS</strong> · VERIFY THE BOOKING, NOT THE PLATFORM</footer>
```

Use a near-black technical grid background, orange chain line, teal verified
states, and warm-white type. Add small labels identifying OpenTimestamps below
step 4 and Wavelength below step 5.

- [ ] **Step 3: Verify both variations**

Run:

```powershell
rg -n "CONSENSUS REACHED|OpenTimestamps|Wavelength|1,000 signet sats|OPEN SOURCE" docs/demo/judge-opening/variation-b-consensus-table.html
rg -n "ONLY A CLAIM|AVAILABILITY|PAYMENT|CONFIRMATION|TIMESTAMP|REWARD|OpenTimestamps|Wavelength|1,000 signet sats" docs/demo/judge-opening/variation-c-claim-to-proof.html
```

Expected: every required visible label is present.

- [ ] **Step 4: Commit**

```powershell
git add docs/demo/judge-opening/variation-b-consensus-table.html docs/demo/judge-opening/variation-c-claim-to-proof.html
git commit -m "build alternate judge opening infographics"
```

### Task 4: Render and inspect all PNGs

**Files:**
- Create: `docs/demo/judge-opening/variation-a-consensus-convergence.png`
- Create: `docs/demo/judge-opening/variation-b-consensus-table.png`
- Create: `docs/demo/judge-opening/variation-c-claim-to-proof.png`

- [ ] **Step 1: Render at presentation resolution**

Run each command from the repository root:

```powershell
$renderer = 'D:\Users\Murphy\Documents\MurphyOS\AIOS\Skills\tools\codex\stakeholder-one-pager-infographic\scripts\render-html-to-png.ps1'
powershell -ExecutionPolicy Bypass -File $renderer -InputHtml 'docs/demo/judge-opening/variation-a-consensus-convergence.html' -OutputPng 'docs/demo/judge-opening/variation-a-consensus-convergence.png' -WindowWidth 1600 -WindowHeight 900 -ScaleFactor 1
powershell -ExecutionPolicy Bypass -File $renderer -InputHtml 'docs/demo/judge-opening/variation-b-consensus-table.html' -OutputPng 'docs/demo/judge-opening/variation-b-consensus-table.png' -WindowWidth 1600 -WindowHeight 900 -ScaleFactor 1
powershell -ExecutionPolicy Bypass -File $renderer -InputHtml 'docs/demo/judge-opening/variation-c-claim-to-proof.html' -OutputPng 'docs/demo/judge-opening/variation-c-claim-to-proof.png' -WindowWidth 1600 -WindowHeight 900 -ScaleFactor 1
```

Expected: three non-empty PNG files at exactly 1600×900.

- [ ] **Step 2: Inspect each image**

Open every PNG and verify:

- the footer is visible;
- no label is clipped;
- every key point is readable without zooming;
- the OpenTimestamps mainnet proof and Wavelength signet reward are visually
  distinct;
- no composition contains a large accidental blank area.

If an image fails, adjust only its HTML/CSS and rerender it.

- [ ] **Step 3: Verify repository outputs**

Run:

```powershell
Get-ChildItem docs/demo/judge-opening/*.png | Select-Object Name,Length
git diff --check
```

Expected: three PNGs with non-zero sizes and no whitespace errors.

- [ ] **Step 4: Commit**

```powershell
git add docs/demo/judge-opening
git commit -m "render judge opening infographic variations"
```
