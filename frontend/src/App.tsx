import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { Sidebar } from './Sidebar';
import { MapView } from './MapView';
import type {
  AreaDetail,
  ColorMode,
  FocusTarget,
  LsoaProps,
  Methodology,
} from './types';
import {
  buildLookup,
  featureBounds,
  boundsCentre,
  featureToDetail,
  featureAtPoint,
} from './utils';
import { getGeojson, lookupPostcode, getMethodology } from './api';
import './index.css';

const VALID_FILTERS: readonly ColorMode[] = [
  'vehicle_crime',
  'imd_crime',
  'road_casualties',
  'deprivation',
  'flood_risk',
  'population_density',
  'aadf_intensity',
  'traffic_per_capita',
  'ksi_collisions_per_billion_vehicle_miles',
];

/** The colour mode from a shared ?filter= link, or the premium by default. */
function readUrlFilter(): ColorMode {
  const f = new URLSearchParams(window.location.search).get('filter');
  return VALID_FILTERS.find((m) => m === f) ?? 'composite';
}

function App() {
  // The loaded GeoJSON is our client-side data store: it powers the map,
  // instant click-details, and client-side fly-to (no per-click round-trips).
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [methodology, setMethodology] = useState<Methodology | null>(null);
  const lookup = useMemo(
    () => (geojson ? buildLookup(geojson) : new Map<string, Feature>()),
    [geojson]
  );

  const [detail, setDetail] = useState<AreaDetail | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [hoveredLsoa, setHoveredLsoa] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>(readUrlFilter);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [marker, setMarker] = useState<[number, number] | null>(null);

  // A shared ?area= link, captured once on mount; restored after the GeoJSON loads.
  const [initialArea] = useState(() =>
    new URLSearchParams(window.location.search).get('area')
  );

  // -----------------------------------------------------------------------
  // Deep-linkable URLs: encode ?area=<lsoa>&filter=<mode> in the query string.
  // -----------------------------------------------------------------------
  const updateUrl = useCallback(
    (lsoa: string | null, mode: ColorMode) => {
      const params = new URLSearchParams();
      if (lsoa) params.set('area', lsoa);
      if (mode !== 'composite') params.set('filter', mode);
      const qs = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    },
    []
  );

  // Fly to a feature's geometry using bounds we already hold on the client.
  const focusFeature = useCallback(
    (feature: Feature | undefined, exact?: [number, number]) => {
      const bounds = feature ? featureBounds(feature) : null;
      if (bounds) {
        setFocus({ bounds, nonce: Date.now() });
        setMarker(exact ?? boundsCentre(bounds));
      } else if (exact) {
        setFocus({ center: exact, nonce: Date.now() });
        setMarker(exact);
      }
    },
    []
  );

  const focusLsoa = (lsoa11cd: string, exact?: [number, number]) =>
    focusFeature(lookup.get(lsoa11cd), exact);

  // Keep the URL in sync whenever selection or filter changes.
  useEffect(() => {
    updateUrl(detail?.lsoa11cd ?? null, colorMode);
  }, [detail?.lsoa11cd, colorMode, updateUrl]);

  // Load the choropleth once (static file on Pages; see api.ts), then restore
  // the area selection from the URL.
  useEffect(() => {
    getGeojson()
      .then((fc) => {
        setGeojson(fc);
        if (!initialArea) return;
        const feature = fc.features.find(
          (f) => String((f.properties as LsoaProps | null)?.lsoa11cd) === initialArea
        );
        if (feature) {
          setDetail(featureToDetail(feature.properties as LsoaProps));
          focusFeature(feature);
        }
      })
      .catch((e) => setGeoError(e.message));
    getMethodology().then((m) => m && setMethodology(m));
  }, [initialArea, focusFeature]);

  const handleSearch = async (postcode: string) => {
    setLoading(true);
    setSearchError(null);
    try {
      // postcodes.io → coordinate → the area whose polygon contains it (its props
      // already carry the premium + drivers, baked into the GeoJSON).
      const hit = await lookupPostcode(postcode);
      const feature = geojson
        ? featureAtPoint(geojson.features, hit.lng, hit.lat)
        : null;
      const props = feature?.properties as LsoaProps | undefined;
      if (!props) {
        throw new Error('That postcode is outside the modelled area (GB only).');
      }
      setDetail({ ...featureToDetail(props), title: hit.postcode });
      focusLsoa(String(props.lsoa11cd), [hit.lng, hit.lat]);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
      setDetail(null);
      setMarker(null);
    } finally {
      setLoading(false);
    }
  };

  // Clicking any area on the map: hydrate the panel straight from feature
  // properties — instant, no network call.
  const handleMapClick = (lsoa11cd: string) => {
    const props = lookup.get(lsoa11cd)?.properties as LsoaProps | undefined;
    if (!props) return;
    setSearchError(null);
    setDetail(featureToDetail(props));
    focusLsoa(lsoa11cd);
  };

  const handleSelectRanking = (code: string, coords?: [number, number]) => {
    setSearchError(null);
    const props = lookup.get(code)?.properties as LsoaProps | undefined;
    if (props) {
      setDetail(featureToDetail(props));
      focusLsoa(code, coords);
    } else if (coords) {
      // District-level ranking with no matching LSOA geometry on the client.
      setFocus({ center: coords, nonce: Date.now() });
      setMarker(coords);
    }
  };

  const clearDetail = () => {
    setDetail(null);
    setSearchError(null);
    setMarker(null);
  };

  return (
    <div className="app-container">
      <Sidebar
        onSearch={handleSearch}
        onSelectRanking={handleSelectRanking}
        onClear={clearDetail}
        detail={detail}
        error={searchError}
        loading={loading}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        lookup={lookup}
        methodology={methodology}
      />
      <MapView
        geojson={geojson}
        loadError={geoError}
        colorMode={colorMode}
        focus={focus}
        marker={marker}
        hoveredLsoa={hoveredLsoa}
        selectedLsoa={detail?.lsoa11cd ?? null}
        nationalAvg={methodology?.national_avg}
        onHover={setHoveredLsoa}
        onClick={handleMapClick}
        onResetFilter={() => setColorMode('composite')}
      />
    </div>
  );
}

export default App;
