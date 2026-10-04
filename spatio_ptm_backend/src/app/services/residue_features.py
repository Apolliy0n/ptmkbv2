import asyncio, io, json, math, os, re
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path

import aiohttp
import numpy as np
from Bio.PDB import NeighborSearch, PDBParser, ShrakeRupley
from Bio.PDB.vectors import calc_dihedral
from Bio.SeqUtils import seq1
from Bio.SeqUtils.ProtParam import ProteinAnalysis

AF_API = "https://alphafold.ebi.ac.uk/api/prediction"
ACC_RE = re.compile(r"[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}")
AA = set("ACDEFGHIKLMNPQRSTVWY")
WIN, CUTOFF, MIN_SEP = 10, 4.5, 3
MAX_ASA = {"ALA":129,"ARG":274,"ASN":195,"ASP":193,"CYS":167,"GLN":225,"GLU":223,"GLY":104,
           "HIS":224,"ILE":197,"LEU":201,"LYS":236,"MET":224,"PHE":240,"PRO":159,"SER":155,
           "THR":172,"TRP":285,"TYR":263,"VAL":174}


class NotFound(Exception): ...
class Upstream(Exception): ...


def _dih(a, b, c, d):
    return round(math.degrees(calc_dihedral(a.get_vector(), b.get_vector(), c.get_vector(), d.get_vector())), 1)

def _linked(a, b):
    return "C" in a and "N" in b and (a["C"] - b["N"]) < 2.0


def compute_features(acc: str, pdb_text: str) -> dict:
    """CPU-bound. Runs in a worker process."""
    chain = next(iter(PDBParser(QUIET=True).get_structure(acc, io.StringIO(pdb_text))[0]))
    res = [r for r in chain if r.id[0] == " "]
    n = len(res)
    ShrakeRupley().compute(chain, level="R")
    seq = "".join(seq1(r.get_resname()) for r in res)
    whole = "".join(c for c in seq if c in AA)

    contacts = {r.id[1]: set() for r in res}
    heavy = [a for a in chain.get_atoms() if a.element != "H"]
    for ra, rb in NeighborSearch(heavy).search_all(CUTOFF, level="R"):
        i, j = ra.id[1], rb.id[1]
        if abs(i - j) >= MIN_SEP:
            contacts[i].add(j); contacts[j].add(i)

    out = {}
    for k, r in enumerate(res):
        p = r.id[1]
        prev = res[k - 1] if k else None
        nxt = res[k + 1] if k < n - 1 else None
        bb = all(x in r for x in ("N", "CA", "C"))
        phi = psi = omega = None
        if bb and prev is not None and _linked(prev, r):
            phi = _dih(prev["C"], r["N"], r["CA"], r["C"])
        if bb and nxt is not None and _linked(r, nxt) and "CA" in nxt:
            psi = _dih(r["N"], r["CA"], r["C"], nxt["N"])
            omega = _dih(r["CA"], r["C"], nxt["N"], nxt["CA"])
        win = seq[max(0, k - WIN): k + WIN + 1]
        wc = "".join(c for c in win if c in AA)
        arom = sum(win.count(c) for c in "FWY")
        sasa = round(float(r.sasa), 2)
        name = r.get_resname()
        cl = sorted(contacts[p])
        out[str(p)] = {
            "aa": seq[k],
            "plddt": round(r["CA"].get_bfactor(), 1) if "CA" in r else None,
            "phi": phi, "psi": psi, "omega": omega,
            "sasa": sasa,
            "rel_sasa": round(min(sasa / MAX_ASA[name], 1.0), 3) if name in MAX_ASA else None,
            "n_contacts": len(cl), "contacts": cl,
            "window_pi": round(ProteinAnalysis(wc).isoelectric_point(), 2) if wc else None,
            "window_aromatic_count": arom,
            "window_aromaticity": round(arom / len(win), 3) if win else None,
        }

    pa = ProteinAnalysis(whole)
    helix, turn, sheet = pa.secondary_structure_fraction()
    pl = [v["plddt"] for v in out.values() if v["plddt"] is not None]
    ca = np.array([r["CA"].coord for r in res if "CA" in r])
    rg = float(np.sqrt(((ca - ca.mean(0)) ** 2).sum(1).mean())) if len(ca) else None
    return {
        "uniprot_id": acc,
        "protein": {
            "length": n,
            "mw": round(pa.molecular_weight(), 1),
            "pi": round(pa.isoelectric_point(), 2),
            "charge_ph7": round(pa.charge_at_pH(7.0), 2),
            "aromaticity": round(pa.aromaticity(), 3),
            "gravy": round(pa.gravy(), 3),
            "instability_index": round(pa.instability_index(), 2),
            "helix_frac": round(helix, 3),
            "turn_frac": round(turn, 3),
            "sheet_frac": round(sheet, 3),
            "mean_plddt": round(sum(pl) / len(pl), 1) if pl else None,
            "frac_plddt_gt70": round(sum(v > 70 for v in pl) / len(pl), 3) if pl else None,
            "total_sasa": round(float(sum(r.sasa for r in res)), 1),
            "radius_of_gyration": round(rg, 2) if rg else None,
            "mean_contacts": round(sum(v["n_contacts"] for v in out.values()) / n, 2),
        },
        "residues": out,
    }


class ResidueFeatureService:
    def __init__(self):
        self.dir = Path(os.getenv("FEATURE_CACHE_DIR", "feature_cache"))
        self.workers = int(os.getenv("FEATURE_CPU_WORKERS", "2"))
        self.mem: dict[str, dict] = {}
        self.inflight: dict[str, asyncio.Task] = {}
        self.net = asyncio.Semaphore(8)
        self.cpu = asyncio.Semaphore(self.workers * 2)

    async def start(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60, connect=10))
        self.pool = ProcessPoolExecutor(self.workers, mp_context=get_context("spawn"))

    async def close(self):
        await self.http.close()
        self.pool.shutdown(wait=False, cancel_futures=True)

    async def get(self, acc: str) -> dict:
        acc = acc.upper()
        if not ACC_RE.fullmatch(acc):
            raise ValueError
        if acc in self.mem:
            return self.mem[acc]
        t = self.inflight.get(acc)
        if t is None:  # dedupe: N users -> 1 job
            t = self.inflight[acc] = asyncio.create_task(self._build(acc))
            t.add_done_callback(lambda x, a=acc: (self.inflight.pop(a, None), x.cancelled() or x.exception()))
        return await asyncio.shield(t)  # one disconnect must not cancel the shared job

    async def _fetch(self, url: str, js: bool):
        for i in range(3):
            try:
                async with self.net, self.http.get(url) as r:
                    if r.status == 404:
                        raise NotFound(url)
                    r.raise_for_status()
                    return await (r.json(content_type=None) if js else r.text())
            except NotFound:
                raise
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if i == 2:
                    raise Upstream(str(e)) from e
                await asyncio.sleep(0.5 * 2 ** i)

    async def _build(self, acc: str) -> dict:
        meta = await self._fetch(f"{AF_API}/{acc}", True)
        if not meta:
            raise NotFound(acc)
        entry = meta[0]
        f = self.dir / f"{acc}_v{entry.get('latestVersion', 'x')}.json"
        if f.exists():
            data = json.loads(await asyncio.to_thread(f.read_text))
        else:
            pdb = await self._fetch(entry["pdbUrl"], False)
            async with self.cpu:
                data = await asyncio.get_running_loop().run_in_executor(self.pool, compute_features, acc, pdb)
            tmp = f.with_suffix(f".{os.getpid()}.tmp")
            await asyncio.to_thread(tmp.write_text, json.dumps(data, separators=(",", ":")))
            os.replace(tmp, f)
        self.mem[acc] = data
        if len(self.mem) > 128:
            self.mem.pop(next(iter(self.mem)))
        return data