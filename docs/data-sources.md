# Sofia data sources and provenance

Source investigation checked: 2026-10-05. This is the date the listed publisher/project references and availability claims were checked; it is not a dataset publication date. The adapter in this change is deliberately fixture-only: it has no URL client and never downloads any data. No dataset snapshot or dataset-specific reuse terms are claimed where the source could not be verified.

## Candidate sources

| Data | Source and URL | Dataset date checked | Reuse terms checked |
|---|---|---|---|
| Stops and schedules (GTFS) | Sofia Municipality's official portal, candidate publisher reference: <https://www.sofia.bg/>. No specific Sofia GTFS feed was located/verified. | Checked 2026-10-05: feed, version and dataset publication date could not be verified. Dataset date: unknown. | Checked 2026-10-05: no feed-specific licence or reuse grant could be verified. Reuse permission: unknown; do not redistribute or collect until verified. |
| Municipal geographic features | Sofia Municipality's official portal, candidate publisher reference: <https://www.sofia.bg/>. No particular geospatial dataset was located/verified. | Checked 2026-10-05: dataset and publication date could not be verified. Dataset date: unknown. | Checked 2026-10-05: no dataset-specific reuse terms could be verified. Reuse permission: unknown. |
| Pedestrian routing | OpenStreetMap data copyright page <https://www.openstreetmap.org/copyright>; OSRM project <https://project-osrm.org/> | Checked 2026-10-05: no Sofia routing dataset snapshot/date verified; the adapter contains no routing results. Dataset date: unknown. | OpenStreetMap's cited copyright page states ODbL terms including attribution and share-alike for database use. Checked 2026-10-05: this does not establish permission for any hosted routing service or its responses; no such permission is asserted. |

## Sourced facts versus inference

**Sourced facts:** the municipality identifies its official portal at `sofia.bg`; OpenStreetMap's cited copyright page states its database licence; OSRM describes itself as a routing engine. The 2026-10-05 check did not verify a published Sofia GTFS file, a municipal geographic dataset, their snapshot dates, or dataset-specific reuse grants. Those dates and permissions are therefore recorded as unknown, not inferred. The first candidate URL returned 404 for `/open-data`, so this document deliberately references the municipality's root portal rather than claiming that path is valid.

**Inference / implementation boundary:** transit stops and timetables, municipal features and walking routes are useful inputs to area context; that product need does not establish data availability, freshness or permission. Any future live adapter must preserve the publisher, exact source URL, source dataset date, observation/check time and the applicable reuse terms with each normalized record. Until source files and their terms are directly checked, fixture data must remain invented and must not be presented as real Sofia data.

## Provenance fields

`DataSourceProvenance` records `name`, `sourceUrl`, `datasetDate`, `checkedAt` and `reuseTerms`. For unknown dates or permissions, callers must state that they are unknown rather than infer a date or claim permission. Synthetic test records use obviously fake URLs and values and make no network requests.
