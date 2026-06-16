#!/usr/bin/env python3
import json
import os
import time
import argparse
import math
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse

import uuid
import ccxt
import yaml
from dotenv import load_dotenv
from rich import print
from datetime import timedelta


APP_TZ = ZoneInfo(os.getenv("BOT_TIMEZONE", "America/New_York"))
DATA_ROOT = os.getenv("TRADEBOT_DATA_ROOT", os.path.join(os.path.dirname(__file__), ".tradebot-data"))


def _data_path(*parts):
    return os.path.join(DATA_ROOT, *parts)

# ── SLA CONSTANTS (from telemetry hardening sprint) ───────────────────────────
# NOTE: These are EVALUATION PIPELINE SLA windows (signal_emit → entry_or_reject),
# NOT order submission latency. The bot needs time to: fetch bars, check filters,
# compute indicators, and potentially call AI. 400ms/800ms/1200ms was killing
# 100% of signals (67/67 on 2026-04-10) because evaluation takes 10-30 seconds.
# These windows should be generous enough for the full evaluation pipeline.
SLA_WINDOWS_MS = {
    "crypto": 30000,   # 30 sec: fast poll cycle, simple evaluation
    "forex":  45000,    # 45 sec: OANDA API can be slow
    "stocks": 60000,    # 60 sec: Alpaca + more filters + key level checks
}
RETRY_DELAYS_MS = [50, 100]  # Two retry attempts at 50ms and 100ms
MAX_RETRIES = 2

# ── MISS REASON TAXONOMY ──────────────────────────────────────────────────────
class MissReason:
    SLA_BREACH = "sla_breach"
    FILTERED = "filtered_or_no_executable_signal"
    SUPPRESSED_BY_AI = "suppressed_by_ai"
    API_ERROR = "api_error"
    RATE_LIMITED = "rate_limited"
    INSUFFICIENT_BALANCE = "insufficient_balance"
    PERMANENTLY_BLOCKED = "permanently_blocked"


def now_utc():
    return datetime.now(timezone.utc)


def now_local():
    return datetime.now(APP_TZ)


def day_str_local():
    return now_local().strftime("%Y-%m-%d")


def is_within_trading_hours(cfg):
    """
    Check if current time is within configured trading hours.
    Uses UTC times from config (skip_before_utc, skip_after_utc).
    Returns True if trading is allowed, False if outside trading hours.
    """
    trading_hours_cfg = cfg.get("trading_hours", {})
    if not trading_hours_cfg.get("enabled", False):
        return True  # Trading hours not configured, allow trading

    now_utc = datetime.now(timezone.utc)
    current_time_str = now_utc.strftime("%H:%M")  # Format: "14:30"

    skip_before = trading_hours_cfg.get("skip_before_utc", "00:00")
    skip_after = trading_hours_cfg.get("skip_after_utc", "23:59")

    # Simple string comparison works for HH:MM format
    if skip_before <= current_time_str <= skip_after:
        return True  # Within allowed trading hours
    else:
        return False  # Outside trading hours, skip


def should_force_stock_eod_flatten(cfg, exchange):
    """
    Force stock positions flat shortly before the regular market close.
    Defaults to 1 minute before 16:00 ET for Alpaca stock trading.
    """
    if not isinstance(exchange, AlpacaAdapter):
        return False
    risk_cfg = cfg.get("risk", {}) or {}
    force_minutes = int(risk_cfg.get("force_flatten_before_close_min", 1))
    if force_minutes < 0:
        force_minutes = 0
    market_close_hour = int(risk_cfg.get("market_close_hour_et", 16))
    market_close_minute = int(risk_cfg.get("market_close_minute_et", 0))
    now = now_local()
    cutoff = now.replace(
        hour=market_close_hour,
        minute=market_close_minute,
        second=0,
        microsecond=0,
    ) - timedelta(minutes=force_minutes)
    return now >= cutoff


def default_api_calls_by_provider():
    return {
        "openai": 0,
        "alpaca": 0,
        "oanda": 0,
        "ccxt": 0,
        "other": 0,
    }


def default_api_calls_by_endpoint():
    return {}


def default_skip_reasons():
    return {
        "risk_block": 0,
        "cooldown": 0,
        "filters": 0,
        "setup": 0,
        "rr": 0,
        "ai_hold": 0,
        "ai_low_conf_open": 0,
    }


def classify_provider(url):
    try:
        host = (urlparse(url).netloc or "").lower()
    except Exception:
        host = ""
    if "openai" in host:
        return "openai"
    if "alpaca" in host:
        return "alpaca"
    if "oanda" in host:
        return "oanda"
    return "other"


def ensure_api_counters(state):
    counts = state.get("api_calls_by_provider_today")
    if not isinstance(counts, dict):
        counts = {}
    merged = default_api_calls_by_provider()
    for k, v in counts.items():
        try:
            merged[str(k)] = int(v)
        except Exception:
            merged[str(k)] = 0
    state["api_calls_by_provider_today"] = merged

    endpoints = state.get("api_calls_by_endpoint_today")
    if not isinstance(endpoints, dict):
        endpoints = {}
    cleaned = {}
    for k, v in endpoints.items():
        try:
            cleaned[str(k)] = int(v)
        except Exception:
            cleaned[str(k)] = 0
    state["api_calls_by_endpoint_today"] = cleaned


def inc_api_counter(state, provider, n=1):
    ensure_api_counters(state)
    p = str(provider or "other").lower()
    counts = state["api_calls_by_provider_today"]
    counts[p] = int(counts.get(p, 0)) + int(n)


def inc_api_endpoint_counter(state, endpoint_key, n=1):
    ensure_api_counters(state)
    k = str(endpoint_key or "unknown")
    counts = state["api_calls_by_endpoint_today"]
    counts[k] = int(counts.get(k, 0)) + int(n)


def endpoint_key_for(url, method="GET", provider=None, label=None):
    if label:
        p = str(provider or "other").lower()
        return f"{p}:{label}"
    p = str(provider or classify_provider(url) or "other").lower()
    try:
        u = urlparse(url)
        path = u.path or "/"
    except Exception:
        path = "/"
    return f"{p}:{str(method or 'GET').upper()} {path}"


def ensure_skip_counters(state):
    cur = state.get("skip_reasons_today")
    if not isinstance(cur, dict):
        cur = {}
    merged = default_skip_reasons()
    for k, v in cur.items():
        try:
            merged[str(k)] = int(v)
        except Exception:
            merged[str(k)] = 0
    state["skip_reasons_today"] = merged


def inc_skip_reason(state, key, n=1):
    ensure_skip_counters(state)
    k = str(key or "other")
    m = state["skip_reasons_today"]
    m[k] = int(m.get(k, 0)) + int(n)


def ensure_watchlist_state(state):
    if not isinstance(state.get("watched_symbols"), list):
        state["watched_symbols"] = []
    if not isinstance(state.get("watched_ranked"), list):
        state["watched_ranked"] = []
    try:
        state["watchlist_updated_at"] = int(state.get("watchlist_updated_at", 0))
    except Exception:
        state["watchlist_updated_at"] = 0


def ensure_runner_scan_state(state):
    if not isinstance(state.get("runner_scan_history"), list):
        state["runner_scan_history"] = []
    if not isinstance(state.get("runner_scan_last_snapshot"), dict):
        state["runner_scan_last_snapshot"] = {}
    if not isinstance(state.get("runner_scan_last_candidates"), list):
        state["runner_scan_last_candidates"] = []
    if not isinstance(state.get("runner_scan_last_selected"), list):
        state["runner_scan_last_selected"] = []
    if not isinstance(state.get("runner_scan_last_reason_counts"), dict):
        state["runner_scan_last_reason_counts"] = {}
    if not isinstance(state.get("runner_scan_day_watch_symbols"), list):
        state["runner_scan_day_watch_symbols"] = []
    if not isinstance(state.get("runner_scan_day_symbol_cache"), dict):
        state["runner_scan_day_symbol_cache"] = {}
    if not isinstance(state.get("runner_scan_reflection_prev_px"), dict):
        state["runner_scan_reflection_prev_px"] = {}
    if not isinstance(state.get("runner_scan_reflection_first_px"), dict):
        state["runner_scan_reflection_first_px"] = {}
    if not isinstance(state.get("runner_scan_reflection_prev_vol"), dict):
        state["runner_scan_reflection_prev_vol"] = {}
    if not isinstance(state.get("runner_scan_reflection_first_vol"), dict):
        state["runner_scan_reflection_first_vol"] = {}


def ensure_dynamic_risk_state(state):
    try:
        state["win_streak"] = int(state.get("win_streak", 0))
    except Exception:
        state["win_streak"] = 0
    try:
        state["chop_streak"] = int(state.get("chop_streak", 0))
    except Exception:
        state["chop_streak"] = 0


def load_config(path="config.yaml"):
    with open(path, "r") as f:
        return yaml.safe_load(f)


def load_state(path):
    if not os.path.exists(path):
        return {
            "day": day_str_local(),
            "daily_pnl": 0.0,
            "trades_today": 0,
            "position": None,
            "positions": {},
            "paper_balance": None,
            "last_alert_ts": 0,
            "strategy_scores": {"sma": 0.0, "mom": 0.0, "mr": 0.0},
            "strategy_stats": {
                "sma": {"samples": 0, "wins": 0, "reward_sum": 0.0},
                "mom": {"samples": 0, "wins": 0, "reward_sum": 0.0},
                "mr": {"samples": 0, "wins": 0, "reward_sum": 0.0},
            },
            "disabled_strategies": [],
            "active_symbol": None,
            "cooldown_until": 0,
            "symbol_cooldowns": {},
            "watched_symbols": [],
            "watched_ranked": [],
            "watchlist_updated_at": 0,
            "loss_streak": 0,
            "win_streak": 0,
            "chop_streak": 0,
            "ai_calls_today": 0,
            "non_api_decisions_today": 0,
            "policy_cache_hits_today": 0,
            "api_calls_by_provider_today": default_api_calls_by_provider(),
            "api_calls_by_endpoint_today": default_api_calls_by_endpoint(),
            "skip_reasons_today": default_skip_reasons(),
            "ai_last_call_ts": 0,
            "last_px": None,
            "last_signals": None,
            "morning_scan_symbols": [],
            "morning_scan_ranked": [],
            "morning_scan_date": "",
            "morning_scan_ts": 0,
            "key_levels_by_symbol": {},
            "key_levels_updated_date": "",
            "runner_pending": {},
            "runner_scan_ts": 0,
            "runner_flagged_symbols": [],
            "runner_scan_history": [],
            "runner_scan_last_snapshot": {},
            "runner_scan_last_candidates": [],
            "runner_scan_last_selected": [],
            "runner_scan_last_reason_counts": {},
            "runner_scan_day_watch_symbols": [],
            "runner_scan_day_symbol_cache": {},
            "runner_scan_reflection_prev_px": {},
            "runner_scan_reflection_first_px": {},
            "runner_scan_reflection_prev_vol": {},
            "runner_scan_reflection_first_vol": {},
            "pending_signals": {},
            "last_signal_emit_key_by_symbol": {},
            "eod_review_date": "",
            "_pattern_library_cache": None,
            "_pattern_library_date": "",
            "break_watchers": {},  # {"HOOD": {"break": 5.50, "added_ts": 1234567890, "confidence": 0.85, "l2_wall": 5.50, "recent_high": 5.48}}
        }
    with open(path, "r") as f:
        state = json.load(f)
    ensure_api_counters(state)
    ensure_skip_counters(state)
    ensure_watchlist_state(state)
    ensure_dynamic_risk_state(state)
    ensure_break_watchers_state(state)
    ensure_runner_scan_state(state)
    if not isinstance(state.get("pending_signals"), dict):
        state["pending_signals"] = {}
    if not isinstance(state.get("last_signal_emit_key_by_symbol"), dict):
        state["last_signal_emit_key_by_symbol"] = {}
    return state


def save_state(path, state):
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def append_journal(path, event):
    if not path:
        return
    row = {"ts": now_utc().isoformat(), **event}
    try:
        with open(path, "a") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
    except Exception as e:
        print(f"[yellow]Journal write failed:[/yellow] {e}")


def _blocked_reflection_path(ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    base_dir = os.path.join(
        os.path.dirname(__file__),
        "Reflection",
        "Stocks",
        "Day",
        "Blocked",
    )
    try:
        os.makedirs(base_dir, exist_ok=True)
    except Exception:
        pass
    return os.path.join(base_dir, f"blocked_{day}.jsonl")


def append_blocked_reflection(event, ts=None):
    row = {"ts": (ts or now_utc()).isoformat(), **event}
    path = _blocked_reflection_path(ts)
    try:
        with open(path, "a") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
    except Exception as e:
        print(f"[yellow]Blocked reflection write failed:[/yellow] {e}")


def _reflection_day_dir(*parts):
    base_dir = os.path.join(os.path.dirname(__file__), "Reflection", "Stocks", "Day", *parts)
    try:
        os.makedirs(base_dir, exist_ok=True)
    except Exception:
        pass
    return base_dir


def _append_reflection_jsonl(subdir, filename, event, ts=None):
    row = {"ts": (ts or now_utc()).isoformat(), **event}
    path = os.path.join(_reflection_day_dir(subdir), filename)
    try:
        with open(path, "a") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
    except Exception as e:
        print(f"[yellow]Reflection write failed [{subdir}]:[/yellow] {e}")


def append_missed_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Missed", f"missed_{day}.jsonl", event, ts=ts)


def append_fill_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Fills", f"fills_{day}.jsonl", event, ts=ts)


def append_error_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Errors", f"errors_{day}.jsonl", event, ts=ts)


def append_watchlist_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Watchlist", f"watchlist_{day}.jsonl", event, ts=ts)


def append_decision_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Decisions", f"decisions_{day}.jsonl", event, ts=ts)


def append_summary_reflection(event, ts=None):
    ts = ts or now_utc()
    day = ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
    _append_reflection_jsonl("Summary", f"summary_{day}.jsonl", event, ts=ts)


def _compact_runner_scan_entry(row):
    if not isinstance(row, dict):
        return {}
    compact = {}
    for key in (
        "symbol",
        "score",
        "signal",
        "regime",
        "vol",
        "trend",
        "ret15",
        "day_change_pct",
        "chg10",
        "range20",
        "today_vol",
        "vol_ratio",
        "px",
        "dollar_vol_20",
        "spread_bps",
        "screen_reason",
    ):
        value = row.get(key)
        if value is not None:
            compact[key] = value
    return compact


def _safe_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _runner_scan_prev_price_map(prev_snapshot):
    prev_map = {}
    if not isinstance(prev_snapshot, dict):
        return prev_map
    prev_ts = prev_snapshot.get("generated_at") or prev_snapshot.get("ts")
    for row in prev_snapshot.get("scan_candidates") or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().strip()
        px = _safe_float(row.get("px"))
        if sym and px is not None:
            prev_map[sym] = {"px": px, "ts": prev_ts}
    return prev_map


def _build_stock_scan_reflection_entry(snapshot, prev_snapshot=None):
    if not isinstance(snapshot, dict):
        return None

    prev_map = _runner_scan_prev_price_map(prev_snapshot or {})
    scan_ts = snapshot.get("generated_at") or now_utc().isoformat()
    scan_date = str(scan_ts)[:10]
    watchlist = [str(s).upper().strip() for s in (snapshot.get("selected_symbols") or []) if str(s).strip()]
    candidates = []
    for row in snapshot.get("scan_candidates") or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().strip()
        if not sym:
            continue
        cur_px = _safe_float(row.get("px"))
        prev_px = None
        prev_seen = None
        prev_row = prev_map.get(sym) or {}
        if isinstance(prev_row, dict):
            prev_px = _safe_float(prev_row.get("px"))
            prev_seen = prev_row.get("ts")
        delta_pct = None
        if cur_px is not None and prev_px not in (None, 0):
            delta_pct = ((cur_px / prev_px) - 1.0) * 100.0
        candidates.append({
            "symbol": sym,
            "score": row.get("score"),
            "signal": row.get("signal"),
            "regime": row.get("regime"),
            "px": cur_px,
            "day_change_pct": row.get("day_change_pct"),
            "chg10": row.get("chg10"),
            "range20": row.get("range20"),
            "today_vol": row.get("today_vol"),
            "vol_ratio": row.get("vol_ratio"),
            "dollar_vol_20": row.get("dollar_vol_20"),
            "spread_bps": row.get("spread_bps"),
            "screen_reason": row.get("screen_reason"),
            "prev_px": prev_px,
            "delta_since_last_scan_pct": round(delta_pct, 4) if delta_pct is not None else None,
            "prev_scan_ts": prev_seen,
        })

    return {
        "ts": scan_ts,
        "date": scan_date,
        "asset_class": snapshot.get("asset_class") or "stock",
        "scan_type": snapshot.get("scan_type") or "runner_scan",
        "watchlist": watchlist,
        "selected_count": len(watchlist),
        "candidate_count": int(snapshot.get("candidate_count") or len(candidates)),
        "ranked_count": int(snapshot.get("ranked_count") or 0),
        "reason_counts": snapshot.get("reason_counts") or {},
        "scan_params": snapshot.get("scan_params") or {},
        "candidates": candidates,
    }


def _build_stock_scan_reflection_entry_all_day(snapshot, state, prev_snapshot=None):
    """
    Reflection entry that persists all symbols added to watchlist during the day.
    Each run reports price change vs the previous reflection write for that symbol.
    """
    if not isinstance(snapshot, dict):
        return None
    if not isinstance(state, dict):
        state = {}

    scan_ts = snapshot.get("generated_at") or now_utc().isoformat()
    scan_date = str(scan_ts)[:10]

    tracked_symbols = [
        str(s).upper().strip()
        for s in (state.get("runner_scan_day_watch_symbols") or [])
        if str(s).strip()
    ]
    tracked_set = set(tracked_symbols)
    symbol_cache = state.get("runner_scan_day_symbol_cache") or {}
    prev_reflection_px = state.get("runner_scan_reflection_prev_px") or {}
    first_reflection_px = state.get("runner_scan_reflection_first_px") or {}
    prev_reflection_vol = state.get("runner_scan_reflection_prev_vol") or {}
    first_reflection_vol = state.get("runner_scan_reflection_first_vol") or {}

    scan_row_map = {}
    for row in (snapshot.get("scan_candidates") or []):
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().strip()
        if not sym:
            continue
        scan_row_map[sym] = row

    candidates = []
    for sym in tracked_symbols:
        row = scan_row_map.get(sym)
        if not isinstance(row, dict):
            row = symbol_cache.get(sym) if isinstance(symbol_cache, dict) else {}
        if not isinstance(row, dict):
            row = {}
        cur_px = _safe_float(row.get("px"))
        cur_vol = _safe_float(row.get("today_vol"))
        prev_px = _safe_float((prev_reflection_px or {}).get(sym))
        first_px = _safe_float((first_reflection_px or {}).get(sym))
        prev_vol = _safe_float((prev_reflection_vol or {}).get(sym))
        first_vol = _safe_float((first_reflection_vol or {}).get(sym))
        delta_pct = None
        if cur_px is not None and prev_px not in (None, 0):
            delta_pct = ((cur_px / prev_px) - 1.0) * 100.0
        first_delta_pct = None
        if cur_px is not None and first_px not in (None, 0):
            first_delta_pct = ((cur_px / first_px) - 1.0) * 100.0
        vol_delta_pct = None
        if cur_vol is not None and prev_vol not in (None, 0):
            vol_delta_pct = ((cur_vol / prev_vol) - 1.0) * 100.0
        first_vol_delta_pct = None
        if cur_vol is not None and first_vol not in (None, 0):
            first_vol_delta_pct = ((cur_vol / first_vol) - 1.0) * 100.0
        candidates.append({
            "symbol": sym,
            "score": row.get("score"),
            "signal": row.get("signal"),
            "regime": row.get("regime"),
            "px": cur_px,
            "day_change_pct": row.get("day_change_pct"),
            "chg10": row.get("chg10"),
            "range20": row.get("range20"),
            "today_vol": cur_vol,
            "vol_ratio": row.get("vol_ratio"),
            "dollar_vol_20": row.get("dollar_vol_20"),
            "spread_bps": row.get("spread_bps"),
            "screen_reason": row.get("screen_reason"),
            "delta_since_last_scan_pct": round(delta_pct, 4) if delta_pct is not None else None,
            "delta_since_first_scan_pct": round(first_delta_pct, 4) if first_delta_pct is not None else None,
            "prev_vol": prev_vol,
            "first_vol": first_vol,
            "delta_since_last_scan_vol_pct": round(vol_delta_pct, 4) if vol_delta_pct is not None else None,
            "delta_since_first_scan_vol_pct": round(first_vol_delta_pct, 4) if first_vol_delta_pct is not None else None,
            "in_current_scan": sym in scan_row_map,
            "tracked_all_day": True,
        })

    # keep sort stable and deterministic
    candidates.sort(key=lambda x: x.get("symbol") or "")

    # update reference prices for next reflection entry
    next_prev_px = {}
    next_first_px = dict(first_reflection_px) if isinstance(first_reflection_px, dict) else {}
    next_prev_vol = {}
    next_first_vol = dict(first_reflection_vol) if isinstance(first_reflection_vol, dict) else {}
    for row in candidates:
        sym = str(row.get("symbol") or "").upper()
        px = _safe_float(row.get("px"))
        vol = _safe_float(row.get("today_vol"))
        if sym and px is not None:
            next_prev_px[sym] = px
            if sym not in next_first_px:
                next_first_px[sym] = px
        if sym and vol is not None:
            next_prev_vol[sym] = vol
            if sym not in next_first_vol:
                next_first_vol[sym] = vol
    state["runner_scan_reflection_prev_px"] = next_prev_px
    state["runner_scan_reflection_first_px"] = next_first_px
    state["runner_scan_reflection_prev_vol"] = next_prev_vol
    state["runner_scan_reflection_first_vol"] = next_first_vol

    live_watchlist = [str(s).upper().strip() for s in (snapshot.get("selected_symbols") or []) if str(s).strip()]

    return {
        "ts": scan_ts,
        "date": scan_date,
        "asset_class": snapshot.get("asset_class") or "stock",
        "scan_type": snapshot.get("scan_type") or "runner_scan",
        "watchlist": live_watchlist,
        "watchlist_all_day": tracked_symbols,
        "selected_count": len(live_watchlist),
        "all_day_tracked_count": len(tracked_set),
        "candidate_count": len(candidates),
        "ranked_count": int(snapshot.get("ranked_count") or 0),
        "reason_counts": snapshot.get("reason_counts") or {},
        "scan_params": snapshot.get("scan_params") or {},
        "candidates": candidates,
    }


def _append_daily_stock_scan_reflection(snapshot, state, prev_snapshot=None):
    entry = _build_stock_scan_reflection_entry_all_day(snapshot, state, prev_snapshot=prev_snapshot)
    if not entry:
        entry = _build_stock_scan_reflection_entry(snapshot, prev_snapshot=prev_snapshot)
    if not entry:
        return
    out_dir = _STOCK_REFLECTION_DIR
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"scans_{entry['date']}.jsonl")
    try:
        with open(out_path, "a") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except Exception as e:
        print(f"[yellow]stock scan reflection write failed:[/yellow] {e}")


def _record_runner_scan_snapshot(state, journal_path, snapshot, history_limit=25):
    if not isinstance(snapshot, dict):
        return

    prev_snapshot = state.get("runner_scan_last_snapshot") if isinstance(state.get("runner_scan_last_snapshot"), dict) else {}
    snapshot = dict(snapshot)
    snapshot.setdefault("generated_at", now_utc().isoformat())
    snapshot.setdefault("asset_class", "stock")
    snapshot.setdefault("scan_type", "runner_scan")
    snapshot.setdefault("scan_params", {})

    compact_candidates = [
        _compact_runner_scan_entry(row)
        for row in (snapshot.get("scan_candidates") or [])
        if isinstance(row, dict) and row.get("symbol")
    ]
    compact_ranked = [
        _compact_runner_scan_entry(row)
        for row in (snapshot.get("ranked_candidates") or [])
        if isinstance(row, dict) and row.get("symbol")
    ]
    compact_selected = [str(s).strip().upper() for s in (snapshot.get("selected_symbols") or []) if str(s).strip()]

    reason_counts = snapshot.get("reason_counts") or {}
    compact_snapshot = {
        **{k: v for k, v in snapshot.items() if k not in {"scan_candidates", "ranked_candidates"}},
        "scan_candidates": compact_candidates,
        "ranked_candidates": compact_ranked,
        "selected_symbols": compact_selected,
        "candidate_count": len(compact_candidates),
        "ranked_count": len(compact_ranked),
        "selected_count": len(compact_selected),
    }

    state["runner_scan_last_snapshot"] = compact_snapshot
    state["runner_scan_last_candidates"] = compact_candidates[:40]
    state["runner_scan_last_selected"] = compact_selected[:40]
    state["runner_scan_last_reason_counts"] = dict(reason_counts)
    history = state.get("runner_scan_history")
    if not isinstance(history, list):
        history = []
    history.append(compact_snapshot)
    state["runner_scan_history"] = history[-history_limit:]

    # Keep day-level tracked symbols for reflection:
    # once a symbol enters selected_symbols, keep reporting it all day.
    day_watch = state.get("runner_scan_day_watch_symbols")
    if not isinstance(day_watch, list):
        day_watch = []
    known = {str(s).upper().strip() for s in day_watch if str(s).strip()}
    for sym in compact_selected:
        usym = str(sym).upper().strip()
        if usym and usym not in known:
            day_watch.append(usym)
            known.add(usym)
    state["runner_scan_day_watch_symbols"] = day_watch

    # Cache latest candidate row details so symbols can still be reflected
    # even if absent from a later scan window.
    sym_cache = state.get("runner_scan_day_symbol_cache")
    if not isinstance(sym_cache, dict):
        sym_cache = {}
    for row in compact_candidates:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").upper().strip()
        if sym:
            sym_cache[sym] = dict(row)
    state["runner_scan_day_symbol_cache"] = sym_cache

    _append_daily_stock_scan_reflection(compact_snapshot, state, prev_snapshot=prev_snapshot)

    append_journal(journal_path, {
        "type": "runner_scan_snapshot",
        **compact_snapshot,
    })


def _log_entry_decision(journal_path, decision, symbol, **details):
    payload = {
        "type": "entry_decision",
        "decision": str(decision or "unknown"),
        "symbol": symbol,
    }
    payload.update({k: v for k, v in details.items() if v is not None})
    append_journal(journal_path, payload)
    if str(decision or "").startswith("rejected_"):
        append_blocked_reflection({
            "type": "blocked_trade",
            "decision": str(decision or "unknown"),
            "symbol": symbol,
            "details": {k: v for k, v in details.items() if v is not None},
        })
        append_decision_reflection({
            "type": "blocked_trade",
            "decision": str(decision or "unknown"),
            "symbol": symbol,
            "details": {k: v for k, v in details.items() if v is not None},
        })



def normalize_api_error_code(err, provider="other"):
    msg = str(err or "").lower()
    p = str(provider or "other").lower()
    if "429" in msg or "too many requests" in msg or "rate limit" in msg:
        return "RATE_LIMIT"
    if "timed out" in msg or "timeout" in msg:
        return "TIMEOUT"
    if "insufficient" in msg and ("fund" in msg or "balance" in msg):
        return "INSUFFICIENT_FUNDS"
    if "invalid" in msg and ("order" in msg or "symbol" in msg or "qty" in msg or "quantity" in msg):
        return "INVALID_REQUEST"
    if "permission" in msg or "forbidden" in msg or "unauthorized" in msg or "401" in msg or "403" in msg:
        return "AUTH"
    if "404" in msg or "not found" in msg:
        return "NOT_FOUND"
    if "network" in msg or "connection" in msg or "temporarily unavailable" in msg:
        return "NETWORK"
    if "insufficient_liquidity" in msg or "no liquidity" in msg or "liquidity" in msg:
        return "INSUFFICIENT_LIQUIDITY"
    if "rejected" in msg or "reject" in msg:
        return "REJECTED"
    return f"{p.upper()}_UNKNOWN"


def _iso_or_none(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v)).isoformat()
    except Exception:
        return None


def _ms_between(ts_a, ts_b):
    a = _iso_or_none(ts_a)
    b = _iso_or_none(ts_b)
    if not a or not b:
        return None
    try:
        da = datetime.fromisoformat(a)
        db = datetime.fromisoformat(b)
        return int((db - da).total_seconds() * 1000)
    except Exception:
        return None


def emit_missed_signals_if_any(state, journal_path, sla_seconds=None):
    """
    HARDENED MISSED-SIGNAL SWEEP (with market-specific SLA windows + reason classification)

    Check pending_signals for any that have exceeded their market-specific SLA window.
    Emit reason-coded missed_signal events with full attribution.
    Call this EVERY poll cycle, not on a 2-minute timer.

    Args:
        sla_seconds: Override SLA in seconds (from config signal_to_order_sla_seconds)
                     If provided and >0, use this; otherwise use SLA_WINDOWS_MS
    """
    pending = state.get("pending_signals") or {}
    if not isinstance(pending, dict) or not pending:
        return

    now_dt = now_utc()
    now_ms = int(now_dt.timestamp() * 1000)
    keep = {}

    for cid, meta in pending.items():
        sig_ts = _iso_or_none(meta.get("signal_ts"))
        if not sig_ts:
            continue

        market = meta.get("market", "crypto")
        # Use config-provided SLA if available, otherwise use market-specific defaults
        if sla_seconds and sla_seconds > 0:
            sla_ms = int(sla_seconds * 1000)  # Convert seconds to milliseconds
        else:
            sla_ms = SLA_WINDOWS_MS.get(market, 30000)  # Market-specific defaults
        signal_epoch = meta.get("signal_emitted_epoch_ms", 0)

        if signal_epoch <= 0:
            # Fallback: calculate from ISO timestamp
            try:
                signal_epoch = int(datetime.fromisoformat(sig_ts).timestamp() * 1000)
            except:
                continue

        age_ms = now_ms - signal_epoch

        # Check if SLA breached
        if age_ms > sla_ms:
            # Classify WHY signal was missed (reason_code taxonomy)
            reason_code = classify_missed_signal_reason(state, meta)

            append_journal(journal_path, {
                "type": "missed_signal",
                "correlation_id": cid,
                "symbol": meta.get("symbol"),
                "market": market,
                "signal_ts": sig_ts,
                "missed_detected_ts": now_dt.isoformat(),
                "missed_age_ms": int(age_ms),
                "sla_ms": sla_ms,  # Market-specific SLA (not 15000ms anymore)
                "reason_code": reason_code,  # NEW: classified reason, not "unknown"
                "signal_side": meta.get("signal_side"),
                "signal_source": meta.get("signal_source"),
                "quote_snapshot": meta.get("quote_snapshot"),
                "skip_reason": reason_code,  # For legacy compatibility
            })
            # Don't keep expired signals
        else:
            keep[cid] = meta

    state["pending_signals"] = keep


def log_signal_rejection(state, journal_path, telemetry, signal_meta, reason_code):
    """
    Log a rejected signal as a missed_signal event immediately.
    Called when a signal is actively rejected (not just SLA-expired).

    Args:
        state: Current bot state
        journal_path: Path to journal file
        telemetry: Signal telemetry dict (correlation_id, signal_ts, etc.)
        signal_meta: Pending signal metadata
        reason_code: MissReason code (e.g., MissReason.FILTERED)
    """
    if not telemetry or not telemetry.get("correlation_id"):
        return

    now_dt = now_utc()
    now_ms = int(now_dt.timestamp() * 1000)
    signal_epoch = signal_meta.get("signal_emitted_epoch_ms", 0)

    if signal_epoch <= 0:
        sig_ts = signal_meta.get("signal_ts", "")
        try:
            signal_epoch = int(datetime.fromisoformat(sig_ts).timestamp() * 1000)
        except:
            signal_epoch = now_ms

    age_ms = max(0, now_ms - signal_epoch)
    market = signal_meta.get("market", "crypto")
    sla_ms = SLA_WINDOWS_MS.get(market, 30000)

    payload = {
        "type": "missed_signal",
        "correlation_id": telemetry.get("correlation_id"),
        "symbol": signal_meta.get("symbol"),
        "market": market,
        "signal_ts": signal_meta.get("signal_ts"),
        "missed_detected_ts": now_dt.isoformat(),
        "missed_age_ms": age_ms,
        "sla_ms": sla_ms,
        "reason_code": reason_code,
        "signal_side": signal_meta.get("signal_side"),
        "signal_source": signal_meta.get("signal_source"),
        "quote_snapshot": signal_meta.get("quote_snapshot"),
        "rejection_details": signal_meta.get("rejection_details", {}),
    }
    append_journal(journal_path, payload)
    append_blocked_reflection({
        "type": "blocked_signal",
        "correlation_id": telemetry.get("correlation_id"),
        "symbol": signal_meta.get("symbol"),
        "market": market,
        "signal_ts": signal_meta.get("signal_ts"),
        "blocked_detected_ts": now_dt.isoformat(),
        "blocked_age_ms": age_ms,
        "sla_ms": sla_ms,
        "reason_code": reason_code,
        "signal_side": signal_meta.get("signal_side"),
        "signal_source": signal_meta.get("signal_source"),
        "quote_snapshot": signal_meta.get("quote_snapshot"),
        "rejection_details": signal_meta.get("rejection_details", {}),
    })
    append_missed_reflection(payload)


def classify_missed_signal_reason(state, signal_data):
    """
    Classify WHY a signal was missed.
    Returns reason_code from MissReason taxonomy.

    Priority order:
    1. Pre-recorded rejection reason (stored when signal was rejected)
    2. AI suppression
    3. Entry filters
    4. API errors / rate limiting
    5. Balance issues
    6. SLA breach (default)
    """
    # 1. Check if rejection reason was pre-recorded (highest priority)
    if signal_data.get("rejection_reason"):
        return signal_data.get("rejection_reason")

    # 2. Check if AI explicitly blocked
    if signal_data.get("ai_blocked") or signal_data.get("ai_action") == "CLOSE":
        return MissReason.SUPPRESSED_BY_AI

    # 3. Check if entry filters blocked
    if signal_data.get("filtered") or signal_data.get("no_executable_signal"):
        return MissReason.FILTERED

    # Check for specific filter rejections by examining signal metadata
    if signal_data.get("failed_spread_check"):
        return MissReason.FILTERED
    if signal_data.get("failed_vol_check"):
        return MissReason.FILTERED
    if signal_data.get("failed_trendline_check"):
        return MissReason.FILTERED
    if signal_data.get("failed_vwap_check"):
        return MissReason.FILTERED
    if signal_data.get("setup_rejected"):
        return MissReason.FILTERED  # Setup rejection is treated as filter
    if signal_data.get("stock_quality_rejected"):
        return MissReason.FILTERED  # Low quality stock entry
    if signal_data.get("rr_rejected"):
        return MissReason.FILTERED  # R:R validation failure
    if signal_data.get("kill_switch_active"):
        return MissReason.PERMANENTLY_BLOCKED

    # 4. Check for recent API errors on this symbol
    symbol = signal_data.get("symbol", "")
    recent_errors = state.get("recent_errors", {}).get(symbol, [])
    if len(recent_errors) >= 2:
        if any("rate" in str(e).lower() for e in recent_errors):
            return MissReason.RATE_LIMITED
        return MissReason.API_ERROR

    # 5. Check balance
    balance = state.get("paper_balance", 0)
    if balance < 5.0:  # Minimum order size
        return MissReason.INSUFFICIENT_BALANCE

    # 6. Default: SLA breach (signal→order took too long)
    return MissReason.SLA_BREACH

def new_day_if_needed(state):
    day = day_str_local()
    if state.get("day") != day:
        state["day"] = day
        state["daily_pnl"] = 0.0
        state["trades_today"] = 0
        state["ai_calls_today"] = 0
        state["non_api_decisions_today"] = 0
        state["policy_cache_hits_today"] = 0
        state["api_calls_by_provider_today"] = default_api_calls_by_provider()
        state["api_calls_by_endpoint_today"] = default_api_calls_by_endpoint()
        state["skip_reasons_today"] = default_skip_reasons()
        # Reset streak counters on new trading day so yesterday's run doesn't block today's entries.
        state["loss_streak"] = 0
        state["win_streak"] = 0
        state["chop_streak"] = 0
        # Reset morning scan so it re-runs on the new trading day
        state["morning_scan_date"] = ""
        state["morning_scan_symbols"] = []
        state["morning_scan_ranked"] = []
        state["morning_scan_ts"] = 0
        # Clear key levels so they are recomputed from fresh daily data
        state["key_levels_updated_date"] = ""
        state["key_levels_by_symbol"] = {}
        # Reset runner state for new trading day
        state["runner_pending"] = {}
        state["runner_scan_ts"] = 0
        state["runner_flagged_symbols"] = []
        state["runner_scan_history"] = []
        state["runner_scan_last_snapshot"] = {}
        state["runner_scan_last_candidates"] = []
        state["runner_scan_last_selected"] = []
        state["runner_scan_last_reason_counts"] = {}
        state["runner_scan_day_watch_symbols"] = []
        state["runner_scan_day_symbol_cache"] = {}
        state["runner_scan_reflection_prev_px"] = {}
        state["runner_scan_reflection_first_px"] = {}
        state["runner_scan_reflection_prev_vol"] = {}
        state["runner_scan_reflection_first_vol"] = {}
        state["pending_signals"] = {}
        state["last_signal_emit_key_by_symbol"] = {}


def send_alert(cfg, state, text, force=False):
    webhook = cfg.get("alerts", {}).get("webhook_url") or os.getenv("ALERT_WEBHOOK_URL", "")
    if not webhook:
        return

    min_secs = int(cfg.get("alerts", {}).get("min_seconds_between_alerts", 60))
    now_ts = int(time.time())
    if not force and (now_ts - int(state.get("last_alert_ts", 0))) < min_secs:
        return

    body = json.dumps({"text": text}).encode("utf-8")
    req = Request(webhook, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=8):
            pass
        state["last_alert_ts"] = now_ts
    except Exception as e:
        print(f"[yellow]Alert failed:[/yellow] {e}")


def load_policy_cache(path=None):
    path = path or _data_path("study", "policy_cache.json")
    try:
        if os.path.exists(path):
            with open(path, "r") as _f:
                return json.load(_f)
    except Exception:
        pass
    return {}


def save_policy_cache(cache, path=None):
    path = path or _data_path("study", "policy_cache.json")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass


def scenario_signature(snapshot):
    mc = snapshot.get("market_context") or {}
    sigs = snapshot.get("signals") or {}
    return "|".join([
        str(snapshot.get("regime", "?")),
        str(snapshot.get("setup_type", "none")),
        str(sigs.get("sma", "hold")),
        str(sigs.get("mom", "hold")),
        str(sigs.get("mr", "hold")),
        f"vr:{round(float(mc.get('vol_ratio') or 1.0),1)}",
        f"ob:{round(float(mc.get('ob_imbalance') or 0.0),1)}",
        f"sp:{round(float(mc.get('spread_bps') or 0.0),1)}",
    ])


def load_study_context(cfg):
    ai_cfg = cfg.get("ai_executor", {})
    if not ai_cfg.get("include_study_context", True):
        return ""
    max_chars = int(ai_cfg.get("study_context_max_chars", 3000))
    parts = []
    try:
        lessons_path = _data_path("study", "lessons.md")
        if os.path.exists(lessons_path):
            with open(lessons_path, "r") as _lf:
                txt = _lf.read().strip()
            if txt:
                parts.append("LESSONS:\n" + txt)
    except Exception:
        pass
    try:
        kpath = _data_path("study", "knowledge.jsonl")
        if os.path.exists(kpath):
            with open(kpath, "r") as _kf:
                rows = [json.loads(l) for l in _kf if l.strip()]
            tail = rows[-20:]
            lines = []
            for r in tail:
                t = r.get("type", "note")
                src = r.get("source", "local")
                txt = (r.get("text") or r.get("title") or "")
                if txt:
                    lines.append(f"- [{t}] ({src}) {str(txt)[:220]}")
            if lines:
                parts.append("KNOWLEDGE:\n" + "\n".join(lines))
    except Exception:
        pass
    out = "\n\n".join(parts)
    return out[:max_chars]


def ai_decide(cfg, state, snapshot):
    ai_cfg = cfg.get("ai_executor", {})
    if not ai_cfg.get("enabled", False):
        return None

    # Reuse learned policy for familiar scenarios to avoid unnecessary AI calls
    use_policy_cache = bool(ai_cfg.get("use_policy_cache", True))
    policy_min_conf = float(ai_cfg.get("policy_min_confidence", 0.82))
    sig = scenario_signature(snapshot)
    if use_policy_cache:
        cache = load_policy_cache()
        p = cache.get(sig)
        if p and float(p.get("confidence", 0.0)) >= policy_min_conf:
            return {
                "action": p.get("action", "HOLD"),
                "symbol": snapshot.get("symbol"),
                "confidence": float(p.get("confidence", 0.0)),
                "reason": f"policy_cache:{sig}",
                "source": "policy_cache",
            }

    now_ts = int(time.time())
    last_ts = int(state.get("ai_last_call_ts", 0))
    min_interval = int(ai_cfg.get("min_call_interval_sec", 30))
    max_calls_day = int(ai_cfg.get("max_calls_per_day", 500))
    if (now_ts - last_ts) < min_interval:
        return None
    if int(state.get("ai_calls_today", 0)) >= max_calls_day:
        return None

    # AI cooldown for repeated non-actionable snapshots (cuts API burn in chop)
    hold_cd = int(ai_cfg.get("hold_repeat_cooldown_sec", 120))
    last_ai_action = str(state.get("ai_last_action", "") or "")
    last_ai_symbol = str(state.get("ai_last_symbol", "") or "")
    last_ai_decision_ts = int(state.get("ai_last_decision_ts", 0) or 0)
    snap_symbol = str(snapshot.get("symbol") or "")
    sigs = snapshot.get("signals") or {}
    all_holdish = all(str(sigs.get(k, "hold")) in ("hold", "flat") for k in ("sma", "mom", "mr"))
    if hold_cd > 0 and last_ai_action == "HOLD" and last_ai_symbol == snap_symbol and all_holdish:
        if (now_ts - last_ai_decision_ts) < hold_cd:
            return None

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = ai_cfg.get("model", "gpt-4o-mini")
    timeout_s = int(ai_cfg.get("timeout_sec", 12))

    system_prompt = (
        "You are an elite scalp-trading decision engine focused on short-term momentum and microstructure-aware risk. "
        "Return STRICT JSON only with keys: action (OPEN|CLOSE|HOLD), symbol (or null), confidence (0..1), reason (short). "
        "Use only the provided snapshot plus optional local study notes; do not invent data. "
        "Prefer HOLD in weak/choppy conditions unless edge is clear. Never suggest leverage >1."
    )
    study_ctx = load_study_context(cfg)
    user_obj = {"snapshot": snapshot, "study_context": study_ctx}
    user_prompt = json.dumps(user_obj, separators=(",", ":"))
    payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    req = Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        inc_api_counter(state, "openai", 1)
        inc_api_endpoint_counter(state, endpoint_key_for(f"{base_url}/chat/completions", method="POST", provider="openai"), 1)
        with urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8")
        obj = json.loads(raw)
        content = obj["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.strip("`")
            content = content.replace("json", "", 1).strip()
        decision = json.loads(content)
        action = str(decision.get("action", "HOLD")).upper()
        if action not in ("OPEN", "CLOSE", "HOLD"):
            action = "HOLD"
        out = {
            "action": action,
            "symbol": decision.get("symbol"),
            "confidence": float(decision.get("confidence", 0.0)),
            "reason": str(decision.get("reason", ""))[:240],
            "source": "model",
        }
        # Learn reusable policy for similar future scenarios
        if bool(ai_cfg.get("use_policy_cache", True)):
            learn_conf = float(ai_cfg.get("policy_learn_min_confidence", 0.86))
            if float(out.get("confidence", 0.0)) >= learn_conf:
                cache = load_policy_cache()
                cache[scenario_signature(snapshot)] = {
                    "action": out.get("action", "HOLD"),
                    "confidence": float(out.get("confidence", 0.0)),
                    "reason": out.get("reason", ""),
                    "updated_at": now_utc().isoformat(),
                }
                save_policy_cache(cache)

        state["ai_last_call_ts"] = now_ts
        state["ai_calls_today"] = int(state.get("ai_calls_today", 0)) + 1
        return out
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:400]
        except Exception:
            pass
        print(f"[yellow]AI decision skipped:[/yellow] HTTP {e.code} {e.reason} {body}")
        return None
    except (URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"[yellow]AI decision skipped:[/yellow] {e}")
        return None


def _is_transient_http_error(exc):
    msg = str(exc).lower()
    if isinstance(exc, HTTPError):
        # Retry typical transient upstream failures.
        return int(getattr(exc, "code", 0) or 0) in (408, 409, 425, 429, 500, 502, 503, 504)
    if isinstance(exc, (URLError, TimeoutError)):
        transient_terms = (
            "timed out",
            "timeout",
            "connection reset",
            "handshake",
            "temporar",
            "try again",
            "eof occurred",
            "network is unreachable",
            "connection aborted",
        )
        return any(t in msg for t in transient_terms)
    return False


def http_json(url, method="GET", headers=None, payload=None, timeout=15, state=None, provider=None, endpoint_label=None):
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers=headers or {}, method=method)
    if state is not None:
        p = provider or classify_provider(url)
        inc_api_counter(state, p, 1)
        inc_api_endpoint_counter(state, endpoint_key_for(url, method=method, provider=p, label=endpoint_label), 1)
    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
            break
        except Exception as e:
            if attempt >= attempts or not _is_transient_http_error(e):
                raise
            # Small bounded backoff to smooth transient gateway/DNS resets.
            time.sleep(min(1.5, 0.25 * attempt))
    return json.loads(raw) if raw else {}


def tf_to_alpaca(tf):
    m = {"1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "1d": "1Day"}
    return m.get(tf, "1Min")


def tf_to_oanda(tf):
    m = {"1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "1d": "D"}
    return m.get(tf, "M1")


def symbol_to_oanda(symbol):
    return symbol.replace("/", "_")


class AlpacaAdapter:
    def __init__(self, state=None):
        self.state = state
        self.key = os.getenv("ALPACA_API_KEY", "").strip()
        self.secret = os.getenv("ALPACA_API_SECRET", "").strip()
        self.trading_base = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
        self.data_base = "https://data.alpaca.markets"

    def list_nasdaq_symbols(self):
        return self.list_us_symbols(exchange_mode="nasdaq")

    def list_us_symbols(self, exchange_mode="us"):
        url = f"{self.trading_base}/v2/assets?status=active&asset_class=us_equity"
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        arr = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="assets")
        mode = str(exchange_mode or "us").strip().lower()
        out = []
        for a in (arr or []):
            try:
                ex = str(a.get("exchange") or "").upper()
                tradable = bool(a.get("tradable")) and (a.get("status") == "active")
                if not tradable:
                    continue
                if mode == "nasdaq":
                    if ex == "NASDAQ":
                        out.append(str(a.get("symbol")))
                else:
                    if ex in {"NASDAQ", "NYSE", "AMEX", "ARCA", "BATS"}:
                        out.append(str(a.get("symbol")))
            except Exception:
                continue
        return out

    def fetch_snapshots(self, symbols):
        syms = [str(s).upper() for s in (symbols or []) if s]
        if not syms:
            return {}
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        out = {}
        chunk = 200
        for i in range(0, len(syms), chunk):
            part = syms[i:i + chunk]
            url = f"{self.data_base}/v2/stocks/snapshots?symbols={','.join(part)}&feed=iex"
            obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="snapshots")
            if isinstance(obj, dict):
                if "snapshots" in obj and isinstance(obj.get("snapshots"), dict):
                    out.update(obj.get("snapshots") or {})
                else:
                    out.update(obj)
        return out

    def fetch_daily_bars(self, symbols, limit=11):
        syms = [str(s).upper() for s in (symbols or []) if s]
        if not syms:
            return {}
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        out = {}
        chunk = 200
        for i in range(0, len(syms), chunk):
            part = syms[i:i + chunk]
            url = f"{self.data_base}/v2/stocks/bars?symbols={','.join(part)}&timeframe=1Day&limit={int(limit)}&feed=iex"
            obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="bars_multi")
            bars = obj.get("bars") if isinstance(obj, dict) else None
            if isinstance(bars, dict):
                out.update(bars)
        return out

    def fetch_minute_bars(self, symbols, limit=11):
        syms = [str(s).upper() for s in (symbols or []) if s]
        if not syms:
            return {}
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        out = {}
        chunk = 200
        for i in range(0, len(syms), chunk):
            part = syms[i:i + chunk]
            url = f"{self.data_base}/v2/stocks/bars?symbols={','.join(part)}&timeframe=1Min&limit={int(limit)}&feed=iex"
            obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="bars_1m_multi")
            bars = obj.get("bars") if isinstance(obj, dict) else None
            if isinstance(bars, dict):
                out.update(bars)
        return out

    def fetch_recent_minute_bars(self, symbol, limit=11):
        sym = str(symbol).upper()
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        url = f"{self.data_base}/v2/stocks/{sym}/bars?timeframe=1Min&limit={int(limit)}&feed=iex"
        obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="bars_1m_single")
        return (obj.get("bars") or []) if isinstance(obj, dict) else []

    def load_markets(self):
        return None

    def fetch_balance(self):
        """Fetch account balance from Alpaca."""
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        url = f"{self.trading_base}/v2/account"
        obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="account")
        equity = float(obj.get("equity", 0) or 0)
        cash = float(obj.get("cash", 0) or 0)
        return {"total": {"USD": equity}, "free": {"USD": cash}}

    def fetch_positions(self):
        """Fetch open positions from Alpaca."""
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        url = f"{self.trading_base}/v2/positions"
        positions = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="positions")
        if not isinstance(positions, list):
            return []
        return positions

    def amount_to_precision(self, symbol, qty):
        return f"{float(qty):.6f}"

    def fetch_ohlcv(self, symbol, timeframe="1m", limit=100):
        sym = symbol.replace("/", "")
        tf = tf_to_alpaca(timeframe)
        url = f"{self.data_base}/v2/stocks/{sym}/bars?timeframe={tf}&limit={int(limit)}&feed=iex"
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        obj = http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="bars")
        bars = obj.get("bars") or []
        out = []
        for b in bars:
            ts = b.get("t")
            if isinstance(ts, str):
                ts_ms = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
            else:
                ts_ms = int(time.time() * 1000)
            out.append([ts_ms, float(b.get("o", 0)), float(b.get("h", 0)), float(b.get("l", 0)), float(b.get("c", 0)), float(b.get("v", 0))])
        return out

    def fetch_order_book(self, symbol, limit=20):
        sym = symbol.replace("/", "")
        url = f"{self.data_base}/v2/stocks/{sym}/quotes/latest?feed=iex"
        headers = {"APCA-API-KEY-ID": self.key, "APCA-API-SECRET-KEY": self.secret}
        q = (http_json(url, headers=headers, state=self.state, provider="alpaca", endpoint_label="quotes_latest").get("quote") or {})
        bp = float(q.get("bp", 0) or 0)
        ap = float(q.get("ap", 0) or 0)
        bs = float(q.get("bs", 0) or 0)
        a_s = float(q.get("as", 0) or 0)
        bids = [[bp, bs]] if bp > 0 else []
        asks = [[ap, a_s]] if ap > 0 else []
        return {"bids": bids, "asks": asks}

    def create_order(self, symbol, order_type, side, qty, price=None, params=None):
        sym = symbol.replace("/", "")
        tif = "day"
        is_ext_hours = False
        payload = {
            "symbol": sym,
            "qty": str(qty),
            "side": "buy" if side == "buy" else "sell",
            "type": "market",
            "time_in_force": tif,
        }

        # Check if current time is in extended hours (4:00 AM - 9:30 AM or 4:00 PM - 8:00 PM ET)
        # and add extended_hours flag if needed
        try:
            _et_tz = ZoneInfo("America/New_York")
            _now_et = datetime.now(_et_tz)
            _hm = _now_et.hour * 60 + _now_et.minute
            # Pre-market: 4:00 AM (240 min) to 9:30 AM (570 min)
            # After-hours: 4:00 PM (960 min) to 8:00 PM (1200 min)
            if (240 <= _hm < 570) or (960 <= _hm < 1200):
                payload["extended_hours"] = True
                is_ext_hours = True
        except Exception:
            pass

        # Alpaca requires DAY/GTC limit orders in extended-hours sessions.
        # Use an aggressive marketable limit so manual clicks still fill quickly.
        if is_ext_hours:
            try:
                px = float(price) if price is not None else None
            except Exception:
                px = None
            if px and px > 0:
                # More aggressive than before so it behaves closer to "buy now".
                lpx = (px * 1.05) if side == "buy" else (px * 0.95)
                decimals = 4 if lpx < 1.0 else 2
                payload["type"] = "limit"
                payload["limit_price"] = f"{lpx:.{decimals}f}"

        headers = {
            "APCA-API-KEY-ID": self.key,
            "APCA-API-SECRET-KEY": self.secret,
            "Content-Type": "application/json",
        }
        return http_json(f"{self.trading_base}/v2/orders", method="POST", headers=headers, payload=payload, state=self.state, provider="alpaca", endpoint_label="orders")

    def close_position(self, symbol, qty=None):
        sym = symbol.replace("/", "")
        headers = {
            "APCA-API-KEY-ID": self.key,
            "APCA-API-SECRET-KEY": self.secret,
            "Content-Type": "application/json",
        }
        url = f"{self.trading_base}/v2/positions/{sym}"
        payload = {"qty": str(qty)} if qty is not None else None
        return http_json(url, method="DELETE", headers=headers, payload=payload, state=self.state, provider="alpaca", endpoint_label="close_position")


class OandaAdapter:
    def __init__(self, state=None):
        self.state = state
        self.token = os.getenv("OANDA_API_KEY", "").strip()
        self.account_id = os.getenv("OANDA_ACCOUNT_ID", "").strip()
        env = os.getenv("OANDA_ENV", "practice").strip().lower()
        self.base = "https://api-fxpractice.oanda.com" if env != "live" else "https://api-fxtrade.oanda.com"

    def load_markets(self):
        return None

    def fetch_balance(self):
        """Fetch account balance from OANDA."""
        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"{self.base}/v3/accounts/{self.account_id}/summary"
        obj = http_json(url, headers=headers, state=self.state, provider="oanda", endpoint_label="account_summary")
        acct = obj.get("account", {})
        nav = float(acct.get("NAV", 0) or 0)
        balance = float(acct.get("balance", 0) or 0)
        return {"total": {"USD": nav}, "free": {"USD": balance}}

    def list_symbols(self):
        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"{self.base}/v3/accounts/{self.account_id}/instruments"
        obj = http_json(url, headers=headers, state=self.state, provider="oanda", endpoint_label="instruments")
        out = []
        for inst in (obj.get("instruments") or []):
            name = str(inst.get("name") or "")
            if "_" not in name:
                continue
            a, b = name.split("_", 1)
            out.append(f"{a}/{b}")
        return sorted(set(out))

    def amount_to_precision(self, symbol, qty):
        return str(int(round(float(qty))))

    def fetch_ohlcv(self, symbol, timeframe="1m", limit=100):
        inst = symbol_to_oanda(symbol)
        gran = tf_to_oanda(timeframe)
        url = f"{self.base}/v3/instruments/{inst}/candles?price=M&granularity={gran}&count={int(limit)}"
        headers = {"Authorization": f"Bearer {self.token}"}
        obj = http_json(url, headers=headers, state=self.state, provider="oanda", endpoint_label="candles")
        candles = obj.get("candles") or []
        out = []
        for c in candles:
            mid = c.get("mid") or {}
            ts_ms = int(datetime.fromisoformat(c.get("time", "1970-01-01T00:00:00+00:00").replace("Z", "+00:00")).timestamp() * 1000)
            out.append([ts_ms, float(mid.get("o", 0)), float(mid.get("h", 0)), float(mid.get("l", 0)), float(mid.get("c", 0)), float(c.get("volume", 0))])
        return out

    def fetch_order_book(self, symbol, limit=20):
        inst = symbol_to_oanda(symbol)
        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"{self.base}/v3/accounts/{self.account_id}/pricing?instruments={inst}"
        obj = http_json(url, headers=headers, state=self.state, provider="oanda", endpoint_label="pricing")
        prices = obj.get("prices") or []
        if not prices:
            return {"bids": [], "asks": []}
        p = prices[0]
        bids = [[float(x.get("price", 0)), float(x.get("liquidity", 0))] for x in (p.get("bids") or [])[:1]]
        asks = [[float(x.get("price", 0)), float(x.get("liquidity", 0))] for x in (p.get("asks") or [])[:1]]
        return {"bids": bids, "asks": asks}

    def create_order(self, symbol, order_type, side, qty, price=None, params=None):
        inst = symbol_to_oanda(symbol)
        units = int(round(float(qty)))
        if side == "sell":
            units = -abs(units)
        else:
            units = abs(units)
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        payload = {
            "order": {
                "type": "MARKET",
                "instrument": inst,
                "units": str(units),
                "timeInForce": "FOK",
                "positionFill": "DEFAULT",
            }
        }
        return http_json(
            f"{self.base}/v3/accounts/{self.account_id}/orders",
            method="POST",
            headers=headers,
            payload=payload,
            state=self.state,
            provider="oanda",
            endpoint_label="orders",
        )


def build_exchange(cfg, state=None):
    ex_id = str(cfg["exchange"]).lower()
    mode = cfg["mode"]

    if ex_id == "alpaca":
        return AlpacaAdapter(state=state)
    if ex_id == "oanda":
        return OandaAdapter(state=state)

    klass = getattr(ccxt, ex_id)
    kwargs = {"enableRateLimit": True}

    use_demo = cfg.get("execution", {}).get("use_demo", False)

    if mode == "live":
        if ex_id == "binance" and use_demo:
            # Use Binance demo keys
            kwargs["apiKey"] = os.getenv("BINANCE_API_KEY", os.getenv("EXCHANGE_API_KEY", ""))
            kwargs["secret"] = os.getenv("BINANCE_SECRET_KEY", os.getenv("EXCHANGE_API_SECRET", ""))
        else:
            kwargs["apiKey"] = os.getenv("EXCHANGE_API_KEY", "")
            kwargs["secret"] = os.getenv("EXCHANGE_API_SECRET", "")
        pwd = os.getenv("EXCHANGE_API_PASSWORD", "")
        if pwd:
            kwargs["password"] = pwd

    ex = klass(kwargs)

    # Enable Binance demo trading if specified in config
    if ex_id == "binance" and use_demo:
        try:
            ex.enable_demo_trading(True)
            print("[green]Binance demo trading enabled (demo-api.binance.com)[/green]")
        except Exception as e:
            print(f"[yellow]Could not enable demo trading: {e}[/yellow]")
        # Load markets via fetch_markets() — avoids fetch_currencies() which uses
        # sapi endpoints not supported on Binance demo.
        try:
            raw_markets = ex.fetch_markets()
            ex.markets = ex.index_by(raw_markets, "symbol")
            ex.symbols = sorted(ex.markets.keys())
            print(f"[green]Loaded {len(ex.symbols)} markets from Binance demo[/green]")
        except Exception as e:
            print(f"[yellow]Could not load demo markets ({e}), using BTC/USDT fallback[/yellow]")
            ex.markets = {"BTC/USDT": {"id": "BTCUSDT", "symbol": "BTC/USDT", "base": "BTC", "quote": "USDT", "type": "spot"}}
            ex.symbols = ["BTC/USDT"]
    else:
        ex.load_markets()

    market_type = cfg.get("execution", {}).get("market_type", "spot")
    if hasattr(ex, "options"):
        ex.options["defaultType"] = market_type

    return ex


def exchange_provider_id(exchange):
    if isinstance(exchange, AlpacaAdapter):
        return "alpaca"
    if isinstance(exchange, OandaAdapter):
        return "oanda"
    return "ccxt"


def get_ohlcv_series(exchange, symbol, timeframe, limit=100, state=None):
    if state is not None and exchange_provider_id(exchange) == "ccxt":
        inc_api_counter(state, "ccxt", 1)
        inc_api_endpoint_counter(state, "ccxt:fetch_ohlcv", 1)
    return exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)


def get_close_series(exchange, symbol, timeframe, limit=100, state=None):
    ohlcv = get_ohlcv_series(exchange, symbol, timeframe, limit=limit, state=state)
    return [c[4] for c in ohlcv]


def ohlcv_market_features(ohlcv):
    closes = [c[4] for c in ohlcv]
    highs = [c[2] for c in ohlcv]
    lows = [c[3] for c in ohlcv]
    vols = [c[5] for c in ohlcv]
    if not closes:
        return {
            "closes": [], "highs": [], "lows": [], "volumes": [],
            "vwap_20": None, "vol_ratio": 1.0, "trendline_bias": 0.0,
        }

    w = min(20, len(closes))
    pv = 0.0
    vv = 0.0
    for i in range(-w, 0):
        tp = (highs[i] + lows[i] + closes[i]) / 3.0
        v = max(0.0, float(vols[i]))
        pv += tp * v
        vv += v
    vwap_20 = (pv / vv) if vv > 0 else closes[-1]

    vol_w = vols[-w:] if w > 0 else vols
    cur_v = float(vol_w[-1]) if vol_w else 0.0
    avg_v = (sum(float(x) for x in vol_w[:-1]) / max(1, len(vol_w) - 1)) if len(vol_w) > 1 else cur_v
    vol_ratio = (cur_v / avg_v) if avg_v > 0 else 1.0

    # Trendline proxy: positive when higher lows + higher highs over last 10 bars
    k = min(10, len(closes))
    hh = highs[-k:]
    ll = lows[-k:]
    trendline_bias = 0.0
    if len(hh) >= 4:
        upper_slope = (hh[-1] - hh[0]) / max(abs(hh[0]), 1e-9)
        lower_slope = (ll[-1] - ll[0]) / max(abs(ll[0]), 1e-9)
        trendline_bias = (upper_slope + lower_slope) / 2.0

    return {
        "closes": closes,
        "highs": highs,
        "lows": lows,
        "volumes": vols,
        "vwap_20": vwap_20,
        "vol_ratio": vol_ratio,
        "trendline_bias": trendline_bias,
    }


def orderbook_features(exchange, symbol, state=None):
    try:
        if state is not None and exchange_provider_id(exchange) == "ccxt":
            inc_api_counter(state, "ccxt", 1)
            inc_api_endpoint_counter(state, "ccxt:fetch_order_book", 1)
        ob = exchange.fetch_order_book(symbol, limit=20)
        bids = ob.get("bids") or []
        asks = ob.get("asks") or []
        best_bid = float(bids[0][0]) if bids else None
        best_ask = float(asks[0][0]) if asks else None
        bid_sz = sum(float(b[1]) for b in bids[:10]) if bids else 0.0
        ask_sz = sum(float(a[1]) for a in asks[:10]) if asks else 0.0
        denom = max(1e-9, (bid_sz + ask_sz))
        imbalance = (bid_sz - ask_sz) / denom
        spread_bps = None
        if best_bid and best_ask and best_ask > 0:
            spread_bps = ((best_ask - best_bid) / best_ask) * 10000.0
        return {
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread_bps": spread_bps,
            "ob_imbalance": imbalance,
            "bid_size_top10": bid_sz,
            "ask_size_top10": ask_sz,
        }
    except Exception:
        return {
            "best_bid": None,
            "best_ask": None,
            "spread_bps": None,
            "ob_imbalance": 0.0,
            "bid_size_top10": 0.0,
            "ask_size_top10": 0.0,
        }


def sma(values, n):
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def signal_from_sma(closes, fast_n, slow_n):
    fast = sma(closes, fast_n)
    slow = sma(closes, slow_n)
    if fast is None or slow is None:
        return "hold"
    if fast > slow:
        return "long"
    if fast < slow:
        return "flat"
    return "hold"


def signal_from_momentum(closes, lookback=12, threshold=0.0003):
    if len(closes) <= lookback:
        return "hold"
    ret = (closes[-1] / closes[-1 - lookback]) - 1
    if ret > threshold:
        return "long"
    if ret < -threshold:
        return "flat"
    return "hold"


def signal_from_mean_reversion(closes, window=20, z_threshold=0.85):
    if len(closes) < window:
        return "hold"
    w = closes[-window:]
    mu = sum(w) / len(w)
    var = sum((x - mu) ** 2 for x in w) / len(w)
    sd = var ** 0.5
    if sd == 0:
        return "hold"
    z = (closes[-1] - mu) / sd
    if z < -z_threshold:
        return "long"
    if z > z_threshold:
        return "flat"
    return "hold"


def weighted_ensemble_signal(signals, scores, disabled=None):
    disabled = set(disabled or [])
    long_w = 0.0
    flat_w = 0.0
    for name, sig in signals.items():
        if name in disabled:
            continue
        w = max(0.1, 1.0 + float(scores.get(name, 0.0)))
        if sig == "long":
            long_w += w
        elif sig == "flat":
            flat_w += w
    if long_w > flat_w:
        return "long"
    if flat_w > long_w:
        return "flat"
    return "hold"


def signal_confidence(signals, scores, disabled=None):
    disabled = set(disabled or [])
    long_w = 0.0
    flat_w = 0.0
    for name, sig in signals.items():
        if name in disabled:
            continue
        w = max(0.1, 1.0 + float(scores.get(name, 0.0)))
        if sig == "long":
            long_w += w
        elif sig == "flat":
            flat_w += w
    return abs(long_w - flat_w)


def build_dynamic_watchlist_alpaca(exchange, scanner_cfg=None, max_watch=12, include_snapshot=False, scan_type="runner_scan"):
    dcfg = (scanner_cfg or {}).get("dynamic_filters", {}) if isinstance(scanner_cfg, dict) else {}
    rcfg = (scanner_cfg or {}).get("runner_scan", {}) if isinstance(scanner_cfg, dict) else {}
    scan_cfg = rcfg if isinstance(rcfg, dict) and rcfg else dcfg
    min_price = float(scan_cfg.get("min_price", dcfg.get("min_price", 0.0)))
    max_price = float(scan_cfg.get("max_price", dcfg.get("max_price", 1e12)))
    min_dollar_volume_20 = float(scan_cfg.get("min_dollar_volume_20", dcfg.get("min_dollar_volume_20", 0.0)))
    min_volume_20 = float(scan_cfg.get("min_volume_20", dcfg.get("min_volume_20", 0.0)))
    max_volume_20 = float(scan_cfg.get("max_volume_20", dcfg.get("max_volume_20", 1e18)))
    volume_filter_mode = str(scan_cfg.get("volume_filter_mode", dcfg.get("volume_filter_mode", "hard"))).lower()
    min_abs_ret_15 = float(scan_cfg.get("min_abs_ret_15", dcfg.get("min_abs_ret_15", 0.0)))
    min_change_pct_10_bars = float(scan_cfg.get("min_change_pct_10_bars", dcfg.get("min_change_pct_10_bars", 0.0)))
    min_range_20 = float(scan_cfg.get("min_range_20", dcfg.get("min_range_20", 0.0)))
    max_spread_bps = float(scan_cfg.get("max_spread_bps", dcfg.get("max_spread_bps", 1e9)))
    min_today_volume = float(scan_cfg.get("min_today_volume", 0.0))
    min_day_change_pct = float(scan_cfg.get("min_day_change_pct", 0.0))

    max_watch = int(scan_cfg.get("max_watch", max_watch))
    max_universe = int(scan_cfg.get("max_universe", (scanner_cfg or {}).get("dynamic_max_universe", 600)))
    max_intraday_checks = int(scan_cfg.get("max_intraday_checks", (scanner_cfg or {}).get("dynamic_max_intraday_checks", 300)))

    exch_mode = str((scanner_cfg or {}).get("dynamic_exchange", "nasdaq")).lower()
    if exch_mode in ("us", "all_us", "nyse_nasdaq") and hasattr(exchange, "list_us_symbols"):
        syms = exchange.list_us_symbols(exchange_mode="us")[:max_universe]
    else:
        syms = exchange.list_nasdaq_symbols()[:max_universe]
    snaps = exchange.fetch_snapshots(syms)

    candidates = []
    reason_counts = {
        "min_price": 0,
        "max_price": 0,
        "max_volume": 0,
        "min_today_volume": 0,
        "min_day_change_pct": 0,
        "min_volume_20": 0,
        "min_dollar_volume_20": 0,
        "min_range_20": 0,
        "max_spread_bps": 0,
        "min_change_pct_10_bars": 0,
        "min_abs_ret_15": 0,
    }
    for s in syms:
        snap = snaps.get(s) or {}
        lt = snap.get("latestTrade") or {}
        lq = snap.get("latestQuote") or {}
        db = snap.get("dailyBar") or {}
        pb = snap.get("prevDailyBar") or {}

        px = float(lt.get("p") or db.get("c") or 0.0)
        if px <= 0:
            continue
        prev_c = float(pb.get("c") or 0.0)
        day_ret = ((px / prev_c) - 1.0) if prev_c > 0 else 0.0
        hi = float(db.get("h") or px)
        lo = float(db.get("l") or px)
        range_20 = abs((hi - lo) / max(px, 1e-9))
        vol = float(db.get("v") or 0.0)
        dollar_vol_20 = vol * px
        day_change_pct = ((px / prev_c) - 1.0) if prev_c > 0 else 0.0

        bid = float(lq.get("bp") or 0.0)
        ask = float(lq.get("ap") or 0.0)
        spread_bps = None
        if bid > 0 and ask > 0 and ask >= bid:
            spread_bps = ((ask - bid) / ask) * 10000.0

        if px < min_price:
            reason_counts["min_price"] += 1
            continue
        if px > max_price:
            reason_counts["max_price"] += 1
            continue
        if vol > max_volume_20:
            reason_counts["max_volume"] += 1
            continue
        if min_today_volume > 0 and vol < min_today_volume:
            reason_counts["min_today_volume"] += 1
            continue
        if min_day_change_pct > 0 and day_change_pct < min_day_change_pct:
            reason_counts["min_day_change_pct"] += 1
            continue
        vol_soft_penalty = 0.0
        if vol < min_volume_20:
            if volume_filter_mode == "soft":
                # Keep symbol eligible but down-rank thin tape instead of hard reject.
                miss = (min_volume_20 - vol) / max(min_volume_20, 1.0)
                vol_soft_penalty += min(2500.0, miss * 1200.0)
            else:
                reason_counts["min_volume_20"] += 1
                continue
        if min_dollar_volume_20 > 0 and dollar_vol_20 < min_dollar_volume_20:
            if volume_filter_mode == "soft":
                miss = (min_dollar_volume_20 - dollar_vol_20) / max(min_dollar_volume_20, 1.0)
                vol_soft_penalty += min(2500.0, miss * 1200.0)
            else:
                reason_counts["min_dollar_volume_20"] += 1
                continue
        if range_20 < min_range_20:
            reason_counts["min_range_20"] += 1
            continue
        if spread_bps is not None and spread_bps > max_spread_bps:
            reason_counts["max_spread_bps"] += 1
            continue

        candidates.append({
            "symbol": s,
            "px": px,
            "day_ret": day_ret,
            "day_change_pct": day_change_pct,
            "range_20": range_20,
            "today_vol": vol,
            "dollar_vol_20": dollar_vol_20,
            "spread_bps": spread_bps,
            "pre_score": ((max(0.0, day_change_pct) * 12000.0) + range_20 * 5000.0 + min(250.0, math.log10(max(1.0, dollar_vol_20)) * 25.0)) - vol_soft_penalty,
            "screen_reason": f"chg={day_change_pct:.2%} vol={int(vol):,}" if day_change_pct > 0 else f"vol={int(vol):,}",
        })

    candidates.sort(key=lambda x: x["pre_score"], reverse=True)
    to_check = candidates[:max(1, max_intraday_checks)]

    minute_bar_map = {}
    if min_change_pct_10_bars > 0 and to_check:
        symbols_to_check = [c["symbol"] for c in to_check]
        try:
            if hasattr(exchange, "fetch_minute_bars"):
                minute_bar_map = exchange.fetch_minute_bars(symbols_to_check, limit=11) or {}
        except Exception:
            minute_bar_map = {}

    ranked = []
    for c in to_check:
        s = c["symbol"]
        px = float(c["px"])
        day_ret = float(c["day_ret"])
        range_20 = float(c["range_20"])
        dollar_vol_20 = float(c["dollar_vol_20"])
        spread_bps = c.get("spread_bps")

        chg10 = None
        if min_change_pct_10_bars > 0:
            bars_m = minute_bar_map.get(s) or []
            if not bars_m and hasattr(exchange, "fetch_recent_minute_bars"):
                try:
                    bars_m = exchange.fetch_recent_minute_bars(s, limit=11)
                except Exception:
                    bars_m = []
            c10 = float((bars_m[-11] or {}).get("c") or 0.0) if (isinstance(bars_m, list) and len(bars_m) >= 11) else 0.0
            chg10 = ((px / c10) - 1.0) if c10 > 0 else None
            if chg10 is None or chg10 < min_change_pct_10_bars:
                reason_counts["min_change_pct_10_bars"] += 1
                continue
        elif abs(day_ret) < min_abs_ret_15:
            reason_counts["min_abs_ret_15"] += 1
            continue

        # Keep ranking light for now; selection is handled by the scan gates above.
        score = 1.0
        signal = "long" if day_ret > 0 else ("flat" if day_ret < 0 else "hold")
        ranked.append({
            "symbol": s,
            "score": round(float(score), 4),
            "signal": signal,
            "regime": "trend" if abs(day_ret) > 0.004 else "chop",
            "vol": 0.0,
            "trend": round(abs(float(day_ret)), 6),
            "ret15": round(float(day_ret), 6),
            "day_change_pct": round(float(c.get("day_change_pct", day_ret)), 6),
            "chg10": None if chg10 is None else round(float(chg10), 6),
            "chg10_basis": "1m" if chg10 is not None else None,
            "range20": round(float(range_20), 6),
            "today_vol": float(c.get("today_vol", 0.0)),
            "vol_ratio": 1.0,
            "px": round(float(px), 6),
            "dollar_vol_20": round(float(dollar_vol_20), 2),
            "spread_bps": None if spread_bps is None else round(float(spread_bps), 3),
            "screen_reason": c.get("screen_reason"),
        })

    ranked.sort(key=lambda x: x["score"], reverse=True)
    max_watch = max(1, int(max_watch))
    watched = []
    seen = set()
    for row in ranked:
        sym = row["symbol"]
        if sym in seen:
            continue
        watched.append(sym)
        seen.add(sym)
        if len(watched) >= max_watch:
            break
    if len(watched) < max_watch:
        for row in candidates:
            sym = row["symbol"]
            if sym in seen:
                continue
            watched.append(sym)
            seen.add(sym)
            if len(watched) >= max_watch:
                break
    if include_snapshot:
        snapshot = {
            "scan_type": scan_type,
            "asset_class": "stock",
            "source": exch_mode,
            "generated_at": now_utc().isoformat(),
            "scan_params": {
                "dynamic_source": (scanner_cfg or {}).get("dynamic_source"),
                "dynamic_exchange": (scanner_cfg or {}).get("dynamic_exchange"),
                "dynamic_max_universe": (scanner_cfg or {}).get("dynamic_max_universe"),
                "dynamic_max_intraday_checks": (scanner_cfg or {}).get("dynamic_max_intraday_checks"),
                "runner_scan": rcfg,
            },
            "universe_size": len(syms),
            "prefilter_candidates": len(candidates),
            "ranked_candidates": len(ranked),
            "selected_count": len(watched),
            "thresholds": {
                "min_price": min_price,
                "max_price": max_price,
                "min_dollar_volume_20": min_dollar_volume_20,
                "min_volume_20": min_volume_20,
                "max_volume_20": max_volume_20,
                "min_abs_ret_15": min_abs_ret_15,
                "min_change_pct_10_bars": min_change_pct_10_bars,
                "min_range_20": min_range_20,
                "max_spread_bps": max_spread_bps,
                "min_today_volume": min_today_volume,
                "min_day_change_pct": min_day_change_pct,
            },
            "reason_counts": reason_counts,
            "scan_candidates": candidates,
            "ranked_candidates": ranked,
            "selected_symbols": watched,
        }
        return watched, ranked, snapshot
    return watched, ranked


def build_dynamic_watchlist(exchange, symbols, timeframe, strategy_scores, disabled_strategies, state=None, max_watch=5, scanner_cfg=None):
    ranked = []
    ranked_all = []
    dcfg = (scanner_cfg or {}).get("dynamic_filters", {}) if isinstance(scanner_cfg, dict) else {}
    allow_fallback = bool((scanner_cfg or {}).get("allow_fallback", True)) if isinstance(scanner_cfg, dict) else True
    exclude_symbols = set((scanner_cfg or {}).get("exclude_symbols", []) or []) if isinstance(scanner_cfg, dict) else set()
    min_price = float(dcfg.get("min_price", 0.0))
    max_price = float(dcfg.get("max_price", 1e12))
    min_dollar_volume_20 = float(dcfg.get("min_dollar_volume_20", 0.0))
    min_abs_ret_15 = float(dcfg.get("min_abs_ret_15", 0.0))
    min_range_20 = float(dcfg.get("min_range_20", 0.0))
    max_spread_bps = float(dcfg.get("max_spread_bps", 1e9))

    for s in symbols:
        ss = str(s)
        if ss in exclude_symbols:
            continue
        # Optional hygiene: skip wrapped/staked-style synthetic tickers often illiquid for this strategy
        if any(tok in ss for tok in ("MSOL", "CBETH", "WIF", "FLOKI")) and ss not in exclude_symbols:
            continue
        try:
            ohlcv = get_ohlcv_series(exchange, s, timeframe, limit=120, state=state)
            mf = ohlcv_market_features(ohlcv)
            closes = mf["closes"]
            if not closes:
                continue
            px = float(closes[-1])
            sigs = {
                "sma": signal_from_sma(closes, 9, 21),
                "mom": signal_from_momentum(closes, lookback=12, threshold=0.0003),
                "mr": signal_from_mean_reversion(closes, window=20, z_threshold=0.85),
            }
            conf = signal_confidence(sigs, strategy_scores, disabled=disabled_strategies)
            regime, vol, trend = detect_regime(closes)
            mctx = market_context(closes)

            vols = mf.get("volumes") or []
            w = vols[-20:] if len(vols) >= 20 else vols
            avg_vol_20 = (sum(float(v) for v in w) / len(w)) if w else 0.0
            dollar_vol_20 = avg_vol_20 * px
            abs_ret_15 = abs(float(mctx.get("ret_15") or 0.0))
            range_20 = abs(float(mctx.get("range_20") or 0.0))

            spread_bps = None
            try:
                ob = exchange.fetch_order_book(s, limit=20)
                bids = ob.get("bids") or []
                asks = ob.get("asks") or []
                if bids and asks and float(asks[0][0]) > 0:
                    spread_bps = ((float(asks[0][0]) - float(bids[0][0])) / float(asks[0][0])) * 10000.0
            except Exception:
                spread_bps = None

            move_score = abs_ret_15 * 10000.0
            range_score = range_20 * 10000.0
            vol_ratio = float(mf.get("vol_ratio") or 1.0)
            trend_score = abs(float(trend or 0.0)) * 10000.0
            dv_score = min(200.0, (dollar_vol_20 / max(1.0, min_dollar_volume_20)) * 25.0) if min_dollar_volume_20 > 0 else 0.0
            score = (0.30 * move_score) + (0.20 * range_score) + (0.20 * max(0.0, vol_ratio - 1.0) * 100.0) + (0.15 * trend_score) + (0.10 * conf) + (0.05 * dv_score)

            row = {
                "symbol": s,
                "score": round(float(score), 4),
                "signal": weighted_ensemble_signal(sigs, strategy_scores, disabled=disabled_strategies),
                "regime": regime,
                "vol": round(float(vol), 6),
                "trend": round(float(trend), 6),
                "ret15": round(float(mctx.get("ret_15") or 0.0), 6),
                "range20": round(float(mctx.get("range_20") or 0.0), 6),
                "vol_ratio": round(float(vol_ratio), 3),
                "px": round(float(px), 6),
                "dollar_vol_20": round(float(dollar_vol_20), 2),
                "spread_bps": None if spread_bps is None else round(float(spread_bps), 3),
            }
            ranked_all.append(row)

            if px < min_price or px > max_price:
                continue
            if dollar_vol_20 < min_dollar_volume_20:
                continue
            if abs_ret_15 < min_abs_ret_15:
                continue
            if range_20 < min_range_20:
                continue
            if spread_bps is not None and spread_bps > max_spread_bps:
                continue

            ranked.append(dict(row))
        except Exception:
            continue
    ranked.sort(key=lambda x: x["score"], reverse=True)
    ranked_all.sort(key=lambda x: x["score"], reverse=True)
    source = ranked if (ranked or not allow_fallback) else ranked_all
    watched = [r["symbol"] for r in source[:max(1, int(max_watch))]]
    return watched, source


# ─── MORNING SCAN ────────────────────────────────────────────────────────────

def ensure_morning_scan_state(state):
    """Ensure morning scan state keys exist (safe for old state files)."""
    if not isinstance(state.get("morning_scan_symbols"), list):
        state["morning_scan_symbols"] = []
    if not isinstance(state.get("morning_scan_ranked"), list):
        state["morning_scan_ranked"] = []
    if "morning_scan_date" not in state:
        state["morning_scan_date"] = ""
    if "morning_scan_ts" not in state:
        state["morning_scan_ts"] = 0


def ensure_key_levels_state(state):
    """Ensure key levels state keys exist (safe for old state files)."""
    if not isinstance(state.get("key_levels_by_symbol"), dict):
        state["key_levels_by_symbol"] = {}
    if "key_levels_updated_date" not in state:
        state["key_levels_updated_date"] = ""


def compute_atr(ohlcv, period=14):
    """Average True Range from OHLCV list [[ts,o,h,l,c,v], ...]."""
    if len(ohlcv) < 2:
        return 0.0
    trs = []
    for i in range(1, len(ohlcv)):
        h = float(ohlcv[i][2])
        l = float(ohlcv[i][3])
        prev_c = float(ohlcv[i - 1][4])
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    n = min(period, len(trs))
    return sum(trs[-n:]) / n if n > 0 else 0.0


def fetch_premarket_bars_alpaca(exchange, symbols, date_str=None, state=None):
    """
    Fetch pre-market minute bars for today (4:00 AM – 9:29 AM ET).
    Returns dict: symbol -> list of bar dicts.
    """
    if not isinstance(exchange, AlpacaAdapter):
        return {}
    if not date_str:
        date_str = day_str_local()
    # Build pre-market window with correct ET offset (EST=-05:00 / EDT=-04:00) so the
    # window stays accurate year-round across DST transitions.
    try:
        _et_tz = ZoneInfo("America/New_York")
        _y, _m, _d = int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10])
        _start_dt = datetime(_y, _m, _d, 4, 0, 0, tzinfo=_et_tz)
        _end_dt = datetime(_y, _m, _d, 9, 29, 0, tzinfo=_et_tz)
        start = _start_dt.isoformat()
        end = _end_dt.isoformat()
    except Exception:
        # Fallback to correct ET offset based on DST (EDT=-04:00 / EST=-05:00)
        # March-November uses EDT (UTC-4), November-March uses EST (UTC-5)
        # Check if date is in DST: second Sunday of March through first Sunday of November
        try:
            _y, _m, _d = int(date_str[:4]), int(date_str[5:7]), int(date_str[8:10])
            if 3 < _m < 11 or (_m == 3 and _d >= 8) or (_m == 11 and _d <= 7):
                _offset = "-04:00"  # EDT
            else:
                _offset = "-05:00"  # EST
        except Exception:
            _offset = "-05:00"  # Default to EST if parsing fails
        start = f"{date_str}T04:00:00{_offset}"
        end = f"{date_str}T09:29:00{_offset}"
    headers = {"APCA-API-KEY-ID": exchange.key, "APCA-API-SECRET-KEY": exchange.secret}
    syms = [str(s).upper() for s in (symbols or []) if s]
    out = {}
    chunk = 100
    for i in range(0, len(syms), chunk):
        part = syms[i:i + chunk]
        params = f"symbols={','.join(part)}&timeframe=1Min&start={start}&end={end}&feed=iex"
        url = f"{exchange.data_base}/v2/stocks/bars?{params}"
        try:
            obj = http_json(url, headers=headers, state=state, provider="alpaca", endpoint_label="bars_premarket")
            bars = obj.get("bars") if isinstance(obj, dict) else None
            if isinstance(bars, dict):
                out.update(bars)
        except Exception:
            pass
    return out


def build_morning_scan_alpaca(exchange, scanner_cfg, max_watch=10, state=None, include_snapshot=False, scan_type="morning_scan"):
    """
    One-time morning scan: scores US stocks on overnight gap, relative volume,
    14-day ATR, and momentum direction. Runs once per trading day at startup.
    Ranking factors (configurable via scanner.morning_scan):
      - gap_pct:  overnight gap (today open vs prev close)
      - rel_vol:  relative volume (today vs prev day volume)
      - atr_pct:  ATR as % of price (tradeable range)
      - momentum: directional clarity of the gap
    Returns (watched_list, ranked_list).
    """
    ms_cfg = (scanner_cfg or {}).get("morning_scan", {}) if isinstance(scanner_cfg, dict) else {}
    min_gap_pct = float(ms_cfg.get("min_gap_pct", 0.0))
    min_rel_vol = float(ms_cfg.get("min_rel_volume", 0.3))
    min_atr_pct = float(ms_cfg.get("min_atr_pct", 0.003))
    fetch_pm = bool(ms_cfg.get("fetch_premarket", True))

    dcfg = (scanner_cfg or {}).get("dynamic_filters", {}) if isinstance(scanner_cfg, dict) else {}
    min_price = float(dcfg.get("min_price", 0.5))
    max_price = float(dcfg.get("max_price", 5000.0))
    min_volume_20 = float(dcfg.get("min_volume_20", 50000.0))
    max_volume_20 = float(dcfg.get("max_volume_20", 1e18))
    max_spread_bps = float(dcfg.get("max_spread_bps", 250.0))
    max_universe = int((scanner_cfg or {}).get("dynamic_max_universe", 3200))
    exch_mode = str((scanner_cfg or {}).get("dynamic_exchange", "us")).lower()

    if exch_mode in ("us", "all_us", "nyse_nasdaq") and hasattr(exchange, "list_us_symbols"):
        syms = exchange.list_us_symbols(exchange_mode="us")[:max_universe]
    else:
        syms = exchange.list_nasdaq_symbols()[:max_universe]

    snaps = exchange.fetch_snapshots(syms)

    candidates = []
    for s in syms:
        snap = snaps.get(s) or {}
        lt = snap.get("latestTrade") or {}
        lq = snap.get("latestQuote") or {}
        db = snap.get("dailyBar") or {}
        pb = snap.get("prevDailyBar") or {}

        px = float(lt.get("p") or db.get("c") or 0.0)
        if px <= 0 or px < min_price or px > max_price:
            continue

        prev_c = float(pb.get("c") or 0.0)
        today_o = float(db.get("o") or px)
        gap_pct = ((today_o / prev_c) - 1.0) if prev_c > 0 else 0.0

        today_vol = float(db.get("v") or 0.0)
        prev_vol = float(pb.get("v") or 0.0)
        rel_vol = (today_vol / prev_vol) if prev_vol > 0 else 1.0

        if today_vol > max_volume_20:
            continue
        if today_vol < (min_volume_20 * 0.05):  # very loose pre-filter to keep scan fast
            continue

        hi = float(db.get("h") or px)
        lo = float(db.get("l") or px)
        range_pct = (hi - lo) / max(px, 1e-9)

        bid = float(lq.get("bp") or 0.0)
        ask = float(lq.get("ap") or 0.0)
        spread_bps = None
        if bid > 0 and ask > 0 and ask >= bid:
            spread_bps = ((ask - bid) / ask) * 10000.0
        if spread_bps is not None and spread_bps > max_spread_bps:
            continue

        signal = "long" if gap_pct > 0 else ("flat" if gap_pct < 0 else "hold")
        # 2026-03-27: add rvol_boost so high-volume intraday runners (e.g. SST 1152x,
        # ARTL/GVH) compete with gap plays even when overnight gap is small.
        # A stock with 10x relative volume earns +3600 pts; 25x earns +9600 pts.
        rvol_boost = min(10000.0, max(0.0, rel_vol - 1.0) * 400.0)
        pre_score = abs(gap_pct) * 8000.0 + rel_vol * 200.0 + range_pct * 3000.0 + rvol_boost
        candidates.append({
            "symbol": s,
            "px": px,
            "gap_pct": gap_pct,
            "rel_vol": rel_vol,
            "range_pct": range_pct,
            "today_vol": today_vol,
            "prev_vol": prev_vol,
            "spread_bps": spread_bps,
            "signal": signal,
            "pre_score": pre_score,
        })

    candidates.sort(key=lambda x: x["pre_score"], reverse=True)
    max_deep = int((scanner_cfg or {}).get("dynamic_max_intraday_checks", 300))
    deep_pool = candidates[:max(1, max_deep)]
    deep_syms = [c["symbol"] for c in deep_pool]

    # Fetch daily bars for ATR computation (14-day)
    daily_bars = {}
    try:
        daily_bars = exchange.fetch_daily_bars(deep_syms, limit=16)
    except Exception:
        pass

    # Fetch pre-market bars for PM high/low
    pm_bars_by_sym = {}
    if fetch_pm:
        try:
            pm_bars_by_sym = fetch_premarket_bars_alpaca(exchange, deep_syms[:200], state=state)
        except Exception:
            pass

    ranked = []
    for c in deep_pool:
        s = c["symbol"]
        px = float(c["px"])
        gap_pct = float(c["gap_pct"])
        rel_vol = float(c["rel_vol"])
        range_pct = float(c["range_pct"])

        bars_list = daily_bars.get(s) or []
        if len(bars_list) >= 2:
            ohlcv_daily = [
                [0, float(b.get("o", 0)), float(b.get("h", 0)), float(b.get("l", 0)),
                 float(b.get("c", 0)), float(b.get("v", 0))]
                for b in bars_list
            ]
            atr = compute_atr(ohlcv_daily, period=14)
            atr_pct = atr / max(px, 1e-9)
        else:
            atr_pct = range_pct  # fall back to today's range

        # Skip if both gap and relative volume are below minimums
        if rel_vol < min_rel_vol and abs(gap_pct) < min_gap_pct:
            continue
        if atr_pct < min_atr_pct:
            continue

        pm_bars = pm_bars_by_sym.get(s) or []
        pm_hs = [float(b.get("h", 0)) for b in pm_bars if float(b.get("h", 0)) > 0]
        pm_ls = [float(b.get("l", 0)) for b in pm_bars if float(b.get("l", 0)) > 0]
        pm_high = max(pm_hs) if pm_hs else None
        pm_low = min(pm_ls) if pm_ls else None

        # Composite morning-scan score
        # 2026-03-27: raised rvol_score cap from 500 → 4000 so extreme-volume runners
        # (e.g. SST 1152x, ARTL/GVH) rank near the top alongside large-gap plays.
        # Old cap of 500 meant a 1000x-volume stock earned the same as a 4x-volume
        # stock — making the entire rvol dimension nearly meaningless for top ranking.
        gap_score = abs(gap_pct) * 10000.0          # overnight gap magnitude
        rvol_score = min(4000.0, rel_vol * 120.0)    # was min(500.0,...); higher cap rewards extreme volume
        atr_score = atr_pct * 8000.0                 # ATR = tradeable range
        mom_score = abs(gap_pct) * 2000.0 if abs(gap_pct) >= 0.005 else 0.0  # directional momentum bonus
        score = gap_score + rvol_score + atr_score + mom_score

        ranked.append({
            "symbol": s,
            "score": round(float(score), 4),
            "signal": c["signal"],
            "gap_pct": round(float(gap_pct), 6),
            "rel_vol": round(float(rel_vol), 4),
            "atr_pct": round(float(atr_pct), 6),
            "range_pct": round(float(range_pct), 6),
            "px": round(float(px), 6),
            "today_vol": round(float(c["today_vol"]), 0),
            "spread_bps": None if c.get("spread_bps") is None else round(float(c["spread_bps"]), 3),
            "pm_high": pm_high,
            "pm_low": pm_low,
            "regime": "trend" if abs(gap_pct) > 0.004 else "chop",
        })

    ranked.sort(key=lambda x: x["score"], reverse=True)
    watched = [r["symbol"] for r in ranked[:max(1, int(max_watch))]]
    if include_snapshot:
        snapshot = {
            "scan_type": scan_type,
            "asset_class": "stock",
            "source": exch_mode,
            "generated_at": now_utc().isoformat(),
            "scan_params": {
                "dynamic_source": (scanner_cfg or {}).get("dynamic_source"),
                "dynamic_exchange": (scanner_cfg or {}).get("dynamic_exchange"),
                "dynamic_max_universe": (scanner_cfg or {}).get("dynamic_max_universe"),
                "dynamic_max_intraday_checks": (scanner_cfg or {}).get("dynamic_max_intraday_checks"),
                "morning_scan": ms_cfg,
            },
            "universe_size": len(syms),
            "prefilter_candidates": len(candidates),
            "ranked_candidates": len(ranked),
            "selected_count": len(watched),
            "thresholds": {
                "min_gap_pct": min_gap_pct,
                "min_rel_volume": min_rel_vol,
                "min_atr_pct": min_atr_pct,
                "min_price": min_price,
                "max_price": max_price,
                "min_volume_20": min_volume_20,
                "max_volume_20": max_volume_20,
                "max_spread_bps": max_spread_bps,
                "fetch_premarket": fetch_pm,
            },
            "reason_counts": {},
            "scan_candidates": candidates,
            "ranked_candidates": ranked,
            "selected_symbols": watched,
        }
        return watched, ranked, snapshot
    return watched, ranked


def build_morning_scan_generic(exchange, symbols, timeframe, state=None, max_watch=10, scanner_cfg=None):
    """
    Morning scan for crypto/forex: rank symbols by gap, 14-day ATR, and relative volume.
    Runs once per day. Returns (watched_list, ranked_list).
    """
    ms_cfg = (scanner_cfg or {}).get("morning_scan", {}) if isinstance(scanner_cfg, dict) else {}
    min_atr_pct = float(ms_cfg.get("min_atr_pct", 0.002))
    dcfg = (scanner_cfg or {}).get("dynamic_filters", {}) if isinstance(scanner_cfg, dict) else {}
    exclude_symbols = set((scanner_cfg or {}).get("exclude_symbols", []) or []) if isinstance(scanner_cfg, dict) else set()

    ranked = []
    for s in symbols:
        if str(s) in exclude_symbols:
            continue
        if any(tok in str(s) for tok in ("MSOL", "CBETH", "WIF", "FLOKI")):
            continue
        try:
            ohlcv = get_ohlcv_series(exchange, s, timeframe, limit=50, state=state)
            if len(ohlcv) < 3:
                continue
            closes = [float(c[4]) for c in ohlcv]
            px = closes[-1]
            if px <= 0:
                continue
            # Use 1h bars to compute 24h price change (crypto has no overnight gap;
            # closes[-1] is current price, closes[-25] is ~24h ago at 1h resolution).
            try:
                ohlcv_1h = get_ohlcv_series(exchange, s, "1h", limit=50, state=state)
                if len(ohlcv_1h) >= 25:
                    c1h = [float(c[4]) for c in ohlcv_1h]
                    gap_pct = (c1h[-1] / c1h[-25]) - 1.0 if c1h[-25] > 0 else 0.0
                else:
                    gap_pct = (closes[-1] / closes[-2]) - 1.0 if closes[-2] > 0 else 0.0
            except Exception:
                gap_pct = (closes[-1] / closes[-2]) - 1.0 if closes[-2] > 0 else 0.0
            atr = compute_atr(ohlcv, period=14)
            atr_pct = atr / max(px, 1e-9)
            if atr_pct < min_atr_pct:
                continue
            vols = [float(c[5]) for c in ohlcv]
            cur_vol = vols[-1] if vols else 0.0
            avg_vol = (sum(vols[:-1]) / max(1, len(vols) - 1)) if len(vols) > 1 else cur_vol
            rel_vol = (cur_vol / avg_vol) if avg_vol > 0 else 1.0
            regime, vol, trend = detect_regime(closes)
            signal = "long" if gap_pct > 0 else ("flat" if gap_pct < 0 else "hold")
            score = (
                abs(gap_pct) * 10000.0
                + min(500.0, rel_vol * 120.0)
                + atr_pct * 8000.0
                + abs(float(trend)) * 5000.0
            )
            ranked.append({
                "symbol": s,
                "score": round(float(score), 4),
                "signal": signal,
                "gap_pct": round(float(gap_pct), 6),
                "rel_vol": round(float(rel_vol), 4),
                "atr_pct": round(float(atr_pct), 6),
                "px": round(float(px), 6),
                "regime": regime,
            })
        except Exception:
            continue

    ranked.sort(key=lambda x: x["score"], reverse=True)
    watched = [r["symbol"] for r in ranked[:max(1, int(max_watch))]]
    return watched, ranked


# ─── KEY LEVELS (ANA-STYLE) ──────────────────────────────────────────────────

def compute_pivot_points(high, low, close):
    """Classic floor-trader pivot points: PP, R1, S1, R2, S2."""
    pp = (high + low + close) / 3.0
    r1 = (2 * pp) - low
    s1 = (2 * pp) - high
    r2 = pp + (high - low)
    s2 = pp - (high - low)
    return {
        "PP": round(pp, 8),
        "R1": round(r1, 8),
        "S1": round(s1, 8),
        "R2": round(r2, 8),
        "S2": round(s2, 8),
    }


def compute_key_levels_alpaca(exchange, symbol, state=None):
    """
    Compute key price levels for a stock via Alpaca data.
    Levels returned:
      PDH / PDL        — previous day high/low (classic day-trade key levels)
      PM_HIGH / PM_LOW — pre-market high/low (extended hours today)
      OVERNIGHT_HIGH / OVERNIGHT_LOW — alias for PM high/low
      TODAY_OPEN       — today's regular-hours open
      PP / R1 / S1 / R2 / S2 — classic pivot points (based on prev day H/L/C)
      VWAP             — today's volume-weighted average price (from daily bar)
    Returns dict: level_name -> price
    """
    sym = str(symbol).upper().replace("/", "")
    levels = {}

    try:
        snaps = exchange.fetch_snapshots([sym])
        snap = snaps.get(sym) or {}
        db = snap.get("dailyBar") or {}
        pb = snap.get("prevDailyBar") or {}

        prev_h = float(pb.get("h") or 0.0)
        prev_l = float(pb.get("l") or 0.0)
        prev_c = float(pb.get("c") or 0.0)
        today_o = float(db.get("o") or 0.0)
        today_vwap = float(db.get("vw") or 0.0)

        if prev_h > 0:
            levels["PDH"] = round(prev_h, 4)
        if prev_l > 0:
            levels["PDL"] = round(prev_l, 4)
        if today_o > 0:
            levels["TODAY_OPEN"] = round(today_o, 4)
        if today_vwap > 0:
            levels["VWAP"] = round(today_vwap, 4)
        # Classic pivot points from previous day
        if prev_h > 0 and prev_l > 0 and prev_c > 0:
            pivots = compute_pivot_points(prev_h, prev_l, prev_c)
            for k, v in pivots.items():
                if v > 0:
                    levels[k] = round(float(v), 4)
    except Exception:
        pass

    # Fetch pre-market bars for PM high/low
    try:
        date_str = day_str_local()
        pm_data = fetch_premarket_bars_alpaca(exchange, [sym], date_str=date_str, state=state)
        pm_bars = pm_data.get(sym) or []
        if pm_bars:
            pm_hs = [float(b.get("h", 0)) for b in pm_bars if float(b.get("h", 0)) > 0]
            pm_ls = [float(b.get("l", 0)) for b in pm_bars if float(b.get("l", 0)) > 0]
            if pm_hs:
                levels["PM_HIGH"] = round(max(pm_hs), 4)
                levels["OVERNIGHT_HIGH"] = levels["PM_HIGH"]
            if pm_ls:
                levels["PM_LOW"] = round(min(pm_ls), 4)
                levels["OVERNIGHT_LOW"] = levels["PM_LOW"]
    except Exception:
        pass

    return levels


def compute_key_levels_generic(exchange, symbol, timeframe, state=None):
    """
    Compute key price levels for crypto/forex via OHLCV hourly bars.
    Levels returned:
      PDH / PDL            — prior 24h session high/low
      PP / R1 / S1 / R2 / S2 — pivot points from prior session
      VWAP                 — VWAP of current 24h session
      SESSION_HIGH / SESSION_LOW — current session extremes
    Returns dict: level_name -> price
    """
    levels = {}
    try:
        ohlcv_1h = get_ohlcv_series(exchange, symbol, "1h", limit=50, state=state)
        if len(ohlcv_1h) >= 24:
            prev_session = ohlcv_1h[-48:-24] if len(ohlcv_1h) >= 48 else ohlcv_1h[:-24]
            cur_session = ohlcv_1h[-24:]
            if prev_session:
                prev_h = max(float(b[2]) for b in prev_session)
                prev_l = min(float(b[3]) for b in prev_session)
                prev_c = float(prev_session[-1][4])
                levels["PDH"] = round(prev_h, 8)
                levels["PDL"] = round(prev_l, 8)
                pivots = compute_pivot_points(prev_h, prev_l, prev_c)
                for k, v in pivots.items():
                    levels[k] = round(float(v), 8)
            if cur_session:
                pv, vv = 0.0, 0.0
                for b in cur_session:
                    tp = (float(b[2]) + float(b[3]) + float(b[4])) / 3.0
                    v = max(0.0, float(b[5]))
                    pv += tp * v
                    vv += v
                if vv > 0:
                    levels["VWAP"] = round(pv / vv, 8)
                levels["SESSION_HIGH"] = round(max(float(b[2]) for b in cur_session), 8)
                levels["SESSION_LOW"] = round(min(float(b[3]) for b in cur_session), 8)
    except Exception:
        pass
    return levels


def detect_key_level_break(px, ohlcv, key_levels, kl_cfg):
    """
    Detect a confirmed ANA-style break of a key price level.

    A resistance breakout (→ LONG) is confirmed when:
      - A level that was resistance is now BELOW the current price (price crossed it), AND
      - The level is within proximity_window_pct of current price (nearby break, not ancient), AND
      - The last `confirmation_ticks` candle closes are ALL above level + level_buffer_pct.

    A support breakdown (→ FLAT) is confirmed when:
      - A level that was support is now ABOVE the current price (price broke through it), AND
      - The level is within proximity_window_pct of current price, AND
      - The last `confirmation_ticks` candle closes are ALL below level - level_buffer_pct.

    Returns (level_name, level_price, direction) or (None, None, None).
    direction: 'long' for resistance break, 'flat' for support break.
    """
    if not key_levels or not ohlcv:
        return None, None, None

    buffer_pct = float(kl_cfg.get("level_buffer_pct", 0.001))
    confirm_ticks = max(1, int(kl_cfg.get("confirmation_ticks", 2)))
    proximity_pct = float(kl_cfg.get("proximity_window_pct", 0.02))

    recent_closes = [float(c[4]) for c in ohlcv[-confirm_ticks:]]
    if len(recent_closes) < confirm_ticks:
        return None, None, None

    broken_resistance = []  # (dist, name, lvl) — level now below price
    broken_support = []     # (dist, name, lvl) — level now above price

    for name, lvl_raw in key_levels.items():
        lvl = float(lvl_raw)
        if lvl <= 0:
            continue
        dist_pct = abs(px - lvl) / max(lvl, 1e-9)
        if dist_pct > proximity_pct:
            continue  # level too far from current price; skip

        if lvl < px:
            # Level is below current price → was resistance, now potentially broken
            threshold = lvl * (1.0 + buffer_pct)
            if all(c >= threshold for c in recent_closes):
                broken_resistance.append((dist_pct, name, lvl))
        else:
            # Level is above current price → was support, now potentially broken
            threshold = lvl * (1.0 - buffer_pct)
            if all(c <= threshold for c in recent_closes):
                broken_support.append((dist_pct, name, lvl))

    # Return the nearest confirmed break (resistance takes priority for longs)
    if broken_resistance:
        broken_resistance.sort(key=lambda x: x[0])
        _, name, lvl = broken_resistance[0]
        return name, lvl, "long"
    if broken_support:
        broken_support.sort(key=lambda x: x[0])
        _, name, lvl = broken_support[0]
        return name, lvl, "flat"

    return None, None, None


def simple_volatility(closes, lookback=20):
    if len(closes) < lookback + 1:
        return 0.0
    rs = []
    for i in range(-lookback, 0):
        prev = closes[i - 1]
        cur = closes[i]
        if prev:
            rs.append(abs((cur / prev) - 1.0))
    if not rs:
        return 0.0
    return sum(rs) / len(rs)


def detect_regime(closes):
    vol = simple_volatility(closes, lookback=20)
    trend = abs((sma(closes, 9) or closes[-1]) - (sma(closes, 21) or closes[-1])) / max(closes[-1], 1e-9)
    if vol > 0.004:
        return "chaos", vol, trend
    if trend > 0.0015:
        return "trend", vol, trend
    return "chop", vol, trend


def market_context(closes):
    px = float(closes[-1])

    def ret(n):
        if len(closes) <= n:
            return 0.0
        prev = float(closes[-1 - n])
        if prev == 0:
            return 0.0
        return (px / prev) - 1.0

    w = closes[-20:] if len(closes) >= 20 else closes[:]
    hi = max(w) if w else px
    lo = min(w) if w else px
    r20 = (hi - lo) / max(px, 1e-9)

    return {
        "ret_1": ret(1),
        "ret_3": ret(3),
        "ret_5": ret(5),
        "ret_15": ret(15),
        "sma_9": sma(closes, 9),
        "sma_21": sma(closes, 21),
        "sma_50": sma(closes, 50),
        "range_20": r20,
        "px_vs_sma9": (px / (sma(closes, 9) or px)) - 1.0,
        "px_vs_sma21": (px / (sma(closes, 21) or px)) - 1.0,
        "px_vs_sma50": (px / (sma(closes, 50) or px)) - 1.0,
    }


def detect_setup_type(signals, mctx, regime):
    vol_ratio = float(mctx.get("vol_ratio") or 1.0)
    ob_imb = float(mctx.get("ob_imbalance") or 0.0)
    ret1 = float(mctx.get("ret_1") or 0.0)
    ret3 = float(mctx.get("ret_3") or 0.0)
    trendline = float(mctx.get("trendline_bias") or 0.0)
    px_vs_sma9 = float(mctx.get("px_vs_sma9") or 0.0)

    if signals.get("sma") == "long" and signals.get("mom") in ("long", "hold") and vol_ratio >= 1.1 and ret1 > 0 and ret3 > 0:
        return "breakout_retest", 0.9
    if ret1 > 0 and ret3 < 0 and ob_imb > 0.05 and vol_ratio >= 1.0:
        return "sweep_reclaim", 0.8
    if px_vs_sma9 >= 0 and trendline > 0 and signals.get("mom") in ("long", "hold") and vol_ratio >= 1.0:
        return "vwap_pullback_continuation", 0.75
    if regime == "chop" and vol_ratio >= 0.9 and abs(ret1) < 0.001 and abs(ret3) < 0.002:
        return "range_edge_rejection", 0.65
    return "none", 0.3


def compute_effective_risk_pct(cfg, state, regime):
    r = cfg.get("risk", {})
    base = float(r.get("risk_pct_per_trade", 0.0) or 0.0)
    dyn = r.get("dynamic_risk") or {}
    if not bool(dyn.get("enabled", False)):
        return base, 1.0

    min_mult = float(dyn.get("min_mult", 0.4))
    max_mult = float(dyn.get("max_mult", 1.5))
    mult = 1.0

    win_streak = int(state.get("win_streak", 0) or 0)
    raise_after = int(dyn.get("raise_after_win_streak", 3))
    raise_step = float(dyn.get("raise_step", 0.12))
    if win_streak >= raise_after:
        steps = min(3, (win_streak - raise_after + 1))
        mult *= (1.0 + (raise_step * steps))

    dd_cut_ratio = float(dyn.get("cut_if_dd_ratio", 0.40))
    dd_cut_mult = float(dyn.get("dd_cut_mult", 0.65))
    max_daily_loss = abs(float(r.get("max_daily_loss_usd", 0.0) or 0.0))
    daily_pnl = float(state.get("daily_pnl", 0.0) or 0.0)
    if max_daily_loss > 0 and daily_pnl < 0:
        dd_ratio = abs(daily_pnl) / max_daily_loss
        if dd_ratio >= dd_cut_ratio:
            mult *= dd_cut_mult

    chop_streak = int(state.get("chop_streak", 0) or 0)
    cut_after_chop = int(dyn.get("cut_after_chop_streak", 4))
    chop_cut_mult = float(dyn.get("chop_cut_mult", 0.75))
    if regime == "chop" and chop_streak >= cut_after_chop:
        mult *= chop_cut_mult

    loss_streak = int(state.get("loss_streak", 0) or 0)
    if loss_streak > 0:
        mult *= max(0.4, 1.0 - (0.2 * loss_streak))

    mult = max(min_mult, min(max_mult, mult))
    return (base * mult), mult


def apply_study_rules(cfg):
    path = _data_path("study", "spec", "strategy_rules.v1.json")
    if not os.path.exists(path):
        return cfg, {}
    try:
        with open(path, "r") as _sf:
            spec = json.load(_sf)
    except Exception:
        return cfg, {}

    risk = cfg.setdefault("risk", {})
    scalp = cfg.setdefault("scalp_filters", {})

    r_spec = spec.get("risk", {})
    sess = spec.get("session_controls", {})
    elig = spec.get("market_eligibility", {})

    # Compile key constraints into runtime config
    risk["risk_pct_per_trade"] = float(r_spec.get("risk_pct_per_trade_min", 0.0025))
# DISABLED max_consecutive_losses - commented by assistant
# ORIGINAL:     risk["max_consecutive_losses"] = int(r_spec.get("max_consecutive_losses", 3))
    risk["min_rr"] = float(r_spec.get("min_rr", 1.5))

    daily_loss_pct = r_spec.get("daily_max_loss_pct")
    if daily_loss_pct is not None and risk.get("max_daily_loss_usd") is None:
        # Only set from study rules if the per-config value is absent.
        # daily_loss_pct is a percentage (e.g. 10.0 means 10%), divide by 100 before multiplying.
        start_eq = float(risk.get("starting_equity_usd", 50.0))
        risk["max_daily_loss_usd"] = max(0.01, (float(daily_loss_pct) / 100.0) * start_eq)

    if elig.get("min_relative_volume") is not None and "min_vol_ratio" not in scalp:
        scalp["min_vol_ratio"] = float(elig.get("min_relative_volume"))
    if elig.get("max_spread_bps") is not None and "max_spread_bps" not in scalp:
        scalp["max_spread_bps"] = float(elig.get("max_spread_bps"))

    # Keep the study spec available for reporting, but do not enforce setup-class gating.
    approved_setups = []
    cfg.setdefault("rules_engine", {})["approved_setups"] = approved_setups

    compiled = {
        "rules_file": path,
        "min_rr": risk.get("min_rr"),
        "risk_pct_per_trade": risk.get("risk_pct_per_trade"),
# DISABLED max_consecutive_losses - commented by assistant
# ORIGINAL:         "max_consecutive_losses": risk.get("max_consecutive_losses"),
        "approved_setups": approved_setups,
    }
    return cfg, compiled


def risk_blocked(cfg, state):
    r = cfg["risk"]
    if state["daily_pnl"] <= -abs(float(r["max_daily_loss_usd"])):
        return "daily_loss_cap"
# DISABLED max_consecutive_losses - commented by assistant
# ORIGINAL:     disable_max_ls = bool(r.get("disable_max_consecutive_losses", False))
# DISABLED max_consecutive_losses - commented by assistant
# ORIGINAL:     if (not disable_max_ls) and int(state.get("loss_streak", 0)) >= int(r.get("max_consecutive_losses", 9999)):
# DISABLED max_consecutive_losses - commented by assistant
# ORIGINAL:         return "max_consecutive_losses"
    if os.path.exists(cfg["controls"]["kill_switch_file"]):
        return "kill_switch"
    return None


def calculate_slippage_bps(fill_px, signal_px):
    """Calculate slippage in basis points: (fill_px - signal_px) / signal_px * 10000"""
    if signal_px is None or signal_px <= 0:
        return 0.0
    return round((fill_px - signal_px) / signal_px * 10000, 2)


def live_enter_with_sla_fallback(exchange, state, cfg, symbol, price, notional, side="long", telemetry=None, journal_path=None, market="stocks"):
    """
    Wrapper around live_enter() that implements fast retry/fallback on SLA breach.

    1. Try to submit order (blocking call)
    2. If submission takes > SLA_WINDOWS_MS[market], log as "partial" and retry with simplified path
    3. If retry fails, log as "missed" with reason code

    Returns: (order or None, submission_status)
    """
    sla_ms = SLA_WINDOWS_MS.get(market, 60000)
    submit_start_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    try:
        # Try normal entry path
        order = live_enter(exchange, state, cfg, symbol, price, notional, side=side, telemetry=telemetry, journal_path=journal_path)
        submit_end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        elapsed_ms = submit_end_ms - submit_start_ms

        if elapsed_ms > sla_ms and journal_path:
            # Log as "partial" — entry submitted but after SLA window
            append_journal(journal_path, {
                "type": "sla_partial_entry",
                "symbol": symbol,
                "correlation_id": (telemetry or {}).get("correlation_id"),
                "signal_ts": (telemetry or {}).get("signal_ts"),
                "submit_duration_ms": elapsed_ms,
                "sla_window_ms": sla_ms,
                "order_id": order.get("id") if order else None,
                "status": "submitted_late_but_successful",
            })

        return order, "success"

    except Exception as e:
        submit_end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        elapsed_ms = submit_end_ms - submit_start_ms

        # Retry with exponential backoff if SLA breach
        if elapsed_ms > sla_ms:
            print(f"[yellow]SLA breach on {symbol}:[/yellow] {elapsed_ms}ms > {sla_ms}ms — retrying with fallback")
            for retry_idx, delay_ms in enumerate(RETRY_DELAYS_MS):
                if retry_idx > 0:
                    time.sleep(delay_ms / 1000.0)
                try:
                    order = live_enter(exchange, state, cfg, symbol, price, notional, side=side, telemetry=telemetry, journal_path=journal_path)
                    retry_end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                    if journal_path:
                        append_journal(journal_path, {
                            "type": "sla_retry_success",
                            "symbol": symbol,
                            "correlation_id": (telemetry or {}).get("correlation_id"),
                            "retry_attempt": retry_idx + 1,
                            "retry_delay_ms": delay_ms,
                            "total_elapsed_ms": retry_end_ms - submit_start_ms,
                            "order_id": order.get("id") if order else None,
                        })
                    return order, "retry_success"
                except:
                    continue

        # All retries exhausted
        if journal_path:
            append_journal(journal_path, {
                "type": "sla_retry_exhausted",
                "symbol": symbol,
                "correlation_id": (telemetry or {}).get("correlation_id"),
                "signal_ts": (telemetry or {}).get("signal_ts"),
                "initial_error": str(e)[:200],
                "total_attempts": 1 + len(RETRY_DELAYS_MS),
                "total_elapsed_ms": elapsed_ms,
                "sla_window_ms": sla_ms,
            })

        return None, "retry_exhausted"


def compute_runner_attribution(symbol, state, journal_path=None):
    """
    Compute runner attribution for a symbol: captured | partial | missed.

    captured: symbol received signal AND entry was submitted (trade_open in journal)
    partial: symbol received signal but entry was DELAYED (execution_delay_ms > SLA_WINDOWS_MS for market)
    missed: symbol received signal but entry was REJECTED (filtered, SLA breach, API error, etc.)

    Returns: (attribution_type, skip_reason_lineage)
    """
    if not journal_path:
        return ("unknown", "no_journal")

    try:
        with open(journal_path, "r") as f:
            lines = f.readlines()
    except:
        return ("unknown", "journal_read_error")

    # Scan journal for this symbol's events
    signal_emit_found = False
    trade_open_found = False
    missed_signal_found = False
    skip_reason = None
    execution_delay_ms = 0
    market = "unknown"

    for line in reversed(lines):  # Scan backwards for most recent
        try:
            event = json.loads(line.strip())
        except:
            continue

        evt_sym = event.get("symbol")
        if evt_sym != symbol:
            continue

        evt_type = event.get("type")

        if evt_type == "signal_emit" and not signal_emit_found:
            signal_emit_found = True
            market = event.get("market", "unknown")

        if evt_type == "trade_open" and not trade_open_found:
            trade_open_found = True
            execution_delay_ms = event.get("execution_delay_ms", 0) or 0

        if evt_type == "missed_signal" and not missed_signal_found:
            missed_signal_found = True
            skip_reason = event.get("reason_code") or event.get("skip_reason")

    # Attribution logic
    if trade_open_found:
        # Entry was submitted — check if it was delayed
        sla_ms = SLA_WINDOWS_MS.get(market, 60000)
        if execution_delay_ms > sla_ms:
            return ("partial", f"delayed_entry_ms={execution_delay_ms},sla={sla_ms}")
        else:
            return ("captured", "entry_submitted_within_sla")
    elif missed_signal_found:
        return ("missed", skip_reason or "unknown_rejection")
    elif signal_emit_found:
        return ("missed", "signal_emitted_but_no_entry_attempt")
    else:
        return ("missed", "no_signals_generated")



def paper_enter(state, symbol, price, notional, side="long", signal_price=None):
    qty = notional / price
    side = "short" if str(side).lower() == "short" else "long"

    # Calculate slippage (in paper mode, typically 0 since fill = entry)
    slippage_bps = calculate_slippage_bps(price, signal_price or price)

    pos_record = {
        "side": side,
        "symbol": symbol,
        "entry": price,
        "qty": qty,
        "notional": notional,
        "opened_at": now_utc().isoformat(),
        "entry_order_id": None,
        "slippage_bps": slippage_bps,  # NEW: capture slippage
        "execution_delay_ms": 0,  # Paper execution is instant
    }
    # Multi-position: store in positions dict keyed by symbol
    if not isinstance(state.get("positions"), dict):
        state["positions"] = {}
    state["positions"][symbol] = pos_record
    # Legacy compat: keep state["position"] pointing to this new position
    state["position"] = pos_record
    state["active_symbol"] = symbol
    state["trades_today"] += 1


def paper_exit(state, price, symbol=None):
    # Multi-position: exit by symbol; fall back to state["position"] for compat
    positions = state.get("positions") if isinstance(state.get("positions"), dict) else {}
    pos = None
    if symbol and symbol in positions:
        pos = positions[symbol]
    if pos is None:
        pos = state.get("position")
    if not pos:
        return 0.0
    sym = symbol or pos.get("symbol") or state.get("active_symbol")
    side = str(pos.get("side", "long")).lower()
    if side == "short":
        pnl = (pos["entry"] - price) * pos["qty"]
    else:
        pnl = (price - pos["entry"]) * pos["qty"]
    state["daily_pnl"] += pnl
    state["paper_balance"] += pnl
    # Remove from positions dict
    if sym and sym in positions:
        del positions[sym]
    state["positions"] = positions
    # Update legacy state["position"] for backward compat
    if positions:
        _remaining = next(iter(positions.values()))
        state["position"] = _remaining
        state["active_symbol"] = _remaining.get("symbol")
    else:
        state["position"] = None
        state["active_symbol"] = None
    return pnl


def live_guard(cfg):
    if cfg["mode"] != "live":
        return
    if not cfg.get("execution", {}).get("live_enabled", False):
        raise RuntimeError("Refusing live mode: execution.live_enabled=false")

    ex_id = str(cfg.get("exchange", "")).lower()
    if ex_id == "alpaca":
        if not os.getenv("ALPACA_API_KEY") or not os.getenv("ALPACA_API_SECRET"):
            raise RuntimeError("Refusing live mode: missing ALPACA_API_KEY/ALPACA_API_SECRET")
        return
    if ex_id == "oanda":
        if not os.getenv("OANDA_API_KEY") or not os.getenv("OANDA_ACCOUNT_ID"):
            raise RuntimeError("Refusing live mode: missing OANDA_API_KEY/OANDA_ACCOUNT_ID")
        return

    if not os.getenv("EXCHANGE_API_KEY") or not os.getenv("EXCHANGE_API_SECRET"):
        raise RuntimeError("Refusing live mode: missing EXCHANGE_API_KEY/EXCHANGE_API_SECRET")


def set_leverage_if_supported(exchange, cfg, symbol):
    lev = int(cfg.get("execution", {}).get("leverage", 1))
    try:
        if hasattr(exchange, "set_leverage") and cfg.get("execution", {}).get("market_type") == "swap":
            exchange.set_leverage(lev, symbol)
    except Exception as e:
        print(f"[yellow]Leverage set skipped:[/yellow] {e}")


def live_enter(exchange, state, cfg, symbol, price, notional, side="long", telemetry=None, journal_path=None):
    qty = notional / price
    qty = float(exchange.amount_to_precision(symbol, qty))
    if isinstance(exchange, AlpacaAdapter):
        # Many runner-scan stocks are not fractionable at Alpaca. Whole-share
        # sizing avoids repeated broker rejects while keeping us under notional.
        qty = math.floor(qty)
        if qty <= 0:
            raise RuntimeError(f"computed whole-share qty is 0 for {symbol} at price {price} notional {notional}")
    side = "short" if str(side).lower() == "short" else "long"
    order_side = "sell" if side == "short" else "buy"
    submit_ts = now_utc().isoformat()
    if exchange_provider_id(exchange) == "ccxt":
        inc_api_counter(state, "ccxt", 1)
        inc_api_endpoint_counter(state, f"ccxt:create_order_{order_side}", 1)
    try:
        order = exchange.create_order(symbol, "market", order_side, qty, price=price)
    except Exception as e:
        err_text = str(e)
        # Try to extract broker response body from HTTPError so failures are actionable.
        if isinstance(e, HTTPError):
            try:
                body = e.read().decode("utf-8", errors="ignore")
                if body:
                    err_text = f"{err_text} | {body[:300]}"
            except Exception:
                pass
        code = normalize_api_error_code(e, provider=exchange_provider_id(exchange))
        if journal_path:
            append_journal(journal_path, {
                "type": "order_error",
                "symbol": symbol,
                "side": side,
                "market": cfg.get("market", "unknown"),
                "correlation_id": (telemetry or {}).get("correlation_id"),
                "signal_ts": (telemetry or {}).get("signal_ts"),
                "order_submit_ts": submit_ts,
                "normalized_error_code": code,
                "error": err_text[:400],
            })
        append_error_reflection({
            "type": "order_error",
            "symbol": symbol,
            "side": side,
            "market": cfg.get("market", "unknown"),
            "correlation_id": (telemetry or {}).get("correlation_id"),
            "signal_ts": (telemetry or {}).get("signal_ts"),
            "order_submit_ts": submit_ts,
            "normalized_error_code": code,
            "error": err_text[:400],
        })
        raise RuntimeError(err_text)
    ack_ts = now_utc().isoformat()
    order_status = str(order.get("status") or "").lower()
    try:
        filled_qty = float(order.get("filled_qty") or 0.0)
    except Exception:
        filled_qty = 0.0
    is_filled = (order_status in ("filled", "partially_filled")) or (filled_qty > 0.0)

    # Distinguish submitted-vs-filled. Do not mark position open until filled.
    if not is_filled:
        state.setdefault("pending_orders", {})[str(order.get("id") or f"{symbol}:{submit_ts}")] = {
            "symbol": symbol,
            "side": side,
            "market": cfg.get("market", "unknown"),
            "order_id": order.get("id"),
            "order_status": order_status or "submitted",
            "filled_qty": filled_qty,
            "qty": qty,
            "entry": price,
            "notional": notional,
            "submitted_at": submit_ts,
            "ack_at": ack_ts,
            "correlation_id": (telemetry or {}).get("correlation_id"),
            "signal_ts": (telemetry or {}).get("signal_ts"),
            "quote_snapshot": (telemetry or {}).get("quote_snapshot"),
        }
        state["last_pending_order_id"] = order.get("id")
        state["last_pending_order_symbol"] = symbol
        if journal_path:
            append_journal(journal_path, {
                "type": "order_submitted",
                "symbol": symbol,
                "side": side,
                "market": cfg.get("market", "unknown"),
                "order_id": order.get("id"),
                "order_status": order_status or "submitted",
                "filled_qty": filled_qty,
                "order_submit_ts": submit_ts,
                "order_ack_ts": ack_ts,
                "correlation_id": (telemetry or {}).get("correlation_id"),
                "signal_ts": (telemetry or {}).get("signal_ts"),
            })
        append_fill_reflection({
            "type": "order_submitted",
            "symbol": symbol,
            "side": side,
            "market": cfg.get("market", "unknown"),
            "order_id": order.get("id"),
            "order_status": order_status or "submitted",
            "filled_qty": filled_qty,
            "order_submit_ts": submit_ts,
            "order_ack_ts": ack_ts,
            "correlation_id": (telemetry or {}).get("correlation_id"),
            "signal_ts": (telemetry or {}).get("signal_ts"),
        })
        return order

    # Capture fill price and calculate slippage (use signal_price if available from telemetry)
    fill_price = float(order.get("average") or order.get("filled_avg_price") or order.get("price") or price)
    signal_price = None
    if telemetry and telemetry.get("quote_snapshot"):
        signal_price = telemetry["quote_snapshot"].get("mid_price") or telemetry["quote_snapshot"].get("px")
    if signal_price is None:
        signal_price = price
    slippage_bps = calculate_slippage_bps(fill_price, signal_price)

    pos_record = {
        "side": side,
        "symbol": symbol,
        "entry": price,
        "qty": qty,
        "notional": notional,
        "opened_at": ack_ts,
        "entry_order_id": order.get("id"),
        "correlation_id": (telemetry or {}).get("correlation_id"),
        "signal_ts": (telemetry or {}).get("signal_ts"),
        "order_submit_ts": submit_ts,
        "order_ack_ts": ack_ts,
        "fill_ts": ack_ts,
        "execution_delay_ms": _ms_between((telemetry or {}).get("signal_ts"), ack_ts),
        "slippage_bps": slippage_bps,  # CRITICAL: actual slippage captured from fill
    }
    # Multi-position: store in positions dict keyed by symbol
    if not isinstance(state.get("positions"), dict):
        state["positions"] = {}
    state["positions"][symbol] = pos_record
    # Legacy compat
    state["position"] = pos_record
    state["active_symbol"] = symbol
    state["trades_today"] += 1
    append_fill_reflection({
        "type": "order_filled",
        "symbol": symbol,
        "side": side,
        "market": cfg.get("market", "unknown"),
        "order_id": order.get("id"),
        "order_status": order_status,
        "filled_qty": filled_qty,
        "fill_price": fill_price,
        "signal_price": signal_price,
        "slippage_bps": slippage_bps,
        "correlation_id": (telemetry or {}).get("correlation_id"),
        "signal_ts": (telemetry or {}).get("signal_ts"),
    })
    return order


def live_exit(exchange, state, cfg, symbol, price):
    # Multi-position: find position by symbol
    positions = state.get("positions") if isinstance(state.get("positions"), dict) else {}
    pos = positions.get(symbol) if symbol in positions else state.get("position")
    if not pos:
        return None, 0.0
    params = {}
    if cfg.get("execution", {}).get("reduce_only_on_exit", True):
        params["reduceOnly"] = True
    qty = float(exchange.amount_to_precision(symbol, pos["qty"]))
    side = str(pos.get("side", "long")).lower()
    close_side = "buy" if side == "short" else "sell"
    if exchange_provider_id(exchange) == "ccxt":
        inc_api_counter(state, "ccxt", 1)
        inc_api_endpoint_counter(state, f"ccxt:create_order_{close_side}", 1)
    try:
        if isinstance(exchange, AlpacaAdapter):
            # Alpaca position close endpoint is more reliable for fractional shares.
            order = exchange.close_position(symbol, qty=qty)
        else:
            order = exchange.create_order(symbol, "market", close_side, qty, None, params)
    except HTTPError as e:
        # Alpaca close-position can return 404/422 for stale or not-yet-settled local position states.
        # Treat these as non-fatal and clear local position record to stop exit loops.
        if int(getattr(e, "code", 0) or 0) in (404, 422):
            order = None
            if symbol in positions:
                del positions[symbol]
            state["positions"] = positions
            if positions:
                _remaining = next(iter(positions.values()))
                state["position"] = _remaining
                state["active_symbol"] = _remaining.get("symbol")
            else:
                state["position"] = None
                state["active_symbol"] = None
            return order, 0.0
        raise
    if side == "short":
        pnl = (pos["entry"] - price) * pos["qty"]
    else:
        pnl = (price - pos["entry"]) * pos["qty"]
    state["daily_pnl"] += pnl
    # Keep paper_balance in sync as a P&L tracking metric even in live mode.
    if state.get("paper_balance") is not None:
        state["paper_balance"] = float(state["paper_balance"]) + pnl
    # Remove from positions dict
    if symbol in positions:
        del positions[symbol]
    state["positions"] = positions
    # Update legacy state["position"] for backward compat
    if positions:
        _remaining = next(iter(positions.values()))
        state["position"] = _remaining
        state["active_symbol"] = _remaining.get("symbol")
    else:
        state["position"] = None
        state["active_symbol"] = None
    return order, pnl


# ─── RUNNER CATCHER HELPERS ──────────────────────────────────────────────────

def compute_rsi(closes, period=14):
    """Compute RSI using Wilder's smoothing method. Returns 0-100 float or None."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(0.0, delta))
        losses.append(max(0.0, -delta))
    # Use only the most recent data to keep computation bounded
    n = min(len(gains), period * 3)
    gains = gains[-n:]
    losses = losses[-n:]
    # Seed with simple average over first period
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    # Wilder's smoothing over remaining bars
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def detect_runner(ohlcv, runner_strategy_cfg):
    """
    Detect if the symbol is already in a strong move ("runner").
    Three conditions must all pass:
      1. Volume surge  — current bar volume >= min_vol_surge_ratio × 20-bar average
      2. Momentum      — 15-bar return >= min_move_pct (price up 2%+ in last 15 bars)
      3. RSI guard     — 1-min RSI between rsi_min and rsi_max (50–80, moving not blown out)
    Returns a dict with is_runner (bool) and diagnostic metadata.
    """
    rcfg = runner_strategy_cfg or {}
    min_vol_surge = float(rcfg.get("min_vol_surge_ratio", 3.0))
    min_move_pct = float(rcfg.get("min_move_pct", 0.02))
    rsi_max = float(rcfg.get("rsi_max", 80.0))
    rsi_min = float(rcfg.get("rsi_min", 50.0))

    result = {"is_runner": False, "vol_surge_ratio": None, "ret15": None, "rsi": None, "reason": ""}

    if not ohlcv or len(ohlcv) < 22:
        result["reason"] = "insufficient_bars"
        return result

    closes = [float(c[4]) for c in ohlcv]
    volumes = [float(c[5]) for c in ohlcv]

    # 1. Volume surge: compare current bar to 20-bar average (excluding current)
    vols_20 = volumes[-21:-1]
    avg_vol_20 = sum(vols_20) / len(vols_20) if vols_20 else 0.0
    cur_vol = volumes[-1]
    vol_surge_ratio = (cur_vol / avg_vol_20) if avg_vol_20 > 0 else 0.0
    result["vol_surge_ratio"] = round(vol_surge_ratio, 2)

    if vol_surge_ratio < min_vol_surge:
        result["reason"] = f"vol_surge_low:{vol_surge_ratio:.2f}<{min_vol_surge}"
        return result

    # 2. 15-bar momentum: price must be up min_move_pct over the last 15 bars
    if len(closes) < 16:
        result["reason"] = "insufficient_bars_for_ret15"
        return result
    ret15 = (closes[-1] / closes[-16]) - 1.0 if closes[-16] > 0 else 0.0
    result["ret15"] = round(ret15, 6)

    if ret15 < min_move_pct:
        result["reason"] = f"momentum_low:{ret15:.4f}<{min_move_pct}"
        return result

    # 3. RSI guard: not overextended, but must be in motion
    rsi_val = compute_rsi(closes, period=14)
    result["rsi"] = round(rsi_val, 2) if rsi_val is not None else None

    if rsi_val is None:
        result["reason"] = "rsi_unavailable"
        return result
    if rsi_val > rsi_max:
        result["reason"] = f"rsi_overextended:{rsi_val:.1f}>{rsi_max}"
        return result
    if rsi_val < rsi_min:
        result["reason"] = f"rsi_below_min:{rsi_val:.1f}<{rsi_min}"
        return result

    result["is_runner"] = True
    result["reason"] = f"runner:vol_surge={vol_surge_ratio:.2f}x ret15={ret15:.4f} rsi={rsi_val:.1f}"
    return result


def check_pullback_then_green(symbol, ohlcv, state, runner_strategy_cfg):
    """
    Manage pullback entry logic for a detected runner.
    Tracks state per-symbol across ticks using bar timestamps so tick frequency
    doesn't affect the bar-count logic.

    Entry mode:
      "immediate" — return "enter" on first call (no pullback wait)
      "pullback"  — wait for 1-2 red/flat bars then enter on next green bar

    Returns: "enter", "wait", or "reset" (detection expired).
    """
    if not ohlcv or len(ohlcv) < 3:
        return "wait"

    entry_mode = str((runner_strategy_cfg or {}).get("entry_mode", "pullback")).lower()
    if entry_mode == "immediate":
        return "enter"

    runner_pending = state.get("runner_pending")
    if not isinstance(runner_pending, dict):
        runner_pending = {}

    cur_bar = ohlcv[-1]
    cur_ts = int(cur_bar[0])
    cur_o, cur_c = float(cur_bar[1]), float(cur_bar[4])

    prev_bar = ohlcv[-2] if len(ohlcv) >= 2 else None
    prev_o = float(prev_bar[1]) if prev_bar else cur_o
    prev_c = float(prev_bar[4]) if prev_bar else cur_c

    pending = runner_pending.get(symbol)

    if not pending:
        # First detection — initialise pullback tracker
        runner_pending[symbol] = {
            "detected_ts": cur_ts,
            "pullback_seen": False,
            "last_bar_ts": cur_ts,
            "bars_since_detect": 0,
        }
        state["runner_pending"] = runner_pending
        return "wait"

    # Count new bars (each unique timestamp = one bar, not one tick)
    last_bar_ts = int(pending.get("last_bar_ts", cur_ts))
    if cur_ts != last_bar_ts:
        pending["bars_since_detect"] = int(pending.get("bars_since_detect", 0)) + 1
        pending["last_bar_ts"] = cur_ts

    # Expire after 5 bars — too slow, reset and re-detect fresh
    if int(pending.get("bars_since_detect", 0)) > 5:
        del runner_pending[symbol]
        state["runner_pending"] = runner_pending
        return "reset"

    # Wait for a red/flat candle (close <= open)
    if not pending.get("pullback_seen"):
        if prev_c <= prev_o or cur_c <= cur_o:
            pending["pullback_seen"] = True
        state["runner_pending"] = runner_pending
        return "wait"

    # Pullback seen — now look for the confirming green candle
    if cur_c > cur_o:
        del runner_pending[symbol]
        state["runner_pending"] = runner_pending
        return "enter"

    state["runner_pending"] = runner_pending
    return "wait"


def update_trailing_stop(pos, px, trail_cfg):
    """
    Ratchet the trailing stop upward as price makes new highs.
    Stop = highest_close_since_entry × (1 - trail_pct).
    Never moves the stop down. Logs each adjustment.
    Returns the current (possibly updated) stop price.
    """
    tcfg = trail_cfg or {}
    trail_pct = float(tcfg.get("trail_pct", 0.008))
    initial_stop_pct = float(tcfg.get("initial_stop_pct", 0.005))

    entry = float(pos.get("entry", px))
    current_stop = float(pos.get("trailing_stop") or (entry * (1.0 - initial_stop_pct)))
    highest_close = float(pos.get("highest_close_since_entry") or entry)

    # Update high-water mark
    if px > highest_close:
        highest_close = px
        pos["highest_close_since_entry"] = highest_close

    # Compute candidate new stop
    new_stop = highest_close * (1.0 - trail_pct)

    # Only ratchet up — never lower the stop
    if new_stop > current_stop:
        pos["trailing_stop"] = round(new_stop, 8)
        print(
            f"[cyan][TRAIL_STOP][/cyan] New stop: ${new_stop:.4f} "
            f"(high: ${highest_close:.4f})"
        )
    else:
        pos["trailing_stop"] = round(current_stop, 8)

    return float(pos["trailing_stop"])


# ─── SELF-LEARNING ENGINE ─────────────────────────────────────────────────────

_PATTERN_LIBRARY_PATH = _data_path("study", "pattern_library.json")
_REVIEW_DIR = _data_path("study", "reviews")
_WATCHLIST_DIR = _data_path("study", "watchlists")
_REFLECTION_ROOT = "Reflection"
_STOCK_REFLECTION_DIR = os.path.join(_REFLECTION_ROOT, "Stocks", "Day", "Scans")

# Hardcoded weekly economic calendar: (weekday 0=Mon..6=Sun, hour_utc_start, hour_utc_end, currency, name, impact)
_FOREX_EVENTS_WEEKLY = [
    (1, 7, 9,   "EUR", "German ZEW Survey",                 "medium"),
    (2, 12, 14, "USD", "ADP Employment / ISM Services",     "medium"),
    (2, 18, 20, "USD", "FOMC Rate Decision",                "high"),
    (3, 7,  9,  "EUR", "ECB Rate Decision",                 "high"),
    (3, 12, 14, "USD", "Initial Jobless Claims / PPI",      "medium"),
    (3, 12, 13, "GBP", "BoE Rate Decision",                 "high"),
    (4, 12, 14, "USD", "Non-Farm Payrolls / CPI / Retail Sales", "high"),
]


def get_asset_class_str(exchange):
    """Return 'stock', 'crypto', or 'forex' based on exchange type."""
    if isinstance(exchange, AlpacaAdapter):
        return "stock"
    if isinstance(exchange, OandaAdapter):
        return "forex"
    return "crypto"


def get_time_bin_et(dt_et):
    """Bin an ET datetime into named session windows."""
    hm = dt_et.hour * 60 + dt_et.minute
    if hm < 9 * 60 + 30:
        return "pre_market"
    if hm < 10 * 60:
        return "open"
    if hm < 11 * 60 + 30:
        return "mid_morning"
    if hm < 13 * 60 + 30:
        return "midday"
    if hm < 15 * 60:
        return "afternoon"
    if hm < 16 * 60:
        return "close"
    return "after_hours"


def get_forex_session(dt_utc):
    """Determine forex session: asia / london / ny / overlap / off_hours."""
    hm = dt_utc.hour * 60 + dt_utc.minute
    in_asia   = 0     <= hm < 8  * 60
    in_london = 7*60  <= hm < 16 * 60
    in_ny     = 12*60 <= hm < 21 * 60
    if in_london and in_ny:
        return "overlap"
    if in_ny:
        return "ny"
    if in_london:
        return "london"
    if in_asia:
        return "asia"
    return "off_hours"


def hours_since_last_major_forex_event(dt_utc):
    """Estimate hours since most recent high-impact forex event based on weekly calendar."""
    try:
        wd = dt_utc.weekday()
        cur_hm = dt_utc.hour * 60 + dt_utc.minute
        min_diff = 9999
        for offset in range(7):
            check_wd = (wd - offset) % 7
            for (e_wd, e_h_start, _e_h_end, _cur, _name, impact) in _FOREX_EVENTS_WEEKLY:
                if e_wd == check_wd and impact == "high":
                    diff_mins = offset * 24 * 60 + (cur_hm - e_h_start * 60)
                    if diff_mins >= 0 and diff_mins < min_diff:
                        min_diff = diff_mins
        return round(min_diff / 60.0, 1) if min_diff < 9999 else None
    except Exception:
        return None


def compute_entry_conditions(px, mctx, ohlcv, regime, signals, signal_source,
                              exchange, cfg, target_symbol, state,
                              runner_info=None, key_level_name=None):
    """
    Build the full conditions dict for a setup.
    Used for pattern matching, self-assessment, and EOD review context.
    """
    asset_class = get_asset_class_str(exchange)
    now_et = now_local()
    now_u  = now_utc()

    vwap = float(mctx.get("vwap_20") or px or 1.0)
    vwap_above = bool(px > vwap) if vwap > 0 else None

    closes = [float(c[4]) for c in ohlcv] if ohlcv else []
    rsi_val  = compute_rsi(closes, period=14) if len(closes) >= 15 else None
    atr_val  = compute_atr(ohlcv, period=14)  if len(ohlcv)  >= 2  else 0.0

    sma_9_v  = mctx.get("sma_9")  or sma(closes, 9)
    sma_21_v = mctx.get("sma_21") or sma(closes, 21)
    if sma_9_v and sma_21_v:
        sma_trend = "up" if float(sma_9_v) > float(sma_21_v) else ("down" if float(sma_9_v) < float(sma_21_v) else "flat")
    else:
        sma_trend = "flat"

    conditions = {
        "symbol":        target_symbol,
        "asset_class":   asset_class,
        "vol_ratio":     round(float(mctx.get("vol_ratio") or 1.0), 3),
        "vwap_above":    vwap_above,
        "rsi":           round(float(rsi_val), 1) if rsi_val is not None else None,
        "sma_trend":     sma_trend,
        "atr":           round(float(atr_val), 6),
        "time_bin":      get_time_bin_et(now_et) if asset_class == "stock" else None,
        "signal_source": signal_source,
        "regime":        regime,
        "key_level_name": key_level_name,
        "is_runner":     bool((runner_info or {}).get("is_runner", False)),
        "vol_surge_ratio": float((runner_info or {}).get("vol_surge_ratio") or 0.0) if runner_info else None,
        "ret15":         round(float(mctx.get("ret_15") or 0.0), 6),
    }

    if asset_class == "stock":
        ms_ranked = state.get("morning_scan_ranked") or []
        gap_pct   = None
        rel_vol   = None
        for r in ms_ranked:
            if str(r.get("symbol", "")).upper() == str(target_symbol).upper():
                gap_pct = r.get("gap_pct")
                rel_vol = r.get("rel_vol")
                break
        conditions["gap_pct"] = gap_pct
        conditions["rel_vol"] = rel_vol

    elif asset_class == "crypto":
        conditions["btc_direction"] = None   # would need separate BTC feed
        conditions["time_bin"]      = None   # crypto runs 24/7

    elif asset_class == "forex":
        conditions["forex_session"]          = get_forex_session(now_u)
        conditions["hours_since_major_event"] = hours_since_last_major_forex_event(now_u)
        conditions["time_bin"]               = None  # use forex_session instead

    return conditions


def load_pattern_library(path=None):
    """Load pattern library from JSON file. Returns list."""
    fpath = path or _PATTERN_LIBRARY_PATH
    try:
        if os.path.exists(fpath):
            with open(fpath, "r") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def save_pattern_library(patterns, path=None):
    """Save pattern library to JSON file."""
    fpath = path or _PATTERN_LIBRARY_PATH
    try:
        os.makedirs(os.path.dirname(fpath) or ".", exist_ok=True)
        with open(fpath, "w") as f:
            json.dump(patterns, f, indent=2)
    except Exception as e:
        print(f"[yellow]pattern_library save failed:[/yellow] {e}")


def get_cached_pattern_library(state, cfg):
    """Return pattern library from state cache, refreshing once per day."""
    if not bool(cfg.get("self_learning", {}).get("enabled", False)):
        return []
    today = day_str_local()
    if state.get("_pattern_library_date") == today and isinstance(state.get("_pattern_library_cache"), list):
        return state["_pattern_library_cache"]
    patterns = load_pattern_library()
    state["_pattern_library_cache"] = patterns
    state["_pattern_library_date"]  = today
    return patterns


def score_setup_against_pattern(conditions, pattern):
    """
    Compute similarity score 0..1: matched_fields / total_pattern_fields.
    Allows ±20% tolerance on numeric thresholds.
    """
    pconds = pattern.get("conditions") or {}
    if not pconds:
        return 0.0

    total   = 0
    matched = 0

    def _check_exact(key):
        nonlocal total, matched
        if pconds.get(key) is not None:
            total += 1
            if conditions.get(key) == pconds[key]:
                matched += 1

    def _check_gte(cond_key, pat_key, tolerance=0.20):
        nonlocal total, matched
        if pconds.get(pat_key) is not None:
            total += 1
            val = conditions.get(cond_key)
            if val is not None:
                if float(val) >= float(pconds[pat_key]) * (1.0 - tolerance):
                    matched += 1

    # vol_ratio_min: setup.vol_ratio >= pattern threshold
    _check_gte("vol_ratio", "vol_ratio_min")

    # vwap_above: exact boolean
    _check_exact("vwap_above")

    # rsi_range: rsi in [min, max]
    if pconds.get("rsi_range") is not None:
        total += 1
        rsi = conditions.get("rsi")
        if rsi is not None:
            try:
                rlo, rhi = float(pconds["rsi_range"][0]), float(pconds["rsi_range"][1])
                if rlo <= float(rsi) <= rhi:
                    matched += 1
            except Exception:
                pass

    _check_exact("regime")
    _check_exact("time_bin")
    _check_exact("signal_source")
    _check_exact("sma_trend")
    _check_exact("asset_class")

    # gap_pct_min: for stocks
    _check_gte("gap_pct", "gap_pct_min")

    return matched / total if total > 0 else 0.0


def apply_pattern_signals(sig, conditions, state, cfg):
    """
    Apply pattern boost/suppress to an entry signal.
    Returns (new_sig, matched_pattern_id, log_message).
    Suppress takes priority over boost.
    """
    sl_cfg = cfg.get("self_learning", {})
    if not bool(sl_cfg.get("enabled", False)):
        return sig, None, None

    patterns = get_cached_pattern_library(state, cfg)
    if not patterns:
        return sig, None, None

    boost_amount         = float(sl_cfg.get("boost_amount", 0.2))
    suppress_winrate     = float(sl_cfg.get("suppress_below_winrate", 0.40))
    conf_threshold       = float(sl_cfg.get("pattern_confidence_threshold", 0.65))
    min_samples          = int(sl_cfg.get("pattern_min_samples", 5))
    similarity_threshold = 0.7

    best_boost_id      = None
    best_boost_score   = 0.0
    best_boost_pattern = None
    suppress_id        = None
    suppress_score     = 0.0
    suppress_pattern   = None

    asset_class = conditions.get("asset_class")

    for p in patterns:
        if p.get("status") not in ("active", "high_confidence"):
            continue
        if p.get("asset_class") and p["asset_class"] != asset_class:
            continue
        score = score_setup_against_pattern(conditions, p)
        if score < similarity_threshold:
            continue

        wr = float(p.get("win_rate", 0.0))
        n  = int(p.get("sample_count", 0))
        cf = float(p.get("confidence", 0.0))
        pid = p.get("pattern_id", "?")

        # Suppression candidate: losing pattern with sufficient samples and recent data.
        # Patterns not seen in the last 7 days are skipped — market conditions shift and
        # a stale pattern's win rate is no longer reliable enough to block a trade.
        _last_seen_str = p.get("last_seen", "")
        try:
            _days_old = (datetime.now(timezone.utc).date() - datetime.fromisoformat(_last_seen_str).date()).days
        except Exception:
            _days_old = 0
        if wr < suppress_winrate and n >= 8 and _days_old <= 7 and score > suppress_score:
            suppress_id      = pid
            suppress_score   = score
            suppress_pattern = p

        # Boost candidate: high-confidence winning pattern
        if wr >= conf_threshold and n >= min_samples and cf >= conf_threshold and score > best_boost_score:
            best_boost_id      = pid
            best_boost_score   = score
            best_boost_pattern = p

    # Suppression takes priority
    if suppress_id:
        wr  = float(suppress_pattern.get("win_rate", 0.0))
        msg = (f"[PATTERN_SUPPRESS] Losing pattern #{suppress_id[:8]} "
               f"(win_rate: {wr:.1%}) → skip")
        print(f"[yellow]{msg}[/yellow]")
        return "hold", suppress_id, msg

    # Boost
    if best_boost_id:
        wr  = float(best_boost_pattern.get("win_rate", 0.0))
        msg = (f"[PATTERN_MATCH] Pattern #{best_boost_id[:8]} "
               f"(win_rate: {wr:.1%}) → confidence boost +{boost_amount:.2f}")
        print(f"[green]{msg}[/green]")
        return sig, best_boost_id, msg

    return sig, None, None


def compute_self_assessment(pnl, pos_before, conditions, cfg):
    """
    Generate self-assessment verdict after a trade closes.
    Returns dict: verdict, reason, would_take_again, pattern_tags.
    """
    ec = conditions or {}
    regime       = ec.get("regime") or (pos_before or {}).get("entry_regime") or "chop"
    vol_ratio    = float(ec.get("vol_ratio") or 1.0)
    signal_source = ec.get("signal_source") or "ensemble"
    is_runner    = bool(ec.get("is_runner", False))
    vwap_above   = ec.get("vwap_above")
    pattern_id   = (pos_before or {}).get("pattern_match_id")

    won          = pnl > 0
    bad_conds    = (regime == "chop" and vol_ratio < 0.5)
    valid_setup  = (vol_ratio >= 0.5 or signal_source in ("runner", "key_level_break"))

    if won:
        if pattern_id or (regime == "trend" and vol_ratio >= 1.0):
            verdict         = "good_trade"
            would_take_again = True
            parts = []
            if signal_source == "runner":
                vsr = ec.get("vol_surge_ratio")
                parts.append(f"runner vol_surge {vsr:.1f}x" if vsr else "runner signal")
            if vwap_above:
                parts.append("VWAP held")
            r15 = ec.get("ret15")
            if r15:
                parts.append(f"moved {abs(float(r15))*100:.2f}% before stop")
            reason = ", ".join(parts) if parts else f"won in {regime} regime"
        else:
            verdict          = "marginal_win"
            would_take_again = True
            reason           = f"won but conditions marginal (regime={regime}, vol_ratio={vol_ratio:.2f})"
    else:
        if bad_conds:
            verdict          = "bad_trade"
            would_take_again = False
            reason           = f"loss in chop with low vol_ratio ({vol_ratio:.2f})"
        elif valid_setup:
            verdict          = "learning_loss"
            would_take_again = True
            reason           = f"valid setup (regime={regime}, source={signal_source}) but lost"
        else:
            verdict          = "bad_trade"
            would_take_again = False
            reason           = f"loss with marginal conditions (regime={regime})"

    # Pattern tags
    tags = []
    if is_runner:
        tags.append("high_rvol_runner")
    if vwap_above:
        tags.append("vwap_support")
    if regime == "trend":
        tags.append("trend_regime")
    elif regime == "chop":
        tags.append("chop_regime")
    kl_name = ec.get("key_level_name")
    if signal_source == "key_level_break":
        tags.append(f"key_level_{kl_name.lower()}" if kl_name else "key_level_break")
    if signal_source:
        tags.append(f"signal_{signal_source}")

    return {
        "verdict":          verdict,
        "reason":           reason,
        "would_take_again": would_take_again,
        "pattern_tags":     tags,
    }


def _read_todays_journal_entries(journal_path, today_str, entry_types, max_rows=8000):
    """Read journal entries of given types for today_str. Returns list."""
    results = []
    if not os.path.exists(journal_path):
        return results
    try:
        with open(journal_path, "r") as f:
            lines = f.readlines()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            ts = row.get("ts", "")
            if ts[:10] != today_str:
                continue
            if row.get("type") in entry_types:
                results.append(row)
                if len(results) >= max_rows:
                    break
    except Exception:
        pass
    return results


def _analyze_missed_signals(ticks, trades):
    """
    Find ticks where sig was 'long' but no matching trade_open followed.
    For each missed signal where price subsequently moved 0.5%+ in signal direction,
    return a 'missed opportunity' dict.
    """
    if not ticks:
        return []

    # Build set of (symbol, minute) pairs where trades actually opened
    traded_keys = set()
    for t in trades:
        ts_min = (t.get("ts") or "")[:16]
        sym    = t.get("symbol") or ""
        traded_keys.add(f"{sym}:{ts_min}")

    missed = []
    seen   = set()

    for i, tick in enumerate(ticks):
        if tick.get("sig") != "long":
            continue
        sym    = tick.get("symbol") or ""
        ts_min = (tick.get("ts") or "")[:16]
        key    = f"{sym}:{ts_min}"
        if key in traded_keys or key in seen:
            continue
        seen.add(key)

        entry_px = float(tick.get("px") or 0)
        if entry_px <= 0:
            continue

        # Gather next 10 ticks for the same symbol to estimate forward move
        future_pxs = []
        for j in range(i + 1, min(i + 11, len(ticks))):
            if ticks[j].get("symbol") == sym:
                fp = float(ticks[j].get("px") or 0)
                if fp > 0:
                    future_pxs.append(fp)
        if not future_pxs:
            continue

        max_profit = max((c / entry_px - 1.0) for c in future_pxs)
        if max_profit < 0.005:   # threshold: 0.5% to count as "would have won"
            continue

        mc = tick.get("market_context") or {}
        missed.append({
            "symbol":          sym,
            "ts":              tick.get("ts"),
            "entry_px":        round(entry_px, 4),
            "max_profit_pct":  round(max_profit * 100, 3),
            "would_have_won":  True,
            "regime":          tick.get("regime"),
            "vol_ratio":       mc.get("vol_ratio"),
            "ret15":           mc.get("ret_15"),
            "signals":         tick.get("signals"),
            "setup_type":      tick.get("setup_type"),
        })

    return missed[:20]


def _bin_conditions_for_cluster(conditions):
    """Return a hashable key by coarsely binning conditions for pattern clustering."""
    vr     = float(conditions.get("vol_ratio") or 0.0)
    vr_bin = round(round(vr / 0.5) * 0.5, 1)

    rsi     = conditions.get("rsi")
    rsi_bin = (int(float(rsi)) // 10) * 10 if rsi is not None else None

    return (
        conditions.get("asset_class"),
        conditions.get("signal_source"),
        conditions.get("regime"),
        conditions.get("time_bin"),
        conditions.get("vwap_above"),
        conditions.get("sma_trend"),
        vr_bin,
        rsi_bin,
    )


def update_pattern_library(review_trades, cfg, today_str=None):
    """
    Update pattern library from completed trades.
    - Clusters trades by binned conditions
    - Updates existing matching patterns or creates new ones
    - Marks patterns as inactive (win_rate < suppress threshold, 10+ samples)
      or high_confidence (win_rate >= conf threshold, 5+ samples)
    """
    if today_str is None:
        today_str = day_str_local()

    sl_cfg            = cfg.get("self_learning", {})
    min_samples       = int(sl_cfg.get("pattern_min_samples", 5))
    conf_threshold    = float(sl_cfg.get("pattern_confidence_threshold", 0.65))
    suppress_winrate  = float(sl_cfg.get("suppress_below_winrate", 0.40))

    patterns = load_pattern_library()

    # Index existing patterns by bin key for fast lookup
    pattern_idx = {}
    for p in patterns:
        pc = p.get("conditions") or {}
        vr_min = float(pc.get("vol_ratio_min") or 0.0)
        vr_bin = round(round(vr_min / 0.5) * 0.5, 1)
        bk = (
            p.get("asset_class"),
            pc.get("signal_source"),
            pc.get("regime"),
            pc.get("time_bin"),
            pc.get("vwap_above"),
            pc.get("sma_trend"),
            vr_bin,
            None,
        )
        pattern_idx[bk] = p

    # Cluster today's trades by binned conditions
    clusters = {}
    for trade in review_trades:
        ec   = trade.get("entry_conditions") or {}
        if not ec:
            continue
        pnl  = float(trade.get("pnl") or 0.0)
        bk   = _bin_conditions_for_cluster(ec)
        if bk not in clusters:
            clusters[bk] = {"wins": 0, "losses": 0, "conditions": ec, "trades": []}
        clusters[bk]["trades"].append(trade)
        if pnl > 0:
            clusters[bk]["wins"] += 1
        else:
            clusters[bk]["losses"] += 1

    # Update or create patterns
    for bk, cluster in clusters.items():
        total    = cluster["wins"] + cluster["losses"]
        win_rate = cluster["wins"] / total if total > 0 else 0.0
        ec       = cluster["conditions"]

        def _avg_pnl_pct(trades_list):
            pcts = []
            for t in trades_list:
                pnl_v   = float(t.get("pnl") or 0)
                ent     = t.get("entry") or {}
                qty     = float(ent.get("qty") or 1)
                epx     = float(ent.get("px") or 1)
                notional = qty * epx
                if notional > 0:
                    pcts.append(pnl_v / notional)
            return sum(pcts) / len(pcts) if pcts else 0.0

        existing = pattern_idx.get(bk)
        if existing is not None:
            old_n    = int(existing.get("sample_count", 0))
            old_wins = int(existing.get("win_count", 0))
            new_n    = old_n + total
            new_wins = old_wins + cluster["wins"]
            new_wr   = new_wins / new_n if new_n > 0 else 0.0
            old_avg  = float(existing.get("avg_pnl_pct") or 0)
            today_avg = _avg_pnl_pct(cluster["trades"])
            new_avg  = (old_avg * old_n + today_avg * total) / max(1, new_n)
            existing.update({
                "sample_count": new_n,
                "win_count":    new_wins,
                "win_rate":     round(new_wr, 4),
                "avg_pnl_pct":  round(new_avg, 6),
                "confidence":   round(min(0.99, new_wr * min(1.0, new_n / 20.0)), 4),
                "last_seen":    today_str,
            })
        else:
            rsi_val   = ec.get("rsi")
            rsi_bin   = (int(float(rsi_val)) // 10) * 10 if rsi_val is not None else None
            rsi_range = [rsi_bin, min(100, rsi_bin + 10)] if rsi_bin is not None else None
            new_p = {
                "pattern_id":   str(uuid.uuid4()),
                "asset_class":  ec.get("asset_class"),
                "conditions": {
                    "vol_ratio_min": round(float(ec.get("vol_ratio") or 0) * 0.8, 2),
                    "vwap_above":    ec.get("vwap_above"),
                    "rsi_range":     rsi_range,
                    "regime":        ec.get("regime"),
                    "time_bin":      ec.get("time_bin"),
                    "signal_source": ec.get("signal_source"),
                    "gap_pct_min":   round(float(ec.get("gap_pct") or 0) * 0.5, 4) if ec.get("gap_pct") else None,
                    "sma_trend":     ec.get("sma_trend"),
                },
                "sample_count":  total,
                "win_count":     cluster["wins"],
                "win_rate":      round(win_rate, 4),
                "avg_pnl_pct":   round(_avg_pnl_pct(cluster["trades"]), 6),
                "confidence":    round(min(0.99, win_rate * min(1.0, total / 20.0)), 4),
                "last_seen":     today_str,
                "status":        "active",
            }
            patterns.append(new_p)
            pattern_idx[bk] = new_p

    # Re-evaluate status of all patterns
    for p in patterns:
        n  = int(p.get("sample_count", 0))
        wr = float(p.get("win_rate", 0.0))
        cf = float(p.get("confidence", 0.0))
        if n >= 10 and wr < suppress_winrate:
            p["status"] = "inactive"
        elif n >= min_samples and wr >= conf_threshold and cf >= conf_threshold:
            p["status"] = "high_confidence"
        elif p.get("status") == "inactive" and wr >= conf_threshold:
            p["status"] = "active"   # recover if win rate improved
        elif p.get("status") not in ("inactive", "high_confidence"):
            p["status"] = "active"

    save_pattern_library(patterns)
    return patterns


def run_eod_review(cfg, state, exchange, journal_path):
    """
    End-of-day review engine: reads today's journal, computes trade stats,
    finds missed signals, writes review JSON, updates pattern library.
    Returns the review dict.
    """
    today       = day_str_local()
    review_path = os.path.join(_REVIEW_DIR, f"review_{today}.json")
    os.makedirs(_REVIEW_DIR, exist_ok=True)

    print(f"[cyan]EOD_REVIEW[/cyan] Running end-of-day review for {today} ...")

    trades = _read_todays_journal_entries(journal_path, today, {"trade_close"})
    ticks  = _read_todays_journal_entries(journal_path, today, {"tick"}, max_rows=4000)
    runner_scans = _read_todays_journal_entries(
        journal_path,
        today,
        {"runner_scan_snapshot"},
        max_rows=500,
    )

    # ── Summary stats ──────────────────────────────────────────────────────────
    total_trades = len(trades)
    wins   = [t for t in trades if float(t.get("pnl") or 0) > 0]
    losses = [t for t in trades if float(t.get("pnl") or 0) <= 0]
    win_rate   = len(wins) / total_trades if total_trades > 0 else 0.0
    total_pnl  = sum(float(t.get("pnl") or 0) for t in trades)
    avg_winner = sum(float(t.get("pnl") or 0) for t in wins)   / len(wins)   if wins   else 0.0
    avg_loser  = sum(float(t.get("pnl") or 0) for t in losses) / len(losses) if losses else 0.0

    best_trade  = max(trades, key=lambda t: float(t.get("pnl") or 0)) if trades else None
    worst_trade = min(trades, key=lambda t: float(t.get("pnl") or 0)) if trades else None

    # ── Per-dimension stats ────────────────────────────────────────────────────
    def _dim_stats(trades_list, key_fn):
        stats = {}
        for t in trades_list:
            k = key_fn(t) or "unknown"
            if k not in stats:
                stats[k] = {"trades": 0, "wins": 0, "pnl": 0.0}
            stats[k]["trades"] += 1
            pv = float(t.get("pnl") or 0)
            if pv > 0:
                stats[k]["wins"] += 1
            stats[k]["pnl"] += pv
        return {
            k: {**v, "win_rate": round(v["wins"] / v["trades"], 4) if v["trades"] > 0 else 0}
            for k, v in stats.items()
        }

    def _src(t):
        ec = t.get("entry_conditions") or {}
        return ec.get("signal_source") or (t.get("entry") or {}).get("setup_type")

    def _reg(t):
        ec = t.get("entry_conditions") or {}
        return ec.get("regime") or (t.get("entry") or {}).get("regime")

    def _tb(t):
        ec = t.get("entry_conditions") or {}
        return ec.get("time_bin")

    source_stats = _dim_stats(trades, _src)
    regime_stats = _dim_stats(trades, _reg)
    time_stats   = _dim_stats(trades, _tb)

    runner_scan_symbols = []
    runner_selected_symbols = []
    runner_ranked_counts = []
    runner_prefilter_counts = []
    runner_reason_counts = defaultdict(int)
    for snap in runner_scans:
        runner_prefilter_counts.append(int(snap.get("prefilter_candidates") or snap.get("candidate_count") or 0))
        runner_ranked_counts.append(int(snap.get("ranked_candidates") or 0))
        for sym in snap.get("selected_symbols") or []:
            sym = str(sym or "").upper().strip()
            if sym:
                runner_selected_symbols.append(sym)
        for row in snap.get("scan_candidates") or []:
            sym = str((row or {}).get("symbol") or "").upper().strip()
            if sym:
                runner_scan_symbols.append(sym)
        for reason, count in (snap.get("reason_counts") or {}).items():
            try:
                runner_reason_counts[str(reason)] += int(count)
            except Exception:
                continue

    # ── Missed opportunities ───────────────────────────────────────────────────
    missed = _analyze_missed_signals(ticks, trades)

    # ── Pattern observations (text) ────────────────────────────────────────────
    obs = []
    for src, st in source_stats.items():
        if st["trades"] >= 2:
            obs.append(f"Signal source '{src}': {st['trades']} trades, "
                       f"{st['win_rate']:.0%} win rate, ${st['pnl']:.2f} PnL")
    for reg, st in regime_stats.items():
        if st["trades"] >= 2:
            obs.append(f"Regime '{reg}': {st['trades']} trades, {st['win_rate']:.0%} win rate")
    for tb, st in time_stats.items():
        if st["trades"] >= 2:
            obs.append(f"Time bin '{tb}': {st['trades']} trades, {st['win_rate']:.0%} win rate")

    def _trade_summary(t):
        if not t:
            return None
        ec  = t.get("entry_conditions") or {}
        ent = t.get("entry") or {}
        return {
            "symbol":         t.get("symbol"),
            "pnl":            round(float(t.get("pnl") or 0), 4),
            "entry_px":       ent.get("px"),
            "exit_px":        t.get("px"),
            "signal_source":  ec.get("signal_source") or ent.get("setup_type"),
            "regime":         ec.get("regime") or ent.get("regime"),
            "vol_ratio":      ec.get("vol_ratio"),
            "vwap_above":     ec.get("vwap_above"),
            "rsi":            ec.get("rsi"),
            "time_bin":       ec.get("time_bin"),
            "is_runner":      ec.get("is_runner"),
            "self_assessment": t.get("self_assessment"),
        }

    review = {
        "date":           today,
        "generated_at":   now_utc().isoformat(),
        "summary": {
            "total_trades":    total_trades,
            "win_count":       len(wins),
            "loss_count":      len(losses),
            "win_rate":        round(win_rate, 4),
            "avg_winner":      round(avg_winner, 4),
            "avg_loser":       round(avg_loser, 4),
            "total_pnl":       round(total_pnl, 4),
            "starting_equity": float(cfg.get("risk", {}).get("starting_equity_usd", 50.0)),
        },
        "best_trade":           _trade_summary(best_trade),
        "worst_trade":          _trade_summary(worst_trade),
        "missed_opportunities": missed,
        "signal_source_stats":  source_stats,
        "regime_stats":         regime_stats,
        "time_bin_stats":       time_stats,
        "pattern_observations": obs,
        "runner_scan_summary": {
            "snapshot_count": len(runner_scans),
            "unique_scanned_symbols": len(set(runner_scan_symbols)),
            "unique_selected_symbols": len(set(runner_selected_symbols)),
            "avg_prefilter_candidates": (
                round(sum(runner_prefilter_counts) / len(runner_prefilter_counts), 2)
                if runner_prefilter_counts else 0.0
            ),
            "avg_ranked_candidates": (
                round(sum(runner_ranked_counts) / len(runner_ranked_counts), 2)
                if runner_ranked_counts else 0.0
            ),
            "top_selected_symbols": [
                sym for sym, _ in sorted(
                    ((sym, runner_selected_symbols.count(sym)) for sym in set(runner_selected_symbols)),
                    key=lambda x: x[1],
                    reverse=True,
                )[:10]
            ],
            "reason_counts": dict(sorted(runner_reason_counts.items(), key=lambda x: x[1], reverse=True)[:10]),
        },
        "runner_scan_history": runner_scans[-20:],
        "skip_reasons":         dict(state.get("skip_reasons_today") or {}),
        "trades": [
            {
                "symbol":           t.get("symbol"),
                "pnl":              float(t.get("pnl") or 0),
                "entry_conditions": t.get("entry_conditions"),
                "self_assessment":  t.get("self_assessment"),
                "hold_sec":         t.get("hold_sec"),
            }
            for t in trades
        ],
    }

    try:
        with open(review_path, "w") as f:
            json.dump(review, f, indent=2)
        print(f"[cyan]EOD_REVIEW[/cyan] Saved → {review_path}")
    except Exception as e:
        print(f"[yellow]EOD_REVIEW write failed:[/yellow] {e}")

    # ── Update pattern library from today's trades ─────────────────────────────
    try:
        patternable = [t for t in trades if t.get("entry_conditions")]
        if patternable:
            update_pattern_library(patternable, cfg, today)
            print(f"[cyan]EOD_REVIEW[/cyan] Pattern library updated ({len(patternable)} trades)")
        # Invalidate cache so next tick reloads fresh patterns
        state["_pattern_library_cache"] = None
        state["_pattern_library_date"]  = ""
    except Exception as e:
        print(f"[yellow]EOD_REVIEW pattern update failed:[/yellow] {e}")

    return review


def build_tomorrows_watchlist(cfg, state, exchange, review):
    """
    Build next-day watchlist after EOD review.
    Saved to study/watchlists/watchlist_YYYY-MM-DD.json (tomorrow).
    """
    os.makedirs(_WATCHLIST_DIR, exist_ok=True)
    tomorrow  = (now_local() + timedelta(days=1)).strftime("%Y-%m-%d")
    wl_path   = os.path.join(_WATCHLIST_DIR, f"watchlist_{tomorrow}.json")
    asset_cls = get_asset_class_str(exchange)

    wl = {
        "date":            tomorrow,
        "generated_at":    now_utc().isoformat(),
        "asset_class":     asset_cls,
        "candidates":      [],
        "high_opportunity": [],
        "high_risk":       [],
        "notes":           [],
    }

    if asset_cls == "stock":
        # Winners today → watch for continuation
        for sym in {t["symbol"] for t in (review.get("trades") or []) if float(t.get("pnl") or 0) > 0}:
            wl["candidates"].append({"symbol": sym, "reason": "won today – watch continuation", "type": "continuation"})
        # Morning scan top names
        for r in (state.get("morning_scan_ranked") or [])[:20]:
            sym = r.get("symbol")
            if sym and sym not in {c["symbol"] for c in wl["candidates"]}:
                wl["candidates"].append({
                    "symbol":  sym,
                    "score":   r.get("score"),
                    "gap_pct": r.get("gap_pct"),
                    "rel_vol": r.get("rel_vol"),
                    "reason":  "morning scan top ranked",
                    "type":    "rvol_gap",
                })
        wl["notes"].append("Scan for gap-up / gap-down names pre-market (4am–9:30am ET)")
        wl["notes"].append("High rvol names from first 30 mins often provide best setups")

    elif asset_cls == "crypto":
        for sym in (state.get("watched_symbols") or [])[:20]:
            wl["candidates"].append({"symbol": sym, "reason": "currently watched – check 4h momentum", "type": "momentum"})
        wl["notes"].append("Check BTC trend direction at session open for bias")
        wl["notes"].append("Prioritize symbols with accelerating volume on 4h chart")

    elif asset_cls == "forex":
        tomorrow_dt = now_local() + timedelta(days=1)
        tomorrow_wd = tomorrow_dt.weekday()
        hi_events   = [(e, c, n, h) for (wd, h, _, c, n, imp) in _FOREX_EVENTS_WEEKLY
                       if wd == tomorrow_wd and imp == "high"
                       for e in [(wd, h, _, c, n, imp)]]
        # Simpler rebuild:
        hi_events = [
            {"currency": c, "event": n, "hour_utc": h}
            for (wd, h, _he, c, n, imp) in _FOREX_EVENTS_WEEKLY
            if wd == tomorrow_wd and imp == "high"
        ]
        pair_map = {"USD": ["EUR/USD", "GBP/USD", "USD/JPY"], "EUR": ["EUR/USD"],
                    "GBP": ["GBP/USD"], "JPY": ["USD/JPY"]}
        for evt in hi_events:
            for pair in pair_map.get(evt["currency"], []):
                wl["high_opportunity"].append({
                    "symbol": pair,
                    "reason": f"Major event: {evt['event']} @ {evt['hour_utc']}:00 UTC",
                    "type":   "event_driven",
                })
                wl["high_risk"].append({
                    "symbol": pair,
                    "reason": f"High vol expected around {evt['event']}",
                    "type":   "event_risk",
                })
        for sym in (state.get("watched_symbols") or [])[:10]:
            wl["candidates"].append({"symbol": sym, "reason": "current scan rotation", "type": "standard"})
        if hi_events:
            wl["notes"].append(f"High-impact events tomorrow: {', '.join(e['event'] for e in hi_events)}")
        wl["notes"].append("Avoid tight stops within 30 min of major events")

    try:
        with open(wl_path, "w") as f:
            json.dump(wl, f, indent=2)
        print(f"[cyan]EOD_REVIEW[/cyan] Tomorrow's watchlist → {wl_path}")
        append_summary_reflection({
            "type": "eod_review_summary",
            "review_date": today,
            "watchlist_path": wl_path,
            "candidate_count": len(wl.get("candidates") or []),
            "high_opportunity_count": len(wl.get("high_opportunity") or []),
            "high_risk_count": len(wl.get("high_risk") or []),
            "notes": wl.get("notes") or [],
        })
    except Exception as e:
        print(f"[yellow]EOD_REVIEW watchlist save failed:[/yellow] {e}")

    return wl


def check_and_run_eod_review(cfg, state, exchange, journal_path):
    """
    Called every loop iteration. Checks if it's past the configured review_time_et
    and the review hasn't run today. If so, runs the full EOD review + watchlist build.
    Returns True if the review was executed this call.
    """
    sl_cfg = cfg.get("self_learning", {})
    if not bool(sl_cfg.get("enabled", False)):
        return False

    review_time_str = str(sl_cfg.get("review_time_et", "20:00"))
    try:
        rh, rm = (int(x) for x in review_time_str.split(":")[:2])
    except Exception:
        rh, rm = 20, 0

    now_et  = now_local()
    today   = now_et.strftime("%Y-%m-%d")
    already = str(state.get("eod_review_date") or "")
    if already == today:
        return False

    now_hm    = now_et.hour * 60 + now_et.minute
    review_hm = rh * 60 + rm
    if now_hm < review_hm:
        return False

    try:
        review = run_eod_review(cfg, state, exchange, journal_path)
        state["eod_review_date"] = today
        build_tomorrows_watchlist(cfg, state, exchange, review)
        send_alert(cfg, state,
                   f"EOD review complete {today}: "
                   f"{review['summary']['total_trades']} trades, "
                   f"win_rate={review['summary']['win_rate']:.0%}, "
                   f"PnL=${review['summary']['total_pnl']:.2f}", force=True)
        print(f"[cyan]EOD_REVIEW[/cyan] Complete for {today}")
        return True
    except Exception as e:
        print(f"[yellow]EOD_REVIEW failed:[/yellow] {e}")
        state["eod_review_date"] = today   # avoid retry loop on error
        return False


# ─── OVERNIGHT SCOUT (Pre-Market Runner Identifier) ───────────────────────────

def score_overnight_candidate(symbol, ohlcv_1h, mctx, cfg_overnight):
    """
    Score a candidate for overnight hold.
    Factors: volume surge, momentum, gap from open, after-hours strength
    Returns: score (0.0-1.0), higher is better
    """
    try:
        if not ohlcv_1h or len(ohlcv_1h) < 2:
            return 0.0

        closes = [float(bar[4]) for bar in ohlcv_1h]
        volumes = [float(bar[5]) for bar in ohlcv_1h]

        # 1. Volume surge (current vs 1h average)
        vol_avg = sum(volumes[:-1]) / len(volumes[:-1]) if len(volumes) > 1 else 1.0
        cur_vol = volumes[-1]
        vol_surge = min(1.0, (cur_vol / max(vol_avg, 1)) / 3.0)  # normalize to 1.0 at 3x

        # 2. Momentum (% change in last hour)
        momentum = (closes[-1] / closes[0] - 1.0) if closes[0] > 0 else 0.0
        momentum_score = min(1.0, max(0.0, momentum / 0.05))  # normalize to 1.0 at +5%

        # 3. Gap from open
        open_px = closes[0]
        current_px = closes[-1]
        gap_pct = (current_px / open_px - 1.0) if open_px > 0 else 0.0
        gap_score = min(1.0, max(0.0, gap_pct / 0.03))  # normalize to 1.0 at +3%

        # 4. Market context (trendline bias, volume ratio)
        mctx_score = 0.5
        if mctx:
            trend_bias = float(mctx.get("trendline_bias") or 0.0)
            vol_ratio = float(mctx.get("vol_ratio") or 1.0)
            mctx_score = min(1.0, (abs(trend_bias) / 0.01) * 0.5 + (vol_ratio / 2.0) * 0.5)

        # Weighted score
        weights = {
            "volume_surge": float(cfg_overnight.get("scoring", {}).get("volume_surge_weight", 0.25)),
            "momentum": float(cfg_overnight.get("scoring", {}).get("momentum_weight", 0.35)),
            "gap": float(cfg_overnight.get("scoring", {}).get("gap_weight", 0.20)),
            "context": float(cfg_overnight.get("scoring", {}).get("after_hours_weight", 0.20)),
        }
        total_weight = sum(weights.values())
        if total_weight == 0:
            return 0.0

        score = (
            vol_surge * weights["volume_surge"] +
            momentum_score * weights["momentum"] +
            gap_score * weights["gap"] +
            mctx_score * weights["context"]
        ) / total_weight

        return min(1.0, max(0.0, score))
    except Exception:
        return 0.0


def overnight_scout(exchange, cfg, state, scan_symbols, journal_path):
    """
    Run before market close (3:50 PM ET).
    Scan all symbols for best overnight setup.
    Return: (best_symbol, score, metadata) or (None, 0, {})
    """
    try:
        overnight_cfg = cfg.get("overnight", {})
        scan_cfg = cfg.get("scanner", {})

        # Scan top candidates
        candidates = []
        max_watch = int(scan_cfg.get("dynamic_max_watch", 100))

        for symbol in scan_symbols[:max_watch]:
            try:
                # Get 1-hour OHLCV (last 5 bars = 5 hours)
                ohlcv_1h = get_ohlcv_series(exchange, symbol, "1h", limit=5, state=state)
                if not ohlcv_1h or len(ohlcv_1h) < 2:
                    continue

                closes_1h = [float(bar[4]) for bar in ohlcv_1h]
                current_px = closes_1h[-1]

                # Check criteria
                criteria = overnight_cfg.get("candidates", {})
                min_price = float(criteria.get("min_price", 1.0))
                max_price = float(criteria.get("max_price", 500.0))
                min_vol_1h = float(criteria.get("min_volume_1h", 500000))

                if current_px < min_price or current_px > max_price:
                    continue

                # Get 1-min data for market context
                ohlcv_1m = get_ohlcv_series(exchange, symbol, "1m", limit=30, state=state)
                if not ohlcv_1m:
                    continue

                mf = ohlcv_market_features(ohlcv_1m)
                mctx = market_context(mf.get("closes", []))

                # Check volume
                volumes_1h = [float(bar[5]) for bar in ohlcv_1h]
                vol_1h = sum(volumes_1h[-1:])  # last hour only
                if vol_1h < min_vol_1h:
                    continue

                # Score
                score = score_overnight_candidate(symbol, ohlcv_1h, mctx, overnight_cfg)
                if score > 0.3:  # Minimum threshold
                    candidates.append({
                        "symbol": symbol,
                        "score": score,
                        "px": current_px,
                        "vol_1h": vol_1h,
                        "momentum": (closes_1h[-1] / closes_1h[0] - 1.0) * 100,
                    })
            except Exception:
                continue

        if not candidates:
            return None, 0.0, {}

        # Pick best
        candidates.sort(key=lambda x: -x["score"])
        best = candidates[0]

        print(
            f"[green]overnight_scout[/green] best: {best['symbol']} "
            f"score={best['score']:.2f} px=${best['px']:.2f} "
            f"momentum={best['momentum']:.1f}% vol={best['vol_1h']:,.0f}"
        )

        append_journal(journal_path, {
            "type": "overnight_scout",
            "best_symbol": best["symbol"],
            "score": best["score"],
            "price": best["px"],
            "momentum_pct": best["momentum"],
            "volume_1h": best["vol_1h"],
            "candidates_count": len(candidates),
        })

        return best["symbol"], best["score"], best
    except Exception as e:
        print(f"[yellow]overnight_scout error:[/yellow] {e}")
        return None, 0.0, {}


# ─── BREAK WATCHERS (Resistance Level Trading) ────────────────────────────────

def detect_resistance_level(exchange, symbol, ohlcv_recent, ob_limit=20, state=None):
    """
    Detect resistance level by combining:
    1. L2 order book walls (big ask walls above price)
    2. Recent price highs (last 30 min high)

    Returns: (break_level, confidence, source_info)
    - break_level: Price to watch for break
    - confidence: 0.0-1.0 strength (higher = better)
    - source_info: dict with l2_wall, recent_high, etc
    """
    try:
        # Get current price
        if not ohlcv_recent or len(ohlcv_recent) < 1:
            return None, 0.0, {}
        current_px = float(ohlcv_recent[-1][4])  # close

        # Get recent high (last 30 bars of 1-min candles = 30 min)
        recent_high = max(float(bar[2]) for bar in ohlcv_recent[-30:]) if ohlcv_recent else current_px

        # Get L2 order book (ask side = resistance)
        ob_level = None
        confidence = 0.0
        try:
            ob = exchange.fetch_order_book(symbol, limit=ob_limit)
            asks = ob.get("asks", [])
            # Find biggest ask wall above current price
            if asks:
                asks_above = [(price, size) for price, size in asks if price > current_px]
                if asks_above:
                    # Find the wall (biggest size cluster)
                    asks_above.sort(key=lambda x: -x[1])  # sort by size descending
                    ob_level = float(asks_above[0][0])
                    confidence = min(1.0, float(asks_above[0][1]) / 100000.0)  # normalize to 1.0
        except Exception:
            pass

        # Combine L2 and recent high: use whichever is closer to current price
        candidates = []
        if ob_level and ob_level > current_px:
            candidates.append(("l2_wall", ob_level, 0.6 + confidence * 0.4))
        if recent_high > current_px:
            candidates.append(("recent_high", recent_high, 0.5))

        if not candidates:
            return None, 0.0, {}

        # Pick the closest one with highest confidence
        candidates.sort(key=lambda x: (-x[2], x[1]))  # sort by confidence desc, then by level asc
        source, level, conf = candidates[0]

        return level, conf, {
            "source": source,
            "l2_wall": ob_level,
            "recent_high": recent_high,
            "current_px": current_px,
        }
    except Exception as e:
        return None, 0.0, {"error": str(e)}


def add_to_break_watchers(state, symbol, break_level, confidence, source_info):
    """Add a symbol to break watchers."""
    if not isinstance(state.get("break_watchers"), dict):
        state["break_watchers"] = {}
    state["break_watchers"][symbol] = {
        "break": float(break_level),
        "added_ts": int(time.time()),
        "confidence": float(confidence),
        "source": source_info.get("source", "unknown"),
        "l2_wall": source_info.get("l2_wall"),
        "recent_high": source_info.get("recent_high"),
    }
    print(f"[magenta]break_watcher[/magenta] {symbol} break=${break_level:.2f} (confidence={confidence:.2f}, source={source_info.get('source')})")


def check_break_watchers(state, exchange, cfg, journal_path):
    """
    Check all break watchers for price breaks.
    If price >= break level, enter immediately.
    Returns: list of symbols that broke (and were entered)
    """
    if not isinstance(state.get("break_watchers"), dict) or not state["break_watchers"]:
        return []

    broken = []
    for symbol in list(state["break_watchers"].keys()):
        try:
            watch = state["break_watchers"][symbol]
            break_level = float(watch.get("break"))
            confidence = float(watch.get("confidence", 0.5))

            # Get current price
            try:
                ohlcv = get_ohlcv_series(exchange, symbol, cfg["timeframe"], limit=1, state=state)
                if not ohlcv or len(ohlcv) < 1:
                    continue
                current_px = float(ohlcv[-1][4])
            except Exception:
                continue

            # Check if broken
            if current_px >= break_level:
                print(f"[green]BREAK TRIGGERED[/green] {symbol} ${current_px:.2f} >= ${break_level:.2f}")

                # Execute: immediate market buy
                # Size: use standard position sizing
                base_notional = float(cfg["risk"]["max_position_notional_usd"])
                notional = base_notional

                if cfg["mode"] == "paper":
                    paper_enter(state, symbol, current_px, notional, side="long")
                    msg = f"PAPER BUY (BREAK_WATCHER) {symbol} px=${current_px:.2f} notional=${notional:.2f}"
                    print(f"[cyan]{msg}[/cyan]")
                    append_journal(journal_path, {
                        "type": "trade_open",
                        "mode": "paper",
                        "symbol": symbol,
                        "px": current_px,
                        "notional": notional,
                        "entry_method": "break_watcher",
                        "break_level": break_level,
                        "confidence": confidence,
                    })
                else:
                    try:
                        order = live_enter(exchange, state, cfg, symbol, current_px, notional, side="long", journal_path=journal_path)
                        msg = f"LIVE BUY (BREAK_WATCHER) {symbol} px=${current_px:.2f} notional=${notional:.2f} order_id={order.get('id') if order else None}"
                        print(f"[red]{msg}[/red]")
                        append_journal(journal_path, {
                            "type": "trade_open",
                            "mode": "live",
                            "symbol": symbol,
                            "px": current_px,
                            "notional": notional,
                            "entry_method": "break_watcher",
                            "break_level": break_level,
                            "confidence": confidence,
                            "order_id": order.get("id") if order else None,
                        })
                    except Exception as e:
                        print(f"[yellow]break_watcher entry failed:[/yellow] {symbol} {e}")
                        continue

                # Remove from break watchers (filled)
                broken.append(symbol)
                del state["break_watchers"][symbol]
                send_alert(cfg, state, f"Break watcher triggered: {symbol} ${current_px:.2f}")
        except Exception as e:
            print(f"[yellow]break_watcher error {symbol}:[/yellow] {e}")

    return broken


def ensure_break_watchers_state(state):
    """Ensure break watchers state keys exist (safe for old state files)."""
    if not isinstance(state.get("break_watchers"), dict):
        state["break_watchers"] = {}


def score_overnight_candidate(symbol, exchange, cfg, state):
    """
    Score a single overnight candidate (0.0-1.0) based on:
    - Volume surge: recent volume / 1h average
    - Momentum: 1h price change %
    - Gap: today's gap from open
    - Market context: trendline + volume ratio

    Returns: (score, metadata)
    """
    try:
        # Get 1-hour OHLCV for volume & momentum
        ohlcv_1h = get_ohlcv_series(exchange, symbol, "1h", limit=2, state=state)
        if not ohlcv_1h or len(ohlcv_1h) < 2:
            return 0.0, None

        # Get 1-minute for recent context
        ohlcv_1m = get_ohlcv_series(exchange, symbol, "1m", limit=30, state=state)
        if not ohlcv_1m or len(ohlcv_1m) < 5:
            return 0.0, None

        mf_1m = ohlcv_market_features(ohlcv_1m)
        closes_1m = mf_1m.get("closes") or []
        if not closes_1m:
            return 0.0, None

        # Current price
        px = closes_1m[-1]

        # ─ Volume surge ─
        prev_bar_vol = float(ohlcv_1h[-2][5]) if len(ohlcv_1h) > 1 else 0
        curr_bar_vol = float(ohlcv_1h[-1][5])
        vol_surge = (curr_bar_vol / max(prev_bar_vol, 1e-9)) if prev_bar_vol > 0 else 1.0
        vol_surge_norm = min(1.0, vol_surge / 3.0)  # normalize at 3x

        # ─ Momentum ─
        open_1h = float(ohlcv_1h[-1][1])
        close_1h = float(ohlcv_1h[-1][4])
        momentum_pct = ((close_1h - open_1h) / max(abs(open_1h), 1e-9)) * 100
        momentum_norm = min(1.0, abs(momentum_pct) / 5.0)  # normalize at ±5%

        # ─ Gap from open ─
        gap_pct = abs(momentum_pct)
        gap_norm = min(1.0, gap_pct / 3.0)  # normalize at 3%

        # ─ Market context ─
        regime, vol, trend = detect_regime(closes_1m)
        mctx = market_context(closes_1m)
        vol_ratio = float(mctx.get("vol_ratio") or 0.0)
        trendline_bias = float(mctx.get("trendline_bias") or 0.0)
        context_norm = min(1.0, max(vol_ratio, 0.5) / 1.5) * min(1.0, abs(trendline_bias) / 0.0001)

        # ─ Weighted score ─
        scoring = cfg.get("overnight", {}).get("scoring", {})
        w_vol = float(scoring.get("volume_surge_weight", 0.25))
        w_mom = float(scoring.get("momentum_weight", 0.35))
        w_gap = float(scoring.get("gap_weight", 0.20))
        w_ctx = float(scoring.get("after_hours_weight", 0.20))

        score = (w_vol * vol_surge_norm +
                 w_mom * momentum_norm +
                 w_gap * gap_norm +
                 w_ctx * context_norm)

        metadata = {
            "price": px,
            "volume_surge": vol_surge,
            "momentum_pct": momentum_pct,
            "gap_pct": gap_pct,
            "vol_ratio": vol_ratio,
            "regime": regime,
            "score": score,
        }

        return score, metadata

    except Exception as e:
        print(f"[yellow]overnight score error {symbol}:[/yellow] {e}")
        return 0.0, None


def overnight_scout(exchange, cfg, state, journal_path):
    """
    Scan top 200 candidates for best overnight setup.
    Returns: (best_symbol, best_score, best_metadata)
    """
    try:
        scanner_cfg = cfg.get("scanner", {})
        dynamic_max_watch = int(scanner_cfg.get("dynamic_max_watch", 15))

        # Get watched symbols (from morning scan or dynamic)
        candidates = state.get("watched_symbols") or []
        if not candidates:
            candidates = state.get("morning_scan_symbols") or []

        if not candidates:
            # Fallback: build dynamic watchlist
            try:
                if isinstance(exchange, AlpacaAdapter):
                    candidates, _ = build_dynamic_watchlist_alpaca(
                        exchange,
                        scanner_cfg=scanner_cfg,
                        max_watch=200,
                    )
                else:
                    # For other exchanges, use up to 200 symbols
                    candidates = []
            except Exception:
                candidates = []

        candidates = candidates[:200]  # limit scan to top 200
        if not candidates:
            return None, 0.0, None

        # Filter candidates by overnight criteria
        criteria = cfg.get("overnight", {}).get("candidates", {})
        min_price = float(criteria.get("min_price", 1.0))
        max_price = float(criteria.get("max_price", 500.0))
        min_volume_1h = float(criteria.get("min_volume_1h", 500000))
        min_gap_pct = float(criteria.get("min_gap_pct", 0.02))
        min_rsi = float(criteria.get("min_rsi", 40))
        max_rsi = float(criteria.get("max_rsi", 85))

        scores = []
        for symbol in candidates:
            try:
                score, metadata = score_overnight_candidate(symbol, exchange, cfg, state)
                if score <= 0 or not metadata:
                    continue

                px = metadata.get("price", 0)
                gap = metadata.get("gap_pct", 0)

                # Apply criteria filters
                if px < min_price or px > max_price:
                    continue
                if abs(gap) < min_gap_pct:
                    continue

                scores.append((score, symbol, metadata))

            except Exception:
                continue

        if not scores:
            print("[yellow]overnight_scout:[/yellow] no candidates passed criteria")
            return None, 0.0, None

        # Return best candidate
        scores.sort(key=lambda x: x[0], reverse=True)
        best_score, best_symbol, best_metadata = scores[0]

        print(f"[magenta]overnight_scout[/magenta] top candidate: {best_symbol} score={best_score:.2f} price={best_metadata.get('price'):.2f}")

        append_journal(journal_path, {
            "type": "overnight_scout",
            "timestamp": now_utc().isoformat(),
            "best_candidate": best_symbol,
            "score": best_score,
            "metadata": best_metadata,
            "candidates_evaluated": len(candidates),
            "candidates_passed_filter": len(scores),
        })

        return best_symbol, best_score, best_metadata

    except Exception as e:
        print(f"[yellow]overnight_scout error:[/yellow] {e}")
        return None, 0.0, None


def main():
    load_dotenv(dotenv_path=".env", override=True)
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.getenv("BOT_CONFIG", "config.yaml"))
    args = parser.parse_args()
    cfg = load_config(args.config)
    cfg, compiled_rules = apply_study_rules(cfg)
    state_path = cfg["controls"]["state_file"]
    journal_path = cfg.get("controls", {}).get("journal_file", "./journal.jsonl")
    state = load_state(state_path)
    new_day_if_needed(state)
    state["running"] = True
    state["status"] = "RUNNING"
    state["started_at"] = now_utc().isoformat()
    state["last_heartbeat_ts"] = int(time.time())
    save_state(state_path, state)

    # Keep kill switch state persistent across bot restarts.
    # If a kill switch file exists, startup must respect it and block new entries.

    if state["paper_balance"] is None:
        # Try to fetch live balance from broker first, fallback to config
        try:
            exchange = build_exchange(cfg, state=state)
            balance = exchange.fetch_balance()
            # Try USD first, then USDT (Binance demo), then fallback
            total = balance.get("total", {})
            free = balance.get("free", {})
            broker_balance = float(
                total.get("USD") or total.get("USDT") or
                free.get("USD") or free.get("USDT") or
                cfg["risk"]["starting_equity_usd"]
            )
            state["paper_balance"] = broker_balance
            save_state(state_path, state)  # SAVE immediately after fetch
            print(f"[green]Fetched live balance from broker: ${broker_balance:.2f}[/green]")
        except Exception as e:
            state["paper_balance"] = float(cfg["risk"]["starting_equity_usd"])
            save_state(state_path, state)  # SAVE even on error
            print(f"[yellow]Could not fetch live balance ({str(e)[:80]}), using config: ${state['paper_balance']:.2f}[/yellow]")

    # ── SYNC POSITIONS FROM BROKER ─────────────────────────────────────────────
    # If bot state shows no position but broker has one, sync it so the UI
    # displays the correct open position.
    if state.get("position") is None:
        try:
            _sync_ex = build_exchange(cfg, state=state)
            if hasattr(_sync_ex, "fetch_positions"):
                broker_positions = _sync_ex.fetch_positions()
                if broker_positions and isinstance(broker_positions, list) and len(broker_positions) > 0:
                    bp = broker_positions[0]
                    sym = bp.get("symbol", "")
                    side_raw = bp.get("side", "long").lower()
                    qty = abs(float(bp.get("qty", 0) or bp.get("qty_available", 0) or 0))
                    entry = float(bp.get("avg_entry_price", 0) or bp.get("cost_basis", 0) or 0)
                    notional = float(bp.get("market_value", 0) or 0) or (qty * entry)
                    if qty > 0:
                        state["position"] = {
                            "side": side_raw,
                            "symbol": sym,
                            "entry": entry,
                            "qty": qty,
                            "notional": notional,
                            "opened_at": datetime.now(timezone.utc).isoformat(),
                            "entry_order_id": None,
                            "entry_signals": {},
                            "entry_scores": {},
                        }
                        save_state(state_path, state)
                        print(f"[green]Synced broker position: {side_raw.upper()} {sym} qty={qty} entry=${entry:.4f}[/green]")
        except Exception as e:
            print(f"[yellow]Could not sync broker positions: {str(e)[:80]}[/yellow]")

    live_guard(cfg)

    exchange = build_exchange(cfg, state=state)
    scan_symbols = cfg.get("scanner", {}).get("symbols") or [cfg["symbol"]]
    set_leverage_if_supported(exchange, cfg, scan_symbols[0])

    print(f"[green]Starting bot[/green] mode={cfg['mode']} scan={','.join(scan_symbols)}")
    print("[dim]hint:[/dim] touch BUY_NOW | touch SELL_NOW | touch KILL_SWITCH | rm -f KILL_SWITCH")
    append_journal(journal_path, {
        "type": "startup",
        "mode": cfg.get("mode"),
        "scan_symbols": scan_symbols,
        "risk": cfg.get("risk", {}),
        "compiled_rules": compiled_rules,
        "ai_enabled": cfg.get("ai_executor", {}).get("enabled", False),
    })
    send_alert(cfg, state, f"tradebot started mode={cfg['mode']} scan={','.join(scan_symbols)}", force=True)

    heartbeat_count = 0
    while True:
        # Defensive: ensure 'position' key exists and is not broken
        if 'position' not in state:
            state['position']=None
        try:
            _ = state.get('position')
        except Exception as _e:
            print(f"[yellow]Loop defensive: position access error:{_e}")
            state['position']=None
        try:
            new_day_if_needed(state)

            # ── END-OF-DAY REVIEW (checked every loop iteration, runs once at 8pm ET) ──
            check_and_run_eod_review(cfg, state, exchange, journal_path)

            # ── Check for KILL_SWITCH: allow exits, block new entries ──────────
            # If kill_switch exists, force all open positions to close and then block
            # new trades. This prevents GRI-like stale positions from lingering.
            kill_switch_active = os.path.exists(cfg["controls"]["kill_switch_file"])

            blocked = risk_blocked(cfg, state)
            # Only enforce non-kill_switch blocks (daily loss, max trades, etc.)
            # Kill_switch is handled specially: force exits, then block entries
            if blocked and blocked != "kill_switch":
                print(f"[yellow]Trading blocked:[/yellow] {blocked}")
                inc_skip_reason(state, "risk_block", 1)
                send_alert(cfg, state, f"tradebot blocked: {blocked}")
                save_state(state_path, state)
                time.sleep(cfg["poll_seconds"])
                continue

            # ── Multi-position config ─────────────────────────────────────────
            max_open_positions = int(cfg.get("risk", {}).get("max_open_positions", 1))
            # Ensure positions dict exists; migrate legacy single-position if needed
            if not isinstance(state.get("positions"), dict):
                state["positions"] = {}
            if state.get("position") and not state.get("positions"):
                _leg_sym = (
                    state["position"].get("symbol")
                    or state.get("active_symbol")
                    or cfg.get("symbol")
                )
                if _leg_sym:
                    state["positions"][_leg_sym] = state["position"]

            # Reconcile local open positions against broker truth (Alpaca).
            # This prevents canceled/unfilled orders from lingering as "open" in UI/state.
            if isinstance(exchange, AlpacaAdapter):
                _now_sync_ts = int(time.time())
                _last_sync_ts = int(state.get("last_broker_positions_sync_ts", 0) or 0)
                if (_now_sync_ts - _last_sync_ts) >= 10:
                    try:
                        _broker_positions = exchange.fetch_positions() or []
                        _broker_open = set()
                        _broker_map = {}
                        for _bp in _broker_positions:
                            _bsym = str(_bp.get("symbol") or "").upper()
                            try:
                                _bqty = abs(float(_bp.get("qty", 0) or _bp.get("qty_available", 0) or 0))
                            except Exception:
                                _bqty = 0.0
                            if _bsym and _bqty > 0:
                                _broker_open.add(_bsym)
                                _broker_map[_bsym] = _bp
                        _local_positions = state.get("positions") or {}
                        _removed = []
                        _added = []
                        for _lsym in list(_local_positions.keys()):
                            if str(_lsym).upper() not in _broker_open:
                                _removed.append(_lsym)
                                del _local_positions[_lsym]
                        for _bsym, _bp in _broker_map.items():
                            if _bsym not in _local_positions:
                                try:
                                    _bqty = abs(float(_bp.get("qty", 0) or _bp.get("qty_available", 0) or 0))
                                except Exception:
                                    _bqty = 0.0
                                try:
                                    _bentry = float(_bp.get("avg_entry_price") or _bp.get("avg_entry") or _bp.get("entry_price") or 0.0)
                                except Exception:
                                    _bentry = 0.0
                                try:
                                    _bmv = float(_bp.get("market_value") or (_bqty * _bentry) or 0.0)
                                except Exception:
                                    _bmv = 0.0
                                if _bqty > 0:
                                    _local_positions[_bsym] = {
                                        "side": "long" if str(_bp.get("side") or "").lower() != "short" else "short",
                                        "symbol": _bsym,
                                        "entry": _bentry,
                                        "qty": _bqty,
                                        "notional": _bmv or (_bqty * _bentry),
                                        "opened_at": _bp.get("created_at") or now_utc().isoformat(),
                                        "entry_order_id": _bp.get("id"),
                                        "entry_signals": {},
                                        "entry_scores": {},
                                        "entry_regime": "unknown",
                                        "entry_vol": 0.0,
                                        "entry_trend": 0.0,
                                        "entry_setup_type": "none",
                                        "entry_setup_quality": 0.0,
                                        "entry_market_context": {},
                                    }
                                    _added.append(_bsym)
                        if _removed:
                            print(f"[yellow]broker_reconcile[/yellow] removed stale local positions: {', '.join(_removed)}")
                        if _added:
                            print(f"[yellow]broker_reconcile[/yellow] added broker positions: {', '.join(_added)}")
                        _pending_orders = state.get("pending_orders") or {}
                        if _pending_orders and _broker_open:
                            for _oid, _pending in list(_pending_orders.items()):
                                if str(_pending.get("symbol") or "").upper() in _broker_open:
                                    del _pending_orders[_oid]
                            state["pending_orders"] = _pending_orders
                        state["positions"] = _local_positions
                        if not _local_positions:
                            state["position"] = None
                            state["active_symbol"] = None
                        else:
                            _remaining = next(iter(_local_positions.values()))
                            state["position"] = _remaining
                            state["active_symbol"] = _remaining.get("symbol")
                        save_state(state_path, state)
                    except Exception as _sync_ex:
                        print(f"[yellow]broker_reconcile_err:[/yellow] {_sync_ex}")
                    state["last_broker_positions_sync_ts"] = _now_sync_ts

            # ── Early BUY_NOW / SELL_NOW detection (needed by exit sweep) ─────
            buy_file = cfg.get("controls", {}).get("buy_now_file", "BUY_NOW")
            sell_file = cfg.get("controls", {}).get("sell_now_file", "SELL_NOW")
            buy_now = os.path.exists(buy_file)
            buy_now_mult = 1.0
            buy_now_symbol = None
            sell_now = os.path.exists(sell_file)
            if buy_now:
                try:
                    with open(buy_file, "r", errors="ignore") as _bf:
                        _raw_text = (_bf.read() or "").strip()
                        _raw = _raw_text.lower().replace("x", "")
                        _parsed = None
                        try:
                            _parsed = json.loads(_raw_text)
                        except Exception:
                            _parsed = None
                        if isinstance(_parsed, dict):
                            _m = float(_parsed.get("multiplier") or _parsed.get("mult") or 1.0)
                            _sym = str(_parsed.get("symbol") or "").strip().upper()
                            if _m > 0:
                                buy_now_mult = _m
                            if _sym:
                                buy_now_symbol = _sym
                        else:
                            _m = float(_raw) if _raw else 1.0
                            if _m > 0:
                                buy_now_mult = _m
                except Exception:
                    buy_now_mult = 1.0
                    buy_now_symbol = None
                try:
                    os.remove(buy_file)
                except Exception:
                    pass
                print(
                    f"[yellow]Manual override:[/yellow] BUY_NOW detected file={buy_file} "
                    f"mult={buy_now_mult:.2f}x symbol={buy_now_symbol or 'auto'}"
                )
            if sell_now:
                try:
                    os.remove(sell_file)
                except Exception:
                    pass
                print(f"[yellow]Manual override:[/yellow] SELL_NOW detected file={sell_file}")

            # When KILL_SWITCH is active, force all positions to close
            if kill_switch_active:
                print(f"[red]KILL_SWITCH ACTIVE:[/red] forcing all positions to close")
                sell_now = True  # Force market close on all positions
            if should_force_stock_eod_flatten(cfg, exchange):
                print(f"[yellow]EOD flatten:[/yellow] forcing stock positions flat before market close")
                sell_now = True

            # ── MULTI-POSITION EXIT SWEEP ─────────────────────────────────────
            # Each tick: check stop/target/signal exit for every open position
            # independently. Each position closes on its own conditions without
            # affecting others. Trailing stops are ratcheted per-position.
            _mp_stop_pct = float(cfg["risk"].get("stop_loss_pct", 0.8)) / 100.0
            _mp_take_pct = float(cfg["risk"].get("take_profit_pct", 1.2)) / 100.0
            _mp_runner_cfg = cfg.get("runner_strategy", {}) or {}
            _mp_runner_enabled = bool(_mp_runner_cfg.get("enabled", False))
            _mp_strat_scores = state.get("strategy_scores") or {"sma": 0.0, "mom": 0.0, "mr": 0.0}
            _mp_disabled = state.get("disabled_strategies") or []
            for _mp_sym, _mp_pos in list((state.get("positions") or {}).items()):
                try:
                    # Exit sweep only needs recent 5 bars to check exit signals (stop/target/signal)
                    _mp_ohlcv = get_ohlcv_series(exchange, _mp_sym, cfg["timeframe"], limit=5, state=state)
                    _mp_mf = ohlcv_market_features(_mp_ohlcv)
                    _mp_closes = _mp_mf.get("closes") or []
                    if not _mp_closes:
                        continue
                    _mp_px = _mp_closes[-1]
                    _mp_sigs = {
                        "sma": signal_from_sma(_mp_closes, cfg["strategy"]["fast_sma"], cfg["strategy"]["slow_sma"]),
                        "mom": signal_from_momentum(_mp_closes, lookback=12, threshold=0.0008),
                        "mr": signal_from_mean_reversion(_mp_closes, window=20, z_threshold=1.2),
                    }
                    _mp_sig = weighted_ensemble_signal(_mp_sigs, _mp_strat_scores, disabled=_mp_disabled)
                    _mp_side = str(_mp_pos.get("side", "long")).lower()
                    # Trailing stop: ratchet upward for runner trades (or all_trades if configured)
                    if _mp_runner_enabled:
                        _sw_tcfg = _mp_runner_cfg.get("trailing_stop", {}) or {}
                        _sw_t_on = bool(_sw_tcfg.get("enabled", True))
                        _sw_is_runner = bool(_mp_pos.get("is_runner_trade", False))
                        _sw_all = bool(_sw_tcfg.get("all_trades", False))
                        if _sw_t_on and (_sw_is_runner or _sw_all) and _mp_pos.get("trailing_stop") is not None:
                            _new_trail = update_trailing_stop(_mp_pos, _mp_px, _sw_tcfg)
                            _mp_pos["custom_stop"] = _new_trail
                            if _mp_sym in (state.get("positions") or {}):
                                state["positions"][_mp_sym]["custom_stop"] = _new_trail
                    # Stop and take prices
                    if _mp_pos.get("custom_stop") is not None:
                        _mp_stop_px = float(_mp_pos["custom_stop"])
                    elif _mp_side == "long":
                        _mp_stop_px = _mp_pos["entry"] * (1.0 - _mp_stop_pct)
                    else:
                        _mp_stop_px = _mp_pos["entry"] * (1.0 + _mp_stop_pct)
                    if _mp_side == "long":
                        _mp_take_px = _mp_pos["entry"] * (1.0 + _mp_take_pct)
                    else:
                        _mp_take_px = _mp_pos["entry"] * (1.0 - _mp_take_pct)
                    # Minimum hold time: gate signal exits so a flat signal on the very
                    # first tick (e.g. frozen/stale price data) can't churn open→close
                    # every poll cycle with zero PnL. Stop/take/sell_now bypass this
                    # so hard risk limits still fire immediately.
                    _mp_min_hold = int(cfg.get("risk", {}).get("min_hold_sec", 60))
                    _mp_opened_at = _mp_pos.get("opened_at")
                    _mp_held_sec = _mp_min_hold  # default: assume old enough
                    if _mp_opened_at:
                        try:
                            _mp_held_sec = max(0, int(
                                (now_utc() - datetime.fromisoformat(_mp_opened_at)).total_seconds()
                            ))
                        except Exception:
                            pass
                    _mp_signal_exit = (
                        ((_mp_sig == "flat") if _mp_side == "long" else (_mp_sig == "long"))
                        and _mp_held_sec >= _mp_min_hold
                    )
                    _mp_should_exit = (
                        _mp_signal_exit
                        or (_mp_px <= _mp_stop_px if _mp_side == "long" else _mp_px >= _mp_stop_px)
                        or (_mp_px >= _mp_take_px if _mp_side == "long" else _mp_px <= _mp_take_px)
                        or sell_now
                    )
                    if not _mp_should_exit:
                        continue
                    _mp_pos_before = dict(_mp_pos)
                    if cfg["mode"] == "paper":
                        _mp_pnl = paper_exit(state, _mp_px, symbol=_mp_sym)
                        _mp_close_txt = "SELL" if _mp_side == "long" else "BUY_TO_COVER"
                        _mp_msg = (
                            f"PAPER {_mp_close_txt} {_mp_sym} px={_mp_px:.4f} "
                            f"pnl={_mp_pnl:.2f} daily={state['daily_pnl']:.2f}"
                        )
                        print(f"[magenta]{_mp_msg}[/magenta]")
                    else:
                        _mp_order, _mp_pnl = live_exit(exchange, state, cfg, _mp_sym, _mp_px)
                        _mp_close_txt = "SELL" if _mp_side == "long" else "BUY_TO_COVER"
                        _mp_msg = (
                            f"LIVE {_mp_close_txt} {_mp_sym} px={_mp_px:.4f} "
                            f"pnl={_mp_pnl:.2f} "
                            f"order_id={_mp_order.get('id') if _mp_order else None}"
                        )
                        print(f"[red]{_mp_msg}[/red]")
                    _mp_hold_sec = 0
                    try:
                        _mp_opened = _mp_pos_before.get("opened_at")
                        if _mp_opened:
                            _mp_hold_sec = max(0, int(
                                (now_utc() - datetime.fromisoformat(_mp_opened)).total_seconds()
                            ))
                    except Exception:
                        pass
                    _mp_close_ec = _mp_pos_before.get("entry_conditions")
                    _mp_pat_id = _mp_pos_before.get("pattern_match_id")
                    _mp_self_assess = compute_self_assessment(_mp_pnl, _mp_pos_before, _mp_close_ec, cfg)
                    try:
                        _mp_regime_v, _, _ = detect_regime(_mp_closes)
                    except Exception:
                        _mp_regime_v = "unknown"
                    append_journal(journal_path, {
                        "type": "trade_close",
                        "mode": cfg["mode"],
                        "symbol": _mp_sym,
                        "px": _mp_px,
                        "pnl": _mp_pnl,
                        "daily_pnl": state.get("daily_pnl"),
                        "regime": _mp_regime_v,
                        "hold_sec": _mp_hold_sec,
                        "entry_conditions": _mp_close_ec,
                        "pattern_match_id": _mp_pat_id,
                        "self_assessment": _mp_self_assess,
                        "entry": {
                            "px": _mp_pos_before.get("entry"),
                            "qty": _mp_pos_before.get("qty"),
                            "opened_at": _mp_pos_before.get("opened_at"),
                            "regime": _mp_pos_before.get("entry_regime"),
                            "signals": _mp_pos_before.get("entry_signals"),
                        },
                        "exit_signals": _mp_sigs,
                    })
                    _mp_verdict = _mp_self_assess.get("verdict", "")
                    print(
                        f"[dim]self_assess[/dim] {_mp_sym} verdict={_mp_verdict} "
                        f"reason={_mp_self_assess.get('reason','')[:80]}"
                    )
                    send_alert(cfg, state, _mp_msg)
                    if _mp_pnl < 0:
                        state["loss_streak"] = int(state.get("loss_streak", 0)) + 1
                        state["win_streak"] = 0
                        _mp_ls = int(state.get("loss_streak", 0))
                        _mp_auto_bl = bool(cfg.get("risk", {}).get("auto_symbol_blacklist", True))
                        _mp_dis_cd = bool(cfg.get("risk", {}).get("disable_symbol_cooldown", True))
                        if not _mp_dis_cd and _mp_auto_bl:
                            state["cooldown_until"] = int(time.time()) + min(600, 60 * _mp_ls)
                            _mp_sym_cd = state.get("symbol_cooldowns") or {}
                            _mp_sym_cd[_mp_sym] = int(time.time()) + min(1800, 120 * _mp_ls)
                            state["symbol_cooldowns"] = _mp_sym_cd
                    else:
                        state["loss_streak"] = 0
                        state["win_streak"] = int(state.get("win_streak", 0)) + 1
                except Exception as _mp_ex:
                    print(f"[yellow]multi_pos_exit_err {_mp_sym}:[/yellow] {_mp_ex}")

            # KILL_SWITCH auto-clear: if kill_switch was active and all positions are now closed, remove the file
            if kill_switch_active and not (state.get("positions") or {}):
                try:
                    os.remove(cfg["controls"]["kill_switch_file"])
                    print(f"[green]KILL_SWITCH cleared:[/green] all positions closed, file removed")
                except Exception:
                    pass

            # ── OVERNIGHT BOT TRIGGER (3:50 PM ET) ────────────────────────────
            # Runs once per day 10 minutes before close. Scans for best overnight
            # candidate and enters a single position to hold overnight.
            overnight_cfg = cfg.get("overnight", {}) or {}
            overnight_enabled = bool(overnight_cfg.get("enabled", False))
            if overnight_enabled and isinstance(exchange, AlpacaAdapter):
                overnight_run_time = str(overnight_cfg.get("run_time_et", "15:50"))
                now_local_time = now_local().strftime("%H:%M")
                last_overnight_run = state.get("last_overnight_run_date", "")
                today_date = day_str_local()

                # Check if it's time to run and we haven't run today yet
                if now_local_time >= overnight_run_time and last_overnight_run != today_date:
                    print(f"[bold magenta]OVERNIGHT BOT[/bold magenta] trigger at {now_local_time} ET")
                    best_symbol, best_score, best_metadata = overnight_scout(
                        exchange, cfg, state, journal_path
                    )

                    if best_symbol and best_score > 0:
                        # Get current price
                        try:
                            ohlcv = get_ohlcv_series(exchange, best_symbol, cfg["timeframe"], limit=1, state=state)
                            if ohlcv and len(ohlcv) > 0:
                                px = float(ohlcv[-1][4])
                                notional = float(overnight_cfg.get("position", {}).get("notional", 100.0))

                                # Enter overnight position
                                if cfg["mode"] == "paper":
                                    paper_enter(state, best_symbol, px, notional, side="long")
                                    msg = f"PAPER BUY (OVERNIGHT) {best_symbol} px=${px:.2f} notional=${notional:.2f}"
                                    print(f"[cyan]{msg}[/cyan]")
                                    append_journal(journal_path, {
                                        "type": "trade_open",
                                        "mode": "paper",
                                        "symbol": best_symbol,
                                        "px": px,
                                        "notional": notional,
                                        "entry_method": "overnight_bot",
                                        "overnight_score": best_score,
                                        "metadata": best_metadata,
                                    })
                                else:
                                    try:
                                        order = live_enter(exchange, state, cfg, best_symbol, px, notional, side="long", journal_path=journal_path)
                                        msg = f"LIVE BUY (OVERNIGHT) {best_symbol} px=${px:.2f} notional=${notional:.2f} order_id={order.get('id') if order else None}"
                                        print(f"[red]{msg}[/red]")
                                        append_journal(journal_path, {
                                            "type": "trade_open",
                                            "mode": "live",
                                            "symbol": best_symbol,
                                            "px": px,
                                            "notional": notional,
                                            "entry_method": "overnight_bot",
                                            "overnight_score": best_score,
                                            "metadata": best_metadata,
                                            "order_id": order.get("id") if order else None,
                                        })
                                    except Exception as e:
                                        print(f"[yellow]overnight entry failed:[/yellow] {best_symbol} {e}")

                                # Mark position as overnight hold
                                if state.get("position"):
                                    state["position"]["is_overnight_hold"] = True
                                    state["position"]["overnight_entry_time"] = now_local().isoformat()
                                if state.get("positions") and best_symbol in state.get("positions", {}):
                                    state["positions"][best_symbol]["is_overnight_hold"] = True
                                    state["positions"][best_symbol]["overnight_entry_time"] = now_local().isoformat()

                                send_alert(cfg, state, msg)
                                state["trades_today"] = int(state.get("trades_today", 0)) + 1

                        except Exception as e:
                            print(f"[yellow]overnight bot error:[/yellow] {e}")

                    state["last_overnight_run_date"] = today_date

            # ── OVERNIGHT MORNING EXIT (09:35 AM ET) ────────────────────────────
            # If an overnight position exists, exit it at 09:35 AM ET (5 min after open)
            # or on first signal (exit_on_any=true)
            if overnight_enabled:
                overnight_exit_time = str(overnight_cfg.get("morning_exit", {}).get("exit_time_et", "09:35"))
                now_local_time_morning = now_local().strftime("%H:%M")
                positions_now = state.get("positions") or {}
                overnight_positions = [
                    (sym, pos) for sym, pos in positions_now.items()
                    if pos.get("is_overnight_hold")
                ]

                # Time-based exit at 09:35 ET
                if now_local_time_morning >= overnight_exit_time and overnight_positions:
                    print(f"[bold yellow]OVERNIGHT EXIT TIME[/bold yellow] triggered at {now_local_time_morning} ET")
                    for _on_sym, _on_pos in overnight_positions:
                        try:
                            # Get current price and exit
                            ohlcv = get_ohlcv_series(exchange, _on_sym, cfg["timeframe"], limit=1, state=state)
                            if ohlcv and len(ohlcv) > 0:
                                px = float(ohlcv[-1][4])
                                if cfg["mode"] == "paper":
                                    pnl = paper_exit(state, px, symbol=_on_sym)
                                    msg = f"PAPER SELL (OVERNIGHT_EXIT) {_on_sym} px=${px:.2f} pnl=${pnl:.2f}"
                                    print(f"[magenta]{msg}[/magenta]")
                                else:
                                    order, pnl = live_exit(exchange, state, cfg, _on_sym, px)
                                    msg = f"LIVE SELL (OVERNIGHT_EXIT) {_on_sym} px=${px:.2f} pnl=${pnl:.2f} order_id={order.get('id') if order else None}"
                                    print(f"[red]{msg}[/red]")
                                append_journal(journal_path, {
                                    "type": "trade_close",
                                    "symbol": _on_sym,
                                    "px": px,
                                    "pnl": pnl,
                                    "close_reason": "overnight_exit_time",
                                })
                                send_alert(cfg, state, msg)
                        except Exception as e:
                            print(f"[yellow]overnight exit error {_on_sym}:[/yellow] {e}")

            # ── BREAK WATCHERS CHECK ───────────────────────────────────────
            # Check if any symbols broke their resistance levels and auto-enter
            broken_syms = check_break_watchers(state, exchange, cfg, journal_path)
            if broken_syms:
                state["trades_today"] = int(state.get("trades_today", 0)) + len(broken_syms)

            strategy_scores = state.get("strategy_scores") or {"sma": 0.0, "mom": 0.0, "mr": 0.0}
            strategy_stats = state.get("strategy_stats") or {
                "sma": {"samples": 0, "wins": 0, "reward_sum": 0.0},
                "mom": {"samples": 0, "wins": 0, "reward_sum": 0.0},
                "mr": {"samples": 0, "wins": 0, "reward_sum": 0.0},
            }
            disabled_strategies = state.get("disabled_strategies") or []
            runner_strategy_cfg = cfg.get("runner_strategy", {}) or {}
            runner_strategy_enabled = bool(runner_strategy_cfg.get("enabled", False))

            pos = state["position"]
            active_symbol = state.get("active_symbol")
            if pos is not None and not active_symbol:
                active_symbol = pos.get("symbol") or cfg.get("symbol")
                state["active_symbol"] = active_symbol
            # Multi-position: always scan for the best entry candidate.
            # Exits are handled by the sweep above; no symbol lock needed.
            target_symbol = None

            # If flat, scan symbols and pick best confidence signal from dynamic/static watchlist
            scan_rows = []
            now_ts = int(time.time())
            symbol_cooldowns = state.get("symbol_cooldowns") or {}
            disable_symbol_cooldown = bool(cfg.get("risk", {}).get("disable_symbol_cooldown", True))

            scanner_cfg = cfg.get("scanner", {})
            dynamic_enabled = bool(scanner_cfg.get("dynamic_enabled", True))
            dynamic_max_watch = int(scanner_cfg.get("dynamic_max_watch", 5))
            dynamic_rebalance_sec = int(scanner_cfg.get("dynamic_rebalance_sec", 180))

            scan_universe = scan_symbols[:]
            if any(str(s).upper() == "ALL" for s in scan_symbols):
                try:
                    if isinstance(exchange, AlpacaAdapter):
                        _exch_mode = str(scanner_cfg.get("dynamic_exchange", "us")).lower()
                        if _exch_mode in ("us", "all_us", "nyse_nasdaq") and hasattr(exchange, "list_us_symbols"):
                            scan_universe = exchange.list_us_symbols(exchange_mode="us")
                        else:
                            scan_universe = exchange.list_nasdaq_symbols()
                    elif isinstance(exchange, OandaAdapter):
                        scan_universe = exchange.list_symbols()
                    else:
                        mkts = getattr(exchange, "markets", {}) or {}
                        quotes = scanner_cfg.get("all_quotes", ["USD", "USDT", "USDC"]) or ["USD", "USDT", "USDC"]
                        quotes = {str(q).upper() for q in quotes}
                        max_uni = int(scanner_cfg.get("dynamic_max_universe", 2000))
                        syms = []
                        for sym, m in mkts.items():
                            if isinstance(m, dict):
                                if not m.get("active", True):
                                    continue
                                q = str(m.get("quote") or "").upper()
                                if quotes and q and q not in quotes:
                                    continue
                            syms.append(sym)
                        syms = sorted(set(syms))

                        # ── Liquidity filter: keep top-N by 24h dollar volume ──
                        max_uni_size = int(scanner_cfg.get("max_universe_size", 0))
                        if max_uni_size > 0 and syms:
                            _ticker_cache_ts = int(state.get("_ticker_cache_ts", 0) or 0)
                            _ticker_cache_age = now_ts - _ticker_cache_ts
                            if _ticker_cache_age > 1800 or not state.get("_ticker_cache"):
                                # refresh ticker cache at most every 30 min
                                try:
                                    _tickers = exchange.fetch_tickers()
                                    state["_ticker_cache"] = _tickers
                                    state["_ticker_cache_ts"] = now_ts
                                except Exception:
                                    _tickers = state.get("_ticker_cache") or {}
                            else:
                                _tickers = state.get("_ticker_cache") or {}
                            if _tickers:
                                _vol_pairs = []
                                for _s in syms:
                                    _t = _tickers.get(_s) or {}
                                    _last = float(_t.get("last") or 0)
                                    _bvol = float(_t.get("baseVolume") or 0)
                                    _vol_pairs.append((_last * _bvol, _s))
                                _vol_pairs.sort(reverse=True)
                                syms = [_s for _, _s in _vol_pairs[:max(1, max_uni_size)]]

                        # ── Dedup: prefer BASE/USD over BASE/USDC when both exist ──
                        _usd_bases = {
                            str(s).split("/")[0].upper()
                            for s in syms
                            if "/" in str(s) and str(s).split("/", 1)[1].upper() == "USD"
                        }
                        syms = [
                            s for s in syms
                            if not (
                                "/" in str(s)
                                and str(s).split("/", 1)[1].upper() == "USDC"
                                and str(s).split("/")[0].upper() in _usd_bases
                            )
                        ]

                        scan_universe = syms[:max(1, max_uni)] if syms else scan_symbols[:]
                except Exception:
                    scan_universe = scan_symbols[:]

            scan_candidates = scan_universe
            if dynamic_enabled:
                ms_cfg_inner = scanner_cfg.get("morning_scan", {}) or {}
                morning_scan_enabled = bool(ms_cfg_inner.get("enabled", False))
                ensure_morning_scan_state(state)
                today_scan = day_str_local()

                if morning_scan_enabled:
                    # ── MORNING SCAN: run once per trading day (stocks) or on a
                    # rolling interval for 24/7 assets like crypto.
                    # scan_interval_hours (default 6) replaces the calendar-day
                    # check for non-Alpaca exchanges so crypto is rescanned every
                    # N hours regardless of wall-clock date.
                    ms_symbols = state.get("morning_scan_symbols") or []
                    ms_date = state.get("morning_scan_date") or ""
                    scan_interval_hours = int(ms_cfg_inner.get("scan_interval_hours", 6))
                    use_interval = scan_interval_hours > 0 and not isinstance(exchange, AlpacaAdapter)
                    last_scan_ts = int(state.get("morning_scan_ts", 0) or 0)
                    if use_interval:
                        need_rescan = (not ms_symbols) or ((now_ts - last_scan_ts) >= scan_interval_hours * 3600)
                    else:
                        need_rescan = (not ms_symbols) or (ms_date != today_scan)
                    if need_rescan:
                        ms_max_watch = int(ms_cfg_inner.get("max_watch", dynamic_max_watch))
                        _scan_label = f"every {scan_interval_hours}h" if use_interval else "daily"
                        print(f"[cyan]morning_scan[/cyan] running {_scan_label} scan ({today_scan}) ...")
                        source = str(scanner_cfg.get("dynamic_source", "")).lower()
                        ms_snapshot = None
                        try:
                            if source in ("alpaca_nasdaq", "alpaca_us") and isinstance(exchange, AlpacaAdapter):
                                ms_watched, ms_ranked, ms_snapshot = build_morning_scan_alpaca(
                                    exchange,
                                    scanner_cfg,
                                    max_watch=ms_max_watch,
                                    state=state,
                                    include_snapshot=True,
                                    scan_type="morning_scan",
                                )
                            else:
                                ms_watched, ms_ranked = build_morning_scan_generic(
                                    exchange, scan_universe, cfg["timeframe"],
                                    state=state, max_watch=ms_max_watch, scanner_cfg=scanner_cfg,
                                )
                        except Exception as _ms_e:
                            print(f"[yellow]morning_scan error:[/yellow] {_ms_e} — falling back to dynamic scan")
                            try:
                                if source in ("alpaca_nasdaq", "alpaca_us") and isinstance(exchange, AlpacaAdapter):
                                    ms_watched, ms_ranked, ms_snapshot = build_dynamic_watchlist_alpaca(
                                        exchange,
                                        scanner_cfg=scanner_cfg,
                                        max_watch=ms_max_watch,
                                        include_snapshot=True,
                                        scan_type="morning_scan_fallback",
                                    )
                                else:
                                    ms_watched, ms_ranked = scan_universe[:ms_max_watch], []
                            except Exception:
                                ms_watched, ms_ranked = scan_universe[:ms_max_watch], []
                        state["morning_scan_symbols"] = ms_watched
                        state["morning_scan_ranked"] = ms_ranked[:30]
                        state["morning_scan_date"] = today_scan
                        state["morning_scan_ts"] = now_ts
                        state["watched_symbols"] = ms_watched
                        state["watched_ranked"] = ms_ranked[:20]
                        state["watchlist_updated_at"] = now_ts
                        # Persist immediately so UI/trading sees the watchlist even if later scan logging stalls.
                        save_state(state_path, state)
                        append_watchlist_reflection({
                            "type": "watchlist_update",
                            "scan_type": "morning_scan",
                            "symbols": ms_watched,
                            "ranked": ms_ranked[:20],
                            "scan_ts": now_ts,
                        })
                        _top5 = ms_watched[:5]
                        print(
                            f"[cyan]morning_scan[/cyan] {len(ms_watched)} symbols selected for {today_scan}: "
                            f"{_top5}{' ...' if len(ms_watched) > 5 else ''}"
                        )
                        append_journal(journal_path, {
                            "type": "morning_scan",
                            "date": today_scan,
                            "symbols": ms_watched,
                            "top_ranked": ms_ranked[:10],
                        })
                        if isinstance(exchange, AlpacaAdapter) and ms_snapshot:
                            _record_runner_scan_snapshot(state, journal_path, ms_snapshot)
                        send_alert(cfg, state, f"morning_scan {today_scan}: {len(ms_watched)} symbols in play: {_top5}")
                    scan_candidates = state.get("morning_scan_symbols") or state.get("watched_symbols") or scan_universe

                    # ── INTRADAY RESCAN: Even with morning_scan enabled, refresh watchlist every 10 min ──
                    # This catches NEW runners that pop up mid-day (not in morning scan)
                    intraday_rescan_interval = int(scanner_cfg.get("intraday_rescan_interval_sec", 600))  # 10 min
                    last_intraday_scan = int(state.get("intraday_rescan_ts", 0) or 0)
                    if intraday_rescan_interval > 0 and (now_ts - last_intraday_scan) >= intraday_rescan_interval:
                        print(f"[cyan]intraday_rescan[/cyan] refreshing watchlist ({now_ts - last_intraday_scan}s since last)...")
                        try:
                            source = str(scanner_cfg.get("dynamic_source", "")).lower()
                            # Re-scan with same max_watch as morning scan
                            intraday_snapshot = None
                            if source in ("alpaca_nasdaq", "alpaca_us") and isinstance(exchange, AlpacaAdapter):
                                intraday_watched, intraday_ranked, intraday_snapshot = build_dynamic_watchlist_alpaca(
                                    exchange,
                                    scanner_cfg=scanner_cfg,
                                    max_watch=dynamic_max_watch,
                                    include_snapshot=True,
                                    scan_type="intraday_rescan",
                                )
                            else:
                                intraday_watched, intraday_ranked = scan_universe[:dynamic_max_watch], []
                            # Merge: keep pinned symbols + add new runners found in rescan
                            pinned = cfg.get("scanner", {}).get("pinned_symbols") or []
                            prior_watched = state.get("watched_symbols") or state.get("morning_scan_symbols") or []
                            merged_watched = list(dict.fromkeys(
                                [str(s) for s in pinned]
                                + [str(s) for s in prior_watched]
                                + [str(s) for s in intraday_watched[:dynamic_max_watch]]
                            ))
                            scan_candidates = merged_watched
                            state["watched_symbols"] = merged_watched
                            # Keep UI/state in sync with the latest intraday refresh.
                            if isinstance(intraday_ranked, list):
                                state["watched_ranked"] = intraday_ranked[:20]
                            state["watchlist_updated_at"] = now_ts
                            state["intraday_rescan_ts"] = now_ts
                            # Keep the watchlist durable before reflection/journal side effects.
                            save_state(state_path, state)
                            append_watchlist_reflection({
                                "type": "watchlist_update",
                                "scan_type": "intraday_rescan",
                                "symbols": merged_watched,
                                "ranked": intraday_ranked[:20] if isinstance(intraday_ranked, list) else [],
                                "scan_ts": now_ts,
                            })
                            if isinstance(exchange, AlpacaAdapter) and intraday_snapshot:
                                intraday_snapshot["scan_type"] = "intraday_rescan"
                                intraday_snapshot["selected_symbols"] = merged_watched
                                _record_runner_scan_snapshot(state, journal_path, intraday_snapshot)
                            print(f"[cyan]intraday_rescan[/cyan] found {len(intraday_watched)} candidates, using {len(scan_candidates)}")
                        except Exception as _ir_e:
                            print(f"[yellow]intraday_rescan error:[/yellow] {_ir_e} — keeping current watchlist")
                            scan_candidates = state.get("morning_scan_symbols") or state.get("watched_symbols") or scan_universe
                else:
                    # ── ROLLING REBALANCE (existing 30-min behavior) ────────────
                    last_upd = int(state.get("watchlist_updated_at", 0) or 0)
                    watched = state.get("watched_symbols") or []
                    if (not watched) or ((now_ts - last_upd) >= dynamic_rebalance_sec):
                        source = str(scanner_cfg.get("dynamic_source", "")).lower()
                        if source in ("alpaca_nasdaq", "alpaca_us") and isinstance(exchange, AlpacaAdapter):
                            watched, ranked, snapshot = build_dynamic_watchlist_alpaca(
                                exchange,
                                scanner_cfg=scanner_cfg,
                                max_watch=dynamic_max_watch,
                                include_snapshot=True,
                                scan_type="dynamic_rebalance",
                            )
                        else:
                            watched, ranked = build_dynamic_watchlist(
                                exchange,
                                scan_universe,
                                cfg["timeframe"],
                                strategy_scores,
                                disabled_strategies,
                                state=state,
                                max_watch=dynamic_max_watch,
                                scanner_cfg=scanner_cfg,
                            )
                        state["watched_symbols"] = watched
                        state["watched_ranked"] = ranked[:20]
                        state["watchlist_updated_at"] = now_ts
                        append_watchlist_reflection({
                            "type": "watchlist_update",
                            "scan_type": "dynamic_rebalance",
                            "symbols": watched,
                            "ranked": ranked[:20],
                            "scan_ts": now_ts,
                        })
                        if isinstance(exchange, AlpacaAdapter):
                            _record_runner_scan_snapshot(state, journal_path, snapshot)
                    scan_candidates = state.get("watched_symbols") or scan_universe
            else:
                static_watch = scan_universe[:]
                if state.get("watched_symbols") != static_watch:
                    state["watched_symbols"] = static_watch
                    state["watched_ranked"] = [
                        {"symbol": s, "score": 1.0, "signal": "watch"}
                        for s in static_watch[:20]
                    ]
                    state["watchlist_updated_at"] = now_ts
                    append_watchlist_reflection({
                        "type": "watchlist_update",
                        "scan_type": "static_watch",
                        "symbols": static_watch,
                        "ranked": state["watched_ranked"][:20],
                        "scan_ts": now_ts,
                    })

            # Merge pinned_symbols from config — always included at front of scan_candidates
            # regardless of dynamic scoring, so user-added symbols are never evicted.
            pinned_syms = [
                str(s).strip().upper()
                for s in (scanner_cfg.get("pinned_symbols") or [])
                if isinstance(s, str) and str(s).strip()
            ]
            if pinned_syms:
                existing_upper = {str(s).upper() for s in scan_candidates}
                extras = [s for s in pinned_syms if s not in existing_upper]
                if extras:
                    scan_candidates = extras + list(scan_candidates)
                    print(f"[cyan]pinned_symbols[/cyan] prepended {extras} to scan_candidates")

            # ── RUNNER SCANNER: every 5 min check watched symbols for runners ──
            # Flags symbols in a strong move and keeps them at the front of
            # scan_candidates so they get priority every tick.
            _cached_runners = state.get("runner_flagged_symbols") or []
            _open_or_pending_count = len(state.get("positions") or {}) + len(state.get("pending_orders") or {})
            if runner_strategy_enabled and _open_or_pending_count < max_open_positions:
                _runner_scan_interval = 300  # 5 minutes
                _last_runner_scan_ts = int(state.get("runner_scan_ts", 0) or 0)
                if (now_ts - _last_runner_scan_ts) >= _runner_scan_interval:
                    _runner_flagged = []
                    _runner_watch_pool = (state.get("watched_symbols") or scan_candidates)[:dynamic_max_watch]
                    for _rs_sym in _runner_watch_pool:
                        try:
                            _rs_ohlcv = get_ohlcv_series(exchange, _rs_sym, cfg["timeframe"], limit=30, state=state)
                            _runner_info = detect_runner(_rs_ohlcv, runner_strategy_cfg)
                            if _runner_info["is_runner"]:
                                _runner_flagged.append(_rs_sym)
                                print(
                                    f"[magenta]runner_scan[/magenta] {_rs_sym} is_runner=True "
                                    f"{_runner_info['reason']}"
                                )
                        except Exception:
                            continue
                    state["runner_flagged_symbols"] = _runner_flagged
                    state["runner_scan_ts"] = now_ts
                    if _runner_flagged:
                        append_journal(journal_path, {
                            "type": "runner_scan",
                            "runners": _runner_flagged,
                            "scan_candidates_top5": scan_candidates[:5],
                        })
                # Every tick: prepend cached runner symbols to front of scan_candidates
                _cached_runners = state.get("runner_flagged_symbols") or []
            if _cached_runners:
                _runner_set = set(_cached_runners)
                scan_candidates = _cached_runners + [s for s in scan_candidates if s not in _runner_set]

            force_first_watchlist_buy = bool(cfg.get("strategy", {}).get("force_first_watchlist_buy", True))
            force_first_ohlcv = None
            if (
                force_first_watchlist_buy
                and target_symbol is None
                and _open_or_pending_count < max_open_positions
            ):
                _held_symbols = set(state.get("positions") or {})
                for _cand in scan_candidates:
                    if str(_cand).upper() == "ALL":
                        continue
                    if _cand in _held_symbols:
                        continue
                    if (not disable_symbol_cooldown) and int(symbol_cooldowns.get(_cand, 0)) > now_ts:
                        continue
                    try:
                        _cand_ohlcv = get_ohlcv_series(exchange, _cand, cfg["timeframe"], limit=5, state=state)
                        _cand_closes = ohlcv_market_features(_cand_ohlcv)["closes"]
                    except Exception as _exc:
                        print(f"[yellow]auto_buy[/yellow] skip {_cand}: OHLCV error {_exc}")
                        continue
                    if not _cand_closes:
                        print(f"[yellow]auto_buy[/yellow] skip {_cand}: no OHLCV closes")
                        continue
                    target_symbol = _cand
                    force_first_ohlcv = _cand_ohlcv
                    buy_now = True
                    buy_now_symbol = target_symbol
                    buy_now_mult = 1.0
                    print(
                        f"[cyan]auto_buy[/cyan] first eligible watchlist symbol {target_symbol} "
                        f"watchlist_head={scan_candidates[:3]}"
                    )
                    break

            if target_symbol is None:
                if buy_now and buy_now_symbol:
                    target_symbol = buy_now_symbol
                    print(f"[yellow]Manual BUY target:[/yellow] forcing symbol {target_symbol}")
                else:
                    _held_symbols = set(state.get("positions") or {})
                    for s in scan_candidates:
                        if str(s).upper() == "ALL":
                            continue  # Skip the "ALL" directive; it's not a real symbol
                        if s in _held_symbols:
                            continue  # already holding this symbol — don't double-enter
                        if (not disable_symbol_cooldown) and int(symbol_cooldowns.get(s, 0)) > now_ts:
                            continue
                        # Reduced from 120 to 5: only need recent 5 minutes of 1-min candles for watching runners
                        # Full historical analysis happens in morning_scan; watcher just monitors momentum
                        ohlcv_s = get_ohlcv_series(exchange, s, cfg["timeframe"], limit=5, state=state)
                        mf_s = ohlcv_market_features(ohlcv_s)
                        closes_s = mf_s["closes"]
                        if not closes_s:
                            continue
                        px_s = closes_s[-1]
                        sigs_s = {
                            "sma": signal_from_sma(closes_s, cfg["strategy"]["fast_sma"], cfg["strategy"]["slow_sma"]),
                            "mom": signal_from_momentum(closes_s, lookback=12, threshold=0.0008),
                            "mr": signal_from_mean_reversion(closes_s, window=20, z_threshold=1.2),
                        }
                        sig_s = weighted_ensemble_signal(sigs_s, strategy_scores, disabled=disabled_strategies)
                        conf_s = signal_confidence(sigs_s, strategy_scores, disabled=disabled_strategies)
                        regime_s, vol_s, trend_s = detect_regime(closes_s)
                        scan_rows.append((conf_s, s, px_s, sig_s, sigs_s, regime_s, vol_s, trend_s))
                    if not scan_rows:
                        if not disable_symbol_cooldown:
                            state["symbol_cooldowns"] = {k: v for k, v in symbol_cooldowns.items() if int(v) > now_ts}
                        save_state(state_path, state)
                        time.sleep(cfg["poll_seconds"])
                        continue
                    scan_rows.sort(key=lambda x: x[0], reverse=True)
                    # Prioritize runner-flagged symbols regardless of ensemble confidence
                    _rf_set = set(state.get("runner_flagged_symbols") or [])
                    if _rf_set:
                        _runner_scan_rows = [r for r in scan_rows if r[1] in _rf_set]
                        _nonrunner_scan_rows = [r for r in scan_rows if r[1] not in _rf_set]
                        if _runner_scan_rows:
                            scan_rows = _runner_scan_rows + _nonrunner_scan_rows
                    if target_symbol is None:
                        _, target_symbol, _, _, _, _, _, _ = scan_rows[0]

            # Fetch more bars (30) for target to get better signal quality on selected symbol
            # (vs 5 bars for watchlist scan which just qualifies candidates)
            ohlcv = get_ohlcv_series(exchange, target_symbol, cfg["timeframe"], limit=30, state=state)
            mf = ohlcv_market_features(ohlcv)
            closes = mf["closes"]
            if not closes and force_first_ohlcv:
                ohlcv = force_first_ohlcv
                mf = ohlcv_market_features(ohlcv)
                closes = mf["closes"]
            if not closes:
                print(f"[yellow]No OHLCV closes for {target_symbol}, skipping tick[/yellow]")
                save_state(state_path, state)
                time.sleep(cfg["poll_seconds"])
                continue
            px = closes[-1]
            signals = {
                "sma": signal_from_sma(closes, cfg["strategy"]["fast_sma"], cfg["strategy"]["slow_sma"]),
                "mom": signal_from_momentum(closes, lookback=12, threshold=0.0003),
                "mr": signal_from_mean_reversion(closes, window=20, z_threshold=0.85),
            }
            regime, vol, trend = detect_regime(closes)
            if regime == "chop":
                state["chop_streak"] = int(state.get("chop_streak", 0) or 0) + 1
            else:
                state["chop_streak"] = 0
            mctx = market_context(closes)
            obf = orderbook_features(exchange, target_symbol, state=state)
            mctx["vwap_20"] = mf.get("vwap_20")
            mctx["vol_ratio"] = mf.get("vol_ratio")
            mctx["trendline_bias"] = mf.get("trendline_bias")
            mctx["ob_imbalance"] = obf.get("ob_imbalance")
            mctx["spread_bps"] = obf.get("spread_bps")

            # Per-symbol tracking so multi-position mode accumulates strategy stats
            # for whichever symbol is currently being evaluated, not just the active hold.
            last_px = (state.get("last_px_by_sym") or {}).get(str(target_symbol))
            last_signals = (state.get("last_signals_by_sym") or {}).get(str(target_symbol))
            if last_px is not None and last_signals:
                d = px - last_px
                for name, last_sig in last_signals.items():
                    reward = 0.0
                    if last_sig == "long":
                        reward = d
                    elif last_sig == "flat":
                        reward = -d
                    strategy_scores[name] = (0.98 * float(strategy_scores.get(name, 0.0))) + (0.0005 * reward)
                    s = strategy_stats.setdefault(name, {"samples": 0, "wins": 0, "reward_sum": 0.0})
                    s["samples"] = int(s.get("samples", 0)) + 1
                    if reward > 0:
                        s["wins"] = int(s.get("wins", 0)) + 1
                    s["reward_sum"] = float(s.get("reward_sum", 0.0)) + float(reward)

            heartbeat_count += 1
            # DISABLED: Auto-disable worst strategy after 80 samples
            # if heartbeat_count % 20 == 0 and len(disabled_strategies) < 1:
            #     candidates = []
            #     for name, s in strategy_stats.items():
            #         n = int(s.get("samples", 0))
            #         if n >= 80 and name not in disabled_strategies:
            #             avg = float(s.get("reward_sum", 0.0)) / n
            #             candidates.append((avg, name, n))
            #     if candidates:
            #         candidates.sort(key=lambda x: x[0])
            #         worst_avg, worst_name, worst_n = candidates[0]
            #         disabled_strategies.append(worst_name)
            #         print(f"[yellow]ensemble[/yellow] disabled worst strategy={worst_name} avg_reward={worst_avg:.6f} samples={worst_n}")

            sig = weighted_ensemble_signal(signals, strategy_scores, disabled=disabled_strategies)
            runner_signal = None  # set to "long" when runner catch conditions are met
            _rd = None            # runner detection result (populated below if runner_strategy_enabled)
            setup_type, setup_quality = detect_setup_type(signals, mctx, regime)

            ai_snapshot = {
                "symbol": target_symbol,
                "price": round(float(px), 6),
                "regime": regime,
                "volatility": round(float(vol), 6),
                "trend_strength": round(float(trend), 6),
                "market_context": mctx,
                "signals": signals,
                "setup_type": setup_type,
                "setup_quality": setup_quality,
                "scores": strategy_scores,
                "disabled": disabled_strategies,
                "position": state.get("position"),
                "scan_top": [
                    {"symbol": r[1], "sig": r[3], "confidence": round(float(r[0]), 4)}
                    for r in (scan_rows[:5] if scan_rows else [])
                ],
                "risk": cfg.get("risk", {}),
                "cooldown_until": state.get("cooldown_until", 0),
            }
            # OPTIMIZATION: Skip AI gate if latency_optimized is true (saves 1-3 seconds per signal)
            ai_gate_enabled = cfg.get("strategy", {}).get("ai_gate_enabled", True)
            latency_optimized = cfg.get("strategy", {}).get("latency_optimized", False)
            skip_ai_for_speed = latency_optimized and not ai_gate_enabled

            if skip_ai_for_speed:
                ai_decision = None  # Skip AI gate entirely
            else:
                ai_decision = ai_decide(cfg, state, ai_snapshot)

            # Track whether AI explicitly blocked entry so downstream overrides don't sneak past it.
            ai_said_hold = False
            if ai_decision:
                ai_source = ai_decision.get("source", "model")
                if ai_source == "policy_cache":
                    state["policy_cache_hits_today"] = int(state.get("policy_cache_hits_today", 0)) + 1
                    state["non_api_decisions_today"] = int(state.get("non_api_decisions_today", 0)) + 1
                ai_action = ai_decision.get("action")
                state["ai_last_action"] = str(ai_action or "")
                state["ai_last_symbol"] = str(ai_decision.get("symbol") or target_symbol or "")
                state["ai_last_decision_ts"] = int(time.time())
            else:
                state["non_api_decisions_today"] = int(state.get("non_api_decisions_today", 0)) + 1

            if ai_decision:
                # ai_action already set above in the first ai_decision block; reuse it here.
                ai_conf = float(ai_decision.get("confidence", 0.0) or 0.0)
                min_conf_open = float(cfg.get("ai_executor", {}).get("min_confidence_open", 0.66))
                min_conf_close = float(cfg.get("ai_executor", {}).get("min_confidence_close", 0.60))

                # Runner-catcher: lower OPEN threshold for explosive movers with acceptable spread/liquidity.
                runner_cfg = cfg.get("runner_mode", {}) or {}
                runner_trigger = False
                if bool(runner_cfg.get("enabled", False)):
                    ret15 = abs(float(mctx.get("ret_15") or 0.0))
                    vol_ratio_now = float(mctx.get("vol_ratio") or 0.0)
                    sp = mctx.get("spread_bps")
                    spread_ok = (sp is None) or (float(sp) <= float(runner_cfg.get("max_spread_bps", 120.0)))
                    runner_trigger = (
                        ret15 >= float(runner_cfg.get("ret15_runner_min", 0.06))
                        and vol_ratio_now >= float(runner_cfg.get("vol_ratio_min", 0.35))
                        and spread_ok
                    )
                    if runner_trigger:
                        min_conf_open = max(0.40, min_conf_open - float(runner_cfg.get("open_confidence_discount", 0.12)))

                if ai_action == "OPEN" and ai_conf >= min_conf_open:
                    sig = "long"
                    ai_symbol = ai_decision.get("symbol")
                    if isinstance(ai_symbol, str) and ai_symbol in (scan_candidates or scan_symbols):
                        target_symbol = ai_symbol
                elif ai_action == "CLOSE" and ai_conf >= min_conf_close:
                    sig = "flat"
                elif ai_action == "HOLD":
                    # Optional chaos runner override: allow momentum entry in chaos if runner trigger fires.
                    if (
                        regime == "chaos"
                        and runner_trigger
                        and bool(runner_cfg.get("allow_chaos_override", False))
                    ):
                        runner_sig = "flat"
                        if signals.get("mom") in ("long", "short"):
                            runner_sig = str(signals.get("mom"))
                        elif signals.get("sma") in ("long", "short"):
                            runner_sig = str(signals.get("sma"))
                        if runner_sig in ("long", "short"):
                            sig = runner_sig
                            print(f"[magenta]runner_override[/magenta] regime=chaos forced_sig={runner_sig}")
                        else:
                            sig = "hold"
                            ai_said_hold = True
                            inc_skip_reason(state, "ai_hold", 1)
                    else:
                        # AI says HOLD — enforce it by resetting sig so entry logic does not fire.
                        # Also block breakout, key_level, and runner from overriding this decision.
                        sig = "hold"
                        ai_said_hold = True
                        inc_skip_reason(state, "ai_hold", 1)
                elif ai_action in ("OPEN", "CLOSE"):
                    inc_skip_reason(state, "ai_low_conf_open", 1)

                print(
                    f"[blue]ai[/blue] action={ai_action} symbol={ai_decision.get('symbol')} "
                    f"conf={ai_conf:.2f} reason={ai_decision.get('reason','')}"
                )
                append_journal(journal_path, {
                    "type": "ai_decision",
                    "action": ai_action,
                    "symbol": ai_decision.get("symbol"),
                    "confidence": ai_conf,
                    "reason": ai_decision.get("reason", ""),
                    "target_symbol": target_symbol,
                    "regime": regime,
                    "signals": signals,
                    "setup_type": setup_type,
                    "setup_quality": setup_quality,
                    "scores": strategy_scores,
                })

            # Breakout plan: if a watched symbol breaks its computed level within a time window, force long entry.
            # Skipped when AI has explicitly issued a HOLD to avoid circumventing the AI gate.
            breakout_cfg = cfg.get("breakout_plan", {}) or {}
            if bool(breakout_cfg.get("enabled", False)) and pos is None and not ai_said_hold:
                lookback_bars = max(5, int(breakout_cfg.get("lookback_bars", 20)))
                buffer_pct = float(breakout_cfg.get("breakout_buffer_pct", 0.0)) / 100.0
                min_vol_ratio = float(breakout_cfg.get("min_vol_ratio", 1.0))
                window_min = int(breakout_cfg.get("time_window_min", 30))

                elapsed_ok = True
                if window_min > 0:
                    wl_ts = int(state.get("watchlist_updated_at", 0) or 0)
                    elapsed_ok = (wl_ts > 0) and ((now_ts - wl_ts) <= (window_min * 60))

                if len(closes) >= (lookback_bars + 1) and elapsed_ok:
                    prev_window = closes[-(lookback_bars + 1):-1]
                    breakout_level = max(prev_window) if prev_window else None
                    vol_ratio_now = float(mctx.get("vol_ratio") or 0.0)
                    if breakout_level and px >= (float(breakout_level) * (1.0 + buffer_pct)) and vol_ratio_now >= min_vol_ratio:
                        sig = "long"
                        print(
                            f"[magenta]breakout_plan[/magenta] symbol={target_symbol} "
                            f"px={px:.2f} level={float(breakout_level):.2f} "
                            f"vol_ratio={vol_ratio_now:.2f} window_min={window_min}"
                        )

            # ── ANA-STYLE KEY LEVEL BREAK DETECTION ──────────────────────────────
            # Identifies PDH/PDL, pre-market H/L, VWAP, pivot points, and current
            # session extremes; triggers entry when price cleanly breaks and holds
            # above/below any of these levels. Overrides ensemble signal on break.
            kl_cfg = cfg.get("key_levels", {}) or {}
            kl_enabled = bool(kl_cfg.get("enabled", False))
            key_level_break_signal = None
            key_level_break_name = None
            key_level_break_price = None
            if kl_enabled and pos is None and not ai_said_hold:
                ensure_key_levels_state(state)
                today_kl = day_str_local()
                kl_by_sym = state.get("key_levels_by_symbol") or {}
                kl_upd_date = state.get("key_levels_updated_date") or ""
                kl_asset_class = str(kl_cfg.get("asset_class", "auto")).lower()
                if kl_asset_class == "auto":
                    if isinstance(exchange, AlpacaAdapter):
                        kl_asset_class = "stock"
                    elif isinstance(exchange, OandaAdapter):
                        kl_asset_class = "forex"
                    else:
                        kl_asset_class = "crypto"
                # Recompute key levels once per day (or if we haven't seen this symbol yet)
                if kl_upd_date != today_kl or target_symbol not in kl_by_sym:
                    try:
                        if kl_asset_class == "stock" and isinstance(exchange, AlpacaAdapter):
                            sym_levels = compute_key_levels_alpaca(exchange, target_symbol, state=state)
                        else:
                            sym_levels = compute_key_levels_generic(exchange, target_symbol, cfg["timeframe"], state=state)
                        kl_by_sym[target_symbol] = sym_levels
                        state["key_levels_by_symbol"] = kl_by_sym
                        state["key_levels_updated_date"] = today_kl
                        if sym_levels:
                            print(f"[cyan]key_levels[/cyan] {target_symbol}: {sym_levels}")
                            append_journal(journal_path, {
                                "type": "key_levels_computed",
                                "symbol": target_symbol,
                                "levels": sym_levels,
                                "asset_class": kl_asset_class,
                            })
                    except Exception as _kl_e:
                        print(f"[yellow]key_levels error:[/yellow] {_kl_e}")
                sym_levels = (state.get("key_levels_by_symbol") or {}).get(target_symbol) or {}
                if sym_levels:
                    allow_short_kl = bool(cfg.get("strategy", {}).get("allow_short", False))
                    brk_name, brk_price, brk_dir = detect_key_level_break(px, ohlcv, sym_levels, kl_cfg)
                    if brk_name and brk_dir:
                        if brk_dir == "flat" and not allow_short_kl:
                            print(
                                f"[yellow]key_levels[/yellow] support break {brk_name}@{float(brk_price):.4f} "
                                f"skipped (allow_short=false)"
                            )
                        else:
                            key_level_break_signal = brk_dir
                            key_level_break_name = brk_name
                            key_level_break_price = brk_price
                            sig = brk_dir  # override ensemble signal
                            print(
                                f"[bold magenta]KEY_LEVEL_BREAK[/bold magenta] {target_symbol} "
                                f"Break of {brk_name} ${float(brk_price):.4f} → "
                                f"{'LONG' if brk_dir == 'long' else 'SHORT/FLAT'} entry @ {px:.4f}"
                            )
                            append_journal(journal_path, {
                                "type": "key_level_break",
                                "symbol": target_symbol,
                                "level_name": brk_name,
                                "level_price": brk_price,
                                "direction": brk_dir,
                                "px": px,
                                "all_levels": sym_levels,
                            })

            # ── RUNNER CATCHER: vol-surge + momentum + RSI signal override ─────
            # Runs on the selected target_symbol every tick. When all three
            # conditions pass (and pullback entry is satisfied), overrides the
            # ensemble signal with a high-confidence LONG entry.
            # Blocked when AI has explicitly issued a HOLD (ai_said_hold=True).
            if runner_strategy_enabled and pos is None and not ai_said_hold:
                _rd = detect_runner(ohlcv, runner_strategy_cfg)  # noqa: assigned above as None
                if _rd["is_runner"]:
                    _entry_mode = str(runner_strategy_cfg.get("entry_mode", "pullback")).lower()
                    _pb = check_pullback_then_green(target_symbol, ohlcv, state, runner_strategy_cfg)
                    if _pb == "enter":
                        runner_signal = "long"
                        sig = "long"
                        print(
                            f"[bold green]RUNNER_CATCH[/bold green] {target_symbol} "
                            f"entry_mode={_entry_mode} {_rd['reason']}"
                        )
                        append_journal(journal_path, {
                            "type": "runner_signal",
                            "symbol": target_symbol,
                            "entry_mode": _entry_mode,
                            "vol_surge_ratio": _rd.get("vol_surge_ratio"),
                            "ret15": _rd.get("ret15"),
                            "rsi": _rd.get("rsi"),
                            "reason": _rd.get("reason"),
                        })
                    elif _pb == "wait":
                        _pb_state = (state.get("runner_pending") or {}).get(target_symbol, {})
                        _waiting_for = "pullback" if not _pb_state.get("pullback_seen") else "green_candle"
                        print(
                            f"[dim]runner_watch[/dim] {target_symbol} "
                            f"{_rd['reason']} waiting_for={_waiting_for}"
                        )

            # ── PATTERN LIBRARY BOOST / SUPPRESS ─────────────────────────────
            # Determine which signal source ultimately produced the current sig.
            _sig_source = "ensemble"
            if runner_signal == "long":
                _sig_source = "runner"
            elif key_level_break_name:
                _sig_source = "key_level_break"
            elif ai_decision and (ai_decision.get("action") == "OPEN"):
                _sig_source = "ai"

            _entry_conditions  = None
            _pattern_match_id  = None
            _sl_cfg_check      = cfg.get("self_learning", {})
            if bool(_sl_cfg_check.get("enabled", False)) and pos is None and sig in ("long", "flat"):
                _entry_conditions = compute_entry_conditions(
                    px, mctx, ohlcv, regime, signals, _sig_source,
                    exchange, cfg, target_symbol, state,
                    runner_info=_rd,
                    key_level_name=key_level_break_name,
                )
                sig, _pattern_match_id, _pm_log = apply_pattern_signals(
                    sig, _entry_conditions, state, cfg
                )
                if _pm_log:
                    append_journal(journal_path, {
                        "type":             "pattern_signal",
                        "symbol":           target_symbol,
                        "message":          _pm_log,
                        "pattern_match_id": _pattern_match_id,
                        "sig_after":        sig,
                        "conditions":       _entry_conditions,
                    })

            state["strategy_scores"] = strategy_scores
            state["strategy_stats"] = strategy_stats
            state["disabled_strategies"] = disabled_strategies
            state["last_px"] = px
            state["last_signals"] = signals
            # Per-symbol cache used by strategy_stats accumulation above.
            state.setdefault("last_px_by_sym", {})[str(target_symbol)] = px
            state.setdefault("last_signals_by_sym", {})[str(target_symbol)] = signals

            pos = state["position"]
            if pos is None:
                pos_txt = "none"
                unreal = 0.0
                pos_val = 0.0
            else:
                side = str(pos.get("side", "long")).lower()
                if side == "short":
                    unreal = (pos["entry"] - px) * pos["qty"]
                else:
                    unreal = (px - pos["entry"]) * pos["qty"]
                pos_val = px * pos["qty"]
                pos_txt = f"{side} entry={pos['entry']:.2f} qty={pos['qty']:.6f}"

            scan_top = ""
            if pos is None and scan_rows:
                top = ", ".join([f"{r[1]}:{r[3]}:{r[0]:.2f}" for r in scan_rows[:3]])
                scan_top = f" scan_top=[{top}]"

            print(
                f"[dim]tick[/dim] symbol={target_symbol} px={px:.2f} sig={sig} regime={regime} vol={vol:.4f} "
                f"sma={signals['sma']} mom={signals['mom']} mr={signals['mr']} "
                f"score_sma={strategy_scores.get('sma',0):.3f} score_mom={strategy_scores.get('mom',0):.3f} score_mr={strategy_scores.get('mr',0):.3f} "
                f"disabled={','.join(disabled_strategies) if disabled_strategies else 'none'} "
                f"pos={pos_txt} pos_val={pos_val:.2f} unreal={unreal:.2f} "
                f"bal={state.get('paper_balance', 0):.2f} "
                f"daily={state.get('daily_pnl', 0):.2f} trades={state.get('trades_today', 0)} ls={state.get('loss_streak',0)}{scan_top}"
            )

            append_journal(journal_path, {
                "type": "tick",
                "symbol": target_symbol,
                "px": px,
                "sig": sig,
                "regime": regime,
                "vol": vol,
                "trend": trend,
                "market_context": mctx,
                "signals": signals,
                "setup_type": setup_type,
                "setup_quality": setup_quality,
                "scores": strategy_scores,
                "disabled": disabled_strategies,
                "position": state.get("position"),
                "paper_balance": state.get("paper_balance"),
                "daily_pnl": state.get("daily_pnl"),
                "trades_today": state.get("trades_today"),
                "loss_streak": state.get("loss_streak", 0),
            })

            if heartbeat_count % 5 == 0:
                print("[dim]hint:[/dim] touch BUY_NOW | touch SELL_NOW | touch KILL_SWITCH | rm -f KILL_SWITCH")

            # buy_now / sell_now were detected and consumed above in the early-detection block

            cooldown_until = int(state.get("cooldown_until", 0))
            disable_symbol_cooldown = bool(cfg.get("risk", {}).get("disable_symbol_cooldown", True))
            in_global_cooldown = (not disable_symbol_cooldown) and (int(time.time()) < cooldown_until)

            allow_short = bool(cfg.get("strategy", {}).get("allow_short", True))
            enter_signal = (sig == "long") or (allow_short and sig == "flat")
            # Unified signal telemetry + missed-signal tracking.
            _positions_now = state.get("positions") or {}
            telemetry = None
            _signal_source = _sig_source

            # Trading-hours hard block removed:
            # runtime scheduling is controlled externally (cron/start-stop orchestration).

            if (target_symbol not in _positions_now) and (enter_signal or buy_now):
                _sig_side = "long" if (buy_now or sig == "long") else "short"
                _emit_key = f"{target_symbol}:{_sig_side}:{(now_utc().isoformat())[:16]}"
                _last_emit = (state.get("last_signal_emit_key_by_symbol") or {}).get(target_symbol)
                if _emit_key != _last_emit:
                    _corr = uuid.uuid4().hex
                    _sig_ts = now_utc().isoformat()
                    _quote = {
                        "px": px,
                        "bid": mctx.get("best_bid"),
                        "ask": mctx.get("best_ask"),
                        "spread_bps": mctx.get("spread_bps"),
                        "vwap_20": mctx.get("vwap_20"),
                    }
                    telemetry = {
                        "correlation_id": _corr,
                        "signal_ts": _sig_ts,
                        "signal_side": _sig_side,
                        "signal_source": _signal_source,
                        "quote_snapshot": _quote,
                    }
                    append_journal(journal_path, {
                        "type": "signal_emit",
                        "market": cfg.get("market", "unknown"),
                        "symbol": target_symbol,
                        "correlation_id": _corr,
                        "signal_ts": _sig_ts,
                        "signal_side": _sig_side,
                        "signal_source": _signal_source,
                        "quote_snapshot": _quote,
                    })
                    state.setdefault("pending_signals", {})[_corr] = {
                        "symbol": target_symbol,
                        "market": cfg.get("market", "unknown"),
                        "signal_ts": _sig_ts,
                        "signal_emitted_epoch_ms": int(datetime.now(timezone.utc).timestamp() * 1000),  # CRITICAL: for SLA tracking
                        "signal_side": _sig_side,
                        "signal_source": _signal_source,
                        "quote_snapshot": _quote,
                    }
                    state.setdefault("last_signal_emit_key_by_symbol", {})[target_symbol] = _emit_key
            # Multi-position entry gate: allow entry if slot available and symbol not already held
            # Block new entries when KILL_SWITCH is active (force close only)
            if kill_switch_active:
                print(f"[red]KILL_SWITCH:[/red] blocking new entry for {target_symbol}")
                inc_skip_reason(state, "risk_block", 1)
                if telemetry and telemetry.get("correlation_id"):
                    cid = telemetry["correlation_id"]
                    pending = state.setdefault("pending_signals", {})
                    if cid in pending:
                        # Log the rejection immediately
                        log_signal_rejection(state, journal_path, telemetry, pending[cid], MissReason.PERMANENTLY_BLOCKED)
                        # Remove from pending_signals
                        pending.pop(cid, None)
                save_state(state_path, state)
                time.sleep(cfg["poll_seconds"])
                continue

            if (target_symbol not in _positions_now
                    and len(_positions_now) < max_open_positions
                    and (enter_signal or buy_now)):
                desired_side = "long"
                if (not buy_now) and sig == "flat" and allow_short:
                    desired_side = "short"
                # Cooldown gate disabled by request; do not block entries on cooldown state.
                # Determine which filter profile to use: scalp (default), runner, or loose
                # based on symbol_filter_overrides config
                filter_overrides = cfg.get("scanner", {}).get("symbol_filter_overrides") or {}
                profile_for_symbol = filter_overrides.get(str(target_symbol).upper(), "scalp")

                if profile_for_symbol == "runner":
                    scalp_cfg = cfg.get("runner_mode", {})
                elif profile_for_symbol == "loose":
                    scalp_cfg = cfg.get("loose_filters", {})
                else:  # default "scalp"
                    scalp_cfg = cfg.get("scalp_filters", {})

                min_vol_ratio = float(scalp_cfg.get("min_vol_ratio", 1.05))
                min_trendline_bias = float(scalp_cfg.get("min_trendline_bias", 0.00005))
                min_ob_imbalance = float(scalp_cfg.get("min_ob_imbalance", 0.02))
                max_spread_bps = float(scalp_cfg.get("max_spread_bps", 8.0))
                require_vwap = bool(scalp_cfg.get("require_price_above_vwap_for_long", True))

                spread_bps = mctx.get("spread_bps")
                price_above_vwap = (px > float(mctx.get("vwap_20") or px))
                vwap_ok = price_above_vwap if desired_side == "long" else (not price_above_vwap)
                trend_bias = float(mctx.get("trendline_bias") or 0.0)
                ob_imb = float(mctx.get("ob_imbalance") or 0.0)
                trend_ok = abs(trend_bias) >= (min_trendline_bias * 0.5)
                ob_ok = abs(ob_imb) >= (min_ob_imbalance * 0.5)

                # OPTIMIZATION: Pre-filter on spread (fast rejection, saves 2-3s on rejected signals)
                # Check spread BEFORE expensive calculations
                pre_filter_enabled = cfg.get("strategy", {}).get("pre_filter_spread", False)
                spread_ok = (spread_bps is None or float(spread_bps) <= max_spread_bps)
                if pre_filter_enabled and not spread_ok:
                    # Reject immediately without checking other filters (saves CPU)
                    passes_filters = False
                else:
                    # Normal filter check
                    passes_filters = (
                        float(mctx.get("vol_ratio") or 1.0) >= min_vol_ratio
                        and trend_ok
                        and ob_ok
                        and spread_ok
                        and ((not require_vwap) or vwap_ok)
                    )

                    if (not buy_now) and (not passes_filters) and (runner_signal != "long"):
                        print(
                            f"[yellow]filters[/yellow] skip {desired_side} vol_ratio={float(mctx.get('vol_ratio') or 0):.2f} "
                            f"trendline={float(mctx.get('trendline_bias') or 0):.5f} "
                            f"ob_imb={float(mctx.get('ob_imbalance') or 0):.3f} "
                            f"spread_bps={mctx.get('spread_bps')} vwap_ok={vwap_ok}"
                        )
                        inc_skip_reason(state, "filters", 1)
                        _log_entry_decision(
                            journal_path,
                            "rejected_filters",
                            target_symbol,
                            desired_side=desired_side,
                            signal_source=_sig_source,
                            regime=regime,
                            setup_type=setup_type,
                            vol_ratio=float(mctx.get("vol_ratio") or 0.0),
                            trendline_bias=float(mctx.get("trendline_bias") or 0.0),
                            ob_imbalance=float(mctx.get("ob_imbalance") or 0.0),
                            spread_bps=mctx.get("spread_bps"),
                            vwap_ok=vwap_ok,
                        )
                        # Log filter rejection immediately
                        if telemetry and telemetry.get("correlation_id"):
                            cid = telemetry["correlation_id"]
                            pending = state.setdefault("pending_signals", {})
                            if cid in pending:
                                pending[cid]["rejection_details"] = {
                                    "vol_ratio": float(mctx.get("vol_ratio") or 0),
                                    "trendline_bias": float(mctx.get("trendline_bias") or 0),
                                    "ob_imbalance": float(mctx.get("ob_imbalance") or 0),
                                    "spread_bps": mctx.get("spread_bps"),
                                    "vwap_ok": vwap_ok,
                                }
                                log_signal_rejection(state, journal_path, telemetry, pending[cid], MissReason.FILTERED)
                                pending.pop(cid, None)
                        save_state(state_path, state)
                        time.sleep(cfg["poll_seconds"])
                        continue

                    approved_setups = cfg.get("rules_engine", {}).get("approved_setups") or []
                    if (not buy_now) and approved_setups and (setup_type not in approved_setups):
                        print(f"[yellow]setup[/yellow] skip {desired_side} setup={setup_type} not in approved={approved_setups}")
                        inc_skip_reason(state, "setup", 1)
                        _log_entry_decision(
                            journal_path,
                            "rejected_setup",
                            target_symbol,
                            desired_side=desired_side,
                            signal_source=_sig_source,
                            regime=regime,
                            setup_type=setup_type,
                            setup_quality=setup_quality,
                            approved_setups=approved_setups,
                            vol_ratio=float(mctx.get("vol_ratio") or 0.0),
                            trendline_bias=float(mctx.get("trendline_bias") or 0.0),
                            ob_imbalance=float(mctx.get("ob_imbalance") or 0.0),
                            spread_bps=mctx.get("spread_bps"),
                            vwap_ok=vwap_ok,
                        )
                        if telemetry and telemetry.get("correlation_id"):
                            cid = telemetry["correlation_id"]
                            pending = state.setdefault("pending_signals", {})
                            if cid in pending:
                                pending[cid]["rejection_details"] = {
                                    "attempted_setup": setup_type,
                                    "approved_setups": approved_setups,
                                }
                                log_signal_rejection(state, journal_path, telemetry, pending[cid], MissReason.FILTERED)
                                pending.pop(cid, None)
                        save_state(state_path, state)
                        time.sleep(cfg["poll_seconds"])
                        continue

                    # Avoid low-quality stock entries that come from a plain ensemble
                    # signal in chaos without a named setup or runner/key-level confirmation.
                    if (
                        (not buy_now)
                        and False
                    ):
                        print(
                            f"[yellow]stock_quality[/yellow] skip {desired_side} "
                            f"setup={setup_type} regime={regime} sig_source={_sig_source} "
                            f"vol_ratio={float(mctx.get('vol_ratio') or 0.0):.2f}"
                        )
                        inc_skip_reason(state, "stock_low_quality_entry", 1)
                        _log_entry_decision(
                            journal_path,
                            "rejected_stock_quality",
                            target_symbol,
                            desired_side=desired_side,
                            signal_source=_sig_source,
                            regime=regime,
                            setup_type=setup_type,
                            setup_quality=setup_quality,
                            vol_ratio=float(mctx.get("vol_ratio") or 0.0),
                            trendline_bias=float(mctx.get("trendline_bias") or 0.0),
                            ob_imbalance=float(mctx.get("ob_imbalance") or 0.0),
                            spread_bps=mctx.get("spread_bps"),
                            vwap_ok=vwap_ok,
                        )
                        if telemetry and telemetry.get("correlation_id"):
                            cid = telemetry["correlation_id"]
                            pending = state.setdefault("pending_signals", {})
                            if cid in pending:
                                pending[cid]["rejection_details"] = {
                                    "vol_ratio": float(mctx.get("vol_ratio") or 0),
                                    "regime": regime,
                                    "sig_source": _sig_source,
                                    "setup": setup_type,
                                }
                                log_signal_rejection(state, journal_path, telemetry, pending[cid], MissReason.FILTERED)
                                pending.pop(cid, None)
                        save_state(state_path, state)
                        time.sleep(cfg["poll_seconds"])
                        continue

                    # ── BREAK WATCHER: If passes all filters, check resistance level ──
                    # If price < resistance, add to break watchers (wait for break)
                    # If price >= resistance, enter normally
                    if desired_side == "long" and not buy_now:
                        try:
                            resistance_level, confidence, source_info = detect_resistance_level(
                                exchange, target_symbol, closes, ob_limit=20, state=state
                            )
                            if resistance_level and px < resistance_level:
                                # Stock qualifies, but hasn't broken yet → add to break watchers
                                add_to_break_watchers(state, target_symbol, resistance_level, confidence, source_info)
                                save_state(state_path, state)
                                time.sleep(cfg["poll_seconds"])
                                continue
                        except Exception as e:
                            print(f"[yellow]resistance detection error {target_symbol}:[/yellow] {e}")
                            # Fall through to normal entry

                    base_notional = float(cfg["risk"]["max_position_notional_usd"])
                    stop_pct = float(cfg["risk"].get("stop_loss_pct", 0.8)) / 100.0
                    if regime == "chaos":
                        size_mult = 0.5
                    elif regime == "trend":
                        size_mult = 1.0
                    else:
                        size_mult = 0.7
                    loss_mult = max(0.3, 1.0 - (0.2 * int(state.get("loss_streak", 0))))

                    # Risk-based sizing from study rules: notional ~= dollar_risk / stop_pct
                    eq = float(state.get("paper_balance") or cfg["risk"].get("starting_equity_usd", 50.0))
                    risk_pct, risk_mult = compute_effective_risk_pct(cfg, state, regime)
                    if risk_pct > 0 and stop_pct > 0:
                        risk_notional = (eq * risk_pct) / stop_pct
                    else:
                        risk_notional = base_notional

                    notional = min(base_notional, risk_notional) * size_mult * loss_mult
                    if buy_now:
                        manual_mult = max(1.0, min(5.0, float(buy_now_mult or 1.0)))
                        # Manual buy_now should represent explicit operator size intent.
                        notional = base_notional * manual_mult
                    if cfg["mode"] == "paper":
                        notional = min(notional, state["paper_balance"])
                    if notional > 0:
                        if cfg["mode"] == "paper":
                            paper_enter(state, target_symbol, px, notional, side=desired_side)
                            action_txt = "BUY" if desired_side == "long" else "SELL_SHORT"
                            msg = f"PAPER {action_txt} {target_symbol} px={px:.2f} notional={notional:.2f} regime={regime}"
                            print(f"[cyan]{msg}[/cyan]")
                            if state.get("position"):
                                state["position"]["entry_regime"] = regime
                                state["position"]["entry_vol"] = vol
                                state["position"]["entry_trend"] = trend
                                state["position"]["entry_signals"] = signals
                                state["position"]["entry_scores"] = strategy_scores
                                state["position"]["entry_setup_type"] = setup_type
                                state["position"]["entry_setup_quality"] = setup_quality
                                state["position"]["entry_market_context"] = mctx
                                state["position"]["entry_ai"] = ai_decision
                                # Self-learning: store entry conditions + pattern match
                                state["position"]["entry_conditions"]  = _entry_conditions
                                state["position"]["pattern_match_id"]  = _pattern_match_id
                                # Runner trade metadata + initial trailing stop
                                if runner_signal == "long":
                                    state["position"]["is_runner_trade"] = True
                                    _r_tcfg = runner_strategy_cfg.get("trailing_stop", {}) or {}
                                    if bool(_r_tcfg.get("enabled", True)):
                                        _r_init_stop = px * (1.0 - float(_r_tcfg.get("initial_stop_pct", 0.005)))
                                        state["position"]["trailing_stop"] = round(_r_init_stop, 8)
                                        state["position"]["highest_close_since_entry"] = px
                                        if not state["position"].get("custom_stop"):
                                            state["position"]["custom_stop"] = round(_r_init_stop, 8)
                                        print(
                                            f"[cyan]runner_trail[/cyan] {target_symbol} "
                                            f"initial trailing stop=${_r_init_stop:.4f}"
                                        )
                                # Key level break metadata + custom stop loss
                                if key_level_break_name:
                                    state["position"]["entry_key_level_name"] = key_level_break_name
                                    state["position"]["entry_key_level_price"] = key_level_break_price
                                    _stop_blw = float(kl_cfg.get("stop_below_level_pct", 0.002))
                                    if desired_side == "long":
                                        state["position"]["custom_stop"] = round(float(key_level_break_price) * (1.0 - _stop_blw), 8)
                                    else:
                                        state["position"]["custom_stop"] = round(float(key_level_break_price) * (1.0 + _stop_blw), 8)
                                    print(
                                        f"[cyan]key_level_stop[/cyan] {target_symbol} stop set at "
                                        f"{state['position']['custom_stop']:.4f} "
                                        f"(just beyond {key_level_break_name} @ {float(key_level_break_price):.4f})"
                                    )
                            # Calculate slippage for paper trade using signal price from telemetry
                            _signal_px = None
                            if telemetry and telemetry.get("quote_snapshot"):
                                _signal_px = telemetry["quote_snapshot"].get("mid_price") or telemetry["quote_snapshot"].get("px")
                            _paper_slippage = calculate_slippage_bps(px, _signal_px or px) if _signal_px else 0.0

                            # Compute runner attribution (captured vs partial vs missed)
                            runner_attr, skip_reason_lineage = compute_runner_attribution(target_symbol, state, journal_path)

                            append_journal(journal_path, {
                                "type": "trade_open",
                                "mode": "paper",
                                "symbol": target_symbol,
                                "px": px,
                                "correlation_id": (telemetry or {}).get("correlation_id"),
                                "signal_ts": (telemetry or {}).get("signal_ts"),
                                "order_submit_ts": now_utc().isoformat(),
                                "order_ack_ts": now_utc().isoformat(),
                                "fill_ts": now_utc().isoformat(),
                                "quote_snapshot": (telemetry or {}).get("quote_snapshot"),
                                "execution_delay_ms": 0,
                                "slippage_bps": _paper_slippage,  # CRITICAL: capture actual slippage in paper mode
                                "runner_attribution": runner_attr,  # NEW: captured | partial | missed
                                "skip_reason_lineage": skip_reason_lineage,  # NEW: reason chain
                                "notional": notional,
                                "regime": regime,
                                "setup_type": setup_type,
                                "setup_quality": setup_quality,
                                "vol": vol,
                                "trend": trend,
                                "market_context": mctx,
                                "signals": signals,
                                "scores": strategy_scores,
                                "disabled": disabled_strategies,
                                "ai_decision": ai_decision,
                                "entry_conditions":  _entry_conditions,
                                "pattern_match_id":  _pattern_match_id,
                                "key_level_break": {
                                    "level_name": key_level_break_name,
                                    "level_price": key_level_break_price,
                                    "direction": key_level_break_signal,
                                } if key_level_break_name else None,
                                "scan_top": [
                                    {"symbol": r[1], "sig": r[3], "confidence": round(float(r[0]), 4)}
                                    for r in (scan_rows[:5] if scan_rows else [])
                                ],
                            })
                            if telemetry and telemetry.get("correlation_id"):
                                state.setdefault("pending_signals", {}).pop(telemetry.get("correlation_id"), None)
                            send_alert(cfg, state, msg)
                        else:
                            # Use SLA-aware fallback wrapper (implements retry on SLA breach)
                            order, sla_status = live_enter_with_sla_fallback(
                                exchange, state, cfg, target_symbol, px, notional,
                                side=desired_side, telemetry=telemetry, journal_path=journal_path,
                                market=cfg.get("market", "stocks")
                            )
                            action_txt = "BUY" if desired_side == "long" else "SELL_SHORT"
                            msg = f"LIVE {action_txt} {target_symbol} px={px:.2f} notional={notional:.2f} regime={regime} sla_status={sla_status} order_id={order.get('id') if order else None}"
                            print(f"[red]{msg}[/red]")
                            if state.get("position"):
                                state["position"]["entry_regime"] = regime
                                state["position"]["entry_vol"] = vol
                                state["position"]["entry_trend"] = trend
                                state["position"]["entry_signals"] = signals
                                state["position"]["entry_scores"] = strategy_scores
                                state["position"]["entry_setup_type"] = setup_type
                                state["position"]["entry_setup_quality"] = setup_quality
                                state["position"]["entry_market_context"] = mctx
                                state["position"]["entry_ai"] = ai_decision
                                # Self-learning: store entry conditions + pattern match
                                state["position"]["entry_conditions"]  = _entry_conditions
                                state["position"]["pattern_match_id"]  = _pattern_match_id
                                # Runner trade metadata + initial trailing stop
                                if runner_signal == "long":
                                    state["position"]["is_runner_trade"] = True
                                    _r_tcfg = runner_strategy_cfg.get("trailing_stop", {}) or {}
                                    if bool(_r_tcfg.get("enabled", True)):
                                        _r_init_stop = px * (1.0 - float(_r_tcfg.get("initial_stop_pct", 0.005)))
                                        state["position"]["trailing_stop"] = round(_r_init_stop, 8)
                                        state["position"]["highest_close_since_entry"] = px
                                        if not state["position"].get("custom_stop"):
                                            state["position"]["custom_stop"] = round(_r_init_stop, 8)
                                        print(
                                            f"[cyan]runner_trail[/cyan] {target_symbol} "
                                            f"initial trailing stop=${_r_init_stop:.4f}"
                                        )
                                # Key level break metadata + custom stop loss
                                if key_level_break_name:
                                    state["position"]["entry_key_level_name"] = key_level_break_name
                                    state["position"]["entry_key_level_price"] = key_level_break_price
                                    _stop_blw = float(kl_cfg.get("stop_below_level_pct", 0.002))
                                    if desired_side == "long":
                                        state["position"]["custom_stop"] = round(float(key_level_break_price) * (1.0 - _stop_blw), 8)
                                    else:
                                        state["position"]["custom_stop"] = round(float(key_level_break_price) * (1.0 + _stop_blw), 8)
                                    print(
                                        f"[cyan]key_level_stop[/cyan] {target_symbol} stop set at "
                                        f"{state['position']['custom_stop']:.4f} "
                                        f"(just beyond {key_level_break_name} @ {float(key_level_break_price):.4f})"
                                    )
                            # Compute runner attribution (captured vs partial vs missed)
                            runner_attr, skip_reason_lineage = compute_runner_attribution(target_symbol, state, journal_path)
                            _opened_pos = (state.get("positions") or {}).get(target_symbol)
                            _order_id = (order or {}).get("id") if order else None
                            _is_opened_here = bool(
                                _opened_pos
                                and (
                                    (_order_id and _opened_pos.get("entry_order_id") == _order_id)
                                    or _opened_pos.get("symbol") == target_symbol
                                )
                            )
                            if order and _is_opened_here:
                                append_journal(journal_path, {
                                    "type": "trade_open",
                                    "mode": "live",
                                    "symbol": target_symbol,
                                    "px": px,
                                    "notional": notional,
                                    "regime": regime,
                                    "setup_type": setup_type,
                                    "setup_quality": setup_quality,
                                    "vol": vol,
                                    "trend": trend,
                                    "market_context": mctx,
                                    "order_id": order.get("id"),
                                    "correlation_id": (telemetry or {}).get("correlation_id") or (state.get("position") or {}).get("correlation_id"),
                                    "signal_ts": (telemetry or {}).get("signal_ts") or (state.get("position") or {}).get("signal_ts"),
                                    "order_submit_ts": (state.get("position") or {}).get("order_submit_ts"),
                                    "order_ack_ts": (state.get("position") or {}).get("order_ack_ts"),
                                    "fill_ts": (state.get("position") or {}).get("fill_ts"),
                                    "quote_snapshot": (telemetry or {}).get("quote_snapshot"),
                                    "execution_delay_ms": (state.get("position") or {}).get("execution_delay_ms"),
                                    "slippage_bps": (state.get("position") or {}).get("slippage_bps", 0.0),  # CRITICAL: from live_enter calculation
                                    "runner_attribution": runner_attr,  # NEW: captured | partial | missed
                                    "skip_reason_lineage": skip_reason_lineage,  # NEW: reason chain
                                    "signals": signals,
                                    "scores": strategy_scores,
                                    "disabled": disabled_strategies,
                                    "ai_decision": ai_decision,
                                    "entry_conditions":  _entry_conditions,
                                    "pattern_match_id":  _pattern_match_id,
                                    "key_level_break": {
                                        "level_name": key_level_break_name,
                                        "level_price": key_level_break_price,
                                        "direction": key_level_break_signal,
                                    } if key_level_break_name else None,
                                    "scan_top": [
                                        {"symbol": r[1], "sig": r[3], "confidence": round(float(r[0]), 4)}
                                        for r in (scan_rows[:5] if scan_rows else [])
                                    ],
                                })
                            elif order and (str(order.get("id")) in (state.get("pending_orders") or {})):
                                append_journal(journal_path, {
                                    "type": "trade_open_pending",
                                    "mode": "live",
                                    "symbol": target_symbol,
                                    "px": px,
                                    "notional": notional,
                                    "regime": regime,
                                    "setup_type": setup_type,
                                    "setup_quality": setup_quality,
                                    "sla_status": sla_status,
                                    "order_id": order.get("id"),
                                    "reason": "order_submitted_waiting_for_fill",
                                    "correlation_id": (telemetry or {}).get("correlation_id"),
                                })
                            elif journal_path:
                                append_journal(journal_path, {
                                    "type": "trade_open_failed",
                                    "mode": "live",
                                    "symbol": target_symbol,
                                    "px": px,
                                    "notional": notional,
                                    "regime": regime,
                                    "setup_type": setup_type,
                                    "setup_quality": setup_quality,
                                    "sla_status": sla_status,
                                    "reason": (("order_submitted_not_filled" if order else "order_not_accepted_by_broker")),
                                    "correlation_id": (telemetry or {}).get("correlation_id"),
                                })
                            if telemetry and telemetry.get("correlation_id"):
                                state.setdefault("pending_signals", {}).pop(telemetry.get("correlation_id"), None)
                            send_alert(cfg, state, msg, force=True)

            # NOTE: position exits (stop / target / signal / sell_now) are handled
            # by the multi-position exit sweep at the top of this loop iteration.
            # The old single-position elif block has been replaced by that sweep.

            emit_missed_signals_if_any(
                state,
                journal_path,
                sla_seconds=float(cfg.get("execution", {}).get("signal_to_order_sla_seconds", 15)),
            )
            state["running"] = True
            state["status"] = "RUNNING"
            state["last_heartbeat_ts"] = int(time.time())
            save_state(state_path, state)
            time.sleep(cfg["poll_seconds"])

        except Exception as e:
            print(f"[red]Loop error:[/red] {e}")
            send_alert(cfg, state, f"tradebot error: {e}", force=True)
            append_error_reflection({
                "type": "loop_error",
                "error": str(e)[:400],
            })
            state["running"] = True
            state["status"] = "RUNNING"
            state["last_heartbeat_ts"] = int(time.time())
            state["last_error"] = str(e)[:400]
            save_state(state_path, state)
            msg = str(e)
            if "429" in msg or "Too Many Requests" in msg:
                time.sleep(max(30, int(cfg["poll_seconds"]) * 3))
            else:
                time.sleep(max(5, int(cfg["poll_seconds"])))


if __name__ == "__main__":
    main()
