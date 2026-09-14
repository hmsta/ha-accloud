"""AccCloud summary sensors."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import math
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfEnergy, UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DATA_COORDINATOR, DOMAIN
from .coordinator import AccCloudSummaryCoordinator
from .entity import AccCloudSummaryEntity


@dataclass(frozen=True, kw_only=True)
class AccCloudSensorEntityDescription(SensorEntityDescription):
    """Description for an AccCloud summary sensor."""

    value_fn: Callable[[dict[str, Any]], int | float | None]


def _section(data: dict[str, Any], key: str) -> dict[str, Any]:
    """Return a nested object section from the summary payload."""
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> int | float | None:
    """Return a JSON value as a finite number."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _int_from_section(data: dict[str, Any], section: str, key: str) -> int | None:
    """Return an integer value from a summary section."""
    value = _number(_section(data, section).get(key))
    return int(value) if value is not None else None


def _number_from_section(
    data: dict[str, Any],
    section: str,
    key: str,
) -> int | float | None:
    """Return a numeric value from a summary section."""
    return _number(_section(data, section).get(key))


def _energy_today_kwh(data: dict[str, Any]) -> float | None:
    """Return today's energy value in kWh."""
    value = _number(_section(data, "energy").get("todayWh"))
    return value / 1000 if value is not None else None


SENSOR_DESCRIPTIONS: tuple[AccCloudSensorEntityDescription, ...] = (
    AccCloudSensorEntityDescription(
        key="total_acs",
        translation_key="total_acs",
        icon="mdi:air-conditioner",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda data: _int_from_section(data, "devices", "total"),
    ),
    AccCloudSensorEntityDescription(
        key="online_acs",
        translation_key="online_acs",
        icon="mdi:air-conditioner",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda data: _int_from_section(data, "devices", "online"),
    ),
    AccCloudSensorEntityDescription(
        key="offline_acs",
        translation_key="offline_acs",
        icon="mdi:air-conditioner",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda data: _int_from_section(data, "devices", "offline"),
    ),
    AccCloudSensorEntityDescription(
        key="on_acs",
        translation_key="on_acs",
        icon="mdi:air-conditioner",
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda data: _int_from_section(data, "devices", "on"),
    ),
    AccCloudSensorEntityDescription(
        key="estimated_power",
        translation_key="estimated_power",
        device_class=SensorDeviceClass.POWER,
        native_unit_of_measurement=UnitOfPower.WATT,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=0,
        value_fn=lambda data: _number_from_section(data, "load", "estimatedPowerW"),
    ),
    AccCloudSensorEntityDescription(
        key="energy_today",
        translation_key="energy_today",
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        state_class=SensorStateClass.TOTAL_INCREASING,
        suggested_display_precision=3,
        value_fn=_energy_today_kwh,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up AccCloud sensors for a config entry."""
    coordinator: AccCloudSummaryCoordinator = hass.data[DOMAIN][entry.entry_id][
        DATA_COORDINATOR
    ]
    async_add_entities(
        AccCloudSummarySensor(coordinator, entry, description)
        for description in SENSOR_DESCRIPTIONS
    )


class AccCloudSummarySensor(AccCloudSummaryEntity, SensorEntity):
    """AccCloud summary sensor."""

    entity_description: AccCloudSensorEntityDescription

    def __init__(
        self,
        coordinator: AccCloudSummaryCoordinator,
        entry: ConfigEntry,
        description: AccCloudSensorEntityDescription,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, description.key)
        self.entity_description = description
        self._attr_translation_key = description.translation_key

    @property
    def native_value(self) -> int | float | None:
        """Return the current sensor value."""
        if not self.coordinator.data:
            return None
        return self.entity_description.value_fn(self.coordinator.data)
