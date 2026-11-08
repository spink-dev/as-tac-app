import { describe, expect, it } from 'vitest';
import { areaErrorText } from '../../src/features/areas/areaErrors';

describe('area error messages', () => {
    it('only blames the connection for connection problems', () => {
        expect(areaErrorText(new TypeError('Failed to fetch'))).toMatch(/Verbindung|connection/);
        expect(areaErrorText(Object.assign(new Error('Transaction aborted'), { name: 'AbortError' }))).not.toMatch(/Verbindung|connection/);
        expect(areaErrorText(new SyntaxError("Unexpected token '<'"), 8, 12)).toMatch(/Server.*8.*12|server.*8.*12/s);
        expect(areaErrorText('HTTP 404')).toMatch(/abgelehnt|refused/);
        expect(areaErrorText('stalled')).toMatch(/Verbindung|connection/);
        expect(areaErrorText('The quota has been exceeded.')).toMatch(/Speicher|storage/);
        expect(areaErrorText('DatabaseClosedError')).not.toMatch(/Verbindung|connection/);
        expect(areaErrorText('area-unknown')).not.toMatch(/Verbindung|connection/);
        expect(areaErrorText('HTTP 503')).not.toMatch(/OSM/);
        expect(areaErrorText('overpass-incomplete')).toMatch(/OSM/);
        expect(areaErrorText('rate-limit:12')).toMatch(/12/);
        expect(areaErrorText('stalled', 3, 9)).toMatch(/3.*9/);
    });
});
