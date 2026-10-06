# Area context distances

`area_context` reports host-provided destinations by `name`, `latitude`, and
`longitude`. Distances are geographic straight-line estimates from the
resolved listing coordinates; they are never walking distances. The destination
source is labelled `host-supplied coordinates`. Listing coordinates retain the
precision and provenance described by `location`.

Municipal address-point district fallback is approximate neighbourhood
precision and is not a property address. Distances based on it inherit that
uncertainty.
