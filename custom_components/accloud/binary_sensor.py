"""AccCloud binary sensors."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DATA_COORDINATOR, DOMAIN
from .coordinator import AccCloudSummaryCoordinator
from .entity import AccCloudSummaryEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up AccCloud binary sensors for a config entry."""
    coordinator: AccCloudSummaryCoordinator = hass.data[DOMAIN][entry.entry_id][
        DATA_COORDINATOR
    ]
    async_add_entities([AccCloudConnectedBinarySensor(coordinator, entry)])


class AccCloudConnectedBinarySensor(AccCloudSummaryEntity, BinarySensorEntity):
    """Binary sensor that reports whether the summary endpoint is reachable."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_translation_key = "connected"

    def __init__(
        self,
        coordinator: AccCloudSummaryCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "connected")

    @property
    def available(self) -> bool:
        """Keep the connectivity entity available so it can show outages."""
        return True

    @property
    def is_on(self) -> bool:
        """Return true when the latest summary poll succeeded."""
        return bool(
            self.coordinator.last_update_success
            and self.coordinator.data
            and self.coordinator.data.get("ok", True)
        )
