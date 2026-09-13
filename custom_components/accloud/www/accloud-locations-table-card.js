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
      ["number", "House Number"],
      ["name", "Name"],
      ["remark", "Remark"],
      ["type", "Type"],
      ["assigned", "Assigned ACs"],
      ["online", "Online ACs"],
      ["on", "On ACs"],
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
    return ["number", "name", "remark", "type", "online", "on", "today", "week", "month", "last_activity", "details"];
  }

  _defaultMobileColumns() {
    return ["number", "name", "online", "on", "today", "last_activity", "details"];
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
