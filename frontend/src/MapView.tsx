import React, { useCallback, useEffect, useRef, useState } from 'react';
// @ts-ignore - react-map-gl maplibre entrypoint ships without bundled types
import Map, {
  Source,
  Layer,
  Popup,
  Marker,
  NavigationControl,
} from 'react-map-gl/maplibre';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin } from 'lucide-react';
import type { ColorMode, FocusTarget } from './types';
import { COMPONENT_LABELS } from './utils';

interface MapViewProps {
  geojson: FeatureCollection | null;
  loadError: string | null;
  colorMode: ColorMode;
  focus: FocusTarget | null;
  marker: [number, number] | null;
  hoveredLsoa: string | null;
  selectedLsoa: string | null;
  onHover: (lsoa: string | null) => void;
  onClick: (lsoa: string) => void;
}

const RAMP = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];
const NO_DATA_COLOR = '#d9d9d9';

// Fill colour: discrete quintiles for the composite, a continuous percentile
// ramp for a single driver. `coalesce` tolerates `quintile` OR `risk_bucket`.
// Features with null/0 values map to a distinct no-data grey.
function fillColor(mode: ColorMode): any {
  if (mode === 'composite') {
    return [
      'match',
      ['to-number', ['coalesce', ['get', 'quintile'], ['get', 'risk_bucket'], 0]],
      1, RAMP[0],
      2, RAMP[1],
      3, RAMP[2],
      4, RAMP[3],
      5, RAMP[4],
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
      25, RAMP[1],
      50, RAMP[2],
      75, RAMP[3],
      100, RAMP[4],
    ],
  ];
}

interface HoverInfo {
  lng: number;
  lat: number;
  lsoa: string;
  lsoaName: string;
  risk: number;
  activeMetricLabel: string;
  activeMetricValue: string;
}

export const MapView: React.FC<MapViewProps> = ({
  geojson,
  loadError,
  colorMode,
  focus,
  marker,
  selectedLsoa,
  onHover,
  onClick,
}) => {
  const mapRef = useRef<any>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // Imperative fly-to driven by the focus nonce.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    if (focus.bounds) {
      mapRef.current.fitBounds(focus.bounds, {
        padding: 80,
        maxZoom: 14,
        duration: 1200,
      });
    } else if (focus.center) {
      mapRef.current.flyTo({ center: focus.center, zoom: 13, duration: 1200 });
    }
  }, [focus?.nonce]);

  const setHover = (id: number | null, on: boolean) => {
    if (id == null || !mapRef.current) return;
    mapRef.current.setFeatureState({ source: 'lsoa', id }, { hover: on });
  };

  const formatActiveMetric = useCallback(
    (props: Record<string, any>): { label: string; value: string } => {
      if (colorMode === 'composite') {
        return {
          label: 'Risk index',
          value: isFinite(Number(props.risk_index))
            ? `${Number(props.risk_index).toFixed(1)}`
            : '—',
        };
      }
      const pct = props[`${colorMode}_pct`];
      const val = props[`${colorMode}_val`];
      const label = COMPONENT_LABELS[colorMode] || colorMode;
      if (pct == null && val == null) return { label, value: 'no data' };
      const parts: string[] = [];
      if (val != null) parts.push(Number(val).toFixed(1));
      if (pct != null) parts.push(`${Number(pct).toFixed(0)}th pct`);
      return { label, value: parts.join(' · ') };
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
        const { label, value } = formatActiveMetric(f.properties);
        setHoverInfo({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
          lsoa: f.properties.lsoa11cd,
          lsoaName: f.properties.lsoa_name || f.properties.lsoa11cd,
          risk: Number(f.properties.risk_index),
          activeMetricLabel: label,
          activeMetricValue: value,
        });
      } else if (hoveredId !== null) {
        setHover(hoveredId, false);
        setHoveredId(null);
        setHoverInfo(null);
        onHover(null);
      }
    },
    [hoveredId, onHover, formatActiveMetric]
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
    colorMode === 'composite'
      ? 'Composite risk'
      : COMPONENT_LABELS[colorMode] || colorMode;

  return (
    <div className="map-container">
      {/* Loading skeleton */}
      {!geojson && !loadError && (
        <div className="skeleton-map">
          <div className="skeleton-pulse" />
          <div className="map-toast skeleton-toast">
            <span className="loader" /> Loading London…
          </div>
        </div>
      )}
      {loadError && <div className="map-toast map-toast-error">{loadError}</div>}

      {/* On-map filter indicator */}
      {colorMode !== 'composite' && (
        <div className="filter-indicator">
          Showing: {driverLabel} (percentile)
        </div>
      )}

      <Map
        ref={mapRef}
        initialViewState={{ longitude: -0.1276, latitude: 51.5072, zoom: 9.6 }}
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
                  0.68,
                ],
                // @ts-ignore — maplibre supports this property
                'fill-color-transition': { duration: 400, delay: 0 },
              }}
            />
            <Layer
              id="lsoa-lines"
              type="line"
              paint={{
                'line-color': '#ffffff',
                'line-width': 0.4,
                'line-opacity': 0.5,
              }}
            />
            <Layer
              id="lsoa-selected"
              type="line"
              filter={['==', ['get', 'lsoa11cd'], selectedLsoa ?? '__none__']}
              paint={{ 'line-color': '#111111', 'line-width': 2.5 }}
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
              <span className="hover-popup-metric-label">
                {hoverInfo.activeMetricLabel}
              </span>
              <span className="hover-popup-metric-value">
                {hoverInfo.activeMetricValue}
              </span>
            </div>
            {colorMode !== 'composite' && (
              <div className="hover-popup-score">
                Risk {isFinite(hoverInfo.risk) ? hoverInfo.risk.toFixed(1) : '—'}
              </div>
            )}
          </Popup>
        )}
      </Map>

      {/* Redesigned legend */}
      <div className="legend">
        <div className="legend-title">{driverLabel}</div>

        {colorMode === 'composite' ? (
          <div className="legend-swatches">
            {RAMP.map((c, i) => (
              <div key={i} className="legend-row">
                <span className="legend-swatch" style={{ backgroundColor: c }} />
                <span className="legend-row-label">
                  Q{i + 1} · {i * 20}–{(i + 1) * 20}
                </span>
              </div>
            ))}
            <div className="legend-row">
              <span
                className="legend-swatch legend-swatch-nodata"
                style={{ backgroundColor: NO_DATA_COLOR }}
              />
              <span className="legend-row-label">No data</span>
            </div>
          </div>
        ) : (
          <>
            <div
              className="legend-gradient"
              style={{
                background: `linear-gradient(to right, ${RAMP.join(',')})`,
              }}
            />
            <div className="legend-labels legend-labels-3">
              <span>0th</span>
              <span>50th</span>
              <span>100th pct</span>
            </div>
            <div className="legend-row" style={{ marginTop: 8 }}>
              <span
                className="legend-swatch legend-swatch-nodata"
                style={{ backgroundColor: NO_DATA_COLOR }}
              />
              <span className="legend-row-label">No data</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
