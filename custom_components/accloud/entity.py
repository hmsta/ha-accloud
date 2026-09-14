"""Shared AccCloud entity helpers."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
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
        instance_id = entry.unique_id or entry.entry_id
        self._attr_unique_id = f"{instance_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, instance_id)},
            manufacturer="AccCloud",
            name=entry.title,
        )
