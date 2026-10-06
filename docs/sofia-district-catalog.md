# Sofia search district catalog

`src/search/slugs.ts` contains all 191 URL slugs and Bulgarian names listed in the site notes, including source-reported
deal restrictions. `Mladost 4`, `Studentski grad`, and `Centre` resolve to their listed slugs; `Centre` and `Center` are
aliases for `Център`/`tsentar`, and `Bankya` is an alias for `гр. Банкя`/`gr-bankya`. Bulgarian names, Latin slug forms,
aliases, and URL slugs are exposed by the `get_search_districts` MCP tool.

The same module includes all 20 site-listed property type slugs, Bulgarian menu names, result-card labels, and deal
availability. Tests use only the published skill list and synthetic search inputs; no live-site lookup is used.
