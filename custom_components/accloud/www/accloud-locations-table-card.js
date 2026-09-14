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
      ["online", "Online ACs"],
      ["on", "On ACs"],
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
    return ["number", "name", "online", "on", "est_watts", "today", "last_activity", "details"];
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
