import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MapView } from './MapView';
import type { RiskData } from './types';
import './index.css';

function App() {
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredLsoa, setHoveredLsoa] = useState<string | null>(null);
  
  const handleSearch = async (postcode: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk?postcode=${encodeURIComponent(postcode)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Postcode not found or outside London");
        throw new Error("Failed to fetch data");
      }
      const data = await res.json();
      setRiskData(data);
    } catch (err: any) {
      setError(err.message);
      setRiskData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRanking = async (_lsoaCode: string) => {
    // In a full implementation, you could fetch specific details for the LSOA here,
    // or fly the map to the LSOA. Since the user clicked a ranking, we'd ideally
    // want to look it up. But the backend /api/risk only takes postcode.
    // For M5 MVP, we just set selectedLsoa for the map highlight, but
    // since we don't have the full component breakdown without a postcode lookup,
    // we just highlight the map.
    
    // To properly "select" an LSOA and fly to it without a postcode, we rely on MapView.
    // We could add an endpoint `/api/risk/lsoa/<code>` if needed.
    // For now, we'll just clear the risk detail and rely on the map highlight.
    setRiskData(null);
    setError(null);
    // Ideally map fly-to happens here, but MapView handles clicks.
    // A proper programmatic fly-to would require coordinates from the backend.
  };

  return (
    <div className="app-container">
      <Sidebar 
        onSearch={handleSearch} 
        onSelectRanking={handleSelectRanking}
        riskData={riskData}
        error={error}
        loading={loading}
      />
      <MapView 
        hoveredLsoa={hoveredLsoa}
        selectedLsoa={riskData?.lsoa11cd || null}
        onHover={setHoveredLsoa}
        onClick={(lsoa) => {
          // If clicked on map, we only know LSOA. 
          // If we want detail panel, we'd need a reverse postcode lookup or LSOA endpoint.
          // For now, just set selected if we add state for it.
          console.log("Clicked LSOA", lsoa);
        }}
      />
    </div>
  );
}

export default App;
