# Bitcoin++ Judge Opening Infographics

Date: 2026-07-23
Status: approved content direction; visual implementation pending review
Audience: Bitcoin++ Toronto hackathon judges

## Purpose

Create three distinct, single-screen infographic variations that Murphy can use
during the first 30–40 seconds of the OpenStays demo. Each visual must reinforce
the same spoken story without requiring the judges to read paragraphs.

The opening idea is:

> Booking systems have a consensus problem. The guest, property, payment rail,
> notifications, and booking channels can all disagree. OpenStays gives them
> one authoritative booking state, commits the result through OpenTimestamps,
> and uses Wavelength to send the guest a 1,000-sat signet reward. The system is
> open source, verifiable, and portable.

## Approved Spoken Script

> Booking systems have a consensus problem.
> The guest, property, payment rail, notifications, and booking channels can all
> disagree.
> OpenStays gives them one authoritative booking state: availability is
> reserved, payment is independently verified, and only then is the booking
> confirmed.
> We commit that result through OpenTimestamps, creating a privacy-safe receipt
> that can anchor to Bitcoin.
> Then Wavelength sends the guest a 1,000-sat signet reward.
> It’s an open-source booking system where consensus is visible, verifiable,
> and portable.

## Required Facts

Every variation must communicate:

- the guest, property, payment rail, notifications, and booking channels can
  disagree;
- OpenStays resolves them into one authoritative booking state;
- payment is independently verified before confirmation;
- OpenTimestamps creates a privacy-safe receipt that can anchor to Bitcoin;
- Wavelength returns a 1,000-sat signet reward to the guest;
- OpenStays is open source, verifiable, and portable.

The visual must not imply:

- that the reward uses Bitcoin mainnet;
- that every new OpenTimestamps proof is immediately anchored;
- that Channex or external booking channels are already connected;
- that OpenStays replaces the guest’s self-custodial wallet.

## Format

- Landscape 16:9 composition suitable for a laptop or presentation screen.
- One dominant sentence, one diagram, and no more than six short labels.
- Large typography readable at conversational distance.
- Dark ink/charcoal foundation, warm Bitcoin orange accent, and a restrained
  teal or electric blue accent for verification.
- No stock photography, fake dashboards, gradients that reduce legibility, or
  cryptocurrency cliché imagery.
- Deliver each variation as editable HTML and a rendered PNG.

## Variation A — Consensus Convergence

Recommended.

Five participant labels enter from the left:

`Guest · Property · Payment · Notifications · Channels`

They converge on a central OpenStays node. One strong line exits to:

`ONE BOOKING TRUTH`

Two compact proof branches sit beneath the result:

- `OpenTimestamps → Bitcoin proof`
- `Wavelength → 1,000 signet sats`

Footer:

`OPEN · VERIFIABLE · PORTABLE`

This version maps most directly to the conference theme and matches the spoken
script in order.

## Variation B — Consensus Table

Arrange the five actors around a central OpenStays ledger, like participants
reaching agreement around a shared table. Each actor has a one- or two-word
concern:

- Guest — `Did I book?`
- Property — `Is it available?`
- Payment — `Did it settle?`
- Notifications — `Was it delivered?`
- Channels — `Is inventory ready?`

The center answers:

`CONSENSUS REACHED`

The bottom proof strip contains the OpenTimestamps receipt and Wavelength
reward. This is the most human and conversational variation.

## Variation C — Claim to Proof

Open with:

`“BOOKING CONFIRMED” IS ONLY A CLAIM`

Then show a short horizontal proof chain:

`Availability → Payment → Confirmation → Timestamp → Reward`

The final state is:

`VERIFIABLE BOOKING CONSENSUS`

OpenTimestamps and Wavelength receive the strongest visual emphasis. This is
the most technical and provocative variation, but it leads less directly with
the open-source positioning.

## Supporting Jot Notes

Primary memory line:

`DISAGREEMENT → ONE LEDGER → PROOF → REWARD → OPEN SOURCE`

Emergency 15-second version:

> Booking systems have a consensus problem: the guest, property, payment rail,
> and channels can disagree. OpenStays gives them one authoritative state,
> proves the result through OpenTimestamps, and rewards the guest through
> Wavelength—all as an open-source booking system.

## Acceptance Criteria

- All three PNGs are legible at 1280×720.
- Each can be understood in under five seconds without the script.
- The central claim and network distinction remain factually accurate.
- No text is clipped or smaller than practical presentation size.
- Variation A is visually strongest unless inspection shows another treatment
  communicates the concept faster.
- Source brief, HTML files, and PNGs live under `docs/demo/judge-opening/`.

