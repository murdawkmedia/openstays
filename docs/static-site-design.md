# Static OpenStays project site

The public project site is a separate, dependency-free artifact in
`static-site/`. It explains the MIT-licensed booking and property-management
source without operating a booking backend. The full application remains in
this repository for future independent deployments.

The visual direction is warm hospitality editorial: cream, deep forest green,
restrained terracotta, large serif headings and an original cabin illustration.
Fictional stay cards and an illustrated reservation calendar explain the use
cases without resembling live availability or collecting guest information.

The home page contains lodging examples, source-backed feature descriptions,
explicit operating limitations, source links and visible questions and answers.
A second page explains static publication, fresh development/staging backends,
the reduced production profile, optional full self-hosting and real-operator
acceptance. Both pages provide useful HTML with JavaScript disabled.

Assets are local. There are no executable scripts, forms, remote fonts, embedded
providers, authentication or application API calls. JSON-LD describes the
visible software/source and FAQ content. Canonicals, social metadata and the
host sitemap should refer to the same public URLs. No rating, price, usage or
search-ranking claims are invented.

The site can be copied into the existing studio hosting artifact at
`/openstays/` without changing sibling tools. Historical app/wallet recovery
is a separate host-level concern; this static artifact does not read or change
browser storage or retain old backend settings.

Verify with `python3 scripts/check-static-site.py`, mobile/desktop rendering,
keyboard navigation, no-JavaScript content and the host's routing/asset checks.
