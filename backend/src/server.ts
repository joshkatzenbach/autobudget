import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import authRoutes from './routes/auth';
import budgetRoutes from './routes/budgets';
import plaidRoutes from './routes/plaid';
import transactionRoutes from './routes/transactions';
import slackRoutes from './routes/slack';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

// Security headers middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding if needed
}));

// Middleware
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// IMPORTANT: Register Slack interactive webhook BEFORE global body parsers
// This allows us to capture the raw body for signature verification
app.use('/api/slack/interactive', 
  express.urlencoded({ 
    extended: false, 
    verify: (req: any, res, buf) => {
      console.log('[DEBUG] Capturing raw body via verify callback, length:', buf.length);
      req.rawBody = buf;
      console.log('[DEBUG] Raw body preview (first 200 chars):', buf.toString('utf8').substring(0, 200));
    }
  })
);

// Add request size limits to prevent DoS attacks
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/plaid', plaidRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/slack', slackRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});

