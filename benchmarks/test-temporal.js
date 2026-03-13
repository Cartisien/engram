const query = "What is my current favorite restaurant?";
const queryLower = query.toLowerCase();
const temporalSignals = ['current', 'now', 'today', 'latest', 'recent'];
const isTemporalQuery = temporalSignals.some(s => queryLower.includes(s));
console.log('Query:', query);
console.log('Is temporal:', isTemporalQuery);
console.log('Signals found:', temporalSignals.filter(s => queryLower.includes(s)));
