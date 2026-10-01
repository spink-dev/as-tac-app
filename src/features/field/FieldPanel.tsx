import { useMemo, useState } from 'react';
import type { FieldNavigation } from './useFieldNavigation';
import { trackGeoJSON } from './navigation';
import { distance } from '../editor/geometry';
export default function FieldPanel({
    navigation: n,
    onSave,
}: {
    navigation: FieldNavigation;
    onSave?: (segments: number[][][]) => boolean;
}) {
    const [exported, setExported] = useState('');
    const track = useMemo(() => trackGeoJSON(n.segments), [n.segments]);
    const length = useMemo(
        () =>
            track.features.reduce((sum, feature) => {
                const points = (feature.geometry as GeoJSON.LineString).coordinates;
                return (
                    sum + points.slice(1).reduce((total, p, i) => total + distance(points[i] as [number, number], p as [number, number]), 0)
                );
            }, 0),
        [track],
    );
    return (
        <section className="field-tools" aria-label="Geländeaufnahme">
            <h2>Im Gelände</h2>
            <details>
                <summary>Kartenzeichen</summary>
                <p>
                    Flagge: HQ / Vorposten · Schild mit diagonaler Schraffur ↗: Safe Zone · Dreieck: Gefahr · Gebäude: Ort / Gebäude ·
                    Kreuz: Erste Hilfe. Gebäudedetails erscheinen beim Näherzoomen.
                </p>
            </details>
            <output aria-label="GPS-Geschwindigkeit">
                {n.fresh && n.fix?.speed != null ? `${(n.fix.speed * 3.6).toFixed(1)} km/h · GPS` : 'Geschwindigkeit nicht verfügbar'}
            </output>
            <details>
                <summary>Bewegungssensoren</summary>
                <p>{n.motion.status}</p>
                <p className="muted">
                    Erkennt Gerätebewegung beim Standortabgleich. Geschwindigkeit kommt vom GPS, nicht aus aufintegrierter Beschleunigung.
                </p>
                <button onClick={() => (n.motion.enabled ? n.motion.stop() : void n.motion.start())}>
                    {n.motion.enabled ? 'Sensoren ausschalten' : 'Sensoren freigeben'}
                </button>
            </details>
            <details>
                <summary>Pfad aufnehmen</summary>
                <p>Nur bewusst gestartete Aufnahmen. Bis zum Export nur im Arbeitsspeicher; keine Übertragung.</p>
                <output>
                    {n.count} Messpunkte · {Math.round(length)} m · {n.recording ? 'Aufnahme läuft' : 'Pausiert'}
                </output>
                {!n.fresh && <p>Frisches GPS mit höchstens ±25 m nötig. Ungenaue Abschnitte werden nicht verbunden.</p>}
                <div className="actions">
                    <button
                        disabled={!n.recording && (!n.fresh || n.picking || !!n.target || n.count >= 5000)}
                        onClick={() => {
                            if (n.recording) {
                                n.pause();
                            } else {
                                setExported('');
                                n.start();
                            }
                        }}
                    >
                        {n.recording ? 'Aufnahme pausieren' : n.count ? 'Aufnahme fortsetzen' : 'Pfadaufnahme starten'}
                    </button>
                    <button
                        disabled={n.recording || !track.features.length}
                        onClick={() => {
                            const url = URL.createObjectURL(new Blob([JSON.stringify(track)], { type: 'application/geo+json' }));
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = 'as-tac-pfad.geojson';
                            link.click();
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                            setExported(
                                'GeoJSON-Datei erstellt. Datei lokal behalten; die Aufnahme bleibt bis zum Verwerfen hier sichtbar.',
                            );
                        }}
                    >
                        Pfad als GeoJSON speichern
                    </button>
                    {onSave && (
                        <button
                            disabled={n.recording || !track.features.length}
                            onClick={() => {
                                if (onSave(track.features.map((feature) => (feature.geometry as GeoJSON.LineString).coordinates))) {
                                    n.discard('Pfad als Planlinien übernommen.');
                                    setExported('Planlinien übernommen. Projekt-Speicherstatus beachten.');
                                } else {
                                    setExported(
                                        'Übernahme nicht möglich. Projektgrenzen und Speicherstatus prüfen; Aufnahme bleibt erhalten.',
                                    );
                                }
                            }}
                        >
                            Als Planlinien übernehmen
                        </button>
                    )}
                    <button
                        disabled={!n.count && !n.recording}
                        onClick={() => {
                            n.discard();
                            setExported('');
                        }}
                    >
                        Aufnahme verwerfen
                    </button>
                </div>
                {exported && <p role="status">{exported}</p>}
                <p className="muted">
                    Karte zeigt die GPS-Spur, keine vermessene Wegbreite. Bildschirm im Vordergrund halten; bei App-Wechsel pausiert die
                    Aufnahme. Standortversatz verändert diese Rohspur nicht.
                </p>
            </details>
            <details>
                <summary>Standort abgleichen · {n.references.length}/3 Punkte</summary>
                <p>
                    An einem eindeutig bekannten Ort stehen bleiben, Punkt auf der Karte wählen und Messungen übernehmen. Optional an zwei
                    weiteren Orten prüfen.
                </p>
                <div className="actions">
                    <button
                        disabled={!n.fresh || n.recording || n.references.length >= 3 || n.picking || !!n.target}
                        data-map-pick
                        onClick={n.pick}
                    >
                        Standort auf Karte wählen
                    </button>
                    {(n.picking || n.target) && <button onClick={n.cancelPoint}>Punkt abbrechen</button>}
                    {n.target && (
                        <button disabled={n.samples.length < 5 || !n.fresh} onClick={n.acceptReference}>
                            Kontrollpunkt übernehmen ({n.samples.length}/5)
                        </button>
                    )}
                </div>
                {n.fit && (
                    <>
                        <output>
                            {n.references.length} Kontrollpunkt{n.references.length > 1 ? 'e' : ''} · Streuung {n.fit.residual.toFixed(1)} m
                        </output>
                        <p>
                            {n.corrected
                                ? 'Lokaler Versatz aktiv · ursprüngliches GPS zusätzlich als türkisfarbener Punkt'
                                : 'GPS unverändert'}
                        </p>
                        <button disabled={!n.fresh || !!n.target || n.picking || n.recording} onClick={n.apply}>
                            Versatz für diese Sitzung verwenden
                        </button>
                        <button onClick={n.reset}>Abgleich zurücksetzen</button>
                    </>
                )}
                <p className="muted">
                    Ein Punkt korrigiert nur einen Versatz. Zwei oder drei Punkte prüfen dessen Konsistenz; sie beweisen keine absolute
                    Genauigkeit. Keine Verzerrung der WGS84-Karte, keine Positionsfortschreibung bei GPS-Ausfall. Verfällt nach 10 Minuten
                    oder 500 m.
                </p>
            </details>
            {n.message && <p role="status">{n.message}</p>}
        </section>
    );
}
