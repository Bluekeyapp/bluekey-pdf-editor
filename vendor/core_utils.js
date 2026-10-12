// Minimal lazy lookup helper for Mozilla's Apache-2.0 glyph-name tables.
export function getLookupTableFactory(initializer){let table;return ()=>{if(!table){table=Object.create(null);initializer(table);}return table;};}
