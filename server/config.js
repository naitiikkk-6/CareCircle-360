import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  appSecret: process.env.APP_SECRET || 'carecircle-360-default-development-secret-key-32chars',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || '8080'}`,
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com` : '')
  },
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  schedulerSecret:
    process.env.SCHEDULER_SECRET ||
    process.env.CRON_SECRET ||
    'carecircle-scheduler-secret-auth-key-here',
  cronSecret:
    process.env.CRON_SECRET ||
    process.env.SCHEDULER_SECRET ||
    'carecircle-scheduler-secret-auth-key-here',
  emailMockMode:
    process.env.EMAIL_MOCK_MODE === 'true' ||
    process.env.NODE_ENV === 'test' ||
    (!process.env.GMAIL_USER && !process.env.SMTP_USER),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.GMAIL_USER || process.env.SMTP_USER || '',
    pass: process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '',
    from:
      process.env.EMAIL_FROM ||
      process.env.GMAIL_USER ||
      '"CareCircle 360" <notifications@carecircle360.internal>'
  },
  useLocalDb: process.env.USE_LOCAL_DB === 'true' || !process.env.FIREBASE_PROJECT_ID
};
