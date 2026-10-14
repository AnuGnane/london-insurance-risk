import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { Sidebar } from './Sidebar';
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
  NATIONS,
  type Nation,
} from './utils';
import { getGeojson, getMethodology } from './api';
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  resolvePostcode,
  type PostcodeHit,
} from './postcode';
import { layoutCssVars } from './layout';
import './index.css';

const VALID_FILTERS: readonly ColorMode[] = [
  'vehicle_crime',
  'imd_crime',
  'young_driver_share',
  'cars_per_household',
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

/** The rankings' nation from a shared ?nation= link, or all of GB (null). */
function readUrlNation(): Nation | null {
  const n = new URLSearchParams(window.location.search).get('nation');
  return NATIONS.find((x) => x.id === n)?.id ?? null;
}

// The map (react-map-gl, which in turn pulls in maplibre-gl) is its own chunk, so the
// masthead and search paint before it loads.
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

/** Placeholder while the map chunk loads (the same skeleton MapView shows for data). */
const MapFallback = () => (
  <main className="map-container" aria-label="Map of estimated car-insurance premiums" aria-busy="true">
    <div className="skeleton-map">
      <div className="skeleton-pulse" />
    </div>
  </main>
);

/** If the map chunk cannot load (offline, or a stale page after a redeploy), keep
 *  the sidebar working and say so in the map's place. */
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="map-container" aria-label="Map of estimated car-insurance premiums">
        <div className="map-toast map-toast-error" role="alert">
          The map could not load. Check your connection and reload the page.
        </div>
      </main>
    );
  }
}

function App() {
  // The loaded GeoJSON is our client-side data store: it powers the map,
  // instant click-details, and client-side fly-to (no per-click round-trips).
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loadedBytes, setLoadedBytes] = useState(0);
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
  // The rankings' nation filter (the map stays GB-wide); null = all of GB.
  const [nation, setNation] = useState<Nation | null>(readUrlNation);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [marker, setMarker] = useState<[number, number] | null>(null);
  // Phone bottom sheet: starts collapsed (masthead + search) and expands when an
  // area is chosen from the sheet. Ignored by the desktop layout.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // The postcode behind the current selection (shared as ?pc=), if it came from a search.
  const [searchedPc, setSearchedPc] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());

  // A shared ?pc= / ?area= link, captured once on mount; restored after the
  // GeoJSON loads (the postcode first, falling back to the area).
  // Set once the visitor picks an area themselves, so a slow link restore never
  // overrides their choice.
  const userSelected = useRef(false);
  const [initialLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { area: params.get('area'), pc: params.get('pc') };
  });

  // -----------------------------------------------------------------------
  // Deep-linkable URLs: encode ?pc=<postcode>&area=<lsoa>&filter=<mode>&nation=<id>.
  // -----------------------------------------------------------------------
  const updateUrl = useCallback(
    (lsoa: string | null, mode: ColorMode, pc: string | null, nat: Nation | null) => {
      const params = new URLSearchParams();
      if (pc && lsoa) params.set('pc', pc);
      if (lsoa) params.set('area', lsoa);
      if (mode !== 'composite') params.set('filter', mode);
      if (nat) params.set('nation', nat);
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

  // Keep the URL in sync whenever selection, filter or nation changes.
  useEffect(() => {
    updateUrl(detail?.lsoa11cd ?? null, colorMode, searchedPc, nation);
  }, [detail?.lsoa11cd, colorMode, searchedPc, nation, updateUrl]);

  // Show the area containing a resolved postcode (its props already carry the
  // premium + drivers, baked into the GeoJSON). Throws if it is off the map.
  const showPostcodeHit = useCallback(
    (features: Feature[], hit: PostcodeHit) => {
      const feature = featureAtPoint(features, hit.lng, hit.lat);
      const props = feature?.properties as LsoaProps | undefined;
      if (!feature || !props) {
        throw new Error('That postcode is outside the modelled area (GB only).');
      }
      const title =
        hit.query.kind === 'outcode' ? `${hit.label} · district centre` : hit.label;
      setDetail({ ...featureToDetail(props), title });
      setSearchedPc(hit.label);
      setSheetExpanded(true);
      focusFeature(feature, [hit.lng, hit.lat]);
    },
    [focusFeature]
  );

  // Load the choropleth once (static file on Pages; see api.ts), then restore
  // the selection from the URL: the postcode if postcodes.io answers, else the area.
  useEffect(() => {
    const restoreArea = (fc: FeatureCollection) => {
      if (!initialLink.area || userSelected.current) return;
      const feature = fc.features.find(
        (f) => String((f.properties as LsoaProps | null)?.lsoa11cd) === initialLink.area
      );
      if (feature) {
        setDetail(featureToDetail(feature.properties as LsoaProps));
        setSheetExpanded(true);
        focusFeature(feature);
      }
    };
    getGeojson(setLoadedBytes)
      .then((fc) => {
        setGeojson(fc);
        if (!initialLink.pc) {
          restoreArea(fc);
          return;
        }
        resolvePostcode(initialLink.pc)
          .then((hit) => {
            if (!userSelected.current) showPostcodeHit(fc.features, hit);
          })
          .catch(() => restoreArea(fc));
      })
      .catch((e) => setGeoError(e.message));
    getMethodology().then((m) => m && setMethodology(m));
  }, [initialLink, focusFeature, showPostcodeHit]);

  const handleSearch = async (postcode: string) => {
    userSelected.current = true;
    setLoading(true);
    setSearchError(null);
    try {
      // postcodes.io → coordinate → the area whose polygon contains it.
      const hit = await resolvePostcode(postcode);
      if (!geojson) throw new Error('The map is still loading. Try again in a moment.');
      showPostcodeHit(geojson.features, hit);
      setRecentSearches((list) => addRecentSearch(list, hit.label));
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
      setDetail(null);
      setSearchedPc(null);
      setMarker(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClearRecents = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  // Clicking any area on the map: hydrate the panel straight from feature
  // properties — instant, no network call.
  const handleMapClick = (lsoa11cd: string) => {
    const props = lookup.get(lsoa11cd)?.properties as LsoaProps | undefined;
    if (!props) return;
    userSelected.current = true;
    setSearchError(null);
    setSearchedPc(null);
    setDetail(featureToDetail(props));
    focusLsoa(lsoa11cd);
  };

  const handleSelectRanking = (code: string, coords?: [number, number]) => {
    userSelected.current = true;
    setSearchError(null);
    setSearchedPc(null);
    const props = lookup.get(code)?.properties as LsoaProps | undefined;
    if (props) {
      setDetail(featureToDetail(props));
      setSheetExpanded(true);
      focusLsoa(code, coords);
    } else if (coords) {
      // District-level ranking with no matching LSOA geometry on the client.
      setFocus({ center: coords, nonce: Date.now() });
      setMarker(coords);
    }
  };

  const clearDetail = () => {
    userSelected.current = true;
    setDetail(null);
    setSearchedPc(null);
    setSearchError(null);
    setMarker(null);
  };

  return (
    <div
      className={`app-container${sheetExpanded ? ' sheet-expanded' : ''}`}
      style={layoutCssVars}
    >
      <a className="skip-link" href="#postcode-search">Skip to postcode search</a>
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
        recentSearches={recentSearches}
        onClearRecents={handleClearRecents}
        sheetExpanded={sheetExpanded}
        onToggleSheet={() => setSheetExpanded((e) => !e)}
        nation={nation}
        onNationChange={setNation}
      />
      <MapErrorBoundary>
      <Suspense fallback={<MapFallback />}>
      <MapView
        geojson={geojson}
        loadError={geoError}
        loadedBytes={loadedBytes}
        colorMode={colorMode}
        focus={focus}
        marker={marker}
        hoveredLsoa={hoveredLsoa}
        selectedLsoa={detail?.lsoa11cd ?? null}
        nationalAvg={methodology?.national_avg}
        onHover={setHoveredLsoa}
        onClick={handleMapClick}
        onResetFilter={() => setColorMode('composite')}
        onShowDetails={() => setSheetExpanded(true)}
      />
      </Suspense>
      </MapErrorBoundary>
    </div>
  );
}

export default App;
