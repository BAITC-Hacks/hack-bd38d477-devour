import os

import pytest
from fastapi.testclient import TestClient

from api.main import app

HAS_EVENTS_ENDPOINT = any(getattr(route, "path", None) == "/api/events" for route in app.routes)
EVENTS_REASON = "В api/main.py ещё нет GET /api/events и параметра event_id"

CONTROL_SET = [
    {"measure_id": "M7", "district": "Нура"},
    {"measure_id": "M8", "district": "Нура"},
    {"measure_id": "M10", "district": "Нура"},
    {"measure_id": "M12", "district": None},
    {"measure_id": "M5", "district": "Сарыарка"},
]

CHEAP_SET = [
    {"measure_id": "M9", "district": "Нура"},
    {"measure_id": "M11", "district": "Нура"},
    {"measure_id": "M10", "district": "Есиль"},
    {"measure_id": "M12", "district": None},
    {"measure_id": "M4", "district": "Сарыарка"},
]

INVALID_SET = [
    {"measure_id": "M3", "district": "Есиль"},
    {"measure_id": "M13", "district": "Нура"},
    {"measure_id": "M5", "district": "Нура"},
    {"measure_id": "M7", "district": "Нура"},
    {"measure_id": "M8", "district": "Нура"},
]

ANALYSIS_KEYS = ("summary", "strengths", "risks", "consequences", "tradeoffs", "recommendations")


@pytest.fixture(scope="module")
def client():
    saved = os.environ.pop("OPENAI_API_KEY", None)
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if saved is not None:
            os.environ["OPENAI_API_KEY"] = saved


def iter_floats(payload):
    if isinstance(payload, float):
        yield payload
    elif isinstance(payload, dict):
        for value in payload.values():
            yield from iter_floats(value)
    elif isinstance(payload, list):
        for value in payload:
            yield from iter_floats(value)


def assert_two_decimals(payload):
    for value in iter_floats(payload):
        assert value == round(value, 2), value


def test_state_returns_city_snapshot(client):
    response = client.get("/api/state")
    assert response.status_code == 200
    body = response.json()
    assert body["budget"] == 100
    assert len(body["districts"]) == 5
    assert len(body["measures"]) == 14
    assert len(body["weights"]) == 10
    assert body["weights"]["E2"] == pytest.approx(0.11, abs=1e-9)
    assert body["base_score"] == pytest.approx(52.56, abs=0.01)
    assert_two_decimals(body)


def test_validate_reports_errors_for_invalid_set(client):
    response = client.post("/api/validate", json={"decisions": INVALID_SET})
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["errors"]
    assert body["total_cost"] == 127
    assert any("бюджет" in error for error in body["errors"])
    assert any("одном районе" in error for error in body["errors"])
    assert_two_decimals(body)


def test_validate_accepts_control_set(client):
    body = client.post("/api/validate", json={"decisions": CONTROL_SET}).json()
    assert body["valid"] is True
    assert body["errors"] == []
    assert body["total_cost"] == 95
    assert body["budget_left"] == 5


def test_simulate_control_set(client):
    response = client.post("/api/simulate", json={"decisions": CONTROL_SET})
    assert response.status_code == 200
    body = response.json()
    assert body["score"] == pytest.approx(56.54, abs=0.01)
    assert body["base_score"] == pytest.approx(52.56, abs=0.01)
    assert body["total_cost"] == 95
    assert len(body["districts"]) == 5
    assert len(body["contributions"]) == 5
    assert_two_decimals(body)


def test_simulate_rejects_invalid_set(client):
    response = client.post("/api/simulate", json={"decisions": INVALID_SET})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["valid"] is False
    assert detail["errors"]


def test_explain_uses_fallback_without_api_key(client):
    response = client.post("/api/explain", json={"decisions": CONTROL_SET})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert set(body["analysis"]) >= set(ANALYSIS_KEYS)
    assert isinstance(body["analysis"]["summary"], str) and body["analysis"]["summary"]
    for key in ANALYSIS_KEYS[1:]:
        assert isinstance(body["analysis"][key], list)
    assert body["simulation"]["score"] == pytest.approx(56.54, abs=0.01)
    assert_two_decimals(body)


def test_explain_rejects_invalid_set(client):
    assert client.post("/api/explain", json={"decisions": INVALID_SET}).status_code == 422


def test_compare_two_scenarios(client):
    payload = {
        "scenarios": [
            {"name": "Поддержка районов", "decisions": CONTROL_SET},
            {"name": "Экономный", "decisions": CHEAP_SET},
        ]
    }
    response = client.post("/api/compare", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert isinstance(body["analysis"], str) and body["analysis"]
    assert [item["name"] for item in body["results"]] == ["Поддержка районов", "Экономный"]
    assert body["results"][0]["simulation"]["total_cost"] == 95
    assert body["results"][1]["simulation"]["total_cost"] == 61
    assert_two_decimals(body)


def test_optimize_returns_best_sets(client):
    response = client.get("/api/optimize", params={"top": 3})
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    scores = [item["score"] for item in body]
    assert scores == sorted(scores, reverse=True)
    for item in body:
        assert item["total_cost"] <= 100
        assert len(item["decisions"]) == 5
        assert client.post("/api/validate", json={"decisions": item["decisions"]}).json()["valid"]
    assert_two_decimals(body)


def test_optimize_rejects_out_of_range_top(client):
    assert client.get("/api/optimize", params={"top": 0}).status_code == 422
    assert client.get("/api/optimize", params={"top": 101}).status_code == 422


def test_index_serves_interface(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Аким на 5 часов" in response.text


@pytest.mark.skipif(not HAS_EVENTS_ENDPOINT, reason=EVENTS_REASON)
def test_events_endpoint_lists_five_events(client):
    response = client.get("/api/events")
    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == ["EV1", "EV2", "EV3", "EV4", "EV5"]
    for item in body:
        assert 5 <= item["budget_penalty"] <= 15


@pytest.mark.skipif(not HAS_EVENTS_ENDPOINT, reason=EVENTS_REASON)
def test_simulate_with_event_lowers_base_score(client):
    body = client.post("/api/simulate", json={"decisions": CONTROL_SET, "event_id": "EV3"}).json()
    assert body["event"]["id"] == "EV3"
    assert body["base_score"] < 52.56
    assert body["budget"] == 95


@pytest.mark.skipif(not HAS_EVENTS_ENDPOINT, reason=EVENTS_REASON)
def test_validate_with_heavy_event_rejects_expensive_set(client):
    body = client.post("/api/validate", json={"decisions": CONTROL_SET, "event_id": "EV1"}).json()
    assert body["valid"] is False
    assert body["budget"] == 88
