import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Users, Shield, Swords, BarChart2, Sparkles, WifiOff } from 'lucide-react';

// The backend server URL - uses environment variable in production
const API_URL = import.meta.env.VITE_API_BASE_URL 
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1/nba-data`
  : 'http://localhost:3001/api/nba-data';

// --- PROBABILITY MODEL (NOW USES LIVE ODDS) ---
const calculateWinProbabilityFromOdds = (teamA, teamB) => {
    if (!teamA?.upcomingGame || !teamB?.upcomingGame) return { [teamA.id]: 50, [teamB.id]: 50, insight: "Odds data not available." };

    const convertAmericanToProbability = (odds) => {
        if (odds > 0) {
            return 100 / (odds + 100);
        } else {
            return (-odds) / (-odds + 100);
        }
    };
    
    const probA = convertAmericanToProbability(teamA.upcomingGame.moneyline);
    const probB = convertAmericanToProbability(teamB.upcomingGame.moneyline);

    // Normalize probabilities so they sum to 100%
    const totalProb = probA + probB;
    const normalizedProbA = (probA / totalProb) * 100;
    const normalizedProbB = (probB / totalProb) * 100;

    const insight = `The betting market implies a ${Math.round(normalizedProbA > normalizedProbB ? normalizedProbA : normalizedProbB)}% chance for the favorite, the ${normalizedProbA > normalizedProbB ? teamA.name : teamB.name}, to win.`;
    
    return {
        [teamA.id]: normalizedProbA,
        [teamB.id]: normalizedProbB,
        insight: insight
    };
};

// --- GEMINI API INTEGRATION ---
const generateMatchupAnalysis = async (teamA, teamB) => {
    const prompt = `Act as an expert sports analyst providing a pre-game briefing for an NBA matchup. Matchup: ${teamA.name} vs. ${teamB.name}.
    
    Team A (${teamA.name}):
    - Current Market Moneyline: ${teamA.upcomingGame.moneyline}
    - Mock Quantitative Data: ${JSON.stringify(teamA.quantitative)}
    - Mock Qualitative Data: ${JSON.stringify(teamA.qualitative)}

    Team B (${teamB.name}):
    - Current Market Moneyline: ${teamB.upcomingGame.moneyline}
    - Mock Quantitative Data: ${JSON.stringify(teamB.quantitative)}
    - Mock Qualitative Data: ${JSON.stringify(teamB.qualitative)}

    Your Task: Write a detailed, narrative-style analysis covering: 
    1. Overall Matchup Synopsis based on the live betting odds.
    2. Key Strengths & Weaknesses using the mock data.
    3. Strategic X-Factors.
    4. Prediction with a final score, justifying it with the available data.
    Format the response clearly with headings.`;
    
    try {
        // This is a placeholder for the actual API call logic
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
        const apiKey = ""; // Should be handled in a secure environment
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || "No content found.";
    } catch (error) {
        console.error("Error generating AI analysis:", error);
        return `An error occurred while generating the analysis. Note: Gemini API calls may be restricted in this environment. ${error.message}`;
    }
};

// --- UI COMPONENTS ---
const TeamStockCard = ({ team, onSelect }) => {
  const isPositive = team.change >= 0;
  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg cursor-pointer hover:bg-gray-700/50 transition-all duration-300 border border-gray-700" onClick={() => onSelect(team.id)}>
      <div className="flex justify-between items-start">
        <div><h2 className="text-xl font-bold text-white">{team.name}</h2><p className="text-sm text-gray-400">Next Opp: {team.upcomingGame.opponent}</p></div>
        <div className={`text-lg font-semibold ${team.price > 0 ? 'text-green-400' : 'text-red-400'}`}>{team.price > 0 ? `+${team.price}` : team.price}</div>
      </div>
      <div className="h-24 mt-4 -mx-4"><ResponsiveContainer width="100%" height="100%"><LineChart data={team.performanceHistory} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}><Line type="monotone" dataKey="value" stroke={isPositive ? '#4ade80' : '#f87171'} strokeWidth={2} dot={false} /><YAxis domain={['dataMin - 5', 'dataMax + 5']} hide={true} /></LineChart></ResponsiveContainer></div>
      <div className="flex justify-between items-center mt-2 text-sm"><div className={`flex items-center gap-1`}>Moneyline</div><div className="text-gray-400">Vol: <span className="font-semibold text-gray-300">{team.volume}</span></div></div>
    </div>
  );
};

const TeamDetailView = ({ team, onBack }) => {
  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700">
        <button onClick={onBack} className="mb-4 text-sm text-indigo-400 hover:text-indigo-300">&larr; Back to Market Overview</button>
        <div className="flex justify-between items-center mb-4"><h2 className="text-2xl font-bold">{team.name}</h2><div className="text-right"><p className={`text-2xl font-bold ${team.price > 0 ? 'text-green-400' : 'text-red-400'}`}>{team.price > 0 ? `+${team.price}` : team.price}</p><p className={`text-sm`}>Moneyline vs {team.upcomingGame.opponent}</p></div></div>
        <p className="text-gray-300 mt-4">Detailed view would show more specific stats when available from a more advanced API.</p>
    </div>
  );
};

const MatchupView = ({ teams, onBack, initialTeamAId, initialTeamBId }) => {
    const teamIds = Object.keys(teams);
    const defaultA = initialTeamAId || teamIds[0];
    const defaultB = initialTeamBId || (teams[teamIds[0]]?.upcomingGame?.opponent.toLowerCase().replace(/ /g, '') || teamIds[1]);
    const [teamAId, setTeamAId] = useState(defaultA);
    const [teamBId, setTeamBId] = useState(defaultB);

    const [isGenerating, setIsGenerating] = useState(false);
    const [analysisResult, setAnalysisResult] = useState("");

    const teamA = teams[teamAId];
    const teamB = teams[teamBId];

    const probabilityResult = useMemo(() => {
        if (!teamA || !teamB) return null;
        return calculateWinProbabilityFromOdds(teamA, teamB);
    }, [teamA, teamB]);

    const handleGenerateAnalysis = async () => {
        if(!teamA || !teamB) return;
        setIsGenerating(true);
        setAnalysisResult("");
        const result = await generateMatchupAnalysis(teamA, teamB);
        setAnalysisResult(result);
        setIsGenerating(false);
    };

    if(!teamA || !teamB){
        return <div>Loading matchup...</div>
    }

    return (
        <div className="bg-gray-800 p-4 md:p-6 rounded-lg shadow-lg border border-gray-700">
            <button onClick={onBack} className="mb-4 text-sm text-indigo-400 hover:text-indigo-300">&larr; Back to Market Overview</button>
            <h2 className="text-3xl font-bold text-center mb-6">Matchup Analysis & Implied Probability</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <div>
                    <label className="block text-sm text-gray-300 mb-1">Team A</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded-md p-2" value={teamAId} onChange={(e) => setTeamAId(e.target.value)}>
                        {teamIds.map((id) => (
                            <option key={id} value={id}>{teams[id].name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm text-gray-300 mb-1">Team B</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded-md p-2" value={teamBId} onChange={(e) => setTeamBId(e.target.value)}>
                        {teamIds.map((id) => (
                            <option key={id} value={id}>{teams[id].name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end">
                    <button onClick={handleGenerateAnalysis} disabled={isGenerating} className="bg-amber-600 hover:bg-amber-500 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-lg w-full flex items-center justify-center gap-2 transition-colors">
                        <Sparkles size={18} />{isGenerating ? 'Generating Analysis...' : 'Generate AI Briefing'}
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                 <h2 className="text-xl font-bold text-center p-2 bg-gray-900 rounded-md">{teamA.name}</h2>
                 <h2 className="text-xl font-bold text-center p-2 bg-gray-900 rounded-md">{teamB.name}</h2>
            </div>
            <div className="bg-gray-900/50 p-6 rounded-xl mb-8"><h3 className="text-xl font-semibold text-center text-indigo-300 mb-4">Implied Win Probability (from Market Odds)</h3><div className="flex w-full h-8 bg-gray-700 rounded-full overflow-hidden mb-2"><div className="bg-green-500 flex items-center justify-center font-bold" style={{ width: `${probabilityResult?.[teamA.id]}%` }}>{Math.round(probabilityResult?.[teamA.id])}%</div><div className="bg-blue-500 flex items-center justify-center font-bold" style={{ width: `${probabilityResult?.[teamB.id]}%` }}>{Math.round(probabilityResult?.[teamB.id])}%</div></div><div className="flex justify-between text-sm mb-4"><span className="font-bold text-green-400">{teamA.name}</span><span className="font-bold text-blue-400">{teamB.name}</span></div><p className="text-center text-gray-300 italic p-3 bg-gray-800 rounded-md"><strong>Market Insight:</strong> {probabilityResult?.insight}</p></div>
            <div className="bg-gray-900/50 p-6 rounded-xl"><h3 className="text-xl font-semibold text-center text-amber-300 mb-4">Pre-Game AI Briefing</h3><div className="text-center mb-6"></div>{isGenerating && <div className="flex justify-center items-center h-40"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-amber-400"></div></div>}{analysisResult && <div className="prose prose-invert max-w-none text-gray-300 whitespace-pre-wrap p-4 bg-gray-800 rounded-md">{analysisResult}</div>}</div>
        </div>
    );
};

// --- Main App Component ---
const App = () => {
  const [view, setView] = useState('market');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedTeamAId, setSelectedTeamAId] = useState(null);
  const [selectedTeamBId, setSelectedTeamBId] = useState(null);

  useEffect(() => {
    fetch(API_URL)
      .then(res => {
          if (!res.ok) {
              throw new Error(`Network response was not ok. Is the server running?`);
          }
          return res.json();
      })
      .then(data => {
          setTeamData(data);
          const ids = Object.keys(data);
          if (ids.length >= 2) {
              setSelectedTeamAId(ids[0]);
              const opponentId = data[ids[0]]?.upcomingGame?.opponent?.toLowerCase().replace(/ /g, '');
              setSelectedTeamBId(opponentId && data[opponentId] ? opponentId : ids[1]);
          }
      })
      .catch(err => {
          console.error("Fetch error:", err);
          setError(err.message);
      });
  }, []);

  const handleSelectTeam = (id) => { setSelectedTeamId(id); setView('teamDetail'); };
  const handleBackToMarket = () => { setSelectedTeamId(null); setView('market'); };
  const selectedTeam = selectedTeamId && teamData ? teamData[selectedTeamId] : null;
  const selectedTeamA = selectedTeamAId && teamData ? teamData[selectedTeamAId] : null;
  const selectedTeamB = selectedTeamBId && teamData ? teamData[selectedTeamBId] : null;
  const homeProbability = useMemo(() => {
    if (!selectedTeamA || !selectedTeamB) return null;
    return calculateWinProbabilityFromOdds(selectedTeamA, selectedTeamB);
  }, [selectedTeamA, selectedTeamB]);

  const renderContent = () => {
    if (!teamData && !error) {
        return <div className="text-center p-10"><div className="animate-spin rounded-full h-24 w-24 border-t-2 border-b-2 border-indigo-400 mx-auto"></div><p className="mt-4 text-lg">Fetching Live Market Data...</p></div>;
    }
    if (error) {
        return <div className="text-center p-10 bg-red-900/20 border border-red-500 rounded-lg"><WifiOff className="mx-auto h-16 w-16 text-red-400" /><h3 className="mt-4 text-xl font-bold">Failed to Connect to Server</h3><p className="text-red-300 mt-2">{error}</p><p className="text-gray-400 mt-2">Please ensure the `server.js` file is running in a separate terminal.</p></div>;
    }

    switch (view) {
        case 'matchup': return <MatchupView teams={teamData} onBack={handleBackToMarket} initialTeamAId={selectedTeamAId} initialTeamBId={selectedTeamBId} />;
        case 'teamDetail': return <TeamDetailView team={selectedTeam} onBack={handleBackToMarket} />;
        case 'market': default: return (
            <>
              <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div className="md:col-span-1">
                    <label className="block text-sm text-gray-300 mb-1">Team A</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded-md p-2" value={selectedTeamAId || ''} onChange={(e) => setSelectedTeamAId(e.target.value)}>
                      {teamData && Object.keys(teamData).map((id) => (
                        <option key={id} value={id}>{teamData[id].name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-sm text-gray-300 mb-1">Team B</label>
                    <select className="w-full bg-gray-900 border border-gray-700 rounded-md p-2" value={selectedTeamBId || ''} onChange={(e) => setSelectedTeamBId(e.target.value)}>
                      {teamData && Object.keys(teamData).map((id) => (
                        <option key={id} value={id}>{teamData[id].name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <h2 className="text-2xl font-semibold text-gray-300">Market Overview (Live Odds)</h2>
                      <button onClick={() => setView('matchup')} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors"><BarChart2 size={18} />Matchup Analysis</button>
                    </div>
                    {homeProbability && selectedTeamA && selectedTeamB && (
                      <div className="bg-gray-900/70 p-3 rounded-md">
                        <div className="text-sm text-gray-300 mb-2">Implied Win Probability: <span className="font-semibold text-green-400">{selectedTeamA.name}</span> vs <span className="font-semibold text-blue-400">{selectedTeamB.name}</span></div>
                        <div className="flex w-full h-6 bg-gray-700 rounded-full overflow-hidden">
                          <div className="bg-green-500 flex items-center justify-center text-xs font-bold" style={{ width: `${homeProbability[selectedTeamA.id]}%` }}>{Math.round(homeProbability[selectedTeamA.id])}%</div>
                          <div className="bg-blue-500 flex items-center justify-center text-xs font-bold" style={{ width: `${homeProbability[selectedTeamB.id]}%` }}>{Math.round(homeProbability[selectedTeamB.id])}%</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.values(teamData).map((team) => (<TeamStockCard key={team.id} team={team} onSelect={handleSelectTeam}/>))}
              </div>
            </>
        );
    }
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans">
      <header className="bg-gray-800/30 backdrop-blur-md sticky top-0 z-10 p-4 border-b border-gray-700"><div className="max-w-7xl mx-auto"><h1 className="text-3xl font-bold text-white">Sports Analytics Platform</h1><p className="text-gray-400">Live Market Odds via The Odds API</p></div></header>
      <main className="p-4 md:p-6 max-w-7xl mx-auto">{renderContent()}</main>
    </div>
  );
};

export default App;
