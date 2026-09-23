import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ai import agent, explainer


@pytest.mark.parametrize("text,inputs,expected", [
    ("Score 999,00", {"score": 56.54}, False),
    ("Score 56,54", {"score": 56.54307}, True),
    ("Score 56.54", {"score": 56.54307}, True),
    ("Бюджет 88", {"budget": 88.0}, True),
    ("Бюджет 88,00", {"budget": 88}, True),
    ("Сдвиг −18,00", {"effects": {"C1": -18}}, True),
    ("Сдвиг +18,00", {"effects": {"C1": -18}}, False),
    ("Бюджет 1\u202f000,00", {"budget": 1000}, True),
    ("Score 9.99e2", {"score": 56.54}, False),
    ("Score 1e999", {"score": 56.54}, False),
    ("Score 1", {"valid": True}, False),
    ("Score 999,00", {"score": 56.54, "nested": [{"value": 999}]}, True),
])
def test_numeric_grounding(text, inputs, expected):
    assert explainer.numbers_supported(text, inputs) is expected


def analysis(summary):
    return {key: summary if key == "summary" else [] for key in explainer.ANALYSIS_KEYS}


def response(content, calls=None):
    message = SimpleNamespace(content=content, tool_calls=calls)
    message.model_dump = lambda **kwargs: {"role": "assistant", "content": content, "tool_calls": []}
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.mark.parametrize("corrected", [True, False])
def test_explainer_retries_once(monkeypatch, corrected):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    create = Mock(side_effect=[response(json.dumps(analysis("Score 999,00"))), response(json.dumps(analysis("Score 56.54" if corrected else "Score 999,00")))])
    monkeypatch.setattr(explainer, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result, source = explainer.explain_simulation({"score": 56.54})
    assert create.call_count == 2
    assert source == ("ai" if corrected else "fallback")
    assert "999" not in json.dumps(result)


@pytest.mark.parametrize("event_id,budget", [(None, 100), ("EV1", 88)])
def test_list_measures_event_budget(event_id, budget):
    result = agent._tool_result("list_measures", {}, event_id, [], [])
    assert result["budget"] == budget
    assert (result["event"]["id"] if result["event"] else None) == event_id


@pytest.mark.parametrize("corrected", [True, False])
def test_agent_retries_numbers_from_tools_only(monkeypatch, corrected):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    call = SimpleNamespace(id="tool-1", function=SimpleNamespace(name="simulate_plan", arguments='{"decisions": []}'))
    final = lambda text: json.dumps({"decisions": [], "explanation": text})
    create = Mock(side_effect=[response(None, [call]), response(final("Score 999,00")), response(final("Score 56,54" if corrected else "Score 999,00"))])
    monkeypatch.setattr(agent, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    monkeypatch.setattr(agent, "_tool_result", lambda *args: {"score": 56.54})
    monkeypatch.setattr(agent, "validate", lambda *args, **kwargs: {"valid": True})
    monkeypatch.setattr(agent, "simulate", lambda *args, **kwargs: {"score": 56.54})
    monkeypatch.setattr(agent, "optimize", lambda **kwargs: [])
    monkeypatch.setattr(agent, "_finish", lambda result, *args: result)
    result = agent.run_agent("Хочу Score 999,00")
    assert create.call_count == 3
    assert "tools" not in create.call_args.kwargs
    assert result["source"] == ("ai" if corrected else "fallback")
    assert "999" not in result["explanation"]


@pytest.mark.parametrize("text,expected", [
    ("Score 56.54307", "Score 56,54"),
    ("Бюджет 88", "Бюджет 88,00"),
    ("Сдвиг −18", "Сдвиг -18,00"),
    ("Бюджет 1\u202f000,00", "Бюджет 1000,00"),
    ("M12 и T1: +5.0", "M12 и T1: +5,00"),
])
def test_normalize_supported_numbers(text, expected):
    assert explainer.normalize_text_numbers(text) == expected
