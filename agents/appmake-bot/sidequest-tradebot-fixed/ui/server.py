#!/usr/bin/env python3
import json
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zoneinfo import ZoneInfo
try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_ROOT = os.getenv("TRADEBOT_DATA_ROOT", os.path.join(ROOT, ".tradebot-data"))
ET_TZ = ZoneInfo("America/New_York")
if load_dotenv:
    try:
        load_dotenv(os.path.join(ROOT, ".env"), override=False)
    except Exception:
        pass
else:
    try:
        env_path = os.path.join(ROOT, ".env")
        if os.path.exists(env_path):
            with open(env_path, "r", errors="ignore") as f:
                for ln in f:
                    s = ln.strip()
                    if not s or s.startswith("#") or "=" not in s:
                        continue
                    k, v = s.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass
BOT_CONFIG_BY_TAG = {
    "crypto": "config.universe.crypto.yaml",
    "forex": "config.universe.forex.yaml",
    "stocks": "config.universe.stocks.yaml",
    "overnight": "config.overnight.stocks.yaml",
}
BOT_LOG_BY_TAG = {
    "crypto": os.path.join(DATA_ROOT, "bot.crypto.log"),
    "forex": os.path.join(DATA_ROOT, "bot.forex.log"),
    "stocks": os.path.join(DATA_ROOT, "bot.stocks.log"),
    "overnight": os.path.join(DATA_ROOT, "bot.overnight.log"),
}
BOT_STATE_BY_TAG = {
    "crypto": os.path.join(DATA_ROOT, "state.crypto.json"),
    "forex": os.path.join(DATA_ROOT, "state.forex.json"),
    "stocks": os.path.join(DATA_ROOT, "state.stocks.json"),
    "overnight": os.path.join(DATA_ROOT, "state.overnight.stocks.json"),
}
BOT_JOURNAL_BY_TAG = {
    "crypto": os.path.join(DATA_ROOT, "journal.crypto.jsonl"),
    "forex": os.path.join(DATA_ROOT, "journal.forex.jsonl"),
    "stocks": os.path.join(DATA_ROOT, "journal.stocks.jsonl"),
    "overnight": os.path.join(DATA_ROOT, "journal.overnight.jsonl"),
}
BOT_TAGS = ["crypto", "forex", "stocks", "overnight"]
BUY_FILE_BY_TAG = {
    "crypto": "BUY_NOW_CRYPTO",
    "forex": "BUY_NOW_FOREX",
    "stocks": "BUY_NOW_STOCKS",
    "overnight": "BUY_NOW_OVERNIGHT",
}
MATRIX_BY_ASSET = {
    "crypto": ["crypto_btc", "crypto_eth", "crypto_ltc"],
    "forex": ["forex_eurusd", "forex_gbpusd", "forex_usdjpy"],
    "stocks": ["stock_aapl", "stock_msft", "stock_spy"],
}
RUNTIME_STATE_FILE = os.path.join(DATA_ROOT, ".runtime", "bot_runtime_state.json")
_JOURNAL_TRADE_CACHE = {}
_MISSED_RUNNER_CACHE = {}
_ALPACA_EXCHANGE_CACHE = {"ts": 0, "data": {}}


def _norm_symbol(sym):
    return str(sym or "").strip().upper()


def _get_pinned_symbols(tag):
    """Parse pinned_symbols list from the universe config yaml for a given tag."""
    cfg_path = os.path.join(ROOT, f"config.universe.{tag}.yaml")
    try:
        with open(cfg_path, "r") as f:
            content = f.read()
        m = re.search(r"pinned_symbols:\s*\[([^\]]+)\]", content)
        if m:
            return [s.strip() for s in m.group(1).split(",") if s.strip()]
    except Exception:
        pass
    return []


def _get_scan_top_from_log(tag):
    """Parse the most recent scan_top line from the bot log to get live signals."""
    log_path = os.path.join(ROOT, f"bot.{tag}.log")
    try:
        with open(log_path, "r", errors="ignore") as f:
            content = f.read()
        matches = re.findall(r"scan_top=\[([^\]]+)\]", content)
        if not matches:
            return {}
        result = {}
        for entry in matches[-1].split(","):
            parts = entry.strip().split(":")
            if len(parts) >= 2:
                sym = parts[0].strip()
                sig = parts[1].strip()
                score = float(parts[2]) if len(parts) > 2 else 0.0
                result[sym] = {"signal": sig, "score": score}
        return result
    except Exception:
        return {}


def _read_text(path):
    try:
        with open(path, "r", errors="ignore") as f:
            return f.read()
    except Exception:
        return ""


def _read_json(path, default=None):
    try:
        with open(path, "r", errors="ignore") as f:
            return json.load(f)
    except Exception:
        return default


def _alpaca_symbol_exchange_map(ttl_sec=900):
    now = int(datetime.now(timezone.utc).timestamp())
    cached = _ALPACA_EXCHANGE_CACHE.get("data") or {}
    ts = int(_ALPACA_EXCHANGE_CACHE.get("ts") or 0)
    if cached and (now - ts) < int(ttl_sec):
        return cached
    key = os.getenv("ALPACA_API_KEY", "").strip()
    sec = os.getenv("ALPACA_API_SECRET", "").strip()
    if not key or not sec:
        return {}
    base = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    url = f"{base}/v2/assets?status=active&asset_class=us_equity"
    req = Request(url, headers={
        "APCA-API-KEY-ID": key,
        "APCA-API-SECRET-KEY": sec,
    })
    try:
        with urlopen(req, timeout=10) as r:
            arr = json.loads(r.read().decode("utf-8"))
        out = {}
        if isinstance(arr, list):
            for row in arr:
                if not isinstance(row, dict):
                    continue
                sym = str(row.get("symbol") or "").upper().strip()
                ex = str(row.get("exchange") or "").upper().strip()
                if sym and ex:
                    out[sym] = ex
        _ALPACA_EXCHANGE_CACHE["ts"] = now
        _ALPACA_EXCHANGE_CACHE["data"] = out
        return out
    except Exception:
        return cached


def _alpaca_positions_snapshot():
    ak = os.getenv("ALPACA_API_KEY", "").strip()
    asec = os.getenv("ALPACA_API_SECRET", "").strip()
    if not ak or not asec:
        return {}
    abase = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    url = f"{abase}/v2/positions"
    req = Request(url, headers={
        "APCA-API-KEY-ID": ak,
        "APCA-API-SECRET-KEY": asec,
    })
    try:
        with urlopen(req, timeout=10) as r:
            rows = json.loads(r.read().decode("utf-8"))
        out = {}
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sym = _norm_symbol(row.get("symbol"))
                if not sym:
                    continue
                qty = float(row.get("qty") or row.get("qty_available") or 0.0)
                market_value = float(row.get("market_value") or 0.0)
                cost_basis = float(row.get("cost_basis") or 0.0)
                avg_entry = float(row.get("avg_entry_price") or 0.0)
                unrealized = market_value - cost_basis if market_value or cost_basis else 0.0
                out[sym] = {
                    "symbol": sym,
                    "side": str(row.get("side") or "long"),
                    "qty": qty,
                    "market_value": market_value,
                    "avg_entry_price": avg_entry,
                    "cost_basis": cost_basis,
                    "unrealized_pnl": unrealized,
                    "unrealized_pnl_pct": float(row.get("unrealized_plpc") or 0.0) * 100.0,
                    "current_price": float(row.get("current_price") or 0.0),
                }
        return out
    except Exception:
        return {}


def _human_duration(seconds):
    try:
        seconds = int(max(0, seconds))
    except Exception:
        return "-"
    if seconds < 60:
        return f"{seconds}s"
    mins, sec = divmod(seconds, 60)
    if mins < 60:
        return f"{mins}m {sec}s"
    hrs, mins = divmod(mins, 60)
    if hrs < 24:
        return f"{hrs}h {mins}m"
    days, hrs = divmod(hrs, 24)
    return f"{days}d {hrs}h"


def _runtime_snapshot():
    data = _read_json(RUNTIME_STATE_FILE, {}) or {}
    return data if isinstance(data, dict) else {}


def _proc_elapsed_seconds(pid):
    try:
        out = subprocess.check_output(
            ["ps", "-p", str(int(pid)), "-o", "etime="],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        if not out:
            return None
        parts = out.split("-")
        if len(parts) == 2:
            days = int(parts[0])
            hms = parts[1]
        else:
            days = 0
            hms = parts[0]
        t = hms.split(":")
        if len(t) == 3:
            hh, mm, ss = map(int, t)
        elif len(t) == 2:
            hh, mm = map(int, t)
            ss = 0
        else:
            return None
        return days * 86400 + hh * 3600 + mm * 60 + ss
    except Exception:
        return None


def _runtime_for_tag(tag, running, pids):
    snap = _runtime_snapshot().get(tag, {}) if isinstance(_runtime_snapshot(), dict) else {}
    now = int(datetime.now(timezone.utc).timestamp())
    pid = None
    if pids:
        pid = int(pids[0])
    elif isinstance(snap, dict) and snap.get("pid") is not None:
        try:
            pid = int(snap.get("pid"))
        except Exception:
            pid = None
    running_since = None
    stopped_since = None
    elapsed = None
    if running:
        # Prefer running_since from runtime state (updated on UI restart)
        # over ps process age (which reflects raw process lifetime)
        rs = (snap or {}).get("running_since")
        if isinstance(rs, (int, float)) and rs > 0:
            elapsed = max(0, now - int(rs))
        if elapsed is None and pid is not None:
            proc_elapsed = _proc_elapsed_seconds(pid)
            if proc_elapsed is not None:
                elapsed = proc_elapsed
        return {
            "mode": "running",
            "since_ts": (snap or {}).get("running_since") or now,
            "elapsed_seconds": elapsed,
            "elapsed_label": _human_duration(elapsed or 0),
            "last_transition_at": (snap or {}).get("last_transition_at"),
            "pid": pid,
        }
    ss = (snap or {}).get("stopped_since")
    if isinstance(ss, (int, float)) and ss > 0:
        stopped_since = int(ss)
        elapsed = max(0, now - stopped_since)
    return {
        "mode": "stopped",
        "since_ts": stopped_since or (snap or {}).get("last_transition_at"),
        "elapsed_seconds": elapsed,
        "elapsed_label": _human_duration(elapsed or 0) if elapsed is not None else "-",
        "last_transition_at": (snap or {}).get("last_transition_at"),
        "pid": pid,
    }


def _cfg_float(text, key, default=None):
    m = re.search(rf"^\s*{re.escape(key)}:\s*([^\s#]+)", text, flags=re.M)
    if not m:
        return default
    try:
        return float(m.group(1))
    except Exception:
        return default


def _cfg_bool(text, key, default=False):
    m = re.search(rf"^\s*{re.escape(key)}:\s*(true|false)", text, flags=re.M | re.I)
    if not m:
        return default
    return m.group(1).strip().lower() == "true"


def _load_universe_thresholds(tag):
    cfg_path = os.path.join(ROOT, f"config.universe.{tag}.yaml")
    txt = _read_text(cfg_path)
    return {
        "dynamic_filters": {
            "min_price": _cfg_float(txt, "min_price", 0.0),
            "max_price": _cfg_float(txt, "max_price", 1e12),
            "min_volume_20": _cfg_float(txt, "min_volume_20", None),
            "max_spread_bps": _cfg_float(txt, "max_spread_bps", None),
            "min_change_pct_10_bars": _cfg_float(txt, "min_change_pct_10_bars", None),
        },
        "morning_scan": {
            "min_gap_pct": _cfg_float(txt, "min_gap_pct", None),
            "min_rel_volume": _cfg_float(txt, "min_rel_volume", None),
        },
        "scalp_filters": {
            "min_vol_ratio": _cfg_float(txt, "min_vol_ratio", None),
            "min_trendline_bias": _cfg_float(txt, "min_trendline_bias", None),
            "min_ob_imbalance": _cfg_float(txt, "min_ob_imbalance", None),
            "max_spread_bps": _cfg_float(txt, "max_spread_bps", None),
            "min_signal_confidence": _cfg_float(txt, "min_signal_confidence", None),
            "require_price_above_vwap_for_long": _cfg_bool(txt, "require_price_above_vwap_for_long", False),
        },
    }


def _latest_watchlist_for_asset(asset_class):
    path = os.path.join(ROOT, "study", "watchlists")
    if not os.path.isdir(path):
        return None
    files = sorted(
        [fn for fn in os.listdir(path) if fn.startswith("watchlist_") and fn.endswith(".json")],
        reverse=True,
    )
    target = "stock" if asset_class == "stocks" else asset_class
    for fn in files[:40]:
        full = os.path.join(path, fn)
        obj = _read_json(full, {}) or {}
        if str(obj.get("asset_class", "")).strip().lower() != target:
            continue
        candidates = obj.get("candidates") or []
        sym_map = {}
        for row in candidates:
            sym = _norm_symbol((row or {}).get("symbol"))
            if sym:
                sym_map[sym] = row
        return {
            "file": full,
            "date": obj.get("date"),
            "generated_at": obj.get("generated_at"),
            "asset_class": target,
            "candidates": candidates,
            "symbol_map": sym_map,
        }
    return None


def _to_float(v, default=None):
    try:
        return float(v)
    except Exception:
        return default


def _pick_metric(sym, candidate, live_ranked, last_tick, keys):
    for key in keys:
        if key in live_ranked and live_ranked[key] is not None:
            return live_ranked[key], "live_watch"
        if key in candidate and candidate[key] is not None:
            return candidate[key], "watchlist"
        if key in last_tick and last_tick[key] is not None:
            return last_tick[key], "tick"
    return None, "none"


def _collect_symbol_activity(tag, hours=24):
    path = os.path.join(ROOT, f"journal.{tag}.jsonl")
    if not os.path.exists(path):
        return {"ticks": {}, "trades": {}, "top_movers": []}
    max_lines = 12000 if tag == "stocks" else 8000
    rows = _tail_jsonl(path, max_lines=max_lines)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    ticks = {}
    trades = {}

    for row in rows:
        ts = _parse_event_ts(row.get("ts") or row.get("timestamp") or row.get("filled_at"))
        if ts is None or ts < cutoff:
            continue
        typ = row.get("type")
        sym = _norm_symbol(row.get("symbol") or row.get("target_symbol"))
        if not sym:
            continue

        if typ == "tick":
            px = _to_float(row.get("px"), None)
            if px is None or px <= 0:
                continue
            entry = ticks.setdefault(
                sym,
                {"first_ts": None, "first_px": None, "last_ts": None, "last_px": None, "count": 0, "last_row": None},
            )
            tstamp = ts.timestamp()
            entry["count"] += 1
            if entry["first_ts"] is None or tstamp < entry["first_ts"]:
                entry["first_ts"] = tstamp
                entry["first_px"] = px
            if entry["last_ts"] is None or tstamp >= entry["last_ts"]:
                entry["last_ts"] = tstamp
                entry["last_px"] = px
                entry["last_row"] = row
            continue

        if typ in {"trade_open", "trade_close", "fill", "execution"}:
            t = trades.setdefault(
                sym,
                {
                    "opens": 0,
                    "closes": 0,
                    "events": 0,
                    "realized_pnl": 0.0,
                    "first_trade_ts": None,
                    "last_trade_ts": None,
                },
            )
            t["events"] += 1
            ts_iso = (ts.astimezone(timezone.utc).isoformat()).replace("+00:00", "Z")
            if t["first_trade_ts"] is None or ts_iso < t["first_trade_ts"]:
                t["first_trade_ts"] = ts_iso
            if t["last_trade_ts"] is None or ts_iso > t["last_trade_ts"]:
                t["last_trade_ts"] = ts_iso
            if typ == "trade_open":
                t["opens"] += 1
            if typ == "trade_close":
                t["closes"] += 1
                t["realized_pnl"] += _to_float(row.get("pnl"), 0.0) or 0.0

    movers = []
    for sym, info in ticks.items():
        first_px = _to_float(info.get("first_px"), None)
        last_px = _to_float(info.get("last_px"), None)
        if first_px is None or first_px <= 0 or last_px is None:
            continue
        pct = ((last_px - first_px) / first_px) * 100.0
        movers.append(
            {
                "symbol": sym,
                "pct_move": pct,
                "start_px": first_px,
                "end_px": last_px,
                "ticks": int(info.get("count") or 0),
            }
        )
    movers_sorted = sorted(movers, key=lambda x: x.get("pct_move", 0.0), reverse=True)
    top = movers_sorted[:5]
    if len(top) < 5:
        top = sorted(movers, key=lambda x: abs(x.get("pct_move", 0.0)), reverse=True)[:5]

    return {"ticks": ticks, "trades": trades, "top_movers": top}


def _threshold_check(name, value, threshold, op, source):
    if value is None or threshold is None:
        return {
            "name": name,
            "status": "unknown",
            "value": value,
            "threshold": threshold,
            "op": op,
            "source": source,
        }
    if op == ">=":
        passed = value >= threshold
    elif op == "<=":
        passed = value <= threshold
    else:
        passed = False
    return {
        "name": name,
        "status": "pass" if passed else "fail",
        "value": value,
        "threshold": threshold,
        "op": op,
        "source": source,
    }


def _missed_runner_audit(tag="stocks", hours=24, symbols=None):
    if tag not in {"crypto", "forex", "stocks"}:
        return {"ok": False, "error": "invalid asset"}

    symbols = [s for s in (_norm_symbol(x) for x in (symbols or [])) if s]

    watch = _latest_watchlist_for_asset(tag)
    watch_file = (watch or {}).get("file")
    raw_state = _read_json(os.path.join(ROOT, f"state.{tag}.json"), {}) or {}
    live_ranked = raw_state.get("watched_ranked") or []
    live_ranked_map = {_norm_symbol(r.get("symbol")): r for r in live_ranked if _norm_symbol(r.get("symbol"))}
    live_watch = {_norm_symbol(s) for s in (raw_state.get("watched_symbols") or []) if _norm_symbol(s)}
    live_watch |= set(live_ranked_map.keys())

    watch_symbols = set()
    watch_map = {}
    if watch:
        watch_map = watch.get("symbol_map") or {}
        watch_symbols = set(watch_map.keys())

    activity = _collect_symbol_activity(tag, hours=hours)
    ticks = activity.get("ticks") or {}
    trades = activity.get("trades") or {}
    traded_symbols = set(trades.keys())
    top_movers = activity.get("top_movers") or []

    if not symbols and tag == "stocks":
        interest_str = os.getenv("MISSED_RUNNERS_OF_INTEREST", "").strip()
        if interest_str:
            symbols = [s.strip().upper() for s in interest_str.split(",") if s.strip()]
        else:
            live_focus = sorted(live_watch | watch_symbols)
            if not live_focus:
                live_focus = [m.get("symbol") for m in top_movers if m.get("symbol")]
            symbols = [s for s in live_focus if s][:5]

    cache_key = f"{tag}|{hours}|{','.join(symbols)}"
    now_ts = datetime.now(timezone.utc).timestamp()
    cached = _MISSED_RUNNER_CACHE.get(cache_key)
    # Cache for 30s to avoid excessive re-computation while respecting bot updates
    if cached and (now_ts - float(cached.get("ts", 0.0))) < 30.0:
        return cached.get("value")

    union_symbols = watch_symbols | live_watch | traded_symbols
    if symbols:
        union_symbols |= set(symbols)
    status_order = {
        "watchlist_only_dropped": 0,
        "live_watched_not_traded": 1,
        "traded": 2,
        "live_only": 3,
        "other": 4,
    }

    recon_rows = []
    for sym in union_symbols:
        in_watch = sym in watch_symbols
        in_live = sym in live_watch
        traded = sym in traded_symbols
        if traded:
            status = "traded"
        elif in_live and in_watch:
            status = "live_watched_not_traded"
        elif in_watch and not in_live:
            status = "watchlist_only_dropped"
        elif in_live and not in_watch:
            status = "live_only"
        else:
            status = "other"
        t = trades.get(sym, {})
        recon_rows.append(
            {
                "symbol": sym,
                "in_watchlist": in_watch,
                "in_live_watched": in_live,
                "traded": traded,
                "status": status,
                "trade_events": int(t.get("events") or 0),
                "trade_opens": int(t.get("opens") or 0),
                "trade_closes": int(t.get("closes") or 0),
                "trade_realized_pnl": float(t.get("realized_pnl") or 0.0),
                "first_trade_ts": t.get("first_trade_ts"),
                "last_trade_ts": t.get("last_trade_ts"),
            }
        )
    recon_rows.sort(key=lambda r: (0 if r["symbol"] in symbols else 1, status_order.get(r["status"], 9), r["symbol"]))

    cfg = _load_universe_thresholds(tag)
    dyn = cfg.get("dynamic_filters") or {}
    morning = cfg.get("morning_scan") or {}
    scalp = cfg.get("scalp_filters") or {}

    coverage_symbols = []
    for sym in symbols + [m.get("symbol") for m in top_movers]:
        sym = _norm_symbol(sym)
        if sym and sym not in coverage_symbols:
            coverage_symbols.append(sym)

    coverage = []
    filters = []
    for sym in coverage_symbols:
        candidate = watch_map.get(sym) or {}
        live = live_ranked_map.get(sym) or {}
        tick_info = ticks.get(sym) or {}
        last_row = tick_info.get("last_row") or {}
        mctx = (last_row.get("market_context") or {}) if isinstance(last_row, dict) else {}
        traded = sym in traded_symbols

        px, px_src = _pick_metric(sym, candidate, live, {"px": last_row.get("px")}, ["px"])
        spread, spread_src = _pick_metric(
            sym, candidate, live, {"spread_bps": mctx.get("spread_bps")}, ["spread_bps"]
        )
        gap, gap_src = _pick_metric(sym, candidate, live, {}, ["gap_pct"])
        rel_vol, rel_src = _pick_metric(sym, candidate, live, {"rel_vol": mctx.get("vol_ratio")}, ["rel_vol"])

        checks = [
            _threshold_check("price>=min_price", _to_float(px), _to_float(dyn.get("min_price")), ">=", px_src),
            _threshold_check("price<=max_price", _to_float(px), _to_float(dyn.get("max_price")), "<=", px_src),
            _threshold_check("spread_bps<=dynamic_max", _to_float(spread), _to_float(dyn.get("max_spread_bps")), "<=", spread_src),
            _threshold_check("gap_pct>=morning_min_gap", _to_float(gap), _to_float(morning.get("min_gap_pct")), ">=", gap_src),
            _threshold_check(
                "rel_vol>=morning_min_rel_vol", _to_float(rel_vol), _to_float(morning.get("min_rel_volume")), ">=", rel_src
            ),
        ]
        failed = [c["name"] for c in checks if c["status"] == "fail"]
        if traded:
            scan_status = "captured"
            scan_reason = "traded"
        elif not candidate and not live and not last_row:
            scan_status = "missed"
            scan_reason = "not in watch/live/ticks"
        elif failed:
            scan_status = "missed"
            # Abbreviate filter names for clarity: "price>=min_price" → "price", etc
            abbrev = {"price>=min_price": "price↑", "price<=max_price": "price↓",
                      "spread_bps<=dynamic_max": "spread", "gap_pct>=morning_min_gap": "gap",
                      "rel_vol>=morning_min_rel_vol": "vol"}
            short_fails = [abbrev.get(f, f[:15]) for f in failed[:2]]
            scan_reason = f"failed: {', '.join(short_fails)}"
        elif live and not traded:
            scan_status = "partially_captured"
            scan_reason = "in live watch but no trade"
        elif candidate and not live:
            scan_status = "missed"
            scan_reason = "morning candidate but absent from live watched set"
        else:
            scan_status = "partially_captured"
            scan_reason = "seen but no clear block found"

        coverage.append(
            {
                "symbol": sym,
                "scan_status": scan_status,
                "scan_reason": scan_reason,
                "in_watchlist_candidate": bool(candidate),
                "in_live_watched": bool(live or sym in live_watch),
                "traded": traded,
                "checks": checks,
                "last_tick_ts": last_row.get("ts"),
                "last_signal": last_row.get("sig"),
                "last_regime": last_row.get("regime"),
                "pct_move_24h": next((m.get("pct_move") for m in top_movers if m.get("symbol") == sym), None),
            }
        )

        vol_ratio = _to_float(mctx.get("vol_ratio"))
        trendline = _to_float(mctx.get("trendline_bias"))
        ob_imb = _to_float(mctx.get("ob_imbalance"))
        spread_bps = _to_float(mctx.get("spread_bps"))
        vwap_20 = _to_float(mctx.get("vwap_20"))
        px_tick = _to_float(last_row.get("px"))
        setup_quality = _to_float(last_row.get("setup_quality"))
        regime = str(last_row.get("regime") or "")
        setup_type = str(last_row.get("setup_type") or "")
        sig = str(last_row.get("sig") or "")

        fail = []
        if _to_float(scalp.get("min_vol_ratio")) is not None and vol_ratio is not None and vol_ratio < _to_float(scalp.get("min_vol_ratio")):
            fail.append(f"vol_ratio<{_to_float(scalp.get('min_vol_ratio')):.3f}")
        if _to_float(scalp.get("min_trendline_bias")) is not None and trendline is not None and trendline < _to_float(scalp.get("min_trendline_bias")):
            fail.append(f"trendline<{_to_float(scalp.get('min_trendline_bias')):.3f}")
        if _to_float(scalp.get("min_ob_imbalance")) is not None and ob_imb is not None and ob_imb < _to_float(scalp.get("min_ob_imbalance")):
            fail.append(f"ob_imb<{_to_float(scalp.get('min_ob_imbalance')):.3f}")
        if _to_float(scalp.get("max_spread_bps")) is not None and spread_bps is not None and spread_bps > _to_float(scalp.get("max_spread_bps")):
            fail.append(f"spread_bps>{_to_float(scalp.get('max_spread_bps')):.2f}")
        if scalp.get("require_price_above_vwap_for_long") and px_tick is not None and vwap_20 is not None and px_tick < vwap_20:
            fail.append("price_below_vwap")
        if _to_float(scalp.get("min_signal_confidence")) is not None and setup_quality is not None and setup_quality < _to_float(scalp.get("min_signal_confidence")):
            fail.append(f"setup_quality<{_to_float(scalp.get('min_signal_confidence')):.2f}")
        if sig and sig.lower() not in {"long", "buy"}:
            fail.append(f"signal={sig.lower()}")
        if regime.lower() == "chaos" and setup_type.lower() == "none":
            fail.append("chaos+setup_none")

        if traded:
            audit_status = "traded"
            audit_reason = "trade executed"
        elif not last_row:
            audit_status = "no_data"
            audit_reason = "no tick telemetry for symbol in selected window"
        elif fail:
            audit_status = "blocked"
            audit_reason = ", ".join(fail[:4])
        else:
            audit_status = "unclear"
            audit_reason = "latest sample passed hard filters; likely ranking/timing/no trigger"

        filters.append(
            {
                "symbol": sym,
                "status": audit_status,
                "reason": audit_reason,
                "sig": sig or None,
                "regime": regime or None,
                "setup_type": setup_type or None,
                "last_tick_ts": last_row.get("ts"),
                "vol_ratio": vol_ratio,
                "spread_bps": spread_bps,
                "vwap_20": vwap_20,
                "px": px_tick,
            }
        )

    result = {
        "ok": True,
        "asset_class": tag,
        "window_hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "focus_symbols": symbols,
        "watchlist_source": {
            "file": watch_file,
            "date": (watch or {}).get("date"),
            "generated_at": (watch or {}).get("generated_at"),
            "candidate_count": len((watch or {}).get("candidates") or []),
        },
        "reconciliation": {
            "watchlist_count": len(watch_symbols),
            "live_watched_count": len(live_watch),
            "traded_count": len(traded_symbols),
            "rows": recon_rows[:80],
        },
        "top_movers": top_movers,
        "scanner_coverage": coverage,
        "entry_filter_audit": filters,
    }
    _MISSED_RUNNER_CACHE[cache_key] = {"ts": now_ts, "value": result}
    return result


def _get_break_watchers(tag="stocks"):
    """
    Get all active break watchers from state file.
    Returns: {
        "ok": bool,
        "asset": tag,
        "break_watchers": [
            {"symbol": "HOOD", "break": 5.50, "current": 5.48, "minutes_waiting": 12, "confidence": 0.85},
            ...
        ]
    }
    """
    state_file = os.path.join(ROOT, f"state.{tag}.json")
    watchers = []
    now_ts = datetime.now(timezone.utc).timestamp()

    try:
        if not os.path.exists(state_file):
            return {"ok": True, "asset": tag, "break_watchers": []}

        with open(state_file, "r") as f:
            state = json.load(f)

        break_watchers_dict = state.get("break_watchers") or {}
        for symbol, watch in break_watchers_dict.items():
            try:
                added_ts = int(watch.get("added_ts", 0))
                minutes_waiting = max(0, int((now_ts - added_ts) / 60))
                watchers.append({
                    "symbol": str(symbol).upper(),
                    "break": float(watch.get("break", 0)),
                    "confidence": round(float(watch.get("confidence", 0.5)), 2),
                    "source": str(watch.get("source", "unknown")),
                    "minutes_waiting": minutes_waiting,
                    "l2_wall": watch.get("l2_wall"),
                    "recent_high": watch.get("recent_high"),
                })
            except Exception:
                pass

        # Sort by confidence descending
        watchers.sort(key=lambda x: -x["confidence"])

        return {
            "ok": True,
            "asset": tag,
            "break_watchers_count": len(watchers),
            "break_watchers": watchers,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "asset": tag, "break_watchers": []}


def get_ui_action_pin():
    return os.getenv("UI_ACTION_PIN", "").strip()


def load_env_file(path):
    try:
        for ln in open(path, "r"):
            s = ln.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass


def run_script(name):
    p = subprocess.run(["bash", os.path.join(ROOT, "scripts", name)], cwd=ROOT, capture_output=True, text=True)
    return {"ok": p.returncode == 0, "code": p.returncode, "out": (p.stdout or "")[-2000:], "err": (p.stderr or "")[-2000:]}

def _kill_switch_file(tag):
    return os.path.join(ROOT, f"KILL_SWITCH_{str(tag).upper()}")


def _kill_switch_state():
    out = {}
    for tag in BOT_TAGS:
        path = _kill_switch_file(tag)
        out[tag] = {"enabled": os.path.exists(path), "file": os.path.basename(path)}
    return out


def _set_kill_switch(tag, mode):
    if tag not in BOT_TAGS:
        return {"ok": False, "error": "invalid tag"}
    path = _kill_switch_file(tag)
    m = str(mode or "").strip().lower()
    try:
        if m == "on":
            with open(path, "w") as f:
                f.write("1\n")
            enabled = True
        elif m == "off":
            if os.path.exists(path):
                os.remove(path)
            enabled = False
        elif m == "toggle":
            if os.path.exists(path):
                os.remove(path)
                enabled = False
            else:
                with open(path, "w") as f:
                    f.write("1\n")
                enabled = True
        else:
            return {"ok": False, "error": "invalid mode"}
        return {"ok": True, "tag": tag, "enabled": enabled, "file": os.path.basename(path)}
    except Exception as e:
        return {"ok": False, "error": str(e), "tag": tag}


def _queue_buy_now(tag, mult, symbol=None):
    if tag not in BOT_TAGS:
        return {"ok": False, "error": "invalid tag"}
    try:
        m = float(mult)
    except Exception:
        return {"ok": False, "error": "invalid multiplier"}
    if m < 1 or m > 5:
        return {"ok": False, "error": "multiplier must be between 1 and 5"}
    sym = str(symbol or "").strip().upper()
    path = os.path.join(ROOT, BUY_FILE_BY_TAG.get(tag, f"BUY_NOW_{tag.upper()}"))
    try:
        with open(path, "w") as f:
            payload = {"multiplier": m}
            if sym:
                payload["symbol"] = sym
            f.write(json.dumps(payload) + "\n")
        return {"ok": True, "tag": tag, "multiplier": m, "symbol": (sym or None), "file": os.path.basename(path)}
    except Exception as e:
        return {"ok": False, "error": str(e), "tag": tag}


def _alpaca_request_json(method, url, payload=None, timeout=12):
    key = os.getenv("ALPACA_API_KEY", "").strip()
    sec = os.getenv("ALPACA_API_SECRET", "").strip()
    if not key or not sec:
        raise RuntimeError("missing alpaca credentials")
    headers = {
        "APCA-API-KEY-ID": key,
        "APCA-API-SECRET-KEY": sec,
        "Content-Type": "application/json",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = Request(url, headers=headers, method=method.upper(), data=data)
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            pass
        try:
            obj = json.loads(raw) if raw else {}
        except Exception:
            obj = {"message": raw or str(e)}
        msg = obj.get("message") or str(e)
        code = obj.get("code")
        raise RuntimeError(f"alpaca_http {e.code} {code or ''} {msg}".strip())


def _alpaca_pending_orders(limit=200):
    base = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    try:
        rows = _alpaca_request_json("GET", f"{base}/v2/orders?status=open&limit={int(limit)}&direction=desc")
        if isinstance(rows, dict):
            rows = rows.get("orders") or []
        if not isinstance(rows, list):
            rows = []
        out = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            out.append({
                "id": row.get("id"),
                "symbol": _norm_symbol(row.get("symbol")),
                "side": str(row.get("side") or "").lower(),
                "type": str(row.get("type") or "").lower(),
                "status": str(row.get("status") or "").lower(),
                "qty": row.get("qty"),
                "filled_qty": row.get("filled_qty"),
                "notional": row.get("notional"),
                "limit_price": row.get("limit_price"),
                "submitted_at": row.get("submitted_at") or row.get("created_at"),
                "time_in_force": row.get("time_in_force"),
                "extended_hours": bool(row.get("extended_hours")),
            })
        return {"ok": True, "orders": out, "count": len(out)}
    except Exception as e:
        return {"ok": False, "orders": [], "error": str(e)}


def _alpaca_news_for_symbols(symbols, limit_per_symbol=3):
    syms = []
    for s in symbols or []:
        ns = _norm_symbol(s)
        if ns and ns not in syms:
            syms.append(ns)
    if not syms:
        return {"ok": True, "news": {}}

    key = os.getenv("ALPACA_API_KEY", "").strip()
    sec = os.getenv("ALPACA_API_SECRET", "").strip()
    if not key or not sec:
        return {"ok": False, "error": "missing alpaca credentials", "news": {}}

    base = "https://data.alpaca.markets"
    syms = syms[:30]
    out = {sym: [] for sym in syms}
    try:
        params = urlencode({
            "symbols": ",".join(syms),
            "limit": max(1, min(50, len(syms) * int(limit_per_symbol))),
            "sort": "desc",
            "include_content": "false",
        })
        url = f"{base}/v1beta1/news?{params}"
        req = Request(url, headers={
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": sec,
        })
        with urlopen(req, timeout=12) as r:
            obj = json.loads(r.read().decode("utf-8"))
        rows = obj.get("news") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            rows = []
        wanted = set(syms)
        for row in rows:
            if not isinstance(row, dict):
                continue
            parsed = {
                "headline": row.get("headline") or row.get("summary") or "",
                "summary": row.get("summary") or "",
                "url": row.get("url") or "",
                "source": row.get("source") or "",
                "created_at": row.get("created_at") or row.get("updated_at") or "",
                "symbols": row.get("symbols") or [],
            }
            row_syms = [_norm_symbol(s) for s in (row.get("symbols") or [])]
            for sym in row_syms:
                if sym in wanted and len(out[sym]) < int(limit_per_symbol):
                    out[sym].append(parsed)
    except Exception as e:
        return {"ok": False, "error": str(e), "news": out}
    return {"ok": True, "news": out}


def _alpaca_manual_buy(symbol, multiplier):
    sym = _norm_symbol(symbol)
    if not sym:
        return {"ok": False, "error": "missing symbol"}
    try:
        mult = int(float(multiplier))
    except Exception:
        return {"ok": False, "error": "invalid multiplier"}
    if mult < 1 or mult > 5:
        return {"ok": False, "error": "multiplier must be 1..5"}

    notional = float(500 * mult)
    base = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    data_base = "https://data.alpaca.markets"
    order_payload = {
        "symbol": sym,
        "side": "buy",
        "type": "market",
        "time_in_force": "day",
        "notional": f"{notional:.2f}",
    }
    try:
        order = _alpaca_request_json("POST", f"{base}/v2/orders", payload=order_payload)
        return {
            "ok": True,
            "symbol": sym,
            "multiplier": mult,
            "order": {
                "id": order.get("id"),
                "status": order.get("status"),
                "type": order.get("type"),
                "side": order.get("side"),
                "qty": order.get("qty"),
                "notional": order.get("notional"),
                "submitted_at": order.get("submitted_at"),
            },
        }
    except Exception as e:
        msg = str(e)
        # Fallback for non-fractionable symbols: estimate whole-share qty and retry.
        if "fraction" in msg.lower():
            try:
                q = _alpaca_request_json("GET", f"{data_base}/v2/stocks/{sym}/quotes/latest?feed=iex")
                quote = (q or {}).get("quote") or {}
                px = float(quote.get("ap") or quote.get("bp") or 0.0)
                qty = int(notional // px) if px > 0 else 0
                if qty <= 0:
                    return {"ok": False, "error": f"cannot compute qty for {sym} at current quote"}
                order_payload = {
                    "symbol": sym,
                    "side": "buy",
                    "type": "market",
                    "time_in_force": "day",
                    "qty": str(qty),
                }
                order = _alpaca_request_json("POST", f"{base}/v2/orders", payload=order_payload)
                return {
                    "ok": True,
                    "symbol": sym,
                    "multiplier": mult,
                    "order": {
                        "id": order.get("id"),
                        "status": order.get("status"),
                        "type": order.get("type"),
                        "side": order.get("side"),
                        "qty": order.get("qty"),
                        "notional": order.get("notional"),
                        "submitted_at": order.get("submitted_at"),
                    },
                    "note": "submitted with whole-share qty fallback",
                }
            except Exception as e2:
                return {"ok": False, "error": str(e2)}
        return {"ok": False, "error": msg}


def _pgrep_lines(pattern):
    p = subprocess.run(["pgrep", "-af", pattern], capture_output=True, text=True)
    if p.returncode not in (0, 1):
        return []
    lines = [ln.strip() for ln in (p.stdout or "").splitlines() if ln.strip()]
    return lines


def bot_status():
    lane_tags = BOT_TAGS
    matrix_tags = [tag for tags in MATRIX_BY_ASSET.values() for tag in tags]

    out = {
        "ok": True,
        "bots": {},
        "kill_switches": _kill_switch_state(),
        "running_total": 0,
        "matrix": {},
        "fleet": {
            "lane_running": 0,
            "crypto_running": 0,
            "forex_running": 0,
            "stocks_running": 0,
            "overnight_running": 0,
            "all_running": 0,
            "assets": {},
        },
    }

    # Universe lanes (crypto/forex/stocks/overnight)
    for tag in lane_tags:
        pattern = f"bot.py --config {BOT_CONFIG_BY_TAG[tag]}"
        lines = _pgrep_lines(pattern)
        pids = []
        for ln in lines:
            parts = ln.split(" ", 1)
            if parts and parts[0].isdigit():
                pids.append(int(parts[0]))
        running = len(pids) > 0
        runtime = _runtime_for_tag(tag, running, pids)
        out["bots"][tag] = {"running": running, "count": len(pids), "pids": pids, "runtime": runtime}
        out["running_total"] += len(pids)
        out["fleet"]["lane_running"] += len(pids)

    # Matrix bots (crypto_btc, forex_eurusd, ...)
    for tag in matrix_tags:
        pattern = f"bot.py --config config.{tag}.yaml"
        lines = _pgrep_lines(pattern)
        pids = []
        for ln in lines:
            parts = ln.split(" ", 1)
            if parts and parts[0].isdigit():
                pids.append(int(parts[0]))
        out["matrix"][tag] = {"running": len(pids) > 0, "count": len(pids), "pids": pids}

    # Fleet summary by asset class (matrix only)
    out["fleet"]["crypto_running"] = sum(out["matrix"][t]["count"] for t in MATRIX_BY_ASSET["crypto"])
    out["fleet"]["forex_running"] = sum(out["matrix"][t]["count"] for t in MATRIX_BY_ASSET["forex"])
    out["fleet"]["stocks_running"] = sum(out["matrix"][t]["count"] for t in MATRIX_BY_ASSET["stocks"])
    out["fleet"]["overnight_running"] = (out["bots"].get("overnight") or {}).get("count", 0)

    def open_symbols(tags):
        syms = []
        for t in tags:
            matrix_state = out["matrix"].get(t)
            lane_state = out["bots"].get(t)
            if matrix_state is not None and matrix_state.get("count", 0) <= 0:
                continue
            if lane_state is not None and lane_state.get("count", 0) <= 0:
                continue
            st = _read_json(os.path.join(ROOT, f"state.{t}.json"), {}) or {}
            pos = st.get("position")
            if isinstance(pos, dict) and pos:
                sym = pos.get("symbol") or st.get("active_symbol") or t
                side = str(pos.get("side") or "").upper() or "OPEN"
                syms.append(f"{sym} ({side})")
        return syms

    out["fleet"]["crypto_open_positions"] = open_symbols(MATRIX_BY_ASSET["crypto"])
    out["fleet"]["forex_open_positions"] = open_symbols(MATRIX_BY_ASSET["forex"])
    out["fleet"]["stocks_open_positions"] = open_symbols(MATRIX_BY_ASSET["stocks"])
    out["fleet"]["overnight_open_positions"] = open_symbols(["overnight"])

    for asset, tags in MATRIX_BY_ASSET.items():
        out["fleet"]["assets"][asset] = {
            "lane_running": (out["bots"].get(asset) or {}).get("count", 0),
            "lane_pids": (out["bots"].get(asset) or {}).get("pids", []),
            "matrix_running": sum(out["matrix"][t]["count"] for t in tags),
            "matrix_total": len(tags),
            "matrix_bots": [
                {
                    "id": t,
                    "label": _matrix_label(t),
                    "running": out["matrix"][t]["running"],
                    "count": out["matrix"][t]["count"],
                    "pids": out["matrix"][t]["pids"],
                }
                for t in tags
            ],
            "matrix_open_positions": open_symbols(tags),
        }

    out["fleet"]["assets"]["overnight"] = {
        "lane_running": (out["bots"].get("overnight") or {}).get("count", 0),
        "lane_pids": (out["bots"].get("overnight") or {}).get("pids", []),
        "matrix_running": 0,
        "matrix_total": 0,
        "matrix_bots": [],
        "matrix_open_positions": open_symbols(["overnight"]),
    }

    out["fleet"]["all_running"] = (
        out["fleet"]["lane_running"]
        + out["fleet"]["crypto_running"]
        + out["fleet"]["forex_running"]
        + out["fleet"]["stocks_running"]
        + out["fleet"]["overnight_running"]
    )

    return out


def bot_action(tag, action):
    if tag not in BOT_TAGS:
        return {"ok": False, "error": "invalid tag"}
    cfg = BOT_CONFIG_BY_TAG[tag]

    def sync_runtime_state():
        """Sync runtime state to match actual running processes."""
        try:
            import time
            result = subprocess.check_output("ps aux | grep 'bot.py' | grep -v grep", shell=True, text=True)
            pids = {}
            for line in result.strip().split('\n'):
                if not line: continue
                parts = line.split(); pid = int(parts[1]); cmd = parts[-1]
                if 'crypto' in cmd: pids['crypto'] = pid
                elif 'forex' in cmd: pids['forex'] = pid
                elif 'overnight' in cmd or 'overnight.stocks' in cmd: pids['overnight'] = pid
                elif 'stocks' in cmd and 'overnight' not in cmd: pids['stocks'] = pid
            now = int(time.time())
            state = {k: {'running_since': now, 'stopped_since': None, 'running': k in pids, 'pid': pids.get(k), 'last_transition_at': now} for k in ['crypto', 'forex', 'stocks', 'overnight']}
            with open(os.path.join(DATA_ROOT, ".runtime", "bot_runtime_state.json"), "w") as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

    if action == "stop":
        p = subprocess.run(["pkill", "-f", f"bot.py --config {cfg}"], capture_output=True, text=True)
        ok = p.returncode in (0, 1)
        sync_runtime_state()  # Sync after stopping
        return {"ok": ok, "code": p.returncode, "out": (p.stdout or "")[-2000:], "err": (p.stderr or "")[-2000:]}
    if action == "start":
        # avoid duplicates
        lines = _pgrep_lines(f"bot.py --config {cfg}")
        if lines:
            return {"ok": True, "code": 0, "out": f"{tag} already running", "err": ""}
        pybin = os.getenv("TRADEBOT_PYTHON", os.path.join(DATA_ROOT, ".venv", "bin", "python"))
        cmd = f"nohup {pybin} bot.py --config {cfg} >> bot.{tag}.log 2>&1 &"
        p = subprocess.run(["bash", "-lc", cmd], cwd=ROOT, capture_output=True, text=True)
        import time; time.sleep(1)  # Give bot time to start
        sync_runtime_state()  # Sync after starting
        return {"ok": p.returncode == 0, "code": p.returncode, "out": (p.stdout or "")[-2000:], "err": (p.stderr or "")[-2000:]}
    if action == "close":
        sell_file = os.path.join(ROOT, f"SELL_NOW_{tag.upper()}")
        try:
            with open(sell_file, "w") as f:
                f.write("1\n")
            return {"ok": True, "code": 0, "out": f"close signal queued: {os.path.basename(sell_file)}", "err": ""}
        except Exception as e:
            return {"ok": False, "code": 1, "out": "", "err": str(e)}
    return {"ok": False, "error": "invalid action"}


def _tail_file(path, max_lines=120):
    try:
        if not os.path.exists(path):
            return ""
        with open(path, "r", errors="ignore") as f:
            lines = f.readlines()
        return "".join(lines[-max_lines:])
    except Exception:
        return ""


def get_logs_snapshot():
    files = {k: os.path.join(ROOT, v) for k, v in BOT_LOG_BY_TAG.items()}
    files["ui"] = os.path.join(ROOT, "ui.log")
    out = {"ok": True, "files": {}, "combined": ""}
    chunks = []
    for k, p in files.items():
        txt = _tail_file(p, max_lines=80)
        out["files"][k] = txt
        if txt:
            chunks.append(f"===== {k.upper()} ({os.path.basename(p)}) =====\n{txt}")
    out["combined"] = "\n".join(chunks)[-120000:]

    # persist rolling combined log
    try:
        logs_dir = os.path.join(ROOT, "logs")
        os.makedirs(logs_dir, exist_ok=True)
        all_path = os.path.join(logs_dir, "all.log")
        with open(all_path, "a", errors="ignore") as f:
            f.write("\n\n--- snapshot ---\n")
            f.write(out["combined"][-12000:])
    except Exception:
        pass

    return out


def _read_json(path, default=None):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return default


def _parse_event_ts(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _event_day_et(ts):
    dt = _parse_event_ts(ts)
    if dt is None:
        return ""
    return dt.astimezone(ET_TZ).date().isoformat()


def _today_et():
    return datetime.now(ET_TZ).date().isoformat()


def _default_trade_summary():
    return {
        "today_realized_pnl": 0.0,
        "today_closed_trades": 0,
        "today_opened_trades": 0,
        "today_trade_events": 0,
        "all_time_realized_pnl": 0.0,
        "all_time_closed_trades": 0,
        "all_time_opened_trades": 0,
        "today_wins": 0,
        "today_losses": 0,
        "all_time_wins": 0,
        "all_time_losses": 0,
        "today_ai_decisions": 0,
        "latest_trade": None,
        "last_close": None,
        "last_open": None,
    }


def _matrix_label(tag):
    _, raw = tag.split("_", 1)
    if tag.startswith("forex_") and len(raw) == 6:
        return f"{raw[:3].upper()}/{raw[3:].upper()}"
    return raw.upper()


def render_lite_html():
    st = bot_status()
    s_crypto = _state_summary("crypto")
    s_forex = _state_summary("forex")
    s_stocks = _state_summary("stocks")
    s_overnight = _state_summary("overnight")

    def block(name, s, b):
        pnl = s.get("total_pnl", s.get("journal_today_realized_pnl", s.get("daily_pnl", 0.0)))
        tr = s.get("journal_today_closed_trades", s.get("trades_today", 0))
        bal = s.get("paper_balance", 0.0)
        pos = s.get("position")
        pos_txt = "none"
        if isinstance(pos, dict):
            pos_txt = f"{pos.get('side','?')} {pos.get('symbol','?')} @ {pos.get('entry','?')}"
            if name in {"Stocks", "Overnight"}:
                live_px = pos.get("current_price")
                live_pnl = pos.get("unrealized_pnl")
                if live_px is not None and live_pnl is not None:
                    pos_txt += f" | live {float(live_px):.2f} pnl {float(live_pnl):+.2f}"
        ranked = (s.get("watched_ranked") or [])[:8]
        wl = ", ".join([str(r.get("symbol")) for r in ranked]) if ranked else ", ".join((s.get("watched_symbols") or [])[:8])
        run = (b or {}).get("running", False)
        pids = ",".join([str(x) for x in ((b or {}).get("pids") or [])])
        return f"""
        <div class='card'>
          <h3>{name}</h3>
          <div>status: <b>{'RUNNING' if run else 'OFF'}</b> {pids}</div>
          <div>day_realized: <b>{pnl:+.4f}</b> • closed: {tr} • bal: {bal:.2f}</div>
          <div>position: {pos_txt}</div>
          <div>watchlist: {wl or '-'}</div>
        </div>
        """

    html = f"""<!doctype html><html><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/>
    <meta http-equiv='refresh' content='5'>
    <title>Tradebot Lite</title>
    <style>body{{font-family:Arial;background:#0b1020;color:#e7ecff;padding:12px}} .row{{display:grid;grid-template-columns:1fr;gap:10px}} .card{{border:1px solid #2a3b77;border-radius:10px;padding:10px;background:#121a34}}</style>
    </head><body>
    <h2>Tradebot Lite (auto-refresh 5s)</h2>
    <div><a href='/ui/' style='color:#9fd3ff'>Open full UI</a></div>
    <div class='row'>
      {block('Crypto', s_crypto, (st.get('bots') or {}).get('crypto'))}
      {block('Forex', s_forex, (st.get('bots') or {}).get('forex'))}
      {block('Stocks', s_stocks, (st.get('bots') or {}).get('stocks'))}
      {block('Overnight', s_overnight, (st.get('bots') or {}).get('overnight'))}
    </div>
    </body></html>"""
    return html


def get_api_balances():
    out = {"ok": True, "alpaca": None, "oanda": None, "note": "OpenAI billing balance is not exposed reliably via project key; showing broker balances."}

    # Alpaca
    ak = os.getenv("ALPACA_API_KEY", "").strip()
    asec = os.getenv("ALPACA_API_SECRET", "").strip()
    abase = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    if ak and asec:
        try:
            req = Request(f"{abase}/v2/account", headers={"APCA-API-KEY-ID": ak, "APCA-API-SECRET-KEY": asec})
            with urlopen(req, timeout=10) as r:
                obj = json.loads(r.read().decode("utf-8"))
            out["alpaca"] = {
                "status": obj.get("status"),
                "cash": obj.get("cash"),
                "equity": obj.get("equity"),
                "currency": obj.get("currency", "USD"),
            }
        except Exception as e:
            out["alpaca"] = {"error": str(e)}

    # OANDA
    ok = os.getenv("OANDA_API_KEY", "").strip()
    oid = os.getenv("OANDA_ACCOUNT_ID", "").strip()
    oenv = os.getenv("OANDA_ENV", "practice").strip().lower()
    obase = "https://api-fxpractice.oanda.com" if oenv != "live" else "https://api-fxtrade.oanda.com"
    if ok and oid:
        try:
            req = Request(f"{obase}/v3/accounts/{oid}/summary", headers={"Authorization": f"Bearer {ok}"})
            with urlopen(req, timeout=10) as r:
                obj = json.loads(r.read().decode("utf-8"))
            a = obj.get("account") or {}
            out["oanda"] = {
                "balance": a.get("balance"),
                "NAV": a.get("NAV"),
                "currency": a.get("currency", "USD"),
            }
        except Exception as e:
            out["oanda"] = {"error": str(e)}

    return out


def _state_summary(tag):
    if tag not in BOT_TAGS:
        return {"ok": False, "error": "invalid tag"}
    s = _read_json(os.path.join(ROOT, BOT_STATE_BY_TAG[tag]), {}) or {}
    journal = _journal_trade_summary(tag)
    ranked = s.get("watched_ranked") or []
    watched = s.get("watched_symbols") or []
    # Inject any pinned symbols that aren't already in watched_ranked.
    # The morning scan populates watched_ranked once per day, but pinned symbols
    # added after the scan runs won't appear until the next day — this fixes that.
    pinned = _get_pinned_symbols(tag)
    if pinned:
        scan_top = _get_scan_top_from_log(tag)
        watched_set = {r["symbol"] for r in ranked}
        for sym in pinned:
            if sym not in watched_set:
                top_info = scan_top.get(sym, {})
                ranked.append({
                    "symbol": sym,
                    "score": top_info.get("score", 0.0),
                    "signal": top_info.get("signal", "watching"),
                    "regime": "pinned",
                    "gap_pct": None, "rel_vol": None, "atr_pct": None,
                    "range_pct": None, "px": None, "today_vol": None,
                    "spread_bps": None, "pm_high": None, "pm_low": None,
                })
                if sym not in watched:
                    watched.append(sym)

    pos = s.get("position")
    if not isinstance(pos, dict) or not pos:
        positions = s.get("positions") or {}
        if isinstance(positions, dict) and positions:
            pos = next(iter(positions.values()))

    state_daily_pnl = float(s.get("daily_pnl", 0.0) or 0.0)
    state_trades_today = int(s.get("trades_today", 0) or 0)
    summary_sync_warning = None
    if journal["today_trade_events"]:
        pnl_gap = abs(state_daily_pnl - journal["today_realized_pnl"])
        if pnl_gap >= 0.005 or state_trades_today < journal["today_closed_trades"]:
            summary_sync_warning = (
                f"journal shows {journal['today_closed_trades']} close(s) / {journal['today_realized_pnl']:+.2f}; "
                f"state shows {state_trades_today} / {state_daily_pnl:+.2f}"
            )

    ai_calls_today = int(s.get("ai_calls_today", 0) or 0)
    non_api_decisions_today = int(s.get("non_api_decisions_today", 0) or 0)
    if ai_calls_today > 0 or journal["today_ai_decisions"] > 0:
        decision_mode = "AI-assisted"
    elif non_api_decisions_today > 0 or journal["today_trade_events"] > 0:
        decision_mode = "Rules-only"
    else:
        decision_mode = "Idle"

    if tag in {"stocks", "overnight"} and ranked:
        ex_map = _alpaca_symbol_exchange_map()
        if ex_map:
            for row in ranked:
                if not isinstance(row, dict):
                    continue
                if row.get("exchange"):
                    continue
                sym = str(row.get("symbol") or "").upper().strip()
                ex = ex_map.get(sym)
                if ex:
                    row["exchange"] = ex

    broker_positions = {}
    if tag in {"stocks", "overnight"}:
        broker_positions = _alpaca_positions_snapshot()
        if broker_positions:
            if isinstance(pos, dict) and pos.get("symbol"):
                bp = broker_positions.get(_norm_symbol(pos.get("symbol")))
                if bp:
                    pos = {**pos, **bp}
            if isinstance(s.get("positions"), dict) and s.get("positions"):
                merged_positions = []
                for p in s.get("positions").values():
                    if not isinstance(p, dict):
                        continue
                    bp = broker_positions.get(_norm_symbol(p.get("symbol")))
                    merged_positions.append({**p, **bp} if bp else p)
            else:
                merged_positions = []
        else:
            merged_positions = list((s.get("positions") or {}).values()) if isinstance(s.get("positions"), dict) else []
    else:
        merged_positions = list((s.get("positions") or {}).values()) if isinstance(s.get("positions"), dict) else []

    unrealized_pnl = 0.0
    total_pnl = state_daily_pnl
    if tag in {"stocks", "overnight"} and broker_positions:
        if isinstance(pos, dict):
            unrealized_pnl = float(pos.get("unrealized_pnl") or 0.0)
        if merged_positions:
            unrealized_pnl = sum(float(p.get("unrealized_pnl") or 0.0) for p in merged_positions)
        total_pnl = state_daily_pnl + unrealized_pnl

    return {
        "ok": True,
        "tag": tag,
        "day": s.get("day"),
        "daily_pnl": s.get("daily_pnl", 0.0),
        "unrealized_pnl": unrealized_pnl,
        "total_pnl": total_pnl,
        "trades_today": s.get("trades_today", 0),
        "paper_balance": s.get("paper_balance", 0.0),
        "position": pos,
        "active_symbol": s.get("active_symbol"),
        "last_px": s.get("last_px"),
        "watched_symbols": watched[:40],
        "watched_ranked": ranked[:40],
        "morning_scan_symbols": s.get("morning_scan_symbols", [])[:40],
        "morning_scan_ranked": s.get("morning_scan_ranked", [])[:40],
        "watchlist_updated_at": s.get("watchlist_updated_at", 0),
        "runner_pending": s.get("runner_pending", {}),
        "runner_flagged_symbols": s.get("runner_flagged_symbols", []),
        "runner_scan_ts": s.get("runner_scan_ts", 0),
        "intraday_rescan_ts": s.get("intraday_rescan_ts", 0),
        "ai_calls_today": ai_calls_today,
        "non_api_decisions_today": non_api_decisions_today,
        "policy_cache_hits_today": s.get("policy_cache_hits_today", 0),
        "api_calls_by_provider_today": s.get("api_calls_by_provider_today", {}),
        "api_calls_by_endpoint_today": s.get("api_calls_by_endpoint_today", {}),
        "skip_reasons_today": s.get("skip_reasons_today", {}),
        "decision_mode_today": decision_mode,
        "state_daily_pnl": state_daily_pnl,
        "state_trades_today": state_trades_today,
        "positions": merged_positions,
        "journal_today_realized_pnl": journal["today_realized_pnl"],
        "journal_today_closed_trades": journal["today_closed_trades"],
        "journal_today_opened_trades": journal["today_opened_trades"],
        "journal_all_time_realized_pnl": journal["all_time_realized_pnl"],
        "journal_all_time_closed_trades": journal["all_time_closed_trades"],
        "journal_all_time_opened_trades": journal["all_time_opened_trades"],
        "latest_trade": journal["latest_trade"],
        "last_close": journal["last_close"],
        "last_open": journal["last_open"],
        "performance": {
            "all_time_closed_trades": journal["all_time_closed_trades"],
            "all_time_realized_pnl": journal["all_time_realized_pnl"],
            "all_time_win_rate": journal.get("all_time_win_rate", 0.0),
            "today_closed_trades": journal["today_closed_trades"],
            "today_opened_trades": journal["today_opened_trades"],
            "today_realized_pnl": journal["today_realized_pnl"],
            "today_win_rate": journal.get("today_win_rate", 0.0),
            "last_close": journal["last_close"],
        },
        "summary_sync_warning": summary_sync_warning,
    }


def _tail_jsonl(path, max_lines=1000):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            block = 65536
            data = b""
            while size > 0 and data.count(b"\n") <= (max_lines + 5):
                read = block if size >= block else size
                size -= read
                f.seek(size)
                data = f.read(read) + data
            txt = data.decode("utf-8", errors="ignore")
            lines = [ln for ln in txt.splitlines() if ln.strip()]
            tail = lines[-max_lines:]
    except Exception:
        return []
    out = []
    for ln in tail:
        try:
            out.append(json.loads(ln))
        except Exception:
            continue
    return out


def _journal_trade_summary(tag):
    path = os.path.join(ROOT, f"journal.{tag}.jsonl")
    if not os.path.exists(path):
        return _default_trade_summary()
    try:
        st = os.stat(path)
    except Exception:
        return _default_trade_summary()

    today_et = _today_et()
    cache_key = (st.st_mtime_ns, st.st_size, today_et)
    cached = _JOURNAL_TRADE_CACHE.get(tag)
    if cached and cached.get("cache_key") == cache_key:
        return cached["value"]

    summary = _default_trade_summary()
    latest_trade_ts = -1.0
    last_close_ts = -1.0
    last_open_ts = -1.0

    try:
        with open(path, "r", errors="ignore") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    row = json.loads(ln)
                except Exception:
                    continue

                typ = row.get("type")
                if typ == "ai_decision" and _event_day_et(row.get("ts")) == today_et:
                    summary["today_ai_decisions"] += 1

                if typ not in {"trade_open", "trade_close", "fill", "execution"}:
                    continue

                ev = _normalize_trade_event(row, tag)
                dt = _parse_event_ts(ev.get("timestamp_et"))
                if dt is None or not ev.get("symbol"):
                    continue

                ts = dt.timestamp()
                day_et = dt.astimezone(ET_TZ).date().isoformat()

                if ts >= latest_trade_ts:
                    latest_trade_ts = ts
                    summary["latest_trade"] = ev

                if typ == "trade_open":
                    summary["all_time_opened_trades"] += 1
                    if day_et == today_et:
                        summary["today_opened_trades"] += 1
                    if ts >= last_open_ts:
                        last_open_ts = ts
                        summary["last_open"] = ev

                if typ == "trade_close":
                    pnl = float(row.get("pnl") or 0.0)
                    summary["all_time_closed_trades"] += 1
                    summary["all_time_realized_pnl"] += pnl
                    if pnl > 0:
                        summary["all_time_wins"] += 1
                    elif pnl < 0:
                        summary["all_time_losses"] += 1
                    if day_et == today_et:
                        summary["today_closed_trades"] += 1
                        summary["today_realized_pnl"] += pnl
                        if pnl > 0:
                            summary["today_wins"] += 1
                        elif pnl < 0:
                            summary["today_losses"] += 1
                    if ts >= last_close_ts:
                        last_close_ts = ts
                        summary["last_close"] = ev
    except Exception:
        return _default_trade_summary()

    summary["today_trade_events"] = summary["today_opened_trades"] + summary["today_closed_trades"]
    summary["all_time_win_rate"] = (
        (summary["all_time_wins"] / summary["all_time_closed_trades"]) * 100.0
        if summary["all_time_closed_trades"]
        else 0.0
    )
    summary["today_win_rate"] = (
        (summary["today_wins"] / summary["today_closed_trades"]) * 100.0
        if summary["today_closed_trades"]
        else 0.0
    )
    _JOURNAL_TRADE_CACHE[tag] = {"cache_key": cache_key, "value": summary}
    return summary


def _normalize_trade_event(row, asset_class):
    ts = row.get("ts") or row.get("timestamp") or row.get("filled_at")
    symbol = row.get("symbol") or row.get("target_symbol")
    side = (
        row.get("side")
        or (row.get("entry") or {}).get("side")
        or (row.get("fill") or {}).get("side")
        or (row.get("position") or {}).get("side")
    )
    qty = (
        row.get("qty")
        or row.get("size")
        or row.get("filled_qty")
        or (row.get("entry") or {}).get("qty")
    )
    price = (
        row.get("px")
        or row.get("price")
        or row.get("fill_price")
        or row.get("avg_price")
        or (row.get("entry") or {}).get("px")
    )
    strategy_id = row.get("strategy_id") or row.get("setup_type") or row.get("setup")

    if row.get("type") == "trade_close":
        status = "filled"
    elif row.get("type") == "trade_open":
        status = "opened"
    elif row.get("type") in {"fill", "execution"}:
        status = "filled"
    else:
        status = row.get("status") or "unknown"

    return {
        "timestamp_et": ts,
        "asset_class": asset_class,
        "symbol": symbol,
        "side": (str(side).upper() if side is not None else None),
        "qty": qty,
        "price": price,
        "status": status,
        "strategy_id": strategy_id,
        "pnl_delta": row.get("pnl") if row.get("pnl") is not None else row.get("pnl_delta"),
    }


def _alpaca_asset_class_from_time(ts):
    if ts is None:
        return "stocks"
    try:
        dt = ts.astimezone(ET_TZ)
        hm = dt.hour * 60 + dt.minute
        # Overnight bot window: late afternoon through the next morning exit.
        if hm >= 15 * 60 or hm < 9 * 60 + 35:
            return "overnight"
    except Exception:
        pass
    return "stocks"


def _alpaca_order_events(limit=1000, hours=24):
    ak = os.getenv("ALPACA_API_KEY", "").strip()
    asec = os.getenv("ALPACA_API_SECRET", "").strip()
    if not ak or not asec:
        return {"ok": False, "events": [], "error": "missing alpaca credentials"}

    abase = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/")
    try:
        req = Request(
            f"{abase}/v2/orders?status=all&limit={int(limit)}&direction=desc",
            headers={"APCA-API-KEY-ID": ak, "APCA-API-SECRET-KEY": asec},
        )
        with urlopen(req, timeout=10) as r:
            obj = json.loads(r.read().decode("utf-8"))
        rows = obj.get("orders") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            rows = []
    except Exception as e:
        return {"ok": False, "events": [], "error": f"{e.__class__.__name__}: {e}"}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    out = []
    for row in rows:
        try:
            ts_raw = row.get("filled_at") or row.get("submitted_at") or row.get("created_at")
            dt = _parse_event_ts(ts_raw)
            if dt is None or dt < cutoff:
                continue
            status = str(row.get("status") or "unknown").lower()
            # Keep only actual broker actions, not stale open orders.
            if status not in {"filled", "partially_filled", "accepted", "new"}:
                continue
            sym = _norm_symbol(row.get("symbol"))
            if not sym:
                continue
            qty = row.get("filled_qty") or row.get("qty") or row.get("notional")
            price = (
                row.get("filled_avg_price")
                or row.get("avg_price")
                or row.get("limit_price")
                or row.get("stop_price")
            )
            out.append({
                "timestamp_et": ts_raw,
                "asset_class": _alpaca_asset_class_from_time(dt),
                "symbol": sym,
                "side": str(row.get("side") or "").upper() or None,
                "qty": qty,
                "price": price,
                "status": status,
                "strategy_id": row.get("client_order_id") or row.get("order_type") or "alpaca",
                "pnl_delta": None,
                "source": "alpaca",
            })
        except Exception:
            continue
    return {"ok": True, "events": out, "error": None, "count": len(out)}


def _latest_trade_events(limit=50, hours=24):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    tags = BOT_TAGS
    diag = {
        "received": {t: 0 for t in tags},
        "rendered": {t: 0 for t in tags},
        "dropped": {t: 0 for t in tags},
        "drop_reasons": {},
        "sources": {"journal": 0, "alpaca": 0},
        "source_status": {"alpaca": "unavailable"},
    }

    merged = []
    alpaca_feed = _alpaca_order_events(limit=1000, hours=hours)
    alpaca_rows = alpaca_feed.get("events", []) if isinstance(alpaca_feed, dict) else []
    alpaca_active = bool(alpaca_feed.get("ok")) if isinstance(alpaca_feed, dict) else False
    diag["source_status"]["alpaca"] = "ok" if alpaca_active else str((alpaca_feed or {}).get("error") or "unavailable")
    for ev in alpaca_rows:
        diag["sources"]["alpaca"] += 1
        ev["_sort_ts"] = _parse_event_ts(ev.get("timestamp_et")).timestamp() if _parse_event_ts(ev.get("timestamp_et")) else 0
        merged.append(ev)
        diag["rendered"][ev.get("asset_class", "stocks")] = diag["rendered"].get(ev.get("asset_class", "stocks"), 0) + 1

    for tag in tags:
        if alpaca_active and tag in {"stocks", "overnight"}:
            continue
        rows = _tail_jsonl(os.path.join(ROOT, BOT_JOURNAL_BY_TAG[tag]), max_lines=3000)
        for row in rows:
            typ = row.get("type")
            if typ not in {"trade_open", "trade_close", "fill", "execution"}:
                continue
            diag["received"][tag] += 1
            ev = _normalize_trade_event(row, tag)
            ev["source"] = "journal"
            ts = ev.get("timestamp_et")
            if not ts:
                diag["dropped"][tag] += 1
                diag["drop_reasons"]["missing_timestamp"] = diag["drop_reasons"].get("missing_timestamp", 0) + 1
                continue
            try:
                d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                if d.tzinfo is None:
                    d = d.replace(tzinfo=timezone.utc)
            except Exception:
                diag["dropped"][tag] += 1
                diag["drop_reasons"]["bad_timestamp"] = diag["drop_reasons"].get("bad_timestamp", 0) + 1
                continue
            if d < cutoff:
                diag["dropped"][tag] += 1
                diag["drop_reasons"]["outside_24h"] = diag["drop_reasons"].get("outside_24h", 0) + 1
                continue
            if not ev.get("symbol"):
                diag["dropped"][tag] += 1
                diag["drop_reasons"]["missing_symbol"] = diag["drop_reasons"].get("missing_symbol", 0) + 1
                continue
            ev["_sort_ts"] = d.timestamp()
            merged.append(ev)
            diag["rendered"][tag] += 1
            diag["sources"]["journal"] += 1

    merged.sort(key=lambda x: x.get("_sort_ts", 0), reverse=True)
    for ev in merged:
        ev.pop("_sort_ts", None)
    return {"ok": True, "events": merged[:limit], "diagnostics": diag, "window_hours": hours, "limit": limit}


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urlparse(path).path
        rel = path.lstrip("/")
        if rel == "":
            rel = "ui/index.html"
        return os.path.join(ROOT, rel)

    def _json(self, code, obj):
        b = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-UI-PIN")
        self.end_headers()

    def _read_json_body(self):
        try:
            n = int(self.headers.get("Content-Length", "0") or "0")
        except Exception:
            n = 0
        if n <= 0:
            return {}
        try:
            raw = self.rfile.read(n)
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _check_pin(self, body):
        required = get_ui_action_pin()
        if not required:
            return True
        provided = ""
        try:
            provided = (self.headers.get("X-UI-PIN") or "").strip()
        except Exception:
            provided = ""
        if not provided and isinstance(body, dict):
            provided = str(body.get("pin", "")).strip()
        return provided == required

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/balances":
            return self._json(200, get_api_balances())
        if path == "/api/status":
            return self._json(200, bot_status())
        if path == "/api/kill-switches":
            return self._json(200, {"ok": True, "kill_switches": _kill_switch_state()})
        if path == "/api/logs":
            return self._json(200, get_logs_snapshot())
        if path.startswith("/api/state/"):
            tag = path.rsplit("/", 1)[-1]
            obj = _state_summary(tag)
            return self._json(200 if obj.get("ok") else 404, obj)
        if path.startswith("/api/journal-tail/"):
            tag = path.rsplit("/", 1)[-1]
            if tag not in BOT_TAGS:
                return self._json(404, {"ok": False, "error": "invalid tag"})
            try:
                qs = {}
                for kv in (parsed.query or "").split("&"):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        qs[k] = v
                n = int(qs.get("n", "120"))
            except Exception:
                n = 120
            n = max(20, min(1500, n))
            rows = _tail_jsonl(os.path.join(ROOT, BOT_JOURNAL_BY_TAG[tag]), max_lines=n)
            return self._json(200, {"ok": True, "tag": tag, "rows": rows})
        if path == "/api/latest-trade-events":
            try:
                qs = {}
                for kv in (parsed.query or "").split("&"):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        qs[k] = v
                n = int(qs.get("limit", "50"))
                h = int(qs.get("hours", "24"))
            except Exception:
                n, h = 50, 24
            n = max(1, min(5000, n))
            h = max(1, min(720, h))
            return self._json(200, _latest_trade_events(limit=n, hours=h))
        if path == "/api/pending-orders":
            try:
                qs = {}
                for kv in (parsed.query or "").split("&"):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        qs[k] = v
                n = int(qs.get("limit", "200"))
            except Exception:
                n = 200
            n = max(1, min(500, n))
            obj = _alpaca_pending_orders(limit=n)
            return self._json(200 if obj.get("ok") else 502, obj)
        if path == "/api/stock-news":
            try:
                qs = parse_qs(parsed.query or "")
                raw_symbols = str((qs.get("symbols") or [""])[0]).strip()
                limit = int((qs.get("limit") or ["3"])[0])
                symbols = [s.strip() for s in raw_symbols.split(",") if s.strip()]
            except Exception:
                symbols, limit = [], 3
            limit = max(1, min(5, limit))
            obj = _alpaca_news_for_symbols(symbols, limit_per_symbol=limit)
            return self._json(200 if obj.get("ok") else 502, obj)
        if path == "/api/missed-runner-audit":
            try:
                qs = {}
                for kv in (parsed.query or "").split("&"):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        qs[k] = v
                asset = str(qs.get("asset", "stocks")).strip().lower()
                h = int(qs.get("hours", "24"))
                raw_symbols = str(qs.get("symbols", "")).strip()
                symbols = [s.strip() for s in raw_symbols.split(",") if s.strip()]
            except Exception:
                asset, h, symbols = "stocks", 24, []
            h = max(1, min(720, h))
            obj = _missed_runner_audit(tag=asset, hours=h, symbols=symbols)
            return self._json(200 if obj.get("ok") else 400, obj)
        if path == "/api/break-watchers":
            try:
                qs = {}
                for kv in (parsed.query or "").split("&"):
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        qs[k] = v
                asset = str(qs.get("asset", "stocks")).strip().lower()
            except Exception:
                asset = "stocks"
            obj = _get_break_watchers(tag=asset)
            return self._json(200, obj)
        if path == "/lite" or path == "/lite/":
            body = render_lite_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/pin-check":
            if not self._check_pin(body):
                return self._json(403, {"ok": False, "error": "pin required"})
            return self._json(200, {"ok": True})

        if not self._check_pin(body):
            return self._json(403, {"ok": False, "error": "pin required"})

        if path == "/api/start":
            return self._json(200, run_script("start_universe.sh"))
        if path == "/api/stop":
            return self._json(200, run_script("stop_universe.sh"))
        if path == "/api/close":
            return self._json(200, run_script("close_universe_positions.sh"))
        # /api/kill-switch/<tag>/<on|off|toggle>
        parts = [p for p in path.split("/") if p]
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "kill-switch":
            tag, mode = parts[2], parts[3]
            return self._json(200, _set_kill_switch(tag, mode))
        # /api/bot/<tag>/buy/<multiplier>
        if len(parts) == 5 and parts[0] == "api" and parts[1] == "bot" and parts[3] == "buy":
            tag, mult = parts[2], parts[4]
            qs = parse_qs(parsed.query or "")
            _sym = None
            try:
                _sym = (qs.get("symbol") or [None])[0]
            except Exception:
                _sym = None
            if not _sym:
                try:
                    _sym = (body or {}).get("symbol")
                except Exception:
                    _sym = None
            if _sym is not None:
                try:
                    _sym = unquote(_sym)
                except Exception:
                    pass
            if tag in {"stocks", "overnight"} and _sym:
                try:
                    return self._json(200, _alpaca_manual_buy(_sym, mult))
                except Exception as e:
                    return self._json(200, {"ok": False, "error": str(e)})
            return self._json(200, _queue_buy_now(tag, mult, symbol=_sym))
        # /api/bot/<tag>/<start|stop|close>
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "bot":
            tag, action = parts[2], parts[3]
            return self._json(200, bot_action(tag, action))
        return self._json(404, {"ok": False, "error": "not found"})


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    load_env_file(os.path.join(ROOT, ".env"))
    os.chdir(ROOT)
    bind_host = os.getenv("UI_BIND_HOST", "127.0.0.1")
    srv = ThreadingHTTPServer((bind_host, port), Handler)
    print(f"UI server on http://{bind_host}:{port}")
    srv.serve_forever()
