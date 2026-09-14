"""Shared AccCloud entity helpers."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, ENTRY_TITLE, ENTRY_UNIQUE_ID
from .coordinator import AccCloudSummaryCoordinator


class AccCloudSummaryEntity(CoordinatorEntity[AccCloudSummaryCoordinator]):
    """Base entity for AccCloud summary sensors."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AccCloudSummaryCoordinator,
        entry: ConfigEntry,
        key: str,
    ) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{ENTRY_UNIQUE_ID}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, ENTRY_UNIQUE_ID)},
            manufacturer="AccCloud",
            name=ENTRY_TITLE,
        )
