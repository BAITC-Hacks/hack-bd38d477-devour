import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.responses import FileResponse

from engine import load_data, validate, simulate, optimize
from ai.advisor import recommendations
from ai.explainer import explain_simulation, explain_comparison

load_dotenv()

app = FastAPI()
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


class DecisionsRequest(BaseModel):
    decisions: list[dict]


class Scenario(BaseModel):
    name: str
    decisions: list[dict]


class CompareRequest(BaseModel):
    scenarios: list[Scenario]


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/state")
def state():
    data = load_data()
    base = simulate([])
    return {"budget": data.get("budget", 100), "districts": data.get("districts", []), "measures": data.get("measures", []), "weights": data.get("weights", {}), "base_score": base.get("score", base.get("base_score"))}


@app.post("/api/validate")
def validate_decisions(request: DecisionsRequest):
    return validate(request.decisions)


@app.post("/api/simulate")
def run_simulation(request: DecisionsRequest):
    result = validate(request.decisions)
    if not result.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": result.get("errors", [])})
    return simulate(request.decisions)


@app.post("/api/explain")
def explain(request: DecisionsRequest):
    validation = validate(request.decisions)
    if not validation.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", [])})
    simulation = simulate(request.decisions)
    analysis, source = explain_simulation(simulation)
    analysis["recommendations"] = recommendations(request.decisions, simulation)
    return {"simulation": simulation, "analysis": analysis, "source": source}


@app.post("/api/compare")
def compare(request: CompareRequest):
    results = []
    for scenario in request.scenarios:
        validation = validate(scenario.decisions)
        if not validation.get("valid"):
            raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", []), "scenario": scenario.name})
        results.append({"name": scenario.name, "simulation": simulate(scenario.decisions)})
    analysis, source = explain_comparison(results)
    return {"results": results, "analysis": analysis, "source": source}


@app.get("/api/optimize")
def run_optimizer(top: int = 5):
    if top < 1 or top > 100:
        raise HTTPException(status_code=422, detail="Параметр top должен быть от 1 до 100")
    return optimize(top=top)


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
