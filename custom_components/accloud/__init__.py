"""AccCloud integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import (
    CONF_RESOURCE_TYPE_WS,
    LOVELACE_DATA,
    MODE_STORAGE,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL
from homeassistant.core import HomeAssistant, callback

from .api import AccCloudClient
from .const import (
    CONF_BASE_URL,
    CONF_TOKEN,
    DEVICES_CARD_FILENAME,
    DEVICES_CARD_URL,
    DOMAIN,
    LOCATIONS_CARD_FILENAME,
    LOCATIONS_CARD_URL,
)
from .websocket import async_setup_websocket

_LOGGER = logging.getLogger(__name__)
_STATIC_REGISTERED = False
_CARD_RESOURCES = (DEVICES_CARD_URL, LOCATIONS_CARD_URL)
_CARD_RESOURCE_FILES = {
    DEVICES_CARD_URL: DEVICES_CARD_FILENAME,
    LOCATIONS_CARD_URL: LOCATIONS_CARD_FILENAME,
}


def _get_lovelace_data(hass: HomeAssistant):
    """Return Lovelace data across supported Home Assistant versions."""
    return hass.data.get(LOVELACE_DATA) or hass.data.get("lovelace")


@callback
def _lovelace_resource_collection(lovelace_data):
    """Return the Lovelace resource collection from dataclass or legacy dict data."""
    if lovelace_data is None:
        return None
    if isinstance(lovelace_data, dict):
        return lovelace_data.get("resources")
    return getattr(lovelace_data, "resources", None)


@callback
def _lovelace_resource_mode(lovelace_data) -> str | None:
    """Return the Lovelace resource mode from dataclass or legacy dict data."""
    if lovelace_data is None:
        return None
    if isinstance(lovelace_data, dict):
        return lovelace_data.get("resource_mode") or lovelace_data.get("mode")
    return getattr(lovelace_data, "resource_mode", None)


def _card_resource_version(url: str) -> str:
    """Return a cache-busting version for a bundled card resource."""
    filename = _CARD_RESOURCE_FILES[url]
    path = Path(__file__).parent / "www" / filename
    return str(int(path.stat().st_mtime))


def _versioned_card_resource_url(url: str) -> str:
    """Return card resource URL with a cache-busting query parameter."""
    return f"{url}?v={_card_resource_version(url)}"


async def _ensure_lovelace_card_resources(hass: HomeAssistant) -> None:
    """Register bundled custom cards with Lovelace storage resources."""
    lovelace_data = _get_lovelace_data(hass)
    resources = _lovelace_resource_collection(lovelace_data)
    if resources is None:
        _LOGGER.debug("Lovelace resources are not available yet")
        return
    if _lovelace_resource_mode(lovelace_data) != MODE_STORAGE:
        _LOGGER.info(
            "Lovelace resources are not in storage mode; add AccCloud card "
            "resources manually in Lovelace YAML configuration"
        )
        return
    try:
        await resources.async_get_info()
    except Exception:
        _LOGGER.exception("Unable to load Lovelace resources")
        return
    existing_by_base_url = {
        str(item.get(CONF_URL, "")).split("?", 1)[0]: item
        for item in resources.async_items()
    }
    for url in _CARD_RESOURCES:
        resource_url = _versioned_card_resource_url(url)
        if existing := existing_by_base_url.get(url):
            if existing.get(CONF_URL) != resource_url:
                await resources.async_update_item(
                    existing["id"],
                    {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: resource_url},
                )
                _LOGGER.info("Updated AccCloud Lovelace resource: %s", resource_url)
            continue
        await resources.async_create_item(
            {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: resource_url}
        )
        _LOGGER.info("Registered AccCloud Lovelace resource: %s", resource_url)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up AccCloud from a config entry."""
    global _STATIC_REGISTERED
    if not _STATIC_REGISTERED:
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    DEVICES_CARD_URL,
                    str(Path(__file__).parent / "www" / DEVICES_CARD_FILENAME),
                    True,
                ),
                StaticPathConfig(
                    LOCATIONS_CARD_URL,
                    str(Path(__file__).parent / "www" / LOCATIONS_CARD_FILENAME),
                    True,
                ),
            ]
        )
        await _ensure_lovelace_card_resources(hass)
        async_setup_websocket(hass)
        _STATIC_REGISTERED = True

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = AccCloudClient(
        entry.data[CONF_BASE_URL],
        entry.data[CONF_TOKEN],
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an AccCloud config entry."""
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return True

