import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { helmetConfig, apiLimiter, sanitizeInputs } from './middleware/security.js';
import authRoutes from './routes/authRoutes.js';
import circleRoutes from './routes/circleRoutes.js';
import medicationRoutes from './routes/medicationRoutes.js';
import doseRoutes from './routes/doseRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import schedulerRoutes from './routes/schedulerRoutes.js';
import cronRoutes from './routes/cronRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import guardianRoutes from './routes/guardianRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const app = express();

// Security Headers & CORS
app.use(helmetConfig);
app.use(cors());

// Body Parsers & Sanitization
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(sanitizeInputs);

// Apply API rate limiting on /api endpoints
app.use('/api', apiLimiter);

// Health check endpoint for Cloud Run and monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'CareCircle 360',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/circles', circleRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/doses', doseRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/guardian', guardianRoutes);

// Static frontend serving
app.use(express.static(publicDir));

// Fallback to index.html for single page client navigation
app.get('*', (req, res, _next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found.' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Central error handler
app.use((err, _req, res, _next) => {
  console.error('[Internal Error]', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'An unexpected internal server error occurred.'
  });
});

export default app;
