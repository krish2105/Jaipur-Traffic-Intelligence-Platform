"""The exchange adapter, and the two questions it must keep apart.

The catalogue is open and the data behind it is not. Collapsing those into one
"is IUDX live" boolean would lose the only useful thing this adapter has to say:
that Jaipur already publishes vehicle classification camera locations and we
simply cannot read them yet. "Not integrated" and "integrated, awaiting a token"
are different asks, and only one of them is small.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from pravaah.adapters import iudx

CATALOGUE_RESPONSE: dict[str, Any] = {
    "type": "urn:dx:cat:Success",
    "totalHits": 2,
    "results": [
        {
            "id": "38fc0178-0b17-42b2-ad83-948633263156",
            "label": "VCC System Locations in Jaipur City",
            "description": "Vehicle Classification Cameras in Jaipur city.",
            "accessPolicy": "SECURE",
            "dataDescriptor": {
                "@context": "x",
                "type": ["iudx:DataDescriptor"],
                "dataDescriptorLabel": "l",
                "description": "d",
                "name": {},
                "address": {},
                "deviceCount": {},
                "location": {},
            },
        },
        {
            "id": "open-one",
            "label": "Point of Interests (POI) in Jaipur City",
            "description": "POI",
            "accessPolicy": "OPEN",
            "dataDescriptor": {},
        },
    ],
}


def transport(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


def catalogue_ok(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=CATALOGUE_RESPONSE)


class TestDiscovery:
    """Works with no credential at all, which is the point."""

    @pytest.mark.asyncio
    async def test_it_lists_what_the_city_publishes(self) -> None:
        async with transport(catalogue_ok) as client:
            resources = await iudx.discover(client=client)
        assert [r.label for r in resources] == [
            "VCC System Locations in Jaipur City",
            "Point of Interests (POI) in Jaipur City",
        ]

    @pytest.mark.asyncio
    async def test_it_needs_no_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("IUDX_TOKEN", raising=False)
        async with transport(catalogue_ok) as client:
            assert await iudx.discover(client=client) != []

    @pytest.mark.asyncio
    async def test_data_fields_exclude_the_json_ld_scaffolding(self) -> None:
        # @context and the descriptor's own labels are not data fields, and
        # showing them to a department as though they were would be noise.
        async with transport(catalogue_ok) as client:
            vcc = (await iudx.discover(client=client))[0]
        assert set(vcc.fields) == {"name", "address", "deviceCount", "location"}

    @pytest.mark.asyncio
    async def test_an_unreachable_exchange_is_empty_not_an_error(self) -> None:
        async with transport(lambda _r: httpx.Response(503)) as client:
            assert await iudx.discover(client=client) == []

    @pytest.mark.asyncio
    async def test_a_malformed_entry_is_skipped_not_fatal(self) -> None:
        def handler(_r: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"results": [{"no": "id"}, "not-a-dict"]})

        async with transport(handler) as client:
            assert await iudx.discover(client=client) == []


class TestAccessPolicy:
    def test_secure_needs_a_token(self) -> None:
        resource = iudx.Resource("x", "l", "d", "SECURE", ())
        assert resource.needs_token is True

    def test_open_does_not(self) -> None:
        assert iudx.Resource("x", "l", "d", "OPEN", ()).needs_token is False

    def test_an_undeclared_policy_is_treated_as_closed(self) -> None:
        # A provider that has declared nothing has not declared "open", and
        # assuming otherwise would mean planning around access we do not have.
        assert iudx.Resource("x", "l", "d", None, ()).needs_token is True


class TestTheTokenIsSeparateFromTheExchange:
    def test_no_token_means_the_data_side_is_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("IUDX_TOKEN", raising=False)
        assert iudx.available() is False

    def test_a_token_makes_it_available_but_not_yet_verified(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Same rule as TomTom: a credential present is not a credential accepted.
        monkeypatch.setenv("IUDX_TOKEN", "not-a-real-token")
        assert iudx.available() is True

    @pytest.mark.asyncio
    async def test_latest_returns_none_without_a_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("IUDX_TOKEN", raising=False)
        assert await iudx.latest("any-id") is None

    @pytest.mark.asyncio
    async def test_a_refused_resource_is_none_not_an_exception(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("IUDX_TOKEN", "t")

        def handler(request: httpx.Request) -> httpx.Response:
            if "/item" in request.url.path:
                return httpx.Response(200, json={"results": [{"resourceServerRegURL": "rs.x"}]})
            return httpx.Response(401)

        async with transport(handler) as client:
            assert await iudx.latest("id", client=client) is None


class TestTheAsk:
    def test_it_names_the_variable_and_says_what_is_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("IUDX_TOKEN", raising=False)
        needs = iudx.needs()
        assert "IUDX_TOKEN" in needs
        # The important half: the cameras exist. This sentence is the difference
        # between asking a department to buy hardware and asking for read access.
        assert "already published" in needs

    def test_a_present_token_changes_the_ask(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("IUDX_TOKEN", "t")
        assert "not granted" in iudx.needs()

    def test_the_wanted_resources_are_the_camera_ones(self) -> None:
        # If this list drifts, the pitch stops matching what the code asks for.
        labels = " ".join(iudx.WANTED.values())
        assert "VCC" in labels
        assert "ANPR" in labels
