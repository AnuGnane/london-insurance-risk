import { useEffect, useState } from 'react';
import type { RankingArea } from './types';

interface RankingsPanelProps {
  onSelectRanking: (code: string) => void;
}

export const RankingsPanel: React.FC<RankingsPanelProps> = ({ onSelectRanking }) => {
  const [rankings, setRankings] = useState<RankingArea[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/rankings?n=10')
      .then(res => res.json())
      .then(data => {
        setRankings(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch rankings", err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="card rankings-panel">
      <div className="card-title">Areas at most risk</div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div className="loader"></div>
        </div>
      ) : (
        <div>
          {rankings.map((r, i) => (
            <div 
              key={r.code} 
              className="ranking-item"
              onClick={() => onSelectRanking(r.code)}
            >
              <div className="ranking-info">
                <span className="ranking-name">{i + 1}. {r.name}</span>
                <span className="stat-label">£{r.calibrated_premium} expected</span>
              </div>
              <span className="ranking-score">{r.risk_index.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
