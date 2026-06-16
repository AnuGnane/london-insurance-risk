import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { Sidebar } from './Sidebar';
import { MapView } from './MapView';
import type {
  AreaDetail,
  ColorMode,
  FocusTarget,
  LsoaProps,
  RiskData,
} from './types';
import {
  buildLookup,
  featureBounds,
  boundsCentre,
  featureToDetail,
} from './utils';
import './index.css';

function App() {
  // The loaded GeoJSON is our client-side data store: it powers the map,
  // instant click-details, and client-side fly-to (no per-click round-trips).
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const lookup = useMemo(
    () => (geojson ? buildLookup(geojson) : new Map<string, Feature>()),
    [geojson]
  );

  const [detail, setDetail] = useState<AreaDetail | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [hoveredLsoa, setHoveredLsoa] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('composite');
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [marker, setMarker] = useState<[number, number] | null>(null);

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

  // On mount, restore state from the URL query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const areaParam = params.get('area');
    const filterParam = params.get('filter') as ColorMode | null;
    if (
      filterParam &&
      ['vehicle_crime', 'road_casualties', 'deprivation', 'population_density'].includes(filterParam)
    ) {
      setColorMode(filterParam);
    }
    // Area restoration happens after geojson loads (see below).
    if (areaParam) {
      // Stash in a ref-like state so the geojson-load effect can pick it up.
      setPendingArea(areaParam);
    }
  }, []);

  const [pendingArea, setPendingArea] = useState<string | null>(null);

  // Once the GeoJSON is loaded, restore area selection from the URL.
  useEffect(() => {
    if (!pendingArea || lookup.size === 0) return;
    const props = lookup.get(pendingArea)?.properties as LsoaProps | undefined;
    if (props) {
      setDetail(featureToDetail(props));
      focusLsoa(pendingArea);
    }
    setPendingArea(null);
  }, [pendingArea, lookup]);

  // Keep the URL in sync whenever selection or filter changes.
  useEffect(() => {
    updateUrl(detail?.lsoa11cd ?? null, colorMode);
  }, [detail?.lsoa11cd, colorMode, updateUrl]);

  // Load the choropleth once.
  useEffect(() => {
    fetch('/api/geojson')
      .then((r) => {
        if (!r.ok) throw new Error('Could not load the map data');
        return r.json();
      })
      .then((fc: FeatureCollection) => setGeojson(fc))
      .catch((e) => setGeoError(e.message));
  }, []);

  // Fly to an LSOA's geometry using bounds we already hold on the client.
  const focusLsoa = (lsoa11cd: string, exact?: [number, number]) => {
    const feature = lookup.get(lsoa11cd);
    const bounds = feature ? featureBounds(feature) : null;
    if (bounds) {
      setFocus({ bounds, nonce: Date.now() });
      setMarker(exact ?? boundsCentre(bounds));
    } else if (exact) {
      setFocus({ center: exact, nonce: Date.now() });
      setMarker(exact);
    }
  };

  const handleSearch = async (postcode: string) => {
    setLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/risk?postcode=${encodeURIComponent(postcode)}`
      );
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'No match — that postcode is outside Great Britain or not recognised.'
            : 'Something went wrong fetching that postcode.'
        );
      }
      const data: RiskData = await res.json();

      // Prefer the rich /api/risk payload; fall back to feature props.
      const fromFeature =
        lookup.get(data.lsoa11cd)?.properties as LsoaProps | undefined;
      const detailFromApi: AreaDetail = {
        title: data.postcode,
        subtitle: `LSOA ${data.lsoa11cd}`,
        lsoa11cd: data.lsoa11cd,
        risk_index: data.risk_index,
        quintile: data.quintile,
        calibrated_premium: data.calibrated_premium_estimate,
        wtw_anchor_premium: data.wtw_anchor_premium,
        postcode_area: data.postcode_area,
        components: Object.entries(data.components ?? {}).map(([key, c]) => ({
          key,
          value: c.value,
          percentile: c.percentile,
          contribution: c.contribution,
        })),
      };
      setDetail(
        detailFromApi.components.length || !fromFeature
          ? detailFromApi
          : { ...featureToDetail(fromFeature), title: data.postcode }
      );

      const exact =
        data.lng != null && data.lat != null
          ? ([data.lng, data.lat] as [number, number])
          : undefined;
      focusLsoa(data.lsoa11cd, exact);
    } catch (err: any) {
      setSearchError(err.message);
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
      />
      <MapView
        geojson={geojson}
        loadError={geoError}
        colorMode={colorMode}
        focus={focus}
        marker={marker}
        hoveredLsoa={hoveredLsoa}
        selectedLsoa={detail?.lsoa11cd ?? null}
        onHover={setHoveredLsoa}
        onClick={handleMapClick}
      />
    </div>
  );
}

export default App;
