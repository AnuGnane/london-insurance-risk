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
  unionBounds,
  boundsCentre,
  featureToDetail,
  featureAtPoint,
  type Nation,
} from './utils';
import { getGeojson, getMethodology } from './api';
import { findMyArea } from './locate';
import { isCurrent, searchTarget } from './search';
import { buildShareUrl, pageTitle, parseShareUrl } from './url';
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  resolvePostcode,
  type PostcodeHit,
} from './postcode';
import { layoutCssVars } from './layout';
import './index.css';

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
  const [colorMode, setColorMode] = useState<ColorMode>(() => parseShareUrl(window.location.search).filter);
  // The rankings' nation filter (the map stays GB-wide); null = all of GB.
  const [nation, setNation] = useState<Nation | null>(
    () => parseShareUrl(window.location.search).nation
  );
  // Compare two areas: the second area (?area2=), and whether "Compare with…" is
  // armed so the next map tap or search picks it instead of the main area.
  // The second area is pinned against one main area (`forArea`): pick another main
  // area and the comparison goes, so it never reappears against an area not chosen.
  const [compare, setCompare] = useState<{ forArea: string; detail: AreaDetail } | null>(
    null
  );
  const [comparing, setComparing] = useState(false);
  // The armed state as of the latest render, read after a postcode lookup's await
  // so a × tapped while the lookup is in flight is honoured (see search.ts).
  const comparingRef = useRef(comparing);
  useEffect(() => {
    comparingRef.current = comparing;
  }, [comparing]);
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
  // Bumped by every selection the visitor makes; a "Near me" fix that lands after a
  // later one is dropped (see isCurrent in search.ts).
  const selectionId = useRef(0);
  const [initialLink] = useState(() => parseShareUrl(window.location.search));

  // -----------------------------------------------------------------------
  // Deep-linkable URLs: encode
  // ?pc=<postcode>&area=<lsoa>&area2=<lsoa>&filter=<mode>&nation=<id>.
  // -----------------------------------------------------------------------
  const updateUrl = useCallback(
    (
      lsoa: string | null,
      lsoa2: string | null,
      mode: ColorMode,
      pc: string | null,
      nat: Nation | null
    ) => {
      const url = buildShareUrl(window.location.pathname, {
        area: lsoa,
        area2: lsoa2,
        pc,
        filter: mode,
        nation: nat,
      });
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

  // Fly to a feature without moving the pin (a comparison's second area).
  const flyToFeature = useCallback((feature: Feature) => {
    const bounds = featureBounds(feature);
    if (bounds) setFocus({ bounds, nonce: Date.now() });
  }, []);

  const focusLsoa = (lsoa11cd: string, exact?: [number, number]) =>
    focusFeature(lookup.get(lsoa11cd), exact);

  // The comparison only stands beside a main area, and never against itself.
  const activeCompare =
    detail &&
    compare &&
    compare.forArea === detail.lsoa11cd &&
    compare.detail.lsoa11cd !== detail.lsoa11cd
      ? compare.detail
      : null;

  // Keep the URL in sync whenever selection, filter or nation changes.
  useEffect(() => {
    updateUrl(
      detail?.lsoa11cd ?? null,
      activeCompare?.lsoa11cd ?? null,
      colorMode,
      searchedPc,
      nation
    );
  }, [detail?.lsoa11cd, activeCompare?.lsoa11cd, colorMode, searchedPc, nation, updateUrl]);

  // The tab's title follows the selection (history, tab strip, bookmarks); the
  // plain title in index.html is the base, read once and restored on unmount.
  const baseTitle = useRef(document.title);
  useEffect(() => {
    document.title = pageTitle(baseTitle.current, detail?.title, activeCompare?.title);
  }, [detail?.title, activeCompare?.title]);
  useEffect(() => {
    const base = baseTitle.current;
    return () => {
      document.title = base;
    };
  }, []);

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
    // The second area of a shared comparison (shown once the main area is back).
    const restoreCompare = (fc: FeatureCollection) => {
      const { area, area2 } = initialLink;
      if (!area || !area2 || userSelected.current) return;
      const feature = fc.features.find(
        (f) => String((f.properties as LsoaProps | null)?.lsoa11cd) === area2
      );
      if (feature) {
        setCompare({ forArea: area, detail: featureToDetail(feature.properties as LsoaProps) });
      }
    };
    getGeojson(setLoadedBytes)
      .then((fc) => {
        setGeojson(fc);
        restoreCompare(fc);
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
    selectionId.current++;
    setLoading(true);
    setSearchError(null);
    // Armed "Compare with…": the result becomes the second area, the main one stays.
    // Re-read once the lookup lands: a compare cancelled meanwhile drops its result.
    const asCompare = comparing && detail != null;
    try {
      // postcodes.io → coordinate → the area whose polygon contains it.
      const hit = await resolvePostcode(postcode);
      const target = searchTarget(asCompare, comparingRef.current);
      if (target === 'drop') return;
      if (!geojson) throw new Error('The map is still loading. Try again in a moment.');
      if (target === 'compare') showCompareHit(geojson.features, hit);
      else showPostcodeHit(geojson.features, hit);
      setRecentSearches((list) => addRecentSearch(list, hit.label));
    } catch (err: unknown) {
      const target = searchTarget(asCompare, comparingRef.current);
      if (target === 'drop') return;
      setSearchError(err instanceof Error ? err.message : String(err));
      if (target === 'compare') return;
      setDetail(null);
      setSearchedPc(null);
      setMarker(null);
    } finally {
      setLoading(false);
    }
  };

  // A postcode search while "Compare with…" is armed: pin its area as the second one.
  // The map flies to it, but the pin stays on the main area.
  const showCompareHit = (features: Feature[], hit: PostcodeHit) => {
    const feature = featureAtPoint(features, hit.lng, hit.lat);
    const props = feature?.properties as LsoaProps | undefined;
    if (!feature || !props) {
      throw new Error('That postcode is outside the modelled area (GB only).');
    }
    if (String(props.lsoa11cd) === detail?.lsoa11cd) {
      throw new Error('That postcode is in the area already shown. Try another.');
    }
    const title =
      hit.query.kind === 'outcode' ? `${hit.label} · district centre` : hit.label;
    pinCompare({ ...featureToDetail(props), title });
    flyToFeature(feature);
  };

  const pinCompare = (d: AreaDetail) => {
    if (!detail) return;
    setCompare({ forArea: detail.lsoa11cd, detail: d });
    setComparing(false);
    setSheetExpanded(true);
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
    selectionId.current++;
    setSearchError(null);
    if (comparing && detail) {
      // The main area cannot be its own comparison: stay armed for another tap.
      if (lsoa11cd !== detail.lsoa11cd) pinCompare(featureToDetail(props));
      return;
    }
    setSearchedPc(null);
    setDetail(featureToDetail(props));
    focusLsoa(lsoa11cd);
  };

  const handleSelectRanking = (code: string, coords?: [number, number]) => {
    userSelected.current = true;
    selectionId.current++;
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

  // "Near me": the device's area as the main one. Like a ranking tap it sets no
  // postcode, so the URL gains only ?area=, never a coordinate; nothing is stored.
  const handleNearMe = async () => {
    if (!geojson) return;
    setSearchError(null);
    const id = ++selectionId.current;
    try {
      const feature = await findMyArea(navigator.geolocation, geojson.features);
      if (!isCurrent(id, selectionId.current)) return;
      userSelected.current = true;
      setSearchedPc(null);
      setDetail({ ...featureToDetail(feature.properties as LsoaProps), title: 'Your location' });
      setSheetExpanded(true);
      focusFeature(feature);
    } catch (e) {
      if (!isCurrent(id, selectionId.current)) return;
      setSearchError(e instanceof Error ? e.message : 'Could not find your location.');
    }
  };

  // A "Try" pair from the landing: the first area as the main one (as a ranking tap
  // sets it), the second pinned as its comparison, and the view framed on both.
  const handleSelectPair = (a: string, b: string) => {
    const bProps = lookup.get(b)?.properties as LsoaProps | undefined;
    if (!lookup.has(a) || !bProps) return;
    handleSelectRanking(a); // bumps selectionId
    setCompare({ forArea: a, detail: featureToDetail(bProps) });
    setComparing(false);
    const bounds = unionBounds(lookup.get(a), lookup.get(b));
    if (bounds) setFocus({ bounds, nonce: Date.now() });
  };

  // Memoised so the Sidebar's Escape listener (which depends on it through
  // closeDetail) registers once per state change, not on every App render.
  const clearDetail = useCallback(() => {
    selectionId.current++; // a late "Near me" fix must not reopen the panel
    userSelected.current = true;
    setDetail(null);
    setSearchedPc(null);
    setSearchError(null);
    setMarker(null);
    setCompare(null);
    setComparing(false);
  }, []);

  return (
    <div
      className={`app-container${sheetExpanded ? ' sheet-expanded' : ''}`}
      style={layoutCssVars}
    >
      <a className="skip-link" href="#postcode-search">Skip to postcode search</a>
      <Sidebar
        onSearch={handleSearch}
        onSelectRanking={handleSelectRanking}
        onSelectPair={handleSelectPair}
        onNearMe={handleNearMe}
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
        compare={activeCompare}
        comparing={comparing && detail != null}
        onCompareToggle={() => setComparing((c) => !c)}
        onCompareClear={() => {
          userSelected.current = true;
          setCompare(null);
          setComparing(false);
        }}
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
        compareLsoa={activeCompare?.lsoa11cd ?? null}
        comparing={comparing && detail != null}
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
