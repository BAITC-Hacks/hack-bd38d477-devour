import time

import pytest

from engine import optimize, simulate, validate

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
