import os

import pytest
from fastapi.testclient import TestClient

from api.main import app

POST_PATHS = ["/api/validate", "/api/simulate", "/api/explain"]

HAS_AGENT_ENDPOINT = any(getattr(route, "path", None) == "/api/agent" for route in app.routes)
requires_agent = pytest.mark.skipif(
    not HAS_AGENT_ENDPOINT, reason="В api/main.py ещё нет POST /api/agent"
)
AGENT_KEYS = {"decisions", "simulation", "steps", "explanation", "source"}
STEP_ACTIONS = {"validate", "simulate"}

BROKEN_DECISIONS = [
    {},
    {"decisions": "M7"},
    {"decisions": 5},
    {"decisions": None},
    {"decisions": {"measure_id": "M7"}},
    {"decisions": [[{"measure_id": "M7"}]]},
    {"decisions": [True, False]},
]

BROKEN_EVENT_IDS = ["EV9", "", 5, 3.5, [], {"id": "EV1"}]

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
        with TestClient(app, raise_server_exceptions=False) as test_client:
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


def test_events_endpoint_lists_five_events(client):
    response = client.get("/api/events")
    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == ["EV1", "EV2", "EV3", "EV4", "EV5"]
    districts = {"Есиль", "Алматы", "Сарыарка", "Байконур", "Нура"}
    for item in body:
        assert item["name"] and item["description"]
        assert 5 <= item["budget_penalty"] <= 15
        assert item["district"] is None or item["district"] in districts
        assert item["effects"] and all(shift < 0 for shift in item["effects"].values())


def test_validate_with_event_reduces_budget(client):
    body = client.post("/api/validate", json={"decisions": CONTROL_SET, "event_id": "EV3"}).json()
    assert body["valid"] is True
    assert body["budget"] == 95
    assert body["budget_left"] == 0


def test_validate_with_heavy_event_rejects_expensive_set(client):
    body = client.post("/api/validate", json={"decisions": CONTROL_SET, "event_id": "EV1"}).json()
    assert body["valid"] is False
    assert body["budget"] == 88
    assert any("Прорыв теплосети" in error for error in body["errors"])


def test_simulate_with_event_lowers_base_score(client):
    response = client.post("/api/simulate", json={"decisions": CONTROL_SET, "event_id": "EV3"})
    assert response.status_code == 200
    body = response.json()
    assert body["event"]["id"] == "EV3"
    assert body["base_score"] < 52.56
    assert body["budget"] == 95
    assert_two_decimals(body)


def test_simulate_rejects_set_over_event_budget(client):
    response = client.post("/api/simulate", json={"decisions": CONTROL_SET, "event_id": "EV1"})
    assert response.status_code == 422
    assert any("бюджет 88" in error for error in response.json()["detail"]["errors"])


def test_explain_with_event(client):
    response = client.post("/api/explain", json={"decisions": CONTROL_SET, "event_id": "EV3"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert set(body["analysis"]) >= set(ANALYSIS_KEYS)
    assert body["simulation"]["event"]["id"] == "EV3"
    assert_two_decimals(body)


def test_compare_scenarios_with_different_events(client):
    payload = {
        "scenarios": [
            {"name": "Без события", "decisions": CHEAP_SET},
            {"name": "Смог", "decisions": CHEAP_SET, "event_id": "EV2"},
        ]
    }
    response = client.post("/api/compare", json=payload)
    assert response.status_code == 200
    body = response.json()
    first, second = body["results"]
    assert first["simulation"]["event"] is None
    assert second["simulation"]["event"]["id"] == "EV2"
    assert second["simulation"]["base_score"] < first["simulation"]["base_score"]


def test_optimize_with_event_respects_reduced_budget(client):
    response = client.get("/api/optimize", params={"top": 3, "event_id": "EV5"})
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    for item in body:
        assert item["total_cost"] <= 85
        check = client.post(
            "/api/validate", json={"decisions": item["decisions"], "event_id": "EV5"}
        ).json()
        assert check["valid"] is True
    assert body[0]["score"] != client.get("/api/optimize", params={"top": 1}).json()[0]["score"]


@pytest.mark.parametrize("path", POST_PATHS)
def test_post_endpoints_reject_empty_body(client, path):
    response = client.post(path, content=b"")
    assert response.status_code == 422


@pytest.mark.parametrize("path", POST_PATHS)
def test_post_endpoints_reject_non_json_body(client, path):
    response = client.post(path, content="просто текст", headers={"Content-Type": "application/json"})
    assert response.status_code == 422


@pytest.mark.parametrize("path", POST_PATHS)
@pytest.mark.parametrize("payload", BROKEN_DECISIONS)
def test_post_endpoints_reject_broken_decisions(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 422
    assert response.json()["detail"]


@pytest.mark.parametrize("path", POST_PATHS)
def test_post_endpoints_ignore_unknown_fields(client, path):
    response = client.post(path, json={"decisions": CONTROL_SET, "junk": 1, "score": 99})
    assert response.status_code == 200


@pytest.mark.parametrize("path", POST_PATHS)
@pytest.mark.parametrize("event_id", BROKEN_EVENT_IDS)
def test_post_endpoints_reject_broken_event_id(client, path, event_id):
    response = client.post(path, json={"decisions": CONTROL_SET, "event_id": event_id})
    assert response.status_code == 422


def test_compare_rejects_broken_payloads(client):
    assert client.post("/api/compare", content=b"").status_code == 422
    assert client.post("/api/compare", content="текст", headers={"Content-Type": "application/json"}).status_code == 422
    assert client.post("/api/compare", json={}).status_code == 422
    assert client.post("/api/compare", json={"scenarios": None}).status_code == 422
    assert client.post("/api/compare", json={"scenarios": "abc"}).status_code == 422
    assert client.post("/api/compare", json={"scenarios": [{"decisions": CONTROL_SET}]}).status_code == 422
    assert client.post("/api/compare", json={"scenarios": [{"name": "A", "decisions": [1, None]}]}).status_code == 422
    assert client.post(
        "/api/compare", json={"scenarios": [{"name": "A", "decisions": CONTROL_SET, "event_id": "EV9"}]}
    ).status_code == 422


def test_compare_accepts_empty_scenario_list(client):
    response = client.post("/api/compare", json={"scenarios": []})
    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.parametrize("top", ["0", "101", "-5", "abc", "1.5", ""])
def test_optimize_rejects_broken_top(client, top):
    assert client.get(f"/api/optimize?top={top}").status_code == 422


@pytest.mark.parametrize("event_id", ["EV9", "", "5"])
def test_optimize_rejects_broken_event_id(client, event_id):
    assert client.get(f"/api/optimize?top=3&event_id={event_id}").status_code == 422


def test_no_endpoint_answers_with_server_error(client):
    requests = [("GET", "/api/state", {}), ("GET", "/api/events", {}), ("GET", "/api/optimize?top=0", {})]
    for path in POST_PATHS:
        requests.append(("POST", path, {"content": b""}))
        requests.append(("POST", path, {"json": {"decisions": [1, None, {"measure_id": ["M1"]}]}}))
        requests.append(("POST", path, {"json": {"decisions": CONTROL_SET, "event_id": "EV9"}}))
    requests.append(("POST", "/api/compare", {"json": {"scenarios": [{"name": "A", "decisions": "x"}]}}))
    for method, path, kwargs in requests:
        response = client.request(method, path, **kwargs)
        assert response.status_code < 500, (method, path, response.status_code, response.text[:200])


@requires_agent
def test_agent_returns_contract_shape(client):
    response = client.post("/api/agent", json={"goal": None, "event_id": None})
    assert response.status_code == 200
    body = response.json()
    assert AGENT_KEYS <= set(body)
    assert isinstance(body["decisions"], list) and len(body["decisions"]) == 5
    for decision in body["decisions"]:
        assert set(decision) >= {"measure_id", "district"}
        assert isinstance(decision["measure_id"], str)
        assert decision["district"] is None or isinstance(decision["district"], str)
    assert isinstance(body["simulation"], dict)
    assert {"score", "base_score", "total_cost", "districts"} <= set(body["simulation"])
    assert isinstance(body["explanation"], str) and body["explanation"].strip()
    assert body["source"] in {"ai", "fallback"}


@requires_agent
def test_agent_steps_describe_engine_calls(client):
    body = client.post("/api/agent", json={"goal": None, "event_id": None}).json()
    steps = body["steps"]
    assert isinstance(steps, list) and steps
    for step in steps:
        assert set(step) >= {"action", "decisions", "summary"}
        assert step["action"] in STEP_ACTIONS
        assert isinstance(step["decisions"], list)
        assert isinstance(step["summary"], str) and step["summary"].strip()
    assert any(step["action"] == "simulate" for step in steps)


@requires_agent
def test_agent_uses_fallback_without_api_key(client):
    body = client.post("/api/agent", json={"goal": None, "event_id": None}).json()
    assert body["source"] == "fallback"


@requires_agent
def test_agent_result_is_valid_set(client):
    body = client.post("/api/agent", json={"goal": None, "event_id": None}).json()
    check = client.post("/api/validate", json={"decisions": body["decisions"]}).json()
    assert check["valid"] is True
    assert check["errors"] == []
    assert check["total_cost"] <= check["budget"]


@requires_agent
def test_agent_score_matches_simulate(client):
    body = client.post("/api/agent", json={"goal": None, "event_id": None}).json()
    direct = client.post("/api/simulate", json={"decisions": body["decisions"]}).json()
    assert body["simulation"]["score"] == pytest.approx(direct["score"], abs=0.01)
    assert body["simulation"]["total_cost"] == direct["total_cost"]


@requires_agent
def test_agent_rounds_floats(client):
    body = client.post("/api/agent", json={"goal": None, "event_id": None}).json()
    assert_two_decimals(body)


@requires_agent
def test_agent_accepts_goal(client):
    response = client.post(
        "/api/agent", json={"goal": "поднять школы и поликлиники в Нуре", "event_id": None}
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["decisions"]) == 5
    assert client.post("/api/validate", json={"decisions": body["decisions"]}).json()["valid"] is True


@requires_agent
def test_agent_accepts_empty_json_object(client):
    response = client.post("/api/agent", json={})
    assert response.status_code == 200
    body = response.json()
    assert AGENT_KEYS <= set(body)
    assert len(body["decisions"]) == 5


@requires_agent
def test_agent_handles_missing_body_without_server_error(client):
    assert client.post("/api/agent", content=b"").status_code < 500


@requires_agent
@pytest.mark.parametrize("event_id", ["EV1", "EV5"])
def test_agent_respects_event_budget(client, event_id):
    event = next(item for item in client.get("/api/events").json() if item["id"] == event_id)
    budget = 100 - event["budget_penalty"]
    response = client.post("/api/agent", json={"goal": None, "event_id": event_id})
    assert response.status_code == 200
    body = response.json()
    check = client.post(
        "/api/validate", json={"decisions": body["decisions"], "event_id": event_id}
    ).json()
    assert check["valid"] is True
    assert check["budget"] == budget
    assert check["total_cost"] <= budget
    assert body["simulation"]["event"]["id"] == event_id
    direct = client.post(
        "/api/simulate", json={"decisions": body["decisions"], "event_id": event_id}
    ).json()
    assert body["simulation"]["score"] == pytest.approx(direct["score"], abs=0.01)
    assert_two_decimals(body)


@requires_agent
@pytest.mark.parametrize("event_id", BROKEN_EVENT_IDS)
def test_agent_rejects_broken_event_id(client, event_id):
    assert client.post("/api/agent", json={"goal": None, "event_id": event_id}).status_code == 422
