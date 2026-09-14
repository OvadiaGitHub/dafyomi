import { useState, useEffect, useRef, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────
   Daf Yomi — étude en solo, avec un partenaire de substitution
   Données Sefaria : PRÉCHARGÉES et embarquées ci-dessous (le CSP
   de l'artifact bloque tout appel vers sefaria.org depuis le
   navigateur). Une seule daf par build.
   Analyse : API Anthropic (claude-sonnet-4-6, web_search) — live.
   ───────────────────────────────────────────────────────────── */

const MODEL = "claude-sonnet-4-6";

/* ─── Données Sefaria embarquées ───
   calendars → calendar · v3/texts → text, prevText, commentaries · related → related */
__PRELOAD__

/* ─── Glossaire (termes techniques cliquables) ─── */
const GLOSSARY = [
  ["מתני׳", "Matnitin — « notre Michna » : la citation de la Michna que la guemara va discuter."],
  ["גמ׳", "Guemara — début de la discussion des Amoraïm sur la Michna citée."],
  ["תנו רבנן", "Tanou rabbanan — « nos maîtres ont enseigné » : introduit une baraïta (enseignement tannaïtique hors Michna)."],
  ["תנן", "Tenan — « nous avons appris (dans une Michna) » : citation d'une Michna comme preuve ou objection."],
  ["תניא", "Tanya — « il a été enseigné (dans une baraïta) » : citation d'une baraïta."],
  ["מיתיבי", "Meitivi — « ils objectent » : objection à partir d'une source tannaïtique (Michna ou baraïta)."],
  ["מתיב", "Metiv — un Amora objecte à partir d'une source tannaïtique."],
  ["קא משמע לן", "Ka machma lan — « il nous fait entendre » : voilà la nouveauté que la source vient enseigner."],
  ["קמ״ל", "Ka machma lan (abrégé) — voilà la nouveauté enseignée."],
  ["מהו דתימא", "Mahou detéima — « tu aurais pu penser que… » : l'hypothèse écartée, qui justifie l'utilité de l'enseignement."],
  ["איבעיא להו", "Ibaya lehou — « ils se sont posé la question » : ouverture d'une question théorique (baya) non tranchée par les sources."],
  ["פשיטא", "Pechita — « c'est évident ! » : objection qu'un énoncé n'apporte rien de neuf."],
  ["תיקו", "Teikou — la question reste sans réponse ; la guemara la laisse ouverte."],
  ["תא שמע", "Ta chema — « viens entendre » : voici une source (Michna, baraïta) qui va peut-être trancher la question."],
  ["אמר מר", "Amar mar — « le maître a dit » : reprise, pour l'analyser, d'une phrase citée plus haut."],
  ["מאי טעמא", "Maï taama — « quelle en est la raison ? »"],
  ["מ״ט", "Maï taama (abrégé) — quelle en est la raison ?"],
  ["הכא במאי עסקינן", "Hakha bemaï askinan — « de quoi traite-t-on ici ? » : la source est réinterprétée comme portant sur un cas particulier (okimta)."],
  ["מנא הני מילי", "Mena hané milé — « d'où tirons-nous cela ? » : recherche de la source scripturaire."],
  ["איכא דאמרי", "Ika deamré — « certains disent » : version alternative de la tradition."],
  ["לימא מסייע ליה", "Leima mesaya leih — « dirons-nous que cette source le soutient ? »"],
  ["הא מני", "Ha mani — « de qui est cette source ? » : quel Tanna en est l'auteur ?"],
  ["ורמינהו", "Ouraminhou — « et l'on oppose » : contradiction entre deux sources tannaïtiques."],
  ["לא קשיא", "Lo kachya — « ce n'est pas une difficulté » : les deux sources parlent de cas différents."],
  ["קשיא", "Kachya — la difficulté demeure (mais la position n'est pas réfutée)."],
  ["תיובתא", "Tiouvta — réfutation : la position est rejetée par une source tannaïtique."],
  ["שמע מינה", "Chema mina — « on en déduit » : conclusion tirée d'une source."],
  ["אי הכי", "I hakhi — « s'il en est ainsi… » : objection dérivée de la réponse précédente."],
  ["מאי נפקא מינה", "Maï nafka mina — « quelle en est la conséquence pratique ? »"],
  ["בעי", "Baé — pose une question (un Amora interroge)."],
  ["איתמר", "Itmar — « il a été dit » : introduit une ma'hloket entre Amoraïm."],
];
const GLOSS_RE = new RegExp(
  "(" +
    GLOSSARY.map((g) => g[0]).sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
    ")"
);
const GLOSS_MAP = Object.fromEntries(GLOSSARY);

/* ─── Étiquettes du fil ─── */
const THREAD_TYPES = {
  michna: ["Michna", "#5B3A8C"],
  question: ["Question", "#3A4A8C"],
  reponse: ["Réponse", "#2E6B5A"],
  objection: ["Objection", "#9A3F2E"],
  preuve: ["Preuve", "#4E6E2C"],
  refutation: ["Réfutation", "#7A2626"],
  reformulation: ["Reformulation", "#7D6A2A"],
  conclusion: ["Conclusion", "#1C1B19"],
  baraita: ["Baraïta", "#5B3A8C"],
  cas: ["Cas / récit", "#6B6760"],
  autre: ["—", "#9A968E"],
};

const REGISTERS = [
  ["rishonim", "Rishonim", true],
  ["academique", "Lecture académique", true],
  ["aharonim", "A'haronim / analytique", false],
  ["hassidout", "Hassidout", false],
  ["moussar", "Moussar", false],
  ["halakha", "Halakha pratique", false],
  ["moderne", "Pensée moderne", false],
];

/* ─── Helpers ─── */
const stripTags = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function salvageJSON(text) {
  let t = text.replace(/```json|```/g, "").trim();
  const start = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0));
  if (!isFinite(start)) throw new Error("Réponse sans JSON");
  t = t.slice(start);
  try { return JSON.parse(t); } catch {}
  // Réponse tronquée : on coupe au dernier objet complet et on referme.
  const cut = t.lastIndexOf("}");
  if (cut > 0) {
    const head = t.slice(0, cut + 1);
    for (const tail of ["]}", "]", "}", "]}}", "}]}"]) {
      try { return JSON.parse(head + tail); } catch {}
    }
  }
  throw new Error("JSON illisible (réponse probablement tronquée)");
}

async function claude(system, messages, { search = false, signal } = {}) {
  const body = { model: MODEL, max_tokens: 1000, system, messages };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw new Error(`API Anthropic : HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(`API Anthropic : ${data.error.message || "erreur"}`);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

const BASE_SYSTEM = `Tu es un assistant d'étude du Talmud de Babylone, en français, pour un étudiant débutant en guemara mais pas en réflexion. Il étudie seul.
Règles absolues :
1. N'invente JAMAIS une citation, une référence ou une position attribuée à un auteur. Si tu n'es pas certain d'une référence précise, marque-la explicitement "à vérifier". Une position sans référence précise vaut mieux qu'une fausse référence.
2. Distingue toujours trois choses : ce que dit le texte / ce que dit un commentateur / ta propre synthèse.
3. Aucun ton édifiant ou moralisateur. Aucun consensus fabriqué : si des commentateurs s'opposent, montre l'opposition.
4. Pas de vulgarisation infantilisante. Précis, dense, technique quand il le faut.
5. Translittération à la française (Rachi, Tossefot, 'hevrouta, ma'hloket, Baba Metsia).
Réponds uniquement dans le format demandé, sans préambule ni conclusion.`;

/* ─── Sefaria (lecture de la donnée embarquée, aucun appel réseau) ─── */
const DAF_REF = PRELOAD.text.ref;
const normRef = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

const outOfScope = (ref) =>
  new Error(
    `« ${ref} » n'est pas embarquée. Cette version de l'outil ne contient que ${DAF_REF} : les données Sefaria (texte, liens, Rachi, Tossefot) ont été préchargées le ${PRELOAD.builtAt}, le navigateur ne peut pas interroger sefaria.org. Pour une autre daf, il faut régénérer l'artifact.`
  );

async function fetchDafYomi(date) {
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (iso !== PRELOAD.calendar.date)
    throw new Error(
      `Le calendrier Daf Yomi n'est pas interrogé en direct : seule la journée du ${PRELOAD.calendar.date} est embarquée (${PRELOAD.calendar.display}). Reviens à cette date, ou régénère l'artifact pour une autre.`
    );
  return { ref: PRELOAD.calendar.ref, display: PRELOAD.calendar.display, heDisplay: PRELOAD.calendar.heDisplay };
}

/* Même signature qu'avant : la daf, la daf précédente (extrait) et les
   commentaires préchargés (Rachi, Tossefot) sont servis depuis PRELOAD. */
async function fetchText(ref) {
  const key = normRef(ref);
  if (key === normRef(PRELOAD.text.ref)) return { ...PRELOAD.text };
  if (key === normRef(PRELOAD.prevText.ref))
    return { ref: PRELOAD.prevText.ref, heRef: null, indexTitle: PRELOAD.text.indexTitle, next: null, prev: null, he: [], en: PRELOAD.prevText.en, fr: null };
  const hit = Object.keys(PRELOAD.commentaries).find((k) => normRef(k) === key);
  if (hit) return { ref: hit, heRef: hit, indexTitle: null, next: null, prev: null, he: PRELOAD.commentaries[hit], en: [], fr: null };
  throw outOfScope(ref);
}

async function fetchRelated(ref) {
  if (normRef(ref) !== normRef(PRELOAD.text.ref)) throw outOfScope(ref);
  return PRELOAD.related;
}

/* ─── Stockage ─── */
async function storeGet(key) {
  try { const r = await window.storage.get(key, false); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
async function storeSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val), false); return true; } catch { return false; }
}

/* ─── Construction des prompts ─── */
function segmentsBlock(he, en, fr, maxChars = 14000) {
  let out = "";
  for (let i = 0; i < he.length; i++) {
    const line = `[${i + 1}] HE: ${stripTags(he[i])}\n    TR: ${stripTags((fr && fr[i]) || en[i] || "")}\n`;
    if (out.length + line.length > maxChars) { out += `… (segments ${i + 1}–${he.length} omis pour la longueur)`; break; }
    out += line;
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════ */

export default function DafYomi() {
  const [date, setDate] = useState(() => new Date(PRELOAD.calendar.date + "T12:00:00"));
  const [manualRef, setManualRef] = useState("");
  const [ref, setRef] = useState(null);
  const [refDisplay, setRefDisplay] = useState(null);

  const [text, setText] = useState(null);
  const [textErr, setTextErr] = useState(null);
  const [retry, setRetry] = useState(0);
  const [related, setRelated] = useState(null);
  const [frGen, setFrGen] = useState({}); // traduction générée, index -> texte
  const [frGenDone, setFrGenDone] = useState(false);

  const [ctx, setCtx] = useState({ status: "idle" });
  const [thread, setThread] = useState({ status: "idle", items: {} });
  const [map, setMap] = useState({ status: "idle", points: [] });
  const [voices, setVoices] = useState({}); // `${pointIdx}:${register}` -> {status, positions, error}
  const [activeRegs, setActiveRegs] = useState(() => new Set(REGISTERS.filter((r) => r[2]).map((r) => r[0])));
  const [selectedPoint, setSelectedPoint] = useState(0);
  const [commText, setCommText] = useState({}); // sefariaRef -> {status, text}

  const [tab, setTab] = useState("carte");
  const [ctxOpen, setCtxOpen] = useState(true);
  const [gloss, setGloss] = useState(null);
  const [focusSeg, setFocusSeg] = useState(null);

  const [chat, setChat] = useState([]); // {role, content}
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState(null);

  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(true);
  const [history, setHistory] = useState([]);

  const runId = useRef(0);
  const segRefs = useRef({});
  const chatEnd = useRef(null);

  /* fonts */
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap";
    document.head.appendChild(l);
    return () => l.remove();
  }, []);

  /* historique */
  useEffect(() => { storeGet("daf:history").then((h) => h && setHistory(h)); }, []);

  /* 1. daf du jour */
  useEffect(() => {
    let cancelled = false;
    setTextErr(null);
    fetchDafYomi(date)
      .then((d) => { if (!cancelled) { setRef(d.ref); setRefDisplay(d.display); } })
      .catch((e) => { if (!cancelled) setTextErr(e.message); });
    return () => { cancelled = true; };
  }, [date]);

  /* 2. texte + lancement des analyses */
  useEffect(() => {
    if (!ref) return;
    const id = ++runId.current;
    const alive = () => runId.current === id;
    setText(null); setTextErr(null); setRelated(null); setFrGen({}); setFrGenDone(false);
    setCtx({ status: "loading" }); setThread({ status: "loading", items: {} }); setMap({ status: "loading", points: [] });
    setVoices({}); setSelectedPoint(0); setCommText({}); setChat([]); setChatErr(null); setFocusSeg(null);
    setNotes(""); setNotesSaved(true);

    storeGet(`daf:notes:${ref}`).then((n) => { if (alive() && n) setNotes(n.text || ""); });

    (async () => {
      let t;
      try {
        t = await fetchText(ref);
        if (!alive()) return;
        if (!t.he.length) throw new Error(`Sefaria a répondu, mais sans texte pour « ${ref} ». Vérifie l'orthographe (titres anglais Sefaria : Berakhot, Bava Metzia, Ketubot…).`);
        setText(t);
      } catch (e) {
        if (alive()) { setTextErr(e.message); setCtx({ status: "idle" }); setThread({ status: "idle", items: {} }); setMap({ status: "idle", points: [] }); }
        return;
      }
      // historique
      const entry = { ref: t.ref, heRef: t.heRef, date: new Date().toISOString() };
      const h = ((await storeGet("daf:history")) || []).filter((x) => x.ref !== t.ref);
      const nh = [entry, ...h].slice(0, 200);
      storeSet("daf:history", nh); if (alive()) setHistory(nh);

      // liens (commentaires disponibles) — non bloquant
      const relP = fetchRelated(t.ref).then((r) => { if (alive()) setRelated(r); return r; }).catch(() => null);
      // daf précédente (extrait) — non bloquant
      const prevP = t.prev ? fetchText(t.prev, { langs: ["english"], format: "text_only" }).catch(() => null) : Promise.resolve(null);

      // traduction FR si absente
      if (!t.fr) translateAll(t, alive);

      // analyses en parallèle
      runContext(t, prevP, alive);
      runThread(t, alive);
      runMap(t, alive);
      relP.then(() => {});
    })();
  }, [ref, retry]);

  /* ─── Traduction progressive ─── */
  async function translateAll(t, alive) {
    const BATCH = 5;
    for (let s = 0; s < t.he.length; s += BATCH) {
      if (!alive()) return;
      const idx = [];
      let block = "";
      for (let i = s; i < Math.min(s + BATCH, t.he.length); i++) {
        idx.push(i);
        block += `[${i + 1}] ARAMÉEN/HÉBREU : ${stripTags(t.he[i])}\nANGLAIS (Davidson/Steinsaltz, le gras marque le mot-à-mot) : ${(t.en[i] || "").replace(/<\/?b>/g, "**").replace(/<[^>]+>/g, "")}\n\n`;
      }
      try {
        const out = await claude(
          BASE_SYSTEM + `\nTâche : traduire des segments de guemara en français.
Traduis d'abord LITTÉRALEMENT depuis l'araméen/hébreu ; l'anglais ne sert qu'à contrôler. Les ajouts explicatifs indispensables (sujet implicite, référent d'un pronom) vont entre crochets [ ] et restent minimaux. Ne lisse pas les ellipses ni les ruptures du texte : si la phrase est abrupte, la traduction l'est aussi. Garde les termes techniques translittérés (kal va'homer, baraïta, teikou…).
Format de sortie STRICT, une ligne par segment, rien d'autre :
<numéro>|||<traduction>`,
          [{ role: "user", content: block }]
        );
        if (!alive()) return;
        const add = {};
        for (const line of out.split("\n")) {
          const m = line.match(/^\s*\[?(\d+)\]?\s*\|\|\|\s*(.+)$/);
          if (m) add[Number(m[1]) - 1] = m[2].trim();
        }
        setFrGen((p) => ({ ...p, ...add }));
      } catch (e) {
        if (!alive()) return;
        const add = {};
        idx.forEach((i) => (add[i] = null)); // null = échec, on garde l'anglais
        setFrGen((p) => ({ ...p, ...add }));
      }
    }
    if (alive()) setFrGenDone(true);
  }

  /* ─── Contexte ─── */
  async function runContext(t, prevP, alive) {
    try {
      const prev = await prevP;
      const prevExcerpt = prev ? stripTags(prev.en.slice(-10).join(" ")).slice(-3500) : "(texte de la daf précédente indisponible)";
      const out = await claude(
        BASE_SYSTEM + `\nTâche : fournir le contexte d'entrée sur une daf, à partir du texte fourni. Pour "daf_precedente", résume uniquement ce que montre l'extrait fourni (pas de connaissance extérieure non signalée). Pour "intervenants", liste chaque sage nommé DANS le texte de la daf ; statut Tanna/Amora, génération (ex. "Amora, 3e génération"), lieu (Babylone / Terre d'Israël) et académie (Soura, Poumbedita, Nehardea, Tibériade, Césarée…) — si un élément est incertain, écris "incertain".
Réponds en JSON strict :
{"traite":"3 lignes sur le traité et son objet","chapitre":{"titre":"nom hébreu du chapitre (ex. הזהב) ou 'à vérifier'","numero":"n","question":"quelle question le chapitre traite"},"daf_precedente":"3-5 lignes : où en est le raisonnement en arrivant sur cette page","intervenants":[{"nom":"","statut":"Tanna|Amora","generation":"","lieu":"","academie":""}]}`,
        [{ role: "user", content: `Traité : ${t.indexTitle}. Daf : ${t.ref} (${t.heRef || ""}).\n\nEXTRAIT DE LA DAF PRÉCÉDENTE (${t.prev || "?"}), fin de page :\n${prevExcerpt}\n\nTEXTE DE LA DAF (segments) :\n${segmentsBlock(t.he, t.en, t.fr, 9000)}` }]
      );
      if (alive()) setCtx({ status: "ok", data: salvageJSON(out) });
    } catch (e) { if (alive()) setCtx({ status: "error", error: e.message }); }
  }

  /* ─── Fil de l'argumentation ─── */
  async function runThread(t, alive) {
    try {
      const out = await claude(
        BASE_SYSTEM + `\nTâche : étiqueter la fonction logique de chaque segment de la daf.
Étiquettes autorisées : michna, baraita, question, reponse, objection, preuve, refutation, reformulation, conclusion, cas, autre.
Format STRICT, une ligne par segment, rien d'autre :
<numéro>|<étiquette>|<résumé de la fonction en 8 mots maximum>`,
        [{ role: "user", content: segmentsBlock(t.he, t.en, t.fr, 15000) }]
      );
      if (!alive()) return;
      const items = {};
      for (const line of out.split("\n")) {
        const m = line.match(/^\s*\[?(\d+)\]?\s*\|\s*([a-zéè]+)\s*\|\s*(.*)$/i);
        if (m) {
          const type = m[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          items[Number(m[1]) - 1] = { type: THREAD_TYPES[type] ? type : "autre", note: m[3].trim() };
        }
      }
      setThread({ status: "ok", items });
    } catch (e) { if (alive()) setThread({ status: "error", items: {}, error: e.message }); }
  }

  /* ─── Carte de la page ─── */
  async function runMap(t, alive) {
    try {
      const out = await claude(
        BASE_SYSTEM + `\nTâche : dresser la carte de la daf — 3 à 6 points principaux (sugyot, ma'hlokot, difficultés textuelles, tournants du raisonnement). Chaque résumé : 3-4 lignes, techniques, sans morale. Renvoie aux numéros de segments.
JSON strict : {"points":[{"titre":"","type":"sugya|mahloket|difficulte|tournant","segments":[1,2],"resume":""}]}`,
        [{ role: "user", content: `Daf : ${t.ref}\n\n${segmentsBlock(t.he, t.en, t.fr, 15000)}` }]
      );
      if (!alive()) return;
      const j = salvageJSON(out);
      setMap({ status: "ok", points: (j.points || []).filter((p) => p && p.titre) });
    } catch (e) { if (alive()) setMap({ status: "error", points: [], error: e.message }); }
  }

  /* ─── Voix ─── */
  const loadVoices = useCallback(async (pIdx, register) => {
    const key = `${pIdx}:${register}`;
    if (!text || !map.points[pIdx]) return;
    setVoices((v) => ({ ...v, [key]: { status: "loading" } }));
    const p = map.points[pIdx];
    const segs = (p.segments || []).filter((n) => n >= 1 && n <= text.he.length);
    const segText = segs.map((n) => `[${n}] ${stripTags(text.he[n - 1])}\n    TR: ${stripTags((text.fr && text.fr[n - 1]) || frGen[n - 1] || text.en[n - 1] || "")}`).join("\n").slice(0, 6000);
    const avail = related?.commentaries
      ? Object.entries(related.commentaries).map(([k, s]) => `${k} (segments ${s.join(",")})`).join(" ; ")
      : "(liste indisponible)";
    const par = related?.parallels ? Object.entries(related.parallels).map(([k, s]) => `${k}: ${s.join(", ")}`).join("\n") : "(aucun parallèle répertorié)";

    const common = `Point étudié : « ${p.titre} » — ${p.resume}\nSegments concernés (${text.ref}) :\n${segText}\n\nCommentaires disponibles sur Sefaria pour cette daf (titres et numéros de segments commentés) :\n${avail}\n\nParallèles répertoriés par Sefaria (refs exactes) :\n${par}`;

    const specs = {
      rishonim: {
        search: false,
        instr: `Registre : RISHONIM (Rachi, Tossefot, Rambam, Ramban, Ritva, Rachba, Meiri, Raavad, Rif, Roch…). 2 à 4 positions. Pour CHACUNE, commence par "difficulte" : ce qui gêne le commentateur dans le texte, la question que le texte lui pose et qui le pousse à écrire. Ensuite seulement sa thèse. Si deux Rishonim s'opposent, mets les deux et montre le point de divergence dans "changement".
Pour Rachi et Tossefot sur cette daf : ne les cite que si la liste des commentaires disponibles montre un commentaire sur un segment concerné ; alors remplis "sefaria_ref" au format exact "Rashi on ${text.ref}:<segment>" ou "Tosafot on ${text.ref}:<segment>" et donne le dibbour hamat'hil ("s.v.") seulement si tu en es sûr, sinon omets-le. Pour Rambam : Hilkhot + chapitre:halakha, avec statut "a_verifier" si tu n'es pas certain du numéro.`,
      },
      academique: {
        search: true,
        instr: `Registre : LECTURE ACADÉMIQUE / HISTORICO-CRITIQUE, extérieure à la tradition interne. 2 à 4 entrées, parmi : stratification du passage (couche amoraïque vs couche stammaïtique anonyme — présente-la comme hypothèse de lecture, en indiquant sur quels indices textuels elle repose), parallèles dans le Yerouchalmi ou la Tossefta (utilise les refs répertoriées par Sefaria ci-dessus quand elles existent ; dis ce qui diffère), variantes manuscrites significatives (uniquement si tu peux nommer le manuscrit : Munich 95, Hamburg 165, Florence, Vatican, Genizah…), realia et contexte historique sassanide/romain, apports de la recherche (Halivni, Shamma Friedman, Rubenstein, Elman, Kalmin, Weiss…). Utilise web_search pour vérifier. Ne nomme un chercheur qu'avec un ouvrage ou article identifiable ; sinon statut "a_verifier" ou omets le nom et garde l'idée en la marquant comme synthèse ("auteur":"synthèse").`,
      },
      aharonim: { search: true, instr: `Registre : A'HARONIM et école analytique lituanienne (Ketsot ha'Hochen, Netivot, Pené Yehochoua, Rabbi 'Haïm de Brisk, Rav Chimon Chkop, Kehilot Yaakov…). 2 à 3 positions. Montre la distinction conceptuelle (ha'kira) proposée et ce qu'elle résout. Référence précise ou "a_verifier".` },
      hassidout: { search: true, instr: `Registre : HASSIDOUT. La COUR est OBLIGATOIRE pour chaque position (Habad, Breslev, Gour/Sfat Emet, Izhbitsa, Kotzk, Belz, Satmar…) — jamais "hassidique" tout court ; remplis "cour". Ouvrage précis (Likouté Torah, Sfat Emet sur la parasha X, Mei haChiloa'h…). 1 à 3 positions ; si aucune lecture hassidique attestée de CE passage n'est identifiable, renvoie une liste vide plutôt qu'une lecture inventée.` },
      moussar: { search: true, instr: `Registre : MOUSSAR (Mesilat Yecharim, Rav Israël Salanter, Rav Dessler, Alter de Kelm, Slabodka…). 1 à 3 positions ; référence précise ou liste vide.` },
      halakha: { search: true, instr: `Registre : HALAKHA PRATIQUE. Comment la question est tranchée : Rif/Roch → Rambam → Tour/Choul'han Aroukh (siman:séif) → décisionnaires ultérieurs, avec les divergences ashkénaze/séfarade s'il y en a. 2 à 4 positions ; référence précise ou "a_verifier".` },
      moderne: { search: true, instr: `Registre : PENSÉE MODERNE (Rav Kook, Rav Soloveitchik, Rav Lichtenstein, Levinas dans ses lectures talmudiques, Manitou…). 1 à 3 positions ; référence précise (ouvrage, chapitre/cours) ou liste vide.` },
    };
    const spec = specs[register];
    try {
      const out = await claude(
        BASE_SYSTEM + `\nTâche : présenter les positions divergentes sur un point de la daf, dans un registre donné. Réponse compacte (les champs textuels font une phrase, deux au maximum).
${spec.instr}
JSON strict : {"positions":[{"these":"la thèse en une phrase","auteur":"","ouvrage":"","reference":"référence précise (s.v., chapitre:halakha, page…)","statut_ref":"verifiee|a_verifier","type":"commentaire|responsum|code|recherche|derouch|autre","epoque":"siècle","aire":"Provence|Rhénanie|Espagne|Babylone|Vilna|…","difficulte":"ce qui gêne le commentateur dans le texte (rishonim : obligatoire)","changement":"une ligne : ce que cette lecture change","cour":"(hassidout seulement)","sefaria_ref":"(si disponible)"}]}`,
        [{ role: "user", content: common }],
        { search: spec.search }
      );
      const j = salvageJSON(out);
      setVoices((v) => ({ ...v, [key]: { status: "ok", positions: (j.positions || []).filter((x) => x && x.these) } }));
    } catch (e) {
      setVoices((v) => ({ ...v, [key]: { status: "error", error: e.message } }));
    }
  }, [text, map.points, related, frGen]);

  useEffect(() => {
    if (map.status !== "ok" || !map.points.length) return;
    for (const r of activeRegs) {
      const key = `${selectedPoint}:${r}`;
      if (!voices[key]) loadVoices(selectedPoint, r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.status, selectedPoint, activeRegs]);

  async function openCommentary(sref) {
    if (commText[sref]?.status === "ok") { setCommText((c) => ({ ...c, [sref]: { ...c[sref], open: !c[sref].open } })); return; }
    setCommText((c) => ({ ...c, [sref]: { status: "loading", open: true } }));
    try {
      const t = await fetchText(sref, { langs: ["source"], format: "text_only" });
      if (!t.he.length) throw new Error("aucun texte à cette référence");
      setCommText((c) => ({ ...c, [sref]: { status: "ok", open: true, text: t.he, title: t.heRef || t.ref } }));
    } catch (e) {
      setCommText((c) => ({ ...c, [sref]: { status: "error", open: true, error: e.message } }));
    }
  }

  /* ─── 'Hevrouta ─── */
  function hevroutaSystem() {
    const p = map.points[selectedPoint];
    const segs = p ? (p.segments || []).filter((n) => n >= 1 && n <= text.he.length) : [];
    const segText = segs.map((n) => `[${n}] ${stripTags(text.he[n - 1])}\n    TR: ${stripTags((text.fr && text.fr[n - 1]) || frGen[n - 1] || text.en[n - 1] || "")}`).join("\n").slice(0, 6000);
    return BASE_SYSTEM + `\nRôle : tu es la 'hevrouta (partenaire d'étude) de l'étudiant sur ${text.ref}, point en cours : « ${p?.titre || "la daf"} » — ${p?.resume || ""}.
Segments :\n${segText}

Conduite :
- UNE question à la fois, précise, ancrée dans le texte (cite le segment par son numéro). Commence par la question la plus féconde sur ce point.
- Quand l'étudiant répond : ne valide pas mollement. Cherche la faille, pousse, propose la position adverse ("mais alors comment expliques-tu le segment 4 ?").
- Ne donne pas la solution avant qu'il ait cherché. S'il dit qu'il sèche, ou après deux tentatives infructueuses : un indice d'abord ; si ça ne suffit pas, la réponse, en distinguant ce que dit le texte / ce que dit tel commentateur (référence précise ou "à vérifier") / ta synthèse.
- Exigeant, jamais condescendant. Tutoiement. Pas de compliments creux. Pas de morale.
- Réponses courtes : 60 à 140 mots. Termine toujours par ta question ou ta relance.`;
  }

  async function sendChat(userText) {
    if (chatBusy || !text) return;
    const msgs = userText ? [...chat, { role: "user", content: userText }] : [{ role: "user", content: "Commence : pose-moi ta première question sur ce point." }];
    if (userText) setChat(msgs);
    setChatBusy(true); setChatErr(null); setChatInput("");
    try {
      const out = await claude(hevroutaSystem(), msgs);
      setChat([...(userText ? msgs : []), { role: "assistant", content: out }]);
    } catch (e) { setChatErr(e.message); }
    setChatBusy(false);
  }
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chat, chatBusy]);

  /* ─── Notes ─── */
  useEffect(() => {
    if (!ref || notesSaved) return;
    const t = setTimeout(async () => {
      const ok = await storeSet(`daf:notes:${ref}`, { text: notes, updated: new Date().toISOString() });
      setNotesSaved(ok);
    }, 800);
    return () => clearTimeout(t);
  }, [notes, notesSaved, ref]);

  /* ─── Navigation ─── */
  const shiftDate = (d) => { const n = new Date(date); n.setDate(n.getDate() + d); setDate(n); setManualRef(""); };
  const goManual = () => {
    const v = manualRef.trim().replace(/\s+/g, " ");
    if (!v) return;
    setRefDisplay(null); setRef(v);
  };
  const scrollToSeg = (n) => {
    setFocusSeg(n);
    segRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /* ─── Rendu texte ─── */
  const renderHe = (s) =>
    stripTags(s).split(GLOSS_RE).map((part, i) =>
      GLOSS_MAP[part] ? (
        <button key={i} className="term" onClick={(e) => setGloss({ term: part, def: GLOSS_MAP[part], x: e.clientX, y: e.clientY })}>{part}</button>
      ) : (<span key={i}>{part}</span>)
    );
  const renderEn = (s) => {
    const parts = (s || "").replace(/<(?!\/?b>)[^>]+>/g, "").split(/(<\/?b>)/);
    let bold = false;
    return parts.map((p, i) => {
      if (p === "<b>") { bold = true; return null; }
      if (p === "</b>") { bold = false; return null; }
      return bold ? <b key={i}>{p}</b> : <span key={i} className="elu">{p}</span>;
    });
  };
  const renderFrGen = (s) => s.split(/(\[[^\]]*\])/).map((p, i) => (p.startsWith("[") ? <span key={i} className="elu">{p}</span> : <span key={i}>{p}</span>));

  const frSource = text?.fr ? "sefaria" : frGenDone || Object.keys(frGen).length ? "generee" : "attente";

  /* ═══════════════════════ JSX ═══════════════════════ */
  return (
    <div className="app" onClick={() => gloss && setGloss(null)}>
      <style>{CSS}</style>

      {/* Barre de navigation */}
      <header className="bar">
        <div className="nav">
          <button className="ghost" onClick={() => shiftDate(-1)} aria-label="Jour précédent">‹</button>
          <span className="date">{fmtDate(date)}</span>
          <button className="ghost" onClick={() => shiftDate(1)} aria-label="Jour suivant">›</button>
          {date.toDateString() !== new Date(PRELOAD.calendar.date + "T12:00:00").toDateString() && <button className="ghost small" onClick={() => { setDate(new Date(PRELOAD.calendar.date + "T12:00:00")); setManualRef(""); }}>daf préchargée</button>}
        </div>
        <div className="title">
          {text ? (<><span className="he-title" dir="rtl">{text.heRef}</span><span className="en-title">{text.ref}</span></>) : refDisplay ? <span className="en-title">{refDisplay}</span> : <span className="en-title muted">Daf Yomi…</span>}
        </div>
        <div className="manual">
          <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && goManual()} placeholder="Autre daf : Bava Metzia 42a" aria-label="Saisir une daf" />
          <button className="ghost" onClick={goManual}>Ouvrir</button>
        </div>
      </header>

      {textErr && (
        <div className="error">
          <strong>Impossible de charger la daf.</strong> {textErr}
          <button className="ghost small" onClick={() => { setDate(new Date(PRELOAD.calendar.date + "T12:00:00")); setManualRef(""); setRefDisplay(PRELOAD.calendar.display); setRef(DAF_REF); }}>Revenir à {DAF_REF}</button>
          <button className="ghost small" onClick={() => setRetry((n) => n + 1)}>Réessayer</button>
        </div>
      )}

      {/* Avant d'entrer */}
      {ref && !textErr && (
        <section className="ctx">
          <button className="ctx-head" onClick={() => setCtxOpen((o) => !o)} aria-expanded={ctxOpen}>
            <span className="caret">{ctxOpen ? "▾" : "▸"}</span> Avant d'entrer
            {ctx.status === "loading" && <span className="muted"> — en préparation…</span>}
          </button>
          {ctxOpen && (
            <div className="ctx-body">
              {ctx.status === "loading" && <p className="muted">Le contexte arrive dès que le texte est lu (traité, chapitre, daf précédente, intervenants).</p>}
              {ctx.status === "error" && <p className="err-inline">Contexte indisponible : {ctx.error}</p>}
              {ctx.status === "ok" && (() => { const d = ctx.data || {}; return (
                <div className="ctx-grid">
                  <div>
                    <h4>Le traité</h4>
                    <p>{d.traite}</p>
                    <h4>Où on en est</h4>
                    <p>{d.chapitre && <><span dir="rtl" className="he-inline">{d.chapitre.titre}</span> (chapitre {d.chapitre.numero}) — {d.chapitre.question}</>}</p>
                    <p><span className="src">D'après la fin de la daf précédente :</span> {d.daf_precedente}</p>
                  </div>
                  <div>
                    <h4>Qui parle sur cette page</h4>
                    <table className="people">
                      <tbody>
                        {(d.intervenants || []).map((p, i) => (
                          <tr key={i}><td className="pname">{p.nom}</td><td>{p.statut}{p.generation ? `, ${p.generation}` : ""}</td><td className="muted">{[p.lieu, p.academie].filter(Boolean).join(" · ")}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ); })()}
            </div>
          )}
        </section>
      )}

      {/* Corps */}
      {ref && !textErr && (
        <div className="body">
          {/* Texte + fil */}
          <main className="reading">
            <div className="reading-head">
              <span>Fil</span>
              <span dir="rtl">{text?.heTitle || "המקור"}</span>
              <span>
                {frSource === "sefaria" && `Français — ${text.frTitle}`}
                {frSource === "generee" && <>Français <span className="muted">(traduction générée : aucune version française sur Sefaria — l'anglais Davidson s'affiche en attendant)</span></>}
                {frSource === "attente" && (text ? <>Anglais (Davidson) <span className="muted">— traduction française en cours</span></> : "Traduction")}
              </span>
            </div>
            {!text && !textErr && <div className="loading-text"><span className="muted">Lecture du texte embarqué…</span></div>}
            {text && text.he.map((h, i) => {
              const th = thread.items[i];
              const fr = text.fr ? text.fr[i] : frGen[i];
              const isFocus = focusSeg === i + 1;
              return (
                <div key={i} ref={(el) => (segRefs.current[i + 1] = el)} className={"seg" + (isFocus ? " focus" : "")}>
                  <div className="thread">
                    <span className="n">{i + 1}</span>
                    {th ? (
                      <span className="tag" style={{ "--c": THREAD_TYPES[th.type][1] }} title={th.note}>
                        <span className="dot" />{THREAD_TYPES[th.type][0]}
                        <span className="tnote">{th.note}</span>
                      </span>
                    ) : thread.status === "loading" ? <span className="tag pending"><span className="dot" /></span> : null}
                  </div>
                  <div className="he" dir="rtl" lang="he">{renderHe(h)}</div>
                  <div className="fr" lang={fr ? "fr" : "en"}>
                    {fr ? (text.fr ? stripTags(fr) : renderFrGen(fr)) : renderEn(text.en[i])}
                    {frGen[i] === null && <span className="muted"> (traduction FR échouée pour ce segment)</span>}
                  </div>
                </div>
              );
            })}
            {thread.status === "error" && <p className="err-inline">Fil de l'argumentation indisponible : {thread.error}</p>}
            {text && (
              <div className="pager">
                {text.prev && <button className="ghost" disabled title="Daf non embarquée dans cette version" style={{ opacity: 0.45, cursor: "default" }}>‹ {text.prev}</button>}
                <span />
                {text.next && <button className="ghost" disabled title="Daf non embarquée dans cette version" style={{ opacity: 0.45, cursor: "default" }}>{text.next} ›</button>}
              </div>
            )}
          </main>

          {/* Panneau latéral */}
          <aside className="side">
            <div className="tabs" role="tablist">
              {[["carte", "Carte"], ["voix", "Voix"], ["hevrouta", "'Hevrouta"], ["notes", "Traces"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            {/* CARTE */}
            {tab === "carte" && (
              <div className="pane">
                {map.status === "loading" && <p className="muted">Repérage des points principaux…</p>}
                {map.status === "error" && <p className="err-inline">Carte indisponible : {map.error} <button className="ghost small" onClick={() => text && runMap(text, () => true)}>Réessayer</button></p>}
                {map.status === "ok" && map.points.map((p, i) => (
                  <article key={i} className={"point" + (selectedPoint === i ? " sel" : "")} onClick={() => setSelectedPoint(i)}>
                    <div className="point-head">
                      <span className={"kind k-" + (p.type || "sugya")}>{{ sugya: "Sugya", mahloket: "Ma'hloket", difficulte: "Difficulté", tournant: "Tournant" }[p.type] || "Point"}</span>
                      <h3>{p.titre}</h3>
                    </div>
                    <p>{p.resume}</p>
                    <div className="segs">
                      {(p.segments || []).map((n) => <button key={n} className="seglink" onClick={(e) => { e.stopPropagation(); scrollToSeg(n); }}>§{n}</button>)}
                      <button className="ghost small" onClick={(e) => { e.stopPropagation(); setSelectedPoint(i); setTab("voix"); }}>Les voix</button>
                      <button className="ghost small" onClick={(e) => { e.stopPropagation(); setSelectedPoint(i); setTab("hevrouta"); }}>Étudier en 'hevrouta</button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* VOIX */}
            {tab === "voix" && (
              <div className="pane">
                {map.status !== "ok" ? <p className="muted">Les voix se chargent une fois la carte établie.</p> : !map.points.length ? <p className="muted">Aucun point identifié.</p> : (
                  <>
                    <div className="point-select">
                      {map.points.map((p, i) => <button key={i} className={"chip" + (selectedPoint === i ? " on" : "")} onClick={() => setSelectedPoint(i)}>{i + 1}. {p.titre}</button>)}
                    </div>
                    <div className="reg-filter">
                      {REGISTERS.map(([k, l]) => (
                        <label key={k} className={"reg" + (activeRegs.has(k) ? " on" : "")}>
                          <input type="checkbox" checked={activeRegs.has(k)} onChange={() => setActiveRegs((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                          {l}
                        </label>
                      ))}
                    </div>
                    {REGISTERS.filter((r) => activeRegs.has(r[0])).map(([k, l]) => {
                      const v = voices[`${selectedPoint}:${k}`];
                      const academic = k === "academique";
                      return (
                        <section key={k} className={"register" + (academic ? " academic" : "")}>
                          <h4>{l}{academic && <span className="ext">lecture extérieure à la tradition interne</span>}</h4>
                          {!v || v.status === "loading" ? <p className="muted">Recherche{["academique", "aharonim", "hassidout", "moussar", "halakha", "moderne"].includes(k) ? " (avec vérification web)" : ""}…</p> : null}
                          {v?.status === "error" && <p className="err-inline">{v.error} <button className="ghost small" onClick={() => loadVoices(selectedPoint, k)}>Réessayer</button></p>}
                          {v?.status === "ok" && !v.positions.length && <p className="muted">Aucune position attestée identifiée pour ce point dans ce registre — plutôt que d'en inventer une.</p>}
                          {v?.status === "ok" && v.positions.map((pos, j) => (
                            <div key={j} className="pos">
                              <p className="these">{pos.these}</p>
                              <p className="attrib">
                                <strong>{pos.auteur}</strong>{pos.cour ? ` (${pos.cour})` : ""}{pos.ouvrage ? `, ${pos.ouvrage}` : ""}{pos.reference ? ` — ${pos.reference}` : ""}
                                {pos.statut_ref === "a_verifier" && <span className="verify">attribution à vérifier</span>}
                              </p>
                              <p className="meta">{[pos.type, pos.epoque, pos.aire].filter(Boolean).join(" / ")}</p>
                              {pos.difficulte && <p><span className="src">Ce qui le gêne :</span> {pos.difficulte}</p>}
                              {pos.changement && <p><span className="src">Ce que ça change :</span> {pos.changement}</p>}
                              {pos.sefaria_ref && (
                                <div>
                                  <button className="ghost small" onClick={() => openCommentary(pos.sefaria_ref)}>{commText[pos.sefaria_ref]?.open ? "Masquer" : "Lire le texte"} · {pos.sefaria_ref}</button>
                                  {commText[pos.sefaria_ref]?.open && (
                                    <div className="comm">
                                      {commText[pos.sefaria_ref].status === "loading" && <span className="muted">Sefaria…</span>}
                                      {commText[pos.sefaria_ref].status === "error" && <span className="err-inline">Texte non consultable ici ({commText[pos.sefaria_ref].error}) — attribution à vérifier.</span>}
                                      {commText[pos.sefaria_ref].status === "ok" && commText[pos.sefaria_ref].text.map((t, q) => <p key={q} dir="rtl" lang="he" className="he-small">{t}</p>)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* 'HEVROUTA */}
            {tab === "hevrouta" && (
              <div className="pane chat-pane">
                {map.status !== "ok" ? <p className="muted">La 'hevrouta commence une fois la carte établie.</p> : (
                  <>
                    <div className="point-select">
                      {map.points.map((p, i) => <button key={i} className={"chip" + (selectedPoint === i ? " on" : "")} onClick={() => { setSelectedPoint(i); setChat([]); }}>{i + 1}. {p.titre}</button>)}
                    </div>
                    <div className="chat">
                      {!chat.length && !chatBusy && (
                        <div className="chat-empty">
                          <p className="muted">Point : {map.points[selectedPoint]?.titre}. Le partenaire pose une question, tu réponds, il te pousse. Il ne donne la solution qu'après que tu as cherché — tu peux écrire « je sèche ».</p>
                          <button className="primary" onClick={() => sendChat(null)}>Commencer</button>
                        </div>
                      )}
                      {chat.map((m, i) => <div key={i} className={"msg " + m.role}>{m.content}</div>)}
                      {chatBusy && <div className="msg assistant muted">…</div>}
                      {chatErr && <p className="err-inline">{chatErr}</p>}
                      <div ref={chatEnd} />
                    </div>
                    {(chat.length > 0) && (
                      <div className="chat-input">
                        <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatInput.trim() && sendChat(chatInput.trim()); } }} placeholder="Ta réponse… (Entrée pour envoyer, Maj+Entrée : retour à la ligne)" rows={3} />
                        <div className="chat-actions">
                          <button className="ghost small" onClick={() => sendChat("Je sèche.")} disabled={chatBusy}>Je sèche</button>
                          <button className="primary" onClick={() => chatInput.trim() && sendChat(chatInput.trim())} disabled={chatBusy || !chatInput.trim()}>Envoyer</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TRACES */}
            {tab === "notes" && (
              <div className="pane">
                <h4>Notes sur {text?.ref || ref} <span className="muted">{notesSaved ? "" : "— enregistrement…"}</span></h4>
                <textarea className="notes" value={notes} onChange={(e) => { setNotes(e.target.value); setNotesSaved(false); }} placeholder="Ce qui t'a arrêté, ce que tu n'as pas compris, ce que tu veux revoir." rows={10} />
                <h4>Pages étudiées</h4>
                {!history.length && <p className="muted">Aucune page encore.</p>}
                <ul className="hist">
                  {history.map((h) => (
                    <li key={h.ref}>
                      <button className="link" onClick={() => { setRefDisplay(null); setRef(h.ref); setTab("carte"); }}>{h.ref}</button>
                      <span dir="rtl" className="he-inline muted">{h.heRef}</span>
                      <span className="muted">{new Date(h.date).toLocaleDateString("fr-FR")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      {gloss && (
        <div className="gloss" style={{ left: Math.min(gloss.x, window.innerWidth - 340), top: gloss.y + 12 }} onClick={(e) => e.stopPropagation()}>
          <span dir="rtl" className="he-inline">{gloss.term}</span>
          <p>{gloss.def}</p>
        </div>
      )}

      <footer className="foot">Texte : Sefaria (édition William Davidson), préchargé le {PRELOAD.builtAt} pour {DAF_REF} — commentaires consultables : Rachi et Tossefot. Analyses et traductions générées : à vérifier — le texte prime toujours, puis le commentateur, puis la synthèse.</footer>
    </div>
  );
}

/* ═══════════════════════ Styles ═══════════════════════ */
const CSS = `
:root{
  --page:#ECEAE4; --surface:#FAF9F6; --ink:#1C1B19; --muted:#6B6760; --rule:#D8D4CB; --rule2:#E6E3DC;
  --accent:#3A4A8C; --acad-bg:#E9F0F1; --acad-line:#3E7A83; --acad-ink:#2C5F66;
  --he:'Frank Ruhl Libre','Noto Serif Hebrew','David','Times New Roman',serif;
  --fr:'Source Serif 4','Charter','Iowan Old Style',Georgia,serif;
}
*{box-sizing:border-box}
.app{font-family:var(--fr);color:var(--ink);background:var(--page);min-height:100vh;font-size:15px;line-height:1.55}
button{font:inherit;color:inherit;cursor:pointer}
.muted{color:var(--muted)}
.ghost{background:transparent;border:1px solid var(--rule);border-radius:3px;padding:3px 9px;font-size:13px}
.ghost:hover{background:var(--surface)}
.ghost.small{font-size:12px;padding:2px 7px}
.primary{background:var(--accent);color:#fff;border:0;border-radius:3px;padding:6px 14px;font-size:14px}
.primary:disabled{opacity:.5;cursor:default}
.link{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;text-underline-offset:3px}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.bar{display:flex;align-items:center;gap:20px;padding:10px 20px;border-bottom:1px solid var(--rule);background:var(--surface);position:sticky;top:0;z-index:5;flex-wrap:wrap}
.nav{display:flex;align-items:center;gap:6px}
.date{font-variant:small-caps;letter-spacing:.02em;min-width:190px;text-align:center}
.title{display:flex;align-items:baseline;gap:14px;flex:1}
.he-title{font-family:var(--he);font-size:26px;font-weight:500}
.en-title{font-size:15px;color:var(--muted)}
.manual{display:flex;gap:6px}
.manual input{font:inherit;font-size:13px;padding:4px 8px;border:1px solid var(--rule);border-radius:3px;background:var(--surface);width:220px}

.error{margin:14px 20px;padding:12px 14px;border:1px solid #B5453A;background:#FBEFEC;border-radius:3px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.err-inline{color:#8A2F26}

.ctx{margin:14px 20px 0;border:1px solid var(--rule);background:var(--surface);border-radius:3px}
.ctx-head{width:100%;text-align:left;background:none;border:0;padding:10px 14px;font-size:15px;font-weight:600}
.caret{display:inline-block;width:14px;color:var(--muted)}
.ctx-body{padding:0 16px 14px;border-top:1px solid var(--rule2)}
.ctx-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:28px}
.ctx h4,.pane h4{font-size:12px;font-weight:600;color:var(--muted);margin:14px 0 4px;letter-spacing:.01em}
.ctx p{margin:0 0 8px;max-width:62ch}
.src{color:var(--accent);font-style:italic}
.people{border-collapse:collapse;font-size:14px;width:100%}
.people td{padding:3px 10px 3px 0;vertical-align:top;border-bottom:1px solid var(--rule2)}
.pname{font-weight:600;white-space:nowrap}
.he-inline{font-family:var(--he);font-size:1.1em}

.body{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:16px;padding:14px 20px 40px;align-items:start}
.reading{background:var(--surface);border:1px solid var(--rule);border-radius:3px;min-width:0}
.reading-head{display:grid;grid-template-columns:130px 1fr 1fr;gap:18px;padding:8px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--rule)}
.loading-text{padding:40px;text-align:center}
.seg{display:grid;grid-template-columns:130px 1fr 1fr;gap:18px;padding:12px 14px;border-bottom:1px solid var(--rule2);position:relative}
.seg:last-of-type{border-bottom:0}
.seg.focus{background:#F1EFE7}
.thread{display:flex;gap:8px;align-items:flex-start;font-size:12px;position:relative}
.thread::before{content:"";position:absolute;left:29px;top:-12px;bottom:-12px;width:1px;background:var(--rule)}
.n{width:18px;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;flex:none}
.tag{display:flex;flex-direction:column;gap:2px;color:var(--c,var(--muted));position:relative;padding-left:14px;line-height:1.3;min-width:0}
.tag .dot{position:absolute;left:4px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--c,var(--rule));z-index:1}
.tag.pending .dot{background:var(--rule)}
.tag>span:not(.dot):first-of-type{font-weight:600}
.tnote{color:var(--muted);font-weight:400;font-size:11.5px}
.he{font-family:var(--he);font-size:19px;line-height:1.75;text-align:right}
.term{background:none;border:0;padding:0;font:inherit;color:inherit;border-bottom:1px dotted var(--accent);cursor:help}
.term:hover{color:var(--accent)}
.fr{font-size:15px;line-height:1.6}
.fr .elu{color:var(--muted)}
.fr b{font-weight:600}
.he-small{font-family:var(--he);font-size:16px;line-height:1.7;margin:4px 0}
.pager{display:flex;justify-content:space-between;padding:12px 14px;border-top:1px solid var(--rule)}

.side{position:sticky;top:64px;background:var(--surface);border:1px solid var(--rule);border-radius:3px;max-height:calc(100vh - 80px);display:flex;flex-direction:column;min-width:0}
.tabs{display:flex;border-bottom:1px solid var(--rule)}
.tab{flex:1;background:none;border:0;padding:9px 6px;font-size:13.5px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.tab.on{color:var(--ink);border-bottom-color:var(--accent);font-weight:600}
.pane{padding:6px 14px 14px;overflow:auto}
.pane>h4:first-child{margin-top:8px}
.point{padding:10px 0;border-bottom:1px solid var(--rule2);cursor:pointer}
.point.sel{background:#F3F1EA;margin:0 -14px;padding:10px 14px;border-left:3px solid var(--accent)}
.point-head{display:flex;gap:8px;align-items:baseline}
.point h3{font-size:15px;margin:0;font-weight:600}
.point p{margin:6px 0;font-size:14px}
.kind{font-size:11px;padding:1px 6px;border-radius:2px;border:1px solid;flex:none;white-space:nowrap}
.k-sugya{color:#3A4A8C}.k-mahloket{color:#9A3F2E}.k-difficulte{color:#7D6A2A}.k-tournant{color:#2E6B5A}
.segs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.seglink{background:none;border:1px solid var(--rule);border-radius:2px;padding:0 5px;font-size:12px;color:var(--accent)}
.point-select{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}
.chip{background:none;border:1px solid var(--rule);border-radius:12px;padding:2px 9px;font-size:12.5px;text-align:left}
.chip.on{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.reg-filter{display:flex;flex-wrap:wrap;gap:4px 10px;padding:6px 0 4px;border-bottom:1px solid var(--rule2);font-size:12.5px}
.reg{display:flex;gap:4px;align-items:center;color:var(--muted);cursor:pointer}
.reg.on{color:var(--ink)}
.reg input{accent-color:var(--accent)}
.register{margin-top:10px}
.register h4{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.register.academic{background:var(--acad-bg);border-left:3px solid var(--acad-line);margin-left:-14px;margin-right:-14px;padding:2px 14px 8px 14px}
.register.academic h4{color:var(--acad-ink)}
.ext{font-weight:400;font-style:italic;font-size:11.5px;color:var(--acad-ink)}
.pos{padding:8px 0;border-top:1px solid var(--rule2)}
.register.academic .pos{border-top-color:#CFDDDF}
.pos p{margin:3px 0;font-size:14px}
.these{font-weight:600}
.attrib{font-size:13px}
.meta{font-size:12px;color:var(--muted)}
.verify{margin-left:8px;font-size:11px;padding:0 5px;border:1px solid #B5453A;color:#8A2F26;border-radius:2px;font-weight:400}
.comm{margin:6px 0 0;padding:6px 10px;border-left:2px solid var(--rule);background:#F5F3EC}

.chat-pane{display:flex;flex-direction:column;flex:1;min-height:0}
.chat{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:8px 0;min-height:200px}
.chat-empty p{font-size:14px}
.msg{padding:8px 12px;border-radius:3px;font-size:14px;white-space:pre-wrap;max-width:95%}
.msg.assistant{background:#F1EFE7;align-self:flex-start;border-left:2px solid var(--accent)}
.msg.user{background:var(--surface);border:1px solid var(--rule);align-self:flex-end}
.chat-input{border-top:1px solid var(--rule);padding-top:8px}
.chat-input textarea,.notes{width:100%;font:inherit;font-size:14px;padding:8px;border:1px solid var(--rule);border-radius:3px;background:var(--surface);resize:vertical}
.chat-actions{display:flex;justify-content:space-between;margin-top:6px}
.hist{list-style:none;padding:0;margin:0;font-size:13.5px}
.hist li{display:flex;gap:10px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--rule2)}

.gloss{position:fixed;z-index:20;width:320px;background:var(--ink);color:#F3F1EA;padding:10px 12px;border-radius:3px;font-size:13.5px;box-shadow:0 4px 18px rgba(0,0,0,.25)}
.gloss .he-inline{font-size:17px}
.gloss p{margin:4px 0 0}
.foot{padding:10px 20px 24px;font-size:12px;color:var(--muted);border-top:1px solid var(--rule)}

@media (max-width:980px){
  .body{grid-template-columns:1fr}
  .side{position:static;max-height:none}
  .reading-head{display:none}
  .seg{grid-template-columns:1fr;gap:8px}
  .thread::before{display:none}
  .tag{flex-direction:row;gap:8px}
  .ctx-grid{grid-template-columns:1fr}
  .bar{gap:10px}
  .title{order:-1;width:100%}
}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
