# AccCloud for Home Assistant

Home Assistant custom integration and Lovelace table cards for an AccCloud AC
management server.

This integration talks to the AccCloud JSON API with a bearer token. The token is
stored in the Home Assistant config entry and is never exposed to the frontend
cards.

## Entities

The integration creates one AccCloud device with summary entities for monitoring
and Home Assistant history:

- `binary_sensor`: connected
- `sensor`: total ACs, online ACs, offline ACs, on ACs, estimated power, energy today

## Installation with HACS

1. Add this repository as a HACS custom repository of type `Integration`.
2. Install **AccCloud** from HACS.
3. Restart Home Assistant.
4. Add the **AccCloud** integration from Home Assistant settings.
5. Enter your AccCloud base URL and bearer token.

Example AccCloud API check:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-accloud-host.example/api/admin/devices
```

## Lovelace Cards

The integration registers two custom cards automatically when Lovelace is in
storage mode:

```yaml
type: custom:accloud-devices-table-card
```

```yaml
type: custom:accloud-locations-table-card
```

The location card's **Online ACs** count opens all devices at that location, while
**On ACs** opens only its powered-on devices. By default it navigates to a sibling
dashboard view named `aircon-devices`. Set an explicit local Home Assistant path
when your devices view uses another route:

```yaml
type: custom:accloud-locations-table-card
devices_path: /your-dashboard/your-devices-view
```

Location links reset the device search and filters, apply the selected location
and optional power state, and save those values as the normal device-table
filters. The navigation parameters are removed from the URL after they are
applied. `devices_path` must resolve to a local Home Assistant path.

Both cards use server-side search, filtering, sorting, and pagination through
Home Assistant websocket calls. They also keep table preferences such as visible
columns, sort order, filters, and page size in browser local storage.

## Card Options

```yaml
type: custom:accloud-devices-table-card
page_size: 25
mobile_page_size: 10
refresh_interval_ms: 60000
```

Use fixed server-side filters and the optional display controls for a compact
read-only list. This example shows every offline AC with only its combined
location/room name and status:

```yaml
type: custom:accloud-devices-table-card
fixed_filters:
  status: offline
columns:
  - name
  - status
mobile_columns:
  - name
  - status
mobile_layout: table
show_toolbar: false
show_table_header: false
show_details: false
show_controls: false
show_meta: false
show_pager: false
page_size: 0
mobile_page_size: 0
remember_preferences: false
```

`fixed_filters` accepts the same filter keys as the card controls and sends
them with every server-side request. Fixed filters are not shown in the toolbar
and cannot be removed by **Clear**. A page size of `0` requests all matching
rows.

Set `mobile_layout: table` to keep normal table rows on narrow screens. The
table uses `mobile_columns` while the viewport is mobile; the default remains
the card layout used by the full inventory views.

If you have more than one AccCloud integration entry, set `entry_id` explicitly:

```yaml
type: custom:accloud-devices-table-card
entry_id: your_config_entry_id
```

## Security

Use a dedicated AccCloud Home Assistant bearer token. Do not publish real tokens,
private hostnames, local screenshots, or exported Home Assistant config.
