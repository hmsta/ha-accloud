"""AccCloud HTTP API client."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

import aiohttp

from .const import DEFAULT_TIMEOUT


class AccCloudError(Exception):
    """Base AccCloud API error."""


class AuthenticationError(AccCloudError):
    """AccCloud rejected the configured bearer token."""


class UnexpectedResponse(AccCloudError):
    """AccCloud returned an unexpected response."""


class AccCloudClient:
    """Small bearer-token client for AccCloud JSON endpoints."""

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    async def async_validate(self, session: aiohttp.ClientSession) -> None:
        """Validate the configured base URL and bearer token."""
        await self.async_table(
            session,
            "devices",
            page=0,
            page_size=1,
            search="",
            sort_key="location",
            sort_dir=1,
            filters={},
        )

    async def async_table(
        self,
        session: aiohttp.ClientSession,
        table: str,
        *,
        page: int,
        page_size: int,
        search: str,
        sort_key: str,
        sort_dir: int,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        """Fetch one AccCloud admin table page."""
        path = {
            "devices": "/api/admin/devices",
            "locations": "/api/admin/locations",
        }[table]
        payload = await self._async_get_json(
            session,
            path,
            self._table_params(
                page=page,
                page_size=page_size,
                search=search,
                sort_key=sort_key,
                sort_dir=sort_dir,
                filters=filters,
            ),
        )
        return _normalize_table_payload(payload)

    async def async_device_state(
        self,
        session: aiohttp.ClientSession,
        device_id: str,
    ) -> dict[str, Any]:
        """Fetch the current AccCloud control state for one device."""
        return await self._async_get_json(
            session,
            f"/api/devices/{quote(device_id, safe='')}/state",
            {},
        )

    async def async_device_activity(
        self,
        session: aiohttp.ClientSession,
        device_id: str,
        *,
        limit: int,
    ) -> dict[str, Any]:
        """Fetch recent activity for one device."""
        return await self._async_get_json(
            session,
            f"/api/devices/{quote(device_id, safe='')}/detail/activity",
            {"limit": max(1, min(100, int(limit)))},
        )

    async def async_set_device_state(
        self,
        session: aiohttp.ClientSession,
        device_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Apply a partial control state to one AccCloud device."""
        return await self._async_post_json(
            session,
            f"/api/devices/{quote(device_id, safe='')}/commands/state",
            state,
        )

    async def async_set_location_state(
        self,
        session: aiohttp.ClientSession,
        location_id: str,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Apply a partial control state to all online devices in one location."""
        return await self._async_post_json(
            session,
            f"/api/locations/{quote(str(location_id), safe='')}/commands/state",
            state,
        )

    async def async_location_activity(
        self,
        session: aiohttp.ClientSession,
        location_id: str,
        *,
        limit: int,
    ) -> dict[str, Any]:
        """Fetch recent activity for one location."""
        return await self._async_get_json(
            session,
            f"/api/locations/{quote(str(location_id), safe='')}/detail/activity",
            {"limit": max(1, min(100, int(limit)))},
        )

    async def async_summary(self, session: aiohttp.ClientSession) -> dict[str, Any]:
        """Fetch aggregate values for Home Assistant sensors."""
        payload = await self._async_get_json(
            session,
            "/api/homeassistant/summary",
            {},
        )
        if payload.get("ok") is False:
            raise UnexpectedResponse("AccCloud summary endpoint returned ok=false")
        return payload

    async def _async_get_json(
        self,
        session: aiohttp.ClientSession,
        path: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params:
            url = f"{url}?{urlencode(params)}"
        try:
            async with session.get(
                url,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {self.token}",
                },
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                if response.status in {401, 403}:
                    raise AuthenticationError("AccCloud rejected the bearer token")
                if response.status != 200:
                    text = await response.text(errors="replace")
                    raise UnexpectedResponse(
                        f"AccCloud HTTP {response.status}: {text[:200]}"
                    )
                payload = await response.json(content_type=None)
        except TimeoutError as err:
            raise UnexpectedResponse("AccCloud request timed out") from err
        except aiohttp.ClientError as err:
            raise UnexpectedResponse(f"AccCloud request failed: {err}") from err
        if not isinstance(payload, dict):
            raise UnexpectedResponse("AccCloud returned non-object JSON")
        return payload

    async def _async_post_json(
        self,
        session: aiohttp.ClientSession,
        path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        try:
            async with session.post(
                url,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {self.token}",
                },
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                if response.status in {401, 403}:
                    raise AuthenticationError("AccCloud rejected the bearer token")
                if response.status != 200:
                    text = await response.text(errors="replace")
                    raise UnexpectedResponse(
                        f"AccCloud HTTP {response.status}: {text[:200]}"
                    )
                response_payload = await response.json(content_type=None)
        except TimeoutError as err:
            raise UnexpectedResponse("AccCloud request timed out") from err
        except aiohttp.ClientError as err:
            raise UnexpectedResponse(f"AccCloud request failed: {err}") from err
        if not isinstance(response_payload, dict):
            raise UnexpectedResponse("AccCloud returned non-object JSON")
        return response_payload

    def _table_params(
        self,
        *,
        page: int,
        page_size: int,
        search: str,
        sort_key: str,
        sort_dir: int,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_page_size = int(page_size)
        params: dict[str, Any] = {
            "page": max(0, int(page)) + 1,
            "page_size": 0
            if normalized_page_size <= 0
            else max(1, min(100, normalized_page_size)),
            "sort_key": sort_key,
            "sort_dir": "desc" if sort_dir == -1 else "asc",
        }
        if search.strip():
            params["search"] = search.strip()
        for key, value in filters.items():
            if value is not None and str(value) != "":
                params[key] = str(value)
        return params


def _normalize_table_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize AccCloud's JSON table envelope to card/websocket conventions."""
    page = max(0, int(payload.get("page") or 1) - 1)
    page_size = int(payload.get("pageSize") or 0)
    page_count = int(payload.get("pageCount") or 1)
    return {
        "rows": payload.get("rows") if isinstance(payload.get("rows"), list) else [],
        "total": int(payload.get("total") or 0),
        "filtered": int(payload.get("filtered") or 0),
        "page": page,
        "page_size": page_size,
        "page_count": max(1, page_count),
        "filter_options": payload.get("filterOptions")
        if isinstance(payload.get("filterOptions"), dict)
        else {},
    }
