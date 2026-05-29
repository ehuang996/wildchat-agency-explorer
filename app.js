(function () {
  "use strict";

  const DATASETS = {
    old: {
      id: "old",
      label: "Old results pipeline",
      url: "old_results_final.csv",
      domainLabel: "Domain",
      allDomainLabel: "All domains",
      actionLabel: "Action type",
      actionSummaryLabel: "action types",
      resultKicker: "Old pipeline",
    },
    new: {
      id: "new",
      label: "New results pipeline",
      url: "new_results_incomplete.csv",
      domainLabel: "Domains",
      allDomainLabel: "All domains",
      actionLabel: "Categories",
      actionSummaryLabel: "categories",
      resultKicker: "New pipeline",
    },
  };

  const DOCS = {
    filter_domain: {
      id: "filter_domain",
      label: "Domain filter",
      url: "filter_domain.json",
      title: "filter_domain.json",
    },
    filter_structural: {
      id: "filter_structural",
      label: "Structural filter",
      url: "filter_structural.json",
      title: "filter_structural.json",
    },
  };

  const DEFAULT_DATASET_ID = "old";
  const CHECK_LABELS = {
    build_resilience_to_exogenous_shocks: "Resilience to shocks",
    exist_better_in_world: "Better option exists",
    make_world_work_better_for_user: "World works better for user",
  };

  const datasetCache = new Map();
  const docCache = new Map();
  let loadToken = 0;

  const state = {
    activeDatasetId: DEFAULT_DATASET_ID,
    activeDocId: "",
    rows: [],
    filtered: [],
    query: "",
    domain: "",
    sort: "index",
    page: 1,
    pageSize: 25,
    actions: new Set(),
    kept: new Set(),
    checks: new Set(),
  };

  const el = {
    tabs: [...document.querySelectorAll(".pipeline-tab")],
    topActions: document.querySelector(".top-actions"),
    summaryGrid: document.getElementById("summaryGrid"),
    workbench: document.getElementById("workbench"),
    totalRows: document.getElementById("totalRows"),
    visibleRows: document.getElementById("visibleRows"),
    domainCount: document.getElementById("domainCount"),
    actionCount: document.getElementById("actionCount"),
    actionCountLabel: document.getElementById("actionCountLabel"),
    searchInput: document.getElementById("searchInput"),
    domainLabel: document.getElementById("domainLabel"),
    domainSelect: document.getElementById("domainSelect"),
    domainSortOption: document.getElementById("domainSortOption"),
    sortSelect: document.getElementById("sortSelect"),
    pageSizeSelect: document.getElementById("pageSizeSelect"),
    actionFacetBlock: document.getElementById("actionFacetBlock"),
    actionFacetLegend: document.getElementById("actionFacetLegend"),
    actionFacets: document.getElementById("actionFacets"),
    keptFacetBlock: document.getElementById("keptFacetBlock"),
    keptFacets: document.getElementById("keptFacets"),
    checkFacetBlock: document.getElementById("checkFacetBlock"),
    checkFacets: document.getElementById("checkFacets"),
    resultTitle: document.getElementById("resultTitle"),
    status: document.getElementById("status"),
    resultsList: document.getElementById("resultsList"),
    prevButton: document.getElementById("prevButton"),
    nextButton: document.getElementById("nextButton"),
    pageLabel: document.getElementById("pageLabel"),
    resetButton: document.getElementById("resetButton"),
    randomButton: document.getElementById("randomButton"),
    jsonViewer: document.getElementById("jsonViewer"),
    jsonTitle: document.getElementById("jsonTitle"),
    jsonStatus: document.getElementById("jsonStatus"),
    jsonContent: document.getElementById("jsonContent"),
    detailDialog: document.getElementById("detailDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogMeta: document.getElementById("dialogMeta"),
    dialogTags: document.getElementById("dialogTags"),
    dialogText: document.getElementById("dialogText"),
  };

  function getActiveDataset() {
    return DATASETS[state.activeDatasetId] || DATASETS[DEFAULT_DATASET_ID];
  }

  function getActiveDoc() {
    return DOCS[state.activeDocId] || null;
  }

  function isDocView() {
    return Boolean(getActiveDoc());
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function toRecords(csvRows, dataset) {
    const headers = csvRows.shift().map((header) => header.trim());

    return csvRows
      .filter((row) => row.length > 1)
      .map((row, index) => {
        const record = {};
        headers.forEach((header, columnIndex) => {
          record[header] = row[columnIndex] || "";
        });

        const prompt = record.user_input || "";
        const categories = asArray(readJson(record.categories, []));
        const actions =
          dataset.id === "new" ? categories : asArray(readJson(record.action_types, []));
        const kept = asArray(readJson(record.kept_by, []));
        const checks = readJson(record.secondary_checks, {});
        const domain = record.domain || record.primary_category || categories[0] || "unknown";
        const metadata = makeMetadata(record);

        return {
          datasetId: dataset.id,
          index: index + 1,
          prompt,
          domain,
          actions,
          kept,
          checks,
          metadata,
          length: prompt.length,
          searchText: [
            prompt,
            domain,
            categories.join(" "),
            actions.join(" "),
            kept.join(" "),
            Object.keys(checks).join(" "),
            metadata.map((item) => item.value).join(" "),
          ]
            .join(" ")
            .toLowerCase(),
        };
      });
  }

  function makeMetadata(record) {
    const metadata = [];

    if (record.timestamp) {
      metadata.push({ label: "Timestamp", value: record.timestamp });
    }

    if (record.conversation_hash) {
      metadata.push({ label: "Conversation hash", value: record.conversation_hash });
    }

    if (record.category_reasoning) {
      metadata.push({ label: "Category reasoning", value: record.category_reasoning });
    }

    return metadata;
  }

  function readJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function countBy(rows, getter) {
    const counts = new Map();
    rows.forEach((row) => {
      getter(row).forEach((value) => {
        if (value) {
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function prettyLabel(value) {
    const text = String(value || "unknown");
    return CHECK_LABELS[text] || text.replaceAll("_", " ");
  }

  function makeTag(text, kind) {
    const tag = document.createElement("span");
    tag.className = `tag ${kind || ""}`.trim();
    tag.textContent = prettyLabel(text);
    return tag;
  }

  function makeCheckPill(name, value) {
    const pill = document.createElement("span");
    pill.className = `check ${value ? "true" : ""}`;
    pill.textContent = `${prettyLabel(name)}: ${value ? "true" : "false"}`;
    return pill;
  }

  function renderFacets(container, items, groupName) {
    container.textContent = "";
    items.forEach(([name, count]) => {
      const label = document.createElement("label");
      label.className = "facet-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = state[groupName].has(name);
      checkbox.disabled = !state.rows.length;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state[groupName].add(name);
        } else {
          state[groupName].delete(name);
        }
        state.page = 1;
        applyFilters();
      });

      const labelText = document.createElement("span");
      labelText.className = "facet-name";
      labelText.textContent = prettyLabel(name);

      const countText = document.createElement("span");
      countText.className = "facet-count";
      countText.textContent = formatNumber(count);

      label.append(checkbox, labelText, countText);
      container.append(label);
    });
  }

  function initializeControls() {
    const dataset = getActiveDataset();
    const domains = countBy(state.rows, (row) => [row.domain]);
    const actions = countBy(state.rows, (row) => row.actions);
    const kept = countBy(state.rows, (row) => row.kept);
    const checks = countBy(state.rows, (row) =>
      Object.entries(row.checks)
        .filter(([, value]) => value)
        .map(([key]) => key)
    );

    updateDatasetChrome(dataset);
    renderDomainOptions(domains, dataset);
    renderFacets(el.actionFacets, actions, "actions");
    renderFacets(el.keptFacets, kept, "kept");
    renderFacets(el.checkFacets, checks, "checks");

    el.actionFacetBlock.hidden = !actions.length;
    el.keptFacetBlock.hidden = !kept.length;
    el.checkFacetBlock.hidden = !checks.length;

    el.totalRows.textContent = formatNumber(state.rows.length);
    el.domainCount.textContent = formatNumber(domains.length);
    el.actionCount.textContent = formatNumber(actions.length);

    setControlsDisabled(false);
  }

  function updateDatasetChrome(dataset) {
    setViewVisibility("dataset");
    el.tabs.forEach((tab) => {
      const isActive = tab.dataset.dataset === dataset.id && !isDocView();
      tab.setAttribute("aria-selected", String(isActive));
    });

    el.domainLabel.textContent = dataset.domainLabel;
    el.domainSortOption.textContent = dataset.domainLabel;
    el.actionFacetLegend.textContent = dataset.actionLabel;
    el.actionCountLabel.textContent = dataset.actionSummaryLabel;
    el.searchInput.placeholder = `Search ${dataset.label.toLowerCase()}`;
  }

  function updateDocChrome(doc) {
    setViewVisibility("doc");
    el.tabs.forEach((tab) => {
      const isActive = tab.dataset.doc === doc.id;
      tab.setAttribute("aria-selected", String(isActive));
    });
  }

  function setViewVisibility(view) {
    const showDoc = view === "doc";
    el.topActions.hidden = showDoc;
    el.summaryGrid.hidden = showDoc;
    el.workbench.hidden = showDoc;
    el.jsonViewer.hidden = !showDoc;
  }

  function renderDomainOptions(domains, dataset) {
    el.domainSelect.textContent = "";

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = dataset.allDomainLabel;
    el.domainSelect.append(allOption);

    domains.forEach(([domain, count]) => {
      const option = document.createElement("option");
      option.value = domain;
      option.textContent = `${prettyLabel(domain)} (${formatNumber(count)})`;
      el.domainSelect.append(option);
    });

    el.domainSelect.value = state.domain;
  }

  function wireEvents() {
    let searchTimer = 0;

    el.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const datasetId = tab.dataset.dataset;
        const docId = tab.dataset.doc;
        if (datasetId && datasetId !== state.activeDatasetId) {
          selectDataset(datasetId);
        } else if (datasetId && isDocView()) {
          selectDataset(datasetId);
        } else if (docId && docId !== state.activeDocId) {
          selectDoc(docId);
        }
      });
    });

    el.searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.query = el.searchInput.value.trim().toLowerCase();
        state.page = 1;
        applyFilters();
      }, 120);
    });

    el.domainSelect.addEventListener("change", () => {
      state.domain = el.domainSelect.value;
      state.page = 1;
      applyFilters();
    });

    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      state.page = 1;
      applyFilters();
    });

    el.pageSizeSelect.addEventListener("change", () => {
      state.pageSize = Number(el.pageSizeSelect.value);
      state.page = 1;
      applyFilters();
    });

    el.prevButton.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      renderResults();
      updateUrl();
    });

    el.nextButton.addEventListener("click", () => {
      state.page = Math.min(getPageCount(), state.page + 1);
      renderResults();
      updateUrl();
    });

    el.resetButton.addEventListener("click", resetFilters);
    el.randomButton.addEventListener("click", openRandomResult);
  }

  function rowMatches(row) {
    if (state.query && !row.searchText.includes(state.query)) {
      return false;
    }

    if (state.domain && row.domain !== state.domain) {
      return false;
    }

    if (state.actions.size && ![...state.actions].every((action) => row.actions.includes(action))) {
      return false;
    }

    if (state.kept.size && ![...state.kept].every((source) => row.kept.includes(source))) {
      return false;
    }

    if (state.checks.size && ![...state.checks].every((check) => row.checks[check] === true)) {
      return false;
    }

    return true;
  }

  function sortRows(rows) {
    const sorted = [...rows];

    if (state.sort === "shortest") {
      sorted.sort((a, b) => a.length - b.length || a.index - b.index);
    } else if (state.sort === "longest") {
      sorted.sort((a, b) => b.length - a.length || a.index - b.index);
    } else if (state.sort === "domain") {
      sorted.sort((a, b) => a.domain.localeCompare(b.domain) || a.index - b.index);
    }

    return sorted;
  }

  function applyFilters() {
    state.filtered = sortRows(state.rows.filter(rowMatches));
    state.page = Math.min(state.page, getPageCount());
    renderResults();
    updateUrl();
  }

  function getPageCount() {
    return Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  }

  function renderResults() {
    const dataset = getActiveDataset();
    const pageCount = getPageCount();
    const start = (state.page - 1) * state.pageSize;
    const rows = state.filtered.slice(start, start + state.pageSize);

    el.visibleRows.textContent = formatNumber(state.filtered.length);
    el.resultTitle.textContent = `${formatNumber(state.filtered.length)} matching examples`;
    el.pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    el.prevButton.disabled = state.page <= 1;
    el.nextButton.disabled = state.page >= pageCount;
    el.randomButton.disabled = !state.filtered.length;
    el.resultsList.textContent = "";

    if (!state.filtered.length) {
      el.status.hidden = false;
      el.status.className = "status";
      el.status.textContent = `No ${dataset.label.toLowerCase()} examples match the current filters.`;
      return;
    }

    el.status.hidden = true;

    rows.forEach((row) => {
      el.resultsList.append(renderCard(row));
    });
  }

  function renderCard(row) {
    const item = document.createElement("li");
    item.className = "result-card";

    const main = document.createElement("div");
    main.className = "result-main";

    const header = document.createElement("div");
    header.className = "result-header";

    const index = document.createElement("span");
    index.className = "result-index";
    index.textContent = `#${row.index}`;

    header.append(index);
    appendRowTags(header, row);

    const prompt = document.createElement("p");
    prompt.className = "prompt clamped";
    appendHighlightedText(prompt, row.prompt, state.query);

    main.append(header, prompt);

    const summaryMetadata = row.metadata.filter((item) => item.label !== "Category reasoning");
    if (summaryMetadata.length) {
      const meta = document.createElement("p");
      meta.className = "row-meta";
      meta.textContent = summaryMetadata.map((item) => `${item.label}: ${item.value}`).join(" | ");
      main.append(meta);
    }

    const checkEntries = Object.entries(row.checks);
    if (checkEntries.length) {
      const checks = document.createElement("div");
      checks.className = "checks";
      checkEntries.forEach(([name, value]) => {
        checks.append(makeCheckPill(name, value));
      });
      main.append(checks);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "small-link";
    open.textContent = "Open";
    open.addEventListener("click", () => openDetail(row));
    actions.append(open);

    item.append(main, actions);
    return item;
  }

  function appendRowTags(container, row) {
    const seen = new Set();
    const appendUnique = (value, kind) => {
      const key = `${kind}:${value}`;
      if (value && !seen.has(key)) {
        seen.add(key);
        container.append(makeTag(value, kind));
      }
    };

    appendUnique(row.domain, "domain");
    row.actions.forEach((action) => appendUnique(action, "action"));
    row.kept.forEach((source) => appendUnique(source, "kept"));
  }

  function appendHighlightedText(node, text, query) {
    node.textContent = "";
    if (!query || query.length < 2) {
      node.textContent = text;
      return;
    }

    const lowerText = text.toLowerCase();
    let cursor = 0;
    let matchIndex = lowerText.indexOf(query);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        node.append(document.createTextNode(text.slice(cursor, matchIndex)));
      }

      const mark = document.createElement("mark");
      mark.textContent = text.slice(matchIndex, matchIndex + query.length);
      node.append(mark);

      cursor = matchIndex + query.length;
      matchIndex = lowerText.indexOf(query, cursor);
    }

    if (cursor < text.length) {
      node.append(document.createTextNode(text.slice(cursor)));
    }
  }

  function openDetail(row) {
    const dataset = DATASETS[row.datasetId] || getActiveDataset();
    const metadataText = row.metadata
      .map((item) => `${item.label}: ${item.value}`)
      .join("\n\n");

    el.dialogTitle.textContent = `Example #${row.index}`;
    el.dialogMeta.textContent = `${dataset.label} | ${prettyLabel(row.domain)} | ${formatNumber(
      row.length
    )} characters`;
    el.dialogTags.textContent = "";
    appendRowTags(el.dialogTags, row);
    el.dialogText.textContent = metadataText ? `${row.prompt}\n\n---\n\n${metadataText}` : row.prompt;

    if (typeof el.detailDialog.showModal === "function") {
      el.detailDialog.showModal();
    }
  }

  function openRandomResult() {
    if (!state.filtered.length) {
      return;
    }

    const row = state.filtered[Math.floor(Math.random() * state.filtered.length)];
    openDetail(row);
  }

  function resetFilterState() {
    state.query = "";
    state.domain = "";
    state.sort = "index";
    state.page = 1;
    state.pageSize = 25;
    state.actions.clear();
    state.kept.clear();
    state.checks.clear();
  }

  function syncFormControls() {
    el.searchInput.value = state.query;
    el.domainSelect.value = state.domain;
    el.sortSelect.value = state.sort;
    el.pageSizeSelect.value = String(state.pageSize);
  }

  function resetFilters() {
    resetFilterState();
    syncFormControls();
    initializeControls();
    applyFilters();
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (isDocView()) {
      params.set("view", state.activeDocId);
      window.history.replaceState(null, "", `?${params}`);
      return;
    }

    params.set("dataset", state.activeDatasetId);
    if (state.query) params.set("q", state.query);
    if (state.domain) params.set("domain", state.domain);
    if (state.sort !== "index") params.set("sort", state.sort);
    if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
    if (state.page > 1) params.set("page", String(state.page));
    if (state.actions.size) params.set("actions", [...state.actions].join(","));
    if (state.kept.size) params.set("kept", [...state.kept].join(","));
    if (state.checks.size) params.set("checks", [...state.checks].join(","));

    window.history.replaceState(null, "", `?${params}`);
  }

  function loadUrlState() {
    const params = new URLSearchParams(window.location.search);
    const viewId = params.get("view");
    const datasetId = params.get("dataset");

    state.activeDocId = DOCS[viewId] ? viewId : "";
    state.activeDatasetId = DATASETS[datasetId] ? datasetId : DEFAULT_DATASET_ID;
    state.query = params.get("q") || "";
    state.domain = params.get("domain") || "";
    state.sort = params.get("sort") || "index";
    state.pageSize = Number(params.get("pageSize") || 25);
    state.page = Math.max(1, Number(params.get("page") || 1));

    splitParam(params.get("actions")).forEach((value) => state.actions.add(value));
    splitParam(params.get("kept")).forEach((value) => state.kept.add(value));
    splitParam(params.get("checks")).forEach((value) => state.checks.add(value));
    syncFormControls();
  }

  function splitParam(value) {
    return value ? value.split(",").filter(Boolean) : [];
  }

  function setControlsDisabled(disabled) {
    [
      el.searchInput,
      el.domainSelect,
      el.sortSelect,
      el.pageSizeSelect,
      el.resetButton,
      el.randomButton,
      el.prevButton,
      el.nextButton,
    ].forEach((control) => {
      control.disabled = disabled;
    });
  }

  function setLoadingState(dataset) {
    setControlsDisabled(true);
    updateDatasetChrome(dataset);
    el.status.hidden = false;
    el.status.className = "status";
    el.status.textContent = `Loading ${dataset.label.toLowerCase()}...`;
    el.resultTitle.textContent = "Loading dataset";
    el.resultsList.textContent = "";
    el.totalRows.textContent = "--";
    el.visibleRows.textContent = "--";
    el.domainCount.textContent = "--";
    el.actionCount.textContent = "--";
  }

  function selectDataset(datasetId) {
    state.activeDatasetId = DATASETS[datasetId] ? datasetId : DEFAULT_DATASET_ID;
    state.activeDocId = "";
    resetFilterState();
    syncFormControls();
    loadData();
  }

  function selectDoc(docId) {
    if (!DOCS[docId]) {
      return;
    }

    state.activeDocId = docId;
    loadDoc();
  }

  function setLoadingDoc(doc) {
    setControlsDisabled(true);
    updateDocChrome(doc);
    el.jsonStatus.hidden = false;
    el.jsonStatus.className = "status";
    el.jsonStatus.textContent = `Loading ${doc.title}...`;
    el.jsonTitle.textContent = doc.title;
    el.jsonContent.textContent = "";
  }

  function renderDoc(doc, data) {
    el.jsonTitle.textContent = doc.title;
    el.jsonStatus.hidden = true;
    el.jsonContent.textContent = "";

    if (Array.isArray(data.system_prompt)) {
      el.jsonContent.append(renderPromptSection("system_prompt", data.system_prompt));
    }

    if (data.models_by_pass && typeof data.models_by_pass === "object") {
      el.jsonContent.append(renderModelsSection(data.models_by_pass));
    }

    Object.entries(data).forEach(([key, value]) => {
      if (key === "system_prompt" || key === "models_by_pass") {
        return;
      }

      el.jsonContent.append(renderJsonSection(key, value));
    });
  }

  function makeDocSection(title) {
    const section = document.createElement("section");
    section.className = "doc-section";

    const heading = document.createElement("h3");
    heading.className = "doc-section-title";
    heading.textContent = title;
    section.append(heading);

    return section;
  }

  function renderPromptSection(title, lines) {
    const section = makeDocSection(title);
    const lineList = document.createElement("div");
    lineList.className = "prompt-lines";

    lines.forEach((line) => {
      lineList.append(renderPromptLine(line));
    });

    section.append(lineList);
    return section;
  }

  function renderPromptLine(line) {
    if (line === "") {
      const spacer = document.createElement("div");
      spacer.className = "prompt-spacer";
      return spacer;
    }

    const block = document.createElement(line.trim().startsWith("{") ? "pre" : "p");
    block.className = `prompt-line ${getPromptLineClass(line)}`.trim();
    block.textContent = line;
    return block;
  }

  function getPromptLineClass(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      return "schema";
    }
    if (/^\d+\.\s/.test(trimmed)) {
      return "numbered";
    }
    if (trimmed.startsWith("- ")) {
      return "bullet";
    }
    if (trimmed.endsWith(":")) {
      return "heading";
    }
    return "";
  }

  function renderModelsSection(modelsByPass) {
    const section = makeDocSection("models_by_pass");
    const grid = document.createElement("div");
    grid.className = "model-grid";

    Object.entries(modelsByPass).forEach(([passName, models]) => {
      Object.entries(models).forEach(([modelKey, modelName]) => {
        const row = document.createElement("div");
        row.className = "model-row";

        [passName, modelKey].forEach((value) => {
          const cell = document.createElement("span");
          cell.className = "model-key";
          cell.textContent = value;
          row.append(cell);
        });

        const valueCell = document.createElement("span");
        valueCell.className = "model-value";
        valueCell.textContent = modelName;
        row.append(valueCell);
        grid.append(row);
      });
    });

    section.append(grid);
    return section;
  }

  function renderJsonSection(key, value) {
    const section = makeDocSection(key);
    const block = document.createElement("pre");
    block.className = "prompt-line schema";
    block.textContent = JSON.stringify(value, null, 2);
    section.append(block);
    return section;
  }

  async function loadDoc() {
    const doc = getActiveDoc();
    if (!doc) {
      return;
    }

    const token = (loadToken += 1);
    setLoadingDoc(doc);

    try {
      if (!docCache.has(doc.id)) {
        const response = await fetch(doc.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        docCache.set(doc.id, await response.json());
      }

      if (token !== loadToken) {
        return;
      }

      renderDoc(doc, docCache.get(doc.id));
      updateUrl();
    } catch (error) {
      if (token !== loadToken) {
        return;
      }

      el.jsonStatus.className = "status error";
      el.jsonStatus.textContent = `Could not load ${doc.url}: ${error.message}`;
      el.jsonTitle.textContent = "Filter unavailable";
    }
  }

  async function loadData() {
    const dataset = getActiveDataset();
    const token = (loadToken += 1);
    setLoadingState(dataset);

    try {
      if (!datasetCache.has(dataset.id)) {
        const response = await fetch(dataset.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        datasetCache.set(dataset.id, toRecords(parseCsv(text), dataset));
      }

      if (token !== loadToken) {
        return;
      }

      state.rows = datasetCache.get(dataset.id);
      state.filtered = state.rows;
      initializeControls();
      syncFormControls();
      applyFilters();
    } catch (error) {
      if (token !== loadToken) {
        return;
      }

      setControlsDisabled(true);
      el.status.className = "status error";
      el.status.textContent = `Could not load ${dataset.url}: ${error.message}`;
      el.resultTitle.textContent = "Dataset unavailable";
    }
  }

  wireEvents();
  loadUrlState();
  if (isDocView()) {
    loadDoc();
  } else {
    loadData();
  }
})();
