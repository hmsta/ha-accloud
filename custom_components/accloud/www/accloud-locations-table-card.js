import "/accloud/accloud-devices-table-card.js";

const AccCloudBaseTableCard = customElements.get("accloud-devices-table-card");

class AccCloudLocationsTableCard extends AccCloudBaseTableCard {
  static getStubConfig() {
    return { type: "custom:accloud-locations-table-card" };
  }

  _columnDefs() {
    if (this._columnDefsCache) return this._columnDefsCache;
    this._columnDefsCache = [
      ["details", "More", (_row, index) => this._detailsButton(index), () => ""],
      ["number", "House Number", (row, index) => this._locationButton(row, index, "number")],
      ["name", "Name", (row, index) => this._locationButton(row, index, "name")],
      ["remark", "Remark"],
      ["type", "Type"],
      ["assigned", "Assigned ACs"],
      ["online", "Online ACs", (row) => this._deviceCountLink(row, "online")],
      ["on", "On ACs", (row) => this._deviceCountLink(row, "on")],
      ["est_watts", "Est. W"],
      ["today", "Today kWh"],
      ["week", "Week kWh"],
      ["month", "Month kWh"],
      ["resident", "Resident"],
      ["last_activity", "Last Activity", (row) => this._timeCellHtml(row, "last_activity")],
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
    return ["number", "name", "remark", "type", "online", "on", "est_watts", "today", "week", "month", "last_activity", "details"];
  }

  _defaultMobileColumns() {
    return ["online", "on", "est_watts", "today", "last_activity", "details"];
  }

  _preferenceVersion() {
    return 4;
  }

  _migrateMobileColumns(columns, version, defaults) {
    const migrated = super._migrateMobileColumns(columns, version, defaults);
    const oldDefaults = ["number", "name", "online", "on", "est_watts", "today", "last_activity", "details"];
    if (version < 4 && oldDefaults.length === migrated.length && oldDefaults.every((key, index) => migrated[index] === key)) {
      return [...defaults];
    }
    return migrated;
  }

  _defaultSortKey() {
    return "number";
  }

  _storageNamespace() {
    return "locations_table";
  }

  _websocketType() {
    return "accloud/get_locations";
  }

  _responseKey() {
    return "locations";
  }

  _searchPlaceholder() {
    return "Search locations";
  }

  _emptyLabel() {
    return "locations";
  }

  _defaultFilters() {
    return { status: "" };
  }

  _filterDefs() {
    return [
      { key: "status", label: "Status", values: ["online", "offline"], param: "status" },
    ];
  }

  _rowTitle(row) {
    return this._cellText(row, "name") || this._cellText(row, "number") || "Location";
  }

  _detailsCellHtml(row, col) {
    if (col.key === "number" || col.key === "name") return this._cellHtml(row, col.key);
    return super._detailsCellHtml(row, col);
  }

  _rowHasControl(row) {
    return Boolean(this._locationId(row));
  }

  _showRowControl(row) {
    this._showLocationControl(row);
  }

  _locationButton(row, index, key) {
    const label = this._cellText(row, key) || this._rowTitle(row);
    return this._rowHasControl(row) ? this._rowControlButton(row, index, label) : this._escape(label);
  }

  _locationId(row) {
    return String(row?.data?.locationId || row?.id || "").trim();
  }

  _deviceCountLink(row, key) {
    const content = this._cellHtml(row, key);
    const locationId = this._locationId(row);
    if (!locationId) return content;
    const location = this._rowTitle(row) || "location";
    const power = key === "on" ? "on" : "";
    const title = power
      ? `View powered-on devices in ${location}`
      : `View all devices in ${location}`;
    const target = new URL(this._devicesPath(), window.location.origin);
    target.searchParams.set("accloud_location_id", locationId);
    if (power) target.searchParams.set("accloud_power", power);
    const href = `${target.pathname}${target.search}${target.hash}`;
    return `<a class="location-devices-link" href="${this._escape(href)}" title="${this._escape(title)}" aria-label="${this._escape(title)}">${content}</a>`;
  }

  _devicesPath() {
    const configured = String(this._config?.devices_path || "").trim();
    if (configured.startsWith("/") && !configured.startsWith("//")) {
      const target = new URL(configured, window.location.origin);
      if (target.origin === window.location.origin) {
        return `${target.pathname}${target.search}${target.hash}`;
      }
    }
    const current = String(window.location.pathname || "/").replace(/\/+$/, "");
    const parent = current.slice(0, Math.max(0, current.lastIndexOf("/") + 1));
    return `${parent || "/"}aircon-devices`;
  }

  _activityTarget(row, key) {
    if (key !== "last_activity") return null;
    const id = this._locationId(row);
    if (!id) return null;
    return {
      scope: "location",
      id,
      title: `${this._rowTitle(row) || "Location"} Activity`,
      wsType: "accloud/get_location_activity",
      idKey: "location_id",
    };
  }

  _showDetails(row) {
    super._showDetails(row);
    const locationId = this._locationId(row);
    const dialogBody = this._activeDialog?.querySelector("[data-dialog-body]");
    if (!locationId || !dialogBody || !this._hass?.user?.is_admin) return;
    dialogBody.insertAdjacentHTML("beforeend", `
      <section class="location-password">
        <button class="details-action-link" data-change-location-password type="button">Change password</button>
        <form class="location-password-form" data-location-password-form hidden>
          <label class="location-password-label">
            <span>New resident password</span>
            <input data-location-password type="password" minlength="8" autocomplete="new-password" spellcheck="false" required>
          </label>
          <div class="location-password-actions">
            <button class="location-password-cancel" data-location-password-cancel type="button">Cancel</button>
            <button class="location-password-submit" type="submit">Update</button>
          </div>
        </form>
        <div class="location-password-message" data-location-password-message aria-live="polite"></div>
      </section>`);
    this._attachLocationPasswordHandlers(locationId);
  }

  _attachLocationPasswordHandlers(locationId) {
    const dialog = this._activeDialog;
    const trigger = dialog?.querySelector("[data-change-location-password]");
    const form = dialog?.querySelector("[data-location-password-form]");
    const input = dialog?.querySelector("[data-location-password]");
    const cancel = dialog?.querySelector("[data-location-password-cancel]");
    const submit = form?.querySelector("button[type='submit']");
    const message = dialog?.querySelector("[data-location-password-message]");
    if (!trigger || !form || !input || !cancel || !submit || !message) return;

    const collapse = () => {
      input.value = "";
      form.hidden = true;
      trigger.hidden = false;
    };
    trigger.addEventListener("click", () => {
      trigger.hidden = true;
      form.hidden = false;
      message.className = "location-password-message";
      message.textContent = "";
      input.focus();
    });
    cancel.addEventListener("click", () => {
      collapse();
      message.className = "location-password-message";
      message.textContent = "";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = input.value;
      if (password.length < 8) {
        message.className = "location-password-message is-error";
        message.textContent = "Password must be at least 8 characters.";
        input.focus();
        return;
      }
      try {
        const entryId = await this._entryId();
        if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
        input.disabled = true;
        cancel.disabled = true;
        submit.disabled = true;
        message.className = "location-password-message";
        message.textContent = "Updating...";
        await this._hass.callWS({
          type: "accloud/set_location_resident_password",
          entry_id: entryId,
          location_id: locationId,
          password,
        });
        collapse();
        message.className = "location-password-message is-ok";
        message.textContent = "Password changed.";
      } catch (err) {
        message.className = "location-password-message is-error";
        message.textContent = err.message || String(err);
      } finally {
        input.disabled = false;
        cancel.disabled = false;
        submit.disabled = false;
      }
    });
  }

  _showLocationControl(row) {
    const locationId = this._locationId(row);
    if (!locationId) return;
    const title = this._rowTitle(row) || "Location";
    const assigned = this._cellText(row, "assigned");
    const online = this._cellText(row, "online");
    const state = {
      power: "on",
      powerText: "Draft",
      online: row?.online !== false,
      onlineText: online ? `${online} online` : "location",
      mode: "cool",
      modeLabel: "Cool",
      targetTempC: 28,
      targetTempLabel: "28",
      fan: "auto",
      swing: "off",
      merit: "off",
      plasmaIon: "off",
      roomTempLabel: "All ACs",
    };
    const message = assigned
      ? `Applies to ${assigned}. Offline ACs are reported after Apply.`
      : "Applies to all assigned ACs. Offline ACs are reported after Apply.";
    this._showDialog(title, this._controlFormHtml(state, { applyLabel: "Apply to location", message }), { kind: "control", maxWidth: 480 });
    this._attachControlHandlers(row, (targetRow, form) => this._applyLocationState(targetRow, form));
  }

  async _applyLocationState(row, form) {
    const locationId = this._locationId(row);
    const message = form.querySelector("[data-control-message]");
    const button = form.querySelector(".control-apply");
    try {
      const entryId = await this._entryId();
      if (!entryId) throw new Error(this._error || "No AccCloud integration entry is available.");
      button.disabled = true;
      message.className = "control-message";
      message.textContent = "Applying...";
      const result = await this._hass.callWS({
        type: "accloud/set_location_state",
        entry_id: entryId,
        location_id: locationId,
        state: this._controlPayload(form),
      });
      const succeeded = Number(result?.succeeded || 0);
      const failed = Number(result?.failed || 0);
      const skipped = Number(result?.skipped || 0);
      const total = Number(result?.total || 0);
      message.className = `control-message ${result?.ok === false || failed ? "is-error" : "is-ok"}`;
      message.textContent = total
        ? `Applied to ${succeeded}/${total}. ${skipped} skipped, ${failed} failed.`
        : "No ACs assigned to this location.";
      this._scheduleFetch(true);
    } catch (err) {
      message.className = "control-message is-error";
      message.textContent = err.message || String(err);
    } finally {
      button.disabled = false;
    }
  }
}

if (!customElements.get("accloud-locations-table-card")) {
  customElements.define("accloud-locations-table-card", AccCloudLocationsTableCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "accloud-locations-table-card")) {
  window.customCards.push({
    type: "accloud-locations-table-card",
    name: "AccCloud Locations Table",
    description: "Searchable AccCloud location overview",
  });
}
