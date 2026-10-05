# Changelog

## [0.2.0-rc.1] - 2026-10-05

First release candidate for the search, memory, and photo/location assessment stages.

### Added

- Search Bulgarian property listings with bounded, configurable result and page limits, including verified filters.
- Keep local listing observations, notes, favourites, rejections, saved searches, and watchlists; summarize observed price and description changes in a digest.
- Assess listing photos with image references and uncertainty, and provide Sofia area context with location precision and nearby transit information.
- Provide clean-checkout setup instructions and configurable collection limits for the CLI and MCP search tool.

### Limitations

- Search coverage and freshness are bounded; advertised prices are not transaction prices, and missing listings mean only that they were no longer observed.
- Listing details and descriptions may be incomplete or inaccurate. Photo assessment cannot reveal hidden defects, structural condition, workmanship, or legal status.
- Locations may be approximate or missing; nearby-place and transit context is limited by source coverage and freshness. Outputs are decision support, not verification.
- Browser use requires a locally installed Chrome or Chromium. Protective screens require manual continuation; CAPTCHA challenges are never bypassed.
