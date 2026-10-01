import type { Map as LibreMap } from 'maplibre-gl';

const NS = 'http://www.w3.org/2000/svg';
export type LabelOptions = { roads: boolean; places: boolean };
/** System-font SVG text paths preserve offline rendering without external glyph requests. */
export function installLabels(map: LibreMap, data: GeoJSON.FeatureCollection, initial: LabelOptions) {
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('basemap-labels');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(NS, 'defs');
    svg.append(defs);
    map.getContainer().append(svg);
    let options = initial;
    const prefix = `roads-${crypto.randomUUID()}`;
    const labels: { text: SVGTextElement; path?: SVGPathElement; coordinates: number[][]; name: string }[] = [];
    for (const feature of data.features) {
        const name = feature.properties?.name;
        const road = feature.geometry.type === 'LineString' && feature.properties?.highway;
        if (typeof name !== 'string' || !name.trim() || (!road && feature.geometry.type !== 'Point')) {
            continue;
        }
        const text = document.createElementNS(NS, 'text');
        text.classList.add(road ? 'road-name' : 'place-name');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        let path: SVGPathElement | undefined;
        if (road) {
            path = document.createElementNS(NS, 'path');
            path.id = `${prefix}-${labels.length}`;
            defs.append(path);
            const along = document.createElementNS(NS, 'textPath');
            along.setAttribute('href', `#${path.id}`);
            along.setAttribute('startOffset', '50%');
            along.textContent = name;
            text.append(along);
        } else {
            text.textContent = name;
        }
        svg.append(text);
        labels.push({ text, path, name, coordinates: road ? (feature.geometry as GeoJSON.LineString).coordinates : [(feature.geometry as GeoJSON.Point).coordinates] });
    }
    function render() {
        const width = map.getContainer().clientWidth;
        const height = map.getContainer().clientHeight;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const occupied: { x: number; y: number; width: number; height: number }[] = [];
        const names = new Set<string>();
        for (const label of labels) {
            label.text.style.visibility = 'hidden';
            if ((label.path ? !options.roads : !options.places) || names.has(label.name)) {
                continue;
            }
            const points = label.coordinates.map(([lng, lat]) => map.project([lng, lat]));
            if (label.path) {
                // Read left-to-right, including when the map is rotated.
                if (points.at(-1)!.x < points[0].x) {
                    points.reverse();
                }
                label.path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '));
                const length = label.path.getTotalLength();
                const textLength = label.text.getComputedTextLength();
                if (length < textLength + 32) {
                    continue;
                }
                // Reject tight bends under the label rather than folding letters around a corner.
                const start = (length - textLength) / 2;
                let previous: number | null = null;
                let turn = 0;
                for (let offset = start; offset < start + textLength; offset += 8) {
                    const a = label.path.getPointAtLength(offset);
                    const b = label.path.getPointAtLength(Math.min(offset + 8, length));
                    const angle = Math.atan2(b.y - a.y, b.x - a.x);
                    if (previous !== null) {
                        turn += Math.abs(Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous)));
                    }
                    previous = angle;
                }
                if (turn > Math.PI / 3) {
                    continue;
                }
            } else {
                label.text.setAttribute('x', String(points[0].x));
                label.text.setAttribute('y', String(points[0].y));
            }
            const box = label.text.getBBox();
            if (!box.width || box.x < 12 || box.y < 90 || box.x + box.width > width - 55 || box.y + box.height > height - 90
                || occupied.some((other) => box.x < other.x + other.width + 12 && box.x + box.width + 12 > other.x
                    && box.y < other.y + other.height + 8 && box.y + box.height + 8 > other.y)) {
                continue;
            }
            label.text.style.visibility = 'visible';
            occupied.push(box);
            names.add(label.name);
        }
    }
    map.on('move', render);
    map.on('resize', render);
    render();
    return {
        update(next: LabelOptions) {
            options = next;
            render();
        },
        destroy() {
            map.off('move', render);
            map.off('resize', render);
            svg.remove();
        },
    };
}
