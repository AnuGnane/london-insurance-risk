import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore - react-map-gl maplibre entrypoint ships without bundled types
import MapGL, {
  Source,
  Layer,
  Popup,
  Marker,
  NavigationControl,
} from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, X } from 'lucide-react';
import type { ColorMode, FocusTarget } from './types';
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
} from './utils';

interface MapViewProps {
  geojson: FeatureCollection | null;
  loadError: string | null;
  colorMode: ColorMode;
  focus: FocusTarget | null;
  marker: [number, number] | null;
  hoveredLsoa: string | null;
  selectedLsoa: string | null;
  nationalAvg?: number;
  onHover: (lsoa: string | null) => void;
  onClick: (lsoa: string) => void;
  onResetFilter: () => void;
}

const SELECTED_OUTLINE = '#24211c';

// Discrete quintiles for the composite; a continuous percentile ramp per driver.
function fillColor(mode: ColorMode): any {
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

export const MapView: React.FC<MapViewProps> = ({
  geojson,
  loadError,
  colorMode,
  focus,
  marker,
  selectedLsoa,
  nationalAvg,
  onHover,
  onClick,
  onResetFilter,
}) => {
  const mapRef = useRef<any>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const lookup = useMemo(() => {
    const m = new Map<string, any>();
    if (geojson) for (const f of geojson.features) m.set(String((f.properties as any)?.lsoa11cd), f);
    return m;
  }, [geojson]);
  const bands = useMemo(() => quintilePremiumBands(lookup), [lookup]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    if (focus.bounds) {
      // Cap the zoom: the static geometry is simplified to ~180 m, so zooming in
      // tight on one small area exposes coarse polygons — keep some context.
      mapRef.current.fitBounds(focus.bounds, { padding: 120, maxZoom: 11, duration: 1100 });
    } else if (focus.center) {
      mapRef.current.flyTo({ center: focus.center, zoom: 11, duration: 1100 });
    }
  }, [focus?.nonce]);

  const setHover = (id: number | null, on: boolean) => {
    if (id == null || !mapRef.current) return;
    mapRef.current.setFeatureState({ source: 'lsoa', id }, { hover: on });
  };

  const readHover = useCallback(
    (props: Record<string, any>): { label: string; value: string; extra: string | null } => {
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
    (e: any) => {
      const f = e.features?.[0];
      if (f) {
        if (hoveredId !== f.id) {
          setHover(hoveredId, false);
          setHover(f.id, true);
          setHoveredId(f.id);
          onHover(f.properties.lsoa11cd);
        }
        const { label, value, extra } = readHover(f.properties);
        const q = Number(f.properties.quintile);
        setHoverInfo({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          lsoa: f.properties.lsoa11cd,
          lsoaName: f.properties.lsoa_name || f.properties.lsoa11cd,
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

  const onMapClick = useCallback(
    (e: any) => {
      const f = e.features?.[0];
      if (f) onClick(f.properties.lsoa11cd);
    },
    [onClick]
  );

  const driverLabel =
    colorMode === 'composite' ? 'Estimated annual premium' : COMPONENT_LABELS[colorMode] || colorMode;

  // Legend ticks for the composite £ scale.
  const avgPos = nationalAvg != null && bands.length ? premiumToRampPos(nationalAvg, bands) : null;

  return (
    <div className="map-container">
      {!geojson && !loadError && (
        <div className="skeleton-map">
          <div className="skeleton-pulse" />
          <div className="map-toast skeleton-toast">
            <span className="loader" /> Plotting 41,729 areas…
          </div>
        </div>
      )}
      {loadError && <div className="map-toast map-toast-error">{loadError}</div>}

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
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        interactiveLayerIds={geojson ? ['lsoa-fill'] : []}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onMapClick}
        cursor="default"
      >
        <NavigationControl position="top-left" showCompass={false} />

        {geojson && (
          <Source id="lsoa" type="geojson" data={geojson} generateId>
            <Layer
              id="lsoa-fill"
              type="fill"
              paint={{
                'fill-color': fillColor(colorMode),
                'fill-opacity': [
                  'case',
                  ['boolean', ['feature-state', 'hover'], false],
                  0.95,
                  0.72,
                ],
                // @ts-ignore — maplibre supports this property
                'fill-color-transition': { duration: 350, delay: 0 },
              }}
            />
            <Layer
              id="lsoa-lines"
              type="line"
              paint={{ 'line-color': '#fbf7f0', 'line-width': 0.4, 'line-opacity': 0.45 }}
            />
            <Layer
              id="lsoa-selected"
              type="line"
              filter={['==', ['get', 'lsoa11cd'], selectedLsoa ?? '__none__']}
              paint={{ 'line-color': SELECTED_OUTLINE, 'line-width': 2.5 }}
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

        {hoverInfo && (
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

      {/* £-keyed legend */}
      <div className="legend">
        <div className="legend-title">{driverLabel}</div>

        {colorMode === 'composite' ? (
          <>
            <div className="legend-ramp-bar">
              {QUINTILE_FILL.map((c, i) => (
                <span key={i} className="seg-fill" style={{ background: c }} />
              ))}
            </div>
            <div className="legend-scale">
              {avgPos != null && (
                <>
                  <span className="legend-avg" style={{ left: `${avgPos * 100}%` }} />
                  <span className="legend-avg-label" style={{ left: `${avgPos * 100}%` }}>
                    {nationalAvg != null ? `${gbp(nationalAvg)} avg` : 'avg'}
                  </span>
                </>
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
            </div>
          </>
        ) : (
          <>
            <div
              className="legend-ramp-bar"
              style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }}
            />
            <div className="legend-scale">
              <span className="legend-tick edge-l" style={{ left: 0 }}>0th</span>
              <span className="legend-tick" style={{ left: '50%' }}>50th</span>
              <span className="legend-tick edge-r" style={{ left: '100%' }}>100th pct</span>
            </div>
          </>
        )}

        <div className="legend-nodata">
          <span className="legend-nodata-swatch" />
          <span className="legend-nodata-label">No data</span>
        </div>
      </div>
    </div>
  );
};
