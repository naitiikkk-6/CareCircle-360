/**
 * CareCircle 360 - Client Entry Point
 * Feature code lives in ES modules under js/ (one module per feature).
 */

import { a11y } from './js/accessibility.js';
import { auth } from './js/auth.js';
import { circle } from './js/circle.js';
import { medications } from './js/medications.js';
import { doseTracker } from './js/doseTracker.js';
import { appointments } from './js/appointments.js';
import { pulse } from './js/pulse.js';
import { mediguide } from './js/mediguide.js';
import { guardian } from './js/guardian.js';
import { simpleMode } from './js/simpleMode.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize accessibility first to apply themes and font preferences
  await a11y.init();

  // Initialize all feature modules
  auth.init();
  circle.init();
  medications.init();
  doseTracker.init();
  appointments.init();
  pulse.init();
  mediguide.init();
  guardian.init();
  simpleMode.init();
});
