"""AccCloud backend change stream."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from contextlib import suppress
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AccCloudClient, AccCloudError, AuthenticationError
from .coordinator import AccCloudSummaryCoordinator

_LOGGER = logging.getLogger(__name__)

UpdateCallback = Callable[[dict[str, Any]], None]


class AccCloudEventStream:
    """Maintain one backend stream and distribute update notifications."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: AccCloudClient,
        coordinator: AccCloudSummaryCoordinator,
    ) -> None:
        """Initialize the event stream manager."""
        self.hass = hass
        self.entry = entry
        self.client = client
        self.coordinator = coordinator
        self.connected = False
        self._stopping = False
        self._tasks: list[asyncio.Task[Any]] = []
        self._update_callbacks: set[UpdateCallback] = set()
        self._refresh_requested = asyncio.Event()
        self._pending_scopes: set[str] = set()
        self._pending_revision: Any = None

    async def async_start(self) -> None:
        """Start the stream workers."""
        self._tasks = [
            self._create_task(self._async_run_stream(), "AccCloud event stream"),
            self._create_task(self._async_refresh_worker(), "AccCloud event refresh"),
        ]

    async def async_stop(self) -> None:
        """Stop background work and release subscribers."""
        self._stopping = True
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()
        self._update_callbacks.clear()

    def _create_task(
        self,
        target: Coroutine[Any, Any, Any],
        name: str,
    ) -> asyncio.Task[Any]:
        """Create a config-entry-owned background task."""
        return self.entry.async_create_background_task(self.hass, target, name)

    @callback
    def async_subscribe_updates(self, listener: UpdateCallback) -> Callable[[], None]:
        """Subscribe to card invalidation messages."""
        self._update_callbacks.add(listener)

        @callback
        def unsubscribe() -> None:
            self._update_callbacks.discard(listener)

        return unsubscribe

    async def _async_run_stream(self) -> None:
        """Reconnect forever with bounded exponential backoff."""
        session = async_get_clientsession(self.hass)
        backoff = 1
        while not self._stopping:
            try:
                async for message in self.client.async_event_messages(session):
                    message_type = str(message.get("type") or "")
                    if message_type == "ready":
                        self.connected = True
                        backoff = 1
                        self._publish_update(
                            {
                                "type": "stream_ready",
                                "revision": message.get("revision"),
                                "scopes": ["devices", "locations"],
                            }
                        )
                        self._request_refresh({"summary"})
                        continue
                    if message_type != "device_changed":
                        continue
                    scopes = {
                        str(scope)
                        for scope in message.get("scopes", [])
                        if str(scope)
                    }
                    self._request_refresh(
                        scopes,
                        revision=message.get("revision"),
                    )
            except asyncio.CancelledError:
                raise
            except AuthenticationError:
                self.connected = False
                _LOGGER.error("AccCloud event stream authentication failed")
            except AccCloudError as err:
                self.connected = False
                _LOGGER.debug("AccCloud event stream disconnected: %s", err)
            except Exception:
                self.connected = False
                _LOGGER.exception("Unexpected AccCloud event stream failure")

            if self._stopping:
                return
            self._publish_update(
                {
                    "type": "stream_disconnected",
                    "scopes": [],
                }
            )
            await asyncio.sleep(backoff)
            backoff = min(60, backoff * 2)

    @callback
    def _request_refresh(
        self,
        scopes: set[str],
        *,
        revision: Any = None,
    ) -> None:
        """Coalesce stream bursts into one refresh operation."""
        self._pending_scopes.update(scopes)
        if revision is not None:
            self._pending_revision = revision
        self._refresh_requested.set()

    async def _async_refresh_worker(self) -> None:
        """Refresh tables and summaries after a short coalescing delay."""
        while True:
            await self._refresh_requested.wait()
            await asyncio.sleep(2)
            scopes = self._pending_scopes
            self._pending_scopes = set()
            revision = self._pending_revision
            self._pending_revision = None
            self._refresh_requested.clear()
            card_scopes = sorted(scopes & {"devices", "locations"})
            if card_scopes:
                self._publish_update(
                    {
                        "type": "changes_available",
                        "revision": revision,
                        "scopes": card_scopes,
                    }
                )
            if "summary" in scopes:
                try:
                    await self.coordinator.async_request_refresh()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    _LOGGER.exception("AccCloud live summary refresh failed")

    @callback
    def _publish_update(self, message: dict[str, Any]) -> None:
        """Forward one backend invalidation to HA frontend subscribers."""
        event = dict(message)
        event["entry_id"] = self.entry.entry_id
        for listener in tuple(self._update_callbacks):
            try:
                listener(event)
            except Exception:
                _LOGGER.exception("AccCloud update subscriber failed")
