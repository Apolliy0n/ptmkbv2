import json, logging, math
from pathlib import Path
from typing import Optional

log = logging.getLogger("ptm_propensity")
HALF = 10  # 21-residue window
KEYS = [f"+{i}" if i > 0 else str(i) for i in range(-HALF, HALF + 1)]  # "-10".."0","+1".."+10"


def _trim(vec: list) -> list:
    """Longest symmetric run around the centre with no missing values (None)."""
    c = len(vec) // 2
    l = r = 0
    while c - l - 1 >= 0 and vec[c - l - 1] is not None:
        l += 1
    while c + r + 1 < len(vec) and vec[c + r + 1] is not None:
        r += 1
    h = min(l, r)
    return vec[c - h: c + h + 1]


def log_sum(vec: list):
    return "-INF" if any(v is None for v in vec) else round(sum(vec), 3)


def log_log_product(vec: list):
    v = _trim(vec)
    if len(v) < 13:
        return "NIL"
    c = len(v) // 2
    others = [x for i, x in enumerate(v) if i != c]
    if any(x == 0 for x in others):
        return "NIL"
    # same as log(abs(1 / (-1 * prod(others)))) in the original, but stable for long products
    return round(-sum(math.log(abs(x)) for x in others), 3)


class PropensityTables:
    def __init__(self):
        self.t: dict[str, dict[str, list]] = {}  # ptm -> aa -> [ {aa: logodds} x 21 ]

    def load(self, root: str) -> int:
        n = 0
        for f in Path(root).glob("*/*/log-e.json"):
            d = json.loads(f.read_text())
            self.t.setdefault(f.parent.parent.name, {})[f.parent.name] = [d.get(k) or {} for k in KEYS]
            n += 1
        log.info("Loaded %d propensity tables (%d PTMs)", n, len(self.t))
        return n

    def score(self, ptm: str, window: str):
        tab = self.t.get(ptm, {}).get(window[HALF])
        if tab is None:
            return None
        vec = [tab[i].get(ch) for i, ch in enumerate(window)]
        return {"logSum": log_sum(vec), "logLogProduct": log_log_product(vec)}

    def for_residue(self, seq: str, pos: int, only: Optional[set] = None) -> dict:
        w = (("-" * HALF) + seq + ("-" * HALF))[pos - 1: pos + 2 * HALF]
        out = {}
        for ptm, aas in self.t.items():
            if (only and ptm not in only) or w[HALF] not in aas:
                continue
            out[ptm] = self.score(ptm, w)
        return out