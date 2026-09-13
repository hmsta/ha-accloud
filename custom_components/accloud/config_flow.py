"""Config flow for AccCloud."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AuthenticationError, AccCloudClient
from .const import CONF_BASE_URL, CONF_TOKEN, DOMAIN


def _normalize_base_url(value: str) -> str:
    """Normalize a user-entered AccCloud URL."""
    text = str(value).strip().rstrip("/")
    if "://" not in text:
        text = f"https://{text}"
    parsed = urlsplit(text)
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", "")).rstrip("/")


def _entry_title(base_url: str) -> str:
    """Return a readable config entry title."""
    parsed = urlsplit(base_url)
    return f"AccCloud {parsed.hostname or base_url}"


def _schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    defaults = defaults or {}
    token_selector = selector.TextSelector(
        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
    )
    schema: dict[Any, Any] = {
        vol.Required(CONF_BASE_URL, default=defaults.get(CONF_BASE_URL, "")): str,
    }
    if CONF_TOKEN in defaults:
        schema[vol.Optional(CONF_TOKEN)] = token_selector
    else:
        schema[vol.Required(CONF_TOKEN)] = token_selector
    return vol.Schema(schema)


async def _validate_input(hass, data: dict[str, Any]) -> None:
    """Validate base URL and token against the AccCloud API."""
    client = AccCloudClient(data[CONF_BASE_URL], data[CONF_TOKEN])
    await client.async_validate(async_get_clientsession(hass))


class AccCloudConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle an AccCloud config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            data = {
                **user_input,
                CONF_BASE_URL: _normalize_base_url(user_input[CONF_BASE_URL]),
            }
            unique_id = data[CONF_BASE_URL]
            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured()
            try:
                await _validate_input(self.hass, data)
            except AuthenticationError:
                errors["base"] = "invalid_auth"
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title=_entry_title(unique_id),
                    data=data,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_schema(user_input),
            errors=errors,
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        entry = self.hass.config_entries.async_get_entry(self.context["entry_id"])
        assert entry is not None
        errors: dict[str, str] = {}
        defaults = {**entry.data}

        if user_input is not None:
            data = {
                **entry.data,
                **{
                    key: value
                    for key, value in user_input.items()
                    if key != CONF_TOKEN or value
                },
            }
            data[CONF_BASE_URL] = _normalize_base_url(data[CONF_BASE_URL])
            unique_id = data[CONF_BASE_URL]
            if unique_id != entry.unique_id:
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured()
            try:
                await _validate_input(self.hass, data)
            except AuthenticationError:
                errors["base"] = "invalid_auth"
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                self.hass.config_entries.async_update_entry(
                    entry,
                    unique_id=unique_id,
                    title=_entry_title(unique_id),
                    data=data,
                )
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reconfigure_successful")

        return self.async_show_form(
            step_id="reconfigure",
            data_schema=_schema(defaults),
            errors=errors,
        )

