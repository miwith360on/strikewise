import logging
import math
import os
import pickle
import sqlite3
import threading
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI
from sklearn.calibration import CalibratedClassifierCV
from sklearn.cluster import DBSCAN
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LinearRegression
from sklearn.metrics import roc_auc_score

APP_DIR = os.path.dirname(__file__)
DB_PATH = os.getenv("ML_DB_PATH", os.path.join(APP_DIR, "strikewise_ml.db"))
LIGHTNING_API_URL = os.getenv("LIGHTNING_API_URL", "http://localhost:3000/api/lightning?minutes=30")
POLL_MIN_SECONDS = int(os.getenv("ML_POLL_MIN_SECONDS", "30"))
POLL_MAX_SECONDS = int(os.getenv("ML_POLL_MAX_SECONDS", "300"))
PREDICTION_MINUTES = int(os.getenv("ML_PREDICTION_MINUTES", "15"))
CLUSTER_WINDOW_MINUTES = int(os.getenv("ML_CLUSTER_WINDOW_MINUTES", "45"))
DBSCAN_EPS_KM = float(os.getenv("ML_DBSCAN_EPS_KM", "20"))
MIN_CLUSTER_POINTS = int(os.getenv("ML_MIN_CLUSTER_POINTS", "4"))
MIN_BUCKETS_FOR_PREDICTION = int(os.getenv("ML_MIN_BUCKETS_FOR_PREDICTION", "3"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("ML_REQUEST_TIMEOUT_SECONDS", "20"))
RECENT_STRIKE_WINDOW_MINUTES = 10
RISK_HORIZON_MINUTES = int(os.getenv("ML_RISK_HORIZON_MINUTES", "10"))
RISK_RADIUS_KM = float(os.getenv("ML_RISK_RADIUS_KM", "20"))
RISK_MODEL_PATH = os.getenv("ML_RISK_MODEL_PATH", os.path.join(APP_DIR, "risk_model.pkl"))
RISK_FEATURE_WINDOW_MINUTES = int(os.getenv("ML_RISK_FEATURE_WINDOW_MINUTES", "60"))

POLL_MIN_SECONDS = max(1, POLL_MIN_SECONDS)
POLL_MAX_SECONDS = max(POLL_MIN_SECONDS, POLL_MAX_SECONDS)

logger = logging.getLogger("strikewise-ml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_r = 6371.0
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    dlat = lat2r - lat1r
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlng / 2) ** 2
    )
    return 2 * earth_r * math.asin(math.sqrt(a))


def row_timestamp_ms(row: sqlite3.Row) -> int:
    return int(row["strike_timestamp"])


def row_distance_km(row: sqlite3.Row, monitored_lat: float, monitored_lng: float) -> float:
    return haversine_km(
        monitored_lat,
        monitored_lng,
        float(row["lat"]),
        float(row["lng"]),
    )


def centroid_distance_km(
    rows: list[sqlite3.Row],
    monitored_lat: float,
    monitored_lng: float,
) -> float:
    if not rows:
        return 999.0

    centroid_lat = sum(float(row["lat"]) for row in rows) / len(rows)
    centroid_lng = sum(float(row["lng"]) for row in rows) / len(rows)
    return haversine_km(monitored_lat, monitored_lng, centroid_lat, centroid_lng)


def previous_window_rows(
    rows: list[sqlite3.Row],
    as_of_ts_ms: int,
    window_minutes: int,
) -> list[sqlite3.Row]:
    prev_end = as_of_ts_ms - window_minutes * 60 * 1000
    prev_start = prev_end - window_minutes * 60 * 1000
    return [
        row for row in rows
        if prev_start <= row_timestamp_ms(row) < prev_end
    ]


def build_risk_features(
    rows: list[sqlite3.Row],
    monitored_lat: float,
    monitored_lng: float,
    as_of_ts_ms: int,
) -> dict[str, float]:
    windows_min = [5, 10, 20, 30, 45, 60]
    rings_km: list[tuple[float, float]] = [(0, 5), (5, 10), (10, 20), (20, 40)]
    features: dict[str, float] = {}

    history_rows = [row for row in rows if row_timestamp_ms(row) <= as_of_ts_ms]
    history_distances = [row_distance_km(row, monitored_lat, monitored_lng) for row in history_rows]

    for window in windows_min:
        cutoff = as_of_ts_ms - window * 60 * 1000
        window_rows = [row for row in history_rows if row_timestamp_ms(row) >= cutoff]
        distances = [row_distance_km(row, monitored_lat, monitored_lng) for row in window_rows]
        features[f"count_{window}m"] = float(len(window_rows))

        if window_rows:
            avg_intensity = sum(float(row["intensity"]) for row in window_rows) / len(window_rows)
            features[f"avg_intensity_{window}m"] = float(avg_intensity)
            features[f"closest_{window}m_km"] = float(min(distances))
            features[f"mean_distance_{window}m_km"] = float(sum(distances) / len(distances))
            features[f"distance_std_{window}m_km"] = float(np.std(np.array(distances, dtype=float)))
            positive_count = sum(1 for row in window_rows if str(row["polarity"]) == "positive")
            features[f"positive_ratio_{window}m"] = float(positive_count / len(window_rows))
            features[f"nearby_pressure_{window}m"] = float(sum(1.0 / max(1.0, dist) for dist in distances))
            centroid_dist = centroid_distance_km(window_rows, monitored_lat, monitored_lng)
            features[f"centroid_distance_{window}m_km"] = float(centroid_dist)
        else:
            features[f"avg_intensity_{window}m"] = 0.0
            features[f"closest_{window}m_km"] = 999.0
            features[f"mean_distance_{window}m_km"] = 999.0
            features[f"distance_std_{window}m_km"] = 0.0
            features[f"positive_ratio_{window}m"] = 0.0
            features[f"nearby_pressure_{window}m"] = 0.0
            features[f"centroid_distance_{window}m_km"] = 999.0

        prev_rows = previous_window_rows(history_rows, as_of_ts_ms, window)
        prev_count = float(len(prev_rows))
        prev_distances = [row_distance_km(row, monitored_lat, monitored_lng) for row in prev_rows]
        features[f"count_delta_{window}m"] = float(len(window_rows) - prev_count)
        features[f"count_ratio_{window}m"] = float(len(window_rows) / max(1.0, prev_count))
        if prev_distances and distances:
            features[f"approach_delta_{window}m_km"] = float((sum(prev_distances) / len(prev_distances)) - (sum(distances) / len(distances)))
        else:
            features[f"approach_delta_{window}m_km"] = 0.0

        for ring_start, ring_end in rings_km:
            key = f"count_{window}m_{int(ring_start)}_{int(ring_end)}km"
            count = 0
            weighted_intensity = 0.0
            for row, dist in zip(window_rows, distances, strict=True):
                if ring_start <= dist < ring_end:
                    count += 1
                    weighted_intensity += float(row["intensity"])
            features[key] = float(count)
            features[f"intensity_{window}m_{int(ring_start)}_{int(ring_end)}km"] = float(weighted_intensity)

    past_5m = features["count_5m"]
    past_20m = features["count_20m"]
    features["rate_trend_5m_vs_20m"] = float((past_5m * 4) - past_20m)
    features["close_rate_bias"] = float(features["count_10m_0_5km"] + features["count_10m_5_10km"] - features["count_10m_20_40km"])
    features["intensity_trend_10m_vs_30m"] = float(features["avg_intensity_10m"] - features["avg_intensity_30m"])

    if history_rows:
        latest = max(row_timestamp_ms(row) for row in history_rows)
        features["seconds_since_last_strike"] = float(max(0, (as_of_ts_ms - latest) // 1000))
        nearby_10km = [row for row, dist in zip(history_rows, history_distances, strict=True) if dist <= 10]
        nearby_20km = [row for row, dist in zip(history_rows, history_distances, strict=True) if dist <= 20]
        if nearby_10km:
            latest_10km = max(row_timestamp_ms(row) for row in nearby_10km)
            features["seconds_since_last_10km_strike"] = float(max(0, (as_of_ts_ms - latest_10km) // 1000))
        else:
            features["seconds_since_last_10km_strike"] = float(24 * 60 * 60)

        if nearby_20km:
            latest_20km = max(row_timestamp_ms(row) for row in nearby_20km)
            features["seconds_since_last_20km_strike"] = float(max(0, (as_of_ts_ms - latest_20km) // 1000))
        else:
            features["seconds_since_last_20km_strike"] = float(24 * 60 * 60)
    else:
        features["seconds_since_last_strike"] = float(24 * 60 * 60)
        features["seconds_since_last_10km_strike"] = float(24 * 60 * 60)
        features["seconds_since_last_20km_strike"] = float(24 * 60 * 60)

    return features


def risk_feature_vector(features: dict[str, float]) -> tuple[list[str], np.ndarray]:
    keys = sorted(features.keys())
    values = np.array([features[key] for key in keys], dtype=float)
    return keys, values


def load_risk_model_bundle() -> dict[str, Any] | None:
    if not os.path.exists(RISK_MODEL_PATH):
        return None
    with open(RISK_MODEL_PATH, "rb") as fh:
        bundle = pickle.load(fh)
    if not isinstance(bundle, dict):
        return None
    return bundle


def heuristic_risk(features: dict[str, float]) -> float:
    score = 0.05
    score += min(0.4, 0.03 * features.get("count_10m_0_5km", 0))
    score += min(0.3, 0.015 * features.get("count_10m_5_10km", 0))
    score += min(0.2, 0.008 * features.get("count_20m_10_20km", 0))
    score += min(0.2, 0.0006 * max(0.0, 600 - features.get("seconds_since_last_strike", 3600)))
    score += min(0.2, 0.01 * max(0.0, features.get("rate_trend_5m_vs_20m", 0.0)))
    score += min(0.15, 0.015 * max(0.0, features.get("approach_delta_10m_km", 0.0)))
    score += min(0.1, 0.02 * max(0.0, features.get("count_delta_10m", 0.0)))
    score += min(0.1, 0.03 * features.get("nearby_pressure_10m", 0.0))
    if features.get("closest_10m_km", 999.0) <= 10:
        score += 0.08
    if features.get("seconds_since_last_10km_strike", 86400.0) <= 300:
        score += 0.08
    return float(max(0.01, min(0.99, score)))


def explain_risk_features(features: dict[str, float]) -> tuple[str, list[str]]:
    drivers: list[str] = []

    close_5km = features.get("count_10m_0_5km", 0.0)
    close_10km = features.get("count_10m_5_10km", 0.0)
    medium_20km = features.get("count_20m_10_20km", 0.0)
    recent_10km_age = features.get("seconds_since_last_10km_strike", 86400.0)
    approach_delta = features.get("approach_delta_10m_km", 0.0)
    rate_delta = features.get("count_delta_10m", 0.0)
    pressure = features.get("nearby_pressure_10m", 0.0)
    positive_ratio = features.get("positive_ratio_10m", 0.0)

    if close_5km >= 2:
        drivers.append("multiple very close strikes in the last 10 minutes")
    elif close_5km >= 1:
        drivers.append("a strike occurred within 5 km in the last 10 minutes")

    if close_10km >= 2:
        drivers.append("strike density is building within 10 km")
    elif close_10km >= 1:
        drivers.append("recent lightning is active within 10 km")

    if medium_20km >= 3:
        drivers.append("an active lightning core is present within 20 km")

    if recent_10km_age <= 300:
        drivers.append("nearby lightning occurred in the last 5 minutes")

    if approach_delta >= 3:
        drivers.append("the strike cluster is moving closer")
    elif approach_delta <= -3:
        drivers.append("the strike cluster is drifting farther away")

    if rate_delta >= 2:
        drivers.append("strike rate is accelerating")
    elif rate_delta <= -2:
        drivers.append("strike rate is easing")

    if pressure >= 1.2:
        drivers.append("lightning pressure near the monitored point is elevated")

    if positive_ratio >= 0.4 and (close_5km + close_10km) > 0:
        drivers.append("a higher share of nearby strikes are positive polarity")

    if not drivers:
        drivers.append("recent nearby lightning activity is limited")

    explanation = drivers[0]
    if len(drivers) > 1:
        explanation = f"{drivers[0]}; {drivers[1]}"

    return explanation, drivers[:4]


def score_risk_probability(
    rows: list[sqlite3.Row],
    monitored_lat: float,
    monitored_lng: float,
    as_of_ts_ms: int,
) -> dict[str, Any]:
    features = build_risk_features(rows, monitored_lat, monitored_lng, as_of_ts_ms)
    feature_keys, vector = risk_feature_vector(features)

    bundle = load_risk_model_bundle()
    if bundle and "model" in bundle and "feature_keys" in bundle:
        model = bundle["model"]
        trained_keys = bundle["feature_keys"]
        row = np.array([features.get(key, 0.0) for key in trained_keys], dtype=float).reshape(1, -1)
        probability = float(model.predict_proba(row)[0][1])
        source = "trained-model"
    else:
        probability = heuristic_risk(features)
        source = "heuristic-fallback"

    explanation, drivers = explain_risk_features(features)

    return {
        "probability": round(probability, 4),
        "source": source,
        "featureCount": len(feature_keys),
        "features": features,
        "explanation": explanation,
        "drivers": drivers,
    }


def build_training_dataset(
    rows: list[sqlite3.Row],
    monitored_lat: float,
    monitored_lng: float,
    horizon_minutes: int,
    radius_km: float,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    sorted_rows = sorted(rows, key=lambda r: int(r["strike_timestamp"]))
    if len(sorted_rows) < 200:
        raise ValueError("Need at least 200 strike rows for model training")

    min_ts = int(sorted_rows[0]["strike_timestamp"])
    max_ts = int(sorted_rows[-1]["strike_timestamp"])
    step_ms = 60_000
    start_ts = min_ts + 30 * 60 * 1000
    end_ts = max_ts - horizon_minutes * 60 * 1000

    x_rows: list[np.ndarray] = []
    y_rows: list[int] = []
    feature_keys: list[str] | None = None

    ts = start_ts
    while ts <= end_ts:
        lookback_cutoff = ts - RISK_FEATURE_WINDOW_MINUTES * 60 * 1000
        lookback_rows = [
            row for row in sorted_rows
            if lookback_cutoff <= int(row["strike_timestamp"]) <= ts
        ]
        future_rows = [
            row for row in sorted_rows
            if ts < int(row["strike_timestamp"]) <= ts + horizon_minutes * 60 * 1000
        ]

        if len(lookback_rows) < 20:
            ts += step_ms
            continue

        label = 0
        for row in future_rows:
            dist = haversine_km(
                monitored_lat,
                monitored_lng,
                float(row["lat"]),
                float(row["lng"]),
            )
            if dist <= radius_km:
                label = 1
                break

        features = build_risk_features(lookback_rows, monitored_lat, monitored_lng, ts)
        keys, vector = risk_feature_vector(features)
        if feature_keys is None:
            feature_keys = keys
        x_rows.append(vector)
        y_rows.append(label)
        ts += step_ms

    if not x_rows or feature_keys is None:
        raise ValueError("Unable to build training dataset")

    X = np.vstack(x_rows)
    y = np.array(y_rows, dtype=int)
    return X, y, feature_keys


def train_risk_model(
    monitored_lat: float,
    monitored_lng: float,
    horizon_minutes: int,
    radius_km: float,
) -> dict[str, Any]:
    rows = load_recent_samples(RISK_FEATURE_WINDOW_MINUTES * 4)
    X, y, feature_keys = build_training_dataset(rows, monitored_lat, monitored_lng, horizon_minutes, radius_km)

    split_idx = max(1, int(len(X) * 0.8))
    X_train, X_valid = X[:split_idx], X[split_idx:]
    y_train, y_valid = y[:split_idx], y[split_idx:]

    if len(np.unique(y_train)) < 2:
        raise ValueError("Training labels contain only one class; need more diverse weather periods")

    base = GradientBoostingClassifier(random_state=42)
    calibrated = CalibratedClassifierCV(base, method="isotonic", cv=3)
    calibrated.fit(X_train, y_train)

    valid_probs = calibrated.predict_proba(X_valid)[:, 1] if len(X_valid) > 0 else np.array([], dtype=float)
    valid_preds = (valid_probs >= 0.5).astype(int) if len(valid_probs) > 0 else np.array([], dtype=int)

    accuracy = float(np.mean(valid_preds == y_valid)) if len(y_valid) > 0 else None
    base_rate = float(np.mean(y))

    bundle = {
        "model": calibrated,
        "feature_keys": feature_keys,
        "trained_at": datetime.now(tz=timezone.utc).isoformat(),
        "horizon_minutes": horizon_minutes,
        "radius_km": radius_km,
        "rows": len(rows),
        "samples": len(X),
    }
    with open(RISK_MODEL_PATH, "wb") as fh:
        pickle.dump(bundle, fh)

    return {
        "ok": True,
        "modelPath": RISK_MODEL_PATH,
        "samples": int(len(X)),
        "validationSamples": int(len(y_valid)),
        "validationAccuracy": round(accuracy, 4) if accuracy is not None else None,
        "baseRate": round(base_rate, 4),
        "featureCount": len(feature_keys),
        "horizonMinutes": horizon_minutes,
        "radiusKm": radius_km,
    }


def _classification_metrics(y_true: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    preds = (probabilities >= threshold).astype(int)
    tp = int(np.sum((preds == 1) & (y_true == 1)))
    tn = int(np.sum((preds == 0) & (y_true == 0)))
    fp = int(np.sum((preds == 1) & (y_true == 0)))
    fn = int(np.sum((preds == 0) & (y_true == 1)))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    accuracy = float(np.mean(preds == y_true)) if len(y_true) > 0 else 0.0
    brier = float(np.mean((probabilities - y_true) ** 2)) if len(y_true) > 0 else 1.0

    if len(np.unique(y_true)) >= 2:
        roc_auc = float(roc_auc_score(y_true, probabilities))
    else:
        roc_auc = None

    return {
        "threshold": threshold,
        "samples": int(len(y_true)),
        "accuracy": round(accuracy, 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "brier": round(float(brier), 4),
        "rocAuc": round(roc_auc, 4) if roc_auc is not None else None,
        "confusion": {
            "tp": tp,
            "tn": tn,
            "fp": fp,
            "fn": fn,
        },
    }


def evaluate_risk_model(
    monitored_lat: float,
    monitored_lng: float,
    horizon_minutes: int,
    radius_km: float,
    threshold: float,
) -> dict[str, Any]:
    rows = load_recent_samples(RISK_FEATURE_WINDOW_MINUTES * 4)
    X, y, feature_keys = build_training_dataset(rows, monitored_lat, monitored_lng, horizon_minutes, radius_km)

    split_idx = max(1, int(len(X) * 0.8))
    X_valid = X[split_idx:]
    y_valid = y[split_idx:]

    if len(y_valid) == 0:
        raise ValueError("Not enough holdout samples to evaluate; gather more history")

    bundle = load_risk_model_bundle()
    source = "heuristic-fallback"

    if bundle and "model" in bundle and "feature_keys" in bundle:
        source = "trained-model"
        model = bundle["model"]
        trained_keys: list[str] = bundle["feature_keys"]
        idx_map = {key: idx for idx, key in enumerate(feature_keys)}
        X_valid_aligned = np.column_stack([
            X_valid[:, idx_map[key]] if key in idx_map else np.zeros(len(X_valid), dtype=float)
            for key in trained_keys
        ])
        probs = model.predict_proba(X_valid_aligned)[:, 1]
    else:
        probs_list: list[float] = []
        for row in X_valid:
            feats = {key: float(row[idx]) for idx, key in enumerate(feature_keys)}
            probs_list.append(heuristic_risk(feats))
        probs = np.array(probs_list, dtype=float)

    metrics = _classification_metrics(y_valid, probs, threshold)
    base_rate = float(np.mean(y)) if len(y) > 0 else 0.0

    return {
        "ok": True,
        "modelSource": source,
        "samples": int(len(X)),
        "validationSamples": int(len(y_valid)),
        "baseRate": round(base_rate, 4),
        "horizonMinutes": horizon_minutes,
        "radiusKm": radius_km,
        "metrics": metrics,
    }


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


def count_recent_strikes(payload: dict[str, Any], window_minutes: int = RECENT_STRIKE_WINDOW_MINUTES) -> int:
    strikes = payload.get("strikes", [])
    if not isinstance(strikes, list):
        return 0

    cutoff_ms = now_ms() - window_minutes * 60 * 1000
    recent = 0
    for strike in strikes:
        if not isinstance(strike, dict):
            continue
        try:
            timestamp = int(strike["timestamp"])
        except (KeyError, TypeError, ValueError):
            continue

        if timestamp >= cutoff_ms:
            recent += 1

    return recent


def polling_loop(stop_event: threading.Event) -> None:
    current_interval_seconds = POLL_MIN_SECONDS

    while not stop_event.is_set():
        try:
            payload = fetch_lightning_payload()
            recent_strike_count = count_recent_strikes(payload)
            result = save_strikes(payload)

            if recent_strike_count > 0:
                current_interval_seconds = POLL_MIN_SECONDS
                cadence_reason = "active"
            else:
                current_interval_seconds = min(POLL_MAX_SECONDS, current_interval_seconds * 2)
                cadence_reason = "idle-backoff"

            logger.info(
                "Saved %s/%s strikes from %s (recent10m=%s, nextPoll=%ss, mode=%s)",
                result["inserted"],
                result["received"],
                result["provider"],
                recent_strike_count,
                current_interval_seconds,
                cadence_reason,
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("Lightning ingestion failed: %s", error)
            logger.info("Next poll in %ss", current_interval_seconds)

        if stop_event.wait(current_interval_seconds):
            break


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
        "pollMinSeconds": POLL_MIN_SECONDS,
        "pollMaxSeconds": POLL_MAX_SECONDS,
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
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "Strikewise ML",
        "version": "0.1.0",
        "endpoints": {
            "status": "/ml/status",
            "predict": "/ml/predict",
            "risk": "/ml/risk",
            "evaluate": "/ml/evaluate",
        },
    }


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


@app.get("/ml/risk")
def ml_risk(lat: float, lng: float) -> dict[str, Any]:
    rows = load_recent_samples(RISK_FEATURE_WINDOW_MINUTES)
    score = score_risk_probability(rows, lat, lng, now_ms())

    probability = float(score["probability"])
    if probability >= 0.7:
        risk_level = "high"
    elif probability >= 0.4:
        risk_level = "moderate"
    else:
        risk_level = "low"

    return {
        "ready": True,
        "horizonMinutes": RISK_HORIZON_MINUTES,
        "radiusKm": RISK_RADIUS_KM,
        "lat": lat,
        "lng": lng,
        "riskLevel": risk_level,
        "strikeProbability": probability,
        "modelSource": score["source"],
        "featureCount": score["featureCount"],
        "explanation": score["explanation"],
        "drivers": score["drivers"],
        "asOf": utc_now_iso(now_ms()),
    }


@app.post("/ml/train")
def ml_train(lat: float, lng: float, horizon_minutes: int = RISK_HORIZON_MINUTES, radius_km: float = RISK_RADIUS_KM) -> dict[str, Any]:
    return train_risk_model(lat, lng, horizon_minutes, radius_km)


@app.get("/ml/evaluate")
def ml_evaluate(
    lat: float,
    lng: float,
    threshold: float = 0.5,
    horizon_minutes: int = RISK_HORIZON_MINUTES,
    radius_km: float = RISK_RADIUS_KM,
) -> dict[str, Any]:
    return evaluate_risk_model(
        monitored_lat=lat,
        monitored_lng=lng,
        horizon_minutes=horizon_minutes,
        radius_km=radius_km,
        threshold=max(0.01, min(0.99, threshold)),
    )