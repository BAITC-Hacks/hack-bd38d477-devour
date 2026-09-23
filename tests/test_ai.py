import json
from types import SimpleNamespace

import pytest

import ai.agent as agent_module
import ai.explainer as explainer_module
from engine import simulate, validate

CONTROL_SET = [
    {"measure_id": "M7", "district": "Нура"},
    {"measure_id": "M8", "district": "Нура"},
    {"measure_id": "M10", "district": "Нура"},
    {"measure_id": "M12", "district": None},
    {"measure_id": "M5", "district": "Сарыарка"},
]

INVALID_SET = [
    {"measure_id": "M1", "district": "Есиль"},
    {"measure_id": "M3", "district": "Нура"},
    {"measure_id": "M9", "district": "Нура"},
    {"measure_id": "M10", "district": "Нура"},
    {"measure_id": "M12", "district": None},
]

ANALYSIS = {
    "summary": "Score вырос с 52,56 до 56,54.",
    "strengths": ["Школы и детсады в Нуре выросли с 38,00 до 48,00."],
    "risks": ["Самый слабый район — Нура, 52,96."],
    "consequences": ["Остаток бюджета — 5,00."],
    "tradeoffs": ["Потрачено 95,00 из 100,00."],
    "recommendations": [],
}


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or None

    def model_dump(self, exclude_none=True):
        payload = {"role": "assistant", "content": self.content}
        if self.tool_calls:
            payload["tool_calls"] = [
                {"id": call.id, "type": "function", "function": {"name": call.function.name, "arguments": call.function.arguments}}
                for call in self.tool_calls
            ]
        return payload


def reply(content=None, tool_calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=FakeMessage(content, tool_calls))])


def tool_call(name, arguments, call_id):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(arguments, ensure_ascii=False)))


class FakeClient:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.script:
            raise AssertionError("Скрипт фальшивого клиента исчерпан")
        item = self.script.pop(0)
        if callable(item):
            item = item(kwargs)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")


def install(monkeypatch, module, script):
    client = FakeClient(script)
    monkeypatch.setattr(module, "OpenAI", lambda **kwargs: client)
    return client


def test_explainer_uses_fallback_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = install(monkeypatch, explainer_module, [])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "fallback"
    assert client.calls == []
    assert set(analysis) == set(explainer_module.ANALYSIS_KEYS)


def test_explainer_accepts_valid_answer(monkeypatch, with_key):
    client = install(monkeypatch, explainer_module, [reply(json.dumps(ANALYSIS, ensure_ascii=False))])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "ai"
    assert len(client.calls) == 1
    assert client.calls[0]["model"] == "test-model"
    assert client.calls[0]["response_format"] == {"type": "json_object"}
    assert analysis["summary"] == "Score вырос с 52,56 до 56,54."
    assert analysis["strengths"] == ["Школы и детсады в Нуре выросли с 38,00 до 48,00."]


def test_explainer_retries_after_invalid_json(monkeypatch, with_key):
    client = install(monkeypatch, explainer_module, [reply("это не json"), reply(json.dumps(ANALYSIS, ensure_ascii=False))])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "ai"
    assert len(client.calls) == 2
    retry_messages = client.calls[1]["messages"]
    assert retry_messages[-2]["role"] == "assistant"
    assert "не соответствует схеме" in retry_messages[-1]["content"]


def test_explainer_falls_back_after_two_invalid_answers(monkeypatch, with_key):
    client = install(monkeypatch, explainer_module, [reply("{"), reply(json.dumps({"summary": "нет остальных ключей"}))])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "fallback"
    assert len(client.calls) == 2
    assert analysis["summary"].startswith("Score вырос с 52,56 до 56,54")


def test_explainer_falls_back_when_only_fabricated_numbers_remain(monkeypatch, with_key):
    fabricated = {key: ([] if key != "summary" else "Score стал 5555,55.") for key in explainer_module.ANALYSIS_KEYS}
    fabricated["strengths"] = ["Бюджет вырос до 8888,88."]
    client = install(monkeypatch, explainer_module, [reply(json.dumps(fabricated, ensure_ascii=False)), reply(json.dumps(fabricated, ensure_ascii=False))])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "fallback"
    assert len(client.calls) == 2
    assert "неподтверждённые числа" in client.calls[1]["messages"][-1]["content"]


def test_explainer_drops_fabricated_sentence_but_keeps_answer(monkeypatch, with_key):
    mixed = dict(ANALYSIS)
    mixed["risks"] = ["Самый слабый район — Нура, 52,96.", "Через год Score будет 4444,44."]
    client = install(monkeypatch, explainer_module, [reply(json.dumps(mixed, ensure_ascii=False)), reply(json.dumps(mixed, ensure_ascii=False))])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "ai"
    assert len(client.calls) == 2
    assert analysis["risks"] == ["Самый слабый район — Нура, 52,96."]


def test_explainer_falls_back_on_provider_error(monkeypatch, with_key):
    client = install(monkeypatch, explainer_module, [RuntimeError("сеть недоступна")])
    analysis, source = explainer_module.explain_simulation(simulate(CONTROL_SET))
    assert source == "fallback"
    assert len(client.calls) == 1


def test_comparison_uses_summary_from_ai(monkeypatch, with_key):
    results = [{"name": "A", "simulation": simulate(CONTROL_SET)}]
    install(monkeypatch, explainer_module, [reply(json.dumps(ANALYSIS, ensure_ascii=False))])
    text, source = explainer_module.explain_comparison(results)
    assert source == "ai"
    assert text == ANALYSIS["summary"]


def final_answer(decisions, explanation):
    return reply(json.dumps({"decisions": decisions, "explanation": explanation}, ensure_ascii=False))


def test_agent_runs_tool_chain_and_returns_ai_plan(monkeypatch, with_key):
    script = [
        reply(tool_calls=[tool_call("list_measures", {}, "c1")]),
        reply(tool_calls=[tool_call("validate_plan", {"decisions": CONTROL_SET}, "c2"), tool_call("simulate_plan", {"decisions": CONTROL_SET}, "c3")]),
        final_answer(CONTROL_SET, "План проверен: Score 56,54 против базового 52,56."),
    ]
    client = install(monkeypatch, agent_module, script)
    result = agent_module.run_agent("подтянуть Нуру", None)
    assert result["source"] == "ai"
    assert result["decisions"] == CONTROL_SET
    assert result["simulation"]["score"] == pytest.approx(56.54307, abs=0.001)
    assert [step["action"] for step in result["steps"]] == ["validate", "validate", "simulate", "validate", "simulate"]
    assert "56,54" in result["explanation"]
    assert isinstance(result["optimizer_score"], float)
    assert len(client.calls) == 3
    tool_messages = [message for message in client.calls[2]["messages"] if message.get("role") == "tool"]
    assert [message["tool_call_id"] for message in tool_messages] == ["c1", "c2", "c3"]
    assert all("tools" in call for call in client.calls)


def test_agent_stops_at_tool_limit_and_asks_for_final_answer(monkeypatch, with_key):
    def scripted(kwargs):
        if "tools" in kwargs:
            index = sum(1 for call in client.calls if "tools" in call)
            return reply(tool_calls=[
                tool_call("validate_plan", {"decisions": CONTROL_SET}, f"v{index}"),
                tool_call("simulate_plan", {"decisions": CONTROL_SET}, f"s{index}"),
            ])
        return final_answer(CONTROL_SET, "Лучший проверенный план даёт Score 56,54.")

    client = install(monkeypatch, agent_module, [scripted] * 6)
    result = agent_module.run_agent(None, None)
    assert result["source"] == "ai"
    tool_rounds = [call for call in client.calls if "tools" in call]
    final_calls = [call for call in client.calls if "tools" not in call]
    assert len(tool_rounds) == 4
    assert len(final_calls) == 1
    assert "Лимит инструментов исчерпан" in final_calls[0]["messages"][-1]["content"]
    executed = [message for message in final_calls[0]["messages"] if message.get("role") == "tool"]
    assert len(executed) == 8
    assert sum(1 for step in result["steps"] if step["action"] == "simulate") == 5


def test_agent_replaces_invalid_final_set_with_best_checked_plan(monkeypatch, with_key):
    script = [
        reply(tool_calls=[tool_call("simulate_plan", {"decisions": CONTROL_SET}, "c1")]),
        final_answer(INVALID_SET, "Предлагаю этот набор."),
    ]
    client = install(monkeypatch, agent_module, script)
    result = agent_module.run_agent("максимальный Score", None)
    assert result["source"] == "fallback"
    assert result["decisions"] == CONTROL_SET
    assert validate(result["decisions"])["valid"] is True
    assert result["explanation"].startswith("Лучший валидный проверенный план")
    assert result["steps"][-2]["action"] == "validate"
    assert "невалиден" in result["steps"][-2]["summary"]
    assert len(client.calls) == 2


def test_agent_falls_back_to_optimizer_on_provider_error(monkeypatch, with_key):
    client = install(monkeypatch, agent_module, [RuntimeError("provider down")])
    result = agent_module.run_agent("экология Сарыарки", "EV5")
    assert result["source"] == "fallback"
    check = validate(result["decisions"], event_id="EV5")
    assert check["valid"] is True
    assert check["total_cost"] <= 85
    assert result["simulation"]["event"]["id"] == "EV5"
    assert [step["action"] for step in result["steps"]] == ["validate", "simulate"]
    assert len(client.calls) == 1


def test_agent_retries_explanation_with_fabricated_numbers(monkeypatch, with_key):
    script = [
        reply(tool_calls=[tool_call("simulate_plan", {"decisions": CONTROL_SET}, "c1")]),
        final_answer(CONTROL_SET, "Score станет 88,88."),
        final_answer(CONTROL_SET, "Score станет 56,54."),
    ]
    client = install(monkeypatch, agent_module, script)
    result = agent_module.run_agent(None, None)
    assert result["source"] == "ai"
    assert "56,54" in result["explanation"]
    assert "88,88" not in result["explanation"]
    assert "tools" not in client.calls[2]
    assert "нет в результатах инструментов" in client.calls[2]["messages"][-1]["content"]


def test_agent_uses_fallback_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = install(monkeypatch, agent_module, [])
    result = agent_module.run_agent("подтянуть Нуру", None)
    assert result["source"] == "fallback"
    assert client.calls == []
    assert validate(result["decisions"])["valid"] is True
