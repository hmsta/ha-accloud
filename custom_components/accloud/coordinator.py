"""AccCloud data update coordinator."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AccCloudClient, AccCloudError, AuthenticationError
from .const import DOMAIN, SUMMARY_UPDATE_INTERVAL_SECONDS

_LOGGER = logging.getLogger(__name__)


class AccCloudSummaryCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinate polling the AccCloud Home Assistant summary endpoint."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: AccCloudClient,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN}_{entry.entry_id}_summary",
            update_interval=timedelta(seconds=SUMMARY_UPDATE_INTERVAL_SECONDS),
            always_update=False,
        )
        self.client = client

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch summary data from AccCloud."""
        try:
            return await self.client.async_summary(async_get_clientsession(self.hass))
        except AuthenticationError as err:
            raise ConfigEntryAuthFailed from err
        except AccCloudError as err:
            raise UpdateFailed(f"Error communicating with AccCloud: {err}") from err
