/**
 * Einrichten — der eine Weg, den man vor der Wartung geht, am besten im Büro.
 *
 * Drei Schritte, untereinander auf einer Seite statt hintereinander in einem Klickpfad: wer
 * einrichtet, sitzt am Tisch und will sehen, was noch fehlt, nicht durch fünf Seiten blättern.
 * Jeder Schritt trägt seinen Haken, sobald er steht.
 *
 *   1. Die Liegenschaft  — was für ALLE Türen gilt: Adresse, Betreiber, Zugang, Intervall.
 *   2. Die Türen         — der Bestand, aus einer Türenliste über den Chat oder von Hand.
 *   3. Die Türtypen      — was sich JE ART wiederholt, und was an JEDER Tür einzeln steht.
 *
 * Diese drei Ebenen sind die eigentliche Ordnung des Hauses: konstant, wiederholt, variabel.
 * Sie hier nebeneinander zu zeigen, ist der halbe Zweck der Seite — wer sie einmal gesehen hat,
 * weiß danach, warum ein Hersteller am Türtyp steht und die Ident-Nummer an der Tür.
 *
 * Am Ende steht die Laufliste: die Checkliste, die bei der Wartung durchgegangen wird.
 */
import type { Env } from "../env";
import type { Nutzer } from "../auth/sitzung";
import { esc, seite, textfeld, umleitung } from "./layout";
import { geschosseListe, objektLesen } from "../daten/objekte";
import type { Objekt } from "../daten/objekte";
import { bauteileMitStand, inLaufreihenfolge } from "../daten/bauteile";
import { tuertypLesen, tuertypenListe } from "../daten/tuertypen";
import type { Tuertyp } from "../daten/tuertypen";
import { VORLAGEN } from "../vorlagen";

/** Ein Schritt mit Haken. Offen heißt: hier ist noch etwas zu tun. */
function schritt(nr: number, titel: string, fertig: boolean, unter: string, inhalt: string): string {
  return `<section class="schritt${fertig ? " fertig" : ""}">
<h2><span class="marke">${fertig ? "✓" : nr}</span>${esc(titel)}</h2>
<p class="meta">${unter}</p>
${inhalt}
</section>`;
}

const CSS = `
.schritt { border-top: 1px solid var(--line); padding: 26px 0 6px; }
.schritt h2 { font-size: 1.06rem; letter-spacing: -.02em; display: flex; align-items: center; gap: 12px; }
.schritt .marke {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center; font-size: .82rem; font-weight: 660;
  background: var(--wash); color: var(--ink-2);
}
.schritt.fertig .marke { background: #12833f; color: #fff; }
.schritt > p.meta { margin: 8px 0 16px 38px; max-width: 62ch; }
.schritt > *:not(h2):not(p.meta) { margin-left: 38px; }
.ebenen { display: grid; gap: 10px; margin: 0 0 18px 38px; }
.ebene { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.ebene b { font-size: .84rem; letter-spacing: -.01em; }
.ebene span { display: block; font-size: .86rem; color: var(--ink-2); margin-top: 2px; }
`;

export async function einrichtenSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
  meldung?: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, objektId);
  if (!o) return umleitung("/objekte");

  const geschosse = await geschosseListe(env.DB, o.id);
  const bauteile = inLaufreihenfolge(await bauteileMitStand(env.DB, o), geschosse);

  /* Die Türtypen, die an diesem Objekt tatsächlich vorkommen — nicht alle, die es gibt. */
  const typIds = [...new Set(bauteile.map((b) => b.tuertyp_id).filter(Boolean))] as string[];
  const typen: Tuertyp[] = [];
  for (const id of typIds) {
    const t = await tuertypLesen(env.DB, id);
    if (t) typen.push(t);
  }
  const ohneTyp = bauteile.filter((b) => !b.tuertyp_id).length;

  const stammFertig = Boolean(o.adresse && o.betreiber && o.zugang);
  const bestandFertig = bauteile.length > 0;
  const typenFertig = bestandFertig && typen.length > 0 && ohneTyp === 0;

  /* ── 1. Liegenschaft ────────────────────────────────────────────────────── */
  const eins = schritt(
    1,
    "Die Liegenschaft",
    stammFertig,
    "Was für alle Türen dieses Hauses gleich ist — und der Satz, der die vergebliche Anfahrt verhindert.",
    `<form class="karte" method="post" action="/objekt/${esc(o.id)}">
<input type="hidden" name="zurueck" value="einrichten">
${textfeld("adresse", "Adresse", o.adresse, "placeholder=\"Straße Hausnummer, PLZ Ort\"")}
${textfeld("betreiber", "Betreiber", o.betreiber, "placeholder=\"steht so im Protokoll\"")}
${textfeld("betreiber_kontakt", "Ansprechpartner vor Ort", o.betreiber_kontakt)}
${textfeld("telefon", "Telefon", o.telefon)}
${textfeld("zugang", "Wie kommt man rein?", o.zugang, "placeholder=\"Schlüssel beim Hausmeister\"")}
${textfeld("intervall_monate", "Wartung alle … Monate", String(o.intervall_monate), "type=\"number\" min=\"1\" max=\"120\"")}
<div class="knopfleiste"><button class="btn schmal" type="submit">Speichern</button></div>
</form>`,
  );

  /* ── 2. Die Türen ───────────────────────────────────────────────────────── */
  const zwei = schritt(
    2,
    "Die Türen",
    bestandFertig,
    bestandFertig
      ? `${bauteile.length} ${bauteile.length === 1 ? "Tür" : "Türen"} im Bestand${
          geschosse.length > 1 ? `, ${geschosse.length} Geschosse` : ""
        }.${ohneTyp ? ` ${ohneTyp} davon noch ohne Türtyp.` : ""}`
      : "Der Bestand entsteht am schnellsten aus der Türenliste des Bauvorhabens.",
    bestandFertig
      ? `<div class="liste">${bauteile
          .slice(0, 8)
          .map(
            (b) => `<a class="posten" href="/objekt/${esc(o.id)}/bauteil/${b.nr}">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(
              [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") ||
                "ohne Ortsangabe",
            )}</div>
<div class="unter">${esc(VORLAGEN[b.art]?.label ?? b.art)}${
              b.kennung ? ` · ${esc(b.kennung)}` : ""
            }</div></div></a>`,
          )
          .join("")}</div>
${
  bauteile.length > 8
    ? `<p class="meta" style="margin-top:10px">… und ${bauteile.length - 8} weitere. <a href="/objekt/${esc(
        o.id,
      )}">Ganzer Bestand</a></p>`
    : ""
}`
      : `<div class="karte">
<p style="margin:0 0 12px">Sag es Claude im Chat, mit der Datei im Anhang:</p>
<div class="urlbar"><input readonly value="Hier ist die Türenliste für ${esc(
          o.name,
        )} — lies sie ein." onclick="this.select()"></div>
<p class="meta" style="margin-top:12px">Claude liest die Liste, legt Türtypen und Geschosse dabei
selbst an und fragt einmal nach, bevor daraus Türen werden. Ein ganzes Haus dauert so ein paar
Minuten statt eines Nachmittags.</p>
</div>
<div class="knopfleiste"><a class="btn schmal leise" href="/objekt/${esc(
          o.id,
        )}/erfassen">Erste Tür von Hand</a></div>`,
  );

  /* ── 3. Türtypen und Checkliste ─────────────────────────────────────────── */
  const drei = schritt(
    3,
    "Türtypen und Checkliste",
    typenFertig,
    "Ein Türtyp trägt, was sich bei jeder Tür seiner Art wiederholt — und bringt die Checkliste mit, die vor Ort abgearbeitet wird.",
    `<div class="ebenen">
<div class="ebene"><b>Konstant — am Objekt</b><span>Adresse, Betreiber, Rechtsgrundlagen, Intervall. Einmal gesetzt, steht auf jedem Bericht dieses Hauses.</span></div>
<div class="ebene"><b>Wiederholt — am Türtyp</b><span>Hersteller, Zulassung, die Prüfpunkte. Gilt für jede Tür dieser Art, auch in anderen Objekten.</span></div>
<div class="ebene"><b>Variabel — an der Tür</b><span>Ident-Nummer, Raum, Etage, das Ergebnis. Steht nur an dieser einen Tür.</span></div>
</div>
${
  typen.length
    ? `<div class="liste">${typen
        .map((t) => {
          const zahl = bauteile.filter((b) => b.tuertyp_id === t.id).length;
          const punkte = t.punkte.filter((p) => p.aktiv).length;
          return `<a class="posten" href="/checkliste/${esc(t.id)}">
<div class="haupt"><div class="name">${esc(t.name)}</div>
<div class="unter">${zahl} ${zahl === 1 ? "Tür" : "Türen"} · ${punkte} Prüfpunkte${
            t.pflicht.length ? ` · je Tür: ${esc(t.pflicht.join(", "))}` : ""
          }</div></div>
<span class="chip">Checkliste</span></a>`;
        })
        .join("")}</div>`
    : `<div class="leer">Noch kein Türtyp — er entsteht, sobald die erste Tür einen bekommt.</div>`
}
<div class="knopfleiste"><a class="btn schmal leise" href="/stammdaten">Türtypen verwalten</a></div>`,
  );

  const fertig = stammFertig && bestandFertig && typenFertig;
  const abschluss = fertig
    ? `<div class="naechster" style="margin-top:34px">
<p class="satz">Das Objekt ist eingerichtet. Die Laufliste ist das, was vor Ort abgearbeitet wird.</p>
<div class="knopfleiste" style="margin:0"><a class="btn schmal" href="/objekt/${esc(
        o.id,
      )}/liste">Laufliste ansehen</a></div></div>`
    : `<div class="naechster" style="margin-top:34px">
<p class="satz">Noch offen: ${esc(
        [
          !stammFertig && "die Liegenschaft",
          !bestandFertig && "der Bestand",
          bestandFertig && !typenFertig && "die Türtypen",
        ]
          .filter(Boolean)
          .join(", "),
      )}.</p></div>`;

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow">Einrichten</div>
<h1 class="seite" style="margin-top:8px">${esc(o.name)}</h1>
<p class="meta" style="margin-top:8px">Einmal vorher, dann läuft die Wartung von selbst.</p></div>
<div><a class="btn schmal leise" href="/objekt/${esc(o.id)}">Zum Objekt</a></div></div>
${meldung ? `<div class="stand">${esc(meldung)}</div>` : ""}
${eins}
${zwei}
${drei}
${abschluss}`,
    { titel: `Einrichten ${o.name}`, nutzer, aktiv: "objekte", stil: CSS },
  );
}

/**
 * Die Laufliste — die Checkliste, die bei der Wartung durchgegangen wird.
 *
 * In Laufreihenfolge, Geschoss für Geschoss, je Tür ihre Prüfpunkte. Zum Lesen am Handy und
 * zum Ausdrucken; wer sie einmal gesehen hat, weiß, was ihn erwartet, und diktiert danach.
 */
export async function lauflisteSeite(
  env: Env,
  nutzer: Nutzer,
  objektId: string,
): Promise<Response> {
  const o = await objektLesen(env.DB, objektId);
  if (!o) return umleitung("/objekte");
  const geschosse = await geschosseListe(env.DB, o.id);
  const bauteile = inLaufreihenfolge(await bauteileMitStand(env.DB, o), geschosse);
  const geschossName = new Map(geschosse.map((g) => [g.id, g.name]));

  const typen = new Map<string, Tuertyp>();
  for (const id of [...new Set(bauteile.map((b) => b.tuertyp_id).filter(Boolean))] as string[]) {
    const t = await tuertypLesen(env.DB, id);
    if (t) typen.set(id, t);
  }

  /* Je Türtyp einmal die Punkte, nicht je Tür — sonst steht dieselbe Liste vierzigmal da. */
  const legende = [...typen.values()]
    .map(
      (t) => `<div class="ebene"><b>${esc(t.name)}</b><span>${t.punkte
        .filter((p) => p.aktiv)
        .map((p) => `${p.nr} ${esc(p.text)}`)
        .join(" · ")}</span></div>`,
    )
    .join("");

  let letztes = " ";
  const zeilen = bauteile
    .map((b) => {
      const g = geschossName.get(b.geschoss_id ?? "") ?? "";
      const kopf = g !== letztes ? `<h3 class="unterabschnitt">${esc(g || "ohne Geschoss")}</h3>` : "";
      letztes = g;
      const typ = b.tuertyp_id ? typen.get(b.tuertyp_id) : null;
      return `${kopf}<div class="posten">
<span class="nr">${b.nr}</span>
<div class="haupt"><div class="name">${esc(
        [b.raumnummer, b.raum || b.bezeichnung, b.flur].filter(Boolean).join(" · ") ||
          "ohne Ortsangabe",
      )}</div>
<div class="unter">${esc(typ?.name ?? VORLAGEN[b.art]?.label ?? b.art)}${
        b.kennung ? ` · ${esc(b.kennung)}` : ""
      }${b.letzte_pruefung ? ` · zuletzt ${esc(b.letzte_pruefung)}` : " · noch nie geprüft"}</div></div>
${
  b.letztes_ergebnis === "Nachbesserung"
    ? '<span class="chip mangel">war nicht i.O.</span>'
    : ""
}</div>`;
    })
    .join("");

  return seite(
    `<div class="zeile oben"><div>
<div class="eyebrow">Laufliste</div>
<h1 class="seite" style="margin-top:8px">${esc(o.name)}</h1>
<p class="meta" style="margin-top:8px">${bauteile.length} ${
      bauteile.length === 1 ? "Tür" : "Türen"
    } in Laufreihenfolge${o.zugang ? ` · ${esc(o.zugang)}` : ""}</p></div>
<div><a class="btn schmal leise" href="/objekt/${esc(o.id)}">Zum Objekt</a></div></div>
${zeilen ? `<div class="liste">${zeilen}</div>` : '<div class="leer">Noch kein Bestand.</div>'}
${legende ? `<h2 class="abschnitt">Was geprüft wird</h2><div class="ebenen">${legende}</div>` : ""}`,
    { titel: `Laufliste ${o.name}`, nutzer, aktiv: "objekte", stil: CSS },
  );
}
