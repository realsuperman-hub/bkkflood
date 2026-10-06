import { state } from '../state.js';
import { evaluatePoint } from './evaluate-core.js';
import { loadTideTable } from './data.js';

// The official tide table covers about a year, so one download per visit is enough; a failed download is retried on the next evaluation.
let tideP = null;
const tideTable = () => (tideP ||= loadTideTable().catch(() => ((tideP = null), null)));

// Gather every signal for a point and score it. Partial failures degrade gracefully.
export const evaluate = async (lat, lng) =>
  evaluatePoint(lat, lng, { stations: state.stations, floods: state.floods, rainObs: state.rainObs, events: state.traffic.events, tideTable: await tideTable() });
