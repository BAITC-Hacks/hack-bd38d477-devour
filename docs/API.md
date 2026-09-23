# API для экспертов

Сервис запускается командой `uvicorn api.main:app --reload`; ниже для примеров используется `http://localhost:8000`. В примерах приведены сокращённые фрагменты реальных ответов. Ответы с `source="fallback"` проверены на отдельном живом экземпляре без `OPENAI_API_KEY`; ответы с `source="ai"` проверены на основном живом сервере.

Для районных мер (`type: "R"`) указывайте район. Для городских (`type: "C"`) передавайте `district: null`. Контрольный план в примерах стоит 95 из бюджета 100:

```json
[
  {"measure_id":"M7","district":"Нура"},
  {"measure_id":"M8","district":"Нура"},
  {"measure_id":"M10","district":"Нура"},
  {"measure_id":"M12","district":null},
  {"measure_id":"M5","district":"Сарыарка"}
]
```

## `GET /api/state`

Возвращает бюджет, районы с базовыми оценками и показателями, мероприятия, веса показателей и базовый Score.

Тело запроса: нет.

```bash
curl http://localhost:8000/api/state
```

Фрагмент реального ответа:

```json
{"budget":100,"districts":[{"name":"Есиль","population":0.27,"base_score":62.99}],"weights":{"T1":0.1,"T2":0.1,"E1":0.09,"E2":0.11,"S1":0.11,"S2":0.11,"B1":0.09,"B2":0.09,"C1":0.1,"C2":0.1},"base_score":52.56}
```

## `POST /api/validate`

Проверяет план и возвращает валидность, ошибки, стоимость и остаток бюджета. Не запускает симуляцию.

Тело запроса: `decisions` — массив решений; необязательный `event_id` — идентификатор события.

```bash
curl -X POST http://localhost:8000/api/validate \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[{"measure_id":"M7","district":"Нура"},{"measure_id":"M8","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M12","district":null},{"measure_id":"M5","district":"Сарыарка"}]}'
```

Фрагмент реального ответа:

```json
{"valid":true,"errors":[],"total_cost":95,"budget":100,"budget_left":5}
```

## `POST /api/simulate`

Проверяет план и возвращает расчёт Score, районных оценок, критических показателей, вкладов и синергий. Невалидный план получает HTTP 422.

Тело запроса: как у `/api/validate`; `event_id` необязателен.

```bash
curl -X POST http://localhost:8000/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[{"measure_id":"M7","district":"Нура"},{"measure_id":"M8","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M12","district":null},{"measure_id":"M5","district":"Сарыарка"}]}'
```

Фрагмент реального ответа:

```json
{"total_cost":95,"budget_left":5,"base_score":52.56,"score":56.54,"delta":3.98,"min_district":{"name":"Нура","score":52.96},"n_crit":0}
```

## `POST /api/explain`

Возвращает симуляцию и текстовый анализ: вывод, сильные стороны, риски, последствия, компромиссы и рекомендации по заменам.

Тело запроса: как у `/api/validate`; `event_id` необязателен.

```bash
curl -X POST http://localhost:8000/api/explain \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[{"measure_id":"M8","district":"Нура"},{"measure_id":"M9","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M13","district":"Алматы"},{"measure_id":"M14","district":null}],"event_id":"EV1"}'
```

Фрагмент реального ответа без ключа:

```json
{"simulation":{"total_cost":86,"budget":88,"budget_left":2,"base_score":51.12,"score":56.09,"delta":4.97},"analysis":{"summary":"Score вырос с 51,12 до 56,09. На меры направлено 86,00, остаток бюджета — 2,00.","recommendations":[]},"source":"fallback"}
```

## `POST /api/compare`

Симулирует и сравнивает несколько сценариев. Каждому сценарию задаются имя, решения и необязательное событие.

Тело запроса:

```json
{"scenarios":[{"name":"Контрольный","decisions":[{"measure_id":"M7","district":"Нура"},{"measure_id":"M8","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M12","district":null},{"measure_id":"M5","district":"Сарыарка"}],"event_id":null}]}
```

```bash
curl -X POST http://localhost:8000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"scenarios":[{"name":"Контрольный","decisions":[{"measure_id":"M7","district":"Нура"},{"measure_id":"M8","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M12","district":null},{"measure_id":"M5","district":"Сарыарка"}]}]}'
```

Фрагмент реального ответа без ключа:

```json
{"results":[{"name":"Контрольный","simulation":{"base_score":52.56,"score":56.54,"delta":3.98}}],"analysis":"Лучшая итоговая оценка у сценария «Контрольный»: 56,54.","source":"fallback"}
```

## `GET /api/optimize`

Возвращает лучшие найденные валидные планы. `top` задаёт число результатов (проверены значения от 1 до 100); необязательный `event_id` учитывает событие.

Тело запроса: нет.

```bash
curl 'http://localhost:8000/api/optimize?top=1&event_id=EV1'
```

Фрагмент реального ответа:

```json
[{"decisions":[{"measure_id":"M8","district":"Нура"},{"measure_id":"M9","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M13","district":"Алматы"},{"measure_id":"M14","district":null}],"score":56.09,"total_cost":86}]
```

## `GET /api/events`

Возвращает список событий с идентификаторами, описаниями, затронутыми районами, эффектами и штрафом бюджета.

Тело запроса: нет.

```bash
curl http://localhost:8000/api/events
```

Фрагмент реального ответа:

```json
[{"id":"EV1","name":"Прорыв теплосети","district":"Алматы","effects":{"C1":-18,"C2":-8},"budget_penalty":12},{"id":"EV2","name":"Смоговый эпизод","district":"Сарыарка","effects":{"E2":-12},"budget_penalty":8}]
```

## `POST /api/agent`

Подбирает план под цель. Возвращает решения, симуляцию, шаги проверки и симуляции, объяснение, `source` и Score оптимизатора для сравнения.

Тело запроса: `goal` — строка или `null`; необязательный `event_id` — идентификатор события.

```bash
curl -X POST http://localhost:8000/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"goal":"подтянуть Нуру, не уронив общий Score","event_id":"EV1"}'
```

Фрагмент реального ответа без ключа:

```json
{"decisions":[{"measure_id":"M8","district":"Нура"},{"measure_id":"M9","district":"Нура"},{"measure_id":"M10","district":"Нура"},{"measure_id":"M13","district":"Алматы"},{"measure_id":"M14","district":null}],"simulation":{"base_score":51.12,"score":56.09,"delta":4.97},"steps":[{"action":"validate","summary":"План валиден. Стоимость 86,00, доступно 88,00, остаток 2,00."}],"explanation":"Score вырос с 51,12 до 56,09.","source":"fallback","optimizer_score":56.09}
```

## Передача `event_id`

`event_id` необязателен: без него расчёт выполняется без события. Для `/api/validate`, `/api/simulate` и `/api/explain` он передаётся рядом с `decisions`; в `/api/compare` — отдельно в каждом объекте сценария; в `/api/agent` — рядом с `goal`; в `/api/optimize` — параметром URL. Проверенные идентификаторы: `EV1`–`EV5` из `/api/events`. Например, EV1 уменьшает доступный бюджет с 100 до 88 и в Алматы меняет C1 на −18 и C2 на −8.

## `source="ai"` и `source="fallback"`

`source="ai"` означает, что текст анализа сформирован через OpenAI; `source="fallback"` — что использован шаблонный анализ из результата движка. Для explain и compare ответы обоих типов проверены на живом сервере: AI на основном сервере и fallback на отдельном экземпляре без ключа. Для agent проверены AI и fallback ответы. Числовые оценки рассчитывает движок в обоих режимах.

## Ошибки

HTTP 422 возвращается, если план не проходит валидацию, передано неизвестное событие или параметр `top` вне диапазона 1–100. Проверенный пример невалидного плана для `/api/simulate`:

```bash
curl -i -X POST http://localhost:8000/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{"decisions":[]}'
```

```http
HTTP/1.1 422 Unprocessable Content
```

```json
{"detail":{"valid":false,"errors":["Нужно выбрать ровно 5 мер, сейчас выбрано 0"]}}
```

Неизвестное событие тоже даёт HTTP 422, например для `/api/validate`:

```json
{"detail":"Неизвестное событие «EV_UNKNOWN». Доступные события: EV1, EV2, EV3, EV4, EV5"}
```

В `/api/compare` ошибка валидации сценария также возвращает HTTP 422 и включает его имя в поле `scenario`.
