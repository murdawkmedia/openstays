# Public showcase hosting

Primary: https://www.murdawkmedia.com/openstays/
Original recovery address: https://openstays-consensus.pages.dev/

The accepted showcase uses Nostr branch `hosting/murdawk-subpath`, commit
`4051a65ae335e2ad3420cd666bcbb50398ad6a21`. It starts from the sanitized
public equivalent of the previously deployed showcase and adds asset-path,
wallet-header and narrow-screen fixes. Main's later production candidate and
separate private staging are not promoted.

Nostr remains authoritative. The existing Murdawk Media GitHub repository is a
passive mirror: `nostr-main` mirrors maintained main, `nostr-showcase` mirrors
the hosted release, and other Nostr branches use the `nostr/` prefix. Original
GitHub branches remain intact and Actions are disabled. Release instructions
are in `docs/subpath-deployment.md` on the showcase branch.

Existing backend, provider, authentication and incomplete live-payment
verification remain unchanged. No booking, payment, message or wallet action
is part of hosting acceptance. Keep the original app available while someone
may need access to wallet data stored in that browser origin. A new origin
does not automatically inherit a browser wallet; never collect recovery words
or upload private wallet data as a hosting migration step.
