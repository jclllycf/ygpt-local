// Compatibility is opt-in by using an old name; new catalogs advertise only y_.
// No existing encrypted state or running connection is rewritten.
export function canonicalToolName(name){return typeof name==='string'&&name.startsWith('yuki_')?'y_'+name.slice(5):name;}
