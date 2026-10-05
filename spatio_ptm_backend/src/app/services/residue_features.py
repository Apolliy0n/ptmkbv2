import asyncio, io, json, math, os, re, tempfile
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path

import aiohttp
import numpy as np
from Bio.PDB import DSSP, NeighborSearch, PDBParser, ShrakeRupley
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


CHARGE = {"K": 1, "R": 1, "D": -1, "E": -1}
SALT_ATOMS = {("LYS", "NZ"): 1, ("ARG", "NE"): 1, ("ARG", "NH1"): 1, ("ARG", "NH2"): 1,
              ("ASP", "OD1"): -1, ("ASP", "OD2"): -1, ("GLU", "OE1"): -1, ("GLU", "OE2"): -1}
GAMMA = {"SER": "OG", "THR": "OG1", "CYS": "SG", "ILE": "CG1", "VAL": "CG1"}
NO_CHI = {"ALA", "GLY", "PRO"}


def _dssp(model, chain_id: str, pdb_text: str):
    """Secondary structure per residue via mkdssp. Returns None if unavailable."""
    try:
        text = pdb_text if pdb_text.lstrip().startswith("HEADER") else "HEADER    AF\n" + pdb_text
        with tempfile.NamedTemporaryFile("w", suffix=".pdb") as f:
            f.write(text); f.flush()
            d = DSSP(model, f.name, dssp=os.getenv("MKDSSP_BIN", "mkdssp"), file_type="PDB")
        return {k[1][1]: ("C" if v[2] == "-" else v[2]) for k, v in d.property_dict.items() if k[0] == chain_id}
    except Exception:
        return None


def _rama(phi, psi, aa):
    if phi is None or psi is None:
        return None
    if aa == "G":
        return "gly"
    if -160 <= phi <= -20 and -120 <= psi <= 50:
        return "alpha"
    if phi <= -45 and (psi >= 90 or psi <= -150):
        return "beta"
    if 30 <= phi <= 100 and -30 <= psi <= 100:
        return "left"
    return "other"


def _peptide(omega):
    if omega is None:
        return None
    return "trans" if abs(omega) >= 150 else "cis" if abs(omega) <= 30 else "twisted"


def compute_features(acc: str, pdb_text: str) -> dict:
    """CPU-bound. Runs in a worker process."""
    model = PDBParser(QUIET=True).get_structure(acc, io.StringIO(pdb_text))[0]
    chain = next(iter(model))
    res = [r for r in chain if r.id[0] == " "]
    n = len(res)
    ShrakeRupley().compute(chain, level="R")
    seq = "".join(seq1(r.get_resname()) for r in res)
    whole = "".join(c for c in seq if c in AA)
    aa_at = {r.id[1]: seq[k] for k, r in enumerate(res)}
    ss = _dssp(model, chain.id, pdb_text)

    # heavy-atom contacts
    contacts = {r.id[1]: set() for r in res}
    heavy = [a for a in chain.get_atoms() if a.element != "H"]
    for ra, rb in NeighborSearch(heavy).search_all(CUTOFF, level="R"):
        i, j = ra.id[1], rb.id[1]
        if abs(i - j) >= MIN_SEP:
            contacts[i].add(j); contacts[j].add(i)

    # 3D charge environment: charged residues with C-beta within 8 A (non-local)
    pos_n = {r.id[1]: 0 for r in res}
    neg_n = {r.id[1]: 0 for r in res}
    cb = [r["CB"] if "CB" in r else r["CA"] for r in res if "CB" in r or "CA" in r]
    if len(cb) > 1:
        for a, b in NeighborSearch(cb).search_all(8.0):
            i, j = a.get_parent().id[1], b.get_parent().id[1]
            if abs(i - j) < MIN_SEP:
                continue
            for x, y in ((i, j), (j, i)):
                c = CHARGE.get(aa_at[y])
                if c == 1: pos_n[x] += 1
                elif c == -1: neg_n[x] += 1

    # salt bridges: opposite-charged side-chain groups within 4 A
    bridges = {r.id[1]: {} for r in res}
    grp = [a for r in res for a in r if (r.get_resname(), a.get_id()) in SALT_ATOMS]
    if len(grp) > 1:
        for a, b in NeighborSearch(grp).search_all(4.0):
            ra, rb = a.get_parent(), b.get_parent()
            i, j = ra.id[1], rb.id[1]
            if abs(i - j) < 2:
                continue
            if SALT_ATOMS[(ra.get_resname(), a.get_id())] == SALT_ATOMS[(rb.get_resname(), b.get_id())]:
                continue
            dist = round(float(a - b), 1)
            for x, y in ((i, j), (j, i)):
                if dist < bridges[x].get(y, 99):
                    bridges[x][y] = dist

    # disulfides: SG-SG < 2.5 A
    ss_partner = {}
    sg = [r["SG"] for r in res if r.get_resname() == "CYS" and "SG" in r]
    if len(sg) > 1:
        for a, b in NeighborSearch(sg).search_all(2.5):
            i, j = a.get_parent().id[1], b.get_parent().id[1]
            if abs(i - j) >= 2:
                ss_partner[i] = j; ss_partner[j] = i

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

        name = r.get_resname()
        chi1 = rot = None
        if name not in NO_CHI and all(x in r for x in ("N", "CA", "CB", GAMMA.get(name, "CG"))):
            chi1 = _dih(r["N"], r["CA"], r["CB"], r[GAMMA.get(name, "CG")])
            rot = "p" if 0 < chi1 < 120 else "m" if -120 <= chi1 <= 0 else "t"

        win = seq[max(0, k - WIN): k + WIN + 1]
        wc = "".join(c for c in win if c in AA)
        arom = sum(win.count(c) for c in "FWY")
        net = win.count("K") + win.count("R") - win.count("D") - win.count("E")
        gravy = round(ProteinAnalysis(wc).gravy(), 2) if wc else None
        sasa = round(float(r.sasa), 2)
        cl = sorted(contacts[p])
        out[str(p)] = {
            "aa": seq[k],
            "plddt": round(r["CA"].get_bfactor(), 1) if "CA" in r else None,
            "ss": ss.get(p) if ss else None,
            "phi": phi, "psi": psi, "omega": omega,
            "rama": _rama(phi, psi, seq[k]),
            "peptide": _peptide(omega),
            "chi1": chi1, "rotamer": rot,
            "sasa": sasa,
            "rel_sasa": round(min(sasa / MAX_ASA[name], 1.0), 3) if name in MAX_ASA else None,
            "n_contacts": len(cl), "contacts": cl,
            "env_basic": pos_n[p], "env_acidic": neg_n[p], "env_charge": pos_n[p] - neg_n[p],
            "salt_bridges": [{"pos": j, "aa": aa_at[j], "d": d} for j, d in sorted(bridges[p].items(), key=lambda t: t[1])],
            "disulfide": ss_partner.get(p),
            "window_pi": round(ProteinAnalysis(wc).isoelectric_point(), 2) if wc else None,
            "window_aromatic_count": arom,
            "window_aromaticity": round(arom / len(win), 3) if win else None,
            "window_net_charge": net,
            "window_gravy": gravy,
        }

    pa = ProteinAnalysis(whole)
    helix, turn, sheet = pa.secondary_structure_fraction()
    coil, ss_source = None, "sequence"
    if ss:
        vals = list(ss.values())
        t = len(vals)
        helix = sum(v in "HGI" for v in vals) / t
        sheet = sum(v in "EB" for v in vals) / t
        turn = sum(v in "TS" for v in vals) / t
        coil = 1 - helix - sheet - turn
        ss_source = "dssp"
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
            "coil_frac": round(coil, 3) if coil is not None else None,
            "ss_source": ss_source,
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