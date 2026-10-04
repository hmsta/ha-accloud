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
      ["room", "Room", (row, index) => this._roomButton(row, index)],
      ["device", "Device"],
      ["firmware", "FW"],
      ["capacity", "BTU"],
      ["online", "Online"],
      ["power", "Power"],
      ["est_watts", "Est. W"],
      ["mode", "Mode"],
      ["set_temp", "Set Temp"],
      ["room_temp", "Room Temp", (row) => this._roomTempCellHtml(row)],
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
    return ["location", "room", "online", "power", "est_watts", "mode", "set_temp", "room_temp", "last_action", "details"];
  }

  _defaultMobileColumns() {
    return ["location", "room", "online", "power", "est_watts", "mode", "last_action", "details"];
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
      const version = Number(prefs.version || 0);
      if (Array.isArray(prefs.columns)) {
        this._columns = this._migrateColumns(this._validColumns(prefs.columns, this._defaultColumns()), version, this._defaultColumns());
      }
      if (Array.isArray(prefs.mobile_columns)) {
        this._mobileColumns = this._migrateColumns(this._validColumns(prefs.mobile_columns, this._defaultMobileColumns()), version, this._defaultMobileColumns());
      }
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
        version: this._preferenceVersion(),
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

  _preferenceVersion() {
    return 3;
  }

  _migrateColumns(columns, version, defaults) {
    let migrated = columns;
    if (version < 2) migrated = this._withNewDefaultColumns(migrated, defaults, ["est_watts"]);
    if (version < 3) migrated = this._withNewDefaultColumns(migrated, defaults, ["last_action", "last_activity"]);
    return migrated;
  }

  _withNewDefaultColumns(columns, defaults, newKeys) {
    const merged = columns.filter((key) => key !== "details");
    for (const key of newKeys) {
      if (!defaults.includes(key) || merged.includes(key)) continue;
      const defaultIndex = defaults.indexOf(key);
      let insertAt = merged.length;
      for (let i = defaultIndex + 1; i < defaults.length; i += 1) {
        const existingIndex = merged.indexOf(defaults[i]);
        if (existingIndex !== -1) {
          insertAt = existingIndex;
          break;
        }
      }
      merged.splice(insertAt, 0, key);
    }
    merged.push("details");
    return merged;
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
      .room-control { background: transparent; border: 0; color: var(--primary-color); font: inherit; min-height: 0; padding: 0; text-align: left; }
      .room-control:hover, .room-control:focus { text-decoration: underline; }
      .mobile-room-control { font-weight: 650; }
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
      .align-center { text-align: center; }
      .pill { border-radius: 999px; display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px; }
      .ok { background: rgba(36, 161, 72, 0.14); color: #1a7f37; }
      .warn, .bad { background: rgba(207, 34, 46, 0.12); color: #cf222e; }
      .light { background: rgba(127, 127, 127, 0.14); color: var(--secondary-text-color); }
      .admin-time-toggle { cursor: pointer; }
      .admin-time-toggle:hover, .admin-time-toggle:focus { outline: none; text-decoration: underline; }
      .activity-time { color: var(--primary-color); cursor: pointer; }
      .activity-time:hover, .activity-time:focus { outline: none; text-decoration: underline; }
      .temp-chart-trigger { background: transparent; border: 0; color: var(--primary-color); font: inherit; min-height: 0; padding: 0; text-align: inherit; }
      .temp-chart-trigger:hover, .temp-chart-trigger:focus { outline: none; text-decoration: underline; }
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
    const hasPagination = pageSize !== 0 && this._pageCount > 1;
    this.shadowRoot.getElementById("meta").textContent = `${this._filteredCount} matched of ${this._totalRows}${this._error ? ` - ${this._error}` : ""}`;
    this.shadowRoot.getElementById("page-info").textContent = this._rangeLabel(start, end);
    this.shadowRoot.getElementById("prev").hidden = !hasPagination;
    this.shadowRoot.getElementById("next").hidden = !hasPagination;
    this.shadowRoot.getElementById("prev").disabled = this._page <= 0;
    this.shadowRoot.getElementById("next").disabled = this._page >= this._pageCount - 1;
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
    for (const button of this.shadowRoot.querySelectorAll("button[data-control]")) {
      button.addEventListener("click", () => this._showRowControl(rows[Number(button.dataset.control)]));
    }
    this._hydrateTimeToggles(this.shadowRoot);
    this._hydrateActivityLinks(this.shadowRoot);
    this._hydrateTemperatureChartLinks(this.shadowRoot);
  }

  _rangeLabel(start, end) {
    if (!end) return "0";
    return `${start}-${end}`;
  }

  _mobileRow(row, index, defs, columns) {
    const main = this._rowTitle(row);
    const mainHtml = this._rowHasControl(row)
      ? this._rowControlButton(row, index, main, "mobile-room-control")
      : `<strong>${this._escape(main)}</strong>`;
    const fields = columns.filter((key) => key !== "details");
    return `
      <div class="mobile-row">
        <div class="mobile-main">
          ${mainHtml}
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
      .filter((col) => !this._hiddenDetailsColumns().has(col.key))
      .map((col) => `<div>${this._escape(col.label)}</div><div>${this._detailsCellHtml(row, col)}</div>`)
      .join("");
    this._showDialog(this._rowTitle(row) || "Details", `<div class="details">${body}</div>`);
    this._hydrateTimeToggles(this._activeDialog);
    this._hydrateActivityLinks(this._activeDialog);
    this._hydrateTemperatureChartLinks(this._activeDialog);
  }

  _hiddenDetailsColumns() {
    return new Set(["details", "actions"]);
  }

  async _showControl(row) {
    const deviceId = this._deviceId(row);
    if (!deviceId) return;
    const title = this._rowTitle(row) || "Control";
    const overlay = this._showDialog(title, `<p class="muted">Loading control state...</p>`, { kind: "control", maxWidth: 480 });
    try {
      const entryId = await this._entryId();
      if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
      const state = await this._hass.callWS({
        type: "accloud/get_device_state",
        entry_id: entryId,
        device_id: deviceId,
      });
      if (this._activeDialog !== overlay) return;
      overlay.querySelector("[data-dialog-body]").innerHTML = this._controlFormHtml(state);
      this._attachControlHandlers(row);
    } catch (err) {
      if (this._activeDialog !== overlay) return;
      overlay.querySelector("[data-dialog-body]").innerHTML = `<p class="control-message is-error">${this._escape(err.message || String(err))}</p>`;
    }
  }

  _detailsCellHtml(row, col) {
    return col.key === "room" ? this._cellHtml(row, "room") : col.render(row);
  }

  _showRowControl(row) {
    this._showControl(row);
  }

  _controlFormHtml(state, options = {}) {
    const draft = this._controlDraft(state);
    const selfCleaning = String(state?.operatingState || "").toLowerCase() === "self_cleaning";
    const status = selfCleaning
      ? ""
      : [
          state.powerText || this._labelFor("power", draft.power),
          state.modeLabel || this._labelFor("mode", draft.mode),
          state.targetTempLabel ? `${state.targetTempLabel}` : "",
        ].filter(Boolean).join(" - ");
    return `
      <form class="control-form" data-control-form data-self-cleaning="${selfCleaning ? "true" : "false"}">
        <div class="control-status">
          <div class="control-heading">
            <strong>${this._escape(state.roomTempLabel || "Room --")}</strong>
            ${status ? `<span>${this._escape(status)}</span>` : ""}
          </div>
          <div class="control-badges">
            ${selfCleaning ? `<span class="pill cleaning">Self-cleaning</span>` : ""}
            <span class="pill ${state.online ? "ok" : "warn"}">${this._escape(state.onlineText || (state.online ? "online" : "offline"))}</span>
          </div>
        </div>
        <input type="hidden" name="power" value="${this._escape(draft.power)}">
        <div class="control-section">
          <div class="menu-title">Power</div>
          <div class="control-power">
            <button type="button" data-power-option="off" aria-pressed="false">Off</button>
            <button type="button" data-power-option="on" aria-pressed="false">On</button>
          </div>
        </div>
        <div class="control-grid" data-control-grid>
          <label class="control-field" data-mode-field><span>Mode</span><select name="mode">${this._optionsHtml(this._modeOptions(), draft.mode)}</select></label>
          <label class="control-field" data-temp-field><span>Set temp</span><select name="targetTempC">${this._tempOptionsHtml(draft.targetTempC)}</select></label>
          <label class="control-field" data-fan-field><span>Fan</span><select name="fan">${this._optionsHtml(this._fanOptions(), draft.fan)}</select></label>
          <label class="control-field" data-special-field><span>Special mode</span><select name="special">${this._optionsHtml(this._specialOptions(), draft.special)}</select></label>
          <label class="control-field"><span>Ion</span><select name="plasmaIon">${this._optionsHtml([["off", "Off"], ["on", "On"]], draft.plasmaIon)}</select></label>
          <label class="control-field"><span>Air direction</span><select name="swing">${this._optionsHtml(this._swingOptions(), draft.swing)}</select></label>
          <label class="control-field" data-timer-field><span>Auto off</span><select name="offTimerMinutes">${this._optionsHtml(this._offTimerOptions(), "")}</select></label>
        </div>
        <div class="control-actions">
          <span class="control-message" data-control-message>${this._escape(options.message || "Draft is sent only when you press Apply.")}</span>
          <button class="control-apply" type="submit">${this._escape(options.applyLabel || "Apply")}</button>
        </div>
      </form>`;
  }

  _attachControlHandlers(row, applyHandler = (targetRow, form) => this._applyControlState(targetRow, form)) {
    const form = this._activeDialog?.querySelector("[data-control-form]");
    if (!form) return;
    const sync = () => this._syncControlForm(form);
    for (const button of form.querySelectorAll("[data-power-option]")) {
      button.addEventListener("click", () => {
        form.elements.power.value = button.dataset.powerOption;
        sync();
      });
    }
    form.elements.mode.addEventListener("change", sync);
    form.elements.special.addEventListener("change", () => {
      if (form.elements.special.value !== "off" && form.elements.mode.value === "cool_plus") {
        form.elements.mode.value = "cool";
      }
      sync();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      applyHandler(row, form);
    });
    sync();
  }

  _syncControlForm(form) {
    const powered = form.elements.power.value === "on";
    const mode = form.elements.mode.value;
    const controlGrid = form.querySelector("[data-control-grid]");
    if (controlGrid) controlGrid.hidden = form.dataset.selfCleaning === "true" && !powered;
    for (const button of form.querySelectorAll("[data-power-option]")) {
      const selected = button.dataset.powerOption === form.elements.power.value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    const tempField = form.querySelector("[data-temp-field]");
    const modeField = form.querySelector("[data-mode-field]");
    const fanField = form.querySelector("[data-fan-field]");
    const specialField = form.querySelector("[data-special-field]");
    const timerField = form.querySelector("[data-timer-field]");
    form.elements.mode.disabled = !powered;
    if (modeField) modeField.classList.toggle("muted", !powered);
    if (tempField) tempField.hidden = mode === "fan";
    form.elements.targetTempC.disabled = !powered || mode === "fan";
    if (mode === "dry") form.elements.fan.value = "auto";
    form.elements.fan.disabled = !powered || mode === "dry";
    if (fanField) fanField.classList.toggle("muted", form.elements.fan.disabled);
    if (mode === "cool_plus") form.elements.special.value = "off";
    form.elements.special.disabled = !powered || mode === "cool_plus";
    if (specialField) specialField.classList.toggle("muted", form.elements.special.disabled);
    form.elements.plasmaIon.disabled = !powered;
    form.elements.swing.disabled = !powered;
    if (form.elements.offTimerMinutes) {
      for (const option of form.elements.offTimerMinutes.options) {
        const minutes = Number(option.value);
        option.disabled = !powered && Number.isFinite(minutes) && minutes > 0;
      }
      if (!powered && Number(form.elements.offTimerMinutes.value) > 0) {
        form.elements.offTimerMinutes.value = "0";
      }
    }
    if (timerField) timerField.classList.toggle("muted", !powered && form.elements.offTimerMinutes?.value !== "0");
  }

  async _applyControlState(row, form) {
    const deviceId = this._deviceId(row);
    const message = form.querySelector("[data-control-message]");
    const button = form.querySelector(".control-apply");
    try {
      const entryId = await this._entryId();
      if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
      button.disabled = true;
      message.className = "control-message";
      message.textContent = "Applying...";
      const result = await this._hass.callWS({
        type: "accloud/set_device_state",
        entry_id: entryId,
        device_id: deviceId,
        state: this._controlPayload(form),
      });
      message.className = "control-message is-ok";
      message.textContent = result?.requestId ? `Applied. Request ${result.requestId}` : "Applied.";
      this._scheduleFetch(true);
    } catch (err) {
      message.className = "control-message is-error";
      message.textContent = err.message || String(err);
    } finally {
      button.disabled = false;
    }
  }

  _controlPayload(form) {
    const power = form.elements.power.value === "on" ? "on" : "off";
    const applyOffTimer = (payload) => {
      const value = form.elements.offTimerMinutes?.value ?? "";
      if (value !== "") payload.offTimerMinutes = Number(value);
      return payload;
    };
    if (power === "off") return applyOffTimer({ power: "off" });
    const mode = form.elements.mode.value;
    const payload = {
      power: "on",
      mode: mode === "cool_plus" ? "cool" : mode,
      fan: mode === "dry" ? "auto" : form.elements.fan.value,
      merit: mode === "cool_plus" ? "hi_power" : form.elements.special.value,
      plasmaIon: form.elements.plasmaIon.value,
      swing: form.elements.swing.value,
    };
    if (mode !== "fan") payload.targetTempC = Number(form.elements.targetTempC.value);
    return applyOffTimer(payload);
  }

  _controlDraft(state) {
    const merit = String(state?.merit || "").toLowerCase();
    const mode = String(state?.mode || "cool").toLowerCase();
    const fan = String(state?.fan || "auto").toLowerCase();
    const swing = String(state?.swing || "off").toLowerCase();
    const specialValues = new Set(this._specialOptions().map(([value]) => value));
    const temp = Math.max(17, Math.min(30, Math.round(Number(state?.targetTempC) || 24)));
    return {
      power: String(state?.effectivePower ?? state?.power ?? "").toLowerCase() === "on" ? "on" : "off",
      mode: mode === "cool" && merit === "hi_power" ? "cool_plus" : this._validOption(this._modeOptions(), mode, "cool"),
      targetTempC: String(temp),
      fan: this._validOption(this._fanOptions(), fan, "auto"),
      special: specialValues.has(merit) ? merit : "off",
      plasmaIon: String(state?.plasmaIon || "").toLowerCase() === "on" ? "on" : "off",
      swing: this._validOption(this._swingOptions(), swing, "off"),
    };
  }

  _validOption(options, value, fallback) {
    return options.some(([option]) => option === value) ? value : fallback;
  }

  _modeOptions() {
    return [["cool", "Cool"], ["cool_plus", "Cool+"], ["dry", "Dry"], ["fan", "Fan"], ["auto", "Auto"]];
  }

  _fanOptions() {
    return [["auto", "Auto"], ["quiet", "Quiet"], ["low", "Low"], ["low_plus", "Low+"], ["medium", "Med"], ["medium_plus", "Med+"], ["high", "High"]];
  }

  _specialOptions() {
    return [["off", "Off"], ["eco", "Eco"], ["outdoor_silent_1", "Silent 1"], ["outdoor_silent_2", "Silent 2"]];
  }

  _swingOptions() {
    return [["off", "Off"], ["vertical", "Up / Down"], ["horizontal", "Left / Right"], ["both", "All directions"], ["hada", "Comfort"], ["fixed_1", "Position 1"], ["fixed_2", "Position 2"], ["fixed_3", "Position 3"], ["fixed_4", "Position 4"], ["fixed_5", "Position 5"]];
  }

  _offTimerOptions() {
    return [["", "No change"], ["0", "Clear timer"], ["30", "30 min"], ["60", "60 min"], ["120", "120 min"]];
  }

  _optionsHtml(options, selected) {
    return options.map(([value, label]) => `<option value="${this._escape(value)}" ${value === selected ? "selected" : ""}>${this._escape(label)}</option>`).join("");
  }

  _tempOptionsHtml(selected) {
    const options = [];
    for (let value = 17; value <= 30; value += 1) options.push([String(value), `${value} C`]);
    return this._optionsHtml(options, String(selected));
  }

  _labelFor(kind, value) {
    const options = kind === "mode" ? this._modeOptions() : [["off", "Off"], ["on", "On"]];
    return options.find(([option]) => option === value)?.[1] || value;
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
        .accloud-dialog { align-items: flex-start; background: rgba(0,0,0,0.42); box-sizing: border-box; display: flex; inset: 0; justify-content: center; padding: 8vh 10px 16px; position: fixed; z-index: 2147483647; }
        .accloud-dialog-card { background: var(--ha-card-background, var(--card-background-color, #fff)); border: 1px solid var(--ha-card-border-color, transparent); border-radius: var(--ha-card-border-radius, 12px); box-shadow: var(--ha-card-box-shadow, 0 12px 32px rgba(0,0,0,0.30)); box-sizing: border-box; color: var(--primary-text-color, #111); max-height: 80vh; max-width: ${Number(options.maxWidth) || 720}px; overflow: auto; width: min(100%, ${Number(options.maxWidth) || 720}px); }
        .dialog-head { align-items: center; display: flex; gap: 10px; justify-content: space-between; padding: 14px 18px 4px; }
        .dialog-title { font-size: 18px; font-weight: 600; line-height: 1.25; min-width: 0; }
        .dialog-close { align-items: center; background: transparent; border: 0; border-radius: 50%; color: var(--secondary-text-color, #666); cursor: pointer; display: inline-flex; flex: 0 0 auto; height: 32px; justify-content: center; min-height: 32px; padding: 0; position: relative; width: 32px; }
        .dialog-close::before, .dialog-close::after { background: currentColor; border-radius: 999px; content: ""; height: 2px; position: absolute; width: 16px; }
        .dialog-close::before { transform: rotate(45deg); }
        .dialog-close::after { transform: rotate(-45deg); }
        .dialog-close:hover, .dialog-close:focus-visible { background: rgba(127, 127, 127, 0.14); outline: none; }
        .dialog-body { padding: 4px 18px 18px; }
        .details { display: grid; gap: 6px 14px; grid-template-columns: minmax(120px, max-content) 1fr; }
        .details div:nth-child(odd), .menu-title { color: var(--secondary-text-color, #666); }
        .location-password { border-top: 1px solid var(--divider-color, #ddd); display: grid; gap: 8px; margin-top: 14px; padding-top: 12px; }
        .details-action-link { background: transparent; border: 0; color: var(--primary-color, #2196f3); cursor: pointer; font: inherit; justify-self: start; min-height: 28px; padding: 0; }
        .details-action-link:hover, .details-action-link:focus-visible { outline: none; text-decoration: underline; }
        .location-password-form { display: grid; gap: 8px; }
        .location-password-form[hidden] { display: none; }
        .location-password-label { display: grid; gap: 4px; }
        .location-password-label span { color: var(--secondary-text-color, #666); font-size: 12px; }
        .location-password-label input { background: var(--ha-card-background, var(--card-background-color, #fff)); border: 1px solid var(--divider-color, #ddd); border-radius: 8px; box-sizing: border-box; color: var(--primary-text-color, #111); font: inherit; min-height: 36px; padding: 0 10px; width: 100%; }
        .location-password-label input:focus { border-color: var(--primary-color, #2196f3); box-shadow: 0 0 0 1px var(--primary-color, #2196f3); outline: none; }
        .location-password-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .location-password-actions button { border-radius: 8px; cursor: pointer; font: inherit; min-height: 34px; padding: 0 14px; }
        .location-password-cancel { background: transparent; border: 1px solid var(--divider-color, #ddd); color: var(--primary-text-color, #111); }
        .location-password-submit { background: var(--primary-color, #2196f3); border: 0; color: var(--text-primary-color, #fff); font-weight: 700; }
        .location-password-actions button:disabled { cursor: wait; opacity: .65; }
        .location-password-message { color: var(--secondary-text-color, #666); font-size: 12px; min-height: 16px; }
        .location-password-message.is-error { color: #cf222e; }
        .location-password-message.is-ok { color: #1a7f37; }
        .menu-title { font-size: 12px; font-weight: 700; letter-spacing: 0; margin: 2px 0 8px; text-transform: uppercase; }
        .column-panel { display: grid; gap: 6px; }
        .column-panel label { align-items: center; display: flex; font-size: 13px; gap: 8px; line-height: 1.3; min-height: 28px; white-space: nowrap; }
        .column-panel input[type="checkbox"] { flex: 0 0 auto; height: 16px; margin: 0; width: 16px; }
        .dialog-actions { margin-top: 10px; }
        .menu-button { width: 100%; }
        .control-form { display: grid; gap: 12px; }
        .control-status { align-items: flex-start; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
        .control-heading { display: grid; gap: 2px; min-width: 0; }
        .control-status strong { font-size: 18px; font-weight: 600; line-height: 1.2; }
        .control-heading span { color: var(--secondary-text-color, #666); font-size: 13px; line-height: 1.3; }
        .control-badges { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
        .control-grid { display: grid; gap: 9px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .control-grid[hidden] { display: none; }
        .control-field { display: grid; gap: 4px; min-width: 0; }
        .control-field span { color: var(--secondary-text-color, #666); font-size: 12px; line-height: 1.2; }
        .control-field select { background: var(--ha-card-background, var(--card-background-color, #fff)); border: 1px solid var(--divider-color, #ddd); border-radius: 8px; box-sizing: border-box; color: var(--primary-text-color, #111); font: inherit; min-height: 34px; padding: 0 10px; width: 100%; }
        .control-field select:focus { border-color: var(--primary-color, #2196f3); box-shadow: 0 0 0 1px var(--primary-color, #2196f3); outline: none; }
        .control-field select:disabled { cursor: not-allowed; opacity: .55; }
        .control-field.muted span { opacity: .7; }
        .control-power { background: var(--secondary-background-color, rgba(127, 127, 127, 0.10)); border: 1px solid var(--divider-color, #ddd); border-radius: 10px; display: grid; gap: 3px; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 3px; }
        .control-power button { background: transparent; border: 0; border-radius: 7px; color: var(--primary-text-color, #111); cursor: pointer; font: inherit; font-weight: 600; min-height: 32px; padding: 0 12px; }
        .control-power button:hover, .control-power button:focus-visible { background: rgba(127, 127, 127, 0.12); outline: none; }
        .control-power button.selected { background: var(--primary-color, #2196f3); box-shadow: 0 2px 8px rgba(0,0,0,0.18); color: var(--text-primary-color, #fff); }
        .control-actions { align-items: center; border-top: 1px solid var(--divider-color, #ddd); display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding-top: 10px; }
        .control-message { color: var(--secondary-text-color, #666); flex: 1 1 auto; font-size: 12px; line-height: 1.3; min-width: 180px; }
        .control-message.is-error { color: #cf222e; }
        .control-message.is-ok { color: #1a7f37; }
        .control-apply { background: var(--primary-color, #2196f3); border: 0; border-radius: 8px; color: var(--text-primary-color, #fff); cursor: pointer; font: inherit; font-weight: 700; min-height: 34px; min-width: 104px; padding: 0 14px; }
        .control-apply:hover, .control-apply:focus-visible { filter: brightness(1.05); outline: none; }
        .control-apply:disabled { cursor: wait; opacity: .65; }
        a { color: var(--primary-color); text-decoration: none; }
        .muted { color: var(--secondary-text-color); }
        .mono { font-family: var(--code-font-family, monospace); }
        .admin-time-toggle { cursor: pointer; }
        .admin-time-toggle:hover, .admin-time-toggle:focus { outline: none; text-decoration: underline; }
        .activity-time { color: var(--primary-color); cursor: pointer; }
        .activity-time:hover, .activity-time:focus { outline: none; text-decoration: underline; }
        .temp-chart-trigger { background: transparent; border: 0; color: var(--primary-color); font: inherit; min-height: 0; padding: 0; text-align: inherit; }
        .temp-chart-trigger:hover, .temp-chart-trigger:focus { outline: none; text-decoration: underline; }
        .activity-list { display: grid; gap: 10px; }
        .activity-row { border-bottom: 1px solid var(--divider-color, #ddd); display: grid; gap: 3px; padding-bottom: 10px; }
        .activity-row:last-child { border-bottom: 0; padding-bottom: 0; }
        .activity-message { font-weight: 650; line-height: 1.3; }
        .activity-meta { color: var(--secondary-text-color, #666); font-size: 12px; line-height: 1.35; }
        .activity-change { font-family: var(--code-font-family, monospace); }
        .chart-card { display: grid; gap: 12px; }
        .chart-toolbar { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
        .chart-title { align-items: baseline; display: flex; flex-wrap: wrap; gap: 10px; min-width: 0; }
        .chart-dot { background: var(--primary-color, #2196f3); border-radius: 50%; flex: 0 0 14px; height: 14px; width: 14px; }
        .chart-title strong { font-size: 16px; }
        .chart-current { color: var(--secondary-text-color, #666); font-size: 16px; font-weight: 650; }
        .chart-ranges { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
        .chart-range { background: rgba(127, 127, 127, 0.16); border: 0; border-radius: 8px; color: var(--primary-text-color, #111); font-weight: 700; min-height: 32px; padding: 0 12px; }
        .chart-range.is-active { background: var(--primary-color, #2196f3); color: var(--text-primary-color, #fff); }
        .chart-body { min-height: 244px; position: relative; }
        .chart-loading, .chart-empty { align-items: center; color: var(--secondary-text-color, #666); display: flex; justify-content: center; min-height: 220px; }
        .temp-chart-svg { display: block; height: auto; max-width: 100%; overflow: visible; width: 100%; }
        .temp-chart-grid { stroke: var(--divider-color, #ddd); stroke-dasharray: 4 6; stroke-width: 1; }
        .temp-chart-axis-text { fill: var(--secondary-text-color, #666); font-size: 12px; }
        .temp-chart-line { fill: none; stroke: var(--primary-color, #2196f3); stroke-linecap: round; stroke-linejoin: round; stroke-width: 4; }
        .temp-chart-area { fill: var(--primary-color, #2196f3); opacity: .18; }
        .temp-chart-point { fill: var(--primary-color, #2196f3); }
        .temp-chart-hit { fill: transparent; pointer-events: all; touch-action: none; }
        .temp-chart-cursor { stroke: var(--primary-color, #2196f3); stroke-dasharray: 3 4; stroke-width: 1.5; }
        .temp-chart-hover-point { fill: var(--primary-color, #2196f3); stroke: var(--ha-card-background, var(--card-background-color, #fff)); stroke-width: 3; }
        .temp-chart-tooltip { background: var(--ha-card-background, var(--card-background-color, #fff)); border: 1px solid var(--divider-color, #ddd); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.22); color: var(--primary-text-color, #111); display: grid; font-size: 12px; gap: 2px; line-height: 1.25; padding: 6px 8px; pointer-events: none; position: absolute; transform: translate(-50%, calc(-100% - 10px)); white-space: nowrap; z-index: 2; }
        .temp-chart-tooltip strong { font-size: 13px; }
        .temp-chart-tooltip span { color: var(--secondary-text-color, #666); }
        .temp-chart-meta { color: var(--secondary-text-color, #666); font-size: 12px; margin-top: -6px; }
        .pill { border-radius: 999px; display: inline-block; font-size: 12px; line-height: 1; padding: 4px 8px; }
        .ok { background: rgba(36, 161, 72, 0.14); color: #1a7f37; }
        .cleaning { background: rgba(217, 119, 6, 0.14); color: var(--warning-color, #b45309); }
        .warn, .bad { background: rgba(207, 34, 46, 0.12); color: #cf222e; }
        .light { background: rgba(127, 127, 127, 0.14); color: var(--secondary-text-color); }
        .state-icon { display: none; }
        @media (max-width: 760px) {
          .accloud-dialog { padding-top: 4vh; }
          .accloud-dialog-card { max-height: 88vh; max-width: none; width: calc(100vw - 20px); }
          .details { grid-template-columns: 1fr; }
          .chart-toolbar { align-items: flex-start; }
          .chart-ranges { justify-content: flex-start; }
          .chart-body { min-height: 216px; }
          .column-panel { gap: 10px; }
          .column-panel label { font-size: 15px; }
          .column-panel input[type="checkbox"] { height: 20px; width: 20px; }
        }
        @media (max-width: 360px) {
          .control-grid { grid-template-columns: 1fr; }
        }
      </style>
      <div class="accloud-dialog-card" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <strong class="dialog-title">${this._escape(title)}</strong>
          <button class="dialog-close" data-close type="button" aria-label="Close"></button>
        </div>
        <div class="dialog-body" data-dialog-body>${body}</div>
      </div>`;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this._closeDialog();
    });
    overlay.querySelector("[data-close]").addEventListener("click", () => this._closeDialog());
    document.body.appendChild(overlay);
    this._activeDialog = overlay;
    return overlay;
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

  _roomButton(row, index) {
    const label = this._cellText(row, "room") || this._cellText(row, "device") || "Control";
    return this._rowHasControl(row) ? this._rowControlButton(row, index, label) : this._escape(label);
  }

  _roomTempCellHtml(row) {
    const cell = this._cell(row, "room_temp");
    const label = this._cellDisplayText(cell).trim();
    const deviceId = this._deviceId(row);
    if (!deviceId) return this._renderCell(cell);
    const title = `${this._rowTitle(row) || "Device"} Room Temperature`;
    return `<button class="temp-chart-trigger" type="button" data-temp-chart data-device-id="${this._escape(deviceId)}" data-chart-title="${this._escape(title)}" data-current-temp="${this._escape(label)}" title="Open room temperature chart">${this._renderCell(cell)}</button>`;
  }

  _detailsButton(index) {
    return `<button class="icon-button" type="button" data-details="${index}" title="More">More</button>`;
  }

  _rowHasControl(row) {
    return Boolean(this._deviceId(row));
  }

  _rowControlButton(row, index, label, extraClass = "") {
    const className = ["room-control", extraClass].filter(Boolean).join(" ");
    return `<button class="${this._escape(className)}" type="button" data-control="${index}" title="Control ${this._escape(label)}">${this._escape(label)}</button>`;
  }

  _deviceId(row) {
    return String(row?.id || row?.deviceId || this._cellValue(row, "device") || "").trim();
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
    if (this._centerAlignedColumns().has(key)) classes.add("align-center");
    return Array.from(classes).join(" ");
  }

  _rightAlignedColumns() {
    return new Set(["capacity", "est_watts", "today", "week", "month", "set_temp", "room_temp", "last_action", "last_activity", "number"]);
  }

  _centerAlignedColumns() {
    return new Set(["power", "mode"]);
  }

  _timeCellHtml(row, key) {
    const cell = this._cell(row, key);
    const target = this._activityTarget(row, key);
    if (target) return this._activityTimeCellFromCell(cell, target);
    return this._timeCellFromCell(cell);
  }

  _activityTarget(row, key) {
    if (key !== "last_action") return null;
    const id = this._deviceId(row);
    if (!id) return null;
    return {
      scope: "device",
      id,
      title: `${this._rowTitle(row) || "Device"} Activity`,
      wsType: "accloud/get_device_activity",
      idKey: "device_id",
    };
  }

  _activityTimeCellFromCell(cell, target) {
    const time = this._timeDisplayData(cell);
    if (!time) return this._timeCellFromCell(cell);
    const classes = ["activity-time"];
    if (cell?.muted) classes.push("muted");
    return `<time class="${this._escape(classes.join(" "))}" datetime="${this._escape(time.iso || "")}" tabindex="0" role="button" title="Open activity log" data-activity-log data-activity-scope="${this._escape(target.scope)}" data-activity-id="${this._escape(target.id)}" data-activity-title="${this._escape(target.title)}" data-activity-ws-type="${this._escape(target.wsType)}" data-activity-id-key="${this._escape(target.idKey)}">${this._escape(time.relative)}</time>`;
  }

  _timeDisplayData(cell) {
    if (!cell) return null;
    if (cell.time) {
      const unix = Number(cell.time.unix || 0);
      if (!Number.isFinite(unix) || unix <= 0) return null;
      return {
        relative: String(cell.time.relative || cell.text || "never"),
        absolute: String(cell.time.absolute || cell.time.relative || cell.text || ""),
        iso: new Date(unix * 1000).toISOString(),
      };
    }
    if (!cell.html && !cell.value) return null;
    const timestamp = Number(cell.value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    const html = cell.html ? this._legacyCellHtml(cell.html) : this._textCellHtml(cell);
    return {
      relative: this._relativeTime(timestamp * 1000),
      absolute: this._textFromHtml(html) || new Date(timestamp * 1000).toLocaleString(),
      iso: new Date(timestamp * 1000).toISOString(),
    };
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

  _temperatureRanges() {
    return [["24h", "24H"], ["7d", "7D"], ["30d", "30D"]];
  }

  async _showTemperatureChart(target) {
    if (!target?.deviceId) return;
    const defaultRange = this._validTemperatureRange(this._config?.temperature_chart_default_range || "24h");
    const overlay = this._showDialog(target.title || "Room Temperature", this._temperatureChartShellHtml(target, defaultRange), { kind: "temperature-chart", maxWidth: 640 });
    this._attachTemperatureChartHandlers(overlay, target);
    await this._loadTemperatureChart(overlay, target, defaultRange);
  }

  _temperatureChartShellHtml(target, activeRange) {
    return `
      <div class="chart-card">
        <div class="chart-toolbar">
          <div class="chart-title">
            <span class="chart-dot"></span>
            <strong>Room Temperature</strong>
            <span class="chart-current" data-chart-current>${this._escape(target.currentTemp || "--")}</span>
          </div>
          <div class="chart-ranges">
            ${this._temperatureRanges().map(([value, label]) => `<button class="chart-range ${value === activeRange ? "is-active" : ""}" type="button" data-chart-range="${value}">${label}</button>`).join("")}
          </div>
        </div>
        <div class="chart-body" data-chart-body><div class="chart-loading">Loading temperature history...</div></div>
      </div>`;
  }

  _attachTemperatureChartHandlers(overlay, target) {
    overlay?.querySelectorAll("[data-chart-range]").forEach((button) => {
      button.addEventListener("click", () => this._loadTemperatureChart(overlay, target, this._validTemperatureRange(button.dataset.chartRange)));
    });
  }

  async _loadTemperatureChart(overlay, target, range) {
    if (!overlay || this._activeDialog !== overlay) return;
    const body = overlay.querySelector("[data-chart-body]");
    if (!body) return;
    const requestId = `${range}-${Date.now()}-${Math.random()}`;
    overlay.dataset.chartRequest = requestId;
    overlay.querySelectorAll("[data-chart-range]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.chartRange === range);
      button.disabled = button.dataset.chartRange === range;
    });
    body.innerHTML = `<div class="chart-loading">Loading temperature history...</div>`;
    try {
      const entryId = await this._entryId();
      if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
      const result = await this._hass.callWS({
        type: "accloud/get_device_room_temp_chart",
        entry_id: entryId,
        device_id: target.deviceId,
        range,
        tz_offset_minutes: new Date().getTimezoneOffset(),
      });
      if (this._activeDialog !== overlay || overlay.dataset.chartRequest !== requestId) return;
      const points = this._temperaturePoints(result);
      const latest = points[points.length - 1];
      const current = overlay.querySelector("[data-chart-current]");
      if (current && latest) current.textContent = this._temperatureValueLabel(latest.value);
      body.innerHTML = this._temperatureChartHtml(points, range);
      this._attachTemperatureChartTooltip(body, points);
    } catch (err) {
      if (this._activeDialog !== overlay || overlay.dataset.chartRequest !== requestId) return;
      body.innerHTML = `<div class="chart-empty">${this._escape(err.message || String(err))}</div>`;
    } finally {
      if (this._activeDialog === overlay && overlay.dataset.chartRequest === requestId) {
        overlay.querySelectorAll("[data-chart-range]").forEach((button) => {
          button.disabled = false;
        });
      }
    }
  }

  _temperaturePoints(result) {
    const points = Array.isArray(result?.points) ? result.points : [];
    return points
      .map((point) => {
        const time = new Date(point?.recordedAt || "").getTime();
        const value = Number(point?.roomTempC);
        return { time, value };
      })
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
      .sort((left, right) => left.time - right.time);
  }

  _temperatureChartHtml(points, range) {
    if (!points.length) return `<div class="chart-empty">No temperature history yet.</div>`;
    const width = 560;
    const height = 260;
    const plot = { left: 44, top: 12, right: 10, bottom: 34 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const now = Date.now();
    const xMin = this._temperatureRangeStart(range, now);
    const xMax = Math.max(now, points[points.length - 1].time, xMin + 1);
    const values = points.map((point) => point.value);
    let yMin = Math.floor(Math.min(...values) - 1);
    let yMax = Math.ceil(Math.max(...values) + 1);
    if (yMax - yMin < 2) {
      yMin -= 1;
      yMax += 1;
    }
    const x = (time) => plot.left + ((Math.min(Math.max(time, xMin), xMax) - xMin) / (xMax - xMin)) * plotWidth;
    const y = (value) => plot.top + (1 - ((value - yMin) / (yMax - yMin))) * plotHeight;
    const chartPoints = points.filter((point) => point.time >= xMin && point.time <= xMax);
    const visiblePoints = chartPoints.length ? chartPoints : points.slice(-1);
    const coords = visiblePoints.map((point) => [x(point.time), y(point.value)]);
    const linePath = coords.length === 1 ? "" : coords.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const areaPath = coords.length === 1 ? "" : `${linePath} L${coords[coords.length - 1][0].toFixed(1)} ${(height - plot.bottom).toFixed(1)} L${coords[0][0].toFixed(1)} ${(height - plot.bottom).toFixed(1)} Z`;
    const yTicks = this._temperatureTicks(yMin, yMax, 4);
    const xTicks = this._temperatureTimeTicks(xMin, xMax, range);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return `
      <svg class="temp-chart-svg" data-temp-chart-svg data-x-min="${xMin}" data-x-max="${xMax}" data-y-min="${yMin}" data-y-max="${yMax}" data-plot-left="${plot.left}" data-plot-top="${plot.top}" data-plot-right="${width - plot.right}" data-plot-bottom="${height - plot.bottom}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Room temperature history">
        ${yTicks.map((tick) => {
          const py = y(tick);
          return `<line class="temp-chart-grid" x1="${plot.left}" y1="${py.toFixed(1)}" x2="${width - plot.right}" y2="${py.toFixed(1)}"></line><text class="temp-chart-axis-text" x="${plot.left - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end">${this._escape(this._temperatureAxisLabel(tick))}</text>`;
        }).join("")}
        ${xTicks.map((tick) => {
          const px = x(tick);
          return `<line class="temp-chart-grid" x1="${px.toFixed(1)}" y1="${plot.top}" x2="${px.toFixed(1)}" y2="${height - plot.bottom}"></line><text class="temp-chart-axis-text" x="${px.toFixed(1)}" y="${height - 10}" text-anchor="middle">${this._escape(this._temperatureTimeLabel(tick, range))}</text>`;
        }).join("")}
        ${areaPath ? `<path class="temp-chart-area" d="${areaPath}"></path>` : ""}
        ${linePath ? `<path class="temp-chart-line" d="${linePath}"></path>` : ""}
        ${coords.length === 1 ? `<circle class="temp-chart-point" cx="${coords[0][0].toFixed(1)}" cy="${coords[0][1].toFixed(1)}" r="4"></circle>` : ""}
        <g data-chart-hover hidden>
          <line class="temp-chart-cursor" data-chart-hover-line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${height - plot.bottom}"></line>
          <circle class="temp-chart-hover-point" data-chart-hover-point cx="${plot.left}" cy="${plot.top}" r="5"></circle>
        </g>
        <rect class="temp-chart-hit" data-chart-hit x="${plot.left}" y="${plot.top}" width="${plotWidth}" height="${plotHeight}"></rect>
      </svg>
      <div class="temp-chart-tooltip" data-chart-tooltip hidden></div>
      <div class="temp-chart-meta">Min ${this._temperatureValueLabel(min)} · Max ${this._temperatureValueLabel(max)}</div>`;
  }

  _attachTemperatureChartTooltip(root, points) {
    const svg = root?.querySelector("[data-temp-chart-svg]");
    const hit = svg?.querySelector("[data-chart-hit]");
    const hover = svg?.querySelector("[data-chart-hover]");
    const line = svg?.querySelector("[data-chart-hover-line]");
    const marker = svg?.querySelector("[data-chart-hover-point]");
    const tooltip = root?.querySelector("[data-chart-tooltip]");
    if (!svg || !hit || !hover || !line || !marker || !tooltip || !points.length) return;
    const xMin = Number(svg.dataset.xMin);
    const xMax = Number(svg.dataset.xMax);
    const yMin = Number(svg.dataset.yMin);
    const yMax = Number(svg.dataset.yMax);
    const plotLeft = Number(svg.dataset.plotLeft);
    const plotTop = Number(svg.dataset.plotTop);
    const plotRight = Number(svg.dataset.plotRight);
    const plotBottom = Number(svg.dataset.plotBottom);
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    if (![xMin, xMax, yMin, yMax, plotLeft, plotTop, plotRight, plotBottom].every(Number.isFinite) || xMax <= xMin || yMax <= yMin) return;
    const x = (time) => plotLeft + ((Math.min(Math.max(time, xMin), xMax) - xMin) / (xMax - xMin)) * plotWidth;
    const y = (value) => plotTop + (1 - ((value - yMin) / (yMax - yMin))) * plotHeight;
    const chartPoints = points.filter((point) => point.time >= xMin && point.time <= xMax);
    const visiblePoints = (chartPoints.length ? chartPoints : points.slice(-1)).map((point) => ({ ...point, x: x(point.time), y: y(point.value) }));
    let hideTimer = 0;
    const hide = () => {
      window.clearTimeout(hideTimer);
      hover.hidden = true;
      tooltip.hidden = true;
    };
    const show = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") event.preventDefault();
      window.clearTimeout(hideTimer);
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const scaleX = viewBox.width / rect.width;
      const svgX = Math.min(plotRight, Math.max(plotLeft, (event.clientX - rect.left) * scaleX));
      let nearest = visiblePoints[0];
      for (const point of visiblePoints) {
        if (Math.abs(point.x - svgX) < Math.abs(nearest.x - svgX)) nearest = point;
      }
      hover.hidden = false;
      line.setAttribute("x1", nearest.x.toFixed(1));
      line.setAttribute("x2", nearest.x.toFixed(1));
      marker.setAttribute("cx", nearest.x.toFixed(1));
      marker.setAttribute("cy", nearest.y.toFixed(1));
      tooltip.innerHTML = `<strong>${this._escape(this._temperatureValueLabel(nearest.value))}</strong><span>${this._escape(this._temperatureTooltipTimeLabel(nearest.time))}</span>`;
      tooltip.hidden = false;
      const rootRect = root.getBoundingClientRect();
      const scaleY = viewBox.height / rect.height;
      const left = rect.left - rootRect.left + nearest.x / scaleX;
      const top = rect.top - rootRect.top + nearest.y / scaleY;
      tooltip.style.left = `${Math.max(44, Math.min(rootRect.width - 44, left))}px`;
      tooltip.style.top = `${Math.max(34, top)}px`;
    };
    hit.addEventListener("pointerdown", (event) => {
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (_) {
        // Some embedded webviews do not allow capture on SVG elements.
      }
      show(event);
    });
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("pointercancel", hide);
    hit.addEventListener("pointerup", (event) => {
      show(event);
      hideTimer = window.setTimeout(hide, event.pointerType === "mouse" ? 250 : 1800);
    });
  }

  _validTemperatureRange(value) {
    return new Set(this._temperatureRanges().map(([range]) => range)).has(value) ? value : "24h";
  }

  _temperatureRangeStart(range, now) {
    if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
    if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
    return now - 24 * 60 * 60 * 1000;
  }

  _temperatureTicks(min, max, count) {
    const ticks = [];
    const step = (max - min) / Math.max(1, count - 1);
    for (let index = 0; index < count; index += 1) ticks.push(min + step * index);
    return ticks;
  }

  _temperatureTimeTicks(start, end, range) {
    const count = range === "30d" ? 4 : 5;
    const ticks = [];
    const step = (end - start) / Math.max(1, count - 1);
    for (let index = 0; index < count; index += 1) ticks.push(start + step * index);
    return ticks;
  }

  _temperatureAxisLabel(value) {
    return `${Math.round(value)}°`;
  }

  _temperatureValueLabel(value) {
    return `${Number(value).toFixed(1)} °C`;
  }

  _temperatureTimeLabel(timestamp, range) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    if (range === "24h") {
      return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  _temperatureTooltipTimeLabel(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  _hydrateTemperatureChartLinks(root) {
    root?.querySelectorAll("[data-temp-chart]:not([data-temp-chart-ready])").forEach((el) => {
      el.dataset.tempChartReady = "1";
      el.addEventListener("click", () => this._showTemperatureChart({
        deviceId: el.dataset.deviceId || "",
        title: el.dataset.chartTitle || "Room Temperature",
        currentTemp: el.dataset.currentTemp || "",
      }));
    });
  }

  async _showActivityLog(target) {
    if (!target?.id || !target?.wsType || !target?.idKey) return;
    const overlay = this._showDialog(target.title || "Activity", `<p class="muted">Loading activity...</p>`, { kind: "activity", maxWidth: 640 });
    try {
      const entryId = await this._entryId();
      if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
      const msg = {
        type: target.wsType,
        entry_id: entryId,
        limit: this._activityLimit(),
      };
      msg[target.idKey] = target.id;
      const result = await this._hass.callWS(msg);
      if (this._activeDialog !== overlay) return;
      overlay.querySelector("[data-dialog-body]").innerHTML = this._activityRowsHtml(result?.rows || [], target);
    } catch (err) {
      if (this._activeDialog !== overlay) return;
      overlay.querySelector("[data-dialog-body]").innerHTML = `<p class="control-message is-error">${this._escape(err.message || String(err))}</p>`;
    }
  }

  _activityLimit() {
    const limit = Number(this._config?.activity_limit);
    return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.round(limit))) : 25;
  }

  _activityRowsHtml(rows, target) {
    if (!Array.isArray(rows) || !rows.length) return `<p class="muted">No activity yet.</p>`;
    return `<div class="activity-list">${rows.map((row) => {
      const message = String(row?.message || row?.field || "Activity").trim();
      const meta = [
        row?.createdAt?.label || "",
        this._activityWhere(row, target?.scope),
      ].filter(Boolean).join(" - ");
      const change = this._activityChange(row);
      const title = row?.createdAt?.value ? ` title="${this._escape(row.createdAt.value)}"` : "";
      return `
        <div class="activity-row">
          <div class="activity-message">${this._escape(message)}</div>
          <div class="activity-meta"${title}>${this._escape(meta)}</div>
          ${change ? `<div class="activity-meta activity-change">${this._escape(change)}</div>` : ""}
        </div>`;
    }).join("")}</div>`;
  }

  _activityWhere(row, scope) {
    const house = String(row?.houseName || "").trim();
    const room = String(row?.roomName || "").trim();
    const device = String(row?.deviceLabel || row?.deviceId || "").trim();
    if (scope === "location") return room || device || house;
    return [house, room].filter(Boolean).join(" / ");
  }

  _activityChange(row) {
    const oldValue = String(row?.oldValue ?? "").trim();
    const newValue = String(row?.newValue ?? "").trim();
    if (oldValue && newValue) return `${oldValue} -> ${newValue}`;
    return newValue || oldValue;
  }

  _hydrateActivityLinks(root) {
    root?.querySelectorAll("[data-activity-log]:not([data-activity-ready])").forEach((el) => {
      el.dataset.activityReady = "1";
      const open = () => this._showActivityLog({
        scope: el.dataset.activityScope || "",
        id: el.dataset.activityId || "",
        title: el.dataset.activityTitle || "Activity",
        wsType: el.dataset.activityWsType || "",
        idKey: el.dataset.activityIdKey || "",
      });
      el.addEventListener("click", open);
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
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
    const classes = [];
    if (this._rightAlignedColumns().has(key)) classes.push("align-right");
    if (this._centerAlignedColumns().has(key)) classes.push("align-center");
    const className = classes.join(" ");
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
