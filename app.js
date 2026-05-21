(function () {
  "use strict";

  const DATA_URL = "wildchat_agency_examples.csv";
  const CHECK_LABELS = {
    build_resilience_to_exogenous_shocks: "Resilience to shocks",
    exist_better_in_world: "Better option exists",
    make_world_work_better_for_user: "World works better for user",
  };

  const state = {
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
    totalRows: document.getElementById("totalRows"),
    visibleRows: document.getElementById("visibleRows"),
    domainCount: document.getElementById("domainCount"),
    actionCount: document.getElementById("actionCount"),
    searchInput: document.getElementById("searchInput"),
    domainSelect: document.getElementById("domainSelect"),
    sortSelect: document.getElementById("sortSelect"),
    pageSizeSelect: document.getElementById("pageSizeSelect"),
    actionFacets: document.getElementById("actionFacets"),
    keptFacets: document.getElementById("keptFacets"),
    checkFacets: document.getElementById("checkFacets"),
    resultTitle: document.getElementById("resultTitle"),
    status: document.getElementById("status"),
    resultsList: document.getElementById("resultsList"),
    prevButton: document.getElementById("prevButton"),
    nextButton: document.getElementById("nextButton"),
    pageLabel: document.getElementById("pageLabel"),
    resetButton: document.getElementById("resetButton"),
    randomButton: document.getElementById("randomButton"),
    detailDialog: document.getElementById("detailDialog"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogMeta: document.getElementById("dialogMeta"),
    dialogTags: document.getElementById("dialogTags"),
    dialogText: document.getElementById("dialogText"),
  };

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

  function toRecords(csvRows) {
    const headers = csvRows.shift().map((header) => header.trim());

    return csvRows
      .filter((row) => row.length > 1)
      .map((row, index) => {
        const record = {};
        headers.forEach((header, columnIndex) => {
          record[header] = row[columnIndex] || "";
        });

        const actions = readJson(record.action_types, []);
        const kept = readJson(record.kept_by, []);
        const checks = readJson(record.secondary_checks, {});
        const prompt = record.user_input || "";

        return {
          index: index + 1,
          prompt,
          promptLower: prompt.toLowerCase(),
          domain: record.domain || "unknown",
          definitionKeep: record.definition_keep === "True",
          actions,
          kept,
          checks,
          length: prompt.length,
          searchText: [
            prompt,
            record.domain,
            actions.join(" "),
            kept.join(" "),
            Object.keys(checks).join(" "),
          ]
            .join(" ")
            .toLowerCase(),
        };
      });
  }

  function readJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function countBy(rows, getter) {
    const counts = new Map();
    rows.forEach((row) => {
      getter(row).forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function prettyLabel(value) {
    return CHECK_LABELS[value] || value.replaceAll("_", " ");
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
    const domains = countBy(state.rows, (row) => [row.domain]);
    const actions = countBy(state.rows, (row) => row.actions);
    const kept = countBy(state.rows, (row) => row.kept);
    const checks = countBy(state.rows, (row) =>
      Object.entries(row.checks)
        .filter(([, value]) => value)
        .map(([key]) => key)
    );

    domains.forEach(([domain, count]) => {
      const option = document.createElement("option");
      option.value = domain;
      option.textContent = `${prettyLabel(domain)} (${formatNumber(count)})`;
      el.domainSelect.append(option);
    });

    renderFacets(el.actionFacets, actions, "actions");
    renderFacets(el.keptFacets, kept, "kept");
    renderFacets(el.checkFacets, checks, "checks");

    el.totalRows.textContent = formatNumber(state.rows.length);
    el.domainCount.textContent = formatNumber(domains.length);
    el.actionCount.textContent = formatNumber(actions.length);

    [
      el.searchInput,
      el.domainSelect,
      el.sortSelect,
      el.pageSizeSelect,
      el.resetButton,
      el.randomButton,
    ].forEach((control) => {
      control.disabled = false;
    });
  }

  function wireEvents() {
    let searchTimer = 0;

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
    });

    el.nextButton.addEventListener("click", () => {
      state.page = Math.min(getPageCount(), state.page + 1);
      renderResults();
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
      el.status.textContent = "No examples match the current filters.";
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

    header.append(index, makeTag(row.domain, "domain"));
    row.actions.forEach((action) => header.append(makeTag(action, "action")));
    row.kept.forEach((source) => header.append(makeTag(source, "kept")));

    const prompt = document.createElement("p");
    prompt.className = "prompt clamped";
    appendHighlightedText(prompt, row.prompt, state.query);

    const checks = document.createElement("div");
    checks.className = "checks";
    Object.entries(row.checks).forEach(([name, value]) => {
      checks.append(makeCheckPill(name, value));
    });

    main.append(header, prompt, checks);

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
    el.dialogTitle.textContent = `Example #${row.index}`;
    el.dialogMeta.textContent = `${prettyLabel(row.domain)} | ${formatNumber(row.length)} characters`;
    el.dialogTags.textContent = "";
    el.dialogTags.append(makeTag(row.domain, "domain"));
    row.actions.forEach((action) => el.dialogTags.append(makeTag(action, "action")));
    row.kept.forEach((source) => el.dialogTags.append(makeTag(source, "kept")));
    el.dialogText.textContent = row.prompt;

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

  function resetFilters() {
    state.query = "";
    state.domain = "";
    state.sort = "index";
    state.page = 1;
    state.pageSize = 25;
    state.actions.clear();
    state.kept.clear();
    state.checks.clear();

    el.searchInput.value = "";
    el.domainSelect.value = "";
    el.sortSelect.value = "index";
    el.pageSizeSelect.value = "25";

    renderFacets(el.actionFacets, countBy(state.rows, (row) => row.actions), "actions");
    renderFacets(el.keptFacets, countBy(state.rows, (row) => row.kept), "kept");
    renderFacets(
      el.checkFacets,
      countBy(state.rows, (row) =>
        Object.entries(row.checks)
          .filter(([, value]) => value)
          .map(([key]) => key)
      ),
      "checks"
    );

    applyFilters();
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.domain) params.set("domain", state.domain);
    if (state.sort !== "index") params.set("sort", state.sort);
    if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
    if (state.actions.size) params.set("actions", [...state.actions].join(","));
    if (state.kept.size) params.set("kept", [...state.kept].join(","));
    if (state.checks.size) params.set("checks", [...state.checks].join(","));

    const next = params.toString() ? `?${params}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }

  function loadUrlState() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get("q") || "";
    state.domain = params.get("domain") || "";
    state.sort = params.get("sort") || "index";
    state.pageSize = Number(params.get("pageSize") || 25);

    splitParam(params.get("actions")).forEach((value) => state.actions.add(value));
    splitParam(params.get("kept")).forEach((value) => state.kept.add(value));
    splitParam(params.get("checks")).forEach((value) => state.checks.add(value));

    el.searchInput.value = state.query;
    el.domainSelect.value = state.domain;
    el.sortSelect.value = state.sort;
    el.pageSizeSelect.value = String(state.pageSize);
  }

  function splitParam(value) {
    return value ? value.split(",").filter(Boolean) : [];
  }

  async function loadData() {
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      state.rows = toRecords(parseCsv(text));
      state.filtered = state.rows;
      initializeControls();
      loadUrlState();
      applyFilters();
    } catch (error) {
      el.status.className = "status error";
      el.status.textContent = `Could not load ${DATA_URL}: ${error.message}`;
      el.resultTitle.textContent = "Dataset unavailable";
    }
  }

  wireEvents();
  loadData();
})();
