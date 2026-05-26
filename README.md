# WildChat Agency Explorer

Static GitHub Pages explorer for the WildChat agency pipeline CSVs.

The page loads the CSV in the browser and supports:

- top-level switching between `old_results_final.csv` and `new_results_incomplete.csv`
- full-text search over prompt text and tags
- domain, action type, kept-by, and secondary-check filters
- result sorting and pagination
- shareable URL query parameters
- a detail dialog for full prompt text

## Local Preview

Serve the directory before opening the page so the browser can fetch the CSV:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.
