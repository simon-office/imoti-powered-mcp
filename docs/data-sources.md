# Sofia data sources and provenance

Status checked: 2026-10-05. The adapter in this change is deliberately fixture-only: it has no URL client and never downloads any data. Source references below identify the intended publisher/project and are not evidence that a specific dataset snapshot is currently available.

## Candidate sources

| Data | Source and URL | Dataset date checked | Reuse terms checked |
|---|---|---|---|
| Stops and schedules (GTFS) | Metropolitan Sofia / Sofia Urban Mobility Centre, official municipal portal: <https://www.sofia.bg/> | No GTFS file or version date verified on 2026-10-05. No dataset date is asserted. | No GTFS-specific licence verified. Permission to reuse is unknown; do not redistribute or collect until the feed and its terms are verified. |
| Municipal geographic features | Sofia Municipality, official portal: <https://www.sofia.bg/> (candidate source; a particular geospatial dataset was not located/verified) | No dataset date verified on 2026-10-05. | No dataset-specific reuse terms verified. Permission is unknown. |
| Pedestrian routing | OpenStreetMap data and OSRM routing project: <https://www.openstreetmap.org/copyright> and <https://project-osrm.org/> | No Sofia routing dataset snapshot/date verified on 2026-10-05; the adapter contains no routing results. | OpenStreetMap data is offered under ODbL; attribution and share-alike obligations apply to use of the database. The OSRM project software licence does not itself grant rights to an external routing service or its responses. No hosted service permission is asserted. |

## Sourced facts versus inference

**Sourced facts:** Sofia Municipality's official portal is at `sofia.bg`; OpenStreetMap's copyright page states its database licence; OSRM describes itself as a routing engine. This documentation check did not verify a published Sofia GTFS file, a municipal geographic dataset, their snapshot dates, or dataset-specific reuse grants. The first candidate URL returned 404 for `/open-data`, so this document deliberately references the municipality's root portal rather than claiming that path is valid.

**Inference / implementation boundary:** transit stops and timetables, municipal features and walking routes are useful inputs to area context; that product need does not establish data availability, freshness or permission. Any future live adapter must preserve the publisher, exact source URL, source dataset date, observation/check time and the applicable reuse terms with each normalized record. Until source files and their terms are directly checked, fixture data must remain invented and must not be presented as real Sofia data.

## Provenance fields

`DataSourceProvenance` records `name`, `sourceUrl`, `datasetDate`, `checkedAt` and `reuseTerms`. For unknown dates or permissions, callers must state that they are unknown rather than infer a date or claim permission. Synthetic test records use obviously fake URLs and values and make no network requests.
