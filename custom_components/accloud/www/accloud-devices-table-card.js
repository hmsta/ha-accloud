class AccCloudDevicesTableCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rows = [];
    this._search = "";
    this._filters = this._defaultFilters();
    this._sortKey = "location";
    this._sortDir = 1;
    this._page = 0;
    this._pageSize = 25;
    this._mobilePageSize = 10;
    this._totalRows = 0;
    this._filteredCount = 0;
    this._pageCount = 1;
    this._filterOptions = {};
    this._columns = [];
    this._mobileColumns = [];
    this._columnDefsCache = null;
    this._error = "";
    this._lastFetch = 0;
    this._fetchTimer = null;
    this._fetchInFlight = false;
    this._fetchQueued = false;
    this._refreshTimer = null;
    this._shellRendered = false;
    this._isMobile = false;
    this._mediaQuery = null;
    this._entryResolving = null;
    this._resolvedEntryId = "";
    this._preferencesLoadedKey = "";
    this._activeDialog = null;
  }

  setConfig(config) {
    this._config = {
      page_size: 25,
      mobile_page_size: 10,
      page_size_options: [25, 50, 100],
      default_sort_key: this._defaultSortKey(),
      default_sort_dir: 1,
      remember_preferences: true,
      refresh_interval_ms: 60000,
      search_debounce_ms: 150,
      columns: this._defaultColumns(),
      mobile_columns: this._defaultMobileColumns(),
      ...config,
    };
    this._pageSize = Number(this._config.page_size) || 25;
    this._mobilePageSize = Number(this._config.mobile_page_size) || 10;
    this._sortKey = this._config.default_sort_key || this._defaultSortKey();
    this._sortDir = this._config.default_sort_dir === -1 ? -1 : 1;
    this._columns = this._validColumns(this._config.columns, this._defaultColumns());
    this._mobileColumns = this._validColumns(this._config.mobile_columns, this._defaultMobileColumns());
    this._setupMediaQuery();
    this._loadPreferences(true);
    this._renderShell();
    this._refreshTable();
  }

  set hass(hass) {
    const firstUpdate = !this._hass;
    this._hass = hass;
    if (firstUpdate || Date.now() - this._lastFetch >= this._autoRefreshMs()) {
      this._scheduleFetch(firstUpdate);
    }
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: "full", min_columns: 4 };
  }

  disconnectedCallback() {
    this._closeDialog();
    if (this._fetchTimer) window.clearTimeout(this._fetchTimer);
    if (this._refreshTimer) window.clearTimeout(this._refreshTimer);
  }

  static getStubConfig() {
    return { type: "custom:accloud-devices-table-card" };
  }

  _columnDefs() {
    if (this._columnDefsCache) return this._columnDefsCache;
    this._columnDefsCache = [
      ["details", "More", (_row, index) => this._detailsButton(index), () => ""],
      ["location", "Location"],
      ["remark", "Remark"],
      ["room", "Room"],
      ["device", "Device"],
      ["firmware", "FW"],
      ["online", "Online"],
      ["power", "Power"],
      ["mode", "Mode"],
      ["set_temp", "Set Temp"],
      ["room_temp", "Room Temp"],
      ["fan", "Fan"],
      ["swing", "Swing"],
      ["timer", "Timer"],
      ["schedule", "Schedule"],
      ["last_action", "Last Action", (row) => this._timeCellHtml(row, "last_action")],
      ["last_seen", "Last Seen", (row) => this._timeCellHtml(row, "last_seen")],
      ["actions", "Actions"],
    ].map(([key, label, render, sort]) => ({
      key,
      label,
      render: render || ((row) => this._cellHtml(row, key)),
      sort: sort || ((row) => this._cellValue(row, key)),
    }));
    return this._columnDefsCache;
  }

  _defaultColumns() {
    return ["location", "room", "online", "power", "mode", "set_temp", "room_temp", "last_action", "details"];
  }

  _defaultMobileColumns() {
    return ["location", "room", "online", "power", "mode", "last_action", "details"];
  }

  _defaultSortKey() {
    return "location";
  }

  _storageNamespace() {
    return "devices_table";
  }

  _websocketType() {
    return "accloud/get_devices";
  }

  _responseKey() {
    return "devices";
  }

  _searchPlaceholder() {
    return "Search devices";
  }

  _emptyLabel() {
    return "devices";
  }

  _defaultFilters() {
    return { status: "", power: "", filter: "" };
  }

  _filterDefs() {
    return [
      { key: "status", label: "Status", values: ["online", "offline"], param: "status" },
      { key: "power", label: "Power", values: ["on", "off"], param: "power" },
      { key: "filter", label: "Issue", values: ["schedule-warning", "model-warning", "old-firmware"], optionsKey: "issues", param: "filter" },
    ];
  }

  _rowTitle(row) {
    return this._cellText(row, "room") || this._cellText(row, "device") || "Device";
  }

  _activeColumns() {
    return this._isMobile ? this._mobileColumns : this._columns;
  }

  _setActiveColumns(columns) {
    if (this._isMobile) this._mobileColumns = columns;
    else this._columns = columns;
  }

  _activeDefaultColumns() {
    return this._isMobile ? this._defaultMobileColumns() : this._defaultColumns();
  }

  _activePageSize() {
    return this._isMobile ? this._mobilePageSize : this._pageSize;
  }

  _setActivePageSize(value) {
    if (this._isMobile) this._mobilePageSize = value;
    else this._pageSize = value;
  }

  _setupMediaQuery() {
    if (this._mediaQuery || !window.matchMedia) {
      this._isMobile = window.innerWidth <= 760;
      return;
    }
    this._mediaQuery = window.matchMedia("(max-width: 760px)");
    this._isMobile = this._mediaQuery.matches;
    const listener = (event) => {
      this._isMobile = event.matches;
      this._page = 0;
      if (this._shellRendered) {
        this._refreshColumnPicker();
        this._renderHeaders();
        this._refreshPageSize();
        this._refreshMobileSortControls();
        this._scheduleFetch(true);
      }
    };
    if (this._mediaQuery.addEventListener) this._mediaQuery.addEventListener("change", listener);
    else this._mediaQuery.addListener(listener);
  }

  _storageKey() {
    const key = this._config.storage_key || this._config.entry_id || this._resolvedEntryId || "auto";
    return `accloud.${this._storageNamespace()}.${key}`;
  }

  _loadPreferences(force = false) {
    const storageKey = this._storageKey();
    if (!this._config.remember_preferences || (!force && this._preferencesLoadedKey === storageKey)) return;
    this._preferencesLoadedKey = storageKey;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (Array.isArray(prefs.columns)) this._columns = this._validColumns(prefs.columns, this._defaultColumns());
      if (Array.isArray(prefs.mobile_columns)) this._mobileColumns = this._validColumns(prefs.mobile_columns, this._defaultMobileColumns());
      if (Number.isFinite(Number(prefs.page_size))) this._pageSize = Number(prefs.page_size);
      if (Number.isFinite(Number(prefs.mobile_page_size))) this._mobilePageSize = Number(prefs.mobile_page_size);
      if (typeof prefs.sort_key === "string") this._sortKey = prefs.sort_key;
      if (prefs.sort_dir === 1 || prefs.sort_dir === -1) this._sortDir = prefs.sort_dir;
      if (prefs.filters && typeof prefs.filters === "object") this._filters = this._normalizeFilters(prefs.filters);
    } catch (_) {
      window.localStorage.removeItem(storageKey);
    }
  }

  _savePreferences() {
    if (!this._config.remember_preferences) return;
    try {
      window.localStorage.setItem(this._storageKey(), JSON.stringify({
        columns: this._columns,
        mobile_columns: this._mobileColumns,
        page_size: this._pageSize,
        mobile_page_size: this._mobilePageSize,
        sort_key: this._sortKey,
        sort_dir: this._sortDir,
        filters: this._filters,
      }));
    } catch (_) {
      // Browser storage can be unavailable in restricted web views.
    }
  }

  _resetPreferences() {
    try {
      window.localStorage.removeItem(this._storageKey());
    } catch (_) {
      // Browser storage can be unavailable in restricted web views.
    }
    this._columns = this._validColumns(this._config.columns, this._defaultColumns());
    this._mobileColumns = this._validColumns(this._config.mobile_columns, this._defaultMobileColumns());
    this._pageSize = Number(this._config.page_size) || 25;
    this._mobilePageSize = Number(this._config.mobile_page_size) || 10;
    this._sortKey = this._config.default_sort_key || this._defaultSortKey();
    this._sortDir = this._config.default_sort_dir === -1 ? -1 : 1;
    this._filters = this._defaultFilters();
    this._search = "";
    this._page = 0;
    this.shadowRoot.getElementById("search").value = "";
    this._closeOptions();
    this._refreshFilterOptions();
    this._refreshColumnPicker();
    this._refreshPageSize();
    this._renderHeaders();
    this._refreshMobileSortControls();
    this._scheduleFetch(true);
  }

  _validColumns(columns, fallback) {
    const valid = new Set(this._columnDefs().map((col) => col.key));
    const normalized = [];
    for (const key of Array.isArray(columns) ? columns : fallback) {
      if (valid.has(key) && key !== "details" && !normalized.includes(key)) normalized.push(key);
    }
    if (!normalized.length && Array.isArray(fallback)) {
      for (const key of fallback) {
        if (valid.has(key) && key !== "details" && !normalized.includes(key)) normalized.push(key);
      }
    }
    normalized.push("details");
    return normalized;
  }

  _scheduleFetch(immediate = false) {
    if (!this._hass) return;
    if (this._fetchInFlight) {
      if (immediate) this._fetchQueued = true;
      return;
    }
    const wait = immediate ? 0 : Math.max(0, 5000 - (Date.now() - this._lastFetch));
    if (this._fetchTimer) {
      if (immediate) {
        window.clearTimeout(this._fetchTimer);
        this._fetchTimer = null;
      } else {
        return;
      }
    }
    this._fetchTimer = window.setTimeout(() => {
      this._fetchTimer = null;
      this._fetch();
    }, wait);
  }

  async _fetch() {
    if (!this._hass || this._fetchInFlight) {
      this._fetchQueued = Boolean(this._hass);
      return;
    }
    this._fetchInFlight = true;
    try {
      const entryId = await this._entryId();
      if (!entryId) return;
      const result = await this._hass.callWS({
        type: this._websocketType(),
        entry_id: entryId,
        page: this._page,
        page_size: this._activePageSize(),
        search: this._search,
        sort_key: this._sortKey,
        sort_dir: this._sortDir,
        filters: this._apiFilters(),
      });
      this._rows = result[this._responseKey()] || [];
      this._page = Number(result.page || 0);
      this._totalRows = Number(result.total || 0);
      this._filteredCount = Number(result.filtered || 0);
      this._pageCount = Number(result.page_count || 1);
      this._filterOptions = result.filter_options || {};
      this._error = "";
      this._refreshFilterOptions();
      this._refreshPageSize();
    } catch (err) {
      this._error = err.message || String(err);
    } finally {
      this._lastFetch = Date.now();
      this._fetchInFlight = false;
      this._refreshTable();
      if (this._fetchQueued) {
        this._fetchQueued = false;
        this._scheduleFetch(true);
      }
    }
  }

  _autoRefreshMs() {
    const configured = Number(this._config?.refresh_interval_ms);
    return Number.isFinite(configured) && configured >= 10000 ? configured : 60000;
  }

  async _entryId() {
    if (this._config.entry_id) {
      this._loadPreferences();
      if (this._shellRendered) this._refreshPageSize();
      return this._config.entry_id;
    }
    if (!this._entryResolving) this._entryResolving = this._hass.callWS({ type: "accloud/get_entries" });
    try {
      const result = await this._entryResolving;
      const entries = result.entries || [];
      if (entries.length === 1) {
        this._resolvedEntryId = entries[0].entry_id;
        this._loadPreferences(true);
        this._refreshColumnPicker();
        this._renderHeaders();
        this._refreshPageSize();
        return this._resolvedEntryId;
      }
      this._error = entries.length
        ? `Multiple AccCloud integrations found. Set entry_id to one of: ${entries.map((entry) => `${entry.title} (${entry.entry_id})`).join(", ")}`
        : "No loaded AccCloud integration found.";
      return "";
    } catch (err) {
      this._error = err.message || String(err);
      return "";
    }
  }

  _renderShell() {
    if (!this.shadowRoot || this._shellRendered) return;
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="wrap">
          <div class="toolbar">
            <input id="search" type="search" placeholder="${this._escape(this._searchPlaceholder())}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            ${this._filterControlsHtml()}
            <button id="clear-filters" type="button" hidden>Clear</button>
            <select id="page-size" title="Rows per page"></select>
            <select id="mobile-sort" class="mobile-sort" title="Sort field" aria-label="Sort field"></select>
            <button id="mobile-sort-dir" class="mobile-sort mobile-sort-dir" type="button" title="Sort direction" aria-label="Sort direction"></button>
            <div class="options">
              <button id="options" class="options-button" type="button" title="Table options" aria-label="Table options">
                <span></span><span></span><span></span>
              </button>
            </div>
          </div>
          <div id="meta" class="meta"></div>
          <div class="table-wrap">
            <table>
              <thead><tr id="headers"></tr></thead>
              <tbody id="rows"></tbody>
            </table>
          </div>
          <div class="mobile-list" id="mobile-rows"></div>
          <div class="pager">
            <button id="prev" type="button">Prev</button>
            <span id="page-info"></span>
            <button id="next" type="button">Next</button>
          </div>
        </div>
      </ha-card>
      ${this._styles()}
    `;
    this.shadowRoot.getElementById("search").addEventListener("input", (event) => {
      this._search = event.target.value;
      this._page = 0;
      this._debouncedFetch();
    });
    for (const select of this.shadowRoot.querySelectorAll("select[data-filter-key]")) {
      select.addEventListener("change", (event) => {
        this._filters[event.target.dataset.filterKey] = event.target.value;
        this._page = 0;
        this._savePreferences();
        this._scheduleFetch(true);
      });
    }
    this.shadowRoot.getElementById("clear-filters").addEventListener("click", () => this._clearFilters());
    this.shadowRoot.getElementById("options").addEventListener("click", (event) => {
      event.stopPropagation();
      this._toggleOptions();
    });
    this.shadowRoot.getElementById("page-size").addEventListener("change", (event) => {
      this._setActivePageSize(Number(event.target.value));
      this._page = 0;
      this._savePreferences();
      this._scheduleFetch(true);
    });
    this.shadowRoot.getElementById("mobile-sort").addEventListener("change", (event) => {
      this._sortKey = event.target.value;
      this._page = 0;
      this._savePreferences();
      this._renderHeaders();
      this._refreshMobileSortControls();
      this._scheduleFetch(true);
    });
    this.shadowRoot.getElementById("mobile-sort-dir").addEventListener("click", () => {
      this._sortDir *= -1;
      this._page = 0;
      this._savePreferences();
      this._renderHeaders();
      this._refreshMobileSortControls();
      this._scheduleFetch(true);
    });
    this.shadowRoot.getElementById("prev").addEventListener("click", () => {
      this._page = Math.max(0, this._page - 1);
      this._scheduleFetch(true);
    });
    this.shadowRoot.getElementById("next").addEventListener("click", () => {
      this._page += 1;
      this._scheduleFetch(true);
    });
    this._refreshPageSize();
    this._renderHeaders();
    this._refreshMobileSortControls();
    this._refreshColumnPicker();
    this._refreshFilterOptions();
    this._shellRendered = true;
  }

  _styles() {
    return `<style>
      :host { display: block; min-width: 0; width: 100%; }
      ha-card { display: block; max-width: 100%; overflow: hidden; width: 100%; }
      ha-card, .wrap, table, th, td, button, .mobile-list, .details { -webkit-user-select: text; user-select: text; }
      .wrap { box-sizing: border-box; min-width: 0; padding: 12px; width: 100%; }
      .toolbar { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; position: relative; }
      .toolbar input { flex: 1 1 220px; min-width: 160px; }
      .toolbar select { flex: 0 1 150px; min-width: 96px; }
      .mobile-sort { display: none; }
      .mobile-sort-dir { flex: 0 0 42px; min-width: 42px; padding: 0; }
      input:not([type="checkbox"]), select, button { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 6px; color: var(--primary-text-color); min-height: 32px; padding: 0 8px; }
      button { cursor: pointer; }
      a { color: var(--primary-color); text-decoration: none; }
      .meta, #page-info, .muted { color: var(--secondary-text-color); font-size: 12px; }
      .options { position: relative; }
      .options-button { align-items: center; display: inline-flex; flex-direction: column; gap: 3px; justify-content: center; min-width: 34px; padding: 0; }
      .options-button span { background: var(--primary-text-color); border-radius: 999px; display: block; height: 2px; width: 16px; }
      .table-wrap { overflow-x: auto; overflow-y: visible; width: 100%; }
      table { border-collapse: collapse; min-width: max-content; width: 100%; }
      th, td { border-bottom: 1px solid var(--divider-color); font-size: 13px; padding: 6px 8px; text-align: left; white-space: nowrap; }
      th { background: var(--card-background-color); position: sticky; top: 0; z-index: 1; }
      th button, .icon-button { background: transparent; border: 0; min-height: 0; padding: 0; }
      .mono { font-family: var(--code-font-family, monospace); }
      .numeric, .align-right { text-align: right; }
      .pill { border-radius: 999px; display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px; }
      .ok { background: rgba(36, 161, 72, 0.14); color: #1a7f37; }
      .warn, .bad { background: rgba(207, 34, 46, 0.12); color: #cf222e; }
      .light { background: rgba(127, 127, 127, 0.14); color: var(--secondary-text-color); }
      .admin-time-toggle { cursor: pointer; }
      .admin-time-toggle:hover, .admin-time-toggle:focus { outline: none; text-decoration: underline; }
      .actions details { position: relative; }
      .actions summary { cursor: pointer; list-style: none; }
      .actions summary::-webkit-details-marker { display: none; }
      .actions details > div { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.18); display: grid; gap: 2px; padding: 4px; position: absolute; right: 0; z-index: 5; }
      .actions .menu-item { align-items: center; display: flex; gap: 6px; padding: 6px 8px; white-space: nowrap; }
      .state-icon { display: none; }
      .empty { color: var(--secondary-text-color); padding: 18px 8px; text-align: center; }
      .mobile-list { display: none; }
      .mobile-row { border-bottom: 1px solid var(--divider-color); display: grid; gap: 5px; padding: 10px 0; }
      .mobile-main { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
      .mobile-fields { display: grid; gap: 4px 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mobile-field { min-width: 0; }
      .mobile-label { color: var(--secondary-text-color); display: block; font-size: 11px; }
      .mobile-value { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pager { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      @media (max-width: 760px) {
        .wrap { padding: 10px; }
        .toolbar input, .toolbar select { flex: 1 1 calc(50% - 8px); min-width: 0; }
        .mobile-sort { display: block; }
        .mobile-sort-dir { align-items: center; display: inline-flex; justify-content: center; }
        .options { position: static; }
        .table-wrap { display: none; }
        .mobile-list { display: block; }
      }
    </style>`;
  }

  _renderHeaders() {
    const defs = new Map(this._columnDefs().map((col) => [col.key, col]));
    this.shadowRoot.getElementById("headers").innerHTML = this._activeColumns()
      .map((key) => defs.get(key))
      .filter(Boolean)
      .map((col) => this._header(col.key, col.label))
      .join("");
    for (const button of this.shadowRoot.querySelectorAll("th button[data-key]")) {
      button.addEventListener("click", () => this._sort(button.dataset.key));
    }
  }

  _refreshMobileSortControls() {
    const select = this.shadowRoot.getElementById("mobile-sort");
    const button = this.shadowRoot.getElementById("mobile-sort-dir");
    if (!select || !button) return;
    const columns = this._columnDefs().filter((col) => col.key !== "details");
    select.innerHTML = columns.map((col) => `<option value="${this._escape(col.key)}">${this._escape(col.label)}</option>`).join("");
    if (!columns.some((col) => col.key === this._sortKey)) this._sortKey = columns[0]?.key || "";
    select.value = this._sortKey;
    button.textContent = this._sortDir === 1 ? "^" : "v";
  }

  _refreshColumnPicker() {
    const panel = this._activeDialog?.querySelector("[data-column-panel]");
    if (!panel) return;
    const selected = this._activeColumns();
    panel.innerHTML = this._columnDefs().filter((col) => col.key !== "details").map((col) => `
      <label>
        <input type="checkbox" value="${this._escape(col.key)}" ${selected.includes(col.key) ? "checked" : ""}>
        ${this._escape(col.label)}
      </label>`).join("");
    for (const input of panel.querySelectorAll("input")) {
      input.addEventListener("change", () => {
        const checked = Array.from(panel.querySelectorAll("input:checked")).map((item) => item.value);
        this._setActiveColumns(this._validColumns(checked, this._activeDefaultColumns()));
        this._savePreferences();
        this._refreshColumnPicker();
        this._renderHeaders();
        this._refreshTable();
      });
    }
  }

  _refreshPageSize() {
    const select = this.shadowRoot.getElementById("page-size");
    const pageSize = this._activePageSize();
    const options = [...new Set([...(this._config.page_size_options || []), pageSize, 0])];
    select.innerHTML = options
      .filter((value) => Number.isFinite(Number(value)))
      .map((value) => `<option value="${Number(value)}">${Number(value) === 0 ? "All" : `${Number(value)} rows`}</option>`)
      .join("");
    select.value = String(pageSize);
  }

  _refreshTable() {
    this._renderShell();
    const rows = this._rows;
    const pageSize = this._activePageSize();
    const start = this._filteredCount === 0 ? 0 : pageSize === 0 ? 1 : this._page * pageSize + 1;
    const end = pageSize === 0 ? this._filteredCount : Math.min(this._filteredCount, start + rows.length - 1);
    this.shadowRoot.getElementById("meta").textContent = `${this._filteredCount} matched of ${this._totalRows}${this._error ? ` - ${this._error}` : ""}`;
    this.shadowRoot.getElementById("page-info").textContent = pageSize === 0 ? `All ${this._filteredCount}` : `${start}-${end} of ${this._filteredCount}`;
    this.shadowRoot.getElementById("prev").disabled = this._page <= 0 || pageSize === 0;
    this.shadowRoot.getElementById("next").disabled = pageSize === 0 || this._page >= this._pageCount - 1;
    this.shadowRoot.getElementById("clear-filters").hidden = !this._hasActiveFilters();
    const defs = new Map(this._columnDefs().map((col) => [col.key, col]));
    const columns = this._activeColumns();
    const desktopRows = this.shadowRoot.getElementById("rows");
    const mobileRows = this.shadowRoot.getElementById("mobile-rows");
    if (this._isMobile) {
      desktopRows.innerHTML = "";
      mobileRows.innerHTML = rows.length
        ? rows.map((row, index) => this._mobileRow(row, index, defs, columns)).join("")
        : `<div class="empty">No matching ${this._escape(this._emptyLabel())}</div>`;
    } else {
      mobileRows.innerHTML = "";
      desktopRows.innerHTML = rows.length
        ? rows.map((row, index) => `<tr>${columns.map((key) => `<td class="${this._escape(this._cellClass(row, key))}">${defs.get(key).render(row, index)}</td>`).join("")}</tr>`).join("")
        : `<tr><td class="empty" colspan="${columns.length || 1}">No matching ${this._escape(this._emptyLabel())}</td></tr>`;
    }
    for (const button of this.shadowRoot.querySelectorAll("button[data-details]")) {
      button.addEventListener("click", () => this._showDetails(rows[Number(button.dataset.details)]));
    }
    this._hydrateTimeToggles(this.shadowRoot);
  }

  _mobileRow(row, index, defs, columns) {
    const main = this._rowTitle(row);
    const fields = columns.filter((key) => key !== "details").slice(0, 6);
    return `
      <div class="mobile-row">
        <div class="mobile-main">
          <strong>${this._escape(main)}</strong>
          ${this._detailsButton(index)}
        </div>
        <div class="mobile-fields">
          ${fields.map((key) => `<div class="mobile-field"><span class="mobile-label">${this._escape(defs.get(key).label)}</span><span class="mobile-value">${defs.get(key).render(row, index)}</span></div>`).join("")}
        </div>
      </div>`;
  }

  _refreshFilterOptions() {
    if (!this.shadowRoot || !this._shellRendered) return;
    this._filters = this._normalizeFilters(this._filters);
    for (const def of this._filterDefs()) {
      this._setFilterOptions(def);
    }
  }

  _filterControlsHtml() {
    return this._filterDefs()
      .map((def) => `<select id="filter-${this._escape(def.key)}" data-filter-key="${this._escape(def.key)}" aria-label="${this._escape(def.label)}"></select>`)
      .join("");
  }

  _setFilterOptions(def) {
    const select = this.shadowRoot.getElementById(`filter-${def.key}`);
    if (!select) return;
    const current = this._filters[def.key] || "";
    const values = this._filterValues(def);
    select.innerHTML = [`<option value="">${this._escape(def.label)}</option>`, ...values.map((value) => `<option value="${this._escape(value)}">${this._escape(this._filterLabel(value))}</option>`)].join("");
    select.value = values.includes(current) ? current : "";
    this._filters[def.key] = select.value;
  }

  _filterValues(def) {
    const options = this._filterOptions[def.optionsKey || def.key];
    const values = Array.isArray(options) && options.length ? options : def.values || [];
    return values.map((value) => String(value)).filter((value) => !def.values || def.values.includes(value));
  }

  _normalizeFilters(filters) {
    const normalized = { ...this._defaultFilters() };
    if (!filters || typeof filters !== "object") return normalized;
    for (const key of Object.keys(normalized)) {
      if (typeof filters[key] === "string") normalized[key] = filters[key];
    }
    if (typeof filters.filter === "string") {
      if ("status" in normalized && (filters.filter === "online" || filters.filter === "offline") && !normalized.status) {
        normalized.status = filters.filter;
        normalized.filter = "";
      } else if ("power" in normalized && filters.filter === "power-on" && !normalized.power) {
        normalized.power = "on";
        normalized.filter = "";
      }
    }
    return normalized;
  }

  _filterLabel(value) {
    return {
      online: "Online",
      offline: "Offline",
      on: "On",
      off: "Off",
      "power-on": "Power on",
      "schedule-warning": "Schedule warning",
      "model-warning": "Model warning",
      "old-firmware": "Old firmware",
    }[value] || value;
  }

  _sort(key) {
    if (key === "details") return;
    if (this._sortKey === key) this._sortDir *= -1;
    else {
      this._sortKey = key;
      this._sortDir = 1;
    }
    this._page = 0;
    this._savePreferences();
    this._renderHeaders();
    this._refreshMobileSortControls();
    this._scheduleFetch(true);
  }

  _showDetails(row) {
    if (!row) return;
    const body = this._columnDefs()
      .filter((col) => col.key !== "details")
      .map((col) => `<div>${this._escape(col.label)}</div><div>${col.render(row)}</div>`)
      .join("");
    this._showDialog(this._rowTitle(row) || "Details", `<div class="details">${body}</div>`);
    this._hydrateTimeToggles(this._activeDialog);
  }

  _clearFilters() {
    this._filters = this._defaultFilters();
    this._search = "";
    this._page = 0;
    this.shadowRoot.getElementById("search").value = "";
    this._refreshFilterOptions();
    this._savePreferences();
    this._scheduleFetch(true);
  }

  _hasActiveFilters() {
    return Boolean(this._search.trim() || Object.values(this._filters).some((value) => value));
  }

  _apiFilters() {
    const filters = {};
    for (const def of this._filterDefs()) {
      const value = this._filters[def.key];
      if (value) filters[def.param || def.key] = value;
    }
    return filters;
  }

  _toggleOptions() {
    this._showDialog("Table options", `
      <div class="menu-title">Columns</div>
      <div data-column-panel class="column-panel"></div>
      <div class="menu-title">View</div>
      <div class="dialog-actions">
        <button data-reset class="menu-button" type="button">Reset view</button>
      </div>`, { kind: "options", maxWidth: 420 });
    this._activeDialog.querySelector("[data-reset]").addEventListener("click", () => this._resetPreferences());
    this._refreshColumnPicker();
  }

  _closeOptions() {
    if (this._activeDialog?.dataset.kind === "options") this._closeDialog();
  }

  _showDialog(title, body, options = {}) {
    this._closeDialog();
    const overlay = document.createElement("div");
    overlay.className = "accloud-dialog";
    overlay.dataset.kind = options.kind || "details";
    overlay.innerHTML = `
      <style>
        .accloud-dialog { align-items: flex-start; background: rgba(0,0,0,0.35); box-sizing: border-box; display: flex; inset: 0; justify-content: center; padding: 8vh 10px 16px; position: fixed; z-index: 2147483647; }
        .accloud-dialog-card { background: var(--card-background-color, #fff); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.28); box-sizing: border-box; color: var(--primary-text-color, #111); max-height: 80vh; max-width: ${Number(options.maxWidth) || 720}px; overflow: auto; padding: 16px; width: min(100%, ${Number(options.maxWidth) || 720}px); }
        .dialog-head { align-items: center; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 12px; }
        .details { display: grid; gap: 6px 14px; grid-template-columns: minmax(120px, max-content) 1fr; }
        .details div:nth-child(odd), .menu-title { color: var(--secondary-text-color, #666); }
        .menu-title { font-size: 12px; font-weight: 650; margin: 4px 0 6px; text-transform: uppercase; }
        .column-panel { display: grid; gap: 6px; }
        .column-panel label { align-items: center; display: flex; font-size: 13px; gap: 8px; line-height: 1.3; min-height: 28px; white-space: nowrap; }
        .column-panel input[type="checkbox"] { flex: 0 0 auto; height: 16px; margin: 0; width: 16px; }
        .dialog-actions { margin-top: 10px; }
        .menu-button { width: 100%; }
        a { color: var(--primary-color); text-decoration: none; }
        .muted { color: var(--secondary-text-color); }
        .mono { font-family: var(--code-font-family, monospace); }
        .admin-time-toggle { cursor: pointer; }
        .admin-time-toggle:hover, .admin-time-toggle:focus { outline: none; text-decoration: underline; }
        .pill { border-radius: 999px; display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px; }
        .ok { background: rgba(36, 161, 72, 0.14); color: #1a7f37; }
        .warn, .bad { background: rgba(207, 34, 46, 0.12); color: #cf222e; }
        .light { background: rgba(127, 127, 127, 0.14); color: var(--secondary-text-color); }
        .state-icon { display: none; }
        @media (max-width: 760px) {
          .accloud-dialog { padding-top: 4vh; }
          .accloud-dialog-card { max-height: 88vh; max-width: none; width: calc(100vw - 20px); }
          .details { grid-template-columns: 1fr; }
          .column-panel { gap: 10px; }
          .column-panel label { font-size: 15px; }
          .column-panel input[type="checkbox"] { height: 20px; width: 20px; }
        }
      </style>
      <div class="accloud-dialog-card" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <strong>${this._escape(title)}</strong>
          <button data-close type="button">Close</button>
        </div>
        ${body}
      </div>`;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this._closeDialog();
    });
    overlay.querySelector("[data-close]").addEventListener("click", () => this._closeDialog());
    document.body.appendChild(overlay);
    this._activeDialog = overlay;
  }

  _closeDialog() {
    if (this._activeDialog) {
      this._activeDialog.remove();
      this._activeDialog = null;
    }
  }

  _debouncedFetch() {
    if (this._refreshTimer) window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = null;
      this._scheduleFetch(true);
    }, this._config.search_debounce_ms);
  }

  _detailsButton(index) {
    return `<button class="icon-button" type="button" data-details="${index}" title="More">More</button>`;
  }

  _cell(row, key) {
    return (row.cells || []).find((cell) => cell.key === key);
  }

  _cellValue(row, key) {
    const cell = this._cell(row, key);
    return cell?.value ?? cell?.text ?? "";
  }

  _cellText(row, key) {
    const cell = this._cell(row, key);
    return this._cellDisplayText(cell).trim();
  }

  _cellHtml(row, key) {
    const cell = this._cell(row, key);
    return this._renderCell(cell);
  }

  _renderCell(cell) {
    if (!cell) return "";
    if (cell.time || cell.kind === "time") return this._timeCellFromCell(cell);
    if (cell.badge || cell.kind === "badge") return this._badgeCellHtml(cell);
    if (cell.kind === "identity") return this._identityCellHtml(cell);
    if (cell.kind === "actions") return this._actionsCellHtml(cell);
    if (cell.kind === "button") return this._buttonCellHtml(cell);
    if (cell.kind === "checkbox") return this._checkboxCellHtml(cell);
    if (cell.html && !cell.kind && cell.text == null) return this._legacyCellHtml(cell.html);
    return this._textCellHtml(cell);
  }

  _cellClass(row, key) {
    const classes = new Set(this._safeClasses(this._cell(row, key)?.class).split(/\s+/).filter(Boolean));
    if (this._rightAlignedColumns().has(key)) classes.add("align-right");
    return Array.from(classes).join(" ");
  }

  _rightAlignedColumns() {
    return new Set(["last_action", "last_activity", "number"]);
  }

  _timeCellHtml(row, key) {
    const cell = this._cell(row, key);
    return this._timeCellFromCell(cell);
  }

  _timeCellFromCell(cell) {
    if (!cell) return "";
    if (cell.time) {
      const relative = String(cell.time.relative || cell.text || "never");
      const absolute = String(cell.time.absolute || relative);
      const unix = Number(cell.time.unix || 0);
      const classes = ["admin-time-toggle"];
      if (cell.muted) classes.push("muted");
      if (!Number.isFinite(unix) || unix <= 0) return this._textCellHtml(cell);
      return `<time class="${this._escape(classes.join(" "))}" tabindex="0" role="button" title="Click to toggle exact local time" data-admin-time-toggle data-relative-time="${this._escape(relative)}" data-absolute-time="${this._escape(absolute)}">${this._escape(relative)}</time>`;
    }
    if (!cell.html && !cell.value) return this._textCellHtml(cell);
    const html = cell.html ? this._legacyCellHtml(cell.html) : this._textCellHtml(cell);
    if (html.includes("data-admin-time-toggle")) return html;
    const timestamp = Number(cell.value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return html;
    const absolute = this._textFromHtml(html) || new Date(timestamp * 1000).toLocaleString();
    const relative = this._relativeTime(timestamp * 1000);
    return `<time class="admin-time-toggle muted" tabindex="0" role="button" title="Click to toggle exact local time" data-admin-time-toggle data-relative-time="${this._escape(relative)}" data-absolute-time="${this._escape(absolute)}">${this._escape(relative)}</time>`;
  }

  _textFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    return template.content.textContent.trim();
  }

  _relativeTime(timestampMs) {
    const seconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 14) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (days < 60) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (days < 365) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  _textCellHtml(cell) {
    const text = this._escape(this._cellDisplayText(cell));
    return cell?.muted ? `<span class="muted">${text}</span>` : text;
  }

  _identityCellHtml(cell) {
    const primary = this._textCellHtml(cell);
    const secondary = String(cell.secondary || "").trim();
    if (!secondary) return primary;
    return `${primary} <span class="muted">${this._escape(secondary)}</span>`;
  }

  _badgeCellHtml(cell) {
    const badge = cell.badge || {};
    const text = this._escape(String(badge.text ?? this._cellDisplayText(cell)));
    const classes = ["pill", this._safeClasses(badge.class), cell.muted ? "muted" : ""].filter(Boolean).join(" ");
    return `<span class="${this._escape(classes)}">${text}</span>`;
  }

  _actionsCellHtml(cell) {
    const actions = Array.isArray(cell.actions) ? cell.actions : [];
    const labels = actions.map((action) => this._actionLabel(action)).filter(Boolean);
    if (!labels.length) return this._textCellHtml(cell);
    return `<span class="muted">${labels.map((label) => this._escape(label)).join(", ")}</span>`;
  }

  _buttonCellHtml(cell) {
    const label = this._actionLabel(cell.button) || this._cellDisplayText(cell);
    return label ? `<span class="muted">${this._escape(label)}</span>` : "";
  }

  _checkboxCellHtml(cell) {
    return this._escape(String(cell.checkbox?.ariaLabel || cell.value || ""));
  }

  _actionLabel(action) {
    if (!action || typeof action !== "object") return "";
    return String(action.label || action.title || action.ariaLabel || "").trim();
  }

  _cellDisplayText(cell) {
    if (!cell) return "";
    return String(cell.text ?? cell.value ?? cell.label ?? "");
  }

  _safeClasses(value) {
    return String(value || "")
      .split(/\s+/)
      .filter((item) => /^[A-Za-z0-9_-]+$/.test(item))
      .join(" ");
  }

  _legacyCellHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    for (const link of template.content.querySelectorAll("a")) {
      const text = document.createElement("span");
      text.className = link.className || "";
      text.textContent = link.textContent || "";
      link.replaceWith(text);
    }
    for (const button of template.content.querySelectorAll("button")) {
      const text = document.createElement("span");
      text.className = button.className || "";
      text.textContent = button.textContent || button.title || button.getAttribute("aria-label") || "";
      button.replaceWith(text);
    }
    return template.innerHTML;
  }

  _hydrateTimeToggles(root) {
    root?.querySelectorAll("[data-admin-time-toggle]:not([data-admin-time-ready])").forEach((el) => {
      el.dataset.adminTimeReady = "1";
      const relative = el.dataset.relativeTime || el.textContent.trim();
      const absolute = el.dataset.absoluteTime || relative;
      const setAbsolute = (show) => {
        el.textContent = show ? absolute : relative;
        el.dataset.absoluteVisible = show ? "1" : "";
      };
      el.addEventListener("click", () => setAbsolute(el.dataset.absoluteVisible !== "1"));
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setAbsolute(el.dataset.absoluteVisible !== "1");
        }
      });
    });
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _header(key, label) {
    const suffix = this._sortKey === key ? (this._sortDir === 1 ? " ^" : " v") : "";
    const className = this._rightAlignedColumns().has(key) ? "align-right" : "";
    return `<th class="${className}"><button data-key="${this._escape(key)}">${this._escape(label)}${suffix}</button></th>`;
  }
}

if (!customElements.get("accloud-devices-table-card")) {
  customElements.define("accloud-devices-table-card", AccCloudDevicesTableCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "accloud-devices-table-card")) {
  window.customCards.push({
    type: "accloud-devices-table-card",
    name: "AccCloud Devices Table",
    description: "Searchable AccCloud AC device inventory",
  });
}
