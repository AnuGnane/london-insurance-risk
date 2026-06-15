import { useState } from 'react';
import { Search } from 'lucide-react';
import { DetailPanel } from './DetailPanel';
import { RankingsPanel } from './RankingsPanel';
import type { RiskData } from './types';

interface SidebarProps {
  onSearch: (postcode: string) => void;
  onSelectRanking: (code: string) => void;
  riskData: RiskData | null;
  error: string | null;
  loading: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  onSearch, 
  onSelectRanking,
  riskData,
  error,
  loading 
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchTerm.trim().length > 1) {
      onSearch(searchTerm.trim());
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>London Territory Risk</h1>
        <p>A composite open-data proxy for motor insurance risk across London.</p>
      </div>

      <div className="sidebar-content">
        <div className="search-bar">
          <Search className="search-icon" size={18} />
          <input 
            type="text" 
            placeholder="Search postcode (e.g. E1 6AN)" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
        </div>

        {loading && (
          <div style={{ textAlign: 'center' }}><div className="loader"></div></div>
        )}

        {error && (
          <div style={{ color: 'var(--q5)', fontSize: '0.875rem', padding: '0 8px' }}>
            {error}
          </div>
        )}

        {riskData && !loading ? (
          <DetailPanel data={riskData} />
        ) : (
          !loading && <RankingsPanel onSelectRanking={onSelectRanking} />
        )}

        <div className="disclaimer">
          <strong>Disclaimer:</strong> This index is a relative proxy of territorial risk built from public data (crime, collisions, deprivation, density). It is <strong>not</strong> an insurance quote.
        </div>
      </div>
    </div>
  );
};
