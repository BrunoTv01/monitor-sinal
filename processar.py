#!/usr/bin/env python3
"""
Monitor de Sinal TV Digital - processamento dos dados.

Lê as medições de referência (pasta dados/entrada/2018) e as medições novas
(pasta dados/entrada/2026), compara o nível de sinal (coluna NIVEL, em dBm)
e gera os arquivos JSON que o site lê (pasta web/dados).

Uso:
    python3 processar.py
    python3 processar.py --ref dados/entrada/2018 --novo dados/entrada/2026 --saida web/dados
    python3 processar.py --unificar dados/unificado_2026.csv   # também grava o CSV unificado

Formato esperado dos CSV (igual aos arquivos do medidor):
    separador ";", decimal ",", UTF-8 (com ou sem BOM), colunas
    CH;layer;freq;guard interval;NIVEL;C/N;MER;CBER;VBER;Date;Hour;LAT;LONG;SINAL
    LAT/LONG em graus e minutos decimais, ex.: -23°32.9899
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- parâmetros
LIMITE_ESTAVEL_DB = 3.0          # |variação| menor que isso = Estável
FAIXAS = {"Bom": -58.8, "Médio": -68.8, "Limítrofe": -76.8}   # abaixo = Sem sinal
GRADE_AREA = 0.005               # ~550 m
GRADE_REGIAO = 0.02              # ~2 km
MIN_AREA = (2, 30)               # medições mínimas (referência, novo) por canal na área
MIN_REGIAO = (8, 200)
ARREDONDA_TRILHA = 0.00035       # ~35 m, pontos de trajeto para desenhar as ruas

BASE = os.path.dirname(os.path.abspath(__file__))
COLS = ["CH", "NIVEL", "C/N", "Date", "LAT", "LONG"]


def ler_pasta(pasta):
    arquivos = sorted(glob.glob(os.path.join(pasta, "*.csv")))
    if not arquivos:
        sys.exit(f"Nenhum CSV encontrado em {pasta}")
    partes = []
    for f in arquivos:
        d = pd.read_csv(f, sep=";", decimal=",", encoding="utf-8-sig", usecols=lambda c: c in COLS, low_memory=False)
        d["arquivo"] = os.path.basename(f)
        partes.append(d)
        print(f"  {os.path.basename(f)}: {len(d):,} linhas")
    return pd.concat(partes, ignore_index=True), arquivos


def r1(x):
    """Arredonda para 1 casa, com o meio indo para longe do zero (-63,15 -> -63,2)."""
    return float(Decimal(repr(float(x))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def coord(s):
    d = s.astype(str).str.strip().str.extract(r"(-?\d+)°([\d.]+)").astype(float)
    return np.sign(d[0]) * (d[0].abs() + d[1] / 60)


def classe(v):
    v = np.asarray(v, dtype=float)
    return np.select([v >= FAIXAS["Bom"], v >= FAIXAS["Médio"], v >= FAIXAS["Limítrofe"]],
                     ["Bom", "Médio", "Limítrofe"], "Sem sinal")


def situacao(d):
    d = np.asarray(d, dtype=float)
    return np.select([d >= LIMITE_ESTAVEL_DB, d <= -LIMITE_ESTAVEL_DB], ["Melhorou", "Piorou"], "Estável")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default=os.path.join(BASE, "dados/entrada/2018"), help="pasta com os CSV de referência")
    ap.add_argument("--novo", default=os.path.join(BASE, "dados/entrada/2026"), help="pasta com os CSV novos")
    ap.add_argument("--saida", default=os.path.join(BASE, "web/dados"), help="pasta de saída do site")
    ap.add_argument("--refs", default=os.path.join(BASE, "dados/referencias.csv"), help="bairros de referência")
    ap.add_argument("--unificar", help="grava também todos os CSV novos num único arquivo")
    ap.add_argument("--rotulo-ref", default="2018", help="nome da campanha de referência")
    ap.add_argument("--rotulo-novo", default="2026", help="nome da campanha nova")
    a = ap.parse_args()
    os.makedirs(a.saida, exist_ok=True)

    print("Lendo referência:"); ref, _ = ler_pasta(a.ref)
    print("Lendo medições novas:"); novo, arq_novo = ler_pasta(a.novo)

    if a.unificar:
        print(f"Gravando CSV unificado em {a.unificar} ...")
        with open(a.unificar, "w", encoding="utf-8-sig", newline="") as out:
            primeiro = True
            for f in arq_novo:
                with open(f, encoding="utf-8-sig") as fin:
                    linhas = fin.read().splitlines()
                out.write("\r\n".join(linhas if primeiro else linhas[1:]) + "\r\n")
                primeiro = False

    ref["ano"], novo["ano"] = 0, 1
    df = pd.concat([ref, novo], ignore_index=True)
    df["NIVEL"] = pd.to_numeric(df["NIVEL"], errors="coerce")
    df["lat"], df["lon"] = coord(df["LAT"]), coord(df["LONG"])
    df = df.dropna(subset=["lat", "lon", "NIVEL"])
    df = df[df["NIVEL"] < 0]                      # nível 0 = leitura inválida
    trilhas_src = df[["lat", "lon"]]

    comuns = sorted(set(df[df.ano == 0].CH) & set(df[df.ano == 1].CH))
    so_novo = sorted(set(df[df.ano == 1].CH) - set(comuns))
    print(f"Canais comparados: {', '.join(comuns)}  |  só na campanha nova: {', '.join(so_novo) or '-'}")
    c = df[df.CH.isin(comuns)].copy()
    c["cls"] = classe(c.NIVEL)
    R0, R1 = a.rotulo_ref, a.rotulo_novo

    # ------------------------------------------------ por canal
    canais = []
    for ch in comuns:
        r = {"canal": ch}
        for y, lab in ((0, "ref"), (1, "novo")):
            s = c[(c.CH == ch) & (c.ano == y)]
            r[f"amostras_{lab}"] = int(len(s))
            r[f"mediana_{lab}"] = r1(s.NIVEL.median())
            for k, n in (("Bom", "bom"), ("Sem sinal", "sem_sinal")):
                r[f"pct_{n}_{lab}"] = round(float((s.cls == k).mean()), 4)
        r["variacao_db"] = r1(r["mediana_novo"] - r["mediana_ref"])
        canais.append(r)

    cl = pd.crosstab([c.CH, c.ano], c.cls, normalize="index").reset_index().melt(id_vars=["CH", "ano"], var_name="classe", value_name="pct")
    classes = [{"canal": r.CH, "campanha": R0 if r.ano == 0 else R1, "classe": r.classe, "pct": round(float(r.pct), 4)} for r in cl.itertuples()]

    # ------------------------------------------------ grades
    refs = pd.read_csv(a.refs)

    def perto(lat, lon):
        d = np.hypot((refs.lat.values - lat) * 111, (refs.lon.values - lon) * 102)
        i = int(d.argmin())
        return refs.local.iloc[i]

    def grade(G, mins):
        s = c.assign(gy=np.floor(c.lat / G).astype(int), gx=np.floor(c.lon / G).astype(int))
        g = s.groupby(["CH", "gy", "gx", "ano"]).NIVEL.agg(["median", "count"]).unstack("ano")
        g.columns = [f"{x}{y}" for x, y in g.columns]
        g = g[(g.count0 >= mins[0]) & (g.count1 >= mins[1])].copy()
        g["d"] = g.median1 - g.median0
        g = g.reset_index()
        media = g.groupby(["gy", "gx"]).agg(d=("d", "mean"), canais=("CH", lambda x: " ".join(sorted(x))),
                                             count0=("count0", "sum"), count1=("count1", "sum"),
                                             median0=("median0", "mean"), median1=("median1", "mean")).reset_index()
        media["CH"] = "Todos"
        g["canais"] = g.CH
        t = pd.concat([media, g[media.columns]], ignore_index=True)
        t["lat"] = ((t.gy + .5) * G).round(4)
        t["lon"] = ((t.gx + .5) * G).round(4)
        t["regiao"] = [perto(x, y) for x, y in zip(t.lat, t.lon)]
        t["variacao_db"] = t.d.round(1)
        t["nivel_ref"] = t.median0.round(1)
        t["nivel_novo"] = t.median1.round(1)
        t["situacao"] = situacao(t.variacao_db)
        t["classe_ref"] = classe(t.nivel_ref)
        t["classe_novo"] = classe(t.nivel_novo)
        t["id"] = t.CH + "_" + t.gy.astype(str) + "_" + t.gx.astype(str)
        t = t.rename(columns={"CH": "canal", "count0": "amostras_ref", "count1": "amostras_novo"})
        return t[["id", "canal", "regiao", "situacao", "variacao_db", "nivel_ref", "nivel_novo", "classe_ref", "classe_novo",
                  "canais", "amostras_ref", "amostras_novo", "lat", "lon"]]

    areas = grade(GRADE_AREA, MIN_AREA)
    regs = grade(GRADE_REGIAO, MIN_REGIAO)
    regs = regs[regs.canal == "Todos"].copy()
    dup = regs.regiao.duplicated(keep=False)
    regs["regiao_unica"] = regs.regiao
    regs.loc[dup, "regiao_unica"] = [f"{r.regiao} ({r.lat:.2f}, {r.lon:.2f})" for r in regs[dup].itertuples()]
    regs = regs.sort_values("variacao_db", ascending=False)

    at = areas[areas.canal == "Todos"]
    resumo = {
        "campanha_ref": R0, "campanha_novo": R1,
        "canais_comparados": comuns, "canais_so_novo": so_novo,
        "regioes_comparadas": int(len(regs)),
        "regioes_melhoraram": int((regs.situacao == "Melhorou").sum()),
        "regioes_estaveis": int((regs.situacao == "Estável").sum()),
        "regioes_pioraram": int((regs.situacao == "Piorou").sum()),
        "pct_regioes_melhoraram": round(float((regs.situacao == "Melhorou").mean()), 4),
        "variacao_mediana_db": round(float(regs.variacao_db.median()), 1),
        "areas_comparadas": int(len(at)),
        "areas_melhoraram": int((at.situacao == "Melhorou").sum()),
        "areas_pioraram": int((at.situacao == "Piorou").sum()),
        "amostras_ref": int((c.ano == 0).sum()), "amostras_novo": int((c.ano == 1).sum()),
        "periodo_novo": [str(novo.Date.dropna().iloc[0]) if len(novo) else "", ""],
        "arquivos_novo": len(arq_novo),
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "parametros": {"limite_estavel_db": LIMITE_ESTAVEL_DB, "faixas": FAIXAS, "grade_area": GRADE_AREA,
                       "grade_regiao": GRADE_REGIAO, "min_area": MIN_AREA, "min_regiao": MIN_REGIAO},
    }
    datas = pd.to_datetime(novo.Date, format="%d/%m/%Y", errors="coerce").dropna()
    if len(datas):
        resumo["periodo_novo"] = [datas.min().strftime("%d/%m/%Y"), datas.max().strftime("%d/%m/%Y")]

    q = ARREDONDA_TRILHA
    tr = (trilhas_src / q).round() * q
    tr = tr.drop_duplicates().round(5)

    def salvar(nome, obj):
        p = os.path.join(a.saida, nome)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {nome}: {os.path.getsize(p)/1024:,.0f} KB")

    print("Gravando arquivos do site:")
    salvar("resumo.json", resumo)
    salvar("canais.json", canais)
    salvar("classes.json", classes)
    salvar("regioes.json", regs.to_dict("records"))
    salvar("areas.json", areas.to_dict("records"))
    salvar("referencias.json", refs.to_dict("records"))
    salvar("trilhas.json", {"lat": tr.lat.tolist(), "lon": tr.lon.tolist()})
    print(f"Pronto: {resumo['regioes_melhoraram']} de {resumo['regioes_comparadas']} regiões melhoraram; "
          f"variação mediana {resumo['variacao_mediana_db']:+.1f} dB.")


if __name__ == "__main__":
    main()
