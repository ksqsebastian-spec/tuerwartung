/**
 * Die Importseiten: was schon eingelesen wurde, und die Freigabe der Vorschläge.
 *
 * Gelesen wird der Plan im Gespräch mit Claude (Abschnitt 7.0) — hier bestätigt ein Mensch,
 * was dabei herauskam. Ohne Plan-Rasterbild als Liste, mit als Karte (`/objekt/:id/plan/…`).
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { auswahlfeld, esc, seite, umleitung, zeitpunkt } from "./layout";
import { markdown } from "./markdown";
import { VORLAGEN } from "../vorlagen";
import { geschosseListe, objektLesen } from "../daten/objekte";
import { importLesen, importeListe, vorschlaegeLesen, zaehlen } from "../daten/importe";
import type { Vorschlag } from "../daten/importe";
import { anleitung } from "../mcp/import_werkzeuge";

export function anleitungSeite(nutzer: Nutzer, origin: string): Response {
  return seite(
    `<div class="anleitung">
${markdown(anleitung)}
<h2 class="abschnitt">Wie du es auslöst</h2>
<p class="body">Hänge den Plan oder die Türliste in Claude an und sag, wohin damit:
<b>„Importier das nach Türwerk, Objekt Kita Heselstücken, Erdgeschoss."</b>
Claude liest das hier und geht den Ablauf durch. Türwerk selbst braucht dafür keinen
Schlüssel und keine Bildverarbeitung — es verwahrt nur, was gefunden wurde, bis du es freigibst.</p>
<div class="knopfleiste"><a class="btn schmal leise" href="/verbinden">Connector einrichten</a>
<a class="btn schmal leise" href="/objekte">Zu den Objekten</a></div>
</div>`,
    { titel: "Bauplan-Import", nutzer, aktiv: "objekte" },
  );
}

export async function importeSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
  meldung?: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, objektId);
  if (!o) return umleitung("/objekte");
  const liste = await importeListe(env.DB, o.id);
  const geschosse = await geschosseListe(env.DB, o.id);

  const zeilen = [];
  for (const i of liste) {
    const v = await vorschlaegeLesen(env.DB, { import_id: i.id, status: "alle" });
    const z = zaehlen(v);
    const geschoss = geschosse.find((g) => g.id === i.geschoss_id);
    zeilen.push(`<a class="posten" href="/objekt/${esc(o.id)}/import/${esc(i.id)}">
<div class="haupt"><div class="name">${esc(i.dateiname)}</div>
<div class="unter">${esc(i.art === "tuerliste" ? "Türliste" : "Plan")}${
      geschoss ? ` · ${esc(geschoss.name)}` : ""
    } · ${esc(zeitpunkt(i.angelegt_am))} · ${esc(i.angelegt_von)}</div></div>
${z.offen ? `<span class="chip">${z.offen} offen</span>` : ""}
${z.angenommen ? `<span class="chip gut">${z.angenommen} übernommen</span>` : ""}
<span class="chip leise">${esc(i.status)}</span></a>`);
  }

  return seite(
    `<div class="eyebrow"><a href="/objekt/${esc(o.id)}">${esc(o.name)}</a></div>
<h1 class="seite" style="margin-top:8px">Import</h1>
<p class="lede" style="margin-top:12px;max-width:52ch">Pläne und Türlisten liest Claude —
du hängst die Datei ins Gespräch und sagst, wohin damit. Hier steht, was dabei herauskam, und
hier gibst du es frei.</p>
${meldung ? `<div class="note" style="margin:22px 0">${esc(meldung)}</div>` : ""}
<div class="knopfleiste">
<a class="btn schmal leise" href="/anleitung/import">Wie es geht</a>
<a class="btn schmal leise" href="/objekt/${esc(o.id)}/geschosse">Geschosse</a></div>

<h2 class="abschnitt">Eingelesen</h2>
${zeilen.length ? `<div class="liste">${zeilen.join("")}</div>` : '<div class="leer">Noch nichts eingelesen.</div>'}`,
    { titel: "Import", nutzer, aktiv: "objekte" },
  );
}

export async function importSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
  importId: string,
  optionen: { status?: string; meldung?: string } = {},
): Promise<Response> {
  const o = await objektLesen(env.DB, objektId);
  if (!o) return umleitung("/objekte");
  const imp = await importLesen(env.DB, importId);
  if (!imp || imp.objekt_id !== o.id) return umleitung(`/objekt/${o.id}/import`);

  const status = optionen.status || "offen";
  const alle = await vorschlaegeLesen(env.DB, { import_id: imp.id, status: "alle" });
  const gezeigt = status === "alle" ? alle : alle.filter((v) => v.status === status);
  const z = zaehlen(alle);
  const geschosse = await geschosseListe(env.DB, o.id);
  const geschoss = geschosse.find((g) => g.id === imp.geschoss_id);

  const zeile = (v: Vorschlag) => `<label class="posten">
${
  v.status === "offen"
    ? `<input type="checkbox" name="id" value="${esc(v.id)}" style="width:20px;height:20px">`
    : `<span class="chip ${v.status === "angenommen" ? "gut" : "leise"}">${esc(v.status)}</span>`
}
<div class="haupt"><div class="name">${esc(v.kennung || v.raumnummer || "ohne Kennung")}</div>
<div class="unter">${esc(
    [
      VORLAGEN[v.art]?.label ?? v.art,
      v.raum,
      v.x !== null ? `Position ${(v.x * 100).toFixed(0)}/${((v.y ?? 0) * 100).toFixed(0)}` : "ohne Position",
      v.text_nahe.slice(0, 4).join(" "),
    ]
      .filter(Boolean)
      .join(" · "),
  )}</div></div>
${v.wartungspflichtig ? '<span class="chip">wartungspflichtig</span>' : ""}
<span class="chip ${v.konfidenz >= 0.85 ? "gut" : v.konfidenz >= 0.6 ? "bald" : "leise"}">${v.konfidenz.toFixed(2)}</span></label>`;

  const ziel = `/objekt/${esc(o.id)}/import/${esc(imp.id)}`;

  return seite(
    `<div class="eyebrow"><a href="/objekt/${esc(o.id)}/import">${esc(o.name)} · Import</a></div>
<h1 class="seite" style="margin-top:8px">${esc(imp.dateiname)}</h1>
<p class="meta" style="margin-top:8px">${esc(imp.art === "tuerliste" ? "Türliste" : "Plan")}${
      geschoss ? ` · ${esc(geschoss.name)}` : ""
    } · ${z.gesamt} Kandidaten · ${z.offen} offen · ${z.angenommen} übernommen · ${z.verworfen} verworfen</p>
${optionen.meldung ? `<div class="note" style="margin:22px 0">${esc(optionen.meldung)}</div>` : ""}

${
  geschoss?.plan_schluessel
    ? `<div class="knopfleiste"><a class="btn schmal" href="/objekt/${esc(o.id)}/plan/${esc(geschoss.id)}">Auf dem Plan zeigen</a></div>`
    : ""
}

<form method="post" action="${ziel}">
<div class="knopfleiste" style="margin-top:18px">
<button class="btn schmal" name="tun" value="annehmen">Ausgewählte übernehmen</button>
<button class="btn schmal leise" name="tun" value="verwerfen">Ausgewählte verwerfen</button>
<button class="btn schmal leise" name="tun" value="annehmen_ab_085">Alle ab 0.85 übernehmen</button>
<button class="btn schmal leise" name="tun" value="annehmen_pflichtige">Wartungspflichtige übernehmen</button>
</div>
<div style="height:14px"></div>
<div class="zeile" style="justify-content:space-between;align-items:center">
<label class="meta" style="display:flex;gap:8px;align-items:center">
<input type="checkbox" id="alle" style="width:18px;height:18px"> alle auswählen</label>
<span class="meta">${["offen", "angenommen", "verworfen", "alle"]
      .map(
        (s) =>
          `<a href="${ziel}?status=${s}"${s === status ? ' style="font-weight:700;color:var(--ink)"' : ""}>${s}</a>`,
      )
      .join(" · ")}</span></div>
<div style="height:10px"></div>
${
  gezeigt.length
    ? `<div class="liste">${gezeigt.map(zeile).join("")}</div>`
    : `<div class="leer">Nichts mit Status „${esc(status)}".</div>`
}
</form>

${
  imp.status !== "bestaetigt"
    ? `<form method="post" action="${ziel}" class="knopfleiste">
<button class="btn schmal leise" name="tun" value="abschliessen">Import abschließen</button>
<span class="meta">Was dann offen ist, gilt als verworfen. Die übernommenen Bauteile bleiben.</span>
</form>`
    : ""
}`,
    {
      titel: imp.dateiname,
      nutzer,
      aktiv: "objekte",
      skript: `
document.getElementById('alle')?.addEventListener('change', (e) => {
  document.querySelectorAll('input[name=id]').forEach((k) => { k.checked = e.target.checked; });
});`,
    },
  );
}

export { auswahlfeld };
