"""Use Gemini only to choose among distinct, terrain-checked planner results."""
import json
import os
from collections import OrderedDict, deque
from threading import Lock
from time import monotonic

import httpx
from fastapi import HTTPException

from .assistant import reserve_gemini_request

cache = OrderedDict()
in_progress = set()
requests = deque()
lock = Lock()


async def review_routes(comparison):
    candidates = []
    paths = set()
    for route in comparison.routes:
        path = tuple((sample.point.lat, sample.point.lon) for sample in route.profile)
        if path not in paths:
            paths.add(path)
            candidates.append(route)
    options = [route.strategy for route in candidates]
    if len(options) < 2:
        return {"options": options, "recommended": options[0] if options else None, "used_api": False}

    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "The navigation API is not configured. Try Find routes with AI again when the service is available.")

    metrics = [
        {"strategy": r.strategy, "distance_m": r.distance_m, "ascent_m": r.ascent_m,
         "descent_m": r.descent_m, "peak_grade_deg": r.max_segment_grade_deg, "terrain": r.terrain_id}
        for r in candidates
    ]
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    cache_key = (model, json.dumps(metrics, sort_keys=True))
    with lock:
        if cache_key in cache:
            cache.move_to_end(cache_key)
            return cache[cache_key]
        now = monotonic()
        while requests and requests[0] <= now - 60:
            requests.popleft()
        if cache_key in in_progress or len(requests) >= 2:
            raise HTTPException(429, "API route review is busy. Try again in a minute.")
        reserve_gemini_request()
        requests.append(now)
        in_progress.add(cache_key)

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json={
                    "contents": [{"parts": [{"text": (
                        "Rank all supplied Mars terrain paths for a simulated walking traverse. Prefer lower peak grade, "
                        "then lower total climbing, then shorter distance. Return all strategy IDs in preference order. "
                        + json.dumps(metrics, separators=(",", ":"))
                    )}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseJsonSchema": {"type": "array", "items": {"type": "string", "enum": options}},
                        "maxOutputTokens": 80,
                        "thinkingConfig": {"thinkingLevel": "minimal"},
                    },
                },
            )
        if response.status_code == 429:
            raise HTTPException(429, "Gemini's usage limit was reached. Try Find routes with AI again when the service is available.")
        response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        ranked = json.loads("".join(part.get("text", "") for part in parts if not part.get("thought")))
        if not isinstance(ranked, list) or len(ranked) != len(options) or set(ranked) != set(options):
            raise ValueError("Expected each strategy exactly once")
        result = {"options": ranked, "recommended": ranked[0], "used_api": True}
        with lock:
            cache[cache_key] = result
            if len(cache) > 128:
                cache.popitem(last=False)
        return result
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "API route review is unavailable. Try Find routes with AI again when the service is available.") from None
    finally:
        with lock:
            in_progress.discard(cache_key)
