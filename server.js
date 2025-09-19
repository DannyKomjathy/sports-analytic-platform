const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001; // Backend will run on this port

// Use the API key you provided
const API_KEY = 'c5c2cbd326066d3e10842cabbd4b8b20';
const SPORT = 'basketball_nba';
const REGIONS = 'us';
const MARKETS = 'h2h,spreads'; // h2h is moneyline
const ODDS_FORMAT = 'american';

// Use CORS to allow communication between frontend and backend
app.use(cors());

// Basic request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// --- Data Transformation Helper ---
// This function converts the raw API data into the structure our frontend expects
const transformDataForFrontend = (apiData) => {
    const teamsData = {};

    apiData.forEach(game => {
        // Helper to process each team in a game
        const processTeam = (teamName, opposingTeamName, market) => {
            // Use a consistent ID for each team
            const teamId = teamName.toLowerCase().replace(/ /g, '');
            
            // If we haven't seen this team yet, create its base structure
            if (!teamsData[teamId]) {
                teamsData[teamId] = {
                    id: teamId,
                    name: teamName,
                    conference: 'N/A', // This data is not in the odds API
                    // We'll use the moneyline odds as the "price"
                    price: market.price,
                    // Mocked data that can be replaced with more advanced APIs
                    change: (Math.random() * 5 - 2.5),
                    changePercent: (Math.random() * 2 - 1),
                    marketCap: `${(Math.random() * 10 + 15).toFixed(1)}B`,
                    volume: `${(Math.random() * 1 + 0.5).toFixed(1)}M`,
                    performanceHistory: Array.from({ length: 6 }, (_, i) => ({ name: `Day ${i+1}`, value: market.price + (Math.random() * 10 - 5) * (i+1) })),
                    quantitative: { // Mocked analytics
                        offensiveRating: (110 + Math.random() * 10).toFixed(1),
                        defensiveRating: (110 + Math.random() * 10).toFixed(1),
                        netRating: (Math.random() * 10 - 5).toFixed(1),
                        pace: (98 + Math.random() * 5).toFixed(1),
                    },
                    qualitative: { // Static qualitative data
                        managementStability: 'Medium',
                        coachingSystem: 'Established',
                        playerMorale: 'Optimistic',
                        marketSentiment: 'Neutral',
                    },
                    upcomingGame: { // Live data from the API
                        opponent: opposingTeamName,
                        moneyline: market.price,
                    }
                };
            }
        };

        // Find the moneyline (h2h) market for the game
        const moneylineMarket = game.bookmakers[0]?.markets.find(m => m.key === 'h2h');
        if (moneylineMarket) {
            const team1 = moneylineMarket.outcomes[0];
            const team2 = moneylineMarket.outcomes[1];
            processTeam(team1.name, team2.name, team1);
            processTeam(team2.name, team1.name, team2);
        }
    });

    return teamsData;
};


// The single API endpoint for our frontend to call
app.get('/api/nba-data', async (req, res) => {
    try {
        const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${SPORT}/odds`, {
            params: {
                apiKey: API_KEY,
                regions: REGIONS,
                markets: MARKETS,
                oddsFormat: ODDS_FORMAT,
            }
        });

        if (response.data && response.data.length > 0) {
            const formattedData = transformDataForFrontend(response.data);
            res.json(formattedData);
        } else {
            res.status(404).json({ message: 'No upcoming NBA games found.' });
        }

    } catch (error) {
        console.error('Error fetching data from The Odds API:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Failed to fetch data from The Odds API.' });
    }
});

// API 404 handler (only for /api/* routes not matched above)
app.use('/api', (req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// --- Static hosting for built React app (Vite) ---
// Serve files from react-dynamic/dist
const distPath = path.join(__dirname, 'react-dynamic', 'dist');
app.use(express.static(distPath));

// SPA fallback: send index.html for any non-API GET route
app.get(/^(?!\/api).*/, (req, res) => {
    console.log(`SPA fallback for: ${req.originalUrl}`);
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`NBA Data Server is running on http://localhost:${PORT}`);
    console.log(`Frontend should call http://localhost:${PORT}/api/nba-data`);
    console.log(`Serving static SPA from ${distPath}`);
});
