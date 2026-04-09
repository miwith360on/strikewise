import logging
import math
import os
import sqlite3
import threading
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI
from sklearn.cluster import DBSCAN
from sklearn.linear_model import LinearRegression

APP_DIR = os.path.dirname(__file__)
DB_PATH = os.getenv("ML_DB_PATH", os.path.join(APP_DIR, "strikewise_ml.db"))
LIGHTNING_API_URL = os.getenv("LIGHTNING_API_URL", "http://localhost:3000/api/lightning?minutes=30")
POLL_INTERVAL_SECONDS = int(os.getenv("ML_POLL_INTERVAL_SECONDS", "60"))
PREDICTION_MINUTES = int(os.getenv("ML_PREDICTION_MINUTES", "15"))
CLUSTER_WINDOW_MINUTES = int(os.getenv("ML_CLUSTER_WINDOW_MINUTES", "45"))
DBSCAN_EPS_KM = float(os.getenv("ML_DBSCAN_EPS_KM", "20"))
MIN_CLUSTER_POINTS = int(os.getenv("ML_MIN_CLUSTER_POINTS", "4"))
MIN_BUCKETS_FOR_PREDICTION = int(os.getenv("ML_MIN_BUCKETS_FOR_PREDICTION", "3"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("ML_REQUEST_TIMEOUT_SECONDS", "20"))

logger = logging.getLogger("strikewise-ml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def utc_now_iso(timestamp_ms: int | None) -> str | None:
    if timestamp_ms is None:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat()


def now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db() -> None:
    with closing(get_connection()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS strike_samples (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              strike_id TEXT,
              lat REAL NOT NULL,
              lng REAL NOT NULL,
              strike_timestamp INTEGER NOT NULL,
              intensity REAL NOT NULL,
              polarity TEXT NOT NULL,
              ingested_at INTEGER NOT NULL,
              UNIQUE(strike_id, strike_timestamp, lat, lng)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_strike_timestamp ON strike_samples(strike_timestamp)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_ingested_at ON strike_samples(ingested_at)"
        )
        connection.commit()


def fetch_lightning_payload() -> dict[str, Any]:
    response = requests.get(LIGHTNING_API_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or "strikes" not in payload:
        raise ValueError("Lightning API response did not include a strikes array")
    return payload


def save_strikes(payload: dict[str, Any]) -> dict[str, Any]:
    strikes = payload.get("strikes", [])
    ingested_at = now_ms()
    inserted = 0

    with closing(get_connection()) as connection:
        for strike in strikes:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO strike_samples (
                  strike_id,
                  lat,
                  lng,
                  strike_timestamp,
                  intensity,
                  polarity,
                  ingested_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                  strike.get("id"),
                  float(strike["lat"]),
                  float(strike["lng"]),
                  int(strike["timestamp"]),
                  float(strike.get("intensityKa", 0)),
                  str(strike.get("polarity", "negative")),
                  ingested_at,
                ),
            )
            inserted += cursor.rowcount

        connection.commit()

    return {
      "inserted": inserted,
      "received": len(strikes),
      "generatedAt": payload.get("generatedAt"),
      "provider": payload.get("provider"),
      "ingestedAt": ingested_at,
    }


def polling_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            payload = fetch_lightning_payload()
            result = save_strikes(payload)
            logger.info(
                "Saved %s/%s strikes from %s",
                result["inserted"],
                result["received"],
                result["provider"],
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("Lightning ingestion failed: %s", error)

        stop_event.wait(POLL_INTERVAL_SECONDS)


def load_recent_samples(window_minutes: int) -> list[sqlite3.Row]:
    cutoff_ms = now_ms() - window_minutes * 60 * 1000
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """
            SELECT strike_id, lat, lng, strike_timestamp, intensity, polarity, ingested_at
            FROM strike_samples
            WHERE strike_timestamp >= ?
            ORDER BY strike_timestamp ASC
            """,
            (cutoff_ms,),
        ).fetchall()
    return rows


def kilometers_coordinates(rows: list[sqlite3.Row]) -> tuple[np.ndarray, float, float]:
    latitudes = np.array([row["lat"] for row in rows], dtype=float)
    longitudes = np.array([row["lng"] for row in rows], dtype=float)
    origin_lat = float(latitudes.mean())
    origin_lng = float(longitudes.mean())
    lat_scale = 110.57
    lng_scale = 111.32 * max(0.2, math.cos(math.radians(origin_lat)))

    coordinates = np.column_stack(
        (
            (longitudes - origin_lng) * lng_scale,
            (latitudes - origin_lat) * lat_scale,
        )
    )
    return coordinates, origin_lat, origin_lng


def km_to_lat(km: float) -> float:
    return km / 110.57


def km_to_lng(km: float, latitude: float) -> float:
    return km / (111.32 * max(0.2, math.cos(math.radians(latitude))))


def fit_cluster_prediction(rows: list[sqlite3.Row]) -> dict[str, Any]:
    if len(rows) < MIN_CLUSTER_POINTS:
        return {
            "ready": False,
            "reason": "Not enough strike samples yet",
            "samples": len(rows),
            "requiredSamples": MIN_CLUSTER_POINTS,
        }

    coordinates, _, _ = kilometers_coordinates(rows)
    labels = DBSCAN(eps=DBSCAN_EPS_KM, min_samples=MIN_CLUSTER_POINTS).fit_predict(coordinates)
    valid_labels = [label for label in set(labels.tolist()) if label != -1]

    if not valid_labels:
        return {
            "ready": False,
            "reason": "No stable strike cluster found yet",
            "samples": len(rows),
        }

    dominant_label = max(valid_labels, key=lambda label: int(np.sum(labels == label)))
    cluster_rows = [row for row, label in zip(rows, labels.tolist(), strict=True) if label == dominant_label]

    bucket_map: dict[int, list[sqlite3.Row]] = {}
    for row in cluster_rows:
      bucket = int(row["strike_timestamp"]) // 60000
      bucket_map.setdefault(bucket, []).append(row)

    bucket_times = sorted(bucket_map)
    if len(bucket_times) < MIN_BUCKETS_FOR_PREDICTION:
        return {
            "ready": False,
            "reason": "Need more time buckets to estimate storm movement",
            "samples": len(rows),
            "clusterSamples": len(cluster_rows),
            "timeBuckets": len(bucket_times),
            "requiredBuckets": MIN_BUCKETS_FOR_PREDICTION,
        }

    centroid_times: list[float] = []
    centroid_lats: list[float] = []
    centroid_lngs: list[float] = []

    for bucket in bucket_times:
        samples = bucket_map[bucket]
        centroid_times.append(float(bucket))
        centroid_lats.append(sum(float(row["lat"]) for row in samples) / len(samples))
        centroid_lngs.append(sum(float(row["lng"]) for row in samples) / len(samples))

    first_bucket = centroid_times[0]
    feature_matrix = np.array([[bucket - first_bucket] for bucket in centroid_times], dtype=float)
    lat_model = LinearRegression().fit(feature_matrix, np.array(centroid_lats, dtype=float))
    lng_model = LinearRegression().fit(feature_matrix, np.array(centroid_lngs, dtype=float))

    prediction_time = centroid_times[-1] + PREDICTION_MINUTES
    prediction_input = np.array([[prediction_time - first_bucket]], dtype=float)
    predicted_lat = float(lat_model.predict(prediction_input)[0])
    predicted_lng = float(lng_model.predict(prediction_input)[0])

    latest_cluster_coordinates, _, _ = kilometers_coordinates(cluster_rows)
    cluster_spread_km = max(5.0, float(np.max(np.std(latest_cluster_coordinates, axis=0))))

    lat_residuals = lat_model.predict(feature_matrix) - np.array(centroid_lats, dtype=float)
    lng_residuals = lng_model.predict(feature_matrix) - np.array(centroid_lngs, dtype=float)
    residual_km = max(
        2.0,
        math.sqrt(float(np.mean(lat_residuals ** 2))) * 110.57,
        math.sqrt(float(np.mean(lng_residuals ** 2))) * 85.0,
    )
    radius_km = max(8.0, cluster_spread_km * 2.2 + residual_km)

    bbox = {
        "north": predicted_lat + km_to_lat(radius_km),
        "south": predicted_lat - km_to_lat(radius_km),
        "east": predicted_lng + km_to_lng(radius_km, predicted_lat),
        "west": predicted_lng - km_to_lng(radius_km, predicted_lat),
    }

    confidence = max(
        0.2,
        min(
            0.95,
            0.45
            + min(0.25, len(cluster_rows) / 120)
            + min(0.15, len(bucket_times) / 20)
            - min(0.2, residual_km / 40),
        ),
    )

    return {
        "ready": True,
        "predictionMinutes": PREDICTION_MINUTES,
        "samples": len(rows),
        "clusterSamples": len(cluster_rows),
        "timeBuckets": len(bucket_times),
        "clusterLabel": int(dominant_label),
        "predictedCenter": {
            "lat": predicted_lat,
            "lng": predicted_lng,
        },
        "predictedBoundingBox": bbox,
        "radiusKm": round(radius_km, 2),
        "confidence": round(confidence, 3),
        "latestObservedAt": utc_now_iso(int(cluster_rows[-1]["strike_timestamp"])),
        "predictedFor": utc_now_iso(int(cluster_rows[-1]["strike_timestamp"]) + PREDICTION_MINUTES * 60 * 1000),
    }


def get_status() -> dict[str, Any]:
    with closing(get_connection()) as connection:
        summary = connection.execute(
            """
            SELECT
              COUNT(*) AS total_rows,
              COUNT(DISTINCT COALESCE(strike_id, id)) AS distinct_strikes,
              MAX(ingested_at) AS last_ingested_at,
              MAX(strike_timestamp) AS latest_strike_timestamp,
              MIN(strike_timestamp) AS earliest_strike_timestamp
            FROM strike_samples
            """
        ).fetchone()

    return {
        "lightningApiUrl": LIGHTNING_API_URL,
        "dbPath": DB_PATH,
        "pollIntervalSeconds": POLL_INTERVAL_SECONDS,
        "predictionMinutes": PREDICTION_MINUTES,
        "totalRows": int(summary["total_rows"] or 0),
        "distinctStrikes": int(summary["distinct_strikes"] or 0),
        "lastIngestedAt": utc_now_iso(summary["last_ingested_at"]),
        "latestStrikeAt": utc_now_iso(summary["latest_strike_timestamp"]),
        "earliestStrikeAt": utc_now_iso(summary["earliest_strike_timestamp"]),
    }


poller_stop_event = threading.Event()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_db()
    polling_thread = threading.Thread(target=polling_loop, args=(poller_stop_event,), daemon=True)
    polling_thread.start()
    try:
        yield
    finally:
        poller_stop_event.set()
        polling_thread.join(timeout=2)


app = FastAPI(title="Strikewise ML", version="0.1.0", lifespan=lifespan)


@app.get("/ml/status")
def ml_status() -> dict[str, Any]:
    return get_status()


@app.get("/ml/predict")
def ml_predict() -> dict[str, Any]:
    rows = load_recent_samples(CLUSTER_WINDOW_MINUTES)
    prediction = fit_cluster_prediction(rows)
    return {
        "windowMinutes": CLUSTER_WINDOW_MINUTES,
        **prediction,
    }