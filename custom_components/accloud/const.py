"""Constants for AccCloud."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "accloud"
ENTRY_TITLE = "AccCloud"
ENTRY_UNIQUE_ID = DOMAIN

DEVICES_CARD_URL = "/accloud/accloud-devices-table-card.js"
DEVICES_CARD_FILENAME = "accloud-devices-table-card.js"
LOCATIONS_CARD_URL = "/accloud/accloud-locations-table-card.js"
LOCATIONS_CARD_FILENAME = "accloud-locations-table-card.js"

CONF_BASE_URL = "base_url"
CONF_TOKEN = "token"
DEFAULT_TIMEOUT = 15

DATA_CLIENT = "client"
DATA_COORDINATOR = "coordinator"
PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]
SUMMARY_UPDATE_INTERVAL_SECONDS = 60
