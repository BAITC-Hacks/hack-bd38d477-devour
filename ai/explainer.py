import json
import os

from openai import OpenAI

ANALYSIS_KEYS = ("summary", "strengths", "risks", "consequences", "tradeoffs", "recommendations")
SYSTEM_PROMPT = "Ты аналитик городского управления. Используй только числа из входных данных, ничего не придумывай. Простым языком на русском объясни компромиссы. Верни только JSON-объект со строковыми полями summary и массивами строк strengths, risks, consequences, tradeoffs, recommendations."


def _valid_analysis(value):
    return isinstance(value, dict) and set(value) == set(ANALYSIS_KEYS) and isinstance(value.get("summary"), str) and all(isinstance(value.get(key), list) and all(isinstance(item, str) for item in value[key]) for key in ANALYSIS_KEYS[1:])


def fallback_analysis(simulation):
    score = simulation.get("score")
    delta = simulation.get("delta")
    weakest = simulation.get("min_district", {}) or {}
    district = weakest.get("name", "")
    weaknesses = simulation.get("critical", []) or []
    critical_count = simulation.get("n_crit", len(weaknesses))
    summary = "Оценка сценария рассчитана движком."
    if isinstance(score, (int, float)):
        summary = f"Итоговая оценка — {score:.2f}."
    if isinstance(delta, (int, float)):
        summary += f" Изменение относительно базового сценария — {delta:+.2f}."
    strengths = [f"Сценарий улучшает итоговую оценку на {delta:.2f}." ] if isinstance(delta, (int, float)) and delta > 0 else []
    risks = [f"Самая низкая оценка у района «{district}»." ] if district else []
    if critical_count:
        risks.append(f"После мер критическими остаются {critical_count} показателя в районах.")
    consequences = []
    for contribution in (simulation.get("contributions", []) or [])[:3]:
        mid = contribution.get("measure_id")
        gain = contribution.get("delta_score")
        if mid and isinstance(gain, (int, float)):
            consequences.append(f"Без меры {mid} оценка была бы ниже на {gain:.2f}.")
    return {"summary": summary, "strengths": strengths, "risks": risks, "consequences": consequences, "tradeoffs": [], "recommendations": []}


def _request_analysis(payload):
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    for attempt in range(2):
        response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, response_format={"type": "json_object"})
        content = response.choices[0].message.content or ""
        try:
            result = json.loads(content)
        except (TypeError, json.JSONDecodeError):
            result = None
        if _valid_analysis(result):
            return result
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": "Ответ не соответствует схеме. Повтори один раз: только JSON с точными ключами и типами из системного сообщения."})
    return None


def explain_simulation(simulation):
    if not os.environ.get("OPENAI_API_KEY"):
        return fallback_analysis(simulation), "fallback"
    try:
        result = _request_analysis(simulation)
    except Exception:
        result = None
    return (result, "ai") if result else (fallback_analysis(simulation), "fallback")


def explain_comparison(results):
    if not os.environ.get("OPENAI_API_KEY"):
        return _fallback_comparison(results), "fallback"
    try:
        result = _request_analysis({"results": results})
    except Exception:
        result = None
    return (result["summary"], "ai") if result else (_fallback_comparison(results), "fallback")


def _fallback_comparison(results):
    scored = [(row.get("name", "Сценарий"), (row.get("simulation") or {}).get("score")) for row in results]
    scored = [(name, score) for name, score in scored if isinstance(score, (int, float))]
    if not scored:
        return "Сравнение рассчитано движком."
    best = max(scored, key=lambda item: item[1])
    return f"Лучшая итоговая оценка у сценария «{best[0]}»: {best[1]:.2f}. Сравнивайте также распределение оценок по районам и критические показатели."
