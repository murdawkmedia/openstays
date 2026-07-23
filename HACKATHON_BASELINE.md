# Bitcoin++ Toronto 2026 baseline disclosure

The annotated local tag `btcpp-toronto-2026-pre-kickoff` points to commit
`5c3038e`, the complete state of OpenStays before the hackathon kickoff ended
on July 22, 2026.

The following capabilities existed at that baseline and are not claimed as
hackathon-built:

- conflict-proof direct booking holds and confirmation;
- Stripe, Square, Zaprite, simulated, manual, gift-certificate, and Wavelength
  payment abstractions;
- authenticated Zaprite sandbox reconciliation and manual refund cases;
- the original Wavelength merchant invoice bridge and embedded wallet payment;
- guest/staff booking chat and provider-neutral outbound email delivery;
- the staff operations view, fictional Consensus Commons inventory/branding,
  and the original consensus timeline;
- the dormant Channex adapter and existing CLI/MCP automation surface.

The hackathon contribution begins after this tag. Judges can inspect it with:

```powershell
git diff --stat btcpp-toronto-2026-pre-kickoff..HEAD
git log --oneline btcpp-toronto-2026-pre-kickoff..HEAD
```

The post-kickoff objective is a privacy-safe OpenTimestamps consensus receipt
and a one-time 1,000-sat Wavelength signet reward claimed by the guest.
