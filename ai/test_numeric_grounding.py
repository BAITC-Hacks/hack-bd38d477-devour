import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ai import agent, explainer


@pytest.mark.parametrize("text,inputs,expected", [
    ("Score 999,00", {"score": 56.54}, False),
    ("Score 56,54", {"score": 56.54307}, True),
    ("Score 56,55", {"score": 56.54307}, True),
    ("Score 56,56", {"score": 56.54307}, False),
    ("Прирост 3,98", {"score": 56.54, "base_score": 52.56}, True),
    ("Сумма 109,10", {"score": 56.54, "base_score": 52.56}, True),
    ("Бюджет 88,00", {"budget": 88}, True),
    ("Сдвиг −18,00", {"effects": {"C1": -18}}, True),
    ("Разница 18,00", {"before": 10, "after": -8}, True),
    ("Сдвиг 18,00", {"effects": {"C1": -18}}, True),
    ("Бюджет 1 000,00", {"budget": 1000}, True),
    ("Score 9.99e2", {"score": 56.54}, False),
    ("Score 1e999", {"score": 56.54}, False),
    ("Выбрано 5 мер за 8 кварталов", {}, True),
    ("Выбрано 11 мер", {}, False),
    ("Доля населения 27,00%", {"districts": [{"population": 0.27}]}, True),
    ("Доля населения 26,00%", {"districts": [{"population": 0.27}]}, False),
    ("M7 и S1 в EV1", {}, True),
])
def test_numeric_grounding(text, inputs, expected):
    assert explainer.numbers_supported(text, inputs) is expected


def analysis(summary, strengths=None):
    return {key: summary if key == "summary" else (strengths or []) if key == "strengths" else [] for key in explainer.ANALYSIS_KEYS}


def response(content, calls=None):
    message = SimpleNamespace(content=content, tool_calls=calls)
    message.model_dump = lambda **kwargs: {"role": "assistant", "content": content, "tool_calls": []}
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def test_explainer_retries_and_keeps_supported_sentences(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    content = json.dumps(analysis("Score вырос с 52,56 до 56,54. Выдуманное значение 999,00."))
    create = Mock(side_effect=[response(content), response(content)])
    monkeypatch.setattr(explainer, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result, source = explainer.explain_simulation({"score": 56.54, "base_score": 52.56})
    assert create.call_count == 2
    assert source == "ai"
    assert result["summary"] == "Score вырос с 52,56 до 56,54."


def test_explainer_falls_back_when_cleaned_text_is_empty(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    content = json.dumps(analysis("Неподтверждённое значение 999,00."))
    create = Mock(side_effect=[response(content), response(content)])
    monkeypatch.setattr(explainer, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result, source = explainer.explain_simulation({"score": 56.54})
    assert create.call_count == 2
    assert source == "fallback"
    assert "999" not in json.dumps(result)


def test_explainer_allows_derived_numbers(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    content = json.dumps(analysis("Score 52,56 + 56,54 = 109,10; прирост 3,98."))
    create = Mock(return_value=response(content))
    monkeypatch.setattr(explainer, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result, source = explainer.explain_simulation({"score": 56.54, "base_score": 52.56})
    assert create.call_count == 1
    assert source == "ai"
    assert result["summary"] == "Score 52,56 + 56,54 = 109,10; прирост 3,98."


def test_explainer_removes_only_unsupported_sentence_after_retry(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    content = json.dumps(analysis("Score вырос с 52,56 до 56,54. Прогноз 999,00."))
    create = Mock(side_effect=[response(content), response(content)])
    monkeypatch.setattr(explainer, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result, source = explainer.explain_simulation({"score": 56.54, "base_score": 52.56})
    assert source == "ai"
    assert "52,56 до 56,54" in result["summary"]
    assert "999" not in result["summary"]


def test_agent_sends_rounded_tool_results(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    validate_call = SimpleNamespace(id="tool-validate", function=SimpleNamespace(name="validate_plan", arguments='{"decisions": []}'))
    simulate_call = SimpleNamespace(id="tool-simulate", function=SimpleNamespace(name="simulate_plan", arguments='{"decisions": []}'))
    final = json.dumps({"decisions": [], "explanation": "Score 56.54307."})
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return response(None, [validate_call, simulate_call])
        return response(final)

    monkeypatch.setattr(agent, "OpenAI", lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    monkeypatch.setattr(agent, "_tool_result", lambda name, *args: {"valid": True, "score": 56.54307, "base_score": 52.55768, "delta": 3.98539})
    monkeypatch.setattr(agent, "validate", lambda *args, **kwargs: {"valid": True})
    monkeypatch.setattr(agent, "simulate", lambda *args, **kwargs: {"score": 56.54307, "base_score": 52.55768, "delta": 3.98539})
    monkeypatch.setattr(agent, "_finish", lambda result, *args, **kwargs: result)
    result = agent.run_agent("Проверь план")
    tool_messages = [message for message in calls[1]["messages"] if message["role"] == "tool"]
    assert json.loads(tool_messages[0]["content"]) == {"valid": True, "score": 56.54, "base_score": 52.56, "delta": 3.98}
    assert json.loads(tool_messages[1]["content"]) == {"valid": True, "score": 56.54, "base_score": 52.56, "delta": 3.98}
    assert result["explanation"] == "Score 56,54."


@pytest.mark.parametrize("text,expected", [
    ("Score 56.54307", "Score 56,54"),
    ("Бюджет 88", "Бюджет 88,00"),
    ("Сдвиг −18", "Сдвиг -18,00"),
    ("Бюджет 1 000,00", "Бюджет 1000,00"),
    ("M12 и T1: +5.0", "M12 и T1: +5,00"),
])
def test_normalize_supported_numbers(text, expected):
    assert explainer.normalize_text_numbers(text) == expected
