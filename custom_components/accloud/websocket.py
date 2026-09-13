"""Websocket API for AccCloud cards."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AuthenticationError, UnexpectedResponse
from .const import DOMAIN


def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register AccCloud websocket commands."""
    websocket_api.async_register_command(hass, websocket_get_entries)
    websocket_api.async_register_command(hass, websocket_get_devices)
    websocket_api.async_register_command(hass, websocket_get_device_state)
    websocket_api.async_register_command(hass, websocket_set_device_state)
    websocket_api.async_register_command(hass, websocket_get_locations)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "accloud/get_entries",
    }
)
@websocket_api.async_response
async def websocket_get_entries(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return loaded AccCloud config entries for card auto-configuration."""
    entries = [
        {"entry_id": entry.entry_id, "title": entry.title}
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.entry_id in hass.data.get(DOMAIN, {})
    ]
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "accloud/get_devices",
        vol.Required("entry_id"): str,
        vol.Optional("page", default=0): vol.Coerce(int),
        vol.Optional("page_size", default=25): vol.Coerce(int),
        vol.Optional("search", default=""): str,
        vol.Optional("sort_key", default="location"): str,
        vol.Optional("sort_dir", default=1): vol.In([1, -1]),
        vol.Optional("filters", default={}): dict,
    }
)
@websocket_api.async_response
async def websocket_get_devices(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return one page of AccCloud devices."""
    await _send_table(hass, connection, msg, "devices", "devices")


@websocket_api.websocket_command(
    {
        vol.Required("type"): "accloud/get_locations",
        vol.Required("entry_id"): str,
        vol.Optional("page", default=0): vol.Coerce(int),
        vol.Optional("page_size", default=25): vol.Coerce(int),
        vol.Optional("search", default=""): str,
        vol.Optional("sort_key", default="number"): str,
        vol.Optional("sort_dir", default=1): vol.In([1, -1]),
        vol.Optional("filters", default={}): dict,
    }
)
@websocket_api.async_response
async def websocket_get_locations(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return one page of AccCloud locations."""
    await _send_table(hass, connection, msg, "locations", "locations")


@websocket_api.websocket_command(
    {
        vol.Required("type"): "accloud/get_device_state",
        vol.Required("entry_id"): str,
        vol.Required("device_id"): str,
    }
)
@websocket_api.async_response
async def websocket_get_device_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the current control state for one AccCloud device."""
    client = _client_for_entry(hass, msg["entry_id"])
    if client is None:
        connection.send_error(msg["id"], "not_found", "Unknown AccCloud config entry")
        return
    try:
        result = await client.async_device_state(
            async_get_clientsession(hass),
            msg["device_id"],
        )
    except AuthenticationError:
        connection.send_error(msg["id"], "invalid_auth", "AccCloud token rejected")
        return
    except UnexpectedResponse as err:
        connection.send_error(msg["id"], "request_failed", str(err))
        return
    except Exception as err:
        connection.send_error(msg["id"], "unknown_error", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "accloud/set_device_state",
        vol.Required("entry_id"): str,
        vol.Required("device_id"): str,
        vol.Required("state"): dict,
    }
)
@websocket_api.async_response
async def websocket_set_device_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Apply a draft control state to one AccCloud device."""
    client = _client_for_entry(hass, msg["entry_id"])
    if client is None:
        connection.send_error(msg["id"], "not_found", "Unknown AccCloud config entry")
        return
    try:
        result = await client.async_set_device_state(
            async_get_clientsession(hass),
            msg["device_id"],
            msg["state"],
        )
    except AuthenticationError:
        connection.send_error(msg["id"], "invalid_auth", "AccCloud token rejected")
        return
    except UnexpectedResponse as err:
        connection.send_error(msg["id"], "request_failed", str(err))
        return
    except Exception as err:
        connection.send_error(msg["id"], "unknown_error", str(err))
        return
    connection.send_result(msg["id"], result)


async def _send_table(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    table: str,
    response_key: str,
) -> None:
    """Fetch and send one table response."""
    client = _client_for_entry(hass, msg["entry_id"])
    if client is None:
        connection.send_error(msg["id"], "not_found", "Unknown AccCloud config entry")
        return
    try:
        result = await client.async_table(
            async_get_clientsession(hass),
            table,
            page=msg["page"],
            page_size=msg["page_size"],
            search=msg["search"],
            sort_key=msg["sort_key"],
            sort_dir=msg["sort_dir"],
            filters=msg["filters"],
        )
    except AuthenticationError:
        connection.send_error(msg["id"], "invalid_auth", "AccCloud token rejected")
        return
    except UnexpectedResponse as err:
        connection.send_error(msg["id"], "request_failed", str(err))
        return
    except Exception as err:
        connection.send_error(msg["id"], "unknown_error", str(err))
        return
    connection.send_result(
        msg["id"],
        {
            "entry_id": msg["entry_id"],
            response_key: result["rows"],
            **{key: value for key, value in result.items() if key != "rows"},
        },
    )


def _client_for_entry(hass: HomeAssistant, entry_id: str):
    """Return the AccCloud client for a loaded config entry."""
    return hass.data.get(DOMAIN, {}).get(entry_id)
