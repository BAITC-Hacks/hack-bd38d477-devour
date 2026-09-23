import time

import pytest

from engine import get_event, list_events, optimize, simulate, validate

TOLERANCE = 0.01

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


def test_base_scenario_score():
    result = simulate([])
    assert result["score"] == pytest.approx(52.55768, abs=TOLERANCE)
    assert result["d_avg"] == pytest.approx(56.8624, abs=TOLERANCE)
    assert result["n_crit"] == 2
    assert result["total_cost"] == 0
    assert result["budget_left"] == 100


def test_control_set_score():
    result = simulate(CONTROL_SET)
    assert result["score"] == pytest.approx(56.54307, abs=TOLERANCE)
    assert result["total_cost"] == 95
    assert result["budget_left"] == 5
    assert result["base_score"] == pytest.approx(52.55768, abs=TOLERANCE)
    assert result["delta"] == pytest.approx(56.54307 - 52.55768, abs=TOLERANCE)


def test_cheap_set_cost_and_validity():
    check = validate(CHEAP_SET)
    assert check["valid"] is True
    assert check["errors"] == []
    assert check["total_cost"] == 61
    assert check["budget_left"] == 39
    assert simulate(CHEAP_SET)["total_cost"] == 61


def test_rule_budget_limit():
    decisions = [
        {"measure_id": "M3", "district": "Есиль"},
        {"measure_id": "M13", "district": "Нура"},
        {"measure_id": "M5", "district": "Алматы"},
        {"measure_id": "M7", "district": "Нура"},
        {"measure_id": "M8", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert result["total_cost"] == 127
    assert result["budget_left"] == -27
    assert any("бюджет" in error for error in result["errors"])


def test_rule_exactly_five_measures():
    decisions = [
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("ровно 5 мер" in error for error in result["errors"])


def test_rule_no_duplicates():
    decisions = [
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
        {"measure_id": "M4", "district": "Есиль"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("несколько раз" in error for error in result["errors"])


def test_rule_district_required_for_regional_measure():
    decisions = [
        {"measure_id": "M9", "district": None},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
        {"measure_id": "M4", "district": "Есиль"},
        {"measure_id": "M11", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("нужно указать район" in error for error in result["errors"])


def test_rule_unknown_district_rejected():
    decisions = [
        {"measure_id": "M9", "district": "Медеу"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
        {"measure_id": "M4", "district": "Есиль"},
        {"measure_id": "M11", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("неизвестный район" in error for error in result["errors"])


def test_rule_city_measure_without_district():
    decisions = [
        {"measure_id": "M12", "district": "Нура"},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M4", "district": "Есиль"},
        {"measure_id": "M11", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("район должен быть null" in error for error in result["errors"])


def test_rule_direction_limit():
    decisions = [
        {"measure_id": "M4", "district": "Есиль"},
        {"measure_id": "M5", "district": "Алматы"},
        {"measure_id": "M6", "district": None},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("Не более 2 мер" in error for error in result["errors"])


def test_rule_incompatible_measures_any_district():
    decisions = [
        {"measure_id": "M1", "district": "Есиль"},
        {"measure_id": "M3", "district": "Нура"},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
    ]
    result = validate(decisions)
    assert result["valid"] is False
    assert any("«M1» и «M3» несовместимы" in error for error in result["errors"])


def test_rule_incompatible_measures_same_district():
    same = [
        {"measure_id": "M4", "district": "Нура"},
        {"measure_id": "M7", "district": "Нура"},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
    ]
    result = validate(same)
    assert result["valid"] is False
    assert any("в одном районе" in error for error in result["errors"])

    other = [
        {"measure_id": "M4", "district": "Есиль"},
        {"measure_id": "M7", "district": "Нура"},
        {"measure_id": "M9", "district": "Нура"},
        {"measure_id": "M10", "district": "Нура"},
        {"measure_id": "M12", "district": None},
    ]
    assert validate(other)["valid"] is True


def test_rule_invalid_set_has_reasons_and_no_score():
    result = validate([{"measure_id": "M99", "district": None}])
    assert result["valid"] is False
    assert len(result["errors"]) >= 1
    assert "score" not in result


def test_rule_order_does_not_matter():
    straight = validate(CONTROL_SET)
    reversed_set = validate(list(reversed(CONTROL_SET)))
    assert straight == reversed_set
    assert simulate(CONTROL_SET)["score"] == pytest.approx(
        simulate(list(reversed(CONTROL_SET)))["score"], abs=1e-9
    )


def test_optimize_returns_valid_sets_in_order():
    started = time.monotonic()
    best = optimize(5)
    assert time.monotonic() - started < 10
    assert len(best) == 5
    scores = [item["score"] for item in best]
    assert scores == sorted(scores, reverse=True)
    for item in best:
        assert validate(item["decisions"])["valid"] is True
        assert item["total_cost"] <= 100
        assert item["score"] == pytest.approx(simulate(item["decisions"])["score"], abs=1e-9)


def test_optimize_is_cached_and_immutable():
    first = optimize(3)
    first[0]["score"] = -1
    second = optimize(3)
    assert second[0]["score"] != -1
    assert optimize(0) == []


def test_event_catalog_contents():
    events = list_events()
    assert [event["id"] for event in events] == ["EV1", "EV2", "EV3", "EV4", "EV5"]
    districts = {"Есиль", "Алматы", "Сарыарка", "Байконур", "Нура"}
    for event in events:
        assert event["name"] and event["description"]
        assert 5 <= event["budget_penalty"] <= 15
        assert event["effects"]
        assert all(shift < 0 for shift in event["effects"].values())
        assert event["district"] is None or event["district"] in districts
    assert get_event("EV1")["district"] == "Алматы"
    assert get_event("EV5")["district"] is None


def test_get_event_unknown_id_raises_russian_error():
    with pytest.raises(ValueError) as info:
        get_event("EV42")
    message = str(info.value)
    assert "Неизвестное событие" in message
    assert "EV1" in message


def test_calls_without_event_keep_control_numbers():
    assert simulate([], None)["score"] == pytest.approx(52.55768, abs=TOLERANCE)
    assert simulate(CONTROL_SET, None)["score"] == pytest.approx(56.54307, abs=TOLERANCE)
    assert simulate([])["event"] is None
    assert simulate(CONTROL_SET)["event"] is None
    assert validate(CONTROL_SET, None) == validate(CONTROL_SET)
    assert validate(CONTROL_SET)["budget"] == 100
    assert optimize(3, None) == optimize(3)


def test_every_event_lowers_base_score():
    for event in list_events():
        result = simulate([], event["id"])
        assert result["score"] < 52.55768
        assert result["event"]["id"] == event["id"]
        assert result["budget"] == 100 - event["budget_penalty"]


def test_event_effects_are_not_scaled_by_lag():
    result = simulate([], "EV3")
    nura = next(item for item in result["districts"] if item["name"] == "Нура")
    assert nura["before"]["B2"] == pytest.approx(36.0, abs=1e-9)
    city = simulate([], "EV5")
    for district in city["districts"]:
        base = next(item for item in simulate([])["districts"] if item["name"] == district["name"])
        assert district["before"]["T1"] == pytest.approx(base["before"]["T1"] - 10, abs=1e-9)


def test_expensive_set_invalid_under_heavy_event():
    assert validate(CONTROL_SET)["total_cost"] == 95
    for event in list_events():
        result = validate(CONTROL_SET, event["id"])
        assert result["budget"] == 100 - event["budget_penalty"]
        if event["budget_penalty"] >= 10:
            assert result["valid"] is False
            assert any(event["name"] in error for error in result["errors"])


def test_optimize_under_event_returns_valid_sets():
    for event in list_events():
        best = optimize(3, event["id"])
        assert len(best) == 3
        for item in best:
            assert validate(item["decisions"], event["id"])["valid"] is True
            assert item["total_cost"] <= 100 - event["budget_penalty"]
            assert item["score"] == pytest.approx(
                simulate(item["decisions"], event["id"])["score"], abs=1e-9
            )


def test_optimize_cache_is_separate_per_event():
    assert optimize(1)[0]["score"] != optimize(1, "EV5")[0]["score"]
    assert optimize(1, "EV1") != optimize(1, "EV2")

    started = time.monotonic()
    optimize(3, "EV4")
    assert time.monotonic() - started < 10
