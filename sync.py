"""Sync the tab to the music by listening: two levels, like audio-to-score research (Mueller et al.).

1. Close: which notes sound (chroma) in the last ~20 s of what MasterPrac hears vs the tab's note fingerprint,
   tried at every shift from -10 s to +10 s (and in all 12 keys, for capo / transposed recordings), 0.1 s steps.
2. Precise: when notes START (spectral flux of the sound) vs every attack in the tab (drums, bass, guitars),
   tried at every shift within 0.4 s of step 1, 10 ms steps.

Result: offset in seconds so that  tab time = player position + offset  (the player's position at the moment the
sound left it; the page adds the speakers' delay on top).
"""
import numpy as np

import listen

HOP, WIN = 512, 2048


def _features(x, rate):
    """Per frame (~12 ms): spectral flux (how much the sound just got louder, in any pitch) and 12 note strengths."""
    n = 1 + (len(x) - WIN) // HOP
    if n < 50:
        return None
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(WIN).astype(np.float32)
    spec = np.abs(np.fft.rfft(frames, axis=1))
    f = np.fft.rfftfreq(WIN, 1 / rate)
    logs = np.log1p(100 * spec[:, (f >= 30) & (f <= 8000)])
    flux = np.maximum(0, np.diff(logs, axis=0, prepend=logs[:1])).sum(axis=1)
    flux = flux - np.convolve(flux, np.ones(25) / 25, mode="same")  # minus the local average: just the jumps
    flux = np.maximum(0, flux)
    return flux


LONGWIN = 16384  # ~0.37 s: long enough to tell low notes apart (a 0.05 s slice can't)


def _chroma_blocks(x, rate, hop_s=0.1):
    """12 note strengths every 0.1 s, each from a 0.37 s slice of sound. Returns (centre sample index, chroma)."""
    hop = int(rate * hop_s)
    n = 1 + (len(x) - LONGWIN) // hop
    if n < 20:
        return None, None
    idx = np.arange(LONGWIN)[None, :] + hop * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(LONGWIN).astype(np.float32), axis=1))
    f = np.fft.rfftfreq(LONGWIN, 1 / rate)
    band = (f >= 70) & (f <= 2000)
    pc = np.round(12 * np.log2(np.maximum(f[band], 1) / 440.0) + 69).astype(int) % 12
    sb = spec[:, band] ** 2
    chroma = np.stack([sb[:, pc == k].sum(axis=1) for k in range(12)], axis=1)
    return np.arange(n) * hop + LONGWIN / 2, chroma


def _unit(m):
    nrm = np.linalg.norm(m, axis=-1, keepdims=True)
    return np.divide(m, nrm, out=np.zeros_like(m), where=nrm > 0)


def solve(tab, pos_at, seconds=20):
    """tab: tabs.load() output. pos_at(clock time) -> the player's position then. Returns a dict or None."""
    x, t_end, rate = listen.recent(seconds)
    if len(x) < rate * min(3, seconds) or float(np.sqrt(np.mean(x ** 2))) < 0.003:  # a first answer after 3 s, better as it hears more
        return None
    flux = _features(x, rate)
    centres, chroma = _chroma_blocks(x, rate)
    if flux is None or chroma is None:
        return None
    n = len(flux)
    to_pos = lambda sample_idx: np.array([pos_at(t_end - (len(x) - i) / rate) for i in np.atleast_1d(sample_idx)])
    pos = to_pos(np.arange(n) * HOP + WIN / 2)  # player position when each frame's sound left the player

    # ---- 1. close: notes ----
    pr = np.array(tab["print"], dtype=float)
    step = tab["print_step"]
    bpos = to_pos(centres)
    loud = np.linalg.norm(chroma, axis=1) > 1e-6
    heard = _unit(chroma)

    def scan(shift):
        prs = _unit(np.roll(pr, shift, axis=1))
        out = []
        for o in np.arange(-10, 10.001, 0.1):
            k = np.round((bpos + o) / step).astype(int)
            ok = loud & (k >= 0) & (k < len(prs))
            ok[ok] &= prs[k[ok]].sum(axis=1) > 0
            out.append((float((heard[ok] * prs[k[ok]]).sum(axis=1).mean()) if ok.sum() >= len(bpos) * 0.5 else -1, float(o)))
        return out
    s0 = scan(0)
    note_score, coarse = max(s0)
    shift = 0
    if note_score < 0.5:  # poor match in the tab's key: is the recording in another key (capo / transposed)?
        for sh in range(1, 12):
            sc, o = max(scan(sh))
            if sc > note_score + 0.08:
                note_score, coarse, shift = sc, o, sh
    valid = [v for v, _ in s0 if v >= 0]
    if not valid:
        return None
    note_conf = note_score - float(np.median(valid))

    # ---- 2. precise: attacks ----
    att = np.array(tab.get("attacks") or [], dtype=float)
    fine, att_conf = coarse, 0.0
    if len(att):
        fl = (flux - flux.mean()) / (flux.std() + 1e-9)
        sigma = 0.025
        # within 0.25 s of the note match: wider and it can snap to the neighbouring beat
        offs = np.arange(coarse - 0.25, coarse + 0.2501, 0.01)
        res = []
        for o in offs:
            t = pos + o
            near = att[(att[:, 0] > t[0] - 0.2) & (att[:, 0] < t[-1] + 0.2)]
            if not len(near):
                res.append(0.0)
                continue
            # the tab's attacks as soft bumps on the same frame grid as what was heard
            d = t[:, None] - near[None, :, 0]
            env = (near[None, :, 1] * np.exp(-0.5 * (d / sigma) ** 2)).sum(axis=1)
            res.append(float((fl * env).sum() / (env.sum() + 1e-9)))
        res = np.array(res)
        i = int(res.argmax())
        fine = float(offs[i])
        att_conf = float((res[i] - res.mean()) / (res.std() + 1e-9))  # how far the best stands out (z-score)
    return {"offset": round(fine, 3), "coarse": round(coarse, 2), "shift": shift, "note_score": round(note_score, 3),
            "note_conf": round(note_conf, 3), "attack_conf": round(att_conf, 2), "heard_s": round(len(x) / rate, 1)}
