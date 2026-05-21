# WildChat Agency Explorer

Static GitHub Pages explorer for `wildchat_agency_examples.csv`.

The page loads the CSV in the browser and supports:

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
