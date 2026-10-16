import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  Source,
  Layer,
  Popup,
  Marker,
  NavigationControl,
} from 'react-map-gl/maplibre';
import type {
  ErrorEvent as MapErrorEvent,
  MapLayerMouseEvent,
  MapRef,
  MapSourceDataEvent,
} from 'react-map-gl/maplibre';
import { addProtocol } from 'maplibre-gl';
import type { LayerSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, X } from 'lucide-react';
import type { ColorMode, FocusTarget, LsoaProps } from './types';
import {
  COMPONENT_LABELS,
  gbp,
  ordinalPct,
  RAMP,
  QUINTILE_FILL,
  NO_DATA_COLOR,
  quintileColor,
  quintilePremiumBands,
  premiumToRampPos,
  QUINTILE_TEXT,
  tapFeedback,
  areasLabel,
} from './utils';
import { dataUrl, tilesUrl } from './api';
import { fitPadding, TOUCH_QUERY, useMediaQuery } from './layout';
import { AREA_STYLE, BASEMAP_STYLE, cssToken, DARK_QUERY } from './theme';

interface MapViewProps {
  geojson: FeatureCollection | null;
  loadError: string | null;
  loadedBytes: number;
  colorMode: ColorMode;
  focus: FocusTarget | null;
  marker: [number, number] | null;
  hoveredLsoa: string | null;
  selectedLsoa: string | null;
  /** The second area of a comparison (?area2=), outlined dashed. */
  compareLsoa: string | null;
  /** "Compare with…" is armed: the next tap or search picks the second area. */
  comparing: boolean;
  nationalAvg?: number;
  onHover: (lsoa: string | null) => void;
  onClick: (lsoa: string) => void;
  onResetFilter: () => void;
  onShowDetails: () => void;
}

// First paint: the committed PMTiles archive (layer `lsoa`, every areas.geojson
// attribute) colours the map from a few range requests, long before the GeoJSON
// download ends. At zoom 4 to 8 the tiles thin out dense cities, so they are
// never interactive and are hidden once the GeoJSON is drawn; see
// docs/superpowers/specs/2026-10-15-pmtiles-first-paint.md.
addProtocol('pmtiles', new Protocol().tile);
const TILES_URL = tilesUrl(dataUrl('lsoa-risk.pmtiles'), window.location.href);

type FillPaint = NonNullable<Extract<LayerSpecification, { type: 'fill' }>['paint']>;

// Discrete quintiles for the composite; a continuous percentile ramp per driver.
function fillColor(mode: ColorMode): FillPaint['fill-color'] {
  if (mode === 'composite') {
    return [
      'match',
      ['to-number', ['coalesce', ['get', 'quintile'], ['get', 'risk_bucket'], 0]],
      1, QUINTILE_FILL[0],
      2, QUINTILE_FILL[1],
      3, QUINTILE_FILL[2],
      4, QUINTILE_FILL[3],
      5, QUINTILE_FILL[4],
      NO_DATA_COLOR,
    ];
  }
  const pctField = `${mode}_pct`;
  return [
    'case',
    ['==', ['coalesce', ['get', pctField], -1], -1],
    NO_DATA_COLOR,
    [
      'interpolate',
      ['linear'],
      ['to-number', ['coalesce', ['get', pctField], 0]],
      0, RAMP[0],
      33, RAMP[2],
      50, RAMP[3],
      67, RAMP[4],
      100, RAMP[6],
    ],
  ];
}

// Touch devices have no hover: a tap shows this compact card instead.
interface TapInfo {
  lng: number;
  lat: number;
  lsoa: string;
  lsoaName: string;
  premium: string;
  swatch: string;
}

interface HoverInfo {
  lng: number;
  lat: number;
  lsoa: string;
  lsoaName: string;
  quintile: number;
  metricLabel: string;
  metricValue: string;
  swatch: string;
  extra: string | null;
}

/** The map's accessible name, with the keyboard hint (also on MapLibre's canvas,
 *  which is what holds focus). */
const MAP_LABEL =
  'Map of estimated car-insurance premiums. Arrow keys pan, plus and minus zoom, Enter selects the area at the centre.';

export const MapView: React.FC<MapViewProps> = ({
  geojson,
  loadError,
  loadedBytes,
  colorMode,
  focus,
  marker,
  selectedLsoa,
  compareLsoa,
  comparing,
  nationalAvg,
  onHover,
  onClick,
  onResetFilter,
  onShowDetails,
}) => {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [tapInfo, setTapInfo] = useState<TapInfo | null>(null);
  // A tap that landed before the areas could answer it (see tapFeedback).
  const [tapNote, setTapNote] = useState<string | null>(null);
  // MapLibre's worker fetches and tiles the GeoJSON itself (from the HTTP cache the
  // app's own fetch just filled), so the areas appear a moment after the panel.
  // A basemap switch (light/dark) reloads the style and re-tiles the areas, so
  // "drawn" is tracked per basemap.
  const [drawnOn, setDrawnOn] = useState<string | null>(null);
  const [areasError, setAreasError] = useState(false);
  // MapLibre adds `sourceId` to errors raised while loading a source.
  const onMapError = useCallback((e: MapErrorEvent) => {
    if ((e as MapErrorEvent & { sourceId?: string }).sourceId === 'lsoa') setAreasError(true);
  }, []);
  const isTouch = useMediaQuery(TOUCH_QUERY);
  const isDark = useMediaQuery(DARK_QUERY);
  // Basemap per scheme; outline colours come from index.css tokens, re-read when it flips.
  const mapColors = useMemo(
    () => ({
      basemap: isDark ? BASEMAP_STYLE.dark : BASEMAP_STYLE.light,
      areaLine: cssToken('--map-area-line', '#fbf7f0'),
      selected: cssToken('--map-selected', '#24211c'),
      compare: cssToken('--map-compare', '#1f5f8b'),
    }),
    [isDark]
  );
  const areasDrawn = drawnOn === mapColors.basemap;
  // Once the areas are drawn a tap answers itself, so the note goes.
  const shownTapNote = areasDrawn ? null : tapNote;
  // The streamed tiles, tracked per basemap the same way.
  const [tilesOn, setTilesOn] = useState<string | null>(null);
  const tilesDrawn = tilesOn === mapColors.basemap;
  const onSourceData = useCallback(
    (e: MapSourceDataEvent) => {
      if (!e.isSourceLoaded) return;
      if (e.sourceId === 'lsoa') setDrawnOn(mapColors.basemap);
      if (e.sourceId === 'lsoa-tiles') setTilesOn(mapColors.basemap);
    },
    [mapColors.basemap]
  );

  const lookup = useMemo(() => {
    const m = new Map<string, Feature>();
    if (geojson) {
      for (const f of geojson.features) {
        m.set(String((f.properties as LsoaProps | null)?.lsoa11cd), f);
      }
    }
    return m;
  }, [geojson]);
  const bands = useMemo(() => quintilePremiumBands(lookup), [lookup]);

  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map) return;
    if (focus.bounds) {
      // The phone sheet may have just changed size: measure the map first.
      map.resize();
      const el = map.getContainer();
      const padding = fitPadding(el.clientWidth, el.clientHeight, window.innerWidth);
      // Cap the zoom: the static geometry is simplified to ~180 m, so zooming in
      // tight on one small area exposes coarse polygons — keep some context.
      map.fitBounds(focus.bounds, { padding, maxZoom: 11, duration: 1100 });
    } else if (focus.center) {
      map.resize();
      map.flyTo({ center: focus.center, zoom: 11, duration: 1100 });
    }
  }, [focus]);

  const setHover = (id: number | null, on: boolean) => {
    if (id == null || !mapRef.current) return;
    mapRef.current.setFeatureState({ source: 'lsoa', id }, { hover: on });
  };

  const readHover = useCallback(
    (props: LsoaProps): { label: string; value: string; extra: string | null } => {
      if (colorMode === 'composite') {
        return {
          label: 'Est. premium',
          value: props.calibrated_premium != null ? gbp(Number(props.calibrated_premium)) : '—',
          extra: null,
        };
      }
      const pct = props[`${colorMode}_pct`];
      const label = COMPONENT_LABELS[colorMode] || colorMode;
      if (pct == null) return { label, value: 'no data', extra: null };
      return {
        label,
        value: `${ordinalPct(Number(pct))} pct`,
        extra: props.calibrated_premium != null ? `${gbp(Number(props.calibrated_premium))} premium` : null,
      };
    },
    [colorMode]
  );

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) {
        const props = f.properties as LsoaProps;
        // generateId on the source gives every feature a numeric id.
        const id = f.id as number;
        if (hoveredId !== id) {
          setHover(hoveredId, false);
          setHover(id, true);
          setHoveredId(id);
          onHover(props.lsoa11cd);
        }
        const { label, value, extra } = readHover(props);
        const q = Number(props.quintile);
        setHoverInfo({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          lsoa: props.lsoa11cd,
          lsoaName: props.lsoa_name || props.lsoa11cd,
          quintile: q,
          metricLabel: label,
          metricValue: value,
          swatch: quintileColor(q),
          extra,
        });
      } else if (hoveredId !== null) {
        setHover(hoveredId, false);
        setHoveredId(null);
        setHoverInfo(null);
        onHover(null);
      }
    },
    [hoveredId, onHover, readHover]
  );

  const onMouseLeave = useCallback(() => {
    setHover(hoveredId, false);
    setHoveredId(null);
    setHoverInfo(null);
    onHover(null);
  }, [hoveredId, onHover]);

  // One selection path for a tap, a click and Enter on the focused map.
  const selectAt = useCallback(
    (props: LsoaProps, lng: number, lat: number) => {
      if (isTouch) {
        const q = Number(props.quintile);
        setTapInfo({
          lng,
          lat,
          lsoa: props.lsoa11cd,
          lsoaName: String(props.lsoa_name || props.lsoa11cd),
          premium: gbp(props.calibrated_premium == null ? null : Number(props.calibrated_premium)),
          swatch: quintileColor(q),
        });
      }
      onClick(props.lsoa11cd);
    },
    [onClick, isTouch]
  );

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) {
        setTapInfo(null);
        setTapNote(tapFeedback(areasDrawn, tilesDrawn, loadedBytes));
        return;
      }
      selectAt(f.properties as LsoaProps, e.lngLat.lng, e.lngLat.lat);
    },
    [selectAt, areasDrawn, tilesDrawn, loadedBytes]
  );

  // Keyboard: MapLibre pans with the arrows and zooms with +/- once its canvas has
  // focus; Enter selects the area under the centre of the map, as a tap would.
  const onMapKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const map = mapRef.current;
      const canvas = map?.getCanvas();
      if (!map || e.target !== canvas || !map.getLayer('lsoa-fill')) return;
      const centre = map.project(map.getCenter());
      const f = map.queryRenderedFeatures(centre, { layers: ['lsoa-fill'] })[0];
      if (!f) return;
      e.preventDefault();
      const c = map.getCenter();
      selectAt(f.properties as LsoaProps, c.lng, c.lat);
    },
    [selectAt]
  );

  const driverLabel =
    colorMode === 'composite' ? 'Estimated annual premium' : COMPONENT_LABELS[colorMode] || colorMode;

  // The selected area's quintile, marked on the legend.
  const selectedQ = selectedLsoa
    ? Number((lookup.get(selectedLsoa)?.properties as LsoaProps | undefined)?.quintile) || null
    : null;

  // Legend ticks for the composite £ scale.
  const avgPos = nationalAvg != null && bands.length ? premiumToRampPos(nationalAvg, bands) : null;

  return (
    <main
      className="map-container"
      aria-label={MAP_LABEL}
      onKeyDown={onMapKeyDown}
    >
      {!geojson && !loadError && (
        // Once the streamed tiles have coloured the map, the skeleton steps aside
        // and only the download readout stays.
        <div className={tilesDrawn ? undefined : 'skeleton-map'}>
          {!tilesDrawn && <div className="skeleton-pulse" />}
          <div className={`map-toast${tilesDrawn ? '' : ' skeleton-toast'}`}>
            <span className="loader" aria-hidden="true" />
            {/* The live region changes only on a tap; the changing byte count is not announced. */}
            <span role="status">
              {shownTapNote ?? (loadedBytes > 0 ? 'Loading map data…' : `Plotting ${areasLabel(lookup.size)}…`)}
            </span>
            {loadedBytes > 0 && (
              <span aria-hidden="true">{(loadedBytes / 1e6).toFixed(1)} MB</span>
            )}
          </div>
        </div>
      )}
      {areasError && (
        <div className="map-toast map-toast-error" role="alert">
          The map areas could not load. Check your connection and reload the page.
        </div>
      )}
      {geojson && !areasDrawn && !loadError && !areasError && (
        <div className="map-toast">
          <span className="loader" aria-hidden="true" />
          <span role="status">
            Drawing {geojson.features.length.toLocaleString('en-GB')} areas…
          </span>
        </div>
      )}
      {loadError && <div className="map-toast map-toast-error">{loadError}</div>}
      {comparing && geojson && areasDrawn && (
        <div className="map-toast">
          <span role="status">Comparing: tap an area, or search a postcode</span>
        </div>
      )}

      {colorMode !== 'composite' && (
        <div className="filter-indicator">
          <span className="dot" />
          Colouring by {driverLabel} (percentile)
          <button onClick={onResetFilter} title="Back to premium" aria-label="Back to premium">
            <X size={13} />
          </button>
        </div>
      )}

      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: -2.5, latitude: 54.5, zoom: 5.2 }}
        mapStyle={mapColors.basemap}
        interactiveLayerIds={geojson ? ['lsoa-fill'] : []}
        onMouseMove={isTouch ? undefined : onMouseMove}
        onMouseLeave={isTouch ? undefined : onMouseLeave}
        onClick={onMapClick}
        onSourceData={onSourceData}
        onError={onMapError}
        onLoad={(e) => e.target.getCanvas().setAttribute('aria-label', MAP_LABEL)}
        cursor="default"
      >
        <NavigationControl position="top-left" showCompass={false} />

        {/* Drawn first, below the GeoJSON layers; not in interactiveLayerIds. */}
        <Source id="lsoa-tiles" type="vector" url={TILES_URL}>
          <Layer
            id="lsoa-tiles-fill"
            type="fill"
            source-layer="lsoa"
            layout={{ visibility: areasDrawn ? 'none' : 'visible' }}
            paint={{ 'fill-color': fillColor(colorMode), 'fill-opacity': AREA_STYLE.fillOpacity }}
          />
          <Layer
            id="lsoa-tiles-lines"
            type="line"
            source-layer="lsoa"
            layout={{ visibility: areasDrawn ? 'none' : 'visible' }}
            paint={{
              'line-color': mapColors.areaLine,
              'line-width': AREA_STYLE.lineWidth,
              'line-opacity': AREA_STYLE.lineOpacity,
            }}
          />
        </Source>

        {geojson && (
          <Source id="lsoa" type="geojson" data={dataUrl('areas.geojson')} generateId>
            <Layer
              id="lsoa-fill"
              type="fill"
              paint={{
                'fill-color': fillColor(colorMode),
                // Transparent until drawn, so it never tints over the tiles; then
                // the tiles hide and this takes over.
                'fill-opacity': areasDrawn
                  ? [
                      'case',
                      ['boolean', ['feature-state', 'hover'], false],
                      AREA_STYLE.fillOpacityHover,
                      AREA_STYLE.fillOpacity,
                    ]
                  : 0,
                'fill-color-transition': { duration: 350, delay: 0 },
              }}
            />
            <Layer
              id="lsoa-lines"
              type="line"
              paint={{
                'line-color': mapColors.areaLine,
                'line-width': AREA_STYLE.lineWidth,
                'line-opacity': areasDrawn ? AREA_STYLE.lineOpacity : 0,
              }}
            />
            <Layer
              id="lsoa-selected"
              type="line"
              filter={['==', ['get', 'lsoa11cd'], selectedLsoa ?? '__none__']}
              paint={{ 'line-color': mapColors.selected, 'line-width': 2.5 }}
            />
            <Layer
              id="lsoa-compare"
              type="line"
              filter={['==', ['get', 'lsoa11cd'], compareLsoa ?? '__none__']}
              paint={{
                'line-color': mapColors.compare,
                'line-width': 2.5,
                'line-dasharray': [2, 1],
              }}
            />
          </Source>
        )}

        {marker && (
          <Marker longitude={marker[0]} latitude={marker[1]} anchor="bottom">
            <div className="map-pin">
              <MapPin size={28} strokeWidth={2.5} />
            </div>
          </Marker>
        )}

        {/* Only while its area is still the selection (not after Back or a search). */}
        {isTouch && tapInfo && tapInfo.lsoa === selectedLsoa && (
          <Popup
            longitude={tapInfo.lng}
            latitude={tapInfo.lat}
            offset={10}
            closeButton={false}
            closeOnClick={false}
            className="hover-popup tap-card"
          >
            <div className="tap-card-row">
              <span className="hover-popup-name">{tapInfo.lsoaName}</span>
              <button
                className="tap-card-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setTapInfo(null);
                }}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="hover-popup-metric">
              <span className="hover-popup-label">Est. premium</span>
              <span className="hover-popup-value">
                <span className="hover-popup-dot" style={{ background: tapInfo.swatch }} />
                {tapInfo.premium}
              </span>
            </div>
            <button
              className="tap-card-details"
              onClick={(e) => {
                e.stopPropagation();
                onShowDetails();
              }}
            >
              Details
            </button>
          </Popup>
        )}

        {!isTouch && hoverInfo && (
          <Popup
            longitude={hoverInfo.lng}
            latitude={hoverInfo.lat}
            offset={14}
            closeButton={false}
            closeOnClick={false}
            className="hover-popup"
          >
            <div className="hover-popup-name">{hoverInfo.lsoaName}</div>
            <div className="hover-popup-code">{hoverInfo.lsoa}</div>
            <div className="hover-popup-metric">
              <span className="hover-popup-label">{hoverInfo.metricLabel}</span>
              <span className="hover-popup-value">
                <span className="hover-popup-dot" style={{ background: hoverInfo.swatch }} />
                {hoverInfo.metricValue}
              </span>
            </div>
            {hoverInfo.extra && <div className="hover-popup-extra">{hoverInfo.extra}</div>}
          </Popup>
        )}
      </MapGL>

      {/* £-keyed legend: readable without colour (Q labels, £ ranges, a text alternative) */}
      <div className="legend" role="group" aria-label="Map legend">
        <div className="legend-title">{driverLabel}</div>

        {colorMode === 'composite' ? (
          <>
            <div className="legend-ramp-bar legend-quintiles" aria-hidden="true">
              {QUINTILE_FILL.map((c, i) => (
                <span
                  key={i}
                  className={`seg-fill${selectedQ === i + 1 ? ' seg-selected' : ''}`}
                  style={{ background: c, color: QUINTILE_TEXT[i] }}
                >
                  Q{i + 1}
                </span>
              ))}
            </div>
            <div className="legend-scale" aria-hidden="true">
              {avgPos != null && (
                <>
                  <span className="legend-avg" style={{ left: `${avgPos * 100}%` }} />
                  <span className="legend-avg-label" style={{ left: `${avgPos * 100}%` }}>
                    {nationalAvg != null ? `${gbp(nationalAvg)} avg` : 'avg'}
                  </span>
                </>
              )}
              {bands.length > 0 && (
                <span className="legend-tick edge-l" style={{ left: 0 }}>{gbp(bands[0].min)}</span>
              )}
              {bands.slice(0, 4).map((b, i) => (
                <span
                  key={b.q}
                  className="legend-tick"
                  style={{ left: `${((i + 1) / 5) * 100}%` }}
                >
                  {gbp(b.max)}
                </span>
              ))}
              {bands.length === 5 && (
                <span className="legend-tick edge-r" style={{ left: '100%' }}>{gbp(bands[4].max)}</span>
              )}
            </div>
            <p className="sr-only">
              Areas are coloured by estimated annual premium in five quintiles, lightest to darkest
              {bands.length > 0
                ? `: ${bands.map((b) => `Q${b.q} ${gbp(b.min)} to ${gbp(b.max)}`).join('; ')}.`
                : '.'}
              {nationalAvg != null ? ` The GB average is ${gbp(nationalAvg)}.` : ''}
              {selectedQ ? ` The selected area is in Q${selectedQ}.` : ''} Grey means no data.
            </p>
          </>
        ) : (
          <>
            <div
              className="legend-ramp-bar"
              aria-hidden="true"
              style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }}
            />
            <div className="legend-scale" aria-hidden="true">
              <span className="legend-tick edge-l" style={{ left: 0 }}>0th</span>
              <span className="legend-tick" style={{ left: '50%' }}>50th</span>
              <span className="legend-tick edge-r" style={{ left: '100%' }}>100th pct</span>
            </div>
            <p className="sr-only">
              Areas are coloured by {driverLabel} percentile, from the 0th (lightest) to the
              100th (darkest). Grey means no data.
            </p>
          </>
        )}

        <div className="legend-nodata" aria-hidden="true">
          <span className="legend-nodata-swatch" />
          <span className="legend-nodata-label">No data</span>
        </div>
      </div>
    </main>
  );
};
