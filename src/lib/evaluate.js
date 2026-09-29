import { state } from '../state.js';
import { evaluatePoint } from './evaluate-core.js';

// Gather every signal for a point and score it. Partial failures degrade gracefully.
export const evaluate = (lat, lng) => evaluatePoint(lat, lng, { stations: state.stations, floods: state.floods });
