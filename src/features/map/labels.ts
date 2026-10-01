import type { Map as LibreMap } from 'maplibre-gl';
import { symbolNode } from '../editor/presentation';

const NS = 'http://www.w3.org/2000/svg';
export type LabelOptions = { roads: boolean; places: boolean };
const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
/** Bounded, viewport-only SVG labels keep system fonts available offline. */
export function installLabels(map: LibreMap, data: GeoJSON.FeatureCollection, initial: LabelOptions) {
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('basemap-labels');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(NS, 'defs');
    svg.append(defs);
    map.getContainer().append(svg);
    let options = initial;
    let frame = 0;
    const prefix = `roads-${crypto.randomUUID()}`;
    type Nodes = { text: SVGTextElement; path?: SVGPathElement; icon?: SVGSVGElement };
    const nodes = new Map<number, Nodes>();
    const labels = data.features
        .flatMap((feature, id) => {
            const p = feature.properties ?? {};
            const road = feature.geometry.type === 'LineString' && !!p.highway;
            if (typeof p.name !== 'string' || !p.name.trim() || (!road && feature.geometry.type !== 'Point')) {
                return [];
            }
            const coordinates = road
                ? (feature.geometry as GeoJSON.LineString).coordinates
                : [(feature.geometry as GeoJSON.Point).coordinates];
            const xs = coordinates.map((point) => point[0]);
            const ys = coordinates.map((point) => point[1]);
            const major = road && majorRoads.has(p.highway);
            const aid = ['hospital', 'clinic', 'doctors', 'pharmacy'].includes(p.amenity);
            return [
                {
                    id,
                    name: p.name,
                    coordinates,
                    road,
                    minZoom: major ? 13 : road ? 15 : 16,
                    priority: major ? 3 : aid ? 2 : road ? 1 : 0,
                    symbol: aid ? 'aid' : ['school', 'university', 'college'].includes(p.amenity) ? 'building' : 'pin',
                    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
                },
            ];
        })
        .sort((a, b) => b.priority - a.priority || b.coordinates.length - a.coordinates.length);
    function makeNodes(label: (typeof labels)[number]): Nodes {
        const text = document.createElementNS(NS, 'text');
        text.classList.add(label.road ? 'road-name' : 'place-name');
        text.setAttribute('text-anchor', label.road ? 'middle' : 'start');
        text.setAttribute('dominant-baseline', 'central');
        let path: SVGPathElement | undefined;
        let icon: SVGSVGElement | undefined;
        if (label.road) {
            path = document.createElementNS(NS, 'path');
            path.id = `${prefix}-${label.id}`;
            defs.append(path);
            const along = document.createElementNS(NS, 'textPath');
            along.setAttribute('href', `#${path.id}`);
            along.setAttribute('startOffset', '50%');
            along.textContent = label.name;
            text.append(along);
        } else {
            text.textContent = label.name;
            icon = symbolNode(label.symbol);
            icon.classList.add('place-icon');
            icon.setAttribute('width', '16');
            icon.setAttribute('height', '16');
            svg.append(icon);
        }
        svg.append(text);
        return { text, path, icon };
    }
    function render() {
        frame = 0;
        const width = map.getContainer().clientWidth;
        const height = map.getContainer().clientHeight;
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const occupied: { x: number; y: number; width: number; height: number }[] = [];
        const names = new Set<string>();
        const active = new Set<number>();
        for (const label of labels) {
            if (active.size >= 180) {
                break;
            }
            const b = label.bounds;
            if (
                zoom < label.minZoom ||
                (label.road ? !options.roads : !options.places) ||
                names.has(label.name) ||
                b[2] < bounds.getWest() ||
                b[0] > bounds.getEast() ||
                b[3] < bounds.getSouth() ||
                b[1] > bounds.getNorth()
            ) {
                continue;
            }
            const node = nodes.get(label.id) ?? makeNodes(label);
            nodes.set(label.id, node);
            active.add(label.id);
            node.text.style.visibility = 'hidden';
            if (node.icon) {
                node.icon.style.visibility = 'hidden';
            }
            const points = label.coordinates.map(([lng, lat]) => map.project([lng, lat]));
            if (node.path) {
                if (points.at(-1)!.x < points[0].x) {
                    points.reverse();
                }
                node.path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '));
                const length = node.path.getTotalLength();
                const textLength = node.text.getComputedTextLength();
                if (length < textLength + 32) {
                    continue;
                }
                const start = (length - textLength) / 2;
                let previous: number | null = null;
                let turn = 0;
                for (let offset = start; offset < start + textLength; offset += 8) {
                    const a = node.path.getPointAtLength(offset);
                    const b = node.path.getPointAtLength(Math.min(offset + 8, length));
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
                node.text.setAttribute('x', String(points[0].x + 12));
                node.text.setAttribute('y', String(points[0].y));
                node.icon!.setAttribute('x', String(points[0].x - 8));
                node.icon!.setAttribute('y', String(points[0].y - 8));
            }
            const textBox = node.text.getBBox();
            const box = {
                x: textBox.x - (node.icon ? 22 : 0),
                y: textBox.y,
                width: textBox.width + (node.icon ? 22 : 0),
                height: Math.max(16, textBox.height),
            };
            if (
                !box.width ||
                box.x < 12 ||
                box.y < 90 ||
                box.x + box.width > width - 55 ||
                box.y + box.height > height - 90 ||
                occupied.some(
                    (other) =>
                        box.x < other.x + other.width + 12 &&
                        box.x + box.width + 12 > other.x &&
                        box.y < other.y + other.height + 8 &&
                        box.y + box.height + 8 > other.y,
                )
            ) {
                continue;
            }
            node.text.style.visibility = 'visible';
            if (node.icon) {
                node.icon.style.visibility = 'visible';
            }
            occupied.push(box);
            names.add(label.name);
        }
        for (const [id, node] of nodes) {
            if (!active.has(id)) {
                node.text.remove();
                node.path?.remove();
                node.icon?.remove();
                nodes.delete(id);
            }
        }
    }
    function schedule() {
        if (!frame) {
            frame = requestAnimationFrame(render);
        }
    }
    map.on('move', schedule);
    map.on('resize', schedule);
    render();
    return {
        update(next: LabelOptions) {
            options = next;
            schedule();
        },
        destroy() {
            cancelAnimationFrame(frame);
            map.off('move', schedule);
            map.off('resize', schedule);
            svg.remove();
        },
    };
}
