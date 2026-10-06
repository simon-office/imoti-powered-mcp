# Sofia search district catalog

`src/search/slugs.ts` contains the URL values explicitly listed in the site's engineering notes, plus the three requested
name spellings `Mladost 4`, `Studentski grad`, and `Centre`. The last spelling is an alias for `Център`/`Tsentar`; `Bankya`
is an alias for the documented `гр. Банкя` value. Bulgarian and Latin names, aliases, and URL slugs are exposed by the
`get_search_districts` MCP tool.

The site notes say there are about fifty additional district values but do not enumerate their names or slugs. Those
values are intentionally absent rather than guessed. The catalog can be completed when reliable URL-value evidence for
the remainder is available. No live-site lookup is used by tests or this repository change.
