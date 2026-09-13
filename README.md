# AccCloud for Home Assistant

Home Assistant custom integration and Lovelace table cards for an AccCloud AC
management server.

This integration talks to the AccCloud JSON API with a bearer token. The token is
stored in the Home Assistant config entry and is never exposed to the frontend
cards.

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

If you have more than one AccCloud integration entry, set `entry_id` explicitly:

```yaml
type: custom:accloud-devices-table-card
entry_id: your_config_entry_id
```

## Security

Use a dedicated AccCloud Home Assistant bearer token. Do not publish real tokens,
private hostnames, local screenshots, or exported Home Assistant config.

