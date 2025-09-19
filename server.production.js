const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Environment configuration
const config = {
    apiKey: process.env.ODDS_API_KEY,
    sport: process.env.ODDS_API_SPORT || 'basketball_nba',
    regions: process.env.ODDS_API_REGIONS || 'us',
    markets: process.env.ODDS_API_MARKETS || 'h2h,spreads',
    oddsFormat: process.env.ODDS_API_ODDS_FORMAT || 'american',
    cacheTtl: parseInt(process.env.CACHE_TTL_SECONDS) || 60,
    enableCache: process.env.ENABLE_CACHE === 'true',
    corsOrigin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
    enableHelmet: process.env.ENABLE_HELMET === 'true'
};

// Security middleware
if (config.enableHelmet) {
    app.use(helmet({
        contentSecurityPolicy: false, // Disable for development
        crossOriginEmbedderPolicy: false
    }));
}

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', limiter);

// CORS configuration
app.use(cors({
    origin: config.corsOrigin,
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    req.requestId = requestId;
    
    res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`[${requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
});

// Simple in-memory cache
const cache = new Map();
const getCacheKey = (endpoint, params) => `${endpoint}:${JSON.stringify(params)}`;

const getCachedData = (key) => {
    if (!config.enableCache) return null;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < config.cacheTtl * 1000) {
        return cached.data;
    }
    cache.delete(key);
    return null;
};

const setCachedData = (key, data) => {
    if (!config.enableCache) return;
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
};

// Health check with version info
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

// API versioning
app.get('/api/v1/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        apiVersion: 'v1',
        timestamp: new Date().toISOString()
    });
});

// --- Data Transformation Helper ---
const transformDataForFrontend = (apiData) => {
    const teamsData = {};

    apiData.forEach(game => {
        const processTeam = (teamName, opposingTeamName, market) => {
            const teamId = teamName.toLowerCase().replace(/ /g, '');
            
            if (!teamsData[teamId]) {
                teamsData[teamId] = {
                    id: teamId,
                    name: teamName,
                    conference: 'N/A',
                    price: market.price,
                    change: (Math.random() * 5 - 2.5),
                    changePercent: (Math.random() * 2 - 1),
                    marketCap: `${(Math.random() * 10 + 15).toFixed(1)}B`,
                    volume: `${(Math.random() * 1 + 0.5).toFixed(1)}M`,
                    performanceHistory: Array.from({ length: 6 }, (_, i) => ({ 
                        name: `Day ${i+1}`, 
                        value: market.price + (Math.random() * 10 - 5) * (i+1) 
                    })),
                    quantitative: {
                        offensiveRating: (110 + Math.random() * 10).toFixed(1),
                        defensiveRating: (110 + Math.random() * 10).toFixed(1),
                        netRating: (Math.random() * 10 - 5).toFixed(1),
                        pace: (98 + Math.random() * 5).toFixed(1),
                    },
                    qualitative: {
                        managementStability: 'Medium',
                        coachingSystem: 'Established',
                        playerMorale: 'Optimistic',
                        marketSentiment: 'Neutral',
                    },
                    upcomingGame: {
                        opponent: opposingTeamName,
                        moneyline: market.price,
                    }
                };
            }
        };

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

// NBA Data API endpoint with caching
app.get('/api/v1/nba-data', async (req, res) => {
    try {
        const cacheKey = getCacheKey('nba-data', req.query);
        const cachedData = getCachedData(cacheKey);
        
        if (cachedData) {
            console.log(`[${req.requestId}] Serving cached data`);
            return res.json(cachedData);
        }

        if (!config.apiKey) {
            return res.status(500).json({ 
                error: 'API key not configured',
                message: 'Please set ODDS_API_KEY environment variable'
            });
        }

        const response = await axios.get(`https://api.the-odds-api.com/v4/sports/${config.sport}/odds`, {
            params: {
                apiKey: config.apiKey,
                regions: config.regions,
                markets: config.markets,
                oddsFormat: config.oddsFormat,
            },
            timeout: 10000 // 10 second timeout
        });

        if (response.data && response.data.length > 0) {
            const formattedData = transformDataForFrontend(response.data);
            setCachedData(cacheKey, formattedData);
            res.json(formattedData);
        } else {
            res.status(404).json({ message: 'No upcoming NBA games found.' });
        }

    } catch (error) {
        console.error(`[${req.requestId}] Error fetching data:`, error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ 
                error: 'Request timeout',
                message: 'The odds API is taking too long to respond'
            });
        }
        
        if (error.response) {
            return res.status(error.response.status).json({ 
                error: 'External API error',
                message: error.response.data?.message || 'Failed to fetch data from The Odds API'
            });
        }
        
        res.status(500).json({ 
            error: 'Internal server error',
            message: 'An unexpected error occurred'
        });
    }
});

// Legacy endpoint for backward compatibility
app.get('/api/nba-data', (req, res) => {
    res.redirect('/api/v1/nba-data');
});

// API 404 handler
app.use('/api', (req, res) => {
    res.status(404).json({ 
        error: 'Not found',
        message: `API endpoint ${req.originalUrl} not found`,
        availableEndpoints: ['/api/v1/nba-data', '/api/v1/health']
    });
});

// Static hosting for built React app
const distPath = path.join(__dirname, 'react-dynamic-minimal', 'dist');
app.use(express.static(distPath));

// SPA fallback
app.get(/^(?!\/api).*/, (req, res) => {
    console.log(`[${req.requestId}] SPA fallback for: ${req.originalUrl}`);
    res.sendFile(path.join(distPath, 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(`[${req.requestId}] Unhandled error:`, error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`🚀 NBA Data Server is running on http://localhost:${PORT}`);
    console.log(`📊 API: http://localhost:${PORT}/api/v1/nba-data`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 Caching: ${config.enableCache ? 'enabled' : 'disabled'}`);
    console.log(`🔒 Security: ${config.enableHelmet ? 'enabled' : 'disabled'}`);
});

