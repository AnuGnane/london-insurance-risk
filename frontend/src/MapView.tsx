import React, { useCallback, useRef } from 'react';
// @ts-ignore
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapViewProps {
  hoveredLsoa: string | null;
  selectedLsoa: string | null;
  onHover: (lsoa: string | null) => void;
  onClick: (lsoa: string) => void;
}

export const MapView: React.FC<MapViewProps> = ({ 
  selectedLsoa, 
  onHover, 
  onClick 
}) => {
  const mapRef = useRef<any>(null);

  const [hoveredFeatureId, setHoveredFeatureId] = React.useState<number | null>(null);

  const onMouseMove = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const newId = feature.id;
      
      if (hoveredFeatureId !== newId) {
        if (hoveredFeatureId !== null && mapRef.current) {
          mapRef.current.setFeatureState(
            { source: 'lsoa', id: hoveredFeatureId },
            { hover: false }
          );
        }
        
        if (newId !== undefined && mapRef.current) {
          mapRef.current.setFeatureState(
            { source: 'lsoa', id: newId },
            { hover: true }
          );
        }
        
        setHoveredFeatureId(newId);
        onHover(feature.properties.lsoa11cd);
      }
    } else if (hoveredFeatureId !== null) {
      if (mapRef.current) {
        mapRef.current.setFeatureState(
          { source: 'lsoa', id: hoveredFeatureId },
          { hover: false }
        );
      }
      setHoveredFeatureId(null);
      onHover(null);
    }
  }, [hoveredFeatureId, onHover]);

  const onMouseLeave = useCallback(() => {
    if (hoveredFeatureId !== null && mapRef.current) {
      mapRef.current.setFeatureState(
        { source: 'lsoa', id: hoveredFeatureId },
        { hover: false }
      );
    }
    setHoveredFeatureId(null);
    onHover(null);
  }, [hoveredFeatureId, onHover]);

  const onMouseClick = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      onClick(feature.properties.lsoa11cd);
      
      // Fly to clicked feature
      if (mapRef.current) {
        mapRef.current.flyTo({
          center: e.lngLat,
          zoom: 13,
          duration: 1000
        });
      }
    }
  }, [onClick]);

  return (
    <div className="map-container">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: -0.1276,
          latitude: 51.5072,
          zoom: 10
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        interactiveLayerIds={['lsoa-fill']}
        onMouseMove={onMouseMove}
        onClick={onMouseClick}
        onMouseLeave={onMouseLeave}
      >
        <Source 
          id="lsoa" 
          type="geojson" 
          data="/api/geojson" 
          generateId={true} // Needed for hover state
        >
          <Layer 
            id="lsoa-fill" 
            type="fill" 
            paint={{
              'fill-color': [
                'match',
                ['get', 'risk_bucket'],
                1, '#ffffb2',
                2, '#fecc5c',
                3, '#fd8d3c',
                4, '#f03b20',
                5, '#bd0026',
                '#e5e5e5' // fallback
              ],
              'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1.0,
                0.7
              ]
            }} 
          />
          <Layer 
            id="lsoa-lines" 
            type="line" 
            paint={{
              'line-color': '#ffffff',
              'line-width': 0.5,
              'line-opacity': 0.5
            }} 
          />
          <Layer 
            id="lsoa-highlight" 
            type="line" 
            paint={{
              'line-color': '#000000',
              'line-width': 2,
              'line-opacity': [
                'case',
                ['==', ['get', 'lsoa11cd'], selectedLsoa || ''],
                1,
                0
              ]
            }} 
          />
        </Source>
      </Map>

      {/* Legend overlay */}
      <div className="legend">
        <div className="legend-title">Risk Quintile</div>
        <div className="legend-ramp">
          <div style={{ backgroundColor: '#ffffb2' }}></div>
          <div style={{ backgroundColor: '#fecc5c' }}></div>
          <div style={{ backgroundColor: '#fd8d3c' }}></div>
          <div style={{ backgroundColor: '#f03b20' }}></div>
          <div style={{ backgroundColor: '#bd0026' }}></div>
        </div>
        <div className="legend-labels">
          <span>Low (1)</span>
          <span>High (5)</span>
        </div>
      </div>
    </div>
  );
};
