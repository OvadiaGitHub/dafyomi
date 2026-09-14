#!/usr/bin/env python3
"""
Construit l'artifact Daf Yomi avec une daf préchargée.

    python3 build_daf.py                      # daf yomi du jour
    python3 build_daf.py --date 2026-09-20    # daf yomi d'une date
    python3 build_daf.py --ref "Bava Metzia 42a"

Lit daf-template.jsx (qui contient le marqueur __PRELOAD__) et écrit
daf-<ref>.jsx. Aucune dépendance hors bibliothèque standard.
"""

import argparse, collections, datetime, json, os, sys, urllib.parse, urllib.request

API = "https://www.sefaria.org/api"
TZ = "Asia/Jerusalem"
COMMENTATORS = ["Rashi", "Tosafot"]   # les seuls que le prompt demande au modèle de citer par ref


def get(path):
    with urllib.request.urlopen(API + path, timeout=90) as r:
        return json.load(r)


def q(ref):
    return urllib.parse.quote(ref)


def flat(x):
    out = []
    if isinstance(x, list):
        for i in x:
            out.extend(flat(i))
    elif x is not None and str(x).strip():
        out.append(str(x))
    elif x is not None:
        out.append("")
    return out


def daf_of_date(d):
    data = get(f"/calendars?year={d.year}&month={d.month}&day={d.day}&timezone={TZ}")
    item = next((i for i in data.get("calendar_items", []) if i.get("title", {}).get("en") == "Daf Yomi"), None)
    if not item:
        sys.exit(f"Pas de Daf Yomi au calendrier Sefaria pour le {d}.")
    return item


def fetch_text(ref, versions, fmt="strip_only_footnotes"):
    v = "&".join(f"version={x}" for x in versions)
    return get(f"/v3/texts/{q(ref)}?{v}&fill_in_missing_segments=1&return_format={fmt}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--date", help="AAAA-MM-JJ (défaut : aujourd'hui)")
    p.add_argument("--ref", help="référence Sefaria explicite, ex. « Bava Metzia 42a »")
    p.add_argument("--template", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "daf-template.jsx"))
    p.add_argument("--out", help="fichier de sortie (défaut : daf-<ref>.jsx)")
    a = p.parse_args()

    day = datetime.date.fromisoformat(a.date) if a.date else datetime.date.today()

    if a.ref:
        ref, display, he_display = a.ref, a.ref, None
    else:
        item = daf_of_date(day)
        ref = item["ref"]
        display = item.get("displayValue", {}).get("en") or ref
        he_display = item.get("displayValue", {}).get("he")

    print(f"→ {ref}")

    # ── texte de la daf ──
    t = fetch_text(ref, ["source", "english", "french"])
    if t.get("error"):
        sys.exit(f"Sefaria : {t['error']}")
    vers = {v.get("language"): v for v in t.get("versions", [])}
    he_v, en_v, fr_v = vers.get("he"), vers.get("en"), vers.get("fr")
    if not he_v:
        sys.exit(f"Aucun texte source pour « {ref} » — vérifie l'orthographe (titres anglais Sefaria).")

    # une daf entière (« Chullin 137 ») couvre deux amudim : le texte arrive
    # imbriqué et l'app l'aplatit, donc on renumérote les ancres en continu.
    amudim = t.get("spanningRefs") or [t.get("ref", ref)]
    raw = he_v["text"]
    per_amud = [len(x) for x in raw] if (t.get("isSpanning") and raw and isinstance(raw[0], list)) else [len(raw)]
    offsets, acc = {}, 0
    for name, n in zip(amudim, per_amud):
        offsets[name] = acc
        acc += n

    he, en = flat(raw), flat(en_v["text"]) if en_v else []
    fr = flat(fr_v["text"]) if fr_v else None
    if len(en) and len(en) != len(he):
        en = (en + [""] * len(he))[: len(he)]
    if fr and len(fr) != len(he):
        fr = (fr + [""] * len(he))[: len(he)]
    print(f"  {len(he)} segments ({' + '.join(map(str, per_amud))}) · français Sefaria : {'oui' if fr else 'non'}")

    # ── liens : on ne garde que le digest lu par le composant ──
    commentaries, parallels = collections.defaultdict(set), collections.defaultdict(set)
    try:
        links = get(f"/related/{q(ref)}").get("links", [])
    except Exception as e:
        links = []
        print(f"  ! liens indisponibles ({e})")
    for l in links:
        title = (l.get("collectiveTitle") or {}).get("en") or l.get("index_title") or "?"
        anchor = l.get("anchorRef") or ""
        seg = None
        for name, off in offsets.items():
            if anchor.startswith(name + ":"):
                num = anchor[len(name) + 1:].split("-")[0].split(":")[0]
                if num.isdigit():
                    seg = int(num) + off
                break
        if l.get("category") == "Commentary":
            if seg:
                commentaries[title].add(seg)
        elif l.get("category") in ("Tosefta", "Talmud", "Mishnah", "Midrash", "Halakhah"):
            parallels[l["category"]].add(l["ref"])
    related = {
        "commentaries": {k: sorted(v) for k, v in sorted(commentaries.items()) if v},
        "parallels": {k: sorted(v)[:12] for k, v in sorted(parallels.items())},
    }
    print(f"  {len(related['commentaries'])} commentateurs répertoriés, {sum(len(v) for v in related['parallels'].values())} parallèles")

    # ── textes de Rachi / Tossefot, indexés dans les deux numérotations ──
    comm_texts = {}
    for book in COMMENTATORS:
        for amud in amudim:
            cref = f"{book} on {amud}"
            try:
                d = fetch_text(cref, ["source"], fmt="text_only")
                segs = d["versions"][0]["text"]
            except Exception:
                print(f"  ! {cref} indisponible")
                continue
            n = 0
            for i, seg in enumerate(segs, start=1):
                parts = [s for s in flat(seg) if s.strip()]
                if not parts:
                    continue
                comm_texts[f"{cref}:{i}"] = parts
                comm_texts[f"{book} on {ref}:{i + offsets[amud]}"] = parts
                n += 1
            print(f"  {cref} : {n} segments commentés")

    # ── fin de la daf précédente (contexte d'entrée) ──
    prev_ref, prev_en = t.get("prev"), []
    if prev_ref:
        try:
            d = fetch_text(prev_ref, ["english"], fmt="text_only")
            prev_en = flat(d["versions"][0]["text"])[-10:]
        except Exception as e:
            print(f"  ! daf précédente indisponible ({e})")
            prev_ref = None

    preload = {
        "builtAt": datetime.date.today().isoformat(),
        "calendar": {"date": day.isoformat(), "ref": ref, "display": display, "heDisplay": he_display or t.get("heRef")},
        "text": {
            "ref": t.get("ref", ref), "heRef": t.get("heRef"),
            "indexTitle": t.get("indexTitle") or t.get("book"),
            "next": t.get("next"), "prev": t.get("prev"),
            "he": he, "en": en, "fr": fr,
            "heTitle": he_v.get("versionTitle"),
            "enTitle": en_v.get("versionTitle") if en_v else None,
            "frTitle": fr_v.get("versionTitle") if fr_v else None,
        },
        "prevText": {"ref": prev_ref, "en": prev_en},
        "related": related,
        "commentaries": comm_texts,
    }

    tpl = open(a.template, encoding="utf-8").read()
    if "__PRELOAD__" not in tpl:
        sys.exit(f"{a.template} ne contient pas le marqueur __PRELOAD__.")
    js = "const PRELOAD = " + json.dumps(preload, ensure_ascii=False, separators=(",", ":")) + ";"
    out = a.out or "daf-" + ref.lower().replace(" ", "-") + ".jsx"
    open(out, "w", encoding="utf-8").write(tpl.replace("__PRELOAD__", js))
    print(f"✓ {out} ({os.path.getsize(out) // 1024} Ko)")


if __name__ == "__main__":
    main()
